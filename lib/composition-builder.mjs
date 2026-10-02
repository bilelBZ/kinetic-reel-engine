import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Builds the complete Kinetic Editorial Reel index.html composition
 * Features:
 * - Swiss Staggered Typography (.ln, .ln.i1, .ln.i2)
 * - Huge Red (#E71F28) Keyword Slams with screen shake
 * - High-end specimen photo/render hero frames with floating physics
 * - Audio SFX (Whooshes, Bass Impacts, Foley clicks) synchronized to cuts
 * - Alternating cream (#FFF8F3) and black (#060505) scenes with glow
 */
export function buildCompositionHtml({
  projectDir,
  title,
  scenes,
  words,
  totalDuration,
  voiceAudioRel = "assets/audio/voice.wav",
  outputPath,
}) {
  // Map words into scenes
  const sceneWordsMap = {};
  for (const sc of scenes) {
    sceneWordsMap[sc.id] = words.filter((w) => w.sceneId === sc.id);
  }

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
  sfxElements.push(`<audio id="sfx_intro" src="assets/audio/sfx/whoosh-cinematic.mp3" data-start="0.0" data-duration="1.5" data-track-index="${trackIndex++}" data-volume="0.35" preload="auto"></audio>`);

  // Per-scene whoosh transitions & keyword bass impacts
  sceneRanges.forEach((range, idx) => {
    if (idx > 0) {
      sfxElements.push(`<audio id="sfx_cut_${range.id}" src="assets/audio/sfx/whoosh.mp3" data-start="${range.startTime}" data-duration="0.57" data-track-index="${trackIndex++}" data-volume="0.25" preload="auto"></audio>`);
    }
    const scWords = sceneWordsMap[range.id] || [];
    const keyWord = scWords.find((w) => w.isKeyword);
    if (keyWord) {
      const impactSfx = idx % 2 === 0 ? "impact-bass-1.mp3" : "impact-bass-2.mp3";
      sfxElements.push(`<audio id="sfx_hit_${range.id}" src="assets/audio/sfx/${impactSfx}" data-start="${keyWord.time}" data-duration="1.5" data-track-index="${trackIndex++}" data-volume="0.8" preload="auto"></audio>`);
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
        return `<div class="ln ${g.indent}">${lineContent}</div>`;
      })
      .join("\n              ");

    // Check if an image actually exists on disk in projectDir/assets/img/
    const heroImgName = `${sc.hero_name || `hero_${sc.id}`}.png`;
    const heroImgOnDisk = projectDir ? existsSync(join(projectDir, "assets/img", heroImgName)) : false;

    const heroContent = heroImgOnDisk
      ? `
        <div class="hero-art-frame ${themeClass}-frame">
          <div class="hero-pin"></div>
          <div class="hero-img-wrap">
            <img src="assets/img/${heroImgName}" alt="${sc.hero_title || 'Hero'}" class="hero-img" />
          </div>
          <div class="hero-frame-footer">
            <span class="hero-frame-title">${sc.hero_title || sc.keyword || 'FIGURE'}</span>
            <span class="hero-frame-badge">0${sc.id} // SPECIMEN</span>
          </div>
        </div>
      `
      : `
        <div class="hero-card ${themeClass}-card">
          <div class="hero-tag">${sc.badge || `0${sc.id} / SCENE`}</div>
          <div class="hero-inner">
            <div class="hero-badge-art">
              <div class="badge-icon">✦</div>
              <div class="badge-accent">${sc.hero_title || sc.keyword || 'EDITORIAL'}</div>
              <div class="badge-sub">${sc.badge || 'PRO / EDITION'}</div>
            </div>
          </div>
          <div class="hero-footer">
            <span>KINETIC EDITORIAL</span>
            <span class="dot-live"></span>
          </div>
        </div>
      `;

    const heroMarkup = `
      <div class="hero-box" id="hero_${sc.id}" data-layout-allow-overlap="true">
        ${heroContent}
      </div>
    `;

    return `
    <!-- SCENE ${sc.id} [${range.startTime}s - ${range.endTime}s] -->
    <section class="scene ${themeClass}" id="scene_${sc.id}" style="display: ${index === 0 ? 'block' : 'none'}; opacity: ${index === 0 ? 1 : 0};" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
      <div class="shake" id="shake_${sc.id}">
        <div class="cam" id="cam_${sc.id}">
          <div class="grid" data-layout-allow-overlap="true"></div>
          <div class="vignette" data-layout-allow-overlap="true"></div>

          <!-- Top Meta Bar -->
          <div class="top-bar" data-layout-allow-overlap="true">
            <div class="badge-tag">${sc.badge || `SCENE // 0${sc.id}`}</div>
            <div class="edition-tag">EDITORIAL 9:16</div>
          </div>

          <!-- Centered Hero Centerpiece -->
          ${heroMarkup}

          <!-- Captions Overlay -->
          <div class="cap" id="cap_${sc.id}" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
            ${linesHtml}
          </div>

          <!-- Bottom Status Bar -->
          <div class="bottom-bar" data-layout-allow-overlap="true">
            <div class="hd-pill"><b>4K</b> ULTRA HD</div>
            <div class="timecode">REC ● 00:${String(Math.floor(range.startTime)).padStart(2, '0')}</div>
          </div>
        </div>
      </div>
    </section>
    `;
  }).join("\n");

  // GSAP Animation Code
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
          { scale: 1.10, rotation: (idx % 2 === 0 ? -1.0 : 1.0) },
          { scale: 1.0, rotation: 0, duration: cfg.endTime - cfg.startTime, ease: "none" },
          cfg.startTime
        );
      }

      // Hero entry with overshoot pop & floating ambient physics
      const hero = document.getElementById('hero_' + cfg.id);
      if (hero) {
        tl.fromTo(hero,
          { y: 80, opacity: 0, scale: 0.85, rotation: (idx % 2 === 0 ? -3 : 3) },
          { y: 0, opacity: 1, scale: 1.0, rotation: 0, duration: 0.65, ease: "back.out(1.5)" },
          cfg.startTime + 0.05
        );
        const floatDur = Math.max(0.6, (cfg.endTime - cfg.startTime - 0.7) / 2);
        tl.to(hero, {
          y: -16,
          rotation: (idx % 2 === 0 ? 1.5 : -1.5),
          duration: floatDur,
          yoyo: true,
          repeat: 1,
          ease: "sine.inOut"
        }, cfg.startTime + 0.7);
      }
    });

    // Word by word blur-to-sharp reveals
    const wordsData = ${JSON.stringify(words)};
    wordsData.forEach(w => {
      const el = document.getElementById(w.id);
      if (!el) return;

      if (w.isKeyword) {
        // Red Keyword Slam Hit
        tl.fromTo(el,
          { filter: "blur(24px)", opacity: 0, scale: 1.55, y: 22 },
          { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.22, ease: "power4.out" },
          w.time
        );
        // Screen shake on keyword
        const shakeEl = document.getElementById('shake_' + w.sceneId);
        if (shakeEl) {
          tl.to(shakeEl, { x: 12, y: -8, duration: 0.04, yoyo: true, repeat: 3 }, w.time);
        }
      } else {
        // Standard kinetic text blur reveal
        tl.fromTo(el,
          { filter: "blur(14px)", opacity: 0, scale: 1.2, y: 12 },
          { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.16, ease: "power3.out" },
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
  <title>${title} | Kinetic Editorial Reel</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    @font-face {
      font-family: "Editorial Sans";
      src: url("assets/fonts/Inter-SemiBold.woff2") format("woff2");
      font-weight: 500 600;
      font-style: normal;
    }
    @font-face {
      font-family: "Editorial Sans";
      src: url("assets/fonts/Inter-Bold.woff2") format("woff2");
      font-weight: 700 900;
      font-style: normal;
    }

    :root {
      --cream: #fff8f3;
      --black: #060505;
      --ink: #151211;
      --red: #e71f28;
      --ribbon: #cdc7c0;
      --gold: #d4af37;
      --cyan: #00e5ff;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      background: var(--black);
    }

    #root {
      position: relative;
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      font-family: "Editorial Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    /* Scene scaffolding */
    .scene {
      position: absolute;
      inset: 0;
      overflow: hidden;
      width: 1080px;
      height: 1920px;
    }
    .light { background: var(--cream); color: var(--ink); }
    .dark { background: var(--black); color: #ffffff; }
    .shake, .cam { position: absolute; inset: 0; width: 100%; height: 100%; }
    .cam { transform-origin: 50% 50%; }

    /* Decors & Grid */
    .grid {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image: linear-gradient(rgba(21,18,17,.08) 2px, transparent 2px),
                        linear-gradient(90deg, rgba(21,18,17,.08) 2px, transparent 2px);
      background-size: 96px 96px;
      background-position: 12px 20px;
      -webkit-mask-image: radial-gradient(ellipse 75% 60% at 50% 50%, #000 30%, transparent 85%);
      mask-image: radial-gradient(ellipse 75% 60% at 50% 50%, #000 30%, transparent 85%);
    }
    .dark .grid {
      background-image: linear-gradient(rgba(255,255,255,.05) 2px, transparent 2px),
                        linear-gradient(90deg, rgba(255,255,255,.05) 2px, transparent 2px);
    }
    .vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(ellipse 80% 65% at 50% 50%, transparent 40%, rgba(6,5,5,.85) 100%);
    }

    /* Meta bars */
    .top-bar {
      position: absolute;
      top: 130px;
      left: 80px;
      right: 80px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 40;
    }
    .badge-tag {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      padding: 6px 16px;
      background: rgba(231,31,40,0.12);
      color: var(--red);
      border-radius: 8px;
    }
    .edition-tag {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.1em;
      opacity: 0.75;
    }

    .bottom-bar {
      position: absolute;
      bottom: 120px;
      left: 80px;
      right: 80px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 0.08em;
      opacity: 0.85;
      z-index: 40;
    }
    .hd-pill {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .hd-pill b {
      border: 2px solid currentColor;
      border-radius: 6px;
      padding: 2px 10px;
      font-size: 19px;
    }

    /* Hero Centerpiece Elements */
    .hero-box {
      position: absolute;
      top: 40%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 25;
    }

    /* Specimen Art Frame (When real images exist) */
    .hero-art-frame {
      width: 640px;
      background: #ffffff;
      padding: 24px 24px 28px 24px;
      border-radius: 24px;
      box-shadow: 0 40px 90px rgba(0,0,0,0.3), 0 0 0 1px rgba(21,18,17,0.06);
      position: relative;
      color: #151211;
      transform-origin: 50% 50%;
    }
    .dark-frame {
      background: #141212;
      box-shadow: 0 45px 100px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.1);
      color: #ffffff;
    }
    .hero-pin {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      width: 24px;
      height: 24px;
      background: var(--red);
      border-radius: 50%;
      box-shadow: 0 4px 12px rgba(231,31,40,0.5);
      border: 3px solid #ffffff;
      z-index: 10;
    }
    .hero-img-wrap {
      width: 100%;
      height: 480px;
      border-radius: 16px;
      overflow: hidden;
      background: #0d0c0c;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      filter: contrast(1.05) brightness(1.02);
    }
    .hero-frame-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 18px;
      padding: 0 6px;
    }
    .hero-frame-title {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .hero-frame-badge {
      font-size: 18px;
      font-weight: 700;
      color: var(--red);
      letter-spacing: 0.12em;
    }

    /* Fallback Editorial Card */
    .hero-card {
      width: 620px;
      height: 740px;
      border-radius: 28px;
      padding: 36px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
    }
    .light-card {
      background: linear-gradient(135deg, #ffffff 0%, #f4ede4 100%);
      box-shadow: 0 35px 80px rgba(21,18,17,0.22), 0 0 0 2px rgba(21,18,17,0.08);
      border-left: 12px solid var(--red);
      color: var(--ink);
    }
    .dark-card {
      background: linear-gradient(135deg, #181616 0%, #0d0c0c 100%);
      box-shadow: 0 40px 90px rgba(0,0,0,0.7), 0 0 0 2px rgba(255,255,255,0.08);
      border-left: 12px solid var(--red);
      color: #ffffff;
    }
    .hero-tag {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.12em;
      color: var(--red);
    }
    .hero-inner {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      margin: 20px 0;
    }
    .hero-badge-art {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      text-align: center;
    }
    .badge-icon {
      font-size: 100px;
      color: var(--red);
      filter: drop-shadow(0 0 20px rgba(231,31,40,0.5));
    }
    .badge-accent {
      font-size: 42px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .badge-sub {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.15em;
      opacity: 0.65;
    }
    .hero-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 18px;
      font-weight: 700;
      opacity: 0.7;
    }
    .dot-live {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--red);
      box-shadow: 0 0 10px var(--red);
    }

    /* Swiss Editorial Captions */
    .cap {
      position: absolute;
      left: 70px;
      right: 70px;
      bottom: 230px;
      z-index: 35;
      text-align: left;
      line-height: 1.06;
      pointer-events: none;
    }
    .ln {
      display: block;
      margin-bottom: 8px;
      white-space: normal;
    }
    .ln.i1 { padding-left: 50px; }
    .ln.i2 { padding-left: 100px; }

    .w {
      display: inline-block;
      font-weight: 700;
      font-size: 74px;
      margin-right: 0.22em;
      transform-origin: 50% 60%;
      will-change: transform, filter, opacity;
      letter-spacing: -0.02em;
      opacity: 0;
      filter: blur(14px);
    }
    .w.k, .w.slam {
      font-weight: 900;
      font-size: 118px;
      color: var(--red);
      letter-spacing: -0.03em;
      line-height: 1.05;
    }
    .dark .w {
      color: #ffffff;
      text-shadow: 0 0 24px rgba(255,255,255,.2);
    }
    .dark .w.k, .dark .w.slam {
      color: var(--red);
      text-shadow: 0 0 30px rgba(231,31,40,.85), 0 0 80px rgba(231,31,40,.4);
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${totalDuration}" data-width="1080" data-height="1920" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
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
