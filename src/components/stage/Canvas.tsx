export function Canvas() {
	return (
		// biome-ignore lint/a11y/noAriaHiddenOnFocusable: library code
		<canvas
			aria-hidden="true"
			id="trickroom-overlay-canvas"
			style={{
				inset: 0,
				width: "100%",
				height: "100%",
				isolation: "isolate",
				position: "absolute",
				pointerEvents: "none",
			}}
		></canvas>
	);
}
