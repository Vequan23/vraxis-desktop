import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMacRelease, smokeTestLaunchArgs, smokeTestTimeout } from "../src/release.js";
import { inspectDesktopConfig } from "../src/validate.js";

describe("macOS release artifacts", () => {
  it("disables Chromium's sandbox only for Linux CI smoke tests", () => {
    expect(smokeTestLaunchArgs("linux", "true")).toEqual(["--no-sandbox"]);
    expect(smokeTestLaunchArgs("linux", "false")).toEqual([]);
    expect(smokeTestLaunchArgs("darwin", "true")).toEqual([]);
    expect(smokeTestLaunchArgs("win32", "true")).toEqual([]);
  });

  it("gives a bundled service its readiness budget before a smoke timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-timeout-"));
    const service = join(root, "service");
    await mkdir(service);
    await writeFile(join(service, "server.mjs"), "console.log('ready')");
    const inspected = await inspectDesktopConfig({
      schemaVersion: 1,
      app: { id: "timeout-test", name: "Timeout Test", version: "1.0.0" },
      source: { kind: "service", bundle: { directory: "service", entry: "server.mjs" }, url: "http://127.0.0.1:{port}", readyTimeoutMs: 45_000 },
    }, join(root, "vraxis.desktop.config.mjs"));
    expect(smokeTestTimeout(inspected.config!)).toBe(75_000);
  });

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
