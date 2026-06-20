import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
	process.exit(0);
}

const rootDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const nodeGypPath = path.join(
	rootDirectory,
	"node_modules",
	"node-gyp",
	"bin",
	"node-gyp.js",
);
const require = createRequire(import.meta.url);

const nativeModules = [
	{
		name: "macos-alias",
		outputPath: path.join("build", "Release", "volume.node"),
	},
	{
		name: "fs-xattr",
		outputPath: path.join("build", "Release", "xattr.node"),
	},
];

if (!existsSync(nodeGypPath)) {
	throw new Error("Cannot prepare DMG maker: node-gyp is not installed.");
}

for (const nativeModule of nativeModules) {
	const moduleDirectory = path.join(
		rootDirectory,
		"node_modules",
		nativeModule.name,
	);
	const outputPath = path.join(moduleDirectory, nativeModule.outputPath);

	if (!existsSync(moduleDirectory)) {
		throw new Error(
			`Cannot prepare DMG maker: node_modules/${nativeModule.name} is missing.`,
		);
	}

	if (existsSync(outputPath)) {
		try {
			require(outputPath);
			continue;
		} catch {
			// Rebuild when the addon exists but targets a different Node ABI.
		}
	}

	const result = spawnSync(
		process.execPath,
		[
			nodeGypPath,
			"rebuild",
			`--devdir=${path.join(rootDirectory, ".node-gyp")}`,
		],
		{
			cwd: moduleDirectory,
			stdio: "inherit",
		},
	);

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}
