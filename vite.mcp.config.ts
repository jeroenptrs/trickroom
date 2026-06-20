import { defineConfig } from "vite";

export default defineConfig({
	build: {
		ssr: "src/mcp/stdio.ts",
		outDir: "dist",
		emptyOutDir: false,
		copyPublicDir: false,
		rollupOptions: {
			output: {
				entryFileNames: "mcp-stdio.js",
				format: "es",
			},
		},
	},
});
