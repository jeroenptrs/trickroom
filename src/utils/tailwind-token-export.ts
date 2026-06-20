import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens";
import type { TailwindTokenStorage } from "./tailwind-token-store";
import {
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "./tailwind-token-domains";

type ExportTokenStatus = "default" | "added" | "overridden";

type ExportTokenRow = {
	domain: TailwindTokenDomain;
	name: string;
	value: string;
	status: ExportTokenStatus;
	defaultValue?: string;
};

export type TailwindTokenExportSystem = {
	systemId: string;
	systemName: string;
	cssPath: string;
};

const domainLabels: Record<TailwindTokenDomain, string> = Object.fromEntries(
	TAILWIND_TOKEN_DOMAINS.map((domain) => [
		domain,
		domain
			.split("-")
			.map((part) => part.replace(/^([a-z])/, (match) => match.toUpperCase()))
			.join(" "),
	]),
) as Record<TailwindTokenDomain, string>;

const colorValuePattern =
	/^(#[0-9a-f]{3,8}|(?:rgb[a]?|hsl[a]?|hwb|lab|lch|oklab|oklch|color|color-mix)\(.+\)|var\(--[^)]+\)|currentColor|transparent|black|white)$/i;

const defaultTokensByDomain = defaultTailwindTokensByDomain as Record<
	TailwindTokenDomain,
	Record<string, string>
>;

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const escapeAttribute = escapeHtml;

const formatDate = (value: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) {
		return value;
	}
	return date.toLocaleString("en", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const compareTokenRows = (left: ExportTokenRow, right: ExportTokenRow) => {
	const domainComparison =
		TAILWIND_TOKEN_DOMAINS.indexOf(left.domain) -
		TAILWIND_TOKEN_DOMAINS.indexOf(right.domain);
	if (domainComparison !== 0) {
		return domainComparison;
	}
	return left.name.localeCompare(right.name, undefined, { numeric: true });
};

const getDomainLabel = (domain: TailwindTokenDomain) => domainLabels[domain];

export const buildTailwindTokenExportRows = (
	storage: TailwindTokenStorage,
): ExportTokenRow[] => {
	const rowsByDomain = new Map<
		TailwindTokenDomain,
		Map<string, ExportTokenRow>
	>();

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const domainRows = new Map<string, ExportTokenRow>();
		for (const [name, value] of Object.entries(
			defaultTailwindTokensByDomain[domain] ?? {},
		)) {
			domainRows.set(name, {
				domain,
				name,
				value,
				status: "default",
				defaultValue: value,
			});
		}
		rowsByDomain.set(domain, domainRows);
	}

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const domainRows = rowsByDomain.get(domain);
		const snapshot = storage.domains[domain];
		if (!domainRows || !snapshot) {
			continue;
		}

		for (const token of snapshot.baselineDiff.removed) {
			domainRows.delete(token.name);
		}

		for (const [name, value] of Object.entries(snapshot.tokens)) {
			const defaultValue = defaultTokensByDomain[domain]?.[name];
			domainRows.set(name, {
				domain,
				name,
				value,
				status:
					defaultValue === undefined
						? "added"
						: defaultValue === value
							? "default"
							: "overridden",
				defaultValue,
			});
		}

		for (const token of snapshot.baselineDiff.overridden) {
			domainRows.set(token.name, {
				domain,
				name: token.name,
				value: token.value,
				status: "overridden",
				defaultValue: token.defaultValue,
			});
		}

		for (const token of snapshot.baselineDiff.added) {
			domainRows.set(token.name, {
				domain,
				name: token.name,
				value: token.value,
				status: "added",
			});
		}
	}

	return TAILWIND_TOKEN_DOMAINS.flatMap((domain) => [
		...(rowsByDomain.get(domain)?.values() ?? []),
	]).sort(compareTokenRows);
};

const renderSwatch = (value: string) => {
	const trimmed = value.trim();
	if (!colorValuePattern.test(trimmed)) {
		return '<span class="swatch swatch--empty" aria-hidden="true"></span>';
	}
	return `<span class="swatch" style="background:${escapeAttribute(trimmed)}" aria-hidden="true"></span>`;
};

const baseColorTokenNames = new Set([
	"black",
	"white",
	"transparent",
	"current",
	"currentColor",
]);

const parseColorTokenName = (name: string) => {
	const weightedMatch = /^(.*)-(\d+)$/.exec(name);
	if (weightedMatch) {
		return {
			group: weightedMatch[1],
			weight: Number(weightedMatch[2]),
		};
	}

	return {
		group: baseColorTokenNames.has(name) ? "base" : "custom",
		weight: null,
	};
};

const compareColorGroups = (left: string, right: string) => {
	if (left === right) return 0;
	if (left === "custom") return -1;
	if (right === "custom") return 1;
	if (left === "base") return -1;
	if (right === "base") return 1;
	return left.localeCompare(right, undefined, { numeric: true });
};

const compareColorRows = (left: ExportTokenRow, right: ExportTokenRow) => {
	const leftParts = parseColorTokenName(left.name);
	const rightParts = parseColorTokenName(right.name);
	if (leftParts.weight !== null || rightParts.weight !== null) {
		return (
			(leftParts.weight ?? Number.NEGATIVE_INFINITY) -
			(rightParts.weight ?? Number.NEGATIVE_INFINITY)
		);
	}
	return left.name.localeCompare(right.name, undefined, { numeric: true });
};

const getColorGroupLabel = (group: string) => {
	if (group === "custom") return "Custom colors";
	if (group === "base") return "Base colors";
	return `Color ${group.replace(/^([a-z])/, (match) => match.toUpperCase())}`;
};

const groupColorRows = (rows: readonly ExportTokenRow[]) => {
	const groups = new Map<string, ExportTokenRow[]>();
	for (const row of rows) {
		const { group } = parseColorTokenName(row.name);
		const groupRows = groups.get(group) ?? [];
		groupRows.push(row);
		groups.set(group, groupRows);
	}

	return [...groups.entries()]
		.sort(([left], [right]) => compareColorGroups(left, right))
		.map(([group, groupRows]) => ({
			group,
			label: getColorGroupLabel(group),
			rows: [...groupRows].sort(compareColorRows),
		}));
};

const textSizeOrder = [
	"xs",
	"sm",
	"base",
	"lg",
	"xl",
	"2xl",
	"3xl",
	"4xl",
	"5xl",
	"6xl",
	"7xl",
	"8xl",
	"9xl",
];
const containerSizeOrder = [
	"3xs",
	"2xs",
	"xs",
	"sm",
	"md",
	"lg",
	"xl",
	"2xl",
	"3xl",
	"4xl",
	"5xl",
	"6xl",
	"7xl",
];
const radiusSizeOrder = [
	"xs",
	"sm",
	"DEFAULT",
	"md",
	"lg",
	"xl",
	"2xl",
	"3xl",
	"4xl",
];
const fontWeightOrder = [
	"thin",
	"extralight",
	"light",
	"normal",
	"medium",
	"semibold",
	"bold",
	"extrabold",
	"black",
];
const rhythmOrder = [
	"tighter",
	"tight",
	"snug",
	"normal",
	"relaxed",
	"loose",
	"wide",
	"wider",
	"widest",
];
const shadowSizeOrder = [
	"2xs",
	"xs",
	"sm",
	"DEFAULT",
	"md",
	"lg",
	"xl",
	"2xl",
	"inner",
];
const shadowDomainOrder = new Map<TailwindTokenDomain, number>([
	["shadow", 0],
	["inset-shadow", 1],
	["drop-shadow", 2],
	["text-shadow", 3],
]);

const compareByOrder = (
	left: string,
	right: string,
	order: readonly string[],
) => {
	const leftIndex = order.indexOf(left);
	const rightIndex = order.indexOf(right);
	if (leftIndex !== -1 || rightIndex !== -1) {
		return (
			(leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
			(rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
		);
	}
	return left.localeCompare(right, undefined, { numeric: true });
};

const buildTokenValueMap = (rows: readonly ExportTokenRow[]) => {
	const valuesByDomain = new Map<TailwindTokenDomain, Map<string, string>>();
	for (const row of rows) {
		const domainValues = valuesByDomain.get(row.domain) ?? new Map();
		domainValues.set(row.name, row.value);
		valuesByDomain.set(row.domain, domainValues);
	}
	return valuesByDomain;
};

const parseLengthValue = (value: string): number | null => {
	const trimmed = value.trim();
	const pxMatch = /^(-?\d+(?:\.\d+)?)px$/i.exec(trimmed);
	if (pxMatch) return Number(pxMatch[1]);
	const remMatch = /^(-?\d+(?:\.\d+)?)rem$/i.exec(trimmed);
	if (remMatch) return Number(remMatch[1]) * 16;
	const numericMatch = /^-?\d+(?:\.\d+)?$/.exec(trimmed);
	if (numericMatch) return Number(trimmed) * 4;
	return null;
};

const resolveSpacingFunctionValue = (
	value: string,
	spacingValues: Map<string, string> | undefined,
) => {
	const match = /^--spacing\((-?\d+(?:\.\d+)?)\)$/.exec(value.trim());
	if (!match) return null;
	const spacingBase =
		spacingValues?.get("DEFAULT") ?? defaultTokensByDomain.spacing.DEFAULT;
	const baseLength = spacingBase ? parseLengthValue(spacingBase) : null;
	if (baseLength === null) return null;
	return Number(match[1]) * baseLength;
};

const resolveNumericTokenValue = (
	row: ExportTokenRow,
	valuesByDomain: Map<TailwindTokenDomain, Map<string, string>>,
) => {
	const directLength = parseLengthValue(row.value);
	if (directLength !== null) return directLength;
	return resolveSpacingFunctionValue(row.value, valuesByDomain.get("spacing"));
};

const compareNumericTokenRows = (
	left: ExportTokenRow,
	right: ExportTokenRow,
	valuesByDomain: Map<TailwindTokenDomain, Map<string, string>>,
	order?: readonly string[],
) => {
	const leftValue = resolveNumericTokenValue(left, valuesByDomain);
	const rightValue = resolveNumericTokenValue(right, valuesByDomain);
	if (leftValue !== null || rightValue !== null) {
		if (leftValue === null) return 1;
		if (rightValue === null) return -1;
		if (leftValue !== rightValue) return leftValue - rightValue;
	}
	return order
		? compareByOrder(left.name, right.name, order)
		: left.name.localeCompare(right.name, undefined, { numeric: true });
};

const rowsForDomain = (
	rows: readonly ExportTokenRow[],
	domain: TailwindTokenDomain,
	order?: readonly string[],
) => {
	const domainRows = rows.filter((row) => row.domain === domain);
	const valuesByDomain = buildTokenValueMap(domainRows);
	return [...domainRows].sort((left, right) =>
		compareNumericTokenRows(left, right, valuesByDomain, order),
	);
};

const getDisplayTokenName = (row: ExportTokenRow) =>
	row.name === "DEFAULT" ? getDomainLabel(row.domain) : row.name;

const renderSubgroup = ({
	title,
	description,
	count,
	content,
}: {
	title: string;
	description?: string;
	count: number;
	content: string;
}) => {
	if (count === 0) return "";
	return `<div class="visual-subgroup">
		<div class="subgroup-heading">
			<span>${escapeHtml(title)}</span>
			${description ? `<p>${escapeHtml(description)}</p>` : ""}
			<code>${count.toLocaleString()}</code>
		</div>
		${content}
	</div>`;
};

const renderSection = ({
	index,
	title,
	description,
	count,
	content,
}: {
	index: string;
	title: string;
	description: string;
	count: number;
	content: string;
}) => {
	if (count === 0) {
		return "";
	}

	return `<section class="token-section">
		<header class="section-header">
			<div class="section-title">
				<span class="section-index">${escapeHtml(index)}</span>
				<h2>${escapeHtml(title)}</h2>
				<p>${escapeHtml(description)}</p>
			</div>
			<span class="section-count">${count.toLocaleString()}</span>
		</header>
		${content}
	</section>`;
};

const renderColorCard = (row: ExportTokenRow) => `<article class="color-card">
	<div class="color-card__swatch" style="background:${escapeAttribute(row.value)}" aria-hidden="true"></div>
	<div class="color-card__body">
		<div class="token-name">${escapeHtml(row.name)}</div>
		<div class="token-value">${escapeHtml(row.value)}</div>
	</div>
</article>`;

const renderColorSection = (index: string, rows: readonly ExportTokenRow[]) =>
	renderSection({
		index,
		title: "Color",
		description: "Resolved color tokens with their project values.",
		count: rows.length,
		content: `<div class="token-groups">${groupColorRows(rows)
			.map(
				(group) => `<div class="token-group">
					<div class="group-heading">
						<span>${escapeHtml(group.label)}</span>
						<code>${group.rows.length.toLocaleString()}</code>
					</div>
					<div class="color-grid">${group.rows.map(renderColorCard).join("")}</div>
				</div>`,
			)
			.join("")}</div>`,
	});

const renderTokenCard = (row: ExportTokenRow) => {
	return `<article class="token-card">
		${renderSwatch(row.value)}
		<div class="token-card__content">
			<div class="token-name">${escapeHtml(row.name)}</div>
			<div class="token-value">${escapeHtml(row.value)}</div>
		</div>
	</article>`;
};

const renderFontFamilyGrid = (rows: readonly ExportTokenRow[]) =>
	`<div class="font-family-grid">${rows
		.map(
			(row) => `<article class="font-family-card">
				<div class="font-preview" style="font-family:${escapeAttribute(row.value)}">AaBbCc</div>
				<div class="token-pair">
					<span>${escapeHtml(row.name)}</span>
					<code>${escapeHtml(row.value)}</code>
				</div>
			</article>`,
		)
		.join("")}</div>`;

const getPreviewFontSize = (value: string) => {
	const length = parseLengthValue(value);
	if (length === null) return undefined;
	return `${Math.max(12, Math.min(28, length))}px`;
};

const renderTextSizeGrid = (rows: readonly ExportTokenRow[]) => {
	const valuesByDomain = buildTokenValueMap(rows);
	const lineHeightByName = new Map(
		rows
			.filter((row) => row.name.endsWith("--line-height"))
			.map((row) => [row.name.replace(/--line-height$/, ""), row.value]),
	);
	const sizeRows = rows
		.filter((row) => !row.name.endsWith("--line-height"))
		.sort((left, right) =>
			compareNumericTokenRows(left, right, valuesByDomain, textSizeOrder),
		);
	return `<div class="text-size-grid">${sizeRows
		.map((row) => {
			const fontSize = getPreviewFontSize(row.value);
			const lineHeight = lineHeightByName.get(row.name);
			return `<article class="text-size-card">
				<div class="text-preview"${fontSize ? ` style="font-size:${escapeAttribute(fontSize)}"` : ""}>Type</div>
				<div class="token-pair">
					<span>${escapeHtml(row.name)}</span>
					<code>${escapeHtml(row.value)}</code>
				</div>
				${lineHeight ? `<div class="token-note">leading ${escapeHtml(lineHeight)}</div>` : ""}
			</article>`;
		})
		.join("")}</div>`;
};

const renderFontWeightGrid = (rows: readonly ExportTokenRow[]) =>
	`<div class="font-weight-grid">${rows
		.map(
			(row) => `<article class="font-weight-card">
				<div class="weight-preview" style="font-weight:${escapeAttribute(row.value)}">Aa</div>
				<div class="token-pair token-pair--compact">
					<span>${escapeHtml(row.name)}</span>
					<code>${escapeHtml(row.value)}</code>
				</div>
			</article>`,
		)
		.join("")}</div>`;

const renderRhythmTokenList = (rows: readonly ExportTokenRow[]) =>
	`<div class="rhythm-grid">${[...rows]
		.sort((left, right) => compareByOrder(left.name, right.name, rhythmOrder))
		.map(
			(row) => `<div class="rhythm-row">
				<span>${escapeHtml(getDisplayTokenName(row))}</span>
				<code>${escapeHtml(row.value)}</code>
			</div>`,
		)
		.join("")}</div>`;

const renderTypeSection = (index: string, rows: readonly ExportTokenRow[]) => {
	const fontRows = rowsForDomain(rows, "font");
	const textRows = rowsForDomain(rows, "text", textSizeOrder);
	const textSizeCount = textRows.filter(
		(row) => !row.name.endsWith("--line-height"),
	).length;
	const weightRows = rowsForDomain(rows, "font-weight", fontWeightOrder);
	const leadingRows = rowsForDomain(rows, "leading", rhythmOrder);
	const trackingRows = rowsForDomain(rows, "tracking", rhythmOrder);

	return renderSection({
		index,
		title: "Type",
		description: "Font, size, weight, leading, and tracking tokens.",
		count: rows.length,
		content: `<div class="visual-stack">
			${renderSubgroup({
				title: "Font families",
				description: "Project font stacks.",
				count: fontRows.length,
				content: renderFontFamilyGrid(fontRows),
			})}
			${renderSubgroup({
				title: "Text sizes",
				description: "Size tokens paired with their line-height metadata.",
				count: textSizeCount,
				content: renderTextSizeGrid(textRows),
			})}
			${renderSubgroup({
				title: "Font weights",
				description: "Numeric weight scale.",
				count: weightRows.length,
				content: renderFontWeightGrid(weightRows),
			})}
			<div class="two-column-grid">
				${renderSubgroup({
					title: "Leading",
					description: "Line-height tokens.",
					count: leadingRows.length,
					content: renderRhythmTokenList(leadingRows),
				})}
				${renderSubgroup({
					title: "Tracking",
					description: "Letter-spacing tokens.",
					count: trackingRows.length,
					content: renderRhythmTokenList(trackingRows),
				})}
			</div>
		</div>`,
	});
};

const renderLengthScaleList = (
	rows: readonly ExportTokenRow[],
	order?: readonly string[],
) => {
	const valuesByDomain = buildTokenValueMap(rows);
	const sortedRows = [...rows].sort((left, right) =>
		compareNumericTokenRows(left, right, valuesByDomain, order),
	);
	const maxLength = sortedRows.reduce((max, row) => {
		const length = resolveNumericTokenValue(row, valuesByDomain);
		return length === null ? max : Math.max(max, length);
	}, 0);
	return `<div class="length-scale-list">${sortedRows
		.map((row) => {
			const length = resolveNumericTokenValue(row, valuesByDomain);
			const width =
				length === null || maxLength === 0
					? 24
					: Math.max(10, Math.min(100, (length / maxLength) * 100));
			return `<div class="length-row">
				<span>${escapeHtml(getDisplayTokenName(row))}</span>
				<div class="length-track" aria-hidden="true"><div style="width:${width}%"></div></div>
				<code>${escapeHtml(row.value)}</code>
			</div>`;
		})
		.join("")}</div>`;
};

const renderRadiusGrid = (rows: readonly ExportTokenRow[]) => {
	const valuesByDomain = buildTokenValueMap(rows);
	const sortedRows = [...rows].sort((left, right) =>
		compareNumericTokenRows(left, right, valuesByDomain, radiusSizeOrder),
	);
	return `<div class="radius-grid">${sortedRows
		.map(
			(row) => `<article class="radius-card">
				<div class="radius-preview" style="border-radius:${escapeAttribute(row.value)}" aria-hidden="true"></div>
				<div class="token-pair token-pair--compact">
					<span>${escapeHtml(getDisplayTokenName(row))}</span>
					<code>${escapeHtml(row.value)}</code>
				</div>
			</article>`,
		)
		.join("")}</div>`;
};

const getShadowGroupDomain = (row: ExportTokenRow): TailwindTokenDomain => {
	if (row.domain === "shadow" && /\binset\b/i.test(row.value)) {
		return "inset-shadow";
	}
	return row.domain;
};

// Split a comma-separated shadow list at the top level (commas inside `rgb(…)`
// etc. are ignored) so each layer can be wrapped in its own `drop-shadow()`.
const splitTopLevelCommas = (value: string): string[] => {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "(") depth++;
		else if (ch === ")") depth = Math.max(0, depth - 1);
		else if (ch === "," && depth === 0) {
			parts.push(value.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(value.slice(start));
	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
};

// `--drop-shadow-*` values are filter shadows: a multi-layer token like
// `0 1px 2px …, 0 1px 1px …` renders as `drop-shadow(…) drop-shadow(…)`.
const toDropShadowFilter = (value: string): string =>
	splitTopLevelCommas(value)
		.map((shadow) => `drop-shadow(${shadow})`)
		.join(" ");

const renderShadowPreview = (row: ExportTokenRow): string => {
	if (row.domain === "text-shadow") {
		return `<span style="text-shadow:${escapeAttribute(row.value)}">Aa</span>`;
	}
	if (row.domain === "drop-shadow") {
		// box-shadow would render the wrong shape; drop shadows need `filter`.
		return `<i style="filter:${escapeAttribute(toDropShadowFilter(row.value))}" aria-hidden="true"></i>`;
	}
	return `<i style="box-shadow:${escapeAttribute(row.value)}" aria-hidden="true"></i>`;
};

const renderShadowGrid = (rows: readonly ExportTokenRow[]) =>
	`<div class="shadow-grid">${[...rows]
		.sort((left, right) => {
			const domainComparison =
				(shadowDomainOrder.get(left.domain) ?? Number.MAX_SAFE_INTEGER) -
				(shadowDomainOrder.get(right.domain) ?? Number.MAX_SAFE_INTEGER);
			if (domainComparison !== 0) return domainComparison;
			return compareByOrder(left.name, right.name, shadowSizeOrder);
		})
		.map(
			(row) => `<article class="shadow-card">
				<div class="shadow-preview">
					${renderShadowPreview(row)}
				</div>
				<div class="token-name">${escapeHtml(getDisplayTokenName(row))}</div>
				<div class="token-value">${escapeHtml(row.value)}</div>
			</article>`,
		)
		.join("")}</div>`;

const shadowGroupDescriptions: Partial<Record<TailwindTokenDomain, string>> = {
	shadow: "Outer box shadows.",
	"inset-shadow": "Inset box shadows.",
	"drop-shadow": "Filter drop shadows.",
	"text-shadow": "Text shadows.",
};

const renderShadowTokenGroups = (rows: readonly ExportTokenRow[]) => {
	const groups = [...shadowDomainOrder.keys()]
		.map((domain) => ({
			domain,
			rows: rows.filter((row) => getShadowGroupDomain(row) === domain),
		}))
		.filter((group) => group.rows.length > 0);
	return `<div class="shadow-token-groups">${groups
		.map((group) =>
			renderSubgroup({
				title: getDomainLabel(group.domain),
				description: shadowGroupDescriptions[group.domain],
				count: group.rows.length,
				content: renderShadowGrid(group.rows),
			}),
		)
		.join("")}</div>`;
};

const renderSpaceSection = (index: string, rows: readonly ExportTokenRow[]) => {
	const spacingRows = rowsForDomain(rows, "spacing");
	const breakpointRows = rowsForDomain(rows, "breakpoint", [
		"sm",
		"md",
		"lg",
		"xl",
		"2xl",
	]);
	const containerRows = rowsForDomain(rows, "container", containerSizeOrder);
	const radiusRows = rowsForDomain(rows, "radius", radiusSizeOrder);
	const shadowRows = rows.filter((row) => shadowDomainOrder.has(row.domain));

	return renderSection({
		index,
		title: "Space",
		description: "Spacing rhythm, breakpoints, containers, radii, and shadows.",
		count: rows.length,
		content: `<div class="visual-stack">
			<div class="space-top-grid">
				${renderSubgroup({
					title: "Spacing",
					description: "Base spacing scale.",
					count: spacingRows.length,
					content: renderLengthScaleList(spacingRows),
				})}
				${renderSubgroup({
					title: "Breakpoints",
					description: "Responsive viewport thresholds.",
					count: breakpointRows.length,
					content: renderLengthScaleList(breakpointRows, [
						"sm",
						"md",
						"lg",
						"xl",
						"2xl",
					]),
				})}
				${renderSubgroup({
					title: "Containers",
					description: "Layout container widths.",
					count: containerRows.length,
					content: renderLengthScaleList(containerRows, containerSizeOrder),
				})}
			</div>
			${renderSubgroup({
				title: "Radii",
				description: "Corner radius tokens.",
				count: radiusRows.length,
				content: renderRadiusGrid(radiusRows),
			})}
			${renderSubgroup({
				title: "Shadows",
				description: "Outer, inset, drop, and text shadows.",
				count: shadowRows.length,
				content: renderShadowTokenGroups(shadowRows),
			})}
		</div>`,
	});
};

const renderDomainListSection = (
	domain: TailwindTokenDomain,
	rows: readonly ExportTokenRow[],
) => {
	if (rows.length === 0) return "";
	return `<section class="token-domain-section">
		<header class="token-domain-header">
			<span>${escapeHtml(getDomainLabel(domain))}</span>
			<i aria-hidden="true"></i>
			<code>${rows.length.toLocaleString()}</code>
		</header>
		<div class="system-token-rows">${rows.map(renderTokenCard).join("")}</div>
	</section>`;
};

const visualDomainSet = new Set<TailwindTokenDomain>([
	"color",
	"font",
	"text",
	"font-weight",
	"leading",
	"tracking",
	"spacing",
	"breakpoint",
	"container",
	"radius",
	"shadow",
	"inset-shadow",
	"drop-shadow",
	"text-shadow",
]);

const getRowsForDomains = (
	rowsByDomain: Map<TailwindTokenDomain, ExportTokenRow[]>,
	domains: readonly TailwindTokenDomain[],
) =>
	domains
		.flatMap((domain) => rowsByDomain.get(domain) ?? [])
		.sort(compareTokenRows);

const renderEditorDomainView = (
	rowsByDomain: Map<TailwindTokenDomain, ExportTokenRow[]>,
) => {
	const sections: string[] = [];
	const colorRows = getRowsForDomains(rowsByDomain, ["color"]);
	const typeRows = getRowsForDomains(rowsByDomain, [
		"font",
		"text",
		"font-weight",
		"leading",
		"tracking",
	]);
	const spaceRows = getRowsForDomains(rowsByDomain, [
		"spacing",
		"breakpoint",
		"container",
		"radius",
		"shadow",
		"inset-shadow",
		"drop-shadow",
		"text-shadow",
	]);

	if (colorRows.length > 0) {
		sections.push(renderColorSection("01", colorRows));
	}
	if (typeRows.length > 0) {
		sections.push(
			renderTypeSection(String(sections.length + 1).padStart(2, "0"), typeRows),
		);
	}
	if (spaceRows.length > 0) {
		sections.push(
			renderSpaceSection(
				String(sections.length + 1).padStart(2, "0"),
				spaceRows,
			),
		);
	}

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		if (visualDomainSet.has(domain)) {
			continue;
		}
		const rows = rowsByDomain.get(domain) ?? [];
		if (rows.length > 0) {
			sections.push(renderDomainListSection(domain, rows));
		}
	}

	return sections.join("");
};

const renderCustomProperties = (storage: TailwindTokenStorage) => {
	const entries = Object.entries(storage.customProperties ?? {}).sort(
		([left], [right]) =>
			left.localeCompare(right, undefined, { numeric: true }),
	);
	if (entries.length === 0) {
		return "";
	}
	const rows = entries.map(
		([name, value]) =>
			({
				domain: "color",
				name,
				value,
				status: "added",
			}) satisfies ExportTokenRow,
	);
	return renderSection({
		index: "99",
		title: "Custom Properties",
		description: "Custom CSS variables outside the fixed Tailwind domains.",
		count: rows.length,
		content: `<div class="domain-list">${rows.map(renderTokenCard).join("")}</div>`,
	});
};

export const renderTailwindTokenHtml = ({
	storage,
	system,
}: {
	storage: TailwindTokenStorage;
	system: TailwindTokenExportSystem;
}) => {
	const rows = buildTailwindTokenExportRows(storage);
	const rowsByDomain = new Map<TailwindTokenDomain, ExportTokenRow[]>();
	for (const row of rows) {
		const domainRows = rowsByDomain.get(row.domain) ?? [];
		domainRows.push(row);
		rowsByDomain.set(row.domain, domainRows);
	}
	const title = `${system.systemName} Design Tokens`;

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)}</title>
	<style>
		:root {
			color-scheme: light;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			background: #ffffff;
			color: #0f172a;
		}
		* { box-sizing: border-box; }
		body { margin: 0; background: #ffffff; }
		main { min-width: 0; }
		.masthead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; border-bottom: 1px solid #e2e8f0; background: #ffffff; padding: 32px 40px 28px; }
		.masthead h1 { margin: 6px 0 10px; color: #0f172a; font-size: 28px; line-height: 1.1; font-weight: 650; letter-spacing: 0; }
		.masthead p { margin: 0; color: #64748b; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 12px; }
		.title-row { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 12px; }
		.sync-badge { display: inline-flex; align-items: center; border: 1px solid #86efac; background: #dcfce7; padding: 4px 10px; color: #047857; font-size: 11px; font-weight: 650; }
		.sync-badge::before { content: ""; width: 7px; height: 7px; margin-right: 7px; background: currentColor; }
		.eyebrow { margin: 0; color: #94a3b8; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
		.summary { color: #94a3b8; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 11px; }
		.token-section { border-bottom: 1px solid #f1f5f9; padding: 32px 40px; }
		.section-header { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; margin-bottom: 26px; }
		.section-title { display: flex; min-width: 0; align-items: baseline; gap: 14px; }
		.section-index { color: #cbd5e1; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 13px; }
		.section-title h2 { margin: 0; color: #0f172a; font-size: 20px; line-height: 1.1; font-weight: 650; }
		.section-title p { margin: 0; color: #64748b; font-size: 13px; }
		.section-count { color: #94a3b8; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 11px; }
		.token-groups { display: flex; min-width: 0; flex-direction: column; gap: 24px; }
		.token-group { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
		.group-heading { display: flex; align-items: center; gap: 8px; }
		.group-heading span { background: #f8fafc; padding: 6px 20px; color: #64748b; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
		.group-heading code, .section-count { font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; }
		.group-heading code { color: #94a3b8; font-size: 10px; }
		.color-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5rem, 7.25rem)); justify-content: start; gap: 8px; }
		.color-card, .token-card { min-width: 0; border: 1px solid #e2e8f0; background: #ffffff; }
		.color-card__swatch { height: 44px; border-bottom: 1px solid #e2e8f0; }
		.color-card__body { min-width: 0; padding: 8px; }
		.token-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 11px; font-weight: 650; }
		.token-value { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64748b; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 10px; }
		.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 240px)); justify-content: start; gap: 10px; }
		.domain-list { display: flex; min-width: 0; flex-direction: column; }
		.token-card { display: grid; grid-template-columns: 22px minmax(0,1fr); align-items: center; gap: 10px; padding: 10px 12px; }
		.domain-list .token-card + .token-card { border-top: 0; }
		.token-domain-section { display: flex; flex-direction: column; }
		.token-domain-header { display: flex; width: 100%; align-items: center; gap: 8px; background: #f8fafc; padding: 10px 12px; }
		.token-domain-header span { color: #64748b; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
		.token-domain-header i { width: 4px; height: 4px; border-radius: 999px; background: #cbd5e1; }
		.token-domain-header code { color: #64748b; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 10px; font-style: normal; }
		.system-token-rows { display: flex; flex-direction: column; }
		.system-token-rows .token-card { display: flex; align-items: center; gap: 8px; border: 0; border-top: 1px solid #f1f5f9; padding: 8px 16px; }
		.system-token-rows .token-card__content { display: contents; }
		.system-token-rows .token-name { flex: 1; font-size: 12px; }
		.system-token-rows .token-value { margin-top: 0; font-size: 10px; }
		.swatch { display: inline-block; width: 14px; height: 14px; border: 1px solid #cbd5e1; vertical-align: middle; }
		.swatch--empty { background: linear-gradient(135deg, transparent 46%, #cbd5e1 47%, #cbd5e1 53%, transparent 54%), #f8fafc; }
		.visual-stack { display: flex; min-width: 0; flex-direction: column; gap: 28px; }
		.visual-subgroup { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
		.subgroup-heading { display: flex; min-width: 0; align-items: baseline; gap: 8px; }
		.subgroup-heading > span { flex-shrink: 0; background: #f8fafc; padding: 6px 20px; color: #64748b; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
		.subgroup-heading p { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; color: #64748b; font-size: 11px; }
		.subgroup-heading code { margin-left: auto; color: #94a3b8; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 10px; }
		.font-family-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 16rem)); justify-content: start; gap: 8px; }
		.font-family-card, .text-size-card, .font-weight-card, .radius-card, .shadow-card { min-width: 0; border: 1px solid #e2e8f0; background: #ffffff; padding: 12px; }
		.font-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #0f172a; font-size: 18px; }
		.token-pair { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
		.token-pair span, .rhythm-row span, .length-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 11px; font-weight: 650; }
		.token-pair code, .rhythm-row code, .length-row code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64748b; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 10px; font-weight: 400; }
		.token-pair--compact { gap: 8px; }
		.text-size-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 11rem)); justify-content: start; gap: 8px; }
		.text-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #0f172a; font-weight: 500; }
		.token-note { margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8; font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; font-size: 10px; }
		.font-weight-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 8rem)); justify-content: start; gap: 8px; }
		.weight-preview { color: #0f172a; font-size: 24px; line-height: 1; }
		.two-column-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; }
		.rhythm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 16rem)); justify-content: start; gap: 8px; }
		.rhythm-row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid #e2e8f0; background: #ffffff; padding: 8px 12px; }
		.space-top-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr); gap: 28px; }
		.length-scale-list { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
		.length-row { display: grid; min-width: 0; grid-template-columns: 4.5rem minmax(0,1fr) 5.25rem; align-items: center; gap: 12px; border: 1px solid #e2e8f0; background: #ffffff; padding: 8px 12px; }
		.length-track { height: 8px; background: #f1f5f9; }
		.length-track div { height: 100%; background: #06b6d4; }
		.radius-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 8rem)); justify-content: start; gap: 8px; }
		.radius-preview { height: 36px; border: 1px solid #06b6d4; background: #ecfeff; }
		.shadow-token-groups { display: flex; min-width: 0; flex-direction: column; gap: 24px; }
		.shadow-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 12rem)); justify-content: start; gap: 8px; }
		.shadow-preview { display: flex; height: 48px; align-items: center; justify-content: center; background: #f8fafc; }
		.shadow-preview span { color: #0f172a; font-size: 20px; font-weight: 650; }
		.shadow-preview i { display: block; width: 28px; height: 28px; background: #ffffff; }
		.shadow-card .token-name { margin-top: 8px; }
		@media (max-width: 720px) {
			.masthead, .token-section { padding: 28px 16px; }
			.masthead, .section-header, .section-title { align-items: stretch; flex-direction: column; }
			.summary { align-items: flex-start; }
			.color-grid, .card-grid, .font-family-grid, .text-size-grid, .font-weight-grid, .radius-grid, .shadow-grid { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); }
			.two-column-grid, .space-top-grid { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<main>
		<header class="masthead">
			<div>
				<p class="eyebrow">Design tokens</p>
				<div class="title-row">
					<h1>${escapeHtml(system.systemName)}</h1>
					<span class="sync-badge">Synced</span>
				</div>
				<p>${escapeHtml(system.cssPath)} · Tailwind ${escapeHtml(storage.metadata.tailwindBaselineVersion)} · synced ${escapeHtml(formatDate(storage.metadata.syncedAt))}</p>
			</div>
			<div class="summary" aria-label="Token summary">
				<div>${rows.length.toLocaleString()} tokens · ${TAILWIND_TOKEN_DOMAINS.length.toLocaleString()} domains</div>
			</div>
		</header>
		${renderEditorDomainView(rowsByDomain)}
		${renderCustomProperties(storage)}
	</main>
</body>
</html>`;
};
