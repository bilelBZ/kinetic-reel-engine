import { test } from "node:test";
import assert from "node:assert/strict";
import { alignTimesToScript, normalizeToken } from "../lib/gemini-ai.mjs";
import { buildTimedWords, deriveSceneRanges } from "../lib/word-aligner.mjs";

const SCENES = [
  { id: 1, text: "Le café de spécialité coûte cher.", keyword: "CHER" },
  { id: 2, text: "Trois raisons expliquent ce prix.", keyword: "TROIS" },
  { id: 3, text: "La torréfaction artisanale change tout.", keyword: "TOUT" },
];

test("normalizeToken strips punctuation and case without destroying non-Latin script", () => {
  assert.equal(normalizeToken("Café,"), "cafe");
  assert.equal(normalizeToken("L'intelligence"), "lintelligence");
  assert.equal(normalizeToken("عام,"), "عام");
});

test("alignTimesToScript tolerates a transcriber that re-punctuates and drops fillers", () => {
  const script = ["Le", "café", "de", "spécialité", "coûte", "cher."];
  // The transcriber re-spelled, added a filler word and split "coûte cher".
  const heard = [
    { word: "Le", start: 0.5, end: 0.7 },
    { word: "café", start: 0.72, end: 1.05 },
    { word: "euh", start: 1.06, end: 1.2 },
    { word: "de", start: 1.22, end: 1.35 },
    { word: "spécialité", start: 1.36, end: 1.9 },
    { word: "coute", start: 1.95, end: 2.2 },
    { word: "cher", start: 2.22, end: 2.55 },
  ];
  const aligned = alignTimesToScript(script, heard);
  assert.equal(aligned.length, script.length);
  assert.ok(aligned.every(Boolean), "every script word must get a slot");
  assert.equal(aligned[0].start, 0.5);
  assert.equal(aligned[5].end, 2.55);
  // Monotonic and inside the audio.
  for (let i = 1; i < aligned.length; i++) {
    assert.ok(aligned[i].start >= aligned[i - 1].start - 1e-9, "times must not go backwards");
  }
});

test("alignTimesToScript interpolates words the transcriber missed", () => {
  const script = ["one", "two", "three", "four"];
  const heard = [
    { word: "one", start: 0, end: 0.4 },
    { word: "four", start: 1.2, end: 1.6 },
  ];
  const aligned = alignTimesToScript(script, heard);
  assert.equal(aligned[0].start, 0);
  assert.equal(aligned[3].end, 1.6);
  // The gap is split across the two missing words, in order.
  assert.ok(aligned[1].start >= 0.4 && aligned[1].end <= aligned[2].start);
  assert.ok(aligned[2].end <= 1.2);
});

test("buildTimedWords assigns scenes, flags the real keyword and keeps times monotonic", () => {
  const audioDuration = 9;
  const timings = Array.from({ length: 16 }, (_, i) => ({ start: 0.3 + i * 0.42, end: 0.3 + i * 0.42 + 0.36 }));
  const { words, sceneRanges, totalDuration } = buildTimedWords({ scenes: SCENES, timings, audioDuration });

  assert.equal(words.length, 16);
  assert.deepEqual([...new Set(words.map((w) => w.sceneId))], [1, 2, 3]);

  // Exactly one keyword per scene, and it must be that scene's keyword word.
  for (const scene of SCENES) {
    const flagged = words.filter((w) => w.sceneId === scene.id && w.isKeyword);
    assert.equal(flagged.length, 1, `scene ${scene.id} should have exactly one keyword`);
    assert.ok(flagged[0].clean.toLowerCase().includes(scene.keyword.toLowerCase().slice(0, 3)));
  }

  // Monotonic, non-overlapping, inside the audio.
  for (let i = 1; i < words.length; i++) {
    assert.ok(words[i].time >= words[i - 1].end - 0.001, `word ${i} starts before the previous ended`);
  }
  assert.ok(words.at(-1).end <= audioDuration + 0.001);

  // Ranges: ordered, contiguous enough, and the last one covers the tail.
  assert.equal(sceneRanges.length, SCENES.length);
  for (let i = 1; i < sceneRanges.length; i++) {
    assert.ok(sceneRanges[i].startTime >= sceneRanges[i - 1].startTime);
  }
  assert.equal(sceneRanges.at(-1).endTime, totalDuration);
  const expectedTail = Math.max(0.35, Math.min(1.6, 9 * 0.04 + 0.3));
  assert.equal(totalDuration, Number((9 + expectedTail).toFixed(3)));
});

test("deriveSceneRanges cuts after the last word, not at an even split", () => {
  const words = [
    { id: "a", sceneId: 1, time: 0.2, end: 2.0 },
    { id: "b", sceneId: 2, time: 2.6, end: 4.0 },
    { id: "c", sceneId: 3, time: 4.4, end: 6.0 },
  ];
  const ranges = deriveSceneRanges(words, SCENES, 6);
  assert.equal(ranges[0].startTime, 0);
  assert.ok(ranges[0].endTime > 2.0 && ranges[0].endTime <= 2.6, "cut lands inside the pause");
  assert.ok(ranges[1].startTime >= 2.0 - 1);
  assert.ok(ranges[1].endTime <= 4.4);
});

test("equal-length audio with a long tail pause still yields a full-length timeline", () => {
  const timings = Array.from({ length: 16 }, (_, i) => ({ start: 0.3 + i * 0.2, end: 0.5 + i * 0.2 }));
  const { totalDuration, words } = buildTimedWords({ scenes: SCENES, timings, audioDuration: 20 });
  assert.ok(totalDuration > 20, "post-roll must extend past the voiceover");
  assert.ok(words.every((w) => w.end <= 20));
});
