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
  const cleanTopic = topic.replace(/^[Ff]ais[- ]moi un reel (?:de \d+s )?sur /i, "").trim();
  const isArabic = /[\u0600-\u06FF]/.test(topic);

  // Dynamically adapt structure according to duration and language
  const sceneCount = Math.max(5, Math.min(10, Math.round(targetDurationSeconds / 4)));
  
  if (isArabic) {
    return {
      topic: cleanTopic,
      language: "Arabic",
      targetDuration: targetDurationSeconds,
      title: cleanTopic.slice(0, 30),
      fullScript: `${cleanTopic}. حقيقة مهمة يجب أن تعرفها. تفاصيل تغير نظرتك للموضوع. النتيجة ستفاجئك بالكامل. ابدأ الآن ولا تتردد.`,
      scenes: [
        {
          id: 1,
          theme: "light",
          badge: "01 / المدخل",
          text: `${cleanTopic}.`,
          keyword: "انتبه",
          hero_name: "hero_1",
          hero_title: "رمز البداية",
          hero_prompt: "isolated 3D render of a futuristic compass floating, cinematic lighting, 8k, Octane render, no text",
          hero_search: "antique brass compass",
          sfx: "slam",
          motion: "zoom-in"
        },
        {
          id: 2,
          theme: "dark",
          badge: "02 / السر",
          text: "حقيقة مهمة يجب أن تعرفها.",
          keyword: "حقيقة",
          hero_name: "hero_2",
          hero_title: "الجوهر",
          hero_prompt: "isolated 3D render of a glowing crystal prism, dark background, cinematic lighting, no text",
          hero_search: "crystal prism",
          sfx: "whoosh",
          motion: "slide-left"
        },
        {
          id: 3,
          theme: "light",
          badge: "03 / العمق",
          text: "تفاصيل تغير نظرتك للموضوع.",
          keyword: "رؤية",
          hero_name: "hero_3",
          hero_title: "القيمة",
          hero_prompt: "isolated 3D render of a vintage luxury pocket watch, studio lighting, no text",
          hero_search: "vintage pocket watch",
          sfx: "impact",
          motion: "zoom-in"
        },
        {
          id: 4,
          theme: "dark",
          badge: "04 / التحول",
          text: "النتيجة ستفاجئك بالكامل.",
          keyword: "نتيجة",
          hero_name: "hero_4",
          hero_title: "الفرصة",
          hero_prompt: "isolated 3D render of a golden hourglass with glowing sand, dark background, cinematic lighting, no text",
          hero_search: "golden hourglass",
          sfx: "click",
          motion: "slide-left"
        },
        {
          id: 5,
          theme: "light",
          badge: "05 / القرار",
          text: "ابدأ الآن ولا تتردد.",
          keyword: "الآن",
          hero_name: "hero_5",
          hero_title: "المستقبل",
          hero_prompt: "isolated 3D render of a glowing futuristic sphere, cinematic lighting, no text",
          hero_search: "futuristic sphere",
          sfx: "slam",
          motion: "zoom-out"
        }
      ]
    };
  }

  return {
    topic: cleanTopic,
    language,
    targetDuration: targetDurationSeconds,
    title: cleanTopic.toUpperCase().slice(0, 30),
    fullScript: `${cleanTopic}. Une réalité essentielle à comprendre. Les détails qui font toute la différence. Une perspective totalement nouvelle. Passez à l'action dès aujourd'hui.`,
    scenes: [
      {
        id: 1,
        theme: "light",
        badge: "01 / CONSTANT",
        text: `${cleanTopic}.`,
        keyword: "FOCUS",
        hero_name: "hero_1",
        hero_title: cleanTopic,
        hero_prompt: `isolated 3D render representing ${cleanTopic}, clean studio lighting, no text`,
        hero_search: "brass compass",
        sfx: "slam",
        motion: "zoom-in"
      },
      {
        id: 2,
        theme: "dark",
        badge: "02 / INSIGHT",
        text: "Une réalité essentielle à comprendre.",
        keyword: "SECRET",
        hero_name: "hero_2",
        hero_title: "Insight",
        hero_prompt: "mysterious glowing crystal prism isolated 3D, dramatic lighting, dark background, no text",
        hero_search: "crystal prism",
        sfx: "whoosh",
        motion: "slide-left"
      },
      {
        id: 3,
        theme: "light",
        badge: "03 / IMPACT",
        text: "Les détails qui font toute la différence.",
        keyword: "IMPACT",
        hero_name: "hero_3",
        hero_title: "Données",
        hero_prompt: "luxury vintage pocket watch 3D render, clean studio lighting, no text",
        hero_search: "vintage pocket watch",
        sfx: "impact",
        motion: "zoom-in"
      },
      {
        id: 4,
        theme: "dark",
        badge: "04 / VALEUR",
        text: "Une perspective totalement nouvelle.",
        keyword: "VISION",
        hero_name: "hero_4",
        hero_title: "Valeur",
        hero_prompt: "golden hourglass with floating particles 3D render, no text",
        hero_search: "golden hourglass",
        sfx: "click",
        motion: "slide-left"
      },
      {
        id: 5,
        theme: "light",
        badge: "05 / ACTION",
        text: "Passez à l'action dès aujourd'hui.",
        keyword: "MAINTENANT",
        hero_name: "hero_5",
        hero_title: "Futur",
        hero_prompt: "futuristic tech crystal sphere 3D render, studio lighting, no text",
        hero_search: "futuristic sphere",
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
You are an award-winning Creative Director & Motion Designer specializing in "Kinetic Editorial" vertical reels (9:16) in the signature high-end style of @nv3us / Fares.
Style rules:
- High contrast, deadpan, rhythmic, punchy typography (alternating cream '#fff8f3' and deep black '#060505').
- Each scene has ONE red keyword (#e71f28) that hits on the visual beat.
- Voiceover text must be concise, catchy, rhythmic, written naturally in ${language} directly inspired by the user's specific topic.
- Output MUST be valid JSON only, without markdown fences or extraneous text.

CRITICAL RULES FOR VISUAL ASSETS (HERO OBJECTS):
- Every scene must feature a REAL, TANGIBLE, PHYSICAL HERO OBJECT directly adapted to that scene's specific idea (like in luxury 3D commercial reels).
- "hero_search" MUST ALWAYS BE IN ENGLISH, 2-3 words describing a concrete physical item.
  Examples across diverse domains: 'luxury sports car', 'golden coins stack', 'vintage pocket watch', 'modern architecture tower', 'coffee beans macro', 'quantum computer chip', 'golden hourglass', 'telescope lens'.
- ABSOLUTELY FORBIDDEN in hero_search: Never use abstract words, verbs, non-English words, or words like 'book', 'paper', 'text', 'document', 'page', 'card', 'scan', 'manuscript', 'calligraphy', 'chart', 'diagram', 'pdf'.
- "hero_prompt": descriptive prompt in English for 3D render ("isolated 3D render of [subject], dramatic cinematic studio lighting, floating, dark background, 8k, Octane render, photorealistic, no text").
- Exactly ${sceneCount} scenes to fit ~${targetDurationSeconds} seconds.
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
      "keyword": "KEYWORD",
      "hero_name": "hero_1",
      "hero_title": "Short descriptive title of the physical object",
      "hero_search": "2-3 English keywords describing a concrete physical object relevant to this scene",
      "hero_prompt": "isolated 3D render of [subject], soft cinematic studio lighting, floating, 8k, no text",
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

  const candidateTTSModels = [
    "gemini-3.8-flash-tts",
    "gemini-3.8-flash-lite-tts",
  ];

  let response = null;
  let lastErrorText = "";

  for (const model of candidateTTSModels) {
    const payload = {
      model,
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

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 503) {
          console.warn(`[Google AI Studio TTS] ${model} 503, retrying in 2s...`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        if (response.status === 429) {
          lastErrorText = await response.text();
          console.warn(`[Google AI Studio TTS] ${model} reached daily quota. Rotating to next Google AI Studio TTS model...`);
          break;
        }

        if (!response.ok) {
          lastErrorText = await response.text();
          break;
        }

        break;
      } catch (err) {
        lastErrorText = err.message;
      }
    }

    if (response && response.ok) {
      console.log(`[Google AI Studio TTS] ✓ Voice synthesized via ${model} (Voice: ${voiceName})`);
      break;
    }
  }

  if (!response || !response.ok) {
    throw new Error(`Google AI Studio Voice Synthesis failed: ${lastErrorText}`);
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
 * Curated high-resolution universal physical objects (Time, Navigation, Cosmos, Precision)
 */
const CURATED_HERO_ASSETS = [
  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Vienna_-_Vintage_pocket_watch_display_-_0499.jpg/1280px-Vienna_-_Vintage_pocket_watch_display_-_0499.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Boussole_ancienne.jpg/1280px-Boussole_ancienne.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Time_Twist.jpg/1280px-Time_Twist.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Crescent_Moon_ESO.jpg/1280px-Crescent_Moon_ESO.jpg",
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cf/Coffee_Beans_macro_1.jpg/1280px-Coffee_Beans_macro_1.jpg"
];

// Pure document & 2D print blacklist (prevents text-in-box and scan downloads)
const BANNED_IMAGE_TERMS = [
  "pdf", "djvu", "book", "scan", "manuscript", "document", "text", "page",
  "newspaper", "diagram", "chart", "screenshot", "stamp", "postage",
  "calligraphy", "cover", "titlepage", "table", "graph", "census",
  "certificate", "letter", "passport", "id_card", "sign", "placard",
  "label", "map", "drawing", "flag", "logo"
];

/**
 * Searches Wikimedia Commons for authentic, high-res photography with strict content filters
 */
async function searchWikimediaPhoto(term) {
  const parts = term.trim().split(/\s+/).filter(Boolean);
  const queries = [
    term,
    parts.slice(-2).join(" "),
    parts[parts.length - 1]
  ].filter((q, idx, arr) => q && arr.indexOf(q) === idx);

  for (const q of queries) {
    try {
      const searchParam = `${q} photo filetype:bitmap -pdf -book -scan -manuscript -document -text -page -newspaper -diagram -chart -screenshot -stamp -coin -map -drawing -postage`;
      const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchParam)}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1280&format=json`;

      const res = await fetch(wikiUrl, {
        headers: { "User-Agent": "KineticReelEngine/2.0 (contact@kineticreel.com)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const data = await res.json();
      const pages = Object.values(data.query?.pages || {});

      for (const p of pages) {
        const info = p.imageinfo?.[0];
        if (!info) continue;

        const titleLower = (p.title || "").toLowerCase();
        if (BANNED_IMAGE_TERMS.some((w) => titleLower.includes(w))) continue;
        if (info.mime !== "image/jpeg" && info.mime !== "image/png" && info.mime !== "image/webp") continue;
        if (info.width < 500 || info.height < 400) continue;

        const targetUrl = info.thumburl || info.url;
        if (!targetUrl) continue;

        const imgRes = await fetch(targetUrl, {
          headers: { "User-Agent": "KineticReelEngine/2.0 (contact@kineticreel.com)" },
          signal: AbortSignal.timeout(12000),
        });
        if (!imgRes.ok) continue;

        const buf = await imgRes.arrayBuffer();
        if (buf.byteLength > 8000) {
          return { buffer: Buffer.from(buf), title: p.title, url: targetUrl };
        }
      }
    } catch {}
  }
  return null;
}

/**
 * Generate or fetch authentic, high-impact hero visual objects
 * Tier 1: Authentic high-res photography via Wikimedia Commons (strict photo/artifact filter)
 * Tier 2: Free 3D render via Pollinations (512x512 with automatic watermark crop)
 * Tier 3: Curated museum & luxury physical masterpieces
 */
export async function generateHeroImage({
  prompt,
  keyword,
  heroTitle,
  heroSearch,
  sceneIndex = 0,
  outputPngPath
}) {
  mkdirSync(dirname(outputPngPath), { recursive: true });

  // 1. Determine English search keywords
  const englishSearch = (heroSearch && heroSearch.trim()) || "luxury antique object";
  console.log(`[Image Engine] Searching authentic photo for: "${englishSearch}"...`);

  // Tier 1: Search high-resolution authentic photography on Wikimedia Commons
  const wikiResult = await searchWikimediaPhoto(englishSearch);
  if (wikiResult) {
    writeFileSync(outputPngPath, wikiResult.buffer);
    console.log(`[Image Engine] ✓ Authentic photography fetched (${wikiResult.title.slice(0, 35)}...): ${outputPngPath}`);
    return { ok: true, path: outputPngPath, source: "wikimedia" };
  }

  // Tier 2: Try Pollinations 3D render (without nologo parameter to avoid 402)
  try {
    const clean3DPrompt = `${englishSearch}, isolated 3D render, dark dramatic studio lighting, 8k, Octane render, photorealistic, no text`;
    const polliUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(clean3DPrompt)}?width=512&height=512`;
    console.log(`[Image Engine] Generating 3D render via Pollinations...`);
    const pRes = await fetch(polliUrl, { signal: AbortSignal.timeout(15000) });
    if (pRes.ok) {
      const buf = await pRes.arrayBuffer();
      if (buf.byteLength > 6000) {
        const rawTemp = outputPngPath + ".polli.jpg";
        writeFileSync(rawTemp, Buffer.from(buf));
        const ffmpegBin = getFfmpegPath();
        const crop = spawnSync(ffmpegBin, [
          "-y",
          "-i", rawTemp,
          "-vf", "crop=in_w:in_h-36:0:0",
          outputPngPath
        ]);
        if (crop.status === 0 && existsSync(outputPngPath)) {
          console.log(`[Image Engine] ✓ 3D render generated and cleaned: ${outputPngPath}`);
          return { ok: true, path: outputPngPath, source: "pollinations" };
        }
        writeFileSync(outputPngPath, Buffer.from(buf));
        return { ok: true, path: outputPngPath, source: "pollinations" };
      }
    }
  } catch (err) {
    console.warn(`[Image Engine] Pollinations skipped (${err.message}).`);
  }

  // Tier 3: Guaranteed Curated High-Definition Masterpiece Fallback
  console.log(`[Image Engine] Using curated high-definition masterpiece asset...`);
  const curatedUrl = CURATED_HERO_ASSETS[sceneIndex % CURATED_HERO_ASSETS.length];
  try {
    const cRes = await fetch(curatedUrl, {
      headers: { "User-Agent": "KineticReelEngine/2.0 (contact@kineticreel.com)" },
      signal: AbortSignal.timeout(12000),
    });
    if (cRes.ok) {
      const buf = await cRes.arrayBuffer();
      if (buf.byteLength > 5000) {
        writeFileSync(outputPngPath, Buffer.from(buf));
        console.log(`[Image Engine] ✓ Curated high-res asset saved: ${outputPngPath}`);
        return { ok: true, path: outputPngPath, source: "curated" };
      }
    }
  } catch (cErr) {
    console.warn(`[Image Engine] Curated fetch error: ${cErr.message}`);
  }

  return { ok: false, fallback: true };
}
