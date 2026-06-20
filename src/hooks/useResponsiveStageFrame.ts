import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import type { ResponsiveStageMode } from "../components/responsive-stage-context";

type ResponsiveStageFrameOptions = {
	mode: ResponsiveStageMode;
	responsiveWidth: number;
};

const CANVAS_STAGE_MODE: ResponsiveStageMode = "canvas";

function setIframeDocumentMode(
	iframe: HTMLIFrameElement,
	mode: ResponsiveStageMode,
) {
	iframe.contentDocument?.documentElement?.setAttribute(
		"data-trickroom-stage-mode",
		mode,
	);
}

export function applyResponsiveStageFrameState(
	iframe: HTMLIFrameElement,
	{ mode, responsiveWidth }: ResponsiveStageFrameOptions,
) {
	if (mode === "responsive") {
		iframe.style.width = `${responsiveWidth}px`;
		setIframeDocumentMode(iframe, "responsive");
		return;
	}

	resetResponsiveStageFrameState(iframe);
}

export function resetResponsiveStageFrameState(iframe: HTMLIFrameElement) {
	iframe.style.width = "";
	setIframeDocumentMode(iframe, CANVAS_STAGE_MODE);
}

export function useResponsiveStageFrame(
	iframeRef: RefObject<HTMLIFrameElement | null>,
	options: ResponsiveStageFrameOptions,
) {
	const { mode, responsiveWidth } = options;
	const latestOptionsRef = useRef(options);
	latestOptionsRef.current = options;

	useLayoutEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe) {
			return;
		}

		applyResponsiveStageFrameState(iframe, { mode, responsiveWidth });
	}, [iframeRef, mode, responsiveWidth]);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe) {
			return;
		}

		const applyLatestState = () => {
			applyResponsiveStageFrameState(iframe, latestOptionsRef.current);
		};

		applyLatestState();
		iframe.addEventListener("load", applyLatestState);

		return () => {
			iframe.removeEventListener("load", applyLatestState);
			resetResponsiveStageFrameState(iframe);
		};
	}, [iframeRef]);
}
