import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";

globalThis.CharacterSheetState = globalThis.CharacterSheetState || {};
globalThis.CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES = {};
globalThis.CharacterSheetState.detectActivatableFeature = () => null;
globalThis.UrlUtil.PG_ACTIONS = "actions.html";
globalThis.UrlUtil.PG_FEATS = "feats.html";
globalThis.UrlUtil.PG_VARIANTRULES = "variantrules.html";
globalThis.UrlUtil.encodeForHash = parts => String(parts).toLowerCase().replace(/\s+/g, "%20");
globalThis.HASH_LIST_SEP = "_";
globalThis.Parser.SRC_DMG = "DMG";
globalThis.Parser.SRC_TGTT = "TGTT";
globalThis.SourceUtil = {
	isClassicSource: source => ["PHB", "DMG", "MM", "XGE", "TCE"].includes(source),
};
let inlineHoverCalls = [];
globalThis.CharacterSheetClassUtils = {
	is2024Source: source => source === "XPHB" || source === "TGTT",
	escapeHtml: value => String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;"),
	buildInlineEntriesHoverLink: (displayName, entryName, entries) => {
		inlineHoverCalls.push({displayName, entryName, entries});
		return `<span data-hover-inline="true">${String(displayName).replace(/&/g, "&amp;")}</span>`;
	},
};

import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const actions = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../data/actions.json"), "utf8")).action;
const tgttBrew = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const tgttActions = tgttBrew.action;
const itemUtilizationRule = tgttBrew.variantrule.find(rule => rule.name === "Item Utilization" && rule.source === "TGTT");

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
	inlineHoverCalls = [];
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
	};
	combat._page = {
		_actionsData: actionsData,
		getHoverLink: (page, name, source, hash, displayName) => {
			hoverCalls.push({page, name, source, hash, displayName});
			return `<a data-hover="true" data-page="${page}" data-source="${source}" data-hash="${hash || ""}">${displayName || name}</a>`;
		},
		_getFeatureHoverLink: feature => `<a data-hover="true" data-page="feature" data-source="${feature.source}">${feature.name}</a>`,
	};
	return {combat, hoverCalls, inlineHoverCalls};
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
		expect(buckets.bonus.find(entry => entry.name === "Two-Weapon Fighting")).toMatchObject({
			kind: "action",
			source: "XPHB",
		});
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
			label: "2024 TGTT Illrigger sub-source",
			classes: [{name: "Illrigger", source: "TGTT-IllR", level: 5}],
			first: {name: "Illrigger", source: "TGTT-IllR"},
		},
		{
			label: "explicit one-edition homebrew",
			classes: [{name: "Fighter", source: "HB", edition: "one", level: 5}],
			first: {name: "Fighter", source: "HB"},
		},
		{
			label: "explicit one edition overrides a classic-looking source",
			classes: [{name: "Fighter", source: "PHB", edition: "one", level: 5}],
			first: {name: "Fighter", source: "PHB"},
		},
		{
			label: "unmarked external homebrew",
			classes: [{name: "Beastheart", source: "MCDM", level: 5}],
			first: {name: "Beastheart", source: "MCDM"},
		},
	])("$label characters resolve the 2024 action vocabulary", ({classes, first}) => {
		const {combat} = makeCombat({classes, chronologicalFirstClass: first});
		const standard = getStandardEntries(combat.getCombatActionEconomy());
		const names = standard.map(entry => entry.name);

		expect(names).toEqual(expect.arrayContaining(["Utilize", "Study", "Influence"]));
		expect(names).not.toContain("Use an Object");
		expect(names).not.toContain("Grapple");
		expect(names).not.toContain("Shove");
		expect(names).toEqual(expect.arrayContaining(["Unarmed Strike", "Two-Weapon Fighting"]));
		expect(standard.filter(entry => entry.rulesCategory === "core").every(entry => entry.source === "XPHB")).toBe(true);
	});

	test.each([
		{label: "PHB", source: "PHB", edition: undefined},
		{label: "known 2014 supplement", source: "XGE", edition: undefined},
		{label: "TGTT 2014 sub-source", source: "TGTT-2014", edition: undefined},
		{label: "explicit classic homebrew", source: "HB", edition: "classic"},
	])("a $label character resolves only the 2014 action vocabulary", ({source, edition}) => {
		const classes = [{name: "Fighter", source, edition, level: 5}];
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
		expect(names).toContain("Two-Weapon Fighting");
		expect(standard.filter(entry => entry.rulesCategory === "core").every(entry => entry.source === "PHB")).toBe(true);
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

	test("mixed-edition multiclass characters use modern rules when their chronological first class is modern", () => {
		const classes = [
			{name: "Fighter", source: "PHB", level: 5},
			{name: "Wizard", source: "XPHB", level: 3},
		];
		const {combat} = makeCombat({
			classes,
			chronologicalFirstClass: {name: "Wizard", source: "XPHB"},
		});
		const names = getStandardEntries(combat.getCombatActionEconomy()).map(entry => entry.name);

		expect(names).toContain("Utilize");
		expect(names).not.toContain("Use an Object");
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

	test("modern TGTT characters prefer TGTT Help/Hide and gain TGTT-only actions", () => {
		const {combat} = makeCombat({
			classes: [{name: "Illrigger", source: "TGTT-IllR", level: 5}],
			chronologicalFirstClass: {name: "Illrigger", source: "TGTT-IllR"},
			actionsData: [...actions, ...tgttActions],
		});
		const standard = getStandardEntries(combat.getCombatActionEconomy());

		expect(standard.find(entry => entry.name === "Help")).toMatchObject({source: "TGTT"});
		expect(standard.find(entry => entry.name === "Hide")).toMatchObject({source: "TGTT"});
		expect(standard.find(entry => entry.name === "Strangle")).toMatchObject({
			source: "TGTT",
			actionType: "bonus",
			subtitle: "TGTT rule",
		});
		expect(standard.find(entry => entry.name === "Disruptive Strike")).toMatchObject({
			source: "TGTT",
			actionType: "reaction",
			subtitle: "TGTT rule",
		});
	});

	test("non-TGTT modern characters do not gain TGTT-only actions", () => {
		const {combat} = makeCombat({
			classes: [{name: "Fighter", source: "XPHB", level: 5}],
			chronologicalFirstClass: {name: "Fighter", source: "XPHB"},
			actionsData: [...actions, ...tgttActions],
		});
		const names = getStandardEntries(combat.getCombatActionEconomy()).map(entry => entry.name);

		expect(names).not.toContain("Strangle");
		expect(names).not.toContain("Disruptive Strike");
		expect(getStandardEntries(combat.getCombatActionEconomy()).find(entry => entry.name === "Help")).toMatchObject({source: "TGTT"});
	});

	test.each([
		{source: "PHB", twfSource: "PHB"},
		{source: "XPHB", twfSource: "XPHB"},
	])("$source characters surface Two-Weapon Fighting and all DMG optional actions", ({source, twfSource}) => {
		const {combat} = makeCombat({
			classes: [{name: "Fighter", source, level: 5}],
			chronologicalFirstClass: {name: "Fighter", source},
		});
		const buckets = combat.getCombatActionEconomy();
		const standard = getStandardEntries(buckets);

		expect(standard.find(entry => entry.name === "Two-Weapon Fighting")).toMatchObject({
			source: twfSource,
			actionType: "bonus",
		});
		for (const name of ["Disarm", "Overrun", "Tumble"]) {
			expect(standard.find(entry => entry.name === name)).toMatchObject({
				source: "DMG",
				subtitle: "DMG optional",
			});
		}
		expect(buckets.action.some(entry => entry.name === "Overrun")).toBe(true);
		expect(buckets.bonus.some(entry => entry.name === "Overrun")).toBe(true);
		expect(buckets.action.some(entry => entry.name === "Tumble")).toBe(true);
		expect(buckets.bonus.some(entry => entry.name === "Tumble")).toBe(true);
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
			if (entry.name === "Unarmed Strike") continue;
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
			.flatMap(section => section._children[1]?._children || []);
		expect(populatedRows.length).toBeGreaterThan(12);
		for (const row of populatedRows) {
			expect(row._children[1]._children[0].innerHTML).toMatch(/data-hover(?:-inline)?="true"/);
		}
	});

	test("renders personal options separately from rules actions", () => {
		const {combat} = makeCombat({attacks: [{name: "Longsword", damage: "1d8"}]});
		const section = globalThis.e_({tag: "section"});
		const container = globalThis.e_({tag: "div"});
		globalThis.document = {
			getElementById: id => id === "charsheet-combat-action-economy-section" ? section : container,
		};

		combat.renderCombatActionEconomy();

		const actionColumnSections = container._children[0]._children[1]._children;
		expect(actionColumnSections.map(it => it._children[0].textContent)).toEqual(["Your options", "Rules actions"]);
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

	test("routes synthesized Unarmed Strike to the 2024 variantrule hover", () => {
		const {combat, hoverCalls} = makeCombat();
		const entry = getStandardEntries(combat.getCombatActionEconomy()).find(it => it.name === "Unarmed Strike");

		combat._getActionEconomyNameHtml(entry);

		expect(hoverCalls.at(-1)).toMatchObject({
			page: "variantrules.html",
			name: "Unarmed Strike",
			source: "XPHB",
		});
	});

	test("combines standard Utilize and TGTT Item Utilization in one inline hover", () => {
		const utilize = actions.find(action => action.name === "Utilize" && action.source === "XPHB");
		const enhancedUtilize = {
			...utilize,
			_actionEconomySupplementalRules: [itemUtilizationRule],
		};
		const {combat, inlineHoverCalls: calls} = makeCombat();

		const html = combat._getActionEconomyNameHtml({
			kind: "action",
			name: "Utilize",
			source: "XPHB",
			entity: enhancedUtilize,
		});

		expect(html).toContain("data-hover-inline");
		expect(calls).toHaveLength(1);
		expect(calls[0].entries).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "entries", name: "Item Utilization", entries: itemUtilizationRule.entries}),
		]));
	});

	test("uses the canonical Utilize hover when the TGTT supplement is unavailable", () => {
		const utilize = actions.find(action => action.name === "Utilize" && action.source === "XPHB");
		const {combat, hoverCalls, inlineHoverCalls: calls} = makeCombat();

		combat._getActionEconomyNameHtml({
			kind: "action",
			name: "Utilize",
			source: "XPHB",
			entity: utilize,
		});

		expect(calls).toHaveLength(0);
		expect(hoverCalls.at(-1)).toMatchObject({
			page: "actions.html",
			name: "Utilize",
			source: "XPHB",
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
