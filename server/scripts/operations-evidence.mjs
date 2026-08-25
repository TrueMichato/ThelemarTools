import {spawnSync} from "node:child_process";
import crypto from "node:crypto";
import {getPgEnv} from "./pg-env.mjs";

export function pRecordOperationalEvidence ({
	databaseUrl = process.env.HUB_OPERATIONS_DATABASE_URL,
	jobType,
	status,
	startedAt,
	details,
}) {
	if (!databaseUrl) throw new Error(`HUB_OPERATIONS_DATABASE_URL is required to record operational evidence.`);
	if (!["backup", "restore_drill"].includes(jobType)) throw new Error(`Unsupported operational job type.`);
	if (!["succeeded", "failed"].includes(status)) throw new Error(`Unsupported operational status.`);
	const result = spawnSync("psql", [
		"-v",
		"ON_ERROR_STOP=1",
		"-v", `run_id=${crypto.randomUUID()}`,
		"-v", `job_type=${jobType}`,
		"-v", `status=${status}`,
		"-v", `started_at=${startedAt.toISOString()}`,
		"-v", `details=${JSON.stringify(details)}`,
	], {
		input: `
			INSERT INTO hub.operational_runs (
				id, job_type, status, app_version, details, started_at, completed_at
			) VALUES (
				:'run_id'::uuid,
				:'job_type',
				:'status',
				NULL,
				:'details'::jsonb,
				:'started_at'::timestamptz,
				now()
			);
		`,
		stdio: ["pipe", "ignore", "inherit"],
		env: getPgEnv({databaseUrl}),
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Operational evidence psql exited with status ${result.status}.`);
}
