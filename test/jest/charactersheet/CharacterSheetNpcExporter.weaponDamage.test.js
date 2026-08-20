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

// Shared by the v36 and v39 rider tests: one equipped one-handed martial weapon, which is
// the loadout every Dueling-shaped conditional is written against.
const makeFighterWithLongsword = () => {
	const state = makeFighter();
	state.addItem({
		name: "Longsword",
		source: "PHB",
		dmg1: "1d8",
		dmgType: "slashing",
		type: "M",
		weaponCategory: "martial",
		properties: [],
		equipped: true,
	});
	return state;
};

describe("v36 — the rider path's `enabled` gate is pinned, not merely present", () => {
	// The gate at charactersheet-npc-exporter.js:9815 drops a conditional damage modifier
	// registered `enabled: false` -- which is exactly how the sheet registers a *text-parsed*
	// conditional, and which `getModifiersForType` deliberately admits via its CS-BUG-053
	// carve-out (charactersheet-state.js:53253). Two gates on one channel, disagreeing.
	//
	// Deleting that line was measured against the whole exporter suite: 1160/1160 stayed
	// green, including the 953-test corpus, while a control that suppressed every rider
	// turned 8 red. So the suite could see riders and still could not see *which* modifiers
	// were admitted to them. These two tests close that hole.
	const duelingState = ({enabled}) => {
		const state = makeFighterWithLongsword();
		state._data.namedModifiers.push({
			type: "damage:melee:oneHanded",
			value: 2,
			enabled,
			conditional: "wielding one melee weapon and no other weapons",
			name: "Dueling",
		});
		return state;
	};

	const riderTextFor = (state) => {
		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		return String(out.action.find(a => a.name === "Longsword").entries[0]);
	};

	it("control: the same modifier, enabled, does reach the line as a rider", () => {
		// Without this the assertion below passes just as well when the rider path is
		// broken outright, or when this fixture never produced a rider to begin with.
		const entry = riderTextFor(duelingState({enabled: true}));
		expect(getDamage(entry)).toBe("1d8+5");
		expect(entry).toMatch(/plus \{@damage 2\} damage when wielding one melee weapon/i);
	});

	it("CS-BUG-170 (FIXED in v39): disabled-but-conditional now reaches the line too", () => {
		// Was a characterization of the defect; inverted when v39 fixed it, exactly as the
		// note left here instructed. `enabled` must not decide this, because `enabled: false`
		// is how the sheet registers a *text-parsed* conditional -- 57 of the corpus's 61
		// disabled modifiers are that shape, not user-disabled ones.
		const entry = riderTextFor(duelingState({enabled: false}));
		expect(getDamage(entry)).toBe("1d8+5");
		expect(entry).toMatch(/plus \{@damage 2\} damage when wielding one melee weapon/i);
	});

	it("admitting the modifier does not move the printed number", () => {
		// The rider is *additional* information, not a second copy of a bonus already summed
		// in. `getEffectiveWeaponDamage().flat` is the item bonus alone, so `1d8+5` has to be
		// identical with the modifier enabled, disabled, or absent -- otherwise the fix would
		// have traded an invisible bonus for a double-counted one.
		const absent = riderTextFor(makeFighterWithLongsword());
		expect(getDamage(absent)).toBe("1d8+5");
		expect(getDamage(riderTextFor(duelingState({enabled: true})))).toBe("1d8+5");
		expect(getDamage(riderTextFor(duelingState({enabled: false})))).toBe("1d8+5");
	});
});

describe("v39 — one feature registering twice yields the more specific rider, once", () => {
	// The sheet registers Dueling under two modifiers, and they are NOT interchangeable:
	//
	//   damage                     "when you are wielding"                        <- truncated
	//   damage:melee:oneHanded     "wielding one melee weapon and no other weapons"
	//
	// The bare one normalizes to "when it is wielding" (meaningless to a reader) and, because
	// `meleeOnly` is derived from `/melee/` on the type, it is also scoped to *every* attack
	// including ranged. Dedup at the `push` helper was first-wins, so it kept precisely the
	// worse copy on both axes. It now upgrades in place: first one's position, best one's
	// content. Measured corpus-wide -- exactly one line of 388 changes.
	// Faithful to the save: the two registrations only collide because their `sourceName`
	// agrees, and it agrees by two *different* routes -- the bare one resolves through
	// `featuresById` from its `sourceFeatureId`, the sub-typed one has no `sourceFeatureId`
	// at all and falls back to `mod.name`. A fixture that simply named both "Dueling" would
	// pass while testing a shape the sheet never produces.
	const DUELING_FEATURE_ID = "dueling-feature-id";
	const BARE = {
		type: "damage",
		value: 2,
		enabled: false,
		conditional: "when you are wielding",
		name: "Dueling: when you are wielding",
		sourceFeatureId: DUELING_FEATURE_ID,
	};
	const SUBTYPED = {
		type: "damage:melee:oneHanded",
		value: 2,
		enabled: false,
		conditional: "wielding one melee weapon and no other weapons",
		name: "Dueling",
	};

	const riderTextForMods = (mods) => {
		const state = makeFighterWithLongsword();
		state._data.features = [...(state._data.features || []), {id: DUELING_FEATURE_ID, name: "Dueling"}];
		mods.forEach(m => state._data.namedModifiers.push({...m}));
		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		return String(out.action.find(a => a.name === "Longsword").entries[0]);
	};

	it.each([
		["registration order (bare first)", [BARE, SUBTYPED]],
		["reversed order (sub-typed first)", [SUBTYPED, BARE]],
	])("keeps the un-truncated wording in %s", (_label, mods) => {
		// Order-independence is the point. A fix that only works because the better copy
		// happens to arrive second is an accident, and the sheet's registration order is not
		// something the exporter controls.
		const entry = riderTextForMods(mods);
		expect(entry).toMatch(/plus \{@damage 2\} damage when wielding one melee weapon and no other weapons/i);
		expect(entry).not.toMatch(/when it is wielding/i);
	});

	it("emits the shared bonus once, not once per registration", () => {
		const entry = riderTextForMods([BARE, SUBTYPED]);
		expect(entry.match(/\{@damage 2\}/g)).toHaveLength(1);
	});

	it("control: each modifier alone still produces its own rider", () => {
		// Anti-vacuity on the same channel. Without this, the two assertions above pass just
		// as well if the dedup grew strict enough to swallow both copies -- the export would
		// be silent again and the tests would not notice.
		expect(riderTextForMods([SUBTYPED])).toMatch(/\{@damage 2\} damage when wielding one melee weapon/i);
		expect(riderTextForMods([BARE])).toMatch(/\{@damage 2\} damage when it is wielding/i);
	});

	it("equal specificity still keeps the first, so the change is a strict superset", () => {
		// The upgrade is gated on *strictly* greater specificity. Two same-shaped registrations
		// therefore behave exactly as they did before v39, which is what keeps the corpus diff
		// at one line instead of reshuffling every rider that shares a source name.
		const first = {...BARE, conditional: "while you are grinning"};
		const second = {...BARE, conditional: "while you are frowning"};
		const entry = riderTextForMods([first, second]);
		expect(entry).toMatch(/when it is grinning/i);
		expect(entry).not.toMatch(/frowning/i);
	});
});
