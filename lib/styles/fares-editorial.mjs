/**
 * Style Preset: Fares Editorial (@nv3us Signature)
 * Reference Video: https://youtube.com/shorts/LyuxCbPDpy0
 * 
 * Visual Anatomy:
 * - Atmosphere: Deep obsidian luxury black (#070707) with dark radial vignette and subtle grid.
 * - Hero Stage: Isolated 840px floating 3D object / photo with electric crimson backlight aura & 70px drop shadow.
 * - Physics: GSAP overshoot pop entrance (back.out(1.5)) followed by continuous sinusoidal floating oscillation.
 * - Captions: Giant Cairo / Inter 900 typography, staggered lines (.i1, .i2), word-by-word blur-to-sharp reveals.
 * - Keyword Hit: Standout word hits in electric red (#FF2E36), +35% scale spike, 4-frame screen shake, sub-bass sync.
 * - Camera: Constant cinematic slow push-in with directional whip transitions between scenes.
 */

export const faresEditorialStyle = {
  id: "fares-editorial",
  name: "Fares Signature (@nv3us Style)",
  referenceUrl: "https://youtube.com/shorts/LyuxCbPDpy0",
  description: "Dark luxury kinetic editorial with isolated floating 3D hero objects, glowing ambient auras, Cairo/Inter 900 typography, word blur reveals, red keyword slam hits with camera shake, and sub-bass sync.",
  
  fonts: {
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Inter:wght@700;800;900&display=swap",
    arabicFont: "'Cairo', sans-serif",
    latinFont: "'Inter', sans-serif"
  },

  palette: {
    bgDark: "#070707",
    bgLight: "#121214",
    textColor: "#FFFFFF",
    keywordColor: "#FF2E36",
    keywordGlow: "0 0 35px rgba(255,46,54,0.9), 0 0 85px rgba(255,46,54,0.5)",
    heroAuraDark: "radial-gradient(circle, rgba(255,46,54,0.55) 0%, rgba(245,158,11,0.2) 45%, transparent 75%)",
    heroAuraLight: "radial-gradient(circle, rgba(255,46,54,0.25) 0%, rgba(21,18,17,0.12) 60%, transparent 80%)",
    heroShadow: "0 35px 70px rgba(0,0,0,0.85)",
    gridColorDark: "rgba(255, 255, 255, 0.03)",
    gridColorLight: "rgba(21, 18, 17, 0.06)",
    tagBg: "rgba(255, 46, 54, 0.15)",
    tagColor: "#FF2E36",
  },

  layout: {
    heroTop: "39%",
    heroMaxWidth: "840px",
    heroMaxHeight: "780px",
    captionBottom: "230px",
    captionSidePadding: "70px",
    wordFontSize: "76px",
    wordFontSizeRtl: "78px",
    keywordFontSize: "118px",
    lineIndent1: "50px",
    lineIndent2: "100px",
  },

  animation: {
    word: {
      from: { filter: "blur(14px)", opacity: 0, scale: 1.2, y: 12 },
      to: { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.16, ease: "power3.out" }
    },
    keyword: {
      from: { filter: "blur(24px)", opacity: 0, scale: 1.6, y: 22 },
      to: { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.22, ease: "power4.out" }
    },
    shake: {
      x: 12,
      y: -8,
      duration: 0.04,
      repeat: 3,
      yoyo: true
    },
    camera: {
      startScale: 1.10,
      endScale: 1.0,
      rotationFactor: 1.0
    },
    hero: {
      entrance: {
        from: { y: 80, opacity: 0, scale: 0.85, rotation: 3 },
        to: { y: 0, opacity: 1, scale: 1.0, rotation: 0, duration: 0.65, ease: "back.out(1.5)" }
      },
      floating: {
        y: -16,
        rotation: 1.5,
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
