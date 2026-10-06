# Kinetic Reel Engine — Improvement Plan

**Goal:** the tool should reliably produce videos that are *postable* — not just rendered.
For social content that means three things stacked in this order:

1. **It gets watched** — the hook lands, the pacing holds, the captions read on mute.
2. **It looks expensive** — graded, mixed, deliberately typeset, consistent across a series.
3. **It ships at volume** — fast enough, cheap enough, reviewable, and correct for each platform.

Everything below is ordered by *impact on those three*, not by how interesting it is to build.

---

## 0. The quality bar (make "high quality" measurable)

A plan without a bar is a wish list. These are the SLOs the tool should assert on every render.
Numbers marked ⚑ are targets to confirm against the first real renders — Phase 0 sets the baseline.

| Dimension | Target | How it gets verified |
|---|---|---|
| **Sync accuracy** | Caption onset within **±80 ms (P90)** of the spoken onset; keyword impact within ±60 ms of the stressed syllable | Compare cue times in `words.json` against transcriber timestamps; assert no word fires before its timestamp and no cut precedes the previous scene's last word end |
| **Legibility** | No line outside the safe zone; ≥ 44 px min type at 1080w; ≤ 3 lines; contrast ≥ 4.5:1 | Build-time bounds check from a glyph-advance table + safe-zone profile assertion |
| **Loudness** | **−14 LUFS** integrated, true peak ≤ −1 dBTP, music ≥ 12 LU below voice | `ffmpeg loudnorm` measurement (analysis pass) + `hyperframes normalize-audio` |
| **Duration** | Within **±5 %** of the requested length | Word-count budget vs measured WAV duration |
| **Hook** | First word lands ≤ 400 ms; first cut ≤ 3 s | Timeline assertion |
| **Reliability** | ≥ 99 % of jobs produce a playable MP4 unattended; **0** errors from `check --strict` | CI + the QA gate |
| **Determinism** | Same inputs → identical output across two runs | Hash two renders of a fixture |
| **Cost / latency** | ⚑ ≤ ~$0.35 and ≤ ~4 min per 30 s reel at `high` quality | Per-stage telemetry in `meta.json` |

The bar is enforced by a **QA gate** (WS7) that fails a render instead of shipping a bad one.
That gate is what turns this plan from "more features" into "higher quality".

---

## 1. Where the tool is today

| Capability | State |
|---|---|
| Prompt → script → voice → timings → art → composition → MP4 | ✅ working, validated offline (`check`: 0 errors) |
| Word-level sync from a real transcriber, with fallback ladder | ✅ |
| Generated hero art per scene (no scraping) | ✅ |
| Offline-deterministic renders (vendored GSAP + fonts) | ✅ |
| Seek-safe layered motion, 4 transitions | ✅ |
| Sparse SFX with fades, optional music bed | ✅ (mix levels hand-set) |
| Caption auto-fit, 4 styles, 4 aspect ratios | ✅ |
| Cover frame, contact sheet | ✅ |
| CLI / Telegram / Actions / Worker / Docker | ✅ |
| **Mix engineering (loudness, ducking, beat sync)** | ❌ |
| **Caption style variety, safe-zone enforcement** | ❌ (single layout, safe zone is a constant) |
| **Color grade / film finish** | ❌ |
| **Hook variants, script self-critique, end card** | ❌ |
| **Multi-format export, caption sidecar, delivery bundle** | ❌ |
| **Batch, brand kit, caching, per-scene re-roll** | ❌ |
| **Automated quality gate, telemetry, job store** | ❌ (partially: `check` runs) |

---

## 2. Workstreams

### WS1 — Mix and sound *(highest quality-per-hour of work)*

Sound is the fastest way to make a video feel professional and the current mix is honest-but-guessed.

| # | Change | Detail |
|---|---|---|
| 1.1 | **Real loudness targeting** | New `lib/audio-mixer.mjs` drives `npx hyperframes normalize-audio`: voice to −14 LUFS, then music with `--reference <voice>` at a fixed offset, `--write` to persist the gain into `index.html`. One measurement pass instead of hand-set `data-volume`. |
| 1.2 | **Music that ducks** | Derive a music gain envelope from `sceneRanges` (down under speech, up in gaps) and emit it as an automation lane. Verify the lane syntax against the installed CLI during implementation; the safe fallback is splitting the music into segments with per-segment levels. |
| 1.3 | **Beat-synced cuts** | Run `npx hyperframes beats` on the music → `{bpm, beatTimes[]}`. Snap scene cuts to the nearest beat **within ±120 ms**, and only when that doesn't push a cut ahead of the previous scene's last word. Word sync always wins; beats are a refinement, never an override. |
| 1.4 | **Level-matched SFX** | Measure voice peak/LUFS; set impact and whoosh levels relative to it rather than to fixed constants. Add a riser into the payoff scene. |
| 1.5 | **Mix presets** | `--mix voice-first \| music-first \| cinematic` with sensible per-style defaults. |

**Files:** `lib/audio-mixer.mjs` (new), `lib/composition-builder.mjs` (cue planning), `lib/renderer.mjs` (measurement pass), `lib/pipeline.mjs` (new stage between 3 and 5).

---

### WS2 — Caption and type system *(the retention lever)*

Most of the audience watches muted; captions *are* the video for a large share of viewers.

| # | Change | Detail |
|---|---|---|
| 2.1 | **Caption preset pack** | Move caption rendering into `lib/captions/` with presets: `editorial-stack` (today's look), `karaoke-highlight` (sliding highlight box on the spoken word), `typewriter-pop`, `mask-reveal-line`, `big-word-punch` (one word per frame — pairs with `rapid`). Selected per style, overridable with `--captions <preset>`. |
| 2.2 | **Emphasis hierarchy** | Three tiers instead of two: keyword (accent + scale), content words, and function words (`de`, `the`, `à`) rendered smaller/dimmer. This is what makes kinetic type read as *designed*. |
| 2.3 | **Safe-zone profiles** | `lib/platforms.mjs` with per-platform insets (`reels`, `tiktok`, `shorts`, `feed`, `linkedin`). Caption box and badge position are constrained by the profile, and the QA gate asserts nothing crosses the line. |
| 2.4 | **Accurate line breaking** | Replace the empirical character estimate with per-font glyph-advance tables (Inter/Cairo, vendored) so line breaks and sizes are computed rather than approximated — testable without a browser. |
| 2.5 | **RTL/Persian/Arabic polish** | Proper Arabic line-height, kashida-free spacing, and mirrored indents verified with a golden fixture. |

**Files:** `lib/captions/*` (new), `lib/styles/index.mjs` (preset wiring), `lib/composition-builder.mjs`, `lib/platforms.mjs` (new).

---

### WS3 — Visual finish *(makes it look expensive)*

| # | Change | Detail |
|---|---|---|
| 3.1 | **Color grade per style** | `data-color-grading` on hero images + a CSS grade on the scene: contrast curve, slight warm/cool bias, grain, halation on keywords. Cyber gets bloom, luxury gets warm rolloff, swiss stays clean. |
| 3.2 | **Film/texture overlays** | Vendored grain, paper, and scanline PNGs (no network) composited per style at low opacity. |
| 3.3 | **Transition craft** | Add CSS/SVG mask-wipe and luma-wipe transitions alongside the current four, with per-seam energy mapping (cut on the beat → hard/whip; breathe → crossfade/soft-wipe). Optionally add registry shader blocks later (verify availability first — the catalog was unreachable here). |
| 3.4 | **Layered hero motion** | Subject + aura + foreground parallax layers with slight differential drift, plus a slow light sweep across the subject. Depth reads as production value. |
| 3.5 | **Video heroes (opt-in, paid)** | `--video-hero hook` generates a 2–4 s clip with Veo for the first scene only, with a hard budget guard. Expensive; ship it off by default. |

**Files:** `lib/styles/*` (grade + transition per preset), `templates/assets/textures/*` (new), `lib/gemini-ai.mjs` (Veo adapter).

---

### WS4 — Story and structure *(the performance lever)*

| # | Change | Detail |
|---|---|---|
| 4.1 | **Script self-critique pass** | Generate → critique against a rubric (specificity, concrete numbers, banned clichés, hook strength, read-aloud length) → revise once. One extra text call; the highest-leverage cheap change for retention. |
| 4.2 | **Hook variants** | `--hooks 3` generates three openings and renders each as a 3-second preview (frame + audio) so you pick before paying for full renders. Later: render full variants and A/B them. |
| 4.3 | **Beat sheet instead of a flat list** | Scenes carry roles (hook → context → tension → proof → payoff → CTA) and the prompt fills roles rather than a scene count, which removes the "five interchangeable middle scenes" problem. |
| 4.4 | **End card / CTA** | A dedicated final 1.2–1.8 s frame: title lockup, one-line CTA, handle. Currently the last scene just fades out — a wasted retention slot. |
| 4.5 | **Grounding (opt-in)** | Google Search grounding for factual topics so numbers and claims are real. `--research`. |
| 4.6 | **Read-aloud length check before spending** | Estimate TTS duration from word count and trim/expand the script *before* image generation, so a 30 s request doesn't become a 42 s video. |

**Files:** `lib/gemini-ai.mjs` (critique, roles, grounding), `lib/pipeline.mjs` (stage order), `lib/composition-builder.mjs` (end card).

---

### WS5 — Platform delivery *(correctness and packaging)*

| # | Change | Detail |
|---|---|---|
| 5.1 | **Platform profiles** | `--platform reels\|tiktok\|shorts\|feed\|linkedin` → aspect, duration sweet spot, safe zones, loudness target, bitrate/size cap. One flag instead of five. |
| 5.2 | **Multi-format export** | One storyboard → 9:16 + 4:5 + 1:1 (+ 16:9) with layout adaptation rules (hero scale, caption size, badge placement). No re-generation: same script, same voice, same timings. |
| 5.3 | **Caption sidecar** | `.srt` and `.vtt` from `words.json`, plus `--burn-captions off` for the version uploaded with platform-native captions. |
| 5.4 | **Smarter covers** | Pick the highest-contrast, text-free frame in the hook window, or render a designed cover (title lockup + hero) at both 1080×1920 and 1080×1350. |
| 5.5 | **Delivery bundle** | `--bundle` produces a zip: MP4s, covers, sidecars, `meta.json`, and a `post.md` with a suggested caption and hashtags. Hand-off becomes one file. |

**Files:** `lib/platforms.mjs`, `lib/delivery.mjs` (new), `lib/renderer.mjs`, `create-reel.mjs`.

---

### WS6 — Throughput and editorial control *(shipping at volume)*

| # | Change | Detail |
|---|---|---|
| 6.1 | **Batch mode** | `--topics topics.txt` or a campaign JSON → N reels sharing style/voice/brand, with a concurrency cap and a per-job report. |
| 6.2 | **Brand kit** | `brand.json` (logo, handle, palette override, end card, font) applied across a series; optional episode numbering for recurring formats. |
| 6.3 | **Stage caching** | Content-hash keyed cache for voice, images and transcripts (`cache/<stage>/<hash>`), so re-rolling one scene or re-rendering a variant costs near-zero. |
| 6.4 | **Preview before paying** | `--preview` builds the storyboard, timings and a contact sheet with a cost/time estimate, then stops. `--skip-render` already exists; this adds the *decision* step. |
| 6.5 | **Per-scene re-roll** | `--reroll scene:3 --image`, `--reroll scene:2 --script "…"`, `--retime` — reuses the cached stages and only redoes what changed. |
| 6.6 | **Telegram review loop** | Inline buttons on the delivered video: 👍 approve, 🔁 re-roll the hero image, ✂️ shorten, plus "3 hooks" for a variant set. Turns the bot from a vending machine into an editing session. |

**Files:** `lib/batch.mjs`, `lib/cache.mjs`, `lib/brand.mjs` (new), `telegram-bot.mjs`, `create-reel.mjs`.

---

### WS7 — Quality gate, ops and telemetry *(protects everything above)*

| # | Change | Detail |
|---|---|---|
| 7.1 | **QA gate** | `npm run qa <project>` runs `check --strict`, then asserts: duration target, caption bounds vs the platform safe zone, loudness and true peak, keyword coverage per scene, no placeholder images, no `data-timeline-error`, no missing assets. Prints a pass/fail table and exits non-zero. Wired into the pipeline so a failing render never reaches delivery. |
| 7.2 | **Golden set** | Six fixtures (FR/EN/AR × calm/standard/rapid) built with `--mock` on every commit for structure, plus one real render nightly/on-demand to catch model and render regressions. |
| 7.3 | **Visual regression** | `snapshot --at` per scene midpoint, hash-compare against a baseline, flag and describe diffs. |
| 7.4 | **Telemetry + budget guard** | Per-stage timings, model used, retries and an estimated cost into `meta.json` and a CSV. `--budget 0.50` aborts before an expensive stage if the running estimate exceeds the cap. |
| 7.5 | **Model doctor** | `npm run doctor` probes every model in each ladder and reports which are available/deprecated — runaway model churn is the biggest external risk to this pipeline. |
| 7.6 | **Job store + idempotent queue** | Replace the in-memory queue with a small persisted store keyed by update id (SQLite or JSON), enabling safe restarts, retries, and multi-user use. |

**Files:** `scripts/qa.mjs`, `scripts/doctor.mjs`, `lib/telemetry.mjs`, `lib/jobs.mjs` (new), CI workflow.

---

## 3. Roadmap

| Phase | Focus | Workstreams | Effort | Exit criteria |
|---|---|---|---|---|
| **0 — Prove it** | First real render with a live key; fix what breaks; add the QA gate and baseline metrics | WS7.1, WS7.4 | 1–2 d | One MP4 you would actually post; QA report runs; cost and latency measured |
| **1 — Make it feel right** | Mix + beats, caption pack, safe zones, script critique, end card | WS1, WS2, WS4.1, WS4.4 | 4–6 d | Loudness/sync/legibility SLOs met; two caption presets in use |
| **2 — Make it look expensive** | Grading, textures, transition craft, layered motion, platform profiles, multi-format + sidecars + bundle | WS3.1–3.4, WS5 | 5–7 d | Multi-format export from one project; graded styles; delivery bundle |
| **3 — Ship at volume** | Batch, brand kit, caching, preview, re-roll, hook variants, job store | WS6, WS4.2, WS7.2–7.6 | 6–9 d | 10 reels in one run; per-scene re-roll under 30 s; golden set green |
| **4 — Reach** | Video heroes (Veo), localization/dubbing, scheduled publishing, performance feedback loop | WS3.5, new | ongoing | — |

**If you only have one day:** Phase 0 plus WS1.1 and WS2.3. Loudness targeting and safe zones
are the two changes with the largest gap between effort and perceived quality.

---

## 4. Sequencing rules

1. **Phase 0 before anything else.** The render path has never executed end to end outside unit
   tests — no FFmpeg or browser was available in the sandbox, and no live API call was made.
   Every estimate below is provisional until that runs.
2. **Word sync outranks beat sync.** Beats may move a cut only within a window that never
   undercuts a word's timestamp.
3. **One new effect per scene, maximum.** Kinetic type fails by addition; the `restraint` preset
   should stay a first-class option.
4. **Anything paid is opt-in.** Default stays `--image-quality high`; video heroes, `--research`,
   and `best` render quality are explicit choices with budget guards.
5. **Every new capability lands with a test.** The current 28 tests caught seven real bugs;
   that ratio is worth protecting.

---

## 5. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Render path unverified** (no FFmpeg/browser here) | Blocks everything | Phase 0 is exactly this; keep `--skip-render` + `check` as the fast loop until a real render passes |
| **Model churn** — IDs and previews change monthly | Pipeline silently degrades to fallbacks | Ladders (already in place) + `npm run doctor` + alert on fallback rate in telemetry |
| **Cost creep** — image and video generation dominate | A reel quietly costs dollars | Stage caching, budget guard, `high` default, Veo off by default, per-reel cost in `meta.json` |
| **Over-styling** — more motion reads as amateur | Worse perceived quality | One-idea-per-scene rule, restraint preset, contact-sheet review before delivery |
| **Beat-sync fights word-sync** | Captions drift | Hard precedence rules (§4.2) plus a QA assertion |
| **CI render time** on GitHub runners | Timeouts, flaky jobs | `fast` render quality in CI, real renders on a schedule, 40-minute job timeout already set |
| **Multi-user abuse** on shared bots | Runaway spend | Already rate-limited in the Worker; add per-chat budget accounting in WS7.4 |

---

## 6. Metrics to watch

Track weekly — the point of a quality bar is that it can regress:

- Render success rate (target ≥ 99 %) and unattended completion
- Cost and wall-clock per reel, split by stage
- Sync error P90, loudness deviation, duration deviation
- Fallback rate per stage (the early warning for model deprecation)
- First-render approval rate (how often a generated reel is posted without re-rolling)
- Later, from platform analytics: 3-second retention and hook performance per hook variant

---

## 7. What deliberately stays out of scope

- **Real-time/streaming generation** — this is an async batch tool.
- **Full NLE editing** — HyperFrames Studio already edits the project; the engine should stop at
  "a project worth editing".
- **Voice cloning / custom personas** — a legal and ethical surface not worth opening by default.
- **Auto-publishing to platforms** — API access and account risk; a delivery bundle plus
  scheduler hand-off covers the real need.
- **Lipsync/avatar presenters** — a different product; the kinetic-editorial format doesn't need it.
