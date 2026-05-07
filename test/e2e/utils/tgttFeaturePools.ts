/**
 * TGTT Feature Pools — auto-derived from homebrew/TravelersGuidetoThelemar.json.
 * Used by feature-matrix entries for kind:"pick" probes.
 *
 * Regenerate with the python snippet in scripts/genTgttPools (TODO) or
 * by hand if a TGTT specialty/BT pool changes.
 */

// ── Specialties (Class-feature "Specialties" pick-list at L1+) ──
export const TGTT_SPECIALTIES: Record<string, RegExp[]> = {
	Barbarian: [
		/^Agile Sprinter$/i,
		/^Flock Step$/i,
		/^Mark of the Wilderness$/i,
		/^Natural Tracker$/i,
		/^Path of Blustery Autumns$/i,
		/^Path of Lean Winters$/i,
		/^Path of Scorching Summers$/i,
		/^Sharpened Senses$/i,
		/^Lead the Pack$/i,
		/^Path of Drowning Springs$/i,
	],
	Bard: [
		/^Bewitching Companion$/i,
		/^Brutish Confrontation$/i,
		/^Improvised Engineering$/i,
		/^Marching Song$/i,
		/^Profitable$/i,
		/^Resonance$/i,
		/^Sly Confidant$/i,
		/^Song of Rest$/i,
		/^Showoff$/i,
		/^Townie$/i,
		/^Widely Known$/i,
	],
	Cleric: [
		/^Ancestral Guidance$/i,
		/^Compassionate Nurse$/i,
		/^Faithful Historian$/i,
		/^Gentle Healer$/i,
		/^Graceful Fall$/i,
		/^Monastic Austerity$/i,
		/^Numinous Awareness$/i,
		/^Premonition$/i,
		/^Preservation$/i,
		/^Righteous Path$/i,
		/^Soothing Words$/i,
		/^Supernal Intuition$/i,
		/^Theologian$/i,
		/^Voice of Doom$/i,
	],
	Druid: [
		/^Aerial Surveyor$/i,
		/^Aquatic Delver$/i,
		/^Cavern Skulker$/i,
		/^Desert Dweller$/i,
		/^Eldritch Survivor$/i,
		/^Herbal Apothecary$/i,
		/^Marshland Guide$/i,
		/^Master Forager$/i,
		/^Mountain Climber$/i,
		/^Tundra Explorer$/i,
	],
	Fighter: [
		/^Amphibious Combatant$/i,
		/^Battle Hardened$/i,
		/^Combat Medic$/i,
		/^Stamina Enthusiast$/i,
		/^Fight Club$/i,
		/^Shield Specialist$/i,
		/^Stronghold Builder$/i,
		/^Sweeping Attacker$/i,
		/^Burst of Strength$/i,
		/^Campaigner$/i,
		/^Clearsight Sentinel$/i,
		/^Extreme Leap$/i,
		/^Mountaineer$/i,
		/^Nightwatch$/i,
		/^Stable Footing$/i,
		/^Weather Beaten$/i,
	],
	Monk: [
		/^Adept Speed$/i,
		/^Marathon Runner$/i,
		/^Nimble Athlete$/i,
		/^Power Tumble$/i,
		/^Religious Training$/i,
		/^Wilderness Training$/i,
		/^Focus Speech$/i,
		/^Hurricane Walk$/i,
		/^Instant Step$/i,
		/^Shadow Walk$/i,
		/^Sixth Sense$/i,
		/^Gale Walk$/i,
		/^Wall Walk$/i,
		/^Warrior's Awareness$/i,
		/^Water Walk$/i,
		/^Agile Acrobat$/i,
		/^Perfect Flow$/i,
	],
	Paladin: [
		/^Bestowed Understanding$/i,
		/^Divine Vision$/i,
		/^Divine Health$/i,
		/^Do Without$/i,
		/^Exemplary$/i,
		/^Glorious Purpose$/i,
		/^Heraldic Order$/i,
		/^Miraculous Discovery$/i,
		/^Naturalist$/i,
		/^Prophetic Protection$/i,
		/^Seek Truths$/i,
		/^Sense Import$/i,
		/^Silvered Tongue$/i,
		/^Undaunted$/i,
		/^Holy Avenger$/i,
		/^Sacred Protection$/i,
		/^Pious Soul$/i,
		/^Supreme Healing$/i,
	],
	Ranger: [
		/^Beast Friend$/i,
		/^Build Shelter$/i,
		/^Calls of the Wild$/i,
		/^Ear to the Ground$/i,
		/^Expert Foraging$/i,
		/^Forced Marcher$/i,
		/^Guide$/i,
		/^Healing Salves$/i,
		/^Herbal Bitters$/i,
		/^Huntsman$/i,
		/^Longwalker$/i,
		/^Monster Mimic$/i,
		/^Poisons and Antidotes$/i,
		/^Read the Room$/i,
		/^Relentless Pursuit$/i,
		/^Swift Tracker$/i,
		/^See the Unseen$/i,
		/^Uncanny Tracker$/i,
		/^Master Tracker$/i,
	],
	Rogue: [
		/^Agile Athlete$/i,
		/^Analysis$/i,
		/^Boobytrapper$/i,
		/^Cat's Eyes$/i,
		/^Delay Trap$/i,
		/^Expertise Training$/i,
		/^Extra Skill Training$/i,
		/^Hide in the Shadows$/i,
		/^Kip Up$/i,
		/^Locksmith$/i,
		/^Loot Runner$/i,
		/^Observer$/i,
		/^Quick Scan$/i,
		/^Scout Leader$/i,
		/^Sense for Secrets$/i,
		/^Tuck and Roll$/i,
		/^Unstable Poison$/i,
		/^Graceful Leap$/i,
		/^Keen Eye$/i,
		/^Poison Expert$/i,
		/^Practiced Dash$/i,
		/^Sense Aura$/i,
		/^Shadow Skulk$/i,
		/^Skeleton Key$/i,
	],
	Sorcerer: [
		/^Draw Nourishment$/i,
		/^Hot Air$/i,
		/^Lingering Touch$/i,
		/^Retrace$/i,
		/^Mage Hunter$/i,
		/^Magnetic Step$/i,
		/^Strange Traces$/i,
		/^Ominous Insight$/i,
		/^Wode Sense$/i,
	],
	Warlock: [
		/^Beast Speech$/i,
		/^Book of Ancient Secrets$/i,
		/^Devil's Sight$/i,
		/^Eldritch Sight$/i,
		/^Mirror, Mirror$/i,
		/^Otherworldly Leap$/i,
		/^Portents and Portals$/i,
		/^Whiff of the Beyond$/i,
		/^Ascendant Step$/i,
		/^One with Shadows$/i,
		/^Visions of Distant Realms$/i,
		/^Inscrutability$/i,
		/^Master of Myriad Forms$/i,
		/^Shadowveil$/i,
	],
	Wizard: [
		/^Air Lift$/i,
		/^Detect Magic Savant$/i,
		/^Eidetic Memory$/i,
		/^Illusion Detective$/i,
		/^Loremaster of Creatures$/i,
		/^Loremaster of Travel$/i,
		/^Persistent Mending$/i,
		/^Presto, Prestidigitation$/i,
	],
};

// Levels at which each TGTT class gains a Specialty pick (cumulative).
export const TGTT_SPECIALTY_LEVELS: Record<string, number[]> = {
	Barbarian: [1, 3, 6, 8, 10, 13, 15, 18, 20],
	Bard: [2, 6, 9, 13, 16, 20],
	Cleric: [3, 7, 11, 15, 20],
	Druid: [1, 5, 9, 13, 17],
	Fighter: [1, 5, 9, 13, 17],
	Monk: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
	Paladin: [3, 5, 7, 9, 11, 14, 19],
	Ranger: [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
	Rogue: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19],
	Sorcerer: [4, 8, 12, 16, 20],
	Warlock: [2, 8, 14],
	Wizard: [4, 8, 12, 16, 20],
};

// ── Battle Tactics (TGTT Fighter optional-feature pool) ──
export const TGTT_BATTLE_TACTICS: RegExp[] = [
	/^High Ground$/i,
	/^Sweeping Blows$/i,
	/^Charging$/i,
	/^Flanking$/i,
	/^Eye of the Storm$/i,
	/^Hammer and Anvil$/i,
	/^Back to the Wall$/i,
	/^Covering Attack$/i,
	/^Goading Movement$/i,
	/^Last Ditch Evasion$/i,
	/^Daring Feint$/i,
	/^Sheathing the Sword$/i,
	/^Dying Surge$/i,
];

// Cumulative Battle Tactics picks at each level.
export const TGTT_BATTLE_TACTICS_CUM: Record<number, number> = {3: 2, 7: 3, 10: 4, 15: 5};

// ── Helper: build cumulative Specialty pick-checks for a TGTT class ──
import type {FeatureCheck} from "./comprehensiveBuildHelpers";

/**
 * Generate FeatureCheck entries for the TGTT "Specialties" pick at each
 * level the class gains a new specialty. Each entry asserts that
 * cumulative `pickedCount` distinct specialty names from the class's L1
 * pool surface in the feature list.
 *
 * Multiclass usage: pass the class-level you expect at the milestone
 * (not character-level) — the helper assumes `levelMap` maps
 * class-level → character-level for that build.
 */
export function buildSpecialtyChecks (className: string, levelMap?: Record<number, number>): FeatureCheck[] {
	const pool = TGTT_SPECIALTIES[className];
	const levels = TGTT_SPECIALTY_LEVELS[className];
	if (!pool || !levels) return [];
	return levels.map((classLevel, idx) => ({
		level: levelMap ? (levelMap[classLevel] ?? classLevel) : classLevel,
		name: /specialties/i,
		kind: "pick" as const,
		pickedCount: idx + 1,
		pickedFrom: pool,
	}));
}
