#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, openAsBlob } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  getGeminiApiKey,
  generateStoryboard,
  synthesizeVoiceWithGemini,
  generateHeroImage
} from "./lib/gemini-ai.mjs";
import { alignWordsWithAudio } from "./lib/word-aligner.mjs";
import { buildCompositionHtml } from "./lib/composition-builder.mjs";
import { renderVideoToMp4 } from "./lib/renderer.mjs";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

// Locate FFmpeg (Windows Scoop or Linux / Docker system PATH)
function getFfmpegPath() {
  const scoopPath = "C:\\Users\\bbouzid\\AppData\\Local\\Scoop\\shims\\ffmpeg.exe";
  if (existsSync(scoopPath)) return scoopPath;
  return "ffmpeg";
}

// Load Telegram Token from env or .env
function getTelegramToken() {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.trim()) {
    return process.env.TELEGRAM_BOT_TOKEN.trim();
  }
  const envPath = join(__dirname, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf8");
    const match = content.match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*["']?([^"'\r\n]+)["']?/m);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

const TOKEN = getTelegramToken();
const API_BASE = `https://api.telegram.org/bot${TOKEN}`;

async function callTelegram(method, payload = {}) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function sendMessage(chatId, text, options = {}) {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    ...options,
  });
}

async function sendVideo(chatId, videoPath, caption = "") {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", caption);
      form.append("supports_streaming", "true");

      const blob = await openAsBlob(videoPath);
      form.append("video", blob, "kinetic-reel.mp4");

      const res = await fetch(`${API_BASE}/sendVideo`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.ok) return data;
      console.warn(`[Telegram sendVideo] Attempt ${attempt + 1} failed:`, data.description);
    } catch (err) {
      console.warn(`[Telegram sendVideo] Network error attempt ${attempt + 1}:`, err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("Impossible d'envoyer la vidéo après 3 tentatives.");
}

// Parse user prompt message into topic, duration, voice, etc.
function parseUserPrompt(text) {
  let topic = text.trim();
  let duration = 30;
  let voice = "Puck"; // Default
  let lang = "French";

  // Check for brief structure or keywords
  if (text.includes("BRIEF VIDÉO KINETIC") || text.includes("Sujet / Titre")) {
    const subjectMatch = text.match(/Sujet\s*\/\s*Titre\s*:\s*(.+)/i);
    if (subjectMatch) topic = subjectMatch[1].replace(/\[|\]/g, "").trim();

    const durationMatch = text.match(/Durée\s*(?:souhaitée|cible)?\s*:\s*(\d+)/i);
    if (durationMatch) duration = parseInt(durationMatch[1], 10);

    const voiceMatch = text.match(/Voix\s*(?:Google AI Studio)?\s*:\s*(\w+)/i);
    if (voiceMatch) voice = voiceMatch[1].trim();

    const langMatch = text.match(/Langue\s*:\s*(\w+)/i);
    if (langMatch) lang = langMatch[1].trim();
  } else {
    // Freeform heuristics
    if (/aoede/i.test(text)) voice = "Aoede";
    else if (/fenrir/i.test(text)) voice = "Fenrir";
    else if (/charon/i.test(text)) voice = "Charon";
    else if (/kore/i.test(text)) voice = "Kore";

    const durMatch = text.match(/(\d{2})\s*(?:s|sec|secondes)/i);
    if (durMatch) duration = parseInt(durMatch[1], 10);

    // Clean conversational preamble from the topic
    topic = topic
      .replace(/^[Ff]ais[- ]moi (?:un|une) (?:reel|vid[eé]o) (?:de \d+s )?sur /i, "")
      .replace(/^[Cc]r[eé]e (?:un|une) (?:reel|vid[eé]o) (?:de \d+s )?sur /i, "")
      .replace(/^[Gg][eé]n[eè]re (?:un|une) (?:reel|vid[eé]o) (?:de \d+s )?sur /i, "")
      .replace(/ (?:avec|voix) (?:la voix )?(?:Puck|Aoede|Fenrir|Charon|Kore)/i, "")
      .replace(/ (?:de|en) \d+\s*(?:s|sec|secondes)/i, "")
      .trim();
  }

  return { topic, duration, voice, lang };
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  console.log(`[Bot] Message received from chat ${chatId}: "${text}"`);

  if (text.startsWith("/start") || text.startsWith("/help")) {
    const welcome = `
👋 *Bienvenue sur votre Kinetic Reel Bot !*

Envoyez-moi simplement votre idée de vidéo, et je vous génère directement le fichier vidéo MP4 en haute définition !

🎙️ *Voix Google AI Studio :*
• *Puck* (Masculin jeune & dynamique - recommandé)
• *Aoede* (Féminin chaleureux & narratif)
• *Fenrir* (Masculin grave & puissant)
• *Charon* (Posé & documentaire)
• *Kore* (Féminin clair & moderne)

🚀 *Exemple :*
_Fais-moi un reel de 30s sur Pourquoi le café de spécialité coûte si cher avec la voix Puck_
    `;
    return sendMessage(chatId, welcome);
  }

  // Parse prompt
  const { topic, duration, voice, lang } = parseUserPrompt(text);
  console.log(`[Bot] Parsed: topic="${topic}", duration=${duration}s, voice=${voice}`);

  const statusMsg = await sendMessage(
    chatId,
    `🎬 *Demande reçue !*\n\n📌 *Sujet* : ${topic}\n⏱️ *Durée* : ~${duration}s\n🎙️ *Voix* : ${voice}\n\n⏳ _Génération du script & storyboard en cours..._`
  );

  const statusMsgId = statusMsg?.result?.message_id;

  async function updateStatus(stepText) {
    if (!statusMsgId) return;
    try {
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: statusMsgId,
        text: `🎬 *Production de votre vidéo en cours...*\n\n📌 *Sujet* : ${topic}\n🎙️ *Voix* : ${voice}\n\n${stepText}`,
        parse_mode: "Markdown",
      });
    } catch {}
  }

  try {
    const apiKey = getGeminiApiKey();
    if (!apiKey) throw new Error("Clé GEMINI_API_KEY non configurée.");

    const slug = topic
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 25) || "reel";
    
    const timestamp = Date.now().toString().slice(-4);
    const projectDir = resolve(__dirname, `scratch/bot-reel-${slug}-${timestamp}`);
    const projectAssetsDir = join(projectDir, "assets");

    // Copy template assets
    const templateAssetsDir = join(__dirname, "templates/assets");
    const { cpSync, mkdirSync } = await import("node:fs");
    mkdirSync(projectDir, { recursive: true });
    if (existsSync(templateAssetsDir)) {
      cpSync(templateAssetsDir, projectAssetsDir, { recursive: true });
    }
    mkdirSync(join(projectAssetsDir, "audio"), { recursive: true });
    mkdirSync(join(projectAssetsDir, "img"), { recursive: true });

    // Step 1: Storyboard
    await updateStatus("📝 *Étape 1/5* : Écriture du scénario et des scènes cinétiques...");
    const storyboard = await generateStoryboard({
      topic,
      targetDurationSeconds: duration,
      language: lang,
      apiKey,
    });

    console.log(`[Bot] Storyboard created for "${storyboard.title}": ${storyboard.scenes?.length} scenes`);

    // Step 2: Voiceover
    await updateStatus(`🎙️ *Étape 2/5* : Synthèse vocale naturelle (Google AI Studio - ${voice})...`);
    const voiceWavPath = join(projectAssetsDir, "audio/voice.wav");
    await synthesizeVoiceWithGemini({
      scriptText: storyboard.fullScript,
      voiceName: voice,
      language: lang,
      apiKey,
      outputWavPath: voiceWavPath,
    });

    // Step 3: Hero Images Generation
    await updateStatus("🎨 *Étape 3/5* : Génération et recherche des visuels 3D pour chaque scène...");
    for (const sc of storyboard.scenes) {
      const heroName = sc.hero_name || `hero_${sc.id}`;
      const finalHeroPath = join(projectAssetsDir, `img/${heroName}.png`);
      try {
        await generateHeroImage({
          prompt: sc.hero_prompt,
          keyword: sc.keyword,
          heroTitle: sc.hero_title,
          outputPngPath: finalHeroPath,
        });
      } catch (e) {
        console.warn(`[Bot Image] Failed for scene ${sc.id}: ${e.message}`);
      }
    }

    // Step 4: Alignment & HTML Composition
    await updateStatus("⏱️ *Étape 4/5* : Synchronisation mot par mot et composition 9:16...");
    const alignmentResult = alignWordsWithAudio({
      wavPath: voiceWavPath,
      scenes: storyboard.scenes,
      fullScript: storyboard.fullScript,
      outputJsonPath: join(projectDir, "words.json"),
    });

    const indexPath = join(projectDir, "index.html");
    buildCompositionHtml({
      projectDir,
      title: storyboard.title || topic,
      scenes: storyboard.scenes,
      words: alignmentResult.words,
      totalDuration: alignmentResult.totalDuration,
      voiceAudioRel: "assets/audio/voice.wav",
      outputPath: indexPath,
    });

    writeFileSync(join(projectDir, "meta.json"), JSON.stringify({
      id: slug,
      name: slug,
      createdAt: new Date().toISOString()
    }, null, 2), "utf8");

    writeFileSync(join(projectDir, "hyperframes.json"), JSON.stringify({
      width: 1080,
      height: 1920,
      fps: 30,
      duration: alignmentResult.totalDuration,
    }, null, 2), "utf8");

    // Step 5: Headless Render to MP4
    await updateStatus("🎥 *Étape 5/5* : Rendu vidéo MP4 en haute définition (1080x1920)... Cela prend environ 1 minute.");
    const rawMp4Path = join(projectDir, `${slug}-raw.mp4`);
    renderVideoToMp4({
      projectDir,
      outputMp4Path: rawMp4Path,
    });

    // Fast mobile optimization (compresses 20MB -> 4MB for instant Telegram delivery)
    const optMp4Path = join(projectDir, `${slug}.mp4`);
    const ffmpegBin = getFfmpegPath();
    spawnSync(ffmpegBin, [
      "-y",
      "-i", rawMp4Path,
      "-c:v", "libx264",
      "-crf", "23",
      "-preset", "veryfast",
      "-c:a", "aac",
      "-b:a", "160k",
      optMp4Path
    ]);

    const finalVideoPath = existsSync(optMp4Path) ? optMp4Path : rawMp4Path;

    // Upload Video to Telegram
    await updateStatus("📤 *Envoi de la vidéo vers votre téléphone...*");
    const caption = `🎬 *${storyboard.title || topic}*\n\n⏱️ Durée : ${alignmentResult.totalDuration}s\n🎙️ Voix : Google AI Studio (${voice})\n✨ Format : 1080x1920 (9:16)`;
    
    await sendVideo(chatId, finalVideoPath, caption);
    await updateStatus("✅ *Vidéo terminée et envoyée ! Regardez ci-dessous 👇*");
  } catch (err) {
    console.error("Bot error:", err);
    await sendMessage(chatId, `❌ *Erreur lors de la création :*\n\`${err.message}\``);
  }
}

// Long Polling Loop
let lastUpdateId = 0;
async function pollUpdates() {
  try {
    const res = await callTelegram("getUpdates", {
      offset: lastUpdateId + 1,
      timeout: 25,
    });

    if (res.ok && Array.isArray(res.result)) {
      for (const update of res.result) {
        lastUpdateId = update.update_id;
        if (update.message && update.message.text) {
          handleMessage(update.message).catch(console.error);
        }
      }
    }
  } catch (err) {
    await new Promise((r) => setTimeout(r, 3000));
  }
  setImmediate(pollUpdates);
}

console.log("\n=======================================================");
console.log(" 🤖 BOT TELEGRAM KINETIC REEL CONNECTÉ !");
console.log(" En attente de vos messages depuis votre téléphone...");
console.log("=======================================================\n");

pollUpdates();
