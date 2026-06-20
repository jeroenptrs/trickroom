import type { ElementType } from "react";
import type { RegistryComponentDefinition } from "../types";
import { baseUiRenderComponents } from "./base-ui/render-components";
import {
	getRenderableProps,
	type RegistryId,
	resolveRegistryComponent,
} from "./registry";
import { trickroomRenderComponents } from "./trickroom/render-components";

export { getRenderableProps };

export type RenderableRegistryComponentDefinition =
	RegistryComponentDefinition & {
		component: ElementType;
	};

export type RenderableRegistryResolution =
	| {
			status: "known";
			library: RegistryId;
			component: string;
			definition: RenderableRegistryComponentDefinition;
	  }
	| { status: "unknown-library"; library: string; component: string }
	| { status: "unknown-component"; library: RegistryId; component: string };

const renderComponents: Record<RegistryId, Record<string, ElementType>> = {
	"base-ui": baseUiRenderComponents,
	trickroom: trickroomRenderComponents,
};

export function resolveRenderableRegistryComponent(
	library: string,
	component: string,
): RenderableRegistryResolution {
	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status !== "known") {
		return resolution;
	}

	const renderComponent = renderComponents[resolution.library][component];
	if (!renderComponent) {
		return {
			status: "unknown-component",
			library: resolution.library,
			component,
		};
	}

	return {
		...resolution,
		definition: {
			...resolution.definition,
			component: renderComponent,
		},
	};
}
