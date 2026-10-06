import path from "node:path";
import type { Context, Hono } from "hono";
import { resolveCodegenConfig } from "../codegen/config";
import {
	DEFAULT_CLASS_CALLS,
	DEFAULT_SOURCE_EXCLUDE,
	defaultSourceInclude,
	getLintConfigIssues,
	LINT_CONFIG_VERSIONS,
	type LintConfig,
} from "../lint/config";
import {
	type LintConfigFileRead,
	LintConfigWriteError,
	readLintConfigFile,
	writeLintConfigFile,
} from "../lint/config-file";
import { readCurrentContractHash } from "../lint/current-contract";
import { readLintReport } from "../lint/report";
import {
	describeLintRuleKinds,
	type LintRuleKindSummary,
} from "../lint/rule-catalogue";
import { lintRuleRegistry } from "../lint/rules/index";
import { runLint } from "../lint/run-lint";
import { readProjectConfigReadOnly } from "../project";
import type { DesignSystemRecord } from "../utils/design-system-store";

/** `GET` and `PUT .../lint/config`: the stored `lint.json` and the catalogue. */
export type SystemLintConfigResponse = {
	systemId: string;
	systemName: string;
	/** Project-relative path of the file, `/` separators. */
	path: string;
	/** Whether `lint.json` exists. */
	present: boolean;
	/** Hash of the file text; null when absent. Send it back on `PUT`. */
	revision: string | null;
	/** The stored config, or `{ version: 1 }` when absent or invalid. */
	config: LintConfig;
	/** Why the stored file is invalid; empty when it is valid or absent. */
	issues: string[];
	/** The file text when it is invalid, so nothing in it is lost from view. */
	text: string | null;
	/** What an absent key means, for placeholders. */
	defaults: {
		source: { include: string[]; exclude: string[]; classCalls: string[] };
	};
	ruleKinds: LintRuleKindSummary[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readCodegenOutDir = async (projectRoot: string) => {
	try {
		const { config } = await readProjectConfigReadOnly(projectRoot);
		const codegen = resolveCodegenConfig(config);
		return codegen.status === "configured" ? codegen.outDir : null;
	} catch {
		return null;
	}
};

/**
 * The lint report of a system for the dashboard:
 * `GET /api/trickroom/systems/:systemName/lint` returns the stored report
 * (404 `LINT_REPORT_NOT_FOUND` when none was written yet, 409
 * `LINT_REPORT_INVALID` when it cannot be read) with the hash of the
 * system's current contract, so the dashboard can flag a stale report, and
 * `POST` runs the engine on demand, writes the report whatever the outcome
 * (the ratchet baseline inside it is kept when the run fails) and returns
 * the run. `GET .../lint/config` returns `lint.json` (or the defaults, with
 * `present: false`) and the rule kind catalogue; `PUT` validates a config
 * with the engine's issues and writes it with `serializeLintConfig`.
 */
export const registerSystemLintRoutes = (
	systemsRoutes: Hono,
	getProjectRoot: (c: Context) => string,
	getRouteSystem: (c: Context) => {
		system: Pick<DesignSystemRecord, "dir" | "manifest">;
		systemId: string;
		systemName: string;
	},
) => {
	const configResponse = async (
		projectRoot: string,
		route: ReturnType<typeof getRouteSystem>,
		read: LintConfigFileRead,
	): Promise<SystemLintConfigResponse> => ({
		systemId: route.systemId,
		systemName: route.systemName,
		path: path.relative(projectRoot, read.path).split(path.sep).join("/"),
		present: read.status !== "absent",
		revision: read.revision,
		config:
			read.status === "present"
				? read.config
				: { version: LINT_CONFIG_VERSIONS[0] },
		issues: read.status === "invalid" ? read.issues : [],
		text: read.status === "invalid" ? read.text : null,
		defaults: {
			source: {
				include: defaultSourceInclude(await readCodegenOutDir(projectRoot)),
				exclude: [...DEFAULT_SOURCE_EXCLUDE],
				classCalls: [...DEFAULT_CLASS_CALLS],
			},
		},
		ruleKinds: describeLintRuleKinds(lintRuleRegistry),
	});

	systemsRoutes.get("/:systemName/lint", async (c) => {
		const projectRoot = getProjectRoot(c);
		const { system, systemId, systemName } = getRouteSystem(c);
		const read = await readLintReport(system.dir);
		if (read.status === "absent") {
			// A real 404 for the dev server's SPA fallback too (plugin/spa-server),
			// so the dashboard can tell "no report yet" from a broken response.
			c.header("spa-server", "false");
			return c.json(
				{
					error: `No lint report for design system "${systemName}" yet. Run lint to create one.`,
					code: "LINT_REPORT_NOT_FOUND",
				},
				404,
			);
		}
		if (read.status === "invalid") {
			return c.json(
				{ error: read.issue.message, code: "LINT_REPORT_INVALID" },
				409,
			);
		}
		return c.json({
			systemId,
			systemName,
			report: read.report,
			current: {
				contractHash: await readCurrentContractHash(projectRoot, system),
			},
		});
	});

	systemsRoutes.get("/:systemName/lint/config", async (c) => {
		const projectRoot = getProjectRoot(c);
		const route = getRouteSystem(c);
		const read = await readLintConfigFile(
			route.system.dir,
			lintRuleRegistry.ids,
		);
		return c.json(await configResponse(projectRoot, route, read));
	});

	systemsRoutes.put("/:systemName/lint/config", async (c) => {
		const projectRoot = getProjectRoot(c);
		const route = getRouteSystem(c);
		const body: unknown = await c.req.json().catch(() => null);
		if (!isRecord(body) || !("config" in body)) {
			return c.json(
				{
					error: "Expected a JSON body { config, revision? }.",
					code: "LINT_CONFIG_INVALID",
					issues: ["The request body must be an object with a config."],
				},
				400,
			);
		}
		const issues = getLintConfigIssues(body.config, lintRuleRegistry.ids);
		if (issues.length > 0) {
			return c.json(
				{
					error: `lint.json is invalid: ${issues.join(" ")}`,
					code: "LINT_CONFIG_INVALID",
					issues,
				},
				422,
			);
		}
		const current = await readLintConfigFile(route.system.dir, null);
		if (
			"revision" in body &&
			(body.revision ?? null) !== (current.revision ?? null)
		) {
			return c.json(
				{
					error:
						"lint.json changed on disk since it was loaded. Reload it and apply your edits again.",
					code: "LINT_CONFIG_CONFLICT",
				},
				409,
			);
		}
		try {
			await writeLintConfigFile(
				projectRoot,
				route.system.dir,
				body.config as LintConfig,
			);
		} catch (error) {
			if (error instanceof LintConfigWriteError) {
				return c.json(
					{ error: error.message, code: "LINT_CONFIG_WRITE_FAILED" },
					500,
				);
			}
			throw error;
		}
		const read = await readLintConfigFile(
			route.system.dir,
			lintRuleRegistry.ids,
		);
		return c.json(await configResponse(projectRoot, route, read));
	});

	systemsRoutes.post("/:systemName/lint", async (c) => {
		const projectRoot = getProjectRoot(c);
		const { systemId, systemName } = getRouteSystem(c);
		const result = await runLint({
			projectRoot,
			system: systemId,
			write: "always",
		});
		if (result.status === "error" || !result.report || !result.ratchet) {
			return c.json(
				{
					error:
						result.diagnostics
							.filter((diagnostic) => diagnostic.severity === "error")
							.map((diagnostic) => diagnostic.message)
							.join(" ") || "Lint did not complete.",
					code: "LINT_FAILED",
					diagnostics: result.diagnostics,
				},
				500,
			);
		}
		return c.json({
			systemId,
			systemName,
			status: result.status,
			report: result.report,
			ratchet: result.ratchet,
			written: result.written,
			diagnostics: result.diagnostics,
		});
	});
};
