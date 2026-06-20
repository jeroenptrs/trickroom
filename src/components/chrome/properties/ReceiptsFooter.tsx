import { useMemo } from "react";
import { splitClassLayerTokens } from "../../../utils/class-layers";
import { Chip } from "../../ui/chip";

/**
 * Sticky footer for the Style tab (right-rail P5, board 02 marker 6).
 * Shows the element's produced class string as scope-tinted chips:
 * base-scope tokens in slate, variant-prefixed tokens in cyan.
 */
export function ReceiptsFooter({ className }: { className: string }) {
	const tokens = useMemo(() => splitClassLayerTokens(className), [className]);

	if (tokens.length === 0) return null;

	return (
		<div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-2">
			<div className="flex flex-col gap-1.5">
				<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
					Produced classes
				</span>
				<div className="flex flex-wrap gap-1">
					{tokens.map((token) => (
						<Chip
							key={token}
							tone={token.includes(":") ? "scope" : "base"}
							className="text-[10px]"
						>
							{token}
						</Chip>
					))}
				</div>
			</div>
		</div>
	);
}
