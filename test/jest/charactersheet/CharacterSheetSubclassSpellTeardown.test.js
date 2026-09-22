import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const XPHB_SPELLS = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/spells/spells-xphb.json"),
	"utf8",
)).spell;

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const CARTOGRAPHER = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Cartographer"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const CARTOGRAPHER_SPELL_UIDS = [
	"Faerie Fire|XPHB",
	"Guiding Bolt|XPHB",
	"Healing Word|XPHB",
];
const SPELLLESS_SUBCLASS = {
	name: "Spell-less Specialist",
	shortName: "Spell-less Specialist",
	source: "EFA",
	additionalSpells: [],
};

const copy = value => JSON.parse(JSON.stringify(value));
const spellUid = spell => `${spell.name}|${spell.source}`;

function subclassSnapshot ({source = "EFA"} = {}) {
	return {
		name: CARTOGRAPHER.name,
		shortName: CARTOGRAPHER.shortName,
		source,
		additionalSpells: copy(CARTOGRAPHER.additionalSpells),
	};
}

function classEntry ({source = "EFA", subclassSource = source, level = 3} = {}) {
	return {
		name: EFA_ARTIFICER.name,
		source,
		level,
		spellcastingAbility: EFA_ARTIFICER.spellcastingAbility,
		casterProgression: EFA_ARTIFICER.casterProgression,
		preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
		cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
		subclass: subclassSnapshot({source: subclassSource}),
	};
}

function makeState () {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	return state;
}

function getCartographerSpells (state) {
	return state.getSpellsKnown().filter(spell => CARTOGRAPHER_SPELL_UIDS.includes(spellUid(spell)));
}

function addCompleteLevelHistory (state) {
	state._data.levelHistory = [1, 2, 3].map(level => ({
		level,
		class: {name: "Artificer", source: "EFA"},
		classLevel: level,
		choices: level === 3
			? {subclass: {name: "Cartographer", shortName: "Cartographer", source: "EFA"}}
			: {},
		complete: true,
		timestamp: level,
	}));
}

function addPlayerOwnedCartographerSpells (state) {
	for (const uid of CARTOGRAPHER_SPELL_UIDS) {
		const [name, source] = uid.split("|");
		const spell = XPHB_SPELLS.find(it => it.name === name && it.source === source);
		state.addSpell({
			...spell,
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
			prepared: false,
		}, false);
	}
}

describe("state-level subclass spell teardown", () => {
	test("removing Cartographer level 3 tears down its exact spell owner before the subclass is cleared", () => {
		const state = makeState();
		state.addClass(classEntry());
		addCompleteLevelHistory(state);
		expect(getCartographerSpells(state).map(spellUid).sort()).toEqual([...CARTOGRAPHER_SPELL_UIDS].sort());

		const result = state.removeClassLastLevel("Artificer", "EFA");

		expect(result).toMatchObject({success: true, removed: {classLevel: 3}});
		expect(state.getClasses()[0]).toMatchObject({level: 2, subclass: null});
		expect(getCartographerSpells(state)).toEqual([]);
	});

	test.each([
		["setSubclass", state => state.setSubclass("Artificer", SPELLLESS_SUBCLASS)],
		["addClass", state => state.addClass({...classEntry(), subclass: SPELLLESS_SUBCLASS})],
	])("%s replacement restores colliding player-owned spell metadata", (_transitionName, replaceSubclass) => {
		const state = makeState();
		addPlayerOwnedCartographerSpells(state);
		state.addClass(classEntry());

		replaceSubclass(state);

		expect(getCartographerSpells(state)).toHaveLength(3);
		for (const spell of getCartographerSpells(state)) {
			expect(spell).toMatchObject({
				sourceFeature: "Prepared Spells",
				sourceClass: "Artificer",
				prepared: false,
				alwaysPrepared: false,
			});
			expect(spell.subclassSpellGrantOwners).toBeUndefined();
			expect(spell.subclassSpellGrantOriginalMetadata).toBeUndefined();
		}
	});

	test("save/load replacement removes only the exact EFA owner and preserves a same-label foreign-source grant", () => {
		const state = makeState();
		addPlayerOwnedCartographerSpells(state);
		state.addClass(classEntry());
		state.addClass(classEntry({source: "TCE", subclassSource: "TCE"}));

		const loaded = makeState();
		loaded.loadFromJson(state.toJson());
		loaded.setSubclass("Artificer", SPELLLESS_SUBCLASS);

		const foreignOwner = loaded.getSubclassSpellGrantOwner(
			loaded.getClasses().find(cls => cls.source === "TCE"),
			{sourceFeature: "Cartographer Spells"},
		);
		for (const spell of getCartographerSpells(loaded)) {
			expect(spell.subclassSpellGrantOwners).toEqual([foreignOwner]);
			expect(spell.subclassSpellGrantOriginalMetadata).toEqual({
				present: ["alwaysPrepared", "prepared", "sourceFeature", "sourceClass"],
				values: {
					alwaysPrepared: false,
					prepared: false,
					sourceFeature: "Prepared Spells",
					sourceClass: "Artificer",
				},
			});
			expect(spell).toMatchObject({
				sourceFeature: "Cartographer Spells",
				alwaysPrepared: true,
				prepared: true,
			});
		}
	});
});
