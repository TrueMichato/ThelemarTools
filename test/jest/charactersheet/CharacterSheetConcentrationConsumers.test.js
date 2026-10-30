import fs from "node:fs";
import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const State = globalThis.CharacterSheetState;
const feats = JSON.parse(fs.readFileSync(new URL("../../../data/feats.json", import.meta.url), "utf8")).feat;
const brew = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url), "utf8"));
const originalE = globalThis.e_;
const originals = {window: globalThis.window, document: globalThis.document, ee: globalThis.ee, getShowModal: UiUtil.getShowModal, escapeQuotes: String.prototype.escapeQuotes, rendererDice: Renderer.dice};
let Page;
let Combat;
let PlayMode;
let elements;
let modals;
let nodes;

function element (opts = {}) {
	const el = originalE(opts);
	el.value = opts.outer?.match(/\bvalue="([^"]*)"/)?.[1] || el.value;
	el.empty = () => { el.replaceChildren(); return el; };
	if (opts.click) el.addEventListener("click", opts.click);
	const controls = new Map();
	el.querySelector = selector => {
		if (!controls.has(selector)) controls.set(selector, element());
		return controls.get(selector);
	};
	let checkboxes;
	el.querySelectorAll = selector => {
		if (selector !== ".charsheet__cond-pick-cb") return [];
		checkboxes ||= [...el.innerHTML.matchAll(/class="charsheet__cond-pick-cb" data-idx="(\d+)"/g)]
			.map(match => ({checked: false, getAttribute: () => match[1]}));
		return checkboxes;
	};
	elements.push(el);
	return el;
}

function modal (opts) {
	const root = element();
	const close = () => opts.cbClose?.();
	modals.push({title: opts.title, root, close});
	return {eleModalInner: root, doClose: close};
}

beforeAll(async () => {
	elements = [];
	globalThis.e_ = element;
	UiUtil.getShowModal = modal;
	String.prototype.escapeQuotes ||= function () { return this.replace(/"/g, "&quot;"); };
	Renderer.dice ||= {parseRandomise2: () => 0};
	globalThis.ee = (strings, ...children) => {
		const el = element();
		el.append(...children.filter(child => typeof child === "object"));
		return el;
	};
	globalThis.window = {addEventListener () {}, location: {search: ""}, matchMedia: () => ({matches: false})};
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener () {},
		getElementById: id => {
			if (!nodes.has(id)) nodes.set(id, element());
			return nodes.get(id);
		},
		createElement: () => ({innerHTML: "", firstChild: {attributes: []}}),
		body: {append () {}, appendChild () {}, classList: {add () {}, remove () {}}},
	};
	await import("../../../js/charactersheet/charactersheet.js");
	Page = globalThis.CharacterSheetPage;
	Combat = globalThis.CharacterSheetCombat;
	PlayMode = (await import("../../../js/charactersheet/charactersheet-playmode.js")).CharacterSheetPlayMode;
});

beforeEach(() => {
	elements = [];
	modals = [];
	nodes = new Map();
	jest.spyOn(UiUtil, "getShowModal").mockImplementation(modal);
	jest.spyOn(CharacterSheetModal, "pGetShow").mockImplementation(async opts => modal(opts));
	jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
	globalThis.e_ = originalE;
	globalThis.ee = originals.ee;
	globalThis.window = originals.window;
	globalThis.document = originals.document;
	if (originals.getShowModal) UiUtil.getShowModal = originals.getShowModal;
	else delete UiUtil.getShowModal;
	if (originals.escapeQuotes) String.prototype.escapeQuotes = originals.escapeQuotes;
	else delete String.prototype.escapeQuotes;
	Renderer.dice = originals.rendererDice;
});

function makePage ({warCaster = false, conditional = false} = {}) {
	const state = new State();
	state.setAbilityBase("con", 14);
	state.setConcentration("Haste", 3);
	if (warCaster) state.addFeat(feats.find(it => it.name === "War Caster" && it.source === "PHB"));
	if (conditional) {
		const feature = brew.classFeature.find(it => it.name === "Path of Lean Winters");
		state.addFeature({...feature, description: Renderer.stripTags(JSON.stringify(feature.entries))});
	}
	state.setHp(40, 40, 0);
	const page = Object.create(Page.prototype);
	page._state = state;
	page._currentCharacterId = "concentration-test";
	page._lastHpChange = null;
	page._lastDamageType = null;
	page._damageIntakeAmount = 0;
	page._damageIntakePreviewIntent = "damage";
	page._rollHistory = {addRoll: jest.fn()};
	for (const name of ["_saveCurrentCharacter", "_renderHp", "_renderConditions", "_renderActiveStates", "_renderCharacter", "_flashHpBar", "_syncDamageIntakeControls", "_dismissDiceResult", "_watchDiceResultPosition", "_scheduleDiceResultDismiss"]) page[name] = jest.fn();
	page._pOfferZeroHpIntervention = jest.fn();
	page._pOfferMaterialDamageReactions = jest.fn();
	page.pAnimateD20 = jest.fn(async () => {});
	return {page, state};
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const button = text => elements.find(el => el._handlers.click && el.outerHTML.includes(`>${text}</button>`));
const click = el => el._handlers.click();

async function rollModal (page) {
	const flow = page._promptConcentrationCheck(12);
	await settle();
	await click(button("Roll Check"));
	await click(button("Close"));
	await flow;
}

describe("Concentration actual picker, modal, dice and history", () => {
	it("uses actual War Caster producer attribution and two real d20 draws in the normal modal/history", async () => {
		const {page, state} = makePage({warCaster: true});
		const dice = jest.spyOn(state, "rollD20").mockReturnValueOnce(4).mockReturnValueOnce(17);
		const picker = jest.spyOn(page, "_pPickConditionalModifiers");
		await rollModal(page);
		expect(picker).not.toHaveBeenCalled();
		expect(modals[0].root.innerHTML).toContain("War Caster");
		expect(modals[0].root.innerHTML).toContain("advantage");
		expect(dice).toHaveBeenCalledTimes(2);
		expect(page.pAnimateD20).toHaveBeenCalledWith(expect.objectContaining({roll1: 4, roll2: 17, roll: 17, mode: "advantage"}));
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 19, breakdown: expect.stringContaining("2d20kh"), resultNote: expect.stringContaining("War Caster")}));
		expect(state.isConcentrating()).toBe(true);
	});

	it("offers the actual text-produced context and propagates selected IDs to actual dice/history", async () => {
		const {page, state} = makePage({conditional: true});
		const dice = jest.spyOn(state, "rollD20").mockReturnValueOnce(3).mockReturnValueOnce(16);
		const flow = page._promptConcentrationCheck(12);
		await settle();
		const picker = modals[0].root;
		expect(picker.innerHTML).toContain("<strong>Path of Lean Winters</strong>");
		expect(picker.innerHTML).toContain("Applies against cold weather.");
		picker.querySelectorAll(".charsheet__cond-pick-cb")[0].checked = true;
		picker.querySelector(`[data-act="confirm"]`)._handlers.click();
		await settle();
		await click(button("Roll Check"));
		await click(button("Close"));
		await flow;
		expect(dice).toHaveBeenCalledTimes(2);
		expect(modals[1].root.innerHTML).toContain("Path of Lean Winters");
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 18, breakdown: expect.stringContaining("2d20kh"), resultNote: expect.stringContaining("Path of Lean Winters")}));
	});

	it.each(["skip", "confirm"])("rolls without an unselected contextual effect using picker %s", async action => {
		const {page, state} = makePage({conditional: true});
		const dice = jest.spyOn(state, "rollD20").mockReturnValue(13);
		const pending = page.pGetConcentrationCheck(12);
		await settle();
		modals[0].root.querySelector(`[data-act="${action}"]`)._handlers.click();
		const check = await pending;
		expect(check.advantage).toBe(false);
		page.rollD20({stateAdvantage: check.advantage, stateDisadvantage: check.disadvantage});
		expect(dice).toHaveBeenCalledTimes(1);
	});

	it.each(["cancel", "close"])("cancels the roll without fallback, dice/history or concentration mutation via %s", async action => {
		const {page, state} = makePage({conditional: true});
		const dice = jest.spyOn(state, "rollD20");
		const flow = page._promptConcentrationCheck(12);
		await settle();
		if (action === "close") modals[0].close();
		else modals[0].root.querySelector(`[data-act="cancel"]`)._handlers.click();
		await flow;
		expect(modals).toHaveLength(1);
		expect(dice).not.toHaveBeenCalled();
		expect(page._rollHistory.addRoll).not.toHaveBeenCalled();
		expect(state.isConcentrating()).toBe(true);
	});

	it("skipConditionalPrompt selects none and does not open a picker", async () => {
		const {page, state} = makePage({conditional: true});
		state._data.settings.skipConditionalPrompt = true;
		const check = await page.pGetConcentrationCheck(12);
		expect(check.advantage).toBe(false);
		expect(modals).toHaveLength(0);
	});

	it("cancels actual War Caster with real TGTT Poisoned into a single d20", async () => {
		const {page, state} = makePage({warCaster: true});
		state.addCondition({name: "Poisoned", source: "TGTT"});
		const dice = jest.spyOn(state, "rollD20").mockReturnValue(12);
		await rollModal(page);
		expect(dice).toHaveBeenCalledTimes(1);
		expect(modals[0].root.innerHTML).toContain("cancel");
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 14, breakdown: expect.stringContaining("1d20"), resultNote: expect.stringMatching(/War Caster.*Poisoned/i)}));
	});

	it("retains DC editing, state and distinct named dice, exhaustion and failed-save break", async () => {
		const {page, state} = makePage();
		jest.spyOn(state, "rollD20").mockReturnValue(6);
		state.setExhaustion(1);
		state.activateState("custom", {name: "Bless", customEffects: [{type: "rollBonus", target: "save", dice: "1d4"}]});
		state.addNamedModifier({name: "Extra focus", type: "concentration", bonusDie: "1d4", value: 0, enabled: true});
		jest.spyOn(Renderer.dice, "parseRandomise2").mockReturnValue(3);
		const flow = page._promptConcentrationCheck(12);
		await settle();
		elements.find(el => el.outerHTML.startsWith("<input type=\"number\"")).value = "20";
		await click(button("Roll Check"));
		await click(button("Close"));
		await flow;
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 13, breakdown: expect.stringContaining("vs DC 20")}));
		expect(state.isConcentrating()).toBe(false);
	});

	it.each(["Skip (Keep)", "Break Concentration"])("preserves the modal's %s action without rolling", async text => {
		const {page, state} = makePage();
		const dice = jest.spyOn(state, "rollD20");
		const flow = page._promptConcentrationCheck(12);
		await settle();
		await click(button(text));
		await flow;
		expect(dice).not.toHaveBeenCalled();
		expect(page._rollHistory.addRoll).not.toHaveBeenCalled();
		expect(state.isConcentrating()).toBe(text === "Skip (Keep)");
	});

	it("defers a power's failed-save break until close so Strain to Maintain remains available", async () => {
		const {page, state} = makePage();
		state.addClass({name: "Talent", source: "TalPsi", level: 5});
		state.breakConcentration();
		state.addConcentration({id: "power:Apparition|TalPsi", kind: "power", name: "Apparition", order: 2});
		jest.spyOn(state, "rollD20").mockReturnValue(2);
		const flow = page._promptConcentrationCheck(12);
		await settle();
		await click(button("Roll Check"));
		expect(state.isConcentrating()).toBe(true);
		expect(elements.some(el => el.innerHTML.includes("Strain to Maintain:"))).toBe(true);
		await click(button("Close"));
		await flow;
		expect(state.isConcentrating()).toBe(false);
	});
});

describe("Play Mode and Combat concentration consumers", () => {
	function playMode (page, state) {
		const pm = Object.create(PlayMode.prototype);
		pm._state = state;
		pm._page = page;
		pm._logActivity = jest.fn();
		pm._renderStatusBar = jest.fn();
		pm._setIconLabel = (el, _icon, label) => { el.textContent = label; };
		pm._ce = (tag, clazz, parent) => { const el = element({tag, clazz}); parent?.append(el); return el; };
		return pm;
	}

	it("normal Play Mode damage reaches the actual Page concentration modal", async () => {
		const {page, state} = makePage({warCaster: true});
		const pm = playMode(page, state);
		jest.spyOn(state, "rollD20").mockReturnValueOnce(2).mockReturnValueOnce(15);
		const fallback = jest.spyOn(pm, "_doConcentrationCheck");
		const pending = pm._applyHpChange("damage", 12);
		await settle();
		expect(modals[0].title).toBe("Concentration Check");
		await click(button("Roll Check"));
		await click(button("Close"));
		await pending;
		expect(fallback).not.toHaveBeenCalled();
		expect(state.getCurrentHp()).toBe(28);
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 17, resultNote: expect.stringContaining("War Caster")}));
	});

	it("fallback Play Mode uses only actor-local canonical state when the helper is absent", async () => {
		const {page, state} = makePage({warCaster: true});
		page.pGetConcentrationCheck = undefined;
		const pm = playMode(page, state);
		const dice = jest.spyOn(state, "rollD20").mockReturnValueOnce(2).mockReturnValueOnce(16);
		await pm._doConcentrationCheck(12);
		expect(dice).toHaveBeenCalledTimes(2);
		expect(pm._logActivity).toHaveBeenCalledWith("concentration", expect.stringContaining("War Caster"));
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 18}));
	});

	it("never falls back from an existing helper's cancellation", async () => {
		const {page, state} = makePage();
		page.pGetConcentrationCheck = jest.fn(async () => null);
		const canonical = jest.spyOn(state, "makeConcentrationCheck");
		const dice = jest.spyOn(state, "rollD20");
		await playMode(page, state)._doConcentrationCheck(12);
		expect(canonical).not.toHaveBeenCalled();
		expect(dice).not.toHaveBeenCalled();
		expect(state.isConcentrating()).toBe(true);
	});

	it("Focused Spell fallback reroll retains the canonical mode and source", async () => {
		const {page, state} = makePage({warCaster: true});
		state.setConcentration({name: "Haste", level: 3, appliedMetamagic: {key: "focused", name: "Focused Spell", cost: 1}});
		const pm = playMode(page, state);
		jest.spyOn(state, "rollD20").mockReturnValueOnce(2).mockReturnValueOnce(3).mockReturnValueOnce(12).mockReturnValueOnce(17);
		await pm._doConcentrationCheck(12);
		await elements.find(el => el.textContent === " Reroll")._handlers.click();
		expect(state.isConcentrating()).toBe(true);
		expect(state.canUseFocusedConcentrationReroll()).toBe(false);
		expect(page._rollHistory.addRoll).toHaveBeenLastCalledWith(expect.objectContaining({total: 19, resultNote: expect.stringContaining("War Caster")}));
	});

	it.each([false, true])("quick-save records cancel-aware dice and sources (poisoned=%s)", async poisoned => {
		const {page, state} = makePage({warCaster: true});
		if (poisoned) state.addCondition({name: "Poisoned", source: "TGTT"});
		const dice = jest.spyOn(state, "rollD20").mockReturnValueOnce(12).mockReturnValueOnce(17);
		const combat = Object.create(Combat.prototype);
		combat._state = state;
		combat._page = page;
		combat._updateQuickButtonStates = jest.fn();
		jest.spyOn(InputUiUtil, "pGetUserString").mockResolvedValue("12");
		jest.spyOn(console, "warn").mockImplementation(() => {});
		combat._initQuickStateButtons();
		await nodes.get("charsheet-combat-conc-save").onclick();
		expect(dice).toHaveBeenCalledTimes(poisoned ? 1 : 2);
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: poisoned ? 14 : 19, resultNote: expect.stringContaining("War Caster")}));
	});

	it("quick-save Focused Spell rerolls the smaller die under disadvantage, not the discarded larger die", async () => {
		const {page, state} = makePage();
		state.setConcentration({name: "Haste", level: 3, appliedMetamagic: {key: "focused", name: "Focused Spell", cost: 1}});
		state.addCondition({name: "Poisoned", source: "TGTT"});
		jest.spyOn(state, "rollD20").mockReturnValueOnce(5).mockReturnValueOnce(15);
		jest.spyOn(page, "rollDice").mockReturnValueOnce(18);
		const combat = Object.create(Combat.prototype);
		combat._state = state;
		combat._page = page;
		combat._updateQuickButtonStates = jest.fn();
		jest.spyOn(InputUiUtil, "pGetUserString").mockResolvedValue("30");
		jest.spyOn(console, "warn").mockImplementation(() => {});
		combat._initQuickStateButtons();
		await nodes.get("charsheet-combat-conc-save").onclick();
		expect(page.pAnimateD20).toHaveBeenCalledWith(expect.objectContaining({roll1: 18, roll2: 15, roll: 15, mode: "disadvantage"}));
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 17}));
		expect(state.isConcentrating()).toBe(true);
		expect(state.canUseFocusedConcentrationReroll()).toBe(false);
	});
});
