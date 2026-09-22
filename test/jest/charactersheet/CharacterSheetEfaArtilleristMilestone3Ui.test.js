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

const makeState = ({source = "EFA", level = 3, withTool = true} = {}) => {
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
	if (source === "EFA" && withTool) {
		state.addItem({id: "efa-cannon-tool", name: "Smith's Tools", source: "PHB", type: "AT", _isCustom: true}, 1, true);
		state.addToolProficiency("Smith's Tools");
	}
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
	const cards = [];
	const container = {
		innerHTML: "",
		querySelector: jest.fn(() => null),
		querySelectorAll: jest.fn(selector => {
			if (selector !== "[data-efa-cannon-id]") return [];
			const ids = [...container.innerHTML.matchAll(/data-efa-cannon-id="([^"]+)"/g)].map(match => match[1]);
			return ids.map((id, index) => {
				cards[index] ||= {dataset: {}, querySelector: jest.fn(() => listenerTarget)};
				cards[index].dataset.efaCannonId = id;
				return cards[index];
			});
		}),
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
		card: cards[0] || null,
		cards,
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

	test("renders both persisted slots, the one-Bonus-Action dual flow, cover state, and creation tool", async () => {
		const dom = makeRenderDocument();
		globalThis.document = dom.document;
		const state = makeState({level: 15});
		const created = await state.pCreateEfaEldritchCannons({
			requests: [
				{
					form: "forceBallista",
					size: "S",
					placement: "deployed",
					mobility: "wheels",
					distanceFromOwnerFt: 5,
					createdWith: "freeUse",
				},
				{
					form: "protector",
					size: "T",
					placement: "carried",
					mobility: null,
					distanceFromOwnerFt: 0,
					createdWith: "freeUse",
				},
			],
		});
		state.setEfaEldritchCannonPosition(created.instanceIds[0], {distanceFromOwnerFt: 20});
		makeCombat(state).renderCombatEfaCannon();

		expect(created.ok).toBe(true);
		expect(dom.container.innerHTML.match(/class="charsheet__efa-cannon-card"/g)).toHaveLength(2);
		expect(dom.container.innerHTML).toContain("Cannon 1 · Force Ballista");
		expect(dom.container.innerHTML).toContain("Cannon 2 · Protector");
		expect(dom.container.innerHTML).toContain("data-efa-cannon-activate-both");
		expect(dom.container.innerHTML).toContain("Activate Both · One Bonus Action");
		expect(dom.container.innerHTML).toContain("Smith&#039;s Tools");
		expect(dom.container.innerHTML).toContain("Half Cover active for you: +2 AC and +2 Dex saves while within 10 ft");
		expect(dom.container.innerHTML).toContain("This cannon's Shimmering Field is out of range: move within 10 ft");
		expect(dom.container.innerHTML).toContain("Allies within 10 ft also have Half Cover; ally state is not automated.");
		expect(dom.createButton.disabled).toBe(true);
	});

	test("disables creation and gives an actionable tool requirement when no eligible wrapper exists", () => {
		const dom = makeRenderDocument();
		globalThis.document = dom.document;
		makeCombat(makeState({withTool: false})).renderCombatEfaCannon();
		expect(dom.createButton.disabled).toBe(true);
		expect(dom.createButton.title).toContain("Equip a positive-quantity Smith's Tools or Woodcarver's Tools");
		expect(dom.container.innerHTML).toContain("Equip a positive-quantity Smith&#039;s Tools or Woodcarver&#039;s Tools");
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
		expect(combatSource).toContain("Activate Both Eldritch Cannons");
		expect(combatSource).toContain("Explosive Cannon — Reaction");
		expect(combatSource).toContain("20-ft radius");
		expect(combatSource).toContain("3d10 force");
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
		expect(mobileCss).toMatch(/\.charsheet__efa-cannon-actions \.cs-combat-btn,\s*\.charsheet__efa-cannon-modal-actions \.ve-btn \{\s*flex: 0 0 auto;\s*width: 100%;/);
		expect(combatSource).toContain("type=\"button\" class=\"ve-btn ve-btn-primary charsheet__efa-cannon-activate\"");
		expect(combatSource).not.toContain("data-efa-cannon-activate title=");
	});
});
