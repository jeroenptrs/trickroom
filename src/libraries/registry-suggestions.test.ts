import { describe, expect, it } from "vitest";
import {
	describeUnknownRegistryComponent,
	describeUnknownRegistryLibrary,
	describeUnknownRegistryRecipe,
} from "./registry-suggestions";

describe("registry suggestions", () => {
	it("lists available libraries for an unknown library", () => {
		const unknown = describeUnknownRegistryLibrary("base_ui");
		expect(unknown.details).toMatchObject({
			suggestions: ["base-ui"],
			availableLibraries: ["base-ui", "trickroom"],
		});
	});

	it("suggests the closest component and lists small registries in full", () => {
		const unknown = describeUnknownRegistryComponent("trickroom", "contaner");
		expect(unknown.message).toContain('Did you mean "container"?');
		expect(unknown.details).toMatchObject({
			suggestions: ["container"],
			availableComponents: ["asset", "container", "icon", "text"],
		});
	});

	it("points at recipes when a recipe name is used as a component", () => {
		const unknown = describeUnknownRegistryComponent("base-ui", "dialog");
		expect(unknown.details.recipeSuggestions).toContain("dialog.default");
		expect(unknown.message).toContain("addRecipe");
	});

	it("points at the other library when the component lives there", () => {
		const unknown = describeUnknownRegistryComponent("base-ui", "container");
		expect(unknown.details.foundInLibraries).toEqual(["trickroom"]);
	});

	it("suggests recipes by local or qualified id", () => {
		expect(
			describeUnknownRegistryRecipe("base-ui", "dialog.defualt").details
				.suggestions,
		).toContain("dialog.default");
		expect(
			describeUnknownRegistryRecipe("base-ui", "base-ui/dialgo.default").details
				.suggestions,
		).toContain("dialog.default");
	});
});
