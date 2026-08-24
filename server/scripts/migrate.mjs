import {spawnSync} from "node:child_process";
import path from "node:path";
import {getPgEnv} from "./pg-env.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const migration = path.resolve(process.argv[2] || "server/migrations/0001_hub_core.sql");
const result = spawnSync("psql", [
	"-v",
	"ON_ERROR_STOP=1",
	"-f",
	migration,
], {stdio: "inherit", env: getPgEnv({databaseUrl})});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`psql exited with status ${result.status}.`);
