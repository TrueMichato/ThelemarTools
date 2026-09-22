import fs from "node:fs";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function makeState ({equipped = true} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level: 5,
		subclass: {name: "Artillerist", shortName: "Artillerist", source: "EFA"},
	});
	state.addItem({
		id: "firearm",
		name: "Longbow",
		source: "XPHB",
		type: "R",
		weapon: true,
		weaponCategory: "martial",
		property: ["A"],
		isMelee: false,
		quantity: 1,
		equipped,
		_isCustom: true,
	});
	state.setItemEquipped("firearm", equipped);
	state.setEfaArcaneFirearmBinding("firearm");
	return state;
}

function makeElement ({tag = "div", clazz = "", txt = ""} = {}) {
	return {
		tagName: tag.toUpperCase(),
		className: clazz,
		textContent: txt,
		children: [],
		appendChild (child) {
			this.children.push(child);
			return child;
		},
	};
}

function collectText (element) {
	return [element.textContent || "", ...(element.children || []).map(collectText)].join(" ");
}

describe("EFA Arcane Firearm UI contract", () => {
	const savedDocument = globalThis.document;
	const savedElementFactory = globalThis.e_;

	afterEach(() => {
		globalThis.document = savedDocument;
		globalThis.e_ = savedElementFactory;
	});

	it("renders the carved item and an actionable inactive status without an out-of-rest recarve control", () => {
		const state = makeState({equipped: false});
		const section = {style: {display: "none"}};
		const container = {
			innerHTML: "",
			children: [],
			appendChild (child) { this.children.push(child); },
		};
		globalThis.document = {
			getElementById: id => ({
				"charsheet-combat-arcane-firearm-section": section,
				"charsheet-combat-arcane-firearm": container,
			})[id] || null,
		};
		globalThis.e_ = options => makeElement(options);
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;

		combat.renderCombatEfaArcaneFirearm();

		const text = collectText(container);
		expect(section.style.display).toBe("");
		expect(text).toContain("Longbow");
		expect(text).toContain("Not equipped");
		expect(text).toContain("must be equipped");
		expect(text).toContain("only be changed when you finish a Long Rest");
		expect(text).not.toContain("Re-carve now");
	});

	it("pins the labelled live region, Long Rest a11y, error/empty copy, and mobile touch contract", () => {
		const html = fs.readFileSync("charactersheet.html", "utf8");
		const restSource = fs.readFileSync("js/charactersheet/charactersheet-rest.js", "utf8");
		const combatSource = fs.readFileSync("js/charactersheet/charactersheet-combat.js", "utf8");
		const mobileCss = fs.readFileSync("css/charactersheet-mobile.css", "utf8");

		expect(html).toContain("id=\"charsheet-combat-arcane-firearm-section\"");
		expect(html).toContain("aria-labelledby=\"charsheet-combat-arcane-firearm-title\"");
		expect(html).toContain("id=\"charsheet-combat-arcane-firearm\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\"");
		expect(restSource).toContain("Arcane Firearm item to carve after this Long Rest");
		expect(restSource).toContain("No eligible rod, staff, wand, or martial ranged weapon");
		expect(restSource).toContain("The selected Arcane Firearm item is no longer eligible.");
		expect(combatSource).toContain("Carving can only be changed when you finish a Long Rest.");
		expect(mobileCss).toContain(".charsheet__arcane-firearm-rest-select");
		expect(mobileCss).toContain("min-height: 44px");
		expect(mobileCss).toContain(".charsheet__arcane-firearm-header");
		expect(mobileCss).toContain("flex-direction: column");
	});
});
