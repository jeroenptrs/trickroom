import { describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import {
	applyAddElement,
	applyDeleteElement,
	applyMoveElement,
	applyUpdateElementProps,
	applyUpdateElementText,
	DesignTransformError,
} from "./design-transform-service";

const containerElement = (
	id: string,
	children: TrickroomDesign["boards"] = [],
	name = id,
) => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom" as const,
		"data-trickroom-component": "container" as const,
	},
	children,
});

const textElement = (id: string, text = "Hello", name = id) => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom" as const,
		"data-trickroom-component": "text" as const,
		"data-trickroom-role": "text" as const,
	},
	children: text,
});

const simpleDesign: TrickroomDesign = {
	name: "Test Design",
	boards: [
		containerElement("root", [
			textElement("title", "Hello"),
			containerElement("inner", [textElement("inner-text", "World")]),
		]),
	],
};

describe("applyAddElement", () => {
	it("adds a container element to the root", () => {
		const design: TrickroomDesign = { name: "D", boards: [] };
		const { design: result, changedElementId } = applyAddElement(design, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "container",
		});

		expect(result.boards).toHaveLength(1);
		expect(result.boards[0].id).toBe(changedElementId);
		expect(result.boards[0].props["data-trickroom-name"]).toBe("container");
		expect(result.boards[0].props["data-trickroom-library"]).toBe("trickroom");
		expect(result.boards[0].props["data-trickroom-component"]).toBe("container");
		expect(result.boards[0].children).toEqual([]);
	});

	it("adds a text element with initial text", () => {
		const { design: result } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 0,
			library: "trickroom",
			component: "text",
			name: "Heading",
			text: "Initial content",
		});

		const root = result.boards[0];
		expect(Array.isArray(root.children)).toBe(true);
		const children = root.children as TrickroomDesign["boards"];
		const heading = children.find((c) => c.props["data-trickroom-name"] === "Heading");
		expect(heading).toBeDefined();
		expect(heading?.props["data-trickroom-role"]).toBe("text");
		expect(heading?.children).toBe("Initial content");
	});

	it("uses default text 'Text' for text elements without text param", () => {
		const { design: result, changedElementId } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 0,
			library: "trickroom",
			component: "text",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const newEl = children.find((c) => c.id === changedElementId);
		expect(newEl?.children).toBe("Text");
	});

	it("inserts at specified index", () => {
		const design: TrickroomDesign = {
			name: "D",
			boards: [
				containerElement("a"),
				containerElement("b"),
				containerElement("c"),
			],
		};

		const { design: result, changedElementId } = applyAddElement(design, {
			parentId: null,
			index: 1,
			library: "trickroom",
			component: "container",
		});

		const ids = result.boards.map((b) => b.id);
		expect(ids[1]).toBe(changedElementId);
		expect(ids).toEqual(["a", changedElementId, "b", "c"]);
	});

	it("applies className when provided", () => {
		const { design: result, changedElementId } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 0,
			library: "trickroom",
			component: "container",
			className: "flex gap-4",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const newEl = children.find((c) => c.id === changedElementId);
		expect(newEl?.props.className).toBe("flex gap-4");
	});

	it("throws UNKNOWN_REGISTRY_LIBRARY for unknown library", () => {
		expect(() =>
			applyAddElement(simpleDesign, {
				parentId: null,
				index: 0,
				library: "nonexistent",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "UNKNOWN_REGISTRY_LIBRARY",
			}),
		);
	});

	it("throws UNKNOWN_REGISTRY_COMPONENT for unknown component", () => {
		expect(() =>
			applyAddElement(simpleDesign, {
				parentId: null,
				index: 0,
				library: "trickroom",
				component: "unknown-component",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "UNKNOWN_REGISTRY_COMPONENT",
			}),
		);
	});

	it("throws PARENT_NOT_FOUND when parent does not exist", () => {
		expect(() =>
			applyAddElement(simpleDesign, {
				parentId: "nonexistent",
				index: 0,
				library: "trickroom",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "PARENT_NOT_FOUND",
			}),
		);
	});

	it("throws TEXT_ROLE_PARENT when parent is a text element", () => {
		expect(() =>
			applyAddElement(simpleDesign, {
				parentId: "title",
				index: 0,
				library: "trickroom",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "TEXT_ROLE_PARENT",
			}),
		);
	});

	describe("props parameter", () => {
		it("applies data-trickroom-name from props when name shortcut is absent", () => {
			const { design: result, changedElementId } = applyAddElement(simpleDesign, {
				parentId: null,
				index: 0,
				library: "trickroom",
				component: "container",
				props: { "data-trickroom-name": "From Props" },
			});

			const board = result.boards.find((b) => b.id === changedElementId);
			expect(board?.props["data-trickroom-name"]).toBe("From Props");
		});

		it("applies className from props when className shortcut is absent", () => {
			const { design: result, changedElementId } = applyAddElement(simpleDesign, {
				parentId: null,
				index: 0,
				library: "trickroom",
				component: "container",
				props: { className: "p-4 bg-white" },
			});

			const board = result.boards.find((b) => b.id === changedElementId);
			expect(board?.props.className).toBe("p-4 bg-white");
		});

		it("name shortcut overrides props[data-trickroom-name]", () => {
			const { design: result, changedElementId } = applyAddElement(simpleDesign, {
				parentId: null,
				index: 0,
				library: "trickroom",
				component: "container",
				name: "Shortcut Name",
				props: { "data-trickroom-name": "Props Name" },
			});

			const board = result.boards.find((b) => b.id === changedElementId);
			expect(board?.props["data-trickroom-name"]).toBe("Shortcut Name");
		});

		it("className shortcut overrides props.className", () => {
			const { design: result, changedElementId } = applyAddElement(simpleDesign, {
				parentId: null,
				index: 0,
				library: "trickroom",
				component: "container",
				className: "shortcut-class",
				props: { className: "props-class" },
			});

			const board = result.boards.find((b) => b.id === changedElementId);
			expect(board?.props.className).toBe("shortcut-class");
		});

		it("throws INVALID_PROP_KEY for registry-reference keys in props", () => {
			for (const key of [
				"data-trickroom-library",
				"data-trickroom-component",
				"data-trickroom-role",
			]) {
				expect(() =>
					applyAddElement(simpleDesign, {
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
						props: { [key]: "anything" },
					}),
				).toThrow(
					expect.objectContaining({
						name: "DesignTransformError",
						code: "INVALID_PROP_KEY",
					}),
				);
			}
		});

		it("throws INVALID_PROP_KEY for unknown prop keys", () => {
			expect(() =>
				applyAddElement(simpleDesign, {
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: { "data-custom": "value" },
				}),
			).toThrow(
				expect.objectContaining({
					name: "DesignTransformError",
					code: "INVALID_PROP_KEY",
				}),
			);
		});

		it("does not mutate the design when props are invalid (no persistence)", () => {
			const inputJson = JSON.stringify(simpleDesign);

			expect(() =>
				applyAddElement(simpleDesign, {
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: { "data-trickroom-library": "trickroom" },
				}),
			).toThrow();

			expect(JSON.stringify(simpleDesign)).toBe(inputJson);
		});
	});

	it("generates a unique UUID for each new element", () => {
		const { changedElementId: id1 } = applyAddElement(simpleDesign, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "container",
		});
		const { changedElementId: id2 } = applyAddElement(simpleDesign, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "container",
		});
		expect(id1).not.toBe(id2);
		expect(id1).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
	});
});

describe("applyUpdateElementProps", () => {
	it("updates the element name", () => {
		const { design: result } = applyUpdateElementProps(simpleDesign, {
			elementId: "title",
			name: "New Title",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const title = children.find((c) => c.id === "title");
		expect(title?.props["data-trickroom-name"]).toBe("New Title");
		expect(title?.children).toBe("Hello");
	});

	it("updates className", () => {
		const { design: result } = applyUpdateElementProps(simpleDesign, {
			elementId: "root",
			className: "p-4 bg-white",
		});

		expect(result.boards[0].props.className).toBe("p-4 bg-white");
	});

	it("preserves existing props when only patching some", () => {
		const design: TrickroomDesign = {
			name: "D",
			boards: [
				{
					id: "el",
					props: {
						"data-trickroom-name": "Original",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						className: "existing-class",
					},
					children: [],
				},
			],
		};

		const { design: result } = applyUpdateElementProps(design, {
			elementId: "el",
			name: "Renamed",
		});

		expect(result.boards[0].props["data-trickroom-name"]).toBe("Renamed");
		expect(result.boards[0].props.className).toBe("existing-class");
	});

	it("throws ELEMENT_NOT_FOUND when element does not exist", () => {
		expect(() =>
			applyUpdateElementProps(simpleDesign, {
				elementId: "nonexistent",
				name: "x",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "ELEMENT_NOT_FOUND",
			}),
		);
	});

	it("does not modify other elements", () => {
		const { design: result } = applyUpdateElementProps(simpleDesign, {
			elementId: "title",
			name: "Updated",
		});

		const root = result.boards[0];
		expect(root.props["data-trickroom-name"]).toBe("root");
		const inner = (root.children as TrickroomDesign["boards"]).find(
			(c) => c.id === "inner",
		);
		expect(inner?.props["data-trickroom-name"]).toBe("inner");
	});
});

describe("applyUpdateElementText", () => {
	it("updates text content of a text role element", () => {
		const { design: result } = applyUpdateElementText(simpleDesign, {
			elementId: "title",
			text: "Updated text",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const title = children.find((c) => c.id === "title");
		expect(title?.children).toBe("Updated text");
	});

	it("throws ELEMENT_NOT_FOUND when element does not exist", () => {
		expect(() =>
			applyUpdateElementText(simpleDesign, {
				elementId: "nonexistent",
				text: "x",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "ELEMENT_NOT_FOUND",
			}),
		);
	});

	it("throws INVALID_TEXT_UPDATE for non-text elements", () => {
		expect(() =>
			applyUpdateElementText(simpleDesign, {
				elementId: "root",
				text: "x",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "INVALID_TEXT_UPDATE",
			}),
		);
	});

	it("allows setting empty text", () => {
		const { design: result } = applyUpdateElementText(simpleDesign, {
			elementId: "title",
			text: "",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const title = children.find((c) => c.id === "title");
		expect(title?.children).toBe("");
	});
});

describe("applyMoveElement", () => {
	it("reorders within the same parent", () => {
		const design: TrickroomDesign = {
			name: "D",
			boards: [
				containerElement("parent", [
					containerElement("a"),
					containerElement("b"),
					containerElement("c"),
				]),
			],
		};

		const { design: result } = applyMoveElement(design, {
			elementId: "c",
			targetParentId: "parent",
			index: 0,
		});

		const parent = result.boards[0];
		const childIds = (parent.children as TrickroomDesign["boards"]).map(
			(c) => c.id,
		);
		expect(childIds).toEqual(["c", "a", "b"]);
	});

	it("reparents to a different container", () => {
		const { design: result } = applyMoveElement(simpleDesign, {
			elementId: "title",
			targetParentId: "inner",
			index: 0,
		});

		const root = result.boards[0];
		const rootChildren = root.children as TrickroomDesign["boards"];
		const inner = rootChildren.find((c) => c.id === "inner");
		const innerChildren = inner?.children as TrickroomDesign["boards"];
		expect(innerChildren.map((c) => c.id)).toContain("title");
		expect(rootChildren.map((c) => c.id)).not.toContain("title");
	});

	it("moves element to the root", () => {
		const { design: result } = applyMoveElement(simpleDesign, {
			elementId: "inner",
			targetParentId: null,
			index: 0,
		});

		expect(result.boards.map((b) => b.id)).toContain("inner");
		const root = result.boards.find((b) => b.id === "root");
		const rootChildren = root?.children as TrickroomDesign["boards"];
		expect(rootChildren.map((c) => c.id)).not.toContain("inner");
	});

	it("throws ELEMENT_NOT_FOUND when element does not exist", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "nonexistent",
				targetParentId: null,
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "ELEMENT_NOT_FOUND",
			}),
		);
	});

	it("throws CYCLE_DETECTED when moving element into itself", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "root",
				targetParentId: "root",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "CYCLE_DETECTED",
			}),
		);
	});

	it("throws CYCLE_DETECTED when moving element into its descendant", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "root",
				targetParentId: "inner",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "CYCLE_DETECTED",
			}),
		);
	});

	it("throws TEXT_ROLE_PARENT when target parent is a text element", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "inner",
				targetParentId: "title",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "TEXT_ROLE_PARENT",
			}),
		);
	});

	it("throws PARENT_NOT_FOUND when target parent does not exist", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "inner",
				targetParentId: "nonexistent",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "PARENT_NOT_FOUND",
			}),
		);
	});
});

describe("applyDeleteElement", () => {
	it("deletes a leaf text element", () => {
		const { design: result, deletedIds } = applyDeleteElement(simpleDesign, {
			elementId: "title",
		});

		expect(deletedIds).toEqual(["title"]);
		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		expect(children.map((c) => c.id)).not.toContain("title");
	});

	it("deletes a subtree including all descendants", () => {
		const { design: result, deletedIds } = applyDeleteElement(simpleDesign, {
			elementId: "inner",
		});

		expect(deletedIds).toContain("inner");
		expect(deletedIds).toContain("inner-text");
		expect(deletedIds).toHaveLength(2);

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		expect(children.map((c) => c.id)).not.toContain("inner");
	});

	it("deletes a root board element", () => {
		const design: TrickroomDesign = {
			name: "D",
			boards: [containerElement("board1"), containerElement("board2")],
		};

		const { design: result } = applyDeleteElement(design, {
			elementId: "board1",
		});

		expect(result.boards.map((b) => b.id)).toEqual(["board2"]);
	});

	it("returns changedElementId matching the deleted element", () => {
		const { changedElementId } = applyDeleteElement(simpleDesign, {
			elementId: "title",
		});
		expect(changedElementId).toBe("title");
	});

	it("throws ELEMENT_NOT_FOUND when element does not exist", () => {
		expect(() =>
			applyDeleteElement(simpleDesign, { elementId: "nonexistent" }),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "ELEMENT_NOT_FOUND",
			}),
		);
	});

	it("does not modify the input design object", () => {
		const inputJson = JSON.stringify(simpleDesign);
		applyDeleteElement(simpleDesign, { elementId: "title" });
		expect(JSON.stringify(simpleDesign)).toBe(inputJson);
	});
});

describe("DesignTransformError", () => {
	it("has correct name and code properties", () => {
		const error = new DesignTransformError("ELEMENT_NOT_FOUND", "msg");
		expect(error.name).toBe("DesignTransformError");
		expect(error.code).toBe("ELEMENT_NOT_FOUND");
		expect(error instanceof DesignTransformError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});
});
