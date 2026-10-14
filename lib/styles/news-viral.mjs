/**
 * Style Preset: News Viral (final news-reel standard)
 *
 * The look Bilel converged on after the v1→v7 iterations:
 * - Karaoke captions: Anton, white text, ACTIVE word highlighted yellow in real time
 * - Hook: bold highlight bar — black text on yellow, slide-in
 * - Animated badge: yellow/black highlight, pops exactly when the number is spoken
 * - Teaser 0–3s: strongest moment first, flash-white transition
 * - End-screen CTA: fade to black + "VOUS EN PENSEZ QUOI ?" highlight
 * - Clean cinematic SFX (swept-air whoosh, deep boom on giant words)
 * - Background: REAL footage (YouTube extract), not AI-generated
 *
 * Arabic fallback: Cairo Black (Anton has no Arabic glyphs).
 */

export const newsViralStyle = {
  id: "news-viral",
  name: "News Viral (karaoke final)",
  referenceUrl: "",
  description:
    "Real-footage news reels: Anton karaoke captions with yellow active word, highlight hook bar, animated number badge, teaser + flash transition, end-screen CTA, cinematic SFX.",

  fonts: {
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Anton&family=Cairo:wght@700;800;900&display=swap",
    arabicFont: "'Cairo', sans-serif",
    latinFont: "'Anton', sans-serif",
  },

  palette: {
    bgDark: "#000000",
    bgLight: "#000000",
    textColor: "#FFFFFF",
    captionColor: "#FFFFFF",
    activeWordColor: "#FFD60A",
    activeWordGlow: "0 0 28px rgba(255,214,10,0.85), 0 2px 0 rgba(0,0,0,0.9)",
    keywordColor: "#FFD60A",
    keywordGlow: "0 0 35px rgba(255,214,10,0.9), 0 2px 0 rgba(0,0,0,0.9)",
    hookBg: "#FFD60A",
    hookColor: "#0A0A0A",
    badgeBg: "#FFD60A",
    badgeColor: "#0A0A0A",
    ctaBg: "#FFD60A",
    ctaColor: "#0A0A0A",
    captionShadow: "0 3px 0 rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.6)",
    tagBg: "rgba(255,214,10,0.16)",
    tagColor: "#FFD60A",
    // Compatibility with generateStyleCss()
    heroAuraDark: "radial-gradient(circle, rgba(255,214,10,0.25) 0%, transparent 70%)",
    heroAuraLight: "radial-gradient(circle, rgba(255,214,10,0.15) 0%, transparent 70%)",
    heroShadow: "0 35px 70px rgba(0,0,0,0.85)",
    gridColorDark: "rgba(255,255,255,0.03)",
    gridColorLight: "rgba(255,255,255,0.03)",
  },

  layout: {
    heroTop: "30%",
    heroMaxWidth: "840px",
    heroMaxHeight: "560px",
    // Captions sit low, inside the safe area (above TikTok/FB UI chrome)
    captionTop: "60%",
    captionBottom: "230px",
    captionSidePadding: "56px",
    captionMaxLines: 3,
    wordFontSize: "86px",
    wordFontSizeRtl: "88px",
    keywordFontSize: "120px",
    lineIndent1: "0px",
    lineIndent2: "0px",
    hookTop: "150px",
    hookFontSize: "72px",
    hookPadding: "18px 34px",
    badgeFontSize: "110px",
    badgePadding: "14px 30px",
  },

  animation: {
    // Karaoke word: quick pop entrance; the "active" class drives the yellow highlight
    word: {
      from: { opacity: 0, scale: 1.35, y: 14 },
      to: { opacity: 1, scale: 1.0, y: 0, duration: 0.14, ease: "back.out(2.2)" },
    },
    activeWord: {
      scale: 1.18,
      ease: "back.out(3)",
      duration: 0.12,
    },
    keyword: {
      from: { opacity: 0, scale: 1.7, y: 26 },
      to: { opacity: 1, scale: 1.0, y: 0, duration: 0.2, ease: "back.out(1.8)" },
    },
    hook: {
      from: { x: -900, opacity: 0 },
      to: { x: 0, opacity: 1, duration: 0.45, ease: "power4.out" },
    },
    badge: {
      from: { scale: 0.2, opacity: 0, rotation: -8 },
      to: { scale: 1.0, opacity: 1, rotation: 0, duration: 0.35, ease: "back.out(2.5)" },
      out: { scale: 0.2, opacity: 0, duration: 0.25, ease: "power2.in" },
      visibleSeconds: 1.6,
    },
    teaserFlash: {
      duration: 0.14,
    },
    cta: {
      from: { opacity: 0, y: 40, scale: 0.9 },
      to: { opacity: 1, y: 0, scale: 1.0, duration: 0.5, ease: "power3.out" },
    },
    camera: {
      startScale: 1.06,
      endScale: 1.0,
      rotationFactor: 0.6,
    },
    hero: {
      entrance: {
        from: { y: 60, opacity: 0, scale: 0.9, rotation: 2 },
        to: { y: 0, opacity: 1, scale: 1.0, rotation: 0, duration: 0.6, ease: "back.out(1.6)" },
      },
      floating: { y: -14, rotation: 1.2, ease: "sine.inOut" },
    },
    shake: { x: 10, y: -6, duration: 0.04, repeat: 3, yoyo: true },
  },

  sfx: {
    intro: "assets/audio/sfx/whoosh-cinematic.mp3",
    transition: "assets/audio/sfx/whoosh-short.mp3",
    impactBass1: "assets/audio/sfx/impact-bass-1.mp3",
    impactBass2: "assets/audio/sfx/impact-bass-2.mp3",
    click: "assets/audio/sfx/pop.mp3",
    badgePop: "assets/audio/sfx/pop.mp3",
    ctaChime: "assets/audio/sfx/chime.mp3",
  },
};
