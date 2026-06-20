/**
 * Human-readable export filenames: `<project> — <design> — <board> — <epoch>.html`
 * for a single board, `<project> — <design> — <epoch>.zip` for a group. Epoch is
 * unix seconds. No IDs — names only.
 */

// Characters illegal in filenames across macOS/Windows. Spaces and hyphens are
// preserved so names stay human-readable.
const UNSAFE = /[\\/:*?"<>|]/g;

export function sanitizeFilenameSegment(name: string): string {
	const cleaned = name.replace(UNSAFE, "-").replace(/\s+/g, " ").trim();
	return cleaned.length > 0 ? cleaned : "untitled";
}

export function makeHtmlFilename(
	project: string,
	design: string,
	board: string,
	epoch: number,
): string {
	return `${sanitizeFilenameSegment(project)} — ${sanitizeFilenameSegment(design)} — ${sanitizeFilenameSegment(board)} — ${epoch}.html`;
}

export function makeZipFilename(
	project: string,
	design: string,
	epoch: number,
): string {
	return `${sanitizeFilenameSegment(project)} — ${sanitizeFilenameSegment(design)} — ${epoch}.zip`;
}

/**
 * RFC 6266 Content-Disposition with both an ASCII fallback and a UTF-8 form so
 * the em-dashes survive the download.
 */
export function contentDispositionAttachment(filename: string): string {
	const asciiFallback = filename.replace(/[^ -~]/g, "_").replace(/"/g, "'");
	return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Ensure unique names within a zip by suffixing ` (2)`, ` (3)`, … on collision. */
export function dedupeFilename(filename: string, taken: Set<string>): string {
	if (!taken.has(filename)) {
		taken.add(filename);
		return filename;
	}
	const dot = filename.lastIndexOf(".");
	const stem = dot === -1 ? filename : filename.slice(0, dot);
	const ext = dot === -1 ? "" : filename.slice(dot);
	let index = 2;
	let candidate = `${stem} (${index})${ext}`;
	while (taken.has(candidate)) {
		index += 1;
		candidate = `${stem} (${index})${ext}`;
	}
	taken.add(candidate);
	return candidate;
}
