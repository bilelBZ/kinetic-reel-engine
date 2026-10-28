#!/usr/bin/env node
// Re-render an existing news-reel scratch project (e.g. after words.json caption fixes).
// Usage: node rerender-news.mjs <scratchDir> --output <mp4> --hook "<t>" --badge "<t>" --cta "<t>" --title "<t>"
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNewsCompositionHtml } from "./lib/news-composition-builder.mjs";
import { renderVideoToMp4 } from "./lib/renderer.mjs";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const projectDir = resolve(process.argv[2]);
const outputMp4Path = resolve(arg("--output"));
const hook = arg("--hook"), badgeText = arg("--badge"), ctaText = arg("--cta"), title = arg("--title") || "News Reel";

const words = JSON.parse(readFileSync(join(projectDir, "words.json"), "utf8"));
const hf = JSON.parse(readFileSync(join(projectDir, "hyperframes.json"), "utf8"));
const totalDuration = Number(hf.duration.toFixed(2));

// teaser duration from the teaser clip
let teaserEnd = null;
try {
  const { probeVideo } = await import("./lib/youtube-extract.mjs");
  const t = probeVideo({ inputVideo: join(projectDir, "clip-teaser-vertical.mp4") });
  teaserEnd = Number(t.duration.toFixed(2));
} catch { teaserEnd = null; }

const firstKw = words.find((w) => w.isKeyword);
const badge = badgeText ? { text: badgeText, at: Number(Math.max(0.3, firstKw ? firstKw.time : 2.0).toFixed(2)) } : null;
const cta = ctaText ? { text: ctaText, showAt: Number(Math.max(1, totalDuration - 2.4).toFixed(2)) } : null;

console.log(`◆  Re-render ${projectDir} → ${outputMp4Path}`);
console.log(`   duration=${totalDuration}s teaserEnd=${teaserEnd} badge@${badge ? badge.at : "-"}`);

buildNewsCompositionHtml({
  projectDir,
  outputPath: join(projectDir, "index.html"),
  title,
  clipVideoRel: "assets/clip-vertical.mp4",
  clipAudioRel: "assets/audio/clip-audio.mp3",
  words,
  totalDuration,
  teaserEnd,
  hook: hook ? { text: hook, showAt: 0.15, hideAt: 3.4 } : null,
  badge,
  cta,
  styleName: "news-viral",
});
console.log("   ✓ Composition rebuilt");

renderVideoToMp4({ projectDir, outputMp4Path });
console.log(`\n 🎉 RE-RENDER OK: ${outputMp4Path}`);
