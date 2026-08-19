/**
 * v21 — the exported weapon damage number is the sheet's number.
 *
 * Two independent defects made the statblock disagree with the character it was
 * exported from, and they pushed in opposite directions, so a spot-check of any one
 * weapon could look fine:
 *
 *   1. `CharacterSheetUpgrades.increaseDamageDie` returns *only* the die term it
 *      matched. The exporter handed it a whole formula, so "2d6+15" came back as
 *      "2d8" and the flat bonus, the damage type and any rider clause were dropped.
 *      Arthur's Cataclysm exported 2d8+4 against the sheet's 2d8+13.
 *   2. The exporter composed the flat from `updateAttackFromWeapon` — a legacy helper
 *      whose only production caller it is. That folds `customModifiers.damageBonus`,
 *      a field with no writer left in the sheet, and knows nothing about the named
 *      damage modifiers (Dueling) and weapon-scoped item bonuses the sheet shows.
 *
 * The contract these tests pin: the exported flat equals
 * `abilityMod + base + feature + item` from the sheet's own
 * `getWeaponDisplayDamageBreakdown`, and situational damage stays out of it because
 * the exporter prints it as a conditional rider on the same line.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import {CharacterSheetNpcExporter} from "../../../js/charactersheet/charactersheet-npc-exporter.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const getDamage = (entry) => (String(entry).match(/\{@damage ([^}]+)\}/) || [])[1];

const makeFighter = ({str = 20, level = 12} = {}) => {
	const state = new CharacterSheetState();
	state.setName("Hammerer");
	state.addClass({name: "Fighter", source: "PHB", level});
	state.setAbilityBase("str", str);
	state.setMaxHp(100);
	return state;
};

describe("v21 — a damage-die increase keeps the rest of the formula", () => {
	it("does not lose the flat bonus when a Superior upgrade steps the die up", () => {
		const state = makeFighter();
		state.addItem({
			name: "Cataclysm",
			source: "CUSTOM",
			dmg1: "2d6",
			dmgType: "bludgeoning",
			type: "M",
			weaponCategory: "martial",
			equipped: true,
			bonusWeapon: 2,
			appliedUpgrades: [{name: "Superior", source: "TCAH", upgradeType: "WU:2"}],
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const atk = out.action.find(a => a.name === "Cataclysm");
		expect(atk).toBeDefined();

		const dmg = getDamage(atk.entries[0]);
		// str +5, magic +2 — the die steps 2d6 -> 2d8 and the +7 survives.
		expect(dmg).toBe("2d8+7");
	});

	it("keeps the damage type and any rider clause alongside the stepped die", () => {
		const state = makeFighter();
		state.addItem({
			name: "Frostbrand",
			source: "CUSTOM",
			dmg1: "1d8",
			dmgType: "slashing",
			type: "M",
			weaponCategory: "martial",
			equipped: true,
			bonusWeapon: 1,
			appliedUpgrades: [{name: "Superior", source: "TCAH", upgradeType: "WU:2"}],
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const entry = out.action.find(a => a.name === "Frostbrand").entries[0];

		expect(getDamage(entry)).toBe("1d10+6");
		expect(entry).toContain("slashing damage");
	});

	it("leaves an unupgraded weapon's die alone", () => {
		const state = makeFighter();
		state.addItem({
			name: "Greatsword",
			source: "PHB",
			dmg1: "2d6",
			dmgType: "slashing",
			type: "M",
			weaponCategory: "martial",
			equipped: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(getDamage(out.action.find(a => a.name === "Greatsword").entries[0])).toBe("2d6+5");
	});
});

describe("v21 — the exported flat is the sheet's flat", () => {
	it("matches abilityMod + base + feature + item for every equipped weapon", () => {
		const state = makeFighter();
		state.addItem({
			name: "Longsword",
			source: "PHB",
			dmg1: "1d8",
			dmgType: "slashing",
			type: "M",
			weaponCategory: "martial",
			equipped: true,
			bonusWeapon: 2,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const item = state.getItems().find(it => it.name === "Longsword");
		const derived = state.updateAttackFromWeapon(item);
		const eff = state.getEffectiveItemBonuses(item.id) || {};
		const bd = state.getWeaponDisplayDamageBreakdown({
			id: `auto_${item.id}`,
			name: item.name,
			abilityMod: derived.abilityMod,
			damageBonus: (eff.totalDamageBonus || 0) + (Number(item.customDamageBonus) || 0),
			properties: derived.properties,
			range: derived.range,
			sourceItem: item,
		});
		const expected = state.getAbilityMod(derived.abilityMod)
			+ (bd.base || 0) + (bd.feature || 0) + (bd.item || 0);

		expect(getDamage(out.action.find(a => a.name === "Longsword").entries[0]))
			.toBe(`1d8+${expected}`);
	});

	it("ignores the orphaned customModifiers.damageBonus save field", () => {
		const withField = makeFighter();
		withField.addItem({
			name: "Warhammer",
			source: "PHB",
			dmg1: "1d8",
			dmgType: "bludgeoning",
			type: "M",
			weaponCategory: "martial",
			equipped: true,
		});
		// Present in 10 of the 24 corpus saves; nothing in the sheet writes it any more
		// and nothing but the legacy `updateAttackFromWeapon` reads it.
		withField._data.customModifiers = {...(withField._data.customModifiers || {}), damageBonus: 6};

		const out = CharacterSheetNpcExporter.convertStateToMonster(withField);
		expect(getDamage(out.action.find(a => a.name === "Warhammer").entries[0])).toBe("1d8+5");
	});

	it("adds the magic bonus exactly once", () => {
		const state = makeFighter();
		state.addItem({
			name: "+3 Rapier",
			source: "PHB",
			dmg1: "1d8",
			dmgType: "piercing",
			type: "M",
			weaponCategory: "martial",
			property: ["F"],
			equipped: true,
			bonusWeapon: 3,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		// str +5 plus a single +3 — a second fold would read 1d8+11.
		expect(getDamage(out.action.find(a => a.name === "+3 Rapier").entries[0])).toBe("1d8+8");
	});

	it("emits a bare die when the flat comes out at zero", () => {
		const state = makeFighter({str: 10});
		state.addItem({
			name: "Club",
			source: "PHB",
			dmg1: "1d4",
			dmgType: "bludgeoning",
			type: "M",
			weaponCategory: "simple",
			equipped: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(getDamage(out.action.find(a => a.name === "Club").entries[0])).toBe("1d4");
	});

	it("writes a negative flat as a subtraction", () => {
		const state = makeFighter({str: 6});
		state.addItem({
			name: "Quarterstaff",
			source: "PHB",
			dmg1: "1d6",
			dmgType: "bludgeoning",
			type: "M",
			weaponCategory: "simple",
			equipped: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(getDamage(out.action.find(a => a.name === "Quarterstaff").entries[0])).toBe("1d6-2");
	});
});

describe("v21 — situational damage stays a rider", () => {
	it("does not fold Rage into the weapon line", () => {
		const barb = new CharacterSheetState();
		barb.setName("Rager");
		barb.addClass({name: "Barbarian", source: "PHB", level: 9});
		barb.setAbilityBase("str", 20);
		barb.setMaxHp(100);
		barb.addItem({
			name: "Greataxe",
			source: "PHB",
			dmg1: "1d12",
			dmgType: "slashing",
			type: "M",
			weaponCategory: "martial",
			equipped: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(barb);
		const entry = out.action.find(a => a.name === "Greataxe").entries[0];

		// The line carries str only; rage is printed as its own conditional clause so a
		// reader can see when it applies. Folding it in would both hide the condition and
		// double-count against the rider.
		expect(getDamage(entry)).toBe("1d12+5");
		expect(entry).toMatch(/while raging/i);
	});
});

describe("v21 — the helper's die-only contract", () => {
	it("increaseDamageDie returns the die alone, which is why the exporter pre-extracts it", () => {
		// Pinned so nobody "fixes" the exporter by passing a formula again.
		expect(globalThis.CharacterSheetUpgrades.increaseDamageDie("2d6+15", 1)).toBe("2d8");
		expect(globalThis.CharacterSheetUpgrades.increaseDamageDie("2d6", 1)).toBe("2d8");
	});
});
