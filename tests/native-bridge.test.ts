import { describe, expect, it } from "vitest";
import { chooseDirectory } from "../src/runtime/native-bridge.js";

describe("native directory picker bridge", () => {
  it("returns only the absolute directory selected by the user", async () => {
    let received: unknown;
    const result = await chooseDirectory(
      { title: " Choose a library ", buttonLabel: " Observe folder " },
      async options => {
        received = options;
        return { canceled: false, filePaths: [process.platform === "win32" ? "C:\\Books" : "/Users/reader/Books"] };
      },
    );
    expect(received).toEqual({
      title: "Choose a library",
      buttonLabel: "Observe folder",
      properties: ["openDirectory", "createDirectory"],
    });
    expect(result.cancelled).toBe(false);
    expect(result.path).toBe(process.platform === "win32" ? "C:\\Books" : "/Users/reader/Books");
  });

  it("does not return a path after cancellation", async () => {
    await expect(chooseDirectory({}, async () => ({ canceled: true, filePaths: [] }))).resolves.toEqual({ cancelled: true });
  });

  it("rejects a non-absolute path returned by the native boundary", async () => {
    await expect(chooseDirectory({}, async () => ({ canceled: false, filePaths: ["relative/books"] }))).rejects.toThrow("invalid path");
  });
});
