import { describe, expect, it } from "vitest";
import { resolveCodegenConfig } from "../../codegen/config";
import { formatCodegenHeader } from "../../codegen/header";
import {
	CODEGEN_TEST_SYSTEM_ID,
	flatPayload,
	publishedComponent,
} from "../../codegen/test-support";
import { createEmptySystemComponentManifest } from "../../utils/system-components";
import { DEFAULT_CLASS_CALLS } from "../config";
import { buildSystemContract } from "../contract";
import {
	buildSourceIndex,
	countUsagesByFile,
	resolveExport,
	resolveModuleSpecifier,
} from "./index";
import { parseSourceModule } from "./parse";

const button = publishedComponent("button", flatPayload("px-3"), {
	componentId: "cmp_button-0000-4000-8000-000000000000",
});
const badge = publishedComponent("badge", flatPayload("px-1"), {
	componentId: "cmp_badge0-0000-4000-8000-000000000000",
});
const contract = buildSystemContract({
	system: { id: CODEGEN_TEST_SYSTEM_ID, name: "Core" },
	manifest: {
		...createEmptySystemComponentManifest(),
		components: { [button.componentId]: button, [badge.componentId]: badge },
	},
	tokens: null,
	codegen: resolveCodegenConfig({
		name: "x",
		codegen: { version: 1, outDir: "src/ui" },
	}),
});

const header = (
	slug: string,
	componentId: string,
	systemId = CODEGEN_TEST_SYSTEM_ID,
) =>
	formatCodegenHeader({
		version: 1,
		systemId,
		componentId,
		slug,
		source: "published",
		publishedVersion: "1",
		templateHash: "sha256:t",
		variantSchemaHash: "sha256:v",
		sourceHash: "sha256:s",
	});

const parse = (file: string, text: string) =>
	parseSourceModule(file, text, { classCalls: DEFAULT_CLASS_CALLS });

describe("source index", () => {
	it("resolves relative specifiers against the scanned files", () => {
		const files = new Set([
			"src/ui/button.tsx",
			"src/ui/badge/index.ts",
			"src/ui/x.variants.ts",
			"src/lib.js",
		]);
		expect(resolveModuleSpecifier("src/app.tsx", "./ui/button", files)).toBe(
			"src/ui/button.tsx",
		);
		expect(resolveModuleSpecifier("src/app.tsx", "./ui/button.js", files)).toBe(
			"src/ui/button.tsx",
		);
		expect(resolveModuleSpecifier("src/app.tsx", "./ui/badge", files)).toBe(
			"src/ui/badge/index.ts",
		);
		expect(
			resolveModuleSpecifier("src/ui/button.tsx", "../lib.js", files),
		).toBe("src/lib.js");
		expect(
			resolveModuleSpecifier("src/ui/button.tsx", "./x.variants", files),
		).toBe("src/ui/x.variants.ts");
		expect(resolveModuleSpecifier("src/app.tsx", "react", files)).toBeNull();
		expect(
			resolveModuleSpecifier("src/app.tsx", "@/ui/button", files),
		).toBeNull();
		expect(
			resolveModuleSpecifier("src/app.tsx", "./missing", files),
		).toBeNull();
	});

	it("finds generated files, wrappers, re-exporters and usages through barrels", () => {
		const modules = [
			parse(
				"src/ui/button.variants.ts",
				`${header("button", button.componentId)}\nimport { tv } from "./tv";\nexport const buttonVariants = tv({ base: "px-3" });\n`,
			),
			parse(
				"src/ui/badge.variants.ts",
				`${header("badge", badge.componentId)}\nimport { tv } from "./tv";\nexport const badgeVariants = tv({ base: "px-1" });\n`,
			),
			parse(
				"src/ui/stray.variants.ts",
				`${header("stray", "cmp_stray")}\nexport const strayVariants = 1;\n`,
			),
			parse(
				"src/ui/other.variants.ts",
				`${header("other", "cmp_other", "sys_other")}\nexport const otherVariants = 1;\n`,
			),
			parse(
				"src/ui/button.tsx",
				`import { buttonVariants } from "./button.variants";\nexport const Button = (p) => <button className={buttonVariants(p)} />;\nexport default Button;\n`,
			),
			parse(
				"src/ui/badge.tsx",
				`import type { BadgeTone } from "./badge.variants";\nimport { badgeVariants } from "./badge.variants.js";\nexport function Badge() { return <span className={badgeVariants()} />; }\n`,
			),
			parse(
				"src/ui/borrow.ts",
				`export { buttonVariants } from "./button.variants";\n`,
			),
			parse(
				"src/ui/index.ts",
				`export * from "./button";\nexport { Badge as Pill } from "./badge";\n`,
			),
			parse(
				"src/app.tsx",
				`import { Button, Pill } from "./ui";\nimport * as UI from "./ui";\nimport Primary from "./ui/button";\nimport { Button as Unrelated } from "@/elsewhere";\nexport const App = () => <><Button /><Pill /><UI.Button /><Primary /><Unrelated /><div /></>;\n`,
			),
		];
		const index = buildSourceIndex({ modules, contract });
		expect(index.files).toEqual(modules.map((module) => module.file).sort());
		expect(Object.keys(index.generated).sort()).toEqual([
			"src/ui/badge.variants.ts",
			"src/ui/button.variants.ts",
			"src/ui/stray.variants.ts",
		]);
		expect(index.unknownGenerated).toEqual(["src/ui/stray.variants.ts"]);
		expect(index.components).toEqual([
			{
				slug: "badge",
				componentId: badge.componentId,
				expectedFile: "src/ui/badge.variants.ts",
				generatedFiles: ["src/ui/badge.variants.ts"],
				wrappers: ["src/ui/badge.tsx"],
				configuredWrappers: [],
				importers: ["src/ui/badge.tsx"],
				reexporters: [],
			},
			{
				slug: "button",
				componentId: button.componentId,
				expectedFile: "src/ui/button.variants.ts",
				generatedFiles: ["src/ui/button.variants.ts"],
				wrappers: ["src/ui/button.tsx"],
				configuredWrappers: [],
				importers: ["src/ui/button.tsx"],
				reexporters: ["src/ui/borrow.ts"],
			},
		]);
		expect(
			index.modules["src/ui/badge.tsx"].imports.map((entry) => entry.resolved),
		).toEqual(["src/ui/badge.variants.ts", "src/ui/badge.variants.ts"]);
		expect(index.bindings["src/app.tsx"]).toEqual({
			Button: "button",
			Pill: "badge",
			Primary: "button",
		});
		expect(
			index.usages.map(
				(usage) =>
					`${usage.file}:${usage.element.position.column} ${usage.element.name} -> ${usage.slug}`,
			),
		).toEqual([
			"src/app.tsx:28 Button -> button",
			"src/app.tsx:38 Pill -> badge",
			"src/app.tsx:46 UI.Button -> button",
			"src/app.tsx:59 Primary -> button",
		]);
		expect(countUsagesByFile(index)).toEqual({ "src/app.tsx": 4 });
		expect(resolveExport(index.modules, "src/ui/index.ts", "Pill")).toEqual({
			file: "src/ui/badge.tsx",
			name: "Badge",
		});
		expect(
			resolveExport(index.modules, "src/ui/index.ts", "default"),
		).toBeNull();
	});

	it("honours configured wrapper modules over importers", () => {
		const modules = [
			parse(
				"src/ui/button.variants.ts",
				`${header("button", button.componentId)}\nexport const buttonVariants = 1;\n`,
			),
			parse(
				"src/ui/button.tsx",
				`import { buttonVariants } from "./button.variants";\nexport const Button = () => null;\n`,
			),
			parse(
				"src/ui/legacy.tsx",
				`import { buttonVariants } from "./button.variants";\nexport const Legacy = () => null;\n`,
			),
			parse(
				"src/app.tsx",
				`import { Legacy } from "./ui/legacy";\nexport const App = () => <Legacy />;\n`,
			),
		];
		const index = buildSourceIndex({
			modules,
			contract,
			componentModules: { button: { modules: ["./src/ui/button.tsx"] } },
		});
		const identity = index.components.find(
			(component) => component.slug === "button",
		);
		expect(identity).toMatchObject({
			wrappers: ["src/ui/button.tsx"],
			configuredWrappers: ["src/ui/button.tsx"],
			importers: ["src/ui/button.tsx", "src/ui/legacy.tsx"],
		});
		expect(index.usages).toEqual([]);
	});
});
