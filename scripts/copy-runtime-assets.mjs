import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("src/runtime/preload.cjs");
const destination = resolve("dist/runtime/preload.cjs");
await mkdir(resolve(destination, ".."), { recursive: true });
await copyFile(source, destination);
