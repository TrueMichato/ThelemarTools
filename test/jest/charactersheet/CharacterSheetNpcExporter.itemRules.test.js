import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {setItemUpgradeCatalog, resetItemUpgradeCatalog} from "../../../js/itembuilder/itembuilder-upgrade-rules.js";
import {getNpcExportSchemaErrors} from "../../util-npc-export-schema.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const items = JSON.parse(fs.readFileSync("data/items.json", "utf8")).item;
const upgrades = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8")).itemUpgrade;
const sourceItem = (name, source = "DMG") => {
	const item = items.find(row => row.name === name && row.source === source);
	if (!item) throw new Error(`Missing item fixture: ${name}|${source}`);
	return {...item, entries: [...item.entries]};
};
const makeState = () => {
	const state = new State({isDetached: true});
	state.setName("Keeper");
	state.addClass({name: "Fighter", source: "PHB", level: 13});
	return state;
};
const addItem = (state, item) => {
	state.addItem({...item, requiresAttunement: !!item.reqAttune}, 1, true, true);
	return state.getItems().find(row => row.name === item.name).id;
};
const entries = monster => ["trait", "action", "bonus", "reaction"].flatMap(section => monster[section] || []);
const findPower = (monster, name) => entries(monster).find(entry => entry.name.includes(name) && entry.name !== "Special Equipment");
const findTable = value => {
	if (!value || typeof value !== "object") return null;
	if (value.type === "table") return value;
	return Object.values(value).map(findTable).find(Boolean) || null;
};

beforeAll(() => setItemUpgradeCatalog([...upgrades]));
afterAll(() => resetItemUpgradeCatalog());

describe.each(["complete", "compact"])("usable item rules (%s)", presentationMode => {
	const exportState = state => {
		const monster = Exporter.convertStateToMonster(state, {presentationMode});
		expect(getNpcExportSchemaErrors({data: {monster: [monster]}, kind: "bestiary", filePath: "item-rule-regression"})).toEqual([]);
		return monster;
	};

	it.each([
		["Eversmoking Bottle", "action", "120 feet", "10 minutes"],
		["Necklace of Fireballs", "action", "60 feet", "each bead beyond the first"],
		["Boots of Speed", "bonus", "opportunity attack", "10 minutes"],
		["Cloak of Displacement", "trait", "disadvantage", "start of"],
		["Scimitar of Speed", "bonus", "one attack", "each of"],
	])("F02: retains the complete flat-description power of %s", (name, section, rule, tail) => {
		const state = makeState();
		addItem(state, sourceItem(name));
		const monster = exportState(state);
		const power = (monster[section] || []).find(entry => entry.name.includes(name));
		expect(power).toBeDefined();
		expect(JSON.stringify(power).toLowerCase()).toContain(rule.toLowerCase());
		expect(JSON.stringify(power).toLowerCase()).toContain(tail.toLowerCase());
	});

	it("recognizes a common magic item's usable power without an activation field", () => {
		const state = makeState();
		addItem(state, {name: "Common Lantern", source: "TEST", rarity: "common", wondrous: true, entries: ["You can use an action to reveal invisible creatures within 20 feet until the end of your next turn."]});
		expect(JSON.stringify(findPower(exportState(state), "Common Lantern"))).toContain("20 feet");
	});

	it("does not cap an item's named procedures or the carried consumable list", () => {
		const state = makeState();
		addItem(state, {
			name: "Sixteenfold Lantern",
			source: "TEST",
			rarity: "common",
			wondrous: true,
			entries: Array.from({length: 16}, (_, ix) => ({
				type: "entries",
				name: `Signal ${ix + 1}`,
				entries: [`As an action, you can shine a signal visible from ${ix + 1} miles away.`],
			})),
		});
		for (let ix = 1; ix <= 12; ++ix) state.addItem({name: `Test Potion ${ix}`, source: "TEST", type: "P", rarity: "uncommon"});
		const monster = exportState(state);
		for (let ix = 1; ix <= 16; ++ix) expect(findPower(monster, `Signal ${ix}`)).toBeDefined();
		const equipment = monster.trait.find(it => it.name === "Special Equipment");
		for (let ix = 1; ix <= 12; ++ix) expect(JSON.stringify(equipment)).toContain(`Test Potion ${ix}|TEST`);
	});

	it("discloses missing full gemstone source rules instead of certifying a summary as complete", () => {
		const state = makeState();
		const hostId = addItem(state, {name: "Bound Maul", source: "TEST", type: "M", weapon: true, dmg1: "2d6", dmgType: "B"});
		expect(state.socketGemstone(hostId, {name: "Giant Slayer", source: "TGTT"}).success).toBe(true);
		resetItemUpgradeCatalog();
		try {
			const monster = exportState(state);
			expect(Exporter.getExportReport(monster).omissions).toEqual(expect.arrayContaining([
				expect.objectContaining({entity: expect.stringContaining("Giant Slayer"), reason: expect.stringContaining("Full gemstone source rules are unavailable")}),
			]));
		} finally {
			setItemUpgradeCatalog([...upgrades]);
		}
	});

	it.each(["DMG", "XDMG"])("F29: preserves Midnight Tears' actual delayed damage and half-save rule (%s)", source => {
		const state = makeState();
		addItem(state, sourceItem("Midnight Tears", source));
		const text = JSON.stringify(exportState(state));
		expect(text).toContain("{@damage 9d6}");
		expect(text).toMatch(/half as much damage/i);
		expect(text).toMatch(/midnight/i);
		expect(text).not.toContain("31d6");
	});

	it.each(["DMG", "XDMG"])("F29: preserves source-specific Torpor conditions and duration (%s)", source => {
		const state = makeState();
		addItem(state, sourceItem("Torpor", source));
		const text = JSON.stringify(exportState(state));
		expect(text).toContain("{@dice 4d6} hours");
		expect(text).toMatch(/\{@condition poisoned/i);
		if (source === "DMG") expect(text).toMatch(/\{@condition incapacitated/i);
		else {
			expect(text).toContain("halved");
			expect(text).not.toMatch(/\{@condition incapacitated/i);
		}
	});

	it("F31: keeps item-cast costs, special targeting, and bearer immunity beside the spell", () => {
		const state = makeState();
		addItem(state, {
			name: "Gravity Focus",
			source: "TEST",
			rarity: "rare",
			charges: 5,
			attachedSpells: {charges: {3: ["reverse gravity|PHB"]}},
			entries: [{type: "entries", name: "Reverse Gravity", entries: ["As an action, you can expend 3 charges to cast {@spell reverse gravity|PHB} (save DC 17), centered at a point within your reach. At the start of each of your turns, you can choose to be immune to its effects."]}],
		});
		const inventory = Object.create(globalThis.CharacterSheetInventory.prototype);
		inventory._state = state;
		state.setItemGrantedSpells(inventory._getItemGrantedSpells(state.getItems()));
		const text = JSON.stringify(findPower(exportState(state), "Gravity Focus"));
		expect(text).toContain("3 charges");
		expect(text).toMatch(/within (?:its|Keeper's) reach/);
		expect(text).toContain("immune");
		expect(text).toContain("{@spell Reverse Gravity");
	});

	it("F32: preserves the actual nested Retributive Strike table in the usable power", () => {
		const state = makeState();
		addItem(state, sourceItem("Staff of the Magi"));
		const power = findPower(exportState(state), "Retributive Strike");
		expect(power).toBeDefined();
		const table = findTable(power);
		expect(table).not.toBeNull();
		expect(table.rows).toHaveLength(3);
		expect(JSON.stringify(table)).toMatch(/8 ×|8 times|8\\u00d7|8.*charges/i);
		expect(JSON.stringify(power)).toMatch(/half as much damage/i);
	});

	it.each(["DMG", "XDMG"])("F35: preserves Ring of Invisibility ending conditions from its own edition (%s)", source => {
		const state = makeState();
		addItem(state, {...sourceItem("Ring of Invisibility", source), activation: [{type: "action"}]});
		const text = JSON.stringify(findPower(exportState(state), "Ring of Invisibility"));
		expect(text).toContain("ring is removed");
		expect(text).toContain("visible again");
		if (source === "DMG") expect(text).toMatch(/attacks? or casts? a spell/);
		else expect(text).not.toMatch(/attacks? or casts? a spell/);
	});

	it.each([
		["Giant Slayer", "including ettins and trolls"],
		["Blood Weapon", "constructs or undead"],
		["Magebane", "daily at dawn"],
	])("F35/F36/F48: keeps one complete, host-qualified %s procedure", (name, tail) => {
		const state = makeState();
		const hostId = addItem(state, {name: "Bound Maul", source: "TEST", type: "M", weapon: true, dmg1: "2d6", dmgType: "B"});
		addItem(state, {name: "Other Sword", source: "TEST", type: "M", weapon: true, dmg1: "1d8", dmgType: "S"});
		expect(state.socketGemstone(hostId, {name, source: "TGTT"}).success).toBe(true);
		const monster = exportState(state);
		const gem = monster.trait.find(entry => entry.name === "Gemstone Effects");
		const text = JSON.stringify(gem);
		expect(text).toContain("Bound Maul");
		expect(text).toContain(name);
		expect(text).toContain(tail);
		expect(text).not.toMatch(/\byou(?:r)?\b/i);
		const other = monster.action.find(entry => entry.name === "Other Sword");
		expect(JSON.stringify(other)).not.toContain(name);
		expect(JSON.stringify(entries(monster)).split(tail)).toHaveLength(2);
	});

	it("does not grant a stowed or unattuned item's power", () => {
		const state = makeState();
		state.addItem({...sourceItem("Boots of Speed"), requiresAttunement: true}, 1, true, false);
		state.addItem(sourceItem("Eversmoking Bottle"), 1, false, false);
		const monster = exportState(state);
		expect((monster.bonus || []).some(entry => entry.name.includes("Boots of Speed"))).toBe(false);
		expect((monster.action || []).some(entry => entry.name.includes("Eversmoking Bottle"))).toBe(false);
	});
});
