/**
 * Regression guard for "spell selection at level-up is optional" (bugs.md).
 *
 * The level-up wizard renders three optional spell sections (Wizard Spellbook,
 * Spells/Cantrips Known, Prepared Spells). All three are flagged
 * `required: false`, but the apply handler used to pop a "Skip Spell
 * Selection?" confirmation dialog whenever any pool was under-filled, making
 * spell selection feel mandatory. Per the desired UX, partial / empty spell
 * selections should silently apply — the player finishes on the Spells tab.
 *
 * Spinning the full level-up UI up in jsdom is impractical, so this spec
 * pins the contract via the levelup module's source text:
 *   1. The "Skip Spell Selection?" confirmation dialog must not exist.
 *   2. The three spell accordions must carry an "(optional)" hint in their
 *      titles.
 *   3. The three spell accordions must remain `required: false`.
 *
 * If a future change reintroduces the gating modal it will fail here, prompting
 * a deliberate decision rather than a silent regression.
 */

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEVELUP_PATH = resolve(__dirname, "../../../js/charactersheet/charactersheet-levelup.js");
const BUILDER_PATH = resolve(__dirname, "../../../js/charactersheet/charactersheet-builder.js");
const QUICKBUILD_PATH = resolve(__dirname, "../../../js/charactersheet/charactersheet-quickbuild.js");
const source = readFileSync(LEVELUP_PATH, "utf8");
const builderSource = readFileSync(BUILDER_PATH, "utf8");
const quickbuildSource = readFileSync(QUICKBUILD_PATH, "utf8");

describe("Level-up — spell selection is optional", () => {
	test("does not pop a 'Skip Spell Selection?' confirmation dialog", () => {
		expect(source).not.toMatch(/Skip Spell Selection\?/);
	});

	test("does not collect a spellMissing array for a pre-apply confirmation", () => {
		// The previous gating used `const spellMissing = [];` followed by a
		// pGetUserBoolean call. Both are gone.
		expect(source).not.toMatch(/const\s+spellMissing\s*=/);
	});

	test("Wizard Spellbook accordion title is tagged optional and is not required", () => {
		expect(source).toMatch(/Spellbook \(\+\$\{wizardSpellCount\} Spells, optional\)/);
		// Find the createAccordion call for "spellbook" and verify required: false.
		const m = source.match(/createAccordion\("spellbook"[\s\S]*?\{required:\s*(true|false)\}/);
		expect(m).not.toBeNull();
		expect(m[1]).toBe("false");
	});

	test("Known Spells accordion title is tagged optional and is not required", () => {
		expect(source).toMatch(/Spells Known \(\$\{sectionLabel\.join\(", "\)\}, optional\)/);
		const m = source.match(/createAccordion\("knownspells"[\s\S]*?\{required:\s*(true|false)\}/);
		expect(m).not.toBeNull();
		expect(m[1]).toBe("false");
	});

	test("Prepared Spells accordion title is tagged optional and is not required", () => {
		expect(source).toMatch(/Prepared Spells \(\$\{sectionLabel\.join\(", "\)\}, optional\)/);
		const m = source.match(/createAccordion\("preparedspells"[\s\S]*?\{required:\s*(true|false)\}/);
		expect(m).not.toBeNull();
		expect(m[1]).toBe("false");
	});

	test("spell-section onSelect handlers report complete=true regardless of pick count", () => {
		// All three onSelect callbacks should call setStatus(true, …) and
		// setComplete(true, …) — not the previous `complete = picked >= gain`.
		// We assert there are no remaining `setComplete(complete, ...)` calls
		// inside the spell sections; previously each spell onSelect emitted one.
		// (Other accordions still legitimately compute `complete`, so we look
		// for the specific pattern that used to live in the spell handlers.)
		expect(source).not.toMatch(/spellComplete\s*&&\s*cantripComplete/);
		// Each spell accordion id should appear next to a `setComplete(true,`.
		for (const id of ["spellbook", "knownspells", "preparedspells"]) {
			const re = new RegExp(`accordions\\.${id}\\.setComplete\\(true,`);
			expect(source).toMatch(re);
		}
	});
});

describe("Builder & QuickBuild — spell selection is optional", () => {
	test("Builder does not pop a 'Skip Spell Selection?' confirmation", () => {
		expect(builderSource).not.toMatch(/Skip Spell Selection\?/);
	});

	test("QuickBuild does not nag with a spell-incomplete warning toast", () => {
		// _validateSpellsStep used to emit a JqueryUtil.doToast warning when any
		// spell pool was short. The contract now is silent: pick what you want,
		// finish later on the Spells tab.
		expect(quickbuildSource).not.toMatch(/Spell selection incomplete/);
	});

	test("QuickBuild _validateSpellsStep returns true unconditionally", () => {
		// The function body should now be effectively `return true;` — no early
		// returns based on selection counts.
		const m = quickbuildSource.match(/_validateSpellsStep\s*\([^)]*\)\s*\{([\s\S]*?)\n\t\}/);
		expect(m).not.toBeNull();
		const body = m[1];
		// No JqueryUtil.doToast or pGetUserBoolean inside.
		expect(body).not.toMatch(/JqueryUtil\.doToast/);
		expect(body).not.toMatch(/pGetUserBoolean/);
		// Must end in `return true;`.
		expect(body).toMatch(/return true;\s*$/);
	});
});
