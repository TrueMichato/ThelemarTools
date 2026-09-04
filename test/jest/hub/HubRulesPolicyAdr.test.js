import fs from "node:fs";

const adr = fs.readFileSync(
	new URL("../../../docs/hub/adr/0015-campaign-rules-policy.md", import.meta.url),
	"utf8",
);

describe("Campaign Hub rules-policy ADR contract", () => {
	it("distinguishes implemented content enforcement from separate non-content rules", () => {
		expect(adr).toMatch(/^Status: Accepted; source\/species\/edition policy implemented, non-content enforcement remains separate$/m);
		expect(adr).toContain("The source, species, and edition entries are enforced");
		expect(adr).toContain("remaining catalog entries are");
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

	it("treats every newly introduced item identity as a governed delta across routes", () => {
		expect(adr).toContain("Introducing a new item identity is a governed delta.");
		for (const route of [
			"direct character document patches",
			"DM grants/awards",
			"accepted transfers into characters",
			"import adjuncts",
		]) expect(adr).toContain(route);
		expect(adr).toMatch(/stale or\s+bypassed\s+clients/);
		expect(adr).toContain("must satisfy the current source/edition policy");
	});

	it("allows routine admitted-item changes without trusting mutable provenance", () => {
		expect(adr).toContain("Changing quantity, equipped/attuned state, or container placement for an already-admitted identity may remain");
		expect(adr).toContain("canonical `kind + uid` multiplicity");
		expect(adr).toContain("mutable provenance fields cannot create a");
		expect(adr).toContain("does not launder a grandfathered identity");
	});

	it("pins and rechecks item policy transactionally with atomic batches", () => {
		expect(adr).toContain("cannot rely on picker or catalog filtering");
		expect(adr).toContain("transaction pins/rechecks the active rules version");
		expect(adr).toContain("returns `RULES_VERSION_STALE` before destination inventory state changes");
		expect(adr).toContain("Batch grants/awards and");
		expect(adr).toContain("multi-item transfers are all-or-none");
		expect(adr).toContain("no subset of item identities is added");
	});

	it("defines browser/server parity and keeps TGTT calculations in CharacterSheetState", () => {
		expect(adr).toContain("The evaluator is a pure, data-only module usable by browser and server.");
		expect(adr).toContain("The server is authoritative for Hub writes.");
		expect(adr).toContain("Browser and server run the same rule fixtures as golden contract vectors.");
		expect(adr).toContain("TGTT calculations remain in `CharacterSheetState`");
	});

	it.each([
		"version",
		"rulesVersionId",
		"total",
		"findings",
		"isTruncated",
	])("includes compliance-report field %s", field => {
		expect(adr).toMatch(new RegExp(`"${field}"\\s*:`));
	});

	it("pins versions, fences stale policy writes, and defines non-destructive rollback", () => {
		expect(adr).toContain("campaignId + rulesVersion.id + rulesVersion.version + rulesVersion.schemaVersion + catalogVersion");
		expect(adr).toContain("`RULES_VERSION_STALE`");
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

	it("requires cross-route inventory parity in the acceptance gates", () => {
		expect(adr).toMatch(/AG-03[\s\S]*direct patch, grant\/award, transfer, and party-stash projections/);
		expect(adr).toMatch(/AG-07[\s\S]*cross-route parity covers direct character\s+patch, DM grant\/award, transfer, and stash flows/);
		expect(adr).toContain("including all-or-none multi-item batches");
	});
});
