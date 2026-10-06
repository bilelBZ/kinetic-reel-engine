/**
 * Cloudflare Worker — Telegram → GitHub Actions relay (free 24/7, no server).
 *
 * The bot's hosted twin: a Telegram webhook lands here, we validate it, then
 * dispatch the render workflow in the cloud.
 *
 * Hardening (all of it is required — an open relay was letting anyone trigger
 * renders on someone else's account):
 *   1. Verify Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
 *   2. Allow-list chat ids via the ALLOWED_CHAT_IDS variable.
 *   3. Reject oversized messages and rate-limit per chat.
 *   4. Check the GitHub API response instead of always reporting success.
 *
 * Bindings / variables to configure on the Worker:
 *   TELEGRAM_BOT_TOKEN  (secret)  — bot token from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET (secret) — the secret_token passed to setWebhook
 *   GITHUB_PAT          (secret)  — fine-grained token, "Actions: write" on the repo only
 *   GITHUB_REPO         (var)     — "owner/repo"
 *   GITHUB_REF          (var)     — branch to run from, default "main"
 *   ALLOWED_CHAT_IDS    (var)     — comma-separated ids, empty = nobody
 *   MAX_PER_HOUR        (var)     — per-chat dispatch limit, default "5"
 *
 * Register the webhook with the same secret:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d "url=https://<worker>.workers.dev" \
 *     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 */

const MAX_TEXT_LENGTH = 400;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    // Only accept updates from Telegram, over POST.
    if (request.method !== "POST") {
      return json({ ok: false, error: "method not allowed" }, 405);
    }
    if (
      !env.TELEGRAM_WEBHOOK_SECRET ||
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET
    ) {
      // No detail on purpose: do not help a prober.
      return json({ ok: false }, 401);
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }

    const message = update.message || update.edited_message;
    const chatId = message?.chat?.id;
    const text = String(message?.text || "").trim();
    if (!chatId || !text) return json({ ok: true, ignored: true });

    const allowed = (env.ALLOWED_CHAT_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (allowed.length === 0) {
      await reply(env, chatId, "This relay has no allowed chats configured. Set ALLOWED_CHAT_IDS.");
      return json({ ok: false, error: "no allowed chats configured" }, 403);
    }
    if (!allowed.includes(String(chatId))) return json({ ok: false }, 403);

    if (text.length > MAX_TEXT_LENGTH) {
      await reply(env, chatId, `That message is too long (${text.length} characters, ${MAX_TEXT_LENGTH} max).`);
      return json({ ok: true, rejected: "too long" });
    }

    if (/^\/(start|help)\b/.test(text)) {
      await reply(env, chatId, "Send an idea and the cloud renders it. Example: “a 30s reel about why espresso costs so much”.");
      return json({ ok: true });
    }

    const allowedNow = await checkRateLimit(chatId, env);
    if (!allowedNow) {
      await reply(env, chatId, "You have hit the hourly limit. Try again a bit later.");
      return json({ ok: false, error: "rate limited" }, 429);
    }

    await reply(env, chatId, `🎬 Queued: ${text}\nRendering in the cloud — the video will arrive here when it is done.`);

    const dispatch = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/generate-reel.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "kinetic-reel-relay",
        },
        body: JSON.stringify({
          ref: env.GITHUB_REF || "main",
          inputs: {
            topic: text,
            duration: "30",
            voice: "Fenrir",
            style: "fares-editorial",
            pace: "standard",
            aspect: "9:16",
            image_quality: "high",
            chat_id: String(chatId),
          },
        }),
      },
    );

    if (!dispatch.ok) {
      const detail = await dispatch.text();
      console.error("GitHub dispatch failed", dispatch.status, detail.slice(0, 300));
      await reply(env, chatId, "Could not start the render job (GitHub rejected the dispatch).");
      return json({ ok: false, error: "dispatch failed" }, 502);
    }

    return json({ ok: true, dispatched: true });
  },
};

async function reply(env, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Plain text: user content is never parsed as Markdown, which used to
      // reject any topic containing "*", "_" or "[".
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("reply failed", err.message);
  }
}

async function checkRateLimit(chatId, env) {
  // Best-effort in-isolate limiter: survives bursts, resets when the isolate
  // recycles. Swap in Durable Objects or KV for a hard guarantee.
  const limit = Number(env.MAX_PER_HOUR || 5);
  const now = Date.now();
  globalThis.__rateState = globalThis.__rateState || new Map();
  const hits = (globalThis.__rateState.get(chatId) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= limit) {
    globalThis.__rateState.set(chatId, hits);
    return false;
  }
  hits.push(now);
  globalThis.__rateState.set(chatId, hits);
  return true;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
