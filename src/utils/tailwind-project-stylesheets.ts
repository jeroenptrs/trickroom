import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
	normalizeCssSource,
	parseStylesheet,
	serializeNormalized,
} from "./css-source";
import type { TailwindDesignSystem } from "./tailwind-design-system";
import type { LoadedStylesheet } from "./tailwind-design-system-loader";
import type { LoadedTailwindModule } from "./tailwind-module-loader";
import {
	resolveTailwindTokenDomain,
	type TailwindTokenDomain,
} from "./tailwind-token-domains";
import type {
	TailwindAuthoredDomainDefinition,
	TailwindAuthoredTokens,
	TailwindStylesheetFingerprint,
} from "./tailwind-token-store";

/** A stylesheet the project owns, with its real path relative to the project. */
export type ProjectStylesheet = LoadedStylesheet & { relativePath: string };

function realPath(filePath: string): string {
	try {
		return realpathSync(filePath);
	} catch {
		return path.resolve(filePath);
	}
}

/**
 * Whether the project owns a stylesheet: its real path is inside the project
 * root and not under any `node_modules` (Tailwind and every other
 * third-party package). Symlinks are resolved first, so a workspace package
 * linked into `node_modules` counts by its source folder.
 */
export function createProjectStylesheetFilter(projectRoot: string) {
	const root = realPath(projectRoot);
	const cache = new Map<string, string | null>();
	return (filePath: string): string | null => {
		const cached = cache.get(filePath);
		if (cached !== undefined) {
			return cached;
		}
		const real = realPath(filePath);
		const relative = path.relative(root, real);
		const owned =
			relative.length > 0 &&
			!relative.startsWith("..") &&
			!path.isAbsolute(relative) &&
			!relative.split(path.sep).includes("node_modules")
				? relative.split(path.sep).join("/")
				: null;
		cache.set(filePath, owned);
		return owned;
	};
}

/** The project's own stylesheets among the loaded ones, in inlining order. */
export function selectProjectStylesheets(
	projectRoot: string,
	stylesheets: readonly LoadedStylesheet[],
): ProjectStylesheet[] {
	const projectPath = createProjectStylesheetFilter(projectRoot);
	return stylesheets.flatMap((stylesheet) => {
		const relativePath = projectPath(stylesheet.path);
		return relativePath === null ? [] : [{ ...stylesheet, relativePath }];
	});
}

/** A `@plugin` or `@config` file the project owns. */
export type ProjectModuleFile = {
	path: string;
	relativePath: string;
	content: string;
};

/**
 * The project's own `@plugin` and `@config` files: each module and the
 * files it imports by relative path, owned as stylesheets are (inside the
 * project, not under any `node_modules`), by path (Tailwind loads modules
 * in parallel, so load order is no order), each once. A file that can no
 * longer be read is left out.
 */
export function selectProjectModuleFiles(
	projectRoot: string,
	modules: readonly LoadedTailwindModule[],
): ProjectModuleFile[] {
	const projectPath = createProjectStylesheetFilter(projectRoot);
	const seen = new Set<string>();
	const files: ProjectModuleFile[] = [];
	for (const module of modules) {
		for (const filePath of module.files) {
			const relativePath = projectPath(filePath);
			if (relativePath === null || seen.has(relativePath)) continue;
			seen.add(relativePath);
			try {
				files.push({
					path: filePath,
					relativePath,
					content: readFileSync(filePath, "utf8"),
				});
			} catch {
				// Removed since the load; the next sync sees it gone.
			}
		}
	}
	return files.sort((left, right) =>
		left.relativePath.localeCompare(right.relativePath),
	);
}

/**
 * Each project stylesheet's path and the hash of its text, comments and
 * whitespace outside strings normalized away, in inlining order, then each
 * project `@plugin`/`@config` file's path and the hash of its text as is.
 */
export function fingerprintStylesheets(
	stylesheets: readonly ProjectStylesheet[],
	moduleFiles: readonly ProjectModuleFile[] = [],
): TailwindStylesheetFingerprint {
	return {
		files: [
			...stylesheets.map((stylesheet) => ({
				path: stylesheet.relativePath,
				hash: createHash("sha256")
					.update(normalizeCssSource(stylesheet.content))
					.digest("hex"),
			})),
			...moduleFiles.map((file) => ({
				path: file.relativePath,
				hash: createHash("sha256").update(file.content).digest("hex"),
			})),
		],
	};
}

// Tailwind's `ThemeOptions` bits, by name (`USED` is runtime state).
const THEME_OPTION_NAMES = [
	[1 << 0, "inline"],
	[1 << 1, "reference"],
	[1 << 2, "default"],
	[1 << 3, "static"],
] as const;
const THEME_OPTION_DEFAULT = 1 << 2;
// How Tailwind adds the theme of a `@config` file or a plugin's config:
// inline, reference and default, without a source.
const THEME_OPTIONS_FROM_CONFIG = (1 << 0) | (1 << 1) | (1 << 2);

function themeOptionNames(options: number): string[] {
	return THEME_OPTION_NAMES.filter(([bit]) => (options & bit) !== 0).map(
		([, name]) => name,
	);
}

const TAILWIND_PACKAGE_SEGMENT = `${path.sep}node_modules${path.sep}tailwindcss${path.sep}`;

/** Whether a stylesheet is one of Tailwind's own (its real path). */
function isTailwindStylesheet(filePath: string): boolean {
	return realPath(filePath).includes(TAILWIND_PACKAGE_SEGMENT);
}

/**
 * The theme the design system's stylesheets define, Tailwind's own left
 * out: every theme entry whose source is not one of Tailwind's stylesheets
 * (so the project's files, its packages and anything it imports from
 * outside the project count, and a project's `@theme default` too), with
 * its value as written and its `@theme` options, and the `initial` resets
 * in those stylesheets' `@theme` blocks, and the token-domain values a
 * `@config` file (or a plugin's config) adds to the theme. Other entries
 * without a source fall back to "not from `@theme default`". Variables
 * outside the fixed domains go to `other`. None of it depends on
 * Tailwind's defaults.
 */
export function extractAuthoredTheme({
	designSystem,
	stylesheets,
}: {
	designSystem: TailwindDesignSystem;
	stylesheets: readonly LoadedStylesheet[];
}): TailwindAuthoredTokens {
	const tailwindStylesheet = new Map<string, boolean>();
	const isTailwind = (filePath: string) => {
		let result = tailwindStylesheet.get(filePath);
		if (result === undefined) {
			result = isTailwindStylesheet(filePath);
			tailwindStylesheet.set(filePath, result);
		}
		return result;
	};
	const domains: Partial<
		Record<TailwindTokenDomain, TailwindAuthoredDomainDefinition>
	> = {};
	const other: TailwindAuthoredDomainDefinition = { tokens: {}, resets: [] };
	const bucketFor = (propertyName: string) => {
		const match = resolveTailwindTokenDomain(propertyName);
		if (!match) {
			return { bucket: other, name: propertyName };
		}
		domains[match.domain] ??= { tokens: {}, resets: [] };
		return {
			bucket: domains[match.domain] as TailwindAuthoredDomainDefinition,
			name: match.name,
		};
	};

	for (const [propertyName, token] of designSystem.theme.entries()) {
		const sourceFile = (token.src?.[0] as { file?: string } | undefined)?.file;
		// A `@config` (or a plugin's config) theme value in a token domain
		// is one the project defines, a third-party preset's included; the
		// rest of what plugins add (typography's `--typography-*`) is not.
		const fromConfig =
			!sourceFile &&
			token.options === THEME_OPTIONS_FROM_CONFIG &&
			resolveTailwindTokenDomain(propertyName) !== null;
		const authored = sourceFile
			? !isTailwind(sourceFile)
			: fromConfig || (token.options & THEME_OPTION_DEFAULT) === 0;
		if (!authored) {
			continue;
		}
		const { bucket, name } = bucketFor(propertyName);
		bucket.tokens[name] = token.value;
		// Not written in a `@theme` block, so no `@theme` options to show.
		if (fromConfig) {
			continue;
		}
		const options = themeOptionNames(token.options);
		if (options.length > 0) {
			bucket.options ??= {};
			bucket.options[name] = options;
		}
	}

	for (const stylesheet of stylesheets) {
		if (isTailwind(stylesheet.path)) {
			continue;
		}
		parseStylesheet(stylesheet.content)?.walkAtRules("theme", (theme) => {
			for (const node of theme.nodes ?? []) {
				if (
					node.type === "decl" &&
					node.prop.startsWith("--") &&
					node.value.trim().toLowerCase() === "initial"
				) {
					const { bucket } = bucketFor(
						node.prop.endsWith("-*") ? node.prop.slice(0, -2) : node.prop,
					);
					bucket.resets.push(node.prop);
				}
			}
		});
	}

	return { domains, other };
}

/**
 * Each custom `@utility` root's definition: its blocks in the order
 * Tailwind sees them (later blocks win), each normalized (comments and
 * whitespace outside strings), across every loaded stylesheet.
 */
export function extractCustomUtilityDefinitions(
	stylesheets: readonly LoadedStylesheet[],
): Map<string, string> {
	const blocksByRoot = new Map<string, string[]>();
	for (const stylesheet of stylesheets) {
		parseStylesheet(stylesheet.content)?.walkAtRules("utility", (utility) => {
			const name = utility.params.trim();
			const root = name.endsWith("-*") ? name.slice(0, -2) : name;
			const blocks = blocksByRoot.get(root) ?? [];
			blocks.push(serializeNormalized(utility));
			blocksByRoot.set(root, blocks);
		});
	}
	return new Map(
		[...blocksByRoot].map(([root, blocks]) => [root, blocks.join("\n")]),
	);
}
