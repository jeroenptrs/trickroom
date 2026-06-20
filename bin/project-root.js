import fs from "node:fs";
import path from "node:path";

export const resolveProjectDir = (argv = process.argv) => {
	const envProjectDir = process.env.TRICKROOM_PROJECT_DIR;
	const argProjectDir = argv.slice(2).find((arg) => !arg.startsWith("--"));
	const projectDir = argProjectDir || envProjectDir;

	if (!projectDir) {
		return null;
	}

	return path.resolve(process.cwd(), projectDir);
};

export const setInitialProjectRoot = (argv = process.argv) => {
	const resolvedProjectDir = resolveProjectDir(argv);
	if (!resolvedProjectDir) {
		delete process.env.TRICKROOM_PROJECT_DIR;
		return null;
	}

	let stat;
	try {
		stat = fs.statSync(resolvedProjectDir);
	} catch {
		console.error(
			`Project directory "${resolvedProjectDir}" does not exist or is not accessible.`,
		);
		process.exit(1);
	}

	if (!stat.isDirectory()) {
		console.error(
			`Project directory "${resolvedProjectDir}" is not a directory.`,
		);
		process.exit(1);
	}

	process.env.TRICKROOM_PROJECT_DIR = resolvedProjectDir;
	return resolvedProjectDir;
};

export const changeProjectRoot = (argv = process.argv) => {
	const resolvedProjectDir = resolveProjectDir(argv);
	if (!resolvedProjectDir) {
		return;
	}

	let stat;
	try {
		stat = fs.statSync(resolvedProjectDir);
	} catch {
		console.error(
			`Project directory "${resolvedProjectDir}" does not exist or is not accessible.`,
		);
		process.exit(1);
	}

	if (!stat.isDirectory()) {
		console.error(
			`Project directory "${resolvedProjectDir}" is not a directory.`,
		);
		process.exit(1);
	}

	process.env.TRICKROOM_PROJECT_DIR = resolvedProjectDir;
	process.chdir(resolvedProjectDir);
};
