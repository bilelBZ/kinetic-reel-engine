import { existsSync } from "node:fs";

/**
 * Returns the absolute or system command path for FFmpeg cross-platform
 */
export function getFfmpegPath() {
  const scoopPath = "C:\\Users\\bbouzid\\AppData\\Local\\Scoop\\shims\\ffmpeg.exe";
  if (process.platform === "win32" && existsSync(scoopPath)) {
    return scoopPath;
  }
  return "ffmpeg";
}
