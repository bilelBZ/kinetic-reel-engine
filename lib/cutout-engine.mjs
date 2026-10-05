import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

/**
 * Removes background using HyperFrames on-device AI model (u2net) to produce
 * a pristine transparent hero cutout PNG.
 * Falls back safely to direct copy if unavailable.
 */
export async function makeTransparentCutout({ inputImagePath, outputPngPath }) {
  if (!existsSync(inputImagePath)) {
    throw new Error(`Input image not found: ${inputImagePath}`);
  }

  mkdirSync(dirname(outputPngPath), { recursive: true });

  console.log(`[Cutout Engine] ✂️ Extracting transparent subject via AI model...`);

  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "npx.cmd" : "npx";

    const proc = spawn(cmd, ["hyperframes", "remove-background", "-o", outputPngPath, inputImagePath], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWindows,
      windowsHide: true,
    });

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0 && existsSync(outputPngPath)) {
        console.log(`[Cutout Engine] ✓ Transparent cutout generated: ${outputPngPath}`);
        resolve({ ok: true, path: outputPngPath });
      } else {
        console.warn(`[Cutout Engine] AI background removal failed (code ${code}): ${stderr.slice(0, 100)}. Falling back to original.`);
        try {
          copyFileSync(inputImagePath, outputPngPath);
          resolve({ ok: true, path: outputPngPath, fallback: true });
        } catch (copyErr) {
          resolve({ ok: false, error: copyErr.message });
        }
      }
    });

    proc.on("error", (err) => {
      console.warn(`[Cutout Engine] Spawn error: ${err.message}. Falling back.`);
      try {
        copyFileSync(inputImagePath, outputPngPath);
        resolve({ ok: true, path: outputPngPath, fallback: true });
      } catch (copyErr) {
        resolve({ ok: false, error: copyErr.message });
      }
    });
  });
}
