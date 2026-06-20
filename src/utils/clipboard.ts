import { getTrickroomDesktopApi } from "../desktop-api";

/** Writes text to the clipboard, preferring the Electron clipboard when available. */
export async function writeClipboardText(value: string) {
	const desktopApi = getTrickroomDesktopApi();
	if (desktopApi?.clipboard) {
		await desktopApi.clipboard.writeText(value);
		return;
	}

	await navigator.clipboard.writeText(value);
}
