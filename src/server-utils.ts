import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { availableRegistries, getLibraryComponent } from "./libraries/registry";
import type { Node, Props, TrickroomConfig, TrickroomDesign } from "./types";

export type ErrorResponse = {
	error: string;
};

export const asErrnoException = (error: unknown) =>
	error as NodeJS.ErrnoException;

export const jsonError = (error: string, status: number) => {
	return Response.json({ error } satisfies ErrorResponse, { status });
};

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

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isTrickroomSystems = (
	value: unknown,
): value is TrickroomConfig["systems"] =>
	isRecord(value) &&
	Object.entries(value).every(
		([name, cssPath]) =>
			name.trim().length > 0 &&
			typeof cssPath === "string" &&
			cssPath.trim().length > 0,
	);

const isTrickroomMcpConfig = (
	value: unknown,
): value is NonNullable<TrickroomConfig["mcp"]> =>
	isRecord(value) && typeof value.enabled === "boolean";

export const isTrickroomConfig = (value: unknown): value is TrickroomConfig =>
	isRecord(value) &&
	typeof value.name === "string" &&
	value.name.trim().length > 0 &&
	!("tailwindRoot" in value) &&
	(value.systems === undefined || isTrickroomSystems(value.systems)) &&
	(value.mcp === undefined || isTrickroomMcpConfig(value.mcp));

export const isTrickroomLibrary = (
	value: unknown,
): value is Props["data-trickroom-library"] =>
	availableRegistries.includes(value as string);

// TODO: improve these handlers so they're a bit more typesafe
const isTrickroomComponent = (
	value: unknown,
): value is Props["data-trickroom-component"] =>
	value === "container" || value === "text";

const isTrickroomRole = (
	value: unknown,
): value is Props["data-trickroom-role"] | undefined =>
	value === undefined || value === "text";

const isProps = (value: unknown): value is Props => {
	if (!isRecord(value)) {
		return false;
	}

	// TODO: this can be deleted
	if ("data-trickroom-type" in value) {
		return false;
	}

	const library = value["data-trickroom-library"];
	const component = value["data-trickroom-component"];
	const role = value["data-trickroom-role"];
	if (
		!isTrickroomLibrary(library) ||
		!isTrickroomComponent(component) ||
		!isTrickroomRole(role)
	) {
		return false;
	}

	const registeredComponent = getLibraryComponent(library, component);
	return (
		typeof value["data-trickroom-name"] === "string" &&
		role === registeredComponent.role &&
		(value.className === undefined || typeof value.className === "string")
	);
};

const isSerializedElement = (value: unknown): value is Node => {
	if (!isRecord(value) || typeof value.id !== "string" || "type" in value) {
		return false;
	}

	if (!isProps(value.props)) {
		return false;
	}

	if (value.props["data-trickroom-role"] === "text") {
		return typeof value.children === "string";
	}

	return (
		Array.isArray(value.children) && value.children.every(isSerializedElement)
	);
};

const isDesignSystemName = (
	value: unknown,
): value is TrickroomDesign["systemName"] =>
	value === undefined ||
	value === null ||
	(typeof value === "string" && value.trim().length > 0);

export const isTrickroomDesign = (value: unknown): value is TrickroomDesign =>
	isRecord(value) &&
	typeof value.name === "string" &&
	isDesignSystemName(value.systemName) &&
	Array.isArray(value.boards) &&
	value.boards.every(isSerializedElement);
