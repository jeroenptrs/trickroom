import { defineConfig } from "vite";

export default defineConfig({
	build: {
		lib: {
			entry: "electron/preload.ts",
			formats: ["cjs"],
			fileName: () => "preload.cjs",
		},
		outDir: "dist-electron/preload",
		emptyOutDir: true,
		copyPublicDir: false,
		rollupOptions: {
			external: ["electron"],
		},
	},
});
