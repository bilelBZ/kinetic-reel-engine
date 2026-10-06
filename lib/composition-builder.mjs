import { writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getStyle, generateStyleCss } from "./styles/index.mjs";
import { fromRoot } from "./env.mjs";
import { GSAP_VERSION } from "./renderer.mjs";

/**
 * Assembles the HyperFrames composition: scenes, captions, hero motion, SFX and
 * the GSAP timeline that drives all of it.
 *
 * Rules that keep the output looking expensive:
 *  - No network at render time. GSAP and fonts are vendored into the project.
 *  - Captions auto-fit: the font size is solved per scene from the actual text,
 *    so nothing overflows and nothing looks tiny.
 *  - Motion is layered (transition + camera + hero + type + ribbon + progress).
 *  - The timeline is seek-safe: every state change is a tween/set, never a
 *    callback, because HyperFrames renders by seeking to each frame (GSAP does
 *    not fire callbacks on seek) — callbacks would desync scene visibility.
 *  - Audio is mixed: voice on its own track, music bed underneath, sparse taps
 *    and keyword impacts with fade edges so cues never click.
 */

export const ASPECTS = {
  "9:16": { width: 1080, height: 1920, label: "vertical reel" },
  "4:5": { width: 1080, height: 1350, label: "portrait feed" },
  "1:1": { width: 1080, height: 1080, label: "square" },
  "16:9": { width: 1920, height: 1080, label: "landscape" },
};

export function resolveAspect(name) {
  return ASPECTS[String(name || "9:16").trim()] || ASPECTS["9:16"];
}

const TRANSITIONS = {
  "hard-cut": { out: 0.1, in: 0.1, type: "cut" },
  crossfade: { out: 0.5, in: 0.5, type: "fade" },
  whip: { out: 0.26, in: 0.3, type: "whip" },
  "soft-wipe": { out: 0.4, in: 0.5, type: "wipe" },
};

/** Copy the vendored runtime (GSAP + fonts) into a project and return the paths. */
export function installRuntime(projectDir, { log = console.log } = {}) {
  const vendorDir = join(projectDir, "assets/vendor");
  const fontDir = join(projectDir, "assets/fonts");
  mkdirSync(vendorDir, { recursive: true });
  mkdirSync(fontDir, { recursive: true });

  const gsapSource = fromRoot("templates/assets/vendor/gsap.min.js");
  if (!existsSync(gsapSource)) {
    throw new Error(
      "Missing vendored runtime: templates/assets/vendor/gsap.min.js — run `npm run vendor` to restore GSAP.",
    );
  }
  const gsapTarget = join(vendorDir, "gsap.min.js");
  if (!existsSync(gsapTarget)) copyFileSync(gsapSource, gsapTarget);

  const fontSourceDir = fromRoot("templates/assets/fonts");
  const fonts = [];
  if (existsSync(fontSourceDir)) {
    for (const file of readdirSync(fontSourceDir)) {
      if (!/\.(woff2?|ttf|otf)$/i.test(file)) continue;
      const target = join(fontDir, file);
      if (!existsSync(target)) copyFileSync(join(fontSourceDir, file), target);
      fonts.push(file);
    }
  }
  log(`[Runtime] vendored GSAP ${GSAP_VERSION} + ${fonts.length} font file(s) → offline render`);
  return { gsap: "assets/vendor/gsap.min.js", fonts };
}

/** Escape text for safe inclusion in HTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Style presets store lengths as CSS strings ("88px"); maths needs numbers. */
export function num(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function visibleLength(line) {
  return String(line)
    .split(/\s+/)
    .filter(Boolean)
    .reduce((acc, word, i) => acc + word.length + (i > 0 ? 1 : 0), 0);
}

/**
 * Solve caption typography for one scene: long lines shrink, punch lines grow,
 * so every scene fills the frame without overflowing it.
 */
export function fitCaption({ lines, width, baseFontSize, sidePadding, maxLines = 3 }) {
  const usable = width - num(sidePadding) * 2;
  const longest = Math.max(1, ...lines.map(visibleLength));
  const totalChars = lines.join(" ").length;
  // At font-size F an average glyph is ~0.5F wide; solve for the size that fits
  // the longest line and the whole block inside `maxLines`.
  const byLine = (usable / (0.5 * longest)) * 0.92;
  const byBlock = (usable / (0.5 * Math.max(1, totalChars / maxLines))) * 0.92;
  const solved = Math.min(byLine, byBlock, baseFontSize * 1.16);
  return { fontSize: Math.round(Math.max(baseFontSize * 0.55, solved)), longest };
}

/** Split a scene's words into 2-3 staggered caption lines around the keyword. */
export function groupLines(words, { maxLines = 3 } = {}) {
  if (!words.length) return [];
  const keyIndex = words.findIndex((w) => w.isKeyword);

  if (words.length <= 4) {
    const splitAt = keyIndex > 0 ? keyIndex : Math.ceil(words.length / 2);
    return [words.slice(0, splitAt), words.slice(splitAt)].filter((g) => g.length);
  }

  if (keyIndex > 0 && keyIndex < words.length - 1) {
    const beforeCount = keyIndex;
    const head = Math.max(1, Math.min(beforeCount, Math.ceil(beforeCount / 2)));
    return [words.slice(0, head), words.slice(head, keyIndex), words.slice(keyIndex)].filter((g) => g.length);
  }

  const third = Math.ceil(words.length / maxLines);
  return [words.slice(0, third), words.slice(third, third * 2), words.slice(third * 2)].filter((g) => g.length);
}

/** Sparse, musical SFX plan: impacts on keywords, whooshes on cuts, light taps. */
export function planAudioCues({ style, words, sceneRanges, taps = true, tapEvery = 3, tapVolume = 0.09 }) {
  const cues = [];
  const push = (cue) => cues.push(cue);

  push({ id: "sfx_intro", src: style.sfx.intro, start: 0, duration: 1.6, volume: 0.3, fadeOut: 0.7, kind: "intro" });

  for (const range of sceneRanges) {
    if (range.index === 0) continue;
    push({
      id: `sfx_cut_${range.id}`,
      kind: "transition",
      src: style.sfx.transition,
      start: Math.max(0, Number((range.startTime - 0.14).toFixed(3))),
      duration: 0.57,
      volume: 0.2,
      fadeIn: 0.05,
      fadeOut: 0.22,
    });
  }

  let impacts = 0;
  let lastImpact = -10;
  for (const word of words) {
    if (!word.isKeyword) continue;
    push({
      id: `sfx_hit_${word.id}`,
      kind: "impact",
      src: impacts % 2 === 1 ? style.sfx.impactBass2 : style.sfx.impactBass1,
      start: Math.max(0, Number((word.time - 0.01).toFixed(3))),
      duration: 1.4,
      volume: 0.7,
      fadeOut: 0.75,
    });
    impacts++;
    lastImpact = word.time;
  }

  if (taps) {
    let sinceTap = 0;
    for (const word of words) {
      if (word.isKeyword) {
        sinceTap = 0;
        continue;
      }
      sinceTap++;
      if (sinceTap < tapEvery || word.time - lastImpact < 0.45) continue;
      sinceTap = 0;
      push({
        id: `sfx_tap_${word.id}`,
        kind: "tap",
        src: style.sfx.click || "assets/audio/sfx/click.mp3",
        start: Math.max(0, Number((word.time - 0.015).toFixed(3))),
        duration: 0.11,
        volume: tapVolume,
        fadeOut: 0.05,
      });
    }
  }

  // Greedy lane packing: cues never collide, and lanes start above the voice.
  cues.sort((a, b) => a.start - b.start);
  const laneFreeAt = new Map();
  return cues.map((cue) => {
    let lane = 11;
    while ((laneFreeAt.get(lane) || 0) > cue.start + 0.001) lane++;
    laneFreeAt.set(lane, cue.start + cue.duration);
    return { ...cue, lane };
  });
}

/** Emit the <audio> elements for voice, music and SFX. */
export function renderAudioElements({
  cues,
  voiceRel,
  musicRel,
  totalDuration,
  voiceVolume = 1,
  musicVolume = 0.16,
}) {
  const lines = [
    `<audio id="voiceover" class="clip" src="${escapeHtml(voiceRel)}" data-start="0" data-duration="${totalDuration}" data-track-index="10" data-volume="${voiceVolume}" preload="auto"></audio>`,
  ];
  if (musicRel) {
    lines.push(
      `<audio id="music" class="clip" src="${escapeHtml(musicRel)}" data-start="0" data-duration="${totalDuration}" data-track-index="9" ` +
        `data-volume="${musicVolume}" data-fade-in="1.2" data-fade-out="1.8" preload="auto"></audio>`,
    );
  }
  for (const cue of cues) {
    const fades =
      (cue.fadeIn ? ` data-fade-in="${cue.fadeIn}"` : "") + (cue.fadeOut ? ` data-fade-out="${cue.fadeOut}"` : "");
    lines.push(
      `<audio id="${cue.id}" class="clip" src="${escapeHtml(cue.src)}" data-start="${cue.start}" data-duration="${cue.duration}" ` +
        `data-track-index="${cue.lane}" data-volume="${cue.volume}"${fades} preload="auto"></audio>`,
    );
  }
  return lines;
}

/** Build the full composition HTML + timeline. */
export function buildCompositionHtml({
  projectDir,
  title,
  scenes,
  words,
  sceneRanges,
  totalDuration,
  voiceAudioRel = "assets/audio/voice.wav",
  musicAudioRel = null,
  styleName = "fares-editorial",
  speed = "standard",
  aspect = "9:16",
  brand = null,
  taps = true,
  outputPath,
  log = console.log,
}) {
  const style = getStyle(styleName);
  const canvas = resolveAspect(aspect);
  const isArabic = /[\u0600-\u06FF]/.test(words.map((w) => w.word).join(" "));
  const textDir = isArabic ? "rtl" : "ltr";
  const scale = Math.min(1.05, Math.max(0.6, canvas.height / 1920));

  const sceneWords = new Map(scenes.map((scene) => [scene.id, words.filter((w) => w.sceneId === scene.id)]));
  const rangeById = new Map(sceneRanges.map((r) => [r.id, r]));
  const baseFontSize = Math.round(num(style.layout.wordFontSize, 88) * scale);
  const sidePadding = num(style.layout.captionSidePadding, 60);

  const captionPlan = new Map();
  for (const scene of scenes) {
    const list = sceneWords.get(scene.id) || [];
    const lines = groupLines(list);
    const fit = fitCaption({
      lines: lines.map((l) => l.map((w) => w.word).join(" ")),
      width: canvas.width,
      baseFontSize,
      sidePadding,
    });
    captionPlan.set(scene.id, { lines, fontSize: fit.fontSize });
  }

  const cues = planAudioCues({ style, words, sceneRanges, taps });

  const sceneHtml = scenes
    .map((scene, index) => {
      const range = rangeById.get(scene.id) || { startTime: 0, endTime: totalDuration };
      const plan = captionPlan.get(scene.id);
      const themeClass = scene.theme === "light" ? "light" : "dark";

      const linesHtml = plan.lines
        .map((line, lineIndex) => {
          const indent = lineIndex === 0 ? "" : lineIndex === 1 ? "i1" : "i2";
          const content = line
            .map(
              (word) =>
                `<span class="w${word.isKeyword ? " k" : ""}" id="${word.id}" data-t="${word.time}">${escapeHtml(word.word)}</span>`,
            )
            .join(" ");
          return `<div class="ln ${indent}">${content}</div>`;
        })
        .join("\n            ");

      const heroFile = `assets/img/${scene.hero_name || `hero_${scene.id}`}.png`;
      const hasHero = existsSync(join(projectDir, heroFile));
      const heroInner = hasHero
        ? `<div class="hero-glow"></div><img class="hero-visual" src="${heroFile}" alt="${escapeHtml(scene.hero_title || "")}" />`
        : `<div class="hero-glow hero-glow-empty"></div>`;

      return `
      <section class="scene clip ${themeClass}" id="scene_${scene.id}" data-start="${range.startTime}" data-duration="${Number((range.endTime - range.startTime).toFixed(3))}" data-track-index="1" style="z-index:${index + 2}">
        <div class="camera" id="cam_${scene.id}">
          <div class="grid"></div>
          <div class="vignette"></div>
          <svg class="ribbon" viewBox="0 0 ${canvas.width} ${canvas.height}" aria-hidden="true">
            <path id="rib_${scene.id}" pathLength="1" d="M ${canvas.width * 1.22} ${-canvas.height * 0.06} C ${canvas.width * 0.7} ${canvas.height * 0.14}, ${canvas.width * 0.15} ${canvas.height * 0.33}, ${canvas.width * 0.44} ${canvas.height * 0.56} S ${canvas.width * 0.9} ${canvas.height * 0.87}, ${canvas.width * 0.52} ${canvas.height * 1.09}"/>
          </svg>
          <div class="badge" id="badge_${scene.id}">${escapeHtml(scene.badge || "")}</div>
          <div class="hero-box" id="hero_${scene.id}">${heroInner}</div>
          <div class="cap ${textDir}" id="cap_${scene.id}" style="--cap-size:${plan.fontSize}px">
            ${linesHtml}
          </div>
          ${brand ? `<div class="brand">${escapeHtml(brand)}</div>` : ""}
        </div>
      </section>`;
    })
    .join("\n");

  const audioElements = renderAudioElements({
    cues,
    voiceRel: voiceAudioRel,
    musicRel: musicAudioRel,
    totalDuration,
  });

  const timelineConfig = {
    canvas,
    scenes: sceneRanges.map((r) => ({ id: r.id, index: r.index, startTime: r.startTime, endTime: r.endTime })),
    words: words.map((w) => ({ id: w.id, sceneId: w.sceneId, time: w.time, isKeyword: !!w.isKeyword })),
    motions: Object.fromEntries(scenes.map((s) => [s.id, s.motion || "zoom-in"])),
    transitions: Object.fromEntries(scenes.map((s) => [s.id, s.transition || "soft-wipe"])),
    animation: style.animation,
    speed,
    totalDuration,
  };

  const html = `<!DOCTYPE html>
<html lang="${isArabic ? "ar" : "en"}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${canvas.width}, height=${canvas.height}" />
  <title>${escapeHtml(title)} | ${escapeHtml(style.name)}</title>
  <script src="assets/vendor/gsap.min.js"></script>
  <style>
${generateStyleCss(style, { canvas })}
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${totalDuration}"
       data-width="${canvas.width}" data-height="${canvas.height}"
       data-layout-allow-overlap="true" data-layout-allow-occlusion="true" data-layout-allow-overflow="true">
${audioElements.map((line) => `    ${line}`).join("\n")}

    <div class="progress-track"><div class="progress-bar" id="progress"></div></div>
${sceneHtml}
  </div>

  <script>
(() => {
  if (typeof gsap === "undefined") {
    // Captions start at opacity 0, so a missing runtime would otherwise render a
    // video with no text at all and still exit 0. Fail loudly instead.
    window.__timelineError = "GSAP failed to load from assets/vendor/gsap.min.js";
    document.documentElement.setAttribute("data-timeline-error", window.__timelineError);
    return;
  }

  const CFG = ${JSON.stringify(timelineConfig)};
  const TRANSITIONS = ${JSON.stringify(TRANSITIONS)};
  const isRapid = CFG.speed === "rapid";
  const isCalm = CFG.speed === "calm";
  const wordDur = isRapid ? 0.14 : isCalm ? 0.26 : 0.18;
  const keyDur = isRapid ? 0.2 : isCalm ? 0.34 : 0.24;
  const anim = CFG.animation;

  const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
  const sceneEl = (id) => document.getElementById("scene_" + id);
  const lastId = CFG.scenes[CFG.scenes.length - 1].id;

  // Initial state: every scene hidden except the first, so frame 0 is correct.
  CFG.scenes.forEach((cfg) => {
    gsap.set(sceneEl(cfg.id), { autoAlpha: cfg.index === 0 ? 1 : 0 });
  });

  CFG.scenes.forEach((cfg) => {
    const el = sceneEl(cfg.id);
    const cam = document.getElementById("cam_" + cfg.id);
    const hero = document.getElementById("hero_" + cfg.id);
    const badge = document.getElementById("badge_" + cfg.id);
    const ribbon = document.getElementById("rib_" + cfg.id);
    if (!el) return;

    const transition = TRANSITIONS[CFG.transitions[cfg.id]] || TRANSITIONS["soft-wipe"];
    const len = Math.max(0.4, cfg.endTime - cfg.startTime);
    const kind = CFG.motions[cfg.id] || "zoom-in";

    // --- entrance -------------------------------------------------------
    if (transition.type === "whip") {
      tl.fromTo(el, { autoAlpha: 0, x: 130, filter: "blur(22px)" },
        { autoAlpha: 1, x: 0, filter: "blur(0px)", duration: transition.in, ease: "power3.out" }, cfg.startTime);
    } else if (transition.type === "wipe") {
      tl.set(el, { autoAlpha: 1, clipPath: "inset(0% 100% 0% 0%)" }, cfg.startTime);
      tl.fromTo(el, { clipPath: "inset(0% 100% 0% 0%)" },
        { clipPath: "inset(0% 0% 0% 0%)", duration: transition.in, ease: "power2.inOut" }, cfg.startTime);
      tl.set(el, { clipPath: "none" }, cfg.startTime + transition.in);
    } else if (transition.type === "cut") {
      tl.set(el, { autoAlpha: 1, clipPath: "none" }, cfg.startTime);
    } else {
      tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: transition.in, ease: "power1.out" }, cfg.startTime);
    }

    // --- exit -----------------------------------------------------------
    if (cfg.id !== lastId) {
      tl.to(el, { autoAlpha: 0, duration: transition.out, ease: "power1.inOut" }, Math.max(cfg.startTime + 0.1, cfg.endTime - transition.out * 0.6));
    } else {
      tl.to(el, { autoAlpha: 0, duration: 0.3 }, Math.max(cfg.startTime + 0.2, cfg.endTime - 0.3));
    }
    tl.set(el, { x: 0, filter: "blur(0px)" }, cfg.endTime + 0.01);

    // --- camera ---------------------------------------------------------
    if (cam) {
      const from = { scale: anim.camera.startScale, rotation: cfg.index % 2 === 0 ? -anim.camera.rotationFactor : anim.camera.rotationFactor, x: 0, y: 0 };
      const to = { scale: anim.camera.endScale, rotation: 0, duration: len, ease: "none" };
      if (kind === "zoom-out") from.scale = anim.camera.startScale + 0.08;
      else if (kind === "slide-left") from.x = 48;
      else if (kind === "slide-right") from.x = -48;
      else if (kind === "parallax") {
        from.y = -20;
        to.y = 20;
      }
      tl.fromTo(cam, from, to, cfg.startTime);
    }

    // --- ribbon ---------------------------------------------------------
    if (ribbon) {
      tl.fromTo(ribbon, { strokeDasharray: 1, strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: Math.max(0.8, len * 0.9), ease: "power1.inOut" }, cfg.startTime);
    }

    // --- eyebrow badge --------------------------------------------------
    if (badge) {
      tl.fromTo(badge, { autoAlpha: 0, y: -16, filter: "blur(8px)" },
        { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.45 }, cfg.startTime + 0.12);
      tl.to(badge, { autoAlpha: 0, duration: 0.3 }, Math.max(cfg.startTime + 0.6, cfg.endTime - 0.4));
    }

    // --- hero -----------------------------------------------------------
    if (hero) {
      const from = Object.assign({}, anim.hero.entrance.from);
      if (kind === "slide-left") { from.x = 140; from.y = 34; }
      if (kind === "slide-right") { from.x = -140; from.y = 34; }
      tl.fromTo(hero, from, Object.assign({}, anim.hero.entrance.to), cfg.startTime + 0.08);
      const floatLen = Math.max(0.7, (len - 0.9) / 2);
      tl.to(hero, {
        y: anim.hero.floating.y,
        rotation: cfg.index % 2 === 0 ? anim.hero.floating.rotation : -anim.hero.floating.rotation,
        duration: floatLen,
        yoyo: true,
        repeat: 1,
        ease: anim.hero.floating.ease,
      }, cfg.startTime + 0.8);
      tl.to(hero, { autoAlpha: 0, duration: 0.35 }, Math.max(cfg.startTime + 0.7, cfg.endTime - 0.35));
    }
  });

  // --- word-level typography (absolute times, no callbacks) ---------------
  CFG.words.forEach((word) => {
    const el = document.getElementById(word.id);
    if (!el) return;
    if (word.isKeyword) {
      tl.fromTo(el, anim.keyword.from, Object.assign({}, anim.keyword.to, { duration: keyDur }), Math.max(0, word.time - 0.04));
      const shake = document.getElementById("cam_" + word.sceneId);
      if (shake) tl.to(shake, anim.shake, word.time);
    } else {
      tl.fromTo(el, anim.word.from, Object.assign({}, anim.word.to, { duration: wordDur }), Math.max(0, word.time - 0.03));
    }
  });

  // --- progress ----------------------------------------------------------
  const progress = document.getElementById("progress");
  if (progress) tl.fromTo(progress, { scaleX: 0 }, { scaleX: 1, duration: CFG.totalDuration, ease: "none" }, 0);

  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;
  tl.seek(0);
})();
  </script>
</body>
</html>
`;

  writeFileSync(outputPath, html, "utf8");
  log(
    `[Composition] ${scenes.length} scenes · ${words.length} words · ${cues.length} cues · ${canvas.width}×${canvas.height} → ${outputPath}`,
  );
  return outputPath;
}
