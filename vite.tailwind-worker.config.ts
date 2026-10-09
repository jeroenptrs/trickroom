import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = [
	...builtinModules,
	...builtinModules.map((moduleName) => `node:${moduleName}`),
];

// The Tailwind canonicalization worker (src/utils/tailwind-canonicalize-worker.ts).
// The server, MCP and lint bundles start it from dist/, next to themselves.
export default defineConfig({
	build: {
		ssr: "src/utils/tailwind-canonicalize-worker.ts",
		outDir: "dist",
		emptyOutDir: false,
		copyPublicDir: false,
		rollupOptions: {
			external: nodeBuiltins,
			output: {
				entryFileNames: "tailwind-canonicalize-worker.js",
				format: "es",
			},
		},
	},
	ssr: {
		noExternal: true,
	},
});
