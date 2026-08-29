import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { notarizationCredentials, runCli } from "../src/cli.js";

describe("desktop CLI", () => {
  it("runs through the published executable boundary", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "vraxis-desktop.mjs"), "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Vraxis Desktop — package trusted web apps");
  });

  it("creates a starter manifest without overwriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-cli-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runCli(["init"], root)).toBe(0);
    const path = join(root, "vraxis.desktop.config.mjs");
    await expect(access(path)).resolves.toBeUndefined();
    expect(await readFile(path, "utf8")).toContain("defineDesktopApp");
    expect(await runCli(["init"], root)).toBe(1);
    log.mockRestore();
    error.mockRestore();
  });

  it("validates a real config through the command boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-cli-"));
    const config = join(root, "vraxis.desktop.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(config, JSON.stringify({ schemaVersion: 1, app: { id: "docs", name: "Docs" }, source: { kind: "remote", url: "https://example.com" } })));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await runCli(["validate", config], root)).toBe(0);
    expect(log).toHaveBeenCalledWith("Docs is ready for desktop development.");
    log.mockRestore();
    warn.mockRestore();
  });

  it("reads notarization credentials from environment variables without storing them in config", () => {
    expect(notarizationCredentials({ APPLE_KEYCHAIN_PROFILE: "vraxis-notary" })).toEqual({ keychainProfile: "vraxis-notary" });
    expect(notarizationCredentials({ APPLE_ID: "build@example.com", APPLE_APP_SPECIFIC_PASSWORD: "secret", APPLE_TEAM_ID: "TEAM123" })).toEqual({
      appleId: "build@example.com",
      appleIdPassword: "secret",
      teamId: "TEAM123",
    });
    expect(() => notarizationCredentials({})).toThrow("Notarization needs");
  });
});
