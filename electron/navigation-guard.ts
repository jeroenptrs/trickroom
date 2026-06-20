import type { BrowserWindow, Session } from "electron";
import { shell } from "electron";
import { isAllowedAppUrl, isSafeExternalUrl } from "./url-policy";

export { isAllowedAppUrl, isSafeExternalUrl };

export const installNavigationGuards = (
	window: BrowserWindow,
	allowedOrigin: string,
) => {
	window.webContents.on("will-navigate", (event, url) => {
		if (isAllowedAppUrl(url, allowedOrigin)) {
			return;
		}

		event.preventDefault();
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isAllowedAppUrl(url, allowedOrigin)) {
			return { action: "allow" };
		}

		if (isSafeExternalUrl(url)) {
			void shell.openExternal(url);
		}

		return { action: "deny" };
	});
};

export const installPermissionPolicy = (session: Session) => {
	session.setPermissionRequestHandler((_webContents, _permission, callback) => {
		callback(false);
	});
};

export const installContentSecurityPolicy = (
	session: Session,
	allowedOrigin: string,
) => {
	const csp = [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"frame-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; ");

	session.webRequest.onHeadersReceived(
		{ urls: [`${allowedOrigin}/*`] },
		(details, callback) => {
			callback({
				responseHeaders: {
					...details.responseHeaders,
					"Content-Security-Policy": [csp],
				},
			});
		},
	);
};
