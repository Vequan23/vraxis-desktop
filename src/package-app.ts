import { packager } from "@electron/packager";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ResolvedDesktopConfig } from "./types.js";

export interface PackageOptions {
  platform?: "darwin" | "win32" | "linux";
  arch?: "arm64" | "x64" | "universal";
  signing?: {
    identity: string;
    entitlements?: string;
  };
}

export async function packageDesktopApp(config: ResolvedDesktopConfig, options: PackageOptions = {}): Promise<readonly string[]> {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "vraxis-desktop-package-"));
  const stage = resolve(temporaryRoot, "app");
  try {
    await mkdir(stage, { recursive: true });
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const distRoot = basename(moduleDirectory) === "src" ? resolve(moduleDirectory, "../dist") : moduleDirectory;
    await cp(distRoot, resolve(stage, "dist"), { recursive: true });
    const stagedConfig = structuredClone(config);
    stagedConfig.configPath = resolve(stage, "desktop.config.json");
    stagedConfig.projectDirectory = stage;
    if (config.source.kind === "static") {
      const sourceDirectory = isAbsolute(config.source.directory) ? config.source.directory : resolve(config.projectDirectory, config.source.directory);
      await cp(sourceDirectory, resolve(stage, "app-content"), { recursive: true });
      stagedConfig.source = { ...config.source, directory: "app-content" };
    }
    let extraResource: string | undefined;
    if (config.source.kind === "service" && config.source.bundle) {
      const sourceDirectory = isAbsolute(config.source.bundle.directory) ? config.source.bundle.directory : resolve(config.projectDirectory, config.source.bundle.directory);
      extraResource = resolve(temporaryRoot, "vraxis-service");
      await cp(sourceDirectory, extraResource, { recursive: true });
      stagedConfig.source = { ...config.source, bundle: { ...config.source.bundle, directory: "vraxis-service" } };
    }
    await writeFile(resolve(stage, "desktop.config.json"), `${JSON.stringify(stagedConfig, null, 2)}\n`);
    await writeFile(resolve(stage, "package.json"), `${JSON.stringify({
      name: config.app.id,
      productName: config.app.name,
      version: config.app.version,
      type: "module",
      main: "dist/runtime/main.js",
      description: config.app.description,
    }, null, 2)}\n`);
    await mkdir(resolve(config.projectDirectory, config.packaging?.outputDirectory ?? "out"), { recursive: true });
    const platform = options.platform ?? process.platform as "darwin" | "win32" | "linux";
    const icon = platformIcon(config, platform);
    const entitlements = options.signing?.entitlements;
    const require = createRequire(import.meta.url);
    const electronVersion = (require("electron/package.json") as { version: string }).version;
    const paths = await packager({
      dir: stage,
      name: config.app.name,
      executableName: config.app.id,
      appVersion: config.app.version,
      buildVersion: config.app.version,
      out: resolve(config.projectDirectory, config.packaging?.outputDirectory ?? "out"),
      overwrite: config.packaging?.overwrite ?? true,
      asar: config.packaging?.asar ?? true,
      platform,
      arch: options.arch ?? process.arch as "arm64" | "x64",
      electronVersion,
      ...(config.app.bundleId ? { appBundleId: config.app.bundleId } : {}),
      ...(config.packaging?.appCategoryType ? { appCategoryType: config.packaging.appCategoryType } : {}),
      ...(platform === "darwin" && config.packaging?.mac?.minimumSystemVersion ? { extendInfo: { LSMinimumSystemVersion: config.packaging.mac.minimumSystemVersion } } : {}),
      ...(icon ? { icon } : {}),
      ...(extraResource ? { extraResource } : {}),
      ...(platform === "darwin" && options.signing ? { osxSign: {
        identity: options.signing.identity,
        continueOnError: false,
        ...(entitlements ? { optionsForFile: (file: string) => file.endsWith(".app") ? { entitlements } : {} } : {}),
      } } : {}),
      ...(config.integrations?.protocols?.length ? { protocols: config.integrations.protocols.map(item => ({ name: item.name ?? config.app.name, schemes: [item.scheme] })) } : {}),
    });
    return paths;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function platformIcon(config: ResolvedDesktopConfig, platform: "darwin" | "win32" | "linux"): string | undefined {
  const value = platform === "darwin" ? config.branding?.macIcon : platform === "win32" ? config.branding?.windowsIcon : config.branding?.linuxIcon;
  const fallback = value ?? config.branding?.icon;
  if (!fallback) return undefined;
  return isAbsolute(fallback) ? fallback : resolve(config.projectDirectory, fallback);
}
