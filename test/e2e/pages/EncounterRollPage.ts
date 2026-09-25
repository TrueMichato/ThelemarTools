import type {Page} from "@playwright/test";

const monster = {
	name: "Goblin",
	source: "MM",
	type: "humanoid",
	size: ["S"],
	ac: [{ac: 15}],
	hp: {average: 7, formula: "2d6"},
	speed: {walk: 30},
	str: 8,
	dex: 14,
	con: 10,
	int: 10,
	wis: 10,
	cha: 8,
	cr: "1/4",
	action: [{
		name: "Blade",
		entries: [
			"{@atk mw} {@hit +4} to hit, {@damage 1d6+2} slashing damage. Recharge {@recharge 5}.",
			"Dexterity check: {@ability dex 14}. Perception: {@skillCheck perception 4}. Unclassified: {@d20 +4}.",
		],
	}],
};

export class EncounterRollPage {
	constructor (readonly page: Page) {}

	async seed () {
		await this.page.goto("/encounterworkspace.html");
		await this.page.locator("#encounter-workspace[aria-busy='false']").waitFor();
		const effect = {id: "custom-attack", name: "Rally", scopes: ["attack"], mode: "advantage", bonus: 3};
		const state = {
			version: 4,
			sourceList: {name: "Goblin Patrol", saveId: "test-list"},
			instances: ["one", "two"].map(id => ({
				id,
				hash: "goblin_mm",
				monster,
				conditions: [],
				areaNotes: [{id: "note", kind: "lair", name: "Bell", description: "Reminder only"}],
				modifiers: id === "one" ? [effect] : [],
				hp: {current: 7, max: 7, temp: 0},
				initiative: null,
			})),
			selectedIds: ["one"],
			omissions: [],
			turn: {round: 0, activeId: null},
		};
		await this.page.evaluate(async saved => {
			const {StorageUtil} = globalThis as typeof globalThis & {
				StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
			};
			await StorageUtil.pSetForPage("encounterWorkspaceState", saved, {page: "encounterworkspace.html"});
		}, state);
		await this.page.reload();
		await this.page.locator(".ew__statblock").first().locator("[data-packed-dice]").first().waitFor();
	}

	async clickRenderedRoll (tileIndex: number, kind: "hit" | "damage" | "recharge" | "abilityCheck" | "unclassified") {
		const links = this.page.locator(".ew__statblock").nth(tileIndex).locator("[data-packed-dice]");
		const index = await links.evaluateAll((elements, expected) => elements.findIndex(element => {
			const entry = JSON.parse(element.getAttribute("data-packed-dice") || "{}");
			return expected === "damage" ? entry.subType === "damage"
				: expected === "recharge" ? entry.chanceSuccessText === "Recharged!"
					: expected === "unclassified" ? entry.subType === "d20" && !entry.context
						: expected === "abilityCheck" ? entry.context?.type === expected && entry.context.ability === "dex"
							: entry.context?.type === expected;
		}), kind);
		if (index < 0) throw new Error(`No rendered ${kind} dice link was found in statblock ${tileIndex + 1}.`);
		await links.nth(index).click();
	}

	get rolledEntries () { return this.page.locator(".out-roll-item[title]"); }
}
