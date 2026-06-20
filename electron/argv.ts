import fs from "node:fs";
import path from "node:path";

export const getElectronUserArgs = (argv = process.argv) => {
	const startIndex = process.defaultApp ? 2 : 1;
	return argv.slice(startIndex).filter((arg) => arg !== "--");
};

export const resolveInitialProjectRootFromArgs = (
	argv = process.argv,
	cwd = process.cwd(),
) => {
	const projectArg = getElectronUserArgs(argv).find(
		(arg) => !arg.startsWith("--"),
	);
	if (!projectArg) {
		return null;
	}

	return path.resolve(cwd, projectArg);
};

export const validateProjectRoot = (projectRoot: string) => {
	const stat = fs.statSync(projectRoot);
	if (!stat.isDirectory()) {
		throw new Error(`Project directory "${projectRoot}" is not a directory.`);
	}
};
