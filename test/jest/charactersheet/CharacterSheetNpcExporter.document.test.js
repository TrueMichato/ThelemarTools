import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetNpcExporter as Exporter} from "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {getNpcExportSchemaErrors} from "../../util-npc-export-schema.js";
import {CharacterSheetExport} from "../../../js/charactersheet/charactersheet-export.js";

const State = globalThis.CharacterSheetState;
const copy = value => JSON.parse(JSON.stringify(value));
const creatures = ["efa", "tce"].flatMap(source => JSON.parse(fs.readFileSync(`data/bestiary/bestiary-${source}.json`, "utf8")).monster);
const ownerUid = source => `Steel Defender|Artificer|${source}|Battle Smith|${source}|3|${source}`;
const text = value => JSON.stringify(value);

function makeOwner (source = "EFA", level = 15) {
	const state = new State();
	state.setId("document-owner");
	state.setName("Artificer Owner");
	state.addClass({name: "Artificer", source, level, spellcastingAbility: "int", subclass: {name: "Battle Smith", shortName: "Battle Smith", source}});
	state.setAbilityBase("int", 20);
	state.recalculateHp({syncCurrent: true});
	state.addFeature({
		name: "Steel Defender",
		source,
		className: "Artificer",
		classSource: source,
		subclassShortName: "Battle Smith",
		subclassSource: source,
		level: 3,
		featureType: "Subclass",
		entries: ["You can create your Steel Defender companion."],
	});
	return state;
}

function addDefender (state, source = "EFA", overrides = {}) {
	return state.addCompanion({
		name: "Steel Defender",
		source,
		type: State.COMPANION_TYPES.CLASS_SUMMON,
		featureGrant: {uid: ownerUid(source)},
		hp: {max: 20, current: 7, temp: 3},
		uses: {repair: {current: 0, max: 3, recharge: source === "EFA" ? "longRest" : "daily"}},
		...overrides,
	});
}

function makeReanimator (modifications) {
	const state = makeOwner("EFA", 15);
	state._data.classes[0].subclass = {name: "Reanimator", shortName: "Reanimator", source: "RHW"};
	state._data.features = [];
	state.addFeature({
		name: "Reanimated Companion",
		source: "RHW",
		className: "Artificer",
		classSource: "EFA",
		subclassShortName: "Reanimator",
		subclassSource: "RHW",
		level: 3,
		featureType: "Subclass",
		entries: ["You can create your Reanimated Companion."],
	});
	state.addCompanion({
		name: "Reanimated Companion",
		source: "RHW",
		type: State.COMPANION_TYPES.CLASS_SUMMON,
		featureGrant: {uid: "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW"},
		...(modifications ? {setup: {modifications}} : {}),
	});
	return state;
}

function build (state, mode, options = {}) {
	const result = Exporter.buildExportDocument(state, {sourceJson: "DOC", presentationMode: mode, creatureIndex: creatures, ...options});
	expect(result.validation.errors).toEqual([]);
	const strict = copy(result.document.monster);
	const knownDeviations = ["cooking", "harvesting", "linguistics|TGTT", "culture|TGTT", "engineering|TGTT", "might|TGTT", "endurance|TGTT"];
	for (const monster of strict) {
		for (const skill of knownDeviations.filter(key => Object.hasOwn(monster.skill || {}, key))) {
			expect(result.validation.warnings.join(" ")).toContain(skill);
			delete monster.skill[skill];
		}
	}
	expect(getNpcExportSchemaErrors({data: {monster: strict}, kind: "bestiary", filePath: "companion-document"})).toEqual([]);
	for (const monster of result.document.monster) {
		for (const match of text(monster).matchAll(/\{@creature ([^|}]+)\|DOC(?:\|[^}]*)?\}/g)) {
			expect(result.document.monster.some(entry => entry.name === match[1] && entry.source === "DOC")).toBe(true);
		}
	}
	return result;
}

describe.each(["complete", "compact"])("NPC export document (%s)", mode => {
	test.each([
		["EFA", 3, 20, 17, "1d8 + 7"],
		["EFA", 15, 80, 17, "1d8 + 7"],
		["TCE", 15, 82, 17, "1d8 + 5"],
	])("F44: %s level %s keeps source-scaled stats, full procedures, command costs and links", (source, level, hp, ac, damage) => {
		const state = makeOwner(source, level);
		addDefender(state, source);
		const result = build(state, mode);
		const [owner, companion] = result.document.monster;
		expect(result.document.monster).toHaveLength(2);
		expect(companion.hp.average).toBe(hp);
		expect(companion.ac[0].ac).toBe(ac);
		expect(companion).toMatchObject({str: 14, dex: 12, con: 14, int: 4, wis: 10, cha: 6, speed: {walk: 40}, immune: ["poison"]});
		expect(text(companion.action)).toContain(`{@hit ${state.getSpellAttackBonusForAbility("int")}}`);
		expect(text(companion.action)).toContain(`{@damage ${damage}}`);
		expect(text(companion.action)).toMatch(/itself.*Construct.*object.*5 feet/i);
		if (source === "EFA") expect(text(companion.action)).toMatch(/object.*(?:see|visible)/i);
		expect(text(companion.reaction)).toMatch(/(?:visible|can see).*5.*other than.*disadvantage/i);
		expect(text(companion.trait)).toMatch(/bonus action.*command/i);
		expect(text(companion.trait)).toMatch(/incapacitated.*(?:own|autonomous)/i);
		expect(text(companion.trait)).toContain(`{@creature ${owner.name}|DOC}`);
		expect(text(owner.trait)).toContain(`{@creature ${companion.name}|DOC}`);
		expect(text(companion)).toMatch(/7\/\d+ HP/);
		expect(text(companion)).toContain("0/3");
		expect(text(companion)).toMatch(source === "EFA" ? /long rest/i : /daily/i);
		if (source === "EFA") {
			expect(Object.keys(companion.save)).toHaveLength(6);
			expect(text(companion.trait)).toMatch(/during.*owner.*turn/i);
			expect(text(companion.trait)).toMatch(/ability check/i);
			expect(text(companion.trait)).not.toContain("Vigilant");
			expect(text(companion.trait)).toMatch(/touch.*slot.*1 minute/i);
			if (level >= 5) expect(text(companion.trait)).toMatch(/(?:replace|forgo).*one.*attack.*Rend/i);
			else expect(text(companion.trait)).not.toMatch(/(?:replace|forgo).*one.*attack/i);
		} else {
			expect(companion.save.dex).toBe("+6");
			expect(companion.skill.perception).toBe("+10");
			expect(text(companion.trait)).toMatch(/immediately after/i);
			expect(text(companion.trait)).toContain("Vigilant");
			expect(text(companion.trait)).not.toMatch(/(?:replace|forgo).*one.*attack/i);
			expect(text(companion.trait)).toContain("Mending");
		}
		if (level >= 9) {
			expect(text(companion.trait)).toMatch(/Arcane Jolt.*shared.*owner/i);
			expect(text(companion.trait)).toMatch(/once per turn/i);
			expect(text(companion.trait)).toMatch(/4d6/);
			expect(text(companion.reaction)).toContain("1d4 + 5");
		}
	});

	test("F44: detached assembly never invokes reconciling live getters or changes raw state/catalogs", () => {
		const state = makeOwner();
		addDefender(state);
		state._allItems = [{name: "Catalog Item", source: "PHB"}];
		const before = copy(state._data);
		const catalog = copy(state._allItems);
		const spies = ["toJson", "getCompanions", "getFeatures", "getResources", "getFeatureCalculations"].map(key =>
			jest.spyOn(state, key).mockImplementation(() => { throw new Error(`Live ${key} called`); }));
		try {
			build(state, mode);
			expect(state._data).toEqual(before);
			expect(state._allItems).toEqual(catalog);
			expect(globalThis.__csState).toBe(state);
		} finally {
			spies.forEach(spy => spy.mockRestore());
		}
	});

	test("F44: source-qualified no-record TCE projection does not create a live companion", () => {
		const state = makeOwner("TCE", 9);
		const before = copy(state._data);
		const result = build(state, mode);
		expect(result.document.monster).toHaveLength(2);
		expect(result.document.monster[1].hp.average).toBe(52);
		expect(state._data).toEqual(before);
	});

	test("F25/F44: retained owner source rules distinguish defender turns from owner commands and death", () => {
		const state = makeOwner("TCE", 9);
		const feature = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"))
			.subclassFeature.find(entry => entry.name === "Steel Defender" && entry.source === "TCE");
		expect(feature).toBeDefined();
		state._data.features[0].entries = copy(feature.entries);
		const owner = build(state, mode, {includeFeatures: "manual", selectedFeatureIds: [state._data.features[0].id]}).document.monster[0];
		const rules = Exporter._getPlainMatchTextCased(text(["trait", "action", "bonus", "reaction"].flatMap(section => owner[section] || [])));
		expect(rules).toMatch(/friendly to Artificer and Artificer's companions/);
		expect(rules).toMatch(/immediately after Artificer's/);
		expect(rules).toMatch(/unless Artificer takes a bonus action/);
		expect(rules).toMatch(/If Artificer is incapacitated/);
		expect(rules).toMatch(/defender also perishes if Artificer dies/);
	});

	test("F44: pending EFA setup is diagnosed instead of inventing a creature", () => {
		const state = makeOwner("EFA");
		expect(Exporter.getCompanionSourceUids(state)).toEqual([]);
		const result = build(state, mode);
		expect(result.document.monster).toHaveLength(1);
		expect(result.validation.warnings.join(" ")).toMatch(/Steel Defender.*(?:appearance|setup)/i);
		expect(result.report.omissions.some(row => /companion.*setup|setup.*companion/i.test(row.reason))).toBe(true);
	});

	test("F44: dismissed companions and missing RHW choices do not trigger irrelevant source loads", () => {
		const state = makeOwner("TCE");
		addDefender(state, "TCE", {active: false});
		expect(Exporter.getCompanionSourceUids(state)).toEqual([]);
		const reanimator = makeReanimator();
		expect(Exporter.getCompanionSourceUids(reanimator)).toEqual([]);
		const result = build(reanimator, mode);
		expect(result.document.monster).toHaveLength(1);
		expect(result.validation.warnings.join(" ")).toMatch(/modification setup is missing/i);
	});

	test.each([
		["ferocity", "gaunt", "moist"],
		["arcaneConduit", "bloated", "moist"],
	])("F44: source-shaped RHW template uses the real pure descriptor for %s/%s/%s", (...modifications) => {
		const state = makeReanimator(modifications);
		const sourceShaped = {name: "Reanimated Companion",
			source: "RHW",
			trait: [{name: "Source Procedure", entries: ["Keep this extra source procedure."]}]};
		const result = build(state, mode, {creatureIndex: [sourceShaped]});
		const companion = result.document.monster[1];
		expect(companion.hp.average).toBe(80);
		expect(companion.ac[0].ac).toBe(15);
		expect(companion.type).toBe("undead");
		expect(companion.immune).toEqual(["lightning"]);
		expect(companion.resist).toEqual(["necrotic", "poison"]);
		expect(companion.action[0].entries[0]).toContain(`{@hit ${state.getSpellAttackBonusForAbility("int")}}`);
		expect(text(companion.action)).toContain(modifications.includes("ferocity") ? "1d6 + 5" : "1d4 + 5");
		expect(text(companion.action)).toMatch(/ignores resistance.*opportunity attacks/i);
		expect(text(companion.trait)).toMatch(/Death Burst.*10-foot.*Dexterity.*half/i);
		expect(text(companion.trait)).toMatch(/Lightning Absorption.*regains HP/i);
		expect(text(companion.trait)).toContain("Keep this extra source procedure.");
		expect(text(companion.trait)).toMatch(/Magic action.*long rest.*slot.*1.*already active/i);
		expect(text(companion.trait)).toMatch(/expires.*long rest/i);
		expect(text(companion.trait)).toMatch(/harmless collapse.*not trigger Death Burst/i);
		expect(text(companion.trait)).toMatch(/1 inch.*attack roll.*10 feet.*5 acid/i);
		if (modifications.includes("gaunt")) {
			expect(companion.speed).toMatchObject({walk: 45, climb: 45, swim: 45});
			expect(text(companion.trait)).toMatch(/10-foot.*Wisdom.*frightened.*start.*next turn/i);
		} else {
			expect(companion.size).toEqual(["L"]);
			expect(text(companion.action)).toMatch(/10 feet away/i);
			expect(text(companion.trait)).toMatch(/4d4 \+ 5/);
			expect(text(companion.trait)).toMatch(/space.*owner.*senses.*Once per turn.*120 feet.*evocation or necromancy.*5/i);
		}
	});

	test("F44: scaling known procedures does not erase unrelated additional source actions", () => {
		const source = copy(creatures.find(entity => entity.name === "Steel Defender" && entity.source === "TCE"));
		source.action.push({name: "Additional Procedure", entries: ["Perform the complete extra source action."]});
		source.reaction.push({name: "Additional Reaction", entries: ["When the signal occurs, perform the source reaction."]});
		const result = build(makeOwner("TCE"), mode, {creatureIndex: [source]});
		expect(text(result.document.monster[1])).toContain("complete extra source action");
		expect(text(result.document.monster[1])).toContain("When the signal occurs");
	});

	test("F44: same-named foreign sources do not borrow a Steel Defender formula", () => {
		const state = makeOwner("HB");
		const result = build(state, mode);
		expect(result.document.monster).toHaveLength(1);
	});

	test("F44: a dismissed defender is not silently recreated from its owner's feature", () => {
		const state = makeOwner("TCE");
		addDefender(state, "TCE", {active: false, lifecycle: {status: "vanished"}});
		expect(build(state, mode).document.monster).toHaveLength(1);
	});

	test("F44: multiple same-named records get deterministic collision-safe links, never recursive exports", () => {
		const state = makeOwner("HB");
		for (let i = 0; i < 2; i++) {
			state.addCompanion({
				id: `familiar-${i}`,
				name: "Owl",
				customName: "Scout",
				source: "MM",
				type: State.COMPANION_TYPES.FAMILIAR,
				hp: {max: 1, current: 1},
				ac: 11,
				creatureType: "beast",
				actions: [{name: "Help", entries: ["The owl helps a creature."]}],
			});
		}
		const first = build(state, mode);
		const second = build(state, mode);
		expect(first.document.monster.map(entry => entry.name)).toEqual(second.document.monster.map(entry => entry.name));
		expect(new Set(first.document.monster.map(entry => entry.name.toLowerCase())).size).toBe(3);
	});

	test("F44: actor snapshots retain frozen level, empty pools, and no nested roster", () => {
		const state = makeOwner("TCE", 9);
		state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Artificer", sourceClassSource: "TCE"}, true);
		state.setSpellSlots(1, 0, 4);
		const prepared = state.prepareSimulacrumSnapshot({spellSource: "PHB"});
		expect(prepared.ok).toBe(true);
		const id = state.addCompanion(prepared.companionData);
		const snapshot = state.getCompanion(id).actorSnapshot;
		snapshot.state.spellcasting.spellSlots[1].current = 0;
		const before = copy(state._data);
		const result = build(state, mode);
		const actor = result.document.monster.find(entry => /Simulacrum/.test(entry.name));
		expect(actor).toBeDefined();
		expect(snapshot.state.companions).toEqual([]);
		expect(text(actor.spellcasting)).toMatch(/"slots":0/);
		expect(result.document.monster.some(entry => /Do not recurse/.test(entry.name))).toBe(false);
		expect(state._data).toEqual(before);
	});

	test("F44: invalid snapshots fail visibly rather than exporting a cached or owner fallback", () => {
		const state = makeOwner("HB");
		state._data.companions.push({name: "Corrupt", type: "custom", actorSnapshot: {version: -1}});
		expect(() => Exporter.buildExportDocument(state, {creatureIndex: creatures})).toThrow(/snapshot|actor/i);
	});

	test("F44: recursive snapshots are rejected, not expanded or silently repaired", () => {
		const state = makeOwner("TCE");
		const prepared = state.prepareSimulacrumSnapshot({spellSource: "PHB"});
		expect(prepared.ok).toBe(true);
		const id = state.addCompanion(prepared.companionData);
		state.getCompanion(id).actorSnapshot.state.companions.push({name: "Nested actor"});
		expect(() => Exporter.buildExportDocument(state, {creatureIndex: creatures})).toThrow(/snapshot/i);
	});

	test("F44: missing source procedures cannot produce a complete-looking bundle", () => {
		const state = makeOwner();
		addDefender(state);
		expect(() => Exporter.buildExportDocument(state)).toThrow(/Load.*Steel Defender\|EFA/);
	});
});

describe("NPC companion document destinations", () => {
	let savedGlobals;
	let store;
	let writes;
	let page;
	let enumSpy;
	beforeEach(() => {
		savedGlobals = {BrewUtil2: globalThis.BrewUtil2, InputUiUtil: globalThis.InputUiUtil, DataLoader: globalThis.DataLoader};
		store = {head: {docIdLocal: "editable"}, body: {_meta: {sources: []}, monster: [], item: []}};
		writes = [];
		globalThis.BrewUtil2 = {
			pGetOrCreateEditableBrewDoc: jest.fn(async () => store),
			pSetEditableBrewDoc: jest.fn(async value => { writes.push(copy(value)); store = copy(value); }),
		};
		enumSpy = jest.spyOn(globalThis.InputUiUtil, "pGetUserEnum").mockResolvedValue("Overwrite existing");
		page = Object.create(CharacterSheetExport.prototype);
	});
	afterEach(() => {
		enumSpy.mockRestore();
		Object.assign(globalThis, savedGlobals);
	});

	function document () {
		const state = makeOwner();
		addDefender(state);
		return build(state, "complete").document;
	}

	async function save (payload) {
		await page._pSaveNpcToEditableBrew(payload.monster[0], {
			sourceMeta: payload._meta.sources[0],
			companionItems: payload.item || [],
			companionMonsters: payload.monster.slice(1),
		});
	}

	function assertLinks () {
		for (const match of text(store.body.monster).matchAll(/\{@creature ([^|}]+)\|DOC(?:\|[^}]*)?\}/g)) {
			expect(store.body.monster.some(entry => entry.name === match[1] && entry.source === "DOC")).toBe(true);
		}
	}

	test("F44: editable-brew save persists the entire creature/item document in one write", async () => {
		const payload = document();
		payload.item = [{name: "Custom Dagger", source: "DOC", type: "M", rarity: "rare", bonusWeapon: "1"}];
		await save(payload);
		expect(writes).toHaveLength(1);
		expect(store.body.monster).toHaveLength(2);
		expect(store.body.item).toHaveLength(1);
		expect(store.body._meta.sources[0].json).toBe("DOC");
		assertLinks();
	});

	test("F44: Save as copy gives every creature a new identity and rewrites both link directions", async () => {
		const payload = document();
		await save(payload);
		const original = copy(store.body.monster);
		globalThis.InputUiUtil.pGetUserEnum.mockResolvedValue("Save as copy");
		await save(payload);
		expect(store.body.monster).toHaveLength(4);
		expect(store.body.monster.slice(0, 2)).toEqual(original);
		const copied = store.body.monster.slice(2);
		expect(copied[0].name).toContain("(Copy)");
		expect(copied[1].name).toContain(copied[0].name);
		expect(text(copied[0].trait)).toContain(`{@creature ${copied[1].name}|DOC}`);
		expect(text(copied[1].trait)).toContain(`{@creature ${copied[0].name}|DOC}`);
		expect(new Set(store.body.monster.map(entry => entry.uniqueId)).size).toBe(4);
		assertLinks();
	});

	test("F44: overwrite reuses its own companion identity without overwriting an unrelated collision", async () => {
		const payload = document();
		const collision = {...copy(payload.monster[1]), uniqueId: "foreign", trait: [{name: "Foreign Owner", entries: ["Unrelated creature."]}]};
		store.body.monster.push(collision);
		await save(payload);
		expect(store.body.monster).toHaveLength(3);
		expect(store.body.monster[0]).toEqual(collision);
		const own = copy(store.body.monster.slice(1));
		await save(payload);
		expect(store.body.monster[0]).toEqual(collision);
		expect(store.body.monster.slice(1).map(entry => entry.uniqueId)).toEqual(own.map(entry => entry.uniqueId));
		assertLinks();
	});

	test("F44: cancellation does not write even source metadata", async () => {
		const payload = document();
		await save(payload);
		writes.length = 0;
		const before = copy(store);
		globalThis.InputUiUtil.pGetUserEnum.mockResolvedValue("Cancel");
		await save(payload);
		expect(globalThis.InputUiUtil.pGetUserEnum).toHaveBeenCalled();
		expect(writes).toEqual([]);
		expect(store).toEqual(before);
	});

	test("F44: failed persistence leaves no partially saved owner/companion package", async () => {
		const payload = document();
		const before = copy(store);
		globalThis.BrewUtil2.pSetEditableBrewDoc.mockRejectedValue(new Error("Storage unavailable"));
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			await save(payload);
			expect(globalThis.BrewUtil2.pSetEditableBrewDoc).toHaveBeenCalledTimes(1);
			expect(store).toEqual(before);
			expect(error).toHaveBeenCalled();
		} finally { error.mockRestore(); }
	});

	test("F44: preview cache registration carries every creature but never mutates the payload", () => {
		const payload = document();
		const before = copy(payload);
		let cached;
		globalThis.DataLoader = {_pCache_addToCache: value => { cached = value; value.allDataMerged.monster[1].trait[0].entries.push("Cache-only mutation"); }};
		page._registerNpcCreatureHovers(payload.monster);
		expect(cached.allDataMerged.monster).toHaveLength(2);
		expect([...cached.propAllowlist]).toEqual(["monster"]);
		expect(cached.allDataMerged.monster.every(entry => entry.__prop === "monster")).toBe(true);
		expect(payload).toEqual(before);
	});
});
