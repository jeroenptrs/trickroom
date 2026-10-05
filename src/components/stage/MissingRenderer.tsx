import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

type MissingRendererProps = {
	library: string;
	component: string;
	children?: ReactNode;
	onClick?: MouseEventHandler<HTMLDivElement>;
} & { [marker: `data-${string}`]: string | undefined };

// Inline styles keep the diagnostic visible regardless of the linked system's
// Tailwind theme (which may not ship slate/cyan or any default palette).
const frameStyle: CSSProperties = {
	border: "2px dashed #0891b2",
	background: "#f1f5f9",
	color: "#0f172a",
	padding: 8,
	minHeight: 32,
	fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
	fontSize: 12,
};

const labelStyle: CSSProperties = {
	fontWeight: 600,
	marginBottom: 4,
};

/**
 * Stage stand-in for an element whose registry component has no render
 * component (or is not in the registry at all). Rendering nothing hides the
 * whole subtree from the editor, the system editor's draft stage, the capture
 * route, and agent screenshots, so this keeps the subtree visible and names
 * the missing component instead.
 */
export function MissingRenderer({
	library,
	component,
	children,
	onClick,
	...markerProps
}: MissingRendererProps) {
	const componentId = `${library}/${component}`;

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the draft stage selects nodes on click; layer rows are the keyboard path.
		<div
			{...markerProps}
			data-trickroom-missing-renderer={componentId}
			role="note"
			style={frameStyle}
			onClick={onClick}
		>
			<div style={labelStyle}>No renderer for {componentId}</div>
			{children}
		</div>
	);
}
