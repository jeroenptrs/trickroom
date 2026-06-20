import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens";

export type ResolvedBreakpoint = {
	name: string;
	value: string;
	px: number | null;
	source: "default" | "system";
};

type BreakpointEntry = ResolvedBreakpoint & {
	order: number;
};

const REM_IN_PX = 16;

const defaultBreakpointTokens = defaultTailwindTokensByDomain.breakpoint;

export function parseBreakpointPx(value: string): number | null {
	const trimmed = value.trim();
	const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(px|rem)$/i.exec(trimmed);
	if (!match) return null;

	const numeric = Number.parseFloat(match[1]);
	if (!Number.isFinite(numeric)) return null;

	const unit = match[2].toLowerCase();
	return unit === "rem" ? numeric * REM_IN_PX : numeric;
}

export function resolveBreakpoints(
	systemBreakpoints?: Readonly<Record<string, string>> | null,
): ResolvedBreakpoint[] {
	const entries = new Map<string, BreakpointEntry>();
	let order = 0;

	for (const [name, value] of Object.entries(defaultBreakpointTokens)) {
		entries.set(name, {
			name,
			value,
			px: parseBreakpointPx(value),
			source: "default",
			order,
		});
		order += 1;
	}

	for (const [name, value] of Object.entries(systemBreakpoints ?? {})) {
		const existing = entries.get(name);
		entries.set(name, {
			name,
			value,
			px: parseBreakpointPx(value),
			source: "system",
			order: existing?.order ?? order,
		});
		if (!existing) order += 1;
	}

	return Array.from(entries.values())
		.sort((a, b) => {
			if (a.px !== null && b.px !== null) {
				return a.px - b.px || a.order - b.order;
			}
			if (a.px !== null) return -1;
			if (b.px !== null) return 1;
			return a.order - b.order;
		})
		.map(({ order: _order, ...breakpoint }) => breakpoint);
}

export const DEFAULT_RESOLVED_BREAKPOINTS = resolveBreakpoints();
