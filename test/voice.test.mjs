import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCENE_TONES,
  planDelivery,
  buildSpokenLine,
  cleanSpokenText,
  styleForTone,
  sanitizeStyle,
  fitGapsToTarget,
  estimateLineSeconds,
  TAIL_MS,
} from "../lib/voice-direction.mjs";

const SCENES = [
  { id: 1, text: "Votre café coûte trois fois le prix du grain.", keyword: "TROIS", tone: "hook" },
  {
    id: 2,
    text: "Le fermier touche une fraction de ce que vous payez.",
    keyword: "fraction",
    tone: "intrigue",
    beat: "pause",
  },
  { id: 3, text: "La torréfaction artisanale change tout.", keyword: "tout", tone: "payoff" },
];

test("the transcript capitalises the keyword but the caption text stays untouched", () => {
  const line = buildSpokenLine("Le fermier touche une fraction du prix.", { keyword: "fraction" });
  assert.match(line, /FRACTION/);
  assert.equal(line.toLowerCase().includes("fraction"), true);
  // The on-screen string must never inherit the emphasis.
  assert.equal(cleanSpokenText("Le fermier touche une fraction du prix."), "Le fermier touche une fraction du prix.");
});

test("emphasis only ever hits a whole word", () => {
  // "prix" must not be capitalised inside "prixbas".
  const line = buildSpokenLine("Le prixbas est un mot inventé.", { keyword: "prix" });
  assert.equal(line, "Le prixbas est un mot inventé.", "a keyword inside a longer word must not be shouted");
});

test("stage directions never reach the mouth of the narrator", () => {
  const cases = [
    ["[pause] Le café est cher.", "Le café est cher."],
    ["{whispering} Il est très cher.", "Il est très cher."],
    ["(whispering) Il est très cher.", "Il est très cher."],
    ["Narrateur: Le café est cher.", "Le café est cher."],
  ];
  for (const [input, expected] of cases) {
    assert.equal(cleanSpokenText(input), expected, `cleaned: ${input}`);
  }
});

test("parentheses survive when they carry real speech content", () => {
  const text = "Le prix (environ 4 euros) reste stable.";
  assert.equal(cleanSpokenText(text), text);
});

test("an inline beat is inserted inside the line, never trailing it", () => {
  const withBeat = buildSpokenLine("Le fermier touche une fraction, puis le torréfacteur prend le reste.", {
    keyword: "fraction",
    beat: "breath",
  });
  assert.match(withBeat, /<breath>/);
  assert.equal(withBeat.trimEnd().endsWith("<breath>"), false, "a trailing tag becomes unmeasurable dead air");

  // Short lines do not get a beat: there is no room for one.
  const short = buildSpokenLine("Change tout.", { beat: "pause" });
  assert.equal(short.includes("<short pause>"), false);
});

test("a storyboard with no tones still gets a performance, and not a flat one", () => {
  const bare = SCENES.map(({ tone, beat, ...rest }) => rest);
  const { segments, warnings } = planDelivery({ scenes: bare });
  assert.equal(segments.length, 3);
  assert.equal(segments[0].tone, "hook", "the first scene opens the hook");
  assert.equal(segments[segments.length - 1].tone, "cta", "the last scene closes the sell");
  assert.equal(new Set(segments.map((s) => s.tone)).size, 3, "the arc should vary");
  assert.equal(warnings.some((w) => /flat/.test(w)), false);
});

test("a monotone storyboard is flagged instead of shipping flat audio", () => {
  const monotone = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, text: `Ligne ${i + 1} du script.`, tone: "hype" }));
  const { warnings } = planDelivery({ scenes: monotone });
  assert.equal(warnings.some((w) => /flat/.test(w)), true);
});

test("styles stay short and never carry immutable speaker traits", () => {
  assert.equal(sanitizeStyle("young american female"), "measured and clear", "pure traits collapse to the fallback");
  assert.doesNotMatch(sanitizeStyle("a young american female voice with a deep timbre"), /\b(young|american|female|old|french)\b/i);
  const style = styleForTone("payoff", "minimal-luxury");
  assert.ok(style.split(/\s+/).length <= 12, `style too long: ${style}`);
  assert.doesNotMatch(style, /\b(male|female|american|young|old)\b/i);
  // "keep the same voice" style meta-instructions increase drift.
  assert.equal(sanitizeStyle("maintain identical timbre, calm"), "calm");
});

test("every declared tone maps to a usable, distinct style", () => {
  const seen = new Map();
  for (const tone of SCENE_TONES) {
    const style = styleForTone(tone);
    assert.ok(style.length > 0, `${tone} produced an empty style`);
    assert.ok(style.split(/\s+/).length <= 12, `${tone} style too long`);
    assert.equal(seen.has(style), false, `${tone} shares a style with ${seen.get(style)} — the arc would not be audible`);
    seen.set(style, tone);
  }
});

test("gaps stay clamped, scale with the pause setting, and leave a tail at the end", () => {
  const tight = planDelivery({ scenes: SCENES, pauseScale: 0.5 }).segments;
  const loose = planDelivery({ scenes: SCENES, pauseScale: 1.5 }).segments;
  for (const [index, segment] of loose.entries()) {
    assert.ok(segment.gapAfterMs >= 90 && segment.gapAfterMs <= 900, `gap out of range: ${segment.gapAfterMs}`);
    if (index < loose.length - 1) {
      assert.ok(segment.gapAfterMs >= tight[index].gapAfterMs, "a looser pause scale must not shorten a gap");
    }
  }
  assert.equal(loose[loose.length - 1].gapAfterMs, TAIL_MS, "the last word needs room before the outro");
});

test("gaps absorb a duration mismatch but refuse to become dead air", () => {
  const segments = planDelivery({ scenes: SCENES }).segments;
  const speechMs = segments.reduce((acc, s) => acc + estimateLineSeconds(s.spoken) * 1000, 0);

  const stretched = fitGapsToTarget(segments, { targetMs: speechMs + 1500, speechMs });
  const total = stretched.reduce((acc, s) => acc + s.gapAfterMs, 0);
  assert.ok(total > segments.reduce((acc, s) => acc + s.gapAfterMs, 0), "a short script should open up");

  // An absurd target is refused rather than turning the reel into silence.
  const impossible = fitGapsToTarget(segments, { targetMs: speechMs + 60000, speechMs });
  assert.deepEqual(impossible, segments);
});

test("segment text is what is spoken, and it is never empty", () => {
  const { segments } = planDelivery({ scenes: SCENES });
  for (const segment of segments) {
    assert.ok(segment.spoken.trim().length > 0, `scene ${segment.id} has no spoken text`);
    assert.doesNotMatch(segment.spoken, /\[|\]|\{|\}/, "bracketed direction leaked into the transcript");
    assert.ok(segment.style.length > 0);
  }
});

test("the curated voice list is intact and usable as a fallback", async () => {
  const { PREBUILT_VOICES } = await import("../lib/gemini-ai.mjs");
  assert.equal(PREBUILT_VOICES.length, 30, "the documented studio list has 30 voices");
  assert.equal(new Set(PREBUILT_VOICES.map((v) => v.id)).size, 30, "voice ids must be unique");
  for (const voice of PREBUILT_VOICES) {
    assert.ok(voice.id && voice.character, `incomplete entry: ${JSON.stringify(voice)}`);
  }
  // The CLI default and the documented ladder must both be real entries.
  assert.ok(PREBUILT_VOICES.some((v) => v.id === "Fenrir"));
  assert.ok(PREBUILT_VOICES.some((v) => v.id === "Charon"));
});
