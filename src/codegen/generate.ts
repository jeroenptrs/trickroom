import type { SystemComponentManifest } from "../utils/system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "../utils/system-components-validation";
import { renderVariantsFile } from "./emit";
import {
	type CodegenHeader,
	type CodegenSource,
	hashCodegenSource,
} from "./header";
import {
	buildCodegenComponentModel,
	type CodegenComponentModel,
	type CodegenDiagnostic,
	selectCodegenComponents,
} from "./model";

export type { CodegenHeader, CodegenSource } from "./header";
export { parseCodegenHeader } from "./header";
export type {
	CodegenDiagnostic,
	CodegenDiagnosticCode,
	CodegenDiagnosticSeverity,
} from "./model";

export type CodegenShape = "auto" | "slots";

export type GeneratedVariantsFile = {
	fileName: string;
	exportName: string;
	header: CodegenHeader;
	shape: "flat" | "slots";
	contents: string;
	/** The structure `contents` was rendered from. */
	model: CodegenComponentModel;
};

export type GenerateVariantsInput = {
	manifest: SystemComponentManifest;
	systemId: string;
	source?: CodegenSource;
	shape?: CodegenShape;
	/** Output file name pattern; `{slug}` is replaced with the component slug. */
	fileName?: string;
	tvImport?: string;
	include?: readonly string[];
	exclude?: readonly string[];
};

export const DEFAULT_CODEGEN_FILE_NAME = "{slug}.variants.ts";
export const DEFAULT_CODEGEN_TV_IMPORT = "./tv";

const findDuplicates = <T>(
	files: readonly GeneratedVariantsFile[],
	key: (file: GeneratedVariantsFile) => T,
) => {
	const seen = new Map<T, GeneratedVariantsFile>();
	const duplicates: Array<[GeneratedVariantsFile, GeneratedVariantsFile]> = [];
	for (const file of files) {
		const existing = seen.get(key(file));
		if (existing) {
			duplicates.push([existing, file]);
		} else {
			seen.set(key(file), file);
		}
	}
	return duplicates;
};

/**
 * One tailwind-variants file per selected component. Any error diagnostic
 * empties `files`, so a run either generates the whole selection or nothing;
 * warnings (skipped components) leave the rest of the run intact.
 */
export function generateVariantsFiles(input: GenerateVariantsInput): {
	files: GeneratedVariantsFile[];
	diagnostics: CodegenDiagnostic[];
} {
	const source = input.source ?? "published";
	const shape = input.shape ?? "auto";
	const fileNamePattern = input.fileName ?? DEFAULT_CODEGEN_FILE_NAME;
	const tvImport = input.tvImport ?? DEFAULT_CODEGEN_TV_IMPORT;

	const { selected, diagnostics } = selectCodegenComponents({
		components: Object.values(input.manifest.components),
		source,
		include: input.include,
		exclude: input.exclude,
	});

	const files: GeneratedVariantsFile[] = [];
	for (const { record, payload, publishedVersion } of selected) {
		const built = buildCodegenComponentModel({
			record,
			payload,
			fileNamePattern,
			shape,
		});
		diagnostics.push(...built.diagnostics);
		if (!built.model) {
			continue;
		}

		const version =
			publishedVersion === null
				? undefined
				: record.published?.versions[publishedVersion];
		const header: CodegenHeader = {
			version: 1,
			systemId: input.systemId,
			componentId: record.componentId,
			slug: record.slug,
			source: publishedVersion === null ? "draft" : "published",
			publishedVersion,
			templateHash:
				version?.templateHash ?? hashSystemComponentTemplate(payload),
			variantSchemaHash:
				version?.variantSchemaHash ??
				hashSystemComponentVariantSchema(payload.variants),
			sourceHash: hashCodegenSource(payload),
		};
		files.push({
			fileName: built.model.fileName,
			exportName: built.model.exportName,
			header,
			shape: built.model.shape,
			contents: renderVariantsFile({ model: built.model, header, tvImport }),
			model: built.model,
		});
	}

	for (const [first, second] of findDuplicates(
		files,
		(file) => file.fileName,
	)) {
		diagnostics.push({
			code: "DUPLICATE_FILE_NAME",
			severity: "error",
			message: `Components "${first.header.slug}" and "${second.header.slug}" both generate "${second.fileName}". Include "{slug}" in the codegen fileName pattern.`,
			slug: second.header.slug,
			componentId: second.header.componentId,
		});
	}
	for (const [first, second] of findDuplicates(
		files,
		(file) => file.exportName,
	)) {
		diagnostics.push({
			code: "DUPLICATE_EXPORT_NAME",
			severity: "error",
			message: `Components "${first.header.slug}" and "${second.header.slug}" both export "${second.exportName}". Rename one of the slugs.`,
			slug: second.header.slug,
			componentId: second.header.componentId,
		});
	}

	const failed = diagnostics.some(
		(diagnostic) => diagnostic.severity === "error",
	);
	return { files: failed ? [] : files, diagnostics };
}
