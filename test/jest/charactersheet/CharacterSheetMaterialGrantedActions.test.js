/**
 * Material-granted actions become real item powers.
 *
 * Three materials grant the player something to *do* — Stout Blackwood's Shove, Yellowwood's
 * Flurry, Smokestone's smoke Cloud — and until now all three lived only as a sentence in the
 * item-info modal. They are now item powers, so they inherit equip and attunement gating and
 * appear in the Actions hub next to everything else the character can do.
 *
 * Two design rules are pinned here because both are easy to get wrong:
 *
 * - **An authored `actionType` is what makes a power activatable.** It is the author declaring
 *   a discrete action cost. Without one the effect rides on something the player is already
 *   doing (an extra attack, a contest on a hit), which the sheet cannot resolve from a button —
 *   so it is surfaced as explicitly reference-only rather than as a button that pretends.
 * - **`requiresProperty` removes the power, it does not disable it.** A stout blackwood dagger
 *   does not have an unavailable Shove; it never had one.
 *
 * That first rule is about *code*, and the code always followed it. The Flurry was nonetheless
 * unusable for the whole life of this suite, because the rule can only read what the brew
 * declares and the brew declared nothing — while the Flurry's own prose said "you can use a
 * bonus action to attack again". The data contradicted itself, and a correctly-implemented
 * rule faithfully carried the contradiction through. The final describe below guards the data
 * against its own prose, which is the one direction no code-side check can see.
 *
 * Role-scoping is inherited rather than re-implemented: a Smokestone *weapon* is ordinary dense
 * stone, and only a Smokestone *focus* gets the cloud. That gate already lives in
 * `getMaterialEffects`, and this suite proves it survives the trip through `getItemPowers`.
 */

import {describe, expect, it, beforeEach} from "@jest/globals";
import {readFileSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;
const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BREW = JSON.parse(readFileSync(join(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const CATALOG = BREW.itemMaterial;

const getMaterial = name => CATALOG.find(it => it.name === name);

const makeState = () => {
	const st = new CharacterSheetState();
	st.setItemMaterialCatalog(CATALOG);
	return st;
};

/** Add an item, give it a material, and equip it. Returns the item id. */
const addMaterialItem = (st, {name, materialName, property = [], type = "M", equipped = true, ...rest}) => {
	st.addItem({quantity: 1, name, source: "TGTT", type, property, weapon: type === "M" || type === "R", ...rest});
	const id = st.getItems().slice(-1)[0].id;
	if (materialName) st.setItemMaterial(id, getMaterial(materialName));
	const raw = st._data.inventory.find(it => it.id === id);
	if (raw) raw.equipped = equipped;
	st._recalculateEquipmentModifiers();
	return id;
};

const materialPowers = st => st.getItemPowers().filter(p => p.materialPower);

describe("Material-granted actions become item powers", () => {
	let st;
	beforeEach(() => { st = makeState(); });

	it("surfaces nothing for an item with no material", () => {
		st.addItem({quantity: 1, name: "Plain Greatsword", type: "M", property: ["2H"], weapon: true});
		expect(materialPowers(st)).toEqual([]);
	});

	it("grants Smokestone Cloud from a smokestone focus", () => {
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", weapon: false});
		const powers = materialPowers(st);
		expect(powers.map(p => p.name)).toContain("Smokestone Cloud");
	});

	it("carries the authored rules text as the power's description", () => {
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", weapon: false});
		const power = materialPowers(st).find(p => p.name === "Smokestone Cloud");
		expect(power.description).toMatch(/heavily obscuring smoke/i);
	});

	it("names the material the power came from", () => {
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", weapon: false});
		const power = materialPowers(st).find(p => p.name === "Smokestone Cloud");
		expect(power.materialName).toBe("Smokestone");
		expect(power.itemName).toBe("Smokestone Orb");
	});

	it("makes an authored actionType the power's action cost", () => {
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", weapon: false});
		const power = materialPowers(st).find(p => p.name === "Smokestone Cloud");
		expect(power.actionType).toBe("bonus");
		expect(power.isReferenceOnly).toBe(false);
		expect(power.isAvailable).toBe(true);
	});
});

describe("An action with no declared cost is reference-only, not a fake button", () => {
	let st;
	beforeEach(() => { st = makeState(); });

	// This block used Yellowwood Flurry as its exemplar, which was the wrong
	// choice: the Flurry's prose says "you can use a bonus action to attack
	// again", so it has always had a declared cost in English. It was
	// reference-only only because the brew never carried `actionType`, and
	// pinning that state recorded an authoring gap as if it were a design
	// decision. Stout Blackwood's Shove is the honest exemplar — it rides on a
	// hit you already made and there is no cost to declare.
	it("marks Stout Blackwood Shove reference-only", () => {
		addMaterialItem(st, {name: "Stout Blackwood Maul", materialName: "Stout Blackwood", property: ["2H"]});
		const power = materialPowers(st).find(p => p.name === "Stout Blackwood Shove");
		expect(power).toBeTruthy();
		expect(power.isReferenceOnly).toBe(true);
	});

	it("explains itself with the standard reference-only message", () => {
		addMaterialItem(st, {name: "Stout Blackwood Maul", materialName: "Stout Blackwood", property: ["2H"]});
		const power = materialPowers(st).find(p => p.name === "Stout Blackwood Shove");
		expect(power.isAvailable).toBe(false);
		expect(power.unavailableReason).toBe("Rules reference only; resolve this effect manually.");
	});

	it("still carries its full rules text so the reference is usable", () => {
		addMaterialItem(st, {name: "Stout Blackwood Maul", materialName: "Stout Blackwood", property: ["2H"]});
		const power = materialPowers(st).find(p => p.name === "Stout Blackwood Shove");
		expect(power.description).toMatch(/knock it prone or push it 5 feet/i);
	});
});

describe("Yellowwood Flurry costs a bonus action, because its own text says so", () => {
	let st;
	beforeEach(() => { st = makeState(); });

	it("is activatable rather than reference-only", () => {
		addMaterialItem(st, {name: "Yellowwood Club", materialName: "Yellowwood"});
		const power = materialPowers(st).find(p => p.name === "Yellowwood Flurry");

		expect(power.actionType).toBe("bonus");
		expect(power.isReferenceOnly).toBe(false);
		expect(power.isAvailable).toBe(true);
	});

	it("still carries its full rules text", () => {
		addMaterialItem(st, {name: "Yellowwood Club", materialName: "Yellowwood"});
		const power = materialPowers(st).find(p => p.name === "Yellowwood Flurry");
		expect(power.description).toMatch(/bonus action to attack again/i);
	});

	// The shape that matters: it must be indistinguishable from a power that
	// was authored with a cost from the start, or the Actions hub will render
	// it as a second-class entry.
	it("has the same shape as a power authored with a cost from the start", () => {
		addMaterialItem(st, {name: "Yellowwood Club", materialName: "Yellowwood"});
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", weapon: false});

		const flurry = materialPowers(st).find(p => p.name === "Yellowwood Flurry");
		const cloud = materialPowers(st).find(p => p.name === "Smokestone Cloud");

		expect(flurry.actionType).toBe(cloud.actionType);
		expect(flurry.isReferenceOnly).toBe(cloud.isReferenceOnly);
		expect(flurry.isAvailable).toBe(cloud.isAvailable);
		expect(flurry.unavailableReason).toBe(cloud.unavailableReason);
	});
});

describe("a granted action whose prose names a cost must declare that cost", () => {
	// EFFECT_HANDLING guards code against its own declarations. Nothing guarded
	// the DATA against its own prose, which is how the Flurry stated a bonus
	// action in English while the sheet treated it as having no cost at all.
	// The rule was followed correctly; the entry was simply incomplete, and no
	// code-side guard can see that.
	const ECONOMY_PATTERNS = [
		[/\buse a bonus action\b|\bas a bonus action\b/i, "bonus"],
		[/\bas an action\b|\buse an action\b/i, "action"],
		[/\bas a reaction\b|\buse your reaction\b/i, "reaction"],
	];

	const grantedActions = CATALOG.flatMap(material =>
		(material.effects || [])
			.filter(fx => fx.type === "grantsAction")
			.map(fx => ({material: material.name, ...fx})));

	it("finds the granted actions at all (the walk is not vacuous)", () => {
		expect(grantedActions.length).toBeGreaterThanOrEqual(9);
	});

	it.each(ECONOMY_PATTERNS.map(([pattern, expected]) => [expected, pattern]))(
		"every power whose text says %s declares it",
		(expected, pattern) => {
			const undeclared = grantedActions
				.filter(fx => pattern.test(fx.note || ""))
				.filter(fx => !fx.actionType)
				.map(fx => `${fx.material}: ${fx.name}`);

			expect(undeclared).toEqual([]);
		},
	);

	// The implication runs one way only, and the brew proves it: every power
	// authored with an `action` or `reaction` cost describes only its TRIGGER
	// ("When an attack hits you...", "Immediately after being hit..."), never
	// the cost. Their economy exists solely as structured data. So a guard
	// requiring prose to name the cost would be wrong in that direction.
	//
	// Pinning which patterns currently fire keeps that asymmetry a recorded
	// fact rather than an unexamined one. If a future entry states "as an
	// action" in its text, this fails and someone looks — which is the point.
	// A bare "no pattern is dead" assertion would instead have forced the
	// patterns to be trimmed to whatever happens to match today.
	it("records which economies are currently stated in prose", () => {
		const live = ECONOMY_PATTERNS
			.filter(([pattern]) => grantedActions.some(fx => pattern.test(fx.note || "")))
			.map(([, expected]) => expected);

		expect(live).toEqual(["bonus"]);
	});

	it("a declared cost does not have to be repeated in the prose", () => {
		const declaredNotInProse = grantedActions
			.filter(fx => fx.actionType === "reaction")
			.filter(fx => !/\bas a reaction\b|\buse your reaction\b/i.test(fx.note || ""));

		// All three reaction powers are in this state, deliberately.
		expect(declaredNotInProse.length).toBeGreaterThanOrEqual(3);
	});
});

describe("requiresProperty removes the action rather than disabling it", () => {
	let st;
	beforeEach(() => { st = makeState(); });

	it("grants Stout Blackwood Shove on a two-handed weapon", () => {
		addMaterialItem(st, {name: "Blackwood Greatclub", materialName: "Stout Blackwood", property: ["2H"]});
		expect(materialPowers(st).map(p => p.name)).toContain("Stout Blackwood Shove");
	});

	it("grants nothing on a one-handed weapon of the same material", () => {
		addMaterialItem(st, {name: "Blackwood Club", materialName: "Stout Blackwood", property: ["L"]});
		expect(materialPowers(st).map(p => p.name)).not.toContain("Stout Blackwood Shove");
	});

	it("reads the object property form as well as the string form", () => {
		addMaterialItem(st, {name: "Blackwood Maul", materialName: "Stout Blackwood", property: [{uid: "2H|XPHB"}]});
		expect(materialPowers(st).map(p => p.name)).toContain("Stout Blackwood Shove");
	});

	it("reads a sourced string property", () => {
		addMaterialItem(st, {name: "Blackwood Pike", materialName: "Stout Blackwood", property: ["2H|XPHB"]});
		expect(materialPowers(st).map(p => p.name)).toContain("Stout Blackwood Shove");
	});
});

describe("Condensate role-scoping is inherited, not re-implemented", () => {
	let st;
	beforeEach(() => { st = makeState(); });

	it("does not grant the smoke cloud to a smokestone WEAPON", () => {
		addMaterialItem(st, {name: "Smokestone Mace", materialName: "Smokestone", property: ["2H"]});
		expect(materialPowers(st).map(p => p.name)).not.toContain("Smokestone Cloud");
	});
});

describe("Equip and attunement gating", () => {
	let st;
	beforeEach(() => { st = makeState(); });

	it("reports an unequipped item's power as unavailable", () => {
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", weapon: false, equipped: false});
		const power = materialPowers(st).find(p => p.name === "Smokestone Cloud");
		expect(power.isAvailable).toBe(false);
		expect(power.unavailableReason).toBe("Equip this item to use its powers.");
	});

	it("omits an unequipped item's power under activeOnly", () => {
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", weapon: false, equipped: false});
		expect(st.getItemPowers({activeOnly: true}).filter(p => p.materialPower)).toEqual([]);
	});

	it("blocks on attunement before it blocks on reference-only", () => {
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", weapon: false, reqAttune: true, requiresAttunement: true});
		const power = materialPowers(st).find(p => p.name === "Smokestone Cloud");
		expect(power.unavailableReason).toBe("Attune to this item to use its powers.");
	});
});

describe("Power identity", () => {
	let st;
	beforeEach(() => { st = makeState(); });

	it("gives each granted action a stable, material-scoped id", () => {
		addMaterialItem(st, {name: "Yellowwood Club", materialName: "Yellowwood"});
		const power = materialPowers(st).find(p => p.name === "Yellowwood Flurry");
		expect(power.id).toBe("mat:yellowwood-flurry");
	});

	it("keeps the same id across repeated reads", () => {
		addMaterialItem(st, {name: "Yellowwood Club", materialName: "Yellowwood"});
		const first = materialPowers(st).map(p => p.id);
		const second = materialPowers(st).map(p => p.id);
		expect(second).toEqual(first);
	});

	it("does not collide with an item's own powers", () => {
		addMaterialItem(st, {name: "Yellowwood Club", materialName: "Yellowwood"});
		const ids = st.getItemPowers().map(p => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("getItemMaterialNotes accessor", () => {
	let st;
	beforeEach(() => { st = makeState(); });

	it("returns nothing for an item without a material", () => {
		st.addItem({quantity: 1, name: "Plain Club", type: "M", weapon: true});
		const id = st.getItems().slice(-1)[0].id;
		expect(st.getItemMaterialNotes(id)).toEqual([]);
	});

	it("returns nothing for an unknown item id", () => {
		expect(st.getItemMaterialNotes("no-such-item")).toEqual([]);
	});

	it("returns labelled notes for a material item", () => {
		const id = addMaterialItem(st, {name: "Adamantine Axe", materialName: "Adamantine", property: ["2H"]});
		const notes = st.getItemMaterialNotes(id);
		expect(notes.length).toBeGreaterThan(0);
		for (const note of notes) {
			expect(typeof note.label).toBe("string");
			expect(typeof note.description).toBe("string");
			expect(["passive", "active", "reactive", "drawback"]).toContain(note.type);
		}
	});

	it("agrees with the underlying materials helper", () => {
		const id = addMaterialItem(st, {name: "Adamantine Axe", materialName: "Adamantine", property: ["2H"]});
		const raw = st._data.inventory.find(it => it.id === id);
		const direct = CharacterSheetMaterials.getMaterialNotes(raw.item || raw, getMaterial("Adamantine"));
		expect(st.getItemMaterialNotes(id)).toEqual(direct);
	});

	it("returns nothing when the materials setting is off", () => {
		const id = addMaterialItem(st, {name: "Adamantine Axe", materialName: "Adamantine", property: ["2H"]});
		st._data.settings = {...(st._data.settings || {}), enableMaterials: false};
		expect(st.getItemMaterialNotes(id)).toEqual([]);
	});
});
