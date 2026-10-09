// Deep links into a system's component: `/system/<id>?component=<componentId>`,
// optionally with `version` (the published version a finding refers to) and
// `path` (a template node to select once the component's draft has loaded).

export const systemDeepLinkComponentParam = "component";
export const systemDeepLinkVersionParam = "version";
export const systemDeepLinkPathParam = "path";

export type SystemComponentDeepLinkTarget = {
	version?: string | null;
	path?: string | null;
};

/** Builds the in-app path that opens a system component in the System editor. */
export function buildSystemComponentPath(
	systemId: string,
	componentId: string,
	{ version, path }: SystemComponentDeepLinkTarget = {},
) {
	const params = [
		`${systemDeepLinkComponentParam}=${encodeURIComponent(componentId)}`,
	];
	if (version) {
		params.push(`${systemDeepLinkVersionParam}=${encodeURIComponent(version)}`);
	}
	if (path) {
		params.push(`${systemDeepLinkPathParam}=${encodeURIComponent(path)}`);
	}
	return `/system/${encodeURIComponent(systemId)}?${params.join("&")}`;
}

/** The template node a deep link asks to select, when it names one. */
export function readSystemComponentDeepLinkNode(params: URLSearchParams) {
	const componentId = params.get(systemDeepLinkComponentParam);
	const path = params.get(systemDeepLinkPathParam);
	if (!componentId || !path) {
		return null;
	}
	return {
		componentId,
		path,
		version: params.get(systemDeepLinkVersionParam),
	};
}
