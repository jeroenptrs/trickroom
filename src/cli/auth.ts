import {
	type AuthSession,
	createPairingCode,
	DEFAULT_SESSION_DAYS,
	listAuthSessions,
	MAX_SESSION_DAYS,
	PAIRING_CODE_TTL_MS,
	revokeAuthSessions,
} from "../app-state/auth-sessions";
import { resolveTrickroomHome } from "../app-state/home";
import { listServerDiscoveryRecords } from "../app-state/runtime-servers";
import { readTrickroomSettings } from "../app-state/settings";

/**
 * `trickroom pair [--days <n>] [--json]` prints a one-time code that signs a
 * browser in to the Trickroom server on this machine.
 * `trickroom sessions [--json]` lists the browsers signed in, and
 * `trickroom sessions revoke <id>|--all` ends their sessions.
 * Both work on files in the Trickroom home and need no running server.
 */

const PAIR_USAGE = "Usage: trickroom pair [--days <1-365>] [--json]";
const SESSIONS_USAGE =
	"Usage: trickroom sessions [--json]\n       trickroom sessions revoke <id>|--all";

type Output = { out: (line: string) => void; err: (line: string) => void };

const consoleOutput: Output = {
	out: (line) => process.stdout.write(`${line}\n`),
	err: (line) => process.stderr.write(`${line}\n`),
};

export const parseSessionDays = (
	value: string | undefined,
	environment: NodeJS.ProcessEnv = process.env,
) => {
	const raw = value ?? environment.TRICKROOM_SESSION_DAYS?.trim();
	if (!raw) return DEFAULT_SESSION_DAYS;
	const days = Number(raw);
	if (!Number.isInteger(days) || days < 1 || days > MAX_SESSION_DAYS) {
		throw new Error(
			`Session length must be a whole number of days from 1 to ${MAX_SESSION_DAYS}, got ${JSON.stringify(raw)}.`,
		);
	}
	return days;
};

/** Where a browser opens the pairing page, and whether a server asks for it. */
const describeServers = async (trickroomHome: string) => {
	const isRunning = (pid: number) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	// Records of killed servers stay behind, so only live processes count.
	const records = (
		await listServerDiscoveryRecords(trickroomHome).catch(() => [])
	).flatMap(({ record }) => (record && isRunning(record.pid) ? [record] : []));
	const settings = await readTrickroomSettings(trickroomHome).catch(() => null);
	const publicUrl = settings?.server?.publicUrl;
	const baseUrl = publicUrl ?? records[0]?.url ?? null;
	return {
		baseUrl: baseUrl ? new URL("/", baseUrl).href : null,
		running: records.length,
		withAuth: records.filter((record) => record.token !== null).length,
	};
};

const runPair = async (
	args: readonly string[],
	trickroomHome: string,
	output: Output,
) => {
	let days: string | undefined;
	let json = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--json") {
			json = true;
		} else if (arg === "--days") {
			days = args[index + 1];
			index += 1;
			if (days === undefined) throw new Error("--days requires a value.");
		} else if (arg?.startsWith("--days=")) {
			days = arg.slice("--days=".length);
		} else {
			throw new Error(`Unknown option ${JSON.stringify(arg)}.\n${PAIR_USAGE}`);
		}
	}

	const sessionDays = parseSessionDays(days);
	const { formatted, grant } = await createPairingCode({
		trickroomHome,
		sessionDays,
	});
	const servers = await describeServers(trickroomHome);
	const url = servers.baseUrl ? `${servers.baseUrl}pair#${formatted}` : null;
	if (json) {
		output.out(
			JSON.stringify({
				code: formatted,
				expiresAt: grant.expiresAt,
				sessionDays,
				url,
			}),
		);
		return 0;
	}

	output.out(`Pairing code: ${formatted}`);
	output.out(
		`Valid for ${Math.round(PAIRING_CODE_TTL_MS / 60_000)} minutes, for one browser. The browser then stays signed in for ${sessionDays} ${sessionDays === 1 ? "day" : "days"} after its last use.`,
	);
	if (url) output.out(`Open ${url}`);
	if (servers.running === 0) {
		output.err(
			"No Trickroom server is running on this machine. Start one with `trickroom serve --stable-token`.",
		);
	} else if (servers.withAuth === 0) {
		output.err(
			"The running Trickroom server does not ask for sign-in, so it will not ask for this code. Start it with `--stable-token` to turn sign-in on.",
		);
	}
	return 0;
};

const describeBrowser = (userAgent: string | null) => {
	if (!userAgent) return "Unknown browser";
	const browser =
		/(Edg|OPR|Firefox|Chrome|Safari)\/[\d.]+/u.exec(userAgent)?.[1] ?? null;
	const name =
		browser === "Edg" ? "Edge" : browser === "OPR" ? "Opera" : browser;
	const system =
		/(Windows|Android|iPhone|iPad|Mac OS X|Linux)/u.exec(userAgent)?.[1] ??
		null;
	const os = system === "Mac OS X" ? "macOS" : system;
	return [name, os].filter(Boolean).join(" on ") || userAgent.slice(0, 40);
};

const formatSession = (session: AuthSession) =>
	`${session.id}  ${describeBrowser(session.userAgent).padEnd(22)}  last used ${session.lastSeenAt}  expires ${session.expiresAt}`;

const runSessions = async (
	args: readonly string[],
	trickroomHome: string,
	output: Output,
) => {
	if (args[0] === "revoke") {
		const target = args[1];
		if (!target || args.length > 2) {
			throw new Error(SESSIONS_USAGE);
		}
		if (target !== "--all" && target.startsWith("--")) {
			throw new Error(
				`Unknown option ${JSON.stringify(target)}.\n${SESSIONS_USAGE}`,
			);
		}
		const revoked = await revokeAuthSessions({
			trickroomHome,
			...(target === "--all" ? {} : { idPrefix: target }),
		});
		if (revoked.length === 0) {
			output.err(
				target === "--all"
					? "No browser is signed in."
					: `No session id starts with ${JSON.stringify(target)}. Run \`trickroom sessions\` for the ids.`,
			);
			return target === "--all" ? 0 : 1;
		}
		for (const session of revoked) {
			output.out(
				`Signed out ${session.id} (${describeBrowser(session.userAgent)})`,
			);
		}
		return 0;
	}

	const json = args.includes("--json");
	const unknown = args.find((arg) => arg !== "--json");
	if (unknown) {
		throw new Error(
			`Unknown argument ${JSON.stringify(unknown)}.\n${SESSIONS_USAGE}`,
		);
	}
	const sessions = await listAuthSessions(trickroomHome);
	if (json) {
		output.out(JSON.stringify(sessions));
		return 0;
	}
	if (sessions.length === 0) {
		output.out("No browser is signed in. Run `trickroom pair` to sign one in.");
		return 0;
	}
	for (const session of sessions) output.out(formatSession(session));
	return 0;
};

export const main = async (
	command: "pair" | "sessions",
	args: readonly string[],
	{
		trickroomHome = resolveTrickroomHome(),
		output = consoleOutput,
	}: { trickroomHome?: string; output?: Output } = {},
): Promise<number> => {
	try {
		if (args.includes("--help") || args.includes("-h")) {
			output.out(command === "pair" ? PAIR_USAGE : SESSIONS_USAGE);
			return 0;
		}
		return command === "pair"
			? await runPair(args, trickroomHome, output)
			: await runSessions(args, trickroomHome, output);
	} catch (error) {
		output.err(error instanceof Error ? error.message : String(error));
		return 1;
	}
};
