import { getAnnotationMemoryReference } from "../services/annotation-model";
import type { AnnotationView } from "../services/annotations.types";

/**
 * The memory note a resolved annotation graduates to ("Save as memory
 * note"): the designer's remark, the final reply, and a reference to the
 * target (`{{layer:<designId>/<elementId>}}` for a layer), so the note
 * links back to the layer and is reported broken once it is gone. Memory
 * is the committed, durable form; the annotation is not.
 */
export function buildAnnotationMemoryNote(
	annotation: Pick<AnnotationView, "entries" | "target">,
	targetName?: string,
) {
	const remark = annotation.entries.find((entry) => entry.kind === "remark");
	const remarkText = remark?.kind === "remark" ? remark.body.trim() : "";
	let finalReply = "";
	for (const entry of annotation.entries.slice(1)) {
		const text =
			entry.kind === "reply" || entry.kind === "remark"
				? entry.body
				: entry.kind === "change"
					? (entry.body ?? entry.change.summary)
					: entry.kind === "resolution"
						? (entry.summary ?? "")
						: "";
		if (text.trim()) finalReply = text.trim();
	}
	const firstLine = remarkText.split("\n", 1)[0] ?? "";
	const title =
		firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
	const reference = getAnnotationMemoryReference(annotation.target);
	const body = [
		remarkText,
		finalReply && finalReply !== remarkText ? finalReply : "",
		`On ${targetName ? `${targetName} ` : ""}${reference}`,
	]
		.filter(Boolean)
		.join("\n\n");
	return { title: title || undefined, body };
}
