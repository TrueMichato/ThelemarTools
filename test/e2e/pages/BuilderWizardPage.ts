import {Locator, Page, expect} from "@playwright/test";
import {waitForListItems} from "../utils/waitHelpers";

/**
 * Page Object Model for the Character Builder wizard
 * Provides methods to navigate through each step
 */
export class BuilderWizardPage {
	readonly page: Page;

	// Navigation
	readonly btnPrev: Locator;
	readonly btnNext: Locator;
	readonly wizardContainer: Locator;

	// Step indicators
	readonly stepIndicators: Locator;

	// Race step
	readonly raceSearchInput: Locator;
	readonly raceList: Locator;
	readonly racePreview: Locator;
	readonly subraceSelect: Locator;

	// Class step
	readonly classSearchInput: Locator;
	readonly classList: Locator;
	readonly classPreview: Locator;
	readonly subclassSelect: Locator;
	readonly quickBuildLevelSlider: Locator;
	readonly quickBuildLevelDisplay: Locator;

	// Abilities step
	readonly abilityMethodSelect: Locator;

	// Background step
	readonly backgroundSearchInput: Locator;
	readonly backgroundList: Locator;
	readonly backgroundPreview: Locator;

	// Details step
	readonly nameInput: Locator;
	readonly personalityInput: Locator;
	readonly idealsInput: Locator;
	readonly bondsInput: Locator;
	readonly flawsInput: Locator;

	constructor (page: Page) {
		this.page = page;

		// Navigation
		this.btnPrev = page.locator("#charsheet-builder-prev");
		this.btnNext = page.locator("#charsheet-builder-next");
		this.wizardContainer = page.locator("#charsheet-builder");

		// Step indicators
		this.stepIndicators = page.locator(".charsheet__builder-step");

		// Race step
		this.raceSearchInput = page.locator("#builder-race-search");
		this.raceList = page.locator("#builder-race-list");
		this.racePreview = page.locator("#builder-race-preview");
		this.subraceSelect = page.locator("#builder-subrace-select");

		// Class step
		this.classSearchInput = page.locator("#builder-class-search");
		this.classList = page.locator("#builder-class-list");
		this.classPreview = page.locator("#builder-class-preview");
		this.subclassSelect = page.locator("#builder-subclass-select");
		this.quickBuildLevelSlider = page.locator("#builder-quickbuild-level-slider");
		this.quickBuildLevelDisplay = page.locator("#builder-quickbuild-level-display");

		// Abilities step
		this.abilityMethodSelect = page.locator('[data-testid="builder-ability-method"]');

		// Background step
		this.backgroundSearchInput = page.locator("#builder-bg-search");
		this.backgroundList = page.locator("#builder-bg-list");
		this.backgroundPreview = page.locator("#builder-bg-preview");

		// Details step
		this.nameInput = page.locator("#builder-name");
		this.personalityInput = page.locator("#builder-personality");
		this.idealsInput = page.locator("#builder-ideals");
		this.bondsInput = page.locator("#builder-bonds");
		this.flawsInput = page.locator("#builder-flaws");
	}

	/**
	 * Get the current step number (1-6)
	 */
	async getCurrentStep (): Promise<number> {
		const activeStep = this.page.locator(".charsheet__builder-step.active");
		const stepAttr = await activeStep.getAttribute("data-step");
		return parseInt(stepAttr || "1", 10);
	}

	/**
	 * Click Next to proceed to the next step
	 */
	async clickNext (): Promise<void> {
		await this.btnNext.click();
		// Wait for any toast messages (validation errors) or step change
		await this.page.waitForTimeout(500);
	}

	/**
	 * Click Previous to go back a step
	 */
	async clickPrev (): Promise<void> {
		await this.btnPrev.click();
		await this.page.waitForTimeout(200);
	}

	// ========== RACE STEP ==========

	/**
	 * Select a race by name from the list
	 */
	async selectRace (raceName: string): Promise<void> {
		await waitForListItems(this.page, "#builder-race-list");
		const raceItem = this.raceList.locator(`.charsheet__builder-list-item`).filter({
			has: this.page.locator(`.charsheet__builder-list-item-name`, {hasText: raceName}),
		});
		await raceItem.click();
		await this.page.waitForTimeout(100);
	}

	/**
	 * Select a race by exact name and source (e.g., "Human", "PHB")
	 */
	async selectRaceExact (raceName: string, sourceAbbv: string): Promise<void> {
		await waitForListItems(this.page, "#builder-race-list");
		// Skip separator/header rows that have no name node (would otherwise hang).
		const items = this.raceList.locator(`.charsheet__builder-list-item`).filter({
			has: this.page.locator(`.charsheet__builder-list-item-name`),
		});
		const count = await items.count();
		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const nameEl = item.locator(`.charsheet__builder-list-item-name`);
			const sourceEl = item.locator(`.charsheet__builder-list-item-source`);
			const nameText = (await nameEl.textContent({timeout: 2000}).catch(() => "")) || "";
			const sourceText = (await sourceEl.textContent({timeout: 2000}).catch(() => "")) || "";
			// Match exact name (not containing subraces info) and source
			if (nameText.startsWith(raceName) && sourceText.includes(sourceAbbv)) {
				// Skip entries with subraces since we want the non-subrace version first
				if (!nameText.includes("subraces")) {
					// Scroll into view and click
					await item.scrollIntoViewIfNeeded();
					await item.click();
					await this.page.waitForTimeout(200);
					return;
				}
			}
		}
		// Fallback: try first match with subraces
		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const nameEl = item.locator(`.charsheet__builder-list-item-name`);
			const sourceEl = item.locator(`.charsheet__builder-list-item-source`);
			const nameText = (await nameEl.textContent({timeout: 2000}).catch(() => "")) || "";
			const sourceText = (await sourceEl.textContent({timeout: 2000}).catch(() => "")) || "";
			if (nameText.startsWith(raceName) && sourceText.includes(sourceAbbv)) {
				await item.scrollIntoViewIfNeeded();
				await item.click();
				await this.page.waitForTimeout(200);
				return;
			}
		}
		throw new Error(`Could not find race "${raceName}" with source "${sourceAbbv}"`);
	}

	/**
	 * Select a subrace if the preview shows a subrace dropdown
	 */
	async selectSubrace (subraceName: string): Promise<void> {
		// The wizard renders option labels as `${SubraceName} (${SrcAbv})`
		// (e.g. "Clairnian (TGTT)"). Look up the matching <option> value
		// then `selectOption` by value so callers can pass the bare name.
		const opt = this.subraceSelect.locator("option").filter({hasText: subraceName}).first();
		const value = await opt.getAttribute("value");
		if (value == null) {
			throw new Error(`Subrace "${subraceName}" not found in subrace dropdown`);
		}
		await this.subraceSelect.selectOption({value});
		await this.page.waitForTimeout(100);
	}

	/**
	 * Check if subrace selection is available
	 */
	async hasSubraceSelection (): Promise<boolean> {
		return await this.subraceSelect.isVisible();
	}

	/**
	 * Tick the first available checkboxes in every racial-choice block
	 * (skills, tools, languages) until each block's "Selected: N/M" counter
	 * reaches its target. Required because validation in `_validateCurrentStep`
	 * for the race step blocks Next when `_selectedRacialSkills` /
	 * `_selectedRacialTools` are short of `_getRacialSkillChoiceCount` /
	 * `_getRacialToolChoiceCount`. (Languages are not validated but we still
	 * tick them so `Selected: 0/N` doesn't surface in failure diagnostics.)
	 *
	 * Idempotent — safe for races with no choices.
	 */
	async selectAllRacialChoices (): Promise<void> {
		const sections = [
			".charsheet__builder-racial-skill-selection",
			".charsheet__builder-racial-tool-selection",
			".charsheet__builder-racial-lang-selection",
		];
		for (const sectionSel of sections) {
			const sectionLocs = this.page.locator(sectionSel);
			const sectionCount = await sectionLocs.count();
			for (let s = 0; s < sectionCount; s++) {
				const section = sectionLocs.nth(s);
				const checkboxes = section.locator("input[type='checkbox']");
				const cbCount = await checkboxes.count();
				if (cbCount === 0) continue;
				// Parse "Selected: N/M" to find target.
				const counterText = (await section.textContent()) || "";
				const match = counterText.match(/Selected:\s*(\d+)\s*\/\s*(\d+)/i);
				const target = match ? parseInt(match[2], 10) : 1;
				let selected = 0;
				for (let i = 0; i < cbCount && selected < target; i++) {
					const cb = checkboxes.nth(i);
					try {
						if (!(await cb.isVisible())) continue;
						if (await cb.isDisabled()) continue;
						if (await cb.isChecked()) { selected++; continue; }
						await cb.check();
						await this.page.waitForTimeout(40);
						if (await cb.isChecked()) selected++;
					} catch { /* fall through to next checkbox */ }
				}
			}
		}
	}

	// ========== CLASS STEP ==========

	/**
	 * Select a class by name from the list
	 */
	async selectClass (className: string): Promise<void> {
		await waitForListItems(this.page, "#builder-class-list");
		const classItem = this.classList.locator(`.charsheet__builder-list-item`).filter({
			has: this.page.locator(`.charsheet__builder-list-item-name`, {hasText: className}),
		});
		await classItem.click();
		await this.page.waitForTimeout(100);
	}

	/**
	 * Select a class by exact name and source (e.g., "Fighter", "PHB")
	 */
	async selectClassExact (className: string, sourceAbbv: string): Promise<void> {
		await waitForListItems(this.page, "#builder-class-list");
		const items = this.classList.locator(`.charsheet__builder-list-item`).filter({
			has: this.page.locator(`.charsheet__builder-list-item-name`),
		});
		const count = await items.count();
		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const nameEl = item.locator(`.charsheet__builder-list-item-name`);
			const sourceEl = item.locator(`.charsheet__builder-list-item-source`);
			const nameText = (await nameEl.textContent({timeout: 2000}).catch(() => "")) || "";
			const sourceText = (await sourceEl.textContent({timeout: 2000}).catch(() => "")) || "";
			if (nameText === className && sourceText.includes(sourceAbbv)) {
				await item.click();
				await this.page.waitForTimeout(100);
				return;
			}
		}
		throw new Error(`Could not find class "${className}" with source "${sourceAbbv}"`);
	}

	/**
	 * Select a subclass from the dropdown
	 */
	async selectSubclass (subclassName: string): Promise<void> {
		await this.subclassSelect.selectOption({label: subclassName});
		await this.page.waitForTimeout(100);
	}

	async setQuickBuildTargetLevel (level: number): Promise<void> {
		await this.classPreview.waitFor({state: "visible", timeout: 10000});
		await expect(this.classPreview).toContainText("Quick Build", {timeout: 10000});
		await this.quickBuildLevelSlider.waitFor({state: "visible", timeout: 10000});
		await this.quickBuildLevelSlider.evaluate((element, value) => {
			const input = /** @type {HTMLInputElement} */ (element);
			input.value = String(value);
			input.dispatchEvent(new Event("input", {bubbles: true}));
		}, level);
		await expect(this.quickBuildLevelDisplay).toHaveText(String(level));
	}

	async expectDivineSoulAffinityModalVisible (): Promise<void> {
		await expect(this.page.locator(".ui-modal__inner").filter({hasText: "Divine Soul Affinity"}).last()).toBeVisible();
	}

	async selectDivineSoulAffinity (affinityName: string): Promise<void> {
		const modal = this.page.locator(".ui-modal__inner").filter({hasText: "Divine Soul Affinity"}).last();
		await modal.waitFor({state: "visible", timeout: 10000});
		const select = modal.locator("select").first();
		await select.selectOption({label: affinityName});
		await modal.getByRole("button", {name: "OK"}).click();
		await modal.waitFor({state: "hidden", timeout: 10000});
	}

	/**
	 * Check if subclass selection is available
	 */
	async hasSubclassSelection (): Promise<boolean> {
		return await this.subclassSelect.isVisible();
	}

	/**
	 * Select skill proficiency if available
	 */
	async selectSkillProficiency (skillName: string): Promise<void> {
		const checkbox = this.page.locator(`[data-testid="builder-skill-${skillName.toLowerCase()}"]`);
		if (await checkbox.isVisible()) {
			await checkbox.check();
		}
	}

	/**
	 * Select the first N available skill checkboxes (for class skill proficiency)
	 */
	async selectFirstAvailableSkills (count: number): Promise<void> {
		// Scope to the class-step skill section so we don't accidentally
		// tick checkboxes in the sibling expertise / weapon-mastery / racial
		// sections, which all reuse the `.charsheet__builder-skill-checkbox`
		// label class.
		const classSkillSection = this.page.locator(".charsheet__builder-skill-selection").first();
		const scope = (await classSkillSection.count()) > 0
			? classSkillSection
			: this.page;
		const skillCheckboxes = scope.locator(".charsheet__builder-skill-checkbox input[type='checkbox']");
		const visibleCount = await skillCheckboxes.count();
		let selected = 0;
		for (let i = 0; i < visibleCount && selected < count; i++) {
			const checkbox = skillCheckboxes.nth(i);
			try {
				if (!(await checkbox.isVisible())) continue;
				if (await checkbox.isDisabled()) continue;          // already proficient (e.g. from background)
				if (await checkbox.isChecked()) continue;
				await checkbox.check();
				await this.page.waitForTimeout(50);
				if (await checkbox.isChecked()) selected++;
			} catch {
				// At capacity or option became unavailable — try next.
			}
		}
	}

	/**
	 * Pick traditions then methods inside the TGTT
	 * `.charsheet__builder-combat-methods` region. No-op when absent.
	 * Reads `Selected: N/M` counters to know how many to pick.
	 */
	async selectCombatTraditionsAndMethods (): Promise<void> {
		const section = this.page.locator(".charsheet__builder-combat-methods").first();
		if ((await section.count()) === 0) return;

		const parseCount = async (label: string): Promise<number> => {
			const txt = await section.locator(label).first().textContent({timeout: 1000}).catch(() => "");
			const m = (txt || "").match(/(\d+)/);
			return m ? parseInt(m[1], 10) : 0;
		};

		// 1) Traditions — `Selected: <span class="tradition-count">N</span>/M`
		const tradHeader = await section.locator(".charsheet__builder-traditions").first().textContent().catch(() => "");
		const tradTarget = (() => {
			const m = (tradHeader || "").match(/Choose\s+(\d+)/i);
			return m ? parseInt(m[1], 10) : 2;
		})();
		const tradBoxes = section.locator(".charsheet__builder-tradition-list input[type='checkbox']");
		const nTrad = await tradBoxes.count();
		let pickedTrad = 0;
		for (let i = 0; i < nTrad && pickedTrad < tradTarget; i++) {
			const cb = tradBoxes.nth(i);
			try {
				if (!(await cb.isVisible())) continue;
				if (await cb.isChecked()) { pickedTrad++; continue; }
				await cb.check();
				await this.page.waitForTimeout(80);
				if (await cb.isChecked()) pickedTrad++;
			} catch { /* capacity */ }
		}

		// Wait for the methods list to render after traditions are picked.
		await this.page.waitForTimeout(250);

		// 2) Methods — header reads "Choose N (max degree: …)"
		const methHeader = await section.locator(".charsheet__builder-methods").first().textContent().catch(() => "");
		const methTarget = (() => {
			const m = (methHeader || "").match(/Choose\s+(\d+)/i);
			return m ? parseInt(m[1], 10) : 3;
		})();
		const methBoxes = section.locator(".charsheet__builder-method-list input[type='checkbox']");
		const nMeth = await methBoxes.count();
		let pickedMeth = 0;
		for (let i = 0; i < nMeth && pickedMeth < methTarget; i++) {
			const cb = methBoxes.nth(i);
			try {
				if (!(await cb.isVisible())) continue;
				if (await cb.isChecked()) { pickedMeth++; continue; }
				await cb.check();
				await this.page.waitForTimeout(50);
				if (await cb.isChecked()) pickedMeth++;
			} catch { /* capacity */ }
		}
	}


	/**
	 * Pick a value for every empty class-feature language dropdown
	 * (`#class-lang-choice-*`), e.g. Ranger's Deft Explorer. Picks the first
	 * non-empty option per dropdown to avoid duplicate-language validation.
	 */
	async selectAllClassFeatureLanguages (): Promise<void> {
		const section = this.page.locator(".charsheet__builder-class-lang-selection").first();
		if ((await section.count()) === 0) return;
		const selects = section.locator("select");
		const total = await selects.count();
		const used = new Set<string>();
		for (let i = 0; i < total; i++) {
			const sel = selects.nth(i);
			const current = await sel.inputValue();
			if (current) { used.add(current); continue; }
			const opts = sel.locator("option");
			const optCount = await opts.count();
			for (let j = 1; j < optCount; j++) {
				const v = await opts.nth(j).getAttribute("value");
				if (!v || used.has(v)) continue;
				await sel.selectOption(v);
				used.add(v);
				break;
			}
		}
	}

	/**
	 * Tick the first N available expertise checkboxes inside the class step's
	 * `.charsheet__builder-expertise-selection` region. No-op when the
	 * selected class doesn't expose early-level expertise (Rogue/Bard/Ranger).
	 */
	async selectFirstAvailableExpertise (count: number = 4): Promise<void> {
		const expertiseSection = this.page.locator(".charsheet__builder-expertise-selection").first();
		if ((await expertiseSection.count()) === 0) return;
		await this.page.waitForTimeout(150);
		const boxes = expertiseSection.locator("input[type='checkbox']");
		const total = await boxes.count();
		let selected = 0;
		for (let i = 0; i < total && selected < count; i++) {
			const cb = boxes.nth(i);
			try {
				if (!(await cb.isVisible())) continue;
				if (await cb.isDisabled()) continue;
				if (await cb.isChecked()) continue;
				await cb.check();
				await this.page.waitForTimeout(50);
				if (await cb.isChecked()) selected++;
			} catch { /* capacity hit */ }
		}
	}

	/**
	 * Select the first N available weapon mastery checkboxes (for PHB'24 Fighter/other martial classes)
	 */
	async selectFirstAvailableWeaponMasteries (count: number): Promise<void> {
		// Weapon mastery checkboxes have a title attribute with "Mastery:" on parent label
		const masteryCheckboxes = this.page.locator(".charsheet__builder-skill-checkbox input[type='checkbox']").filter({
			has: this.page.locator("xpath=ancestor::label[@title]"),
		});

		if (await masteryCheckboxes.count() === 0) {
			return;
		}

		let selected = 0;
		const visibleCount = await masteryCheckboxes.count();
		for (let i = 0; i < visibleCount && selected < count; i++) {
			const checkbox = masteryCheckboxes.nth(i);
			try {
				if (await checkbox.isVisible() && !(await checkbox.isChecked())) {
					await checkbox.check();
					await this.page.waitForTimeout(50);
					if (await checkbox.isChecked()) {
						selected++;
					}
				}
			} catch {
				// Handler may reject — at capacity, stop trying
				break;
			}
		}
	}

	/**
	 * Select first available optional features (fighting styles, divine order, combat methods, etc.)
	 * Handles multiple UI patterns: label-wrapped checkboxes and bare checkbox containers.
	 */
	async selectFirstAvailableOptionalFeatures (count: number): Promise<void> {
		await this.page.waitForTimeout(300);

		let selected = 0;

		// Broad approach: find ALL clickable labels/containers with checkboxes
		// across optional feature sections, combat method sections, etc.
		const allOptFeatLabels = this.page.locator(
			".charsheet__builder-opt-feat-item, " +
			".charsheet__builder-opt-feat-section label, " +
			".charsheet__builder-optional-features label, " +
			".charsheet__builder-method-item, " +
			".charsheet__builder-combat-methods label",
		);

		const labelCount = await allOptFeatLabels.count();
		for (let i = 0; i < labelCount && selected < count; i++) {
			const label = allOptFeatLabels.nth(i);
			const checkbox = label.locator("input[type='checkbox']");
			if (await label.isVisible() && await checkbox.count() > 0 && !(await checkbox.isChecked())) {
				await label.scrollIntoViewIfNeeded();
				// Click the checkbox directly — hover-link <a> tags inside
				// the label can intercept label clicks otherwise.
				try {
					await checkbox.check({timeout: 1500});
				} catch {
					try { await label.click({timeout: 1500}); } catch { /* ignore */ }
				}
				await this.page.waitForTimeout(120);
				if (await checkbox.isChecked()) selected++;
			}
		}

		if (selected >= count) return;

		// Fallback: try known Fighting Style names
		const knownFightingStyles = ["Archery", "Defense", "Dueling", "Great Weapon Fighting", "Protection", "Two-Weapon Fighting"];
		for (const styleName of knownFightingStyles) {
			if (selected >= count) break;
			const label = this.page.locator(`label:has(input[type="checkbox"]):has-text("${styleName}")`);
			if (await label.count() > 0 && await label.first().isVisible()) {
				const cb = label.first().locator("input[type='checkbox']");
				if (await cb.count() > 0 && !(await cb.isChecked())) {
					await label.first().click();
					await this.page.waitForTimeout(100);
					if (await cb.isChecked()) selected++;
				}
			}
		}
	}

	/**
	 * Select first available feature options (specialties embedded in class features).
	 * These are different from optional features - they're choices within a feature itself.
	 * Uses .charsheet__builder-feat-opt-* selectors.
	 */
	async selectFirstAvailableFeatureOptions (count: number): Promise<void> {
		await this.page.waitForTimeout(300);

		let selected = 0;

		// Feature options use label elements with checkboxes inside
		// Clicking the label toggles the checkbox
		let featureOptLabels = this.page.locator(".charsheet__builder-feat-opt-item");

		if (await featureOptLabels.count() === 0) {
			// Try the container
			featureOptLabels = this.page.locator(".charsheet__builder-feat-opt-section label");
		}

		const visibleCount = await featureOptLabels.count();
		for (let i = 0; i < visibleCount && selected < count; i++) {
			const label = featureOptLabels.nth(i);
			const checkbox = label.locator("input[type='checkbox']");
			if (await label.isVisible() && await checkbox.count() > 0 && !(await checkbox.isChecked())) {
				await label.click();
				await this.page.waitForTimeout(100);
				selected++;
			}
		}
	}

	/**
	 * Auto-fill all remaining required selections on the current builder step.
	 * Uses jQuery to trigger checkbox changes (the app uses jQuery event handlers).
	 */
	async autoFillRemainingSelections (): Promise<void> {
		// Strategy: Find all "Selected: X / Y" where X < Y, then walk up the DOM
		// to find and check unchecked checkboxes until the count is met.
		// Run multiple passes to handle cascading dependencies.
		for (let pass = 0; pass < 3; pass++) {
			await this.page.evaluate(() => {
				const $ = (window as any).jQuery || (window as any).$;
				if (!$) return;

				// Use a more aggressive approach: find ALL text nodes matching the pattern
				const walker = document.createTreeWalker(
					document.body,
					NodeFilter.SHOW_TEXT,
					null,
				);

				const matchingNodes: {node: Node; current: number; max: number}[] = [];
				let textNode;
				while ((textNode = walker.nextNode())) {
					const text = (textNode.textContent || "").trim();
					const match = text.match(/^Selected:\s*(\d+)\s*\/\s*(\d+)$/);
					if (match) {
						const current = parseInt(match[1]);
						const max = parseInt(match[2]);
						if (current < max) {
							matchingNodes.push({node: textNode, current, max});
						}
					}
				}

				for (const {node, current, max} of matchingNodes) {
					const needed = max - current;
					// Walk up from the text node to find checkboxes at increasing depths
					let el: Element | null = node.parentElement;
					let filled = 0;
					for (let depth = 0; depth < 6 && el && filled < needed; depth++) {
						el = el.parentElement;
						if (!el) break;
						const checkboxes = el.querySelectorAll("input[type='checkbox']:not(:checked)");
						if (checkboxes.length > 0) {
							for (const cb of checkboxes) {
								if (filled >= needed) break;
								// Click the parent clickable element (label or div) to trigger jQuery handlers
								const clickTarget = cb.closest("label") || cb.parentElement;
								if (clickTarget) {
									(clickTarget as HTMLElement).click();
								} else {
									(cb as HTMLElement).click();
								}
								filled++;
							}
							break;
						}
					}
				}
			});
			await this.page.waitForTimeout(300);
		}
	}

	async autoFillStartingSpells (opts?: {divineSoulAffinity?: string}): Promise<void> {
		const heading = this.page.getByRole("heading", {name: "Starting Spells"});
		if (!await heading.count() || !await heading.isVisible()) return;

		const builderRoot = this.page.locator("#charsheet-builder");
		if (opts?.divineSoulAffinity) {
			const affinitySection = builderRoot.locator(".charsheet__builder-feat-opt-section").filter({hasText: "Divine Soul Affinity"}).first();
			if (await affinitySection.count()) {
				const affinitySelect = affinitySection.locator("select").first();
				await affinitySelect.selectOption({label: opts.divineSoulAffinity});
				await this.page.waitForTimeout(300);
			}
		}

		const controls = builderRoot.locator("select");
		if (await controls.count() < 1) return;

		const levelFilter = controls.first();
		const summaryText = (await builderRoot.locator("p").filter({hasText: /Choose .* spells/i}).first().textContent()) || "";
		const cantripCount = parseInt(summaryText.match(/and\s+(\d+)\s+cantrips?/i)?.[1] || "0", 10);
		const spellCount = parseInt(summaryText.match(/Choose\s+(\d+)\s+spells?/i)?.[1] || "0", 10);

		const addVisibleSpells = async (count: number) => {
			for (let added = 0; added < count; added++) {
				const addButton = builderRoot.getByRole("button", {name: /add/i}).filter({hasText: /add/i}).first();
				await addButton.waitFor({state: "visible", timeout: 10000});
				await addButton.click();
				await this.page.waitForTimeout(100);
			}
		};

		if (cantripCount > 0) {
			await levelFilter.selectOption({label: "Cantrips"});
			await this.page.waitForTimeout(200);
			await addVisibleSpells(cantripCount);
		}

		if (spellCount > 0) {
			await levelFilter.selectOption({label: "Level 1"});
			await this.page.waitForTimeout(200);
			await addVisibleSpells(spellCount);
		}
	}

	// ========== ABILITIES STEP ==========

	/**
	 * Select ability score method (standard-array, point-buy, or roll)
	 */
	async selectAbilityMethod (method: "standard-array" | "point-buy" | "roll"): Promise<void> {
		const methodSelect = this.page.locator(`[data-testid="builder-ability-method"]`);
		if (await methodSelect.isVisible()) {
			await methodSelect.selectOption(method);
		} else {
			// Fallback: click the method button/tab if it exists
			const methodTab = this.page.locator(`[data-method-id="${method}"]`);
			if (await methodTab.isVisible()) {
				await methodTab.click();
			}
		}
		await this.page.waitForTimeout(100);
	}

	/**
	 * Assign an ability score value to an ability (for standard array assignment)
	 */
	async assignAbilityScore (ability: string, value: number): Promise<void> {
		const select = this.page.locator(`[data-testid="builder-ability-${ability.toLowerCase()}"]`);
		if (await select.isVisible()) {
			await select.selectOption(String(value));
		}
	}

	/**
	 * Assign standard array ability scores using a sensible default distribution
	 * Standard array: 15, 14, 13, 12, 10, 8
	 * Default assigns: STR=15, DEX=14, CON=13, INT=12, WIS=10, CHA=8
	 */
	async assignStandardArrayDefaults (): Promise<void> {
		const assignments: Array<{score: number; ability: string}> = [
			{score: 15, ability: "str"},
			{score: 14, ability: "dex"},
			{score: 13, ability: "con"},
			{score: 12, ability: "int"},
			{score: 10, ability: "wis"},
			{score: 8, ability: "cha"},
		];

		for (const {score, ability} of assignments) {
			// Click the score badge to select it
			const scoreBadge = this.page.locator(`.charsheet__builder-score-badge[data-score="${score}"]`);
			if (await scoreBadge.isVisible()) {
				await scoreBadge.click();
				await this.page.waitForTimeout(100);

				// Click the ability dropzone to assign it
				const abilityDropzone = this.page.locator(`.charsheet__builder-ability-dropzone[data-ability="${ability}"]`);
				if (await abilityDropzone.isVisible()) {
					await abilityDropzone.click();
					await this.page.waitForTimeout(100);
				}
			}
		}
	}

	// ========== BACKGROUND STEP ==========

	/**
	 * Select a background by name
	 */
	async selectBackground (backgroundName: string): Promise<void> {
		await waitForListItems(this.page, "#builder-bg-list");
		const bgItem = this.backgroundList.locator(`.charsheet__builder-list-item`).filter({
			has: this.page.locator(`.charsheet__builder-list-item-name`, {hasText: backgroundName}),
		});
		await bgItem.click();
		await this.page.waitForTimeout(100);
	}

	/**
	 * Select a background by exact name and source (e.g., "Soldier", "PHB'24")
	 */
	async selectBackgroundExact (backgroundName: string, sourceAbbv: string): Promise<void> {
		await waitForListItems(this.page, "#builder-bg-list");
		// Filter out separator/header rows that lack a name node so the
		// per-item textContent() lookup below can't hang on an empty cell.
		const items = this.backgroundList.locator(`.charsheet__builder-list-item`).filter({
			has: this.page.locator(`.charsheet__builder-list-item-name`),
		});
		const count = await items.count();
		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const nameEl = item.locator(`.charsheet__builder-list-item-name`);
			const sourceEl = item.locator(`.charsheet__builder-list-item-source`);
			const nameText = (await nameEl.textContent({timeout: 2000}).catch(() => "")) || "";
			const sourceText = (await sourceEl.textContent({timeout: 2000}).catch(() => "")) || "";
			if (nameText.trim() === backgroundName && sourceText.includes(sourceAbbv)) {
				await item.scrollIntoViewIfNeeded();
				await item.click();
				await this.page.waitForTimeout(100);
				return;
			}
		}
		throw new Error(`Background "${backgroundName}" with source "${sourceAbbv}" not found`);
	}

	// ========== EQUIPMENT STEP ==========

	/**
	 * Select equipment option (starting equipment or gold)
	 */
	async selectEquipmentOption (option: "equipment" | "gold"): Promise<void> {
		const btn = this.page.locator(`[data-testid="builder-equipment-${option}"]`);
		if (await btn.isVisible()) {
			await btn.click();
		}
	}

	// ========== DETAILS STEP ==========

	/**
	 * Fill in character name
	 */
	async fillName (name: string): Promise<void> {
		await this.nameInput.fill(name);
	}

	/**
	 * Fill in character details
	 */
	async fillDetails (details: {
		name?: string;
		personality?: string;
		ideals?: string;
		bonds?: string;
		flaws?: string;
	}): Promise<void> {
		if (details.name && await this.nameInput.isVisible()) {
			// The builder's name input persists state on the `change` event,
			// not `input`. Use clear+type+blur via the page so the input,
			// change, and blur events all fire in the natural order.
			await this.nameInput.click({clickCount: 3});
			await this.nameInput.press("Delete");
			await this.nameInput.pressSequentially(details.name, {delay: 10});
			await this.nameInput.press("Tab");
			await this.nameInput.dispatchEvent("change");
			await this.page.waitForTimeout(200);
		}
		if (details.personality && await this.personalityInput.isVisible()) {
			await this.personalityInput.fill(details.personality);
		}
		if (details.ideals && await this.idealsInput.isVisible()) {
			await this.idealsInput.fill(details.ideals);
		}
		if (details.bonds && await this.bondsInput.isVisible()) {
			await this.bondsInput.fill(details.bonds);
		}
		if (details.flaws && await this.flawsInput.isVisible()) {
			await this.flawsInput.fill(details.flaws);
		}
	}

	/**
	 * Complete the wizard by clicking Finish
	 */
	async finishWizard (): Promise<void> {
		// On the last step, the Next button becomes "Finish"
		await this.btnNext.click();
		// Wait for the character sheet to load
		await this.page.waitForTimeout(500);
	}

	/**
	 * If the spell-step "Skip Spell Selection?" confirm dialog appeared,
	 * click its primary (Skip) button. No-op if the dialog isn't open.
	 */
	async acceptSkipSpellsDialog (): Promise<void> {
		// The modal title is "Skip Spell Selection?" and the primary button
		// label is "Skip" (with a leading icon span).  Scope the lookup to
		// the modal so the heading text doesn't accidentally match.
		const modal = this.page.locator(".ve-ui-modal__overlay").last();
		const skipBtn = modal.getByRole("button", {name: /Skip/i}).first();
		try {
			await skipBtn.waitFor({state: "visible", timeout: 3000});
			await skipBtn.click();
			await this.page.waitForTimeout(300);
		} catch { /* dialog never appeared — fully populated spells */ }
	}

	/**
	 * Verify that the wizard completed successfully
	 */
	async expectWizardComplete (): Promise<void> {
		// After completion, builder should be hidden and overview visible
		await expect(this.page.locator("#charsheet-tab-overview")).toBeVisible();
	}
}
