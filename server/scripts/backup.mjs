import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {getPgEnv} from "./pg-env.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const target = process.argv[2];
if (!target) throw new Error(`Usage: npm run hub:backup -- <output.dump>`);
const resolvedTarget = path.resolve(target);
if (fs.existsSync(resolvedTarget)) throw new Error(`Backup target already exists: ${resolvedTarget}`);
fs.mkdirSync(path.dirname(resolvedTarget), {recursive: true});

const result = spawnSync("pg_dump", [
	"--format=custom",
	"--no-owner",
	"--no-privileges",
	"--exclude-table-data=hub.oauth_transactions",
	`--file=${resolvedTarget}`,
], {stdio: "inherit", env: getPgEnv({databaseUrl})});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`pg_dump exited with status ${result.status}.`);
process.stdout.write(`Campaign Hub backup written to ${resolvedTarget}\n`);
