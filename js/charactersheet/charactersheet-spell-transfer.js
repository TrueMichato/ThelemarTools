import {CharacterSheetClassUtils} from "./charactersheet-class-utils.js";
import {CharacterSheetEntityTransfer} from "./charactersheet-entity-transfer.js";

export class CharacterSheetSpellTransfer {
	static STORAGE_KEY = "charsheet-spell-transfers";
	static CHANNEL_NAME = "charsheet-spell-transfers";
	static _MAX_APPLIED_IDS = 100;
	static _transport = new CharacterSheetEntityTransfer({
		storageKey: this.STORAGE_KEY,
		channelName: this.CHANNEL_NAME,
		appliedIdsKey: "_appliedSpellTransferIds",
		queueLabel: "spell",
		maxAppliedIds: this._MAX_APPLIED_IDS,
		fnValidateQueuePayload: ({spell, attribution}) => {
			if (!spell?.name || !spell?.source || spell.level == null) {
				throw new Error("The selected spell is missing its name, source, or level.");
			}
			if (attribution != null && typeof attribution !== "object") {
				throw new Error("The selected spell attribution is malformed.");
			}
		},
		fnBuildTransferData: ({spell, attribution}) => ({
			spell: MiscUtil.copyFast(spell),
			attribution: attribution == null ? null : MiscUtil.copyFast(attribution),
		}),
		fnApplyTransfer: ({transfer, state}) => {
			if (!transfer.spell?.name || !transfer.spell?.source || transfer.spell.level == null) {
				throw new Error("Transfer spell is missing its name, source, or level.");
			}
			if (transfer.attribution != null && typeof transfer.attribution !== "object") {
				throw new Error("Transfer spell attribution is malformed.");
			}
			state.addSpell(this.getSpellEntry({
				spell: transfer.spell,
				attribution: transfer.attribution,
			}));
		},
	});

	static getCharacterLabel (character) {
		return CharacterSheetEntityTransfer.getCharacterLabel(character);
	}

	static async pGetCharacters ({storage = StorageUtil} = {}) {
		return CharacterSheetEntityTransfer.pGetCharacters({storage});
	}

	static async pQueue ({characterId, spell, attribution = null, storage = StorageUtil}) {
		return this._transport.pQueue({
			characterId,
			payload: {spell, attribution},
			storage,
		});
	}

	static async pApplyPendingToState ({characterId, state, storage = StorageUtil}) {
		return this._transport.pApplyPendingToState({characterId, state, storage});
	}

	static async pAcknowledge ({transferIds, storage = StorageUtil, fnIsValid = null}) {
		return this._transport.pAcknowledge({transferIds, storage, fnIsValid});
	}

	static async pRemoveForCharacters ({characterIds, storage = StorageUtil}) {
		return this._transport.pRemoveForCharacters({characterIds, storage});
	}

	static subscribe (fnOnTransfer) {
		return this._transport.subscribe(fnOnTransfer);
	}

	static getSpellEntry ({spell, attribution = null}) {
		const isWizardTarget = /^wizard$/i.test(attribution?.sourceClass || "")
			|| attribution?.sourceFeature === "Wizard Spellbook";
		return {
			name: spell.name,
			source: spell.source,
			level: Number(spell.level),
			school: spell.school,
			prepared: Number(spell.level) === 0,
			ritual: CharacterSheetClassUtils.spellIsRitual(spell),
			concentration: CharacterSheetClassUtils.spellIsConcentration(spell),
			inSpellbook: isWizardTarget && Number(spell.level) > 0,
			castingTime: CharacterSheetClassUtils.getSpellCastingTime(spell),
			range: CharacterSheetClassUtils.getSpellRange(spell),
			components: CharacterSheetClassUtils.getSpellComponents(spell),
			duration: CharacterSheetClassUtils.getSpellDuration(spell),
			subschools: spell.subschools || [],
			...(attribution?.sourceFeature ? {sourceFeature: attribution.sourceFeature} : {}),
			...(attribution?.sourceClass ? {sourceClass: attribution.sourceClass} : {}),
			...(attribution?.sourceSubclass ? {sourceSubclass: attribution.sourceSubclass} : {}),
			...(attribution?.spellcastingAbility ? {spellcastingAbility: attribution.spellcastingAbility} : {}),
		};
	}

	static getAttributionModel ({spell, state, classData = []}) {
		const classes = state?.getClasses?.() || [];
		const info = state?.getSpellcastingInfo?.() || null;
		const cards = state?.getSpellcastingClassBreakdown?.() || [];
		const settings = state?.getSettings?.() || {};
		const includeCoreSpells = settings.includeCoreSpellsForHomebrew !== false;

		const classOptions = cards.map(card => {
			const targetClass = classes.find(cls =>
				(cls?.name || "").toLowerCase() === (card.className || "").toLowerCase()
				&& (!card.classSource || !cls?.source || cls.source === card.classSource),
			) || classes.find(cls => (cls?.name || "").toLowerCase() === (card.className || "").toLowerCase());
			if (!targetClass) return null;

			const fullClass = classData.find(cls =>
				(cls?.name || "").toLowerCase() === (targetClass.name || "").toLowerCase()
				&& (!targetClass.source || !cls?.source || cls.source === targetClass.source),
			) || targetClass;
			const subclass = CharacterSheetClassUtils.resolveFullSubclass(targetClass.subclass, fullClass);
			const classSource = targetClass.source || card.classSource || null;
			const isNonStandardSource = classSource && !["PHB", "XPHB", "TCE", "XGE", "TGTT"].includes(classSource);
			const isDirectClassSpell = CharacterSheetClassUtils.spellIsForClass(spell, targetClass.name);
			const isSubclassSpell = !isDirectClassSpell && CharacterSheetClassUtils.spellIsAvailableForClass(spell, {
				className: targetClass.name,
				classSource,
				subclass,
				subclassChoice: targetClass.subclassChoice,
				additionalClassNames: CharacterSheetClassUtils.getAdditionalSpellListClasses({
					className: targetClass.name,
					subclass,
					subclassChoice: targetClass.subclassChoice,
				}),
				includeCoreSpellsForHomebrew: includeCoreSpells && isNonStandardSource,
			});
			const isEligible = isDirectClassSpell || isSubclassSpell;
			const attribution = CharacterSheetClassUtils.pickAddedSpellAttribution({
				spell,
				info,
				classes,
				targetClass,
			});
			if (isSubclassSpell && subclass?.name && attribution.sourceClass !== "Gambler") {
				attribution.sourceSubclass = subclass.shortName || subclass.name;
				attribution.sourceSubclassSource = subclass.source || null;
			}

			return {
				id: `${targetClass.name}|${classSource || ""}`,
				label: card.displayName || [targetClass.name, subclass?.name].filter(Boolean).join(" — "),
				targetClass,
				attribution,
				isEligible,
				eligibility: isDirectClassSpell ? "class" : (isSubclassSpell ? "subclass" : null),
			};
		}).filter(Boolean);

		const eligibleOptions = classOptions.filter(option => option.isEligible);
		const options = [
			...eligibleOptions,
			...classOptions.filter(option => !option.isEligible),
			{
				id: "unattributed",
				label: "Other / Unattributed",
				targetClass: null,
				attribution: null,
				isEligible: false,
				eligibility: null,
				isUnattributed: true,
			},
		];

		return {
			options,
			eligibleOptions,
			recommendedOption: eligibleOptions.length === 1 ? eligibleOptions[0] : null,
		};
	}

	static getAdvisoryWarnings ({spell, state, option, eligibleOptions = []}) {
		const warnings = [];
		const spellKey = this._getSpellKey(spell);
		const isDuplicate = (state?.getSpells?.() || []).some(existing => this._getSpellKey(existing) === spellKey);
		if (isDuplicate) {
			warnings.push({
				code: "duplicate",
				message: `${spell.name} (${spell.source}) is already on this character. Adding it again will merge with that row and will not create a duplicate.`,
			});
		}

		if (!eligibleOptions.length) {
			warnings.push({
				code: "no-eligible-attribution",
				message: "This spell is not on any detected class or subclass spell list for this character. You can still add it.",
			});
		}

		if (option?.isUnattributed) {
			warnings.push({
				code: "unattributed",
				message: Number(spell.level) > 0
					? "Leaving this leveled spell unattributed means it will appear under Other / Unattributed, will not use class-specific spellcasting stats, and will not have a Prepare control until it is re-added and attributed to a class."
					: "The spell will appear under Other / Unattributed and will not count toward a class spell total.",
			});
		} else if (option && !option.isEligible) {
			warnings.push({
				code: "class-list-mismatch",
				message: `${spell.name} is not on the detected spell list for ${option.label}. You can still use that attribution.`,
			});
		}

		if (option?.targetClass) {
			const card = (state?.getSpellcastingClassBreakdown?.() || []).find(it =>
				(it.className || "").toLowerCase() === (option.targetClass.name || "").toLowerCase()
				&& (!it.classSource || !option.targetClass.source || it.classSource === option.targetClass.source),
			);
			if (card && Number(spell.level) === 0 && card.cantripsMax != null && card.cantripsCount >= card.cantripsMax) {
				warnings.push({
					code: "cantrip-limit",
					message: `${card.displayName} already has ${card.cantripsCount}/${card.cantripsMax} cantrips. Adding another exceeds the displayed limit.`,
				});
			}
			if (card && Number(spell.level) > 0 && card.spellsMax != null && card.spellsCount >= card.spellsMax) {
				warnings.push({
					code: "spell-limit",
					message: `${card.displayName} already has ${card.spellsCount}/${card.spellsMax} spells. Adding another exceeds the displayed ${card.mechanic === "prepared" ? "prepared" : "known"} limit.`,
				});
			}
		}

		return warnings;
	}

	static _getSpellKey (spell) {
		return `${String(spell?.name || "").trim().toLowerCase()}|${String(spell?.source || "").trim().toLowerCase()}`;
	}
}
