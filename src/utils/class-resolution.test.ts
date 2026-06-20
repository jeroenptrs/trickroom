import { describe, expect, it } from "vitest";
import type { ClassLayer } from "./class-layers";
import { resolveClassLayers } from "./class-resolution";

const options = { colorTokens: new Set<string>() };

const statuses = (layers: readonly ClassLayer[]) =>
	resolveClassLayers(layers, options).tokens.map((token) => ({
		classToken: token.classToken,
		source: token.layer.source,
		status: token.status,
		scope: token.conflictScope?.key,
		shadowedBy: token.shadowedBy,
	}));

const matrix = (layers: readonly ClassLayer[], matrixOptions = options) =>
	resolveClassLayers(layers, matrixOptions).tokens.map((token) => ({
		classToken: token.classToken,
		status: token.status,
		source: token.layer.source,
		layerIndex: token.layer.index,
		tokenIndex: token.layer.tokenIndex,
		metadata: token.layer.metadata,
		scope: token.conflictScope?.key,
		shadowedBy: token.shadowedBy,
	}));

describe("resolveClassLayers", () => {
	it("preserves deterministic token order with layer metadata", () => {
		const resolution = resolveClassLayers(
			[
				{
					source: "registry-base",
					className: "h-px w-full",
					metadata: { library: "base-ui", component: "separator" },
				},
				{
					source: "authored",
					className: "h-2",
					metadata: { instanceId: "instance-1" },
				},
			],
			options,
		);

		expect(resolution.tokens.map((token) => token.classToken)).toEqual([
			"h-px",
			"w-full",
			"h-2",
		]);
		expect(resolution.tokens[0].layer).toEqual({
			source: "registry-base",
			index: 0,
			tokenIndex: 0,
			metadata: { library: "base-ui", component: "separator" },
		});
		expect(resolution.tokens[2].layer).toEqual({
			source: "authored",
			index: 1,
			tokenIndex: 0,
			metadata: { instanceId: "instance-1" },
		});
	});

	it("lets later layers shadow earlier standard utilities with the same conflict scope", () => {
		expect(
			statuses([
				{ source: "registry-base", className: "h-px" },
				{ source: "system-variant", className: "h-2" },
				{ source: "authored", className: "h-4" },
			]),
		).toEqual([
			{
				classToken: "h-px",
				source: "registry-base",
				status: "shadowed",
				scope: "|style:size.height",
				shadowedBy: 1,
			},
			{
				classToken: "h-2",
				source: "system-variant",
				status: "shadowed",
				scope: "|style:size.height",
				shadowedBy: 2,
			},
			{
				classToken: "h-4",
				source: "authored",
				status: "active",
				scope: "|style:size.height",
				shadowedBy: undefined,
			},
		]);
	});

	it("keeps non-conflicting utilities active", () => {
		expect(
			statuses([
				{ source: "registry-base", className: "h-px w-full" },
				{ source: "authored", className: "p-4" },
			]).map(({ classToken, status }) => ({ classToken, status })),
		).toEqual([
			{ classToken: "h-px", status: "active" },
			{ classToken: "w-full", status: "active" },
			{ classToken: "p-4", status: "active" },
		]);
	});

	it("uses exact modifier chains for data-variant conflicts", () => {
		expect(
			statuses([
				{
					source: "registry-base",
					className:
						"data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-px h-1",
				},
				{
					source: "authored",
					className: "data-[orientation=horizontal]:h-2 hover:h-4",
				},
			]).map(({ classToken, status, scope }) => ({
				classToken,
				status,
				scope,
			})),
		).toEqual([
			{
				classToken: "data-[orientation=horizontal]:h-px",
				status: "shadowed",
				scope: "data-[orientation=horizontal]|style:size.height",
			},
			{
				classToken: "data-[orientation=vertical]:h-px",
				status: "active",
				scope: "data-[orientation=vertical]|style:size.height",
			},
			{
				classToken: "h-1",
				status: "active",
				scope: "|style:size.height",
			},
			{
				classToken: "data-[orientation=horizontal]:h-2",
				status: "active",
				scope: "data-[orientation=horizontal]|style:size.height",
			},
			{
				classToken: "hover:h-4",
				status: "active",
				scope: "hover|style:size.height",
			},
		]);
	});

	it("classifies custom token and arbitrary value utilities through the current domains", () => {
		expect(
			statuses([
				{ source: "system-template", className: "p-card pt-[13px]" },
				{ source: "authored", className: "p-6 pt-4" },
			]).map(({ classToken, status, scope }) => ({
				classToken,
				status,
				scope,
			})),
		).toEqual([
			{
				classToken: "p-card",
				status: "shadowed",
				scope: "|spacing:padding",
			},
			{
				classToken: "pt-[13px]",
				status: "shadowed",
				scope: "|spacing:padding-top",
			},
			{
				classToken: "p-6",
				status: "active",
				scope: "|spacing:padding",
			},
			{
				classToken: "pt-4",
				status: "active",
				scope: "|spacing:padding-top",
			},
		]);
	});

	it("represents unclassifiable utilities conservatively as unknown and non-shadowing", () => {
		const resolution = resolveClassLayers(
			[
				{
					source: "registry-base",
					className: "custom-thing [mask:linear-gradient(red,blue)]",
				},
				{ source: "authored", className: "custom-thing h-2" },
			],
			options,
		);

		expect(
			resolution.tokens.map(({ classToken, status, conflictScope }) => ({
				classToken,
				status,
				scope: conflictScope?.key,
			})),
		).toEqual([
			{ classToken: "custom-thing", status: "unknown", scope: undefined },
			{
				classToken: "[mask:linear-gradient(red,blue)]",
				status: "unknown",
				scope: undefined,
			},
			{ classToken: "custom-thing", status: "unknown", scope: undefined },
			{ classToken: "h-2", status: "active", scope: "|style:size.height" },
		]);
		expect(resolution.unknown.map((token) => token.classToken)).toEqual([
			"custom-thing",
			"[mask:linear-gradient(red,blue)]",
			"custom-thing",
		]);
	});

	it("tracks standard utility conflicts across registry base and authored layers", () => {
		expect(
			matrix([
				{
					source: "registry-base",
					className: "inline-flex items-center h-px",
					metadata: { library: "base-ui", component: "separator" },
				},
				{
					source: "authored",
					className: "items-start h-4",
					metadata: { instanceId: "separator-1", path: "root" },
				},
			]),
		).toEqual([
			{
				classToken: "inline-flex",
				status: "active",
				source: "registry-base",
				layerIndex: 0,
				tokenIndex: 0,
				metadata: { library: "base-ui", component: "separator" },
				scope: "|style:layout.display",
				shadowedBy: undefined,
			},
			{
				classToken: "items-center",
				status: "shadowed",
				source: "registry-base",
				layerIndex: 0,
				tokenIndex: 1,
				metadata: { library: "base-ui", component: "separator" },
				scope: "|style:layout.align-items",
				shadowedBy: 3,
			},
			{
				classToken: "h-px",
				status: "shadowed",
				source: "registry-base",
				layerIndex: 0,
				tokenIndex: 2,
				metadata: { library: "base-ui", component: "separator" },
				scope: "|style:size.height",
				shadowedBy: 4,
			},
			{
				classToken: "items-start",
				status: "active",
				source: "authored",
				layerIndex: 1,
				tokenIndex: 0,
				metadata: { instanceId: "separator-1", path: "root" },
				scope: "|style:layout.align-items",
				shadowedBy: undefined,
			},
			{
				classToken: "h-4",
				status: "active",
				source: "authored",
				layerIndex: 1,
				tokenIndex: 1,
				metadata: { instanceId: "separator-1", path: "root" },
				scope: "|style:size.height",
				shadowedBy: undefined,
			},
		]);
	});

	it("tracks custom token utilities and arbitrary values without flattening away layer metadata", () => {
		expect(
			matrix([
				{
					source: "system-template",
					className: "p-card w-[13.5rem] bg-brand-500",
					metadata: { componentId: "card", path: "root" },
				},
				{
					source: "instance-override",
					className: "p-6 w-(--panel-width) bg-[#123456]",
					metadata: { path: "root", prop: "className" },
				},
			]),
		).toEqual([
			{
				classToken: "p-card",
				status: "shadowed",
				source: "system-template",
				layerIndex: 0,
				tokenIndex: 0,
				metadata: { componentId: "card", path: "root" },
				scope: "|spacing:padding",
				shadowedBy: 3,
			},
			{
				classToken: "w-[13.5rem]",
				status: "shadowed",
				source: "system-template",
				layerIndex: 0,
				tokenIndex: 1,
				metadata: { componentId: "card", path: "root" },
				scope: "|style:size.width",
				shadowedBy: 4,
			},
			{
				classToken: "bg-brand-500",
				status: "shadowed",
				source: "system-template",
				layerIndex: 0,
				tokenIndex: 2,
				metadata: { componentId: "card", path: "root" },
				scope: "|color:background",
				shadowedBy: 5,
			},
			{
				classToken: "p-6",
				status: "active",
				source: "instance-override",
				layerIndex: 1,
				tokenIndex: 0,
				metadata: { path: "root", prop: "className" },
				scope: "|spacing:padding",
				shadowedBy: undefined,
			},
			{
				classToken: "w-(--panel-width)",
				status: "active",
				source: "instance-override",
				layerIndex: 1,
				tokenIndex: 1,
				metadata: { path: "root", prop: "className" },
				scope: "|style:size.width",
				shadowedBy: undefined,
			},
			{
				classToken: "bg-[#123456]",
				status: "active",
				source: "instance-override",
				layerIndex: 1,
				tokenIndex: 2,
				metadata: { path: "root", prop: "className" },
				scope: "|color:background",
				shadowedBy: undefined,
			},
		]);
	});

	it("keeps data variant and modifier chain conflicts exact across authored overrides", () => {
		expect(
			matrix([
				{
					source: "registry-base",
					className:
						"data-[state=open]:opacity-100 md:dark:data-[state=open]:h-8",
					metadata: { library: "base-ui", component: "popover" },
				},
				{
					source: "authored",
					className:
						"data-[state=open]:opacity-0 dark:md:data-[state=open]:h-10 md:dark:data-[state=open]:h-12",
					metadata: { instanceId: "popover-1" },
				},
			]).map(({ classToken, status, scope, shadowedBy }) => ({
				classToken,
				status,
				scope,
				shadowedBy,
			})),
		).toEqual([
			{
				classToken: "data-[state=open]:opacity-100",
				status: "shadowed",
				scope: "data-[state=open]|style:effects.opacity",
				shadowedBy: 2,
			},
			{
				classToken: "md:dark:data-[state=open]:h-8",
				status: "shadowed",
				scope: "md:dark:data-[state=open]|style:size.height",
				shadowedBy: 4,
			},
			{
				classToken: "data-[state=open]:opacity-0",
				status: "active",
				scope: "data-[state=open]|style:effects.opacity",
				shadowedBy: undefined,
			},
			{
				classToken: "dark:md:data-[state=open]:h-10",
				status: "active",
				scope: "dark:md:data-[state=open]|style:size.height",
				shadowedBy: undefined,
			},
			{
				classToken: "md:dark:data-[state=open]:h-12",
				status: "active",
				scope: "md:dark:data-[state=open]|style:size.height",
				shadowedBy: undefined,
			},
		]);
	});

	it("orders system template, variant, compound, and override layers using normal cascade semantics", () => {
		expect(
			matrix([
				{
					source: "system-template",
					className: "inline-flex px-2 bg-neutral-100",
					metadata: { componentId: "button", path: "root" },
				},
				{
					source: "system-variant",
					className: "px-4 bg-brand-600",
					metadata: { path: "root", axis: "intent", value: "brand" },
				},
				{
					source: "system-compound-variant",
					className: "bg-brand-700 ring-2",
					metadata: { path: "root", compoundIndex: 0 },
				},
				{
					source: "instance-override",
					className: "px-6 ring-4",
					metadata: { path: "root", prop: "className" },
				},
			]).map(({ classToken, status, source, metadata, scope, shadowedBy }) => ({
				classToken,
				status,
				source,
				metadata,
				scope,
				shadowedBy,
			})),
		).toEqual([
			{
				classToken: "inline-flex",
				status: "active",
				source: "system-template",
				metadata: { componentId: "button", path: "root" },
				scope: "|style:layout.display",
				shadowedBy: undefined,
			},
			{
				classToken: "px-2",
				status: "shadowed",
				source: "system-template",
				metadata: { componentId: "button", path: "root" },
				scope: "|spacing:padding-x",
				shadowedBy: 3,
			},
			{
				classToken: "bg-neutral-100",
				status: "shadowed",
				source: "system-template",
				metadata: { componentId: "button", path: "root" },
				scope: "|color:background",
				shadowedBy: 4,
			},
			{
				classToken: "px-4",
				status: "shadowed",
				source: "system-variant",
				metadata: { path: "root", axis: "intent", value: "brand" },
				scope: "|spacing:padding-x",
				shadowedBy: 7,
			},
			{
				classToken: "bg-brand-600",
				status: "shadowed",
				source: "system-variant",
				metadata: { path: "root", axis: "intent", value: "brand" },
				scope: "|color:background",
				shadowedBy: 5,
			},
			{
				classToken: "bg-brand-700",
				status: "active",
				source: "system-compound-variant",
				metadata: { path: "root", compoundIndex: 0 },
				scope: "|color:background",
				shadowedBy: undefined,
			},
			{
				classToken: "ring-2",
				status: "shadowed",
				source: "system-compound-variant",
				metadata: { path: "root", compoundIndex: 0 },
				scope: "|style:focus.ring-width",
				shadowedBy: 8,
			},
			{
				classToken: "px-6",
				status: "active",
				source: "instance-override",
				metadata: { path: "root", prop: "className" },
				scope: "|spacing:padding-x",
				shadowedBy: undefined,
			},
			{
				classToken: "ring-4",
				status: "active",
				source: "instance-override",
				metadata: { path: "root", prop: "className" },
				scope: "|style:focus.ring-width",
				shadowedBy: undefined,
			},
		]);
	});

	it("treats materialized snapshots as ordinary layers whose later authored classes can shadow them", () => {
		expect(
			matrix([
				{
					source: "materialized-snapshot",
					className: "flex gap-2 text-sm",
					metadata: { instanceId: "detached-1", path: "root" },
				},
				{
					source: "authored",
					className: "gap-4 text-lg",
					metadata: { instanceId: "detached-1", path: "root" },
				},
			]).map(({ classToken, status, source, metadata, scope, shadowedBy }) => ({
				classToken,
				status,
				source,
				metadata,
				scope,
				shadowedBy,
			})),
		).toEqual([
			{
				classToken: "flex",
				status: "active",
				source: "materialized-snapshot",
				metadata: { instanceId: "detached-1", path: "root" },
				scope: "|style:layout.display",
				shadowedBy: undefined,
			},
			{
				classToken: "gap-2",
				status: "shadowed",
				source: "materialized-snapshot",
				metadata: { instanceId: "detached-1", path: "root" },
				scope: "|spacing:gap",
				shadowedBy: 3,
			},
			{
				classToken: "text-sm",
				status: "shadowed",
				source: "materialized-snapshot",
				metadata: { instanceId: "detached-1", path: "root" },
				scope: "|style:typography.font-size",
				shadowedBy: 4,
			},
			{
				classToken: "gap-4",
				status: "active",
				source: "authored",
				metadata: { instanceId: "detached-1", path: "root" },
				scope: "|spacing:gap",
				shadowedBy: undefined,
			},
			{
				classToken: "text-lg",
				status: "active",
				source: "authored",
				metadata: { instanceId: "detached-1", path: "root" },
				scope: "|style:typography.font-size",
				shadowedBy: undefined,
			},
		]);
	});

	it("keeps live recipe-like registry layers and detached recipe snapshots comparable by source metadata", () => {
		const layers: ClassLayer[] = [
			{
				source: "registry-base",
				className: "rounded-md px-2",
				metadata: { library: "base-ui", component: "menu-item", path: "root" },
			},
			{
				source: "authored",
				className: "px-3",
				metadata: { instanceId: "live-recipe-item", path: "root" },
			},
			{
				source: "materialized-snapshot",
				className: "rounded-md px-2",
				metadata: { instanceId: "detached-recipe-item", path: "root" },
			},
			{
				source: "authored",
				className: "rounded-lg px-4",
				metadata: { instanceId: "detached-recipe-item", path: "root" },
			},
		];

		expect(
			matrix(layers).map(
				({
					classToken,
					status,
					source,
					layerIndex,
					metadata,
					scope,
					shadowedBy,
				}) => ({
					classToken,
					status,
					source,
					layerIndex,
					metadata,
					scope,
					shadowedBy,
				}),
			),
		).toEqual([
			{
				classToken: "rounded-md",
				status: "shadowed",
				source: "registry-base",
				layerIndex: 0,
				metadata: { library: "base-ui", component: "menu-item", path: "root" },
				scope: "|style:border.radius",
				shadowedBy: 3,
			},
			{
				classToken: "px-2",
				status: "shadowed",
				source: "registry-base",
				layerIndex: 0,
				metadata: { library: "base-ui", component: "menu-item", path: "root" },
				scope: "|spacing:padding-x",
				shadowedBy: 2,
			},
			{
				classToken: "px-3",
				status: "shadowed",
				source: "authored",
				layerIndex: 1,
				metadata: { instanceId: "live-recipe-item", path: "root" },
				scope: "|spacing:padding-x",
				shadowedBy: 4,
			},
			{
				classToken: "rounded-md",
				status: "shadowed",
				source: "materialized-snapshot",
				layerIndex: 2,
				metadata: { instanceId: "detached-recipe-item", path: "root" },
				scope: "|style:border.radius",
				shadowedBy: 5,
			},
			{
				classToken: "px-2",
				status: "shadowed",
				source: "materialized-snapshot",
				layerIndex: 2,
				metadata: { instanceId: "detached-recipe-item", path: "root" },
				scope: "|spacing:padding-x",
				shadowedBy: 6,
			},
			{
				classToken: "rounded-lg",
				status: "active",
				source: "authored",
				layerIndex: 3,
				metadata: { instanceId: "detached-recipe-item", path: "root" },
				scope: "|style:border.radius",
				shadowedBy: undefined,
			},
			{
				classToken: "px-4",
				status: "active",
				source: "authored",
				layerIndex: 3,
				metadata: { instanceId: "detached-recipe-item", path: "root" },
				scope: "|spacing:padding-x",
				shadowedBy: undefined,
			},
		]);
	});

	it("supports component draft preview-like layers before runtime integration", () => {
		expect(
			matrix([
				{
					source: "system-template",
					className: "grid grid-cols-2 gap-2",
					metadata: { componentId: "draft-card", path: "root" },
				},
				{
					source: "system-variant",
					className: "grid-cols-3",
					metadata: {
						componentId: "draft-card",
						path: "root",
						axis: "density",
						value: "dense",
					},
				},
				{
					source: "authored",
					className: "gap-4",
					metadata: { componentId: "draft-card", path: "preview" },
				},
			]).map(({ classToken, status, source, metadata, scope, shadowedBy }) => ({
				classToken,
				status,
				source,
				metadata,
				scope,
				shadowedBy,
			})),
		).toEqual([
			{
				classToken: "grid",
				status: "active",
				source: "system-template",
				metadata: { componentId: "draft-card", path: "root" },
				scope: "|style:layout.display",
				shadowedBy: undefined,
			},
			{
				classToken: "grid-cols-2",
				status: "shadowed",
				source: "system-template",
				metadata: { componentId: "draft-card", path: "root" },
				scope: "|style:layout.grid-template-columns",
				shadowedBy: 3,
			},
			{
				classToken: "gap-2",
				status: "shadowed",
				source: "system-template",
				metadata: { componentId: "draft-card", path: "root" },
				scope: "|spacing:gap",
				shadowedBy: 4,
			},
			{
				classToken: "grid-cols-3",
				status: "active",
				source: "system-variant",
				metadata: {
					componentId: "draft-card",
					path: "root",
					axis: "density",
					value: "dense",
				},
				scope: "|style:layout.grid-template-columns",
				shadowedBy: undefined,
			},
			{
				classToken: "gap-4",
				status: "active",
				source: "authored",
				metadata: { componentId: "draft-card", path: "preview" },
				scope: "|spacing:gap",
				shadowedBy: undefined,
			},
		]);
	});

	it("documents current classifier gaps as unknown instead of widening resolver behavior", () => {
		// Arbitrary properties are parsed, but they do not belong to a known
		// conflict domain yet. Keep them unknown and non-shadowing until the
		// classifier grows a deliberate property-domain model for them.
		expect(
			matrix([
				{
					source: "registry-base",
					className: "[--trigger-width:12rem] [mask:linear-gradient(red,blue)]",
					metadata: { library: "base-ui", component: "popover" },
				},
				{
					source: "authored",
					className: "[--trigger-width:16rem] mask-linear-45",
					metadata: { instanceId: "popover-1" },
				},
			]).map(({ classToken, status, source, metadata, scope, shadowedBy }) => ({
				classToken,
				status,
				source,
				metadata,
				scope,
				shadowedBy,
			})),
		).toEqual([
			{
				classToken: "[--trigger-width:12rem]",
				status: "unknown",
				source: "registry-base",
				metadata: { library: "base-ui", component: "popover" },
				scope: undefined,
				shadowedBy: undefined,
			},
			{
				classToken: "[mask:linear-gradient(red,blue)]",
				status: "unknown",
				source: "registry-base",
				metadata: { library: "base-ui", component: "popover" },
				scope: undefined,
				shadowedBy: undefined,
			},
			{
				classToken: "[--trigger-width:16rem]",
				status: "unknown",
				source: "authored",
				metadata: { instanceId: "popover-1" },
				scope: undefined,
				shadowedBy: undefined,
			},
			{
				classToken: "mask-linear-45",
				status: "active",
				source: "authored",
				metadata: { instanceId: "popover-1" },
				scope: "|style:mask.mask-image",
				shadowedBy: undefined,
			},
		]);
	});
});
