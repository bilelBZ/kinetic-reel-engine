import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getFfmpegPath } from "./env.mjs";

/**
 * Loads API key from argument, process.env, or .env files.
 */
export function getGeminiApiKey(explicitKey) {
  if (explicitKey && explicitKey.trim()) return explicitKey.trim();
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) return process.env.GEMINI_API_KEY.trim();
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim()) return process.env.GOOGLE_API_KEY.trim();

  for (const envPath of [".env", "../.env", resolve(dirname(import.meta.url), "../.env")]) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, "utf8");
        const match = content.match(/^\s*(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]) return match[1].trim();
      } catch {}
    }
  }
  return null;
}

/**
 * Fallback local kinetic storyboard generator in case Google text API has high demand (503)
 */
function createLocalFallbackStoryboard({ topic, targetDurationSeconds = 30, language = "French" }) {
  const sceneCount = Math.max(5, Math.min(10, Math.round(targetDurationSeconds / 4)));
  
  // Basic smart segmentation of topic / thesis
  const cleanTopic = topic.replace(/^[Ff]ais[- ]moi un reel (?:de \d+s )?sur /i, "").trim();
  
  return {
    topic: cleanTopic,
    language,
    targetDuration: targetDurationSeconds,
    title: cleanTopic.toUpperCase().slice(0, 30),
    fullScript: `${cleanTopic}. Une réalité que personne ne vous explique. Des chiffres qui défient la logique. Une opportunité à saisir immédiatement. Le futur se joue dès aujourd'hui.`,
    scenes: [
      {
        id: 1,
        theme: "light",
        badge: "01 / CONSTANT",
        text: `${cleanTopic}.`,
        keyword: "RÉVÉLATION",
        hero_name: "hero_1",
        hero_title: cleanTopic,
        hero_prompt: `isolated 3D render of ${cleanTopic}, product design, clean white background`,
        sfx: "slam",
        motion: "zoom-in"
      },
      {
        id: 2,
        theme: "dark",
        badge: "02 / ANOMALIE",
        text: "Une réalité que personne ne vous explique.",
        keyword: "SECRET",
        hero_name: "hero_2",
        hero_title: "Secret",
        hero_prompt: "mysterious glowing golden key or lock 3D isolated, dramatic lighting, dark background",
        sfx: "whoosh",
        motion: "slide-left"
      },
      {
        id: 3,
        theme: "light",
        badge: "03 / IMPACT",
        text: "Des chiffres qui défient la logique.",
        keyword: "EXPLOSION",
        hero_name: "hero_3",
        hero_title: "Données",
        hero_prompt: "3D financial growth chart with golden coins, clean studio lighting",
        sfx: "impact",
        motion: "zoom-in"
      },
      {
        id: 4,
        theme: "dark",
        badge: "04 / ACTION",
        text: "Une opportunité à saisir immédiatement.",
        keyword: "URGENCE",
        hero_name: "hero_4",
        hero_title: "Opportunité",
        hero_prompt: "golden stopwatch hourglass with floating particles 3D render",
        sfx: "click",
        motion: "slide-left"
      },
      {
        id: 5,
        theme: "light",
        badge: "05 / DEMAIN",
        text: "Le futur se joue dès aujourd'hui.",
        keyword: "MAINTENANT",
        hero_name: "hero_5",
        hero_title: "Avenir",
        hero_prompt: "futuristic tech compass or crystal sphere 3D render, studio lighting",
        sfx: "slam",
        motion: "zoom-out"
      }
    ]
  };
}

/**
 * Stage 1: Generate kinetic editorial storyboard JSON via Gemini Flash with retry & backoff
 */
export async function generateStoryboard({ topic, targetDurationSeconds = 30, language = "French", apiKey }) {
  const key = getGeminiApiKey(apiKey);
  if (!key) throw new Error("GEMINI_API_KEY is required to generate the storyboard.");

  const sceneCount = Math.max(5, Math.min(10, Math.round(targetDurationSeconds / 4)));

  const systemInstruction = `
You are an award-winning Creative Director & Motion Designer specializing in "Kinetic Editorial" vertical reels (9:16).
Style rules:
- High contrast, deadpan, rhythmic, punchy typography (alternating cream '#fff8f3' and deep black '#060505').
- Each scene has ONE red keyword (#e71f28) that hits on the visual beat.
- Voiceover text must be concise, catchy, rhythmic, spoken in ${language}.
- Each scene features an isolated hero subject (3D render or product, soft studio lighting, isolated on clean background).
- Exactly ${sceneCount} scenes to fit ~${targetDurationSeconds} seconds.
- Output MUST be valid JSON only, without markdown fences or extraneous text.
`;

  const prompt = `
Create a vertical kinetic reel storyboard for the topic: "${topic}".
Language: ${language}.
Number of scenes: ${sceneCount}.

Return a JSON object with this exact structure:
{
  "topic": "${topic}",
  "language": "${language}",
  "targetDuration": ${targetDurationSeconds},
  "title": "Short punchy title",
  "fullScript": "The complete combined voiceover text across all scenes for the TTS voice",
  "scenes": [
    {
      "id": 1,
      "theme": "light",
      "badge": "01 / INTRO",
      "text": "First punchy sentence spoken by voiceover.",
      "keyword": "PUNCHY",
      "hero_name": "hero_1",
      "hero_title": "Short title for the hero object",
      "hero_prompt": "photorealistic 3D render of [subject], soft cinematic studio lighting, floating, isolated on clean white background, 4k, no text",
      "sfx": "slam",
      "motion": "zoom-in"
    }
  ]
}
`;

  const candidateModels = [
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-flash-lite-latest",
    "gemini-flash-latest"
  ];

  let rawText = null;
  let lastErr = null;

  for (const model of candidateModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.7,
            },
          }),
        });

        if (response.status === 503) {
          lastErr = "503 High Demand";
          // Wait 1.2s before trying next
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }

        if (!response.ok) {
          lastErr = await response.text();
          break;
        }

        const json = await response.json();
        rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) break;
      } catch (e) {
        lastErr = e.message;
      }
    }
    if (rawText) break;
  }

  // If all remote models are 503 / busy, use intelligent local fallback
  if (!rawText) {
    console.warn(`[Gemini] All models busy (${lastErr}). Using local kinetic storyboard fallback.`);
    return createLocalFallbackStoryboard({ topic, targetDurationSeconds, language });
  }

  try {
    return JSON.parse(rawText.trim());
  } catch (err) {
    const cleaned = rawText.replace(/```json\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return createLocalFallbackStoryboard({ topic, targetDurationSeconds, language });
    }
  }
}

/**
 * Stage 2: Ultra-realistic natural voiceover via Google AI Studio Gemini 3.8 Flash TTS
 * Supported voices: Puck, Charon, Kore, Fenrir, Aoede
 */
export async function synthesizeVoiceWithGemini({
  scriptText,
  voiceName = "Puck",
  language = "French",
  apiKey,
  outputWavPath,
}) {
  const key = getGeminiApiKey(apiKey);
  if (!key) throw new Error("GEMINI_API_KEY is required for Google AI Studio Voiceover.");

  const url = "https://generativelanguage.googleapis.com/v1beta/interactions";
  
  // Send ONLY the voiceover script text to TTS, never conversational instructions or speaker cues
  const cleanScript = scriptText
    .replace(/^(Narrateur|Voix|Voiceover|Narrator)\s*:\s*/gmi, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/^[#\*\-]+\s*/gm, "")
    .replace(/^["']|["']$/g, "")
    .trim();

  const payload = {
    model: "gemini-3.8-flash-tts",
    input: [
      {
        type: "user_input",
        content: [{ type: "text", text: cleanScript }],
      },
    ],
    response_format: { type: "audio", mime_type: "audio/wav" },
    generation_config: { speech_config: [{ voice: voiceName }] },
    store: false,
  };

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 503) {
      console.warn(`[Gemini TTS] 503 spike, retrying in 2s (attempt ${attempt + 1}/3)...`);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    break;
  }

  if (!response || !response.ok) {
    const errorText = await response.text();
    throw new Error(`Google AI Studio Voice Synthesis failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (data.status !== "completed") {
    throw new Error(`Gemini TTS did not complete: status=${data.status}`);
  }

  const audioParts = (data.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === "audio");

  if (!audioParts.length || !audioParts[0].data) {
    throw new Error("Gemini TTS returned no audio data.");
  }

  const rawBytes = Buffer.from(audioParts[0].data, "base64");
  mkdirSync(dirname(outputWavPath), { recursive: true });

  const tempAudio = outputWavPath + ".input.wav";
  writeFileSync(tempAudio, rawBytes);

  const ffmpegBin = getFfmpegPath();
  const transcode = spawnSync(ffmpegBin, [
    "-y",
    "-i", tempAudio,
    "-ar", "44100",
    "-ac", "1",
    outputWavPath,
  ]);

  if (transcode.status !== 0) {
    writeFileSync(outputWavPath, rawBytes);
  }

  return { ok: true, path: outputWavPath, voice: voiceName };
}

/**
 * Generate or fetch real photorealistic 3D hero images
 * Tier 1: Pollinations AI (Clean 3D render, no watermarks)
 * Tier 2: Wikimedia Commons (High-res authentic commercial photography, 100% free & reliable)
 */
export async function generateHeroImage({ prompt, keyword, heroTitle, outputPngPath }) {
  mkdirSync(dirname(outputPngPath), { recursive: true });

  // Tier 1: Try Pollinations 3D render (clean query without forbidden dimensions/seed)
  try {
    const cleanPrompt = `${prompt || heroTitle || keyword}, photorealistic 3D render, studio lighting, clean background, 8k, product commercial photography, sharp focus, no text`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?nologo=true`;

    console.log(`[Image AI] Trying 3D render: "${(prompt || heroTitle || keyword || '').slice(0, 40)}..."`);
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 6000) {
        writeFileSync(outputPngPath, Buffer.from(buf));
        console.log(`[Image AI] ✓ 3D render generated successfully: ${outputPngPath}`);
        return { ok: true, path: outputPngPath, source: "pollinations" };
      }
    }
  } catch (err) {
    console.warn(`[Image AI] Pollinations skipped (${err.message}). Using Wikimedia Commons...`);
  }

  // Tier 2: Search Wikimedia Commons for real, high-res photography
  try {
    const searchQuery = heroTitle || keyword || prompt || "editorial";
    console.log(`[Image AI] Searching authentic photo for: "${searchQuery}"...`);
    const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchQuery)}&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url&iiurlwidth=960&format=json`;
    const res = await fetch(wikiUrl, {
      headers: { "User-Agent": "KineticReelEngine/2.0 (contact@kineticreel.com)" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const json = await res.json();
      const pages = Object.values(json.query?.pages || {});
      const thumbUrl = pages[0]?.imageinfo?.[0]?.thumburl || pages[0]?.imageinfo?.[0]?.url;
      if (thumbUrl) {
        const imgRes = await fetch(thumbUrl, {
          headers: { "User-Agent": "KineticReelEngine/2.0 (contact@kineticreel.com)" },
          signal: AbortSignal.timeout(12000),
        });
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer();
          if (buf.byteLength > 4000) {
            writeFileSync(outputPngPath, Buffer.from(buf));
            console.log(`[Image AI] ✓ Real photography fetched: ${outputPngPath}`);
            return { ok: true, path: outputPngPath, source: "wikimedia" };
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Image AI] Wikimedia fetch error: ${err.message}`);
  }

  return { ok: false, fallback: true };
}
