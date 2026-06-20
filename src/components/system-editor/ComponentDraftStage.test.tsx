import { describe, expect, it } from "vitest";
import {
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { resolveRenderableRegistryComponent } from "../../libraries/render-registry";
import type { ComponentDraftEntity } from "../../stores/component-draft-store";
import { getComponentDraftPreviewRenderableProps } from "./ComponentDraftStage";

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
});
