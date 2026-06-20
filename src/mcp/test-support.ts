import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	StdioClientTransport,
	type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	getTrickroomProjectPaths,
	readMcpEnabledProjectContext,
} from "../project";
import { createDesignFileService } from "../services/design-file-service";
import type { TrickroomConfig, TrickroomDesign } from "../types";
import {
	type StoreDomainTokensParams,
	storeDomainTokens,
} from "../utils/tailwind-token-store";
import {
	createTrickroomMcpServer,
	type TrickroomMcpServerContext,
} from "./server";

export const trickroomMcpTestDesignUuid =
	"00000000-0000-4000-8000-000000000001";

export const trickroomMcpTestDesign = {
	name: "Harness Design",
	systemName: "Core",
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				{
					id: "title",
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Harness fixture",
				},
			],
		},
	],
} satisfies TrickroomDesign;

export type TrickroomMcpTokenSnapshotFixture = Omit<
	StoreDomainTokensParams,
	"projectRoot" | "tailwindBaselineVersion" | "tokens" | "baselineDiff"
> & {
	tailwindBaselineVersion?: string;
	tokens?: Record<string, string>;
	baselineDiff?: StoreDomainTokensParams["baselineDiff"];
};

export type TrickroomMcpProjectFixtureOptions = {
	name?: string;
	config?: Partial<TrickroomConfig>;
	mcpEnabled?: boolean;
	systems?: Record<string, string>;
	systemCss?: Record<string, string>;
	designs?: Record<string, TrickroomDesign>;
	tokenSnapshots?: TrickroomMcpTokenSnapshotFixture[];
};

export type TrickroomMcpProjectFixture = {
	projectRoot: string;
	configPath: string;
	config: TrickroomConfig;
	designFileService: ReturnType<typeof createDesignFileService>;
	readMcpContext: () => Promise<TrickroomMcpServerContext>;
	writeConfig: (config: TrickroomConfig) => Promise<void>;
	writeDesign: (uuid: string, design: TrickroomDesign) => Promise<void>;
	writeSystemCss: (cssPath: string, contents: string) => Promise<void>;
	writeTokenSnapshot: (
		snapshot: TrickroomMcpTokenSnapshotFixture,
	) => Promise<void>;
	cleanup: () => Promise<void>;
};

export type TrickroomMcpClientSession = {
	client: Client;
	server?: McpServer;
	transport: Transport;
	close: () => Promise<void>;
};

const defaultSystems = {
	Core: "src/index.css",
};

const defaultSystemCss = `@import "tailwindcss";

@theme {
  --color-brand-500: #2563eb;
}
`;

const createDefaultTokenSnapshot = (
	systemName: string,
	cssPath: string,
): TrickroomMcpTokenSnapshotFixture => ({
	systemName,
	cssPath,
	tokens: {
		"brand-500": "#2563eb",
	},
	overrides: ["brand-500"],
	baselineDiff: {
		added: [{ name: "brand-500", value: "#2563eb", domain: "color" }],
		overridden: [],
		removed: [],
	},
	tailwindBaselineVersion: "test-baseline",
	reviewRequired: false,
	syncedAt: "2026-01-01T00:00:00.000Z",
});

const writeJson = async (filePath: string, value: unknown) => {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
};

export const createTrickroomMcpProjectFixture = async (
	options: TrickroomMcpProjectFixtureOptions = {},
): Promise<TrickroomMcpProjectFixture> => {
	const projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-trickroom-mcp-fixture-"),
	);
	const configPath = getTrickroomProjectPaths(projectRoot).configPath;
	const systems = options.systems ?? options.config?.systems ?? defaultSystems;
	const fallbackProjectId = `proj_${path
		.basename(projectRoot)
		.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
	const config = {
		projectId: options.config?.projectId ?? fallbackProjectId,
		name: options.name ?? options.config?.name ?? "Harness Project",
		systems,
		mcp: {
			enabled:
				options.mcpEnabled ??
				options.config?.mcp?.enabled ??
				(options.config?.mcp === undefined ? true : options.config.mcp.enabled),
			...(options.config?.mcp?.mode ? { mode: options.config.mcp.mode } : {}),
			...(options.config?.mcp?.allowedDesignFileIds
				? {
						allowedDesignFileIds: options.config.mcp.allowedDesignFileIds,
					}
				: {}),
			...(options.config?.mcp?.allowedComponents
				? { allowedComponents: options.config.mcp.allowedComponents }
				: {}),
			...(options.config?.mcp?.auditLog !== undefined
				? { auditLog: options.config.mcp.auditLog }
				: {}),
		},
	} satisfies TrickroomConfig;
	const designFileService = createDesignFileService(projectRoot);

	const fixture: TrickroomMcpProjectFixture = {
		projectRoot,
		configPath,
		config,
		designFileService,
		readMcpContext: () => readMcpEnabledProjectContext(projectRoot),
		writeConfig: async (nextConfig) => {
			await writeJson(configPath, nextConfig);
		},
		writeDesign: async (uuid, design) => {
			await mkdir(designFileService.designsDir, { recursive: true });
			await designFileService.writeDesignFile(
				designFileService.getFileForUuid(uuid),
				design,
			);
		},
		writeSystemCss: async (cssPath, contents) => {
			const systemCssPath = path.resolve(projectRoot, cssPath);
			await mkdir(path.dirname(systemCssPath), { recursive: true });
			await writeFile(systemCssPath, contents, "utf8");
		},
		writeTokenSnapshot: async (snapshot) => {
			await storeDomainTokens({
				projectRoot,
				systemName: snapshot.systemName,
				cssPath: snapshot.cssPath,
				tailwindBaselineVersion:
					snapshot.tailwindBaselineVersion ?? "test-baseline",
				tokens: snapshot.tokens ?? {},
				overrides: snapshot.overrides ?? [],
				baselineDiff: snapshot.baselineDiff ?? {
					added: [],
					overridden: [],
					removed: [],
				},
				reviewRequired: snapshot.reviewRequired ?? false,
				...(snapshot.syncedAt ? { syncedAt: snapshot.syncedAt } : {}),
				...(snapshot.domains ? { domains: snapshot.domains } : {}),
				...(snapshot.domainOverrides
					? { domainOverrides: snapshot.domainOverrides }
					: {}),
				...(snapshot.domainBaselineDiffs
					? { domainBaselineDiffs: snapshot.domainBaselineDiffs }
					: {}),
			});
		},
		cleanup: () => rm(projectRoot, { force: true, recursive: true }),
	};

	await fixture.writeConfig(config);

	for (const [systemName, cssPath] of Object.entries(systems)) {
		await fixture.writeSystemCss(
			cssPath,
			options.systemCss?.[systemName] ?? defaultSystemCss,
		);
	}

	for (const [uuid, design] of Object.entries(
		options.designs ?? {
			[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
		},
	)) {
		await fixture.writeDesign(uuid, design);
	}

	for (const snapshot of options.tokenSnapshots ?? [
		createDefaultTokenSnapshot("Core", systems.Core ?? "src/index.css"),
	]) {
		await fixture.writeTokenSnapshot(snapshot);
	}

	return fixture;
};

export const createTrickroomMcpTestClient = async (
	context: TrickroomMcpServerContext,
	options?: {
		clientCapabilities?: Record<string, unknown>;
	},
): Promise<TrickroomMcpClientSession> => {
	const client = options?.clientCapabilities
		? new Client(
				{ name: "trickroom-mcp-test", version: "0.1.0" },
				{ capabilities: options.clientCapabilities },
			)
		: new Client({ name: "trickroom-mcp-test", version: "0.1.0" });
	const server = createTrickroomMcpServer(context);
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return {
		client,
		server,
		transport: clientTransport,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
};

export const createTrickroomMcpStdioTestClient = async (
	server: StdioServerParameters,
): Promise<TrickroomMcpClientSession> => {
	const client = new Client({
		name: "trickroom-mcp-stdio-test",
		version: "0.1.0",
	});
	const transport = new StdioClientTransport(server);

	await client.connect(transport);

	return {
		client,
		transport,
		close: async () => {
			await client.close();
		},
	};
};
