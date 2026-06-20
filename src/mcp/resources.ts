export type ParsedDesignResourceUri = {
	locationId: string;
	designId: string;
	slug?: string;
};

const DESIGN_RESOURCE_URI_PREFIX = "trickroom://proj/";
const DESIGN_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SLUG_LENGTH = 30;

export function buildDesignResourceUri(
	locationId: string,
	designId: string,
	slug?: string,
): string {
	const normalizedSlug = slug ? slugifyDesignTitle(slug) : "";
	const slugSuffix = normalizedSlug.length > 0 ? `${normalizedSlug}--` : "";
	return `${DESIGN_RESOURCE_URI_PREFIX}${locationId}/design/${slugSuffix}${designId}`;
}

export function parseDesignResourceUri(uri: string): ParsedDesignResourceUri {
	if (!uri.startsWith(DESIGN_RESOURCE_URI_PREFIX)) {
		throw new Error(`Invalid design resource URI: ${uri}`);
	}

	const withoutPrefix = uri.slice(DESIGN_RESOURCE_URI_PREFIX.length);
	const pathSegments = withoutPrefix.split("/").filter((segment) => segment.length > 0);

	if (pathSegments.length !== 3) {
		throw new Error(`Invalid design resource URI: ${uri}`);
	}

	const [locationId, designSegmentName, resourceSegment] = pathSegments;

	if (designSegmentName !== "design") {
		throw new Error(`Invalid design resource URI: ${uri}`);
	}

	const separatorIndex = resourceSegment.lastIndexOf("--");
	let designId: string;
	let slug: string | undefined;

	if (separatorIndex >= 0) {
		designId = resourceSegment.slice(separatorIndex + 2);
		slug = resourceSegment.slice(0, separatorIndex);

		if (slug.length === 0 || designId.length === 0) {
			throw new Error(`Invalid design resource URI: ${uri}`);
		}
	} else {
		designId = resourceSegment;
	}

	if (!DESIGN_ID_PATTERN.test(designId)) {
		throw new Error(`Invalid design resource URI: ${uri}`);
	}

	return {
		locationId,
		designId,
		...(slug ? { slug } : {}),
	};
}

export function slugifyDesignTitle(title: string): string {
	const normalized = title
		.normalize("NFD")
		.toLowerCase()
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/^-+|-+$/g, "");

	return normalized;
}
