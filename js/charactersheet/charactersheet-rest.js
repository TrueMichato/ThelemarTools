/**
 * Character Sheet Rest Handler
 * Manages short rest, long rest, and recovery mechanics
 */
class CharacterSheetRest {
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

		if (currentHp >= maxHp && !availableHitDice.length && !conditions.length && !isConcentrating) {
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
		const hasSlotRecovery = calc.hasArcaneRecovery || calc.hasNaturalRecovery;
		let slotRecoverySelections = {}; // {level: amount}
		let slotRecoveryMaxLevels = 0;
		let slotRecoveryFeatureName = "";

		if (hasSlotRecovery) {
			slotRecoveryMaxLevels = calc.hasArcaneRecovery
				? calc.arcaneRecoverySlotLevels
				: calc.naturalRecoverySlots;
			slotRecoveryFeatureName = calc.hasArcaneRecovery ? "Arcane Recovery" : "Natural Recovery";

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
					const total = Object.values(slotRecoverySelections).reduce((sum, v) => sum + v, 0);
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

		const btnConfirm = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "✓ Finish Short Rest"});
		btnConfirm.onClick(() => {
				// Apply hit dice spending using spentDice tracker
				Object.entries(spentDice).forEach(([dieType, count]) => {
					for (let i = 0; i < count; i++) {
						this._state.useHitDie(dieType);
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

				this._page.saveCharacter();
				this._page.renderCharacter();
				doClose(true);

				let message = `😴 Short rest complete!`;
				if (totalHealing > 0) message += ` Recovered ${totalHealing} HP.`;
				if (slotsRecovered > 0) message += ` Recovered ${slotsRecovered} spell slot(s) via ${slotRecoveryFeatureName}.`;
				if (spRecovered > 0) message += ` Recovered ${spRecovered} sorcery point(s).`;
				if (conditionsToRemove.size > 0) message += ` Removed ${conditionsToRemove.size} condition(s).`;
				if (shouldBreakConcentration) message += ` Broke concentration.`;

				JqueryUtil.doToast({
					type: "success",
					content: message,
				});
		});

		ee`<div class="charsheet__modal-footer">
			${btnCancel}
			${btnConfirm}
		</div>`.appendTo(modalInner);
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
		const btnConfirm = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "🌙 Finish Long Rest"});
		btnConfirm.onClick(() => {
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

				// Save changes
				this._page.saveCharacter();
				this._page.renderCharacter();

				doClose(true);

				let message = "🌙 Long rest complete! All resources restored.";
				if (conditionsToRemove.size > 0) message += ` Removed ${conditionsToRemove.size} condition(s).`;
				if (cbBreakConcentration?.checked) message += ` Broke concentration.`;

				JqueryUtil.doToast({
					type: "success",
					content: message,
				});

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

		// Restore Focus Pool (TGTT Dreamwalker) - only on long rest
		if (restType === "long" && this._state.hasFocusPool?.()) {
			this._state.restoreFocusPool?.();
		}

		// Restore item charges
		const items = this._state.getItems();
		const restoredItems = [];
		items.forEach(item => {
			if (item.charges && item.recharge) {
				let shouldRestore = false;
				// Map recharge types to rest types
				if (restType === "long") {
					// Long rest restores items that recharge on long rest, dawn, dusk, or midnight
					shouldRestore = ["restLong", "dawn", "dusk", "midnight"].includes(item.recharge);
				} else if (restType === "short") {
					// Short rest only restores items that recharge on short rest
					shouldRestore = item.recharge === "restShort";
				}

				if (shouldRestore) {
					const currentCharges = item.chargesCurrent ?? 0;
					// Only restore if not already at max
					if (currentCharges < item.charges) {
						// Parse rechargeAmount - could be a dice expression like "{@dice 1d6 + 1}" or a number
						let rechargeAmount = item.charges; // Default to full restore
						if (item.rechargeAmount) {
							if (typeof item.rechargeAmount === "number") {
								rechargeAmount = item.rechargeAmount;
							} else if (typeof item.rechargeAmount === "string") {
								// Strip {@dice ...} wrapper if present
								let diceStr = item.rechargeAmount.replace(/\{@dice\s*([^}]+)\}/i, "$1").trim();
								// Parse dice notation like "1d6 + 1", "1d6+1", "2d8-2"
								const diceMatch = diceStr.match(/(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?/i);
								if (diceMatch) {
									const numDice = parseInt(diceMatch[1]);
									const dieSize = parseInt(diceMatch[2]);
									const sign = diceMatch[3] === "-" ? -1 : 1;
									const modifier = (parseInt(diceMatch[4]) || 0) * sign;
									// Roll the dice using RollerUtil if available
									let total = modifier;
									for (let i = 0; i < numDice; i++) {
										total += (typeof RollerUtil !== "undefined" && RollerUtil.randomise)
											? RollerUtil.randomise(dieSize)
											: Math.floor(Math.random() * dieSize) + 1;
									}
									rechargeAmount = Math.max(0, total);
								} else {
									// Try parsing as a plain number
									rechargeAmount = parseInt(item.rechargeAmount) || item.charges;
								}
							}
						}

						const newCharges = Math.min(currentCharges + rechargeAmount, item.charges);
						this._state.setItemCharges(item.id, newCharges);
						restoredItems.push({name: item.name, restored: newCharges - currentCharges, total: newCharges, max: item.charges});
					}
				}
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
}

globalThis.CharacterSheetRest = CharacterSheetRest;

export {CharacterSheetRest};
