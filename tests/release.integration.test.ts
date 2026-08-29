import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMacRelease } from "../src/release.js";
import { inspectDesktopConfig } from "../src/validate.js";

describe("macOS release artifacts", () => {
  it.runIf(process.platform === "darwin")("creates an unsigned disk image, checksum, and release manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-release-"));
    const site = join(root, "site");
    await mkdir(site);
    await writeFile(join(site, "index.html"), "<!doctype html><title>Release test</title><h1>Ready</h1>");
    const inspected = await inspectDesktopConfig({
      schemaVersion: 1,
      app: { id: "release-test", name: "Release Test", version: "2.3.4", bundleId: "io.vraxis.release-test" },
      source: { kind: "static", directory: "site" },
      packaging: { outputDirectory: "out", mac: { minimumSystemVersion: "13.0" } },
      updates: { provider: "github", owner: "vraxis", repository: "release-test", channel: "beta" },
    }, join(root, "vraxis.desktop.config.mjs"));
    expect(inspected.valid).toBe(true);
    const result = await createMacRelease(inspected.config!, { arch: process.arch as "arm64" | "x64", smokeTest: false });
    await expect(access(result.diskImagePath)).resolves.toBeUndefined();
    await expect(access(result.manifestPath)).resolves.toBeUndefined();
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as typeof result.manifest;
    expect(manifest.channel).toBe("beta");
    expect(manifest.minimumSystemVersion).toBe("13.0");
    expect(manifest.security).toEqual({ signed: false, notarized: false });
    expect(manifest.artifacts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.artifacts[0]?.downloadUrl).toContain("/releases/download/v2.3.4/");
  }, 60_000);
});
