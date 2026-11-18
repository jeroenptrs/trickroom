import type { ReactNode } from "react";
import { Kbd } from "./kbd";

/** A keyboard hint: the key, then its label in the body font. */
function KbdHint({ keys, label }: { keys: ReactNode; label: ReactNode }) {
	return (
		<span data-slot="kbd-hint" className="inline-flex items-center gap-1.5">
			<Kbd>{keys}</Kbd>
			<span className="text-xs text-slate-500">{label}</span>
		</span>
	);
}

export { KbdHint };
