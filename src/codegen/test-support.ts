import {
	mkdir,
	mkdtemp,
	readdir,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RecipeTemplateNode, TrickroomCodegenConfig } from "../types";
import { serializeSystemComponentManifest } from "../utils/system-component-manifest-service";
import {
	createEmptySystemComponentManifest,
	SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	type SystemComponentDraftPayload,
	type SystemComponentRecord,
} from "../utils/system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "../utils/system-components-validation";

/** Temp projects with one system and its components, for codegen tests. */

export const CODEGEN_TEST_SYSTEM_ID =
	"sys_00000000-0000-4000-8000-000000000001";

let componentCounter = 0;

export const templateNode = (
	nodePath: string,
	className?: string,
	children?: RecipeTemplateNode[],
): RecipeTemplateNode => ({
	path: nodePath,
	library: "trickroom",
	component: "container",
	...(className === undefined ? {} : { className }),
	...(children === undefined ? {} : { children }),
});

export const flatPayload = (
	className: string,
): SystemComponentDraftPayload => ({
	root: templateNode("root", className),
	slots: {},
	variants: { axes: {}, compoundVariants: [] },
	overrideTargets: {},
});

export const publishedComponent = (
	slug: string,
	payload: SystemComponentDraftPayload,
	options: {
		version?: string;
		draft?: SystemComponentDraftPayload;
		componentId?: string;
	} = {},
): SystemComponentRecord => {
	componentCounter += 1;
	const version = options.version ?? "1";
	return {
		componentId:
			options.componentId ??
			`cmp_${String(componentCounter).padStart(8, "0")}-0000-4000-8000-000000000000`,
		slug,
		name: slug,
		createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
		updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
		...(options.draft ? { draft: options.draft } : {}),
		published: {
			currentVersion: version,
			versions: {
				[version]: {
					...payload,
					version,
					publishedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
					templateHash: hashSystemComponentTemplate(payload),
					variantSchemaHash: hashSystemComponentVariantSchema(payload.variants),
				},
			},
		},
	};
};

export type CodegenTestProject = {
	root: string;
	path: (...segments: string[]) => string;
	writeComponents: (records: SystemComponentRecord[]) => Promise<void>;
	writeCodegen: (codegen: TrickroomCodegenConfig | undefined) => Promise<void>;
	/** mtime (ns) of every file and folder under the project, by relative path. */
	snapshotMtimes: () => Promise<Record<string, bigint>>;
	cleanup: () => Promise<void>;
};

export async function createCodegenTestProject(
	options: {
		codegen?: TrickroomCodegenConfig;
		components?: SystemComponentRecord[];
		parent?: string;
	} = {},
): Promise<CodegenTestProject> {
	const root = await realpath(
		await mkdtemp(
			path.join(options.parent ?? os.tmpdir(), "trickroom-codegen-"),
		),
	);
	const projectPath = (...segments: string[]) => path.join(root, ...segments);
	const systemDir = projectPath(".trickroom", "systems", "core");
	await mkdir(systemDir, { recursive: true });
	await writeFile(
		path.join(systemDir, "system.json"),
		`${JSON.stringify({ version: 1, systemId: CODEGEN_TEST_SYSTEM_ID, systemName: "Core" }, null, "\t")}\n`,
	);

	const writeCodegen = async (codegen: TrickroomCodegenConfig | undefined) => {
		await writeFile(
			projectPath(".trickroom", "config.json"),
			`${JSON.stringify(
				{
					schemaVersion: 1,
					projectId: "proj_codegen_test",
					name: "Codegen Test",
					defaultSystemId: CODEGEN_TEST_SYSTEM_ID,
					...(codegen ? { codegen } : {}),
				},
				null,
				"\t",
			)}\n`,
		);
	};
	const writeComponents = async (records: SystemComponentRecord[]) => {
		await writeFile(
			path.join(systemDir, "components.json"),
			serializeSystemComponentManifest({
				...createEmptySystemComponentManifest(),
				components: Object.fromEntries(
					records.map((record) => [record.componentId, record]),
				),
			}),
		);
	};

	const snapshotMtimes = async () => {
		const mtimes: Record<string, bigint> = {};
		const walk = async (dir: string) => {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				mtimes[path.relative(root, full)] = (
					await stat(full, { bigint: true })
				).mtimeNs;
				if (entry.isDirectory()) {
					await walk(full);
				}
			}
		};
		mtimes["."] = (await stat(root, { bigint: true })).mtimeNs;
		await walk(root);
		return mtimes;
	};

	await writeCodegen(options.codegen);
	await writeComponents(options.components ?? []);
	return {
		root,
		path: projectPath,
		writeComponents,
		writeCodegen,
		snapshotMtimes,
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}
