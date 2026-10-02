import { copyFileSync, existsSync } from "node:fs";

/**
 * Prepares the hero image for composition (cross-platform copy)
 */
export async function makeTransparentCutout({ inputImagePath, outputPngPath }) {
  if (!existsSync(inputImagePath)) {
    throw new Error(`Input image not found: ${inputImagePath}`);
  }

  try {
    copyFileSync(inputImagePath, outputPngPath);
    return { ok: true, path: outputPngPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
