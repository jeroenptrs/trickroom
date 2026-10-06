import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flatPayload, publishedComponent } from "../codegen/test-support";
import { serializeSystemComponentManifest } from "../utils/system-component-manifest-service";
import { createEmptySystemComponentManifest } from "../utils/system-components";

describe("system lint routes", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;
	const systemId = "sys_00000000-0000-4000-8000-000000000077";

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-system-lint-routes-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
		const systemDir = path.join(
			tempProjectRoot,
			".trickroom",
			"systems",
			"core",
		);
		await mkdir(systemDir, { recursive: true });
		await writeFile(
			path.join(tempProjectRoot, ".trickroom", "config.json"),
			JSON.stringify({
				schemaVersion: 1,
				projectId: "proj_lint_routes",
				name: "Lint Routes",
				defaultSystemId: systemId,
				codegen: { version: 1, outDir: "src/ui" },
			}),
		);
		await writeFile(
			path.join(systemDir, "system.json"),
			JSON.stringify({ version: 1, systemId, systemName: "Core" }),
		);
		const button = publishedComponent("button", flatPayload("px-3"));
		await writeFile(
			path.join(systemDir, "components.json"),
			serializeSystemComponentManifest({
				...createEmptySystemComponentManifest(),
				components: { [button.componentId]: button },
			}),
		);
	});

	afterEach(async () => {
		if (previousProjectDirOverride === undefined) {
			delete process.env.TRICKROOM_PROJECT_DIR;
		} else {
			process.env.TRICKROOM_PROJECT_DIR = previousProjectDirOverride;
		}
		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const importTestServer = async () => {
		const { default: app } = await import("../server");
		return app;
	};

	it("404s without a report, runs lint on POST and serves the written report", async () => {
		const app = await importTestServer();
		const missing = await app.request("/api/trickroom/systems/Core/lint");
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({
			code: "LINT_REPORT_NOT_FOUND",
		});

		const run = await app.request(`/api/trickroom/systems/${systemId}/lint`, {
			method: "POST",
		});
		expect(run.status).toBe(200);
		const body = (await run.json()) as Record<string, unknown>;
		expect(body).toMatchObject({
			systemId,
			systemName: "Core",
			status: "pass",
			written: true,
			ratchet: { status: "pass", baseline: null },
			report: { version: 1, summary: { code: { findings: { errors: 1 } } } },
		});
		const stored = JSON.parse(
			await readFile(
				path.join(tempProjectRoot, ".trickroom/systems/core/lint-report.json"),
				"utf8",
			),
		);
		expect(stored.status).toBe("pass");

		const read = await app.request("/api/trickroom/systems/core/lint");
		expect(read.status).toBe(200);
		expect(await read.json()).toEqual({
			systemId,
			systemName: "Core",
			report: stored,
		});

		expect((await app.request("/api/trickroom/systems/nope/lint")).status).toBe(
			404,
		);
	});

	it("writes a failing run on demand without moving the baseline, and reports unreadable reports", async () => {
		const app = await importTestServer();
		await mkdir(path.join(tempProjectRoot, "src/ui"), { recursive: true });
		const generated = await (await import("../codegen/run-codegen")).runCodegen(
			{
				projectRoot: tempProjectRoot,
				config: {
					status: "configured",
					version: 1,
					system: systemId,
					outDir: "src/ui",
					fileName: "{slug}.variants.ts",
					tvImport: "./tv",
					shape: "auto",
					include: null,
					exclude: [],
					formatter: null,
				},
				mode: "write",
			},
		);
		expect(generated.status).toBe("ok");
		const clean = await app.request("/api/trickroom/systems/core/lint", {
			method: "POST",
		});
		expect(await clean.json()).toMatchObject({
			status: "pass",
			report: { summary: { code: { findings: { errors: 0 } } } },
		});

		await writeFile(
			path.join(tempProjectRoot, "src/ui/button.variants.ts"),
			"// mine\n",
		);
		const failing = await app.request("/api/trickroom/systems/core/lint", {
			method: "POST",
		});
		const body = (await failing.json()) as {
			status: string;
			written: boolean;
			report: {
				status: string;
				ratchetBaseline: { numbers: Record<string, number> };
			};
		};
		expect(body).toMatchObject({ status: "fail", written: true });
		expect(body.report.status).toBe("fail");
		expect(body.report.ratchetBaseline.numbers["code.errors"]).toBe(0);

		await writeFile(
			path.join(tempProjectRoot, ".trickroom/systems/core/lint-report.json"),
			"{ nope",
		);
		const invalid = await app.request("/api/trickroom/systems/core/lint");
		expect(invalid.status).toBe(409);
		expect(await invalid.json()).toMatchObject({ code: "LINT_REPORT_INVALID" });
	});

	it("reports a run that cannot complete", async () => {
		const app = await importTestServer();
		await writeFile(
			path.join(tempProjectRoot, ".trickroom/systems/core/lint.json"),
			JSON.stringify({ version: 1, rules: { "code.nope": {} } }),
		);
		const response = await app.request("/api/trickroom/systems/core/lint", {
			method: "POST",
		});
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			code: "LINT_FAILED",
			diagnostics: [{ code: "INVALID_LINT_CONFIG" }],
		});
	});
});
