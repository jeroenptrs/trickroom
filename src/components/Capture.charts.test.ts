import { describe, expect, it, vi } from "vitest";
import { waitForCharts } from "./Capture";

type FakeChart = { hidden: boolean; state: string };

/** A stage document with a queue of frames, so each frame can change a chart. */
const stageDocument = (
	charts: FakeChart[],
	onFrame: (frame: number) => void,
) => {
	let frame = 0;
	return {
		defaultView: {
			requestAnimationFrame: (callback: () => void) => {
				onFrame(++frame);
				callback();
			},
		},
		querySelectorAll: () =>
			charts
				.filter((chart) => chart.state === "loading")
				.map((chart) => ({
					getClientRects: () => (chart.hidden ? [] : [{}]),
				})),
	} as unknown as Document;
};

describe("waitForCharts", () => {
	it("waits until a visible chart has painted", async () => {
		const chart = { hidden: false, state: "loading" };
		const onFrame = vi.fn((frame: number) => {
			if (frame === 3) chart.state = "ready";
		});
		await waitForCharts(stageDocument([chart], onFrame));
		expect(onFrame).toHaveBeenCalledTimes(3);
	});

	it("does not wait for a chart in a hidden box, which never paints", async () => {
		const onFrame = vi.fn();
		await waitForCharts(
			stageDocument([{ hidden: true, state: "loading" }], onFrame),
		);
		expect(onFrame).not.toHaveBeenCalled();
	});

	it("does not wait for a chart that failed", async () => {
		const onFrame = vi.fn();
		await waitForCharts(
			stageDocument([{ hidden: false, state: "error" }], onFrame),
		);
		expect(onFrame).not.toHaveBeenCalled();
	});
});
