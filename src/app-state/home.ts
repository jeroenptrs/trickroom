import os from "node:os";
import path from "node:path";

export const resolveTrickroomHome = (home = process.env.TRICKROOM_HOME) => {
	if (home?.trim()) {
		return path.resolve(home);
	}

	return path.join(os.homedir(), ".trickroom");
};
