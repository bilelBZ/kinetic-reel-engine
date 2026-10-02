/**
 * Style Preset: Minimal Gold Luxury
 * 
 * Visual Anatomy:
 * - Atmosphere: Matte velvet charcoal (#0F0E0D) with soft warm ambient lighting.
 * - Hero Stage: Luxury artifact / 3D centerpiece with opulent golden aura and soft diffuse shadow.
 * - Captions: Sophisticated geometric typography, radiant metallic gold (#F59E0B) keywords.
 * - Keyword Hit: Golden bloom flare, smooth exponential expansion, deep cinematic impact.
 * - Camera: Gentle slow-motion push-in with fluid drift.
 */

export const minimalLuxuryStyle = {
  id: "minimal-luxury",
  name: "Minimal Gold Luxury",
  description: "Refined luxury aesthetic with warm metallic gold accents, velvet charcoal atmosphere, and fluid cinematic camera movements.",

  fonts: {
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Inter:wght@700;800;900&display=swap",
    arabicFont: "'Cairo', sans-serif",
    latinFont: "'Inter', sans-serif"
  },

  palette: {
    bgDark: "#0F0E0D",
    bgLight: "#1C1A17",
    textColor: "#F5F3EF",
    keywordColor: "#F59E0B",
    keywordGlow: "0 0 35px rgba(245,158,11,0.9), 0 0 75px rgba(245,158,11,0.45)",
    heroAuraDark: "radial-gradient(circle, rgba(245,158,11,0.4) 0%, rgba(217,119,6,0.15) 50%, transparent 75%)",
    heroAuraLight: "radial-gradient(circle, rgba(245,158,11,0.2) 0%, transparent 70%)",
    heroShadow: "0 40px 80px rgba(0,0,0,0.8)",
    gridColorDark: "rgba(245, 158, 11, 0.03)",
    gridColorLight: "rgba(245, 158, 11, 0.05)",
    tagBg: "rgba(245, 158, 11, 0.15)",
    tagColor: "#F59E0B",
  },

  layout: {
    heroTop: "38%",
    heroMaxWidth: "840px",
    heroMaxHeight: "780px",
    captionBottom: "230px",
    captionSidePadding: "70px",
    wordFontSize: "74px",
    wordFontSizeRtl: "76px",
    keywordFontSize: "114px",
    lineIndent1: "50px",
    lineIndent2: "100px",
  },

  animation: {
    word: {
      from: { filter: "blur(12px)", opacity: 0, scale: 1.15, y: 10 },
      to: { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.18, ease: "power2.out" }
    },
    keyword: {
      from: { filter: "blur(20px)", opacity: 0, scale: 1.5, y: 18 },
      to: { filter: "blur(0px)", opacity: 1, scale: 1.0, y: 0, duration: 0.24, ease: "power3.out" }
    },
    shake: {
      x: 8,
      y: -5,
      duration: 0.05,
      repeat: 2,
      yoyo: true
    },
    camera: {
      startScale: 1.07,
      endScale: 1.0,
      rotationFactor: 0.5
    },
    hero: {
      entrance: {
        from: { y: 65, opacity: 0, scale: 0.88, rotation: 1.5 },
        to: { y: 0, opacity: 1, scale: 1.0, rotation: 0, duration: 0.7, ease: "power3.out" }
      },
      floating: {
        y: -14,
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
