import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {getEncryptionKey, pEncryptFile} from "./backup-crypto.mjs";
import {getPgEnv} from "./pg-env.mjs";
import {pRecordOperationalEvidence} from "./operations-evidence.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const target = process.argv[2];
if (!target) throw new Error(`Usage: npm run hub:backup:encrypted -- <output.dump.enc>`);
const resolvedTarget = path.resolve(target);
if (fs.existsSync(resolvedTarget)) throw new Error(`Backup target already exists: ${resolvedTarget}`);
fs.mkdirSync(path.dirname(resolvedTarget), {recursive: true});

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-backup-"));
const dump = path.join(tempDir, "hub.dump");
const startedAt = new Date();
try {
	const result = spawnSync("pg_dump", [
		"--format=custom",
		"--no-owner",
		"--no-privileges",
		`--file=${dump}`,
	], {stdio: "inherit", env: getPgEnv({databaseUrl})});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`pg_dump exited with status ${result.status}.`);
	const evidence = await pEncryptFile({source: dump, target: resolvedTarget, key: getEncryptionKey()});
	const output = {
		createdAt: new Date().toISOString(),
		filename: path.basename(resolvedTarget),
		...evidence,
	};
	pRecordOperationalEvidence({
		jobType: "backup",
		status: "succeeded",
		startedAt,
		details: output,
	});
	process.stdout.write(`${JSON.stringify({...output, target: resolvedTarget}, null, 2)}\n`);
} catch (error) {
	try {
		pRecordOperationalEvidence({
			jobType: "backup",
			status: "failed",
			startedAt,
			details: {errorCode: `${error.code || error.name || "ERROR"}`.slice(0, 100)},
		});
	} catch (evidenceError) {
		process.stderr.write(`Campaign Hub failed to record backup failure evidence: ${evidenceError.code || evidenceError.name || "ERROR"}\n`);
	}
	throw error;
} finally {
	fs.rmSync(tempDir, {recursive: true, force: true});
}
