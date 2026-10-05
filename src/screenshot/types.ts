export const SCREENSHOT_VIEWPORT_PRESETS = {
	mobile: { width: 390, height: 844 },
	tablet: { width: 768, height: 1024 },
	desktop: { width: 1440, height: 900 },
} as const;

/** Height used when a viewport is given as a bare width. */
export const SCREENSHOT_DEFAULT_VIEWPORT_HEIGHT = 900;

export type ScreenshotViewportPreset = keyof typeof SCREENSHOT_VIEWPORT_PRESETS;
export type ScreenshotViewport = { width: number; height: number };
/** A preset, explicit dimensions, or a width in CSS pixels. */
export type ScreenshotViewportInput =
	| ScreenshotViewportPreset
	| ScreenshotViewport
	| number;
export type ScreenshotTheme = "light" | "dark";

/** One image of the request's target at one viewport and theme. */
export type ScreenshotShot = {
	viewport?: ScreenshotViewportInput;
	theme?: ScreenshotTheme;
};

/**
 * A system component rendered on its own: one variant combination, or every
 * value of one or two axes as a labelled matrix in one image.
 */
export type ScreenshotComponentTarget = {
	systemId: string;
	componentId: string;
	/** Published (default, current version) or the working draft. */
	source?: "published" | "draft";
	variants?: Record<string, string>;
	/** Axis whose values become matrix rows. */
	rows?: string;
	/** Axis whose values become matrix columns. */
	columns?: string;
};

export type ScreenshotRequest = {
	/** Required unless `component` is set. */
	designFileId?: string;
	boardId?: string;
	nodeId?: string;
	component?: ScreenshotComponentTarget;
	viewport?: ScreenshotViewportInput;
	theme?: ScreenshotTheme;
	/** Several viewport/theme captures of one target from one page load. */
	shots?: ScreenshotShot[];
	/** Device scale factor: output pixels per CSS pixel. */
	scale?: number;
	/** CSS pixels; taller targets are cropped from the top. */
	maxHeight?: number;
	outputPath?: string;
	executablePath?: string;
};

export type ScreenshotImage = {
	mimeType: "image/png";
	base64: string;
	bytes: number;
	/** Image size in pixels. */
	width: number;
	height: number;
	viewport: ScreenshotViewport;
	theme: ScreenshotTheme;
	scale: number;
	/** Set when the target was taller than maxHeight. */
	cropped?: { cssHeight: number; capturedCssHeight: number };
	path?: string;
	warnings?: string[];
};

export type ScreenshotResult = {
	designFileId?: string;
	boardId: string;
	nodeId?: string;
	component?: ScreenshotComponentTarget;
	captures: ScreenshotImage[];
};

export function resolveScreenshotViewport(
	input: ScreenshotViewportInput | undefined,
): ScreenshotViewport {
	if (input === undefined) return SCREENSHOT_VIEWPORT_PRESETS.desktop;
	if (typeof input === "number") {
		return { width: input, height: SCREENSHOT_DEFAULT_VIEWPORT_HEIGHT };
	}
	if (typeof input === "string") return SCREENSHOT_VIEWPORT_PRESETS[input];
	return input;
}

/** Short viewport label: the preset name, or `WxH`. */
export function describeScreenshotViewport(
	input: ScreenshotViewportInput | undefined,
) {
	if (input === undefined) return "desktop";
	if (typeof input === "string") return input;
	const viewport = resolveScreenshotViewport(input);
	return `${viewport.width}x${viewport.height}`;
}
