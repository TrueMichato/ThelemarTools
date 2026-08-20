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

		// v25. The two tests above are CATEGORY-level: they ask whether a consumer has a home,
		// never whether a given TYPE reaches it. That is exactly how `condensateInstability`
		// hid — declared `consumer: "power"`, it satisfied the category check while the
		// exporter surfaced it through no power channel at all. For the one consumer where a
		// type can plausibly be forgotten, name the mechanism per type instead.
		it("names the exporter mechanism for every power-consumer effect type", () => {
			const handling = CharacterSheetMaterials.EFFECT_HANDLING || {};
			// Each entry must be a real exporter method. `condensateInstability` is deliberately
			// NOT routed through `getItemPowers`: a fumble and a suppression qualify the attack
			// being made, so they belong on the attack line, in the reader's eye at the moment
			// they apply. Stating that here makes the divergence a decision, not an omission.
			const MECHANISM = {
				grantsAction: "_getMaterialPowerEntries",
				condensateAffinity: "_getMaterialPowerEntries",
				condensateInstability: "_getInstabilityBackfireClause",
			};

			const powerTypes = Object.entries(handling)
				.filter(([, spec]) => spec?.consumer === "power")
				.map(([type]) => type);

			expect(powerTypes.length).toBeGreaterThanOrEqual(3);
			expect(powerTypes.filter(t => !MECHANISM[t])).toEqual([]);
			expect(Object.values(MECHANISM).filter(fn => typeof CharacterSheetNpcExporter[fn] !== "function")).toEqual([]);
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

/**
 * v24 — a material-granted reaction reaches the Reactions section.
 *
 * `getItemPowers` publishes an authored `actionType`, and the exporter was ignoring it in
 * favour of scanning the power's prose. That scan is structurally unable to find the
 * answer: every economy-bearing note in the brew states its *trigger* ("When an attack
 * hits you...") and never its *cost*, so all five reactions and actions were filing
 * themselves as traits — the one section a player never checks mid-combat.
 */
maybeDescribe("NPC export v24 — the material power lands in the right section", () => {
	const authoredEconomies = MATERIALS
		.flatMap(mat => (mat.effects || [])
			.filter(fx => fx.type === "grantsAction" && fx.actionType)
			.map(fx => ({material: mat.name, name: fx.name, actionType: fx.actionType, note: fx.note || ""})));

	it("has authored economies to route, or this whole block is vacuous", () => {
		// Guards the suite against passing because the brew stopped declaring `actionType`
		// at all, which would make every assertion below trivially true.
		expect(authoredEconomies.length).toBeGreaterThanOrEqual(5);
	});

	it.each([
		["reaction", "reaction"],
		["bonus", "bonus"],
		["action", "action"],
		["attack", "action"],
	])("routes an authored %s to the %s section", (actionType, expected) => {
		expect(CharacterSheetNpcExporter._getMaterialPowerSection({
			actionType,
			description: "Move 5 feet without provoking Opportunity Attacks.",
		})).toBe(expected);
	});

	it("routes every authored economy in the brew away from the trait pile", () => {
		// The real defect, stated over the shipped data rather than a fixture: not one of
		// these notes names its own cost, so prose alone sends all of them to `trait`.
		authoredEconomies.forEach(power => {
			expect(CharacterSheetNpcExporter._getActivationSectionFromText(power.note)).toBeNull();
			expect(CharacterSheetNpcExporter._getMaterialPowerSection(power)).not.toBeNull();
		});
	});

	it("still reads the prose when the brew names no cost", () => {
		// Yellowwood's Flurry is `isReferenceOnly` on the sheet because no button can express
		// "when you take the Attack action". A statblock reader has no such limit, so the
		// bonus action its own prose declares must survive.
		expect(CharacterSheetNpcExporter._getMaterialPowerSection({
			actionType: "special",
			description: "When you take the Attack action with a yellowwood melee weapon, you can use a bonus action to attack again with it.",
		})).toBe("bonus");
	});

	it("leaves a genuinely passive power in the trait pile", () => {
		// Stout Blackwood's shove rides on a hit and costs nothing. `special` is the
		// accessor's filler for "the brew said nothing", so it must not become an action.
		expect(CharacterSheetNpcExporter._getMaterialPowerSection({
			actionType: "special",
			description: "Once per turn when you hit, contest Strength (Athletics) against the target.",
		})).toBeNull();
	});

	it("keeps a condensate affinity suppressible, because it has no economy of its own", () => {
		// `_getMaterialPowerEntries` drops an affinity whose section is null; that gate is
		// what stops Emberglass restating the damage-type option already on the attack line.
		expect(CharacterSheetNpcExporter._getMaterialPowerSection({
			actionType: "special",
			materialAffinity: true,
			description: "Kindles dry material touched to it for a minute.",
		})).toBeNull();
	});
});

/**
 * v25 — a condensate's drawback rides with the thing it undermines.
 *
 * The statblock advertised Emberglass's fire-damage option on the attack line and stated
 * its off-switch nowhere at all: the suppression text lives on the bundled item, and only
 * *custom* items are bundled, so for Aldor — whose sword is a catalog item — it reached the
 * reader through no path whatsoever. Advertising a benefit while hiding the condition that
 * removes it is worse than never mentioning it, because the DM applies the half they saw.
 */
maybeDescribe("NPC export v25 — the drawback rides with the benefit", () => {
	const weapon = ({name, material, dmg1 = "1d8"}) => {
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
			property: [],
			weight: 3,
			value: 1500,
			material: {name: material, source: "TGTT"},
		};
		return {id: item.id, item, quantity: 1, equipped: true};
	};

	const attackFor = (name, material) => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			name: "Probe",
			classes: [{name: "Fighter", source: "PHB", level: 5}],
			abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10},
			hp: {max: 44, current: 44},
			inventory: [weapon({name, material})],
		});
		state.setItemMaterialCatalog?.(MATERIALS);
		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
		const action = (out.action || []).find(a => new RegExp(name, "i").test(String(a.name || "")));
		return String((action?.entries || []).join(" "));
	};

	const materialNamed = (name) => MATERIALS.find(m => m.name === name);

	describe("a natural 1 that hurts the wielder is stated on the attack", () => {
		it("turns Vitriol Crystal's fumble into an attack-line clause", () => {
			// It is a consequence of THIS attack roll, so a reader must not have to remember
			// to go and look up a trait after fumbling.
			expect(CharacterSheetNpcExporter._getInstabilityBackfireClause({
				_materialEntity: materialNamed("Vitriol Crystal"),
			})).toMatch(/On a natural 1, it takes \{@damage 1d4\} acid damage \(Vitriol Crystal\)/);
		});

		it("uses each material's own die and damage type", () => {
			// Stormprism is the second authored case; pinning both stops the clause being
			// hardcoded to whichever one was written first.
			expect(CharacterSheetNpcExporter._getInstabilityBackfireClause({
				_materialEntity: materialNamed("Stormprism"),
			})).toMatch(/\{@damage 1d6\} lightning damage/);
		});

		it("ignores an instability that is not triggered by the attack roll", () => {
			// Magmaheart fires when the NPC TAKES cold damage. That has nothing to do with
			// the attack it is making, so putting it here would be noise mid-swing.
			expect(CharacterSheetNpcExporter._getInstabilityBackfireClause({
				_materialEntity: materialNamed("Magmaheart"),
			})).toBeNull();
		});

		it("says nothing for a material with no instability at all", () => {
			expect(CharacterSheetNpcExporter._getInstabilityBackfireClause({
				_materialEntity: materialNamed("Adamantine"),
			})).toBeNull();
		});
	});

	describe("an affinity's off-switch is stated where the affinity is offered", () => {
		it("names the suppression beside the damage-type option it removes", () => {
			const text = attackFor("Ember Blade", "Emberglass");

			expect(text).toMatch(/Can deal fire damage instead of its normal type/i);
			expect(text).toMatch(/suppresses its affinity/i);
			// Both halves in ONE parenthetical: the reader must not be able to take the
			// benefit without seeing the cost.
			expect(text).toMatch(/\(Emberglass; cold damage[^)]*suppresses[^)]*\)/i);
		});

		it("keeps the clause lower-cased so the entry normaliser cannot split it", () => {
			// `_getAttackQualifiers` joins parts with ". ", and a separate normaliser rewrites
			// "; " before a CAPITAL into ". ". A capitalised clause therefore ends the
			// parenthetical mid-sentence — which is exactly what shipped first.
			const clause = CharacterSheetNpcExporter._getAffinitySuppressionClause({
				_materialEffects: {condensate: {isActive: true, instability: "Cold damage suppresses its affinity."}},
			});

			expect(clause).toBe("cold damage suppresses its affinity");
			expect(attackFor("Ember Blade", "Emberglass")).not.toMatch(/\(Emberglass\.\s/);
		});

		it("stays silent for an instability that is not a suppression", () => {
			// Gravesalt dissolving in fresh water is a table call about the item, not a combat
			// fact. Printing every instability would bury the two that matter.
			expect(CharacterSheetNpcExporter._getAffinitySuppressionClause({
				_materialEffects: {condensate: {isActive: true, instability: "Fresh water dissolves exposed Gravesalt in 1 minute."}},
			})).toBeNull();
		});

		it("stays silent while the condensate is dormant, because nothing is being offered", () => {
			// A dormant affinity grants no benefit, so there is no promise to qualify.
			expect(CharacterSheetNpcExporter._getAffinitySuppressionClause({
				_materialEffects: {condensate: {isActive: false, instability: "Cold damage suppresses its affinity."}},
			})).toBeNull();
		});
	});

	it("has real suppression and fumble instabilities authored, or this block is vacuous", () => {
		// Guards against the brew dropping the vocabulary and every assertion above passing
		// trivially.
		const instabilities = MATERIALS
			.flatMap(m => (m.effects || []).filter(e => e.type === "condensateInstability").map(e => e.text || ""));

		expect(instabilities.filter(t => /suppress/i.test(t)).length).toBeGreaterThanOrEqual(3);
		expect(MATERIALS.filter(m => CharacterSheetMaterials.getInstabilitySpec?.(m)).length).toBeGreaterThanOrEqual(2);
	});
});

/**
 * v26 — armour tier is read across both vocabularies, or half the inventory is mis-read.
 *
 * The sheet describes armour two ways: a catalogue plate is `type: "HA"` with no `armorType`,
 * an item-builder plate is `type: "armor"` with `armorType: "heavy"`. The exporter read only
 * `armorType`, so every catalogue suit resolved to `""` — and the tier gate treated "I could
 * not tell" as "it applies".
 *
 * The sibling session hit the mirror of this on the sheet side (their gate read only `type`,
 * so every CUSTOM plate lost its DR). Same root cause, opposite survivor: their bug spared
 * catalogue armour, mine spared custom armour, and each looked correct to whoever tested the
 * half they had. The 24-character corpus is entirely custom-built and could not reach this.
 */
maybeDescribe("NPC export v26 — armour tier is read across both vocabularies", () => {
	const ADAMANTINE = MATERIALS.find(m => m.name === "Adamantine");

	const armor = ({type, armorType}) => {
		const item = {
			id: `a-${type}-${armorType || "none"}`,
			name: "Probe Armor",
			source: "CUSTOM",
			custom: true,
			type,
			armor: true,
			ac: 18,
			weight: 20,
			value: 10000,
			material: {name: "Adamantine", source: "TGTT"},
		};
		if (armorType) item.armorType = armorType;
		return item;
	};

	const drFor = (item) => CharacterSheetNpcExporter._getMaterialDamageReductionClause(
		item,
		CharacterSheetMaterials.getMaterialEffects(item, ADAMANTINE),
	);

	it("authors more than one armour tier, or none of this can be wrong", () => {
		// If Adamantine ever collapses to a single tier every assertion below passes trivially.
		const tiers = (ADAMANTINE.effects || []).filter(e => e.type === "damageReduction");
		expect(tiers.length).toBeGreaterThanOrEqual(2);
		expect(new Set(tiers.map(t => t.armorType)).size).toBeGreaterThanOrEqual(2);
	});

	describe("the reduction printed is the one the worn tier actually grants", () => {
		it("reads a catalogue heavy suit (type HA, no armorType)", () => {
			expect(drFor(armor({type: "HA"}))).toMatch(/damage taken by 3\./);
		});

		it("gives a catalogue medium suit its own smaller number", () => {
			// This is the assertion that fails loudest: the old fallback printed the FIRST
			// authored entry, so a half plate claimed heavy plate's reduction.
			expect(drFor(armor({type: "MA"}))).toMatch(/damage taken by 2\./);
		});

		it("prints nothing on light armour, which Adamantine does not protect at all", () => {
			// Inventing a defence is worse than omitting one -- the DM has no way to know the
			// number was manufactured by a fallback.
			expect(drFor(armor({type: "LA"}))).toBeNull();
			expect(drFor(armor({type: "armor", armorType: "light"}))).toBeNull();
		});

		it("still reads the item-builder vocabulary it always could", () => {
			// The half that worked must keep working; this is the regression guard on the fix.
			expect(drFor(armor({type: "armor", armorType: "heavy"}))).toMatch(/damage taken by 3\./);
			expect(drFor(armor({type: "armor", armorType: "medium"}))).toMatch(/damage taken by 2\./);
		});
	});

	describe("a tier-scoped note is a statement about armour of that tier", () => {
		const notes = [
			{label: "Adamantine (heavy)", description: "Reduce incoming damage by 3.", type: "passive"},
			{label: "Adamantine (medium)", description: "Reduce incoming damage by 2.", type: "passive"},
			{label: "Adamantine", description: "Cannot be destroyed.", type: "passive"},
		];
		const kept = (item) => notes
			.filter(n => CharacterSheetNpcExporter._isMaterialNoteApplicable(n, CharacterSheetNpcExporter._getArmorCategory(item)))
			.map(n => n.label);

		it("keeps only the worn tier on a catalogue suit", () => {
			// Previously kept BOTH, so one statblock told the DM to reduce by 3 and by 2.
			expect(kept(armor({type: "HA"}))).toEqual(["Adamantine (heavy)", "Adamantine"]);
		});

		it("drops every tier note on light armour while keeping the untiered one", () => {
			expect(kept(armor({type: "LA"}))).toEqual(["Adamantine"]);
		});

		it("never puts an armour tier on a weapon", () => {
			// An Adamantine sword was printing both armour reductions. It should keep only the
			// note that is true of any adamantine object.
			expect(kept({type: "M", weapon: true, name: "Adamantine Sword"})).toEqual(["Adamantine"]);
		});
	});

	it("resolves tier identically to the sheet, so the two cannot drift", () => {
		// The exporter keeps a local fallback for headless/degraded paths. If it disagreed with
		// the sheet, an export would describe armour the sheet does not.
		const cases = [
			{type: "HA"}, {type: "MA"}, {type: "LA"}, {type: "S"},
			{type: "armor", armorType: "heavy"}, {type: "armor", armorType: "light"},
			{type: "M", weapon: true}, {},
		];
		cases.forEach(item => {
			expect(CharacterSheetNpcExporter._getArmorCategory(item)).toBe(CharacterSheetState.getArmorCategory(item));
		});
	});
});

/**
 * v26b — a projected field is counted once, never added on top of itself.
 *
 * `applyToItem` bakes attack, damage, AC, dice and ranges INTO the item that `getItems()`
 * returns. `getEffectiveItemBonuses` publishes overlapping totals for the same effects. Read
 * both additively and every bonus pays twice.
 *
 * The exporter avoids this by branching (`eff ? eff.total... : item.bonusWeapon + ...`) rather
 * than summing, which is correct but entirely invisible — nothing failed if someone changed
 * the `else` to a `+`. The materials session has flagged this trap twice and hit its inverse
 * on their own side (a projection with no de-projection compounded a thrown range 20 -> 40 ->
 * 60 across builder round-trips). These pin the exporter's half.
 */
maybeDescribe("NPC export v26b — a projected bonus is counted exactly once", () => {
	const magicSword = (bonus) => {
		const item = {
			id: "w-magic",
			name: "Probe Sword",
			source: "CUSTOM",
			custom: true,
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			baseItem: "longsword|xphb",
			dmg1: "1d8",
			dmgType: "S",
			property: [],
			weight: 3,
			value: 1500,
		};
		if (bonus) item.bonusWeapon = `+${bonus}`;
		return {id: item.id, item, quantity: 1, equipped: true};
	};

	const probe = (bonus) => {
		const state = new CharacterSheetState();
		state.setItemMaterialCatalog?.(MATERIALS);
		state.loadFromJson({
			name: "Probe",
			classes: [{name: "Fighter", source: "PHB", level: 5}],
			abilities: {str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
			hp: {max: 44, current: 44},
			inventory: [magicSword(bonus)],
		});
		state.setItemMaterialCatalog?.(MATERIALS);
		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
		const action = (out.action || []).find(a => /Probe Sword/i.test(String(a.name || "")));
		const text = String((action?.entries || []).join(" "));
		return {
			toHit: Number(/\{@hit \+?(-?\d+)\}/.exec(text)?.[1]),
			damage: /\{@damage ([^}]+)\}/.exec(text)?.[1],
			eff: state.getEffectiveItemBonuses?.("w-magic"),
		};
	};

	it("adds a weapon's enhancement to hit exactly once", () => {
		// STR +3, proficiency +3. A +1 sword is +7, not +8. Doubling here is a single
		// character's difference in the source and silently inflates every magic weapon.
		const plain = probe(0);
		const plusOne = probe(1);

		expect(plain.toHit).toBe(6);
		expect(plusOne.toHit).toBe(7);
		expect(plusOne.toHit - plain.toHit).toBe(1);
	});

	it("adds the same enhancement to damage exactly once", () => {
		expect(probe(0).damage).toMatch(/1d8\s*\+\s*3$/);
		expect(probe(1).damage).toMatch(/1d8\s*\+\s*4$/);
	});

	it("scales linearly, so a doubling cannot hide inside a small bonus", () => {
		// +1 -> +7 and +3 -> +9. If the two channels were summed this would read +8 and +12,
		// which a single-bonus test could mistake for an off-by-one somewhere else.
		expect(probe(3).toHit - probe(1).toHit).toBe(2);
	});

	it("keeps the accessor and the raw item agreeing, which is why summing them is wrong", () => {
		// The guard's premise: `getEffectiveItemBonuses` already CONTAINS the item's own
		// enhancement. If this ever stops being true the branch above must be revisited, so
		// state the premise rather than relying on it silently.
		expect(Number(probe(2).eff?.totalAttackBonus)).toBe(2);
		expect(Number(probe(2).eff?.totalDamageBonus)).toBe(2);
	});

	it("has no material that steps a damage die, which is what makes the die path safe", () => {
		// `damageDieIncrease` is read from the accessor and applied on top of the PROJECTED
		// item's die. That is only safe while no material steps dice during projection --
		// Mithril's ladder moves properties (2H -> V), not dice. If a material ever gains a
		// die step, the die would be raised twice and this fails first.
		const dieSteppers = MATERIALS.filter(m => (m.effects || [])
			.some(e => /^(damageDieIncrease|damageStep|damageDieLadder)$/.test(String(e.type))));

		expect(dieSteppers.map(m => m.name)).toEqual([]);
	});
});

/**
 * v26c -- a material's damage reduction has exactly one home.
 *
 * The sheet publishes DR through two independent channels: `getItemMaterialNotes` carries the
 * authored prose ("...reduce incoming damage by 3"), and `getNamedModifiersByType` carries the
 * structured modifier. For most of this task the second returned [] for every character, so
 * "only one channel prints" was true by accident rather than by design. It started firing in
 * `6ffb68ca`, and the sibling session explicitly asked which surface should own it.
 *
 * The answer is the authored prose, because it says the same thing in the material's own voice
 * and is already grouped under the armour that grants it. The exporter reads `getMaterialEffects`
 * and never the modifier channel -- but nothing failed if it started, so pin it.
 */
maybeDescribe("NPC export v26c -- damage reduction is stated once, not once per channel", () => {
	const plate = () => ({
		id: "a-dr-plate",
		item: {
			id: "a-dr-plate",
			name: "Probe Plate",
			source: "CUSTOM",
			custom: true,
			type: "armor",
			armorType: "heavy",
			armor: true,
			ac: 18,
			weight: 65,
			value: 150000,
			material: {name: "Adamantine", source: "TGTT"},
		},
		quantity: 1,
		equipped: true,
	});

	const DR_SENTENCE = /[Rr]educe[sd]? (?:incoming )?(?:bludgeoning|damage)[^"]{0,80}?by \d+/g;

	it("keeps BOTH channels live, or counting to one proves nothing", () => {
		// The vacuity guard, and the whole reason this file needs the test. If either channel
		// goes quiet the single-surface assertion below passes for the wrong reason -- which is
		// exactly the state this repo was in for several waves without noticing.
		const state = makeState({items: [plate()]});

		expect((state.getNamedModifiersByType?.("damageReduction") || []).length).toBeGreaterThan(0);
		expect((state.getItemMaterialNotes?.("a-dr-plate") || []).length).toBeGreaterThan(0);
	});

	it("prints the reduction exactly once across the whole statblock", () => {
		const state = makeState({items: [plate()]});
		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});

		expect(String(JSON.stringify(out)).match(DR_SENTENCE) || []).toHaveLength(1);
	});

	it("puts it on the armour that grants it, so a DM knows what to take off", () => {
		// Naming the home makes a future move visible in the diff rather than silent.
		const state = makeState({items: [plate()]});
		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {});
		const armorTraits = (out.trait || []).find(t => /^Armor Traits$/i.test(t.name || ""));

		expect(armorTraits).toBeTruthy();
		expect(JSON.stringify(armorTraits)).toMatch(/reduce incoming[^"]*by 3/i);
	});

	it("never reads the structured modifier channel", () => {
		// The exporter goes through `getMaterialEffects`. If someone adds a
		// `getNamedModifiersByType("damageReduction")` read for a "more robust" number, this
		// names the reason before anyone has to bisect for it.
		expect(String(CharacterSheetNpcExporter._getMaterialDamageReductionClause))
			.not.toMatch(/getNamedModifiersByType/);
	});

	it("collapses two identical descriptions, which is what actually holds the count at one", () => {
		// Measured, not assumed. I first believed the authored/derived if-else was the guard and
		// verified RED by making it additive -- the count stayed at 1. The real protection is
		// `Armor Traits`' dedupe on the lowercased description. Pin the mechanism that is doing
		// the work, not the one that looks like it is.
		const state = makeState({items: [plate()]});
		const twice = [
			{label: "Adamantine", description: "Reduce incoming damage by 3", type: "passive"},
			{label: "Adamantine", description: "reduce incoming damage BY 3.", type: "passive"},
		];
		state.getArmorUpgradeNotes = () => twice;
		CharacterSheetNpcExporter._getEquippedArmorMaterialNotes = () => [];

		const traits = CharacterSheetNpcExporter._getArmorTraitBlock(state);
		expect(String(JSON.stringify(traits)).match(/reduce incoming damage by 3/gi) || [])
			.toHaveLength(1);
	});

	it("cannot collapse a PARAPHRASE, so a second channel must never render its own wording", () => {
		// The limitation of the dedupe, stated so nobody trusts it further than it goes. Two
		// channels saying the same thing in different words both survive -- which is exactly
		// what would happen if the structured modifier ("Adamantine (damage reduction)", 3)
		// were ever rendered alongside the authored prose. The count test above would catch it;
		// this says WHY it would not be caught by the dedupe.
		const state = makeState({items: [plate()]});
		state.getArmorUpgradeNotes = () => [
			{label: "Adamantine", description: "Reduce incoming damage by 3", type: "passive"},
			{label: "Adamantine", description: "Damage taken is lowered by 3", type: "passive"},
		];
		CharacterSheetNpcExporter._getEquippedArmorMaterialNotes = () => [];

		const traits = CharacterSheetNpcExporter._getArmorTraitBlock(state);
		expect(String(JSON.stringify(traits))).toMatch(/reduce incoming damage by 3/i);
		expect(String(JSON.stringify(traits))).toMatch(/lowered by 3/i);
	});
});
/**
 * v27 -- a material that resolved to nothing is said out loud.
 *
 * A material lives on an item as a `{name, source}` REFERENCE; the entity lives in the catalog.
 * `resolveMaterial` returns null both for a reference it cannot satisfy and for an item with no
 * material at all -- "absent" and "empty" wearing one face -- so every effect evaporates silently.
 *
 * The exporter already warned about this, but only for BUNDLED items: the check sat inside the
 * bundling loop, behind an `_isCompanionItem` gate and behind a `!tagged.size` early return. A
 * catalog item, or any item the statblock never tagged, lost its material in silence. That is the
 * third time a material code path has reached custom items only (cf. v25 suppression).
 */
maybeDescribe("NPC export v27 -- an unresolvable material is reported, not swallowed", () => {
	const catalogWeapon = (materialName) => ({
		id: "w-cat",
		item: {
			id: "w-cat",
			name: "Catalog Longsword",
			source: "XPHB",
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			baseItem: "longsword|xphb",
			dmg1: "1d8",
			dmgType: "S",
			material: {name: materialName, source: "TGTT"},
		},
		quantity: 1,
		equipped: true,
	});

	const warningsFor = (state) => {
		const monster = CharacterSheetNpcExporter.convertStateToMonster(state, {});
		const warnings = [];
		CharacterSheetNpcExporter.buildCompanionItems(monster, state, {sourceJson: "TEST", warnings});
		return warnings;
	};

	it("names the material when the catalog never loaded", () => {
		const state = makeState({items: [catalogWeapon("Adamantine")]});
		state.setItemMaterialCatalog([]);

		expect(warningsFor(state).join(" ")).toMatch(/catalog was not loaded[^]*Adamantine/i);
	});

	it("states an empty catalog once, not once per item", () => {
		// An empty catalog kills every material at the same time and has ONE fix. Repeating the
		// sentence per item buries the single action that resolves all of them.
		const state = makeState({
			items: [
				catalogWeapon("Adamantine"),
				{...catalogWeapon("Orichaline"), id: "w-cat2", item: {...catalogWeapon("Orichaline").item, id: "w-cat2", name: "Second Blade"}},
			],
		});
		state.setItemMaterialCatalog([]);

		expect(warningsFor(state).filter(w => /catalog was not loaded/i.test(w))).toHaveLength(1);
	});

	it("blames the reference, not the catalog, when the catalog is populated", () => {
		// The two causes need opposite fixes -- load the catalog vs. correct the name -- so they
		// must not share a sentence.
		const state = makeState({items: [catalogWeapon("Unobtanium")]});
		const joined = warningsFor(state).join(" ");

		expect(joined).toMatch(/"Unobtanium" is not among the \d+ known materials/i);
		expect(joined).toMatch(/Catalog Longsword/);
		expect(joined).not.toMatch(/catalog was not loaded/i);
	});

	it("says nothing when the material resolves, so the warning means something", () => {
		// The vacuity guard in the other direction: a warning that always fires is noise.
		const state = makeState({items: [catalogWeapon("Adamantine")]});

		expect(warningsFor(state)).toEqual([]);
	});

	it("covers items the bundle never reaches, which is the whole defect", () => {
		// A catalog weapon is not a companion item and is never bundled, so the pre-existing
		// provenance warning could not fire for it at all.
		const state = makeState({items: [catalogWeapon("Unobtanium")]});
		const monster = CharacterSheetNpcExporter.convertStateToMonster(state, {});
		const bundled = CharacterSheetNpcExporter.buildCompanionItems(monster, state, {sourceJson: "TEST", warnings: []});

		expect(bundled.map(b => b.name)).not.toContain("Catalog Longsword");
		expect(warningsFor(state).length).toBeGreaterThan(0);
	});

	it("does not describe the same item twice when the bundle already reported it", () => {
		// The partition. `_collectItemProvenanceWarnings` owns bundled items and says something
		// extra and true about them ("ships with base stats"); this pass owns the rest. Stating
		// it twice in one validation panel is the defect v26c guarded in the statblock.
		const state = makeState({items: [catalogWeapon("Unobtanium")]});
		const warnings = [];
		CharacterSheetNpcExporter._collectUnresolvedMaterialWarnings(
			state,
			warnings,
			new Set(["catalog longsword"]),
		);

		expect(warnings).toEqual([]);
	});
});
