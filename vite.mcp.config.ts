import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import { chartExportRuntime } from "./plugin/chart-export-runtime";

const nodeBuiltins = [
	...builtinModules,
	...builtinModules.map((moduleName) => `node:${moduleName}`),
];

const optionalRuntimeDependencies = ["playwright-core"];
// Native (napi) packages stay external so the bundle loads their binding.
const nativeRuntimeDependencies = ["oxc-parser"];

export default defineConfig({
	plugins: [chartExportRuntime()],
	build: {
		ssr: "src/mcp/stdio.ts",
		outDir: "dist",
		emptyOutDir: false,
		copyPublicDir: false,
		rollupOptions: {
			external: [
				...nodeBuiltins,
				...optionalRuntimeDependencies,
				...nativeRuntimeDependencies,
			],
			output: {
				entryFileNames: "mcp-stdio.js",
				format: "es",
			},
		},
	},
	ssr: {
		noExternal: true,
	},
});
