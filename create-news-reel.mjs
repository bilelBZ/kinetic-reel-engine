#!/usr/bin/env node

import { existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  parseTimestamp,
  formatTimestamp,
  downloadSection,
  trimLocalSection,
  extractAudioWav,
  probeVideo,
  cropToVertical,
  concatTeaser,
  downloadAutoSubs,
} from "./lib/youtube-extract.mjs";
import { alignWordsWithWhisper, alignWordsFromVtt } from "./lib/whisper-aligner.mjs";
import { buildNewsCompositionHtml } from "./lib/news-composition-builder.mjs";
import { renderVideoToMp4 } from "./lib/renderer.mjs";
import { getFfmpegPath } from "./lib/env.mjs";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

const LANG_MAP = { fr: "fr", french: "fr", de: "de", german: "de", ar: "ar", arabic: "ar", en: "en", english: "en" };

function parseArgs() {
  const args = process.argv.slice(2);
  const p = {
    video: null, localVideo: null, start: null, end: null,
    teaser: null, hook: null, badge: null, badgeAt: null, cta: null,
    keywords: [], lang: "fr",
    title: "News Reel", description: "", hashtags: "", pinned: "",
    focusX: 0.5, followSpeaker: true, output: null, packagePath: null, skipRender: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--video" || a === "-u") p.video = args[++i];
    else if (a === "--local-video") p.localVideo = args[++i];
    else if (a === "--start" || a === "-s") p.start = args[++i];
    else if (a === "--end" || a === "-e") p.end = args[++i];
    else if (a === "--teaser") p.teaser = args[++i];
    else if (a === "--hook") p.hook = args[++i];
    else if (a === "--badge") p.badge = args[++i];
    else if (a === "--badge-at") p.badgeAt = args[++i];
    else if (a === "--cta") p.cta = args[++i];
    else if (a === "--keywords" || a === "-k") p.keywords = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--lang" || a === "-l") p.lang = args[++i];
    else if (a === "--title") p.title = args[++i];
    else if (a === "--description") p.description = args[++i];
    else if (a === "--hashtags") p.hashtags = args[++i];
    else if (a === "--pinned") p.pinned = args[++i];
    else if (a === "--focus-x") p.focusX = Number(args[++i]);
    else if (a === "--follow-speaker") p.followSpeaker = true;
    else if (a === "--no-follow-speaker") p.followSpeaker = false;
    else if (a === "--output" || a === "-o") p.output = args[++i];
    else if (a === "--package") p.packagePath = args[++i];
    else if (a === "--skip-render") p.skipRender = true;
  }
  return p;
}

function usage() {
  console.log(`
Usage: node create-news-reel.mjs --video <URL> --start MM:SS --end MM:SS [options]

  --video, -u      YouTube URL (requis, sauf si --local-video)
  --local-video    Fichier vidéo local (saute le téléchargement YouTube)
  --start, -s      Début du passage, ex: 07:35 (requis)
  --end, -e        Fin du passage, ex: 08:06 (requis)
  --teaser         Teaser 0-3s, ex: "07:58-08:02" (le moment fort d'abord)
  --hook           Texte du hook (barre highlight noir sur jaune)
  --badge          Texte du badge animé (ex: "-18 CTS")
  --badge-at       Moment du badge en temps vidéo, ex: 07:59 (défaut: 1er mot-clé)
  --cta            Question de fin, ex: "VOUS EN PENSEZ QUOI ?"
  --keywords, -k   Mots-clés "18,centimes,gazole" (les chiffres sont auto-détectés)
  --lang, -l       fr | de | ar | en (défaut: fr)
  --title          Titre de publication
  --description    Description SEO
  --hashtags       Hashtags séparés par des espaces
  --pinned         Commentaire épinglé
  --focus-x        Cadrage horizontal 0..1 (0.5 = centré, défaut, ignoré si suivi actif)
  --follow-speaker Suivi caméra du locuteur (défaut: actif)
  --no-follow-speaker Désactive le suivi, utilise --focus-x statique
  --output, -o     MP4 de sortie (défaut: <slug>.mp4 dans le dossier projet)
  --package        Chemin du package de publication JSON
  --skip-render    Génère le projet HTML sans lancer le rendu MP4
`);
}

function parseRange(range) {
  const [a, b] = String(range).split("-");
  if (!a || !b) throw new Error(`Plage invalide: "${range}" (attendu "MM:SS-MM:SS")`);
  return { start: a.trim(), end: b.trim() };
}

async function main() {
  console.log("\n=======================================================");
  console.log(" 🎬 NEWS REEL PIPELINE — YouTube extract → karaoke → MP4");
  console.log("=======================================================\n");

  const p = parseArgs();
  if ((!p.video && !p.localVideo) || !p.start || !p.end) {
    usage();
    process.exit(1);
  }
  if (p.localVideo && !existsSync(p.localVideo)) {
    console.error(`❌ Fichier local introuvable: ${p.localVideo}`);
    process.exit(1);
  }

  const whisperLang = LANG_MAP[String(p.lang).toLowerCase()] || "fr";
  const mainStart = parseTimestamp(p.start);
  const mainEnd = parseTimestamp(p.end);

  // Project folder
  const slugBase = `${whisperLang}-news-${Date.now().toString().slice(-6)}`;
  const projectDir = resolve(__dirname, `scratch/${slugBase}`);
  mkdirSync(projectDir, { recursive: true });
  const assetsDir = join(projectDir, "assets");
  const audioDir = join(assetsDir, "audio");
  const imgDir = join(assetsDir, "img");
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(imgDir, { recursive: true });
  console.log(`📂 Dossier du projet: ${projectDir}`);

  // Copy template assets (fonts, SFX)
  const templateAssetsDir = join(__dirname, "templates/assets");
  if (existsSync(templateAssetsDir)) {
    cpSync(templateAssetsDir, assetsDir, { recursive: true });
  }

  // ---- Stage 1: get the main passage (YouTube section OR local file trim)
  const mainLandscape = join(projectDir, "clip-main-landscape.mp4");
  if (p.localVideo) {
    console.log("\n[1/7] ✂️  Découpe du passage depuis le fichier local...");
    trimLocalSection({ inputVideo: resolve(p.localVideo), start: p.start, end: p.end, outputVideo: mainLandscape });
  } else {
    console.log("\n[1/7] ⬇️  Téléchargement du passage YouTube...");
    downloadSection({ videoUrl: p.video, start: p.start, end: p.end, outputMp4Path: mainLandscape });
  }

  let teaserEnd = null;
  let mainVertical = join(projectDir, "clip-vertical.mp4");
  if (p.teaser) {
    const { start: tStart, end: tEnd } = parseRange(p.teaser);
    const teaserLandscape = join(projectDir, "clip-teaser-landscape.mp4");
    const teaserVertical = join(projectDir, "clip-teaser-vertical.mp4");
    if (p.localVideo) {
      console.log("\n[2/7] ⚡ Découpe du teaser (fichier local)...");
      trimLocalSection({ inputVideo: resolve(p.localVideo), start: tStart, end: tEnd, outputVideo: teaserLandscape });
    } else {
      console.log("\n[2/7] ⚡ Téléchargement du teaser...");
      downloadSection({ videoUrl: p.video, start: tStart, end: tEnd, outputMp4Path: teaserLandscape });
    }

    console.log("\n[3/7] 📐 Recadrage 9:16 (teaser + passage)...");
    cropToVertical({ inputVideo: teaserLandscape, outputVideo: teaserVertical, focusX: p.focusX, followSpeaker: p.followSpeaker });
    cropToVertical({ inputVideo: mainLandscape, outputVideo: mainVertical, focusX: p.focusX, followSpeaker: p.followSpeaker });
    const concatOut = join(projectDir, "clip-concat.mp4");
    const { teaserDuration } = concatTeaser({ teaserVideo: teaserVertical, mainVideo: mainVertical, outputVideo: concatOut });
    teaserEnd = Number(teaserDuration.toFixed(2));
    mainVertical = concatOut;
    console.log(`      ✓ Teaser de ${teaserEnd}s concaténé devant le passage`);
  } else {
    console.log("\n[2/7] 📐 Recadrage 9:16 du passage...");
    cropToVertical({ inputVideo: mainLandscape, outputVideo: mainVertical, focusX: p.focusX, followSpeaker: p.followSpeaker });
  }

  // ---- Stage 4: audio tracks
  console.log("\n[4/7] 🔊 Extraction audio...");
  const ffmpeg = getFfmpegPath();
  const clipAudioMp3 = join(audioDir, "clip-audio.mp3");
  const clipWav16k = join(audioDir, "clip-16k.wav");
  let r = spawnSync(ffmpeg, ["-y", "-v", "error", "-i", mainVertical, "-vn", "-c:a", "libmp3lame", "-b:a", "160k", clipAudioMp3]);
  if (r.status !== 0) throw new Error("Extraction MP3 audio impossible.");
  extractAudioWav({ inputVideo: mainVertical, outputWavPath: clipWav16k });

  const { duration: clipDuration } = probeVideo({ inputVideo: mainVertical });
  const totalDuration = Number((clipDuration || 30).toFixed(2));
  console.log(`      ✓ Durée du clip final: ${totalDuration}s`);

  // ---- Stage 5: word alignment (Whisper → VTT fallback → none)
  console.log("\n[5/7] ⏱️  Alignement mot à mot (Whisper)...");
  const wordsJsonPath = join(projectDir, "words.json");
  let alignment = alignWordsWithWhisper({
    wavPath: clipWav16k,
    language: whisperLang,
    userKeywords: p.keywords,
    outputJsonPath: wordsJsonPath,
  });
  if (!alignment && p.video) {
    console.log("      ℹ️  Whisper indisponible — essai des sous-titres auto YouTube...");
    const vtt = downloadAutoSubs({ videoUrl: p.video, lang: whisperLang, outputBase: join(projectDir, "subs") });
    if (vtt) {
      alignment = alignWordsFromVtt({ vttPath: vtt, userKeywords: p.keywords, outputJsonPath: wordsJsonPath });
      // VTT timestamps are in VIDEO time; shift by -mainStart (+ teaser offset already baked in audio order?)
      // Note: auto-subs cover the whole video; we keep only words inside [mainStart, mainEnd].
      if (alignment) {
        const offset = teaserEnd ? teaserEnd : 0;
        alignment.words = alignment.words
          .filter((w) => w.time >= mainStart && w.time <= mainEnd)
          .map((w, i) => ({ ...w, id: `w_news_${i}`, time: Number((w.time - mainStart + offset).toFixed(2)), end: Number((w.end - mainStart + offset).toFixed(2)) }));
        console.log(`      ✓ ${alignment.words.length} mots conservés dans le passage`);
      }
    }
  }
  const words = alignment ? alignment.words : [];
  console.log(`      ✓ ${words.length} mots (${alignment ? alignment.engine : "sans captions"})`);

  // ---- Badge timing resolution (clip timeline)
  let badge = null;
  if (p.badge) {
    let badgeAt = null;
    if (p.badgeAt) {
      badgeAt = parseTimestamp(p.badgeAt) - mainStart + (teaserEnd || 0);
    } else {
      const firstKw = words.find((w) => w.isKeyword);
      badgeAt = firstKw ? firstKw.time : 2.0;
    }
    badge = { text: p.badge, at: Number(Math.max(0.3, badgeAt).toFixed(2)) };
    console.log(`      ✓ Badge "${p.badge}" à ${badge.at}s`);
  }

  const cta = p.cta
    ? { text: p.cta, showAt: Number(Math.max(1, totalDuration - 2.4).toFixed(2)) }
    : null;

  // ---- Stage 6: thumbnail frame
  const thumbPath = join(projectDir, "thumbnail.jpg");
  spawnSync(ffmpeg, ["-y", "-v", "error", "-ss", "1.2", "-i", mainVertical, "-frames:v", "1", "-q:v", "3", thumbPath]);

  // ---- Stage 7: build composition
  console.log("\n[6/7] 📐 Assemblage de la composition news-viral (karaoke Anton)...");
  const indexPath = join(projectDir, "index.html");
  buildNewsCompositionHtml({
    projectDir,
    outputPath: indexPath,
    title: p.title,
    clipVideoRel: "assets/clip-vertical.mp4",
    clipAudioRel: "assets/audio/clip-audio.mp3",
    words,
    totalDuration,
    teaserEnd,
    hook: p.hook ? { text: p.hook, showAt: 0.15, hideAt: 3.4 } : null,
    badge,
    cta,
    styleName: "news-viral",
  });
  // The vertical clip must live at assets/clip-vertical.mp4 for the HTML
  const htmlClipPath = join(assetsDir, "clip-vertical.mp4");
  if (mainVertical !== htmlClipPath) {
    cpSync(mainVertical, htmlClipPath);
  }
  writeFileSync(join(projectDir, "meta.json"), JSON.stringify({ id: slugBase, name: p.title, createdAt: new Date().toISOString() }, null, 2), "utf8");
  writeFileSync(join(projectDir, "hyperframes.json"), JSON.stringify({ width: 1080, height: 1920, fps: 30, duration: totalDuration }, null, 2), "utf8");
  console.log(`      ✓ Composition prête: ${indexPath}`);

  // ---- Publishing package
  const outputMp4Path = p.output ? resolve(p.output) : join(projectDir, `${slugBase}.mp4`);
  const pkg = {
    title: p.title,
    description: p.description,
    hashtags: p.hashtags.split(/[\s,]+/).filter(Boolean),
    pinned_comment: p.pinned,
    hook: p.hook || "",
    badge: p.badge || "",
    cta: p.cta || "",
    source: p.video
      ? { youtube_url: p.video, start: formatTimestamp(mainStart), end: formatTimestamp(mainEnd), teaser: p.teaser || null }
      : { local_file: p.localVideo, start: formatTimestamp(mainStart), end: formatTimestamp(mainEnd), teaser: p.teaser || null },
    assets: { video: outputMp4Path, thumbnail: thumbPath },
    duration_seconds: totalDuration,
    words: words.length,
    alignment_engine: alignment ? alignment.engine : "none",
  };
  const pkgPath = p.packagePath ? resolve(p.packagePath) : join(projectDir, "package.json");
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
  console.log(`      ✓ Package de publication: ${pkgPath}`);

  // ---- Render
  if (p.skipRender) {
    console.log("\n[7/7] ⏭️  Rendu ignoré (--skip-render).");
    console.log(`Prévisualisation: cd "${projectDir}" && npx hyperframes preview`);
    return;
  }
  console.log("\n[7/7] 🎥 Rendu headless MP4 (1080x1920)...");
  renderVideoToMp4({ projectDir, outputMp4Path });

  console.log("\n=======================================================");
  console.log(" 🎉 NEWS REEL GÉNÉRÉ AVEC SUCCÈS !");
  console.log(` 📁 Vidéo: ${outputMp4Path}`);
  console.log(` 🖼️  Miniature: ${thumbPath}`);
  console.log(` 📦 Package: ${pkgPath}`);
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("\n❌ ERREUR FATALE:", err.message);
  process.exit(1);
});
