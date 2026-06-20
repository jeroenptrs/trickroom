import { useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useResolvedDomainTokens } from "../../../hooks/useResolvedDomainTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import { splitClassLayerTokens } from "../../../utils/class-layers";
import {
	buildPropertyModel,
	type ModelOptions,
	type SpacingProperty,
} from "../../../utils/tailwind-classname";
import { BoxModelRows } from "./BoxModelControl";
import { boxTokenOptions } from "./boxModelController";
import { propertyHasEntries } from "./propertySlots";
import { SpacingOverrideRows } from "./SpacingOverrideRows";
import { SectionGroupLabel, StyleSection } from "./StyleSection";
import { resolveSpacingBasePx } from "./sizeTokenOptions";
import { TokenField } from "./TokenField";

type SpacingPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

type GapRowDefinition = {
	property: SpacingProperty;
	label: string;
	fieldLabel: string;
	likely?: boolean;
};

/** Gap "All" full-width, the X/Y pair 2-up (see SIZE_FIELD_ROWS pattern). */
const GAP_FIELD_ROWS: readonly (readonly GapRowDefinition[])[] = [
	[{ property: "gap", label: "Gap", fieldLabel: "All", likely: true }],
	[
		{ property: "gap-x", label: "Gap X", fieldLabel: "X" },
		{ property: "gap-y", label: "Gap Y", fieldLabel: "Y" },
	],
];

const GAP_IDS = GAP_FIELD_ROWS.flat().map((row) => row.property);

/** Base-scope spacing utilities, for the collapsed-header summary chips. */
const SPACING_TOKEN_RE =
	/^-?(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml)-|^gap(?:-x|-y)?-/;

/**
 * Spacing section (right-rail P4): padding and margin render as box-model
 * controls — four spatial token fields around a link toggle that mirrors the
 * class shape — and gap keeps token-field rows (it has no per-side classes).
 * Owns its `StyleSection` shell like every other domain section, so collapsed
 * Spacing rolls its set utilities up as chips too.
 */
export function SpacingProperties({
	className,
	onChange,
}: SpacingPropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	const spacingTokens = useResolvedDomainTokens(systemId, "spacing");
	const spacingBasePx = resolveSpacingBasePx(spacingTokens.values);

	const paddingOptions = useMemo(
		() => boxTokenOptions("padding", spacingBasePx),
		[spacingBasePx],
	);
	const marginOptions = useMemo(
		() => boxTokenOptions("margin", spacingBasePx),
		[spacingBasePx],
	);

	const gapAnySet = GAP_IDS.some((property) =>
		propertyHasEntries(model, property),
	);

	const summary = useMemo(
		() =>
			splitClassLayerTokens(className).filter(
				(token) => !token.includes(":") && SPACING_TOKEN_RE.test(token),
			),
		[className],
	);

	return (
		<StyleSection title="Spacing" summary={summary}>
			<BoxModelRows
				group="padding"
				label="Padding"
				likely
				className={className}
				options={options}
				tokenOptions={paddingOptions}
				onChange={onChange}
			/>
			<BoxModelRows
				group="margin"
				label="Margin"
				likely
				className={className}
				options={options}
				tokenOptions={marginOptions}
				onChange={onChange}
			/>
			<SectionGroupLabel label="Gap" ids={GAP_IDS} anySet={gapAnySet} />
			{GAP_FIELD_ROWS.map((rowGroup) => (
				<div key={rowGroup[0]?.property} className="flex gap-2 empty:hidden">
					{rowGroup.map((row) => (
						<SpacingOverrideRows
							key={row.property}
							label={row.label}
							className={className}
							options={options}
							property={row.property}
							inline
							likely={row.likely}
							rowClassName="min-w-0 flex-1"
							onChange={onChange}
							renderControl={(slot) => (
								<TokenField
									label={row.fieldLabel}
									value={slot.value ?? ""}
									placeholder="0, 4, [13px]"
									options={paddingOptions}
									onCommit={(value) =>
										slot.apply(value.trim() ? value.trim() : null)
									}
								/>
							)}
						/>
					))}
				</div>
			))}
		</StyleSection>
	);
}
