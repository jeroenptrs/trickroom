declare module "virtual:trickroom-chart-runtime" {
	/** The chart code an HTML export embeds; see plugin/chart-export-runtime.ts. */
	const source: string;
	export default source;
}

declare module "world-atlas/countries-110m.json" {
	const topology: unknown;
	export default topology;
}
