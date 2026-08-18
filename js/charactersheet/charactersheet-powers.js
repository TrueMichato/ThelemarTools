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

		const stat = (label, value, title = "") => `
			<div class="charsheet__power-stat" ${title ? `title="${title}"` : ""}>
				<div class="charsheet__power-stat-value">${value}</div>
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
					${stat("1st-order known", `${budget.firstOrder.used}/${budget.firstOrder.max}`)}
					${stat("Powers known", `${budget.higherOrder.used}/${budget.higherOrder.max}`, "Powers of 2nd order or higher")}
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
		const max = state.getStrainMaximum?.() || 0;
		if (!max) return;

		const total = state.getTotalStrain();
		const pct = Math.min(100, Math.round((total / max) * 100));
		const boost = (state.getResources?.() || []).find(r => r.name === "Psychic Boost");

		const section = e_({outer: `
			<div class="charsheet__section charsheet__section--strain">
				<div class="charsheet__section-header">
					<h4 class="charsheet__section-title">Strain</h4>
					<span class="charsheet__section-badge ${total >= max ? "charsheet__section-badge--danger" : ""}">${total} / ${max}</span>
				</div>
				<div class="charsheet__strain-meter" role="img" aria-label="Strain ${total} of ${max}">
					<div class="charsheet__strain-meter-fill" style="width:${pct}%"></div>
				</div>
				<div class="charsheet__strain-tracks mt-2"></div>
				<div class="charsheet__power-strain-actions mt-2"></div>
			</div>
		`});

		const tracks = section.querySelector(".charsheet__strain-tracks");
		const ignored = state.getIgnoredStrainTrack();
		for (const track of CharacterSheetState.PSIONIC_STRAIN_TRACKS) {
			const value = state.getStrain()[track] || 0;
			const effects = state.getStrainTrackEffects(track);
			const isIgnored = ignored === track;
			const row = e_({outer: `
				<div class="charsheet__strain-track">
					<span class="charsheet__strain-track-name">${track[0].toUpperCase()}${track.slice(1)}</span>
					<button class="ve-btn ve-btn-xs ve-btn-default js-dec" ${value <= 0 ? "disabled" : ""} aria-label="Remove one ${track} strain">−</button>
					<span class="charsheet__strain-track-value">${value}</span>
					<button class="ve-btn ve-btn-xs ve-btn-danger js-inc" ${total >= max ? "disabled" : ""} aria-label="Add one ${track} strain">+</button>
					<span class="charsheet__strain-track-effects ${isIgnored ? "ve-muted" : ""}">${isIgnored ? "ignored until your next long rest" : (effects.join(" · ") || "no effect yet")}</span>
				</div>
			`});
			row.querySelector(".js-inc").addEventListener("click", () => { state.addStrain(1, track); this._commit(); });
			row.querySelector(".js-dec").addEventListener("click", () => { state.removeStrain(1, track); this._commit(); });
			tracks.append(row);
		}

		const actions = section.querySelector(".charsheet__power-strain-actions");
		if (boost) {
			const btn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-primary" ${boost.current < 1 || !total ? "disabled" : ""}>
				🧘 Psychic Boost (${boost.current}/${boost.max}) — remove ${state.getProficiencyBonus()} strain</button>`});
			btn.addEventListener("click", async () => {
				const track = await this._pPickTrack("Remove strain from which track?");
				if (!track) return;
				state.usePsychicBoost(track);
				this._commit();
			});
			actions.append(btn);
		}
		if (state.getPowerConcentrations().length) {
			const quote = state.payStrainToMaintain({apply: false});
			const btn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default" title="Use after failing a Constitution save to keep every power you are concentrating on">
				🪢 Strain to Maintain — ${quote?.cost ?? 0} strain</button>`});
			btn.addEventListener("click", () => this._pStrainToMaintain());
			actions.append(btn);
		}

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
		const active = state.getActiveManifestations();

		const section = e_({outer: `
			<div class="charsheet__section">
				<div class="charsheet__section-header">
					<h4 class="charsheet__section-title">Active manifestations</h4>
					<span class="charsheet__section-badge">${active.length}</span>
				</div>
				<div class="charsheet__power-active"></div>
			</div>
		`});
		const list = section.querySelector(".charsheet__power-active");

		if (!active.length) {
			list.append(e_({outer: `<div class="ve-muted ve-small py-2">Nothing running. Manifest a power below and it appears here, where you can end it or spend a Psionic Exertion on its outcome.</div>`}));
			container.append(section);
			return;
		}

		const outcomeExertions = state.getKnownExertions({timing: "outcome"});
		for (const m of active) {
			const bits = [
				`${CharacterSheetPowers._ordinal(m.order)}-order`,
				m.order > m.baseOrder ? "increased" : null,
				m.modeName || null,
				m.concentration ? `concentration, up to ${m.concentration.duration} ${m.concentration.unit}` : null,
				m.exertionUsed ? `${m.exertionUsed} spent` : null,
			].filter(Boolean);

			const row = e_({outer: `
				<div class="charsheet__power-active-row">
					<div class="charsheet__power-active-main">
						<span class="charsheet__power-active-name">${m.name}</span>
						<span class="charsheet__power-active-meta">${bits.join(" · ")}</span>
					</div>
					<div class="charsheet__power-active-actions"></div>
				</div>
			`});
			const actions = row.querySelector(".charsheet__power-active-actions");

			if (outcomeExertions.length && !m.exertionUsed) {
				const btn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default" title="Spend a Psionic Exertion triggered by this power's outcome">⚡ Exert</button>`});
				btn.addEventListener("click", () => this._pApplyOutcomeExertion(m));
				actions.append(btn);
			}
			const endBtn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default" title="End this power (no action required, on your turn)">End</button>`});
			endBtn.addEventListener("click", () => { state.endManifestation(m.id); this._commit(); });
			actions.append(endBtn);
			list.append(row);
		}
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
					<div class="charsheet__strain-meter"><div class="charsheet__strain-meter-fill" style="width:${pct}%"></div></div>
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

		const section = e_({outer: `
			<div class="charsheet__section">
				<div class="charsheet__section-header">
					<h4 class="charsheet__section-title">Powers</h4>
					<span class="charsheet__section-badge">${all.length}</span>
				</div>
				<div class="charsheet__power-filters"></div>
				<div class="charsheet__power-list"></div>
			</div>
		`});

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
			list.append(e_({outer: `<div class="ve-muted ve-small py-2">No power matches those filters.</div>`}));
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
			this.render();
			// Re-rendering replaces the node, so focus has to be restored explicitly or
			// typing a second character silently goes nowhere.
			const next = document.querySelector("#charsheet-powers-container .js-search");
			if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
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
					<button class="charsheet__power-name js-expand" aria-expanded="${isExpanded}">${power.name}</button>
					<div class="charsheet__power-tags">
						${power.disciplineLabel ? `<span class="charsheet__power-badge charsheet__power-badge--discipline">${power.disciplineLabel}</span>` : ""}
						${power.concentrates ? `<span class="charsheet__power-badge charsheet__power-badge--conc" title="Ties up one of your concentration slots">Concentration</span>` : ""}
						${power.meta.actionType === "bonus" ? `<span class="charsheet__power-badge">Bonus action</span>` : ""}
						${power.meta.actionType === "reaction" ? `<span class="charsheet__power-badge">Reaction</span>` : ""}
						${power.meta.actionType === "long" ? `<span class="charsheet__power-badge">Ritual-length</span>` : ""}
						${isRunning ? `<span class="charsheet__power-badge charsheet__power-badge--running">Running</span>` : ""}
					</div>
					<div class="charsheet__power-meta">${meta.join(" · ")}</div>
				</div>
				<div class="charsheet__power-row-actions">
					<button class="ve-btn ve-btn-xs ve-btn-default js-fav" title="${isFav ? "Remove from favourites" : "Add to favourites"}" aria-pressed="${isFav}">${isFav ? "★" : "☆"}</button>
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

		const wrp = e_({outer: `
			<div class="charsheet__manifest-dialog">
				<div class="ve-small ve-muted mb-2">${contextBits.join(" · ")}</div>

				${power.isFirstOrder ? `<div class="charsheet__manifest-note mb-2">1st-order powers are manifested at will: no manifestation test, no strain.</div>` : ""}

				${canIncrease ? `<label class="charsheet__manifest-field">Manifest at
					<select class="ve-form-control form-control--minimal js-order">
						${orderOptions.map(o => `<option value="${o}">${CharacterSheetPowers._ordinal(o)}-order${o > power.order ? " — increased" : ""}</option>`).join("")}
					</select></label>
					<div class="ve-small ve-muted mb-2 js-upcast-text"></div>` : ""}

				${power.variantModes.length ? `<label class="charsheet__manifest-field">Effect
					<select class="ve-form-control form-control--minimal js-mode">
						${power.variantModes.map(m => `<option value="${m.name}">${m.name}</option>`).join("")}
					</select></label>` : ""}

				${exertions.length ? `<label class="charsheet__manifest-field">Psionic Exertion
					<select class="ve-form-control form-control--minimal js-exertion">
						<option value="">None</option>
						${exertions.map(e => `<option value="${e.name}">${e.name} — ${e.summary}</option>`).join("")}
					</select></label>` : ""}

				${power.isFirstOrder ? "" : `
					<div class="charsheet__manifest-score mb-2">
						Manifestation test: <strong class="js-die">${state.getManifestationDie()}</strong> vs. score
						<strong class="js-score">—</strong>
						<span class="ve-muted ve-small js-score-detail"></span>
					</div>`}

				<label class="charsheet__manifest-field">Take strain as
					<select class="ve-form-control form-control--minimal js-track">
						${CharacterSheetState.PSIONIC_STRAIN_TRACKS.map(t => `<option value="${t}">${t[0].toUpperCase()}${t.slice(1)}</option>`).join("")}
					</select></label>

				${canAdept ? `<label class="charsheet__manifest-check"><input type="checkbox" class="js-adept">
					Spend ${calc.adeptDiscipline || "discipline"} Adept to reroll a failed test</label>` : ""}
				${canReduce ? `<label class="charsheet__manifest-check"><input type="checkbox" class="js-reduce">
					Spend Reduce Stress to halve the strain (minimum 1)</label>` : ""}

				<div class="charsheet__manifest-projection" id="charsheet-manifest-projection" role="group" aria-live="polite"></div>

				<div class="ve-flex-v-center mt-3" style="gap:.5rem;">
					<button class="ve-btn ve-btn-primary js-confirm">Manifest</button>
					<button class="ve-btn ve-btn-default js-cancel">Cancel</button>
				</div>
				<div class="mt-2 js-result"></div>
			</div>
		`});

		const {eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `🧠 ${power.name}`,
			isMinHeight0: true,
			cbClose: () => this._commit(),
		});
		eleModalInner.appendChild(wrp);

		const getOrder = () => Number(wrp.querySelector(".js-order")?.value || power.order);
		const getMode = () => wrp.querySelector(".js-mode")?.value || null;
		const getExertion = () => wrp.querySelector(".js-exertion")?.value || null;

		const eleProjection = wrp.querySelector(".charsheet__manifest-projection");
		const eleUpcast = wrp.querySelector(".js-upcast-text");
		if (eleUpcast && power.increasedOrder) {
			eleUpcast.textContent = (power.increasedOrder.entries || []).filter(e => typeof e === "string").join(" ");
		}

		const doUpdate = () => {
			const order = getOrder();
			const score = order + others;
			const eleScore = wrp.querySelector(".js-score");
			if (eleScore) {
				eleScore.textContent = String(score);
				wrp.querySelector(".js-score-detail").textContent = others
					? `(${order} + ${others} for the ${others === 1 ? "power" : "powers"} you are already concentrating on)`
					: "(nothing else concentrated on)";
			}

			// Worst case, so the RAW "manifest and die" branch is never a surprise.
			let worst = power.isFirstOrder ? 0 : order;
			if (wrp.querySelector(".js-reduce")?.checked && worst > 0) worst = Math.max(1, Math.ceil(worst / 2));
			const exertion = getExertion();
			const exertionCost = exertion ? state.getExertionStrainCost(exertion, {powerOrder: order}) : 0;
			worst += exertionCost;

			const projected = state.getTotalStrain() + worst;
			const isOver = projected > strainMax;
			const conc = CharacterSheetClassUtils.getPsionicPowerConcentration(power.entity, {
				order, modeName: getMode(), characterLevel: state.getTotalLevel(),
			});
			const concMax = state.getPowerConcentrationMax();
			const willEvict = conc && others >= concMax;

			eleProjection.innerHTML = [
				`<div>Worst case <strong>+${worst}</strong> strain · projected <strong>${projected} / ${strainMax}</strong>${exertionCost ? ` (${exertionCost} of it for the Exertion)` : ""}</div>`,
				isOver ? `<div class="ve-error">That exceeds your strain maximum. You would have to choose between manifesting and dying, or dropping to 0 hit points.</div>` : "",
				conc ? `<div class="ve-muted ve-small">Concentration, up to ${conc.duration} ${conc.unit}.${willEvict ? " You are already concentrating on as many powers as you can, so the oldest one ends." : ""}</div>` : "",
				state.getSpellConcentration() && conc ? `<div class="ve-muted ve-small">Your concentration on ${state.getSpellConcentration().name} ends — you can't hold a spell and a power at once.</div>` : "",
			].filter(Boolean).join("");
		};

		wrp.querySelectorAll(".js-order, .js-mode, .js-exertion, .js-reduce, .js-adept, .js-track")
			.forEach(ele => { ele.addEventListener("change", doUpdate); ele.addEventListener("input", doUpdate); });
		doUpdate();

		wrp.querySelector(".js-cancel").addEventListener("click", () => doClose(false));
		wrp.querySelector(".js-confirm").addEventListener("click", () => {
			const track = wrp.querySelector(".js-track").value;
			const order = getOrder();
			const res = state.manifestPower(power.id, {
				order,
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
			wrp.innerHTML = `
				<div class="ve-error mb-2">Rolled <strong>${res.test.roll}</strong> on ${res.test.die} vs. score <strong>${res.test.score}</strong> —
					<strong>${res.test.strain} strain</strong>, which would take you past your maximum of ${state.getStrainMaximum()}.</div>
				<div class="ve-flex-v-center" style="gap:.5rem;">
					<button class="ve-btn ve-btn-xs ve-btn-danger js-die-manifest">Manifest it and die</button>
					<button class="ve-btn ve-btn-xs ve-btn-default js-decline">Don't manifest (drop to 0 hp)</button>
				</div>`;
			wrp.querySelector(".js-die-manifest").addEventListener("click", () => {
				state.resolveStrainOverflow({manifest: true, strain: res.test.strain, track});
				this._commit();
			});
			wrp.querySelector(".js-decline").addEventListener("click", () => {
				state.resolveStrainOverflow({manifest: false});
				this._commit();
			});
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
