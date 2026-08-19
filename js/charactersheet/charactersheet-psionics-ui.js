/**
 * Psionics UI — the pieces that appear on more than one surface.
 *
 * The strain tracker and the running-manifestation list are needed by the Powers tab (the
 * library) and by the Combat tab (the cockpit), and they must never disagree about what a
 * character's strain is or what is running. Rather than write them twice, both hosts call
 * these functions.
 *
 * Two rules hold this together:
 *
 * 1. **No host branching.** Nothing here asks which tab it is rendering into. Density is a
 *    parameter (`compact`), and the layout otherwise responds to its *container* via
 *    `@container cs-panel` — the sheet's Container-Adaptive Rule. A `if (tab === …)` fork
 *    would rot the moment a third host appears.
 * 2. **No state of its own.** These are renderers. Every mutation goes back through the
 *    host's callbacks, so saving and re-rendering stay the host's job.
 */

const {e_, CharacterSheetState} = /** @type {*} */ (globalThis);

/** Title-case a track name for display. */
function labelTrack (track) {
	return `${track[0].toUpperCase()}${track.slice(1)}`;
}

/** Ordinal form of a power order, without depending on `Parser` being loaded. */
function ordinal (n) {
	const num = Number(n) || 0;
	const suffix = num === 1 ? "st" : num === 2 ? "nd" : num === 3 ? "rd" : "th";
	return `${num}${suffix}`;
}

/**
 * The strain tracker: total against the maximum, the three tracks, and what each is
 * heading for.
 *
 * The headline is the **lethal margin**, not the raw total. "3 / 9" makes a player do
 * arithmetic mid-encounter to answer the only question that matters; "6 before this kills
 * you" answers it. Each track then states its next penalty, so choosing where to take
 * strain is a comparison rather than a memory test.
 *
 * @param {HTMLElement} container
 * @param {*} opts
 * @param {*} opts.state the CharacterSheetState
 * @param {() => void} opts.onChange called after any mutation; host saves and re-renders
 * @param {(prompt: string) => Promise<string|null>} opts.pPickTrack
 * @param {() => void} [opts.onStrainToMaintain] shows the Strain to Maintain affordance
 * @param {boolean} [opts.compact] denser layout for a narrow column
 * @returns {boolean} whether anything was rendered
 */
function renderStrainTracker (container, {state, onChange, pPickTrack, onStrainToMaintain, compact = false} = {}) {
	const max = state?.getStrainMaximum?.() || 0;
	if (!container || !max) return false;

	const total = state.getTotalStrain();
	const headroom = state.getStrainHeadroom();
	const pct = Math.min(100, Math.round((total / max) * 100));
	const ignored = state.getIgnoredStrainTrack();

	// The one line worth reading mid-turn.
	const margin = headroom === 0
		? "Any more strain kills you"
		: `${headroom} more would kill you`;

	const wrp = e_({outer: `
		<div class="cs-psi-strain ${compact ? "cs-psi-strain--compact" : ""}">
			<div class="cs-psi-strain__head">
				<span class="cs-psi-strain__total">${total}<span class="cs-psi-strain__max"> / ${max}</span></span>
				<span class="cs-psi-strain__margin ${headroom <= 2 ? "cs-psi-strain__margin--warn" : ""}">${margin}</span>
			</div>
			<div class="cs-psi-strain__meter" role="img" aria-label="Strain ${total} of ${max}; ${margin.toLowerCase()}">
				<div class="cs-psi-strain__mask" style="left:${pct}%"></div>
			</div>
			<div class="cs-psi-strain__tracks"></div>
			<div class="cs-psi-strain__actions"></div>
		</div>
	`});

	const tracks = wrp.querySelector(".cs-psi-strain__tracks");
	for (const track of CharacterSheetState.PSIONIC_STRAIN_TRACKS) {
		const value = state.getStrain()[track] || 0;
		const live = state.getStrainTrackEffects(track);
		const next = state.getNextStrainThreshold(track);
		const isIgnored = ignored === track;

		const status = isIgnored
			? `<span class="cs-psi-track__ignored">ignored until your next long rest</span>`
			: [
				live.length ? `<span class="cs-psi-track__live">${live.join(" · ")}</span>` : "",
				next
					? `<span class="cs-psi-track__next">at ${next.at}: ${next.effect}</span>`
					: `<span class="cs-psi-track__next">every effect is live</span>`,
			].filter(Boolean).join("");

		const row = e_({outer: `
			<div class="cs-psi-track ${isIgnored ? "cs-psi-track--ignored" : ""}" data-track="${track}">
				<span class="cs-psi-track__name">${labelTrack(track)}</span>
				<button class="ve-btn ve-btn-xs ve-btn-default js-dec" ${value <= 0 ? "disabled" : ""}
					aria-label="Remove one ${track} strain" title="Remove one ${track} strain">−</button>
				<span class="cs-psi-track__value">${value}</span>
				<button class="ve-btn ve-btn-xs ve-btn-default js-inc" ${total >= max ? "disabled" : ""}
					aria-label="Add one ${track} strain" title="Add one ${track} strain">+</button>
				<div class="cs-psi-track__status">${status}</div>
			</div>
		`});
		row.querySelector(".js-inc").addEventListener("click", () => { state.addStrain(1, track); onChange?.(); });
		row.querySelector(".js-dec").addEventListener("click", () => { state.removeStrain(1, track); onChange?.(); });
		tracks.append(row);
	}

	const actions = wrp.querySelector(".cs-psi-strain__actions");
	const boost = (state.getResources?.() || []).find(r => r.name === "Psychic Boost");
	if (boost) {
		const btn = e_({
			outer: `<button class="ve-btn ve-btn-xs ve-btn-default" ${boost.current < 1 || !total ? "disabled" : ""}
				title="Remove strain equal to your proficiency bonus">🧘 Psychic Boost ${boost.current}/${boost.max}</button>`,
		});
		btn.addEventListener("click", async () => {
			const track = await pPickTrack?.("Remove strain from which track?");
			if (!track) return;
			state.usePsychicBoost(track);
			onChange?.();
		});
		actions.append(btn);
	}
	if (onStrainToMaintain && state.getPowerConcentrations().length) {
		const quote = state.payStrainToMaintain({apply: false});
		const btn = e_({
			outer: `<button class="ve-btn ve-btn-xs ve-btn-default"
				title="Use after failing a Constitution save, to keep every power you are concentrating on">🪢 Strain to Maintain — ${quote?.cost ?? 0}</button>`,
		});
		btn.addEventListener("click", () => onStrainToMaintain());
		actions.append(btn);
	}

	container.append(wrp);
	return true;
}

/**
 * The running-manifestation list: what is active, and the two things you can do about it.
 *
 * @param {HTMLElement} container
 * @param {*} opts
 * @param {*} opts.state
 * @param {() => void} opts.onChange
 * @param {(m: *) => void} [opts.onExert] omit to hide the Exert affordance
 * @param {string} [opts.emptyText] host-specific empty copy
 * @param {boolean} [opts.compact]
 * @returns {number} how many manifestations were rendered
 */
function renderActiveManifestations (container, {state, onChange, onExert, emptyText, compact = false} = {}) {
	if (!container) return 0;
	const active = state?.getActiveManifestations?.() || [];

	if (!active.length) {
		if (emptyText) container.append(e_({outer: `<div class="ve-muted ve-small py-2">${emptyText}</div>`}));
		return 0;
	}

	const canExert = !!onExert && !!state.getKnownExertions({timing: "outcome"}).length;

	for (const m of active) {
		const bits = [
			`${ordinal(m.order)}-order`,
			m.order > m.baseOrder ? "increased" : null,
			m.modeName || null,
			m.concentration ? `concentration, up to ${m.concentration.duration} ${m.concentration.unit}` : null,
			m.exertionUsed ? `${m.exertionUsed} spent` : null,
		].filter(Boolean);

		const row = e_({outer: `
			<div class="cs-psi-active ${compact ? "cs-psi-active--compact" : ""}">
				<div class="cs-psi-active__main">
					<span class="cs-psi-active__name">${m.name}</span>
					<span class="cs-psi-active__meta">${bits.join(" · ")}</span>
				</div>
				<div class="cs-psi-active__actions"></div>
			</div>
		`});
		const actions = row.querySelector(".cs-psi-active__actions");

		if (canExert && !m.exertionUsed) {
			const btn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default" title="Spend a Psionic Exertion triggered by this power's outcome">⚡ Exert</button>`});
			btn.addEventListener("click", () => onExert(m));
			actions.append(btn);
		}
		const endBtn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default" title="End this power — no action required, on your turn">End</button>`});
		endBtn.addEventListener("click", () => { state.endManifestation(m.id); onChange?.(); });
		actions.append(endBtn);

		container.append(row);
	}
	return active.length;
}

/** @type {*} */ (globalThis).CharacterSheetPsionicsUi = {renderStrainTracker, renderActiveManifestations, ordinal, labelTrack};

export {renderStrainTracker, renderActiveManifestations, ordinal, labelTrack};
