export type DesktopSource = RemoteSource | StaticSource | ServiceSource;

export interface RemoteSource {
  kind: "remote";
  url: string;
}

export interface StaticSource {
  kind: "static";
  directory: string;
  index?: string;
}

export interface ServiceSource {
  kind: "service";
  authentication?: "desktop-token";
  command?: string;
  bundle?: {
    directory: string;
    entry: string;
    runtime?: "node";
  };
  args?: readonly string[];
  url: string;
  healthcheck?: string;
  port?: number;
  portEnvironment?: string;
  readyTimeoutMs?: number;
  environment?: {
    inherit?: readonly string[];
    set?: Readonly<Record<string, string>>;
  };
}

export interface DesktopConfig {
  schemaVersion: 1;
  app: {
    id: string;
    name: string;
    version?: string;
    description?: string;
    bundleId?: string;
  };
  source: DesktopSource;
  branding?: {
    icon?: string;
    macIcon?: string;
    windowsIcon?: string;
    linuxIcon?: string;
    logo?: string;
    backgroundColor?: string;
  };
  window?: {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    resizable?: boolean;
    fullscreen?: boolean;
    titleBarStyle?: "default" | "hidden" | "hiddenInset";
  };
  security?: {
    allowedNavigationOrigins?: readonly string[];
    externalLinks?: "browser" | "deny";
    permissions?: readonly DesktopPermission[];
  };
  integrations?: {
    directoryPicker?: {
      title?: string;
      buttonLabel?: string;
    };
    protocols?: readonly { scheme: string; name?: string }[];
    fileAssociations?: readonly { extensions: readonly string[]; name?: string; description?: string; role?: "Editor" | "Viewer" | "Shell" | "None" }[];
  };
  packaging?: {
    outputDirectory?: string;
    asar?: boolean;
    overwrite?: boolean;
    appCategoryType?: string;
    mac?: {
      minimumSystemVersion?: string;
      entitlements?: string;
    };
  };
  updates?: {
    provider: "github" | "url";
    owner?: string;
    repository?: string;
    url?: string;
    channel?: string;
  };
}

export interface ReleaseArtifact {
  kind: "dmg";
  platform: "darwin";
  arch: "arm64" | "x64" | "universal";
  fileName: string;
  downloadUrl?: string;
  bytes: number;
  sha256: string;
}

export interface DesktopReleaseManifest {
  schemaVersion: 1;
  product: {
    id: string;
    name: string;
    version: string;
    bundleId?: string;
  };
  channel: string;
  generatedAt: string;
  minimumSystemVersion?: string;
  security: {
    signed: boolean;
    notarized: boolean;
  };
  artifacts: readonly ReleaseArtifact[];
}

export type DesktopPermission =
  | "clipboard-read"
  | "display-capture"
  | "fullscreen"
  | "geolocation"
  | "media"
  | "mediaKeySystem"
  | "midi"
  | "midiSysex"
  | "notifications"
  | "openExternal"
  | "pointerLock";

export interface ResolvedDesktopConfig extends DesktopConfig {
  configPath: string;
  projectDirectory: string;
  app: DesktopConfig["app"] & { version: string };
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export interface ConfigInspection {
  valid: boolean;
  config?: ResolvedDesktopConfig;
  errors: readonly ConfigIssue[];
  warnings: readonly ConfigIssue[];
}
