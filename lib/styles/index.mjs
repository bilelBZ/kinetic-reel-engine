import { faresEditorialStyle } from "./fares-editorial.mjs";
import { swissEditorialStyle } from "./swiss-editorial.mjs";
import { cyberMatrixStyle } from "./cyber-matrix.mjs";
import { minimalLuxuryStyle } from "./minimal-luxury.mjs";

export const STYLES = {
  "fares-editorial": faresEditorialStyle,
  "fares": faresEditorialStyle,
  "nv3us": faresEditorialStyle,
  "default": faresEditorialStyle,

  "swiss-editorial": swissEditorialStyle,
  "swiss": swissEditorialStyle,
  "minimal": swissEditorialStyle,

  "cyber-matrix": cyberMatrixStyle,
  "cyber": cyberMatrixStyle,
  "matrix": cyberMatrixStyle,
  "tech": cyberMatrixStyle,

  "minimal-luxury": minimalLuxuryStyle,
  "luxury": minimalLuxuryStyle,
  "gold": minimalLuxuryStyle,
};

/**
 * Retrieves a style preset by name or ID (defaults to Fares Editorial)
 */
export function getStyle(nameOrId = "fares-editorial") {
  const normalized = (nameOrId || "fares-editorial").toLowerCase().trim();
  return STYLES[normalized] || faresEditorialStyle;
}

/**
 * Returns available styles for CLI / UI / Telegram Bot menus
 */
export function listStyles() {
  return [
    {
      id: faresEditorialStyle.id,
      name: faresEditorialStyle.name,
      description: faresEditorialStyle.description,
      keywordColor: faresEditorialStyle.palette.keywordColor,
      reference: faresEditorialStyle.referenceUrl
    },
    {
      id: swissEditorialStyle.id,
      name: swissEditorialStyle.name,
      description: swissEditorialStyle.description,
      keywordColor: swissEditorialStyle.palette.keywordColor
    },
    {
      id: cyberMatrixStyle.id,
      name: cyberMatrixStyle.name,
      description: cyberMatrixStyle.description,
      keywordColor: cyberMatrixStyle.palette.keywordColor
    },
    {
      id: minimalLuxuryStyle.id,
      name: minimalLuxuryStyle.name,
      description: minimalLuxuryStyle.description,
      keywordColor: minimalLuxuryStyle.palette.keywordColor
    }
  ];
}

/**
 * Generates custom CSS rules based on the chosen editing style
 */
export function generateStyleCss(style) {
  const p = style.palette;
  const l = style.layout;
  const f = style.fonts;

  return `
    :root {
      --bg-dark: ${p.bgDark};
      --bg-light: ${p.bgLight};
      --text-color: ${p.textColor};
      --keyword-color: ${p.keywordColor};
      --keyword-glow: ${p.keywordGlow};
      --tag-bg: ${p.tagBg};
      --tag-color: ${p.tagColor};
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      background: var(--bg-dark);
    }

    #root {
      position: relative;
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      font-family: ${f.arabicFont}, ${f.latinFont}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    /* Scene scaffolding */
    .scene {
      position: absolute;
      inset: 0;
      overflow: hidden;
      width: 1080px;
      height: 1920px;
    }
    .light { background: var(--bg-light); color: var(--text-color); }
    .dark { background: var(--bg-dark); color: #ffffff; }
    .shake, .cam { position: absolute; inset: 0; width: 100%; height: 100%; }
    .cam { transform-origin: 50% 50%; }

    /* Decors & Grid */
    .grid {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image: linear-gradient(${p.gridColorLight} 2px, transparent 2px),
                        linear-gradient(90deg, ${p.gridColorLight} 2px, transparent 2px);
      background-size: 96px 96px;
      background-position: 12px 20px;
      -webkit-mask-image: radial-gradient(ellipse 75% 60% at 50% 50%, #000 30%, transparent 85%);
      mask-image: radial-gradient(ellipse 75% 60% at 50% 50%, #000 30%, transparent 85%);
    }
    .dark .grid {
      background-image: linear-gradient(${p.gridColorDark} 2px, transparent 2px),
                        linear-gradient(90deg, ${p.gridColorDark} 2px, transparent 2px);
    }
    .vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(ellipse 80% 65% at 50% 50%, transparent 40%, rgba(6,5,5,.88) 100%);
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
      background: var(--tag-bg);
      color: var(--tag-color);
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

    /* Pure Cinematic Hero Stage */
    .hero-box {
      position: absolute;
      top: ${l.heroTop};
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 25;
      width: 900px;
      height: 900px;
    }
    .hero-stage {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-aura {
      position: absolute;
      width: 650px;
      height: 650px;
      border-radius: 50%;
      pointer-events: none;
      filter: blur(95px);
      opacity: 0.4;
    }
    .dark .hero-aura {
      background: ${p.heroAuraDark};
    }
    .light .hero-aura {
      background: ${p.heroAuraLight};
    }
    .hero-visual {
      max-width: ${l.heroMaxWidth};
      max-height: ${l.heroMaxHeight};
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 28px;
      filter: drop-shadow(${p.heroShadow});
      will-change: transform;
    }
    .hero-fallback-orb {
      width: 320px;
      height: 320px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #ffffff 0%, var(--keyword-color) 50%, var(--bg-dark) 100%);
      box-shadow: 0 0 60px var(--tag-bg), inset 0 0 30px rgba(255,255,255,0.4);
      filter: drop-shadow(${p.heroShadow});
    }

    /* Dynamic Captions */
    .cap {
      position: absolute;
      left: ${l.captionSidePadding};
      right: ${l.captionSidePadding};
      bottom: ${l.captionBottom};
      z-index: 35;
      line-height: 1.12;
      pointer-events: none;
    }
    .cap.ltr { direction: ltr; text-align: left; }
    .cap.rtl { direction: rtl; text-align: right; }
    .ln { display: block; margin-bottom: 8px; white-space: normal; }
    .ltr .ln.i1 { padding-left: ${l.lineIndent1}; }
    .ltr .ln.i2 { padding-left: ${l.lineIndent2}; }
    .rtl .ln.i1 { padding-right: ${l.lineIndent1}; }
    .rtl .ln.i2 { padding-right: ${l.lineIndent2}; }

    .w {
      display: inline-block;
      font-weight: 800;
      font-size: ${l.wordFontSize};
      margin-right: 0.22em;
      transform-origin: 50% 60%;
      will-change: transform, filter, opacity;
      letter-spacing: -0.02em;
      opacity: 0;
      filter: blur(14px);
    }
    .rtl .w {
      margin-right: 0;
      margin-left: 0.25em;
      letter-spacing: 0;
      font-size: ${l.wordFontSizeRtl};
    }
    .w.k, .w.slam {
      font-weight: 900;
      font-size: ${l.keywordFontSize};
      color: var(--keyword-color);
      letter-spacing: -0.03em;
      line-height: 1.05;
      text-shadow: var(--keyword-glow);
    }
    .dark .w {
      color: #ffffff;
      text-shadow: 0 0 24px rgba(255,255,255,.2);
    }
  `;
}
