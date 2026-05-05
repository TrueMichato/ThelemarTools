import {Locator, Page, expect} from "@playwright/test";

/**
 * Page Object Model for the Level-Up wizard modal
 * Provides methods to complete level-up choices
 */
export class LevelUpPage {
	readonly page: Page;

	// Modal container
	readonly modalContainer: Locator;

	// Progress elements
	readonly progressBar: Locator;
	readonly progressText: Locator;

	// Accordion sections
	readonly accordionSubclass: Locator;
	readonly accordionAsi: Locator;
	readonly accordionFeatures: Locator;
	readonly accordionHp: Locator;
	readonly accordionExpertise: Locator;
	readonly accordionKnownSpells: Locator;
	readonly accordionOptFeatures: Locator;

	// Buttons
	readonly btnFinish: Locator;
	readonly btnCancel: Locator;

	constructor (page: Page) {
		this.page = page;

		// Modal
		this.modalContainer = page.locator(".charsheet__levelup-wizard");

		// Progress
		this.progressBar = page.locator(".charsheet__levelup-progress-fill");
		this.progressText = page.locator(".charsheet__levelup-progress-text");

		// Accordions - these are dynamically shown based on level/class
		this.accordionSubclass = page.locator('[data-accordion-id="subclass"]');
		this.accordionAsi = page.locator('[data-accordion-id="asi"]');
		this.accordionFeatures = page.locator('[data-accordion-id="features"]');
		this.accordionHp = page.locator('[data-accordion-id="hp"]');
		this.accordionExpertise = page.locator('[data-accordion-id="expertise"]');
		this.accordionKnownSpells = page.locator('[data-accordion-id="knownspells"]');
		this.accordionOptFeatures = page.locator('[data-accordion-id="optfeatures"]');

		// Action buttons
		this.btnFinish = page.locator('[data-testid="levelup-finish"]');
		this.btnCancel = page.locator('[data-testid="levelup-cancel"]');
	}

	/**
	 * Wait for the level-up modal to appear
	 */
	async waitForModal (): Promise<void> {
		await this.modalContainer.waitFor({state: "visible", timeout: 10000});
	}

	/**
	 * Check if level-up modal is visible
	 */
	async isVisible (): Promise<boolean> {
		return await this.modalContainer.isVisible();
	}

	/**
	 * Expand an accordion section by clicking its header
	 */
	async expandAccordion (accordionId: string): Promise<void> {
		// Try data-accordion-id first
		const accordion = this.page.locator(`[data-accordion-id="${accordionId}"]`);
		if (await accordion.count() > 0 && await accordion.isVisible()) {
			const header = accordion.locator(".charsheet__levelup-accordion-header");
			if (await header.count() > 0) {
				await header.click();
				await this.page.waitForTimeout(200);
				return;
			}
			// Click the accordion itself
			await accordion.click();
			await this.page.waitForTimeout(200);
			return;
		}

		// Fallback: click the clickable element that contains the text
		const textMap: Record<string, string> = {
			subclass: "Choose",
			asi: "Ability Score",
			hp: "Hit Points",
			optfeatures: "Optional Feature",
			featoptions: "Feature Option",
			expertise: "Expertise",
			knownspells: "Spells",
			features: "New Features",
		};

		const searchText = textMap[accordionId];
		if (searchText) {
			// Find a clickable ancestor of the text within the wizard
			const textEl = this.page.locator(".charsheet__levelup-wizard").getByText(searchText, {exact: false}).first();
			if (await textEl.count() > 0) {
				await textEl.click();
				await this.page.waitForTimeout(300);
			}
		}
	}

	/**
	 * Check if an accordion section is visible. Strict: only returns true
	 * when an element with `[data-accordion-id="<id>"]` exists AND is
	 * currently visible. The previous text-based fallback matched generic
	 * wizard heading text (e.g. "Choose ...") and produced false positives
	 * that caused downstream `selectSubclass` calls to time out at L3+.
	 */
	async isAccordionVisible (accordionId: string): Promise<boolean> {
		const accordion = this.page.locator(`[data-accordion-id="${accordionId}"]`);
		if ((await accordion.count()) === 0) return false;
		return await accordion.first().isVisible();
	}

	/**
	 * Check if an accordion section is completed
	 */
	async isAccordionCompleted (accordionId: string): Promise<boolean> {
		const accordion = this.page.locator(`[data-accordion-id="${accordionId}"]`);
		return await accordion.locator(".completed").count() > 0 ||
			(await accordion.getAttribute("class"))?.includes("completed") || false;
	}

	// ========== HP SECTION ==========

	/**
	 * Select HP option (take average or roll)
	 */
	async selectHpOption (option: "average" | "roll"): Promise<void> {
		const btn = this.page.locator(`[data-testid="levelup-hp-${option}"]`);
		if (await btn.isVisible()) {
			await btn.click();
		} else {
			// Fallback: look for button by text
			const avgBtn = this.page.getByRole("button", {name: option === "average" ? /average/i : /roll/i});
			if (await avgBtn.isVisible()) {
				await avgBtn.click();
			}
		}
		await this.page.waitForTimeout(100);
	}

	// ========== ASI/FEAT SECTION ==========

	/**
	 * Select ASI option (increase ability score)
	 */
	async selectAsi (ability: string): Promise<void> {
		const select = this.page.locator(`[data-testid="levelup-asi-${ability.toLowerCase()}"]`);
		if (await select.isVisible()) {
			await select.click();
		}
	}

	/**
	 * Select a feat from the feat picker
	 */
	async selectFeat (featName: string): Promise<void> {
		// Click the "feat" option first
		const featOption = this.page.getByRole("button", {name: /feat/i});
		if (await featOption.isVisible()) {
			await featOption.click();
			await this.page.waitForTimeout(100);
		}

		// Then select the specific feat
		const featItem = this.page.locator(".charsheet__levelup-feat-item").filter({hasText: featName});
		if (await featItem.isVisible()) {
			await featItem.click();
		}
	}

	/**
	 * Select the +2/+1 ability score increase option for ASI
	 */
	async selectAsiScore (firstAbility: string, secondAbility?: string): Promise<void> {
		// Look for ability score selectors in the ASI accordion
		const firstSelect = this.page.locator(`[data-testid="levelup-asi-first"]`);
		if (await firstSelect.isVisible()) {
			await firstSelect.selectOption(firstAbility);
		}
		if (secondAbility) {
			const secondSelect = this.page.locator(`[data-testid="levelup-asi-second"]`);
			if (await secondSelect.isVisible()) {
				await secondSelect.selectOption(secondAbility);
			}
		}
	}

	// ========== SUBCLASS SECTION ==========

	/**
	 * Select a subclass by name (clicks the radio button container)
	 */
	async selectSubclass (subclassName: string, sourceAbbv?: string): Promise<void> {
		await this.expandAccordion("subclass");
		const wizard = this.page.locator(".charsheet__levelup-wizard");
		const subclassAccordion = this.page.locator('[data-accordion-id="subclass"]');
		await subclassAccordion.waitFor({state: "visible", timeout: 10000});

		const options = subclassAccordion.locator(".charsheet__levelup-option");
		await options.first().waitFor({state: "visible", timeout: 10000});

		const optionCount = await options.count();
		// First pass: strict — match name AND source when source is provided.
		// Second pass: name-only fallback (subclass cards may render source as
		// an abbreviation badge that differs from the JSON source string,
		// e.g. "TGTT" for "TGTT-2014" homebrew variants).
		for (const requireSource of sourceAbbv ? [true, false] : [false]) {
			for (let i = 0; i < optionCount; i++) {
				const option = options.nth(i);
				if (!(await option.isVisible())) continue;

				const text = await option.textContent() || "";
				if (!text.includes(subclassName)) continue;
				if (requireSource && sourceAbbv && !text.includes(sourceAbbv)) continue;

				await option.scrollIntoViewIfNeeded();
				await option.click({force: true});

				const radio = option.locator("input[type='radio']").first();
				await expect(radio).toBeChecked({timeout: 5000});

				// The summary heading varies by class — Cleric "Divine Domain",
				// Sorcerer "Sorcerous Origin", Wizard "Arcane Tradition",
				// Warlock "Otherworldly Patron", etc. — so match by the chosen
				// name rather than a class-specific keyword.
				const summaryItem = wizard.locator(".charsheet__levelup-summary-item").filter({hasText: subclassName}).first();
				await expect(summaryItem).toContainText(subclassName, {timeout: 5000});
				return;
			}
		}

		throw new Error(`Could not find subclass "${subclassName}"${sourceAbbv ? ` with source "${sourceAbbv}"` : ""}`);
	}

	// ========== KNOWN SPELLS SECTION ==========

	/**
	 * Add a spell to known spells
	 */
	async addKnownSpell (spellName: string): Promise<void> {
		const knownSpellsAccordion = this.page.locator('[data-accordion-id="knownspells"]');
		const spellItem = knownSpellsAccordion.locator(".charsheet__modal-list-item").filter({hasText: spellName}).first();
		await spellItem.waitFor({state: "visible", timeout: 10000});
		await spellItem.locator(".spell-toggle").click();
		await this.page.waitForTimeout(150);
	}

	async addFirstAvailableKnownSpells (count: number): Promise<void> {
		const knownSpellsAccordion = this.page.locator('[data-accordion-id="knownspells"]');
		for (let i = 0; i < count; i++) {
			const addButton = knownSpellsAccordion.locator(".spell-toggle.ve-btn-primary").first();
			await addButton.waitFor({state: "visible", timeout: 10000});
			await addButton.click();
			await this.page.waitForTimeout(150);
		}
	}

	async selectOptionalFeature (featureName: string): Promise<void> {
		const optFeaturesAccordion = this.page.locator('[data-accordion-id="optfeatures"]');
		const label = optFeaturesAccordion.locator("label").filter({hasText: featureName}).first();
		await label.waitFor({state: "visible", timeout: 10000});
		await label.click();
		await this.page.waitForTimeout(150);
	}

	// ========== COMPLETION ==========

	// ========== GENERIC OPTIONS ==========

	/**
	 * Select first available options in the currently expanded accordion
	 * (works for optional features, feature options, etc.)
	 */
	async selectFirstAvailableOptions (): Promise<void> {
		await this.page.waitForTimeout(200);
		// Try clicking first unchecked checkbox labels in the active accordion body
		const labels = this.page.locator(".charsheet__levelup-accordion-body:visible label:has(input[type='checkbox'])");
		const count = await labels.count();
		for (let i = 0; i < count && i < 5; i++) {
			const label = labels.nth(i);
			const checkbox = label.locator("input[type='checkbox']");
			if (await label.isVisible() && await checkbox.count() > 0 && !(await checkbox.isChecked())) {
				await label.click();
				await this.page.waitForTimeout(100);
			}
		}
	}

	/**
	 * Auto-fill all remaining required selections in the level-up wizard.
	 * Uses jQuery to find and check unchecked checkboxes in sections that need more selections.
	 */
	async autoFillAllSelections (): Promise<void> {
		// First, force every accordion expanded so all sub-pickers
		// (including optional ones like Wizard's Spellbook) render their
		// inputs. Note: clicking accordion headers triggers single-open
		// behavior, so we add the `expanded` class directly instead.
		await this.page.evaluate(() => {
			const wizard = document.querySelector(".charsheet__levelup-wizard");
			if (!wizard) return;
			const accordions = wizard.querySelectorAll<HTMLElement>(".charsheet__levelup-accordion");
			for (const acc of accordions) acc.classList.add("expanded");
		});
		await this.page.waitForTimeout(300);

		// Enable any "Show all source versions" toggles so additional
		// combat-methods / optional-feature variants become selectable.
		// (Character may already know all default-source methods, leaving
		// 0 selectable until the broader catalog is unlocked.)
		await this.page.evaluate(() => {
			const wizard = document.querySelector(".charsheet__levelup-wizard");
			if (!wizard) return;
			const toggles = wizard.querySelectorAll<HTMLInputElement>("input.charsheet__opt-show-all-toggle, input[type='checkbox']");
			for (const cb of toggles) {
				const lbl = (cb.closest("label")?.textContent || cb.parentElement?.textContent || "").toLowerCase();
				if (!lbl.includes("show all source versions")) continue;
				if (!cb.checked) cb.click();
			}
		});
		await this.page.waitForTimeout(200);

		// Some sub-pickers gate later choices on earlier ones (e.g. Monk
		// L2 Combat Methods only become valid after Combat Traditions are
		// chosen, even if both render in the same accordion body). Loop
		// the auto-fill pass up to 3 times so each round can satisfy
		// counters that just became fillable.
		for (let pass = 0; pass < 3; pass++) {
			const clicked = await this.page.evaluate(() => {
				const wizard = document.querySelector(".charsheet__levelup-wizard");
				if (!wizard) return 0;

				const counters = Array.from(wizard.querySelectorAll<HTMLElement>("*"))
					.filter(el => /^Selected:\s*\d+\s*\/\s*\d+$/.test((el.textContent || "").trim()));

				let totalClicked = 0;

				for (const counter of counters) {
					const text = (counter.textContent || "").trim();
					const m = text.match(/Selected:\s*(\d+)\s*\/\s*(\d+)/);
					if (!m) continue;
					const current = parseInt(m[1], 10);
					const max = parseInt(m[2], 10);
					if (current >= max) continue;
					const needed = max - current;

					let scope: HTMLElement | null = counter.parentElement;
					let clicked = 0;
					for (let depth = 0; depth < 8 && scope && clicked < needed; depth++) {
						const checkboxes = Array.from(
							scope.querySelectorAll<HTMLInputElement>("input[type='checkbox']:not(:checked):not(:disabled)"),
						);
						// Filter out the global "Show all source versions"
						// helper and any checkbox that's part of a different
						// counter group nested under this scope.
						const group = checkboxes.filter(cb => {
							const lbl = (cb.parentElement?.textContent || "").toLowerCase();
							return !lbl.includes("show all source versions");
						});
						if (group.length > 0) {
							for (const cb of group.slice(0, needed - clicked)) {
								cb.click();
								if (!cb.checked) {
									const wrap = cb.closest("label") || cb.parentElement;
									if (wrap) (wrap as HTMLElement).click();
								}
								clicked++;
								totalClicked++;
							}
							break;
						}
						scope = scope.parentElement;
					}
				}
				return totalClicked;
			});
			if (clicked === 0) break;
			await this.page.waitForTimeout(300);
		}

		// ──────────────────────────────────────────────────────────────
		// ASI + Feat (Thelemar L4 / standard L4/8/12/16/19) — the wizard
		// uses +/− steppers and a feat radio list, not a counter group,
		// so the generic counter pass above can't satisfy it.
		//
		// Strategy: ALWAYS prefer "Increase Ability Scores (+2 total)"
		// when available — +2 to a stat is unconditionally legal and
		// avoids the feat sub-picker rabbit hole entirely. Only fall
		// back to "Take a Feat" when the ASI mode is disabled (some
		// Thelemar nodes only offer a feat).
		// ──────────────────────────────────────────────────────────────
		await this.page.evaluate(() => {
			const wizard = document.querySelector(".charsheet__levelup-wizard");
			if (!wizard) return;
			const asi = wizard.querySelector<HTMLElement>("[data-accordion-id='asi']")
				|| Array.from(wizard.querySelectorAll<HTMLElement>(".charsheet__levelup-accordion"))
					.find(el => /ASI|Ability Score Improvement/i.test(el.textContent || "")) || null;
			if (!asi) return;
			if (!asi.classList.contains("expanded")) {
				asi.querySelector<HTMLElement>(".charsheet__levelup-accordion-header")?.click();
				asi.classList.add("expanded");
			}

			// Helper: dispatch a real MouseEvent on top of .click() so any
			// React-style/jQuery delegated change listeners actually fire.
			const robustClick = (el: HTMLElement) => {
				try { el.click(); } catch (_) { /* noop */ }
				try {
					el.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
					el.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
					el.dispatchEvent(new MouseEvent("click", {bubbles: true}));
					el.dispatchEvent(new Event("change", {bubbles: true}));
				} catch (_) { /* noop */ }
			};

			// Find the mode-selector radios. The label text varies by
			// level: "Increase Ability Scores", "Take a Feat", "Take an
			// Epic Boon" (L19 in 2024 rules), etc. We always prefer the
			// "Increase Ability Scores" path because +2 to a stat is
			// unconditionally legal at every ASI node.
			const allRadios = Array.from(asi.querySelectorAll<HTMLInputElement>("input[type='radio']"));
			const modeAsi = allRadios.find(r => {
				const wrap = r.closest("label") || r.parentElement;
				return !!wrap && /Increase Ability Scores|Ability Score Improvement/i.test(wrap.textContent || "");
			});
			const modeFeatOrBoon = allRadios.find(r => {
				const wrap = r.closest("label") || r.parentElement;
				return !!wrap && /Take a (Feat|Epic Boon)|Take an Epic Boon|Epic Boon/i.test(wrap.textContent || "");
			});

			// Switch to ASI mode whenever it's available and not already
			// selected. Click both the wrapper AND the radio for safety.
			if (modeAsi && !modeAsi.disabled && !modeAsi.checked) {
				const wrap = (modeAsi.closest("label") || modeAsi.parentElement) as HTMLElement | null;
				if (wrap) robustClick(wrap);
				robustClick(modeAsi);
			}
		});
		await this.page.waitForTimeout(200);

		// Now drain the +/- stepper. Re-query the ASI accordion each
		// pass — switching modes re-renders the body.
		for (let pass = 0; pass < 8; pass++) {
			const remaining = await this.page.evaluate(() => {
				const wizard = document.querySelector(".charsheet__levelup-wizard");
				if (!wizard) return 0;
				const asi = wizard.querySelector<HTMLElement>("[data-accordion-id='asi']")
					|| Array.from(wizard.querySelectorAll<HTMLElement>(".charsheet__levelup-accordion"))
						.find(el => /ASI|Ability Score Improvement/i.test(el.textContent || "")) || null;
				if (!asi) return 0;
				const text = asi.textContent || "";
				const m = text.match(/Points remaining:\s*(\d+)/i);
				const left = m ? parseInt(m[1], 10) : 0;
				if (left <= 0) return 0;
				const plusBtns = Array.from(asi.querySelectorAll<HTMLButtonElement>("button"))
					.filter(btn => btn.textContent?.trim() === "+" && !btn.disabled);
				if (plusBtns.length === 0) return -1;
				plusBtns[0].click();
				return left;
			});
			if (remaining <= 0) break;
			if (remaining === -1) break;
			await this.page.waitForTimeout(150);
		}

		// Fallback: if ASI mode wasn't available (or steppers couldn't
		// be driven), pick a feat. Prefer one WITHOUT "has choices"; if
		// none exist, take the first and recurse — the next counter
		// pass at the top of the next call will fill any sub-picker.
		await this.page.evaluate(() => {
			const wizard = document.querySelector(".charsheet__levelup-wizard");
			if (!wizard) return;
			const asi = wizard.querySelector<HTMLElement>("[data-accordion-id='asi']")
				|| Array.from(wizard.querySelectorAll<HTMLElement>(".charsheet__levelup-accordion"))
					.find(el => /ASI|Ability Score Improvement/i.test(el.textContent || "")) || null;
			if (!asi) return;
			// If the ASI requirement is satisfied (no ⚠️ Required), bail.
			if (!/⚠️\s*Required/.test(asi.textContent || "")) return;
			// If steppers exist but Points remaining > 0, the user is in
			// ASI mode and we already failed to drive them — try feat.
			// Find the Feat-mode radio and switch to it, then pick a feat.
			const allRadios = Array.from(asi.querySelectorAll<HTMLInputElement>("input[type='radio']"));
			const modeFeatOrBoon = allRadios.find(r => {
				const wrap = r.closest("label") || r.parentElement;
				return !!wrap && /Take a (Feat|Epic Boon)|Take an Epic Boon|Epic Boon/i.test(wrap.textContent || "");
			});
			const robustClick = (el: HTMLElement) => {
				try { el.click(); } catch (_) { /* noop */ }
				try {
					el.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
					el.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
					el.dispatchEvent(new MouseEvent("click", {bubbles: true}));
					el.dispatchEvent(new Event("change", {bubbles: true}));
				} catch (_) { /* noop */ }
			};
			if (modeFeatOrBoon && !modeFeatOrBoon.disabled && !modeFeatOrBoon.checked) {
				const wrap = (modeFeatOrBoon.closest("label") || modeFeatOrBoon.parentElement) as HTMLElement | null;
				if (wrap) robustClick(wrap);
				robustClick(modeFeatOrBoon);
			}
			// Refresh radio list — feat/boon radios appear after switching mode.
			const featRadios = Array.from(asi.querySelectorAll<HTMLInputElement>("input[type='radio']:not(:checked):not(:disabled)"))
				.filter(r => {
					const wrap = r.closest("label") || r.parentElement;
					if (!wrap) return false;
					const txt = wrap.textContent || "";
					// Exclude the mode-toggle radios themselves.
					if (/Increase Ability Scores|Take a (Feat|Epic Boon)|Take an Epic Boon/i.test(txt)) return false;
					return true;
				});
			const noChoice = featRadios.filter(r => {
				const wrap = r.closest("label") || r.parentElement;
				return wrap && !/has choices/i.test(wrap.textContent || "");
			});
			const target = noChoice[0] || featRadios[0];
			if (!target) return;
			const wrap = (target.closest("label") || target.parentElement) as HTMLElement | null;
			if (wrap) robustClick(wrap);
			robustClick(target);
		});
		await this.page.waitForTimeout(300);

		// ──────────────────────────────────────────────────────────────
		// Scholar Expertise / other single-pick radio sections — for any
		// accordion still flagged ⚠️ Required that contains an unchecked
		// radio group but no "Selected: N/M" counter, pick the first
		// available radio.
		// ──────────────────────────────────────────────────────────────
		await this.page.evaluate(() => {
			const wizard = document.querySelector(".charsheet__levelup-wizard");
			if (!wizard) return;
			const accordions = wizard.querySelectorAll<HTMLElement>(".charsheet__levelup-accordion");
			for (const acc of accordions) {
				const text = acc.textContent || "";
				if (!text.includes("⚠️ Required")) continue;
				if (/Selected:\s*\d+\s*\/\s*\d+/.test(text)) continue;
				if (acc.matches("[data-accordion-id='asi']") || /Ability Score Improvement/i.test(text)) continue;
				// Skip subclass accordion entirely — selectSubclass() handles
				// it deterministically, and clicking another radio in the
				// same group would silently swap the chosen subclass.
				if (acc.matches("[data-accordion-id='subclass']")) continue;
				const allRadios = Array.from(acc.querySelectorAll<HTMLInputElement>("input[type='radio']:not(:disabled)"));
				// Group radios by `name` and skip groups that already have
				// a checked option — the generic handler only fills the
				// FIRST unchecked group, never overwrites prior choices.
				const byName = new Map<string, HTMLInputElement[]>();
				for (const r of allRadios) {
					const n = r.name || "_anon";
					if (!byName.has(n)) byName.set(n, []);
					byName.get(n)!.push(r);
				}
				let target: HTMLInputElement | null = null;
				for (const radios of byName.values()) {
					if (radios.some(r => r.checked)) continue;
					target = radios[0];
					break;
				}
				if (!target) continue;
				target.click();
				if (!target.checked) {
					const wrap = target.closest("label") || target.parentElement;
					if (wrap) (wrap as HTMLElement).click();
				}
			}
		});
		await this.page.waitForTimeout(200);

		// ──────────────────────────────────────────────────────────────
		// Spell pickers (Wizard spellbook, Known caster spells/cantrips,
		// Prepared caster spells/cantrips). These render their own
		// progress headers `<current>/<max>` and use `.spell-toggle`
		// buttons (`+` to add, `✓` to remove). The generic counter pass
		// can't satisfy them. Loop a few times to fill all visible
		// pickers.
		// ──────────────────────────────────────────────────────────────
		for (let pass = 0; pass < 4; pass++) {
			const clicked = await this.page.evaluate(() => {
				const wizard = document.querySelector(".charsheet__levelup-wizard");
				if (!wizard) return 0;
				const pickers = Array.from(wizard.querySelectorAll<HTMLElement>(".charsheet__spell-picker-container"));
				let total = 0;
				for (const picker of pickers) {
					const counters = Array.from(picker.querySelectorAll<HTMLElement>(".spell-counter-value, .cantrip-counter-value"));
					for (const counter of counters) {
						const isCantrip = counter.classList.contains("cantrip-counter-value");
						const cur = parseInt(counter.querySelector(isCantrip ? ".cantrip-count-current" : ".spell-count-current")?.textContent || "0", 10);
						const max = parseInt(counter.querySelector(isCantrip ? ".cantrip-count-max" : ".spell-count-max")?.textContent || "0", 10);
						if (cur >= max) continue;
						const need = max - cur;
						const addBtns = Array.from(picker.querySelectorAll<HTMLButtonElement>("button.spell-toggle"))
							.filter(b => (b.textContent || "").trim() === "+");
						for (const btn of addBtns.slice(0, need)) {
							btn.click();
							total++;
						}
					}
				}
				return total;
			});
			if (clicked === 0) break;
			await this.page.waitForTimeout(250);
		}
	}

	// ========== COMPLETION ==========

	/**
	 * Click finish to complete level-up.
	 *
	 * The level-up wizard may pop additional confirmation modals
	 * after we click "Level Up to N" — most notably a
	 * "Skip Spell Selection?" prompt for prepared/known casters
	 * when we haven't picked the new spells. We auto-confirm
	 * (Skip) those so the test flow continues.
	 */
	async finish (): Promise<void> {
		const click = async () => {
			// Footer (Cancel + "Level Up to N") is appended to the modal
			// inner, NOT to `.charsheet__levelup-wizard` — they're
			// siblings. So we search at the modal level.
			const ok = await this.page.evaluate(() => {
				const wizard = document.querySelector(".charsheet__levelup-wizard");
				if (!wizard) return false;
				const modalInner = wizard.closest<HTMLElement>(".ve-ui-modal__inner");
				if (!modalInner) return false;
				const btn = modalInner.querySelector<HTMLButtonElement>('[data-testid="levelup-finish"]')
					|| Array.from(modalInner.querySelectorAll<HTMLButtonElement>("button"))
						.find(b => /Level Up to/i.test(b.textContent || ""));
				if (!btn) return false;
				(window as unknown as {__levelupErr?: string}).__levelupErr = undefined;
				const onErr = (e: ErrorEvent) => {
					(window as unknown as {__levelupErr?: string}).__levelupErr = String(e.error?.stack || e.message);
				};
				const onRej = (e: PromiseRejectionEvent) => {
					(window as unknown as {__levelupErr?: string}).__levelupErr = String(e.reason?.stack || e.reason);
				};
				window.addEventListener("error", onErr, {once: true});
				window.addEventListener("unhandledrejection", onRej, {once: true});
				btn.click();
				setTimeout(() => {
					window.removeEventListener("error", onErr);
					window.removeEventListener("unhandledrejection", onRej);
				}, 5000);
				return true;
			});
			if (ok) return true;
			const finishBtn = this.page.locator('.ve-ui-modal__inner [data-testid="levelup-finish"]');
			if (await finishBtn.count() > 0) {
				await finishBtn.first().click({force: true});
				return true;
			}
			return false;
		};
		await click();

		// After clicking, the wizard may either close immediately or pop a
		// confirmation prompt (e.g. "Skip Spell Selection?" for casters
		// who haven't picked all gained spells). Poll up to ~6s for a
		// prompt to appear and dismiss it; the wizard closes itself when
		// the prompt resolves.
		const deadline = Date.now() + 6000;
		while (Date.now() < deadline) {
			await this.page.waitForTimeout(250);
			const wizardOpen = await this.page.locator(".charsheet__levelup-wizard").isVisible().catch(() => false);
			if (!wizardOpen) break;

			const dismissed = await this.page.evaluate(() => {
				const inners = Array.from(document.querySelectorAll<HTMLElement>(".ve-ui-modal__inner"))
					// Exclude the level-up wizard's own modal — it's the
					// PARENT of `.charsheet__levelup-wizard`, so checking
					// `.closest()` doesn't filter it.
					.filter(m => !m.querySelector(".charsheet__levelup-wizard"));
				for (const m of inners) {
					const buttons = Array.from(m.querySelectorAll<HTMLButtonElement>("button"));
					if (!buttons.length) continue;
					const skip = buttons.find(b => /\bSkip\b/i.test(b.textContent || ""));
					const ok = buttons.find(b => /\bOK\b|\bContinue\b|\bYes\b/i.test(b.textContent || ""));
					const primary = buttons.find(b => b.classList.contains("ve-btn-primary"));
					(skip || ok || primary || buttons[0])?.click();
					return true;
				}
				return false;
			});
			if (dismissed) {
				await this.page.waitForTimeout(400);
				break;
			}
		}

		await this.page.waitForTimeout(300);

		// If the wizard is still visible at this point, dump diagnostics.
		const stillOpen = await this.page.locator(".charsheet__levelup-wizard").isVisible().catch(() => false);
		if (stillOpen) {
			const diag = await this.page.evaluate(() => {
				const wizard = document.querySelector(".charsheet__levelup-wizard");
				const err = (window as unknown as {__levelupErr?: string}).__levelupErr;
				const inners = Array.from(document.querySelectorAll(".ve-ui-modal__inner"));
				const innerSummary = inners.map(m => ({
					hasWizard: !!m.querySelector(".charsheet__levelup-wizard"),
					title: (m.querySelector("h4")?.textContent || "").trim().slice(0, 80),
					buttons: Array.from(m.querySelectorAll("button")).map(b => (b.textContent || "").trim()),
				}));
				const finishBtn = wizard?.querySelector('[data-testid="levelup-finish"]') as HTMLButtonElement | null;
				const allTestids = wizard
					? Array.from(wizard.querySelectorAll("[data-testid]")).map(e => e.getAttribute("data-testid"))
					: [];
				const wizardHtmlSnippet = wizard ? wizard.outerHTML.slice(-800) : null;
				const accordionDump = wizard
					? Array.from(wizard.querySelectorAll<HTMLElement>(".charsheet__levelup-accordion")).map(acc => {
						const id = acc.getAttribute("data-accordion-id");
						const title = (acc.querySelector(".charsheet__levelup-accordion-title")?.textContent || "").trim();
						const expanded = acc.classList.contains("expanded");
						const required = /⚠️\s*Required/.test(acc.textContent || "");
						const radios = Array.from(acc.querySelectorAll<HTMLInputElement>("input[type='radio']"))
							.map(r => ({
								name: r.name,
								value: r.value,
								checked: r.checked,
								disabled: r.disabled,
								label: ((r.closest("label") || r.parentElement)?.textContent || "").trim().slice(0, 80),
							}));
						return {id, title, expanded, required, radioCount: radios.length, radios: radios.slice(0, 8)};
					})
					: [];
				return {
					err: err || null,
					innerCount: inners.length,
					innerSummary,
					finishVisible: !!finishBtn,
					finishDisabled: finishBtn?.disabled,
					allTestids,
					wizardHtmlTail: wizardHtmlSnippet,
					accordionDump,
				};
			});
			// eslint-disable-next-line no-console
			console.log("[LevelUpPage.finish] wizard still open after dismiss loop:", JSON.stringify(diag, null, 2));
		}
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
	 * Cancel level-up
	 */
	async cancel (): Promise<void> {
		// Try data-testid first
		const cancelBtn = this.page.locator('[data-testid="levelup-cancel"]');
		if (await cancelBtn.count() > 0 && await cancelBtn.isVisible()) {
			await cancelBtn.click();
			await this.page.waitForTimeout(500);
			return;
		}
		// Fallback: button text in wizard container
		const closeBtn = this.page.locator(".charsheet__levelup-wizard button").filter({hasText: /Cancel/});
		if (await closeBtn.count() > 0 && await closeBtn.first().isVisible()) {
			await closeBtn.first().click();
			await this.page.waitForTimeout(500);
			return;
		}
		// Final fallback: default button in wizard
		const defaultBtn = this.page.locator(".charsheet__levelup-wizard .ve-btn-default");
		if (await defaultBtn.count() > 0 && await defaultBtn.first().isVisible()) {
			await defaultBtn.first().click();
			await this.page.waitForTimeout(500);
			return;
		}
		// Last resort: click modal overlay to close
		const overlay = this.page.locator(".ui-modal__overlay");
		if (await overlay.count() > 0) {
			await overlay.click({position: {x: 5, y: 5}});
			await this.page.waitForTimeout(500);
		}
	}

	/**
	 * Verify modal is closed after completion
	 */
	async expectModalClosed (): Promise<void> {
		await expect(this.modalContainer).not.toBeVisible({timeout: 10000});
	}

	/**
	 * Get progress percentage
	 */
	async getProgressPercentage (): Promise<number> {
		const text = await this.progressText.textContent();
		const match = text?.match(/(\d+)%/);
		return match ? parseInt(match[1], 10) : 0;
	}
}
