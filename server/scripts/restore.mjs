import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {getPgEnv} from "./pg-env.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
if (process.env.HUB_RESTORE_CONFIRM !== "RESTORE") {
	throw new Error(`Set HUB_RESTORE_CONFIRM=RESTORE to confirm destructive restore.`);
}
const source = process.argv[2];
if (!source) throw new Error(`Usage: npm run hub:restore -- <input.dump>`);
const resolvedSource = path.resolve(source);
if (!fs.existsSync(resolvedSource)) throw new Error(`Backup does not exist: ${resolvedSource}`);
const pgEnv = getPgEnv({databaseUrl});

const result = spawnSync("pg_restore", [
	"--clean",
	"--if-exists",
	"--single-transaction",
	"--no-owner",
	"--no-privileges",
	`--dbname=${pgEnv.PGDATABASE}`,
	resolvedSource,
], {stdio: "inherit", env: pgEnv});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`pg_restore exited with status ${result.status}.`);
process.stdout.write(`Campaign Hub restore completed from ${resolvedSource}\n`);
