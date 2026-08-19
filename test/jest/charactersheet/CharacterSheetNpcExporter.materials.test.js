/**
 * v22 — item materials and upgrades reach the statblock, and survive the bundle.
 *
 * Two bugs motivated this file:
 *
 *  1. the statblock had no material awareness at all, so penetration, crit thresholds,
 *     material-granted actions and material-granted advantage were invisible to a DM;
 *  2. `buildCompanionItems` read the RAW inventory, so a bundled item shipped with its
 *     base stats — the hover showed a weaker item than the statblock was built from.
 *
 * The routing test at the bottom is the durable one: it walks
 * `CharacterSheetMaterials.EFFECT_HANDLING` and fails when a newly-authored effect type
 * has no declared home in the exporter, so this cannot silently rot again.
 */
import "./setup.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-ioun.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import {CharacterSheetNpcExporter} from "../../../js/charactersheet/charactersheet-npc-exporter.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const BREW_PATH = path.join(__dirnameLocal, "..", "..", "..", "homebrew", "TravelersGuidetoThelemar.json");

let MATERIALS = [];
try {
	MATERIALS = JSON.parse(fs.readFileSync(BREW_PATH, "utf8")).itemMaterial || [];
} catch {
	// brew optional in some environments
}

const findMaterial = name => MATERIALS.find(m => m.name === name) || null;

function makeState ({items = [], abilities = {}} = {}) {
	const state = new CharacterSheetState();
	state.loadFromJson({
		name: "Probe",
		classes: [{name: "Fighter", source: "PHB", level: 5}],
		abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10, ...abilities},
		hp: {max: 44, current: 44},
		inventory: items,
	});
	state.setItemMaterialCatalog?.(MATERIALS);
	return state;
}

function weapon ({name = "Test Longsword", material = null, upgrades = null, property = [], dmg1 = "1d8"} = {}) {
	const item = {
		id: `w-${name.replace(/\W+/g, "-").toLowerCase()}`,
		name,
		source: "CUSTOM",
		custom: true,
		type: "weapon",
		weapon: true,
		weaponCategory: "martial",
		baseItem: "longsword|xphb",
		dmg1,
		dmgType: "S",
		property,
		weight: 3,
		value: 1500,
	};
	if (material) item.material = {name: material, source: "TGTT"};
	if (upgrades) item.appliedUpgrades = upgrades;
	return {id: item.id, item, quantity: 1, equipped: true};
}

const textOf = obj => JSON.stringify(obj);

const findEntry = (out, name) => ["trait", "action", "bonus", "reaction"]
	.flatMap(section => (out[section] || []).map(entry => ({section, entry})))
	.find(({entry}) => new RegExp(`^${name}$`, "i").test(String(entry?.name || "")));

const maybeDescribe = MATERIALS.length ? describe : describe.skip;

maybeDescribe("NPC export v22 — materials reach the statblock", () => {
	describe("the attack line carries what changes a roll", () => {
		it("states penetration as the near-miss rule it is, never as resistance-piercing", () => {
			// Regression pin. The in-app legend once described penetration as ignoring damage
			// RESISTANCE; it is an AC mechanic, and that one wrong string propagated into a
			// design decision. If this wording drifts back, the export is lying to the DM.
			const state = makeState({items: [weapon({material: "Orichaline"})]});
			const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
			const attack = (out.action || []).find(a => /Test Longsword/i.test(a.name || ""));

			expect(attack).toBeTruthy();
			expect(textOf(attack)).toMatch(/miss by \d+ or less still hits/i);
			expect(textOf(attack)).not.toMatch(/penetrat\w*[^.]*resistance/i);
		});

		it("reaches magical AC only for the material authored to", () => {
			const orichaline = CharacterSheetNpcExporter.convertStateToMonster(
				makeState({items: [weapon({material: "Orichaline"})]}), {});
			const steel = CharacterSheetNpcExporter.convertStateToMonster(
				makeState({items: [weapon({material: "Steel"})]}), {});

			const attackOf = out => (out.action || []).find(a => /Test Longsword/i.test(a.name || ""));

			expect(textOf(attackOf(orichaline))).toMatch(/even against magical AC/i);
			expect(textOf(attackOf(steel))).toMatch(/miss by \d+ or less still hits/i);
			expect(textOf(attackOf(steel))).not.toMatch(/even against magical AC/i);
		});

		it("states a material crit threshold on the attack", () => {
			const state = makeState({items: [weapon({material: "Orichaline"})]});
			const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
			const attack = (out.action || []).find(a => /Test Longsword/i.test(a.name || ""));

			expect(textOf(attack)).toMatch(/critical hit on a roll of 19-20/i);
		});

		it("offers an optional damage type as a choice, not as a silent override", () => {
			const state = makeState({items: [weapon({material: "Emberglass"})]});
			const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
			const attack = (out.action || []).find(a => /Test Longsword/i.test(a.name || ""));

			// Authored `optional: true` — the weapon still deals its own type by default.
			expect(textOf(attack)).toMatch(/can deal fire damage instead/i);
			expect(textOf(attack)).toMatch(/slashing damage/i);
		});

		it("scales an extra-weapon-die rider to the weapon carrying it", () => {
			const d4 = CharacterSheetNpcExporter._getMaterialDamageRiders({
				material: {name: "Cold Iron", source: "TGTT"}, dmg1: "1d4", type: "weapon", weapon: true,
			});
			const d12 = CharacterSheetNpcExporter._getMaterialDamageRiders({
				material: {name: "Cold Iron", source: "TGTT"}, dmg1: "1d12", type: "weapon", weapon: true,
			});

			expect(d4.join(" ")).toMatch(/\{@damage 1d4\} damage to fey creatures/i);
			expect(d12.join(" ")).toMatch(/\{@damage 1d12\} damage to fey creatures/i);
		});

		it("treats requiresProperty as a gate, not as a footnote", () => {
			// Stout Blackwood's crit die exists only on a loading weapon. On anything else
			// the rider is not "conditional" — it does not exist.
			const base = {material: {name: "Stout Blackwood", source: "TGTT"}, dmg1: "1d8", type: "weapon", weapon: true};

			expect(CharacterSheetNpcExporter._getMaterialDamageRiders({...base, property: []}).join(" "))
				.not.toMatch(/critical/i);
			expect(CharacterSheetNpcExporter._getMaterialDamageRiders({...base, property: ["LD"]}).join(" "))
				.toMatch(/critical hit it deals an extra \{@damage 1d4\}/i);
		});
	});

	describe("advantage is a roll modifier, not a trait", () => {
		it("folds a material's save advantage into Resilience with attribution", () => {
			const state = makeState({items: [{
				id: "armor-1",
				item: {
					id: "armor-1",
					name: "Test Plate",
					source: "CUSTOM",
					custom: true,
					type: "heavy armor",
					armor: true,
					armorType: "heavy",
					ac: 18,
					weight: 65,
					value: 150000,
					material: {name: "Lead", source: "TGTT"},
				},
				quantity: 1,
				equipped: true,
			}]});
			const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
			const resilience = (out.trait || []).find(t => /^resilience$/i.test(t.name || ""));

			expect(resilience).toBeTruthy();
			expect(resilience.entries[0]).toMatch(/advantage on saving throws against Abjuration/i);
			expect(resilience.entries[0]).toMatch(/\(Lead\)/);
			// It must not ALSO be sitting in the armour block — one effect, one home.
			expect(String(textOf((out.trait || []).filter(t => !/^resilience$/i.test(t.name || "")))))
				.not.toMatch(/advantage on saving throws against Abjuration/i);
		});

		it("rewrites the player's voice out of an authored conditional", () => {
			const clause = CharacterSheetNpcExporter._getMaterialAdvantageClause({
				kind: "save",
				conditional: "On checks and saving throws made to resist being moved against your will",
			});

			expect(clause).toBe("Advantage on checks and saving throws made to resist being moved against its will");
			expect(clause).not.toMatch(/\byour\b/i);
			// The authored clause names its own subject; ours must not be prefixed onto it.
			expect(clause).not.toMatch(/on on\b/i);
		});
	});

	describe("material powers", () => {
		it("gives a material-granted action the economy its prose names", () => {
			const state = makeState({items: [weapon({name: "Test Bow", material: "Yellowwood"})]});
			const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
			const found = findEntry(out, "Yellowwood Flurry");

			expect(found).toBeTruthy();
			expect(found.section).toBe("bonus");
			expect(textOf(found.entry)).not.toMatch(/\byou\b/i);
		});

		it("drops an affinity that only restates something already baked into the item", () => {
			// Skyshard's affinity describes the weight and thrown range the projection has
			// already applied. Printing it would be the same effect in two places.
			const state = makeState({items: [weapon({material: "Skyshard"})]});
			const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});

			expect(findEntry(out, "Skyshard Affinity")).toBeFalsy();
		});

		it("keeps a dormant condensate out of the statblock", () => {
			// Stormprism's affinity is authored for the focus role; on a weapon's striking
			// surface it is dormant, and a dormant affinity is a fact about the item rather
			// than something the NPC can do in a fight.
			const state = makeState({items: [weapon({material: "Stormprism"})]});
			const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});

			expect(findEntry(out, "Stormprism Affinity")).toBeFalsy();
		});
	});

	// `buildCompanionItems` bundles exactly what the statblock points at, so a fixture
	// only needs to supply the `{@item}` tag — going through a full conversion would couple
	// this to which traits survive consolidation, which is a different question entirely.
	const taggingMonster = (name, source = "CSHEET") => ({
		source,
		trait: [{name: "Special Equipment", entries: [`{@item ${name}|${source}}`]}],
	});

	describe("the bundled item does not degrade", () => {
		it("bundles composed stats rather than base stats", () => {
			const state = makeState({items: [weapon({
				material: "Orichaline",
				upgrades: [{name: "Balanced"}],
			})]});
			const [bundled] = CharacterSheetNpcExporter.buildCompanionItems(taggingMonster("Test Longsword"), state, {}) || [];

			expect(bundled).toBeTruthy();
			// A material/upgrade reference is inert on a receiving instance with no material
			// engine, so the export bakes the numbers and describes their provenance.
			expect(bundled.material).toBeUndefined();
			expect(bundled.appliedUpgrades).toBeUndefined();

			// Bug #2 proper: the bundle used to ship the *stored* item, so the hover showed a
			// weaker weapon than the statblock was built from. Every number a material or an
			// upgrade rewrites has to arrive already baked.
			expect(bundled.critThreshold).toBe(19); // Orichaline
			expect(bundled.bonusWeaponAttack).toBe("+1"); // Balanced
			expect(bundled.weight).toBeLessThan(3); // Orichaline halves weight

			expect(textOf(bundled.entries)).toMatch(/\{@b Material:\}/);
			expect(textOf(bundled.entries)).toMatch(/Orichaline/);
			expect(textOf(bundled.entries)).toMatch(/\{@b Upgrades:\}/);
		});

		it("never emits the deprecated combined weapon bonus alongside the split one", () => {
			const state = makeState({items: [weapon({material: "Orichaline", upgrades: [{name: "Balanced"}]})]});
			const [bundled] = CharacterSheetNpcExporter.buildCompanionItems(taggingMonster("Test Longsword"), state, {}) || [];

			expect(bundled).toBeTruthy();
			expect(bundled.bonusWeapon).toBeUndefined();
		});
	});

	describe("routing completeness", () => {
		// The root cause of bug #1 was that nothing distinguished "deliberately a table call"
		// from "someone forgot to wire it up". EFFECT_HANDLING is that distinction; this test
		// makes it binding on the exporter too.
		const HOMES = {
			// Baked into the projected item, so it reaches both the attack line and the bundle
			// through `getItems()` / `getEffectiveItemBonuses` without a dedicated code path.
			projection: "projected item stats",
			// Reaches a derived stat the statblock already prints (speed, initiative, saves).
			modifier: "derived statblock field",
			// Read by the attack/damage path and printed on the attack line.
			roll: "attack line",
			// Surfaces as an action/bonus/reaction/trait via getItemPowers.
			power: "action economy section",
			// Deliberately a table call; prose on the bundled item is the whole treatment.
			reference: "bundled item entries",
		};

		it("declares a home for every effect type the sheet can produce", () => {
			const handling = CharacterSheetMaterials.EFFECT_HANDLING || {};
			const undeclared = Object.entries(handling)
				.filter(([, spec]) => !HOMES[spec?.consumer])
				.map(([type, spec]) => `${type} (consumer: ${spec?.consumer})`);

			expect(undeclared).toEqual([]);
		});

		it("has an exporter home for every effect type actually authored in the catalog", () => {
			const handling = CharacterSheetMaterials.EFFECT_HANDLING || {};
			const authored = new Set();
			MATERIALS.forEach(m => (m.effects || []).forEach(e => e?.type && authored.add(e.type)));

			// A material may author an effect type the vocabulary has never heard of; that is
			// the failure this catches, and it is a data bug rather than an exporter bug.
			const unknown = [...authored].filter(type => !handling[type]);
			expect(unknown).toEqual([]);

			const homeless = [...authored].filter(type => !HOMES[handling[type]?.consumer]);
			expect(homeless).toEqual([]);
		});

		it("normalises every authored effect rather than dropping it on the floor", () => {
			// `getMaterialEffects` returns a fully-populated empty shape when the material is
			// missing, so a silently-unresolved material is indistinguishable from one with no
			// effects. Every catalog material must produce at least one non-default field.
			const probe = {type: "weapon", weapon: true, dmg1: "1d8", property: ["LD", "2H", "H", "F", "L", "T"], armorType: "heavy"};
			const inert = MATERIALS.filter(m => (m.effects || []).length).filter(m => {
				const fx = CharacterSheetMaterials.getMaterialEffects({...probe, material: {name: m.name, source: m.source}}, m);
				return !Object.values(fx).some(v => Array.isArray(v)
					? v.length
					: v && typeof v === "object"
						? Object.keys(v).length
						: !!v);
			}).map(m => m.name);

			// Armour-only materials legitimately produce nothing on a weapon probe.
			const weaponCapable = new Set(MATERIALS
				.filter(m => (m.effects || []).some(e => !e.appliesTo?.length || e.appliesTo.includes("weapon")))
				.map(m => m.name));

			expect(inert.filter(name => weaponCapable.has(name))).toEqual([]);
		});
	});
});

/**
 * v23 — three semantics the sheet pinned down in `9dbdc5b9` that this exporter had guessed.
 *
 * All three are LATENT against the corpus: no saved character carries Cold Iron,
 * Yellowwood, Stout Blackwood or Crossbow Expert, so none of them moved a single exported
 * statblock. That is precisely why they need tests — nothing else would have caught them.
 */
maybeDescribe("NPC export v23 — the rider says what it does", () => {
	const bludgeon = ({name, dmg1, material, type = "weapon", property = [], base = "maul|xphb"}) => {
		const item = {
			id: `w-${name.replace(/\W+/g, "-").toLowerCase()}`,
			name,
			source: "CUSTOM",
			custom: true,
			type,
			weapon: true,
			weaponCategory: "martial",
			baseItem: base,
			dmg1,
			dmgType: "B",
			property,
			weight: 10,
			value: 1000,
		};
		if (material) item.material = {name: material, source: "TGTT"};
		return {id: item.id, item, quantity: 1, equipped: true};
	};

	const attackLine = (items, namePattern, extra = {}) => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			name: "Probe",
			classes: [{name: "Fighter", source: "PHB", level: 5}],
			abilities: {str: 16, dex: 16, con: 14, int: 10, wis: 10, cha: 10},
			hp: {max: 44, current: 44},
			inventory: items,
			...extra,
		});
		state.setItemMaterialCatalog?.(MATERIALS);
		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
		const action = (out.action || []).find(a => namePattern.test(String(a.name || "")));
		return {out, action, text: JSON.stringify(action || {})};
	};

	describe("an extra weapon die is one die, not another expression", () => {
		it("adds a single d6 to a maul, not a second 2d6", () => {
			// The bug: `_getExtraWeaponDice` multiplied the authored count by the weapon's
			// DIE COUNT, so "one additional weapon damage die" paid a maul twice over. The
			// sheet is explicit (`_getSingleWeaponDie`): a maul rolling 2d6 adds d6.
			const {text} = attackLine([bludgeon({name: "Cold Maul", dmg1: "2d6", material: "Cold Iron"})], /Cold Maul/i);

			expect(text).toMatch(/extra \{@damage 1d6\} damage to fey creatures/i);
			expect(text).not.toMatch(/extra \{@damage 2d6\}/i);
		});

		it("still adds a whole d8 to a one-die weapon", () => {
			// The invisibility guard: on 1-die weapons the old arithmetic was already right
			// (1 x 1), which is why this shipped. Pin the case that never moved.
			const {text} = attackLine(
				[bludgeon({name: "Cold Sword", dmg1: "1d8", material: "Cold Iron", base: "longsword|xphb"})],
				/Cold Sword/i,
			);

			expect(text).toMatch(/extra \{@damage 1d8\} damage to fey creatures/i);
		});
	});

	describe("a die granted by a crit is not doubled by that crit", () => {
		const loadingCrossbow = bludgeon({
			name: "Blackwood Crossbow",
			dmg1: "1d8",
			material: "Stout Blackwood",
			type: "R",
			base: "crossbow, heavy|xphb",
			property: ["LD", "2H", "A"],
		});

		it("says so on the line, because the reader has nobody to ask", () => {
			// The crit rule doubles the ATTACK's damage dice. A die granted BY the crit is
			// not one of them (Brutal Critical is the precedent) and the sheet does not
			// double it. Without this clause the sentence reads both ways.
			const {text} = attackLine([loadingCrossbow], /Blackwood Crossbow/i);

			expect(text).toMatch(/On a critical hit it deals an extra \{@damage 1d4\}/i);
			expect(text).toMatch(/not doubled/i);
		});

		it("omits the die entirely on a weapon without the required property", () => {
			// `requiresProperty` is a HARD gate, and `getMaterialEffects` applies it only
			// inside its `grantsAction` case — never for `bonusCritDamage`. So the
			// exporter's own gate is load-bearing: drop it and a stout blackwood CLUB
			// advertises a crit die it never had.
			const {text} = attackLine(
				[bludgeon({name: "Blackwood Club", dmg1: "1d8", material: "Stout Blackwood"})],
				/Blackwood Club/i,
			);

			expect(text).not.toMatch(/critical hit it deals an extra/i);
		});
	});

	describe("no disadvantage in melee is an attack-line fact", () => {
		const bow = ({name, material}) => {
			const it = bludgeon({name, dmg1: "1d8", material, type: "R", base: "longbow|xphb", property: ["A", "H", "2H"]});
			it.item.dmgType = "P";
			return it;
		};

		it("states it for the material that grants it, naming the material", () => {
			// The sheet declares this `reference` and never applies it: it has no positional
			// model, so it can never impose the disadvantage this suppresses. A statblock
			// reader knows exactly where the creature is standing, which makes the export
			// the one consumer entitled to state it mechanically.
			const {text} = attackLine([bow({name: "Yew Longbow", material: "Yellowwood"})], /Yew Longbow/i);

			expect(text).toMatch(/within 5 feet of a hostile creature does not impose disadvantage/i);
			expect(text).toMatch(/Yellowwood/);
		});

		it("states it for a feat that grants it, naming the feat", () => {
			// Crossbow Expert registers the identical `ranged:noDisdvantageInMelee` effect.
			// A reader should not have to care whether the effect came from the bow or the
			// character, so both route through one sentence.
			const {text} = attackLine(
				[bow({name: "Plain Longbow"})],
				/Plain Longbow/i,
				{feats: [{name: "Crossbow Expert", source: "PHB"}]},
			);

			expect(text).toMatch(/within 5 feet of a hostile creature does not impose disadvantage/i);
			expect(text).toMatch(/Crossbow Expert/);
		});

		it("is read from the registry, because the modifier it registers never materialises", () => {
			// Measured: a character holding Crossbow Expert aggregates NOTHING for
			// `ranged:noDisdvantageInMelee` — the modifier is registered and never reaches
			// `namedModifiers`. Reading `getModifiersForType` would have been dead code, so
			// this pins the reason the registry is the source of truth here. If the sheet
			// ever wires the modifier up, this test documents that it was not always so.
			const state = new CharacterSheetState();
			state.loadFromJson({
				name: "Probe",
				classes: [{name: "Fighter", source: "PHB", level: 5}],
				abilities: {str: 16, dex: 16, con: 14, int: 10, wis: 10, cha: 10},
				hp: {max: 44, current: 44},
				feats: [{name: "Crossbow Expert", source: "PHB"}],
			});

			expect(state.getModifiersForType("ranged:noDisdvantageInMelee")).toEqual([]);
			expect(CharacterSheetNpcExporter._getNoMeleeDisadvantageFeatures(state)).toContain("Crossbow Expert");
		});

		it("says nothing on a melee-only attack", () => {
			// The clause is about ranged attack rolls. A maul cannot suffer the penalty, so
			// mentioning it there would be noise on a line that has to be read mid-swing.
			const {text} = attackLine(
				[bludgeon({name: "Plain Maul", dmg1: "2d6"})],
				/Plain Maul/i,
				{feats: [{name: "Crossbow Expert", source: "PHB"}]},
			);

			expect(text).not.toMatch(/does not impose disadvantage/i);
		});
	});
});
