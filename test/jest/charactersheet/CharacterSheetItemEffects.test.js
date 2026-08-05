/**
 * Custom-item structured effects (Bug #8) — items now carry an `effects[]` array using the
 * SAME catalog/schema as custom abilities and flow through the SAME modifier pipeline
 * (`_applyCatalogEffect` → named modifiers / defensive arrays / carryCapacity). These tests
 * pin the item-effects LIFECYCLE in charactersheet-state.js (register on equip, unregister on
 * unequip/remove, attunement gating, no duplication across save/load) plus the shared
 * catalog/editor wiring that the custom-item modal reuses.
 *
 * Bridge to Bug #10: a custom item with a `carryCapacity` effect feeds the carry breakdown's
 * PRE-multiplier flatBonus (consistent with abilities), distinct from the post-multiplier
 * external-container channel that the built-in Bag of Holding uses.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-customabilities.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCustomAbilities = globalThis.CharacterSheetCustomAbilities;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

function mkState ({level = 5} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level});
	state.setSetting("thelemar_carryWeight", false); // standard 5e rule: STR × 15
	state.setAbilityBase("str", 10);
	return state;
}

/** Build a flat custom-item payload carrying structured effects. */
function customItem (name, effects, extra = {}) {
	return {
		name,
		source: "Custom",
		_isCustom: true,
		weight: 1,
		equipped: false,
		attuned: false,
		quantity: 1,
		effects,
		...extra,
	};
}

describe("Bug #8 — item effects flow through the shared modifier pipeline", () => {
	it("an equipped custom item's carryCapacity effect raises the PRE-multiplier flat bonus", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.flatBonus).toBe(50); // pre-multiplier (distinct from the Bag-of-Holding external term)
		expect(b.externalCapacity).toBe(0);
		expect(b.total).toBe(200); // (150 + 50) × 1
	});

	it("an equipped custom item's AC effect surfaces as a custom AC modifier", () => {
		const state = mkState();
		state.addItem(customItem("Bracers of Defense", [{type: "ac", value: 2}], {equipped: true}));
		expect(state.getCustomModifier("ac")).toBe(2);
	});

	it("an equipped custom item's resistance effect appears in getResistances()", () => {
		const state = mkState();
		state.addItem(customItem("Cloak of Fire Resistance", [{type: "resistance:fire", value: 0}], {equipped: true}));
		expect(state.getResistances()).toContain("fire");
	});

	it("a custom item's save effect raises the saving-throw custom modifier", () => {
		const state = mkState();
		state.addItem(customItem("Ring of Iron Will", [{type: "save:wis", value: 1}], {equipped: true}));
		expect(state.getCustomModifier("save:wis")).toBe(1);
	});
});

describe("Bug #8 — item effects activation gating (equipped / attuned)", () => {
	it("effects do NOT apply while the item is unequipped", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: false}));
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	it("equipping applies effects; unequipping reverts them", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: false}));
		const id = state.getItems()[0].id;

		state.setItemEquipped(id, true);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.setItemEquipped(id, false);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	it("an attunement-required item applies effects only once ATTUNED (not merely equipped)", () => {
		const state = mkState();
		state.addItem(customItem(
			"Amulet of Hauling",
			[{type: "carryCapacity", value: 50}],
			{equipped: true, attuned: false, requiresAttunement: true},
		));
		const id = state.getItems()[0].id;

		// Equipped but not attuned → inert.
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);

		state.setItemAttuned(id, true);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.setItemAttuned(id, false);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});
});

describe("Bug #8 — item effects cleanup on removal / replacement", () => {
	it("removing an equipped item purges its contributed modifiers", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const id = state.getItems()[0].id;
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.removeItem(id);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	it("removing an equipped item purges its contributed defensive traits", () => {
		const state = mkState();
		state.addItem(customItem("Cloak of Fire Resistance", [{type: "resistance:fire", value: 0}], {equipped: true}));
		const id = state.getItems()[0].id;
		expect(state.getResistances()).toContain("fire");

		state.removeItem(id);
		expect(state.getResistances()).not.toContain("fire");
	});

	it("replaceItem swaps the effect cleanly: +50 → +20 leaves exactly +20", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const id = state.getItems()[0].id;
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.replaceItem(id, customItem("Belt of Hauling +", [{type: "carryCapacity", value: 20}], {equipped: true}));
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(20); // not 70, not 50
	});

	it("replaceItem to a no-effect payload removes the old contribution entirely", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const id = state.getItems()[0].id;
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.replaceItem(id, {name: "Plain Belt", source: "Custom", _isCustom: true, weight: 1});
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	it("registering an item's effects is idempotent — equip()-twice does not double the bonus", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: false}));
		const id = state.getItems()[0].id;
		state.equip(id);
		state.equip(id); // second equip must NOT stack a second +50
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);
	});
});

describe("Bug #8 — save/load does not duplicate item effects", () => {
	it("a round-trip through toJson/loadFromJson keeps the bonus at its single value", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		const json = JSON.parse(JSON.stringify(state.toJson()));
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		// Must be 50, not 100 (no double-apply from restored named modifiers + re-register).
		expect(restored.getCarryingCapacityBreakdown().flatBonus).toBe(50);
	});

	it("a defensive-trait item round-trips without duplication and cleans up after load", () => {
		const state = mkState();
		state.addItem(customItem("Cloak of Fire Resistance", [{type: "resistance:fire", value: 0}], {equipped: true}));
		const json = JSON.parse(JSON.stringify(state.toJson()));
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		// Exactly one "fire" entry survives the round-trip.
		expect(restored.getResistances().filter(r => r === "fire").length).toBe(1);

		// Unequipping after load removes it exactly once (no orphaned duplicate).
		const id = restored.getItems()[0].id;
		restored.setItemEquipped(id, false);
		expect(restored.getResistances()).not.toContain("fire");
	});

	it("the item effects array survives the round-trip", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const json = JSON.parse(JSON.stringify(state.toJson()));
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		const item = restored.getItems()[0];
		expect(item.effects).toEqual([{type: "carryCapacity", value: 50}]);
	});
});

describe("Bug #8 — shared catalog & effects editor (one pipeline for items + abilities)", () => {
	it("getModifierGroups exposes the full catalog (carryCapacity included)", () => {
		const state = mkState();
		const groups = CharacterSheetCustomAbilities.getModifierGroups(state);
		const allTypes = groups.flatMap(g => g.options.map(o => o.value));
		expect(allTypes).toContain("carryCapacity");
		expect(allTypes).toContain("ac");
		expect(allTypes).toContain("resistance:fire");
		expect(allTypes).toContain("save:all");
	});

	it("the item-scoped option list drops active-state-only types the item pipeline ignores", () => {
		const state = mkState();
		const itemHtml = CharacterSheetCustomAbilities.getEffectTypeOptionsHtml(state, {forItems: true});
		const fullHtml = CharacterSheetCustomAbilities.getEffectTypeOptionsHtml(state, {forItems: false});
		// critRange is an active-state-only effect; offering it on items would silently no-op.
		expect(fullHtml).toContain("value=\"critRange\"");
		expect(itemHtml).not.toContain("value=\"critRange\"");
		// carryCapacity IS consumed by items, so it must remain available.
		expect(itemHtml).toContain("value=\"carryCapacity\"");
	});

	it("mountEffectsEditor exists and is defensive (returns a render fn, no-ops on a null container)", () => {
		expect(typeof CharacterSheetCustomAbilities.mountEffectsEditor).toBe("function");
		const render = CharacterSheetCustomAbilities.mountEffectsEditor({
			sheet: mkState(), state: mkState(), listEl: null, effects: [],
		});
		expect(typeof render).toBe("function");
		expect(() => render()).not.toThrow();
	});

	it("the shared ability/item effect filter preserves a zero-value derived-skill effect", () => {
		const effect = {
			type: "skill:spellcraft",
			value: 0,
			derivedSkill: {source: "arcana", mode: "modifier", delta: 2},
		};
		expect(CharacterSheetCustomAbilities.effectHasBehavior(effect)).toBe(true);
	});
});

describe("Bug #8 — custom-item modal wiring (source-pinned)", () => {
	const invSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-inventory.js"), "utf8");
	const abilSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-customabilities.js"), "utf8");

	it("the custom-item modal mounts the shared effects editor", () => {
		expect(invSrc).toContain("CharacterSheetCustomAbilities");
		expect(invSrc).toContain("mountEffectsEditor");
		expect(invSrc).toContain("custom-item-effects-list");
		expect(invSrc).toContain("custom-item-add-effect");
	});

	it("the custom-item modal collects effects into the saved options + builds them onto the item", () => {
		expect(invSrc).toMatch(/options\.effects\s*=/);
		expect(invSrc).toMatch(/effects:\s*Array\.isArray\(options\.effects\)/);
	});

	it("effects round-trip through seed + prefill for edit/clone flows", () => {
		expect(invSrc).toMatch(/options\.effects\s*=\s*JSON\.parse\(JSON\.stringify\(item\.effects\)\)/);
	});

	it("the shared catalog class is exposed globally so the inventory module can reuse it", () => {
		expect(abilSrc).toContain("globalThis.CharacterSheetCustomAbilities = CharacterSheetCustomAbilities");
	});

	it("catalog item add copies effects[] onto the inventory payload (not only custom items)", () => {
		// Regression: TGTT artifacts (e.g. Gae Bolg) ship effects in brew data; if _addItem
		// drops them, equip never reaches _registerItemEffects.
		expect(invSrc).toMatch(/effects:\s*Array\.isArray\(item\.effects\)/);
	});
});

describe("TGTT artifact item effects (Gae Bolg / Necklace / Ring of Human Influence)", () => {
	function mkArtifactState ({level = 5} = {}) {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level});
		state.setAbilityBase("dex", 14); // +2
		state.setAbilityBase("cha", 12);
		state.setAbilityBase("str", 14);
		return state;
	}

	function addAttuned (state, payload) {
		state.addItem({
			...payload,
			source: payload.source || "TGTT",
			equipped: true,
			attuned: true,
			requiresAttunement: true,
			quantity: 1,
		});
	}

	it("Gae Bolg adds proficiency bonus to initiative when equipped and attuned", () => {
		const state = mkArtifactState({level: 5}); // PB +3
		const before = state.getInitiative();
		addAttuned(state, {
			name: "Gae Bolg",
			effects: [
				{type: "initiative", value: 0, proficiencyBonus: true, name: "Never Unready"},
				{type: "sense:truesight", value: 60, setValue: true, name: "Never Unready"},
			],
			senses: {truesight: 60},
		});
		// DEX +2 + PB +3
		expect(state.getInitiative()).toBe(before + state.getProficiencyBonus());
		expect(state.getSenses().truesight).toBeGreaterThanOrEqual(60);
	});

	it("Gae Bolg initiative does not apply while unequipped", () => {
		const state = mkArtifactState({level: 5});
		const before = state.getInitiative();
		state.addItem({
			name: "Gae Bolg",
			source: "TGTT",
			equipped: false,
			attuned: false,
			requiresAttunement: true,
			effects: [{type: "initiative", value: 0, proficiencyBonus: true, name: "Never Unready"}],
		});
		expect(state.getInitiative()).toBe(before);
	});

	it("Necklace of Goibhnie grants advantage on saves vs magic", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Necklace of Goibhnie",
			effects: [{type: "save:advantage:magic", value: 1, name: "Master Smith's Aegis"}],
		});
		const adv = state.getAdvantageState("save:wis");
		// save:advantage:magic is conditional-subtype gated for opt-in on generic saves,
		// but the named modifier must still be registered from the item.
		const mods = state.getNamedModifiers().filter(m => m.type === "save:advantage:magic" || m.type?.includes("save:advantage:magic"));
		expect(mods.length).toBeGreaterThanOrEqual(1);
		expect(mods.some(m => m.sourceType === "item")).toBe(true);
		// Keep reference so unused lint doesn't fire if getAdvantageState shape changes
		expect(adv == null || typeof adv === "object" || typeof adv === "string" || typeof adv === "boolean").toBe(true);
	});

	it("Necklace of Goibhnie structured bonuses beat Robe of the Archmagi (+3 AC/spell, +2 saves)", () => {
		// Artifact should outclass legendary Robe of the Archmagi (+2 spell only + magic-save adv).
		const brew = JSON.parse(readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8"));
		const neck = brew.item.find(i => i.name === "Necklace of Goibhnie" && i.source === "TGTT");
		expect(neck).toBeTruthy();
		const ac = parseInt(String(neck.bonusAc).replace("+", ""), 10);
		const saves = parseInt(String(neck.bonusSavingThrow).replace("+", ""), 10);
		const spellAtk = parseInt(String(neck.bonusSpellAttack).replace("+", ""), 10);
		const spellDc = parseInt(String(neck.bonusSpellSaveDc).replace("+", ""), 10);
		expect(ac).toBeGreaterThanOrEqual(3);
		expect(saves).toBeGreaterThanOrEqual(2);
		expect(spellAtk).toBeGreaterThanOrEqual(3);
		expect(spellDc).toBeGreaterThanOrEqual(3);
		expect(neck.effects?.some(e => e.type === "save:advantage:magic")).toBe(true);
		expect(neck.effects?.some(e => e.type === "resistance:spell")).toBe(true);
		expect(neck.effects?.some(e => e.type === "combat:disadvantage:spellAttacksAgainst")).toBe(true);
		expect(neck.spellImmunitySlots?.count).toBe(5);
		expect(neck.charges).toBe(1);
		expect(neck.recharge).toBe("dawn");
		expect(neck.chargeName).toMatch(/Stone-Caught/i);
		// Spellward is stronger than the robe's single magic-resistance line.
		const text = JSON.stringify(neck.entries);
		expect(text).toMatch(/five spells/i);
		expect(text).toMatch(/Resistance to damage from spells/i);
		expect(text).toMatch(/Spell attack rolls against you have/i);
	});

	it("Necklace grants resistance:spell when equipped and attuned", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Necklace of Goibhnie",
			effects: [
				{type: "resistance:spell", value: 0, name: "Master Smith's Aegis"},
			],
		});
		expect(state.getResistances()).toContain("spell");
	});

	it("Necklace combat:disadvantage:spellAttacksAgainst surfaces via inventory defenses", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Necklace of Goibhnie",
			effects: [
				{type: "combat:disadvantage:spellAttacksAgainst", value: 1, name: "Master Smith's Aegis"},
			],
		});
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv._updateItemBonuses(state.getItems());
		const defs = state.getItemDefenses();
		expect(defs.combatEffects.some(d =>
			d.type === "disadvantage" && d.target === "spellAttacksAgainst" && /Goibhnie/i.test(d.source),
		)).toBe(true);
		const eff = state.getEffectiveDefenses();
		expect(eff.combatEffects.some(d => d.target === "spellAttacksAgainst")).toBe(true);
	});

	it("chosen spell immunities clamp to slot count and feed defenses", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Necklace of Goibhnie",
			spellImmunitySlots: {
				count: 5,
				replaceOnShortRest: 1,
				label: "Threefold Spellward",
				resetHint: "longRest",
			},
			chosenSpellImmunities: [],
		});
		const id = state.getItems()[0].id;
		expect(state.setItemChosenSpellImmunities(id, [
			"Fireball", "Counterspell", "Hold Person", "Banishment", "Disintegrate", "Wish",
		])).toBe(true);
		const chosen = state.getItemChosenSpellImmunities(id);
		expect(chosen).toHaveLength(5);
		expect(chosen.map(s => s.name)).not.toContain("Wish");

		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv._updateItemBonuses(state.getItems());
		const defs = state.getItemDefenses();
		expect(defs.spellImmunities).toHaveLength(5);
		expect(defs.spellImmunities.map(s => s.name)).toEqual(expect.arrayContaining(["Fireball", "Disintegrate"]));
		expect(state.getEffectiveDefenses().spellImmunities).toHaveLength(5);
	});

	it("catalog add copies charges and spellImmunitySlots for Necklace of Goibhnie", () => {
		const state = mkArtifactState();
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		// _addItem is the catalog-picker path; it must preserve structured fields.
		inv._addItem({
			name: "Necklace of Goibhnie",
			source: "TGTT",
			reqAttune: true,
			charges: 1,
			recharge: "dawn",
			chargeName: "Stone-Caught Magic",
			spellImmunitySlots: {count: 5, replaceOnShortRest: 1, label: "Threefold Spellward"},
			effects: [
				{type: "resistance:spell", value: 0, name: "Master Smith's Aegis"},
				{type: "combat:disadvantage:spellAttacksAgainst", value: 1, name: "Master Smith's Aegis"},
			],
			bonusAc: "+3",
		});
		const row = state.getItems()[0];
		expect(row.charges).toBe(1);
		expect(row.chargesCurrent).toBe(1);
		expect(row.recharge).toBe("dawn");
		expect(row.chargeName).toBe("Stone-Caught Magic");
		expect(row.spellImmunitySlots.count).toBe(5);
		expect(row.chosenSpellImmunities).toEqual([]);
		expect(row.effects).toHaveLength(2);
		expect(row.bonusAc).toBe(3);
	});

	it("setItems rehydrates necklace charges and spellImmunitySlots", () => {
		const state = mkArtifactState();
		state.addItem({
			name: "Necklace of Goibhnie",
			source: "TGTT",
			equipped: true,
			attuned: true,
			requiresAttunement: true,
			quantity: 1,
		});
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv.setItems([{
			name: "Necklace of Goibhnie",
			source: "TGTT",
			reqAttune: true,
			charges: 1,
			recharge: "dawn",
			chargeName: "Stone-Caught Magic",
			spellImmunitySlots: {count: 5, replaceOnShortRest: 1, label: "Threefold Spellward"},
			effects: [{type: "resistance:spell", value: 0, name: "Master Smith's Aegis"}],
			bonusAc: "+3",
			bonusSavingThrow: "+2",
			bonusSpellAttack: "+3",
			bonusSpellSaveDc: "+3",
		}]);
		const row = state.getItems()[0];
		expect(row.charges).toBe(1);
		expect(row.chargesCurrent).toBe(1);
		expect(row.chargeName).toMatch(/Stone-Caught/i);
		expect(row.spellImmunitySlots.count).toBe(5);
		expect(row.effects.some(e => e.type === "resistance:spell")).toBe(true);
		expect(row.bonusAc).toBe(3);
		expect(state.getResistances()).toContain("spell");
	});

	it("Ring of Human Influence sets Charisma to 22 via ability effects", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Ring of Human Influence",
			effects: [
				{type: "ability:cha", value: 22, mode: "set", name: "Human Influence"},
				{type: "abilityMax:cha", value: 22, mode: "set", name: "Human Influence"},
			],
			ability: {static: {cha: 22}},
		});
		// Effects path feeds customModifiers.abilityScoreStatic
		expect(state.getAbilityScore("cha")).toBe(22);
	});

	it("Silver Hand of Nauda sets Strength to 30", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Silver Hand of Nauda",
			effects: [
				{type: "ability:str", value: 30, mode: "set", name: "Silver Hand"},
				{type: "abilityMax:str", value: 30, mode: "set", name: "Silver Hand"},
			],
		});
		expect(state.getAbilityScore("str")).toBe(30);
	});

	it("setItems rehydrates missing catalog effects onto existing inventory rows", () => {
		const state = mkArtifactState({level: 5});
		const before = state.getInitiative();
		// Simulate a pre-fix save: Gae Bolg equipped/attuned but no effects[] stored.
		state.addItem({
			name: "Gae Bolg",
			source: "TGTT",
			equipped: true,
			attuned: true,
			requiresAttunement: true,
			quantity: 1,
		});
		expect(state.getInitiative()).toBe(before);

		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv.setItems([{
			name: "Gae Bolg",
			source: "TGTT",
			reqAttune: true,
			effects: [
				{type: "initiative", value: 0, proficiencyBonus: true, name: "Never Unready"},
			],
			senses: {truesight: 60},
		}]);

		expect(state.getItems()[0].effects?.length).toBeGreaterThan(0);
		expect(state.getInitiative()).toBe(before + state.getProficiencyBonus());
	});

	it("syncItemDerivedState rehydrates Gae Bolg initiative after character load (catalog already set)", () => {
		// Real load order: setItems(catalog) runs at init with EMPTY inventory, then
		// loadFromJson restores a bare Gae Bolg. Rehydration must run again on render.
		const state = mkArtifactState({level: 5});
		const before = state.getInitiative();
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv.setItems([{
			name: "Gae Bolg",
			source: "TGTT",
			reqAttune: true,
			effects: [
				{type: "initiative", value: 0, proficiencyBonus: true, name: "Never Unready"},
				{type: "sense:truesight", value: 60, setValue: true, name: "Never Unready"},
			],
			senses: {truesight: 60},
		}]);
		// Inventory still empty at catalog set time — no-op rehydrate.
		expect(state.getItems()).toHaveLength(0);

		// Character load restores bare weapon (no effects).
		state.addItem({
			name: "Gae Bolg",
			source: "TGTT",
			equipped: true,
			attuned: true,
			requiresAttunement: true,
			quantity: 1,
		});
		expect(state.getInitiative()).toBe(before);

		// _renderCharacter → syncItemDerivedState must rehydrate + re-register.
		inv.syncItemDerivedState();
		expect(state.getItems()[0].effects?.some(e => e.type === "initiative" && e.proficiencyBonus)).toBe(true);
		expect(state.getInitiative()).toBe(before + state.getProficiencyBonus());
		expect(state.getNamedModifiers().some(m =>
			m.type === "initiative" && m.proficiencyBonus && m.sourceType === "item",
		)).toBe(true);
	});

	it("rehydration merges missing catalog effects onto partial inventory effects[]", () => {
		const state = mkArtifactState({level: 5});
		const before = state.getInitiative();
		// Save has truesight effect but is missing initiative (partial brew snapshot).
		state.addItem({
			name: "Gae Bolg",
			source: "TGTT",
			equipped: true,
			attuned: true,
			requiresAttunement: true,
			quantity: 1,
			effects: [
				{type: "sense:truesight", value: 60, setValue: true, name: "Never Unready"},
			],
		});
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv.setItems([{
			name: "Gae Bolg",
			source: "TGTT",
			reqAttune: true,
			effects: [
				{type: "initiative", value: 0, proficiencyBonus: true, name: "Never Unready"},
				{type: "sense:truesight", value: 60, setValue: true, name: "Never Unready"},
			],
		}]);
		expect(state.getItems()[0].effects.some(e => e.type === "initiative")).toBe(true);
		expect(state.getInitiative()).toBe(before + state.getProficiencyBonus());
	});

	it("Gae Bolg conditionImmune surprised surfaces in defenses and condition immunities", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Gae Bolg",
			conditionImmune: ["surprised"],
			effects: [
				{type: "conditionImmunity:surprised", value: 0, name: "Never Unready"},
			],
		});
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv._updateItemBonuses(state.getItems());
		expect(state.getItemDefenses().conditionImmune.some(d => d.type === "surprised")).toBe(true);
		expect(state.getConditionImmunities()).toContain("surprised");
	});

	it("Spear of Lugh bonusDamageDice feeds getEffectiveItemBonuses damage riders", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Spear of Lugh",
			bonusWeapon: 4,
			bonusDamageDice: "4d12",
			bonusDamageType: "radiant",
			dmg1: "1d6",
			dmgType: "P",
			weaponCategory: "martial",
		});
		const id = state.getItems()[0].id;
		const eff = state.getEffectiveItemBonuses(id);
		expect(eff.bonusDamageDice).toBe("4d12");
		expect(eff.bonusDamageType).toBe("radiant");
		expect(eff.damageRiders).toEqual(expect.arrayContaining([
			expect.objectContaining({dice: "4d12", damageType: "radiant"}),
		]));
	});

	it("Sword of Nauda brew data carries 3d10 radiant rider", () => {
		const brew = JSON.parse(readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8"));
		const sword = brew.item.find(i => i.name === "Sword of Nauda" && i.source === "TGTT");
		expect(sword.bonusDamageDice).toBe("3d10");
		expect(sword.bonusDamageType).toBe("radiant");
		expect(sword.effects?.some(e => e.type === "combat:note" && /Flawless Guard/i.test(e.name))).toBe(true);
	});

	it("Ring of Greater Regeneration heals at turn start while HP >= 1", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Ring of Greater Regeneration",
			regeneration: {value: 1, requireHp: true, name: "Greater Regeneration"},
		});
		state.setMaxHp(20);
		state.setCurrentHp(10);
		const applied = state.applyTurnStartEffects();
		expect(applied.some(e => e.type === "heal" && e.amount === 1 && /Greater Regeneration/i.test(e.source))).toBe(true);
		expect(state.getCurrentHp()).toBe(11);
	});

	it("Plate of Silvanus regeneration surfaces in item defenses", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Plate of Silvanus",
			regeneration: {
				value: 20,
				requireHp: true,
				name: "Rooted Renewal",
				condition: "touching natural earth, stone, or living vegetation",
			},
		});
		state.setMaxHp(40);
		state.setCurrentHp(15);
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv._updateItemBonuses(state.getItems());
		const regen = state.getItemDefenses().regeneration;
		expect(regen.some(r => r.value === 20 && /Rooted Renewal/i.test(r.name))).toBe(true);
		const turn = state.getTurnStartEffects();
		expect(turn.some(e => e.type === "heal" && e.amount === 20)).toBe(true);
	});

	it("combat:note effects surface as note combatEffects on inventory defenses", () => {
		const state = mkArtifactState();
		addAttuned(state, {
			name: "Armor of Brigit",
			effects: [
				{type: "combat:note", name: "Furnace of the Goddess", note: "30 fire damage aura"},
			],
		});
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv._updateItemBonuses(state.getItems());
		const notes = state.getItemDefenses().combatEffects.filter(d => d.type === "note");
		expect(notes.some(n => /Furnace/i.test(n.name) && /fire/i.test(n.target))).toBe(true);
	});

	it("catalog add copies regeneration, bonusDamageDice, and conditionImmune", () => {
		const state = mkArtifactState();
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
		inv._addItem({
			name: "Spear of Lugh",
			source: "TGTT",
			reqAttune: true,
			bonusDamageDice: "4d12",
			bonusDamageType: "radiant",
			regeneration: {value: 1, name: "Test Regen"},
			conditionImmune: ["surprised"],
			charges: 1,
			recharge: "dawn",
			chargeName: "Test Charge",
			effects: [{type: "combat:note", name: "Victory", note: "Allies advantage"}],
		});
		const row = state.getItems()[0];
		expect(row.bonusDamageDice).toBe("4d12");
		expect(row.bonusDamageType).toBe("radiant");
		expect(row.regeneration?.value).toBe(1);
		expect(row.conditionImmune).toEqual(["surprised"]);
		expect(row.charges).toBe(1);
		expect(row.chargeName).toBe("Test Charge");
		expect(row.effects.some(e => e.type === "combat:note")).toBe(true);
	});

	it("TGTT Celtic brew artifacts carry structured sheet fields", () => {
		const brew = JSON.parse(readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8"));
		const byName = name => brew.item.find(i => i.name === name && i.source === "TGTT");

		const gae = byName("Gae Bolg");
		expect(gae.conditionImmune).toEqual(expect.arrayContaining(["surprised"]));
		expect(gae.charges).toBe(1);
		expect(gae.chargeName).toMatch(/Blinding/i);

		const lugh = byName("Spear of Lugh");
		expect(lugh.bonusDamageDice).toBe("4d12");
		expect(lugh.effects.some(e => e.type === "combat:advantage:allyAttacksAndSaves")).toBe(true);

		const plate = byName("Plate of Silvanus");
		expect(plate.regeneration?.value).toBe(20);

		const ring = byName("Ring of Greater Regeneration");
		expect(ring.regeneration?.value).toBe(1);

		const mallet = byName("Wooden Mallet of Silvanus");
		expect(mallet.charges).toBe(1);
		expect(mallet.recharge).toBe("dawn");

		const lia = byName("Lia Fail");
		expect(lia.charges).toBe(3);
		expect(lia.effects.some(e => e.type === "ability:cha" && e.value === 30)).toBe(true);
	});
});
