import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SCOOP_SHIMS = "C:\\Users\\bbouzid\\AppData\\Local\\Scoop\\shims";

/**
 * Headless MP4 Video Renderer using HyperFrames + FFmpeg
 */
export function renderVideoToMp4({ projectDir, outputMp4Path }) {
  const env = { ...process.env };
  if (process.platform === "win32") {
    env.PATH = `${SCOOP_SHIMS};${process.env.PATH || ""}`;
  }

  const outputAbs = resolve(outputMp4Path);

  console.log(`[Renderer] Starting headless MP4 render for: ${projectDir}`);
  console.log(`[Renderer] Output destination: ${outputAbs}`);

  const renderArgs = [
    "hyperframes",
    "render",
    "-o",
    outputAbs,
  ];

  const result = spawnSync("npx", renderArgs, {
    cwd: projectDir,
    env,
    shell: true,
    stdio: "inherit",
    timeout: 600000, // 10 minutes timeout for longer videos
  });

  if (result.status !== 0 || !existsSync(outputAbs)) {
    throw new Error(`HyperFrames render exited with code ${result.status}. Verify logs above.`);
  }

  return { ok: true, outputMp4: outputAbs };
}
