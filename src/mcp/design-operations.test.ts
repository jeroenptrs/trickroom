import { describe, expect, it } from "vitest";
import { DesignTransformError } from "../services/design-transform-service";
import type { Node } from "../types";
import { expandResolvedSystemComponent } from "../utils/system-component-expansion";
import { getSystemComponentStructuralMetadata } from "../utils/system-component-markers";
import { migrateSystemComponentInstance } from "../utils/system-component-migration";
import { FIXTURE_COMPONENT_ID } from "../utils/system-component-test-fixtures";
import type { PublishedSystemComponentVersion } from "../utils/system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "../utils/system-components-validation";
import {
	assertCanUseSystemComponentInstanceSubtree,
	validateDryRunOperationParameters,
} from "./design-operations";
import { getMcpPolicy, McpPolicyError } from "./governance";

const systemId = "sys-core";
const componentId = FIXTURE_COMPONENT_ID;
const instanceId = "instance-1";

const containerOnlyPolicy = getMcpPolicy({
	name: "Policy Test",
	systems: {},
	mcp: {
		enabled: true,
		allowedComponents: ["trickroom/container"],
	},
});

const sourceVersionWithEmptySlot = (): PublishedSystemComponentVersion => {
	const root = {
		path: "root",
		library: "trickroom",
		component: "container",
		children: [
			{
				path: "body",
				library: "trickroom",
				component: "container",
				slot: "default",
				children: [],
			},
		],
	};
	const slots = {
		default: {
			name: "default",
			hostPath: "body",
		},
	};
	const draft = { root, slots };
	return {
		...draft,
		version: "1",
		publishedAt: "2026-05-26T12:00:00.000Z",
		templateHash: hashSystemComponentTemplate(draft),
		variantSchemaHash: hashSystemComponentVariantSchema({}),
	};
};

const targetVersionWithDefaultSlotText =
	(): PublishedSystemComponentVersion => {
		const root = sourceVersionWithEmptySlot().root;
		const slots = {
			default: {
				name: "default",
				hostPath: "body",
				defaultChildren: [
					{
						path: "fallback",
						library: "trickroom",
						component: "text",
						text: "Fallback",
					},
				],
			},
		};
		const draft = { root, slots };
		return {
			...draft,
			version: "2",
			publishedAt: "2026-05-26T13:00:00.000Z",
			templateHash: hashSystemComponentTemplate(draft),
			variantSchemaHash: hashSystemComponentVariantSchema({}),
		};
	};

const expandStaleInstance = (source: PublishedSystemComponentVersion) => {
	const expansion = expandResolvedSystemComponent(
		{
			systemId,
			componentId,
			record: {
				componentId,
				slug: "card",
				name: "Card",
				createdAt: "",
				updatedAt: "",
				published: {
					currentVersion: source.version,
					versions: { [source.version]: source },
				},
			},
			version: source,
		},
		{
			createInstanceId: () => instanceId,
			createElementId: () => crypto.randomUUID(),
		},
	);
	return expansion.root;
};

describe("assertCanUseSystemComponentInstanceSubtree", () => {
	it("allows container-only policy before migration when the attached subtree has no disallowed components", () => {
		const source = sourceVersionWithEmptySlot();
		const staleRoot = expandStaleInstance(source);

		expect(() =>
			assertCanUseSystemComponentInstanceSubtree(
				containerOnlyPolicy,
				{ name: "Design", boards: [staleRoot] },
				staleRoot.id,
			),
		).not.toThrow();
	});

	it("denies migrated subtrees when target default slot children lack instance markers", () => {
		const source = sourceVersionWithEmptySlot();
		const target = targetVersionWithDefaultSlotText();
		const staleRoot = expandStaleInstance(source);
		const migrated = migrateSystemComponentInstance([staleRoot], staleRoot.id, {
			systemId,
			componentId,
			sourceVersion: source,
			targetVersion: target,
		});

		const body = (migrated.roots[0].children as Node[])[0];
		const fallback = (body.children as Node[])[0];
		expect(getSystemComponentStructuralMetadata(fallback.props)).toBeNull();

		expect(() =>
			assertCanUseSystemComponentInstanceSubtree(
				containerOnlyPolicy,
				{ name: "Design", boards: migrated.roots },
				migrated.roots[0].id,
			),
		).toThrow(McpPolicyError);

		expect(() =>
			assertCanUseSystemComponentInstanceSubtree(
				containerOnlyPolicy,
				{ name: "Design", boards: migrated.roots },
				fallback.id,
			),
		).toThrow(DesignTransformError);
	});
});

describe("validateDryRunOperationParameters", () => {
	it("accepts initial system component variant unset axes", () => {
		expect(
			validateDryRunOperationParameters("addSystemComponent", {
				parentId: "board",
				index: 0,
				systemId: "sys-core",
				componentId,
				variantValues: { tone: "brand" },
				unsetVariantAxes: ["tone"],
			}),
		).toEqual({
			parentId: "board",
			index: 0,
			systemId: "sys-core",
			componentId,
			variantValues: { tone: "brand" },
			unsetVariantAxes: ["tone"],
		});
	});

	it("accepts explicit system component variant unset axes", () => {
		expect(
			validateDryRunOperationParameters("updateSystemComponentInstance", {
				rootElementId: "component-root",
				unsetVariantAxes: ["tone"],
			}),
		).toEqual({
			rootElementId: "component-root",
			unsetVariantAxes: ["tone"],
		});
	});

	it("preserves nested system component override fields in operation plans", () => {
		expect(
			validateDryRunOperationParameters("updateSystemComponentInstance", {
				rootElementId: "component-root",
				overrides: {
					input: {
						className: "rounded-md",
						text: "Label",
						"data-trickroom-icon-id": "icon-search",
						props: { placeholder: "Search", disabled: true },
					},
				},
			}),
		).toEqual({
			rootElementId: "component-root",
			overrides: {
				input: {
					className: "rounded-md",
					text: "Label",
					"data-trickroom-icon-id": "icon-search",
					props: { placeholder: "Search", disabled: true },
				},
			},
		});
	});
});
