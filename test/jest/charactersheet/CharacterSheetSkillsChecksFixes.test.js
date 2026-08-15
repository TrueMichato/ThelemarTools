import fs from "node:fs";
import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CHARACTERSHEET_SOURCE = fs.readFileSync(
	new URL("../../../js/charactersheet/charactersheet.js", import.meta.url),
	"utf8",
);

let CharacterSheetPage;
let savedWindow;
let savedDocument;

function getMethodSource (methodName, nextMethodName) {
	const findMethod = (name, from = 0) => {
		const plain = CHARACTERSHEET_SOURCE.indexOf(`\n\t${name} (`, from);
		const async = CHARACTERSHEET_SOURCE.indexOf(`\n\tasync ${name} (`, from);
		if (plain < 0) return async;
		if (async < 0) return plain;
		return Math.min(plain, async);
	};
	const start = findMethod(methodName);
	const end = findMethod(nextMethodName, start + 1);
	if (start < 0 || end < 0) throw new Error(`Could not isolate ${methodName}`);
	return CHARACTERSHEET_SOURCE.slice(start, end);
}

function installHoverMocks () {
	const calls = [];
	globalThis.HASH_LIST_SEP = "_";
	globalThis.UrlUtil.encodeForHash = value => String(value).toLowerCase().replace(/\s+/g, "-");
	globalThis.Renderer.hover = {
		getHoverElementAttributes: meta => {
			calls.push(meta);
			return `data-vet-page="${meta.page}" data-vet-source="${meta.source}" data-vet-hash="${meta.hash}"`;
		},
	};
	return calls;
}

function removeHoverMocks () {
	delete globalThis.HASH_LIST_SEP;
	delete globalThis.UrlUtil.encodeForHash;
	delete globalThis.Renderer.hover;
}

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
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

afterEach(() => {
	removeHoverMocks();
	jest.restoreAllMocks();
});

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.document = savedDocument;
});

describe("Bug 7 — skill ability pins refresh passive displays", () => {
	test("getPassiveScore uses the pinned ability", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 8);
		state.setAbilityBase("int", 20);

		expect(state.getPassiveScore("perception")).toBe(9);
		expect(state.setSkillAbilityOverride("perception", "int")).toBe(true);
		expect(state.getPassiveScore("perception")).toBe(15);
	});

	test("both Skill Abilities modal mutation paths rerender skills and detailed passives", () => {
		const source = getMethodSource("_showSkillAbilitiesModal", "_showLoreMasteryChoiceModal");
		expect(source.match(/this\._renderSkills\(\);/g)).toHaveLength(2);
		expect(source.match(/this\._renderAbilitiesDetailed\(\);/g)).toHaveLength(2);
	});

	test("the detailed full-skills passive column uses the canonical passive resolver", () => {
		const source = getMethodSource("_renderAbilitiesDetailed", "_renderPsionicStrainTracker");
		expect(source).toMatch(/const passiveScore = this\._state\.getPassiveScore\(skillKey\);/);
		expect(source).not.toMatch(/const passiveScore = 10 \+ mod;/);
	});
});

describe("Bug 8 — skill definition hovers", () => {
	test("the skill hover helper emits canonical faux-page attributes", () => {
		const calls = installHoverMocks();
		const page = Object.create(CharacterSheetPage.prototype);
		const html = page._getSkillHoverLink({name: "Perception", source: "XPHB"});

		expect(calls).toEqual([expect.objectContaining({
			page: "skill",
			source: "XPHB",
		})]);
		expect(html).toContain("data-vet-page=\"skill\"");
		expect(html).toContain("data-vet-source=\"XPHB\"");
		expect(html).toContain(">Perception</a>");
	});

	test("custom skills stay plain text instead of producing broken hover targets", () => {
		const calls = installHoverMocks();
		const page = Object.create(CharacterSheetPage.prototype);

		expect(page._getSkillHoverLink({name: "Tea Brewing", source: "Custom", isCustom: true})).toBe("Tea Brewing");
		expect(calls).toHaveLength(0);
	});

	test("all three requested render sites use the shared skill hover helper", () => {
		const skillsSource = getMethodSource("_renderSkills", "_renderLoreSkillsSection");
		const detailedSource = getMethodSource("_renderAbilitiesDetailed", "_renderPsionicStrainTracker");

		expect(skillsSource).toMatch(/charsheet__skill-name-text[\s\S]*?\$\{skillNameHtml\}/);
		expect(skillsSource.match(/_getSkillHoverLink\(/g)).toHaveLength(1);
		expect(detailedSource.match(/_getSkillHoverLink\(/g)).toHaveLength(2);
		expect(detailedSource).toMatch(/charsheet__passive-hero-label[\s\S]*?\$\{passiveNameHtml\}/);
		expect(detailedSource).toMatch(/charsheet__skill-full-name[\s\S]*?\$\{skillNameHtml\}/);
	});

	test("hover-anchor clicks are excluded from both click-to-roll row handlers", () => {
		const skillsSource = getMethodSource("_renderSkills", "_renderLoreSkillsSection");
		const detailedSource = getMethodSource("_renderAbilitiesDetailed", "_renderPsionicStrainTracker");

		expect(skillsSource).toMatch(/closest\?\.\("a\[data-vet-page\]"\)\) return;/);
		expect(detailedSource).toMatch(/closest\?\.\("a\[data-vet-page\]"\)\) return;/);
	});
});

describe("Bug 9 — armor Stealth disadvantage reaches rolls", () => {
	function getArmoredState () {
		const state = new CharacterSheetState();
		state.addArmorProficiency("heavy");
		state.setArmor({name: "Plate", source: "PHB", ac: 18, type: "heavy", stealth: true});
		return state;
	}

	test("proficient stealth-disadvantage armor affects Stealth and names its source", () => {
		const state = getArmoredState();
		const stealth = state.getAdvantageState("skill:stealth");

		expect(state.isWearingNonProficientArmor()).toBe(false);
		expect(stealth).toMatchObject({advantage: false, disadvantage: true});
		expect(stealth.sources).toContain("Armor");
		expect(state.getAdvantageState("skill:perception").disadvantage).toBe(false);
	});

	test("armor disadvantage lowers passive Stealth by 5", () => {
		const state = getArmoredState();
		state.setAbilityBase("dex", 10);

		expect(state.getSkillMod("stealth")).toBe(0);
		expect(state.getPassiveScore("stealth")).toBe(5);
	});

	test("a genuine remove-disadvantage effect can cancel the armor penalty", () => {
		const state = getArmoredState();
		state.addNamedModifier({
			name: "Silent Armor Training",
			type: "skill:stealth",
			value: 0,
			removeDisadvantage: true,
			enabled: true,
		});

		const stealth = state.getAdvantageState("skill:stealth");
		expect(stealth.disadvantage).toBe(false);
		expect(stealth.sources).toContain("Armor");
	});
});
