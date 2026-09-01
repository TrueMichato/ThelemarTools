import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const DOCS_ROOT = fileURLToPath(new URL("../../../docs/hub/", import.meta.url));

function getMarkdownFiles (dir = DOCS_ROOT) {
	return fs.readdirSync(dir, {withFileTypes: true})
		.flatMap(entry => {
			const absolute = path.join(dir, entry.name);
			if (entry.isDirectory()) return getMarkdownFiles(absolute);
			return entry.name.endsWith(".md") ? [absolute] : [];
		});
}

describe("Campaign Hub documentation contract", () => {
	const required = [
		"README.md",
		"current-system.md",
		"architecture.md",
		"domain-model.md",
		"api-reference.md",
		"realtime-protocol.md",
		"event-catalog.md",
		"data-lifecycle.md",
		"deployment.md",
		"migrations.md",
		"observability.md",
		"implementation-history.md",
		"checkpoint.md",
		"traceability.md",
		"risk-register.md",
		"testing.md",
		"ci-and-provenance.md",
		"contributing.md",
		"staging-plan.md",
		"provider-comparison.md",
		"private-v1-roadmap.md",
		"troubleshooting.md",
		"post-v1-roadmap.md",
		"runbooks/README.md",
	];

	it("contains and indexes every required handoff document", () => {
		const index = fs.readFileSync(path.join(DOCS_ROOT, "README.md"), "utf8");
		for (const relative of required) {
			expect(fs.existsSync(path.join(DOCS_ROOT, relative))).toBe(true);
			if (relative !== "README.md") expect(index).toContain(`(${relative})`);
		}
	});

	it("keeps ADR numbering contiguous, records status, and indexes every ADR", () => {
		const adrDir = path.join(DOCS_ROOT, "adr");
		const adrs = fs.readdirSync(adrDir).filter(name => /^\d{4}-.+\.md$/.test(name)).sort();
		expect(adrs.length).toBeGreaterThanOrEqual(9);

		const numbers = adrs.map(name => Number(name.slice(0, 4)));
		expect(numbers).toEqual(numbers.map((_, ix) => ix + 1));

		const index = fs.readFileSync(path.join(DOCS_ROOT, "README.md"), "utf8");
		for (const adr of adrs) {
			const markdown = fs.readFileSync(path.join(adrDir, adr), "utf8");
			expect(markdown).toMatch(/^Status:/m);
			expect(index).toContain(`(adr/${adr})`);
		}
	});

	it("locks the authorization-scoped projection and privacy decision", () => {
		const markdown = fs.readFileSync(
			path.join(DOCS_ROOT, "adr/0011-authorization-scoped-character-projections.md"),
			"utf8",
		);

		for (const anchor of [
			"server/src/projections.js",
			"server/src/realtime.js",
			"js/dmscreen/dmscreen-hub-controller.js",
			"Owner truth",
			"DM truth",
			"Peer profile",
			"recipient-independent",
			"character.projection.invalidated",
			"metadata-only",
			"authorization-scoped",
			"HTTP fetch",
			"editable owner Character Sheet must never",
			"{\"projectionRevision\": 4}",
			"carries no projected character",
			"PROJECTION_POLICY_INVALID",
			"Implementation: Contract only.",
		]) expect(markdown).toContain(anchor);

		for (const mode of ["`share`", "`hide`", "`replace`"]) expect(markdown).toContain(mode);
		for (const preset of ["`table`", "`minimal`", "`open`", "`private`"]) expect(markdown).toContain(preset);
		for (const field of [
			"`identity`",
			"`species`",
			"`classes`",
			"`abilities`",
			"`saves`",
			"`skills`",
			"`ac`",
			"`hp`",
			"`speed`",
			"`senses`",
			"`conditions`",
			"`diseases`",
			"`exhaustion`",
			"`inventorySummary`",
			"`carrySummary`",
		]) expect(markdown).toContain(field);

		for (const boundary of [
			"**HTTP:**",
			"**WebSocket:**",
			"**Activity log:**",
			"**Party Tracker:**",
			"**Targeting:**",
			"**Inventory and carry:**",
		]) expect(markdown).toContain(boundary);
	});

	it("locks the semantic-operation identity, approval, and rebase decision", () => {
		const markdown = fs.readFileSync(
			path.join(DOCS_ROOT, "adr/0012-idempotent-semantic-character-operations.md"),
			"utf8",
		);

		for (const anchor of [
			"server/src/hub-actions.js",
			"js/hub/hub-http-character-repository.js",
			"CharacterSheet._saveCurrentCharacter()",
			"`commandId`",
			"`operationId`",
			"`eventId`",
			"`IDEMPOTENCY_KEY_REUSED`",
			"`hp.damage`",
			"`hp.heal`",
			"`condition.add`",
			"`condition.remove`",
			"`spell_slot.spend`",
			"`spell_slot.restore`",
			"R = E(B)",
			"F = E(L)",
			"diff(R, F)",
			"DM/co-DM operation",
			"peer operation always enters `proposed`",
			"`LEASE_FENCED`",
			"`CHARACTER_CONFLICT`",
			"`CHARACTER_LIVE_CONFLICT`",
			"replay watermark",
			"revocation",
			"post-clamp effective delta",
			"bounded, non-null expiry",
			"Implementation: Contract only.",
		]) expect(markdown).toContain(anchor);
	});

	it("does not contain broken relative Markdown links", () => {
		for (const file of getMarkdownFiles()) {
			const markdown = fs.readFileSync(file, "utf8");
			for (const match of markdown.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
				const target = match[1].split("#")[0];
				if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
				expect(fs.existsSync(path.resolve(path.dirname(file), decodeURIComponent(target)))).toBe(true);
			}
		}
	});

	it("keeps session-private paths out of repository documentation", () => {
		for (const file of getMarkdownFiles()) {
			expect(fs.readFileSync(file, "utf8")).not.toContain(".copilot/session-state");
		}
	});
});
