import { isJsonPrimitive } from "./libraries/registry";
import type {
	Node,
	Props,
	Role,
	TrickroomConfig,
	TrickroomDesign,
} from "./types";

export type ErrorResponse = {
	error: string;
};

export const asErrnoException = (error: unknown) =>
	error as NodeJS.ErrnoException;

export const jsonError = (error: string, status: number) => {
	return Response.json({ error } satisfies ErrorResponse, { status });
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
	isRecord(value) &&
	typeof value.enabled === "boolean" &&
	(value.mode === undefined ||
		value.mode === "read-only" ||
		value.mode === "read-write") &&
	(value.allowedDesignFileIds === undefined ||
		(Array.isArray(value.allowedDesignFileIds) &&
			value.allowedDesignFileIds.every(
				(designFileId) =>
					typeof designFileId === "string" && designFileId.trim().length > 0,
			))) &&
	(value.allowedComponents === undefined ||
		(Array.isArray(value.allowedComponents) &&
			value.allowedComponents.every(
				(componentRef) =>
					typeof componentRef === "string" && componentRef.trim().length > 0,
			))) &&
	(value.auditLog === undefined || typeof value.auditLog === "boolean");

export const isTrickroomConfig = (value: unknown): value is TrickroomConfig =>
	isRecord(value) &&
	(value.schemaVersion === undefined || value.schemaVersion === 1) &&
	(value.projectId === undefined ||
		(typeof value.projectId === "string" &&
			value.projectId.trim().length > 0)) &&
	typeof value.name === "string" &&
	value.name.trim().length > 0 &&
	!("tailwindRoot" in value) &&
	(value.systems === undefined || isTrickroomSystems(value.systems)) &&
	(value.mcp === undefined || isTrickroomMcpConfig(value.mcp));

const isTrickroomRole = (value: unknown): value is Role | undefined =>
	value === undefined ||
	value === "branch" ||
	value === "text" ||
	value === "leaf";

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
		typeof library !== "string" ||
		library.trim().length === 0 ||
		typeof component !== "string" ||
		component.trim().length === 0 ||
		!isTrickroomRole(role)
	) {
		return false;
	}

	return (
		typeof value["data-trickroom-name"] === "string" &&
		(value.className === undefined || typeof value.className === "string") &&
		Object.values(value).every(
			(propValue) => propValue === undefined || isJsonPrimitive(propValue),
		)
	);
};

const isSerializedElement = (value: unknown): value is Node => {
	if (!isRecord(value) || typeof value.id !== "string" || "type" in value) {
		return false;
	}

	if (!isProps(value.props)) {
		return false;
	}

	return (
		typeof value.children === "string" ||
		(Array.isArray(value.children) && value.children.every(isSerializedElement))
	);
};

const isDesignSystemName = (
	value: unknown,
): value is TrickroomDesign["systemName"] =>
	value === undefined ||
	value === null ||
	(typeof value === "string" && value.trim().length > 0);

const isDesignSystemId = (
	value: unknown,
): value is TrickroomDesign["systemId"] =>
	value === undefined ||
	value === null ||
	(typeof value === "string" &&
		/^sys_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			value.trim(),
		));

const isComponentMigrationPolicy = (
	value: unknown,
): value is TrickroomDesign["componentMigrationPolicy"] =>
	value === undefined ||
	value === "inherit" ||
	value === "manual" ||
	value === "auto";

export const isTrickroomDesign = (value: unknown): value is TrickroomDesign =>
	isRecord(value) &&
	typeof value.name === "string" &&
	isDesignSystemId(value.systemId) &&
	isDesignSystemName(value.systemName) &&
	isComponentMigrationPolicy(value.componentMigrationPolicy) &&
	Array.isArray(value.boards) &&
	value.boards.every(isSerializedElement);
