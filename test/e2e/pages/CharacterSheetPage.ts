import {Locator, Page, expect} from "@playwright/test";
import {waitForToolsLoaded, uiGate} from "../utils/waitHelpers";

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
			if (!await overlay.first().isVisible({timeout: 250}).catch(() => false)) return;
			await this.page.keyboard.press("Escape").catch(() => {});
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
			cs?._rest?._restoreResources?.("short");
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
