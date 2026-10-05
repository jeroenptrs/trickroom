const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

// Separators that end a camelCase word; everything else is kept verbatim so
// invalid characters surface as an identifier diagnostic instead of vanishing.
const WORD_SEPARATOR_PATTERN = /[-_\s.]+/u;

export const isValidIdentifier = (value: string) =>
	IDENTIFIER_PATTERN.test(value);

const capitalize = (word: string) =>
	word.length > 0 ? `${word[0].toUpperCase()}${word.slice(1)}` : word;

const splitWords = (value: string) =>
	value.split(WORD_SEPARATOR_PATTERN).filter((word) => word.length > 0);

/** `light-label` -> `lightLabel`; existing camelCase is preserved. */
export const toCamelCase = (value: string) => {
	const [first = "", ...rest] = splitWords(value);
	return `${first}${rest.map(capitalize).join("")}`;
};

/** `otp-field-input` -> `OtpFieldInput`; no initialism dictionary. */
export const toPascalCase = (value: string) =>
	splitWords(value).map(capitalize).join("");

/** Object key as emitted: bare when it is a valid identifier, quoted otherwise. */
export const formatObjectKey = (key: string) =>
	isValidIdentifier(key) ? key : JSON.stringify(key);

export const variantsExportName = (slug: string) =>
	`${toCamelCase(slug)}Variants`;

export const axisTypeAliasName = (slug: string, axisKey: string) =>
	`${toPascalCase(slug)}${toPascalCase(axisKey)}`;

export const variantsFileName = (pattern: string, slug: string) =>
	pattern.replaceAll("{slug}", slug);
