import {PartyTrackerCharacterSerializer} from "./dmscreen-partytracker-serial.js";
import {PartyTrackerCharacter} from "./dmscreen-partytracker-character.js";

export class PartyTrackerDcCalc {
	constructor ({getCharacters, getSettings}) {
		this._getCharacters = getCharacters;
		this._getSettings = getSettings;

		this._dc = 10;
		this._checkType = "skill";
		this._selectedSkillOrAbility = "perception";
		this._rollMode = "normal";
		this._groupCheckMode = false;
		this._ele = null;
		this._wrpResults = null;
	}

	render (eleParent) {
		this._ele = ee`<div class="ve-flex-col ve-w-100"></div>`;

		/* ----- Controls Bar ----- */
		const iptDc = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 45px;" type="number" min="1" max="40" value="${this._dc}" aria-label="Difficulty Class">`
			.onn("change", () => { this._dc = Math.max(1, Math.min(40, Number(iptDc.val()) || 10)); this._renderResults(); });

		const selCheckType = ee`<select class="ve-form-control ve-input-xs" style="width: 90px;" aria-label="Check type">
			<option value="skill" selected>Skill</option>
			<option value="save">Save</option>
			${this._getSettings().enableTgtt ? `<option value="combatDc">Vs Combat DC</option>` : ""}
		</select>`.onn("change", () => { this._checkType = selCheckType.val(); this._renderSkillSelector(); this._renderResults(); });

		this._wrpSkillSelector = ee`<div class="ve-flex-v-center"></div>`;
		this._renderSkillSelector();

		const selRollMode = ee`<select class="ve-form-control ve-input-xs" style="width: 70px;" aria-label="Roll mode">
			<option value="normal" selected>Normal</option>
			<option value="advantage">Adv</option>
			<option value="disadvantage">Dis</option>
		</select>`.onn("change", () => { this._rollMode = selRollMode.val(); this._renderResults(); });

		const cbxGroupCheck = ee`<input type="checkbox" ${this._groupCheckMode ? "checked" : ""} aria-label="Group check mode">`
			.onn("change", () => { this._groupCheckMode = cbxGroupCheck.prop("checked"); this._renderResults(); });

		ee`<div class="dm-party__dc-controls">
			<div class="dm-party__dc-control-group"><span class="dm-party__dc-label">DC</span>${iptDc}</div>
			<div class="dm-party__dc-control-group"><span class="dm-party__dc-label">Type</span>${selCheckType}</div>
			${this._wrpSkillSelector}
			<div class="dm-party__dc-control-group"><span class="dm-party__dc-label">Roll</span>${selRollMode}</div>
			<label class="dm-party__dc-control-group" style="cursor: pointer;"><span class="dm-party__dc-label">Group</span>${cbxGroupCheck}</label>
		</div>`.appendTo(this._ele);

		/* ----- Results ----- */
		this._wrpResults = ee`<div class="dm-party__dc-results" role="table" aria-label="DC success probabilities"></div>`;
		this._renderResults();
		this._wrpResults.appendTo(this._ele);

		this._ele.appendTo(eleParent);
	}

	refresh () {
		this._renderResults();
	}

	_renderSkillSelector () {
		if (!this._wrpSkillSelector) return;
		this._wrpSkillSelector.empty();

		if (this._checkType === "combatDc") {
			const iptTarget = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 40px;" type="number" placeholder="Save bonus" value="0">`
				.onn("change", () => { this._selectedSkillOrAbility = Number(iptTarget.val()) || 0; this._renderResults(); });
			this._selectedSkillOrAbility = 0;
			ee`<span class="ve-small ve-bold ve-mr-1">Target Save</span>`.appendTo(this._wrpSkillSelector);
			iptTarget.appendTo(this._wrpSkillSelector);
			return;
		}

		const options = [];
		if (this._checkType === "skill") {
			const skills = [...PartyTrackerCharacterSerializer.STANDARD_SKILLS];
			if (this._getSettings().enableTgtt) skills.push(...PartyTrackerCharacterSerializer.TGTT_SKILLS);
			for (const skill of skills) {
				const display = PartyTrackerCharacterSerializer.SKILL_DISPLAY_NAMES[skill];
				const ability = PartyTrackerCharacterSerializer.SKILL_TO_ABILITY[skill]?.toUpperCase();
				options.push({value: skill, label: `${display} (${ability})`});
			}
		} else {
			for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
				options.push({value: ability, label: PartyTrackerCharacterSerializer.ABILITY_DISPLAY[ability]});
			}
		}

		const sel = ee`<select class="ve-form-control ve-input-xs" style="width: 130px;">
			${options.map(o => `<option value="${o.value}" ${o.value === this._selectedSkillOrAbility ? "selected" : ""}>${o.label}</option>`).join("")}
		</select>`.onn("change", () => { this._selectedSkillOrAbility = sel.val(); this._renderResults(); });

		if (this._checkType === "skill" && !options.find(o => o.value === this._selectedSkillOrAbility)) {
			this._selectedSkillOrAbility = "perception";
		}
		if (this._checkType === "save" && !["str", "dex", "con", "int", "wis", "cha"].includes(this._selectedSkillOrAbility)) {
			this._selectedSkillOrAbility = "dex";
		}

		sel.appendTo(this._wrpSkillSelector);
	}

	_renderResults () {
		if (!this._wrpResults) return;
		this._wrpResults.empty();

		const characters = this._getCharacters();
		const settings = this._getSettings();

		if (!characters?.length) {
			ee`<div class="ve-muted ve-small ve-text-center ve-py-2">No characters added</div>`.appendTo(this._wrpResults);
			return;
		}

		const useTgttCrit = settings.enableTgtt && settings.thelemar_criticalRolls;

		/* ----- Headers ----- */
		if (this._checkType === "combatDc") {
			ee`<div class="dm-party__dc-row-header" role="row">
				<span class="dm-party__dc-col-name" role="columnheader">Name</span>
				<span class="dm-party__dc-col-bonus" role="columnheader">DC</span>
				<span class="dm-party__dc-col-pct" role="columnheader">Needs</span>
				<span class="dm-party__dc-bar-wrap" role="columnheader">Fail %</span>
			</div>`.appendTo(this._wrpResults);
		} else {
			ee`<div class="dm-party__dc-row-header" role="row">
				<span class="dm-party__dc-col-name" role="columnheader">Name</span>
				<span class="dm-party__dc-col-bonus" role="columnheader">Bonus</span>
				<span class="dm-party__dc-col-pct" role="columnheader">%</span>
				<span class="dm-party__dc-bar-wrap" role="columnheader">Chance</span>
			</div>`.appendTo(this._wrpResults);
		}

		/* ----- Per-character rows ----- */
		let succeedCount = 0;
		let totalPct = 0;
		const individualPcts = [];

		for (const charData of characters) {
			const calc = new PartyTrackerCharacter(charData, settings);

			if (this._checkType === "combatDc") {
				const dc = calc.getCombatMethodDc();
				if (dc == null) {
					ee`<div class="dm-party__dc-row" role="row">
						<span class="dm-party__dc-col-name">${charData.name || "?"}</span>
						<span class="ve-muted ve-small">No combat DC</span>
					</div>`.appendTo(this._wrpResults);
					continue;
				}
				const targetSaveBonus = typeof this._selectedSkillOrAbility === "number" ? this._selectedSkillOrAbility : 0;
				const targetNeeds = dc - targetSaveBonus;
				const failPct = this._calcSuccessPercent(dc, targetSaveBonus, useTgttCrit);
				const failPctDisplay = Math.round(failPct * 100);
				const barClass = failPctDisplay >= 75 ? "dm-party__dc-bar--success-fail" : failPctDisplay >= 50 ? "dm-party__dc-bar--success-low" : failPctDisplay >= 25 ? "dm-party__dc-bar--success-med" : "dm-party__dc-bar--success-high";

				ee`<div class="dm-party__dc-row" role="row">
					<span class="dm-party__dc-col-name">${charData.name || "?"}</span>
					<span class="dm-party__dc-col-bonus">${dc}</span>
					<span class="dm-party__dc-col-pct">${targetNeeds}+</span>
					<div class="dm-party__dc-bar-wrap">
						<div class="dm-party__dc-bar ${barClass}" style="width: ${failPctDisplay}%;"></div>
						<span class="ve-small">${failPctDisplay}%</span>
					</div>
				</div>`.appendTo(this._wrpResults);
				continue;
			}

			let bonus;
			if (this._checkType === "skill") {
				bonus = calc.getSkillBonus(this._selectedSkillOrAbility);
			} else {
				bonus = calc.getSaveBonus(this._selectedSkillOrAbility);
			}

			const pct = this._calcSuccessPercent(this._dc, bonus, useTgttCrit);
			const pctDisplay = Math.round(pct * 100);
			const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;
			if (pct >= 0.5) succeedCount++;
			totalPct += pct;
			individualPcts.push(pct);

			const barClass = pct >= 0.75 ? "dm-party__dc-bar--success-high" : pct >= 0.5 ? "dm-party__dc-bar--success-med" : pct >= 0.25 ? "dm-party__dc-bar--success-low" : "dm-party__dc-bar--success-fail";

			ee`<div class="dm-party__dc-row" role="row">
				<span class="dm-party__dc-col-name">${charData.name || "?"}</span>
				<span class="dm-party__dc-col-bonus">${bonusStr}</span>
				<span class="dm-party__dc-col-pct">${pctDisplay}%</span>
				<div class="dm-party__dc-bar-wrap">
					<div class="dm-party__dc-bar ${barClass}" style="width: ${pctDisplay}%;"></div>
				</div>
			</div>`.appendTo(this._wrpResults);
		}

		if (this._checkType !== "combatDc" && characters.length) {
			if (this._groupCheckMode && individualPcts.length >= 2) {
				this._renderGroupCheckSummary(individualPcts, useTgttCrit);
			} else {
				const avgPct = Math.round((totalPct / characters.length) * 100);
				const tgttLabel = useTgttCrit ? ` (Thelemar)` : "";
				ee`<div class="dm-party__dc-row-summary" role="row">
					<span class="dm-party__dc-col-name">Summary</span>
					<span class="dm-party__dc-col-bonus"></span>
					<span class="dm-party__dc-col-pct">${avgPct}%</span>
					<span class="dm-party__dc-bar-wrap">${succeedCount}/${characters.length} likely succeed (\u226550%)${tgttLabel}</span>
				</div>`.appendTo(this._wrpResults);
			}
		}
	}

	/* -------------------------------------------- */
	//  Group Check
	/* -------------------------------------------- */

	/**
	 * Calculate group check probabilities using dynamic programming.
	 * Group check passes if >= ceil(N/2) of N characters succeed.
	 * @param {number[]} probs - Array of individual success probabilities [0..1]
	 * @returns {{pPass: number, pAllPass: number, pAllFail: number}}
	 */
	_calcGroupCheckProbabilities (probs) {
		const n = probs.length;
		const threshold = Math.ceil(n / 2);

		// dp[j] = probability that exactly j characters have succeeded so far
		let dp = new Array(n + 1).fill(0);
		dp[0] = 1;
		for (let i = 0; i < n; i++) {
			const p = probs[i];
			const next = new Array(n + 1).fill(0);
			for (let j = 0; j <= i; j++) {
				if (dp[j] === 0) continue;
				next[j + 1] += dp[j] * p;        // character i succeeds
				next[j] += dp[j] * (1 - p);       // character i fails
			}
			dp = next;
		}

		let pPass = 0;
		for (let j = threshold; j <= n; j++) pPass += dp[j];
		const pAllPass = dp[n];
		const pAllFail = dp[0];

		return {pPass, pAllPass, pAllFail};
	}

	_renderGroupCheckSummary (individualPcts, useTgttCrit) {
		const {pPass, pAllPass, pAllFail} = this._calcGroupCheckProbabilities(individualPcts);
		const n = individualPcts.length;
		const threshold = Math.ceil(n / 2);
		const passPctDisplay = Math.round(pPass * 100);
		const allPassDisplay = Math.round(pAllPass * 100);
		const allFailDisplay = Math.round(pAllFail * 100);

		const passBarClass = pPass >= 0.75 ? "dm-party__dc-bar--success-high" : pPass >= 0.5 ? "dm-party__dc-bar--success-med" : pPass >= 0.25 ? "dm-party__dc-bar--success-low" : "dm-party__dc-bar--success-fail";

		const tgttLabel = useTgttCrit ? " (Thelemar)" : "";

		ee`<div class="dm-party__dc-group-result">
			<div class="dm-party__dc-group-row dm-party__dc-group-row--main">
				<span class="dm-party__dc-group-label">Group Check (\u2265${threshold}/${n} pass)</span>
				<span class="dm-party__dc-group-pct ${passPctDisplay >= 50 ? "dm-party__dc-group-pct--pass" : "dm-party__dc-group-pct--fail"}">${passPctDisplay}%</span>
				<div class="dm-party__dc-bar-wrap">
					<div class="dm-party__dc-bar ${passBarClass}" style="width: ${passPctDisplay}%;"></div>
				</div>
			</div>
			<div class="dm-party__dc-group-row dm-party__dc-group-row--detail">
				<span class="dm-party__dc-group-crit dm-party__dc-group-crit--pass" title="All ${n} characters pass">\u2728 Crit Pass: ${allPassDisplay}%</span>
				<span class="dm-party__dc-group-crit dm-party__dc-group-crit--fail" title="All ${n} characters fail">\u{1F480} Crit Fail: ${allFailDisplay}%</span>
				${tgttLabel ? ee`<span class="ve-muted ve-small">${tgttLabel}</span>` : ""}
			</div>
		</div>`.appendTo(this._wrpResults);
	}

	/* -------------------------------------------- */
	//  Probability Math
	/* -------------------------------------------- */

	_calcSuccessPercent (dc, bonus, useTgttCrit = false) {
		if (this._rollMode === "normal") {
			return this._calcSuccessNormal(dc, bonus, useTgttCrit);
		} else if (this._rollMode === "advantage") {
			return this._calcSuccessAdvantage(dc, bonus, useTgttCrit);
		} else {
			return this._calcSuccessDisadvantage(dc, bonus, useTgttCrit);
		}
	}

	_calcSuccessNormal (dc, bonus, useTgttCrit) {
		if (useTgttCrit) return this._calcFaceByFace(dc, bonus, 1);

		const target = dc - bonus;
		if (target <= 1) return 0.95;
		if (target >= 21) return 0.05;
		return Math.max(0.05, Math.min(0.95, (21 - target) / 20));
	}

	_calcSuccessAdvantage (dc, bonus, useTgttCrit) {
		if (useTgttCrit) return this._calcFaceByFace(dc, bonus, 2);

		const failSingle = 1 - this._calcSuccessNormal(dc, bonus, false);
		return Math.max(0.05, Math.min(0.95, 1 - failSingle * failSingle));
	}

	_calcSuccessDisadvantage (dc, bonus, useTgttCrit) {
		if (useTgttCrit) return this._calcFaceByFace(dc, bonus, 3);

		const successSingle = this._calcSuccessNormal(dc, bonus, false);
		return Math.max(0.05, Math.min(0.95, successSingle * successSingle));
	}

	/**
	 * Face-by-face calculation for Thelemar critical roll rules.
	 * Nat 1: effective = face - 5 + bonus = -4 + bonus
	 * Nat 20: effective = face + 5 + bonus = 25 + bonus
	 * Others: effective = face + bonus
	 * @param {number} dc - Difficulty class
	 * @param {number} bonus - Total modifier
	 * @param {number} mode - 1=normal, 2=advantage, 3=disadvantage
	 */
	_calcFaceByFace (dc, bonus, mode) {
		let successes = 0;
		const total = mode === 1 ? 20 : 400;

		if (mode === 1) {
			for (let face = 1; face <= 20; face++) {
				const effective = face + bonus + (face === 1 ? -5 : face === 20 ? 5 : 0);
				if (effective >= dc) successes++;
			}
		} else if (mode === 2) {
			for (let f1 = 1; f1 <= 20; f1++) {
				for (let f2 = 1; f2 <= 20; f2++) {
					const best = Math.max(f1, f2);
					const worstFace = Math.min(f1, f2);
					const effective = best + bonus + (best === 1 ? -5 : best === 20 ? 5 : 0);
					if (effective >= dc) successes++;
				}
			}
		} else {
			for (let f1 = 1; f1 <= 20; f1++) {
				for (let f2 = 1; f2 <= 20; f2++) {
					const worst = Math.min(f1, f2);
					const effective = worst + bonus + (worst === 1 ? -5 : worst === 20 ? 5 : 0);
					if (effective >= dc) successes++;
				}
			}
		}

		return successes / total;
	}
}
