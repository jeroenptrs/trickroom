/**
 * The entry of the chart code an HTML export embeds. `scripts`-free: Vite
 * bundles this file into a string (see `plugin/chart-export-runtime.ts`) with
 * React left as a bare import, so the export's import map supplies it.
 */
import { ChartElement, type ChartElementProps } from "./chart-element";
import {
	type LoadTopology,
	MapElement,
	type MapElementProps,
} from "./map-element";

export { ChartElement };

export const createMapElement = (topologyUrl: string) => {
	let topology: Promise<unknown> | null = null;
	const loadTopology: LoadTopology = () => {
		topology ??= fetch(topologyUrl).then((response) => {
			if (!response.ok) throw new Error(`Map data: HTTP ${response.status}`);
			return response.json();
		});
		return topology;
	};
	return (props: Omit<MapElementProps, "loadTopology">) => (
		<MapElement {...props} loadTopology={loadTopology} />
	);
};

export type { ChartElementProps };
