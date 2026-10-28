#!/usr/bin/env node
// Rebuild only the composition HTML for an existing scratch dir (no render).
// Usage: node rebuild-fr-hook.mjs <scratchDir> --hook "<text>"
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNewsCompositionHtml } from "./lib/news-composition-builder.mjs";
import { probeVideo } from "./lib/youtube-extract.mjs";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const projectDir = resolve(process.argv[2]);
const newHook = arg("--hook");
const newBadge = arg("--badge");
const newCta = arg("--cta");
const title = arg("--title") || "News Reel";

const words = JSON.parse(readFileSync(join(projectDir, "words.json"), "utf8"));
const hf = JSON.parse(readFileSync(join(projectDir, "hyperframes.json"), "utf8"));
const totalDuration = Number(hf.duration.toFixed(2));

let teaserEnd = null;
try {
  const t = probeVideo({ inputVideo: join(projectDir, "clip-teaser-vertical.mp4") });
  teaserEnd = Number(t.duration.toFixed(2));
} catch { teaserEnd = null; }

const firstKw = words.find((w) => w.isKeyword);
const badge = newBadge
  ? { text: newBadge, at: Number(Math.max(0.3, firstKw ? firstKw.time : 2.0).toFixed(2)) }
  : null;
const cta = newCta
  ? { text: newCta, showAt: Number(Math.max(1, totalDuration - 2.4).toFixed(2)) }
  : null;

buildNewsCompositionHtml({
  projectDir,
  outputPath: join(projectDir, "index.html"),
  title,
  clipVideoRel: "assets/clip-vertical.mp4",
  clipAudioRel: "assets/audio/clip-audio.mp3",
  words,
  totalDuration,
  teaserEnd,
  hook: newHook ? { text: newHook, showAt: 0.15, hideAt: 3.4 } : null,
  badge,
  cta,
  styleName: "news-viral",
});
console.log(`   ✓ Composition rebuilt (hook=${JSON.stringify(newHook)})`);

// also keep package.json hook in sync for bookkeeping (when present in scratch dir)
const pkgPath = join(projectDir, "package.json");
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.hook = newHook || pkg.hook;
  if (newBadge) pkg.badge = newBadge;
  if (newCta) pkg.cta = newCta;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log("   ✓ package.json synced");
}
