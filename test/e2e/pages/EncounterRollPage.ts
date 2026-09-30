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

	async seed ({count = 2, renameSecond, renameIndices = [], capFirstHistory = false}: {count?: number, renameSecond?: string, renameIndices?: number[], capFirstHistory?: boolean} = {}) {
		await this.page.goto("/encounterworkspace.html");
		await this.page.locator("#encounter-workspace[aria-busy='false']").waitFor();
		const effect = {id: "custom-attack", name: "Rally", scopes: ["attack"], mode: "advantage", bonus: 3};
		const state = {
			version: renameSecond || renameIndices.length || capFirstHistory ? 6 : 4,
			sourceList: {name: "Goblin Patrol", saveId: "test-list"},
			instances: Array.from({length: count}, (_, index) => ({
				id: index === 0 ? "one" : index === 1 ? "two" : `creature-${index}`,
				hash: "goblin_mm",
				monster,
				conditions: [],
				areaNotes: [{id: "note", kind: "lair", name: "Bell", description: "Reminder only"}],
				modifiers: index === 0 ? [effect] : [],
				statblockOperations: capFirstHistory && index === 0
					? Array.from({length: 100}, (_, ix) => ({
						id: `prior-${ix}`,
						type: "patch",
						data: {patch: {set: {dex: 14}}},
					}))
					: (renameSecond && index === 1) || renameIndices.includes(index)
						? [{id: `rename-${index}`, type: "patch", data: {patch: {set: {name: renameIndices.includes(index) ? "Hobgoblin" : renameSecond}}}}]
						: [],
				hp: {current: 7, max: 7, temp: 0},
				initiative: null,
			})),
			selectedIds: ["one"],
			omissions: [],
			groups: [],
			ungroupedIds: [],
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

	async focus (index: number) {
		const row = this.page.locator(".ew__roster-row").nth(index);
		const id = await row.getAttribute("data-instance-id");
		if (!id) throw new Error(`Roster monster ${index + 1} has no instance ID.`);
		await this.page.locator("#ew-focus-picker").selectOption(id);
	}

	async openActions () {
		if (!await this.page.locator("#ew-actions").evaluate(element => (element as HTMLDetailsElement).open)) {
			await this.page.locator("#ew-actions > summary").click();
		}
	}

	async openInitiative () {
		if (!await this.page.locator("#ew-initiative").evaluate(element => (element as HTMLDetailsElement).open)) {
			await this.page.locator("#ew-open-initiative").click();
		}
	}

	async openQuickActions () {
		if (!await this.page.locator("#ew-quick").evaluate(element => (element as HTMLDetailsElement).open)) {
			if (!await this.page.locator("#ew-focus-more").evaluate(element => (element as HTMLDetailsElement).open)) {
				await this.page.locator("#ew-focus-more > summary").click();
			}
			await this.page.locator("#ew-open-quick").click();
		}
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
