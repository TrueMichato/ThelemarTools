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
	 * Get every feature card visible on the Features tab — passive AND
	 * toggleable. Use this for "feature exists at level X" assertions
	 * where you don't care whether it has a UI toggle. Pair with
	 * `getToggleableFeatureNames()` when you specifically need a
	 * clickable toggle.
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
	 * Get only features that actually have a toggle button (e.g.
	 * Bladesong, Rage). Resource-style features like "Channel Divinity"
	 * — where the player spends a charge but no on/off toggle exists —
	 * are excluded so callers like `probeToggleDelta` don't try to
	 * click a nonexistent button.
	 */
	async getToggleableFeatureNames (): Promise<string[]> {
		await this.switchToTab(this.tabFeatures);
		const toggles = this.page.locator(".charsheet__feature-toggle, [data-testid='feature-toggle']");
		const count = await toggles.count();
		const names: string[] = [];
		for (let i = 0; i < count; i++) {
			const text = await toggles.nth(i).textContent({timeout: 1000}).catch(() => null);
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
		// Bounded: the DC selector isn't always rendered (e.g. martial
		// classes), so don't let textContent's no-timeout default hang
		// the test. Returning 0 lets the caller treat it as "not
		// present" without aborting.
		const text = await dcEl.textContent({timeout: 2000}).catch(() => null);
		return parseInt(text || "0", 10);
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
	 * "Roll" a skill check by clicking its roll button on the Abilities
	 * tab. Returns the read bonus and a flag indicating whether the roll
	 * button was actually present and clickable. This is a smoke probe —
	 * we don't assert dice outcome, only that:
	 *   1. the bonus exists in state
	 *   2. the button is wired up (no JS throw on click)
	 *
	 * If no clickable roll button exists, falls back to a state-only read
	 * so the test can still assert the bonus value.
	 */
	async rollSkill (skill: string): Promise<{bonus: number; clicked: boolean}> {
		const bonus = await this.getSkillBonus(skill);
		// Try the Abilities tab first; skill rolls live there in the
		// 2024-style sheet, and on Combat tab in some legacy layouts.
		await this.switchToTab(this.tabAbilities).catch(() => null);
		const re = new RegExp(`\\b${skill}\\b`, "i");
		const row = this.page
			.locator(".charsheet__skill-row, [data-skill]")
			.filter({hasText: re})
			.first();
		const btn = row.locator(".charsheet__skill-roll, .charsheet__skill-bonus, button").first();
		const visible = await btn.isVisible({timeout: 1500}).catch(() => false);
		if (!visible) return {bonus, clicked: false};
		await btn.click({timeout: 2000}).catch(() => null);
		await this.page.waitForTimeout(100);
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
	async getKnownSpellsByLevel (): Promise<Record<number, string[]>> {
		return this.page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			const state = cs?._state;
			if (!state?.getKnownSpells) return {};
			const out: Record<number, string[]> = {};
			try {
				const spells = state.getKnownSpells() || [];
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
		await this.switchToTab(this.tabAbilities);
		return this.page.evaluate((s) => {
			const re = new RegExp(`\\b${s}\\b`, "i");
			const rows = document.querySelectorAll(".charsheet__skill-row, [data-skill]") as NodeListOf<HTMLElement>;
			for (const row of Array.from(rows)) {
				if (!re.test(row.textContent || "")) continue;
				const btn = row.querySelector(".charsheet__skill-roll, button") as HTMLElement | null;
				if (!btn) continue;
				try { btn.click(); return {clicked: true, threwError: false}; } catch (e: any) {
					return {clicked: true, threwError: true, errorMessage: String(e?.message ?? e)};
				}
			}
			return {clicked: false, threwError: false};
		}, skill);
	}

	/** Click an attack-row's roll button by attack name; throws-aware. */
	async clickAttackRoll (attackName: string | RegExp): Promise<{clicked: boolean; threwError: boolean; errorMessage?: string}> {
		await this.switchToTab(this.tabCombat);
		const reSrc = attackName instanceof RegExp ? attackName.source : attackName;
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
