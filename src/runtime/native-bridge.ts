import { isAbsolute } from "node:path";

export const directoryPickerChannel = "vraxis-desktop:choose-directory";

export interface DirectoryPickerConfig {
  title?: string;
  buttonLabel?: string;
}

export interface DirectoryPickerResult {
  cancelled: boolean;
  path?: string;
}

export interface VraxisDesktopBridge {
  chooseDirectory(): Promise<DirectoryPickerResult>;
}

interface NativeDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface NativeDialogOptions {
  title: string;
  buttonLabel: string;
  properties: Array<"openDirectory" | "createDirectory">;
}

export async function chooseDirectory(
  config: DirectoryPickerConfig,
  openDialog: (options: NativeDialogOptions) => Promise<NativeDialogResult>,
): Promise<DirectoryPickerResult> {
  const result = await openDialog({
    title: config.title?.trim() || "Choose a folder",
    buttonLabel: config.buttonLabel?.trim() || "Choose folder",
    properties: ["openDirectory", "createDirectory"],
  });
  const path = result.filePaths[0];
  if (result.canceled || !path) return { cancelled: true };
  if (!isAbsolute(path)) throw new Error("The native directory picker returned an invalid path.");
  return { cancelled: false, path };
}
