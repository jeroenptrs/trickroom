/**
 * Read-only readout, shown inside a property panel, of the custom `@utility`
 * classes on the current layer that fold into that panel's domain (e.g. the
 * Background panel lists `bg-penn-app`, Typography lists `text-interaction-sm`).
 *
 * These utilities are not structured-editable — the panel can't offer controls
 * for an opaque `@apply`/`--value()` utility — so we surface them as chips so
 * the designer can see they're applied rather than treating them as "unknown".
 */

import { useMemo } from "react";
import {
	useCustomUtilityDomains,
	useResolvedCustomUtilities,
} from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import { splitClassLayerTokens } from "../../../utils/class-layers";
import {
	type ClassifyContext,
	classifyParsedClass,
	parseClassName,
} from "../../../utils/tailwind-classname";
import type { CustomUtilityDomain } from "../../../utils/tailwind-css-property-domains";

const EMPTY_COLOR_TOKENS: ReadonlySet<string> = new Set();

/**
 * Pure: the class tokens in `className` that classify as custom utilities whose
 * folded domains include `domain`, in source order, de-duplicated.
 */
export function selectCustomUtilitiesForDomain({
	className,
	domain,
	context,
	domainsByRoot,
}: {
	className: string;
	domain: CustomUtilityDomain;
	context: ClassifyContext;
	domainsByRoot: ReadonlyMap<string, readonly string[]>;
}): string[] {
	const seen = new Set<string>();
	const tokens: string[] = [];
	for (const token of splitClassLayerTokens(className)) {
		if (seen.has(token)) continue;
		const parsed = parseClassName(token)[0];
		if (!parsed) continue;
		const intent = classifyParsedClass(parsed, context);
		if (intent.kind !== "custom-functional") continue;
		if (domainsByRoot.get(intent.property)?.includes(domain)) {
			seen.add(token);
			tokens.push(token);
		}
	}
	return tokens;
}

export function DomainCustomUtilities({
	className,
	domain,
}: {
	className: string;
	domain: CustomUtilityDomain;
}) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);
	const domainsByRoot = useCustomUtilityDomains(systemId);

	const tokens = useMemo(
		() =>
			selectCustomUtilitiesForDomain({
				className,
				domain,
				context: { colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots },
				domainsByRoot,
			}),
		[className, domain, customUtilityRoots, domainsByRoot],
	);

	if (tokens.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-wrap items-center gap-1 px-3 py-2">
			<span className="mr-1 text-[10px] text-slate-400">Custom</span>
			{tokens.map((token) => (
				<span
					key={token}
					className="bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
					title="Custom @utility — edit in the Classes tab"
				>
					{token}
				</span>
			))}
		</div>
	);
}
