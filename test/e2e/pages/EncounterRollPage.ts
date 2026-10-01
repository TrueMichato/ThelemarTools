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

	async seed ({count = 2, renameSecond, renameIndices = [], capFirstHistory = false, monsterOverride = {}}: {count?: number, renameSecond?: string, renameIndices?: number[], capFirstHistory?: boolean, monsterOverride?: Record<string, unknown>} = {}) {
		await this.page.goto("/encounterworkspace.html");
		await this.page.locator("#encounter-workspace[aria-busy='false']").waitFor();
		const effect = {id: "custom-attack", name: "Rally", scopes: ["attack"], mode: "advantage", bonus: 3};
		const state = {
			version: renameSecond || renameIndices.length || capFirstHistory ? 6 : 4,
			sourceList: {name: "Goblin Patrol", saveId: "test-list"},
			instances: Array.from({length: count}, (_, index) => ({
				id: index === 0 ? "one" : index === 1 ? "two" : `creature-${index}`,
				hash: "goblin_mm",
				monster: {...monster, ...monsterOverride},
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

	resourcePanel (instanceId: string) {
		return this.page.locator(`.ew__statblock[data-instance-id="${instanceId}"] .ew__resources`);
	}

	statblock (instanceId: string) {
		return this.page.locator(`.ew__statblock[data-instance-id="${instanceId}"]`);
	}

	inlineResource (instanceId: string, key: string) {
		return this.statblock(instanceId).locator(`[data-inline-resource="${key}"]`);
	}

	async deferRechargeSaveWithRoll (result: number) {
		await this.page.evaluate(roll => {
			const globals = globalThis as typeof globalThis & {
				Renderer: {dice: {pRoll2: () => Promise<number>}},
				StorageUtil: {
					pSetForPage: (key: string, state: {instances: {resources?: {recharges: {ready: boolean}[]}}[]}, options: {page: string}) => Promise<void>,
				},
				isRechargeSavePending?: boolean,
				releaseRechargeSave?: () => void,
			};
			const originalSave = globals.StorageUtil.pSetForPage.bind(globals.StorageUtil);
			globals.Renderer.dice.pRoll2 = async () => roll;
			globals.StorageUtil.pSetForPage = async (key, state, options) => {
				if (key === "encounterWorkspaceState" && state.instances.some(it => it.resources?.recharges.some(recharge => recharge.ready))) {
					globals.isRechargeSavePending = true;
					await new Promise<void>(resolve => { globals.releaseRechargeSave = resolve; });
				}
				return originalSave(key, state, options);
			};
		}, result);
	}

	async waitForRechargeSave () {
		await this.page.waitForFunction(() => (globalThis as typeof globalThis & {isRechargeSavePending?: boolean}).isRechargeSavePending === true);
	}

	async releaseRechargeSave () {
		await this.page.evaluate(() => {
			const globals = globalThis as typeof globalThis & {releaseRechargeSave?: () => void};
			if (!globals.releaseRechargeSave) throw new Error("No pending recharge save to release.");
			globals.releaseRechargeSave();
		});
	}

	async getSavedRechargeReady (instanceId: string, rechargeId: string): Promise<boolean | undefined> {
		return this.page.evaluate(async ({id, rechargeId}) => {
			const globals = globalThis as typeof globalThis & {
				StorageUtil: {
					pGetForPage: (key: string, options: {page: string}) => Promise<{
						instances: {id: string, resources?: {recharges: {id: string, ready: boolean}[]}}[],
					}>,
				},
			};
			const state = await globals.StorageUtil.pGetForPage("encounterWorkspaceState", {page: "encounterworkspace.html"});
			return state.instances.find(it => it.id === id)?.resources?.recharges.find(it => it.id === rechargeId)?.ready;
		}, {id: instanceId, rechargeId});
	}

	resourceManager (instanceId: string) {
		return this.resourcePanel(instanceId).locator(":scope > .ew__resource-manager");
	}

	async addSavedStatblockPatch (instanceIndex: number, id: string, set: Record<string, unknown>, migrateFromV4 = false) {
		await this.page.evaluate(async ({instanceIndex, id, set, migrateFromV4}) => {
			const globals = globalThis as typeof globalThis & {
				StorageUtil: {
					pGetForPage: (key: string, options: {page: string}) => Promise<{
						version: number,
						instances: {statblockOperations: {id: string, type: string, data: {patch: {set: Record<string, unknown>}}}[]}[],
					}>,
					pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>,
				},
			};
			const options = {page: "encounterworkspace.html"};
			const state = await globals.StorageUtil.pGetForPage("encounterWorkspaceState", options);
			if (migrateFromV4) state.version = 6;
			state.instances[instanceIndex].statblockOperations.push({id, type: "patch", data: {patch: {set}}});
			await globals.StorageUtil.pSetForPage("encounterWorkspaceState", state, options);
		}, {instanceIndex, id, set, migrateFromV4});
	}

	get rolledEntries () { return this.page.locator(".out-roll-item[title]"); }
}
