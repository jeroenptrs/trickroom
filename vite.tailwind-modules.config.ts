import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = [
	...builtinModules,
	...builtinModules.map((moduleName) => `node:${moduleName}`),
];

// What `@plugin` and `@config` modules load with (src/utils/tailwind-module-runtime.ts):
// jiti and enhanced-resolve, once. The server, MCP, lint, codegen and worker
// bundles import it from dist/, next to themselves, on the first module.
export default defineConfig({
	build: {
		ssr: "src/utils/tailwind-module-runtime.ts",
		outDir: "dist",
		emptyOutDir: false,
		copyPublicDir: false,
		rollupOptions: {
			external: nodeBuiltins,
			output: {
				entryFileNames: "tailwind-module-runtime.js",
				format: "es",
			},
		},
	},
	ssr: {
		noExternal: true,
	},
});
