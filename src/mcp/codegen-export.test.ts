import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TrickroomCodegenConfig } from "../types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
} from "./test-support";

describe("design_export format variants", () => {
	let fixture: TrickroomMcpProjectFixture | undefined;
	let session: TrickroomMcpClientSession | undefined;

	afterEach(async () => {
		await session?.close();
		await fixture?.cleanup();
	});

	const setup = async (
		options: {
			codegen?: TrickroomCodegenConfig;
			mode?: "read-only" | "read-write";
		} = {},
	) => {
		fixture = await createTrickroomMcpProjectFixture();
		// The first read migrates the fixture's legacy systems to manifests.
		await fixture.readMcpContext();
		const config = JSON.parse(await readFile(fixture.configPath, "utf8"));
		await writeFile(
			fixture.configPath,
			JSON.stringify({
				...config,
				...(options.mode ? { mcp: { ...config.mcp, mode: options.mode } } : {}),
				...(options.codegen ? { codegen: options.codegen } : {}),
			}),
		);
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		return { client: session.client, projectRoot: fixture.projectRoot };
	};

	const call = async (args: Record<string, unknown>, name = "design_export") =>
		session?.client.callTool({ name, arguments: args });

	const publish = async (slug: string, className: string) => {
		const read = await call({ systemName: "Core" }, "component_read");
		const created = await call(
			{
				systemName: "Core",
				expectedRevision: toolPayload(read).revision,
				slug,
				name: slug,
				draft: {
					root: {
						path: "root",
						library: "trickroom",
						component: "container",
						className,
					},
				},
			},
			"component_draft_create",
		);
		return toolPayload(
			await call(
				{
					systemName: "Core",
					componentId: toolPayload(created).componentId,
					expectedRevision: toolPayload(created).revision,
				},
				"component_publish",
			),
		);
	};

	it("writes the variants files, then checks them", async () => {
		const { projectRoot } = await setup({
			codegen: { version: 1, system: "Core", outDir: "src/ui" },
		});
		const published = await publish("button", "px-3 py-2");
		expect(published.status).toBe("success");
		expect(published.codegenHint).toContain(
			'design_export({ format: "variants" })',
		);

		const before = await call({ format: "variants", check: true });
		expect(before?.isError, JSON.stringify(toolPayload(before))).toBeFalsy();
		expect(toolPayload(before)).toMatchObject({
			status: "success",
			codegen: {
				status: "drift",
				mode: "check",
				components: [{ slug: "button", status: "missing" }],
				written: [],
			},
		});

		const written = await call({ format: "variants" });
		expect(written?.isError).toBeFalsy();
		expect(toolPayload(written).codegen).toMatchObject({
			status: "ok",
			mode: "write",
			source: "published",
			system: { name: "Core" },
			outDir: "src/ui",
			written: ["src/ui/button.variants.ts"],
		});
		expect(
			await readFile(
				path.join(projectRoot, "src/ui/button.variants.ts"),
				"utf8",
			),
		).toContain("px-3 py-2");

		const after = await call({ format: "variants", check: true });
		expect(toolPayload(after).codegen).toMatchObject({
			status: "ok",
			components: [{ slug: "button", status: "ok" }],
		});
	});

	it("returns a tool error with a minimal block when codegen is not configured", async () => {
		await setup();
		const published = await publish("button", "px-3");
		expect(published.status).toBe("success");
		expect(published).not.toHaveProperty("codegenHint");

		const result = await call({ format: "variants", check: true });
		expect(result?.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			code: "CODEGEN_NOT_CONFIGURED",
		});
		expect(toolPayload(result).message).toContain(
			'"codegen": { "version": 1, "outDir": ',
		);
	});

	it("refuses to overwrite files it did not generate and leaves --force to a human", async () => {
		const { projectRoot } = await setup({
			codegen: { version: 1, system: "Core", outDir: "src/ui" },
		});
		await publish("button", "px-3");
		await mkdir(path.join(projectRoot, "src/ui"), { recursive: true });
		await writeFile(
			path.join(projectRoot, "src/ui/button.variants.ts"),
			"// mine\n",
		);
		const result = await call({ format: "variants" });
		expect(result?.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			code: "REFUSED_OVERWRITE",
			codegen: { status: "error", written: [] },
		});
		expect(toolPayload(result).message).toContain(
			'ask a human to review the files and run "trickroom codegen --force"',
		);
		expect(
			await readFile(
				path.join(projectRoot, "src/ui/button.variants.ts"),
				"utf8",
			),
		).toBe("// mine\n");
	});

	it("needs write access for checks too, since they run the formatter", async () => {
		await setup({
			codegen: { version: 1, system: "Core", outDir: "src/ui" },
			mode: "read-only",
		});
		const result = await call({ format: "variants", check: true });
		expect(result?.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({ status: "POLICY_DENIED" });
	});

	it("rejects arguments that do not apply to the format", async () => {
		const { projectRoot } = await setup({
			codegen: { version: 1, system: "Core", outDir: "src/ui" },
		});
		const designFileId = "10000000-0000-4000-8000-000000000061";
		const cases: Array<[Record<string, unknown>, string]> = [
			[
				{ format: "variants", designFileId, destinationDir: "out" },
				'format "variants" does not take designFileId, destinationDir: the destination and system come from the codegen block',
			],
			[
				{ format: "variants", boardIds: ["a"] },
				'format "variants" does not take boardIds',
			],
			[{ destinationDir: "out" }, 'format "html" needs designFileId.'],
			[{ format: "png", designFileId }, 'format "png" needs destinationDir.'],
			[{}, 'format "html" needs designFileId and destinationDir.'],
			[
				{ designFileId, destinationDir: "out", check: true },
				'format "html" does not take check.',
			],
		];
		for (const [args, message] of cases) {
			const result = await call(args);
			expect(result?.isError, JSON.stringify(args)).toBe(true);
			expect(toolPayload(result)).toMatchObject({
				status: "INVALID_OPERATION",
				code: "INVALID_EXPORT_ARGUMENTS",
			});
			expect(toolPayload(result).message).toContain(message);
		}
		await expect(stat(path.join(projectRoot, "src/ui"))).rejects.toThrow();
		await expect(stat(path.join(projectRoot, "out"))).rejects.toThrow();
	});
});
