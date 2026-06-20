import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("trickroomDesktop", {
	isDesktop: true,
	platform: process.platform,
	pickProjectFolder: () => ipcRenderer.invoke("trickroom:pick-project-folder"),
	pickCssFile: (projectRoot: string) =>
		ipcRenderer.invoke("trickroom:pick-css-file", projectRoot),
	pickAssetFile: (projectRoot: string) =>
		ipcRenderer.invoke("trickroom:pick-asset-file", projectRoot),
	getMcpHelperPath: () => ipcRenderer.invoke("trickroom:get-mcp-helper-path"),
	clipboard: {
		writeText: (text: string) =>
			ipcRenderer.invoke("trickroom:clipboard-write", text),
		readText: () => ipcRenderer.invoke("trickroom:clipboard-read"),
	},
});
