import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

export const getAppRoot = () => app.getAppPath();

const getPackagedRuntimeRoot = () => {
	const unpackedRoot = path.join(process.resourcesPath, "app.asar.unpacked");
	if (existsSync(unpackedRoot)) {
		return unpackedRoot;
	}

	return path.join(process.resourcesPath, "app");
};

export const getRuntimeRoot = () =>
	app.isPackaged ? getPackagedRuntimeRoot() : getAppRoot();

export const getBackendEntryPath = () =>
	path.join(getRuntimeRoot(), "dist", "index.js");

export const getPreloadPath = () =>
	path.join(getRuntimeRoot(), "dist-electron", "preload", "preload.cjs");

export const getSplashPath = () =>
	path.join(getRuntimeRoot(), "dist-electron", "main", "splash.html");

export const getMcpHelperPath = () => {
	const binary = process.platform === "win32" ? "mcp.cmd" : "mcp";
	const root = app.isPackaged
		? path.join(process.resourcesPath, "mcp-helper")
		: path.join(getAppRoot(), "electron", "mcp-helper");
	return path.join(root, binary);
};
