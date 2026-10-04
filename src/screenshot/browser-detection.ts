import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** A browser to try, in detection order. */
export type BrowserCandidate =
	| { source: string; executablePath: string }
	| { source: string; channel: "chrome" | "msedge" };

export type BrowserDetectionHost = {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	homedir: string;
	exists: (filePath: string) => boolean;
	listDir: (dirPath: string) => string[];
};

export const nodeBrowserDetectionHost = (): BrowserDetectionHost => ({
	platform: process.platform,
	env: process.env,
	homedir: os.homedir(),
	exists: existsSync,
	listDir: (dirPath) => {
		try {
			return readdirSync(dirPath);
		} catch {
			return [];
		}
	},
});

/**
 * Where Playwright keeps downloaded browsers: `PLAYWRIGHT_BROWSERS_PATH`, or
 * the per-user cache that `playwright install` writes by default.
 */
export function getPlaywrightCacheDir(host: BrowserDetectionHost) {
	const configured = host.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
	// "0" means "next to the playwright-core package", which executablePath()
	// already covers.
	if (configured && configured !== "0") return configured;
	if (host.platform === "darwin") {
		return path.join(host.homedir, "Library", "Caches", "ms-playwright");
	}
	if (host.platform === "win32") {
		const localAppData =
			host.env.LOCALAPPDATA ?? path.join(host.homedir, "AppData", "Local");
		return path.join(localAppData, "ms-playwright");
	}
	const cacheHome =
		host.env.XDG_CACHE_HOME?.trim() || path.join(host.homedir, ".cache");
	return path.join(cacheHome, "ms-playwright");
}

const PLAYWRIGHT_EXECUTABLES: Record<
	"chromium" | "chromium_headless_shell",
	Partial<Record<NodeJS.Platform, string[]>>
> = {
	chromium: {
		linux: ["chrome-linux64/chrome", "chrome-linux/chrome"],
		darwin: [
			"chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
			"chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
			"chrome-mac/Chromium.app/Contents/MacOS/Chromium",
		],
		win32: ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"],
	},
	chromium_headless_shell: {
		linux: [
			"chrome-headless-shell-linux64/chrome-headless-shell",
			"chrome-linux/headless_shell",
		],
		darwin: [
			"chrome-headless-shell-mac-arm64/chrome-headless-shell",
			"chrome-headless-shell-mac-x64/chrome-headless-shell",
			"chrome-mac/headless_shell",
		],
		win32: [
			"chrome-headless-shell-win64/chrome-headless-shell.exe",
			"chrome-win/headless_shell.exe",
		],
	},
};

/**
 * Chromium builds left in the Playwright cache by any Playwright version,
 * newest revision first. A project whose playwright-core expects a revision
 * that was never downloaded can still use one another tool installed.
 */
export function findCachedPlaywrightBrowsers(
	host: BrowserDetectionHost,
): string[] {
	const cacheDir = getPlaywrightCacheDir(host);
	const entries = host
		.listDir(cacheDir)
		.map((name) => {
			const match = /^(chromium|chromium_headless_shell)-(\d+)$/.exec(name);
			return match
				? {
						name,
						kind: match[1] as keyof typeof PLAYWRIGHT_EXECUTABLES,
						revision: Number(match[2]),
					}
				: null;
		})
		.filter((entry) => entry !== null)
		.sort(
			(a, b) =>
				b.revision - a.revision ||
				// Prefer full Chromium over the headless shell of the same revision.
				(a.kind === "chromium" ? -1 : 1),
		);

	const found: string[] = [];
	for (const entry of entries) {
		for (const relative of PLAYWRIGHT_EXECUTABLES[entry.kind][host.platform] ??
			[]) {
			const executablePath = path.join(cacheDir, entry.name, relative);
			if (host.exists(executablePath)) {
				found.push(executablePath);
				break;
			}
		}
	}
	return found;
}

const LINUX_BROWSER_COMMANDS = [
	"chromium",
	"chromium-browser",
	"google-chrome",
	"google-chrome-stable",
	"microsoft-edge",
	"microsoft-edge-stable",
];

const MAC_BROWSER_APPS = [
	"Google Chrome.app/Contents/MacOS/Google Chrome",
	"Chromium.app/Contents/MacOS/Chromium",
	"Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
	"Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"Brave Browser.app/Contents/MacOS/Brave Browser",
];

const WINDOWS_BROWSER_PATHS = [
	"Google\\Chrome\\Application\\chrome.exe",
	"Chromium\\Application\\chrome.exe",
	"Microsoft\\Edge\\Application\\msedge.exe",
	"BraveSoftware\\Brave-Browser\\Application\\brave.exe",
];

/** System-installed Chrome, Chromium, Edge and Brave executables that exist. */
export function findSystemBrowsers(host: BrowserDetectionHost): string[] {
	const candidates: string[] = [];
	if (host.platform === "darwin") {
		for (const root of [
			"/Applications",
			path.join(host.homedir, "Applications"),
		]) {
			for (const app of MAC_BROWSER_APPS) {
				candidates.push(path.join(root, app));
			}
		}
	} else if (host.platform === "win32") {
		const roots = [
			host.env.PROGRAMFILES,
			host.env["PROGRAMFILES(X86)"],
			host.env.LOCALAPPDATA,
		].filter((root): root is string => Boolean(root));
		for (const root of roots) {
			for (const relative of WINDOWS_BROWSER_PATHS) {
				candidates.push(path.win32.join(root, relative));
			}
		}
	} else {
		const pathDirs = (host.env.PATH ?? "")
			.split(path.delimiter)
			.filter(Boolean);
		for (const dir of [
			...pathDirs,
			"/usr/bin",
			"/usr/local/bin",
			"/snap/bin",
		]) {
			for (const command of LINUX_BROWSER_COMMANDS) {
				candidates.push(path.join(dir, command));
			}
		}
		candidates.push("/opt/google/chrome/chrome");
	}
	return [...new Set(candidates)].filter((candidate) => host.exists(candidate));
}

/**
 * Browsers to try when no executable is configured: the build this
 * playwright-core expects, other cached Playwright builds, system installs,
 * then Playwright's own channel lookup.
 */
export function listBrowserCandidates(
	host: BrowserDetectionHost,
	bundledPath: string | null,
): BrowserCandidate[] {
	const candidates: BrowserCandidate[] = [];
	const seen = new Set<string>();
	const add = (source: string, executablePath: string) => {
		const key = path.resolve(executablePath);
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push({ source, executablePath });
	};
	if (bundledPath && host.exists(bundledPath)) {
		add("playwright", bundledPath);
	}
	for (const cached of findCachedPlaywrightBrowsers(host)) {
		add("playwright cache", cached);
	}
	for (const system of findSystemBrowsers(host)) {
		add("system", system);
	}
	candidates.push(
		{ source: "channel", channel: "chrome" },
		{ source: "channel", channel: "msedge" },
	);
	return candidates;
}
