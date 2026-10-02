import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getStyle, generateStyleCss } from "./styles/index.mjs";

/**
 * Builds the complete HyperFrames / GSAP kinetic composition powered by the Editing Styles Library
 * 
 * Available Styles:
 * - fares-editorial (Default: @nv3us Fares dark luxury kinetic short)
 * - swiss-editorial (Modernist cream/black high contrast)
 * - cyber-matrix (Futuristic cyan/navy HUD tech)
 * - minimal-luxury (Matte charcoal & warm gold)
 */
export function buildCompositionHtml({
  projectDir,
  title,
  scenes,
  words,
  totalDuration,
  voiceAudioRel = "assets/audio/voice.wav",
  styleName = "fares-editorial",
  outputPath,
}) {
  const currentStyle = getStyle(styleName);

  // Map words into scenes
  const sceneWordsMap = {};
  for (const sc of scenes) {
    sceneWordsMap[sc.id] = words.filter((w) => w.sceneId === sc.id);
  }

  // Detect Arabic script
  const isArabic = /[\u0600-\u06FF]/.test(words.map((w) => w.word).join(" "));
  const textDir = isArabic ? "rtl" : "ltr";

  // Calculate scene time ranges
  const sceneRanges = scenes.map((sc, index) => {
    const scWords = sceneWordsMap[sc.id] || [];
    const startTime = scWords.length > 0 ? Math.max(0, scWords[0].time - 0.2) : index * (totalDuration / scenes.length);
    const endTime = index < scenes.length - 1
      ? Math.max(startTime + 1.5, ((sceneWordsMap[scenes[index + 1].id] || [])[0]?.time || (startTime + 3)) - 0.05)
      : totalDuration;
    return { id: sc.id, startTime: Number(startTime.toFixed(2)), endTime: Number(endTime.toFixed(2)) };
  });

  // Prepare HyperFrames SFX Audio Elements
  const sfxElements = [];
  let trackIndex = 11;

  // Intro cinematic whoosh
  sfxElements.push(`<audio id="sfx_intro" src="${currentStyle.sfx.intro}" data-start="0.0" data-duration="1.5" data-track-index="${trackIndex++}" data-volume="0.35" preload="auto"></audio>`);

  // Per-scene transitions & keyword bass impacts
  sceneRanges.forEach((range, idx) => {
    if (idx > 0) {
      sfxElements.push(`<audio id="sfx_cut_${range.id}" src="${currentStyle.sfx.transition}" data-start="${range.startTime}" data-duration="0.57" data-track-index="${trackIndex++}" data-volume="0.25" preload="auto"></audio>`);
    }
    const scWords = sceneWordsMap[range.id] || [];
    const keyWord = scWords.find((w) => w.isKeyword);
    if (keyWord) {
      const impactSfx = idx % 2 === 0 ? currentStyle.sfx.impactBass1 : currentStyle.sfx.impactBass2;
      sfxElements.push(`<audio id="sfx_hit_${range.id}" src="${impactSfx}" data-start="${keyWord.time}" data-duration="1.5" data-track-index="${trackIndex++}" data-volume="0.8" preload="auto"></audio>`);
    }
  });

  // Build HTML for each scene
  const scenesHtml = scenes.map((sc, index) => {
    const range = sceneRanges[index];
    const isDark = sc.theme === "dark" || index % 2 === 1;
    const themeClass = isDark ? "dark" : "light";
    const scWords = sceneWordsMap[sc.id] || [];

    // Format words into 2-3 staggered lines (.ln, .ln.i1, .ln.i2)
    const lineGroups = [];
    if (scWords.length <= 4) {
      const keyIdx = scWords.findIndex((w) => w.isKeyword);
      const splitAt = keyIdx > 0 ? keyIdx : Math.ceil(scWords.length / 2);
      lineGroups.push({ indent: "", words: scWords.slice(0, splitAt) });
      if (splitAt < scWords.length) {
        lineGroups.push({ indent: "i1", words: scWords.slice(splitAt) });
      }
    } else {
      const keyIdx = scWords.findIndex((w) => w.isKeyword);
      if (keyIdx > 0 && keyIdx < scWords.length) {
        const mid = Math.floor(keyIdx / 2);
        lineGroups.push({ indent: "", words: scWords.slice(0, Math.max(1, mid)) });
        lineGroups.push({ indent: "i1", words: scWords.slice(Math.max(1, mid), keyIdx) });
        lineGroups.push({ indent: "i2", words: scWords.slice(keyIdx) });
      } else {
        const l1 = Math.ceil(scWords.length / 3);
        const l2 = Math.ceil((scWords.length * 2) / 3);
        lineGroups.push({ indent: "", words: scWords.slice(0, l1) });
        lineGroups.push({ indent: "i1", words: scWords.slice(l1, l2) });
        lineGroups.push({ indent: "i2", words: scWords.slice(l2) });
      }
    }

    const linesHtml = lineGroups
      .filter((g) => g.words.length > 0)
      .map((g) => {
        const lineContent = g.words
          .map((w) => {
            const isKey = w.isKeyword;
            const kClass = isKey ? "k slam" : "";
            return `<span class="w ${kClass}" data-t="${w.time}" id="${w.id}">${w.word}</span>`;
          })
          .join(" ");
        return `<div class="ln ${g.indent}" data-layout-allow-overflow="true">${lineContent}</div>`;
      })
      .join("\n              ");

    // Pure Cinematic Hero Visual
    const heroImgName = `${sc.hero_name || `hero_${sc.id}`}.png`;
    const heroImgOnDisk = projectDir ? existsSync(join(projectDir, "assets/img", heroImgName)) : false;

    const heroContent = heroImgOnDisk
      ? `
        <div class="hero-stage">
          <div class="hero-aura ${themeClass}-aura"></div>
          <img src="assets/img/${heroImgName}" alt="${sc.hero_title || 'Visual'}" class="hero-visual" />
        </div>
      `
      : `
        <div class="hero-stage">
          <div class="hero-aura ${themeClass}-aura" style="opacity: 0.65; transform: scale(1.2);"></div>
          <div class="hero-fallback-orb"></div>
        </div>
      `;

    const heroMarkup = `
      <div class="hero-box" id="hero_${sc.id}" data-layout-allow-overlap="true" data-layout-allow-overflow="true">
        ${heroContent}
      </div>
    `;

    return `
    <!-- SCENE ${sc.id} [${range.startTime}s - ${range.endTime}s] -->
    <section class="scene ${themeClass}" id="scene_${sc.id}" style="display: ${index === 0 ? 'block' : 'none'}; opacity: ${index === 0 ? 1 : 0};" data-layout-allow-overlap="true" data-layout-allow-occlusion="true" data-layout-allow-overflow="true">
      <div class="shake" id="shake_${sc.id}" data-layout-allow-overflow="true">
        <div class="cam" id="cam_${sc.id}" data-layout-allow-overflow="true">
          <div class="grid" data-layout-allow-overlap="true"></div>
          <div class="vignette" data-layout-allow-overlap="true"></div>

          <!-- Pure Hero Visual Centerpiece -->
          ${heroMarkup}

          <!-- Spacious Enlarged Captions Stage -->
          <div class="cap ${textDir}" id="cap_${sc.id}" data-layout-allow-overlap="true" data-layout-allow-occlusion="true" data-layout-allow-overflow="true">
            ${linesHtml}
          </div>
        </div>
      </div>
    </section>
    `;
  }).join("\n");

  // GSAP Animation Code Driven by Style Preset
  const anim = currentStyle.animation;
  const gsapTimelineCode = `
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    // Scene ranges configuration
    const sceneConfig = ${JSON.stringify(sceneRanges)};

    // Animate Scenes Switching
    sceneConfig.forEach((cfg, idx) => {
      if (idx > 0) {
        tl.call(() => {
          document.querySelectorAll('.scene').forEach(s => {
            s.style.display = 'none';
            s.style.opacity = '0';
          });
          const curr = document.getElementById('scene_' + cfg.id);
          if (curr) {
            curr.style.display = 'block';
            curr.style.opacity = '1';
          }
        }, null, cfg.startTime);
      }

      // Cinematic camera push-in for scene
      const cam = document.getElementById('cam_' + cfg.id);
      if (cam) {
        tl.fromTo(cam, 
          { scale: ${anim.camera.startScale}, rotation: (idx % 2 === 0 ? -${anim.camera.rotationFactor} : ${anim.camera.rotationFactor}) },
          { scale: ${anim.camera.endScale}, rotation: 0, duration: cfg.endTime - cfg.startTime, ease: "none" },
          cfg.startTime
        );
      }

      // Hero entry with overshoot pop & floating ambient physics
      const hero = document.getElementById('hero_' + cfg.id);
      if (hero) {
        tl.fromTo(hero,
          ${JSON.stringify(anim.hero.entrance.from)},
          ${JSON.stringify(anim.hero.entrance.to)},
          cfg.startTime + 0.05
        );
        const floatDur = Math.max(0.6, (cfg.endTime - cfg.startTime - 0.7) / 2);
        tl.to(hero, {
          y: ${anim.hero.floating.y},
          rotation: (idx % 2 === 0 ? ${anim.hero.floating.rotation} : -${anim.hero.floating.rotation}),
          duration: floatDur,
          yoyo: true,
          repeat: 1,
          ease: "${anim.hero.floating.ease}"
        }, cfg.startTime + 0.7);
      }
    });

    // Word by word blur-to-sharp reveals
    const wordsData = ${JSON.stringify(words)};
    wordsData.forEach(w => {
      const el = document.getElementById(w.id);
      if (!el) return;

      if (w.isKeyword) {
        // Standout Keyword Slam Hit
        tl.fromTo(el,
          ${JSON.stringify(anim.keyword.from)},
          ${JSON.stringify(anim.keyword.to)},
          w.time
        );
        // Synchronized Screen shake on keyword
        const shakeEl = document.getElementById('shake_' + w.sceneId);
        if (shakeEl) {
          tl.to(shakeEl, ${JSON.stringify(anim.shake)}, w.time);
        }
      } else {
        // Standard kinetic text blur reveal
        tl.fromTo(el,
          ${JSON.stringify(anim.word.from)},
          ${JSON.stringify(anim.word.to)},
          w.time
        );
      }
    });

    // Register with HyperFrames
    window.__timelines["main"] = tl;
    tl.seek(0);
  `;

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1080, height=1920">
  <title>${title} | ${currentStyle.name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${currentStyle.fonts.googleFontsUrl}" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    ${generateStyleCss(currentStyle)}
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${totalDuration}" data-width="1080" data-height="1920" data-layout-allow-overlap="true" data-layout-allow-occlusion="true" data-layout-allow-overflow="true">
    <!-- Main Voiceover Audio Track -->
    <audio id="voiceAudio" src="${voiceAudioRel}" data-start="0" data-duration="${totalDuration}" data-track-index="10" data-volume="1.0" preload="auto"></audio>

    <!-- Synchronized SFX Sound Packs -->
    ${sfxElements.join("\n    ")}

    <!-- Scenes Container -->
    ${scenesHtml}
  </div>

  <script>
    document.addEventListener("DOMContentLoaded", () => {
      ${gsapTimelineCode}
    });
  </script>
</body>
</html>
`;

  writeFileSync(outputPath, fullHtml, "utf8");
  return outputPath;
}
