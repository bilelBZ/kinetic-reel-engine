/**
 * Voice direction — turning a storyboard into a *performance*.
 *
 * Gemini 3.8 TTS treats its input as a **verbatim transcript**: anything that is
 * not meant to be heard must live outside the text. The prompting guide splits
 * performance control into three scopes, and this module implements exactly
 * those three, nothing more:
 *
 *   sustained   → `speech_metadata.style`   short string, reused verbatim per tone
 *   momentary   → inline tags               `<short pause>`, `<breath>`
 *   emphasis    → capitalisation            the ONE keyword that carries the line
 *
 * Two rules from the guide are enforced here in code rather than trusted to the
 * prompt, because both are silent-failure modes:
 *
 *   1. Long "Audio Profile" / "Director's Notes" style blocks are the most
 *      common cause of voice drift. Styles here are one short clause, and the
 *      same string is reused across turns that share a tone.
 *   2. Immutable traits (age, gender, name, accent) must never appear in
 *      `style`. Stripped by `sanitizeStyle` — pick a voice for that instead.
 *
 * Everything is deterministic: same storyboard in, same transcript out. That is
 * what keeps word-level alignment reproducible.
 */

/** Allowed per-scene tones. The storyboard prompt offers exactly this list. */
export const SCENE_TONES = [
  "hook",
  "intrigue",
  "authority",
  "warm",
  "tense",
  "hype",
  "wry",
  "reflective",
  "payoff",
  "cta",
];

/**
 * Tone → turn-level delivery, kept to one short clause each.
 * Reused verbatim so that two scenes with the same tone sound like the same
 * performer, which is what the consistency guidance asks for.
 */
const TONE_STYLES = {
  hook: "confident, punchy",
  intrigue: "lowered, conspiratorial",
  authority: "measured and authoritative",
  warm: "warm and conversational",
  tense: "tight, quickening",
  hype: "energised, driving",
  wry: "dry, amused",
  reflective: "slower, thoughtful",
  payoff: "deliberate, weight on the last words",
  cta: "clear, direct, inviting",
};

/** Tone-independent baseline, used when a tone is missing or unrecognised. */
const STYLE_BASE = {
  "fares-editorial": "confident and punchy, like a trailer narrator who knows the ending",
  "minimal-luxury": "calm, low and unhurried",
  "cyber-matrix": "crisp, precise, technical",
  "swiss-editorial": "clean, neutral, matter-of-fact",
};

/** Position-derived tone, so a storyboard without tones still performs. */
function roleTone(index, total) {
  if (index === 0) return "hook";
  if (index === total - 1) return "cta";
  if (index === total - 2) return "payoff";
  const arc = ["intrigue", "authority", "tense", "warm", "hype", "wry", "reflective"];
  return arc[(index - 1) % arc.length];
}

export function isSceneTone(value) {
  return SCENE_TONES.includes(String(value || "").trim().toLowerCase());
}

/**
 * Guard against the two drift traps: oversized style strings, and immutable
 * speaker traits smuggled into delivery. Returns a short, safe clause.
 */
export function sanitizeStyle(style, fallback = "measured and clear") {
  const cleaned = String(style || "")
    // Age and gender are immutable — a style string cannot change them, and
    // asking it to is a documented cause of drift.
    .replace(/\b(male|female|man|woman|boy|girl|young|old|elderly|teenage|aged \d+)\b/gi, "")
    // Accent too: that is what the voice library and Voice design are for.
    .replace(
      /\b(american|british|french|arabic|spanish|italian|german|mexican|canadian|australian|indian|irish|scottish)\b(\s+accent)?/gi,
      ""
    )
    .replace(
      /\b(maintain|keep|preserve)\s+(?:the\s+)?(?:same\s+)?(?:identical\s+)?(?:\w+\s+)?(?:voice|timbre|identity|speaker|tone|delivery)\b/gi,
      ""
    )
    .replace(/\bdo not (switch|change)\b[^,;.]*/gi, "")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^\s*[,\s]+|[,\s]+$/g, "")
    .replace(/^(a|an|the)\s+(?=\S)/i, "")
    .trim();
  if (!cleaned) return fallback;
  // One clause, ~12 words: long directions are the documented drift cause.
  const firstClause = cleaned.split(/[.;]/)[0].trim();
  return firstClause.split(/\s+/).slice(0, 12).join(" ");
}

export function styleForTone(tone, styleName = "fares-editorial") {
  const key = String(tone || "").trim().toLowerCase();
  const base = STYLE_BASE[styleName] || STYLE_BASE["fares-editorial"];
  // The style baseline already carries the brand; the tone is the *delta*.
  return sanitizeStyle(TONE_STYLES[key] ? `${TONE_STYLES[key]}` : base, base);
}

/** Stage directions masquerading as prose — the model would read these aloud. */
const DIRECTION_WORDS =
  /^(whisper\w*|shout\w*|laugh\w*|sigh\w*|pause|beat|soft\w*|loud\w*|slow\w*|fast\w*|excited|calm\w*|angry|serious|joking|sarcastic|music|sfx|sound|narrator|voix|narrateur|rire|souffle)\b/i;

/**
 * Strip anything a listener should not hear. Bracketed stage directions are
 * removed; parentheses are kept unless they clearly hold a direction, because
 * parents are legitimate in speech.
 */
export function cleanSpokenText(text) {
  return String(text || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\(([^)]*)\)/g, (match, inner) => (DIRECTION_WORDS.test(inner.trim()) ? " " : match))
    .replace(/^\s*(Narrateur|Narrator|Voix|Voiceover|Voix off)\s*:\s*/i, "")
    .replace(/^[#*\->\u2022]+\s*/gm, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Inline vocal tags we are allowed to emit (point-in-time events only). */
const BEAT_TAGS = { breath: "<breath>", pause: "<short pause>" };

/**
 * Build the exact string handed to TTS for one scene.
 *
 * - capitalises the emphasis keyword (the documented way to place vocal stress)
 * - optionally inserts one inline tag at the first clause boundary
 * - never appends a trailing tag: a tag at the very end is either trimmed by
 *   the model or turns into unpredictable dead air we cannot measure.
 */
export function buildSpokenLine(text, { keyword = "", beat = "none" } = {}) {
  let line = cleanSpokenText(text);
  if (!line) return "";

  const word = String(keyword || "").trim();
  if (word) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word-boundary when the keyword is a plain word, substring otherwise
    // (accented or punctuated keywords still deserve the stress).
    const pattern = /^[\p{L}\p{N}]+$/u.test(word)
      ? new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=[^\\p{L}\\p{N}]|$)`, "iu")
      : new RegExp(`(${escaped})`, "iu");
    line = line.replace(pattern, (_m, pre = "", hit = "") => `${pre}${(hit || word).toUpperCase()}`);
  }

  const tag = BEAT_TAGS[String(beat || "").toLowerCase()];
  const words = line.split(/\s+/).filter(Boolean).length;
  if (tag && words >= 6) {
    // Insert after the first comma / dash / colon — a natural breath point.
    const boundary = line.search(/[,;:—–]\s/);
    if (boundary !== -1 && boundary < line.length - 1) {
      const at = line.indexOf(" ", boundary + 1);
      if (at !== -1) line = `${line.slice(0, at)} ${tag} ${line.slice(at + 1)}`;
    }
  }
  return line.trim();
}

/** Rough spoken duration of a line, used for mock tracks and gap planning. */
export function estimateLineSeconds(text) {
  const words = String(text || "").split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, words / 2.6);
}

/**
 * How long to hold after a scene. The gap belongs to the *hinge*: a payoff or
 * a reflective line wants air before it, while a punchy hook wants the next
 * scene to land immediately.
 */
const GAP_BY_TONE = {
  hook: 170,
  intrigue: 300,
  authority: 250,
  warm: 270,
  tense: 190,
  hype: 150,
  wry: 290,
  reflective: 360,
  payoff: 430,
  cta: 330,
};

const GAP_MIN = 90;
const GAP_MAX = 900;
/** Tail after the final scene so the last word is never clipped by the outro. */
export const TAIL_MS = 200;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Turn storyboard scenes into TTS segments.
 *
 * Returns `{ segments, warnings }` where each segment is
 * `{ id, text, spoken, style, tone, gapAfterMs }`. `text` is the on-screen line
 * and `spoken` is the transcript — they differ by emphasis capitalisation and
 * inline tags, which must never reach the captions.
 */
export function planDelivery({ scenes = [], styleName = "fares-editorial", pauseScale = 1 } = {}) {
  const warnings = [];
  const total = scenes.length;
  const scale = Number.isFinite(pauseScale) && pauseScale > 0 ? pauseScale : 1;
  const tones = scenes.map((scene, index) =>
    isSceneTone(scene?.tone) ? String(scene.tone).toLowerCase() : roleTone(index, total)
  );

  const segments = scenes.map((scene, index) => {
    const tone = tones[index];
    const isLast = index === total - 1;
    const nextTone = isLast ? tone : tones[index + 1];
    const spoken = buildSpokenLine(scene?.text, {
      keyword: scene?.keyword,
      beat: scene?.beat === "breath" || scene?.beat === "pause" ? scene.beat : "none",
    });
    if (!spoken) warnings.push(`Scene ${index + 1} has no speakable text.`);

    const blended = (GAP_BY_TONE[tone] || 250) * 0.45 + (GAP_BY_TONE[nextTone] || 250) * 0.55;
    const gapAfterMs = isLast ? TAIL_MS : Math.round(clamp(blended * scale, GAP_MIN, GAP_MAX));

    return { id: index + 1, tone, text: cleanSpokenText(scene?.text), spoken, style: styleForTone(tone, styleName), gapAfterMs };
  });

  const distinctive = new Set(tones);
  if (scenes.length >= 4 && distinctive.size === 1) {
    warnings.push(`Every scene uses the same tone ("${[...distinctive][0]}") — the read will sound flat.`);
  }
  return { segments, warnings };
}

/**
 * Nudge gaps so the finished voiceover lands near the requested duration.
 *
 * Speech length is not ours to control, but silence is: if the script runs
 * short we open the gaps, if it runs long we tighten them. Gaps stay clamped
 * so the rhythm never turns into dead air or a machine-gun.
 */
export function fitGapsToTarget(segments, { targetMs, speechMs } = {}) {
  if (!Number.isFinite(targetMs) || !Number.isFinite(speechMs) || !segments.length) return segments;
  const planned = segments.reduce((acc, s) => acc + s.gapAfterMs, 0);
  const needed = targetMs - speechMs;
  // Only adjust when there is something meaningful to fix and room to move.
  const minTotal = segments.length * GAP_MIN;
  const maxTotal = segments.length * GAP_MAX;
  if (Math.abs(needed - planned) < 350 || needed < minTotal || needed > maxTotal) return segments;
  const factor = needed / planned;
  return segments.map((s) => ({ ...s, gapAfterMs: Math.round(clamp(s.gapAfterMs * factor, GAP_MIN, GAP_MAX)) }));
}
