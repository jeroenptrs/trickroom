import { useLayoutEffect, useRef } from "react";

export function useScrollSelectedIntoView(selectedId: string | null) {
	const selectedElementRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!selectedId) {
			return;
		}

		selectedElementRef.current?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [selectedId]);

	return (element: HTMLElement | null) => {
		selectedElementRef.current = element;
	};
}
