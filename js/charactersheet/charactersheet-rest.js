/**
 * Character Sheet Rest Handler
 * Manages short rest, long rest, and recovery mechanics
 */

import {CharacterSheetModal} from "./charactersheet-modal.js";
import {CharacterSheetClassUtils} from "./charactersheet-class-utils.js";
import {CharacterSheetProgression} from "./charactersheet-progression.js";

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_, ee} = /** @type {*} */ (globalThis);

class CharacterSheetRest {
	static _UNDO_REST_BTN_ID = "charsheet-btn-undo-rest";
	static _EFA_ARMOR_MODEL_NAMES = ["Dreadnaught", "Guardian", "Infiltrator"];
	static _EFA_ARMOR_MODEL_PREVIEWS = {
		Dreadnaught: "Force Demolisher (melee, Reach); Giant Stature",
		Guardian: "Thunder Pulse (melee); Defensive Field while Bloodied",
		Infiltrator: "Lightning Launcher (90/300); +5 Speed and Stealth Advantage",
	};

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

	_advanceCommittedRestTime (restType, identity) {
		const receipt = this._state.advanceRestTime?.(restType, {identity});
		if (receipt?.ok) return receipt;
		if (this._page) this._page._lastRestSnapshot = null;
		JqueryUtil.doToast({
			type: "danger",
			content: `Could not finish the ${restType} rest: ${receipt?.message || receipt?.code || "time advancement failed"}.`,
		});
		return receipt || {ok: false, code: "rest-time-advance-unavailable"};
	}

	async _showShortRestDialog () {
		const currentHp = this._state.getHp().current;
		const maxHp = this._state.getHp().max;
		const hitDice = this._state.getHitDice();
		const availableHitDice = hitDice.filter(hd => hd.current > 0);
		const companionHitDieTargets = (this._state.getCompanions?.() || []).filter(companion =>
			companion.featureGrant?.uid
			&& companion.hitDice?.current > 0
			&& companion.hp?.current > 0
			&& companion.hp.current < companion.hp.max,
		);
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
		const canRetuneEfaArmorModel = !!this._state.getEfaArmorerModel?.();
		const activeEfaCannons = this._state.listEfaEldritchCannons?.() || [];

		if (currentHp >= maxHp
			&& !availableHitDice.length
			&& !companionHitDieTargets.length
			&& !conditions.length
			&& !isConcentrating
			&& !canReduceExhaustion
			&& !canMemorizeSpell
			&& !canRetuneEfaArmorModel
			&& !activeEfaCannons.length) {
			JqueryUtil.doToast({type: "info", content: "You're already at full health with no hit dice to spend."});
			return;
		}

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "😴 Short Rest",
			isMinHeight0: true,
			isWidth100: true,
		});

		let totalHealing = 0;
		// Track spent dice by type
		const spentDice = {};
		const pendingCompanionHitDice = [];

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

			${companionHitDieTargets.length ? `
			<div class="charsheet__rest-section">
				<div class="charsheet__rest-section-title">🤖 Companion Hit Dice</div>
				<p class="ve-muted ve-small mb-2">These d8s heal only their companion and never spend your Hit Dice.</p>
				<div id="short-rest-companion-hit-dice-container"></div>
			</div>
			` : ""}
			
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
					<span>🔮 Break Concentration (${this._state.getConcentrationLabel?.() || concentration?.spellName || "unknown spell"})</span>
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

		if (companionHitDieTargets.length) {
			const companionHdContainer = e_({ele: modalInner}).find("#short-rest-companion-hit-dice-container");
			companionHitDieTargets.forEach(companion => {
				let remaining = companion.hitDice.current;
				let projectedHp = companion.hp.current;
				const dieSides = Number(String(companion.hitDice.die || "d8").replace(/^d/i, "")) || 8;
				const constitutionModifier = this._state.getCompanionAbilityMod(companion.id, "con");
				const eleRemaining = e_({tag: "span", txt: `${remaining}`});
				const eleProjectedHp = e_({tag: "span", txt: `${projectedHp}/${companion.hp.max} HP`});
				const btn = e_({tag: "button", clazz: "ve-btn ve-btn-sm ve-btn-primary", txt: `🎲 Roll ${companion.hitDice.die || "d8"}`});

				btn.onClick(() => {
					if (remaining <= 0 || projectedHp >= companion.hp.max) return;
					const roll = this._page.rollDice(1, dieSides);
					const requested = Math.max(1, roll + constitutionModifier);
					const actual = Math.min(requested, companion.hp.max - projectedHp);
					pendingCompanionHitDice.push({companionId: companion.id, roll});
					projectedHp += actual;
					remaining--;
					eleRemaining.txt(`${remaining}`);
					eleProjectedHp.txt(`${projectedHp}/${companion.hp.max} HP`);
					if (remaining <= 0 || projectedHp >= companion.hp.max) btn.disabled = true;
					JqueryUtil.doToast({
						type: "success",
						content: `${companion.customName || companion.name}: ${companion.hitDice.die || "d8"} (${roll}) + CON (${constitutionModifier >= 0 ? "+" : ""}${constitutionModifier}) = ${actual} HP`,
					});
					this._page._rollHistory?.addRoll({
						title: `${companion.customName || companion.name} Hit Die`,
						total: actual,
						breakdown: `${companion.hitDice.die || "d8"} (${roll}) + CON (${constitutionModifier >= 0 ? "+" : ""}${constitutionModifier})`,
					});
				});

				ee`<div class="charsheet__hit-die-row">
					<div class="charsheet__hit-die-info">
						<span class="charsheet__hit-die-class">${companion.customName || companion.name}:</span>
						<span class="charsheet__hit-die-die">${companion.hitDice.die || "d8"}</span>
					</div>
					<span class="charsheet__hit-die-remaining">${eleRemaining} / ${companion.hitDice.max} remaining • ${eleProjectedHp}</span>
					${btn}
				</div>`.appendTo(companionHdContainer);
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
					refreshHealingTotal();

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

		// --- Material rest bonuses (e.g. Cloudpearl's +PB) ---
		// Applied here rather than in `useHitDie()`, which this modal deliberately never calls
		// (see the confirm handler). Wiring it there would leave the only path a player
		// actually uses untouched.
		const restBonuses = this._state.getShortRestHealingBonuses?.() || [];
		const suppressedBonuses = new Set();
		let eleBonusRows = [];

		/**
		 * Repaint the running total. The per-row state is written separately from the combined
		 * figure on purpose: a player who sees only one number cannot tell a material bonus
		 * from a lucky die, and legibility is the whole point of graduating this from prose.
		 */
		const refreshHealingTotal = () => {
			const hasSpent = Object.keys(spentDice).length > 0;
			const {total} = CharacterSheetRest.computeRestBonusHealing({bonuses: restBonuses, suppressedNames: suppressedBonuses, hasSpentHitDice: hasSpent});
			eleTotalHealing.txt(`${totalHealing + total}`);
			eleBonusRows.forEach(({bonus, eleState, cb}) => {
				if (!cb.checked) return void eleState.txt("suppressed");
				if (bonus.requiresHitDice && !hasSpent) return void eleState.txt("spend a Hit Die");
				eleState.txt(`+${bonus.value}`);
			});
		};

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

		const armorModelSwitch = this._buildEfaArmorModelSection({restType: "short"});
		if (armorModelSwitch) {
			const amTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (amTarget?.parentNode) amTarget.parentNode.insertBefore(armorModelSwitch.section, amTarget);
			else modalInner.append(armorModelSwitch.section);
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

		// --- Material rest bonuses ---
		// Rendered with the other optional sections rather than inline with the Hit Dice list,
		// because it shares their footer-relative insertion point. Building it here also means
		// `refreshHealingTotal` has its rows before its first paint.
		const materialBonusSection = this._buildMaterialRestBonusSection(restBonuses, suppressedBonuses, () => refreshHealingTotal());
		if (materialBonusSection) {
			eleBonusRows = materialBonusSection.rows;
			const mbTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (mbTarget?.parentNode) mbTarget.parentNode.insertBefore(materialBonusSection.section, mbTarget);
			else modalInner.append(materialBonusSection.section);
		}
		refreshHealingTotal();

		const btnConfirm = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "✓ Finish Short Rest"});
		btnConfirm.onClick(() => {
			// Snapshot the full pre-rest state so this rest can be undone (BUG 8).
			// Captured BEFORE any mutation below; transient and never persisted.
			if (!this._captureRestSnapshot("short")) {
				JqueryUtil.doToast({type: "danger", content: "Could not safely start the short rest."});
				return;
			}
			const timeReceipt = this._advanceCommittedRestTime("short", "CharacterSheetRest.finishShortRest");
			if (!timeReceipt.ok) return;

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

			let companionHealing = 0;
			for (const pending of pendingCompanionHitDice) {
				const result = this._state.spendCompanionHitDie({
					companionId: pending.companionId,
					target: {companionId: pending.companionId, confirmed: true},
					rolls: {hitDie: pending.roll},
				});
				if (result.ok) companionHealing += result.hp.actual;
				else {
					JqueryUtil.doToast({
						type: "warning",
						content: result.message || "A queued companion Hit Die could not be committed.",
					});
				}
			}

			// Material rest bonuses land AFTER the dice healing and are reported separately,
			// so the log distinguishes "you rolled well" from "the pearl paid out".
			const bonusHealing = this._applyRestBonusHealing({
				bonuses: restBonuses,
				suppressedNames: suppressedBonuses,
				hasSpentHitDice: Object.keys(spentDice).length > 0,
			});

			this._restoreResources("short");
			this._state.restoreSignatureSpells?.();

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
			const efaCannonExpiry = this._state.expireEfaEldritchCannonsForRest?.({minutes: 60});

			const armorModelOutcome = armorModelSwitch?.apply() || null;
			const armorModelFeedback = CharacterSheetRest.getEfaArmorModelRestFeedback(armorModelOutcome);

			this._page.saveCharacter();
			this._page.renderCharacter();
			doClose(true);

			let message = `😴 Short rest complete!`;
			if (totalHealing > 0) message += ` Recovered ${totalHealing} HP.`;
			if (companionHealing > 0) message += ` Companions recovered ${companionHealing} HP.`;
			if (bonusHealing > 0) message += ` Materials added ${bonusHealing} HP.`;
			if (slotsRecovered > 0) message += ` Recovered ${slotsRecovered} spell slot(s) via ${slotRecoveryFeatureName}.`;
			if (spRecovered > 0) message += ` Recovered ${spRecovered} sorcery point(s).`;
			if (conditionsToRemove.size > 0) message += ` Removed ${conditionsToRemove.size} condition(s).`;
			if (shouldBreakConcentration) message += ` Broke concentration.`;
			if (tirelessReduced > 0) message += ` Tireless reduced exhaustion by ${tirelessReduced}.`;
			if (memorizeSwap) message += ` Memorized ${memorizeSwap}.`;
			message += armorModelFeedback.successSuffix;
			if (efaCannonExpiry?.count) message += ` ${efaCannonExpiry.count} Eldritch Cannon${efaCannonExpiry.count === 1 ? "" : "s"} expired.`;

			JqueryUtil.doToast({
				type: "success",
				content: message,
			});
			if (armorModelFeedback.warning) {
				JqueryUtil.doToast({
					type: "warning",
					content: armorModelFeedback.warning,
				});
			}

			// Offer a persistent undo for this rest (BUG 8).
			this._showUndoRestAffordance("short");

			this._page.getMaterialsModule?.()?.notifyOverloadedItemsOnRest("short");
			this._page.getMaterialsModule?.()?.offerShortRestRepairs();
		});

		ee`<div class="charsheet__modal-footer">
			${btnCancel}
			${btnConfirm}
		</div>`.appendTo(modalInner);
	}

	/**
	 * Sum the material healing bonuses that actually pay out this rest.
	 *
	 * Pure and DOM-free so the ruling it encodes is directly testable. Two things are being
	 * decided here and they are separable:
	 *
	 * - **Once per rest, not once per die.** The reduction is over *bonuses*, never over dice,
	 *   so spending five Hit Dice pays a Cloudpearl exactly what spending one does.
	 * - **`requiresHitDice` is the trigger, not the amount.** Cloudpearl's text is *"a creature
	 *   that **spends** Hit Dice"*, so resting without spending any is not the trigger at all.
	 *   A material may author the effect ungated, and then it pays on any short rest.
	 *
	 * @param {{bonuses?: *[], suppressedNames?: Set<string>, hasSpentHitDice?: boolean}} opts
	 * @returns {{total: number, applied: *[]}}
	 */
	static computeRestBonusHealing ({bonuses = [], suppressedNames = new Set(), hasSpentHitDice = false} = {}) {
		const applied = bonuses
			.filter(it => !suppressedNames.has(it.name))
			.filter(it => !it.requiresHitDice || hasSpentHitDice)
			.filter(it => Number(it.value) > 0);
		return {total: applied.reduce((total, it) => total + Number(it.value), 0), applied};
	}

	/**
	 * Apply material rest bonuses to the character and report them.
	 *
	 * Deliberately separate from the dice healing rather than folded into one `heal()` call:
	 * a player who sees a single combined number cannot tell a lucky die from a material
	 * paying out, and the toast plus roll-history entry are what make the pearl legible.
	 *
	 * @param {{bonuses?: *[], suppressedNames?: Set<string>, hasSpentHitDice?: boolean}} opts
	 * @returns {number} Hit points actually added.
	 */
	_applyRestBonusHealing (opts) {
		const {total, applied} = CharacterSheetRest.computeRestBonusHealing(opts);
		if (total <= 0) return 0;

		this._state.heal(total);
		const names = applied.map(it => it.name).join(", ");
		JqueryUtil.doToast({type: "success", content: `💠 ${names}: +${total} HP`});
		this._page._rollHistory?.addRoll({title: `Short Rest: ${names}`, total, breakdown: "material rest bonus"});
		return total;
	}

	/**
	 * Build the "Material Benefits" section for the short-rest dialog.
	 *
	 * Each bonus gets a **ticked** checkbox rather than an unticked one, which inverts the
	 * sheet's usual conditional-modifier default on purpose. A conditional bonus is offered
	 * because the sheet cannot know whether it applies; Cloudpearl's benefit is the reverse —
	 * it applies by default and is *suppressed* by an instability (cold damage) the sheet
	 * likewise cannot see. Unticking is the player declaring the suppression.
	 *
	 * @returns {{section: *, rows: *[]}|null} Null when nothing grants a bonus.
	 */
	_buildMaterialRestBonusSection (restBonuses, suppressedBonuses, onChange) {
		if (!restBonuses?.length) return null;

		const section = e_({outer: `<div class="charsheet__rest-section">
			<div class="charsheet__rest-section-title">💠 Material Benefits</div>
		</div>`});
		const rows = [];

		restBonuses.forEach(bonus => {
			const eleState = e_({tag: "span", clazz: "charsheet__hit-die-remaining"});
			const cb = e_({tag: "input", type: "checkbox", checked: true});
			cb.onChange(() => {
				if (cb.checked) suppressedBonuses.delete(bonus.name);
				else suppressedBonuses.add(bonus.name);
				onChange();
			});

			const gate = bonus.requiresHitDice ? " when you spend at least one Hit Die" : "";
			ee`<label class="charsheet__rest-option">
				${cb}
				<span>${bonus.name}: <b>+${bonus.value} HP</b> once this rest${gate}</span>
				${eleState}
			</label>`.appendTo(section);

			rows.push({bonus, eleState, cb});
		});

		return {section, rows};
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

	async _showLongRestDialog ({focusAdventurersAtlas = false} = {}) {
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

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
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

		// Ability-score damage restore (only offered when the character actually has drains).
		const totalAbilityDamage = this._state.getTotalAbilityDamage?.() || 0;
		const hasAbilityDamage = totalAbilityDamage > 0;
		const cbRestoreAbilityDamage = hasAbilityDamage ? (() => { const cb = e_({tag: "input", type: "checkbox"}); cb.checked = true; return cb; })() : null;

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
				<div class="charsheet__rest-options" id="long-rest-options-container">
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

		// Restore-ability-damage option (only when drains exist). Appended as its own
		// ee fragment so the checkbox DOM node embeds correctly (a plain-string nested
		// template would stringify it to "[object HTMLInputElement]").
		if (cbRestoreAbilityDamage) {
			const optsContainer = e_({ele: modalInner}).find("#long-rest-options-container");
			ee`<label class="charsheet__rest-option">
				${cbRestoreAbilityDamage}
				<span>🩸 Restore ability damage (−${totalAbilityDamage} total)</span>
			</label>`.appendTo(optsContainer);
		}

		// Render condition checkboxes
		if (conditions.length > 0 || isConcentrating) {
			const condContainer = e_({ele: modalInner}).find("#long-rest-conditions-container");

			// Concentration first
			if (isConcentrating) {
				ee`<label class="charsheet__rest-option">
					${cbBreakConcentration}
					<span>🔮 Break Concentration (${this._state.getConcentrationLabel?.() || concentration?.spellName || "unknown spell"})</span>
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

		const arcaneFirearmChoice = this._buildEfaArcaneFirearmLongRestSection();
		if (arcaneFirearmChoice) {
			const afTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (afTarget?.parentNode) afTarget.parentNode.insertBefore(arcaneFirearmChoice.section, afTarget);
			else modalInner.append(arcaneFirearmChoice.section);
		}

		// --- Primal Focus mode selector (TGTT Ranger) ---
		const primalFocusSelect = this._buildPrimalFocusModeSection();
		if (primalFocusSelect) {
			const pfTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (pfTarget?.parentNode) pfTarget.parentNode.insertBefore(primalFocusSelect.section, pfTarget);
			else modalInner.append(primalFocusSelect.section);
		}

		const armorModelSwitch = this._buildEfaArmorModelSection({restType: "long"});
		if (armorModelSwitch) {
			const amTarget = modalInner.querySelector(".charsheet__modal-footer") || btnCancel.parentNode;
			if (amTarget?.parentNode) amTarget.parentNode.insertBefore(armorModelSwitch.section, amTarget);
			else modalInner.append(armorModelSwitch.section);
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

		const spellMasterySwap = this._buildSpellMasteryLongRestSection();
		if (spellMasterySwap) modalInner.append(spellMasterySwap.section);
		const temporalMasteryAge = this._buildTemporalMasteryAgeSection();
		if (temporalMasteryAge) modalInner.append(temporalMasteryAge.section);
		const adventurersAtlas = this._buildAdventurersAtlasLongRestSection();
		if (adventurersAtlas) modalInner.append(adventurersAtlas.section);
		const replicateMagicItemProduction = this._buildEfaReplicateMagicItemProductionSection();
		if (replicateMagicItemProduction) modalInner.append(replicateMagicItemProduction.section);
		const spellStoringItemChoice = this._buildEfaSpellStoringItemSection();
		if (spellStoringItemChoice) modalInner.append(spellStoringItemChoice.section);
		const steelDefenderReplacement = this._buildEfaSteelDefenderReplacementSection();
		if (steelDefenderReplacement) modalInner.append(steelDefenderReplacement.section);

		const btnConfirm = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "🌙 Finish Long Rest"});
		const syncValidity = () => {
			btnConfirm.disabled = !!(
				(temporalMasteryAge && !temporalMasteryAge.isValid())
				|| (adventurersAtlas && !adventurersAtlas.isValid())
			);
		};
		temporalMasteryAge?.onChange(syncValidity);
		adventurersAtlas?.onChange(syncValidity);
		syncValidity();
		btnConfirm.onClick(async () => {
			if (temporalMasteryAge && !temporalMasteryAge.isValid()) return;
			if (adventurersAtlas && !adventurersAtlas.isValid()) {
				adventurersAtlas.focusFirstInvalid();
				return;
			}
			// Snapshot the full pre-rest state so this rest can be undone (BUG 8).
			// Captured BEFORE any mutation below; transient and never persisted.
			const previousRestSnapshot = this._page?._lastRestSnapshot || null;
			const restSnapshot = this._captureRestSnapshot("long");
			if (!restSnapshot?.json) {
				this._page._lastRestSnapshot = previousRestSnapshot;
				JqueryUtil.doToast({
					type: "danger",
					content: "The Long Rest could not start because the current character state could not be protected for rollback. No changes were made.",
				});
				return;
			}
			btnConfirm.disabled = true;
			let atlasResult = null;
			try {
				atlasResult = this._applyAdventurersAtlasLongRestPlan(adventurersAtlas?.getPlan());
				if (!atlasResult.ok) {
					throw new Error(atlasResult.errors.join(" "));
				}
				const timeReceipt = this._state.advanceRestTime?.("long", {
					identity: "CharacterSheetRest.finishLongRest",
				});
				if (!timeReceipt?.ok) {
					throw new Error(`Could not finish the long rest: ${timeReceipt?.message || timeReceipt?.code || "time advancement failed"}.`);
				}
				this._state.resetTurnEconomy?.({round: null});

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
				this._state.restoreSignatureSpells?.();
				this._state.restoreCartographerMappingMagicUses?.();

				// Clear one level of exhaustion using the dedicated exhaustion tracker
				if (cbClearExhaustion.checked) {
					const currentExhaustion = this._state.getExhaustion();
					if (currentExhaustion > 0) {
						this._state.setExhaustion(currentExhaustion - 1);
					}
				}

				// Restore ability-score damage (all drains) if requested.
				let abilityDamageRestored = 0;
				if (cbRestoreAbilityDamage?.checked) {
					abilityDamageRestored = totalAbilityDamage;
					this._state.clearAllAbilityDamage?.();
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
					this._state.resetGamblerPreparedRoll(false); // Keep current prepared spells as options
				}

				// Reset Gambler daily resources (Extra Luck, Master of Fortune uses)
				if (calcs.hasGamblerFolly) {
					this._state.resetGamblerDailyResources();
				}
				this._state.resetBonusAction?.();

				// Apply Hunter's Prey option swap, if changed
				huntersPreySwap?.apply();
				const replicateMagicItemResult = this._commitEfaReplicateMagicItemProduction(replicateMagicItemProduction, {
					protectedInventoryItemIds: [arcaneFirearmChoice?.getSelectedItemId?.()].filter(Boolean),
				});
				const arcaneFirearmChanged = arcaneFirearmChoice?.apply() || false;

				// Apply Primal Focus mode selection, if changed (free on a long rest)
				const primalFocusChanged = primalFocusSelect?.apply() || false;
				const daemonologistSideChanged = daemonologistSideSelect?.apply() || false;

				// Forked Tongue: a new long rest re-enables the once-per-rest swap, then we
				// apply any language swap the player chose in this dialog.
				this._state.resetForkedTongueSwap?.();
				const forkedTongueChanged = forkedTongueSwap?.apply() || false;

				// Apply Terrorizing Force damage-type re-choice (free on a long rest)
				const terrorizingForceChanged = terrorizingForceChoice?.apply() || false;
				const spellMasteryChanged = spellMasterySwap?.apply() || false;
				const temporalAgeChanged = temporalMasteryAge?.apply() || false;
				const armorModelOutcome = armorModelSwitch?.apply() || null;
				const armorModelFeedback = CharacterSheetRest.getEfaArmorModelRestFeedback(armorModelOutcome);
				const spellStoringItemResult = this._commitEfaSpellStoringItemChoice(spellStoringItemChoice);
				const steelDefenderReplacementResult = this._commitEfaSteelDefenderReplacement(steelDefenderReplacement);
				const efaCannonExpiry = this._state.expireEfaEldritchCannonsForRest?.({minutes: 480});

				// Save changes
				let saveResult;
				if (this._page._saveCurrentCharacter) {
					saveResult = await this._page._saveCurrentCharacter({isReturnStatus: true});
				} else {
					saveResult = this._page.saveCharacter?.();
					if (saveResult?.then) saveResult = await saveResult;
				}
				if (saveResult === false) throw new Error("The Long Rest could not be saved.");
				this._page.renderCharacter();

				doClose(true);

				let message = "🌙 Long rest complete! All resources restored.";
				if (primalFocusChanged) message += ` Primal Focus set to ${primalFocusChanged}.`;
				if (daemonologistSideChanged) message += ` Fair and Foul set to ${daemonologistSideChanged}.`;
				if (forkedTongueChanged) message += ` Forked Tongue: swapped ${forkedTongueChanged}.`;
				if (terrorizingForceChanged) message += ` Terrorizing Force damage set to ${terrorizingForceChanged}.`;
				if (spellMasteryChanged) message += ` Spell Mastery changed to ${spellMasteryChanged}.`;
				if (temporalAgeChanged) message += ` Temporal Mastery changed age to ${temporalAgeChanged}.`;
				if (arcaneFirearmChanged) message += ` Arcane Firearm carved into ${arcaneFirearmChanged}.`;
				if (replicateMagicItemResult?.ok && replicateMagicItemResult.code === "replicate-production-committed") {
					message += ` Created ${replicateMagicItemResult.created.length} replicated item${replicateMagicItemResult.created.length === 1 ? "" : "s"}.`;
					if (replicateMagicItemResult.evicted.length) {
						message += ` Removed ${replicateMagicItemResult.evicted.length} oldest replicated item${replicateMagicItemResult.evicted.length === 1 ? "" : "s"} to stay within capacity.`;
					}
				} else if (replicateMagicItemResult && !replicateMagicItemResult.ok) {
					message += ` Replicate Magic Item was skipped: ${replicateMagicItemResult.message || replicateMagicItemResult.code}.`;
				}
				if (spellStoringItemResult?.committed) {
					message += ` Stored ${spellStoringItemResult.storage.spell.name} in ${spellStoringItemResult.storage.host.name}.`;
				} else if (spellStoringItemResult && !spellStoringItemResult.ok) {
					message += " Spell-Storing Item was unchanged because the selected host or spell could not be resolved.";
				}
				if (steelDefenderReplacementResult?.committed) {
					message += ` Steel Defender replacement created as generation ${steelDefenderReplacementResult.generation.generation} at ${steelDefenderReplacementResult.hp.current}/${steelDefenderReplacementResult.hp.max} HP.`;
				} else if (steelDefenderReplacementResult && !steelDefenderReplacementResult.ok) {
					message += ` Steel Defender replacement made no changes: ${steelDefenderReplacementResult.message || "the staged replacement could not be committed"}.`;
				}
				if (abilityDamageRestored > 0) message += ` Restored ${abilityDamageRestored} ability damage.`;
				if (conditionsToRemove.size > 0) message += ` Removed ${conditionsToRemove.size} condition(s).`;
				if (cbBreakConcentration?.checked) message += ` Broke concentration.`;
				if (removedCompanions > 0) message += ` Wild Shape form/companion dismissed.`;
				if (atlasResult.changed) message += ` Adventurer's Atlas ${atlasResult.atlas.generation > 1 ? "recreated" : "created"}.`;
				message += armorModelFeedback.successSuffix;
				if (efaCannonExpiry?.count) message += ` ${efaCannonExpiry.count} Eldritch Cannon${efaCannonExpiry.count === 1 ? "" : "s"} expired.`;

				JqueryUtil.doToast({
					type: "success",
					content: message,
				});
				if (armorModelFeedback.warning) {
					JqueryUtil.doToast({
						type: "warning",
						content: armorModelFeedback.warning,
					});
				}

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

				this._page.getMaterialsModule?.()?.notifyOverloadedItemsOnRest("long");
			} catch (error) {
				if (restSnapshot?.json) this._state.loadFromJson(restSnapshot.json);
				if (this._page) this._page._lastRestSnapshot = previousRestSnapshot;
				if (previousRestSnapshot) this._showUndoRestAffordance(previousRestSnapshot.restType);
				else this._removeUndoRestAffordance();
				let isRollbackPersisted = true;
				try {
					let rollbackSaveResult;
					if (this._page._saveCurrentCharacter) {
						rollbackSaveResult = await this._page._saveCurrentCharacter({isReturnStatus: true});
					} else {
						rollbackSaveResult = this._page.saveCharacter?.();
						if (rollbackSaveResult?.then) rollbackSaveResult = await rollbackSaveResult;
					}
					isRollbackPersisted = rollbackSaveResult !== false;
				} catch {
					isRollbackPersisted = false;
				}
				this._page.renderCharacter?.();
				btnConfirm.disabled = false;
				JqueryUtil.doToast({
					type: "danger",
					content: isRollbackPersisted
						? `${error?.message || "The Long Rest could not be completed."} No changes were kept.`
						: `${error?.message || "The Long Rest could not be completed."} The sheet was restored, but that rollback could not be saved; save the character manually before leaving.`,
				});
				if (atlasResult && !atlasResult.ok) adventurersAtlas?.focusFirstInvalid();
			}
		});

		ee`<div class="charsheet__modal-footer">
			${btnCancel}
			${btnConfirm}
		</div>`.appendTo(modalInner);
		if (focusAdventurersAtlas) adventurersAtlas?.selectCreateModeAndFocus();
	}

	openAdventurersAtlasLongRest () {
		return this._showLongRestDialog({focusAdventurersAtlas: true});
	}

	_applyAdventurersAtlasLongRestPlan (plan) {
		if (!plan || plan.mode === "keep") {
			return {ok: true, changed: false, errors: [], atlas: this._state.getAdventurersAtlas()};
		}
		if (plan.mode === "create") {
			return this._state.createAdventurersAtlas(plan.holders, {isHoldingTools: plan.isHoldingTools});
		}
		if (plan.mode === "recreate") {
			return this._state.recreateAdventurersAtlas(plan.holders, {isHoldingTools: plan.isHoldingTools});
		}
		return {
			ok: false,
			changed: false,
			errors: ["Unknown Adventurer's Atlas Long Rest action."],
			atlas: this._state.getAdventurersAtlas(),
		};
	}

	_buildAdventurersAtlasLongRestSection () {
		if (!this._state.hasAdventurersAtlasFeature?.()) return null;

		const atlas = this._state.getAdventurersAtlas();
		const capacity = this._state.getAdventurersAtlasCapacity();
		const hasTools = this._state.hasCartographersToolsForAtlas();
		const isRecreate = atlas.generation > 0;
		const groupName = `adventurers-atlas-mode-${Date.now()}`;
		const listeners = new Set();
		let lastErrors = [];
		const previousSelf = atlas.holders.find(holder => holder.isSelf)?.name;
		const previousOthers = atlas.holders.filter(holder => !holder.isSelf).map(holder => holder.name);
		const selfName = previousSelf || this._state.getCharacterName?.() || "Character";

		const section = e_({
			tag: "section",
			clazz: "charsheet__rest-section charsheet__atlas-rest",
			attrs: {
				"aria-labelledby": "charsheet-atlas-rest-title",
				tabindex: "-1",
			},
		});
		const title = e_({
			tag: "div",
			clazz: "charsheet__rest-section-title",
			attrs: {id: "charsheet-atlas-rest-title"},
			txt: "Adventurer's Atlas",
		});
		const intro = e_({
			tag: "p",
			clazz: "charsheet__atlas-rest-copy",
			txt: `Keep the current Atlas, or ${isRecreate ? "replace every existing map" : "create it"} while holding Cartographer's Tools. Choose 2–${capacity} creatures; you may include yourself. Capacity is frozen when created.`,
		});
		section.append(title, intro);

		const modeGroup = e_({tag: "div", clazz: "charsheet__atlas-rest-modes", attrs: {role: "radiogroup", "aria-label": "Adventurer's Atlas action"}});
		const radioKeep = e_({tag: "input", type: "radio", attrs: {name: groupName, value: "keep"}});
		radioKeep.checked = true;
		const radioChange = e_({tag: "input", type: "radio", attrs: {name: groupName, value: isRecreate ? "recreate" : "create"}});
		radioChange.disabled = !hasTools;
		ee`<label class="charsheet__atlas-rest-mode">${radioKeep}<span><strong>Keep current Atlas</strong><small>${isRecreate ? "No maps or holder statuses change." : "Finish the rest without creating an Atlas."}</small></span></label>`.appendTo(modeGroup);
		ee`<label class="charsheet__atlas-rest-mode">${radioChange}<span><strong>${isRecreate ? "Recreate Atlas" : "Create Atlas"}</strong><small>${hasTools ? "Validate this roster and commit it only when the rest finishes." : "Requires Cartographer's Tools|XPHB in inventory."}</small></span></label>`.appendTo(modeGroup);
		section.append(modeGroup);

		const controls = e_({tag: "div", clazz: "charsheet__atlas-rest-controls"});
		controls.hidden = true;
		const cbHeld = e_({tag: "input", type: "checkbox"});
		const heldLabel = ee`<label class="charsheet__rest-option charsheet__atlas-rest-held">${cbHeld}<span>I confirm I am holding Cartographer's Tools for this rest.</span></label>`;
		controls.append(heldLabel);
		const cbIncludeSelf = e_({tag: "input", type: "checkbox"});
		cbIncludeSelf.checked = !!previousSelf;
		const selfLabel = ee`<label class="charsheet__rest-option charsheet__atlas-rest-self-choice">${cbIncludeSelf}<span><strong>Include yourself as a map holder</strong><small>${selfName} receives Awareness only while this self map is active.</small></span></label>`;
		controls.append(selfLabel);

		const rosterHeading = e_({tag: "div", clazz: "charsheet__atlas-rest-roster-heading"});
		rosterHeading.append(
			e_({tag: "span", txt: `Map holders (2–${capacity})`}),
		);
		const btnAddHolder = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-default", attrs: {type: "button"}, txt: "Add holder"});
		rosterHeading.append(btnAddHolder);
		controls.append(rosterHeading);

		const roster = e_({tag: "div", clazz: "charsheet__atlas-rest-roster"});
		controls.append(roster);
		const status = e_({
			tag: "div",
			clazz: "charsheet__atlas-rest-feedback",
			attrs: {role: "status", "aria-live": "polite", "aria-atomic": "true", tabindex: "-1"},
		});
		controls.append(status);
		section.append(controls);

		const rows = previousOthers
			.slice(0, Math.max(0, capacity - (cbIncludeSelf.checked ? 1 : 0)))
			.map(name => ({name}));
		while (rows.length + (cbIncludeSelf.checked ? 1 : 0) < 2) rows.push({name: ""});

		const getDraftHolders = () => [
			...(cbIncludeSelf.checked
				? [{
					id: null,
					name: selfName,
					isSelf: true,
					status: "active",
					destroyedBy: null,
					destroyedAt: null,
				}]
				: []),
			...rows.map(row => ({
				id: null,
				name: row.input?.value || row.name || "",
				isSelf: false,
				status: "active",
				destroyedBy: null,
				destroyedAt: null,
			})),
		];

		const notifyChange = () => listeners.forEach(fn => fn());
		const sync = () => {
			const isChanging = radioChange.checked;
			controls.hidden = !isChanging;
			if (!isChanging) {
				lastErrors = [];
				status.textContent = "";
				status.classList.remove("charsheet__atlas-rest-feedback--error", "charsheet__atlas-rest-feedback--ready");
				notifyChange();
				return;
			}
			const validation = this._state.validateAdventurersAtlasRoster(getDraftHolders(), {capacity});
			lastErrors = [
				...(!hasTools ? ["Cartographer's Tools|XPHB must be in inventory."] : []),
				...(!cbHeld.checked ? ["Confirm that the tools are being held."] : []),
				...validation.errors,
			];
			status.classList.toggle("charsheet__atlas-rest-feedback--error", !!lastErrors.length);
			status.classList.toggle("charsheet__atlas-rest-feedback--ready", !lastErrors.length);
			const holderCount = getDraftHolders().length;
			status.textContent = lastErrors.length
				? `Needs attention: ${lastErrors.join(" ")}`
				: `Ready: ${holderCount} active maps will ${isRecreate ? "replace the prior Atlas" : "be created"} when this Long Rest finishes.`;
			btnAddHolder.disabled = holderCount >= capacity;
			notifyChange();
		};

		const renderRows = () => {
			roster.replaceChildren();
			rows.forEach((row, ix) => {
				const inputId = `charsheet-atlas-holder-${Date.now()}-${ix}`;
				const input = e_({
					tag: "input",
					clazz: "form-control input-sm",
					attrs: {
						id: inputId,
						type: "text",
						autocomplete: "off",
						placeholder: "Creature name",
					},
				});
				input.value = row.name;
				row.input = input;
				input.addEventListener("input", sync);
				const rowEle = e_({tag: "div", clazz: "charsheet__atlas-rest-holder"});
				const label = e_({
					tag: "label",
					attrs: {for: inputId},
					txt: `Ally holder ${ix + 1}`,
				});
				const field = e_({tag: "div", clazz: "charsheet__atlas-rest-holder-field"});
				field.append(input);
				const btnRemove = e_({
					tag: "button",
					clazz: "ve-btn ve-btn-xs ve-btn-default",
					attrs: {type: "button", "aria-label": `Remove ally holder ${ix + 1}`},
					txt: "Remove",
				});
				btnRemove.addEventListener("click", () => {
					rows.splice(ix, 1);
					renderRows();
					sync();
				});
				field.append(btnRemove);
				rowEle.append(label, field);
				roster.append(rowEle);
			});
			btnAddHolder.disabled = getDraftHolders().length >= capacity;
		};

		btnAddHolder.addEventListener("click", () => {
			if (getDraftHolders().length >= capacity) return;
			rows.push({name: ""});
			renderRows();
			sync();
			rows.at(-1)?.input?.focus();
		});
		radioKeep.addEventListener("change", sync);
		radioChange.addEventListener("change", sync);
		cbHeld.addEventListener("change", sync);
		cbIncludeSelf.addEventListener("change", sync);
		renderRows();
		sync();

		return {
			section,
			getPlan: () => radioKeep.checked
				? {mode: "keep"}
				: {mode: isRecreate ? "recreate" : "create", holders: getDraftHolders(), isHoldingTools: cbHeld.checked},
			isValid: () => radioKeep.checked || !lastErrors.length,
			onChange: fn => listeners.add(fn),
			focusFirstInvalid: () => {
				if (!radioChange.checked) return radioChange.focus();
				if (!cbHeld.checked) return cbHeld.focus();
				const firstEmpty = rows.find(row => !row.input?.value.trim());
				if (firstEmpty) return firstEmpty.input.focus();
				if (getDraftHolders().length < 2) return btnAddHolder.focus();
				status.focus?.();
			},
			selectCreateModeAndFocus: () => {
				if (!hasTools) return section.focus();
				radioChange.checked = true;
				radioKeep.checked = false;
				sync();
				queueMicrotask(() => (rows[0]?.input || cbIncludeSelf).focus());
			},
		};
	}

	_buildEfaSpellStoringItemSection () {
		const options = this._state.getEfaSpellStoringItemOptions?.();
		if (!options?.available) return null;
		const current = this._state.getEfaSpellStoringItem?.();
		const section = e_({tag: "fieldset", clazz: "charsheet__rest-section charsheet__spell-storage-rest"});
		const title = e_({tag: "legend", clazz: "charsheet__rest-section-title", txt: "Spell-Storing Item — Optional"});
		const summary = e_({
			tag: "p",
			clazz: "ve-muted ve-small mb-2",
			txt: current
				? `Currently storing ${current.storage.spell.name} in ${current.item?.name || current.storage.host.name}. Leave both choices blank to keep it unchanged.`
				: "Choose one held eligible item and one exact EFA Artificer spell. Leave both choices blank to skip this feature.",
		});
		const hostId = `efa-spell-storage-host-${CryptUtil.uid()}`;
		const spellId = `efa-spell-storage-spell-${CryptUtil.uid()}`;
		const hostSelect = e_({tag: "select", clazz: "form-control input-sm"});
		hostSelect.id = hostId;
		hostSelect.setAttribute("aria-describedby", `${hostId}-help`);
		hostSelect.append(e_({tag: "option", value: "", txt: "Keep current storage unchanged"}));
		for (const host of options.hosts) hostSelect.append(e_({tag: "option", value: host.itemId, txt: `${host.name} (${host.source})`}));
		const spellSelect = e_({tag: "select", clazz: "form-control input-sm"});
		spellSelect.id = spellId;
		spellSelect.setAttribute("aria-describedby", `${spellId}-help`);
		spellSelect.append(e_({tag: "option", value: "", txt: "Keep current storage unchanged"}));
		for (const spell of options.spells) spellSelect.append(e_({tag: "option", value: spell.spellUid, txt: `${spell.name} (${spell.source}) — level ${spell.level}`}));
		const hostLabel = e_({tag: "label", clazz: "ve-flex-col mb-2"});
		hostLabel.htmlFor = hostId;
		hostLabel.append(
			e_({tag: "span", clazz: "ve-bold", txt: "Held host item"}),
			hostSelect,
			e_({tag: "span", id: `${hostId}-help`, clazz: "ve-muted ve-small", txt: "Simple or Martial weapon, proficient Artificer's Tools, or an eligible active replicated Wand or Weapon."}),
		);
		const spellLabel = e_({tag: "label", clazz: "ve-flex-col mb-2"});
		spellLabel.htmlFor = spellId;
		spellLabel.append(
			e_({tag: "span", clazz: "ve-bold", txt: "Stored spell"}),
			spellSelect,
			e_({tag: "span", id: `${spellId}-help`, clazz: "ve-muted ve-small", txt: "Level 1–3, one Action, on the exact EFA Artificer list, with no consumed Material component. Preparation is not required."}),
		);
		const status = e_({tag: "div", clazz: "ve-small charsheet__spell-storage-rest-status"});
		status.setAttribute("role", "status");
		status.setAttribute("aria-live", "polite");
		const getRequest = () => {
			const hostItemId = String(hostSelect.value || "");
			const spellUid = String(spellSelect.value || "");
			if (!hostItemId && !spellUid) return null;
			if (!hostItemId || !spellUid) return null;
			if (!options.hosts.some(host => host.itemId === hostItemId)) return null;
			if (!options.spells.some(spell => spell.spellUid === spellUid)) return null;
			return {hostItemId, spellUid};
		};
		const renderStatus = () => {
			const hostItemId = String(hostSelect.value || "");
			const spellUid = String(spellSelect.value || "");
			status.classList.remove("text-warning", "text-success");
			if (!hostItemId && !spellUid) {
				status.textContent = current ? "Current storage will remain unchanged." : "No spell will be stored.";
				return;
			}
			if (!getRequest()) {
				status.textContent = "Choose both a host and a spell. The long rest will still finish, and current storage will remain unchanged.";
				status.classList.add("text-warning");
				return;
			}
			const host = options.hosts.find(it => it.itemId === hostItemId);
			const spell = options.spells.find(it => it.spellUid === spellUid);
			status.textContent = `${spell.name} will be stored in ${host.name} with ${Math.max(2, 2 * this._state.getAbilityMod("int"))} uses.`;
			status.classList.add("text-success");
		};
		hostSelect.addEventListener("change", renderStatus);
		spellSelect.addEventListener("change", renderStatus);
		section.append(title, summary, hostLabel, spellLabel, status);
		renderStatus();
		return {section, hostSelect, spellSelect, status, getRequest};
	}

	_commitEfaSpellStoringItemChoice (choice) {
		if (!choice) return null;
		const request = choice.getRequest();
		if (!request) return {ok: true, committed: false, reason: "selection-skipped"};
		return this._state.commitEfaSpellStoringItemAtLongRest?.(request)
			|| {ok: false, committed: false, reason: "storage-unavailable"};
	}

	_buildEfaSteelDefenderReplacementSection () {
		const ownerUid = this._state.constructor?.EFA_BATTLE_SMITH_FEATURE_UIDS?.STEEL_DEFENDER;
		if (!ownerUid) return null;
		const companion = (this._state.getFeatureOwnedCompanions?.(ownerUid) || []).find(candidate =>
			String(candidate?.name || "").trim().toLowerCase() === "steel defender"
			&& String(candidate?.source || "").trim().toUpperCase() === "EFA",
		);
		if (!companion) return null;

		const toolRows = this._state.getFeatureCompanionReplacementToolRows?.(companion.id) || [];
		const section = e_({
			tag: "fieldset",
			clazz: "charsheet__rest-section charsheet__steel-defender-replacement",
		});
		const legend = e_({
			tag: "legend",
			clazz: "charsheet__rest-section-title",
			txt: "Steel Defender — Optional Replacement",
		});
		const summary = e_({
			tag: "p",
			clazz: "ve-muted ve-small mb-2",
			txt: `Create a new generation after this Long Rest. Leaving this blank keeps generation ${Math.max(1, Number(companion.lifecycle?.generation) || 1)} unchanged.`,
		});
		const toolLabel = e_({tag: "label", clazz: "charsheet__steel-defender-replacement-field"});
		toolLabel.append(e_({tag: "span", clazz: "ve-small ve-bold", txt: "Exact persisted Smith's Tools row"}));
		const toolSelect = e_({tag: "select", clazz: "form-control input-sm"});
		const blankOption = e_({tag: "option", txt: "Do not replace the defender"});
		blankOption.value = "";
		toolSelect.append(blankOption);
		for (const row of toolRows) {
			const option = e_({tag: "option", txt: row.label});
			option.value = row.itemId;
			toolSelect.append(option);
		}
		if (!toolRows.length) toolSelect.disabled = true;
		toolLabel.append(toolSelect);

		const inHandLabel = e_({tag: "label", clazz: "charsheet__rest-option charsheet__steel-defender-replacement-confirm"});
		const inHand = e_({tag: "input", type: "checkbox"});
		inHand.disabled = true;
		inHandLabel.append(inHand, e_({
			tag: "span",
			txt: "I will have this exact Smith's Tools (XPHB) inventory row in hand when the rest finishes.",
		}));
		const status = e_({tag: "div", clazz: "ve-small charsheet__steel-defender-replacement-status"});
		status.setAttribute("role", "status");
		status.setAttribute("aria-live", "polite");
		status.setAttribute("aria-atomic", "true");
		toolSelect.setAttribute("aria-describedby", "charsheet-steel-defender-replacement-status");
		inHand.setAttribute("aria-describedby", "charsheet-steel-defender-replacement-status");
		status.id = "charsheet-steel-defender-replacement-status";
		section.append(legend, summary, toolLabel, inHandLabel, status);

		const renderStatus = () => {
			const selected = toolRows.find(row => row.itemId === toolSelect.value) || null;
			inHand.disabled = !selected;
			if (!selected) inHand.checked = false;
			status.textContent = !toolRows.length
				? "No positive-quantity exact Smith's Tools (XPHB) inventory row is available. The Long Rest will finish normally."
				: !selected
					? "No replacement selected. The Long Rest will finish normally."
					: inHand.checked
						? `Generation ${Math.max(1, Number(companion.lifecycle?.generation) || 1) + 1} will replace the current defender after canonical rest processing.`
						: "Confirm the selected tools are in hand. Without confirmation, the Long Rest still finishes but replacement makes no changes.";
			status.classList.toggle("text-warning", !!selected && !inHand.checked);
			status.classList.toggle("text-success", !!selected && inHand.checked);
		};
		toolSelect.onChange(renderStatus);
		inHand.onChange(renderStatus);
		renderStatus();

		return {
			section,
			companionId: companion.id,
			toolRows,
			getRequest: () => toolSelect.value
				? {
					companionId: companion.id,
					toolItemId: toolSelect.value,
					inHandConfirmed: inHand.checked === true,
				}
				: null,
		};
	}

	_commitEfaSteelDefenderReplacement (replacement) {
		const request = replacement?.getRequest?.();
		if (!request) return null;
		if (typeof this._page.commitFeatureCompanionReplacementAfterLongRest !== "function") {
			return {
				ok: false,
				committed: false,
				reason: "pageLifecycleCoordinatorUnavailable",
				message: "The shared Steel Defender lifecycle coordinator is unavailable.",
			};
		}
		return this._page.commitFeatureCompanionReplacementAfterLongRest(request);
	}

	_buildEfaReplicateMagicItemProductionSection () {
		const production = this._state.getEfaReplicateMagicItemProductionOptions?.();
		if (!production || production.classLevel < 2 || production.maxCreatedItems < 1) return null;

		const section = e_({
			tag: "fieldset",
			clazz: "charsheet__rest-section charsheet__replicate-rest",
		});
		const title = e_({tag: "legend", clazz: "charsheet__rest-section-title", txt: "Replicate Magic Item — Optional Production"});
		const currentCount = this._state.getGeneratedFeatureItemRows?.(CharacterSheetState.EFA_REPLICATE_MAGIC_ITEM_OWNER)?.length || 0;
		const summary = e_({
			tag: "p",
			clazz: "ve-muted ve-small mb-2",
			txt: `Create up to ${production.maxCreatedItems} items from different known plans. You currently have ${currentCount}/${production.maxCreatedItems}. Leaving every row blank skips production without affecting the rest.`,
		});
		const rowsContainer = e_({tag: "div", clazz: "charsheet__replicate-rest-rows"});
		const status = e_({tag: "div", clazz: "ve-small charsheet__replicate-rest-status"});
		status.setAttribute("aria-live", "polite");
		status.setAttribute("role", "status");
		section.append(title, summary, rowsContainer, status);

		if (!production.available) {
			status.textContent = production.unavailableReason || "Replicate Magic Item production is unavailable.";
			status.classList.add("text-warning");
			return {
				section,
				rows: [],
				getRequest: () => ({selections: []}),
				getValidation: () => ({isValid: true, issues: []}),
				onChange: () => {},
			};
		}

		const planBySlot = new Map(production.plans.map(plan => [String(plan.plan?.slotId), plan]));
		const rows = [];
		let notifyChange = () => {};
		const appendOption = (select, {value = "", label, disabled = false} = {}) => {
			const option = e_({tag: "option", txt: label});
			option.value = value;
			option.disabled = disabled;
			select.append(option);
			return option;
		};
		const clearSelect = select => {
			select.innerHTML = "";
			if (Array.isArray(select._children)) select._children.length = 0;
		};
		const getSelectedOption = row => {
			const plan = planBySlot.get(String(row.planSelect.value || ""));
			if (!plan?.ok) return null;
			return plan.options.find(option => option.itemUid === row.itemSelect.value) || null;
		};

		const renderValidation = () => {
			const issues = [];
			const selectedSlots = rows.map(row => row.planSelect.value).filter(Boolean);
			if (new Set(selectedSlots).size !== selectedSlots.length) issues.push("Each produced item must use a different known plan.");
			for (const row of rows) {
				if (!row.planSelect.value) continue;
				const plan = planBySlot.get(String(row.planSelect.value));
				if (!plan?.ok) issues.push(`${plan?.plan?.selection?.displayName || plan?.plan?.selection?.name || "A selected plan"} is unavailable in the item catalog.`);
				else if (!getSelectedOption(row)) issues.push(`Choose the specific item for ${plan.plan.selection.displayName || plan.plan.selection.name}.`);
			}
			status.textContent = issues.length
				? `${issues.join(" ")} The long rest will still finish, but unresolved production makes no inventory changes.`
				: selectedSlots.length
					? `${selectedSlots.length} item${selectedSlots.length === 1 ? "" : "s"} will be created when the rest finishes.`
					: "No production selected. The long rest will finish normally.";
			status.classList.toggle("text-warning", !!issues.length);
			status.classList.toggle("text-success", !issues.length && !!selectedSlots.length);
			notifyChange();
			return {isValid: !issues.length, issues};
		};

		for (let index = 0; index < production.maxCreatedItems; index++) {
			const rowId = `efa-replicate-rest-${index + 1}`;
			const row = e_({tag: "div", clazz: "charsheet__replicate-rest-row"});
			const rowLabel = e_({tag: "div", clazz: "charsheet__replicate-rest-row-label", txt: `Item ${index + 1}`});
			const planLabel = e_({tag: "label", clazz: "charsheet__replicate-rest-field"});
			planLabel.setAttribute("for", `${rowId}-plan`);
			planLabel.append(e_({tag: "span", clazz: "ve-small ve-bold", txt: "Known plan"}));
			const planSelect = e_({tag: "select", clazz: "form-control input-xs"});
			planSelect.id = `${rowId}-plan`;
			appendOption(planSelect, {label: "No item"});
			for (const plan of production.plans) {
				appendOption(planSelect, {
					value: String(plan.plan?.slotId || ""),
					label: plan.ok
						? (plan.plan.selection.displayName || plan.plan.selection.name)
						: `${plan.plan?.selection?.displayName || plan.plan?.selection?.name || "Unavailable plan"} — unavailable`,
					disabled: !plan.ok,
				});
			}
			planLabel.append(planSelect);

			const itemLabel = e_({tag: "label", clazz: "charsheet__replicate-rest-field"});
			itemLabel.setAttribute("for", `${rowId}-item`);
			itemLabel.append(e_({tag: "span", clazz: "ve-small ve-bold", txt: "Created item"}));
			const itemSelect = e_({tag: "select", clazz: "form-control input-xs"});
			itemSelect.id = `${rowId}-item`;
			itemSelect.disabled = true;
			appendOption(itemSelect, {label: "Choose a plan first"});
			itemLabel.append(itemSelect);

			const attuneLabel = e_({tag: "label", clazz: "charsheet__rest-option charsheet__replicate-rest-attune"});
			const attune = e_({tag: "input", type: "checkbox"});
			attune.disabled = true;
			attuneLabel.append(attune, e_({tag: "span", txt: "Attune immediately if possible"}));
			row.append(rowLabel, planLabel, itemLabel, attuneLabel);
			rowsContainer.append(row);

			const rowState = {row, planSelect, itemSelect, attune};
			rows.push(rowState);
			const updatePlan = () => {
				clearSelect(itemSelect);
				const plan = planBySlot.get(String(planSelect.value || ""));
				if (!plan?.ok) {
					itemSelect.disabled = true;
					appendOption(itemSelect, {label: planSelect.value ? "Plan unavailable" : "Choose a plan first"});
					attune.checked = false;
					attune.disabled = true;
					renderValidation();
					return;
				}
				if (plan.options.length === 1) {
					appendOption(itemSelect, {
						value: plan.options[0].itemUid,
						label: `${plan.options[0].name} (${plan.options[0].source})`,
					});
					itemSelect.value = plan.options[0].itemUid;
					itemSelect.disabled = true;
				} else {
					appendOption(itemSelect, {label: "Choose a specific item"});
					for (const option of plan.options) {
						appendOption(itemSelect, {
							value: option.itemUid,
							label: `${option.name} (${option.source})`,
						});
					}
					itemSelect.value = "";
					itemSelect.disabled = false;
				}
				const selected = getSelectedOption(rowState);
				attune.disabled = !selected?.requiresAttunement;
				if (attune.disabled) attune.checked = false;
				renderValidation();
			};
			planSelect.onChange(updatePlan);
			itemSelect.onChange(() => {
				const selected = getSelectedOption(rowState);
				attune.disabled = !selected?.requiresAttunement;
				if (attune.disabled) attune.checked = false;
				renderValidation();
			});
			attune.onChange(renderValidation);
		}
		renderValidation();

		return {
			section,
			rows,
			getRequest: () => ({
				selections: rows
					.filter(row => row.planSelect.value)
					.map(row => ({
						slotId: row.planSelect.value,
						resolvedItemUid: row.itemSelect.value || null,
						attune: !!row.attune.checked,
					})),
			}),
			getValidation: renderValidation,
			onChange: fn => { notifyChange = typeof fn === "function" ? fn : () => {}; },
		};
	}

	_commitEfaReplicateMagicItemProduction (production, {protectedInventoryItemIds = []} = {}) {
		if (!production) return null;
		const request = production.getRequest();
		const protectedIds = [...new Set(protectedInventoryItemIds.filter(Boolean))];
		return this._state.commitEfaReplicateMagicItemsAtLongRest({
			...request,
			...(protectedIds.length ? {protectedInventoryItemIds: protectedIds} : {}),
		});
	}

	_buildTemporalMasteryAgeSection () {
		const hasTemporalMastery = (this._state.getFeatures?.() || []).some(feature =>
			(feature?.name || "").trim().toLowerCase() === "temporal mastery"
			&& (feature?.source || feature?.subclassSource) === "TGTT",
		);
		if (!hasTemporalMastery) return null;

		let selected = 0;
		const section = e_({outer: `<fieldset class="charsheet__rest-section charsheet__temporal-choice-group">
			<legend class="charsheet__rest-section-title">Temporal Mastery — Age</legend>
			<p class="ve-muted ve-small mb-2">At the end of this Long Rest, you may become one year younger or older.</p>
			<label class="charsheet__temporal-choice"><input type="radio" name="temporal-rest-age" value="0" checked> <span><strong>No age change</strong><small>Keep your current age</small></span></label>
			<label class="charsheet__temporal-choice"><input type="radio" name="temporal-rest-age" value="-1"> <span><strong>1 year younger</strong><small>Reduce your age by one year</small></span></label>
			<label class="charsheet__temporal-choice"><input type="radio" name="temporal-rest-age" value="1"> <span><strong>1 year older</strong><small>Increase your age by one year</small></span></label>
			<label class="mt-2"><span class="ve-bold">Current age</span><input class="form-control input-xs mt-1" data-role="age" inputmode="numeric" type="number" min="1"></label>
			<div class="ve-small ve-muted mt-2" data-role="preview" aria-live="polite"></div>
		</fieldset>`});
		const ageInput = section.querySelector(`[data-role="age"]`);
		const preview = section.querySelector(`[data-role="preview"]`);
		const currentAge = this._state.getNumericAge?.();
		if (currentAge != null) ageInput.value = currentAge;
		let onChange = () => {};

		const getAge = () => {
			const value = Number(ageInput.value);
			return Number.isInteger(value) && value > 0 ? value : null;
		};
		const isValid = () => selected === 0 || (getAge() != null && getAge() + selected >= 1);
		const render = () => {
			const age = getAge();
			if (selected === 0) preview.textContent = age == null ? "No age change." : `Age remains ${age}.`;
			else if (age == null) preview.textContent = "Enter a valid current age to use this option.";
			else if (age + selected < 1) preview.textContent = "Age must remain at least 1 year.";
			else preview.textContent = `Age ${age} → ${age + selected}.`;
			preview.classList.toggle("text-danger", !isValid());
			onChange();
		};
		section.addEventListener("change", evt => {
			if (evt.target?.name === "temporal-rest-age") selected = Number(evt.target.value);
			render();
		});
		ageInput.addEventListener("input", render);
		render();

		return {
			section,
			isValid,
			onChange: fn => { onChange = fn; },
			apply: () => {
				if (selected === 0) return false;
				this._state.setAppearance("age", String(getAge()));
				const result = this._state.adjustAge(selected);
				return result.ok ? result.current : false;
			},
		};
	}

	_buildSpellMasteryLongRestSection () {
		if (!this._state.isXphbWizard?.()) return null;
		const selected = this._state.getSpellMasterySpells?.() || [];
		if (selected.length !== 2) return null;
		const section = e_({outer: `
			<div class="charsheet__rest-section">
				<div class="charsheet__rest-section-title">✨ Spell Mastery</div>
				<p class="ve-muted ve-small mb-2">You may replace one mastered spell with an eligible spell of the same level.</p>
			</div>
		`});
		const levelSelect = e_({tag: "select", clazz: "ve-form-control mb-2"});
		levelSelect.append(e_({tag: "option", val: "", txt: "Keep current mastered spells"}));
		selected.forEach(spell => levelSelect.append(e_({tag: "option", val: `${spell.level}`, txt: `Replace ${spell.name} (level ${spell.level})` })));
		const replacementSelect = e_({tag: "select", clazz: "ve-form-control"});
		replacementSelect.disabled = true;
		replacementSelect.append(e_({tag: "option", val: "", txt: "Choose a mastered spell first"}));
		levelSelect.addEventListener("change", () => {
			replacementSelect.innerHTML = "";
			const level = Number(levelSelect.value);
			if (!level) {
				replacementSelect.disabled = true;
				replacementSelect.append(e_({tag: "option", val: "", txt: "Choose a mastered spell first"}));
				return;
			}
			replacementSelect.disabled = false;
			replacementSelect.append(e_({tag: "option", val: "", txt: "Choose a replacement"}));
			for (const spell of this._state.getSpellMasteryCandidates(level)) {
				replacementSelect.append(e_({tag: "option", val: `${spell.name}|${spell.source}`, txt: `${spell.name} — ${spell.castingTime || "1 action"}`}));
			}
		});
		section.append(levelSelect, replacementSelect);
		return {
			section,
			apply: () => {
				const level = Number(levelSelect.value);
				if (!level || !replacementSelect.value) return false;
				const replacement = this._state.getSpellMasteryCandidates(level)
					.find(spell => `${spell.name}|${spell.source}` === replacementSelect.value);
				if (!replacement || !this._state.replaceSpellMasterySpell(level, replacement, {trigger: "longRest"})) return false;
				return replacement.name;
			},
		};
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

	_getEfaArmorModelOptions () {
		const expected = new Set(CharacterSheetRest._EFA_ARMOR_MODEL_NAMES);
		const optionsByName = new Map(
			(this._page?.getSubclassFeatures?.() || [])
				.filter(feature =>
					expected.has(feature?.name)
					&& feature.source === "EFA"
					&& feature.className === "Artificer"
					&& feature.classSource === "EFA"
					&& feature.subclassShortName === "Armorer"
					&& feature.subclassSource === "EFA"
					&& Number(feature.level) === 3)
				.map(feature => [feature.name, {
					...feature,
					ref: `${feature.name}|Artificer|EFA|Armorer|EFA|3|EFA`,
					type: "subclassFeature",
					refType: "subclassFeature",
				}]),
		);
		return CharacterSheetRest._EFA_ARMOR_MODEL_NAMES
			.map(name => optionsByName.get(name))
			.filter(Boolean);
	}

	_getEfaArmorModelSwitchContext ({reconcile = false, options = null} = {}) {
		const model = this._state.getEfaArmorerModel?.();
		if (!model) return null;

		const exactOptions = options || this._getEfaArmorModelOptions();
		const binding = this._state.getEfaArcaneArmorBindingStatus?.({reconcile}) || {};
		const boundName = binding.boundItem?.name || null;
		const isDoffed = !!binding.boundItemId && binding.boundItem?.equipped === false;
		let error = null;

		if (exactOptions.length !== CharacterSheetRest._EFA_ARMOR_MODEL_NAMES.length) {
			error = {
				code: "armor-model-data-unavailable",
				message: "Exact EFA Armor Model definitions are unavailable; reload the character data before switching.",
			};
		} else if (!binding.boundItemId || !binding.boundItem) {
			error = {
				code: "arcane-armor-not-bound",
				message: "Bind Arcane Armor to a body armor before switching Armor Model.",
			};
		} else if (!this._state.hasToolProficiency?.("Smith's Tools")) {
			error = {
				code: "missing-smiths-tools-proficiency",
				message: "Smith's Tools proficiency is required to switch Armor Model.",
			};
		} else if (!this._state.hasEfaSmithsToolsItem?.()) {
			error = {
				code: "missing-smiths-tools-item",
				message: "A canonical Smith's Tools item from PHB or XPHB must be in inventory.",
			};
		}

		const currentText = `Current model: ${model.name}. Arcane Armor: ${boundName ? `${boundName} (${isDoffed ? "doffed; binding persists" : "worn"})` : "not bound"}.`;
		const statusText = error?.message
			|| (isDoffed
				? `Switching is available while ${boundName} is doffed; model benefits resume when it is worn.`
				: "Choose the model to apply when this rest finishes.");

		return {
			model,
			binding,
			boundName,
			isDoffed,
			options: exactOptions,
			canSwitch: !error,
			error,
			currentText,
			statusText,
		};
	}

	_applyEfaArmorModelSelection ({selectedName, options = null} = {}) {
		const exactOptions = options || this._getEfaArmorModelOptions();
		const context = this._getEfaArmorModelSwitchContext({reconcile: true, options: exactOptions});
		if (!context) {
			return {
				changed: false,
				oldLabel: null,
				newLabel: null,
				boundName: null,
				error: {
					code: "efa-armorer-unavailable",
					message: "An exact Artificer|EFA Armorer with a canonical Armor Model is required.",
				},
			};
		}

		const oldLabel = context.model.name;
		const newOption = exactOptions.find(option => option.name === selectedName);
		if (!newOption) {
			return {
				changed: false,
				oldLabel,
				newLabel: oldLabel,
				boundName: context.boundName,
				error: {
					code: "armor-model-option-invalid",
					message: "Choose an exact EFA Armor Model option.",
				},
			};
		}
		if (newOption.name === oldLabel) {
			return {changed: false, oldLabel, newLabel: oldLabel, boundName: context.boundName, error: null};
		}
		if (!context.canSwitch) {
			return {changed: false, oldLabel, newLabel: oldLabel, boundName: context.boundName, error: context.error};
		}

		const history = (this._state.getLevelHistory?.() || []).find(entry =>
			entry.class?.name === "Artificer"
			&& entry.class?.source === "EFA"
			&& Number(entry.classLevel) === 3);
		const choices = history?.choices?.featureChoices || [];
		const choiceIndex = choices.findIndex(choice =>
			choice.featureName === "Armor Model"
			&& choice.source === "EFA"
			&& CharacterSheetRest._EFA_ARMOR_MODEL_NAMES.includes(choice.choice));
		const oldChoice = choiceIndex >= 0 ? choices[choiceIndex] : null;
		const decision = (history?.decisions || []).find(item =>
			item.type === "featureChoice"
			&& (item.sourceKey === "Armor Model" || item.label === "Armor Model"));
		const artificer = (this._state.getClasses?.() || []).find(cls =>
			cls.name === "Artificer"
			&& cls.source === "EFA"
			&& (cls.subclass?.shortName || cls.subclass?.name) === "Armorer"
			&& cls.subclass?.source === "EFA");

		if (!history || !oldChoice || !artificer) {
			return {
				changed: false,
				oldLabel,
				newLabel: oldLabel,
				boundName: context.boundName,
				error: {
					code: "armor-model-history-unavailable",
					message: "The canonical Armor Model history is unavailable; reload the character before switching.",
				},
			};
		}

		try {
			CharacterSheetClassUtils.replaceStructuredFeatureChoice({
				state: this._state,
				page: this._page,
				characterLevel: history.level,
				classLevel: 3,
				className: "Artificer",
				classSource: "EFA",
				subclassName: artificer.subclass?.name,
				subclassShortName: artificer.subclass?.shortName || artificer.subclass?.name,
				subclassSource: "EFA",
				parentFeature: "Armor Model",
				parentSource: "EFA",
				choiceIndex,
				oldChoice,
				newOption,
				catalogs: {
					classFeatures: this._page?.getClassFeatures?.() || [],
					subclassFeatures: this._page?.getSubclassFeatures?.() || [],
					optionalFeatures: this._page?.getOptionalFeatures?.() || [],
				},
				sourceDecisionKey: decision?.semanticKey || CharacterSheetProgression.getSemanticKey({
					className: "Artificer",
					classSource: "EFA",
					classLevel: 3,
					type: "featureChoice",
					sourceKey: "Armor Model",
					slot: 0,
				}),
				persistHistory: true,
				recalculate: true,
				syncCanonical: true,
			});
			this._state.reconcileEfaArmorerState?.({cause: "rest-model-switch"});
			return {changed: true, oldLabel, newLabel: newOption.name, boundName: context.boundName, error: null};
		} catch (error) {
			return {
				changed: false,
				oldLabel,
				newLabel: oldLabel,
				boundName: context.boundName,
				error: {
					code: "armor-model-transaction-failed",
					message: error?.message || "Armor Model could not be switched.",
				},
			};
		}
	}

	/**
	 * Build the staged EFA Armor Model selector shared by both rest dialogs.
	 * Opening or changing the selector is read-only; `apply()` revalidates and
	 * commits through the canonical structured-choice transaction.
	 * @param {{restType:"short"|"long"}} opts
	 * @returns {{section:HTMLElement, control:HTMLSelectElement, label:HTMLLabelElement, currentLine:HTMLElement, previewLine:HTMLElement, statusLine:HTMLElement, apply:function}|null}
	 */
	_buildEfaArmorModelSection ({restType} = {}) {
		const options = this._getEfaArmorModelOptions();
		const context = this._getEfaArmorModelSwitchContext({reconcile: false, options});
		if (!context) return null;

		const idBase = `charsheet-${restType || "rest"}-armor-model`;
		const selectId = `${idBase}-select`;
		const currentId = `${idBase}-current`;
		const previewId = `${idBase}-preview`;
		const statusId = `${idBase}-status`;

		const section = e_({tag: "div", clazz: "charsheet__rest-section"});
		const title = e_({tag: "div", clazz: "charsheet__rest-section-title", txt: "Armor Model"});
		const currentLine = e_({tag: "p", clazz: "ve-small mb-2", txt: context.currentText});
		currentLine.id = currentId;
		const label = e_({tag: "label", clazz: "ve-bold ve-small mb-1", txt: "Armor model after rest"});
		label.htmlFor = selectId;
		const control = e_({tag: "select", clazz: "form-control input-sm w-100"});
		control.id = selectId;
		control.setAttribute("aria-describedby", `${currentId} ${previewId} ${statusId}`);
		control.ariaDescribedBy = `${currentId} ${previewId} ${statusId}`;
		options.forEach(option => {
			const opt = e_({tag: "option", val: option.name, txt: option.name});
			opt.value = option.name;
			if (option.name === context.model.name) opt.selected = true;
			control.appendChild(opt);
		});
		control.value = context.model.name;
		control.disabled = !context.canSwitch;
		const previewLine = e_({tag: "p", clazz: "ve-small mt-1 mb-0"});
		previewLine.id = previewId;
		const updatePreview = () => {
			const preview = CharacterSheetRest._EFA_ARMOR_MODEL_PREVIEWS[control.value];
			previewLine.textContent = preview
				? `Selected model: ${control.value}. ${preview}.`
				: "Selected model preview unavailable.";
		};
		control.onChange(updatePreview);
		updatePreview();
		const statusLine = e_({tag: "p", clazz: "ve-muted ve-small mt-1 mb-0", txt: context.statusText});
		statusLine.id = statusId;

		section.append(title, currentLine, label, control, previewLine, statusLine);
		return {
			section,
			control,
			label,
			currentLine,
			previewLine,
			statusLine,
			apply: () => this._applyEfaArmorModelSelection({
				selectedName: control.value,
				options,
			}),
		};
	}

	static getEfaArmorModelRestFeedback (outcome) {
		if (outcome?.changed) {
			return {
				successSuffix: ` Armor Model changed from ${outcome.oldLabel} to ${outcome.newLabel} on ${outcome.boundName || "bound armor"}.`,
				warning: null,
			};
		}
		if (outcome?.error) {
			return {
				successSuffix: "",
				warning: `Rest completed, but Armor Model remained ${outcome.oldLabel || "unchanged"}: ${outcome.error.message}`,
			};
		}
		return {successSuffix: "", warning: null};
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
	 * Build the optional EFA Arcane Firearm carve/re-carve choice for Long Rest.
	 * The returned apply callback is the only UI path which changes the binding.
	 * @returns {{section: HTMLElement, apply: function}|null}
	 */
	_buildEfaArcaneFirearmLongRestSection () {
		const status = this._state.getEfaArcaneFirearmStatus?.();
		if (!status?.available) return null;

		const candidates = this._state.getEfaArcaneFirearmEligibleInventoryRows?.() || [];
		const currentId = status.binding?.inventoryItemId || null;
		const currentIsLegal = !!currentId && candidates.some(item => item.id === currentId);
		const section = e_({outer: `<div class="charsheet__rest-section charsheet__arcane-firearm-rest">
			<div class="charsheet__rest-section-title">🔥 Arcane Firearm</div>
			<p class="ve-muted ve-small mb-2">Optionally carve or re-carve one eligible inventory item when this Long Rest finishes.</p>
		</div>`});

		if (!candidates.length) {
			const empty = e_({
				tag: "div",
				clazz: "charsheet__arcane-firearm-rest-empty",
				txt: currentIsLegal
					? `${status.item?.name || "Your current Arcane Firearm"} remains carved.`
					: "No eligible rod, staff, wand, or martial ranged weapon is in your inventory. Add one before a future Long Rest to carve it.",
			});
			empty.setAttribute("role", "status");
			section.appendChild(empty);
			return {
				section,
				getSelectedItemId: () => null,
				apply: () => false,
			};
		}

		const selectId = "charsheet-rest-arcane-firearm-choice";
		const label = e_({
			tag: "label",
			clazz: "charsheet__arcane-firearm-rest-label",
			txt: "Item to carve",
		});
		label.setAttribute("for", selectId);
		const select = e_({
			tag: "select",
			clazz: "form-control input-sm charsheet__arcane-firearm-rest-select",
			id: selectId,
		});
		select.setAttribute("aria-label", "Arcane Firearm item to carve after this Long Rest");

		select.appendChild(e_({
			tag: "option",
			val: "__keep__",
			txt: currentIsLegal
				? `Keep Current — ${status.item?.name || "carved item"}`
				: "Do not carve an item",
		}));
		candidates.forEach(item => {
			select.appendChild(e_({
				tag: "option",
				val: item.id,
				txt: item.bindingLabel,
			}));
		});
		select.value = "__keep__";
		section.appendChild(label);
		section.appendChild(select);
		section.appendChild(e_({
			tag: "p",
			clazz: "ve-muted ve-small mt-1 mb-0",
			txt: "The item remains in inventory and may stay carved while unequipped, but it must be equipped to serve as a focus or add damage.",
		}));

		return {
			section,
			getSelectedItemId: () => {
				if (!select.value || select.value === "__keep__") return currentIsLegal ? currentId : null;
				return candidates.some(item => item.id === select.value) ? select.value : null;
			},
			apply: () => {
				if (!select.value || select.value === "__keep__") return false;
				const result = this._state.setEfaArcaneFirearmBinding?.(select.value);
				if (!result?.ok) throw new Error("The selected Arcane Firearm item is no longer eligible.");
				return result.binding?.lastKnownItem?.name || "the selected item";
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

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
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
			if (resource.gemstoneResource) return;
			if (restType === "short" && resource.shortRestRecovery) {
				this._state.setResourceCurrent(resource.id, Math.min(resource.max, resource.current + resource.shortRestRecovery));
			} else if (restType === "long" || resource.recharge === "short") {
				// Use state method to persist the change
				this._state.setResourceCurrent(resource.id, resource.max);
			}
		});

		// Also restore feature uses
		const features = this._state.getFeatures();
		features.forEach(feature => {
			if (feature.uses) {
				if (resources.some(resource => resource.mirrorsFeatureUses && resource.featureId === feature.id)) return;
				if (restType === "short" && feature.uses.shortRestRecovery) {
					this._state.setFeatureUses(feature.id, Math.min(feature.uses.max, feature.uses.current + feature.uses.shortRestRecovery));
				} else if (restType === "long" || feature.uses.recharge === "short") {
					// Use state method to persist the change
					this._state.setFeatureUses(feature.id, feature.uses.max);
				}
			}
		});
		if (restType === "short") this._state.restoreEfaFlashOfGeniusOnShortRest?.();
		this._state.applyFeatureCompanionRest?.(restType);

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
		this._state.restoreItemPowerUses?.(restType);

		// Show toast for restored item charges
		if (restoredItems.length > 0) {
			const itemList = restoredItems.map(i => `${i.name}: +${i.restored} (${i.total}/${i.max})`).join(", ");
			JqueryUtil.doToast({
				type: "info",
				content: `Item charges restored: ${itemList}`,
			});
		}

		// Remind players about choose-N spell immunities (Threefold Spellward, etc.)
		const spellwardItems = items.filter(it => {
			if (!it.spellImmunitySlots?.count) return false;
			if (!it.equipped) return false;
			if (it.requiresAttunement && !it.attuned) return false;
			return true;
		});
		if (spellwardItems.length) {
			if (restType === "long") {
				const labels = spellwardItems.map(it => it.spellImmunitySlots.label || it.name).join(", ");
				JqueryUtil.doToast({
					type: "info",
					content: `Re-choose spell immunities if desired (${labels}) — use the inventory 🛡 button.`,
				});
			} else if (restType === "short") {
				const swappable = spellwardItems.filter(it => Number(it.spellImmunitySlots.replaceOnShortRest) > 0);
				if (swappable.length) {
					const labels = swappable.map(it => {
						const n = Number(it.spellImmunitySlots.replaceOnShortRest) || 1;
						return `${it.name} (replace ${n})`;
					}).join(", ");
					JqueryUtil.doToast({
						type: "info",
						content: `You may replace a spell immunity: ${labels}.`,
					});
				}
			}
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

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
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

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
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
