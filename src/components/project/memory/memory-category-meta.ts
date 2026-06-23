import {
	MEMORY_CATEGORIES,
	type MemoryCategory,
} from "../../../utils/memory-manifest-service.types";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export const MEMORY_CATEGORY_META: Record<
	MemoryCategory,
	{ label: string; tone: BadgeTone }
> = {
	intent: { label: "Intent", tone: "info" },
	usage: { label: "Usage", tone: "neutral" },
	conventions: { label: "Conventions", tone: "success" },
	constraints: { label: "Constraints", tone: "warning" },
	decision: { label: "Decision", tone: "info" },
	todo: { label: "Todo", tone: "danger" },
};

export const MEMORY_CATEGORY_OPTIONS = MEMORY_CATEGORIES.map((category) => ({
	value: category,
	label: MEMORY_CATEGORY_META[category].label,
}));
