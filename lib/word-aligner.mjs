import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { getFfmpegPath } from "./env.mjs";

const HOP = 0.01; // 10ms frames

/**
 * Extracts 16kHz mono s16le PCM from audio file using FFmpeg
 */
export function extractPCM(wavPath) {
  const ffmpegBin = getFfmpegPath();
  const res = spawnSync(ffmpegBin, [
    "-v", "error",
    "-i", wavPath,
    "-ac", "1",
    "-ar", "16000",
    "-f", "s16le",
    "-"
  ], { maxBuffer: 100 * 1024 * 1024 });

  if (res.status !== 0) {
    throw new Error("FFmpeg failed to extract PCM: " + res.stderr.toString());
  }

  const buf = res.stdout;
  const samples = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  return { samples, durationSeconds: samples.length / 16000 };
}

/**
 * Computes smoothed RMS energy (in dB) per 10ms frame
 */
export function computeEnvelope(samples) {
  const hopSamples = Math.floor(16000 * HOP);
  const nFrames = Math.floor(samples.length / hopSamples);
  const db = new Float32Array(nFrames);

  for (let f = 0; f < nFrames; f++) {
    let sumSq = 0;
    const offset = f * hopSamples;
    for (let i = 0; i < hopSamples; i++) {
      const val = samples[offset + i] / 32768.0;
      sumSq += val * val;
    }
    const rms = Math.sqrt(sumSq / hopSamples);
    db[f] = 20 * Math.log10(rms + 1e-6);
  }

  // 3-point moving average smoothing
  const smoothed = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    const prev = i > 0 ? db[i - 1] : db[i];
    const curr = db[i];
    const next = i < nFrames - 1 ? db[i + 1] : db[i];
    smoothed[i] = (prev + curr + next) / 3;
  }
  return smoothed;
}

/**
 * Finds speech segments separated by pauses
 */
export function findSpeechSegments(db, thresholdDb = -34.0, minGap = 0.08, minLen = 0.05) {
  const isSpeech = new Uint8Array(db.length);
  for (let i = 0; i < db.length; i++) {
    isSpeech[i] = db[i] > thresholdDb ? 1 : 0;
  }

  const rawSegs = [];
  let start = null;
  for (let i = 0; i < isSpeech.length; i++) {
    if (isSpeech[i] && start === null) start = i;
    if (!isSpeech[i] && start !== null) {
      rawSegs.push([start, i]);
      start = null;
    }
  }
  if (start !== null) rawSegs.push([start, isSpeech.length]);

  // Merge gaps smaller than minGap
  const merged = [];
  for (const [a, b] of rawSegs) {
    if (merged.length > 0 && (a - merged[merged.length - 1][1]) * HOP < minGap) {
      merged[merged.length - 1][1] = b;
    } else {
      merged.push([a, b]);
    }
  }

  return merged
    .filter(([a, b]) => (b - a) * HOP >= minLen)
    .map(([a, b]) => ({ start: a * HOP, end: b * HOP }));
}

/**
 * Aligns full script text to audio energy envelope and generates timed words
 */
export function alignWordsWithAudio({ wavPath, scenes, fullScript, outputJsonPath }) {
  const { samples, durationSeconds } = extractPCM(wavPath);
  const db = computeEnvelope(samples);
  const detectedSegs = findSpeechSegments(db);

  // If detected segments don't match scene count, map scenes proportionately over audio duration
  const wordsOut = [];
  let currentAudioTime = 0.2; // slight pre-roll

  // Total character weight
  const totalChars = scenes.reduce((acc, sc) => acc + sc.text.length, 0);
  const availableSpeechDuration = Math.max(1, durationSeconds - 0.6);

  let cumulativeTime = 0.2;

  for (let sIndex = 0; sIndex < scenes.length; sIndex++) {
    const scene = scenes[sIndex];
    const sceneFraction = scene.text.length / totalChars;
    const sceneDuration = sceneFraction * availableSpeechDuration;
    const sceneStart = cumulativeTime;
    const sceneEnd = sceneStart + sceneDuration;
    cumulativeTime = sceneEnd;

    // Split words in scene
    const rawWords = scene.text.split(/\s+/).filter(Boolean);
    const sceneCharTotal = rawWords.reduce((acc, w) => acc + Math.max(2, w.length), 0);

    let wordStart = sceneStart;
    for (let wIndex = 0; wIndex < rawWords.length; wIndex++) {
      const rawWord = rawWords[wIndex];
      const cleanWord = rawWord.replace(/[.,!?;:"'«»]/g, "");
      const isKeyword = cleanWord.toLowerCase() === (scene.keyword || "").toLowerCase();
      const wordWeight = Math.max(2, rawWord.length) / sceneCharTotal;
      const wordDuration = Math.max(0.18, wordWeight * (sceneDuration * 0.92));
      const wordEnd = wordStart + wordDuration;

      // Snap wordStart to nearest local dip in dB within +-80ms
      const centerFrame = Math.floor(wordStart / HOP);
      const searchRadius = 8; // +-80ms
      let minDipVal = Infinity;
      let bestFrame = centerFrame;
      for (let f = Math.max(0, centerFrame - searchRadius); f <= Math.min(db.length - 1, centerFrame + searchRadius); f++) {
        if (db[f] < minDipVal) {
          minDipVal = db[f];
          bestFrame = f;
        }
      }

      const snappedStart = Math.max(0.1, Number((bestFrame * HOP).toFixed(2)));
      const snappedEnd = Math.max(snappedStart + 0.12, Number((snappedStart + wordDuration).toFixed(2)));

      wordsOut.push({
        id: `w_${sIndex}_${wIndex}`,
        sceneId: scene.id,
        word: rawWord,
        clean: cleanWord,
        time: snappedStart,
        end: snappedEnd,
        isKeyword: isKeyword,
      });

      wordStart += wordDuration;
    }
  }

  // Sort by time
  wordsOut.sort((a, b) => a.time - b.time);

  if (outputJsonPath) {
    writeFileSync(outputJsonPath, JSON.stringify(wordsOut, null, 2), "utf8");
  }

  return {
    words: wordsOut,
    totalDuration: Math.ceil(durationSeconds + 1.2), // add 1.2s post-roll
  };
}
