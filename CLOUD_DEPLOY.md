# ☁️ Running 24/7 in the cloud

Three ways to run the engine without keeping a computer awake.
All of them need the same two values: `GEMINI_API_KEY` and (for delivery) `TELEGRAM_BOT_TOKEN`.

---

## Option 1 — GitHub Actions (no server, free minutes)

The workflow `.github/workflows/generate-reel.yml` renders one reel per dispatch.

1. Push this repository to GitHub.
2. **Settings → Secrets and variables → Actions** → add `GEMINI_API_KEY`
   (and `TELEGRAM_BOT_TOKEN` if you want delivery).
3. **Actions → Generate Kinetic Reel → Run workflow**, fill in the topic, duration,
   style, voice, pace, aspect and (optionally) your Telegram `chat_id`.
4. The MP4 arrives as a build artifact, and on Telegram when `chat_id` is set.

> **Security:** inputs are passed to the shell through `env:` — never interpolated
> directly into `run:`. A topic coming from a Telegram message is untrusted text; a
> topic containing `"` and `$(...)` would otherwise execute on the runner, where the
> API secrets live. `chat_id` is validated as digits before it is used for delivery.

## Option 2 — Cloudflare Worker relay (a bot that always answers)

`cloudflare-worker.js` turns a Telegram webhook into a workflow dispatch, so the bot
replies instantly while the actual render happens on a GitHub runner.

**Configure on the Worker**

| Binding | Type | Value |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret | from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | secret | any long random string |
| `GITHUB_PAT` | secret | fine-grained token with **Actions: write** on this repo only |
| `GITHUB_REPO` | var | `owner/repo` |
| `GITHUB_REF` | var | branch to run from (default `main`) |
| `ALLOWED_CHAT_IDS` | var | comma-separated ids; empty means nobody can use it |
| `MAX_PER_HOUR` | var | per-chat dispatch cap (default `5`) |

**Register the webhook** — the `secret_token` must match `TELEGRAM_WEBHOOK_SECRET`:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-worker>.workers.dev" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

The Worker rejects requests without the secret header, rejects chats that are not on the
allow-list, caps message length, rate-limits per chat, and reports a failed GitHub dispatch
to the user instead of returning "Triggered".

## Option 3 — Docker on a VPS (full local render, ~3-5 €/month)

```bash
git clone <your-repo> /opt/kinetic-reel && cd /opt/kinetic-reel
cp .env.example .env && nano .env          # add GEMINI_API_KEY, TELEGRAM_BOT_TOKEN
docker compose up -d --build
docker compose logs -f                      # watch it work
```

The image ships FFmpeg, Chromium, Inter and Noto fonts, runs as a non-root user and gives
the container 1 GB of shared memory (`shm_size`) because Chromium needs more than Docker's
64 MB default to render reliably.

Render a single video from the same image:

```bash
docker compose run --rm kinetic-bot \
  node create-reel.mjs "why espresso costs so much" --duration 30 --output /app/scratch/out.mp4
```

## Option 4 — Windows service (PC stays on, apps closed)

```powershell
npm install -g pm2
pm2 start telegram-bot.mjs --name kinetic-bot
pm2 save
pm2 startup          # follow the printed instructions
```

## Cost and timing expectations

Per 30-second reel: one text call, one TTS call, one transcription call, 6–9 image calls and
one render. Image generation dominates both cost and latency; `--image-quality high` uses the
fast model first, `--image-quality max` starts with the flagship. Rendering is CPU-bound —
expect roughly 1–3 minutes for a 30-second reel on a modern laptop or a GitHub runner.
