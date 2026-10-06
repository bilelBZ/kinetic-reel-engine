import { existsSync, readdirSync, mkdirSync, statSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { run, getFfmpegPath, fromRoot } from "./env.mjs";

/**
 * Render / validate adapters around the HyperFrames CLI.
 *
 * Everything here shells out to `npx hyperframes`, so the video engine stays
 * the CLI's job: this module only decides *what* to run, captures the result,
 * and turns failures into actionable errors instead of silent breakage.
 */

/** Vendored GSAP version — kept next to the pinned package so they cannot drift. */
export const GSAP_VERSION = "3.14.2";

function npxArgs(command, args) {
  return ["hyperframes", command, ...args];
}

function invoke(command, args, { cwd, timeout = 900000, log } = {}) {
  if (log) log(`[HyperFrames] npx ${command} ${args.join(" ")}`);
  const res = run("npx", npxArgs(command, args), {
    cwd,
    timeout,
    shell: process.platform === "win32",
  });
  return res;
}

/** Ensure the local HyperFrames CLI is reachable before we spend time rendering. */
export function preflight({ log = console.log } = {}) {
  const localBin = fromRoot("node_modules", ".bin", "hyperframes");
  const localBinCmd = process.platform === "win32" ? `${localBin}.cmd` : localBin;
  const hasLocal = existsSync(localBinCmd);
  const version = run("npx", ["hyperframes", "--version"], {
    timeout: 120000,
    shell: process.platform === "win32",
  });
  const ok = version.ok;
  if (!ok) log("[Preflight] `npx hyperframes` is not runnable — run `npm install` first.");
  else log(`[Preflight] HyperFrames ${version.stdout.trim() || "ready"}${hasLocal ? " (local install)" : " (npx)"}`);
  return { ok, hasLocal, version: version.stdout.trim() };
}

/**
 * Validate the composition before spending render time.
 * Returns findings; only `error`-severity ones should block a render.
 */
export function checkComposition({ projectDir, strict = false, log = console.log } = {}) {
  const args = ["--json"];
  if (strict) args.push("--strict");
  const res = invoke("check", args, { cwd: projectDir, timeout: 300000, log: null });

  let payload = null;
  try {
    payload = JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));
  } catch {
    /* check may not be available in older CLIs */
  }

  const findings = payload?.findings || payload?.results || [];
  const errors = findings.filter((f) => (f.severity || f.level) === "error");
  const warnings = findings.filter((f) => (f.severity || f.level) === "warning");

  if (!payload && !res.ok) {
    log(`[Check] skipped (${(res.stderr || res.error || "unavailable").slice(0, 120)})`);
    return { ok: true, skipped: true, findings: [], errors: [], warnings: [] };
  }

  log(`[Check] ${errors.length} error(s), ${warnings.length} warning(s)`);
  for (const finding of [...errors, ...warnings].slice(0, 8)) {
    const where = finding.element || finding.selector || finding.file || "";
    log(`  ${(finding.severity || finding.level || "info").toUpperCase()} ${finding.code || finding.rule || ""} ${where} ${finding.message || ""}`.trimEnd());
  }
  return { ok: errors.length === 0, skipped: false, findings, errors, warnings, raw: payload };
}

/** Render the composition to an MP4. */
export function renderVideoToMp4({
  projectDir,
  outputMp4Path,
  quality = "high",
  fps,
  log = console.log,
} = {}) {
  if (!existsSync(join(projectDir, "index.html"))) {
    throw new Error(`No index.html in ${projectDir} — build the composition before rendering.`);
  }
  const outputAbs = resolve(outputMp4Path);
  mkdirSync(resolve(outputAbs, ".."), { recursive: true });

  const args = ["-o", outputAbs];
  if (quality) args.push("--quality", quality);
  if (fps) args.push("--fps", String(fps));

  log(`[Render] ${projectDir} → ${outputAbs} (quality: ${quality})`);
  const res = invoke("render", args, { cwd: projectDir, timeout: 1800000 });

  if (!res.ok || !existsSync(outputAbs)) {
    const detail = (res.stderr || res.stdout || res.error || "").split("\n").slice(-6).join("\n");
    throw new Error(`HyperFrames render failed (exit ${res.status}).\n${detail}`);
  }
  return { ok: true, outputMp4: outputAbs, bytes: statSync(outputAbs).size };
}

/**
 * Capture exact moments as PNGs — used for cover frames and the contact sheet.
 * Falls back to an ffmpeg grab from the rendered MP4 when snapshot is unavailable.
 */
export function snapshotFrames({ projectDir, times, outDir, mp4Path, log = console.log } = {}) {
  mkdirSync(outDir, { recursive: true });
  const at = times.map((t) => Number(t.toFixed(2))).join(",");

  const res = invoke("snapshot", ["--at", at, "--json"], { cwd: projectDir, timeout: 300000, log: null });
  const files = res.ok ? collectImages(outDir).concat(collectImages(join(projectDir, "snapshots"))) : [];

  if (files.length >= times.length) {
    log(`[Snapshot] ${files.length} frame(s) captured`);
    return { ok: true, files: files.slice(0, times.length), source: "hyperframes" };
  }

  if (mp4Path && existsSync(mp4Path)) {
    const captured = times.map((t, i) => {
      const out = join(outDir, `frame-${String(i + 1).padStart(2, "0")}.png`);
      const grab = run(getFfmpegPath(), ["-y", "-ss", String(t), "-i", mp4Path, "-frames:v", "1", out]);
      return grab.ok ? out : null;
    }).filter(Boolean);
    if (captured.length) {
      log(`[Snapshot] ${captured.length} frame(s) grabbed from the MP4`);
      return { ok: true, files: captured, source: "ffmpeg" };
    }
  }

  log("[Snapshot] no frames captured");
  return { ok: false, files: [], source: null };
}

function collectImages(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
    .sort()
    .map((f) => join(dir, f));
}

/** Build a contact sheet (grid montage) from the rendered MP4 for quick review. */
export function makeContactSheet({
  mp4Path,
  outputPath,
  frames = 12,
  columns = 4,
  log = console.log,
} = {}) {
  if (!existsSync(mp4Path)) throw new Error(`Cannot build a contact sheet: ${mp4Path} not found.`);
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  const rows = Math.ceil(frames / columns);
  const res = run(getFfmpegPath(), [
    "-y", "-i", mp4Path,
    "-vf", `fps=1,scale=270:-1,tile=${columns}x${rows}`,
    "-frames:v", "1",
    outputPath,
  ]);
  if (!res.ok) {
    log(`[ContactSheet] failed: ${res.stderr.slice(0, 160)}`);
    return { ok: false };
  }
  log(`[ContactSheet] ${outputPath}`);
  return { ok: true, path: outputPath };
}

/** Extract a single cover/thumbnail frame as JPEG. */
export function exportCover({ mp4Path, outputPath, at = 0.6, log = console.log } = {}) {
  const res = run(getFfmpegPath(), [
    "-y", "-ss", String(at), "-i", mp4Path,
    "-frames:v", "1", "-q:v", "2",
    outputPath,
  ]);
  if (!res.ok) {
    log(`[Cover] failed: ${res.stderr.slice(0, 140)}`);
    return { ok: false };
  }
  log(`[Cover] ${outputPath}`);
  return { ok: true, path: outputPath };
}

/** Mobile-optimised re-encode for chat delivery. */
export function optimizeForMobile({ inputMp4, outputMp4, crf = 23, log = console.log } = {}) {
  const res = run(getFfmpegPath(), [
    "-y", "-i", inputMp4,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf),
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "160k",
    outputMp4,
  ]);
  if (!res.ok || !existsSync(outputMp4)) {
    log(`[Optimize] failed (${res.stderr.slice(0, 140)}) — keeping the original render`);
    return { ok: false, path: inputMp4 };
  }
  return { ok: true, path: outputMp4 };
}

/** Remove the temp artefacts a render leaves behind (cross-platform). */
export function cleanupProject(projectDir, { keepFrames = false } = {}) {
  if (keepFrames) return;
  // Renders drop frames/snapshots in the project; they are never needed twice.
  for (const dir of ["renders", "snapshots", "frames"]) {
    const target = join(projectDir, dir);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}
