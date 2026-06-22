import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { Switch } from "../components/ui/switch";
import { Text } from "../components/ui/text";

/** Marker class for the ephemeral preview wrapper; not persisted to design data. */
export const STAGE_PREVIEW_CONTAINER_CLASS = "trickroom-stage-preview-container";

export function getStagePreviewContainerClassName(enabled: boolean) {
	return enabled
		? `${STAGE_PREVIEW_CONTAINER_CLASS} dark`
		: STAGE_PREVIEW_CONTAINER_CLASS;
}

type StagePreviewDarkModeContextValue = {
	enabled: boolean;
	setEnabled: (enabled: boolean) => void;
};

const StagePreviewDarkModeContext = createContext<
	StagePreviewDarkModeContextValue | undefined
>(undefined);

export function StagePreviewDarkModeProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [enabled, setEnabled] = useState(false);
	const value = useMemo(
		() => ({
			enabled,
			setEnabled,
		}),
		[enabled],
	);

	return (
		<StagePreviewDarkModeContext.Provider value={value}>
			{children}
		</StagePreviewDarkModeContext.Provider>
	);
}

export function useStagePreviewDarkMode() {
	const context = useContext(StagePreviewDarkModeContext);
	if (!context) {
		throw new Error(
			"useStagePreviewDarkMode must be used within StagePreviewDarkModeProvider",
		);
	}
	return context;
}

export function StagePreviewDarkModeToggle() {
	const { enabled, setEnabled } = useStagePreviewDarkMode();
	const handleCheckedChange = useCallback(
		(checked: boolean) => {
			setEnabled(checked);
		},
		[setEnabled],
	);

	return (
		<section className="flex flex-col gap-2 border-b border-slate-200 pb-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<Text variant="label" className="text-[11px] text-slate-700">
						Dark mode preview
					</Text>
					<p className="mt-0.5 text-[11px] text-slate-500">
						Adds a temporary <code className="font-mono">dark</code> class on the
						stage container. Not saved to the file.
					</p>
				</div>
				<Switch
					checked={enabled}
					onCheckedChange={handleCheckedChange}
					aria-label="Toggle dark mode preview"
					title="Toggle dark mode preview"
				/>
			</div>
		</section>
	);
}
