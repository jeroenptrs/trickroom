import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { normalizeTrickroomConfig, resolveProjectRoot } from "./project";
import { tailwindRoutes } from "./routes/tailwind";
import {
	asErrnoException,
	isTrickroomConfig,
	jsonError,
	readJsonFile,
	writeJsonFileAtomically,
} from "./server-utils";
import {
	createDesignFileService,
	DesignFileServiceError,
} from "./services/design-file-service";
import type { TrickroomConfig, TrickroomDesignSummary } from "./types";

const app = new Hono();

const projectRoot = resolveProjectRoot();
const configPath = path.join(projectRoot, "trickroom.config.json");
const designFileService = createDesignFileService(projectRoot);

app.use("*", async (c, next) => {
	c.set("projectRoot", projectRoot);
	c.set("configPath", configPath);
	await next();
});

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
		...normalizeTrickroomConfig(body),
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
		await mkdir(designFileService.designsDir, { recursive: true });
		await writeFile(designFileService.designsGitkeepPath, "", { flag: "a" });
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

	try {
		const read = await designFileService.readJsonFile(file);
		return c.json(read.value);
	} catch (error) {
		if (
			error instanceof DesignFileServiceError &&
			error.code === "INVALID_DESIGN_FILE_PATH"
		) {
			return jsonError(
				"Design file path must be inside .trickroom/designs",
				400,
			);
		}

		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			const designPath = designFileService.resolveDesignFilePath(file);
			return jsonError(`Design file not found at ${designPath}`, 404);
		}

		return jsonError("Failed to read trickroom design file", 500);
	}
});

app.get("/api/trickroom/designs", async (c) => {
	try {
		const designSummaries = await designFileService.listDesignSummaries();
		return c.json(
			designSummaries.map(
				(summary) =>
					({
						uuid: summary.uuid,
						file: summary.file,
						name: summary.name,
						...(summary.systemName !== undefined
							? { systemName: summary.systemName }
							: {}),
					}) satisfies TrickroomDesignSummary,
			),
		);
	} catch {
		return jsonError("Failed to list trickroom design files", 500);
	}
});

app.put("/api/trickroom/design", async (c) => {
	const file = c.req.query("file");
	if (!file) {
		return jsonError("Missing required query parameter: file", 400);
	}

	try {
		designFileService.resolveDesignFilePath(file);
	} catch (error) {
		if (!(error instanceof DesignFileServiceError)) {
			throw error;
		}

		return jsonError("Design file path must be inside .trickroom/designs", 400);
	}

	const body = await c.req.json().catch(() => null);

	try {
		const written = await designFileService.writeDesignFile(file, body);
		return c.json(written.design);
	} catch (error) {
		if (
			error instanceof DesignFileServiceError &&
			error.code === "INVALID_DESIGN_PAYLOAD"
		) {
			return jsonError("Invalid trickroom design payload", 400);
		}

		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			const designPath = designFileService.resolveDesignFilePath(file);
			return jsonError(`Design file not found at ${designPath}`, 404);
		}

		return jsonError("Failed to write trickroom design file", 500);
	}
});

export default app;
