/**
 * Regression guard for level-up modal argument threading.
 *
 * Symptom (pre-fix): _doLevelUp computed `fullSubclassData` locally but did
 * NOT pass it to `_pShowLevelUpModal`, while a later code path inside the
 * modal referenced `fullSubclassData` directly. This crashed every single
 * single-class level-up with `ReferenceError: fullSubclassData is not defined`
 * (charactersheet-levelup.js:701).
 *
 * Fix:
 *   1. `_doLevelUp` must include `fullSubclassData` in the args object it
 *      passes to `_pShowLevelUpModal`.
 *   2. `_pShowLevelUpModal`'s destructured signature must accept it.
 *   3. As a bonus, `selectedSubclass` should be seeded with `fullSubclassData`
 *      so picker call sites get the full subclass entity on the initial
 *      render (instead of a shallow `{name, source}` stored ref).
 *
 * Spinning the full jsdom level-up wizard for this would be heavy and brittle;
 * a source-level guard is sufficient and matches the existing
 * CharacterSheetLevelUpScrollContainers.test.js pattern.
 */

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

function read (rel) {
	return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("LevelUp _pShowLevelUpModal fullSubclassData threading", () => {
	const SRC = read("js/charactersheet/charactersheet-levelup.js");

	test("_doLevelUp passes fullSubclassData to _pShowLevelUpModal", () => {
		// Grab the body of _doLevelUp (from its declaration to the next method).
		const doLevelUpMatch = SRC.match(/async _doLevelUp\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\t\}\n/);
		expect(doLevelUpMatch).not.toBeNull();
		const doLevelUpBody = doLevelUpMatch[1];

		// It must declare fullSubclassData...
		expect(doLevelUpBody).toMatch(/let\s+fullSubclassData\s*=/);
		// ...and the modal call must include it as an argument.
		expect(doLevelUpBody).toMatch(/_pShowLevelUpModal\s*\(\s*\{[^}]*\bfullSubclassData\b/);
	});

	test("_pShowLevelUpModal destructured signature accepts fullSubclassData", () => {
		const sigMatch = SRC.match(/async _pShowLevelUpModal\s*\(\s*\{([^}]*)\}\s*\)/);
		expect(sigMatch).not.toBeNull();
		const sig = sigMatch[1];

		expect(sig).toMatch(/\bfullSubclassData\b/);
	});

	test("selectedSubclass is seeded with fullSubclassData (full subclass on initial render)", () => {
		// The seed allows picker call sites to receive the full subclass entity
		// (with additionalSpells / subclassFeatures) on the initial render,
		// rather than the shallow stored {name, source} ref.
		const seedMatch = SRC.match(/let\s+selectedSubclass\s*=\s*([^;]+);/);
		expect(seedMatch).not.toBeNull();
		expect(seedMatch[1]).toMatch(/fullSubclassData/);
	});

	test("no bare fullSubclassData references inside _pShowLevelUpModal without it being in scope", () => {
		// Sanity guard: every reference to fullSubclassData inside
		// _pShowLevelUpModal must be reachable via the destructured parameter
		// (i.e. the parameter is present in the signature).
		const modalMatch = SRC.match(/async _pShowLevelUpModal\s*\([^)]*\)\s*\{([\s\S]*?)\n\t\}\n/);
		expect(modalMatch).not.toBeNull();
		const modalBody = modalMatch[1];

		const hasReference = /\bfullSubclassData\b/.test(modalBody);
		if (!hasReference) return; // Trivially safe.

		// If used, the destructured signature must have it.
		const sigMatch = SRC.match(/async _pShowLevelUpModal\s*\(\s*\{([^}]*)\}\s*\)/);
		expect(sigMatch[1]).toMatch(/\bfullSubclassData\b/);
	});

	test("picker call sites use fullClassSubclassData fallback (Phase 5.2 bulk-replace)", () => {
		// Phase 5.2: every `selectedSubclass || X` picker fallback should use
		// the resolved-once-at-top `fullClassSubclassData` (a full subclass
		// entity), NOT the shallow stored `classEntry.subclass` ref — otherwise
		// `additionalSpells` is undefined and Chronurgy / Divine Soul /
		// Bladesinger / Order Domain expanded-spell blocks match nothing.
		const modalMatch = SRC.match(/async _pShowLevelUpModal\s*\([^)]*\)\s*\{([\s\S]*?)\n\t\}\n/);
		expect(modalMatch).not.toBeNull();
		const modalBody = modalMatch[1];

		// 1. The resolved-once helper must be present.
		expect(modalBody).toMatch(/const\s+fullClassSubclassData\s*=\s*CharacterSheetClassUtils\.resolveFullSubclass\s*\(/);

		// 2. No surviving `selectedSubclass || classEntry.subclass` patterns
		//    (every picker site must use the resolved variant).
		expect(modalBody).not.toMatch(/selectedSubclass\s*\|\|\s*classEntry\.subclass/);
	});
});
