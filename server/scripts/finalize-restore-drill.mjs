import crypto from "node:crypto";
import fs from "node:fs";
import {pRecordOperationalEvidence} from "./operations-evidence.mjs";
import {getRestoreDrillCompletionMetrics, validateCompletedRestoreDrill} from "../src/recovery-evidence.js";

const evidencePath = process.argv[2];
const mode = process.argv[3];
if (!evidencePath || !["--private-only", "--record-operational"].includes(mode)
	|| (mode === "--record-operational" && (process.argv[4] !== "COMPLETE" || !process.argv[5] || process.argv.length !== 6))
	|| (mode === "--private-only" && process.argv.length !== 4)) {
	throw new Error(`Usage: node server/scripts/finalize-restore-drill.mjs <mode-0600-evidence.json> --private-only | --record-operational COMPLETE <mode-0600-private-summary.json>`);
}

const fileStat = fs.lstatSync(evidencePath);
if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o777) !== 0o600) {
	throw new Error(`Restore evidence must be a regular, non-symlink mode-0600 file.`);
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const evidenceSha256 = crypto.createHash("sha256").update(fs.readFileSync(evidencePath)).digest("hex");
let privateReceipt;
if (mode === "--record-operational") {
	const receiptPath = process.argv[5];
	const receiptStat = fs.lstatSync(receiptPath);
	if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || (receiptStat.mode & 0o777) !== 0o600) {
		throw new Error(`Private restore summary must be a regular, non-symlink mode-0600 file.`);
	}
	privateReceipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
	if (
		privateReceipt.status !== "private-evidence-finalized"
		|| privateReceipt.evidenceSha256 !== evidenceSha256
		|| typeof privateReceipt.operationalRunId !== "string"
		|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(privateReceipt.operationalRunId)
		|| !Number.isFinite(Date.parse(privateReceipt.completedAt))
	) {
		throw new Error(`Private restore summary does not bind this evidence file.`);
	}
}
const validated = validateCompletedRestoreDrill({
	evidence,
	...(privateReceipt ? {now: Date.parse(privateReceipt.completedAt)} : {}),
});
if (privateReceipt && privateReceipt.drillId !== validated.drillId) {
	throw new Error(`Private restore summary identifies a different drill.`);
}
const {rtoSeconds} = getRestoreDrillCompletionMetrics({
	startedAt: validated.startedAt,
	completedAt: validated.completedAt,
});
if (privateReceipt && (
	privateReceipt.rtoSeconds !== rtoSeconds
	|| privateReceipt.rpoSeconds !== validated.rpoSeconds
)) {
	throw new Error(`Private restore summary metrics do not match the validated evidence.`);
}
const details = {
	drillId: validated.drillId,
	operator: validated.operator,
	startedAt: validated.startedAt,
	archiveCreatedAt: validated.archiveCreatedAt,
	archiveFilename: validated.archiveFilename,
	archiveSha256: validated.archiveSha256,
	restoreCompletedAt: validated.restoreCompletedAt,
	fixtureStartedAt: validated.fixtureStartedAt,
	workflowsCompletedAt: validated.workflowsCompletedAt,
	testServicesStoppedAt: validated.testServicesStoppedAt,
	exactReleaseReturnedAt: validated.exactReleaseReturnedAt,
	cleanupCompletedAt: validated.cleanupCompletedAt,
	releaseSourceSha: validated.releaseSourceSha,
	evidenceFinalizerSourceSha: validated.evidenceFinalizerSourceSha,
	evidenceFinalizerImageId: validated.evidenceFinalizerImageId,
	recoveryOperationsSourceSha: validated.recoveryOperationsSourceSha,
	protocolVersion: validated.protocolVersion,
	requiredMigrationVersion: validated.requiredMigrationVersion,
	appliedMigrationVersions: validated.appliedMigrationVersions,
	images: validated.images,
	migrationLedgerSha256: validated.migrationLedgerSha256,
	safeFailures: validated.safeFailures,
	fixtureMutationCounts: validated.fixtureMutationCounts,
	rpoSeconds: validated.rpoSeconds,
	rpoMilliseconds: validated.rpoMilliseconds,
	elapsedBeforeFinalizationSeconds: validated.elapsedBeforeFinalizationSeconds,
	elapsedBeforeFinalizationMilliseconds: validated.elapsedBeforeFinalizationMilliseconds,
	drillCompletedAt: validated.completedAt,
	privateEvidenceSha256: evidenceSha256,
	claim: "structural-restore-and-authenticated-new-synthetic-fixtures",
	restoredAccountContinuity: "open",
	realProviderContinuity: "open",
};
if (mode === "--private-only") {
	process.stdout.write(`${JSON.stringify({
		status: "private-evidence-finalized",
		drillId: validated.drillId,
		completedAt: validated.completedAt,
		operationalRunId: crypto.randomUUID(),
		evidenceSha256,
		rpoSeconds: validated.rpoSeconds,
		rtoSeconds,
		startedAt: details.startedAt,
		restoreCompletedAt: details.restoreCompletedAt,
		fixtureStartedAt: details.fixtureStartedAt,
		workflowsCompletedAt: details.workflowsCompletedAt,
		testServicesStoppedAt: details.testServicesStoppedAt,
		exactReleaseReturnedAt: details.exactReleaseReturnedAt,
		cleanupCompletedAt: details.cleanupCompletedAt,
		claim: details.claim,
		releaseSourceSha: details.releaseSourceSha,
		evidenceFinalizerSourceSha: details.evidenceFinalizerSourceSha,
		evidenceFinalizerImageId: details.evidenceFinalizerImageId,
		recoveryOperationsSourceSha: details.recoveryOperationsSourceSha,
		protocolVersion: details.protocolVersion,
		requiredMigrationVersion: details.requiredMigrationVersion,
		appliedMigrationVersions: details.appliedMigrationVersions,
		images: details.images,
		migrationLedgerSha256: details.migrationLedgerSha256,
		safeFailures: details.safeFailures,
		fixtureMutationCounts: details.fixtureMutationCounts,
		restoredAccountContinuity: details.restoredAccountContinuity,
		realProviderContinuity: details.realProviderContinuity,
	}, null, 2)}\n`);
} else {
	const acknowledgement = pRecordOperationalEvidence({
		jobType: "restore_drill",
		status: "succeeded",
		startedAt: new Date(validated.startedAt),
		completedAt: new Date(validated.completedAt),
		runId: privateReceipt.operationalRunId,
		details,
		maxDurationMs: 4 * 60 * 60 * 1_000,
		timeoutMs: 30_000,
	});

	process.stdout.write(`${JSON.stringify({
		status: "operational-evidence-acknowledged",
		drillId: validated.drillId,
		rpoSeconds: validated.rpoSeconds,
		rtoSeconds,
		drillCompletedAt: validated.completedAt,
		operationalRunId: acknowledgement.runId,
		acknowledgedAt: acknowledgement.acknowledgedAt.toISOString(),
		claim: details.claim,
		restoredAccountContinuity: details.restoredAccountContinuity,
		realProviderContinuity: details.realProviderContinuity,
	}, null, 2)}\n`);
}
