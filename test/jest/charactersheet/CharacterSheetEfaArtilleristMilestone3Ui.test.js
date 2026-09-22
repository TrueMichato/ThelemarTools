import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetState = globalThis.CharacterSheetState;

const artificerData = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const objectData = JSON.parse(fs.readFileSync("data/objects.json", "utf8")).object;
const EFA_ARTILLERIST = artificerData.subclass.find(it =>
	it.name === "Artillerist"
	&& it.source === "EFA"
	&& it.classSource === "EFA",
);
const TCE_ARTILLERIST = artificerData.subclass.find(it =>
	it.name === "Artillerist"
	&& it.source === "TCE"
	&& it.classSource === "TCE",
);

const makeState = ({source = "EFA", level = 3} = {}) => {
	const subclass = source === "EFA" ? EFA_ARTILLERIST : TCE_ARTILLERIST;
	const state = new CharacterSheetState();
	state.setClassSummonTemplateCatalog(objectData);
	state.addClass({
		name: "Artificer",
		source,
		level,
		hd: {number: 1, faces: 8},
		subclass: {
			name: subclass.name,
			shortName: subclass.shortName,
			source: subclass.source,
		},
	});
	state.setSpellSlots([{level: 1, current: 2, max: 2}]);
	return state;
};

const makeCombat = state => {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {
		getState: () => state,
		_saveCurrentCharacter: jest.fn(async () => true),
		_renderResources: jest.fn(),
		_features: {_renderResources: jest.fn()},
		_spells: {render: jest.fn()},
	};
	return combat;
};

const makeRenderDocument = () => {
	const section = {style: {display: "none"}};
	const createButton = {disabled: false, title: ""};
	const feedback = {
		textContent: "",
		classList: {toggle: jest.fn()},
	};
	const listenerTarget = {addEventListener: jest.fn()};
	const card = {
		querySelector: jest.fn(() => listenerTarget),
	};
	const container = {
		innerHTML: "",
		querySelector: jest.fn(selector => selector === "[data-efa-cannon-id]" ? card : null),
	};
	const elements = {
		"charsheet-combat-efa-cannon-section": section,
		"charsheet-combat-efa-cannon-create": createButton,
		"charsheet-combat-efa-cannon-feedback": feedback,
		"charsheet-combat-efa-cannon": container,
	};
	return {
		document: {getElementById: id => elements[id] || null},
		section,
		createButton,
		feedback,
		container,
		card,
	};
};

describe("EFA Artillerist Milestone 3 Combat rendering", () => {
	const savedDocument = globalThis.document;

	afterEach(() => {
		jest.restoreAllMocks();
		globalThis.document = savedDocument;
	});

	test("renders an EFA-only empty state and hides the surface from TCE", () => {
		const efaDom = makeRenderDocument();
		globalThis.document = efaDom.document;
		makeCombat(makeState()).renderCombatEfaCannon();
		expect(efaDom.section.style.display).toBe("");
		expect(efaDom.container.innerHTML).toContain("No active cannon");
		expect(efaDom.container.innerHTML).toContain("free creation use is ready");
		expect(efaDom.createButton.disabled).toBe(false);

		const tceDom = makeRenderDocument();
		globalThis.document = tceDom.document;
		makeCombat(makeState({source: "TCE"})).renderCombatEfaCannon();
		expect(tceDom.section.style.display).toBe("none");
		expect(tceDom.container.innerHTML).toBe("");
	});

	test("renders the dedicated card hierarchy and complete operation controls", async () => {
		const dom = makeRenderDocument();
		globalThis.document = dom.document;
		const state = makeState({level: 9});
		const created = await state.pCreateEfaEldritchCannon({
			form: "forceBallista",
			size: "S",
			placement: "deployed",
			mobility: "wheels",
			distanceFromOwnerFt: 5,
			createdWith: "freeUse",
		});
		makeCombat(state).renderCombatEfaCannon();

		expect(dom.container.innerHTML).toContain("class=\"charsheet__efa-cannon-card\"");
		expect(dom.container.innerHTML).toContain("Force Ballista");
		expect(dom.container.innerHTML).toContain("45 / 45");
		expect(dom.container.innerHTML).toContain("1 hr");
		expect(dom.container.innerHTML).toContain("Deployed on wheels");
		expect(dom.container.innerHTML).toContain("Free creation use");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-activate");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-update-distance");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-damage");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-heal");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-mending");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-time-advance");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-end");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-dismiss");
		expect(dom.container.innerHTML).not.toContain("charsheet__companion-card");
		expect(dom.createButton.disabled).toBe(true);
		expect(created.ok).toBe(true);
	});

	test("restores and re-saves the snapshot after a failed operation commit", async () => {
		const state = makeState();
		const created = await state.pCreateEfaEldritchCannon({
			form: "forceBallista",
			size: "S",
			placement: "deployed",
			mobility: "wheels",
			distanceFromOwnerFt: 5,
			createdWith: "freeUse",
		});
		const combat = makeCombat(state);
		combat._page._saveCurrentCharacter
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);

		const result = await combat._pCommitEfaCannonMutation(
			() => state.damageEfaEldritchCannon(created.instanceId, 5),
		);

		expect(result).toMatchObject({ok: false, committed: false, reason: "saveFailed"});
		expect(state.getEfaEldritchCannon(created.instanceId).hp.current).toBe(15);
		expect(combat._page._saveCurrentCharacter).toHaveBeenCalledTimes(2);
	});

	test("pins canonical modal, native-control, inline-feedback, and keyboard-accessible structure", () => {
		const html = fs.readFileSync("charactersheet.html", "utf8");
		const combatSource = fs.readFileSync("js/charactersheet/charactersheet-combat.js", "utf8");
		const modalSource = fs.readFileSync("js/charactersheet/charactersheet-modal.js", "utf8");

		expect(html).toContain("id=\"charsheet-combat-efa-cannon-section\"");
		expect(html).toContain("role=\"region\" aria-labelledby=\"charsheet-combat-efa-cannon-title\"");
		expect(html).toContain("role=\"status\" aria-live=\"polite\" aria-atomic=\"true\"");
		expect(combatSource).toContain("CharacterSheetModal.pGetShow");
		expect(combatSource).toContain("<fieldset class=\"charsheet__efa-cannon-fieldset\">");
		expect(combatSource).toContain("type=\"radio\"");
		expect(combatSource).toContain("type=\"submit\"");
		expect(combatSource).toContain("role=\"status\" aria-live=\"polite\" aria-atomic=\"true\"");
		expect(combatSource).toContain("pRollback: () => this._pSaveEfaCannonState()");
		expect(modalSource).toContain("evt.key === \"Escape\"");
		expect(modalSource).toContain("_handleTab");
		expect(modalSource).toContain("eleTrigger.focus");
	});

	test("pins the adaptive stacked/mobile contract and no hover-only operation controls", () => {
		const desktopCss = fs.readFileSync("css/charactersheet.css", "utf8");
		const mobileCss = fs.readFileSync("css/charactersheet-mobile.css", "utf8");
		const combatSource = fs.readFileSync("js/charactersheet/charactersheet-combat.js", "utf8");

		expect(desktopCss).toContain(".charsheet__efa-cannon-radio-grid");
		expect(desktopCss).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
		expect(mobileCss).toContain(".charsheet__efa-cannon-secondary");
		expect(mobileCss).toContain("grid-template-columns: minmax(0, 1fr)");
		expect(mobileCss).toContain("min-height: 44px");
		expect(mobileCss).toContain("font-size: 1rem");
		expect(combatSource).toContain("type=\"button\" class=\"ve-btn ve-btn-primary charsheet__efa-cannon-activate\"");
		expect(combatSource).not.toContain("data-efa-cannon-activate title=");
	});
});
