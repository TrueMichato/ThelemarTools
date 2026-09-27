/**
 * Effect-level coverage for Barbarian / Path of the Chained Fury (TGTT).
 *
 * WHY A SEPARATE FILE FROM `CharacterSheetTGTT.test.js`.
 *
 * The pre-existing Chained Fury tests in that file assert `calculations.chain*`
 * keys and the presence of feature rows. Every one of them passed while the
 * subclass was COMPLETELY INERT — measured before this work: at L3/6/10/14/18/20
 * `grantedAttacks` was null, `getFeatureGrantedAttacks()` returned `[]` (even
 * with rage active), `weaponDamageRiders` was null, `getActivatableFeatures()`
 * returned `[]`, and `getMeleeReach()` was 5. A calc key nothing reads is not a
 * feature, and a test that asserts one is not coverage.
 *
 * So this file deliberately asserts only things a PLAYER can observe:
 *   - does a weapon appear in the attack list, and only when it should
 *   - what is its reach, its damage die, its ability, its rage bonus
 *   - is the toggle offered, and does it disappear correctly
 *   - do the on-hit riders carry the right DC and damage
 *   - does any of it survive a save/load round-trip
 *
 * Several tests here would have passed against the inert implementation only by
 * accident; each one is written to fail if the wiring is removed.
 */

import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";

globalThis.window ||= {addEventListener () {}};
if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
		body: {classList: {add () {}, remove () {}}},
	};
}
globalThis.Renderer.item ||= {};
globalThis.Renderer.item.addPrereleaseBrewPropertiesAndTypesFrom ||= () => {};

let CharacterSheetState;
let CharacterSheetClassUtils;
let CharacterSheetInventory;
let CharacterSheetPage;
let CharacterSheetCombat;
let CharacterSheetPlayMode;

beforeAll(async () => {
	await import("../../../js/charactersheet/charactersheet-materials.js");
	await import("../../../js/charactersheet/charactersheet-upgrades.js");
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
	CharacterSheetInventory = (await import("../../../js/charactersheet/charactersheet-inventory.js")).CharacterSheetInventory;
	CharacterSheetPage = (await import("../../../js/charactersheet/charactersheet.js")).CharacterSheetPage;
	CharacterSheetCombat = (await import("../../../js/charactersheet/charactersheet-combat.js")).CharacterSheetCombat;
	CharacterSheetPlayMode = (await import("../../../js/charactersheet/charactersheet-playmode.js")).CharacterSheetPlayMode;
});

/** The real subclass-feature text, verbatim from `homebrew/TravelersGuidetoThelemar.json`. */
const FEATURE_TEXT = {
	"Manifest Chains": "When you rage, you can choose to manifest a pair of spectral chains, connected to your arms. The chains function as an extension of your psyche. You determine the appearance of the chains, and they vanish when your rage ends.",
	"Chain Imprisonment": "The chains count as magical for the purpose of overcoming resistance and immunity to nonmagical attacks and damage.",
	"Chain Control": "When grappling a creature, or attempting to move a creature grappled by your chains, you count as 2 size categories larger than you regularly do, instead of 1.",
	"Unchained Fury": "You manifest 4 sets of chains when you enter rage instead of 2. You can grapple any creature with your chains, regardless of size.",
};
const FEATURE_LEVELS = [[3, "Manifest Chains"], [6, "Chain Imprisonment"], [10, "Chain Control"], [14, "Unchained Fury"]];
const sourceData = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url)));
const imprisonment = sourceData.subclassFeature.find(it => it.name === "Chain Imprisonment" && it.source === "TGTT");
const imprisonmentDescription = imprisonment.entries.map(entry => typeof entry === "string" ? entry : entry.items.join(" ")).join(" ");
const manifestFeature = sourceData.subclassFeature.find(it => it.name === "Manifest Chains" && it.source === "TGTT");
const manifestDescription = manifestFeature.entries.map(entry => typeof entry === "string" ? entry : entry.items.join(" ")).join(" ");
const paradoxMetal = sourceData.itemMaterial.find(it => it.name === "Paradox Metal" && it.source === "TGTT");
const GENERATED_CHAIN_ID = "tgtt-chained-fury:spectral-chains";
const STEP_MATERIAL = {
	name: "Steeline",
	source: "TGTT",
	_entityType: "itemMaterial",
	materialCategory: "constructed",
	damage: 1,
	appliesTo: ["weapon"],
	roles: ["strikingSurface"],
};

/** A Chained Fury barbarian at `level`, with STR/DEX/CON set for predictable maths. */
const mkFury = (level) => {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 18);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 16);
	state.addClass({
		name: "Barbarian",
		source: "TGTT",
		level,
		subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"},
	});
	// Mirror what the Builder / Level-Up do: put the subclass feature rows on the
	// sheet. `getActivatableFeatures()` reads those rows, so a state-only setup
	// would silently under-test the toggle surface.
	FEATURE_LEVELS.forEach(([lvl, name]) => {
		if (level >= lvl) state.addFeature({name, source: "TGTT", description: FEATURE_TEXT[name]});
	});
	return state;
};

/** Rage, then manifest. Returns the state for chaining. */
const rageAndManifest = (state) => {
	state.activateState("rage");
	state.activateState("manifestChains");
	return state;
};

const getChains = (state) => (state.getFeatureGrantedAttacks() || []).find(a => a.sourceFeature === "Manifest Chains");
const getChainItems = (state) => state.getItems().filter(item => item._generatedItemId === GENERATED_CHAIN_ID);
const getChainItem = (state) => getChainItems(state)[0];

const makePage = (state) => {
	state.addResource({name: "Rage", max: 4, current: 4, recharge: "long"});
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._saveCurrentCharacter = jest.fn();
	page._renderCharacter = jest.fn();
	return page;
};

describe("Chained Fury — player-facing activation and dice", () => {
	const originalChoice = InputUiUtil.pGetUserEnum;
	afterEach(() => { InputUiUtil.pGetUserEnum = originalChoice; });

	it("cancels a Rage choice without spending a use or Bonus Action", async () => {
		const state = mkFury(3);
		state.startCombat();
		const page = makePage(state);
		InputUiUtil.pGetUserEnum = jest.fn().mockResolvedValue(null);

		expect(await page._pActivateChainedFuryRage()).toBe(false);
		expect(state.isStateTypeActive("rage")).toBe(false);
		expect(state.isStateTypeActive("manifestChains")).toBe(false);
		expect(state.isBonusActionAvailable()).toBe(true);
		expect(state.getResources().find(it => it.name === "Rage").current).toBe(4);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("labels manifestation as part of Rage and rejects an invalid choice without spending", async () => {
		const state = mkFury(3);
		state.startCombat();
		const page = makePage(state);
		InputUiUtil.pGetUserEnum = jest.fn().mockResolvedValue("unexpected");

		expect(await page._pActivateChainedFuryRage()).toBe(false);
		const prompt = InputUiUtil.pGetUserEnum.mock.calls[0][0];
		expect(prompt.title).toContain("manifest chains?");
		expect(prompt.fnDisplay("manifest")).toContain("same Bonus Action");
		expect(state.isStateTypeActive("rage")).toBe(false);
		expect(state.isBonusActionAvailable()).toBe(true);
		expect(state.getResources().find(it => it.name === "Rage").current).toBe(4);
	});

	it.each([["manifest", true], ["without", false]])(
		"starts Rage with the %s choice, spending only Rage's Bonus Action",
		async (choice, manifested) => {
			const state = mkFury(3);
			state.startCombat();
			const page = makePage(state);
			InputUiUtil.pGetUserEnum = jest.fn().mockResolvedValue(choice);
			await page._activateFeatureState({name: "Rage", source: "TGTT"}, "rage", CharacterSheetState.ACTIVE_STATE_TYPES.rage, null, 1);

			expect(state.isStateTypeActive("rage")).toBe(true);
			expect(state.isStateTypeActive("manifestChains")).toBe(manifested);
			expect(state.isBonusActionAvailable()).toBe(false);
			expect(state.getResources().find(it => it.name === "Rage").current).toBe(3);
			expect(!!getChains(state)).toBe(manifested);
			expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
			expect(page._renderCharacter).toHaveBeenCalledTimes(1);
			expect(state.getActivatableFeatures().some(it => it.stateTypeId === "manifestChains")).toBe(false);
		},
	);

	it("refuses an unavailable combat Bonus Action before offering the choice", async () => {
		const state = mkFury(6);
		state.startCombat();
		state.spendBonusAction();
		const page = makePage(state);
		InputUiUtil.pGetUserEnum = jest.fn().mockResolvedValue("manifest");
		expect(await page._pActivateChainedFuryRage()).toBe(false);
		expect(InputUiUtil.pGetUserEnum).not.toHaveBeenCalled();
		expect(state.getResources().find(it => it.name === "Rage").current).toBe(4);
		expect(state.isStateTypeActive("rage")).toBe(false);
	});

	it("rechecks action economy when another interaction spends the Bonus Action while the choice is open", async () => {
		const state = mkFury(6);
		state.startCombat();
		const page = makePage(state);
		InputUiUtil.pGetUserEnum = jest.fn(async () => {
			state.spendBonusAction();
			return "manifest";
		});
		expect(await page._pActivateChainedFuryRage()).toBe(false);
		expect(state.isStateTypeActive("rage")).toBe(false);
		expect(state.isStateTypeActive("manifestChains")).toBe(false);
		expect(state.getResources().find(it => it.name === "Rage").current).toBe(4);
	});

	it("routes Combat's quick Rage button through the shared choice", async () => {
		const state = mkFury(3);
		state.startCombat();
		const page = makePage(state);
		InputUiUtil.pGetUserEnum = jest.fn().mockResolvedValue("manifest");
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = page;
		const originalGetElementById = document.getElementById;
		const originalCreateElement = document.createElement;
		const elements = new Map();
		document.getElementById = id => {
			if (!elements.has(id)) elements.set(id, e_({}));
			return elements.get(id);
		};
		document.createElement = () => ({firstChild: {attributes: []}});
		try {
			combat._initQuickStateButtons();
			await elements.get("charsheet-combat-rage").onclick();
			expect(state.isStateTypeActive("manifestChains")).toBe(true);
			expect(state.getResources().find(it => it.name === "Rage").current).toBe(3);
			expect(state.isBonusActionAvailable()).toBe(false);
			expect(page._renderCharacter).toHaveBeenCalledTimes(1);
		} finally {
			document.getElementById = originalGetElementById;
			document.createElement = originalCreateElement;
		}
	});

	it("routes Play Mode's ended Rage through the choice without waking old chains", async () => {
		const state = mkFury(6);
		state.startCombat();
		const page = makePage(state);
		state.activateState("rage");
		state.deactivateState("rage");
		const endedRage = state.getActiveStates().find(it => it.stateTypeId === "rage");
		expect(endedRage?.active).toBe(false);
		InputUiUtil.pGetUserEnum = jest.fn().mockResolvedValue("without");
		const playMode = Object.create(CharacterSheetPlayMode.prototype);
		playMode._state = state;
		playMode._page = page;
		page._renderActiveStates = jest.fn();
		expect(await playMode._pToggleActiveState(endedRage)).toBe(true);
		expect(state.isStateTypeActive("rage")).toBe(true);
		expect(state.isStateTypeActive("manifestChains")).toBe(false);
		expect(state.getResources().find(it => it.name === "Rage").current).toBe(3);
		expect(state.isBonusActionAvailable()).toBe(false);
	});

	it("does not offer a Chained Fury choice to a different Barbarian", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "PHB", level: 3, subclass: {name: "Path of the Berserker", shortName: "Berserker", source: "PHB"}});
		const page = makePage(state);
		expect(page._isChainedFuryRageChoiceAvailable()).toBe(false);
	});

	it("never offers a second Manifest Chains action after Rage, despite the unrelated movement bonus-action prose", () => {
		const state = mkFury(6);
		state.addFeature({name: "Manifest Chains", source: "TGTT", description: manifestDescription});
		const detection = CharacterSheetState.detectActivatableFeature({name: "Manifest Chains", source: "TGTT", description: manifestDescription});
		expect(detection.stateTypeId).toBe("manifestChains");
		expect(detection.activationAction).not.toBe("bonus");
		state.activateState("rage");
		expect(state.getActivatableFeatures().some(it => it.stateTypeId === "manifestChains")).toBe(false);
	});

	it.each([[3, "1d8", "1d12"], [6, "1d10", "2d6"], [10, "1d12", "2d8"], [14, "2d6", "2d10"]])(
		"keeps the L%s subclass die %s distinct from the Paradox Metal attack die %s",
		(level, baseDie, effectiveDie) => {
			const state = rageAndManifest(mkFury(level));
			state.setItemMaterialCatalog([paradoxMetal]);
			const item = getChainItem(state);
			state.setItemMaterial(item.id, paradoxMetal);
			const raw = state.getItemRaw(item.id);
			const attack = getChains(state);
			expect(raw.dmg1).toBe(baseDie);
			expect(raw._generatedItemBase.dmg1).toBe(baseDie);
			expect(state.getItems().find(it => it.id === item.id).dmg1).toBe(effectiveDie);
			expect(attack.damage).toBe(effectiveDie);
			expect(state.getChainedFuryDamageExplanation(item.id, {attack})).toEqual(expect.objectContaining({
				baseDie,
				effectiveDie,
				text: expect.stringContaining(`Paradox Metal`),
			}));
		},
	);

	it.each([
		[3, "1d8", "1d8", false], [6, "1d10", "1d10", false],
		[10, "1d12", "1d12", false], [14, "2d6", "2d6", false],
		[3, "1d8", "1d12", true], [6, "1d10", "2d6", true],
		[10, "1d12", "2d8", true], [14, "2d6", "2d10", true],
	])(
		"rolls L%s base %s as %s with material=%s from the real Combat producer",
		async (level, baseDie, attackDie, withMaterial) => {
			const state = rageAndManifest(mkFury(level));
			const item = getChainItem(state);
			if (withMaterial) {
				state.setItemMaterialCatalog([paradoxMetal]);
				state.setItemMaterial(item.id, paradoxMetal);
			}
			const attack = getChains(state);
			const combat = Object.create(CharacterSheetCombat.prototype);
			combat._state = state;
			combat._cachedAttacks = [attack];
			let result;
			combat._page = {
				rollDice: () => 1,
				pAnimateDamageDice: async () => {},
				showDiceResult: payload => { result = payload; },
			};
			combat._canApplySneakAttack = () => false;
			combat._promptUseCombatMethod = async () => null;
			combat._pChooseTargetTypeContext = async () => [];
			combat._pChooseJuggernautTargetContext = async () => null;
			combat._pResolveJuggernautHitEffects = async () => "";
			await combat._rollDamage(attack.id);
			expect(result.subtitle).toContain(`${attackDie} +`);
			if (withMaterial) {
				expect(result.subtitle).toContain(`Barbarian L${level} base ${baseDie}`);
				expect(result.subtitle).toContain("Paradox Metal");
			} else {
				expect(result.subtitle).not.toContain("Paradox Metal");
				expect(state.getChainedFuryDamageExplanation(item.id).text).toBe("");
			}
			expect(result.roll).toBe(Number(attackDie.split("d")[0]));
		},
	);

	it("keeps material, the separate acid rider, and player edits through leveling and reload", () => {
		const state = rageAndManifest(mkFury(3));
		state.setItemMaterialCatalog([paradoxMetal]);
		const item = getChainItem(state);
		state.setItemMaterial(item.id, paradoxMetal);
		const raw = state.getItemRaw(item.id);
		state.replaceItem(item.id, {
			...raw,
			name: "Paradox-linked Chains",
			bonusDamageDice: "1d6",
			bonusDamageType: "acid",
		});
		expect(getChains(state).damage).toBe("1d12");
		const cls = state.getClasses().find(it => it.name === "Barbarian");
		cls.level = 6;
		state.applyClassFeatureEffects();
		expect(getChainItem(state)).toMatchObject({
			id: item.id,
			name: "Paradox-linked Chains",
			dmg1: "2d6",
			bonusDamageDice: "1d6",
			bonusDamageType: "acid",
		});
		expect(state.getItemRaw(item.id).dmg1).toBe("1d10");
		expect(getChains(state).damage).toBe("2d6");

		const loaded = new CharacterSheetState();
		loaded.setItemMaterialCatalog([paradoxMetal]);
		loaded.loadFromJson(state.toJson());
		expect(getChainItem(loaded)).toMatchObject({
			id: item.id,
			name: "Paradox-linked Chains",
			dmg1: "2d6",
			bonusDamageDice: "1d6",
			bonusDamageType: "acid",
		});
		expect(loaded.getChainedFuryDamageExplanation(item.id).text).toContain("L6 base 1d10");
		loaded.deactivateState("rage");
		expect(loaded.isStateTypeActive("manifestChains")).toBe(false);
		expect(getChains(loaded)).toBeUndefined();
	});

	it("preserves a deliberately edited chain die and attack override across level changes and reload", () => {
		const state = rageAndManifest(mkFury(3));
		const item = getChainItem(state);
		state.replaceItem(item.id, {
			...state.getItemRaw(item.id),
			dmg1: "2d4",
			attackOverrides: {damage: "3d4"},
		});
		const cls = state.getClasses().find(it => it.name === "Barbarian");
		cls.level = 14;
		state.applyClassFeatureEffects();
		expect(state.getItemRaw(item.id).dmg1).toBe("2d4");
		expect(getChains(state).damage).toBe("3d4");
		expect(state.getChainedFuryDamageExplanation(item.id, {attack: getChains(state)}).text)
			.toBe("Barbarian L14 base 2d6 → custom item 2d4 → attack override 3d4 → attack die 3d4");

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getItemRaw(item.id).dmg1).toBe("2d4");
		expect(getChains(loaded).damage).toBe("3d4");
	});

	it.each([[3, "1d8", "1d12"], [6, "1d10", "2d6"], [10, "1d12", "2d8"], [14, "2d6", "2d10"]])(
		"labels the L%s base %s and actual attack %s in Inventory, Combat, and Play Mode",
		(level, baseDie, attackDie) => {
			const state = rageAndManifest(mkFury(level));
			state.setItemMaterialCatalog([paradoxMetal]);
			const item = getChainItem(state);
			state.setItemMaterial(item.id, paradoxMetal);
			const explanation = `Barbarian L${level} base ${baseDie}`;
			const inventory = new CharacterSheetInventory({
				getState: () => state,
				renderCharacter () {},
				saveCharacter () {},
			});
			expect(inventory._renderItemRow(getChainItem(state)).outerHTML).toContain(explanation);

			const combat = Object.create(CharacterSheetCombat.prototype);
			combat._state = state;
			combat._page = {};
			combat._channelCantripsCache = [];
			const attack = getChains(state);
			const combatHtml = combat._renderAttackItem(attack, {meleeReach: state.getMeleeReach()}).outerHTML;
			expect(combatHtml).toContain(explanation);
			expect(combatHtml).toContain(attackDie);

			const elements = [];
			const playMode = Object.create(CharacterSheetPlayMode.prototype);
			playMode._state = state;
			playMode._page = {};
			playMode._elActionsHub = e_({});
			playMode._makeCard = () => e_({});
			playMode._ce = (tag, className, parent) => {
				const element = e_({tag, clazz: className});
				element.className = className;
				parent?.appendChild(element);
				elements.push(element);
				return element;
			};
			playMode._getEntityNote = () => "";
			playMode._setIcon = () => {};
			playMode._makeClickable = () => {};
			playMode._isFavorite = () => false;
			playMode._renderAttacks();
			const labels = elements.filter(it => it.className === "pm-attack__provenance").map(it => it.textContent);
			expect(labels.some(label => label.includes(explanation) && label.includes(`attack die ${attackDie}`))).toBe(true);
		},
	);
});

describe("Chained Fury — L3 Manifest Chains", () => {
	it("creates one equipped inventory weapon with stable generated-item provenance", () => {
		const state = mkFury(3);
		const chains = getChainItem(state);

		expect(getChainItems(state)).toHaveLength(1);
		expect(chains).toMatchObject({
			name: "Spectral Chains",
			source: "TGTT",
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "O",
			equipped: true,
			_isGeneratedFeatureItem: true,
			_generatedItemId: GENERATED_CHAIN_ID,
			_generatedItemProvenance: {
				sourceType: "subclassFeature",
				sourceFeature: "Manifest Chains",
				source: "TGTT",
				className: "Barbarian",
				classSource: "TGTT",
				subclassShortName: "Chained Fury",
				subclassSource: "TGTT",
			},
		});
	});

	it("does NOT offer the chains toggle until the barbarian is raging", () => {
		const state = mkFury(3);
		const names = (state.getActivatableFeatures() || []).map(f => f.activationInfo?.stateType?.name);
		expect(names).not.toContain("Manifest Chains");
	});

	it("refuses to manifest outside rage — the state cannot be forced on", () => {
		const state = mkFury(3);
		expect(state.activateState("manifestChains")).toBeNull();
		expect(state.isStateTypeActive("manifestChains")).toBe(false);
	});

	it("does not offer an after-the-fact chains action once raging", () => {
		const state = mkFury(3);
		state.activateState("rage");
		const names = (state.getActivatableFeatures() || []).map(f => f.activationInfo?.stateType?.name);
		expect(names).not.toContain("Manifest Chains");
	});

	it("puts NO chain weapon in the attack list until manifested", () => {
		const state = mkFury(3);
		expect(getChains(state)).toBeUndefined();
		state.activateState("rage");
		expect(getChains(state)).toBeUndefined();
	});

	it("puts a Spectral Chains weapon in the attack list once manifested", () => {
		const state = rageAndManifest(mkFury(3));
		const chains = getChains(state);
		const item = getChainItem(state);
		expect(chains).toBeDefined();
		expect(chains.name).toBe("Spectral Chains");
		expect(chains.isMelee).toBe(true);
		expect(chains.damage).toBe("1d8");
		expect(chains.damageType).toBe("force");
		expect(chains.isFeatureAttack).toBe(true);
		expect(chains.id).toBe(`auto_${item.id}`);
		expect(chains.sourceItem.id).toBe(item.id);
		expect(chains.sourceItem._generatedItemId).toBe(GENERATED_CHAIN_ID);
	});

	it("gives the chains 15 ft. reach WITHOUT extending the barbarian's other melee reach", () => {
		const state = rageAndManifest(mkFury(3));
		expect(state.getAttackReach(getChains(state))).toBe(15);
		// The greataxe must NOT grow. A global reach effect would have broken this.
		expect(state.getMeleeReach()).toBe(5);
	});

	it("makes the chains finesse, so they can use DEX", () => {
		const state = rageAndManifest(mkFury(3));
		expect(getChains(state).abilityMod).toBe("finesse");
		expect(getChains(state).properties).toEqual(expect.arrayContaining(["F", "L"]));
	});

	it("delivers rage damage to the finesse chains (the bug that made them useless)", () => {
		const state = rageAndManifest(mkFury(3));
		// Before `resolveAttackAbilityKey`, this returned 0 for every finesse weapon
		// because `abilityMod` is the symbolic string "finesse", never "str".
		expect(state.getRageDamageBonus(true, "finesse")).toBe(2);
	});

	it("offers grapple and shove as on-hit riders, and nothing that needs a later level", () => {
		const state = rageAndManifest(mkFury(3));
		const ids = (state.getFeatureCalculations().attackOnHitOptions || []).map(o => o.id);
		expect(ids).toEqual(expect.arrayContaining(["chains-grapple", "chains-shove"]));
		expect(ids).not.toContain("chains-restrain");
		expect(ids).not.toContain("chains-control-shove");
	});

	it("counts the barbarian as one size larger when grappling", () => {
		const state = mkFury(3);
		const grapple = state.getGrappleSizeCategory();
		expect(grapple.base).toBe("Medium");
		expect(grapple.effective).toBe("Large");
		expect(grapple.bonus).toBe(1);
		expect(grapple.maxTargetSize).toBe("Huge");
	});

	it("drops the chains when rage ends", () => {
		const state = rageAndManifest(mkFury(3));
		expect(getChains(state)).toBeDefined();
		state.deactivateState("rage");
		expect(state.isStateTypeActive("manifestChains")).toBe(false);
		expect(getChains(state)).toBeUndefined();
	});

	it("is NOT yet magical at L3", () => {
		const state = rageAndManifest(mkFury(3));
		expect(getChains(state).countsAsMagical).toBe(false);
	});

	it("keeps the inventory item while hiding its attack outside Rage/Manifest Chains", () => {
		const state = mkFury(3);
		const itemId = getChainItem(state).id;
		expect(state.isItemAttackAvailable(getChainItem(state))).toBe(false);
		expect(getChains(state)).toBeUndefined();

		state.activateState("rage");
		expect(getChainItem(state).id).toBe(itemId);
		expect(state.isItemAttackAvailable(getChainItem(state))).toBe(false);
		expect(getChains(state)).toBeUndefined();

		state.activateState("manifestChains");
		expect(state.isItemAttackAvailable(getChainItem(state))).toBe(true);
		expect(getChains(state).sourceItem.id).toBe(itemId);

		state.deactivateState("rage");
		expect(getChainItem(state).id).toBe(itemId);
		expect(state.isItemAttackAvailable(getChainItem(state))).toBe(false);
		expect(getChains(state)).toBeUndefined();
	});

	it("resolves edits, attack notes, materials, upgrades, and bonuses from the backing item", () => {
		const state = rageAndManifest(mkFury(3));
		state.setItemMaterialCatalog([STEP_MATERIAL]);
		const original = getChainItem(state);
		const inventory = new CharacterSheetInventory({
			getState: () => state,
			renderCharacter () {},
			saveCharacter () {},
		});
		inventory._renderItemList = () => {};

		const raw = state.getItemRaw(original.id);
		raw.attackOverrides = {note: "Hooked links and a weighted pommel."};
		state.replaceItem(original.id, raw);
		inventory._saveCustomItem("Forged Fury", 1, 3, {
			type: "weapon",
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "O",
			property: ["F", "L"],
			range: "18 ft.",
		}, original.id);
		state.replaceItem(original.id, {
			...state.getItemRaw(original.id),
			customAttackBonus: 2,
			customDamageBonus: 3,
		});
		state.setItemMaterial(original.id, STEP_MATERIAL);
		state.applyItemUpgrade(original.id, {name: "Superior", source: "TCAH", upgradeType: ["WU:3"]}, 5000);

		const editedItem = getChainItem(state);
		const chains = getChains(state);
		expect(editedItem).toMatchObject({
			id: original.id,
			name: "Forged Fury",
			range: "18 ft.",
			material: {name: "Steeline", source: "TGTT"},
			_generatedItemId: GENERATED_CHAIN_ID,
		});
		expect(chains).toMatchObject({
			id: `auto_${original.id}`,
			name: "Forged Fury",
			damage: "1d12",
			range: "18 ft.",
			attackBonus: 2,
			damageBonus: 3,
			sourceItem: {
				id: original.id,
				attackOverrides: {note: "Hooked links and a weighted pommel."},
				material: {name: "Steeline", source: "TGTT"},
				_generatedItemId: GENERATED_CHAIN_ID,
			},
		});
	});

	it("reconciles repeatedly without replacing edits or duplicating the item", () => {
		const state = mkFury(3);
		const item = getChainItem(state);
		state.replaceItem(item.id, {...state.getItemRaw(item.id), name: "The Long Memory", customDamageBonus: 4});

		state.getFeatureCalculations();
		state.applyClassFeatureEffects();
		state.getFeatureCalculations();
		state.getFeatureCalculations();

		expect(getChainItems(state)).toHaveLength(1);
		expect(getChainItem(state)).toMatchObject({
			id: item.id,
			name: "The Long Memory",
			customDamageBonus: 4,
			_generatedItemId: GENERATED_CHAIN_ID,
		});
	});

	it("uses generated identity rather than editable display text", () => {
		const state = mkFury(3);
		const generated = getChainItem(state);
		state.replaceItem(generated.id, {...state.getItemRaw(generated.id), name: "Memory's Reach"});
		state.addItem({
			name: "Spectral Chains",
			source: "Custom",
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			dmg1: "9d9",
			dmgType: "N",
			_isCustom: true,
		}, 1, true);

		state.getFeatureCalculations();

		expect(getChainItems(state)).toHaveLength(1);
		expect(getChainItem(state)).toMatchObject({id: generated.id, name: "Memory's Reach"});
		expect(state.getItems().filter(item => item.name === "Spectral Chains" && item.source === "Custom")).toHaveLength(1);
	});
});

describe("Chained Fury — L6 Chain Imprisonment", () => {
	it("classifies the actual TGTT feature as a grapple rider, not a bonus-action toggle", () => {
		const subclass = sourceData.subclass.find(it => it.shortName === "Chained Fury" && it.classSource === "TGTT");
		expect(subclass.subclassFeatures).toContain("Chain Imprisonment|Barbarian|TGTT|Chained Fury|TGTT|6");
		const state = mkFury(6);
		const feature = state._data.features.find(it => it.name === "Chain Imprisonment");
		Object.assign(feature, imprisonment, {description: imprisonmentDescription});
		expect(CharacterSheetState.detectActivatableFeature(feature)).toBeNull();
		expect(state.getActivatableFeatures().some(it => it.feature.id === feature.id)).toBe(false);
		const restrain = state.getFeatureCalculations().attackOnHitOptions.find(it => it.id === "chains-restrain");
		expect(restrain).toMatchObject({attackSourceFeature: "Manifest Chains", save: {ability: "str", dc: 14}});
	});

	it("resolves restraint as part of a successful grapple without spending a bonus action", () => {
		const state = rageAndManifest(mkFury(6));
		state.setChainedFuryTargetTrackingEnabled(true);
		const bonusBefore = state.isBonusActionAvailable();
		const result = state.applyTargetEffect({
			source: "chained-fury",
			targetName: "Ogre",
			effect: "restrain",
			riderId: "chains-restrain",
			grappleSaveFailed: true,
			restraintSaveFailed: true,
		});
		expect(result).toMatchObject({ok: true, grappled: true, restrained: true});
		expect(state.isBonusActionAvailable()).toBe(bonusBefore);
		expect(state.getActiveStates().some(it => it.name === "Chain Imprisonment")).toBe(false);
	});

	it("removes only legacy custom toggles owned by the exact TGTT feature on load", () => {
		const state = mkFury(6);
		const feature = state._data.features.find(it => it.name === "Chain Imprisonment");
		Object.assign(feature, imprisonment, {description: imprisonmentDescription});
		const old = state.toJson();
		old.features.push({...feature, id: "foreign-level-feature", level: 7});
		old.activeStates.push(
			{id: "legacy-chain", stateTypeId: "custom", name: "Chain Imprisonment", sourceFeatureId: feature.id, active: true},
			{id: "unrelated", stateTypeId: "custom", name: "Chain Imprisonment", sourceFeatureId: "foreign", active: true},
			{id: "foreign-level", stateTypeId: "custom", name: "Chain Imprisonment", sourceFeatureId: "foreign-level-feature", active: true},
			{id: "rage", stateTypeId: "rage", name: "Rage", active: true},
		);
		const restored = new CharacterSheetState();
		restored.loadFromJson(old);
		expect(restored.toJson().activeStates.map(it => it.id)).not.toContain("legacy-chain");
		expect(restored.toJson().activeStates.map(it => it.id)).toEqual(expect.arrayContaining(["unrelated", "foreign-level", "rage"]));
	});

	it.each([
		["missing", undefined],
		["null", null],
		["empty", ""],
		["blank", "   "],
	])("preserves unowned states when the legacy Chain Imprisonment feature ID is %s", (_, legacyId) => {
		const state = mkFury(6);
		const feature = state._data.features.find(it => it.name === "Chain Imprisonment");
		Object.assign(feature, imprisonment, {description: imprisonmentDescription});
		const old = state.toJson();
		if (legacyId === undefined) delete old.features.find(it => it.name === "Chain Imprisonment").id;
		else old.features.find(it => it.name === "Chain Imprisonment").id = legacyId;
		old.activeStates.push(
			{id: "ambiguous-chain", stateTypeId: "custom", name: "Chain Imprisonment", sourceFeatureId: legacyId, active: true},
			{id: "unowned-chain", stateTypeId: "custom", name: "Chain Imprisonment", active: true},
			{id: "unowned-null", stateTypeId: "custom", name: "Chain Imprisonment", sourceFeatureId: null, active: true},
			{id: "unowned-other", stateTypeId: "custom", name: "Other Effect", active: true},
			{id: "foreign-chain", stateTypeId: "custom", name: "Chain Imprisonment", sourceFeatureId: "other-feature", active: true},
		);

		const restored = new CharacterSheetState();
		restored.loadFromJson(old);
		expect(restored.toJson().activeStates.map(it => it.id))
			.toEqual(expect.arrayContaining(["ambiguous-chain", "unowned-chain", "unowned-null", "unowned-other", "foreign-chain"]));
	});

	it("makes the chains count as magical", () => {
		const state = rageAndManifest(mkFury(6));
		expect(getChains(state).countsAsMagical).toBe(true);
		expect(state.getFeatureCalculations().chainsAreMagical).toBe(true);
	});

	it("scales damage and reach off the subclass table, not off L3 values", () => {
		const state = rageAndManifest(mkFury(6));
		expect(getChains(state).damage).toBe("1d10");
		expect(state.getAttackReach(getChains(state))).toBe(20);
	});

	it("adds a restrain rider carrying a real save DC of 8 + prof + CON", () => {
		const state = rageAndManifest(mkFury(6));
		const restrain = (state.getFeatureCalculations().attackOnHitOptions || []).find(o => o.id === "chains-restrain");
		expect(restrain).toBeDefined();
		// L6 -> prof +3, CON 16 -> +3.
		expect(restrain.save).toEqual({ability: "str", dc: 8 + 3 + 3});
		expect(state.getFeatureCalculations().chainRestrainDc).toBe(8 + 3 + 3);
	});

	it("ties the restrain's recurring damage to barbarian level", () => {
		const state = rageAndManifest(mkFury(6));
		const restrain = (state.getFeatureCalculations().attackOnHitOptions || []).find(o => o.id === "chains-restrain");
		expect(restrain.recurringDamage).toMatchObject({amount: 6, type: "force"});
		const l14 = rageAndManifest(mkFury(14));
		const restrain14 = (l14.getFeatureCalculations().attackOnHitOptions || []).find(o => o.id === "chains-restrain");
		expect(restrain14.recurringDamage.amount).toBe(14);
	});
});

describe("Chained Fury — L10 Chain Control", () => {
	it("raises the grapple size bonus to two categories", () => {
		const state = mkFury(10);
		const grapple = state.getGrappleSizeCategory();
		expect(grapple.bonus).toBe(2);
		expect(grapple.effective).toBe("Huge");
		expect(grapple.maxTargetSize).toBe("Gargantuan");
	});

	it("adds the 10 ft. reposition rider", () => {
		const state = rageAndManifest(mkFury(10));
		const reposition = (state.getFeatureCalculations().attackOnHitOptions || []).find(o => o.id === "chains-control-shove");
		expect(reposition).toBeDefined();
		expect(state.getFeatureCalculations().chainShoveDistance).toBe(10);
	});

	it("scales to 1d12 / 25 ft.", () => {
		const state = rageAndManifest(mkFury(10));
		expect(getChains(state).damage).toBe("1d12");
		expect(state.getAttackReach(getChains(state))).toBe(25);
	});
});

describe("Chained Fury — L14 Unchained Fury", () => {
	it("doubles the chains to four sets", () => {
		expect(mkFury(10).getFeatureCalculations().chainCount).toBe(2);
		expect(mkFury(14).getFeatureCalculations().chainCount).toBe(4);
	});

	it("grants three attacks per Attack action through the generic allowance path", () => {
		const state = mkFury(14);
		const allowance = (state.getFeatureCalculations().attackActionAllowances || [])
			.find(a => a.sourceFeature === "Manifest Chains");
		expect(allowance).toBeDefined();
		expect(allowance.count).toBe(3);
		// Gated on the chains actually being out — three swings only with chains.
		expect(allowance.requiresState).toBe("manifestChains");
		// And strictly better than the barbarian's normal Extra Attack.
		expect(allowance.count).toBeGreaterThan(state.getFeatureCalculations().attackCount);
	});

	it("removes the grapple size ceiling entirely", () => {
		const grapple = mkFury(14).getGrappleSizeCategory();
		expect(grapple.unlimited).toBe(true);
		expect(grapple.maxTargetSize).toBe("Any");
	});

	it("scales to 2d6 / 30 ft. and stops there", () => {
		const l14 = rageAndManifest(mkFury(14));
		const l20 = rageAndManifest(mkFury(20));
		expect(getChains(l14).damage).toBe("2d6");
		expect(l14.getAttackReach(getChains(l14))).toBe(30);
		expect(getChains(l20).damage).toBe("2d6");
		expect(l20.getAttackReach(getChains(l20))).toBe(30);
	});

	it("grants free movement while grappling", () => {
		expect(mkFury(14).getFeatureCalculations().chainFreeMovement).toBe(true);
		expect(mkFury(10).getFeatureCalculations().chainFreeMovement).toBeFalsy();
	});
});

describe("Chained Fury — persistence", () => {
	it("survives a save/load round-trip with the chains still manifested", () => {
		const state = rageAndManifest(mkFury(14));
		const originalItem = getChainItem(state);
		expect(getChains(state)).toBeDefined();

		const restored = new CharacterSheetState();
		restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));

		expect(restored.isStateTypeActive("rage")).toBe(true);
		expect(restored.isStateTypeActive("manifestChains")).toBe(true);
		const chains = getChains(restored);
		expect(chains).toBeDefined();
		expect(chains.damage).toBe("2d6");
		expect(restored.getAttackReach(chains)).toBe(30);
		expect(getChainItems(restored)).toHaveLength(1);
		expect(getChainItem(restored).id).toBe(originalItem.id);
		expect(chains.sourceItem.id).toBe(originalItem.id);
	});

	it("restores a non-manifested rage without conjuring chains", () => {
		const state = mkFury(14);
		state.activateState("rage");
		const restored = new CharacterSheetState();
		restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(restored.isStateTypeActive("rage")).toBe(true);
		expect(restored.isStateTypeActive("manifestChains")).toBe(false);
		expect(getChains(restored)).toBeUndefined();
		expect(getChainItems(restored)).toHaveLength(1);
	});

	it("migrates a legacy character with no chain item exactly once", () => {
		const state = rageAndManifest(mkFury(6));
		const legacy = JSON.parse(JSON.stringify(state.toJson()));
		legacy.inventory = legacy.inventory.filter(row => row.item?._generatedItemId !== GENERATED_CHAIN_ID);

		const restored = new CharacterSheetState();
		restored.loadFromJson(legacy);
		restored.getFeatureCalculations();
		restored.getFeatureCalculations();

		expect(getChainItems(restored)).toHaveLength(1);
		expect(getChains(restored).sourceItem.id).toBe(getChainItem(restored).id);
	});

	it("backfills stable identity onto a legacy canonical item without duplicating it", () => {
		const state = rageAndManifest(mkFury(6));
		const legacy = JSON.parse(JSON.stringify(state.toJson()));
		const chainRow = legacy.inventory.find(row => row.item?._generatedItemId === GENERATED_CHAIN_ID);
		delete chainRow.item._isGeneratedFeatureItem;
		delete chainRow.item._generatedItemId;
		delete chainRow.item._generatedItemProvenance;
		delete chainRow.item._generatedItemBase;

		const restored = new CharacterSheetState();
		restored.loadFromJson(legacy);

		expect(getChainItems(restored)).toHaveLength(1);
		expect(getChainItem(restored).id).toBe(chainRow.id);
	});

	it("cleans up the item, attack, and manifested state when the subclass is removed", () => {
		const state = rageAndManifest(mkFury(6));
		expect(getChainItems(state)).toHaveLength(1);
		expect(getChains(state)).toBeDefined();

		state.setSubclass("Barbarian", {name: "Path of the Juggernaut", shortName: "Juggernaut", source: "TGTT"});

		expect(getChainItems(state)).toHaveLength(0);
		expect(getChains(state)).toBeUndefined();
		expect(state.isStateTypeActive("manifestChains")).toBe(false);
		expect(state.getActivatableFeatures().some(it => it.stateTypeId === "manifestChains")).toBe(false);
	});
});

describe("resolveAttackAbilityKey — the generic finesse fix", () => {
	it("resolves finesse to the better of STR and DEX", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 18);
		state.setAbilityBase("dex", 8);
		expect(state.resolveAttackAbilityKey("finesse")).toBe("str");
		state.setAbilityBase("dex", 20);
		expect(state.resolveAttackAbilityKey("finesse")).toBe("dex");
	});

	it("resolves finesseWis across all three", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 12);
		state.setAbilityBase("wis", 18);
		expect(state.resolveAttackAbilityKey("finesseWis")).toBe("wis");
	});

	it("defaults blank to STR and passes concrete keys through untouched", () => {
		const state = new CharacterSheetState();
		expect(state.resolveAttackAbilityKey("")).toBe("str");
		expect(state.resolveAttackAbilityKey(null)).toBe("str");
		expect(state.resolveAttackAbilityKey("cha")).toBe("cha");
	});

	it("keeps rage damage on a finesse weapon when STR is the ability actually used", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 18);
		state.setAbilityBase("dex", 12);
		state.addClass({name: "Barbarian", source: "PHB", level: 5});
		state.activateState("rage");
		// Before the fix this returned 0: `abilityUsed` is the literal string
		// "finesse", which never equalled "str", so EVERY raging barbarian with a
		// rapier, scimitar or shortsword silently lost their rage damage.
		expect(state.getRageDamageBonus(true, "finesse")).toBeGreaterThan(0);
	});

	it("still withholds rage damage when finesse resolves to DEX (RAW: Strength only)", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 12);
		state.setAbilityBase("dex", 18);
		state.addClass({name: "Barbarian", source: "PHB", level: 5});
		state.activateState("rage");
		// Rage damage is "melee weapon attacks using Strength". A DEX-based finesse
		// swing is correctly excluded — the fix resolves the ability, it does not
		// blanket-grant the bonus.
		expect(state.getRageDamageBonus(true, "finesse")).toBe(0);
	});
});

describe("Subclass progression tables are read, not hardcoded", () => {
	const TABLE = {
		colLabels: ["Level", "Chains Damage", "Chains Range"],
		rows: [
			["1st", "—", "—"],
			["2nd", "—", "—"],
			["3rd", "{@damage 1d8}", "15 ft."],
			["4th", "{@damage 1d8}", "15 ft."],
			["5th", "{@damage 1d8}", "15 ft."],
			["6th", "{@damage 1d10}", "20 ft."],
		],
	};
	const subclass = {name: "Path of the Chained Fury", subclassTableGroups: [TABLE]};

	it("indexes rows by character level", () => {
		expect(CharacterSheetClassUtils.getSubclassTableDice(subclass, 3, /chains damage/i)).toBe("1d8");
		expect(CharacterSheetClassUtils.getSubclassTableDice(subclass, 6, /chains damage/i)).toBe("1d10");
		expect(CharacterSheetClassUtils.getSubclassTableNumber(subclass, 3, /chains range/i)).toBe(15);
		expect(CharacterSheetClassUtils.getSubclassTableNumber(subclass, 6, /chains range/i)).toBe(20);
	});

	it("treats a dash cell as absent rather than as a value", () => {
		expect(CharacterSheetClassUtils.getSubclassTableCell(subclass, 1, /chains damage/i)).toBeNull();
		expect(CharacterSheetClassUtils.getSubclassTableDice(subclass, 2, /chains damage/i, "fallback")).toBe("fallback");
	});

	it("matches column labels case-insensitively by substring too", () => {
		expect(CharacterSheetClassUtils.getSubclassTableDice(subclass, 3, "chains damage")).toBe("1d8");
	});

	it("returns the fallback for a lean stored subclass ref with no table", () => {
		const lean = {name: "Path of the Chained Fury", source: "TGTT"};
		expect(CharacterSheetClassUtils.getSubclassTableDice(lean, 3, /chains damage/i, "1d8")).toBe("1d8");
		expect(CharacterSheetClassUtils.getSubclassTableNumber(lean, 3, /chains range/i, 15)).toBe(15);
	});

	it("returns the fallback for an unknown column", () => {
		expect(CharacterSheetClassUtils.getSubclassTableNumber(subclass, 3, /nonexistent/i, 99)).toBe(99);
	});
});
