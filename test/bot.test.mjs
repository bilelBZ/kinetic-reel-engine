import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt, escapeMarkdown } from "../telegram-bot.mjs";

// The bot only starts polling when it is the entry point, so importing it here
// is safe and keeps the prompt parser under test.

test("a natural French instruction becomes clean parameters", () => {
  const p = parsePrompt("Fais-moi un reel de 30s sur le cafe de specialite avec la voix Fenrir en style cyber rapide");
  assert.equal(p.topic, "cafe de specialite");
  assert.equal(p.duration, 30);
  assert.equal(p.voice, "Fenrir");
  assert.equal(p.style, "cyber-matrix");
  assert.equal(p.speed, "rapid");
});

test("duration units never leak into the topic", () => {
  // "secondes" must not be matched as "sec" + left-over "ondes".
  const p = parsePrompt("Crée une vidéo de 20 secondes sur les habitudes matinales luxury calme");
  assert.ok(!/ondes|secondes/.test(p.topic), `topic leaked units: ${p.topic}`);
  assert.equal(p.topic, "habitudes matinales");
  assert.equal(p.duration, 20);
  assert.equal(p.style, "minimal-luxury");
  assert.equal(p.speed, "calm");
});

test("English instructions are parsed too", () => {
  const p = parsePrompt("Make a 60s reel about why compound interest wins, voice Charon, in English");
  assert.equal(p.topic, "why compound interest wins");
  assert.equal(p.duration, 60);
  assert.equal(p.voice, "Charon");
  assert.equal(p.lang, "English");
});

test("a bare instruction without a verb still yields a topic", () => {
  assert.equal(parsePrompt("un reel de 15 secondes sur le cafe").topic, "cafe");
});

test("real topics that merely contain keywords are never mangled", () => {
  assert.equal(parsePrompt("video game design trends").topic, "video game design trends");
  const arabic = parsePrompt("أهم عادات الناجحين");
  assert.equal(arabic.lang, "Arabic");
  assert.equal(arabic.topic, "أهم عادات الناجحين");
});

test("durations are clamped to a sane range", () => {
  assert.equal(parsePrompt("reel de 2 secondes sur x").duration, 5);
  assert.equal(parsePrompt("reel de 999 secondes sur x").duration, 180);
});

test("MarkdownV2 escaping protects every reserved character", () => {
  const escaped = escapeMarkdown("coffee *costs* 50% _more_ [now]");
  assert.ok(!/(^|[^\\])[*_[\]]/.test(escaped), `unescaped reserved char in: ${escaped}`);
});
