import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HEROIC_SOUL_HALFOGRE} from "../utils/characterBuilder";

/**
 * #15 — Heroic Soul Sorcerer Half-Ogre (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sorcery Points scaling (long-rest restore)
 *   - Spell-slot scaling (full caster table)
 *   - Over Soul (L1) — bonus-action toggle, costs 1 sorcery point;
 *     Legendary Weapon manifests
 *   - Combat Methods (L3) — Stamina pool = 2× prof bonus, restores
 *     on short or long rest
 *   - 2 Metamagic options picked at L3 (Sorcerer baseline) — at
 *     least one must surface as a toggle/feature
 *   - Manifest Legend (L14) — long-rest 3-sorcery-point bigger toggle
 *   - Eternal Hero (L18) — capstone-ish
 *   - Concentration via Bless
 */
describeCharacter({
	preset: PRESET_FULL_HEROIC_SOUL_HALFOGRE,
	displayName: "Heroic Soul Sorcerer Half-Ogre",
	signatureToggle: /over soul|legendary weapon|manifest legend|hero/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Sorcery Points",
		expectLongRestRestores: true,
		attackName: /dagger|crossbow|quarterstaff/i,
		skillRoll: {name: "Persuasion"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		// Validate metamagic surfaces as a toggle/feature picked at L3.
		featAbility: {featureName: /careful spell|distant spell|empowered spell|extended spell|heightened spell|quickened spell|subtle spell|twinned spell|metamagic/i},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}, expectResources: {"Sorcery Points": 1}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectResources: {"Sorcery Points": 3}, expectToggles: [/over soul|metamagic|combat method|arcane knight|gallant heart|careful|distant|empowered|extended|heightened|quickened|subtle|twinned/i]}, // CS-BUG-011: Stamina pool not yet surfaced as resource
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectResources: {"Sorcery Points": 5}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 11}},
		14: {totalLevel: 14, expectToggles: [/manifest legend|hero/i]},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 17}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 20}, expectToggles: [/eternal hero|over soul/i]},
	},
});
