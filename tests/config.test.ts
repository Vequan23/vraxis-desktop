import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findConfigPath, loadDesktopConfig } from "../src/config.js";

describe("config loading", () => {
  it("finds and loads a JSON manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-load-"));
    const path = join(root, "vraxis.desktop.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, app: { id: "docs", name: "Docs" }, source: { kind: "remote", url: "https://example.com" } }));
    expect(await findConfigPath(root)).toBe(path);
    const result = await loadDesktopConfig(path);
    expect(result.valid).toBe(true);
    expect(result.config?.app.name).toBe("Docs");
  });

  it("returns an approachable parse error", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-load-"));
    const path = join(root, "broken.json");
    await writeFile(path, "{");
    const result = await loadDesktopConfig(path);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe("config");
  });
});
