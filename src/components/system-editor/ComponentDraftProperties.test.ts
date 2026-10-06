import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
	hydrateComponentDraft,
	resetComponentDraftStore,
	selectTemplateNode,
	setComponentDraftStyleTarget,
	setTemplateNodeDesignOnly,
} from "../../stores/component-draft-store";
import { FIXTURE_COMPONENT_ID } from "../../utils/system-component-test-fixtures";
import { ComponentDraftLayers } from "./ComponentDraftLayers";
import { ComponentDraftProperties } from "./ComponentDraftProperties";

function renderInspector() {
	return renderToStaticMarkup(
		React.createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			React.createElement(ComponentDraftProperties, { systemId: "sys-core" }),
		),
	);
}

beforeEach(() => {
	resetComponentDraftStore();
	hydrateComponentDraft({
		componentId: FIXTURE_COMPONENT_ID,
		root: {
			path: "root",
			library: "trickroom",
			component: "container",
			className: "inline-flex px-3",
			children: [
				{
					path: "label",
					library: "trickroom",
					component: "text",
					text: "Label",
				},
			],
		},
		variants: {
			axes: {
				size: {
					label: "Size",
					values: {
						sm: { classesByPath: { root: "h-8" } },
						lg: { classesByPath: { root: "h-12 text-lg" } },
					},
				},
				tone: {
					label: "Tone",
					values: {
						primary: { classesByPath: { root: "bg-cyan-600" } },
					},
				},
			},
			compoundVariants: [
				{
					when: { size: "lg", tone: "primary" },
					classesByPath: { root: "shadow-lg" },
				},
			],
		},
	});
	selectTemplateNode("root");
});

describe("ComponentDraftProperties", () => {
	it("shows the base class field next to the node's properties, with no Style tab", () => {
		const html = renderInspector();

		expect(html).toMatch(
			/<textarea[^>]*aria-label="Base classes"[^>]*>inline-flex px-3<\/textarea>/,
		);
		expect(html).toContain("Style target");
		expect(html).toContain("Slot");
		expect(html).toContain("Override target");
		expect(html).not.toContain('role="tab"');
	});

	it("adds one class field per selected variant and compound target", () => {
		setComponentDraftStyleTarget({
			base: true,
			axisValues: { size: "lg", tone: "primary" },
			compoundAxes: ["size", "tone"],
			activeTab: { kind: "compound" },
		});
		const html = renderInspector();

		expect(html).toMatch(
			/<textarea[^>]*aria-label="Size: lg classes"[^>]*>h-12 text-lg<\/textarea>/,
		);
		expect(html).toMatch(
			/<textarea[^>]*aria-label="Tone: primary classes"[^>]*>bg-cyan-600<\/textarea>/,
		);
		expect(html).toMatch(
			/<textarea[^>]*aria-label="Compound classes"[^>]*>shadow-lg<\/textarea>/,
		);
	});

	it("toggles design only on the selected node", () => {
		const off = renderInspector();
		expect(off).toContain("Design only");
		expect(off).toMatch(
			/<label[^>]*for="root-design-only"[^>]*>Design only<\/label>/,
		);
		expect(off).toMatch(/role="switch"[^>]*aria-checked="false"/);

		setTemplateNodeDesignOnly("root", true);
		const on = renderInspector();
		expect(on).toMatch(/role="switch"[^>]*aria-checked="true"/);
		expect(on).not.toContain("Inherited from");
	});

	it("shows design only as inherited and read-only on descendants", () => {
		setTemplateNodeDesignOnly("root", true);
		selectTemplateNode("label");
		const html = renderInspector();

		const switchTag = html.match(/<[^>]*role="switch"[^>]*>/)?.[0] ?? "";
		expect(switchTag).toContain('aria-checked="true"');
		expect(switchTag).toMatch(/aria-disabled="true"|data-disabled/);
		expect(html).toContain("Inherited from");
		expect(html).not.toContain("Also set on this node.");
	});
});

describe("ComponentDraftLayers", () => {
	it("marks the design-only layer and dims its descendants", () => {
		setTemplateNodeDesignOnly("root", true);
		const html = renderToStaticMarkup(
			React.createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				React.createElement(ComponentDraftLayers, {
					componentId: FIXTURE_COMPONENT_ID,
				}),
			),
		);

		expect(html.match(/>Design only</g)).toHaveLength(1);
		expect(html).toContain("design only, inherited from a parent layer");
	});
});
