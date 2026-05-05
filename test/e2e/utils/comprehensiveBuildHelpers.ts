import {Page, expect} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  Comprehensive build helpers — inventory, signature spells, multiclass,
 *  milestone assertions.  Used by the per-character mega-specs added under
 *  test/e2e/specs/tgtt-*.spec.ts to give end-to-end coverage of L1→20
 *  builds for every TGTT player option exercised in the campaign.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Implementation notes:
 *  - The character sheet does not expose stable test-ids for every widget,
 *    so where possible we operate on the underlying state via
 *    `globalThis.charSheet` (which is exposed by the production code) to
 *    keep helpers resilient to layout/CSS churn.
 *  - When DOM-driven flows are required we always go through the same
 *    selectors as the existing POMs (`.charsheet__*`) so changes are
 *    centralised.
 */

// ───────────────────────────────────────────────────────────────────────
//  Inventory
// ───────────────────────────────────────────────────────────────────────

export interface InventoryItemRef {
	name: string;
	source?: string;
	/** If true and the item has charges, treat as attuned magic item. */
	attune?: boolean;
}

/**
 * Add a list of items (by exact name) to the character's inventory through
 * the running CharacterSheet runtime.  Uses charSheet._state public
 * mutators directly because the in-page add-item modal does not expose
 * stable test-ids for source filtering.
 *
 * Returns true if every item was successfully added.  Throws if the
 * runtime is not initialised.
 */
export async function addInventoryItems (page: Page, items: InventoryItemRef[]): Promise<void> {
	for (const item of items) {
		if (page.isClosed()) throw new Error("addInventoryItems: page closed mid-loop (earlier failure?)");
		const result = await page.evaluate(async ({name, source, attune}) => {
			const cs: any = (globalThis as any).charSheet;
			if (!cs?._state) return {ok: false, reason: "charSheet not initialised"};

			// Build the candidate list: original name + reformatted variants
			// (+N X ↔ X +N) so callers don't have to memorise which form
			// the data file uses for every magic variant.
			const nameVariants = new Set<string>([name]);
			const m1 = name.match(/^\+(\d+)\s+(.+)$/);
			if (m1) nameVariants.add(`${m1[2]} +${m1[1]}`);
			const m2 = name.match(/^(.+?)\s*,?\s*\+(\d+)$/);
			if (m2) nameVariants.add(`+${m2[2]} ${m2[1]}`);

			// Try DMG ↔ XDMG fallback for magic items that moved books.
			const sourceVariants = new Set<string>([source || "PHB"]);
			if (!source) sourceVariants.add("XPHB");
			else if (source.toUpperCase() === "DMG") sourceVariants.add("XDMG");
			else if (source.toUpperCase() === "XDMG") sourceVariants.add("DMG");
			else if (source.toUpperCase() === "PHB") sourceVariants.add("XPHB");
			else if (source.toUpperCase() === "XPHB") sourceVariants.add("PHB");

			// Attempt 1: use the public addItemByUid helper if available.
			if (typeof cs._state.addItemByName === "function") {
				for (const nm of nameVariants) {
					for (const src of sourceVariants) {
						try {
							await cs._state.addItemByName(nm, src, {attuned: !!attune});
							return {ok: true, via: `addItemByName(${nm}|${src})`};
						} catch (e: any) { /* fall through */ }
					}
				}
			}

			// Attempt 2: use DataLoader directly to fetch the canonical item
			// JSON, then push into the inventory array maintained by state.
			const DL: any = (globalThis as any).DataLoader;
			if (!DL?.pCacheAndGet) return {ok: false, reason: "no DataLoader"};
			let entry: any = null;
			for (const src of sourceVariants) {
				const allItems = await DL.pCacheAndGet("item", src, {isCopy: true}).catch(() => null);
				if (!Array.isArray(allItems)) continue;
				for (const nm of nameVariants) {
					entry = allItems.find((it: any) => it.name?.toLowerCase() === nm.toLowerCase());
					if (entry) break;
				}
				if (entry) break;
			}
			if (!entry) {
				// Fall back to scanning the global brew + site combined cache
				const all = await DL.pCacheAndGetAllSite?.("item").catch(() => []) || [];
				for (const nm of nameVariants) {
					entry = all.find((it: any) => it.name?.toLowerCase() === nm.toLowerCase());
					if (entry) break;
				}
			}
			if (!entry) return {ok: false, reason: `item not found: ${[...nameVariants].join("/")}|${[...sourceVariants].join("/")}`};

			// Prefer the proper state.addItem() — it runs the magic-item
			// bonus detection pipeline (AC, attack, save bonuses, ki DC,
			// etc.). Manual array-push only as a last resort because it
			// bypasses derived-stat updates.
			if (typeof cs._state.addItem === "function") {
				try {
					cs._state.addItem(entry, 1, !!attune, !!attune);
					// Inventory module owns the recalc that flows
					// bonusAc / bonusSavingThrow / bonusWeaponAttack
					// from equipped/attuned items into _data.ac.itemBonus
					// (etc.). Without this call the breakdown reads stale.
					cs._inventory?._updateArmorClass?.();
					cs.render?.();
					return {ok: true, via: `addItem(${entry.name}|${entry.source})`};
				} catch (e: any) { /* fall through to manual push */ }
			}

			const inv = cs._state._data?.inventory ?? cs._state.getInventory?.() ?? [];
			inv.push({
				_uid: `${entry.name}|${entry.source}|${Date.now()}`,
				name: entry.name,
				source: entry.source,
				quantity: 1,
				equipped: !!attune,
				attuned: !!attune,
			});
			if (cs._state._data) cs._state._data.inventory = inv;
			cs._state.markChanged?.();
			cs.render?.();
			return {ok: true, via: "manual-push"};
		}, {name: item.name, source: item.source, attune: item.attune});

		if (!result?.ok) {
			throw new Error(`addInventoryItems: failed to add "${item.name}|${item.source || "*"}" — ${result?.reason}`);
		}
	}
	await page.waitForTimeout(200);
}

/**
 * Read the displayed AC + a primary attack bonus.  Used by callers to
 * verify that adding magical equipment actually changes the derived
 * combat stats.
 */
export async function readCombatStats (charSheet: CharacterSheetPage): Promise<{ac: number; firstAttackBonus: number | null; spellSaveDc: number | null}> {
	const ac = await charSheet.getAC().catch(() => -1);
	const firstAttackBonus = await charSheet.page.evaluate(() => {
		const cs: any = (globalThis as any).charSheet;
		const atks = cs?._state?.getAttacks?.() || cs?._state?._data?.attacks || [];
		if (!Array.isArray(atks) || !atks.length) return null;
		const a = atks[0];
		return typeof a?.attackBonus === "number" ? a.attackBonus
			: typeof a?.toHit === "number" ? a.toHit : null;
	});
	const spellSaveDc = await charSheet.getSpellSaveDC().catch(() => null);
	return {ac, firstAttackBonus, spellSaveDc};
}

// ───────────────────────────────────────────────────────────────────────
//  Signature spell picker (for builder + level-up wizards)
// ───────────────────────────────────────────────────────────────────────

/**
 * Inside an *open* level-up wizard or builder spells step, attempt to
 * deterministically tick the named spells.  Falls back gracefully if a
 * spell isn't on the available list (e.g. wrong level prereq).
 */
export async function pickSignatureSpells (page: Page, spellNames: string[]): Promise<void> {
	for (const name of spellNames) {
		// Try the level-up known-spells accordion first
		const knownAccordion = page.locator('[data-accordion-id="knownspells"]');
		const builderRoot = page.locator("#charsheet-builder");

		const candidates = [
			knownAccordion.locator(".charsheet__modal-list-item").filter({hasText: name}).first(),
			builderRoot.locator(".charsheet__builder-spell-item").filter({hasText: name}).first(),
			page.locator(".charsheet__builder-list-item, .charsheet__modal-list-item").filter({hasText: name}).first(),
		];

		let added = false;
		for (const cand of candidates) {
			if (!(await cand.count())) continue;
			if (!(await cand.isVisible().catch(() => false))) continue;
			const toggle = cand.locator(".spell-toggle, button").filter({hasText: /add|\+/i}).first();
			if (await toggle.count() && await toggle.isVisible()) {
				await toggle.click().catch(() => {/* swallow */});
			} else {
				await cand.click().catch(() => {/* swallow */});
			}
			await page.waitForTimeout(120);
			added = true;
			break;
		}
		if (!added) {
			// Not fatal — log via console so the test harness can pick it up.
			// The caller's auto-fill will fill the remaining required slots.
			// eslint-disable-next-line no-console
			console.warn(`pickSignatureSpells: "${name}" not selectable in current view`);
		}
	}
}

// ───────────────────────────────────────────────────────────────────────
//  Multiclass
// ───────────────────────────────────────────────────────────────────────

export interface MulticlassOpts {
	className: string;
	classSource?: string;
	/** Subclass to take when the new class hits its subclass level. */
	subclassName?: string;
	subclassSource?: string;
}

/**
 * Add a multiclass entry to the existing character.  Drives the
 * `#charsheet-btn-multiclass` modal via the production runtime so we
 * inherit any future UI changes.  Skips ASI/feat picks via
 * autoFillAllSelections by re-using the existing LevelUpPage pattern.
 */
export async function startMulticlass (page: Page, opts: MulticlassOpts): Promise<void> {
	await page.locator("#charsheet-btn-multiclass").click();
	const modal = page.locator(".ve-ui-modal__inner, .ui-modal__inner").filter({hasText: /Multiclass/i}).last();
	await modal.waitFor({state: "visible", timeout: 10000});

	// Pick the requested class option, matching by name AND (when given)
	// source — multiple Druids/Wizards/etc. can appear when several
	// editions are loaded (PHB vs XPHB vs TGTT) and they share the
	// radio's `value` attribute, so name-only matching silently picks
	// the wrong source and breaks downstream subclass selection.
	const sourceAbbv = opts.classSource || null;
	const options = modal.locator(".charsheet__levelup-option");
	const optCount = await options.count();
	let picked = false;
	// First pass: strict name + source. Second pass: name only.
	for (const requireSource of (sourceAbbv ? [true, false] : [false])) {
		for (let i = 0; i < optCount; i++) {
			const opt = options.nth(i);
			const dataName = await opt.getAttribute("data-class-name");
			if (!dataName || dataName.toLowerCase() !== opts.className.toLowerCase()) continue;
			if (requireSource && sourceAbbv) {
				const text = (await opt.textContent()) || "";
				if (!text.includes(sourceAbbv)) continue;
			}
			await opt.scrollIntoViewIfNeeded();
			await opt.click({force: true});
			picked = true;
			break;
		}
		if (picked) break;
	}
	if (!picked) throw new Error(`startMulticlass: class "${opts.className}"${sourceAbbv ? ` (${sourceAbbv})` : ""} not in multiclass list`);

	// Confirm
	const confirmBtn = modal.getByRole("button", {name: /add|confirm|level|continue/i}).first();
	const totalLevelBefore = await page.evaluate(() => {
		const cs: any = (globalThis as any).charSheet;
		return cs?._state?.getTotalLevel?.() ?? 0;
	});
	await confirmBtn.click();
	await page.waitForTimeout(400);

	// Multiclass entry can trigger a chain of follow-up modals (Fighting
	// Style, skill grants, optional feature picks, spellcasting choices).
	// The original one-shot dismiss missed later modals and left the
	// page in a state where the next Level-Up button click was
	// intercepted, causing `waitForModal` to time out 10s later.
	//
	// Loop: while there's a visible non-toast modal, auto-tick its first
	// choice and click its primary action. Bounded to 20 iterations so a
	// genuine wedge surfaces as a clear error rather than a hang.
	for (let pass = 0; pass < 60; pass++) {
		// Step A: fill spell pickers ONE click per pass — clicking
		// triggers a re-render which detaches all sibling buttons,
		// so batching multiple clicks per evaluate silently fails
		// after the first one.
		const spellClicked = await page.evaluate(() => {
			const inners = Array.from(document.querySelectorAll<HTMLElement>(".ve-ui-modal__inner, .ui-modal__inner"))
				.filter(m => m.offsetParent !== null);
			if (!inners.length) return false;
			const m = inners[inners.length - 1];
			const pickers = Array.from(m.querySelectorAll<HTMLElement>(".charsheet__spell-picker-container"));
			for (const picker of pickers) {
				const counters = Array.from(picker.querySelectorAll<HTMLElement>(".spell-counter-value, .cantrip-counter-value"));
				for (const counter of counters) {
					const isCantrip = counter.classList.contains("cantrip-counter-value");
					const cur = parseInt(counter.querySelector(isCantrip ? ".cantrip-count-current" : ".spell-count-current")?.textContent || "0", 10);
					const max = parseInt(counter.querySelector(isCantrip ? ".cantrip-count-max" : ".spell-count-max")?.textContent || "0", 10);
					if (cur >= max) continue;
					// Find a `+` button whose item card is for the right
					// kind of spell (cantrip vs leveled). The spell-toggle
					// button has no level metadata, but the surrounding
					// `.charsheet__spell-picker-section` carries a title
					// like "✨ Cantrip" / "✨ Level 1" we can match on.
					const sections = Array.from(picker.querySelectorAll<HTMLElement>(".charsheet__spell-picker-section"));
					for (const sec of sections) {
						const title = (sec.querySelector(".charsheet__spell-picker-section-title")?.textContent || "").trim();
						const sectionIsCantrip = /cantrip/i.test(title);
						if (sectionIsCantrip !== isCantrip) continue;
						const addBtn = Array.from(sec.querySelectorAll<HTMLButtonElement>("button.spell-toggle"))
							.find(b => (b.textContent || "").trim() === "+");
						if (addBtn) {
							addBtn.click();
							return true;
						}
					}
				}
			}
			return false;
		});
		if (spellClicked) {
			await page.waitForTimeout(60);
			continue;
		}
		const dismissed = await page.evaluate(() => {
			const inners = Array.from(document.querySelectorAll<HTMLElement>(".ve-ui-modal__inner, .ui-modal__inner"))
				.filter(m => m.offsetParent !== null);
			if (!inners.length) return false;
			const m = inners[inners.length - 1];

			// Per-group ticking: each `.charsheet__levelup-feat-opt-group`
			// has its own "Choose N" header and counter. Tick checkboxes
			// inside each group up to N — the global checkbox loop
			// otherwise picks across groups indiscriminately and
			// over/under-fills.
			const groups = Array.from(m.querySelectorAll<HTMLElement>(".charsheet__levelup-feat-opt-group"));
			let anyClicked = false;
			for (const g of groups) {
				const headerText = (g.querySelector("p")?.textContent || "");
				const countMatch = headerText.match(/choose\s+(\d+)/i);
				if (!countMatch) continue;
				const target = parseInt(countMatch[1], 10);
				const checked = g.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked").length;
				if (checked >= target) continue;
				const toClick = Array.from(g.querySelectorAll<HTMLInputElement>("input[type='checkbox']:not(:checked)"))
					.filter(c => !c.disabled && c.offsetParent !== null);
				const need = target - checked;
				for (const cb of toClick.slice(0, need)) {
					cb.click();
					anyClicked = true;
				}
			}
			if (anyClicked) return "ticked";

			// Generic fallback for non-grouped checkboxes/radios.
			const limitMatch = (m.textContent || "").match(/(?:select|choose)\s+(\d+)/i);
			const limit = limitMatch ? parseInt(limitMatch[1], 10) : 1;
			const checkboxes = Array.from(m.querySelectorAll<HTMLInputElement>("input[type='checkbox']:not(:checked)"))
				.filter(c => !c.disabled && c.offsetParent !== null);
			const checkedCount = m.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked").length;
			const need = Math.max(0, limit - checkedCount);
			if (checkboxes.length && need > 0) {
				for (const cb of checkboxes.slice(0, need)) cb.click();
			} else {
				const firstChoice = m.querySelector<HTMLInputElement>("input[type='radio']:not(:checked)");
				if (firstChoice && !firstChoice.disabled) firstChoice.click();
			}
			const buttons = Array.from(m.querySelectorAll<HTMLButtonElement>("button"));
			const primary = buttons.find(b => /\b(confirm|add|finish|done|ok|continue|next|save|select)\b/i.test(b.textContent || "")
				&& !/cancel|back|skip/i.test(b.textContent || ""));
			if (primary && !primary.disabled) {
				primary.click();
				return true;
			}
			return false;
		});
		if (dismissed === "ticked") {
			await page.waitForTimeout(80);
			continue;
		}
		if (!dismissed) break;
		await page.waitForTimeout(150);
	}

	// Wait until the multiclass actually registered on state OR until
	// any leftover modal closes — whichever happens first. This avoids
	// returning early on a half-finished multiclass entry.
	const ok = await page.waitForFunction(
		(prev: number) => {
			const cs: any = (globalThis as any).charSheet;
			const lvl = cs?._state?.getTotalLevel?.() ?? 0;
			const modalsOpen = Array.from(document.querySelectorAll(".ve-ui-modal__inner, .ui-modal__inner"))
				.filter(m => (m as HTMLElement).offsetParent !== null).length > 0;
			return lvl > prev && !modalsOpen;
		},
		totalLevelBefore,
		{timeout: 8000},
	).then(() => true).catch(() => false);

	if (!ok) {
		const diag = await page.evaluate(() => {
			const inners = Array.from(document.querySelectorAll<HTMLElement>(".ve-ui-modal__inner, .ui-modal__inner"))
				.filter(m => m.offsetParent !== null);
			const m = inners[inners.length - 1];
			const cs: any = (globalThis as any).charSheet;
			return {
				level: cs?._state?.getTotalLevel?.(),
				classes: (cs?._state?._data?.classes || []).map((c: any) => `${c.name}|${c.source}|${c.level}`),
				modalCount: inners.length,
				modalText: m ? (m.textContent || "").slice(0, 400) : null,
				spellCounters: m ? Array.from(m.querySelectorAll(".spell-counter-value, .cantrip-counter-value")).map(el => (el as HTMLElement).textContent?.trim()) : null,
				addBtnCount: m ? m.querySelectorAll("button.spell-toggle").length : 0,
				visibleAddBtnCount: m ? Array.from(m.querySelectorAll("button.spell-toggle")).filter(b => (b as HTMLElement).offsetParent !== null && (b.textContent || "").trim() === "+").length : 0,
				toastWarnings: Array.from(document.querySelectorAll(".toast, .alert-warning")).map(el => (el as HTMLElement).textContent?.trim()).slice(0, 3),
			};
		});
		throw new Error(`startMulticlass: failed to register class. diag=${JSON.stringify(diag)}`);
	}

	await page.waitForTimeout(300);
}

// ───────────────────────────────────────────────────────────────────────
//  Milestone assertion pack
// ───────────────────────────────────────────────────────────────────────

export interface MilestoneExpect {
	/** Total character level to assert against. */
	totalLevel: number;
	/** Optional proficiency bonus (8/2 + ceil(L/4)). */
	proficiencyBonus?: number;
	/** Minimum max HP — class hit-die averages add up rapidly so we use ≥. */
	minMaxHp?: number;
	/** Optional maximum AC sanity check (e.g. 10..30). */
	acRange?: [number, number];
	/** Spell slots that must exist with `max ≥ count`. Map of slotLevel→minMax. */
	spellSlots?: Record<number, number>;
	/** Pact slots {level≥X, max≥Y}. */
	pactSlots?: {level?: number; max?: number};
	/** Names of feature toggles that must be present on the Features tab. */
	expectToggles?: (string | RegExp)[];
	/** Resource trackers that must exist with max≥value. */
	expectResources?: Record<string, number>;
}

export async function assertMilestone (charSheet: CharacterSheetPage, expected: MilestoneExpect): Promise<void> {
	await charSheet.expectLevel(expected.totalLevel);

	if (expected.minMaxHp != null) {
		const maxHp = await charSheet.getMaxHp();
		expect(maxHp, "max HP").toBeGreaterThanOrEqual(expected.minMaxHp);
	}

	if (expected.acRange) {
		const ac = await charSheet.getAC();
		expect(ac, "AC sanity").toBeGreaterThanOrEqual(expected.acRange[0]);
		expect(ac, "AC sanity").toBeLessThanOrEqual(expected.acRange[1]);
	}

	if (expected.spellSlots) {
		for (const [lvlStr, minMax] of Object.entries(expected.spellSlots)) {
			const lvl = parseInt(lvlStr, 10);
			const slots = await charSheet.getSpellSlots(lvl).catch(() => ({current: 0, max: 0}));
			expect(slots.max, `slots L${lvl}`).toBeGreaterThanOrEqual(minMax);
		}
	}

	if (expected.pactSlots) {
		const p = await charSheet.getPactSlots().catch(() => ({current: 0, max: 0, level: 0}));
		if (expected.pactSlots.level != null) expect(p.level, "pact slot level").toBeGreaterThanOrEqual(expected.pactSlots.level);
		if (expected.pactSlots.max != null) expect(p.max, "pact slot max").toBeGreaterThanOrEqual(expected.pactSlots.max);
	}

	if (expected.expectToggles?.length) {
		const features = await charSheet.getActivatableFeatureNames();
		for (const want of expected.expectToggles) {
			const re = want instanceof RegExp ? want : new RegExp(want, "i");
			expect(features.some(f => re.test(f)), `expected toggle matching ${re}`).toBe(true);
		}
	}

	if (expected.expectResources) {
		for (const [name, minMax] of Object.entries(expected.expectResources)) {
			const r = await charSheet.getResource(name).catch(() => ({current: 0, max: 0}));
			expect(r.max, `resource ${name}`).toBeGreaterThanOrEqual(minMax);
		}
	}
}

// ───────────────────────────────────────────────────────────────────────
//  Toggle effect probe
// ───────────────────────────────────────────────────────────────────────

/**
 * Activate a feature toggle (e.g. Bladesong, Rage), capture the AC and
 * spell-DC delta, then deactivate.  Returns the deltas so callers can
 * assert that toggling actually changes derived stats.
 */
export async function probeToggleDelta (
	charSheet: CharacterSheetPage,
	featureName: string | RegExp,
): Promise<{acDelta: number; dcDelta: number} | null> {
	const re = featureName instanceof RegExp ? featureName : new RegExp(featureName, "i");
	if (charSheet.page.isClosed()) throw new Error(`probeToggleDelta(${re}): page already closed`);
	const features = await charSheet.getToggleableFeatureNames();
	const match = features.find(f => re.test(f));
	// No toggleable feature matches — return null so the spec can decide
	// whether to skip or assert. Many classes (Cleric, Warlock,
	// resource-driven casters) have signature mechanics that aren't
	// expressed as on/off toggles, and that's not a product bug.
	if (!match) return null;

	const acBefore = await charSheet.getAC().catch(() => -1);
	const dcBefore = await charSheet.getSpellSaveDC().catch(() => -1);

	await charSheet.activateFeature(match);
	await charSheet.page.waitForTimeout(250);

	const acAfter = await charSheet.getAC().catch(() => acBefore);
	const dcAfter = await charSheet.getSpellSaveDC().catch(() => dcBefore);

	// toggle off so subsequent assertions see the resting baseline
	await charSheet.deactivateFeature(match);
	await charSheet.page.waitForTimeout(150);

	return {acDelta: acAfter - acBefore, dcDelta: dcAfter - dcBefore};
}
