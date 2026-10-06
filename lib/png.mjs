import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

/**
 * Minimal, dependency-free PNG encoder (RGB, 8-bit, no interlace).
 *
 * Why this exists: the engine needs deterministic placeholder art for
 * `--mock` runs, offline tests and demo projects without pulling in sharp/canvas.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Encode raw RGB pixel data (Buffer of w*h*3) into a PNG buffer. */
export function encodePng(width, height, rgb) {
  if (rgb.length !== width * height * 3) {
    throw new Error(`encodePng: expected ${width * height * 3} bytes, got ${rgb.length}`);
  }
  // Each scanline is prefixed with a filter byte (0 = None).
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const src = y * width * 3;
    const dst = y * (width * 3 + 1);
    raw[dst] = 0;
    rgb.copy(raw, dst + 1, src, src + width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Deterministic cinematic placeholder: vertical gradient + off-centre glow + grain.
 * Looks intentional on a dark stage, so a mock preview still reads as a design.
 */
export function gradientPlate({
  width = 1080,
  height = 1920,
  top = "#0a0a0c",
  bottom = "#161118",
  glow = "#ff2e36",
  glowX = 0.5,
  glowY = 0.3,
  glowStrength = 0.5,
  vignette = 0.75,
  grain = 0.035,
  seed = 7,
} = {}) {
  const [tr, tg, tb] = hexToRgb(top);
  const [br, bg, bb] = hexToRgb(bottom);
  const [gr, gg, gb] = hexToRgb(glow);
  const rand = mulberry32(seed);
  const rgb = Buffer.alloc(width * height * 3);
  const cx = glowX * width;
  const cy = glowY * height;
  const maxDist = Math.hypot(width, height) * 0.55;

  for (let y = 0; y < height; y++) {
    const ty = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const base = [lerp(tr, br, ty), lerp(tg, bg, ty), lerp(tb, bb, ty)];
      const dist = Math.hypot(x - cx, y - cy) / maxDist;
      const falloff = Math.max(0, 1 - dist) ** 2 * glowStrength;
      const vig = 1 - vignette * Math.min(1, Math.hypot(x / width - 0.5, y / height - 0.5) * 1.7);
      const noise = (rand() - 0.5) * 255 * grain;
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const glowChannel = [gr, gg, gb][c];
        const value = lerp(base[c], glowChannel, falloff) * vig + noise;
        rgb[i + c] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
  }
  return encodePng(width, height, rgb);
}

/** Write a deterministic placeholder plate to disk. */
export function writeGradientPlate(path, options = {}) {
  writeFileSync(path, gradientPlate(options));
  return path;
}
