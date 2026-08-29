import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectDesktopConfig, validateDesktopConfig } from "../src/validate.js";

describe("desktop configuration", () => {
  it("accepts a secure hosted application", () => {
    expect(validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs", bundleId: "io.vraxis.docs" },
      source: { kind: "remote", url: "https://example.com" },
      security: { externalLinks: "browser", permissions: [] },
    })).toEqual([]);
  });

  it("rejects insecure hosted content and non-loopback services", () => {
    expect(validateDesktopConfig({ schemaVersion: 1, app: { id: "docs", name: "Docs" }, source: { kind: "remote", url: "http://example.com" } }))
      .toContainEqual({ path: "source.url", message: "Use an HTTPS address." });
    expect(validateDesktopConfig({ schemaVersion: 1, app: { id: "docs", name: "Docs" }, source: { kind: "service", command: "docs", url: "http://192.168.1.2:4000" } }))
      .toContainEqual({ path: "source.url", message: "Local services must use a loopback address." });
  });

  it("accepts one bundled service launch method and rejects unsafe entries", () => {
    expect(validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "service", bundle: { directory: "desktop-service", entry: "server/index.js" }, url: "http://127.0.0.1:{port}" },
    })).toEqual([]);
    expect(validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "service", command: "docs", bundle: { directory: "desktop-service", entry: "../server.js" }, url: "http://127.0.0.1:{port}" },
    }).map(issue => issue.path)).toEqual(["source", "source.bundle.entry"]);
  });

  it("accepts only the reviewed service authentication contract", () => {
    expect(validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "service", authentication: "desktop-token", command: "docs", url: "http://127.0.0.1:{port}" },
    })).toEqual([]);
    expect(validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "service", authentication: "shared-password", command: "docs", url: "http://127.0.0.1:{port}" },
    })).toContainEqual({ path: "source.authentication", message: "Choose desktop-token authentication." });
  });

  it("keeps secrets out of packaged environment settings", () => {
    expect(validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "service", command: "docs", url: "http://127.0.0.1:{port}", environment: { set: { OPENAI_API_KEY: "secret" } } },
    })).toContainEqual({
      path: "source.environment.set.OPENAI_API_KEY",
      message: "Do not store secrets in the desktop config. Inherit this variable at runtime instead.",
    });
  });

  it("allows a narrow directory picker only for trusted local content", () => {
    expect(validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "reader", name: "Reader" },
      source: { kind: "service", command: "reader", url: "http://127.0.0.1:{port}" },
      integrations: { directoryPicker: { title: "Choose a library", buttonLabel: "Observe folder" } },
    })).toEqual([]);
    expect(validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "remote", url: "https://example.com" },
      integrations: { directoryPicker: {} },
    })).toContainEqual({
      path: "integrations.directoryPicker",
      message: "The native directory picker is available only to static and local-service apps.",
    });
  });

  it("rejects unsupported permissions, unsafe entry paths, and malformed file associations", () => {
    const issues = validateDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "static", directory: "dist", index: "../secret.html" },
      security: { permissions: ["filesystem"] },
      integrations: { fileAssociations: [{ extensions: [".md"] }] },
    });
    expect(issues.map(issue => issue.path)).toEqual([
      "source.index",
      "security.permissions.0",
      "integrations.fileAssociations.0.extensions",
    ]);
  });

  it("resolves package versions and reports missing release assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-config-"));
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "2.3.4" }));
    const result = await inspectDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "static", directory: "dist" },
    }, join(root, "vraxis.desktop.config.mjs"));
    expect(result.valid).toBe(true);
    expect(result.config?.app.version).toBe("2.3.4");
    expect(result.warnings.map(item => item.path)).toEqual(["branding", "updates"]);
  });

  it("rejects a bundled entry symlink that leaves the service directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-bundle-link-"));
    const bundle = join(root, "service");
    await mkdir(bundle);
    await writeFile(join(root, "outside.mjs"), "console.log('outside')");
    await symlink(join(root, "outside.mjs"), join(bundle, "server.mjs"));
    const result = await inspectDesktopConfig({
      schemaVersion: 1,
      app: { id: "docs", name: "Docs" },
      source: { kind: "service", bundle: { directory: "service", entry: "server.mjs" }, url: "http://127.0.0.1:{port}" },
    }, join(root, "vraxis.desktop.config.mjs"));
    expect(result.errors).toContainEqual({ path: "source.bundle.entry", message: "Keep the service entry file inside its directory, including symlink targets." });
  });
});
