const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const RESTORE_FAILURE_PHASES = new Set([
	"archive",
	"restore",
	"baseline",
	"test-harness",
	"workflows",
	"exact-release-return",
	"cleanup",
	"finalization",
]);
const SAFE_RESTORE_FAILURE_CODES = new Set([
	"ARCHIVE_SELECTION_FAILED",
	"ARCHIVE_HASH_MISMATCH",
	"DECRYPTION_FAILED",
	"RESTORE_FAILED",
	"MIGRATION_LEDGER_MISMATCH",
	"CONSTRAINT_VALIDATION_FAILED",
	"FIXTURE_COLLISION",
	"TEST_HARNESS_START_FAILED",
	"WORKFLOW_FAILED",
	"EXACT_RELEASE_RETURN_FAILED",
	"CLEANUP_FAILED",
	"FINALIZATION_FAILED",
	"OTHER_SAFE_FAILURE",
]);
const R11F_RELEASE_SOURCE_SHA = "4578c8671a7b05066fb9a19411cb8a31cdd753ef";
const R11F_BFF_IMAGE_ID = "sha256:7dc84ccefba2d58f6f0dc8fc3a47551d0ba8bcd75f847b9742a90cb769aac231";
const R11F_STATIC_IMAGE_ID = "sha256:6318106691636a821735b0b025478846d4fdce1827e5078ea4566dee6fdc3254";
export const R11F_MIGRATION_LEDGER_SHA256 = "336970aa629b4dbbdfe5bc001068d05a5a2b6e6fea8d5ba78c54bba1d0e3a747";

function getTimestamp (value, label) {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO timestamp.`);
	return timestamp;
}

function assert (condition, message) {
	if (!condition) throw new Error(message);
}

function validateSnapshot ({snapshot, phase, startedAt, minimumCapturedAt, maximumCapturedAt, migrationLedgerSha256}) {
	assert(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot), `${phase} restore snapshot is required.`);
	assert(snapshot.phase === phase && snapshot.status === "ready", `${phase} restore snapshot is invalid.`);
	assert(snapshot.protocolVersion === 5, `${phase} restore snapshot is not protocol 5.`);
	const capturedAt = getTimestamp(snapshot.capturedAt, `${phase} snapshot capturedAt`);
	assert(capturedAt >= startedAt && capturedAt >= minimumCapturedAt, `${phase} restore snapshot was captured out of order.`);
	assert(capturedAt <= maximumCapturedAt, `${phase} restore snapshot was captured after finalization.`);
	assert(
		JSON.stringify(snapshot.appliedMigrationVersions) === JSON.stringify(
			Array.from({length: 9}, (_, index) => `000${index + 1}`),
		),
		`${phase} restore snapshot is not exactly at migrations 0001-0009.`,
	);
	assert(Array.isArray(snapshot.pendingMigrationVersions) && snapshot.pendingMigrationVersions.length === 0, `${phase} restore snapshot has pending migrations.`);
	assert(snapshot.migrationLedgerSha256 === migrationLedgerSha256, `${phase} migration ledger does not match the source baseline.`);
	assert(Number.isInteger(snapshot.unvalidatedConstraintCount) && snapshot.unvalidatedConstraintCount === 0, `${phase} restore snapshot has unvalidated constraints.`);
	assert(snapshot.structuralCounts && typeof snapshot.structuralCounts === "object" && !Array.isArray(snapshot.structuralCounts), `${phase} structural counts are missing.`);
	const counts = snapshot.structuralCounts;
	for (const key of [
		"accounts",
		"campaigns",
		"memberships",
		"characters",
		"auditEntries",
		"domainEvents",
		"outboxEntries",
		"semanticOperations",
		"commandReceipts",
	]) {
		assert(Number.isSafeInteger(counts[key]) && counts[key] >= 0, `${phase} structural count ${key} is invalid.`);
	}
	return {capturedAt, counts};
}

export function validateCompletedRestoreDrill ({evidence, now = Date.now()}) {
	assert(evidence && typeof evidence === "object" && !Array.isArray(evidence), "Restore evidence must be an object.");
	assert(evidence.schemaVersion === 1, "Unsupported restore evidence schema.");
	assert(typeof evidence.drillId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(evidence.drillId), "Restore drill ID is invalid.");
	assert(typeof evidence.operator === "string" && evidence.operator.trim() && evidence.operator.length <= 100, "Restore operator is required.");

	const startedAt = getTimestamp(evidence.startedAt, "startedAt");
	const archiveCreatedAt = getTimestamp(evidence.archiveCreatedAt, "archiveCreatedAt");
	const restoreCompletedAt = getTimestamp(evidence.restoreCompletedAt, "restoreCompletedAt");
	const fixtureStartedAt = getTimestamp(evidence.fixtureStartedAt, "fixtureStartedAt");
	const workflowsCompletedAt = getTimestamp(evidence.workflowsCompletedAt, "workflowsCompletedAt");
	const testServicesStoppedAt = getTimestamp(evidence.testServicesStoppedAt, "testServicesStoppedAt");
	const exactReleaseReturnedAt = getTimestamp(evidence.exactReleaseReturnedAt, "exactReleaseReturnedAt");
	const cleanupCompletedAt = getTimestamp(evidence.cleanupCompletedAt, "cleanupCompletedAt");
	assert(startedAt <= now, "Restore drill start time is in the future.");
	assert(
		startedAt <= restoreCompletedAt
		&& restoreCompletedAt <= fixtureStartedAt
		&& fixtureStartedAt <= workflowsCompletedAt
		&& workflowsCompletedAt <= testServicesStoppedAt
		&& testServicesStoppedAt <= exactReleaseReturnedAt
		&& exactReleaseReturnedAt <= cleanupCompletedAt
		&& cleanupCompletedAt <= now,
		"Restore drill phase timestamps are not in order.",
	);
	const rpoMilliseconds = startedAt - archiveCreatedAt;
	assert(rpoMilliseconds >= 0 && rpoMilliseconds <= ONE_DAY_MS, "Restore archive is older than the 24-hour RPO.");
	const rpoSeconds = Math.ceil(rpoMilliseconds / 1000);
	const elapsedBeforeFinalizationMilliseconds = now - startedAt;
	assert(
		elapsedBeforeFinalizationMilliseconds >= 0 && elapsedBeforeFinalizationMilliseconds <= FOUR_HOURS_MS,
		"Restore drill has exhausted its continuous four-hour RTO budget.",
	);
	const elapsedBeforeFinalizationSeconds = Math.ceil(elapsedBeforeFinalizationMilliseconds / 1000);
	assert(Array.isArray(evidence.safeFailures) && evidence.safeFailures.length <= 100, "Safe restore failure records are required and must be bounded.");
	let previousFailureAt = startedAt;
	const safeFailures = evidence.safeFailures.map(failure => {
		assert(failure && typeof failure === "object" && !Array.isArray(failure), "Safe restore failure record is invalid.");
		assert(
			Object.keys(failure).sort().join(",") === "at,code,phase",
			"Safe restore failure record contains unsupported fields.",
		);
		assert(RESTORE_FAILURE_PHASES.has(failure.phase), "Safe restore failure phase is invalid.");
		assert(SAFE_RESTORE_FAILURE_CODES.has(failure.code), "Safe restore failure code is invalid.");
		const failedAt = getTimestamp(failure.at, "safe restore failure at");
		assert(failedAt >= previousFailureAt && failedAt <= now, "Safe restore failure timestamps are out of order.");
		previousFailureAt = failedAt;
		return {phase: failure.phase, code: failure.code, at: new Date(failedAt).toISOString()};
	});

	assert(typeof evidence.archiveFilename === "string" && /^hub-[A-Za-z0-9T._-]+\.dump\.enc$/.test(evidence.archiveFilename), "Restore archive filename is invalid.");
	assert(SHA256_PATTERN.test(evidence.archiveSha256), "Restore archive SHA-256 is invalid.");
	assert(SOURCE_SHA_PATTERN.test(evidence.releaseSourceSha), "Release source SHA is invalid.");
	assert(SOURCE_SHA_PATTERN.test(evidence.testHarnessSourceSha), "Test harness source SHA is invalid.");
	assert(SOURCE_SHA_PATTERN.test(evidence.evidenceFinalizerSourceSha), "Evidence finalizer source SHA is invalid.");
	assert(evidence.releaseSourceSha === R11F_RELEASE_SOURCE_SHA, "Restore validation is not pinned to exact r11f source.");
	assert(evidence.releaseSourceSha === evidence.testHarnessSourceSha, "Test harness does not match the released source.");
	assert(Number.isInteger(evidence.protocolVersion) && evidence.protocolVersion === 5, "Restore validation must use the exact r11f protocol.");
	assert(evidence.requiredMigrationVersion === "0009", "Restore validation must use the complete r11f migration set.");
	assert(
		JSON.stringify(evidence.appliedMigrationVersions) === JSON.stringify(
			Array.from({length: 9}, (_, index) => `000${index + 1}`),
		),
		"Restore migration ledger is not exactly r11f migrations 0001-0009.",
	);
	assert(Array.isArray(evidence.pendingMigrationVersions) && evidence.pendingMigrationVersions.length === 0, "Restore target has pending migrations.");
	assert(
		evidence.migrationLedgerSha256 === R11F_MIGRATION_LEDGER_SHA256,
		"Migration ledger filenames/checksums do not match the exact r11f source.",
	);

	const images = evidence.images;
	assert(images && typeof images === "object" && !Array.isArray(images), "Exact restore image IDs are required.");
	for (const name of ["bff", "static", "testHarness", "edge", "recoveryOperations"]) {
		assert(IMAGE_ID_PATTERN.test(images[name]), `Exact ${name} image ID is invalid.`);
	}
	assert(images.bff === R11F_BFF_IMAGE_ID, "Restore validation is not using the exact r11f BFF image.");
	assert(images.static === R11F_STATIC_IMAGE_ID, "Restore validation is not using the exact r11f static image.");
	assert(evidence.evidenceFinalizerImageId === images.recoveryOperations, "Evidence finalizer image does not match the reviewed recovery driver.");
	assert(evidence.evidenceFinalizerSourceSha === evidence.recoveryOperationsSourceSha, "Evidence finalizer source does not match the reviewed recovery driver.");
	assert(images.bffSourceSha === evidence.releaseSourceSha, "BFF image source does not match the release.");
	assert(images.testHarnessSourceSha === evidence.releaseSourceSha, "Test harness image source does not match the release.");
	assert(SOURCE_SHA_PATTERN.test(evidence.recoveryOperationsSourceSha), "Recovery operations source SHA is invalid.");
	assert(images.recoveryOperationsSourceSha === evidence.recoveryOperationsSourceSha, "Recovery operations image source does not match its pinned source.");

	assert(evidence.fixtureMode === "new-synthetic", "Restore workflows must use new synthetic fixtures.");
	assert(evidence.fixtureCollisionChecked === true && evidence.fixtureCollision === false, "Synthetic fixture collision check did not pass.");
	assert(evidence.exactVersionImages === true, "Restore validation did not use the exact release images.");
	assert(evidence.authHarnessUnmodified === true, "Exact-version authentication harness must remain unchanged.");
	assert(evidence.restoredAccountContinuity === false && evidence.realProviderContinuity === false, "Open restored-account/provider continuity must remain explicitly unclaimed.");
	const baseline = validateSnapshot({
		snapshot: evidence.preFixtureBaseline,
		phase: "before",
		startedAt,
		minimumCapturedAt: restoreCompletedAt,
		maximumCapturedAt: fixtureStartedAt,
		migrationLedgerSha256: evidence.migrationLedgerSha256,
	});
	assert(baseline.capturedAt <= fixtureStartedAt, "Pre-fixture baseline was captured after test fixtures started.");
	assert(evidence.preFixtureBaseline.fixtureCollisionChecked === true && evidence.preFixtureBaseline.fixtureCollision === false, "Pre-fixture baseline did not prove fixed-fixture absence.");
	const after = validateSnapshot({
		snapshot: evidence.postFixtureSnapshot,
		phase: "after",
		startedAt,
		minimumCapturedAt: exactReleaseReturnedAt,
		maximumCapturedAt: cleanupCompletedAt,
		migrationLedgerSha256: evidence.migrationLedgerSha256,
	});
	const fixtureMutationCounts = Object.fromEntries(Object.keys(baseline.counts)
		.map(key => [key, after.counts[key] - baseline.counts[key]]));

	const requiredChecks = [
		"structural",
		"readiness",
		"authenticatedSession",
		"campaignReadWrite",
		"characterReadWrite",
		"inventoryInteraction",
		"crossCharacterEffect",
		"authorizationDenial",
		"returnToExactRelease",
		"testServicesStopped",
		"cleanup",
		"temporaryCredentialsRemoved",
	];
	assert(evidence.checks && typeof evidence.checks === "object", "Restore check results are required.");
	for (const check of requiredChecks) {
		assert(evidence.checks[check] === true, `Required restore check did not pass: ${check}.`);
	}

	return {
		drillId: evidence.drillId,
		operator: evidence.operator.trim(),
		startedAt: new Date(startedAt).toISOString(),
		archiveCreatedAt: new Date(archiveCreatedAt).toISOString(),
		restoreCompletedAt: new Date(restoreCompletedAt).toISOString(),
		fixtureStartedAt: new Date(fixtureStartedAt).toISOString(),
		workflowsCompletedAt: new Date(workflowsCompletedAt).toISOString(),
		testServicesStoppedAt: new Date(testServicesStoppedAt).toISOString(),
		exactReleaseReturnedAt: new Date(exactReleaseReturnedAt).toISOString(),
		cleanupCompletedAt: new Date(cleanupCompletedAt).toISOString(),
		archiveFilename: evidence.archiveFilename,
		archiveSha256: evidence.archiveSha256,
		releaseSourceSha: evidence.releaseSourceSha,
		evidenceFinalizerSourceSha: evidence.evidenceFinalizerSourceSha,
		evidenceFinalizerImageId: evidence.evidenceFinalizerImageId,
		recoveryOperationsSourceSha: evidence.recoveryOperationsSourceSha,
		protocolVersion: evidence.protocolVersion,
		requiredMigrationVersion: evidence.requiredMigrationVersion,
		appliedMigrationVersions: [...evidence.appliedMigrationVersions],
		images: {
			bff: images.bff,
			static: images.static,
			testHarness: images.testHarness,
			edge: images.edge,
			recoveryOperations: images.recoveryOperations,
		},
		migrationLedgerSha256: evidence.migrationLedgerSha256,
		safeFailures,
		fixtureMutationCounts,
		rpoSeconds,
		rpoMilliseconds,
		elapsedBeforeFinalizationSeconds,
		elapsedBeforeFinalizationMilliseconds,
		completedAt: new Date(now).toISOString(),
	};
}

export function getRestoreDrillCompletionMetrics ({startedAt, completedAt}) {
	const start = getTimestamp(startedAt, "startedAt");
	const end = getTimestamp(completedAt, "completedAt");
	const rtoMilliseconds = end - start;
	assert(rtoMilliseconds >= 0 && rtoMilliseconds <= FOUR_HOURS_MS, "Continuous restore drill RTO exceeded four hours.");
	const rtoSeconds = Math.ceil(rtoMilliseconds / 1000);
	return {rtoSeconds};
}
