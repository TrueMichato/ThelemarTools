import {beforeAll, describe, expect, test} from "@jest/globals";
import "./setup.js";

let CharacterSheetPage;

beforeAll(async () => {
	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: () => {},
		body: {classList: {add () {}, remove () {}}},
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

function makeClassList () {
	const classes = new Set();
	return {
		add: (...names) => names.forEach(name => classes.add(name)),
		remove: (...names) => names.forEach(name => classes.delete(name)),
		toggle: (name, force) => {
			if (force) classes.add(name);
			else classes.delete(name);
		},
		contains: name => classes.has(name),
	};
}

function makeElement () {
	return {
		innerHTML: "",
		title: "",
		classList: makeClassList(),
		querySelector: () => null,
		setAttribute (name, value) {
			this[name] = value;
		},
	};
}

const BREAKDOWN = {
	total: 4,
	canonical: 6,
	components: [
		{icon: "🎯", name: "DEX modifier", value: 3},
		{icon: "⚡", name: "Temporal Awareness", value: 3},
		{icon: "😫", name: "Exhaustion", value: -2},
	],
	diceBonuses: [
		{dice: "1d8", sign: 1, source: "Gift of Alacrity"},
	],
};

describe("initiative hover breakdown", () => {
	test("formats the same component/total tooltip pattern used by skills", () => {
		const page = Object.create(CharacterSheetPage.prototype);
		const tooltip = page._formatD20BreakdownTooltip(BREAKDOWN, {
			trailingLines: ["Click to roll Initiative (Shift=Adv, Ctrl=Dis)"],
		});

		expect(tooltip).toContain("🎯 DEX modifier: +3");
		expect(tooltip).toContain("⚡ Temporal Awareness: +3");
		expect(tooltip).toContain("😫 Exhaustion: -2");
		expect(tooltip).toContain("🎲 Gift of Alacrity: +1d8");
		expect(tooltip).toContain("🎯 Total: +4");
		expect(tooltip).toContain("(intrinsic: +6)");
		expect(tooltip).toContain("Click to roll Initiative (Shift=Adv, Ctrl=Dis)");
	});

	test("renders the tooltip on the initiative card and modifier indicators do not replace it", () => {
		const display = makeElement();
		const initiativeBox = makeElement();
		const acBox = makeElement();
		const speedBox = makeElement();
		const modifiersButton = makeElement();
		const elements = {
			"charsheet-disp-initiative": display,
			"charsheet-box-initiative": initiativeBox,
			"charsheet-box-ac": acBox,
			"charsheet-box-speed": speedBox,
			"charsheet-btn-modifiers": modifiersButton,
		};
		globalThis.document = {
			getElementById: id => elements[id] || null,
			querySelector: () => null,
			querySelectorAll: () => [],
		};

		const page = Object.create(CharacterSheetPage.prototype);
		page._state = {
			getInitiativeBreakdown: () => BREAKDOWN,
			getNamedModifiers: () => [{enabled: true}],
			getCustomModifier: type => type === "initiative" ? -2 : 0,
			getSkillCustomMod: () => 0,
		};
		page.getSkillsList = () => [];

		page._renderInitiativeStat();
		const expectedTitle = initiativeBox.title;
		expect(expectedTitle).toContain("DEX modifier: +3");
		expect(expectedTitle).toContain("Gift of Alacrity: +1d8");
		expect(display.innerHTML).toContain("+6");
		expect(display.innerHTML).toContain("(+4)");

		page._renderModifierIndicators();
		expect(initiativeBox.title).toBe(expectedTitle);
		expect(initiativeBox.classList.contains("charsheet__combat-stat--modified-negative")).toBe(true);
	});
});
