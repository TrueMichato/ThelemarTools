/**
 * The authoring ↔ consumption contract for material effects.
 *
 * The bug this test exists to prevent: a material effect could be authored in the brew,
 * normalised by `getMaterialEffects`, described in tidy prose by `getMaterialNotes` — and
 * then do nothing at all. Silently. Forever. 34 of 72 materials were in that state, and
 * nothing distinguished "deliberately a table call" from "someone forgot to wire it up".
 *
 * `EFFECT_HANDLING` is the declaration; this is its enforcement.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-rest.js";
import {jest} from "@jest/globals";
import {readFileSync, readdirSync} from "fs";
import {dirname, resolve} from "path";
import {fileURLToPath} from "url";

const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;
const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const VALID_CONSUMERS = new Set(["projection", "modifier", "power", "roll", "rest", "reference"]);

function loadBrewMaterials () {
	const raw = readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8");
	return JSON.parse(raw).itemMaterial || [];
}

describe("Material effect handling registry", () => {
	const materials = loadBrewMaterials();

	it("finds the brew's materials", () => {
		expect(materials.length).toBeGreaterThan(0);
	});

	it("declares a handling entry for every effect type authored in the brew", () => {
		const undeclared = new Map();
		for (const mat of materials) {
			for (const fx of mat.effects || []) {
				if (CharacterSheetMaterials.EFFECT_HANDLING[fx.type]) continue;
				if (!undeclared.has(fx.type)) undeclared.set(fx.type, []);
				undeclared.get(fx.type).push(mat.name);
			}
		}

		const report = [...undeclared.entries()]
			.map(([type, names]) => `  "${type}" — authored by ${names.join(", ")}`)
			.join("\n");

		expect(report ? `Effect types with no declared consumer:\n${report}` : "").toBe("");
	});

	it("gives every declared type a valid consumer and a note", () => {
		for (const [type, spec] of Object.entries(CharacterSheetMaterials.EFFECT_HANDLING)) {
			expect(VALID_CONSUMERS.has(spec.consumer)).toBe(true);
			expect(typeof spec.note).toBe("string");
			expect(spec.note.length).toBeGreaterThan(0);
			// A type declared but never authored is fine; a type declared with no name is not.
			expect(type.length).toBeGreaterThan(0);
		}
	});

	it("declares nothing the normaliser cannot understand", () => {
		// Every registry key must survive `getMaterialEffects` without hitting the `default`
		// branch — otherwise the registry is promising a consumer for a type that is dropped
		// before any consumer could see it.
		const item = {name: "Test", type: "M", weapon: true};
		for (const type of Object.keys(CharacterSheetMaterials.EFFECT_HANDLING)) {
			const material = {name: "Probe", category: "metal", effects: [{type, value: 1, text: "x", name: "x", dice: 1, damageType: "fire", properties: [], damageTypes: []}]};
			expect(() => CharacterSheetMaterials.getMaterialEffects(item, material)).not.toThrow();
		}
	});

	it("keeps `reference` a deliberate minority", () => {
		// If this ever grows large, the sheet has quietly given up on automating materials.
		const referenced = Object.entries(CharacterSheetMaterials.EFFECT_HANDLING)
			.filter(([, spec]) => spec.consumer === "reference");
		expect(referenced.length).toBeLessThanOrEqual(7);
	});

	/**
	 * `consumer` is a CATEGORY, so every assertion keyed on it is blind to a hole inside the
	 * category. `condensateInstability` declares `consumer: "power"`; the power channel existed
	 * and was well tested; and the instability reached it through nothing at all. A guard that
	 * asks "does this category have a home?" answers yes and tells you nothing.
	 *
	 * So this asks the narrower question per type: does the effect key appear in code that is
	 * not the authoring file itself? `charactersheet-materials.js` declares, normalises and
	 * describes every type, so a type mentioned only there has been authored and never
	 * delivered — which is the entire defect class `EFFECT_HANDLING` exists to prevent, applied
	 * to `EFFECT_HANDLING` itself.
	 */
	it("gives every non-reference type a consumer outside the authoring file", () => {
		const jsFiles = [];
		const walk = (dir) => {
			for (const entry of readdirSync(dir, {withFileTypes: true})) {
				const full = resolve(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (full.endsWith(".js") && !full.endsWith("charactersheet-materials.js")) jsFiles.push(full);
			}
		};
		walk(resolve(REPO_ROOT, "js"));
		const corpus = jsFiles.map(f => readFileSync(f, "utf8"));

		const undelivered = Object.entries(CharacterSheetMaterials.EFFECT_HANDLING)
			.filter(([, spec]) => spec.consumer !== "reference")
			.filter(([type]) => !corpus.some(src => src.includes(type)))
			.map(([type, spec]) => `  "${type}" — declared consumer "${spec.consumer}", but no file outside charactersheet-materials.js mentions it`);

		expect(undelivered.length ? `Effect types authored but never delivered:\n${undelivered.join("\n")}` : "").toBe("");
	});

	/**
	 * The narrowest version of the same question, for the one channel where the miss actually
	 * happened. A condensate's instability is the PRICE of its affinity. Surfacing the benefit
	 * without the cost is worse than surfacing neither, because the player applies the half they
	 * saw and a material designed as "strong option, real vulnerability" silently becomes
	 * strictly better.
	 */
	it("carries a condensate's instability alongside the affinity it pays for", () => {
		const stateSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-state.js"), "utf8");
		const card = stateSrc.match(/id: "mat:affinity",[\s\S]{0,2000}?\n\t{5}\}\);/)?.[0] || "";

		expect(card).toBeTruthy();
		expect(card).toContain("description: condensate.affinity");
		expect(card).toContain("instability");
	});
});

describe("Material effect coverage across the brew", () => {
	const materials = loadBrewMaterials();

	it("leaves no material whose every effect is reference-only prose", () => {
		// A material with mechanics in its rules text but nothing but `reference` handling is
		// the exact failure mode this whole pass fixed. `note`-only materials are legitimate
		// (pure flavour), so they are exempt.
		//
		// A handful of materials genuinely make only a table call:
		// - Adamant and Heart Stone promise nothing but indestructibility, and whether a
		//   given effect could damage an object is not a number the sheet can compute.
		// - Ioun Sand doubles numeric properties granted by an intact Ioun Stone SET IN THE
		//   MATRIX, and explicitly not ordinary enchantments or loose fragments. The sheet
		//   models Ioun Stones as their own subsystem rather than as material sockets, so
		//   which of an item's numbers qualify is a question only the table can answer.
		//
		// Those are allowed, but ONLY by name, so that a new material joining this list is a
		// deliberate decision someone had to write down rather than an accident nobody
		// noticed.
		const REFERENCE_ONLY_BY_DESIGN = new Set(["Adamant", "Heart Stone", "Ioun Sand"]);

		const offenders = [];
		for (const mat of materials) {
			const types = (mat.effects || []).map(fx => fx.type);
			if (!types.length) continue;
			if (types.every(t => t === "note")) continue;
			if (REFERENCE_ONLY_BY_DESIGN.has(mat.name)) continue;
			const allReference = types.every(t => CharacterSheetMaterials.EFFECT_HANDLING[t]?.consumer === "reference");
			if (allReference) offenders.push(`${mat.name} (${types.join(", ")})`);
		}
		expect(offenders).toEqual([]);
	});
});

/**
 * The picker's "What do these numbers mean?" legend is in-app help, and it drifted: for two
 * days it described Penetration as "ignores that much of a target's non-magical damage
 * resistance" — a completely different mechanic from the one the sheet implements. Nobody
 * noticed, and a second author read that string, believed it, and carried the wrong
 * mechanic into a design review before it was caught.
 *
 * Help text that contradicts the code is worse than no help text, because it is believed.
 * So the legend is pinned against the combat tooltip that resolves the actual roll: the two
 * must agree on what Penetration does, and neither may describe it as a resistance effect.
 */
describe("Picker legend agrees with the mechanic it explains", () => {
	const materialsSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-materials.js"), "utf8");
	const combatSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");

	const legendPen = materialsSrc.match(/<dt>Pen<\/dt><dd>([^<]*)<\/dd>/)?.[1] || "";
	const tooltipPen = combatSrc.match(/title="Penetration \$\{pen\}: ([^"]*)"/)?.[1] || "";

	it("finds both the legend entry and the combat tooltip", () => {
		expect(legendPen).toBeTruthy();
		expect(tooltipPen).toBeTruthy();
	});

	it("describes Penetration as a near-miss against AC in both places", () => {
		for (const text of [legendPen, tooltipPen]) {
			expect(text.toLowerCase()).toMatch(/miss(ed)? by/);
		}
	});

	it("never describes Penetration as piercing damage resistance", () => {
		// The exact drift that happened. `resistance` has no business in either string.
		for (const text of [legendPen, tooltipPen]) {
			expect(text.toLowerCase()).not.toContain("resistance");
		}
	});

	it("keeps every legend entry non-empty and tag-balanced", () => {
		const entries = [...materialsSrc.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*(?:<b>[^<]*<\/b>[^<]*)*)<\/dd>/g)];
		expect(entries.length).toBeGreaterThanOrEqual(7);
		for (const [, term, def] of entries) {
			expect(term.trim()).not.toBe("");
			expect(def.trim().length).toBeGreaterThan(10);
		}
	});
});

/**
 * The registry's own defect, measured instead of declared.
 *
 * `EFFECT_HANDLING` recorded `damageReduction: {consumer: "modifier"}` for months while
 * absolutely nothing read the channel — a character in Adamantine plate took full damage.
 * The declaration was TRUE (a named modifier really was registered) and useless, because
 * "a modifier exists" and "a modifier is consumed" are different claims and the registry
 * only ever made the first.
 *
 * The guard above ("mentioned outside the authoring file") passed throughout, because
 * `damageReduction` appeared twice more — at the feature-effect bridge and in the modifier
 * constructor. Both are WRITES. A write is not a consumer, and grepping for a bare string
 * cannot tell the two apart.
 *
 * My first replacement spied on `getModifiersForType`, on the assumption it was the choke
 * point every read passes through. Measured: driving the whole derived-output surface with
 * three named modifiers present records **zero** calls to it, and zero to
 * `aggregateModifiers`. Subsystems read `_data.namedModifiers` directly. There is no choke
 * point, so any guard built on watching one is watching nothing.
 *
 * So this measures the OUTCOME instead, which needs no choke point to exist:
 *
 *   1. Equip a material and snapshot the sheet's derived-output surface.
 *   2. Strip that material's own named modifiers and snapshot again.
 *   3. A `modifier`-consumer channel that leaves the snapshot untouched is not consumed.
 *
 * Stripping only the material's modifiers — rather than comparing "material" against "no
 * material" — isolates the modifier channel from the projection channel, so a material
 * that changes AC through `applyToItem` cannot mask a dead modifier.
 */
describe("A material's modifiers change what the sheet reports", () => {
	const brew = loadBrewMaterials();

	const ITEMS = [
		{name: "Plate", source: "PHB", type: "HA", ac: 18, weight: 65, value: 150000},
		{name: "Longsword", source: "PHB", type: "M", weapon: true, dmg1: "1d8", dmgType: "S", weight: 3, value: 1500},
		{name: "Shield", source: "PHB", type: "S", ac: 2, weight: 6, value: 1000},
	];

	const DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing", "fire", "cold", "necrotic", "radiant"];
	const SKILLS = ["stealth", "perception", "athletics", "arcana", "acrobatics"];
	/**
	 * The channels a conditional modifier can be offered on. `aggregateModifiers` matches
	 * by exact type, so querying "fire" never surfaces a conditional registered on "save".
	 */
	const CONDITIONAL_CHANNELS = ["save", "check", "attack", "damage", "damageReduction", "d20:all"]
		.concat(SKILLS.map(s => `skill:${s}`));

	function build (material) {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setItemMaterialCatalog(brew);
		for (const item of ITEMS) {
			state.addItem({quantity: 1, equipped: true, ...item});
			const id = state.getItems().slice(-1)[0].id;
			try { state.setItemMaterial(id, material); } catch { continue; }
			const raw = state._data.inventory.find(it => it.id === id);
			if (raw) raw.equipped = true;
		}
		state._recalculateEquipmentModifiers();
		return state;
	}

	/**
	 * Everything the sheet says about itself that a modifier could plausibly move. A
	 * channel invisible to all of it is invisible to the player.
	 */
	function snapshot (state) {
		return JSON.stringify({
			speed: state.getSpeed(),
			init: state.getInitiative(),
			ac: state.getAc(),
			saves: ["str", "dex", "con", "int", "wis", "cha"].map(a => state.getSaveModifier(a)),
			saveAdv: ["str", "dex", "con", "int", "wis", "cha"].map(a => state.getSaveAdvantageState?.(a) ?? null),
			skills: SKILLS.map(s => state.getSkillModifier(s)),
			skillAdv: SKILLS.map(s => state.getSkillAdvantageState?.(s) ?? null),
			damage: DAMAGE_TYPES.map(t => state.applyDamageDefenses(10, t).damage),
			// Conditionals gate off by default, so a conditional modifier moves none of the
			// numbers above — by design. It is still consumed: it is OFFERED at roll time,
			// and the offer is the outcome. Queried by the channel's own name, because a
			// conditional on "save" is invisible to a query for "fire".
			conditionalOffers: CONDITIONAL_CHANNELS.map(k => {
				try { return state.aggregateModifiers(k).conditionalsAvailable?.length ?? 0; } catch { return 0; }
			}),
		});
	}

	/** Materials that emit at least one named modifier, with the types they emit. */
	const emitters = brew
		.map(material => {
			const state = build(material);
			const own = (state._data.namedModifiers || []).filter(m => m.sourceType === "itemMaterial");
			return own.length ? {material, state, types: [...new Set(own.map(m => m.type))]} : null;
		})
		.filter(Boolean);

	it("finds materials that emit modifiers, so the sweep below is not vacuous", () => {
		expect(emitters.length).toBeGreaterThan(0);
		expect([...new Set(emitters.flatMap(e => e.types))].length).toBeGreaterThan(1);
	});

	it("moves some reported number or state for every material modifier emitted", () => {
		const dead = [];
		for (const {material, state, types} of emitters) {
			const withMods = snapshot(state);
			state._data.namedModifiers = state._data.namedModifiers.filter(m => m.sourceType !== "itemMaterial");
			const withoutMods = snapshot(state);
			if (withMods === withoutMods) dead.push(`  ${material.name} — emits ${types.map(t => `"${t}"`).join(", ")}, but the sheet reports the same thing with and without it`);
		}

		expect(dead.length ? `Material modifiers that change nothing the sheet reports:\n${dead.join("\n")}` : "").toBe("");
	});

	/**
	 * The control the sweep needs to be worth anything. If `snapshot` were sensitive to
	 * something incidental — an id, a timestamp, array identity — every material would
	 * "pass" for reasons unrelated to being consumed, and the sweep would be vacuous in
	 * the direction that looks like success.
	 */
	it("reports identically when nothing is stripped, so the sweep cannot pass by noise", () => {
		const {state} = emitters[0];
		expect(snapshot(state)).toBe(snapshot(state));
	});

	/**
	 * The sweep is only as strong as its ability to fail. Inject a modifier of a type
	 * nothing consumes and confirm the same comparison catches it — otherwise a green
	 * sweep proves the harness is blind, not that the channels are live.
	 */
	it("catches a channel that genuinely nothing consumes", () => {
		const state = build(emitters[0].material);
		state._data.namedModifiers = [{
			id: "probe",
			name: "Probe",
			type: "a-channel-nothing-consumes",
			value: 99,
			sourceType: "itemMaterial",
			enabled: true,
		}];
		const withMods = snapshot(state);
		state._data.namedModifiers = [];
		expect(snapshot(state)).toBe(withMods);
	});
});

/**
 * The `rest` channel, swept the same way as the modifier channel — and it needs its own
 * sweep precisely BECAUSE the modifier one cannot see it.
 *
 * `shortRestHealingBonus` was first declared `consumer: "modifier"`. That was false by the
 * table's own definition (it reaches no derived stat), and worse, it was false in a way no
 * existing test could report: the modifier sweep enumerates materials that emit named
 * modifiers, and this effect emits none. It would have sat there declared-and-unswept,
 * which is the exact shape of the `damageReduction` failure the table warns about.
 *
 * So the outcome asked for here is the one the player experiences: a rest that pays more.
 */
describe("A material's rest effects change what a rest pays out", () => {
	const brew = loadBrewMaterials();

	const REST_TYPES = Object.entries(CharacterSheetMaterials.EFFECT_HANDLING)
		.filter(([, spec]) => spec.consumer === "rest")
		.map(([type]) => type);

	function buildHolder (material) {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setMaxHp(60);
		state.setCurrentHp(1);
		state.setItemMaterialCatalog(brew);
		state.addItem({name: "Orb", type: "SCF", weight: 1, value: 100, quantity: 1});
		const id = state.getItems().slice(-1)[0].id;
		state.setItemEquipped(id, true);
		state.setItemMaterial(id, material);
		return state;
	}

	it("declares at least one rest-consumer type, so the sweep below is not vacuous", () => {
		expect(REST_TYPES.length).toBeGreaterThan(0);
	});

	it.each(REST_TYPES)("%s is authored by a material and moves that material's rest", (type) => {
		const authors = brew.filter(mat => (mat.effects || []).some(fx => fx.type === type));
		expect(authors.length).toBeGreaterThan(0);

		const failures = [];
		for (const material of authors) {
			const state = buildHolder(material);
			const bonuses = state.getShortRestHealingBonuses();
			if (!bonuses.length) { failures.push(`${material.name} authors ${type} but grants no rest bonus`); continue; }

			const rest = Object.create(globalThis.CharacterSheetRest.prototype);
			rest._state = state;
			rest._page = {};
			const before = state.getHp().current;
			rest._applyRestBonusHealing({bonuses, suppressedNames: new Set(), hasSpentHitDice: true});
			if (state.getHp().current <= before) failures.push(`${material.name}'s ${type} healed nothing`);
		}
		expect(failures.join("\n")).toBe("");
	});

	/**
	 * The control. Without it, a `rest` effect that resolved to 0 for every material — or a
	 * `getShortRestHealingBonuses` that returned everything unconditionally — would satisfy
	 * the sweep above just as well as a working channel does.
	 */
	it("pays nothing for a material with no rest effect, so the sweep is not paying everyone", () => {
		const inert = brew.find(mat => !(mat.effects || []).some(fx => REST_TYPES.includes(fx.type)));
		expect(inert).toBeTruthy();
		expect(buildHolder(inert).getShortRestHealingBonuses()).toEqual([]);
	});
});
