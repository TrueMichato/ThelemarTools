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
	 * Activate a toggleable feature by name (e.g. "Bladesong", "Hexblade's Curse").
	 */
	async activateFeature (featureName: string): Promise<void> {
		await this.switchToTab(this.tabFeatures);
		const toggle = this.page
			.locator(".charsheet__feature-toggle, [data-testid='feature-toggle']")
			.filter({hasText: featureName});
		const btn = toggle.locator("button, .charsheet__feature-toggle-btn").first();
		// Hard timeout: missing toggle must fail fast, not hang the whole test.
		// (Helps us cleanly distinguish "feature not toggleable" from
		// "general infra wedge" in triage.)
		try {
			await btn.waitFor({state: "visible", timeout: 5000});
		} catch (e) {
			throw new Error(`activateFeature(${featureName}): no visible toggle button within 5s. Feature may be passive on the sheet — see docs/charactersheet/known-bugs.md.`);
		}
		await btn.click({timeout: 5000});
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
	 * Bounded: returns {current: -1, max: -1} if the resource isn't rendered within 2s.
	 */
	async getResource (resourceName: string): Promise<{current: number; max: number}> {
		const container = this.page
			.locator(".charsheet__resource-row, .charsheet__resource-tracker, [data-testid='resource-tracker']")
			.filter({hasText: resourceName})
			.first();
		// Hard 2s presence check — missing resources must NOT hang the
		// test budget on retried `.inputValue()` waits.
		const present = await container.waitFor({state: "attached", timeout: 2000}).then(() => true).catch(() => false);
		if (!present) return {current: -1, max: -1};
		const currentEl = container.locator(".charsheet__resource-current, input").first();
		const maxEl = container.locator(".charsheet__resource-max").first();

		const currentText = await currentEl.inputValue({timeout: 2000})
			.catch(() => currentEl.textContent({timeout: 2000}).catch(() => "0"));
		const maxText = await maxEl.textContent({timeout: 2000}).catch(() => "0");

		const parseNum = (s: string | null | undefined) => {
			if (!s) return 0;
			const m = String(s).match(/-?\d+/);
			return m ? parseInt(m[0], 10) : 0;
		};

		return {current: parseNum(currentText as string), max: parseNum(maxText)};
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
		return m ? parseInt(m[0], 10) : 0;
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
	 */
	async useResourceByName (resourceName: string, amount = 1): Promise<{ok: boolean; remaining: number}> {
		const ok = await this.page.evaluate(({name, n}) => {
			const cs: any = (globalThis as any).charSheet;
			if (!cs?._state?.useResourceCharge) return false;
			const result = cs._state.useResourceCharge(name, n);
			cs._renderCharacter?.();
			return !!result;
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
	async clickAttackRoll (attackName: string): Promise<boolean> {
		await this.switchToTab(this.tabCombat);
		const item = this.page.locator(".charsheet__attack-item")
			.filter({hasText: new RegExp(attackName, "i")})
			.first();
		if (await item.count() === 0) return false;
		const rollBtn = item.locator(".charsheet__attack-roll").first();
		if (await rollBtn.count() === 0) return false;
		await rollBtn.click({timeout: 5000}).catch(() => null);
		await this.page.waitForTimeout(150);
		return true;
	}

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

	/** List the resource names rendered on the sheet. */
	async getResourceNames (): Promise<string[]> {
		const els = this.page.locator(".charsheet__resource-row .charsheet__resource-name, .charsheet__resource-tracker .charsheet__resource-name");
		const count = await els.count();
		const out: string[] = [];
		for (let i = 0; i < count; i++) {
			const t = await els.nth(i).textContent({timeout: 500}).catch(() => null);
			if (t && t.trim()) out.push(t.trim());
		}
		return out;
	}
}
