import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

/** Extract toast content string from doToast mock (content may be a string or an element with innerHTML) */
const getLastToastContent = () => {
	const content = globalThis.JqueryUtil.doToast.mock.calls.at(-1)[0].content;
	return typeof content === "string" ? content : (content.innerHTML || content._html || "");
};

const SAMPLE_SPELLS = {
	fireball: {
		name: "Fireball",
		source: "XPHB",
		level: 3,
		duration: [{type: "instant"}],
		entries: [
			"Each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw, taking {@damage 8d6} Fire damage on a failed save or half as much damage on a successful one.",
		],
		entriesHigherLevel: [{
			type: "entries",
			name: "Using a Higher-Level Spell Slot",
			entries: ["The damage increases by {@scaledamage 8d6|3-9|1d6} for each spell slot level above 3."],
		}],
		damageInflict: ["fire"],
		savingThrow: ["dexterity"],
		range: {type: "point", distance: {type: "feet", amount: 150}},
	},
	firebolt: {
		name: "Fire Bolt",
		source: "XPHB",
		level: 0,
		duration: [{type: "instant"}],
		entries: [
			"You hurl a mote of fire at a creature or object within range. Make a ranged spell attack against the target. On a hit, the target takes {@damage 1d10} Fire damage.",
		],
		scalingLevelDice: {
			label: "Fire damage",
			scaling: {1: "1d10", 5: "2d10", 11: "3d10", 17: "4d10"},
		},
		damageInflict: ["fire"],
		spellAttack: ["R"],
		range: {type: "point", distance: {type: "feet", amount: 120}},
	},
};

const makeMetamagicTestDom = () => {
	class FakeElement {
		constructor ({id = null, textContent = "", disabled = false, dataset = {}} = {}) {
			this.id = id;
			this.textContent = textContent;
			this.disabled = disabled;
			this.dataset = dataset;
			this.style = {};
			this._children = [];
			this._handlers = {};
			this._innerHTML = "";
		}

		get innerHTML () { return this._innerHTML; }
		set innerHTML (value) {
			this._innerHTML = value;
			if (value === "") this._children = [];
		}

		append (child) {
			this._children.push(child);
			this._parseHtml(child?._html || child?.outerHTML || "");
		}

		insertAdjacentHTML (position, html) {
			this._innerHTML += html;
			this._parseHtml(html);
		}

		addEventListener (eventName, handler) { this._handlers[eventName] = handler; }
		click () { if (!this.disabled) this._handlers.click?.(); }

		querySelector (selector) { return this.querySelectorAll(selector)[0] || null; }

		querySelectorAll (selector) {
			const classMatch = selector.match(/\.([\w-]+)/);
			const deltaMatch = selector.match(/data-sp-delta=['"]([^'"]+)['"]/);
			return this._children.filter(child => {
				if (classMatch && !child.classNames?.includes(classMatch[1])) return false;
				if (deltaMatch && child.dataset?.spDelta !== deltaMatch[1]) return false;
				return true;
			});
		}

		_parseHtml (html) {
			for (const match of html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)) {
				const attrs = match[1];
				const classAttr = attrs.match(/class="([^"]+)"/)?.[1] || "";
				const btn = new FakeElement({
					textContent: match[2],
					disabled: /\sdisabled(?:\s|>|$)/.test(attrs),
					dataset: {
						...(attrs.match(/data-sp-delta="([^"]+)"/) ? {spDelta: attrs.match(/data-sp-delta="([^"]+)"/)[1]} : {}),
						...(attrs.match(/data-metamagic-key="([^"]+)"/) ? {metamagicKey: attrs.match(/data-metamagic-key="([^"]+)"/)[1]} : {}),
					},
				});
				btn.classNames = classAttr.split(/\s+/).filter(Boolean);
				this._children.push(btn);
			}

			for (const match of html.matchAll(/<span class="charsheet__mm-name">(.*?)<\/span>/g)) {
				const innerHtml = match[1];
				const span = new FakeElement({textContent: innerHtml.replace(/<[^>]+>/g, "")});
				span.innerHTML = innerHtml;
				span.classNames = ["charsheet__mm-name"];
				this._children.push(span);
			}
		}
	}

	const bySelector = new Map();
	const add = (selector) => {
		const el = new FakeElement({id: selector.slice(1)});
		bySelector.set(selector, el);
		return el;
	};

	for (const base of ["overview", "combat", "spells"]) {
		add(`#charsheet-${base}-metamagic-section`);
		add(`#charsheet-${base}-metamagic-sp`);
		add(`#charsheet-${base}-metamagic`);
	}
	add("#charsheet-spell-lists");

	globalThis.document = {
		querySelector: (selector) => {
			if (bySelector.has(selector)) return bySelector.get(selector);
			const descendantMatch = selector.match(/^(#[\w-]+)\s+(.+)$/);
			if (descendantMatch) return bySelector.get(descendantMatch[1])?.querySelector(descendantMatch[2]) || null;
			return null;
		},
		querySelectorAll: (selector) => {
			const descendantMatch = selector.match(/^(#[\w-]+)\s+(.+)$/);
			if (descendantMatch) return bySelector.get(descendantMatch[1])?.querySelectorAll(descendantMatch[2]) || [];
			return [];
		},
		getElementById: (id) => bySelector.get(`#${id}`) || null,
	};
};

describe("CharacterSheetSpells Metamagic Automation", () => {
	let state;
	let page;
	let spells;
	let parseRandomise2Mock;
	let rollDiceMock;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "XPHB", level: 5});
		state.setSpellcastingAbility("int");
		state.setAbilityBase("int", 16);

		globalThis.JqueryUtil = {doToast: jest.fn()};
		globalThis.Renderer = globalThis.Renderer || {};
		globalThis.Renderer.dice = globalThis.Renderer.dice || {};
		parseRandomise2Mock = jest.fn(expr => {
			if (expr === "1d6") return 4;
			if (expr === "1d10") return 7;
			if (expr === "2d10") return 12;
			if (expr === "8d6") return 28;
			if (expr === "10d6") return 35;
			return 5;
		});
		globalThis.Renderer.dice.parseRandomise2 = parseRandomise2Mock;

		page = {
			getState: () => state,
			rollD20: jest.fn(() => ({roll: 11})),
			rollDice: jest.fn(() => 11),
			saveCharacter: jest.fn(),
			_saveCurrentCharacter: jest.fn(),
			_renderResources: jest.fn(),
			_renderCompanions: jest.fn(),
			_renderActiveStates: jest.fn(),
			_renderHp: jest.fn(),
			_renderCharacter: jest.fn(),
			getHoverLink: jest.fn((pageName, name, source, hash = null, displayName = null) => `<a href="${pageName}#${hash || `${name}|${source}`}" data-hover="1">${displayName || name}</a>`),
			resolveOptionalFeatureSource: jest.fn(() => "TGTT"),
			getOptionalFeatures: jest.fn(() => [
				{name: "Careful Spell (Passive)", source: "TGTT"},
				{name: "Quickened Spell (Active)", source: "TGTT"},
			]),
			combat: {renderCombatStates: jest.fn()},
		};
		rollDiceMock = page.rollDice;

		spells = Object.create(CharacterSheetSpells.prototype);
		spells._page = page;
		spells._state = state;
		spells._allSpells = Object.values(SAMPLE_SPELLS);
		page._spells = spells;
		delete globalThis.document;
	});

	const mockKnownMetamagicDashboard = ({current = 3, max = 5} = {}) => {
		state.getFeatureCalculations = () => ({hasMetamagic: true});
		state.getKnownMetamagicKeys = () => ["careful", "quickened"];
		state.getPassiveMetamagics = () => [{
			key: "careful",
			name: "Careful Spell",
			cost: 1,
			description: "Protect allies from your spell.",
			tuned: state.isMetamagicTuned?.("careful") || false,
		}];
		state.getActiveMetamagics = () => [{
			key: "quickened",
			name: "Quickened Spell",
			cost: 2,
			description: "Cast an action spell as a bonus action.",
		}];
		state.setSorceryPoints({current, max});
	};

	const renderMetamagicDom = () => {
		makeMetamagicTestDom();
		CharacterSheetCombat._refreshMetamagicDashboards(state, page);
	};

	it("should hide the spells-tab metamagic dashboard when no metamagic is known", () => {
		makeMetamagicTestDom();
		state.getFeatureCalculations = () => ({hasMetamagic: false});

		spells._renderMetamagic();

		expect(globalThis.document.getElementById("charsheet-spells-metamagic-section").style.display).toBe("none");
	});

	it("should render editable sorcery point controls in the spells-tab dashboard", () => {
		mockKnownMetamagicDashboard({current: 3, max: 5});
		renderMetamagicDom();

		const spellsSection = globalThis.document.getElementById("charsheet-spells-metamagic-section");
		expect(spellsSection.style.display).toBe("");
		expect(globalThis.document.getElementById("charsheet-spells-metamagic-sp").textContent).toBe("3/5");
		expect(globalThis.document.querySelector("#charsheet-spells-metamagic .charsheet__mm-name").textContent).toBe("Careful Spell");
		expect(globalThis.document.querySelector("#charsheet-spells-metamagic .charsheet__mm-name").innerHTML).toContain("data-hover");
		expect(globalThis.document.querySelector("#charsheet-spells-metamagic .charsheet__mm-name").innerHTML).toContain("Careful Spell (Passive)|TGTT");
		expect(globalThis.document.querySelectorAll("#charsheet-spells-metamagic .charsheet__mm-sp-adjust-btn")).toHaveLength(2);
		expect(globalThis.document.querySelectorAll("#charsheet-overview-metamagic .charsheet__mm-sp-adjust-btn")).toHaveLength(0);
		expect(globalThis.document.querySelectorAll("#charsheet-combat-metamagic .charsheet__mm-sp-adjust-btn")).toHaveLength(2);
	});

	it("renders clickable, hoverable metamagic options in the cast-time picker", async () => {
		state.getKnownMetamagicKeys = () => ["quickened"];
		state.setSorceryPoints(5, 5);

		const flatten = (el) => {
			const out = [];
			for (const c of (el.children || [])) {
				if (c && typeof c === "object") { out.push(c); out.push(...flatten(c)); }
			}
			return out;
		};
		const findByData = (root, key, val) => flatten(root).find(e => e.dataset?.[key] === val);

		const origUiUtil = globalThis.UiUtil;
		let capturedInner;
		globalThis.UiUtil = {
			pGetShowModal: async ({cbClose}) => {
				capturedInner = globalThis.e_({tag: "div"});
				return {eleModalInner: capturedInner, doClose: val => cbClose?.(val)};
			},
		};

		try {
			const p = spells._pChooseActiveMetamagic({
				spell: {name: "Fireball", source: "XPHB", level: 3},
				spellData: {...SAMPLE_SPELLS.fireball, time: [{number: 1, unit: "action"}]},
				slotLevel: 3,
			});
			await new Promise(r => setTimeout(r, 0));

			const optionRow = findByData(capturedInner, "metamagicKey", "quickened");
			expect(optionRow).toBeDefined();
			expect(optionRow._html).toContain("data-hover");
			expect(optionRow._html).toContain("Quickened Spell");
			expect(optionRow._html).toContain("Quickened Spell (Active)|TGTT");

			// Choosing "Cast without metamagic" yields a null metamagic
			findByData(capturedInner, "mmAction", "none").click();
			const result = await p;
			expect(result).toEqual({cancelled: false, metamagic: null});
		} finally {
			globalThis.UiUtil = origUiUtil;
		}
	});

	it("should manually decrease and increase sorcery points from the spells tab and sync all dashboards", () => {
		mockKnownMetamagicDashboard({current: 3, max: 5});
		renderMetamagicDom();

		globalThis.document.querySelector("#charsheet-spells-metamagic .charsheet__mm-sp-adjust-btn[data-sp-delta='-1']").click();
		expect(state.getSorceryPoints()).toEqual({current: 2, max: 5});
		expect(globalThis.document.getElementById("charsheet-spells-metamagic-sp").textContent).toBe("2/5");
		expect(globalThis.document.getElementById("charsheet-overview-metamagic-sp").textContent).toBe("2/5");
		expect(globalThis.document.getElementById("charsheet-combat-metamagic-sp").textContent).toBe("2/5");

		globalThis.document.querySelector("#charsheet-spells-metamagic .charsheet__mm-sp-adjust-btn[data-sp-delta='1']").click();
		expect(state.getSorceryPoints()).toEqual({current: 3, max: 5});
		expect(globalThis.document.getElementById("charsheet-spells-metamagic-sp").textContent).toBe("3/5");
		expect(page.saveCharacter).toHaveBeenCalledTimes(2);
		expect(page._renderResources).toHaveBeenCalledTimes(2);
	});

	it("should manually decrease and increase sorcery points from the combat tab and sync all dashboards", () => {
		mockKnownMetamagicDashboard({current: 3, max: 5});
		renderMetamagicDom();

		globalThis.document.querySelector("#charsheet-combat-metamagic .charsheet__mm-sp-adjust-btn[data-sp-delta='-1']").click();
		expect(state.getSorceryPoints()).toEqual({current: 2, max: 5});
		expect(globalThis.document.getElementById("charsheet-spells-metamagic-sp").textContent).toBe("2/5");
		expect(globalThis.document.getElementById("charsheet-overview-metamagic-sp").textContent).toBe("2/5");
		expect(globalThis.document.getElementById("charsheet-combat-metamagic-sp").textContent).toBe("2/5");

		globalThis.document.querySelector("#charsheet-combat-metamagic .charsheet__mm-sp-adjust-btn[data-sp-delta='1']").click();
		expect(state.getSorceryPoints()).toEqual({current: 3, max: 5});
		expect(globalThis.document.getElementById("charsheet-combat-metamagic-sp").textContent).toBe("3/5");
		expect(page.saveCharacter).toHaveBeenCalledTimes(2);
		expect(page._renderResources).toHaveBeenCalledTimes(2);
	});

	it("should clamp manual sorcery point edits at zero and max", () => {
		mockKnownMetamagicDashboard({current: 0, max: 1});
		renderMetamagicDom();

		const decBtn = globalThis.document.querySelector("#charsheet-spells-metamagic .charsheet__mm-sp-adjust-btn[data-sp-delta='-1']");
		expect(decBtn.disabled).toBe(true);

		globalThis.document.querySelector("#charsheet-spells-metamagic .charsheet__mm-sp-adjust-btn[data-sp-delta='1']").click();
		expect(state.getSorceryPoints()).toEqual({current: 1, max: 1});
		expect(globalThis.document.querySelector("#charsheet-spells-metamagic .charsheet__mm-sp-adjust-btn[data-sp-delta='1']").disabled).toBe(true);
	});

	it("should only offer Quickened Spell for action-cast spells", () => {
		state.getKnownMetamagicKeys = () => ["quickened"];
		state.setSorceryPoints(5, 5);

		const actionSpell = {
			...SAMPLE_SPELLS.fireball,
			time: [{number: 1, unit: "action"}],
		};
		const actionOptions = state.getCastableActiveMetamagics({
			spell: {name: "Fireball", source: "XPHB", level: 3},
			spellData: actionSpell,
			slotLevel: 3,
		});
		expect(actionOptions[0].isAvailable).toBe(true);

		const nonActionSpell = {
			...actionSpell,
			time: [{number: 10, unit: "minute"}],
		};
		const nonActionOptions = state.getCastableActiveMetamagics({
			spell: {name: "Fireball", source: "XPHB", level: 3},
			spellData: nonActionSpell,
			slotLevel: 3,
		});
		expect(nonActionOptions[0].isAvailable).toBe(false);
		expect(nonActionOptions[0].unavailableReason).toContain("casting time of 1 action");
	});

	it("should maximize base spell damage for Overcharged Spell", () => {
		const result = spells._rollSpellDamage(SAMPLE_SPELLS.fireball, 3, 3, {key: "overcharged"});

		expect(result.total).toBe(48);
		expect(result.text).toContain("maximized");
		expect(parseRandomise2Mock).not.toHaveBeenCalledWith("8d6");
	});

	it("should maximize upcast spell damage for Overcharged Spell", () => {
		const result = spells._rollSpellDamage(SAMPLE_SPELLS.fireball, 5, 3, {key: "overcharged"});

		expect(result.dice).toBe("10d6");
		expect(result.total).toBe(60);
		expect(parseRandomise2Mock).not.toHaveBeenCalledWith("10d6");
	});

	it("should maximize cantrip scaling damage for Overcharged Spell", () => {
		const result = spells._rollCantripDamage(SAMPLE_SPELLS.firebolt, {key: "overcharged"});

		expect(result.dice).toBe("2d10");
		expect(result.total).toBe(20);
		expect(result.text).toContain("maximized");
	});

	it("should add 1d6 to spell attacks for Aimed Spell", async () => {
		await spells._handleSpellEffects(
			{name: "Fire Bolt", source: "XPHB", level: 0},
			0,
			false,
			false,
			{appliedMetamagic: {key: "aimed", name: "Aimed Spell", cost: 2}},
		);

		expect(page.rollD20).toHaveBeenCalledWith({isAttack: true});
		expect(parseRandomise2Mock).toHaveBeenCalledWith("1d6");
		const toast = getLastToastContent();
		expect(toast).toContain("Spell Attack: 11 + 6 + 4 aimed = <strong>21</strong>");
	});

	it("should heal current HP from dealt damage for Vampiric Spell and cap at max HP", async () => {
		state.setHp(18, 20, 0);

		await spells._handleSpellEffects(
			{name: "Fire Bolt", source: "XPHB", level: 0},
			0,
			false,
			false,
			{appliedMetamagic: {key: "vampiric", name: "Vampiric Spell", cost: 1}},
		);

		expect(state.getHp().current).toBe(20);
		const toast = getLastToastContent();
		expect(toast).toContain("Vampiric Spell healed 2 HP");
	});

	it("should annotate Quickened Spell casts as bonus actions", async () => {
		await spells._handleSpellEffects(
			{name: "Fireball", source: "XPHB", level: 3},
			3,
			false,
			false,
			{appliedMetamagic: {key: "quickened", name: "Quickened Spell", cost: 2}},
		);

		const toast = getLastToastContent();
		expect(toast).toContain("Quickened Spell cast this spell as a bonus action");
	});

	it("should annotate Subtle Spell component removal", async () => {
		const subtleFireball = {
			...SAMPLE_SPELLS.fireball,
			components: {v: true, s: true, m: true},
		};
		spells._allSpells = [subtleFireball, SAMPLE_SPELLS.firebolt];

		await spells._handleSpellEffects(
			{name: "Fireball", source: "XPHB", level: 3},
			3,
			false,
			false,
			{appliedMetamagic: {key: "subtle", name: "Subtle Spell", cost: 1}},
		);

		const toast = getLastToastContent();
		expect(toast).toContain("Subtle Spell removed verbal and somatic components");
	});

	it("should ignore silence for Subtle Spell casts", () => {
		state.addCondition({name: "Silenced", source: "HB"});
		const subtleFireball = {
			...SAMPLE_SPELLS.fireball,
			components: {v: true, s: true, m: true},
		};

		const normalConstraint = spells._checkCastingConstraints(
			{name: "Fireball", source: "XPHB", components: {v: true, s: true}},
			subtleFireball,
			null,
		);
		expect(normalConstraint.block).toContain("silenced");

		const subtleConstraint = spells._checkCastingConstraints(
			{name: "Fireball", source: "XPHB", components: {v: true, s: true}},
			subtleFireball,
			{key: "subtle", name: "Subtle Spell", cost: 1},
		);
		expect(subtleConstraint.block).toBeNull();
		expect(subtleConstraint.checks).toEqual([]);
	});

	it("should annotate Bestowed Spell range conversion", async () => {
		const selfSpell = {
			name: "Armor of Agathys",
			source: "XPHB",
			level: 1,
			duration: [{type: "timed", duration: {amount: 1, type: "hour"}}],
			entries: ["A protective magical force surrounds you."],
			range: {type: "point", distance: {type: "self"}},
			time: [{number: 1, unit: "action"}],
			components: {v: true, s: true, m: true},
		};
		spells._allSpells = [selfSpell, SAMPLE_SPELLS.fireball, SAMPLE_SPELLS.firebolt];
		globalThis.InputUiUtil = {
			pGetUserEnum: jest.fn(async () => "Self"),
		};

		await spells._handleSpellEffects(
			{name: "Armor of Agathys", source: "XPHB", level: 1},
			1,
			false,
			false,
			{appliedMetamagic: {key: "bestowed", name: "Bestowed Spell", cost: 1}},
		);

		const toast = getLastToastContent();
		expect(toast).toContain("Bestowed Spell changed range from Self to Touch for this cast");
	});

	it("should allow Bestowed Spell to target another creature instead of auto-targeting self", async () => {
		const selfHealingSpell = {
			name: "Renewing Ward",
			source: "TGTT",
			level: 2,
			duration: [{type: "instant"}],
			entries: ["A creature regains {@dice 2d8} hit points."],
			miscTags: ["HL"],
			range: {type: "point", distance: {type: "self"}},
			time: [{number: 1, unit: "action"}],
		};
		spells._allSpells = [selfHealingSpell, SAMPLE_SPELLS.fireball, SAMPLE_SPELLS.firebolt];
		state.setHp(10, 20, 0);
		globalThis.InputUiUtil = {
			pGetUserEnum: jest.fn(async () => "Another creature"),
		};

		await spells._handleSpellEffects(
			{name: "Renewing Ward", source: "TGTT", level: 2},
			2,
			false,
			false,
			{appliedMetamagic: {key: "bestowed", name: "Bestowed Spell", cost: 2}},
		);

		expect(globalThis.InputUiUtil.pGetUserEnum).toHaveBeenCalled();
		expect(state.getHp().current).toBe(10);
		const toast = getLastToastContent();
		expect(toast).toContain("Cast Renewing Ward");
		expect(toast).toContain("Bestowed Spell changed range from Self to Touch for this cast");
	});

	it("should annotate Heightened Spell disadvantage on the first save", async () => {
		await spells._handleSpellEffects(
			{name: "Fireball", source: "XPHB", level: 3},
			3,
			false,
			false,
			{appliedMetamagic: {key: "heightened", name: "Heightened Spell", cost: 3}},
		);

		const toast = getLastToastContent();
		expect(toast).toContain("Save DC: <strong>14</strong> (dexterity save; first target rolls at disadvantage)");
		expect(toast).toContain("Heightened Spell gives the first target disadvantage on its initial save");
	});

	it("should reroll a missed spell attack for Seeking Spell when chosen", async () => {
		page.rollD20 = jest.fn()
			.mockReturnValueOnce({roll: 5})
			.mockReturnValueOnce({roll: 17});
		globalThis.InputUiUtil = {
			pGetUserBoolean: jest.fn(async () => true),
		};

		await spells._handleSpellEffects(
			{name: "Fire Bolt", source: "XPHB", level: 0},
			0,
			false,
			false,
			{appliedMetamagic: {key: "seeking", name: "Seeking Spell", cost: 2}},
		);

		expect(globalThis.InputUiUtil.pGetUserBoolean).toHaveBeenCalled();
		expect(page.rollD20).toHaveBeenCalledTimes(2);
		const toast = getLastToastContent();
		expect(toast).toContain("Spell Attack: 17 + 6 = <strong>23</strong>");
		expect(toast).toContain("rerolled from 5");
		expect(toast).toContain("Seeking Spell rerolled the missed spell attack from 5 to 17");
	});

	it("should track Focused Spell concentration reroll availability on cast concentration", () => {
		state.setConcentration({name: "Fly", level: 3, appliedMetamagic: {key: "focused", name: "Focused Spell", cost: 3}});

		expect(state.canUseFocusedConcentrationReroll()).toBe(true);
		expect(state.useFocusedConcentrationReroll()).toBe(true);
		expect(state.canUseFocusedConcentrationReroll()).toBe(false);
	});

	it("should preserve lingering spell effects for one round when concentration breaks in combat", () => {
		state.startCombat();
		state.setConcentration({name: "Fly", level: 3, appliedMetamagic: {key: "lingering", name: "Lingering Spell", cost: 3}});
		const stateId = state.addActiveState("custom", {
			name: "Fly",
			isSpellEffect: true,
			concentration: true,
			duration: "Concentration, up to 10 minutes",
		});

		state.breakConcentration();

		const lingeringState = state.getActiveStates().find(it => it.id === stateId);
		expect(lingeringState).toBeDefined();
		expect(lingeringState.active).toBe(true);
		expect(lingeringState.concentration).toBe(false);
		expect(lingeringState.duration).toBe("until end of next turn");
		expect(lingeringState.roundsRemaining).toBe(1);
	});

	it("should remove non-lingering concentration spell effects immediately on concentration break", () => {
		state.startCombat();
		state.setConcentration({name: "Fly", level: 3});
		const stateId = state.addActiveState("custom", {
			name: "Fly",
			isSpellEffect: true,
			concentration: true,
			duration: "Concentration, up to 10 minutes",
		});

		state.breakConcentration();

		expect(state.getActiveStates().find(it => it.id === stateId)).toBeUndefined();
	});

	it("should use Focused Spell to reroll a failed concentration save once", async () => {
		const combat = Object.create(globalThis.CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = page;
		combat.renderCombatStates = jest.fn();
		combat._updateQuickButtonStates = jest.fn();

		let concentrateClickHandler;
		const handlers = {};
		const stubEl = (id) => {
			const el = {
				style: {},
				_onclick: null,
				get onclick () { return this._onclick; },
				set onclick (fn) { this._onclick = fn; if (id) handlers[id] = fn; },
				addEventListener: jest.fn(),
				setAttribute: jest.fn(),
				getAttribute: jest.fn(),
				classList: {add: jest.fn(), remove: jest.fn(), toggle: jest.fn(), contains: jest.fn()},
				querySelector: jest.fn(() => null),
				querySelectorAll: jest.fn(() => []),
				innerHTML: "",
				firstChild: {attributes: []},
			};
			return el;
		};
		const elMap = {};
		globalThis.document = {
			getElementById: jest.fn((id) => {
				if (!elMap[id]) elMap[id] = stubEl(id);
				return elMap[id];
			}),
			createElement: jest.fn(() => stubEl()),
		};
		globalThis.HASH_LIST_SEP = globalThis.HASH_LIST_SEP || "|";
		globalThis.Parser = {
			...(globalThis.Parser || {}),
			SRC_XPHB: "XPHB",
		};
		globalThis.UrlUtil = {
			...(globalThis.UrlUtil || {}),
			PG_ACTIONS: "actions.html",
			encodeForHash: jest.fn(str => str),
		};
		globalThis.Renderer = globalThis.Renderer || {};
		globalThis.Renderer.hover = {
			...(globalThis.Renderer.hover || {}),
			getHoverElementAttributes: jest.fn(() => "data-hover='1'"),
		};
		globalThis.InputUiUtil = {
			pGetUserString: jest.fn(async () => "22"),
		};

		state.setConcentration({name: "Fly", level: 3, appliedMetamagic: {key: "focused", name: "Focused Spell", cost: 3}});
		rollDiceMock
			.mockReturnValueOnce(3)
			.mockReturnValueOnce(17);

		combat._initQuickStateButtons();
		await handlers["charsheet-combat-conc-save"]();

		expect(state.isConcentrating()).toBe(true);
		expect(state.canUseFocusedConcentrationReroll()).toBe(false);
		const toast = getLastToastContent();
		expect(toast).toContain("Focused Spell rerolled the concentration die");
		expect(toast).toContain("SUCCESS - Concentration maintained");
	});

	it("should change damage type when Transmuted Spell is tuned and user picks a new type", async () => {
		state.getKnownMetamagicKeys = () => ["transmuted"];
		state.setSorceryPoints(5, 5);
		state.tuneMetamagic("transmuted");

		globalThis.InputUiUtil = {
			pGetUserEnum: jest.fn(async () => "Cold"),
		};

		await spells._handleSpellEffects(
			{name: "Fireball", source: "XPHB", level: 3},
			3,
			false,
			false,
			null,
		);

		expect(globalThis.InputUiUtil.pGetUserEnum).toHaveBeenCalled();
		const enumCall = globalThis.InputUiUtil.pGetUserEnum.mock.calls.at(-1)[0];
		expect(enumCall.title).toBe("Transmuted Spell");
		expect(enumCall.values).toContain("Cold");
		expect(enumCall.values).not.toContain("Fire"); // current type excluded

		const toast = getLastToastContent();
		expect(toast).toContain("cold");
		expect(toast).toContain("Transmuted Spell changed fire → cold damage");
	});

	it("should keep original damage type when user cancels Transmuted Spell prompt", async () => {
		state.getKnownMetamagicKeys = () => ["transmuted"];
		state.setSorceryPoints(5, 5);
		state.tuneMetamagic("transmuted");

		globalThis.InputUiUtil = {
			pGetUserEnum: jest.fn(async () => null),
		};

		await spells._handleSpellEffects(
			{name: "Fireball", source: "XPHB", level: 3},
			3,
			false,
			false,
			null,
		);

		const toast = getLastToastContent();
		expect(toast).toContain("fire");
		expect(toast).not.toContain("Transmuted Spell changed");
	});

	it("should not prompt for Transmuted Spell when it is not tuned", async () => {
		state.getKnownMetamagicKeys = () => ["transmuted"];
		state.setSorceryPoints(5, 5);

		globalThis.InputUiUtil = {
			pGetUserEnum: jest.fn(async () => "Cold"),
		};

		await spells._handleSpellEffects(
			{name: "Fireball", source: "XPHB", level: 3},
			3,
			false,
			false,
			null,
		);

		const enumCalls = globalThis.InputUiUtil.pGetUserEnum.mock.calls;
		const transmutedCall = enumCalls.find(c => c[0]?.title === "Transmuted Spell");
		expect(transmutedCall).toBeUndefined();
	});

	it("should apply Transmuted Spell to cantrip damage", async () => {
		state.getKnownMetamagicKeys = () => ["transmuted"];
		state.setSorceryPoints(5, 5);
		state.tuneMetamagic("transmuted");

		globalThis.InputUiUtil = {
			pGetUserEnum: jest.fn(async () => "Lightning"),
		};

		await spells._handleSpellEffects(
			{name: "Fire Bolt", source: "XPHB", level: 0},
			0,
			false,
			false,
			null,
		);

		const toast = getLastToastContent();
		expect(toast).toContain("lightning");
		expect(toast).toContain("Transmuted Spell changed fire → lightning damage");
	});

	it("should show Aimed Spell note in metamagic notes", async () => {
		await spells._handleSpellEffects(
			{name: "Fire Bolt", source: "XPHB", level: 0},
			0,
			false,
			false,
			{appliedMetamagic: {key: "aimed", name: "Aimed Spell", cost: 2}},
		);

		const toast = getLastToastContent();
		expect(toast).toContain("Aimed Spell added 1d6 to the spell attack roll");
	});

	describe("Tuned Passive Metamagic Notes", () => {
		beforeEach(() => {
			state.getKnownMetamagicKeys = () => ["careful", "distant", "empowered", "extended", "resonant", "split", "supple"];
			state.setSorceryPoints(20, 20);
		});

		it("should show Careful Spell note for save-based spells", async () => {
			state.tuneMetamagic("careful");
			state.setAbilityBase("cha", 16); // +3 mod

			await spells._handleSpellEffects(
				{name: "Fireball", source: "XPHB", level: 3},
				3,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).toContain("Careful Spell");
			expect(toast).toContain("auto-succeed");
			expect(toast).toContain("dexterity");
		});

		it("should not show Careful Spell note for non-save spells", async () => {
			state.tuneMetamagic("careful");

			await spells._handleSpellEffects(
				{name: "Fire Bolt", source: "XPHB", level: 0},
				0,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).not.toContain("Careful Spell");
		});

		it("should show Distant Spell range doubled for ranged spells", async () => {
			state.tuneMetamagic("distant");

			await spells._handleSpellEffects(
				{name: "Fireball", source: "XPHB", level: 3},
				3,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).toContain("Distant Spell");
			expect(toast).toContain("300 feet");
		});

		it("should show Distant Spell touch-to-30ft for touch spells", async () => {
			state.tuneMetamagic("distant");
			const touchSpell = {
				name: "Cure Wounds",
				source: "XPHB",
				level: 1,
				duration: [{type: "instant"}],
				entries: ["A creature you touch regains hit points equal to {@dice 2d8} + your spellcasting ability modifier."],
				miscTags: ["HL"],
				range: {type: "point", distance: {type: "touch"}},
			};
			spells._allSpells = [touchSpell, ...Object.values(SAMPLE_SPELLS)];

			await spells._handleSpellEffects(
				{name: "Cure Wounds", source: "XPHB", level: 1},
				1,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).toContain("Distant Spell");
			expect(toast).toContain("Touch to 30 feet");
		});

		it("should show Extended Spell doubled duration", async () => {
			state.tuneMetamagic("extended");
			const timedSpell = {
				name: "Fly",
				source: "XPHB",
				level: 3,
				duration: [{type: "timed", duration: {amount: 10, type: "minute"}, concentration: true}],
				entries: ["You touch a willing creature. The target gains a flying speed of 60 feet for the duration."],
				range: {type: "point", distance: {type: "touch"}},
			};
			spells._allSpells = [timedSpell, ...Object.values(SAMPLE_SPELLS)];

			await spells._handleSpellEffects(
				{name: "Fly", source: "XPHB", level: 3},
				3,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).toContain("Extended Spell");
			expect(toast).toContain("20 minutes");
		});

		it("should cap Extended Spell duration at 24 hours", async () => {
			state.tuneMetamagic("extended");
			const longSpell = {
				name: "Mage Armor",
				source: "XPHB",
				level: 1,
				duration: [{type: "timed", duration: {amount: 24, type: "hour"}}],
				entries: ["A protective magical force surrounds the target."],
				range: {type: "point", distance: {type: "touch"}},
			};
			spells._allSpells = [longSpell, ...Object.values(SAMPLE_SPELLS)];

			await spells._handleSpellEffects(
				{name: "Mage Armor", source: "XPHB", level: 1},
				1,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).toContain("Extended Spell");
			expect(toast).toContain("24h cap");
		});

		it("should show Resonant Spell note for any spell", async () => {
			state.tuneMetamagic("resonant");

			await spells._handleSpellEffects(
				{name: "Fireball", source: "XPHB", level: 3},
				3,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).toContain("Resonant Spell");
			expect(toast).toContain("disadvantage");
		});

		it("should show Split Spell note for AoE spells (10ft+)", async () => {
			state.tuneMetamagic("split");

			await spells._handleSpellEffects(
				{name: "Fireball", source: "XPHB", level: 3},
				3,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).toContain("Split Spell");
			expect(toast).toContain("two points");
		});

		it("should not show Split Spell for non-AoE spells", async () => {
			state.tuneMetamagic("split");

			await spells._handleSpellEffects(
				{name: "Fire Bolt", source: "XPHB", level: 0},
				0,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).not.toContain("Split Spell");
		});

		it("should show Supple Spell note with correct AoE range", async () => {
			state.tuneMetamagic("supple");

			await spells._handleSpellEffects(
				{name: "Fireball", source: "XPHB", level: 3},
				3,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).toContain("Supple Spell");
			expect(toast).toContain("±10 feet");
			expect(toast).toContain("10ft to 30ft");
		});
	});

	describe("Empowered Spell interactive reroll", () => {
		beforeEach(() => {
			state.getKnownMetamagicKeys = () => ["empowered"];
			state.setSorceryPoints(10, 10);
			state.setAbilityBase("cha", 16); // +3 mod
		});

		it("should prompt to reroll damage dice when Empowered is tuned", async () => {
			state.tuneMetamagic("empowered");
			globalThis.InputUiUtil = {
				pGetUserEnum: jest.fn(async () => "Reroll 2 dice"),
			};

			await spells._handleSpellEffects(
				{name: "Fireball", source: "XPHB", level: 3},
				3,
				false,
				false,
				null,
			);

			expect(globalThis.InputUiUtil.pGetUserEnum).toHaveBeenCalled();
			const enumCall = globalThis.InputUiUtil.pGetUserEnum.mock.calls.find(
				c => c[0]?.title === "Empowered Spell",
			);
			expect(enumCall).toBeDefined();
			expect(enumCall[0].values).toContain("Keep current");
			expect(enumCall[0].values).toContain("Reroll 1 die");
			expect(enumCall[0].values).toContain("Reroll 2 dice");
			expect(enumCall[0].values).toContain("Reroll 3 dice");

			const toast = getLastToastContent();
			expect(toast).toContain("Empowered Spell rerolled 2 damage dice");
		});

		it("should not modify damage when user keeps current", async () => {
			state.tuneMetamagic("empowered");
			globalThis.InputUiUtil = {
				pGetUserEnum: jest.fn(async () => "Keep current"),
			};

			await spells._handleSpellEffects(
				{name: "Fireball", source: "XPHB", level: 3},
				3,
				false,
				false,
				null,
			);

			const toast = getLastToastContent();
			expect(toast).not.toContain("Empowered Spell rerolled");
		});

		it("should not prompt Empowered for non-damage spells", async () => {
			state.tuneMetamagic("empowered");
			const healSpell = {
				name: "Cure Wounds",
				source: "XPHB",
				level: 1,
				duration: [{type: "instant"}],
				entries: ["A creature you touch regains hit points equal to {@dice 2d8} + your spellcasting ability modifier."],
				miscTags: ["HL"],
				range: {type: "point", distance: {type: "touch"}},
			};
			spells._allSpells = [healSpell, ...Object.values(SAMPLE_SPELLS)];
			globalThis.InputUiUtil = {
				pGetUserEnum: jest.fn(async () => null),
			};

			await spells._handleSpellEffects(
				{name: "Cure Wounds", source: "XPHB", level: 1},
				1,
				false,
				false,
				null,
			);

			const empoweredCall = globalThis.InputUiUtil.pGetUserEnum?.mock.calls.find(
				c => c[0]?.title === "Empowered Spell",
			);
			expect(empoweredCall).toBeUndefined();
		});
	});

	describe("_getSpellAreaSize helper", () => {
		it("should detect AoE from structured range (cone)", () => {
			const coneSpell = {
				range: {type: "cone", distance: {type: "feet", amount: 60}},
				entries: [],
			};
			expect(spells._getSpellAreaSize(coneSpell)).toBe(60);
		});

		it("should detect AoE from entries text", () => {
			const sphereSpell = {
				range: {type: "point", distance: {type: "feet", amount: 150}},
				entries: ["Each creature in a 20-foot-radius Sphere takes damage."],
			};
			expect(spells._getSpellAreaSize(sphereSpell)).toBe(20);
		});

		it("should return 0 for non-AoE spells", () => {
			const singleTarget = {
				range: {type: "point", distance: {type: "feet", amount: 120}},
				entries: ["Make a ranged spell attack against the target."],
			};
			expect(spells._getSpellAreaSize(singleTarget)).toBe(0);
		});
	});

	describe("Duration helper methods", () => {
		it("should convert durations to minutes correctly", () => {
			expect(spells._getDurationInMinutes({duration: {amount: 1, type: "minute"}})).toBe(1);
			expect(spells._getDurationInMinutes({duration: {amount: 1, type: "hour"}})).toBe(60);
			expect(spells._getDurationInMinutes({duration: {amount: 1, type: "day"}})).toBe(1440);
		});

		it("should format minutes back to readable strings", () => {
			expect(spells._formatDurationMinutes(10)).toBe("10 minutes");
			expect(spells._formatDurationMinutes(60)).toBe("1 hour");
			expect(spells._formatDurationMinutes(120)).toBe("2 hours");
			expect(spells._formatDurationMinutes(1440)).toBe("1 day");
		});
	});

	describe("getModifiedSpellStats passive metamagic notes", () => {
		beforeEach(() => {
			state.getKnownMetamagicKeys = () => ["careful", "distant", "empowered", "extended", "transmuted", "resonant", "split", "supple", "warding"];
			state.setSorceryPoints(20, 20);
		});

		const FIREBALL_DATA = {
			name: "Fireball",
			source: "XPHB",
			level: 3,
			range: {type: "point", distance: {type: "feet", amount: 150}},
			duration: [{type: "instant"}],
			savingThrow: ["dexterity"],
			damageInflict: ["fire"],
			entries: ["Each creature in a 20-foot-radius Sphere centered on that point must make a Dexterity saving throw."],
		};

		const HOLD_PERSON_DATA = {
			name: "Hold Person",
			source: "XPHB",
			level: 2,
			range: {type: "point", distance: {type: "feet", amount: 60}},
			duration: [{type: "timed", duration: {amount: 1, type: "minute"}, concentration: true}],
			savingThrow: ["wisdom"],
			entries: ["The target must succeed on a Wisdom saving throw or be paralyzed."],
		};

		const FIRE_BOLT_DATA = {
			name: "Fire Bolt",
			source: "XPHB",
			level: 0,
			range: {type: "point", distance: {type: "feet", amount: 120}},
			duration: [{type: "instant"}],
			damageInflict: ["fire"],
			entries: ["Make a ranged spell attack against the target."],
		};

		it("should add Careful note for save-based spells", () => {
			state.tuneMetamagic("careful");
			const result = state.getModifiedSpellStats(FIREBALL_DATA);
			expect(result.notes).toEqual(expect.arrayContaining([
				expect.stringContaining("Careful"),
			]));
			expect(result.notes.find(n => n.includes("Careful"))).toContain("auto-succeed");
		});

		it("should not add Careful note for non-save spells", () => {
			state.tuneMetamagic("careful");
			const result = state.getModifiedSpellStats(FIRE_BOLT_DATA);
			expect(result.notes.find(n => n.includes("Careful"))).toBeUndefined();
		});

		it("should add Empowered note with CHA mod for damage spells", () => {
			state.setAbilityBase("cha", 16); // +3 mod
			state.tuneMetamagic("empowered");
			const result = state.getModifiedSpellStats(FIREBALL_DATA);
			const note = result.notes.find(n => n.includes("Empowered"));
			expect(note).toBeDefined();
			expect(note).toContain("3");
		});

		it("should not add Empowered note for non-damage spells", () => {
			state.tuneMetamagic("empowered");
			const result = state.getModifiedSpellStats(HOLD_PERSON_DATA);
			expect(result.notes.find(n => n.includes("Empowered"))).toBeUndefined();
		});

		it("should add Transmuted note for damage spells", () => {
			state.tuneMetamagic("transmuted");
			const result = state.getModifiedSpellStats(FIREBALL_DATA);
			const note = result.notes.find(n => n.includes("Transmuted"));
			expect(note).toBeDefined();
			expect(note).toContain("damage type");
		});

		it("should not add Transmuted note for non-damage spells", () => {
			state.tuneMetamagic("transmuted");
			const result = state.getModifiedSpellStats(HOLD_PERSON_DATA);
			expect(result.notes.find(n => n.includes("Transmuted"))).toBeUndefined();
		});

		it("should add Resonant note for any spell", () => {
			state.tuneMetamagic("resonant");
			const result = state.getModifiedSpellStats(FIRE_BOLT_DATA);
			const note = result.notes.find(n => n.includes("Resonant"));
			expect(note).toBeDefined();
			expect(note).toContain("disadvantage");
		});

		it("should add Warding note for concentration spells", () => {
			state.tuneMetamagic("warding");
			const result = state.getModifiedSpellStats(HOLD_PERSON_DATA);
			const note = result.notes.find(n => n.includes("Warding"));
			expect(note).toBeDefined();
			expect(note).toContain("AC +1");
		});

		it("should not add Warding note for non-concentration spells", () => {
			state.tuneMetamagic("warding");
			const result = state.getModifiedSpellStats(FIREBALL_DATA);
			expect(result.notes.find(n => n.includes("Warding"))).toBeUndefined();
		});

		it("should show Distant range doubling", () => {
			state.tuneMetamagic("distant");
			const result = state.getModifiedSpellStats(FIREBALL_DATA);
			expect(result.range.changed).toBe(true);
			expect(result.range.modified).toBe("300 feet");
		});

		it("should show Extended duration doubling", () => {
			state.tuneMetamagic("extended");
			const result = state.getModifiedSpellStats(HOLD_PERSON_DATA);
			expect(result.duration.changed).toBe(true);
			expect(result.duration.modified).toBe("2 minutes");
		});

		it("should combine multiple passive metamagic notes", () => {
			state.tuneMetamagic("careful");
			state.tuneMetamagic("resonant");
			const result = state.getModifiedSpellStats(FIREBALL_DATA);
			expect(result.notes.find(n => n.includes("Careful"))).toBeDefined();
			expect(result.notes.find(n => n.includes("Resonant"))).toBeDefined();
		});
	});

	describe("tuneMetamagic sorcery point validation", () => {
		beforeEach(() => {
			state.getKnownMetamagicKeys = () => ["careful", "distant", "extended", "resonant"];
		});

		it("should reject tuning when current SP is 0 but max > 0", () => {
			state.setSorceryPoints({current: 0, max: 5});
			expect(state.tuneMetamagic("careful")).toBe(false);
			expect(state.getTunedMetamagics()).not.toContain("careful");
		});

		it("should reject tuning when current SP is less than cost", () => {
			state.setSorceryPoints({current: 1, max: 5});
			// Resonant costs 2 SP
			expect(state.tuneMetamagic("resonant")).toBe(false);
			expect(state.getTunedMetamagics()).not.toContain("resonant");
		});

		it("should allow tuning when current SP equals cost", () => {
			state.setSorceryPoints({current: 1, max: 5});
			// Careful costs 1 SP
			expect(state.tuneMetamagic("careful")).toBe(true);
			expect(state.getTunedMetamagics()).toContain("careful");
		});

		it("should allow tuning when current SP exceeds cost", () => {
			state.setSorceryPoints({current: 5, max: 5});
			expect(state.tuneMetamagic("resonant")).toBe(true);
			expect(state.getTunedMetamagics()).toContain("resonant");
		});

		it("should reduce both max and current after successful tune", () => {
			state.setSorceryPoints({current: 5, max: 5});
			state.tuneMetamagic("careful"); // cost 1
			const sp = state.getSorceryPoints();
			expect(sp.max).toBe(4);
			expect(sp.current).toBe(4);
		});

		it("should reject tuning when max SP is 0 (all locked)", () => {
			state.setSorceryPoints({current: 2, max: 2});
			state.tuneMetamagic("careful"); // cost 1, now max=1, current=1
			state.tuneMetamagic("distant"); // cost 1, now max=0, current=0
			expect(state.tuneMetamagic("extended")).toBe(false);
			expect(state.getTunedMetamagics()).not.toContain("extended");
		});

		it("should reject tuning when no SP resource exists", () => {
			// Fresh state with no Sorcery Points resource
			const freshState = new CharacterSheetState();
			freshState.getKnownMetamagicKeys = () => ["careful"];
			expect(freshState.tuneMetamagic("careful")).toBe(false);
		});

		it("should restore max on detune", () => {
			state.setSorceryPoints({current: 5, max: 5});
			state.tuneMetamagic("careful"); // cost 1, max=4, current=4
			expect(state.getSorceryPoints().max).toBe(4);
			state.detuneMetamagic("careful");
			expect(state.getSorceryPoints().max).toBe(5);
			expect(state.getTunedMetamagics()).not.toContain("careful");
		});

		it("should not allow tuning with current=0 even after detune restores max", () => {
			state.setSorceryPoints({current: 1, max: 5});
			state.tuneMetamagic("careful"); // cost 1, max=4, current=0
			state.detuneMetamagic("careful"); // max=5, current=0
			expect(state.getSorceryPoints().max).toBe(5);
			expect(state.getSorceryPoints().current).toBe(0);
			// Cannot re-tune because current is still 0
			expect(state.tuneMetamagic("careful")).toBe(false);
		});
	});
});