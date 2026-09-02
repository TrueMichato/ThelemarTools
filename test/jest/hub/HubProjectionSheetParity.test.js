import fs from "node:fs";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {buildCharacterViewModel} from "../../../server/src/character-projection.js";
import {getDerivedStats} from "../../../server/src/character-derived-stats.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SKILLS = ["stealth", "arcana", "athletics", "perception", "persuasion", "linguistics"];

/**
 * Build the stored document and the sheet a player would see after loading it.
 *
 * The comparison deliberately uses a *reloaded* sheet. `toJson()` → `loadFromJson()` is
 * exactly the round-trip a cloud character makes, and some `customModifiers` are derived
 * on load rather than persisted, so comparing against the pre-save in-memory sheet would
 * assert against a state no reader ever sees.
 */
function getFixture (mutate, authorWith = null) {
	const authored = new CharacterSheetState();
	mutate(authored._data);
	authorWith?.(authored);
	const document = JSON.parse(JSON.stringify(authored.toJson()));
	const reloaded = new CharacterSheetState();
	reloaded.loadFromJson(JSON.parse(JSON.stringify(document)));
	return {document, sheet: reloaded};
}

/**
 * Derived statistics come from a real `CharacterSheetState`, so these fixtures assert the
 * projection cannot drift from the sheet. Three earlier review rounds each found a
 * different term missing from a hand-written port — proficiency-bonus items, Blood Hunter
 * Dark Augmentation, TGTT Linguistics, dynamic feature modifiers — which is why the port
 * was replaced by the authority itself.
 */
describe("projection versus Character Sheet parity", () => {
	const cases = {
		"proficiency bonus from a magic item": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Rogue", level: 5}],
				saveProficiencies: ["dex"],
				skillProficiencies: {stealth: 1},
			});
			data.itemBonuses.proficiencyBonus = 1;
		},
		"blood hunter dark augmentation": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 16, con: 12, int: 16, wis: 10, cha: 10},
				classes: [{name: "Blood Hunter", level: 10}],
				saveProficiencies: ["dex"],
			});
		},
		"tgtt linguistics languages": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10},
				classes: [{name: "Bard", level: 4}],
				languages: ["Common", "Elvish", "Dwarvish", "Orcish"],
			});
			data.settings.enableTgtt = true;
			data.settings.thelemar_linguisticsBonus = true;
		},
		"paladin aura of protection": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 18},
				classes: [{name: "Paladin", level: 6}],
				saveProficiencies: ["wis"],
			});
		},
		"jack of all trades": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 14},
				classes: [{name: "Bard", level: 5}],
				skillProficiencies: {persuasion: 1},
				features: [{name: "Jack of All Trades"}],
			});
		},
		"expertise and blanket item check bonus": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 18, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Rogue", level: 7}],
				skillProficiencies: {stealth: 2, perception: 1},
			});
			data.itemBonuses.abilityCheck = 1;
			data.itemBonuses.abilityCheckDex = 2;
		},
		"blanket and per-ability save items": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Rogue", level: 5}],
				saveProficiencies: ["dex"],
			});
			data.itemBonuses.savingThrow = 1;
			data.itemBonuses.savingThrowDex = 2;
		},
		"legacy saves key beside a zeroed savingThrow": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Fighter", level: 4}],
				saveProficiencies: ["str"],
			});
			data.itemBonuses.savingThrow = 0;
			data.itemBonuses.saves = 3;
		},
		"proficiency bonus from a named modifier": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Rogue", level: 5}],
				saveProficiencies: ["dex"],
				skillProficiencies: {stealth: 1},
			});
		},
		"custom ability check and skill modifiers": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 12, con: 12, int: 14, wis: 10, cha: 10},
				classes: [{name: "Wizard", level: 5}],
				skillProficiencies: {arcana: 1},
			});
			Object.assign(data.customModifiers.abilityChecks, {int: 2});
			Object.assign(data.customModifiers.skills, {arcana: 1, _all: 1});
		},
	};

	// A few cases must be authored through the sheet's own API rather than by writing
	// `_data`, because the value they exercise is derived on load rather than stored.
	const authors = {
		"proficiency bonus from a named modifier": sheet => sheet.addNamedModifier({name: "Ring of Mastery", type: "proficiencyBonus", value: 2, enabled: true}),
	};

	for (const [name, mutate] of Object.entries(cases)) {
		it(`matches the Character Sheet for ${name}`, () => {
			const {document, sheet} = getFixture(mutate, authors[name]);
			const projected = buildCharacterViewModel(document);

			for (const ability of ABILITIES) {
				expect({name, ability, modifier: projected.saves[ability]?.modifier})
					.toEqual({name, ability, modifier: sheet.getSaveMod(ability)});
				expect({name, ability, score: projected.abilities[ability]})
					.toEqual({name, ability, score: sheet.getAbilityScore(ability)});
			}
			for (const skill of SKILLS) {
				expect({name, skill, modifier: projected.skills[skill]?.modifier})
					.toEqual({name, skill, modifier: sheet.getSkillMod(skill)});
			}
			expect({name, ac: projected.ac.value}).toEqual({name, ac: sheet.getAC()});
		});
	}

	it("omits derived fields rather than guessing when the sheet cannot read a document", () => {
		// Numbers the projection cannot stand behind are worse than absent ones: a wrong
		// modifier would silently disagree with the sheet the owner reads.
		expect(getDerivedStats({characterData: null, abilityKeys: ABILITIES, skillKeys: SKILLS})).toBeNull();
		expect(getDerivedStats({characterData: "nope", abilityKeys: ABILITIES, skillKeys: SKILLS})).toBeNull();

		const projected = buildCharacterViewModel({name: "Broken", classes: "not-an-array"});
		expect(projected.saves).toEqual({});
		expect(projected.skills).toEqual({});
		expect(projected.identity.name).toBe("Broken");
	});

	it("reads a proficiency bonus from its source modifier, not the derived cache", () => {
		// `customModifiers` is a cache the sheet rebuilds on load, not stored input. A
		// fixture that writes it directly is discarded on reload — by the sheet as well as
		// by the projection — so parity fixtures must author through the sheet's API or
		// they silently assert a state no reader ever sees.
		const authored = new CharacterSheetState();
		Object.assign(authored._data, {
			abilities: {str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10},
			classes: [{name: "Rogue", level: 5}],
			saveProficiencies: ["dex"],
		});

		const direct = new CharacterSheetState();
		direct.loadFromJson(JSON.parse(JSON.stringify(authored.toJson())));
		direct._data.customModifiers.proficiencyBonus = 2;
		const afterDirectReload = new CharacterSheetState();
		afterDirectReload.loadFromJson(JSON.parse(JSON.stringify(direct.toJson())));
		// The sheet itself drops it, so there is nothing for a projection to carry.
		expect(afterDirectReload._data.customModifiers.proficiencyBonus).toBe(0);

		authored.addNamedModifier({name: "Ring of Mastery", type: "proficiencyBonus", value: 2, enabled: true});
		const document = JSON.parse(JSON.stringify(authored.toJson()));
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(JSON.parse(JSON.stringify(document)));

		// The named modifier is the stored source, so it survives and rebuilds the cache.
		expect(reloaded._data.customModifiers.proficiencyBonus).toBe(2);
		expect(reloaded.getProficiencyBonus()).toBe(authored.getProficiencyBonus());
		expect(buildCharacterViewModel(document).saves.dex.modifier).toBe(reloaded.getSaveMod("dex"));
	});

	it("ships every module the derivation needs into the server image", () => {
		const dockerfile = fs.readFileSync(new URL("../../../server/Dockerfile", import.meta.url), "utf8");
		const ignore = fs.readFileSync(new URL("../../../server/Dockerfile.dockerignore", import.meta.url), "utf8");

		// Reusing the sheet couples the server image to these files. Omitting one does not
		// fail a unit test — it fails container startup, which is a far worse place to
		// find out.
		for (const module of [
			"js/parser.js",
			"js/utils.js",
			"js/charactersheet/charactersheet-state.js",
			"js/charactersheet/charactersheet-class-utils.js",
		]) {
			expect({module, copied: dockerfile.includes(module)}).toEqual({module, copied: true});
			expect({module, allowed: ignore.includes(`!${module}`)}).toEqual({module, allowed: true});
		}
	});

	it("projects the baseline while the sheet's own live values move", () => {
		const authored = new CharacterSheetState();
		Object.assign(authored._data, {
			abilities: {str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10},
			classes: [{name: "Rogue", level: 5}],
			saveProficiencies: ["dex"],
			skillProficiencies: {stealth: 1},
		});
		const baseline = buildCharacterViewModel(JSON.parse(JSON.stringify(authored.toJson())));

		// A genuinely active state with real effects, authored through the sheet's own API.
		// A bare `{type: "rage"}` object has no `active` flag, state type or effects, so
		// `getActiveStateEffects()` ignores it and an assertion built on one proves nothing.
		authored.addActiveState("custom", {
			customEffects: [
				{type: "bonus", target: "save", value: 2},
				{type: "bonus", target: "skill:stealth", value: 5},
				{type: "bonus", target: "ac", value: 3},
			],
		});
		const document = JSON.parse(JSON.stringify(authored.toJson()));
		const projected = buildCharacterViewModel(document);

		// The sheet's live values move...
		expect(authored.getSaveMod("dex")).toBe(baseline.saves.dex.modifier + 2);
		expect(authored.getSkillMod("stealth")).toBe(baseline.skills.stealth.modifier + 5);
		expect(authored.getAC()).toBe(baseline.ac.value + 3);
		// ...while the projection reports what the character is, not what it is doing.
		expect(projected.saves).toEqual(baseline.saves);
		expect(projected.skills).toEqual(baseline.skills);
		expect(projected.ac).toEqual(baseline.ac);
		expect(document.activeStates.some(state => state.active)).toBe(true);
	});

	it("keeps a stance out of the baseline as well", () => {
		const authored = new CharacterSheetState();
		Object.assign(authored._data, {
			abilities: {str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10},
			classes: [{name: "Fighter", level: 5}],
			saveProficiencies: ["con"],
		});
		const baseline = buildCharacterViewModel(JSON.parse(JSON.stringify(authored.toJson())));

		authored._data.activeStance = "Defensive";
		const projected = buildCharacterViewModel(JSON.parse(JSON.stringify(authored.toJson())));

		expect(projected.saves).toEqual(baseline.saves);
		expect(projected.skills).toEqual(baseline.skills);
	});

	it("writes no character data to any console channel while deriving", () => {
		const authored = new CharacterSheetState();
		Object.assign(authored._data, {
			abilities: {str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10},
			classes: [{name: "Rogue", level: 5}],
		});
		// An unresolvable named modifier makes the sheet warn, quoting the modifier's name
		// and raw value — private data that has not passed the projection boundary. On a
		// server that lands in operational logs, and dedup resets because every derivation
		// builds a fresh state.
		authored.addNamedModifier({name: "MARKER-PRIVATE-BLADE", type: "skill:stealth", value: "unresolvable-expr-MARKER", enabled: true});
		const document = JSON.parse(JSON.stringify(authored.toJson()));

		const captured = [];
		const realConsole = globalThis.console;
		globalThis.console = new Proxy({}, {get: () => (...args) => captured.push(args.map(arg => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))});
		try {
			for (let i = 0; i < 3; ++i) buildCharacterViewModel(document);
		} finally {
			globalThis.console = realConsole;
		}

		expect(captured).toEqual([]);
		expect(JSON.stringify(captured)).not.toContain("MARKER-PRIVATE-BLADE");
		expect(JSON.stringify(captured)).not.toContain("unresolvable-expr-MARKER");
		// The console must be handed back exactly as it was found.
		expect(globalThis.console).toBe(realConsole);
	});
});
