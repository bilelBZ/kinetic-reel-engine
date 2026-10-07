import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { getFfmpegPath, getFfprobePath, run, readEnvKey } from "./env.mjs";
import { writeGradientPlate } from "./png.mjs";
import {
  SCENE_TONES,
  planDelivery,
  buildSpokenLine,
  cleanSpokenText,
  styleForTone,
  estimateLineSeconds,
} from "./voice-direction.mjs";

/**
 * Google AI Studio (Gemini API) integration — the quality-critical half of the engine.
 *
 *   Text      : storyboard / hook / art direction      gemini-3.8-flash
 *   Speech    : voiceover with style annotations       gemini-3.8-flash-tts
 *   Images    : hero art (isolated or editorial)       gemini-3-pro-image / nano-banana
 *   Timestamps: word-level alignment of the voiceover  gemini-3.5-transcribe
 *
 * Every call degrades gracefully: an unavailable model rotates to the next one,
 * and a hard failure falls back to a deterministic local result so a render
 * always reaches the MP4 stage.
 */

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const INTERACTIONS_URL = `${GEMINI_BASE}/interactions`;

/** Curated model ladders, best first. Verified against the model list (2026-10). */
export const GEMINI_TEXT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
];

export const GEMINI_TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-2.5-pro-preview-tts",
  "gemini-2.5-flash-preview-tts",
];

export const GEMINI_IMAGE_MODELS = [
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
  "gemini-nano-banana-2.1",
  "gemini-2.5-flash-image",
];

export const GEMINI_FAST_IMAGE_MODEL = "gemini-3.1-flash-image";
export const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

/** BCP-47 codes for the transcription model (word timestamps). */
const LANGUAGE_CODES = {
  french: "fr-FR", francais: "fr-FR", français: "fr-FR",
  english: "en-US", anglais: "en-US",
  arabic: "ar", arabe: "ar",
  spanish: "es-ES", espagnol: "es-ES",
  german: "de-DE", allemand: "de-DE",
  italian: "it-IT", italien: "it-IT",
  portuguese: "pt-BR", portugais: "pt-BR",
  dutch: "nl-NL", turkish: "tr-TR", russian: "ru-RU",
  hindi: "hi-IN", japanese: "ja-JP", korean: "ko-KR",
  chinese: "zh-CN", mandarin: "zh-CN",
};

export function languageCode(language) {
  if (!language) return undefined;
  return LANGUAGE_CODES[String(language).toLowerCase().trim()];
}

/** Resolve the API key from explicit argument, env, or a .env file. */
export function getGeminiApiKey(explicitKey) {
  if (explicitKey && explicitKey.trim()) return explicitKey.trim();
  return readEnvKey(["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geminiFetch(url, { apiKey, body, method = "POST", timeoutMs = 120000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        // Header auth keeps the key out of URLs, logs and error traces.
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Stage 1 — Storyboard
// ---------------------------------------------------------------------------

/** Words per second of speech, per pace preset (measured on French/English TTS). */
export const PACE = {
  calm: { wps: 2.05, sceneSeconds: 4.2, label: "calm, deliberate, cinematic" },
  standard: { wps: 2.55, sceneSeconds: 3.5, label: "energetic editorial" },
  rapid: { wps: 3.1, sceneSeconds: 2.2, label: "rapid, snappy, punchy" },
};

export function paceFor(speed) {
  return PACE[String(speed || "standard").toLowerCase()] || PACE.standard;
}

/** Art direction per style — drives both the prompt and the image model. */
export const ART_DIRECTION = {
  "fares-editorial": {
    mode: "isolated",
    subjectStyle:
      "a single hero object rendered as an isolated 3D product visual: dramatic rim lighting, glossy reflections, floating with soft contact shadow, deep near-black background",
    palette: "obsidian black with an electric crimson accent light",
    avoid: "no text, no watermark, no collage, no busy background, no human faces",
  },
  "minimal-luxury": {
    mode: "isolated",
    subjectStyle:
      "a single luxury artifact photographed as an isolated studio product shot: warm soft-box lighting, subtle reflections, floating with a diffuse shadow, rich charcoal background",
    palette: "velvet charcoal with warm gold accent light",
    avoid: "no text, no watermark, no collage, no clutter, no human faces",
  },
  "cyber-matrix": {
    mode: "isolated",
    subjectStyle:
      "a single futuristic object rendered in 3D with volumetric neon light: sharp specular highlights, holographic edge glow, floating over a dark technical grid",
    palette: "deep navy with cyan neon accent light",
    avoid: "no text, no watermark, no collage, no human faces",
  },
  "swiss-editorial": {
    mode: "editorial",
    subjectStyle:
      "one clean documentary photograph of a single real object, shot straight-on on a plain seamless studio background with soft even light, minimal composition with generous negative space",
    palette: "warm cream background with a strong red accent",
    avoid: "no text, no watermark, no collage, no crowds, no cluttered shelves, no hands",
  },
};

export function artDirectionFor(styleName) {
  return ART_DIRECTION[styleName] || ART_DIRECTION["fares-editorial"];
}

function stripDashes(name) {
  return String(name || "").replace(/-editorial|-matrix|^fares$/g, "") || "editorial";
}

/**
 * Stage 1 — one prompt in, a shot-by-shot storyboard out.
 * Enforces hook engineering, word budget (for duration accuracy), keyword rules
 * and style-aware art direction.
 */
export async function generateStoryboard({
  topic,
  targetDurationSeconds = 30,
  language = "French",
  speed = "standard",
  styleName = "fares-editorial",
  apiKey,
  mock = false,
  log = console.log,
}) {
  const key = getGeminiApiKey(apiKey);
  const pace = paceFor(speed);
  const art = artDirectionFor(styleName);
  const sceneCount = Math.max(4, Math.min(12, Math.round(targetDurationSeconds / pace.sceneSeconds)));
  const wordBudget = Math.max(18, Math.round(targetDurationSeconds * pace.wps));
  const wordsPerScene = Math.max(4, Math.round(wordBudget / sceneCount));

  if (mock) {
    log("[Storyboard] mock mode — using deterministic local storyboard");
    return localFallbackStoryboard({ topic, targetDurationSeconds, language, speed, styleName, sceneCount });
  }
  if (!key) throw new Error("GEMINI_API_KEY is required to generate the storyboard.");

  const systemInstruction = `You are an award-winning creative director who writes viral vertical short-form video (TikTok / Reels / Shorts) in the "kinetic editorial" genre.

You are writing ONE 9:16 video for the topic the user gives you.

STRUCTURE (non-negotiable)
1. Scene 1 is the HOOK: 3-6 words, a pattern interrupt, a bold claim, a number or a question. Never a greeting, never a definition, never "in this video".
2. Middle scenes escalate: one idea per scene, each building on the last. Specific beats general.
3. The final scene is a payoff or a one-line call to action in the imperative.

WRITING RULES
- Write every line in ${language}. Do not mix languages (proper nouns and brand names are fine).
- Speak to one person. Short sentences. Concrete nouns and real numbers.
- BANNED words: "welcome", "in this video", "let's dive in", "discover", "amazing", "revolutionary", "game-changer", "unlock", "elevate", "delve", "journey".
- Do not use emoji, hashtags, markdown, or stage directions.
- TOTAL WORD BUDGET: about ${wordBudget} words for the whole script (~${wordsPerScene} per scene). This is how the video lands near ${targetDurationSeconds}s. Going over means the voiceover runs long; going under leaves dead air.
- Pace: ${pace.label} — ${sceneCount} scenes of roughly ${pace.sceneSeconds}s each.

SCENES
- Each scene has ONE text line of ${wordsPerScene}-${wordsPerScene + 4} words.
- Each scene has exactly ONE "keyword": 1-2 words, ALL CAPS, and it MUST appear verbatim (case-insensitive) inside that scene's "text". Put the keyword where a real speaker would stress it.

VISUAL DIRECTION (this is what makes the video look expensive)
- One hero object per scene — always a REAL, TANGIBLE, PHYSICAL thing a camera could photograph.
- Vary the objects across scenes; never repeat the same subject twice.
- "hero_search": 2-3 ENGLISH words naming the object, e.g. "golden hourglass", "brass compass", "espresso machine", "carbon fiber bicycle".
- "hero_prompt": one English sentence describing the shot. Always: ${art.subjectStyle}. Always: ${art.palette}. Always: ${art.avoid}.
- FORBIDDEN hero subjects: text, documents, books, screenshots, charts, diagrams, logos, maps, flags, manuscripts, collections of many objects.

OUTPUT
Return ONLY valid JSON. No markdown fences, no commentary.`;

  const userPrompt = `Topic: ${topic}

Return this exact JSON shape:
{
  "topic": ${JSON.stringify(topic)},
  "language": ${JSON.stringify(language)},
  "targetDuration": ${targetDurationSeconds},
  "title": "short punchy title (max 6 words)",
  "hook": "the exact hook line from scene 1",
  "fullScript": "every scene's text joined in order, separated by spaces — this is passed verbatim to the text-to-speech engine",
  "scenes": [
    {
      "id": 1,
      "theme": "dark",
      "badge": "01 / HOOK",
      "text": "the spoken line for this scene",
      "keyword": "ONE KEYWORD FROM THE LINE",
      "hero_name": "hero_1",
      "hero_title": "2-3 word name of the object",
      "hero_search": "english object name",
      "hero_prompt": "isolated 3d render of ... , dark background, cinematic lighting, no text",
      "sfx": "slam",
      "motion": "zoom-in",
      "transition": "soft-wipe",
      "tone": "hook",
      "beat": "none"
    }
  ]
}

Rules for the JSON: exactly ${sceneCount} scenes; ids 1..${sceneCount}; "hero_name" is always "hero_<id>";
alternate "theme" between "dark" and "light" so cuts feel rhythmic;
"sfx" is one of: slam, whoosh, impact, click, riser, none;
"motion" is one of: zoom-in, zoom-out, slide-left, slide-right, parallax;
"transition" is one of: soft-wipe, whip, crossfade, hard-cut;
"tone" is how the narrator performs the line, one of: ${SCENE_TONES.join(", ")};
"beat" is one of: none, breath, pause.

HOW THE LINES ARE SPOKEN (this drives the voiceover take):
- "text" is a verbatim spoken transcript. It must contain only words the narrator says out loud.
  Never write stage directions, bracketed notes, speaker labels or emoji into it.
- "tone" is the only place to say how a line is delivered. Move up and down the arc across the
  scenes — a reel where every line is "hype" sounds like an advert and gets scrolled past.
- "beat" asks for one audible breath or short pause inside a line. Use "breath" or "pause" on at
  most two scenes out of ${sceneCount}, on lines long enough to carry one. "none" everywhere else.
- "keyword" is capitalised in the transcript, which is how the narrator is told to stress it, so it
  must be a word that genuinely earns the stress — never a filler word.`;

  let lastError = null;
  for (const model of GEMINI_TEXT_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await geminiFetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
        apiKey: key,
        body: {
          contents: [{ role: "user", parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.9,
            maxOutputTokens: 4096,
          },
        },
      });

      if (res.status === 503 || res.status === 429) {
        lastError = `${model} ${res.status}`;
        await sleep(1500);
        continue;
      }
      if (!res.ok) {
        lastError = `${model}: ${res.status} ${String(res.text).slice(0, 180)}`;
        break;
      }

      const raw = res.json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") || "";
      const parsed = parseJsonLoose(raw);
      if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length) {
        log(`[Storyboard] ${model} → "${parsed.title}" (${parsed.scenes.length} scenes)`);
        return normalizeStoryboard(parsed, { topic, language, targetDurationSeconds, styleName, sceneCount });
      }
      lastError = `${model}: unparseable JSON`;
      break;
    }
  }

  log(`[Storyboard] all models failed (${lastError.slice(0, 120)}) — using the local storyboard`);
  return localFallbackStoryboard({ topic, targetDurationSeconds, language, speed, styleName, sceneCount });
}

/** Tolerant JSON extraction (handles fences, leading prose, trailing commas). */
function parseJsonLoose(text) {
  if (!text) return null;
  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);
  for (const candidate of candidates) {
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        const parsed = JSON.parse(attempt.trim());
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        /* try the next candidate */
      }
    }
  }
  return null;
}

/** Guarantee the invariants the rest of the pipeline relies on. */
function normalizeStoryboard(raw, { topic, language, targetDurationSeconds, styleName, sceneCount }) {
  const art = artDirectionFor(styleName);
  const scenes = (raw.scenes || []).slice(0, sceneCount).map((scene, index) => {
    const id = index + 1;
    const text = String(scene.text || "").trim();
    let keyword = String(scene.keyword || "").trim();
    // The keyword must actually appear in the line, otherwise nothing gets emphasised.
    if (!keyword || !text.toLowerCase().includes(keyword.toLowerCase())) {
      keyword = pickKeyword(text);
    }
    return {
      id,
      theme: scene.theme === "light" ? "light" : index % 2 === 0 ? "dark" : "light",
      badge: scene.badge || `${String(id).padStart(2, "0")} / SCENE`,
      text,
      keyword,
      hero_name: `hero_${id}`,
      hero_title: String(scene.hero_title || "").trim() || `Object ${id}`,
      hero_search: String(scene.hero_search || "").trim(),
      hero_prompt:
        String(scene.hero_prompt || "").trim() ||
        `isolated 3d render of ${scene.hero_search || "a sculptural object"}, ${art.subjectStyle}, ${art.palette}, ${art.avoid}`,
      sfx: ["slam", "whoosh", "impact", "click", "riser", "none"].includes(scene.sfx) ? scene.sfx : "click",
      motion: ["zoom-in", "zoom-out", "slide-left", "slide-right", "parallax"].includes(scene.motion)
        ? scene.motion
        : "zoom-in",
      transition: ["soft-wipe", "whip", "crossfade", "hard-cut"].includes(scene.transition)
        ? scene.transition
        : "soft-wipe",
      // Delivery is validated here, not trusted: an unknown tone would reach the
      // TTS engine as a meaningless style string. When absent, planDelivery
      // derives one from the scene's position in the arc.
      tone: SCENE_TONES.includes(String(scene.tone || "").trim().toLowerCase())
        ? String(scene.tone).trim().toLowerCase()
        : undefined,
      beat: ["none", "breath", "pause"].includes(String(scene.beat || "").trim().toLowerCase())
        ? String(scene.beat).trim().toLowerCase()
        : "none",
    };
  });

  const fullScript =
    String(raw.fullScript || "").trim() || scenes.map((s) => s.text).join(" ");

  return {
    topic: raw.topic || topic,
    language: raw.language || language,
    targetDuration: targetDurationSeconds,
    title: String(raw.title || topic).slice(0, 80),
    hook: String(raw.hook || scenes[0]?.text || "").trim(),
    styleName,
    art,
    fullScript,
    scenes,
  };
}

/** Longest non-stopword from a line — used when the model's keyword is unusable. */
function pickKeyword(text) {
  const stop = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are",
    "was", "were", "it", "this", "that", "you", "your", "le", "la", "les", "un", "une", "des",
    "de", "du", "et", "ou", "en", "au", "aux", "ce", "cette", "il", "elle", "on", "nous",
    "vous", "ils", "elles", "est", "sont", "pas", "plus", "que", "qui", "dans", "sur", "في",
    "من", "على", "إلى", "عن", "هذا", "هذه", "التي", "الذي",
  ]);
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const candidates = words
    .map((w) => w.replace(/[.,!?;:"'«»()]/g, ""))
    .filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  if (!candidates.length) return words[0] || "NOW";
  return candidates.sort((a, b) => b.length - a.length)[0].toUpperCase();
}

/**
 * Deterministic offline storyboard. Not a quality path — a floor that keeps
 * `--mock` runs, tests and outages producing a complete, renderable video.
 */
export function localFallbackStoryboard({
  topic,
  targetDurationSeconds = 30,
  language = "French",
  styleName = "fares-editorial",
  speed = "standard",
  sceneCount = 6,
}) {
  const art = artDirectionFor(styleName);
  const clean = String(topic || "your idea")
    .replace(/^[Ff]ais[- ]moi un reel (?:de \d+s )?sur /i, "")
    .replace(/^[Cc]reate a reel about /i, "")
    .trim();
  const isArabic = /[\u0600-\u06FF]/.test(clean);
  const title = clean.split(/\s+/).slice(0, 6).join(" ");

  const subjects = [
    ["brass compass", "a weathered brass compass"],
    ["crystal prism", "a faceted crystal prism"],
    ["pocket watch", "a vintage pocket watch"],
    ["golden hourglass", "a golden hourglass"],
    ["telescope lens", "a precision telescope lens"],
    ["architectural model", "a white architectural model"],
    ["espresso machine", "a polished espresso machine"],
    ["carbon fiber bicycle", "a carbon fiber bicycle frame"],
  ];

  // Lines are written to the scene's word budget so a fallback reel still lands
  // near the requested duration instead of finishing 30% short.
  const budget = Math.max(24, Math.round(targetDurationSeconds * paceFor(speed).wps));
  const perScene = Math.max(5, Math.round(budget / sceneCount));

  const templates = isArabic
    ? [
        `${clean}.`,
        "الحقيقة أن أحداً لا يشرح لك هذا الجزء من الموضوع",
        "التفاصيل الصغيرة هي التي تصنع الفرق الحقيقي",
        "الأرقام لا تكذب أبداً عندما تنظر إليها بعناية",
        "معظم الناس يتوقفون قبل الخطوة التي تغير النتيجة",
        "الخبر الجيد أن الطريقة واضحة إذا عرفت من أين تبدأ",
        "ابدأ بخطوة واحدة اليوم وسترى الفرق بعد أسبوع",
        "الجودة تأتي من التكرار وليس من الحظ",
      ]
    : [
        `${clean}.`,
        "Almost nobody explains this part of the story properly",
        "The small details are what actually make the difference",
        "The numbers never lie once you look at them closely",
        "Most people stop right before the step that changes everything",
        "The good news is the method is simple to copy",
        "Start with one small step today and measure the result",
        "Quality comes from repetition, not from luck",
        "That single decision is worth more than any shortcut",
      ];

  /** Keep a template close to the scene's word budget without cutting mid-idea. */
  const fitLine = (line) => {
    const words = line.split(/\s+/);
    if (words.length <= perScene + 4) return line;
    return words.slice(0, perScene + 4).join(" ").replace(/[,،]$/, "");
  };

  const scenes = Array.from({ length: sceneCount }, (_, index) => {
    const [search, title_] = subjects[index % subjects.length];
    const text = fitLine(templates[index % templates.length]);
    return {
      id: index + 1,
      theme: index % 2 === 0 ? "dark" : "light",
      badge: `${String(index + 1).padStart(2, "0")} / SCENE`,
      text,
      keyword: pickKeyword(text),
      hero_name: `hero_${index + 1}`,
      hero_title: title_,
      hero_search: search,
      hero_prompt: `isolated 3d render of ${title_}, ${art.subjectStyle}, ${art.palette}, ${art.avoid}`,
      sfx: index === 0 ? "slam" : index % 3 === 1 ? "whoosh" : "click",
      motion: index % 2 === 0 ? "zoom-in" : "slide-left",
      transition: "soft-wipe",
    };
  });

  return {
    topic: clean,
    language: isArabic ? "Arabic" : language,
    targetDuration: targetDurationSeconds,
    title,
    hook: scenes[0].text,
    styleName,
    art,
    fullScript: scenes.map((s) => s.text).join(" "),
    scenes,
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — Voiceover (Gemini TTS via the Interactions API)
// ---------------------------------------------------------------------------

/**
 * Voice direction.
 *
 * Turn-level delivery lives in `speech_metadata.style`. Per-scene emotion is
 * only reachable by splitting the script into one turn per scene and giving
 * each turn its own *short* style string — the model cannot shift prosody
 * inside a single turn, and long style blocks are the documented cause of
 * voice drift. Everything about how a line is performed is decided in
 * voice-direction.mjs; this file only talks to the API.
 */

/** Raw PCM parameters used for multi-turn synthesis. */
const VOICE_PCM_RATE = 24000;
const PCM_BYTES_PER_MS = (VOICE_PCM_RATE * 2) / 1000; // s16le mono
const VOICES_URL = `${GEMINI_BASE}/voices`;
const INTERACTIONS_TIMEOUT_MS = 180000;

/** Minimal RIFF wrapper so ffmpeg can read concatenated PCM. */
function wavFromPcm(pcm, sampleRate = VOICE_PCM_RATE, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bits) / 8, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * We ask for headerless `audio/l16`, but a WAV body would silently corrupt a
 * concatenation — 44 bytes of RIFF header read as samples is an audible click —
 * so the header is stripped defensively either way.
 */
function toRawPcm(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") return buffer;
  const at = buffer.indexOf("data", 12, "ascii");
  return at === -1 ? buffer.subarray(44) : buffer.subarray(at + 8);
}

const pcmSilence = (ms) => Buffer.alloc(Math.max(0, Math.round(ms * PCM_BYTES_PER_MS)));

/** Bounded-concurrency map: enough parallelism to hide latency, not enough to trip 429s. */
async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * One turn of speech → raw 24 kHz PCM.
 * Rotates through the TTS ladder on 503/429 exactly like the single-turn path.
 */
async function synthesizeTurn({ text, style, voiceName, apiKey }) {
  let lastError = "";
  for (const model of GEMINI_TTS_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await geminiFetch(INTERACTIONS_URL, {
        apiKey,
        timeoutMs: INTERACTIONS_TIMEOUT_MS,
        body: {
          model,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text,
                  // Sustained delivery only. An empty style is valid, and often
                  // better: the voice reference already carries identity.
                  ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}),
                },
              ],
            },
          ],
          response_format: { type: "audio", mime_type: "audio/l16", sample_rate: VOICE_PCM_RATE },
          generation_config: { speech_config: [{ voice: voiceName }] },
          store: false,
        },
      });

      if (res.status === 503) {
        lastError = `${model}: 503 high demand`;
        await sleep(2000);
        continue;
      }
      if (res.status === 429) {
        lastError = `${model}: 429 quota`;
        break;
      }
      if (!res.ok) {
        lastError = `${model}: ${res.status} ${String(res.text).slice(0, 160)}`;
        break;
      }

      const audioParts = (res.json?.steps || [])
        .filter((step) => step.type === "model_output")
        .flatMap((step) => step.content || [])
        .filter((part) => part.type === "audio" && part.data);
      const audioPart = audioParts[audioParts.length - 1];
      if (!audioPart) {
        lastError = `${model}: response contained no audio`;
        break;
      }
      return { pcm: toRawPcm(Buffer.from(audioPart.data, "base64")), model };
    }
  }
  throw new Error(lastError || "no TTS model produced audio");
}

/**
 * Browse the Extended Voice Library — hundreds of voices carrying language,
 * accent, pitch and domain metadata. This is how a French reel gets a French
 * voice instead of an English prebuilt one reading French text.
 */
export async function listVoices({
  apiKey,
  language,
  accent,
  gender,
  pitch,
  persona,
  context,
  search,
  type = "prebuilt",
  pageSize = 50,
  log = console.log,
} = {}) {
  const key = getGeminiApiKey(apiKey);
  if (!key) throw new Error("GEMINI_API_KEY is required to browse voices.");

  const params = new URLSearchParams();
  const add = (name, value) => {
    for (const item of [].concat(value || [])) if (item) params.append(name, String(item));
  };
  add("language_code", language);
  add("accent", accent);
  add("gender", gender);
  add("pitch", pitch);
  add("persona", persona);
  add("context", context);
  add("type", type);
  if (search) params.set("search", String(search));
  params.set("page_size", String(pageSize));

  const res = await geminiFetch(`${VOICES_URL}?${params.toString()}`, { apiKey: key, method: "GET" });
  if (!res.ok) throw new Error(`Voice library unavailable: ${res.status} ${String(res.text).slice(0, 160)}`);

  const voices = (res.json?.voices || []).map((voice) => ({
    id: voice.id || String(voice.name || "").split("/").pop() || "",
    name: voice.display_name || voice.displayName || "",
    language: voice.language_code || voice.languageCode || "",
    accent: voice.accent || "",
    gender: voice.gender || "",
    pitch: voice.pitch || "",
    description: voice.description || "",
  }));
  log(`[Voice] ${voices.length} voice(s) matched`);
  return voices;
}

/**
 * Stage 2 — synthesize the voiceover.
 *
 *   "scene"  one turn per scene, each with its own tone, joined with deliberate
 *            silence. The only way to get per-scene emotion.
 *   "single" one turn for the whole script. Cheaper and immune to join
 *            artefacts, but emotionally flat.
 *
 * Both modes produce the same canonical 48 kHz mono WAV, so transcription,
 * alignment, composition and rendering are unaffected by the choice.
 */
export async function synthesizeVoiceWithGemini({
  scriptText,
  scenes = null,
  voiceName = "Fenrir",
  language = "French",
  styleName = "fares-editorial",
  delivery = "scene",
  pauseScale = 1,
  apiKey,
  outputWavPath,
  mock = false,
  log = console.log,
}) {
  mkdirSync(dirname(outputWavPath), { recursive: true });

  const plan = scenes?.length ? planDelivery({ scenes, styleName, pauseScale }) : null;
  const plainText = cleanSpokenText(scriptText);
  if (!plan && !plainText) throw new Error("Cannot synthesize an empty voiceover script.");

  if (mock) {
    const seconds = plan
      ? plan.segments.reduce((acc, s) => acc + estimateLineSeconds(s.spoken) + s.gapAfterMs / 1000, 0)
      : Math.max(4, Math.round(plainText.split(/\s+/).length / 2.5) + 1);
    log(`[Voice] mock mode — writing a ${seconds.toFixed(1)}s silent placeholder track`);
    writeSilentWav(outputWavPath, seconds);
    return { ok: true, path: outputWavPath, voice: voiceName, mock: true, delivery: plan ? delivery : "single" };
  }

  const key = getGeminiApiKey(apiKey);
  if (!key) throw new Error("GEMINI_API_KEY is required for the voiceover.");

  const warnings = plan ? [...plan.warnings] : [];
  for (const warning of warnings) log(`[Voice] ⚠ ${warning}`);

  // --- per-scene turns -----------------------------------------------------
  if (plan && delivery === "scene" && plan.segments.length) {
    try {
      const parts = await mapPool(plan.segments, 3, (segment) =>
        synthesizeTurn({ text: segment.spoken, style: segment.style, voiceName, apiKey: key })
      );

      const chunks = [];
      const offsets = [];
      let cursorMs = 0;
      parts.forEach((part, index) => {
        const segment = plan.segments[index];
        offsets.push({
          id: segment.id,
          tone: segment.tone,
          style: segment.style,
          startMs: Math.round(cursorMs),
        });
        chunks.push(part.pcm);
        cursorMs += part.pcm.length / PCM_BYTES_PER_MS;
        if (segment.gapAfterMs > 0) {
          chunks.push(pcmSilence(segment.gapAfterMs));
          cursorMs += segment.gapAfterMs;
        }
      });

      const sourcePath = `${outputWavPath}.source`;
      writeFileSync(sourcePath, wavFromPcm(Buffer.concat(chunks)));
      normalizeAudio(sourcePath, outputWavPath, log);
      log(
        `[Voice] ✓ ${plan.segments.length} scene turns (voice: ${voiceName}, ` +
          `${(cursorMs / 1000).toFixed(1)}s, model: ${parts[0]?.model})`
      );
      return {
        ok: true,
        path: outputWavPath,
        voice: voiceName,
        model: parts[0]?.model,
        delivery: "scene",
        segments: offsets,
        warnings,
      };
    } catch (error) {
      const reason = String(error?.message || error).slice(0, 140);
      log(`[Voice] per-scene delivery failed (${reason}) — falling back to a single turn`);
      warnings.push("Per-scene delivery failed; the voiceover was synthesized in one turn.");
    }
  }

  // --- single turn ---------------------------------------------------------
  // Keep the per-scene transcript craft (emphasis + inline pauses) even here:
  // they are turn-independent, so a flat read still gets its beats right.
  const spokenText = plan?.segments?.length
    ? plan.segments.map((s) => s.spoken).filter(Boolean).join(" ")
    : plainText;

  const tally = new Map();
  for (const segment of plan?.segments || []) {
    tally.set(segment.tone, (tally.get(segment.tone) || 0) + 1);
  }
  const dominantTone = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const style = styleForTone(dominantTone, styleName);
  const annotation = { type: "speech_metadata", style };
  const payload = (model) => ({
    model,
    input: [
      {
        type: "user_input",
        content: [{ type: "text", text: spokenText, annotations: [annotation] }],
      },
    ],
    response_format: { type: "audio", mime_type: "audio/wav" },
    generation_config: { speech_config: [{ voice: voiceName }] },
    store: false,
  });

  let lastError = "";
  for (const model of GEMINI_TTS_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await geminiFetch(INTERACTIONS_URL, {
        apiKey: key,
        body: payload(model),
        timeoutMs: INTERACTIONS_TIMEOUT_MS,
      });

      if (res.status === 503) {
        lastError = `${model}: 503 high demand`;
        await sleep(2000);
        continue;
      }
      if (res.status === 429) {
        lastError = `${model}: 429 quota`;
        log(`[Voice] ${model} quota reached — rotating model`);
        break;
      }
      if (!res.ok) {
        lastError = `${model}: ${res.status} ${String(res.text).slice(0, 200)}`;
        break;
      }

      const audioParts = (res.json?.steps || [])
        .filter((step) => step.type === "model_output")
        .flatMap((step) => step.content || [])
        .filter((part) => part.type === "audio" && part.data);
      const audioPart = audioParts[audioParts.length - 1];
      if (!audioPart) {
        lastError = `${model}: response contained no audio`;
        break;
      }

      const rawBytes = Buffer.from(audioPart.data, "base64");
      const tempPath = `${outputWavPath}.source`;
      writeFileSync(tempPath, rawBytes);
      normalizeAudio(tempPath, outputWavPath, log);
      log(`[Voice] ✓ single turn (voice: ${voiceName}, style: ${style}, model: ${model})`);
      return { ok: true, path: outputWavPath, voice: voiceName, model, delivery: "single", warnings };
    }
  }

  throw new Error(`Voice synthesis failed on all models. Last error → ${lastError}`);
}

/** FFmpeg transcode to the canonical 48 kHz mono WAV the rest of the pipeline expects. */
function normalizeAudio(inputPath, outputPath, log) {
  const ffmpeg = getFfmpegPath();
  const probe = run(getFfprobePath(), [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,channels,codec_name",
    "-of", "default=nw=1", inputPath,
  ]);
  const isWav = /\.wav$/i.test(inputPath) && /sample_rate=48000/.test(probe.stdout) && /channels=1/.test(probe.stdout);
  if (isWav) {
    // Already canonical — avoid a pointless re-encode.
    writeFileSync(outputPath, readFileSync(inputPath));
    return outputPath;
  }

  const res = run(ffmpeg, [
    "-y", "-i", inputPath,
    "-ac", "1", "-ar", "48000",
    "-c:a", "pcm_s16le",
    outputPath,
  ]);
  if (!res.ok || !existsSync(outputPath)) {
    log(`[Voice] ffmpeg normalization failed (${res.stderr.slice(0, 120)}) — keeping raw bytes`);
    writeFileSync(outputPath, readFileSync(inputPath));
  }
  return outputPath;
}

/** Canonical WAV header writer (48 kHz / mono / 16-bit). */
function writeSilentWav(path, seconds) {
  const sampleRate = 48000;
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
}

/** Exact duration (and format) of an audio or video file. */
export function probeMedia(path) {
  const probe = run(getFfprobePath(), [
    "-v", "error",
    "-show_entries", "format=duration",
    "-show_entries", "stream=sample_rate,channels,codec_type",
    "-of", "default=nw=1",
    path,
  ]);
  const duration = Number((probe.stdout.match(/duration=([\d.]+)/) || [])[1]);
  const channels = Number((probe.stdout.match(/channels=(\d+)/) || [])[1]) || undefined;
  const sampleRate = Number((probe.stdout.match(/sample_rate=([\d.]+)/) || [])[1]) || undefined;
  return {
    ok: Number.isFinite(duration) && duration > 0,
    duration: Number.isFinite(duration) ? duration : null,
    channels,
    sampleRate,
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — Word-level timestamps
// ---------------------------------------------------------------------------

/** Strip everything that isn't a letter/digit, keep non-Latin scripts intact. */
export function normalizeToken(word) {
  return String(word || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "") // Arabic diacritics
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Align provider timings to the *exact* script we sent to TTS.
 *
 * Transcribers re-punctuate, drop fillers and sometimes re-spell words, so raw
 * timings cannot be applied blindly. A tolerant two-pointer walk over
 * normalised tokens maps real times onto our canonical caption words, and any
 * unmatched word gets an interpolated slot.
 */
export function alignTimesToScript(scriptWords, heardWords) {
  const script = scriptWords.map((token, index) => ({ token, index, norm: normalizeToken(token) }));
  const heard = (heardWords || [])
    .map((w) => ({ ...w, norm: normalizeToken(w.word ?? w.text) }))
    .filter((w) => w.norm && Number.isFinite(w.start));

  const result = new Array(script.length).fill(null);
  if (!heard.length) return result;

  let h = 0;
  for (let s = 0; s < script.length; s++) {
    const target = script[s];
    if (!target.norm) continue;

    let found = -1;
    // Look ahead a little: the transcript may insert or merge tokens.
    for (let look = 0; look < 4 && h + look < heard.length; look++) {
      if (heard[h + look].norm === target.norm) {
        found = h + look;
        break;
      }
    }
    if (found === -1) {
      // Fuzzy: prefix/containment match handles "l'intelligence" → "intelligence".
      for (let look = 0; look < 4 && h + look < heard.length; look++) {
        const a = heard[h + look].norm;
        if (a.length > 3 && target.norm.length > 3 && (a.startsWith(target.norm) || target.norm.startsWith(a))) {
          found = h + look;
          break;
        }
      }
    }
    if (found === -1) continue;

    const word = heard[found];
    result[s] = { start: word.start, end: Number.isFinite(word.end) ? word.end : word.start + 0.3 };
    h = found + 1;
  }

  // Interpolate the gaps between matched anchors.
  const anchors = result.map((r, i) => (r ? i : -1)).filter((i) => i !== -1);
  if (!anchors.length) return result;

  for (let s = 0; s < script.length; s++) {
    if (result[s]) continue;
    const before = anchors.filter((a) => a < s).pop();
    const after = anchors.find((a) => a > s);
    const startBound = before !== undefined ? result[before].end : heard[0].start - 0.2;
    const endBound =
      after !== undefined
        ? result[after].start
        : Number.isFinite(heard[heard.length - 1].end)
          ? heard[heard.length - 1].end
          : seenEnd(heard);
    const count = (after !== undefined ? after : script.length) - (before !== undefined ? before : -1) - 1;
    const slotStart = before !== undefined ? before : -1;
    const ordinal = s - slotStart - 1;
    const span = Math.max(0.05, endBound - startBound);
    const step = span / Math.max(1, count);
    result[s] = { start: startBound + ordinal * step, end: startBound + (ordinal + 1) * step };
  }

  return result;
}

function seenEnd(heard) {
  return heard[heard.length - 1].end || heard[heard.length - 1].start + 0.3;
}

/**
 * Stage 3 — real word timestamps for the generated voiceover.
 *
 * Tier 1: Gemini 3.5 Transcribe (word-level timestamps, same API key)
 * Tier 2: local Whisper through the HyperFrames CLI (no API key needed)
 * Tier 3: silencedetect-based energy estimate (crude but never zero)
 */
export async function transcribeWords({
  wavPath,
  scriptText,
  language,
  apiKey,
  allowLocalWhisper = true,
  log = console.log,
}) {
  const scriptWords = String(scriptText || "").trim().split(/\s+/).filter(Boolean);
  const key = getGeminiApiKey(apiKey);

  if (key) {
    try {
      const heard = await transcribeWithGemini({ wavPath, language, apiKey: key, log });
      if (heard?.length) {
        const aligned = alignTimesToScript(scriptWords, heard);
        const matched = aligned.filter(Boolean).length;
        const ratio = matched / Math.max(1, scriptWords.length);
        log(`[Timing] Gemini transcribe → ${heard.length} words heard, ${matched}/${scriptWords.length} aligned (${Math.round(ratio * 100)}%)`);
        if (ratio >= 0.6) return { words: aligned, source: "gemini-transcribe", confidence: ratio };
        log("[Timing] alignment confidence too low — falling back");
      }
    } catch (err) {
      log(`[Timing] Gemini transcribe unavailable (${err.message.slice(0, 120)})`);
    }
  }

  if (allowLocalWhisper) {
    const heard = transcribeWithWhisperCli({ wavPath, language, log });
    if (heard?.length) {
      const aligned = alignTimesToScript(scriptWords, heard);
      const matched = aligned.filter(Boolean).length;
      const ratio = matched / Math.max(1, scriptWords.length);
      log(`[Timing] local Whisper → ${heard.length} words heard, ${matched}/${scriptWords.length} aligned (${Math.round(ratio * 100)}%)`);
      if (ratio >= 0.5) return { words: aligned, source: "whisper-local", confidence: ratio };
    }
  }

  const words = estimateTimesFromEnergy({ wavPath, scriptText, log });
  return { words, source: "energy-estimate", confidence: 0.3 };
}

/** Gemini 3.5 Transcribe → [{word, start, end}] */
async function transcribeWithGemini({ wavPath, language, apiKey, log }) {
  const bytes = readFileSync(wavPath);
  const inline = bytes.length < 12 * 1024 * 1024;

  const config = {
    transcription_config: {
      mode: { type: "verbatim", timestamp_granularities: ["word"] },
      ...(languageCode(language) ? { language_codes: [languageCode(language)] } : {}),
    },
  };

  let input;
  let fileUri = null;
  if (inline) {
    input = [{ type: "audio", data: bytes.toString("base64"), mime_type: "audio/wav" }];
  } else {
    fileUri = await uploadFile({ bytes, apiKey, displayName: "voice.wav" });
    input = [{ type: "audio", uri: fileUri, mime_type: "audio/wav" }];
  }

  const res = await geminiFetch(INTERACTIONS_URL, {
    apiKey,
    body: { model: GEMINI_TRANSCRIBE_MODEL, input, generation_config: config },
    timeoutMs: 180000,
  });
  if (!res.ok) throw new Error(`${res.status} ${String(res.text).slice(0, 160)}`);

  const words = extractWordTimings(res.json);
  if (fileUri) deleteUploadedFile(fileUri, apiKey).catch(() => {});
  return words;
}

/** Upload large audio to the Files API (raw upload protocol). */
async function uploadFile({ bytes, apiKey, displayName }) {
  const res = await fetch(`${GEMINI_BASE.replace("/v1beta", "/upload/v1beta")}/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "raw",
      "Content-Type": "audio/wav",
      "X-Goog-Upload-File-Name": encodeURIComponent(displayName),
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${String(await res.text()).slice(0, 140)}`);
  const json = await res.json();
  const uri = json?.file?.uri;
  if (!uri) throw new Error("upload returned no file uri");
  return uri;
}

async function deleteUploadedFile(uri, apiKey) {
  const name = String(uri).split("/").slice(-2).join("/"); // files/<id>
  await fetch(`${GEMINI_BASE}/${name}`, { method: "DELETE", headers: { "x-goog-api-key": apiKey } });
}

/**
 * Pull word timings out of a transcription response, tolerating the plausible
 * shapes (annotations[], words[], typed word items, or text with time tags).
 */
export function extractWordTimings(json) {
  const out = [];
  const push = (word, start, end) => {
    if (!word) return;
    const s = Number(start);
    if (!Number.isFinite(s)) return;
    const e = Number(end);
    out.push({ word: String(word).trim(), start: s, end: Number.isFinite(e) ? e : s + 0.3 });
  };

  const blocks = (json?.steps || []).filter((s) => s.type === "model_output").flatMap((s) => s.content || []);
  const texts = [];

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const type = node.type;
    if (type === "word" || type === "word_timestamp") {
      push(node.word ?? node.text ?? node.value, node.start ?? node.start_time ?? node.startTime, node.end ?? node.end_time ?? node.endTime);
    }
    if (Array.isArray(node.annotations)) {
      for (const ann of node.annotations) {
        if (ann?.type === "word" || ann?.word) {
          push(ann.word ?? ann.text, ann.start ?? ann.start_time ?? ann.startTime, ann.end ?? ann.end_time ?? ann.endTime);
        }
      }
    }
    if (Array.isArray(node.words)) {
      for (const w of node.words) {
        push(w.word ?? w.text, w.start ?? w.start_time ?? w.startTime, w.end ?? w.end_time ?? w.endTime);
      }
    }
    if (typeof node.text === "string") texts.push(node.text);
    for (const key of ["content", "output", "output_text", "data", "segments", "items"]) {
      if (node[key]) walk(node[key]);
    }
  };
  walk(blocks);
  if (json?.output) walk(json.output);
  if (json?.output_text) walk(json.output_text);

  if (out.length) return dedupeSort(out);

  // Last resort: parse "[0.32 - 0.71] word" style text.
  for (const text of texts) {
    const re = /\[?\s*(\d+(?:\.\d+)?)\s*(?:-|–|→|to|s\s*-\s*s)\s*(\d+(?:\.\d+)?)\s*s?\]?\s*([^\s\]]+)/g;
    let m;
    while ((m = re.exec(text))) push(m[3], m[1], m[2]);
  }
  return dedupeSort(out);
}

function dedupeSort(words) {
  const seen = new Set();
  return words
    .filter((w) => {
      const key = `${w.word}@${w.start.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start);
}

/** Local Whisper via the HyperFrames CLI (offline-capable, no API key). */
function transcribeWithWhisperCli({ wavPath, language, log }) {
  const outDir = dirname(wavPath);
  const res = run("npx", ["hyperframes", "transcribe", wavPath, "--json"], {
    cwd: outDir,
    timeout: 900000,
    shell: process.platform === "win32",
  });
  if (!res.ok) {
    log(`[Timing] local Whisper unavailable (${(res.stderr || res.error || "not installed").slice(0, 100)})`);
    return null;
  }
  const parsed = parseJsonLoose(res.stdout);
  const list = Array.isArray(parsed) ? parsed : parsed?.words || parsed?.segments || [];
  return list
    .map((w) => ({ word: w.word ?? w.text, start: Number(w.start ?? w.start_time), end: Number(w.end ?? w.end_time) }))
    .filter((w) => w.word && Number.isFinite(w.start));
}

/**
 * Tier 3 — estimate word times from the audio energy envelope.
 * Uses FFmpeg `silencedetect` to find real speech stretches, then distributes
 * words inside them (proportional to length) instead of across the whole file.
 */
export function estimateTimesFromEnergy({ wavPath, scriptText, log }) {
  const words = String(scriptText || "").trim().split(/\s+/).filter(Boolean);
  const duration = probeMedia(wavPath).duration || Math.max(3, words.length / 2.5);
  const segments = detectSpeechSegments(wavPath, duration);
  const speechTotal = segments.reduce((acc, s) => acc + (s.end - s.start), 0) || duration;

  const weights = words.map((w) => Math.max(2, w.length));
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  const out = new Array(words.length).fill(null);
  let wordIndex = 0;
  let consumedWeight = 0;
  for (const segment of segments) {
    const segmentWeight = ((segment.end - segment.start) / speechTotal) * weightTotal;
    let cursor = segment.start;
    while (wordIndex < words.length && consumedWeight < segmentWeight + 1e-9) {
      const share = (weights[wordIndex] / weightTotal) * speechTotal;
      const start = Math.min(cursor, segment.end - 0.05);
      const end = Math.min(Math.max(start + 0.08, start + share), segment.end);
      out[wordIndex] = { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) };
      cursor = end;
      consumedWeight += (weights[wordIndex] / weightTotal) * weightTotal;
      wordIndex++;
      if (wordIndex >= words.length) break;
    }
    if (wordIndex >= words.length) break;
  }
  // Anything left over lands at the tail.
  let tail = out.filter(Boolean).length ? out.filter(Boolean)[out.filter(Boolean).length - 1].end : 0;
  for (let i = 0; i < words.length; i++) {
    if (!out[i]) {
      out[i] = { start: Number(tail.toFixed(3)), end: Number((tail + 0.28).toFixed(3)) };
      tail += 0.28;
    }
  }
  log(`[Timing] energy estimate → ${segments.length} speech segments over ${duration.toFixed(1)}s`);
  return out;
}

/** FFmpeg silencedetect → [{start,end}] speech stretches, with padding. */
function detectSpeechSegments(wavPath, duration) {
  const res = run(getFfmpegPath(), [
    "-v", "error",
    "-i", wavPath,
    "-af", "silencedetect=noise=-32dB:d=0.18",
    "-f", "null", "-",
  ]);
  const cuts = [];
  const re = /silence_(start|end):\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(res.stderr))) cuts.push({ type: m[1], t: Number(m[2]) });
  if (!cuts.length) return [{ start: 0.15, end: Math.max(0.4, duration - 0.15) }];

  const segments = [];
  let speechStart = 0.12;
  for (const cut of cuts) {
    if (cut.type === "start") {
      if (cut.t - speechStart > 0.12) segments.push({ start: speechStart, end: cut.t });
    } else if (cut.type === "end") {
      speechStart = cut.t;
    }
  }
  if (duration - speechStart > 0.12) segments.push({ start: speechStart, end: duration - 0.1 });
  return segments.length ? segments : [{ start: 0.15, end: Math.max(0.4, duration - 0.15) }];
}

// ---------------------------------------------------------------------------
// Stage 4 — Hero imagery (generated, not scraped)
// ---------------------------------------------------------------------------

/**
 * Generate the hero visual for one scene with a Gemini image model.
 *
 * Quality ladder (best model first), then a deterministic local plate so a
 * render always has something deliberate on the hero stage.
 */
export async function generateHeroImage({
  prompt,
  heroSearch,
  keyword,
  styleName = "fares-editorial",
  sceneIndex = 0,
  outputPngPath,
  apiKey,
  quality = "high",
  size = "1K",
  aspectRatio = "1:1",
  mock = false,
  log = console.log,
}) {
  mkdirSync(dirname(outputPngPath), { recursive: true });
  const art = artDirectionFor(styleName);

  if (mock) {
    const plate = writeGradientPlate(outputPngPath, {
      width: 1024,
      height: 1024,
      seed: 31 + sceneIndex * 17,
      glow: art.mode === "isolated" ? "#ff2e36" : "#e71f28",
      glowStrength: art.mode === "isolated" ? 0.55 : 0.28,
      top: "#0b0b0d",
      bottom: "#191116",
    });
    log(`[Image] mock plate → ${outputPngPath}`);
    return { ok: true, path: plate, source: "mock" };
  }

  const key = getGeminiApiKey(apiKey);
  if (!key) {
    log("[Image] no API key — writing placeholder plate");
    return { ok: false, path: writePlaceholder(outputPngPath, styleName, sceneIndex), source: "placeholder" };
  }

  const fullPrompt = buildImagePrompt({ prompt, heroSearch, keyword, art });
  const models = quality === "max" ? GEMINI_IMAGE_MODELS : [GEMINI_FAST_IMAGE_MODEL, ...GEMINI_IMAGE_MODELS];
  const uniqueModels = [...new Set(models)];

  for (const model of uniqueModels) {
    const res = await geminiFetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      apiKey: key,
      body: {
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio, imageSize: size },
        },
      },
      timeoutMs: 180000,
    });

    if (!res.ok) {
      log(`[Image] ${model} → ${res.status} (${String(res.text).slice(0, 90)})`);
      continue;
    }

    const parts = res.json?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const base64 = imagePart?.inlineData?.data || imagePart?.inline_data?.data;
    if (!base64) {
      log(`[Image] ${model} returned no image data`);
      continue;
    }

    writeFileSync(outputPngPath, Buffer.from(base64, "base64"));
    log(`[Image] ✓ ${model} → ${outputPngPath}`);
    return { ok: true, path: outputPngPath, source: `gemini:${model}`, prompt: fullPrompt };
  }

  log("[Image] all image models failed — writing placeholder plate");
  return { ok: false, path: writePlaceholder(outputPngPath, styleName, sceneIndex), source: "placeholder" };
}

/** Compose the final image prompt: the model's shot + our style art direction. */
export function buildImagePrompt({ prompt, heroSearch, keyword, art }) {
  const subject = String(prompt || "").trim() || `isolated 3d render of ${heroSearch || "a sculptural object"}`;
  const clean = subject
    .replace(/^isolated 3d render of\s*/i, "")
    .replace(/\b(8k|octane render|photorealistic)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return [
    `${clean}.`,
    art.subjectStyle + ".",
    `Colour palette: ${art.palette}.`,
    "Vertical composition, the subject centred with space above and below.",
    `${art.avoid}.`,
  ].join(" ");
}

function writePlaceholder(path, styleName, sceneIndex) {
  const art = artDirectionFor(styleName);
  return writeGradientPlate(path, {
    width: 1024,
    height: 1024,
    seed: 11 + sceneIndex * 23,
    glow: art.mode === "isolated" ? "#ff2e36" : "#e71f28",
    glowStrength: 0.45,
    grain: 0.05,
  });
}

/**
 * Knocked-out subject for editorial/photo styles: keys out a near-white studio
 * background and feathers the edge, so rectangular photos never sit in a box.
 * Returns false when the plate has no clean background to key (safe no-op).
 */
export function isolateOnLightBackground(imagePath, { log = console.log } = {}) {
  if (!existsSync(imagePath)) return false;
  const temp = `${imagePath}.keyed.png`;
  const filter = [
    "format=rgba",
    "colorkey=0xFFFFFF:0.16:0.06",
    "despill=type=green:mix=0.0",
  ].join(",");
  const res = run(getFfmpegPath(), ["-y", "-i", imagePath, "-vf", filter, temp]);
  if (!res.ok || !existsSync(temp) || statSync(temp).size < 2048) {
    log(`[Image] background key skipped for ${imagePath.split("/").pop()}`);
    return false;
  }
  writeFileSync(imagePath, readFileSync(temp));
  return true;
}

export { spawnSync };
