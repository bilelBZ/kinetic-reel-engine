#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { produceReel, STAGES } from "./lib/pipeline.mjs";
import { listStyles } from "./lib/styles/index.mjs";
import { getGeminiApiKey } from "./lib/gemini-ai.mjs";
import { hasFfmpeg, parseArgs, positionalArgs, flag, flagNumber, flagBool } from "./lib/env.mjs";

/**
 * Kinetic Reel Engine — one prompt in, one finished vertical video out.
 *
 *   node create-reel.mjs "why specialty coffee costs so much" --duration 30
 *   node create-reel.mjs "..." --style cyber --lang English --pace rapid --aspect 4:5
 */

const VOICES = ["Fenrir", "Puck", "Charon", "Kore", "Aoede"];

const USAGE = `
Kinetic Reel Engine — one prompt → one finished video.

USAGE
  node create-reel.mjs "<topic or idea>" [options]

CORE OPTIONS
  -d, --duration <sec>     Target length in seconds            (default 30)
  -v, --voice <name>       ${VOICES.join(", ")}
  -s, --style <name>       ${listStyles().map((s) => s.id).join(" | ")}
  -l, --lang <language>    French, English, Arabic, Spanish…   (auto-detected)
      --pace <preset>      calm | standard | rapid             (default standard)
      --aspect <ratio>     9:16 | 4:5 | 1:1 | 16:9             (default 9:16)

QUALITY OPTIONS
      --image-quality <t>  high (fast) | max (best models first)   (default high)
      --render-quality <t> fast | high | best                  (default high)
      --fps <n>            Force a frame rate (e.g. 60)
      --no-taps            Disable the per-word acoustic taps
      --music <file>       Music bed (mp3/wav) mixed under the voice
      --music-volume <n>   Music level, 0–1                    (default 0.16)
      --brand <text>       Small persistent watermark/brand line
      --no-cover           Skip the JPG cover frame
      --contact-sheet      Also write a frame grid for review

PIPELINE OPTIONS
  -o, --output <file>      MP4 destination                  (default: project dir)
      --out-dir <dir>      Parent directory for the project (default ./scratch)
      --skip-render        Build the project + HTML, stop before rendering
      --mock               Offline dry run: no API calls, placeholder assets
      --keep-frames        Keep render frame dumps for debugging
      --json               Machine-readable result on stdout
  -h, --help               Show this help
      --styles             List the style presets

EXAMPLES
  node create-reel.mjs "Pourquoi le café de spécialité coûte si cher" -d 30 --pace standard
  node create-reel.mjs "3 mistakes that kill a startup" -s cyber --lang English --pace rapid
  node create-reel.mjs "أهم عادات الناجحين" -l Arabic -s luxury -d 45
  node create-reel.mjs "my topic" --mock --skip-render     # free offline test
`;

async function main() {
  const flags = parseArgs();

  if (flagBool(flags, "help", "h")) {
    console.log(USAGE);
    return;
  }
  if (flagBool(flags, "styles")) {
    console.log("\nStyle presets:\n");
    for (const style of listStyles()) {
      console.log(`  ${style.id.padEnd(18)} ${style.name}\n  ${" ".repeat(18)} ${style.description}\n`);
    }
    return;
  }

  // The topic can be positional or passed via --topic. Values belonging to
  // other flags must never end up in it (see positionalArgs).
  const topicArg = flag(flags, "topic", "t");
  const topic =
    (typeof topicArg === "string" && topicArg) || positionalArgs().join(" ").trim();

  if (!topic) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const mock = flagBool(flags, "mock");
  const skipRender = flagBool(flags, "skip-render");
  const jsonOut = flagBool(flags, "json");

  // FFmpeg is only strictly required for rendering and audio normalisation —
  // `--skip-render` runs (project inspection, CI lint) are allowed without it.
  if (!hasFfmpeg() && !skipRender) {
    console.error("❌ FFmpeg is required to render (audio normalisation, muxing, cover frames).");
    console.error("   Install FFmpeg, set FFMPEG_PATH, or use --skip-render to build the project only.");
    process.exit(1);
  }
  if (!hasFfmpeg() && skipRender) {
    console.warn("⚠️  FFmpeg not found — building the project only (durations will be estimated).");
  }
  if (!mock && !getGeminiApiKey()) {
    console.error("❌ GEMINI_API_KEY is required (script, voice, images, timing).");
    console.error("   Set it in the environment, in .env, or pass --key.");
    console.error("   Tip: `--mock` builds a full project offline with placeholder assets.");
    process.exit(1);
  }

  const apiKey = flag(flags, "key", "k");
  const options = {
    topic,
    duration: flagNumber(flags, 30, "duration", "d"),
    voice: String(flag(flags, "voice", "v") || "Fenrir"),
    style: String(flag(flags, "style", "s") || "fares-editorial"),
    speed: String(flag(flags, "pace", "speed") || "standard"),
    lang: flag(flags, "lang", "l") || null,
    aspect: String(flag(flags, "aspect") || "9:16"),
    output: flag(flags, "output", "o") ? resolve(String(flag(flags, "output", "o"))) : null,
    outDir: flag(flags, "out-dir") ? resolve(String(flag(flags, "out-dir"))) : null,
    quality: String(flag(flags, "render-quality") || "high"),
    imageQuality: String(flag(flags, "image-quality") || "high"),
    fps: flagNumber(flags, null, "fps"),
    taps: !flagBool(flags, "no-taps"),
    music: flag(flags, "music") ? resolve(String(flag(flags, "music"))) : null,
    musicVolume: flagNumber(flags, 0.16, "music-volume"),
    brand: flag(flags, "brand") || null,
    mock,
    skipRender,
    keepFrames: flagBool(flags, "keep-frames"),
    cover: !flagBool(flags, "no-cover"),
    contactSheet: flagBool(flags, "contact-sheet"),
    log: jsonOut ? () => {} : console.log,
  };

  if (apiKey) process.env.GEMINI_API_KEY = String(apiKey);

  if (!jsonOut) {
    const canvas = options.aspect;
    console.log("\n=======================================================");
    console.log(" 🎬 KINETIC REEL ENGINE");
    console.log("=======================================================");
    console.log(` Topic    ${topic}`);
    console.log(` Length   ~${options.duration}s · ${options.aspect} · ${options.speed} pace`);
    console.log(` Look     ${options.style} · voice ${options.voice}${options.lang ? ` · ${options.lang}` : ""}`);
    console.log(` Models   images: ${options.imageQuality} · render: ${options.quality}${mock ? " · MOCK" : ""}`);
    console.log("=======================================================\n");
  }

  const stageIndex = new Map(STAGES.map((s, i) => [s.key, i]));
  const started = Date.now();

  const result = await produceReel({
    ...options,
    onStage: ({ key, label, detail }) => {
      if (jsonOut) return;
      const step = `[${(stageIndex.get(key) ?? 0) + 1}/${STAGES.length}]`;
      console.log(`${step} ${label}${detail ? ` — ${detail}` : ""}`);
    },
  });

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mp4: result.mp4Path || null,
          cover: result.coverPath || null,
          projectDir: result.projectDir,
          indexHtml: result.indexPath,
          duration: result.totalDuration,
          timingSource: result.timingSource,
          scenes: result.storyboard?.scenes?.length || 0,
          words: result.words?.length || 0,
          title: result.storyboard?.title || topic,
          warnings: result.warnings,
          elapsedMs: result.elapsedMs,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const warning of result.warnings) console.log(`  ⚠️  ${warning}`);

  console.log("\n=======================================================");
  if (result.skippedRender) {
    console.log(" 📐 COMPOSITION READY (render skipped)");
    console.log(` 📁 Project : ${result.projectDir}`);
    console.log(` ▶  Preview : cd "${result.projectDir}" && npx hyperframes preview`);
  } else {
    console.log(" 🎉 VIDEO READY");
    console.log(` 🎥 MP4    : ${result.mp4Path}`);
    if (result.coverPath) console.log(` 🖼  Cover  : ${result.coverPath}`);
    console.log(` 📁 Project: ${result.projectDir}`);
    console.log(` ⏱  Took   : ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  else console.error("   Re-run with DEBUG=1 for the full stack trace.");
  process.exitCode = 1;
});
