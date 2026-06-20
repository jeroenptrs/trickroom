/**
 * Resolve and rewrite font `url(...)` references inside compiled CSS.
 *
 * A system's CSS can declare `@font-face { src: url(./fonts/x.woff2) }` whose
 * path is relative to the file that declared it. Tailwind's compile inlines
 * `@import`s without rebasing `url()`s, so the compiled output carries those
 * relative paths — which 404 both in a standalone export (no server) and in the
 * editor iframe (resolved against the wrong base). This module resolves each
 * font `url()` to a real file on disk, then either:
 *   - `inlineCssFontUrls` → replaces it with a `data:` URI (standalone export), or
 *   - `rewriteCssFontUrls` → replaces it with a served URL (editor iframe).
 *
 * Remote (`http(s):`, `//`) and `data:` URLs are left untouched; only font
 * files inside the project root are considered.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const FONT_FILE_MIME: Record<string, string> = {
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".eot": "application/vnd.ms-fontobject",
};

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

const FONT_SEARCH_SKIP = new Set([
	"node_modules",
	".git",
	".trickroom",
	".next",
	"dist",
	"build",
	"out",
	"coverage",
]);

function isExternalUrl(value: string): boolean {
	return /^(?:data:|https?:|\/\/)/i.test(value);
}

function isInsideRoot(root: string, target: string): boolean {
	return target === root || target.startsWith(`${root}${path.sep}`);
}

async function isFile(target: string): Promise<boolean> {
	try {
		return (await stat(target)).isFile();
	} catch {
		return false;
	}
}

/** Bound the font search to the top-level project dir that holds the system CSS. */
function fontSearchRoot(root: string, cssDir: string): string {
	const rel = path.relative(root, cssDir);
	const first = rel.split(path.sep)[0];
	return first && first !== ".." && first !== ""
		? path.join(root, first)
		: root;
}

async function collectFontFiles(dir: string, into: string[]): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
	if (entries === null) {
		return;
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (FONT_SEARCH_SKIP.has(entry.name) || entry.name.startsWith(".")) {
				continue;
			}
			await collectFontFiles(path.join(dir, entry.name), into);
		} else if (FONT_FILE_MIME[path.extname(entry.name).toLowerCase()]) {
			into.push(path.join(dir, entry.name));
		}
	}
}

// Short-lived cache so rapid editor /compile calls don't re-walk the tree, while
// a newly added font still shows up within a few seconds.
const FONT_INDEX_TTL_MS = 5_000;
const fontIndexCache = new Map<string, { files: string[]; expires: number }>();

async function getFontIndex(searchRoot: string): Promise<string[]> {
	const now = Date.now();
	const cached = fontIndexCache.get(searchRoot);
	if (cached && cached.expires > now) {
		return cached.files;
	}
	const files: string[] = [];
	await collectFontFiles(searchRoot, files);
	fontIndexCache.set(searchRoot, { files, expires: now + FONT_INDEX_TTL_MS });
	return files;
}

function toPosixLower(value: string): string {
	return value.split(path.sep).join("/").toLowerCase();
}

/** Match a font file by its url path tail (e.g. `geist-sans/Geist-Variable.woff2`). */
function matchFontFile(
	files: readonly string[],
	filePath: string,
): string | null {
	const tail = toPosixLower(filePath.replace(/^(?:\.\.?\/)+/, ""));
	const bySuffix = files.find((file) => {
		const norm = toPosixLower(file);
		return norm === tail || norm.endsWith(`/${tail}`);
	});
	if (bySuffix) {
		return bySuffix;
	}
	const base = tail.slice(tail.lastIndexOf("/") + 1);
	const byBasename = files.filter(
		(file) => path.basename(file).toLowerCase() === base,
	);
	return byBasename.length === 1 ? byBasename[0] : null;
}

/**
 * Map each local font `url(...)` in the CSS to its absolute file path. Tries the
 * CSS file's own directory first, then searches the system CSS's top-level
 * project dir (covers `@font-face` pulled in from `@import`-ed files elsewhere).
 */
async function resolveCssFontFiles(
	css: string,
	cssDir: string,
	projectRoot: string,
): Promise<Map<string, string>> {
	const root = path.resolve(projectRoot);
	const candidates = new Map<string, string>();

	CSS_URL.lastIndex = 0;
	for (let m = CSS_URL.exec(css); m !== null; m = CSS_URL.exec(css)) {
		const raw = m[2].trim();
		if (candidates.has(raw) || isExternalUrl(raw)) {
			continue;
		}
		const filePath = raw.split(/[?#]/)[0];
		if (FONT_FILE_MIME[path.extname(filePath).toLowerCase()]) {
			candidates.set(raw, filePath);
		}
	}

	const resolved = new Map<string, string>();
	if (candidates.size === 0) {
		return resolved;
	}

	let index: string[] | null = null;
	for (const [raw, filePath] of candidates) {
		const direct = path.resolve(cssDir, filePath);
		let abs =
			isInsideRoot(root, direct) && (await isFile(direct)) ? direct : null;
		if (!abs) {
			index ??= await getFontIndex(fontSearchRoot(root, cssDir));
			const found = matchFontFile(index, filePath);
			abs = found && isInsideRoot(root, found) ? found : null;
		}
		if (abs) {
			resolved.set(raw, abs);
		}
	}
	return resolved;
}

function replaceFontUrls(css: string, byRaw: Map<string, string>): string {
	if (byRaw.size === 0) {
		return css;
	}
	return css.replace(CSS_URL, (full, _quote, urlArg) => {
		const replacement = byRaw.get(urlArg.trim());
		return replacement ? `url("${replacement}")` : full;
	});
}

/**
 * Replace local font `url(...)`s with inlined `data:` URIs — for self-contained
 * exports that have no server to resolve relative paths.
 */
export async function inlineCssFontUrls(
	css: string,
	cssDir: string,
	projectRoot: string,
): Promise<string> {
	const resolved = await resolveCssFontFiles(css, cssDir, projectRoot);
	const dataUris = new Map<string, string>();
	await Promise.all(
		[...resolved].map(async ([raw, abs]) => {
			const mime = FONT_FILE_MIME[path.extname(abs).toLowerCase()];
			if (!mime) {
				return;
			}
			try {
				const bytes = await readFile(abs);
				dataUris.set(raw, `data:${mime};base64,${bytes.toString("base64")}`);
			} catch {
				// Leave the original url() in place if the file can't be read.
			}
		}),
	);
	return replaceFontUrls(css, dataUris);
}

/**
 * Replace local font `url(...)`s with a served URL built from each file's
 * project-relative path — for the editor iframe, which can fetch from the app
 * server but not from relative font paths.
 */
export async function rewriteCssFontUrls(
	css: string,
	cssDir: string,
	projectRoot: string,
	toServedUrl: (projectRelativePath: string) => string,
): Promise<string> {
	const root = path.resolve(projectRoot);
	const resolved = await resolveCssFontFiles(css, cssDir, projectRoot);
	const urls = new Map<string, string>();
	for (const [raw, abs] of resolved) {
		const rel = path.relative(root, abs).split(path.sep).join("/");
		urls.set(raw, toServedUrl(rel));
	}
	return replaceFontUrls(css, urls);
}
