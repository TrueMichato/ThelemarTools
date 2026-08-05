/**
 * Character Sheet — Ioun Stone manager
 *
 * The manager deliberately adds NO mechanics: `_calculateItemBonuses` already gates a
 * stone's benefit on `equipped && attuned`, which is exactly the book's two-stage state
 * (in orbit / bonded). What the module owns is the vocabulary and the maths on top:
 * which stones exist, what state each is in, how long the next bond takes, and which
 * collection thresholds have been crossed.
 *
 * These tests pin the parts a future contributor could plausibly "tidy up" into being
 * wrong — the deliberately narrow definition of "spent", the bond-time floor, the
 * exclusion of Ioun Geode/Sand, and the additive TGTT boundary which extends the bond
 * rules to official stones without disabling intrinsic item-text bonds in RAW mode.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-ioun.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetIoun = globalThis.CharacterSheetIoun;

const BOND_TEXT = "An Ioun bond is a special form of attunement and doesn't count against the number of magic items to which a creature can normally be attuned.";

/** A homebrew stone, with the rules block nested as deep as the real brew nests it. */
function makeStone (name, {sourceType, charges, entries} = {}) {
	const stoneEffect = {
		type: "entries",
		name: "Stone Effect",
		entries: entries || ["It grants a boon while it orbits your head."],
	};
	if (sourceType) {
		stoneEffect.entries = [
			`{@b Source Type:} {@variantrule Ioun Source Type: ${sourceType}|MECIounStones|${sourceType}}`,
			...stoneEffect.entries,
		];
	}
	const out = {
		name,
		source: "MECIounStones",
		type: "wondrous",
		weight: 0,
		requiresAttunement: true,
		entries: [
			stoneEffect,
			{
				type: "entries",
				name: "General Ioun Stone Rules",
				entries: [{type: "entries", name: "Ioun Bond", entries: [BOND_TEXT]}],
			},
		],
	};
	if (charges != null) out.charges = charges;
	return out;
}

/** An official stone: ordinary attunement, no Source Type, no bond text. */
function makeOfficialStone (name) {
	return {
		name,
		source: "DMG",
		type: "wondrous",
		weight: 0,
		requiresAttunement: true,
		entries: ["This stone orbits your head at a distance of 1d3 feet."],
	};
}

/**
 * Page stub that mirrors the REAL `CharacterSheetPage` API surface.
 *
 * Regression guard: an earlier version of this stub exposed a `render()` method. The page class
 * has no such method — the sheet-wide repaint is `_renderCharacter()`. Because the module
 * optional-chains its page calls, the mismatch failed silently in production (the modal repainted
 * itself and looked correct, while the inventory and combat panel stayed stale), and the stub
 * happily manufactured the missing method so every test still passed.
 *
 * The Proxy makes that impossible to repeat: touching any property the real page doesn't define
 * throws instead of quietly returning `undefined`. Keep `PAGE_API` in sync with
 * `js/charactersheet/charactersheet.js`.
 */
const PAGE_API = ["getState", "saveCharacter", "_renderCharacter"];

function makePage (state, spy = {}) {
	spy.renders = 0;
	spy.saves = 0;
	const target = {
		getState: () => state,
		saveCharacter: () => { spy.saves++; },
		_renderCharacter: () => { spy.renders++; },
	};
	return new Proxy(target, {
		get (obj, prop) {
			if (typeof prop === "symbol" || prop === "then") return obj[prop];
			if (!PAGE_API.includes(prop)) {
				throw new Error(`Ioun module called page method "${String(prop)}", which does not exist on CharacterSheetPage. Real API: ${PAGE_API.join(", ")}`);
			}
			return obj[prop];
		},
	});
}

function addStone (state, item, {equipped = false, attuned = false} = {}) {
	state.addItem(item);
	const items = state.getItems();
	const added = items[items.length - 1];
	if (equipped) state.setItemEquipped(added.id, true);
	if (attuned) state.attune(added.id);
	return state.getItems().find(i => i.id === added.id);
}

function makeSheet (stones = []) {
	const state = new CharacterSheetState();
	stones.forEach(({item, ...opts}) => addStone(state, item, opts));
	const spy = {};
	return {state, spy, ioun: new CharacterSheetIoun(makePage(state, spy))};
}

describe("CharacterSheetIoun — detection", () => {
	it("recognises homebrew and official Ioun Stones alike", () => {
		expect(CharacterSheetIoun.isIounStone(makeStone("Ioun Stone #001, Pale Blue Rhomboid"))).toBe(true);
		expect(CharacterSheetIoun.isIounStone(makeOfficialStone("Ioun Stone of Absorption"))).toBe(true);
	});

	it("excludes Ioun Geode and Ioun Sand — raw materials, not stones, and neither orbits", () => {
		expect(CharacterSheetIoun.isIounStone({name: "Ioun Geode", entries: ["A geode."]})).toBe(false);
		expect(CharacterSheetIoun.isIounStone({name: "Ioun Sand", entries: ["Powdered stone."]})).toBe(false);
	});

	it("excludes ordinary magic items", () => {
		expect(CharacterSheetIoun.isIounStone({name: "Ring of Protection", entries: ["+1 AC."]})).toBe(false);
	});

	it("detects intrinsic bond text without applying character settings", () => {
		expect(CharacterSheetIoun.usesIounBond(makeStone("Ioun Stone #002, Dusty Rose Prism"))).toBe(true);
		expect(CharacterSheetIoun.usesIounBond(makeOfficialStone("Ioun Stone of Protection"))).toBe(false);
	});

	it("extends the effective bond policy to official stones only while TGTT is enabled", () => {
		const state = new CharacterSheetState();
		const official = makeOfficialStone("Ioun Stone of Protection");
		expect(CharacterSheetIoun.usesIounBond(official, {state})).toBe(true);

		state.setSetting("enableTgtt", false);
		expect(CharacterSheetIoun.usesIounBond(official, {state})).toBe(false);
		expect(CharacterSheetIoun.usesIounBond(makeStone("Ioun Stone #002, Dusty Rose Prism"), {state})).toBe(true);
	});

	it("resolves the {#itemEntry} reference the real brew hides its bond text behind", () => {
		// THE regression that silently disabled the feature in the live app: item entries are
		// dereferenced at RENDER time, so a held item still carries the raw reference string.
		// Every real Moorchlyne stone keeps its bond text there and nowhere else.
		const referencing = {
			name: "Ioun Stone #900, Grey Sphere",
			source: "MECIounStones",
			entries: [
				{type: "entries", name: "Stone Effect", entries: ["A boon."]},
				{type: "entries", name: "General Ioun Stone Rules", entries: ["{#itemEntry Moorchlyne Ioun Stone|MECIounStones}"]},
			],
		};
		// Nothing to resolve against yet -> correctly does not claim the homebrew ruleset.
		expect(CharacterSheetIoun.usesIounBond(referencing)).toBe(false);

		globalThis.Renderer = globalThis.Renderer || {};
		globalThis.Renderer.item = globalThis.Renderer.item || {};
		globalThis.Renderer.item.entryMap = {
			MECIounStones: {
				"Moorchlyne Ioun Stone": {
					name: "Moorchlyne Ioun Stone",
					entriesTemplate: [{type: "entries", name: "Ioun Bond", entries: [BOND_TEXT]}],
				},
			},
		};
		try {
			expect(CharacterSheetIoun.usesIounBond(referencing)).toBe(true);
			// And the slot exemption, which reads the same text, must agree.
			expect(new CharacterSheetState().isAttunementExempt(referencing)).toBe(true);
		} finally {
			delete globalThis.Renderer.item.entryMap;
		}
	});

	it("survives a self-referential itemEntry without recursing forever", () => {
		globalThis.Renderer = globalThis.Renderer || {};
		globalThis.Renderer.item = globalThis.Renderer.item || {};
		globalThis.Renderer.item.entryMap = {
			X: {Loop: {name: "Loop", entries: ["{#itemEntry Loop|X}", BOND_TEXT]}},
		};
		try {
			const item = {name: "Ioun Stone #901, Grey Sphere", entries: ["{#itemEntry Loop|X}"]};
			expect(CharacterSheetIoun.usesIounBond(item)).toBe(true);
		} finally {
			delete globalThis.Renderer.item.entryMap;
		}
	});

	it("finds the bond text even though it sits two sub-blocks deep", () => {
		// A shallow walk would silently see nothing here — this is the regression that
		// would make every homebrew stone look official.
		const nested = makeStone("Ioun Stone #003, Deep Red Sphere");
		nested.name = "Mystery Orbiter";
		expect(CharacterSheetIoun.isIounStone(nested)).toBe(true);
	});

	it("splits number from descriptor, and strips the super-charged suffix", () => {
		const base = makeStone("Ioun Stone #017, Pale Blue Rhomboid");
		const superCharged = makeStone("Ioun Stone #017, Pale Blue Rhomboid (Super-Charged)");
		expect(CharacterSheetIoun.getStoneNumber(base)).toBe("#017");
		expect(CharacterSheetIoun.getStoneDescriptor(base)).toBe("Pale Blue Rhomboid");
		// The pair shares a descriptor, which is what makes the duplicate warning correct.
		expect(CharacterSheetIoun.getStoneDescriptor(superCharged)).toBe("Pale Blue Rhomboid");
		expect(CharacterSheetIoun.isSuperCharged(superCharged)).toBe(true);
		expect(CharacterSheetIoun.isSuperCharged(base)).toBe(false);
	});

	it("reads Source Types off the variantrule line, and yields none for official stones", () => {
		const types = CharacterSheetIoun.getSourceTypes(makeStone("Ioun Stone #004, Grey Ovoid", {sourceType: "Voluntary (V)"}));
		expect(types).toHaveLength(1);
		expect(types[0]).toMatchObject({code: "V", label: "Voluntary", short: "Voluntary (V)"});
		expect(CharacterSheetIoun.getSourceTypes(makeOfficialStone("Ioun Stone of Insight"))).toEqual([]);
	});

	it("derives a swatch colour, shading it by any preceding modifier", () => {
		const plain = CharacterSheetIoun.getSwatchColor(makeStone("Ioun Stone #005, Blue Sphere"));
		const paled = CharacterSheetIoun.getSwatchColor(makeStone("Ioun Stone #006, Pale Blue Rhomboid"));
		expect(plain).toMatch(/^#[0-9a-f]{6}$/);
		expect(paled).toMatch(/^#[0-9a-f]{6}$/);
		expect(paled).not.toBe(plain);
		// No colour word -> null, so the caller renders a neutral swatch, never a wrong one.
		expect(CharacterSheetIoun.getSwatchColor({name: "Fused Ioun Stones"})).toBeNull();
	});
});

describe("CharacterSheetIoun — stone state", () => {
	it("treats orbit, not attunement, as the state that confers the benefit", () => {
		expect(CharacterSheetIoun.getStoneState({equipped: true})).toBe("orbiting");
		expect(CharacterSheetIoun.getStoneState({equipped: false})).toBe("stowed");
	});

	it("only calls a stone spent when its Source Type can never recharge", () => {
		const single = makeStone("Ioun Stone #007, Wine Ellipsoid", {sourceType: "Single-Use (S)", charges: 1});
		const daily = makeStone("Ioun Stone #008, Amber Prism", {sourceType: "Voluntary (V)", charges: 1});
		// An ordinary daily stone at zero charges is merely EMPTY UNTIL DAWN. Calling that
		// "spent" would be a lie the player acts on.
		expect(CharacterSheetIoun.getStoneState({...single, chargesCurrent: 0, equipped: true})).toBe("spent");
		expect(CharacterSheetIoun.getStoneState({...daily, chargesCurrent: 0, equipped: true})).toBe("orbiting");
	});

	it("treats an absent chargesCurrent as FULL, so a newly acquired stone is not born spent", () => {
		// The sheet only writes `chargesCurrent` once a charge is spent (`chargesCurrent ?? charges`
		// is the convention throughout the inventory). Reading it as 0 marked every fresh
		// multi-charge stone as SPENT the moment it entered the bag.
		// Charge-Holding is both terminal (can genuinely be spent for good) and actionable
		// (the player chooses to spend it) — the exact combination the bug corrupted.
		const fresh = makeStone("Ioun Stone #030, Pale Lavender Ellipsoid", {sourceType: "Charge-Holding (C)", charges: 25});
		expect(fresh.chargesCurrent).toBeUndefined();
		expect(CharacterSheetIoun.getChargesRemaining(fresh)).toBe(25);
		expect(CharacterSheetIoun.getStoneState({...fresh, equipped: true})).toBe("orbiting");
		expect(CharacterSheetIoun.isActionableNow({...fresh, equipped: true})).toBe(true);
		// ...and it still becomes spent once genuinely drained.
		expect(CharacterSheetIoun.getStoneState({...fresh, equipped: true, chargesCurrent: 0})).toBe("spent");
	});

	it("marks a stone actionable only when orbiting, spendable-by-type, and holding a charge", () => {
		const v = makeStone("Ioun Stone #009, Jade Cube", {sourceType: "Voluntary (V)", charges: 2});
		expect(CharacterSheetIoun.isActionableNow({...v, equipped: true, chargesCurrent: 1})).toBe(true);
		expect(CharacterSheetIoun.isActionableNow({...v, equipped: true, chargesCurrent: 0})).toBe(false);
		expect(CharacterSheetIoun.isActionableNow({...v, equipped: false, chargesCurrent: 1})).toBe(false);
		// Permanent stones are always-on; there is nothing to "use".
		const p = makeStone("Ioun Stone #010, Iron Sphere", {sourceType: "Permanent (P)"});
		expect(CharacterSheetIoun.isActionableNow({...p, equipped: true})).toBe(false);
	});
});

describe("CharacterSheetIoun — collection maths", () => {
	it("shortens the next bond by one day per orbiting stone, with a hard floor of 3", () => {
		expect(CharacterSheetIoun.getBondDaysRequired(0)).toBe(7);
		expect(CharacterSheetIoun.getBondDaysRequired(3)).toBe(4);
		expect(CharacterSheetIoun.getBondDaysRequired(4)).toBe(3);
		// The floor must hold no matter how large the collection grows.
		expect(CharacterSheetIoun.getBondDaysRequired(40)).toBe(3);
		expect(CharacterSheetIoun.getBondDaysRequired(-5)).toBe(7);
	});
});

describe("CharacterSheetIoun — reading the character", () => {
	it("becomes applicable for the first bondable stone", () => {
		const {ioun} = makeSheet([{item: makeStone("Ioun Stone #011, Grey Sphere")}]);
		expect(ioun.isApplicable()).toBe(true);
		expect(ioun.getBondableStones()).toHaveLength(1);
	});

	it("becomes applicable once a stone is bonded", () => {
		const {ioun} = makeSheet([{item: makeStone("Ioun Stone #012, Grey Sphere"), attuned: true}]);
		expect(ioun.isApplicable()).toBe(true);
	});

	it("becomes applicable while a bond is merely in progress, before anything is attuned", () => {
		const {state, ioun} = makeSheet([{item: makeStone("Ioun Stone #013, Grey Sphere")}]);
		state.setIounBondDays(ioun.getAllStones()[0].id, 2);
		expect(ioun.isApplicable()).toBe(true);
		expect(ioun.getBondedStones()).toHaveLength(0);
	});

	it("offers official and intrinsic-text stones while TGTT is enabled, and never re-offers one already bonding", () => {
		const {state, ioun} = makeSheet([
			{item: makeStone("Ioun Stone #014, Grey Sphere")},
			{item: makeOfficialStone("Ioun Stone of Awareness")},
		]);
		expect(ioun.getBondableStones().map(s => s.name)).toEqual([
			"Ioun Stone #014, Grey Sphere",
			"Ioun Stone of Awareness",
		]);
		state.setIounBondDays(ioun.getBondableStones()[0].id, 1);
		expect(ioun.getBondableStones().map(s => s.name)).toEqual(["Ioun Stone of Awareness"]);
		expect(ioun.getBondingStones()).toHaveLength(1);
	});

	it("keeps intrinsic bonds but withholds the official-stone extension while TGTT is disabled", () => {
		const {state, ioun} = makeSheet([
			{item: makeStone("Ioun Stone #014, Grey Sphere")},
			{item: makeOfficialStone("Ioun Stone of Awareness")},
		]);
		state.setSetting("enableTgtt", false);
		expect(ioun.getBondableStones().map(s => s.name)).toEqual(["Ioun Stone #014, Grey Sphere"]);
		expect(ioun.startBond(ioun.getAllStones().find(s => s.name === "Ioun Stone of Awareness").id)).toBe(false);
	});

	it("pauses an official bond while TGTT is disabled and resumes it when re-enabled", () => {
		const {state, ioun} = makeSheet([{item: makeOfficialStone("Ioun Stone of Awareness")}]);
		const id = ioun.getAllStones()[0].id;
		expect(ioun.startBond(id)).toBe(true);
		ioun.advanceBondDay();
		expect(state.getIounBonds()[id]).toBe(1);

		state.setSetting("enableTgtt", false);
		expect(ioun.getBondingStones()).toHaveLength(0);
		expect(ioun.advanceBondDay()).toEqual({advanced: 0, completed: []});
		expect(state.getIounBonds()[id]).toBe(1);

		state.setSetting("enableTgtt", true);
		expect(ioun.getBondingStones()).toHaveLength(1);
	});

	it("warns only when two ORBITING stones share a colour and shape", () => {
		const {state, ioun} = makeSheet([
			{item: makeStone("Ioun Stone #015, Pale Blue Rhomboid"), attuned: true, equipped: true},
			{item: makeStone("Ioun Stone #015, Pale Blue Rhomboid (Super-Charged)"), attuned: true},
		]);
		// The second is bonded but stowed, so no benefit is being lost yet.
		expect(ioun.getDuplicateDescriptors()).toEqual([]);
		state.setItemEquipped(ioun.getBondedStones()[1].id, true);
		expect(ioun.getDuplicateDescriptors()).toEqual(["pale blue rhomboid"]);
	});
});

describe("CharacterSheetIoun — actions", () => {
	it("stows every orbiting stone in one call, and reports how many", () => {
		const {ioun} = makeSheet([
			{item: makeStone("Ioun Stone #016, Grey Sphere"), attuned: true, equipped: true},
			{item: makeStone("Ioun Stone #017, Jade Cube"), attuned: true, equipped: true},
			{item: makeStone("Ioun Stone #018, Amber Prism"), attuned: true},
		]);
		expect(ioun.stowAll()).toBe(2);
		expect(ioun.getOrbitingStones()).toHaveLength(0);
	});

	it("refuses to toggle a spent stone", () => {
		const {state, ioun} = makeSheet([
			{item: makeStone("Ioun Stone #019, Wine Ellipsoid", {sourceType: "Single-Use (S)", charges: 1}), attuned: true, equipped: true},
		]);
		const stone = ioun.getBondedStones()[0];
		state.setItemCharges(stone.id, 0);
		expect(CharacterSheetIoun.getStoneState(ioun.getBondedStones()[0])).toBe("spent");
		expect(ioun.toggleOrbit(stone.id)).toBe(false);
	});

	it("completes a bond after the required consecutive days, then attunes the stone", () => {
		const {state, ioun} = makeSheet([{item: makeStone("Ioun Stone #020, Grey Sphere")}]);
		const id = ioun.getAllStones()[0].id;
		ioun.startBond(id);

		// Nothing in orbit, so the full 7 days are needed.
		for (let i = 0; i < 6; ++i) {
			expect(ioun.advanceBondDay().completed).toHaveLength(0);
		}
		const {completed} = ioun.advanceBondDay();
		expect(completed).toHaveLength(1);
		expect(ioun.getBondedStones()).toHaveLength(1);
		// The bond record is cleared once it has been converted into attunement.
		expect(state.getIounBonds()[id]).toBeUndefined();
	});

	it("completes an official-stone bond while every ordinary attunement slot is full", () => {
		const {state, ioun} = makeSheet([{item: makeOfficialStone("Ioun Stone of Protection")}]);
		for (let i = 0; i < 3; ++i) {
			state.addItem({
				name: `Ring ${i}`,
				source: "DMG",
				type: "wondrous",
				requiresAttunement: true,
				entries: ["A plain magic ring."],
			});
			expect(state.attune(state.getItems().at(-1).id)).toBe(true);
		}

		const id = ioun.getAllStones()[0].id;
		expect(state.getAttunedCount()).toBe(3);
		expect(state.canAttune()).toBe(false);
		expect(ioun.startBond(id)).toBe(true);
		for (let i = 0; i < 6; ++i) expect(ioun.advanceBondDay().completed).toHaveLength(0);

		expect(ioun.advanceBondDay().completed.map(it => it.id)).toEqual([id]);
		expect(state.getItems().find(it => it.id === id).attuned).toBe(true);
		expect(state.getAttunedCount()).toBe(3);
		expect(state.getIounBonds()[id]).toBeUndefined();
	});

	it("recomputes the requirement live, so orbiting stones shorten a bond already underway", () => {
		const {ioun} = makeSheet([
			{item: makeStone("Ioun Stone #021, Grey Sphere"), attuned: true, equipped: true},
			{item: makeStone("Ioun Stone #022, Jade Cube"), attuned: true, equipped: true},
			{item: makeStone("Ioun Stone #023, Amber Prism"), attuned: true, equipped: true},
			{item: makeStone("Ioun Stone #024, Iron Sphere")},
		]);
		const target = ioun.getBondableStones()[0];
		ioun.startBond(target.id);

		// 3 orbiting -> 7 - 3 = 4 days.
		expect(ioun.getCombatSummary().nextBondDays).toBe(4);
		for (let i = 0; i < 3; ++i) expect(ioun.advanceBondDay().completed).toHaveLength(0);
		expect(ioun.advanceBondDay().completed).toHaveLength(1);
	});

	it("cancels a bond in progress without attuning the stone", () => {
		const {ioun} = makeSheet([{item: makeStone("Ioun Stone #025, Grey Sphere")}]);
		const id = ioun.getAllStones()[0].id;
		ioun.startBond(id);
		ioun.advanceBondDay();
		ioun.cancelBond(id);
		expect(ioun.getBondingStones()).toHaveLength(0);
		expect(ioun.getBondedStones()).toHaveLength(0);
	});
});

describe("CharacterSheetIoun — combat summary", () => {
	it("reports nothing to render when the character has no stones", () => {
		const {ioun} = makeSheet([]);
		expect(ioun.getCombatSummary()).toEqual({applicable: false});
	});

	it("surfaces the collection thresholds the book attaches consequences to", () => {
		const stones = [];
		for (let i = 0; i < 12; ++i) {
			stones.push({item: makeStone(`Ioun Stone #1${String(i).padStart(2, "0")}, Colour${i} Sphere`), attuned: true, equipped: true});
		}
		const {ioun} = makeSheet(stones);
		const summary = ioun.getCombatSummary();
		expect(summary).toMatchObject({
			applicable: true,
			bondedCount: 12,
			orbitingCount: 12,
			canGift: true,
			isConspicuous: true,
			nextBondDays: 3,
		});
	});

	it("does not claim gifting or conspicuousness below the threshold", () => {
		const {ioun} = makeSheet([{item: makeStone("Ioun Stone #026, Grey Sphere"), attuned: true, equipped: true}]);
		const summary = ioun.getCombatSummary();
		expect(summary.canGift).toBe(false);
		expect(summary.isConspicuous).toBe(false);
	});
});

describe("CharacterSheetIoun — persistence", () => {
	it("round-trips bond progress through save and load", () => {
		const {state, ioun} = makeSheet([{item: makeStone("Ioun Stone #027, Grey Sphere")}]);
		const id = ioun.getAllStones()[0].id;
		ioun.startBond(id);
		ioun.advanceBondDay();

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(loaded.getIounBonds()[id]).toBe(1);
	});

	it("defaults cleanly for a save written before Ioun bonds existed", () => {
		const {state} = makeSheet([{item: makeStone("Ioun Stone #028, Grey Sphere")}]);
		const json = JSON.parse(JSON.stringify(state.toJson()));
		delete json.iounBonds;

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		// No migration function needed: the default state supplies the empty map.
		expect(loaded.getIounBonds()).toEqual({});
	});

	it("does not open a second modal when one is already on screen", async () => {
		// `pGetShow` will happily create a rival dialog, leaving a stale unbound copy on top
		// of the live one — observed in the browser after a double-click on "Manage…".
		const {ioun} = makeSheet([{item: makeStone("Ioun Stone #031, Grey Sphere"), attuned: true}]);
		let opens = 0;
		globalThis.CharacterSheetModal = {
			pGetShow: async () => { opens++; throw new Error("stub: no DOM in this env"); },
		};

		// Simulate an already-open modal.
		let renders = 0;
		ioun._modalBody = {isConnected: true, querySelector: () => null};
		ioun._renderModalBody = () => { renders++; };

		await ioun.openModal();

		expect(opens).toBe(0);
		expect(renders).toBe(1);
	});

	it("prunes bonds whose item has left the inventory", () => {
		const {state, ioun} = makeSheet([{item: makeStone("Ioun Stone #029, Grey Sphere")}]);
		const id = ioun.getAllStones()[0].id;
		ioun.startBond(id);
		state.removeItem(id);
		expect(state.getIounBonds()[id]).toBeUndefined();
	});
});

describe("CharacterSheetIoun — sheet write-back", () => {
	// The bug these guard: `_afterChange` called `this._page.render?.()`, which does not exist.
	// Optional chaining swallowed it, so the modal repainted itself and looked correct while the
	// inventory, combat panel, AC and item bonuses all stayed stale until a tab switch.
	it("repaints the whole sheet when a stone is put into orbit", () => {
		const {spy, ioun} = makeSheet([{item: makeStone("Ioun Stone #001, Pale Blue Rhomboid"), attuned: true}]);
		expect(spy.renders).toBe(0);
		ioun.toggleOrbit(ioun.getAllStones()[0].id);
		expect(spy.renders).toBe(1);
		expect(spy.saves).toBe(1);
	});

	it("repaints the whole sheet for every mutating action", () => {
		const {state, spy, ioun} = makeSheet([
			{item: makeStone("Ioun Stone #001, Pale Blue Rhomboid"), attuned: true, equipped: true},
			{item: makeStone("Ioun Stone #002, Scarlet and Blue Sphere")},
		]);
		const [a, b] = ioun.getAllStones();

		const at = () => spy.renders;
		let seen = at();
		for (const [label, act] of [
			["stowAll", () => ioun.stowAll()],
			["startBond", () => ioun.startBond(b.id)],
			["advanceBondDay", () => ioun.advanceBondDay()],
			["cancelBond", () => ioun.cancelBond(b.id)],
			["toggleOrbit", () => ioun.toggleOrbit(a.id)],
		]) {
			act();
			expect(`${label}:${at() > seen}`).toBe(`${label}:true`);
			seen = at();
		}
		expect(state).toBeDefined();
	});

	it("fails loudly if the module calls a page method that does not exist", () => {
		const {ioun} = makeSheet([{item: makeStone("Ioun Stone #003, Incandescent Blue Sphere")}]);
		expect(() => ioun._page.render).toThrow(/does not exist on CharacterSheetPage/);
		expect(() => ioun._page._renderCharacter).not.toThrow();
	});
});
