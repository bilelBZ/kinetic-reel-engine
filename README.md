# 🎬 Kinetic Reel Engine

**One prompt in. One finished vertical video out.**

Send a topic — get back a 1080×1920 MP4 with an AI voiceover, kinetic captions synced
word-by-word to that voiceover, generated hero visuals, mixed sound design, and a cover frame.

```bash
node create-reel.mjs "why specialty coffee costs so much" --duration 30
```

<p align="center">
  <em>script → voice → word timings → hero art → composition → MP4, in one command</em>
</p>

---

## Why it looks good (the part that matters)

| What | How |
|---|---|
| **Captions land on the syllable** | Word timestamps come from a real transcriber (`gemini-3.5-transcribe`), then are aligned to the exact script that was spoken. No proportional guessing. |
| **Captions never overflow** | Type size is solved per scene from the actual line length, so a 3-word punch line and a 12-word sentence both fill the frame correctly. |
| **Visuals are generated, not scraped** | One hero image per scene from Gemini image models, prompted with each scene's own shot description plus the style's art direction. |
| **Renders are deterministic** | GSAP and the fonts are vendored into the project. Nothing is fetched at render time, so a network hiccup can't produce a caption-free video. |
| **The timeline is seek-safe** | Every animation is a tween or a set — never a callback — because the renderer seeks to each frame instead of playing through. |
| **Sound design, not noise** | Sub-bass impact on each scene's keyword, a whoosh on every cut, and light taps every third word (all with fade edges). Optional music bed under the voice. |
| **Motion is layered** | Per-scene camera move (push, pull, lateral, parallax), a hero entrance with overshoot plus ambient float, staggered caption lines, a drawing ribbon, an eyebrow label and a retention progress bar. |

---

## Requirements

- **Node.js ≥ 22**
- **FFmpeg** on `PATH` (or `FFMPEG_PATH`) — needed to render
- **A Google AI Studio key** (`GEMINI_API_KEY`) — powers script, voice, images and timings
- A Chromium build for HyperFrames (`npx hyperframes browser ensure` installs one)

## Install

```bash
npm install
npm run vendor          # vendors GSAP + fonts for offline renders
export GEMINI_API_KEY=...   # or put it in .env
```

## Use

```bash
# A 30-second reel in the default dark editorial style
node create-reel.mjs "3 mistakes that kill a startup"

# Pick the look, the voice and the rhythm
node create-reel.mjs "3 mistakes that kill a startup" \
  --duration 45 --style cyber --voice Charon --pace rapid --lang English

# Square post instead of a reel
node create-reel.mjs "why espresso costs so much" --aspect 1:1

# Everything the engine can do
node create-reel.mjs "your topic" \
  --image-quality max        # try the best image models first (slower, sharper)
  --render-quality best      # highest render quality
  --contact-sheet            # write a frame grid for quick review
  --music bed.mp3            # mix a music bed under the voice
  --brand "@yourhandle"      # small persistent watermark
```

### CLI reference

| Option | Description | Default |
|---|---|---|
| `"<topic>"` | Topic, idea or full script (positional) | *required* |
| `-d, --duration <sec>` | Target length — also sets the script's word budget | `30` |
| `-v, --voice <name>` | `Fenrir`, `Puck`, `Charon`, `Kore`, `Aoede` | `Fenrir` |
| `-s, --style <name>` | `fares-editorial`, `swiss-editorial`, `cyber-matrix`, `minimal-luxury` | `fares-editorial` |
| `-l, --lang <language>` | `French`, `English`, `Arabic`, … | auto-detected |
| `--pace <preset>` | `calm`, `standard`, `rapid` | `standard` |
| `--aspect <ratio>` | `9:16`, `4:5`, `1:1`, `16:9` | `9:16` |
| `--image-quality <t>` | `high` (fast model first) or `max` (best model first) | `high` |
| `--render-quality <t>` | `fast`, `high`, `best` | `high` |
| `--fps <n>` | Force a frame rate | source |
| `--no-taps` | Drop the per-word acoustic taps | off |
| `--music <file>` / `--music-volume <0-1>` | Music bed under the voice | none / `0.16` |
| `--brand <text>` | Persistent watermark line | none |
| `--no-cover` | Skip the JPG cover frame | cover on |
| `--contact-sheet` | Write a frame grid for review | off |
| `-o, --output <file>` | MP4 destination | project dir |
| `--out-dir <dir>` | Where projects are created | `./scratch` |
| `--skip-render` | Build the project + `index.html`, stop before rendering | off |
| `--mock` | Offline dry run: no API calls, placeholder assets | off |
| `--json` | Machine-readable result on stdout | off |
| `--styles` | List the style presets | — |

Every project is left on disk (`index.html`, `storyboard.json`, `words.json`, `meta.json`,
`assets/`) so you can open it in HyperFrames Studio and keep editing:

```bash
cd scratch/<project> && npx hyperframes preview
```

---

## The pipeline

```
prompt + duration + style + pace
      │
 [1]  │  Storyboard        gemini-3.8-flash
      │  → hook, scenes, keyword per scene, hero shot description, art direction,
      │    and a word budget that makes the video land near the requested length
 [2]  │  Voiceover         gemini-3.8-flash-tts  (style-directed via speech metadata)
      │  → 48 kHz mono WAV
 [3]  │  Word timings      gemini-3.5-transcribe → aligned to the exact spoken script
      │  → real {start, end} per word, scene cuts placed inside the pauses
 [4]  │  Hero visuals      gemini-3-pro-image / nano-banana (per-scene prompt)
 [5]  │  Composition       HTML + CSS + GSAP + mixed audio, validated by `hyperframes check`
 [6]  │  Render            HyperFrames → MP4, mobile-optimised, plus a cover frame
```

**Model ladders.** Each stage has an ordered list of models and degrades to the next one
on quota or availability, so a single failing model never stops a render. Text, TTS and
image model IDs live at the top of `lib/gemini-ai.mjs`.

**Failure policy.** Every stage has a floor: a local storyboard if the text model is down,
an energy-based timing estimate if transcription fails, a styled placeholder plate if image
generation fails. Warnings are printed and recorded in `meta.json` — nothing fails silently.

---

## Telegram bot

```bash
npm run bot
```

Send an idea from your phone and get the video back:

> *Fais-moi un reel de 30s sur le cafe de specialite avec la voix Fenrir en style cyber rapide*

The parser understands duration, voice, style, pace, language and aspect in French,
English and Arabic, and strips the instruction wrapper so only your idea reaches the model.
The bot renders one video at a time, edits a live status message as stages complete, and
persists its update offset so a restart never re-renders (and re-charges) old requests.

### Cloud options

- **GitHub Actions** — `.github/workflows/generate-reel.yml` renders on a runner and can
  deliver to Telegram. Inputs are passed through `env:` (never interpolated into the shell),
  and `chat_id` is validated as digits.
- **Cloudflare Worker** — `cloudflare-worker.js` relays a Telegram webhook to that workflow
  for a free 24/7 bot. It verifies Telegram's secret token, enforces a chat allow-list and a
  per-chat rate limit, and reports GitHub dispatch failures instead of pretending success.
- **Docker** — `docker compose up -d --build` runs the bot with FFmpeg, Chromium and the
  fonts baked in, as a non-root user with `shm_size: 1gb`.

See [CLOUD_DEPLOY.md](CLOUD_DEPLOY.md).

---

## Configuration

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Required. Google AI Studio key. |
| `TELEGRAM_BOT_TOKEN` | Only for the bot front-end. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Point at specific binaries when they are not on `PATH`. |
| `HYPERFRAMES_BROWSER_PATH` | Use a specific Chrome/Chromium build. |
| `HYPERFRAMES_NO_UPDATE_CHECK=1` | Silence the CLI update check in CI. |
| `DEBUG=1` | Full stack traces on failure. |

## Tests

```bash
npm test        # 28 tests: timing alignment, caption fitting, audio graph, parser, assets
npm run demo    # offline end-to-end project build, no API key needed
```

The tests cover the parts that silently ruin a video: word-time alignment against a messy
transcript, scene cuts that must not land mid-word, caption auto-fit, the audio cue graph
(lane collisions, sparse taps, fades), the "no CDN at render time" contract, and the
prompt parser's edge cases.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `FFmpeg is required` | Install FFmpeg or set `FFMPEG_PATH`. |
| Render produces no captions | `assets/vendor/gsap.min.js` is missing — run `npm run vendor`. The composition sets `data-timeline-error` in that case instead of failing silently. |
| Arabic text shows boxes | No Arabic font on the host. Run `npm run vendor` with network access (fetches Cairo), or install `fonts-noto-core`. |
| `Voice synthesis failed on all models` | Quota exhausted on every TTS model in the ladder, or the key lacks access. |
| Word sync says `energy-estimate` | Transcription was unavailable; timings are approximate. Check the warning in the output. |
| Render is slow | `--render-quality high` is the default. Use `fast` while iterating, `best` for delivery. |

## License

MIT. Bundled sound effects are from Pixabay (see `templates/assets/audio/sfx/CREDITS.md`);
GSAP is used under its standard license.
