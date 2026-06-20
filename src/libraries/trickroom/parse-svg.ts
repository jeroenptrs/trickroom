export type ParsedSvgRoot = {
	attrs: Record<string, string>;
	innerHTML: string;
};

const svgParseCache = new Map<string, ParsedSvgRoot | null>();

export function parseSvgRoot(svgText: string): ParsedSvgRoot | null {
	const cached = svgParseCache.get(svgText);

	if (cached !== undefined) {
		return cached;
	}

	if (!svgText) {
		svgParseCache.set(svgText, null);
		return null;
	}

	if (typeof DOMParser === "undefined") {
		return null;
	}

	const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
	const root = document.documentElement;

	if (
		!root ||
		root.localName.toLowerCase() !== "svg" ||
		document.getElementsByTagName("parsererror").length > 0
	) {
		svgParseCache.set(svgText, null);
		return null;
	}

	const attrs: Record<string, string> = {};

	for (const attr of Array.from(root.attributes)) {
		if (attr.name.toLowerCase().startsWith("data-trickroom-")) {
			continue;
		}

		attrs[attr.name === "class" ? "className" : attr.name] = attr.value;
	}

	const parsed = {
		attrs,
		innerHTML: root.innerHTML,
	};

	svgParseCache.set(svgText, parsed);
	return parsed;
}
