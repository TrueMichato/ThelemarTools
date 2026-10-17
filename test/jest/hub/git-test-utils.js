import os from "node:os";

export function getIsolatedGitEnv (baseEnv = process.env) {
	const env = {...baseEnv};
	const exactKeys = new Set([
		"GIT_ALLOW_PROTOCOL",
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_COMMON_DIR",
		"GIT_CONFIG",
		"GIT_CONFIG_COUNT",
		"GIT_CONFIG_GLOBAL",
		"GIT_CONFIG_NOSYSTEM",
		"GIT_CONFIG_PARAMETERS",
		"GIT_CONFIG_SYSTEM",
		"GIT_DIR",
		"GIT_INDEX_FILE",
		"GIT_OBJECT_DIRECTORY",
		"GIT_PREFIX",
		"GIT_PROTOCOL_FROM_USER",
		"GIT_WORK_TREE",
	]);
	for (const key of Object.keys(env)) {
		if (exactKeys.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete env[key];
	}
	env.GIT_CONFIG_NOSYSTEM = "1";
	env.GIT_CONFIG_GLOBAL = os.devNull;
	env.GIT_CONFIG_COUNT = "1";
	env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
	env.GIT_CONFIG_VALUE_0 = "always";
	return env;
}
