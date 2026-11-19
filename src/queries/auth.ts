import { queryOptions } from "@tanstack/react-query";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { apiFetch } from "../utils/tab-location";

export type AuthSessionInfo = {
	/** Whether this server asks for credentials at all. */
	authRequired: boolean;
	/** `session`: this browser paired with a code and can sign out. */
	kind: "none" | "token" | "session";
	expiresAt?: string;
};

export const authSessionQueryOptions = () =>
	queryOptions({
		queryKey: ["trickroom-auth-session"],
		queryFn: async () =>
			readJsonOrThrow<AuthSessionInfo>(
				await apiFetch("/api/trickroom/auth/session"),
			),
		retry: false,
		staleTime: 60_000,
	});

export const signOut = async () => {
	const response = await apiFetch("/api/trickroom/auth/sign-out", {
		method: "POST",
	});
	return readJsonOrThrow<{ ok: true }>(response);
};
