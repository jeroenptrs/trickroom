import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { resolveRenderableRegistryComponent } from "../../libraries/render-registry";
import {
	type ComponentDraftEntity,
	componentDraftStore,
	getComponentDraftPreviewClassName,
	hydrateComponentDraft,
	resetComponentDraftStore,
	setComponentDraftStyleTarget,
} from "../../stores/component-draft-store";
import { createClassMerge } from "../../utils/class-merge";
import { FIXTURE_COMPONENT_ID } from "../../utils/system-component-test-fixtures";
import {
	getComponentDraftPreviewRenderableProps,
	SerializedDraftNode,
} from "./ComponentDraftStage";

// Every registry component currently has a renderer; pretend meter.track has
// none so the draft stage's placeholder path is exercised.
vi.mock("../../libraries/render-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../libraries/render-registry")>();
	return {
		...actual,
		resolveRenderableRegistryComponent: (library: string, component: string) =>
			component === "meter.track"
				? { status: "unknown-component", library, component }
				: actual.resolveRenderableRegistryComponent(library, component),
	};
});

const separatorBaseClassName =
	"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full";

describe("ComponentDraftStage", () => {
	it("renders draft separator previews with registry base styling without materializing it", () => {
		const registryResolution = resolveRegistryComponent("base-ui", "separator");
		const renderResolution = resolveRenderableRegistryComponent(
			"base-ui",
			"separator",
		);
		expect(registryResolution.status).toBe("known");
		expect(renderResolution.status).toBe("known");
		if (
			registryResolution.status !== "known" ||
			renderResolution.status !== "known"
		) {
			return;
		}

		const entity = {
			path: "root",
			library: "base-ui",
			component: "separator",
			parentPath: null,
			role: "leaf",
			props: { orientation: "horizontal" },
			className: "template-separator",
		} satisfies ComponentDraftEntity;

		const props = getComponentDraftPreviewRenderableProps({
			entity,
			path: "root",
			previewClassName: "template-separator brand-separator",
			selectedPath: null,
			definition: renderResolution.definition,
		});

		expect(registryResolution.definition.baseClassName).toBe(
			separatorBaseClassName,
		);
		expect(entity.props).not.toHaveProperty("className");
		expect(entity.props).not.toHaveProperty(MATERIALIZED_BASE_CLASS_PROP);
		expect(props).toMatchObject({
			className: `${separatorBaseClassName} template-separator brand-separator`,
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "separator",
			"data-trickroom-role": "leaf",
			orientation: "horizontal",
		});
		expect(props).not.toHaveProperty(MATERIALIZED_BASE_CLASS_PROP);
	});

	it("merges the draft's classes like tv(), but not the registry base or the selection outline", () => {
		const renderResolution = resolveRenderableRegistryComponent(
			"base-ui",
			"separator",
		);
		if (renderResolution.status !== "known") {
			throw new Error("separator renderer missing");
		}
		const entity = {
			path: "root",
			library: "base-ui",
			component: "separator",
			parentPath: null,
			role: "leaf",
			props: { orientation: "horizontal" },
			className: "my-2",
		} satisfies ComponentDraftEntity;

		const props = getComponentDraftPreviewRenderableProps({
			entity,
			path: "root",
			previewClassName: "my-2 outline-none my-4",
			selectedPath: "root",
			definition: renderResolution.definition,
			classMerge: createClassMerge({ mode: "stock" }),
		});

		expect(props.className).toBe(
			`${separatorBaseClassName} outline-none my-4 outline outline-2 outline-offset-2 outline-cyan-500`,
		);
	});

	it("keeps trickroom icon draft previews unstyled unless authored", () => {
		const registryResolution = resolveRegistryComponent("trickroom", "icon");
		const renderResolution = resolveRenderableRegistryComponent(
			"trickroom",
			"icon",
		);
		expect(registryResolution.status).toBe("known");
		expect(renderResolution.status).toBe("known");
		if (
			registryResolution.status !== "known" ||
			renderResolution.status !== "known"
		) {
			return;
		}

		const entity = {
			path: "icon",
			library: "trickroom",
			component: "icon",
			parentPath: null,
			role: "leaf",
			props: { "data-trickroom-icon-id": "icons-1/a-arrow-down" },
		} satisfies ComponentDraftEntity;

		const props = getComponentDraftPreviewRenderableProps({
			entity,
			path: "icon",
			previewClassName: "",
			selectedPath: null,
			definition: renderResolution.definition,
		});

		expect(registryResolution.definition).not.toHaveProperty("baseClassName");
		expect(props).not.toHaveProperty("className");
		expect(props.className).toBeUndefined();
		expect(props.className).not.toBe("size-5");
	});

	it("passes composite draft preview classes (base + axes + compound) into stage renderable props", () => {
		const renderResolution = resolveRenderableRegistryComponent(
			"base-ui",
			"separator",
		);
		expect(renderResolution.status).toBe("known");
		if (renderResolution.status !== "known") {
			return;
		}

		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: {
				path: "root",
				library: "base-ui",
				component: "separator",
				className: "h-4",
			},
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: {
							brand: {
								label: "Brand",
								classesByPath: { root: "text-blue-600" },
							},
						},
					},
					size: {
						label: "Size",
						values: {
							lg: {
								label: "Large",
								classesByPath: { root: "h-6" },
							},
						},
					},
				},
				compoundVariants: [
					{
						when: { tone: "brand", size: "lg" },
						classesByPath: { root: "ring-2" },
					},
				],
			},
		});
		setComponentDraftStyleTarget({
			base: true,
			axisValues: { tone: "brand", size: "lg" },
			compoundAxes: ["tone", "size"],
			activeTab: { kind: "compound" },
		});

		const previewClassName = getComponentDraftPreviewClassName(
			componentDraftStore.get(),
			"root",
		);
		expect(previewClassName).toBe("h-4 h-6 text-blue-600 ring-2");

		const entity = {
			path: "root",
			library: "base-ui",
			component: "separator",
			parentPath: null,
			role: "leaf",
			className: "h-4",
		} satisfies ComponentDraftEntity;

		const props = getComponentDraftPreviewRenderableProps({
			entity,
			path: "root",
			previewClassName,
			selectedPath: null,
			definition: renderResolution.definition,
		});

		expect(props.className).toContain("h-4");
		expect(props.className).toContain("h-6");
		expect(props.className).toContain("text-blue-600");
		expect(props.className).toContain("ring-2");
	});

	it("renders the missing-renderer placeholder for registry components without a renderer", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				children: [
					{
						path: "ghost",
						library: "base-ui",
						component: "meter.track",
						children: [
							{
								path: "ghost-text",
								library: "trickroom",
								component: "text",
								text: "Still visible",
							},
						],
					},
				],
			},
		});

		const html = renderToStaticMarkup(<SerializedDraftNode path="root" />);

		expect(html).toContain(
			'data-trickroom-missing-renderer="base-ui/meter.track"',
		);
		expect(html).toContain("No renderer for base-ui/meter.track");
		expect(html).toContain('data-component-draft-path="ghost"');
		expect(html).toContain("Still visible");
	});
});
