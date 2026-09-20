import {parseOperatorAccountIds} from "../src/account-entitlements.js";
import {PostgresHubStore} from "../src/postgres-hub-store.js";

function requireEnv (name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

const isEntitlementsEnabled = process.env.HUB_ACCOUNT_ENTITLEMENTS_ENABLED === "true";
const isInviteAdmissionEnabled = process.env.HUB_INVITE_ACCOUNT_ADMISSION_ENABLED === "true";
const operatorAccountIds = parseOperatorAccountIds(process.env.HUB_OPERATOR_ACCOUNT_IDS);

if (isInviteAdmissionEnabled && !isEntitlementsEnabled) {
	process.stderr.write("Account entitlement rollout preflight failed (INVITE_ADMISSION_REQUIRES_ENTITLEMENTS).\n");
	process.exit(2);
}

if (!isEntitlementsEnabled) {
	process.stdout.write("Account entitlement rollout is disabled.\n");
	process.exit(0);
}

const store = PostgresHubStore.fromConnectionString({
	connectionString: requireEnv("DATABASE_URL"),
	ssl: process.env.HUB_DATABASE_SSL === "false" ? false : {rejectUnauthorized: true},
	isAccountEntitlementsEnabled: true,
});

try {
	const result = await store.pReconcileConfiguredOperatorEntitlements({
		accountIds: operatorAccountIds,
	});
	if (!await store.pHasActivePlatformOperator()) {
		process.stderr.write("Account entitlement rollout preflight failed (ACTIVE_OPERATOR_REQUIRED).\n");
		process.exitCode = 2;
	} else if (result.warnings.length) {
		process.stderr.write(`Account entitlement rollout preflight failed (${result.warnings.length} configured operator account(s) unavailable).\n`);
		process.exitCode = 2;
	} else {
		process.stdout.write(`Account entitlement rollout preflight passed; ${result.granted.length} entitlement grant(s) added.\n`);
	}
} catch {
	process.stderr.write("Account entitlement rollout preflight failed (DATABASE_CHECK_FAILED).\n");
	process.exitCode = 2;
} finally {
	await store.pClose();
}
