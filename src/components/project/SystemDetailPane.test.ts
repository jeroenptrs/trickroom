import { describe, expect, it } from "vitest";
import {
	getNextColorOverrides,
	getNextTokenOverridesByDomain,
} from "./SystemDetailPane";

describe("getNextColorOverrides", () => {
	it("keeps confirmed overrides unchanged in synced state", () => {
		expect(
			getNextColorOverrides({
				reviewRequired: false,
				suggestedOverrides: ["--color-red-*"],
				storedOverrides: ["--color-brand-500"],
			}),
		).toEqual(["--color-brand-500"]);
	});

	it("uses grouped suggestions when confirming review", () => {
		expect(
			getNextColorOverrides({
				reviewRequired: true,
				suggestedOverrides: ["--color-*"],
				storedOverrides: [],
			}),
		).toEqual(["--color-*"]);
	});
});

describe("getNextTokenOverridesByDomain", () => {
	it("keeps stored domain overrides unchanged in synced state", () => {
		expect(
			getNextTokenOverridesByDomain({
				reviewRequired: false,
				suggestedOverrides: {
					color: ["--color-*"],
					spacing: ["--spacing"],
				},
				storedOverrides: {
					color: ["--color-brand-500"],
					spacing: ["--spacing-card"],
				},
			}),
		).toMatchObject({
			color: ["--color-brand-500"],
			spacing: ["--spacing-card"],
		});
	});

	it("uses suggested overrides for every domain when confirming review", () => {
		expect(
			getNextTokenOverridesByDomain({
				reviewRequired: true,
				suggestedOverrides: {
					color: ["--color-*"],
					spacing: ["--spacing"],
				},
				storedOverrides: {
					color: [],
					spacing: [],
				},
			}),
		).toMatchObject({
			color: ["--color-*"],
			spacing: ["--spacing"],
		});
	});
});
