const CHIPS = [
	{
		key: "added",
		prefix: "+",
		label: "added",
		className:
			"bg-emerald-50 text-emerald-700 inset-shadow-[0_0_0_1px] inset-shadow-emerald-200",
	},
	{
		key: "overridden",
		prefix: "~",
		label: "overridden",
		className:
			"bg-amber-50 text-amber-700 inset-shadow-[0_0_0_1px] inset-shadow-amber-200",
	},
	{
		key: "removed",
		prefix: "-",
		label: "removed",
		className:
			"bg-rose-50 text-rose-700 inset-shadow-[0_0_0_1px] inset-shadow-rose-200",
	},
];

export function SystemDiffChips({
	added,
	overridden,
	removed,
}: {
	added: number;
	overridden: number;
	removed: number;
}) {
	if (added === 0 && overridden === 0 && removed === 0) {
		return null;
	}

	const visibleChips = CHIPS.map((chip) => ({
		...chip,
		count:
			chip.key === "added"
				? added
				: chip.key === "overridden"
					? overridden
					: removed,
	})).filter((chip) => chip.count > 0);

	return (
		<div className="flex flex-wrap gap-1.5">
			{visibleChips.map((chip) => (
				<span
					key={chip.key}
					className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold tracking-wider ${chip.className}`}
				>
					{chip.prefix}
					{chip.count} {chip.label}
				</span>
			))}
		</div>
	);
}
