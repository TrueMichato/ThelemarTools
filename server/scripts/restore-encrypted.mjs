import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {getEncryptionKey, pDecryptFile, pGetFileEvidence} from "./backup-crypto.mjs";
import {getPgEnv} from "./pg-env.mjs";
import {pRecordOperationalEvidence} from "./operations-evidence.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
if (process.env.HUB_RESTORE_CONFIRM !== "RESTORE") {
	throw new Error(`Set HUB_RESTORE_CONFIRM=RESTORE to confirm destructive restore.`);
}
const source = process.argv[2];
if (!source) throw new Error(`Usage: npm run hub:restore:encrypted -- <input.dump.enc>`);
const resolvedSource = path.resolve(source);
if (!fs.existsSync(resolvedSource)) throw new Error(`Backup does not exist: ${resolvedSource}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-restore-"));
const dump = path.join(tempDir, "hub.dump");
const startedAt = new Date();
try {
	await pDecryptFile({source: resolvedSource, target: dump, key: getEncryptionKey()});
	const pgEnv = getPgEnv({databaseUrl});
	const result = spawnSync("pg_restore", [
		"--clean",
		"--if-exists",
		"--single-transaction",
		"--no-owner",
		"--no-privileges",
		`--dbname=${pgEnv.PGDATABASE}`,
		dump,
	], {stdio: "inherit", env: pgEnv});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`pg_restore exited with status ${result.status}.`);
	const output = {
		restoredAt: new Date().toISOString(),
		filename: path.basename(resolvedSource),
		durationSeconds: (Date.now() - startedAt.getTime()) / 1000,
		...(await pGetFileEvidence(resolvedSource)),
	};
	pRecordOperationalEvidence({
		jobType: "restore_drill",
		status: "succeeded",
		startedAt,
		details: output,
	});
	process.stdout.write(`${JSON.stringify({...output, source: resolvedSource}, null, 2)}\n`);
} catch (error) {
	try {
		pRecordOperationalEvidence({
			jobType: "restore_drill",
			status: "failed",
			startedAt,
			details: {errorCode: `${error.code || error.name || "ERROR"}`.slice(0, 100)},
		});
	} catch (evidenceError) {
		process.stderr.write(`Campaign Hub failed to record restore failure evidence: ${evidenceError.code || evidenceError.name || "ERROR"}\n`);
	}
	throw error;
} finally {
	fs.rmSync(tempDir, {recursive: true, force: true});
}
