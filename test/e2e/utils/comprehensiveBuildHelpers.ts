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

			// Attempt 1: use the public addItemByUid helper if available.
			if (typeof cs._state.addItemByName === "function") {
				try {
					await cs._state.addItemByName(name, source, {attuned: !!attune});
					return {ok: true, via: "addItemByName"};
				} catch (e: any) { /* fall through */ }
			}

			// Attempt 2: use DataLoader directly to fetch the canonical item
			// JSON, then push into the inventory array maintained by state.
			const DL: any = (globalThis as any).DataLoader;
			if (!DL?.pCacheAndGet) return {ok: false, reason: "no DataLoader"};
			const allItems = await DL.pCacheAndGet("item", source || "PHB", {isCopy: true})
				.catch(() => null);
			let entry: any = null;
			if (Array.isArray(allItems)) {
				entry = allItems.find((it: any) => it.name?.toLowerCase() === name.toLowerCase()
					&& (!source || (it.source || "").toLowerCase() === source.toLowerCase()));
			}
			if (!entry) {
				// Fall back to scanning the global brew + site combined cache
				const all = await DL.pCacheAndGetAllSite?.("item").catch(() => []) || [];
				entry = all.find((it: any) => it.name?.toLowerCase() === name.toLowerCase()
					&& (!source || (it.source || "").toLowerCase() === source.toLowerCase()));
			}
			if (!entry) return {ok: false, reason: `item not found: ${name}|${source || "*"}`};

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

	// Pick the requested class radio
	const radios = modal.locator("input[type='radio'][name='multiclass-choice']");
	const radioCount = await radios.count();
	let picked = false;
	for (let i = 0; i < radioCount; i++) {
		const r = radios.nth(i);
		const val = await r.getAttribute("value");
		if (val && val.toLowerCase() === opts.className.toLowerCase()) {
			await r.scrollIntoViewIfNeeded();
			await r.check({force: true});
			picked = true;
			break;
		}
	}
	if (!picked) throw new Error(`startMulticlass: class "${opts.className}" not in multiclass list`);

	// Confirm
	const confirmBtn = modal.getByRole("button", {name: /add|confirm|level|continue/i}).first();
	await confirmBtn.click();
	await page.waitForTimeout(400);

	// Some classes pop a follow-up choice modal (Fighting Style, Cleric Domain, etc.).
	// Auto-tick the first available radio/checkbox in any visible follow-up modal.
	const followUp = page.locator(".ve-ui-modal__inner:visible, .ui-modal__inner:visible").last();
	if (await followUp.count() && await followUp.isVisible().catch(() => false)) {
		const firstChoice = followUp.locator("input[type='radio'], input[type='checkbox']").first();
		if (await firstChoice.count() && !(await firstChoice.isChecked().catch(() => true))) {
			await firstChoice.check({force: true}).catch(() => {/* ignore */});
		}
		const ok = followUp.getByRole("button", {name: /ok|confirm|finish|done/i}).first();
		if (await ok.count() && await ok.isVisible().catch(() => false)) {
			await ok.click().catch(() => {/* ignore */});
		}
	}

	await page.waitForTimeout(500);
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
): Promise<{acDelta: number; dcDelta: number}> {
	const re = featureName instanceof RegExp ? featureName : new RegExp(featureName, "i");
	if (charSheet.page.isClosed()) throw new Error(`probeToggleDelta(${re}): page already closed`);
	const features = await charSheet.getActivatableFeatureNames();
	const match = features.find(f => re.test(f));
	if (!match) throw new Error(`probeToggleDelta: no feature matches ${re} (have: ${features.join(", ")})`);

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
