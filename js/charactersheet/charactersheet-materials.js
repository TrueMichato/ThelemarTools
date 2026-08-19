/**
 * Character Sheet Materials Module (Thelemar homebrew)
 *
 * A material is a FOURTH, orthogonal axis alongside upgrades, gemstones and base
 * item data. It is stored non-destructively on the inventory item as a lightweight
 * `{name, source, ...}` reference (mirroring `appliedUpgrades`) and resolved at READ
 * time by {@link CharacterSheetMaterials.applyToItem}, so a material can be swapped
 * or removed without ever corrupting the underlying item.
 *
 * Effects are declared as STRUCTURED DATA in the homebrew entity (`itemMaterial`),
 * never hardcoded per material name here — adding a material is a data edit.
 *
 * @see docs/charactersheet/21-item-materials.md
 */

import {CharacterSheetModal} from "./charactersheet-modal.js";

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_, ee, Renderer} = /** @type {*} */ (globalThis);

class CharacterSheetMaterials {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._allMaterials = [];
		this._allResonances = [];
	}

	setMaterials (materials) {
		this._allMaterials = materials || [];
	}

	getMaterials () {
		return this._page.getItemMaterials?.() || this._allMaterials;
	}

	setResonances (resonances) {
		this._allResonances = resonances || [];
	}

	getResonances () {
		return this._page.getDraconicResonances?.() || this._allResonances;
	}

	// ==========================================
	// Constants
	// ==========================================

	/**
	 * The Weapon Damage Progression from the material rules. Wider than the upgrade
	 * ladder in `CharacterSheetUpgrades.increaseDamageDie`, which caps at 1d12 — that
	 * helper is deliberately left alone so the `Superior` upgrade is unchanged.
	 */
	static DIE_LADDER = ["1d4", "1d6", "1d8", "1d10", "1d12", "2d6", "2d8", "2d10", "2d12", "3d8", "3d10"];

	/** Off-ladder dice the rules call out as equivalents, mapped to their ladder step. */
	static DIE_EQUIVALENTS = {"2d4": 4, "3d6": 8};

	/** Iron, not steel, is the metal baseline for density-derived weight. */
	static METAL_BASELINE_DENSITY = 7.87;
	/** Seasoned equipment stock. Verified by Desert Ironwood (+25%) and Yellowwood (−50%). */
	static WOOD_BASELINE_DENSITY = 0.14;

	/** Categories whose density is compared against the wood baseline. */
	static WOOD_CATEGORIES = new Set(["wood"]);

	/** d8 Magical Interference table (verbatim). */
	static MAGICAL_INTERFERENCE_TABLE = [
		{roll: 1, name: "Arcane Sparks", entry: "The item sheds dim, colorful light in a 10-foot radius and hums loudly. Its user has Disadvantage on Dexterity ({@skill Stealth}) checks while it is unsheathed or worn."},
		{roll: 2, name: "Feedback Jolt", entry: "When the user rolls a 1 on an attack roll, saving throw, or ability check involving the item, they take {@damage 1d4} force damage per magical effect on it."},
		{roll: 3, name: "Fickle Magic", entry: "After each Short or Long Rest, determine one of the item's magical effects at random. That effect is suppressed until the next rest."},
		{roll: 4, name: "Wild Surge", entry: "The first time the user rolls a 20 on an attack roll or ability check involving the item, they immediately roll on the Wild Magic Surge table."},
		{roll: 5, name: "Repulsion", entry: "When the user takes more than 15 damage from one source, the item flies 10 feet away in a random direction if it can be removed or dropped."},
		{roll: 6, name: "Overheat", entry: "Activating any of the item's magical properties deals {@damage 1d6} fire damage to the user."},
		{roll: 7, name: "Leyline Shift", entry: "When the user scores a critical hit with the item, or a creature scores a critical hit against the user while the item is worn, the user teleports 15 feet in a random direction to the nearest unoccupied space."},
		{roll: 8, name: "Arcane Detonation", entry: "The item's lowest-tier magical effect permanently burns out. Each creature within 10 feet must make a {@dc 15} Dexterity saving throw, taking {@damage 3d6} force damage on a failed save or half as much on a successful one."},
	];

	/** Base DC for the interference check, before any overage. */
	static INTERFERENCE_BASE_DC = 15;

	/**
	 * Per-material Magic Capacity exceptions. The authored `note` is the rules text and
	 * wins whenever it is present; these are the fallbacks, and the trailing clause that
	 * tells the player what the sheet did about it.
	 *
	 * Only `freeEffect` and `dcRiseThreshold` change the arithmetic. The other two are
	 * advisories the sheet cannot decide for the player: whether two effects are
	 * genuinely "opposed states" is a table call, and foreknowledge is information given
	 * to the crafter, not a modifier.
	 */
	static MC_RULE_TEXT = {
		opposedStatesCountAsOne: {
			fallback: (mat) => `${mat.name}: two opposed states of one magical property count as a single effect when only one state can function at a time.`,
			applied: "Use the manual adjustment below to apply this.",
		},
		freeEffect: {
			fallback: (mat, rule) => `${mat.name}: the first ${rule.theme || "aligned"} effect placed on the item does not count against its Magic Capacity.`,
			applied: "Already deducted from the count.",
		},
		dcRiseThreshold: {
			fallback: (mat, rule) => `${mat.name}: ${rule.value || 2} effects above its Magic Capacity are required before the interference DC increases by 1.`,
			applied: "Already applied to the DC.",
		},
		makerForeknowledge: {
			fallback: (mat) => `${mat.name}: when an enchantment is first placed, its maker immediately knows whether another effect in the object would interfere with it, before committing the materials.`,
			applied: null,
		},
	};

	/**
	 * How each effect type reaches the player. This registry is the contract between
	 * AUTHORING (the brew declares `effects[].type`) and CONSUMPTION (something in the
	 * sheet acts on it).
	 *
	 * Without it, an effect can be authored, normalised by {@link getMaterialEffects},
	 * rendered as a tidy sentence by {@link getMaterialNotes} — and do nothing at all,
	 * silently and forever. There was no way to tell "deliberately narrative" apart from
	 * "someone forgot to wire it up". `CharacterSheetMaterialEffectHandling.test.js` walks
	 * every material in the brew and fails on any type missing from this table, so the gap
	 * is now a test failure rather than a bug report.
	 *
	 * `consumer` values:
	 * - `projection`  — `applyToItem` bakes it into the derived item.
	 * - `modifier`    — reaches a derived stat (speed, initiative, named modifiers, resistances).
	 * - `power`       — surfaces as an item power in the Actions hub.
	 * - `roll`        — read by the attack/damage roll path.
	 * - `reference`   — DELIBERATELY not automated; it is a table call. Must still be visible.
	 */
	static EFFECT_HANDLING = {
		// --- projection: baked into the derived item ---
		bonusAc: {consumer: "projection", note: "Folded into the item's AC bonus."},
		bonusWeaponAttack: {consumer: "projection", note: "Folded into the weapon's attack bonus."},
		bonusWeaponDamage: {consumer: "projection", note: "Folded into the weapon's damage bonus."},
		addProperty: {consumer: "projection", note: "Adds weapon properties."},
		removeProperty: {consumer: "projection", note: "Removes weapon properties."},
		propertyLadder: {consumer: "projection", note: "Steps a property up its ladder."},
		armorForceHeavy: {consumer: "projection", note: "Forces the armour to Heavy."},
		armorStealthDisadvantage: {consumer: "projection", note: "Imposes Stealth disadvantage."},
		armorNoStealthDisadvantage: {consumer: "projection", note: "Removes Stealth disadvantage."},
		armorNoStrengthRequirement: {consumer: "projection", note: "Drops the Strength requirement."},
		armorStrengthRequirementDelta: {consumer: "projection", note: "Adjusts the Strength requirement."},
		armorDexCapDelta: {consumer: "projection", note: "Adjusts the Dex cap."},
		rangeMultiplier: {consumer: "projection", note: "Multiplies weapon range."},
		thrownRangeDelta: {consumer: "projection", note: "Adjusts thrown range."},
		doubleNumericProperties: {consumer: "projection", note: "Doubles the item's numeric ratings."},
		penetrationIgnoresMagicalAc: {consumer: "projection", note: "Penetration applies against magical AC."},

		// --- modifier: reaches a derived stat ---
		bonusInitiative: {consumer: "modifier", note: "getInitiativeBonuses() → getInitiative()."},
		speedDelta: {consumer: "modifier", note: "getMaterialSpeedBonus() → getSpeed()/getSpeedByType()."},
		saveAdvantage: {consumer: "modifier", note: "Conditional named modifier on saves."},
		checkAdvantage: {consumer: "modifier", note: "Conditional named modifier on checks."},
		damageReduction: {consumer: "modifier", note: "Named modifier of type damageReduction."},
		resistance: {consumer: "modifier", note: "Added to derived resistances."},
		immunity: {consumer: "modifier", note: "Added to derived immunities."},
		perceptionPenaltyToNotice: {consumer: "modifier", note: "Derived, DM-facing: penalty to OTHERS' passive Perception to notice the wearer."},
		spellcastingFocus: {consumer: "modifier", note: "Makes the item eligible as a spellcasting focus."},
		draconicResonanceSlot: {consumer: "modifier", note: "Grants draconic resonance slots."},

		// --- roll: read by the attack/damage path ---
		countsAsMagical: {consumer: "roll", note: "Weapon tag; overcomes non-magical resistance."},
		countsAsSilvered: {consumer: "roll", note: "Weapon tag; overcomes silver-vulnerable resistance."},
		overrideDamageType: {consumer: "roll", note: "Offered as a damage-type choice at roll time."},
		bonusCritDamage: {consumer: "roll", note: "Extra dice on a critical hit."},
		extraDamageDiceVsType: {consumer: "roll", note: "Extra dice against a creature type."},
		noRangedDisadvantageInMelee: {consumer: "roll", note: "Suppresses the melee-range ranged disadvantage."},

		// --- power: surfaces in the Actions hub ---
		grantsAction: {consumer: "power", note: "Becomes an item power."},
		condensateAffinity: {consumer: "power", note: "Becomes an item power; reference-only when it is a table call."},
		condensateInstability: {consumer: "power", note: "Offered on its trigger, never auto-applied."},

		// --- reference: deliberately a table call ---
		indestructible: {consumer: "reference", note: "Whether an effect could damage the item is a DM call."},
		armorWearableUnderClothing: {consumer: "reference", note: "Concealment is a fiction/social question, not a stat."},
		note: {consumer: "reference", note: "Free prose the author attached to the material."},
	};

	static ROLE_LABELS = {
		strikingSurface: "Striking surface",
		protectiveLayer: "Protective layer",
		focus: "Spellcasting focus",
	};

	/**
	 * Which roles an item of a given kind can plausibly host. A condensate replaces exactly one
	 * part of an item — a weapon's striking surface, an armour's protective layer, or a focus —
	 * and its affinity applies *only* in that role. Only weapons are genuinely ambiguous: a
	 * crystal blade might be forged as the edge or carried as a focus.
	 */
	static KIND_ROLES = {
		weapon: ["strikingSurface", "focus"],
		armor: ["protectiveLayer"],
		shield: ["protectiveLayer"],
		other: ["focus"],
	};

	static CATEGORY_LABELS = {
		metal: "Metals",
		wood: "Wood",
		stone: "Stone & Glass",
		crystal: "Crystals",
		condensate: "Elemental Condensates",
		cloth: "Cloth",
		organic: "Leather, Hides & Scales",
		constructed: "Constructed Materials",
		other: "Other",
	};

	// ==========================================
	// Damage die ladder
	// ==========================================

	/**
	 * Move a damage die along the Weapon Damage Progression.
	 *
	 * Unlike `CharacterSheetUpgrades.increaseDamageDie`, this walks the full 11-step
	 * material ladder and accepts NEGATIVE steps (Gold −1, Heart Stone −2).
	 *
	 * @param {string} damageDie e.g. "1d6", "2d6", "1d10"
	 * @param {number} steps Signed number of steps to move.
	 * @returns {string} The stepped die, or the input unchanged if it is off-ladder.
	 */
	static stepDamageDie (damageDie, steps = 1) {
		if (!damageDie || !steps) return damageDie;
		const norm = String(damageDie).trim().toLowerCase();
		const match = norm.match(/^(\d+)d(\d+)$/);
		if (!match) return damageDie;

		const canonical = `${parseInt(match[1])}d${parseInt(match[2])}`;
		let idx = CharacterSheetMaterials.DIE_LADDER.indexOf(canonical);
		if (idx === -1) idx = CharacterSheetMaterials.DIE_EQUIVALENTS[canonical] ?? -1;
		if (idx === -1) return damageDie;

		const newIdx = Math.max(0, Math.min(idx + steps, CharacterSheetMaterials.DIE_LADDER.length - 1));
		return CharacterSheetMaterials.DIE_LADDER[newIdx];
	}

	// ==========================================
	// Entity lookup / axis helpers
	// ==========================================

	/**
	 * Resolve the full material entity behind an item's `{name, source}` reference.
	 * @param {object} item Inventory item data (or its flattened projection).
	 * @param {Array} [allMaterials] Catalog override (tests / static use).
	 * @returns {object|null}
	 */
	static resolveMaterial (item, allMaterials) {
		const ref = item?.material;
		if (!ref?.name) return null;
		const pool = allMaterials || globalThis.__csMaterialCatalog || [];
		const name = ref.name.toLowerCase();
		const source = (ref.source || "").toLowerCase();
		return pool.find(m => m.name?.toLowerCase() === name && (!source || (m.source || "").toLowerCase() === source))
			|| pool.find(m => m.name?.toLowerCase() === name)
			|| null;
	}

	/**
	 * Resolve an item's Draconic Domain Resonance reference to its full entity. Mirrors
	 * `resolveMaterial`: the reference is stored on the item, the entity lives in the catalog.
	 * @param {object} item
	 * @param {Array<object>} [allResonances]
	 * @returns {object|null}
	 */
	static resolveResonance (item, allResonances) {
		const ref = item?.material?.resonance;
		if (!ref?.name) return null;
		const pool = allResonances || globalThis.__csResonanceCatalog || [];
		const name = ref.name.toLowerCase();
		const source = (ref.source || "").toLowerCase();
		return pool.find(r => r.name?.toLowerCase() === name && (!source || (r.source || "").toLowerCase() === source))
			|| pool.find(r => r.name?.toLowerCase() === name)
			|| null;
	}

	/**
	 * An axis is "live" only when it is a real number. `"na"` (cannot apply) and
	 * `null` (Varies / unstated) both mean "do nothing".
	 * @param {number|string|null|undefined} value
	 * @returns {number|null}
	 */
	static axisValue (value) {
		return typeof value === "number" && Number.isFinite(value) ? value : null;
	}

	/** Human label for any axis cell, including the tri-state sentinels. */
	static formatAxis (value, {plus = false} = {}) {
		if (value === "na") return "N/A";
		if (value == null) return "Varies";
		if (value === "infinity") return "\u221E";
		if (value === "-infinity") return "\u2212\u221E";
		if (typeof value !== "number") return String(value);
		return plus && value > 0 ? `+${value}` : String(value);
	}

	static isWeapon (item) { return !!(item?.weapon || item?.type === "M" || item?.type === "R"); }
	static isArmor (item) { return !!(item?.armor || item?.type === "LA" || item?.type === "MA" || item?.type === "HA" || (item?.ac != null && item?.acBonus == null)); }
	static isShield (item) { return !!(item?.shield || item?.type === "S" || item?.acBonus != null); }

	/** The `appliesTo` bucket an item falls into, for gating material effects. */
	static getItemKind (item) {
		if (CharacterSheetMaterials.isShield(item)) return "shield";
		if (CharacterSheetMaterials.isArmor(item)) return "armor";
		if (CharacterSheetMaterials.isWeapon(item)) return "weapon";
		return "other";
	}

	/** Whether a material may be applied to this item at all. */
	static isEligible (item, material) {
		if (!material) return false;
		const kind = CharacterSheetMaterials.getItemKind(item);
		const appliesTo = material.appliesTo || [];
		return !appliesTo.length || appliesTo.includes(kind);
	}

	/** Every material this item could legally be made from. */
	getEligibleMaterials (item) {
		return this.getMaterials().filter(m => CharacterSheetMaterials.isEligible(item, m));
	}

	// ==========================================
	// Condensate roles
	// ==========================================

	/** Whether a material's effects are role-scoped (only elemental condensates are). */
	static isRoleScoped (material) {
		return material?.materialCategory === "condensate";
	}

	/** The role a condensate's affinity is written for, or `null`. */
	static getAffinityRole (material) {
		return material?.effects?.find(fx => fx.type === "condensateAffinity")?.role || null;
	}

	/** The roles this item could host, given what the material is capable of. */
	static getAvailableRoles (item, material) {
		const kindRoles = CharacterSheetMaterials.KIND_ROLES[CharacterSheetMaterials.getItemKind(item)] || [];
		const matRoles = material?.roles?.length ? material.roles : kindRoles;
		return kindRoles.filter(r => matRoles.includes(r));
	}

	/**
	 * Which part of the item this material actually forms. Defaults to the first role the item
	 * kind can host, which is the overwhelmingly common case (a weapon's edge, an armour's
	 * plates); the stored override exists for the crystal dagger carried as a focus.
	 */
	static getActiveRole (item, material) {
		const available = CharacterSheetMaterials.getAvailableRoles(item, material);
		if (!available.length) return null;
		const stored = item?.material?.role;
		return stored && available.includes(stored) ? stored : available[0];
	}

	// ==========================================
	// Effect resolution
	// ==========================================

	/**
	 * Does this structured effect apply to this item kind?
	 * An effect with no `appliesTo` applies to everything the material does.
	 */
	static _effectApplies (effect, kind) {
		if (!effect?.appliesTo?.length) return true;
		return effect.appliesTo.includes(kind);
	}

	/**
	 * Normalise a material's structured effects into a flat, consumable shape.
	 *
	 * This is the single place that understands the effect vocabulary; everything
	 * downstream (projection, modifiers, UI) reads the returned object.
	 *
	 * @param {object} item
	 * @param {object} material
	 * @returns {object}
	 */
	static getMaterialEffects (item, material) {
		const out = {
			bonusAc: 0,
			bonusWeaponAttack: 0,
			bonusWeaponDamage: 0,
			bonusInitiative: 0,
			speedDelta: 0,
			addProperties: [],
			removeProperties: [],
			propertyLadder: null,
			armorForceHeavy: false,
			armorStealthDisadvantage: false,
			armorNoStealthDisadvantage: false,
			armorNoStrengthRequirement: false,
			armorStrengthRequirementDelta: 0,
			armorDexCapDelta: 0,
			armorWearableUnderClothing: false,
			damageReduction: [],
			countsAsMagical: false,
			countsAsSilvered: false,
			indestructible: false,
			spellcastingFocus: false,
			noRangedDisadvantageInMelee: false,
			doubleNumericProperties: false,
			penetrationIgnoresMagicalAc: false,
			rangeMultiplier: null,
			thrownRangeDelta: 0,
			overrideDamageType: null,
			bonusCritDamage: null,
			extraDamageDiceVsType: [],
			perceptionPenaltyToNotice: 0,
			draconicResonanceSlots: 0,
			resistances: [],
			immunities: [],
			conditionalModifiers: [],
			grantedActions: [],
			condensate: null,
			notes: [],
			// Authored prose keyed by effect type. By default an effect's own `note` is the book's
			// wording for that effect and REPLACES the sheet's generated description. Notes marked
			// `"noteMode": "qualifier"` are sentence fragments that only narrow the effect, so they
			// are appended to the generated description instead.
			effectNotes: {},
			effectQualifiers: {},
		};
		if (!material?.effects?.length) return out;

		const kind = CharacterSheetMaterials.getItemKind(item);

		// "An elemental condensate can replace a weapon's striking surface, an armor's primary
		// protective layer, or a spellcasting focus. Its special property applies only in that
		// role." A Smokestone *weapon* is therefore an ordinary weapon of dense smoke-stone — the
		// bonus-action smoke cloud is a focus property and does not come along for free.
		// The instability is inherent to the substance, so it is never gated away.
		const isRoleScoped = CharacterSheetMaterials.isRoleScoped(material);
		const affinityRole = isRoleScoped ? CharacterSheetMaterials.getAffinityRole(material) : null;
		const affinityActive = !isRoleScoped || !affinityRole
			|| CharacterSheetMaterials.getActiveRole(item, material) === affinityRole;

		for (const fx of material.effects) {
			if (!CharacterSheetMaterials._effectApplies(fx, kind)) continue;
			// The affinity and instability descriptions always come through so the UI can show a
			// dormant affinity and explain *why* it is dormant; only the mechanics are gated.
			const isDescriptive = fx.type === "condensateAffinity" || fx.type === "condensateInstability";
			if (isRoleScoped && !affinityActive && !isDescriptive) continue;

			switch (fx.type) {
				case "bonusAc": out.bonusAc += fx.value || 0; break;
				case "bonusWeaponAttack": out.bonusWeaponAttack += fx.value || 0; break;
				case "bonusWeaponDamage": out.bonusWeaponDamage += fx.value || 0; break;
				case "bonusInitiative": out.bonusInitiative += fx.value || 0; break;
				case "speedDelta": out.speedDelta += fx.value || 0; break;

				case "addProperty": out.addProperties.push(...(fx.properties || [])); break;
				case "removeProperty": out.removeProperties.push(...(fx.properties || [])); break;
				case "propertyLadder": out.propertyLadder = fx.ladder || null; break;

				case "armorForceHeavy": out.armorForceHeavy = true; break;
				case "armorStealthDisadvantage": out.armorStealthDisadvantage = true; break;
				case "armorNoStealthDisadvantage": out.armorNoStealthDisadvantage = true; break;
				case "armorNoStrengthRequirement": out.armorNoStrengthRequirement = true; break;
				case "armorStrengthRequirementDelta": out.armorStrengthRequirementDelta += fx.value || 0; break;
				case "armorDexCapDelta": out.armorDexCapDelta += fx.value || 0; break;
				case "armorWearableUnderClothing": out.armorWearableUnderClothing = true; break;

				case "damageReduction": out.damageReduction.push({value: fx.value || 0, armorType: fx.armorType || null, damageTypes: fx.damageTypes || []}); break;

				case "countsAsMagical": out.countsAsMagical = true; break;
				case "countsAsSilvered": out.countsAsSilvered = true; break;
				case "indestructible": out.indestructible = true; break;
				case "spellcastingFocus": out.spellcastingFocus = true; break;
				case "noRangedDisadvantageInMelee": out.noRangedDisadvantageInMelee = true; break;
				case "doubleNumericProperties": out.doubleNumericProperties = true; break;
				case "penetrationIgnoresMagicalAc": out.penetrationIgnoresMagicalAc = true; break;

				case "rangeMultiplier": out.rangeMultiplier = fx.value ?? null; break;
				case "thrownRangeDelta": out.thrownRangeDelta += fx.value || 0; break;
				case "overrideDamageType": out.overrideDamageType = {damageType: fx.damageType, optional: !!fx.optional}; break;
				case "bonusCritDamage": out.bonusCritDamage = {dice: fx.dice, damageType: fx.damageType || null, requiresProperty: fx.requiresProperty || null}; break;
				case "extraDamageDiceVsType": out.extraDamageDiceVsType.push({dice: fx.dice ?? 1, creatureType: fx.creatureType}); break;
				case "perceptionPenaltyToNotice": out.perceptionPenaltyToNotice += fx.value || 0; break;
				case "draconicResonanceSlot": out.draconicResonanceSlots += fx.count ?? 1; break;

				case "resistance": out.resistances.push(...(fx.damageTypes || [fx.damageType].filter(Boolean))); break;
				case "immunity": out.immunities.push(...(fx.damageTypes || [fx.damageType].filter(Boolean))); break;

				case "saveAdvantage":
				case "checkAdvantage":
					out.conditionalModifiers.push({
						kind: fx.type === "saveAdvantage" ? "save" : "check",
						conditional: fx.conditional || null,
						schools: fx.schools || null,
					});
					break;

				case "grantsAction":
					out.grantedActions.push({name: fx.name || material.name, actionType: fx.actionType || null, note: fx.note || null});
					break;

				case "condensateAffinity":
					out.condensate = {
						...(out.condensate || {}),
						affinity: fx.text,
						role: fx.role || null,
						activeRole: isRoleScoped ? CharacterSheetMaterials.getActiveRole(item, material) : null,
						isActive: affinityActive,
					};
					break;

				case "condensateInstability":
					out.condensate = {...(out.condensate || {}), instability: fx.text};
					break;

				case "note": out.notes.push(fx.text); break;
				default: break;
			}

			// `grantsAction` renders its own note as the action's description, so it must not also
			// be captured as a type-level override.
			if (fx.note && fx.type !== "note" && fx.type !== "grantsAction") {
				if (fx.noteMode === "qualifier") out.effectQualifiers[fx.type] = fx.note;
				else out.effectNotes[fx.type] = fx.note;
			}
		}

		return out;
	}

	// ==========================================
	// Weight / value
	// ==========================================

	/**
	 * Weight multiplier implied by the material.
	 *
	 * An explicit `weightMultiplier` in the data always wins (the document sometimes
	 * states one in prose, e.g. Desert Ironwood +25%). Otherwise it is derived from
	 * the density ratio against the category baseline — iron for metals, seasoned
	 * stock for wood. A `Varies` density yields no derivation.
	 *
	 * @returns {number|null} null when no multiplier can be determined.
	 */
	static getWeightMultiplier (material) {
		if (!material) return null;
		if (typeof material.weightMultiplier === "number" && material.weightMultiplier > 0) return material.weightMultiplier;
		const density = material.density;
		if (typeof density !== "number" || !(density > 0)) return null;
		const baseline = CharacterSheetMaterials.WOOD_CATEGORIES.has(material.materialCategory)
			? CharacterSheetMaterials.WOOD_BASELINE_DENSITY
			: CharacterSheetMaterials.METAL_BASELINE_DENSITY;
		return density / baseline;
	}

	/**
	 * The item's weight once made from the material.
	 * @returns {number|null} null when the base item has no weight to scale.
	 */
	static getEffectiveWeight (item, material) {
		const base = Number(item?.weight);
		if (!Number.isFinite(base) || base <= 0) return Number.isFinite(base) ? base : null;
		const mult = CharacterSheetMaterials.getWeightMultiplier(material);
		if (mult == null) return base;
		return Math.round(base * mult * 100) / 100;
	}

	/**
	 * The item's value once made from the material, in COPPER (the 5etools unit).
	 *
	 * `base item value + (effective weight x price per lb)`. Only per-pound trade
	 * units can be recomputed — a price quoted per vial, square yard, square foot,
	 * tooth or "Priceless" has no coherent per-weight conversion, so the base value
	 * is returned untouched and the price is shown as reference only.
	 *
	 * @returns {number|null}
	 */
	static getEffectiveValue (item, material) {
		const base = Number(item?.value);
		const baseValue = Number.isFinite(base) ? base : 0;
		const price = material?.price;
		if (!price || price.isPriceless || price.unit !== "lb" || typeof price.gp !== "number") return Number.isFinite(base) ? base : null;

		const weight = CharacterSheetMaterials.getEffectiveWeight(item, material);
		if (!Number.isFinite(weight) || weight <= 0) return Number.isFinite(base) ? base : null;

		// Item `value` is in copper pieces; the price guide is in gold per pound.
		return Math.round(baseValue + (weight * price.gp * 100));
	}

	// ==========================================
	// Penetration
	// ==========================================

	/**
	 * Penetration rating of a weapon made from the material.
	 *
	 * The sheet tracks no target AC, so this cannot resolve automatically. It is
	 * surfaced on the attack row and offered as a post-miss prompt taking the miss
	 * margin — see `charactersheet-combat.js`.
	 *
	 * @returns {number} 0 when the material has none or the axis cannot apply.
	 */
	static getPenetration (item, material) {
		if (!material || !CharacterSheetMaterials.isWeapon(item)) return 0;
		return CharacterSheetMaterials.axisValue(material.penetration) || 0;
	}

	// ==========================================
	// Item projection
	// ==========================================

	/**
	 * Project a material onto an item, returning a NEW object. The stored item is
	 * never mutated — that is what makes a material safely swappable.
	 *
	 * @param {object} item Inventory item data (must carry `item.material`).
	 * @param {object} [material] Pre-resolved entity; looked up from the catalog if omitted.
	 * @returns {object} The item as it behaves while made from the material.
	 */
	static applyToItem (item, material, opts = {}) {
		if (!item) return item;
		const mat = material || CharacterSheetMaterials.resolveMaterial(item);
		if (!mat) return item;

		const kind = CharacterSheetMaterials.getItemKind(item);
		const fx = CharacterSheetMaterials.getMaterialEffects(item, mat);
		const out = {...item};
		const degradation = opts.isSkipDegradation ? null : CharacterSheetMaterials.getDegradationStatus(item, mat);

		// --- Damage: signed steps along the progression ---
		// A degraded edge subtracts further steps, so the two are summed before stepping —
		// stepping twice would round through the ladder's off-ladder rungs differently.
		const dmgSteps = CharacterSheetMaterials.axisValue(mat.damage) + (degradation?.damageStepDelta || 0);
		if (dmgSteps && kind === "weapon") {
			if (out.dmg1) out.dmg1 = CharacterSheetMaterials.stepDamageDie(out.dmg1, dmgSteps);
			if (out.dmg2) out.dmg2 = CharacterSheetMaterials.stepDamageDie(out.dmg2, dmgSteps);
		}

		// --- Protection: sets the BASE AC of armour, before Dex and shield ---
		const protection = degradation?.zeroedAxes?.includes("protection")
			? 0
			: CharacterSheetMaterials.axisValue(mat.protection);
		if (protection && kind === "armor") out.ac = protection;

		// --- Critical: each positive point lowers the threshold by 1 ---
		// Weapons only: a crit threshold on a breastplate is inert — nothing rolls
		// against it — so setting one would have the summary promise an effect that
		// never lands.
		const critical = degradation?.zeroedAxes?.includes("critical")
			? 0
			: CharacterSheetMaterials.axisValue(mat.critical);
		if (critical && kind === "weapon") {
			const baseCrit = Number(out.critThreshold) || 20;
			// Clamped both ways: never an impossible crit, never past the natural 20.
			out.critThreshold = Math.max(2, Math.min(20, baseCrit - critical));
		}

		// --- Penetration ---
		const penetration = CharacterSheetMaterials.getPenetration(item, mat);
		if (penetration) out.penetration = penetration;

		// --- Weapon properties ---
		if (kind === "weapon" && (fx.addProperties.length || fx.removeProperties.length || fx.propertyLadder)) {
			out.property = CharacterSheetMaterials._projectProperties(out.property, fx);
		}

		// --- Flat bonuses ---
		if (fx.bonusAc) out.acBonus = (Number(out.acBonus) || 0) + fx.bonusAc;
		if (fx.bonusWeaponAttack) out.bonusWeaponAttack = (Number(out.bonusWeaponAttack) || 0) + fx.bonusWeaponAttack;
		if (fx.bonusWeaponDamage) out.bonusWeaponDamage = (Number(out.bonusWeaponDamage) || 0) + fx.bonusWeaponDamage;

		// --- Armour behaviour ---
		if (kind === "armor") {
			if (fx.armorNoStealthDisadvantage) out.stealth = false;
			else if (fx.armorStealthDisadvantage) out.stealth = true;

			if (fx.armorNoStrengthRequirement) out.strength = null;
			else if (fx.armorStrengthRequirementDelta && out.strength != null) {
				const req = parseInt(out.strength);
				if (!isNaN(req)) out.strength = req + fx.armorStrengthRequirementDelta;
			}

			if (fx.armorForceHeavy) out.armorType = "heavy";

			if (fx.armorDexCapDelta && out.dexterityMax != null) {
				out.dexterityMax = Math.max(0, out.dexterityMax + fx.armorDexCapDelta);
			}
		}

		// --- Ranged weapon range ---
		if (kind === "weapon" && fx.rangeMultiplier && out.range) {
			out.range = CharacterSheetMaterials._scaleRange(out.range, fx.rangeMultiplier);
		}

		// --- Derived weight / value ---
		const weight = CharacterSheetMaterials.getEffectiveWeight(item, mat);
		if (weight != null) out.weight = weight;
		const value = CharacterSheetMaterials.getEffectiveValue(item, mat);
		if (value != null) out.value = value;

		out._materialEffects = fx;
		out._materialEntity = {name: mat.name, source: mat.source};
		if (degradation) out._materialDegradation = degradation;

		return out;
	}

	/* ------------------------------------------------------------------ *
	 * Degradation
	 *
	 * Five materials wear out in play: Stone and Flint, Obsidian, Duststone
	 * (Damage steps down), Rimeglass (Protection and Critical drop to 0) and
	 * Ordinary Glass (destroyed outright). All five are declared as a
	 * `degradation` block on the material, never keyed off its name.
	 * ------------------------------------------------------------------ */

	/** The authored `degradation` block, or `null` when the material never degrades. */
	static getDegradationSpec (material) {
		const spec = material?.degradation;
		return spec && typeof spec === "object" ? spec : null;
	}

	/**
	 * Would `trigger` degrade an item made of this material?
	 * `trigger` is `{type: "attackRoll", natural, isCrit}` or `{type: "damageTaken", damageType}`.
	 */
	static isDegradationTriggered (material, trigger) {
		const spec = CharacterSheetMaterials.getDegradationSpec(material);
		if (!spec || !trigger) return false;
		const t = spec.trigger || {};

		if (t.on === "attackRoll") {
			if (trigger.type !== "attackRoll") return false;
			if (Array.isArray(t.natural) && t.natural.includes(Number(trigger.natural))) return true;
			return !!(t.alsoOnCriticalHit && trigger.isCrit);
		}

		if (t.on === "damageTaken") {
			if (trigger.type !== "damageTaken") return false;
			if (!t.damageType) return true;
			return String(trigger.damageType || "").toLowerCase() === String(t.damageType).toLowerCase();
		}

		return false;
	}

	/**
	 * Resolve the recorded stacks on an item into the projection deltas
	 * `applyToItem` consumes. Returns `null` when the item is not degraded.
	 */
	static getDegradationStatus (item, material) {
		const mat = material || CharacterSheetMaterials.resolveMaterial(item);
		const spec = CharacterSheetMaterials.getDegradationSpec(mat);
		if (!spec) return null;

		const stacks = Math.max(0, Number(item?.material?.degradationStacks) || 0);
		const isDestroyed = !!item?.material?.isDestroyed;
		if (!stacks && !isDestroyed) return null;

		// A non-stacking effect applies once however many times it was triggered.
		const applied = spec.stacking ? stacks : Math.min(1, stacks);
		const out = {
			stacks,
			applied,
			isDestroyed,
			damageStepDelta: 0,
			zeroedAxes: [],
			repair: spec.repair || null,
			note: spec.note || null,
		};

		const effect = spec.effect || {};
		switch (effect.type) {
			case "damageStepDelta": out.damageStepDelta = (Number(effect.value) || 0) * applied; break;
			case "zeroAxes": if (applied) out.zeroedAxes = [...(effect.axes || [])]; break;
			case "destroy": break; // Handled by `isDestroyed` — there is nothing left to project.
			default: break;
		}

		return out;
	}

	/**
	 * The risk a material carries, asked *before* it is applied — or `null`.
	 *
	 * `getDegradationStatus` answers "what has already happened to this item".
	 * This answers "what could happen if I choose this", which is the question the
	 * picker is actually asking, and it has to be answerable with no item state at all.
	 *
	 * Two tiers, because they are not the same decision. Exactly one material in the
	 * catalog destroys its item outright; four others degrade recoverably. Collapsing
	 * them into one warning would either cry wolf about Obsidian or under-sell Glass.
	 * Both tiers are derived from the authored `degradation` block — never from a
	 * material's name.
	 *
	 * @param {object} material
	 * @returns {?{tier: string, label: string, trigger: string, note: ?string, repair: ?string}}
	 */
	static getRiskFlag (material) {
		const spec = CharacterSheetMaterials.getDegradationSpec(material);
		if (!spec) return null;

		const t = spec.trigger || {};
		let trigger = "in use";
		if (t.on === "attackRoll") {
			const nat = (t.natural || []).map(n => `a natural ${n}`).join(" or ");
			trigger = [nat, t.alsoOnCriticalHit ? "a critical hit" : null].filter(Boolean).join(" or ");
			trigger = trigger ? `on ${trigger}` : "on an attack roll";
		} else if (t.on === "damageTaken") {
			trigger = `when it takes ${t.damageType ? `${t.damageType} ` : ""}damage`;
		}

		if (spec.destroys) return {tier: "destroys", label: "Can be destroyed", trigger, note: spec.note || null, repair: null};

		const repair = spec.repair?.method === "shortRest"
			? `Repaired over a Short Rest${spec.repair.tool ? ` with ${spec.repair.tool}` : ""}.`
			: "Repaired manually.";
		return {tier: "degrades", label: "Degrades in use", trigger, note: spec.note || null, repair};
	}

	/** Human-readable one-liner for the badge / tooltip, or `null`. */
	static getDegradationSummary (item, material) {
		const status = CharacterSheetMaterials.getDegradationStatus(item, material);
		if (!status) return null;
		if (status.isDestroyed) return "Destroyed";
		if (status.damageStepDelta) return `Damage ${status.damageStepDelta} step${Math.abs(status.damageStepDelta) === 1 ? "" : "s"}`;
		if (status.zeroedAxes.length) return `${status.zeroedAxes.map(a => a[0].toUpperCase() + a.slice(1)).join(" and ")} reduced to 0`;
		return "Degraded";
	}

	/**
	 * Apply property adds / removes / the Mithril-style ladder.
	 * Weapon properties are stored either bare (`"F"`) or source-qualified (`"F|XPHB"`).
	 */
	static _projectProperties (property, fx) {
		const props = Array.isArray(property) ? [...property] : [];
		const abvOf = p => String(p).split("|")[0];
		const has = abv => props.some(p => abvOf(p) === abv);

		// The ladder is evaluated against the ORIGINAL shape, so a single material
		// cannot cascade a weapon through two rungs in one application.
		const ladderAdds = [];
		if (fx.propertyLadder) {
			if (has("2H") && fx.propertyLadder["2H"]) ladderAdds.push(fx.propertyLadder["2H"]);
			else if (has("L") && fx.propertyLadder["L"]) ladderAdds.push(fx.propertyLadder["L"]);
			else if (fx.propertyLadder["_"]) ladderAdds.push(fx.propertyLadder["_"]);
		}

		let out = props;
		if (fx.removeProperties.length) {
			const drop = new Set(fx.removeProperties);
			out = out.filter(p => !drop.has(abvOf(p)));
		}
		// A ladder that promotes 2H → V must also retire the 2H it replaced.
		if (fx.propertyLadder && has("2H") && fx.propertyLadder["2H"]) {
			out = out.filter(p => abvOf(p) !== "2H");
		}
		for (const add of [...fx.addProperties, ...ladderAdds]) {
			if (!out.some(p => abvOf(p) === add)) out.push(add);
		}
		return out;
	}

	/** Scale a `"80/320"`-style range string by a multiplier. */
	static _scaleRange (range, mult) {
		const str = String(range);
		const parts = str.split("/").map(p => Number(p.trim()));
		if (parts.some(p => !Number.isFinite(p))) return range;
		return parts.map(p => Math.floor(p * mult)).join("/");
	}

	// ==========================================
	// Display helpers
	// ==========================================

	/**
	 * One-line summary of what a material does, for pickers and chips.
	 *
	 * Pass `item` whenever one is in hand. Without it the summary lists every axis
	 * the material carries, which reads as nonsense in context — a longsword row
	 * announcing "AC 18" is describing a suit of armour the player is not looking
	 * at. The axis gating here mirrors `applyToItem` exactly, so the summary
	 * promises only what the projection will actually deliver.
	 *
	 * @param {object} material
	 * @param {object} [item] Item the material would be applied to.
	 */
	static getSummary (material, item) {
		if (!material) return "";
		const kind = item ? CharacterSheetMaterials.getItemKind(item) : null;
		const bits = [];
		const push = (label, v, opts) => {
			const n = CharacterSheetMaterials.axisValue(v);
			if (n) bits.push(`${label} ${CharacterSheetMaterials.formatAxis(v, opts)}`);
		};
		if (!kind || kind === "weapon") push("Dmg", material.damage, {plus: true});
		if ((!kind || kind === "armor") && CharacterSheetMaterials.axisValue(material.protection)) bits.push(`AC ${material.protection}`);
		if (!kind || kind === "weapon") push("Crit", material.critical, {plus: true});
		if (!item || CharacterSheetMaterials.isWeapon(item)) push("Pen", material.penetration, {plus: true});
		if (material.magicCapacity != null) bits.push(`MC ${CharacterSheetMaterials.formatAxis(material.magicCapacity)}`);
		return bits.join(" \u00B7 ");
	}

	/**
	 * Accessible name for the material chip on an inventory row.
	 *
	 * The chip shows a gear glyph and a bare noun — "\u2699 Mithril" — which tells a
	 * screen reader nothing about why the player should care. Everything that made
	 * the chip worth rendering lives in its tooltip, and a tooltip is mouse-only.
	 *
	 * @param {object} material
	 * @param {object} [item] host item, so the summary names only axes it can host
	 * @returns {string}
	 */
	static getMaterialBadgeAriaLabel (material, item) {
		if (!material?.name) return "";
		const summary = CharacterSheetMaterials.getSummary(material, item);
		return `Material: ${material.name}${summary ? `. ${summary}` : ""}`;
	}

	// ==========================================
	// Magic Capacity
	// ==========================================

	/**
	 * Every distinct spell an item has attached, whatever shape the data is in.
	 *
	 * `attachedSpells` is only sometimes the flat `["fireball|phb"]` array — far more
	 * often it is keyed by usage: `will` / `other` / `ritual` hold arrays directly,
	 * while `daily` / `charges` / `limited` / `rest` nest one level further under a
	 * use count (`{"1e": [...]}`). The sheet emits that shape itself when a custom
	 * item is built with spells, so it has to be read, not assumed away.
	 *
	 * Rather than enumerate the usage keys — which would need revisiting every time a
	 * new one appears — this collects **only strings that live inside an array**. That
	 * covers every observed shape in one rule, and drops non-spell siblings such as
	 * `ability: "int"` for free, since a bare string value is not in a list.
	 *
	 * @param {Array|object|null} attachedSpells
	 * @returns {string[]} Distinct spell names, without `|source` or `#level` suffixes.
	 */
	static _flattenAttachedSpells (attachedSpells) {
		if (!attachedSpells) return [];

		const raw = [];
		const walk = (node, isInArray) => {
			if (Array.isArray(node)) return node.forEach(it => walk(it, true));
			if (node && typeof node === "object") return Object.values(node).forEach(it => walk(it, false));
			if (isInArray && typeof node === "string") raw.push(node);
		};
		walk(attachedSpells, false);

		// The same spell offered both at-will and daily is one enchantment, not two —
		// consistent with bonus families collapsing together in the tally below.
		const seen = new Set();
		const out = [];
		for (const it of raw) {
			const name = it.split("|")[0].split("#")[0].trim();
			if (!name) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(name);
		}
		return out;
	}

	/**
	 * How many magical effects an item is counted as carrying.
	 *
	 * The book never enumerates what "one distinct magical effect" is, so this is a
	 * house interpretation exposed as data rather than hidden in the arithmetic: each
	 * rule is returned in the breakdown with the things that triggered it, so a DM can
	 * see exactly what was counted and overrule it.
	 *
	 * Bonus *families* are deliberately coarse — a +2 weapon is one effect, not two,
	 * even though it moves both attack and damage.
	 *
	 * @param {object} item Projected or raw inventory item.
	 * @param {object} [opts]
	 * @param {object} [opts.material] Resolved material, for its MC exceptions.
	 * @param {number} [opts.manualAdjust] User override, added to the total.
	 * @param {(upgrade: object) => boolean} [opts.isUpgradeMagical] Magicality resolver for applied
	 *        upgrades. Defaults to reading the snapshot's own `isMagical`; callers with the upgrade
	 *        catalog to hand pass `CharacterSheetUpgrades.isUpgradeMagical` so that saves written
	 *        before the flag existed still resolve. Kept injectable so this stays testable without
	 *        a loaded catalog.
	 * @returns {{total: number, breakdown: Array<{label: string, count: number, detail?: string}>}}
	 */
	static countMagicalEffects (item, {material = null, manualAdjust = 0, isUpgradeMagical = null} = {}) {
		const breakdown = [];
		if (!item) return {total: 0, breakdown};

		const add = (label, count, detail) => {
			if (!count) return;
			breakdown.push(detail ? {label, count, detail} : {label, count});
		};

		// Most upgrades are plain smithing — Balanced, Brutal, Sharpened, Silvered, the armour
		// proofings — and counting them against a MAGIC capacity budget filled items up with
		// craftsmanship. Only upgrades authored `isMagical` count. A snapshot that cannot be
		// resolved is treated as non-magical: a lookup miss must not manufacture an overload.
		const resolveMagical = isUpgradeMagical || (u => u?.isMagical === true);
		const upgrades = (item.appliedUpgrades || []).filter(u => resolveMagical(u));
		add("Magical upgrades", upgrades.length, upgrades.map(u => u.name).join(", "));

		const gems = item.socketedGemstones || [];
		add("Socketed gemstones", gems.length, gems.map(g => g.name).join(", "));

		// One per non-zero bonus FAMILY. `bonusWeapon` and its attack/damage split are
		// the same enchantment expressed three ways, so they collapse into one.
		const families = [
			{label: "Weapon bonus", keys: ["bonusWeapon", "bonusWeaponAttack", "bonusWeaponDamage"]},
			{label: "AC bonus", keys: ["bonusAc"]},
			{label: "Spellcasting bonus", keys: ["bonusSpellAttack", "bonusSpellSaveDc"]},
			{label: "Saving throw bonus", keys: ["bonusSavingThrow", "bonusSavingThrowConcentration"]},
			{label: "Ability check bonus", keys: ["bonusAbilityCheck", "bonusProficiencyBonus"]},
		];
		for (const fam of families) {
			const hit = fam.keys.filter(k => CharacterSheetMaterials._isMeaningfulBonus(item[k]));
			if (hit.length) add(fam.label, 1, hit.map(k => CharacterSheetMaterials._BONUS_KEY_LABELS[k] || k).join(", "));
		}

		const spells = CharacterSheetMaterials._flattenAttachedSpells(item.attachedSpells);
		add("Attached spells", spells.length, spells.join(", "));

		const defences = [
			...(item.resist || []),
			...(item.immune || []),
			...(item.conditionImmune || []),
		].map(x => (typeof x === "string" ? x : x?.resist || x?.immune || "")).filter(Boolean);
		add("Granted resistances/immunities", defences.length, defences.join(", "));

		if (item.ability && Object.keys(item.ability).length) add("Ability score set/bonus", 1, CharacterSheetMaterials._labelKeys(item.ability, CharacterSheetMaterials._ABILITY_KEY_LABELS));
		if (item.modifySpeed && Object.keys(item.modifySpeed).length) add("Speed alteration", 1, CharacterSheetMaterials._labelKeys(item.modifySpeed, CharacterSheetMaterials._SPEED_KEY_LABELS));
		if (item.curse) add("Cursed", 1);
		if (item.sentient) add("Sentient", 1);

		let total = breakdown.reduce((acc, it) => acc + it.count, 0);

		// Material exceptions that REDUCE the count, applied after the raw tally so the
		// breakdown still shows what was there before the discount.
		const freeRules = (material?.magicCapacityRules || []).filter(r => r.type === "freeEffect");
		for (const rule of freeRules) {
			if (total <= 0) break;
			// A rule may be scoped to a *form* of the material rather than the material as a
			// whole — Ioun Crystal's free aligned effect belongs to a fragment, not to an
			// intact stone or a whole-crystal item. An unscoped rule applies to everything.
			if (!CharacterSheetMaterials._isMcRuleFormApplicable(item, rule)) continue;
			total -= 1;
			breakdown.push({label: `${material.name} \u2014 free effect`, count: -1, detail: rule.theme || null});
		}

		if (manualAdjust) {
			total += manualAdjust;
			breakdown.push({label: "Manual adjustment", count: manualAdjust});
		}

		return {total: Math.max(0, total), breakdown};
	}

	/**
	 * The Magic Capacity breakdown is shown to a player who is deciding whether to strip an
	 * enchantment off an overloaded item. It is the one place these internal 5etools property
	 * names would otherwise reach the screen — `bonusWeapon, bonusWeaponAttack` is not an
	 * answer to "what is filling my sword up".
	 */
	static _BONUS_KEY_LABELS = {
		bonusWeapon: "attack and damage",
		bonusWeaponAttack: "attack rolls",
		bonusWeaponDamage: "damage rolls",
		bonusAc: "Armor Class",
		bonusSpellAttack: "spell attack rolls",
		bonusSpellSaveDc: "spell save DC",
		bonusSavingThrow: "saving throws",
		bonusSavingThrowConcentration: "concentration saves",
		bonusAbilityCheck: "ability checks",
		bonusProficiencyBonus: "proficiency bonus",
	};

	static _ABILITY_KEY_LABELS = {
		str: "Strength",
		dex: "Dexterity",
		con: "Constitution",
		int: "Intelligence",
		wis: "Wisdom",
		cha: "Charisma",
	};

	static _SPEED_KEY_LABELS = {
		walk: "walking",
		fly: "flying",
		swim: "swimming",
		climb: "climbing",
		burrow: "burrowing",
		equal: "matched to another speed",
		multiply: "multiplied",
		static: "set to a fixed value",
	};

	/**
	 * Human labels for an object's keys, in the object's own order. An unmapped key falls
	 * through verbatim rather than being dropped — a leaked key is a bug worth seeing, and
	 * silently hiding it would make the tally unreconcilable with the count beside it.
	 */
	static _labelKeys (obj, labels) {
		return Object.keys(obj || {}).map(k => labels[k] || k).join(", ");
	}

	/** A bonus counts only when it is present and non-zero; `"+0"` and `0` are inert. */
	static _isMeaningfulBonus (value) {
		if (value == null) return false;
		if (typeof value === "number") return value !== 0;
		const n = Number(String(value).replace(/[^-\d.]/g, ""));
		return Number.isFinite(n) ? n !== 0 : !!String(value).trim();
	}

	/**
	 * Whether an `appliesTo`-scoped Magic Capacity rule matches the *form* this item takes.
	 *
	 * Ioun Crystal is the only material whose forms differ mechanically — an intact stone, a
	 * loose fragment and the surrounding sand are all "Ioun Crystal" — so the scope is matched
	 * against the item's name. An unscoped rule always applies.
	 *
	 * @param {object} item
	 * @param {object} rule
	 * @returns {boolean}
	 */
	static _isMcRuleFormApplicable (item, rule) {
		if (!rule?.appliesTo) return true;
		const name = String(item?.name || "");
		const forms = Array.isArray(rule.appliesTo) ? rule.appliesTo : [rule.appliesTo];
		return forms.some(form => new RegExp(`\\b${String(form).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(name));
	}

	/**
	 * The item's standing against its material's Magic Capacity.
	 *
	 * @returns {null|{
	 *   capacity: number|null, capacityDisplay: string, count: number,
	 *   breakdown: Array, overage: number, isOverloaded: boolean,
	 *   isUnlimited: boolean, isSuppressing: boolean, dc: number|null,
	 *   dcRiseThreshold: number, notes: string[]
	 * }} `null` when the item has no material, or the material states no capacity.
	 */
	static getMagicCapacityStatus (item, material, {manualAdjust = 0} = {}) {
		const mat = material || CharacterSheetMaterials.resolveMaterial(item);
		if (!mat) return null;

		const raw = mat.magicCapacity;
		if (raw == null || raw === "na") return null;

		// Resolve magicality through the upgrades module when it is loaded, so applied-upgrade
		// snapshots written before `isMagical` existed still resolve against the catalog. Read
		// off `globalThis` rather than imported: materials must not take a hard dependency on
		// upgrades, and the fallback (the snapshot's own flag) is correct for every new save.
		const isUpgradeMagical = globalThis.CharacterSheetUpgrades?.isUpgradeMagical
			? (u) => globalThis.CharacterSheetUpgrades.isUpgradeMagical(u)
			: null;

		const {total: count, breakdown} = CharacterSheetMaterials.countMagicalEffects(item, {material: mat, manualAdjust, isUpgradeMagical});
		const notes = [];
		for (const rule of mat.magicCapacityRules || []) {
			const spec = CharacterSheetMaterials.MC_RULE_TEXT[rule.type];
			if (!spec) continue;
			const text = rule.note || spec.fallback(mat, rule);
			notes.push(spec.applied ? `${text} ${spec.applied}` : text);
		}

		if (raw === "infinity") {
			return {
				capacity: Infinity,
				capacityDisplay: "\u221E",
				count,
				breakdown,
				overage: 0,
				isOverloaded: false,
				isUnlimited: true,
				isSuppressing: false,
				dc: null,
				dcRiseThreshold: 1,
				notes,
			};
		}
		if (raw === "-infinity") {
			return {
				capacity: -Infinity,
				capacityDisplay: "\u2212\u221E",
				count,
				breakdown,
				overage: 0,
				isOverloaded: false,
				isUnlimited: false,
				isSuppressing: true,
				dc: null,
				dcRiseThreshold: 1,
				notes,
			};
		}

		const capacity = Number(raw);
		const rawOverage = Math.max(0, count - capacity);
		// Steeline: two effects over are needed before the DC climbs by one.
		const threshold = mat.magicCapacityRules?.find(r => r.type === "dcRiseThreshold")?.value || 1;
		const dcSteps = Math.floor(rawOverage / threshold);

		return {
			capacity,
			capacityDisplay: String(capacity),
			count,
			breakdown,
			overage: rawOverage,
			isOverloaded: rawOverage > 0,
			isUnlimited: false,
			isSuppressing: false,
			dc: rawOverage > 0 ? CharacterSheetMaterials.INTERFERENCE_BASE_DC + dcSteps : null,
			dcRiseThreshold: threshold,
			notes,
		};
	}

	/**
	 * Roll against interference.
	 *
	 * "Roll a d20. If the result is LOWER than 15 + effects over capacity, roll on the
	 * Magical Interference table." — so the d20 must MEET the DC to pass, not beat it.
	 *
	 * @param {number} dc
	 * @param {function} [rollFn] Injectable for tests; takes a die size, returns 1..n.
	 */
	static rollMagicalInterference (dc, rollFn = null) {
		const roll = rollFn || (sides => Math.floor(Math.random() * sides) + 1);
		const d20 = roll(20);
		const passed = d20 >= dc;
		if (passed) return {d20, dc, passed: true, d8: null, effect: null};
		const d8 = roll(8);
		return {d20, dc, passed: false, d8, effect: CharacterSheetMaterials.MAGICAL_INTERFERENCE_TABLE[d8 - 1]};
	}

	/**
	 * Accessible name for the Magic Capacity badge.
	 *
	 * The visible tooltip says "Click…" because a tooltip only ever reaches a mouse.
	 * The accessible name has to serve a keyboard and a screen reader too, so it names
	 * the outcome rather than the input device, and spells "4/6" out as "4 of 6" —
	 * a slash is read as a literal slash by some screen readers and skipped by others.
	 *
	 * @param {object} material
	 * @param {object} status from `getMagicCapacityStatus`
	 * @returns {string}
	 */
	static getMagicCapacityAriaLabel (material, status) {
		if (!status) return "";
		const name = material?.name || "This material";
		if (status.isUnlimited) return `Magic Capacity: ${name} holds any number of enchantments, ${status.count} counted. Open details.`;
		if (status.isSuppressing) return `Magic Capacity: ${name} suppresses magic rather than storing it. Open details.`;
		if (status.isOverloaded) return `Magic Capacity ${status.count} of ${status.capacityDisplay}, overloaded by ${status.overage}. Interference DC ${status.dc}. Open details to roll.`;
		return `Magic Capacity ${status.count} of ${status.capacityDisplay}. Open details.`;
	}

	/** Display-ready notes for an item's material, for the item info modal. */
	static getMaterialNotes (item, material) {
		const mat = material || CharacterSheetMaterials.resolveMaterial(item);
		if (!mat) return [];
		const fx = CharacterSheetMaterials.getMaterialEffects(item, mat);
		const notes = [];
		const unusedAuthored = {...fx.effectNotes};
		const unusedQualifiers = {...fx.effectQualifiers};

		// An authored note is the book's own wording for that effect and always wins over the
		// sheet's generated summary; taking it here also marks it consumed so it is not emitted
		// a second time as a free-floating note below.
		const take = (bag, effectType) => {
			if (!(effectType in bag)) return null;
			const text = bag[effectType];
			delete bag[effectType];
			return Renderer.stripTags(text);
		};
		const push = (effectType, description, type, label) => {
			const base = take(unusedAuthored, effectType) || description;
			const qualifier = take(unusedQualifiers, effectType);
			notes.push({label: label || mat.name, description: qualifier ? `${base} \u2014 ${qualifier}` : base, type});
		};

		if (fx.countsAsMagical) push("countsAsMagical", "Counts as magical for overcoming resistance and immunity", "passive");
		if (fx.countsAsSilvered) push("countsAsSilvered", "Counts as silvered", "passive");
		if (fx.indestructible) push("indestructible", "Cannot be destroyed or worn down by ordinary means", "passive");
		if (fx.spellcastingFocus) push("spellcastingFocus", "Can be used as a spellcasting focus", "passive");
		if (fx.armorWearableUnderClothing) push("armorWearableUnderClothing", "Can be concealed beneath ordinary clothing", "passive");
		if (fx.noRangedDisadvantageInMelee) push("noRangedDisadvantageInMelee", "No disadvantage on ranged attacks while within 5 feet of a hostile creature", "passive");
		for (const dr of fx.damageReduction) {
			push("damageReduction", `Reduce incoming ${dr.damageTypes.join(", ")} damage by ${dr.value}`, "passive", `${mat.name} (${dr.armorType || "armor"})`);
		}
		for (const ex of fx.extraDamageDiceVsType) {
			push("extraDamageDiceVsType", `+${ex.dice} weapon damage die against ${ex.creatureType} creatures`, "passive");
		}
		if (fx.bonusCritDamage) {
			push("bonusCritDamage", `On a critical hit, +${fx.bonusCritDamage.dice} ${fx.bonusCritDamage.damageType || "weapon"} damage`, "reactive");
		}
		if (fx.perceptionPenaltyToNotice) {
			push("perceptionPenaltyToNotice", `Creatures take a ${fx.perceptionPenaltyToNotice} penalty to sight-based Perception checks to notice you`, "passive");
		}
		if (fx.draconicResonanceSlots) {
			// Once a resonance is chosen the slot note is redundant — show the resonance itself.
			const chosen = CharacterSheetMaterials.resolveResonance(item);
			if (chosen) {
				// Consume any authored slot prose without emitting the now-redundant slot line.
				take(unusedAuthored, "draconicResonanceSlot");
				take(unusedQualifiers, "draconicResonanceSlot");
				notes.push({
					label: `${chosen.domain} \u2014 ${chosen.name}`,
					description: Renderer.stripTags(chosen.entries?.[0] || ""),
					type: chosen.kind === "fear" ? "drawback" : "passive",
				});
			} else {
				push("draconicResonanceSlot", `May carry ${fx.draconicResonanceSlots} Draconic Domain Resonance from its source dragon`, "passive");
			}
		}
		// `grantsAction` carries its note inside the action itself, so it is never in `effectNotes`.
		for (const act of fx.grantedActions) notes.push({label: act.name, description: Renderer.stripTags(act.note || ""), type: "active"});
		if (fx.condensate?.affinity) {
			const dormant = fx.condensate.isActive === false;
			const roleLabel = String(CharacterSheetMaterials.ROLE_LABELS[fx.condensate.role] || fx.condensate.role).toLowerCase();
			// Two very different kinds of dormant. If this item kind *can* host the affinity's
			// role, the player only has to switch the material's role over. If it cannot — a
			// rootstone sword is authored for a protective layer a weapon does not have — then
			// "applies only while…" reads as a condition they could go and satisfy, and they
			// cannot. Say it is unreachable on this item rather than implying a path to it.
			const reachable = CharacterSheetMaterials.getAvailableRoles(item, mat).includes(fx.condensate.role);
			const kindLabel = {weapon: "a weapon", armor: "armor", shield: "a shield"}[CharacterSheetMaterials.getItemKind(item)] || "this item";
			const why = reachable
				? `Applies only while this material is the item's ${roleLabel} \u2014 switch its role to claim it.`
				: `Never applies on ${kindLabel}: it is written for the item's ${roleLabel}, which ${kindLabel} cannot have.`;
			notes.push({
				label: `${mat.name} \u2014 Affinity${dormant ? (reachable ? " (dormant)" : " (not available)") : ""}`,
				description: dormant
					? `${Renderer.stripTags(fx.condensate.affinity)} \u2014 ${why}`
					: Renderer.stripTags(fx.condensate.affinity),
				type: dormant ? "note" : "passive",
			});
		}
		if (fx.condensate?.instability) notes.push({label: `${mat.name} \u2014 Instability`, description: Renderer.stripTags(fx.condensate.instability), type: "drawback"});
		for (const note of fx.notes) notes.push({label: mat.name, description: Renderer.stripTags(note), type: "note"});
		// Effects the sheet applies silently (range multipliers, property grants, …) generate no
		// summary line of their own, so their authored prose is surfaced here instead of lost.
		for (const text of [...Object.values(unusedAuthored), ...Object.values(unusedQualifiers)]) notes.push({label: mat.name, description: Renderer.stripTags(text), type: "note"});

		return notes;
	}

	// ==========================================
	// UI
	// ==========================================

	/**
	 * The comparable numbers behind each sort option, projected onto this specific item.
	 *
	 * Axes are nulled when the item kind cannot express them, so a longsword reports no
	 * AC rather than the armour value the material would give a breastplate — the same
	 * item-awareness rule `getSummary` follows. Weight and value are nulled when the
	 * material cannot actually reweigh or reprice the item, because leaving the base
	 * number in would rank every priceless material as the cheapest option. Null sinks
	 * to the bottom of a sort instead of being filtered out: the material is still
	 * eligible, just not ranked on that axis.
	 *
	 * @param {object} item
	 * @param {object} material
	 * @returns {{dmg: ?number, ac: ?number, mc: ?number, weight: ?number, value: ?number}}
	 */
	static getSortMetrics (item, material) {
		const empty = {dmg: null, ac: null, mc: null, weight: null, value: null};
		if (!item || !material) return empty;

		const kind = CharacterSheetMaterials.getItemKind(item);
		const base = {...item};
		delete base.material;
		const after = CharacterSheetMaterials.applyToItem({...base, material: {name: material.name, source: material.source}}, material);
		const mc = CharacterSheetMaterials.getMagicCapacityStatus(item, material);

		const dieOf = (v) => {
			const m = /^\s*\d*d(\d+)/i.exec(String(v || ""));
			return m ? Number(m[1]) : null;
		};

		// A material that cannot reprice or reweigh the item leaves the base number in
		// place. Ranking on that would put every priceless material at the top of
		// "cheapest" — so report no value instead, and let it sink to the bottom.
		const price = material.price;
		const canReprice = !!price && !price.isPriceless && price.unit === "lb" && typeof price.gp === "number";
		const canReweigh = typeof material.density === "number";

		return {
			dmg: kind === "weapon" ? dieOf(after.dmg1) : null,
			ac: kind === "armor" ? (after.ac ?? null) : kind === "shield" ? (after.acBonus ?? null) : null,
			// Unlimited outranks every finite capacity and a suppressor sits below every
			// one, which is exactly the order a player ranks them in.
			mc: !mc ? null : mc.isUnlimited ? Infinity : mc.isSuppressing ? -Infinity : mc.capacity,
			weight: canReweigh ? (after.weight ?? null) : null,
			value: canReprice ? (after.value ?? null) : null,
		};
	}

	/**
	 * Sort options worth offering for this item.
	 *
	 * Only axes that can actually differ across the eligible list appear: offering
	 * "sort by Armor Class" on a longsword would produce 65 identical rows and teach
	 * the player the control is broken.
	 *
	 * @param {object} item
	 * @returns {Array<{key: string, label: string, isDesc?: boolean}>}
	 */
	static getSortOptions (item) {
		const kind = CharacterSheetMaterials.getItemKind(item);
		return [
			{key: "", label: "Category"},
			...(kind === "weapon" ? [{key: "dmg", label: "Damage", isDesc: true}] : []),
			...(kind === "armor" || kind === "shield" ? [{key: "ac", label: "Armor Class", isDesc: true}] : []),
			{key: "mc", label: "Magic Capacity", isDesc: true},
			{key: "weight", label: "Weight (lightest)"},
			{key: "value", label: "Value (cheapest)"},
		];
	}

	/**
	 * Before/after comparison rows for the picker preview. Only axes that actually
	 * change are returned, so an inert material shows an empty preview rather than a
	 * wall of unchanged numbers.
	 *
	 * @param {object} item
	 * @param {object|null} material
	 * @returns {Array<{label: string, from: string, to: string}>}
	 */
	static getPreviewRows (item, material) {
		if (!item) return [];
		// Compare against the BASE item, not the currently-materialled one, so swapping
		// materials shows the true net effect.
		const base = {...item};
		delete base.material;
		const after = material ? CharacterSheetMaterials.applyToItem({...base, material: {name: material.name, source: material.source}}, material) : base;

		const rows = [];
		const cmp = (label, a, b, fmt = v => (v == null ? "\u2014" : String(v))) => {
			if (String(a) === String(b)) return;
			rows.push({label, from: fmt(a), to: fmt(b)});
		};

		cmp("Damage", base.dmg1, after.dmg1);
		cmp("Damage (versatile)", base.dmg2, after.dmg2);
		cmp("Base AC", base.ac, after.ac);
		cmp("Shield bonus", base.acBonus, after.acBonus, v => (v == null ? "\u2014" : `+${v}`));
		cmp("Crit threshold", base.critThreshold || 20, after.critThreshold || 20);
		cmp("Penetration", base.penetration || 0, after.penetration || 0);
		cmp("Weight", base.weight, after.weight, v => (v == null ? "\u2014" : `${v} lb.`));
		cmp("Value", base.value, after.value, v => (v == null ? "\u2014" : `${(v / 100).toLocaleString()} gp`));
		cmp("Str. requirement", base.strength, after.strength);
		cmp("Max Dex bonus", base.dexterityMax, after.dexterityMax, v => (v === null ? "unlimited" : v === undefined ? "\u2014" : String(v)));
		cmp("Stealth", base.stealth, after.stealth, v => (v === true ? "Disadvantage" : v === false ? "No penalty" : "\u2014"));
		cmp("Armor type", base.armorType, after.armorType);

		const propsBefore = (base.property || []).map(x => String(x).split("|")[0]).join(", ");
		const propsAfter = (after.property || []).map(x => String(x).split("|")[0]).join(", ");
		cmp("Properties", propsBefore || "\u2014", propsAfter || "\u2014");

		return rows;
	}

	/** Escape a string for safe interpolation into an HTML template literal. */
	static _esc (str) {
		return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	/**
	 * The material picker. Lists every eligible material grouped by category, with a
	 * live before/after preview of the selected one.
	 *
	 * @param {string} itemId
	 */
	async showMaterialPickerModal (itemId) {
		// The BASE item, deliberately unprojected. Every preview in this modal is a
		// "what would this item become" diff, so it has to start from the item's own stats
		// rather than from whatever material happens to be on it right now — otherwise
		// re-opening the picker shows each material's effect stacked on the current one.
		const item = this._state.getItemRaw?.(itemId)
			|| this._state.getItems().find(i => i.id === itemId);
		if (!item) return;

		const eligible = this.getEligibleMaterials(item);
		const current = CharacterSheetMaterials.resolveMaterial(item, this.getMaterials());
		const esc = CharacterSheetMaterials._esc;

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Material: ${item.name}`,
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__material-modal"></div>`});

		// --- Currently applied ---
		const currentSection = e_({outer: `<div class="charsheet__material-current mb-3"></div>`});
		content.append(currentSection);
		// Assigned below once the list exists; the role selector needs them so that switching
		// roles updates the effect list the crafter is reading, and clearing the material
		// updates the "Applied" marker in the list without a full modal rebuild.
		let renderPreview = () => {};
		let refreshList = () => {};
		let filterIpt = null;
		const renderCurrent = () => {
			currentSection.innerHTML = "";
			const mat = CharacterSheetMaterials.resolveMaterial(
				this._state.getItems().find(i => i.id === itemId) || item,
				this.getMaterials(),
			);
			if (!mat) {
				currentSection.append(e_({outer: `<p class="ve-muted ve-small mb-0">This item is made of its default material.</p>`}));
				return;
			}
			currentSection.append(e_({outer: `
				<div class="ve-flex-v-center p-2 stripe-even">
					<div class="ve-flex-1">
						<strong>${esc(mat.name)}</strong>
						<span class="ve-muted ve-small ml-1">${esc(CharacterSheetMaterials.getSummary(mat, item))}</span>
						<button type="button" class="ve-btn ve-btn-xxs ve-btn-default ml-2 charsheet__material-clear" aria-label="Remove ${esc(mat.name)} and revert ${esc(item.name)} to its default material">Remove</button>
					</div>
				</div>
			`}));

			// A condensate's affinity applies in exactly one role, and only a weapon is genuinely
			// ambiguous about which role it is — so the selector appears only when there is a real
			// choice to make.
			const rawItem = this._state.getItemRaw?.(itemId) || item;
			const roles = CharacterSheetMaterials.getAvailableRoles(rawItem, mat);
			if (CharacterSheetMaterials.isRoleScoped(mat) && roles.length > 1) {
				const activeRole = CharacterSheetMaterials.getActiveRole(rawItem, mat);
				const affinityRole = CharacterSheetMaterials.getAffinityRole(mat);
				const sel = e_({outer: `
					<div class="charsheet__material-role-picker">
						<div class="ve-flex-v-center mt-2 px-2">
							<label class="ve-muted ve-small mb-0 mr-2" for="charsheet-material-role">This material forms the</label>
							<select id="charsheet-material-role" class="form-control input-xs w-auto charsheet__material-role">
								${roles.map(r => `<option value="${esc(r)}" ${r === activeRole ? "selected" : ""}>${esc(CharacterSheetMaterials.ROLE_LABELS[r] || r)}</option>`).join("")}
							</select>
						</div>
						${affinityRole && affinityRole !== activeRole
		? `<div class="ve-small ve-muted mt-1 px-2">Its affinity is dormant — it applies only as the ${esc(String(CharacterSheetMaterials.ROLE_LABELS[affinityRole] || affinityRole).toLowerCase())}.</div>`
		: ""}
					</div>
				`});
				sel.querySelector(".charsheet__material-role")?.addEventListener("change", (evt) => {
					this._state.setMaterialRole(itemId, evt.target.value);
					this._page.saveCharacter?.();
					this._page.renderCharacter?.();
					renderCurrent();
					renderPreview();
				});
				currentSection.append(sel);
			}

			// Items made of solid dragon remains may carry one Draconic Domain Resonance from
			// their source dragon — a second, independent choice on top of the material.
			const slots = CharacterSheetMaterials.getMaterialEffects(rawItem, mat)?.draconicResonanceSlots || 0;
			const resonances = this.getResonances();
			if (slots > 0 && resonances.length) {
				const cur = rawItem.material?.resonance || null;
				const byKind = {fear: [], safety: []};
				for (const r of resonances) (byKind[r.kind] || (byKind[r.kind] = [])).push(r);
				const optGroup = (kind, label) => (byKind[kind]?.length
					? `<optgroup label="${esc(label)}">${byKind[kind].map(r => `<option value="${esc(r.name)}" ${cur?.name === r.name ? "selected" : ""}>${esc(r.domain)} \u2014 ${esc(r.name)}</option>`).join("")}</optgroup>`
					: "");
				const active = cur ? resonances.find(r => r.name === cur.name) : null;
				const res = e_({outer: `
					<div class="charsheet__material-resonance-picker">
						<div class="ve-flex-v-center mt-2 px-2">
							<label class="ve-muted ve-small mb-0 mr-2" for="charsheet-material-resonance">Domain resonance</label>
							<select id="charsheet-material-resonance" class="form-control input-xs w-auto charsheet__material-resonance">
								<option value="" ${cur ? "" : "selected"}>None</option>
								${optGroup("fear", "Fear")}
								${optGroup("safety", "Safety")}
							</select>
						</div>
						${active
		? `<div class="ve-small mt-1 px-2"><strong>${esc(active.name)}.</strong> ${esc(Renderer.stripTags(active.entries?.[0] || ""))}</div>`
		: `<div class="ve-small ve-muted mt-1 px-2">This item may carry one resonance from its source dragon's domain.</div>`}
					</div>
				`});
				res.querySelector(".charsheet__material-resonance")?.addEventListener("change", (evt) => {
					const picked = resonances.find(r => r.name === evt.target.value);
					this._state.setDraconicResonance(itemId, picked ? {name: picked.name, source: picked.source} : null);
					this._page.saveCharacter?.();
					this._page.renderCharacter?.();
					renderCurrent();
					renderPreview();
				});
				currentSection.append(res);
			}
		};
		renderCurrent();

		if (!eligible.length) {
			// "Nothing fits this item" and "the catalog never arrived" look identical from
			// here, and blaming the item for a data-loading failure sends the player off to
			// re-read the rules for an answer that is not there.
			content.append(this.getMaterials().length
				? e_({outer: `<p class="ve-muted">No material in the catalog can be applied to this kind of item.</p>`})
				: e_({outer: `<p class="ve-muted">The material catalog has not loaded. It ships with the <i>Traveler's Guide to Thelemar</i> homebrew \u2014 if that is still loading, close this and try again in a moment.</p>`}));
		} else {
			// One interaction model for mouse, keyboard and touch: every material is a
			// disclosure button, and its before/after diff opens *underneath the row the
			// player just activated*. The previous design painted the diff into a pane
			// pinned to the top of the modal and drove it from `mouseover`, which meant
			// the feedback rendered off-screen on a long list and did not exist at all on
			// a phone. Feedback belongs where the decision is being made.
			const keyOf = (m) => `${m.name}|${m.source}`;
			let currentKey = current ? keyOf(current) : null;
			let selectedIdx = null;

			// Built once on open: what the filter box searches. Name and category are the
			// obvious handles, but a player usually arrives wanting an *effect* — "silvered",
			// "resistance", "shatter" — without knowing which metal supplies it.
			const searchText = eligible.map((mat) => {
				const notes = CharacterSheetMaterials.getMaterialNotes({...item, material: {name: mat.name, source: mat.source}}, mat) || [];
				return [
					mat.name,
					CharacterSheetMaterials.CATEGORY_LABELS[mat.materialCategory] || mat.materialCategory || "",
					CharacterSheetMaterials.getSummary(mat, item),
					...notes.map(n => `${n.label} ${n.description}`),
				].join(" ").toLowerCase();
			});

			// Built once on open: the numbers a player sorts by.
			const metrics = eligible.map(mat => CharacterSheetMaterials.getSortMetrics(item, mat));
			const SORTS = CharacterSheetMaterials.getSortOptions(item);
			let sortKey = "";

			const filterBar = e_({outer: `
				<div class="charsheet__material-filter">
					<input type="search" class="form-control input-sm charsheet__material-filter-ipt" placeholder="Filter ${eligible.length} materials\u2026" aria-label="Filter materials by name or effect" autocomplete="off">
					<select class="form-control input-sm w-auto charsheet__material-sort" aria-label="Sort materials">
						${SORTS.map(s => `<option value="${s.key}">${s.key ? `Sort: ${esc(s.label)}` : "Group by category"}</option>`).join("")}
					</select>
					<span class="ve-small ve-muted charsheet__material-filter-count" role="status"></span>
				</div>
			`});
			filterIpt = filterBar.querySelector(".charsheet__material-filter-ipt");
			const sortSel = filterBar.querySelector(".charsheet__material-sort");
			const filterCount = filterBar.querySelector(".charsheet__material-filter-count");
			const list = e_({outer: `<div class="charsheet__material-list"></div>`});

			// The expanded row: the whole reason the modal exists. Deliberately does *not*
			// repeat the material name — the row directly above it already says it.
			const buildDetail = (idx) => {
				const mat = eligible[idx];
				const rows = CharacterSheetMaterials.getPreviewRows(item, mat);
				// Preview the material as it would actually sit on this item — including the
				// chosen role, so a dormant condensate affinity reads as dormant here too.
				const live = this._state.getItemRaw?.(itemId) || item;
				const isApplied = live.material?.name === mat.name && live.material?.source === mat.source;
				const previewItem = {...item, material: {name: mat.name, source: mat.source, ...(isApplied && live.material.role ? {role: live.material.role} : {})}};
				const notes = CharacterSheetMaterials.getMaterialNotes(previewItem, mat);
				// The crafter's decision point: what this item would count as against the
				// candidate material's capacity, before committing the materials.
				const mc = CharacterSheetMaterials.getMagicCapacityStatus(item, mat);
				const mcHtml = mc
					? `<div class="ve-small mt-1 ${mc.isOverloaded ? "text-danger" : "ve-muted"}">
							<strong>Magic Capacity:</strong>
							${mc.isUnlimited ? `${mc.count} effects, unlimited capacity`
		: mc.isSuppressing ? `suppresses magic (${mc.count} effects present)`
			: `${mc.count} / ${esc(mc.capacityDisplay)}${mc.isOverloaded ? ` \u2014 overloaded by ${mc.overage}, interference DC ${mc.dc}` : ""}`}
						</div>
						${mc.notes.map(n => `<div class="ve-small ve-muted mt-1">${esc(n)}</div>`).join("")}`
					: "";
				// The risk leads the panel. A player who is about to spend materials on a
				// glass sword needs to meet "this shatters" before the damage numbers that
				// made it tempting, not after them.
				const risk = CharacterSheetMaterials.getRiskFlag(mat);
				const riskHtml = risk
					? `<p class="charsheet__material-risk charsheet__material-risk--${risk.tier} ve-small mb-1">
							<span aria-hidden="true">\u26A0</span>
							<strong>${esc(risk.label)} ${esc(risk.trigger)}.</strong>
							${risk.note ? ` ${esc(risk.note)}` : ""}
							${risk.repair ? ` ${esc(risk.repair)}` : " This cannot be undone."}
						</p>`
					: "";
				return e_({outer: `
					<div class="charsheet__material-detail">
						${riskHtml}
						${rows.length
		? `<table class="w-100 ve-small charsheet__material-preview-table"><tbody>${rows.map(r => `<tr><td class="ve-muted">${esc(r.label)}</td><td class="ve-text-right">${esc(r.from)}</td><td class="ve-text-center ve-muted px-1">&rarr;</td><td class="ve-text-right"><strong>${esc(r.to)}</strong></td></tr>`).join("")}</tbody></table>`
		: `<div class="ve-muted ve-small">No numeric changes to this item.</div>`}
						${notes.length ? `<ul class="ve-small mt-1 mb-0">${notes.map(n => `<li><strong>${esc(n.label)}.</strong> ${esc(n.description)}</li>`).join("")}</ul>` : ""}
						${mcHtml}
						<div class="charsheet__material-detail-actions">
							${isApplied
		// A disabled "Applied" button here would just repeat the pill on the row
		// above it. The slot is better spent on the action a player who has
		// already applied this material actually wants, and it puts Remove in
		// context instead of only under the modal's close button.
		? `<button type="button" class="ve-btn ve-btn-xs ve-btn-default charsheet__material-clear" aria-label="Remove ${esc(mat.name)} from ${esc(item.name)}">Remove material</button>`
		: `<button type="button" class="ve-btn ve-btn-xs ve-btn-primary charsheet__material-apply" data-material-idx="${idx}" aria-label="Apply ${esc(mat.name)}">Apply</button>`}
						</div>
					</div>
				`});
			};

			const doCollapse = () => {
				list.querySelectorAll(".charsheet__material-detail").forEach(ele => ele.remove());
				list.querySelectorAll(`.charsheet__material-option-btn[aria-expanded="true"]`)
					.forEach(ele => ele.setAttribute("aria-expanded", "false"));
			};

			const doExpand = (idx, {isScroll = false} = {}) => {
				doCollapse();
				selectedIdx = idx;
				if (idx == null) return;
				const opt = list.querySelector(`.charsheet__material-option[data-material-idx="${idx}"]`);
				if (!opt) return;
				opt.querySelector(".charsheet__material-option-btn")?.setAttribute("aria-expanded", "true");
				opt.append(buildDetail(idx));
				if (isScroll) opt.scrollIntoView({block: "nearest"});
			};

			// Re-opens whatever is currently expanded, so a role or resonance change is
			// reflected in the diff the player is looking at.
			renderPreview = () => {
				if (selectedIdx != null) doExpand(selectedIdx);
			};

			const renderRow = (parent, i) => {
				const mat = eligible[i];
				const isCurrent = keyOf(mat) === currentKey;
				const risk = CharacterSheetMaterials.getRiskFlag(mat);
				parent.append(e_({outer: `
					<div class="charsheet__material-option${isCurrent ? " charsheet__material-option--current" : ""}" data-material-idx="${i}">
						<button type="button" class="charsheet__material-option-btn" aria-expanded="false">
							<span class="charsheet__material-option-chevron" aria-hidden="true"></span>
							<span class="charsheet__material-option-name">${esc(mat.name)}</span>
							<span class="charsheet__material-option-summary ve-muted ve-small">${esc(CharacterSheetMaterials.getSummary(mat, item))}</span>
							${risk ? `<span class="charsheet__material-option-risk charsheet__material-option-risk--${risk.tier} ve-small"><span aria-hidden="true">\u26A0</span> ${esc(risk.label)}</span>` : ""}
							${isCurrent ? `<span class="charsheet__material-option-applied ve-small">Applied</span>` : ""}
						</button>
					</div>
				`}));
			};

			const renderList = () => {
				const q = (filterIpt.value || "").trim().toLowerCase();
				list.innerHTML = "";
				const idxs = eligible.map((_, i) => i).filter(i => !q || searchText[i].includes(q));
				filterCount.textContent = q ? `${idxs.length} of ${eligible.length}` : "";

				if (!idxs.length) {
					list.append(e_({outer: `<p class="ve-muted ve-small mb-0 p-2">No material matches \u201c${esc(filterIpt.value.trim())}\u201d.</p>`}));
					return;
				}

				// Sorting and grouping answer different questions and fight each other: a
				// "best damage" ranking split across eight collapsed headers ranks nothing.
				// An explicit sort therefore flattens the list, exactly as a filter does.
				const sort = SORTS.find(s => s.key === sortKey);
				if (sortKey && sort) {
					const val = i => metrics[i][sortKey];
					// Materials that do not carry the sorted axis sink to the bottom rather
					// than being hidden — they are still eligible, just not ranked.
					idxs.sort((a, b) => {
						const va = val(a); const vb = val(b);
						if (va == null && vb == null) return eligible[a].name.localeCompare(eligible[b].name);
						if (va == null) return 1;
						if (vb == null) return -1;
						if (va === vb) return eligible[a].name.localeCompare(eligible[b].name);
						return sort.isDesc ? vb - va : va - vb;
					});
					idxs.forEach(i => renderRow(list, i));
				} else if (q) {
					// A filtered result set is already short; re-grouping it would bury three
					// matches under eight collapsed headers.
					idxs.forEach(i => renderRow(list, i));
				} else {
					const byCategory = new Map();
					for (const i of idxs) {
						const cat = eligible[i].materialCategory || "other";
						if (!byCategory.has(cat)) byCategory.set(cat, []);
						byCategory.get(cat).push(i);
					}
					// The group holding the applied material leads — it is the one the player
					// is comparing against, and it should not sit below seven collapsed others.
					const cats = [...byCategory.keys()]
						.sort((a, b) => Number(b === current?.materialCategory) - Number(a === current?.materialCategory));
					for (const cat of cats) {
						const label = CharacterSheetMaterials.CATEGORY_LABELS[cat] || cat;
						// Always open one group. Landing on eight collapsed headers gives the
						// player nothing to react to and no idea what a material even looks
						// like; the leading group is the cheapest possible worked example.
						const isOpen = current ? current.materialCategory === cat : cat === cats[0];
						const section = e_({outer: `<details class="charsheet__material-group" ${isOpen ? "open" : ""}><summary><strong>${esc(label)}</strong> <span class="ve-muted ve-small">(${byCategory.get(cat).length})</span></summary></details>`});
						byCategory.get(cat).forEach(i => renderRow(section, i));
						list.append(section);
					}
				}

				// Keep the open diff open across a re-render; if the filter hid it, leave the
				// selection intact so clearing the filter brings it back.
				if (selectedIdx != null && idxs.includes(selectedIdx)) doExpand(selectedIdx);
			};

			refreshList = () => {
				const live = this._state.getItemRaw?.(itemId) || item;
				currentKey = live.material ? `${live.material.name}|${live.material.source}` : null;
				renderList();
			};

			list.addEventListener("click", (evt) => {
				const btn = evt.target.closest(".charsheet__material-option-btn");
				if (!btn) return;
				const idx = Number(btn.closest(".charsheet__material-option").dataset.materialIdx);
				if (selectedIdx === idx) {
					doCollapse();
					selectedIdx = null;
					return;
				}
				doExpand(idx, {isScroll: true});
			});

			sortSel.addEventListener("change", () => { sortKey = sortSel.value; renderList(); });
			filterIpt.addEventListener("input", () => renderList());			filterIpt.addEventListener("keydown", (evt) => {
				// Escape clears the filter before it closes the modal — the reflex every
				// other search box in the app already honours.
				if (evt.key !== "Escape" || !filterIpt.value) return;
				evt.stopPropagation();
				filterIpt.value = "";
				renderList();
			});

			content.append(filterBar);
			content.append(list);

			// Open on the applied material's diff, so the modal answers "what am I on now?"
			// before the player has to ask it.
			if (currentKey) selectedIdx = eligible.findIndex(m => keyOf(m) === currentKey);
			if (selectedIdx < 0) selectedIdx = null;
			renderList();
		}

		modalInner.append(content);

		// The rules doc is 678 lines; the picker is where people meet the vocabulary. A
		// disclosure keeps the definitions one keystroke away without spending list space
		// on players who already know them.
		modalInner.append(e_({outer: `
			<details class="charsheet__material-glossary mt-2">
				<summary class="ve-small">What do these numbers mean?</summary>
				<dl class="charsheet__material-glossary-list ve-small mb-0">
					<dt>MC</dt><dd>Magic Capacity \u2014 how many magical effects the material carries before the item is overloaded. Steel holds 3; an overloaded item stops working until you remove effects.</dd>
					<dt>MC \u221e</dt><dd>Unlimited \u2014 this material never overloads.</dd>
					<dt>MC \u2212\u221e</dt><dd>Suppressing \u2014 this material smothers magic entirely, so no enchantment functions while the item is made of it.</dd>
					<dt>\u2726</dt><dd>The material carries a magical property of its own.</dd>
					<dt>Pen</dt><dd>Penetration \u2014 ignores that much of a target's non-magical damage resistance.</dd>
					<dt>Crit</dt><dd>The die roll on which an attack becomes a critical hit. Lower is better.</dd>
					<dt>Roles</dt><dd>A condensate grants its affinity in one role only: a weapon's <b>striking surface</b> or its <b>focus</b>, or armour's <b>protective layer</b>. An affinity written for a role this item cannot host stays dormant.</dd>
				</dl>
			</details>
		`}));

		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(footer);
		footer.querySelector("button").addEventListener("click", () => doClose(false));

		content.addEventListener("click", (evt) => {
			const applyBtn = evt.target.closest(".charsheet__material-apply");
			if (applyBtn) {
				const mat = eligible[Number(applyBtn.dataset.materialIdx)];
				if (!mat) return;
				const prior = this._state.getItemRaw?.(itemId)?.material || null;
				this._state.setItemMaterial(itemId, mat);
				this._page.saveCharacter?.();
				this._page.renderCharacter?.();
				doClose(true);
				this._offerMaterialUndo(itemId, prior, `${mat.name} applied.`);
				return;
			}

			if (evt.target.closest(".charsheet__material-clear")) {
				const prior = this._state.getItemRaw?.(itemId)?.material || null;
				this._state.clearItemMaterial(itemId);
				this._page.saveCharacter?.();
				this._page.renderCharacter?.();
				renderCurrent();
				// The list carries the "Applied" marker, so it has to hear about this too.
				refreshList();
				this._offerMaterialUndo(itemId, prior, `${prior?.name || "Material"} removed.`);
			}
		});

		// The modal's own focus trap restores focus on close but deliberately leaves
		// focus-*in* to each caller. Landing on the filter means a keyboard user starts
		// where the work is instead of at the top of the page.
		filterIpt?.focus();
	}

	/**
	 * Offer to put back what a material change replaced.
	 *
	 * Applying a material is reversible, so a confirm dialog would be the wrong trade —
	 * it taxes all 72 choices to protect against a mistake in one of them, and the
	 * player has to answer it before they can see whether they were right. Undo taxes
	 * nothing and arrives after the result is visible on the sheet.
	 *
	 * `prior` is the raw `{name, source, ...}` reference or `null` for "was bare", so
	 * reverting restores the *absence* of a material as faithfully as a previous one.
	 *
	 * @param {string} itemId
	 * @param {?object} prior the material reference being replaced
	 * @param {string} label what just happened, for the toast line
	 */
	_offerMaterialUndo (itemId, prior, label) {
		if (typeof JqueryUtil === "undefined" || !JqueryUtil?.doToast) return;
		const esc = CharacterSheetMaterials._esc;
		const back = prior?.name ? esc(prior.name) : "no material";

		const content = e_({outer: `
			<div class="ve-flex-v-center">
				<span class="ve-flex-1">${esc(label)}</span>
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-default charsheet__material-undo">Revert to ${back}</button>
			</div>
		`});

		content.addEventListener("click", (evt) => {
			if (!evt.target.closest(".charsheet__material-undo")) return;
			if (prior?.name) this._state.setItemMaterial(itemId, prior);
			else this._state.clearItemMaterial(itemId);
			this._page.saveCharacter?.();
			this._page.renderCharacter?.();
			// The host toast dismisses itself on any click inside it, so there is no
			// element left to swap into a "Reverted" state — say it in a fresh toast
			// instead, or the revert lands with no acknowledgement at all.
			JqueryUtil.doToast({type: "success", content: `Reverted to ${back}.`, autoHideTime: 4000});
		});

		JqueryUtil.doToast({type: "info", content, autoHideTime: 12000});
	}

	/**
	 * Magic Capacity: what the item is counted as carrying, against what its material
	 * can hold, plus the interference roll when it is over.
	 *
	 * @param {string} itemId
	 */
	async showMagicCapacityModal (itemId) {
		const item = this._state.getItems().find(i => i.id === itemId);
		if (!item) return;
		const status = this._state.getMagicCapacityStatus?.(itemId);
		if (!status) return;

		const esc = CharacterSheetMaterials._esc;
		const mat = this._state.getItemMaterialEntity?.(item);

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Magic Capacity: ${item.name}`,
			isMinHeight0: true,
		});

		const content = e_({outer: `<div class="charsheet__mc-modal"></div>`});
		modalInner.append(content);

		const rollLog = e_({outer: `<div class="charsheet__mc-log"></div>`});

		const render = () => {
			const st = this._state.getMagicCapacityStatus(itemId);
			content.innerHTML = "";

			const state = st.isSuppressing ? "suppressing" : st.isOverloaded ? "overloaded" : "ok";
			const headline = st.isUnlimited
				? `${st.count} effect${st.count === 1 ? "" : "s"} \u2014 ${esc(mat?.name || "this material")} never overloads`
				: st.isSuppressing
					? `${esc(mat?.name || "This material")} suppresses magic rather than storing it`
					: `${st.count} / ${st.capacityDisplay} effects`;

			content.append(e_({outer: `
				<div class="charsheet__mc-headline charsheet__mc-headline--${state} mb-3">
					<div class="charsheet__mc-headline-value">${esc(headline)}</div>
					${st.isOverloaded ? `<div class="charsheet__mc-headline-sub">Overloaded by ${st.overage} \u2014 interference DC ${st.dc}</div>` : ""}
				</div>
			`}));

			// --- Counted effects ---
			const rows = st.breakdown.length
				? st.breakdown.map(b => `
					<div class="ve-flex-v-center py-1 stripe-even">
						<div class="ve-flex-1">
							${esc(b.label)}
							${b.detail ? `<div class="ve-muted ve-small">${esc(b.detail)}</div>` : ""}
						</div>
						<div class="charsheet__mc-count">${b.count > 0 ? "+" : ""}${b.count}</div>
					</div>
				`).join("")
				: `<p class="ve-muted ve-small mb-0">No magical effects counted on this item.</p>`;

			content.append(e_({outer: `
				<div class="mb-3">
					<div class="charsheet__section-subtitle mb-1">Counted effects</div>
					${rows}
				</div>
			`}));

			// The counting rule is a house interpretation, so say so and give a way out.
			content.append(e_({outer: `
				<div class="mb-3">
					<div class="charsheet__section-subtitle mb-1">Manual adjustment</div>
					<p class="ve-muted ve-small">The rules do not enumerate what counts as one distinct magical effect. Override the tally here if your table counts differently.</p>
					<div class="ve-flex-v-center">
						<button type="button" class="ve-btn ve-btn-xs ve-btn-default charsheet__mc-adjust" data-delta="-1">\u2212</button>
						<span class="charsheet__mc-adjust-value mx-2">${st.breakdown.find(b => b.label === "Manual adjustment")?.count || 0}</span>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-default charsheet__mc-adjust" data-delta="1">+</button>
					</div>
				</div>
			`}));

			if (st.notes.length) {
				content.append(e_({outer: `
					<div class="mb-3">
						<div class="charsheet__section-subtitle mb-1">${esc(mat?.name || "Material")} rules</div>
						${st.notes.map(n => `<p class="ve-muted ve-small mb-1">${esc(n)}</p>`).join("")}
					</div>
				`}));
			}

			if (st.isOverloaded) {
				content.append(e_({outer: `
					<div class="mb-2">
						<p class="ve-muted ve-small">Roll whenever a magical property is activated, or the item is used for an attack, save, or check. Passive effects are checked when the item is brought into use and after each rest while it remains overloaded.</p>
						<button type="button" class="ve-btn ve-btn-default charsheet__mc-roll">\uD83C\uDFB2 Roll Interference (DC ${st.dc})</button>
					</div>
				`}));
			}

			content.append(rollLog);
		};

		render();

		content.addEventListener("click", (evt) => {
			const adjBtn = evt.target.closest(".charsheet__mc-adjust");
			if (adjBtn) {
				const cur = this._state.getMagicCapacityAdjust(itemId);
				this._state.setMagicCapacityAdjust(itemId, cur + Number(adjBtn.dataset.delta));
				this._page.saveCharacter?.();
				this._page.renderCharacter?.();
				render();
				return;
			}

			if (evt.target.closest(".charsheet__mc-roll")) {
				const st = this._state.getMagicCapacityStatus(itemId);
				const res = CharacterSheetMaterials.rollMagicalInterference(st.dc);
				rollLog.innerHTML = res.passed
					? `<div class="charsheet__mc-result charsheet__mc-result--pass">
							<strong>d20: ${res.d20}</strong> vs DC ${res.dc} \u2014 no interference.
						</div>`
					: `<div class="charsheet__mc-result charsheet__mc-result--fail">
							<strong>d20: ${res.d20}</strong> vs DC ${res.dc} \u2014 interference!
							<div class="mt-1"><strong>${res.d8}. ${CharacterSheetMaterials._esc(res.effect.name)}</strong></div>
							<div class="ve-small">${Renderer.get().render(res.effect.entry)}</div>
						</div>`;
			}
		});

		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(footer);
		footer.querySelector("button").addEventListener("click", () => doClose(false));
	}

	/**
	 * Prompt the interference re-check the rules require after a rest.
	 *
	 * Overloaded items are re-checked "when first put on or otherwise brought into use,
	 * and again after each Short or Long Rest while it remains overloaded". A rest is the
	 * only one of those the sheet can actually observe, so it is the only one it offers.
	 *
	 * @param {string} restKind "short" | "long"
	 */
	notifyOverloadedItemsOnRest (restKind) {
		const overloaded = this._state.getOverloadedMaterialItems?.() || [];
		if (!overloaded.length) return;

		const esc = CharacterSheetMaterials._esc;
		const list = overloaded.map(o => `
			<li class="ve-flex-v-center">
				<span class="ve-flex-1">${esc(o.name)} <span class="ve-muted">(${o.status.count}/${o.status.capacityDisplay}, DC ${o.status.dc})</span></span>
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-default charsheet__mc-rest-roll" data-item-id="${esc(o.id)}">Roll</button>
			</li>
		`).join("");

		const content = e_({outer: `
			<div>
				<div class="mb-1">Magical interference re-check after your ${restKind} rest:</div>
				<ul class="pl-3 mb-0">${list}</ul>
			</div>
		`});

		content.addEventListener("click", (evt) => {
			const btn = evt.target.closest(".charsheet__mc-rest-roll");
			if (!btn) return;
			const status = this._state.getMagicCapacityStatus(btn.dataset.itemId);
			if (!status?.isOverloaded) return;
			const res = CharacterSheetMaterials.rollMagicalInterference(status.dc);
			btn.outerHTML = res.passed
				? `<span class="text-success ve-small">d20 ${res.d20} \u2014 clear</span>`
				: `<span class="text-danger ve-small">d20 ${res.d20} \u2014 ${esc(res.effect.name)}</span>`;
		});

		JqueryUtil.doToast({type: "warning", content, autoHideTime: 20000});
	}

	/**
	 * Offer to repair every degraded item whose material is mended over a Short Rest
	 * (Obsidian re-knapped, Duststone rebuilt with mason's tools, Rimeglass reworked
	 * with smith's or glassblower's tools).
	 *
	 * Offered rather than applied, because each of those repairs requires tools the
	 * character may not be carrying.
	 */
	offerShortRestRepairs () {
		const repairable = this._state.getShortRestRepairableItems?.() || [];
		if (!repairable.length) return;

		const esc = CharacterSheetMaterials._esc;
		const list = repairable.map(r => `
			<li class="ve-flex-v-center">
				<span class="ve-flex-1">${esc(r.name)} <span class="ve-muted">(${esc(CharacterSheetMaterials.getDegradationSummary(this._state.getItemRaw(r.id)) || "degraded")}${r.tool ? `, needs ${esc(r.tool)}` : ""})</span></span>
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-default charsheet__material-rest-repair" data-item-id="${esc(r.id)}">Repair</button>
			</li>
		`).join("");

		const content = e_({outer: `
			<div>
				<div class="mb-1">Materials you can repair over this short rest:</div>
				<ul class="pl-3 mb-0">${list}</ul>
			</div>
		`});

		content.addEventListener("click", (evt) => {
			const btn = evt.target.closest(".charsheet__material-rest-repair");
			if (!btn) return;
			if (!this._state.repairItemMaterial(btn.dataset.itemId)) return;
			btn.outerHTML = `<span class="text-success ve-small">Repaired</span>`;
			this._page.renderCharacter?.();
		});

		JqueryUtil.doToast({type: "info", content, autoHideTime: 20000});
	}

	/**
	 * The degradation badge for an inventory row / item modal, or "".
	 * @param {string} itemId
	 * @returns {string} HTML
	 */
	getDegradationBadgeHtml (itemId) {
		const status = this._state.getItemDegradation?.(itemId);
		if (!status) return "";
		const esc = CharacterSheetMaterials._esc;
		const summary = CharacterSheetMaterials.getDegradationSummary(this._state.getItemRaw(itemId));
		const repairHint = status.isDestroyed
			? "It cannot be repaired."
			: status.repair?.method === "shortRest"
				? `Repaired over a Short Rest${status.repair.tool ? ` with ${status.repair.tool}` : ""}.`
				: "Repaired manually.";
		const tip = esc(`${status.note ? `${status.note} ` : ""}${repairHint}`).replace(/"/g, "&quot;");
		const stacks = status.stacks > 1 && !status.isDestroyed ? ` \u00D7${status.stacks}` : "";
		const state = status.isDestroyed ? "Destroyed" : "Damaged";
		return `<span class="ve-small charsheet__item-degradation-badge charsheet__item-degradation-badge--${status.isDestroyed ? "destroyed" : "worn"}" title="${tip}"><span aria-hidden="true">\u26A0</span> <span class="sr-only">${state}:</span>${esc(summary)}${stacks}<span class="sr-only"> \u2014 ${tip}</span></span>`;
	}
}

globalThis.CharacterSheetMaterials = CharacterSheetMaterials;
export {CharacterSheetMaterials};
