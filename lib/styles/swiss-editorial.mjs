/**
 * Style Preset: Swiss Modern Editorial
 * 
 * Visual Anatomy:
 * - Atmosphere: Alternating Warm Cream (#FFF8F3) and Deep Ink Black (#060505), architectural clean grid.
 * - Hero Stage: Centered physical specimen with high typographic contrast and subtle paper grain.
 * - Captions: Ultra-clean Swiss geometry, sharp typewriter blur reveals, staggered lines.
 * - Keyword Hit: Classic Swiss Red (#E71F28), snap scale, tactile acoustic hits.
 * - Camera: Subtle Dutch tilt oscillations and fast lateral whip cuts.
 */

export const swissEditorialStyle = {
  id: "swiss-editorial",
  name: "Swiss Modern Kinetic",
  description: "High-contrast minimalist Swiss design alternating warm cream and pitch black, crisp typography, and snappy architectural transitions.",

  fonts: {
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Inter:wght@700;800;900&display=swap",
    arabicFont: "'Cairo', sans-serif",
    latinFont: "'Inter', sans-serif"
  },

  palette: {
    bgDark: "#060505",
    bgLight: "#FFF8F3",
    textColor: "#151211",
    keywordColor: "#E71F28",
    keywordGlow: "0 0 25px rgba(231,31,40,0.6)",
    heroAuraDark: "radial-gradient(circle, rgba(231,31,40,0.35) 0%, transparent 70%)",
    heroAuraLight: "radial-gradient(circle, rgba(21,18,17,0.08) 0%, transparent 70%)",
    heroShadow: "0 30px 60px rgba(0,0,0,0.45)",
    gridColorDark: "rgba(255, 255, 255, 0.04)",
    gridColorLight: "rgba(21, 18, 17, 0.06)",
    tagBg: "rgba(231, 31, 40, 0.12)",
    tagColor: "#E71F28",
  },

  layout: {
    heroTop: "29%",
    heroMaxWidth: "800px",
    heroMaxHeight: "560px",
    captionTop: "54%",
    captionBottom: "100px",
    captionSidePadding: "60px",
    wordFontSize: "86px",
    wordFontSizeRtl: "90px",
    keywordFontSize: "132px",
    lineIndent1: "45px",
    lineIndent2: "90px",
  },

  animation: {
    word: {
      from: { filter: "blur(12px)", opacity: 0, scale: 1.15, y: 10 },
      to: { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.15, ease: "power2.out" }
    },
    keyword: {
      from: { filter: "blur(18px)", opacity: 0, scale: 1.45, y: 16 },
      to: { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.20, ease: "back.out(1.8)" }
    },
    shake: {
      x: 8,
      y: -6,
      duration: 0.04,
      repeat: 2,
      yoyo: true
    },
    camera: {
      startScale: 1.08,
      endScale: 1.0,
      rotationFactor: 0.8
    },
    hero: {
      entrance: {
        from: { y: 60, opacity: 0, scale: 0.9, rotation: -2 },
        to: { y: 0, opacity: 1, scale: 1.0, rotation: 0, duration: 0.55, ease: "power3.out" }
      },
      floating: {
        y: -12,
        rotation: 1.0,
        ease: "sine.inOut"
      }
    }
  },

  sfx: {
    intro: "assets/audio/sfx/whoosh-cinematic.mp3",
    transition: "assets/audio/sfx/whoosh.mp3",
    impactBass1: "assets/audio/sfx/impact-bass-1.mp3",
    impactBass2: "assets/audio/sfx/impact-bass-2.mp3",
    click: "assets/audio/sfx/click.mp3"
  }
};
