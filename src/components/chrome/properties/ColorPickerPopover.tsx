import { Popover } from "@base-ui/react/popover";
import { useMemo } from "react";
import type { ResolvedColorTokens } from "../../../utils/resolved-color-tokens";
import type { ColorValue } from "../../../utils/tailwind-classname";
import { Button } from "../../ui/button";
import { Text } from "../../ui/text";
import { ColorSwatch } from "./ColorSwatch";

type ColorPickerPopoverProps = {
	/** Visual trigger content (swatch + label). Interactive styles are applied by this component. */
	trigger: React.ReactNode;
	resolved: ResolvedColorTokens;
	onPick: (value: ColorValue) => void;
	onClear: () => void;
};

const UNIVERSAL_KEYWORDS = ["current", "transparent", "inherit"] as const;

export function ColorPickerPopover({
	trigger,
	resolved,
	onPick,
	onClear,
}: ColorPickerPopoverProps) {
	const grouped = useMemo(() => groupTokensByFamily(resolved), [resolved]);

	return (
		<Popover.Root>
			<Popover.Trigger
				render={(props) => (
					<Button
						type="button"
						variant="block"
						{...props}
						className="flex flex-row items-center gap-1.5"
					>
						{trigger}
					</Button>
				)}
			/>
			<Popover.Portal>
				<Popover.Positioner sideOffset={6} align="start">
					<Popover.Popup
						className="bg-slate-50 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 max-w-72 max-h-80 overflow-auto p-2 flex flex-col gap-2"
						data-slot="color-picker-popup"
					>
						<Popover.Close
							render={(props) => (
								<Button
									type="button"
									variant="block"
									{...props}
									className="flex items-center gap-2 text-xs text-left w-full hover:ring-2 hover:ring-cyan-500"
									onClick={(event) => {
										props.onClick?.(event);
										onClear();
									}}
								>
									<ColorSwatch appearance={{ kind: "empty" }} />
									<span className="text-slate-900">No color</span>
								</Button>
							)}
						/>

						<div className="flex flex-col gap-0.5">
							<Text
								variant="label"
								render={<div />}
								className="px-1 text-slate-900/70"
							>
								Universal
							</Text>
							<div className="flex flex-row gap-1 px-1">
								{UNIVERSAL_KEYWORDS.map((keyword) => (
									<Popover.Close
										key={keyword}
										render={(props) => (
											<Button
												type="button"
												variant="block"
												title={keyword}
												{...props}
												className="p-0 h-4 hover:ring-2 hover:ring-cyan-500"
												onClick={(event) => {
													props.onClick?.(event);
													onPick({ kind: "keyword", keyword });
												}}
											>
												<ColorSwatch
													appearance={
														keyword === "transparent"
															? { kind: "transparent" }
															: { kind: "empty" }
													}
												/>
											</Button>
										)}
									/>
								))}
							</div>
						</div>

						<div className="flex flex-col gap-1.5">
							{grouped.map(({ family, entries }) => (
								<div key={family} className="flex flex-col gap-0.5">
									<Text
										variant="label"
										render={<div />}
										className="px-1 capitalize text-slate-900/70"
									>
										{family}
									</Text>
									<div className="flex flex-row flex-wrap gap-1 px-1">
										{entries.map(([token, cssValue]) => (
											<Popover.Close
												key={token}
												render={(props) => (
													<Button
														type="button"
														variant="block"
														title={token}
														{...props}
														className="p-0 h-4 hover:ring-2 hover:ring-cyan-500"
														onClick={(event) => {
															props.onClick?.(event);
															onPick({ kind: "token", token });
														}}
													>
														<ColorSwatch
															appearance={{ kind: "color", cssValue }}
														/>
													</Button>
												)}
											/>
										))}
									</div>
								</div>
							))}
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

type Group = { family: string; entries: ReadonlyArray<[string, string]> };

function groupTokensByFamily(resolved: ResolvedColorTokens): Group[] {
	const families = new Map<string, [string, string][]>();
	for (const [name, value] of resolved.values) {
		const family = familyOf(name);
		const list = families.get(family) ?? [];
		list.push([name, value]);
		families.set(family, list);
	}
	// Order groups by first appearance in the underlying Map (which is
	// insertion order on the resolved set — defaults are pre-sorted).
	return Array.from(families, ([family, entries]) => ({ family, entries }));
}

function familyOf(tokenName: string): string {
	const dashIdx = tokenName.indexOf("-");
	if (dashIdx === -1) return tokenName;
	return tokenName.slice(0, dashIdx);
}
