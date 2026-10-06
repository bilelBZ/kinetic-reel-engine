import { mkdirSync, existsSync, copyFileSync, cpSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  generateStoryboard,
  synthesizeVoiceWithGemini,
  generateHeroImage,
  transcribeWords,
  probeMedia,
  getGeminiApiKey,
  artDirectionFor,
  alignTimesToScript,
} from "./gemini-ai.mjs";
import { buildTimedWords, formatDuration, writeTimingsJson } from "./word-aligner.mjs";
import {
  buildCompositionHtml,
  installRuntime,
  resolveAspect,
  ASPECTS,
} from "./composition-builder.mjs";
import {
  checkComposition,
  renderVideoToMp4,
  optimizeForMobile,
  exportCover,
  makeContactSheet,
  cleanupProject,
} from "./renderer.mjs";
import { fromRoot, slugify, projectStamp } from "./env.mjs";

/**
 * The whole pipeline in one place: one prompt in, one MP4 out.
 *
 * Used by the CLI, the Telegram bot and the GitHub Actions job so all three
 * behave identically — including progress reporting and failure handling.
 *
 * Stages:
 *   1 storyboard → 2 voiceover → 3 word timings → 4 hero art → 5 composition → 6 render
 */

export const STAGES = [
  { key: "storyboard", label: "Writing the script" },
  { key: "voice", label: "Recording the voiceover" },
  { key: "timing", label: "Synchronising word timings" },
  { key: "images", label: "Creating hero visuals" },
  { key: "composition", label: "Assembling the composition" },
  { key: "render", label: "Rendering the video" },
];

export async function produceReel({
  topic,
  duration = 30,
  voice = "Fenrir",
  style = "fares-editorial",
  speed = "standard",
  lang = null,
  aspect = "9:16",
  output = null,
  quality = "high",
  imageQuality = "high",
  taps = true,
  music = null,
  musicVolume = 0.16,
  brand = null,
  mock = false,
  skipRender = false,
  keepFrames = false,
  cover = true,
  contactSheet = false,
  outDir = null,
  onStage = () => {},
  log = console.log,
} = {}) {
  const started = Date.now();
  const canvas = resolveAspect(aspect);
  const language = lang || detectLanguage(topic);
  const projectDir = resolve(
    outDir || fromRoot("scratch"),
    `${slugify(topic)}-${projectStamp()}`,
  );
  mkdirSync(projectDir, { recursive: true });

  const assetsDir = join(projectDir, "assets");
  const audioDir = join(assetsDir, "audio");
  const imgDir = join(assetsDir, "img");
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(imgDir, { recursive: true });

  const sfxSource = fromRoot("templates/assets/audio");
  if (existsSync(sfxSource)) cpSync(sfxSource, audioDir, { recursive: true });
  installRuntime(projectDir, { log });

  const report = (key, detail) => {
    const stage = STAGES.find((s) => s.key === key);
    onStage({ key, label: stage ? stage.label : key, detail });
  };
  const apiKey = getGeminiApiKey();
  const warnings = [];

  // --- 1. Storyboard -------------------------------------------------------
  report("storyboard", `topic: ${topic}`);
  const storyboard = await generateStoryboard({
    topic,
    targetDurationSeconds: duration,
    language,
    speed,
    styleName: style,
    apiKey,
    mock,
    log,
  });
  if (storyboard.fallback) warnings.push("Storyboard fell back to the local template (Gemini unavailable).");
  writeFileSync(join(projectDir, "storyboard.json"), JSON.stringify(storyboard, null, 2), "utf8");

  // --- 2. Voiceover --------------------------------------------------------
  report("voice", `voice: ${voice}`);
  const voicePath = join(audioDir, "voice.wav");
  await synthesizeVoiceWithGemini({
    scriptText: storyboard.fullScript,
    voiceName: voice,
    language,
    styleName: style,
    apiKey,
    outputWavPath: voicePath,
    mock,
    log,
  });
  const voiceInfo = probeMedia(voicePath);
  const audioDuration = voiceInfo.duration || estimateDuration(storyboard.fullScript, speed);
  if (!voiceInfo.ok) warnings.push("Could not probe the voiceover duration — using an estimate.");

  // --- 3. Word timings -----------------------------------------------------
  // Real timestamps are the difference between "captions roughly move" and
  // "captions land on the syllable". Never silently skipped unless mock.
  report("timing", mock ? "mock" : "transcribing the generated voice");
  let timingSource = "energy-estimate";
  let words;
  let sceneRanges;
  let totalDuration;

  if (mock) {
    const timings = distributeEvenly(storyboard.fullScript, audioDuration);
    ({ words, sceneRanges, totalDuration } = buildTimedWords({
      scenes: storyboard.scenes,
      timings,
      audioDuration,
    }));
  } else {
    const scriptWords = storyboard.fullScript.trim().split(/\s+/).filter(Boolean);
    const { words: aligned, source, confidence } = await transcribeWords({
      wavPath: voicePath,
      scriptText: storyboard.fullScript,
      language,
      apiKey,
      log,
    });
    timingSource = source;
    if (source !== "gemini-transcribe") {
      warnings.push(`Word timings came from ${source} (confidence ${Math.round((confidence || 0) * 100)}%).`);
    }
    const timings = aligned.map((t) => t || { start: 0, end: 0.3 });
    ({ words, sceneRanges, totalDuration } = buildTimedWords({
      scenes: storyboard.scenes,
      timings,
      audioDuration,
      script: scriptWords.join(" "),
    }));
  }

  writeTimingsJson(join(projectDir, "words.json"), { words, sceneRanges, totalDuration, source: timingSource });

  // --- 4. Hero visuals -----------------------------------------------------
  report("images", `${storyboard.scenes.length} scenes`);
  const imageResults = [];
  for (const [index, scene] of storyboard.scenes.entries()) {
    const heroPath = join(imgDir, `${scene.hero_name}.png`);
    try {
      const result = await generateHeroImage({
        prompt: scene.hero_prompt,
        heroSearch: scene.hero_search,
        keyword: scene.keyword,
        styleName: style,
        sceneIndex: index,
        outputPngPath: heroPath,
        apiKey,
        quality: imageQuality,
        aspectRatio: "1:1",
        mock,
        log,
      });
      imageResults.push({ scene: scene.id, ...result });
      if (!result.ok) warnings.push(`Scene ${scene.id}: hero image used a placeholder.`);
    } catch (err) {
      warnings.push(`Scene ${scene.id}: hero image failed (${err.message.slice(0, 80)}).`);
      imageResults.push({ scene: scene.id, ok: false });
    }
  }

  // --- 5. Composition ------------------------------------------------------
  report("composition", `style: ${style}`);
  let musicRel = null;
  if (music && existsSync(music)) {
    musicRel = "assets/audio/music" + extnameOf(music);
    copyFileSync(music, join(projectDir, musicRel));
  } else if (music) {
    warnings.push(`Music file not found: ${music}`);
  }

  const indexPath = join(projectDir, "index.html");
  buildCompositionHtml({
    projectDir,
    title: storyboard.title,
    scenes: storyboard.scenes,
    words,
    sceneRanges,
    totalDuration,
    voiceAudioRel: "assets/audio/voice.wav",
    musicAudioRel: musicRel,
    styleName: style,
    speed,
    aspect,
    brand,
    taps,
    outputPath: indexPath,
    log,
  });

  writeFileSync(
    join(projectDir, "meta.json"),
    JSON.stringify(
      {
        id: slugify(storyboard.title || topic),
        name: storyboard.title || topic,
        topic,
        createdAt: new Date().toISOString(),
        style,
        speed,
        voice,
        language,
        aspect,
        canvas,
        duration: totalDuration,
        timingSource,
        scenes: storyboard.scenes.length,
        words: words.length,
        images: imageResults.map((r) => ({ scene: r.scene, source: r.source, ok: r.ok })),
        warnings,
      },
      null,
      2,
    ),
    "utf8",
  );

  const check = checkComposition({ projectDir, log });
  if (!check.skipped && !check.ok) {
    warnings.push(`${check.errors.length} composition check error(s) — see the log.`);
  }

  if (skipRender) {
    return {
      ok: true,
      projectDir,
      indexPath,
      storyboard,
      words,
      totalDuration,
      timingSource,
      warnings,
      skippedRender: true,
      elapsedMs: Date.now() - started,
    };
  }

  // --- 6. Render -----------------------------------------------------------
  report("render", quality);
  const rawMp4 = join(projectDir, "render.mp4");
  renderVideoToMp4({ projectDir, outputMp4Path: rawMp4, quality, log });

  const outputPath = output ? resolve(output) : join(projectDir, `${slugify(storyboard.title || topic)}.mp4`);
  const optimized = optimizeForMobile({ inputMp4: rawMp4, outputMp4: outputPath, log });
  const mp4Path = optimized.path;

  let coverPath = null;
  if (cover) {
    const coverTarget = join(projectDir, "cover.jpg");
    const result = exportCover({ mp4Path, outputPath: coverTarget, at: Math.min(0.7, totalDuration * 0.15), log });
    coverPath = result.ok ? result.path : null;
  }
  if (contactSheet) {
    makeContactSheet({ mp4Path, outputPath: join(projectDir, "contact-sheet.jpg"), log });
  }
  cleanupProject(projectDir, { keepFrames: keepFrames });

  const elapsedMs = Date.now() - started;
  log(`\n[Done] ${formatDuration(totalDuration)} reel in ${(elapsedMs / 1000).toFixed(1)}s → ${mp4Path}`);

  return {
    ok: true,
    projectDir,
    indexPath,
    mp4Path,
    coverPath,
    storyboard,
    words,
    sceneRanges,
    totalDuration,
    timingSource,
    imageResults,
    warnings,
    elapsedMs,
  };
}

function extnameOf(path) {
  const match = String(path).match(/(\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : ".mp3";
}

export function detectLanguage(topic) {
  if (/[\u0600-\u06FF]/.test(String(topic || ""))) return "Arabic";
  return "French";
}

function estimateDuration(script, speed) {
  const words = String(script || "").split(/\s+/).filter(Boolean).length;
  const wps = speed === "rapid" ? 3.1 : speed === "calm" ? 2.05 : 2.55;
  return Math.max(3, words / wps);
}

/** Even fallback timings (mock/offline only). */
function distributeEvenly(script, duration) {
  return estimateTimes(script, duration);
}

export function estimateTimes(script, duration) {
  const words = String(script || "").split(/\s+/).filter(Boolean);
  const weights = words.map((w) => Math.max(2, w.length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = 0.25;
  const usable = Math.max(0.5, duration - 0.5);
  return weights.map((weight) => {
    const share = (weight / total) * usable;
    const slot = { start: Number(cursor.toFixed(3)), end: Number((cursor + share).toFixed(3)) };
    cursor += share;
    return slot;
  });
}

export { alignTimesToScript, artDirectionFor, ASPECTS };
