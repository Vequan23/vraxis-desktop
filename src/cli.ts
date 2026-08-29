#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findConfigPath, loadDesktopConfig } from "./config.js";
import { packageDesktopApp } from "./package-app.js";
import { createMacRelease, testPackagedDesktopApp, type NotarizationCredentials } from "./release.js";
import type { ConfigInspection } from "./types.js";

const help = `Vraxis Desktop — package trusted web apps

Usage
  vraxis-desktop init [path]       Create a starter config
  vraxis-desktop validate [config] Check config and assets
  vraxis-desktop inspect [config]  Show the resolved config
  vraxis-desktop dev [config]      Open the app in Electron
  vraxis-desktop package [config]  Build a desktop application
  vraxis-desktop test-package      Build and launch a packaged smoke test
  vraxis-desktop release [config]  Build a macOS disk image and release manifest

Options
  --json                            Return machine-readable output
  --platform <darwin|win32|linux>  Choose the package platform
  --arch <arm64|x64|universal>     Choose the package architecture
  --sign <identity>                 Sign with an Apple Developer ID identity
  --notarize                        Notarize with Apple credentials from the environment
  --no-smoke                        Skip the packaged application smoke test
  -h, --help                        Show this help`;

export async function runCli(args = process.argv.slice(2), cwd = process.cwd()): Promise<number> {
  const command = args[0];
  if (!command || ["-h", "--help", "help"].includes(command)) { console.log(help); return 0; }
  if (command === "init") return initConfig(resolve(cwd, positional(args.slice(1))[0] ?? "vraxis.desktop.config.mjs"));
  if (!["validate", "inspect", "dev", "package", "test-package", "release"].includes(command)) { console.error(`Unknown command: ${command}\n\n${help}`); return 1; }
  const requested = positional(args.slice(1))[0];
  let configPath: string;
  try { configPath = await findConfigPath(cwd, requested); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
  const inspection = await loadDesktopConfig(configPath);
  if (command === "inspect" && args.includes("--json")) { console.log(JSON.stringify(inspection, null, 2)); return inspection.valid ? 0 : 1; }
  printInspection(inspection);
  if (!inspection.valid || !inspection.config) return 1;
  if (command === "validate" || command === "inspect") return 0;
  if (command === "dev") return launchElectron(configPath);
  const platform = option(args, "--platform") as "darwin" | "win32" | "linux" | undefined;
  const arch = option(args, "--arch") as "arm64" | "x64" | "universal" | undefined;
  if (command === "release") {
    const identity = option(args, "--sign");
    const signing = identity ? {
      identity,
      ...(inspection.config.packaging?.mac?.entitlements ? { entitlements: resolve(inspection.config.projectDirectory, inspection.config.packaging.mac.entitlements) } : {}),
    } : undefined;
    const notarization = args.includes("--notarize") ? notarizationCredentials(process.env) : undefined;
    const result = await createMacRelease(inspection.config, {
      ...(arch ? { arch } : {}),
      ...(signing ? { signing } : {}),
      ...(notarization ? { notarization } : {}),
      smokeTest: !args.includes("--no-smoke"),
    });
    if (args.includes("--json")) console.log(JSON.stringify(result.manifest, null, 2));
    else {
      console.log(`Released ${inspection.config.app.name}`);
      console.log(result.diskImagePath);
      console.log(result.manifestPath);
      if (!result.manifest.security.signed) console.warn("Unsigned release. Add --sign after you have an Apple Developer ID certificate.");
    }
    return 0;
  }
  if (command === "test-package") {
    const output = await testPackagedDesktopApp(inspection.config, { ...(platform ? { platform } : {}), ...(arch ? { arch } : {}) });
    console.log(`Smoke test passed for ${inspection.config.app.name}`);
    console.log(output);
    return 0;
  }
  const outputs = await packageDesktopApp(inspection.config, { ...(platform ? { platform } : {}), ...(arch ? { arch } : {}) });
  console.log(`Built ${inspection.config.app.name}`);
  outputs.forEach(output => console.log(output));
  return 0;
}

export function notarizationCredentials(environment: NodeJS.ProcessEnv): NotarizationCredentials {
  if (environment.APPLE_KEYCHAIN_PROFILE) return { keychainProfile: environment.APPLE_KEYCHAIN_PROFILE };
  if (environment.APPLE_ID && environment.APPLE_APP_SPECIFIC_PASSWORD && environment.APPLE_TEAM_ID) {
    return { appleId: environment.APPLE_ID, appleIdPassword: environment.APPLE_APP_SPECIFIC_PASSWORD, teamId: environment.APPLE_TEAM_ID };
  }
  throw new Error("Notarization needs APPLE_KEYCHAIN_PROFILE or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.");
}

function launchElectron(configPath: string): Promise<number> {
  const require = createRequire(import.meta.url);
  const electron = require("electron") as string;
  const runtime = fileURLToPath(new URL("./runtime/main.js", import.meta.url));
  return new Promise((resolveExit, reject) => {
    const child = spawn(electron, [runtime], { stdio: "inherit", env: { ...process.env, VRAXIS_DESKTOP_CONFIG: configPath } });
    child.once("error", reject);
    child.once("exit", code => resolveExit(code ?? 1));
  });
}

async function initConfig(path: string): Promise<number> {
  try { await access(path); console.error(`${path} already exists.`); return 1; } catch { /* create it */ }
  const template = `import { defineDesktopApp } from "@vraxis/desktop";\n\nexport default defineDesktopApp({\n  schemaVersion: 1,\n  app: { id: "my-app", name: "My App", bundleId: "io.example.my-app" },\n  source: { kind: "remote", url: "https://example.com" },\n  branding: { icon: "./assets/icon.png" },\n  window: { width: 1200, height: 800 },\n  security: { externalLinks: "browser" },\n});\n`;
  await writeFile(path, template, { flag: "wx" });
  console.log(`Created ${path}`);
  return 0;
}

function printInspection(inspection: ConfigInspection): void {
  for (const error of inspection.errors) console.error(`Error · ${error.path}: ${error.message}`);
  for (const warning of inspection.warnings) console.warn(`Check · ${warning.path}: ${warning.message}`);
  if (inspection.valid && inspection.config) console.log(`${inspection.config.app.name} is ready for desktop development.`);
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : args.find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function positional(args: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (["--platform", "--arch", "--sign"].includes(args[index]!)) { index += 1; continue; }
    if (!args[index]!.startsWith("--")) values.push(args[index]!);
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli().catch(error => { console.error(error instanceof Error ? error.message : String(error)); return 1; });
}
