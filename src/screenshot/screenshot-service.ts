import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserType } from "playwright-core";
import {
	resolveScreenshotViewport,
	type ScreenshotRequest,
	type ScreenshotResult,
} from "./types";

const CAPTURE_TIMEOUT_MS = 30_000;
const MAX_VIEWPORT_WIDTH = 3840;
const MAX_VIEWPORT_HEIGHT = 2160;
const MAX_VIEWPORT_PIXELS = 16_000_000;

export type ScreenshotServiceErrorCode =
	| "INVALID_SCREENSHOT_REQUEST"
	| "SCREENSHOT_RUNTIME_MISSING"
	| "CHROME_NOT_FOUND"
	| "CAPTURE_FAILED"
	| "CAPTURE_TIMEOUT"
	| "CAPTURE_RENDER_FAILED"
	| "SCREENSHOT_WRITE_FAILED";

export class ScreenshotServiceError extends Error {
	readonly code: ScreenshotServiceErrorCode;

	constructor(code: ScreenshotServiceErrorCode, message: string) {
		super(message);
		this.name = "ScreenshotServiceError";
		this.code = code;
	}
}

export type CaptureScreenshotOptions = {
	baseUrl: string;
	projectRoot: string;
	requestHeaders?: Record<string, string>;
	loadPlaywright?: () => Promise<PlaywrightRuntime>;
};

type PlaywrightRuntime = typeof import("playwright-core");

let sharedBrowser: Browser | null = null;
let sharedBrowserKey: string | null = null;

async function loadPlaywrightCore(): Promise<PlaywrightRuntime> {
	try {
		return await import("playwright-core");
	} catch {
		throw new ScreenshotServiceError(
			"SCREENSHOT_RUNTIME_MISSING",
			"Screenshotting requires the optional playwright-core peer dependency. Install it in the project running Trickroom, then install Chrome/Chromium or set TRICKROOM_CHROME_PATH.",
		);
	}
}

async function tryLaunch(
	chromium: BrowserType,
	options: Parameters<BrowserType["launch"]>[0],
) {
	try {
		return await chromium.launch({ headless: true, ...options });
	} catch {
		return null;
	}
}

async function launchBrowser(
	playwright: PlaywrightRuntime,
	explicitExecutablePath?: string,
): Promise<{ browser: Browser; key: string }> {
	const configuredPath =
		explicitExecutablePath?.trim() || process.env.TRICKROOM_CHROME_PATH?.trim();
	if (configuredPath) {
		if (!existsSync(configuredPath)) {
			throw new ScreenshotServiceError(
				"CHROME_NOT_FOUND",
				`Chrome executable was not found at "${configuredPath}".`,
			);
		}
		const browser = await tryLaunch(playwright.chromium, {
			executablePath: configuredPath,
		});
		if (browser) return { browser, key: configuredPath };
		throw new ScreenshotServiceError(
			"CHROME_NOT_FOUND",
			`Chrome could not be launched from "${configuredPath}".`,
		);
	}

	const bundledPath = playwright.chromium.executablePath();
	if (bundledPath && existsSync(bundledPath)) {
		const browser = await tryLaunch(playwright.chromium, {
			executablePath: bundledPath,
		});
		if (browser) return { browser, key: bundledPath };
	}

	for (const channel of ["chrome", "msedge"] as const) {
		const browser = await tryLaunch(playwright.chromium, { channel });
		if (browser) return { browser, key: `channel:${channel}` };
	}

	throw new ScreenshotServiceError(
		"CHROME_NOT_FOUND",
		"No compatible Chrome/Chromium installation was found. Install one with `npx playwright-core install chromium`, set TRICKROOM_CHROME_PATH, or pass executablePath.",
	);
}

async function getBrowser(
	playwright: PlaywrightRuntime,
	executablePath?: string,
): Promise<Browser> {
	const requestedKey =
		executablePath?.trim() || process.env.TRICKROOM_CHROME_PATH?.trim() || null;
	if (
		sharedBrowser?.isConnected() &&
		(requestedKey === null || sharedBrowserKey === requestedKey)
	) {
		return sharedBrowser;
	}
	if (sharedBrowser) await sharedBrowser.close().catch(() => undefined);
	const launched = await launchBrowser(playwright, executablePath);
	sharedBrowser = launched.browser;
	sharedBrowserKey = launched.key;
	return launched.browser;
}

export async function closeScreenshotBrowser() {
	if (sharedBrowser) await sharedBrowser.close().catch(() => undefined);
	sharedBrowser = null;
	sharedBrowserKey = null;
}

function validateRequest(request: ScreenshotRequest) {
	if (!request.designFileId.trim()) {
		throw new ScreenshotServiceError(
			"INVALID_SCREENSHOT_REQUEST",
			"designFileId must be a non-empty string.",
		);
	}
	const viewport = resolveScreenshotViewport(request.viewport);
	if (
		!Number.isInteger(viewport.width) ||
		!Number.isInteger(viewport.height) ||
		viewport.width < 1 ||
		viewport.height < 1 ||
		viewport.width > MAX_VIEWPORT_WIDTH ||
		viewport.height > MAX_VIEWPORT_HEIGHT ||
		viewport.width * viewport.height > MAX_VIEWPORT_PIXELS
	) {
		throw new ScreenshotServiceError(
			"INVALID_SCREENSHOT_REQUEST",
			`viewport must use positive integer dimensions up to ${MAX_VIEWPORT_WIDTH}x${MAX_VIEWPORT_HEIGHT} and ${MAX_VIEWPORT_PIXELS} total pixels.`,
		);
	}
	return viewport;
}

export function resolveScreenshotOutputPath(
	projectRoot: string,
	outputPath: string,
) {
	const trimmed = outputPath.trim();
	if (!trimmed) {
		throw new ScreenshotServiceError(
			"INVALID_SCREENSHOT_REQUEST",
			"outputPath must be a non-empty PNG path.",
		);
	}
	const resolvedProjectRoot = path.resolve(projectRoot);
	const resolved = path.isAbsolute(trimmed)
		? path.resolve(trimmed)
		: path.resolve(resolvedProjectRoot, path.normalize(trimmed));
	if (
		!path.isAbsolute(trimmed) &&
		resolved !== resolvedProjectRoot &&
		!resolved.startsWith(`${resolvedProjectRoot}${path.sep}`)
	) {
		throw new ScreenshotServiceError(
			"INVALID_SCREENSHOT_REQUEST",
			"Project-relative outputPath must stay inside the project root.",
		);
	}
	if (path.extname(resolved).toLowerCase() !== ".png") {
		throw new ScreenshotServiceError(
			"INVALID_SCREENSHOT_REQUEST",
			"outputPath must end in .png.",
		);
	}
	return resolved;
}

function escapeCssAttributeValue(value: string) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\a ");
}

export async function captureScreenshot(
	request: ScreenshotRequest,
	options: CaptureScreenshotOptions,
): Promise<ScreenshotResult> {
	const viewport = validateRequest(request);
	const playwright = await (options.loadPlaywright ?? loadPlaywrightCore)();
	const browser = await getBrowser(playwright, request.executablePath);
	const context = await browser.newContext({
		viewport,
		deviceScaleFactor: 1,
		colorScheme: request.theme === "dark" ? "dark" : "light",
		reducedMotion: "reduce",
		extraHTTPHeaders: options.requestHeaders,
	});

	try {
		const page = await context.newPage();
		const captureUrl = new URL(
			`/capture/${encodeURIComponent(request.designFileId)}${request.boardId ? `/${encodeURIComponent(request.boardId)}` : ""}`,
			options.baseUrl,
		);
		captureUrl.searchParams.set(
			"viewport",
			`${viewport.width}x${viewport.height}`,
		);
		captureUrl.searchParams.set("theme", request.theme ?? "light");
		if (request.nodeId) captureUrl.searchParams.set("node", request.nodeId);

		await page.goto(captureUrl.toString(), {
			waitUntil: "domcontentloaded",
			timeout: CAPTURE_TIMEOUT_MS,
		});
		await page.waitForFunction(
			() => {
				const state = window.__TRICKROOM_CAPTURE__;
				return state?.status === "ready" || state?.status === "error";
			},
			undefined,
			{ timeout: CAPTURE_TIMEOUT_MS },
		);
		const state = await page.evaluate(() => window.__TRICKROOM_CAPTURE__);
		if (!state || state.status !== "ready" || !state.boardId) {
			throw new ScreenshotServiceError(
				"CAPTURE_RENDER_FAILED",
				state?.message ?? "The capture route failed to render.",
			);
		}

		const frame = page.frameLocator("#trickroom-capture-frame");
		const selector = request.nodeId
			? `[data-trickroom-node-id="${escapeCssAttributeValue(request.nodeId)}"]`
			: `[data-trickroom-root-id="${escapeCssAttributeValue(state.boardId)}"]`;
		const target = frame.locator(selector);
		const png = await target.screenshot({
			type: "png",
			animations: "disabled",
			timeout: CAPTURE_TIMEOUT_MS,
		});
		const box = await target.boundingBox();
		let writtenPath: string | undefined;
		if (request.outputPath) {
			writtenPath = resolveScreenshotOutputPath(
				options.projectRoot,
				request.outputPath,
			);
			try {
				await mkdir(path.dirname(writtenPath), { recursive: true });
				await writeFile(writtenPath, png);
			} catch {
				throw new ScreenshotServiceError(
					"SCREENSHOT_WRITE_FAILED",
					`Failed to write screenshot to "${writtenPath}".`,
				);
			}
		}

		return {
			mimeType: "image/png",
			base64: png.toString("base64"),
			bytes: png.byteLength,
			width: Math.round(box?.width ?? viewport.width),
			height: Math.round(box?.height ?? viewport.height),
			designFileId: request.designFileId,
			boardId: state.boardId,
			...(request.nodeId ? { nodeId: request.nodeId } : {}),
			theme: request.theme ?? "light",
			...(writtenPath ? { path: writtenPath } : {}),
		};
	} catch (error) {
		if (error instanceof ScreenshotServiceError) throw error;
		if (error instanceof Error && error.name === "TimeoutError") {
			throw new ScreenshotServiceError(
				"CAPTURE_TIMEOUT",
				`Capture did not finish within ${CAPTURE_TIMEOUT_MS}ms.`,
			);
		}
		throw new ScreenshotServiceError(
			"CAPTURE_FAILED",
			error instanceof Error ? error.message : String(error),
		);
	} finally {
		await context.close();
	}
}
