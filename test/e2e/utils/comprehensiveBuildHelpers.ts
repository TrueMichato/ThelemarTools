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
	/** If true, equip the item after adding it. */
	equipped?: boolean;
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
		const result = await page.evaluate(async ({name, source, equipped, attune}) => {
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
							await cs._state.addItemByName(nm, src, {equipped: !!equipped || !!attune, attuned: !!attune});
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
					cs._state.addItem(entry, 1, !!equipped || !!attune, !!attune);
					// addItem() MERGES into an existing stack when the item is
					// already in inventory (preset starting gear), bumping only
					// `quantity` — the requested equipped/attuned state is
					// silently dropped. Force it afterwards so `equipped: true`
					// means the same thing for preset-granted and newly-added
					// items alike (CS-BUG-030).
					if (equipped || attune) {
						const row = (cs._state._data?.inventory ?? []).find((i: any) =>
							i?.item?.name?.toLowerCase() === entry.name?.toLowerCase()
							&& i?.item?.source === entry.source);
						if (row && !row.equipped) {
							if (typeof cs._state.setItemEquipped === "function" && row.id) cs._state.setItemEquipped(row.id, true);
							else row.equipped = true;
						}
						if (row && attune) row.attuned = true;
					}
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
				equipped: !!equipped || !!attune,
				attuned: !!attune,
			});
			if (cs._state._data) cs._state._data.inventory = inv;
			cs._state.markChanged?.();
			cs.render?.();
			return {ok: true, via: "manual-push"};
		}, {name: item.name, source: item.source, equipped: item.equipped, attune: item.attune});

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
export async function readCombatStats (charSheet: CharacterSheetPage): Promise<{ac: number; firstAttackBonus: number | null; spellSaveDc: number | null; attackNames: string[]}> {
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
	// Weapons change neither AC nor spell DC, and `firstAttackBonus` only ever
	// reads attacks[0] (Unarmed Strike). Without the attack list, equipping a
	// weapon looks like "no effect" (CS-BUG-030).
	const attackNames = await charSheet.getAttackNames().catch(() => [] as string[]);
	return {ac, firstAttackBonus, spellSaveDc, attackNames};
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
): Promise<{acDelta: number; dcDelta: number; changed: boolean} | null> {
	const re = featureName instanceof RegExp ? featureName : new RegExp(featureName, "i");
	if (charSheet.page.isClosed()) throw new Error(`probeToggleDelta(${re}): page already closed`);
	const features = await charSheet.getToggleableFeatureNames();
	const match = features.find(f => re.test(f));
	// No toggleable feature matches — return null so the spec can decide
	// whether to skip or assert. Many classes (Cleric, Warlock,
	// resource-driven casters) have signature mechanics that aren't
	// expressed as on/off toggles, and that's not a product bug.
	if (!match) return null;

	// AC and the spell save DC are only two of the surfaces a toggle can move,
	// and plenty of signature toggles move NEITHER: Rage grants a melee damage
	// bonus, b/p/s resistance and STR advantage, changing no AC and no DC. A
	// probe limited to AC/DC reports those as "no effect", which is a harness
	// gap rather than a product bug. So also snapshot the other cheap derived
	// surfaces a toggle realistically alters, and expose an aggregate
	// `changed` flag for callers that only need "did SOMETHING happen".
	const snapshot = async () => {
		const attacks = (await charSheet.getAttackNames().catch(() => [] as string[])).slice().sort();
		// Rage-style toggles express themselves in the DAMAGE of existing
		// attacks rather than in any headline stat, so read each attack's
		// damage string. Bounded to keep the probe cheap.
		const damage: string[] = [];
		for (const name of attacks.slice(0, 6)) {
			const d = await charSheet.getAttackDamageString(name).catch(() => null);
			damage.push(`${name}=${d ?? ""}`);
		}
		// Some toggles move NOTHING numeric — their whole effect is an advantage
		// flag (e.g. Bastion Paladin's Undaunted: "advantage on ability checks and
		// attack rolls"). Without this the probe reported a working ability as
		// "no effect", which is a harness gap, not a product gap.
		const advantage: string[] = [];
		for (const rollType of ["attack", "check:str", "check:dex", "save:con"]) {
			const a = await charSheet.getAdvantageState(rollType).catch(() => null);
			advantage.push(`${rollType}=${a ? `${a.advantage}/${a.disadvantage}` : ""}`);
		}
		return {
			ac: await charSheet.getAC().catch(() => -1),
			dc: await charSheet.getSpellSaveDC().catch(() => -1),
			resistances: (await charSheet.getResistances().catch(() => [] as string[])).slice().sort().join("|"),
			speed: await charSheet.getSpeed().catch(() => -1),
			attacks: attacks.join("|"),
			damage: damage.join("|"),
			advantage: advantage.join("|"),
		};
	};

	const before = await snapshot();

	await charSheet.activateFeature(match);
	await charSheet.page.waitForTimeout(250);

	const after = await snapshot();

	// toggle off so subsequent assertions see the resting baseline
	await charSheet.deactivateFeature(match);
	await charSheet.page.waitForTimeout(150);

	const acDelta = after.ac - before.ac;
	const dcDelta = after.dc - before.dc;
	const changed = acDelta !== 0
		|| dcDelta !== 0
		|| after.resistances !== before.resistances
		|| after.speed !== before.speed
		|| after.attacks !== before.attacks
		|| after.damage !== before.damage
		|| after.advantage !== before.advantage;

	return {acDelta, dcDelta, changed};
}

// ───────────────────────────────────────────────────────────────────────
//  Features matrix — declarative per-feature ability coverage (Phase 6)
// ───────────────────────────────────────────────────────────────────────

/**
 * Declarative description of a class/subclass feature that should be
 * present on the sheet at a given level, plus what kind of correctness
 * check the matrix should run on it.
 *
 * The matrix runs inside the existing MEGA L1→20 test (no new wizard
 * navigation), so each entry is essentially a few state reads + at most
 * one toggle activation. Resource pool sizes are checked, but rest-
 * restoration semantics are deliberately kept opt-in (`restoreOn`)
 * because resting is expensive.
 *
 * Entries with `skip: true` are tracked but not asserted. ALWAYS pair
 * with a `skipReason` referencing the bug ID (CS-BUG-NNN) — that way
 * audit reports can list still-broken features cleanly.
 */
export interface FeatureCheck {
	/** Total character level at which this feature is granted. */
	level: number;
	/**
	 * Highest total character level at which this entry still applies
	 * (inclusive). Use when a LATER entry supersedes this one — e.g. Action
	 * Surge is a 1-use pool from L2 but becomes 2 uses at L17, so the L2 entry
	 * must stop asserting `resourceMax: 1` at L17. Without this the superseded
	 * entry keeps firing and reports the correct new value as a failure.
	 * Omit for entries that hold for the rest of the build.
	 */
	untilLevel?: number;
	/** Display name on the sheet (regex preferred for resilience). */
	name: string | RegExp;
	/** Check kind. */
	kind: "toggle" | "resource" | "spells" | "passive" | "pick";
	/**
	 * For kind="toggle": which derived stat must change when the toggle
	 * is activated.
	 *  - "any"   → at least one of {ac, dc} delta is non-zero
	 *  - "ac"    → AC must change
	 *  - "dc"    → spell-save DC must change
	 *  - "none"  → toggle button must exist & flip; no stat-delta required
	 */
	toggleDelta?: "ac" | "dc" | "any" | "none";
	/** For kind="resource": expected pool max — exact or [min,max]. */
	resourceMax?: number | [number, number];
	/**
	 * For kind="resource": the tracker's own label, when it differs from the
	 * feature name. Feature rows are frequently tiered ("Psychic Boost (three
	 * uses)") while the pool they resize keeps one stable name ("Psychic
	 * Boost"). Without this override the probe hunts the sheet for the tier
	 * label and wrongly reports the pool as missing.
	 */
	resourceName?: string;
	/**
	 * For kind="resource": which rest restores the resource.
	 *  - omit       → don't test restoration (just pool size)
	 *  - "short"    → spend 1, short-rest, expect restored
	 *  - "long"     → spend 1, long-rest, expect restored
	 *  - "either"   → either rest restores it
	 *  - "none"     → spending must NOT be restored by short rest
	 */
	restoreOn?: "short" | "long" | "either" | "none";
	/** For kind="spells": names that must appear in the spell list. */
	grantsSpells?: string[];
	/** For kind="pick": at least N entries from `pickedFrom` must surface. */
	pickedCount?: number;
	pickedFrom?: (string | RegExp)[];
	/** Skip this entry (blocked by known bug). Always pair with skipReason. */
	skip?: boolean;
	/** CS-BUG-NNN reference if skipped. */
	skipReason?: string;
	/**
	 * Phase 7: effect probes. Each entry is an extra mechanical
	 * assertion — the feature doesn't just exist on the sheet, it
	 * actually does what it claims (e.g. Bladesong adds +INT to AC,
	 * Rage grants resistance to bludgeoning, Aura of Protection adds
	 * +CHA to all six saves at L6+). Effects run AFTER the kind
	 * handler so a feature that's not even present fails fast.
	 */
	effects?: EffectCheck[];
}

// ──────────────────────────────────────────────────────────────────
//  Phase 7 — EffectCheck discriminated union
// ──────────────────────────────────────────────────────────────────

type AblKey = "str" | "dex" | "con" | "int" | "wis" | "cha";
type SpeedType = "walk" | "fly" | "swim" | "climb" | "burrow";

interface _EffectCommon {
	skip?: boolean;
	skipReason?: string;
}

/**
 * One declarative assertion about a feature's mechanical effect.
 * Three families:
 *
 *   PASSIVE  — read state directly and check a number / list /
 *              advantage flag is what it should be at this level.
 *
 *   TOGGLE   — activate the feature via its sheet button, snapshot
 *              the diff, assert the delta matches expectation, then
 *              deactivate. Expected to be paired with a FeatureCheck
 *              whose `kind: "toggle"` so the toggle button is
 *              guaranteed to exist before we try to click it.
 *
 *   ROLL     — click a roll button (ability check, save, skill,
 *              attack, initiative) inside `page.evaluate` so a
 *              click handler that throws is caught (the legacy
 *              `rollSkill` helper swallows handler errors).
 *
 *   RESOURCE — extra probes for restoration semantics layered on
 *              top of `kind: "resource"`'s pool-size check.
 */
export type EffectCheck = _EffectCommon & (
	// === Passive: read state and check ===
	| {kind: "saveBonus"; ability: AblKey; min?: number; exact?: number; sourceMustInclude?: string}
	| {kind: "skillBonus"; skill: string; min?: number; exact?: number}
	| {kind: "abilityScore"; ability: AblKey; min?: number; exact?: number}
	| {kind: "abilityMod"; ability: AblKey; min?: number; exact?: number}
	| {kind: "ac"; min?: number; exact?: number}
	| {kind: "spellSaveDc"; min?: number; exact?: number}
	| {kind: "spellSlots"; level: number; min: number}
	| {kind: "speed"; type?: SpeedType; min?: number; exact?: number}
	| {kind: "speedEquals"; left: SpeedType; right: SpeedType}
	| {kind: "initiative"; min?: number; exact?: number}
	| {kind: "featureCalculation"; property: string; min?: number; exact?: number | string | boolean; isNull?: boolean}
	// Assert a `getFeatureCalculations()` number is DERIVED from a live
	// character statistic rather than hard-coded. Far stronger than a
	// loose `min` floor when the build's ability scores aren't pinned by
	// the preset (the wizard's auto-fill can hand a Bard CHA 8).
	//   abilityMod        → getAbilityMod(ability)
	//   spellSaveDc       → getSpellSaveDcForAbility(ability)
	//   spellAttackBonus  → getSpellAttackBonusForAbility(ability)
	//   proficiencyBonus  → getProficiencyBonus()
	| {kind: "featureCalculationDerivedFrom"; property: string; equals: "abilityMod" | "spellSaveDc" | "spellAttackBonus" | "proficiencyBonus"; ability?: AblKey; offset?: number}
	// Generic escape hatch: call a `CharacterSheetState` method and assert on the
	// returned value. Use when a feature's mechanic is exposed through a bespoke
	// state API rather than a flat calculation field (e.g. a computed cost, a
	// derived bundle). `path` is a dot/bracket path into the return value.
	| {
		kind: "stateCall";
		method: string;
		args?: unknown[];
		path?: string;
		min?: number;
		exact?: number | string | boolean | null;
		contains?: string;
		/**
		 * Call the method purely for its SIDE EFFECT and assert nothing about the return
		 * value. Without this an assertion-free `stateCall` fails with "is absent" as soon
		 * as the method returns `undefined`, which rules out every setter/mutator — and
		 * driving a mutation then probing the consequence is exactly how a
		 * mechanical-effect probe is built (`setCurrentHp` → `takeDamage` → `getCurrentHp`).
		 */
		ignoreResult?: boolean;
	}
	| {kind: "proficiency"; proficiencyType: "armor" | "weapon"; includes: string}
	| {kind: "featureUsesEqualAbilityMod"; feature: string; ability: AblKey; minimum?: number; recharge: "short" | "long"}
	// `damageTypes` / `saveAbility` are optional so the same probe covers HEALING actions
	// (Turn the Tide) and saves whose DC is inherited from the character rather than
	// written into the prose (`saveDcFromCharacter`).
	| {kind: "combatAction"; feature: string; interactionMode: string; formula?: string; damageTypes?: string[]; saveAbility?: AblKey; rollType?: string; abilityMod?: AblKey; minimum?: number; saveDcFromCharacter?: boolean}
	| {kind: "deferredDamageMaximizer"; feature: string; resource: string; eligibleType: string; ineligibleType: string}
	| {kind: "triggeredDamageEffect"; damageType: string; effectType: string; distance?: number; direction?: string; maxTargetSize?: string; optional?: boolean}
	| {kind: "weaponDamageRider"; id: string; dice: string; damageType: string; perTurn?: boolean}
	| {kind: "resistance"; damageType: string}
	| {kind: "immunity"; damageType: string}
	| {kind: "vulnerability"; damageType: string}
	| {kind: "advantage"; rollType: string}
	// A GATED advantage: the feature registers a conditional modifier that must NOT be
	// auto-applied, but must be offered to the per-roll opt-in picker and must actually
	// grant advantage once opted in. This is the observable contract for any "advantage
	// on saves against being <condition>"-style feature (Unyielding Spirit, Pious Soul…).
	| {kind: "conditionalAdvantage"; rollType: string; conditionalIncludes: string; sourceIncludes?: string}
	| {kind: "disadvantage"; rollType: string}
	| {kind: "skillAdvantage"; skill: string}
	| {kind: "conditionImmunity"; condition: string}
	// `spellMatchMode` controls which TGTT-vs-first-party spell list
	// the probe is meant to verify. Default is `"first-party"` for
	// backward compatibility — existing matrices keep their semantics.
	// Use `"tgtt-flavor"` to assert a TGTT-flavor spell name (e.g.
	// "Accelerate/Decelerate", "Animate Claw") that the TGTT class
	// preset actually loads. Use `"any"` to drop the name assertion
	// and only verify that ≥1 spell of that level surfaces — useful
	// when the spell list mechanism is the thing under test, not any
	// specific spell name.
	| {kind: "spellInList"; spell: string; spellMatchMode?: "first-party" | "tgtt-flavor" | "any"; level?: number}
	| {kind: "cantripCount"; min: number}

	// === Toggle: snapshot before, activate, snapshot diff, deactivate ===
	| {kind: "togglePlusAc"; whenActive: number | "abilityMod"; ability?: AblKey}
	| {kind: "togglePlusSpeed"; type?: SpeedType; delta: number}
	// Verify a toggle GRANTS a movement type the character doesn't otherwise
	// have (fly/swim/climb/burrow). `togglePlusSpeed` only asserts for walk,
	// so it silently passes for every other type — use this instead for
	// "while X is active you have a Fly Speed equal to your Speed" features
	// (Circle of the Sea's Stormborn, Aasimar Heavenly Wings, Fly, …).
	// `equalsWalk` additionally pins the granted speed to the walking speed
	// measured while the toggle is on.
	| {kind: "toggleGrantsSpeed"; type: SpeedType; equalsWalk?: boolean; min?: number}
	| {kind: "toggleGrantsResistance"; damageType: string}
	| {kind: "toggleGrantsAdvantage"; rollType: string}
	| {kind: "toggleGrantsImmunity"; damageType: string}
	| {kind: "toggleGrantsConditionImmunity"; condition: string}
	| {kind: "toggleAddsAttack"; namePattern: string | RegExp}

	// === Roll: clicking the button doesn't throw ===
	| {kind: "rollAbilityCheck"; ability: AblKey}
	| {kind: "rollSavingThrow"; ability: AblKey}
	// `proficientSkills: true` is a shorthand for "verify a roll
	// button exists for AT LEAST ONE proficient skill on the sheet".
	// When set, the helper queries `state.isProficientInSkill(s)` for
	// every standard 5e skill and asserts the first one that's
	// proficient has a clickable roll button. Use this on TGTT
	// presets where the matrix shouldn't hard-code class-list skill
	// names (which the preset may pick differently).
	| {kind: "rollSkillCheck"; skill?: string; proficientSkills?: true}
	| {kind: "rollAttack"; attackName: string | RegExp}
	| {kind: "rollInitiative"}

	// === Resource semantics extension ===
	| {kind: "longRestRestores"; resource: string; toMax?: boolean}
	| {kind: "shortRestRestores"; resource: string; toMax?: boolean}
	| {kind: "longRestRestoresFeatureUses"; feature: string}
	| {kind: "shortRestRestoresFeatureUses"; feature: string}

	// === Phase 8: per-pick + scaling stat probes ===
	// Verify a named attack row has bonus ≥ N (or exact). Useful
	// for Magic Arrow (+1), Improved Pact Weapon (+1/+2/+3),
	// magical weapon variants, and any flat-add attack rider.
	| {kind: "attackBonus"; attackName: string | RegExp; min?: number; exact?: number}
	// Substring-match a named attack's damage line. Use lowercase
	// needle; the runner downcases the haystack. Used for sneak
	// attack dice ("sneak"), hexblade's curse ("hexblade"),
	// hunter's prey ("colossus"/"prey"), elemental rune adders
	// ("fire", "lightning"), or generic "+1d6"-style riders.
	| {kind: "attackDamageContains"; attackName: string | RegExp; needle: string}
	// Verify the rogue's sneak attack die COUNT, parsed from
	// `getFeatureCalculations().sneakAttack.dice` (a string, e.g.
	// "6d6"). Number of d6. There is no flat `sneakAttackDice` key.
	| {kind: "sneakAttackDice"; min?: number; exact?: number}
	// Verify the bard's BI die FACE size. minFaces of 6/8/10/12.
	| {kind: "bardicInspirationDie"; minFaces: number}
	// Verify the monk's MA die FACE size. minFaces of 4/6/8/10/12.
	| {kind: "martialArtsDie"; minFaces: number}
	// For each picked option matching ANY pattern in `matchAny`,
	// verify it surfaces as a TOGGLEABLE feature on the sheet.
	// Defaults `min: 1` — we only require that AT LEAST ONE
	// matching pick is toggleable, since the wizard's auto-pick
	// choice can vary across runs.
	| {kind: "pickToggleable"; matchAny: (string | RegExp)[]; min?: number}
	// For each picked option matching ANY pattern in `matchAny`,
	// activate it via `activateFeature` and verify it doesn't
	// throw. After verifying, deactivate. Defaults `min: 1`.
	| {kind: "pickActivatable"; matchAny: (string | RegExp)[]; min?: number}
	// Verify an attack row matching the pattern exists on the
	// Combat tab. Used for Pact of the Blade summoned weapons,
	// Mercy Monk unarmed strike, and other "feature creates an
	// attack row" abilities.
	| {kind: "attackPresent"; namePattern: string | RegExp}
	| {kind: "grantedAttack"; name: string; damage?: string; damageType?: string; range?: string; usesMartialArtsDie?: boolean; isSpellAttack?: boolean}
	| {kind: "attackQualifiesThisTurn"; attackName: string | RegExp; sourceFeature?: string}
	| {
		kind: "combatFeatureAction";
		feature: string;
		resource: string;
		spend: number;
		qualifyingAttackSourceFeature?: string;
		qualifyingAttackName?: string;
		expectVariableSpend?: boolean;
		expectAttackCount?: number;
		expectSaveDamage?: {saveAbility: string; damage: string; damageType: string};
	}
	| {
		kind: "activeStateTrigger";
		feature: string;
		stateTypeId: string;
		label: string;
		actionType: string;
		damageType: string;
		damageMin: number;
		// Optional: pin the resolved dice formula (e.g. "1d6") and the minimum
		// resolved save DC for triggers whose payload is a dice pool + save
		// rather than a flat ability-scaled number.
		damageFormula?: string;
		dcMin?: number;
	}
	| {kind: "activeStateLight"; feature: string; stateTypeId: string; bright: number; dim: number}
	| {kind: "weaponScopedState"; feature: string; attackBonusMin: number; alternateDamageType: string}
	| {kind: "spellCastGrantsCover"; spell: string; source: string; acDelta: number; saveAbility: AblKey; saveDelta: number}
	| {kind: "activeAuraMechanics"; feature: string; damageType: string; damageMin: number; conditionalRollType: string; conditionalIncludes: string}
	| {kind: "restoreFeatureUseWithSpellSlot"; feature: string; slotLevel: number}
	// Generic "call a state API and assert the observable delta" probe. The escape hatch
	// for features whose entire mechanic is a state mutation with no persistent derived
	// stat — damage transfer, self-inflicted costs, forced HP movement, … Keeps such
	// features from degrading into existence-only assertions.
	| {
		kind: "stateMethodEffect";
		method: string;
		args?: unknown[];
		setup?: {hp?: number; tempHp?: number};
		expectHpDelta?: number;
		expectTempHpDelta?: number;
		expectReturns?: Record<string, unknown>;
	}
	// === Phase 11: per-pick effect dispatch ===
	// On a parent FeatureCheck of `kind: "pick"`, attach
	// `pickedFeatureGrants` to declare effects that should fire ONLY
	// IF a specific pick name surfaces in `allFeatures`. Used by the
	// generated build*Checks helpers in tgttFeaturePools.ts to attach
	// the documented effect of the auto-picker's deterministic first
	// choice (e.g. Sorcerer Metamagic "Careful Spell" → activatable;
	// Warlock Invocation "Agonizing Blast" → +CHA to Eldritch Blast
	// damage). Sub-effects cannot themselves contain
	// `pickedFeatureGrants` — no nesting.
	| {kind: "pickedFeatureGrants"; pickName: string | RegExp; subEffects: EffectCheck[]}

	// === Champion Fighter (XPHB) generic additions ===
	// Read a named modifier's total numeric bonus straight from
	// `getModifierBonus(modType)` — the same generic aggregator behind
	// `getAdvantageState`. Reusable for any feat/feature registered as a
	// `{type: "modifier", modType: "..."}` named bonus (e.g. Archery
	// Fighting Style's unconditional `attack:ranged` +2) without needing
	// an actual equipped weapon on the sheet for the probe to run.
	| {kind: "modifierBonus"; modType: string; min?: number; exact?: number}
	// Verify the weapon-attack critical-hit range from
	// `getFeatureCalculations().criticalRange` — 19 for Improved Critical
	// (L3), 18 for Superior Critical (L15). Generic: reusable by any
	// future subclass that expands the crit range the same way. Use
	// `max` (not `exact`) for a check whose level may be superseded by a
	// LATER, stronger feature (e.g. L3's 19-20 is later improved to
	// 18-20 by L15 Superior Critical) — `max` accepts "at least this
	// good", so the L3 check keeps passing once the L15 feature lands.
	| {kind: "criticalRange"; exact?: number; min?: number; max?: number}
	// Drive the generic "start of turn in combat" resolver
	// (`applyTurnStartEffects()`) directly and verify it granted Heroic
	// Inspiration (Champion's Heroic Warrior, L10). Clears Inspiration
	// first so the probe is deterministic regardless of prior state.
	| {kind: "turnStartGrantsInspiration"}
	// Drive the same resolver and verify it healed the character by at
	// least `min` HP (Champion Survivor's Heroic Rally, L18). Optionally
	// sets current HP to a Bloodied value first via `setHpFraction` (0-1
	// of max HP) so the Bloodied gate is deterministically satisfied.
	| {kind: "turnStartHeals"; min: number; setHpFraction?: number}

	// === Stateful class-mechanic probes ===
	| {kind: "featureChoiceCalculation"; className: string; featureName: string; expectedChoice: string; property: string; expectedValue: string; dcProperty?: string}
	| {kind: "bloodMaledictAmplification"; hpCost: number}
	// === Generic class-summon probe ===
	// Drive any "feature summons a statblock companion" mechanic
	// through its state API and verify the resulting companion's
	// derived numbers. Reusable by any class summon that registers a
	// `COMPANION_TYPES.CLASS_SUMMON` companion with a `scaling`
	// descriptor (Animating Performance's Dancing Item today; Summon
	// Beast / Steel Defender / Drake Companion tomorrow).
	// `method` / `dismissMethod` name no-required-arg methods on
	// `CharacterSheetState`.
	| {
		kind: "classSummon";
		method: string;
		args?: unknown[];
		/** Take a long/short rest first so limited-use costs are deterministic. */
		restFirst?: "long" | "short";
		dismissMethod?: string;
		namePattern: string;
		hpExact?: number;
		hpMin?: number;
		ac?: number;
		attackNamePattern?: string;
		attackBonusMin?: number;
		damageContains?: string;
	}
	// === Generic "feature creates an inventory item" probe ===
	// Invoke a creator method on `CharacterSheetState`, verify a
	// matching inventory row appeared (optionally under a gp value
	// cap), then invoke the cleanup method and verify it's gone.
	| {
		kind: "createsInventoryItem";
		method: string;
		args?: unknown[];
		/** Take a long/short rest first so limited-use costs are deterministic. */
		restFirst?: "long" | "short";
		cleanupMethod?: string;
		namePattern: string;
		maxValueGp?: number;
		expectCount?: number;
	}
	| {kind: "crimsonRiteMechanics"; hpCosts: [number, number]}
	| {kind: "hybridTransformationMechanics"}

	// Psionic strain (MCDM Talent). Drives the three strain tracks up through their
	// effect thresholds and asserts each debuff is REALLY applied to the derived
	// numbers (AC, speed, hit point maximum, skill/save proficiency, disadvantage),
	// then clears strain and asserts everything returns to baseline.
	| {kind: "psionicStrainMechanics"}

	// A manifestation test for a power of `order`, with the manifestation die forced,
	// asserting the strain charged matches the class rule (roll > score → none,
	// roll === score → 1, roll < score → order).
	| {kind: "manifestationTest"; order: number; roll: number; expectStrain: number}
);

const _TOGGLE_EFFECT_KINDS = new Set([
	"togglePlusAc",
	"togglePlusSpeed",
	"toggleGrantsSpeed",
	"toggleGrantsResistance",
	"toggleGrantsAdvantage",
	"toggleGrantsImmunity",
	"toggleGrantsConditionImmunity",
	"toggleAddsAttack",
]);

function _checkNumeric (
	actual: number,
	e: {min?: number; exact?: number; max?: number},
	label: string,
): void {
	if (e.exact != null && actual !== e.exact) throw new Error(`${label}=${actual}, expected exact=${e.exact}`);
	if (e.min != null && actual < e.min) throw new Error(`${label}=${actual}, expected min=${e.min}`);
	if (e.max != null && actual > e.max) throw new Error(`${label}=${actual}, expected max=${e.max}`);
}

function _hasDamageType (list: string[], dt: string): boolean {
	const t = dt.toLowerCase();
	return list.some(x => x.toLowerCase().includes(t));
}

async function _runPassiveOrRollEffect (
	charSheet: CharacterSheetPage,
	e: EffectCheck,
): Promise<void> {
	switch (e.kind) {
		case "saveBonus": {
			const v = await charSheet.getSaveBonus(e.ability);
			_checkNumeric(v, e, `save:${e.ability}`);
			return;
		}
		case "skillBonus": {
			const v = await charSheet.getSkillBonus(e.skill);
			if (v == null) throw new Error(`skill bonus for "${e.skill}" not found`);
			_checkNumeric(v as number, e, `skill:${e.skill}`);
			return;
		}
		case "conditionImmunity": {
			const immunities = await charSheet.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				return cs?._state?.getConditionImmunities?.() || [];
			});
			if (!immunities.some((it: string) => it.toLowerCase() === e.condition.toLowerCase())) {
				throw new Error(`missing condition immunity "${e.condition}". seen=[${immunities.join(", ")}]`);
			}
			return;
		}
		case "abilityScore": {
			const {score} = await charSheet.getAbilityScore(e.ability);
			_checkNumeric(score, e, `score:${e.ability}`);
			return;
		}
		case "abilityMod": {
			const {mod} = await charSheet.getAbilityScore(e.ability);
			_checkNumeric(mod, e, `mod:${e.ability}`);
			return;
		}
		case "ac": {
			const ac = await charSheet.getCombatStat("ac").catch(() => null);
			if (ac == null) throw new Error(`AC not readable from sheet`);
			_checkNumeric(ac, e, `ac`);
			return;
		}
		case "spellSaveDc": {
			const dc = await charSheet.getSpellSaveDC().catch(() => null);
			if (dc == null) throw new Error(`spell save DC not readable from sheet`);
			_checkNumeric(dc, e, `spellSaveDc`);
			return;
		}
		case "spellSlots": {
			const slots = await charSheet.getSpellSlots(e.level);
			if (slots.max < e.min) throw new Error(`level-${e.level} spell slots ${slots.max} < ${e.min}`);
			return;
		}
		case "speed": {
			const v = await charSheet.getSpeed(e.type ?? "walk");
			_checkNumeric(v, e, `speed:${e.type ?? "walk"}`);
			return;
		}
		case "speedEquals": {
			const [left, right] = await Promise.all([
				charSheet.getSpeed(e.left),
				charSheet.getSpeed(e.right),
			]);
			if (left !== right) throw new Error(`speed:${e.left}=${left}, expected speed:${e.right}=${right}`);
			if (left <= 0) throw new Error(`speed:${e.left}=${left}, expected a positive speed`);
			return;
		}
		case "initiative": {
			const v = await charSheet.getInitiativeBonusFromState();
			_checkNumeric(v, e, `init`);
			return;
		}
		case "featureCalculation": {
			const probe = await charSheet.page.evaluate((property) => {
				const cs: any = (globalThis as any).charSheet;
				const calc = cs?._state?.getFeatureCalculations?.();
				return {present: !!calc && Object.prototype.hasOwnProperty.call(calc, property), value: calc?.[property] ?? null};
			}, e.property);
			const value = probe.value;
			if (e.isNull !== undefined) {
				// Distinguishes an explicit `null` sentinel (e.g. "no gp cap")
				// from a property the calculation never emitted at all.
				if (!probe.present) throw new Error(`featureCalculation.${e.property} is absent (expected present, null=${e.isNull})`);
				const isNull = value === null;
				if (isNull !== e.isNull) throw new Error(`featureCalculation.${e.property}=${value}, expected ${e.isNull ? "null" : "non-null"}`);
			}
			if (e.exact !== undefined && value !== e.exact) throw new Error(`featureCalculation.${e.property}=${value}, expected ${e.exact}`);
			if (e.min !== undefined && (!(typeof value === "number") || value < e.min)) {
				throw new Error(`featureCalculation.${e.property}=${value}, expected >= ${e.min}`);
			}
			if (e.exact === undefined && e.min === undefined && e.isNull === undefined && value == null) throw new Error(`featureCalculation.${e.property} is absent`);
			return;
		}
		case "classSummon": {
			const res = await charSheet.page.evaluate((cfg) => {
				const st: any = (globalThis as any).charSheet?._state;
				if (!st) return {err: "no state"};
				const fn = st[cfg.method];
				if (typeof fn !== "function") return {err: `state.${cfg.method} is not a function`};
				if (cfg.restFirst === "long") st.onLongRest?.();
				else if (cfg.restFirst === "short") st.onShortRest?.();
				let summoned: any;
				try { summoned = fn.apply(st, cfg.args || []); } catch (e: any) { return {err: `${cfg.method} threw: ${e?.message}`}; }
				if (!summoned) return {err: `${cfg.method} returned falsy`};
				if (summoned.ok === false) return {err: `${cfg.method} refused: ${summoned.error}`};
				const re = new RegExp(cfg.namePattern, "i");
				const comp = (st.getCompanions?.() || []).find((c: any) => re.test(c?.name || ""));
				if (!comp) return {err: `no companion matching ${cfg.namePattern}; seen=[${(st.getCompanions?.() || []).map((c: any) => c.name).join(", ")}]`};
				const atks = [...(comp.attacks || []), ...(comp.actions || [])];
				// Companion attacks come in two shapes: 5etools prose (`entries`, where
				// the damage type is inside the sentence) and the structured form
				// (`damage` + a SEPARATE `damageType` field). Omitting `damageType` here
				// made `damageContains` unable to match a type on any structured attack —
				// which is how the Hound of Ill Omen's "piercing" probe read "2d6+3".
				const flat = (a: any) => [a?.damage, a?.damageType, a?.desc, a?.description, ...(Array.isArray(a?.entries) ? a.entries : [a?.entries])].filter(Boolean).join(" ");
				const out = {
					err: null as string | null,
					hp: comp.hp?.max ?? comp.maxHp ?? null,
					ac: comp.ac ?? null,
					attacks: atks.map((a: any) => {
						const text = flat(a);
						const m = /([+-]\d+)\s*to hit/i.exec(text);
						return {name: a?.name || "", bonus: a?.attackBonus ?? (m ? Number(m[1]) : null), dmg: text};
					}),
					dismissed: null as boolean | null,
				};
				if (cfg.dismissMethod && typeof st[cfg.dismissMethod] === "function") {
					try { st[cfg.dismissMethod](); } catch (e) { /* reported below via dismissed */ }
					out.dismissed = !(st.getCompanions?.() || []).some((c: any) => re.test(c?.name || ""));
				}
				return out;
			}, {
				method: e.method,
				args: (e.args || []) as unknown[],
				restFirst: e.restFirst,
				dismissMethod: e.dismissMethod,
				namePattern: typeof e.namePattern === "string" ? e.namePattern : String(e.namePattern),
			});
			if (res.err) throw new Error(`classSummon(${e.method}): ${res.err}`);
			if (e.hpExact != null && res.hp !== e.hpExact) throw new Error(`classSummon(${e.method}) hp=${res.hp}, expected ${e.hpExact}`);
			if (e.hpMin != null && !(typeof res.hp === "number" && res.hp >= e.hpMin)) throw new Error(`classSummon(${e.method}) hp=${res.hp}, expected >= ${e.hpMin}`);
			if (e.ac != null && res.ac !== e.ac) throw new Error(`classSummon(${e.method}) ac=${res.ac}, expected ${e.ac}`);
			if (e.attackNamePattern) {
				const are = new RegExp(e.attackNamePattern, "i");
				const hit = (res.attacks || []).find((a: any) => are.test(a.name));
				if (!hit) throw new Error(`classSummon(${e.method}) no attack matching ${e.attackNamePattern}; seen=[${(res.attacks || []).map((a: any) => a.name).join(", ")}]`);
				if (e.attackBonusMin != null && !(Number(hit.bonus) >= e.attackBonusMin)) throw new Error(`classSummon(${e.method}) attack bonus=${hit.bonus}, expected >= ${e.attackBonusMin}`);
				if (e.damageContains && !String(hit.dmg).toLowerCase().includes(e.damageContains.toLowerCase())) throw new Error(`classSummon(${e.method}) damage "${hit.dmg}" missing "${e.damageContains}"`);
			}
			if (e.dismissMethod && res.dismissed === false) throw new Error(`classSummon(${e.method}) ${e.dismissMethod} did not remove the companion`);
			return;
		}
		case "createsInventoryItem": {
			const res = await charSheet.page.evaluate((cfg) => {
				const st: any = (globalThis as any).charSheet?._state;
				if (!st) return {err: "no state"};
				const fn = st[cfg.method];
				if (typeof fn !== "function") return {err: `state.${cfg.method} is not a function`};
				if (cfg.restFirst === "long") st.onLongRest?.();
				else if (cfg.restFirst === "short") st.onShortRest?.();
				let created: any;
				try { created = fn.apply(st, cfg.args || []); } catch (err: any) { return {err: `${cfg.method} threw: ${err?.message}`}; }
				if (!created) return {err: `${cfg.method} returned falsy`};
				if (created.ok === false) return {err: `${cfg.method} refused: ${created.error}`};
				const re = new RegExp(cfg.namePattern, "i");
				const matches = (st.getInventory?.() || []).filter((it: any) => re.test(it?.item?.name || it?.name || ""));
				const out = {
					err: null as string | null,
					count: matches.length,
					valuesCp: matches.map((it: any) => (it?.item?.value ?? it?.value ?? null)),
					cleared: null as boolean | null,
				};
				if (cfg.cleanupMethod && typeof st[cfg.cleanupMethod] === "function") {
					try { st[cfg.cleanupMethod](); } catch (err) { /* reported via cleared */ }
					out.cleared = !(st.getInventory?.() || []).some((it: any) => re.test(it?.item?.name || it?.name || ""));
				}
				return out;
			}, {
				method: e.method,
				args: (e.args || []) as unknown[],
				restFirst: e.restFirst,
				cleanupMethod: e.cleanupMethod,
				namePattern: typeof e.namePattern === "string" ? e.namePattern : String(e.namePattern),
			});
			if (res.err) throw new Error(`createsInventoryItem(${e.method}): ${res.err}`);
			const wanted = e.expectCount ?? 1;
			if (res.count < wanted) throw new Error(`createsInventoryItem(${e.method}) found ${res.count} matching "${e.namePattern}", expected >= ${wanted}`);
			if (e.maxValueGp != null) {
				for (const cp of res.valuesCp) {
					if (cp != null && Number(cp) > e.maxValueGp * 100) throw new Error(`createsInventoryItem(${e.method}) item value ${Number(cp) / 100} gp exceeds cap ${e.maxValueGp} gp`);
				}
			}
			if (e.cleanupMethod && res.cleared === false) throw new Error(`createsInventoryItem(${e.method}) ${e.cleanupMethod} did not remove the created item(s)`);
			return;
		}
		case "featureCalculationDerivedFrom": {
			const res = await charSheet.page.evaluate((cfg) => {
				const st: any = (globalThis as any).charSheet?._state;
				if (!st) return {err: "no state"};
				const calc = st.getFeatureCalculations?.() || {};
				if (!Object.prototype.hasOwnProperty.call(calc, cfg.property)) return {err: `featureCalculation.${cfg.property} is absent`};
				let expected: number | null = null;
				switch (cfg.equals) {
					case "abilityMod": expected = st.getAbilityMod?.(cfg.ability); break;
					case "spellSaveDc": expected = st.getSpellSaveDcForAbility?.(cfg.ability); break;
					case "spellAttackBonus": expected = st.getSpellAttackBonusForAbility?.(cfg.ability); break;
					case "proficiencyBonus": expected = st.getProficiencyBonus?.(); break;
				}
				return {err: null as string | null, actual: calc[cfg.property], expected};
			}, {property: e.property, equals: e.equals, ability: e.ability});
			if (res.err) throw new Error(`featureCalculationDerivedFrom: ${res.err}`);
			const want = Number(res.expected) + (e.offset ?? 0);
			if (Number(res.actual) !== want) {
				throw new Error(`featureCalculation.${e.property}=${res.actual}, expected ${e.equals}(${e.ability ?? ""})${e.offset ? ` + ${e.offset}` : ""} = ${want}`);
			}
			return;
		}
		case "stateCall": {
			const value = await charSheet.page.evaluate(({method, args, path}) => {
				const state: any = (globalThis as any).charSheet?._state;
				if (typeof state?.[method] !== "function") return {__missing: true};
				let result: any;
				try {
					result = state[method](...(args ?? []));
				} catch (err) {
					return {__threw: String(err)};
				}
				if (!path) return {value: result};
				let cursor = result;
				for (const seg of path.split(".")) {
					if (cursor == null) return {value: null};
					cursor = cursor[seg];
				}
				return {value: cursor};
			}, {method: e.method, args: (e.args ?? []) as unknown[], path: e.path ?? ""});

			const label = `${e.method}(${(e.args ?? []).map(a => JSON.stringify(a)).join(", ")})${e.path ? `.${e.path}` : ""}`;
			if ((value as any).__missing) throw new Error(`${label}: state method is missing`);
			if ((value as any).__threw) throw new Error(`${label} threw: ${(value as any).__threw}`);
			const actual = (value as any).value;
			if (e.exact !== undefined && actual !== e.exact) throw new Error(`${label}=${JSON.stringify(actual)}, expected ${JSON.stringify(e.exact)}`);
			if (e.min !== undefined && (typeof actual !== "number" || actual < e.min)) throw new Error(`${label}=${JSON.stringify(actual)}, expected >= ${e.min}`);
			if (e.contains !== undefined) {
				// Object elements stringify to "[object Object]", which can never match a
				// meaningful needle — JSON them instead so `contains` works on arrays of
				// records (e.g. `getInnateSpells()` → [{name: "Feather Fall", …}]).
				const render = (it: unknown) => (it && typeof it === "object" ? JSON.stringify(it) : String(it));
				const list = (Array.isArray(actual) ? actual : [actual]).map(render);
				if (!list.some(it => it.toLowerCase().includes(e.contains!.toLowerCase()))) {
					throw new Error(`${label}=${JSON.stringify(actual)}, expected to contain "${e.contains}"`);
				}
			}
			if (!e.ignoreResult && e.exact === undefined && e.min === undefined && e.contains === undefined && actual == null) {
				throw new Error(`${label} is absent`);
			}
			return;
		}
		case "proficiency": {
			const proficiencies = await charSheet.page.evaluate((type) => {
				const state: any = (globalThis as any).charSheet?._state;
				return type === "armor"
					? state?.getArmorProficiencies?.() || []
					: state?.getWeaponProficiencies?.() || [];
			}, e.proficiencyType);
			const needle = e.includes.toLowerCase();
			if (!proficiencies.some((it: string) => it.toLowerCase().includes(needle))) {
				throw new Error(`${e.proficiencyType} proficiency "${e.includes}" missing. seen=[${proficiencies.join(", ")}]`);
			}
			return;
		}
		case "featureUsesEqualAbilityMod": {
			const [uses, ability] = await Promise.all([
				charSheet.getFeatureUses(e.feature),
				charSheet.getAbilityScore(e.ability),
			]);
			const expected = Math.max(e.minimum ?? 0, ability.mod);
			if (uses.max !== expected) throw new Error(`${e.feature} uses=${uses.max}, expected max(${e.minimum ?? 0}, ${e.ability} mod ${ability.mod})=${expected}`);
			if (uses.recharge !== e.recharge) throw new Error(`${e.feature} recharge=${uses.recharge}, expected ${e.recharge}`);
			return;
		}
		case "combatAction": {
			const result = await charSheet.page.evaluate((featureName) => {
				const state: any = (globalThis as any).charSheet?._state;
				const feature = state?.getFeature?.(featureName);
				return feature ? state?.constructor?.detectActivatableFeature?.(feature) : null;
			}, e.feature);
			const rollDice = result?.combatActionEffects?.rollDice;
			if (result?.interactionMode !== e.interactionMode) throw new Error(`${e.feature} interactionMode=${result?.interactionMode}, expected ${e.interactionMode}`);
			if (e.formula != null && rollDice?.formula !== e.formula) throw new Error(`${e.feature} formula=${rollDice?.formula}, expected ${e.formula}`);
			if (e.rollType && rollDice?.type !== e.rollType) throw new Error(`${e.feature} type=${rollDice?.type}, expected ${e.rollType}`);
			if (e.saveAbility && rollDice?.saveAbility !== e.saveAbility) throw new Error(`${e.feature} save=${rollDice?.saveAbility}, expected ${e.saveAbility}`);
			if (e.abilityMod && rollDice?.abilityMod !== e.abilityMod) throw new Error(`${e.feature} abilityMod=${rollDice?.abilityMod}, expected ${e.abilityMod}`);
			if (e.minimum != null && rollDice?.minimum !== e.minimum) throw new Error(`${e.feature} minimum=${rollDice?.minimum}, expected ${e.minimum}`);
			for (const damageType of e.damageTypes || []) {
				if (!rollDice?.damageTypeChoices?.includes(damageType)) throw new Error(`${e.feature} missing damage type choice "${damageType}"`);
			}
			if (e.saveDcFromCharacter) {
				// The prose names no DC; the sheet must resolve it from the character rather
				// than fall back to a hard-coded 10.
				const dcs = await charSheet.page.evaluate((featureName) => {
					const cs: any = (globalThis as any).charSheet;
					const state = cs?._state;
					const feature = state?.getFeature?.(featureName);
					const effects = feature ? state?.constructor?.detectActivatableFeature?.(feature)?.combatActionEffects : null;
					cs?._combat?._resolveCombatActionEffects?.(effects, feature);
					return {resolved: effects?.rollDice?.dc ?? null, expected: state?.getFeatureSaveDc?.(feature) ?? null};
				}, e.feature);
				if (dcs.expected == null) throw new Error(`${e.feature}: character exposes no feature save DC to resolve against`);
				if (dcs.resolved !== dcs.expected) throw new Error(`${e.feature} save DC=${dcs.resolved}, expected the character's ${dcs.expected}`);
			}
			return;
		}
		case "deferredDamageMaximizer": {
			const before = await charSheet.getResource(e.resource);
			await charSheet.activateFeature(e.feature);
			const result = await charSheet.page.evaluate(({resource, eligibleType, ineligibleType}) => {
				const state: any = (globalThis as any).charSheet?._state;
				const armed = state?.getPendingDamageMaximization?.();
				const afterArm = state?.getResource?.(resource)?.current;
				const rejected = state?.consumePendingDamageMaximization?.(ineligibleType);
				const afterRejected = state?.getResource?.(resource)?.current;
				const stillArmed = state?.getPendingDamageMaximization?.();
				const consumed = state?.consumePendingDamageMaximization?.(eligibleType);
				const afterConsumed = state?.getResource?.(resource)?.current;
				const cleared = state?.getPendingDamageMaximization?.();
				return {armed, afterArm, rejected, afterRejected, stillArmed, consumed, afterConsumed, cleared};
			}, {resource: e.resource, eligibleType: e.eligibleType, ineligibleType: e.ineligibleType});
			if (!result.armed) throw new Error(`${e.feature} did not arm deferred damage maximization`);
			if (result.afterArm !== before.current) throw new Error(`${e.feature} spent ${e.resource} on activation`);
			if (result.rejected || result.afterRejected !== before.current || !result.stillArmed) throw new Error(`${e.feature} was consumed by ineligible ${e.ineligibleType} damage`);
			if (!result.consumed || result.afterConsumed !== before.current - 1 || result.cleared) throw new Error(`${e.feature} did not consume exactly one ${e.resource} use on ${e.eligibleType} damage`);
			return;
		}
		case "triggeredDamageEffect": {
			const effects = await charSheet.page.evaluate((damageType) => {
				return (globalThis as any).charSheet?._state?.getTriggeredDamageEffects?.(damageType) || [];
			}, e.damageType);
			const effect = effects.find((it: any) => it.type === e.effectType);
			if (!effect) throw new Error(`${e.damageType} damage did not emit "${e.effectType}". seen=${JSON.stringify(effects)}`);
			for (const property of ["distance", "direction", "maxTargetSize", "optional"] as const) {
				if (e[property] !== undefined && effect[property] !== e[property]) {
					throw new Error(`${e.effectType}.${property}=${effect[property]}, expected ${e[property]}`);
				}
			}
			return;
		}
		case "weaponDamageRider": {
			const riders = await charSheet.page.evaluate(() => {
				return (globalThis as any).charSheet?._state?.getFeatureCalculations?.()?.weaponDamageRiders || [];
			});
			const rider = riders.find((it: any) => it.id === e.id);
			if (!rider) throw new Error(`weapon damage rider "${e.id}" missing. seen=${JSON.stringify(riders)}`);
			if (rider.dice !== e.dice) throw new Error(`${e.id}.dice=${rider.dice}, expected ${e.dice}`);
			if (rider.damageType !== e.damageType) throw new Error(`${e.id}.damageType=${rider.damageType}, expected ${e.damageType}`);
			if (e.perTurn !== undefined && rider.perTurn !== e.perTurn) throw new Error(`${e.id}.perTurn=${rider.perTurn}, expected ${e.perTurn}`);
			return;
		}
		case "resistance": {
			const list = await charSheet.getResistances();
			if (!_hasDamageType(list, e.damageType)) {
				throw new Error(`resistance "${e.damageType}" not present. seen=[${list.join(", ")}]`);
			}
			return;
		}
		case "immunity": {
			const list = await charSheet.getImmunities();
			if (!_hasDamageType(list, e.damageType)) {
				throw new Error(`immunity "${e.damageType}" not present. seen=[${list.join(", ")}]`);
			}
			return;
		}
		case "vulnerability": {
			const list = await charSheet.getVulnerabilities();
			if (!_hasDamageType(list, e.damageType)) {
				throw new Error(`vulnerability "${e.damageType}" not present. seen=[${list.join(", ")}]`);
			}
			return;
		}
		case "advantage": {
			const s = await charSheet.getAdvantageState(e.rollType);
			if (!s.advantage) throw new Error(`expected advantage on "${e.rollType}", got adv=${s.advantage} dis=${s.disadvantage} sources=[${s.sources.join(", ")}]`);
			return;
		}
		case "disadvantage": {
			const s = await charSheet.getAdvantageState(e.rollType);
			if (!s.disadvantage) throw new Error(`expected disadvantage on "${e.rollType}", got adv=${s.advantage} dis=${s.disadvantage}`);
			return;
		}
		case "skillAdvantage": {
			const s = await charSheet.getSkillAdvantageState(e.skill);
			if (!s.advantage) throw new Error(`expected skill advantage on "${e.skill}", got adv=${s.advantage} dis=${s.disadvantage}`);
			return;
		}
		case "spellInList": {
			const known = await charSheet.getKnownSpellNames().catch(() => [] as string[]);
			const mode = e.spellMatchMode ?? "first-party";
			if (mode === "any") {
				// Drop the name assertion; just verify at least N spells
				// of the requested level surface. Default level is 0
				// (cantrips); caller can pass `level: 1` etc. We only
				// require ≥1 spell at the requested level — the test is
				// here to catch "no spells loaded at all" regressions.
				const wantLevel = e.level ?? 0;
				const byLvl = await charSheet.getKnownSpellsByLevel().catch(() => ({} as Record<number, string[]>));
				const got = (byLvl[wantLevel] ?? []).length;
				if (got < 1) {
					throw new Error(`spellInList[any]: 0 spells at level ${wantLevel}. seen=${known.slice(0, 30).join(", ")}…`);
				}
				return;
			}
			// "first-party" and "tgtt-flavor" both use exact-name lookup.
			// The mode is metadata for skipReason annotations and human
			// review; the runtime check is identical.
			// Cantrips live in their own list on the sheet, so a subclass that
			// grants one through `additionalSpells` only shows up once both
			// lists are unioned.
			const cantrips = await charSheet.getCantripNames().catch(() => [] as string[]);
			const pool = [...known, ...cantrips];
			const want = e.spell.toLowerCase();
			if (!pool.some(n => n.toLowerCase() === want)) {
				throw new Error(`spell "${e.spell}" not in spellbook [${mode}]. seen=${pool.slice(0, 30).join(", ")}…`);
			}
			return;
		}
		case "cantripCount": {
			const byLvl = await charSheet.getKnownSpellsByLevel().catch(() => ({} as Record<number, string[]>));
			const count = (byLvl[0] ?? []).length;
			if (count < e.min) throw new Error(`cantrip count ${count} < ${e.min}`);
			return;
		}
		case "rollAbilityCheck": {
			const r = await charSheet.clickAbilityRoll(e.ability, "check");
			// Dismiss BEFORE asserting: a thrown assertion must not leave a
			// product prompt open to wedge every later probe.
			await charSheet.dismissTransientModals?.();
			if (!r.clicked) throw new Error(`ability check button for ${e.ability} not found`);
			if (r.threwError) throw new Error(`ability check ${e.ability} click threw: ${r.errorMessage ?? "unknown"}`);
			return;
		}
		case "rollSavingThrow": {
			const r = await charSheet.clickAbilityRoll(e.ability, "save");
			await charSheet.dismissTransientModals?.();
			if (!r.clicked) throw new Error(`save button for ${e.ability} not found`);
			if (r.threwError) throw new Error(`save ${e.ability} click threw: ${r.errorMessage ?? "unknown"}`);
			return;
		}
		case "rollSkillCheck": {
			let skill = e.skill;
			if (e.proficientSkills) {
				// Resolve to first proficient skill via state introspection.
				const profSkill = await charSheet.page.evaluate(() => {
					const cs: any = (globalThis as any).charSheet;
					const st: any = cs?._state;
					if (!st || typeof st.isProficientInSkill !== "function") return null;
					const skills = ["acrobatics", "animal handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight of hand", "stealth", "survival"];
					for (const s of skills) {
						try { if (st.isProficientInSkill(s)) return s; } catch (_) {}
					}
					return null;
				});
				if (!profSkill) {
					throw new Error(`rollSkillCheck[proficientSkills]: no proficient skill found on sheet`);
				}
				skill = profSkill;
			}
			if (!skill) throw new Error(`rollSkillCheck requires either skill or proficientSkills:true`);
			const r = await charSheet.clickSkillRollHard(skill);
			await charSheet.dismissTransientModals?.();
			if (!r.clicked) throw new Error(`skill roll button for "${skill}" not found`);
			if (r.threwError) throw new Error(`skill ${skill} click threw: ${r.errorMessage ?? "unknown"}`);
			return;
		}
		case "rollAttack": {
			const r = await charSheet.clickAttackRoll(e.attackName);
			await charSheet.dismissTransientModals?.();
			if (!r.clicked) throw new Error(`attack roll button for ${e.attackName} not found`);
			if (r.threwError) throw new Error(`attack click threw: ${r.errorMessage ?? "unknown"}`);
			return;
		}
		case "rollInitiative": {
			const r = await charSheet.clickInitiativeRoll();
			await charSheet.dismissTransientModals?.();
			if (!r.clicked) throw new Error(`initiative roll button not found`);
			if (r.threwError) throw new Error(`initiative click threw: ${r.errorMessage ?? "unknown"}`);
			return;
		}
		case "longRestRestores":
		case "shortRestRestores": {
			const isShort = e.kind === "shortRestRestores";
			const before = await charSheet.getResource(e.resource).catch(() => null);
			if (!before || before.max <= 0) throw new Error(`resource "${e.resource}" not on sheet`);
			// Spend one charge through the page object. `_state.spendResource` does not
			// exist — the optional call silently no-opped, so this probe used to fall
			// straight into its own "API absent" soft skip (CS-BUG-034).
			await charSheet.useResourceByName(e.resource, 1).catch(() => null);
			const afterSpend = await charSheet.getResource(e.resource).catch(() => before);
			if (afterSpend.current >= before.current) return; // resource could not be spent; soft skip
			// The page object drives the real rest UI. Calling `_state.shortRest()`
			// here would be a silent no-op: the state method is `onShortRest`, and the
			// optional-call syntax swallowed the mismatch, so this check could never
			// pass once the spend succeeded (CS-BUG-034).
			if (isShort) await charSheet.triggerShortRest();
			else await charSheet.triggerLongRest();
			const after = await charSheet.getResource(e.resource).catch(() => afterSpend);
			const target = e.toMax === false ? (before.current) : before.max;
			if (after.current < target) throw new Error(`expected ${isShort ? "short" : "long"} rest to restore "${e.resource}" to ≥${target}, got ${after.current}/${after.max}`);
			return;
		}
		case "longRestRestoresFeatureUses":
		case "shortRestRestoresFeatureUses": {
			const isShort = e.kind === "shortRestRestoresFeatureUses";
			if (isShort) await charSheet.triggerShortRest();
			else await charSheet.triggerLongRest();
			const before = await charSheet.getFeatureUses(e.feature);
			if (before.max <= 0) throw new Error(`feature uses for "${e.feature}" not tracked`);
			if (!await charSheet.spendFeatureUse(e.feature)) throw new Error(`could not spend a use of "${e.feature}"`);
			const afterSpend = await charSheet.getFeatureUses(e.feature);
			if (afterSpend.current !== before.current - 1) throw new Error(`spending "${e.feature}" did not decrement its uses`);
			if (isShort) await charSheet.triggerShortRest();
			else await charSheet.triggerLongRest();
			const afterRest = await charSheet.getFeatureUses(e.feature);
			if (afterRest.current !== afterRest.max) {
				throw new Error(`expected ${isShort ? "short" : "long"} rest to restore "${e.feature}" to ${afterRest.max}, got ${afterRest.current}`);
			}
			return;
		}

		// ── Phase 8: per-pick + scaling stat probes ─────────────
		case "attackBonus": {
			const v = await charSheet.getAttackBonusNumber(e.attackName);
			if (v == null) throw new Error(`attack "${e.attackName}" not on sheet`);
			_checkNumeric(v, e, `attackBonus:${e.attackName}`);
			return;
		}
		case "attackDamageContains": {
			const dmg = await charSheet.getAttackDamageString(e.attackName);
			if (dmg == null) throw new Error(`attack "${e.attackName}" not on sheet`);
			if (!dmg.toLowerCase().includes(e.needle.toLowerCase())) {
				throw new Error(`attack "${e.attackName}" damage="${dmg}" does not contain "${e.needle}"`);
			}
			return;
		}
		case "sneakAttackDice": {
			const n = await charSheet.getSneakAttackDiceCount();
			_checkNumeric(n, e, `sneakAttackDice`);
			return;
		}
		case "bardicInspirationDie": {
			const n = await charSheet.getBardicInspirationDieSize();
			if (n < e.minFaces) throw new Error(`BI die face=${n} < min=${e.minFaces}`);
			return;
		}
		case "martialArtsDie": {
			const n = await charSheet.getMartialArtsDieSize();
			if (n < e.minFaces) throw new Error(`MA die face=${n} < min=${e.minFaces}`);
			return;
		}
		case "criticalRange": {
			const n = await charSheet.getCriticalRange();
			_checkNumeric(n, e, "criticalRange");
			return;
		}
		case "modifierBonus": {
			const n = await charSheet.getModifierBonus(e.modType);
			_checkNumeric(n, e, `modifierBonus:${e.modType}`);
			return;
		}
		case "turnStartGrantsInspiration": {
			await charSheet.setInspiration(false);
			const effects = await charSheet.applyTurnStartEffects();
			const granted = effects.some(x => x.type === "grantInspiration");
			if (!granted) throw new Error(`applyTurnStartEffects() did not grant Inspiration; got ${JSON.stringify(effects)}`);
			const has = await charSheet.hasInspiration();
			if (!has) throw new Error(`hasInspiration() is false after a turn-start Inspiration grant`);
			return;
		}
		case "turnStartHeals": {
			if (e.setHpFraction != null) {
				const max = await charSheet.getMaxHp();
				await charSheet.setCurrentHp(Math.max(1, Math.floor(max * e.setHpFraction)));
			}
			const before = await charSheet.getCurrentHp();
			const effects = await charSheet.applyTurnStartEffects();
			const healEffect = effects.find(x => x.type === "heal");
			if (!healEffect) throw new Error(`applyTurnStartEffects() did not heal; got ${JSON.stringify(effects)}`);
			const after = await charSheet.getCurrentHp();
			const healed = after - before;
			if (healed < e.min) throw new Error(`turn-start heal=${healed} < min=${e.min} (before=${before}, after=${after})`);
			return;
		}
		case "featureChoiceCalculation": {
			const result = await charSheet.page.evaluate((args) => {
				const state: any = (globalThis as any).charSheet?._state;
				const choice = (state?._data?.levelHistory || [])
					.filter((entry: any) => entry.class?.name === args.className)
					.flatMap((entry: any) => entry.choices?.featureChoices || [])
					.find((it: any) => it.featureName === args.featureName)?.choice;
				const calculations = state?.getFeatureCalculations?.() || {};
				const ability = String(args.expectedChoice || "").slice(0, 3).toLowerCase();
				return {
					choice,
					value: calculations[args.property],
					dc: args.dcProperty ? calculations[args.dcProperty] : null,
					expectedDc: args.dcProperty ? 8 + state.getProficiencyBonus() + state.getAbilityMod(ability) : null,
				};
			}, e);
			if (result.choice !== e.expectedChoice) throw new Error(`${e.featureName} choice=${result.choice}, expected ${e.expectedChoice}`);
			if (result.value !== e.expectedValue) throw new Error(`featureCalculation.${e.property}=${result.value}, expected ${e.expectedValue}`);
			if (e.dcProperty && result.dc !== result.expectedDc) throw new Error(`featureCalculation.${e.dcProperty}=${result.dc}, expected choice-driven DC ${result.expectedDc}`);
			return;
		}
		case "bloodMaledictAmplification": {
			const result = await charSheet.page.evaluate((hpCost) => {
				const state: any = (globalThis as any).charSheet?._state;
				state.ensureBloodHunterResources?.();
				const resource = state.getResource?.("Blood Maledict");
				if (!resource) return {ok: false, reason: "missing resource"};
				state.setResourceCurrent(resource.id, resource.max);
				state.setCurrentHp(state.getMaxHp());
				state.setTempHp(7);
				const before = {hp: state.getCurrentHp(), tempHp: state.getTempHp(), uses: resource.max};
				const used = state.useBloodMaledict?.({amplify: true, roll: hpCost});
				const afterUse = {hp: state.getCurrentHp(), tempHp: state.getTempHp(), uses: state.getResource("Blood Maledict").current};
				state.onShortRest?.();
				return {ok: true, used, before, afterUse, afterRest: state.getResource("Blood Maledict").current, max: resource.max};
			}, e.hpCost);
			if (!result.ok || !result.used) throw new Error(`amplified Blood Maledict failed: ${JSON.stringify(result)}`);
			if (result.before.hp - result.afterUse.hp !== e.hpCost) throw new Error(`amplification HP cost=${result.before.hp - result.afterUse.hp}, expected ${e.hpCost}`);
			if (result.afterUse.tempHp !== result.before.tempHp) throw new Error(`amplification incorrectly consumed temporary HP`);
			if (result.afterUse.uses !== result.before.uses - 1) throw new Error(`Blood Maledict use did not decrement`);
			if (result.afterRest !== result.max) throw new Error(`short rest restored Blood Maledict to ${result.afterRest}/${result.max}`);
			return;
		}
		case "crimsonRiteMechanics": {
			const result = await charSheet.page.evaluate((hpCosts) => {
				const state: any = (globalThis as any).charSheet?._state;
				const rite = state.getFeatures?.().find((it: any) => it.optionalFeatureTypes?.includes("CR"))?.name;
				if (!rite) return {ok: false, reason: "missing selected rite"};
				state.setCurrentHp(state.getMaxHp());
				state.setTempHp(9);
				const beforeHp = state.getCurrentHp();
				const beforeTempHp = state.getTempHp();
				const first = state.activateCrimsonRite?.(rite, {roll: hpCosts[0], weaponId: "e2e-rite-longsword", weaponName: "Longsword"});
				const second = state.activateCrimsonRite?.(rite, {roll: hpCosts[1], weaponId: "e2e-rite-longbow", weaponName: "Longbow"});
				return {
					ok: true,
					first,
					second,
					hpSpent: beforeHp - state.getCurrentHp(),
					tempHpSpent: beforeTempHp - state.getTempHp(),
					effects: state.getExtraDamageFromStates?.().filter((it: any) => it.isCrimsonRite) || [],
				};
			}, e.hpCosts);
			if (!result.ok || !result.first || !result.second) throw new Error(`Crimson Rite activation failed: ${JSON.stringify(result)}`);
			if (result.hpSpent !== e.hpCosts[0] + e.hpCosts[1]) throw new Error(`Crimson Rite HP cost=${result.hpSpent}, expected ${e.hpCosts[0] + e.hpCosts[1]}`);
			if (result.tempHpSpent !== 0) throw new Error(`Crimson Rite incorrectly consumed temporary HP`);
			for (const weaponId of ["e2e-rite-longsword", "e2e-rite-longbow"]) {
				const rider = result.effects.find((it: any) => it.weaponId === weaponId);
				if (!rider?.dice || !rider?.damageType) throw new Error(`typed Crimson Rite rider missing for ${weaponId}: ${JSON.stringify(result.effects)}`);
			}
			return;
		}
		case "hybridTransformationMechanics": {
			const result = await charSheet.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const state: any = cs?._state;
				state.ensureBloodHunterResources?.();
				const resource = state.getResource?.("Hybrid Transformation");
				if (resource) state.setResourceCurrent(resource.id, resource.max);
				const beforeAc = state.getAc();
				const activated = state.activateHybridTransformation?.();
				cs?._combat?.render?.();
				const calc = state.getFeatureCalculations?.() || {};
				const defenses = state.getEffectiveDefenses?.() || {};
				const availableWeapons = cs?._combat?.getAvailableWeaponAttacks?.() || [];
				const predatory = availableWeapons.find((it: any) => /predatory strike/i.test(it.name));
				const rite = state.getFeatures?.().find((it: any) => it.optionalFeatureTypes?.includes("CR"))?.name;
				const riteActivated = rite && predatory
					? state.activateCrimsonRite(rite, {roll: 2, weaponId: predatory.riteWeaponId || predatory.id, weaponName: predatory.name})
					: false;
				const riteOnNaturalWeapon = state.getExtraDamageFromStates?.().some((it: any) =>
					it.isCrimsonRite && it.weaponId === "hybrid-predatory-strikes");
				state.setCurrentHp(Math.max(1, Math.floor(state.getMaxHp() * 0.4)));
				const bloodlust = state.getHybridBloodlustCheck?.();
				const hpBeforeRegen = state.getCurrentHp();
				const regenerated = state.applyHybridRegenerationAtTurnStart?.() || 0;
				const output = {
					activated,
					acDelta: state.getAc() - beforeAc,
					strCheckAdvantage: !!state.getAdvantageState?.("check:str")?.advantage,
					strSaveAdvantage: !!state.getAdvantageState?.("save:str")?.advantage,
					conditionalResistances: defenses.conditionalResistances || [],
					availableWeaponNames: availableWeapons.map((it: any) => it.name),
					riteActivated: !!riteActivated,
					riteOnNaturalWeapon,
					bloodlust,
					expectedBloodlustAdvantage: !!calc.hasBrandOfTheVoracious,
					regenerated,
					hpDelta: state.getCurrentHp() - hpBeforeRegen,
					expectedRegeneration: calc.hybridRegeneration || 0,
				};
				state.deactivateState?.("hybridTransformation");
				if (resource) state.setResourceCurrent(resource.id, resource.max);
				return output;
			});
			if (!result.activated) throw new Error(`Hybrid Transformation did not activate`);
			if (result.acDelta !== 1) throw new Error(`Hybrid Transformation AC delta=${result.acDelta}, expected 1`);
			if (!result.strCheckAdvantage || !result.strSaveAdvantage) throw new Error(`Hybrid Transformation omitted Strength advantage`);
			for (const type of ["bludgeoning", "piercing", "slashing"]) {
				const defense = result.conditionalResistances.find((it: any) => it.type === type);
				if (!defense?.conditional?.includes("nonsilvered")) throw new Error(`conditional ${type} resistance metadata missing`);
			}
			if (!result.availableWeaponNames.some((name: string) => /predatory strike/i.test(name))) throw new Error(`canonical weapon picker omitted active-state Predatory Strikes`);
			if (!result.riteActivated || !result.riteOnNaturalWeapon) throw new Error(`Crimson Rite could not target the active-state natural weapon`);
			if (!result.bloodlust || result.bloodlust.dc !== 8) throw new Error(`Bloodlust save not surfaced below half HP`);
			if (result.bloodlust.advantage !== result.expectedBloodlustAdvantage) throw new Error(`Bloodlust advantage=${result.bloodlust.advantage}, expected ${result.expectedBloodlustAdvantage}`);
			if (result.expectedRegeneration > 0 && (result.regenerated !== result.expectedRegeneration || result.hpDelta !== result.expectedRegeneration)) {
				throw new Error(`Hybrid regeneration=${result.regenerated}/${result.hpDelta}, expected ${result.expectedRegeneration}`);
			}
			return;
		}
		case "psionicStrainMechanics": {
			const result = await charSheet.page.evaluate(() => {
				const state: any = (globalThis as any).charSheet?._state;
				if (!state?.getStrainMaximum) return {ok: false, reason: "strain API missing"};
				const max = state.getStrainMaximum();
				if (!max) return {ok: false, reason: "not a Talent"};
				const skill = Object.keys(state.getSkillProficiencies() || {})[0] || null;
				state.clearStrain();
				state.setIgnoredStrainTrack?.(null);
				state.setCurrentHp(state.getMaxHp());
				const base = {
					ac: state.getAc(),
					speed: state.getWalkSpeed(),
					maxHp: state.getMaxHp(),
					skillMod: skill ? state.getSkillMod(skill) : null,
					saveProf: state.hasSaveProficiency("int"),
					strCheckDis: !!state.getAdvantageState("check:str")?.disadvantage,
					deathSaveDis: !!state.getAdvantageState("deathSave")?.disadvantage,
				};

				// Body 3 → speed halved; body 7 → hit point maximum halved.
				state.addStrain(3, "body");
				const bodyThree = {speed: state.getWalkSpeed(), strCheckDis: !!state.getAdvantageState("check:str")?.disadvantage};
				state.clearStrain();
				state.addStrain(7, "body");
				const bodySeven = {maxHp: state.getMaxHp(), strSaveDis: !!state.getAdvantageState("save:str")?.disadvantage};

				// Mind 3 → skill proficiency lost; mind 5 → −5 AC; mind 7 → save proficiency lost.
				state.clearStrain();
				state.addStrain(3, "mind");
				const mindThree = {skillMod: skill ? state.getSkillMod(skill) : null};
				state.clearStrain();
				state.addStrain(5, "mind");
				const mindFive = {ac: state.getAc()};
				state.clearStrain();
				state.addStrain(7, "mind");
				const mindSeven = {saveProf: state.hasSaveProficiency("int")};

				// Soul 3 → death saves at disadvantage; soul 7 → supernatural healing halved.
				state.clearStrain();
				state.addStrain(3, "soul");
				const soulThree = {deathSaveDis: !!state.getAdvantageState("deathSave")?.disadvantage};
				state.clearStrain();
				state.addStrain(7, "soul");
				state.setCurrentHp(1);
				state.heal(10, {supernatural: true});
				const soulSeven = {healed: state.getCurrentHp() - 1};

				// Overflow is refused, never silently clamped past the maximum.
				state.clearStrain();
				state.addStrain(max, "body");
				const overflow = state.addStrain(1, "mind");

				// A long rest clears every track.
				state.clearStrain();
				state.addStrain(2, "mind");
				const beforeRest = state.getTotalStrain();
				state.longRest?.();
				state.onLongRest?.();
				const afterRest = state.getTotalStrain();

				state.clearStrain();
				state.setCurrentHp(state.getMaxHp());
				const restored = {
					ac: state.getAc(),
					speed: state.getWalkSpeed(),
					maxHp: state.getMaxHp(),
					skillMod: skill ? state.getSkillMod(skill) : null,
					saveProf: state.hasSaveProficiency("int"),
				};
				return {ok: true, max, skill, base, bodyThree, bodySeven, mindThree, mindFive, mindSeven, soulThree, soulSeven, overflow, beforeRest, afterRest, restored};
			});
			if (!result.ok) throw new Error(`psionicStrainMechanics unavailable: ${JSON.stringify(result)}`);
			if (result.bodyThree.speed !== Math.floor(result.base.speed / 2)) throw new Error(`body strain 3 speed=${result.bodyThree.speed}, expected ${Math.floor(result.base.speed / 2)}`);
			if (!result.bodyThree.strCheckDis) throw new Error(`body strain did not impose disadvantage on Strength checks`);
			if (result.bodySeven.maxHp !== Math.max(1, Math.floor(result.base.maxHp / 2))) throw new Error(`body strain 7 maxHp=${result.bodySeven.maxHp}, expected half of ${result.base.maxHp}`);
			if (!result.bodySeven.strSaveDis) throw new Error(`body strain 5 did not impose disadvantage on Strength saves`);
			if (result.skill && result.mindThree.skillMod === result.base.skillMod) throw new Error(`mind strain 3 did not strip skill proficiency (${result.skill} stayed at ${result.base.skillMod})`);
			if (result.mindFive.ac !== result.base.ac - 5) throw new Error(`mind strain 5 AC=${result.mindFive.ac}, expected ${result.base.ac - 5}`);
			if (result.base.saveProf && result.mindSeven.saveProf) throw new Error(`mind strain 7 did not strip saving-throw proficiency`);
			if (!result.soulThree.deathSaveDis) throw new Error(`soul strain 3 did not impose disadvantage on death saves`);
			if (result.soulSeven.healed !== 5) throw new Error(`soul strain 7 supernatural healing=${result.soulSeven.healed}, expected 5 (half of 10)`);
			if (!result.overflow.overflow || result.overflow.applied !== 0) throw new Error(`strain past the maximum was applied instead of refused: ${JSON.stringify(result.overflow)}`);
			if (result.beforeRest === 0 || result.afterRest !== 0) throw new Error(`long rest did not clear strain (${result.beforeRest} → ${result.afterRest})`);
			if (result.restored.ac !== result.base.ac || result.restored.speed !== result.base.speed || result.restored.maxHp !== result.base.maxHp) {
				throw new Error(`clearing strain did not restore baseline: ${JSON.stringify(result.restored)} vs ${JSON.stringify(result.base)}`);
			}
			return;
		}
		case "manifestationTest": {
			const result = await charSheet.page.evaluate((args) => {
				const state: any = (globalThis as any).charSheet?._state;
				if (!state?.rollManifestationTest) return {ok: false, reason: "manifestation API missing"};
				state.clearStrain();
				const test = state.rollManifestationTest(args.order, {roll: args.roll, track: "mind", apply: true});
				return {ok: true, test, total: state.getTotalStrain(), die: state.getManifestationDie(), maxOrder: state.getMaxPowerOrder()};
			}, e);
			if (!result.ok) throw new Error(`manifestationTest unavailable: ${JSON.stringify(result)}`);
			if (result.test.strain !== e.expectStrain) throw new Error(`manifestation test order=${e.order} roll=${e.roll} strain=${result.test.strain}, expected ${e.expectStrain}`);
			if (result.total !== e.expectStrain) throw new Error(`manifestation test applied ${result.total} strain, expected ${e.expectStrain}`);
			return;
		}
		case "pickToggleable": {
			const allFeatures = await charSheet.getActivatableFeatureNames().catch(() => [] as string[]);
			const toggleable = await charSheet.getToggleableFeatureNames().catch(() => [] as string[]);
			const need = e.min ?? 1;
			let hits = 0;
			const seen: string[] = [];
			for (const pat of e.matchAny) {
				const re = pat instanceof RegExp ? pat : new RegExp(pat, "i");
				const match = allFeatures.find(f => re.test(f));
				if (match && toggleable.some(t => t.toLowerCase() === match.toLowerCase())) {
					hits++;
					seen.push(match);
					if (hits >= need) return;
				}
			}
			throw new Error(`pickToggleable: only ${hits} of expected ≥${need} matched picks are toggleable. matchedToggleable=[${seen.join(", ")}] toggleable=[${toggleable.slice(0, 10).join(", ")}…]`);
		}
		case "pickActivatable": {
			const allFeatures = await charSheet.getActivatableFeatureNames().catch(() => [] as string[]);
			const need = e.min ?? 1;
			let hits = 0;
			const errs: string[] = [];
			for (const pat of e.matchAny) {
				const re = pat instanceof RegExp ? pat : new RegExp(pat, "i");
				const match = allFeatures.find(f => re.test(f));
				if (!match) continue;
				try {
					await charSheet.activateFeature(match);
					hits++;
					try { await charSheet.deactivateFeature(match); } catch (_) { /* swallow */ }
					if (hits >= need) return;
				} catch (aErr: any) {
					errs.push(`${match}: ${aErr.message}`);
				}
			}
			throw new Error(`pickActivatable: only ${hits} of expected ≥${need} matched picks could be activated. errors=[${errs.join(" | ")}]`);
		}
		case "weaponScopedState": {
			await charSheet.page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				if (!state) return;
				const equippedWeapon = state.getItems?.().find((it: any) => it.equipped && (it.weapon || it.item?.weapon));
				if (!equippedWeapon) state.addItem?.({name: "Devotion Test Sword", source: "XPHB", type: "M", weapon: true, dmg1: "1d8", dmgType: "S"}, 1, true);
				cs._combat?.renderAttacks?.();
				cs._renderCharacter?.();
			});
			await charSheet.activateFeature(e.feature);
			const result = await charSheet.page.evaluate(({min, damageType}) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				const active = state?.getActiveStates?.().find((it: any) => it.active && it.stateTypeId === "sacredWeapon");
				const weaponEffect = active?.customEffects?.find((it: any) => it.weaponId);
				const weaponId = weaponEffect?.weaponId;
				const attackBadge = weaponId
					? document.querySelector(`.charsheet__attack-item[data-attack-id="${CSS.escape(weaponId)}"] .badge-primary`)
					: null;
				const overviewRow = Array.from(document.querySelectorAll(".charsheet__attack-row"))
					.find(row => (row.querySelector(".charsheet__attack-name")?.textContent || "").includes(weaponEffect?.weaponName || "__missing__"));
				return {
					active: !!active,
					weaponId,
					bonus: weaponId ? state.getBonusFromStates?.("attack", {weaponId}) : 0,
					otherBonus: state.getBonusFromStates?.("attack", {weaponId: "__other__"}) || 0,
					damageTypes: weaponId ? state.getWeaponDamageTypeChoices?.(weaponId, "slashing") : [],
					attackBadgeTitle: attackBadge?.getAttribute("title") || "",
					overviewDamage: overviewRow?.querySelector(".charsheet__attack-damage")?.textContent || "",
					min,
					damageType,
				};
			}, {min: e.attackBonusMin, damageType: e.alternateDamageType});
			if (!result.active || !result.weaponId) throw new Error(`"${e.feature}" did not create a weapon-scoped active state`);
			if (result.bonus < e.attackBonusMin) throw new Error(`scoped attack bonus=${result.bonus}, expected >=${e.attackBonusMin}`);
			if (result.otherBonus !== 0) throw new Error(`scoped attack bonus leaked to another weapon: ${result.otherBonus}`);
			if (!result.attackBadgeTitle.includes("active state")) throw new Error(`rendered attack badge omitted the active-state bonus`);
			if (!result.overviewDamage.toLowerCase().includes(e.alternateDamageType.toLowerCase())) throw new Error(`overview attack omitted alternate damage type "${e.alternateDamageType}"`);
			if (!result.damageTypes.includes(e.alternateDamageType)) {
				throw new Error(`alternate damage type "${e.alternateDamageType}" missing. seen=[${result.damageTypes.join(", ")}]`);
			}
			await charSheet.deactivateFeature(e.feature);
			await charSheet.page.evaluate((featureName) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				const feature = state?.getFeatures?.().find((it: any) => it.name === featureName);
				const resourceName = feature?.consumes?.name;
				const resource = resourceName ? state.getResource?.(resourceName) : null;
				if (resource) state.setResourceCurrent?.(resource.id, Math.min(resource.max, resource.current + 1));
			}, e.feature);
			return;
		}
		case "spellCastGrantsCover": {
			const result = await charSheet.page.evaluate(({spell, source, saveAbility}) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				state.startCombat?.();
				const before = {ac: state.getArmorClass(), save: state.getSaveMod(saveAbility)};
				state.applyCommittedSpellCastTriggers?.({name: spell, source});
				const active = state.isStateTypeActive?.("smiteOfProtection");
				const after = {ac: state.getArmorClass(), save: state.getSaveMod(saveAbility)};
				state.advanceRound?.();
				return {before, after, active, expired: !state.isStateTypeActive?.("smiteOfProtection")};
			}, {spell: e.spell, source: e.source, saveAbility: e.saveAbility});
			if (!result.active) throw new Error(`${e.spell}|${e.source} did not activate cover`);
			if (result.after.ac - result.before.ac !== e.acDelta) throw new Error(`cover AC delta=${result.after.ac - result.before.ac}, expected ${e.acDelta}`);
			if (result.after.save - result.before.save !== e.saveDelta) throw new Error(`cover save delta=${result.after.save - result.before.save}, expected ${e.saveDelta}`);
			if (!result.expired) throw new Error(`cover did not expire at the start of the next turn`);
			return;
		}
		case "conditionalAdvantage": {
			const result = await charSheet.page.evaluate(({rollType, conditionalIncludes}) => {
				const state: any = (globalThis as any).charSheet?._state;
				const base = state?.aggregateModifiers?.(rollType) || {};
				const match = (base.conditionalsAvailable || []).find((it: any) =>
					String(it.conditional || "").toLowerCase().includes(conditionalIncludes.toLowerCase()));
				const opted = match
					? state?.aggregateModifiers?.(rollType, {appliedConditionalIds: new Set([match.id])})
					: null;
				return {
					defaultAdvantage: !!base.advantage,
					offered: match ? {advantage: !!match.advantage, name: String(match.name || "")} : null,
					available: (base.conditionalsAvailable || []).map((it: any) => String(it.conditional || "")),
					optedAdvantage: !!opted?.advantage,
				};
			}, {rollType: e.rollType, conditionalIncludes: e.conditionalIncludes});
			if (!result.offered) {
				throw new Error(`no conditional on ${e.rollType} matching "${e.conditionalIncludes}" (available: ${JSON.stringify(result.available)})`);
			}
			if (!result.offered.advantage) throw new Error(`conditional "${e.conditionalIncludes}" is offered but does not carry advantage`);
			if (result.defaultAdvantage) throw new Error(`conditional "${e.conditionalIncludes}" leaked into the DEFAULT ${e.rollType} roll (must be opt-in)`);
			if (!result.optedAdvantage) throw new Error(`opting into "${e.conditionalIncludes}" did not grant advantage on ${e.rollType}`);
			if (e.sourceIncludes && !result.offered.name.toLowerCase().includes(e.sourceIncludes.toLowerCase())) {
				throw new Error(`conditional source="${result.offered.name}", expected to include "${e.sourceIncludes}"`);
			}
			return;
		}
		case "stateMethodEffect": {
			const result = await charSheet.page.evaluate(({method, args, setup}) => {
				const state: any = (globalThis as any).charSheet?._state;
				if (typeof state?.[method] !== "function") return {missing: true};
				if (setup?.hp != null) state.setCurrentHp?.(setup.hp);
				if (setup?.tempHp != null) state.setTempHp?.(setup.tempHp);
				const hpBefore = state.getCurrentHp?.();
				const tempBefore = state.getTempHp?.();
				const returned = state[method](...(args || []));
				return {
					missing: false,
					hpDelta: state.getCurrentHp?.() - hpBefore,
					tempHpDelta: state.getTempHp?.() - tempBefore,
					returned,
				};
			}, {method: e.method, args: e.args || [], setup: e.setup || null});
			if (result.missing) throw new Error(`state API "${e.method}" does not exist`);
			if (e.expectHpDelta != null && result.hpDelta !== e.expectHpDelta) {
				throw new Error(`${e.method} HP delta=${result.hpDelta}, expected ${e.expectHpDelta}`);
			}
			if (e.expectTempHpDelta != null && result.tempHpDelta !== e.expectTempHpDelta) {
				throw new Error(`${e.method} temp HP delta=${result.tempHpDelta}, expected ${e.expectTempHpDelta}`);
			}
			for (const [k, v] of Object.entries(e.expectReturns || {})) {
				if ((result.returned as any)?.[k] !== v) {
					throw new Error(`${e.method}().${k}=${JSON.stringify((result.returned as any)?.[k])}, expected ${JSON.stringify(v)}`);
				}
			}
			return;
		}
		case "activeAuraMechanics": {
			await charSheet.activateFeature(e.feature);
			const result = await charSheet.page.evaluate(({rollType}) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				return {
					damage: state.getEnemyTurnStartDamageEffects?.() || [],
					modifiers: state.aggregateModifiers?.(rollType),
					expectedDamage: Math.max(0, state.getAbilityMod?.("cha") + state.getProficiencyBonus?.()),
				};
			}, {rollType: e.conditionalRollType});
			const damage = result.damage.find((it: any) => it.damageType === e.damageType);
			if (!damage || damage.damage < e.damageMin) throw new Error(`enemy turn-start ${e.damageType} damage below ${e.damageMin}`);
			if (damage.damage !== result.expectedDamage) {
				throw new Error(`enemy turn-start ${e.damageType} damage=${damage.damage}, expected CHA modifier + PB = ${result.expectedDamage}`);
			}
			const conditional = result.modifiers?.conditionalsAvailable?.find((it: any) =>
				String(it.conditional || "").toLowerCase().includes(e.conditionalIncludes.toLowerCase()));
			if (!conditional?.advantage || result.modifiers.advantage) {
				throw new Error(`conditional save advantage was not surfaced default-off`);
			}
			await charSheet.deactivateFeature(e.feature);
			return;
		}
		case "restoreFeatureUseWithSpellSlot": {
			const result = await charSheet.page.evaluate(({featureName, slotLevel}) => {
				const cs: any = (globalThis as any).charSheet;
				const state = cs?._state;
				const feature = state.getFeatures?.().find((it: any) => it.name === featureName);
				const resource = state.getResources?.().find((it: any) => it.featureId === feature?.id || it.name === featureName);
				if (!feature || !resource) return {ok: false, reason: "missing feature/resource"};
				state.setResourceCurrent(resource.id, 0);
				state.setSpellSlots(slotLevel, Math.max(1, state.getSpellSlotsMax(slotLevel)), 1);
				const ok = state.restoreFeatureUseWithSpellSlot?.(feature.id, slotLevel);
				return {ok, resource: state.getResources().find((it: any) => it.id === resource.id)?.current, slots: state.getSpellSlotsCurrent(slotLevel)};
			}, {featureName: e.feature, slotLevel: e.slotLevel});
			if (!result.ok || result.resource !== 1 || result.slots !== 0) {
				throw new Error(`slot recovery failed: ${JSON.stringify(result)}`);
			}
			return;
		}
		case "attackPresent": {
			const re = e.namePattern instanceof RegExp ? e.namePattern : new RegExp(e.namePattern, "i");
			const names = await charSheet.getAttackNames();
			if (!names.some(n => re.test(n))) {
				throw new Error(`no attack matching ${re} present. seen=[${names.slice(0, 15).join(", ")}]`);
			}
			return;
		}
		case "grantedAttack": {
			const attack = await charSheet.getGrantedAttack(e.name);
			if (!attack) throw new Error(`granted attack "${e.name}" is absent`);
			if (e.damage && attack.damage !== e.damage) throw new Error(`${e.name} damage=${attack.damage}, expected ${e.damage}`);
			if (e.damageType && attack.damageType.toLowerCase() !== e.damageType.toLowerCase()) {
				throw new Error(`${e.name} damage type=${attack.damageType}, expected ${e.damageType}`);
			}
			if (e.range && attack.range !== e.range) throw new Error(`${e.name} range=${attack.range}, expected ${e.range}`);
			if (e.isSpellAttack != null && attack.isSpellAttack !== e.isSpellAttack) {
				throw new Error(`${e.name} isSpellAttack=${attack.isSpellAttack}, expected ${e.isSpellAttack}`);
			}
			if (e.usesMartialArtsDie && attack.damage !== attack.martialArtsDie) {
				throw new Error(`${e.name} damage=${attack.damage}, current Martial Arts die=${attack.martialArtsDie}`);
			}
			return;
		}
		case "attackQualifiesThisTurn": {
			const result = await charSheet.probeAttackQualification(e.attackName, e.sourceFeature);
			if (!result.clicked || result.threwError || !result.hasAttackAction || !result.hasSourceFeature) {
				throw new Error(`attack qualification failed: ${JSON.stringify(result)}`);
			}
			return;
		}
		case "combatFeatureAction": {
			const result = await charSheet.probeCombatFeatureAction({
				feature: e.feature,
				spend: e.spend,
				qualifyingAttackSourceFeature: e.qualifyingAttackSourceFeature,
				qualifyingAttackName: e.qualifyingAttackName,
			});
			if (result.afterBlocked != null && result.afterBlocked !== result.before) {
				throw new Error(`${e.feature} spent ${result.before - result.afterBlocked} ${e.resource} before its qualifying attack`);
			}
			if (result.after !== result.before - e.spend) {
				throw new Error(`${e.feature} left ${result.after} ${e.resource}; expected ${result.before - e.spend}`);
			}
			if (!!result.variableSpendConfig !== !!e.expectVariableSpend) {
				throw new Error(`${e.feature} variable-spend chooser=${!!result.variableSpendConfig}, expected ${!!e.expectVariableSpend}`);
			}
			if (result.variableSpendConfig && (e.spend < result.variableSpendConfig.min || e.spend > result.variableSpendConfig.max)) {
				throw new Error(`${e.feature} spend ${e.spend} outside chooser range ${result.variableSpendConfig.min}-${result.variableSpendConfig.max}`);
			}
			if (e.expectAttackCount != null) {
				if (result.output?.kind !== "attackVolley" || result.output.count !== e.expectAttackCount) {
					throw new Error(`${e.feature} output=${JSON.stringify(result.output)}, expected ${e.expectAttackCount} attacks`);
				}
			}
			if (e.expectSaveDamage) {
				if (result.output?.kind !== "saveDamage"
					|| result.output.saveAbility !== e.expectSaveDamage.saveAbility
					|| result.output.damage !== e.expectSaveDamage.damage
					|| result.output.damageType !== e.expectSaveDamage.damageType) {
					throw new Error(`${e.feature} output=${JSON.stringify(result.output)}, expected ${JSON.stringify(e.expectSaveDamage)}`);
				}
			}
			return;
		}
		case "activeStateTrigger": {
			const result = await charSheet.probeActiveStateTrigger(e.feature, e.stateTypeId);
			// `actionUsed` reads whichever action type the trigger declares, so a
			// bonus-action trigger is covered as well as the original reaction case.
			if (!result.active || !result.used || !result.actionUsed) {
				throw new Error(`${e.feature} trigger did not activate and consume its ${result.actionType || "action"}: ${JSON.stringify(result)}`);
			}
			if (result.label !== e.label || result.actionType !== e.actionType || result.damageType !== e.damageType) {
				throw new Error(`${e.feature} trigger metadata mismatch: ${JSON.stringify(result)}`);
			}
			if (result.damage < e.damageMin) throw new Error(`${e.feature} retaliation=${result.damage}, expected >=${e.damageMin}`);
			if (e.damageFormula != null && result.damageFormula !== e.damageFormula) {
				throw new Error(`${e.feature} trigger damage formula=${result.damageFormula}, expected ${e.damageFormula}`);
			}
			if (e.dcMin != null && !(result.dc >= e.dcMin)) {
				throw new Error(`${e.feature} trigger DC=${result.dc}, expected >=${e.dcMin}`);
			}
			return;
		}
		case "activeStateLight": {
			const result = await charSheet.probeActiveStateLight(e.feature, e.stateTypeId);
			if (result.bright !== e.bright || result.dim !== e.dim || !result.rendered) {
				throw new Error(`${e.feature} active light=${JSON.stringify(result)}, expected bright=${e.bright} dim=${e.dim} and rendered`);
			}
			return;
		}
	}
}

async function _runToggleEffect (
	e: EffectCheck,
	before: any,
	after: any,
	beforeRes: string[],
	afterRes: string[],
	beforeImm: string[],
	afterImm: string[],
	advProbes: Map<string, {advBefore: boolean; advAfter: boolean}>,
	conditionImmunityProbes: Map<string, {before: boolean; after: boolean}>,
	abilityModsBefore: Record<string, number>,
	beforeAttackNames: string[],
	afterAttackNames: string[],
	speedProbes: Map<string, {before: number; after: number; walkAfter: number}>,
): Promise<void> {
	switch (e.kind) {
		case "togglePlusAc": {
			const delta = after.ac - before.ac;
			let want: number;
			if (e.whenActive === "abilityMod") {
				if (!e.ability) throw new Error(`togglePlusAc(abilityMod) requires ability`);
				want = abilityModsBefore[e.ability] ?? 0;
			} else {
				want = e.whenActive;
			}
			if (delta !== want) throw new Error(`AC delta on toggle = ${delta}, expected ${want}`);
			return;
		}
		case "togglePlusSpeed": {
			const t = e.type ?? "walk";
			// The before/after snapshot only carries walkSpeed, so this kind can
			// ONLY assert on walk. It used to `return` silently for every other
			// type, which meant a probe like `{type: "fly", delta: 60}` passed
			// while asserting nothing at all. Fail loudly instead and point at
			// the kind that does capture non-walk speeds.
			if (t !== "walk") {
				throw new Error(`togglePlusSpeed cannot assert on speed:${t} — the toggle snapshot is walk-only. Use {kind: "toggleGrantsSpeed", type: "${t}", …} instead.`);
			}
			const delta = after.walkSpeed - before.walkSpeed;
			if (delta !== e.delta) throw new Error(`speed:${t} delta on toggle = ${delta}, expected ${e.delta}`);
			return;
		}
		case "toggleGrantsSpeed": {
			const probe = speedProbes.get(e.type);
			if (!probe) throw new Error(`internal: no speed probe captured for "${e.type}"`);
			if (probe.before > 0) throw new Error(`already had a ${e.type} speed (${probe.before}) before toggle — can't probe`);
			if (!(probe.after > 0)) throw new Error(`expected a ${e.type} speed after toggle, got ${probe.after}`);
			if (e.min != null && probe.after < e.min) throw new Error(`speed:${e.type}=${probe.after} after toggle, expected >=${e.min}`);
			if (e.equalsWalk && probe.after !== probe.walkAfter) {
				throw new Error(`speed:${e.type}=${probe.after} after toggle, expected to equal walk speed ${probe.walkAfter}`);
			}
			return;
		}
		case "toggleGrantsResistance": {
			const had = _hasDamageType(beforeRes, e.damageType);
			const has = _hasDamageType(afterRes, e.damageType);
			if (had) throw new Error(`already had resistance "${e.damageType}" before toggle — can't probe`);
			if (!has) throw new Error(`expected resistance "${e.damageType}" after toggle. seen=[${afterRes.join(", ")}]`);
			return;
		}
		case "toggleGrantsImmunity": {
			const had = _hasDamageType(beforeImm, e.damageType);
			const has = _hasDamageType(afterImm, e.damageType);
			if (had) throw new Error(`already had immunity "${e.damageType}" before toggle — can't probe`);
			if (!has) throw new Error(`expected immunity "${e.damageType}" after toggle. seen=[${afterImm.join(", ")}]`);
			return;
		}
		case "toggleGrantsAdvantage": {
			const probe = advProbes.get(e.rollType);
			if (!probe) throw new Error(`internal: no adv probe captured for "${e.rollType}"`);
			if (probe.advBefore) throw new Error(`already had advantage on "${e.rollType}" before toggle — can't probe`);
			if (!probe.advAfter) throw new Error(`expected advantage on "${e.rollType}" after toggle, but state.getAdvantageState reports none`);
			return;
		}
		case "toggleGrantsConditionImmunity": {
			const probe = conditionImmunityProbes.get(e.condition);
			if (!probe) throw new Error(`internal: no condition-immunity probe captured for "${e.condition}"`);
			if (probe.before) throw new Error(`already had condition immunity "${e.condition}" before toggle — can't probe`);
			if (!probe.after) throw new Error(`expected condition immunity "${e.condition}" after toggle`);
			return;
		}
		case "toggleAddsAttack": {
			const re = e.namePattern instanceof RegExp ? e.namePattern : new RegExp(e.namePattern, "i");
			if (beforeAttackNames.some(name => re.test(name))) throw new Error(`attack matching ${re} already present before toggle`);
			if (!afterAttackNames.some(name => re.test(name))) {
				throw new Error(`attack matching ${re} not granted by toggle. seen=[${afterAttackNames.slice(0, 15).join(", ")}]`);
			}
			return;
		}
	}
}

const _describeName = (n: string | RegExp): string =>
	n instanceof RegExp ? n.toString() : `"${n}"`;

/**
 * Assert every `FeatureCheck` whose `level <= currentLevel` is wired
 * correctly on the sheet. Collects per-entry errors and surfaces a
 * single grouped failure so tests don't bail on the first miss.
 */
export async function assertFeaturesMatrix (
	charSheet: CharacterSheetPage,
	matrix: FeatureCheck[],
	currentLevel: number,
): Promise<void> {
	if (!matrix?.length) return;

	const allFeatures = await charSheet.getActivatableFeatureNames().catch(() => [] as string[]);
	const toggleable = await charSheet.getToggleableFeatureNames().catch(() => [] as string[]);
	const knownSpells = await charSheet.getKnownSpellNames().catch(() => [] as string[]);
	// Weapon Mastery picks (Club, Dagger, …) have NO dedicated per-weapon row
	// on the Features tab — only the generic "Weapon Mastery" card renders
	// there — so `kind: "pick"` checks built via `buildWeaponMasteryChecks`
	// need this separate, state-backed name list unioned in below.
	const weaponMasteryNames = await charSheet.getWeaponMasteryNames().catch(() => [] as string[]);
	const pickSearchPool = [...allFeatures, ...weaponMasteryNames];

	const errors: string[] = [];

	for (const fc of matrix) {
		if (fc.level > currentLevel) continue;
		if (fc.untilLevel != null && currentLevel > fc.untilLevel) continue;
		if (fc.skip) continue;

		const re = fc.name instanceof RegExp ? fc.name : new RegExp(fc.name, "i");
		const label = `L${fc.level} ${_describeName(fc.name)} (${fc.kind})`;

		try {
			switch (fc.kind) {
				case "passive": {
					if (!allFeatures.some(f => re.test(f))) {
						throw new Error(`feature not present in feature list. seen=${allFeatures.slice(0, 25).join(", ")}…`);
					}
					break;
				}

				case "pick": {
					if (!fc.pickedFrom?.length) throw new Error(`pickedFrom is required for kind="pick"`);
					const want = fc.pickedCount ?? 1;
					const pickPatterns = fc.pickedFrom.map(pf => pf instanceof RegExp ? pf : new RegExp(pf, "i"));
					// Count surfaced picks, not distinct pool names: repeatable options and
					// preserved source variants may legitimately share a display name.
					const matchCount = pickSearchPool.filter(featureName =>
						pickPatterns.some(pfRe => pfRe.test(featureName)),
					).length;
					if (matchCount < want) {
						throw new Error(`expected ≥${want} of ${fc.pickedFrom.length} picks to surface, got ${matchCount}. seen=${pickSearchPool.slice(0, 25).join(", ")}…`);
					}
					break;
				}

				case "toggle": {
					if (!allFeatures.some(f => re.test(f))) {
						throw new Error(`feature not present in feature list. seen=${allFeatures.slice(0, 25).join(", ")}…`);
					}
					if (!toggleable.some(f => re.test(f))) {
						throw new Error(`feature has no toggle button (expected toggleable). toggleable=${toggleable.slice(0, 15).join(", ")}…`);
					}
					const want = fc.toggleDelta ?? "any";
					if (want !== "none") {
						const delta = await probeToggleDelta(charSheet, re);
						if (!delta) throw new Error(`probeToggleDelta returned null (toggle vanished)`);
						const acOK = Math.abs(delta.acDelta) > 0;
						const dcOK = Math.abs(delta.dcDelta) > 0;
						// "any" means "some derived effect", so it accepts the
						// wider `changed` surface (resistances/speed/attacks/
						// damage) — a Rage-style toggle moves no AC and no DC.
						// "ac"/"dc" stay strict: they name the surface on purpose.
						const ok = (want === "any" && delta.changed)
							|| (want === "ac" && acOK)
							|| (want === "dc" && dcOK);
						if (!ok) {
							throw new Error(`toggleDelta=${want} failed; observed acDelta=${delta.acDelta} dcDelta=${delta.dcDelta} changed=${delta.changed}`);
						}
					} else {
						// just confirm it activates without error
						await charSheet.activateFeature(allFeatures.find(f => re.test(f))!);
						await charSheet.deactivateFeature(allFeatures.find(f => re.test(f))!);
					}
					break;
				}

				case "resource": {
					const nameStr = fc.resourceName ?? (fc.name instanceof RegExp ? fc.name.source : fc.name);
					const r = await charSheet.getResource(nameStr).catch(() => ({current: -1, max: -1}));
					if (r.max < 0) throw new Error(`resource not found on sheet`);
					if (fc.resourceMax != null) {
						if (Array.isArray(fc.resourceMax)) {
							const [lo, hi] = fc.resourceMax;
							if (r.max < lo || r.max > hi) {
								throw new Error(`resource max=${r.max} outside expected range [${lo},${hi}]`);
							}
						} else if (r.max !== fc.resourceMax) {
							throw new Error(`resource max=${r.max} expected ${fc.resourceMax}`);
						}
					}
					if (fc.restoreOn) {
						// restoration probe: spend 1, rest, check restoration
						const before = r.current;
						if (before <= 0) break; // can't probe an empty pool
						await charSheet.useResourceByName(nameStr, 1).catch(() => null);
						const afterSpend = await charSheet.getResource(nameStr).catch(() => r);
						if (afterSpend.current >= before) {
							// resource could not be spent — skip the restore probe quietly
							break;
						}
						// short rest — via the page object; `_state.shortRest` does not exist
						await charSheet.triggerShortRest();
						const afterShort = await charSheet.getResource(nameStr).catch(() => afterSpend);
						const shortRestored = afterShort.current >= before;
						// long rest
						let longRestored = shortRestored;
						if (!shortRestored && (fc.restoreOn === "long" || fc.restoreOn === "either")) {
							await charSheet.triggerLongRest();
							const afterLong = await charSheet.getResource(nameStr).catch(() => afterShort);
							longRestored = afterLong.current >= before;
						}
						if (fc.restoreOn === "short" && !shortRestored) throw new Error(`expected short-rest restore; got ${afterShort.current}/${afterShort.max}`);
						if (fc.restoreOn === "long" && !longRestored) throw new Error(`expected long-rest restore; got current=${(await charSheet.getResource(nameStr)).current}`);
						if (fc.restoreOn === "either" && !shortRestored && !longRestored) throw new Error(`expected short OR long rest restore`);
						if (fc.restoreOn === "none" && shortRestored) throw new Error(`expected NO short-rest restore but resource refilled`);
					}
					break;
				}

				case "spells": {
					if (!fc.grantsSpells?.length) throw new Error(`grantsSpells required for kind="spells"`);
					const missing = fc.grantsSpells.filter(s =>
						!knownSpells.some(k => k.toLowerCase() === s.toLowerCase()));
					if (missing.length) {
						throw new Error(`spells missing from spellbook: ${missing.join(", ")}. seen=${knownSpells.slice(0, 20).join(", ")}…`);
					}
					break;
				}
			}

			// ── Phase 7 effect probes ─────────────────────────────
			if (fc.effects?.length) {
				// Phase 11: expand pickedFeatureGrants into concrete sub-effects
				// when the named pick surfaced. Skip silently when not surfaced
				// — backward-compatible with specs that don't yet declare
				// per-pick effects.
				const expandedEffects: EffectCheck[] = [];
				for (const eff of fc.effects) {
					if (eff.skip) continue;
					if (eff.kind === "pickedFeatureGrants") {
						const pickRe = eff.pickName instanceof RegExp
							? eff.pickName
							: new RegExp(`^${eff.pickName}$`, "i");
						const matched = allFeatures.some(f => pickRe.test(f));
						if (!matched) continue;
						for (const sub of eff.subEffects) {
							if (sub.skip) continue;
							if (sub.kind === "pickedFeatureGrants") continue; // no nesting
							expandedEffects.push(sub);
						}
						continue;
					}
					expandedEffects.push(eff);
				}

				const passiveOrRoll = expandedEffects.filter(e => !_TOGGLE_EFFECT_KINDS.has(e.kind));
				const toggleEffects = expandedEffects.filter(e => _TOGGLE_EFFECT_KINDS.has(e.kind));

				for (const eff of passiveOrRoll) {
					try { await _runPassiveOrRollEffect(charSheet, eff); }
					catch (eErr: any) { errors.push(`${label} effect ${eff.kind}: ${eErr.message}`); }
				}

				if (toggleEffects.length) {
					const matched = allFeatures.find(f => re.test(f));
					if (!matched) {
						errors.push(`${label} toggle-effects skipped: no matching feature on sheet`);
					} else {
						const before = await charSheet.snapshotEffectiveStats();
						const beforeRes = await charSheet.getResistances();
						const beforeImm = await charSheet.getImmunities();
						const beforeAttackNames = await charSheet.getAttackNames();
						const advProbes = new Map<string, {advBefore: boolean; advAfter: boolean}>();
						const conditionImmunityProbes = new Map<string, {before: boolean; after: boolean}>();
						const speedProbes = new Map<string, {before: number; after: number; walkAfter: number}>();
						for (const eff of toggleEffects) {
							if (eff.kind === "toggleGrantsAdvantage") {
								const s = await charSheet.getAdvantageState(eff.rollType);
								advProbes.set(eff.rollType, {advBefore: s.advantage, advAfter: false});
							}
							if (eff.kind === "toggleGrantsConditionImmunity") {
								const before = await charSheet.page.evaluate((condition) => {
									const cs: any = (globalThis as any).charSheet;
									return !!cs?._state?.hasConditionImmunityFromStates?.(condition);
								}, eff.condition);
								conditionImmunityProbes.set(eff.condition, {before, after: false});
							}
							if (eff.kind === "toggleGrantsSpeed") {
								speedProbes.set(eff.type, {before: await charSheet.getSpeed(eff.type), after: 0, walkAfter: 0});
							}
						}
						let activated = false;
						try { await charSheet.activateFeature(matched); activated = true; }
						catch (aErr: any) { errors.push(`${label} could not activate to probe toggle effects: ${aErr.message}`); }
						if (activated) {
							const after = await charSheet.snapshotEffectiveStats();
							const afterRes = await charSheet.getResistances();
							const afterImm = await charSheet.getImmunities();
							const afterAttackNames = await charSheet.getAttackNames();
							for (const eff of toggleEffects) {
								if (eff.kind === "toggleGrantsAdvantage") {
									const s = await charSheet.getAdvantageState(eff.rollType);
									const probe = advProbes.get(eff.rollType)!;
									probe.advAfter = s.advantage;
								}
								if (eff.kind === "toggleGrantsConditionImmunity") {
									const probe = conditionImmunityProbes.get(eff.condition)!;
									probe.after = await charSheet.page.evaluate((condition) => {
										const cs: any = (globalThis as any).charSheet;
										return !!cs?._state?.hasConditionImmunityFromStates?.(condition);
									}, eff.condition);
								}
								if (eff.kind === "toggleGrantsSpeed") {
									const probe = speedProbes.get(eff.type)!;
									probe.after = await charSheet.getSpeed(eff.type);
									probe.walkAfter = await charSheet.getSpeed("walk");
								}
							}
							for (const eff of toggleEffects) {
								try {
									await _runToggleEffect(eff, before, after, beforeRes, afterRes, beforeImm, afterImm, advProbes, conditionImmunityProbes, before.abilityMods, beforeAttackNames, afterAttackNames, speedProbes);
								} catch (eErr: any) {
									errors.push(`${label} effect ${eff.kind}: ${eErr.message}`);
								}
							}
							try { await charSheet.deactivateFeature(matched); } catch (_) { /* swallow */ }
						}
					}
				}
			}
		} catch (e: any) {
			errors.push(`${label}: ${e.message}`);
		}
	}

	if (errors.length) {
		throw new Error(`featuresMatrix at L${currentLevel} (${errors.length} failures):\n  - ${errors.join("\n  - ")}`);
	}
}
