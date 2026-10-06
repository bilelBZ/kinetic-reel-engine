import { writeFileSync } from "node:fs";
import { normalizeToken } from "./gemini-ai.mjs";

/**
 * Turns word-level timings into the per-word, per-scene timing model the
 * composition builder consumes.
 *
 * This is the accuracy backbone of the whole video: if a caption fires early or
 * late, the edit feels amateur no matter how good the art is. Timings come from
 * a real transcriber (see gemini-ai.mjs → transcribeWords); this module owns
 * scene boundaries, keyword matching, monotonicity and clamping.
 */

const MIN_SCENE_SECONDS = 0.9;
const MAX_PRE_ROLL = 0.45;
const MIN_PRE_ROLL = 0.06;
const MIN_TAIL = 0.35;
const MAX_TAIL = 1.6;

/**
 * @param {object}   args
 * @param {Array}    args.scenes        storyboard scenes (id, text, keyword)
 * @param {Array}    args.timings       per script-word {start,end}, same order as the script
 * @param {number}   args.audioDuration measured voiceover length in seconds
 * @param {string}   [args.script]      optional explicit script (defaults to scene texts joined)
 */
export function buildTimedWords({ scenes, timings, audioDuration, script }) {
  const scriptText = script || scenes.map((s) => s.text || "").join(" ");
  const tokens = scriptText.split(/\s+/).filter(Boolean);

  // Distribute tokens across scenes using each scene's own word count, so we
  // never rely on "scenes are equal length" assumptions.
  const perScene = scenes.map((scene) => ({
    scene,
    count: String(scene.text || "").split(/\s+/).filter(Boolean).length,
  }));

  const words = [];
  let tokenIndex = 0;
  for (const { scene, count } of perScene) {
    const keywordTokens = [];
    for (let i = 0; i < count && tokenIndex < tokens.length; i++, tokenIndex++) {
      const raw = tokens[tokenIndex];
      const timing = timings[tokenIndex] || null;
      const clean = raw.replace(/[.,!?;:"'«»()\[\]]/g, "");
      keywordTokens.push(clean);
      words.push({
        id: `w_${scene.id}_${i}`,
        sceneId: scene.id,
        index: tokenIndex,
        word: raw,
        clean,
        norm: normalizeToken(clean),
        time: timing ? round(timing.start) : null,
        end: timing ? round(timing.end) : null,
        isKeyword: false,
      });
    }
    // Keyword match against the scene's own tokens (handles 1-2 word keywords).
    const keyword = String(scene.keyword || "").trim();
    if (keyword) {
      const keyNorms = keyword.split(/\s+/).map(normalizeToken).filter(Boolean);
      const sceneWords = words.filter((w) => w.sceneId === scene.id);
      for (let i = 0; i < sceneWords.length; i++) {
        const window = sceneWords.slice(i, i + keyNorms.length).map((w) => w.norm);
        if (keyNorms.length && window.length === keyNorms.length && window.every((n, k) => n === keyNorms[k])) {
          sceneWords[i].isKeyword = true;
          if (keyNorms.length > 1 && sceneWords[i + 1]) sceneWords[i + 1].isKeyword = true;
        }
      }
      // Fallback: emphasise the strongest single word if the keyword drifted.
      if (!words.some((w) => w.sceneId === scene.id && w.isKeyword) && sceneWords.length) {
        const best = sceneWords
          .filter((w) => w.norm.length > 2)
          .sort((a, b) => b.norm.length - a.norm.length)[0] || sceneWords[0];
        best.isKeyword = true;
      }
    }
  }

  repairTimings(words, audioDuration);

  const sceneRanges = deriveSceneRanges(words, scenes, audioDuration);
  const tail = computeTail(audioDuration);
  return {
    words,
    sceneRanges,
    totalDuration: round(audioDuration + tail),
    audioDuration,
  };
}

/** Ensure every word has a sane, monotonic slot inside the audio. */
function repairTimings(words, audioDuration) {
  let lastEnd = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.time === null || word.end === null || !Number.isFinite(word.time)) {
      // Interpolate from the nearest known neighbours.
      const prev = words.slice(0, i).reverse().find((w) => w.time !== null);
      const next = words.slice(i + 1).find((w) => w.time !== null);
      const guess = prev ? prev.end : next ? Math.max(0, next.time - 0.3) : 0.15;
      word.time = round(guess);
      word.end = round(guess + 0.3);
    }
    if (word.time < lastEnd) word.time = round(lastEnd);
    if (word.end <= word.time) word.end = round(word.time + Math.min(0.35, Math.max(0.09, word.clean.length * 0.055)));
    word.time = round(Math.max(0, word.time));
    word.end = round(Math.min(audioDuration, word.end));
    if (word.end <= word.time) word.end = round(word.time + 0.12);
    lastEnd = word.end;
  }
}

/** Scene in/out points derived from real speech, not from an even split. */
export function deriveSceneRanges(words, scenes, audioDuration) {
  const lastSceneId = scenes[scenes.length - 1]?.id;
  const ranges = [];
  return scenes.map((scene, index) => {
    const sceneWords = words.filter((w) => w.sceneId === scene.id);
    const first = sceneWords[0];
    const last = sceneWords[sceneWords.length - 1];
    // A cut must never land on top of the previous scene's last word.
    const previousRange = index > 0 ? ranges[index - 1] : null;
    const previousLastEnd = index > 0
      ? (words.filter((w) => w.sceneId === scenes[index - 1].id).at(-1)?.end ?? 0)
      : 0;
    const naturalStart = Math.max(0, round((first ? first.time : 0) - preRollFor(first ? first.time : 0)));
    const start = index === 0
      ? 0
      : Math.max(naturalStart, previousLastEnd + 0.04, previousRange ? previousRange.startTime + 0.3 : 0);
    let end;
    if (scene.id === lastSceneId) {
      end = round(audioDuration + computeTail(audioDuration));
    } else {
      const nextScene = scenes[index + 1];
      const nextWords = words.filter((w) => w.sceneId === nextScene.id);
      const nextStart = nextWords[0] ? nextWords[0].time : (first ? first.time : 0) + 1;
      // Cut just after the last word of this scene, before the next one starts.
      const lastEnd = last ? last.end : nextStart - 0.2;
      end = round(Math.min(nextStart - 0.02, lastEnd + 0.22));
      if (last && last.end > end) end = round(last.end + 0.02);
      if (end - start < MIN_SCENE_SECONDS) end = round(start + MIN_SCENE_SECONDS);
      if (end > nextStart) end = round(nextStart);
    }
    const range = { id: scene.id, index, startTime: start, endTime: Math.max(end, start + 0.4) };
    ranges.push(range);
    return range;
  });
}

/** Long pauses between scenes deserve a longer beat; tight cuts need a shorter one. */
function preRollFor(firstWordTime) {
  return Math.max(MIN_PRE_ROLL, Math.min(MAX_PRE_ROLL, firstWordTime * 0.35));
}

function computeTail(audioDuration) {
  return Math.max(MIN_TAIL, Math.min(MAX_TAIL, audioDuration * 0.04 + 0.3));
}

function round(value) {
  return Number(Number(value).toFixed(3));
}

/** Human-readable duration of the rendered timeline. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Persist the timing model next to the project for debugging/inspection. */
export function writeTimingsJson(path, payload) {
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}
