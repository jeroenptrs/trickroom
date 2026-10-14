import { matchesVariantConfiguration } from "../../services/annotation-model";
import { describeVariantPin } from "../../utils/annotation-presentation";

/**
 * The variant configuration a component annotation is pinned to, as a
 * square chip: cyan while that configuration is in view, slate otherwise.
 * A click switches the configuration in view to it.
 */
export function VariantPinChip({
	variants,
	inView,
	onShow,
}: {
	variants: Readonly<Record<string, string>>;
	inView: Readonly<Record<string, string>>;
	onShow: (variants: Readonly<Record<string, string>>) => void;
}) {
	const shown = matchesVariantConfiguration(variants, inView);
	const label = describeVariantPin(variants);
	return (
		<button
			type="button"
			data-annotation-variant-pin={shown ? "in-view" : "other"}
			className={`max-w-full truncate border px-1.5 py-0.5 text-left font-mono text-[11px] leading-4 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 ${
				shown
					? "border-cyan-500 bg-cyan-50 text-cyan-900"
					: "border-slate-300 bg-white text-slate-700 hover:border-cyan-500 hover:text-cyan-900"
			}`}
			title={
				shown
					? `Pinned to ${label}: in view`
					: `Pinned to ${label}: show this configuration`
			}
			onClick={() => onShow(variants)}
		>
			{label}
		</button>
	);
}
