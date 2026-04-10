import {Locator, Page, expect} from "@playwright/test";
import {waitForToolsLoaded} from "../utils/waitHelpers";

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

	async goto (): Promise<void> {
		await this.page.goto("/charactersheet.html");
		await waitForToolsLoaded(this.page);
	}

	async switchToTab (tab: Locator): Promise<void> {
		await tab.click();
		await this.page.waitForTimeout(100);
	}

	// ========== ABILITY SCORES ==========

	async getAbilityScore (ability: "str" | "dex" | "con" | "int" | "wis" | "cha"): Promise<number> {
		const scoreEl = this.page.locator(`#charsheet-ability-${ability}-score`);
		const text = await scoreEl.textContent();
		return parseInt(text || "10", 10);
	}

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

	async setCurrentHp (hp: number): Promise<void> {
		await this.hpCurrent.fill(String(hp));
		await this.hpCurrent.press("Enter");
		await this.page.waitForTimeout(100);
	}

	// ========== COMBAT STATS ==========

	async getAC (): Promise<number> {
		const text = await this.dispAC.textContent();
		return parseInt(text || "10", 10);
	}

	async getInitiative (): Promise<string> {
		const text = await this.dispInitiative.textContent();
		return text || "+0";
	}

	async getSpeed (): Promise<number> {
		const text = await this.dispSpeed.textContent();
		return parseInt(text || "30", 10);
	}

	// ========== CONDITIONS ==========

	async getConditionBadges (): Promise<string[]> {
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
		const badge = this.conditionsContainer.locator(".charsheet__condition-badge").filter({hasText: conditionText});
		const removeBtn = badge.locator(".charsheet__condition-remove, .glyphicon-remove");
		await removeBtn.click();
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

	/**
	 * Get all feature toggle buttons (activatable features) on the Features tab.
	 */
	async getActivatableFeatureNames (): Promise<string[]> {
		await this.switchToTab(this.tabFeatures);
		const toggles = this.page.locator(".charsheet__feature-toggle, [data-testid='feature-toggle']");
		const count = await toggles.count();
		const names: string[] = [];
		for (let i = 0; i < count; i++) {
			const text = await toggles.nth(i)
				.locator(".charsheet__feature-toggle-name, .charsheet__feature-name")
				.first()
				.textContent();
			if (text) names.push(text.trim());
		}
		return names;
	}

	/**
	 * Activate a toggleable feature by name (e.g. "Bladesong", "Hexblade's Curse").
	 */
	async activateFeature (featureName: string): Promise<void> {
		await this.switchToTab(this.tabFeatures);
		const toggle = this.page
			.locator(".charsheet__feature-toggle, [data-testid='feature-toggle']")
			.filter({hasText: featureName});
		const btn = toggle.locator("button, .charsheet__feature-toggle-btn").first();
		await btn.click();
		await this.page.waitForTimeout(200);
	}

	/**
	 * Deactivate a toggleable feature by name.
	 */
	async deactivateFeature (featureName: string): Promise<void> {
		await this.activateFeature(featureName); // toggle off
	}

	/**
	 * Check whether a feature is currently active (has "active" class or aria attribute).
	 */
	async isFeatureActive (featureName: string): Promise<boolean> {
		await this.switchToTab(this.tabFeatures);
		const toggle = this.page
			.locator(".charsheet__feature-toggle, [data-testid='feature-toggle']")
			.filter({hasText: featureName});
		const hasActive = await toggle.evaluate(el => {
			return el.classList.contains("active")
				|| el.querySelector(".active") !== null
				|| el.getAttribute("aria-pressed") === "true";
		});
		return hasActive;
	}

	// ========== TGTT — RESOURCE TRACKERS ==========

	/**
	 * Get the current/max value of a named resource (e.g. "Sorcery Points", "Stamina").
	 */
	async getResource (resourceName: string): Promise<{current: number; max: number}> {
		const container = this.page
			.locator(".charsheet__resource-tracker, [data-testid='resource-tracker']")
			.filter({hasText: resourceName});
		const currentEl = container.locator(".charsheet__resource-current, input").first();
		const maxEl = container.locator(".charsheet__resource-max").first();

		const currentText = await currentEl.inputValue().catch(() => currentEl.textContent());
		const maxText = await maxEl.textContent();

		return {
			current: parseInt(String(currentText) || "0", 10),
			max: parseInt(maxText || "0", 10),
		};
	}

	// ========== TGTT — COMBAT TAB DCs ==========

	/**
	 * Read the spell save DC displayed on the Combat tab.
	 */
	async getSpellSaveDC (): Promise<number> {
		await this.switchToTab(this.tabCombat);
		const dcEl = this.page.locator("#charsheet-disp-spell-save-dc, .charsheet__spell-dc-value").first();
		const text = await dcEl.textContent();
		return parseInt(text || "0", 10);
	}

	/**
	 * Read the combat method DC (if Combat Methods are active).
	 */
	async getCombatMethodDC (): Promise<number> {
		await this.switchToTab(this.tabCombat);
		const dcEl = this.page.locator("#charsheet-disp-combat-method-dc, .charsheet__combat-dc-value").first();
		const text = await dcEl.textContent();
		return parseInt(text || "0", 10);
	}

	// ========== TGTT — SPELL SLOTS DISPLAY ==========

	/**
	 * Get the displayed spell slot counts {current, max} for a given level.
	 */
	async getSpellSlots (level: number): Promise<{current: number; max: number}> {
		await this.switchToTab(this.tabSpells);
		const slotContainer = this.page.locator(
			`[data-spell-level="${level}"], .charsheet__spell-slot-level-${level}`,
		);
		const currentEl = slotContainer.locator(".charsheet__slot-current, input").first();
		const maxEl = slotContainer.locator(".charsheet__slot-max").first();

		const currentText = await currentEl.inputValue().catch(() => currentEl.textContent());
		const maxText = await maxEl.textContent();

		return {
			current: parseInt(String(currentText) || "0", 10),
			max: parseInt(maxText || "0", 10),
		};
	}

	/**
	 * Read a pact slot display (for Warlocks).
	 */
	async getPactSlots (): Promise<{current: number; max: number; level: number}> {
		await this.switchToTab(this.tabSpells);
		const pactContainer = this.page.locator(".charsheet__pact-slots, [data-testid='pact-slots']");
		const currentEl = pactContainer.locator(".charsheet__slot-current, input").first();
		const maxEl = pactContainer.locator(".charsheet__slot-max").first();
		const levelEl = pactContainer.locator(".charsheet__pact-level").first();

		const currentText = await currentEl.inputValue().catch(() => currentEl.textContent());
		const maxText = await maxEl.textContent();
		const levelText = await levelEl.textContent();

		return {
			current: parseInt(String(currentText) || "0", 10),
			max: parseInt(maxText || "0", 10),
			level: parseInt(levelText || "0", 10),
		};
	}

	async getSubclassChoice (className: string): Promise<{key: string; name: string} | null> {
		return this.page.evaluate(clsName => {
			return globalThis.charSheet?._state?.getSubclassChoice?.(clsName) || null;
		}, className);
	}

	async getKnownSpellNames (): Promise<string[]> {
		return this.page.evaluate(() => {
			const state = globalThis.charSheet?._state;
			if (!state?.getKnownSpells) return [];
			return state.getKnownSpells().map(spell => spell.name);
		});
	}
}
