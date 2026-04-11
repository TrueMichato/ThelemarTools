import {PartyTrackerCharacterSerializer} from "./dmscreen-partytracker-serial.js";

export class PartyTrackerCharacter {
	constructor (data, settings) {
		this._data = data;
		this._settings = settings;
	}

	get data () { return this._data; }
	set data (v) { this._data = v; }

	get settings () { return this._settings; }
	set settings (v) { this._settings = v; }

	/* -------------------------------------------- */
	//  Derived Calculations
	/* -------------------------------------------- */

	getTotalLevel () {
		return this._data.classes.reduce((sum, c) => sum + (c.level || 0), 0) || 1;
	}

	getProficiencyBonus () {
		if (this._data.overrides?.proficiencyBonus != null) return this._data.overrides.proficiencyBonus;
		return Math.floor((this.getTotalLevel() - 1) / 4) + 2;
	}

	getAbilityMod (ability) {
		const score = this._data.abilities?.[ability] ?? 10;
		return Math.floor((score - 10) / 2);
	}

	getSkillBonus (skill) {
		if (this._data.overrides?.skillBonuses?.[skill] != null) return this._data.overrides.skillBonuses[skill];
		const ability = PartyTrackerCharacterSerializer.SKILL_TO_ABILITY[skill];
		if (!ability) return 0;
		const mod = this.getAbilityMod(ability);
		const profLevel = this._data.skillProficiencies?.[skill] || 0;
		const profBonus = this.getProficiencyBonus();
		let bonus = mod + (profLevel * profBonus);
		if (skill === "linguistics" && this._settings?.enableTgtt && this._settings?.thelemar_linguisticsBonus) {
			bonus += this.getLinguisticsBonus();
		}
		bonus += this.getExhaustionD20Penalty();
		bonus += this._data.bonuses?.skills?.[skill] || 0;
		return bonus;
	}

	getSaveBonus (ability) {
		if (this._data.overrides?.saveBonuses?.[ability] != null) return this._data.overrides.saveBonuses[ability];
		const mod = this.getAbilityMod(ability);
		const hasProficiency = this._data.saveProficiencies?.[ability] || false;
		let bonus = mod + (hasProficiency ? this.getProficiencyBonus() : 0);
		bonus += this.getExhaustionD20Penalty();
		bonus += this._data.bonuses?.saves?.[ability] || 0;
		return bonus;
	}

	getPassiveScore (skill) {
		return 10 + this.getSkillBonus(skill) + (this._data.bonuses?.passives?.[skill] || 0);
	}

	getLinguisticsBonus () {
		const languages = this._data.languages || [];
		const nonCommon = languages.filter(l => l.toLowerCase() !== "common");
		return nonCommon.length;
	}

	getCarryCapacity () {
		if (this._data.overrides?.carryCapacity != null) return this._data.overrides.carryCapacity;
		if (this._settings?.enableTgtt && this._settings?.thelemar_carryWeight) {
			const mightMod = this.getSkillBonusRaw("might");
			return Math.max(50, 50 + 25 * mightMod);
		}
		return (this._data.abilities?.str ?? 10) * 15;
	}

	getSkillBonusRaw (skill) {
		const ability = PartyTrackerCharacterSerializer.SKILL_TO_ABILITY[skill];
		if (!ability) return 0;
		const mod = this.getAbilityMod(ability);
		const profLevel = this._data.skillProficiencies?.[skill] || 0;
		return mod + (profLevel * this.getProficiencyBonus());
	}

	getJumpDistances () {
		if (this._settings?.enableTgtt && this._settings?.thelemar_jumping) {
			const athleticsMod = this.getSkillBonusRaw("athletics");
			return {
				longRunning: 8 + athleticsMod,
				longStanding: Math.floor((8 + athleticsMod) / 2),
				highRunning: Math.floor(2 + athleticsMod * 0.5),
				highStanding: Math.floor((2 + athleticsMod * 0.5) / 2),
			};
		}
		const str = this._data.abilities?.str ?? 10;
		const strMod = this.getAbilityMod("str");
		return {
			longRunning: str,
			longStanding: Math.floor(str / 2),
			highRunning: 3 + strMod,
			highStanding: Math.floor((3 + strMod) / 2),
		};
	}

	getCombatMethodDc () {
		if (!this._settings?.enableTgtt) return null;
		if (this._data.overrides?.combatMethodDc != null) return this._data.overrides.combatMethodDc;
		const strMod = this.getAbilityMod("str");
		const dexMod = this.getAbilityMod("dex");
		return 8 + this.getProficiencyBonus() + Math.max(strMod, dexMod) + this.getExhaustionDcPenalty();
	}

	getStaminaMax () {
		if (!this._settings?.enableTgtt) return 0;
		return 2 * this.getProficiencyBonus();
	}

	getExhaustionD20Penalty () {
		const level = this._data.exhaustionLevel || 0;
		if (level === 0) return 0;
		const rules = this._settings?.exhaustionRules || "thelemar";
		if (rules === "thelemar" || rules === "2024") return -level;
		return 0;
	}

	getExhaustionDcPenalty () {
		const level = this._data.exhaustionLevel || 0;
		if (level === 0) return 0;
		const rules = this._settings?.exhaustionRules || "thelemar";
		if (rules === "thelemar") return -level;
		return 0;
	}

	getExhaustionSpeedPenalty () {
		const level = this._data.exhaustionLevel || 0;
		if (level === 0) return 0;
		const rules = this._settings?.exhaustionRules || "thelemar";
		if (rules === "2024") return -5 * level;
		return 0;
	}

	getMaxExhaustion () {
		const rules = this._settings?.exhaustionRules || "thelemar";
		return rules === "thelemar" ? 10 : 6;
	}

	/* -------------------------------------------- */
	//  UI Rendering
	/* -------------------------------------------- */

	render (eleParent, {onUpdate, onRemove, onSwap, getElesChildren, enableTgtt}) {
		this._onUpdate = onUpdate;
		this._isExpanded = false;
		this._enableTgtt = enableTgtt;

		// Kick off async data load (non-blocking)
		PartyTrackerCharacter.pLoadConditionDiseaseData().catch(() => {});

		this._eleRow = ee`<div class="ve-flex-col ve-w-100" role="listitem"></div>`;
		this._renderSummaryRow();
		this._eleRow.appendTo(eleParent);
		return this._eleRow;
	}

	get eleRow () { return this._eleRow; }

	_renderSummaryRow () {
		this._eleRow.empty();

		const totalLevel = this.getTotalLevel();
		const classStr = this._data.classes.map(c => `${c.name || "?"}${c.level ? ` ${c.level}` : ""}`).join("/");

		const btnExpand = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" title="${this._isExpanded ? "Collapse" : "Expand"} character details" aria-label="${this._isExpanded ? "Collapse" : "Expand"} ${this._data.name || "character"}" aria-expanded="${this._isExpanded}"><span class="glyphicon glyphicon-${this._isExpanded ? "minus" : "plus"}" aria-hidden="true"></span></button>`
			.onn("click", async () => {
				this._isExpanded = !this._isExpanded;
				if (this._isExpanded) {
					await PartyTrackerCharacter.pLoadConditionDiseaseData().catch(() => {});
					this._renderExpandedForm();
				} else {
					this._renderSummaryRow();
				}
			});

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs" title="Remove ${this._data.name || "character"}" aria-label="Remove ${this._data.name || "character"}"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button>`
			.onn("click", () => this._onRemove?.());

		const tgttInfo = this._enableTgtt?.()
			? ee`<span class="dm-party__char-tgtt-stat" title="Stamina Pool / Combat Method DC">St ${this.getStaminaMax()} · DC ${this.getCombatMethodDc() ?? "—"}</span>`
			: "";

		const wrpCondPills = ee`<span class="dm-party__conditions-summary"></span>`;
		for (const cond of (this._data.conditions || [])) {
			const color = Parser?.CONDITION_TO_COLOR?.[cond.name];
			const pill = ee`<span class="dm-party__condition-pill" style="${color ? `background: ${color}; color: #fff;` : ""}" title="${cond.name}">${cond.name}</span>`;
			if (cond.source || color) this._bindConditionDiseaseHover(pill, cond.name, cond.source);
			pill.appendTo(wrpCondPills);
		}
		for (const disease of (this._data.diseases || [])) {
			const pill = ee`<span class="dm-party__condition-pill dm-party__condition-pill--disease" title="${disease.name}">${disease.name}</span>`;
			if (disease.source) this._bindConditionDiseaseHover(pill, disease.name, disease.source);
			pill.appendTo(wrpCondPills);
		}

		ee`<div class="dm-party__char-row">
			${btnExpand}
			<span class="dm-party__char-name" title="${this._data.name || ""}">${this._data.name || "\u2014"}</span>
			<span class="dm-party__char-meta">${this._data.race || ""}</span>
			<span class="dm-party__char-meta">${classStr || "\u2014"}</span>
			<span class="dm-party__char-stat" title="Armor Class">\u{1F6E1} ${this._data.ac}</span>
			<span class="dm-party__char-stat" title="Passive Perception">\u{1F441} ${this.getPassiveScore("perception")}</span>
			<span class="dm-party__char-stat" title="Passive Investigation">\u{1F50D} ${this.getPassiveScore("investigation")}</span>
			<span class="dm-party__char-stat" title="Passive Insight">\u{1F4A1} ${this.getPassiveScore("insight")}</span>
			${wrpCondPills}
			${tgttInfo}
			<div class="ve-ml-auto">${btnRemove}</div>
		</div>`.appendTo(this._eleRow);
	}

	_renderExpandedForm () {
		this._eleRow.empty();

		const btnCollapse = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" title="Collapse" aria-label="Collapse ${this._data.name || "character"}" aria-expanded="true"><span class="glyphicon glyphicon-minus" aria-hidden="true"></span> Collapse</button>`
			.onn("click", () => {
				this._isExpanded = false;
				this._renderSummaryRow();
			});

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs" title="Remove ${this._data.name || "character"}" aria-label="Remove ${this._data.name || "character"}"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button>`
			.onn("click", () => this._onRemove?.());

		/* ----- Identity ----- */
		const iptName = this._makeInput("name", {placeholder: "Name", cls: "ve-bold", width: "130px", ariaLabel: "Character name"});
		const iptRace = this._makeInput("race", {placeholder: "Race / Species", width: "110px", ariaLabel: "Race or species"});

		/* ----- Classes ----- */
		const wrpClasses = ee`<div class="ve-flex-col ve-w-100"></div>`;
		this._renderClassRows(wrpClasses);

		const btnAddClass = ee`<button class="ve-btn ve-btn-primary ve-btn-xxs" aria-label="Add multiclass"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Class</button>`
			.onn("click", () => {
				this._data.classes.push({name: "", level: 1, source: null});
				this._renderClassRows(wrpClasses);
				this._doUpdate();
			});

		/* ----- Ability Scores ----- */
		const wrpAbilities = ee`<div class="dm-party__abilities-grid"></div>`;
		for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
			const mod = this.getAbilityMod(ability);
			const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
			const ipt = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 40px;" type="number" min="1" max="30" value="${this._data.abilities[ability]}" aria-label="${PartyTrackerCharacterSerializer.ABILITY_DISPLAY[ability]} score">`
				.onn("change", (e) => {
					this._data.abilities[ability] = Math.max(1, Math.min(30, Number(e.target.value) || 10));
					this._renderExpandedForm();
					this._doUpdate();
				});
			ee`<div class="dm-party__ability-cell">
				<span class="dm-party__ability-label">${PartyTrackerCharacterSerializer.ABILITY_DISPLAY[ability]}</span>
				${ipt}
				<span class="dm-party__ability-mod">${modStr}</span>
			</div>`.appendTo(wrpAbilities);
		}

		/* ----- AC, Exhaustion, Prof ----- */
		const iptAc = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 40px;" type="number" value="${this._data.ac}" aria-label="Armor Class">`
			.onn("change", (e) => { this._data.ac = Number(e.target.value) || 10; this._doUpdate(); });

		const maxExh = this.getMaxExhaustion();
		const iptExhaustion = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 40px;" type="number" min="0" max="${maxExh}" value="${this._data.exhaustionLevel}" aria-label="Exhaustion level">`
			.onn("change", (e) => {
				this._data.exhaustionLevel = Math.max(0, Math.min(maxExh, Number(e.target.value) || 0));
				this._renderExpandedForm();
				this._doUpdate();
			});

		const iptJourneyActions = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 40px;" type="number" min="1" max="4" value="${this._data.journeyActions ?? 1}" aria-label="Journey actions">`
			.onn("change", (e) => {
				this._data.journeyActions = Math.max(1, Math.min(4, Number(e.target.value) || 1));
				this._doUpdate();
			});

		/* ----- Save Proficiencies ----- */
		const wrpSaves = ee`<div class="dm-party__saves-grid"></div>`;
		for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
			const bonus = this.getSaveBonus(ability);
			const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;
			const cbx = ee`<input type="checkbox" ${this._data.saveProficiencies[ability] ? "checked" : ""} aria-label="${PartyTrackerCharacterSerializer.ABILITY_DISPLAY[ability]} saving throw proficiency">`
				.onn("change", (e) => {
					this._data.saveProficiencies[ability] = e.target.checked;
					this._renderExpandedForm();
					this._doUpdate();
				});

			const manualVal = this._data.bonuses?.saves?.[ability] || 0;
			const iptManual = ee`<input class="ve-form-control ve-input-xs ve-text-center dm-party__bonus-input" type="number" value="${manualVal}" title="Extra bonus to ${PartyTrackerCharacterSerializer.ABILITY_DISPLAY[ability]} save" aria-label="Extra ${PartyTrackerCharacterSerializer.ABILITY_DISPLAY[ability]} save bonus">`
				.onn("change", (e) => {
					if (!this._data.bonuses) this._data.bonuses = {skills: {}, saves: {}, passives: {}};
					if (!this._data.bonuses.saves) this._data.bonuses.saves = {};
					this._data.bonuses.saves[ability] = Number(e.target.value) || 0;
					this._renderExpandedForm();
					this._doUpdate();
				});

			ee`<label class="dm-party__save-item">
				${cbx}
				<span>${PartyTrackerCharacterSerializer.ABILITY_DISPLAY[ability]}</span>
				<span class="ve-muted">${bonusStr}</span>
				${iptManual}
			</label>`.appendTo(wrpSaves);
		}

		/* ----- Skill Proficiencies ----- */
		const wrpSkills = this._renderSkillGrid();

		/* ----- Speed & Senses ----- */
		const wrpSpeed = this._renderSpeedInputs();
		const wrpSenses = this._renderSensesInputs();
		const speedPenalty = this.getExhaustionSpeedPenalty();

		/* ----- TGTT: Combat Traditions ----- */
		let wrpTgtt = "";
		if (this._enableTgtt?.()) {
			wrpTgtt = this._renderTgttSection();
		}

		/* ----- Tools & Languages ----- */
		const iptTools = ee`<textarea class="ve-form-control ve-input-xs" rows="1" placeholder="Tool proficiencies (comma-sep)" aria-label="Tool proficiencies">${(this._data.toolProficiencies || []).join(", ")}</textarea>`
			.onn("change", (e) => {
				this._data.toolProficiencies = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
				this._doUpdate();
			});

		const iptLanguages = ee`<textarea class="ve-form-control ve-input-xs" rows="1" placeholder="Languages (comma-sep)" aria-label="Languages">${(this._data.languages || []).join(", ")}</textarea>`
			.onn("change", (e) => {
				this._data.languages = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
				this._renderExpandedForm();
				this._doUpdate();
			});

		/* ----- Notes ----- */
		const iptNotes = ee`<textarea class="ve-form-control ve-input-xs" rows="2" placeholder="Notes" aria-label="Character notes">${this._data.notes || ""}</textarea>`
			.onn("change", (e) => { this._data.notes = e.target.value; this._doUpdate(); });

		/* ----- Conditions, Diseases, Counters ----- */
		const wrpConditions = this._renderConditionsSection();
		const wrpDiseases = this._renderDiseasesSection();
		const wrpCounters = this._renderCountersSection();

		/* ----- Derived Stats ----- */
		const carry = this.getCarryCapacity();
		const jump = this.getJumpDistances();

		/* ----- Passives with bonus inputs ----- */
		const wrpPassives = ee`<div class="dm-party__passives-grid"></div>`;
		for (const [skill, icon, label] of [
			["perception", "\u{1F441}", "Perception"],
			["investigation", "\u{1F50D}", "Investigation"],
			["insight", "\u{1F4A1}", "Insight"],
		]) {
			const passive = this.getPassiveScore(skill);
			const manualVal = this._data.bonuses?.passives?.[skill] || 0;
			const iptManual = ee`<input class="ve-form-control ve-input-xs ve-text-center dm-party__bonus-input" type="number" value="${manualVal}" title="Extra bonus to passive ${label}" aria-label="Extra passive ${label} bonus">`
				.onn("change", (e) => {
					if (!this._data.bonuses) this._data.bonuses = {skills: {}, saves: {}, passives: {}};
					if (!this._data.bonuses.passives) this._data.bonuses.passives = {};
					this._data.bonuses.passives[skill] = Number(e.target.value) || 0;
					this._renderExpandedForm();
					this._doUpdate();
				});
			ee`<div class="dm-party__passive-item" title="Passive ${label}">
				<span class="dm-party__passive-icon">${icon}</span>
				<span class="dm-party__passive-label">${label}</span>
				<span class="dm-party__passive-value">${passive}</span>
				${iptManual}
			</div>`.appendTo(wrpPassives);
		}

		ee`<div class="dm-party__card">
			<div class="dm-party__card-header">
				${btnCollapse}
				${btnRemove}
			</div>

			<div class="dm-party__section">
				<div class="ve-flex ve-gap-2">${iptName}${iptRace}</div>
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Classes</div>
				${wrpClasses}
				${btnAddClass}
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Ability Scores</div>
				${wrpAbilities}
			</div>

			<div class="dm-party__stats-bar">
				<div class="dm-party__stat-group"><span class="dm-party__stat-label">AC</span>${iptAc}</div>
				<div class="dm-party__stat-group"><span class="dm-party__stat-label">Exhaustion</span>${iptExhaustion}<span class="ve-muted ve-small">/ ${maxExh}</span></div>
				<div class="dm-party__stat-group"><span class="dm-party__stat-label">Prof</span><span>+${this.getProficiencyBonus()}</span></div>
				<div class="dm-party__stat-group"><span class="dm-party__stat-label">Actions</span>${iptJourneyActions}</div>
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Saving Throws</div>
				${wrpSaves}
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Skills</div>
				${wrpSkills}
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Speed</div>
				${wrpSpeed}
				${speedPenalty ? ee`<span class="ve-muted ve-small">(Exhaustion: ${speedPenalty} ft)</span>` : ""}
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Senses</div>
				${wrpSenses}
			</div>

			${wrpTgtt}

			<div class="dm-party__section">
				<div class="dm-party__section-title">Tools</div>
				${iptTools}
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Languages</div>
				${iptLanguages}
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Passives</div>
				${wrpPassives}
			</div>

			${wrpConditions}
			${wrpDiseases}
			${wrpCounters}

			<div class="dm-party__derived-bar">
				<span title="Carrying Capacity">\u{1F3CB} Carry: ${carry} lb</span>
				<span title="Long Jump (running / standing)">\u{27A1} L.Jump: ${jump.longRunning}/${jump.longStanding} ft</span>
				<span title="High Jump (running / standing)">\u{2B06} H.Jump: ${jump.highRunning}/${jump.highStanding} ft</span>
			</div>

			<div class="dm-party__section">
				<div class="dm-party__section-title">Notes</div>
				${iptNotes}
			</div>
		</div>`.appendTo(this._eleRow);
	}

	/* -------------------------------------------- */
	//  Sub-renderers
	/* -------------------------------------------- */

	_renderClassRows (wrpClasses) {
		wrpClasses.empty();
		this._data.classes.forEach((cls, ix) => {
			const iptName = ee`<input class="ve-form-control ve-input-xs" style="width: 90px;" placeholder="Class" value="${cls.name || ""}" aria-label="Class name">`
				.onn("change", (e) => { cls.name = e.target.value; this._doUpdate(); });
			const iptLevel = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 38px;" type="number" min="1" max="20" value="${cls.level || 1}" aria-label="Class level">`
				.onn("change", (e) => {
					cls.level = Math.max(1, Math.min(20, Number(e.target.value) || 1));
					this._renderExpandedForm();
					this._doUpdate();
				});

			let selSource = "";
			if (this._enableTgtt?.()) {
				selSource = ee`<select class="ve-form-control ve-input-xs" style="width: 60px;" aria-label="Class source">
					<option value="" ${!cls.source ? "selected" : ""}>PHB</option>
					<option value="TGTT" ${cls.source === "TGTT" ? "selected" : ""}>TGTT</option>
				</select>`.onn("change", (e) => { cls.source = e.target.value || null; this._doUpdate(); });
			}

			const btnRemove = this._data.classes.length > 1
				? ee`<button class="ve-btn ve-btn-danger ve-btn-xxs" aria-label="Remove class"><span class="glyphicon glyphicon-minus" aria-hidden="true"></span></button>`
					.onn("click", () => {
						this._data.classes.splice(ix, 1);
						this._renderClassRows(wrpClasses);
						this._renderExpandedForm();
						this._doUpdate();
					})
				: "";

			ee`<div class="ve-flex-v-center ve-gap-1 ve-mb-1">${iptName}<span class="ve-small ve-muted">Lv</span>${iptLevel}${selSource}${btnRemove}</div>`.appendTo(wrpClasses);
		});
	}

	_renderSpeedInputs () {
		const wrp = ee`<div class="dm-party__speed-grid"></div>`;
		for (const type of ["walk", "fly", "swim", "climb", "burrow"]) {
			const ipt = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 40px;" type="number" min="0" value="${this._data.speed[type] || 0}" aria-label="${type} speed">`
				.onn("change", (e) => { this._data.speed[type] = Number(e.target.value) || 0; this._doUpdate(); });
			ee`<div class="dm-party__speed-item"><span class="dm-party__field-label">${type}</span>${ipt}</div>`.appendTo(wrp);
		}
		return wrp;
	}

	_renderSensesInputs () {
		const wrp = ee`<div class="dm-party__senses-grid"></div>`;
		for (const type of ["darkvision", "blindsight", "tremorsense", "truesight"]) {
			const ipt = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 40px;" type="number" min="0" value="${this._data.senses[type] || 0}" aria-label="${type} range">`
				.onn("change", (e) => { this._data.senses[type] = Number(e.target.value) || 0; this._doUpdate(); });
			ee`<div class="dm-party__sense-item"><span class="dm-party__field-label">${type}</span>${ipt}<span class="ve-muted">ft</span></div>`.appendTo(wrp);
		}
		return wrp;
	}

	_renderSkillGrid () {
		const wrp = ee`<div class="dm-party__skills-grid"></div>`;
		const skills = [...PartyTrackerCharacterSerializer.STANDARD_SKILLS];
		if (this._enableTgtt?.()) skills.push(...PartyTrackerCharacterSerializer.TGTT_SKILLS);

		for (const skill of skills) {
			const bonus = this.getSkillBonus(skill);
			const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;
			const displayName = PartyTrackerCharacterSerializer.SKILL_DISPLAY_NAMES[skill];
			const ability = PartyTrackerCharacterSerializer.SKILL_TO_ABILITY[skill];
			const isTgtt = PartyTrackerCharacterSerializer.TGTT_SKILLS.includes(skill);

			const sel = ee`<select class="ve-form-control ve-input-xs" style="width: 44px;" aria-label="${displayName} proficiency">
				<option value="0" ${this._data.skillProficiencies[skill] === 0 ? "selected" : ""}>\u2014</option>
				<option value="1" ${this._data.skillProficiencies[skill] === 1 ? "selected" : ""}>Prof</option>
				<option value="2" ${this._data.skillProficiencies[skill] === 2 ? "selected" : ""}>Exp</option>
			</select>`.onn("change", (e) => {
				this._data.skillProficiencies[skill] = Number(e.target.value); this._renderExpandedForm(); this._doUpdate();
			});

			const manualVal = this._data.bonuses?.skills?.[skill] || 0;
			const iptManual = ee`<input class="ve-form-control ve-input-xs ve-text-center dm-party__bonus-input" type="number" value="${manualVal}" title="Extra bonus to ${displayName}" aria-label="Extra ${displayName} bonus">`
				.onn("change", (e) => {
					if (!this._data.bonuses) this._data.bonuses = {skills: {}, saves: {}, passives: {}};
					if (!this._data.bonuses.skills) this._data.bonuses.skills = {};
					this._data.bonuses.skills[skill] = Number(e.target.value) || 0;
					this._renderExpandedForm();
					this._doUpdate();
				});

			ee`<div class="dm-party__skill-row">
				<span class="dm-party__skill-name ${isTgtt ? "dm-party__skill-name--tgtt" : ""}" title="${displayName} (${ability.toUpperCase()})">${displayName}</span>
				${sel}
				<span class="dm-party__skill-bonus ${bonus < 0 ? "dm-party__skill-bonus--negative" : ""}">${bonusStr}</span>
				${iptManual}
			</div>`.appendTo(wrp);
		}
		return wrp;
	}

	_renderTgttSection () {
		const wrp = ee`<div class="dm-party__tgtt-section">
			<span class="dm-party__tgtt-title">TGTT Combat</span>
		</div>`;

		/* Combat Method DC */
		const dc = this.getCombatMethodDc();
		ee`<div class="ve-flex-v-center ve-small ve-gap-3">
			<span>Combat Method DC: <strong>${dc ?? "\u2014"}</strong></span>
			<span class="ve-muted">Stamina Pool: <strong>${this.getStaminaMax()}</strong></span>
		</div>`.appendTo(wrp);

		/* Combat Traditions */
		const wrpTraditions = ee`<div class="dm-party__tgtt-traditions"></div>`;
		for (const [code, name] of Object.entries(PartyTrackerCharacterSerializer.COMBAT_TRADITIONS)) {
			const isSelected = (this._data.combatTraditions || []).includes(code);
			const btn = ee`<button class="ve-btn ve-btn-xxs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}" title="${name}" aria-label="${name}" aria-pressed="${isSelected}">${code}</button>`
				.onn("click", () => {
					if (!this._data.combatTraditions) this._data.combatTraditions = [];
					const ix = this._data.combatTraditions.indexOf(code);
					if (~ix) this._data.combatTraditions.splice(ix, 1);
					else this._data.combatTraditions.push(code);
					this._renderExpandedForm();
					this._doUpdate();
				});
			btn.appendTo(wrpTraditions);
		}
		wrpTraditions.appendTo(wrp);

		if (this._data.combatTraditions?.length) {
			const tradNames = this._data.combatTraditions.map(c => PartyTrackerCharacterSerializer.COMBAT_TRADITIONS[c] || c).join(", ");
			ee`<div class="ve-muted ve-small">${tradNames}</div>`.appendTo(wrp);
		}

		return wrp;
	}

	/* -------------------------------------------- */
	//  Conditions, Diseases & Counters
	/* -------------------------------------------- */

	static _conditionDiseaseCache = null;

	static async pLoadConditionDiseaseData () {
		if (PartyTrackerCharacter._conditionDiseaseCache) return PartyTrackerCharacter._conditionDiseaseCache;

		const allSite = await DataLoader.pCacheAndGetAllSite(UrlUtil.PG_CONDITIONS_DISEASES) || [];
		let allBrew = [];
		try { allBrew = await DataLoader.pCacheAndGetAllBrew(UrlUtil.PG_CONDITIONS_DISEASES) || []; } catch { /* no brew loaded */ }

		const conditions = [];
		const diseases = [];

		for (const ent of [...allSite, ...allBrew]) {
			if (ent.__prop === "condition" || ent.__prop === "status") conditions.push(ent);
			else if (ent.__prop === "disease") diseases.push(ent);
		}

		// Store all entities per name (multiple sources possible)
		const conditionsByName = new Map();
		for (const ent of conditions) {
			if (!conditionsByName.has(ent.name)) conditionsByName.set(ent.name, []);
			conditionsByName.get(ent.name).push(ent);
		}

		const diseasesByName = new Map();
		for (const ent of diseases) {
			if (!diseasesByName.has(ent.name)) diseasesByName.set(ent.name, []);
			diseasesByName.get(ent.name).push(ent);
		}

		// Full lookup by name+source for hover resolution
		const entityLookup = new Map();
		for (const ent of [...conditions, ...diseases]) {
			entityLookup.set(`${ent.name}|${ent.source}`.toLowerCase(), ent);
		}

		PartyTrackerCharacter._conditionDiseaseCache = {conditionsByName, diseasesByName, entityLookup};
		return PartyTrackerCharacter._conditionDiseaseCache;
	}

	/** Pick the best entity for a name given current settings. TGTT > XPHB > PHB > other. */
	_getBestEntity (entitiesByName, name) {
		const ents = entitiesByName?.get(name);
		if (!ents?.length) return null;
		if (ents.length === 1) return ents[0];

		const useTgtt = this._settings?.enableTgtt;
		let best = ents[0];
		let bestPri = -1;
		for (const ent of ents) {
			let pri = 0;
			if (ent.source === "TGTT" && useTgtt) pri = 4;
			else if (ent.source === "XPHB") pri = 3;
			else if (ent.source === "PHB") pri = 2;
			else pri = 1;
			if (pri > bestPri) { best = ent; bestPri = pri; }
		}
		return best;
	}

	/** Get deduplicated conditions map using current settings for source priority. */
	_getConditionMap () {
		const cache = PartyTrackerCharacter._conditionDiseaseCache;
		if (!cache?.conditionsByName) return new Map();
		const out = new Map();
		for (const [name, ents] of cache.conditionsByName) {
			out.set(name, this._getBestEntity(cache.conditionsByName, name) || ents[0]);
		}
		return out;
	}

	/** Get deduplicated diseases map using current settings for source priority. */
	_getDiseaseMap () {
		const cache = PartyTrackerCharacter._conditionDiseaseCache;
		if (!cache?.diseasesByName) return new Map();
		const out = new Map();
		for (const [name, ents] of cache.diseasesByName) {
			out.set(name, this._getBestEntity(cache.diseasesByName, name) || ents[0]);
		}
		return out;
	}

	_resolveEntitySource (name, storedSource) {
		const cache = PartyTrackerCharacter._conditionDiseaseCache;
		if (!cache) return storedSource;

		// If stored source is specific and exists, verify it
		if (storedSource) {
			const key = `${name}|${storedSource}`.toLowerCase();
			if (cache.entityLookup.has(key)) return storedSource;
		}

		// Use settings-aware best entity resolution
		const best = this._getBestEntity(cache.conditionsByName, name)
			|| this._getBestEntity(cache.diseasesByName, name);
		if (best) return best.source;

		return storedSource;
	}

	_bindConditionDiseaseHover (ele, name, source) {
		const resolvedSource = this._resolveEntitySource(name, source);
		if (!resolvedSource) return;
		const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CONDITIONS_DISEASES]({name, source: resolvedSource});
		ele.onn("mouseover", (evt) => {
			Renderer.hover.pHandleLinkMouseOver(evt, ele, {isSpecifiedLinkData: true, page: UrlUtil.PG_CONDITIONS_DISEASES, source: resolvedSource, hash}).then(null);
		});
		ele.onn("mousemove", (evt) => Renderer.hover.handleLinkMouseMove(evt, ele));
		ele.onn("mouseleave", (evt) => Renderer.hover.handleLinkMouseLeave(evt, ele));
	}

	_renderConditionsSection () {
		const cache = PartyTrackerCharacter._conditionDiseaseCache;
		const SKIP = new Set(["Exhausted", "Exhaustion"]);
		const wrpGrid = ee`<div class="dm-party__conditions-grid"></div>`;

		// Build from loaded data using settings-aware source priority
		const conditionMap = this._getConditionMap();
		const condEntries = conditionMap.size
			? [...conditionMap.values()].filter(ent => !SKIP.has(ent.name))
			: Object.keys(Parser.CONDITION_TO_COLOR).filter(n => !SKIP.has(n)).map(n => ({name: n, source: Parser.SRC_PHB}));

		// Sort: conditions with known colors first, then alphabetically
		condEntries.sort((a, b) => {
			const aHasColor = Parser.CONDITION_TO_COLOR?.[a.name] ? 0 : 1;
			const bHasColor = Parser.CONDITION_TO_COLOR?.[b.name] ? 0 : 1;
			return (aHasColor - bHasColor) || a.name.localeCompare(b.name);
		});

		for (const ent of condEntries) {
			const condName = ent.name;
			const condSource = ent.source;
			const color = Parser.CONDITION_TO_COLOR?.[condName];
			const isActive = (this._data.conditions || []).some(c => c.name === condName);
			const btn = ee`<button class="dm-party__condition-btn ${isActive ? "dm-party__condition-btn--active" : ""}" style="${isActive ? `background: ${color || "#6c757d"}; color: #fff; border-color: ${color || "#6c757d"};` : color ? `border-color: ${color}; color: ${color};` : ""}" title="${condName} (${condSource})" aria-label="${condName}" aria-pressed="${isActive}">${condName}</button>`;
			btn.onn("click", () => {
				if (!this._data.conditions) this._data.conditions = [];
				const ix = this._data.conditions.findIndex(c => c.name === condName);
				if (~ix) this._data.conditions.splice(ix, 1);
				else this._data.conditions.push({name: condName, source: condSource});
				this._renderExpandedForm();
				this._doUpdate();
			});
			this._bindConditionDiseaseHover(btn, condName, condSource);
			btn.appendTo(wrpGrid);
		}

		const wrpCustom = ee`<div class="dm-party__conditions-custom"></div>`;
		const knownNames = new Set(condEntries.map(e => e.name));
		const customConds = (this._data.conditions || []).filter(c => !knownNames.has(c.name));
		for (const cond of customConds) {
			const btnRm = ee`<button class="dm-party__pill-remove" aria-label="Remove ${cond.name}">\u00d7</button>`;
			btnRm.onn("click", () => {
				this._data.conditions = (this._data.conditions || []).filter(c => c.name !== cond.name);
				this._renderExpandedForm();
				this._doUpdate();
			});
			const pill = ee`<span class="dm-party__condition-pill dm-party__condition-pill--custom">${cond.name} ${btnRm}</span>`;
			if (cond.source) this._bindConditionDiseaseHover(pill, cond.name, cond.source);
			pill.appendTo(wrpCustom);
		}

		const iptCustom = ee`<input class="ve-form-control ve-input-xs" style="width: 110px;" placeholder="Custom..." aria-label="Custom condition">`;
		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xxs" aria-label="Add custom condition"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span></button>`;
		const fnAddCustom = () => {
			const val = iptCustom.val().trim();
			if (!val) return;
			if (!this._data.conditions) this._data.conditions = [];
			if (!this._data.conditions.some(c => c.name === val)) {
				this._data.conditions.push({name: val, source: null});
				this._renderExpandedForm();
				this._doUpdate();
			}
		};
		btnAdd.onn("click", fnAddCustom);
		iptCustom.onn("keydown", (e) => { if (e.key === "Enter") fnAddCustom(); });

		return ee`<div class="dm-party__section">
			<div class="dm-party__section-title">Conditions</div>
			${wrpGrid}
			${wrpCustom}
			<div class="ve-flex-v-center ve-gap-1 ve-mt-1">${iptCustom}${btnAdd}</div>
		</div>`;
	}

	_renderDiseasesSection () {
		const diseaseMap = this._getDiseaseMap();

		const wrpPills = ee`<div class="dm-party__diseases-list"></div>`;
		for (const disease of (this._data.diseases || [])) {
			const btnRm = ee`<button class="dm-party__pill-remove" aria-label="Remove ${disease.name}">\u00d7</button>`;
			btnRm.onn("click", () => {
				this._data.diseases = (this._data.diseases || []).filter(d => d.name !== disease.name);
				this._renderExpandedForm();
				this._doUpdate();
			});
			const pill = ee`<span class="dm-party__disease-pill">${disease.name} ${btnRm}</span>`;
			this._bindConditionDiseaseHover(pill, disease.name, disease.source);
			pill.appendTo(wrpPills);
		}

		// Disease picker — dropdown of known diseases + free-text
		const knownDiseases = diseaseMap.size ? [...diseaseMap.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
		const existingNames = new Set((this._data.diseases || []).map(d => d.name));

		let selDisease = "";
		if (knownDiseases.length) {
			selDisease = ee`<select class="ve-form-control ve-input-xs" style="width: 160px;" aria-label="Select disease">
				<option value="">— Select —</option>
				${knownDiseases.filter(d => !existingNames.has(d.name)).map(d => `<option value="${d.name.replace(/"/g, "&quot;")}" data-source="${d.source}">${d.name} (${d.source})</option>`).join("")}
			</select>`;
			selDisease.onn("change", (e) => {
				const name = e.target.value;
				if (!name) return;
				const ent = diseaseMap.get(name);
				if (!this._data.diseases) this._data.diseases = [];
				if (!this._data.diseases.some(d => d.name === name)) {
					this._data.diseases.push({name, source: ent?.source || null});
					this._renderExpandedForm();
					this._doUpdate();
				}
			});
		}

		const iptDisease = ee`<input class="ve-form-control ve-input-xs" style="width: 110px;" placeholder="Custom..." aria-label="Custom disease name">`;
		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xxs" aria-label="Add disease"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span></button>`;
		const fnAdd = () => {
			const val = iptDisease.val().trim();
			if (!val) return;
			if (!this._data.diseases) this._data.diseases = [];
			if (!this._data.diseases.some(d => d.name === val)) {
				// Check if it matches a known disease
				const known = diseaseMap.get(val);
				this._data.diseases.push({name: val, source: known?.source || null});
				this._renderExpandedForm();
				this._doUpdate();
			}
		};
		btnAdd.onn("click", fnAdd);
		iptDisease.onn("keydown", (e) => { if (e.key === "Enter") fnAdd(); });

		return ee`<div class="dm-party__section">
			<div class="dm-party__section-title">Diseases</div>
			${wrpPills}
			${selDisease ? ee`<div class="ve-flex-v-center ve-gap-1 ve-mb-1">${selDisease}</div>` : ""}
			<div class="ve-flex-v-center ve-gap-1">${iptDisease}${btnAdd}</div>
		</div>`;
	}

	_renderCountersSection () {
		const wrpCounters = ee`<div class="dm-party__counters-list"></div>`;
		if (!this._data.counters) this._data.counters = [];

		this._data.counters.forEach((counter, ix) => {
			const iptName = ee`<input class="ve-form-control ve-input-xs" style="width: 100px;" placeholder="Name" value="${counter.name || ""}" aria-label="Counter name">`
				.onn("change", (e) => { counter.name = e.target.value; this._doUpdate(); });
			const iptCurrent = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 36px;" type="number" min="0" value="${counter.current ?? 0}" aria-label="Current value">`
				.onn("change", (e) => { counter.current = Math.max(0, Number(e.target.value) || 0); this._doUpdate(); });
			const iptMax = ee`<input class="ve-form-control ve-input-xs ve-text-center" style="width: 36px;" type="number" min="0" value="${counter.max ?? 0}" aria-label="Maximum value">`
				.onn("change", (e) => { counter.max = Math.max(0, Number(e.target.value) || 0); this._doUpdate(); });
			const btnRm = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs" aria-label="Remove counter"><span class="glyphicon glyphicon-minus" aria-hidden="true"></span></button>`
				.onn("click", () => {
					this._data.counters.splice(ix, 1);
					this._renderExpandedForm();
					this._doUpdate();
				});
			ee`<div class="dm-party__counter-row">${iptName}${iptCurrent}<span class="ve-muted">/</span>${iptMax}${btnRm}</div>`.appendTo(wrpCounters);
		});

		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xxs" aria-label="Add counter"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Counter</button>`
			.onn("click", () => {
				this._data.counters.push({name: "", current: 0, max: 0});
				this._renderExpandedForm();
				this._doUpdate();
			});

		return ee`<div class="dm-party__section">
			<div class="dm-party__section-title">Counters</div>
			${wrpCounters}
			${btnAdd}
		</div>`;
	}

	/* -------------------------------------------- */
	//  Helpers
	/* -------------------------------------------- */

	_makeInput (prop, {placeholder = "", cls = "", width = "100px", ariaLabel = ""} = {}) {
		return ee`<input class="ve-form-control ve-input-xs ${cls}" style="width: ${width};" placeholder="${placeholder}" value="${this._data[prop] || ""}" ${ariaLabel ? `aria-label="${ariaLabel}"` : ""}>`
			.onn("change", (e) => {
				this._data[prop] = e.target.value;
				this._doUpdate();
			});
	}

	_doUpdate () {
		this._onUpdate?.();
	}

	set onRemove (fn) { this._onRemove = fn; }

	getSaveableData () { return this._data; }
}
