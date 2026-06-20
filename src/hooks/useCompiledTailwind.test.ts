import { describe, expect, it } from "vitest";
import type { DesignEntity } from "../stores/design-store";
import {
	collectCandidates,
	collectDesignStoreCandidateClassNames,
} from "./useCompiledTailwind";

function entity(
	id: string,
	props: DesignEntity["props"],
	role: DesignEntity["role"] = "branch",
): DesignEntity {
	return {
		id,
		parentId: null,
		props,
		role,
		childIds: [],
	};
}

describe("compiled Tailwind candidate collection", () => {
	it("seeds candidates from the design model for portal content before it mounts", () => {
		const candidates = collectDesignStoreCandidateClassNames({
			trigger: entity("trigger", {
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "tooltip.trigger",
				"data-trickroom-role": "branch",
				className: "inline-flex bg-slate-900",
			}),
			popup: entity("popup", {
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "tooltip.popup",
				"data-trickroom-role": "branch",
				className: "rounded-md bg-brand text-interaction-sm",
			}),
		});

		expect(candidates).toEqual([
			"bg-brand",
			"bg-slate-900",
			"inline-flex",
			"rounded-md",
			"text-interaction-sm",
		]);
	});

	it("includes registry base classes in model candidates", () => {
		const candidates = collectDesignStoreCandidateClassNames({
			separator: entity(
				"separator",
				{
					"data-trickroom-library": "base-ui",
					"data-trickroom-component": "menu.separator",
					"data-trickroom-role": "leaf",
				},
				"leaf",
			),
		});

		expect(candidates).toContain("data-[orientation=horizontal]:h-px");
		expect(candidates).toContain("data-[orientation=vertical]:self-stretch");
	});

	it("merges shell, model, and live DOM candidates", () => {
		const doc = {
			querySelectorAll: () => [
				{ getAttribute: () => "flex bg-blue-500" },
				{ getAttribute: () => "text-white bg-blue-500" },
			],
		} as unknown as Document;

		const candidates = collectCandidates(doc, ["bg-brand", "rounded-md"]);

		expect(candidates).toContain("w-full");
		expect(candidates).toContain("bg-brand");
		expect(candidates).toContain("rounded-md");
		expect(candidates).toContain("flex");
		expect(candidates).toContain("bg-blue-500");
		expect(candidates).toContain("text-white");
	});
});
