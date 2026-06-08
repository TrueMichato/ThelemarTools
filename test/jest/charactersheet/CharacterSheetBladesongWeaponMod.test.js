/**
 * Bug #3 — Bladesong INT modifier for weapon attacks/damage.
 *
 * While Bladesong is active, a Bladesinger's WEAPON attack and damage rolls use
 * MAX(weapon's normally-resolved modifier, INT). This is the shared roll-math
 * surface both attack systems read from:
 *   - getWeaponAbilityMod(attack)   → absolute effective mod (combat tab + displays)
 *   - getBladesongWeaponBonus(attack)→ additive delta (overview/play-mode roll path)
 *
 * Gates: spell attacks (isSpell / "spellcasting") never gain INT scaling.
 * Player-favorable: a weapon whose native mod already exceeds INT is unaffected.
 */

import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Bladesong weapon ability modifier", () => {
	let state;

	// INT highest: STR -1, DEX +3, INT +4
	function makeIntFavoured () {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 8); // -1
		state.setAbilityBase("dex", 16); // +3
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 18); // +4
		state.setAbilityBase("wis", 10);
		state.setAbilityBase("cha", 10);
	}

	const strWeapon = {name: "Longsword", abilityMod: "str"};
	const dexWeapon = {name: "Shortsword", abilityMod: "dex"};
	const finesseWeapon = {name: "Rapier", abilityMod: "finesse"};
	const rangedWeapon = {name: "Shortbow", abilityMod: "dex", isRanged: true};

	describe("Bladesong INACTIVE (baseline, no behavior change)", () => {
		beforeEach(makeIntFavoured);

		it("resolves the weapon's own ability mod (str/dex/finesse/ranged)", () => {
			expect(state.getWeaponAbilityMod(strWeapon)).toBe(-1);
			expect(state.getWeaponAbilityMod(dexWeapon)).toBe(3);
			expect(state.getWeaponAbilityMod(finesseWeapon)).toBe(3); // max(STR -1, DEX +3)
			expect(state.getWeaponAbilityMod(rangedWeapon)).toBe(3);
		});

		it("contributes no Bladesong bonus", () => {
			expect(state.getBladesongWeaponBonus(strWeapon)).toBe(0);
			expect(state.getBladesongWeaponBonus(finesseWeapon)).toBe(0);
		});
	});

	describe("Bladesong ACTIVE, INT higher than weapon's mod", () => {
		beforeEach(() => {
			makeIntFavoured();
			state.activateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(true);
		});

		it("a STR weapon uses INT for attack and damage", () => {
			expect(state.getWeaponAbilityMod(strWeapon)).toBe(4); // max(-1, INT 4)
			expect(state.getBladesongWeaponBonus(strWeapon)).toBe(5); // 4 - (-1)
		});

		it("a DEX weapon uses INT", () => {
			expect(state.getWeaponAbilityMod(dexWeapon)).toBe(4); // max(3, 4)
			expect(state.getBladesongWeaponBonus(dexWeapon)).toBe(1);
		});

		it("a finesse weapon composes (max(STR,DEX) then max with INT)", () => {
			expect(state.getWeaponAbilityMod(finesseWeapon)).toBe(4); // max(max(-1,3), 4)
			expect(state.getBladesongWeaponBonus(finesseWeapon)).toBe(1);
		});

		it("a ranged weapon also uses INT", () => {
			expect(state.getWeaponAbilityMod(rangedWeapon)).toBe(4);
			expect(state.getBladesongWeaponBonus(rangedWeapon)).toBe(1);
		});
	});

	describe("Bladesong ACTIVE, INT lower than weapon's mod (no penalty)", () => {
		beforeEach(() => {
			state = new CharacterSheetState();
			state.setAbilityBase("str", 18); // +4
			state.setAbilityBase("dex", 12); // +1
			state.setAbilityBase("int", 10); // +0
			state.activateState("bladesong");
		});

		it("keeps the weapon's higher default modifier", () => {
			expect(state.getWeaponAbilityMod(strWeapon)).toBe(4); // max(4, 0)
			expect(state.getBladesongWeaponBonus(strWeapon)).toBe(0);
		});
	});

	describe("Spell attacks are excluded from Bladesong scaling", () => {
		beforeEach(() => {
			makeIntFavoured();
			state.activateState("bladesong");
		});

		it("the 'spellcasting' pseudo-ability gains no Bladesong bonus", () => {
			const spellcasting = {name: "Natural Attack", abilityMod: "spellcasting"};
			// base = max(INT 4, WIS 0, CHA 0) = 4; gate returns 0 regardless
			expect(state.getBladesongWeaponBonus(spellcasting)).toBe(0);
			expect(state.getWeaponAbilityMod(spellcasting)).toBe(4);
		});

		it("an isSpell attack gains no Bladesong bonus", () => {
			const spellAttack = {name: "Fire Bolt", abilityMod: "dex", isSpell: true};
			expect(state.getBladesongWeaponBonus(spellAttack)).toBe(0);
			expect(state.getWeaponAbilityMod(spellAttack)).toBe(3); // plain DEX
		});
	});

	describe("End-to-end Bladesinger toggle", () => {
		beforeEach(() => {
			state = new CharacterSheetState();
			state.addClass({
				name: "Wizard",
				source: "TGTT",
				level: 6,
				subclass: {name: "Bladesinger", shortName: "Bladesinger", source: "TGTT"},
			});
			state.setAbilityBase("str", 8); // -1
			state.setAbilityBase("dex", 14); // +2
			state.setAbilityBase("int", 18); // +4
		});

		it("toggling Bladesong on makes a STR weapon use INT, off reverts", () => {
			expect(state.getWeaponAbilityMod(strWeapon)).toBe(-1);

			state.activateState("bladesong");
			expect(state.getWeaponAbilityMod(strWeapon)).toBe(4); // attack AND damage share this
			expect(state.getBladesongWeaponBonus(strWeapon)).toBe(5);

			state.deactivateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(false);
			expect(state.getWeaponAbilityMod(strWeapon)).toBe(-1);
			expect(state.getBladesongWeaponBonus(strWeapon)).toBe(0);
		});
	});
});
