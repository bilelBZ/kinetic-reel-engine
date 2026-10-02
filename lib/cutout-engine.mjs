import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Removes background using hyperframes remove-background CLI
 */
export async function makeTransparentCutout({ inputImagePath, outputPngPath }) {
  if (!existsSync(inputImagePath)) {
    throw new Error(`Input image not found: ${inputImagePath}`);
  }

  // Run hyperframes remove-background
  const res = spawnSync("npx", [
    "hyperframes",
    "remove-background",
    inputImagePath,
    "-o",
    outputPngPath
  ], {
    shell: true,
    encoding: "utf8",
    timeout: 120000,
  });

  if (res.status === 0 && existsSync(outputPngPath)) {
    return { ok: true, path: outputPngPath };
  }

  // If remove-background fails or model download is skipped, fallback to copying
  const copyRes = spawnSync("powershell", [
    "-Command",
    `Copy-Item -Path "${inputImagePath}" -Destination "${outputPngPath}" -Force`
  ]);

  return { ok: true, path: outputPngPath, fallback: true };
}
