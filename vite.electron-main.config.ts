import { copyFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const copyElectronSplash = (): Plugin => ({
	name: "copy-electron-splash",
	closeBundle() {
		const source = path.resolve("electron/splash.html");
		const target = path.resolve("dist-electron/main/splash.html");
		copyFileSync(source, target);
	},
});

const external = [
	"electron",
	...builtinModules,
	...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
	plugins: [copyElectronSplash()],
	build: {
		ssr: "electron/main.ts",
		outDir: "dist-electron/main",
		emptyOutDir: true,
		copyPublicDir: false,
		rollupOptions: {
			external,
			output: {
				entryFileNames: "main.js",
				format: "es",
			},
		},
	},
});
