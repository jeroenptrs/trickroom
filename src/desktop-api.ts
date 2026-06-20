export type PickProjectFolderResult =
	| { canceled: true }
	| { canceled: false; path: string };

export type PickCssFileResult =
	| { canceled: true }
	| { canceled: false; relativePath: string };

export type PickAssetFileResult =
	| { canceled: true }
	| { canceled: false; relativePath: string };

export type TrickroomDesktopApi = {
	isDesktop: true;
	platform: string;
	pickProjectFolder: () => Promise<PickProjectFolderResult>;
	pickCssFile: (projectRoot: string) => Promise<PickCssFileResult>;
	pickAssetFile: (projectRoot: string) => Promise<PickAssetFileResult>;
	getMcpHelperPath: () => Promise<string>;
	openDesignTokens: (systemId: string) => Promise<void>;
	clipboard: {
		writeText: (text: string) => Promise<void>;
		readText: () => Promise<string>;
	};
};

declare global {
	interface Window {
		trickroomDesktop?: TrickroomDesktopApi;
	}
}

export const getTrickroomDesktopApi = () =>
	typeof window === "undefined" ? undefined : window.trickroomDesktop;
