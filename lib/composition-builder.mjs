import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Builds the complete Kinetic Editorial Reel index.html composition
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

  const scenesHtml = scenes.map((sc, index) => {
    const range = sceneRanges[index];
    const isDark = sc.theme === "dark" || index % 2 === 1;
    const themeClass = isDark ? "dark" : "light";
    const scWords = sceneWordsMap[sc.id] || [];

    // Format words with .w and .w.k (keyword)
    const wordsMarkup = scWords.map((w) => {
      const isKey = w.isKeyword;
      const kClass = isKey ? "k slam" : "";
      return `<span class="w ${kClass}" data-t="${w.time}" id="${w.id}">${w.word}</span>`;
    }).join(" ");

    // Check if an image actually exists on disk in projectDir/assets/img/
    const heroImgName = `${sc.hero_name || `hero_${sc.id}`}.png`;
    const heroImgOnDisk = projectDir ? existsSync(join(projectDir, "assets/img", heroImgName)) : false;

    const heroContent = heroImgOnDisk
      ? `<img src="assets/img/${heroImgName}" alt="${sc.hero_title || 'Hero'}" class="hero-image" />`
      : `
        <div class="hero-badge-art">
          <div class="badge-icon">✦</div>
          <div class="badge-accent">${sc.hero_title || sc.keyword || 'EDITORIAL'}</div>
          <div class="badge-sub">${sc.badge || 'PRO / EDITION'}</div>
        </div>
      `;

    const heroMarkup = `
      <div class="hero-box" id="hero_${sc.id}" data-layout-allow-overlap="true">
        <div class="hero-card ${themeClass}-card">
          <div class="hero-tag">${sc.badge || `0${sc.id} / SCENE`}</div>
          <div class="hero-inner">
            ${heroContent}
          </div>
          <div class="hero-footer">
            <span>KINETIC EDITORIAL</span>
            <span class="dot-live"></span>
          </div>
        </div>
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

          <!-- Centered Hero -->
          ${heroMarkup}

          <!-- Captions Overlay -->
          <div class="cap" id="cap_${sc.id}" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
            <div class="ln">
              ${wordsMarkup}
            </div>
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

      // Camera push-in for scene
      const cam = document.getElementById('cam_' + cfg.id);
      if (cam) {
        tl.fromTo(cam, 
          { scale: 1.08, rotation: (idx % 2 === 0 ? -0.8 : 0.8) },
          { scale: 1.0, rotation: 0, duration: cfg.endTime - cfg.startTime, ease: "none" },
          cfg.startTime
        );
      }

      // Hero entry
      const hero = document.getElementById('hero_' + cfg.id);
      if (hero) {
        tl.fromTo(hero,
          { y: 70, opacity: 0, scale: 0.9 },
          { y: 0, opacity: 1, scale: 1, duration: 0.65, ease: "back.out(1.4)" },
          cfg.startTime + 0.05
        );
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
          { filter: "blur(14px)", opacity: 0, scale: 1.45, y: 15 },
          { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.22, ease: "power4.out" },
          w.time
        );
        // Subtle screen shake on keyword
        const shakeEl = document.getElementById('shake_' + w.sceneId);
        if (shakeEl) {
          tl.to(shakeEl, { x: 8, y: -6, duration: 0.04, yoyo: true, repeat: 2 }, w.time);
        }
      } else {
        // Standard kinetic text blur reveal
        tl.fromTo(el,
          { filter: "blur(8px)", opacity: 0, scale: 0.95, y: 10 },
          { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.16, ease: "power2.out" },
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

    /* Hero Elements */
    .hero-box {
      position: absolute;
      top: 42%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 25;
    }
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
    .hero-image {
      max-width: 90%;
      max-height: 480px;
      object-fit: contain;
      filter: drop-shadow(0 20px 30px rgba(0,0,0,0.35));
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

    /* Captions */
    .cap {
      position: absolute;
      left: 80px;
      right: 80px;
      bottom: 220px;
      z-index: 35;
      text-align: left;
      line-height: 1.15;
      pointer-events: none;
    }
    .ln {
      display: block;
      word-wrap: break-word;
    }
    .w {
      display: inline-block;
      font-weight: 700;
      font-size: 78px;
      margin-right: 0.22em;
      margin-bottom: 0.1em;
      transform-origin: 50% 60%;
      will-change: transform, filter, opacity;
      letter-spacing: -0.02em;
      opacity: 0;
      filter: blur(8px);
    }
    .w.k {
      font-weight: 900;
      font-size: 124px;
      color: var(--red);
      letter-spacing: -0.03em;
      line-height: 1.05;
    }
    .dark .w {
      color: #ffffff;
      text-shadow: 0 0 20px rgba(255,255,255,.18);
    }
    .dark .w.k {
      color: var(--red);
      text-shadow: 0 0 28px rgba(231,31,40,.85), 0 0 70px rgba(231,31,40,.4);
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-width="1080" data-height="1920" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
    <!-- Main Audio Track -->
    <audio id="voiceAudio" src="${voiceAudioRel}" data-start="0" preload="auto"></audio>

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
