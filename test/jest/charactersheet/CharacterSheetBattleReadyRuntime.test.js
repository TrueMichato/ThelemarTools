import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import {CharacterSheetItemUtils} from "../../../js/charactersheet/charactersheet-item-utils.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const __dirname = dirname(fileURLToPath(import.meta.url));

const MAGIC_LONGSWORD = Object.freeze({
	name: "Magic Longsword",
	source: "TST",
	type: "M",
	weapon: true,
	weaponCategory: "martial",
	dmg1: "1d8",
	dmgType: "S",
	property: [],
	rarity: "uncommon",
});
const MUNDANE_FORCE_WEAPON = Object.freeze({
	name: "Force Pike",
	source: "TST",
	type: "M",
	weapon: true,
	weaponCategory: "martial",
	dmg1: "1d8",
	dmgType: "O",
	property: [],
	rarity: "none",
});

function makeBattleSmithState ({
	source = "EFA",
	subclassSource = source,
	str = 10,
	dex = 14,
	int = 18,
} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", str);
	state.setAbilityBase("dex", dex);
	state.setAbilityBase("int", int);
	state.addClass({
		name: "Artificer",
		source,
		level: 3,
		subclass: {
			name: "Battle Smith",
			shortName: "Battle Smith",
			source: subclassSource,
		},
	});
	state.applyClassFeatureEffects();
	return state;
}

function makeAttack (item, abilityMod = "str") {
	return {
		id: `auto_${item.id || "weapon"}`,
		name: item.name,
		isMelee: true,
		abilityMod,
		damage: item.dmg1 || "1d8",
		damageType: "slashing",
		sourceItem: item,
	};
}

describe("shared magic-item classification", () => {
	it("recognizes explicit canonical magic facts without guessing from damage type or name", () => {
		expect(CharacterSheetItemUtils.isMagicWeapon(MAGIC_LONGSWORD)).toBe(true);
		expect(CharacterSheetItemUtils.isMagicWeapon({...MAGIC_LONGSWORD, rarity: "none", bonusWeapon: "+1"})).toBe(true);
		expect(CharacterSheetItemUtils.isMagicWeapon({...MAGIC_LONGSWORD, rarity: "none", _variantName: "Flame Tongue"})).toBe(true);
		expect(CharacterSheetItemUtils.isMagicWeapon({...MAGIC_LONGSWORD, rarity: "none", _isMagicWeapon: true})).toBe(true);
		expect(CharacterSheetItemUtils.isMagicWeapon(MUNDANE_FORCE_WEAPON)).toBe(false);
		expect(CharacterSheetItemUtils.isMagicWeapon({name: "Magic Sword", source: "TST", type: "M", rarity: "none"})).toBe(false);
		expect(CharacterSheetItemUtils.isMagicWeapon({name: "Rare Amulet", source: "TST", type: "W", rarity: "rare"})).toBe(false);
	});

	it("routes normalized catalog magic facts through the shared classifier", () => {
		const state = new CharacterSheetState();
		const normalized = CharacterSheetItemUtils.getNormalizedCatalogItem({
			state,
			item: {...MAGIC_LONGSWORD, countsAsMagical: true, _variantSource: "TST"},
		});

		expect(normalized).toMatchObject({
			magical: false,
			countsAsMagical: true,
			_variantSource: "TST",
		});
		expect(state.isMagicWeapon(normalized)).toBe(true);
	});
});

describe("Battle Ready shared ability resolution", () => {
	it("uses Intelligence for both attack and damage only when it improves the normal result", () => {
		const state = makeBattleSmithState();
		const attack = state.updateAttackFromWeapon(MAGIC_LONGSWORD);

		expect(attack).toMatchObject({
			abilityMod: "str",
			resolvedAbility: "int",
			abilitySource: "Battle Ready",
			abilitySourceFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.BATTLE_READY,
			damage: "1d8+4",
		});
		expect(attack.attackBonus).toBe(6);
		expect(state.getWeaponAbilityResolution(attack)).toMatchObject({
			modifier: 4,
			ability: "int",
			source: "Battle Ready",
			attribution: "INT via Battle Ready",
		});

		const strongState = makeBattleSmithState({str: 20, int: 16});
		expect(strongState.getWeaponAbilityResolution(makeAttack(MAGIC_LONGSWORD))).toMatchObject({
			modifier: 5,
			ability: "str",
			source: null,
		});
	});

	it("compares Intelligence against the normal finesse result", () => {
		const rapier = {...MAGIC_LONGSWORD, name: "Magic Rapier", property: ["F"]};
		const useInt = makeBattleSmithState({str: 8, dex: 16, int: 18});
		const keepDex = makeBattleSmithState({str: 8, dex: 20, int: 18});

		expect(useInt.getWeaponAbilityResolution(makeAttack(rapier, "finesse"))).toMatchObject({
			modifier: 4,
			ability: "int",
			baseAbility: "dex",
			source: "Battle Ready",
		});
		expect(keepDex.getWeaponAbilityResolution(makeAttack(rapier, "finesse"))).toMatchObject({
			modifier: 5,
			ability: "dex",
			source: null,
		});
	});

	it("falls back immediately when the magic fact, exact feature source, or subclass is removed", () => {
		const state = makeBattleSmithState();
		const mutableWeapon = {...MAGIC_LONGSWORD};
		const attack = makeAttack(mutableWeapon);
		expect(state.getWeaponAbilityMod(attack)).toBe(4);

		mutableWeapon.rarity = "none";
		expect(state.getWeaponAbilityResolution(attack)).toMatchObject({modifier: 0, ability: "str", source: null});

		mutableWeapon.rarity = "uncommon";
		state.getClasses()[0].subclass = {name: "Alchemist", shortName: "Alchemist", source: "EFA"};
		state.applyClassFeatureEffects();
		expect(state.getWeaponAbilityResolution(attack)).toMatchObject({modifier: 0, ability: "str", source: null});

		const wrongSource = makeBattleSmithState({source: "HB", subclassSource: "HB"});
		expect(wrongSource.getWeaponAbilityResolution(makeAttack(MAGIC_LONGSWORD))).toMatchObject({
			modifier: 0,
			ability: "str",
			source: null,
		});
	});

	it("preserves exact TCE Battle Smith runtime behavior without projecting EFA metadata", () => {
		const state = makeBattleSmithState({source: "TCE"});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasBattleReady).toBe(true);
		expect(calculations.hasEfaBattleReady).toBeUndefined();
		expect(state.getWeaponAbilityResolution(makeAttack(MAGIC_LONGSWORD))).toMatchObject({
			modifier: 4,
			ability: "int",
			source: "Battle Ready",
			sourceFeatureUid: CharacterSheetState.TCE_BATTLE_READY_FEATURE_UID,
		});
	});
});

describe("Replicate Magic Item provenance", () => {
	function createGenerated (state, owner = CharacterSheetState.EFA_REPLICATE_MAGIC_ITEM_OWNER) {
		const result = state.createGeneratedFeatureItem({
			item: {
				name: "Replicated Longsword",
				source: "EFA",
				type: "M",
				weapon: true,
				weaponCategory: "martial",
				dmg1: "1d8",
				rarity: "none",
			},
			owner,
		});
		expect(result.ok).toBe(true);
		return state.getItems().find(item => item.id === result.itemId);
	}

	it("accepts only valid exact Replicate provenance", () => {
		const state = makeBattleSmithState();
		const weapon = createGenerated(state);
		expect(state.classifyGeneratedFeatureItem(weapon).status).toBe("valid");
		expect(state.isMagicWeapon(weapon)).toBe(true);
		expect(state.getWeaponAbilityResolution(makeAttack(weapon))).toMatchObject({
			ability: "int",
			sourceFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.BATTLE_READY,
		});
	});

	it.each([
		["stale", raw => { raw._generatedItemProvenance.version += 1; }],
		["malformed", raw => { delete raw._generatedItemProvenance.owner; }],
	])("rejects %s provenance even when editable rarity claims the item is magic", (_label, mutate) => {
		const state = makeBattleSmithState();
		const weapon = createGenerated(state);
		const raw = state.getItemRaw(weapon.id);
		raw.rarity = "legendary";
		mutate(raw);

		expect(state.isMagicWeapon(state.getItems().find(item => item.id === weapon.id))).toBe(false);
	});

	it("rejects valid wrong-owner and unrelated generated feature items", () => {
		const wrongOwnerState = makeBattleSmithState();
		const wrongOwner = createGenerated(wrongOwnerState, {
			featureUid: "Right Tool for the Job|Artificer|EFA|3",
			classUid: "Artificer|EFA",
			subclassUid: null,
			featureSource: "EFA",
		});
		expect(wrongOwnerState.classifyGeneratedFeatureItem(wrongOwner).status).toBe("valid");
		expect(wrongOwnerState.isMagicWeapon(wrongOwner)).toBe(false);

		const unrelatedState = makeBattleSmithState();
		const unrelated = createGenerated(unrelatedState, {
			featureUid: "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA",
			classUid: "Artificer|EFA",
			subclassUid: "Battle Smith|Artificer|EFA|EFA",
			featureSource: "EFA",
		});
		expect(unrelatedState.classifyGeneratedFeatureItem(unrelated).status).toBe("valid");
		expect(unrelatedState.isMagicWeapon(unrelated)).toBe(false);
	});
});

describe("Battle Ready attribution surfaces", () => {
	it("renders the shared attribution in Combat", () => {
		const state = makeBattleSmithState();
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._channelCantripsCache = [];
		const html = combat._renderAttackItem(makeAttack(MAGIC_LONGSWORD)).outerHTML;

		expect(html).toContain("charsheet__attack-ability-source");
		expect(html).toContain("INT via Battle Ready");
	});

	it("renders the shared attribution in Play Mode", () => {
		const state = makeBattleSmithState();
		state.addAttack(makeAttack(MAGIC_LONGSWORD));
		const playMode = new CharacterSheetPlayMode({
			getState: () => state,
			_rollAttack: () => {},
		});
		const nodes = [];
		const makeNode = cls => ({
			className: cls,
			textContent: "",
			title: "",
			classList: {add () {}},
			addEventListener () {},
			setAttribute () {},
		});
		playMode._elActionsHub = makeNode("hub");
		playMode._makeCard = () => ({querySelector: () => null});
		playMode._ce = (_tag, cls) => {
			const node = makeNode(cls);
			nodes.push(node);
			return node;
		};
		playMode._setIcon = () => {};
		playMode._makeClickable = () => {};
		playMode._getEntityNote = () => null;
		playMode._isFavorite = () => false;
		playMode._logActivity = () => {};

		playMode._renderAttacks();

		expect(nodes.find(node => node.className === "pm-attack__ability-source")?.textContent)
			.toBe("INT via Battle Ready");
	});

	it("keeps Overview, Combat, and Play Mode on the shared resolver and attribution field", () => {
		for (const [file, method] of [
			["charactersheet.js", "_renderAttacks ()"],
			["charactersheet-combat.js", "_renderAttackItem (attack"],
			["charactersheet-playmode.js", "_renderAttacks ()"],
		]) {
			const source = readFileSync(resolve(__dirname, `../../../js/charactersheet/${file}`), "utf8");
			const start = source.indexOf(method);
			const body = source.slice(start, start + 12000);
			expect(start).toBeGreaterThanOrEqual(0);
			expect(body).toContain("getWeaponAbilityResolution");
			expect(body).toContain("abilityResolution.attribution");
		}
	});

	it("keeps both Combat attack and damage rolls on the shared resolver", () => {
		const source = readFileSync(resolve(__dirname, "../../../js/charactersheet/charactersheet-combat.js"), "utf8");
		for (const method of ["_rollAttack (attack", "_rollDamage (attack"]) {
			const start = source.indexOf(method);
			const body = source.slice(start, start + 12000);
			expect(start).toBeGreaterThanOrEqual(0);
			expect(body).toContain("getWeaponAbilityResolution");
		}
	});
});
