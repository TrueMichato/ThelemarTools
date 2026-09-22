import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const XPHB_SPELLS = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/spells/spells-xphb.json"),
	"utf8",
)).spell;

const CLASS_UID = "Artificer|EFA";
const OWNER_UID = "Alchemist|Artificer|EFA|EFA";
const LESSER_RESTORATION_UID = "Lesser Restoration|XPHB";
const CAULDRON_UID = "Tasha's Bubbling Cauldron|XPHB";

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const TCE_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "TCE");
const EFA_ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const EFA_TCE_ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
	&& sc.source === "TCE"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const TCE_ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
	&& sc.source === "TCE"
	&& sc.className === "Artificer"
	&& sc.classSource === "TCE",
);

const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

function subclassSnapshot (subclass) {
	return {
		name: subclass.name,
		shortName: subclass.shortName,
		source: subclass.source,
		casterProgression: subclass.casterProgression,
		spellcastingAbility: subclass.spellcastingAbility,
		additionalSpells: copy(subclass.additionalSpells),
	};
}

function classEntry ({source = "EFA", level = 15, subclass = EFA_ALCHEMIST} = {}) {
	const cls = source === "EFA" ? EFA_ARTIFICER : TCE_ARTIFICER;
	return {
		name: cls.name,
		source: cls.source,
		level,
		spellcastingAbility: cls.spellcastingAbility,
		casterProgression: cls.casterProgression,
		preparedSpellsProgression: copy(cls.preparedSpellsProgression),
		cantripProgression: copy(cls.cantripProgression),
		subclass: subclass ? subclassSnapshot(subclass) : null,
	};
}

function makeState ({
	source = "EFA",
	level = 15,
	subclass = EFA_ALCHEMIST,
	intelligence = 18,
	beforeClass,
} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	state.setAbilityBase("int", intelligence);
	beforeClass?.(state);
	state.addClass(classEntry({source, level, subclass}));
	return state;
}

function getGrant (state, spellUid) {
	return state.getInnateSpells().find(spell => spell.ownerUid === OWNER_UID && spell.spellUid === spellUid);
}

function getGrantResource (state, spellUid) {
	return state.getResources().find(resource => resource.ownerUid === OWNER_UID && resource.spellUid === spellUid);
}

function getSpell (name) {
	const spell = XPHB_SPELLS.find(it => it.name === name && it.source === "XPHB");
	if (!spell) throw new Error(`Missing XPHB spell fixture: ${name}`);
	return spell;
}

function addPreparedSpell (state, name) {
	const spell = getSpell(name);
	state.addSpell({
		name: spell.name,
		source: spell.source,
		level: spell.level,
		school: spell.school,
		sourceFeature: "Prepared Spells",
		sourceClass: "Artificer",
		prepared: true,
	}, true);
}

function makeSpellsController (state) {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._allSpells = XPHB_SPELLS;
	spells._page = {};
	return spells;
}

describe("EFA Alchemist innate spell grant metadata", () => {
	test("uses exact EFA level/source gates and canonical linked metadata", () => {
		expect(getGrant(makeState({level: 8}), LESSER_RESTORATION_UID)).toBeUndefined();

		const level9 = makeState({level: 9, intelligence: 18});
		const lesser = getGrant(level9, LESSER_RESTORATION_UID);
		const lesserResource = getGrantResource(level9, LESSER_RESTORATION_UID);
		expect(lesser).toEqual(expect.objectContaining({
			grantId: expect.any(String),
			ownerUid: OWNER_UID,
			classUid: CLASS_UID,
			subclassUid: OWNER_UID,
			spellUid: LESSER_RESTORATION_UID,
			source: "XPHB",
			recharge: "long",
			spellcastingAbility: "int",
			ignoresPreparation: true,
			ignoresMaterialComponents: true,
			castExecutionBlocked: true,
			maxMode: "abilityMod",
			maxAbility: "int",
			uses: {current: 4, max: 4},
		}));
		expect(lesserResource).toEqual(expect.objectContaining({
			grantId: lesser.grantId,
			ownerUid: OWNER_UID,
			classUid: CLASS_UID,
			subclassUid: OWNER_UID,
			spellUid: LESSER_RESTORATION_UID,
			recharge: "long",
			maxMode: "abilityMod",
			maxAbility: "int",
			current: 4,
			max: 4,
			linkedInnateSpellId: lesser.id,
		}));
		expect(lesser.linkedResourceId).toBe(lesserResource.id);
		expect(getGrant(level9, CAULDRON_UID)).toBeUndefined();

		const level15 = makeState({level: 15});
		const cauldron = getGrant(level15, CAULDRON_UID);
		expect(cauldron).toEqual(expect.objectContaining({
			grantId: expect.any(String),
			ownerUid: OWNER_UID,
			classUid: CLASS_UID,
			subclassUid: OWNER_UID,
			spellUid: CAULDRON_UID,
			source: "XPHB",
			recharge: "long",
			ignoresPreparation: true,
			ignoresMaterialComponents: true,
			castExecutionBlocked: true,
			uses: {current: 1, max: 1},
		}));
		expect(getGrantResource(level15, CAULDRON_UID)).toEqual(expect.objectContaining({
			grantId: cauldron.grantId,
			current: 1,
			max: 1,
			linkedInnateSpellId: cauldron.id,
		}));

		expect(getGrant(makeState({level: 20, subclass: EFA_TCE_ALCHEMIST}), LESSER_RESTORATION_UID)).toBeUndefined();
		expect(getGrant(makeState({source: "TCE", level: 20, subclass: TCE_ALCHEMIST}), LESSER_RESTORATION_UID)).toBeUndefined();
		expect(getGrant(makeState({source: "TCE", level: 20, subclass: EFA_ALCHEMIST}), LESSER_RESTORATION_UID)).toBeUndefined();
	});

	test("preserves spent Lesser Restoration uses when Intelligence changes", () => {
		const state = makeState({level: 15, intelligence: 18});
		const lesser = getGrant(state, LESSER_RESTORATION_UID);
		expect(state.useInnateSpell(lesser.id)).toBe(true);
		expect(state.useInnateSpell(lesser.id)).toBe(true);
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 2, max: 4});

		state.setAbilityBase("int", 14);
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 0, max: 2});
		expect(getGrantResource(state, LESSER_RESTORATION_UID)).toEqual(expect.objectContaining({current: 0, max: 2}));

		state.setAbilityBase("int", 20);
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 3, max: 5});
		expect(getGrantResource(state, LESSER_RESTORATION_UID)).toEqual(expect.objectContaining({current: 3, max: 5}));
	});

	test("spends no prepared allowance or spell slot and restores both grants on Long Rest", () => {
		const state = makeState({level: 15});
		state._data.spellcasting.spellSlots[1] = {current: 2, max: 4};
		const preparedMax = state.getMaxPreparedSpells("Artificer");
		const lesser = getGrant(state, LESSER_RESTORATION_UID);
		const cauldron = getGrant(state, CAULDRON_UID);
		const spellsController = makeSpellsController(state);

		expect(state.getSpellsKnown().filter(spell => [LESSER_RESTORATION_UID, CAULDRON_UID].includes(`${spell.name}|${spell.source}`))).toEqual([]);
		expect(spellsController._renderInnateSpellItem(lesser).querySelector(".charsheet__innate-cast")).toBeNull();
		expect(spellsController._renderInnateSpellItem(cauldron).querySelector(".charsheet__innate-cast")).toBeNull();
		expect(state.useInnateSpell(lesser.id)).toBe(true);
		expect(state.useInnateSpell(cauldron.id)).toBe(true);
		expect(state._data.spellcasting.spellSlots[1]).toEqual({current: 2, max: 4});
		expect(state.getMaxPreparedSpells("Artificer")).toBe(preparedMax);
		expect(getGrantResource(state, LESSER_RESTORATION_UID).current).toBe(3);
		expect(getGrantResource(state, CAULDRON_UID).current).toBe(0);

		state.onLongRest();
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 4, max: 4});
		expect(getGrant(state, CAULDRON_UID).uses).toEqual({current: 1, max: 1});
		expect(getGrantResource(state, LESSER_RESTORATION_UID).current).toBe(4);
		expect(getGrantResource(state, CAULDRON_UID).current).toBe(1);
	});

	test("round-trips and repairs owned metadata idempotently without refunding spent uses", () => {
		const state = makeState({level: 15});
		const lesser = getGrant(state, LESSER_RESTORATION_UID);
		expect(state.useInnateSpell(lesser.id)).toBe(true);
		const saved = state.toJson();
		const savedLesser = saved.spellcasting.innateSpells.find(spell => spell.spellUid === LESSER_RESTORATION_UID);
		const savedResource = saved.resources.find(resource => resource.spellUid === LESSER_RESTORATION_UID);
		delete savedLesser.grantId;
		delete savedLesser.linkedResourceId;
		delete savedResource.grantId;
		delete savedResource.linkedInnateSpellId;
		saved.spellcasting.innateSpells.push({...copy(savedLesser), id: "duplicate-owned-lesser"});
		saved.resources.push({...copy(savedResource), id: "duplicate-owned-lesser-resource"});

		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		loaded.loadFromJson(saved);
		expect(loaded.getInnateSpells().filter(spell => spell.ownerUid === OWNER_UID && spell.spellUid === LESSER_RESTORATION_UID)).toHaveLength(1);
		expect(loaded.getResources().filter(resource => resource.ownerUid === OWNER_UID && resource.spellUid === LESSER_RESTORATION_UID)).toHaveLength(1);
		expect(getGrant(loaded, LESSER_RESTORATION_UID).uses).toEqual({current: 3, max: 4});

		const once = loaded.toJson();
		loaded.applyClassFeatureEffects();
		expect(loaded.toJson()).toEqual(once);
		const reloaded = new CharacterSheetState();
		reloaded.setSpellData(XPHB_SPELLS);
		reloaded.loadFromJson(once);
		expect(reloaded.toJson()).toEqual(once);
	});

	test("keeps independent prepared and innate copies isolated from EFA ownership cleanup", () => {
		let independentInnateId;
		const state = makeState({
			level: 15,
			beforeClass: current => {
				addPreparedSpell(current, "Lesser Restoration");
				independentInnateId = current.addInnateSpell({
					name: "Tasha's Bubbling Cauldron",
					source: "XPHB",
					spellcastingAbility: "int",
					uses: {current: 1, max: 1},
					maxUses: 1,
					recharge: "long",
					sourceFeature: "Independent Boon",
				});
			},
		});

		expect(state.getInnateSpells().filter(spell => spell.name === "Tasha's Bubbling Cauldron" && spell.source === "XPHB")).toHaveLength(2);
		expect(state.getPreparedSpells().some(spell => spell.name === "Lesser Restoration" && spell.source === "XPHB")).toBe(true);

		state.setSubclass("Artificer", subclassSnapshot(EFA_TCE_ALCHEMIST));
		expect(getGrant(state, LESSER_RESTORATION_UID)).toBeUndefined();
		expect(getGrant(state, CAULDRON_UID)).toBeUndefined();
		expect(state.getPreparedSpells().some(spell => spell.name === "Lesser Restoration" && spell.source === "XPHB")).toBe(true);
		expect(state.getInnateSpells().find(spell => spell.id === independentInnateId)).toEqual(expect.objectContaining({
			name: "Tasha's Bubbling Cauldron",
			sourceFeature: "Independent Boon",
		}));
		expect(state.getResources().filter(resource => resource.ownerUid === OWNER_UID)).toEqual([]);
	});

	test("removing the EFA parent removes only its owned grant/resource state", () => {
		const state = makeState({
			level: 15,
			beforeClass: current => {
				addPreparedSpell(current, "Tasha's Bubbling Cauldron");
				current.addResource({
					id: "player-cauldron-tracker",
					name: "Tasha's Bubbling Cauldron (Chemical Mastery)",
					current: 2,
					max: 3,
					recharge: "long",
				});
			},
		});
		expect(getGrant(state, LESSER_RESTORATION_UID)).toBeDefined();
		expect(getGrant(state, CAULDRON_UID)).toBeDefined();
		expect(state.getResources().find(resource => resource.id === "player-cauldron-tracker")).toBeDefined();

		state.removeClass("Artificer", "EFA");
		expect(state.getInnateSpells().filter(spell => spell.ownerUid === OWNER_UID)).toEqual([]);
		expect(state.getResources().filter(resource => resource.ownerUid === OWNER_UID)).toEqual([]);
		expect(state.getResources().find(resource => resource.id === "player-cauldron-tracker")).toEqual(expect.objectContaining({current: 2, max: 3}));
		expect(state.getPreparedSpells().some(spell => spell.name === "Tasha's Bubbling Cauldron" && spell.source === "XPHB")).toBe(true);
	});
});
