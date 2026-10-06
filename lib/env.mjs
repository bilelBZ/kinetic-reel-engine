import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the repository root (this file lives in <root>/lib). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Join a path relative to the repository root. */
export function fromRoot(...parts) {
  return join(ROOT, ...parts);
}

/** Locate a binary on PATH (cross-platform, no personal hardcoded paths). */
export function which(bin) {
  const cmd = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(cmd, [bin], { encoding: "utf8" });
  if (res.status === 0 && res.stdout) {
    const first = res.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
  }
  return null;
}

function resolveBinary(envVar, name) {
  const explicit = process.env[envVar];
  if (explicit && existsSync(explicit)) return explicit;
  return which(name) || name; // fall back to bare name so the OS resolves it
}

/** FFmpeg path: FFMPEG_PATH env → PATH → bare name. */
export function getFfmpegPath() {
  return resolveBinary("FFMPEG_PATH", "ffmpeg");
}

/** FFprobe path: FFPROBE_PATH env → PATH → bare name. */
export function getFfprobePath() {
  return resolveBinary("FFPROBE_PATH", "ffprobe");
}

/** True when both ffmpeg and ffprobe are actually invocable. */
export function hasFfmpeg() {
  const res = spawnSync(getFfmpegPath(), ["-version"], { encoding: "utf8" });
  return res.status === 0;
}

/**
 * Run a command synchronously and capture output.
 * Never throws for non-zero exit codes — callers decide how to react.
 */
export function run(command, args = [], options = {}) {
  const res = spawnSync(command, args, {
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: options.shell ?? false,
    timeout: options.timeout,
    windowsHide: true,
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: res.stdout ? res.stdout.toString() : "",
    stderr: res.stderr ? res.stderr.toString() : "",
    error: res.error ? res.error.message : null,
  };
}

/** Random, filesystem-safe project id. */
export function projectStamp() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

/**
 * Turn any text (including Arabic, accents, emoji) into a short ASCII slug.
 * Chromium file:// URLs and HyperFrames project ids both prefer ASCII.
 */
export function slugify(text, maxLength = 28) {
  const ascii = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return ascii || "reel";
}

/**
 * Read a key from the environment or from a .env file.
 * Checks process.env first, then ./.env and <root>/.env.
 */
export function readEnvKey(names, extraPaths = []) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  const paths = [join(process.cwd(), ".env"), fromRoot(".env"), ...extraPaths];
  for (const envPath of paths) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, "utf8");
      for (const name of names) {
        const match = content.match(
          new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\r\\n]+)["']?`, "m"),
        );
        if (match && match[1]) return match[1].trim();
      }
    } catch {
      /* unreadable .env is not fatal */
    }
  }
  return null;
}

/** Alias map so both `--style`/`-s` and `--pace`/`--speed` work. */
export function flag(flags, ...names) {
  for (const name of names) {
    if (flags[name] !== undefined) return flags[name];
  }
  return undefined;
}

/** Flags that never take a value, so the next token stays positional. */
const BOOLEAN_FLAGS = new Set([
  "mock",
  "skip-render",
  "json",
  "keep-frames",
  "contact-sheet",
  "no-taps",
  "no-cover",
  "help",
  "h",
  "styles",
]);

/**
 * Split argv into flags and positionals.
 *
 * Naively filtering tokens that start with "-" is wrong in both directions:
 *  - the values of flags such as `--duration 30` do not start with a dash, so
 *    they would leak into the positional list (the topic becomes "… 45 Charon");
 *  - value-less flags such as `--mock` would swallow the next token, losing a
 *    positional topic.
 * Hence the explicit BOOLEAN_FLAGS set.
 */
function tokenize(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const key = token.replace(/^-+/, "");
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }
    const next = argv[i + 1];
    // A following token is this flag's value unless it is itself a flag.
    // Negative numbers ("-0.5") are values, `-d`/`--duration` are flags.
    const nextIsFlag = next !== undefined && /^-/.test(next) && !/^-\d/.test(next);
    if (next === undefined || nextIsFlag) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { flags, positionals };
}

/** Parse `--key value` / `--flag` argv into an object. */
export function parseArgs(argv = process.argv.slice(2)) {
  return tokenize(argv).flags;
}

/**
 * Positional (non-flag) arguments with every flag value excluded — the safe way
 * to read a multi-word topic that was passed without `--topic`.
 */
export function positionalArgs(argv = process.argv.slice(2)) {
  return tokenize(argv).positionals;
}

export function flagNumber(flags, fallback, ...names) {
  const raw = flag(flags, ...names);
  if (raw === undefined || raw === true) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function flagBool(flags, ...names) {
  const raw = flag(flags, ...names);
  return raw === true || raw === "true" || raw === "1" || raw === "yes";
}
