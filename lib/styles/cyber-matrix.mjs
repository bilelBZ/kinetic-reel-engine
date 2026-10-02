/**
 * Style Preset: Cyber Tech Matrix
 * 
 * Visual Anatomy:
 * - Atmosphere: Deep space obsidian navy (#040814) with cyan digital HUD lines and scanlines.
 * - Hero Stage: Glowing futuristic visual / 3D tech subject with volumetric cyan aura and sharp drop-shadow.
 * - Captions: Ultra-crisp geometric type, electric cyan (#00F5FF) and neon lime accents.
 * - Keyword Hit: Blinding neon cyan bloom, rapid snap-in, digital bass hit.
 * - Camera: Snappy tech zooms and fast whip transitions.
 */

export const cyberMatrixStyle = {
  id: "cyber-matrix",
  name: "Cyber Tech Matrix",
  description: "Futuristic high-tech aesthetic with neon cyan glow, digital matrix grids, technical HUD markers, and explosive digital slams.",

  fonts: {
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Inter:wght@700;800;900&display=swap",
    arabicFont: "'Cairo', sans-serif",
    latinFont: "'Inter', sans-serif"
  },

  palette: {
    bgDark: "#040814",
    bgLight: "#081026",
    textColor: "#F0F6FC",
    keywordColor: "#00F5FF",
    keywordGlow: "0 0 35px rgba(0,245,255,0.9), 0 0 70px rgba(0,245,255,0.4)",
    heroAuraDark: "radial-gradient(circle, rgba(0,245,255,0.45) 0%, rgba(30,58,138,0.2) 50%, transparent 75%)",
    heroAuraLight: "radial-gradient(circle, rgba(0,245,255,0.25) 0%, transparent 70%)",
    heroShadow: "0 35px 80px rgba(0,0,0,0.9)",
    gridColorDark: "rgba(0, 245, 255, 0.05)",
    gridColorLight: "rgba(0, 245, 255, 0.08)",
    tagBg: "rgba(0, 245, 255, 0.15)",
    tagColor: "#00F5FF",
  },

  layout: {
    heroTop: "29%",
    heroMaxWidth: "840px",
    heroMaxHeight: "560px",
    captionTop: "54%",
    captionBottom: "100px",
    captionSidePadding: "60px",
    wordFontSize: "88px",
    wordFontSizeRtl: "92px",
    keywordFontSize: "136px",
    lineIndent1: "45px",
    lineIndent2: "90px",
  },

  animation: {
    word: {
      from: { filter: "blur(16px)", opacity: 0, scale: 1.25, y: 15 },
      to: { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.15, ease: "power3.out" }
    },
    keyword: {
      from: { filter: "blur(28px)", opacity: 0, scale: 1.65, y: 25 },
      to: { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.20, ease: "power4.out" }
    },
    shake: {
      x: 14,
      y: -10,
      duration: 0.035,
      repeat: 3,
      yoyo: true
    },
    camera: {
      startScale: 1.12,
      endScale: 1.0,
      rotationFactor: 1.2
    },
    hero: {
      entrance: {
        from: { y: 70, opacity: 0, scale: 0.8, rotation: 4 },
        to: { y: 0, opacity: 1, scale: 1.0, rotation: 0, duration: 0.6, ease: "back.out(1.6)" }
      },
      floating: {
        y: -15,
        rotation: 2.0,
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
