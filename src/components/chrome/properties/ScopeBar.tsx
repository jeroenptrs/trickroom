import { type ReactNode, useMemo, useState } from "react";
import { useDesignSystemId } from "../../../stores/design-store";
import { Button } from "../../ui/button";
import { StatusDot } from "../../ui/status-dot";
import { AddOverrideMenu } from "./OverrideRows";
import { buildOverrideOptions, useBreakpointNames } from "./styleOverrides";
import {
	BASE_SCOPE,
	collectScopeChains,
	isScopeBarEnabled,
	type StyleScope,
	StyleScopeContext,
	scopeVariants,
} from "./styleScope";

/**
 * Owns the Style tab's panel scope (right-rail P3) and renders the scope bar
 * above the sections. Mount keyed by the inspected element so the scope
 * resets to Base on selection change, like the sections' revealed state.
 * With the bar disabled (see `isScopeBarEnabled`) children render without a
 * provider and every row behaves exactly like the base scope.
 */
export function StyleScopeProvider({
	className,
	children,
}: {
	/** The inspected element's full class string (scope cells derive from it). */
	className: string;
	children: ReactNode;
}) {
	const [scope, setScope] = useState(BASE_SCOPE);
	const value = useMemo<StyleScope>(
		() => ({ scope, variants: scopeVariants(scope), setScope }),
		[scope],
	);

	if (!isScopeBarEnabled()) return <>{children}</>;

	return (
		<StyleScopeContext.Provider value={value}>
			<ScopeBar className={className} scope={scope} onScopeChange={setScope} />
			{children}
		</StyleScopeContext.Provider>
	);
}

/**
 * One scope selector for the whole panel: Base, every variant chain the
 * className already uses (dot = that scope holds values), the active scope
 * even while still empty, and a grouped + menu for the rest. Picking a scope
 * makes every override-aware row below read and write that chain's slot.
 */
function ScopeBar({
	className,
	scope,
	onScopeChange,
}: {
	className: string;
	scope: string;
	onScopeChange: (scope: string) => void;
}) {
	const systemId = useDesignSystemId();
	const breakpoints = useBreakpointNames(systemId);

	const usedChains = useMemo(
		() => collectScopeChains(className, breakpoints),
		[className, breakpoints],
	);
	const chains =
		scope !== BASE_SCOPE && !usedChains.includes(scope)
			? [...usedChains, scope]
			: usedChains;
	const options = useMemo(
		() => buildOverrideOptions(breakpoints, new Set(chains)),
		[breakpoints, chains],
	);

	return (
		<div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5">
			<ScopeCell
				label="Base"
				isActive={scope === BASE_SCOPE}
				onSelect={() => onScopeChange(BASE_SCOPE)}
			/>
			{chains.map((chain) => (
				<ScopeCell
					key={chain}
					label={chain}
					hasValues={usedChains.includes(chain)}
					isActive={scope === chain}
					onSelect={() => onScopeChange(chain)}
				/>
			))}
			<AddOverrideMenu
				label="Add scope"
				options={options}
				onAdd={onScopeChange}
			/>
		</div>
	);
}

function ScopeCell({
	label,
	hasValues = false,
	isActive,
	onSelect,
}: {
	label: string;
	/** Renders the cyan dot: the scope already holds values. */
	hasValues?: boolean;
	isActive: boolean;
	onSelect: () => void;
}) {
	return (
		<Button
			type="button"
			variant="block"
			isSelected={isActive}
			onClick={onSelect}
			className={`flex items-center gap-1.5 px-2 py-0.5 text-xs font-normal ${
				isActive ? "" : "inset-shadow-slate-200"
			}`}
		>
			{label}
			{hasValues ? (
				<StatusDot shape="square" tone="syncing" className="size-1" />
			) : null}
		</Button>
	);
}
