import { describe, expect, it } from "vitest";
import baseUiRegistry from "../libraries/base-ui/registry";
import trickroomRegistry from "../libraries/trickroom/registry";
import {
	baseUiAccessExpression,
	type ExportDescriptor,
	resolveExportDescriptor,
} from "./descriptors";

function baseUi(
	component: string,
): Extract<ExportDescriptor, { kind: "base-ui" }> {
	const descriptor = resolveExportDescriptor("base-ui", component);
	if (!descriptor || descriptor.kind !== "base-ui") {
		throw new Error(`expected base-ui descriptor for ${component}`);
	}
	return descriptor;
}

describe("resolveExportDescriptor", () => {
	it("covers every base-ui id in the registry (drift guard)", () => {
		const missing = Object.keys(baseUiRegistry.components).filter(
			(id) => resolveExportDescriptor("base-ui", id) === null,
		);
		expect(missing).toEqual([]);
	});

	it("covers every trickroom id in the registry", () => {
		const missing = Object.keys(trickroomRegistry.components).filter(
			(id) => resolveExportDescriptor("trickroom", id) === null,
		);
		expect(missing).toEqual([]);
	});

	it("maps a namespaced part to Namespace.Member", () => {
		expect(baseUiAccessExpression(baseUi("dialog.popup"))).toBe("Dialog.Popup");
		expect(baseUiAccessExpression(baseUi("select.scroll-down-arrow"))).toBe(
			"Select.ScrollDownArrow",
		);
	});

	it("maps a dotless id to the standalone export", () => {
		const button = baseUi("button");
		expect(button.member).toBeUndefined();
		expect(baseUiAccessExpression(button)).toBe("Button");
	});

	it("honors the irregular otp-field export name", () => {
		expect(baseUi("otp-field.input").importName).toBe("OTPFieldPreview");
		expect(baseUiAccessExpression(baseUi("otp-field.input"))).toBe(
			"OTPFieldPreview.Input",
		);
	});

	it("resolves trickroom intrinsics and the icon kind", () => {
		expect(resolveExportDescriptor("trickroom", "container")).toEqual({
			kind: "intrinsic",
			tag: "div",
		});
		expect(resolveExportDescriptor("trickroom", "asset")).toEqual({
			kind: "intrinsic",
			tag: "img",
		});
		expect(resolveExportDescriptor("trickroom", "icon")).toEqual({
			kind: "icon",
		});
	});

	it("returns null for unknown libraries and components", () => {
		expect(resolveExportDescriptor("mystery", "thing")).toBeNull();
		expect(resolveExportDescriptor("base-ui", "not-a-component")).toBeNull();
	});
});
