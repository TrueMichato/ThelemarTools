/**
 * NPC batch — per-batch character data for scripts/spawn-npcs.mjs.
 *
 * Copy this file, rename the keys, and fill in your NPCs. Run with:
 *   node <skill>/scripts/spawn-npcs.mjs --batch <this-file> --repo <repo-root>
 *
 * Two exports:
 *   SPECS    — the character build for each NPC (class/subclass, abilities, all
 *              the wizard "choices", feats, and optional graft/favor/spells).
 *   LOADOUTS — the magic items each NPC carries (optional; key may be omitted).
 *
 * Field reference: ../references/spec-format.md  (the spec DSL, all buckets)
 *                  ../references/choice-buckets.md (which bucket each prompt reads
 *                    + how to make warnings go away by choosing correctly)
 *                  ../references/magic-items.md   (loadout format, attunement)
 *                  ../references/strong-builds.md (making the picks strong)
 *
 * The example below (Reggu, a L13 TGTT Sun Soul monk) is real and spawns clean
 * (0 warnings). Keep it as a reference or delete it.
 */

// Loadout candidate helper: the first candidate that resolves in the catalog is
// used, so list the preferred printing first (homebrew/TGTT, then XDMG, then DMG).
const P = (name, source) => ({name, source});

export const SPECS = {
	Reggu: {
		name: "Reggu",
		race: "Tengu", // race name as it appears in the sheet's race list
		// subrace: "…",               // only if the race has subraces
		background: "Hermit",
		// One leg per class. `subclass`/`subclassSource` use the sheet's names;
		// multiclass = list several legs, each with its own level.
		classes: [{name: "Monk", source: "TGTT", subclass: "Way of the Sun Soul", subclassSource: "TGTT", level: 13}],
		// BASE ability scores (pre-racial). Racial/ASI bonuses are applied by the
		// engine + the "+2:"/"+1:" choices below. DEX 18 (+2 → 20); WIS 16 (+1 → 17).
		abilities: {str: 10, dex: 18, con: 14, int: 10, wis: 16, cha: 8},
		choices: {
			// `options` is the generic bucket: key = the exact section label the sheet
			// shows, value = the names to pick (in priority order). See choice-buckets.md.
			options: {
				"+2:": ["Dexterity"],
				"+1:": ["Wisdom"],
				"Skills:": ["Acrobatics", "Insight"],
				// List EXACTLY the number of names the slot count wants (e.g. "0/8" = 8),
				// and only names actually in that pool — extra/absent names emit a
				// "never matched an available option" warning. See choice-buckets.md.
				"Combat Methods 0/8": ["Instant Strike", "Preternatural Strikes", "Wind Strike", "Deflect Strike", "Expert Sidestep", "Wounding Strike", "Disarming Assault", "Unsettling Injury"],
				// Per-level single-pick prompts: one name each (already-taken picks drop
				// from later pools). Key names vary by level; read them off the picklog.
				"Monk Level 2 — Specialties": ["Adept Speed"],
				"qb-featopt-Monk_4_Specialties": ["Wall Walk"],
				"Monk Level 6 — Specialties": ["Warrior's Awareness"],
				"qb-featopt-Monk_8_Specialties": ["Perfect Flow"],
				"Monk Level 10 — Specialties": ["Agile Acrobat"],
				"qb-featopt-Monk_12_Specialties": ["Instant Step"],
				// ASI/feat slots are placed by name via the feat search box.
				"Feat Selection": ["Mobile", "Alert", "Tough"],
			},

			// ── Other choice buckets (uncomment as needed) ─────────────────────────
			// featureChoice:* prompts read these keyed buckets, NOT `options`. Putting
			// them under `options` silently fails (the pick is ignored/autofilled).
			// skills:        {"Soft Skills": ["History"], "Student of War": ["Animal Handling"]},
			// tools:         {"Student of War": ["Cartographer's Tools"]},
			// featureOptions:{"Battle Tactics Options": ["Hammer and Anvil"]}, // featureChoice:subfeature
			// optionalFeatures:{"EI": ["Agonizing Blast", "Devil's Sight"]},   // invocations, etc.
			// weaponMasteries: ["Longsword|XPHB", "Greatsword|XPHB"],
			// combatTraditions: ["Razor's Edge", "Mist and Shade"],

			// ── Spellcasters ───────────────────────────────────────────────────────
			// spellbook: [...],   // wizards: curated list added to the book AND prepared
			// spells:    [...],   // known-caster picks (sorcerer/bard/…)
			// cantrips:  [...],
			// regrantedCantrips: ["…"], // drop a stored copy a feature re-grants on import
		},

		// ── Optional post-spawn grafts (uncomment as needed) ───────────────────────
		// graft: {
		//   skills: {prof: ["perception"], expertise: ["stealth"]},
		//   customAbilities: [
		//     {name: "Cunning Action", icon: "🗡️", category: "homebrew", mode: "active",
		//      activationAction: "bonus", description: "Dash, Disengage, or Hide as a Bonus Action."},
		//   ],
		// },
		// favor: {god: "Pan", level: 25, boonChoices: {}}, // TGTT divine favor

		hp: "average", // "average" or "max"
	},

	// MyNewNpc: {
	//   name: "…", race: "…", background: "…",
	//   classes: [{name: "…", source: "TGTT", subclass: "…", subclassSource: "TGTT", level: 13}],
	//   abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
	//   choices: {options: {"+2:": ["…"], "+1:": ["…"], "Skills:": ["…", "…"], "Feat Selection": ["…"]}},
	//   hp: "average",
	// },
};

export const LOADOUTS = {
	Reggu: [
		// {candidates:[P(name, source?), …fallbacks], equip, attune, qty?}
		{candidates: [P("Sun Staff", "BMT")], equip: true, attune: true},
		{candidates: [P("Bracers of Defense", "XDMG"), P("Bracers of Defense", "DMG")], equip: true, attune: true},
		{candidates: [P("Eldritch Claw Tattoo", "TCE")], equip: true, attune: true},
		{candidates: [P("Insignia of Claws", "HotDQ")], equip: true, attune: false},
		{candidates: [P("Gem of Brightness", "XDMG"), P("Gem of Brightness", "DMG")], equip: false, attune: false},
		{candidates: [P("Potion of Speed", "XDMG"), P("Potion of Speed", "DMG")], equip: false, attune: false, qty: 2},
		{candidates: [P("Potion of Superior Healing", "XDMG"), P("Potion of Superior Healing", "DMG")], equip: false, attune: false, qty: 3},
	],
};
