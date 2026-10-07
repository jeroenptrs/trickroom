import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = [
	...builtinModules,
	...builtinModules.map((moduleName) => `node:${moduleName}`),
];

const optionalRuntimeDependencies = ["playwright-core"];
// Native (napi) packages stay external so the bundle loads their binding.
const nativeRuntimeDependencies = ["oxc-parser"];

export default defineConfig({
	build: {
		ssr: "src/cli/feedback.ts",
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
				entryFileNames: "feedback.js",
				format: "es",
			},
		},
	},
	ssr: {
		noExternal: true,
	},
});
