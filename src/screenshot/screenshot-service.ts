import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	Browser,
	BrowserType,
	CDPSession,
	Frame,
	Page,
} from "playwright-core";
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
	describeScreenshotViewport,
	resolveScreenshotViewport,
	SCREENSHOT_VIEWPORT_PRESETS,
	type ScreenshotImage,
	type ScreenshotRequest,
	type ScreenshotResult,
	type ScreenshotShot,
	type ScreenshotTheme,
	type ScreenshotViewport,
} from "./types";

const CAPTURE_TIMEOUT_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 20_000;

/** The command agents and users run when no browser can be launched. */
export const INSTALL_BROWSER_COMMAND = "npx trickroom install-browser";
const MAX_VIEWPORT_WIDTH = 3840;
const MAX_VIEWPORT_HEIGHT = 2160;
const MAX_VIEWPORT_PIXELS = 16_000_000;
/** Viewport/theme combinations per request, all from one page load per theme. */
export const MAX_SHOTS_PER_REQUEST = 12;
export const MIN_SCREENSHOT_SCALE = 0.25;
export const MAX_SCREENSHOT_SCALE = 2;
export const DEFAULT_SCREENSHOT_SCALE = 1;
/** Without maxHeight, targets are cropped at this many viewport heights. */
export const DEFAULT_MAX_HEIGHT_VIEWPORTS = 2;
/** Upper bound for maxHeight, in CSS pixels. */
export const MAX_CAPTURE_HEIGHT = 8000;

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

function invalid(message: string): never {
	throw new ScreenshotServiceError("INVALID_SCREENSHOT_REQUEST", message);
}

function validateViewport(input: ScreenshotShot["viewport"]) {
	const viewport = resolveScreenshotViewport(input);
	if (
		!Number.isInteger(viewport.width) ||
		!Number.isInteger(viewport.height) ||
		viewport.width < 1 ||
		viewport.height < 1 ||
		viewport.width > MAX_VIEWPORT_WIDTH ||
		viewport.height > MAX_VIEWPORT_HEIGHT ||
		viewport.width * viewport.height > MAX_VIEWPORT_PIXELS
	) {
		invalid(
			`viewport must use positive integer dimensions up to ${MAX_VIEWPORT_WIDTH}x${MAX_VIEWPORT_HEIGHT} and ${MAX_VIEWPORT_PIXELS} total pixels.`,
		);
	}
	return viewport;
}

type PlannedShot = {
	index: number;
	viewport: ScreenshotViewport;
	viewportLabel: string;
	theme: ScreenshotTheme;
	outputPath?: string;
};

function planShots(request: ScreenshotRequest): PlannedShot[] {
	if (request.component) {
		if (
			!request.component.systemId.trim() ||
			!request.component.componentId.trim()
		) {
			invalid("component needs a systemId and a componentId.");
		}
	} else if (!request.designFileId?.trim()) {
		invalid("designFileId must be a non-empty string.");
	}
	const shots = request.shots?.length
		? request.shots
		: [{ viewport: request.viewport, theme: request.theme }];
	if (shots.length > MAX_SHOTS_PER_REQUEST) {
		invalid(
			`A request can capture at most ${MAX_SHOTS_PER_REQUEST} viewport/theme combinations.`,
		);
	}
	return shots.map((shot, index) => {
		const viewportLabel = describeScreenshotViewport(shot.viewport);
		const theme = shot.theme ?? "light";
		return {
			index,
			viewport: validateViewport(shot.viewport),
			viewportLabel,
			theme,
			...(request.outputPath
				? {
						outputPath:
							shots.length === 1
								? request.outputPath
								: suffixOutputPath(
										request.outputPath,
										`${viewportLabel}-${theme}`,
									),
					}
				: {}),
		};
	});
}

/** `captures/board.png` + `mobile-dark` → `captures/board-mobile-dark.png`. */
export function suffixOutputPath(outputPath: string, suffix: string) {
	const extension = path.extname(outputPath);
	const safeSuffix = suffix.replace(/[^a-zA-Z0-9._-]+/g, "-");
	return `${outputPath.slice(0, outputPath.length - extension.length)}-${safeSuffix}${extension}`;
}

export function resolveScreenshotScale(scale: number | undefined) {
	if (scale === undefined) return DEFAULT_SCREENSHOT_SCALE;
	if (
		!Number.isFinite(scale) ||
		scale < MIN_SCREENSHOT_SCALE ||
		scale > MAX_SCREENSHOT_SCALE
	) {
		invalid(
			`scale must be between ${MIN_SCREENSHOT_SCALE} and ${MAX_SCREENSHOT_SCALE}.`,
		);
	}
	return scale;
}

/** Default crop height: two viewports, so one call never returns a huge strip. */
export function resolveScreenshotMaxHeight(
	maxHeight: number | undefined,
	viewport: ScreenshotViewport,
) {
	if (maxHeight === undefined)
		return viewport.height * DEFAULT_MAX_HEIGHT_VIEWPORTS;
	if (
		!Number.isInteger(maxHeight) ||
		maxHeight < 1 ||
		maxHeight > MAX_CAPTURE_HEIGHT
	) {
		invalid(`maxHeight must be an integer from 1 to ${MAX_CAPTURE_HEIGHT}.`);
	}
	return maxHeight;
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

export function buildCaptureUrl(
	request: ScreenshotRequest,
	theme: ScreenshotTheme,
	baseUrl: string,
) {
	const component = request.component;
	const captureUrl = new URL(
		component
			? `/capture/component/${encodeURIComponent(component.systemId)}/${encodeURIComponent(component.componentId)}`
			: `/capture/${encodeURIComponent(request.designFileId ?? "")}${request.boardId ? `/${encodeURIComponent(request.boardId)}` : ""}`,
		baseUrl,
	);
	captureUrl.searchParams.set("theme", theme);
	if (request.nodeId) captureUrl.searchParams.set("node", request.nodeId);
	if (component) {
		if (component.source === "draft") {
			captureUrl.searchParams.set("source", "draft");
		}
		for (const [axis, value] of Object.entries(component.variants ?? {})) {
			captureUrl.searchParams.append("variant", `${axis}:${value}`);
		}
		if (component.rows) captureUrl.searchParams.set("rows", component.rows);
		if (component.columns) {
			captureUrl.searchParams.set("columns", component.columns);
		}
	}
	return captureUrl;
}

type RenderInspection = {
	/** Target rect in iframe document coordinates. */
	target: { x: number; y: number; width: number; height: number };
	missingRenderers: string[];
	/** Rects of positioned overlay layers portalled into the board. */
	overlays: Array<{ left: number; top: number; right: number; bottom: number }>;
};

/** Measures the target and collects render diagnostics inside the stage iframe. */
async function inspectRender(
	frame: Frame,
	targetSelector: string,
	boardSelector: string,
): Promise<RenderInspection> {
	return frame.evaluate(
		({ targetSelector, boardSelector }) => {
			const target = document.querySelector(targetSelector);
			const board = document.querySelector(boardSelector);
			if (!target || !board) throw new Error("The capture target is gone.");
			// Measure from the unscrolled stage; tiled captures scroll it.
			for (const element of [
				document.getElementById("trickroom-viewport"),
				document.body,
				document.documentElement,
			]) {
				element?.scrollTo(0, 0);
			}
			const scrollX = 0;
			const scrollY = 0;
			const rect = target.getBoundingClientRect();
			const missingRenderers = [
				...new Set(
					[
						...(target.matches("[data-trickroom-missing-renderer]")
							? [target]
							: []),
						...target.querySelectorAll("[data-trickroom-missing-renderer]"),
					].map(
						(element) =>
							element.getAttribute("data-trickroom-missing-renderer") ?? "",
					),
				),
			];
			const overlays: RenderInspection["overlays"] = [];
			const portal = board.querySelector(
				":scope > [data-trickroom-board-portal]",
			);
			for (const element of portal?.querySelectorAll("*") ?? []) {
				const position = getComputedStyle(element).position;
				if (position !== "fixed" && position !== "absolute") continue;
				const box = element.getBoundingClientRect();
				if (box.width === 0 || box.height === 0) continue;
				overlays.push({
					left: box.left + scrollX,
					top: box.top + scrollY,
					right: box.right + scrollX,
					bottom: box.bottom + scrollY,
				});
			}
			// Finish or cancel running animations, like Playwright's
			// animations: "disabled".
			for (const animation of document.getAnimations()) {
				try {
					animation.finish();
				} catch {
					animation.cancel();
				}
			}
			return {
				target: {
					x: rect.left + scrollX,
					y: rect.top + scrollY,
					width: rect.width,
					height: rect.height,
				},
				missingRenderers,
				overlays,
			};
		},
		{ targetSelector, boardSelector },
	);
}

function describeWarnings(
	inspection: RenderInspection,
	captured: { top: number; bottom: number; left: number; right: number },
) {
	const warnings: string[] = [];
	if (inspection.missingRenderers.length > 0) {
		warnings.push(
			`MISSING_RENDERER: ${inspection.missingRenderers.join(", ")} render${inspection.missingRenderers.length === 1 ? "s" : ""} as a "No renderer" placeholder.`,
		);
	}
	const tolerance = 1;
	if (
		inspection.overlays.some(
			(overlay) =>
				overlay.left < captured.left - tolerance ||
				overlay.top < captured.top - tolerance ||
				overlay.right > captured.right + tolerance ||
				overlay.bottom > captured.bottom + tolerance,
		)
	) {
		warnings.push(
			"OVERLAY_CLIPPED: an open overlay extends past the captured area, so part of it is not in the image.",
		);
	}
	return warnings;
}

type CaptureRegion = {
	x: number;
	y: number;
	width: number;
	height: number;
	scale: number;
	viewport: ScreenshotViewport;
};

/**
 * Captures a region of the stage iframe document as a base64 PNG. Regions
 * inside the first viewport are one screenshot. Larger regions are captured
 * as viewport-sized tiles while scrolling the stage, then stitched on a
 * canvas: growing the viewport instead would stretch every 100vh element.
 * Scales below 1 draw the full-resolution tiles onto a smaller canvas.
 */
async function captureRegion(
	page: Page,
	frame: Frame,
	cdp: CDPSession,
	frameOffset: { x: number; y: number },
	region: CaptureRegion,
): Promise<string> {
	const shoot = async (clip: {
		x: number;
		y: number;
		width: number;
		height: number;
	}) =>
		(
			(await cdp.send("Page.captureScreenshot", {
				format: "png",
				clip: {
					x: clip.x + frameOffset.x,
					y: clip.y + frameOffset.y,
					width: clip.width,
					height: clip.height,
					scale: 1,
				},
			})) as { data: string }
		).data;

	const { viewport } = region;
	const outputWidth = Math.max(1, Math.round(region.width * region.scale));
	const outputHeight = Math.max(1, Math.round(region.height * region.scale));
	const deviceScale = Math.max(1, region.scale);
	const fitsViewport =
		region.x + region.width <= viewport.width &&
		region.y + region.height <= viewport.height;
	if (fitsViewport && deviceScale === region.scale) return shoot(region);

	const tiles: Array<{
		data: string;
		dx: number;
		dy: number;
		dw: number;
		dh: number;
	}> = [];
	for (let offsetY = 0; offsetY < region.height; offsetY += viewport.height) {
		for (let offsetX = 0; offsetX < region.width; offsetX += viewport.width) {
			const tileWidth = Math.min(viewport.width, region.width - offsetX);
			const tileHeight = Math.min(viewport.height, region.height - offsetY);
			const scrolled = fitsViewport
				? { left: 0, top: 0 }
				: await frame.evaluate(
						async ({ left, top }) => {
							const stage =
								[
									document.getElementById("trickroom-viewport"),
									document.scrollingElement,
								].find(
									(element) =>
										element &&
										(element.scrollHeight > element.clientHeight ||
											element.scrollWidth > element.clientWidth),
								) ?? null;
							stage?.scrollTo(left, top);
							await new Promise<void>((resolve) =>
								requestAnimationFrame(() => resolve()),
							);
							return {
								left: stage?.scrollLeft ?? 0,
								top: stage?.scrollTop ?? 0,
							};
						},
						{ left: region.x + offsetX, top: region.y + offsetY },
					);
			const dx = Math.round(offsetX * region.scale);
			const dy = Math.round(offsetY * region.scale);
			tiles.push({
				data: await shoot({
					x: region.x + offsetX - scrolled.left,
					y: region.y + offsetY - scrolled.top,
					width: tileWidth,
					height: tileHeight,
				}),
				dx,
				dy,
				dw: Math.round((offsetX + tileWidth) * region.scale) - dx,
				dh: Math.round((offsetY + tileHeight) * region.scale) - dy,
			});
		}
	}
	return page.evaluate(
		async ({ tiles, width, height }) => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas is unavailable for stitching.");
			context.imageSmoothingEnabled = true;
			context.imageSmoothingQuality = "high";
			for (const tile of tiles) {
				const blob = await (
					await fetch(`data:image/png;base64,${tile.data}`)
				).blob();
				context.drawImage(
					await createImageBitmap(blob),
					tile.dx,
					tile.dy,
					tile.dw,
					tile.dh,
				);
			}
			return canvas
				.toDataURL("image/png")
				.slice("data:image/png;base64,".length);
		},
		{ tiles, width: outputWidth, height: outputHeight },
	);
}

/** Waits for layout, fonts and two frames after a viewport change. */
async function settleFrame(frame: Frame) {
	await frame.evaluate(async () => {
		await document.fonts?.ready;
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
	});
}

async function writeCapture(
	projectRoot: string,
	outputPath: string,
	png: Buffer,
) {
	const writtenPath = resolveScreenshotOutputPath(projectRoot, outputPath);
	try {
		await mkdir(path.dirname(writtenPath), { recursive: true });
		await writeFile(writtenPath, png);
	} catch {
		throw new ScreenshotServiceError(
			"SCREENSHOT_WRITE_FAILED",
			`Failed to write screenshot to "${writtenPath}".`,
		);
	}
	return writtenPath;
}

async function captureThemeGroup(
	browser: Browser,
	request: ScreenshotRequest,
	shots: PlannedShot[],
	scale: number,
	options: CaptureScreenshotOptions,
): Promise<{ boardId: string; images: Array<[number, ScreenshotImage]> }> {
	const theme = shots[0]?.theme ?? "light";
	const context = await browser.newContext({
		viewport: shots[0]?.viewport ?? SCREENSHOT_VIEWPORT_PRESETS.desktop,
		// Chromium ignores a device scale factor below 1 for screenshots, and
		// scaling the screenshot clip mis-renders backdrop filters; smaller
		// images are downscaled on a canvas instead (see captureRegion).
		deviceScaleFactor: Math.max(1, scale),
		colorScheme: theme,
		reducedMotion: "reduce",
		extraHTTPHeaders: options.requestHeaders,
	});
	try {
		const page = await context.newPage();
		await page.goto(
			buildCaptureUrl(request, theme, options.baseUrl).toString(),
			{
				waitUntil: "domcontentloaded",
				timeout: CAPTURE_TIMEOUT_MS,
			},
		);
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
		const frame = await (
			await page.waitForSelector("#trickroom-capture-frame", {
				timeout: CAPTURE_TIMEOUT_MS,
			})
		).contentFrame();
		if (!frame) {
			throw new ScreenshotServiceError(
				"CAPTURE_RENDER_FAILED",
				"The capture stage frame did not load.",
			);
		}
		const frameOffset = await page.evaluate(() => {
			const element = document.getElementById("trickroom-capture-frame");
			const rect = element?.getBoundingClientRect();
			return { x: rect?.left ?? 0, y: rect?.top ?? 0 };
		});
		const boardSelector = `[data-trickroom-root-id="${escapeCssAttributeValue(state.boardId)}"]`;
		const targetSelector = request.nodeId
			? `[data-trickroom-node-id="${escapeCssAttributeValue(request.nodeId)}"]`
			: boardSelector;
		const cdp = await context.newCDPSession(page);

		const images: Array<[number, ScreenshotImage]> = [];
		let currentViewport = shots[0]?.viewport;
		for (const shot of shots) {
			if (
				currentViewport?.width !== shot.viewport.width ||
				currentViewport?.height !== shot.viewport.height
			) {
				await page.setViewportSize(shot.viewport);
				currentViewport = shot.viewport;
			}
			await settleFrame(frame);
			const inspection = await inspectRender(
				frame,
				targetSelector,
				boardSelector,
			);
			const maxHeight = resolveScreenshotMaxHeight(
				request.maxHeight,
				shot.viewport,
			);
			const x = Math.max(0, Math.floor(inspection.target.x));
			const y = Math.max(0, Math.floor(inspection.target.y));
			const width = Math.min(
				MAX_VIEWPORT_WIDTH,
				Math.max(
					1,
					Math.ceil(inspection.target.x + inspection.target.width) - x,
				),
			);
			const fullHeight = Math.max(
				1,
				Math.ceil(inspection.target.y + inspection.target.height) - y,
			);
			const height = Math.min(fullHeight, maxHeight);
			const data = await captureRegion(page, frame, cdp, frameOffset, {
				x,
				y,
				width,
				height,
				scale,
				viewport: shot.viewport,
			});
			const png = Buffer.from(data, "base64");
			const warnings = describeWarnings(inspection, {
				left: x,
				top: y,
				right: x + width,
				bottom: y + height,
			});
			const writtenPath = shot.outputPath
				? await writeCapture(options.projectRoot, shot.outputPath, png)
				: undefined;
			images.push([
				shot.index,
				{
					mimeType: "image/png",
					base64: data,
					bytes: png.byteLength,
					width: png.readUInt32BE(16),
					height: png.readUInt32BE(20),
					viewport: shot.viewport,
					theme,
					scale,
					...(height < fullHeight
						? { cropped: { cssHeight: fullHeight, capturedCssHeight: height } }
						: {}),
					...(writtenPath ? { path: writtenPath } : {}),
					...(warnings.length > 0 ? { warnings } : {}),
				},
			]);
		}
		return { boardId: state.boardId, images };
	} finally {
		await context.close();
	}
}

export async function captureScreenshot(
	request: ScreenshotRequest,
	options: CaptureScreenshotOptions,
): Promise<ScreenshotResult> {
	const shots = planShots(request);
	const scale = resolveScreenshotScale(request.scale);
	for (const shot of shots) {
		resolveScreenshotMaxHeight(request.maxHeight, shot.viewport);
		if (shot.outputPath) {
			resolveScreenshotOutputPath(options.projectRoot, shot.outputPath);
		}
	}
	const playwright = await (options.loadPlaywright ?? loadPlaywrightCore)();
	const browser = await getBrowser(playwright, request.executablePath);

	try {
		const captures: ScreenshotImage[] = [];
		let boardId = request.boardId ?? "";
		for (const theme of ["light", "dark"] as const) {
			const group = shots.filter((shot) => shot.theme === theme);
			if (group.length === 0) continue;
			const result = await captureThemeGroup(
				browser,
				request,
				group,
				scale,
				options,
			);
			boardId = result.boardId;
			for (const [index, image] of result.images) captures[index] = image;
		}
		return {
			...(request.designFileId ? { designFileId: request.designFileId } : {}),
			boardId,
			...(request.nodeId ? { nodeId: request.nodeId } : {}),
			...(request.component ? { component: request.component } : {}),
			captures,
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
	}
}
