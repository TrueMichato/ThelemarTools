/**
 * Undo an accidental short/long rest (round-44 Bug #8) — MECHANICS.
 *
 * A rest mutates ~15 (short) / ~26 (long) pieces of state, so rather than an
 * inverse-ops undo (fragile) the sheet snapshots the FULL character state via
 * `toJson()` before applying a rest, stashes it transiently on the page
 * (`page._lastRestSnapshot`, session-only — never persisted), and restores it
 * verbatim via `loadFromJson()` when the player clicks "Undo last rest".
 *
 * The Rest module's constructor wires DOM listeners (node env has no document),
 * so we build a prototype instance with an injected state + fake page — exactly
 * the collaborators the undo methods use. The affordance methods are DOM-guarded
 * and therefore no-ops here; this file exercises the capture/restore MECHANICS.
 *
 * Assertions read the character's meaningful, user-visible state via public
 * getters rather than raw `toJson()` deep-equality: `loadFromJson()` legitimately
 * back-fills default fields and recomputes derived values (e.g. `hp.max`), so a
 * raw JSON compare is noisy. The getter-based `fields()` snapshot is the state the
 * player actually cares about round-tripping.
 */

import fs from "node:fs";

import "./setup.js";

let CharacterSheetState;
let CharacterSheetRest;
const artificerData = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const objectData = JSON.parse(fs.readFileSync("data/objects.json", "utf8")).object;
const EFA_ARTILLERIST = artificerData.subclass.find(it =>
	it.name === "Artillerist"
	&& it.source === "EFA"
	&& it.classSource === "EFA",
);

beforeAll(async () => {
	await import("../../../js/charactersheet/charactersheet-companion-rules.js");
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetRest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
});

/**
 * Build a Rest instance WITHOUT running the DOM-wiring constructor. The fake page
 * records `saveCharacter` calls (with the state's user-visible fields captured at
 * call time) so tests can assert the undo is PERSISTED, not just restored in memory.
 */
function makeRest (state) {
	const rest = Object.create(CharacterSheetRest.prototype);
	const page = {
		_lastRestSnapshot: null,
		saveCalls: [],
		renderCalls: 0,
		getState: () => state,
		saveCharacter () { this.saveCalls.push(fields(state)); },
		renderCharacter () { this.renderCalls++; },
	};
	rest._state = state;
	rest._page = page;
	return {rest, page};
}

/** A level-5 Wizard with spent HP, slots, hit dice, exhaustion, a condition and temp HP. */
function makeWornCaster () {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "XPHB", level: 5});
	state.setAbilityBase("con", 14);
	state.setMaxHp(30);
	state.setHp(9, 30, 4); // current 9, temp 4
	// Spend some spell slots.
	state.setSpellSlots(1, state.getSpellSlotsMax(1), 1);
	state.setSpellSlots(2, state.getSpellSlotsMax(2), 0);
	state.setSpellSlots(3, state.getSpellSlotsMax(3), 0);
	// Spend hit dice.
	state.adjustHitDieCurrent("d6", -3);
	// Exhaustion + a condition.
	state.setExhaustion(2);
	state.addCondition("poisoned");
	return state;
}

async function makeArtilleristWithCannons () {
	const state = new CharacterSheetState();
	state.setClassSummonTemplateCatalog(objectData);
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level: 15,
		hd: {number: 1, faces: 8},
		subclass: {
			name: EFA_ARTILLERIST.name,
			shortName: EFA_ARTILLERIST.shortName,
			source: EFA_ARTILLERIST.source,
		},
	});
	state.addItem({id: "rest-cannon-tool", name: "Smith's Tools", source: "PHB", type: "AT", _isCustom: true}, 1, true);
	state.addToolProficiency("Smith's Tools");
	const created = await state.pCreateEfaEldritchCannons({
		requests: [
			{form: "forceBallista", size: "S", placement: "deployed", mobility: "wheels", distanceFromOwnerFt: 5, createdWith: "freeUse"},
			{form: "protector", size: "T", placement: "carried", mobility: null, distanceFromOwnerFt: 0, createdWith: "freeUse"},
		],
	});
	state.damageEfaEldritchCannon(created.instanceIds[0], 6);
	state.advanceClassSummonGameTime(15);
	return {state, created};
}

/** Curated snapshot of the user-visible state a rest touches, for round-trip asserts. */
function fields (state) {
	const hitDice = state.getHitDiceByType?.() || {};
	return {
		gameMinute: state.getGameTimeMinutes?.() || 0,
		hpCurrent: state.getHp().current,
		hpTemp: state.getHp().temp,
		slots: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => state.getSpellSlotsCurrent(l)),
		hitDice: Object.fromEntries(Object.entries(hitDice).map(([k, v]) => [k, v.current])),
		exhaustion: state.getExhaustion(),
		conditions: [...(state.getConditionNames?.() || [])].sort(),
	};
}

describe("#8 — Undo rest (full-snapshot capture/restore)", () => {
	describe("_captureRestSnapshot", () => {
		it("stores a transient snapshot on the page tagged with the rest type", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			const snap = rest._captureRestSnapshot("short");

			expect(snap).toBeTruthy();
			expect(snap.restType).toBe("short");
			expect(page._lastRestSnapshot).toBe(snap);
			expect(rest.hasRestUndoAvailable()).toBe(true);
		});

		it("captures a deep copy that is independent of later state mutation", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			rest._captureRestSnapshot("short");
			const hpAtCapture = page._lastRestSnapshot.json.hp.current;

			// Mutate the live state AFTER capture — the snapshot must not change.
			state.setHp(1, 30, 0);

			expect(page._lastRestSnapshot.json.hp.current).toBe(hpAtCapture);
			expect(page._lastRestSnapshot.json.hp.current).not.toBe(state.getHp().current);
		});
	});

	describe("Short rest undo round-trip", () => {
		it("restores the full pre-rest state (HP, temp HP, slots, hit dice, exhaustion, conditions)", () => {
			const state = makeWornCaster();
			const {rest} = makeRest(state);

			const before = fields(state);

			// Capture, then simulate a short rest's mutations.
			rest._captureRestSnapshot("short");
			state.heal(10); // some HP back
			state.setHp(state.getHp().current, undefined, 0); // temp cleared
			state.adjustHitDieCurrent("d6", -1); // spent a hit die to heal
			state.setSpellSlots(1, state.getSpellSlotsMax(1), state.getSpellSlotsMax(1)); // arcane recovery

			// Sanity: state actually changed.
			expect(fields(state)).not.toEqual(before);

			const undone = rest._onUndoRest();

			expect(undone).toBe(true);
			expect(fields(state)).toEqual(before);
		});
	});

	describe("Long rest undo round-trip", () => {
		it("restores the full pre-rest state after a long rest's many mutations", () => {
			const state = makeWornCaster();
			const {rest} = makeRest(state);

			const before = fields(state);

			rest._captureRestSnapshot("long");
			// Simulate a long rest: full HP, reset temp, restore all slots, recover
			// hit dice, drop a level of exhaustion, remove a condition.
			state.setHp(state.getMaxHp(), state.getMaxHp(), 0);
			for (let lvl = 1; lvl <= 9; lvl++) {
				const max = state.getSpellSlotsMax(lvl);
				if (max > 0) state.setSpellSlots(lvl, max, max);
			}
			state.adjustHitDieCurrent("d6", 2);
			state.setExhaustion(1);
			state.removeCondition("poisoned");

			expect(fields(state)).not.toEqual(before);

			const undone = rest._onUndoRest();

			expect(undone).toBe(true);
			expect(fields(state)).toEqual(before);
			// Spot-check specific fields survived the round-trip.
			expect(state.getHp().current).toBe(9);
			expect(state.getHp().temp).toBe(4);
			expect(state.getExhaustion()).toBe(2);
			expect(state.getSpellSlotsCurrent(1)).toBe(1);
			expect(state.getSpellSlotsCurrent(2)).toBe(0);
			expect(state.getConditionNames()).toContain("poisoned");
		});

		it("restores canonical time and exact lifecycle removals from the pre-rest snapshot", () => {
			const state = makeWornCaster();
			state.addClass({name: "Artificer", source: "EFA", level: 2});
			const {rest} = makeRest(state);
			const originalRandomise = globalThis.RollerUtil.randomise;
			globalThis.RollerUtil.randomise = () => 1;
			try {
				const created = state.createGeneratedFeatureItem({
					item: {name: "Replicated Satchel", source: "TST", type: "W"},
					owner: CharacterSheetState.EFA_REPLICATE_MAGIC_ITEM_OWNER,
					metadata: {sourceFeatureUid: CharacterSheetState.EFA_REPLICATE_MAGIC_ITEM_OWNER.featureUid, temporary: true},
					creation: {order: 1, receiptId: "rest-undo", event: "test", batchId: null},
					lifecycle: {
						version: CharacterSheetState.GENERATED_FEATURE_ITEM_LIFECYCLE_VERSION,
						state: "active",
						deathExpiryDaysRemaining: null,
						deathExpiryAssignedReceiptId: null,
						expiryRecords: [],
						callbacks: {
							onLongRest: "retain",
							onDeath: "expire-after-1d4-days",
							onLifecycleDay: "decrement-expiry",
						},
						metadata: {},
					},
				});
				state.setDeathSaveFailures(3);
				rest._captureRestSnapshot("long");

				expect(state.advanceGameTimeMinutes(1440, {
					reason: "test-rest",
					identity: "rest-undo",
				}).removed).toEqual([{itemId: created.itemId, name: "Replicated Satchel"}]);
				expect(state.getGameTimeMinutes()).toBe(1440);
				expect(state.getInventory().some(row => row.id === created.itemId)).toBe(false);

				expect(rest._onUndoRest()).toBe(true);
				expect(state.getGameTimeMinutes()).toBe(0);
				expect(state.getInventory().some(row => row.id === created.itemId)).toBe(true);
				expect(state.getInventory()
					.find(row => row.id === created.itemId)
					.item._generatedItemProvenance.lifecycle.expiryRecords[0]).toMatchObject({
					expiryMinute: 1440,
					minutesRemaining: 1440,
					daysRemaining: 1,
				});
			} finally {
				if (originalRandomise === undefined) delete globalThis.RollerUtil.randomise;
				else globalThis.RollerUtil.randomise = originalRandomise;
			}
		});

		it("restores the exact Steel Defender generation replaced after the Long Rest", () => {
			const state = new CharacterSheetState();
			state.loadFromJson({
				abilities: {int: 18},
				classes: [{
					name: "Artificer",
					source: "EFA",
					level: 3,
					subclass: {name: "Battle Smith", shortName: "Battle Smith", source: "EFA"},
				}],
			});
			const companionId = state.addCompanion({
				name: "Steel Defender",
				source: "EFA",
				type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
				origin: "Battle Smith",
				hp: {max: 20, current: 0, temp: 0},
				featureGrant: {uid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.STEEL_DEFENDER},
				lifecycle: {status: "dead", generation: 1, diedAtGameMinute: 0, timingKnown: true},
			});
			state.reconcileFeatureOwnedCompanion(companionId, {
				summonerContext: state.getFeatureCompanionSummonerContext(
					CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.STEEL_DEFENDER,
				),
			});
			const toolItemId = "smith-tools-row";
			state.addItem({id: toolItemId, name: "Smith's Tools", source: "XPHB", type: "AT"}, 1);
			const {rest} = makeRest(state);

			rest._captureRestSnapshot("long");
			state.onLongRest();
			expect(state.replaceFeatureCompanionAfterLongRest({
				companionId,
				toolItemId,
				inHandConfirmed: true,
			})).toMatchObject({ok: true, committed: true});
			expect(state.getCompanion(companionId).lifecycle).toMatchObject({
				status: "alive",
				generation: 2,
				lastReplacementLongRestMinute: 480,
			});

			expect(rest._onUndoRest()).toBe(true);
			expect(state.getGameTimeMinutes()).toBe(0);
			expect(state.getCompanion(companionId)).toMatchObject({
				active: false,
				hp: {current: 0, max: 20},
				lifecycle: {
					status: "dead",
					generation: 1,
					diedAtGameMinute: 0,
				},
			});
		});
	});

	describe("EFA cannon rest expiry undo", () => {
		it("wires both rest dialogs through the canonical expiry helper and reports the count", () => {
			const source = fs.readFileSync("js/charactersheet/charactersheet-rest.js", "utf8");
			expect(source).toContain("listEfaEldritchCannons?.() || []");
			expect(source).toContain("expireEfaEldritchCannonsForRest?.({minutes: 60})");
			expect(source).toContain("expireEfaEldritchCannonsForRest?.({minutes: 480})");
			expect(source).toContain("Eldritch Cannon$" + "{efaCannonExpiry.count === 1 ? \"\" : \"s\"} expired.");
		});

		it.each([
			["short", 60],
			["long", 480],
		])("restores both cannons, HP, duration, revisions, resources, and cover after undoing a %s rest", async (restType, minutes) => {
			const {state, created} = await makeArtilleristWithCannons();
			const {rest} = makeRest(state);
			const before = {
				cannons: state.listEfaEldritchCannons(),
				revisions: state.toJson().generatedClassSummonRevisions,
				creationResource: state.getEfaEldritchCannonCreationState().freeUse,
				cover: state.getCoverProjection(),
			};

			rest._captureRestSnapshot(restType);
			const expired = state.expireEfaEldritchCannonsForRest({minutes});
			expect(expired.count).toBe(2);
			expect(state.listEfaEldritchCannons()).toEqual([]);
			expect(state.getCoverProjection()).toBeNull();

			expect(rest._onUndoRest()).toBe(true);
			expect(state.listEfaEldritchCannons()).toEqual(before.cannons);
			expect(state.toJson().generatedClassSummonRevisions).toEqual(before.revisions);
			expect(state.getEfaEldritchCannonCreationState().freeUse).toEqual(before.creationResource);
			expect(state.getCoverProjection()).toEqual(before.cover);
			expect(state.getEfaEldritchCannon(created.instanceIds[0])).toMatchObject({
				hp: {current: 69, max: 75},
				durationRemainingMinutes: 45,
			});
		});
	});

	describe("Undo is single-level and clears after use", () => {
		it("returns true once, then reports no undo available and refuses a second undo", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			rest._captureRestSnapshot("long");
			state.setHp(1, 30, 0);

			expect(rest._onUndoRest()).toBe(true);
			expect(rest.hasRestUndoAvailable()).toBe(false);
			expect(page._lastRestSnapshot).toBeNull();

			// A second undo has nothing to restore and must not change state.
			const stateAfter = fields(state);
			expect(rest._onUndoRest()).toBe(false);
			expect(fields(state)).toEqual(stateAfter);
		});

		it("only remembers the most recent rest (capturing again overwrites the snapshot)", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			rest._captureRestSnapshot("short");
			const firstSnap = page._lastRestSnapshot;

			state.setHp(1, 30, 0);
			const afterFirstMutation = fields(state);

			rest._captureRestSnapshot("long");
			expect(page._lastRestSnapshot).not.toBe(firstSnap);
			expect(page._lastRestSnapshot.restType).toBe("long");

			state.setExhaustion(6);
			rest._onUndoRest();

			// Restores to the SECOND snapshot, not the first.
			expect(fields(state)).toEqual(afterFirstMutation);
		});
	});

	describe("Undo is persisted (guardrail #2)", () => {
		it("saves the character after restoring, so a reload reflects the undo (save state == pre-rest)", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			const before = fields(state);

			// Simulate a long rest (which normally also calls saveCharacter) + its mutations.
			rest._captureRestSnapshot("long");
			state.setHp(state.getMaxHp(), state.getMaxHp(), 0);
			for (let lvl = 1; lvl <= 9; lvl++) {
				const max = state.getSpellSlotsMax(lvl);
				if (max > 0) state.setSpellSlots(lvl, max, max);
			}
			state.setExhaustion(1);
			state.removeCondition("poisoned");

			const savesBeforeUndo = page.saveCalls.length;

			expect(rest._onUndoRest()).toBe(true);

			// The undo must persist: saveCharacter was called exactly once more...
			expect(page.saveCalls.length).toBe(savesBeforeUndo + 1);
			// ...and the state captured AT SAVE TIME already matches pre-rest (i.e. the
			// restore happened before the save, so storage receives the pre-rest state).
			expect(page.saveCalls[page.saveCalls.length - 1]).toEqual(before);
			// And it re-rendered so the UI reflects the undo.
			expect(page.renderCalls).toBeGreaterThan(0);
		});

		it("does NOT save when there is nothing to undo", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			expect(rest._onUndoRest()).toBe(false);
			expect(page.saveCalls.length).toBe(0);
		});
	});

	describe("_onUndoRest with no snapshot", () => {
		it("is a safe no-op that returns false", () => {
			const state = makeWornCaster();
			const {rest} = makeRest(state);
			expect(rest.hasRestUndoAvailable()).toBe(false);
			expect(rest._onUndoRest()).toBe(false);
		});
	});
});
