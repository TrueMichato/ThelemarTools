/**
 * Character Sheet PDF Renderer
 * Generates a self-contained, print-optimized HTML document from CharacterSheetState data.
 * Opens in a new browser window for printing or "Save as PDF".
 *
 * Visual style: Official 5e character sheet inspired — shield AC, rounded ability boxes,
 * death save circles, labeled header row, maroon+gold palette, Georgia serif headings.
 *
 * Page structure:
 *   Page 1 — Quick reference: abilities, saves, skills, combat, attacks, conditions
 *   Page 2+ — Features (compact summaries), spellcasting, inventory, TGTT
 *   Final pages — Detailed feature descriptions appendix
 *
 * TGTT/Thelemar sections render conditionally when relevant data is present.
 */

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};
const ABILITY_ABBR = {str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA"};

const SKILLS = [
	{name: "Acrobatics", ability: "dex"},
	{name: "Animal Handling", ability: "wis"},
	{name: "Arcana", ability: "int"},
	{name: "Athletics", ability: "str"},
	{name: "Deception", ability: "cha"},
	{name: "History", ability: "int"},
	{name: "Insight", ability: "wis"},
	{name: "Intimidation", ability: "cha"},
	{name: "Investigation", ability: "int"},
	{name: "Medicine", ability: "wis"},
	{name: "Nature", ability: "int"},
	{name: "Perception", ability: "wis"},
	{name: "Performance", ability: "cha"},
	{name: "Persuasion", ability: "cha"},
	{name: "Religion", ability: "int"},
	{name: "Sleight of Hand", ability: "dex"},
	{name: "Stealth", ability: "dex"},
	{name: "Survival", ability: "wis"},
];

const PASSIVE_SKILLS = new Set(["perception", "investigation", "insight"]);

const SPELL_SCHOOL_LABELS = {A: "Abjuration", C: "Conjuration", D: "Divination", E: "Enchantment", V: "Evocation", I: "Illusion", N: "Necromancy", T: "Transmutation"};

class CharacterSheetPdf {
	constructor (state, opts = {}) {
		this._state = state;
		this._skillsList = opts.skillsList || [];
	}

	// region Public API

	/**
	 * Generate a complete, self-contained HTML document string for the character sheet PDF.
	 * @returns {string} Full HTML document ready for `document.write()` in a new window.
	 */
	generate () {
		// ---- Page 1: Quick Reference ----
		const sections = [
			this._renderHeader(),
			`<div class="pdf-page pdf-page--stats">`,
			`<div class="pdf-col pdf-col--abilities">`,
			this._renderAbilityScores(),
			`</div>`,
			`<div class="pdf-col pdf-col--center">`,
			this._renderProficiencyBox(),
			this._renderSavingThrows(),
			this._renderSkills(),
			`</div>`,
			`<div class="pdf-col pdf-col--right">`,
			this._renderCombatStats(),
			this._renderAttacks(),
			`</div>`,
			`</div>`, // close pdf-page--stats
			this._renderActions(),
			this._renderPageOneFooter(),
		];

		// ---- Page 2+: Features (compact), Spellcasting, Inventory, TGTT ----
		const featuresHtml = this._renderFeatures();
		if (featuresHtml) sections.push(`<div class="pdf-page-break"></div>`, featuresHtml);

		const spellsHtml = this._renderSpellcasting();
		if (spellsHtml) sections.push(spellsHtml);

		const inventoryHtml = this._renderInventory();
		if (inventoryHtml) sections.push(inventoryHtml);

		const tgttHtml = this._renderTgttSections();
		if (tgttHtml) sections.push(tgttHtml);

		// Companions (separate page)
		const companionsHtml = this._renderCompanions();
		if (companionsHtml) sections.push(`<div class="pdf-page-break"></div>`, companionsHtml);

		// ---- Final Pages: Detailed Feature Appendix ----
		const detailsHtml = this._renderFeatureDetails();
		if (detailsHtml) sections.push(`<div class="pdf-page-break"></div>`, detailsHtml);

		return this._wrapDocument(sections.join("\n"));
	}

	// endregion

	// region Header

	_renderHeader () {
		const name = this._esc(this._state.getName() || "Unnamed Character");
		const classes = this._state.getClasses() || [];
		const classStr = classes.map(c => {
			const subName = c.subclass?.name ?? (typeof c.subclass === "string" ? c.subclass : null);
			const sub = subName ? ` (${this._esc(subName)})` : "";
			return `${this._esc(c.name)}${sub} ${c.level}`;
		}).join(" / ") || "No Class";

		const raceName = this._esc(this._state.getRaceName() || "Unknown");
		const bgName = this._esc(this._state.getBackgroundName() || "None");
		const alignment = this._esc(this._state.getAlignment() || "\u2014");
		const totalLevel = this._state.getTotalLevel();
		const xp = this._state.getXp();
		const inspiration = this._state.hasInspiration?.();

		return `<div class="pdf-header">
			<div class="pdf-header__top">
				<div class="pdf-header__name-block">
					<div class="pdf-header__name">${name}</div>
					<div class="pdf-header__name-label">Character Name</div>
				</div>
				${inspiration ? `<div class="pdf-header__inspiration" title="Inspiration">\u2605</div>` : ""}
			</div>
			<div class="pdf-header__fields">
				<div class="pdf-header__field">
					<div class="pdf-header__field-value">${classStr}</div>
					<div class="pdf-header__field-label">Class & Level</div>
				</div>
				<div class="pdf-header__field">
					<div class="pdf-header__field-value">${raceName}</div>
					<div class="pdf-header__field-label">Race</div>
				</div>
				<div class="pdf-header__field">
					<div class="pdf-header__field-value">${bgName}</div>
					<div class="pdf-header__field-label">Background</div>
				</div>
				<div class="pdf-header__field">
					<div class="pdf-header__field-value">${alignment}</div>
					<div class="pdf-header__field-label">Alignment</div>
				</div>
				<div class="pdf-header__field pdf-header__field--small">
					<div class="pdf-header__field-value">${totalLevel}</div>
					<div class="pdf-header__field-label">Level</div>
				</div>
				<div class="pdf-header__field pdf-header__field--small">
					<div class="pdf-header__field-value">${xp.toLocaleString()}</div>
					<div class="pdf-header__field-label">XP</div>
				</div>
			</div>
		</div>`;
	}

	// endregion

	// region Ability Scores

	_renderAbilityScores () {
		const boxes = ABILITIES.map(ab => {
			const score = this._state.getAbilityScore(ab);
			const mod = this._state.getAbilityMod(ab);
			return `<div class="pdf-ability">
				<div class="pdf-ability__label">${ABILITY_ABBR[ab]}</div>
				<div class="pdf-ability__mod">${this._fmtMod(mod)}</div>
				<div class="pdf-ability__score-circle">${score}</div>
			</div>`;
		}).join("\n");

		return `<div class="pdf-section pdf-section--abilities">${boxes}</div>`;
	}

	// endregion

	// region Proficiency Bonus Box

	_renderProficiencyBox () {
		const profBonus = this._fmtMod(this._state.getProficiencyBonus());
		return `<div class="pdf-prof-box">
			<span class="pdf-prof-box__value">${profBonus}</span>
			<span class="pdf-prof-box__label">Proficiency Bonus</span>
		</div>`;
	}

	// endregion

	// region Combat Stats

	_renderCombatStats () {
		const ac = this._state.getAc();
		const hp = this._state.getHp();
		const initiative = this._state.getInitiative();
		const hitDice = this._state.getHitDice();
		const hitDiceStr = hitDice.map(hd => `${hd.current}/${hd.max}${hd.type}`).join(", ");

		// Speed — build from individual types
		const speedParts = [];
		const walk = this._state.getSpeedByType?.("walk") ?? 30;
		speedParts.push(`${walk} ft.`);
		const fly = this._state.getSpeedByType?.("fly");
		if (fly) speedParts.push(`fly ${fly} ft.`);
		const swim = this._state.getSpeedByType?.("swim");
		if (swim) speedParts.push(`swim ${swim} ft.`);
		const climb = this._state.getSpeedByType?.("climb");
		if (climb) speedParts.push(`climb ${climb} ft.`);
		const burrow = this._state.getSpeedByType?.("burrow");
		if (burrow) speedParts.push(`burrow ${burrow} ft.`);

		// Jump distances
		const jumpStr = this._getJumpString();

		// Death saves
		const deathSaves = this._state.getDeathSaves?.() ?? {successes: 0, failures: 0};

		// Exhaustion
		const exhaustion = this._state.getExhaustion();
		const exhaustionRules = this._state.getExhaustionRules?.() || "classic";
		const maxExhaustion = exhaustionRules === "thelemar" ? 10 : 6;

		return `<div class="pdf-section">
			<h3 class="pdf-section__title">Combat</h3>
			<div class="pdf-combat-grid">
				<div class="pdf-ac-shield">
					<div class="pdf-ac-shield__value">${ac}</div>
					<div class="pdf-ac-shield__label">AC</div>
				</div>
				<div class="pdf-stat-box">
					<div class="pdf-stat-box__value">${this._fmtMod(initiative)}</div>
					<div class="pdf-stat-box__label">Initiative</div>
				</div>
				<div class="pdf-stat-box">
					<div class="pdf-stat-box__value">${walk}</div>
					<div class="pdf-stat-box__label">Speed</div>
				</div>
			</div>
			${speedParts.length > 1 ? `<div class="pdf-speed-detail">${this._esc(speedParts.join(", "))}</div>` : ""}
			${jumpStr ? `<div class="pdf-speed-detail">${jumpStr}</div>` : ""}
			<div class="pdf-hp-block">
				<div class="pdf-hp-row">
					<span class="pdf-label">Hit Points</span>
					<span class="pdf-hp__current">${hp.current ?? hp.max}</span>
					<span class="pdf-hp__sep">/</span>
					<span class="pdf-hp__max">${hp.max}</span>
					${hp.temp ? `<span class="pdf-hp__temp">(+${hp.temp} temp)</span>` : ""}
				</div>
				<div class="pdf-hp-row">
					<span class="pdf-label">Hit Dice</span> ${hitDiceStr}
				</div>
			</div>
			<div class="pdf-death-saves">
				<div class="pdf-death-saves__row">
					<span class="pdf-label">Death Saves</span>
					<span class="pdf-death-saves__group">
						<span class="pdf-death-saves__label">S</span>
						${this._renderCircles(deathSaves.successes, 3)}
					</span>
					<span class="pdf-death-saves__group">
						<span class="pdf-death-saves__label">F</span>
						${this._renderCircles(deathSaves.failures, 3)}
					</span>
				</div>
			</div>
			<div class="pdf-exhaustion-row">
				<span class="pdf-label">Exhaustion</span>
				${this._renderPips(exhaustion, maxExhaustion)}
				${exhaustionRules === "thelemar" ? `<span class="pdf-tgtt-badge">Thelemar</span>` : ""}
			</div>
		</div>`;
	}

	// endregion

	// region Saving Throws

	_renderSavingThrows () {
		const rows = ABILITIES.map(ab => {
			const mod = this._state.getSaveMod(ab);
			const prof = this._state.hasSaveProficiency(ab);
			const dot = prof ? "●" : "○";
			return `<div class="pdf-save-row">
				<span class="pdf-save__dot">${dot}</span>
				<span class="pdf-save__mod">${this._fmtMod(mod)}</span>
				<span class="pdf-save__label">${ABILITY_LABELS[ab]}</span>
			</div>`;
		}).join("\n");

		return `<div class="pdf-section pdf-section--boxed">
			<h3 class="pdf-section__title">Saving Throws</h3>
			${rows}
		</div>`;
	}

	// endregion

	// region Skills

	_renderSkills () {
		const addedKeys = new Set();
		const allSkills = [];

		// Build a map from clean key → raw stored key for proficiency lookups
		// Stored keys may have |source suffix (e.g., "culture|tgtt")
		const profData = this._state.getSkillProficiencies?.() || {};
		const rawKeyMap = {};
		for (const rawKey of Object.keys(profData)) {
			const cleanKey = rawKey.split("|")[0].toLowerCase().replace(/\s+/g, "");
			if (!rawKeyMap[cleanKey] || profData[rawKey] > (profData[rawKeyMap[cleanKey]] || 0)) {
				rawKeyMap[cleanKey] = rawKey;
			}
		}

		// Use controller's skillsList if available (authoritative names + abilities from loaded JSON)
		if (this._skillsList.length) {
			for (const sk of this._skillsList) {
				const key = sk.name.toLowerCase().replace(/\s+/g, "");
				if (!addedKeys.has(key)) {
					allSkills.push({name: sk.name, ability: sk.ability || "int"});
					addedKeys.add(key);
				}
			}
		} else {
			// Fallback: use standard skills + discover from proficiency data
			for (const sk of SKILLS) {
				const key = sk.name.toLowerCase().replace(/\s+/g, "");
				allSkills.push(sk);
				addedKeys.add(key);
			}
		}

		// Add user custom skills not already listed
		const customSkills = this._state.getCustomSkills?.() || [];
		for (const cs of customSkills) {
			const key = cs.name.toLowerCase().replace(/\s+/g, "");
			if (!addedKeys.has(key)) {
				allSkills.push({name: cs.name, ability: cs.ability || "int"});
				addedKeys.add(key);
			}
		}

		// Discover any proficient skills from state data not yet listed
		for (const [rawKey, profLevel] of Object.entries(profData)) {
			if (profLevel < 1) continue;
			const cleanKey = rawKey.split("|")[0].toLowerCase().replace(/\s+/g, "");
			if (addedKeys.has(cleanKey)) continue;
			const ability = this._state.getSkillAbility?.(cleanKey) || "int";
			const name = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1).replace(/([A-Z])/g, " $1");
			allSkills.push({name, ability});
			addedKeys.add(cleanKey);
		}

		const rows = allSkills.map(sk => {
			const cleanKey = sk.name.toLowerCase().replace(/\s+/g, "");
			const rawKey = rawKeyMap[cleanKey] || cleanKey;
			// Use raw key for proficiency lookup (matches stored data which may have |source suffix)
			const profLevel = this._state.getSkillProficiency(rawKey);
			// Use getSkillModWithAbility with raw key (correct proficiency) and authoritative ability
			const mod = this._state.getSkillModWithAbility?.(rawKey, sk.ability)
				?? this._state.getSkillMod(cleanKey);
			const dot = profLevel >= 2 ? "\u25C6" : profLevel >= 1 ? "\u25CF" : "\u25CB";
			const abLabel = sk.ability.toUpperCase();
			const passiveVal = PASSIVE_SKILLS.has(cleanKey) ? this._state.getPassiveScore?.(cleanKey) ?? null : null;
			const passiveHtml = passiveVal != null ? `<span class="pdf-skill__passive">${passiveVal}</span>` : "";
			return `<div class="pdf-skill-row">
				<span class="pdf-skill__dot">${dot}</span>
				<span class="pdf-skill__mod">${this._fmtMod(mod)}</span>
				<span class="pdf-skill__name">${sk.name}</span>
				<span class="pdf-skill__ability">(${abLabel})</span>
				${passiveHtml}
			</div>`;
		}).join("\n");

		return `<div class="pdf-section pdf-section--boxed">
			<h3 class="pdf-section__title">Skills</h3>
			${rows}
		</div>`;
	}

	// endregion

	// region Page 1 Footer (defenses, senses, proficiencies, conditions, carry)

	_renderPageOneFooter () {
		const parts = [];

		// Row 1: Defenses + Active Conditions
		const defensesHtml = this._renderDefenses();
		const conditionsHtml = this._renderActiveConditions();
		if (defensesHtml || conditionsHtml) {
			parts.push(`<div class="pdf-footer-row">${defensesHtml}${conditionsHtml}</div>`);
		}

		// Row 2: Senses + Proficiencies + Carry
		const sensesHtml = this._renderSenses();
		const profsHtml = this._renderProficiencies();
		const carryHtml = this._renderCarryInfo();
		if (sensesHtml || profsHtml || carryHtml) {
			parts.push(`<div class="pdf-footer-row">${sensesHtml}${profsHtml}${carryHtml}</div>`);
		}

		if (!parts.length) return "";

		return `<div class="pdf-page-footer">${parts.join("\n")}</div>`;
	}

	// endregion

	// region Senses

	_renderSenses () {
		const senses = this._state.getSenses();

		const parts = [];
		if (senses.darkvision) parts.push(`<span><strong>Darkvision</strong> ${senses.darkvision} ft.</span>`);
		if (senses.blindsight) parts.push(`<span><strong>Blindsight</strong> ${senses.blindsight} ft.</span>`);
		if (senses.tremorsense) parts.push(`<span><strong>Tremorsense</strong> ${senses.tremorsense} ft.</span>`);
		if (senses.truesight) parts.push(`<span><strong>Truesight</strong> ${senses.truesight} ft.</span>`);

		if (!parts.length) return "";

		return `<div class="pdf-footer-item">
			<span class="pdf-label">Senses</span>
			<span class="pdf-footer-item__content">${parts.join(" \u00B7 ")}</span>
		</div>`;
	}

	// endregion

	// region Active Conditions

	_renderActiveConditions () {
		const conditions = this._state.getConditions?.() || [];
		const activeStates = (this._state.getActiveStates?.() || []).filter(s => s.active && !s.isCondition);

		if (!conditions.length && !activeStates.length) return "";

		const chips = [];
		for (const c of conditions) {
			const name = typeof c === "string" ? c : c.name;
			chips.push(`<span class="pdf-condition-chip">${this._esc(name)}</span>`);
		}
		for (const s of activeStates) {
			chips.push(`<span class="pdf-condition-chip pdf-condition-chip--state">${this._esc(s.name)}</span>`);
		}

		return `<div class="pdf-footer-item">
			<span class="pdf-label">Conditions</span>
			<span class="pdf-footer-item__content">${chips.join(" ")}</span>
		</div>`;
	}

	// endregion

	// region Defenses

	_renderDefenses () {
		const resistances = this._state.getResistances();
		const immunities = this._state.getImmunities();
		const vulnerabilities = this._state.getVulnerabilities();
		const condImmunities = this._state.getConditionImmunities();

		const hasAny = resistances.length || immunities.length || vulnerabilities.length || condImmunities.length;
		if (!hasAny) return "";

		const lines = [];
		if (resistances.length) lines.push(`<span><strong>Resist</strong> ${this._esc(resistances.join(", "))}</span>`);
		if (immunities.length) lines.push(`<span><strong>Immune</strong> ${this._esc(immunities.join(", "))}</span>`);
		if (vulnerabilities.length) lines.push(`<span><strong>Vuln</strong> ${this._esc(vulnerabilities.join(", "))}</span>`);
		if (condImmunities.length) lines.push(`<span><strong>Cond. Immune</strong> ${this._esc(condImmunities.join(", "))}</span>`);

		return `<div class="pdf-footer-item">
			<span class="pdf-label">Defenses</span>
			<span class="pdf-footer-item__content">${lines.join(" \u00B7 ")}</span>
		</div>`;
	}

	// endregion

	// region Proficiencies

	_renderProficiencies () {
		const data = this._state.toJSON?.() ?? this._state.toJson();
		const groups = [];

		const armor = data.armorProficiencies || [];
		const weapons = data.weaponProficiencies || [];
		const tools = data.toolProficiencies || [];
		const languages = data.languages || [];

		if (armor.length) groups.push(`<span><strong>Armor</strong> ${this._esc(this._stripTags(armor.join(", ")))}</span>`);
		if (weapons.length) groups.push(`<span><strong>Weapons</strong> ${this._esc(this._stripTags(weapons.join(", ")))}</span>`);
		if (tools.length) groups.push(`<span><strong>Tools</strong> ${this._esc(this._stripTags(tools.join(", ")))}</span>`);
		if (languages.length) groups.push(`<span><strong>Languages</strong> ${this._esc(this._cleanPipeSource(languages).join(", "))}</span>`);

		if (!groups.length) return "";

		return `<div class="pdf-footer-item pdf-footer-item--wide">
			<span class="pdf-label">Proficiencies</span>
			<span class="pdf-footer-item__content">${groups.join(" \u00B7 ")}</span>
		</div>`;
	}

	// endregion

	// region Carry Info (compact, for footer)

	_renderCarryInfo () {
		const parts = [];

		const capacity = this._state.getCarryingCapacity?.();
		const weight = this._state.getTotalWeight?.();
		if (capacity != null) {
			const encLevel = this._state.getEncumbranceLevel?.() || "normal";
			const encLabel = encLevel === "normal" ? "" : ` (${encLevel.replace(/_/g, " ")})`;
			parts.push(`<strong>Carry</strong> ${weight != null ? `${weight}/` : ""}${capacity} lb.${encLabel}`);
		}

		if (!parts.length) return "";

		return `<div class="pdf-footer-item">
			<span class="pdf-footer-item__content">${parts.join(" \u00B7 ")}</span>
		</div>`;
	}

	// endregion

	// region Attacks

	_renderAttacks () {
		const attacks = this._state.getAttacks();
		if (!attacks.length) return "";

		const rows = attacks.map(atk => {
			const name = this._esc(atk.name || "Attack");
			const bonus = atk.attackBonus != null ? this._fmtMod(atk.attackBonus) : (atk.bonus != null ? this._fmtMod(atk.bonus) : "\u2014");
			const damage = this._esc(atk.damage || "\u2014");
			const damageType = this._esc(atk.damageType || "");
			const range = this._esc(atk.range || "");
			const props = (atk.properties || []).map(p => this._esc(p)).join(", ");

			// Collect upgrade/gemstone notes for this attack's source item
			let upgradeNote = "";
			if (atk._sourceItem && typeof CharacterSheetUpgrades !== "undefined") {
				const bits = [];
				const eff = CharacterSheetUpgrades.getUpgradeEffects(atk._sourceItem);
				if (eff.tags.length) bits.push(eff.tags.join(", "));
				if (eff.bonusDamageDice) bits.push(`+${eff.bonusDamageDice} ${eff.bonusDamageType}`);
				for (const note of eff.notes) bits.push(note);
				const gems = atk._sourceItem.socketedGemstones || [];
				for (const gem of gems) {
					const summary = CharacterSheetUpgrades.getGemstoneSummary(gem);
					if (summary) bits.push(`${this._esc(gem.name)}: ${this._esc(summary)}`);
				}
				if (bits.length) upgradeNote = `<div class="pdf-atk__upgrade-note">${bits.map(b => this._esc(b)).join(" · ")}</div>`;
			}

			return `<tr>
				<td class="pdf-atk__name">${name}${upgradeNote}</td>
				<td class="pdf-atk__bonus">${bonus}</td>
				<td class="pdf-atk__damage">${damage} ${damageType}</td>
				<td class="pdf-atk__range">${range}</td>
				<td class="pdf-atk__props">${props}</td>
			</tr>`;
		}).join("\n");

		return `<div class="pdf-section">
			<h3 class="pdf-section__title">Attacks</h3>
			<table class="pdf-table pdf-table--attacks">
				<thead><tr><th>Name</th><th>Bonus</th><th>Damage</th><th>Range</th><th>Properties</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	}

	// endregion

	// region Actions (compact 3-column: Actions | Bonus Actions | Reactions)

	/**
	 * Standard D&D combat actions, always shown as baseline.
	 */
	static _STANDARD_ACTIONS = [
		"Attack", "Cast a Spell", "Dash", "Disengage", "Dodge",
		"Help", "Hide", "Ready", "Search", "Use an Object",
	];

	_renderActions () {
		const actions = CharacterSheetPdf._STANDARD_ACTIONS.map(name => ({name, standard: true}));
		const bonusActions = [];
		const reactions = [];

		// --- Class/race/feat features with action economy ---
		const features = this._state.getFeatures();
		for (const f of features) {
			if (!this._isCombatRelevant(f)) continue;
			const type = this._getActionType(f);
			if (type === "free") continue;
			const entry = {name: f.name};
			if (f.uses?.max) entry.uses = `${f.uses.current ?? f.uses.max}/${f.uses.max}`;
			if (f.uses?.recharge) entry.recharge = f.uses.recharge === "short rest" ? "SR" : f.uses.recharge === "long rest" ? "LR" : f.uses.recharge;
			if (type === "bonus") bonusActions.push(entry);
			else if (type === "reaction") reactions.push(entry);
			else actions.push(entry);
		}

		// --- Activatable magic items ---
		const items = this._state.getActivatableItems?.({activeOnly: true}) || [];
		for (const item of items) {
			for (const act of (item.activation || [])) {
				if (act.type === "minute" || act.type === "hour" || act.type === "none") continue;
				const entry = {name: item.name, suffix: "\u25AA"};
				if (act.type === "bonus") bonusActions.push(entry);
				else if (act.type === "reaction") reactions.push(entry);
				else actions.push(entry);
			}
		}

		// --- Custom abilities ---
		const custom = this._state.getCustomAbilities?.() || [];
		for (const ca of custom) {
			if (!ca.activationAction || ca.activationAction === "free") continue;
			const entry = {name: ca.name, suffix: "\u2726"};
			if (ca.uses?.max) entry.uses = `${ca.uses.current ?? ca.uses.max}/${ca.uses.max}`;
			if (ca.activationAction === "bonus") bonusActions.push(entry);
			else if (ca.activationAction === "reaction") reactions.push(entry);
			else actions.push(entry);
		}

		// --- Bonus action / reaction spells ---
		const sc = this._state.getSpellcasting();
		if (sc) {
			const allSpells = [...(sc.cantripsKnown || []), ...(sc.spellsKnown || []), ...(sc.innateSpells || [])];
			const seen = new Set();
			for (const sp of allSpells) {
				if (sp.prepared === false) continue;
				const time = (sp.castingTime || sp.time || "").toLowerCase();
				const key = (sp.name || "").toLowerCase();
				if (seen.has(key)) continue;
				if (/bonus action/i.test(time)) { seen.add(key); bonusActions.push({name: sp.name, suffix: "\u2020"}); }
				else if (/reaction/i.test(time)) { seen.add(key); reactions.push({name: sp.name, suffix: "\u2020"}); }
			}
		}

		// --- Render 3-column grid ---
		const renderCol = (title, items) => {
			const rows = items.map(it => {
				const name = this._esc(it.name);
				const suffix = it.suffix ? `<span class="pdf-action__suffix">${it.suffix}</span>` : "";
				const usesStr = it.uses ? `<span class="pdf-action__uses">${it.uses}${it.recharge ? ` ${it.recharge}` : ""}</span>` : "";
				const cls = it.standard ? " pdf-action-item--standard" : "";
				return `<div class="pdf-action-item${cls}">${name}${suffix} ${usesStr}</div>`;
			}).join("\n");
			return `<div class="pdf-actions-col">
				<div class="pdf-actions-col__title">${title}</div>
				${rows}
			</div>`;
		};

		return `<div class="pdf-section pdf-section--actions">
			<h3 class="pdf-section__title">Actions</h3>
			<div class="pdf-actions-grid">
				${renderCol("Actions", actions)}
				${renderCol("Bonus Actions", bonusActions)}
				${renderCol("Reactions", reactions)}
			</div>
		</div>`;
	}

	/**
	 * Detect action economy type from feature description.
	 * Mirrors charactersheet-combat.js _getFeatureActionType().
	 */
	_getActionType (feature) {
		const nameLower = (feature?.name || "").toLowerCase();
		const overrides = globalThis.CharacterSheetState?.FEATURE_CLASSIFICATION_OVERRIDES;
		if (overrides?.[nameLower] === "reaction") return "reaction";
		const desc = (feature?.description || "").toLowerCase();
		if (/bonus action/i.test(desc)) return "bonus";
		if (/reaction/i.test(desc)) return "reaction";
		if (/no action required|free/i.test(desc)) return "free";
		return "action";
	}

	/**
	 * Filter features for combat relevance.
	 * Adapted from charactersheet-combat.js renderCombatActions() filter.
	 */
	_isCombatRelevant (f) {
		const nameLower = (f.name || "").toLowerCase();
		const overrides = globalThis.CharacterSheetState?.FEATURE_CLASSIFICATION_OVERRIDES;
		if (overrides?.[nameLower] === "passive") return false;
		if (overrides?.[nameLower] === "combat" || overrides?.[nameLower] === "reaction") return true;

		if (CharacterSheetClassUtils.isCombatMethod(f)) return false;
		if (f.optionalFeatureTypes?.includes("MM")) return false;

		let desc = f.description || "";
		desc = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
		if (!desc) return false;

		const excludePatterns = [
			"suggested characteristics", "personality trait", "ideal", "bond", "flaw",
			"equipment", "tool proficiency", "skill proficiency", "languages", "starting equipment",
			"proficiencies", "background feature", "you gain proficiency", "you are proficient",
			"darkvision", "creature type", "size", "speed", "ability score",
		];
		if (excludePatterns.some(p => nameLower.includes(p) || (desc.includes(p) && !desc.includes("action")))) {
			if (!/\b(bonus action|as an action|use your action|as a reaction)\b/i.test(desc)) return false;
		}

		const hasActionEconomy = /\b(as a bonus action|bonus action to|as an action|use your action|take the \w+ action|take a bonus action|take a reaction|take an action|as a reaction|use your reaction)\b/i.test(desc);

		const combatKeywords = [
			"breath weapon", "second wind", "action surge", "cunning action", "uncanny dodge",
			"patient defense", "step of the wind", "flurry of blows", "stunning strike",
			"deflect missiles", "deflect attacks", "slow fall", "wild shape", "channel divinity",
			"divine smite", "lay on hands", "bardic inspiration", "arcane recovery",
			"reckless attack", "rage", "fey step", "hellish rebuke", "healing hands",
			"fury of the small", "stone's endurance", "hand of healing", "hand of harm",
		];
		const hasCombatKeyword = combatKeywords.some(kw => nameLower.includes(kw));
		const hasLimitedUses = f.uses && f.uses.max > 0;

		return (hasActionEconomy && (hasLimitedUses || hasCombatKeyword))
			|| (hasCombatKeyword && (hasLimitedUses || hasActionEconomy));
	}

	// endregion

	// region Features (compact summaries for page 2)

	/**
	 * Compact feature view: name + uses + first sentence of description.
	 * Grouped by type: Species/Race → Class → Background → Feat → Other.
	 * CTM:* methods are excluded (handled by TGTT section).
	 */
	_renderFeatures () {
		const filtered = this._getFilteredFeatures();
		if (!filtered.length) return "";

		const sortedEntries = this._groupAndSortFeatures(filtered);

		const sections = sortedEntries.map(([group, feats]) => {
			const rows = feats.map(f => this._renderFeatureCompact(f)).join("\n");
			return `<div class="pdf-feature-group">
				<h4 class="pdf-feature-group__title">${this._esc(group)}</h4>
				${rows}
			</div>`;
		}).join("\n");

		return `<div class="pdf-section pdf-section--features">
			<h3 class="pdf-section__title">Features &amp; Traits</h3>
			${sections}
		</div>`;
	}

	_renderFeatureCompact (f) {
		const name = this._esc(f.name);
		const usesStr = f.uses ? ` (${f.uses.current}/${f.uses.max} \u2022 ${this._esc(f.uses.recharge || "long rest")})` : "";
		const levelStr = f.level ? `<span class="pdf-feature__level">Lvl ${f.level}</span>` : "";
		// First sentence only for compact view
		const summary = f.description ? this._getFirstSentence(this._cleanDescription(f.description)) : "";
		const summaryHtml = summary ? `<div class="pdf-feature__summary">${summary}</div>` : "";
		return `<div class="pdf-feature">
			<div class="pdf-feature__header">
				<span class="pdf-feature__name">${name}${usesStr}</span>
				${levelStr}
			</div>
			${summaryHtml}
		</div>`;
	}

	// endregion

	// region Feature Details Appendix (full descriptions)

	_renderFeatureDetails () {
		const filtered = this._getFilteredFeatures();
		const withDesc = filtered.filter(f => f.description);
		if (!withDesc.length) return "";

		const sortedEntries = this._groupAndSortFeatures(withDesc);

		const sections = sortedEntries.map(([group, feats]) => {
			const rows = feats.map(f => this._renderSingleFeature(f)).join("\n");
			return `<div class="pdf-feature-group">
				<h4 class="pdf-feature-group__title">${this._esc(group)}</h4>
				${rows}
			</div>`;
		}).join("\n");

		return `<div class="pdf-section pdf-section--details">
			<h3 class="pdf-section__title">Feature Details</h3>
			<div class="pdf-details-columns">
				${sections}
			</div>
		</div>`;
	}

	_renderSingleFeature (f) {
		const name = this._esc(f.name);
		const usesStr = f.uses ? ` (${f.uses.current}/${f.uses.max} \u2022 ${this._esc(f.uses.recharge || "long rest")})` : "";
		const levelStr = f.level ? `<span class="pdf-feature__level">Lvl ${f.level}</span>` : "";
		const desc = f.description ? `<div class="pdf-feature__desc">${this._cleanDescription(f.description)}</div>` : "";
		return `<div class="pdf-feature">
			<div class="pdf-feature__header">
				<span class="pdf-feature__name">${name}${usesStr}</span>
				${levelStr}
			</div>
			${desc}
		</div>`;
	}

	// endregion

	// region Feature Helpers

	_getFilteredFeatures () {
		const features = this._state.getFeatures();
		if (!features.length) return [];
		return features.filter(f => {
			if (CharacterSheetClassUtils.isCombatMethod(f)) return false;
			return true;
		});
	}

	_groupAndSortFeatures (filtered) {
		const groupOrder = ["Species", "Race", "Subrace", "Class", "Background", "Feat", "Optional Feature", "Other"];
		const groups = {};
		for (const f of filtered) {
			let group = f.featureType || f.className || "Other";
			if (group === "Class" && f.className) group = f.className;
			(groups[group] = groups[group] || []).push(f);
		}
		return Object.entries(groups).sort(([a], [b]) => {
			const ia = groupOrder.indexOf(a);
			const ib = groupOrder.indexOf(b);
			const posA = ia >= 0 ? ia : groupOrder.indexOf("Class") + 0.5;
			const posB = ib >= 0 ? ib : groupOrder.indexOf("Class") + 0.5;
			return posA - posB;
		});
	}

	// endregion

	// region Spellcasting

	_renderSpellcasting () {
		const sc = this._state.getSpellcasting();
		if (!sc) return "";

		const spells = sc.spellsKnown || [];
		const cantrips = sc.cantripsKnown || [];
		const innate = sc.innateSpells || [];
		const hasSpells = spells.length || cantrips.length || innate.length;
		if (!hasSpells) return "";

		const parts = [];

		// Spellcasting header info
		const dcParts = [];
		const spellAbility = sc.ability;
		if (spellAbility) {
			const dc = this._state.getSpellSaveDc?.() ?? this._state.getSpellSaveDC?.();
			const atkBonus = this._state.getSpellAttackBonus?.();
			if (dc != null) dcParts.push(`<span><strong>Spell Save DC</strong> ${dc}</span>`);
			if (atkBonus != null) dcParts.push(`<span><strong>Spell Attack</strong> ${this._fmtMod(atkBonus)}</span>`);
			dcParts.push(`<span><strong>Ability</strong> ${ABILITY_LABELS[spellAbility] || spellAbility}</span>`);
		}

		if (dcParts.length) {
			parts.push(`<div class="pdf-spell-meta">${dcParts.join(" \u00B7 ")}</div>`);
		}

		// Spell count summary
		const preparedCount = spells.filter(s => s.prepared !== false).length;
		parts.push(`<div class="pdf-spell-summary">${cantrips.length} cantrips, ${preparedCount} prepared of ${spells.length} known${innate.length ? `, ${innate.length} innate` : ""}</div>`);

		// Spell slots
		const slots = sc.spellSlots || {};
		const slotLevels = Object.keys(slots).map(Number).filter(n => n >= 1).sort((a, b) => a - b);
		if (slotLevels.length) {
			const slotRows = slotLevels.map(lvl => {
				const slot = slots[lvl];
				const max = slot.max || 0;
				if (!max) return "";
				const pips = this._renderSlotPips(slot.current ?? max, max);
				return `<div class="pdf-slot-row">
					<span class="pdf-slot__level">${this._ordinal(lvl)}</span>
					<span class="pdf-slot__pips">${pips}</span>
				</div>`;
			}).filter(Boolean).join("\n");

			if (slotRows) {
				parts.push(`<div class="pdf-spell-slots"><h4 class="pdf-subsection__title">Spell Slots</h4>${slotRows}</div>`);
			}
		}

		// Pact slots
		if (sc.pactSlots?.max) {
			const pact = sc.pactSlots;
			const pips = this._renderPips(pact.current ?? pact.max, pact.max);
			parts.push(`<div class="pdf-spell-slots"><h4 class="pdf-subsection__title">Pact Slots (Level ${pact.level})</h4>
				<div class="pdf-slot-row"><span class="pdf-slot__pips">${pips}</span></div>
			</div>`);
		}

		// Cantrips
		if (cantrips.length) {
			parts.push(this._renderSpellList("Cantrips", cantrips));
		}

		// Spells by level
		const spellsByLevel = {};
		for (const sp of spells) {
			const lvl = sp.level || 0;
			(spellsByLevel[lvl] = spellsByLevel[lvl] || []).push(sp);
		}
		for (const [lvl, sps] of Object.entries(spellsByLevel).sort(([a], [b]) => Number(a) - Number(b))) {
			if (Number(lvl) === 0) continue; // Skip cantrips already rendered
			parts.push(this._renderSpellList(`${this._ordinal(Number(lvl))} Level`, sps));
		}

		// Innate spells
		if (innate.length) {
			parts.push(this._renderSpellList("Innate Spellcasting", innate));
		}

		return `<div class="pdf-section pdf-section--spells">
			<h3 class="pdf-section__title">Spellcasting</h3>
			${parts.join("\n")}
		</div>`;
	}

	_renderSpellList (title, spells) {
		const rows = spells.map(sp => {
			const name = this._esc(sp.name || "Unknown");
			const time = this._esc(sp.castingTime || sp.time || "");
			const range = this._esc(sp.range || "");
			const duration = this._esc(sp.duration || "");
			const concentration = sp.concentration ? " (C)" : "";
			const ritual = sp.ritual ? " (R)" : "";
			const prepared = sp.prepared === false ? `<span class="pdf-spell__unprepared">\u2717</span>` : "";
			const rowCls = sp.prepared === false ? ` class="pdf-spell-row--unprepared"` : "";
			return `<tr${rowCls}>
				<td class="pdf-spell__name">${name}${concentration}${ritual} ${prepared}</td>
				<td class="pdf-spell__time">${time}</td>
				<td class="pdf-spell__range">${range}</td>
				<td class="pdf-spell__duration">${duration}</td>
			</tr>`;
		}).join("\n");

		return `<div class="pdf-spell-group">
			<h4 class="pdf-subsection__title">${this._esc(title)}</h4>
			<table class="pdf-table pdf-table--spells">
				<thead><tr><th>Spell</th><th>Time</th><th>Range</th><th>Duration</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	}

	// endregion

	// region Inventory

	_renderInventory () {
		const inventory = this._state.getInventory();
		const currency = this._state.getCurrency?.() ?? {};
		if (!inventory.length && !Object.values(currency).some(v => v > 0)) return "";

		const parts = [];

		// Currency
		const currencyParts = [];
		for (const [type, label] of [["pp", "PP"], ["gp", "GP"], ["ep", "EP"], ["sp", "SP"], ["cp", "CP"]]) {
			const val = currency[type] || 0;
			if (val > 0) currencyParts.push(`<span class="pdf-currency__item">${val} ${label}</span>`);
		}
		if (currencyParts.length) {
			parts.push(`<div class="pdf-currency">${currencyParts.join(" · ")}</div>`);
		}

		// Items
		if (inventory.length) {
			const rows = inventory.map(inv => {
				const item = inv.item || {};
				const name = this._esc(item.name || "Unknown Item");
				const qty = inv.quantity || 1;
				const equipped = inv.equipped ? "✓" : "";
				const attuned = inv.attuned ? "⬥" : "";

				// Upgrade and gemstone indicators
				const upgradeNames = (item.appliedUpgrades || []).map(u => this._esc(u.name)).join(", ");
				const gemNames = (item.socketedGemstones || []).map(g => this._esc(g.name)).join(", ");
				const extras = [upgradeNames ? `⚒ ${upgradeNames}` : "", gemNames ? `💎 ${gemNames}` : ""].filter(Boolean).join(" · ");

				return `<tr>
					<td class="pdf-inv__name">${name}${extras ? `<div class="pdf-inv__extras">${extras}</div>` : ""}</td>
					<td class="pdf-inv__qty">${qty > 1 ? qty : ""}</td>
					<td class="pdf-inv__eq">${equipped}</td>
					<td class="pdf-inv__att">${attuned}</td>
				</tr>`;
			}).join("\n");

			parts.push(`<table class="pdf-table pdf-table--inventory">
				<thead><tr><th>Item</th><th>Qty</th><th>Eq.</th><th>Att.</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>`);
		}

		// Armor upgrade notes
		if (typeof CharacterSheetUpgrades !== "undefined") {
			const armorNotes = this._state.getArmorUpgradeNotes?.() || [];
			if (armorNotes.length) {
				const noteItems = armorNotes.map(n => `<li><strong>${this._esc(n.label)}.</strong> ${this._esc(n.description)}</li>`).join("");
				parts.push(`<div class="pdf-upgrade-notes"><h4>Armor Upgrades</h4><ul>${noteItems}</ul></div>`);
			}

			// Gemstone passive effects
			const gemNotes = this._state.getGemstonePassiveNotes?.() || [];
			if (gemNotes.length) {
				const gemItems = gemNotes.map(n => `<li>${this._esc(n)}</li>`).join("");
				parts.push(`<div class="pdf-upgrade-notes"><h4>Gemstone Effects</h4><ul>${gemItems}</ul></div>`);
			}
		}

		return `<div class="pdf-section pdf-section--inventory">
			<h3 class="pdf-section__title">Equipment</h3>
			${parts.join("\n")}
		</div>`;
	}

	// endregion

	// region TGTT Sections

	_renderTgttSections () {
		const parts = [];

		const combatHtml = this._renderTgttCombat();
		if (combatHtml) parts.push(combatHtml);

		const dreamHtml = this._renderTgttDreamwalker();
		if (dreamHtml) parts.push(dreamHtml);

		const primalHtml = this._renderTgttPrimalFocus();
		if (primalHtml) parts.push(primalHtml);

		if (!parts.length) return "";

		return `<div class="pdf-tgtt-wrapper">
			<div class="pdf-tgtt-banner">Thelemar Homebrew</div>
			${parts.join("\n")}
		</div>`;
	}

	_renderTgttCombat () {
		const traditions = this._state.getCombatTraditionEntries?.() || [];
		if (!traditions.length) return "";

		const staminaMax = this._state.getStaminaMax?.() || 0;
		const staminaCurrent = this._state.getStaminaCurrent?.() || 0;
		const activeStance = this._state.getActiveStance?.();

		const tradRows = traditions.map(t =>
			`<span class="pdf-tradition">${this._esc(t.name || t.code)}</span>`,
		).join(" · ");

		const staminaPips = staminaMax > 0 ? `<div class="pdf-tgtt-row"><span class="pdf-label">Stamina</span> ${this._renderPips(staminaCurrent, staminaMax)}</div>` : "";
		const stanceRow = activeStance ? `<div class="pdf-tgtt-row"><span class="pdf-label">Stance</span> ${this._esc(activeStance)}</div>` : "";

		// Render combat methods that were excluded from features section
		const allFeatures = this._state.getFeatures?.() || [];
		const methods = allFeatures.filter(f => CharacterSheetClassUtils.isCombatMethod(f));
		const methodsHtml = methods.length
			? `<div class="pdf-tgtt-methods"><h4 class="pdf-subsection__title" style="color:#1a3c5e">Methods</h4>${methods.map(f => this._renderSingleFeature(f)).join("\n")}</div>`
			: "";

		return `<div class="pdf-section pdf-section--tgtt">
			<h3 class="pdf-section__title pdf-section__title--tgtt">Combat Traditions</h3>
			<div class="pdf-traditions">${tradRows}</div>
			${staminaPips}
			${stanceRow}
			${methodsHtml}
		</div>`;
	}

	_renderTgttDreamwalker () {
		if (!this._state.hasFocusPool?.()) return "";

		const focusMax = this._state.getFocusPoolMax?.() || 0;
		const focusCurrent = this._state.getFocusPoolCurrent?.() || 0;
		const focusDie = this._state.getLucidFocusDie?.() || "1d6";
		const dreamDc = this._state.getDreamDc?.() || 0;
		const abilities = this._state.getDreamwalkerAbilities?.() || [];

		const rows = [];
		rows.push(`<div class="pdf-tgtt-row"><span class="pdf-label">Focus Pool</span> ${this._renderPips(focusCurrent, typeof focusMax === "number" ? focusMax : 12)}</div>`);
		rows.push(`<div class="pdf-tgtt-row"><span class="pdf-label">Focus Die</span> ${focusDie}</div>`);
		rows.push(`<div class="pdf-tgtt-row"><span class="pdf-label">Dream DC</span> ${dreamDc}</div>`);

		if (abilities.length) {
			const abList = abilities.map(a => `<li>${this._esc(a.name)}</li>`).join("");
			rows.push(`<div class="pdf-tgtt-abilities"><strong>Abilities:</strong><ul>${abList}</ul></div>`);
		}

		return `<div class="pdf-section pdf-section--tgtt">
			<h3 class="pdf-section__title pdf-section__title--tgtt">Dreamwalker</h3>
			${rows.join("\n")}
		</div>`;
	}

	_renderTgttPrimalFocus () {
		if (!this._state.hasPrimalFocus?.()) return "";

		const mode = this._state.getPrimalFocusMode?.() || "predator";

		return `<div class="pdf-section pdf-section--tgtt">
			<h3 class="pdf-section__title pdf-section__title--tgtt">Primal Focus</h3>
			<div class="pdf-tgtt-row"><span class="pdf-label">Mode</span> ${this._esc(mode.toTitleCase?.() || mode)}</div>
		</div>`;
	}

	// endregion

	// region Companions

	_renderCompanions () {
		const companions = this._state.getCompanions?.() || [];
		if (!companions.length) return "";

		const blocks = companions.map(comp => {
			const name = this._esc(comp.name || "Companion");
			const type = this._esc(comp.creatureType || "creature");
			const size = this._esc(comp.size || "M");
			const ac = comp.ac ?? "—";
			const hpMax = comp.hp?.max ?? "—";
			const hpCurrent = comp.hp?.current ?? hpMax;

			// Abilities
			const abilityRow = ABILITIES.map(ab => {
				const score = comp.abilities?.[ab] ?? 10;
				const mod = Math.floor((score - 10) / 2);
				return `<td>${score} (${this._fmtMod(mod)})</td>`;
			}).join("");

			// Speed
			const speeds = comp.speed || {};
			const speedParts = [];
			if (speeds.walk) speedParts.push(`${speeds.walk} ft.`);
			if (speeds.fly) speedParts.push(`fly ${speeds.fly} ft.`);
			if (speeds.swim) speedParts.push(`swim ${speeds.swim} ft.`);
			if (speeds.climb) speedParts.push(`climb ${speeds.climb} ft.`);
			if (speeds.burrow) speedParts.push(`burrow ${speeds.burrow} ft.`);
			const speedStr = speedParts.join(", ") || "30 ft.";

			// Traits/Actions
			const traits = (comp.traits || []).map(t => `<div class="pdf-comp__trait"><strong>${this._esc(t.name || "")}</strong> ${this._esc(t.description || t.entries?.join(" ") || "")}</div>`).join("");
			const actions = (comp.actions || []).map(a => `<div class="pdf-comp__trait"><strong>${this._esc(a.name || "")}</strong> ${this._esc(a.description || a.entries?.join(" ") || "")}</div>`).join("");

			return `<div class="pdf-companion">
				<div class="pdf-companion__header">
					<span class="pdf-companion__name">${name}</span>
					<span class="pdf-companion__type">${size} ${type}</span>
				</div>
				<div class="pdf-companion__stats">
					<div><strong>AC</strong> ${ac} &nbsp; <strong>HP</strong> ${hpCurrent}/${hpMax} &nbsp; <strong>Speed</strong> ${speedStr}</div>
				</div>
				<table class="pdf-table pdf-table--comp-abilities">
					<thead><tr><th>STR</th><th>DEX</th><th>CON</th><th>INT</th><th>WIS</th><th>CHA</th></tr></thead>
					<tbody><tr>${abilityRow}</tr></tbody>
				</table>
				${traits ? `<div class="pdf-comp__section"><strong>Traits</strong>${traits}</div>` : ""}
				${actions ? `<div class="pdf-comp__section"><strong>Actions</strong>${actions}</div>` : ""}
			</div>`;
		}).join("\n");

		return `<div class="pdf-section pdf-section--companions">
			<h3 class="pdf-section__title">Companions</h3>
			${blocks}
		</div>`;
	}

	// endregion

	// region Document Wrapper

	_wrapDocument (body) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this._esc(this._state.getName() || "Character")} — Character Sheet</title>
<style>
${CharacterSheetPdf._CSS}
</style>
</head>
<body>
<div class="pdf-sheet">
${body}
</div>
<script>
// Auto-print after a brief render delay
setTimeout(() => window.print(), 400);
</script>
</body>
</html>`;
	}

	// endregion

	// region Utility

	_esc (str) {
		if (str == null) return "";
		return String(str)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	_stripTags (str) {
		if (!str) return "";
		// Strip 5etools @tags: {@tag content|...} → content
		return String(str).replace(/\{@\w+\s([^|}]+)[^}]*\}/g, "$1");
	}

	/**
	 * Convert rendered HTML description to clean plain text for PDF.
	 * Handles already-rendered HTML from the Renderer (divs, tables, links, etc.)
	 */
	_cleanDescription (html) {
		if (!html) return "";
		let text = String(html);
		// Strip 5etools @tags first (in case any remain)
		text = this._stripTags(text);
		// Strip collapsible section markers like [–] or [-] from website UI
		text = text.replace(/\[[-–—]\]/g, "");

		// --- Attempt to preserve HTML tables as proper PDF tables ---
		const tables = this._extractTables(text);
		if (tables.found) text = tables.text;

		// Replace <br>, <br/>, </p>, </div>, </li>, </tr> with newlines
		text = text.replace(/<br\s*\/?>/gi, "\n");
		text = text.replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n");
		// Replace </td> and </th> with tab-like spacing
		text = text.replace(/<\/t[dh]>/gi, "  ");
		// Strip all remaining HTML tags
		text = text.replace(/<[^>]+>/g, "");
		// Decode common HTML entities
		text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
		// Collapse multiple newlines/spaces
		text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
		// Re-escape for safe HTML output and convert newlines to <br>
		let result = this._esc(text).replace(/\n/g, "<br>");

		// Re-insert extracted tables
		if (tables.found) {
			for (const [placeholder, tableHtml] of tables.replacements) {
				result = result.replace(placeholder, tableHtml);
			}
		}

		return result;
	}

	/**
	 * Extract HTML tables from description, replace with placeholders,
	 * and convert to clean PDF-styled tables.
	 */
	_extractTables (html) {
		const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
		const matches = html.match(tableRegex);
		if (!matches?.length) return {found: false, text: html};

		const replacements = [];
		let text = html;
		for (let i = 0; i < matches.length; i++) {
			const placeholder = `__PDF_TABLE_${i}__`;
			text = text.replace(matches[i], placeholder);

			// Parse the table HTML into a clean PDF table
			const cleanTable = this._convertTableHtml(matches[i]);
			replacements.push([placeholder, cleanTable]);
		}

		return {found: true, text, replacements};
	}

	/**
	 * Convert raw HTML table into a clean, styled PDF table.
	 */
	_convertTableHtml (tableHtml) {
		// Extract rows
		const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
		const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
		const rows = [];
		let rowMatch;
		while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
			const cells = [];
			let cellMatch;
			const cellContent = rowMatch[1];
			// Reset regex for each row
			const cellRe = /<t([dh])[^>]*>([\s\S]*?)<\/t[dh]>/gi;
			while ((cellMatch = cellRe.exec(cellContent)) !== null) {
				const isHeader = cellMatch[1].toLowerCase() === "h";
				let cellText = cellMatch[2].replace(/<[^>]+>/g, "").trim();
				cellText = cellText.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
				cells.push({text: this._esc(cellText), isHeader});
			}
			if (cells.length) rows.push(cells);
		}

		if (!rows.length) return "";

		const htmlRows = rows.map(cells => {
			const tag = cells[0]?.isHeader ? "th" : "td";
			return `<tr>${cells.map(c => `<${tag}>${c.text}</${tag}>`).join("")}</tr>`;
		}).join("");

		return `<table class="pdf-table pdf-table--inline">${htmlRows}</table>`;
	}

	/**
	 * Strip pipe-separated source suffixes from strings (e.g. "Mictlanian|Tgtt" → "Mictlanian")
	 */
	_cleanPipeSource (arr) {
		return arr.map(s => String(s).replace(/\|.*$/, ""));
	}

	_fmtMod (n) {
		if (n == null) return "+0";
		return n >= 0 ? `+${n}` : `${n}`;
	}

	_ordinal (n) {
		const s = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	}

	_renderPips (current, max) {
		const filled = Math.min(current, max);
		const empty = max - filled;
		return `<span class="pdf-pips">${"\u25CF".repeat(filled)}${"\u25CB".repeat(empty)}</span>`;
	}

	_renderSlotPips (current, max) {
		const filled = Math.min(current, max);
		const empty = max - filled;
		return `<span class="pdf-slot-pips">${"\u25A0".repeat(filled)}${"\u25A1".repeat(empty)}</span>`;
	}

	_renderCircles (filled, max) {
		const f = Math.min(filled, max);
		const e = max - f;
		return `<span class="pdf-circles">${"\u25CF".repeat(f)}${"\u25CB".repeat(e)}</span>`;
	}

	_getFirstSentence (html) {
		if (!html) return "";
		const text = html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
		const match = text.match(/^[^.!?]*[.!?]/);
		return match ? match[0].trim() : (text.length > 120 ? text.substring(0, 117) + "..." : text);
	}

	_getJumpString () {
		const settings = this._state.getSettings?.() || {};
		const jumpMult = this._state.getJumpMultiplierFromStates?.() ?? 1;
		let longJump, highJump;

		if (settings.thelemar_jumping) {
			const athleticsMod = this._state.getSkillMod("athletics");
			longJump = Math.floor((8 + athleticsMod) * jumpMult);
			highJump = Math.max(0, Math.floor((2 + athleticsMod * 0.5) * jumpMult));
		} else {
			const strScore = this._state.getAbilityScore("str");
			const strMod = this._state.getAbilityMod("str");
			longJump = Math.floor(strScore * jumpMult);
			highJump = Math.max(0, Math.floor((3 + strMod) * jumpMult));
		}
		return `Long Jump ${longJump} ft. \u00B7 High Jump ${highJump} ft.`;
	}

	// endregion
}

// region CSS

CharacterSheetPdf._CSS = `
/* ========================================
   Character Sheet PDF — Print Stylesheet
   Official 5e Inspired — Shield AC, rounded abilities,
   death save circles, labeled header boxes.
   Palette: maroon #58180d, gold #c9ad6a, parchment #fdf1dc
   ======================================== */

@page {
	size: letter;
	margin: 0.5in;
}

*, *::before, *::after {
	box-sizing: border-box;
	margin: 0;
	padding: 0;
}

body {
	font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
	font-size: 8.5pt;
	line-height: 1.35;
	color: #1a1a1a;
	background: #fdf1dc;
	-webkit-print-color-adjust: exact;
	print-color-adjust: exact;
}

.pdf-sheet {
	max-width: 7.5in;
	margin: 0 auto;
}

/* ---- Page Breaks ---- */
.pdf-page-break {
	page-break-before: always;
	break-before: page;
}

/* ======== HEADER — Labeled Box Row ======== */
.pdf-header {
	margin-bottom: 10px;
}

.pdf-header__top {
	display: flex;
	align-items: flex-end;
	gap: 12px;
	margin-bottom: 4px;
}

.pdf-header__name-block {
	flex: 1;
}

.pdf-header__name {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 22pt;
	font-weight: bold;
	color: #58180d;
	line-height: 1.1;
	border-bottom: 2px solid #58180d;
	padding-bottom: 2px;
}

.pdf-header__name-label {
	font-size: 6.5pt;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #58180d;
	font-weight: 600;
	margin-top: 1px;
}

.pdf-header__inspiration {
	font-size: 18pt;
	color: #c9ad6a;
	line-height: 1;
	text-shadow: 0 0 2px rgba(201, 173, 106, 0.5);
}

.pdf-header__fields {
	display: flex;
	flex-wrap: wrap;
	gap: 0;
	border: 1.5px solid #58180d;
	border-radius: 3px;
	overflow: hidden;
}

.pdf-header__field {
	flex: 1 1 auto;
	min-width: 80px;
	padding: 3px 8px 2px;
	border-right: 1px solid #c9ad6a;
}

.pdf-header__field:last-child {
	border-right: none;
}

.pdf-header__field--small {
	min-width: 50px;
	flex: 0 0 auto;
}

.pdf-header__field-value {
	font-size: 8.5pt;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.pdf-header__field-label {
	font-size: 6pt;
	text-transform: uppercase;
	letter-spacing: 0.4px;
	color: #58180d;
	font-weight: 600;
}

/* ======== LABELS ======== */
.pdf-label {
	font-weight: 600;
	color: #58180d;
	margin-right: 4px;
	font-size: 8pt;
}

/* ======== SECTIONS ======== */
.pdf-section {
	margin-bottom: 8px;
	page-break-inside: avoid;
	break-inside: avoid;
}

.pdf-section__title {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 9pt;
	font-weight: bold;
	color: #58180d;
	border-bottom: 2px solid #c9ad6a;
	padding-bottom: 2px;
	margin-bottom: 5px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.pdf-section__title::before {
	content: "";
	display: inline-block;
	width: 7px;
	height: 7px;
	background: #c9ad6a;
	border: 1px solid #b89a56;
	margin-right: 6px;
	vertical-align: middle;
	position: relative;
	top: -1px;
	transform: rotate(45deg);
}

.pdf-subsection__title {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 8.5pt;
	font-weight: bold;
	color: #58180d;
	margin: 5px 0 3px;
}

/* ---- Boxed Sections (Saving Throws, Skills) ---- */
.pdf-section--boxed {
	border: 1.5px solid #58180d;
	border-radius: 6px;
	padding: 5px 8px 4px;
	background: rgba(255,255,255,0.3);
}

.pdf-section--boxed > .pdf-section__title {
	margin: -5px -8px 5px;
	padding: 3px 8px 3px;
	border-bottom: 1.5px solid #c9ad6a;
	border-radius: 4px 4px 0 0;
	background: rgba(88,24,13,0.04);
}

/* ======== STATS PAGE — 3 Column Grid ======== */
.pdf-page--stats {
	display: grid;
	grid-template-columns: 86px 1fr 1fr;
	gap: 0 10px;
	align-items: start;
}

.pdf-col--center {
	border-left: 1.5px solid #c9ad6a;
	padding-left: 10px;
}

.pdf-col--right {
	border-left: 1.5px solid #c9ad6a;
	padding-left: 10px;
}

/* ======== ABILITY SCORES — Rounded Boxes with Score Circle ======== */
.pdf-section--abilities {
	display: flex;
	flex-direction: column;
	gap: 5px;
	margin-bottom: 0;
}

.pdf-ability {
	text-align: center;
	border: 2.5px solid #58180d;
	border-radius: 8px;
	padding: 3px 2px 12px;
	background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(253,241,220,0.3) 100%);
	box-shadow: inset 0 1px 3px rgba(0,0,0,0.08);
	position: relative;
}

.pdf-ability__label {
	font-size: 6pt;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #58180d;
}

.pdf-ability__mod {
	font-size: 18pt;
	font-weight: 700;
	line-height: 1.1;
}

.pdf-ability__score-circle {
	position: absolute;
	bottom: -8px;
	left: 50%;
	transform: translateX(-50%);
	width: 22px;
	height: 22px;
	line-height: 20px;
	border: 2px solid #58180d;
	border-radius: 50%;
	background: #fdf1dc;
	font-size: 8pt;
	font-weight: 600;
	color: #333;
	box-shadow: 0 0 0 1.5px #fdf1dc, 0 0 0 3px rgba(88,24,13,0.25);
}

/* ======== PROFICIENCY BONUS BOX ======== */
.pdf-prof-box {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 8px;
	padding: 4px 8px;
	border: 1.5px solid #58180d;
	border-radius: 4px;
	background: rgba(255,255,255,0.4);
}

.pdf-prof-box__value {
	font-size: 14pt;
	font-weight: 700;
	color: #58180d;
	min-width: 30px;
	text-align: center;
}

.pdf-prof-box__label {
	font-size: 7.5pt;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.3px;
	color: #333;
}

/* ======== SAVING THROWS ======== */
.pdf-save-row {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 8pt;
	line-height: 1.6;
}

.pdf-save__dot {
	font-size: 8pt;
	width: 10px;
	text-align: center;
	color: #58180d;
}

.pdf-save__mod {
	font-weight: 600;
	width: 26px;
	text-align: right;
	font-size: 8pt;
	font-variant-numeric: tabular-nums;
}

.pdf-save__label {
	color: #333;
}

/* ======== SKILLS ======== */
.pdf-skill-row {
	display: flex;
	align-items: center;
	gap: 3px;
	font-size: 7.5pt;
	line-height: 1.5;
}

.pdf-skill__dot {
	font-size: 7pt;
	width: 9px;
	text-align: center;
	color: #58180d;
}

.pdf-skill__mod {
	font-weight: 600;
	width: 24px;
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.pdf-skill__name {
	flex: 1;
}

.pdf-skill__ability {
	font-size: 6pt;
	color: #777;
}

.pdf-skill__passive {
	font-size: 6pt;
	font-weight: 600;
	color: #58180d;
	background: rgba(88, 24, 13, 0.08);
	padding: 0 3px;
	border-radius: 2px;
	min-width: 14px;
	text-align: center;
}

/* ======== COMBAT STATS ======== */
.pdf-combat-grid {
	display: flex;
	gap: 6px;
	margin-bottom: 6px;
	align-items: flex-start;
}

/* ---- Shield-shaped AC ---- */
.pdf-ac-shield {
	flex: 0 0 auto;
	width: 52px;
	text-align: center;
	padding: 6px 4px 10px;
	background: linear-gradient(180deg, rgba(88,24,13,0.08) 0%, rgba(88,24,13,0.03) 100%);
	border: 2px solid #58180d;
	clip-path: polygon(0% 0%, 100% 0%, 100% 70%, 50% 100%, 0% 70%);
	position: relative;
}

.pdf-ac-shield__value {
	font-size: 20pt;
	font-weight: 700;
	line-height: 1;
	color: #58180d;
}

.pdf-ac-shield__label {
	font-size: 6pt;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #58180d;
	font-weight: 700;
}

.pdf-stat-box {
	flex: 1;
	text-align: center;
	border: 2px solid #58180d;
	border-radius: 4px;
	padding: 5px 3px;
	background: rgba(255,255,255,0.5);
}

.pdf-stat-box__value {
	font-size: 15pt;
	font-weight: 700;
	line-height: 1.1;
	font-variant-numeric: tabular-nums;
}

.pdf-stat-box__label {
	font-size: 6pt;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #58180d;
	font-weight: 600;
}

/* ---- Speed detail ---- */
.pdf-speed-detail {
	font-size: 7pt;
	color: #444;
	margin-bottom: 4px;
	padding-left: 2px;
}

/* ---- HP Block ---- */
.pdf-hp-block {
	margin-bottom: 6px;
	padding: 5px 7px;
	background: rgba(255,255,255,0.4);
	border: 2px solid #58180d;
	border-radius: 4px;
}

.pdf-hp-row {
	font-size: 8.5pt;
	margin-bottom: 2px;
	display: flex;
	align-items: center;
	gap: 4px;
}

.pdf-hp__current {
	font-size: 15pt;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}

.pdf-hp__sep {
	color: #888;
}

.pdf-hp__max {
	font-size: 10pt;
	color: #444;
	font-variant-numeric: tabular-nums;
}

.pdf-hp__temp {
	font-size: 7.5pt;
	color: #4a7c59;
	font-style: italic;
}

/* ---- Death Saves ---- */
.pdf-death-saves {
	margin-bottom: 5px;
}

.pdf-death-saves__row {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 8pt;
}

.pdf-death-saves__group {
	display: flex;
	align-items: center;
	gap: 2px;
}

.pdf-death-saves__label {
	font-size: 7pt;
	font-weight: 600;
	color: #58180d;
}

.pdf-circles {
	letter-spacing: 2px;
	font-size: 9pt;
	color: #58180d;
}

/* ---- Exhaustion ---- */
.pdf-exhaustion-row {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 8pt;
	margin-bottom: 6px;
}

/* ---- Pips ---- */
.pdf-pips {
	letter-spacing: 1px;
	font-size: 7.5pt;
}

.pdf-slot-pips {
	letter-spacing: 2px;
	font-size: 10pt;
	color: #58180d;
}

/* ======== ACTIONS SECTION ======== */
.pdf-section--actions {
	margin-top: 4px;
	border-top: 1.5px solid #c9ad6a;
	padding-top: 4px;
}

.pdf-actions-grid {
	display: grid;
	grid-template-columns: 1fr 1fr 1fr;
	gap: 2px 12px;
}

.pdf-actions-col__title {
	font-size: 7pt;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #58180d;
	margin-bottom: 2px;
	border-bottom: 1px solid #ddd;
	padding-bottom: 1px;
}

.pdf-action-item {
	font-size: 7pt;
	line-height: 1.4;
	color: #222;
}

.pdf-action-item--standard {
	color: #777;
}

.pdf-action__uses {
	font-size: 6pt;
	color: #58180d;
	margin-left: 2px;
}

.pdf-action__suffix {
	font-size: 5.5pt;
	color: #999;
	margin-left: 1px;
}

/* ======== PAGE 1 FOOTER ======== */
.pdf-page-footer {
	margin-top: 6px;
	border-top: 2px solid #c9ad6a;
	padding-top: 6px;
}

.pdf-footer-row {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 14px;
	margin-bottom: 4px;
}

.pdf-footer-item {
	font-size: 7.5pt;
	flex: 0 1 auto;
}

.pdf-footer-item--wide {
	flex: 1 1 100%;
}

.pdf-footer-item__content {
	color: #333;
}

/* ---- Condition Chips ---- */
.pdf-condition-chip {
	display: inline-block;
	font-size: 7pt;
	font-weight: 600;
	padding: 1px 5px;
	border-radius: 3px;
	background: rgba(180, 40, 40, 0.1);
	color: #8b0000;
	border: 1px solid rgba(180, 40, 40, 0.2);
	margin: 1px 2px;
}

.pdf-condition-chip--state {
	background: rgba(26, 60, 94, 0.1);
	color: #1a3c5e;
	border-color: rgba(26, 60, 94, 0.25);
}

/* ======== TABLES ======== */
.pdf-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 7.5pt;
	margin-bottom: 4px;
}

.pdf-table th {
	text-align: left;
	font-weight: 700;
	font-size: 6.5pt;
	text-transform: uppercase;
	letter-spacing: 0.3px;
	color: #58180d;
	border-bottom: 1.5px solid #c9ad6a;
	padding: 2px 4px;
}

.pdf-table td {
	padding: 2px 4px;
	border-bottom: 0.5px solid #e0d5b7;
	vertical-align: top;
}

.pdf-table tbody tr:nth-child(even) td {
	background: rgba(88, 24, 13, 0.03);
}

.pdf-table--attacks .pdf-atk__bonus,
.pdf-table--attacks .pdf-atk__damage {
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.pdf-table--attacks .pdf-atk__props {
	font-size: 6.5pt;
	color: #555;
}

.pdf-atk__upgrade-note {
	font-size: 6pt;
	color: #666;
	font-style: italic;
	margin-top: 1px;
}

.pdf-table--spells .pdf-spell__unprepared {
	color: #999;
}

.pdf-table--spells tr.pdf-spell-row--unprepared {
	opacity: 0.5;
}

.pdf-table--inventory .pdf-inv__eq,
.pdf-table--inventory .pdf-inv__att {
	text-align: center;
	width: 24px;
}

.pdf-inv__extras {
	font-size: 6pt;
	color: #666;
	font-style: italic;
}

.pdf-upgrade-notes {
	margin-top: 6px;
}

.pdf-upgrade-notes h4 {
	font-size: 7.5pt;
	color: var(--pdf-heading, #5e0000);
	margin: 4px 0 2px;
}

.pdf-upgrade-notes ul {
	margin: 0;
	padding-left: 12px;
	font-size: 6.5pt;
	line-height: 1.4;
}

.pdf-upgrade-notes li {
	margin-bottom: 1px;
}

.pdf-table--comp-abilities {
	margin: 4px 0;
}

.pdf-table--comp-abilities th,
.pdf-table--comp-abilities td {
	text-align: center;
	font-size: 7.5pt;
}

/* ======== FEATURES ======== */
.pdf-section--features {
	page-break-before: always;
	break-before: page;
}

.pdf-feature-group {
	margin-bottom: 8px;
}

.pdf-feature-group__title {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 9pt;
	font-weight: bold;
	color: #58180d;
	margin-bottom: 3px;
	padding-left: 6px;
	border-left: 3px solid #c9ad6a;
}

.pdf-feature {
	margin-bottom: 3px;
	padding-left: 6px;
	page-break-inside: avoid;
	break-inside: avoid;
}

.pdf-feature__header {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
}

.pdf-feature__name {
	font-weight: 600;
	font-size: 8pt;
}

.pdf-feature__level {
	font-size: 6.5pt;
	color: #777;
}

.pdf-feature__summary {
	font-size: 7pt;
	color: #444;
	margin-top: 1px;
	line-height: 1.25;
	font-style: italic;
	orphans: 2;
	widows: 2;
}

.pdf-feature__desc {
	font-size: 7pt;
	color: #333;
	margin-top: 1px;
	line-height: 1.3;
	orphans: 2;
	widows: 2;
}

/* ---- Feature Details Appendix ---- */
.pdf-section--details {
	page-break-before: always;
	break-before: page;
}

.pdf-details-columns {
	column-count: 2;
	column-gap: 16px;
	column-rule: 1px solid #c9ad6a;
}

.pdf-details-columns .pdf-feature-group {
	break-inside: avoid;
}

.pdf-details-columns .pdf-feature {
	break-inside: avoid;
}

/* ======== SPELLCASTING ======== */
.pdf-spell-meta {
	font-size: 8.5pt;
	margin-bottom: 5px;
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
}

.pdf-spell-summary {
	font-size: 7pt;
	color: #555;
	font-style: italic;
	margin-bottom: 4px;
}

.pdf-spell-slots {
	margin-bottom: 5px;
}

.pdf-slot-row {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 8pt;
	margin-bottom: 2px;
}

.pdf-slot__level {
	font-weight: 600;
	width: 28px;
	text-align: right;
}

.pdf-spell-group {
	margin-bottom: 5px;
	page-break-inside: avoid;
	break-inside: avoid;
}

/* ======== INVENTORY ======== */
.pdf-currency {
	font-size: 8.5pt;
	margin-bottom: 5px;
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.pdf-currency__item {
	font-weight: 600;
}

/* ======== TGTT SECTIONS ======== */
.pdf-tgtt-wrapper {
	margin-top: 10px;
	border-top: 2px solid #1a3c5e;
	padding-top: 6px;
}

.pdf-tgtt-banner {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 9pt;
	font-weight: bold;
	color: #1a3c5e;
	letter-spacing: 1px;
	text-transform: uppercase;
	margin-bottom: 6px;
}

.pdf-tgtt-badge {
	font-size: 6pt;
	color: #fff;
	background: #1a3c5e;
	padding: 1px 4px;
	border-radius: 3px;
	text-transform: uppercase;
	letter-spacing: 0.3px;
	margin-left: 4px;
	vertical-align: middle;
}

.pdf-section__title--tgtt {
	color: #1a3c5e;
	border-bottom-color: #5a7fa0;
}

.pdf-section__title--tgtt::before {
	background: #5a7fa0;
}

.pdf-section--tgtt {
	border-left: 3px solid #1a3c5e;
	padding-left: 8px;
}

.pdf-tgtt-row {
	font-size: 8pt;
	margin-bottom: 3px;
}

.pdf-traditions {
	font-size: 8pt;
	margin-bottom: 4px;
}

.pdf-tradition {
	background: rgba(26, 60, 94, 0.08);
	padding: 1px 6px;
	border-radius: 3px;
	border: 1px solid rgba(26, 60, 94, 0.2);
}

.pdf-tgtt-abilities ul {
	margin: 2px 0 0 16px;
	padding: 0;
	font-size: 7.5pt;
}

.pdf-tgtt-abilities li {
	margin-bottom: 1px;
}

/* ======== COMPANIONS ======== */
.pdf-companion {
	border: 1.5px solid #58180d;
	border-radius: 4px;
	padding: 7px;
	margin-bottom: 8px;
	background: rgba(255,255,255,0.4);
	page-break-inside: avoid;
	break-inside: avoid;
}

.pdf-companion__header {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	border-bottom: 1px solid #c9ad6a;
	padding-bottom: 3px;
	margin-bottom: 4px;
}

.pdf-companion__name {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 11pt;
	font-weight: bold;
	color: #58180d;
}

.pdf-companion__type {
	font-size: 7.5pt;
	font-style: italic;
	color: #444;
}

.pdf-companion__stats {
	font-size: 8pt;
	margin-bottom: 4px;
}

.pdf-comp__section {
	margin-top: 4px;
	font-size: 7.5pt;
}

.pdf-comp__trait {
	margin-bottom: 3px;
	padding-left: 4px;
	orphans: 2;
	widows: 2;
}

/* ======== INLINE TABLES (feature descriptions) ======== */
.pdf-table--inline {
	margin: 4px 0;
	width: 100%;
	border-collapse: collapse;
	font-size: 7pt;
}

.pdf-table--inline th,
.pdf-table--inline td {
	padding: 2px 6px;
	border-bottom: 0.5px solid #e0d5b7;
	text-align: left;
	vertical-align: top;
}

.pdf-table--inline th {
	font-weight: 700;
	color: #58180d;
	border-bottom: 1.5px solid #c9ad6a;
	font-size: 6.5pt;
}

/* ======== GOLD DIVIDER ORNAMENTS (diamond-line pattern) ======== */
.pdf-divider-ornament {
	position: relative;
	height: 12px;
	margin-bottom: 10px;
}

.pdf-divider-ornament::before {
	content: "";
	position: absolute;
	top: 50%;
	left: 0;
	right: 0;
	height: 1.5px;
	background: linear-gradient(90deg, transparent, #c9ad6a 10%, #c9ad6a 90%, transparent);
}

.pdf-divider-ornament::after {
	content: "";
	position: absolute;
	top: 50%;
	left: 50%;
	width: 8px;
	height: 8px;
	background: #c9ad6a;
	border: 1px solid #b89a56;
	transform: translate(-50%, -50%) rotate(45deg);
}

.pdf-section--features::before,
.pdf-section--details::before {
	content: "";
	display: block;
	height: 12px;
	position: relative;
	margin-bottom: 10px;
}

.pdf-section--features::after,
.pdf-section--details::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	height: 1.5px;
	background: linear-gradient(90deg, transparent, #c9ad6a 10%, #c9ad6a 90%, transparent);
	margin-top: -16px;
}

.pdf-section--spells > .pdf-section__title::after,
.pdf-section--companions > .pdf-section__title::after,
.pdf-section--inventory > .pdf-section__title::after {
	content: "";
	display: block;
	height: 1.5px;
	background: linear-gradient(90deg, transparent, #c9ad6a 10%, #c9ad6a 90%, transparent);
	margin-top: 4px;
	margin-bottom: 6px;
}

/* ======== PRINT ======== */
@media print {
	body {
		background: #fdf1dc;
	}

	.pdf-sheet {
		max-width: none;
	}
}

/* ======== SCREEN PREVIEW ======== */
@media screen {
	body {
		padding: 24px;
		background: #555;
	}

	.pdf-sheet {
		background: #fdf1dc;
		padding: 0.5in 0.55in;
		box-shadow: 0 6px 30px rgba(0,0,0,0.4);
		border-radius: 2px;
	}

	.pdf-page-break {
		height: 20px;
		border-top: 2px dashed #ccc;
		margin: 16px 0;
	}
}
`;

// endregion

export {CharacterSheetPdf};
