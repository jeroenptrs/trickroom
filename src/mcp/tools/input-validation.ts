import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { type core, safeParseAsync, type ZodType } from "zod";
import { formatDidYouMean, suggestClosest } from "../../utils/suggestions";
import type { TrickroomMcpServer } from "../server-types";

/**
 * Tool input validation with errors agents can act on. The SDK parses tool
 * arguments with zod/mini, which has no error locale, so since 1.32 every
 * problem reads "Invalid input at <path>". This formats zod's raw issues
 * against the tool's own schema instead: one line per problem naming the
 * parameter, what it expected (type, enum values, accepted shapes) and what it
 * received, plus unknown parameters with the nearest valid name.
 */

type Issue = core.$ZodIssue;
type PathKey = PropertyKey;
type SchemaDef = {
	type: string;
	shape?: Record<string, ZodType>;
	catchall?: ZodType;
	innerType?: ZodType;
	in?: ZodType;
	element?: ZodType;
	valueType?: ZodType;
	options?: ZodType[];
	entries?: Record<string, string | number>;
	values?: unknown[];
	getter?: () => ZodType;
};

const MAX_ISSUE_LINES = 12;
const MAX_SHAPE_LENGTH = 160;

const defOf = (schema: ZodType | undefined): SchemaDef | undefined =>
	(schema as { _zod?: { def?: SchemaDef } } | undefined)?._zod?.def;

/** Strip wrappers that do not change what a value must look like. */
const unwrap = (
	schema: ZodType | undefined,
	depth = 0,
): ZodType | undefined => {
	const def = defOf(schema);
	if (!def || depth > 20) return schema;
	switch (def.type) {
		case "optional":
		case "nullable":
		case "default":
		case "prefault":
		case "nonoptional":
		case "readonly":
		case "catch":
			return unwrap(def.innerType, depth + 1);
		case "lazy":
			return unwrap(def.getter?.(), depth + 1);
		case "pipe":
			return unwrap(def.in, depth + 1);
		default:
			return schema;
	}
};

const isOptional = (schema: ZodType | undefined, depth = 0): boolean => {
	const def = defOf(schema);
	if (!def || depth > 20) return false;
	if (def.type === "optional" || def.type === "default") return true;
	if (def.type === "lazy") return isOptional(def.getter?.(), depth + 1);
	if (def.type === "nullable" || def.type === "readonly") {
		return isOptional(def.innerType, depth + 1);
	}
	return false;
};

const objectShape = (schema: ZodType | undefined) => {
	const def = defOf(unwrap(schema));
	return def?.type === "object" ? (def.shape ?? {}) : undefined;
};

/** Declared keys of an object schema, or of every object option of a union. */
const objectKeys = (schema: ZodType | undefined): string[] => {
	const def = defOf(unwrap(schema));
	if (def?.type === "union") {
		return [...new Set((def.options ?? []).flatMap(objectKeys))];
	}
	return Object.keys(objectShape(schema) ?? {});
};

/** Resolve the schema that validates the value at `path`, best effort. */
const schemaAtPath = (
	schema: ZodType | undefined,
	path: readonly PathKey[],
): ZodType | undefined => {
	let current = schema;
	for (const key of path) {
		const resolved = unwrap(current);
		const def = defOf(resolved);
		if (!def) return undefined;
		if (def.type === "union") {
			const option = def.options?.find(
				(candidate) => objectShape(candidate)?.[String(key)] !== undefined,
			);
			current = option ? objectShape(option)?.[String(key)] : undefined;
		} else if (def.type === "object") {
			current = def.shape?.[String(key)];
		} else if (def.type === "array") {
			current = def.element;
		} else if (def.type === "record") {
			current = def.valueType;
		} else {
			return undefined;
		}
	}
	return current;
};

const valueAtPath = (value: unknown, path: readonly PathKey[]) => {
	let current = value;
	for (const key of path) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<PropertyKey, unknown>)[key];
	}
	return current;
};

const formatPath = (path: readonly PathKey[]) =>
	path.length === 0
		? "arguments"
		: path.reduce<string>(
				(text, key, index) =>
					typeof key === "number"
						? `${text}[${key}]`
						: index === 0
							? String(key)
							: `${text}.${String(key)}`,
				"",
			);

const describeReceived = (value: unknown) => {
	if (value === undefined) return "nothing";
	if (value === null) return "null";
	if (Array.isArray(value)) {
		return `array (${value.length} item${value.length === 1 ? "" : "s"})`;
	}
	if (typeof value === "string") {
		const preview = value.length > 40 ? `${value.slice(0, 40)}…` : value;
		return `string ${JSON.stringify(preview)}`;
	}
	if (typeof value === "object") {
		const keys = Object.keys(value);
		return keys.length === 0
			? "object {}"
			: `object {${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", …" : ""}}`;
	}
	return `${typeof value} ${String(value)}`;
};

const quoteValues = (values: readonly unknown[]) =>
	values.map((value) => JSON.stringify(value)).join(" | ");

/** Compact type sketch of a schema, used to list a union's accepted shapes. */
export const describeSchemaShape = (
	schema: ZodType | undefined,
	depth = 0,
): string => {
	const outer = defOf(schema);
	if (outer?.type === "nullable" || outer?.type === "optional") {
		const inner = describeSchemaShape(outer.innerType, depth);
		return outer.type === "nullable" ? `${inner} | null` : inner;
	}
	const resolved = unwrap(schema);
	const def = defOf(resolved);
	if (!def) return "unknown";
	switch (def.type) {
		case "string":
		case "number":
		case "boolean":
		case "null":
		case "bigint":
			return def.type;
		case "int":
			return "integer";
		case "enum":
			return quoteValues(Object.values(def.entries ?? {}));
		case "literal":
			return quoteValues(def.values ?? []);
		case "array":
			return `${describeSchemaShape(def.element, depth + 1)}[]`;
		case "record":
			return `{[key]: ${describeSchemaShape(def.valueType, depth + 1)}}`;
		case "union":
			return (def.options ?? [])
				.map((option) => describeSchemaShape(option, depth + 1))
				.join(" | ");
		case "object": {
			if (depth > 1) return "object";
			const fields = Object.entries(def.shape ?? {})
				.filter(([, field]) => defOf(unwrap(field))?.type !== "never")
				.map(([key, field]) => {
					const fieldDef = defOf(unwrap(field));
					const literal =
						fieldDef?.type === "literal"
							? `: ${quoteValues(fieldDef.values ?? [])}`
							: "";
					return `${key}${isOptional(field) ? "?" : ""}${literal}`;
				});
			return `{${fields.join(", ")}}`;
		}
		default:
			return def.type;
	}
};

const truncate = (text: string) =>
	text.length > MAX_SHAPE_LENGTH
		? `${text.slice(0, MAX_SHAPE_LENGTH - 1)}…`
		: text;

const unknownKeyLine = (
	keys: readonly string[],
	parentPath: readonly PathKey[],
	validKeys: readonly string[],
) =>
	keys.map((key) => {
		const suggestions = suggestClosest(key, validKeys, { limit: 2 });
		return `${formatPath([...parentPath, key])}: unknown parameter.${formatDidYouMean(suggestions)}`;
	});

const issueLines = (
	issue: Issue,
	schema: ZodType,
	args: unknown,
	prefix: readonly PathKey[] = [],
): string[] => {
	const path = [...prefix, ...(issue.path as PathKey[])];
	const name = formatPath(path);
	const received = valueAtPath(args, path);
	const target = schemaAtPath(schema, path);

	switch (issue.code) {
		case "invalid_type": {
			const expected =
				target && defOf(unwrap(target))?.type !== "union"
					? describeSchemaShape(target)
					: issue.expected;
			if (received === undefined) {
				return [`${name}: required ${truncate(expected)}, missing.`];
			}
			return [
				`${name}: expected ${truncate(expected)}, received ${describeReceived(received)}.`,
			];
		}
		case "invalid_value": {
			const options = issue.values;
			const suggestions =
				typeof received === "string"
					? suggestClosest(
							received,
							options.filter(
								(value): value is string => typeof value === "string",
							),
							{ limit: 2 },
						)
					: [];
			if (received === undefined) {
				return [`${name}: required one of ${quoteValues(options)}, missing.`];
			}
			return [
				`${name}: expected one of ${quoteValues(options)}, received ${describeReceived(received)}.${formatDidYouMean(suggestions)}`,
			];
		}
		case "unrecognized_keys": {
			return unknownKeyLine(issue.keys, path, objectKeys(target));
		}
		case "invalid_union": {
			const options = defOf(unwrap(target))?.options ?? [];
			const accepted = options.length
				? options.map((option) => describeSchemaShape(option)).join(" | ")
				: undefined;
			// When one branch got the right type but a detail wrong, report that
			// detail: it is the shape the caller most likely meant.
			const isWrongKind = (branch: readonly Issue[]) =>
				branch.length === 1 &&
				branch[0].path.length === 0 &&
				branch[0].code === "invalid_type";
			const closest = issue.errors
				.filter((branch) => branch.length > 0 && !isWrongKind(branch))
				.sort((a, b) => a.length - b.length)[0];
			if (closest && closest.length <= 3) {
				return closest.flatMap((branchIssue) =>
					issueLines(branchIssue, schema, args, path),
				);
			}
			return [
				`${name}: received ${describeReceived(received)}; accepted shapes: ${truncate(accepted ?? "see the tool's input schema")}.`,
			];
		}
		case "too_small": {
			const minimum = Number(issue.minimum);
			if (issue.origin === "string") {
				return [
					minimum <= 1
						? `${name}: must be a non-empty string.`
						: `${name}: must be at least ${minimum} characters.`,
				];
			}
			if (issue.origin === "array" || issue.origin === "set") {
				return [`${name}: needs at least ${minimum} item(s).`];
			}
			return [
				`${name}: must be ${issue.inclusive ? ">=" : ">"} ${minimum}, received ${describeReceived(received)}.`,
			];
		}
		case "too_big": {
			const maximum = Number(issue.maximum);
			if (issue.origin === "string") {
				return [`${name}: must be at most ${maximum} characters.`];
			}
			if (issue.origin === "array" || issue.origin === "set") {
				return [`${name}: allows at most ${maximum} item(s).`];
			}
			return [
				`${name}: must be ${issue.inclusive ? "<=" : "<"} ${maximum}, received ${describeReceived(received)}.`,
			];
		}
		case "invalid_format":
			return [
				`${name}: expected ${issue.format} format, received ${describeReceived(received)}.`,
			];
		case "not_multiple_of":
			return [`${name}: must be a multiple of ${String(issue.divisor)}.`];
		case "custom":
			return [
				`${name}: ${issue.message || "invalid value"}, received ${describeReceived(received)}.`,
			];
		default:
			return [
				`${name}: ${(issue as { message?: string }).message || "invalid value"}.`,
			];
	}
};

/**
 * Parameters the caller sent that the tool does not declare. Tool input
 * objects strip unknown keys, so zod never reports them; they only matter as
 * a hint when the call already failed (a misspelt required parameter).
 */
const strippedKeyLines = (schema: ZodType, args: unknown) => {
	const shape = objectShape(schema);
	if (!shape || !args || typeof args !== "object" || Array.isArray(args)) {
		return [];
	}
	const def = defOf(unwrap(schema));
	if (def?.catchall && defOf(def.catchall)?.type !== "never") return [];
	const validKeys = Object.keys(shape);
	const unknown = Object.keys(args).filter((key) => !(key in shape));
	return unknownKeyLine(unknown, [], validKeys);
};

export const formatToolInputIssues = (
	schema: ZodType,
	args: unknown,
	issues: readonly Issue[],
): string[] => {
	const lines = [
		...issues.flatMap((issue) => issueLines(issue, schema, args)),
		...strippedKeyLines(schema, args),
	];
	const unique = [...new Set(lines)];
	return unique.length > MAX_ISSUE_LINES
		? [
				...unique.slice(0, MAX_ISSUE_LINES),
				`…and ${unique.length - MAX_ISSUE_LINES} more.`,
			]
		: unique;
};

export const formatToolInputError = (
	toolName: string,
	schema: ZodType,
	args: unknown,
	issues: readonly Issue[],
) =>
	[
		`Invalid arguments for tool ${toolName}:`,
		...formatToolInputIssues(schema, args, issues).map((line) => `- ${line}`),
	].join("\n");

type ValidateToolInput = (
	tool: { inputSchema?: unknown },
	args: unknown,
	toolName: string,
) => Promise<unknown>;

/**
 * Swap the SDK's tool input error text for formatToolInputError. The SDK still
 * runs its own checks (argument size limit, parsing); only a failed parse is
 * re-parsed here to build the message, so valid calls pay nothing extra.
 */
export const installToolInputValidation = (server: TrickroomMcpServer) => {
	const target = server as unknown as { validateToolInput: ValidateToolInput };
	const sdkValidate = target.validateToolInput.bind(server);
	target.validateToolInput = async (tool, args, toolName) => {
		try {
			return await sdkValidate(tool, args, toolName);
		} catch (error) {
			const schema = tool.inputSchema as ZodType | undefined;
			if (
				!(error instanceof McpError) ||
				error.code !== ErrorCode.InvalidParams ||
				!schema ||
				!defOf(schema)
			) {
				throw error;
			}
			const parsed = await safeParseAsync(schema, args ?? {});
			if (parsed.success) throw error;
			throw new McpError(
				ErrorCode.InvalidParams,
				`Input validation error: ${formatToolInputError(toolName, schema, args ?? {}, parsed.error.issues)}`,
			);
		}
	};
};
