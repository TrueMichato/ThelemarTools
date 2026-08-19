/**
 * Psionic power picker.
 *
 * A Talent chooses from a pool that no flat checkbox list can carry: 44 eligible powers at
 * level 1, over 90 by level 13, across six orders and six disciplines, against two separate
 * budgets. The generic optional-feature list rendered all of them as one unbroken run of
 * checkboxes.
 *
 * One renderer, two hosts:
 *
 * - `render()` draws the picker **inline**, which is what the level-up and Builder wizards
 *   use. A modal inside a wizard is a modal on a modal; the wizard already owns the
 *   interruption, so the picker is a section within it — the same shape Combat Methods use.
 * - `pShow()` wraps the same renderer in a dialog, for the Powers tab, where there is no
 *   host flow to live inside.
 *
 * Powers the character cannot yet learn are shown **locked with the reason** rather than
 * filtered away: "unlocks at Talent 13" tells a player what they are working toward, and an
 * absence tells them nothing.
 */
import {CharacterSheetModal} from "./charactersheet-modal.js";

const {e_, CharacterSheetClassUtils, CharacterSheetState} = /** @type {*} */ (globalThis);

class CharacterSheetPowerPicker {
	/** Ordinal form of a power order. */
	static _ordinal (n) {
		return CharacterSheetState._ordinalOrder(n);
	}

	/**
	 * Sort powers into the buckets the picker groups by, and mark the ones the character
	 * cannot take yet with a reason.
	 *
	 * Pure, so the gating maths is testable without a DOM.
	 *
	 * @param {*} opts
	 * @param {Array<*>} opts.options candidate optional-feature entities (synthetic powers)
	 * @param {number} opts.maxOrder the character's `getMaxPowerOrder()`
	 * @param {string} [opts.className] for the lock reason's wording
	 * @param {*} [opts.orderUnlockLevels] `{order: classLevel}` from the manifester config
	 * @param {Set<string>} [opts.knownKeys] lowercased `name|source` of powers already known
	 * @returns {Array<{order: number, powers: Array<*>}>} groups, ascending by order
	 */
	static groupByOrder ({options, maxOrder, className = "Talent", orderUnlockLevels = null, knownKeys = new Set()} = {}) {
		/** @type {Map<number, Array<*>>} */ const byOrder = new Map();
		for (const opt of options || []) {
			const order = opt._psionicOrder || CharacterSheetClassUtils.getPsionicPowerOrder(opt) || 0;
			if (!order) continue;
			const unlockLevel = orderUnlockLevels?.[order];
			const isLocked = order > maxOrder;
			const entry = {
				option: opt,
				order,
				discipline: opt._psionicPowerType || null,
				isKnown: knownKeys.has(`${opt.name}|${opt.source || ""}`.toLowerCase()),
				isLocked,
				lockReason: isLocked
					? (unlockLevel ? `unlocks at ${className} ${unlockLevel}` : `${CharacterSheetPowerPicker._ordinal(order)}-order — not yet available`)
					: null,
			};
			if (!byOrder.has(order)) byOrder.set(order, []);
			byOrder.get(order).push(entry);
		}
		// Within a group, what the player can actually take comes first. Sorting purely
		// alphabetically buries the selectable powers among the ones they already know, so
		// a Talent who knows Adapt and Again reads two dead rows before their first real
		// choice — and at the top of a 27-row group that is the whole first screen.
		const rank = p => (p.isKnown || p.isLocked ? 1 : 0);
		return [...byOrder.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([order, powers]) => ({
				order,
				powers: powers.sort((x, y) => rank(x) - rank(y) || x.option.name.localeCompare(y.option.name)),
			}));
	}

	/**
	 * Draw the picker into `container`.
	 *
	 * @param {HTMLElement} container
	 * @param {*} opts
	 * @param {*} opts.state
	 * @param {Array<*>} opts.options candidates (already filtered to the right feature types)
	 * @param {number} opts.pickCount how many the character may take
	 * @param {string} opts.title
	 * @param {Array<*>} [opts.known] already-known powers, marked rather than hidden
	 * @param {*} [opts.page] for hover links
	 * @param {(selected: Array<*>) => void} opts.onChange
	 * @returns {{getSelected: () => Array<*>}}
	 */
	static render (container, {state, options, pickCount, title, known = [], page = null, onChange} = {}) {
		/** @type {Array<*>} */ const selected = [];
		let search = "";
		let orderFilter = "all";
		let disciplineFilter = "all";

		const config = state?.getPsionicManifesterEntry?.()?.config || null;
		const maxOrder = state?.getMaxPowerOrder?.() || 6;
		const knownKeys = new Set((known || []).map(k => `${k.name}|${k.source || ""}`.toLowerCase()));
		const groups = CharacterSheetPowerPicker.groupByOrder({
			options,
			maxOrder,
			className: config?.className || "Talent",
			orderUnlockLevels: config?.orderUnlockLevels,
			knownKeys,
		});

		const disciplines = [...new Set(groups.flatMap(g => g.powers.map(p => p.discipline)).filter(Boolean))];
		const labelDiscipline = code => config?.disciplines?.[code]?.discipline || code;

		const budget = state?.getPowersKnownBudget?.();
		const wrp = e_({outer: `
			<div class="cs-power-picker">
				<div class="cs-power-picker__head">
					<span class="cs-power-picker__title">${title}</span>
					<span class="cs-power-picker__budget">Selected: <span class="js-count">0</span> / ${pickCount}</span>
				</div>
				${budget ? `<div class="cs-power-picker__pools ve-small ve-muted">Known: ${budget.firstOrder.used}/${budget.firstOrder.max} 1st-order · ${budget.higherOrder.used}/${budget.higherOrder.max} higher-order</div>` : ""}
				<div class="cs-power-picker__filters">
					<input type="search" class="ve-form-control form-control--minimal js-search" placeholder="Search powers…" aria-label="Search powers">
					<select class="ve-form-control form-control--minimal js-order" aria-label="Filter by order">
						<option value="all">All orders</option>
						${groups.map(g => `<option value="${g.order}">${CharacterSheetPowerPicker._ordinal(g.order)}-order</option>`).join("")}
					</select>
					${disciplines.length > 1 ? `<select class="ve-form-control form-control--minimal js-discipline" aria-label="Filter by discipline">
						<option value="all">All disciplines</option>
						${disciplines.map(d => `<option value="${d}">${labelDiscipline(d)}</option>`).join("")}
					</select>` : ""}
				</div>
				<div class="cs-power-picker__list"></div>
			</div>
		`});

		const list = wrp.querySelector(".cs-power-picker__list");
		const eleCount = wrp.querySelector(".js-count");

		const isSelected = opt => selected.some(s => s.name === opt.name && s.source === opt.source);

		const renderList = () => {
			list.innerHTML = "";
			const needle = search.trim().toLowerCase();
			let shown = 0;

			for (const group of groups) {
				if (orderFilter !== "all" && group.order !== Number(orderFilter)) continue;
				const powers = group.powers.filter(p => {
					if (needle && !p.option.name.toLowerCase().includes(needle)) return false;
					if (disciplineFilter !== "all" && p.discipline !== disciplineFilter) return false;
					return true;
				});
				if (!powers.length) continue;

				const locked = powers[0].isLocked;
				list.append(e_({outer: `
					<div class="cs-power-picker__group-head ${locked ? "cs-power-picker__group-head--locked" : ""}">
						<span>${CharacterSheetPowerPicker._ordinal(group.order)}-order</span>
						${locked ? `<span class="cs-power-picker__lock">${powers[0].lockReason}</span>` : `<span class="cs-power-picker__group-count">${powers.length}</span>`}
					</div>
				`}));

				for (const p of powers) {
					shown++;
					const checked = isSelected(p.option);
					const disabled = p.isLocked || p.isKnown || (!checked && selected.length >= pickCount);
					const row = e_({outer: `
						<label class="cs-power-picker__row ${p.isLocked ? "cs-power-picker__row--locked" : ""} ${p.isKnown ? "cs-power-picker__row--known" : ""}">
							<input type="checkbox" class="js-pick" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
							<span class="cs-power-picker__name">${CharacterSheetClassUtils.getPsionicPowerHoverLink(p.option, page) || p.option.name}</span>
							${p.discipline ? `<span class="cs-power-picker__chip">${labelDiscipline(p.discipline)}</span>` : ""}
							${p.isKnown ? `<span class="cs-power-picker__state">already known</span>` : ""}
							${p.isLocked ? `<span class="cs-power-picker__state">${p.lockReason}</span>` : ""}
						</label>
					`});
					// The name is a hover link, and a link inside a <label> steals the click:
					// picking a power would navigate to psionics.html instead of selecting
					// it. Hovering still works — this only stops the anchor acting as a
					// link, because in a picker the row's job is selection.
					row.querySelector(".cs-power-picker__name")?.addEventListener("click", (/** @type {*} */ evt) => {
						if (evt.target?.closest?.("a")) evt.preventDefault();
					});

					if (!disabled || checked) {
						row.querySelector(".js-pick").addEventListener("change", (/** @type {*} */ evt) => {
							if (evt.target.checked) {
								if (selected.length >= pickCount) { evt.target.checked = false; return; }
								selected.push(p.option);
							} else {
								const ix = selected.findIndex(s => s.name === p.option.name && s.source === p.option.source);
								if (ix >= 0) selected.splice(ix, 1);
							}
							eleCount.textContent = String(selected.length);
							onChange?.([...selected]);
							// Update the OTHER rows in place rather than re-rendering. A full
							// re-render would detach the checkbox mid-interaction (breaking
							// both a fast clicker and any automated fill) and throw away the
							// scroll position in a list 90 rows long.
							syncDisabled();
						});
					}
					list.append(row);
				}
			}

			if (!shown) list.append(e_({outer: `<div class="ve-muted ve-small py-2">No power matches those filters.</div>`}));
			syncDisabled();
		};

		/**
		 * Grey out the unpicked rows once the budget is spent, and re-enable them when it
		 * is not. Touches only the `disabled` flag, so no node is replaced.
		 */
		const syncDisabled = () => {
			const atCap = selected.length >= pickCount;
			for (const box of list.querySelectorAll(".js-pick")) {
				const row = box.closest(".cs-power-picker__row");
				const isLockedRow = row?.classList.contains("cs-power-picker__row--locked")
					|| row?.classList.contains("cs-power-picker__row--known");
				if (isLockedRow) { /** @type {*} */ (box).disabled = true; continue; }
				/** @type {*} */ (box).disabled = atCap && !(/** @type {*} */ (box).checked);
			}
		};

		const eleSearch = wrp.querySelector(".js-search");
		eleSearch.addEventListener("input", (/** @type {*} */ evt) => {
			search = evt.target.value;
			renderList();
		});
		wrp.querySelector(".js-order").addEventListener("change", (/** @type {*} */ evt) => { orderFilter = evt.target.value; renderList(); });
		wrp.querySelector(".js-discipline")?.addEventListener("change", (/** @type {*} */ evt) => { disciplineFilter = evt.target.value; renderList(); });

		renderList();
		container.append(wrp);
		return {getSelected: () => [...selected]};
	}

	/**
	 * The same picker in a dialog, for callers with no host flow to live inside.
	 *
	 * `swap` turns it into a trade: the power being given up is chosen in the same modal as
	 * the one being gained, because they are one decision. Splitting them across two dialogs
	 * asked the player to commit to a loss before seeing what it buys.
	 *
	 * @param {*} opts see `render`, minus `onChange`
	 * @param {?{outgoing: Array<*>, fnGetCandidates: function}} [opts.swap]
	 * @returns {Promise<Array<*>|{picked: Array<*>, outgoing: *}|null>} the chosen powers
	 *   (or `{picked, outgoing}` in swap mode), or null on cancel
	 */
	static async pShow ({state, options, pickCount, title, known = [], page = null, confirmLabel = "Learn", swap = null} = {}) {
		return new Promise(resolve => {
			let settled = false;
			CharacterSheetModal.pGetShow({
				title: `🧠 ${title}`,
				isMinHeight0: true,
				cbClose: () => { if (!settled) { settled = true; resolve(null); } },
			}).then(({eleModalInner, doClose}) => {
				const wrp = e_({outer: `<div class="cs-power-picker-modal">
					${swap ? `<label class="cs-power-picker__swap">
						<span class="cs-power-picker__swap-label">Give up</span>
						<select class="ve-form-control form-control--minimal js-outgoing" aria-label="Power to give up">
							${swap.outgoing.map((p, i) => `<option value="${i}">${(p.name || "").qq()} · ${CharacterSheetPowerPicker._ordinal(p.order)}-order</option>`).join("")}
						</select>
					</label>` : ""}
					<div class="js-host"></div>
					<div class="ve-flex-v-center mt-3" style="gap:.5rem;">
						<button class="ve-btn ve-btn-primary js-confirm" disabled>${confirmLabel}</button>
						<button class="ve-btn ve-btn-default js-cancel">Cancel</button>
					</div></div>`});
				eleModalInner.appendChild(wrp);

				const btnConfirm = wrp.querySelector(".js-confirm");
				const host = wrp.querySelector(".js-host");
				const eleOutgoing = /** @type {*} */ (wrp.querySelector(".js-outgoing"));
				let picker = null;
				let outgoing = swap ? swap.outgoing[0] : null;

				const mount = () => {
					host.innerHTML = "";
					/** @type {*} */ (btnConfirm).disabled = true;
					picker = CharacterSheetPowerPicker.render(host, {
						state,
						options: swap ? swap.fnGetCandidates(outgoing) : options,
						pickCount,
						title: swap ? `Learn instead of ${outgoing.name}` : title,
						known,
						page,
						onChange: sel => { /** @type {*} */ (btnConfirm).disabled = !sel.length; },
					});
				};
				mount();

				// Changing the outgoing power changes what is legal to gain (same order or
				// lower), so the list is rebuilt rather than merely re-filtered.
				if (eleOutgoing) {
					e_({ele: eleOutgoing, change: () => { outgoing = swap.outgoing[Number(eleOutgoing.value)]; mount(); }});
				}

				btnConfirm.addEventListener("click", () => {
					settled = true;
					const out = picker.getSelected();
					doClose(true);
					resolve(swap ? {picked: out, outgoing} : out);
				});
				wrp.querySelector(".js-cancel").addEventListener("click", () => { settled = true; doClose(false); resolve(null); });
			});
		});
	}
}

globalThis.CharacterSheetPowerPicker = CharacterSheetPowerPicker;

export {CharacterSheetPowerPicker};
