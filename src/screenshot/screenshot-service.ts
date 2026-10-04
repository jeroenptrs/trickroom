import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserType } from "playwright-core";
import {
	getTrickroomSettingsPath,
	readTrickroomSettings,
} from "../app-state/settings";
import {
	type BrowserDetectionHost,
	listBrowserCandidates,
	nodeBrowserDetectionHost,
} from "./browser-detection";
import {
	resolveScreenshotViewport,
	type ScreenshotRequest,
	type ScreenshotResult,
} from "./types";

const CAPTURE_TIMEOUT_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 20_000;

/** The command agents and users run when no browser can be launched. */
export const INSTALL_BROWSER_COMMAND = "npx trickroom install-browser";
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

let sharedBrowser: Promise<{ browser: Browser; key: string }> | null = null;

async function loadPlaywrightCore(): Promise<PlaywrightRuntime> {
	try {
		return await import("playwright-core");
	} catch {
		throw new ScreenshotServiceError(
			"SCREENSHOT_RUNTIME_MISSING",
			`Screenshotting requires the optional playwright-core peer dependency. Install it in the project running Trickroom (for example \`npm install -D playwright-core\`), then run \`${INSTALL_BROWSER_COMMAND}\` if no Chrome/Chromium is installed.`,
		);
	}
}

async function tryLaunch(
	chromium: BrowserType,
	options: Parameters<BrowserType["launch"]>[0],
): Promise<{ browser: Browser } | { error: string }> {
	try {
		return {
			browser: await chromium.launch({
				headless: true,
				timeout: LAUNCH_TIMEOUT_MS,
				...options,
			}),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: message.split("\n")[0] ?? message };
	}
}

type ConfiguredExecutable = { path: string; source: string };

async function readConfiguredExecutablePath(
	explicitExecutablePath?: string,
): Promise<ConfiguredExecutable | null> {
	const explicit = explicitExecutablePath?.trim();
	if (explicit) return { path: explicit, source: "executablePath" };
	const env = process.env.TRICKROOM_CHROME_PATH?.trim();
	if (env) return { path: env, source: "TRICKROOM_CHROME_PATH" };
	try {
		const settings = await readTrickroomSettings();
		const fromSettings = settings.screenshot?.executablePath?.trim();
		if (fromSettings) {
			return {
				path: fromSettings,
				source: `screenshot.executablePath in ${getTrickroomSettingsPath()}`,
			};
		}
	} catch {
		// An unreadable settings file must not block screenshots; fall through
		// to detection.
	}
	return null;
}

function describeNoBrowser(tried: string[]) {
	return [
		"No Chrome/Chromium could be launched for screenshots.",
		`Fix it once: run \`${INSTALL_BROWSER_COMMAND}\` in the project (downloads Playwright's Chromium), or save an installed browser with \`${INSTALL_BROWSER_COMMAND} --executable-path <path>\` (stored as screenshot.executablePath in ${getTrickroomSettingsPath()}).`,
		tried.length > 0
			? `Tried: ${tried.join("; ")}.`
			: `Looked in the Playwright cache, system install paths and the chrome/msedge channels.`,
	].join(" ");
}

async function launchBrowser(
	playwright: PlaywrightRuntime,
	configured: ConfiguredExecutable | null,
	host: BrowserDetectionHost = nodeBrowserDetectionHost(),
): Promise<{ browser: Browser; key: string }> {
	if (configured) {
		if (!host.exists(configured.path)) {
			throw new ScreenshotServiceError(
				"CHROME_NOT_FOUND",
				`Chrome executable from ${configured.source} was not found at "${configured.path}". Fix the path, or run \`${INSTALL_BROWSER_COMMAND}\`.`,
			);
		}
		const launched = await tryLaunch(playwright.chromium, {
			executablePath: configured.path,
		});
		if ("browser" in launched) {
			return { browser: launched.browser, key: configured.path };
		}
		throw new ScreenshotServiceError(
			"CHROME_NOT_FOUND",
			`Chrome from ${configured.source} ("${configured.path}") could not be launched: ${launched.error}`,
		);
	}

	let bundledPath: string | null = null;
	try {
		bundledPath = playwright.chromium.executablePath();
	} catch {
		bundledPath = null;
	}
	const tried: string[] = [];
	for (const candidate of listBrowserCandidates(host, bundledPath)) {
		const launched = await tryLaunch(
			playwright.chromium,
			"channel" in candidate
				? { channel: candidate.channel }
				: { executablePath: candidate.executablePath },
		);
		const key =
			"channel" in candidate
				? `channel:${candidate.channel}`
				: candidate.executablePath;
		if ("browser" in launched) return { browser: launched.browser, key };
		// Channels that are simply not installed are not worth reporting.
		if (!("channel" in candidate)) {
			tried.push(`${key} (${candidate.source}: ${launched.error})`);
		}
	}

	throw new ScreenshotServiceError(
		"CHROME_NOT_FOUND",
		describeNoBrowser(tried),
	);
}

async function getBrowser(
	playwright: PlaywrightRuntime,
	executablePath?: string,
): Promise<Browser> {
	const configured = await readConfiguredExecutablePath(executablePath);
	for (;;) {
		const current = sharedBrowser;
		if (!current) break;
		const launched = await current.catch(() => null);
		// Another capture replaced the browser while this one waited.
		if (sharedBrowser !== current) continue;
		if (
			launched?.browser.isConnected() &&
			(!configured || launched.key === configured.path)
		) {
			return launched.browser;
		}
		sharedBrowser = null;
		await launched?.browser.close().catch(() => undefined);
		break;
	}
	// Set synchronously so concurrent captures share one launch.
	const launch = launchBrowser(playwright, configured);
	sharedBrowser = launch;
	launch.catch(() => {
		if (sharedBrowser === launch) sharedBrowser = null;
	});
	return (await launch).browser;
}

export async function closeScreenshotBrowser() {
	const current = sharedBrowser;
	sharedBrowser = null;
	const launched = await current?.catch(() => null);
	await launched?.browser.close().catch(() => undefined);
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
