import { writeFileSync } from "node:fs";
import { getStyle, generateStyleCss } from "./styles/index.mjs";

/**
 * Builds the HyperFrames / GSAP composition for NEWS mode:
 * real YouTube footage (9:16) + karaoke captions (Anton, active word yellow)
 * + teaser flash transition + highlight hook bar + animated number badge
 * + end-screen CTA + cinematic SFX.
 *
 * This reproduces the final quality bar from the v1→v7 iterations:
 * teaser 0–3s, flash cut, karaoke captions, badge on the number, CTA outro.
 */
export function buildNewsCompositionHtml({
  projectDir,
  outputPath,
  title = "News Reel",
  clipVideoRel = "assets/clip-vertical.mp4",
  clipAudioRel = "assets/audio/clip-audio.mp3",
  words = [],
  totalDuration,
  teaserEnd = null, // seconds — white flash transition point (teaser → main)
  hook = null,      // { text, showAt, hideAt }
  badge = null,     // { text, at, visibleSeconds }
  cta = null,       // { text, showAt }
  styleName = "news-viral",
}) {
  const style = getStyle(styleName);
  const p = style.palette;
  const l = style.layout;
  const anim = style.animation;

  const isArabic = /[\u0600-\u06FF]/.test(words.map((w) => w.word).join(" "));
  const textDir = isArabic ? "rtl" : "ltr";

  // ---- Caption blocks: max 10 words, prefer breaking at sentence punctuation
  const blocks = [];
  let current = [];
  for (const w of words) {
    current.push(w);
    const endsSentence = /[.!?…:؛؟]$/.test(w.word);
    if (current.length >= 10 || (endsSentence && current.length >= 4)) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);

  const blocksHtml = blocks
    .map((blk, bi) => {
      const start = Math.max(0, blk[0].time - 0.15);
      const end = blk[blk.length - 1].end + 0.45;
      const wordsHtml = blk
        .map((w) => `<span class="w" data-t="${w.time}" id="${w.id}">${escapeHtml(w.word)}</span>`)
        .join(" ");
      return `<div class="cap-block ${textDir}" id="capblock_${bi}" data-start="${start.toFixed(2)}" data-end="${end.toFixed(2)}" style="display:none;opacity:0;">${wordsHtml}</div>`;
    })
    .join("\n      ");

  // ---- SFX cues
  const sfxCues = [
    { id: "sfx_intro", src: style.sfx.intro, start: 0, duration: 1.6, volume: 0.32 },
  ];
  if (teaserEnd) {
    sfxCues.push({ id: "sfx_cut", src: style.sfx.transition, start: teaserEnd, duration: 0.6, volume: 0.3 });
  }
  if (badge) {
    sfxCues.push({ id: "sfx_badge", src: style.sfx.badgePop || style.sfx.click, start: badge.at, duration: 0.4, volume: 0.5 });
    sfxCues.push({ id: "sfx_boom", src: style.sfx.impactBass1, start: badge.at, duration: 1.2, volume: 0.55 });
  }
  if (cta) {
    sfxCues.push({ id: "sfx_cta", src: style.sfx.ctaChime || style.sfx.click, start: cta.showAt, duration: 1.0, volume: 0.4 });
  }
  // Subtle pop on every keyword hit
  words.forEach((w, i) => {
    if (w.isKeyword && (!badge || Math.abs(w.time - badge.at) > 0.5)) {
      sfxCues.push({ id: `sfx_kw_${i}`, src: style.sfx.click, start: Math.max(0, w.time - 0.02), duration: 0.15, volume: 0.22 });
    }
  });
  sfxCues.sort((a, b) => a.start - b.start);
  const trackOccupancy = {};
  const sfxElements = sfxCues.map((cue) => {
    let tr = 11;
    while ((trackOccupancy[tr] || 0) > cue.start) tr++;
    trackOccupancy[tr] = cue.start + cue.duration;
    return `<audio id="${cue.id}" src="${cue.src}" data-start="${cue.start}" data-duration="${cue.duration}" data-track-index="${tr}" data-volume="${cue.volume}" preload="auto"></audio>`;
  });

  // ---- GSAP timeline
  const gsapCode = `
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    const wordsData = ${JSON.stringify(words.map((w) => ({ id: w.id, time: w.time, block: blockIndexOf(w) })))};
    const blocksData = ${JSON.stringify(blocks.map((blk, bi) => ({ id: bi, start: Math.max(0, blk[0].time - 0.15), end: blk[blk.length - 1].end + 0.45 })))};

    // Caption blocks show/hide
    blocksData.forEach(b => {
      const el = document.getElementById('capblock_' + b.id);
      if (!el) return;
      tl.call(() => { el.style.display = 'block'; gsap.to(el, { opacity: 1, duration: 0.15 }); }, null, b.start);
      tl.call(() => { gsap.to(el, { opacity: 0, duration: 0.2, onComplete: () => { el.style.display = 'none'; } }); }, null, b.end);
    });

    // Karaoke: word entrance pop + active-word highlight in real time
    const wordAnim = ${JSON.stringify(anim.word)};
    const activeAnim = ${JSON.stringify(anim.activeWord)};
    wordsData.forEach((w, i) => {
      const el = document.getElementById(w.id);
      if (!el) return;
      tl.fromTo(el, wordAnim.from, { ...wordAnim.to }, Math.max(0, w.time - 0.03));
      tl.call(() => {
        const block = document.getElementById('capblock_' + w.block);
        if (block) block.querySelectorAll('.w').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        gsap.fromTo(el, { scale: 1 }, { scale: activeAnim.scale, duration: activeAnim.duration, ease: activeAnim.ease, yoyo: true, repeat: 1 });
      }, null, w.time);
    });

    ${hook ? `
    // Hook highlight bar
    const hookEl = document.getElementById('hook');
    if (hookEl) {
      tl.fromTo(hookEl, ${JSON.stringify(anim.hook.from)}, { ...${JSON.stringify(anim.hook.to)} }, ${hook.showAt ?? 0.15});
      tl.to(hookEl, { opacity: 0, y: -30, duration: 0.3 }, ${hook.hideAt ?? 3.4});
    }` : ""}

    ${teaserEnd ? `
    // Teaser flash transition
    const flash = document.getElementById('flash');
    if (flash) {
      tl.fromTo(flash, { opacity: 0 }, { opacity: 1, duration: 0.07 }, ${teaserEnd});
      tl.to(flash, { opacity: 0, duration: ${anim.teaserFlash.duration} }, ${teaserEnd} + 0.07);
    }` : ""}

    ${badge ? `
    // Animated number badge — pops exactly when the number is spoken
    const badgeEl = document.getElementById('badge');
    if (badgeEl) {
      tl.fromTo(badgeEl, ${JSON.stringify(anim.badge.from)}, { ...${JSON.stringify(anim.badge.to)} }, ${badge.at});
      tl.to(badgeEl, { ...${JSON.stringify(anim.badge.out)} }, ${(badge.at + (badge.visibleSeconds ?? anim.badge.visibleSeconds)).toFixed(2)});
    }` : ""}

    ${cta ? `
    // End-screen CTA: fade to black + highlight question
    const ctaBg = document.getElementById('cta-bg');
    const ctaEl = document.getElementById('cta');
    if (ctaBg && ctaEl) {
      tl.to(ctaBg, { opacity: 0.92, duration: 0.6 }, ${cta.showAt});
      tl.fromTo(ctaEl, ${JSON.stringify(anim.cta.from)}, { ...${JSON.stringify(anim.cta.to)} }, ${cta.showAt} + 0.15);
    }` : ""}

    window.__timelines["main"] = tl;
    tl.seek(0);
  `;

  function blockIndexOf(w) {
    for (let bi = 0; bi < blocks.length; bi++) {
      if (blocks[bi].some((x) => x.id === w.id)) return bi;
    }
    return 0;
  }

  const newsCss = `
    /* ---- News-mode layers ---- */
    #bgvideo {
      position: absolute; inset: 0;
      width: 1080px; height: 1920px;
      object-fit: cover; z-index: 1;
    }
    .footage-grade {
      position: absolute; inset: 0; z-index: 2; pointer-events: none;
      background: linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 22%, transparent 55%, rgba(0,0,0,0.72) 100%);
    }
    .cap-block {
      position: absolute;
      left: ${l.captionSidePadding}; right: ${l.captionSidePadding};
      top: ${l.captionTop}; bottom: ${l.captionBottom};
      display: flex; flex-wrap: wrap; align-content: center;
      z-index: 30; line-height: 1.18; pointer-events: none;
    }
    .cap-block.ltr { direction: ltr; text-align: left; }
    .cap-block.rtl { direction: rtl; text-align: right; }
    .cap-block .w {
      display: inline-block;
      font-family: ${isArabic ? "'Cairo', sans-serif" : "'Anton', sans-serif"};
      font-weight: ${isArabic ? 900 : 400};
      font-size: ${isArabic ? l.wordFontSizeRtl : l.wordFontSize};
      color: ${p.captionColor};
      text-shadow: ${p.captionShadow};
      margin-right: ${isArabic ? 0 : "0.24em"};
      margin-left: ${isArabic ? "0.28em" : 0};
      letter-spacing: ${isArabic ? 0 : "0.01em"};
      opacity: 0;
      filter: none; /* resting state must be sharp — GSAP animates blur only during entrance */
      transform-origin: 50% 60%;
      will-change: transform, opacity;
      text-transform: ${isArabic ? "none" : "uppercase"};
    }
    .cap-block .w.active {
      color: ${p.activeWordColor};
      text-shadow: ${p.activeWordGlow};
    }
    #hook {
      position: absolute; top: ${l.hookTop}; left: 50%;
      transform: translateX(-50%);
      z-index: 40; pointer-events: none;
      background: ${p.hookBg}; color: ${p.hookColor};
      font-family: 'Anton', 'Cairo', sans-serif;
      font-size: ${l.hookFontSize};
      padding: ${l.hookPadding};
      white-space: nowrap;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    #badge {
      position: absolute; top: 34%; left: 50%;
      transform: translateX(-50%);
      z-index: 41; pointer-events: none; opacity: 0;
      background: ${p.badgeBg}; color: ${p.badgeColor};
      font-family: 'Anton', 'Cairo', sans-serif;
      font-size: ${l.badgeFontSize};
      padding: ${l.badgePadding};
      white-space: nowrap;
      box-shadow: 0 14px 50px rgba(0,0,0,0.55);
    }
    #flash {
      position: absolute; inset: 0; z-index: 50;
      background: #fff; opacity: 0; pointer-events: none;
    }
    #cta-bg {
      position: absolute; inset: 0; z-index: 60;
      background: #000; opacity: 0; pointer-events: none;
    }
    #cta {
      position: absolute; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      z-index: 61; pointer-events: none; opacity: 0;
      background: ${p.ctaBg}; color: ${p.ctaColor};
      font-family: 'Anton', 'Cairo', sans-serif;
      font-size: 84px; padding: 22px 40px;
      text-align: center; line-height: 1.15;
      box-shadow: 0 14px 60px rgba(0,0,0,0.6);
    }
  `;

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1080, height=1920">
  <title>${escapeHtml(title)} | ${style.name}</title>
  <!-- Local vendored assets: renders must not depend on network at render time -->
  <link href="assets/fonts/news-viral-fonts.css" rel="stylesheet">
  <script src="assets/vendor/gsap.min.js"></script>
  <style>
    ${generateStyleCss(style)}
    ${newsCss}
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${totalDuration}" data-width="1080" data-height="1920" data-layout-allow-overlap="true" data-layout-allow-occlusion="true" data-layout-allow-overflow="true">
    <!-- Real footage background (muted — audio carried on track 10) -->
    <video id="bgvideo" src="${clipVideoRel}" muted playsinline preload="auto" data-layout-allow-overflow="true"></video>
    <div class="footage-grade" data-layout-allow-overlap="true"></div>

    <!-- Original audio of the extract -->
    <audio id="clipAudio" src="${clipAudioRel}" data-start="0" data-duration="${totalDuration}" data-track-index="10" data-volume="1.0" preload="auto"></audio>

    <!-- Cinematic SFX (tracks 11+) -->
    ${sfxElements.join("\n    ")}

    ${hook ? `<div id="hook" data-layout-allow-overlap="true" style="opacity:0;">${escapeHtml(hook.text)}</div>` : ""}
    ${badge ? `<div id="badge" data-layout-allow-overlap="true">${escapeHtml(badge.text)}</div>` : ""}

    <!-- Karaoke caption blocks -->
    <div id="captions" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
      ${blocksHtml}
    </div>

    <div id="flash"></div>
    ${cta ? `<div id="cta-bg"></div><div id="cta">${escapeHtml(cta.text)}</div>` : ""}
  </div>

  <script>
    document.addEventListener("DOMContentLoaded", () => {
      const v = document.getElementById('bgvideo');
      if (v) { v.currentTime = 0; const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
      ${gsapCode}
    });
  </script>
</body>
</html>
`;

  writeFileSync(outputPath, fullHtml, "utf8");
  return outputPath;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
