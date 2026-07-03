/**
 * Character Sheet — Round 42 FOLLOW-UP regression guards
 *
 * Two further bugs surfaced on the same real Barbarian|TGTT / Bard|TGTT
 * (College of the Moon) export after the first Round 42 pass:
 *
 *   Follow-up A — Moon Bard's always-prepared Moonbeam resolved to the 2014
 *     (PHB) spell instead of the 2024 (XPHB) one it is authored as
 *     (`moonbeam|xphb`). `_resolveFullSpellData` compared the requested source
 *     case-sensitively (`s.source === parsed.source`), but `_parseSpellReference`
 *     lower-cases the source from the "name|source" ref ("xphb"), while the spell
 *     DB stores "XPHB". The exact-source match therefore always failed and the
 *     resolver fell through to `matches[0]` — frequently the PHB copy.
 *
 *   Follow-up B — Primal Lore skill choice re-offered on EVERY Bard level-up
 *     (not just when the subclass is gained). The CS-BUG-002/017a catch-up
 *     backfill in `_applyLevelUp` re-lists earlier subclass features into
 *     `newFeatures` each level because `selectedSubclass` is seeded from
 *     `fullSubclassData` (truthy on every level-up), not only on the level the
 *     subclass is first picked. `seedSubclassFeatureChoices` then re-seeded the
 *     source-less skill proficiency choice. The backfill is now gated on the
 *     live class NOT already having a subclass, so it fires exactly once.
 *     (This unit guards the seeding layer that the gate protects.)
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

// =========================================================================
// Follow-up A — subclass always-prepared spell resolves to the authored edition
// =========================================================================
describe("Follow-up A — _resolveFullSpellData matches spell source case-insensitively", () => {
	const spellDb = [
		{name: "Moonbeam", source: "PHB", level: 2, school: "V"},
		{name: "Moonbeam", source: "XPHB", level: 2, school: "V"},
	];

	it("resolves `moonbeam|xphb` to the XPHB (2024) spell, not the PHB (2014) one", () => {
		const state = new CharacterSheetState();
		state.setSpellData(spellDb);
		const parsed = state._parseSpellReference("moonbeam|xphb");
		expect(parsed.source).toBe("xphb"); // lower-cased by the ref parser
		const full = state._resolveFullSpellData(parsed);
		expect(full).toBeTruthy();
		expect(full.source).toBe("XPHB");
	});

	it("still honours an explicit PHB request", () => {
		const state = new CharacterSheetState();
		state.setSpellData(spellDb);
		const full = state._resolveFullSpellData(state._parseSpellReference("moonbeam|phb"));
		expect(full.source).toBe("PHB");
	});

	it("surfaces the XPHB Moonbeam through a Moon-Bard-style frequency-object grant", () => {
		const state = new CharacterSheetState();
		state.setSpellData(spellDb);
		const cls = {
			name: "Bard",
			source: "XPHB",
			level: 6,
			subclass: {
				name: "College of the Moon",
				shortName: "Moon",
				source: "FRHoF",
				additionalSpells: [{prepared: {"6": {daily: {"1e": ["moonbeam|xphb"]}}}}],
			},
		};
		const prepared = state.getSubclassAlwaysPreparedSpells(cls);
		const moon = prepared.find(s => /moonbeam/i.test(s.name));
		expect(moon).toBeTruthy();
		expect(moon.source).toBe("XPHB");
	});
});

// =========================================================================
// Follow-up B — seeded subclass-feature skill choice never re-offered
// (seed-layer guard behind the _applyLevelUp backfill gate)
// =========================================================================
describe("Follow-up B — Primal Lore skill choice is not re-seeded once fulfilled", () => {
	const primalLore = {
		name: "Primal Lore",
		isSubclassFeature: true,
		className: "Bard",
		subclassShortName: "Moon",
		entries: [
			"You learn Druidic and one cantrip from the Druid spell list. It counts as a Bard spell for you but doesn't count against the number of cantrips you know. Whenever you gain a Bard level, you can replace this cantrip with another cantrip of your choice from the Druid spell list.",
			"Additionally, choose one of the following skills: {@skill Animal Handling|XPHB}, {@skill Insight|XPHB}, {@skill Medicine|XPHB}, {@skill Nature|XPHB}, {@skill Perception|XPHB}, or {@skill Survival|XPHB}. You have proficiency in that skill.",
		],
	};

	const pendingSkill = state => state.getPendingFeatureChoices()
		.filter(c => c.featureName === "Primal Lore" && c.kind === "skill");

	it("offers once, records the marker on fulfillment, and never re-offers", () => {
		const state = new CharacterSheetState();
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLore], {allSpells: []});
		expect(pendingSkill(state).length).toBe(1);

		state.fulfillFeatureChoice(pendingSkill(state)[0].id, "nature");
		expect(state.hasFulfilledFeatureSkillChoice("Primal Lore")).toBe(true);

		// Simulate the (now-gated) backfill re-listing the feature on later level-ups.
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLore], {allSpells: []});
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLore], {allSpells: []});
		expect(pendingSkill(state).length).toBe(0);
	});
});

// =========================================================================
// Follow-up C — "Cast with Blessing of Moonlight" (Moon Bard L6) Moonbeam action
// =========================================================================
describe("Follow-up C — Blessing of Moonlight Moonbeam cast action", () => {
	const makeSpells = ({blessingUses, moonbeamLevelSlots = 1} = {}) => {
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._allSpells = [{name: "Moonbeam", source: "XPHB", level: 2}];
		spells._page = {saveCharacter: jest.fn()};
		spells._renderSpellList = jest.fn();
		spells._castSpell = jest.fn(async () => { slots = Math.max(0, slots - 1); });
		let slots = moonbeamLevelSlots;
		const feature = blessingUses == null
			? null
			: {name: "Blessing of Moonlight", uses: {current: blessingUses, max: 1, recharge: "long"}};
		spells._state = {
			getSpells: () => [{id: "mb", name: "Moonbeam", source: "XPHB", level: 2}],
			getFeature: name => (name === "Blessing of Moonlight" ? feature : null),
			getPactSlots: () => null,
			getSpellSlotsCurrent: lvl => (lvl === 2 ? slots : 0),
			useFeature: jest.fn(name => {
				if (feature && name === "Blessing of Moonlight" && feature.uses.current > 0) { feature.uses.current--; return true; }
				return false;
			}),
		};
		return {spells, feature};
	};

	it("only offers the button on Moonbeam when the feature is present", () => {
		const {spells} = makeSpells({blessingUses: 1});
		expect(spells._getMoonbeamBlessingInfo({name: "Moonbeam"})).toBeTruthy();
		expect(spells._getMoonbeamBlessingInfo({name: "Fireball"})).toBeNull();
	});

	it("returns null when the character lacks the feature", () => {
		const {spells} = makeSpells({blessingUses: null});
		expect(spells._getMoonbeamBlessingInfo({name: "Moonbeam"})).toBeNull();
	});

	it("reports remaining uses from the feature", () => {
		const {spells} = makeSpells({blessingUses: 0});
		const info = spells._getMoonbeamBlessingInfo({name: "Moonbeam"});
		expect(info.usesLeft).toBe(0);
		expect(info.max).toBe(1);
	});

	it("spends the feature use and rolls a 2d4 heal on a real cast", async () => {
		const {spells, feature} = makeSpells({blessingUses: 1});
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => true);
		const toast = jest.spyOn(globalThis.JqueryUtil, "doToast");
		await spells._castSpellWithBlessing("mb");
		expect(spells._castSpell).toHaveBeenCalledTimes(1);
		expect(spells._state.useFeature).toHaveBeenCalledWith("Blessing of Moonlight");
		expect(feature.uses.current).toBe(0);
		const healToast = toast.mock.calls.map(c => c[0]).find(a => /Blessing of Moonlight/.test(a.content));
		expect(healToast).toBeTruthy();
		expect(healToast.content).toMatch(/regains <strong>([2-8])<\/strong> HP/);
		toast.mockRestore();
	});

	it("does NOT spend the use when already exhausted", async () => {
		const {spells} = makeSpells({blessingUses: 0});
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => true);
		await spells._castSpellWithBlessing("mb");
		expect(spells._castSpell).not.toHaveBeenCalled();
		expect(spells._state.useFeature).not.toHaveBeenCalled();
	});

	it("does NOT spend the use when the cast is cancelled (no slot consumed)", async () => {
		const {spells, feature} = makeSpells({blessingUses: 1});
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => true);
		spells._castSpell = jest.fn(async () => {}); // simulate cancelled cast — slot unchanged
		await spells._castSpellWithBlessing("mb");
		expect(spells._castSpell).toHaveBeenCalledTimes(1);
		expect(spells._state.useFeature).not.toHaveBeenCalled();
		expect(feature.uses.current).toBe(1);
	});

	it("does NOT cast when no slot is available", async () => {
		const {spells} = makeSpells({blessingUses: 1, moonbeamLevelSlots: 0});
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => true);
		await spells._castSpellWithBlessing("mb");
		expect(spells._castSpell).not.toHaveBeenCalled();
		expect(spells._state.useFeature).not.toHaveBeenCalled();
	});
});
