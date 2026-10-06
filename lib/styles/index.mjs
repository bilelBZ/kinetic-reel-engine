import { existsSync } from "node:fs";
import { join } from "node:path";
import { fromRoot } from "../env.mjs";
import { faresEditorialStyle } from "./fares-editorial.mjs";
import { swissEditorialStyle } from "./swiss-editorial.mjs";
import { cyberMatrixStyle } from "./cyber-matrix.mjs";
import { minimalLuxuryStyle } from "./minimal-luxury.mjs";

export const STYLES = {
  "fares-editorial": faresEditorialStyle,
  fares: faresEditorialStyle,
  nv3us: faresEditorialStyle,
  default: faresEditorialStyle,

  "swiss-editorial": swissEditorialStyle,
  swiss: swissEditorialStyle,
  minimal: swissEditorialStyle,

  "cyber-matrix": cyberMatrixStyle,
  cyber: cyberMatrixStyle,
  matrix: cyberMatrixStyle,
  tech: cyberMatrixStyle,

  "minimal-luxury": minimalLuxuryStyle,
  luxury: minimalLuxuryStyle,
  gold: minimalLuxuryStyle,
};

/** Retrieve a style preset by id or alias (falls back to Fares Editorial). */
export function getStyle(nameOrId = "fares-editorial") {
  const key = String(nameOrId || "fares-editorial").toLowerCase().trim();
  return STYLES[key] || faresEditorialStyle;
}

/** Style catalogue for CLI help, the Telegram bot and docs. */
export function listStyles() {
  return Object.values({
    "fares-editorial": faresEditorialStyle,
    "swiss-editorial": swissEditorialStyle,
    "cyber-matrix": cyberMatrixStyle,
    "minimal-luxury": minimalLuxuryStyle,
  }).map((style) => ({
    id: style.id,
    name: style.name,
    description: style.description,
    keywordColor: style.palette.keywordColor,
    reference: style.referenceUrl || null,
  }));
}

/** Which bundled font files exist, so @font-face never points at a missing file. */
function bundledFonts() {
  const dir = fromRoot("templates/assets/fonts");
  const pick = (file) => existsSync(join(dir, file));
  return {
    interBold: pick("Inter-Bold.woff2"),
    interSemiBold: pick("Inter-SemiBold.woff2"),
    cairo: ["Cairo-Bold.woff2", "Cairo-SemiBold.woff2"].filter((f) => pick(f)),
  };
}

/**
 * Emit the composition stylesheet.
 *
 * Fonts and the animation runtime are local files inside the project — a render
 * must never depend on a CDN, or one network hiccup produces a black video.
 * Caption type is sized from `--cap-size`, which the builder solves per scene,
 * and the keyword scales relative to it so auto-fit keeps working.
 */
export function generateStyleCss(style, { canvas = { width: 1080, height: 1920 } } = {}) {
  const p = style.palette;
  const l = style.layout;
  const fonts = bundledFonts();

  const face = (family, file, weight) =>
    file ? `@font-face { font-family: "${family}"; src: url("assets/fonts/${file}") format("woff2"); font-weight: ${weight}; font-style: normal; font-display: block; }` : "";

  const fontFaces = [
    face("Inter Reel", fonts.interBold ? "Inter-Bold.woff2" : null, 800),
    face("Inter Reel", fonts.interSemiBold ? "Inter-SemiBold.woff2" : null, 600),
    ...fonts.cairo.map((file) => face("Cairo Reel", file, /Bold/.test(file) ? 700 : 600)),
  ]
    .filter(Boolean)
    .join("\n    ");

  const latinStack = `${fonts.interBold ? '"Inter Reel", ' : ""}Inter, "Helvetica Neue", Arial, sans-serif`;
  const arabicStack = `${fonts.cairo.length ? '"Cairo Reel", ' : ""}Cairo, "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif`;

  // Vertical rhythm scales with the canvas so 1:1 and 4:5 stay balanced.
  const h = canvas.height;
  // Presets store lengths as CSS strings ("88px"), so parse before scaling.
  const px = (value) => {
    const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) ? Math.round((parsed / 1920) * h * 10) / 10 : 0;
  };

  return `
    ${fontFaces}

    :root {
      --bg-dark: ${p.bgDark};
      --bg-light: ${p.bgLight};
      --text-color: ${p.textColor};
      --keyword-color: ${p.keywordColor};
      --keyword-glow: ${p.keywordGlow};
      --tag-bg: ${p.tagBg};
      --tag-color: ${p.tagColor};
      --cap-size: ${px(l.wordFontSize)}px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      overflow: hidden;
      background: var(--bg-dark);
    }

    #root {
      position: relative;
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      overflow: hidden;
      font-family: ${latinStack};
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
    }

    /* --- scenes ------------------------------------------------------- */
    .scene {
      position: absolute;
      inset: 0;
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      overflow: hidden;
      will-change: transform, opacity;
    }
    .light { background: var(--bg-light); color: var(--text-color); }
    .dark { background: var(--bg-dark); color: #ffffff; }
    .camera { position: absolute; inset: 0; width: 100%; height: 100%; transform-origin: 50% 50%; will-change: transform; }

    /* --- atmosphere --------------------------------------------------- */
    .grid {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image: linear-gradient(${p.gridColorLight} 2px, transparent 2px),
                        linear-gradient(90deg, ${p.gridColorLight} 2px, transparent 2px);
      background-size: ${px(96)}px ${px(96)}px;
      background-position: ${px(12)}px ${px(20)}px;
      -webkit-mask-image: radial-gradient(ellipse 75% 60% at 50% 45%, #000 25%, transparent 85%);
      mask-image: radial-gradient(ellipse 75% 60% at 50% 45%, #000 25%, transparent 85%);
    }
    .dark .grid {
      background-image: linear-gradient(${p.gridColorDark} 2px, transparent 2px),
                        linear-gradient(90deg, ${p.gridColorDark} 2px, transparent 2px);
    }
    .vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(ellipse 78% 62% at 50% 46%, transparent 38%, rgba(4,3,3,.9) 100%);
    }
    .light .vignette { background: radial-gradient(ellipse 80% 64% at 50% 46%, transparent 45%, rgba(0,0,0,.28) 100%); }

    svg.ribbon {
      position: absolute;
      inset: 0;
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      pointer-events: none;
      overflow: visible;
      z-index: 5;
      opacity: 0.14;
    }
    svg.ribbon path {
      fill: none;
      stroke: var(--tag-color, #e71f28);
      stroke-width: ${px(84)};
      stroke-linecap: round;
    }

    /* --- editorial eyebrow -------------------------------------------- */
    .badge {
      position: absolute;
      top: ${px(96)}px;
      left: ${px(l.captionSidePadding)}px;
      z-index: 30;
      font-family: ${latinStack};
      font-size: ${px(26)}px;
      font-weight: 600;
      letter-spacing: ${px(4)}px;
      text-transform: uppercase;
      color: var(--tag-color);
      background: var(--tag-bg);
      padding: ${px(10)}px ${px(20)}px;
      border-radius: ${px(4)}px;
      will-change: transform, opacity, filter;
    }
    .rtl .badge, .scene .cap.rtl ~ .badge { left: auto; right: ${px(l.captionSidePadding)}px; }

    .brand {
      position: absolute;
      bottom: ${px(74)}px;
      right: ${px(l.captionSidePadding)}px;
      z-index: 30;
      font-family: ${latinStack};
      font-size: ${px(24)}px;
      font-weight: 600;
      letter-spacing: ${px(3)}px;
      text-transform: uppercase;
      color: rgba(255,255,255,.55);
    }

    /* --- hero stage ---------------------------------------------------- */
    .hero-box {
      position: absolute;
      top: ${l.heroTop};
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      width: ${px(900)}px;
      height: ${px(620)}px;
      pointer-events: none;
      z-index: 20;
      will-change: transform, opacity;
    }
    .hero-glow {
      position: absolute;
      width: ${px(660)}px;
      height: ${px(660)}px;
      border-radius: 50%;
      filter: blur(${px(96)}px);
      opacity: 0.42;
    }
    .dark .hero-glow { background: ${p.heroAuraDark}; }
    .light .hero-glow { background: ${p.heroAuraLight}; }
    .hero-glow-empty { opacity: 0.7; }
    .hero-visual {
      max-width: ${l.heroMaxWidth};
      max-height: ${l.heroMaxHeight};
      width: auto;
      height: auto;
      object-fit: contain;
      filter: drop-shadow(${p.heroShadow});
      will-change: transform;
    }

    /* --- captions ------------------------------------------------------ */
    .cap {
      position: absolute;
      left: ${l.captionSidePadding};
      right: ${l.captionSidePadding};
      top: ${l.captionTop};
      bottom: ${px(120)}px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      z-index: 35;
      line-height: 1.12;
      pointer-events: none;
      font-size: var(--cap-size);
    }
    .cap.ltr { direction: ltr; text-align: left; }
    .cap.rtl {
      direction: rtl;
      text-align: right;
      font-family: ${arabicStack};
      line-height: 1.3;
    }
    .ln { display: block; margin-bottom: ${px(6)}px; }
    .ltr .ln.i1 { padding-left: ${l.lineIndent1}; }
    .ltr .ln.i2 { padding-left: ${l.lineIndent2}; }
    .rtl .ln.i1 { padding-right: ${l.lineIndent1}; }
    .rtl .ln.i2 { padding-right: ${l.lineIndent2}; }

    .w {
      display: inline-block;
      font-weight: 800;
      font-size: 1em;
      margin-right: 0.2em;
      transform-origin: 50% 62%;
      letter-spacing: -0.02em;
      opacity: 0;
      filter: blur(${px(14)}px);
      will-change: transform, opacity, filter;
    }
    .rtl .w { margin-right: 0; margin-left: 0.22em; letter-spacing: 0; }
    .dark .w { color: #ffffff; text-shadow: 0 ${px(4)}px ${px(26)}px rgba(0,0,0,.55); }
    .light .w { color: var(--text-color); }

    .w.k {
      font-weight: 900;
      font-size: 1.22em;
      color: var(--keyword-color);
      letter-spacing: -0.03em;
      line-height: 1.02;
      text-shadow: var(--keyword-glow);
    }

    /* --- retention progress line --------------------------------------- */
    .progress-track {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: ${px(6)}px;
      background: rgba(255,255,255,.08);
      z-index: 60;
    }
    .progress-bar {
      height: 100%;
      width: 100%;
      transform-origin: 0% 50%;
      background: var(--keyword-color);
      box-shadow: 0 0 ${px(16)}px var(--keyword-color);
    }
  `;
}
