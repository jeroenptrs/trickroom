import type { ResolvedMemoryReference } from "../../../utils/memory-references";
import { Chip } from "../../ui/chip";
import { Text } from "../../ui/text";
import { buildMemoryBodySegments } from "./memory-reference-editor";

function referenceChipTone(
	reference: ResolvedMemoryReference,
): "scope" | "ghost" | "struck" {
	if (reference.status === "valid") {
		return "scope";
	}
	if (reference.status === "broken") {
		return "struck";
	}
	return "ghost";
}

function referenceChipLabel(reference: ResolvedMemoryReference): string {
	if (reference.label) {
		return reference.label;
	}
	return `${reference.type}:${reference.id}`;
}

export function MemoryNoteBody({
	body,
	references = [],
	onNavigate,
}: {
	body: string;
	references?: ResolvedMemoryReference[];
	onNavigate?: (path: string) => void;
}) {
	const segments = buildMemoryBodySegments(body, references);

	if (segments.length === 0) {
		return null;
	}

	return (
		<Text className="whitespace-pre-wrap text-xs text-slate-700">
			{segments.map((segment, index) => {
				if (segment.kind === "text") {
					return <span key={`text-${index}`}>{segment.text}</span>;
				}

				const { reference } = segment;
				const label = referenceChipLabel(reference);
				const tone = referenceChipTone(reference);
				const canNavigate =
					reference.status === "valid" &&
					reference.deepLink &&
					onNavigate;

				if (canNavigate) {
					return (
						<button
							key={`ref-${reference.start}-${reference.end}`}
							type="button"
							className="mx-0.5 inline align-baseline"
							onClick={() => onNavigate(reference.deepLink as string)}
							title={reference.raw}
						>
							<Chip tone={tone} className="cursor-pointer hover:bg-cyan-100">
								{label}
							</Chip>
						</button>
					);
				}

				return (
					<Chip
						key={`ref-${reference.start}-${reference.end}`}
						tone={tone}
						className="mx-0.5 inline align-baseline"
						title={
							reference.status === "valid"
								? reference.raw
								: `${reference.raw} (${reference.status})`
						}
					>
						{label}
					</Chip>
				);
			})}
		</Text>
	);
}
