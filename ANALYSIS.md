# Kinetic Reel Engine — Technical & Product Analysis

> **Status: audit + rebuild.** The findings below were produced from commit `e6fb8ac`.
> Everything marked ✅ in §0 has since been fixed in this branch (v2.0.0), which
> re-architects the engine around a single goal: **one prompt → the best video it can make**.
> Re-verify anything you rely on against the current source, not this document.

---

## 0. Resolution status (v2.0.0)

| # | Finding (audit) | Status | What changed |
|---|---|---|---|
| F1 | Workflow command injection + open Cloudflare relay | ✅ Fixed | Inputs now reach the shell only via `env:`; `chat_id` validated as digits; the Worker verifies Telegram's secret token, enforces a chat allow-list + hourly rate limit, caps message length and reports GitHub dispatch failures. Workflow runs with `permissions: contents: read`. |
| F2 | "Word alignment" was a proportional guess | ✅ Fixed | Real word timestamps via `gemini-3.5-transcribe`, then a tolerant two-pointer aligner maps them onto the exact spoken script (handles re-spelling, fillers, merges). Falls back to local Whisper, then to an FFmpeg `silencedetect` energy estimate — each step reported in the output. |
| F3 | Hero visuals scraped from Wikimedia, `hero_prompt` discarded | ✅ Fixed | Heroes are generated per scene with Gemini image models, using the scene's own shot description plus the style's art direction and palette. The scraping chain, the banned-terms list and the 5 hardcoded URLs are gone. |
| F4 | Silent CDN dependency could render a caption-free video | ✅ Fixed | GSAP 3.14.2 and the fonts are vendored into every project (`npm run vendor`); a missing runtime sets `data-timeline-error` instead of failing quietly. |
| F5 | Cutout model trained on humans | ✅ Removed | No cutout stage: images are generated already isolated (or as clean editorial plates, per style). |
| F6 | 66 audio cues, no fades, no music | ✅ Fixed | Sub-bass impact per scene keyword, whoosh per cut, taps every 3rd word, all with fade edges; optional music bed; greedy lane packing. ~20 cues for a 30s reel instead of ~79 elements. |
| F7 | No validation, layout checks opted out | ✅ Fixed | `hyperframes check` runs on every build (0 errors / 0 warnings on generated projects), and captions are auto-fitted per scene from the actual text. |
| F8 | Bot bugs: `botnull`, replay on restart, Markdown breakage | ✅ Fixed | Token validated at startup, update offset persisted to disk, MarkdownV2 with full escaping plus a plain-text retry, one render at a time via an internal queue. |
| F9 | Model list drift | ✅ Fixed | Ladders updated to current models (`gemini-3.8-flash`, `3.8-flash-tts`, `gemini-3.5-transcribe`, Nano Banana image models); the shut-down `gemini-3.1-flash-lite-preview` is gone; API key moved to the `x-goog-api-key` header. |
| F10 | Docs, hardcoded paths, stray artifacts | ✅ Fixed | Personal paths removed (PATH/`FFMPEG_PATH` lookup), 7 stray JPEGs deleted, README rewritten, `npm ci` + non-root + `shm_size` + fonts in the image, `npm test` (28 tests) added. |

**Still true in v2 — deliberately out of scope of this pass:** hook A/B variants, batch
generation across styles/voices, `.srt`/`.vtt` caption export, automatic music generation,
a render queue with cost telemetry, and multi-user job storage. See §7 for the product gaps.

---

**Repo:** `bilelBZ/kinetic-reel-engine` · **Commit analysed:** `e6fb8ac` (single squashed commit, 5 Oct 2026) · **Branch:** `arena/80709ae3-kinetic-reel-engine`
**Method:** full read of all 2,667 lines of source, 1 live smoke test of the pure-Node stages (word aligner + composition builder), and cross-verification of every external API/CLI claim against the current Gemini API and HyperFrames documentation (as of 6 Oct 2026).

---

## 1. TL;DR — verdict

**What it is:** a working, opinionated end-to-end pipeline that turns one sentence ("*why does specialty coffee cost so much*") into a finished 1080×1920 MP4 with AI voiceover, kinetic word-by-word captions, an animated hero visual and a synchronised SFX mix — driven from a CLI, a Telegram bot, GitHub Actions, or a Cloudflare Worker relay. The design intent is clear and the scene grammar (storyboard → TTS → timing → composition → render) is the right one.

**Where it stands:** a strong *prototype* that produces a plausible reel on a good day, with three systemic weaknesses:

| Dimension | Score | One-line assessment |
|---|---|---|
| Architecture & flow | 🟢 8/10 | Correct 6-stage pipeline, clean module split, style presets are a genuinely good idea |
| Visual/style design | 🟢 8/10 | The CSS/GSAP kinetic grammar is the best part of the repo |
| Audio design | 🟡 5/10 | Correct TTS call, but the "acoustic alignment" is a heuristic, and it clicks on every single word |
| Asset generation | 🔴 3/10 | Hero visuals come from Wikimedia keyword scraping / a free image service / 5 hardcoded URLs; the LLM-authored `hero_prompt` is thrown away |
| Robustness | 🔴 3/10 | Silent-failure fallbacks everywhere, no validation step, no tests, render depends on CDNs |
| Security & ops | 🔴 2/10 | Command injection in the GitHub workflow + unauthenticated Cloudflare relay; hardcoded personal paths and chat ID |

**Bottom line:** the *engine* is sound, the *inputs* are the problem. The single highest-leverage change is replacing the image-sourcing chain with Google's own image models (`gemini-3.1-flash-image` / `gemini-3-pro-image`, i.e. the Nano Banana family), which are already available on the same API key — the code already writes perfect prompts for them and then ignores them. The second is replacing the hand-rolled word aligner with real word timestamps (`npx hyperframes transcribe` or `gemini-3.5-transcribe`) — HyperFrames ships exactly that tool.

---

## 2. What the utility does today

```
topic + duration + voice + style + pace
        │
   ┌────▼──────────────────────────────────────────────┐
   │ [1] Storyboard — Gemini 3.x Flash (JSON mode)     │  4 model fallbacks → local boilerplate fallback
   │     → title, fullScript, N scenes {text, keyword, │
   │       hero_search, hero_prompt, theme, sfx}       │
   └────┬──────────────────────────────────────────────┘
   ┌────▼──────────────────────────────────────────────┐
   │ [2] Voiceover — Gemini 3.8 Flash(-Lite) TTS       │  POST /v1beta/interactions → base64 WAV
   │     → assets/audio/voice.wav (44.1 kHz mono)      │
   └────┬──────────────────────────────────────────────┘
   ┌────▼──────────────────────────────────────────────┐
   │ [3] "Word alignment" — pure-Node WAV RMS dB       │  char-proportional split + snap to quietest frame
   │     → words.json [{word,time,end,isKeyword}]      │
   └────┬──────────────────────────────────────────────┘
   ┌────▼──────────────────────────────────────────────┐
   │ [4] Hero visuals — Wikimedia → Pollinations →     │  + `npx hyperframes remove-background`
   │     5 hardcoded museum photos, then cutout        │
   └────┬──────────────────────────────────────────────┘
   ┌────▼──────────────────────────────────────────────┐
   │ [5] Composition — HTML + CSS + GSAP, style preset │  scenes, word reveals, camera push, ribbon, SFX
   └────┬──────────────────────────────────────────────┘
   ┌────▼──────────────────────────────────────────────┐
   │ [6] Render — `npx hyperframes render -o out.mp4`  │  Chromium + FFmpeg
   └───────────────────────────────────────────────────┘
```

**Four entry points, all wired to the same pipeline:**

| Entry point | File | Notes |
|---|---|---|
| CLI | `create-reel.mjs` | 8 flags, `--skip-render` for fast iteration |
| Telegram bot | `telegram-bot.mjs` | NL parsing (duration/voice/lang/style/pace), live status edits, mobile re-encode, `sendVideo` |
| GitHub Actions | `.github/workflows/generate-reel.yml` | manual dispatch → artifact + Telegram push |
| Cloudflare Worker | `cloudflare-worker.js` | Telegram webhook → GitHub `workflow_dispatch` (free 24/7 relay, no server) |
| Windows launcher | `Run-KineticReel.ps1` | interactive wrapper |

---

## 3. Architecture map

| File | LOC | Role | Quality |
|---|---:|---|---|
| `create-reel.mjs` | 231 | CLI orchestrator, project scaffolding | Clean |
| `telegram-bot.mjs` | 390 | Bot daemon + NL prompt parser + re-encode + upload | Good logic, weak error handling |
| `lib/gemini-ai.mjs` | 591 | Storyboard, TTS, hero-image sourcing, fallbacks | Mixed — best and worst code in the repo |
| `lib/word-aligner.mjs` | 211 | WAV parsing, RMS envelope, word timing | Honest maths, but not what the README claims |
| `lib/composition-builder.mjs` | 348 | HTML/GSAP/SFX assembly, polyphonic track allocation | The core asset — genuinely thoughtful |
| `lib/styles/*.mjs` | 96 × 4 + 264 | 4 palettes/layouts/animation presets + CSS generator | Excellent separation of concerns |
| `lib/renderer.mjs` | 41 | `npx hyperframes render` wrapper | Fine, fragile arg handling |
| `lib/cutout-engine.mjs` | 57 | `npx hyperframes remove-background` wrapper | Wrong model for the job (see F5) |
| `lib/env.mjs` | 12 | FFmpeg resolution | Contains a hardcoded personal path |
| `cloudflare-worker.js` | 71 | Telegram→GitHub relay | Security hole (see F1) |
| `.github/workflows/generate-reel.yml` | 76 | Cloud render job | Injection hole + hardcoded chat ID |
| `templates/assets/` | 1.4 MB | 19 SFX (Pixabay) + Inter WOFF2 + manifest | Good, but fonts unused |

**Style presets** (the standout design decision): `fares-editorial` (obsidian + `#FF2E36`), `swiss-editorial` (cream/ink + Swiss red), `cyber-matrix` (navy + `#00F5FF`), `minimal-luxury` (charcoal + `#F59E0B`), each with palette, layout metrics, GSAP animation curves and an SFX map. Adding a 5th style is a ~90-line file. This is the part of the repo I'd protect from refactors.

---

## 4. What's genuinely well done

1. **Style/preset abstraction** — palette + layout + animation + SFX in one object, expanded to CSS by `generateStylesCss()`. Rare in hobby projects and the reason the output looks designed rather than default.
2. **The kinetic grammar itself** — staggered `.ln/.i1/.i2` line indents, blur-to-sharp reveals (`.w { opacity: 0; filter: blur(14px) }` animated by GSAP `fromTo`), keyword "slam" at larger font size with glow + screen shake, camera push-in per scene, SVG ribbon draw-on with `pathLength="1"`. This is a real understanding of the reference style.
3. **Polyphonic SFX track allocation** (`composition-builder.mjs:98-105`) — greedy lane packing starting at track 11 so cues never collide with the voice track 10. A correct solve for a real problem.
4. **Genuinely resilient fallback chains** — TTS 429 → rotate model; storyboard 503 → local boilerplate; WAV parse → FFmpeg → silence; cutout → copy original; render failure → throw. Nothing crashes the pipeline.
5. **Telegram UX** — `editMessageText` progress across 5 steps, mobile re-encode (CRF 23), `supports_streaming`, retry ×3 on upload.
6. **Security hygiene where it counts** — `.gitignore` covers `.env`, `scratch/`, `*.mp4`; `.env.example` provided; no key committed.

---

## 5. Findings

Severity: **🔴 High** (fix before more users / before public), **🟠 Medium**, **🟡 Low**.

### 🔴 F1 — GitHub Actions command injection + open Cloudflare relay
`.github/workflows/generate-reel.yml:49`

```yaml
node create-reel.mjs \
  --topic "${{ github.event.inputs.topic }}" \
```

`${{ }}` is substituted **before** the shell sees the line, inside double quotes. Any topic containing `"` and `$(…)` executes arbitrary commands in the runner — where `GEMINI_API_KEY` and `TELEGRAM_BOT_TOKEN` are present in the job environment. The input is fully attacker-controlled: `cloudflare-worker.js` forwards the raw Telegram text into `inputs.topic` with **no `X-Telegram-Bot-Api-Secret-Token` check, no allow-list of chat IDs, and no rate limiting**, and it returns `"Triggered"` without even checking `ghRes.ok`. Anyone who learns the Worker URL can POST a fake Telegram update JSON and drive the workflow.

Aggravating: `chat_id` defaults to a personal ID (`generate-reel.yml:21`), so every dispatch pushes a video to that chat — free compute and a spam vector.

**Fix:** pass inputs via `env:` and use `--topic "$TOPIC"` (or an env var read inside Node); set `secret_token` on the Telegram webhook and verify the header in the Worker; allow-list `chat.id`; rate-limit; check `ghRes.ok`; drop the hardcoded default chat ID.

### 🔴 F2 — The "acoustic word alignment" is a proportional estimate
`lib/word-aligner.mjs:140, 163-192`

The README sells "Alignement Acoustique Mot par Mot". What the code does:

1. `findSpeechSegments()` is computed at line 140 into `detectedSegs` — and **never read again** (grep-verified: the only two occurrences in the repo are the definition and this assignment). Dead code.
2. Each scene's duration is `sceneText.length / totalChars × (audioDuration − 0.6)` — a character-count proportion, ignoring pauses, emphasis and pacing.
3. Each word start is then nudged to the **quietest 10 ms frame within ±80 ms** of that estimate (`lib/word-aligner.mjs:173-186`, `searchRadius = 8`).

So actual speech onsets are never detected; only local minima of the envelope are used to de-jitter a guess. **Live smoke test** (synthetic 6.0 s WAV, speech only between 1.0–3.0 s and 4.0–5.8 s):

```
AUDIO DURATION PARSED: 8   WORDS: 16
FIRST 4: Le@0.12  cafe@0.30  de@0.52  specialite@0.70   ← audio is silent until t=1.0s
SCENE3 first word time: 3.51                            ← inside the 3.0–4.0s silence
```

Captions land ~0.9 s early on the first scene and the whole tail drifts. It's also unclamped: `wordStart += wordDuration` accumulates without ever being clamped to `sceneEnd`, and scene ranges are derived as "next scene's first word − 0.05 s" (`composition-builder.mjs:40-53`) — so alignment error propagates into scene cuts landing mid-word.

**Fix (choose one):**
- `npx hyperframes transcribe voice.wav` → `transcript.json` with real word-level `{text, start, end}` — HyperFrames ships this locally (Whisper); requires Python 3.8+ with `faster-whisper` in the image.
- or `gemini-3.5-transcribe` (Gemini's STT model, explicitly documented as having *word-level timestamps*), callable with the key already in use — no image change needed.
- Or, at minimum, use `detectedSegs` to distribute words inside real speech segments instead of across the whole file.

### 🔴 F3 — Hero visuals are the weakest link (and the LLM prompt is discarded)
`lib/gemini-ai.mjs:442-591`

Three tiers, none of which produce "isolated 3D render on a dark background":

1. **Wikimedia Commons keyword search** — first hit passing a substring blacklist, ≥500×400 px, >8 KB. No semantic validation. It returns a *documentary photo*: museum display cases, brick walls, library shelves. The storyboard prompt explicitly demands `"isolated 3D render … floating, dark background, 8k, Octane render"`; Commons cannot deliver that.
   The exclusion string even contradicts the brief: the search appends `-coin` while the system prompt uses `'golden coins stack'` as a model example.
2. **Pollinations** (a free third-party service) at 512×512, then a blind `crop=in_w:in_h-36:0:0` to remove a watermark strip — a hardcoded pixel hack that breaks whenever the upstream layout changes.
3. **5 hardcoded Wikimedia URLs** (pocket watch, compass, "Time Twist", moon, coffee beans) selected by `sceneIndex % 5` — meaning *every* reel that reaches Tier 3 shows the same objects as every other reel, regardless of topic.

And the storyboard's `hero_prompt` — carefully generated and paid for — is **never used**. `generateHeroImage({prompt, keyword, heroTitle, heroSearch})` only reads `heroSearch`; Tier 2 even rebuilds its own prompt from `heroSearch`. Three of four parameters are dead.

**Fix:** generate the hero with the same API key — `gemini-3.1-flash-image` (Nano Banana 2), `gemini-3-pro-image` (Nano Banana Pro) or `gemini-nano-banana-2.1` — using `hero_prompt` verbatim, and it's tunable in a way the current chain is not (e.g. a documentary/editorial *photo* look vs. an isolated 3D render, per style preset). Cost is a few cents per reel and it removes Tier 1/2/3 entirely.

### 🔴 F4 — The render silently depends on two CDNs
`lib/composition-builder.mjs:317-320`

```html
<link href="https://fonts.googleapis.com/css2?family=Cairo…&family=Inter…" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
```

HyperFrames' own contract is explicit that a composition should avoid render-time network requests so that "for the same source, media and settings, an exact timestamp resolves to the same project state" ([docs](https://hyperframes.heygen.com/concepts/index.md)). Worse, the failure is silent and catastrophic: if GSAP fails to load, `window.__timelines.main` is never registered, so **every `.w` stays at `opacity: 0; filter: blur(14px)`** (`.w` rule in `lib/styles/index.mjs:234-245`) and the runtime waits out its `player-ready-timeout`. You get a hero image on black with **no captions at all** and exit code 0.

Also: `templates/assets/fonts/Inter-Bold.woff2` and `Inter-SemiBold.woff2` are bundled into every project and never referenced by any `@font-face` — dead weight in 1.4 MB of copied assets.

**Fix:** vendor GSAP into `templates/assets/vendor/`, self-host the two WOFF2 files with `@font-face` (removing the Google Fonts request entirely), and fail loudly if `window.__timelines` is not registered.

### 🟠 F5 — The cutout model is trained on people, not objects
`lib/cutout-engine.mjs:23`

It shells out to `npx hyperframes remove-background`, whose bundled model is `u2net_human_seg` (MIT, ~168 MB weights) — a *human* segmentation network ([HyperFrames media reference](https://skills.mercuryagent.sh/skills/development/hyperframes-media)). The heroes here are compasses, pocket watches, coffee beans, hourglasses. On such subjects the mask is unreliable, and when it fails the wrapper **copies the original file** (`cutout-engine.mjs:39,50`) with only a `console.warn`. Because `.hero-visual` carries `border-radius: 28px` (`lib/styles/index.mjs:199`), the viewer then sees exactly what the README claims to have eliminated: a photo in a rounded box on a black stage — including whatever bright background the Commons photo had.

**Fix:** generate the hero already isolated (F3) and drop the cutout stage, or use a general-saliency/`u2net`-full model instead of the human variant, and make the fallback visible in the UI/status message rather than silent.

### 🟠 F6 — SFX on *every* word, with no fades, no music, no ducking
`lib/composition-builder.mjs:48-105`

One cue per word: keyword → `impact-bass-1/2` (1.5 s duration, volume 0.85), every other word → `click.mp3` at 0.12 s. On a 30 s / 6-scene reel (~72 words) that is **66 clicks + 6 sub-bass impacts + 7 whooshes ≈ 79 `<audio>` elements** in one HTML file:

```
total word cues: 72  impacts: 6  clicks: 66
sum of click durations: 7.9 s of the 30s timeline
audio elements written into index.html: 79
```

Risks: (a) machine-gun ticking under the voice on fast French/Arabic delivery — the reference style uses taps *sparingly*; (b) no `data-fade-in`/`data-fade-out` even though HyperFrames supports clip-edge fades, so cue boundaries can pop; (c) the 1.5–2.6 s impacts overlap the following 3–4 words; (d) **no music bed at all** and no voice-over-a-music ducking — both are first-class features of the framework (and Lyria 3.5 / Lyria 3 Clip are available on the same Google key for a 30 s bed).

**Fix:** make taps opt-in per pace (`rapid` only, or every 2nd–3rd word), add `data-fade-out="0.05"` on taps and short fades on impacts, and add an optional music bed lane with `--duck`-style automation.

### 🟠 F7 — No validation before render; layout diagnostics are opted out of
`lib/renderer.mjs` renders directly. HyperFrames provides `npx hyperframes check` (lint + runtime + layout + motion + contrast), `lint` and `snapshot --at <t>` — none are used, in CLI, bot or CI. Meanwhile `composition-builder.mjs` stamps **19 `data-layout-allow-*` attributes on the generated 3-scene file** (7 overlap, 7 overflow, 3 occlusion; it scales with scene count), i.e. it opts out of the very checks that would flag caption overflow. With `wordFontSize: 88px` and `keywordFontSize: 136px` in a 960 px-wide caption box, a 4-word line will wrap or overflow — and nothing reports it.

**Fix:** run `npx hyperframes check --json` after build (fail the render on error-level findings), `snapshot` at each scene midpoint for a visual smoke test, and remove the blanket allow-* attributes on the caption container.

### 🟠 F8 — Telegram bot: three bugs that lose or duplicate work
`telegram-bot.mjs`

1. **`botnull`** — `const TOKEN = getTelegramToken()` then `const API_BASE = \`https://api.telegram.org/bot${TOKEN}\`` (`telegram-bot.mjs:40-41`) with no validation. A missing `.env` produces `https://api.telegram.org/botnull/getUpdates`; the failure surfaces as a generic fetch error and the process keeps polling.
2. **Replays on restart** — `let lastUpdateId = 0` (`telegram-bot.mjs:363`), never persisted. Telegram retains updates for 24 h, so a restart after downtime re-processes old messages and **regenerates (and re-charges) videos** the user already got. Persist the offset to disk, and drop updates older than a few minutes at startup.
3. **Markdown breakage + unreachable error path** — the status message interpolates the raw user topic into a `parse_mode: "Markdown"` payload (`telegram-bot.mjs:198-202`), so any `*`, `_`, `` ` `` or `[` in the topic makes Telegram return 400 "can't parse entities". The first `sendMessage` sits **outside** the `try`, so if it throws the user receives nothing at all; the catch block then uses backticks in Markdown, which can fail the same way. Use `MarkdownV2` with escaping, or plain text.

Also: no queue — N messages = N concurrent Chromium renders in the same container (no `shm_size`, no memory limit); the README advertises 4 styles but the bot only offers regex detection, no `/style` command or inline keyboard.

### 🟡 F9 — Model list drift (mostly harmless, one dead ID)
Verified against the [current model list](https://ai.google.dev/gemini-api/docs/models):

| Used in code | Status today |
|---|---|
| `gemini-3.8-flash-lite-tts`, `gemini-3.8-flash-tts` | ✅ current **stable** TTS models |
| `gemini-3-flash-preview` | ✅ valid (Preview) |
| `gemini-3.1-flash-lite-preview` | ❌ **Shut down** — see "Previous models" |
| `gemini-flash-latest`, `gemini-flash-lite-latest` | ✅ valid "latest" aliases |

The dead ID only costs a wasted round-trip pair before the loop falls through to the alias — but it's worth pruning, and adding `gemini-3.8-flash` (current flagship stable) as the first candidate would improve script quality.

The **TTS request itself is correct** — I verified the payload against the official REST example: `POST /v1beta/interactions` with `input[].type = "user_input"`, `response_format: {type: "audio"}`, `generation_config.speech_config[].voice`, and the reply read from `steps[] → model_output → content[] → type: "audio" → .data` is exactly the documented path. Two notes: the docs take `last` audio block, the code takes `[0]`; and the TTS models now support **turn-level `annotations: [{type: "speech_metadata", style, speaker}]`** — meaning pace/tone control ("punchy, editorial, slightly urgent") is available for free and is currently unused.

### 🟡 F10 — Docs, secrecy and repo hygiene
- **README** claims "Powered by **Gemini 2.0** Flash/Audio" (both 2.0 models are shut down) and "**Modèle Local U2Net**" (it's `u2net_human_seg`, and it runs via `npx`, not locally vendored). It documents 5 of the 8 CLI options — `--style` and `--speed`/`--pace` exist in code but only appear in the table, not in the usage block `create-reel.mjs:66-76`.
- **Hardcoded personal paths** in 5 places (`lib/env.mjs:7`, `lib/renderer.mjs:5`, `telegram-bot.mjs:22`, `Run-KineticReel.ps1:10`, `CLOUD_DEPLOY.md:47`) expose a Windows username and silently no-op on other machines. Use `which/where ffmpeg` or an `FFMPEG_PATH` env var.
- **Committed test artifacts**: 7 JPEGs at the repo root (~870 KB) including a 2-byte `test-flux.jpg` (corrupt) and samples named `dome-wiki`, `pollinations-sample`, `unsplash-arch`. They belong in `scratch/` (already ignored) or out of the repo.
- **Dockerfile**: `npm install --production` instead of `npm ci` despite a committed lockfile; Chromium runs as **root without `--no-sandbox`** (classic container crash); no `shm_size` bump in `docker-compose.yml`; no Python, which `hyperframes tts/transcribe` would require; no `LICENSE` file (only SFX credits); no `test`/`lint` script in `package.json`.
- **API key in the query string** (`gemini-ai.mjs:261`: `?key=${key}`) rather than the documented `x-goog-api-key` header used elsewhere in the same file — URLs land in logs and error traces more readily.
- **Single squashed commit**, no branch history, no tests, no CI other than the render job. `git log` yields one "docs:" commit for 2.6k lines.

---

## 6. What a produced reel actually looks like

Honest reconstruction from the code:

- **Voice**: genuinely good — a current, expressive Gemini 3.8 TTS voice.
- **Captions**: the visual highlight. Blur-to-sharp word reveals, indented stagger, red keyword slam with shake. But timing is approximate (F2) and a long line can wrap or overflow (F7).
- **Hero visual**: the weakest frame. In the common case the viewer sees a Wikimedia documentary photo (bright, busy background) inside a 28 px-rounded box on obsidian black, with a red aura behind it — the opposite of the "isolated floating 3D object" the style demands (F3/F5).
- **Audio bed**: no music, and 66 clicks under the voice (F6).
- **Pacing**: scene cuts derived from word timings that may be off by several hundred ms (F2).
- **Packaging**: no hook optimisation, no CTA/outro card, no .srt export, no cover frame, no safe-zone check for platform UI overlays, no variant generation.

---

## 7. Product gaps for a "social reels" utility

The pipeline answers *"make me a reel"*. A shippable social-media product also needs:

| Gap | Why it matters | Effort |
|---|---|---|
| **Hook variants** — generate 3 openings for a topic, render, pick the best | The first 1.5 s decides retention; this is the single biggest lever on performance | M |
| **Batch mode** — one topic → N reels across styles/voices | Volume is how these accounts grow | S |
| **Captions export (.srt/.vtt)** + burned-in toggle | Repurposing for YouTube/TikTok auto-captions | S |
| **Cover/thumbnail frame** (`npx hyperframes snapshot --at <t>`) | Required for every platform upload | S |
| **Music bed + auto-ducking** (Lyria 3 Clip ≤30 s, or a licensed library) | Reels without music feel unfinished | M |
| **Safe-zone enforcement** for IG/TikTok UI overlay regions | Captions hidden behind a UI bar = wasted work | S |
| **Brand kit** (logo watermark, end card, palette) | Client/agency requirement; a reusable "variables" use case in HyperFrames | M |
| **Cost/latency telemetry per reel** + a render queue | You can't price or scale what you don't measure; currently every message spawns a render | M |
| **Idempotent, retry-safe job store** (instead of in-memory `lastUpdateId`) | Prerequisite for any multi-user deployment | M |

---

## 8. Recommended roadmap

**Now — same-day, low risk (each is a few lines or an env var)**
1. Kill the workflow injection: move `topic`/`chat_id` to `env:` and quote in the shell; add webhook secret validation + chat allow-list to `cloudflare-worker.js`; check `ghRes.ok`; remove the default personal `chat_id`. *(F1)*
2. Validate `TELEGRAM_BOT_TOKEN` at startup, persist `lastUpdateId`, move the first status message inside the `try`, stop using Markdown for user text. *(F8)*
3. Vendor GSAP + self-host the two Inter WOFF2 files; throw if `window.__timelines` isn't registered. *(F4)*
4. `npx hyperframes check --json` between build and render. *(F7)*
5. Prune the dead `gemini-3.1-flash-lite-preview`, add `gemini-3.8-flash`, and switch the storyboard call to `x-goog-api-key`. *(F9)*
6. Delete the 7 root JPEGs, parameterise the FFmpeg path, `npm ci` + non-root + `shm_size: 1gb`, add a LICENSE. *(F10)*

**Next — the two changes that move output quality**
7. **Real word timestamps**: `npx hyperframes transcribe` (local Whisper) or `gemini-3.5-transcribe`; feed `{word,start,end}` into `composition-builder` unchanged (the interface already matches), delete `findSpeechSegments` or use it. *(F2)*
8. **Generate the hero with `hero_prompt`** via `gemini-3.1-flash-image` / `gemini-3-pro-image`; drop the cutout stage or keep it only as a fallback for photo-mode styles. *(F3, F5)*

**Later — product**
9. Rework SFX density + fades, add a Lyria music bed with ducking. *(F6)*
10. Hook variants, batch mode, .srt export, cover frame, safe zones, brand kit. *(§7)*
11. Per-style voice/persona presets (e.g. `fares-editorial` → Fenrir + punchy `speech_metadata` style, `minimal-luxury` → Charon + calm), using the TTS `annotations` feature.

**Optional consolidation:** `npx hyperframes tts` (Kokoro-82M, 54 voices, French voices via the `f` prefix, no API key) could remove the Gemini TTS dependency and its quota entirely for batch rendering — at the cost of Python in the image and slightly less natural French than Gemini 3.8. Worth benchmarking A/B against the current voice before deciding.

---

## 9. Appendix — verification log

### v2.0.0 (this branch) — what was actually executed

**Ran and passing**
- `npm test` → **28/28 tests**, covering: word-time alignment against a messy transcript
  (re-punctuation, inserted fillers, merged words), scene ranges that must not cut mid-word,
  caption auto-fit, the audio cue graph (lane collisions, tap density, fades, bounds), the
  "no remote asset at render time" contract, seek-safe timelines (no `tl.call`), placeholder
  PNG encoding, the prompt parser (FR/EN/AR + the `sec`/`secondes` trap), and CLI helpers.
- `npx hyperframes check` on generated projects → **0 errors, 0 warnings** (real linter
  output against the current composition contract).
- Offline end-to-end runs (`--mock --skip-render`) for `9:16` and `4:5`, `fares-editorial`
  and `cyber-matrix`: 9 scenes / 76–82 words / ~31–34 s timeline, valid `index.html`,
  `storyboard.json`, `words.json`, `meta.json`, JS/HTML-escaped content, no CDN references.
- `node scripts/vendor-runtime.mjs` → vendors GSAP 3.14.2; the Arabic font step degrades
  with an actionable message when the network is unavailable.

**Not executed in this sandbox (no network to Google, no FFmpeg, no browser)**
- Live Gemini calls: storyboard, TTS, transcription, image generation. Payload shapes were
  verified against the vendor docs instead (see below), and every call site is fallback-guarded.
- A real `hyperframes render` (needs Chromium + FFmpeg). Structure, linter results and the
  timeline logic were validated offline; the first real render is the remaining unknown.

**Bugs found and fixed during this pass** (all caught by the offline runs, none by reading):
1. `--cap-size:NaNpx` — style presets store lengths as CSS strings (`"88px"`) and were used
   in arithmetic. Captions would have silently fallen back to ~16 px.
2. Scene cuts landing mid-word — a transition could start before the previous scene's last
   word finished.
3. Too many scenes — a 30 s reel was asking for 12 scenes (and 12 image generations).
4. `sec` matched inside `secondes` in the bot parser, leaving "ondes" in the topic.
5. `--flag` followed by a `-x` short flag swallowed the short flag in the CLI arg parser.
6. `tl.call()` used for scene visibility — GSAP does not fire callbacks when a paused
   timeline is *seeked*, which is exactly how HyperFrames renders each frame.
7. `import` of the bot started long-polling (no entry-point guard), making tests hang.

### Original audit (commit `e6fb8ac`) — external facts checked (6 Oct 2026)

**Exercised locally**
- `alignWordsWithAudio()` on a synthetic 44.1 kHz mono WAV with known silence (6.0 s) → confirmed proportional placement and drift (numbers in F2).
- `buildCompositionHtml()` end-to-end with 3 scenes / 16 words → valid 20 KB HTML, 3 `<section>`, 20 `<audio>`, 19 layout-escape attributes; inspected the head (CDN links) and the GSAP timeline block.
- `npm view hyperframes` → latest `0.8.138`; the pinned `^0.8.111` in `package.json` resolves fine.
- `hyperframes render`, `remove-background`, `tts`, `transcribe`, `check`, `snapshot` all exist in the current CLI.
- Outbound network to `generativelanguage.googleapis.com` is blocked in this sandbox (TLS), so no live API call was made; API claims below are verified against vendor docs instead.

**External facts checked** (6 Oct 2026)
- TTS endpoint/payload/response path — [Gemini API speech generation](https://ai.google.dev/gemini-api/docs/speech-generation).
- Model IDs and statuses (`gemini-3.8-flash-tts`, `-lite-tts` stable; `gemini-3.1-flash-lite-preview` shut down; 2.0 family shut down; Nano Banana 2/Pro image IDs; `gemini-3.5-transcribe` word timestamps; Lyria 3.5 / Lyria 3 Clip) — [Gemini API models](https://ai.google.dev/gemini-api/docs/models).
- Composition contract (`data-duration` semantics, `data-volume`, `data-fade-in/out`, determinism / no render-time network) — [html-schema](https://hyperframes.heygen.com/reference/html-schema.md), [how a project works](https://hyperframes.heygen.com/concepts/index.md).
- `remove-background` uses `u2net_human_seg`; `transcribe` output shape `{id,text,start,end}`; `tts` voices/requirements — [HyperFrames media reference](https://skills.mercuryagent.sh/skills/development/hyperframes-media), [HyperFrames CLI](https://hyperframes.heygen.com/packages/cli.md).
- HyperFrames' render contract for HTML compositions, incl. "every timed `<video>` must declare muted or has-audio" and `npx hyperframes check` as the validation gate — [2](https://mcpservers.org/agent-skills/heygen-com/hyperframes-core), [3](https://hyperframes.heygen.com/guides/remove-background).
