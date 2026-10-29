import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {getNpcExportSchemaErrors} from "../../util-npc-export-schema.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const catalog = ["phb", "xphb"].flatMap(source => JSON.parse(fs.readFileSync(`data/spells/spells-${source}.json`, "utf8")).spell);
const makeCaster = (name = "Wizard", source = "PHB", level = 13, subclass = null) => {
	const state = new State({isDetached: true});
	state.setSpellData([...catalog]);
	state.addClass({name, source, level, ...(subclass ? {subclass} : {})});
	state.setAbilityBase("int", 18);
	state.setAbilityBase("cha", 14);
	state.setSpellSlots(1, 4, 4);
	state.setSpellSlots(2, 3, 3);
	return state;
};
const listedSpells = monster => (monster.spellcasting || []).flatMap(block => [
	...(block.will || []),
	...Object.values(block.spells || {}).flatMap(level => level.spells || []),
]);

describe.each(["complete", "compact"])("source-owned spellcasting (%s)", presentationMode => {
	const exportState = (state, options = {}) => {
		const monster = Exporter.convertStateToMonster(state, {presentationMode, ...options});
		expect(getNpcExportSchemaErrors({data: {monster: [monster]}, kind: "bestiary", filePath: "spellcasting-regression"})).toEqual([]);
		return monster;
	};

	it("F17/F18: separates casting abilities and colliding Pact slots without duplicating ordinary resources", () => {
		const state = makeCaster("Wizard", "PHB", 4);
		state.addClass({name: "Warlock", source: "PHB", level: 3});
		state.addClass({name: "Fighter", source: "PHB", level: 6});
		state.setPactSlots({current: 1, max: 2, level: 2});
		state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard"}, true);
		state.addSpell({name: "Hex", source: "PHB", level: 1, sourceClass: "Warlock"}, false);
		state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});
		state.addCantrip({name: "Eldritch Blast", source: "PHB", sourceClass: "Warlock"});
		const blocks = exportState(state).spellcasting;
		const wizard = blocks.find(block => JSON.stringify(block.will).includes("Fire Bolt"));
		const warlock = blocks.find(block => JSON.stringify(block.will).includes("Eldritch Blast"));
		expect(wizard.ability).toBe("int");
		expect(wizard.headerEntries.join(" ")).toContain("{@dc 17}");
		expect(warlock.ability).toBe("cha");
		expect(warlock.headerEntries.join(" ")).toContain("{@dc 15}");
		expect(blocks.flatMap(block => Object.values(block.spells || {})).reduce((sum, level) => sum + (level.slots || 0), 0)).toBe(9);
		const pact = blocks.find(block => /Pact Magic/.test(block.name));
		expect(pact.spells[2].slots).toBe(2);
		expect(pact.headerEntries.join(" ")).toMatch(/short or long rest/);
	});

	it("F19: excludes unprepared nonritual spellbook entries and labels ritual-only access", () => {
		const state = makeCaster();
		state.addSpell({name: "Magic Missile", source: "PHB", level: 1, sourceClass: "Wizard", inSpellbook: true}, false);
		state.addSpell({name: "Detect Magic", source: "PHB", level: 1, sourceClass: "Wizard", inSpellbook: true, ritual: true}, false);
		state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard", inSpellbook: true}, true);
		const monster = exportState(state);
		expect(listedSpells(monster).join(" ")).not.toContain("Magic Missile");
		expect(listedSpells(monster).join(" ")).not.toContain("Detect Magic");
		expect(listedSpells(monster).join(" ")).toContain("Shield");
		expect(JSON.stringify(monster.spellcasting.flatMap(block => block.ritual || []))).toContain("Detect Magic");
	});

	it("retains a PHB known caster's spells without imposing Wizard preparation rules", () => {
		const state = makeCaster("Bard");
		state.addSpell({name: "Healing Word", source: "PHB", level: 1, sourceClass: "Bard"}, false);
		expect(listedSpells(exportState(state)).join(" ")).toContain("Healing Word");
	});

	it("resolves inherit through the exact owning class, including innate routes, never as an ability abbreviation", () => {
		const state = makeCaster();
		state.addClass({name: "Warlock", source: "PHB", level: 2});
		state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard", spellcastingAbility: "inherit"});
		state.addCantrip({name: "Eldritch Blast", source: "PHB", sourceClass: "Warlock", spellcastingAbility: "inherit"});
		state.addInnateSpell({name: "Shield", source: "PHB", sourceClass: "Wizard", sourceFeature: "Inherited Ward", spellcastingAbility: "inherit", atWill: true});
		const before = JSON.stringify(state._data);
		const monster = Exporter.buildExportDocument(state, {presentationMode}).document.monster[0];
		expect(getNpcExportSchemaErrors({data: {monster: [monster]}, kind: "bestiary", filePath: "inherit-regression"})).toEqual([]);
		expect(monster.spellcasting.find(block => block.will?.some(tag => tag.includes("Fire Bolt"))).ability).toBe("int");
		expect(monster.spellcasting.find(block => block.will?.some(tag => tag.includes("Eldritch Blast"))).ability).toBe("cha");
		expect(monster.spellcasting.find(block => block.will?.some(tag => tag.includes("Shield"))).ability).toBe("int");
		const actor = Exporter.buildExportDocument(state, {presentationMode, profile: "companion"}).document.monster[0];
		expect(actor.spellcasting.every(block => !block.ability || globalThis.Parser.ABIL_ABVS.includes(block.ability))).toBe(true);
		expect(actor.spellcasting.find(block => block.will?.some(tag => tag.includes("Eldritch Blast"))).ability).toBe("cha");
		expect(JSON.stringify(state._data)).toBe(before);
	});

	it("F54: resolves source references inside full procedures and leaves invalid spell references readable with a warning", () => {
		const state = makeCaster();
		state.addFeature({name: "Reference Procedure", source: "PHB", entries: ["As an action, cast {@spell Starry Wisp|TGTT|a wisp} or consult the recorded {@spell Copied}."]});
		const monster = exportState(state, {includeFeatures: "manual", selectedFeatureIds: state.getFeatures().map(feature => feature.id)});
		expect(JSON.stringify(monster)).toContain("{@spell Starry Wisp|XPHB|a wisp}");
		expect(JSON.stringify(monster)).not.toContain("{@spell Copied}");
		expect(JSON.stringify(monster)).toContain("Copied");
		expect(Exporter.getValidationIssues(monster).warnings.join(" ")).toMatch(/Copied.*(?:unresolved|not reachable)/);
	});

	it("F20: keeps high-level upcasting pools even without a native-level prepared spell", () => {
		const state = makeCaster();
		state.setSpellSlots(7, 1, 1);
		state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard"}, true);
		const level = exportState(state).spellcasting.flatMap(block => Object.entries(block.spells || {})).find(([key]) => key === "7")?.[1];
		expect(level).toEqual({slots: 1, spells: []});
	});

	it("F50: uses actual spell entity levels rather than stale grant levels without rewriting the save", () => {
		const state = makeCaster();
		state.setSpellSlots(3, 3, 3);
		state.addSpell({name: "Counterspell", source: "PHB", level: 1, sourceClass: "Wizard", sourceFeature: "Abjurer Spells", alwaysPrepared: true});
		state.addSpell({name: "Dispel Magic", source: "PHB", level: 1, sourceClass: "Wizard", sourceFeature: "Abjurer Spells", alwaysPrepared: true});
		const before = JSON.stringify(state.getSpellsKnown());
		const blocks = exportState(state).spellcasting;
		const third = blocks.flatMap(block => block.spells?.[3]?.spells || []).join(" ");
		expect(third).toContain("{@spell Counterspell|PHB}");
		expect(third).toContain("{@spell Dispel Magic|PHB}");
		expect(blocks.flatMap(block => block.spells?.[1]?.spells || []).join(" ")).not.toContain("Counterspell");
		expect(JSON.stringify(state.getSpellsKnown())).toBe(before);
	});

	it("preserves genuinely different PHB and XPHB identities", () => {
		const state = makeCaster();
		for (const source of ["PHB", "XPHB"]) state.addSpell({name: "Sleep", source, level: 1, sourceClass: "Wizard"}, true);
		const tags = listedSpells(exportState(state)).join(" ");
		expect(tags).toContain("{@spell Sleep|PHB}");
		expect(tags).toContain("{@spell Sleep|XPHB}");
	});

	it("F54: repairs a unique catalog identity but discloses an ambiguous source instead of guessing its edition", () => {
		const state = makeCaster("Druid", "TGTT");
		state.addCantrip({name: "Starry Wisp", source: "TGTT", sourceClass: "Druid"});
		state.addSpell({name: "Goodberry", source: "TGTT", level: 1, sourceClass: "Druid"}, true);
		const monster = exportState(state);
		const tags = listedSpells(monster).join(" ");
		expect(tags).toContain("{@spell Starry Wisp|XPHB}");
		expect(tags).not.toContain("{@spell Goodberry|PHB}");
		expect(tags).not.toContain("{@spell Goodberry|XPHB}");
		expect(tags).not.toContain("{@spell Goodberry|TGTT}");
		expect(Exporter.getValidationIssues(monster).warnings.join(" ")).toMatch(/Goodberry.*(?:ambiguous|unresolved)/i);
	});

	it("F52: keeps a bounded Ethereal Step procedure rather than granting at-will Etherealness", () => {
		const state = makeCaster("Ranger", "PHB");
		state.addFeature({name: "Ethereal Step", source: "XGE", description: "As a bonus action, you can cast {@spell etherealness|PHB} with this feature, but the spell ends at the end of the current turn. Once you use this feature, you can't use it again until you finish a short or long rest."});
		state.addInnateSpell({name: "Etherealness", source: "PHB", level: 7, sourceFeature: "Ethereal Step", atWill: true});
		const monster = exportState(state);
		expect((monster.spellcasting || []).flatMap(block => block.will || []).join(" ")).not.toContain("Etherealness");
		const step = monster.bonus.find(entry => /Ethereal Step/.test(entry.name));
		expect(JSON.stringify(step)).toMatch(/end of (?:the |its )?(?:current )?turn/);
		expect(JSON.stringify(step)).toMatch(/short or long rest|SR/);
		expect(JSON.stringify(step)).toMatch(/etherealness/i);
	});

	it("F30: preserves an item's cast-level suffix without turning it into a source abbreviation", () => {
		const state = makeCaster();
		state.addItem({name: "Flight Token", source: "CUSTOM", rarity: "rare", equipped: true, attachedSpells: ["fly|XPHB#5"]});
		state.setItemGrantedSpells(globalThis.CharacterSheetInventory.prototype._getItemGrantedSpells(state.getItems()));
		const monster = exportState(state);
		const text = JSON.stringify(monster);
		expect(text).toContain("{@spell Fly|XPHB}");
		expect(text).not.toContain("XPHB5");
		expect(text).toMatch(/5th.level|level 5/);
	});

	it("does not borrow a multiclass ability or preparation permission for an unattributed spell", () => {
		const state = makeCaster();
		state.addClass({name: "Warlock", source: "PHB", level: 2});
		state.addSpell({name: "Grease", source: "PHB", level: 1}, false);
		const monster = exportState(state);
		expect(listedSpells(monster).join(" ")).not.toContain("Grease");
		const unresolved = monster.spellcasting.find(block => block.footerEntries?.join(" ").includes("Grease"));
		expect(unresolved.ability).toBeUndefined();
		expect(unresolved.headerEntries.join(" ")).not.toMatch(/\{@dc/);
		expect(Exporter.getValidationIssues(monster).warnings.join(" ")).toMatch(/Grease.*class.*unresolved/);
	});

	it("handles source-qualified object and UID owners through the canonical class cards", () => {
		const state = makeCaster("Wizard", "PHB", 4);
		state.addClass({name: "Warlock", source: "PHB", level: 3});
		state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: {name: "Wizard", source: "PHB"}});
		state.addCantrip({name: "Eldritch Blast", source: "PHB", sourceClass: "Warlock|PHB"});
		const blocks = exportState(state).spellcasting;
		expect(blocks.find(block => block.will?.some(tag => tag.includes("Fire Bolt"))).ability).toBe("int");
		expect(blocks.find(block => block.will?.some(tag => tag.includes("Eldritch Blast"))).ability).toBe("cha");
		expect(state.getUnattributedSpellCounts()).toEqual({spellsCount: 0, cantripsCount: 0});
	});

	it("preserves a spell-specific selected casting ability instead of replacing it with the class ability", () => {
		const state = makeCaster();
		state.setAbilityBase("wis", 16);
		state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});
		state.addCantrip({name: "Guidance", source: "PHB", sourceClass: "Wizard", spellcastingAbility: "wis"});
		const blocks = exportState(state).spellcasting;
		expect(blocks.find(block => block.will?.some(tag => tag.includes("Fire Bolt"))).ability).toBe("int");
		const wisdom = blocks.find(block => block.will?.some(tag => tag.includes("Guidance")));
		expect(wisdom.ability).toBe("wis");
		expect(wisdom.headerEntries.join(" ")).toContain("{@dc 16}");
	});

	it("keeps independently recharging innate pools and abilities separate without waiving components", () => {
		const state = makeCaster();
		state.setAbilityBase("wis", 16);
		state.addInnateSpell({name: "Detect Magic", source: "PHB", level: 1, spellcastingAbility: "wis", uses: {current: 0, max: 2}, recharge: "short"});
		state.addInnateSpell({name: "Misty Step", source: "PHB", level: 2, spellcastingAbility: "cha", uses: {current: 0, max: 1}, recharge: "long"});
		const blocks = exportState(state).spellcasting.filter(block => /Innate/.test(block.name));
		const short = blocks.find(block => block.rest?.[2]);
		const long = blocks.find(block => block.rest?.[1]);
		expect(short.ability).toBe("wis");
		expect(short.headerEntries.join(" ")).toMatch(/short or long rest/);
		expect(long.ability).toBe("cha");
		expect(long.headerEntries.join(" ")).toMatch(/a long rest/);
		expect(JSON.stringify(blocks)).not.toMatch(/requiring no material components/);
		expect(blocks.some(block => block.daily)).toBe(false);
	});

	it("does not promote a ritual-only innate route into at-will ordinary casting", () => {
		const state = makeCaster();
		state.addInnateSpell({name: "Detect Magic", source: "PHB", level: 1, ritualOnly: true, atWill: true, spellcastingAbility: "wis"});
		const blocks = exportState(state).spellcasting;
		expect(blocks.flatMap(block => block.will || []).join(" ")).not.toContain("Detect Magic");
		expect(blocks.flatMap(block => block.ritual || []).join(" ")).toContain("Detect Magic");
	});

	it("leaves a rolled caster's per-cast formulas dynamic instead of inventing a Charisma DC", () => {
		const state = makeCaster("Rogue", "TGTT", 13, {name: "Gambler", shortName: "Gambler", source: "TGTT"});
		state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Gambler"});
		const block = exportState(state).spellcasting.find(entry => entry.will);
		expect(block.ability).toBeUndefined();
		expect(block.headerEntries.join(" ")).toContain("8 + 5 + 2d4");
		expect(block.headerEntries.join(" ")).toContain("rolled per cast");
	});

	it("does not hide an independent resource merely because a spellbook footer mentions its name", () => {
		const state = makeCaster();
		state.addSpell({name: "Control Water", source: "PHB", level: 4, sourceClass: "Wizard", inSpellbook: true}, false);
		state.addResource({id: "independent-control-water", name: "Control Water", current: 1, max: 3, recharge: "short"});
		state.addResource({id: "independent-other", name: "Other Pool", current: 1, max: 4, recharge: "long"});
		const pool = exportState(state).trait.find(entry => entry.name === "Class Resources");
		expect(JSON.stringify(pool)).toContain("Control Water");
		expect(JSON.stringify(pool)).toContain("3/short rest");
	});

	it("uses an explicitly linked innate resource once, at its canonical maximum", () => {
		const state = makeCaster();
		state.addResource({id: "shared-gift", name: "Shared Gift", current: 0, max: 2, recharge: "short"});
		for (const name of ["Detect Magic", "Misty Step"]) state.addInnateSpell({name, source: "PHB", level: 1, spellcastingAbility: "wis", linkedResourceId: "shared-gift", uses: {current: 9, max: 9}, recharge: "long"});
		const monster = exportState(state);
		const routes = monster.spellcasting.filter(block => block.rest?.[2]);
		expect(routes).toHaveLength(1);
		expect(routes[0].rest[2]).toHaveLength(2);
		expect(routes[0].headerEntries.join(" ")).toMatch(/short or long rest/);
		expect(JSON.stringify(monster.trait || [])).not.toContain("Shared Gift");
	});

	it("does not restore a restricted source feature outside an explicit manual selection", () => {
		const state = makeCaster("Ranger", "PHB");
		state.addFeature({name: "Ethereal Step", source: "XGE", description: "As a bonus action, you can cast {@spell etherealness|PHB}, but it ends at the end of the current turn. Once you use this feature, you can't use it again until you finish a short or long rest."});
		state.addInnateSpell({name: "Etherealness", source: "PHB", level: 7, sourceFeature: "Ethereal Step", atWill: true});
		const monster = exportState(state, {includeFeatures: "manual", selectedFeatureIds: []});
		expect(JSON.stringify(monster.bonus || [])).not.toContain("Ethereal Step");
		expect(JSON.stringify(["trait", "action", "bonus", "reaction"].flatMap(section => monster[section] || []))).not.toMatch(/\{@spell etherealness/i);
		expect(listedSpells(monster).join(" ")).not.toContain("Etherealness");
	});

	it.each([14, 15])("keeps a restricted spell's class-level upgrade correctly gated at level %i", level => {
		const state = makeCaster("Fighter", "PHB", level);
		state.addFeature({name: "Bounded Flight", source: "XGE", className: "Fighter", classSource: "PHB", level: 3, entries: ["You can cast {@spell fly|PHB} once per long rest, targeting only yourself.", "When you reach 15th level in this class, you can cast {@spell fly|PHB} at will, targeting only yourself."]});
		state.addInnateSpell({name: "Fly", source: "PHB", level: 3, sourceFeature: "Bounded Flight", atWill: true});
		const text = JSON.stringify(exportState(state));
		expect(text.includes("at will")).toBe(level === 15);
		expect(text).not.toMatch(/When .{0,30}reach(?:es)? 15th level|in this class/);
		expect(text).toContain("targeting only itself");
		expect(listedSpells(exportState(state)).join(" ")).not.toContain("Fly");
	});
});
