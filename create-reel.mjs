#!/usr/bin/env node

import { existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getGeminiApiKey,
  generateStoryboard,
  synthesizeVoiceWithGemini,
  generateHeroImage
} from "./lib/gemini-ai.mjs";
import { alignWordsWithAudio } from "./lib/word-aligner.mjs";
import { makeTransparentCutout } from "./lib/cutout-engine.mjs";
import { buildCompositionHtml } from "./lib/composition-builder.mjs";
import { renderVideoToMp4 } from "./lib/renderer.mjs";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    topic: null,
    duration: 30,
    voice: "Puck", // Puck, Aoede, Fenrir, Charon, Kore
    lang: "French",
    apiKey: null,
    output: null,
    skipRender: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--topic" || arg === "-t") params.topic = args[++i];
    else if (arg === "--duration" || arg === "-d") params.duration = Number(args[++i]);
    else if (arg === "--voice" || arg === "-v") params.voice = args[++i];
    else if (arg === "--lang" || arg === "-l") params.lang = args[++i];
    else if (arg === "--key" || arg === "-k") params.apiKey = args[++i];
    else if (arg === "--output" || arg === "-o") params.output = args[++i];
    else if (arg === "--skip-render") params.skipRender = true;
  }
  return params;
}

async function main() {
  console.log("\n=======================================================");
  console.log(" 🎬 KINETIC EDITORIAL REEL AUTOMATION ENGINE");
  console.log(" Powered by Google AI Studio (Gemini 2.0 Audio) + HyperFrames");
  console.log("=======================================================\n");

  const params = parseArgs();

  const apiKey = getGeminiApiKey(params.apiKey);
  if (!apiKey) {
    console.error("❌ ERREUR: Clé Google AI Studio manquante (GEMINI_API_KEY).");
    console.error("Veuillez définir votre clé via:");
    console.error("  $env:GEMINI_API_KEY = 'votre_cle_ici'");
    console.error("  ou créez un fichier .env avec GEMINI_API_KEY=votre_cle\n");
    process.exit(1);
  }

  if (!params.topic) {
    console.log("Usage: node create-reel.mjs --topic \"<Sujet ou Script>\" [options]");
    console.log("\nOptions:");
    console.log("  --topic, -t       Sujet de la vidéo ou script (Requis)");
    console.log("  --duration, -d    Durée approximative en secondes (défaut: 30)");
    console.log("  --voice, -v       Voix Google AI Studio: Puck, Aoede, Fenrir, Charon, Kore (défaut: Puck)");
    console.log("  --lang, -l        Langue: French, English, Spanish, Arabic, etc. (défaut: French)");
    console.log("  --key, -k         Clé GEMINI_API_KEY explicite");
    console.log("  --output, -o      Chemin du fichier MP4 de sortie");
    console.log("  --skip-render     Générer les assets et le projet HTML sans lancer le rendu MP4\n");
    process.exit(0);
  }

  // Create Project Folder
  const slug = params.topic
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30) || "reel";
  
  const timestamp = Date.now().toString().slice(-4);
  const projectDir = resolve(__dirname, `scratch/reel-${slug}-${timestamp}`);
  mkdirSync(projectDir, { recursive: true });

  console.log(`📂 Dossier du projet: ${projectDir}`);

  // Copy template assets (fonts, SFX)
  const templateAssetsDir = join(__dirname, "templates/assets");
  const projectAssetsDir = join(projectDir, "assets");
  if (existsSync(templateAssetsDir)) {
    cpSync(templateAssetsDir, projectAssetsDir, { recursive: true });
  }
  mkdirSync(join(projectAssetsDir, "audio"), { recursive: true });
  mkdirSync(join(projectAssetsDir, "img"), { recursive: true });

  // STAGE 1: Generate Kinetic Storyboard
  console.log(`\n[1/6] 📝 Génération du storyboard et du script kinetic avec Gemini 2.0 Flash...`);
  console.log(`      Sujet: "${params.topic}" | Langue: ${params.lang} | Durée: ~${params.duration}s`);
  const storyboard = await generateStoryboard({
    topic: params.topic,
    targetDurationSeconds: params.duration,
    language: params.lang,
    apiKey,
  });

  writeFileSync(join(projectDir, "storyboard.json"), JSON.stringify(storyboard, null, 2), "utf8");
  console.log(`      ✓ Storyboard généré (${storyboard.scenes?.length || 0} scènes, Titre: "${storyboard.title}")`);

  // STAGE 2: Synthesize Voiceover via Google AI Studio Gemini 2.0 Audio
  console.log(`\n[2/6] 🎙️ Synthèse du voiceover ultra-naturel (Google AI Studio - Voix: ${params.voice})...`);
  const voiceWavPath = join(projectAssetsDir, "audio/voice.wav");
  await synthesizeVoiceWithGemini({
    scriptText: storyboard.fullScript,
    voiceName: params.voice,
    language: params.lang,
    apiKey,
    outputWavPath: voiceWavPath,
  });
  console.log(`      ✓ Audio généré et converti en WAV 44.1kHz: assets/audio/voice.wav`);

  // STAGE 3: Word Alignment & Acoustic Sync
  console.log(`\n[3/6] ⏱️ Alignement acoustique mot par mot pour les reveals cinétiques...`);
  const wordsJsonPath = join(projectDir, "words.json");
  const alignmentResult = alignWordsWithAudio({
    wavPath: voiceWavPath,
    scenes: storyboard.scenes,
    fullScript: storyboard.fullScript,
    outputJsonPath: wordsJsonPath,
  });
  console.log(`      ✓ ${alignmentResult.words.length} mots synchronisés avec précision (Durée totale: ${alignmentResult.totalDuration}s)`);

  // STAGE 4: Hero Assets Generation & Background Removal
  console.log(`\n[4/6] 🎨 Préparation des visuels héros pour chaque scène...`);
  for (const scene of storyboard.scenes) {
    const heroName = scene.hero_name || `hero_${scene.id}`;
    const rawHeroPath = join(projectAssetsDir, `img/${heroName}_raw.png`);
    const finalHeroPath = join(projectAssetsDir, `img/${heroName}.png`);

    console.log(`      • Scène ${scene.id}: ${scene.hero_title || heroName}...`);
    try {
      await generateHeroImage({
        prompt: scene.hero_prompt,
        keyword: scene.keyword,
        heroTitle: scene.hero_title,
        outputPngPath: rawHeroPath,
      });
      await makeTransparentCutout({
        inputImagePath: rawHeroPath,
        outputPngPath: finalHeroPath,
      });
    } catch (e) {
      console.log(`        ℹ️ Image IA ignorée ou fallback activé (${e.message.slice(0, 70)})`);
    }
  }

  // STAGE 5: Build HyperFrames Composition
  console.log(`\n[5/6] 📐 Assemblage de la composition HTML5 / GSAP / Kinetic Editorial (9:16)...`);
  const indexPath = join(projectDir, "index.html");
  buildCompositionHtml({
    projectDir,
    title: storyboard.title || params.topic,
    scenes: storyboard.scenes,
    words: alignmentResult.words,
    totalDuration: alignmentResult.totalDuration,
    voiceAudioRel: "assets/audio/voice.wav",
    outputPath: indexPath,
  });

  // Write meta.json and hyperframes.json configuration
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

  console.log(`      ✓ Composition prête: ${indexPath}`);

  // STAGE 6: Render to MP4
  if (params.skipRender) {
    console.log("\n[6/6] ⏭️ Étape de rendu ignorée (--skip-render demandé).");
    console.log(`Pour prévisualiser en direct: cd "${projectDir}" && npx hyperframes preview`);
    return;
  }

  const outputMp4Path = params.output
    ? resolve(params.output)
    : join(projectDir, `${slug}.mp4`);

  console.log(`\n[6/6] 🎥 Rendu headless ultra-haute qualité vers MP4 (1080x1920)...`);
  renderVideoToMp4({
    projectDir,
    outputMp4Path,
  });

  console.log("\n=======================================================");
  console.log(" 🎉 VIDÉO MP4 GÉNÉRÉE AVEC SUCCÈS !");
  console.log(` 📁 Emplacement: ${outputMp4Path}`);
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("\n❌ ERREUR FATALE:", err.message);
  console.error(err.stack);
  process.exit(1);
});
