import { Chart } from "@tanstack/charts/react";
import { useCallback, useId, useMemo, useState } from "react";
import { ChartBox, pickBoxProps, useBoxSize } from "./chart-box";
import { buildChartDefinition, type ChartSpec } from "./chart-definition";
import {
	CHART_CURVES,
	CHART_FILLS,
	CHART_FORMS,
	type ChartCurve,
	type ChartFill,
	type ChartForm,
	parseChartLimits,
	parseChartMarkers,
	parseChartTable,
} from "./spec";

export type ChartElementProps = {
	className?: string;
	form?: string;
	data?: string;
	limits?: string;
	markers?: string;
	curve?: string;
	fill?: string;
	yMax?: number;
	yPrefix?: string;
	ySuffix?: string;
	yAxis?: boolean;
	partial?: boolean;
	colors?: string;
	"aria-label"?: string;
	[attribute: `data-${string}`]: unknown;
};

const oneOf = <T extends string>(
	options: readonly T[],
	value: string | undefined,
	fallback: T,
): T => (options.includes(value as T) ? (value as T) : fallback);

const readSpec = (
	props: Omit<ChartElementProps, "className" | "aria-label">,
	idPrefix: string,
): { ok: true; spec: ChartSpec } | { ok: false; message: string } => {
	const table = parseChartTable(props.data ?? "");
	if (!table.ok) return table;
	const limits = parseChartLimits(props.limits ?? "");
	if (!limits.ok) return limits;
	const markers = parseChartMarkers(props.markers ?? "");
	if (!markers.ok) return markers;
	return {
		ok: true,
		spec: {
			form: oneOf<ChartForm>(CHART_FORMS, props.form, "line"),
			table: table.value,
			limits: limits.value,
			markers: markers.value,
			curve: oneOf<ChartCurve>(CHART_CURVES, props.curve, "monotone"),
			fill: oneOf<ChartFill>(CHART_FILLS, props.fill, "flat"),
			yMax: props.yMax ?? 0,
			yPrefix: props.yPrefix ?? "",
			ySuffix: props.ySuffix ?? "",
			yAxis: props.yAxis ?? true,
			partial: props.partial ?? false,
			colors: (props.colors ?? "").split(/\s+/u).filter(Boolean),
			idPrefix,
		},
	};
};

export function ChartElement(props: ChartElementProps) {
	const box = pickBoxProps(props);
	const idPrefix = `chart-${useId().replace(/[^a-zA-Z0-9]/gu, "")}`;
	const { ref, size } = useBoxSize();
	const width = size?.width ?? 0;
	const [painted, setPainted] = useState(false);
	const onRender = useCallback(() => setPainted(true), []);

	const { form, data, limits, markers, curve, fill } = props;
	const { yMax, yPrefix, ySuffix, yAxis, partial, colors } = props;
	const parsed = useMemo(
		() =>
			readSpec(
				{
					form,
					data,
					limits,
					markers,
					curve,
					fill,
					yMax,
					yPrefix,
					ySuffix,
					yAxis,
					partial,
					colors,
				},
				idPrefix,
			),
		[
			idPrefix,
			form,
			data,
			limits,
			markers,
			curve,
			fill,
			yMax,
			yPrefix,
			ySuffix,
			yAxis,
			partial,
			colors,
		],
	);
	const definition = useMemo(
		() =>
			parsed.ok && parsed.spec.table.rows.length > 0
				? buildChartDefinition(parsed.spec, width)
				: null,
		[parsed, width],
	);

	if (!parsed.ok) {
		return (
			<ChartBox boxRef={ref} box={box} state="error" message={parsed.message} />
		);
	}
	if (!definition) {
		return <ChartBox boxRef={ref} box={box} state="ready" message="No data" />;
	}
	return (
		<ChartBox boxRef={ref} box={box} state={painted ? "ready" : "loading"}>
			{size ? (
				<Chart
					ariaLabel={props["aria-label"] || `${parsed.spec.form} chart`}
					definition={definition}
					height={size.height}
					idPrefix={idPrefix}
					onRender={onRender}
				/>
			) : null}
		</ChartBox>
	);
}
