import { spawnSync } from "node:child_process";
import {
	access,
	chmod,
	cp,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(desktopDirectory, "../..");
const webDirectory = join(workspaceRoot, "apps/web");
const outputDirectory = join(workspaceRoot, "dist");
const appDirectory = join(outputDirectory, "ClipForge.app");
const contentsDirectory = join(appDirectory, "Contents");
const macOSDirectory = join(contentsDirectory, "MacOS");
const resourcesDirectory = join(contentsDirectory, "Resources");
const serverDirectory = join(resourcesDirectory, "server");
const runtimeDirectory = join(resourcesDirectory, "runtime");
const skipWebBuild = process.argv.includes("--skip-web-build");

const run = (command, args, options = {}) => {
	const result = spawnSync(command, args, {
		cwd: workspaceRoot,
		stdio: "inherit",
		env: process.env,
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} exited with status ${result.status ?? "unknown"}`,
		);
	}
};

const ensureExists = async (path, label) => {
	try {
		await access(path, constants.R_OK);
	} catch {
		throw new Error(`${label} is missing at ${path}`);
	}
};

if (!skipWebBuild) {
	console.log("Building ClipForge web application for macOS...");
	run(join(workspaceRoot, "node_modules/.bin/next"), ["build", "--webpack"], {
		cwd: webDirectory,
		env: {
			...process.env,
			NODE_ENV: "production",
			CLIPFORGE_MODE: "local",
			NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:32145",
			NEXT_PUBLIC_ENABLE_CLIPFORGE_AUTO_EDIT: "true",
			NEXT_PUBLIC_ENABLE_CLIPFORGE_CHAT: "true",
			NEXT_PUBLIC_CLIPFORGE_CHAT_PLANNER_MODE: "auto",
			NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED: "true",
		},
	});
}

const standaloneDirectory = join(webDirectory, ".next/standalone");
const staticDirectory = join(webDirectory, ".next/static");
await ensureExists(
	join(standaloneDirectory, "apps/web/server.js"),
	"Next standalone server",
);
await rm(join(webDirectory, ".next/cache"), { recursive: true, force: true });

console.log("Packaging native application bundle...");
await rm(appDirectory, { recursive: true, force: true });
await mkdir(macOSDirectory, { recursive: true });
await mkdir(resourcesDirectory, { recursive: true });
await cp(standaloneDirectory, serverDirectory, {
	recursive: true,
	dereference: true,
});
await mkdir(join(serverDirectory, "apps/web/.next"), { recursive: true });
await cp(staticDirectory, join(serverDirectory, "apps/web/.next/static"), {
	recursive: true,
});
await cp(
	join(webDirectory, "public"),
	join(serverDirectory, "apps/web/public"),
	{ recursive: true },
);

const nodeBinary = await realpath(process.execPath);
await mkdir(runtimeDirectory, { recursive: true });
await cp(nodeBinary, join(runtimeDirectory, "node"));
await chmod(join(runtimeDirectory, "node"), 0o755);
await cp(
	join(desktopDirectory, "Info.plist"),
	join(contentsDirectory, "Info.plist"),
);
await mkdir(join(resourcesDirectory, "en.lproj"), { recursive: true });
await cp(
	join(desktopDirectory, "en.lproj/InfoPlist.strings"),
	join(resourcesDirectory, "en.lproj/InfoPlist.strings"),
);

run(
	"xcrun",
	[
		"swiftc",
		"-parse-as-library",
		"-swift-version",
		"5",
		"-O",
		"-target",
		"arm64-apple-macos13.0",
		"-framework",
		"Cocoa",
		"-framework",
		"WebKit",
		join(desktopDirectory, "ClipForgeApp.swift"),
		"-o",
		join(macOSDirectory, "ClipForge"),
	],
	{
		env: {
			...process.env,
			CLANG_MODULE_CACHE_PATH: join(outputDirectory, "clang-module-cache"),
			SWIFT_MODULECACHE_PATH: join(outputDirectory, "swift-module-cache"),
		},
	},
);
await chmod(join(macOSDirectory, "ClipForge"), 0o755);

await cp(
	join(desktopDirectory, "ClipForge.icns"),
	join(resourcesDirectory, "ClipForge.icns"),
);

await writeFile(join(contentsDirectory, "PkgInfo"), "APPL????");
run("codesign", ["--force", "--deep", "--sign", "-", appDirectory]);

const plist = await readFile(join(contentsDirectory, "Info.plist"), "utf8");
if (!plist.includes("com.clipforge.desktop")) {
	throw new Error("Packaged Info.plist is invalid");
}

console.log(`Built ${appDirectory}`);
