import { test } from "node:test";
import assert from "node:assert/strict";
import { localFallbackStoryboard, paceFor, artDirectionFor, buildImagePrompt, extractWordTimings } from "../lib/gemini-ai.mjs";
import { estimateTimes, detectLanguage } from "../lib/pipeline.mjs";
import { gradientPlate } from "../lib/png.mjs";
import { slugify, parseArgs, flag, flagNumber, flagBool } from "../lib/env.mjs";

test("the local fallback storyboard still satisfies every pipeline invariant", () => {
  const board = localFallbackStoryboard({ topic: "why specialty coffee costs so much", targetDurationSeconds: 30 });
  assert.ok(board.scenes.length >= 4);
  for (const [index, scene] of board.scenes.entries()) {
    assert.equal(scene.id, index + 1, "ids must be sequential");
    assert.equal(scene.hero_name, `hero_${scene.id}`);
    assert.ok(scene.text.length > 0, "every scene needs spoken text");
    assert.ok(
      scene.text.toLowerCase().includes(scene.keyword.toLowerCase()),
      `keyword "${scene.keyword}" must appear in "${scene.text}"`,
    );
    assert.ok(scene.hero_prompt.length > 20, "hero_prompt must be usable as-is by the image model");
  }
  assert.ok(board.fullScript.includes(board.scenes[0].text), "fullScript must contain the scene text");
});

test("Arabic topics are detected and get an RTL-ready storyboard", () => {
  const board = localFallbackStoryboard({ topic: "أهم عادات الناجحين", targetDurationSeconds: 20 });
  assert.equal(board.language, "Arabic");
  assert.ok(/[\u0600-\u06FF]/.test(board.fullScript));
  assert.equal(detectLanguage("أهم عادات الناجحين"), "Arabic");
  assert.equal(detectLanguage("coffee prices"), "French");
});

test("pace presets scale the word budget predictably", () => {
  assert.ok(paceFor("rapid").wps > paceFor("standard").wps);
  assert.ok(paceFor("standard").wps > paceFor("calm").wps);
  assert.equal(paceFor("nonsense").wps, paceFor("standard").wps);
});

test("image prompts always carry the style's art direction and never leak a CDN", () => {
  const art = artDirectionFor("cyber-matrix");
  const prompt = buildImagePrompt({ prompt: "isolated 3d render of a quantum chip, 8k, octane render", heroSearch: "quantum chip", art });
  assert.ok(prompt.includes("neon"), "style palette must reach the image model");
  assert.ok(!/8k|octane/i.test(prompt), "legacy keywords are stripped");
  assert.ok(/no text/i.test(prompt), "text suppression must survive");
});

test("word timings are parsed from any documented transcription shape", () => {
  const shapes = [
    { steps: [{ type: "model_output", content: [{ type: "word", word: "hello", start: 0.1, end: 0.4 }] }] },
    { steps: [{ type: "model_output", content: [{ type: "text", text: "hello", annotations: [{ type: "word", word: "hello", start_time: 0.1, end_time: 0.4 }] }] }] },
    { steps: [{ type: "model_output", content: [{ type: "text", text: "hello", words: [{ text: "hello", start: 0.1, end: 0.4 }] }] }] },
    { steps: [{ type: "model_output", content: [{ type: "text", text: "[0.10 - 0.40] hello" }] }] },
  ];
  for (const [index, shape] of shapes.entries()) {
    const words = extractWordTimings(shape);
    assert.equal(words.length, 1, `shape ${index} failed`);
    assert.equal(words[0].word, "hello");
    assert.equal(words[0].start, 0.1);
  }
  assert.deepEqual(extractWordTimings({}), [], "an empty response must not throw");
});

test("estimateTimes covers the requested duration in order", () => {
  const times = estimateTimes("one two three four five six", 10);
  assert.equal(times.length, 6);
  for (let i = 1; i < times.length; i++) assert.ok(times[i].start >= times[i - 1].start);
  assert.ok(times.at(-1).end <= 10.001);
});

test("placeholder art is a real PNG at the requested size", () => {
  const png = gradientPlate({ width: 120, height: 90 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 120);
  assert.equal(png.readUInt32BE(20), 90);
});

test("cli helpers: slug, arg parsing, flag aliases", () => {
  const slug = slugify("Pourquoi le café coûte si cher?!");
  assert.ok(slug.startsWith("pourquoi-le-cafe-coute-si"), slug);
  assert.ok(slug.length <= 28 && !slug.endsWith("-"), "slugs stay short and clean");
  assert.equal(slugify("أهم عادات"), "reel");
  const flags = parseArgs(["--topic", "hello world", "--pace", "rapid", "--mock", "-d", "45"]);
  assert.equal(flag(flags, "topic", "t"), "hello world");
  assert.equal(flag(flags, "pace", "speed"), "rapid");
  assert.equal(flagNumber(flags, 30, "duration", "d"), 45);
  assert.equal(flagBool(flags, "mock"), true);
  assert.equal(flagBool(flags, "missing"), false);
});
