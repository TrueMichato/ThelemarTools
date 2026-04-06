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

	getExertionMax () {
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
			.onn("click", () => {
				this._isExpanded = !this._isExpanded;
				if (this._isExpanded) this._renderExpandedForm();
				else this._renderSummaryRow();
			});

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs" title="Remove ${this._data.name || "character"}" aria-label="Remove ${this._data.name || "character"}"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button>`
			.onn("click", () => this._onRemove?.());

		const tgttInfo = this._enableTgtt?.()
			? ee`<span class="dm-party__char-tgtt-stat" title="Exertion Pool / Combat Method DC">Ex ${this.getExertionMax()} · DC ${this.getCombatMethodDc() ?? "—"}</span>`
			: "";

		ee`<div class="dm-party__char-row">
			${btnExpand}
			<span class="dm-party__char-name" title="${this._data.name || ""}">${this._data.name || "\u2014"}</span>
			<span class="dm-party__char-meta">${this._data.race || ""}</span>
			<span class="dm-party__char-meta">${classStr || "\u2014"}</span>
			<span class="dm-party__char-stat" title="Armor Class">\u{1F6E1} ${this._data.ac}</span>
			<span class="dm-party__char-stat" title="Passive Perception">\u{1F441} ${this.getPassiveScore("perception")}</span>
			<span class="dm-party__char-stat" title="Passive Investigation">\u{1F50D} ${this.getPassiveScore("investigation")}</span>
			<span class="dm-party__char-stat" title="Passive Insight">\u{1F4A1} ${this.getPassiveScore("insight")}</span>
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
			<span class="ve-muted">Exertion Pool: <strong>${this.getExertionMax()}</strong></span>
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
