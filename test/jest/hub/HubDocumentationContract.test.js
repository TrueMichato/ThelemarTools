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
			expect(fs.readFileSync(path.join(adrDir, adr), "utf8")).toMatch(/^Status:/m);
			expect(index).toContain(`(adr/${adr})`);
		}
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
