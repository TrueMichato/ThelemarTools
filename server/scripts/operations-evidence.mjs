import {spawnSync} from "node:child_process";
import crypto from "node:crypto";
import {getPgEnv} from "./pg-env.mjs";

export function pRecordOperationalEvidence ({
	databaseUrl = process.env.HUB_OPERATIONS_DATABASE_URL,
	jobType,
	status,
	startedAt,
	completedAt = new Date(),
	runId = crypto.randomUUID(),
	details,
	maxDurationMs,
	timeoutMs,
}) {
	if (!databaseUrl) throw new Error(`HUB_OPERATIONS_DATABASE_URL is required to record operational evidence.`);
	if (!["backup", "restore_drill"].includes(jobType)) throw new Error(`Unsupported operational job type.`);
	if (!["succeeded", "failed"].includes(status)) throw new Error(`Unsupported operational status.`);
	if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) throw new Error(`Operational start time is invalid.`);
	if (!(completedAt instanceof Date) || !Number.isFinite(completedAt.getTime())) throw new Error(`Operational completion time is invalid.`);
	if (typeof runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
		throw new Error(`Operational run ID is invalid.`);
	}
	if (maxDurationMs != null && (!Number.isSafeInteger(maxDurationMs) || maxDurationMs <= 0)) {
		throw new Error(`Operational evidence duration limit must be a positive whole number of milliseconds.`);
	}
	const result = spawnSync("psql", [
		"-v",
		"ON_ERROR_STOP=1",
		"-t",
		"-A",
		"-v", `run_id=${runId}`,
		"-v", `job_type=${jobType}`,
		"-v", `status=${status}`,
		"-v", `started_at=${startedAt.toISOString()}`,
		"-v", `completed_at=${completedAt.toISOString()}`,
		"-v", `details=${JSON.stringify(details)}`,
		"-v", `max_duration_ms=${maxDurationMs ?? ""}`,
	], {
		input: `
			WITH
			inserted AS (
				INSERT INTO hub.operational_runs (
					id, job_type, status, app_version, details, started_at, completed_at
				)
				SELECT
					:'run_id'::uuid,
					:'job_type',
					:'status',
					NULL,
					:'details'::jsonb,
					:'started_at'::timestamptz,
					:'completed_at'::timestamptz
				WHERE :'completed_at'::timestamptz <= clock_timestamp()
					AND (
						NULLIF(:'max_duration_ms', '') IS NULL
						OR :'completed_at'::timestamptz <= (
							:'started_at'::timestamptz
							+ NULLIF(:'max_duration_ms', '')::bigint * interval '1 millisecond'
						)
					)
				ON CONFLICT (id) DO NOTHING
				RETURNING id, job_type, status, started_at, completed_at, details
			),
			matched AS (
				SELECT id, job_type, status, started_at, completed_at, details FROM inserted
				UNION ALL
				SELECT id, job_type, status, started_at, completed_at, details
				FROM hub.operational_runs
				WHERE id = :'run_id'::uuid
					AND job_type = :'job_type'
					AND status = :'status'
					AND started_at = :'started_at'::timestamptz
					AND completed_at = :'completed_at'::timestamptz
					AND details = :'details'::jsonb
			)
			SELECT json_build_object('runId', id::text, 'completedAt', completed_at)::text
			FROM matched;
		`,
		stdio: ["pipe", "pipe", "inherit"],
		env: getPgEnv({databaseUrl}),
		...(timeoutMs == null ? {} : {timeout: timeoutMs}),
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Operational evidence psql exited with status ${result.status}.`);
	const response = result.stdout.toString("utf8").trim();
	if (!response) throw new Error(`Operational evidence was not acknowledged or did not match the completion receipt.`);
	let acknowledgement;
	try {
		acknowledgement = JSON.parse(response);
	} catch {
		throw new Error(`Operational evidence returned an invalid acknowledgement.`);
	}
	if (acknowledgement.runId !== runId || Date.parse(acknowledgement.completedAt) !== completedAt.getTime()) {
		throw new Error(`Operational evidence acknowledgement did not match the completion receipt.`);
	}
	return {runId, completedAt, acknowledgedAt: new Date()};
}
