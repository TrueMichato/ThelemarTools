import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {assertCampaignRuleWriteFence} from "../../../server/src/campaign-rule-authority.js";
import {createDefaultCampaignRulesPolicy} from "../../../js/hub/hub-campaign-rules.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function rulesVersion () {
	return {
		id: "rules-current",
		version: 4,
		schemaVersion: 2,
		catalogVersion: 1,
		rules: createDefaultCampaignRulesPolicy(),
	};
}

function characterData (rulesVersionId) {
	return {
		settings: {enableTgtt: true},
		carry: {
			schemaVersion: 1,
			basis: {
				kind: "campaign",
				rulesVersionId,
				brewBundleHash: null,
				settingsDigest: "digest",
			},
		},
	};
}

describe("campaign rule write authority", () => {
	it("accepts the active immutable policy identity", () => {
		expect(assertCampaignRuleWriteFence({
			rulesVersion: rulesVersion(),
			data: characterData("rules-current"),
		})).toMatchObject({
			status: "compliant",
			policyIdentity: {id: "rules-current", version: 4},
		});
	});

	it("rejects a stale policy identity before a write can commit", () => {
		expect(() => assertCampaignRuleWriteFence({
			rulesVersion: rulesVersion(),
			data: characterData("rules-old"),
		})).toThrow(expect.objectContaining({
			code: "POLICY_VERSION_STALE",
			status: 409,
		}));
	});

	it("keeps legacy clients compatible when no schema-v2 policy-sensitive carry write exists", () => {
		expect(assertCampaignRuleWriteFence({
			rulesVersion: {...rulesVersion(), schemaVersion: 1, rules: {enableTgtt: false}},
			data: {settings: {enableTgtt: true}},
		})).toBeNull();
	});

	it("uses the same authority helper in memory and PostgreSQL transactions", () => {
		for (const file of ["server/src/memory-hub-store.js", "server/src/postgres-hub-store.js"]) {
			const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
			expect(source).toContain("assertCampaignRuleWriteFence({");
		}
	});
});
