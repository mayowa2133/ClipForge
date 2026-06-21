import { chmod, copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const source = resolve(workspaceRoot, process.argv[2] ?? "apps/web/.env.local");
const targetDirectory = join(workspaceRoot, "dist");
const target = join(targetDirectory, "ClipForge.env");

await mkdir(targetDirectory, { recursive: true });
await copyFile(source, target);
await chmod(target, 0o600);
console.log(`Configured ClipForge desktop from ${source}`);
console.log(`Credentials remain local at ${target}`);
