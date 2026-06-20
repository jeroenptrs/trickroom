import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { resolveTailwindCssPath } from "./tailwind-design-system.ts";

const require = createRequire(import.meta.url);

export class FontStylesheetResolutionError extends Error {
	readonly code: "UNSUPPORTED_IMPORT" | "RESOLVE_FAILED";

	constructor(code: FontStylesheetResolutionError["code"], message: string) {
		super(message);
		this.name = "FontStylesheetResolutionError";
		this.code = code;
	}
}

export function isFontsourceStylesheetImport(specifier: string): boolean {
	return specifier.startsWith("@fontsource/");
}

export function isExplicitFontsourceCssImport(specifier: string): boolean {
	return (
		isFontsourceStylesheetImport(specifier) &&
		specifier.endsWith(".css") &&
		!specifier.endsWith("/")
	);
}

export function resolveStylesheetImport(
	importSpecifier: string,
	stylesheetBase: string,
): string {
	const trimmed = importSpecifier.trim();
	if (trimmed.length === 0) {
		throw new FontStylesheetResolutionError(
			"RESOLVE_FAILED",
			"Stylesheet import specifier must be non-empty.",
		);
	}

	if (isFileImport(trimmed)) {
		return path.resolve(stylesheetBase, trimmed);
	}

	try {
		return require.resolve(trimmed, { paths: [stylesheetBase] });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new FontStylesheetResolutionError(
			"RESOLVE_FAILED",
			`Could not resolve stylesheet import "${trimmed}" from "${stylesheetBase}": ${message}`,
		);
	}
}

export async function readResolvedStylesheet(
	importSpecifier: string,
	stylesheetBase: string,
): Promise<{ absolutePath: string; content: string }> {
	const absolutePath = resolveStylesheetImport(importSpecifier, stylesheetBase);
	const content = await readFile(absolutePath, "utf8");
	return { absolutePath, content };
}

export async function readSystemStylesheetCss(
	projectRoot: string,
	cssPath: string,
): Promise<{ absolutePath: string; content: string }> {
	const absolutePath = resolveTailwindCssPath(projectRoot, cssPath);
	const content = await readFile(absolutePath, "utf8");
	return { absolutePath, content };
}

function isFileImport(id: string) {
	return id.startsWith(".") || id.startsWith("/");
}
