/**
 * Bug 1 — Metamagic hover showed the sorcery-point cost twice.
 *
 * Root cause: every TGTT metamagic optional feature (`featureType` includes
 * "MM") carried BOTH a `consumes: {name: "Sorcery Points", amount: 1}` block —
 * rendered by the optional-feature renderer as a leading (and usually wrong,
 * because `amount` was hardcoded to 1) "Cost: 1 Sorcery Points" line — AND a
 * hand-authored inline first entry `{@italic Cost: <n> sorcery point …}` with
 * the correct, variable cost.
 *
 * Fix (data, root-cause): drop the redundant `consumes` block from every MM
 * optional feature so only the correct inline cost remains. `consumes` cannot
 * express variable costs ("spell level", "half your level") and the character
 * sheet derives the dashboard cost from `TGTT_METAMAGIC[*].cost`, not from
 * `consumes`, so the block was functionally dead for metamagics.
 *
 * These assertions read the homebrew file directly (mirroring the scribing
 * tests) and verify computed structure, not rendered text.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const BREW = JSON.parse(readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8"));

const getMetamagics = () => (BREW.optionalfeature || []).filter(o => (o.featureType || []).includes("MM"));

describe("Bug 1 — TGTT metamagic cost is single-sourced (inline only)", () => {
	test("there are metamagic optional features to check", () => {
		expect(getMetamagics().length).toBeGreaterThan(0);
	});

	test("no metamagic optional feature carries a Sorcery Points `consumes` block", () => {
		const offenders = getMetamagics().filter(o => o.consumes?.name === "Sorcery Points");
		expect(offenders.map(o => o.name)).toEqual([]);
	});

	test("no metamagic optional feature carries ANY `consumes` block", () => {
		const offenders = getMetamagics().filter(o => o.consumes != null);
		expect(offenders.map(o => o.name)).toEqual([]);
	});

	test("every metamagic still declares its cost via the inline first entry", () => {
		const missing = getMetamagics().filter(o => {
			const first = o.entries?.[0];
			return !(typeof first === "string" && /^\{@(i|italic)\s+Cost:/.test(first.trim()));
		});
		expect(missing.map(o => o.name)).toEqual([]);
	});

	test("non-metamagic optional features keep their `consumes` blocks (regression guard)", () => {
		// The fix must be surgical: only MM features lost `consumes`. Combat methods
		// and similar features that consume Stamina / other resources must be intact.
		const nonMmWithConsumes = (BREW.optionalfeature || [])
			.filter(o => !(o.featureType || []).includes("MM"))
			.filter(o => o.consumes != null);
		expect(nonMmWithConsumes.length).toBeGreaterThan(0);
		// And none of those is a Sorcery Points consumer (those were the duplicates).
		expect(nonMmWithConsumes.every(o => o.consumes.name !== "Sorcery Points")).toBe(true);
	});
});
