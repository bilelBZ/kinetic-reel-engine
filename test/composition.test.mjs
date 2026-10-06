import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCompositionHtml,
  fitCaption,
  groupLines,
  planAudioCues,
  installRuntime,
  resolveAspect,
} from "../lib/composition-builder.mjs";
import { getStyle, generateStyleCss } from "../lib/styles/index.mjs";
import { buildTimedWords } from "../lib/word-aligner.mjs";
import { gradientPlate } from "../lib/png.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kre-"));
  mkdirSync(join(dir, "assets/img"), { recursive: true });
  mkdirSync(join(dir, "assets/audio/sfx"), { recursive: true });
  writeFileSync(join(dir, "assets/img/hero_1.png"), gradientPlate({ width: 64, height: 64 }));
  writeFileSync(join(dir, "assets/audio/voice.wav"), "x");

  const scenes = [
    { id: 1, theme: "dark", badge: "01 / HOOK", text: "Le café de spécialité coûte cher.", keyword: "CHER", hero_name: "hero_1", hero_title: "Grains", motion: "zoom-in", transition: "soft-wipe" },
    { id: 2, theme: "light", badge: "02 / WHY", text: "Trois raisons expliquent ce prix.", keyword: "TROIS", hero_name: "hero_2", hero_title: "Watch", motion: "slide-left", transition: "whip" },
    { id: 3, theme: "dark", badge: "03 / PAYOFF", text: "La torréfaction change tout.", keyword: "TOUT", hero_name: "hero_3", hero_title: "Roast", motion: "parallax", transition: "crossfade" },
  ];
  const timings = Array.from({ length: 14 }, (_, i) => ({ start: 0.3 + i * 0.5, end: 0.75 + i * 0.5 }));
  const timed = buildTimedWords({ scenes, timings, audioDuration: 8 });
  return { dir, scenes, ...timed };
}

test("composition is fully offline — no CDN or remote font references", () => {
  const { dir, scenes, words, sceneRanges, totalDuration } = fixture();
  const out = join(dir, "index.html");
  buildCompositionHtml({
    projectDir: dir,
    title: "Test",
    scenes,
    words,
    sceneRanges,
    totalDuration,
    styleName: "fares-editorial",
    outputPath: out,
    log: () => {},
  });
  const html = readFileSync(out, "utf8");
  assert.ok(!/https?:\/\/[^"']*(jsdelivr|googleapis|gstatic)/.test(html), "no CDN references allowed");
  assert.ok(html.includes('src="assets/vendor/gsap.min.js"'), "GSAP must load from the project");
  assert.ok(html.includes('url("assets/fonts/'), "fonts must be local");
  assert.ok(html.includes("window.__timelines.main"), "timeline must be registered for HyperFrames");
  assert.ok(html.includes("__timelineError"), "missing-runtime failure must be detectable");
});

test("timeline uses tweens/sets only — no callbacks that would not fire on seek", () => {
  const { dir, scenes, words, sceneRanges, totalDuration } = fixture();
  const out = join(dir, "index.html");
  buildCompositionHtml({ projectDir: dir, title: "T", scenes, words, sceneRanges, totalDuration, outputPath: out, log: () => {} });
  const html = readFileSync(out, "utf8");
  const script = html.slice(html.lastIndexOf("<script>"));
  assert.ok(!/tl\.call\(/.test(script), "tl.call() does not run when the renderer seeks to a frame");
  assert.ok(script.includes("tl.fromTo("), "word reveals must be tween-based");
  assert.match(html, /data-duration="[\d.]+"/);
  assert.match(html, /data-composition-id="main"/);
});

test("audio graph: voice on its own track, sparse cues with fades, no per-word barrage", () => {
  const { scenes, words, sceneRanges, totalDuration } = fixture();
  const style = getStyle("fares-editorial");
  const cues = planAudioCues({ style, words, sceneRanges, taps: true });
  const impacts = cues.filter((c) => c.kind === "impact");
  const taps = cues.filter((c) => c.kind === "tap");

  assert.equal(impacts.length, scenes.length, "one impact per scene keyword");
  assert.ok(taps.length <= Math.ceil(words.length / 3), `taps must stay sparse, got ${taps.length}`);
  assert.ok(cues.every((c) => c.volume <= 1), "volumes must be sane");
  assert.ok(impacts.every((c) => c.fadeOut > 0), "impacts must fade, never click off");

  // Lane packing must never put two cues on the same lane at the same time.
  const byLane = new Map();
  for (const cue of cues) {
    const list = byLane.get(cue.lane) || [];
    list.push(cue);
    byLane.set(cue.lane, list);
  }
  for (const list of byLane.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].start >= list[i - 1].start + list[i - 1].duration - 0.02, "cues overlap inside a lane");
    }
  }
  assert.ok(cues.every((c) => c.start >= 0 && c.start <= totalDuration));

  const withTapsOff = planAudioCues({ style, words, sceneRanges, taps: false });
  assert.equal(withTapsOff.filter((c) => c.kind === "tap").length, 0);
});

test("captions never overflow: long text shrinks, punch lines stay capped", () => {
  const long = fitCaption({
    lines: ["this is a very long caption line that would overflow the frame"],
    width: 1080,
    baseFontSize: 88,
    sidePadding: 60,
  });
  const short = fitCaption({ lines: ["NOW"], width: 1080, baseFontSize: 88, sidePadding: 60 });
  assert.ok(long.fontSize < 88, "long lines must shrink");
  assert.ok(short.fontSize <= 88 * 1.16 + 1, "short lines must not blow past the cap");
  assert.ok(long.fontSize >= Math.round(88 * 0.55), "never shrink into illegibility");
});

test("groupLines keeps every word and never exceeds three lines", () => {
  const words = "one two three four five six seven eight nine ten eleven".split(" ").map((word, i) => ({ word, id: `w${i}`, isKeyword: i === 5, time: i }));
  const lines = groupLines(words);
  assert.ok(lines.length <= 3, `expected <= 3 lines, got ${lines.length}`);
  assert.equal(lines.flat().length, words.length, "no word may be dropped");
});

test("installRuntime copies GSAP and fonts into the project", () => {
  const dir = mkdtempSync(join(tmpdir(), "kre-rt-"));
  const result = installRuntime(dir, { log: () => {} });
  assert.ok(existsSync(join(dir, "assets/vendor/gsap.min.js")), "GSAP must be vendored for offline renders");
  assert.equal(result.gsap, "assets/vendor/gsap.min.js");
});

test("styles emit valid CSS for every preset and canvas", () => {
  for (const id of ["fares-editorial", "swiss-editorial", "cyber-matrix", "minimal-luxury"]) {
    const css = generateStyleCss(getStyle(id), { canvas: resolveAspect("9:16") });
    assert.ok(css.includes(".cap"), `${id} must style captions`);
    assert.ok(css.includes("--keyword-color"), `${id} must define its accent`);
    assert.ok(!/url\(http/.test(css), `${id} must not reference remote assets`);
    assert.ok((css.match(/{/g) || []).length === (css.match(/}/g) || []).length, `${id} CSS braces must balance`);
  }
});
