import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const getLastToastContent = () => {
	const content = globalThis.JqueryUtil.doToast.mock.calls.at(-1)[0].content;
	return typeof content === "string" ? content : (content.innerHTML || content._html || "");
};

const makeSpells = () => {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._page = {saveCharacter: jest.fn()};
	spells._allSpells = [];
	return spells;
};

// region Bug #1 — opt-in "Ignore spellcasting restrictions"
describe("Spellcasting flow — Bug #1: ignore spellcasting restrictions setting", () => {
	const VERBAL_SPELL = {name: "Command", source: "XPHB", level: 1};
	const VERBAL_SPELL_DATA = {name: "Command", source: "XPHB", components: {v: true}};

	const makeState = ({settings = {}, incap = false, conditions = [], constraints = {verbal: [], somatic: []}, activeStates = [], features = []} = {}) => ({
		getSettings: () => ({ignoreSpellcastingRestrictions: false, ...settings}),
		isIncapacitated: () => incap,
		getConditionNames: () => conditions,
		getCastingConstraints: () => constraints,
		getActiveStates: () => activeStates,
		getFeatures: () => features,
	});

	it("blocks casting while incapacitated when the setting is OFF (default)", () => {
		const spells = makeSpells();
		spells._state = makeState({incap: true, conditions: ["Stunned"]});

		const result = spells._checkCastingConstraints({name: "Fireball", source: "XPHB", level: 3}, null, null);

		expect(result.block).toMatch(/Cannot cast spells while stunned/i);
	});

	it("does NOT block while incapacitated when the setting is ON", () => {
		const spells = makeSpells();
		spells._state = makeState({settings: {ignoreSpellcastingRestrictions: true}, incap: true, conditions: ["Stunned"]});

		const result = spells._checkCastingConstraints({name: "Fireball", source: "XPHB", level: 3}, null, null);

		expect(result).toEqual({block: null, checks: []});
	});

	it("blocks a verbal spell when verbal components are banned and setting is OFF", () => {
		const spells = makeSpells();
		spells._state = makeState({constraints: {verbal: [{value: "banned", conditionName: "Silenced"}], somatic: []}});

		const result = spells._checkCastingConstraints(VERBAL_SPELL, VERBAL_SPELL_DATA, null);

		expect(result.block).toMatch(/verbal components/i);
	});

	it("bypasses the verbal-banned gate when the setting is ON", () => {
		const spells = makeSpells();
		spells._state = makeState({settings: {ignoreSpellcastingRestrictions: true}, constraints: {verbal: [{value: "banned", conditionName: "Silenced"}], somatic: []}});

		const result = spells._checkCastingConstraints(VERBAL_SPELL, VERBAL_SPELL_DATA, null);

		expect(result).toEqual({block: null, checks: []});
	});

	it("does not affect a normal cast with no constraints regardless of setting", () => {
		const spells = makeSpells();
		spells._state = makeState({});

		const result = spells._checkCastingConstraints({name: "Fireball", source: "XPHB", level: 3}, {components: {}}, null);

		expect(result.block).toBeNull();
		expect(result.checks).toEqual([]);
	});
});
// endregion

// region Bug #2 — "Cast" skips metamagic, "Cast w/ Metamagic" prompts
describe("Spellcasting flow — Bug #2: cast vs. cast-with-metamagic", () => {
	let spells;

	beforeEach(() => {
		spells = makeSpells();
		spells._state = {
			getSpells: () => [{id: "fb", name: "Fire Bolt", source: "XPHB", level: 0}],
			isConcentrating: () => false,
		};
		spells._allSpells = [{name: "Fire Bolt", source: "XPHB", level: 0, duration: [{type: "instant"}]}];
		spells._pChooseActiveMetamagic = jest.fn(async () => ({cancelled: false, metamagic: null}));
		spells._pHandleCastingConstraints = jest.fn(async () => true);
		spells._pChooseVariantComponent = jest.fn(async () => ({cancelled: false}));
		spells._showCastResult = jest.fn(async () => ({}));
		spells._updateConcentrationUI = jest.fn();
	});

	it("does NOT prompt metamagic when called with {withMetamagic: false}", async () => {
		await spells._castSpell("fb", {withMetamagic: false});
		expect(spells._pChooseActiveMetamagic).not.toHaveBeenCalled();
	});

	it("prompts metamagic when called with {withMetamagic: true}", async () => {
		await spells._castSpell("fb", {withMetamagic: true});
		expect(spells._pChooseActiveMetamagic).toHaveBeenCalledTimes(1);
	});

	it("prompts metamagic by default (legacy callers passing only a spellId)", async () => {
		await spells._castSpell("fb");
		expect(spells._pChooseActiveMetamagic).toHaveBeenCalledTimes(1);
	});
});

describe("Spellcasting flow — Bug #2: sorcery-point refund on a cancelled cast", () => {
	let spells;
	let sp;
	let slotCurrent;

	beforeEach(() => {
		spells = makeSpells();
		sp = {current: 3, max: 5};
		slotCurrent = 2;
		spells._allSpells = [{name: "Fireball", source: "XPHB", level: 3, duration: [{type: "instant"}]}];
		spells._state = {
			getSpells: () => [{id: "fb", name: "Fireball", source: "XPHB", level: 3}],
			isConcentrating: () => false,
			canCastAsRitual: () => false,
			getPactSlots: () => ({current: 0, max: 0, level: 0}),
			getSpellSlotsCurrent: lvl => (lvl === 3 ? slotCurrent : 0),
			getSpellSlotsMax: lvl => (lvl === 3 ? 4 : 0),
			setSpellSlots: (lvl, max, current) => { if (lvl === 3) slotCurrent = current; },
			getNoSlotCastResourcesForSpell: () => [],
			getSorceryPoints: () => ({current: sp.current, max: sp.max}),
			setSorceryPoints: pts => {
				if (typeof pts === "number") { sp.current = pts; sp.max = pts; } else { if (pts.current != null) sp.current = pts.current; if (pts.max != null) sp.max = pts.max; }
			},
			useSorceryPoint: cost => { if (sp.current < cost) return false; sp.current -= cost; return true; },
		};
		spells._pChooseActiveMetamagic = jest.fn(async () => ({cancelled: false, metamagic: {key: "twinned", name: "Twinned Spell", cost: 2}}));
		spells._pHandleCastingConstraints = jest.fn(async () => true);
		spells._pChooseVariantComponent = jest.fn(async () => ({cancelled: false}));
		spells._refreshSorceryPointUI = jest.fn();
		spells.renderSlots = jest.fn();
		spells._updateConcentrationUI = jest.fn();
		spells._page._renderQuickSpells = jest.fn();
		// Cancel at target-selection time, after slot + SP were already spent.
		spells._showCastResult = jest.fn(async () => ({cancelled: true}));
	});

	it("restores BOTH current and max SP (not collapsing max) and refunds the slot", async () => {
		await spells._castSpell("fb", {withMetamagic: true});
		// Spent 2 SP for the metamagic, then cancelled → refunded back to 3/5.
		expect(sp).toEqual({current: 3, max: 5});
		// Slot consumed then refunded back to 2.
		expect(slotCurrent).toBe(2);
	});
});

describe("Spellcasting flow — Bug #2/#9: spell-row cast buttons", () => {
	let spells;

	beforeEach(() => {
		spells = makeSpells();
		spells._allSpells = [{name: "Fireball", source: "XPHB", level: 3, duration: [{type: "instant"}]}];
		spells._getSpellSourceLabel = () => "";
		spells._truncateFeatureName = s => s;
		spells._state = {
			getCastableActiveMetamagics: () => [],
			getAttunedItems: () => [],
		};
	});

	const render = (spell) => spells._renderSpellItem(spell).innerHTML;

	it("renders only a single Cast button for non-metamagic characters", () => {
		const html = render({id: "fb", name: "Fireball", source: "XPHB", level: 3});
		expect(html).toContain("charsheet__spell-cast\"");
		expect(html).not.toContain("charsheet__spell-cast-metamagic");
		expect(html).not.toContain("charsheet__spell-cast-feywild");
	});

	it("renders a Cast w/ Metamagic button when the character knows an active metamagic", () => {
		spells._state.getCastableActiveMetamagics = () => [{key: "quickened", name: "Quickened Spell", cost: 2, isAvailable: true}];
		const html = render({id: "fb", name: "Fireball", source: "XPHB", level: 3});
		expect(html).toContain("charsheet__spell-cast-metamagic");
	});

	it("does NOT render a standalone Feywild Shard button even when the shard is attuned (now a metamagic sub-option)", () => {
		spells._state.getAttunedItems = () => [{item: {name: "Feywild Shard", source: "TCE"}, attuned: true}];
		const html = render({id: "fb", name: "Fireball", source: "XPHB", level: 3});
		expect(html).not.toContain("charsheet__spell-cast-feywild");
	});

	it("does NOT render the Feywild Shard button on a cantrip", () => {
		spells._state.getAttunedItems = () => [{item: {name: "Feywild Shard", source: "TCE"}, attuned: true}];
		spells._allSpells = [{name: "Fire Bolt", source: "XPHB", level: 0}];
		const html = render({id: "fbolt", name: "Fire Bolt", source: "XPHB", level: 0});
		expect(html).not.toContain("charsheet__spell-cast-feywild");
	});

	it("does NOT render the Feywild Shard button when the shard is not attuned", () => {
		spells._state.getAttunedItems = () => [{item: {name: "Bag of Holding", source: "PHB"}, attuned: true}];
		const html = render({id: "fb", name: "Fireball", source: "XPHB", level: 3});
		expect(html).not.toContain("charsheet__spell-cast-feywild");
	});
});
// endregion

// region Bug #3a — clickable metamagic picker
describe("Spellcasting flow — Bug #3a: clickable metamagic picker", () => {
	let spells;
	let origUiUtil;
	let capturedInner;

	const flatten = (el) => {
		const out = [];
		for (const c of (el.children || [])) {
			if (c && typeof c === "object") { out.push(c); out.push(...flatten(c)); }
		}
		return out;
	};
	const findByData = (root, key, val) => flatten(root).find(e => e.dataset?.[key] === val);
	const flush = () => new Promise(r => setTimeout(r, 0));

	beforeEach(() => {
		origUiUtil = globalThis.UiUtil;
		globalThis.UiUtil = {
			pGetShowModal: async ({cbClose}) => {
				capturedInner = globalThis.e_({tag: "div"});
				return {eleModalInner: capturedInner, doClose: val => cbClose?.(val)};
			},
		};

		spells = makeSpells();
		spells._getMetamagicHoverLink = m => m.name;
		spells._state = {
			getSorceryPoints: () => ({current: 5, max: 5}),
			getCastableActiveMetamagics: () => [
				{key: "quickened", name: "Quickened Spell", cost: 2, description: "Cast as a bonus action.", isAvailable: true},
				{key: "careful", name: "Careful Spell", cost: 1, description: "Protect allies.", isAvailable: false, unavailableReason: "Requires a spell with a saving throw"},
			],
		};
	});

	afterEach(() => { globalThis.UiUtil = origUiUtil; });

	const callPicker = () => spells._pChooseActiveMetamagic({
		spell: {name: "Fireball", source: "XPHB", level: 3},
		spellData: {time: [{number: 1, unit: "action"}]},
		slotLevel: 3,
	});

	it("returns the clicked metamagic", async () => {
		const p = callPicker();
		await flush();
		findByData(capturedInner, "metamagicKey", "quickened").click();
		const result = await p;
		expect(result.cancelled).toBe(false);
		expect(result.metamagic.key).toBe("quickened");
	});

	it("returns null metamagic when 'Cast without metamagic' is clicked", async () => {
		const p = callPicker();
		await flush();
		findByData(capturedInner, "mmAction", "none").click();
		const result = await p;
		expect(result).toEqual({cancelled: false, metamagic: null});
	});

	it("returns cancelled when the Cancel button is clicked", async () => {
		const p = callPicker();
		await flush();
		findByData(capturedInner, "mmAction", "cancel").click();
		const result = await p;
		expect(result).toEqual({cancelled: true, metamagic: null});
	});

	it("lists unavailable options (muted) with their reasons", async () => {
		const p = callPicker();
		await flush();
		const unavailable = findByData(capturedInner, "mmSection", "unavailable");
		expect(unavailable._html).toContain("Careful Spell");
		expect(unavailable._html).toContain("saving throw");
		findByData(capturedInner, "mmAction", "cancel").click();
		await p;
	});

	it("only offers available metamagics as clickable picks", async () => {
		const p = callPicker();
		await flush();
		const pickable = flatten(capturedInner).filter(e => e.dataset?.metamagicKey);
		expect(pickable.map(e => e.dataset.metamagicKey)).toEqual(["quickened"]);
		findByData(capturedInner, "mmAction", "cancel").click();
		await p;
	});

	it("auto-resolves to no-metamagic when no options are available (no modal)", async () => {
		spells._state.getCastableActiveMetamagics = () => [];
		const result = await callPicker();
		expect(result).toEqual({cancelled: false, metamagic: null});
	});

	it("auto-resolves (no modal) when known metamagics are all unavailable and not explicit", async () => {
		spells._state.getCastableActiveMetamagics = () => [
			{key: "careful", name: "Careful Spell", cost: 1, isAvailable: false, unavailableReason: "Not enough sorcery points"},
		];
		let modalShown = false;
		globalThis.UiUtil.pGetShowModal = async ({cbClose}) => { modalShown = true; capturedInner = globalThis.e_({tag: "div"}); return {eleModalInner: capturedInner, doClose: val => cbClose?.(val)}; };
		const result = await spells._pChooseActiveMetamagic({spell: {name: "Fireball", source: "XPHB", level: 3}, slotLevel: 3, isExplicit: false});
		expect(modalShown).toBe(false);
		expect(result).toEqual({cancelled: false, metamagic: null});
	});

	it("shows the modal on an explicit cast even when all known metamagics are unavailable", async () => {
		spells._state.getCastableActiveMetamagics = () => [
			{key: "careful", name: "Careful Spell", cost: 1, isAvailable: false, unavailableReason: "Not enough sorcery points"},
		];
		const p = spells._pChooseActiveMetamagic({spell: {name: "Fireball", source: "XPHB", level: 3}, slotLevel: 3, isExplicit: true});
		await flush();
		// No clickable picks, but the unavailable reason and a "Cast without metamagic" escape hatch are present.
		expect(flatten(capturedInner).filter(e => e.dataset?.metamagicKey).length).toBe(0);
		expect(findByData(capturedInner, "mmSection", "unavailable")._html).toContain("Not enough sorcery points");
		findByData(capturedInner, "mmAction", "none").click();
		const result = await p;
		expect(result).toEqual({cancelled: false, metamagic: null});
	});
});
// endregion

// region Bug #9 — Feywild Shard PHB Wild Magic Surge
describe("Spellcasting flow — Bug #9: PHB Wild Magic Surge table", () => {
	let origRandomise;

	beforeEach(() => { origRandomise = globalThis.RollerUtil.randomise; });
	afterEach(() => { globalThis.RollerUtil.randomise = origRandomise; });

	it("has 50 contiguous d100 ranges covering 1-100", () => {
		const table = CharacterSheetSpells.PHB_WILD_MAGIC_SURGE_TABLE;
		expect(table).toHaveLength(50);
		expect(table[0].min).toBe(1);
		expect(table.at(-1).max).toBe(100);
		for (let i = 1; i < table.length; ++i) {
			expect(table[i].min).toBe(table[i - 1].max + 1);
		}
	});

	it("maps a d100 roll onto the matching PHB table effect", () => {
		const spells = makeSpells();
		globalThis.RollerUtil.randomise = jest.fn(() => 1);
		expect(spells._rollPhbWildMagicSurge()).toEqual({roll: 1, effect: CharacterSheetSpells.PHB_WILD_MAGIC_SURGE_TABLE[0].effect});

		globalThis.RollerUtil.randomise = jest.fn(() => 100);
		const last = spells._rollPhbWildMagicSurge();
		expect(last.roll).toBe(100);
		expect(last.effect).toMatch(/sorcery points/i);

		globalThis.RollerUtil.randomise = jest.fn(() => 59);
		expect(spells._rollPhbWildMagicSurge().effect).toMatch(/lowest-level expended spell slot/i);
	});

	it("uses a different table than the variant-component wild magic table", () => {
		expect(CharacterSheetSpells.PHB_WILD_MAGIC_SURGE_TABLE)
			.not.toBe(CharacterSheetSpells._VARIANT_WILD_MAGIC_TABLE);
		// PHB table opens with the recursive "roll at the start of each turn" effect
		expect(CharacterSheetSpells.PHB_WILD_MAGIC_SURGE_TABLE[0].effect).toMatch(/start of each of your turns/i);
	});
});

describe("Spellcasting flow — Bug #9: Feywild Shard cast appends surge to the toast", () => {
	let state;
	let page;
	let spells;
	let origRandomise;

	beforeEach(() => {
		origRandomise = globalThis.RollerUtil.randomise;
		state = new CharacterSheetState();
		state.addClass({name: "Sorcerer", source: "XPHB", level: 5});
		state.setSpellcastingAbility("cha");
		state.setAbilityBase("cha", 16);

		globalThis.JqueryUtil = {doToast: jest.fn()};
		globalThis.Renderer = globalThis.Renderer || {};
		globalThis.Renderer.dice = globalThis.Renderer.dice || {};
		globalThis.Renderer.dice.parseRandomise2 = jest.fn(() => 28);

		page = {
			rollD20: jest.fn(() => ({roll: 11})),
			rollDice: jest.fn(() => 11),
			saveCharacter: jest.fn(),
		};

		spells = Object.create(CharacterSheetSpells.prototype);
		spells._page = page;
		spells._state = state;
		spells._allSpells = [{
			name: "Fireball",
			source: "XPHB",
			level: 3,
			duration: [{type: "instant"}],
			entries: ["Each creature makes a Dexterity saving throw, taking {@damage 8d6} fire damage."],
			damageInflict: ["fire"],
			savingThrow: ["dexterity"],
			range: {type: "point", distance: {type: "feet", amount: 150}},
		}];
	});

	afterEach(() => { globalThis.RollerUtil.randomise = origRandomise; });

	it("appends the PHB Wild Magic Surge result to the cast toast for a leveled spell", async () => {
		globalThis.RollerUtil.randomise = jest.fn(() => 100);

		await spells._handleSpellEffects(
			{name: "Fireball", source: "XPHB", level: 3},
			3,
			false,
			false,
			{feywildShard: true},
		);

		const toast = getLastToastContent();
		expect(toast).toContain("Feywild Shard");
		expect(toast).toContain("Wild Magic Surge");
		expect(toast).toContain("Rolled 100");
	});

	it("does NOT roll a surge for a cantrip cast", async () => {
		globalThis.RollerUtil.randomise = jest.fn(() => 100);
		spells._allSpells = [{name: "Fire Bolt", source: "XPHB", level: 0, duration: [{type: "instant"}], entries: ["ranged spell attack {@damage 1d10}"], spellAttack: ["R"]}];

		await spells._handleSpellEffects(
			{name: "Fire Bolt", source: "XPHB", level: 0},
			0,
			false,
			false,
			{feywildShard: true},
		);

		const toast = getLastToastContent();
		expect(toast).not.toContain("Feywild Shard");
	});
});
// endregion
