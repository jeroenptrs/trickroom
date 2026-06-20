import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const external = [
	"electron",
	...builtinModules,
	...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
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
