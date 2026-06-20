import { randomUUID } from "node:crypto";
import { link, readFile, rename, unlink, writeFile } from "node:fs/promises";

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
	const contents = await readFile(filePath, "utf8");
	return JSON.parse(contents) as T;
};

export const writeJsonFileAtomically = async (
	filePath: string,
	value: unknown,
) => {
	const contents = `${JSON.stringify(value, null, "\t")}\n`;
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

	try {
		await writeFile(tempPath, contents, "utf8");
		await rename(tempPath, filePath);
		return contents;
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
};

export const writeJsonFileExclusivelyAtomically = async (
	filePath: string,
	value: unknown,
) => {
	const contents = `${JSON.stringify(value, null, "\t")}\n`;
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

	try {
		await writeFile(tempPath, contents, "utf8");
		await link(tempPath, filePath);
		await unlink(tempPath).catch(() => undefined);
		return contents;
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
};
