/**
 * Character Sheet Powers Manager
 *
 * The Powers tab — psionic powers as first-class entities, the way spells are.
 *
 * Powers are *picked* by the shared optional-feature engine and live in `features`;
 * this module never writes that list directly. It reads the projection
 * (`state.getKnownPowers()`), which joins each pick to the parsed catalog, and drives
 * the runtime side through the single `state.manifestPower()` pipeline. Nothing here
 * computes strain, concentration or manifestation scores — it renders what state says
 * and hands decisions back to it.
 */
import {CharacterSheetModal} from "./charactersheet-modal.js";
import {renderStrainTracker, renderActiveManifestations} from "./charactersheet-psionics-ui.js";
import {CharacterSheetPowerPicker} from "./charactersheet-power-picker.js";

const {e_, Renderer, Parser, JqueryUtil, InputUiUtil, CharacterSheetState, CharacterSheetClassUtils} = /** @type {*} */ (globalThis);

class CharacterSheetPowers {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._filter = "";
		this._orderFilter = "all";
		this._disciplineFilter = "all";
		this._expanded = new Set();
	}

	// ==========================================
	// Entry point
	// ==========================================

	/**
	 * Render the whole tab. Returns early — and hides the tab — for a character with no
	 * manifester class, so a party of non-psions never sees an empty panel.
	 */
	render () {
		const container = document.getElementById("charsheet-powers-container");
		if (!container) return;

		if (!this._state.isPsionicManifester?.()) {
			container.innerHTML = "";
			return;
		}

		container.innerHTML = "";
		this._renderHeader(container);
		this._renderStrain(container);
		this._renderActive(container);
		this._renderLearning(container);
		this._renderList(container);
	}

	/** Re-render the sheet after a state change. Powers touch strain, HP, AC and speed. */
	_commit () {
		this._page._saveCurrentCharacter?.();
		this._page._renderCharacter?.();
	}

	static _ordinal (n) {
		return Parser?.getOrdinalForm ? Parser.getOrdinalForm(n) : `${n}`;
	}

	// ==========================================
	// Header — what the character brings to a manifestation
	// ==========================================

	_renderHeader (container) {
		const state = this._state;
		const calc = state.getFeatureCalculations();
		const budget = state.getPowersKnownBudget();
		const concMax = state.getPowerConcentrationMax();
		const concNow = state.getPowerConcentrations().length;

		const stat = (label, value, title = "", isWarn = false) => `
			<div class="charsheet__power-stat" ${title ? `title="${title}"` : ""}>
				<div class="charsheet__power-stat-value ${isWarn ? "charsheet__power-stat-value--over" : ""}">${value}</div>
				<div class="charsheet__power-stat-label">${label}</div>
			</div>`;

		const section = e_({outer: `
			<div class="charsheet__section">
				<div class="charsheet__section-header">
					<h4 class="charsheet__section-title">Manifesting</h4>
				</div>
				<div class="charsheet__power-stats">
					${stat("Manifestation die", state.getManifestationDie() || "—", "Rolled for every power of 2nd order or higher")}
					${stat("Power save DC", calc.powerSaveDc ?? "—")}
					${stat("Power attack", calc.powerAttackBonus != null ? `+${calc.powerAttackBonus}` : "—")}
					${stat("Max order", CharacterSheetPowers._ordinal(state.getMaxPowerOrder()), "The highest order you can learn or manifest")}
					${stat("1st-order known", `${budget.firstOrder.used}/${budget.firstOrder.max}`, "", budget.firstOrder.used > budget.firstOrder.max)}
					${stat("Powers known", `${budget.higherOrder.used}/${budget.higherOrder.max}`, "Powers of 2nd order or higher", budget.higherOrder.used > budget.higherOrder.max)}
					${stat("Concentration", `${concNow}/${concMax}`, "You can concentrate on this many powers at once — but never on a power and a spell together")}
				</div>
			</div>
		`});
		container.append(section);
	}

	// ==========================================
	// Strain — the price of everything above
	// ==========================================

	_renderStrain (container) {
		const state = this._state;
		if (!state.getStrainMaximum?.()) return;

		// Every other resource on this sheet depletes; strain accumulates and then kills
		// you. A first-time Talent should meet that rule here, in the panel, rather than
		// for the first time in a red error box after a bad roll. One sentence, and it
		// stops asking once the player has clearly met the mechanic.
		const total = state.getTotalStrain();
		const isNew = total === 0 && !state.getActiveManifestations().length;
		const section = e_({outer: `
			<div class="charsheet__section charsheet__section--strain">
				<div class="charsheet__section-header">
					<h4 class="charsheet__section-title">Strain</h4>
				</div>
				<details class="cs-psi-explainer" ${isNew ? "open" : ""}>
					<summary class="cs-psi-explainer__summary">What is strain?</summary>
					<div class="cs-psi-explainer__body ve-small">
						<p>Every other resource on this sheet depletes. Strain does the opposite: it <strong>accumulates</strong>,
						and it is the price of manifesting powers of 2nd order or higher.</p>
						<p>It lands on one of three tracks — <strong>body</strong>, <strong>mind</strong> or <strong>soul</strong> —
						and you choose which. Each track imposes a penalty at 1, 3, 5 and 7, and they stack.</p>
						<p>If your total strain ever passes your maximum, <strong>you die</strong>. A long rest clears strain
						entirely; a short rest can spend Hit Dice to remove it one point at a time.</p>
					</div>
				</details>
				<div class="charsheet__power-strain-host"></div>
			</div>
		`});
		renderStrainTracker(section.querySelector(".charsheet__power-strain-host"), {
			state,
			onChange: () => this._commit(),
			pPickTrack: prompt => this._pPickTrack(prompt),
			onStrainToMaintain: () => this._pStrainToMaintain(),
		});
		container.append(section);
	}

	async _pStrainToMaintain () {
		const state = this._state;
		const quote = state.payStrainToMaintain({apply: false});
		if (!quote?.ok) return;
		const track = await this._pPickTrack(`Keeping ${quote.powers.join(", ")} active costs ${quote.cost} strain. Take it as:`);
		if (!track) return;
		const res = state.payStrainToMaintain({track});
		if (!res.ok) {
			JqueryUtil.doToast({content: `That would take you past your strain maximum (${res.max}). The powers end instead.`, type: "warning"});
			state.breakConcentration();
		}
		this._commit();
	}

	async _pPickTrack (prompt) {
		const tracks = CharacterSheetState.PSIONIC_STRAIN_TRACKS;
		const ix = await InputUiUtil.pGetUserEnum({
			values: tracks.map(t => `${t[0].toUpperCase()}${t.slice(1)}`),
			// Without a default the select opens on a disabled placeholder, so confirming
			// without touching it returns null and the whole flow dies silently.
			default: 0,
			title: "Strain track",
			htmlDescription: `<div>${prompt}</div>`,
		});
		return ix == null ? null : tracks[ix];
	}

	// ==========================================
	// Active manifestations
	// ==========================================

	_renderActive (container) {
		const state = this._state;
		const count = state.getActiveManifestations().length;

		const section = e_({outer: `
			<div class="charsheet__section">
				<div class="charsheet__section-header">
					<h4 class="charsheet__section-title">Active manifestations</h4>
					<span class="charsheet__section-badge">${count}</span>
				</div>
				<div class="charsheet__power-active"></div>
			</div>
		`});

		renderActiveManifestations(section.querySelector(".charsheet__power-active"), {
			state,
			onChange: () => this._commit(),
			onExert: m => this._pApplyOutcomeExertion(m),
			emptyText: "Nothing running. Manifest a power below and it appears here, where you can end it or spend a Psionic Exertion on its outcome.",
		});
		container.append(section);
	}

	async _pApplyOutcomeExertion (manifestation) {
		const state = this._state;
		const options = state.getKnownExertions({timing: "outcome"});
		if (!options.length) return;

		const labels = options.map(o => {
			const cost = state.getExertionStrainCost(o.name, {powerOrder: manifestation.order});
			return `${o.name} — ${cost} strain · ${o.summary}`;
		});
		const ix = await InputUiUtil.pGetUserEnum({
			values: labels,
			default: 0,
			title: `Exert — ${manifestation.name}`,
			htmlDescription: `<div>Only one Psionic Exertion option can be spent on a power.</div>`,
		});
		if (ix == null) return;
		const chosen = options[ix];

		// Some options are priced by the target's size; ask only when there is a choice.
		let costOverride = null;
		if (chosen.costOptions?.length > 1) {
			const sizeIx = await InputUiUtil.pGetUserEnum({
				values: chosen.costOptions.map(o => `${o.label} — ${o.cost} strain`),
				default: 0,
				title: "Target size",
				htmlDescription: `<div>${chosen.name} costs more against a bigger target.</div>`,
			});
			if (sizeIx == null) return;
			costOverride = chosen.costOptions[sizeIx].cost;
		}

		const track = await this._pPickTrack("Take the strain as:");
		if (!track) return;

		const res = state.applyExertionToManifestation(manifestation.id, chosen.name, {track, costOverride});
		if (!res.ok) {
			JqueryUtil.doToast({
				content: res.reason === "overflow"
					? `${chosen.name} costs ${res.cost} strain, which would take you past your maximum.`
					: `You have already spent an Exertion on ${manifestation.name}.`,
				type: "warning",
			});
			return;
		}
		JqueryUtil.doToast({content: `${res.name}: ${res.applied} ${track} strain.`, type: "success"});
		this._commit();
	}

	// ==========================================
	// Learning from others
	// ==========================================

	_renderLearning (container) {
		const state = this._state;
		const learning = state.getPowerLearningProgress();
		const lockedOut = state.isPowerLearningLockedOut();
		if (!learning && !lockedOut) return;

		const section = e_({outer: `
			<div class="charsheet__section">
				<div class="charsheet__section-header">
					<h4 class="charsheet__section-title">Learning from others</h4>
				</div>
				<div class="charsheet__power-learning"></div>
			</div>
		`});
		const body = section.querySelector(".charsheet__power-learning");

		if (lockedOut) {
			body.append(e_({outer: `<div class="ve-muted ve-small">You failed to grasp a power you observed. You can't try again until you finish a long rest.</div>`}));
		}

		if (learning) {
			const pct = Math.round((learning.daysDone / learning.daysRequired) * 100);
			const wrp = e_({outer: `
				<div>
					<div class="ve-flex-v-center mb-1">
						<strong>${learning.name}</strong>
						<span class="ve-muted ve-small ml-2">${CharacterSheetPowers._ordinal(learning.order)}-order · day ${learning.daysDone} of ${learning.daysRequired}</span>
					</div>
					<div class="cs-psi-learn__meter" role="img" aria-label="Day ${learning.daysDone} of ${learning.daysRequired}"><div class="cs-psi-learn__fill" style="width:${pct}%"></div></div>
					<div class="ve-small ve-muted mt-1">One hour of practice a day. Studying a different power, or missing a day, forfeits this progress.</div>
					<div class="mt-2">
						<button class="ve-btn ve-btn-xs ve-btn-primary js-advance">Log a day of practice</button>
						<button class="ve-btn ve-btn-xs ve-btn-default js-abandon">Abandon</button>
					</div>
				</div>
			`});
			wrp.querySelector(".js-advance").addEventListener("click", () => {
				const res = state.advancePowerLearning();
				if (res.complete) JqueryUtil.doToast({content: `You have learned ${res.name}.`, type: "success"});
				this._commit();
			});
			wrp.querySelector(".js-abandon").addEventListener("click", () => { state.abandonPowerLearning(); this._commit(); });
			body.append(wrp);
		}

		container.append(section);
	}

	// ==========================================
	// The powers themselves
	// ==========================================

	_renderList (container) {
		const state = this._state;
		const all = state.getKnownPowers();

		// The once-per-level swap has had working state APIs (`replacePsionicPower`,
		// `getPowerReplacementCandidates`) since powers became first-class, and no way to
		// reach them. It shares the level-up picker rather than growing a second one.
		const canReplace = state.canReplacePower?.() && all.some(p => !p.isFirstOrder);
		const section = e_({outer: `
			<div class="charsheet__section">
				<div class="charsheet__section-header">
					<h4 class="charsheet__section-title">Powers</h4>
					<span class="charsheet__section-badge">${all.length}</span>
					${canReplace ? `<button class="ve-btn ve-btn-xs ve-btn-default ml-2 js-replace"
						title="Once per level you may swap a known power for another of the same order or lower">Swap a power</button>` : ""}
				</div>
				<div class="charsheet__power-filters"></div>
				<div class="charsheet__power-list"></div>
			</div>
		`});
		section.querySelector(".js-replace")?.addEventListener("click", () => this._pReplacePower());

		if (!all.length) {
			section.querySelector(".charsheet__power-list").append(e_({outer:
				`<div class="ve-muted ve-small py-2">You know no powers yet. Powers are chosen in the Builder, at level-up, or by observing another manifester.</div>`}));
			container.append(section);
			return;
		}

		this._renderFilters(section.querySelector(".charsheet__power-filters"), all);

		const needle = this._filter.trim().toLowerCase();
		const shown = all.filter(p => {
			if (needle && !p.name.toLowerCase().includes(needle)) return false;
			if (this._orderFilter !== "all" && p.order !== Number(this._orderFilter)) return false;
			if (this._disciplineFilter !== "all" && p.discipline !== this._disciplineFilter) return false;
			return true;
		});

		const list = section.querySelector(".charsheet__power-list");
		if (!shown.length) {
			const empty = e_({outer: `<div class="ve-muted ve-small py-2">No power matches those filters.
				<button class="ve-btn ve-btn-xs ve-btn-default ml-2 js-clear-filters">Clear filters</button></div>`});
			empty.querySelector(".js-clear-filters").addEventListener("click", () => {
				this._filter = "";
				this._orderFilter = "all";
				this._disciplineFilter = "all";
				this.render();
			});
			list.append(empty);
			container.append(section);
			return;
		}

		// Grouped by order, 1st first: the at-will pool reads differently from the rest and
		// the player picks from it on a different basis.
		for (const order of [...new Set(shown.map(p => p.order))].sort((a, b) => a - b)) {
			const group = e_({outer: `
				<div class="charsheet__power-group">
					<div class="charsheet__power-group-header">
						<span>${CharacterSheetPowers._ordinal(order)}-order</span>
						${order === 1 ? `<span class="charsheet__power-badge charsheet__power-badge--atwill">At will · no test · no strain</span>` : ""}
					</div>
				</div>
			`});
			for (const power of shown.filter(p => p.order === order)) group.append(this._renderRow(power));
			list.append(group);
		}

		container.append(section);
	}

	/**
	 * The per-level power swap: pick what leaves, then pick what replaces it.
	 *
	 * Two steps rather than one combined list, because the second list DEPENDS on the
	 * first — RAW only allows a replacement of equal or lower order, and
	 * `getPowerReplacementCandidates()` already encodes that.
	 */
	async _pReplacePower () {
		const state = this._state;
		// 1st-order powers are the at-will pool and are not swappable.
		const swappable = state.getKnownPowers().filter(p => !p.isFirstOrder);
		if (!swappable.length) return;

		// Every swappable power that has nothing to trade for is a dead option; excluding
		// them up front beats letting the player pick one and then explaining the mistake.
		const tradeable = swappable.filter(p => state.getPowerReplacementCandidates(p.id).length);
		if (!tradeable.length) {
			JqueryUtil.doToast({content: `There is no unknown power of a low enough order to swap for.`, type: "warning"});
			return;
		}

		const res = await CharacterSheetPowerPicker.pShow({
			state,
			pickCount: 1,
			title: "Swap a power",
			known: state.getKnownPowers(),
			page: this._page,
			confirmLabel: "Swap",
			swap: {
				outgoing: tradeable,
				fnGetCandidates: outgoing => state.getPowerReplacementCandidates(outgoing.id),
			},
		});
		if (!res?.picked?.length) return;

		const out = state.replacePsionicPower(res.outgoing.id, res.picked[0]);
		if (!out.ok) {
			JqueryUtil.doToast({content: `That swap isn't allowed (${out.reason}).`, type: "warning"});
			return;
		}
		JqueryUtil.doToast({content: `${out.outgoing} swapped for ${out.incoming}.`, type: "success"});
		this._commit();
	}

	_renderFilters (wrp, all) {
		const disciplines = [...new Set(all.map(p => p.discipline).filter(Boolean))];
		const orders = [...new Set(all.map(p => p.order))].sort((a, b) => a - b);
		const labelFor = code => all.find(p => p.discipline === code)?.disciplineLabel || code;

		const bar = e_({outer: `
			<div class="charsheet__power-filter-bar">
				<input type="search" class="ve-form-control form-control--minimal js-search" placeholder="Search powers…" value="${this._filter}" aria-label="Search powers">
				<select class="ve-form-control form-control--minimal js-order" aria-label="Filter by order">
					<option value="all">All orders</option>
					${orders.map(o => `<option value="${o}" ${String(this._orderFilter) === String(o) ? "selected" : ""}>${CharacterSheetPowers._ordinal(o)}-order</option>`).join("")}
				</select>
				${disciplines.length > 1 ? `<select class="ve-form-control form-control--minimal js-discipline" aria-label="Filter by discipline">
					<option value="all">All disciplines</option>
					${disciplines.map(d => `<option value="${d}" ${this._disciplineFilter === d ? "selected" : ""}>${labelFor(d)}</option>`).join("")}
				</select>` : ""}
			</div>
		`});

		const search = bar.querySelector(".js-search");
		search.addEventListener("input", evt => {
			this._filter = evt.target.value;
			// A full re-render replaces every node, so focus, caret AND scroll position all
			// have to be carried across or the list jumps to the top on each keystroke.
			const scroller = document.scrollingElement || document.documentElement;
			const scrollTop = scroller.scrollTop;
			this.render();
			const next = /** @type {*} */ (document.querySelector("#charsheet-powers-container .js-search"));
			if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
			scroller.scrollTop = scrollTop;
		});
		bar.querySelector(".js-order").addEventListener("change", evt => { this._orderFilter = evt.target.value; this.render(); });
		bar.querySelector(".js-discipline")?.addEventListener("change", evt => { this._disciplineFilter = evt.target.value; this.render(); });
		wrp.append(bar);
	}

	_renderRow (power) {
		const state = this._state;
		const isRunning = state.getActiveManifestations().some(m => m.powerId === power.id);
		const isFav = state.isFavorite?.("power", power.id) || false;
		const isExpanded = this._expanded.has(power.id);
		const meta = [
			power.meta.manifestationTime,
			power.meta.range,
			power.meta.duration || (power.concentrates ? "Concentration" : null),
		].filter(Boolean);

		const row = e_({outer: `
			<div class="charsheet__power-row ${isRunning ? "charsheet__power-row--active" : ""}">
				<div class="charsheet__power-row-main">
					<button class="charsheet__power-name js-expand" aria-expanded="${isExpanded}"
						${CharacterSheetClassUtils.getPsionicPowerHoverAttributes(power)}
						title="Click to show this power's modes">${power.name}</button>
					<div class="charsheet__power-tags">
						${power.disciplineLabel ? `<span class="charsheet__power-badge charsheet__power-badge--discipline">${power.disciplineLabel}</span>` : ""}
						${power.concentrates ? `<span class="charsheet__power-badge charsheet__power-badge--conc" title="Ties up one of your concentration slots">⏳ Concentration</span>` : ""}
						${power.meta.actionType === "bonus" ? `<span class="charsheet__power-badge">Bonus action</span>` : ""}
						${power.meta.actionType === "reaction" ? `<span class="charsheet__power-badge">Reaction</span>` : ""}
						${power.meta.actionType === "long" ? `<span class="charsheet__power-badge">Ritual-length</span>` : ""}
						${isRunning ? `<span class="charsheet__power-badge charsheet__power-badge--running">Running</span>` : ""}
					</div>
					<div class="charsheet__power-meta">${meta.join(" · ")}</div>
				</div>
				<div class="charsheet__power-row-actions">
					<button class="ve-btn ve-btn-xs ve-btn-default js-fav" aria-label="${isFav ? `Remove ${power.name} from favourites` : `Add ${power.name} to favourites`}" title="${isFav ? "Remove from favourites" : "Add to favourites"}" aria-pressed="${isFav}">${isFav ? "★" : "☆"}</button>
					<button class="ve-btn ve-btn-xs ve-btn-primary js-manifest">Manifest</button>
				</div>
				<div class="charsheet__power-body ${isExpanded ? "" : "ve-hidden"}"></div>
			</div>
		`});

		row.querySelector(".js-expand").addEventListener("click", () => {
			if (this._expanded.has(power.id)) this._expanded.delete(power.id);
			else this._expanded.add(power.id);
			this.render();
		});
		row.querySelector(".js-manifest").addEventListener("click", () => this._pManifest(power));
		row.querySelector(".js-fav").addEventListener("click", () => {
			const res = state.toggleFavorite({
				id: `power:${power.id}`,
				type: "power",
				name: power.name,
				icon: "🧠",
				detail: power.isFirstOrder ? "At will" : `${CharacterSheetPowers._ordinal(power.order)}-order`,
			});
			if (!res) JqueryUtil.doToast({content: "Your favourites are full — remove one first.", type: "warning"});
			this._commit();
		});

		if (isExpanded) this._renderBody(row.querySelector(".charsheet__power-body"), power);
		return row;
	}

	_renderBody (wrp, power) {
		const renderer = Renderer?.get ? Renderer.get().setFirstSection(true) : null;
		const paint = entries => {
			if (!entries?.length) return "";
			if (!renderer) return entries.filter(e => typeof e === "string").join("<br>");
			const stack = [];
			renderer.recursiveRender({type: "entries", entries}, stack);
			return stack.join("");
		};

		const parts = [];
		if (power.body?.length) parts.push(`<div class="charsheet__power-text">${paint(power.body)}</div>`);

		const level = this._state.getTotalLevel();
		for (const mode of power.modes) {
			// The level band that applies is the character's own; the others are noise.
			if (mode.kind === "levelBand" && !(level >= mode.levelBand.min && level <= mode.levelBand.max)) continue;
			parts.push(`
				<div class="charsheet__power-mode ${mode.kind === "increasedOrder" ? "charsheet__power-mode--upcast" : ""}">
					<div class="charsheet__power-mode-name">${mode.name}${mode.concentration ? ` <span class="ve-muted ve-small">(concentration, up to ${mode.concentration.duration} ${mode.concentration.unit})</span>` : ""}</div>
					<div class="charsheet__power-text">${paint(mode.entries)}</div>
				</div>`);
		}
		wrp.innerHTML = parts.join("");
	}

	// ==========================================
	// The manifest dialog
	// ==========================================

	/**
	 * Manifesting is a multi-field decision — which order, which mode, which Exertion,
	 * paid from which track — whose *combination* determines the cost. The dialog shows a
	 * live projection so the player can see the price before committing, rather than
	 * discovering it after the dice land.
	 */
	async _pManifest (power) {
		const state = this._state;
		const calc = state.getFeatureCalculations();
		const strainMax = state.getStrainMaximum();
		const maxOrder = Math.min(state.getMaxPowerOrder(), CharacterSheetClassUtils.PSIONIC_MAX_ORDER);
		const canIncrease = !power.isFirstOrder && maxOrder > power.order && !!power.increasedOrder;
		const others = state.getPowerConcentrations().filter(c => c.id !== `power:${power.id}`).length;
		const exertions = state.getKnownExertions({timing: "manifestation"});
		const canAdept = !power.isFirstOrder && !!state.canUseDisciplineAdeptReroll?.(power.discipline);
		const canReduce = !!state.canUseReduceStress?.();

		const orderOptions = [];
		for (let o = power.order; o <= Math.max(power.order, maxOrder); ++o) orderOptions.push(o);

		const contextBits = [
			`${CharacterSheetPowers._ordinal(power.order)}-order`,
			power.disciplineLabel,
			calc.powerSaveDc ? `save DC ${calc.powerSaveDc}` : null,
			calc.powerAttackBonus != null ? `attack +${calc.powerAttackBonus}` : null,
			power.meta.manifestationTime,
			power.meta.range,
		].filter(Boolean);

		// The decision, then the levers that change it. Reading order matters here: a
		// player mid-combat needs the price before the options, not after nine controls.
		const wrp = e_({outer: `
			<div class="charsheet__manifest-dialog">
				<div class="ve-small ve-muted mb-2">${contextBits.join(" · ")}</div>

				<div class="cs-manifest-risk" role="group" aria-live="polite">
					${power.isFirstOrder
		? `<div class="cs-manifest-risk__headline">At will — no test, no strain.</div>`
		: `<div class="cs-manifest-risk__row">
							<span class="cs-manifest-risk__die js-die">${state.getManifestationDie()}</span>
							<span class="cs-manifest-risk__vs">vs. score</span>
							<span class="cs-manifest-risk__score js-score">—</span>
							<span class="cs-manifest-risk__fail js-fail"></span>
						</div>
						<div class="cs-manifest-risk__detail js-score-detail"></div>`}
					<div class="cs-manifest-risk__projection js-projection"></div>
					<div class="cs-manifest-risk__notes js-risk-notes"></div>
				</div>

				${canIncrease ? `<label class="charsheet__manifest-field">Manifest at
					<select class="ve-form-control form-control--minimal js-order">
						${orderOptions.map(o => `<option value="${o}">${CharacterSheetPowers._ordinal(o)}-order${o > power.order ? " — increased" : ""}</option>`).join("")}
					</select></label>
					<div class="ve-small ve-muted mb-2 js-upcast-text"></div>` : ""}

				${power.variantModes.length ? `<label class="charsheet__manifest-field">Effect
					<select class="ve-form-control form-control--minimal js-mode">
						${power.variantModes.map(m => `<option value="${m.name}">${m.name}</option>`).join("")}
					</select></label>
					<div class="ve-small ve-muted mb-2 js-mode-text"></div>` : ""}

				<fieldset class="cs-manifest-tracks">
					<legend class="cs-manifest-tracks__legend">Take strain as</legend>
					<div class="cs-manifest-tracks__options"></div>
				</fieldset>

				${/* A Psionic Exertion is a class-defining lever, not an advanced setting — if the
					character has one it stays visible. Only the two per-rest safety valves,
					which most manifestations do not touch, collapse. */ ""}
				${exertions.length ? `<label class="charsheet__manifest-field">Psionic Exertion
					<select class="ve-form-control form-control--minimal js-exertion">
						<option value="">None</option>
						${exertions.map(e => `<option value="${e.name}">${e.name} — ${e.summary}</option>`).join("")}
					</select></label>` : ""}

				${canAdept || canReduce ? `
				<details class="cs-manifest-advanced">
					<summary class="cs-manifest-advanced__summary">Spend a per-rest reroll or reduction${canAdept && canReduce ? "" : canAdept ? " — Adept" : " — Reduce Stress"}</summary>
					<div class="cs-manifest-advanced__body">
						${canAdept ? `<label class="charsheet__manifest-check"><input type="checkbox" class="js-adept">
							Spend ${calc.adeptDiscipline || "discipline"} Adept to reroll a failed test</label>` : ""}
						${canReduce ? `<label class="charsheet__manifest-check"><input type="checkbox" class="js-reduce">
							Spend Reduce Stress to halve the strain (minimum 1)</label>` : ""}
					</div>
				</details>` : ""}

				<div class="ve-flex-v-center mt-3" style="gap:.5rem;">
					<button class="ve-btn ve-btn-primary js-confirm">Manifest</button>
					<button class="ve-btn ve-btn-default js-cancel">Cancel</button>
				</div>
				<div class="mt-2 js-result"></div>
			</div>
		`});

		// Each track is a card naming the penalty it would switch on, so choosing where to
		// take the hit is a comparison rather than a memory test against the class table.
		const trackWrp = wrp.querySelector(".cs-manifest-tracks__options");
		for (const [i, track] of CharacterSheetState.PSIONIC_STRAIN_TRACKS.entries()) {
			const at = state.getStrain()[track] || 0;
			trackWrp.append(e_({outer: `
				<label class="cs-manifest-track" data-track="${track}">
					<input type="radio" name="psi-track" class="js-track-radio" value="${track}" ${i === 0 ? "checked" : ""}>
					<span class="cs-manifest-track__name">${track[0].toUpperCase()}${track.slice(1)}</span>
					<span class="cs-manifest-track__at">now ${at}</span>
					<span class="cs-manifest-track__next js-track-next"></span>
				</label>
			`}));
		}

		// Recomputed whenever the projected cost changes, because the consequence of a
		// track depends on how much strain is about to land on it.
		const doUpdateTracks = worst => {
			for (const track of CharacterSheetState.PSIONIC_STRAIN_TRACKS) {
				const ele = wrp.querySelector(`.cs-manifest-track[data-track="${track}"] .js-track-next`);
				if (!ele) continue;
				if (state.getIgnoredStrainTrack() === track) { ele.textContent = "ignored — no effect"; continue; }

				const gained = state.getStrainEffectsGainedBy(track, worst);
				if (gained.length) {
					ele.textContent = `would switch on: ${gained.join(", ")}`;
					ele.classList.add("cs-manifest-track__next--hit");
					continue;
				}
				ele.classList.remove("cs-manifest-track__next--hit");
				const next = state.getNextStrainThreshold(track);
				ele.textContent = next ? `no new effect — next at ${next.at}: ${next.effect}` : "every effect already live";
			}
		};

		const {eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `🧠 ${power.name}`,
			isMinHeight0: true,
			cbClose: () => this._commit(),
		});
		eleModalInner.appendChild(wrp);

		const getOrder = () => Number(wrp.querySelector(".js-order")?.value || power.order);
		const getMode = () => wrp.querySelector(".js-mode")?.value || null;
		const getExertion = () => wrp.querySelector(".js-exertion")?.value || null;

		const getTrack = () => /** @type {*} */ (wrp.querySelector(".js-track-radio:checked"))?.value
			|| CharacterSheetState.PSIONIC_STRAIN_TRACKS[0];

		const eleProjection = wrp.querySelector(".js-projection");
		const eleNotes = wrp.querySelector(".js-risk-notes");
		const eleUpcast = wrp.querySelector(".js-upcast-text");
		if (eleUpcast && power.increasedOrder) {
			eleUpcast.textContent = (power.increasedOrder.entries || []).filter(e => typeof e === "string").join(" ");
		}

		// The dialog is where the variant is chosen, so it is where the variant has to be
		// legible. A bare list of names ("Inspired / Sorrow / Terror") asks the player to
		// remember the power they came here to look up.
		const eleModeText = wrp.querySelector(".js-mode-text");
		const syncModeText = () => {
			if (!eleModeText) return;
			const mode = power.variantModes.find(m => m.name === getMode());
			eleModeText.textContent = (mode?.entries || []).filter(e => typeof e === "string").join(" ");
		};
		syncModeText();

		const doUpdate = () => {
			const order = getOrder();
			const score = order + others;
			const eleScore = wrp.querySelector(".js-score");
			if (eleScore) {
				eleScore.textContent = String(score);
				wrp.querySelector(".js-fail").textContent = `roll under and it costs ${order} strain`;
				wrp.querySelector(".js-score-detail").textContent = others
					? `${order} for the power, +${others} for the ${others === 1 ? "power" : "powers"} you are already concentrating on`
					: "nothing else concentrated on";
			}

			// Worst case, so the RAW "manifest and die" branch is never a surprise.
			let worst = power.isFirstOrder ? 0 : order;
			if (wrp.querySelector(".js-reduce")?.checked && worst > 0) worst = Math.max(1, Math.ceil(worst / 2));
			const exertion = getExertion();
			const exertionCost = exertion ? state.getExertionStrainCost(exertion, {powerOrder: order}) : 0;
			worst += exertionCost;

			const now = state.getTotalStrain();
			const projected = now + worst;
			const isOver = projected > strainMax;

			eleProjection.innerHTML = worst
				? `<span class="cs-manifest-risk__arrow">${now} → <strong class="${isOver ? "cs-manifest-risk__over" : ""}">${projected}</strong> / ${strainMax}</span>
					<span class="cs-manifest-risk__worst">worst case +${worst}${exertionCost ? `, ${exertionCost} of it the Exertion` : ""}</span>`
				: `<span class="cs-manifest-risk__arrow">${now} / ${strainMax}</span><span class="cs-manifest-risk__worst">costs nothing</span>`;

			const conc = CharacterSheetClassUtils.getPsionicPowerConcentration(power.entity, {
				order, modeName: getMode(), characterLevel: state.getTotalLevel(),
			});
			const willEvict = conc && others >= state.getPowerConcentrationMax();
			const spellConc = state.getSpellConcentration();

			doUpdateTracks(worst);

			eleNotes.innerHTML = [
				isOver ? `<div class="cs-manifest-risk__danger">This would take you past your maximum — you would have to choose between manifesting and dying, or dropping to 0 hit points.</div>` : "",
				conc ? `<div>Concentration, up to ${conc.duration} ${conc.unit}.${willEvict ? " You are already holding as many powers as you can, so the oldest ends." : ""}</div>` : "",
				spellConc && conc ? `<div>Your concentration on ${spellConc.name} ends — you can't hold a spell and a power at once.</div>` : "",
			].filter(Boolean).join("");
		};

		wrp.querySelectorAll(".js-order, .js-mode, .js-exertion, .js-reduce, .js-adept, .js-track-radio")
			.forEach(ele => { ele.addEventListener("change", doUpdate); ele.addEventListener("input", doUpdate); });
		wrp.querySelector(".js-mode")?.addEventListener("change", syncModeText);
		doUpdate();

		wrp.querySelector(".js-cancel").addEventListener("click", () => doClose(false));
		wrp.querySelector(".js-confirm").addEventListener("click", () => {
			const track = getTrack();
			const res = state.manifestPower(power.id, {
				order: getOrder(),
				modeName: getMode(),
				exertion: getExertion(),
				track,
				useAdeptReroll: !!wrp.querySelector(".js-adept")?.checked,
				useReduceStress: !!wrp.querySelector(".js-reduce")?.checked,
			});
			this._renderManifestResult(wrp.querySelector(".js-result"), power, res, track);
		});
	}

	_renderManifestResult (wrp, power, res, track) {
		const state = this._state;

		if (!res.ok && res.reason === "overflow") {
			// The only place on this sheet where a button ends a campaign character. RAW
			// gives two outcomes and neither is good, but only one is permanent — so the
			// survivable one is the primary, and the fatal one has to be asked for twice
			// and names who dies.
			const name = state.getName?.() || "your character";
			const hp = state.getCurrentHp?.() ?? 0;
			const strainMax = state.getStrainMaximum();
			wrp.innerHTML = `
				<div class="cs-psi-overflow">
					<div class="cs-psi-overflow__head">Rolled <strong>${res.test.roll}</strong> on ${res.test.die} vs. score
						<strong>${res.test.score}</strong> — <strong>${res.test.strain} strain</strong>, past your maximum of ${strainMax}.</div>
					<p class="cs-psi-overflow__body">The power is more than ${name} can hold. Let it go and the backlash drops
						them from ${hp} hit points to 0 — unconscious, but alive and stabilisable. Push it through and it kills them.</p>
					<div class="cs-psi-overflow__actions">
						<button class="ve-btn ve-btn-primary js-decline">Let it go — drop to 0 hit points</button>
						<button class="ve-btn ve-btn-default ve-btn-xs js-die-arm">Push it through anyway…</button>
					</div>
					<div class="cs-psi-overflow__confirm ve-hidden" role="alert">
						<p class="cs-psi-overflow__warn">This kills <strong>${name}</strong>: the power manifests, then they die with
							${res.test.strain} strain past their maximum — 0 hit points and three failed death saves. There is no save against this.</p>
						<div class="cs-psi-overflow__actions">
							<button class="ve-btn ve-btn-danger ve-btn-xs js-die-manifest">Yes — manifest it and kill ${name}</button>
							<button class="ve-btn ve-btn-default ve-btn-xs js-die-cancel">Back</button>
						</div>
					</div>
				</div>`;

			const confirm = wrp.querySelector(".cs-psi-overflow__confirm");
			const armRow = wrp.querySelector(".cs-psi-overflow__actions");
			wrp.querySelector(".js-die-arm").addEventListener("click", () => {
				confirm.classList.remove("ve-hidden");
				armRow.classList.add("ve-hidden");
				/** @type {*} */ (wrp.querySelector(".js-die-cancel"))?.focus();
			});
			wrp.querySelector(".js-die-cancel").addEventListener("click", () => {
				confirm.classList.add("ve-hidden");
				armRow.classList.remove("ve-hidden");
				/** @type {*} */ (wrp.querySelector(".js-decline"))?.focus();
			});
			wrp.querySelector(".js-die-manifest").addEventListener("click", () => {
				state.resolveStrainOverflow({manifest: true, strain: res.test.strain, track});
				this._commit();
			});
			wrp.querySelector(".js-decline").addEventListener("click", () => {
				state.resolveStrainOverflow({manifest: false});
				JqueryUtil.doToast({
					content: `${name} is at 0 hit points and unconscious. They make a death saving throw at the start of each of their turns; an ally can stabilise them with a DC 10 Medicine check or any healing.`,
					type: "warning",
				});
				this._commit();
			});
			// The survivable choice is where the keyboard lands.
			/** @type {*} */ (wrp.querySelector(".js-decline"))?.focus();
			return;
		}

		if (!res.ok) {
			const messages = {
				"order-too-high": `You can only manifest powers up to ${CharacterSheetPowers._ordinal(res.maxOrder)}-order.`,
				"unknown-power": "That power is no longer known.",
				"not-a-manifester": "This character does not manifest powers.",
			};
			wrp.innerHTML = `<div class="ve-error">${messages[res.reason] || "That manifestation could not be resolved."}</div>`;
			return;
		}

		const lines = [];
		if (res.test.outcome === "automatic") {
			lines.push(`<div>Manifested at will — no test, no strain.</div>`);
		} else {
			lines.push(`<div>Rolled <strong>${res.test.roll}</strong> on ${res.test.die} vs. score <strong>${res.test.score}</strong> — ${res.test.strain ? `<strong>${res.test.strain} ${track} strain</strong>` : "no strain"}.</div>`);
			if (res.test.adeptRerollUsed) lines.push(`<div class="ve-muted ve-small">Adept rerolled ${res.test.firstRoll} → ${res.test.rerolledTo}; kept the better result.</div>`);
			if (res.test.reduceStressUsed) lines.push(`<div class="ve-muted ve-small">Reduce Stress halved ${res.test.rawStrain} strain to ${res.test.strain}.</div>`);
		}
		if (res.increased) lines.push(`<div class="ve-muted ve-small">Increased to ${CharacterSheetPowers._ordinal(res.order)}-order.</div>`);
		if (res.exertion) {
			lines.push(res.exertion.overflow
				? `<div class="ve-error">${res.exertion.name} would have cost ${res.exertion.cost} strain — more than you can take — so it was not applied.</div>`
				: `<div class="ve-muted ve-small">${res.exertion.name}: ${res.exertion.applied} strain.</div>`);
		}
		if (res.concentration) lines.push(`<div class="ve-muted ve-small">Concentrating, up to ${res.concentration.duration} ${res.concentration.unit}.</div>`);
		for (const dropped of res.droppedConcentrations) lines.push(`<div class="ve-muted ve-small">${dropped.name} ended.</div>`);

		// Show the penalties the new strain just switched on, where the cost lands.
		const effects = CharacterSheetState.PSIONIC_STRAIN_TRACKS
			.flatMap(t => state.getStrainTrackEffects(t).map(e => `${t[0].toUpperCase()}${t.slice(1)}: ${e}`));
		if (effects.length) lines.push(`<div class="ve-muted ve-small mt-1">Live strain effects — ${effects.join(" · ")}</div>`);
		lines.push(`<div class="ve-small mt-1">Strain now <strong>${state.getTotalStrain()} / ${state.getStrainMaximum()}</strong>.</div>`);

		wrp.innerHTML = lines.join("");
	}
}

globalThis.CharacterSheetPowers = CharacterSheetPowers;

export {CharacterSheetPowers};
