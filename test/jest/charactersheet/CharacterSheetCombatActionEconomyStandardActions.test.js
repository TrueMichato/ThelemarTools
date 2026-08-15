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
	};
	combat._page = {
		_actionsData: actions,
		getHoverLink: (page, name, source, hash, displayName) => {
			hoverCalls.push({page, name, source, hash, displayName});
			return `<a data-hover="true" data-page="${page}" data-source="${source}" data-hash="${hash || ""}">${displayName || name}</a>`;
		},
		_getFeatureHoverLink: feature => `<a data-hover="true" data-page="feature" data-source="${feature.source}">${feature.name}</a>`,
	};
	return {combat, hoverCalls};
}

describe("CharacterSheetCombat standard action economy", () => {
	test("includes each core universal action once in its rules-defined bucket", () => {
		const {combat} = makeCombat();
		const buckets = combat.getCombatActionEconomy();
		const allStandard = [...buckets.action, ...buckets.bonus, ...buckets.reaction]
			.filter(entry => entry.kind === "action");

		expect(allStandard.map(entry => entry.name)).toEqual(
			expect.arrayContaining(CharacterSheetCombat.ACTION_ECONOMY_STANDARD_ACTION_NAMES),
		);
		for (const actionName of CharacterSheetCombat.ACTION_ECONOMY_STANDARD_ACTION_NAMES) {
			expect(allStandard.filter(entry => entry.name === actionName)).toHaveLength(1);
		}
		expect(buckets.reaction.find(entry => entry.name === "Opportunity Attack")).toMatchObject({
			kind: "action",
			source: "XPHB",
			actionType: "reaction",
		});
		expect(buckets.action.find(entry => entry.name === "Shove")).toMatchObject({
			kind: "action",
			source: "PHB",
			actionType: "action",
		});
		expect(buckets.bonus.filter(entry => entry.kind === "action")).toEqual([]);
	});

	test("resolves every standard action to a real catalog key", () => {
		const {combat} = makeCombat();
		const buckets = combat.getCombatActionEconomy();
		const standardEntries = [...buckets.action, ...buckets.reaction].filter(entry => entry.kind === "action");

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
