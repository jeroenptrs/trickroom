import { describe, expect, it } from "vitest";
import type { Node, TrickroomConfig } from "../types";
import { exportDesignBoards } from "./export-design";

const config: TrickroomConfig = { name: "Demo Project" };

function board(name: string): Node {
	return {
		id: `board-${name}`,
		props: {
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
			"data-trickroom-role": "branch",
			"data-trickroom-name": name,
			className: "flex p-4",
		},
		children: [
			{
				id: `text-${name}`,
				props: {
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "text",
					"data-trickroom-role": "text",
					"data-trickroom-name": "Label",
					className: "text-sm",
				},
				children: "Hi",
			},
		],
	};
}

describe("exportDesignBoards", () => {
	it("renders each board to a self-contained html with the right filename", async () => {
		const result = await exportDesignBoards({
			projectRoot: process.cwd(),
			config,
			boards: [board("Home"), board("About")],
			systemId: null,
			projectName: "Demo Project",
			designName: "Landing",
			epoch: 1_700_000_000,
		});

		expect(result.epoch).toBe(1_700_000_000);
		expect(result.systemId).toBeNull();
		expect(result.files.map((file) => file.name)).toEqual(["Home", "About"]);
		expect(result.files[0].filename).toBe(
			"Demo Project — Landing — Home — 1700000000.html",
		);
		expect(result.files[0].html).toContain("<!doctype html>");
		expect(result.files[0].html).toContain(
			"<title>Demo Project — Landing — Home</title>",
		);
		// Baseline Tailwind got compiled in for the used class.
		expect(result.files[0].html).toContain("text-sm");
	});
});
