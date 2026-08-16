import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";

globalThis.CharacterSheetState = globalThis.CharacterSheetState || {};
globalThis.CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES = {};
globalThis.CharacterSheetState.detectActivatableFeature = () => null;
globalThis.UrlUtil.PG_ACTIONS = "actions.html";
globalThis.UrlUtil.PG_FEATS = "feats.html";
globalThis.UrlUtil.encodeForHash = parts => String(parts).toLowerCase().replace(/\s+/g, "%20");
globalThis.HASH_LIST_SEP = "_";
globalThis.CharacterSheetClassUtils = {
	is2024Source: source => source === "XPHB" || source === "TGTT",
	escapeHtml: value => String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;"),
	buildInlineEntriesHoverLink: (displayName) => `<span data-hover-inline="true">${String(displayName).replace(/&/g, "&amp;")}</span>`,
};

import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const actions = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../data/actions.json"), "utf8")).action;

function makeCombat ({
	attacks = [],
	spells = [],
	features = [],
	customAbilities = [],
	itemPowers = [],
	classes = [],
	chronologicalFirstClass = null,
	actionsData = actions,
} = {}) {
	const hoverCalls = [];
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = {
		getAttacks: () => attacks,
		getItems: () => [],
		getTemporaryAttacks: () => [],
		getActiveStateAttacks: () => [],
		getSpells: () => spells,
		getFeatures: () => features,
		getCustomAbilities: () => customAbilities,
		getItemPowers: () => itemPowers,
		getClasses: () => classes,
		getChronologicalFirstClass: () => chronologicalFirstClass,
		_sourceIs2024: source => {
			const normalized = String(source || "").toUpperCase();
			if (normalized.includes("2014")) return false;
			return normalized.includes("2024") || ["XPHB", "TGTT"].includes(normalized);
		},
	};
	combat._page = {
		_actionsData: actionsData,
		getHoverLink: (page, name, source, hash, displayName) => {
			hoverCalls.push({page, name, source, hash, displayName});
			return `<a data-hover="true" data-page="${page}" data-source="${source}" data-hash="${hash || ""}">${displayName || name}</a>`;
		},
		_getFeatureHoverLink: feature => `<a data-hover="true" data-page="feature" data-source="${feature.source}">${feature.name}</a>`,
	};
	return {combat, hoverCalls};
}

const getStandardEntries = buckets => [...buckets.action, ...buckets.bonus, ...buckets.reaction]
	.filter(entry => entry.kind === "action");

describe("CharacterSheetCombat standard action economy", () => {
	test("a classless sheet defaults to each 2024 standard action once in its rules-defined bucket", () => {
		const {combat} = makeCombat();
		const buckets = combat.getCombatActionEconomy();
		const allStandard = getStandardEntries(buckets);
		const expected = CharacterSheetCombat.ACTION_ECONOMY_STANDARD_ACTION_NAMES_BY_EDITION.one;

		expect(allStandard.map(entry => entry.name)).toEqual(expect.arrayContaining(expected));
		for (const actionName of expected) {
			expect(allStandard.filter(entry => entry.name === actionName)).toHaveLength(1);
		}
		expect(buckets.reaction.find(entry => entry.name === "Opportunity Attack")).toMatchObject({
			kind: "action",
			source: "XPHB",
			actionType: "reaction",
		});
		expect(buckets.bonus.filter(entry => entry.kind === "action")).toEqual([]);
	});

	test.each([
		{
			label: "2024 XPHB",
			classes: [{name: "Fighter", source: "XPHB", level: 5}],
			first: {name: "Fighter", source: "XPHB"},
		},
		{
			label: "2024 TGTT",
			classes: [{name: "Fighter", source: "TGTT", level: 5}],
			first: {name: "Fighter", source: "TGTT"},
		},
		{
			label: "2024 TGTT sub-source",
			classes: [{name: "Fighter", source: "TGTT-2024", level: 5}],
			first: {name: "Fighter", source: "TGTT-2024"},
		},
		{
			label: "explicit one-edition homebrew",
			classes: [{name: "Fighter", source: "HB", edition: "one", level: 5}],
			first: {name: "Fighter", source: "HB"},
		},
	])("$label characters resolve the 2024 action vocabulary", ({classes, first}) => {
		const {combat} = makeCombat({classes, chronologicalFirstClass: first});
		const standard = getStandardEntries(combat.getCombatActionEconomy());
		const names = standard.map(entry => entry.name);

		expect(names).toEqual(expect.arrayContaining(["Utilize", "Study", "Influence"]));
		expect(names).not.toContain("Use an Object");
		expect(names).not.toContain("Grapple");
		expect(names).not.toContain("Shove");
		expect(standard.every(entry => entry.source === "XPHB")).toBe(true);
	});

	test.each([
		{label: "PHB", source: "PHB"},
		{label: "TGTT 2014 sub-source", source: "TGTT-2014"},
	])("a $label character resolves only the 2014 action vocabulary", ({source}) => {
		const classes = [{name: "Fighter", source, level: 5}];
		const {combat} = makeCombat({
			classes,
			chronologicalFirstClass: {name: "Fighter", source},
		});
		const standard = getStandardEntries(combat.getCombatActionEconomy());
		const names = standard.map(entry => entry.name);

		expect(names).toEqual(expect.arrayContaining(["Use an Object", "Grapple", "Shove"]));
		expect(names).not.toContain("Utilize");
		expect(names).not.toContain("Study");
		expect(names).not.toContain("Influence");
		expect(standard.every(entry => entry.source === "PHB")).toBe(true);
	});

	test("mixed-edition multiclass characters follow their chronological first class", () => {
		const classes = [
			{name: "Wizard", source: "XPHB", level: 3},
			{name: "Fighter", source: "PHB", level: 5},
		];
		const {combat} = makeCombat({
			classes,
			chronologicalFirstClass: {name: "Fighter", source: "PHB"},
		});
		const standard = getStandardEntries(combat.getCombatActionEconomy());

		expect(standard.find(entry => entry.name === "Use an Object")).toMatchObject({source: "PHB"});
		expect(standard.some(entry => entry.name === "Utilize")).toBe(false);
	});

	test("legacy saves use the marked starting class before stored class order", () => {
		const {combat} = makeCombat({
			classes: [
				{name: "Wizard", source: "XPHB", level: 3},
				{name: "Fighter", source: "PHB", level: 5, isStartingClass: true},
			],
		});
		const standard = getStandardEntries(combat.getCombatActionEconomy());

		expect(standard.find(entry => entry.name === "Use an Object")).toMatchObject({source: "PHB"});
		expect(standard.some(entry => entry.name === "Utilize")).toBe(false);
	});

	test("missing selected-edition entries are skipped without leaking the other edition", () => {
		const {combat} = makeCombat({
			classes: [{name: "Fighter", source: "XPHB", level: 5}],
			chronologicalFirstClass: {name: "Fighter", source: "XPHB"},
			actionsData: actions.filter(action => !(action.name === "Utilize" && action.source === "XPHB")),
		});
		const names = getStandardEntries(combat.getCombatActionEconomy()).map(entry => entry.name);

		expect(names).not.toContain("Utilize");
		expect(names).not.toContain("Use an Object");
	});

	test("edition selection does not alter character-specific economy entries", () => {
		const {combat} = makeCombat({
			classes: [{name: "Fighter", source: "PHB", level: 5}],
			chronologicalFirstClass: {name: "Fighter", source: "PHB"},
			attacks: [{name: "Longsword", damage: "1d8"}],
			spells: [{name: "Shield", source: "PHB", level: 1, prepared: true, castingTime: "1 reaction"}],
			features: [{name: "Second Wind", source: "PHB", description: "Use a bonus action to regain hit points."}],
		});
		const buckets = combat.getCombatActionEconomy();

		expect(buckets.action.find(entry => entry.name === "Longsword")).toMatchObject({kind: "attack"});
		expect(buckets.bonus.find(entry => entry.name === "Second Wind")).toMatchObject({kind: "feature"});
		expect(buckets.reaction.find(entry => entry.name === "Shield")).toMatchObject({kind: "spell"});
	});

	test("resolves every standard action to a real catalog key", () => {
		const {combat} = makeCombat();
		const buckets = combat.getCombatActionEconomy();
		const standardEntries = getStandardEntries(buckets);

		for (const entry of standardEntries) {
			expect(actions.some(action => action.name === entry.name && action.source === entry.source)).toBe(true);
		}
	});

	test("renders hover attributes on every populated row", () => {
		const {combat} = makeCombat({
			attacks: [{name: "Longsword", damage: "1d8"}],
			spells: [{name: "Shield", source: "PHB", level: 1, prepared: true, castingTime: "1 reaction"}],
			features: [{name: "Second Wind", source: "PHB", description: "Use a bonus action to regain hit points."}],
			customAbilities: [{name: "Battle Cry", activationAction: "bonus", description: "Your allies rally to your call."}],
			itemPowers: [{
				id: "flame",
				name: "Flame Burst",
				itemId: "wand",
				itemName: "Wand of Fireballs",
				itemSource: "DMG",
				actionType: "action",
				chargesCost: 1,
				chargesCurrent: 3,
				chargesMax: 7,
			}],
		});
		const section = globalThis.e_({tag: "section"});
		const container = globalThis.e_({tag: "div"});
		globalThis.document = {
			getElementById: id => id === "charsheet-combat-action-economy-section" ? section : container,
		};

		combat.renderCombatActionEconomy();

		const populatedRows = container._children
			.flatMap(group => group._children[1]?._children || [])
			.filter(row => row._children?.length > 1);
		expect(populatedRows.length).toBeGreaterThan(12);
		for (const row of populatedRows) {
			expect(row._children[1].innerHTML).toMatch(/data-hover(?:-inline)?="true"/);
		}
	});

	test("uses the appropriate canonical hover pages and explicit Attack hash", () => {
		const {combat, hoverCalls} = makeCombat();

		combat._getActionEconomyNameHtml({kind: "action", name: "Dodge", source: "XPHB"});
		combat._getActionEconomyNameHtml({kind: "spell", name: "Shield", source: "PHB"});
		combat._getActionEconomyNameHtml({kind: "attack", name: "Longsword"});
		combat._getActionEconomyNameHtml({
			kind: "item",
			name: "Flame Burst",
			entity: {itemName: "Wand of Fireballs", itemSource: "DMG"},
		});

		expect(hoverCalls[0]).toMatchObject({page: "actions.html", name: "Dodge", source: "XPHB"});
		expect(hoverCalls[1]).toMatchObject({page: "spells.html", name: "Shield", source: "PHB"});
		expect(hoverCalls[2]).toMatchObject({
			page: "actions.html",
			name: "Attack",
			source: "XPHB",
			displayName: "Longsword",
		});
		expect(hoverCalls[2].hash).toBeTruthy();
		expect(hoverCalls[3]).toMatchObject({
			page: "items.html",
			name: "Wand of Fireballs",
			source: "DMG",
			displayName: "Flame Burst",
		});
	});

	test("escapes local custom-ability labels exactly once", () => {
		const {combat} = makeCombat();
		const html = combat._getActionEconomyNameHtml({
			kind: "custom",
			name: "Fire & Ice",
			subtitle: "At will",
			entity: {name: "Fire & Ice", description: "A custom ability."},
		});

		expect(html).toContain("Fire &amp; Ice");
		expect(html).not.toContain("&amp;amp;");
	});
});
