import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = [
	...builtinModules,
	...builtinModules.map((moduleName) => `node:${moduleName}`),
];

const optionalRuntimeDependencies = ["playwright-core"];

export default defineConfig({
	build: {
		ssr: "src/server-entry.ts",
		outDir: "dist",
		emptyOutDir: false,
		copyPublicDir: false,
		rollupOptions: {
			external: [...nodeBuiltins, ...optionalRuntimeDependencies],
			output: {
				entryFileNames: "index.js",
				format: "es",
			},
		},
	},
	ssr: {
		noExternal: true,
	},
});
