import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { getFfmpegPath } from "./env.mjs";

/**
 * YouTube section extractor for the news-reel workflow.
 *
 * Downloads ONLY the requested time range of a YouTube video
 * (no full-video download) via yt-dlp --download-sections,
 * then prepares broadcast-ready assets:
 *  - section MP4 (original landscape)
 *  - 16kHz mono WAV for Whisper word alignment
 *  - 9:16 vertical crop centered on the speaker
 */

export function parseTimestamp(ts) {
  if (typeof ts === "number") return ts;
  const s = String(ts).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(":").map(Number);
  if (parts.some(Number.isNaN)) {
    throw new Error(`Timestamp invalide: "${ts}" (attendu MM:SS ou HH:MM:SS)`);
  }
  let total = 0;
  for (const p of parts) total = total * 60 + p;
  return total;
}

export function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function runCmd(bin, args, label) {
  const res = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(
      `[youtube-extract] ${label} a échoué (code ${res.status}): ${(res.stderr || res.stdout || "").slice(0, 500)}`
    );
  }
  return (res.stdout || "").trim();
}

function findYtDlp() {
  for (const candidate of ["yt-dlp", "yt_dlp"]) {
    const res = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (res.status === 0) return candidate;
  }
  // Try python module as last resort
  const py = spawnSync("python3", ["-m", "yt_dlp", "--version"], { encoding: "utf8" });
  if (py.status === 0) return "python3 -m yt_dlp";
  throw new Error(
    "[youtube-extract] yt-dlp introuvable. Installez-le: pip install yt-dlp (ou https://github.com/yt-dlp/yt-dlp)"
  );
}

/**
 * Downloads only [start, end] of a YouTube video.
 * Returns the path of the downloaded section file.
 */
export function downloadSection({ videoUrl, start, end, outputMp4Path, preferQuality = "bv*[height<=720]+ba/b[height<=720]/b" }) {
  const startSec = parseTimestamp(start);
  const endSec = parseTimestamp(end);
  if (!(endSec > startSec)) {
    throw new Error(`[youtube-extract] La fin (${end}) doit être après le début (${start}).`);
  }

  const ytdlp = findYtDlp();
  const [bin, ...modPrefix] = ytdlp.split(" ");
  const section = `*${formatTimestamp(startSec)}-${formatTimestamp(endSec)}`;

  console.log(`[youtube-extract] Téléchargement du passage ${formatTimestamp(startSec)} → ${formatTimestamp(endSec)} ...`);
  runCmd(bin, [
    ...modPrefix,
    "--download-sections", section,
    "--force-keyframes-at-cuts",
    "-f", preferQuality,
    "--merge-output-format", "mp4",
    "-o", outputMp4Path,
    "--no-playlist",
    videoUrl,
  ], "téléchargement du passage YouTube");

  if (!existsSync(outputMp4Path)) {
    throw new Error(`[youtube-extract] Le fichier attendu n'existe pas après téléchargement: ${outputMp4Path}`);
  }
  console.log(`[youtube-extract] ✓ Passage téléchargé: ${outputMp4Path}`);
  return outputMp4Path;
}

/**
 * Extracts 16kHz mono WAV audio (Whisper-ready) from a video file.
 */
export function extractAudioWav({ inputVideo, outputWavPath }) {
  const ffmpeg = getFfmpegPath();
  runCmd(ffmpeg, [
    "-y", "-v", "error",
    "-i", inputVideo,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    outputWavPath,
  ], "extraction audio WAV");
  console.log(`[youtube-extract] ✓ Audio WAV 16kHz: ${outputWavPath}`);
  return outputWavPath;
}

/**
 * Returns { width, height, duration } of a video file via ffprobe.
 */
export function probeVideo({ inputVideo }) {
  const ffprobe = getFfmpegPath().replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  try {
    const out = runCmd(ffprobe, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "default=noprint_wrappers=1",
      inputVideo,
    ], "sonde vidéo");
    const width = Number((out.match(/width=(\d+)/) || [])[1] || 0);
    const height = Number((out.match(/height=(\d+)/) || [])[1] || 0);
    const duration = Number((out.match(/duration=([\d.]+)/) || [])[1] || 0);
    return { width, height, duration };
  } catch {
    return { width: 0, height: 0, duration: 0 };
  }
}

/**
 * Crops a landscape video to vertical 9:16 (1080x1920), centered horizontally
 * on the speaker. `focusX` (0..1) shifts the crop window; 0.5 = centered.
 * Adds a subtle continuous push-in (scale 1.0 → 1.06) for a cinematic feel.
 */
export function cropToVertical({ inputVideo, outputVideo, focusX = 0.5, withPushIn = true }) {
  const ffmpeg = getFfmpegPath();
  const fx = Math.min(1, Math.max(0, focusX));
  // Crop window: full height, width = height * 9/16, x offset by focusX
  const cropExpr = `crop=ih*9/16:ih:(iw-ow)*${fx}:0`;
  const filters = [cropExpr, "scale=1080:1920"];
  if (withPushIn) {
    filters.push("scale=1200:2134,zoompan=z='min(zoom+0.0006,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30");
  }
  runCmd(ffmpeg, [
    "-y", "-v", "error",
    "-i", inputVideo,
    "-vf", filters.join(","),
    "-c:a", "aac",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputVideo,
  ], "recadrage vertical 9:16");
  console.log(`[youtube-extract] ✓ Recadrage 9:16: ${outputVideo}`);
  return outputVideo;
}

/**
 * Concatenates teaser + main clips into a single MP4 (same codec params).
 * Returns { outputVideo, teaserDuration }.
 */
export function concatTeaser({ teaserVideo, mainVideo, outputVideo }) {
  const ffmpeg = getFfmpegPath();
  const { duration: teaserDuration } = probeVideo({ inputVideo: teaserVideo });
  const listFile = outputVideo + ".concat.txt";
  writeFileSync(listFile, `file '${teaserVideo}'\nfile '${mainVideo}'\n`, "utf8");
  runCmd(ffmpeg, [
    "-y", "-v", "error",
    "-f", "concat", "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    outputVideo,
  ], "concaténation teaser");
  console.log(`[youtube-extract] ✓ Teaser concaténé (${teaserDuration.toFixed(1)}s): ${outputVideo}`);
  return { outputVideo, teaserDuration };
}

/**
 * Downloads YouTube auto-generated subtitles (if available) as a
 * fallback transcript source. Returns the .vtt path or null.
 */
export function downloadAutoSubs({ videoUrl, lang = "fr", outputBase }) {
  try {
    const ytdlp = findYtDlp();
    const [bin, ...modPrefix] = ytdlp.split(" ");
    runCmd(bin, [
      ...modPrefix,
      "--write-auto-subs",
      "--sub-langs", `${lang}.*`,
      "--skip-download",
      "--sub-format", "vtt",
      "-o", outputBase,
      "--no-playlist",
      videoUrl,
    ], "téléchargement sous-titres auto");
    const vtt = `${outputBase}.${lang}.vtt`;
    return existsSync(vtt) ? vtt : null;
  } catch {
    return null;
  }
}
