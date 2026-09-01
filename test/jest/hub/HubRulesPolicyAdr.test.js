import fs from "node:fs";

const adr = fs.readFileSync(
	new URL("../../../docs/hub/adr/0015-campaign-rules-policy.md", import.meta.url),
	"utf8",
);

describe("Campaign Hub rules-policy ADR contract", () => {
	it("is explicitly a target contract rather than implementation evidence", () => {
		expect(adr).toMatch(/^Status: Accepted as the target contract; rules engine not implemented$/m);
		expect(adr).toContain("The catalog entries introduced by this ADR remain `planned`");
		expect(adr).toContain("This ADR defines that contract. It does not add a rules evaluator");
	});

	it.each([
		"id",
		"schemaVersion",
		"title",
		"explanation",
		"parameters",
		"supportedSurfaces",
		"implementationStatus",
		"compatibility",
	])("requires the catalog field %s", field => {
		expect(adr).toMatch(new RegExp(`\\| \`${field}\` \\|`));
	});

	it.each([
		"content.sources.allowed",
		"content.species.allowed",
		"content.editions.allowed",
		"tgtt.enabled",
		"rules.exhaustion.system",
		"tgtt.carry-weight",
		"tgtt.jumping",
		"tgtt.linguistics-bonus",
		"tgtt.critical-rolls",
	])("reserves the stable rule ID %s", ruleId => {
		expect(adr).toContain(`\`${ruleId}\``);
	});

	it("separates enforcement status from informational notes", () => {
		expect(adr).toContain("A rule may be displayed as **Enforced** only when");
		expect(adr).toContain("Notes use the separate policy `notes` collection");
		expect(adr).toContain("can never produce a violation");
	});

	it("grandfathers existing characters without weakening new-choice checks", () => {
		expect(adr).toContain("Existing noncompliant characters remain playable and are visibly flagged.");
		expect(adr).toContain("Only choices introduced or replaced by the level-up must comply");
		expect(adr).toContain("Every choice introduced by the batch must comply");
		expect(adr).toContain("Content is never auto-removed.");
	});

	it("defines browser/server parity and keeps TGTT calculations in CharacterSheetState", () => {
		expect(adr).toContain("The evaluator is a pure, data-only module usable by browser and server.");
		expect(adr).toContain("The server is authoritative for Hub writes.");
		expect(adr).toContain("Browser and server run the same rule fixtures as golden contract vectors.");
		expect(adr).toContain("TGTT calculations remain in `CharacterSheetState`");
	});

	it.each([
		"schemaVersion",
		"evaluatorVersion",
		"campaignId",
		"rulesVersion",
		"subject",
		"surface",
		"status",
		"blocking",
		"violations",
		"notes",
		"unknownRules",
		"inputFingerprint",
		"evaluatedAt",
	])("includes compliance-report field %s", field => {
		expect(adr).toMatch(new RegExp(`"${field}"\\s*:`));
	});

	it("pins versions, fences stale policy writes, and defines non-destructive rollback", () => {
		expect(adr).toContain("campaignId + rulesVersion.id + rulesVersion.version + rulesVersion.schemaVersion + catalogVersion");
		expect(adr).toContain("`POLICY_VERSION_STALE`");
		expect(adr).toContain("Rollback activates a previously stored immutable `rules_versions` row");
		expect(adr).toContain("never rewrites character data");
	});

	it("requires complete context teardown and all ten acceptance gates", () => {
		expect(adr).toContain("ADR 0013 owns the site-wide campaign-context activation and teardown lifecycle.");
		expect(adr).toContain("clear `HubBrewContext` temporary brew");
		expect(adr).toContain("clear the Character Sheet campaign settings projection");
		expect(adr).toMatch(/No campaign policy,\s+report, or brew-derived candidate may appear in another campaign/);
		for (let gate = 1; gate <= 10; ++gate) {
			expect(adr).toContain(`**AG-${String(gate).padStart(2, "0")}`);
		}
	});
});
