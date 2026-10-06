import { describe, expect, it } from "vitest";
import { resolveCodegenConfig } from "../codegen/config";
import {
	CODEGEN_TEST_SYSTEM_ID,
	flatPayload,
	publishedComponent,
	templateNode,
} from "../codegen/test-support";
import { createEmptySystemComponentManifest } from "../utils/system-components";
import type { TailwindTokenStorage } from "../utils/tailwind-token-store";
import { buildSystemContract, findContractComponent } from "./contract";

const manifestOf = (records: ReturnType<typeof publishedComponent>[]) => ({
	...createEmptySystemComponentManifest(),
	components: Object.fromEntries(
		records.map((record) => [record.componentId, record]),
	),
});

const tokens = (
	overrides: Partial<TailwindTokenStorage> = {},
): TailwindTokenStorage => ({
	version: 3,
	metadata: {
		cssPath: "src/index.css",
		syncedAt: "2026-01-01T00:00:00.000Z",
		tailwindBaselineVersion: "test",
		reviewRequired: false,
	},
	domains: Object.fromEntries(
		[
			"color",
			"spacing",
			"breakpoint",
			"container",
			"radius",
			"font",
			"text",
			"font-weight",
			"text-shadow",
			"leading",
			"tracking",
			"shadow",
			"inset-shadow",
			"drop-shadow",
			"blur",
			"aspect",
			"ease",
			"animate",
			"perspective",
		].map((domain) => [
			domain,
			{
				tokens: {},
				overrides: [],
				baselineDiff: { added: [], overridden: [], removed: [] },
			},
		]),
	) as unknown as TailwindTokenStorage["domains"],
	customProperties: {},
	customUtilities: [],
	...overrides,
});

const system = {
	id: CODEGEN_TEST_SYSTEM_ID,
	name: "Core",
	cssPath: "src/index.css",
};

describe("buildSystemContract", () => {
	it("describes published components as codegen sees them", () => {
		const toast = publishedComponent(
			"toast",
			{
				root: templateNode("root", "flex", [
					templateNode("title", "font-bold"),
					{ ...templateNode("icon", "size-4"), designOnly: true } as never,
				]),
				slots: {},
				variants: {
					axes: {
						tone: {
							label: "Tone",
							defaultValue: "neutral",
							values: {
								neutral: {},
								danger: { classesByPath: { root: "bg-red-500" } },
							},
						},
						size: {
							label: "Size",
							values: { sm: { classesByPath: { title: "text-sm" } }, lg: {} },
						},
						open: {
							label: "Open",
							defaultValue: "false",
							values: { true: { classesByPath: { root: "block" } }, false: {} },
						},
					},
					compoundVariants: [
						{
							when: { tone: "danger", size: "lg" },
							classesByPath: { root: "ring" },
						},
					],
				},
				overrideTargets: {},
			},
			{ version: "3" },
		);
		const contract = buildSystemContract({
			system,
			manifest: manifestOf([
				publishedComponent("button", flatPayload("px-3")),
				toast,
			]),
			tokens: null,
			codegen: resolveCodegenConfig({
				name: "x",
				codegen: { version: 1, outDir: "src\\ui", exclude: ["button"] },
			}),
		});
		expect(contract.version).toBe(1);
		expect(contract.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(contract.codegen).toEqual({
			configured: true,
			outDir: "src/ui",
			fileName: "{slug}.variants.ts",
			tvImport: "./tv",
			shape: "auto",
		});
		expect(contract.components.map((component) => component.slug)).toEqual([
			"button",
			"toast",
		]);

		const button = findContractComponent(contract, { slug: "button" });
		expect(button).toMatchObject({
			shape: "flat",
			exportName: "buttonVariants",
			fileName: "button.variants.ts",
			publishedVersion: "1",
			codegen: { selected: false, issues: [] },
		});
		expect(button?.slots).toEqual([
			{ key: "root", path: "root", className: "px-3" },
		]);

		const toastContract = findContractComponent(contract, {
			componentId: toast.componentId,
		});
		expect(toastContract).toMatchObject({
			shape: "slots",
			publishedVersion: "3",
			codegen: { selected: true },
		});
		expect(toastContract?.slots.map((slot) => slot.key)).toEqual([
			"root",
			"title",
		]);
		expect(toastContract?.designOnlyPaths).toEqual(["icon"]);
		expect(toastContract?.axes.map((axis) => axis.key)).toEqual([
			"open",
			"size",
			"tone",
		]);
		const axis = (key: string) =>
			toastContract?.axes.find((entry) => entry.key === key);
		expect(axis("tone")).toMatchObject({
			boolean: false,
			default: "neutral",
			required: false,
			typeAlias: "ToastTone",
			values: [
				{ key: "neutral", classes: [] },
				{ key: "danger", classes: [["root", "bg-red-500"]] },
			],
		});
		expect(axis("size")).toMatchObject({
			default: null,
			required: true,
			values: [
				{ key: "sm", classes: [["title", "text-sm"]] },
				{ key: "lg", classes: [] },
			],
		});
		expect(axis("open")).toMatchObject({
			boolean: true,
			default: false,
			required: false,
		});
		expect(toastContract?.compounds).toEqual([
			{
				when: [
					["tone", "danger"],
					["size", "lg"],
				],
				classes: [["root", "ring"]],
			},
		]);
		expect(toastContract?.designOnlyPaths).toEqual(["icon"]);
	});

	it("keeps unpublished and invalid components in the contract without a model", () => {
		const draftOnly = {
			...publishedComponent("card", flatPayload("p-2")),
			published: undefined,
		};
		const invalid = publishedComponent("base-thing", {
			root: templateNode("root", "p-1", [templateNode("base", "p-2")]),
			slots: {},
			variants: { axes: {}, compoundVariants: [] },
			overrideTargets: {},
		});
		const contract = buildSystemContract({
			system,
			manifest: manifestOf([draftOnly, invalid]),
			tokens: null,
			codegen: { status: "unconfigured" },
		});
		expect(contract.codegen).toMatchObject({ configured: false, outDir: null });
		expect(findContractComponent(contract, { slug: "card" })).toMatchObject({
			publishedVersion: null,
			shape: null,
			slots: [],
			codegen: { selected: false },
		});
		const broken = findContractComponent(contract, { slug: "base-thing" });
		expect(broken).toMatchObject({
			publishedVersion: "1",
			shape: null,
			codegen: { selected: false },
		});
		expect(broken?.codegen.issues[0]).toContain('path "base"');
	});

	it("resolves the token side and hashes deterministically", () => {
		const stored = tokens();
		stored.domains.color = {
			tokens: { "brand-500": "#2563eb" },
			overrides: [],
			baselineDiff: {
				added: [{ name: "brand-500", value: "#2563eb", domain: "color" }],
				overridden: [],
				removed: [{ name: "red-500", defaultValue: "#f00", domain: "color" }],
			},
		};
		stored.customUtilities = [
			{
				root: "text-interaction",
				kind: "functional",
				consumedNamespaces: [],
				completionValues: [],
				domains: [],
			},
		];
		const build = () =>
			buildSystemContract({
				system,
				manifest: manifestOf([]),
				tokens: stored,
				codegen: { status: "unconfigured" },
			});
		const first = build();
		expect(first.tokens.domains.color).toContain("brand-500");
		expect(first.tokens.domains.color).not.toContain("red-500");
		expect(first.tokens.removed.color).toEqual(["red-500"]);
		expect(first.tokens.removed.spacing).toEqual([]);
		expect(first.tokens.domains.color).toContain("blue-500");
		expect(first.tokens.customUtilities).toEqual([
			{ root: "text-interaction", kind: "functional" },
		]);
		expect(first.tokens.snapshot).toEqual({
			syncedAt: "2026-01-01T00:00:00.000Z",
			reviewRequired: false,
		});
		expect(build().hash).toBe(first.hash);
		const without = buildSystemContract({
			system,
			manifest: manifestOf([]),
			tokens: null,
			codegen: { status: "unconfigured" },
		});
		expect(without.tokens.snapshot).toBeNull();
		expect(without.hash).not.toBe(first.hash);
	});

	it("keeps every published version's axes and the class targets for design rules", () => {
		const payload = (axes: Record<string, string[]>) => ({
			root: templateNode("root", "flex", [
				{ ...templateNode("hint", "text-xs"), designOnly: true } as never,
			]),
			slots: {},
			variants: {
				axes: Object.fromEntries(
					Object.entries(axes).map(([key, values]) => [
						key,
						{
							label: key,
							values: Object.fromEntries(values.map((value) => [value, {}])),
						},
					]),
				),
				compoundVariants: [],
			},
			overrideTargets: {},
		});
		const v1 = publishedComponent("chip", payload({ size: ["sm", "lg"] }), {
			version: "1",
		});
		const current = payload({ size: ["sm", "md", "lg"], tone: ["plain"] });
		current.variants.axes.tone.values.plain = {
			classesByPath: { hint: "italic", root: "ring" },
		} as never;
		(current.variants as { compoundVariants: unknown[] }).compoundVariants = [
			{ when: { size: "md" }, classesByPath: { hint: "underline" } },
		];
		const v2 = publishedComponent("chip", current, {
			version: "2",
			componentId: v1.componentId,
		});
		const record = {
			...v2,
			published: {
				currentVersion: "2",
				versions: {
					...(v1.published?.versions ?? {}),
					...(v2.published?.versions ?? {}),
				},
			},
		};
		const contract = buildSystemContract({
			system,
			manifest: manifestOf([record]),
			tokens: null,
			codegen: { status: "unconfigured" },
		});
		const chip = findContractComponent(contract, { slug: "chip" });
		expect(chip?.versions).toEqual([
			{ version: "1", axes: [{ key: "size", values: ["sm", "lg"] }] },
			{
				version: "2",
				axes: [
					{ key: "size", values: ["sm", "md", "lg"] },
					{ key: "tone", values: ["plain"] },
				],
			},
		]);
		expect(chip?.classTargets).toEqual([
			{ axis: "tone", value: "plain", compound: null, path: "hint" },
			{ axis: "tone", value: "plain", compound: null, path: "root" },
			{ axis: null, value: null, compound: 0, path: "hint" },
		]);
		expect(chip?.designOnlyPaths).toEqual(["hint"]);
		// The design-only target makes the codegen model invalid; the design
		// side still sees the axes.
		expect(chip?.axes).toEqual([]);
	});
});
