export const SCREENSHOT_VIEWPORT_PRESETS = {
	mobile: { width: 390, height: 844 },
	tablet: { width: 768, height: 1024 },
	desktop: { width: 1440, height: 900 },
} as const;

export type ScreenshotViewportPreset = keyof typeof SCREENSHOT_VIEWPORT_PRESETS;
export type ScreenshotViewport = { width: number; height: number };
export type ScreenshotViewportInput =
	| ScreenshotViewportPreset
	| ScreenshotViewport;

export type ScreenshotRequest = {
	designFileId: string;
	boardId?: string;
	nodeId?: string;
	viewport?: ScreenshotViewportInput;
	theme?: "light" | "dark";
	outputPath?: string;
	executablePath?: string;
};

export type ScreenshotResult = {
	mimeType: "image/png";
	base64: string;
	bytes: number;
	width: number;
	height: number;
	designFileId: string;
	boardId: string;
	nodeId?: string;
	theme: "light" | "dark";
	path?: string;
};

export function resolveScreenshotViewport(
	input: ScreenshotViewportInput | undefined,
): ScreenshotViewport {
	if (!input) return SCREENSHOT_VIEWPORT_PRESETS.desktop;
	if (typeof input === "string") return SCREENSHOT_VIEWPORT_PRESETS[input];
	return input;
}
