import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { tailwindRoutes } from "./routes/tailwind";
import {
	asErrnoException,
	isTrickroomConfig,
	isTrickroomDesign,
	jsonError,
	readJsonFile,
} from "./server-utils";
import type { TrickroomConfig, TrickroomDesignSummary } from "./types";

const app = new Hono();

const resolveProjectRoot = () => {
	const projectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
	if (!projectDirOverride) {
		return process.cwd();
	}

	return path.resolve(process.cwd(), projectDirOverride);
};

const projectRoot = resolveProjectRoot();
const configPath = path.join(projectRoot, "trickroom.config.json");
const designsDir = path.join(projectRoot, ".trickroom", "designs");
const designsGitkeepPath = path.join(designsDir, ".gitkeep");

app.use("*", async (c, next) => {
	c.set("projectRoot", projectRoot);
	c.set("configPath", configPath);
	await next();
});

const resolveDesignPath = (file: string) => {
	const resolvedDesignPath = path.resolve(designsDir, file);
	const allowedPrefix = `${designsDir}${path.sep}`;
	if (!resolvedDesignPath.startsWith(allowedPrefix)) {
		return null;
	}

	return resolvedDesignPath;
};

const getDesignUuidFromFile = (file: string) => {
	if (!file.endsWith(".json")) {
		return null;
	}

	return file.slice(0, -".json".length);
};

const writeJsonFileAtomically = async (filePath: string, value: unknown) => {
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	const contents = `${JSON.stringify(value, null, "\t")}\n`;

	try {
		await writeFile(tempPath, contents, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
};

app.get("/api/trickroom/project-root", async (c) => {
	return c.json({ projectRoot });
});

app.get("/api/trickroom/config", async (c) => {
	try {
		const config = await readJsonFile<unknown>(configPath);
		return c.json(config);
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			return jsonError(`Config file not found at ${configPath}`, 404);
		}

		return jsonError("Failed to read trickroom config file", 500);
	}
});

app.post("/api/trickroom/config", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!isTrickroomConfig(body)) {
		return jsonError("Invalid trickroom config payload", 400);
	}

	const config: TrickroomConfig = {
		name: body.name.trim(),
		...(body.systems
			? {
					systems: Object.fromEntries(
						Object.entries(body.systems).map(([name, cssPath]) => [
							name.trim(),
							cssPath.trim(),
						]),
					),
				}
			: {}),
	};

	try {
		await readFile(configPath, "utf8");
		return jsonError(`Config file already exists at ${configPath}`, 409);
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code !== "ENOENT") {
			return jsonError("Failed to check trickroom config file", 500);
		}
	}

	try {
		await mkdir(designsDir, { recursive: true });
		await writeFile(designsGitkeepPath, "", { flag: "a" });
		await writeJsonFileAtomically(configPath, config);
		return c.json(config, 201);
	} catch {
		return jsonError("Failed to create trickroom project", 500);
	}
});

app.route("/api/trickroom/tailwind", tailwindRoutes);

app.get("/api/trickroom/design", async (c) => {
	const file = c.req.query("file");
	if (!file) {
		return jsonError("Missing required query parameter: file", 400);
	}

	const resolvedDesignPath = resolveDesignPath(file);
	if (!resolvedDesignPath) {
		return jsonError("Design file path must be inside .trickroom/designs", 400);
	}

	try {
		const design = await readJsonFile<unknown>(resolvedDesignPath);
		return c.json(design);
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			return jsonError(`Design file not found at ${resolvedDesignPath}`, 404);
		}

		return jsonError("Failed to read trickroom design file", 500);
	}
});

app.get("/api/trickroom/designs", async (c) => {
	try {
		const directoryEntries = await readdir(designsDir, { withFileTypes: true });
		const designFiles = directoryEntries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => entry.name)
			.sort();

		const designSummaries = await Promise.all(
			designFiles.map(async (file) => {
				try {
					const resolvedDesignPath = resolveDesignPath(file);
					const uuid = getDesignUuidFromFile(file);
					if (!resolvedDesignPath || !uuid) {
						return null;
					}

					const design = await readJsonFile<unknown>(resolvedDesignPath);
					if (!isTrickroomDesign(design)) {
						return null;
					}

					return {
						uuid,
						file,
						name: design.name,
						...(design.systemName !== undefined
							? { systemName: design.systemName }
							: {}),
					} satisfies TrickroomDesignSummary;
				} catch {
					return null;
				}
			}),
		);

		return c.json(designSummaries.filter((summary) => summary !== null));
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			return c.json([] satisfies TrickroomDesignSummary[]);
		}

		return jsonError("Failed to list trickroom design files", 500);
	}
});

app.put("/api/trickroom/design", async (c) => {
	const file = c.req.query("file");
	if (!file) {
		return jsonError("Missing required query parameter: file", 400);
	}

	const resolvedDesignPath = resolveDesignPath(file);
	if (!resolvedDesignPath) {
		return jsonError("Design file path must be inside .trickroom/designs", 400);
	}

	const body = await c.req.json().catch(() => null);
	if (!isTrickroomDesign(body)) {
		return jsonError("Invalid trickroom design payload", 400);
	}

	try {
		await writeJsonFileAtomically(resolvedDesignPath, body);
		return c.json(body);
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			return jsonError(`Design file not found at ${resolvedDesignPath}`, 404);
		}

		return jsonError("Failed to write trickroom design file", 500);
	}
});

export default app;
