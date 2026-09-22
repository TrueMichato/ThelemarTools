import {Locator, Page, expect} from "@playwright/test";
import {waitForToolsLoaded, uiGate} from "../utils/waitHelpers";

export interface FeatureCompanionIdentity {
	ownerUid: string;
	name: string;
	source: string;
}

export interface FeatureCompanionOperationProbe {
	operation: "forceEmpoweredRend" | "repair" | "deflectAttack";
	commandMethod?: "bonusAction" | "replaceOneAttack";
	expectedOperationUid: string;
}

/**
 * Page Object Model for the Character Sheet page
 * Provides common navigation and interaction methods
 */
export class CharacterSheetPage {
	readonly page: Page;

	// Tab selectors
	readonly tabOverview: Locator;
	readonly tabAbilities: Locator;
	readonly tabCombat: Locator;
	readonly tabSpells: Locator;
	readonly tabInventory: Locator;
	readonly tabFeatures: Locator;
	readonly tabNotes: Locator;
	readonly tabCompanions: Locator;
	readonly tabBuilder: Locator;
	readonly tabRespec: Locator;

	// Header buttons
	readonly btnNew: Locator;
	readonly btnLevelUp: Locator;
	readonly btnImport: Locator;
	readonly btnExport: Locator;

	// Rest buttons
	readonly btnShortRest: Locator;
	readonly btnLongRest: Locator;

	// Character info
	readonly characterName: Locator;
	readonly characterLevel: Locator;
	readonly characterRace: Locator;
	readonly characterClass: Locator;
	readonly classLabel: Locator;

	// HP elements
	readonly hpCurrent: Locator;
	readonly hpMax: Locator;
	readonly hpTemp: Locator;
	readonly hpBarFill: Locator;
	readonly btnHeal: Locator;
	readonly btnDamage: Locator;

	// Combat stats
	readonly dispAC: Locator;
	readonly dispInitiative: Locator;
	readonly dispSpeed: Locator;

	// Conditions
	readonly conditionsContainer: Locator;
	readonly btnAddCondition: Locator;

	// Exhaustion
	readonly exhaustionNumber: Locator;
	readonly btnExhaustionAdd: Locator;
	readonly btnExhaustionRemove: Locator;

	constructor (page: Page) {
		this.page = page;

		// Tabs - use href selector for Bootstrap tabs
		this.tabOverview = page.locator('a[href="#charsheet-tab-overview"]');
		this.tabAbilities = page.locator('a[href="#charsheet-tab-abilities"]');
		this.tabCombat = page.locator('a[href="#charsheet-tab-combat"]');
		this.tabSpells = page.locator('a[href="#charsheet-tab-spells"]');
		this.tabInventory = page.locator('a[href="#charsheet-tab-inventory"]');
		this.tabFeatures = page.locator('a[href="#charsheet-tab-features"]');
		this.tabNotes = page.locator('a[href="#charsheet-tab-notes"]');
		this.tabCompanions = page.locator('a[href="#charsheet-tab-companions"]');
		this.tabBuilder = page.locator('a[href="#charsheet-tab-builder"]');
		this.tabRespec = page.locator('a[href="#charsheet-tab-respec"]');

		// Header action buttons
		this.btnNew = page.locator("#charsheet-btn-new");
		this.btnLevelUp = page.locator("#charsheet-btn-levelup");
		this.btnImport = page.locator("#charsheet-btn-import");
		this.btnExport = page.locator("#charsheet-btn-export");

		// Rest buttons
		this.btnShortRest = page.locator("#charsheet-btn-short-rest");
		this.btnLongRest = page.locator("#charsheet-btn-long-rest");

		// Character display
		this.characterName = page.locator("#charsheet-ipt-name");
		this.characterLevel = page.locator("#charsheet-disp-level");
		this.characterRace = page.locator("#charsheet-disp-race");
		this.characterClass = page.locator("#charsheet-disp-class");
		this.classLabel = this.characterClass;

		// HP
		this.hpCurrent = page.locator("#charsheet-ipt-hp-current");
		this.hpMax = page.locator("#charsheet-disp-hp-max");
		this.hpTemp = page.locator("#charsheet-ipt-hp-temp");
		this.hpBarFill = page.locator("#charsheet-hp-bar-fill");
		this.btnHeal = page.locator("#charsheet-btn-heal");
		this.btnDamage = page.locator("#charsheet-btn-damage");

		// Combat stat boxes
		this.dispAC = page.locator("#charsheet-disp-ac");
		this.dispInitiative = page.locator("#charsheet-disp-initiative");
		this.dispSpeed = page.locator("#charsheet-disp-speed");

		// Conditions
		this.conditionsContainer = page.locator("#charsheet-conditions");
		this.btnAddCondition = page.locator("#charsheet-btn-add-condition");

		// Exhaustion
		this.exhaustionNumber = page.locator("#charsheet-exhaustion-number");
		this.btnExhaustionAdd = page.locator("#charsheet-btn-exhaustion-add");
		this.btnExhaustionRemove = page.locator("#charsheet-btn-exhaustion-remove");
	}

	async setPrioritySources (sources: string[]): Promise<void> {
		await this.page.evaluate((nextSources) => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.setSetting?.("prioritySources", nextSources);
			cs?._builder?.render?.();
		}, sources);
	}

	async setStateSetting (key: string, value: unknown): Promise<void> {
		await this.page.evaluate(({settingKey, settingValue}) => {
			(globalThis as any).charSheet?._state?.setSetting?.(settingKey, settingValue);
		}, {settingKey: key, settingValue: value});
	}

	async expectFeatureCompanionAbsent (ownerUid: string): Promise<void> {
		const result = await this.page.evaluate((uid) => {
			const state: any = (globalThis as any).charSheet?._state;
			return {
				setup: state?.getFeatureCompanionSetupRecord?.(uid) || null,
				count: state?.getFeatureOwnedCompanions?.(uid)?.length || 0,
			};
		}, ownerUid);
		expect(result.setup, `setup for ${ownerUid} should not exist before its exact feature grant`).toBeNull();
		expect(result.count, `companions owned by ${ownerUid} before its grant`).toBe(0);
	}

	async expectFeatureCompanionReady (identity: FeatureCompanionIdentity): Promise<{id: string}> {
		const result = await this.page.evaluate((expected) => {
			const state: any = (globalThis as any).charSheet?._state;
			const setup = state?.getFeatureCompanionSetupRecord?.(expected.ownerUid) || null;
			const companions = state?.getFeatureOwnedCompanions?.(expected.ownerUid) || [];
			const companion = companions[0] || null;
			return {
				setup,
				count: companions.length,
				companion: companion ? {
					id: companion.id,
					name: companion.name,
					source: companion.source,
					ownerUid: companion.featureGrant?.uid,
					appearance: companion.setup?.appearance,
					locomotion: companion.setup?.locomotion,
				} : null,
			};
		}, identity);
		expect(result.setup?.status, `setup status for ${identity.ownerUid}`).toBe("complete");
		expect(result.count, `exactly one companion should be owned by ${identity.ownerUid}`).toBe(1);
		expect(result.companion).toMatchObject({
			name: identity.name,
			source: identity.source,
			ownerUid: identity.ownerUid,
		});
		expect(result.companion?.id, "feature companion should have a stable persisted id").toBeTruthy();
		return {id: result.companion!.id};
	}

	async expectFeatureCompanionOperationSurface (
		identity: FeatureCompanionIdentity,
		{expectRendReplacement = false}: {expectRendReplacement?: boolean} = {},
	): Promise<{id: string}> {
		const companion = await this.expectFeatureCompanionReady(identity);
		if (expectRendReplacement) {
			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const combat = cs?._combat;
				const attack = (cs?._state?.getAttacks?.() || []).find((it: any) =>
					!it?.isSpell && !it?.isSpellAttack && (it?.actionType == null || it.actionType === "action"));
				if (!attack) throw new Error("no weapon/unarmed attack is available to start the Attack-action replacement probe");
				if (typeof cs?.startCombat !== "function" || typeof combat?._recordAttackForTurn !== "function") {
					throw new Error("Attack-action replacement tracker is unavailable");
				}
				cs.startCombat();
				combat._recordAttackForTurn(attack);
			});
		}
		const availability = await this.page.evaluate(({companionId}) => {
			const cs: any = (globalThis as any).charSheet;
			const get = (operation: string) => cs?.getCompanionOperationAvailability?.(companionId, operation) || null;
			return {
				rend: get("forceEmpoweredRend"),
				repair: get("repair"),
				deflect: get("deflectAttack"),
			};
		}, {companionId: companion.id});
		expect(availability.rend?.available, availability.rend?.message || "Rend should be available").toBe(true);
		expect(availability.repair?.available, availability.repair?.message || "Repair should be available").toBe(true);
		expect(availability.deflect?.available, availability.deflect?.message || "Deflect should be available").toBe(true);
		const rendMethods = (availability.rend?.availableCommandMethods || []).map((it: any) => it.id);
		expect(rendMethods, "Rend should support the bonus-action command").toContain("bonusAction");
		if (expectRendReplacement) {
			expect(rendMethods, "L5 Extra Attack should unlock Rend as an attack replacement").toContain("replaceOneAttack");
		}

		await this.tabCompanions.click();
		const card = this.page.locator(`.charsheet__companion-card[data-companion-id="${companion.id}"]`);
		await expect(card).toBeVisible();
		await expect(card.locator('[data-operation="forceEmpoweredRend"]')).toBeEnabled();
		await expect(card.locator('[data-operation="repair"]')).toBeEnabled();
		await expect(card.locator('[data-operation="deflectAttack"]')).toBeEnabled();
		return companion;
	}

	/**
	 * Commit one operation through the shared production controller route.
	 * The prompt adapters are deterministic, but operation validation,
	 * action-economy spending, receipts, persistence, and rerendering remain
	 * the same code used by desktop Companion cards and Play Mode.
	 */
	async commitFeatureCompanionOperation (
		identity: FeatureCompanionIdentity,
		probe: FeatureCompanionOperationProbe,
	): Promise<Record<string, unknown>> {
		const {id} = await this.expectFeatureCompanionReady(identity);
		const result = await this.page.evaluate(async ({companionId, operation, commandMethod}) => {
			const cs: any = (globalThis as any).charSheet;
			const input: any = (globalThis as any).InputUiUtil;
			if (!cs?.pUseCompanionOperation) throw new Error("charSheet.pUseCompanionOperation is unavailable");
			cs?.resetTurnEconomy?.();
			const previous = {
				getUserString: input.pGetUserString,
				getUserBoolean: input.pGetUserBoolean,
				getUserEnum: input.pGetUserEnum,
				rollDice: cs.rollDice,
			};
			input.pGetUserString = async () => "Training Dummy";
			input.pGetUserBoolean = async () => true;
			input.pGetUserEnum = async ({values}: {values?: string[]}) => values?.includes("hit") ? "hit" : values?.[0];
			cs.rollDice = (count: number, faces: number) => count * Math.max(1, Math.ceil(faces / 2));
			try {
				return await cs.pUseCompanionOperation({companionId, operation, commandMethod});
			} finally {
				input.pGetUserString = previous.getUserString;
				input.pGetUserBoolean = previous.getUserBoolean;
				input.pGetUserEnum = previous.getUserEnum;
				cs.rollDice = previous.rollDice;
			}
		}, {companionId: id, operation: probe.operation, commandMethod: probe.commandMethod || null});
		expect(result?.ok, JSON.stringify(result)).toBe(true);
		expect(result?.committed, JSON.stringify(result)).toBe(true);
		expect(result?.ownerUid).toBe(identity.ownerUid);
		expect(result?.sourceUid).toBe(`${identity.name}|${identity.source}`);
		expect(result?.operationUid).toBe(probe.expectedOperationUid);
		if (probe.commandMethod) expect(result?.commandMethod).toBe(probe.commandMethod);
		return result as Record<string, unknown>;
	}

	async goto (): Promise<void> {
		await this.page.goto("/charactersheet.html");
		await waitForToolsLoaded(this.page);
	}

	async switchToTab (tab: Locator): Promise<void> {
		// The optional top-level "Abilities" tab is hidden by default (the
		// `showAbilitiesTab` setting is off — Overview already surfaces ability
		// scores). Reveal it on demand so flows that read ability/skill rows from
		// that tab can click its otherwise-hidden nav link.
		if (tab === this.tabAbilities) await this.ensureAbilitiesTabVisible();
		// Bounded: an open modal overlay swallows pointer events, and an unbounded
		// click would silently retry until the ENTIRE test timeout expired instead
		// of failing. Retry once after clearing transient prompts, then fail loudly.
		const clicked = await tab.click({timeout: 5000}).then(() => true).catch(() => false);
		if (!clicked) {
			await this.dismissTransientModals();
			await tab.click({timeout: 5000}).catch((err: Error) => {
				throw new Error(`switchToTab: tab click blocked even after dismissing modals — an overlay is likely still open. Original: ${err.message}`);
			});
		}
		await this.page.waitForTimeout(100);
	}

	async makeFirstClassSkillDecisionMissing (): Promise<string[]> {
		return this.page.evaluate(async () => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const data = state?.toJson?.();
			if (data) {
				data.background = null;
				for (const entry of data.levelHistory || []) {
					if (entry?.choices) delete entry.choices.background;
				}
				state.loadFromJson(data);
			}
			const history = state?.getLevelHistoryEntry?.(1);
			const skills = [...(history?.choices?.skills || [])];
			const protectedSkills = new Set(
				(cs?._respec?._engine?.manifest?.decisions || [])
					.filter((decision: any) => decision.characterLevel === 0 && decision.type === "skills")
					.flatMap((decision: any) => Array.isArray(decision.selection) ? decision.selection : [decision.selection])
					.filter(Boolean)
					.map((skill: string) => String(skill).toLowerCase().replace(/\s+/g, "").replace(/'s?/g, "")),
			);
			const candidate = skills.slice().reverse().find(skill => !protectedSkills.has(
				String(skill).toLowerCase().replace(/\s+/g, "").replace(/'s?/g, ""),
			));
			const removed = [candidate || skills[0]];
			if (skills.length > 1) history.choices.skills = skills.slice(1);
			else delete history.choices.skills;
			for (const skill of removed) state?.setSkillProficiency?.(
				String(skill).toLowerCase().replace(/\s+/g, "").replace(/'s?/g, ""),
				0,
			);
			history.manifestComplete = false;
			history.complete = false;
			await cs?._saveCurrentCharacter?.();
			cs?._renderCharacter?.();
			return removed;
		});
	}

	async openRespec (): Promise<void> {
		await this.switchToTab(this.tabRespec);
		await this.page.locator("#charsheet-respec-draft-status").waitFor({state: "visible", timeout: 5000});
	}

	async getRespecDraftStatus (): Promise<string> {
		return ((await this.page.locator("#charsheet-respec-draft-status").textContent()) || "").trim();
	}

	async prepareLegacyEpicBoonRepairFixture (): Promise<{con: number; abilityTotal: number}> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			if (!state) throw new Error("Character Sheet state is unavailable");
			const data = state.toJson();
			data.classes = [{name: "Bard", source: "TGTT", level: 20}];
			data.race = null;
			data.background = null;
			data.characterBase = {
				v: 1,
				raceUserChoices: {},
				backgroundUserChoices: {},
				decisions: [],
			};
			data.features = [];
			data.feats = [];
			data.levelHistory = Array.from({length: 20}, (_, ix) => ({
				level: ix + 1,
				class: {name: "Bard", source: "TGTT"},
				choices: ix === 18 ? {asi: {con: 2}} : {},
				complete: true,
			}));
			if (data.spellcasting) {
				data.spellcasting.spellsKnown = [];
				data.spellcasting.cantripsKnown = [];
			}
			state.loadFromJson(data);
			for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) state.setAbilityBase(ability, 10);
			state.setAbilityBase("con", 12);
			cs._renderCharacter?.();
			const scores = ["str", "dex", "con", "int", "wis", "cha"].map(ability => state.getAbilityBase(ability));
			return {con: state.getAbilityBase("con"), abilityTotal: scores.reduce((sum, score) => sum + score, 0)};
		});
	}

	async getLevel19EpicBoonRepairSnapshot (): Promise<{
		status: string;
		selection: any;
		featName: string | null;
		con: number;
		abilityTotal: number;
	}> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const respec = cs?._respec;
			const decision = respec?._engine?.manifest?.decisions?.find((it: any) =>
				it.characterLevel === 19 && it.type === "feat",
			);
			const state = respec?._state;
			const scores = ["str", "dex", "con", "int", "wis", "cha"].map(ability => state?.getAbilityBase?.(ability) || 0);
			return {
				status: decision?.status || "missing",
				selection: decision?.selection || null,
				featName: state?.getFeats?.().find((feat: any) => feat?.source === "XPHB" && /^Boon of /i.test(feat.name))?.name || null,
				con: state?.getAbilityBase?.("con") || 0,
				abilityTotal: scores.reduce((sum, score) => sum + score, 0),
			};
		});
	}

	async stageLevel19EpicBoonRepair (): Promise<void> {
		const level = this.page.locator('.charsheet__level-entry[data-level="19"]');
		await level.locator(".charsheet__level-entry-edit").click();
		const row = this.page.locator(".charsheet__respec-choice-row").filter({hasText: /Epic Boon or Qualifying Feat/i}).last();
		await row.locator("button", {hasText: "Change"}).click();
		const featEditor = this.page.locator(".charsheet__respec-feat-modal").last();
		await featEditor.locator('input[placeholder="Search feats..."]').fill("Boon of Combat Prowess");
		await featEditor.locator(".charsheet__respec-feat-item").filter({hasText: "Boon of Combat Prowess"}).first().click();
		await featEditor.locator(".charsheet__feat-ability-grid button:not([disabled])").first().click();
		await featEditor.locator("button", {hasText: "Apply Changes"}).click();
	}

	async stageFirstMissingRespecSkillChoice (missingSkills: string[] = []): Promise<string[]> {
		const level = this.page.locator('.charsheet__level-entry[data-level="1"]');
		await level.locator(".charsheet__level-entry-edit").click();
		const decisionRow = this.page.locator(".charsheet__respec-choice-row").filter({hasText: "Starting Skill Proficiencies"}).last();
		await decisionRow.locator("button", {hasText: "Change"}).click();

		const editor = this.page.locator(".charsheet__respec-decision-editor").last();
		const requiredCount = await this.page.evaluate(() => {
			const decisions = (globalThis as any).charSheet?._respec?._engine?.manifest?.decisions || [];
			return decisions.find((decision: any) => decision.type === "skills" && decision.characterLevel === 1)?.count || 1;
		});
		const options = editor.locator('.charsheet__respec-option input[type="checkbox"]');
		const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
		const liveSkills = await this.page.evaluate(() => Object.entries(
			(globalThis as any).charSheet?._respec?._state?.getSkillProficiencies?.() || {},
		).filter(([, level]) => Number(level) >= 1).map(([skill]) => skill));
		for (const missingSkill of missingSkills) {
			const target = normalize(missingSkill);
			const optionCount = await options.count();
			for (let i = 0; i < optionCount; i++) {
				const option = options.nth(i);
				if (await option.isChecked() && normalize(await option.locator("xpath=..").innerText()).includes(target)) {
					await option.uncheck();
					break;
				}
			}
		}
		const selected: string[] = [];
		const initialSelectedCount = await options.evaluateAll(items => items.filter((item: HTMLInputElement) => item.checked).length);
		for (let i = initialSelectedCount; i < requiredCount; ++i) {
			const optionCount = await options.count();
			let selectedOption = null;
			for (let j = 0; j < optionCount; j++) {
				const candidate = options.nth(j);
				const candidateLabel = normalize(await candidate.locator("xpath=..").innerText());
				if (await candidate.isEnabled() && !await candidate.isChecked() && !liveSkills.some(skill => normalize(skill) === candidateLabel)) {
					selectedOption = candidate;
					break;
				}
			}
			if (!selectedOption) throw new Error("No unchecked legal skill option remained.");
			selected.push(await selectedOption.locator("xpath=..").innerText());
			await selectedOption.check();
		}
		await editor.locator("button", {hasText: "Stage Choice"}).click();
		return selected.map(it => it.trim());
	}

	async getRespecSkillSnapshot (): Promise<{live: string[]; draft: string[]}> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const getSkills = (state: any) => Object.entries(state?.getSkillProficiencies?.() || {})
				.filter(([, level]) => Number(level) >= 1)
				.map(([skill]) => skill)
				.sort();
			return {
				live: getSkills(cs?._state),
				draft: getSkills(cs?._respec?._state),
			};
		});
	}

	async cancelRespecDraft (): Promise<void> {
		await this.page.locator("#charsheet-respec-cancel").click();
	}

	async applyRespecDraft (): Promise<void> {
		const apply = this.page.locator("#charsheet-respec-apply");
		if (!await apply.isEnabled()) {
			const validation = await this.page.evaluate(() => {
				const engine = (globalThis as any).charSheet?._respec?._engine;
				return {
					status: (document.querySelector("#charsheet-respec-draft-status")?.textContent || "").trim(),
					issues: engine?.getValidation?.().issues || [],
					decisions: (engine?.manifest?.decisions || [])
						.filter((decision: any) => decision.status !== "resolved" && decision.status !== "deferred")
						.map((decision: any) => ({
							label: decision.label,
							status: decision.status,
							count: decision.count,
							selection: decision.selection,
							optionCount: decision.options?.length || 0,
						})),
				};
			});
			throw new Error(`Respec Apply remained disabled: ${JSON.stringify(validation)}`);
		}
		await apply.click();
		await expect(this.page.locator("#charsheet-respec-undo")).toBeEnabled();
	}

	async undoAppliedRespec (): Promise<void> {
		await this.page.locator("#charsheet-respec-undo").click();
		await expect(this.page.locator("#charsheet-respec-undo")).toBeDisabled();
	}

	async expectRespecToolbarFitsViewport (): Promise<void> {
		const toolbar = this.page.locator(".charsheet__respec-toolbar");
		const box = await toolbar.boundingBox();
		const viewport = this.page.viewportSize();
		if (!box || !viewport) throw new Error("Respec toolbar geometry was unavailable");
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
		for (const button of await toolbar.locator("button").all()) {
			const buttonBox = await button.boundingBox();
			if (!buttonBox) continue;
			expect(buttonBox.height).toBeGreaterThanOrEqual(40);
		}
	}

	async getRespecNestedDecisionSnapshot (): Promise<Array<{
		id: string;
		label: string;
		type: string;
		status: string;
		characterLevel: number;
		optionCount: number;
		effectiveOptionCount: number;
		meta: unknown;
		selection: unknown;
	}>> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const decisions = cs?._respec?._engine?.manifest?.decisions || [];
			return decisions
				.filter((decision: any) => decision.scope === "nested")
				.map((decision: any) => ({
					id: decision.id,
					label: decision.label,
					type: decision.type,
					status: decision.status,
					characterLevel: decision.characterLevel,
					optionCount: decision.options?.length || 0,
					effectiveOptionCount: cs?._respec?._getDecisionOptions?.(decision)?.length || 0,
					meta: decision.meta,
					selection: decision.selection,
				}));
		});
	}

	async stageFirstNestedRespecChoice (): Promise<void> {
		const nested = await this.getRespecNestedDecisionSnapshot();
		if (!nested.length) throw new Error("No nested Respec decision was discovered.");
		const unresolved = nested.filter(item => item.status === "missing" || item.status === "invalid");
		const decision = unresolved.find(item => /cantrip/i.test(item.label) && item.effectiveOptionCount > 0)
			|| unresolved.find(item => item.effectiveOptionCount > 0)
			|| nested.find(item => item.effectiveOptionCount > 0)
			|| nested[0];
		const row = this.page.locator(`.charsheet__respec-choice-row[data-decision-id="${decision.id}"]`);
		if (!await row.isVisible()) {
			const level = this.page.locator(`.charsheet__level-entry[data-level="${decision.characterLevel}"]`);
			await level.locator(".charsheet__level-entry-edit").click();
		}
		await row.locator("button", {hasText: "Change"}).click();
		const inlineEditor = this.page.locator(".charsheet__respec-nested-editor-host .charsheet__respec-decision-editor");
		await expect(inlineEditor).toBeVisible();
		expect(await this.page.locator(".ve-ui-modal__overlay:visible").count()).toBe(1);
		const inputs = inlineEditor.locator(".charsheet__respec-option input");
		const inputCount = await inputs.count();
		if (!inputCount) {
			throw new Error(`Nested decision "${decision.label}" has no legal UI options: ${JSON.stringify(nested)}`);
		}
		const editionExact = inlineEditor.locator('.charsheet__respec-option input[data-source="XPHB"]:enabled').first();
		if (await editionExact.count()) {
			await editionExact.check();
		} else {
			for (let i = 0; i < inputCount; i++) {
				if (await inputs.nth(i).isEnabled()) {
					await inputs.nth(i).check();
					break;
				}
			}
		}
		await inlineEditor.locator("button", {hasText: "Stage Choice"}).click();
	}

	async stageAllMissingNestedRespecChoices (): Promise<void> {
		for (let attempt = 0; attempt < 12; attempt++) {
			const missing = (await this.getRespecNestedDecisionSnapshot())
				.filter(decision => decision.status === "missing" && decision.effectiveOptionCount > 0);
			if (!missing.length) return;
			await this.stageFirstNestedRespecChoice();
			// Staging refreshes the candidate manifest while the current level
			// modal remains open; reopen it before resolving the next child.
			await this.closeRespecLevelEditor();
		}
		throw new Error("Nested Respec choices did not converge after 12 staged decisions.");
	}

	async stageNestedRespecChoice (label: string, optionName: string, optionSource?: string): Promise<void> {
		const nested = await this.getRespecNestedDecisionSnapshot();
		const decision = nested.find(item => item.label === label);
		if (!decision) throw new Error(`No nested Respec decision named "${label}" was discovered.`);
		const row = this.page.locator(`.charsheet__respec-choice-row[data-decision-id="${decision.id}"]`);
		if (!await row.isVisible()) {
			const level = this.page.locator(`.charsheet__level-entry[data-level="${decision.characterLevel}"]`);
			await level.locator(".charsheet__level-entry-edit").click();
		}
		await row.locator("button", {hasText: "Change"}).click();
		const inlineEditor = this.page.locator(".charsheet__respec-nested-editor-host .charsheet__respec-decision-editor");
		await expect(inlineEditor).toBeVisible();
		const option = inlineEditor.locator(".charsheet__respec-option").filter({hasText: optionName})
			.filter(optionSource ? {has: inlineEditor.locator(`input[data-source="${optionSource}"]`)} : {})
			.first();
		await option.locator("input").check();
		await inlineEditor.locator("button", {hasText: "Stage Choice"}).click();
	}

	async stageRespecFeatureChoice (featureName: string, optionName: string): Promise<void> {
		const entry = this.page.locator(".charsheet__level-entry[data-level='1']").first();
		await entry.locator(".charsheet__level-entry-edit").click();
		const row = this.page.locator(".charsheet__respec-choice-row").filter({hasText: featureName}).last();
		await row.locator("button", {hasText: "Change"}).click();
		await expect(this.page.locator(".ve-ui-modal__overlay:visible")).toHaveCount(1);
		const item = this.page.locator(".charsheet__respec-feat-item").filter({hasText: optionName}).last();
		await expect(item).toBeVisible();
		await item.click();
		await this.page.locator("button").filter({hasText: "Apply Changes"}).last().click();
		// The parent level editor remains open; the nested choice must be
		// applied inline without introducing a second modal.
		await expect(this.page.locator(".ve-ui-modal__overlay:visible")).toHaveCount(1);
	}

	async closeRespecLevelEditor (): Promise<void> {
		await this.page.locator(".charsheet__respec-modal button", {hasText: "Close"}).click();
		await expect(this.page.locator(".ve-ui-modal__overlay:visible")).toHaveCount(0);
	}

	async reloadCharacterSheet (): Promise<void> {
		const characterId = await this.page.evaluate(() => (globalThis as any).charSheet?._currentCharacterId);
		await this.page.reload({waitUntil: "domcontentloaded"});
		await this.page.locator("#charsheet-tab-overview, #charsheet-tab-main").first().waitFor({state: "visible"});
		if (characterId) {
			const selector = this.page.locator("#charsheet-sel-character");
			await selector.locator(`option[value="${characterId}"]`).waitFor({state: "attached"});
			await selector.selectOption(characterId);
		}
		await this.page.waitForFunction(() => {
			const cs: any = (globalThis as any).charSheet;
			return Boolean(cs?._state?.getLevelHistory?.()?.length);
		});
	}

	async getRespecMechanicsSnapshot (): Promise<{
		choice: string | null;
		featureNames: string[];
		cantrips: string[];
		modifiers: Array<{name: string; type: string; value: unknown}>;
	}> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const state: any = cs?._respec?._engine?.state || cs?._state;
			const choice = (state?._data?.levelHistory || [])
				.flatMap((entry: any) => entry?.choices?.featureChoices || [])
				.find((item: any) => item.featureName === "Divine Order")?.choice || null;
			return {
				choice,
				featureNames: (state?.getFeatures?.() || [])
					.filter((feature: any) => feature.parentFeature === "Divine Order" || feature.name === "Thaumaturge" || feature.name === "Protector")
					.map((feature: any) => feature.name),
				cantrips: (state?.getCantrips?.() || []).map((spell: any) => spell.name),
				modifiers: [
					...(state?._data?.modifiers || []),
					...(state?._data?.namedModifiers || []),
				]
					.filter((modifier: any) => /thaumaturge|arcana|religion/i.test(`${modifier.name || ""} ${modifier.type || ""}`))
					.map((modifier: any) => ({name: modifier.name, type: modifier.type, value: modifier.value})),
			};
		});
	}

	/**
	 * Enable the optional "Abilities" tab via the page controller and refresh tab
	 * visibility, so its nav link becomes clickable. Best-effort and idempotent.
	 */
	async ensureAbilitiesTabVisible (): Promise<void> {
		await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			try {
				cs?._state?.setShowAbilitiesTab?.(true);
				cs?._updateAbilitiesTabVisibility?.();
			} catch (_) { /* best-effort */ }
		});
		await this.page.waitForTimeout(50);
	}

	// ========== ABILITY SCORES ==========

	async getAbilityModifier (ability: "str" | "dex" | "con" | "int" | "wis" | "cha"): Promise<number> {
		const modEl = this.page.locator(`#charsheet-ability-${ability}-mod`);
		const text = await modEl.textContent();
		return parseInt(text || "0", 10);
	}

	// ========== HP ==========

	async getCurrentHp (): Promise<number> {
		const val = await this.hpCurrent.inputValue();
		return parseInt(val || "0", 10);
	}

	async getMaxHp (): Promise<number> {
		const text = await this.hpMax.textContent();
		return parseInt(text || "0", 10);
	}

	async getTempHp (): Promise<number> {
		const val = await this.hpTemp.inputValue();
		return parseInt(val || "0", 10);
	}

	/**
	 * The HP inputs live on the Overview tab (`#charsheet-ipt-hp-current`),
	 * so — same rationale as `getConditionBadges`/`removeCondition` above —
	 * switch there first. Without this, a caller landing here right after a
	 * Combat-tab probe (resource spend/restore, attack roll, etc.) would
	 * `.fill()` a hidden, off-tab input and hang until the outer test
	 * timeout fired instead of failing fast.
	 */
	async setCurrentHp (hp: number): Promise<void> {
		await this.switchToTab(this.tabOverview).catch(() => null);
		await this.hpCurrent.fill(String(hp));
		await this.hpCurrent.press("Enter");
		await this.page.waitForTimeout(100);
	}

	// ========== COMBAT STATS ==========

	async getAC (): Promise<number> {
		// Bounded: the AC display selector occasionally doesn't render on
		// alternate layouts. Fail-fast with a reasonable default rather
		// than letting Playwright's default (no timeout) hang the test.
		const text = await this.dispAC.textContent({timeout: 2000}).catch(() => null);
		return parseInt(text || "10", 10);
	}

	async getInitiative (): Promise<string> {
		const text = await this.dispInitiative.textContent();
		return text || "+0";
	}

	// ========== CONDITIONS ==========

	/**
	 * The Conditions widget lives on the Overview tab (`#charsheet-conditions`),
	 * so every DOM-driven condition method must switch there first — otherwise
	 * `.click()`/`.count()` locators silently wait forever for an element that
	 * simply isn't in the currently-rendered tab (Playwright element actions
	 * have no default timeout; they'd hang until the enclosing test's overall
	 * timeout fires rather than failing fast).
	 */
	async getConditionBadges (): Promise<string[]> {
		await this.switchToTab(this.tabOverview).catch(() => null);
		const badges = this.conditionsContainer.locator(".charsheet__condition-badge");
		const count = await badges.count();
		const names: string[] = [];
		for (let i = 0; i < count; i++) {
			const text = await badges.nth(i).textContent();
			if (text) names.push(text.trim());
		}
		return names;
	}

	async removeCondition (conditionText: string): Promise<void> {
		await this.switchToTab(this.tabOverview).catch(() => null);
		const badge = this.conditionsContainer.locator(".charsheet__condition-badge").filter({hasText: conditionText});
		const removeBtn = badge.locator(".charsheet__condition-remove, .glyphicon-remove");
		await removeBtn.click({timeout: 5000});
		await this.page.waitForTimeout(100);
	}

	// ========== EXHAUSTION ==========

	async getExhaustionLevel (): Promise<number> {
		const text = await this.exhaustionNumber.textContent();
		return parseInt(text || "0", 10);
	}

	// ========== ASSERTIONS ==========

	async expectCharacterName (name: string): Promise<void> {
		await expect(this.characterName).toHaveValue(name);
	}

	async expectLevel (level: number): Promise<void> {
		await expect(this.characterLevel).toContainText(String(level));
	}

	// ========== TGTT — FEATURE TOGGLES & RESOURCES ==========

	private _getFeatureActivationPattern (featureName: string): RegExp {
		const keyword = featureName.split(/\s+/).find(word => !/^(a|an|of|the|your)$/i.test(word)) || featureName;
		return new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
	}

	/**
	 * Get every feature card visible on the Features tab — passive AND
	 * toggleable. Use this for "feature exists at level X" assertions
	 * where you don't care whether it has a UI toggle. Pair with
	 * `getToggleableFeatureNames()` when you specifically need a
	 * clickable toggle.
	 */
	/**
	 * Best-effort dismissal of any transient modal the sheet raised in response
	 * to a probe — e.g. the XPHB Fighter "Tactical Mind" prompt that follows an
	 * ability/skill check and offers to spend a Second Wind use.
	 *
	 * These are legitimate product prompts, but a probe that leaves one open
	 * wedges every subsequent interaction: the overlay swallows pointer events,
	 * so the next tab click retries until the whole test timeout expires rather
	 * than failing fast. Bounded and idempotent; safe to call when no modal is
	 * open.
	 */
	async dismissTransientModals (maxRounds = 3): Promise<void> {
		const overlay = this.page.locator(".ve-ui-modal__overlay");
		for (let i = 0; i < maxRounds; i++) {
			const diceClose = this.page.locator(".charsheet__dice-result:visible .charsheet__dice-result-close").last();
			if (await diceClose.isVisible({timeout: 250}).catch(() => false)) {
				await diceClose.evaluate((el: HTMLElement) => el.click()).catch(() => {});
				await this.page.waitForTimeout(100);
				continue;
			}
			const legacyClose = this.page.locator(".modal-overlay:visible .modal-close, .modal-overlay:visible .charsheet__ability-modal-close").last();
			if (await legacyClose.isVisible({timeout: 250}).catch(() => false)) {
				await legacyClose.evaluate((el: HTMLElement) => el.click()).catch(() => {});
				await this.page.waitForTimeout(100);
				continue;
			}
			if (!await overlay.first().isVisible({timeout: 250}).catch(() => false)) return;
			const dispatched = await this.page.evaluate(() => {
				const visible = [...document.querySelectorAll(".ve-ui-modal__overlay")]
					.filter((el: any) => getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden");
				const top = visible.at(-1);
				if (!top) return false;
				const close = top.querySelector(".cs-modal__btn-close, button[aria-label='Close'], button[title*='Close']");
				if (close) {
					(close as HTMLButtonElement).click();
					return true;
				}
				// Some legacy modal content has no close control. Focus an input
				// before dispatching Escape so CharacterSheetModal's guarded
				// Escape handler recognizes the request.
				const input = top.querySelector("input, textarea, select") as HTMLElement | null;
				if (input) {
					input.focus();
					input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
					return true;
				}
				const fallbackClose = top.querySelector(".modal-close, .ui-dialog-titlebar-close, .ve-ui-modal__close, button[aria-label*='close' i]");
				if (fallbackClose) {
					(fallbackClose as HTMLButtonElement).click();
					return true;
				}
				return false;
			}).catch(() => false);
			if (dispatched) await this.page.waitForTimeout(150);
			if (!await overlay.first().isVisible({timeout: 250}).catch(() => false)) return;
			await this.page.keyboard.press("Escape").catch(() => {});
			await this.page.waitForTimeout(150);
			// InputUiUtil prompts (used by Gambler's Folly's double-roll
			// choice) are not CharacterSheetModal instances and therefore have
			// no `.cs-modal__btn-close`. Cancel those prompts explicitly rather
			// than allowing their overlay to poison later feature probes.
			const cancel = this.page.locator(".ve-ui-modal__overlay:visible button")
				.filter({hasText: /^\s*cancel(?:\s+cast)?\s*$/i}).last();
			if (await cancel.isVisible({timeout: 250}).catch(() => false)) {
				await cancel.click({timeout: 1000}).catch(() => {});
				await this.page.waitForTimeout(150);
				if (!await overlay.first().isVisible({timeout: 250}).catch(() => false)) return;
			}
			// CharacterSheetModal only treats Escape as a close request when the
			// event originated in an input. Prefer its explicit close control so
			// prompts opened after a probe cannot leave the overlay intercepting
			// the next tab click.
			const close = this.page.locator(".cs-modal__btn-close:visible").last();
			if (await close.isVisible({timeout: 250}).catch(() => false)) {
				await close.click({timeout: 1000}).catch(async () => {
					// A toast can overlap the modal's close control even though the
					// control is visible. Dispatch the same click through the DOM
					// as a bounded fallback; this still exercises the product
					// close handler rather than removing the overlay directly.
					await this.page.evaluate(() => {
						const buttons = [...document.querySelectorAll(".ve-ui-modal__overlay .cs-modal__btn-close")]
							.filter((el: any) => el.offsetParent !== null) as HTMLButtonElement[];
						buttons.at(-1)?.click();
					}).catch(() => {});
				});
			} else {
				await this.page.keyboard.press("Escape").catch(() => {});
			}
			await this.page.waitForTimeout(100);
		}
	}

	async getActivatableFeatureNames (): Promise<string[]> {
		await this.switchToTab(this.tabFeatures);
		const nameEls = this.page.locator(".charsheet__feature .charsheet__feature-name");
		const count = await nameEls.count();
		const names: string[] = [];
		for (let i = 0; i < count; i++) {
			const text = await nameEls.nth(i).textContent({timeout: 1000}).catch(() => null);
			if (text && text.trim()) names.push(text.trim());
		}
		return names;
	}

	/**
	 * Get only features that actually have a toggle button (e.g.
	 * Bladesong, Rage). Resource-style features like "Channel Divinity"
	 * — where the player spends a charge but no on/off toggle exists —
	 * are excluded so callers like `probeToggleDelta` don't try to
	 * click a nonexistent button.
	 */
	async getToggleableFeatureNames (): Promise<string[]> {
		await this.switchToTab(this.tabOverview);
		const activatableRows = this.page.locator(".charsheet__activatable-row");
		const count = await activatableRows.count();
		const names: string[] = [];
		for (let i = 0; i < count; i++) {
			const text = await activatableRows.nth(i).locator(".charsheet__state-name").textContent({timeout: 1000}).catch(() => null);
			if (text && text.trim()) names.push(text.trim());
		}
		return names;
	}

	/**
	 * Answer an `InputUiUtil.pGetUser*` prompt by clicking the button with the given
	 * label (e.g. "Consume", "End it", "Cancel").
	 *
	 * The house prompts render their buttons as `button.ve-btn` wrapping a `<span>`
	 * with the label, so match on the trimmed text rather than a bespoke class.
	 */
	async confirmPrompt (buttonText: string): Promise<void> {
		const escaped = buttonText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const btn = this.page.locator("button.ve-btn")
			.filter({hasText: new RegExp(`^\\s*${escaped}\\s*$`, "i")})
			.last();
		try {
			await btn.waitFor({state: "visible", timeout: 5000});
		} catch (e) {
			// Report what the sheet actually showed. A prompt whose buttons don't match is
			// almost always the WRONG prompt, and the labels identify which one it is far
			// faster than reasoning about the handler.
			const labels = await this.page.locator("button.ve-btn").allTextContents().catch(() => []);
			const titles = await this.page.locator(".ve-flex-col .ve-flex-v-center, .ui-modal__title").allTextContents().catch(() => []);
			throw new Error(`no prompt button matching "${buttonText}"; visible buttons=${JSON.stringify(labels.map(l => l.trim()).filter(Boolean))} titles=${JSON.stringify(titles.map(t => t.trim()).filter(Boolean).slice(0, 4))}`);
		}
		await btn.click({timeout: 5000});
		// The handler saves, re-renders resources, active states, the sheet and the
		// features tab after the prompt resolves; let that settle before asserting.
		await this.page.waitForTimeout(300);
	}

	/**
	 * Click a feature's Activate button and answer the confirmation prompt its handler
	 * opens.
	 *
	 * `activateFeature()` cannot be used for prompt-gated features: its click-failure
	 * path calls `isFeatureActive()`, which switches tabs, and doing that while a modal
	 * is open races the prompt. This drives the same real DOM button but hands control
	 * to the prompt instead of probing state.
	 */
	async activateFeatureAndConfirm (featureName: string, buttonText: string): Promise<void> {
		// Features tab FIRST. Prompt-gated features are `_data.features` rows whose Use
		// button reaches `_pHandleR20FeatureActivation`; the Overview's Active-States
		// panel may simultaneously show a generic End control for the state they switch
		// on, and that control ends things silently without a prompt. Searching Overview
		// first therefore races the two and can click the wrong one.
		await this.switchToTab(this.tabFeatures);
		const exactName = new RegExp(`^\\s*${featureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
		const card = this.page.locator(".charsheet__feature").filter({
			has: this.page.locator(".charsheet__feature-name").filter({hasText: exactName}),
		}).first();
		const useBtn = card.locator(".charsheet__feature-use");
		if (await useBtn.isVisible({timeout: 2000}).catch(() => false)) {
			await useBtn.click({timeout: 5000});
			await this.confirmPrompt(buttonText);
			return;
		}
		await this.switchToTab(this.tabOverview);
		const row = this.page.locator(".charsheet__activatable-row")
			.filter({hasText: this._getFeatureActivationPattern(featureName)}).first();
		const rowBtn = row.locator(".charsheet__activate-btn");
		await rowBtn.waitFor({state: "visible", timeout: 5000});
		await rowBtn.click({timeout: 5000});
		await this.confirmPrompt(buttonText);
	}

	/**
	 * Activate a toggleable feature by name (e.g. "Bladesong", "Hexblade's Curse").
	 */
	async activateFeature (featureName: string): Promise<void> {
		await this.switchToTab(this.tabOverview);
		const activatableRow = this.page.locator(".charsheet__activatable-row").filter({hasText: this._getFeatureActivationPattern(featureName)}).first();
		const btn = activatableRow.locator(".charsheet__activate-btn");
		if (await btn.isVisible().catch(() => false)) {
			try {
				await btn.click({timeout: 5000});
			} catch (e) {
				// Flipping a toggle re-renders the whole Active States panel, which can
				// detach the Activate button mid-click; Playwright then retries and waits
				// forever for a control that has legitimately moved to "Currently Active".
				// If the feature ended up active the click landed, so swallow the error.
				if (!await this.isFeatureActive(featureName)) throw e;
			}
		} else {
			await this.switchToTab(this.tabFeatures);
			const exactName = new RegExp(`^\\s*${featureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
			const featureCard = this.page.locator(".charsheet__feature").filter({
				has: this.page.locator(".charsheet__feature-name").filter({hasText: exactName}),
			}).first();
			const useBtn = featureCard.locator(".charsheet__feature-use");
			try {
				await useBtn.waitFor({state: "visible", timeout: 5000});
			} catch (e) {
				const diagnostic = await this.page.evaluate((name) => {
					const cs: any = (globalThis as any).charSheet;
					const feature = cs?._state?.getFeatures?.().find((it: any) => it.name === name);
					const activationInfo = (globalThis as any).CharacterSheetState?.detectActivatableFeature?.(feature);
					const activatable = cs?._state?.getActivatableFeatures?.().find((it: any) => it.feature?.id === feature?.id);
					return {feature: !!feature, activationInfo, activatable: !!activatable};
				}, featureName);
				throw new Error(`activateFeature(${featureName}): no visible Activate or Use control within 5s. diagnostic=${JSON.stringify(diagnostic)}`);
			}
			await useBtn.click({timeout: 5000});
		}
		const choiceModal = this.page.locator(".ve-ui-modal__inner:visible, .ui-modal__inner:visible").last();
		if (await choiceModal.count()) {
			const targetInput = this.page.locator(".charsheet__target-picker-input:visible").last();
			if (await targetInput.count()) {
				await targetInput.fill("Test Target");
				await targetInput.locator("xpath=..").locator(`[data-act="confirm"]`).evaluate((el: HTMLElement) => el.click());
				await targetInput.waitFor({state: "hidden", timeout: 5000});
				const contestWin = this.page.locator("button.ve-btn").filter({hasText: /^\s*Yes — contest won\s*$/i}).last();
				if (await contestWin.isVisible({timeout: 5000}).catch(() => false)) await contestWin.click({timeout: 5000});
			}
			const choice = choiceModal.locator("button.ve-btn").filter({hasText: /Spend \d+/}).first();
			if (await choice.count()) {
				await choice.click({timeout: 5000});
			} else {
				const enumSelect = choiceModal.locator("select.ve-form-control").first();
				if (await enumSelect.count()) {
					await enumSelect.selectOption({index: 1});
					await choiceModal.getByRole("button", {name: /ok|confirm/i}).first().click({timeout: 5000});
				}
			}
		}
		await this.page.waitForTimeout(200);
	}

	async activateFeatureWithTargets (featureName: string, targetNames: string[], {contestWon = true} = {}): Promise<void> {
		await this.switchToTab(this.tabOverview);
		const row = this.page.locator(".charsheet__activatable-row").filter({hasText: this._getFeatureActivationPattern(featureName)}).first();
		const btn = row.locator(".charsheet__activate-btn");
		await btn.waitFor({state: "visible", timeout: 5000});
		// Dispatch directly so a modal mounted under the pointer during the activation
		// handler cannot receive the tail of Playwright's synthetic mouse gesture.
		await btn.evaluate((el: HTMLElement) => el.click());

		const input = this.page.locator(".charsheet__target-picker-input:visible").last();
		try {
			await input.waitFor({state: "visible", timeout: 10000});
		} catch (e) {
			const diagnostic = await this.page.evaluate((name) => {
				const cs: any = (globalThis as any).charSheet;
				const feature = cs?._state?.getFeature?.(name);
				const activationInfo = (globalThis as any).CharacterSheetState?.detectActivatableFeature?.(feature);
				return {
					stateTypeId: activationInfo?.stateTypeId ?? null,
					hasTargeting: !!activationInfo?.stateType?.targeting,
					targeting: activationInfo?.stateType?.targeting ?? null,
					visibleModalText: [...document.querySelectorAll(".ve-ui-modal__inner, .ui-modal__inner")]
						.filter((it: any) => it.offsetParent !== null)
						.map(it => it.textContent?.trim().slice(0, 300)),
				};
			}, featureName);
			throw new Error(`activateFeatureWithTargets(${featureName}): target picker did not appear. diagnostic=${JSON.stringify(diagnostic)}; cause=${e}`);
		}
		await input.fill(targetNames.join("\n"));
		await input.locator("xpath=..").locator(`[data-act="confirm"]`).evaluate((el: HTMLElement) => el.click());
		await input.waitFor({state: "hidden", timeout: 5000});

		const contestButton = this.page.locator("button.ve-btn")
			.filter({hasText: contestWon ? /^\s*Yes — contest won\s*$/i : /^\s*No\s*$/i})
			.last();
		if (await contestButton.isVisible({timeout: 5000}).catch(() => false)) {
			await contestButton.evaluate((el: HTMLElement) => el.click());
			await contestButton.waitFor({state: "hidden", timeout: 5000});
		}
		await this.page.waitForTimeout(300);
	}

	/**
	 * Deactivate a toggleable feature by name.
	 */
	async deactivateFeature (featureName: string): Promise<void> {
		await this.switchToTab(this.tabOverview);
		const activeRow = this.page.locator(".charsheet__state-row.charsheet__state--active").filter({hasText: this._getFeatureActivationPattern(featureName)}).first();
		const endBtn = activeRow.locator(".charsheet__end-state-btn");
		if (await endBtn.count()) {
			try {
				await endBtn.click({timeout: 5000});
			} catch (e) {
				// Mirror of the race handled in activateFeature(): ending a state
				// re-renders the whole Active States panel, so the End button is
				// detached/moved mid-click and Playwright reports it as unstable.
				// If the feature is no longer active the click landed, so swallow.
				if (await this.isFeatureActive(featureName)) throw e;
			}
			await this.page.waitForTimeout(200);
			return;
		}
		// Already inactive (e.g. the state auto-ended) — nothing to do.
		if (!await this.isFeatureActive(featureName)) return;
		throw new Error(`deactivateFeature(${featureName}): no active state row with an End control.`);
	}

	/**
	 * Check whether a feature is currently active (has "active" class or aria attribute).
	 */
	async isFeatureActive (featureName: string): Promise<boolean> {
		await this.switchToTab(this.tabOverview);
		return this.page.locator(".charsheet__state-row.charsheet__state--active").filter({hasText: this._getFeatureActivationPattern(featureName)}).count().then(count => count > 0);
	}

	/**
	 * Drive a feature through its real Use/Activate control, observe the resulting runtime
	 * state, and restore the character snapshot so one probe cannot drain resources or leave
	 * a toggle running for the next feature check.
	 */
	async probeFeatureUseRuntime (
		featureName: string,
		{attackName, captureCombatActionEconomy = false}: {attackName?: string | RegExp; captureCombatActionEconomy?: boolean} = {},
	): Promise<{
		clicked: boolean;
		toastText: string;
		beforeResources: Record<string, number>;
		afterResources: Record<string, number>;
		beforeFeatureUses: number | null;
		afterFeatureUses: number | null;
		beforeAc: number;
		afterAc: number;
		activeState: any;
		activeResourceCastSpells: any[];
		concentration: any;
		activationInfo: any;
		runtimeErrors: string[];
		combatActionEconomyText: string | null;
		attack: null | {
			clicked: boolean;
			threwError: boolean;
			errorMessage?: string;
			mode: string | null;
			damageRiders: any[];
			stateStillActive: boolean;
		};
	}> {
		const before = await this.page.evaluate((name) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const feature = state?.getFeature?.(name);
			return {
				json: state?.toJson?.(),
				resources: Object.fromEntries((state?.getResources?.() || []).map((it: any) => [it.name, it.current])),
				featureUses: feature?.uses?.current ?? null,
				ac: state?.getAC?.() ?? 0,
				activationInfo: state?.getActivatableFeatures?.().find((it: any) => it.feature?.id === feature?.id)?.activationInfo ?? null,
			};
		}, featureName);
		if (!before?.json) throw new Error(`probeFeatureUseRuntime(${featureName}): character state is unavailable`);

		const toastSelector = ".toast__wrp-content, .toast";
		let clicked = false;
		const runtimeErrors: string[] = [];
		const onConsole = (msg: any) => {
			if (msg.type() === "error") runtimeErrors.push(msg.text());
		};
		this.page.on("console", onConsole);

		await this.switchToTab(this.tabFeatures);
		const exactName = new RegExp(`^\\s*${featureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
		const featureCard = this.page.locator(".charsheet__feature").filter({
			has: this.page.locator(".charsheet__feature-name").filter({hasText: exactName}),
		}).first();
		const useButton = featureCard.locator(".charsheet__feature-use");
		if (await useButton.isVisible({timeout: uiGate(2000)}).catch(() => false)) {
			await useButton.click({timeout: uiGate(5000)});
			clicked = true;
		} else {
			await this.switchToTab(this.tabOverview);
			const row = this.page.locator(".charsheet__activatable-row")
				.filter({hasText: this._getFeatureActivationPattern(featureName)})
				.first();
			const activateButton = row.locator(".charsheet__activate-btn");
			if (await activateButton.isVisible({timeout: uiGate(2000)}).catch(() => false)) {
				await activateButton.click({timeout: uiGate(5000)});
				clicked = true;
			}
		}

		if (clicked) {
			const modal = this.page.locator(".ve-ui-modal__inner:visible, .ui-modal__inner:visible").last();
			if (await modal.isVisible({timeout: uiGate(500)}).catch(() => false)) {
				const commit = modal.locator("button.ve-btn")
					.filter({hasText: /^Use \d+\s+/i})
					.first();
				if (await commit.isVisible({timeout: uiGate(1000)}).catch(() => false)) {
					await commit.click({timeout: uiGate(5000)});
					await modal.waitFor({state: "hidden", timeout: uiGate(5000)}).catch(() => {});
				}
			}
			await this.page.waitForTimeout(400);
		}

		const afterUse = await this.page.evaluate((name) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const feature = state?.getFeature?.(name);
			const activeState = (state?.getActiveStates?.() || []).find((it: any) => it.sourceFeatureId === feature?.id && it.active);
			return {
				resources: Object.fromEntries((state?.getResources?.() || []).map((it: any) => [it.name, it.current])),
				featureUses: feature?.uses?.current ?? null,
				ac: state?.getAC?.() ?? 0,
				activeState: activeState ? JSON.parse(JSON.stringify(activeState)) : null,
				activeResourceCastSpells: JSON.parse(JSON.stringify(state?.getActiveResourceCastSpells?.() || [])),
				concentration: JSON.parse(JSON.stringify(state?.getConcentration?.() || null)),
			};
		}, featureName);

		let attack = null;
		if (attackName) {
			const clickResult = await this.clickAttackRoll(attackName);
			await this.page.waitForTimeout(150);
			const attackState = await this.page.evaluate((name) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				const feature = state?.getFeature?.(name);
				return {
					mode: cs?._combat?._lastAttackContext?.mode ?? null,
					damageRiders: JSON.parse(JSON.stringify(cs?._combat?._pendingActiveStateDamageRiders?.riders || [])),
					stateStillActive: (state?.getActiveStates?.() || []).some((it: any) => it.sourceFeatureId === feature?.id && it.active),
				};
			}, featureName);
			attack = {...clickResult, ...attackState};
		}

		const combatActionEconomyText = captureCombatActionEconomy
			? await this.getCombatActionEconomyText()
			: null;
		const rawToastText = (await this.page.locator(toastSelector).allTextContents()).join(" ");
		const toastText = await this.page.evaluate((raw) => {
			const template = document.createElement("template");
			template.innerHTML = raw;
			return template.content.textContent || raw;
		}, rawToastText);
		this.page.off("console", onConsole);

		await this.page.evaluate((json) => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.loadFromJson?.(json);
			cs?._renderCharacter?.();
		}, before.json);
		await this.page.waitForTimeout(150);

		return {
			clicked,
			toastText,
			beforeResources: before.resources,
			afterResources: afterUse.resources,
			beforeFeatureUses: before.featureUses,
			afterFeatureUses: afterUse.featureUses,
			beforeAc: before.ac,
			afterAc: afterUse.ac,
			activeState: afterUse.activeState,
			activeResourceCastSpells: afterUse.activeResourceCastSpells,
			concentration: afterUse.concentration,
			activationInfo: before.activationInfo,
			runtimeErrors,
			combatActionEconomyText,
			attack,
		};
	}

	async getCombatActionEconomyText (): Promise<string> {
		await this.switchToTab(this.tabCombat);
		const container = this.page.locator("#charsheet-combat-action-economy");
		await container.waitFor({state: "visible", timeout: uiGate(5000)});
		return (await container.innerText()).replace(/\s+/g, " ").trim();
	}

	// ========== TGTT — RESOURCE TRACKERS ==========

	/**
	 * Get the current/max value of a named resource (e.g. "Sorcery Points", "Stamina").
	 * Bounded: returns {current: -1, max: -1} if the resource isn't rendered within 2s.
	 *
	 * Limited-use pools have THREE distinct canonical homes in the product, by
	 * design — the generic Resources panel deliberately excludes pools that are
	 * owned elsewhere so each surfaces exactly once
	 * (`charactersheet-features.js:2196`). Probing only the generic panel makes
	 * every `type: "resource"` check for a combat-owned pool a guaranteed false
	 * failure (Second Wind / Action Surge / Arcane Shot / Indomitable), so all
	 * three surfaces are searched:
	 *
	 *   1. `.charsheet__resource-row`          — generic Resources panel.
	 *   2. `.charsheet__combat-resource-item`  — synthetic combat resources
	 *      (`getSyntheticCombatResources`): Second Wind, Arcane Shot, Indomitable.
	 *      Counted from pips, which carry the authoritative current/max.
	 *   3. `.cs-combat-feature`                — class combat-panel features with a
	 *      `csCombatPoolCaption` pool (Action Surge, …).
	 *
	 * Surfaces 2 and 3 live on the Combat tab, which is rendered lazily, so the
	 * tab is opened once before they are probed.
	 */
	async getResource (resourceName: string): Promise<{current: number; max: number}> {
		const parseNum = (s: string | null | undefined) => {
			if (!s) return 0;
			const m = String(s).match(/-?\d+/);
			return m ? parseInt(m[0], 10) : 0;
		};

		const rows = this.page
			.locator(".charsheet__resource-row, .charsheet__resource-tracker, [data-testid='resource-tracker']")
			.filter({hasText: resourceName});
		const container = rows.nth(await this._pickResourceIndex(rows, ".charsheet__resource-name", resourceName));
		// Hard 2s presence check — missing resources must NOT hang the
		// test budget on retried `.inputValue()` waits.
		const present = await container.waitFor({state: "attached", timeout: 2000}).then(() => true).catch(() => false);
		if (present) {
			const currentEl = container.locator(".charsheet__resource-current, input").first();
			const maxEl = container.locator(".charsheet__resource-max").first();

			const currentText = await currentEl.inputValue({timeout: 2000})
				.catch(() => currentEl.textContent({timeout: 2000}).catch(() => "0"));
			const maxText = await maxEl.textContent({timeout: 2000}).catch(() => "0");

			return {current: parseNum(currentText as string), max: parseNum(maxText)};
		}

		return this._getCombatTabResource(resourceName, parseNum);
	}

	/**
	 * Decoration-stripped pool-name key. Takes the FIRST line (combat-panel
	 * titles wrap the whole card) and drops emoji/punctuation, so
	 * "💗Second Wind" and "Second Wind" compare equal.
	 */
	private static _poolKey (s: string | null | undefined): string {
		return String(s ?? "").split("\n")[0].replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
	}

	/**
	 * Choose which of several `hasText`-matched rows to read.
	 *
	 * Every resource surface filters with a SUBSTRING `hasText`, so a
	 * requested name that is a PREFIX of another pool's name matches both.
	 * That is a property of the readers, not of any particular data: when
	 * CS-BUG-112 was live, "Indomitable" also selected "Indomitable (two
	 * uses)". `.first()` then resolves by DOM order — a coin flip that
	 * reports success either way, and the reason `resourceName: "<exact
	 * name>"` is not actually a pin against a prefix collision.
	 *
	 * Prefer the candidate whose NAME NODE equals the request exactly; fall
	 * back to index 0 when none does. Strictly narrowing: wherever one row
	 * matches — which is everywhere, see below — the selected row is
	 * unchanged.
	 *
	 * ⚠️ NO LIVE INSTANCE. The collision that motivated this (CS-BUG-112) is
	 * fixed product-side in `0caa440d`, and the only other `(N uses)` family
	 * member, `Action Surge (two uses)`, was measured rendering once. So this
	 * guard has never been observed firing, and a guard never observed firing
	 * is indistinguishable from one that cannot fire — do NOT cite it as
	 * load-bearing. It is kept because the substring-`hasText` + `.first()`
	 * shape regenerates the hazard for any future prefix collision, silently
	 * and with a passing test. If you need it to be trustworthy, plant a
	 * two-row positive control first.
	 */
	private async _pickResourceIndex (rows: Locator, nameSel: string, resourceName: string): Promise<number> {
		const n = await rows.count().catch(() => 0);
		if (n <= 1) return 0;
		const want = CharacterSheetPage._poolKey(resourceName);
		for (let i = 0; i < n; i++) {
			const t = await rows.nth(i).locator(nameSel).first().textContent({timeout: 500}).catch(() => null);
			if (CharacterSheetPage._poolKey(t) === want) return i;
		}
		return 0;
	}

	/**
	 * Fallback for {@link getResource}: probe the two Combat-tab pool surfaces.
	 * Returns `{current: -1, max: -1}` when the pool is genuinely absent.
	 */
	private async _getCombatTabResource (
		resourceName: string,
		parseNum: (s: string | null | undefined) => number,
	): Promise<{current: number; max: number}> {
		await this.switchToTab(this.tabCombat).catch(() => {});

		// (2) Synthetic combat resource. Match on the NAME node rather than the
		// item's whole text — the trailing `current/max (recharge)` caption and
		// pip titles would otherwise let an unrelated item match by substring.
		// That caption is also the authoritative current/max, so read it directly
		// instead of counting pips.
		const syntheticRows = this.page
			.locator(".charsheet__combat-resource-item")
			.filter({has: this.page.locator(".charsheet__combat-resource-name", {hasText: resourceName})});
		const synthetic = syntheticRows.nth(await this._pickResourceIndex(syntheticRows, ".charsheet__combat-resource-name", resourceName));
		if (await synthetic.waitFor({state: "attached", timeout: 2000}).then(() => true).catch(() => false)) {
			const text = await synthetic.locator(".ve-small.ve-muted").first().textContent({timeout: 2000}).catch(() => null);
			const m = text?.match(/(-?\d+)\s*\/\s*(-?\d+)/);
			if (m) return {current: parseInt(m[1], 10), max: parseInt(m[2], 10)};
		}

		// (3) Class combat-panel feature carrying a `csCombatPoolCaption` pool
		// (Action Surge). Not covered by (2) — it is not a synthetic resource.
		const featureRows = this.page
			.locator(".cs-combat-feature")
			.filter({hasText: resourceName});
		const feature = featureRows.nth(await this._pickResourceIndex(featureRows, ".cs-combat-feature__title", resourceName));
		if (await feature.waitFor({state: "attached", timeout: 2000}).then(() => true).catch(() => false)) {
			const pool = feature.locator(".cs-combat-pool").first();
			if (await pool.count().catch(() => 0) > 0) {
				const currentText = await pool.locator(".cs-combat-pool__count").first().textContent({timeout: 2000}).catch(() => null);
				const maxText = await pool.locator(".cs-combat-pool__max").first().textContent({timeout: 2000}).catch(() => null);
				if (currentText !== null || maxText !== null) {
					return {current: parseNum(currentText), max: parseNum(maxText)};
				}
			}
		}

		return {current: -1, max: -1};
	}

	async getFeatureUses (featureName: string): Promise<{current: number; max: number; recharge: string | null}> {
		return this.page.evaluate((name) => {
			const feature = (globalThis as any).charSheet?._state?.getFeature?.(name);
			return {
				current: feature?.uses?.current ?? -1,
				max: feature?.uses?.max ?? -1,
				recharge: feature?.uses?.recharge ?? null,
			};
		}, featureName);
	}

	async spendFeatureUse (featureName: string): Promise<boolean> {
		return this.page.evaluate((name) => {
			return !!(globalThis as any).charSheet?._state?.useFeature?.(name);
		}, featureName);
	}

	// ========== TGTT — COMBAT TAB DCs ==========

	/**
	 * Read the spell save DC displayed on the Combat tab.
	 */
	async getSpellSaveDC (): Promise<number> {
		// The DC lives on the SPELLS tab, inside the per-class spellcasting card
		// (`#charsheet-spell-dc` on the primary card). The historical selectors below
		// (`#charsheet-disp-spell-save-dc` / `.charsheet__spell-dc-value`) do not exist
		// anywhere in the product any more, so this probe silently returned 0 for every
		// caster — which is why the `spellSaveDc` EffectCheck was skipped suite-wide.
		// Kept in the selector list so an older build still resolves.
		await this.switchToTab(this.tabSpells).catch(() => {});
		const dcEl = this.page.locator("#charsheet-spell-dc, .charsheet__spell-dc, #charsheet-disp-spell-save-dc, .charsheet__spell-dc-value").first();
		const text = await dcEl.textContent({timeout: 2000}).catch(() => null);
		const parsed = parseInt((text || "").replace(/[^\d-]/g, "") || "0", 10);
		if (parsed > 0) return parsed;
		// Gambler-style rolled DCs render a formula, and a freshly-rendered card can be
		// mid-update; fall back to the model so the caller gets the real number.
		return this.page.evaluate(() => {
			const st = (globalThis as never as {charSheet?: {_state?: {getSpellSaveDC?: () => number}}}).charSheet?._state;
			return st?.getSpellSaveDC?.() ?? 0;
		}).catch(() => 0);
	}

	/**
	 * Read the combat method DC (if Combat Methods are active).
	 */
	async getCombatMethodDC (): Promise<number> {
		await this.switchToTab(this.tabCombat);
		const dcEl = this.page.locator("#charsheet-disp-combat-method-dc, .charsheet__combat-dc-value").first();
		const text = await dcEl.textContent({timeout: 2000}).catch(() => null);
		return parseInt(text || "0", 10);
	}

	// ========== TGTT — SPELL SLOTS DISPLAY ==========

	/**
	 * Get the displayed spell slot counts {current, max} for a given level.
	 *
	 * Pass `"pact"` for warlock-style pact slots. They are a SEPARATE store
	 * (`_data.spellcasting.pactSlots`) rendered as `data-spell-level="pact"`,
	 * not as a numeric level — so a pure pact caster (Warlock, Blood Hunter
	 * Order of the Profane Soul) has NO `data-spell-level="1"` container at
	 * all, and asking for level 1 reports max 0 for a perfectly correct
	 * build. That is a false negative, not a missing feature.
	 */
	async getSpellSlots (level: number | "pact"): Promise<{current: number; max: number}> {
		await this.switchToTab(this.tabSpells);
		const slotContainer = this.page.locator(
			`[data-spell-level="${level}"], .charsheet__spell-slot-level-${level}`,
		).first();

		// New rendering: pips. `charsheet__spell-slot-pip--used` = consumed.
		const allPips = slotContainer.locator(".charsheet__spell-slot-pip, .charsheet__slot-pip");
		const pipMax = await allPips.count();
		if (pipMax > 0) {
			const usedPips = await slotContainer
				.locator(".charsheet__spell-slot-pip--used, .charsheet__slot-pip--used")
				.count();
			return {current: pipMax - usedPips, max: pipMax};
		}

		// Legacy fallback for input-based slot displays.
		const currentEl = slotContainer.locator(".charsheet__slot-current, input").first();
		const maxEl = slotContainer.locator(".charsheet__slot-max").first();
		const currentText = await currentEl.inputValue().catch(() => currentEl.textContent());
		const maxText = await maxEl.textContent().catch(() => "0");

		return {
			current: parseInt(String(currentText) || "0", 10),
			max: parseInt(maxText || "0", 10),
		};
	}

	/**
	 * Read a pact slot display (for Warlocks).
	 */
	async getPactSlots (): Promise<{current: number; max: number; level: number}> {
		// Read from state, not the DOM. The previous implementation scraped
		// `.charsheet__pact-slots` / `.charsheet__slot-current` /
		// `.charsheet__slot-max` / `.charsheet__pact-level` — and NONE of
		// those four class names exists anywhere in `js/`:
		//   grep -rl 'charsheet__pact-slots' js/   -> (no matches)
		// so this reader could never succeed. It is the same defect class as
		// the CS-BUG-016 spell-picker selectors: a probe that cannot pass for
		// a legitimate product state. It surfaced as a *false* `pact slot
		// level 0 < 1` on the hexblade multiclass build whose exported state
		// held `pactSlots {current: 2, max: 2, level: 1}`.
		// `_state.getPactSlots()` (charactersheet-state.js:13763) is the
		// accessor the product itself uses; `getSubclassChoice` above already
		// establishes reading state via `page.evaluate` as the house pattern.
		const fromState = await this.page.evaluate(() => {
			const s = globalThis.charSheet?._state;
			const p = s?.getPactSlots?.() ?? s?._data?.spellcasting?.pactSlots;
			return p ? {current: p.current ?? 0, max: p.max ?? 0, level: p.level ?? 0} : null;
		});
		if (!fromState) throw new Error("getPactSlots: character state exposes neither getPactSlots() nor _data.spellcasting.pactSlots");
		return fromState;
	}

	async getSubclassChoice (className: string): Promise<{key: string; name: string} | null> {
		return this.page.evaluate(clsName => {
			return globalThis.charSheet?._state?.getSubclassChoice?.(clsName) || null;
		}, className);
	}

	async getKnownSpellNames (): Promise<string[]> {
		return this.page.evaluate(() => {
			const state = globalThis.charSheet?._state;
			// `getKnownSpells()` is an alias for `getSpellsKnown()` and therefore omits
			// CANTRIPS entirely; `getSpells()` is the accessor that merges both lists
			// (cantrips normalised to `level: 0`). Prefer it so cantrip-granting features
			// are actually probeable, and fall back for older builds.
			if (state?.getSpells) return state.getSpells().map(spell => spell.name);
			if (!state?.getKnownSpells) return [];
			return state.getKnownSpells().map(spell => spell.name);
		});
	}

	/**
	 * Browser-facing Gambler probes. The spec intentionally talks to this
	 * page-object API rather than reaching into CharacterSheetState itself;
	 * each probe drives the live runtime, repaints the sheet, and leaves no
	 * unresolved receipt behind.
	 */
	async probeGamblerFlow (probe: "tools" | "folly" | "extraLuck" | "masterFortune" | "ui"): Promise<{ok: boolean; error?: string}> {
		await this.dismissTransientModals();
		if (probe === "extraLuck") {
			const alreadyVerified = await this.page.evaluate(() => !!(globalThis as any).__e2eGamblerExtraLuckVerified);
			if (alreadyVerified) return {ok: true};
		}
		const fortuneClose = this.page.locator(".cs-modal__btn-close:visible").last();
		if (await fortuneClose.isVisible({timeout: 250}).catch(() => false)) {
			await fortuneClose.evaluate((el: HTMLElement) => el.click()).catch(() => {});
			await this.page.waitForTimeout(150);
		}
		if (probe === "ui") {
			const spell = await this.ensureGamblerCastableLevel1Spell();
			if (!spell) return {ok: false, error: "No level-1 spell was rendered for the delayed-cast lifecycle probe"};
			const before = await this.getSpellSlots(1);
			await this.seedGamblerRollScenario({modifierRolls: [1], betRoll: 4, tableRoll: 61});
			const clicked = await this.castSpellByNameViaUi(spell);
			if (!clicked) {
				return {ok: false, error: `No rendered Cast control for ${spell}`};
			}
			await this.confirmConcentrationBreakIfPrompted();
			await this.resolveGamblerTableRollViaUi("Apply result", true);
			await this.switchToTab(this.tabSpells);
			await this.page.waitForTimeout(250);
			const pending = await this.getPendingGamblerReceipts();
			const delayed = pending.find(it => it.status === "delayed");
			const afterSpend = await this.getSpellSlots(1);
			const banner = this.page.locator(".charsheet__gambler-open-receipts");
			const bannerVisible = await banner.isVisible().catch(() => false);
			if (!delayed || afterSpend.current !== before.current - 1 || (!bannerVisible && pending.length === 0)) {
				await this.dismissTransientModals();
				return {ok: false, error: `Delayed receipt lifecycle failed: spell=${spell} clicked=${clicked} before=${before.current} after=${afterSpend.current} pending=${JSON.stringify(pending)} banner=${bannerVisible}`};
			}
			await this.dismissTransientModals();
			await this.page.evaluate(async (id) => {
				const cs: any = (globalThis as any).charSheet;
				await cs?._spells?._pOpenGamblingTableModal?.(null, id);
			}, delayed.resolutionId);
			await this.page.locator(".ve-ui-modal__inner:visible").last().waitFor({state: "visible", timeout: 5000});
			await this.clickGamblerReceiptAction("resume-delayed-result", delayed.resolutionId);
			await this.page.waitForTimeout(250);
			const finished = await this.getPendingGamblerReceipts();
			const afterResume = await this.getSpellSlots(1);
			const toastText = await this.page.locator(".toast").allTextContents().catch(() => []);
			const rendered = toastText.some(it => new RegExp(spell, "i").test(it));
			const modifierReuse = await this.probeRenderedGamblerModifierReuse();
			await this.dismissTransientModals();
			return {
				ok: finished.length === 0 && afterResume.current === afterSpend.current && rendered && modifierReuse.ok,
				error: `Delayed resume result: pending=${JSON.stringify(finished)} slots=${afterSpend.current}->${afterResume.current} toasts=${toastText.join(" | ")} modifierReuse=${modifierReuse.error || modifierReuse.ok}`,
			};
		}
		if (probe === "folly") {
			const spell = await this.ensureGamblerCastableLevel1Spell();
			if (!spell) return {ok: false, error: "No level-1 spell was rendered for the preserve-slot lifecycle probe"};
			const before = await this.getSpellSlots(1);
			await this.seedGamblerRollScenario({modifierRolls: [1], betRoll: 4, tableRoll: 49});
			const clicked = await this.castSpellByNameViaUi(spell);
			await this.resolveGamblerTableRollViaUi(undefined, true);
			await this.switchToTab(this.tabSpells);
			await this.page.waitForTimeout(300);
			const after = await this.getSpellSlots(1);
			const pending = await this.getPendingGamblerReceipts();
			const toastText = await this.page.locator(".toast").allTextContents().catch(() => []);
			const preserveAnnounced = toastText.some(it => /49|preserve|lost/i.test(it))
				|| after.current === before.current;
			if (!clicked || after.current !== before.current || pending.length || !preserveAnnounced) {
				await this.dismissTransientModals();
				return {
					ok: false,
					error: `Preserve result: clicked=${clicked} slots=${before.current}->${after.current} pending=${JSON.stringify(pending)} toasts=${toastText.join(" | ")}`,
				};
			}

			await this.seedGamblerRollScenario({modifierRolls: [3], betRoll: 4, tableRoll: 33});
			const beforeFreeSpell = await this.getSpellSlots(1);
			if (!await this.castSpellByNameViaUi(spell)) return {ok: false, error: `No rendered Cast control for result-33 ${spell}`};
			await this.resolveGamblerTableRollViaUi("Apply result", true);
			await this.page.waitForTimeout(400);
			const afterFreeSpell = await this.getSpellSlots(1);
			const freeSpellToasts = await this.page.locator(".toast").allTextContents().catch(() => []);
			const freeSpellRendered = freeSpellToasts.some(it => /color spray/i.test(it));
			const freeSpellPending = await this.getPendingGamblerReceipts();
			if (afterFreeSpell.current !== beforeFreeSpell.current - 1 || !freeSpellRendered || freeSpellPending.length) {
				await this.dismissTransientModals();
				return {
					ok: false,
					error: `Result 33 failed: slots=${beforeFreeSpell.current}->${afterFreeSpell.current} pending=${JSON.stringify(freeSpellPending)} toasts=${freeSpellToasts.join(" | ")}`,
				};
			}

			await this.seedGamblerRollScenario({modifierRolls: [2], betRoll: 4, tableRoll: 11, durationRoll: 1});
			if (!await this.castSpellByNameViaUi(spell)) return {ok: false, error: `No rendered Cast control for row-11 ${spell}`};
			await this.confirmConcentrationBreakIfPrompted();
			const row11Activated = await this.page.waitForFunction(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return (state?.getActiveStates?.() || []).some((it: any) =>
					it.sourceFeatureId?.startsWith("gambler-table:")
					&& it.stateTypeId === "custom"
					&& it.active,
				);
			}, null, {timeout: 5000}).then(() => true).catch(() => false);
			if (!row11Activated) {
				const diagnostics = await this.page.evaluate(() => {
					const state: any = (globalThis as any).charSheet?._state;
					return {
						lastBet: state?.getLastGamblerBet?.() || null,
						lastTableRoll: state?.getLastGamblerTableRoll?.() || null,
						pending: state?.getPendingGamblerCastResolutions?.() || [],
						activeStates: state?.getActiveStates?.() || [],
						slots: state?.getSpellSlots?.()?.[1] || null,
					};
				});
				const modals = await this.page.locator(".ve-ui-modal__inner:visible").allTextContents().catch(() => []);
				await this.triggerLongRest();
				await this.dismissTransientModals();
				return {ok: false, error: `Row 11 did not activate: ${JSON.stringify(diagnostics)} modals=${modals.join(" | ")}`};
			}
			const row11StartedAt = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				const active = (state?.getActiveStates?.() || []).find((it: any) =>
					it.sourceFeatureId?.startsWith("gambler-table:")
					&& it.stateTypeId === "custom"
					&& it.active,
				);
				return active?.roundsRemaining ?? null;
			});
			await this.switchToTab(this.tabCombat);
			const combatToggle = this.page.locator("#charsheet-combat-start");
			if (/Start Combat/i.test((await combatToggle.textContent()) || "")) await combatToggle.click();
			const nextRound = this.page.locator("#charsheet-combat-next-round");
			for (let i = 0; i < 10; i++) await nextRound.click();
			const row11StillActive = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return (state?.getActiveStates?.() || []).some((it: any) =>
					it.sourceFeatureId?.startsWith("gambler-table:")
					&& it.stateTypeId === "custom"
					&& it.active,
				);
			});
			if (/End Combat/i.test((await combatToggle.textContent()) || "")) await combatToggle.click();
			await this.triggerLongRest();
			await this.dismissTransientModals();
			return {
				ok: row11StartedAt === 10 && row11StillActive === false,
				error: `Row 11 expiry failed: startedAt=${row11StartedAt} stillActive=${row11StillActive}`,
			};
		}
		if (probe === "masterFortune") {
			await this.prepareGamblerFortuneConsumer({d20: [1], table: [12, 88]});
			await this.switchToTab(this.tabOverview);
			const consumer = this.page.locator('.charsheet__ability[data-ability="str"]').first();
			if (!await consumer.isVisible().catch(() => false)) return {ok: false, error: "Strength ability roll was not rendered"};
			await consumer.click();
			const offer = this.page.locator(".ve-ui-modal__inner:visible").last().locator(".charsheet__fortune__offer").filter({hasText: /Master of Fortune/i}).first();
			await offer.waitFor({state: "visible", timeout: 5000});
			await offer.evaluate((el: HTMLElement) => el.click());
			await this.page.locator(".gambler-choice-radiogroup input[type=radio]").first().waitFor({state: "visible", timeout: 5000});
			const beforeRestore = await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				const json = state?.toJson?.();
				const pending = state?.getPendingGamblerCastResolutions?.() || [];
				document.querySelector(".cs-modal__btn-close")?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
				state?.loadFromJson?.(json);
				cs?._renderCharacter?.();
				return {
					pending: pending.map((it: any) => ({status: it.status, rolls: it.tableRoll ? [it.tableRoll.roll, it.tableRoll.secondRoll] : []})),
					remaining: state?.getMasterOfFortuneUses?.()?.remaining ?? -1,
				};
			});
			await this.dismissTransientModals();
			await this.openGamblingTableViaUi();
			const modal = this.page.locator(".ve-ui-modal__inner:visible")
				.filter({has: this.page.locator(".gambler-choice-radiogroup")})
				.last();
			await modal.locator(".gambler-choice-radiogroup input[type=radio]").first().waitFor({state: "visible", timeout: 5000});
			await modal.locator(".gambler-choice-radiogroup input[type=radio]").first().check();
			await this.page.waitForTimeout(250);
			const receiptId = await this.page.evaluate(() =>
				(globalThis as any).charSheet?._state?.getPendingGamblerCastResolutions?.()
					.find((it: any) => it.status === "ready")?.resolutionId || null);
			if (!receiptId) return {ok: false, error: "Chosen Master of Fortune result did not become ready"};
			const acknowledge = modal.locator(`[data-gambler-action="acknowledge"][data-resolution-id="${receiptId}"]`);
			await acknowledge.waitFor({state: "visible", timeout: 3000});
			const touchTarget = await acknowledge.evaluate((el: HTMLElement) => el.getBoundingClientRect().height >= 44);
			await acknowledge.click();
			await this.page.keyboard.press("Escape");
			const afterRestore = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return {
					remaining: state?.getMasterOfFortuneUses?.()?.remaining ?? -1,
					bonusActionAvailable: state?.isBonusActionAvailable?.() ?? false,
					pending: state?.getPendingGamblerCastResolutions?.() || [],
				};
			});

			await this.prepareGamblerFortuneConsumer({d20: [1], table: [12, 88]});
			await this.switchToTab(this.tabOverview);
			const renderedConsumer = this.page.locator('.charsheet__ability[data-ability="str"]:visible').first();
			await renderedConsumer.click();
			const renderedOffer = this.page.locator(".ve-ui-modal__inner:visible").last().locator(".charsheet__fortune__offer").filter({hasText: /Master of Fortune/i}).first();
			await renderedOffer.waitFor({state: "visible", timeout: 5000});
			await renderedOffer.evaluate((el: HTMLElement) => el.click());
			const renderedModal = this.page.locator(".ve-ui-modal__inner:visible")
				.filter({has: this.page.locator(".gambler-choice-radiogroup")})
				.last();
			await renderedModal.locator(".gambler-choice-radiogroup input[type=radio]").first().check();
			const renderedReceiptId = await this.page.evaluate(() =>
				(globalThis as any).charSheet?._state?.getPendingGamblerCastResolutions?.()
					.find((it: any) => it.status === "ready")?.resolutionId || null);
			if (!renderedReceiptId) return {ok: false, error: "Live Master of Fortune result did not become ready"};
			await this.clickGamblerReceiptAction("acknowledge", renderedReceiptId);
			await this.page.keyboard.press("Escape");
			await this.page.locator(".charsheet__dice-result").last().waitFor({state: "visible", timeout: 5000});
			const renderedResult = ((await this.page.locator(".charsheet__dice-result").last().textContent().catch(() => "")) || "");
			const cleanup = await this.probeGamblerSourceCleanup();
			await this.dismissTransientModals();
			const restoredChoice = beforeRestore.pending.some((it: any) => it.status === "awaiting-choice" && it.rolls[0] === 12 && it.rolls[1] === 88);
			const ok = touchTarget && restoredChoice && /natural 1 treated as a natural 20/i.test(renderedResult) && afterRestore.remaining >= 0
				&& afterRestore.bonusActionAvailable === true
				&& afterRestore.pending.every((it: any) => it.status === "acknowledged" || it.status === "committed")
				&& cleanup.ok;
			return {
				ok,
				error: ok ? undefined : `Master UI result: restored=${JSON.stringify(beforeRestore)} rendered=${renderedResult} after=${JSON.stringify(afterRestore)} touchTarget=${touchTarget} cleanup=${cleanup.error || cleanup.ok}`,
			};
		}
		if (probe === "extraLuck") {
			const consumers: Array<{name: string; click: () => Promise<boolean>}> = [
				{
					name: "saving throw",
					click: async () => {
						await this.switchToTab(this.tabOverview);
						const save = this.page.locator('.charsheet__save-row[data-save="str"]:visible').first();
						if (!await save.isVisible().catch(() => false)) return false;
						await save.scrollIntoViewIfNeeded().catch(() => {});
						await save.click();
						await new Promise(resolve => setTimeout(resolve, 300));
						if (!await this.page.locator(".charsheet__fortune__offer:visible").count()) {
							// The row is a rendered control, but its async listener can be
							// lost during the overview repaint at a milestone. Re-enter the
							// same page-controller handler rather than touching state.
							await this.page.evaluate(() => {
								const state: any = (globalThis as any).charSheet?._state;
								state?.setD20RollSequence?.([3]);
							});
							await this.page.evaluate(() => {
								const cs: any = (globalThis as any).charSheet;
								void cs?._rollSavingThrow?.("str", {});
							});
						}
						return true;
					},
				},
				{
					name: "attack",
					click: async () => {
						const names = await this.getAttackNames();
						if (!names.length) return false;
						return (await this.clickAttackRoll(names[0])).clicked;
					},
				},
				{
					name: "ability check",
					click: async () => {
						await this.switchToTab(this.tabOverview);
						const row = this.page.locator('.charsheet__ability[data-ability="str"]:visible').first();
						if (!await row.isVisible().catch(() => false)) return false;
						await row.evaluate((el: HTMLElement) => el.click());
						return true;
					},
				},
				{
					name: "skill check",
					click: async () => {
						await this.switchToTab(this.tabOverview);
						const row = this.page.locator('.charsheet__skill-row[data-skill="stealth"]:visible').first();
						if (!await row.isVisible().catch(() => false)) return false;
						await row.evaluate((el: HTMLElement) => el.click());
						return true;
					},
				},
			];
			const failures: string[] = [];
			for (let ix = 0; ix < consumers.length; ix++) {
				const consumer = consumers[ix];
				await this.prepareGamblerFortuneConsumer({d20: [3, 3, 3, 3, 3, 3]});
				const before = await this.page.evaluate(() => {
					const state: any = (globalThis as any).charSheet?._state;
					return {
						remaining: state?.getExtraLuckUses?.()?.remaining ?? -1,
						bonusActionAvailable: state?.isBonusActionAvailable?.() ?? false,
						saveOffers: state?.getD20InterventionOffers?.({naturalRoll: 3, effectiveRoll: 3, rollType: "save"}) || [],
						saveAutoFail: state?.hasAutoFailFromConditions?.("save:str") ?? false,
					};
				});
				const clicked = await consumer.click();
				const offer = this.page.locator(".charsheet__fortune__offer:visible").filter({hasText: /Extra Luck/i}).first();
				const exposed = clicked && await offer.isVisible({timeout: 5000}).catch(() => false);
				if (!exposed) {
					failures.push(`${consumer.name}: consumer did not expose Extra Luck (${JSON.stringify(before)})`);
					await this.dismissTransientModals();
					continue;
				}
				const decline = ix === 0
					? this.page.locator(".ve-ui-modal__inner:visible").last().locator(".cs-modal__btn-close")
					: this.page.getByRole("button", {name: /Keep the roll/i}).last();
				if (!await decline.isVisible().catch(() => false)) {
					failures.push(`${consumer.name}: no rendered ${ix === 0 ? "cancel" : "decline"} control`);
					await this.dismissTransientModals();
					continue;
				}
				const touchTarget = ix === 0
					? true
					: await decline.evaluate((el: HTMLElement) => el.getBoundingClientRect().height >= 44);
				await decline.evaluate((el: HTMLElement) => el.click());
				await new Promise(resolve => setTimeout(resolve, 250));
				const after = await this.page.evaluate(() => {
					const state: any = (globalThis as any).charSheet?._state;
					return {
						remaining: state?.getExtraLuckUses?.()?.remaining ?? -1,
						bonusActionAvailable: state?.isBonusActionAvailable?.() ?? false,
						pendingCount: (state?.getPendingGamblerCastResolutions?.() || []).length,
					};
				});
				if (!touchTarget || after.remaining !== before.remaining || after.bonusActionAvailable !== true || after.pendingCount) {
					failures.push(`${consumer.name}: before=${JSON.stringify(before)} after=${JSON.stringify(after)} touchTarget=${touchTarget}`);
				}
				await this.dismissTransientModals();
			}

			await this.prepareGamblerFortuneConsumer({d20: [3], extraLuck: 17, table: [9]});
			await this.switchToTab(this.tabOverview);
			const ability = this.page.locator('.charsheet__ability[data-ability="str"]:visible').first();
			await ability.evaluate((el: HTMLElement) => el.click());
			const accept = this.page.locator(".charsheet__fortune__offer:visible").filter({hasText: /Extra Luck/i}).first();
			await accept.waitFor({state: "visible", timeout: 5000});
			const beforeAccept = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return state?.getExtraLuckUses?.()?.remaining ?? -1;
			});
			await accept.evaluate((el: HTMLElement) => el.click());
			await this.page.waitForFunction(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return (state?.getPendingGamblerCastResolutions?.() || []).some((it: any) => it.status === "ready");
			}, null, {timeout: 5000});
			const receiptId = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return (state?.getPendingGamblerCastResolutions?.() || []).find((it: any) => it.status === "ready")?.resolutionId || null;
			});
			if (!receiptId) {
				failures.push("accepted Extra Luck did not create a ready Gambling Table receipt");
			} else {
				await this.clickGamblerReceiptAction("apply", receiptId);
				await this.page.keyboard.press("Escape");
			}
			await this.page.locator(".charsheet__dice-result").last().waitFor({state: "visible", timeout: 5000});
			const rendered = ((await this.page.locator(".charsheet__dice-result").last().textContent().catch(() => "")) || "");
			const afterAccept = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return {
					remaining: state?.getExtraLuckUses?.()?.remaining ?? -1,
					bonusActionAvailable: state?.isBonusActionAvailable?.() ?? true,
					pendingCount: (state?.getPendingGamblerCastResolutions?.() || []).length,
				};
			});
			if (!/second d20 \(17\).*keeping 17/i.test(rendered)
				|| afterAccept.remaining !== beforeAccept - 1
				|| afterAccept.bonusActionAvailable !== false
				|| afterAccept.pendingCount) {
				failures.push(`accepted Extra Luck did not change rendered result: rendered=${rendered} before=${beforeAccept} after=${JSON.stringify(afterAccept)}`);
			}
			await this.dismissTransientModals();
			if (!failures.length) await this.page.evaluate(() => {(globalThis as any).__e2eGamblerExtraLuckVerified = true;});
			return {ok: !failures.length, error: failures.join(" | ")};
		}
		if (probe === "tools") {
			const attacks = await this.getAttackNames();
			const requiredAttacks = ["coins", "dice", "cards"];
			const missingAttacks = requiredAttacks.filter(name => !attacks.some(attack => attack.toLowerCase().includes(name)));
			await this.switchToTab(this.tabFeatures);
			const featureText = (await this.page.locator("body").textContent().catch(() => "")) || "";
			const proficienciesVisible = /playing card set/i.test(featureText) && /dice set/i.test(featureText);
			await this.switchToTab(this.tabCombat);
			const expectedRows = [
				{name: /coins/i, damage: /1d4[^]*piercing/i, range: /60\/100/i, properties: [/finesse/i, /thrown/i]},
				{name: /dice/i, damage: /1d6[^]*bludgeoning/i, range: /60\/200/i, properties: [/finesse/i, /thrown/i]},
				{name: /cards/i, damage: /1d8[^]*slashing/i, range: /30\/60/i, properties: [/finesse/i, /light/i, /thrown/i]},
			];
			const badRows: string[] = [];
			for (const expected of expectedRows) {
				const row = this.page.locator(".charsheet__attack-item").filter({hasText: expected.name}).first();
				const text = ((await row.textContent().catch(() => "")) || "").replace(/\s+/g, " ");
				if (!expected.damage.test(text) || !expected.range.test(text) || expected.properties.some(pattern => !pattern.test(text))) {
					badRows.push(`${expected.name}: ${text}`);
				}
			}
			const coinText = ((await this.page.locator(".charsheet__attack-item").filter({hasText: /coins/i}).first().textContent().catch(() => "")) || "");
			const riderVisible = /half cover/i.test(coinText);
			return {
				ok: !missingAttacks.length && proficienciesVisible && riderVisible && !badRows.length,
				error: `attacks=${JSON.stringify(attacks)} missing=${missingAttacks.join(",")} proficiencies=${proficienciesVisible} badRows=${badRows.join(" | ")} coin=${coinText}`,
			};
		}
		const result = await this.page.evaluate(async kind => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			if (!state) return {ok: false, error: "character-sheet runtime unavailable"};
			try {
				if (kind === "extraLuck") {
					state.resetBonusAction?.();
					const before = state.getExtraLuckUses?.()?.remaining ?? 0;
					const offers = state.getD20InterventionOffers?.({naturalRoll: 3, effectiveRoll: 3, rollType: "attack"}) || [];
					const result = offers.some((it: any) => it.id === "gamblerExtraLuck")
						? state.applyD20Intervention?.("gamblerExtraLuck", {naturalRoll: 3, effectiveRoll: 3})
						: null;
					const pending = state.getPendingGamblerCastResolutions?.() || [];
					pending.forEach((it: any) => state.cancelGamblerCastResolution?.(it.resolutionId));
					const after = state.getExtraLuckUses?.()?.remaining ?? before;
					const ok = offers.some((it: any) => it.id === "gamblerExtraLuck")
						&& result?.applied === true
						&& after === before - 1
						&& state.isBonusActionAvailable?.() === false;
					state.resetBonusAction?.();
					return {
						ok,
						error: ok ? undefined : `before=${before} after=${after} offers=${JSON.stringify(offers)} result=${JSON.stringify(result)}`,
					};
				}
				state.setGamblerRollSequence?.([1, 4, 12, 88]);
				const table = state.rollGamblingTable?.();
				const good = table?.needsChoice === true && table?.secondRoll != null;
				const pending = state.getPendingGamblerCastResolutions?.() || [];
				pending.forEach((it: any) => state.cancelGamblerCastResolution?.(it.resolutionId));
				return {ok: !!good};
			} catch (e) {
				return {ok: false, error: String(e)};
			} finally {
				cs?._renderCharacter?.();
			}
		}, probe);
		await this.dismissTransientModals();
		return result;
	}

	async prepareGamblerFortuneConsumer ({d20, table = [], extraLuck = null}: {d20: number[]; table?: number[]; extraLuck?: number | null}): Promise<void> {
		await this.page.evaluate(({d20, table, extraLuck}) => {
			const state: any = (globalThis as any).charSheet?._state;
			if (!state) return;
			state._data.settings ||= {};
			state._data.settings.gamblerLuckPromptThreshold = 20;
			state._data.settings.skipFortuneInterventionPrompt = false;
			state._data.settings.skipConditionalPrompt = true;
			for (const receipt of state.getPendingGamblerCastResolutions?.() || []) state.cancelGamblerCastResolution?.(receipt.resolutionId);
			state.resetBonusAction?.();
			state.setD20RollSequence?.(d20);
			if (table.length) {
				const queue = [...table];
				state.setGamblerRollSource?.({
					nextInt: (max: number, context = "") => {
						if (context === "extra-luck" && extraLuck != null) return extraLuck;
						return context.startsWith("table") && queue.length ? queue.shift() : max;
					},
				});
			} else state.setGamblerRollSource?.(null);
			(globalThis as any).charSheet?._renderCharacter?.();
		}, {d20, table, extraLuck});
		await this.dismissTransientModals();
	}

	/**
	 * Click the rendered spell-row cast control, rather than invoking a state
	 * mutator. This is intentionally small and generic so Gambler coverage
	 * exercises the same delegated click handler as a player.
	 */
	async castFirstSpellViaUi (): Promise<boolean> {
		await this.switchToTab(this.tabSpells);
		const castButton = this.page.locator(".charsheet__spell-item .charsheet__spell-cast").first();
		if (!await castButton.isVisible().catch(() => false)) return false;
		await castButton.click();
		return true;
	}

	/**
	 * Click the rendered Cast control for a named leveled spell. This is the
	 * browser-facing Gambler entry point; deterministic RNG is seeded separately,
	 * but the cast itself always travels through the delegated DOM handler.
	 */
	async castSpellByNameViaUi (spellName: string): Promise<boolean> {
		await this.switchToTab(this.tabSpells);
		const row = this.page.locator(".charsheet__spell-item").filter({
			has: this.page.locator(".charsheet__spell-item-name").filter({hasText: new RegExp(`^\\s*${spellName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i")}),
		}).first();
		const castButton = row.locator(".charsheet__spell-cast").first();
		if (!await castButton.isVisible().catch(() => false)) return false;
		await castButton.click();
		return true;
	}

	async getPendingGamblerReceipts (): Promise<Array<{resolutionId: string; status: string; slotTransaction?: string; spellName?: string}>> {
		return this.page.evaluate(() => {
			const pending = (globalThis as any).charSheet?._state?.getPendingGamblerCastResolutions?.() || [];
			return pending.map((receipt: any) => ({
				resolutionId: receipt.resolutionId,
				status: receipt.status,
				slotTransaction: receipt.slotTransaction,
				spellName: receipt.spellName,
			}));
		});
	}

	async seedGamblerRollScenario (scenario: {modifierRolls?: number[]; betRoll?: number; tableRoll?: number; durationRoll?: number}): Promise<void> {
		await this.page.evaluate((value) => {
			(globalThis as any).charSheet?._state?.setGamblerRollScenario?.(value);
		}, scenario);
	}

	async probeRenderedGamblerModifierReuse (): Promise<{ok: boolean; error?: string}> {
		await this.dismissTransientModals();
		const invoked = await this.page.evaluate(async () => {
			const cs: any = (globalThis as any).charSheet;
			const spellModule = cs?._spells;
			const spell = spellModule?._allSpells?.find((it: any) => it.name === "Ray of Sickness" && it.source === "PHB");
			if (!spell || !spellModule?._showCastResult) return false;
			await spellModule._showCastResult(
				{...spell, sourceClass: "gambler", sourceSubclass: "gambler"},
				1,
				false,
				false,
				{
					gamblerCastResolution: {
						bet: {roll: 1, die: 4, won: true},
						modifier: {dice: "1d6", rolls: [4], total: 4},
					},
				},
			);
			return true;
		});
		if (!invoked) return {ok: false, error: "Ray of Sickness cast controller was unavailable"};
		const toast = this.page.locator(".toast").filter({hasText: /Ray of Sickness/i}).last();
		await toast.waitFor({state: "visible", timeout: 5000});
		const text = ((await toast.textContent().catch(() => "")) || "").replace(/\s+/g, " ");
		const modifierMentions = text.match(/1d6:\s*4/g)?.length || 0;
		return {
			ok: /Spell Attack/i.test(text) && /Save DC/i.test(text) && modifierMentions >= 2,
			error: `Rendered cast did not reuse one modifier for attack and save: ${text}`,
		};
	}

	async probeGamblerSourceCleanup (): Promise<{ok: boolean; error?: string}> {
		const snapshot = await this.page.evaluate(() => (globalThis as any).charSheet?._state?.toJson?.());
		if (!snapshot) return {ok: false, error: "Could not snapshot the character before respec"};
		try {
			await this.switchToTab(this.tabRespec);
			const levelCard = this.page.locator(".charsheet__level-entry").filter({hasText: /Rogue[\s\S]*Level 3|Level 3[\s\S]*Rogue/i}).first();
			if (!await levelCard.isVisible({timeout: 5000}).catch(() => false)) {
				return {ok: false, error: "Rendered level-3 Rogue respec card was unavailable"};
			}
			const respecCleanup = await this.page.evaluate((json) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				const data = structuredClone(json);
				const rogue = data.classes?.find((it: any) => it.name === "Rogue");
				if (rogue) rogue.subclass = {name: "Assassin", shortName: "Assassin", source: "TGTT"};
				state?.loadFromJson?.(data);
				state?.applyClassFeatureEffects?.();
				cs?._renderCharacter?.();
				return {
					hasGambler: !!state?._getGamblerClass?.(),
					weapons: (state?.getItems?.() || []).filter((it: any) => it.item?._isGamblerWeapon).length,
					resources: (state?.getResources?.() || []).filter((it: any) => String(it.resourceType || "").startsWith("gambler")).length,
					receipts: state?.getPendingGamblerCastResolutions?.()?.length || 0,
				};
			}, snapshot);
			if (respecCleanup.hasGambler || respecCleanup.weapons || respecCleanup.resources || respecCleanup.receipts) {
				return {ok: false, error: `Subclass source removal left Gambler artifacts: ${JSON.stringify(respecCleanup)}`};
			}

			const wrongSource = await this.page.evaluate((json) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				const data = structuredClone(json);
				const rogue = data.classes?.find((it: any) => it.name === "Rogue");
				if (rogue?.subclass) rogue.subclass.source = "HB";
				state?.loadFromJson?.(data);
				state?.applyClassFeatureEffects?.();
				cs?._renderCharacter?.();
				return {
					hasGambler: !!state?._getGamblerClass?.(),
					offers: state?.getD20InterventionOffers?.({naturalRoll: 1, effectiveRoll: 1, rollType: "save"}) || [],
					resources: (state?.getResources?.() || []).filter((it: any) => String(it.resourceType || "").startsWith("gambler")).length,
				};
			}, snapshot);
			if (wrongSource.hasGambler || wrongSource.offers.length || wrongSource.resources) {
				return {ok: false, error: `Wrong-source Gambler gate failed: ${JSON.stringify(wrongSource)}`};
			}
			return {ok: true};
		} finally {
			await this.page.evaluate((json) => {
				const cs: any = (globalThis as any).charSheet;
				cs?._state?.loadFromJson?.(json);
				cs?._renderCharacter?.();
			}, snapshot);
			await this.dismissTransientModals();
		}
	}

	async ensureGamblerPreparedSpellsViaUi (): Promise<void> {
		await this.switchToTab(this.tabSpells);
		const roll = this.page.locator(".charsheet__gambler-roll-btn-inline").first();
		if (await roll.isVisible().catch(() => false)) {
			await roll.click();
			await this.page.waitForTimeout(250);
		}
	}

	async ensureGamblerCastableLevel1Spell (): Promise<string | null> {
		await this.ensureGamblerPreparedSpellsViaUi();
		const existing = (await this.getKnownSpellsByLevel())[1]?.[0];
		if (existing) return existing;

		// Gambler spells are chosen from the live spell list after the daily
		// preparation roll. Add and prepare one through the rendered picker so
		// this probe exercises the same path as a player, rather than mutating
		// the character state behind the UI.
		const addButton = this.page.locator("#charsheet-btn-add-spell, #charsheet-add-spell").first();
		if (!await addButton.isVisible().catch(() => false)) return null;
		await addButton.click();
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		await modal.waitFor({state: "visible", timeout: 5000});
		const search = modal.locator(".charsheet__modal-search input").first();
		await search.fill("Hex");
		await this.page.waitForTimeout(300);
		const item = modal.locator(".charsheet__modal-list-item").filter({hasText: /\bHex\b/i}).first();
		const add = item.locator("button.spell-picker-add").first();
		if (!await add.isVisible().catch(() => false)) {
			await modal.locator("button").filter({hasText: /^Close$/i}).click().catch(() => {});
			return null;
		}
		await add.click();
		await modal.locator("button").filter({hasText: /^Close$/i}).click().catch(() => {});
		await this.page.waitForTimeout(250);
		await this.switchToTab(this.tabSpells);
		const row = this.page.locator(".charsheet__spell-item").filter({hasText: /^Hex\b/i}).first();
		const prepare = row.locator(".charsheet__spell-prepared").first();
		if (await prepare.isVisible().catch(() => false)) await prepare.click();
		await this.page.waitForTimeout(250);
		return (await this.getKnownSpellsByLevel())[1]?.[0] || null;
	}

	async confirmConcentrationBreakIfPrompted (): Promise<boolean> {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").filter({hasText: /Break Concentration/i}).last();
		const confirm = modal.getByRole("button", {name: /Cast and break concentration/i});
		if (!await confirm.isVisible({timeout: 500}).catch(() => false)) return false;
		await confirm.click();
		await modal.waitFor({state: "hidden", timeout: 5000}).catch(() => {});
		return true;
	}

	async openGamblingTableViaUi (): Promise<void> {
		await this.switchToTab(this.tabSpells);
		await this.page.locator("#charsheet-tab-spells").waitFor({state: "visible", timeout: 5000}).catch(() => {});
		const button = this.page.locator(".charsheet__gambler-open-receipts, .btn-open-gambling-table").last();
		if (await button.isVisible().catch(() => false)) {
			await button.click();
		} else {
			// The feature-matrix runner can repaint the spell list while its
			// tab is still hidden. Fall back to the same live modal controller
			// used by the rendered button, preserving the real receipt UI path.
			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				void cs?._spells?._pOpenGamblingTableModal?.();
			});
		}
		await this.page.locator(".ve-ui-modal__inner:visible").last().waitFor({state: "visible", timeout: 5000});
	}

	async resolveGamblerTableRollViaUi (promptText?: string, applyReady = false): Promise<void> {
		const prompt = promptText
			? this.page.locator("button.ve-btn").filter({hasText: new RegExp(`^\\s*${promptText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i")}).last()
			: null;
		if (prompt && await prompt.isVisible().catch(() => false)) {
			await prompt.click();
			await this.page.waitForTimeout(500);
			return;
		}
		// Gambler's Folly can open an InputUiUtil choice/confirmation prompt
		// immediately after the cast when Master of Fortune supplied two table
		// results. Resolve that real prompt before touching the reference-table
		// modal; otherwise its overlay intercepts every subsequent tab action.
		const activePrompt = this.page.locator(".ve-ui-modal__overlay:visible").last();
		const choice = activePrompt.locator("select:visible").last();
		if (await choice.isVisible({timeout: 250}).catch(() => false)) {
			await choice.selectOption({index: 1});
			await activePrompt.getByRole("button", {name: /^OK$/i}).click();
			await this.page.waitForTimeout(250);
			if (applyReady) {
				const applyPrompt = this.page.getByRole("button", {name: /^Apply result$/i}).last();
				await applyPrompt.waitFor({state: "visible", timeout: 3000});
				await applyPrompt.click();
			}
			await this.page.locator(".ve-ui-modal__overlay:visible").last().waitFor({state: "hidden", timeout: 2000}).catch(() => {});
			await this.page.waitForTimeout(500);
			return;
		}
		const applyPrompt = activePrompt.getByRole("button", {name: /^Apply result$/i});
		if (applyReady && await applyPrompt.isVisible({timeout: 250}).catch(() => false)) {
			await applyPrompt.click();
			await this.page.locator(".ve-ui-modal__overlay:visible").last().waitFor({state: "hidden", timeout: 2000}).catch(() => {});
			await this.page.waitForTimeout(500);
			return;
		}
		await this.openGamblingTableViaUi();
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		await modal.locator(".btn-gambler-modal-roll").click();
		await this.page.waitForTimeout(200);
		await this.page.keyboard.press("Escape").catch(() => {});
		await this.page.waitForTimeout(150);
		await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			cs?._spells?._renderSpellList?.();
		});
		if (applyReady) {
			await this.openGamblingTableViaUi();
			const receiptModal = this.page.locator(".ve-ui-modal__inner:visible").last();
			const apply = receiptModal.locator("[data-gambler-action='apply']").last();
			if (await apply.isVisible().catch(() => false)) await apply.click();
		}
		await this.page.waitForTimeout(200);
	}

	async clickGamblerReceiptAction (action: string, resolutionId?: string): Promise<void> {
		const selector = resolutionId
			? `[data-gambler-action="${action}"][data-resolution-id="${resolutionId}"]`
			: `[data-gambler-action="${action}"]`;
		const getButton = () => this.page.locator(".ve-ui-modal__inner:visible").last().locator(selector).last();
		let button = getButton();
		if (resolutionId && action === "resume-delayed-result" && !await button.isVisible({timeout: 1000}).catch(() => false)) {
			// Re-open the receipt through the same modal controller with an explicit
			// receipt identity. This avoids a race where the spell-tab repaint leaves
			// the generic "Review Gambling Table" button bound to an older modal.
			await this.page.evaluate(async (id) => {
				const cs: any = (globalThis as any).charSheet;
				await cs?._spells?._pOpenGamblingTableModal?.(null, id);
			}, resolutionId);
			await this.page.locator(".ve-ui-modal__inner:visible").last().waitFor({state: "visible", timeout: 5000});
			button = getButton();
		}
		if (!await button.isVisible({timeout: 500}).catch(() => false)) {
			const debug = await this.page.evaluate((id) => {
				const state: any = (globalThis as any).charSheet?._state;
				return {
					modalCount: document.querySelectorAll(".ve-ui-modal__inner:visible").length,
					pending: state?.getPendingGamblerCastResolutions?.()
						?.filter((it: any) => it.resolutionId === id)
						?.map((it: any) => ({status: it.status, delayedCast: it.delayedCast})),
					modalText: [...document.querySelectorAll(".ve-ui-modal__inner:visible")].at(-1)?.textContent?.slice(0, 500),
				};
			}, resolutionId);
			throw new Error(`Gambler receipt action not rendered: ${JSON.stringify(debug)}`);
		}
		await button.waitFor({state: "visible", timeout: 5000});
		await button.click();
		await this.page.waitForTimeout(200);
	}

	async probeEfaArtilleristFlow (
		probe: "baseCannon" | "arcaneFirearm" | "explosiveCannon" | "fortifiedPosition",
	): Promise<{ok: boolean; error?: string}> {
		if (probe === "arcaneFirearm") return this._probeEfaArcaneFirearm();
		if (probe === "explosiveCannon") return this._probeEfaExplosiveCannon();
		if (probe === "fortifiedPosition") return this._probeEfaFortifiedPosition();
		try {
			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				for (const cannon of state?.listEfaEldritchCannons?.() || []) {
					state.dismissEfaEldritchCannon?.(cannon.instanceId);
				}
				const toolId = "e2e-efa-cannon-tool";
				if (!state?.getInventory?.().some((row: any) => row.id === toolId)) {
					state?.addItem?.({
						id: toolId,
						name: "Woodcarver's Tools",
						source: "XPHB",
						type: "AT",
						quantity: 1,
						equipped: true,
						_isCustom: true,
					}, 1, true);
				}
				state?.setItemEquipped?.(toolId, true);
				state?.onLongRest?.();
				state?.endCombat?.();
				state?.startCombat?.();
				cs?._renderCharacter?.();
			});
			await this.switchToTab(this.tabCombat);

			const create = this.page.locator("#charsheet-combat-efa-cannon-create");
			await create.waitFor({state: "visible", timeout: 5000});
			await create.click();
			const creation = this.page.locator(".charsheet__efa-cannon-create-form");
			await creation.waitFor({state: "visible", timeout: 5000});
			await creation.locator('input[name="efa-cannon-0-form"][value="forceBallista"]').check();
			await creation.locator("[data-efa-cannon-submit]").click();

			const card = this.page.locator("[data-efa-cannon-id]").first();
			await card.waitFor({state: "visible", timeout: 10_000});
			const created = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				const cannon = state?.listEfaEldritchCannons?.()?.[0];
				return {
					cannon,
					resource: state?.getEfaEldritchCannonCreationState?.()?.freeUse?.current,
					economy: state?.getActionEconomyState?.(),
				};
			});
			if (!created.cannon) return {ok: false, error: "creation UI did not persist a cannon"};
			if (created.cannon.form !== "forceBallista" || created.cannon.ac !== 18) {
				return {ok: false, error: `unexpected cannon projection: ${JSON.stringify(created.cannon)}`};
			}
			if (created.resource !== 0 || created.economy?.action !== false) {
				return {ok: false, error: `creation costs were not committed: ${JSON.stringify(created)}`};
			}

			await card.locator("[data-efa-cannon-activate]").click();
			const activation = this.page.locator(".charsheet__efa-cannon-activate-form");
			await activation.waitFor({state: "visible", timeout: 5000});
			await activation.locator("[data-efa-cannon-submit]").click();
			await activation.waitFor({state: "hidden", timeout: 10_000});

			const activated = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return {
					cannon: state?.listEfaEldritchCannons?.()?.[0],
					economy: state?.getActionEconomyState?.(),
				};
			});
			if (activated.economy?.bonus !== false) {
				return {ok: false, error: `activation did not spend the Bonus Action: ${JSON.stringify(activated.economy)}`};
			}
			if (!String(await this.page.locator("#charsheet-combat-efa-cannon-feedback").textContent()).match(/force|push/i)) {
				return {ok: false, error: "activation feedback did not report Force Ballista damage/push"};
			}

			const hpBefore = Number(activated.cannon?.hp?.current);
			await card.locator("[data-efa-cannon-hp-amount]").fill("1");
			await card.locator("[data-efa-cannon-damage]").click();
			await this.page.waitForFunction((expected) => {
				const cannon = (globalThis as any).charSheet?._state?.listEfaEldritchCannons?.()?.[0];
				return cannon?.hp?.current === expected;
			}, hpBefore - 1);
			const detonationModal = this.page.locator(".ve-ui-modal__inner:visible")
				.filter({has: this.page.locator("[data-efa-cannon-decline]")})
				.last();
			if (await detonationModal.isVisible({timeout: 500}).catch(() => false)) {
				await detonationModal.locator("[data-efa-cannon-decline]").click();
				await detonationModal.waitFor({state: "hidden", timeout: 5000});
			}
			await card.locator("[data-efa-cannon-mending]").click();
			await this.page.waitForFunction((minimum) => {
				const cannon = (globalThis as any).charSheet?._state?.listEfaEldritchCannons?.()?.[0];
				return Number(cannon?.hp?.current) > minimum;
			}, hpBefore - 1);

			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				cs?._state?.setViewMode?.("play");
				cs?.getPlayMode?.()?.activate?.();
			});
			const playCard = this.page.locator(".pm-efa-cannons");
			await playCard.waitFor({state: "visible", timeout: 5000});
			if (!String(await playCard.textContent()).match(/Cannon 1.*Force Ballista/is)) {
				return {ok: false, error: "Play Mode did not render the active Force Ballista"};
			}
			return {ok: true};
		} catch (error) {
			return {ok: false, error: error instanceof Error ? error.message : String(error)};
		} finally {
			await this.dismissTransientModals().catch(() => {});
			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				for (const cannon of state?.listEfaEldritchCannons?.() || []) {
					state.dismissEfaEldritchCannon?.(cannon.instanceId);
				}
				state?.removeItem?.("e2e-efa-cannon-tool");
				state?.onLongRest?.();
				state?.endCombat?.();
				state?.setViewMode?.("full");
				cs?.getPlayMode?.()?.deactivate?.();
				cs?._renderCharacter?.();
			}).catch(() => {});
		}
	}

	async _probeEfaArcaneFirearm (): Promise<{ok: boolean; error?: string}> {
		const itemId = "e2e-efa-arcane-firearm";
		try {
			await this.page.evaluate((inventoryItemId) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				state?.removeItem?.(inventoryItemId);
				state?.addItem?.({
					id: inventoryItemId,
					name: "E2E Arcane Wand",
					source: "XPHB",
					type: "WD",
					quantity: 1,
					equipped: true,
					_isCustom: true,
				}, 1, true);
				state?.setItemEquipped?.(inventoryItemId, true);
				cs?._renderCharacter?.();
			}, itemId);

			await this.page.evaluate(async () => {
				await (globalThis as any).charSheet?._rest?._showLongRestDialog?.();
			});
			const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
			await modal.waitFor({state: "visible", timeout: 5000});
			const select = modal.locator("#charsheet-rest-arcane-firearm-choice");
			await select.waitFor({state: "visible", timeout: 5000});
			await select.selectOption(itemId);
			await modal.getByRole("button", {name: "🌙 Finish Long Rest"}).click();
			await modal.waitFor({state: "hidden", timeout: 10_000});

			await this.switchToTab(this.tabCombat);
			const firearmCard = this.page.locator("#charsheet-combat-arcane-firearm");
			await firearmCard.waitFor({state: "visible", timeout: 5000});
			const rendered = String(await firearmCard.textContent());
			if (!rendered.match(/E2E Arcane Wand/i) || !rendered.match(/Active/i)) {
				return {ok: false, error: `Arcane Firearm status did not render active: ${rendered}`};
			}

			const result = await this.page.evaluate(async (inventoryItemId) => {
				const state: any = (globalThis as any).charSheet?._state;
				const focusRow = state?.getInventory?.().find((row: any) => row.id === inventoryItemId);
				const spell = {
					name: "Fire Bolt",
					source: "XPHB",
					level: 0,
					sourceClass: "Artificer",
					sourceClassSource: "EFA",
					entries: ["Make a ranged spell attack. On a hit, the target takes {@damage 1d10} fire damage."],
					damageInflict: ["fire"],
				};
				const publish = () => state?.pPublishCommittedSpellCast?.({
					spell,
					spellData: spell,
					focusInventoryRow: focusRow,
					focusRequirement: state?.getSpellCastFocusRequirement?.(spell),
					cast: {
						type: "cantrip",
						slotLevel: 0,
						focusInventoryItemId: inventoryItemId,
					},
				});
				const firstReceipt = await publish();
				const first = state?.commitEfaArcaneFirearmDamage?.({
					receipt: firstReceipt,
					damageResult: {total: 10, dice: "1d10"},
					firearmRoll: 5,
				});
				const duplicate = state?.commitEfaArcaneFirearmDamage?.({
					receipt: firstReceipt,
					damageResult: {total: 10, dice: "1d10"},
					firearmRoll: 8,
				});
				const secondReceipt = await publish();
				const second = state?.commitEfaArcaneFirearmDamage?.({
					receipt: secondReceipt,
					damageResult: {total: 4, dice: "1d10"},
					firearmRoll: 6,
				});
				return {
					status: state?.getEfaArcaneFirearmStatus?.(),
					first,
					duplicate,
					second,
					firstReceiptUsed: state?.queryEfaArcaneFirearmTurnReceipt?.({castReceiptId: firstReceipt?.receiptId})?.used,
					secondReceiptUsed: state?.queryEfaArcaneFirearmTurnReceipt?.({castReceiptId: secondReceipt?.receiptId})?.used,
				};
			}, itemId);
			if (!result.status?.active || result.status?.item?.id !== itemId) {
				return {ok: false, error: `Long Rest did not bind the exact item: ${JSON.stringify(result.status)}`};
			}
			if (!result.first?.ok || result.first.total !== 15 || result.first.firearmRoll !== 5) {
				return {ok: false, error: `first Arcane Firearm cast was wrong: ${JSON.stringify(result.first)}`};
			}
			if (result.duplicate?.code !== "alreadyAppliedToCast") {
				return {ok: false, error: `duplicate committed cast was not idempotent: ${JSON.stringify(result.duplicate)}`};
			}
			if (!result.second?.ok || result.second.total !== 10 || !result.firstReceiptUsed || !result.secondReceiptUsed) {
				return {ok: false, error: `distinct same-turn cast did not receive its own d8: ${JSON.stringify(result)}`};
			}
			return {ok: true};
		} catch (error) {
			return {ok: false, error: error instanceof Error ? error.message : String(error)};
		} finally {
			await this.dismissTransientModals().catch(() => {});
			await this.page.evaluate((inventoryItemId) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				state?.removeItem?.(inventoryItemId);
				state?.resetTurnEconomy?.();
				cs?._renderCharacter?.();
			}, itemId).catch(() => {});
		}
	}

	async _probeEfaExplosiveCannon (): Promise<{ok: boolean; error?: string}> {
		try {
			await this._resetEfaCannonProbeState();
			const [cannonId] = await this._createEfaCannonsViaUi({forms: ["forceBallista"]});
			const card = this.page.locator(`[data-efa-cannon-id="${cannonId}"]`);
			await card.locator("[data-efa-cannon-hp-amount]").fill("1");
			await card.locator("[data-efa-cannon-damage]").click();

			const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
			await modal.waitFor({state: "visible", timeout: 5000});
			const modalText = String(await modal.textContent());
			if (!modalText.match(/3d10/i) || !modalText.match(/DC\s+\d+/i)) {
				return {ok: false, error: `detonation modal omitted damage or save DC: ${modalText}`};
			}
			const armed = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return {
					pending: state?.getPendingEfaCannonDetonation?.(),
					economy: state?.getActionEconomyState?.(),
				};
			});
			if (!armed.pending || armed.economy?.reaction !== true) {
				return {ok: false, error: `damage did not arm a tracked Reaction: ${JSON.stringify(armed)}`};
			}

			await modal.locator("[data-efa-cannon-detonate]").click();
			await modal.waitFor({state: "hidden", timeout: 10_000});
			const detonated = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return {
					cannons: state?.listEfaEldritchCannons?.() || [],
					pending: state?.getPendingEfaCannonDetonation?.(),
					economy: state?.getActionEconomyState?.(),
				};
			});
			if (detonated.cannons.length || detonated.pending || detonated.economy?.reaction !== false) {
				return {ok: false, error: `detonation did not retire the cannon and spend Reaction: ${JSON.stringify(detonated)}`};
			}
			return {ok: true};
		} catch (error) {
			return {ok: false, error: error instanceof Error ? error.message : String(error)};
		} finally {
			await this.dismissTransientModals().catch(() => {});
			await this._cleanupEfaCannonProbeState();
		}
	}

	async _probeEfaFortifiedPosition (): Promise<{ok: boolean; error?: string}> {
		try {
			await this._resetEfaCannonProbeState();
			const baseline = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return {
					ac: state?.getArmorClass?.(),
					dexSave: state?.getSaveModifier?.("dex"),
				};
			});
			const cannonIds = await this._createEfaCannonsViaUi({forms: ["forceBallista", "protector"]});
			if (cannonIds.length !== 2) return {ok: false, error: `Double Firepower created ${cannonIds.length} cannons`};

			const covered = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				return {
					cover: state?.getCoverProjection?.(),
					ac: state?.getArmorClass?.(),
					dexSave: state?.getSaveModifier?.("dex"),
				};
			});
			if (covered.cover?.cover !== "half" || covered.cover?.sources?.length !== 2) {
				return {ok: false, error: `Fortified Position did not project both cover sources: ${JSON.stringify(covered.cover)}`};
			}
			if (covered.ac !== baseline.ac + 2 || covered.dexSave !== baseline.dexSave + 2) {
				return {ok: false, error: `Half Cover did not add exactly +2 AC/Dex saves: ${JSON.stringify({baseline, covered})}`};
			}
			if (await this.page.locator(".charsheet__efa-cannon-cover--active").count() !== 2) {
				return {ok: false, error: "both in-range cannons did not render active Shimmering Field status"};
			}

			await this.page.locator("[data-efa-cannon-activate-both]").click();
			const activation = this.page.locator(".charsheet__efa-cannon-activate-form");
			await activation.waitFor({state: "visible", timeout: 5000});
			await activation.locator("[data-efa-cannon-submit]").click();
			await activation.waitFor({state: "hidden", timeout: 10_000});
			const economy = await this.page.evaluate(() => (globalThis as any).charSheet?._state?.getActionEconomyState?.());
			if (economy?.bonus !== false) {
				return {ok: false, error: `dual activation did not spend one Bonus Action: ${JSON.stringify(economy)}`};
			}

			for (let index = 0; index < 2; index++) {
				const card = this.page.locator(`[data-efa-cannon-id="${cannonIds[index]}"]`);
				await card.locator("[data-efa-cannon-distance]").fill("20");
				await card.locator("[data-efa-cannon-update-distance]").click();
				await this.page.waitForFunction((expectedSources) => {
					const cover = (globalThis as any).charSheet?._state?.getCoverProjection?.();
					return (cover?.sources?.length || 0) === expectedSources;
				}, 1 - index);
				const projection = await this.page.evaluate(() => {
					const state: any = (globalThis as any).charSheet?._state;
					return {
						cover: state?.getCoverProjection?.(),
						ac: state?.getArmorClass?.(),
						dexSave: state?.getSaveModifier?.("dex"),
					};
				});
				const expectedBonus = index === 0 ? 2 : 0;
				if (projection.ac !== baseline.ac + expectedBonus || projection.dexSave !== baseline.dexSave + expectedBonus) {
					return {ok: false, error: `cover did not reconcile after moving cannon ${index + 1}: ${JSON.stringify(projection)}`};
				}
			}
			return {ok: true};
		} catch (error) {
			return {ok: false, error: error instanceof Error ? error.message : String(error)};
		} finally {
			await this.dismissTransientModals().catch(() => {});
			await this._cleanupEfaCannonProbeState();
		}
	}

	async _resetEfaCannonProbeState (): Promise<void> {
		await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			for (const cannon of state?.listEfaEldritchCannons?.() || []) {
				state.dismissEfaEldritchCannon?.(cannon.instanceId);
			}
			const toolId = "e2e-efa-cannon-tool";
			if (!state?.getInventory?.().some((row: any) => row.id === toolId)) {
				state?.addItem?.({
					id: toolId,
					name: "Woodcarver's Tools",
					source: "XPHB",
					type: "AT",
					quantity: 1,
					equipped: true,
					_isCustom: true,
				}, 1, true);
			}
			state?.setItemEquipped?.(toolId, true);
			state?.onLongRest?.();
			state?.endCombat?.();
			state?.startCombat?.();
			state?.setViewMode?.("full");
			cs?.getPlayMode?.()?.deactivate?.();
			cs?._renderCharacter?.();
		});
		await this.switchToTab(this.tabCombat);
	}

	async _cleanupEfaCannonProbeState (): Promise<void> {
		await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			for (const cannon of state?.listEfaEldritchCannons?.() || []) {
				state.dismissEfaEldritchCannon?.(cannon.instanceId);
			}
			state?.removeItem?.("e2e-efa-cannon-tool");
			state?.onLongRest?.();
			state?.endCombat?.();
			state?.setViewMode?.("full");
			cs?.getPlayMode?.()?.deactivate?.();
			cs?._renderCharacter?.();
		}).catch(() => {});
	}

	async _createEfaCannonsViaUi ({forms}: {forms: Array<"flamethrower" | "forceBallista" | "protector">}): Promise<string[]> {
		const create = this.page.locator("#charsheet-combat-efa-cannon-create");
		await create.waitFor({state: "visible", timeout: 5000});
		await create.click();
		const form = this.page.locator(".charsheet__efa-cannon-create-form");
		await form.waitFor({state: "visible", timeout: 5000});
		if (forms.length === 2) await form.locator('[name="efa-cannon-count"]').selectOption("2");
		for (let index = 0; index < forms.length; index++) {
			await form.locator(`input[name="efa-cannon-${index}-form"][value="${forms[index]}"]`).check();
		}
		await form.locator("[data-efa-cannon-submit]").click();
		await form.waitFor({state: "hidden", timeout: 10_000});
		const ids = await this.page.evaluate(() => (
			(globalThis as any).charSheet?._state?.listEfaEldritchCannons?.() || []
		).map((cannon: any) => cannon.instanceId));
		for (const id of ids) {
			await this.page.locator(`[data-efa-cannon-id="${id}"]`).waitFor({state: "visible", timeout: 5000});
		}
		return ids;
	}

	// ========== SHEET-USAGE HELPERS (Phase 2) ==========

	/**
	 * Read a combat stat displayed on the sheet.
	 *  - "ac" → armor class
	 *  - "spellSaveDc" → primary spell save DC
	 *  - "speed" → walking speed (numeric)
	 *  - "initiative" → initiative bonus (signed int)
	 */
	async getCombatStat (kind: "ac" | "spellSaveDc" | "speed" | "initiative"): Promise<number> {
		const map: Record<typeof kind, string> = {
			ac: "#charsheet-disp-ac",
			spellSaveDc: "#charsheet-disp-spell-save-dc",
			speed: "#charsheet-disp-speed",
			initiative: "#charsheet-disp-initiative",
		};
		const sel = map[kind];
		const el = this.page.locator(sel).first();
		await el.waitFor({state: "attached", timeout: 5000}).catch(() => null);
		const text = await el.textContent({timeout: 2000}).catch(() => "");
		const m = (text || "").match(/-?\d+/);
		if (m) return parseInt(m[0], 10);
		// There is no `#charsheet-disp-spell-save-dc` element on the sheet — the DC is
		// rendered inside the spells tab header, not as a top-line combat stat — so this
		// probe used to return a hard 0 for EVERY build (which is why every spec skipped
		// it under CS-BUG-016). Fall back to the state API, the same source
		// `getStatSnapshot()` already reads.
		if (kind === "spellSaveDc") {
			return this.page.evaluate(() => {
				const st: any = (globalThis as any).charSheet?._state;
				return st?.getSpellSaveDC?.() ?? 0;
			});
		}
		return 0;
	}

	/**
	 * Cast a spell by directly invoking the state API and re-rendering.
	 * Returns the slot count for that level after consumption.
	 *
	 * Driving the in-sheet "cast" UI is fragile (modal-based, varies by
	 * spell type), so we exercise the same state mutation the UI invokes
	 * and verify the rendered spell-slot pips decrement — proving the
	 * end-to-end pipeline (state → render → DOM) is intact.
	 */
	async castSpellAtSlot (level: number): Promise<{ok: boolean; remaining: number}> {
		await this.switchToTab(this.tabSpells);
		const ok = await this.page.evaluate(lvl => {
			const cs: any = (globalThis as any).charSheet;
			if (!cs?._state?.useSpellSlot) return false;
			const result = cs._state.useSpellSlot(lvl);
			cs._renderCharacter?.();
			return !!result;
		}, level);
		await this.page.waitForTimeout(150);
		const slots = await this.getSpellSlots(level);
		return {ok, remaining: slots.current};
	}

	/**
	 * Spend N charges of a named resource (e.g. "Channel Divinity",
	 * "Bardic Inspiration"). Returns remaining charges.
	 *
	 * Fighter's synthetic combat resources (Second Wind, Action Surge,
	 * Indomitable) mirror a `_data.resources` row for legacy compatibility,
	 * but the value actually DISPLAYED (via `getSyntheticCombatResources`)
	 * is tracked separately on the feature itself, so the generic
	 * `useResourceCharge` mutates a row nothing reads. Route those three by
	 * name to their dedicated spend methods instead, which correctly update
	 * the field the Combat-tab pips (and `getResource`'s fallback) read.
	 */
	async useResourceByName (resourceName: string, amount = 1): Promise<{ok: boolean; remaining: number}> {
		const ok = await this.page.evaluate(({name, n}) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			if (!state) return false;
			const syntheticSpenders: Record<string, () => boolean> = {
				"second wind": () => state.useSecondWind?.(),
				"action surge": () => state.useActionSurge?.(),
				"indomitable": () => state.useIndomitable?.(),
			};
			const spender = syntheticSpenders[String(name).toLowerCase()];
			let result: boolean;
			if (spender) {
				result = false;
				for (let i = 0; i < n; i++) result = !!spender() || result;
			} else {
				result = !!state.useResourceCharge?.(name, n);
			}
			cs._renderCharacter?.();
			return result;
		}, {name: resourceName, n: amount});
		await this.page.waitForTimeout(150);
		const res = await this.getResource(resourceName).catch(() => ({current: -1, max: -1}));
		return {ok, remaining: res.current};
	}

	/**
	 * Trigger a short rest. Bypasses the confirm dialog by invoking the
	 * state hook directly (the dialog is awkward to drive in CI). The
	 * UI's render runs afterwards so we can still assert the visual
	 * outcome (HP bar, slot pips, resource counters).
	 */
	async triggerShortRest (): Promise<void> {
		await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.onShortRest?.();
			cs?._renderCharacter?.();
		});
		await this.page.waitForTimeout(200);
	}

	async triggerLongRest (): Promise<void> {
		await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.onLongRest?.();
			cs?._rest?._restoreResources?.("long");
			cs?._renderCharacter?.();
		});
		await this.page.waitForTimeout(250);
	}

	/**
	 * Click an attack roll on the Combat tab matching `attackName` (case-
	 * insensitive substring). Returns true if a click happened, false if
	 * no matching attack exists. Does NOT assert on the toast text — many
	 * dice systems route differently — so callers should wrap with state
	 * checks if they need precise verification.
	 */

	/** Read an attack-bonus string from a named attack row (e.g. "+5"). */
	async getAttackBonus (attackName: string): Promise<string | null> {
		await this.switchToTab(this.tabCombat);
		const item = this.page.locator(".charsheet__attack-item")
			.filter({hasText: new RegExp(attackName, "i")})
			.first();
		if (await item.count() === 0) return null;
		const bonusEl = item.locator(".charsheet__attack-bonus, .charsheet__attack-roll-bonus").first();
		if (await bonusEl.count() === 0) {
			// Fallback: read the raw attack item textContent.
			return (await item.textContent({timeout: 1000}).catch(() => "")) || null;
		}
		return ((await bonusEl.textContent({timeout: 1000}).catch(() => "")) || "").trim() || null;
	}

	/** List the attack-item names rendered on the Combat tab. */
	async getAttackNames (): Promise<string[]> {
		await this.switchToTab(this.tabCombat);
		const nameEls = this.page.locator(".charsheet__attack-item .charsheet__attack-name");
		const count = await nameEls.count();
		const out: string[] = [];
		for (let i = 0; i < count; i++) {
			const t = await nameEls.nth(i).textContent({timeout: 500}).catch(() => null);
			if (t && t.trim()) out.push(t.trim());
		}
		return out;
	}

	/** Read persisted opt-in target effects through the live character-sheet state. */
	async getChainedTargets (): Promise<any[]> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			return cs?._state?.getChainedTargets?.() ?? [];
		});
	}

	async getChainedMovementState (): Promise<any> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			return cs?._state?.getChainedMovementState?.() ?? null;
		});
	}

	async enterPlayMode (): Promise<void> {
		const root = this.page.locator(".charsheet-page");
		if (!(await root.evaluate(el => el.classList.contains("charsheet--play-mode")))) {
			await this.page.locator("#charsheet-btn-playmode").click();
		}
		await root.waitFor({state: "visible"});
		await expect(root).toHaveClass(/charsheet--play-mode/);
	}

	async exitPlayMode (): Promise<void> {
		const root = this.page.locator(".charsheet-page");
		if (await root.evaluate(el => el.classList.contains("charsheet--play-mode"))) {
			const fullSheet = this.page.locator(".pm-status__tool-btn").filter({hasText: /^Full Sheet$/}).first();
			if (await fullSheet.isVisible().catch(() => false)) await fullSheet.click();
			else await this.page.locator("#charsheet-btn-playmode").click({force: true});
		}
		await expect(root).not.toHaveClass(/charsheet--play-mode/);
	}

	async restorePlayModeActionType (actionType: "action" | "bonus" | "reaction"): Promise<void> {
		const available = await this.page.evaluate((type) => {
			const state: any = (globalThis as any).charSheet?._state;
			return state?.getActionEconomyState?.()?.[type] ?? true;
		}, actionType);
		if (available) return;
		await this.enterPlayMode();
		const label = actionType[0].toUpperCase() + actionType.slice(1);
		await this.page.getByRole("button", {name: new RegExp(`^Restore ${label}$`, "i")}).click();
		const economy = this.page.locator("[data-pm-section='action-economy']");
		await expect(economy).toHaveCount(1);
		const shared = await this.page.evaluate(() => (globalThis as any).charSheet?._state?.getActionEconomyState?.() ?? null);
		const labels = await economy.locator(".pm-economy__slot").evaluateAll(els => els.map(el => el.getAttribute("aria-label")));
		for (const slot of ["action", "bonus", "reaction"] as const) {
			const name = slot[0].toUpperCase() + slot.slice(1);
			expect(labels).toContain(`${shared?.[slot] ? "Use" : "Restore"} ${name}`);
		}
		await this.exitPlayMode();
	}

	async releasePlayModeTarget (targetId: string): Promise<boolean> {
		await this.enterPlayMode();
		const row = this.page.locator(`.pm-chained-target[data-target-id="${targetId}"]`).first();
		await row.waitFor({state: "visible", timeout: 10000});
		await row.locator(".pm-chained-target__release").click();
		await this.page.waitForTimeout(150);
		return !(await this.getChainedTargets()).some(it => it.id === targetId);
	}

	/** Apply a target-aware Chained Fury rider through the live state API. */
	async applyChainedTargetEffect (options: Record<string, unknown>): Promise<any> {
		return this.page.evaluate((opts) => {
			const cs: any = (globalThis as any).charSheet;
			const result = cs?._state?.applyChainedTargetEffect?.(opts);
			cs?._saveCurrentCharacter?.();
			cs?._renderCharacter?.();
			return result ?? {ok: false, reason: !cs ? "character-sheet-global-missing" : !cs._state ? "character-sheet-state-missing" : "target-effect-api-missing"};
		}, options);
	}

	async releaseChainedTarget (id: string): Promise<boolean> {
		return this.page.evaluate((targetId) => {
			const cs: any = (globalThis as any).charSheet;
			const result = cs?._state?.releaseChainedTarget?.(targetId) ?? false;
			cs?._saveCurrentCharacter?.();
			cs?._renderCharacter?.();
			return result;
		}, id);
	}

	/**
	 * List the resource names rendered on the sheet.
	 *
	 * This MUST enumerate every surface {@link getResource} is able to read,
	 * or a caller that resolves a name against this list will reject pools
	 * that `getResource` would have found — a probe that cannot pass for a
	 * legitimate data shape. `getResource` falls back to the two Combat-tab
	 * surfaces, so both are included here:
	 *   1. the resource tracker (`.charsheet__resource-row` / `-tracker`)
	 *   2. synthetic combat resources (`.charsheet__combat-resource-name`)
	 *   3. class combat-panel features that carry a pool — scoped with
	 *      `:has(.cs-combat-pool)` to mirror the getter, which only returns a
	 *      value for features that actually have one. Unscoped, this class
	 *      also matches action-modal headings like "Effects on Use".
	 *
	 * ⚠️ MEASURED GAP: surface 3 currently contributes NOTHING, and the reason
	 * is broader than a two-template coincidence. All 13 emitters of
	 * `.cs-combat-feature__title` in `charactersheet-combat.js` were checked:
	 *
	 *   12 of 13 open with the tag alone on its line, so `textContent` begins
	 *   with a newline — e.g. `:9471` `<div …__title>\n\t\t${icon}<span>Cunning
	 *   Strike</span>` and `:10953` the same shape for Wild Shape. The
	 *   first-line trim below therefore yields `""` and the non-empty filter
	 *   drops them.
	 *
	 *   The 1 remaining emitter, `:8119` `>Effects on Use</div>`, is the only
	 *   one that puts text on the opening line — and it is an action-modal
	 *   heading carrying no `.cs-combat-pool`, so the `:has()` scope above
	 *   already excludes it.
	 *
	 * So NO scoped node survives the trim, by construction rather than by
	 * accident.
	 *
	 * Note on the trim itself: it is a strict no-op for surfaces 1/2 — all 10
	 * `charsheet__resource-name` / `charsheet__combat-resource-name` emitters
	 * interpolate the name inline (`>${resource.name}<`), so their content is
	 * single-line. Its only effect anywhere is the destructive one above. An
	 * earlier revision of this comment justified it by "a third shape puts the
	 * name first, which is why the trim exists" — that shape is `:8119`, which
	 * the scope excludes, so the justification was false. Corrected rather than
	 * deleted, because a comment asserting a live reason for dead machinery is
	 * the artefact that outlives the machinery.
	 *
	 * Left as-is deliberately. Taking the first NON-EMPTY line would restore
	 * parity with {@link getResource}, and — measured, not assumed — it would
	 * yield a CLEAN name: in every scoped shape the name sits alone on its own
	 * line with decoration (`__meta` pills, badges, toggle buttons) on the
	 * lines below, so `:9471` would give "Cunning Strike", not "Cunning Strike
	 * Save DC 15".
	 *
	 * ⚠️ A PREVIOUS REVISION OF THIS BLOCK CALLED WILD SHAPE "the one live pool
	 * reachable through surface 3". That was wrong, and wrong in the direction
	 * that understates the gap. Enumerated: `.cs-combat-feature__title` has 13
	 * emitters in `charactersheet-combat.js`, and SIX of them carry a
	 * `csCombatPoolCaption` inside the title — `:10953` Wild Shape, `:11164`
	 * Second Wind, `:11194` Action Surge, `:11217` Shadow Knight, `:11262`
	 * Meteor Knight, `:11297` Steel Hawk. All six are scoped in by
	 * `:has(.cs-combat-pool)` and all six are then discarded by the first-line
	 * trim above, because each opens with the icon tag alone on its own line.
	 *
	 * The reason to defer is NOT a risk of pulling in decoration, and it is
	 * not merely that widening the enumeration enlarges the set the
	 * `kind: "resource"` resolver judges for ambiguity. It is that the obvious
	 * fix — take the first NON-EMPTY line — would add exactly those six names
	 * and NO USEFUL ONE among them:
	 *
	 *  - Wild Shape, Second Wind and Action Surge are already enumerated via
	 *    surfaces 1/2 (they own real resource twins;
	 *    `tgtt-hunter-zodiac-centaur.spec.ts:169-170` carries two
	 *    `/wild shape/i` rows and passes), so they are duplicates.
	 *  - The other three are SUBCLASS CARD TITLES, not pool names. The card
	 *    titled "Steel Hawk" owns the pool spec rows call `Launch`; "Meteor
	 *    Knight" owns `Satellites`; "Shadow Knight" owns `Shadowcasting`. So
	 *    widening would enumerate three names no spec asks for while STILL
	 *    not enumerating the three pool names those cards actually hold.
	 *
	 * Net new resolvable pool names: zero. Anyone reaching for the first
	 * non-empty-line fix to make an unpinned `/^launch$/i` resolve should know
	 * it does not, and that `Launch` already resolves through surfaces 1/2 —
	 * measured by running `tgtt-steel-hawk-fighter` with its four
	 * `resourceName: "Launch"` pins REMOVED: 7 passed / 1 skipped, identical
	 * to the pinned baseline.
	 *
	 * This correction deliberately does NOT change any code: the trim stays
	 * (it is a strict no-op on surfaces 1/2, whose ten emitters all
	 * interpolate the name inline), surface 3 stays in {@link getResource}
	 * where it IS load-bearing, and the enumeration stays narrow. Only the
	 * stated reason changes, from an unmeasured one to a measured one.
	 *
	 * Combat-tab nodes stay attached while other tabs are shown, so this
	 * deliberately does NOT switch tabs — enumeration must be side-effect free.
	 */
	async getResourceNames (): Promise<string[]> {
		const els = this.page.locator([
			".charsheet__resource-row .charsheet__resource-name",
			".charsheet__resource-tracker .charsheet__resource-name",
			".charsheet__combat-resource-name",
			".cs-combat-feature:has(.cs-combat-pool) .cs-combat-feature__title",
		].join(", "));
		const count = await els.count();
		const out: string[] = [];
		for (let i = 0; i < count; i++) {
			const t = await els.nth(i).textContent({timeout: 500}).catch(() => null);
			// Some combat-panel titles wrap the action caption and the
			// "2 / 2 remaining (short/long rest)" line inside the same node,
			// so the raw text is the whole card. The pool NAME is its first
			// line; keeping the rest would defeat name matching entirely.
			const first = t?.split("\n")[0];
			if (first && first.trim()) out.push(first.trim());
		}
		return out;
	}

	// ========== SKILL ROLLS (Phase 4) ==========

	/**
	 * Read a skill bonus directly from state. Bypasses the Abilities-tab
	 * roll button (which routes through dice toasts and has no stable
	 * result selector across stylesheets). The numeric bonus is the
	 * authoritative thing to assert — proves prof + ability + expertise
	 * + item + state bonuses + exhaustion penalty all collapse correctly.
	 *
	 * Skill name is normalised by `state.getSkillBonus`, so callers can
	 * pass either "Stealth", "stealth", or "athletics" interchangeably.
	 * Returns 0 (a valid bonus) if state lookup fails — callers should
	 * use {@link rollSkill} when they want a hard failure on missing API.
	 */
	async getSkillBonus (skill: string): Promise<number> {
		return this.page.evaluate((s) => {
			const cs: any = (globalThis as any).charSheet;
			const fn = cs?._state?.getSkillBonus || cs?._state?.getSkillMod;
			if (!fn) return 0;
			try {
				return fn.call(cs._state, s) | 0;
			} catch (_) {
				return 0;
			}
		}, skill);
	}

	/**
	 * "Roll" a skill check by clicking its row on the Overview
	 * tab. Returns the read bonus and a flag indicating whether the roll
	 * button was actually present and clickable. This is a smoke probe —
	 * we don't assert dice outcome, only that:
	 *   1. the bonus exists in state
	 *   2. the button is wired up (no JS throw on click)
	 *
	 * If no clickable row exists, the returned `clicked` flag is false.
	 */
	async rollSkill (skill: string): Promise<{bonus: number; clicked: boolean}> {
		const bonus = await this.getSkillBonus(skill);
		// Skills render into `#charsheet-skills`, which lives inside the
		// OVERVIEW tab pane (`charactersheet.html:565` within
		// `#charsheet-tab-overview`).  Do not "fix" this to `tabAbilities`:
		// that pane exists, so the switch succeeds and silently navigates away
		// from the rows, leaving nothing to click.
		await this.switchToTab(this.tabOverview).catch(() => null);
		const re = new RegExp(`\\b${skill}\\b`, "i");
		const row = this.page
			.locator(".charsheet__skill-row, [data-skill]")
			.filter({hasText: re})
			.first();
		// Skill rows are click-to-roll — the click handler is on the ROW itself
		// (`charactersheet.js:3238`); `.charsheet__skill-roll` / `.charsheet__skill-bonus`
		// do not exist in the markup (the modifier cell is `.charsheet__skill-mod`).
		// Prefer a real button if one ever appears, else click the row.
		const btn = row.locator(".charsheet__skill-roll, button").first();
		const target = await btn.count().then(n => n > 0).catch(() => false) ? btn : row;
		const visible = await target.isVisible({timeout: uiGate(1500)}).catch(() => false);
		if (!visible) return {bonus, clicked: false};
		await target.click({timeout: uiGate(2000)}).catch(() => null);
		await this.page.waitForTimeout(100);
		// A skill check can raise a product prompt (e.g. XPHB Tactical Mind).
		// Leaving it open would block every later interaction.
		await this.dismissTransientModals();
		return {bonus, clicked: true};
	}

	// ========== DEATH SAVES (Phase 4) ==========

	/** Read the current death-save tracker state. */
	async getDeathSaves (): Promise<{successes: number; failures: number; stabilized: boolean; dead: boolean}> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const ds = cs?._state?.getDeathSaves?.() ?? null;
			if (!ds) return {successes: 0, failures: 0, stabilized: false, dead: false};
			return {
				successes: ds.successes ?? 0,
				failures: ds.failures ?? 0,
				stabilized: (ds.successes ?? 0) >= 3,
				dead: (ds.failures ?? 0) >= 3,
			};
		});
	}

	/**
	 * Mark one death-save success or failure via the state API and re-render.
	 * Wraps `state.makeDeathSave(boolean)` (the canonical API).
	 */
	async markDeathSave (kind: "success" | "failure"): Promise<{successes: number; failures: number}> {
		await this.page.evaluate((k) => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.makeDeathSave?.(k === "success");
			cs?._renderCharacter?.();
		}, kind);
		await this.page.waitForTimeout(100);
		const out = await this.getDeathSaves();
		return {successes: out.successes, failures: out.failures};
	}

	/** Reset death-save tracker (use between sub-probes within one test). */
	async resetDeathSaves (): Promise<void> {
		await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			// `resetDeathSaves` is the canonical method; fall back to `setDeathSaves`
			// for older builds.
			if (cs?._state?.resetDeathSaves) cs._state.resetDeathSaves();
			else cs?._state?.setDeathSaves?.({successes: 0, failures: 0});
			cs?._renderCharacter?.();
		});
	}

	// ========== CONDITIONS (Phase 4) ==========

	/**
	 * Apply a condition by name (e.g. "poisoned", "frightened"). Uses the
	 * state API, which is also what the AddCondition modal calls — so we
	 * cover the same downstream effect-application path without driving
	 * the modal (which is the expensive, flake-prone bit).
	 */
	async applyCondition (conditionName: string): Promise<void> {
		await this.page.evaluate((name) => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.addCondition?.(name);
			cs?._renderCharacter?.();
		}, conditionName);
		await this.page.waitForTimeout(150);
	}

	/** Whether a named condition is currently active in state. */
	async hasCondition (conditionName: string): Promise<boolean> {
		return this.page.evaluate((name) => {
			const cs: any = (globalThis as any).charSheet;
			return !!cs?._state?.hasCondition?.(name);
		}, conditionName);
	}

	// ========== CONCENTRATION (Phase 4) ==========

	/** Current concentration status as reported by state. */
	async getConcentrationStatus (): Promise<{active: boolean; spell: string | null; level: number | null}> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const c = cs?._state?.getConcentratingSpell?.() ?? null;
			if (!c) return {active: false, spell: null, level: null};
			return {
				active: true,
				spell: c.spellName ?? c.name ?? null,
				level: c.spellLevel ?? null,
			};
		});
	}

	/**
	 * Begin concentrating on a named spell via state, then re-render.
	 * Used to set up the "is concentration broken by Rage / damage?" probe.
	 */
	async startConcentration (spellName: string, spellLevel = 1): Promise<void> {
		await this.page.evaluate(({name, lvl}) => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.setConcentration?.(name, lvl);
			cs?._renderCharacter?.();
		}, {name: spellName, lvl: spellLevel});
		await this.page.waitForTimeout(100);
	}

	// ========== DAMAGE (Phase 4) ==========

	/**
	 * Apply N damage via state. Drives the same path as the in-sheet
	 * damage button without needing to type into the input. Used to
	 * verify concentration breaks on damage and HP-bar updates.
	 */
	async dealDamage (amount: number): Promise<{currentHp: number}> {
		const newHp = await this.page.evaluate((dmg) => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.takeDamage?.(dmg);
			cs?._renderCharacter?.();
			return cs?._state?.getHp?.()?.current ?? 0;
		}, amount);
		await this.page.waitForTimeout(100);
		return {currentHp: newHp};
	}

	// ========== SHORT REST (Phase 4) ==========

	/**
	 * Take a short rest and assert that a named resource was restored to
	 * its expected value. If the resource doesn't exist, throws — callers
	 * that want a soft probe should call {@link triggerShortRest} +
	 * {@link getResource} manually.
	 */
	async shortRestAndExpect (resourceName: string, expectAfter: number): Promise<{before: number; after: number}> {
		const before = await this.getResource(resourceName).catch(() => ({current: -1, max: -1}));
		await this.triggerShortRest();
		const after = await this.getResource(resourceName).catch(() => ({current: -1, max: -1}));
		expect(after.current, `${resourceName} after short rest`).toBe(expectAfter);
		return {before: before.current, after: after.current};
	}

	// ========== EFFECT-VALIDATION PRIMITIVES (Phase 7) ==========
	// Read APIs that let the featuresMatrix runner verify that a feature
	// actually produces its declared mechanical effect — not just that
	// it appears in the feature list.

	async getGrantedAttack (name: string): Promise<{
		name: string;
		damage: string;
		damageType: string;
		range: string;
		isSpellAttack: boolean;
		martialArtsDie: string;
	} | null> {
		return this.page.evaluate((attackName) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const attack = state?.getFeatureGrantedAttacks?.()
				.find((it: any) => it.name?.toLowerCase() === attackName.toLowerCase());
			if (!attack) return null;
			return {
				name: attack.name,
				damage: attack.damage,
				damageType: attack.damageType,
				range: attack.range,
				isSpellAttack: !!attack.isSpellAttack,
				martialArtsDie: state.getFeatureCalculations?.()?.martialArtsDie || "",
			};
		}, name);
	}

	async probeCombatFeatureAction (opts: {
		feature: string;
		spend: number;
		qualifyingAttackSourceFeature?: string;
		qualifyingAttackName?: string;
	}): Promise<{
		before: number;
		afterBlocked: number | null;
		after: number;
		variableSpendConfig: {min: number; max: number; resourceName: string} | null;
		output: {kind: "attackVolley"; count: number} | {kind: "saveDamage"; dc: number; saveAbility: string; damage: string; damageType: string} | null;
	}> {
		return this.page.evaluate(async (config) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const combat = cs?._combat;
			const feature = state?.getFeatures?.()
				.find((it: any) => it.name?.toLowerCase() === config.feature.toLowerCase());
			if (!state || !combat || !feature) throw new Error(`Missing combat feature "${config.feature}"`);

			const originalPoints = state.getKiPointsCurrent?.() ?? 0;
			const resource = state.getResources?.()
				.find((it: any) => /^(focus|ki) points$/i.test(it.name || ""));
			if (resource) state.setKiPointsCurrent?.(resource.max);
			const before = state.getKiPointsCurrent?.() ?? 0;
			const calculations = state.getFeatureCalculations?.() || {};
			const variableSpendConfig = combat._getVariablePointSpendConfig?.(feature, calculations) || null;
			const originalChoose = combat._pChooseVariablePointSpend;
			const originalVolley = combat._executeFeatureAttackVolley;
			const originalSaveDamage = combat._executeFeatureSaveDamage;
			let output: any = null;

			try {
				combat._pChooseVariablePointSpend = async () => config.spend;
				combat._executeFeatureAttackVolley = (_feature: any, details: any) => {
					output = {kind: "attackVolley", count: details.count};
					return originalVolley.call(combat, _feature, details);
				};
				combat._executeFeatureSaveDamage = (_feature: any, details: any) => {
					output = {kind: "saveDamage", ...details};
					return originalSaveDamage.call(combat, _feature, details);
				};
				state.startCombat?.();
				combat._resetTurnActionUsage?.();

				const needsQualification = !!(config.qualifyingAttackSourceFeature || config.qualifyingAttackName);
				let afterBlocked: number | null = null;
				if (needsQualification) {
					await combat._useCombatAction(feature);
					afterBlocked = state.getKiPointsCurrent?.() ?? 0;
				}

				if (config.qualifyingAttackSourceFeature) {
					const attack = state.getFeatureGrantedAttacks?.()
						.find((it: any) => it.sourceFeature === config.qualifyingAttackSourceFeature);
					if (!attack) throw new Error(`Missing granted attack from "${config.qualifyingAttackSourceFeature}"`);
					combat._rollAttack?.(attack.id);
				} else if (config.qualifyingAttackName) {
					const attack = combat.getAvailableWeaponAttacks?.()
						.find((it: any) => it.name?.toLowerCase() === config.qualifyingAttackName?.toLowerCase());
					if (!attack) throw new Error(`Missing rendered attack "${config.qualifyingAttackName}"`);
					combat._rollAttack?.(attack.id);
				}

				await combat._useCombatAction(feature);
				return {
					before,
					afterBlocked,
					after: state.getKiPointsCurrent?.() ?? 0,
					variableSpendConfig: variableSpendConfig
						? {
							min: variableSpendConfig.min,
							max: variableSpendConfig.max,
							resourceName: variableSpendConfig.resourceName,
						}
						: null,
					output,
				};
			} finally {
				combat._pChooseVariablePointSpend = originalChoose;
				combat._executeFeatureAttackVolley = originalVolley;
				combat._executeFeatureSaveDamage = originalSaveDamage;
				state.setKiPointsCurrent?.(originalPoints);
				state.endCombat?.();
				cs._renderCharacter?.();
			}
		}, opts);
	}

	async probeAttackQualification (attackName: string | RegExp, sourceFeature?: string): Promise<{
		clicked: boolean;
		threwError: boolean;
		hasAttackAction: boolean;
		hasSourceFeature: boolean;
	}> {
		await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			cs?._state?.startCombat?.();
			cs?._combat?._resetTurnActionUsage?.();
		});
		try {
			const roll = await this.clickAttackRoll(attackName);
			await this.dismissTransientModals();
			const qualification = await this.page.evaluate((source) => {
				const combat: any = (globalThis as any).charSheet?._combat;
				const usage = combat?._turnAttackUsage;
				return {
					hasAttackAction: !!usage?.hasAttackAction,
					hasSourceFeature: source
						? !!usage?.attackActionFeatureIds?.has(source.toLowerCase())
						: true,
				};
			}, sourceFeature || "");
			return {...roll, ...qualification};
		} finally {
			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				cs?._state?.endCombat?.();
				cs?._combat?._resetTurnActionUsage?.();
			});
		}
	}

	async probeActiveStateTrigger (feature: string, stateTypeId: string): Promise<{
		active: boolean;
		label: string;
		actionType: string;
		damageType: string;
		damage: number;
		damageFormula: string;
		dc: number;
		used: boolean;
		actionUsed: boolean;
		reactionUsed: boolean;
	}> {
		await this.activateFeature(feature);
		return this.page.evaluate(({stateId}) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const combat = cs?._combat;
			try {
				const trigger = state?.getActiveStateTrigger?.(stateId);
				state?.startCombat?.();
				combat?._resetTurnActionUsage?.();
				const used = combat?._useActiveStateTrigger?.(stateId) === true;
				// Read whichever action type the trigger actually declares, so
				// bonus-action / action triggers are covered as well as reactions.
				const actionType = trigger?.actionType || "";
				return {
					active: !!trigger,
					label: trigger?.label || "",
					actionType,
					damageType: trigger?.effect?.damageType || "",
					damage: trigger?.effect?.resolvedValue || 0,
					damageFormula: trigger?.effect?.resolvedDamage || "",
					dc: trigger?.effect?.resolvedDc ?? 0,
					used,
					actionUsed: !!combat?._turnActionUsage?.[actionType],
					reactionUsed: !!combat?._turnActionUsage?.reaction,
				};
			} finally {
				state?.deactivateState?.(stateId);
				state?.endCombat?.();
				combat?._resetTurnActionUsage?.();
				cs?._renderCharacter?.();
			}
		}, {stateId: stateTypeId});
	}

	async probeActiveStateLight (feature: string, stateTypeId: string): Promise<{
		bright: number;
		dim: number;
		rendered: boolean;
	}> {
		await this.activateFeature(feature);
		try {
			const effect = await this.page.evaluate((stateId) => {
				const state: any = (globalThis as any).charSheet?._state;
				return state?.getActiveStateEffects?.()
					.find((it: any) => it.stateTypeId === stateId && it.type === "light") || null;
			}, stateTypeId);
			await this.switchToTab(this.tabOverview);
			const activeRow = this.page.locator(".charsheet__state-row.charsheet__state--active")
				.filter({hasText: this._getFeatureActivationPattern(feature)})
				.first();
			const text = await activeRow.textContent().catch(() => "");
			return {
				bright: Number(effect?.brightRange || 0),
				dim: Number(effect?.dimRange || 0),
				rendered: /bright light|dim light/i.test(text || ""),
			};
		} finally {
			await this.page.evaluate((stateId) => {
				const cs: any = (globalThis as any).charSheet;
				cs?._state?.deactivateState?.(stateId);
				cs?._renderCharacter?.();
			}, stateTypeId);
		}
	}

	/**
	 * Read a saving throw modifier directly from state. Includes ability
	 * mod + proficiency (if proficient) + state bonuses (Aura of
	 * Protection, Magic Resistance, etc.) + item bonuses + condition
	 * penalties. The authoritative number a player would add to their d20.
	 */
	async getSaveBonus (ability: "str" | "dex" | "con" | "int" | "wis" | "cha"): Promise<number> {
		return this.page.evaluate((abl) => {
			const cs: any = (globalThis as any).charSheet;
			const fn = cs?._state?.getSaveMod || cs?._state?.getSaveModifier;
			if (!fn) return 0;
			try { return fn.call(cs._state, abl) | 0; } catch (_) { return 0; }
		}, ability);
	}

	/** Read an ability score AND its derived modifier in one call. */
	async getAbilityScore (ability: "str" | "dex" | "con" | "int" | "wis" | "cha"): Promise<{score: number; mod: number}> {
		return this.page.evaluate((abl) => {
			const cs: any = (globalThis as any).charSheet;
			const score = cs?._state?.getAbilityScore?.(abl) ?? 10;
			const mod = cs?._state?.getAbilityMod?.(abl) ?? 0;
			return {score: score | 0, mod: mod | 0};
		}, ability);
	}

	/** Read the initiative bonus from state (includes Alert, Jack of All Trades, etc.). */
	async getInitiativeBonusFromState (): Promise<number> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			try {
				const fn = cs?._state?.getInitiative || cs?._state?.getInitiativeBonus;
				return fn ? (fn.call(cs._state) | 0) : 0;
			} catch (_) { return 0; }
		});
	}

	/** Damage resistances as a deduplicated list of damage-type strings (case as rendered). */
	async getResistances (): Promise<string[]> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			try {
				const r = cs?._state?.getResistances?.();
				if (!r) return [];
				if (Array.isArray(r)) return r.map((s: any) => String(s));
				return Object.keys(r);
			} catch (_) { return []; }
		});
	}

	/** Damage immunities, same shape as getResistances. */
	async getImmunities (): Promise<string[]> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			try {
				const r = cs?._state?.getImmunities?.();
				if (!r) return [];
				if (Array.isArray(r)) return r.map((s: any) => String(s));
				return Object.keys(r);
			} catch (_) { return []; }
		});
	}

	/** Damage vulnerabilities, same shape as getResistances. */
	async getVulnerabilities (): Promise<string[]> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			try {
				const r = cs?._state?.getVulnerabilities?.();
				if (!r) return [];
				if (Array.isArray(r)) return r.map((s: any) => String(s));
				return Object.keys(r);
			} catch (_) { return []; }
		});
	}

	/**
	 * Speed in feet. Pass "walk" for the primary walking speed (default),
	 * or one of fly/swim/climb/burrow for alt-mode speeds.
	 * Returns 0 if the speed type isn't applicable to the character.
	 */
	async getSpeed (type: "walk" | "fly" | "swim" | "climb" | "burrow" = "walk"): Promise<number> {
		return this.page.evaluate((t) => {
			const cs: any = (globalThis as any).charSheet;
			try { return cs?._state?.getSpeed?.(t) | 0; } catch (_) { return 0; }
		}, type);
	}

	/**
	 * Query advantage state for any roll type. The `rollType` string
	 * follows the in-state convention:
	 *   "attack"            — any attack
	 *   "save:str"          — STR save
	 *   "check:dex"         — DEX ability check
	 *   "skill:stealth"     — Stealth skill
	 * Returns the full {advantage, disadvantage, cancelled, sources}
	 * object so callers can assert sources for diagnostic clarity.
	 */
	async getAdvantageState (rollType: string): Promise<{advantage: boolean; disadvantage: boolean; cancelled: boolean; sources: string[]}> {
		return this.page.evaluate((rt) => {
			const cs: any = (globalThis as any).charSheet;
			try {
				const s = cs?._state?.getAdvantageState?.(rt);
				if (!s) return {advantage: false, disadvantage: false, cancelled: false, sources: []};
				return {
					advantage: !!s.advantage,
					disadvantage: !!s.disadvantage,
					cancelled: !!s.cancelled,
					sources: Array.isArray(s.sources) ? s.sources.map((x: any) => String(x)) : [],
				};
			} catch (_) {
				return {advantage: false, disadvantage: false, cancelled: false, sources: []};
			}
		}, rollType);
	}

	/** Per-skill advantage state. Equivalent to getAdvantageState(`skill:<lowercaseskill>`). */
	async getSkillAdvantageState (skill: string): Promise<{advantage: boolean; disadvantage: boolean; cancelled: boolean; sources: string[]}> {
		return this.page.evaluate((s) => {
			const cs: any = (globalThis as any).charSheet;
			try {
				const r = cs?._state?.getSkillAdvantageState?.(s)
					|| cs?._state?.getAdvantageState?.(`skill:${String(s).toLowerCase()}`);
				if (!r) return {advantage: false, disadvantage: false, cancelled: false, sources: []};
				return {
					advantage: !!r.advantage,
					disadvantage: !!r.disadvantage,
					cancelled: !!r.cancelled,
					sources: Array.isArray(r.sources) ? r.sources.map((x: any) => String(x)) : [],
				};
			} catch (_) {
				return {advantage: false, disadvantage: false, cancelled: false, sources: []};
			}
		}, skill);
	}

	/**
	 * Group all known/prepared spells by spell level (0 = cantrip).
	 * Returns a map {0: [cantrips], 1: [...], ...}. Useful for "subclass
	 * granted these L3 spells" assertions.
	 */
	/**
	 * Cantrip names known to the character.
	 *
	 * The sheet keeps cantrips in a list of their own
	 * (`_data.spellcasting.cantripsKnown`), so `getKnownSpellNames()` — which
	 * reads `getKnownSpells()` — never sees them. Any subclass that grants a
	 * cantrip through `additionalSpells` (e.g. Circle of the Sea's Ray of
	 * Frost) is therefore invisible to a spell-list probe unless the two lists
	 * are unioned.
	 */
	async getCantripNames (): Promise<string[]> {
		return this.page.evaluate(() => {
			const state: any = (globalThis as any).charSheet?._state;
			if (typeof state?.getCantripsKnown !== "function") return [] as string[];
			try {
				return (state.getCantripsKnown() || []).map((spell: any) => spell?.name).filter(Boolean);
			} catch (_) { return [] as string[]; }
		});
	}

	async getKnownSpellsByLevel (): Promise<Record<number, string[]>> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			// See `getKnownSpellNames` — `getKnownSpells()` excludes cantrips, which made
			// the `cantripCount` probe structurally incapable of ever returning non-zero.
			const read = state?.getSpells ? () => state.getSpells() : state?.getKnownSpells ? () => state.getKnownSpells() : null;
			if (!read) return {};
			const out: Record<number, string[]> = {};
			try {
				const spells = read() || [];
				for (const sp of spells) {
					const lvl = sp.level ?? 0;
					if (!out[lvl]) out[lvl] = [];
					out[lvl].push(sp.name);
				}
			} catch (_) {}
			return out;
		});
	}

	/**
	 * Snapshot of every active-state instance currently on the character.
	 * Includes inactive instances too (so `instance.active === false` is
	 * possible) — callers should filter by `.active` if they only care
	 * about live toggles.
	 */
	async getActiveStateInstances (): Promise<Array<{id: string; stateTypeId: string; active: boolean; name?: string}>> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const list = cs?._state?.getActiveStates?.() ?? [];
			return list.map((s: any) => ({
				id: String(s.id),
				stateTypeId: String(s.stateTypeId),
				active: !!s.active,
				name: s.name ? String(s.name) : undefined,
			}));
		});
	}

	/**
	 * Activate a built-in active state by its `stateTypeId` (one of the
	 * keys in `CharacterSheetState.ACTIVE_STATE_TYPES` — e.g. "rage",
	 * "bladesong", "wildShape"). Bypasses the DOM toggle button so we
	 * can run effect-delta probes deterministically.
	 *
	 * Returns the new instance id (for later deactivation), or null if
	 * the state type isn't recognised.
	 */
	async activateStateById (stateTypeId: string): Promise<string | null> {
		const id = await this.page.evaluate((typeId) => {
			const cs: any = (globalThis as any).charSheet;
			try {
				const newId = cs?._state?.activateState?.(typeId);
				cs?._renderCharacter?.();
				return newId ? String(newId) : null;
			} catch (_) { return null; }
		}, stateTypeId);
		await this.page.waitForTimeout(100);
		return id;
	}

	/** Deactivate an active state by instance id (the value returned from activateStateById). */
	async deactivateStateById (stateInstanceId: string): Promise<void> {
		await this.page.evaluate((id) => {
			const cs: any = (globalThis as any).charSheet;
			try {
				const list = cs?._state?.getActiveStates?.() ?? [];
				const inst = list.find((s: any) => String(s.id) === id);
				if (inst?.active) cs?._state?.toggleActiveState?.(id);
				cs?._renderCharacter?.();
			} catch (_) {}
		}, stateInstanceId);
		await this.page.waitForTimeout(100);
	}

	/**
	 * Click an ability check or save roll button. Wraps the click in a
	 * try/catch inside `evaluate` so synchronous handler throws are
	 * captured rather than swallowed (the existing `rollSkill` helper
	 * uses a Playwright click that hides handler errors).
	 *
	 * Returns {clicked: bool, threwError: bool, errorMessage?: string}.
	 *  - clicked === false → no button found
	 *  - threwError === true → button exists but click handler threw
	 */
	async clickAbilityRoll (
		ability: "str" | "dex" | "con" | "int" | "wis" | "cha",
		kind: "check" | "save",
	): Promise<{clicked: boolean; threwError: boolean; errorMessage?: string}> {
		await this.switchToTab(this.tabAbilities);
		return this.page.evaluate(({abl, k}) => {
			const sel = k === "check"
				? `.charsheet__ability-roll-check[data-ability="${abl}"]`
				: `.charsheet__ability-roll-save[data-ability="${abl}"]`;
			const btn = document.querySelector(sel) as HTMLElement | null;
			if (!btn) return {clicked: false, threwError: false};
			try { btn.click(); return {clicked: true, threwError: false}; } catch (e: any) {
				return {clicked: true, threwError: true, errorMessage: String(e?.message ?? e)};
			}
		}, {abl: ability, k: kind});
	}

	/**
	 * Hard variant of rollSkill — clicks the skill row's roll button via
	 * page.evaluate so synchronous handler throws are captured.
	 */
	async clickSkillRollHard (skill: string): Promise<{clicked: boolean; threwError: boolean; errorMessage?: string}> {
		await this.switchToTab(this.tabOverview);
		return this.page.evaluate((s) => {
			const re = new RegExp(`\\b${s}\\b`, "i");
			const rows = document.querySelectorAll(".charsheet__skill-row, [data-skill]") as NodeListOf<HTMLElement>;
			for (const row of Array.from(rows)) {
				if (!re.test(row.textContent || "")) continue;
				// Skill rows are click-to-roll: the handler is bound to the ROW
				// (`charactersheet.js:3238`), and there is no inner roll button.
				// Falling back to the row is what makes this probe work at all —
				// searching only for a button reports "roll button not found" for
				// every skill on every character.
				const btn = row.querySelector(".charsheet__skill-roll, button") as HTMLElement | null;
				const target = btn ?? row;
				try { target.click(); return {clicked: true, threwError: false}; } catch (e: any) {
					return {clicked: true, threwError: true, errorMessage: String(e?.message ?? e)};
				}
			}
			return {clicked: false, threwError: false};
		}, skill);
	}

	/** Click an attack-row's roll button by attack name; throws-aware. */
	async clickAttackRoll (attackName: string | RegExp): Promise<{clicked: boolean; threwError: boolean; errorMessage?: string}> {
		await this.switchToTab(this.tabCombat);
		const reSrc = attackName instanceof RegExp
			? attackName.source
			: attackName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const reFlags = attackName instanceof RegExp ? attackName.flags : "i";
		return this.page.evaluate(({src, flags}) => {
			const re = new RegExp(src, flags);
			const rows = document.querySelectorAll(".charsheet__attack-item") as NodeListOf<HTMLElement>;
			for (const row of Array.from(rows)) {
				if (!re.test(row.textContent || "")) continue;
				const btn = row.querySelector(".charsheet__attack-roll, button") as HTMLElement | null;
				if (!btn) continue;
				try { btn.click(); return {clicked: true, threwError: false}; } catch (e: any) {
					return {clicked: true, threwError: true, errorMessage: String(e?.message ?? e)};
				}

			}
			return {clicked: false, threwError: false};
		}, {src: reSrc, flags: reFlags});
	}

	/**
	 * Exercise the production Spectral Chains attack → hit confirmation → rider
	 * path. When optional bookkeeping is on, this also resolves the compact
	 * name/outcome form. It never calls the target state API directly.
	 */
	async rollSpectralChainsTargetEffect (options: {
		effect?: "grapple" | "restrain" | "shove" | "control-shove";
		targetName?: string;
		grappleSaveFailed?: boolean;
		restraintSaveFailed?: boolean;
		cancel?: boolean;
		expectTargetModal?: boolean;
	} = {}): Promise<any> {
		const alreadyReady = await this.page.evaluate(() => {
			const state: any = (globalThis as any).charSheet?._state;
			return !!state?.isStateTypeActive?.("rage") && !!state?.isStateTypeActive?.("manifestChains");
		});
		if (!alreadyReady) await this.useResourceByName("Rage");
		await this.page.evaluate(() => {
			const state: any = (globalThis as any).charSheet?._state;
			state?.activateState?.("rage");
			state?.activateState?.("manifestChains");
			(globalThis as any).charSheet?._renderCharacter?.();
		});
		await this.restorePlayModeActionType("action");
		await this.page.waitForFunction(() => {
			const state: any = (globalThis as any).charSheet?._state;
			return !!state?.isStateTypeActive?.("rage")
				&& !!state?.isStateTypeActive?.("manifestChains")
				&& !!document.querySelector(".charsheet__attack-item");
		}, undefined, {timeout: 15000});
		const effect = options.effect || "restrain";
		// Attack rolls are random, but this lifecycle probe must always reach the
		// real on-hit target-effect UI rather than occasionally ending on a natural 1.
		// Use the sheet's runtime-only d20 seam so the production attack/modal path
		// remains intact.
		await this.page.evaluate(() => {
			(globalThis as any).charSheet?._state?.setD20RollSource?.({nextInt: () => 10});
		});
		try {
			const attack = await this.clickAttackRoll(/Spectral Chains/i);
			if (!attack.clicked || attack.threwError) throw new Error(`Spectral Chains attack did not click: ${attack.errorMessage || "not found"}`);
			await this.confirmPrompt("Hit");
			const enumModal = this.page.locator(".ve-ui-modal__inner:visible, .ui-modal__inner:visible").last();
			const select = enumModal.locator("select").first();
			await enumModal.waitFor({state: "visible", timeout: 10000});
			const riderPattern = {
				grapple: /grapple with/i,
				restrain: /chain imprisonment/i,
				shove: /shove with/i,
				"control-shove": /chain control/i,
			}[effect] || /grapple with/i;
			const pickerLabels = await select.locator("option").allTextContents();
			const riderValue = await select.locator("option").evaluateAll((options, pattern) => {
				const re = new RegExp(pattern, "i");
				return options.find((option: HTMLOptionElement) => re.test(option.textContent || ""))?.value || null;
			}, riderPattern.source);
			if (!riderValue) throw new Error(`No on-hit rider option matched ${riderPattern}`);
			await select.selectOption(riderValue);
			await enumModal.getByRole("button", {name: /ok|confirm|apply/i}).last().click();

			if (options.expectTargetModal === false) {
				await expect(enumModal).toBeHidden({timeout: 10000});
				await this.page.waitForTimeout(200);
				const targetFormVisible = await this.page.locator("[data-target-name]:visible").count() > 0;
				const reminderText = await this.page.locator(".toast__wrp-content").last().textContent().catch(() => "");
				return {tracked: false, targetFormVisible, reminderText: reminderText || "", pickerLabels};
			}

			const targetName = this.page.locator("[data-target-name]").last();
			await targetName.waitFor({state: "attached", timeout: 10000});
			const modal = targetName.locator("xpath=ancestor::*[contains(@class, 'ui-modal__inner') or contains(@class, 've-ui-modal__inner')][1]");
			await targetName.fill(options.targetName || "Playwright target");
			await modal.locator("[data-grapple-outcome]").selectOption(options.grappleSaveFailed === false ? "succeeded" : "failed");
			if (effect === "restrain" && options.grappleSaveFailed !== false) {
				await modal.locator("[data-restraint-outcome]").selectOption(options.restraintSaveFailed === false ? "succeeded" : "failed");
			}
			if (options.cancel) {
				await modal.locator("[data-act=cancel]").click();
				await this.page.waitForTimeout(150);
				return {
					cancelled: true,
					focusRestored: await this.page.evaluate(() => {
						const active = document.activeElement as HTMLElement | null;
						return !!active?.closest?.(".charsheet__attack-item")
							&& /spectral chains/i.test(active.closest(".charsheet__attack-item")?.textContent || "");
					}),
				};
			}
			await modal.locator("[data-act=apply]").click();
			await expect(modal).toBeHidden({timeout: 10000});
			await this.page.waitForTimeout(250);
			const targets = await this.getChainedTargets();
			return targets.find((it: any) => it.targetName === (options.targetName || "Playwright target")) || null;
		} finally {
			await this.page.evaluate(() => {
				(globalThis as any).charSheet?._state?.setD20RollSource?.(null);
			});
		}
	}

	/**
	 * Prove the reminder-first default and the complete optional bookkeeping
	 * flow through the same Combat and Play Mode controls a player uses.
	 */
	async probeOptionalChainedFuryTracking ({
		targetName = "Playwright ogre",
		effect = "restrain",
	}: {
		targetName?: string;
		effect?: "grapple" | "restrain";
	} = {}): Promise<any> {
		await this.switchToTab(this.tabCombat);
		const section = this.page.locator("#charsheet-combat-chained-targets-section");
		await section.waitFor({state: "visible", timeout: 10000});
		const toggle = section.getByLabel("Remember chained creatures");
		const defaultOff = !(await toggle.isChecked())
			&& await this.page.evaluate(() => (globalThis as any).charSheet?._state?.isChainedFuryTargetTrackingEnabled?.() === false);

		const calc = await this.page.evaluate(() => (globalThis as any).charSheet?._state?.getFeatureCalculations?.() ?? {});
		const reminder = await this.rollSpectralChainsTargetEffect({
			effect: "grapple",
			expectTargetModal: false,
		});
		const noTargetFormWhileOff = reminder.targetFormVisible === false && (await this.getChainedTargets()).length === 0;
		const reminderShowsLiveDc = reminder.reminderText.includes(`DC ${calc.chainGrappleDc}`);
		const noTrackTargetOnlyChoice = !reminder.pickerLabels.some((label: string) => /track target only/i.test(label));

		await this.switchToTab(this.tabCombat);
		await toggle.check();
		await expect(toggle).toBeChecked();
		const enabledThroughUi = await this.page.evaluate(() => (globalThis as any).charSheet?._state?.isChainedFuryTargetTrackingEnabled?.() === true);
		const combatToggleRetainsFocus = await toggle.evaluate(element => document.activeElement === element);

		const applied = await this.rollSpectralChainsTargetEffect({
			effect,
			targetName,
			grappleSaveFailed: true,
			restraintSaveFailed: true,
		});
		if (!applied?.id) throw new Error("Optional chain tracking did not record the resolved target");

		await this.switchToTab(this.tabCombat);
		const row = this.page.locator(`.charsheet__chained-target-row[data-target-id="${applied.id}"]`).first();
		await row.waitFor({state: "visible", timeout: 10000});
		const combatButtons = await row.getByRole("button").allTextContents();
		const compactCombatRow = await row.locator("input, select").count() === 0
			&& combatButtons.length === 1
			&& combatButtons[0].trim() === "Release"
			&& (await row.textContent() || "").includes("Grappled")
			&& (effect !== "restrain" || (await row.textContent() || "").includes("Restrained"));

		const roundTripResult = await this.page.evaluate((targetId) => {
			const cs: any = (globalThis as any).charSheet;
			const json = cs?._state?.toJson?.();
			cs?._state?.loadFromJson?.(json);
			cs?._renderCharacter?.();
			return {
				tracking: cs?._state?.isChainedFuryTargetTrackingEnabled?.() === true,
				target: cs?._state?.getChainedTargets?.().find((it: any) => it.id === targetId) || null,
			};
		}, applied.id);
		const roundTrip = roundTripResult.tracking && !!roundTripResult.target;

		await this.enterPlayMode();
		const playModeRow = this.page.locator(`.pm-chained-target[data-target-id="${applied.id}"]`).first();
		await playModeRow.waitFor({state: "visible", timeout: 10000});
		const playModeButtons = await playModeRow.getByRole("button").allTextContents();
		const playModeText = await playModeRow.textContent() || "";
		const playModeParity = await playModeRow.locator("input, select").count() === 0
			&& playModeButtons.length === 1
			&& playModeButtons[0].trim() === "Release"
			&& playModeText.includes("Grappled")
			&& (effect !== "restrain" || playModeText.includes("Start of its turn"));
		const releasedThroughUi = await this.releasePlayModeTarget(applied.id);
		const playModeToggle = this.page.locator(".pm-chain-tracker__toggle").getByLabel("Remember chained creatures");
		await playModeToggle.uncheck();
		const playModeToggleRetainsFocusOff = await playModeToggle.evaluate(element => document.activeElement === element);
		await playModeToggle.check();
		const playModeToggleRetainsFocusOn = await playModeToggle.evaluate(element => document.activeElement === element);
		await this.exitPlayMode();

		const teardownTarget = await this.rollSpectralChainsTargetEffect({
			effect: "grapple",
			targetName: "Rage teardown target",
			grappleSaveFailed: true,
		});
		await this.deactivateFeature("Rage");
		const rawTeardownTargetCount = await this.page.evaluate(() => (
			(globalThis as any).charSheet?._state?._data?.targetEffects || []
		).filter((it: any) => String(it?.source || "").toLowerCase() === "chained-fury").length);
		const afterTeardown = await this.getChainedTargets();
		const trackingPreferenceSurvived = await this.page.evaluate(() => (globalThis as any).charSheet?._state?.isChainedFuryTargetTrackingEnabled?.() === true);

		return {
			defaultOff,
			reminderShowsLiveDc,
			noTargetFormWhileOff,
			noTrackTargetOnlyChoice,
			enabledThroughUi,
			combatToggleRetainsFocus,
			compactCombatRow,
			roundTrip,
			playModeParity,
			playModeToggleRetainsFocus: playModeToggleRetainsFocusOff && playModeToggleRetainsFocusOn,
			recurringDamage: effect === "restrain" ? applied.recurringDamage?.amount ?? null : null,
			releasedThroughUi,
			rageTeardown: !!teardownTarget?.id
				&& rawTeardownTargetCount === 0
				&& afterTeardown.length === 0
				&& trackingPreferenceSurvived,
		};
	}

	/** Click the initiative roll button on the Combat tab; throws-aware. */
	async clickInitiativeRoll (): Promise<{clicked: boolean; threwError: boolean; errorMessage?: string}> {
		await this.switchToTab(this.tabCombat);
		return this.page.evaluate(() => {
			const btn = (document.getElementById("charsheet-roll-initiative")
				|| document.getElementById("charsheet-box-initiative")) as HTMLElement | null;
			if (!btn) return {clicked: false, threwError: false};
			try { btn.click(); return {clicked: true, threwError: false}; } catch (e: any) {
				return {clicked: true, threwError: true, errorMessage: String(e?.message ?? e)};
			}
		});
	}

	/**
	 * One-call snapshot of every "effective" derived stat. Use to diff
	 * before/after a toggle activation so probes can assert deltas
	 * without making 30 round-trips.
	 */
	async snapshotEffectiveStats (): Promise<EffectiveStatsSnapshot> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st = cs?._state;
			if (!st) return {ac: 0, spellSaveDc: 0, walkSpeed: 0, init: 0, abilityScores: {}, abilityMods: {}, saveMods: {}, skillBonuses: {}, resistances: [], immunities: []};
			const abls = ["str", "dex", "con", "int", "wis", "cha"] as const;
			const skills = ["acrobatics", "animal handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight of hand", "stealth", "survival"] as const;
			const out: any = {
				ac: st.getAC?.() ?? 0,
				spellSaveDc: st.getSpellSaveDC?.() ?? 0,
				walkSpeed: st.getSpeed?.("walk") ?? 0,
				init: (st.getInitiative ? st.getInitiative() : (st.getInitiativeBonus?.() ?? 0)),
				abilityScores: {},
				abilityMods: {},
				saveMods: {},
				skillBonuses: {},
				resistances: [],
				immunities: [],
			};
			for (const a of abls) {
				try { out.abilityScores[a] = st.getAbilityScore?.(a) ?? 10; } catch (_) { out.abilityScores[a] = 10; }
				try { out.abilityMods[a] = st.getAbilityMod?.(a) ?? 0; } catch (_) { out.abilityMods[a] = 0; }
				try { out.saveMods[a] = (st.getSaveMod || st.getSaveModifier)?.call(st, a) ?? 0; } catch (_) { out.saveMods[a] = 0; }
			}
			for (const s of skills) {
				try { out.skillBonuses[s] = st.getSkillBonus?.(s) ?? 0; } catch (_) { out.skillBonuses[s] = 0; }
			}
			try {
				const r = st.getResistances?.();
				out.resistances = Array.isArray(r) ? r.map((x: any) => String(x)) : (r ? Object.keys(r) : []);
			} catch (_) {}
			try {
				const i = st.getImmunities?.();
				out.immunities = Array.isArray(i) ? i.map((x: any) => String(x)) : (i ? Object.keys(i) : []);
			} catch (_) {}
			return out;
		});
	}

	// ========== PHASE 8: per-pick + scaling stat helpers ==========

	/**
	 * Read an attack-bonus and parse it as an integer.  Wraps
	 * `getAttackBonus()` (which returns a string like "+5") and
	 * tolerates leading "+", trailing whitespace, surrounding text.
	 * Returns null if the attack row isn't present or the bonus
	 * can't be parsed.
	 */
	async getAttackBonusNumber (attackName: string | RegExp): Promise<number | null> {
		const re = attackName instanceof RegExp ? attackName : new RegExp(attackName, "i");
		const names = await this.getAttackNames();
		const found = names.find(n => re.test(n));
		if (!found) return null;
		const raw = await this.getAttackBonus(found);
		if (raw == null) return null;
		const m = raw.match(/[+-]?\d+/);
		return m ? parseInt(m[0], 10) : null;
	}

	/**
	 * Read the full damage string from a named attack row.  Returns
	 * the textContent of the damage cell (e.g. "1d8+3 piercing"),
	 * or null when the attack isn't on the sheet.  Used by the
	 * `attackDamageContains` effect to substring-match damage
	 * riders (sneak attack dice, hexblade's curse extra damage,
	 * elemental rune adders, etc).
	 */
	async getAttackDamageString (attackName: string | RegExp): Promise<string | null> {
		await this.switchToTab(this.tabCombat);
		const re = attackName instanceof RegExp ? attackName : new RegExp(attackName, "i");
		const item = this.page.locator(".charsheet__attack-item")
			.filter({hasText: re})
			.first();
		if (await item.count() === 0) return null;
		// NB: `.charsheet__attack-damage` is the "Roll Damage" BUTTON, whose label is
		// the constant string "Damage" for every attack ever rendered. Reading it made
		// this method return "Damage" unconditionally, so every caller comparing damage
		// before/after a toggle compared two identical constants and could never
		// observe a change. (`.charsheet__attack-roll-damage` does not exist anywhere
		// in the app.) The damage the player actually reads is the badge inside
		// `.charsheet__attack-details`, plus any rider notes for riders that are not
		// folded into the badge (e.g. an active Crimson Rite bound to this weapon).
		const details = item.locator(".charsheet__attack-details").first();
		if (await details.count() === 0) {
			return (await item.textContent({timeout: 1000}).catch(() => "")) || null;
		}
		const t = await details.textContent({timeout: 1000}).catch(() => null);
		const riderEl = item.locator(".charsheet__attack-rider-note").first();
		const rider = await riderEl.count() ? await riderEl.textContent({timeout: 1000}).catch(() => null) : null;
		const joined = [t, rider].filter(Boolean).join(" | ").replace(/\s+/g, " ").trim();
		return joined || null;
	}

	/**
	 * Read the rogue's sneak-attack dice COUNT from
	 * `getFeatureCalculations().sneakAttack.dice`, which the state
	 * stores as a dice STRING like `"6d6"` — so parse off the leading
	 * count.  Returns 0 when the calc isn't surfaced (non-rogue, build
	 * hasn't loaded).
	 *
	 * NOTE: there is no flat `calc.sneakAttackDice` key.  Reading one
	 * yields `undefined` → 0, which silently passes a `min: 0` probe
	 * and fails every real one (CS-BUG-018 skips, 19 of them).
	 */
	async getSneakAttackDiceCount (): Promise<number> {
		return await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			if (!st) return 0;
			try {
				const calc = st.getFeatureCalculations?.() || {};
				const raw = calc.sneakAttack?.dice;
				if (raw == null) return 0;
				// "6d6" → 6; a bare number stays itself.
				const m = /^\s*(\d+)\s*d/i.exec(String(raw));
				return m ? Number(m[1]) : (Number(raw) || 0);
			} catch (_) { return 0; }
		});
	}

	/**
	 * Read the monk's martial-arts die FACE (4/6/8/10/12).  The
	 * state stores this as a string like "1d8" → returns 8.
	 * Returns 0 when the calc isn't surfaced.
	 */
	async getMartialArtsDieSize (): Promise<number> {
		return await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			if (!st) return 0;
			try {
				const calc = st.getFeatureCalculations?.() || {};
				const d = String(calc.martialArtsDie ?? "");
				const m = d.match(/d(\d+)/i);
				return m ? parseInt(m[1], 10) : 0;
			} catch (_) { return 0; }
		});
	}

	/**
	 * Read the bard's bardic-inspiration die FACE (6/8/10/12) from
	 * `getFeatureCalculations().bardicInspirationDie`.  Returns 0
	 * when not surfaced.
	 */
	async getBardicInspirationDieSize (): Promise<number> {
		return await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			if (!st) return 0;
			try {
				const calc = st.getFeatureCalculations?.() || {};
				const d = String(calc.bardicInspirationDie ?? "");
				const m = d.match(/d(\d+)/i);
				return m ? parseInt(m[1], 10) : 0;
			} catch (_) { return 0; }
		});
	}

	/**
	 * Read the current weapon-attack critical-hit range from
	 * `getFeatureCalculations().criticalRange` (19 for Improved Critical,
	 * 18 for Superior Critical). Returns 20 (the RAW default — no
	 * expanded crit range) when the calc field isn't surfaced, so a
	 * character without an expanding-crit feature reads as "no expansion"
	 * rather than a false positive.
	 */
	async getCriticalRange (): Promise<number> {
		return await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			if (!st) return 20;
			try {
				const calc = st.getFeatureCalculations?.() || {};
				return Number(calc.criticalRange ?? 20) || 20;
			} catch (_) { return 20; }
		});
	}

	/**
	 * Read the total numeric bonus for a named modifier type straight from
	 * `state.getModifierBonus(modType)` — the same generic aggregator that
	 * backs every roll/attack/AC bonus on the sheet. Reusable for any
	 * feat/style registered as a `{type: "modifier", modType: "..."}` bonus
	 * (e.g. Archery Fighting Style's unconditional `attack:ranged` +2)
	 * without requiring an actual equipped weapon for the probe to run.
	 */
	async getModifierBonus (modType: string): Promise<number> {
		return await this.page.evaluate((type) => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			if (!st) return 0;
			try { return Number(st.getModifierBonus?.(type)) || 0; } catch (_) { return 0; }
		}, modType);
	}

	/** Whether the character currently has Heroic Inspiration. */
	async hasInspiration (): Promise<boolean> {
		return await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			try { return !!st?.hasInspiration?.(); } catch (_) { return false; }
		});
	}

	/** Explicitly clear Heroic Inspiration (for deterministic turn-start probes). */
	async setInspiration (value: boolean): Promise<void> {
		await this.page.evaluate((v) => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			st?.setInspiration?.(v);
		}, value);
	}

	/**
	 * Drive the generic "start of turn in combat" effect resolver
	 * (`applyTurnStartEffects()` — Heroic Warrior's Inspiration grant,
	 * Survivor's Heroic Rally healing, hybrid regeneration, etc.) directly
	 * against state, then re-render. Returns the declarative effects list
	 * that was applied, e.g. `[{type: "heal", amount: 7, source: "Heroic Rally"}]`.
	 */
	async applyTurnStartEffects (): Promise<Array<{type: string; amount?: number; source: string}>> {
		return await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			if (!st) return [];
			try {
				const effects = st.applyTurnStartEffects?.() || [];
				cs?._renderCharacter?.();
				return effects;
			} catch (_) { return []; }
		});
	}

	/**
	 * Names of the weapons this character has taken Weapon Mastery in (XPHB).
	 *
	 * These are real picks that deliberately do NOT live in the feature list —
	 * only the generic "Weapon Mastery" card renders there — so
	 * `getActivatableFeatureNames()` can never confirm WHICH weapons were
	 * chosen. Callers verifying a specific pick (`assertFeaturesMatrix`'s
	 * `kind: "pick"`, via `buildWeaponMasteryChecks`) must search this list.
	 *
	 * Prefers the RENDERED Combat-tab badges (`_renderWeaponMasteries`,
	 * `charactersheet.js:4096`) so a mastery that was chosen but never
	 * displayed still fails the check. Falls back to state
	 * (`getWeaponMasteries()`, which returns "Club|XPHB" entries) only when the
	 * mastery container itself never rendered — i.e. the tab wasn't ready —
	 * which would otherwise be an infra false failure rather than a real gap.
	 */
	async getWeaponMasteryNames (): Promise<string[]> {
		await this.switchToTab(this.tabCombat).catch(() => {});

		const container = this.page.locator("#charsheet-combat-masteries");
		if (await container.count().catch(() => 0) > 0) {
			const nameEls = container.locator(".charsheet__mastery-badge strong");
			const count = await nameEls.count().catch(() => 0);
			const names: string[] = [];
			for (let i = 0; i < count; i++) {
				const text = await nameEls.nth(i).textContent({timeout: 1000}).catch(() => null);
				if (text && text.trim()) names.push(text.trim());
			}
			return names;
		}

		return await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			try {
				return (st?.getWeaponMasteries?.() || []).map((m: string) => String(m).split("|")[0]);
			} catch (_) { return []; }
		});
	}


	/**
	 * List the warlock's known eldritch invocation names by
	 * filtering the activatable feature list for the EI prefix
	 * convention used by the renderer ("Invocation: …" rows).
	 * Falls back to a heuristic when the prefix isn't present.
	 */
	async getInvocationsKnown (): Promise<string[]> {
		const all = await this.getActivatableFeatureNames().catch(() => [] as string[]);
		// Most TGTT/PHB invocations surface as "Invocation: <Name>" or
		// just bare names; heuristic match by either pattern.
		const named = all.filter(n => /^invocation:|^eldritch invocation\b/i.test(n));
		if (named.length) return named.map(n => n.replace(/^invocation:\s*/i, "").trim());
		// Fallback: read the state's _data.featureChoices.invocations
		// list directly.
		return await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const st: any = cs?._state;
			if (!st?._data?.featureChoices) return [];
			const fc: any = st._data.featureChoices;
			const inv: any = fc.invocations || fc.eldritchInvocations || fc.invocation;
			if (!inv) return [];
			if (Array.isArray(inv)) return inv.map((x: any) => String(x?.name ?? x));
			if (typeof inv === "object") return Object.keys(inv);
			return [];
		});
	}

	// ──────────────────────────────────────────────────────────────
	//  Add Item picker — Type/Rarity/Source filter dropdowns
	//
	// The picker is a generic `UiUtil.pGetShowModal` instance whose scroller shares markup
	// (`.charsheet__modal-list`) and CSS with the Spell/Feat pickers' own filter dropdowns.
	// Only the Item picker's Type/Rarity/Source and the Spell picker's Class/Subclass filters
	// are positioned by `FilterPickerHelpers.placeAnchoredPopover` (`position:fixed` + computed
	// viewport coordinates) — the Feat picker's Category/Source filters use a separate,
	// CSS-only `position:absolute` mechanism local to `_pShowFeatPickerModal` in
	// charactersheet-features.js, so they are not equivalent despite sharing markup/CSS.
	// ──────────────────────────────────────────────────────────────

	/** Open the Inventory tab's "Add Item" picker modal and wait for it to render. */
	async openAddItemModal (): Promise<void> {
		await this.switchToTab(this.tabInventory);
		await this.page.locator("#charsheet-btn-add-item").click();
		await this.itemPickerModal().waitFor({state: "visible"});
	}

	/** The topmost visible modal — valid while the Add Item picker is open. */
	itemPickerModal (): Locator {
		return this.page.locator(".ve-ui-modal__inner:visible").last();
	}

	/** The Add Item picker's own scrolling ancestor (`.ve-ui-modal__scroller`). */
	itemPickerScroller (): Locator {
		return this.page.locator(".ve-ui-modal__scroller:has(.charsheet__modal-list)").last();
	}

	/** Expand the picker's collapsible "Filters" section (Type/Rarity/Source dropdowns). */
	async openItemPickerFilters (): Promise<void> {
		const collapsible = this.itemPickerModal().locator(".charsheet__filter-collapsible");
		const isOpen = await collapsible.evaluate(el => el.classList.contains("charsheet__filter-collapsible--open")).catch(() => false);
		if (isOpen) return;
		await this.itemPickerModal().locator(".charsheet__filter-toggle").click();
		// `.charsheet__filter-collapsible--open` drives a `max-height`/`opacity` expand transition
		// (0.25s/0.2s). Callers that immediately check the modal scroller's `scrollHeight` (e.g. to
		// scroll it) need the section fully expanded first, not just the toggle class flipped.
		await expect(async () => {
			const opacity = await collapsible.evaluate(el => Number(getComputedStyle(el).opacity));
			expect(opacity).toBeGreaterThanOrEqual(0.99);
		}).toPass({timeout: 3000, intervals: [30, 60, 100, 200]});
	}

	/**
	 * Locate one of the Item picker's `.charsheet__source-multiselect` filter widgets by its
	 * static icon glyph (stable regardless of selection state, unlike the button's text, which
	 * changes to e.g. "2 selected" once the user deselects an option). `root` defaults to the
	 * Item picker's own modal; it is only meaningful for another modal that reuses these exact
	 * Type/Rarity/Source icons, not a general cross-picker lookup (the Spell picker's Class
	 * filter uses a different icon and is queried directly in its own spec instead).
	 */
	itemPickerFilterDropdown (kind: "type" | "rarity" | "source", root: Locator = this.itemPickerModal()): {container: Locator; button: Locator; menu: Locator} {
		const icon = kind === "type" ? "📦" : kind === "rarity" ? "🌟" : "📚";
		const container = root.locator(".charsheet__source-multiselect")
			.filter({has: this.page.locator(".charsheet__source-multiselect-icon", {hasText: icon})});
		return {
			container,
			button: container.locator(".charsheet__source-multiselect-btn"),
			menu: container.locator(".charsheet__source-multiselect-dropdown"),
		};
	}

	/** Read/set the Add Item picker's own scroller scroll position, in page-object terms. */
	async getItemPickerScrollMetrics (): Promise<{scrollTop: number; scrollHeight: number; clientHeight: number}> {
		return this.itemPickerScroller().evaluate(el => ({scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight}));
	}

	/** Scroll the Add Item picker's scroller to the bottom and return the resulting scrollTop. */
	async scrollItemPickerToBottom (): Promise<number> {
		return this.itemPickerScroller().evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
	}

	/**
	 * Click a locator by dispatching a raw `click` event, bypassing Playwright's actionability
	 * auto-scroll-into-view. Needed when a test has deliberately scrolled a container and a normal
	 * `.click()` would silently re-scroll the target into view first, undoing that scroll.
	 */
	async clickWithoutAutoScroll (locator: Locator): Promise<void> {
		await locator.evaluate(el => el.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true})));
	}

	/** Toggle the site's night-mode theme classes on `<html>`, for day/night parity checks. */
	async enableNightMode (): Promise<void> {
		await this.page.evaluate(() => document.documentElement.classList.add("ve-night-mode", "ve-night-mode--standard"));
	}

	/**
	 * Wait for a filter dropdown's open/close transition (opacity fade + height slide, driven by
	 * `--cs-transition-normal`) to fully settle before a caller measures its box. A fixed sleep is
	 * unreliable here: CSS transitions are wall-clock-timed in principle, but on a contended/shared
	 * machine this environment has been observed to visibly stretch a nominal 250ms transition well
	 * past 1s (main-thread/compositor starvation, not a product bug). Polling actual computed
	 * opacity is robust to both a fast, quiet machine and a slow, loaded one.
	 */
	async waitForFilterMenuSettled (menu: Locator, timeoutMs = 5000): Promise<void> {
		await expect(async () => {
			const opacity = await menu.evaluate(el => Number(getComputedStyle(el).opacity));
			expect(opacity).toBeGreaterThanOrEqual(0.99);
		}).toPass({timeout: timeoutMs, intervals: [30, 60, 100, 200]});
	}

	/**
	 * Reads an open filter menu's computed `transition-property` list. Root cause #2 was
	 * `transition: all` on `.charsheet__source-multiselect-dropdown`, which swept up discrete
	 * (non-interpolable) properties like `position`/`top`/`left` and held the menu at its old
	 * position for ~200ms after every open. Every geometry assertion elsewhere in this suite calls
	 * `waitForFilterMenuSettled` first, so none of them would notice a regression back to
	 * `transition: all` (the menu still snaps to the right place once the transition ends) — this
	 * exists to guard the property list itself, independent of timing.
	 */
	async getFilterMenuTransitionProperties (menu: Locator): Promise<string[]> {
		const raw = await menu.evaluate(el => getComputedStyle(el).transitionProperty);
		return raw.split(",").map(s => s.trim()).filter(Boolean);
	}

	/** Open the Features tab's "Add Feat" picker modal and wait for it to render. */
	async openAddFeatModal (): Promise<void> {
		await this.switchToTab(this.tabFeatures);
		await this.page.locator("#charsheet-add-feat").click();
		await this.page.locator(".ve-ui-modal__inner:visible").last().waitFor({state: "visible"});
	}

	/**
	 * Locate the Feat picker's Category filter (its only always-present filter dropdown). Unlike
	 * the Item/Spell pickers, this positions via a local CSS-only `position:absolute` mechanism
	 * (`_pShowFeatPickerModal`'s `positionDropdown` in charactersheet-features.js), not
	 * `FilterPickerHelpers.placeAnchoredPopover` — so it was never subject to the containing-block
	 * bug itself, but its modal shares the touched `.ve-ui-modal__scroller:has(.charsheet__modal-list)`
	 * CSS rule, so it still needs a sanity check after that rule changes.
	 */
	featPickerCategoryDropdown (): {button: Locator; menu: Locator} {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		const container = modal.locator(".charsheet__category-multiselect");
		return {
			button: container.locator(".charsheet__source-multiselect-btn"),
			menu: container.locator(".charsheet__source-multiselect-dropdown"),
		};
	}

	/** Open the Spells tab's "Add Spell" picker modal and wait for it to render. */
	async openAddSpellModal (): Promise<void> {
		await this.switchToTab(this.tabSpells);
		await this.page.locator("#charsheet-btn-add-spell").click();
		await this.page.locator(".ve-ui-modal__inner:visible").last().waitFor({state: "visible"});
	}

	/** Read the Add Spell modal's logical and currently-mounted result state. */
	async getAddSpellPickerSnapshot (spellName?: string, spellSource = "PHB"): Promise<{
		countText: string;
		logicalCount: number;
		mountedRows: number;
		scrollTop: number;
		scrollHeight: number;
		clientHeight: number;
		isSpellMounted: boolean;
		isSpellKnown: boolean;
		searchValue: string;
	}> {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		return modal.evaluate((root, target) => {
			const countText = root.querySelector(".charsheet__modal-results-count")?.textContent?.trim() || "";
			const logicalCount = Number(countText.match(/(\d+)\s+spells?\s+found/i)?.[1] || 0);
			const list = root.querySelector<HTMLElement>(".charsheet__modal-list");
			const rows = [...(list?.querySelectorAll<HTMLElement>(".charsheet__modal-list-item") || [])];
			const targetRow = target.name
				? rows.find(row => row.dataset.spellName === target.name && row.dataset.spellSource === target.source)
				: null;
			return {
				countText,
				logicalCount,
				mountedRows: rows.length,
				scrollTop: list?.scrollTop || 0,
				scrollHeight: list?.scrollHeight || 0,
				clientHeight: list?.clientHeight || 0,
				isSpellMounted: !!targetRow,
				isSpellKnown: !!targetRow?.querySelector(".charsheet__modal-list-item-badge--known"),
				searchValue: (root.querySelector<HTMLInputElement>(".charsheet__modal-search input")?.value || ""),
			};
		}, {name: spellName, source: spellSource});
	}

	/** Traverse real list viewports until the requested spell is mounted. */
	async scrollAddSpellPickerUntilMounted (spellName: string, spellSource = "PHB"): Promise<void> {
		const list = this.page.locator(".ve-ui-modal__inner:visible").last().locator(".charsheet__modal-list");
		for (let i = 0; i < 500; ++i) {
			if ((await this.getAddSpellPickerSnapshot(spellName, spellSource)).isSpellMounted) return;
			const moved = await list.evaluate(el => {
				const before = el.scrollTop;
				const step = Math.min(200, Math.max(128, el.clientHeight * 0.75));
				el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, before + step);
				return el.scrollTop > before;
			});
			if (!moved) break;
			await list.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		}
		const final = await this.getAddSpellPickerSnapshot(spellName, spellSource);
		expect(final.isSpellMounted, `${spellName}|${spellSource} never mounted while traversing the spell list: ${JSON.stringify(final)}`).toBe(true);
	}

	/** Scroll to the logical final item and report its virtual-list position. */
	async scrollAddSpellPickerToEnd (): Promise<{name: string; position: number; setSize: number}> {
		const list = this.page.locator(".ve-ui-modal__inner:visible").last().locator(".charsheet__modal-list");
		for (let i = 0; i < 10; ++i) {
			await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
			await list.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
			const isAtEnd = await list.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1);
			if (isAtEnd) break;
		}
		return list.evaluate(el => {
			const items = [...el.querySelectorAll<HTMLElement>("[role=listitem]")];
			const last = items.at(-1);
			return {
				name: last?.dataset.spellName || "",
				position: Number(last?.getAttribute("aria-posinset") || 0),
				setSize: Number(last?.getAttribute("aria-setsize") || 0),
			};
		});
	}

	/** Search the Add Spell modal and wait for its result toolbar to settle. */
	async searchAddSpellPicker (value: string): Promise<void> {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		await modal.locator(".charsheet__modal-search input").fill(value);
		await expect.poll(async () => (await this.getAddSpellPickerSnapshot()).searchValue).toBe(value);
		await this.page.waitForTimeout(200);
	}

	/** Add a currently-mounted spell by its visible name. */
	async addMountedSpell (spellName: string, spellSource = "PHB"): Promise<void> {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		const row = modal.locator(`.charsheet__modal-list-item[data-spell-name="${spellName}"][data-spell-source="${spellSource}"]`);
		await expect(row).toBeVisible();
		await row.locator(".spell-picker-add").click();
		await expect(row.locator(".charsheet__modal-list-item-badge--known")).toBeVisible();
	}

	/** Open the Add Spell modal's secondary filter panel. */
	async openAddSpellMoreFilters (): Promise<void> {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		const toggle = modal.locator(".charsheet__spell-more-filters-toggle");
		if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
	}

	/**
	 * Verify native Tab advances from one spell row into the next row, including
	 * when the virtual renderer must keep/remount the focused boundary.
	 */
	async tabFromLastMountedAddableSpell (): Promise<{from: string; to: string; stayedInList: boolean}> {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		const buttons = modal.locator(".charsheet__modal-list-item .spell-picker-add");
		await expect(buttons.nth(1)).toBeVisible();
		const row = buttons.last().locator("xpath=ancestor::div[contains(@class,'charsheet__modal-list-item')]");
		const from = `${await row.getAttribute("data-spell-name")}|${await row.getAttribute("data-spell-source")}`;
		await buttons.last().focus();
		await this.page.keyboard.press("Tab");
		const {to, stayedInList} = await this.page.evaluate(() => {
			const active = document.activeElement;
			const activeRow = active?.closest<HTMLElement>(".charsheet__modal-list-item");
			return {
				to: activeRow ? `${activeRow.dataset.spellName}|${activeRow.dataset.spellSource}` : "",
				stayedInList: !!active?.closest(".charsheet__modal-list"),
			};
		});
		return {from, to, stayedInList};
	}

	/** Close the currently-visible Add Spell modal. */
	async closeAddSpellModal (): Promise<void> {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		await modal.locator(".charsheet__modal-footer button").click();
		await expect(modal).toBeHidden();
	}

	/**
	 * Locate the Spell picker's always-visible Class filter (identified by its sword icon).
	 * Positions via the same `FilterPickerHelpers.placeAnchoredPopover` (`position:fixed` +
	 * computed viewport coordinates) as the Item picker's Type/Rarity/Source filters, so it is
	 * subject to the same containing-block fix.
	 */
	spellPickerClassDropdown (): {button: Locator; menu: Locator} {
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		const classDd = modal.locator(".charsheet__source-multiselect")
			.filter({has: this.page.locator(".charsheet__source-multiselect-icon", {hasText: "⚔️"})});
		return {
			button: classDd.locator(".charsheet__source-multiselect-btn"),
			menu: classDd.locator(".charsheet__source-multiselect-dropdown"),
		};
	}

	private _featureCard (featureName: string): Locator {
		return this.page.locator(".charsheet__feature")
			.filter({has: this.page.locator(".charsheet__feature-name", {hasText: new RegExp(`^${featureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")})})
			.first();
	}

	private async _clickActivatableFeature (featureName: string): Promise<void> {
		const result = await this.page.evaluate((name) => {
			const cs = (globalThis as any).charSheet;
			const feature = cs._state.getFeatures().find((it: any) => it.name === name);
			const activatable = cs._state.getActivatableFeatures().find((it: any) => it.feature?.id === feature?.id);
			if (!feature || !activatable) {
				return {
					started: false,
					hasFeature: !!feature,
					detected: !!(globalThis as any).CharacterSheetState.detectActivatableFeature(feature),
				};
			}
			const stateType = activatable.activationInfo?.stateType
				|| (globalThis as any).CharacterSheetState.ACTIVE_STATE_TYPES[activatable.stateTypeId];
			const resourceCost = activatable.resource?.cost
				?? activatable.activationInfo?.resourceCost
				?? stateType?.resourceCost
				?? 1;
			void cs._activateFeatureState(
				activatable.feature,
				activatable.stateTypeId,
				stateType,
				activatable.resource,
				resourceCost,
				activatable.activationInfo,
			);
			return {started: true, hasFeature: true, detected: true};
		}, featureName);
		expect(result.started, `${featureName} interaction should be activatable: ${JSON.stringify(result)}`).toBe(true);
	}

	private _visibleModal (title: RegExp): Locator {
		return this.page.locator(".ve-ui-modal__inner:visible").filter({hasText: title}).last();
	}

	async probeAlwaysPreparedSpell ({
		spellName,
		expectedLevel,
		sourceFeature,
		sourceClass,
	}: {
		spellName: string;
		expectedLevel: number;
		sourceFeature: string;
		sourceClass: string;
	}): Promise<void> {
		const result = await this.page.evaluate(({spellName}) => {
			const cs = (globalThis as any).charSheet;
			const spell = cs._state.getSpells().find((it: any) => it.name?.toLowerCase() === spellName.toLowerCase());
			if (!spell) return null;
			const unprepareResult = cs._state.setSpellPrepared(spell.id, false);
			const after = cs._state.getSpells().find((it: any) => it.id === spell.id);
			return {
				level: spell.level,
				sourceFeature: spell.sourceFeature,
				sourceClass: spell.sourceClass,
				alwaysPrepared: spell.alwaysPrepared,
				prepared: after?.prepared,
				unprepareResult,
			};
		}, {spellName});
		expect(result, `${spellName} should be stored on the character`).not.toBeNull();
		expect(result).toMatchObject({
			level: expectedLevel,
			sourceFeature,
			sourceClass,
			alwaysPrepared: true,
			prepared: true,
			unprepareResult: false,
		});

		await this.switchToTab(this.tabSpells);
		const row = this.page.locator(".charsheet__spell-item")
			.filter({has: this.page.locator(".charsheet__spell-item-name", {hasText: new RegExp(`^${spellName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")})})
			.first();
		await expect(row, `${spellName} should render in the spell list`).toBeVisible();
		await expect(row.locator(".charsheet__spell-always-prepared")).toContainText("Always");
		await expect(row.locator(".charsheet__spell-prepared")).toHaveCount(0);
	}

	async probeToolProficiencies ({
		includes,
		feature,
		excludedFeatureSources = [],
		conditionalGrantKey,
	}: {
		includes: string[];
		feature?: {
			name: string;
			source: string;
			className: string;
			classSource: string;
			subclassName?: string;
			subclassSource?: string;
			level: number;
		};
		excludedFeatureSources?: string[];
		conditionalGrantKey?: string;
	}): Promise<void> {
		const result = await this.page.evaluate((cfg) => {
			const state: any = (globalThis as any).charSheet?._state;
			const exactFeature = cfg.feature
				? state?.getFeatures?.().find((it: any) =>
					it?.name === cfg.feature.name
					&& it?.source === cfg.feature.source
					&& it?.className === cfg.feature.className
					&& it?.classSource === cfg.feature.classSource
					&& (!cfg.feature.subclassName || it?.subclassShortName === cfg.feature.subclassName)
					&& (!cfg.feature.subclassSource || it?.subclassSource === cfg.feature.subclassSource)
					&& Number(it?.level) === cfg.feature.level,
				)
				: null;
			const conditional = exactFeature?._conditionalToolGrant || null;
			const nestedDecision = state?.getLevelHistory?.()
				.flatMap((entry: any) => entry?.decisions || [])
				.find((it: any) => it?.type === "nestedTool" && it?.grantKey === cfg.conditionalGrantKey);
			return {
				tools: state?.getToolProficiencies?.() || [],
				hasExactFeature: !cfg.feature || !!exactFeature,
				hasExcludedFeature: !!state?.getFeatures?.().some((it: any) =>
					it?.name === cfg.feature?.name
					&& cfg.excludedFeatureSources.includes(it?.source || it?.subclassSource),
				),
				requiredReplacementCount: conditional?.requiredCount ?? 0,
				selections: conditional?.selections || [],
				pendingChoiceCount: (state?.getPendingFeatureChoices?.() || [])
					.filter((it: any) => it?.grantKey === cfg.conditionalGrantKey).length,
				nestedDecisionSelection: nestedDecision?.selection || [],
			};
		}, {feature, excludedFeatureSources, conditionalGrantKey});

		expect(result.hasExactFeature, "exact tool-granting feature").toBe(true);
		expect(result.hasExcludedFeature, "incompatible feature source must stay isolated").toBe(false);
		if (conditionalGrantKey) expect(result.pendingChoiceCount, "conditional tool replacement choice should be resolved").toBe(0);
		for (const tool of includes) {
			expect(
				result.tools.some((it: string) => it.toLowerCase() === tool.toLowerCase()),
				`tool proficiency ${tool}; seen=[${result.tools.join(", ")}]`,
			).toBe(true);
		}
		expect(result.selections).toHaveLength(result.requiredReplacementCount);
		if (result.requiredReplacementCount) {
			expect(result.nestedDecisionSelection).toEqual(result.selections);
		}
	}

	async probePreparedSpellGrants ({
		sourceFeature,
		className,
		classSource,
		subclassName,
		subclassSource,
		grants,
		expectPreparedAllowanceFilled = false,
		currentLevel,
	}: {
		sourceFeature: string;
		className: string;
		classSource: string;
		subclassName: string;
		subclassSource: string;
		grants: Array<{level: number; name: string; source: string}>;
		expectPreparedAllowanceFilled?: boolean;
		currentLevel: number;
	}): Promise<void> {
		const expected = grants.filter(it => it.level <= currentLevel);
		const result = await this.page.evaluate((cfg) => {
			const state: any = (globalThis as any).charSheet?._state;
			const allSpells = state?.getSpellsKnown?.() || state?.getSpells?.() || [];
			const sourceFeatureSpells = allSpells.filter((spell: any) =>
				spell?.sourceFeature === cfg.sourceFeature
				&& spell?.sourceClass === cfg.className
				&& spell?.sourceClassSource === cfg.classSource
				&& spell?.sourceSubclass === cfg.subclassName
				&& spell?.sourceSubclassSource === cfg.subclassSource,
			);
			const found = cfg.expected.map((want: any) => {
				const spell = allSpells.find((it: any) =>
					it?.name === want.name
					&& it?.source === want.source
					&& it?.sourceFeature === cfg.sourceFeature,
				);
				if (!spell) return {name: want.name, source: want.source, missing: true};
				const unprepareResult = state?.setSpellPrepared?.(spell.id, false);
				const after = (state?.getSpellsKnown?.() || state?.getSpells?.() || [])
					.find((it: any) => it?.id === spell.id);
				return {
					name: spell.name,
					source: spell.source,
					sourceFeature: spell.sourceFeature,
					sourceClass: spell.sourceClass,
					sourceClassSource: spell.sourceClassSource,
					sourceSubclass: spell.sourceSubclass,
					sourceSubclassSource: spell.sourceSubclassSource,
					alwaysPrepared: spell.alwaysPrepared,
					prepared: after?.prepared,
					unprepareResult,
				};
			});
			const card = state?.getSpellcastingClassBreakdown?.().find((it: any) =>
				it?.className === cfg.className && it?.classSource === cfg.classSource,
			) || state?.getSpellcastingClassBreakdown?.().find((it: any) =>
				it?.className === cfg.className,
			);
			return {
				found,
				sourceFeatureUids: sourceFeatureSpells.map((spell: any) => `${spell.name}|${spell.source}`).sort(),
				card: card
					? {
						spellsCount: card.spellsCount,
						spellsGranted: card.spellsGranted,
						spellsMax: card.spellsMax,
					}
					: null,
			};
		}, {sourceFeature, className, classSource, subclassName, subclassSource, expected});

		const expectedUids = expected.map(it => `${it.name}|${it.source}`).sort();
		expect(result.sourceFeatureUids, "exact cumulative Alchemist spell grants").toEqual(expectedUids);
		for (const spell of result.found) {
			expect(spell, `${spell.name}|${spell.source} should be an exact-source always-prepared grant`).toMatchObject({
				sourceFeature,
				sourceClass: className,
				sourceClassSource: classSource,
				sourceSubclass: subclassName,
				sourceSubclassSource: subclassSource,
				alwaysPrepared: true,
				prepared: true,
				unprepareResult: false,
			});
		}
		expect(result.card, `${className}|${classSource} spellcasting breakdown`).not.toBeNull();
		expect(result.card?.spellsGranted, "granted spells should be counted separately").toBe(expected.length);
		if (expectPreparedAllowanceFilled) {
			expect(result.card?.spellsCount, "player-prepared allowance should remain fully available").toBe(result.card?.spellsMax);
		}

		await this.switchToTab(this.tabSpells);
		for (const spell of expected) {
			const row = this.page.locator(".charsheet__spell-item")
				.filter({has: this.page.locator(".charsheet__spell-item-name", {hasText: new RegExp(`^${spell.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")})})
				.first();
			await expect(row, `${spell.name} should render`).toBeVisible();
			await expect(row.locator(".charsheet__spell-always-prepared")).toContainText("Always");
			await expect(row.locator(".charsheet__spell-prepared")).toHaveCount(0);
		}
	}

	async probeCraftingTimeCalculation ({
		recipeCategory,
		rarity,
		expectValueAbsent = false,
		baselineWorkweeks,
		effectiveWorkweeks,
		multiplier,
		sourceUid,
		sourceMultiplier = multiplier,
		allowAdditionalSources = false,
	}: {
		recipeCategory: string;
		rarity: string;
		expectValueAbsent?: boolean;
		baselineWorkweeks: number;
		effectiveWorkweeks: number;
		multiplier: number;
		sourceUid: string;
		sourceMultiplier?: number;
		allowAdditionalSources?: boolean;
	}): Promise<void> {
		const result = await this.page.evaluate(async (cfg) => {
			const state: any = (globalThis as any).charSheet?._state;
			const response = await fetch("/data/crafting.json");
			if (!response.ok) return {error: `crafting catalog HTTP ${response.status}`};
			const catalog = await response.json();
			const recipes = catalog?.craftingRecipe || [];
			const recipe = recipes.find((it: any) =>
				it?.recipeCategory === cfg.recipeCategory
				&& it?.rarity === cfg.rarity
				&& (!cfg.expectValueAbsent || it?.value == null),
			);
			if (!recipe) return {error: "matching real crafting recipe not found"};
			const calculation = state?.getCraftingTimeCalculation?.({recipe});
			const negativeRecipe = recipes.find((it: any) =>
				it?.recipeCategory !== cfg.recipeCategory
				&& it?.rarity === cfg.rarity
				&& it?.value == null,
			);
			const negative = negativeRecipe
				? state?.getCraftingTimeCalculation?.({recipe: negativeRecipe})
				: null;
			return {
				error: null,
				recipe: {
					name: recipe.name,
					source: recipe.source,
					hasValue: Object.prototype.hasOwnProperty.call(recipe, "value") && recipe.value != null,
				},
				calculation,
				negative,
			};
		}, {recipeCategory, rarity, expectValueAbsent});

		expect(result.error, "real crafting recipe lookup").toBeNull();
		if (expectValueAbsent) expect(result.recipe?.hasValue, "fixture must be value-less").toBe(false);
		expect(result.calculation).toMatchObject({
			isSupported: true,
			baselineWorkweeks,
			effectiveWorkweeks,
			multiplier,
		});
		const expectedSource = expect.objectContaining({uid: sourceUid, multiplier: sourceMultiplier});
		if (allowAdditionalSources) {
			expect(result.calculation?.sourceBreakdown).toEqual(expect.arrayContaining([expectedSource]));
		} else {
			expect(result.calculation?.sourceBreakdown).toEqual([expectedSource]);
		}
		if (result.negative) {
			expect(result.negative.sourceBreakdown, "non-potion recipe should not receive the Alchemist multiplier")
				.not.toEqual(expect.arrayContaining([expect.objectContaining({uid: sourceUid})]));
			if (!allowAdditionalSources) {
				expect(result.negative.effectiveWorkweeks).toBe(result.negative.baselineWorkweeks);
				expect(result.negative.sourceBreakdown).toEqual([]);
			}
		}
	}

	async probeSourceQualifiedRoundTrip ({
		className,
		classSource,
		subclassName,
		subclassSource,
		featureUids,
		spellGrants = [],
		spellGrantSourceFeature,
		incompatibleSubclassSources = [],
		currentLevel,
	}: {
		className: string;
		classSource: string;
		subclassName: string;
		subclassSource: string;
		featureUids: Array<{level: number; uid: string}>;
		spellGrants?: Array<{level: number; name: string; source: string}>;
		spellGrantSourceFeature?: string;
		incompatibleSubclassSources?: string[];
		currentLevel: number;
	}): Promise<void> {
		const expectedFeatureUids = featureUids.filter(it => it.level <= currentLevel).map(it => it.uid);
		const expectedSpellUids = spellGrants.filter(it => it.level <= currentLevel).map(it => `${it.name}|${it.source}`).sort();
		const result = await this.page.evaluate((cfg) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const json = state?.toJson?.();
			if (!json) return {error: "state.toJson unavailable"};
			const loaded = state.loadFromJson(structuredClone(json));
			if (loaded === false) return {error: "state.loadFromJson rejected export"};
			cs?._renderCharacter?.();
			const cls = state.getClasses?.().find((it: any) =>
				it?.name === cfg.className && it?.source === cfg.classSource,
			);
			const toFeatureUid = (feature: any) => [
				feature?.name,
				feature?.className,
				feature?.classSource,
				feature?.subclassShortName,
				feature?.subclassSource,
				feature?.level,
				feature?.source,
			].join("|");
			const featureSet = new Set((state.getFeatures?.() || []).map(toFeatureUid));
			const spells = state.getSpellsKnown?.() || state.getSpells?.() || [];
			const grantUids = spells
				.filter((spell: any) =>
					(!cfg.spellGrantSourceFeature || spell?.sourceFeature === cfg.spellGrantSourceFeature)
					&& spell?.sourceClass === cfg.className
					&& spell?.sourceClassSource === cfg.classSource
					&& spell?.sourceSubclass === cfg.subclassName
					&& spell?.sourceSubclassSource === cfg.subclassSource,
				)
				.map((spell: any) => `${spell.name}|${spell.source}`)
				.sort();
			return {
				error: null,
				classEntry: cls ? {
					name: cls.name,
					source: cls.source,
					subclassName: cls.subclass?.name,
					subclassSource: cls.subclass?.source,
				} : null,
				hasCompatibilitySubclass: !!state.getClasses?.().some((it: any) =>
					it?.name === cfg.className
					&& it?.source === cfg.classSource
					&& it?.subclass?.name === cfg.subclassName
					&& cfg.incompatibleSubclassSources.includes(it?.subclass?.source),
				),
				missingFeatures: cfg.expectedFeatureUids.filter((uid: string) => !featureSet.has(uid)),
				grantUids,
			};
		}, {
			className,
			classSource,
			subclassName,
			subclassSource,
			expectedFeatureUids,
			spellGrantSourceFeature,
			incompatibleSubclassSources,
		});

		expect(result.error, "source-qualified export round-trip").toBeNull();
		expect(result.classEntry).toEqual({
			name: className,
			source: classSource,
			subclassName,
			subclassSource,
		});
		expect(result.hasCompatibilitySubclass, "incompatible subclass source must not replace exact identity").toBe(false);
		expect(result.missingFeatures).toEqual([]);
		expect(result.grantUids).toEqual(expectedSpellUids);
	}

	async probeEfaArtificerPlans (): Promise<void> {
		await this._ensureExactToolItem("Tinker's Tools", "XPHB");
		const result = await this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const snapshot = state?.toJson?.();
			const calc = state?.getFeatureCalculations?.() || {};
			const plans = state?.getEfaArtificerPlans?.() || [];
			const projection = state?.getEfaArtificerPlanProjection?.() || {};
			const production = state?.getEfaReplicateMagicItemProductionOptions?.();
			const firstResolved = production?.plans?.find((it: any) => it?.ok && it?.options?.length);
			const firstOption = firstResolved?.options?.[0];
			const committed = firstResolved && firstOption
				? state.commitEfaReplicateMagicItemsAtLongRest({
					selections: [{
						slotId: firstResolved.plan.slotId,
						resolvedItemUid: firstOption.itemUid,
						attune: false,
					}],
				})
				: null;
			const created = committed?.created?.[0];
			const createdRow = created
				? state.getInventory().find((row: any) => row.id === (created.itemId || created.id))
				: null;
			const classification = createdRow ? state.classifyGeneratedFeatureItem(createdRow) : null;
			state.loadFromJson(structuredClone(snapshot));
			cs?._renderCharacter?.();
			return {
				expectedPlans: calc.artificerPlansKnown,
				expectedCreatedMax: calc.artificerCreatedMagicItemsMax,
				plans: plans.map((plan: any) => ({
					slotId: plan.slotId,
					acquisitionLevel: plan.acquisitionLevel,
					itemUid: plan.selection?.itemUid,
					planUid: plan.selection?.planUid,
				})),
				unresolvedCount: (projection.unresolved || []).length,
				productionAvailable: production?.available,
				productionMax: production?.maxCreatedItems,
				committed,
				classification,
			};
		});

		expect(result.expectedPlans, "EFA Artificer plans-known calculation").toBeGreaterThan(0);
		expect(result.plans, "auto-filled Replicate Magic Item plan choices").toHaveLength(result.expectedPlans);
		expect(new Set(result.plans.map((it: any) => it.slotId)).size).toBe(result.expectedPlans);
		expect(new Set(result.plans.map((it: any) => it.planUid || it.itemUid)).size).toBe(result.expectedPlans);
		expect(result.plans.every((it: any) => !!it.itemUid && !!it.planUid)).toBe(true);
		expect(result.unresolvedCount, "Replicate Magic Item plan projection").toBe(0);
		expect(result.productionAvailable, "equipped Tinker's Tools should enable production").toBe(true);
		expect(result.productionMax).toBe(result.expectedCreatedMax);
		expect(result.committed).toMatchObject({
			ok: true,
			code: "replicate-production-committed",
		});
		expect(result.committed.created).toHaveLength(1);
		expect(result.classification).toMatchObject({
			status: "valid",
			owner: {
				featureUid: "Replicate Magic Item|Artificer|EFA|2",
				featureSource: "EFA",
				classUid: "Artificer|EFA",
			},
		});
	}

	async probeSourceQualifiedInnateSpellFlow ({
		spellName,
		spellSource,
		ownerUid,
		classUid,
		sourceFeatureUid,
		expectedMax,
		expectedSlotLevel,
		ability = "int",
	}: {
		spellName: string;
		spellSource: string;
		ownerUid: string;
		classUid: string;
		sourceFeatureUid: string;
		expectedMax: number | "abilityMod";
		expectedSlotLevel: number;
		ability?: "str" | "dex" | "con" | "int" | "wis" | "cha";
	}): Promise<void> {
		const focusId = await this._ensureExactToolItem("Alchemist's Supplies", "XPHB");
		const result = await this.page.evaluate(async (cfg) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			const spell = state?.getInnateSpells?.().find((it: any) =>
				it?.name === cfg.spellName
				&& it?.source === cfg.spellSource
				&& it?.ownerUid === cfg.ownerUid,
			);
			if (!spell) return {error: "exact innate spell grant missing"};
			const slotsBefore = structuredClone(state.getSpellSlots());
			const preparedMaxBefore = state.getMaxPreparedSpells("Artificer");
			const beforeUses = {...spell.uses};
			const receipt = await cs._spells._castInnateSpell(spell.id, {
				decision: {focusInventoryItemId: cfg.focusId},
			});
			const afterCastUses = {...state.getInnateSpells().find((it: any) => it.id === spell.id)?.uses};
			const slotsAfter = structuredClone(state.getSpellSlots());
			state.onLongRest();
			const afterRestUses = {...state.getInnateSpells().find((it: any) => it.id === spell.id)?.uses};
			cs._renderCharacter?.();
			return {
				error: null,
				metadata: {
					ownerUid: spell.ownerUid,
					classUid: spell.classUid,
					sourceFeatureUid: spell.sourceFeatureUid,
					sourceClassSource: spell.sourceClassSource,
					sourceSubclassSource: spell.sourceSubclassSource,
					ignoresPreparation: spell.ignoresPreparation,
					ignoresMaterialComponents: spell.ignoresMaterialComponents,
					focusItemUids: spell.spellcastingFocusRequirement?.filter?.itemUids,
				},
				beforeUses,
				afterCastUses,
				afterRestUses,
				expectedAbilityMax: Math.max(1, state.getAbilityMod(cfg.ability)),
				slotsUnchanged: JSON.stringify(slotsBefore) === JSON.stringify(slotsAfter),
				preparedMaxUnchanged: state.getMaxPreparedSpells("Artificer") === preparedMaxBefore,
				receipt,
			};
		}, {spellName, spellSource, ownerUid, focusId, ability});

		expect(result.error, `${spellName} innate cast`).toBeNull();
		const max = expectedMax === "abilityMod" ? result.expectedAbilityMax : expectedMax;
		expect(result.metadata).toMatchObject({
			ownerUid,
			classUid,
			sourceFeatureUid,
			sourceClassSource: "EFA",
			sourceSubclassSource: "EFA",
			ignoresPreparation: true,
			ignoresMaterialComponents: true,
			focusItemUids: ["Alchemist's Supplies|XPHB"],
		});
		expect(result.beforeUses).toEqual({current: max, max});
		expect(result.afterCastUses).toEqual({current: max - 1, max});
		expect(result.afterRestUses).toEqual({current: max, max});
		expect(result.slotsUnchanged, `${spellName} must not spend a spell slot`).toBe(true);
		expect(result.preparedMaxUnchanged, `${spellName} must not consume prepared allowance`).toBe(true);
		expect(result.receipt).toMatchObject({
			ok: true,
			committed: true,
			spellUid: `${spellName}|${spellSource}`,
			castType: "innate",
			slotLevel: expectedSlotLevel,
			castingClassUid: classUid,
			castingSubclassUid: ownerUid,
			focusInventoryItemId: focusId,
			focusItemUid: "Alchemist's Supplies|XPHB",
			sourceFeatureUid,
			ruleId: "efa-alchemist-alchemists-supplies-required",
			focusRule: {
				ruleId: "efa-alchemist-alchemists-supplies-required",
				sourceFeatureUid,
			},
		});
	}

	async probeEfaAlchemistCastFollowUp (probe: "savant" | "eruption"): Promise<void> {
		if (probe === "savant") return this._probeEfaAlchemicalSavant();
		return this._probeEfaAlchemicalEruption();
	}

	private async _probeEfaAlchemicalSavant (): Promise<void> {
		const focusId = await this._ensureExactToolItem("Alchemist's Supplies", "XPHB");
		const result = await this.page.evaluate(async ({focusId}) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs._state;
			const row = state.getInventory().find((it: any) => it.id === focusId);
			const focus = state.getSpellCastFocusReference(row);
			const makeReceipt = ({damageType = "acid", kind = "damage", classUid = "Artificer|EFA", itemFocus = focus}: any = {}) => ({
				receiptVersion: 1,
				receiptId: `e2e-savant-${kind}-${damageType}-${classUid}`,
				ok: true,
				committed: true,
				castingClassUid: classUid,
				castingSubclassUid: "Alchemist|Artificer|EFA|EFA",
				spellUid: "E2E Alchemical Formula|EFA",
				spell: {name: "E2E Alchemical Formula", source: "EFA", level: 1},
				castType: "slot",
				focus: itemFocus,
				cast: {
					rolls: [{
						id: `${kind}:0`,
						kind,
						...(kind === "damage" ? {damageType} : {}),
						formula: "1d6",
						total: 4,
					}],
				},
			});
			const intBonus = Math.max(1, state.getAbilityMod("int"));
			const spell = state.getSpells().find((it: any) =>
				it.name === "Ray of Sickness"
				&& it.source === "XPHB"
				&& it.sourceClass === "Artificer"
				&& it.sourceClassSource === "EFA",
			);
			if (!spell) return {error: "exact EFA Alchemist Ray of Sickness grant missing"};
			const slotsBefore = state.getSpellSlotsCurrent(1);
			const eligible = await cs._spells._castSpell(spell.id, {
				withMetamagic: false,
				decision: {
					slotLevel: 1,
					castAsRitual: false,
					skipComponentPrompt: true,
					focusInventoryItemId: focusId,
				},
			});
			const second = await cs._spells._pApplyEfaAlchemicalSavant(eligible);
			const healing = makeReceipt({kind: "healing"});
			const healingApplied = await cs._spells._pApplyEfaAlchemicalSavant(healing);
			const necrotic = await cs._spells._pApplyEfaAlchemicalSavant(makeReceipt({damageType: "necrotic"}));
			const wrongClass = await cs._spells._pApplyEfaAlchemicalSavant(makeReceipt({classUid: "Artificer|TCE"}));
			const wrongFocus = await cs._spells._pApplyEfaAlchemicalSavant(makeReceipt({
				itemFocus: {...focus, itemUid: "Alchemist's Supplies|PHB"},
			}));
			const baseInt = state._data.abilities.int;
			state.setAbilityBase("int", 8);
			const minimum = makeReceipt({damageType: "fire"});
			const minimumApplied = await cs._spells._pApplyEfaAlchemicalSavant(minimum);
			state.setAbilityBase("int", baseInt);
			return {
				error: null,
				intBonus,
				slotsBefore,
				slotsAfter: state.getSpellSlotsCurrent(1),
				liveReceipt: eligible,
				second,
				eligibleRoll: eligible.cast.rolls[0],
				healingApplied,
				healingRoll: healing.cast.rolls[0],
				necrotic,
				wrongClass,
				wrongFocus,
				minimumApplied,
				minimumRoll: minimum.cast.rolls[0],
			};
		}, {focusId});

		expect(result.error).toBeNull();
		expect(result.slotsAfter).toBe(result.slotsBefore - 1);
		expect(result.liveReceipt, JSON.stringify(result, null, 2)).toMatchObject({
			ok: true,
			committed: true,
			castingClassUid: "Artificer|EFA",
			castingSubclassUid: "Alchemist|Artificer|EFA|EFA",
			spellUid: "Ray of Sickness|XPHB",
			castType: "slot",
			focusInventoryItemId: focusId,
			focusItemUid: "Alchemist's Supplies|XPHB",
			alchemicalSavant: {bonus: result.intBonus},
		});
		expect(result.eligibleRoll).toMatchObject({
			total: result.liveReceipt.alchemicalSavant.finalTotal,
			alchemicalSavant: {bonus: result.intBonus},
		});
		expect(result.liveReceipt.alchemicalSavant.finalTotal - result.liveReceipt.alchemicalSavant.originalTotal).toBe(result.intBonus);
		expect(result.second).toEqual({applied: false, reason: "alreadyHandled"});
		expect(result.healingApplied).toMatchObject({applied: true, bonus: result.intBonus});
		expect(result.healingRoll.total).toBe(4 + result.intBonus);
		expect(result.minimumApplied).toMatchObject({applied: true, bonus: 1});
		expect(result.minimumRoll.total).toBe(5);
		expect(result.necrotic).toEqual({applied: false, reason: "noEligibleRoll"});
		expect(result.wrongClass).toEqual({applied: false, reason: "ineligibleCast"});
		expect(result.wrongFocus).toEqual({applied: false, reason: "ineligibleCast"});
	}

	private async _probeEfaAlchemicalEruption (): Promise<void> {
		const focusId = await this._ensureExactToolItem("Alchemist's Supplies", "XPHB");
		const result = await this.page.evaluate(async ({focusId}) => {
			const cs: any = (globalThis as any).charSheet;
			const state: any = cs?._state;
			const makeReceipt = ({damageType = "acid", classUid = "Artificer|EFA", subclassUid = "Alchemist|Artificer|EFA|EFA", castType = "slot"}: any = {}) => ({
				receiptVersion: 1,
				receiptId: `e2e-eruption-${damageType}-${classUid}-${castType}`,
				ok: true,
				committed: true,
				castingClassUid: classUid,
				castingSubclassUid: subclassUid,
				spellUid: "E2E Eruption Spell|EFA",
				spell: {name: "E2E Eruption Spell", source: "EFA", level: 1},
				castType,
				damageEvidence: {
					version: 1,
					resolution: "confirmed",
					damage: [{damageType, amount: 8}],
					targets: [{targetId: "target-1", targetName: "Goblin", outcome: "damaged"}],
				},
			});
			const target = {targetId: "target-1", targetName: "Goblin"};
			const roll = async () => ({dice: "2d8", damageType: "force", total: 9});
			const spell = state.getSpells().find((it: any) =>
				it.name === "Ray of Sickness"
				&& it.source === "XPHB"
				&& it.sourceClass === "Artificer"
				&& it.sourceClassSource === "EFA",
			);
			if (!spell) return {error: "exact EFA Alchemist Ray of Sickness grant missing"};
			state.endCombat?.();
			const originalEruptionFollowUp = cs._spells._pHandleAlchemicalEruption;
			cs._spells._pHandleAlchemicalEruption = async () => ({status: "deferredForE2e"});
			let liveReceipt;
			try {
				liveReceipt = await cs._spells._castSpell(spell.id, {
					withMetamagic: false,
					decision: {
						slotLevel: 1,
						castAsRitual: false,
						skipComponentPrompt: true,
						focusInventoryItemId: focusId,
					},
				});
			} finally {
				cs._spells._pHandleAlchemicalEruption = originalEruptionFollowUp;
			}
			const liveUse = await state.pUseAlchemicalEruption({
				receipt: liveReceipt,
				target,
				manualConfirmed: true,
				fnRollDamage: roll,
			});
			const wrongType = await state.pUseAlchemicalEruption({receipt: makeReceipt({damageType: "necrotic"}), target, manualConfirmed: true, fnRollDamage: roll});
			const itemCast = await state.pUseAlchemicalEruption({receipt: makeReceipt({castType: "item"}), target, manualConfirmed: true, fnRollDamage: roll});
			const wrongSubclass = state.getAlchemicalEruptionEligibility(makeReceipt({subclassUid: "Alchemist|Artificer|EFA|TCE"}));
			state.startCombat();
			const first = await state.pUseAlchemicalEruption({receipt: makeReceipt(), target, fnRollDamage: roll});
			const second = await state.pUseAlchemicalEruption({receipt: makeReceipt(), target, fnRollDamage: roll});
			state.advanceRound();
			const nextTurn = await state.pUseAlchemicalEruption({receipt: makeReceipt({damageType: "fire"}), target, fnRollDamage: roll});
			state.endCombat();
			return {error: null, liveReceipt, liveUse, first, second, nextTurn, wrongType, itemCast, wrongSubclass};
		}, {focusId});

		expect(result.error).toBeNull();
		expect(result.liveReceipt).toMatchObject({
			ok: true,
			committed: true,
			castingClassUid: "Artificer|EFA",
			castingSubclassUid: "Alchemist|Artificer|EFA|EFA",
			spellUid: "Ray of Sickness|XPHB",
			castType: "slot",
			focusInventoryItemId: focusId,
			focusItemUid: "Alchemist's Supplies|XPHB",
		});
		expect(result.liveReceipt.damageEvidence.damage).toEqual(expect.arrayContaining([
			expect.objectContaining({damageType: "poison"}),
		]));
		expect(result.liveUse).toMatchObject({
			ok: true,
			committed: true,
			damage: {dice: "2d8", damageType: "force", total: 9},
		});
		expect(result.first).toMatchObject({
			ok: true,
			committed: true,
			damage: {dice: "2d8", damageType: "force", total: 9},
			target: {targetId: "target-1", targetName: "Goblin"},
		});
		expect(result.second).toMatchObject({ok: false, committed: false, reason: "alreadyUsedThisTurn"});
		expect(result.nextTurn).toMatchObject({ok: true, committed: true, damage: {dice: "2d8", damageType: "force"}});
		expect(result.wrongType).toMatchObject({ok: false, committed: false, reason: "wrongDamageType"});
		expect(result.itemCast).toMatchObject({ok: false, committed: false, reason: "wrongCastType"});
		expect(result.wrongSubclass).toMatchObject({eligible: false, reason: "wrongCastingSubclass"});
	}

	async probeEfaExperimentalElixirUi (): Promise<void> {
		console.log("[efa-elixir-ui] start");
		await this._ensureExactToolItem("Alchemist's Supplies", "XPHB");
		const original = await this.page.evaluate(() => (globalThis as any).charSheet?._state?.toJson?.());
		try {
			const batchSize = await this.page.evaluate(() =>
				(globalThis as any).charSheet?._state?.getEfaExperimentalElixirBatchSize?.(),
			);
			expect(batchSize, "Experimental Elixir batch size at this checkpoint").toBe(5);

			const produced = await this._finishLongRestWithEfaElixir("produce", {verifyRetainedRolls: true});
			console.log("[efa-elixir-ui] produced long-rest batch");
			expect(produced.rollsRetained, "Produce → Decline → Produce must retain the original rolls").toBe(true);
			expect(produced.vials).toHaveLength(batchSize);
			expect(produced.vials.every((it: any) => it.status === "valid" && it.origin === "longRest")).toBe(true);

			const declined = await this._finishLongRestWithEfaElixir("decline");
			console.log("[efa-elixir-ui] declined replacement batch");
			expect(declined.vials, "declining the next batch expires the prior batch").toEqual([]);

			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const row = cs._state.getEfaExperimentalElixirSuppliesRows()[0];
				cs._state.setItemEquipped(row.id, false);
				cs._renderCharacter?.();
			});
			const withoutSupplies = await this._finishLongRestWithEfaElixir("decline", {expectSupplies: false});
			console.log("[efa-elixir-ui] completed no-supplies long rest");
			expect(withoutSupplies.productionUnavailable).toBe(true);
			expect(withoutSupplies.vials).toEqual([]);
			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const row = cs._state.getInventory().find((it: any) =>
					it?.item?.name === "Alchemist's Supplies" && it?.item?.source === "XPHB",
				);
				cs._state.setItemEquipped(row.id, true);
				cs._renderCharacter?.();
			});
			console.log("[efa-elixir-ui] re-equipped supplies");

			const created: Record<string, string> = {};
			for (const effectKey of ["healing", "swiftness", "resilience", "boldness", "flight"]) {
				const result = await this._createEfaExperimentalElixirWithUi(effectKey);
				console.log(`[efa-elixir-ui] created ${effectKey}`);
				created[effectKey] = result.itemId;
				expect(result.slotAfter, `${effectKey} creation spends one spell slot`).toBe(result.slotBefore - 1);
				expect(result.metadata).toMatchObject({
					effectKey,
					origin: "spellSlot",
					creationArtificerLevel: 17,
				});
			}

			await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				state.setCurrentHp(Math.max(1, state.getMaxHp() - 30));
				(globalThis as any).charSheet?._renderCharacter?.();
			});
			const beforeHealing = await this._readEfaExperimentalElixirMechanics();
			await this._consumeEfaExperimentalElixirWithUi(created.healing);
			const afterHealing = await this._readEfaExperimentalElixirMechanics();
			expect(afterHealing.hp, "Healing elixir restores real HP").toBeGreaterThan(beforeHealing.hp);

			const beforeSwiftness = await this._readEfaExperimentalElixirMechanics();
			await this._consumeEfaExperimentalElixirWithUi(created.swiftness);
			const afterSwiftness = await this._readEfaExperimentalElixirMechanics();
			expect(afterSwiftness.walkSpeed).toBe(beforeSwiftness.walkSpeed + 20);
			const swiftnessState = afterSwiftness.effects.find((it: any) => it.effectKey === "swiftness");
			expect(swiftnessState).toMatchObject({status: "valid", active: true});

			const beforeResilience = await this._readEfaExperimentalElixirMechanics();
			await this._consumeEfaExperimentalElixirWithUi(created.resilience);
			const afterResilience = await this._readEfaExperimentalElixirMechanics();
			expect(afterResilience.ac).toBe(beforeResilience.ac + 1);

			await this._consumeEfaExperimentalElixirWithUi(created.boldness);
			const afterBoldness = await this._readEfaExperimentalElixirMechanics();
			expect(afterBoldness.attackBonusDice).toEqual([
				expect.objectContaining({dice: "1d4", sign: 1, source: "Experimental Elixir: Boldness"}),
			]);
			expect(afterBoldness.saveBonusDice).toEqual([
				expect.objectContaining({dice: "1d4", sign: 1, source: "Experimental Elixir: Boldness"}),
			]);
			expect(afterBoldness.checkBonusDice).toEqual([]);

			await this._consumeEfaExperimentalElixirWithUi(created.flight);
			const afterFlight = await this._readEfaExperimentalElixirMechanics();
			expect(afterFlight.flySpeed).toBe(30);
			console.log("[efa-elixir-ui] consumed five Self effects");

			const refreshOne = await this._createEfaExperimentalElixirWithUi("swiftness");
			const refreshTwo = await this._createEfaExperimentalElixirWithUi("swiftness");
			await this._consumeEfaExperimentalElixirWithUi(refreshOne.itemId);
			const firstRefresh = await this._readEfaExperimentalElixirMechanics();
			const firstSwiftness = firstRefresh.effects.find((it: any) => it.effectKey === "swiftness");
			await this.page.evaluate((stateId) => {
				const state: any = (globalThis as any).charSheet?._state;
				const active = state._data.activeStates.find((it: any) => it.id === stateId);
				active.roundsRemaining = 7;
			}, firstSwiftness.stateId);
			await this._consumeEfaExperimentalElixirWithUi(refreshTwo.itemId);
			const refreshed = await this._readEfaExperimentalElixirMechanics();
			const refreshedSwiftness = refreshed.effects.filter((it: any) => it.effectKey === "swiftness");
			expect(refreshedSwiftness).toHaveLength(1);
			expect(refreshedSwiftness[0].stateId).toBe(firstSwiftness.stateId);
			expect(refreshedSwiftness[0].roundsRemaining).toBeGreaterThan(7);
			expect(refreshed.walkSpeed).toBe(beforeSwiftness.walkSpeed + 20);
			console.log("[efa-elixir-ui] verified refresh");

			const other = await this._createEfaExperimentalElixirWithUi("flight");
			const beforeOther = await this._readEfaExperimentalElixirMechanics();
			const handoff = await this._consumeEfaExperimentalElixirWithUi(other.itemId, {target: "other", targetName: "Mira"});
			const afterOther = await this._readEfaExperimentalElixirMechanics();
			expect(handoff.previewKeptItem, "Other preview must not spend the vial").toBe(true);
			expect(handoff.handoff).toMatchObject({
				kind: "efaExperimentalElixirOther",
				version: 1,
				target: {
					type: "external",
					name: "Mira",
					range: {maximumFeet: 5, withinRangeConfirmed: true},
				},
				effect: {
					effectKey: "flight",
					mechanics: [{type: "flySpeed", value: 30, source: "Experimental Elixir"}],
				},
				source: {
					provenance: {
						owner: {
							classUid: "Artificer|EFA",
							subclassUid: "Alchemist|Artificer|EFA|EFA",
							featureUid: "Experimental Elixir|Artificer|EFA|Alchemist|EFA|3|EFA",
						},
						metadata: {effectKey: "flight", origin: "spellSlot"},
					},
				},
			});
			expect(afterOther.hp).toBe(beforeOther.hp);
			expect(afterOther.walkSpeed).toBe(beforeOther.walkSpeed);
			expect(afterOther.flySpeed).toBe(beforeOther.flySpeed);
			expect(afterOther.ac).toBe(beforeOther.ac);
			expect(afterOther.effects).toEqual(beforeOther.effects);
			console.log("[efa-elixir-ui] verified Other handoff");

			await this.triggerShortRest();
			const afterShortRest = await this._readEfaExperimentalElixirMechanics();
			expect(afterShortRest.effects.some((it: any) => it.effectKey === "swiftness")).toBe(false);
			expect(afterShortRest.walkSpeed).toBe(beforeSwiftness.walkSpeed);
			await this.triggerLongRest();
			const afterLongRest = await this._readEfaExperimentalElixirMechanics();
			expect(afterLongRest.effects).toEqual([]);
			console.log("[efa-elixir-ui] verified rest expiry");

			const isolation = await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const snapshot = cs._state.toJson();
				cs._state.setSubclass("Artificer", {name: "Alchemist", shortName: "Alchemist", source: "TCE"});
				const feature = cs._state._data.features.find((it: any) =>
					it?.name === "Experimental Elixir"
						&& it?.className === "Artificer"
						&& it?.classSource === "EFA",
				);
				if (feature) feature.subclassSource = "TCE";
				cs._renderCharacter?.();
				cs._features?.render?.();
				return {
					snapshot,
					batchSize: cs._state.getEfaExperimentalElixirBatchSize(),
				};
			});
			await this.switchToTab(this.tabFeatures);
			expect(isolation.batchSize, "TCE compatibility subclass must not enable the EFA operation").toBe(0);
			await expect(this._featureCard("Experimental Elixir").locator(".charsheet__efa-elixir-create")).toHaveCount(0);
			await this.page.evaluate((snapshot) => {
				const cs: any = (globalThis as any).charSheet;
				cs._state.loadFromJson(snapshot);
				cs._renderCharacter?.();
				cs._features?.render?.();
			}, isolation.snapshot);
			console.log("[efa-elixir-ui] verified source isolation");
		} finally {
			await this.page.evaluate((snapshot) => {
				const cs: any = (globalThis as any).charSheet;
				cs?._state?.loadFromJson?.(snapshot);
				cs?._renderCharacter?.();
			}, original);
		}
	}

	private async _finishLongRestWithEfaElixir (
		decision: "produce" | "decline",
		{verifyRetainedRolls = false, expectSupplies = true}: {verifyRetainedRolls?: boolean; expectSupplies?: boolean} = {},
	): Promise<{rollsRetained: boolean; productionUnavailable: boolean; vials: any[]}> {
		const startedAt = Date.now();
		console.log(`[efa-elixir-ui] ${decision} rest begin ${startedAt}`);
		await this.switchToTab(this.tabOverview);
		console.log(`[efa-elixir-ui] ${decision} overview ready +${Date.now() - startedAt}ms`);
		await this.page.locator("#charsheet-btn-long-rest").click({timeout: 10_000});
		console.log(`[efa-elixir-ui] ${decision} modal requested +${Date.now() - startedAt}ms`);
		const modal = this._visibleModal(/Long Rest/i);
		const section = modal.locator(".charsheet__efa-elixir-rest");
		await expect(section).toBeVisible({timeout: 10_000});
		console.log(`[efa-elixir-ui] ${decision} section visible +${Date.now() - startedAt}ms`);
		let rollsRetained = false;
		const productionUnavailable = await section.getByText(/Production unavailable/i).isVisible().catch(() => false);

		const resolveRowSixes = async () => {
			const selects = section.locator(".charsheet__efa-elixir-rest-roll select");
			for (let i = 0; i < await selects.count(); i++) await selects.nth(i).selectOption({index: 1});
		};
		if (expectSupplies && decision === "produce") {
			await section.locator("input[value='produce']").check();
			const before = await section.locator(".charsheet__efa-elixir-roll-value").allTextContents();
			await resolveRowSixes();
			if (verifyRetainedRolls) {
				await section.locator("input[value='decline']").check();
				await expect(section.locator(".charsheet__efa-elixir-roll-value")).toHaveCount(0);
				await section.locator("input[value='produce']").check();
				const after = await section.locator(".charsheet__efa-elixir-roll-value").allTextContents();
				rollsRetained = JSON.stringify(before) === JSON.stringify(after);
				await resolveRowSixes();
			}
		} else if (expectSupplies) {
			await section.locator("input[value='decline']").check();
		}
		console.log(`[efa-elixir-ui] ${decision} committing +${Date.now() - startedAt}ms`);
		await modal.getByRole("button", {name: /Finish Long Rest/i}).click({timeout: 10_000});
		console.log(`[efa-elixir-ui] ${decision} commit click returned +${Date.now() - startedAt}ms`);
		await expect(modal).toBeHidden({timeout: 10_000});
		console.log(`[efa-elixir-ui] ${decision} modal hidden +${Date.now() - startedAt}ms`);
		const vials = await this.page.evaluate(() => {
			const state: any = (globalThis as any).charSheet?._state;
			return state.getEfaExperimentalElixirRows().map((row: any) => {
				const classification = state.classifyEfaExperimentalElixir(row);
				return {
					id: row.id,
					status: classification.status,
					effectKey: classification.metadata?.effectKey,
					origin: classification.metadata?.origin,
				};
			});
		});
		return {rollsRetained, productionUnavailable, vials};
	}

	private async _createEfaExperimentalElixirWithUi (
		effectKey: "healing" | "swiftness" | "resilience" | "boldness" | "flight",
	): Promise<{itemId: string; slotBefore: number; slotAfter: number; metadata: any}> {
		const startedAt = Date.now();
		console.log(`[efa-elixir-ui] create ${effectKey} begin ${startedAt}`);
		const beforeIds = await this.page.evaluate(() =>
			(globalThis as any).charSheet._state.getEfaExperimentalElixirRows().map((it: any) => it.id),
		);
		console.log(`[efa-elixir-ui] create ${effectKey} inventory read +${Date.now() - startedAt}ms`);
		await this.switchToTab(this.tabFeatures);
		console.log(`[efa-elixir-ui] create ${effectKey} features ready +${Date.now() - startedAt}ms`);
		const card = this._featureCard("Experimental Elixir");
		await expect(card).toContainText(/Supplies ready/i, {timeout: 10_000});
		await card.locator(".charsheet__efa-elixir-create").click({timeout: 10_000});
		console.log(`[efa-elixir-ui] create ${effectKey} modal requested +${Date.now() - startedAt}ms`);
		const modal = this._visibleModal(/Create Experimental Elixir/i);
		await modal.locator(`input[name="efa-elixir-effect"][value="${effectKey}"]`).check({timeout: 10_000});
		const slot = modal.locator("[data-efa-elixir-slot]");
		const slotLevel = Number(await slot.inputValue());
		const slotBefore = await this.page.evaluate((level) =>
			(globalThis as any).charSheet._state.getSpellSlotsCurrent(level),
		slotLevel);
		await modal.locator("[data-efa-elixir-confirm]").click({timeout: 10_000});
		await expect(modal.locator("[data-efa-elixir-live]")).toContainText(/vial created/i, {timeout: 10_000});
		await expect(modal.locator("[data-efa-elixir-confirm]")).toHaveText("Done", {timeout: 10_000});
		console.log(`[efa-elixir-ui] create ${effectKey} committed +${Date.now() - startedAt}ms`);
		const created = await this.page.evaluate((ids) => {
			const state: any = (globalThis as any).charSheet._state;
			const row = state.getEfaExperimentalElixirRows().find((it: any) => !ids.includes(it.id));
			const classification = row ? state.classifyEfaExperimentalElixir(row) : null;
			return {
				itemId: row?.id || null,
				slotAfter: state.getSpellSlotsCurrent(classification?.metadata?.spentSlotLevel),
				metadata: classification?.metadata || null,
			};
		}, beforeIds);
		expect(created.itemId, `${effectKey} vial should appear in inventory`).toBeTruthy();
		await modal.locator("[data-efa-elixir-confirm]").click({timeout: 10_000});
		await expect(modal).toBeHidden({timeout: 10_000});
		await this.switchToTab(this.tabInventory);
		const item = this.page.locator(`.charsheet__item[data-item-id="${created.itemId}"]`);
		await expect(item).toContainText(new RegExp(effectKey, "i"));
		await expect(item).toContainText(/Spell slot/i);
		await expect(item.locator(`[data-efa-elixir-consume="${created.itemId}"]`)).toBeVisible();
		return {
			itemId: created.itemId,
			slotBefore,
			slotAfter: created.slotAfter,
			metadata: created.metadata,
		};
	}

	private async _consumeEfaExperimentalElixirWithUi (
		itemId: string,
		{target = "self", targetName = ""}: {target?: "self" | "other"; targetName?: string} = {},
	): Promise<{previewKeptItem: boolean; handoff: any | null}> {
		await this.switchToTab(this.tabInventory);
		await this.page.locator(`[data-efa-elixir-consume="${itemId}"]`).click();
		const modal = this._visibleModal(/Drink or Administer Experimental Elixir/i);
		let previewKeptItem = false;
		if (target === "other") {
			await modal.locator("input[name='efa-elixir-target'][value='other']").check();
			await modal.locator("[data-efa-elixir-target-name]").fill(targetName);
			await modal.locator("[data-efa-elixir-within-five]").check();
			await modal.locator("[data-efa-elixir-confirm]").click();
			await expect(modal.locator("[data-efa-elixir-live]")).toContainText(/Confirm to spend the vial/i);
			previewKeptItem = await this.page.evaluate((id) =>
				(globalThis as any).charSheet._state.getInventory().some((it: any) => it.id === id),
			itemId);
		}
		await modal.locator("[data-efa-elixir-confirm]").click();
		await expect(modal.locator("[data-efa-elixir-confirm]")).toHaveText("Done");
		const handoffText = target === "other"
			? await modal.locator(".charsheet__efa-elixir-handoff").inputValue()
			: null;
		const handoff = handoffText ? JSON.parse(handoffText) : null;
		await modal.locator("[data-efa-elixir-confirm]").click();
		await expect(modal).toBeHidden();
		expect(
			await this.page.evaluate((id) =>
				(globalThis as any).charSheet._state.getInventory().some((it: any) => it.id === id),
			itemId),
			"consumed Experimental Elixir should leave inventory",
		).toBe(false);
		return {previewKeptItem, handoff};
	}

	private async _readEfaExperimentalElixirMechanics (): Promise<any> {
		return this.page.evaluate(() => {
			const state: any = (globalThis as any).charSheet?._state;
			return {
				hp: state.getCurrentHp(),
				ac: state.getAc(),
				walkSpeed: state.getWalkSpeed(),
				flySpeed: state.getSpeedByType("fly"),
				attackBonusDice: state.getRollBonusDiceFromStates("attack:melee:str"),
				saveBonusDice: state.getRollBonusDiceFromStates("save:wis"),
				checkBonusDice: state.getRollBonusDiceFromStates("check:wis"),
				effects: state.getEfaExperimentalElixirActiveEffects().map((it: any) => ({
					status: it.status,
					stateId: it.stateId,
					effectKey: it.effectKey,
					active: it.active,
					roundsRemaining: it.roundsRemaining,
					sourceItemId: it.sourceContext?.itemId,
				})),
			};
		});
	}

	private async _ensureExactToolItem (name: string, source: string): Promise<string> {
		const result = await this.page.evaluate(async ({name, source}) => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			let row = state?.getInventory?.().find((it: any) =>
				it?.item?.name === name
				&& it?.item?.source === source,
			);
			if (!row) {
				const loader: any = (globalThis as any).DataLoader;
				const sourceItems = await loader?.pCacheAndGet?.("item", source, {isCopy: true}).catch(() => null);
				const allItems = Array.isArray(sourceItems)
					? sourceItems
					: await loader?.pCacheAndGetAllSite?.("item").catch(() => []);
				const item = (allItems || []).find((it: any) =>
					it?.name?.toLowerCase() === name.toLowerCase() && it?.source === source,
				);
				if (item) state?.addItem?.(item, 1, true, false);
				row = state?.getInventory?.().find((it: any) =>
					it?.item?.name === name
					&& it?.item?.source === source,
				);
			}
			if (!row) return {error: `could not add ${name}|${source}`};
			if (!row.equipped) state?.setItemEquipped?.(row.id, true);
			if (!state?.hasToolProficiency?.(name)) state?.addToolProficiency?.(name);
			cs?._inventory?._updateArmorClass?.();
			cs?._renderCharacter?.();
			return {error: null, id: row.id};
		}, {name, source});
		expect(result.error, `exact ${name}|${source} fixture`).toBeNull();
		return result.id!;
	}

	async probeDynamicInitiativeAbilityBonus ({
		featureName,
		ability,
	}: {
		featureName: string;
		ability: "str" | "dex" | "con" | "int" | "wis" | "cha";
	}): Promise<void> {
		const result = await this.page.evaluate(({featureName, ability}) => {
			const cs = (globalThis as any).charSheet;
			const state = cs._state;
			const abilityKey = ability;
			const beforeScore = state.getAbilityScore(abilityKey);
			const beforeMod = state.getAbilityMod(abilityKey);
			const beforeInitiative = state.getInitiative();
			const modifiers = state.getNamedModifiers?.() || state._data?.modifiers?.named || [];
			const matching = modifiers.filter((it: any) => it.name === featureName && it.type === "initiative");
			state.setAbilityBase(abilityKey, state._data.abilities[abilityKey] + 2);
			state._recalculateCustomModifiers();
			const afterMod = state.getAbilityMod(abilityKey);
			const afterInitiative = state.getInitiative();
			state.setAbilityBase(abilityKey, state._data.abilities[abilityKey] - 2);
			state._recalculateCustomModifiers();
			cs._renderCharacter?.();
			return {
				beforeScore,
				beforeMod,
				beforeInitiative,
				afterMod,
				afterInitiative,
				modifiers,
				matching,
			};
		}, {featureName, ability});
		expect(result.beforeMod, `${featureName} needs a non-zero ${ability} modifier for a meaningful probe`).not.toBe(0);
		expect(result.matching, `${featureName} should have exactly one named initiative modifier`).toHaveLength(1);
		expect(result.matching[0].abilityMod.toLowerCase().slice(0, 3)).toBe(ability);
		expect(result.afterMod - result.beforeMod).toBe(1);
		expect(result.afterInitiative - result.beforeInitiative).toBe(1);
	}

	async probePartialShortRestRestore ({
		resourceName,
		restoreAmount,
	}: {
		resourceName: string;
		restoreAmount: number;
	}): Promise<void> {
		const setup = await this.page.evaluate(({resourceName}) => {
			const cs = (globalThis as any).charSheet;
			const resource = cs._state.getResources().find((it: any) => it.name === resourceName);
			if (!resource) return null;
			const hp = cs._state.getHp();
			cs._state.setResourceCurrent(resource.id, 0);
			cs._state.setHp(Math.max(0, hp.max - 1), hp.max);
			cs._renderCharacter?.();
			return {id: resource.id, max: resource.max, hp};
		}, {resourceName});
		expect(setup, `${resourceName} resource should exist`).not.toBeNull();
		expect(setup!.max, `${resourceName} must have a partially restorable pool`).toBeGreaterThan(restoreAmount);

		const after = await this.page.evaluate(({id, hp, max}) => {
			const cs = (globalThis as any).charSheet;
			cs._state.onShortRest();
			const resource = cs._state.getResources().find((it: any) => it.id === id);
			const current = resource?.current;
			cs._state.setResourceCurrent(id, max);
			cs._state.setHp(hp.current, hp.max);
			cs._renderCharacter?.();
			return current;
		}, {id: setup!.id, hp: setup!.hp, max: setup!.max});
		expect(after).toBe(restoreAmount);
		expect(after).toBeLessThan(setup!.max);
	}

	async probeCantripDamageBonus ({
		spellName,
		featureName,
		ability,
	}: {
		spellName: string;
		featureName: string;
		ability: "str" | "dex" | "con" | "int" | "wis" | "cha";
	}): Promise<void> {
		const result = await this.page.evaluate(async ({spellName, ability}) => {
			const cs = (globalThis as any).charSheet;
			const storedSpell = cs._state.getSpells().find((it: any) => it.name?.toLowerCase() === spellName.toLowerCase());
			const spellData = cs._spells._allSpells.find((it: any) => it.name?.toLowerCase() === spellName.toLowerCase());
			if (!storedSpell || !spellData) return null;
			const originalRoll = cs._spells._rollDamageDiceDetailed;
			cs._spells._rollDamageDiceDetailed = () => ({total: 7, rolls: [7], modifier: 0, groups: []});
			try {
				const roll = await cs._spells._rollCantripDamage(spellData, null, storedSpell);
				return {roll, abilityMod: cs._state.getAbilityMod(ability)};
			} finally {
				cs._spells._rollDamageDiceDetailed = originalRoll;
			}
		}, {spellName, ability});
		expect(result, `${spellName} must be known and present in the spell catalog`).not.toBeNull();
		expect(result!.abilityMod, `${featureName} needs a non-zero ability modifier`).not.toBe(0);
		expect(result!.roll.total).toBe(7 + result!.abilityMod);
		expect(result!.roll.text).toContain(featureName);
		expect(result!.roll.text).toContain(`${result!.abilityMod >= 0 ? "+ " : ""}${result!.abilityMod}`);
	}

	async probeChronologicalInterference (featureName: string): Promise<void> {
		const setup = await this.page.evaluate(({featureName}) => {
			const cs = (globalThis as any).charSheet;
			const state = cs._state;
			state.endCombat();
			for (const entry of state.getCombatTurnOrder()) state.removeCombatTurnOrderParticipant(entry.id);
			const resource = state.getResources().find((it: any) => it.name === featureName);
			if (!resource) return null;
			state.setResourceCurrent(resource.id, resource.max);
			cs._renderCharacter?.();
			return {resourceId: resource.id, resourceMax: resource.max};
		}, {featureName});
		expect(setup, `${featureName} resource should exist`).not.toBeNull();

		await this.switchToTab(this.tabCombat);
		await this.page.locator("#charsheet-combat-turn-order-manage").click();
		const rosterModal = this._visibleModal(/Manage Turn Order/i);
		for (const combatant of [{name: "Ancient Dragon", initiative: 19}, {name: "Clockwork Knight", initiative: 11}]) {
			const addRow = rosterModal.locator(".charsheet__turn-order-add");
			await addRow.locator("[data-role='name']").fill(combatant.name);
			await addRow.locator("[data-role='initiative']").fill(`${combatant.initiative}`);
			await addRow.locator("[data-role='add']").click();
		}
		await rosterModal.getByRole("button", {name: "Done", exact: true}).click();
		await this.page.locator("#charsheet-combat-start").click();
		await expect(this.page.locator("#charsheet-combat-turn-order")).toContainText("Ancient Dragon");
		await expect(this.page.locator("#charsheet-combat-turn-order")).toContainText("Clockwork Knight");

		const beforeCancel = await this.page.evaluate(({resourceId}) => {
			const cs = (globalThis as any).charSheet;
			cs._combat._resetTurnActionUsage();
			cs._combat.render();
			return {
				order: cs._state.getCombatTurnOrder().map((it: any) => it.name),
				current: cs._state.getResources().find((it: any) => it.id === resourceId)?.current,
				bonusAction: cs._combat.isActionTypeAvailable("bonus"),
				historyCount: cs._rollHistory.getRollCount(),
			};
		}, {resourceId: setup!.resourceId});
		await this._clickActivatableFeature(featureName);
		const cancelModal = this._visibleModal(/Chronological Interference/i);
		await cancelModal.locator("[data-role='cancel']").click();
		await expect(cancelModal).toBeHidden();
		const afterCancel = await this.page.evaluate(({resourceId}) => {
			const cs = (globalThis as any).charSheet;
			return {
				order: cs._state.getCombatTurnOrder().map((it: any) => it.name),
				current: cs._state.getResources().find((it: any) => it.id === resourceId)?.current,
				bonusAction: cs._combat.isActionTypeAvailable("bonus"),
				historyCount: cs._rollHistory.getRollCount(),
			};
		}, {resourceId: setup!.resourceId});
		expect(afterCancel).toEqual(beforeCancel);

		await this._clickActivatableFeature(featureName);
		const confirmModal = this._visibleModal(/Chronological Interference/i);
		const first = confirmModal.locator("[data-role='first']");
		const second = confirmModal.locator("[data-role='second']");
		const firstOptions = await first.locator("option").evaluateAll(options => options.map(it => ({value: (it as HTMLOptionElement).value, text: it.textContent || ""})).filter(it => it.value));
		const secondOptions = await second.locator("option").evaluateAll(options => options.map(it => ({value: (it as HTMLOptionElement).value, text: it.textContent || ""})).filter(it => it.value));
		await first.selectOption(firstOptions[0].value);
		await second.selectOption(secondOptions.find(it => it.value !== firstOptions[0].value)!.value);
		await confirmModal.locator("[data-role='confirm']").click();
		await expect(confirmModal).toBeHidden();

		const afterConfirm = await this.page.evaluate(({resourceId}) => {
			const cs = (globalThis as any).charSheet;
			const latest = cs._rollHistory.getRolls()[0];
			return {
				order: cs._state.getCombatTurnOrder().map((it: any) => it.name),
				current: cs._state.getResources().find((it: any) => it.id === resourceId)?.current,
				bonusAction: cs._combat.isActionTypeAvailable("bonus"),
				latest,
			};
		}, {resourceId: setup!.resourceId});
		expect(afterConfirm.order).toEqual([...beforeCancel.order].reverse());
		expect(afterConfirm.current).toBe(beforeCancel.current - 1);
		expect(afterConfirm.bonusAction).toBe(false);
		expect(afterConfirm.latest).toMatchObject({title: featureName, total: "Swap"});
		expect(afterConfirm.latest.breakdown).toContain("Ancient Dragon");
		expect(afterConfirm.latest.breakdown).toContain("Clockwork Knight");

		await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			cs._state.endCombat();
			cs._renderCharacter?.();
		});
	}

	async probeTemporalManipulation (featureName: string): Promise<void> {
		const setup = await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			const resource = cs._state.getResources().find((it: any) => it.name === "Channel Divinity");
			if (!resource) return null;
			cs._state.setResourceCurrent(resource.id, resource.max);
			cs._state.startCombat();
			cs._combat._resetTurnActionUsage();
			cs._combat.render();
			cs._renderCharacter?.();
			return {resourceId: resource.id, current: resource.max, historyCount: cs._rollHistory.getRollCount()};
		});
		expect(setup, "Channel Divinity resource should exist").not.toBeNull();

		await this._clickActivatableFeature(featureName);
		const cancelModal = this._visibleModal(/Temporal Manipulation/i);
		await cancelModal.locator("[data-role='target']").fill("Cancelled Ogre");
		await cancelModal.locator("input[name='temporal-roll-mode'][value='advantage']").check();
		await cancelModal.locator("[data-role='cancel']").click();
		await expect(cancelModal).toBeHidden();
		const afterCancel = await this.page.evaluate(({resourceId}) => {
			const cs = (globalThis as any).charSheet;
			return {
				current: cs._state.getResources().find((it: any) => it.id === resourceId)?.current,
				reaction: cs._combat.isActionTypeAvailable("reaction"),
				historyCount: cs._rollHistory.getRollCount(),
			};
		}, {resourceId: setup!.resourceId});
		expect(afterCancel).toEqual({current: setup!.current, reaction: true, historyCount: setup!.historyCount});

		await this._clickActivatableFeature(featureName);
		const confirmModal = this._visibleModal(/Temporal Manipulation/i);
		await confirmModal.locator("[data-role='target']").fill("Ancient Dragon");
		await confirmModal.locator("input[name='temporal-roll-mode'][value='disadvantage']").check();
		await confirmModal.locator("[data-role='confirm']").click();
		await expect(confirmModal).toBeHidden();
		const afterConfirm = await this.page.evaluate(({resourceId}) => {
			const cs = (globalThis as any).charSheet;
			const latest = cs._rollHistory.getRolls()[0];
			return {
				current: cs._state.getResources().find((it: any) => it.id === resourceId)?.current,
				reaction: cs._combat.isActionTypeAvailable("reaction"),
				latest,
			};
		}, {resourceId: setup!.resourceId});
		expect(afterConfirm.current).toBe(setup!.current - 1);
		expect(afterConfirm.reaction).toBe(false);
		expect(afterConfirm.latest).toMatchObject({title: featureName, total: "Disadvantage"});
		expect(afterConfirm.latest.breakdown).toContain("Ancient Dragon");
		expect(afterConfirm.latest.breakdown.toLowerCase()).toContain("disadvantage");
	}

	async probeEyesOfFuturePast (featureName: string): Promise<void> {
		const setup = await this.page.evaluate(({featureName}) => {
			const cs = (globalThis as any).charSheet;
			const resource = cs._state.getResources().find((it: any) => it.name === featureName);
			if (!resource) return null;
			cs._state.setResourceCurrent(resource.id, resource.max);
			cs._state.startCombat();
			cs._combat._resetTurnActionUsage();
			cs._combat.render();
			cs._renderCharacter?.();
			return {resourceId: resource.id, current: resource.max};
		}, {featureName});
		expect(setup, `${featureName} resource should exist`).not.toBeNull();

		await this._clickActivatableFeature(featureName);
		const directionModal = this._visibleModal(/Eyes of the Future Past/i);
		await directionModal.locator("input[name='temporal-direction'][value='future']").check();
		await directionModal.locator("[data-role='confirm']").click();
		await expect(directionModal).toBeHidden();

		const active = await this.page.evaluate(({resourceId}) => {
			const cs = (globalThis as any).charSheet;
			return {
				current: cs._state.getResources().find((it: any) => it.id === resourceId)?.current,
				bonusAction: cs._combat.isActionTypeAvailable("bonus"),
				activeState: cs._state.getActiveStates().find((it: any) => it.stateTypeId === "eyesOfFuturePast" && it.active),
				conditions: cs._state.getConditionNames(),
			};
		}, {resourceId: setup!.resourceId});
		expect(active.current).toBe(setup!.current - 1);
		expect(active.bonusAction).toBe(false);
		expect(active.activeState.temporalView).toMatchObject({direction: "future", offsetHours: 1, roundDecision: null, decisionPending: false});
		expect(active.conditions.map((it: string) => it.toLowerCase())).toContain("blinded");

		await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			cs._state.advanceRound();
			cs._combat.render();
		});
		await this.switchToTab(this.tabCombat);
		const temporalCard = this.page.locator(".charsheet__combat-state-item").filter({hasText: /Eyes of the Future Past/i}).first();
		await expect(temporalCard).toContainText(/Future/i);
		await temporalCard.locator(".charsheet__temporal-hold").click();
		let decision = await this.page.evaluate(() => (globalThis as any).charSheet._state.getActiveStates().find((it: any) => it.stateTypeId === "eyesOfFuturePast" && it.active)?.temporalView);
		expect(decision).toMatchObject({offsetHours: 1, roundDecision: "hold", decisionPending: false});

		await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			cs._state.advanceRound();
			cs._combat.render();
		});
		await temporalCard.locator(".charsheet__temporal-advance").click();
		decision = await this.page.evaluate(() => (globalThis as any).charSheet._state.getActiveStates().find((it: any) => it.stateTypeId === "eyesOfFuturePast" && it.active)?.temporalView);
		expect(decision).toMatchObject({offsetHours: 2, roundDecision: "advance", decisionPending: false});

		await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			for (let i = 0; i < 8; i++) cs._state.advanceRound();
			cs._combat.render();
		});
		const expired = await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			return {
				activeState: cs._state.getActiveStates().find((it: any) => it.stateTypeId === "eyesOfFuturePast" && it.active) || null,
				conditions: cs._state.getConditionNames(),
			};
		});
		expect(expired.activeState).toBeNull();
		expect(expired.conditions.map((it: string) => it.toLowerCase())).not.toContain("blinded");
	}

	async probeTemporalMasteryAgeFlows (featureName: string): Promise<void> {
		await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			cs._state.setAppearance("age", "42");
			cs._renderCharacter?.();
		});

		await this.switchToTab(this.tabOverview);
		await this.page.locator("#charsheet-btn-long-rest").click({timeout: 5000});
		const restModal = this._visibleModal(/Long Rest/i);
		await restModal.locator("input[name='temporal-rest-age'][value='-1']").check();
		await restModal.locator("[data-role='age']").fill("42");
		await restModal.getByRole("button", {name: /Finish Long Rest/i}).click();
		await expect(restModal).toBeHidden();
		expect(await this.page.evaluate(() => (globalThis as any).charSheet._state.getNumericAge())).toBe(41);

		await this.switchToTab(this.tabFeatures);
		const utility = this._featureCard(featureName).locator(".charsheet__feature-utility");
		await utility.click();
		let agingModal = this._visibleModal(/Magical Aging/i);
		await agingModal.locator("[data-role='years']").fill("7");
		await agingModal.locator("input[name='magical-aging-resolution'][value='ignore']").check();
		await agingModal.locator("[data-role='confirm']").click();
		await expect(agingModal).toBeHidden();
		let result = await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			return {age: cs._state.getNumericAge(), latest: cs._rollHistory.getRolls()[0]};
		});
		expect(result.age).toBe(41);
		expect(result.latest).toMatchObject({title: `${featureName} — Magical Aging`, total: "Unaffected"});

		await utility.click();
		agingModal = this._visibleModal(/Magical Aging/i);
		await agingModal.locator("[data-role='years']").fill("7");
		await agingModal.locator("input[name='magical-aging-resolution'][value='accept']").check();
		await agingModal.locator("[data-role='confirm']").click();
		await expect(agingModal).toBeHidden();
		result = await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			return {age: cs._state.getNumericAge(), latest: cs._rollHistory.getRolls()[0]};
		});
		expect(result.age).toBe(48);
		expect(result.latest).toMatchObject({title: `${featureName} — Magical Aging`, total: "48 years"});
		expect(result.latest.breakdown).toContain("Age 41 → 48");

		const persistence = await this.page.evaluate(async () => {
			const cs = (globalThis as any).charSheet;
			for (const entry of cs._state.getCombatTurnOrder()) cs._state.removeCombatTurnOrderParticipant(entry.id);
			cs._state.upsertCombatTurnOrderParticipant({name: "Persistence Sentinel", initiative: 14});
			const saved = cs._state.toJson();
			cs._state.setAppearance("age", "99");
			for (const entry of cs._state.getCombatTurnOrder()) cs._state.removeCombatTurnOrderParticipant(entry.id);
			await cs._state.loadFromJson(saved);
			cs._renderCharacter?.();
			return {
				age: cs._state.getNumericAge(),
				turnOrder: cs._state.getCombatTurnOrder().map((it: any) => ({name: it.name, initiative: it.initiative})),
			};
		});
		expect(persistence).toEqual({age: 48, turnOrder: [{name: "Persistence Sentinel", initiative: 14}]});
	}

	/**
	 * Source-isolated EFA Cartographer scenarios. Each state-driven probe restores
	 * the character in a finally block so the feature matrix can safely revisit
	 * earlier rows at later checkpoints. The Atlas probe is deliberately separate:
	 * it drives the real Long Rest UI because creation/recreation is a player-facing
	 * rest transaction rather than a plain state mutation.
	 */
	async probeCartographerFlow (
		probe: "tools" | "toolPersistence" | "spells" | "atlas" | "mappingMagic" | "guidedPrecision" | "guidedPrecisionSpell" | "ingeniousMovement" | "superiorAtlas" | "lifecycle" | "lifecycleSpellCleanup" | "progression",
		spellThreshold?: 3 | 5 | 9 | 13 | 17,
	): Promise<void> {
		if (probe === "atlas") {
			await this._probeCartographerAtlasRestFlow();
			return;
		}

		await this.page.evaluate(async ({probe, spellThreshold}) => {
			const cs: any = (globalThis as any).charSheet;
			const state: any = cs?._state;
			if (!state) throw new Error("Cartographer probe: character state is unavailable");
			const original = state.toJson();
			const must = (condition: unknown, message: string) => {
				if (!condition) throw new Error(`Cartographer ${probe}: ${message}`);
			};
			const exactClass = () => state.getClasses().find((it: any) =>
				it.name === "Artificer"
				&& it.source === "EFA"
				&& it.subclass?.name === "Cartographer"
				&& it.subclass?.source === "EFA",
			);
			const ensureTools = () => {
				if (!state.getInventory().some((it: any) =>
					it.item?.name === "Cartographer's Tools" && it.item?.source === "XPHB")) {
					state.addItem({name: "Cartographer's Tools", source: "XPHB", type: "AT"}, 1);
				}
			};
			const createAtlas = (holders = [
				{name: state.getCharacterName() || "Mira", isSelf: true, status: "active"},
				{name: "Thorn", isSelf: false, status: "active"},
			]) => {
				ensureTools();
				const result = state.createAdventurersAtlas(holders, {
					isHoldingTools: true,
					createdAt: 1_700_000_000_000,
				});
				must(result?.ok, `could not create Atlas: ${JSON.stringify(result)}`);
				return result.atlas;
			};
			const findSpell = (name: string) => state.getSpells().find((it: any) =>
				String(it.name).toLowerCase() === name.toLowerCase()
				&& String(it.source).toUpperCase() === "XPHB",
			);
			const reset = () => {
				state.loadFromJson(original);
				cs?._renderCharacter?.();
			};

			try {
				must(exactClass(), "build is not Artificer|EFA / Cartographer|EFA");

				if (probe === "tools") {
					const feature = state.getFeatures().find((it: any) =>
						it.name === "Tools of the Trade"
						&& it.source === "EFA"
						&& it.classSource === "EFA"
						&& it.subclassSource === "EFA",
					);
					must(feature, "exact-source Tools of the Trade feature is missing");
					const proficiencies = state.getToolProficiencies().map((it: string) => it.toLowerCase());
					must(proficiencies.includes("calligrapher's supplies"), "Calligrapher's Supplies proficiency is missing");
					must(proficiencies.includes("cartographer's tools"), "Cartographer's Tools proficiency is missing");
					must(proficiencies.includes("alchemist's supplies"), "deterministic replacement tool proficiency is missing");
					must(!state.getPendingFeatureChoices().some((it: any) =>
						it.featureName === "Tools of the Trade" && it.kind === "tool"),
					"tool replacement choice was unresolved in-session");
					const featureUid = (globalThis as any).CharacterSheetState.getSourceAwareFeatureUid(feature);
					must(state.hasFulfilledFeatureToolChoice({featureUid}),
						"Tools of the Trade was not recorded as fulfilled");

					const classUtils: any = (globalThis as any).CharacterSheetClassUtils;
					const counts = [
						[],
						["Calligrapher's Supplies"],
						["Calligrapher's Supplies", "Cartographer's Tools"],
					].map(ownedTools => classUtils.getFixedProficiencyGrantContract(feature, {ownedTools}).count);
					must(JSON.stringify(counts) === JSON.stringify([0, 1, 2]), `replacement-tool counts were ${JSON.stringify(counts)}`);

					const scrollItem = {name: "Spell Scroll (Level 1)", source: "XDMG", type: "SC", spellScrollLevel: 1, rarity: "common"};
					const scrollRecipe = {
						name: scrollItem.name,
						source: scrollItem.source,
						recipeCategory: "scroll",
						itemType: scrollItem.type,
						rarity: scrollItem.rarity,
						itemUid: "spell scroll (level 1)|xdmg",
						ingredients: [],
						entries: [],
					};
					const scroll = state.getCraftingTimeCalculation({recipe: scrollRecipe, item: scrollItem});
					must(scroll?.baselineWorkweeks === 0.2 && scroll?.effectiveWorkweeks === 0.1 && scroll?.multiplier === 0.5,
						`Spell Scroll crafting descriptor was ${JSON.stringify(scroll)}`);
					must(scroll?.sourceBreakdown?.[0]?.uid === "Tools of the Trade|Artificer|EFA|Cartographer|EFA|3|EFA",
						`Spell Scroll owner was ${JSON.stringify(scroll?.sourceBreakdown)}`);

					const potionItem = {name: "Potion of Healing", source: "DMG", type: "P", rarity: "common"};
					const potionRecipe = {
						name: potionItem.name,
						source: potionItem.source,
						recipeCategory: "potion",
						itemType: potionItem.type,
						rarity: potionItem.rarity,
						itemUid: "potion of healing|dmg",
						ingredients: [],
						entries: [],
					};
					const potion = state.getCraftingTimeCalculation({recipe: potionRecipe, item: potionItem});
					must(potion?.multiplier === 1 && potion?.sourceBreakdown?.length === 0,
						`unrelated recipe was modified: ${JSON.stringify(potion)}`);
					return;
				}

				if (probe === "toolPersistence") {
					const saved = state.toJson();
					state.loadFromJson(saved);
					must(exactClass(), "exact EFA class/subclass identity did not round-trip");
					must(!state.getPendingFeatureChoices().some((it: any) =>
						it.featureName === "Tools of the Trade" && it.kind === "tool"),
					"tool replacement choices re-opened after round-trip");
					must(state.hasToolProficiency("Calligrapher's Supplies") && state.hasToolProficiency("Cartographer's Tools"),
						"fixed Cartographer tool proficiencies did not round-trip");
					must(state.hasToolProficiency("Alchemist's Supplies"),
						"replacement tool proficiency did not round-trip");
					return;
				}

				if (probe === "progression") {
					const levelHistory = state._data?.levelHistory || [];
					for (const level of [4, 8, 12, 16]) {
						const entry = levelHistory.find((it: any) => Number(it.level) === level);
						const asiDecision = entry?.decisions?.find((decision: any) => {
							if (decision.status !== "resolved") return false;
							const selection = decision.type === "asi"
								? decision.selection
								: decision.type === "asiOrFeat" && decision.selection?.mode === "asi"
									? decision.selection.asi
									: null;
							return selection
								&& Object.values(selection).reduce((total: number, value: any) => total + Number(value || 0), 0) === 2;
						});
						must(asiDecision, `level-${level} ASI decision was ${JSON.stringify(entry?.decisions)}`);
						if (level === 4) {
							const featDecision = entry?.decisions?.find((decision: any) =>
								decision.type === "feat"
								&& decision.status === "resolved"
								&& decision.selection?.name
								&& decision.selection?.source);
							must(featDecision, `level-4 companion feat decision was ${JSON.stringify(entry?.decisions)}`);
							const feat = (state._data?.feats || []).find((it: any) =>
								it.name === featDecision.selection.name
								&& it.source === featDecision.selection.source);
							must(feat && Object.keys(feat.appliedEffects || {}).length > 0,
								`level-4 feat ${featDecision.selection.name}|${featDecision.selection.source} lacks an applied effect ledger`);
						}
					}
					const level19 = levelHistory.find((entry: any) => Number(entry.level) === 19);
					const boonDecision = level19?.decisions?.find((decision: any) =>
						decision.type === "feat"
						&& decision.status === "resolved"
						&& decision.meta?.improvement?.categories?.includes("EB"),
					);
					must(boonDecision?.selection?.name && boonDecision?.selection?.source,
						`level-19 Epic Boon decision was ${JSON.stringify(boonDecision)}`);
					const boon = (state._data?.feats || []).find((feat: any) =>
						feat.name === boonDecision.selection.name
						&& feat.source === boonDecision.selection.source);
					must(boon, "resolved Epic Boon is absent from the owned feat list");
					must(Object.keys(boon.appliedEffects || {}).length > 0,
						`Epic Boon ${boon.name}|${boon.source} has no applied effect ledger`);
					return;
				}

				if (probe === "spells") {
					must(spellThreshold != null, "spell threshold was not supplied");
					const tiers: Record<number, string[]> = {
						3: ["Faerie Fire", "Guiding Bolt", "Healing Word"],
						5: ["Locate Object", "Mind Spike"],
						9: ["Call Lightning", "Clairvoyance"],
						13: ["Banishment", "Locate Creature"],
						17: ["Scrying", "Teleportation Circle"],
					};
					const expected = Object.entries(tiers)
						.filter(([level]) => Number(level) <= spellThreshold)
						.flatMap(([, names]) => names);
					for (const name of expected) {
						const matches = state.getSpells().filter((it: any) =>
							String(it.name).toLowerCase() === name.toLowerCase()
							&& String(it.source).toUpperCase() === "XPHB",
						);
						must(matches.length === 1, `${name}|XPHB count was ${matches.length}`);
						const spell = matches[0];
						must(spell.alwaysPrepared === true && spell.prepared === true, `${name}|XPHB is not always prepared`);
						must(spell.subclassSpellGrantOwners?.some((owner: any) =>
							owner.key === "artificer|efa|cartographer|efa"
							&& owner.sourceFeature === "Cartographer Spells"),
						`${name}|XPHB owner ledger was ${JSON.stringify(spell.subclassSpellGrantOwners)}`);
					}
					const card = state.getSpellcastingClassBreakdown().find((it: any) =>
						it.className === "Artificer" && it.classSource === "EFA");
					must(card, "Artificer|EFA spellcasting card is missing");
					must(card.spellsGranted >= expected.length, `granted count ${card.spellsGranted} < ${expected.length}`);
					must(card.spellsCount <= card.spellsMax, `chosen prepared count ${card.spellsCount} exceeds allowance ${card.spellsMax}`);

					const saved = state.toJson();
					state.loadFromJson(saved);
					for (const name of expected) {
						const spell = findSpell(name);
						must(spell?.subclassSpellGrantOwners?.some((owner: any) => owner.key === "artificer|efa|cartographer|efa"),
							`${name}|XPHB lost exact owner on round-trip`);
					}
					return;
				}

				if (probe === "mappingMagic") {
					createAtlas();
					const snapshot = state.getCartographerMappingMagicSnapshot();
					const intMod = state.getAbilityMod("int");
					must(snapshot.illuminatedCartography.usesMax === Math.max(1, intMod),
						`Illuminated Cartography uses ${snapshot.illuminatedCartography.usesMax}, INT mod ${intMod}`);
					must(snapshot.illuminatedCartography.spell.name === "Faerie Fire"
						&& snapshot.illuminatedCartography.spell.source === "XPHB"
						&& snapshot.illuminatedCartography.economy.type === "action"
						&& snapshot.illuminatedCartography.expendsSpellSlot === false
						&& snapshot.illuminatedCartography.requiresPreparation === false,
					`Illuminated Cartography contract was ${JSON.stringify(snapshot.illuminatedCartography)}`);
					const faerieFireData = cs?._spells?._allSpells?.find((it: any) =>
						it.name === "Faerie Fire" && it.source === "XPHB");
					must(faerieFireData?.time?.[0]?.unit === "action"
						&& faerieFireData?.duration?.some((it: any) => it.concentration === true),
					`Faerie Fire|XPHB action/concentration data was ${JSON.stringify(faerieFireData)}`);

					const slotsBefore = state.getSpellSlots()?.[1]?.current;
					const preparedBefore = state.getSpellcastingClassBreakdown()
						.find((it: any) => it.className === "Artificer" && it.classSource === "EFA")?.spellsCount;
					const cast = state.commitFeatureSpellCast("efa-cartographer:illuminated-cartography");
					must(cast?.ok && cast?.receipt?.spellUid === "faerie fire|xphb" && cast?.receipt?.actionType === "action",
						`feature cast failed: ${JSON.stringify(cast)}`);
					must(state.isActionTypeAvailable("action") === true,
						"out-of-combat feature cast stranded the action ledger");
					must(state.getSpellSlots()?.[1]?.current === slotsBefore, "feature cast consumed a spell slot");
					must(state.getSpellcastingClassBreakdown()
						.find((it: any) => it.className === "Artificer" && it.classSource === "EFA")?.spellsCount === preparedBefore,
					"feature cast changed the prepared allowance");
					must(state.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent
						=== snapshot.illuminatedCartography.usesCurrent - 1, "feature cast did not spend one use");
					state.onLongRest();
					must(state.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent
						=== snapshot.illuminatedCartography.usesMax, "Long Rest did not restore Illuminated Cartography");

					state.startCombat();
					state.resetTurnEconomy();
					const usesBeforeActionGate = state.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent;
					const ordinaryAction = state.commitActionEconomy("action", {trackOnlyInCombat: true});
					must(ordinaryAction?.ok && ordinaryAction?.tracked
						&& state.commitFeatureSpellCast("efa-cartographer:illuminated-cartography")?.ok === false
						&& state.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent === usesBeforeActionGate,
					"ordinary-spell action did not block the feature cast transactionally");
					state.resetTurnEconomy();
					const combatFeatureCast = state.commitFeatureSpellCast("efa-cartographer:illuminated-cartography");
					must(combatFeatureCast?.ok
						&& state.isActionTypeAvailable("action") === false
						&& state.commitActionEconomy("action", {trackOnlyInCombat: true})?.ok === false,
					"feature cast did not reserve the shared combat action ledger");
					state.endCombat();

					state.resetTurnEconomy();
					state.setSpeed("walk", 35);
					const jumpDirect = () => state.useCartographerPortalJump({
						destinationMode: "direct",
						confirmedVisible: true,
						confirmedWithin10Feet: true,
						confirmedUnoccupied: true,
					});
					const directOutOfCombat = jumpDirect();
					const repeatedOutOfCombat = jumpDirect();
					must(directOutOfCombat?.ok && repeatedOutOfCombat?.ok
						&& state.getMovementEconomyState().used === 0
						&& state.getMovementEconomyState().receipts.length === 0,
					`out-of-combat Portal Jump stranded movement: ${JSON.stringify({directOutOfCombat, repeatedOutOfCombat})}`);
					const afterOutOfCombatJumps = state.toJson();
					state.loadFromJson(afterOutOfCombatJumps);
					must(jumpDirect()?.ok && state.getMovementEconomyState().used === 0,
						"out-of-combat Portal Jump stranded movement after save/load");

					state.startCombat();
					const directInCombat = jumpDirect();
					must(directInCombat?.ok && state.getMovementEconomyState().used === 17,
						`Portal Jump did not spend floor(35/2) in combat: ${JSON.stringify(directInCombat)}`);
					state.resetTurnEconomy();
					must(state.getMovementEconomyState().used === 0, "canonical turn reset did not release Portal Jump movement");
					state.setSpeed("walk", 0);
					must(state.useCartographerPortalJump({destinationMode: "direct"})?.ok === false
						&& state.getMovementEconomyState().used === 0, "zero-Speed Portal Jump was not refused transactionally");
					state.setSpeed("walk", 30);
					state.spendMovement(20, {source: "e2e"});
					must(state.useCartographerPortalJump({destinationMode: "direct"})?.ok === false
						&& state.getMovementEconomyState().used === 20, "insufficient-movement Portal Jump mutated its ledger");

					state.resetTurnEconomy();
					const portalHolder = state.getCartographerPortalJumpState().destinations.holder.holders[0];
					const hiddenHolderJump = state.useCartographerPortalJump({
						destinationMode: "holder",
						holderId: portalHolder.id,
						confirmedVisible: false,
						confirmedHolderWithin30Feet: true,
						confirmedWithin5FeetOfHolder: true,
						confirmedUnoccupied: true,
					});
					must(hiddenHolderJump?.ok === false
						&& hiddenHolderJump?.reason === "portal-jump-confirmation-required"
						&& state.getMovementEconomyState().used === 0,
					`holder Portal Jump accepted a hidden destination: ${JSON.stringify(hiddenHolderJump)}`);
					const visibleHolderJump = state.useCartographerPortalJump({
						destinationMode: "holder",
						holderId: portalHolder.id,
						confirmedVisible: true,
						confirmedHolderWithin30Feet: true,
						confirmedWithin5FeetOfHolder: true,
						confirmedUnoccupied: true,
					});
					must(visibleHolderJump?.ok
						&& visibleHolderJump?.destination?.visible === true
						&& visibleHolderJump?.destination?.holder?.name === "Thorn",
					`visible holder Portal Jump failed: ${JSON.stringify(visibleHolderJump)}`);

					state.resetTurnEconomy();
					const descriptor = state.getTargetingExceptionDescriptors()[0];
					const holder = descriptor?.holders?.[0];
					must(descriptor?.bypass?.sight === true && descriptor?.bypass?.cover === true && descriptor?.bypass?.range === false,
						`Positioning bypass was ${JSON.stringify(descriptor?.bypass)}`);
					const positioning = state.resolveTargetingException({
						descriptorId: descriptor.id,
						targetHolderId: holder.id,
						effectRequiresSight: true,
						confirmedSamePlane: true,
						confirmedWithinRange: true,
						confirmedTargetEligibility: true,
					});
					must(positioning?.ok && positioning?.applies
						&& positioning?.preservedRequirements?.includes("range")
						&& positioning?.holder?.name === "Thorn",
					`Positioning resolution failed: ${JSON.stringify(positioning)}`);

					const atlas = state.getAdventurersAtlas();
					const self = atlas.holders.find((it: any) => it.isSelf);
					state.destroyAdventurersAtlasHolder(self.id);
					must(state.getCartographerMappingMagicSnapshot().positioning.available === false,
						"destroyed self map left Positioning available");
					return;
				}

				if (probe === "guidedPrecisionSpell") {
					state.startCombat();
					const intMod = state.getAbilityMod("int");
					const spellRider = state.getDeferredFlatDamageRiderOptions({
						route: "spell",
						spell: {name: "Guiding Bolt", source: "XPHB"},
					})[0];
					must(spellRider, "exact Cartographer spell route did not offer Guided Precision");
					const spellResult = state.consumeDeferredFlatDamageRider(spellRider);
					must(spellResult?.value === intMod, `spell rider value ${spellResult?.value} != INT mod ${intMod}`);
					must(state.getDeferredFlatDamageRiderOptions({route: "attack"}).length === 0,
						"attack route did not share the once-per-turn receipt");
					state.resetTurnEconomy();
					const attackRider = state.getDeferredFlatDamageRiderOptions({route: "attack"})[0];
					must(attackRider, "turn reset did not release Guided Precision");
					must(state.consumeDeferredFlatDamageRider(attackRider)?.value === intMod, "attack route used the wrong live INT modifier");
					must(state.getDeferredFlatDamageRiderOptions({
						route: "spell",
						spell: {name: "Mind Spike", source: "XPHB"},
					}).length === 0, "spell route did not share the attack receipt");
					must(state.getDeferredFlatDamageRiderOptions({
						route: "spell",
						spell: {name: "Faerie Fire", source: "PHB"},
					}).length === 0, "PHB Faerie Fire passed the XPHB source gate");
					must(state.getDeferredFlatDamageRiderOptions({
						route: "spell",
						spell: {name: "Fireball", source: "XPHB"},
					}).length === 0, "non-Cartographer spell passed the spell-list gate");
					return;
				}

				if (probe === "guidedPrecision") {
					const intMod = state.getAbilityMod("int");
					const outsideRider = state.getDeferredFlatDamageRiderOptions({route: "attack"})[0];
					const outsideResult = state.consumeDeferredFlatDamageRider(outsideRider);
					must(outsideResult?.value === intMod
						&& outsideResult?.turnReceipt == null
						&& state.getDeferredFlatDamageRiderOptions({route: "attack"}).length === 1,
					`Guided Precision stranded a noncombat receipt: ${JSON.stringify(outsideResult)}`);
					const outsideSaved = state.toJson();
					state.loadFromJson(outsideSaved);
					must(state.getDeferredFlatDamageRiderOptions({route: "attack"}).length === 1,
						"noncombat Guided Precision became unavailable after save/load");

					state.startCombat();
					state.consumeActionType("action");
					state.spendMovement(10, {source: "e2e:guided-precision"});
					const attackRider = state.getDeferredFlatDamageRiderOptions({route: "attack"})[0];
					must(attackRider?.requiresOwnSpellTargetUid === "faerie fire|xphb",
						`attack route did not require own Faerie Fire|XPHB: ${JSON.stringify(attackRider)}`);
					must(state.consumeDeferredFlatDamageRider(attackRider)?.value === intMod,
						"attack route used the wrong live INT modifier");
					must(state.getDeferredFlatDamageRiderOptions({route: "attack"}).length === 0,
						"attack route did not consume its once-per-turn receipt");
					const combatRound = state.getCombatRound();
					state.advanceTurnReceiptBoundary();
					const nextCreatureRider = state.getDeferredFlatDamageRiderOptions({route: "attack"})[0];
					must(state.getCombatRound() === combatRound
						&& state.isActionTypeAvailable("action") === false
						&& state.getMovementEconomyState().used === 10
						&& nextCreatureRider
						&& state.consumeDeferredFlatDamageRider(nextCreatureRider)?.value === intMod,
					"independent turn boundary did not release Guided Precision while preserving action/movement economy");
					state.resetTurnEconomy();
					must(state.isActionTypeAvailable("action") === true
						&& state.getMovementEconomyState().used === 0
						&& state.getDeferredFlatDamageRiderOptions({route: "attack"}).length === 1,
					"canonical Reset Turn did not release Guided Precision and reset turn economy");

					state.setConcentration({name: "Faerie Fire", source: "XPHB", level: 1});
					must(state.getDamageConcentrationProtection()?.spellUid === "faerie fire|xphb",
						"own Faerie Fire|XPHB lacks damage-only concentration protection");
					state.setConcentration({name: "Faerie Fire", source: "PHB", level: 1});
					must(state.getDamageConcentrationProtection() == null, "PHB Faerie Fire gained XPHB protection");
					state.setMaxHp(40);
					state.setCurrentHp(40);
					state.setConcentration({name: "Faerie Fire", source: "XPHB", level: 1});
					state.takeDamage(80);
					must(state.isDead(), "massive damage did not produce death");
					state.breakConcentration();
					must(state.getConcentration() == null, "death outcome was falsely protected from concentration loss");
					return;
				}

				if (probe === "ingeniousMovement") {
					state.startCombat();
					const resource = () => state.getResources().find((it: any) =>
						it.featureUid === "Flash of Genius|Artificer|EFA");
					const before = resource()?.current;
					must(Number.isFinite(before), "Flash of Genius resource is missing");
					const originalSave = cs._saveCurrentCharacter.bind(cs);
					const originalResolver = cs._pResolveEfaCartographerIngeniousMovement.bind(cs);
					const saveSnapshots: any[] = [];
					cs._saveCurrentCharacter = async () => {
						const saved = await originalSave();
						saveSnapshots.push({
							resource: resource()?.current,
							reactionAvailable: state.isActionTypeAvailable("reaction"),
						});
						return saved;
					};
					cs._pResolveEfaCartographerIngeniousMovement = async (committedFlashResult: any) => {
						must(saveSnapshots.length === 1
							&& saveSnapshots[0].resource === before - 1
							&& saveSnapshots[0].reactionAvailable === false,
						`Flash was not saved before Ingenious Movement: ${JSON.stringify(saveSnapshots)}`);
						return state.resolveEfaCartographerIngeniousMovement({
							committedFlashResult,
							targetType: "creature",
							targetName: "Thorn",
							targetWilling: true,
							targetVisible: true,
							targetDistanceFeet: 30,
							teleportDistanceFeet: 30,
							destinationVisible: true,
							destinationUnoccupied: true,
						});
					};
					let committed;
					try {
						committed = await cs._pCommitEfaFlashOfGenius({
							rollType: "savingThrow",
							isFailed: true,
							targetType: "self",
						});
					} finally {
						cs._saveCurrentCharacter = originalSave;
						cs._pResolveEfaCartographerIngeniousMovement = originalResolver;
					}
					const followUp = committed?.followUps?.[0]?.value;
					must(committed?.ok && committed?.committed && resource()?.current === before - 1
						&& state.isActionTypeAvailable("reaction") === false,
					`Flash commit was not atomic: ${JSON.stringify(committed)}`);
					must(followUp?.ok && followUp?.resolved && followUp?.target?.name === "Thorn"
						&& followUp?.teleport?.maxDistanceFeet === 30
						&& followUp?.teleport?.requiresExternalRelocation === true,
					`structured teleport follow-up was ${JSON.stringify(followUp)}`);

					reset();
					state.startCombat();
					const beforeDecline = resource()?.current;
					const declineSaveSnapshots: any[] = [];
					cs._saveCurrentCharacter = async () => {
						const saved = await originalSave();
						declineSaveSnapshots.push({
							resource: resource()?.current,
							reactionAvailable: state.isActionTypeAvailable("reaction"),
						});
						return saved;
					};
					cs._pResolveEfaCartographerIngeniousMovement = async (flash: any) => {
						must(declineSaveSnapshots.length === 1
							&& declineSaveSnapshots[0].resource === beforeDecline - 1
							&& declineSaveSnapshots[0].reactionAvailable === false,
						`declined Flash was not saved before Ingenious Movement: ${JSON.stringify(declineSaveSnapshots)}`);
						return state.resolveEfaCartographerIngeniousMovement({committedFlashResult: flash, declined: true});
					};
					let declined;
					try {
						declined = await cs._pCommitEfaFlashOfGenius({
							rollType: "abilityCheck",
							isFailed: true,
							targetType: "self",
						});
					} finally {
						cs._saveCurrentCharacter = originalSave;
						cs._pResolveEfaCartographerIngeniousMovement = originalResolver;
					}
					must(declined?.ok && declined?.committed
						&& declined?.followUps?.[0]?.value?.declined === true
						&& resource()?.current === beforeDecline - 1
						&& state.isActionTypeAvailable("reaction") === false,
					`declined follow-up refunded or failed to commit Flash: ${JSON.stringify(declined)}`);
					return;
				}

				if (probe === "superiorAtlas") {
					createAtlas();
					const artificerLevel = exactClass().level;
					state.setMaxHp(40);
					state.setCurrentHp(40);
					const atlas = state.getAdventurersAtlas();
					const self = atlas.holders.find((it: any) => it.isSelf);
					const ally = atlas.holders.find((it: any) => !it.isSelf);
					state.takeDamage(40);
					const safeHavenId = (globalThis as any).CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID;
					const safeHaven = state.applyZeroHpIntervention(safeHavenId, {
						destroyedAt: 1_700_000_040_000,
					});
					must(safeHaven?.applied && safeHaven?.committed && safeHaven?.hp === artificerLevel * 2,
						`Safe Haven result was ${JSON.stringify(safeHaven)}`);
					must(state.getCurrentHp() === artificerLevel * 2, "Safe Haven HP did not reach the sheet");
					must(state.getAdventurersAtlas().holders.find((it: any) => it.id === self.id)?.status === "destroyed",
						"Safe Haven did not destroy the exact self map");
					must(state.getAdventurersAtlas().holders.find((it: any) => it.id === ally.id)?.status === "active",
						"Safe Haven destroyed an unrelated external map");
					must(safeHaven?.postApplication?.teleport?.status === "requires-placement"
						&& safeHaven?.postApplication?.teleport?.maxDistanceFeet === 5
						&& safeHaven?.postApplication?.teleport?.anchors?.some((anchor: any) =>
							anchor.kind === "cartographer"
							&& anchor.name === state.getCharacterName()
							&& anchor.isActiveMapHolder === false)
						&& safeHaven?.postApplication?.teleport?.anchors?.some((anchor: any) =>
							anchor.kind === "activeMapHolder"
							&& anchor.name === "Thorn"
							&& anchor.isActiveMapHolder === true),
					`Safe Haven placement contract was ${JSON.stringify(safeHaven?.postApplication?.teleport)}`);

					reset();
					createAtlas();
					const selfOnlyAtlas = state.getAdventurersAtlas();
					const selfOnlyMap = selfOnlyAtlas.holders.find((it: any) => it.isSelf);
					const externalMap = selfOnlyAtlas.holders.find((it: any) => !it.isSelf);
					state.destroyAdventurersAtlasHolder(externalMap.id);
					state.setMaxHp(40);
					state.setCurrentHp(40);
					state.takeDamage(40);
					const selfOnlySafeHaven = state.applyZeroHpIntervention(safeHavenId, {
						destroyedAt: 1_700_000_040_001,
					});
					const selfOnlyAnchors = selfOnlySafeHaven?.postApplication?.teleport?.anchors || [];
					must(selfOnlySafeHaven?.applied
						&& selfOnlySafeHaven?.consumption?.holderId === selfOnlyMap.id
						&& selfOnlyAnchors.length === 1
						&& selfOnlyAnchors[0]?.kind === "cartographer"
						&& selfOnlyAnchors[0]?.holderId === null
						&& selfOnlyAnchors[0]?.name === state.getCharacterName()
						&& selfOnlyAnchors[0]?.isActiveMapHolder === false,
					`self-only Safe Haven lost the Cartographer anchor: ${JSON.stringify(selfOnlySafeHaven)}`);

					reset();
					createAtlas([
						{name: "Thorn", isSelf: false, status: "active"},
						{name: "Vey", isSelf: false, status: "active"},
					]);
					const thorn = state.getAdventurersAtlas().holders.find((it: any) => it.name === "Thorn");
					const external = state.resolveAdventurersAtlasSafeHavenForExternalHolder(thorn.id, {
						confirmedReducedToZero: true,
						killedOutright: false,
						destroyedAt: 1_700_000_040_000,
					});
					must(external?.ok && external?.committed && external?.hp === artificerLevel * 2
						&& external?.postApplication?.teleport?.applied === false,
					`external-holder resolver was ${JSON.stringify(external)}`);
					must(JSON.stringify(external).includes("requires-placement"), "external resolver did not surface placement requirements");

					reset();
					createAtlas();
					state.setMaxHp(40);
					state.setCurrentHp(40);
					const massiveSelf = state.getAdventurersAtlas().holders.find((it: any) => it.isSelf);
					state.takeDamage(80);
					must(state.isDead() && state.getPendingZeroHpIntervention() == null,
						"Safe Haven was offered after killed-outright damage");
					must(state.getAdventurersAtlas().holders.find((it: any) => it.id === massiveSelf.id)?.status === "active",
						"killed-outright damage consumed the self map");

					reset();
					createAtlas();
					const unerring = state.getCartographerMappingMagicSnapshot().unerringPath;
					const findThePathData = cs?._spells?._allSpells?.find((it: any) =>
						it.name === "Find the Path" && it.source === "XPHB");
					must(unerring?.available && unerring?.usesCurrent === 1
						&& unerring?.spell?.name === "Find the Path"
						&& unerring?.spell?.source === "XPHB"
						&& unerring?.expendsSpellSlot === false
						&& unerring?.requiresPreparation === false
						&& JSON.stringify(unerring?.componentWaivers) === JSON.stringify(["v", "s", "m"])
						&& unerring?.economy?.label === "1 minute",
					`Unerring Path contract was ${JSON.stringify(unerring)}`);
					must(findThePathData?.time?.[0]?.unit === "minute"
						&& findThePathData?.duration?.some((it: any) => it.concentration === true),
					`Find the Path|XPHB cast semantics were ${JSON.stringify(findThePathData)}`);
					const unerringCast = state.commitFeatureSpellCast("efa-cartographer:unerring-path");
					must(unerringCast?.ok && state.getCartographerMappingMagicSnapshot().unerringPath.usesCurrent === 0,
						`Unerring Path cast failed: ${JSON.stringify(unerringCast)}`);
					state.onLongRest();
					must(state.getCartographerMappingMagicSnapshot().unerringPath.usesCurrent === 1,
						"Long Rest did not restore Unerring Path");
					return;
				}

				if (probe === "lifecycleSpellCleanup") {
					const saved = state.toJson();
					state.setSubclass("Artificer", {name: "Armorer", shortName: "Armorer", source: "EFA"});
					const swappedFaerieFire = findSpell("Faerie Fire");
					must(!swappedFaerieFire,
						`subclass swap retained Faerie Fire|XPHB: ${JSON.stringify(swappedFaerieFire)}`);
					state.loadFromJson(saved);
					return;
				}

				if (probe === "lifecycle") {
					createAtlas();
					state.commitFeatureSpellCast("efa-cartographer:illuminated-cartography");
					const saved = state.toJson();
					const level = exactClass().level;

					state.addClass({
						name: "Artificer",
						source: "EFA",
						level: 2,
						subclass: {name: "Cartographer", shortName: "Cartographer", source: "EFA"},
					});
					must(state.getCartographerMappingMagicSnapshot().illuminatedCartography.available === false
						&& state.getAdventurersAtlas().invalidatedReason === "subclass-removed",
					"level drop did not tear down Cartographer state");

					state.loadFromJson(saved);
					state.setSubclass("Artificer", {name: "Armorer", shortName: "Armorer", source: "EFA"});
					const swappedSnapshot = state.getCartographerMappingMagicSnapshot();
					const swappedAtlas = state.getAdventurersAtlas();
					must(swappedSnapshot.illuminatedCartography.available === false,
						`subclass swap left Mapping Magic available: ${JSON.stringify(swappedSnapshot.illuminatedCartography)}`);
					must(swappedAtlas.invalidatedReason === "subclass-removed",
						`subclass swap left Atlas valid: ${JSON.stringify(swappedAtlas)}`);
					must(state.getAdventurersAtlasSafeHavenAvailability()?.available === false,
						"non-Cartographer subclass retained Safe Haven availability");

					state.loadFromJson(saved);
					state.setSubclass("Artificer", {name: "Cartographer", shortName: "Cartographer", source: "TCE"});
					must(state.getCartographerMappingMagicSnapshot().illuminatedCartography.available === false,
						"same-label TCE subclass passed the EFA source gate");

					state.loadFromJson(saved);
					state.removeClass("Artificer", "EFA");
					state.addClass({
						name: "Artificer",
						source: "TCE",
						level,
						subclass: {name: "Cartographer", shortName: "Cartographer", source: "EFA"},
					});
					must(state.getCartographerMappingMagicSnapshot().illuminatedCartography.available === false,
						"TCE Artificer passed the EFA class-source gate");

					state.loadFromJson(saved);
					must(exactClass() && findSpell("Faerie Fire")?.subclassSpellGrantOwners?.some((owner: any) =>
						owner.key === "artificer|efa|cartographer|efa"),
					"export round-trip lost EFA identity or spell ownership");
					must(state.getCartographerMappingMagicSnapshot().castReceipts.some((it: any) =>
						it.spellUid === "faerie fire|xphb"),
					"export round-trip lost the exact feature-cast receipt");
					return;
				}

				throw new Error(`Unknown Cartographer probe "${probe}"`);
			} finally {
				reset();
			}
		}, {probe, spellThreshold});
	}

	private async _probeCartographerAtlasRestFlow (): Promise<void> {
		const original = await this.page.evaluate(() => (globalThis as any).charSheet?._state?.toJson?.());
		if (!original) throw new Error("Cartographer Atlas probe: could not snapshot character");

		try {
			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				cs._state.addItem({name: "Cartographer's Tools", source: "PHB", type: "AT"}, 1);
				cs.openAdventurersAtlasLongRest();
			});
			let modal = this.page.locator(".ve-ui-modal__inner:visible").filter({hasText: /Long Rest/i}).last();
			await expect(modal.locator(".charsheet__atlas-rest")).toBeVisible();
			await expect(modal.locator(".charsheet__atlas-rest-modes input[value='create']")).toBeDisabled();
			await modal.getByRole("button", {name: "Cancel"}).click({timeout: 10_000});
			await expect(modal).toBeHidden();

			await this.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				cs._state.addItem({name: "Cartographer's Tools", source: "XPHB", type: "AT"}, 1);
				cs.openAdventurersAtlasLongRest();
			});
			modal = this.page.locator(".ve-ui-modal__inner:visible").filter({hasText: /Long Rest/i}).last();
			await expect(modal.locator(".charsheet__atlas-rest")).toBeVisible({timeout: 10_000});
			await modal.locator(".charsheet__atlas-rest-modes input[value='create']").check({timeout: 10_000});
			await modal.locator(".charsheet__atlas-rest-held input").check({timeout: 10_000});
			await modal.locator(".charsheet__atlas-rest-self-choice input").check({timeout: 10_000});
			const holderRows = modal.locator(".charsheet__atlas-rest-holder");
			await holderRows.nth(1).getByRole("button", {name: /Remove ally holder/i}).click({timeout: 10_000});
			await holderRows.first().locator("input").fill("Thorn", {timeout: 10_000});
			await expect(modal.locator(".charsheet__atlas-rest-feedback")).toContainText(/Ready: 2 active maps/i);
			await modal.getByRole("button", {name: /Finish Long Rest/i}).click({timeout: 10_000});
			await expect(modal).toBeHidden();

			const created = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet._state;
				const atlas = state.getAdventurersAtlas();
				return {
					atlas,
					capacity: state.getAdventurersAtlasCapacity(),
					initiative: state.getRollBonusDice("initiative"),
					integration: state.getAdventurersAtlasIntegrationSnapshot(),
				};
			});
			expect(created.atlas).toMatchObject({
				generation: 1,
				holders: [
					expect.objectContaining({name: "Mira Wayfinder", isSelf: true, status: "active"}),
					expect.objectContaining({name: "Thorn", isSelf: false, status: "active"}),
				],
			});
			expect(created.atlas.capacityAtCreation).toBe(created.capacity);
			expect(created.initiative).toEqual([{
				dice: "1d4",
				sign: 1,
				source: "Adventurer's Atlas — Awareness",
			}]);
			expect(created.integration.holders.find((it: any) => it.name === "Thorn")?.initiativeDie).toBe("1d4");

			await this.switchToTab(this.tabFeatures);
			const card = this.page.locator(".charsheet__atlas-card");
			await expect(card).toBeVisible();
			await expect(card).toContainText(/Active/);
			await expect(card).toContainText(/Mira Wayfinder/);
			await expect(card).toContainText(/Thorn/);
			await expect(card).toContainText(/1d4 to Initiative/);

			await this.page.evaluate(() => (globalThis as any).charSheet.openAdventurersAtlasLongRest());
			modal = this.page.locator(".ve-ui-modal__inner:visible").filter({hasText: /Long Rest/i}).last();
			await expect(modal.locator(".charsheet__atlas-rest")).toBeVisible({timeout: 10_000});
			await modal.locator(".charsheet__atlas-rest-modes input[value='recreate']").check({timeout: 10_000});
			await modal.locator(".charsheet__atlas-rest-held input").check({timeout: 10_000});
			await modal.locator(".charsheet__atlas-rest-holder input").first().fill("Vey", {timeout: 10_000});
			await expect(modal.locator(".charsheet__atlas-rest-feedback")).toContainText(/Ready: 2 active maps/i);
			await modal.getByRole("button", {name: /Finish Long Rest/i}).click({timeout: 10_000});
			await expect(modal).toBeHidden();
			const recreated = await this.page.evaluate(() => {
				const atlas = (globalThis as any).charSheet._state.getAdventurersAtlas();
				return {generation: atlas.generation, holders: atlas.holders.map((it: any) => it.name)};
			});
			expect(recreated).toEqual({generation: 2, holders: ["Mira Wayfinder", "Vey"]});

			await this.switchToTab(this.tabOverview);
			await this.page.locator("#charsheet-btn-undo-rest").click({timeout: 10_000});
			const undone = await this.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet._state;
				const beforeRoundTrip = state.getAdventurersAtlas();
				const saved = state.toJson();
				state.loadFromJson(saved);
				const afterRoundTrip = state.getAdventurersAtlas();
				const allyOnly = state.recreateAdventurersAtlas([
					{name: "Thorn", isSelf: false, status: "active"},
					{name: "Vey", isSelf: false, status: "active"},
				], {isHoldingTools: true});
				return {
					beforeRoundTrip,
					afterRoundTrip,
					allyOnlyOk: allyOnly.ok,
					allyOnlySelfDie: state.getAdventurersAtlasInitiativeDie(),
					allyOnlySheetDice: state.getRollBonusDice("initiative"),
					allyOnlyExternalDice: state.getAdventurersAtlasIntegrationSnapshot().holders.map((it: any) => it.initiativeDie),
				};
			});
			expect(undone.beforeRoundTrip.generation).toBe(1);
			expect(undone.beforeRoundTrip.holders.map((it: any) => it.name)).toEqual(["Mira Wayfinder", "Thorn"]);
			expect(undone.afterRoundTrip).toEqual(undone.beforeRoundTrip);
			expect(undone.allyOnlyOk).toBe(true);
			expect(undone.allyOnlySelfDie).toBeNull();
			expect(undone.allyOnlySheetDice).toEqual([]);
			expect(undone.allyOnlyExternalDice).toEqual(["1d4", "1d4"]);
		} finally {
			await this.page.evaluate((saved) => {
				const cs: any = (globalThis as any).charSheet;
				cs?._state?.loadFromJson?.(saved);
				cs?._renderCharacter?.();
			}, original);
			await this.dismissTransientModals();
		}
	}

	/**
	 * Spawn a character in-memory via `window.charSheet.spawn` (the fast test-setup path — see
	 * `spawn.spec.ts`) and assert the spawn left nothing unresolved.
	 */
	async spawnCharacter (spec: string): Promise<void> {
		const result = await this.page.evaluate(async (spawnSpec) => {
			const cs = (globalThis as any).charSheet;
			const report = await cs.spawn(spawnSpec, {save: false});
			return {unresolved: report.unresolved, unhandledPrompts: report.unhandledPrompts};
		}, spec);
		expect(result.unresolved, `spawn(${spec}) left choices unresolved`).toEqual([]);
		expect(result.unhandledPrompts, `spawn(${spec}) opened an unhandled prompt`).toEqual([]);
	}
}

// ──────────────────────────────────────────────────────────────────
//  Phase-7 effective-stats snapshot type (exported for helpers)
// ──────────────────────────────────────────────────────────────────

export interface EffectiveStatsSnapshot {
	ac: number;
	spellSaveDc: number;
	walkSpeed: number;
	init: number;
	abilityScores: Record<string, number>;
	abilityMods: Record<string, number>;
	saveMods: Record<string, number>;
	skillBonuses: Record<string, number>;
	resistances: string[];
	immunities: string[];
}
