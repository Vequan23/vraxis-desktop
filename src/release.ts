import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { notarize } from "@electron/notarize";
import { packageDesktopApp, type PackageOptions } from "./package-app.js";
import type { DesktopReleaseManifest, ResolvedDesktopConfig } from "./types.js";

export type NotarizationCredentials =
  | { keychainProfile: string; keychain?: string }
  | { appleId: string; appleIdPassword: string; teamId: string };

export interface MacReleaseOptions {
  arch?: "arm64" | "x64" | "universal";
  signing?: PackageOptions["signing"];
  notarization?: NotarizationCredentials;
  smokeTest?: boolean;
}

export interface MacReleaseResult {
  appPath: string;
  diskImagePath: string;
  manifestPath: string;
  manifest: DesktopReleaseManifest;
}

export async function testPackagedDesktopApp(config: ResolvedDesktopConfig, options: PackageOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform as "darwin" | "win32" | "linux";
  const [output] = await packageDesktopApp(config, options);
  if (!output) throw new Error("Electron Packager did not return an application path.");
  await smokeTestPackagedApp(output, config, platform, smokeTestTimeout(config));
  return output;
}

export async function createMacRelease(config: ResolvedDesktopConfig, options: MacReleaseOptions = {}): Promise<MacReleaseResult> {
  if (process.platform !== "darwin") throw new Error("macOS disk images must be created on macOS.");
  if (options.notarization && !options.signing) throw new Error("Notarization requires a signed application. Add a signing identity first.");
  const arch = options.arch ?? process.arch as "arm64" | "x64";
  const [packageRoot] = await packageDesktopApp(config, { platform: "darwin", arch, ...(options.signing ? { signing: options.signing } : {}) });
  if (!packageRoot) throw new Error("Electron Packager did not return an application path.");
  const appPath = await findMacApplication(packageRoot);
  if (options.smokeTest !== false) await smokeTestPackagedApp(packageRoot, config, "darwin", smokeTestTimeout(config));

  const outputDirectory = resolve(config.projectDirectory, config.packaging?.outputDirectory ?? "out");
  const fileName = `${config.app.id}-${config.app.version}-darwin-${arch}.dmg`;
  const diskImagePath = resolve(outputDirectory, fileName);
  await createMacDiskImage(appPath, diskImagePath, config.app.name);

  if (options.notarization) {
    await notarize({ appPath: diskImagePath, ...options.notarization });
  }

  const artifact = {
    kind: "dmg" as const,
    platform: "darwin" as const,
    arch,
    fileName,
    ...downloadUrl(config, fileName),
    bytes: (await stat(diskImagePath)).size,
    sha256: await sha256File(diskImagePath),
  };
  const manifest: DesktopReleaseManifest = {
    schemaVersion: 1,
    product: {
      id: config.app.id,
      name: config.app.name,
      version: config.app.version,
      ...(config.app.bundleId ? { bundleId: config.app.bundleId } : {}),
    },
    channel: config.updates?.channel ?? "stable",
    generatedAt: new Date().toISOString(),
    ...(config.packaging?.mac?.minimumSystemVersion ? { minimumSystemVersion: config.packaging.mac.minimumSystemVersion } : {}),
    security: { signed: Boolean(options.signing), notarized: Boolean(options.notarization) },
    artifacts: [artifact],
  };
  const manifestPath = resolve(outputDirectory, `${config.app.id}-${config.app.version}-darwin-${arch}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { appPath, diskImagePath, manifestPath, manifest };
}

export async function smokeTestPackagedApp(packageRoot: string, config: ResolvedDesktopConfig, platform: "darwin" | "win32" | "linux", timeoutMs = 30_000): Promise<void> {
  const executable = platform === "darwin"
    ? resolve(await findMacApplication(packageRoot), "Contents", "MacOS", config.app.id)
    : platform === "win32"
      ? resolve(packageRoot, `${config.app.id}.exe`)
      : resolve(packageRoot, config.app.id);
  const markerPath = resolve(tmpdir(), `vraxis-desktop-smoke-${randomUUID()}.json`);
  try {
    await new Promise<void>((resolveTest, reject) => {
      const child = spawn(executable, smokeTestLaunchArgs(platform), { env: { ...process.env, VRAXIS_DESKTOP_SMOKE: "1", VRAXIS_DESKTOP_SMOKE_FILE: markerPath }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let settled = false;
      let markerTimer: NodeJS.Timeout;
      let timer: NodeJS.Timeout;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(markerTimer);
        if (child.exitCode === null) child.kill("SIGTERM");
        error ? reject(error) : resolveTest();
      };
      child.stdout?.on("data", chunk => { output += String(chunk); });
      child.stderr?.on("data", chunk => { output += String(chunk); });
      child.once("error", error => finish(error));
      child.once("exit", async code => {
        if (code === 0 && (output.includes("[desktop:smoke]") || await smokeMarkerExists(markerPath))) finish();
        else finish(new Error(`The packaged app failed its smoke test.${output.trim() ? `\n${output.trim()}` : ""}`));
      });
      markerTimer = setInterval(() => { void smokeMarkerExists(markerPath).then(ready => { if (ready) finish(); }); }, 100);
      timer = setTimeout(() => finish(new Error(`The packaged app did not finish its smoke test within ${timeoutMs}ms.${output.trim() ? `\n${output.trim()}` : ""}`)), timeoutMs);
    });
  } finally {
    await rm(markerPath, { force: true });
  }
}

async function smokeMarkerExists(path: string): Promise<boolean> {
  try {
    const result = JSON.parse(await readFile(path, "utf8")) as { serviceHealthy?: unknown; directoryPickerReady?: unknown };
    return result.serviceHealthy === true && result.directoryPickerReady === true;
  } catch { return false; }
}

export function smokeTestTimeout(config: ResolvedDesktopConfig): number {
  if (config.source.kind !== "service") return 30_000;
  return (config.source.readyTimeoutMs ?? 30_000) + 30_000;
}

export function smokeTestLaunchArgs(platform: "darwin" | "win32" | "linux", ci = process.env.CI): readonly string[] {
  return platform === "linux" && ci === "true" ? ["--no-sandbox"] : [];
}

async function findMacApplication(packageRoot: string): Promise<string> {
  const entries = await readdir(packageRoot);
  const name = entries.find(entry => entry.endsWith(".app"));
  if (!name) throw new Error(`No macOS application was found in ${packageRoot}.`);
  return resolve(packageRoot, name);
}

async function createMacDiskImage(appPath: string, destination: string, volumeName: string): Promise<void> {
  const stage = await mkdtemp(resolve(tmpdir(), "vraxis-desktop-dmg-"));
  try {
    await mkdir(resolve(destination, ".."), { recursive: true });
    await cp(appPath, resolve(stage, basename(appPath)), { recursive: true });
    await symlink("/Applications", resolve(stage, "Applications"));
    await run("hdiutil", ["create", "-volname", volumeName, "-srcfolder", stage, "-ov", "-format", "UDZO", destination]);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, reject) => {
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
}

function downloadUrl(config: ResolvedDesktopConfig, fileName: string): { downloadUrl?: string } {
  if (config.updates?.provider === "github" && config.updates.owner && config.updates.repository) {
    return { downloadUrl: `https://github.com/${config.updates.owner}/${config.updates.repository}/releases/download/v${config.app.version}/${fileName}` };
  }
  if (config.updates?.provider === "url" && config.updates.url) return { downloadUrl: new URL(fileName, config.updates.url.endsWith("/") ? config.updates.url : `${config.updates.url}/`).href };
  return {};
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let errorOutput = "";
    child.stderr?.on("data", chunk => { errorOutput += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolveRun() : reject(new Error(`${command} failed with exit code ${code}.${errorOutput.trim() ? `\n${errorOutput.trim()}` : ""}`)));
  });
}
