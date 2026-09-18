import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import {CharacterSheetItemTransfer} from "../../../js/charactersheet/charactersheet-item-transfer.js";
import {CharacterSheetSpellTransfer} from "../../../js/charactersheet/charactersheet-spell-transfer.js";
import {CharacterSheetState} from "../../../js/charactersheet/charactersheet-state.js";

function getStorage (characters = []) {
	const data = new Map([["charsheet-characters", MiscUtil.copyFast(characters)]]);
	return {
		data,
		async pGet (key) {
			return data.has(key) ? MiscUtil.copyFast(data.get(key)) : null;
		},
		async pSet (key, value) {
			data.set(key, MiscUtil.copyFast(value));
		},
	};
}

function getSpell ({
	name = "Fireball",
	source = "PHB",
	level = 3,
	classNames = ["Wizard", "Sorcerer"],
} = {}) {
	return {
		name,
		source,
		level,
		school: "V",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 150}},
		components: {v: true, s: true, m: "sulfur"},
		duration: [{type: "instant"}],
		classes: {
			fromClassList: classNames.map(className => ({name: className, source: "PHB"})),
		},
	};
}

function addCaster (state, {
	name,
	source = "PHB",
	level = 5,
	subclass = null,
	type = "known",
	cantrips = 2,
	spells = 4,
} = {}) {
	const progression = Array(20).fill(spells);
	state.addClass({
		name,
		source,
		level,
		subclass,
		casterProgression: "full",
		spellcastingAbility: name === "Wizard" ? "int" : "cha",
		cantripProgression: Array(20).fill(cantrips),
		...(type === "known"
			? {spellsKnownProgression: progression}
			: {preparedSpellsProgression: progression}),
	});
}

describe("CharacterSheetSpellTransfer transport", () => {
	it("queues, applies, routes, and acknowledges cantrips and leveled spells", async () => {
		const storage = getStorage([{id: "char-1", name: "Mira"}]);
		const cantrip = await CharacterSheetSpellTransfer.pQueue({
			storage,
			characterId: "char-1",
			spell: getSpell({name: "Fire Bolt", level: 0}),
			attribution: {sourceFeature: "Cantrips Known", sourceClass: "Wizard"},
		});
		const leveled = await CharacterSheetSpellTransfer.pQueue({
			storage,
			characterId: "char-1",
			spell: getSpell(),
			attribution: {sourceFeature: "Wizard Spellbook", sourceClass: "Wizard"},
		});

		const state = new CharacterSheetState();
		const result = await CharacterSheetSpellTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});

		expect(result.applied).toHaveLength(2);
		expect(state.getCantripsKnown()).toEqual([
			expect.objectContaining({
				name: "Fire Bolt",
				sourceFeature: "Cantrips Known",
				sourceClass: "Wizard",
			}),
		]);
		expect(state.getSpellsKnown()).toEqual([
			expect.objectContaining({
				name: "Fireball",
				sourceFeature: "Wizard Spellbook",
				sourceClass: "Wizard",
				inSpellbook: true,
			}),
		]);

		await CharacterSheetSpellTransfer.pAcknowledge({
			storage,
			transferIds: [cantrip.id, leveled.id],
		});
		expect(await storage.pGet(CharacterSheetSpellTransfer.STORAGE_KEY)).toEqual([]);
	});

	it("broadcasts the queued target without exposing the spell payload", async () => {
		const original = globalThis.BroadcastChannel;
		const posted = [];
		globalThis.BroadcastChannel = class {
			constructor (name) { this.name = name; }
			postMessage (data) { posted.push({name: this.name, data}); }
			close () {}
		};
		try {
			await CharacterSheetSpellTransfer.pQueue({
				storage: getStorage([{id: "char-1"}]),
				characterId: "char-1",
				spell: getSpell(),
			});
			expect(posted).toEqual([{
				name: CharacterSheetSpellTransfer.CHANNEL_NAME,
				data: {type: "queued", characterId: "char-1"},
			}]);
		} finally {
			globalThis.BroadcastChannel = original;
		}
	});

	it("keeps replay idempotent across a saved-state round trip", async () => {
		const storage = getStorage([{id: "char-1"}]);
		await CharacterSheetSpellTransfer.pQueue({
			storage,
			characterId: "char-1",
			spell: getSpell(),
			attribution: {sourceFeature: "Spells Known", sourceClass: "Sorcerer"},
		});

		const firstState = new CharacterSheetState();
		const first = await CharacterSheetSpellTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state: firstState,
		});
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(firstState.toJson());
		const replay = await CharacterSheetSpellTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state: reloaded,
		});

		expect(first.applied).toHaveLength(1);
		expect(replay.applied).toHaveLength(0);
		expect(replay.acknowledgeIds).toHaveLength(1);
		expect(reloaded.getSpellsKnown()).toHaveLength(1);
	});

	it("merges an exact duplicate instead of creating a second row", async () => {
		const storage = getStorage([{id: "char-1"}]);
		const state = new CharacterSheetState();
		state.addSpell({name: "Fireball", source: "PHB", level: 3});
		await CharacterSheetSpellTransfer.pQueue({
			storage,
			characterId: "char-1",
			spell: getSpell(),
			attribution: {sourceFeature: "Spells Known", sourceClass: "Sorcerer"},
		});

		await CharacterSheetSpellTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});

		expect(state.getSpellsKnown()).toHaveLength(1);
		expect(state.getSpellsKnown()[0]).toMatchObject({
			sourceFeature: "Spells Known",
			sourceClass: "Sorcerer",
		});
	});

	it("preserves selected subclass attribution and supports an unattributed override", async () => {
		const storage = getStorage([{id: "char-1"}]);
		await CharacterSheetSpellTransfer.pQueue({
			storage,
			characterId: "char-1",
			spell: getSpell({name: "Guidance", level: 0, classNames: ["Cleric"]}),
			attribution: {
				sourceFeature: "Cantrips Known",
				sourceClass: "Sorcerer",
				sourceSubclass: "Divine Soul",
			},
		});
		await CharacterSheetSpellTransfer.pQueue({
			storage,
			characterId: "char-1",
			spell: getSpell({name: "Hex", level: 1, classNames: ["Warlock"]}),
			attribution: null,
		});

		const state = new CharacterSheetState();
		await CharacterSheetSpellTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});

		expect(state.getCantripsKnown()[0]).toMatchObject({
			sourceClass: "Sorcerer",
			sourceSubclass: "Divine Soul",
		});
		expect(state.getSpellsKnown()[0]).toMatchObject({
			name: "Hex",
			sourceFeature: null,
			sourceClass: null,
			sourceSubclass: null,
		});
	});

	it("rolls back malformed transfers and leaves them pending for a repaired retry", async () => {
		const storage = getStorage([{id: "char-1"}]);
		const transfer = await CharacterSheetSpellTransfer.pQueue({
			storage,
			characterId: "char-1",
			spell: getSpell(),
		});
		const queued = await storage.pGet(CharacterSheetSpellTransfer.STORAGE_KEY);
		queued[0].spell.source = null;
		await storage.pSet(CharacterSheetSpellTransfer.STORAGE_KEY, queued);

		const state = new CharacterSheetState();
		state.setName("Before");
		const failed = await CharacterSheetSpellTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});
		expect(failed.failed).toHaveLength(1);
		expect(failed.acknowledgeIds).toHaveLength(0);
		expect(state.getName()).toBe("Before");
		expect(state.getSpellsKnown()).toHaveLength(0);
		expect(await storage.pGet(CharacterSheetSpellTransfer.STORAGE_KEY)).toHaveLength(1);

		queued[0].spell.source = "PHB";
		await storage.pSet(CharacterSheetSpellTransfer.STORAGE_KEY, queued);
		const retry = await CharacterSheetSpellTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});
		expect(retry.applied.map(it => it.id)).toEqual([transfer.id]);
		expect(state.getSpellsKnown()).toHaveLength(1);
	});

	it("retains item-transfer compatibility through the shared transport", async () => {
		const storage = getStorage([{id: "char-1"}]);
		await CharacterSheetItemTransfer.pQueue({
			storage,
			characterId: "char-1",
			item: {name: "Rope", source: "PHB", type: "G"},
		});
		const state = new CharacterSheetState();
		const result = await CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});
		expect(result.applied).toHaveLength(1);
		expect(state.getItems()).toEqual([expect.objectContaining({name: "Rope", quantity: 1})]);
	});
});

describe("CharacterSheetSpellTransfer attribution and warnings", () => {
	it("recommends one eligible class and marks another spellcasting class as off-list", () => {
		const state = new CharacterSheetState();
		addCaster(state, {name: "Wizard", type: "prepared"});
		addCaster(state, {name: "Cleric", type: "prepared"});
		const model = CharacterSheetSpellTransfer.getAttributionModel({
			spell: getSpell({classNames: ["Wizard"]}),
			state,
		});

		expect(model.eligibleOptions.map(it => it.label)).toEqual(["Wizard"]);
		expect(model.recommendedOption.label).toBe("Wizard");
		expect(model.options.find(it => it.label === "Cleric")).toMatchObject({isEligible: false});
	});

	it("recognizes subclass expanded-list eligibility and stamps the subclass", () => {
		const state = new CharacterSheetState();
		addCaster(state, {
			name: "Sorcerer",
			subclass: {name: "Divine Soul", source: "XGE"},
		});
		const classData = [{
			name: "Sorcerer",
			source: "PHB",
			subclasses: [{
				name: "Divine Soul",
				shortName: "Divine Soul",
				source: "XGE",
				additionalSpells: [{expanded: {"1": [{"all": "class=Cleric"}]}}],
			}],
		}];
		const model = CharacterSheetSpellTransfer.getAttributionModel({
			spell: getSpell({name: "Guidance", level: 0, classNames: ["Cleric"]}),
			state,
			classData,
		});

		expect(model.eligibleOptions).toHaveLength(1);
		expect(model.eligibleOptions[0]).toMatchObject({
			eligibility: "subclass",
			attribution: {
				sourceFeature: "Cantrips Known",
				sourceClass: "Sorcerer",
				sourceSubclass: "Divine Soul",
			},
		});
	});

	it("builds advisory duplicate, mismatch, unattributed, and limit warnings without blocking", () => {
		const state = new CharacterSheetState();
		addCaster(state, {name: "Sorcerer", spells: 1});
		state.addSpell({
			name: "Fireball",
			source: "PHB",
			level: 3,
			sourceFeature: "Spells Known",
			sourceClass: "Sorcerer",
		});
		const model = CharacterSheetSpellTransfer.getAttributionModel({
			spell: getSpell({classNames: ["Wizard"]}),
			state,
		});
		const sorcerer = model.options.find(it => it.label === "Sorcerer");
		const mismatched = CharacterSheetSpellTransfer.getAdvisoryWarnings({
			spell: getSpell({classNames: ["Wizard"]}),
			state,
			option: sorcerer,
			eligibleOptions: model.eligibleOptions,
		});
		const unattributed = CharacterSheetSpellTransfer.getAdvisoryWarnings({
			spell: getSpell({classNames: ["Wizard"]}),
			state,
			option: model.options.find(it => it.isUnattributed),
			eligibleOptions: model.eligibleOptions,
		});

		expect(mismatched.map(it => it.code)).toEqual(expect.arrayContaining([
			"duplicate",
			"no-eligible-attribution",
			"class-list-mismatch",
			"spell-limit",
		]));
		expect(unattributed.map(it => it.code)).toEqual(expect.arrayContaining([
			"duplicate",
			"no-eligible-attribution",
			"unattributed",
		]));
		const unattributedWarning = unattributed.find(it => it.code === "unattributed");
		expect(unattributedWarning.message).toContain("class-specific spellcasting stats");
		expect(unattributedWarning.message).toContain("Prepare control");
		expect(unattributedWarning.message).toContain("re-added and attributed to a class");
	});

	it("keeps the unattributed cantrip warning free of leveled-spell Prepare guidance", () => {
		const spell = getSpell({name: "Guidance", level: 0, classNames: ["Cleric"]});
		const warnings = CharacterSheetSpellTransfer.getAdvisoryWarnings({
			spell,
			state: new CharacterSheetState(),
			option: {isUnattributed: true},
		});
		const warning = warnings.find(it => it.code === "unattributed");

		expect(warning.message).toContain("Other / Unattributed");
		expect(warning.message).not.toContain("Prepare control");
	});

	it("warns for reached cantrip and prepared-spell limits", () => {
		const cantripState = new CharacterSheetState();
		addCaster(cantripState, {name: "Sorcerer", cantrips: 1});
		cantripState.addCantrip({
			name: "Mage Hand",
			source: "PHB",
			level: 0,
			sourceFeature: "Cantrips Known",
			sourceClass: "Sorcerer",
		});
		const cantrip = getSpell({name: "Fire Bolt", level: 0, classNames: ["Sorcerer"]});
		const cantripModel = CharacterSheetSpellTransfer.getAttributionModel({spell: cantrip, state: cantripState});
		expect(CharacterSheetSpellTransfer.getAdvisoryWarnings({
			spell: cantrip,
			state: cantripState,
			option: cantripModel.recommendedOption,
			eligibleOptions: cantripModel.eligibleOptions,
		}).map(it => it.code)).toContain("cantrip-limit");

		const preparedState = new CharacterSheetState();
		addCaster(preparedState, {name: "Cleric", type: "prepared", spells: 1});
		preparedState.addSpell({
			name: "Bless",
			source: "PHB",
			level: 1,
			sourceFeature: "Prepared Spells",
			sourceClass: "Cleric",
		});
		const prepared = getSpell({name: "Healing Word", level: 1, classNames: ["Cleric"]});
		const preparedModel = CharacterSheetSpellTransfer.getAttributionModel({spell: prepared, state: preparedState});
		const preparedWarnings = CharacterSheetSpellTransfer.getAdvisoryWarnings({
			spell: prepared,
			state: preparedState,
			option: preparedModel.recommendedOption,
			eligibleOptions: preparedModel.eligibleOptions,
		});
		expect(preparedWarnings).toEqual(expect.arrayContaining([
			expect.objectContaining({
				code: "spell-limit",
				message: expect.stringContaining("prepared limit"),
			}),
		]));
	});
});
