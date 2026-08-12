/**
 * Shared harness for the Beastheart (MCDM, `BST`) suites.
 *
 * Wires up the two things a Beastheart character needs that the shared
 * `setup.js` deliberately does not provide:
 *
 *  1. `globalThis.ScaleClassSummonedCreature` — the real, shared summon scaler the
 *     sheet delegates to for any companion whose stat block is written in terms of
 *     the summoner ("13 plus PB", "7 + 7 times caregiver's level"). Importing the
 *     real module rather than mocking it means these tests fail if the scaler's
 *     contract changes.
 *
 *  2. A `Renderer.dice.parseRandomise2` stand-in. The production implementation is
 *     the full 5etools dice language, which cannot be imported standalone. It is
 *     deliberately NOT added to the shared `setup.js`: two existing suites install
 *     their own `Renderer.dice` with `= Renderer.dice || {...}`, so a shared mock
 *     would silently shadow theirs. The scaler only ever hands this function
 *     dice-free arithmetic (dice terms are split out by its caller), so an integer
 *     arithmetic evaluator is faithful; non-arithmetic input returns `null`, exactly
 *     as the real parser does on a parse failure.
 */

import "./setup.js";
import {ScaleClassSummonedCreature} from "../../../js/scalecreature/scalecreature-scaler-summon-class.js";

globalThis.ScaleClassSummonedCreature = ScaleClassSummonedCreature;

globalThis.Renderer = globalThis.Renderer || {};
if (!globalThis.Renderer.dice) globalThis.Renderer.dice = {};
if (!globalThis.Renderer.dice.parseRandomise2) {
	globalThis.Renderer.dice.parseRandomise2 = (str) => {
		if (!str || !str.trim()) return null;
		const cleaned = str.trim();
		if (!/^[-+*/(). \d]+$/.test(cleaned)) return null;
		if (!/\d/.test(cleaned)) return null;
		try {
			// eslint-disable-next-line no-new-func
			const out = Function(`"use strict"; return (${cleaned});`)();
			return Number.isFinite(out) ? out : null;
		} catch (ignored) {
			return null;
		}
	};
}

export {ScaleClassSummonedCreature};
