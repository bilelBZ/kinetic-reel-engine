#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fromRoot, run } from "../lib/env.mjs";

/**
 * Vendor the render-time runtime into the repository:
 *   templates/assets/vendor/gsap.min.js   (animation engine)
 *   templates/assets/fonts/*.woff2        (typography, incl. Arabic when reachable)
 *
 * Renders must never fetch from a CDN: a single failed request used to produce a
 * video with no captions at all. Run this once after cloning, and again when
 * bumping GSAP.
 */

const GSAP_VERSION = "3.14.2";
const ARABIC_FAMILY = "Cairo";

function copyGsap() {
  const target = fromRoot("templates/assets/vendor/gsap.min.js");
  if (existsSync(target)) {
    console.log(`✓ GSAP already vendored (${target})`);
    return true;
  }

  // Prefer the local npm cache/registry tarball so this works offline after install.
  const staging = join(tmpdir(), `gsap-vendor-${Date.now()}`);
  mkdirSync(staging, { recursive: true });
  const pack = run("npm", ["pack", `gsap@${GSAP_VERSION}`, "--silent", "--pack-destination", staging], {
    cwd: staging,
    shell: process.platform === "win32",
    timeout: 180000,
  });
  const tarball = (pack.stdout.match(/[\w.-]+\.tgz/) || [])[0];
  if (!pack.ok || !tarball) {
    console.error("✗ Could not download GSAP. Check the network, then re-run `npm run vendor`.");
    return false;
  }
  const extract = spawnSync("tar", ["xzf", join(staging, tarball), "package/dist/gsap.min.js"], {
    cwd: staging,
    encoding: "utf8",
  });
  const source = join(staging, "package/dist/gsap.min.js");
  if (extract.status !== 0 || !existsSync(source)) {
    console.error("✗ GSAP tarball layout was unexpected. Extract dist/gsap.min.js manually.");
    return false;
  }
  mkdirSync(fromRoot("templates/assets/vendor"), { recursive: true });
  writeFileSync(target, readFileSync(source));
  console.log(`✓ Vendored GSAP ${GSAP_VERSION} → ${target}`);
  return true;
}

/**
 * Best-effort Arabic font download. Composers of Arabic reels get correct glyphs
 * offline instead of relying on whatever the host OS happens to ship.
 */
async function vendorArabicFont() {
  const dir = fromRoot("templates/assets/fonts");
  const target = join(dir, `Cairo-Bold.woff2`);
  if (existsSync(target)) {
    console.log("✓ Arabic font already vendored");
    return true;
  }
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${ARABIC_FAMILY}:wght@700&display=swap`,
      { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" } },
    );
    if (!css.ok) throw new Error(`css ${css.status}`);
    const text = await css.text();
    const urls = [...text.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1]);
    if (!urls.length) throw new Error("no woff2 url in the CSS");
    const font = await fetch(urls[urls.length - 1]);
    if (!font.ok) throw new Error(`font ${font.status}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, Buffer.from(await font.arrayBuffer()));
    console.log(`✓ Vendored Arabic font → ${target}`);
    return true;
  } catch (err) {
    console.warn(`! Arabic font not vendored (${err.message}).`);
    console.warn("  Latin renders are unaffected. For Arabic projects install a system");
    console.warn("  Arabic font (e.g. fonts-noto-core) or drop Cairo-Bold.woff2 into templates/assets/fonts.");
    return false;
  }
}

const gsapOk = copyGsap();
const fontOk = await vendorArabicFont();
process.exitCode = gsapOk ? 0 : 1;
console.log(fontOk ? "\nRuntime ready for offline renders." : "\nRuntime ready (Latin). See the note above about Arabic.");
