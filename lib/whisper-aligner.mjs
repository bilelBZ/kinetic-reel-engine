import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Whisper-based word aligner for the news-reel workflow.
 *
 * Tier 1: faster-whisper (python) with word_timestamps=True — millisecond precision.
 * Tier 2: openai-whisper CLI (slower, same word timestamps).
 * Tier 3: returns null — the caller falls back to the envelope aligner
 *          (lib/word-aligner.mjs) with a provided transcript, or renders
 *          without karaoke captions.
 *
 * Output words: { id, word, clean, time, end, isKeyword, sceneId }
 * Numeric tokens (prices, percentages, counts) are auto-flagged as keywords,
 * mirroring the final news pipeline where the number IS the hook.
 */

const ALIGNER_PY = `
import json, sys
import numpy as np
import soundfile as sf
wav_path, model_name, language, out_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.stderr.write("NO_FASTER_WHISPER\\n")
    sys.exit(42)
# Decode manually with soundfile to avoid the av/PyAV version conflict
# inside faster_whisper's decode_audio().
audio, sr = sf.read(wav_path, dtype="float32")
if audio.ndim > 1:
    audio = audio.mean(axis=1)
if sr != 16000:
    # naive resample (wav is already 16k from our pipeline)
    import math
    ratio = 16000 / sr
    idx = (np.arange(int(len(audio) * ratio)) / ratio).astype(int)
    idx = np.clip(idx, 0, len(audio) - 1)
    audio = audio[idx]
model = WhisperModel(model_name, device="auto", compute_type="auto")
segments, info = model.transcribe(audio, language=language if language != "auto" else None, word_timestamps=True)
words = []
for seg in segments:
    for w in (seg.words or []):
        words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({"words": words, "language": info.language}, f, ensure_ascii=False)
print(f"OK {len(words)} words lang={info.language}")
`;

function hasFasterWhisper() {
  const res = spawnSync("python3", ["-c", "import faster_whisper"], { encoding: "utf8" });
  return res.status === 0;
}

function hasWhisperCli() {
  const res = spawnSync("whisper", ["--help"], { encoding: "utf8" });
  return res.status === 0;
}

function cleanToken(word) {
  return word.replace(/^[«»"'"([¿¡]+|[.,!?;:"'«»)\]}…–—]+$/g, "").trim();
}

function isNumericToken(clean) {
  return /[0-9]/.test(clean);
}

function markKeywords(rawWords, userKeywords = []) {
  const lowered = new Set(userKeywords.map((k) => k.toLowerCase()));
  return rawWords.map((w) => {
    const clean = cleanToken(w.word).toLowerCase();
    const isKeyword = isNumericToken(clean) || lowered.has(clean);
    return { ...w, clean, isKeyword };
  });
}

export function alignWordsWithWhisper({
  wavPath,
  language = "auto",
  model = process.env.WHISPER_MODEL || "base",
  userKeywords = [],
  sceneId = "news",
  outputJsonPath = null,
}) {
  if (!existsSync(wavPath)) {
    throw new Error(`[whisper-aligner] Fichier audio introuvable: ${wavPath}`);
  }

  let rawWords = null;

  // Tier 1: faster-whisper
  if (hasFasterWhisper()) {
    console.log(`[whisper-aligner] faster-whisper (modèle: ${model}) — transcription mot à mot...`);
    const dir = mkdtempSync(join(tmpdir(), "whisper-align-"));
    const scriptPath = join(dir, "align.py");
    const outPath = join(dir, "words.json");
    writeFileSync(scriptPath, ALIGNER_PY, "utf8");
    const res = spawnSync("python3", [scriptPath, wavPath, model, language, outPath], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    if (res.status === 0 && existsSync(outPath)) {
      const parsed = JSON.parse(readFileSync(outPath, "utf8"));
      rawWords = parsed.words || [];
      console.log(`[whisper-aligner] ✓ ${rawWords.length} mots alignés (${(res.stdout || "").trim()})`);
    } else {
      console.warn(`[whisper-aligner] faster-whisper a échoué: ${(res.stderr || "").slice(0, 300)}`);
    }
  } else if (hasWhisperCli()) {
    // Tier 2: openai-whisper CLI -> JSON with word timestamps
    console.log(`[whisper-aligner] whisper CLI (modèle: ${model}) — transcription mot à mot...`);
    const dir = mkdtempSync(join(tmpdir(), "whisper-align-"));
    const res = spawnSync("whisper", [
      wavPath,
      "--model", model,
      "--language", language === "auto" ? "auto" : language,
      "--output_format", "json",
      "--word_timestamps", "True",
      "--output_dir", dir,
      "--fp16", "False",
    ], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 20 * 60 * 1000 });
    const base = wavPath.split("/").pop().replace(/\.[^.]+$/, "");
    const jsonPath = join(dir, `${base}.json`);
    if (res.status === 0 && existsSync(jsonPath)) {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
      rawWords = [];
      for (const seg of parsed.segments || []) {
        for (const w of seg.words || []) {
          rawWords.push({ word: String(w.word || "").trim(), start: Number(w.start), end: Number(w.end) });
        }
      }
      console.log(`[whisper-aligner] ✓ ${rawWords.length} mots alignés (whisper CLI)`);
    } else {
      console.warn(`[whisper-aligner] whisper CLI a échoué: ${(res.stderr || "").slice(0, 300)}`);
    }
  } else {
    console.warn("[whisper-aligner] Ni faster-whisper ni whisper CLI détectés (pip install faster-whisper).");
  }

  if (!rawWords || rawWords.length === 0) return null;

  const withKeywords = markKeywords(rawWords, userKeywords);
  const words = withKeywords
    .filter((w) => w.word.length > 0)
    .map((w, i) => ({
      id: `w_news_${i}`,
      sceneId,
      word: w.word,
      clean: w.clean,
      time: Number(w.start.toFixed(2)),
      end: Number(w.end.toFixed(2)),
      isKeyword: w.isKeyword,
    }));

  const totalDuration = words.length > 0 ? Number((words[words.length - 1].end + 1.0).toFixed(2)) : 0;

  if (outputJsonPath) {
    writeFileSync(outputJsonPath, JSON.stringify(words, null, 2), "utf8");
  }

  return { words, totalDuration, engine: "whisper" };
}

/**
 * Fallback aligner: parses a WebVTT subtitle file (e.g. YouTube auto-subs)
 * into timed words. Words inside each cue are distributed evenly across
 * the cue's time span — less precise than Whisper, but zero dependencies.
 */
export function alignWordsFromVtt({ vttPath, userKeywords = [], sceneId = "news", outputJsonPath = null }) {
  if (!existsSync(vttPath)) return null;
  const text = readFileSync(vttPath, "utf8");

  const cueRe = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/g;
  const cues = [];
  let m;
  while ((m = cueRe.exec(text)) !== null) {
    const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
    const bodyStart = m.index + m[0].length;
    const bodyEnd = text.indexOf("\n\n", bodyStart);
    const body = text.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd)
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (body) cues.push({ start, end, body });
  }
  if (cues.length === 0) return null;

  const rawWords = [];
  for (const cue of cues) {
    const tokens = cue.body.split(/\s+/).filter(Boolean);
    const span = Math.max(0.2, cue.end - cue.start);
    const per = span / tokens.length;
    tokens.forEach((tok, i) => {
      rawWords.push({ word: tok, start: cue.start + i * per, end: cue.start + (i + 1) * per });
    });
  }

  const withKeywords = markKeywords(rawWords, userKeywords);
  const words = withKeywords
    .filter((w) => w.word.length > 0)
    .map((w, i) => ({
      id: `w_news_${i}`,
      sceneId,
      word: w.word,
      clean: w.clean,
      time: Number(w.start.toFixed(2)),
      end: Number(w.end.toFixed(2)),
      isKeyword: w.isKeyword,
    }));

  const totalDuration = words.length > 0 ? Number((words[words.length - 1].end + 1.0).toFixed(2)) : 0;
  if (outputJsonPath) {
    writeFileSync(outputJsonPath, JSON.stringify(words, null, 2), "utf8");
  }
  console.log(`[whisper-aligner] ✓ ${words.length} mots depuis sous-titres VTT (fallback)`);
  return { words, totalDuration, engine: "vtt-fallback" };
}
