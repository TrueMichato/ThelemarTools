class CharacterSheetNpcExporter {
	static SOURCE_JSON_DEFAULT = "CSHEET";
	static SOURCE_FULL_DEFAULT = "Character Sheet NPC Exports";
	static SOURCE_VERSION_DEFAULT = "1.0.0";

	static getSanitizedSourceConfig (
		{
			sourceJson = CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT,
			abbreviation = sourceJson,
			full = CharacterSheetNpcExporter.SOURCE_FULL_DEFAULT,
			version = CharacterSheetNpcExporter.SOURCE_VERSION_DEFAULT,
		} = {},
	) {
		const safeSourceJson = this._getSafeSourceJson(sourceJson);
		const safeAbbreviation = this._getSafeSourceAbbreviation(abbreviation || safeSourceJson);
		const safeFull = this._getSafeSourceFull(full);
		const safeVersion = this._getSafeVersion(version);

		return {
			sourceJson: safeSourceJson,
			abbreviation: safeAbbreviation,
			full: safeFull,
			version: safeVersion,
		};
	}

	static getDefaultSourceMeta (
		{
			sourceJson = CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT,
			abbreviation = null,
			full = CharacterSheetNpcExporter.SOURCE_FULL_DEFAULT,
			version = CharacterSheetNpcExporter.SOURCE_VERSION_DEFAULT,
			authors = ["Character Sheet"],
			convertedBy = ["Character Sheet"],
		} = {},
	) {
		const sourceConfig = this.getSanitizedSourceConfig({sourceJson, abbreviation, full, version});
		const now = new Date().toISOString().slice(0, 10);
		const safeAuthors = this._getSafeStringList(authors, {maxLen: 64});
		const safeConvertedBy = this._getSafeStringList(convertedBy, {maxLen: 64});
		return {
			json: sourceConfig.sourceJson,
			abbreviation: sourceConfig.abbreviation,
			full: sourceConfig.full,
			authors: safeAuthors.length ? safeAuthors : ["Character Sheet"],
			version: sourceConfig.version,
			convertedBy: safeConvertedBy.length ? safeConvertedBy : ["Character Sheet"],
			dateReleased: now,
		};
	}

	static convertStateToMonster (
		state,
		{
			sourceJson = CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT,
			defenseMode = "persistent",
		} = {},
	) {
		const safeSource = this._getSafeSourceJson(sourceJson);
		const name = this._getSafeName(state.getName?.()) || "Unnamed Character";
		const npcName = this._getNpcReferenceName(name);
		const safeDefenseMode = String(defenseMode || "persistent").toLowerCase() === "active" ? "active" : "persistent";
		const totalLevel = state.getTotalLevel?.() || 0;
		const hp = state.getHp?.() || {current: 0, max: 1};
		const maxHp = Math.max(1, hp.max || 1);
		const ac = Math.max(1, state.getArmorClass?.() ?? state.getAc?.() ?? 10);

		const str = state.getAbilityScore?.("str") ?? 10;
		const dex = state.getAbilityScore?.("dex") ?? 10;
		const con = state.getAbilityScore?.("con") ?? 10;
		const int = state.getAbilityScore?.("int") ?? 10;
		const wis = state.getAbilityScore?.("wis") ?? 10;
		const cha = state.getAbilityScore?.("cha") ?? 10;

		const alignment = this._getAlignmentArray(state.getAlignment?.());
		const size = [this._getSizeAbv(state.getSize?.() || "medium")];
		const speed = this._getSpeedObject(state);
		const saves = this._getSaveBlock(state);
		const skills = this._getSkillBlock(state);
		const senses = this._getSensesBlock(state);
		const passive = state.getPassivePerception?.() ?? 10;
		const languages = this._getSafeStringList(state.getLanguages?.(), {maxLen: 40});
		const defenses = this._getExportDefenses(state, {defenseMode: safeDefenseMode});

		const attacks = this._getMergedAttacks(state);
		const actions = this._getActionEntriesFromAttacks(attacks, state);

		const methodsBlock = this._getCombatMethodsBlock(state, {npcName});
		const specialEquipmentBlock = this._getSpecialEquipmentBlock(state);
		const itemUseBlocks = this._getMagicItemUseBlocks(state, {npcName});
		const spellcastingBlock = this._getSpellcastingBlock(state);

		const featureBlocks = this._getFeatureBlocks(state, {npcName});
		const customAbilityBlocks = this._getCustomAbilityBlocks(state, {npcName});
		const namedModifierTrait = this._getNamedModifierTrait(state, {npcName});
		const levelSignal = {
			name: "Level Signal",
			entries: [
				`Built from a level ${Math.max(0, totalLevel)} character (${this._getSafeInlineText(state.getClassSummary?.() || "No Class", {maxLen: 120})}).`,
			],
		};

		const crInfo = this._estimateCr({
			totalLevel,
			hp: maxHp,
			ac,
			attacks,
			spellcastingBlock,
		});

		const race = state.getRace?.();
		const monsterType = this._getCreatureTypeFromRace(race);

		const out = {
			name: `${name} (NPC)`,
			source: safeSource,
			page: 0,
			size,
			type: monsterType,
			alignment,
			ac: [{ac, from: ["armor"]}],
			hp: {
				average: maxHp,
				formula: this._getHpFormula(maxHp, state.getAbilityMod?.("con") || 0),
			},
			speed,
			str,
			dex,
			con,
			int,
			wis,
			cha,
			passive,
			languages: languages.length ? languages : ["Common"],
			cr: crInfo.cr,
			pbNote: `+${state.getProficiencyBonus?.() ?? 2}`,
			trait: [
				levelSignal,
				...(featureBlocks.trait || []),
				...(customAbilityBlocks.trait || []),
				...(namedModifierTrait ? [namedModifierTrait] : []),
				...(specialEquipmentBlock ? [specialEquipmentBlock] : []),
				...(methodsBlock ? [methodsBlock] : []),
			],
			action: [...actions, ...(featureBlocks.action || []), ...(customAbilityBlocks.action || []), ...(itemUseBlocks.action || [])],
		};

		if ((itemUseBlocks.bonus || []).length || (customAbilityBlocks.bonus || []).length || (featureBlocks.bonus || []).length) out.bonus = [...(featureBlocks.bonus || []), ...(customAbilityBlocks.bonus || []), ...(itemUseBlocks.bonus || [])];
		if ((itemUseBlocks.reaction || []).length || (customAbilityBlocks.reaction || []).length || (featureBlocks.reaction || []).length) out.reaction = [...(featureBlocks.reaction || []), ...(customAbilityBlocks.reaction || []), ...(itemUseBlocks.reaction || [])];

		if (Object.keys(saves).length) out.save = saves;
		if (Object.keys(skills).length) out.skill = skills;
		if (senses.length) out.senses = senses;
		if ((defenses.resist || []).length) out.resist = defenses.resist;
		if ((defenses.immune || []).length) out.immune = defenses.immune;
		if ((defenses.vulnerable || []).length) out.vulnerable = defenses.vulnerable;
		if ((defenses.conditionImmune || []).length) out.conditionImmune = defenses.conditionImmune;

		if (spellcastingBlock) out.spellcasting = [spellcastingBlock];

		return out;
	}

	static _getExportDefenses (state, {defenseMode = "persistent"} = {}) {
		if (defenseMode === "active") {
			const effective = state.getEffectiveDefenses?.() || {};
			return {
				resist: this._getSanitizedDefenseList(effective.resistances),
				immune: this._getSanitizedDefenseList(effective.immunities),
				vulnerable: this._getSanitizedDefenseList(effective.vulnerabilities),
				conditionImmune: this._getSanitizedDefenseList(effective.conditionImmunities, {isCondition: true}),
			};
		}

		const baseData = state?._data || {};
		const itemDefenses = baseData.itemDefenses || {};
		const baseResist = baseData.resistances || [];
		const baseImmune = baseData.immunities || [];
		const baseVulnerable = baseData.vulnerabilities || [];
		const baseConditionImmune = baseData.conditionImmunities || [];

		const itemResist = (itemDefenses.resist || []).map(it => it?.type);
		const itemImmune = (itemDefenses.immune || []).map(it => it?.type);
		const itemVulnerable = (itemDefenses.vulnerable || []).map(it => it?.type);
		const itemConditionImmune = (itemDefenses.conditionImmune || []).map(it => it?.type);

		return {
			resist: this._getSanitizedDefenseList([...baseResist, ...itemResist]),
			immune: this._getSanitizedDefenseList([...baseImmune, ...itemImmune]),
			vulnerable: this._getSanitizedDefenseList([...baseVulnerable, ...itemVulnerable]),
			conditionImmune: this._getSanitizedDefenseList([...baseConditionImmune, ...itemConditionImmune], {isCondition: true}),
		};
	}

	static _getSanitizedDefenseList (values, {isCondition = false} = {}) {
		if (!Array.isArray(values)) return [];
		const out = values
			.map(it => String(it || "").split("|")[0])
			.map(it => it.replace(/^damage:/i, "").replace(/^condition:/i, ""))
			.map(it => this._getSafeInlineText(it, {maxLen: 40}).toLowerCase())
			.filter(Boolean);
		const deduped = [...new Set(out)].sort((a, b) => a.localeCompare(b));
		if (!isCondition) return deduped;
		return deduped.map(it => it.replace(/\s+/g, " ").trim());
	}

	static getValidationIssues (monster) {
		const errors = [];
		const warnings = [];

		if (!monster || typeof monster !== "object") {
			return {errors: ["Monster export payload is missing or invalid."], warnings};
		}

		if (!monster.name || typeof monster.name !== "string") errors.push("Missing required field: name.");
		if (!monster.source || typeof monster.source !== "string") errors.push("Missing required field: source.");
		if (!Array.isArray(monster.size) || !monster.size.length) errors.push("Missing required field: size.");
		if (!monster.type) errors.push("Missing required field: type.");
		if (!Array.isArray(monster.alignment) || !monster.alignment.length) errors.push("Missing required field: alignment.");
		if (!Array.isArray(monster.ac) || !monster.ac.length) {
			errors.push("Missing required field: ac.");
		} else {
			const firstAc = monster.ac[0];
			const acValue = typeof firstAc === "number" ? firstAc : firstAc?.ac;
			if (!Number.isFinite(Number(acValue)) || Number(acValue) < 1) errors.push("Armor Class must be a positive number.");
		}

		if (!monster.hp?.average || !monster.hp?.formula) {
			errors.push("Missing required field: hp.");
		} else {
			if (!Number.isFinite(Number(monster.hp.average)) || Number(monster.hp.average) < 1) errors.push("HP average must be a positive number.");
			if (!/^\d+d\d+(?:\s*[+\-]\s*\d+)?$/i.test(String(monster.hp.formula).trim())) {
				errors.push("HP formula must use dice notation (for example: 8d8 + 16).");
			}
		}

		if (!monster.speed || typeof monster.speed !== "object") errors.push("Missing required field: speed.");
		if (!monster.cr) errors.push("Missing required field: cr.");
		if (!Array.isArray(monster.action) || !monster.action.length) errors.push("Missing required field: action.");

		if (monster.type) {
			const isTypeString = typeof monster.type === "string" && monster.type.trim();
			const isTypeObject = typeof monster.type === "object" && typeof monster.type.type === "string" && monster.type.type.trim();
			if (!isTypeString && !isTypeObject) errors.push("Creature type must be a string or an object with a type field.");
		}

		if (monster.speed && typeof monster.speed === "object") {
			const speedEntries = Object.entries(monster.speed).filter(([k]) => k !== "canHover");
			if (!speedEntries.length) {
				errors.push("Speed must include at least one movement type.");
			} else {
				speedEntries.forEach(([k, v]) => {
					const speedValue = typeof v === "number" ? v : v?.number;
					if (!Number.isFinite(Number(speedValue)) || Number(speedValue) < 0) {
						errors.push(`Speed "${k}" must be a non-negative number.`);
					}
				});
			}
		}

		if (Array.isArray(monster.action)) {
			monster.action.forEach((action, ix) => {
				if (!action || typeof action !== "object") {
					errors.push(`Action #${ix + 1} must be an object.`);
					return;
				}
				if (typeof action.name !== "string" || !action.name.trim()) errors.push(`Action #${ix + 1} is missing a name.`);
				if (!Array.isArray(action.entries) || !action.entries.length) {
					errors.push(`Action #${ix + 1} is missing entries.`);
				} else if (action.entries.some(it => typeof it !== "string")) {
					errors.push(`Action #${ix + 1} entries must be strings.`);
				}
			});
		}

		const abilAbvs = Parser.ABIL_ABVS || ["str", "dex", "con", "int", "wis", "cha"];
		abilAbvs.forEach(abv => {
			if (!Number.isFinite(Number(monster[abv]))) errors.push(`Missing or invalid ability score: ${abv}.`);
		});

		if (!Number.isFinite(Number(monster.passive))) warnings.push("Passive Perception is missing or non-numeric.");

		const safeSource = this._getSafeSourceJson(monster.source);
		if (safeSource !== monster.source) {
			warnings.push(`Source JSON was normalized to "${safeSource}".`);
		}

		const htmlUnsafePattern = /<[^>]+>|\bon\w+\s*=|javascript:/i;
		const scanStrings = [];
		(monster.languages || []).forEach(it => scanStrings.push({label: "languages", value: it}));
		(monster.senses || []).forEach(it => scanStrings.push({label: "senses", value: it}));
		(monster.action || []).forEach(a => {
			scanStrings.push({label: "action.name", value: a?.name});
			(a?.entries || []).forEach(e => scanStrings.push({label: "action.entries", value: e}));
		});
		(monster.trait || []).forEach(t => {
			scanStrings.push({label: "trait.name", value: t?.name});
			(t?.entries || []).forEach(e => scanStrings.push({label: "trait.entries", value: e}));
		});

		scanStrings
			.filter(it => typeof it.value === "string" && htmlUnsafePattern.test(it.value))
			.forEach(it => warnings.push(`Potentially unsafe markup found in ${it.label}.`));

		return {
			errors: [...new Set(errors)],
			warnings: [...new Set(warnings)],
		};
	}

	static _getAlignmentArray (alignment) {
		const map = {
			LG: ["L", "G"],
			NG: ["N", "G"],
			CG: ["C", "G"],
			LN: ["L", "N"],
			N: ["N"],
			CN: ["C", "N"],
			LE: ["L", "E"],
			NE: ["N", "E"],
			CE: ["C", "E"],
		};
		return map[alignment] || ["N"];
	}

	static _getSizeAbv (size) {
		const map = {
			tiny: "T",
			small: "S",
			medium: "M",
			large: "L",
			huge: "H",
			gargantuan: "G",
		};
		return map[(size || "medium").toLowerCase()] || "M";
	}

	static _getCreatureTypeFromRace (race) {
		const creatureTypes = race?.creatureTypes || race?.creatureType || null;
		if (Array.isArray(creatureTypes) && creatureTypes.length) {
			const first = creatureTypes[0];
			if (typeof first === "string" && first.trim()) return {type: first.toLowerCase()};
			if (first?.type && typeof first.type === "string") return {type: first.type.toLowerCase()};
			if (Array.isArray(first?.choose) && first.choose.length && typeof first.choose[0] === "string") {
				return {type: first.choose[0].toLowerCase()};
			}
		}
		if (typeof creatureTypes === "string" && creatureTypes.trim()) {
			return {type: creatureTypes.toLowerCase()};
		}
		return {type: "humanoid"};
	}

	static _getSafeSourceJson (sourceJson) {
		const raw = String(sourceJson || CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT).trim();
		if (!raw) return CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
		const sanitized = raw
			.toUpperCase()
			.replace(/[^A-Z0-9&+!\- ]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 48);
		return sanitized || CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
	}

	static _getSafeSourceAbbreviation (abbreviation) {
		const raw = String(abbreviation || "").trim().slice(0, 32);
		if (!raw) return CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
		return this._getSafeInlineText(raw, {maxLen: 32}) || CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
	}

	static _getSafeSourceFull (full) {
		const raw = String(full || "").trim().slice(0, 128);
		if (!raw) return CharacterSheetNpcExporter.SOURCE_FULL_DEFAULT;
		return this._getSafeInlineText(raw, {maxLen: 128}) || CharacterSheetNpcExporter.SOURCE_FULL_DEFAULT;
	}

	static _getSafeVersion (version) {
		const raw = String(version || "").trim();
		if (!raw) return CharacterSheetNpcExporter.SOURCE_VERSION_DEFAULT;
		const out = raw.replace(/[^0-9A-Za-z._-]/g, "").slice(0, 32);
		return out || CharacterSheetNpcExporter.SOURCE_VERSION_DEFAULT;
	}

	static _getSafeName (name) {
		return this._stripHtmlTags(String(name || "")).slice(0, 128).trim();
	}

	static _getSafeInlineText (text, {maxLen = 160} = {}) {
		return this._stripHtmlTags(String(text || ""))
			.replace(/[{}]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, maxLen);
	}

	static _getSpeedObject (state) {
		const keys = ["walk", "fly", "swim", "climb", "burrow"];
		const out = {};
		keys.forEach(k => {
			const value = state.getSpeedByType?.(k);
			if (value > 0) out[k] = value;
		});
		if (!out.walk) out.walk = 30;
		return out;
	}

	static _toSignedStr (n) {
		if (n == null || Number.isNaN(Number(n))) return "+0";
		const v = Number(n);
		return v >= 0 ? `+${v}` : `${v}`;
	}

	static _getSaveBlock (state) {
		const out = {};
		(Parser.ABIL_ABVS || ["str", "dex", "con", "int", "wis", "cha"]).forEach(abv => {
			if (!state.hasSaveProficiency?.(abv)) return;
			out[abv] = this._toSignedStr(state.getSaveMod?.(abv));
		});
		return out;
	}

	static _getSkillBlock (state) {
		const skillMap = {
			acrobatics: "acrobatics",
			animalhandling: "animal handling",
			arcana: "arcana",
			athletics: "athletics",
			deception: "deception",
			history: "history",
			insight: "insight",
			intimidation: "intimidation",
			investigation: "investigation",
			medicine: "medicine",
			nature: "nature",
			perception: "perception",
			performance: "performance",
			persuasion: "persuasion",
			religion: "religion",
			sleightofhand: "sleight of hand",
			stealth: "stealth",
			survival: "survival",
		};

		const out = {};
		Object.entries(skillMap).forEach(([key, label]) => {
			const profLevel = state.getSkillProficiency?.(key) || 0;
			if (!profLevel) return;
			out[label] = this._toSignedStr(state.getSkillMod?.(key));
		});
		return out;
	}

	static _getSensesBlock (state) {
		const parts = [];
		const senses = state.getSenses?.() || {};
		Object.entries(senses).forEach(([k, v]) => {
			const value = Number(v);
			if (!value || !Number.isFinite(value)) return;
			const senseName = this._getSafeInlineText(k, {maxLen: 24});
			if (!senseName) return;
			parts.push(`${senseName} ${value} ft.`);
		});
		return parts;
	}

	static _getSafeStringList (values, {maxLen = 64} = {}) {
		if (!Array.isArray(values)) return [];
		return values
			.map(it => this._getSafeInlineText(it, {maxLen}))
			.filter(Boolean);
	}

	static _getMergedAttacks (state) {
		const activeWeapons = (state.getItems?.() || [])
			.filter(it => !!it)
			.filter(it => this._isActiveItem(it))
			.filter(it => this._isWeaponItem(it));

		const activeWeaponByName = new Map(
			activeWeapons
				.map(it => [String(it.name || "").toLowerCase(), it])
				.filter(([name]) => !!name),
		);

		const attacks = [...(state.getAttacks?.() || [])].map(attack => {
			const key = String(attack?.name || "").toLowerCase();
			const item = key ? activeWeaponByName.get(key) : null;
			if (!item) return attack;

			const magicAttackBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponAttack) || 0);
			const magicDamageBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponDamage) || 0);
			const masteryProperty = this._getMasteryName(item.mastery?.[0]);

			return {
				...attack,
				_sourceItem: item,
				weaponKey: `${item.name}|${item.source || Parser.SRC_XPHB}`,
				mastery: attack.mastery || item.mastery || [],
				masteryProperty: attack.masteryProperty || masteryProperty || null,
				magicAttackBonus,
				magicDamageBonus,
			};
		});
		const attackNames = new Set(attacks.map(it => (it?.name || "").toLowerCase()).filter(Boolean));

		activeWeapons.forEach(item => {
			const derived = state.updateAttackFromWeapon?.(item);
			if (!derived?.name) return;
			const key = derived.name.toLowerCase();
			if (attackNames.has(key)) return;
			attackNames.add(key);

			const magicAttackBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponAttack) || 0);
			const magicDamageBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponDamage) || 0);
			const masteryProperty = this._getMasteryName(item.mastery?.[0]);
			attacks.push({
				...derived,
				isMelee: !/\d+\s*\/\s*\d+|range/i.test(String(derived.range || "")),
				attackBonus: (Number(derived.attackBonus) || 0) + magicAttackBonus,
				damage: this._addFlatBonusToDiceFormula(derived.damage, magicDamageBonus),
				_sourceItem: item,
				weaponKey: `${item.name}|${item.source || Parser.SRC_XPHB}`,
				mastery: item.mastery || [],
				masteryProperty,
				magicAttackBonus,
				magicDamageBonus,
			});
		});

		return attacks;
	}

	static _isActiveItem (item) {
		if (!item?.equipped) return false;
		if (item.requiresAttunement && !item.attuned) return false;
		return true;
	}

	static _isWeaponItem (item) {
		if (item.dmg1) return true;
		if (item.weaponCategory) return true;
		return ["M", "R", "MW", "RW"].includes(item.type);
	}

	static _isMagicItem (item) {
		const rarity = String(item?.rarity || "").toLowerCase();
		const hasMeaningfulRarity = rarity && !["none", "unknown", "common"].includes(rarity);
		return !!(
			hasMeaningfulRarity
			|| item?.requiresAttunement
			|| item?.charges
			|| item?.attachedSpells
			|| item?.activation?.length
			|| item?.bonusAc
			|| item?.bonusSavingThrow
			|| item?.bonusWeaponAttack
			|| item?.bonusWeaponDamage
		);
	}

	static _getItemTag (item) {
		const safeName = this._getSafeInlineText(item?.name || "Item", {maxLen: 80}) || "Item";
		const source = this._getSafeSourceJson(item?.source || "");
		if (!source) return safeName;
		return `{@item ${safeName}|${source}}`;
	}

	static _getSpecialEquipmentBlock (state) {
		const items = (state.getItems?.() || [])
			.filter(it => !!it)
			.filter(it => this._isActiveItem(it))
			.filter(it => this._isMagicItem(it));

		if (!items.length) return null;

		const entries = items
			.map(item => {
				const tag = this._getItemTag(item);
				const notes = [];
				if (item.requiresAttunement) notes.push("attuned");
				if (Number.isFinite(Number(item.charges)) && Number(item.charges) > 0) {
					const current = Number.isFinite(Number(item.chargesCurrent)) ? Number(item.chargesCurrent) : Number(item.charges);
					notes.push(`${current}/${Number(item.charges)} charges`);
				}
				if (item.activation?.length) {
					const acts = item.activation.map(a => String(a?.type || "")).filter(Boolean).join(", ");
					if (acts) notes.push(`activation: ${acts}`);
				}
				return `• ${tag}${notes.length ? ` (${notes.join("; ")})` : ""}`;
			})
			.slice(0, 10);

		return {
			name: "Special Equipment",
			entries,
		};
	}

	static _getMagicItemUseBlocks (state, {npcName = "The NPC"} = {}) {
		const out = {action: [], bonus: [], reaction: []};
		const items = (state.getItems?.() || [])
			.filter(it => !!it)
			.filter(it => this._isActiveItem(it))
			.filter(it => this._isMagicItem(it));
		const spells = state.getItemGrantedSpells?.() || [];

		const dc = state.getFeatureCalculations?.()?.combatMethodDc
			|| (8 + (state.getProficiencyBonus?.() || 2) + Math.max(state.getAbilityMod?.("str") || 0, state.getAbilityMod?.("dex") || 0));

		items.forEach(item => {
			if (!item.activation?.length) return;
			const activationTypes = new Set(item.activation.map(a => String(a?.type || "").toLowerCase()));
			const snippet = this._getItemUseSnippet(item, {npcName});
			const name = this._getSafeInlineText(item.name || "Magic Item", {maxLen: 80}) || "Magic Item";
			const itemTag = this._getItemTag(item);

			const entry = {
				name,
				entries: [`${itemTag}: ${snippet}${dc ? ` (save {@dc ${dc}} when applicable).` : "."}`],
			};

			if (activationTypes.has("reaction")) out.reaction.push(entry);
			else if (activationTypes.has("bonus")) out.bonus.push(entry);
			else out.action.push(entry);
		});

		spells.forEach(sp => {
			const itemName = this._getSafeInlineText(sp?.sourceItem || "Magic Item", {maxLen: 80}) || "Magic Item";
			const spellName = this._getSafeInlineText(sp?.name || "spell", {maxLen: 80}) || "spell";
			const spellTag = `{@spell ${spellName}|${Parser.SRC_XPHB}}`;
			const usage = this._getItemSpellUsageText(sp);
			const entry = {
				name: `${itemName} (Spell)`,
				entries: [`Casts ${spellTag}${usage ? ` (${usage})` : ""}.`],
			};

			const ownerItem = items.find(it => this._getSafeInlineText(it.name || "", {maxLen: 80}) === itemName);
			const activationTypes = new Set((ownerItem?.activation || []).map(a => String(a?.type || "").toLowerCase()));

			if (activationTypes.has("reaction")) out.reaction.push(entry);
			else if (activationTypes.has("bonus")) out.bonus.push(entry);
			else out.action.push(entry);
		});

		return out;
	}

	static _getItemSpellUsageText (spell) {
		if (!spell) return "";
		if (spell.usageType === "will") return "at will";
		if (spell.usageType === "charges") return `${spell.chargesCost || 1} charge${Number(spell.chargesCost || 1) === 1 ? "" : "s"}`;
		if (spell.usageType === "daily" && spell.usesMax) {
			return `${spell.usesMax}/day${spell.isEach ? " each" : ""}`;
		}
		if (spell.usageType === "rest" && spell.usesMax) {
			return `${spell.usesMax}/rest${spell.isEach ? " each" : ""}`;
		}
		if (spell.usageType === "ritual") return "ritual";
		return "";
	}

	static _getItemUseSnippet (item, {npcName = "The NPC"} = {}) {
		const joined = (item.entries || [])
			.map(it => typeof it === "string" ? it : (it?.entries || []).join(" "))
			.join(" ");
		const plain = this._getSafeInlineText(joined, {maxLen: 240});
		if (plain) return this._normalizeAbilityTextForNpc(plain, {npcName});

		if (Number.isFinite(Number(item.charges)) && Number(item.charges) > 0) {
			const current = Number.isFinite(Number(item.chargesCurrent)) ? Number(item.chargesCurrent) : Number(item.charges);
			return `Has ${current}/${Number(item.charges)} charges`;
		}

		return "Can be activated";
	}

	static _getActionEntriesFromAttacks (attacks, state) {
		const actions = attacks.map(a => {
			const toHit = this._toSignedStr(this._getAttackToHit(a, state));
			const rangeRaw = a.range || (a.isMelee ? "reach 5 ft., one target" : "range 30/120 ft., one target");
			const range = this._getSafeInlineText(rangeRaw, {maxLen: 80});
			const hitDamage = this._getAttackDamageText(a, state);
			const name = this._getSafeInlineText(a.name || "Attack", {maxLen: 80}) || "Attack";
			const qualifiers = this._getAttackQualifiers(a, state);

			return {
				name,
				entries: [
					`{@atk ${a.isMelee ? "mw" : "rw"}} {@hit ${toHit}} to hit, ${range}. {@h} ${hitDamage}.${qualifiers ? ` ${qualifiers}` : ""}`,
				],
			};
		});

		if (!actions.length) {
			actions.push({
				name: "Unarmed Strike",
				entries: [
					`{@atk mw} {@hit ${this._toSignedStr((state.getAbilityMod?.("str") || 0) + (state.getProficiencyBonus?.() || 2))}} to hit, reach 5 ft., one target. {@h} ${5 + (state.getAbilityMod?.("str") || 0)} bludgeoning damage.`,
				],
			});
		}

		return actions;
	}

	static _getAttackDamageText (attack, state) {
		const damageType = this._getSafeInlineText((attack.damageType || "bludgeoning").toLowerCase(), {maxLen: 24}) || "bludgeoning";
		const base = attack.damage || "1";
		if (/^\d+d\d+(?:\s*[+\-]\s*\d+)?$/i.test(base.trim())) {
			return `{@damage ${base.trim()}} ${damageType} damage`;
		}

		const dmgBonus = Number(attack.damageBonus) || 0;
		const abilityMod = attack.abilityMod === "dex" ? (state.getAbilityMod?.("dex") || 0) : (state.getAbilityMod?.("str") || 0);
		const flat = Number(base) || 1;
		return `${flat + dmgBonus + abilityMod} ${damageType} damage`;
	}

	static _getAttackToHit (attack, state) {
		const abilityMod = this._getAttackAbilityMod(attack, state);
		const profBonus = state.getProficiencyBonus?.() || 2;
		const magicAttackBonus = Number(attack?.magicAttackBonus) || 0;
		const derived = abilityMod + profBonus + magicAttackBonus;

		const explicit = Number(attack?.attackBonus);
		if (!Number.isFinite(explicit)) return derived;
		return Math.max(explicit, derived);
	}

	static _getAttackAbilityMod (attack, state) {
		if (!attack) return state.getAbilityMod?.("str") || 0;
		if (attack.abilityMod === "finesse") {
			return Math.max(state.getAbilityMod?.("str") || 0, state.getAbilityMod?.("dex") || 0);
		}
		if (attack.abilityMod === "dex") return state.getAbilityMod?.("dex") || 0;
		if (attack.abilityMod === "spellcasting") {
			return Math.max(state.getAbilityMod?.("int") || 0, state.getAbilityMod?.("wis") || 0, state.getAbilityMod?.("cha") || 0);
		}
		return state.getAbilityMod?.("str") || 0;
	}

	static _getAttackQualifiers (attack, state) {
		const parts = [];

		const magicAttackBonus = Number(attack?.magicAttackBonus) || 0;
		const magicDamageBonus = Number(attack?.magicDamageBonus) || 0;
		if (magicAttackBonus || magicDamageBonus) {
			const magicBits = [];
			if (magicAttackBonus) magicBits.push(`${this._toSignedStr(magicAttackBonus)} attack`);
			if (magicDamageBonus) magicBits.push(`${this._toSignedStr(magicDamageBonus)} damage`);
			parts.push(`Magic weapon (${magicBits.join(", ")})`);
		}

		const masteryEffect = state.getMasteryEffectsForAttack?.(attack);
		if (masteryEffect?.name) {
			const masteryNotes = [];
			if (masteryEffect.dc) masteryNotes.push(`save {@dc ${masteryEffect.dc}}`);
			if (Number.isFinite(masteryEffect.grazeDamage)) masteryNotes.push(`${masteryEffect.grazeDamage} graze damage`);
			const desc = this._getSafeInlineText(masteryEffect.description || "", {maxLen: 180});
			if (desc) masteryNotes.push(desc);
			const masteryTag = this._getMasteryTag(attack, masteryEffect.name);
			parts.push(`Mastery: ${masteryTag}${masteryNotes.length ? ` (${masteryNotes.join("; ")})` : ""}`);
		} else {
			const masteryName = this._getMasteryName(attack.masteryProperty || attack.mastery?.[0]);
			if (masteryName) parts.push(`Mastery: ${this._getMasteryTag(attack, masteryName)}`);
		}

		return parts.join(". ");
	}

	static _getMasteryName (masteryEntry) {
		if (!masteryEntry) return "";
		if (typeof masteryEntry === "string") return masteryEntry.split("|")[0];
		if (typeof masteryEntry === "object" && masteryEntry.uid) return masteryEntry.uid.split("|")[0];
		return "";
	}

	static _getMasteryTag (attack, masteryName) {
		const safeName = this._getSafeInlineText(masteryName || "", {maxLen: 48});
		if (!safeName) return "Mastery";

		let source = Parser.SRC_XPHB;
		const masteryEntry = attack?.mastery?.[0] ?? attack?.masteryProperty;
		if (typeof masteryEntry === "string" && masteryEntry.includes("|")) {
			source = masteryEntry.split("|")[1] || source;
		} else if (typeof masteryEntry === "object" && masteryEntry.uid && masteryEntry.uid.includes("|")) {
			source = masteryEntry.uid.split("|")[1] || source;
		}

		const safeSource = this._getSafeSourceJson(source || Parser.SRC_XPHB);
		return `{@itemMastery ${safeName}|${safeSource}}`;
	}

	static _addFlatBonusToDiceFormula (damage, flatBonus) {
		const bonus = Number(flatBonus) || 0;
		if (!bonus) return damage;

		const raw = String(damage || "").replace(/\s+/g, "").trim();
		const m = raw.match(/^(\d+d\d+)([+\-]\d+)?$/i);
		if (!m) return damage;

		const base = m[1];
		const existing = Number(m[2] || 0);
		const total = existing + bonus;
		if (!total) return base;
		return `${base}${total >= 0 ? "+" : ""}${total}`;
	}

	static _getSpellcastingBlock (state) {
		const cantrips = state.getCantripsKnown?.() || [];
		const spellsKnown = state.getSpellsKnown?.() || [];
		const hasAnySpells = cantrips.length || spellsKnown.length;
		if (!hasAnySpells) return null;

		const spellcastingAbility = this._normalizeAbilityAbv(
			state.getSpellcastingAbility?.() || state.getSpellcasting?.()?.ability || "int",
		);
		const abilityMod = state.getAbilityMod?.(spellcastingAbility) || 0;
		const dc = 8 + (state.getProficiencyBonus?.() || 2) + abilityMod;
		const atk = (state.getProficiencyBonus?.() || 2) + abilityMod;

		const preparedSpells = state.getPreparedSpells?.() || spellsKnown.filter(s => s.prepared || s.alwaysPrepared);

		const spells = {};
		const slots = state.getSpellSlots?.() || {};
		Object.entries(slots)
			.sort((a, b) => Number(a[0]) - Number(b[0]))
			.forEach(([lvl, slotInfo]) => {
				const level = Number(lvl);
				if (!level || !slotInfo?.max) return;

				const preparedAtLevel = preparedSpells
					.filter(s => Number(s.level) === level)
					.map(s => `{@spell ${s.name}|${s.source || Parser.SRC_XPHB}}`);

				const knownAtLevel = spellsKnown
					.filter(s => Number(s.level) === level)
					.map(s => `{@spell ${s.name}|${s.source || Parser.SRC_XPHB}}`);

				const lvlSpells = [...new Set([...preparedAtLevel, ...knownAtLevel])];
				if (!lvlSpells.length) return;
				spells[level] = {slots: slotInfo.max, spells: lvlSpells};
			});

		const will = cantrips
			.map(s => `{@spell ${s.name}|${s.source || Parser.SRC_XPHB}}`)
			.sort((a, b) => a.localeCompare(b));

		const out = {
			type: "spellcasting",
			name: "Spellcasting",
			headerEntries: [
				`The NPC is a spellcaster. Its spellcasting ability is ${Parser.attAbvToFull(spellcastingAbility)} (spell save {@dc ${dc}}, {@hit ${this._toSignedStr(atk)}} to hit with spell attacks).`,
			],
			ability: spellcastingAbility,
		};

		if (will.length) out.will = will;
		if (Object.keys(spells).length) out.spells = spells;

		return out;
	}

	static _getCombatMethodsBlock (state, {npcName = "The NPC"} = {}) {
		const methods = state.getCombatMethods?.() || [];
		if (!methods.length) return null;
		const calculations = state.getFeatureCalculations?.() || {};
		const methodDc = calculations.combatMethodDc
			|| (8 + (state.getProficiencyBonus?.() || 2) + Math.max(state.getAbilityMod?.("str") || 0, state.getAbilityMod?.("dex") || 0));

		const byCost = new Map();
		methods.forEach(m => {
			const key = Number(m.staminaCost) || 0;
			if (!byCost.has(key)) byCost.set(key, []);
			byCost.get(key).push(m);
		});

		const entries = [];
		const sortedCosts = [...byCost.keys()].sort((a, b) => a - b);
		sortedCosts.forEach(cost => {
			const methodsAtCost = byCost.get(cost)
				.sort((a, b) => a.name.localeCompare(b.name))
				.map(m => {
					const actionTypeRaw = m.actionType ? this._getSafeInlineText(m.actionType, {maxLen: 24}) : "Action";
					const actionType = actionTypeRaw ? ` (${actionTypeRaw})` : "";
					const stanceMark = m.isStance ? " [Stance]" : "";
					const safeName = this._getSafeInlineText(m.name, {maxLen: 80}) || "Method";
					const safeSource = this._getSafeSourceJson(m.source || Parser.SRC_TGTT || Parser.SRC_XPHB);
					const methodTag = `{@optfeature ${safeName}|${safeSource}}`;
					return `${methodTag}${actionType}${stanceMark}`;
				});

			entries.push(`{@b Cost ${cost}:} ${methodsAtCost.join(", ")}.`);
		});

		const staminaMax = state.getStaminaMax?.() || 0;
		const degreeAccess = state.getMethodDegreeAccess?.() || 0;

		entries.unshift(`${npcName} uses combat methods fueled by stamina (pool ${staminaMax}; method degree access ${degreeAccess}; save {@dc ${methodDc}}).`);

		return {
			name: "Combat Methods",
			entries,
		};
	}

	static _getFeatureBlocks (state, {npcName = "The NPC"} = {}) {
		const out = {trait: [], action: [], bonus: [], reaction: []};
		const sourceFeatureIds = new Set((state.getNamedModifiers?.() || [])
			.map(mod => mod?.sourceFeatureId)
			.filter(Boolean));

		const features = (state.getFeatures?.() || [])
			.filter(f => f?.name && f?.description)
			.filter(f => !f.optionalFeatureTypes?.some(ft => ft?.startsWith?.("CTM:")));

		const classified = features
			.map(feature => this._classifyFeatureForStatblock(feature, {sourceFeatureIds}))
			.filter(it => it.classification === "important")
			.slice(0, 8);

		classified.forEach(({feature, analysis}) => {
			const text = this._normalizeAbilityTextForNpc(this._stripHtmlTags(feature.description).slice(0, 280), {npcName});
			const usesText = this._getFeatureUsesText(feature);
			const entry = {
				name: this._getSafeInlineText(feature.name, {maxLen: 80}) || "Feature",
				entries: [usesText ? `${text} ${usesText}` : text],
			};

			const section = this._getFeatureActivationSection(feature, analysis);
			if (section === "bonus") {
				out.bonus.push(entry);
				return;
			}
			if (section === "reaction") {
				out.reaction.push(entry);
				return;
			}
			if (section === "action") {
				out.action.push(entry);
				return;
			}

			out.trait.push(entry);
		});

		return out;
	}

	static _classifyFeatureForStatblock (feature, {sourceFeatureIds = new Set()} = {}) {
		const analysis = CharacterSheetState.analyzeFeature?.(feature) || null;
		const rawText = String(feature?.description || "").toLowerCase();

		const hasLimitedUses = Number(feature?.uses?.max || 0) > 0;
		const hasCombatKeyword = /\b(action|bonus action|reaction|save|damage|attack|resistance|immunity|advantage|disadvantage)\b/i.test(rawText);
		const isBackgroundFeature = String(feature?.featureType || "").toLowerCase() === "background";

		const isImportant = !!(
			hasLimitedUses
			|| feature?.important
			|| analysis?.isActivatable
			|| analysis?.hasResourceCost
			|| hasCombatKeyword
		);

		const effectTypes = new Set((analysis?.effects || []).map(e => e?.type).filter(Boolean));
		const statDerivedEffectTypes = new Set([
			"bonus", "penalty", "setMinimum", "setMaximum", "setValue",
			"advantage", "disadvantage", "proficiency", "expertise",
			"setSpeed", "speed", "ac", "hp", "damage", "attack",
		]);
		const allEffectsAreStatDerived = effectTypes.size
			&& [...effectTypes].every(type => statDerivedEffectTypes.has(type));
		const activationSection = this._getFeatureActivationSection(feature, analysis);

		const isAlreadyApplied = !!(
			!activationSection
			&& (sourceFeatureIds.has(feature?.id) || allEffectsAreStatDerived)
		);

		if (isBackgroundFeature) {
			return {feature, analysis, classification: "notImportant"};
		}

		if (isAlreadyApplied) return {feature, analysis, classification: "alreadyApplied"};
		if (!isImportant) return {feature, analysis, classification: "notImportant"};
		return {feature, analysis, classification: "important"};
	}

	static _getFeatureActivationSection (feature, analysis = null) {
		const activationAction = String(analysis?.activationInfo?.activationAction || "").toLowerCase();
		if (activationAction === "bonus") return "bonus";
		if (activationAction === "reaction") return "reaction";
		if (activationAction === "action" || activationAction === "attack") return "action";

		const text = String(feature?.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").toLowerCase();
		if (/\bas a bonus action\b|\buse (?:a|your) bonus action\b/.test(text)) return "bonus";
		if (/\bas a reaction\b|\buse (?:a|your) reaction\b/.test(text)) return "reaction";
		if (/\bas an action\b|\buse (?:an|your) action\b/.test(text)) return "action";
		return null;
	}

	static _getFeatureUsesText (feature) {
		const uses = feature?.uses;
		if (!uses || !Number.isFinite(Number(uses.max)) || Number(uses.max) <= 0) return "";
		const current = Number.isFinite(Number(uses.current)) ? Number(uses.current) : Number(uses.max);
		const recharge = this._getSafeInlineText(uses.recharge || "", {maxLen: 24});
		return `(${current}/${Number(uses.max)} uses${recharge ? `; recharges on ${recharge}` : ""})`;
	}

	static _getCustomAbilityBlocks (state, {npcName = "The NPC"} = {}) {
		const out = {trait: [], action: [], bonus: [], reaction: []};
		const abilities = state.getCustomAbilities?.() || [];
		if (!abilities.length) return out;

		const passiveEntries = [];
		abilities.forEach(ability => {
			const safeName = this._getSafeInlineText(ability?.name || "Custom Ability", {maxLen: 80}) || "Custom Ability";
			const description = this._normalizeAbilityTextForNpc(this._stripHtmlTags(ability?.description || ""), {npcName});
			const mode = this._getSafeInlineText(ability?.mode || "passive", {maxLen: 24}) || "passive";
			const uses = ability?.uses;
			const usesText = uses && Number.isFinite(Number(uses.max))
				? `${Number.isFinite(Number(uses.current)) ? Number(uses.current) : Number(uses.max)}/${Number(uses.max)} uses`
				: "";
			const statusText = ability?.isActive === false ? "inactive" : "active";

			const entryText = [description || `${safeName} grants custom effects.`, `(${mode}; ${statusText}${usesText ? `; ${usesText}` : ""})`]
				.filter(Boolean)
				.join(" ");

			const activation = String(ability?.activationAction || "").toLowerCase();
			const isActivatable = mode !== "passive" || ["action", "bonus", "reaction"].includes(activation);
			if (isActivatable) {
				const actionEntry = {
					name: safeName,
					entries: [entryText],
				};
				if (activation === "bonus") out.bonus.push(actionEntry);
				else if (activation === "reaction") out.reaction.push(actionEntry);
				else out.action.push(actionEntry);
				return;
			}

			passiveEntries.push(`• {@b ${safeName}.} ${entryText}`);
		});

		if (passiveEntries.length) {
			out.trait.push({
				name: "Custom Abilities",
				entries: passiveEntries.slice(0, 12),
			});
		}

		return out;
	}

	static _getNamedModifierTrait (state, {npcName = "The NPC"} = {}) {
		const modifiers = state.getNamedModifiers?.() || [];
		if (!modifiers.length) return null;

		const entries = modifiers
			.slice(0, 20)
			.map(mod => {
				const name = this._getSafeInlineText(mod?.name || "Modifier", {maxLen: 80}) || "Modifier";
				const type = this._getSafeInlineText(mod?.type || "ac", {maxLen: 48}) || "ac";
				const target = this._getModifierTargetLabel(type);
				const value = this._getModifierValueSummary(mod);
				const status = mod?.enabled === false ? "disabled" : "enabled";
				const note = this._normalizeAbilityTextForNpc(this._getSafeInlineText(mod?.note || "", {maxLen: 120}), {npcName});
				const conditionalText = this._getSafeInlineText(mod?.conditional || "", {maxLen: 64});
				const bits = [target, value, status, conditionalText ? `if ${conditionalText}` : "", note].filter(Boolean);
				return `• {@b ${name}.} ${bits.join("; ")}.`;
			});

		return {
			name: "Custom Modifiers",
			entries,
		};
	}

	static _getModifierTargetLabel (type) {
		const map = {
			ac: "Armor Class",
			initiative: "initiative",
			attack: "attack rolls",
			damage: "damage rolls",
			hp: "hit points",
			spellDc: "spell save DC",
			spellAttack: "spell attacks",
			speed: "speed",
			d20: "d20 rolls",
		};

		if (map[type]) return map[type];
		if (type.startsWith("save:")) return `${type.split(":")[1].toUpperCase()} saves`;
		if (type.startsWith("skill:")) return `${type.split(":")[1]} checks`;
		if (type.startsWith("check:")) return `${type.split(":")[1].toUpperCase()} checks`;
		return type;
	}

	static _getModifierValueSummary (modifier) {
		if (!modifier) return "";
		if (modifier.advantage) return "advantage";
		if (modifier.disadvantage) return "disadvantage";
		if (modifier.autoSuccess) return "auto success";
		if (modifier.autoFail) return "auto fail";
		if (modifier.setValue != null) return `set to ${modifier.setValue}`;
		if (modifier.setMinimum != null) return `minimum ${modifier.setMinimum}`;
		if (modifier.setMaximum != null) return `maximum ${modifier.setMaximum}`;
		if (modifier.bonusDie) return `+${modifier.bonusDie}`;
		if (Number.isFinite(Number(modifier.value)) && Number(modifier.value)) return this._toSignedStr(Number(modifier.value));
		return "contextual";
	}

	static _getNpcReferenceName (name) {
		const safeName = this._getSafeInlineText(name || "", {maxLen: 80});
		if (!safeName) return "The NPC";
		return safeName;
	}

	static _normalizeAbilityTextForNpc (text, {npcName = "The NPC"} = {}) {
		const safeText = this._getSafeInlineText(text || "", {maxLen: 280}) || "";
		if (!safeText) return "";

		const possessive = npcName.endsWith("s") ? `${npcName}'` : `${npcName}'s`;
		return safeText
			.replace(/\byourself\b/gi, npcName)
			.replace(/\byou are\b/gi, `${npcName} is`)
			.replace(/\byou have\b/gi, `${npcName} has`)
			.replace(/\byou can\b/gi, `${npcName} can`)
			.replace(/\byou gain\b/gi, `${npcName} gains`)
			.replace(/\byour\b/gi, possessive)
			.replace(/\byou\b/gi, npcName)
			.replace(/\s+/g, " ")
			.trim();
	}

	static _stripHtmlTags (text) {
		if (!text) return "";
		return text
			.replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, "$1")
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	static _getHpFormula (maxHp, conMod) {
		const con = Number(conMod) || 0;
		const estimatedDice = Math.max(1, Math.round(maxHp / 8));
		const conPart = con * estimatedDice;
		if (!conPart) return `${estimatedDice}d8`;
		return `${estimatedDice}d8 ${conPart >= 0 ? "+" : "-"} ${Math.abs(conPart)}`;
	}

	static _normalizeAbilityAbv (ability) {
		const normalized = String(ability || "").toLowerCase().trim();
		if ((Parser.ABIL_ABVS || []).includes(normalized)) return normalized;
		return "int";
	}

	static _estimateCr ({totalLevel, hp, ac, attacks, spellcastingBlock}) {
		const baseline = totalLevel <= 1 ? 0.5 : Math.max(1, totalLevel - 1);

		let avgAttackBonus = 0;
		let maxDamageScore = 0;
		if (attacks?.length) {
			const attackBonuses = attacks.map(a => Number(a.attackBonus) || 0);
			avgAttackBonus = attackBonuses.reduce((a, b) => a + b, 0) / attackBonuses.length;

			maxDamageScore = Math.max(...attacks.map(a => this._estimateDamageScore(a)));
		}

		const defensiveAdj = Math.round(((hp - 40) / 45) + ((ac - 13) / 2));
		const offensiveAdj = Math.round((avgAttackBonus - 5) / 2 + (maxDamageScore - 10) / 8 + (spellcastingBlock ? 1 : 0));

		const est = Math.max(0.125, baseline + (defensiveAdj + offensiveAdj) / 3);
		return {cr: this._toCrString(est)};
	}

	static _estimateDamageScore (attack) {
		const damage = String(attack.damage || "").trim();
		const m = damage.match(/(\d+)d(\d+)(?:\s*([+\-])\s*(\d+))?/i);
		if (m) {
			const count = Number(m[1]) || 1;
			const die = Number(m[2]) || 6;
			const avg = count * (die + 1) / 2;
			const bonus = m[4] ? (m[3] === "-" ? -Number(m[4]) : Number(m[4])) : 0;
			return avg + bonus;
		}

		return Number(damage) || 5;
	}

	static _toCrString (value) {
		if (value <= 0.125) return "1/8";
		if (value <= 0.25) return "1/4";
		if (value <= 0.5) return "1/2";
		return `${Math.min(30, Math.max(1, Math.round(value)))}`;
	}
}

globalThis.CharacterSheetNpcExporter = CharacterSheetNpcExporter;

export {CharacterSheetNpcExporter};
