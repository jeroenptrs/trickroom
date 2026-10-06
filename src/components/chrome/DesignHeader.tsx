import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
	ArrowLeft,
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightClose,
	PanelRightOpen,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
	setDesignName,
	useDesignName,
	useDesignSystemId,
	useDesignSystemName,
} from "../../stores/design-store";
import {
	type EditorChromePanel,
	toggleEditorPanel,
	useEditorPanelOpen,
} from "../../stores/editor-chrome-store";
import { OpenDesignTokensButton } from "../OpenDesignTokensButton";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const PANEL_TOGGLES = {
	rail: {
		name: "layers",
		shortcut: "Alt+[",
		CloseIcon: PanelLeftClose,
		OpenIcon: PanelLeftOpen,
	},
	inspector: {
		name: "properties",
		shortcut: "Alt+]",
		CloseIcon: PanelRightClose,
		OpenIcon: PanelRightOpen,
	},
} as const satisfies Record<
	EditorChromePanel,
	{
		name: string;
		shortcut: string;
		CloseIcon: typeof PanelLeftClose;
		OpenIcon: typeof PanelLeftOpen;
	}
>;

export function getPanelToggleLabel(panel: EditorChromePanel, open: boolean) {
	return `${open ? "Hide" : "Show"} ${PANEL_TOGGLES[panel].name}`;
}

export function getPanelToggleTitle(panel: EditorChromePanel, open: boolean) {
	return `${getPanelToggleLabel(panel, open)} (${PANEL_TOGGLES[panel].shortcut})`;
}

export function getPanelToggleIcon(panel: EditorChromePanel, open: boolean) {
	const { CloseIcon, OpenIcon } = PANEL_TOGGLES[panel];
	return open ? CloseIcon : OpenIcon;
}

/**
 * Collapses or expands a design editor side panel; the icon shows which it
 * does. Same shell as the tokens button next to it.
 */
export function DesignPanelToggle({ panel }: { panel: EditorChromePanel }) {
	const open = useEditorPanelOpen("design", panel);
	const Icon = getPanelToggleIcon(panel, open);

	return (
		<Button
			type="button"
			variant="block"
			className="flex size-7 shrink-0 items-center justify-center p-0"
			onClick={() => toggleEditorPanel("design", panel)}
			title={getPanelToggleTitle(panel, open)}
			aria-label={getPanelToggleLabel(panel, open)}
			aria-expanded={open}
		>
			<Icon className="size-4 text-slate-900" aria-hidden="true" />
		</Button>
	);
}

function DesignTitle() {
	const designName = useDesignName();
	const [isRenaming, setIsRenaming] = useState(false);
	const [draftName, setDraftName] = useState("");
	const cancelledRef = useRef(false);

	const startRenaming = () => {
		cancelledRef.current = false;
		setDraftName(designName);
		setIsRenaming(true);
	};

	const confirmRename = () => {
		const nextName = draftName.trim();
		if (!nextName) {
			setDraftName(designName);
			return;
		}

		setDesignName(nextName);
		setIsRenaming(false);
	};

	const cancelRename = () => {
		cancelledRef.current = true;
		setIsRenaming(false);
	};

	useHotkey("Enter", confirmRename, {
		enabled: isRenaming,
		ignoreInputs: false,
	});
	useHotkey("Escape", cancelRename, { enabled: isRenaming });

	if (isRenaming) {
		return (
			<Input
				variant="inline"
				className="w-full text-[13px] font-medium"
				value={draftName}
				onChange={(e) => setDraftName(e.target.value)}
				onBlur={() => {
					if (!cancelledRef.current) confirmRename();
				}}
				onFocus={(e) => (e.target as HTMLInputElement).select()}
				autoFocus
			/>
		);
	}

	return (
		<ButtonPrimitive
			className="w-full truncate text-left text-[13px] font-medium text-slate-950 hover:bg-slate-100 cursor-text focus-visible:outline-none"
			onClick={startRenaming}
		>
			{designName}
		</ButtonPrimitive>
	);
}

/**
 * Design header row: back to the project, the design name (click to rename)
 * and its system, then the tokens button. Rendered by the layers rail and,
 * while the rail is collapsed, at the start of the workspace toolbar.
 * `children` trail the tokens button.
 */
export function DesignHeaderContent({ children }: { children?: ReactNode }) {
	const navigate = useNavigate();
	const systemName = useDesignSystemName();
	const systemId = useDesignSystemId();
	const subtitle = systemName
		? `${systemName} · design system`
		: "No design system";

	return (
		<>
			<Button
				variant="block"
				className="flex size-7 shrink-0 items-center justify-center p-0"
				onClick={() => navigate("/")}
				title="Back to project"
			>
				<ArrowLeft className="size-4 text-slate-500" />
			</Button>
			<div className="flex min-w-0 flex-1 flex-col">
				<DesignTitle />
				<span className="truncate text-[10px] text-slate-400">{subtitle}</span>
			</div>
			<OpenDesignTokensButton systemId={systemId} />
			{children}
		</>
	);
}
