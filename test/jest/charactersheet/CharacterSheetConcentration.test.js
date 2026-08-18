import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeTalent ({level = 5} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Talent", source: "TalPsi", level});
	state.setAbilityBase("int", 16);
	state.setAbilityBase("con", 14);
	state.setMaxHp(40);
	state.setCurrentHp(40);
	return state;
}

function makeWizard () {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 5});
	state.setAbilityBase("int", 16);
	state.setMaxHp(30);
	state.setCurrentHp(30);
	return state;
}

const power = (name, order = 2) => ({id: `power:${name}|TalPsi`, kind: "power", name, order});

describe("concentration — single-spell behaviour is unchanged", () => {
	it("reports one spell through the legacy getters", () => {
		const state = makeWizard();
		state.setConcentration("Haste", 3);
		expect(state.isConcentrating()).toBe(true);
		expect(state.getConcentration().spellName).toBe("Haste");
		expect(state.getConcentration().spellLevel).toBe(3);
		expect(state.getConcentratingSpell().name).toBe("Haste");
		expect(state.getConcentrationCount()).toBe(1);
	});

	it("replaces one spell with the next, never stacking them", () => {
		const state = makeWizard();
		state.setConcentration("Haste", 3);
		state.setConcentration("Fly", 3);
		expect(state.getConcentrationCount()).toBe(1);
		expect(state.getConcentration().spellName).toBe("Fly");
	});

	it("breaks cleanly", () => {
		const state = makeWizard();
		state.setConcentration("Haste", 3);
		state.breakConcentration();
		expect(state.isConcentrating()).toBe(false);
		expect(state.getConcentration()).toBeNull();
	});

	it("still exposes the Focused Spell reroll", () => {
		const state = makeWizard();
		state.setConcentration({name: "Haste", level: 3, appliedMetamagic: {key: "focused", name: "Focused Spell", cost: 1}});
		expect(state.canUseFocusedConcentrationReroll()).toBe(true);
		expect(state.useFocusedConcentrationReroll()).toBe(true);
		expect(state.canUseFocusedConcentrationReroll()).toBe(false);
	});
});

describe("concentration — powers stack up to the proficiency bonus", () => {
	it("holds several powers at once", () => {
		const state = makeTalent({level: 5}); // PB 3
		state.addConcentration(power("Apparition"));
		state.addConcentration(power("Caress of Fire"));
		expect(state.getConcentrationCount()).toBe(2);
		expect(state.getPowerConcentrations().map(c => c.name)).toEqual(["Apparition", "Caress of Fire"]);
	});

	it("drops the oldest power once the proficiency-bonus cap is reached", () => {
		const state = makeTalent({level: 5}); // PB 3
		["A", "B", "C"].forEach(n => state.addConcentration(power(n)));
		expect(state.getConcentrationCount()).toBe(3);

		const {dropped} = state.addConcentration(power("D"));
		expect(state.getConcentrationCount()).toBe(3);
		expect(dropped.map(c => c.name)).toEqual(["A"]);
		expect(state.getPowerConcentrations().map(c => c.name)).toEqual(["B", "C", "D"]);
	});

	it("drops the caller's nominated power instead when one is named", () => {
		const state = makeTalent({level: 5});
		["A", "B", "C"].forEach(n => state.addConcentration(power(n)));
		state.addConcentration(power("D"), {replaceId: "power:B|TalPsi"});
		expect(state.getPowerConcentrations().map(c => c.name)).toEqual(["A", "C", "D"]);
	});

	it("grows the cap as the proficiency bonus grows", () => {
		const state = makeTalent({level: 17}); // PB 6
		["A", "B", "C", "D", "E", "F"].forEach(n => state.addConcentration(power(n)));
		expect(state.getConcentrationCount()).toBe(6);
	});

	it("never holds two manifestations of the same power", () => {
		const state = makeTalent({level: 9});
		state.addConcentration(power("Apparition"));
		state.addConcentration({...power("Apparition"), order: 4});
		expect(state.getConcentrationCount()).toBe(1);
		expect(state.getPowerConcentrations()[0].order).toBe(4);
	});
});

describe("concentration — a power and a spell can never coexist", () => {
	it("drops the spell when a power is manifested", () => {
		const state = makeTalent({level: 5});
		state.setConcentration("Haste", 3);
		state.addConcentration(power("Apparition"));
		expect(state.getSpellConcentration()).toBeNull();
		expect(state.getPowerConcentrations()).toHaveLength(1);
	});

	it("drops every power when a spell is cast", () => {
		const state = makeTalent({level: 5});
		state.addConcentration(power("A"));
		state.addConcentration(power("B"));
		state.setConcentration("Haste", 3);
		expect(state.getPowerConcentrations()).toHaveLength(0);
		expect(state.getConcentrationCount()).toBe(1);
		expect(state.getSpellConcentration().spellName).toBe("Haste");
	});
});

describe("concentration — ending one without ending the rest", () => {
	it("drops only the named power", () => {
		const state = makeTalent({level: 5});
		state.addConcentration(power("A"));
		state.addConcentration(power("B"));
		state.breakConcentration("power:A|TalPsi");
		expect(state.getPowerConcentrations().map(c => c.name)).toEqual(["B"]);
	});

	it("drops everything when no id is given", () => {
		const state = makeTalent({level: 5});
		state.addConcentration(power("A"));
		state.addConcentration(power("B"));
		state.breakConcentration();
		expect(state.isConcentrating()).toBe(false);
	});

	it("ignores an unknown id rather than clearing the list", () => {
		const state = makeTalent({level: 5});
		state.addConcentration(power("A"));
		state.breakConcentration("power:Nope|TalPsi");
		expect(state.getConcentrationCount()).toBe(1);
	});

	it("answers whether a specific power is running", () => {
		const state = makeTalent({level: 5});
		state.addConcentration(power("A"));
		expect(state.isConcentratingOn("power:A|TalPsi")).toBe(true);
		expect(state.isConcentratingOn("power:B|TalPsi")).toBe(false);
	});
});

describe("concentration — saved characters migrate", () => {
	it("lifts a legacy single slot into the list on load", () => {
		const state = makeWizard();
		const json = state.toJson();
		json.concentrations = [];
		json.concentrating = {name: "Haste", spellName: "Haste", spellLevel: 3, startedAt: 1};

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		expect(loaded.isConcentrating()).toBe(true);
		expect(loaded.getConcentration().spellName).toBe("Haste");
		expect(loaded.getConcentration().kind).toBe("spell");
		expect(loaded.toJson().concentrating).toBeNull();
	});

	it("recognises a legacy custom-ability concentration", () => {
		const state = makeWizard();
		const json = state.toJson();
		json.concentrating = {name: "My Aura", customAbilityId: "abc", startedAt: 1};

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		expect(loaded.getConcentration().kind).toBe("ability");
		expect(loaded.getConcentration().customAbilityId).toBe("abc");
	});

	it("survives a save with no concentration data at all", () => {
		const json = makeWizard().toJson();
		delete json.concentrating;
		delete json.concentrations;
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		expect(loaded.isConcentrating()).toBe(false);
		expect(loaded.getConcentrations()).toEqual([]);
	});

	it("round-trips several concentrated powers", () => {
		const state = makeTalent({level: 5});
		state.addConcentration(power("A"));
		state.addConcentration(power("B"));

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getPowerConcentrations().map(c => c.name)).toEqual(["A", "B"]);
	});
});

describe("concentration — capacity for non-manifesters", () => {
	it("treats a wizard's power capacity as one, so nothing can stack", () => {
		const state = makeWizard();
		state.addConcentration(power("A"));
		state.addConcentration(power("B"));
		expect(state.getConcentrationCount()).toBe(1);
	});
});

describe("concentration — the spellName display alias", () => {
	it("gives a power a spellName so legacy displays don't render it as Unknown", () => {
		const state = makeTalent({level: 5});
		state.addConcentration(power("Apparition"));
		// Seven pre-existing render sites read `.spellName` off `getConcentration()`.
		expect(state.getConcentration().spellName).toBe("Apparition");
	});

	it("leaves a custom ability's spellName null, as the custom-ability contract requires", () => {
		const state = makeWizard();
		state.addConcentration({id: "ability:abc", kind: "ability", name: "Aura of Protection", spellName: null, customAbilityId: "abc"});
		const conc = state.getConcentration();
		expect(conc.customAbilityId).toBe("abc");
		expect(conc.spellName).toBeFalsy();
	});
});
