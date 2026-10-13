import { Badge } from "../ui/badge";

const CHIPS = [
	{ key: "added", prefix: "+", label: "added", tone: "success" },
	{ key: "overridden", prefix: "~", label: "overridden", tone: "warning" },
	{ key: "removed", prefix: "-", label: "removed", tone: "danger" },
] as const;

export function SystemDiffChips({
	added,
	overridden,
	removed,
	overriddenLabel,
}: {
	added: number;
	overridden: number;
	removed: number;
	/** "changed" when the counts are changes since the last review. */
	overriddenLabel?: string;
}) {
	const counts = { added, overridden, removed };
	const visibleChips = CHIPS.map((chip) => ({
		...chip,
		label:
			chip.key === "overridden" && overriddenLabel
				? overriddenLabel
				: chip.label,
		count: counts[chip.key],
	})).filter((chip) => chip.count > 0);

	if (visibleChips.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-wrap gap-1.5">
			{visibleChips.map((chip) => (
				<Badge key={chip.key} tone={chip.tone} edge="stamped">
					{chip.prefix}
					{chip.count} {chip.label}
				</Badge>
			))}
		</div>
	);
}
