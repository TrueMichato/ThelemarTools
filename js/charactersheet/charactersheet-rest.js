/**
 * Character Sheet Rest Handler
 * Manages short rest, long rest, and recovery mechanics
 */

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_, ee} = /** @type {*} */ (globalThis);

class CharacterSheetRest {
	static _UNDO_REST_BTN_ID = "charsheet-btn-undo-rest";

	constructor (page) {
		this._page = page;
		this._state = page.getState();

		this._init();
	}

	_init () {
		this._initEventListeners();
	}

	_initEventListeners () {
		// Short rest button
		document.getElementById("charsheet-btn-short-rest")?.addEventListener("click", () => this._showShortRestDialog());

		// Long rest button
		document.getElementById("charsheet-btn-long-rest")?.addEventListener("click", () => this._showLongRestDialog());
	}

	async _showShortRestDialog () {
		const currentHp = this._state.getHp().current;
		const maxHp = this._state.getHp().max;
		const hitDice = this._state.getHitDice();
		const availableHitDice = hitDice.filter(hd => hd.current > 0);
		const conditions = this._state.getConditionNames?.() || [];
		const isConcentrating = this._state.isConcentrating?.();
		const concentration = this._state.getConcentration?.();
		const calcEarly = this._state.getFeatureCalculations?.() || {};
		const canReduceExhaustion = calcEarly.hasTireless && (this._state.getExhaustion?.() || 0) > 0;

		// Memorize Spell (2024 Wizard) is usable on a Short Rest even at full HP, so
		// it must keep the dialog from short-circuiting when there's a swap available.
		const memorizeCandidates = calcEarly.hasMemorizeSpell
			? CharacterSheetRest.getMemorizeSpellCandidates(this._state)
			: null;
		const canMemorizeSpell = !!(memorizeCandidates && memorizeCandidates.prepared.length && memorizeCandidates.spellbook.length);

		if (currentHp >= maxHp && !availableHitDice.length && !conditions.length && !isConcentrating && !canReduceExhaustion && !canMemorizeSpell) {
			JqueryUtil.doToast({type: "info", content: "You're already at full health with no hit dice to spend."});
			return;
		}

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "😴 Short Rest",
			isMinHeight0: true,
			isWidth100: true,
		});

		let totalHealing = 0;
		// Track spent dice by type
		const spentDice = {};

		const eleTotalHealing = e_({tag: "span", clazz: "charsheet__rest-healing-value", txt: "0"});

		// Track which conditions to remove
		const conditionsToRemove = new Set();
		let shouldBreakConcentration = false;

		ee`<div class="charsheet__rest-modal">
			<div class="charsheet__rest-intro">
				<p class="mb-1">During a short rest (typically 1 hour), you can spend Hit Dice to recover hit points.</p>
				<p class="mb-0">Current HP: <span class="charsheet__rest-current-hp">❤️ ${currentHp}/${maxHp}</span></p>
			</div>
			
			<div class="charsheet__rest-section">
				<div class="charsheet__rest-section-title">🎲 Available Hit Dice</div>
				<div id="short-rest-hit-dice-container"></div>
			</div>
			
			<div class="charsheet__rest-healing-display">
				<span class="charsheet__rest-healing-icon">💚</span>
				<span class="charsheet__rest-healing-label">Total Healing:</span>
				${eleTotalHealing}
				<span class="charsheet__rest-healing-label">HP</span>
			</div>
			
			${conditions.length > 0 || isConcentrating ? `
			<div class="charsheet__rest-section">
				<div class="charsheet__rest-section-title">🛡️ Conditions & Effects</div>
				<div class="charsheet__rest-options" id="short-rest-conditions-container">
					<p class="ve-muted ve-small mb-2">Select conditions or effects to remove during rest:</p>
				</div>
			</div>
			` : ""}
		</div>`.appendTo(modalInner);

		// Render condition checkboxes
		if (conditions.length > 0 || isConcentrating) {
			const condContainer = e_({ele: modalInner}).find("#short-rest-conditions-container");

			// Concentration first
			if (isConcentrating) {
				const cbConc = e_({tag: "input", type: "checkbox"});
				cbConc.onChange(() => { shouldBreakConcentration = cbConc.checked; });
				ee`<label class="charsheet__rest-option">
					${cbConc}
					<span>🔮 Break Concentration (${concentration?.spellName || "unknown spell"})</span>
				</label>`.appendTo(condContainer);
			}

			// Conditions
			conditions.forEach(condition => {
				const cb = e_({tag: "input", type: "checkbox"});
				cb.onChange(() => {
					if (cb.checked) conditionsToRemove.add(condition);
					else conditionsToRemove.delete(condition);
				});
				ee`<label class="charsheet__rest-option">
					${cb}
					<span>⚠️ Remove: ${condition}</span>
				</label>`.appendTo(condContainer);
			});
		}

		// Render hit dice options
		const hdContainer = e_({ele: modalInner}).find("#short-rest-hit-dice-container");
		if (!hitDice.length) {
			hdContainer.append(e_({tag: "p", clazz: "ve-muted ve-text-center", txt: "No hit dice available"}));
		} else {
			hitDice.forEach((hd, idx) => {
				// Track remaining locally for display
				let remaining = hd.current;
				const eleRemaining = e_({tag: "span", txt: `${remaining}`});
				const btn = e_({tag: "button", clazz: "ve-btn ve-btn-sm ve-btn-primary", txt: "🎲 Roll"});
				if (hd.current <= 0) btn.disabled = true;

				btn.onClick(() => {
					if (remaining <= 0) {
						JqueryUtil.doToast({type: "warning", content: "No hit dice remaining!"});
						return;
					}

					const roll = this._page.rollDice(1, hd.die);
					const conMod = this._state.getAbilityMod("con");
					const healing = Math.max(1, roll + conMod);

					totalHealing += healing;
					remaining--;

					// Track spent by die type
					if (!spentDice[hd.type]) spentDice[hd.type] = 0;
					spentDice[hd.type]++;

					eleRemaining.txt(`${remaining}`);
					eleTotalHealing.txt(`${totalHealing}`);

					if (remaining <= 0) btn.disabled = true;

					JqueryUtil.doToast({
						type: "success",
						content: `🎲 Rolled d${hd.die} (${roll}) + CON (${conMod >= 0 ? "+" : ""}${conMod}) = ${healing} HP`,
					});

					this._page._rollHistory?.addRoll({title: `Hit Die: ${hd.className}`, total: healing, breakdown: `d${hd.die} (${roll}) + CON (${conMod >= 0 ? "+" : ""}${conMod})`});
				});

				ee`<div class="charsheet__hit-die-row">
					<div class="charsheet__hit-die-info">
						<span class="charsheet__hit-die-class">${hd.className}:</span>
						<span class="charsheet__hit-die-die">d${hd.die}</span>
					</div>
					<span class="charsheet__hit-die-remaining">${eleRemaining} / ${hd.max} remaining</span>
					${btn}
				</div>`.appendTo(hdContainer);
			});
		}

		// Footer buttons
		const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel", click: () => doClose(false)});

		// --- Spell Slot Recovery Features (Arcane Recovery / Natural Recovery) ---
		const calc = this._state.getFeatureCalculations();
		let hasSlotRecovery = calc.hasArcaneRecovery || calc.hasNaturalRecovery;
		let slotRecoverySelections = {}; // {level: amount}
		let slotRecoveryMaxLevels = 0;
		let slotRecoveryFeatureName = "";

		if (hasSlotRecovery) {
			slotRecoveryMaxLevels = calc.hasArcaneRecovery
				? calc.arcaneRecoverySlotLevels
				: calc.naturalRecoverySlots;
			slotRecoveryFeatureName = calc.hasArcaneRecovery ? "Arcane Recovery" : "Natural Recovery";

			// The feature is once per long rest. If it has already been spent this
			// rest cycle, show a disabled note instead of the slot-selection controls.
			const recoveryFeature = this._state.getFeature(slotRecoveryFeatureName);
			const recoverySpent = !!(recoveryFeature?.uses && recoveryFeature.uses.current <= 0);

			if (recoverySpent) {
				const spentSection = e_({outer: `<div class="charsheet__rest-section">
					<div class="charsheet__rest-section-title">✨ ${slotRecoveryFeatureName}</div>
					<p class="ve-muted ve-small mb-0">Already used since your last long rest.</p>
				</div>`});
				const spentTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
				if (spentTarget?.parentNode) spentTarget.parentNode.insertBefore(spentSection, spentTarget);
				else modalInner.append(spentSection);
				// Disable recovery for this rest so the confirm handler skips it.
				hasSlotRecovery = false;
				slotRecoverySelections = null;
			} else {
				const recoverySection = e_({outer: `<div class="charsheet__rest-section">
				<div class="charsheet__rest-section-title">✨ ${slotRecoveryFeatureName}</div>
				<p class="ve-muted ve-small mb-2">Recover spell slots (max combined levels: ${slotRecoveryMaxLevels}, no 6th+ slots)</p>
				<div id="short-rest-slot-recovery-container"></div>
				<div class="charsheet__rest-healing-display">
					<span class="charsheet__rest-healing-label">Slot levels selected:</span>
					<span id="short-rest-slot-recovery-total">0</span>
					<span class="charsheet__rest-healing-label"> / ${slotRecoveryMaxLevels}</span>
				</div>
			</div>`});
				const insertTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
				if (insertTarget?.parentNode) insertTarget.parentNode.insertBefore(recoverySection, insertTarget);
				else modalInner.append(recoverySection);

				const slotContainer = recoverySection.querySelector("#short-rest-slot-recovery-container");
				const eleSlotTotal = recoverySection.querySelector("#short-rest-slot-recovery-total");

				const slots = this._state.getSpellSlots();
				for (let lvl = 1; lvl <= 5; lvl++) {
					const slot = slots[lvl];
					if (!slot || slot.max <= 0) continue;
					const missing = slot.max - slot.current;
					if (missing <= 0) continue;

					slotRecoverySelections[lvl] = 0;
					const eleCount = e_({tag: "span", txt: "0"});
					const btnAdd = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-primary", txt: "+"});
					const btnRemove = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-default", txt: "−"});
					btnRemove.disabled = true;

					const updateTotal = () => {
						const total = Object.entries(slotRecoverySelections).reduce((sum, [l, a]) => sum + (parseInt(l) * a), 0);
						eleSlotTotal.textContent = `${total}`;
					};

					btnAdd.onClick(() => {
						const currentTotal = Object.entries(slotRecoverySelections).reduce((sum, [l, a]) => sum + (parseInt(l) * a), 0);
						if (currentTotal + lvl > slotRecoveryMaxLevels) return;
						if (slotRecoverySelections[lvl] >= missing) return;
						slotRecoverySelections[lvl]++;
						eleCount.txt(`${slotRecoverySelections[lvl]}`);
						btnRemove.disabled = false;
						updateTotal();
					});

					btnRemove.onClick(() => {
						if (slotRecoverySelections[lvl] <= 0) return;
						slotRecoverySelections[lvl]--;
						eleCount.txt(`${slotRecoverySelections[lvl]}`);
						if (slotRecoverySelections[lvl] <= 0) btnRemove.disabled = true;
						updateTotal();
					});

					ee`<div class="charsheet__hit-die-row">
					<span>Level ${lvl} (${slot.current}/${slot.max})</span>
					<span>Missing: ${missing}</span>
					${btnRemove} ${eleCount} ${btnAdd}
				</div>`.appendTo(slotContainer);
				}
			}
		}

		// --- Sorcerous Restoration display ---
		const hasSorcRestore = calc.hasSorcerousRestoration;
		if (hasSorcRestore) {
			const sp = this._state.getSorceryPoints();
			const restoreAmt = calc.sorcerousRestorationAmount || 0;
			const willRecover = Math.min(restoreAmt, sp.max - sp.current);
			if (willRecover > 0) {
				const sorcSection = ee`<div class="charsheet__rest-section">
					<div class="charsheet__rest-section-title">⚡ Sorcerous Restoration</div>
					<p class="ve-muted ve-small mb-0">Will recover ${willRecover} sorcery point(s) (${sp.current}/${sp.max} → ${sp.current + willRecover}/${sp.max})</p>
				</div>`;
				const sorcTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
				if (sorcTarget?.parentNode) sorcTarget.parentNode.insertBefore(sorcSection, sorcTarget);
				else modalInner.append(sorcSection);
			}
		}

		// --- Hunter's Prey swap control ---
		const huntersPreySwap = this._buildHuntersPreySwapSection();
		if (huntersPreySwap) {
			const hpTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (hpTarget?.parentNode) hpTarget.parentNode.insertBefore(huntersPreySwap.section, hpTarget);
			else modalInner.append(huntersPreySwap.section);
		}

		// --- Tireless exhaustion reduction (TGTT Ranger) ---
		const tirelessExhaustion = this._buildTirelessExhaustionSection();
		if (tirelessExhaustion) {
			const teTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (teTarget?.parentNode) teTarget.parentNode.insertBefore(tirelessExhaustion.section, teTarget);
			else modalInner.append(tirelessExhaustion.section);
		}

		// --- Memorize Spell swap control (2024 Wizard) ---
		const memorizeSpell = this._buildMemorizeSpellSection();
		if (memorizeSpell) {
			const msTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (msTarget?.parentNode) msTarget.parentNode.insertBefore(memorizeSpell.section, msTarget);
			else modalInner.append(memorizeSpell.section);
		}

		const btnConfirm = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "✓ Finish Short Rest"});
		btnConfirm.onClick(() => {
			// Snapshot the full pre-rest state so this rest can be undone (BUG 8).
			// Captured BEFORE any mutation below; transient and never persisted.
			this._captureRestSnapshot("short");

			// Apply hit dice spending using spentDice tracker. The healing was
			// already rolled into `totalHealing` above, so decrement the pools
			// WITHOUT healing again (useHitDie() would heal a second time).
			Object.entries(spentDice).forEach(([dieType, count]) => {
				for (let i = 0; i < count; i++) {
					this._state.adjustHitDieCurrent(dieType, -1);
				}
			});

			if (totalHealing > 0) {
				this._state.heal(totalHealing);
			}
			this._restoreResources("short");

			// Restore Warlock pact slots on short rest
			const pactSlots = this._state.getPactSlots();
			if (pactSlots && pactSlots.max > 0) {
				this._state.setPactSlotsCurrent(pactSlots.max);
			}

			// Remove selected conditions
			conditionsToRemove.forEach(condition => {
				this._state.removeCondition?.(condition);
			});

			// Break concentration if requested
			if (shouldBreakConcentration) {
				this._state.breakConcentration?.();
			}

			// Apply Arcane/Natural Recovery slot selections
			let slotsRecovered = 0;
			if (hasSlotRecovery && slotRecoverySelections) {
				const slotsToRecover = Object.entries(slotRecoverySelections)
					.filter(([_, amount]) => amount > 0)
					.map(([level, amount]) => ({level: parseInt(level), amount}));

				if (slotsToRecover.length > 0) {
					const method = calc.hasArcaneRecovery
						? "useArcaneRecovery"
						: "useNaturalRecovery";
					if (this._state[method](slotsToRecover)) {
						slotsRecovered = slotsToRecover.reduce((s, r) => s + r.amount, 0);
					}
				}
			}

			// Sorcerous Restoration is auto-applied via onShortRest → applySorcerousRestoration
			const spRecovered = this._state.applySorcerousRestoration();

			// Apply Hunter's Prey option swap, if changed
			huntersPreySwap?.apply();

			// Apply Tireless exhaustion reduction, if elected
			const tirelessReduced = tirelessExhaustion?.apply() || 0;

			// Apply Memorize Spell swap, if elected
			const memorizeSwap = memorizeSpell?.apply() || false;

			this._page.saveCharacter();
			this._page.renderCharacter();
			doClose(true);

			let message = `😴 Short rest complete!`;
			if (totalHealing > 0) message += ` Recovered ${totalHealing} HP.`;
			if (slotsRecovered > 0) message += ` Recovered ${slotsRecovered} spell slot(s) via ${slotRecoveryFeatureName}.`;
			if (spRecovered > 0) message += ` Recovered ${spRecovered} sorcery point(s).`;
			if (conditionsToRemove.size > 0) message += ` Removed ${conditionsToRemove.size} condition(s).`;
			if (shouldBreakConcentration) message += ` Broke concentration.`;
			if (tirelessReduced > 0) message += ` Tireless reduced exhaustion by ${tirelessReduced}.`;
			if (memorizeSwap) message += ` Memorized ${memorizeSwap}.`;

			JqueryUtil.doToast({
				type: "success",
				content: message,
			});

			// Offer a persistent undo for this rest (BUG 8).
			this._showUndoRestAffordance("short");
		});

		ee`<div class="charsheet__modal-footer">
			${btnCancel}
			${btnConfirm}
		</div>`.appendTo(modalInner);
	}

	/**
	 * Compute the spells eligible for a 2024 Wizard's "Memorize Spell" feature.
	 *
	 * Memorize Spell (XPHB, Wizard level 5) lets the wizard, on finishing a Short
	 * Rest, replace one level 1+ spell they have prepared with a different level 1+
	 * spell from their spellbook. This returns the two candidate lists for that
	 * 1-for-1 swap, scoped to the Wizard class so multiclass spells are untouched.
	 *
	 * Static + state-only so it is unit-testable without any DOM.
	 * @param {*} state The CharacterSheetState instance.
	 * @returns {{prepared: *[], spellbook: *[], maxLevel: number}}
	 */
	static getMemorizeSpellCandidates (state) {
		const empty = {prepared: [], spellbook: [], maxLevel: 0};
		if (!state) return empty;

		const wizardLevel = state.getClassLevel?.("Wizard") || 0;
		if (wizardLevel <= 0) return empty;
		const maxLevel = Math.min(9, Math.ceil(wizardLevel / 2));

		const wizardSpells = (state.getSpells?.() || [])
			.filter(s => s.sourceClass && s.sourceClass.toLowerCase() === "wizard" && s.level > 0);

		// Outgoing: a level 1+ Wizard spell currently prepared (never an
		// always-prepared / granted spell — those cannot be swapped away).
		const prepared = wizardSpells.filter(s => s.prepared && !s.alwaysPrepared);

		// Incoming: a different level 1+ Wizard spellbook spell not currently
		// prepared, of a level the wizard can cast.
		const spellbook = wizardSpells.filter(s => !s.prepared && !s.alwaysPrepared && s.level <= maxLevel);

		return {prepared, spellbook, maxLevel};
	}

	/**
	 * Build the Memorize Spell swap control for the short-rest dialog (2024 Wizard).
	 *
	 * Surfaces the feature at the rules-correct moment (a Short Rest) and performs a
	 * guided 1-for-1 swap: unprepare one prepared spell, prepare one spellbook spell.
	 * Free prepared-toggling elsewhere is unchanged — this is the reminder + helper.
	 * Returns null when the feature is absent or there is nothing to swap.
	 * @returns {{section: HTMLElement, apply: function}|null}
	 */
	_buildMemorizeSpellSection () {
		const calc = this._state.getFeatureCalculations?.() || {};
		if (!calc.hasMemorizeSpell) return null;

		const {prepared, spellbook} = CharacterSheetRest.getMemorizeSpellCandidates(this._state);
		if (!prepared.length || !spellbook.length) return null;

		const selOut = e_({tag: "select", clazz: "form-control input-sm charsheet__memorize-spell-out"});
		selOut.appendChild(e_({tag: "option", val: "", txt: "— none —"}));
		prepared.forEach(s => selOut.appendChild(e_({tag: "option", val: s.id, txt: `${s.name} (Lv ${s.level})`})));

		const selIn = e_({tag: "select", clazz: "form-control input-sm charsheet__memorize-spell-in"});
		selIn.appendChild(e_({tag: "option", val: "", txt: "— none —"}));
		spellbook.forEach(s => selIn.appendChild(e_({tag: "option", val: s.id, txt: `${s.name} (Lv ${s.level})`})));

		const section = e_({outer: `<div class="charsheet__rest-section">
			<div class="charsheet__rest-section-title">📖 Memorize Spell</div>
			<p class="ve-muted ve-small mb-2">Swap one prepared Wizard spell for another from your spellbook (you may do this once on a Short Rest):</p>
		</div>`});
		const row = e_({outer: `<div class="ve-flex-v-center gap-2 ve-flex-wrap"></div>`});
		row.appendChild(e_({tag: "span", clazz: "ve-small ve-muted", txt: "Unprepare"}));
		row.appendChild(selOut);
		row.appendChild(e_({tag: "span", clazz: "ve-small ve-muted", txt: "→ Prepare"}));
		row.appendChild(selIn);
		section.appendChild(row);

		return {
			section,
			// Returns the swap label when a swap occurred, else false.
			apply: () => {
				const outId = selOut.value;
				const inId = selIn.value;
				if (!outId || !inId || outId === inId) return false;

				const outSpell = prepared.find(s => s.id === outId);
				const inSpell = spellbook.find(s => s.id === inId);
				if (!outSpell || !inSpell) return false;

				// Match by (name, source) so the swap works for both real-id and
				// legacy spells whose synthetic id is just `name|source`.
				this._state.setSpellPrepared(outSpell.name, outSpell.source, false);
				this._state.setSpellPrepared(inSpell.name, inSpell.source, true);
				return `${outSpell.name} → ${inSpell.name}`;
			},
		};
	}

	async _showLongRestDialog () {
		const currentHp = this._state.getHp().current;
		const maxHp = this._state.getHp().max;
		const hitDice = this._state.getHitDice();
		const totalMaxHd = hitDice.reduce((sum, hd) => sum + hd.max, 0);
		const totalCurrentHd = hitDice.reduce((sum, hd) => sum + hd.current, 0);
		const currentExhaustion = this._state.getExhaustion();
		const newHdTotal = Math.min(totalMaxHd, totalCurrentHd + Math.max(1, Math.floor(totalMaxHd / 2)));
		const conditions = this._state.getConditionNames?.() || [];
		const isConcentrating = this._state.isConcentrating?.();
		const concentration = this._state.getConcentration?.();

		// Items whose recharge period is satisfied by a long rest — surfaced so the
		// player knows what will refresh (dice-based ones are rolled on apply).
		const rechargingItems = (this._state.getItems() || [])
			.filter(it => CharacterSheetState.itemRechargesOnRest(it, "long") && (it.chargesCurrent ?? it.charges) < it.charges)
			.map(it => ({name: it.name, formula: CharacterSheetState.getItemRechargeFormula(it)}));

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "🌙 Long Rest",
			isMinHeight0: true,
			isWidth100: true,
		});

		const cbResetTempHp = e_({tag: "input", type: "checkbox"});
		cbResetTempHp.checked = true;
		const cbClearExhaustion = e_({tag: "input", type: "checkbox"});
		if (currentExhaustion > 0) cbClearExhaustion.checked = true;
		else cbClearExhaustion.disabled = true;
		const cbBreakConcentration = isConcentrating ? (() => { const cb = e_({tag: "input", type: "checkbox"}); cb.checked = true; return cb; })() : null;

		// Track which conditions to remove
		const conditionsToRemove = new Set(conditions); // All checked by default for long rest
		const conditionCheckboxes = [];

		ee`<div class="charsheet__rest-modal">
			<div class="charsheet__rest-intro">
				<p class="mb-0">A long rest (typically 8 hours) restores all hit points and recovers spent Hit Dice.</p>
			</div>
			
			<div class="charsheet__rest-section">
				<div class="charsheet__rest-section-title">📊 Recovery Summary</div>
				<ul class="charsheet__rest-recovery-list">
					<li class="charsheet__rest-recovery-item">
						<span class="charsheet__rest-recovery-label">❤️ Hit Points</span>
						<div class="charsheet__rest-recovery-values">
							<span class="charsheet__rest-recovery-old">${currentHp}</span>
							<span class="charsheet__rest-recovery-arrow">→</span>
							<span class="charsheet__rest-recovery-new">${maxHp}</span>
							<span class="ve-muted">(full)</span>
						</div>
					</li>
					<li class="charsheet__rest-recovery-item">
						<span class="charsheet__rest-recovery-label">🎲 Hit Dice</span>
						<div class="charsheet__rest-recovery-values">
							<span class="charsheet__rest-recovery-old">${totalCurrentHd}/${totalMaxHd}</span>
							<span class="charsheet__rest-recovery-arrow">→</span>
							<span class="charsheet__rest-recovery-new">${newHdTotal}/${totalMaxHd}</span>
						</div>
					</li>
					<li class="charsheet__rest-recovery-item">
						<span class="charsheet__rest-recovery-label">✨ Spell Slots</span>
						<div class="charsheet__rest-recovery-values">
							<span class="charsheet__rest-recovery-new">All recovered</span>
						</div>
					</li>
					<li class="charsheet__rest-recovery-item">
						<span class="charsheet__rest-recovery-label">⚡ Class Resources</span>
						<div class="charsheet__rest-recovery-values">
							<span class="charsheet__rest-recovery-new">All recovered</span>
						</div>
					</li>
					${rechargingItems.length ? `
					<li class="charsheet__rest-recovery-item">
						<span class="charsheet__rest-recovery-label">🔋 Item Recharges</span>
						<div class="charsheet__rest-recovery-values">
							<span class="charsheet__rest-recovery-new">${rechargingItems.map(it => `${it.name} (${it.formula})`).join(", ")}</span>
						</div>
					</li>
					` : ""}
					${currentExhaustion > 0 ? `
					<li class="charsheet__rest-recovery-item">
						<span class="charsheet__rest-recovery-label">😫 Exhaustion</span>
						<div class="charsheet__rest-recovery-values">
							<span class="charsheet__rest-recovery-old">${currentExhaustion}</span>
							<span class="charsheet__rest-recovery-arrow">→</span>
							<span class="charsheet__rest-recovery-new">${currentExhaustion - 1}</span>
						</div>
					</li>
					` : ""}
				</ul>
			</div>
			
			<div class="charsheet__rest-section">
				<div class="charsheet__rest-section-title">⚙️ Options</div>
				<div class="charsheet__rest-options">
					<label class="charsheet__rest-option">
						${cbResetTempHp}
						<span>Reset temporary HP to 0</span>
					</label>
					<label class="charsheet__rest-option ${currentExhaustion === 0 ? "charsheet__rest-option--disabled" : ""}">
						${cbClearExhaustion}
						<span>Reduce exhaustion by 1 level ${currentExhaustion === 0 ? "(none to reduce)" : ""}</span>
					</label>
				</div>
			</div>
			
			${conditions.length > 0 || isConcentrating ? `
			<div class="charsheet__rest-section">
				<div class="charsheet__rest-section-title">🛡️ Conditions & Effects</div>
				<div class="charsheet__rest-options" id="long-rest-conditions-container">
					<p class="ve-muted ve-small mb-2">Conditions to remove during rest (uncheck to keep):</p>
				</div>
			</div>
			` : ""}
		</div>`.appendTo(modalInner);

		// Render condition checkboxes
		if (conditions.length > 0 || isConcentrating) {
			const condContainer = e_({ele: modalInner}).find("#long-rest-conditions-container");

			// Concentration first
			if (isConcentrating) {
				ee`<label class="charsheet__rest-option">
					${cbBreakConcentration}
					<span>🔮 Break Concentration (${concentration?.spellName || "unknown spell"})</span>
				</label>`.appendTo(condContainer);
			}

			// Conditions (checked by default for long rest)
			conditions.forEach(condition => {
				const cb = e_({tag: "input", type: "checkbox"});
				cb.checked = true;
				conditionCheckboxes.push({condition, cb});
				cb.onChange(() => {
					if (cb.checked) conditionsToRemove.add(condition);
					else conditionsToRemove.delete(condition);
				});
				ee`<label class="charsheet__rest-option">
					${cb}
					<span>⚠️ Remove: ${condition}</span>
				</label>`.appendTo(condContainer);
			});
		}

		// Footer buttons
		const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel", click: () => doClose(false)});

		// --- Hunter's Prey swap control ---
		const huntersPreySwap = this._buildHuntersPreySwapSection();
		if (huntersPreySwap) {
			const hpTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (hpTarget?.parentNode) hpTarget.parentNode.insertBefore(huntersPreySwap.section, hpTarget);
			else modalInner.append(huntersPreySwap.section);
		}

		// --- Primal Focus mode selector (TGTT Ranger) ---
		const primalFocusSelect = this._buildPrimalFocusModeSection();
		if (primalFocusSelect) {
			const pfTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (pfTarget?.parentNode) pfTarget.parentNode.insertBefore(primalFocusSelect.section, pfTarget);
			else modalInner.append(primalFocusSelect.section);
		}

		const daemonologistSideSelect = this._buildDaemonologistSideSection();
		if (daemonologistSideSelect) {
			const dsTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (dsTarget?.parentNode) dsTarget.parentNode.insertBefore(daemonologistSideSelect.section, dsTarget);
			else modalInner.append(daemonologistSideSelect.section);
		}

		// --- Forked Tongue language swap (Illrigger) ---
		const forkedTongueSwap = this._buildForkedTongueLanguageSwapSection();
		if (forkedTongueSwap) {
			const ftTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (ftTarget?.parentNode) ftTarget.parentNode.insertBefore(forkedTongueSwap.section, ftTarget);
			else modalInner.append(forkedTongueSwap.section);
		}

		// --- Terrorizing Force damage-type re-choice (Illrigger L11) ---
		const terrorizingForceChoice = this._buildTerrorizingForceDamageTypeSection();
		if (terrorizingForceChoice) {
			const tfTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (tfTarget?.parentNode) tfTarget.parentNode.insertBefore(terrorizingForceChoice.section, tfTarget);
			else modalInner.append(terrorizingForceChoice.section);
		}

		const btnConfirm = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "🌙 Finish Long Rest"});
		btnConfirm.onClick(() => {
			// Snapshot the full pre-rest state so this rest can be undone (BUG 8).
			// Captured BEFORE any mutation below; transient and never persisted.
			this._captureRestSnapshot("long");

			// Full HP recovery
			this._state.setHp(maxHp, maxHp, cbResetTempHp.checked ? 0 : this._state.getHp().temp);

			// Recover half hit dice (minimum 1)
			hitDice.forEach(hd => {
				const recovery = Math.max(1, Math.floor(hd.max / 2));
				hd.current = Math.min(hd.max, hd.current + recovery);
			});
			this._state.setHitDice(hitDice);

			// Restore all spell slots
			for (let level = 1; level <= 9; level++) {
				const max = this._state.getSpellSlotsMax(level);
				if (max > 0) {
					this._state.setSpellSlots(level, max, max);
				}
			}

			// Restore Warlock pact slots on long rest as well
			const pactSlots = this._state.getPactSlots();
			if (pactSlots && pactSlots.max > 0) {
				this._state.setPactSlotsCurrent(pactSlots.max);
			}

			// Restore long-rest and short-rest resources
			this._restoreResources("long");

			// Clear one level of exhaustion using the dedicated exhaustion tracker
			if (cbClearExhaustion.checked) {
				const currentExhaustion = this._state.getExhaustion();
				if (currentExhaustion > 0) {
					this._state.setExhaustion(currentExhaustion - 1);
				}
			}

			// Remove selected conditions
			conditionsToRemove.forEach(condition => {
				this._state.removeCondition?.(condition);
			});

			// Break concentration if requested
			if (cbBreakConcentration?.checked) {
				this._state.breakConcentration?.();
			}

			// Reset death saves
			this._state.setDeathSaves({successes: 0, failures: 0});

			// Clear transient Druid Wild Shape forms and Wild-Companion familiars.
			// Wild Shape uses recharge on a rest, so any assumed beast form reverts
			// and a Wild-Companion-summoned familiar (which cost a Wild Shape use)
			// disappears — re-summoning after the rest costs a fresh use. Regular
			// Find Familiar / Pact of the Chain familiars are NOT removed (only the
			// Wild-Companion-origin ones), and other companion types are untouched.
			const removedCompanions = this._removeWildShapeCompanionsOnLongRest();

			// Reset Gambler prepared spell roll (TGTT Rogue subclass)
			const calcs = this._state.getFeatureCalculations();
			if (calcs.hasGamblerSpellcasting) {
				// Reset the rolled prepared count - requires new roll after rest
				this._state.resetGamblerPreparedRoll(false); // Keep current prepared spells as options
			}

			// Reset Gambler daily resources (Extra Luck, Master of Fortune uses)
			if (calcs.hasGamblerFolly) {
				this._state.resetGamblerDailyResources();
			}

			// Apply Hunter's Prey option swap, if changed
			huntersPreySwap?.apply();

			// Apply Primal Focus mode selection, if changed (free on a long rest)
			const primalFocusChanged = primalFocusSelect?.apply() || false;
			const daemonologistSideChanged = daemonologistSideSelect?.apply() || false;

			// Forked Tongue: a new long rest re-enables the once-per-rest swap, then we
			// apply any language swap the player chose in this dialog.
			this._state.resetForkedTongueSwap?.();
			const forkedTongueChanged = forkedTongueSwap?.apply() || false;

			// Apply Terrorizing Force damage-type re-choice (free on a long rest)
			const terrorizingForceChanged = terrorizingForceChoice?.apply() || false;

			// Save changes
			this._page.saveCharacter();
			this._page.renderCharacter();

			doClose(true);

			let message = "🌙 Long rest complete! All resources restored.";
			if (primalFocusChanged) message += ` Primal Focus set to ${primalFocusChanged}.`;
			if (daemonologistSideChanged) message += ` Fair and Foul set to ${daemonologistSideChanged}.`;
			if (forkedTongueChanged) message += ` Forked Tongue: swapped ${forkedTongueChanged}.`;
			if (terrorizingForceChanged) message += ` Terrorizing Force damage set to ${terrorizingForceChanged}.`;
			if (conditionsToRemove.size > 0) message += ` Removed ${conditionsToRemove.size} condition(s).`;
			if (cbBreakConcentration?.checked) message += ` Broke concentration.`;
			if (removedCompanions > 0) message += ` Wild Shape form/companion dismissed.`;

			JqueryUtil.doToast({
				type: "success",
				content: message,
			});

			// Offer a persistent undo for this rest (BUG 8).
			this._showUndoRestAffordance("long");

			// Auto-popup Gambler prepared roll modal after long rest
			if (calcs.hasGamblerSpellcasting) {
				this._showGamblerPreparedRollModal();
			}

			// Auto-popup scribing memorization after long rest (Spell Scribing Adept)
			if (calcs.hasSpellScribingAdept && calcs.scribingSpellbookCount > 0) {
				this._showScribingMemorizeModal();
			}
		});

		ee`<div class="charsheet__modal-footer">
			${btnCancel}
			${btnConfirm}
		</div>`.appendTo(modalInner);
	}

	/**
	 * Remove transient Druid Wild Shape companions on a long rest.
	 *
	 * Clears:
	 *  - every WILD_SHAPE companion (an assumed beast form reverts on a rest), and
	 *  - every FAMILIAR companion summoned via Wild Companion (origin begins with
	 *    "Wild Companion") — that familiar cost a Wild Shape use, which recharges
	 *    on the rest, so re-summoning afterwards costs a fresh use.
	 *
	 * Regular Find Familiar / Pact of the Chain familiars (and all other companion
	 * types) are intentionally LEFT in place. Also deactivates the lingering
	 * `wildShape` active state, if any.
	 *
	 * @returns {number} How many companions were removed.
	 * @private
	 */
	_removeWildShapeCompanionsOnLongRest () {
		const T = CharacterSheetState.COMPANION_TYPES || {};
		const companions = this._state.getCompanions?.() || [];
		let removed = 0;
		for (const c of companions) {
			const isWildShapeForm = c.type === T.WILD_SHAPE;
			const isWildCompanionFamiliar = c.type === T.FAMILIAR && /^wild companion\b/i.test(c.origin || "");
			if (isWildShapeForm || isWildCompanionFamiliar) {
				if (this._state.removeCompanion?.(c.id)) removed++;
			}
		}
		// Drop any lingering Wild Shape active state so derived stats reset too.
		if (this._state.isStateTypeActive?.("wildShape")) {
			this._state.deactivateState?.("wildShape");
		}
		return removed;
	}

	/**
	 * Build a Hunter's Prey swap control for the rest dialogs.
	 * Returns null when the character lacks Hunter's Prey.
	 * @returns {{section: HTMLElement, apply: function}|null}
	 */
	_buildHuntersPreySwapSection () {
		if (!this._state.hasHuntersPrey?.()) return null;

		const options = this._state.getHuntersPreyOptions?.() || [];
		if (options.length < 2) return null;
		const currentOption = this._state.getHuntersPreyOption?.() || "colossus";

		const sel = e_({tag: "select", clazz: "form-control input-sm charsheet__hunters-prey-rest-select"});
		options.forEach(o => {
			const opt = e_({tag: "option", val: o.id, txt: o.name});
			if (o.id === currentOption) opt.selected = true;
			sel.appendChild(opt);
		});

		const section = e_({outer: `<div class="charsheet__rest-section">
			<div class="charsheet__rest-section-title">🏹 Hunter's Prey</div>
			<p class="ve-muted ve-small mb-2">Choose your Hunter's Prey option for the next stretch (you may swap on a rest):</p>
		</div>`});
		section.appendChild(sel);

		return {
			section,
			apply: () => {
				const chosen = sel.value;
				if (chosen && chosen !== currentOption) {
					this._state.setHuntersPreyOption?.(chosen);
				}
			},
		};
	}

	/**
	 * Build a Primal Focus mode selector for the long-rest dialog (TGTT Ranger).
	 * Choosing a mode on a long rest is free (does not consume a Focus Switch).
	 * Returns null when the character lacks Primal Focus.
	 * @returns {{section: HTMLElement, apply: function}|null}
	 */
	_buildPrimalFocusModeSection () {
		if (!this._state.hasPrimalFocus?.()) return null;

		const currentMode = this._state.getPrimalFocusMode?.() || "predator";
		const modes = [
			{id: "predator", name: "🎯 Predator"},
			{id: "prey", name: "🛡️ Prey"},
		];

		const sel = e_({tag: "select", clazz: "form-control input-sm charsheet__primal-focus-rest-select"});
		modes.forEach(m => {
			const opt = e_({tag: "option", val: m.id, txt: m.name});
			if (m.id === currentMode) opt.selected = true;
			sel.appendChild(opt);
		});

		const section = e_({outer: `<div class="charsheet__rest-section">
			<div class="charsheet__rest-section-title">🐺 Primal Focus</div>
			<p class="ve-muted ve-small mb-2">Choose your Primal Focus mode (free on a long rest — no Focus Switch spent):</p>
		</div>`});
		section.appendChild(sel);

		return {
			section,
			// Returns the new mode's label when changed, else false.
			apply: () => {
				const chosen = sel.value;
				if (chosen && chosen !== currentMode) {
					this._state.setPrimalFocusMode?.(chosen);
					return chosen === "predator" ? "Predator" : "Prey";
				}
				return false;
			},
		};
	}

	_buildDaemonologistSideSection () {
		const currentSide = this._state.getDaemonologistSide?.();
		if (!currentSide) return null;
		const options = [
			{key: "arch daemon", name: "Arch Daemon"},
			{key: "arch seraph", name: "Arch Seraph"},
		];
		const sel = e_({tag: "select", clazz: "form-control input-sm charsheet__daemonologist-side-rest-select"});
		for (const side of options) {
			const opt = e_({tag: "option", val: side.key, txt: side.name});
			if (side.key === currentSide.key) opt.selected = true;
			sel.appendChild(opt);
		}
		const section = e_({outer: `<div class="charsheet__rest-section">
			<div class="charsheet__rest-section-title">🪽 Fair and Foul</div>
			<p class="ve-muted ve-small mb-2">Choose whether to siphon power from Arch Daemons or Arch Seraphs after this long rest:</p>
		</div>`});
		section.appendChild(sel);
		return {
			section,
			apply: () => {
				if (sel.value === currentSide.key) return false;
				const chosen = options.find(side => side.key === sel.value);
				if (!chosen || !this._state.setDaemonologistSide?.(chosen.name)) return false;
				return chosen.name;
			},
		};
	}

	/**
	 * Build a Terrorizing Force damage-type selector for the long-rest dialog (Illrigger L11).
	 * The chosen element (cold/fire/necrotic/poison) for the +1d8 weapon-hit rider is
	 * changeable on a long rest. Returns null when the character lacks Terrorizing Force.
	 * @returns {{section: HTMLElement, apply: function}|null}
	 */
	_buildTerrorizingForceDamageTypeSection () {
		if (!this._state.getFeatureCalculations?.()?.hasTerrorizingForce) return null;

		const currentType = this._state.getTerrorizingForceDamageType?.() || "fire";
		const types = this._state.constructor?.TERRORIZING_FORCE_DAMAGE_TYPES
			|| ["cold", "fire", "necrotic", "poison"];

		const sel = e_({tag: "select", clazz: "form-control input-sm charsheet__terrorizing-force-rest-select"});
		types.forEach(t => {
			const label = t.charAt(0).toUpperCase() + t.slice(1);
			const opt = e_({tag: "option", val: t, txt: label});
			if (t === currentType) opt.selected = true;
			sel.appendChild(opt);
		});

		const section = e_({outer: `<div class="charsheet__rest-section">
			<div class="charsheet__rest-section-title">🔥 Terrorizing Force</div>
			<p class="ve-muted ve-small mb-2">Choose the damage type for your Terrorizing Force weapon rider (free on a long rest):</p>
		</div>`});
		section.appendChild(sel);

		return {
			section,
			// Returns the new type's label when changed, else false.
			apply: () => {
				const chosen = sel.value;
				if (chosen && chosen !== currentType) {
					const stored = this._state.setTerrorizingForceDamageType?.(chosen);
					if (stored === chosen) return chosen.charAt(0).toUpperCase() + chosen.slice(1);
				}
				return false;
			},
		};
	}

	// Canonical TGTT (Traveler's Guide to Thelemar) language set, used as a fallback when the
	// homebrew language data isn't loaded. Kept in sync with homebrew/TravelersGuidetoThelemar.json.
	static _TGTT_LANGUAGES_FALLBACK = [
		"Common", "Lexalian", "Olympian", "Jaknian", "Clairnian", "Hubian", "Old Common", "Stygian",
		"Mictlanian", "Jotunn", "Skyspeak", "Gob", "Trunkodon", "Felis", "Minotaur", "Draconic",
		"Sylvan", "Primordial", "Celestial",
	];

	/**
	 * Compute the candidate replacement languages for a Forked Tongue swap. Sources the TGTT
	 * language set from loaded homebrew data (`page._languagesData`, source "TGTT") so it stays in
	 * sync, falling back to the hardcoded canonical list when the data isn't available. Excludes any
	 * language the character already knows.
	 * @returns {string[]}
	 */
	_getForkedTongueReplacementCandidates () {
		const langData = this._page?._languagesData || [];
		let tgttLangs = langData
			.filter(l => l && l.source === "TGTT" && l.name)
			.map(l => l.name);
		if (!tgttLangs.length) tgttLangs = [...CharacterSheetRest._TGTT_LANGUAGES_FALLBACK];

		// De-duplicate (preserving order) and drop anything already known.
		const known = new Set((this._state.getLanguages?.() || []).map(l => l.toLowerCase()));
		const seen = new Set();
		const out = [];
		for (const lang of tgttLangs) {
			const key = lang.toLowerCase();
			if (seen.has(key) || known.has(key)) continue;
			seen.add(key);
			out.push(lang);
		}
		return out;
	}

	/**
	 * Build a Forked Tongue language-swap control for the long-rest dialog (Illrigger).
	 * On a long rest the character may replace ONE of their swappable spoken languages
	 * with another (once per long rest). Returns null when the character lacks Forked
	 * Tongue or has not yet chosen any swappable languages.
	 * @returns {{section: HTMLElement, apply: function}|null}
	 */
	_buildForkedTongueLanguageSwapSection () {
		const calc = this._state.getFeatureCalculations?.() || {};
		if (!calc.hasForkedTongue) return null;

		const swappable = this._state.getForkedTongueSwappableLanguages?.() || [];
		if (!swappable.length) return null;

		// Candidate replacement languages: the TGTT set minus anything already known.
		const replacements = this._getForkedTongueReplacementCandidates();

		const cbEnable = e_({tag: "input", attrs: {type: "checkbox"}});
		cbEnable.checked = false;

		const selOld = e_({tag: "select", clazz: "form-control input-sm charsheet__forked-tongue-old-select"});
		swappable.forEach(lang => {
			const opt = e_({tag: "option", val: lang, txt: lang});
			selOld.appendChild(opt);
		});

		const selNew = e_({tag: "select", clazz: "form-control input-sm charsheet__forked-tongue-new-select"});
		replacements.forEach(lang => {
			const opt = e_({tag: "option", val: lang, txt: lang});
			selNew.appendChild(opt);
		});

		const section = e_({outer: `<div class="charsheet__rest-section">
			<div class="charsheet__rest-section-title">👅 Forked Tongue</div>
			<p class="ve-muted ve-small mb-2">You may replace one of your swappable spoken languages with another (once per long rest):</p>
		</div>`});
		const enableLabel = e_({tag: "label", clazz: "charsheet__rest-option"});
		enableLabel.appendChild(cbEnable);
		enableLabel.appendChild(e_({tag: "span", txt: " Swap a spoken language"}));
		section.appendChild(enableLabel);
		const swapRow = e_({tag: "div", clazz: "ve-flex-v-center", attrs: {style: "gap: 6px; margin-top: 4px;"}});
		swapRow.appendChild(selOld);
		swapRow.appendChild(e_({tag: "span", txt: "→"}));
		swapRow.appendChild(selNew);
		section.appendChild(swapRow);

		return {
			section,
			// Returns the "old → new" label when a swap happened, else false.
			apply: () => {
				if (!cbEnable.checked) return false;
				const oldLang = selOld.value;
				const newLang = selNew.value;
				if (!oldLang || !newLang || oldLang.toLowerCase() === newLang.toLowerCase()) return false;
				if (this._state.swapForkedTongueLanguage?.(oldLang, newLang)) {
					return `${oldLang} → ${newLang}`;
				}
				return false;
			},
		};
	}

	/**
	 * Open the standalone Forked Tongue language-swap modal (Illrigger).
	 *
	 * STABLE PUBLIC ENTRY POINT — reachable as `page._rest.openForkedTongueLanguageSwapModal()`.
	 * The Foundation session (F) routes the "Use Forked Tongue" ability click here. Do not rename
	 * without coordinating with F.
	 *
	 * On a long rest the once-per-rest swap gate is cleared, but the swap itself can be performed at
	 * any time via this modal (it still enforces once-per-long-rest through
	 * `state.swapForkedTongueLanguage`). The replacement candidates are TGTT languages only,
	 * excluding ones the character already knows.
	 * @returns {Promise<void>}
	 */
	async openForkedTongueLanguageSwapModal () {
		const calc = this._state.getFeatureCalculations?.() || {};
		if (!calc.hasForkedTongue) {
			JqueryUtil.doToast({type: "warning", content: "This character doesn't have Forked Tongue."});
			return;
		}

		const swappable = this._state.getForkedTongueSwappableLanguages?.() || [];
		if (!swappable.length) {
			JqueryUtil.doToast({type: "warning", content: "Forked Tongue: no swappable spoken languages to swap yet."});
			return;
		}

		if (this._state.hasSwappedForkedTongueSinceLongRest?.()) {
			JqueryUtil.doToast({type: "warning", content: "Forked Tongue: you've already swapped a language since your last long rest."});
			return;
		}

		const replacements = this._getForkedTongueReplacementCandidates();
		if (!replacements.length) {
			JqueryUtil.doToast({type: "warning", content: "Forked Tongue: no available TGTT languages left to swap into."});
			return;
		}

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "👅 Forked Tongue — Swap Language",
			isMinHeight0: true,
			isWidth100: true,
		});

		const selOld = e_({tag: "select", clazz: "form-control input-sm charsheet__forked-tongue-old-select"});
		swappable.forEach(lang => selOld.appendChild(e_({tag: "option", val: lang, txt: lang})));

		const selNew = e_({tag: "select", clazz: "form-control input-sm charsheet__forked-tongue-new-select"});
		replacements.forEach(lang => selNew.appendChild(e_({tag: "option", val: lang, txt: lang})));

		const body = e_({outer: `<div class="charsheet__rest-modal">
			<div class="charsheet__rest-section">
				<p class="ve-muted ve-small mb-2">Replace one of your swappable spoken languages with a Traveler's Guide to Thelemar language (once per long rest):</p>
			</div>
		</div>`});
		const swapRow = e_({tag: "div", clazz: "ve-flex-v-center", attrs: {style: "gap: 6px; margin: 4px 0;"}});
		swapRow.appendChild(selOld);
		swapRow.appendChild(e_({tag: "span", txt: "→"}));
		swapRow.appendChild(selNew);
		body.querySelector(".charsheet__rest-section").appendChild(swapRow);

		const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel", click: () => doClose(false)});
		const btnConfirm = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Swap Language"});
		btnConfirm.onClick(() => {
			const oldLang = selOld.value;
			const newLang = selNew.value;
			if (!oldLang || !newLang || oldLang.toLowerCase() === newLang.toLowerCase()) {
				JqueryUtil.doToast({type: "warning", content: "Choose two different languages to swap."});
				return;
			}
			if (this._state.swapForkedTongueLanguage?.(oldLang, newLang)) {
				this._page.saveCharacter();
				this._page.renderCharacter();
				doClose(true);
				JqueryUtil.doToast({type: "success", content: `Forked Tongue: swapped ${oldLang} → ${newLang}.`});
			} else {
				JqueryUtil.doToast({type: "warning", content: "Forked Tongue: unable to swap that language."});
			}
		});

		const footer = e_({tag: "div", clazz: "ve-flex-v-center ve-flex-h-right", attrs: {style: "gap: 8px; margin-top: 12px;"}});
		footer.appendChild(btnCancel);
		footer.appendChild(btnConfirm);
		body.appendChild(footer);

		modalInner.appendChild(body);
	}

	/**
	 * Build a Tireless exhaustion-reduction control for the short-rest dialog.
	 * TGTT Ranger Tireless reduces exhaustion by 1 on every short rest.
	 * Returns null when the character lacks Tireless or has no exhaustion.
	 * @returns {{section: HTMLElement, apply: function}|null}
	 */
	_buildTirelessExhaustionSection () {
		const calc = this._state.getFeatureCalculations?.() || {};
		if (!calc.hasTireless) return null;
		const currentExhaustion = this._state.getExhaustion?.() || 0;
		if (currentExhaustion <= 0) return null;

		const cb = e_({tag: "input", attrs: {type: "checkbox", checked: ""}});
		cb.checked = true;
		const section = e_({outer: `<div class="charsheet__rest-section">
			<div class="charsheet__rest-section-title">💪 Tireless</div>
			<p class="ve-muted ve-small mb-2">Finishing a short rest reduces your exhaustion by 1 (currently ${currentExhaustion}).</p>
		</div>`});
		const label = e_({tag: "label", clazz: "ve-flex-v-center", attrs: {style: "gap: 6px; cursor: pointer;"}});
		label.appendChild(cb);
		label.appendChild(e_({tag: "span", txt: "Reduce exhaustion by 1"}));
		section.appendChild(label);

		return {
			section,
			apply: () => {
				if (!cb.checked) return 0;
				const cur = this._state.getExhaustion?.() || 0;
				if (cur <= 0) return 0;
				this._state.setExhaustion(cur - 1);
				return 1;
			},
		};
	}

	_restoreResources (restType) {
		// Restore class resources
		const resources = this._state.getResources();
		resources.forEach(resource => {
			if (restType === "long" || resource.recharge === "short") {
				// Use state method to persist the change
				this._state.setResourceCurrent(resource.id, resource.max);
			}
		});

		// Also restore feature uses
		const features = this._state.getFeatures();
		features.forEach(feature => {
			if (feature.uses) {
				if (restType === "long" || feature.uses.recharge === "short") {
					// Use state method to persist the change
					this._state.setFeatureUses(feature.id, feature.uses.max);
				}
			}
		});

		// Restore stamina (Combat Methods system) - recovers on both short and long rests
		if (this._state.usesCombatSystem?.()) {
			this._state.restoreStamina?.();
		}

		// Restore Primal Focus (TGTT Ranger) - only on long rest
		if (restType === "long" && this._state.hasPrimalFocus?.()) {
			this._state.restorePrimalFocus?.();
		}

		// Restore Arcane Shot (Arcane Archer) - recharges on short OR long rest
		if (this._state.hasArcaneShot?.()) {
			this._state.restoreArcaneShot?.();
		}

		// Restore Illrigger Seals (Baleful Interdict) - the seal pool refreshes on a
		// SHORT or LONG rest, so it is restored unconditionally here (placements always
		// clear too, since seals last only 1 minute and never survive a rest).
		if (this._state.hasBalefulInterdict?.()) {
			this._state.restoreSeals?.();
		}

		// Reset Superior Interdict's bonus-action seal regain (Illrigger L14) — once per
		// LONG rest only.
		if (restType === "long" && this._state.hasSuperiorInterdict?.()) {
			this._state.resetSuperiorInterdict?.();
		}

		// Restore Illrigger Infernal Conduit dice (Baleful Interdict) - the d10 pool
		// recovers on a LONG rest only.
		if (restType === "long" && this._state.hasInfernalConduit?.()) {
			this._state.restoreInfernalConduit?.();
		}

		// Restore Fighter Second Wind / Action Surge - recharge on short OR long rest.
		// Explicit (in addition to the generic feature-uses loop above) so the per-rest max
		// is re-scaled to the current Fighter level before refilling.
		if (this._state.hasFighterFeatures?.()) {
			this._state.restoreSecondWind?.();
			this._state.restoreActionSurge?.();
		}

		// Restore Fighter Indomitable - recharges on a LONG rest only.
		if (restType === "long" && this._state.hasIndomitable?.()) {
			this._state.restoreIndomitable?.();
		}

		// Restore Focus Pool (TGTT Dreamwalker) - only on long rest
		if (restType === "long" && this._state.hasFocusPool?.()) {
			this._state.restoreFocusPool?.();
		}

		// Restore item charges — routes through the canonical state operation so the
		// parse/roll/clamp behavior matches the inventory-row Recharge button. Roll-based
		// recharges are rolled once here and logged to roll history. Runs inside the
		// existing rest undo snapshot, so these changes are covered by rest undo.
		const items = this._state.getItems();
		const restoredItems = [];
		items.forEach(item => {
			if (!CharacterSheetState.itemRechargesOnRest(item, restType)) return;
			if ((item.chargesCurrent ?? item.charges) >= item.charges) return;
			try {
				const result = this._state.rechargeItemCharges(item.id);
				if (result?.committed) {
					restoredItems.push({name: item.name, restored: result.restored, total: result.newCharges, max: item.charges});
					this._page?._rollHistory?.addRoll({
						title: `Recharge: ${item.name}`,
						total: result.restored,
						breakdown: result.breakdown,
					});
				}
			} catch (e) {
				// A single malformed item must not abort the rest.
				// eslint-disable-next-line no-console
				console.warn(`[CharSheet Rest] Failed to recharge item "${item.name}":`, e);
			}
		});

		// Show toast for restored item charges
		if (restoredItems.length > 0) {
			const itemList = restoredItems.map(i => `${i.name}: +${i.restored} (${i.total}/${i.max})`).join(", ");
			JqueryUtil.doToast({
				type: "info",
				content: `Item charges restored: ${itemList}`,
			});
		}

		// Recharge socketed gemstones on long rest (dawn recharge)
		if (restType === "long") {
			this._state.rechargeAllGemstones();
		}
	}

	/**
	 * Show a modal after long rest prompting the Gambler to roll for prepared spell count.
	 */
	async _showGamblerPreparedRollModal () {
		const calcs = this._state.getFeatureCalculations();
		if (!calcs.hasGamblerSpellcasting) return;

		const dice = calcs.gamblerSpellsPreparedDice || "2d4";

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "\u{1F3B2} Gambler: Roll for Prepared Spells",
			isMinHeight0: true,
		});

		const resultArea = e_({tag: "div", clazz: "ve-text-center", style: "min-height: 40px;"});

		const btnRoll = e_({outer: `<button class="btn btn-sm btn-warning" style="font-weight: 600;">\u{1F3B2} Roll ${dice}</button>`});
		const btnClose = e_({outer: `<button class="btn btn-sm btn-default mt-2" style="display: none;">OK</button>`});

		ee`<div class="ve-text-center">
			<p class="mb-2 ve-muted ve-small">Dice: <strong>${dice}</strong></p>
			${btnRoll}
			${resultArea}
			${btnClose}
		</div>`.appendTo(modalInner);

		btnRoll.addEventListener("click", () => {
			const rollDetails = this._state.rollGamblerPreparedSpells();
			if (!rollDetails) return;

			btnRoll.style.display = "none";
			resultArea.innerHTML = "";

			const rollsStr = rollDetails.rolls.join(" + ");
			ee`<div class="ve-text-center mt-2">
				<p class="mb-0 ve-muted ve-small">${rollDetails.dice}: (${rollsStr})</p>
				<p class="mb-0" style="font-size: 1.8rem; font-weight: bold; color: #f59e0b;">${rollDetails.total}</p>
				<p class="ve-muted ve-small mb-0">spells prepared for today</p>
			</div>`.appendTo(resultArea);

			btnClose.style.display = "";

			this._page.saveCharacter();
			this._page.renderCharacter();
		});

		btnClose.addEventListener("click", () => doClose(true));
	}

	/**
	 * Show modal to memorize a spell from the scribing spellbook after a long rest.
	 * "You can memorize one spell from your spellbook after you finish a long rest,
	 *  by spending 10 minutes studying your spellbook."
	 */
	async _showScribingMemorizeModal () {
		const spellbook = this._state.getScribingSpellbook();
		if (!spellbook.length) return;

		const currentMemo = this._state.getScribingMemorizedSpell();
		const maxLevel = this._state.getScribingMaxSpellLevel();

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "📖 Scribing Spellbook — Memorize Spell",
			isMinHeight0: true,
		});

		modalInner.insertAdjacentHTML("beforeend", `
			<p class="mb-2 ve-small">After finishing your long rest, you spend 10 minutes studying your spellbook. Choose one spell to memorize (cast with Charisma using your spell slots).</p>
			${currentMemo ? `<p class="ve-small ve-muted mb-2">Currently memorized: <strong>${currentMemo.name}</strong></p>` : ""}
		`);

		const list = e_({outer: `<div style="max-height: 300px; overflow-y: auto;"></div>`});
		let selectedId = currentMemo?.id || null;

		const renderList = () => {
			list.innerHTML = "";
			spellbook.forEach(spell => {
				const tooHigh = spell.level > maxLevel;
				const isSelected = spell.id === selectedId;
				const school = Parser.spSchoolAbvToFull?.(spell.school) || spell.school || "";
				const item = e_({outer: `
					<div class="ve-flex-v-center p-2 clickable ${isSelected ? "list-multi-selected" : ""} ${tooHigh ? "ve-muted" : ""}" style="border-bottom: 1px solid var(--cs-border);">
						<div class="ve-flex-col ve-flex-1">
							<div>${spell.name} ${isSelected ? "⭐" : ""}</div>
							<div class="ve-small ve-muted">Level ${spell.level} ${school}</div>
						</div>
						${tooHigh ? `<span class="ve-small ve-muted">Level too high</span>` : ""}
					</div>
				`});
				if (!tooHigh) {
					item.addEventListener("click", () => {
						selectedId = isSelected ? null : spell.id;
						renderList();
					});
				}
				list.append(item);
			});
		};
		renderList();
		modalInner.append(list);

		const footer = e_({outer: `<div class="ve-flex-v-center ve-flex-h-right mt-3 gap-2"></div>`});
		const btnSkip = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Skip"});
		btnSkip.addEventListener("click", () => doClose(false));
		const btnConfirm = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "📖 Memorize"});
		btnConfirm.addEventListener("click", () => {
			if (selectedId) {
				this._state.setScribingMemorizedSpell(selectedId);
			} else {
				this._state.clearScribingMemorizedSpell();
			}
			this._page.saveCharacter();
			this._page.renderCharacter();
			doClose(true);
			const memoSpell = spellbook.find(s => s.id === selectedId);
			JqueryUtil.doToast({
				type: "success",
				content: memoSpell ? `📖 Memorized: ${memoSpell.name}` : "📖 Cleared memorized spell",
			});
		});
		footer.append(btnSkip, btnConfirm);
		modalInner.append(footer);
	}

	// ==========================================================================
	// Undo Rest (BUG 8)
	//
	// Players sometimes trigger a short or long rest by accident. A rest mutates
	// ~15 (short) / ~26 (long) pieces of state, so an inverse-ops undo would be
	// fragile. Instead we take a full snapshot of the character state (a complete
	// `MiscUtil.copyFast` of `_data` via `toJson()`) BEFORE the rest is applied,
	// stash it transiently on the page (session-only, NEVER persisted to the saved
	// character), and restore it verbatim via `loadFromJson()` when the player
	// clicks the "Undo last rest" affordance. Only one level of undo is retained.
	// ==========================================================================

	/**
	 * Capture a full pre-rest state snapshot so the most recent short/long rest can
	 * be reverted. Stored transiently on the page (`page._lastRestSnapshot`) — it is
	 * session-only and is never written to the saved character. Overwrites any prior
	 * snapshot, so only the most recent rest can be undone.
	 * @param {"short"|"long"} restType
	 * @returns {?object} the stored snapshot, or null on failure
	 */
	_captureRestSnapshot (restType) {
		try {
			const snapshot = {
				restType,
				json: this._state.toJson(),
				ts: Date.now(),
			};
			if (this._page) this._page._lastRestSnapshot = snapshot;
			return snapshot;
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[CharSheet Rest] Failed to capture rest snapshot:", e);
			if (this._page) this._page._lastRestSnapshot = null;
			return null;
		}
	}

	/**
	 * Whether an undoable rest snapshot is currently available.
	 * @returns {boolean}
	 */
	hasRestUndoAvailable () {
		return !!this._page?._lastRestSnapshot;
	}

	/**
	 * Restore the character to the state captured before the most recent rest.
	 * Clears the snapshot and the affordance afterwards (single-level undo), then
	 * re-saves and re-renders. Safe to call when no snapshot exists (no-op).
	 * @returns {boolean} true if a rest was undone, false if there was nothing to undo
	 */
	_onUndoRest () {
		const snapshot = this._page?._lastRestSnapshot;
		if (!snapshot) return false;

		try {
			this._state.loadFromJson(snapshot.json);
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[CharSheet Rest] Failed to restore rest snapshot:", e);
			return false;
		}

		// One level of undo only — drop the snapshot and remove the affordance.
		this._page._lastRestSnapshot = null;
		this._removeUndoRestAffordance();

		this._page.saveCharacter?.();
		this._page.renderCharacter?.();

		const label = snapshot.restType === "long" ? "Long rest" : "Short rest";
		JqueryUtil.doToast({
			type: "info",
			content: `↩️ ${label} undone — your previous state has been restored.`,
		});
		return true;
	}

	/**
	 * Show the persistent "Undo last rest" affordance in the Quick Actions grid.
	 * The grid is static HTML that is never rebuilt by any render pass, so the
	 * injected button survives re-renders and stays until the next rest replaces it
	 * or the player clicks it. DOM-guarded so it is a no-op in the node test env.
	 * @param {"short"|"long"} restType
	 */
	_showUndoRestAffordance (restType) {
		if (typeof document === "undefined") return;

		this._removeUndoRestAffordance();

		const grid = document.querySelector?.(".charsheet__quick-actions-grid");
		if (!grid) return;

		const label = restType === "long" ? "Long Rest" : "Short Rest";
		const btn = e_({
			tag: "button",
			id: CharacterSheetRest._UNDO_REST_BTN_ID,
			clazz: "charsheet__quick-action charsheet__quick-action--undo-rest",
			title: `Undo the ${label.toLowerCase()} you just finished and restore your previous state`,
			html: `<span class="charsheet__quick-action-icon">↩️</span><span class="charsheet__quick-action-text">Undo ${label}</span>`,
			click: () => this._onUndoRest(),
		});
		grid.appendChild(btn);
	}

	/**
	 * Remove the "Undo last rest" affordance if present. DOM-guarded for node env.
	 */
	_removeUndoRestAffordance () {
		if (typeof document === "undefined") return;
		document.getElementById?.(CharacterSheetRest._UNDO_REST_BTN_ID)?.remove();
	}
}

globalThis.CharacterSheetRest = CharacterSheetRest;

export {CharacterSheetRest};
