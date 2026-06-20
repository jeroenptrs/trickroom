import { describe, expect, it } from "vitest";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
	isSystemComponentMarkerPropKey,
	isSystemComponentRootStale,
	omitSystemComponentMarkerProps,
	systemComponentIdProp,
	systemComponentPathProp,
	systemComponentRootProp,
	systemComponentSystemIdProp,
	SYSTEM_COMPONENT_MARKER_PROP_KEYS,
} from "./system-component-markers";

describe("system component markers", () => {
	it("treats marker prop keys as protected system props", () => {
		for (const key of SYSTEM_COMPONENT_MARKER_PROP_KEYS) {
			expect(isSystemComponentMarkerPropKey(key)).toBe(true);
		}
		expect(isSystemComponentMarkerPropKey("className")).toBe(false);
	});

	it("round-trips structural metadata through marker props", () => {
		const props = getSystemComponentMarkerProps({
			systemId: "sys_core",
			componentId: "cmp_11111111-1111-4111-8111-111111111111",
			instanceId: "instance-1",
			version: "1",
			path: "root",
			isRoot: true,
			variantValues: { tone: "brand" },
			overrides: { rootTarget: { className: "rounded-md" } },
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
		});

		expect(getSystemComponentStructuralMetadata(props)).toEqual({
			systemId: "sys_core",
			componentId: "cmp_11111111-1111-4111-8111-111111111111",
			instanceId: "instance-1",
			version: "1",
			path: "root",
			isRoot: true,
			slotName: null,
			variantValues: { tone: "brand" },
			overrides: { rootTarget: { className: "rounded-md" } },
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
		});
	});

	it("omits marker props while preserving authored props", () => {
		const props = {
			className: "btn",
			"data-trickroom-name": "Button",
			...getSystemComponentMarkerProps({
				systemId: "sys_core",
				componentId: "cmp_11111111-1111-4111-8111-111111111111",
				instanceId: "instance-1",
				version: "1",
				path: "label",
				slotName: "default",
			}),
		};

		expect(omitSystemComponentMarkerProps(props)).toEqual({
			className: "btn",
			"data-trickroom-name": "Button",
		});
	});

	it("returns null for partial marker metadata", () => {
		expect(
			getSystemComponentStructuralMetadata({
				[systemComponentSystemIdProp]: "sys_core",
				[systemComponentIdProp]: "cmp_11111111-1111-4111-8111-111111111111",
			}),
		).toBeNull();
	});

	it("detects stale root hashes without treating non-root nodes as stale", () => {
		const rootProps = getSystemComponentMarkerProps({
			systemId: "sys_core",
			componentId: "cmp_11111111-1111-4111-8111-111111111111",
			instanceId: "instance-1",
			version: "1",
			path: "root",
			isRoot: true,
			templateHash: "sha256:old-template",
			variantSchemaHash: "sha256:old-variants",
		});

		expect(
			isSystemComponentRootStale(rootProps, {
				templateHash: "sha256:new-template",
			}),
		).toBe(true);
		expect(
			isSystemComponentRootStale(rootProps, {
				variantSchemaHash: "sha256:new-variants",
			}),
		).toBe(true);
		expect(
			isSystemComponentRootStale(rootProps, {
				templateHash: "sha256:old-template",
				variantSchemaHash: "sha256:old-variants",
			}),
		).toBe(false);

		const childProps = {
			...rootProps,
			[systemComponentRootProp]: undefined,
			[systemComponentPathProp]: "label",
		};
		expect(
			isSystemComponentRootStale(childProps, {
				templateHash: "sha256:new-template",
			}),
		).toBe(false);
	});
});
