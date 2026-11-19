/**
 * Which checkout this browser tab shows. A tab at `/p/<locationId>/…` is
 * pinned to that registered location: the router runs under that prefix and
 * every API request names the location, so two tabs can show two projects or
 * two branches of one. A tab at any other path shows the server's active
 * project (the capture pages and old links).
 */
const tabLocationPattern = /^\/p\/([^/]+)(?=\/|$)/u;

const readPathname = () =>
	typeof window === "undefined" ? "" : window.location.pathname;

const parseTabLocationId = (pathname: string) => {
	const match = tabLocationPattern.exec(pathname);
	if (!match?.[1]) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
};

/** The location this tab is pinned to, or null. Fixed for the page's life. */
export const tabLocationId = parseTabLocationId(readPathname());

/** The router basename of a pinned tab, otherwise undefined. */
export const tabBasename = tabLocationId
	? `/p/${encodeURIComponent(tabLocationId)}`
	: undefined;

/** The tab's path inside its checkout, without the location prefix. */
export const getTabPath = (pathname = readPathname()) =>
	pathname.replace(tabLocationPattern, "") || "/";

/** The URL of `path` (default: the project screen) in a checkout. */
export const getCheckoutUrl = (locationId: string, path = "/") =>
	`/p/${encodeURIComponent(locationId)}${path.startsWith("/") ? path : `/${path}`}`;

/** Loads a checkout in this tab. A full load, so no state of the old one stays. */
export const openCheckoutInTab = (locationId: string, path?: string) => {
	window.location.assign(getCheckoutUrl(locationId, path));
};

const locationHeaderName = "x-trickroom-location";
const locationQueryName = "location";
const apiPrefix = "/api/trickroom";

/**
 * An API URL for a request that cannot carry headers (an image, a font, an
 * event stream, a link): a pinned tab adds its location as a query parameter.
 */
export const withTabLocation = (url: string) => {
	if (!tabLocationId || !url.startsWith(apiPrefix)) return url;
	const [beforeHash, hash] = url.split("#", 2);
	const separator = beforeHash.includes("?") ? "&" : "?";
	return `${beforeHash}${separator}${locationQueryName}=${encodeURIComponent(tabLocationId)}${hash === undefined ? "" : `#${hash}`}`;
};

const authRequiredHeaderName = "x-trickroom-auth";
let sentToPair = false;

/**
 * A request the server refused because this browser's session ended (it
 * expired or was revoked) sends the tab to the pairing page, once, and back
 * to where it was afterwards.
 */
const followAuthRequired = (response: Response) => {
	if (
		response.status === 403 &&
		!sentToPair &&
		typeof window !== "undefined" &&
		response.headers?.get(authRequiredHeaderName) === "required"
	) {
		sentToPair = true;
		const here = `${window.location.pathname}${window.location.search}`;
		window.location.assign(`/pair?next=${encodeURIComponent(here)}`);
	}
	return response;
};

/**
 * `fetch` for the Trickroom API. A pinned tab names its location on every
 * request; any other tab's request goes out unchanged.
 */
export const apiFetch = (
	input: string,
	init?: RequestInit,
): Promise<Response> => {
	if (!tabLocationId || !input.startsWith(apiPrefix)) {
		return (init === undefined ? fetch(input) : fetch(input, init)).then(
			followAuthRequired,
		);
	}
	const headers = new Headers(init?.headers);
	headers.set(locationHeaderName, tabLocationId);
	return fetch(input, { ...init, headers }).then(followAuthRequired);
};
