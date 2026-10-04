import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type BrowserDetectionHost,
	findCachedPlaywrightBrowsers,
	getPlaywrightCacheDir,
	listBrowserCandidates,
} from "./browser-detection";

const createHost = (
	files: string[],
	overrides: Partial<BrowserDetectionHost> = {},
): BrowserDetectionHost => {
	const fileSet = new Set(files);
	return {
		platform: "linux",
		env: { PATH: "/usr/local/bin:/usr/bin" },
		homedir: "/home/dev",
		exists: (filePath) => fileSet.has(filePath),
		listDir: (dirPath) => {
			const prefix = `${dirPath}${path.sep}`;
			return [
				...new Set(
					files
						.filter((file) => file.startsWith(prefix))
						.map((file) => file.slice(prefix.length).split(path.sep)[0]),
				),
			];
		},
		...overrides,
	};
};

const cache = "/home/dev/.cache/ms-playwright";

describe("browser detection", () => {
	it("resolves the Playwright cache per platform and honours PLAYWRIGHT_BROWSERS_PATH", () => {
		expect(getPlaywrightCacheDir(createHost([]))).toBe(cache);
		expect(getPlaywrightCacheDir(createHost([], { platform: "darwin" }))).toBe(
			"/home/dev/Library/Caches/ms-playwright",
		);
		expect(
			getPlaywrightCacheDir(
				createHost([], { env: { PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" } }),
			),
		).toBe("/opt/pw");
	});

	it("finds other cached Playwright revisions, newest first", () => {
		const host = createHost([
			`${cache}/chromium-1100/chrome-linux/chrome`,
			`${cache}/chromium-1200/chrome-linux64/chrome`,
			`${cache}/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell`,
			`${cache}/ffmpeg-1011/ffmpeg-linux`,
		]);
		expect(findCachedPlaywrightBrowsers(host)).toEqual([
			`${cache}/chromium-1200/chrome-linux64/chrome`,
			`${cache}/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell`,
			`${cache}/chromium-1100/chrome-linux/chrome`,
		]);
	});

	it("orders candidates: expected build, cached builds, system installs, channels", () => {
		const host = createHost([
			`${cache}/chromium-1200/chrome-linux64/chrome`,
			`${cache}/chromium-1100/chrome-linux/chrome`,
			"/usr/bin/chromium",
			"/usr/bin/google-chrome",
		]);
		expect(
			listBrowserCandidates(
				host,
				`${cache}/chromium-1200/chrome-linux64/chrome`,
			),
		).toEqual([
			{
				source: "playwright",
				executablePath: `${cache}/chromium-1200/chrome-linux64/chrome`,
			},
			{
				source: "playwright cache",
				executablePath: `${cache}/chromium-1100/chrome-linux/chrome`,
			},
			{ source: "system", executablePath: "/usr/bin/chromium" },
			{ source: "system", executablePath: "/usr/bin/google-chrome" },
			{ source: "channel", channel: "chrome" },
			{ source: "channel", channel: "msedge" },
		]);
	});

	it("skips a missing expected build", () => {
		const host = createHost(["/usr/bin/chromium-browser"]);
		expect(
			listBrowserCandidates(
				host,
				`${cache}/chromium-1300/chrome-linux64/chrome`,
			)[0],
		).toEqual({
			source: "system",
			executablePath: "/usr/bin/chromium-browser",
		});
	});

	it("checks macOS application bundles", () => {
		const chrome =
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
		const host = createHost([chrome], { platform: "darwin", env: {} });
		expect(listBrowserCandidates(host, null)[0]).toEqual({
			source: "system",
			executablePath: chrome,
		});
	});

	it("checks Windows install locations", () => {
		const edge = path.win32.join(
			"C:\\Program Files (x86)",
			"Microsoft\\Edge\\Application\\msedge.exe",
		);
		const host = createHost([edge], {
			platform: "win32",
			env: {
				PROGRAMFILES: "C:\\Program Files",
				"PROGRAMFILES(X86)": "C:\\Program Files (x86)",
			},
		});
		expect(listBrowserCandidates(host, null)[0]).toEqual({
			source: "system",
			executablePath: edge,
		});
	});
});
