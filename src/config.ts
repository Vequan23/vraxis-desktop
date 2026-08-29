import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { ConfigInspection } from "./types.js";
import { inspectDesktopConfig } from "./validate.js";

export const defaultConfigNames = ["vraxis.desktop.config.mjs", "vraxis.desktop.config.js", "vraxis.desktop.json"] as const;

export async function findConfigPath(cwd = process.cwd(), requested?: string): Promise<string> {
  if (requested) return resolve(cwd, requested);
  for (const name of defaultConfigNames) {
    const path = resolve(cwd, name);
    try { await readFile(path); return path; } catch { /* keep looking */ }
  }
  throw new Error("No desktop config found. Run vraxis-desktop init.");
}

export async function loadDesktopConfig(path: string): Promise<ConfigInspection> {
  try {
    const value = extname(path) === ".json"
      ? JSON.parse(await readFile(path, "utf8")) as unknown
      : (await import(`${pathToFileURL(path).href}?updated=${Date.now()}`) as { default?: unknown }).default;
    return inspectDesktopConfig(value, path);
  } catch (error) {
    return { valid: false, errors: [{ path: "config", message: error instanceof Error ? error.message : String(error) }], warnings: [] };
  }
}
