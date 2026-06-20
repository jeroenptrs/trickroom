import type { Session } from "electron";

export const sessionHeaderName = "x-trickroom-session";

export const createSessionAuthHeaders = (sessionToken: string) => ({
	[sessionHeaderName]: sessionToken,
});

export const installSessionAuthHeader = (
	electronSession: Session,
	allowedOrigin: string,
	sessionToken: string,
) => {
	electronSession.webRequest.onBeforeSendHeaders(
		{ urls: [`${allowedOrigin}/*`] },
		(details, callback) => {
			const requestHeaders = Object.fromEntries(
				Object.entries(details.requestHeaders ?? {}).filter(
					([header]) => header.toLowerCase() !== sessionHeaderName,
				),
			);
			requestHeaders[sessionHeaderName] = sessionToken;
			callback({ requestHeaders });
		},
	);
};
