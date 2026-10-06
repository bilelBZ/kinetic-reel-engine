#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, openAsBlob } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { produceReel } from "./lib/pipeline.mjs";
import { getGeminiApiKey } from "./lib/gemini-ai.mjs";
import { listStyles } from "./lib/styles/index.mjs";
import { ROOT, readEnvKey } from "./lib/env.mjs";

/**
 * Telegram front-end: send a prompt from your phone, get the finished MP4 back.
 *
 * Hard-won details encoded here:
 *  - The update offset is persisted, so a restart never re-renders (and
 *    re-charges) videos the user already received.
 *  - User text is escaped and sent with MarkdownV2, or plain — never raw
 *    Markdown, which 400s the moment a topic contains "*" or "_".
 *  - One render at a time, so a burst of messages cannot fork N Chromiums.
 */

const OFFSET_FILE = join(ROOT, ".telegram-offset.json");
const MAX_TOPIC_LENGTH = 400;

/** True when this file is the entry point (not imported by a test or another module). */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const token = readEnvKey(["TELEGRAM_BOT_TOKEN"]);
if (!token && isMain) {
  console.error("❌ TELEGRAM_BOT_TOKEN is missing.");
  console.error("   Create a bot with @BotFather, then set TELEGRAM_BOT_TOKEN in .env or the environment.");
  process.exit(1);
}
const API = `https://api.telegram.org/bot${token || ""}`;

// --------------------------------------------------------------------------
// Telegram helpers
// --------------------------------------------------------------------------

async function callTelegram(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

/** Escape for MarkdownV2 — every one of these characters breaks parsing. */
function escapeMarkdown(text) {
  return String(text ?? "").replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

async function sendMessage(chatId, text, { markdown = true, ...rest } = {}) {
  const payload = { chat_id: chatId, text: markdown ? escapeMarkdown(text) : text, ...rest };
  if (markdown) payload.parse_mode = "MarkdownV2";
  const result = await callTelegram("sendMessage", payload);
  if (!result.ok && markdown) {
    // Never lose a message to formatting: retry verbatim without parse mode.
    return callTelegram("sendMessage", { chat_id: chatId, text: String(text), ...rest });
  }
  return result;
}

async function editMessage(chatId, messageId, text) {
  const result = await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: escapeMarkdown(text),
    parse_mode: "MarkdownV2",
  });
  if (!result.ok) {
    return callTelegram("editMessageText", { chat_id: chatId, message_id: messageId, text: String(text) });
  }
  return result;
}

async function sendVideo(chatId, videoPath, caption = "") {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const form = new FormData();
      form.append("chat_id", String(chatId));
      if (caption) form.append("caption", caption.slice(0, 1000));
      form.append("supports_streaming", "true");
      form.append("video", await openAsBlob(videoPath), "kinetic-reel.mp4");

      const res = await fetch(`${API}/sendVideo`, { method: "POST", body: form });
      const data = await res.json();
      if (data.ok) return data;
      lastError = data.description || `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(1500 * attempt);
  }
  throw new Error(`Telegram rejected the video: ${lastError}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
// Prompt parsing
// --------------------------------------------------------------------------

const VOICES = ["Fenrir", "Puck", "Charon", "Kore", "Aoede"];

export function parsePrompt(text) {
  const raw = String(text || "").trim();
  const params = { topic: raw, duration: 30, voice: "Fenrir", speed: "standard", style: null, lang: null };

  const durationMatch = raw.match(/(\d{1,3})\s*(?:secondes?|seconds?|secs?|s\b)/i);
  if (durationMatch) params.duration = Math.max(5, Math.min(180, Number(durationMatch[1])));

  for (const voice of VOICES) {
    if (new RegExp(`\\b${voice}\\b`, "i").test(raw)) params.voice = voice;
  }

  if (/\b(rapide|rapid|fast|snappy)\b/i.test(raw)) params.speed = "rapid";
  else if (/\b(calme|calm|slow|lent)\b/i.test(raw)) params.speed = "calm";

  if (/\b(swiss|suisse)\b/i.test(raw)) params.style = "swiss-editorial";
  else if (/\b(cyber|matrix|tech|neon)\b/i.test(raw)) params.style = "cyber-matrix";
  else if (/\b(luxury|gold|or\b|luxe)\b/i.test(raw)) params.style = "minimal-luxury";
  else if (/\b(fares|editorial)\b/i.test(raw)) params.style = "fares-editorial";

  if (/\b(en anglais|in english|english)\b/i.test(raw)) params.lang = "English";
  else if (/\b(en arabe|in arabic|arabic)\b/i.test(raw) || /[\u0600-\u06FF]/.test(raw)) params.lang = "Arabic";
  else if (/\b(en espagnol|in spanish)\b/i.test(raw)) params.lang = "Spanish";

  // Strip the instruction wrapper so the topic is just the idea.
  params.topic = raw
    .replace(/^\s*(?:fais[- ]moi|fait[- ]moi|cr[ée]e|g[ée]n[èe]re|make|create|generate)\b[^,]*?\b(?:reel|video|vid[ée]o|short)\b/i, "")
    .replace(/^\s*(?:un|une|a|an)\s+(?:reel|short|video|vid[ée]o)\b[^,]*?\b(?:de|en|of|about|sur)\b/i, "")
    .replace(/\b(?:de|en|of|about)?\s*\d{1,3}\s*(?:secondes?|seconds?|secs?|s\b)/i, "")
    .replace(/\b(?:swiss|suisse|cyber|matrix|tech|neon|luxury|gold|luxe|fares|editorial)\b/gi, "")
    .replace(/\b(?:rapide|rapid|fast|snappy|calme|calm|slow|lent)\b/gi, "")
    .replace(/\b(?:avec|voix|voice|with)\s+(?:la voix\s+)?(Fenrir|Puck|Charon|Kore|Aoede)\b/i, "")
    .replace(/\b(?:style|look)\s+\w+\b/i, "")
    .replace(/\b(?:rythme|pace|cadence|speed)\s+\w+\b/i, "")
    .replace(/\ben (?:anglais|arabe|fran[cç]ais|espagnol)\b/i, "")
    .replace(/\b(?:en anglais|in english|in arabic|en arabe)\b/i, "")
    // Leftovers from the instruction wrapper.
    .replace(/\b(?:rapide|rapid|fast|calme|calm|slow|snappy)\b\s*$/i, "")
    .replace(/(?:\s+\b(?:en|avec|voix|voice|style|pace|rythme|cadence|de|du|in|with|about)\b)+\s*$/i, "")
    .replace(/^(?:\s*(?:sur|about|de|du|d'|le|la|les|l'))+\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "")
    .trim();

  if (!params.topic) params.topic = raw;
  return params;
}

function helpText() {
  const styles = listStyles().map((s) => `• ${s.id} — ${s.name}`).join("\n");
  return `🎬 Kinetic Reel Engine

Send me an idea and I'll return a finished vertical video: script, voiceover, kinetic captions synced word by word, and generated visuals.

Examples
• why specialty coffee costs so much
• 30s reel about compound interest, voice Charon
• cyber reel in English about quantum computing, rapid

Styles
${styles}

Commands
/start or /help — this message
/styles — list styles
/status — queue and settings
`;
}

// --------------------------------------------------------------------------
// Job queue — one render at a time
// --------------------------------------------------------------------------

const queue = [];
let busy = false;

function enqueue(job) {
  queue.push(job);
  pump();
}

async function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  try {
    await job();
  } catch (err) {
    console.error("[Queue] job failed:", err.message);
  } finally {
    busy = false;
    pump();
  }
}

// --------------------------------------------------------------------------
// Message handling
// --------------------------------------------------------------------------

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = String(message.text || "").trim();
  if (!text) return;

  if (/^\/(start|help)\b/.test(text)) return void (await sendMessage(chatId, helpText()));
  if (/^\/styles\b/.test(text)) {
    return void (await sendMessage(chatId, listStyles().map((s) => `${s.id} — ${s.description}`).join("\n\n")));
  }
  if (/^\/status\b/.test(text)) {
    return void (await sendMessage(
      chatId,
      `Queue: ${queue.length} waiting${busy ? " (1 rendering)" : ""}\nVoice: ${VOICES.join(", ")}\nAspect: 9:16`,
    ));
  }

  const prompt = parsePrompt(text.slice(0, MAX_TOPIC_LENGTH));
  const styles = listStyles();
  const params = {
    topic: prompt.topic,
    duration: prompt.duration,
    voice: prompt.voice,
    speed: prompt.speed,
    style: prompt.style || "fares-editorial",
    lang: prompt.lang,
    aspect: "9:16",
  };

  const position = queue.length + (busy ? 1 : 0);
  const status = await sendMessage(
    chatId,
    `🎬 Generating\n\nTopic: ${params.topic}\nLength: ~${params.duration}s · ${params.speed}\nStyle: ${params.style}\nVoice: ${params.voice}` +
      (position ? `\n\nPosition in queue: ${position}` : "") +
      `\n\nStyles available: ${styles.length}. Send /styles to change.`,
  );
  const statusId = status?.result?.message_id;

  enqueue(async () => {
    const started = Date.now();
    const stages = [];
    const update = async (line) => {
      stages.push(line);
      if (statusId) await editMessage(chatId, statusId, `🎬 Generating\n\nTopic: ${params.topic}\n\n${stages.join("\n")}`);
    };

    try {
      const result = await produceReel({
        ...params,
        onStage: ({ key, label }) => {
          void update(`→ ${label}…`);
        },
        log: (line) => console.log(`[Bot] ${line}`),
      });

      const caption =
        `🎬 ${result.storyboard.title}\n` +
        `${Math.round(result.totalDuration)}s · ${params.aspect} · ${params.style}\n` +
        `Word sync: ${result.timingSource}`;

      await sendVideo(chatId, result.mp4Path, caption);
      if (result.coverPath && existsSync(result.coverPath)) {
        try {
          const form = new FormData();
          form.append("chat_id", String(chatId));
          form.append("caption", "Suggested cover frame");
          form.append("photo", await openAsBlob(result.coverPath), "cover.jpg");
          await fetch(`${API}/sendPhoto`, { method: "POST", body: form });
        } catch (err) {
          console.warn("[Bot] cover upload skipped:", err.message);
        }
      }
      if (statusId) {
        await editMessage(
          chatId,
          statusId,
          `✅ Done in ${((Date.now() - started) / 1000).toFixed(0)}s\n\n${stages.slice(-4).join("\n")}`,
        );
      }
      for (const warning of result.warnings) {
        await sendMessage(chatId, `⚠️ ${warning}`);
      }
    } catch (err) {
      console.error("[Bot] render failed:", err);
      if (statusId) await editMessage(chatId, statusId, `❌ Generation failed\n\n${err.message}`);
      else await sendMessage(chatId, `❌ Generation failed: ${err.message}`);
    }
  });
}

// --------------------------------------------------------------------------
// Long polling with a persisted offset
// --------------------------------------------------------------------------

function loadOffset() {
  try {
    if (!existsSync(OFFSET_FILE)) return 0;
    return Number(JSON.parse(readFileSync(OFFSET_FILE, "utf8")).offset) || 0;
  } catch {
    return 0;
  }
}

function saveOffset(offset) {
  try {
    writeFileSync(OFFSET_FILE, JSON.stringify({ offset, at: new Date().toISOString() }), "utf8");
  } catch (err) {
    console.warn("[Bot] could not persist the update offset:", err.message);
  }
}

let lastUpdateId = loadOffset();
if (lastUpdateId) console.log(`[Bot] resuming after update ${lastUpdateId} (no replay of old messages)`);

async function poll() {
  try {
    const res = await callTelegram("getUpdates", { offset: lastUpdateId + 1, timeout: 25 });
    if (res.ok && Array.isArray(res.result)) {
      for (const update of res.result) {
        lastUpdateId = update.update_id;
        saveOffset(lastUpdateId);
        const message = update.message || update.edited_message;
        if (message?.text) {
          handleMessage(message).catch((err) => console.error("[Bot] handler error:", err.message));
        }
      }
    } else if (!res.ok) {
      console.warn("[Bot] getUpdates:", res.description || "unknown error");
      await sleep(3000);
    }
  } catch (err) {
    console.warn("[Bot] polling error:", err.message);
    await sleep(3000);
  }
  setImmediate(poll);
}

if (isMain) {
  console.log("=======================================================");
  console.log(" 🤖 KINETIC REEL BOT — send an idea, receive a video");
  console.log(`    styles: ${listStyles().map((s) => s.id).join(", ")}`);
  console.log(`    api key: ${getGeminiApiKey() ? "GEMINI_API_KEY ✓" : "MISSING — set GEMINI_API_KEY before rendering"}`);
  console.log("=======================================================");
  poll();
}

export { escapeMarkdown, helpText };
