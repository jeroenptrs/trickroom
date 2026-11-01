import path from "node:path";
import { build, type Plugin } from "vite";

const VIRTUAL_ID = "virtual:trickroom-chart-runtime";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const ENTRY = "src/libraries/charts/export-runtime.tsx";

/** Supplied by the export's import map, so the export keeps one React. */
const EXTERNAL = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	"react-dom/client",
];

/**
 * Makes the chart code available as a string for HTML exports: the server
 * embeds it in a board that has a chart. The bundle runs in the exported page,
 * not in the server, so it is built on its own from the same source the stage
 * renders with.
 */
export function chartExportRuntime(): Plugin {
	return {
		name: "trickroom-chart-export-runtime",
		resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
		async load(id) {
			if (id !== RESOLVED_ID) return null;
			const root = process.cwd();
			this.addWatchFile(path.resolve(root, "src/libraries/charts"));
			const output = await build({
				configFile: false,
				root,
				logLevel: "silent",
				plugins: [],
				build: {
					write: false,
					minify: true,
					lib: { entry: ENTRY, formats: ["es"], fileName: "charts" },
					rollupOptions: { external: EXTERNAL },
				},
			});
			const results = Array.isArray(output) ? output : [output];
			const chunks = results.flatMap((result) =>
				"output" in result ? result.output : [],
			);
			const entry = chunks.find(
				(chunk) => chunk.type === "chunk" && chunk.isEntry,
			);
			if (!entry || entry.type !== "chunk" || chunks.length !== 1) {
				throw new Error("The chart export runtime must build to one file.");
			}
			return `export default ${JSON.stringify(entry.code)};`;
		},
	};
}
