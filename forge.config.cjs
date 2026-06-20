const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const defaultMacSignIdentity =
	"Developer ID Application: Jeroen Peeters (7RJS2LBMGB)";

const getMacSignIdentity = () =>
	process.env.TRICKROOM_MAC_SIGN_IDENTITY ?? defaultMacSignIdentity;

const getMacSignKeychain = () => process.env.TRICKROOM_MAC_SIGN_KEYCHAIN;
const getMacNotaryKeychainProfile = () =>
	process.env.TRICKROOM_NOTARY_KEYCHAIN_PROFILE;
const getMacNotaryKeychain = () => process.env.TRICKROOM_NOTARY_KEYCHAIN;

const getMacSignConfig = () => {
	if (process.platform !== "darwin" || process.env.TRICKROOM_MAC_SIGN !== "1") {
		return undefined;
	}

	return {
		identity: getMacSignIdentity(),
		continueOnError: false,
		...(getMacSignKeychain() ? { keychain: getMacSignKeychain() } : {}),
	};
};

const getMacNotarizeConfig = () => {
	if (!getMacNotaryKeychainProfile()) {
		return undefined;
	}

	return {
		keychainProfile: getMacNotaryKeychainProfile(),
		...(getMacNotaryKeychain()
			? { keychain: getMacNotaryKeychain() }
			: {}),
	};
};

const isExecutable = (stat) => (stat.mode & 0o111) !== 0;

const collectExecutableFiles = async (directory) => {
	let entries;
	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error && error.code === "ENOENT") {
			return [];
		}

		throw error;
	}

	const files = [];
	for (const entry of entries) {
		const filePath = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await collectExecutableFiles(filePath)));
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		const stat = await fs.stat(filePath);
		if (isExecutable(stat)) {
			files.push(filePath);
		}
	}

	return files;
};

const runCommand = (command, args) =>
	new Promise((resolve, reject) => {
		execFile(command, args, (error, stdout, stderr) => {
			if (error) {
				error.message = [error.message, stdout.trim(), stderr.trim()]
					.filter(Boolean)
					.join("\n");
				reject(error);
				return;
			}

			resolve();
		});
	});

const getCodesignArgs = (filePath) => {
	const args = ["--force", "--sign", getMacSignIdentity(), "--timestamp"];
	const keychain = getMacSignKeychain();
	if (keychain) {
		args.push("--keychain", keychain);
	}
	args.push(filePath);
	return args;
};

const signExecutableFile = (filePath) =>
	runCommand("codesign", getCodesignArgs(filePath));

const notarizeFile = (filePath) => {
	const args = [
		"notarytool",
		"submit",
		filePath,
		"--keychain-profile",
		getMacNotaryKeychainProfile(),
		"--wait",
	];
	const keychain = getMacNotaryKeychain();
	if (keychain) {
		args.push("--keychain", keychain);
	}
	return runCommand("xcrun", args);
};

const stapleFile = (filePath) => runCommand("xcrun", ["stapler", "staple", filePath]);

const signExecutableResourceScripts = (
	stagingPath,
	_electronVersion,
	platform,
	_arch,
	callback,
) => {
	if (platform !== "darwin" || process.env.TRICKROOM_MAC_SIGN !== "1") {
		callback();
		return;
	}

	(async () => {
		const appPath = path.join(stagingPath, "Trickroom.app");
		const resourceRoots = [
			path.join(appPath, "Contents", "Resources", "app", "bin"),
			path.join(appPath, "Contents", "Resources", "app", "node_modules"),
			path.join(appPath, "Contents", "Resources", "mcp-helper"),
		];
		const executableFiles = (
			await Promise.all(resourceRoots.map(collectExecutableFiles))
		).flat();

		for (const filePath of executableFiles) {
			await signExecutableFile(filePath);
		}
	})()
		.then(() => callback())
		.catch(callback);
};

const keptLanguages = new Set(["en", "en_GB"]);

const stripUnwantedLocales = (buildPath, _electronVersion, platform, _arch, callback) => {
	if (platform !== "darwin") {
		callback();
		return;
	}

	(async () => {
		const frameworkResources = path.join(
			buildPath,
			"..",
			"..",
			"Frameworks",
			"Electron Framework.framework",
			"Versions",
			"A",
			"Resources",
		);
		const entries = await fs.readdir(frameworkResources, { withFileTypes: true });
		await Promise.all(
			entries.map((entry) => {
				if (!entry.isDirectory() || !entry.name.endsWith(".lproj")) return;
				const language = entry.name.replace(/\.lproj$/, "").replace(/_(FEMININE|MASCULINE|NEUTER)$/, "");
				if (keptLanguages.has(language)) return;
				return fs.rm(path.join(frameworkResources, entry.name), {
					recursive: true,
					force: true,
				});
			}),
		);
	})()
		.then(() => callback())
		.catch(callback);
};

const signAndNotarizeDmgArtifacts = async (_forgeConfig, makeResults) => {
	if (process.platform !== "darwin") {
		return makeResults;
	}

	const dmgArtifacts = makeResults
		.flatMap((makeResult) => makeResult.artifacts)
		.filter((artifact) => artifact.endsWith(".dmg"));

	if (process.env.TRICKROOM_MAC_SIGN === "1") {
		for (const artifact of dmgArtifacts) {
			await runCommand("codesign", getCodesignArgs(artifact));
		}
	}

	if (getMacNotaryKeychainProfile()) {
		for (const artifact of dmgArtifacts) {
			await notarizeFile(artifact);
			await stapleFile(artifact);
		}
	}

	return makeResults;
};

/** @type {import("@electron-forge/shared-types").ForgeConfig} */
module.exports = {
	packagerConfig: {
		name: "Trickroom",
		executableName: "Trickroom",
		appBundleId: "dev.trickroom.app",
		protocols: [
			{
				name: "Trickroom Deep Link",
				schemes: ["trickroom"],
			},
		],
		icon: path.resolve(__dirname, "assets", "trickroom-app-icon-final.png"),
		asar: {
			unpackDir: "{bin,dist,dist-electron}",
		},
		osxSign: getMacSignConfig(),
		osxNotarize: getMacNotarizeConfig(),
		extraResource: ["electron/mcp-helper"],
		afterCopy: [stripUnwantedLocales],
		afterCopyExtraResources: [signExecutableResourceScripts],
		ignore: [
			/^\/\.claude($|\/)/,
			/^\/\.git($|\/)/,
			/^\/\.junie($|\/)/,
			/^\/\.node-gyp($|\/)/,
			/^\/\.pnpm-store($|\/)/,
			/^\/\.tacit($|\/)/,
			/^\/\.tmp/,
			/^\/\.trickroom($|\/)/,
			/^\/docs($|\/)/,
			/^\/electron($|\/)/,
			/^\/out($|\/)/,
			/^\/plugin($|\/)/,
			/^\/scripts($|\/)/,
			/^\/src($|\/)/,
			/^\/test-projects($|\/)/,
			/^\/vite\..*\.ts$/,
			/^\/tsconfig.*\.json$/,
			/^\/biome\.json$/,
			/^\/solo\.yml$/,
		],
	},
	makers: [
		{
			name: "@electron-forge/maker-zip",
			platforms: ["darwin"],
		},
		{
			name: "@electron-forge/maker-dmg",
			platforms: ["darwin"],
			config: {
				format: "ULFO",
				background: path.resolve(
					__dirname,
					"assets",
					"trickroom-dmg-background-centered-2x.png",
				),
				icon: path.resolve(
					__dirname,
					"assets",
					"trickroom-app-icon-final.icns",
				),
				window: {
					size: {
						width: 540,
						height: 380,
					},
				},
			},
		},
		{
			name: "@electron-forge/maker-squirrel",
			platforms: ["win32"],
		},
		{
			name: "@electron-forge/maker-deb",
			platforms: ["linux"],
		},
		{
			name: "@electron-forge/maker-rpm",
			platforms: ["linux"],
		},
	],
	hooks: {
		postMake: signAndNotarizeDmgArtifacts,
	},
};
