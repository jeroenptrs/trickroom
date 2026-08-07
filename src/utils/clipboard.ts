export async function writeClipboardText(value: string) {
	await navigator.clipboard.writeText(value);
}
