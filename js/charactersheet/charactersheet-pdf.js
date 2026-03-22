/**
 * Character Sheet PDF Renderer
 * Generates a self-contained, print-optimized HTML document from CharacterSheetState data.
 * Opens in a new browser window for printing or "Save as PDF".
 *
 * Visual style: Classic D&D parchment-inspired sheet with maroon accents.
 * TGTT/Thelemar sections render conditionally when relevant data is present.
 */

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};

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
		const sections = [
			this._renderHeader(),
			`<div class="pdf-page pdf-page--stats">`,
			`<div class="pdf-col pdf-col--abilities">`,
			this._renderAbilityScores(),
			`</div>`,
			`<div class="pdf-col pdf-col--center">`,
			this._renderSavingThrows(),
			this._renderSkills(),
			`</div>`,
			`<div class="pdf-col pdf-col--right">`,
			this._renderCombatStats(),
			this._renderAttacks(),
			this._renderDefenses(),
			this._renderSenses(),
			this._renderProficiencies(),
			`</div>`,
			`</div>`, // close pdf-page--stats
			this._renderCarryAndJump(),
		];

		// Features (new page group) — class/race first, then background feature only
		const featuresHtml = this._renderFeatures();
		if (featuresHtml) sections.push(`<div class="pdf-page-break"></div>`, featuresHtml);

		// Spellcasting
		const spellsHtml = this._renderSpellcasting();
		if (spellsHtml) sections.push(spellsHtml);

		// Inventory
		const inventoryHtml = this._renderInventory();
		if (inventoryHtml) sections.push(inventoryHtml);

		// TGTT sections (conditional)
		const tgttHtml = this._renderTgttSections();
		if (tgttHtml) sections.push(tgttHtml);

		// Companions (separate page)
		const companionsHtml = this._renderCompanions();
		if (companionsHtml) sections.push(`<div class="pdf-page-break"></div>`, companionsHtml);

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
		const alignment = this._esc(this._state.getAlignment() || "—");
		const totalLevel = this._state.getTotalLevel();
		const xp = this._state.getXp();
		const profBonus = this._fmtMod(this._state.getProficiencyBonus());

		return `<div class="pdf-header">
			<div class="pdf-header__name">${name}</div>
			<div class="pdf-header__details">
				<div class="pdf-header__detail"><span class="pdf-label">Class</span> ${classStr}</div>
				<div class="pdf-header__detail"><span class="pdf-label">Race</span> ${raceName}</div>
				<div class="pdf-header__detail"><span class="pdf-label">Background</span> ${bgName}</div>
				<div class="pdf-header__detail"><span class="pdf-label">Alignment</span> ${alignment}</div>
				<div class="pdf-header__detail"><span class="pdf-label">Level</span> ${totalLevel}</div>
				<div class="pdf-header__detail"><span class="pdf-label">XP</span> ${xp.toLocaleString()}</div>
				<div class="pdf-header__detail"><span class="pdf-label">Proficiency</span> ${profBonus}</div>
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
				<div class="pdf-ability__label">${ABILITY_LABELS[ab]}</div>
				<div class="pdf-ability__mod">${this._fmtMod(mod)}</div>
				<div class="pdf-ability__score">${score}</div>
			</div>`;
		}).join("\n");

		return `<div class="pdf-section pdf-section--abilities">${boxes}</div>`;
	}

	// endregion

	// region Combat Stats

	_renderCombatStats () {
		const ac = this._state.getAc();
		const hp = this._state.getHp();
		const initiative = this._state.getInitiative();
		const speedStr = this._state.getSpeed();
		const hitDice = this._state.getHitDice();

		const hitDiceStr = hitDice.map(hd => `${hd.current}/${hd.max}${hd.type}`).join(", ");

		// Exhaustion
		const exhaustion = this._state.getExhaustion();
		const exhaustionRules = this._state.getExhaustionRules?.() || "classic";
		const maxExhaustion = exhaustionRules === "thelemar" ? 10 : 6;
		const exhaustionPips = this._renderPips(exhaustion, maxExhaustion);

		return `<div class="pdf-section">
			<h3 class="pdf-section__title">Combat</h3>
			<div class="pdf-combat-grid">
				<div class="pdf-stat-box">
					<div class="pdf-stat-box__value">${ac}</div>
					<div class="pdf-stat-box__label">Armor Class</div>
				</div>
				<div class="pdf-stat-box">
					<div class="pdf-stat-box__value">${this._fmtMod(initiative)}</div>
					<div class="pdf-stat-box__label">Initiative</div>
				</div>
				<div class="pdf-stat-box">
					<div class="pdf-stat-box__value">${this._esc(speedStr)}</div>
					<div class="pdf-stat-box__label">Speed</div>
				</div>
			</div>
			<div class="pdf-hp-block">
				<div class="pdf-hp-row">
					<span class="pdf-label">HP</span>
					<span class="pdf-hp__current">${hp.current ?? hp.max}</span>
					<span class="pdf-hp__sep">/</span>
					<span class="pdf-hp__max">${hp.max}</span>
					${hp.temp ? `<span class="pdf-hp__temp">(+${hp.temp} temp)</span>` : ""}
				</div>
				<div class="pdf-hp-row">
					<span class="pdf-label">Hit Dice</span> ${hitDiceStr}
				</div>
				<div class="pdf-hp-row">
					<span class="pdf-label">Exhaustion</span> ${exhaustionPips}
					${exhaustionRules === "thelemar" ? `<span class="pdf-tgtt-badge">Thelemar</span>` : ""}
				</div>
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

		return `<div class="pdf-section">
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

		return `<div class="pdf-section">
			<h3 class="pdf-section__title">Skills</h3>
			${rows}
		</div>`;
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

		return `<div class="pdf-section pdf-section--senses">
			<h3 class="pdf-section__title">Senses</h3>
			<div class="pdf-senses">${parts.join(" · ")}</div>
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
		if (resistances.length) lines.push(`<div class="pdf-defense-row"><span class="pdf-label">Resistances</span> ${this._esc(resistances.join(", "))}</div>`);
		if (immunities.length) lines.push(`<div class="pdf-defense-row"><span class="pdf-label">Immunities</span> ${this._esc(immunities.join(", "))}</div>`);
		if (vulnerabilities.length) lines.push(`<div class="pdf-defense-row"><span class="pdf-label">Vulnerabilities</span> ${this._esc(vulnerabilities.join(", "))}</div>`);
		if (condImmunities.length) lines.push(`<div class="pdf-defense-row"><span class="pdf-label">Cond. Immunities</span> ${this._esc(condImmunities.join(", "))}</div>`);

		return `<div class="pdf-section">
			<h3 class="pdf-section__title">Defenses</h3>
			${lines.join("\n")}
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

		if (armor.length) groups.push(`<div class="pdf-prof-group"><span class="pdf-label">Armor</span> ${this._esc(this._stripTags(armor.join(", ")))}</div>`);
		if (weapons.length) groups.push(`<div class="pdf-prof-group"><span class="pdf-label">Weapons</span> ${this._esc(this._stripTags(weapons.join(", ")))}</div>`);
		if (tools.length) groups.push(`<div class="pdf-prof-group"><span class="pdf-label">Tools</span> ${this._esc(this._stripTags(tools.join(", ")))}</div>`);
		if (languages.length) groups.push(`<div class="pdf-prof-group"><span class="pdf-label">Languages</span> ${this._esc(this._cleanPipeSource(languages).join(", "))}</div>`);

		if (!groups.length) return "";

		return `<div class="pdf-section">
			<h3 class="pdf-section__title">Proficiencies</h3>
			${groups.join("\n")}
		</div>`;
	}

	// endregion

	// region Attacks

	_renderAttacks () {
		const attacks = this._state.getAttacks();
		if (!attacks.length) return "";

		const rows = attacks.map(atk => {
			const name = this._esc(atk.name || "Attack");
			const bonus = atk.bonus != null ? this._fmtMod(atk.bonus) : "—";
			const damage = this._esc(atk.damage || "—");
			const damageType = this._esc(atk.damageType || "");
			const range = this._esc(atk.range || "");
			return `<tr>
				<td class="pdf-atk__name">${name}</td>
				<td class="pdf-atk__bonus">${bonus}</td>
				<td class="pdf-atk__damage">${damage} ${damageType}</td>
				<td class="pdf-atk__range">${range}</td>
			</tr>`;
		}).join("\n");

		return `<div class="pdf-section">
			<h3 class="pdf-section__title">Attacks</h3>
			<table class="pdf-table pdf-table--attacks">
				<thead><tr><th>Name</th><th>Bonus</th><th>Damage</th><th>Range</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	}

	// endregion

	// region Features

	/**
	 * Feature group ordering: Species/Race → Class → Background (feature only) → Feat.
	 * Combat methods (CTM:*) are handled by TGTT section, not rendered here.
	 * Background fluff (personality traits, bonds, flaws, contacts, tables) is excluded.
	 */
	_renderFeatures () {
		const features = this._state.getFeatures();
		if (!features.length) return "";

		// Filter: remove combat methods (handled by TGTT) and keep only relevant features
		const filtered = features.filter(f => {
			// Exclude combat tradition methods — they go under TGTT
			if (f.optionalFeatureTypes?.some(ft => ft?.startsWith?.("CTM:"))) return false;
			return true;
		});

		if (!filtered.length) return "";

		// Group and order: Species/Race → Class → Background → Feat → Other
		const groupOrder = ["Species", "Race", "Subrace", "Class", "Background", "Feat", "Optional Feature", "Other"];
		const groups = {};
		for (const f of filtered) {
			let group = f.featureType || f.className || "Other";
			// Normalize class name grouping: use "Class" + className for class features
			if (group === "Class" && f.className) group = f.className;
			(groups[group] = groups[group] || []).push(f);
		}

		// Sort groups by priority
		const sortedEntries = Object.entries(groups).sort(([a], [b]) => {
			const ia = groupOrder.indexOf(a);
			const ib = groupOrder.indexOf(b);
			// Groups not in order list (class names) go after Class position
			const posA = ia >= 0 ? ia : groupOrder.indexOf("Class") + 0.5;
			const posB = ib >= 0 ? ib : groupOrder.indexOf("Class") + 0.5;
			return posA - posB;
		});

		const sections = sortedEntries.map(([group, feats]) => {
			const rows = feats.map(f => this._renderSingleFeature(f)).join("\n");
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

	_renderSingleFeature (f) {
		const name = this._esc(f.name);
		const usesStr = f.uses ? ` (${f.uses.current}/${f.uses.max} • ${this._esc(f.uses.recharge || "long rest")})` : "";
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
			parts.push(`<div class="pdf-spell-meta">${dcParts.join(" · ")}</div>`);
		}

		// Spell slots
		const slots = sc.spellSlots || {};
		const slotLevels = Object.keys(slots).map(Number).filter(n => n >= 1).sort((a, b) => a - b);
		if (slotLevels.length) {
			const slotRows = slotLevels.map(lvl => {
				const slot = slots[lvl];
				const max = slot.max || 0;
				if (!max) return "";
				const pips = this._renderPips(slot.current ?? max, max);
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
			const school = sp.school ? (SPELL_SCHOOL_LABELS[sp.school] || sp.school) : "";
			const time = this._esc(sp.time || "");
			const range = this._esc(sp.range || "");
			const components = this._esc(sp.components || "");
			const concentration = sp.concentration ? " (C)" : "";
			const ritual = sp.ritual ? " (R)" : "";
			const prepared = sp.prepared === false ? `<span class="pdf-spell__unprepared">✗</span>` : "";
			return `<tr>
				<td class="pdf-spell__name">${name}${concentration}${ritual} ${prepared}</td>
				<td class="pdf-spell__school">${school}</td>
				<td class="pdf-spell__time">${time}</td>
				<td class="pdf-spell__range">${range}</td>
				<td class="pdf-spell__comp">${components}</td>
			</tr>`;
		}).join("\n");

		return `<div class="pdf-spell-group">
			<h4 class="pdf-subsection__title">${this._esc(title)}</h4>
			<table class="pdf-table pdf-table--spells">
				<thead><tr><th>Spell</th><th>School</th><th>Time</th><th>Range</th><th>Comp.</th></tr></thead>
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
				return `<tr>
					<td class="pdf-inv__name">${name}</td>
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

		const exertionMax = this._state.getExertionMax?.() || 0;
		const exertionCurrent = this._state.getExertionCurrent?.() || 0;
		const activeStance = this._state.getActiveStance?.();

		const tradRows = traditions.map(t =>
			`<span class="pdf-tradition">${this._esc(t.name || t.code)}</span>`,
		).join(" · ");

		const exertionPips = exertionMax > 0 ? `<div class="pdf-tgtt-row"><span class="pdf-label">Exertion</span> ${this._renderPips(exertionCurrent, exertionMax)}</div>` : "";
		const stanceRow = activeStance ? `<div class="pdf-tgtt-row"><span class="pdf-label">Stance</span> ${this._esc(activeStance)}</div>` : "";

		// Render combat methods (CTM:*) that were excluded from features section
		const allFeatures = this._state.getFeatures?.() || [];
		const methods = allFeatures.filter(f => f.optionalFeatureTypes?.some(ft => ft?.startsWith?.("CTM:")));
		const methodsHtml = methods.length
			? `<div class="pdf-tgtt-methods"><h4 class="pdf-subsection__title" style="color:#1a3c5e">Methods</h4>${methods.map(f => this._renderSingleFeature(f)).join("\n")}</div>`
			: "";

		return `<div class="pdf-section pdf-section--tgtt">
			<h3 class="pdf-section__title pdf-section__title--tgtt">Combat Traditions</h3>
			<div class="pdf-traditions">${tradRows}</div>
			${exertionPips}
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
		return `<span class="pdf-pips">${"●".repeat(filled)}${"○".repeat(empty)}</span>`;
	}

	// endregion

	// region Carry Weight & Jump

	_renderCarryAndJump () {
		const parts = [];

		// Carrying capacity
		const capacity = this._state.getCarryingCapacity?.();
		const weight = this._state.getTotalWeight?.();
		if (capacity != null) {
			const encLevel = this._state.getEncumbranceLevel?.() || "normal";
			const encLabel = encLevel === "normal" ? "" : ` (${encLevel.replace(/_/g, " ")})`;
			parts.push(`<span><strong>Carry</strong> ${weight != null ? `${weight}/` : ""}${capacity} lb.${encLabel}</span>`);
		}

		// Jump distances — respect Thelemar rules if enabled
		const settings = this._state.getSettings?.() || {};
		const jumpMult = this._state.getJumpMultiplierFromStates?.() ?? 1;
		let longJump, highJump;

		if (settings.thelemar_jumping) {
			// Thelemar: Athletics-based
			const athleticsMod = this._state.getSkillMod("athletics");
			longJump = Math.floor((8 + athleticsMod) * jumpMult);
			highJump = Math.max(0, Math.floor((2 + athleticsMod * 0.5) * jumpMult));
		} else {
			// Standard: STR-based
			const strScore = this._state.getAbilityScore("str");
			const strMod = this._state.getAbilityMod("str");
			longJump = Math.floor(strScore * jumpMult);
			highJump = Math.max(0, Math.floor((3 + strMod) * jumpMult));
		}
		parts.push(`<span><strong>Long Jump</strong> ${longJump} ft.</span>`);
		parts.push(`<span><strong>High Jump</strong> ${highJump} ft.</span>`);

		if (!parts.length) return "";

		return `<div class="pdf-section pdf-section--carry">
			<div class="pdf-senses">${parts.join(" · ")}</div>
		</div>`;
	}

	// endregion
}

// region CSS

CharacterSheetPdf._CSS = `
/* ========================================
   Character Sheet PDF — Print Stylesheet
   Classic D&D parchment-inspired layout
   3-column: Abilities | Saves+Skills | Combat+Attacks
   ======================================== */

@page {
	size: letter;
	margin: 0.4in 0.5in;
}

*, *::before, *::after {
	box-sizing: border-box;
	margin: 0;
	padding: 0;
}

body {
	font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
	font-size: 9pt;
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

/* ---- Header ---- */
.pdf-header {
	border-bottom: 3px double #58180d;
	padding-bottom: 8px;
	margin-bottom: 12px;
}

.pdf-header__name {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 24pt;
	font-weight: bold;
	color: #58180d;
	letter-spacing: 0.5px;
	line-height: 1.1;
}

.pdf-header__details {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 18px;
	margin-top: 6px;
	font-size: 8.5pt;
}

.pdf-header__detail {
	white-space: nowrap;
}

/* ---- Labels ---- */
.pdf-label {
	font-weight: 600;
	color: #58180d;
	margin-right: 4px;
}

/* ---- Sections ---- */
.pdf-section {
	margin-bottom: 10px;
	page-break-inside: avoid;
	break-inside: avoid;
}

.pdf-section__title {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 10pt;
	font-weight: bold;
	color: #58180d;
	border-bottom: 2px solid #c9ad6a;
	padding-bottom: 2px;
	margin-bottom: 6px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.pdf-subsection__title {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 9pt;
	font-weight: bold;
	color: #58180d;
	margin: 6px 0 3px;
}

/* ---- Stats Page — 3 Column Grid ---- */
.pdf-page--stats {
	display: grid;
	grid-template-columns: 78px 1fr 1fr;
	gap: 0 14px;
	align-items: start;
}

.pdf-col--center {
	border-left: 1px solid #c9ad6a;
	padding-left: 12px;
}

.pdf-col--right {
	border-left: 1px solid #c9ad6a;
	padding-left: 12px;
}

/* ---- Ability Scores (Vertical Stack) ---- */
.pdf-section--abilities {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-bottom: 0;
}

.pdf-ability {
	text-align: center;
	border: 2px solid #58180d;
	border-radius: 6px;
	padding: 4px 2px 5px;
	background: rgba(255,255,255,0.5);
}

.pdf-ability__label {
	font-size: 6.5pt;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.3px;
	color: #58180d;
}

.pdf-ability__mod {
	font-size: 18pt;
	font-weight: 700;
	line-height: 1.15;
}

.pdf-ability__score {
	font-size: 8.5pt;
	color: #555;
	border-top: 1px solid #c9ad6a;
	margin-top: 2px;
	padding-top: 2px;
}

/* ---- Saving Throws ---- */
.pdf-save-row {
	display: flex;
	align-items: center;
	gap: 5px;
	font-size: 8.5pt;
	line-height: 1.65;
}

.pdf-save__dot {
	font-size: 7pt;
	width: 10px;
	text-align: center;
	color: #58180d;
}

.pdf-save__mod {
	font-weight: 600;
	width: 28px;
	text-align: right;
	font-size: 8.5pt;
}

.pdf-save__label {
	color: #333;
}

/* ---- Skills ---- */
.pdf-skill-row {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 8pt;
	line-height: 1.55;
}

.pdf-skill__dot {
	font-size: 6.5pt;
	width: 10px;
	text-align: center;
	color: #58180d;
}

.pdf-skill__mod {
	font-weight: 600;
	width: 26px;
	text-align: right;
}

.pdf-skill__name {
	flex: 1;
}

.pdf-skill__ability {
	font-size: 6.5pt;
	color: #999;
}

.pdf-skill__passive {
	font-size: 6.5pt;
	font-weight: 600;
	color: #58180d;
	background: rgba(88, 24, 13, 0.08);
	padding: 0 3px;
	border-radius: 2px;
	min-width: 14px;
	text-align: center;
}

/* ---- Senses ---- */
.pdf-section--senses {
	margin-top: 4px;
}

.pdf-senses {
	font-size: 8.5pt;
	display: flex;
	flex-wrap: wrap;
	gap: 2px 10px;
}

/* ---- Combat Stats ---- */
.pdf-combat-grid {
	display: flex;
	gap: 8px;
	margin-bottom: 8px;
}

.pdf-stat-box {
	flex: 1;
	text-align: center;
	border: 2px solid #58180d;
	border-radius: 4px;
	padding: 6px 4px;
	background: rgba(255,255,255,0.5);
}

.pdf-stat-box__value {
	font-size: 16pt;
	font-weight: 700;
	line-height: 1.1;
}

.pdf-stat-box__label {
	font-size: 6.5pt;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #58180d;
	font-weight: 600;
}

/* ---- HP Block ---- */
.pdf-hp-block {
	margin-bottom: 8px;
	padding: 6px 8px;
	background: rgba(255,255,255,0.4);
	border: 1px solid #c9ad6a;
	border-radius: 4px;
}

.pdf-hp-row {
	font-size: 9pt;
	margin-bottom: 3px;
	display: flex;
	align-items: center;
	gap: 4px;
}

.pdf-hp__current {
	font-size: 16pt;
	font-weight: 700;
}

.pdf-hp__sep {
	color: #888;
}

.pdf-hp__max {
	font-size: 11pt;
	color: #555;
}

.pdf-hp__temp {
	font-size: 8pt;
	color: #4a7c59;
	font-style: italic;
}

/* ---- Defense Rows ---- */
.pdf-defense-row {
	font-size: 8.5pt;
	margin-bottom: 3px;
}

/* ---- Proficiency Groups ---- */
.pdf-prof-group {
	font-size: 8.5pt;
	margin-bottom: 3px;
}

/* ---- Tables ---- */
.pdf-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 8pt;
	margin-bottom: 4px;
}

.pdf-table th {
	text-align: left;
	font-weight: 700;
	font-size: 7pt;
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

.pdf-table--attacks .pdf-atk__bonus,
.pdf-table--attacks .pdf-atk__damage {
	font-weight: 600;
}

.pdf-table--spells .pdf-spell__unprepared {
	color: #999;
}

.pdf-table--inventory .pdf-inv__eq,
.pdf-table--inventory .pdf-inv__att {
	text-align: center;
	width: 28px;
}

.pdf-table--comp-abilities {
	margin: 4px 0;
}

.pdf-table--comp-abilities th,
.pdf-table--comp-abilities td {
	text-align: center;
	font-size: 8pt;
}

/* ---- Features ---- */
.pdf-section--features {
	page-break-before: always;
	break-before: page;
}

.pdf-feature-group {
	margin-bottom: 10px;
}

.pdf-feature-group__title {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 9.5pt;
	font-weight: bold;
	color: #58180d;
	margin-bottom: 4px;
	padding-left: 6px;
	border-left: 3px solid #c9ad6a;
}

.pdf-feature {
	margin-bottom: 4px;
	padding-left: 6px;
}

.pdf-feature__header {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
}

.pdf-feature__name {
	font-weight: 600;
	font-size: 8.5pt;
}

.pdf-feature__level {
	font-size: 7pt;
	color: #888;
}

.pdf-feature__desc {
	font-size: 7.5pt;
	color: #444;
	margin-top: 1px;
	line-height: 1.3;
}

/* ---- Spellcasting ---- */
.pdf-spell-meta {
	font-size: 9pt;
	margin-bottom: 6px;
	display: flex;
	gap: 12px;
	flex-wrap: wrap;
}

.pdf-spell-slots {
	margin-bottom: 6px;
}

.pdf-slot-row {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 8.5pt;
	margin-bottom: 2px;
}

.pdf-slot__level {
	font-weight: 600;
	width: 30px;
	text-align: right;
}

.pdf-pips {
	letter-spacing: 1px;
	font-size: 8pt;
}

.pdf-spell-group {
	margin-bottom: 6px;
	page-break-inside: avoid;
	break-inside: avoid;
}

/* ---- Inventory ---- */
.pdf-currency {
	font-size: 9pt;
	margin-bottom: 6px;
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
}

.pdf-currency__item {
	font-weight: 600;
}

/* ---- TGTT Sections ---- */
.pdf-tgtt-wrapper {
	margin-top: 12px;
	border-top: 2px solid #1a3c5e;
	padding-top: 8px;
}

.pdf-tgtt-banner {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 10pt;
	font-weight: bold;
	color: #1a3c5e;
	letter-spacing: 1px;
	text-transform: uppercase;
	margin-bottom: 8px;
}

.pdf-tgtt-badge {
	font-size: 6.5pt;
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

.pdf-section--tgtt {
	border-left: 3px solid #1a3c5e;
	padding-left: 8px;
}

.pdf-tgtt-row {
	font-size: 8.5pt;
	margin-bottom: 3px;
}

.pdf-traditions {
	font-size: 8.5pt;
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
	font-size: 8pt;
}

.pdf-tgtt-abilities li {
	margin-bottom: 1px;
}

/* ---- Companions ---- */
.pdf-companion {
	border: 1.5px solid #58180d;
	border-radius: 4px;
	padding: 8px;
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
	font-size: 12pt;
	font-weight: bold;
	color: #58180d;
}

.pdf-companion__type {
	font-size: 8pt;
	font-style: italic;
	color: #555;
}

.pdf-companion__stats {
	font-size: 8.5pt;
	margin-bottom: 4px;
}

.pdf-comp__section {
	margin-top: 4px;
	font-size: 8pt;
}

.pdf-comp__trait {
	margin-bottom: 3px;
	padding-left: 4px;
}

/* ---- Carry Weight & Jump ---- */
.pdf-section--carry {
	padding-top: 2px;
}

/* ---- Inline Tables (in feature descriptions) ---- */
.pdf-table--inline {
	margin: 4px 0;
	width: 100%;
	border-collapse: collapse;
	font-size: 7.5pt;
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
	font-size: 7pt;
}

/* ---- Print-specific ---- */
@media print {
	body {
		background: #fdf1dc;
	}

	.pdf-sheet {
		max-width: none;
	}
}

@media screen {
	body {
		padding: 20px;
		background: #e8e0d0;
	}

	.pdf-sheet {
		background: #fdf1dc;
		padding: 0.5in 0.6in;
		box-shadow: 0 4px 24px rgba(0,0,0,0.2);
		border-radius: 2px;
	}
}
`;

// endregion

export {CharacterSheetPdf};
