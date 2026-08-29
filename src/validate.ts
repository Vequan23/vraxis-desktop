import { access, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ConfigInspection, ConfigIssue, DesktopConfig, ResolvedDesktopConfig } from "./types.js";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const bundlePattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const protocolPattern = /^[a-z][a-z0-9+.-]*$/;
const secretPattern = /(api[_-]?key|token|secret|password|private[_-]?key)/i;
const environmentPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const permissions = new Set(["clipboard-read", "display-capture", "fullscreen", "geolocation", "media", "mediaKeySystem", "midi", "midiSysex", "notifications", "openExternal", "pointerLock"]);

export function defineDesktopApp(config: DesktopConfig): DesktopConfig {
  return config;
}

export function validateDesktopConfig(value: unknown): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const record = asRecord(value);
  if (!record) return [{ path: "config", message: "Export a desktop configuration object." }];
  if (record.schemaVersion !== 1) issue(issues, "schemaVersion", "Use schema version 1.");

  const app = asRecord(record.app);
  if (!app) issue(issues, "app", "Add the app identity.");
  else {
    if (typeof app.id !== "string" || !idPattern.test(app.id)) issue(issues, "app.id", "Use lowercase words separated by hyphens.");
    if (typeof app.name !== "string" || !app.name.trim()) issue(issues, "app.name", "Add the name people will see.");
    if (app.author !== undefined && (typeof app.author !== "string" || !app.author.trim())) issue(issues, "app.author", "Add the person or organization that publishes the app.");
    if (app.description !== undefined && typeof app.description !== "string") issue(issues, "app.description", "Use plain text for the app description.");
    if (app.version !== undefined && (typeof app.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(app.version))) issue(issues, "app.version", "Use a semantic version such as 1.0.0.");
    if (app.bundleId !== undefined && (typeof app.bundleId !== "string" || !bundlePattern.test(app.bundleId))) issue(issues, "app.bundleId", "Use a reverse-domain identifier such as io.vraxis.read.");
  }

  const source = asRecord(record.source);
  if (!source || !["remote", "static", "service"].includes(String(source.kind))) {
    issue(issues, "source", "Choose remote, static, or service content.");
  } else if (source.kind === "remote") {
    validateUrl(issues, "source.url", source.url, { httpsOnly: true });
  } else if (source.kind === "static") {
    if (typeof source.directory !== "string" || !source.directory.trim()) issue(issues, "source.directory", "Choose the built web directory.");
    if (source.index !== undefined && (typeof source.index !== "string" || !source.index.trim())) issue(issues, "source.index", "Choose an entry file such as index.html.");
    if (typeof source.index === "string" && (isAbsolute(source.index) || source.index.split(/[\\/]/).includes(".."))) issue(issues, "source.index", "Keep the entry file inside the built web directory.");
  } else {
    if (source.authentication !== undefined && source.authentication !== "desktop-token") issue(issues, "source.authentication", "Choose desktop-token authentication.");
    const bundle = asRecord(source.bundle);
    const hasCommand = typeof source.command === "string" && Boolean(source.command.trim());
    if (hasCommand === Boolean(bundle)) issue(issues, "source", "Choose one service launch method: command or bundle.");
    if (source.command !== undefined && !hasCommand) issue(issues, "source.command", "Add the service command without shell operators.");
    if (bundle) {
      if (typeof bundle.directory !== "string" || !bundle.directory.trim()) issue(issues, "source.bundle.directory", "Choose the prepared service directory.");
      if (typeof bundle.entry !== "string" || !bundle.entry.trim() || unsafeRelativePath(bundle.entry)) issue(issues, "source.bundle.entry", "Keep the service entry file inside its directory.");
      if (bundle.runtime !== undefined && bundle.runtime !== "node") issue(issues, "source.bundle.runtime", "Choose the node runtime.");
    }
    if (source.args !== undefined && (!Array.isArray(source.args) || source.args.some(item => typeof item !== "string"))) issue(issues, "source.args", "Use an array of command arguments.");
    validateUrl(issues, "source.url", source.url, { localOnly: true, allowPortToken: true });
    if (source.healthcheck !== undefined) validateUrl(issues, "source.healthcheck", source.healthcheck, { localOnly: true, allowPortToken: true });
    if (source.port !== undefined && (!Number.isInteger(source.port) || Number(source.port) < 0 || Number(source.port) > 65_535)) issue(issues, "source.port", "Choose a port from 0 to 65535. Use 0 to find one automatically.");
    if (source.readyTimeoutMs !== undefined && (!Number.isInteger(source.readyTimeoutMs) || Number(source.readyTimeoutMs) < 100)) issue(issues, "source.readyTimeoutMs", "Use at least 100 milliseconds.");
    const environment = asRecord(source.environment);
    if (environment?.inherit !== undefined && (!Array.isArray(environment.inherit) || environment.inherit.some(name => typeof name !== "string" || !environmentPattern.test(name)))) issue(issues, "source.environment.inherit", "Use an array of environment variable names.");
    const set = asRecord(environment?.set);
    for (const [key, setting] of Object.entries(set ?? {})) {
      if (!environmentPattern.test(key)) issue(issues, `source.environment.set.${key}`, "Use a valid environment variable name.");
      if (typeof setting !== "string") issue(issues, `source.environment.set.${key}`, "Environment values must be strings.");
      if (secretPattern.test(key)) issue(issues, `source.environment.set.${key}`, "Do not store secrets in the desktop config. Inherit this variable at runtime instead.");
    }
  }

  const security = asRecord(record.security);
  if (security?.externalLinks !== undefined && !["browser", "deny"].includes(String(security.externalLinks))) issue(issues, "security.externalLinks", "Choose browser or deny.");
  if (security?.allowedNavigationOrigins !== undefined) {
    if (!Array.isArray(security.allowedNavigationOrigins)) issue(issues, "security.allowedNavigationOrigins", "Use an array of HTTPS or local origins.");
    else for (const [index, origin] of security.allowedNavigationOrigins.entries()) validateOrigin(issues, `security.allowedNavigationOrigins.${index}`, origin);
  }
  if (security?.permissions !== undefined) {
    if (!Array.isArray(security.permissions)) issue(issues, "security.permissions", "Use an array of allowed browser permissions.");
    else security.permissions.forEach((permission, index) => { if (typeof permission !== "string" || !permissions.has(permission)) issue(issues, `security.permissions.${index}`, "Choose a supported browser permission."); });
  }

  const window = asRecord(record.window);
  for (const key of ["width", "height", "minWidth", "minHeight"] as const) {
    const dimension = window?.[key];
    if (dimension !== undefined && (!Number.isInteger(dimension) || Number(dimension) < 200 || Number(dimension) > 20_000)) issue(issues, `window.${key}`, "Choose a whole number from 200 to 20000.");
  }
  if (window?.titleBarStyle !== undefined && !["default", "hidden", "hiddenInset"].includes(String(window.titleBarStyle))) issue(issues, "window.titleBarStyle", "Choose default, hidden, or hiddenInset.");

  const branding = asRecord(record.branding);
  for (const [key, extensions] of [["icon", [".png", ".icns", ".ico", ".svg"]], ["macIcon", [".icns"]], ["windowsIcon", [".ico"]], ["linuxIcon", [".png"]], ["logo", [".png", ".svg"]]] as const) {
    const asset = branding?.[key];
    if (asset !== undefined && (typeof asset !== "string" || !(extensions as readonly string[]).includes(extname(asset).toLowerCase()))) issue(issues, `branding.${key}`, `Use ${extensions.join(" or ")}.`);
  }

  const integrations = asRecord(record.integrations);
  const directoryPicker = asRecord(integrations?.directoryPicker);
  if (integrations?.directoryPicker !== undefined && !directoryPicker) issue(issues, "integrations.directoryPicker", "Use an object to configure the directory picker.");
  if (directoryPicker) {
    if (source?.kind === "remote") issue(issues, "integrations.directoryPicker", "The native directory picker is available only to static and local-service apps.");
    for (const key of ["title", "buttonLabel"] as const) {
      const label = directoryPicker[key];
      if (label !== undefined && (typeof label !== "string" || !label.trim() || label.length > 120)) issue(issues, `integrations.directoryPicker.${key}`, "Use plain text from 1 to 120 characters.");
    }
  }
  if (Array.isArray(integrations?.protocols)) {
    integrations.protocols.forEach((entry, index) => {
      const protocol = asRecord(entry);
      if (!protocol || typeof protocol.scheme !== "string" || !protocolPattern.test(protocol.scheme)) issue(issues, `integrations.protocols.${index}.scheme`, "Use a lowercase URL scheme such as vraxis-read.");
    });
  }
  if (integrations?.fileAssociations !== undefined) {
    if (!Array.isArray(integrations.fileAssociations)) issue(issues, "integrations.fileAssociations", "Use an array of file associations.");
    else integrations.fileAssociations.forEach((entry, index) => {
      const association = asRecord(entry);
      if (!association || !Array.isArray(association.extensions) || !association.extensions.length || association.extensions.some(extension => typeof extension !== "string" || !/^[A-Za-z0-9][A-Za-z0-9+_-]*$/.test(extension))) issue(issues, `integrations.fileAssociations.${index}.extensions`, "Use extensions without a leading dot.");
      if (association?.role !== undefined && !["Editor", "Viewer", "Shell", "None"].includes(String(association.role))) issue(issues, `integrations.fileAssociations.${index}.role`, "Choose Editor, Viewer, Shell, or None.");
    });
  }

  const packaging = asRecord(record.packaging);
  if (packaging?.outputDirectory !== undefined && (typeof packaging.outputDirectory !== "string" || !packaging.outputDirectory.trim())) issue(issues, "packaging.outputDirectory", "Choose an output directory.");
  for (const key of ["asar", "overwrite"] as const) if (packaging?.[key] !== undefined && typeof packaging[key] !== "boolean") issue(issues, `packaging.${key}`, "Use true or false.");
  const mac = asRecord(packaging?.mac);
  if (mac?.minimumSystemVersion !== undefined && (typeof mac.minimumSystemVersion !== "string" || !/^\d+(?:\.\d+){1,2}$/.test(mac.minimumSystemVersion))) issue(issues, "packaging.mac.minimumSystemVersion", "Use a macOS version such as 13.0.");
  if (mac?.entitlements !== undefined && (typeof mac.entitlements !== "string" || !mac.entitlements.trim())) issue(issues, "packaging.mac.entitlements", "Choose an entitlements plist file.");

  const updates = asRecord(record.updates);
  if (updates) {
    if (!["github", "url"].includes(String(updates.provider))) issue(issues, "updates.provider", "Choose github or url.");
    if (updates.provider === "github" && (typeof updates.owner !== "string" || typeof updates.repository !== "string")) issue(issues, "updates", "Add the GitHub owner and repository.");
    if (updates.provider === "url") validateUrl(issues, "updates.url", updates.url, { httpsOnly: true });
  }
  return issues;
}

export async function inspectDesktopConfig(value: unknown, configPath: string): Promise<ConfigInspection> {
  const errors = [...validateDesktopConfig(value)];
  if (errors.length) return { valid: false, errors, warnings: [] };
  const config = value as DesktopConfig;
  const projectDirectory = resolve(configPath, "..");
  const version = config.app.version ?? await readPackageVersion(projectDirectory) ?? "0.1.0";
  const resolved: ResolvedDesktopConfig = { ...config, configPath: resolve(configPath), projectDirectory, app: { ...config.app, version } };
  const warnings: ConfigIssue[] = [];

  if (config.source.kind === "static") await assetExists(errors, "source.directory", resolveFrom(projectDirectory, config.source.directory));
  if (config.source.kind === "service" && config.source.bundle) await inspectBundleEntry(errors, projectDirectory, config.source.bundle.directory, config.source.bundle.entry);
  const branding = config.branding;
  for (const key of ["icon", "macIcon", "windowsIcon", "linuxIcon", "logo"] as const) {
    const asset = branding?.[key];
    if (asset) await assetExists(errors, `branding.${key}`, resolveFrom(projectDirectory, asset));
  }
  if (config.packaging?.mac?.entitlements) await assetExists(errors, "packaging.mac.entitlements", resolveFrom(projectDirectory, config.packaging.mac.entitlements));
  if (!branding?.icon && !branding?.macIcon && !branding?.windowsIcon && !branding?.linuxIcon) warnings.push({ path: "branding", message: "Add a 1024×1024 master icon and platform icons before release." });
  if (config.source.kind === "remote") warnings.push({ path: "source", message: "Hosted mode depends on the website and does not work offline." });
  if (config.source.kind === "service" && config.source.command && !config.source.command.startsWith(".") && !isAbsolute(config.source.command)) warnings.push({ path: "source.command", message: "The service command must be installed on the destination machine." });
  if (!config.updates) warnings.push({ path: "updates", message: "Automatic updates are not configured." });
  else warnings.push({ path: "updates", message: "Update metadata is recorded, but automatic update delivery is not enabled yet." });
  if (config.integrations?.fileAssociations?.length) warnings.push({ path: "integrations.fileAssociations", message: "File associations are recorded, but installer registration is not enabled yet." });

  return { valid: errors.length === 0, config: resolved, errors, warnings };
}

function validateUrl(issues: ConfigIssue[], path: string, value: unknown, options: { httpsOnly?: boolean; localOnly?: boolean; allowPortToken?: boolean }): void {
  if (typeof value !== "string") return issue(issues, path, "Add a valid URL.");
  const candidate = options.allowPortToken ? value.replaceAll("{port}", "4314") : value;
  try {
    const url = new URL(candidate);
    if (options.httpsOnly && url.protocol !== "https:") issue(issues, path, "Use an HTTPS address.");
    if (options.localOnly && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) issue(issues, path, "Local services must use a loopback address.");
  } catch { issue(issues, path, "Add a valid URL."); }
}

function validateOrigin(issues: ConfigIssue[], path: string, value: unknown): void {
  if (typeof value !== "string") return issue(issues, path, "Add a valid origin.");
  try {
    const url = new URL(value);
    if (url.origin !== value) issue(issues, path, "Use only the origin, without a path.");
    if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) issue(issues, path, "Use HTTPS unless this is a loopback origin.");
  } catch { issue(issues, path, "Add a valid origin."); }
}

async function readPackageVersion(projectDirectory: string): Promise<string | null> {
  try {
    const value = JSON.parse(await readFile(resolve(projectDirectory, "package.json"), "utf8")) as { version?: unknown };
    return typeof value.version === "string" ? value.version : null;
  } catch { return null; }
}

async function assetExists(issues: ConfigIssue[], path: string, asset: string): Promise<void> {
  await access(asset).catch(() => issue(issues, path, `Could not find ${asset}.`));
}

async function inspectBundleEntry(issues: ConfigIssue[], projectDirectory: string, directory: string, entry: string): Promise<void> {
  const bundleRoot = resolveFrom(projectDirectory, directory);
  try {
    const canonicalRoot = await realpath(bundleRoot);
    const canonicalEntry = await realpath(resolve(bundleRoot, entry));
    const fromRoot = relative(canonicalRoot, canonicalEntry);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) issue(issues, "source.bundle.entry", "Keep the service entry file inside its directory, including symlink targets.");
  } catch {
    issue(issues, "source.bundle.entry", `Could not find ${resolve(bundleRoot, entry)}.`);
  }
}

function resolveFrom(projectDirectory: string, value: string): string {
  return isAbsolute(value) ? value : resolve(projectDirectory, value);
}

function unsafeRelativePath(value: string): boolean {
  return isAbsolute(value) || value.split(/[\\/]/).includes("..");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function issue(issues: ConfigIssue[], path: string, message: string): void {
  issues.push({ path, message });
}
