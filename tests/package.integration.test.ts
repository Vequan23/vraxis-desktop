import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageDesktopApp } from "../src/package-app.js";
import { inspectDesktopConfig } from "../src/validate.js";

describe("application packaging", () => {
  it("builds a real application bundle with packaged static content", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-package-test-"));
    const site = join(root, "site");
    await mkdir(site);
    await writeFile(join(site, "index.html"), "<!doctype html><title>Packaged test</title><h1>Ready</h1>");
    const inspected = await inspectDesktopConfig({
      schemaVersion: 1,
      app: { id: "packaged-test", name: "Packaged Test", version: "1.0.0", bundleId: "io.vraxis.packaged-test" },
      source: { kind: "static", directory: "site" },
      packaging: { outputDirectory: "out" },
    }, join(root, "vraxis.desktop.config.mjs"));
    expect(inspected.valid).toBe(true);

    const [output] = await packageDesktopApp(inspected.config!, {
      platform: process.platform as "darwin" | "win32" | "linux",
      arch: process.arch as "arm64" | "x64",
    });
    expect(output).toBeTruthy();
    const resources = process.platform === "darwin"
      ? join(output!, "Packaged Test.app", "Contents", "Resources", "app.asar")
      : join(output!, "resources", "app.asar");
    await expect(access(resources)).resolves.toBeUndefined();
  }, 30_000);

  it("copies a bundled service into the application resources directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-service-package-"));
    const service = join(root, "desktop-service");
    await mkdir(service);
    await writeFile(join(service, "server.mjs"), "console.log('service')");
    const inspected = await inspectDesktopConfig({
      schemaVersion: 1,
      app: { id: "service-test", name: "Service Test", version: "1.0.0" },
      source: { kind: "service", bundle: { directory: "desktop-service", entry: "server.mjs" }, url: "http://127.0.0.1:{port}" },
      packaging: { outputDirectory: "out" },
    }, join(root, "vraxis.desktop.config.mjs"));
    expect(inspected.valid).toBe(true);
    const [output] = await packageDesktopApp(inspected.config!, {
      platform: process.platform as "darwin" | "win32" | "linux",
      arch: process.arch as "arm64" | "x64",
    });
    const resource = process.platform === "darwin"
      ? join(output!, "Service Test.app", "Contents", "Resources", "vraxis-service", "server.mjs")
      : join(output!, "resources", "vraxis-service", "server.mjs");
    await expect(access(resource)).resolves.toBeUndefined();
  }, 30_000);
});
