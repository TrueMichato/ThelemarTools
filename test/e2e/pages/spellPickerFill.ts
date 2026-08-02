import {Page} from "@playwright/test";

/**
 * Shared driver for the character sheet's spell-picker widget
 * (`CharacterSheetSpellPicker.renderKnownSpellPicker` /
 * `renderWizardSpellbookPicker`, both of which emit a
 * `.charsheet__spell-picker-container`).
 *
 * ─── Why this exists (CS-BUG-016) ──────────────────────────────────
 *
 * Both the L1 builder wizard and the level-up wizard used to drive this
 * widget with ad-hoc code that could not fail for the right reason:
 *
 *   • `BuilderWizardPage.autoFillStartingSpells` parsed the pick counts
 *     out of prose with `/Choose\s+(\d+)\s+spells?/i ... || "0"`. The
 *     builder step renders TWO paragraphs matching `/Choose .* spells/i`
 *     — an intro decoy ("Choose your starting spells as a Bard.") that
 *     contains no digits, followed by the real one inside the picker
 *     ("Choose 2 spells (up to level 1) and 4 cantrips for your Bard:").
 *     `.first()` selected the decoy, both counts fell back to `0`, and
 *     the method returned reporting success having picked nothing.
 *     (It then looked for a `button[name=/add/i]` that does not exist —
 *     the real control is `button.spell-toggle` labelled `+`/`✓` — so
 *     the tail of that method had never once executed.)
 *
 *   • `LevelUpPage.autoFillAllSelections` read the counters correctly
 *     but collected every `+` button up-front and clicked them in a
 *     batch. The widget's `onToggle` calls `renderSpellList()`, which
 *     does `spellList.innerHTML = ""` — so every sibling button in the
 *     captured array is detached by the first click and its `.click()`
 *     is a silent no-op. Net effect: ONE effective pick per pass, and
 *     the loop ran 4 passes. That is the origin of the "first four
 *     entries of an alphabetically-sorted catalogue" symptom.
 *
 * Two invariants follow, and this module exists to hold them in one
 * place so neither page object can drift back:
 *
 *   1. RE-QUERY AFTER EVERY CLICK. The list is destroyed and rebuilt on
 *      each toggle; a captured NodeList is stale after one click.
 *
 *   2. SCOPE CLICKS TO THE LEVEL SECTION THAT OWNS THE COUNTER. The
 *      widget caps each type independently (`targetArr.length <
 *      maxCount`, else it toasts and returns). A known-caster picker
 *      renders cantrips and levelled spells in ONE container, cantrips
 *      first. Clicking "the next N `+` buttons" to satisfy the *spell*
 *      counter therefore burns those clicks on already-capped cantrips
 *      and never fills the spells.
 *
 * And the design requirement that motivated the whole fix: a failure to
 * determine the required counts, or a failure to reach them, THROWS with
 * a diagnostic. It never silently picks zero.
 */

/** One `<current>/<max>` counter inside a picker container. */
export interface SpellPickerCounter {
	/** `"cantrip"` counters are satisfied from the "Cantrips" level section. */
	kind: "cantrip" | "spell";
	current: number;
	max: number;
}

export interface SpellPickerReport {
	/** Container heading — "Spells Known" or "Spellbook". */
	title: string;
	counters: SpellPickerCounter[];
	/** Number of still-addable (`+`) options, split by section kind. */
	availableCantrips: number;
	availableSpells: number;
}

export interface FillSpellPickersResult {
	/** Per-container state AFTER filling. */
	reports: SpellPickerReport[];
	/** Total `+` clicks that actually moved a counter. */
	picked: number;
	/**
	 * Counters left unmet because the widget offered fewer selectable
	 * options than the requirement. Only ever non-empty when
	 * `allowInsufficientOptions` is set.
	 */
	insufficient: string[];
	/** `preferredNames` that were successfully selected. */
	pickedPreferred: string[];
	/** `preferredNames` that were not selectable in any picker. */
	missedPreferred: string[];
}

/**
 * Read every spell-picker container under `rootSelector`.
 *
 * Exported so callers can assert "this step has no pickers" as a
 * *proven* no-op rather than an assumed one.
 */
export async function readSpellPickers (page: Page, rootSelector: string): Promise<SpellPickerReport[]> {
	return page.evaluate((sel) => {
		const root = document.querySelector(sel);
		if (!root) return [];
		const containers = Array.from(root.querySelectorAll<HTMLElement>(".charsheet__spell-picker-container"));

		const isCantripSection = (section: Element) => {
			const title = section.querySelector(".charsheet__spell-picker-section-title")?.textContent || "";
			return /Cantrips/i.test(title);
		};

		return containers.map(container => {
			const counters: {kind: "cantrip" | "spell"; current: number; max: number}[] = [];
			for (const counter of Array.from(container.querySelectorAll<HTMLElement>(".spell-counter-value, .cantrip-counter-value"))) {
				const kind: "cantrip" | "spell" = counter.classList.contains("cantrip-counter-value") ? "cantrip" : "spell";
				const curEl = counter.querySelector(kind === "cantrip" ? ".cantrip-count-current" : ".spell-count-current");
				const maxEl = counter.querySelector(kind === "cantrip" ? ".cantrip-count-max" : ".spell-count-max");
				// NB: deliberately NOT `|| "0"`. A counter element that
				// exists but has an unreadable value is a harness bug we
				// want surfaced, so it becomes NaN and trips the
				// validation in `fillSpellPickers`.
				counters.push({
					kind,
					current: parseInt(curEl?.textContent ?? "", 10),
					max: parseInt(maxEl?.textContent ?? "", 10),
				});
			}

			let availableCantrips = 0;
			let availableSpells = 0;
			for (const section of Array.from(container.querySelectorAll(".charsheet__spell-picker-section"))) {
				const addable = Array.from(section.querySelectorAll<HTMLButtonElement>("button.spell-toggle"))
					.filter(b => (b.textContent || "").trim() === "+").length;
				if (isCantripSection(section)) availableCantrips += addable;
				else availableSpells += addable;
			}

			return {
				title: (container.querySelector(".charsheet__levelup-section-title")?.textContent || "").trim(),
				counters,
				availableCantrips,
				availableSpells,
			};
		});
	}, rootSelector);
}

/**
 * Click exactly one still-addable `+` button belonging to the given
 * section kind inside container `containerIdx`.
 *
 * Returns the name of the spell clicked, or `null` if there was nothing
 * left to click. One click per round-trip is deliberate — see invariant
 * (1) above.
 */
async function clickOneSpell (page: Page, rootSelector: string, containerIdx: number, kind: "cantrip" | "spell"): Promise<string | null> {
	return page.evaluate(({sel, idx, wantCantrip}) => {
		const root = document.querySelector(sel);
		if (!root) return null;
		const container = root.querySelectorAll<HTMLElement>(".charsheet__spell-picker-container")[idx];
		if (!container) return null;

		for (const section of Array.from(container.querySelectorAll(".charsheet__spell-picker-section"))) {
			const title = section.querySelector(".charsheet__spell-picker-section-title")?.textContent || "";
			if (/Cantrips/i.test(title) !== wantCantrip) continue;
			const btn = Array.from(section.querySelectorAll<HTMLButtonElement>("button.spell-toggle"))
				.find(b => (b.textContent || "").trim() === "+");
			if (!btn) continue;
			const name = (btn.closest(".charsheet__spell-picker-item")
				?.querySelector(".charsheet__spell-picker-item-name")?.textContent || "?").trim();
			btn.click();
			return name;
		}
		return null;
	}, {sel: rootSelector, idx: containerIdx, wantCantrip: kind === "cantrip"});
}

function describeReports (reports: SpellPickerReport[]): string {
	if (!reports.length) return "(no spell-picker containers found)";
	return reports
		.map((r, i) => `  [${i}] "${r.title}" ${r.counters.map(c => `${c.kind}=${c.current}/${c.max}`).join(" ")} `
			+ `(addable: ${r.availableCantrips} cantrips, ${r.availableSpells} spells)`)
		.join("\n");
}

/**
 * Try to select each of `names` by exact name, across every picker
 * container under `rootSelector`.
 *
 * Uses the widget's own search box to narrow the list first, which is
 * both faster and immune to the virtual-scroll-free-but-very-long list
 * the TGTT catalogue produces.
 *
 * Returns which names were taken and which could not be found, so the
 * caller can decide whether a miss is fatal. Nothing here throws — a
 * signature spell that a given class simply cannot learn is a
 * legitimate miss, and the caller has the context to judge that.
 */
export async function pickPreferredSpells (
	page: Page,
	rootSelector: string,
	names: string[],
): Promise<{picked: string[]; missed: string[]}> {
	const picked: string[] = [];
	const missed: string[] = [];

	for (const name of names) {
		const took = await page.evaluate(({sel, wanted}) => {
			const root = document.querySelector(sel);
			if (!root) return false;
			const containers = Array.from(root.querySelectorAll<HTMLElement>(".charsheet__spell-picker-container"));

			const setSearch = (container: HTMLElement, text: string) => {
				const input = container.querySelector<HTMLInputElement>("input.charsheet__spell-picker-search");
				if (!input) return false;
				input.value = text;
				input.dispatchEvent(new Event("input", {bubbles: true}));
				return true;
			};

			for (const container of containers) {
				const searched = setSearch(container, wanted);
				const items = Array.from(container.querySelectorAll<HTMLElement>(".charsheet__spell-picker-item"));
				const hit = items.find(item => {
					const label = (item.querySelector(".charsheet__spell-picker-item-name")?.textContent || "").trim();
					if (label.toLowerCase() !== wanted.toLowerCase()) return false;
					const btn = item.querySelector<HTMLButtonElement>("button.spell-toggle");
					return !!btn && (btn.textContent || "").trim() === "+";
				});
				if (hit) {
					hit.querySelector<HTMLButtonElement>("button.spell-toggle")!.click();
					// The click re-renders the list; clear the filter so the
					// generic fill pass afterwards sees the full catalogue.
					if (searched) setSearch(container, "");
					return true;
				}
				if (searched) setSearch(container, "");
			}
			return false;
		}, {sel: rootSelector, wanted: name});

		await page.waitForTimeout(80);
		if (took) picked.push(name);
		else missed.push(name);
	}

	return {picked, missed};
}

/**
 * Fill every spell-picker container under `rootSelector` to its declared
 * maximum.
 *
 * @param opts.preferredNames spell names to select FIRST, by exact
 *   name, before the generic fill takes whatever is left. This is how
 *   a preset's `signatureSpells` become deterministic picks instead of
 *   "whatever sorts first alphabetically". Names that the class cannot
 *   learn are reported in `result.missedPreferred` rather than throwing.
 * @param opts.expectPickers throw if no picker container is present.
 *   Set at the L1 builder, where reaching this code means the class was
 *   already identified as a caster.
 * @param opts.allowInsufficientOptions tolerate a picker that offers
 *   fewer selectable options than it requires, recording it in
 *   `result.insufficient` instead of throwing. Set at level-up, where a
 *   character can legitimately already know every remaining candidate.
 *   It does NOT relax the other failure modes: an unreadable counter, or
 *   a counter that stalls while `+` options are still on offer, always
 *   throws.
 *
 * @throws if any counter cannot be read, if a picker cannot be
 * satisfied (not enough selectable options, or a click stopped moving
 * the counter), or if `expectPickers` is set and no picker is present.
 * It never returns having quietly picked fewer than required — that is
 * the entire point of CS-BUG-016.
 */
export async function fillSpellPickers (
	page: Page,
	rootSelector: string,
	opts: {context: string; expectPickers?: boolean; allowInsufficientOptions?: boolean; preferredNames?: string[]},
): Promise<FillSpellPickersResult> {
	const initial = await readSpellPickers(page, rootSelector);

	if (!initial.length) {
		if (opts.expectPickers) {
			throw new Error(
				`fillSpellPickers(${opts.context}): expected at least one `
				+ `".charsheet__spell-picker-container" under "${rootSelector}" but found none. `
				+ `The spell step is present but rendered no picker — either the class was not `
				+ `detected as a caster, or the spell data failed to load.`,
			);
		}
		return {reports: [], picked: 0, insufficient: [], pickedPreferred: [], missedPreferred: opts.preferredNames ?? []};
	}

	for (const [i, report] of initial.entries()) {
		if (!report.counters.length) {
			throw new Error(
				`fillSpellPickers(${opts.context}): picker [${i}] ("${report.title}") rendered no `
				+ `<current>/<max> counter. Cannot determine how many spells to pick.\n${describeReports(initial)}`,
			);
		}
		for (const counter of report.counters) {
			if (!Number.isFinite(counter.current) || !Number.isFinite(counter.max)) {
				throw new Error(
					`fillSpellPickers(${opts.context}): picker [${i}] ("${report.title}") has an `
					+ `unreadable ${counter.kind} counter (current=${counter.current}, max=${counter.max}).\n`
					+ describeReports(initial),
				);
			}
		}
	}

	// Signature picks go FIRST, so they win the limited slots before the
	// generic pass fills the remainder alphabetically.
	const preferred = opts.preferredNames?.length
		? await pickPreferredSpells(page, rootSelector, opts.preferredNames)
		: {picked: [], missed: []};

	let picked = 0;
	const insufficient: string[] = [];
	for (let idx = 0; idx < initial.length; idx++) {
		for (const kind of ["cantrip", "spell"] as const) {
			// Re-read rather than trusting `initial` — earlier picks in
			// this same container have already moved the counters.
			let snapshot = (await readSpellPickers(page, rootSelector))[idx];
			let need = snapshot.counters
				.filter(c => c.kind === kind)
				.reduce((acc, c) => acc + Math.max(0, c.max - c.current), 0);
			if (need <= 0) continue;

			const available = kind === "cantrip" ? snapshot.availableCantrips : snapshot.availableSpells;
			if (available < need) {
				const detail = `picker [${idx}] ("${snapshot.title}") needs ${need} more ${kind}(s) `
					+ `but only ${available} are selectable`;
				if (!opts.allowInsufficientOptions) {
					throw new Error(`fillSpellPickers(${opts.context}): ${detail}.\n${describeReports([snapshot])}`);
				}
				insufficient.push(detail);
			}

			const chosen: string[] = [];
			// `need` clicks should suffice; the small slack absorbs a
			// click that lands on an option the widget rejects.
			for (let attempt = 0; attempt < need + 5 && need > 0; attempt++) {
				const name = await clickOneSpell(page, rootSelector, idx, kind);
				if (name == null) break;
				chosen.push(name);
				await page.waitForTimeout(60);

				snapshot = (await readSpellPickers(page, rootSelector))[idx];
				const remaining = snapshot.counters
					.filter(c => c.kind === kind)
					.reduce((acc, c) => acc + Math.max(0, c.max - c.current), 0);
				if (remaining < need) picked += need - remaining;
				need = remaining;
			}

			if (need > 0) {
				const stillAddable = kind === "cantrip" ? snapshot.availableCantrips : snapshot.availableSpells;
				// Running out of options is only forgivable under
				// `allowInsufficientOptions`; a stalled counter with
				// options still on offer never is.
				if (stillAddable > 0 || !opts.allowInsufficientOptions) {
					throw new Error(
						`fillSpellPickers(${opts.context}): picker [${idx}] ("${snapshot.title}") still needs `
						+ `${need} more ${kind}(s) after clicking ${chosen.length} option(s) `
						+ `[${chosen.join(", ")}]; ${stillAddable} option(s) remain selectable. `
						+ `The counter stopped advancing.\n${describeReports([snapshot])}`,
					);
				}
			}
		}
	}

	const finalReports = await readSpellPickers(page, rootSelector);
	const unmet = finalReports
		.flatMap((r, i) => r.counters.filter(c => c.current < c.max).map(c => `[${i}] "${r.title}" ${c.kind} ${c.current}/${c.max}`));
	if (unmet.length && !opts.allowInsufficientOptions) {
		throw new Error(
			`fillSpellPickers(${opts.context}): finished with unmet requirements: ${unmet.join("; ")}\n`
			+ describeReports(finalReports),
		);
	}

	return {reports: finalReports, picked, insufficient, pickedPreferred: preferred.picked, missedPreferred: preferred.missed};
}
