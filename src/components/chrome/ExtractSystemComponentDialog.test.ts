import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSystemComponentDraft,
	expandSystemComponent,
	publishSystemComponent,
} from "../../queries/system-components";
import {
	designStore,
	hydrateDesign,
	normalizeDesign,
} from "../../stores/design-store";
import type { TrickroomDesign } from "../../types";
import { getSystemComponentMarkerProps } from "../../utils/system-component-markers";
import { systemComponentSlugFromName } from "../../utils/system-components";
import {
	canSubmitExtractSystemComponentDialog,
	extractSystemComponentMutation,
	getExtractSystemComponentDefaults,
	getSystemComponentEditorPath,
	promptToOpenExtractedComponent,
} from "./ExtractSystemComponentDialog";

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(() => "extract-toast"),
		dismiss: vi.fn(),
	},
}));

vi.mock("../../queries/system-components", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../queries/system-components")>();
	return {
		...actual,
		createSystemComponentDraft: vi.fn(),
		publishSystemComponent: vi.fn(),
		expandSystemComponent: vi.fn(),
	};
});

const createSystemComponentDraftMock = vi.mocked(createSystemComponentDraft);
const publishSystemComponentMock = vi.mocked(publishSystemComponent);
const expandSystemComponentMock = vi.mocked(expandSystemComponent);
const { toast } = await import("sonner");
const toastMock = vi.mocked(toast);

const fixture = {
	name: "Extract Test",
	systemId: "core",
	boards: [
		{
			id: "root",
			props: {
				"data-trickroom-name": "Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				{
					id: "selection",
					props: {
						"data-trickroom-name": "Selection",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [
						{
							id: "old-child",
							props: {
								"data-trickroom-name": "Old Child",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Old subtree",
						},
					],
				},
			],
		},
	],
} satisfies TrickroomDesign;

const attachedRoot = {
	id: "attached-root",
	props: {
		"data-trickroom-name": "Extracted Component",
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		...getSystemComponentMarkerProps({
			systemId: "core",
			componentId: "cmp_selection",
			instanceId: "instance-1",
			version: "1",
			path: "root",
			isRoot: true,
		}),
	},
	children: [
		{
			id: "attached-child",
			props: {
				"data-trickroom-name": "Attached Child",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "text",
				"data-trickroom-role": "text",
			},
			children: "Attached",
		},
	],
} satisfies TrickroomDesign["boards"][number];

beforeEach(() => {
	vi.clearAllMocks();
	designStore.setState(() => normalizeDesign(fixture));
	createSystemComponentDraftMock.mockResolvedValue({
		systemId: "core",
		systemName: "Core",
		revision: "rev-created",
		updatedAt: "2026-05-26T00:00:00.000Z",
		componentId: "cmp_selection",
	});
	publishSystemComponentMock.mockResolvedValue({
		systemId: "core",
		systemName: "Core",
		revision: "rev-published",
		updatedAt: "2026-05-26T00:01:00.000Z",
		componentId: "cmp_selection",
		publishedVersion: "1",
	});
	expandSystemComponentMock.mockResolvedValue({
		systemId: "core",
		systemName: "Core",
		componentId: "cmp_selection",
		version: "1",
		root: attachedRoot,
	});
});

const baseInput = {
	elementId: "selection",
	targetSystemId: "core",
	revision: "rev-1",
	name: "Selection",
	slug: "selection",
	description: "",
	group: "",
};

describe("ExtractSystemComponentDialog helpers", () => {
	it("derives component metadata defaults from the selected layer", () => {
		expect(getExtractSystemComponentDefaults(" Primary Button ")).toEqual({
			name: "Primary Button",
			slug: "primary-button",
		});
		expect(getExtractSystemComponentDefaults("")).toEqual({
			name: "Component",
			slug: "component",
		});
	});

	it("normalizes slugs to component-safe identifiers", () => {
		expect(systemComponentSlugFromName("Marketing/Card CTA!")).toBe(
			"marketing-card-cta",
		);
		expect(systemComponentSlugFromName("already_valid-1")).toBe(
			"already-valid-1",
		);
		expect(systemComponentSlugFromName("Bûton!")).toBe("b-ton");
		expect(systemComponentSlugFromName("Hello--World")).toBe("hello-world");
	});

	it("requires a selection, target system, revision, name, and valid slug", () => {
		const base = {
			hasSelection: true,
			hasTargetSystem: true,
			hasManifestRevision: true,
			name: "Primary Button",
			slug: "primary-button",
			isPending: false,
		};

		expect(canSubmitExtractSystemComponentDialog(base)).toBe(true);
		expect(
			canSubmitExtractSystemComponentDialog({
				...base,
				hasSelection: false,
			}),
		).toBe(false);
		expect(
			canSubmitExtractSystemComponentDialog({
				...base,
				hasTargetSystem: false,
			}),
		).toBe(false);
		expect(
			canSubmitExtractSystemComponentDialog({
				...base,
				hasManifestRevision: false,
			}),
		).toBe(false);
		expect(canSubmitExtractSystemComponentDialog({ ...base, name: " " })).toBe(
			false,
		);
		expect(
			canSubmitExtractSystemComponentDialog({
				...base,
				slug: "Primary Button",
			}),
		).toBe(false);
		expect(
			canSubmitExtractSystemComponentDialog({
				...base,
				slug: "primary_button",
			}),
		).toBe(false);
		expect(
			canSubmitExtractSystemComponentDialog({ ...base, isPending: true }),
		).toBe(false);
	});

	it("builds a focused system editor path for the extracted component", () => {
		expect(getSystemComponentEditorPath("Core System", "cmp/new button")).toBe(
			"/system/Core%20System?component=cmp%2Fnew%20button",
		);
	});

	it("prompts to open the extracted component editor only once when accepted repeatedly", () => {
		const navigate = vi.fn();

		const toastId = promptToOpenExtractedComponent({
			replacedSelection: true,
			systemId: "core",
			componentId: "cmp_selection",
			navigate,
		});

		expect(toastId).toBe("extract-toast");
		expect(toastMock.success).toHaveBeenCalledWith(
			"Component extracted.",
			expect.objectContaining({
				description: "The design now has the attached instance selected.",
				duration: Number.POSITIVE_INFINITY,
				action: expect.objectContaining({ label: "Open editor" }),
				cancel: expect.objectContaining({ label: "Stay in design" }),
			}),
		);

		const options = toastMock.success.mock.calls.at(-1)?.[1];
		if (
			!options ||
			typeof options.action !== "object" ||
			!("onClick" in options.action)
		) {
			throw new Error("Expected open editor toast action.");
		}
		options.action.onClick({} as never);
		options.action.onClick({} as never);

		expect(toastMock.dismiss).toHaveBeenCalledTimes(1);
		expect(toastMock.dismiss).toHaveBeenCalledWith("extract-toast");
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith(
			"/system/core?component=cmp_selection",
		);
	});

	it("keeps the user in the design with the attached instance selected when the prompt is declined", async () => {
		const navigate = vi.fn();

		await extractSystemComponentMutation({
			...baseInput,
			replaceSelection: true,
		});
		promptToOpenExtractedComponent({
			replacedSelection: true,
			systemId: "core",
			componentId: "cmp_selection",
			navigate,
		});

		const options = toastMock.success.mock.calls.at(-1)?.[1];
		if (
			!options ||
			typeof options.cancel !== "object" ||
			!("onClick" in options.cancel)
		) {
			throw new Error("Expected stay in design toast action.");
		}
		options.cancel.onClick({} as never);

		expect(toastMock.dismiss).toHaveBeenCalledWith("extract-toast");
		expect(navigate).not.toHaveBeenCalled();
		expect(designStore.get().selectedId).toBe("attached-root");
	});
});

describe("extractSystemComponentMutation", () => {
	it("creates, publishes, expands, and replaces the selected subtree", async () => {
		const result = await extractSystemComponentMutation({
			...baseInput,
			replaceSelection: true,
		});

		expect(result).toMatchObject({
			componentId: "cmp_selection",
			replacedSelection: true,
		});
		expect(createSystemComponentDraftMock).toHaveBeenCalledBefore(
			publishSystemComponentMock,
		);
		expect(publishSystemComponentMock).toHaveBeenCalledWith(
			"core",
			"cmp_selection",
			{ expectedRevision: "rev-created" },
		);
		expect(expandSystemComponentMock).toHaveBeenCalledWith(
			"core",
			"cmp_selection",
			"1",
		);

		const state = designStore.get();
		expect(state.entitiesById["attached-root"]).toBeDefined();
		expect(state.selectedId).toBe("attached-root");
		expect(state.entitiesById.selection).toBeUndefined();
		expect(state.entitiesById["old-child"]).toBeUndefined();
		expect(state.entitiesById.root?.childIds).toEqual(["attached-root"]);
	});

	it("creates a draft only when replacement is declined", async () => {
		const result = await extractSystemComponentMutation({
			...baseInput,
			replaceSelection: false,
		});

		expect(result).toMatchObject({
			componentId: "cmp_selection",
			replacedSelection: false,
		});
		expect(createSystemComponentDraftMock).toHaveBeenCalledTimes(1);
		expect(publishSystemComponentMock).not.toHaveBeenCalled();
		expect(expandSystemComponentMock).not.toHaveBeenCalled();
		expect(designStore.get().entitiesById.selection).toBeDefined();
		expect(designStore.get().entitiesById["attached-root"]).toBeUndefined();
	});

	it("throws a post-publish error when replacement fails after publish", async () => {
		const designStoreModule = await import("../../stores/design-store");
		const replaceElementWithNodeTree = vi
			.spyOn(designStoreModule, "replaceElementWithNodeTree")
			.mockReturnValue(false);

		await expect(
			extractSystemComponentMutation({
				...baseInput,
				replaceSelection: true,
			}),
		).rejects.toMatchObject({
			name: "ExtractSystemComponentPostPublishError",
			message:
				"Published the component, but the selected layer could not be replaced.",
			partialResult: {
				systemId: "core",
				componentId: "cmp_selection",
			},
		});

		replaceElementWithNodeTree.mockRestore();
	});

	it("throws a post-publish error when expansion fails after publish", async () => {
		expandSystemComponentMock.mockRejectedValueOnce(
			new Error("Expansion failed."),
		);

		await expect(
			extractSystemComponentMutation({
				...baseInput,
				replaceSelection: true,
			}),
		).rejects.toMatchObject({
			name: "ExtractSystemComponentPostPublishError",
			message: "Expansion failed.",
			partialResult: {
				systemId: "core",
				componentId: "cmp_selection",
			},
		});
	});

	it("prevalidates replacement before remote calls", async () => {
		hydrateDesign({
			name: "Blocked Extract Test",
			boards: [
				{
					id: "component-root",
					props: {
						"data-trickroom-name": "Component Root",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						...getSystemComponentMarkerProps({
							systemId: "core",
							componentId: "existing",
							instanceId: "existing-instance",
							version: "1",
							path: "root",
							isRoot: true,
						}),
					},
					children: [
						{
							id: "selection",
							props: {
								"data-trickroom-name": "Structural Child",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								...getSystemComponentMarkerProps({
									systemId: "core",
									componentId: "existing",
									instanceId: "existing-instance",
									version: "1",
									path: "child",
								}),
							},
							children: [],
						},
					],
				},
			],
		});

		await expect(
			extractSystemComponentMutation({
				...baseInput,
				replaceSelection: true,
			}),
		).rejects.toThrow(
			"The selected layer cannot be replaced in its current location.",
		);

		expect(createSystemComponentDraftMock).not.toHaveBeenCalled();
		expect(publishSystemComponentMock).not.toHaveBeenCalled();
		expect(expandSystemComponentMock).not.toHaveBeenCalled();
	});
});
