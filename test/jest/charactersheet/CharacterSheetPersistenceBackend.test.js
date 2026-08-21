// Guards the character-sheet persistence backend against the "current values reset on
// refresh / character-switch" save bug. Root cause: the canonical store is IndexedDB
// (async, via StorageUtil.pSet) while mutation handlers call saveCharacter() WITHOUT
// awaiting it, so a refresh or switch before the async write settled silently lost the
// last HP / spell-slot / use change — and the old "emergency" unload handler wrote to a
// raw localStorage key the loader never read.
//
// Fix 1: a SYNCHRONOUS per-character rescue mirror (localStorage, written before the first
// await and from the unload handlers), reconciled by `_savedAt` on load. These tests drive
// the REAL CharacterSheetPage helper methods (imported off the prototype) against a
// controllable dual-backend fake StorageUtil, plus a state-layer roundtrip guard.

import "./setup.js";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

let CharacterSheetPage;
let CharacterSheetState;

// A fake dual-backend with genuinely SEPARATE sync (localStorage) and async (IndexedDB)
// backings, matching the real split. Lets a test place a value in only one backing.
//
// The controller references `StorageUtil` as a module-scoped global binding captured when
// js/utils.js first ran, so reassigning `globalThis.StorageUtil` does NOT rebind it. Instead
// we install these fakes as methods ON the real StorageUtil instance (and restore after).
function makeFakeBackend () {
	const syncStore = new Map();
	const asyncStore = new Map();
	return {
		_syncStore: syncStore,
		_asyncStore: asyncStore,
		_failSyncWrite: false,
		syncGet (key) { return syncStore.has(key) ? syncStore.get(key) : null; },
		syncSet (key, value) {
			if (this._failSyncWrite) {
				const e = new Error("QuotaExceededError");
				e.name = "QuotaExceededError";
				throw e;
			}
			// Real syncSet round-trips through JSON; mirror that so we catch non-serialisable bugs.
			syncStore.set(key, JSON.parse(JSON.stringify(value)));
		},
		syncRemove (key) { syncStore.delete(key); },
		async pGet (key) { return asyncStore.has(key) ? asyncStore.get(key) : null; },
		async pSet (key, value) { asyncStore.set(key, JSON.parse(JSON.stringify(value))); },
	};
}

// Install a fake backend onto the real StorageUtil instance, returning a restore fn.
const _STORAGE_METHODS = ["syncGet", "syncSet", "syncRemove", "pGet", "pSet"];
function installBackend (backend) {
	const saved = {};
	for (const m of _STORAGE_METHODS) {
		saved[m] = globalThis.StorageUtil[m];
		// bind so `this._failSyncWrite` etc. resolve against the fake backend
		globalThis.StorageUtil[m] = backend[m].bind(backend);
	}
	return () => { for (const m of _STORAGE_METHODS) globalThis.StorageUtil[m] = saved[m]; };
}

// Minimal host exposing exactly what the persistence helpers touch, with the REAL helper
// methods bound from the prototype. Avoids instantiating the DOM-heavy controller.
function makeHost ({state} = {}) {
	const proto = CharacterSheetPage.prototype;
	const host = {
		_currentCharacterId: null,
		_state: state || {toJson: () => ({})},
		_updateSaveIndicator () {},
		// bound real methods under test
		_getActiveMirrorKey: proto._getActiveMirrorKey,
		_writeActiveCharacterMirror: proto._writeActiveCharacterMirror,
		_readActiveCharacterMirror: proto._readActiveCharacterMirror,
		_clearActiveCharacterMirror: proto._clearActiveCharacterMirror,
		_reconcilePersistedCharacter: proto._reconcilePersistedCharacter,
		_saveCurrentCharacter: proto._saveCurrentCharacter,
	};
	return host;
}

let restoreBackend = () => {};
let backend;

beforeAll(async () => {
	// charactersheet.js registers window `load`/`beforeunload` handlers at import time.
	globalThis.window = globalThis.window || {addEventListener: () => {}, location: {search: "", href: "http://test/"}};
	globalThis.document = globalThis.document || {getElementById: () => null, querySelector: () => null, addEventListener: () => {}};
	CharacterSheetState = (await import(`${REPO_ROOT}js/charactersheet/charactersheet-state.js`)).CharacterSheetState;
	CharacterSheetPage = (await import(`${REPO_ROOT}js/charactersheet/charactersheet.js`)).CharacterSheetPage;
});

beforeEach(() => { backend = makeFakeBackend(); restoreBackend = installBackend(backend); });
afterEach(() => { restoreBackend(); });

describe("Persistence backend — Fix 1 rescue mirror", () => {
	// (1) State-layer roundtrip guard: proves toJson/loadFromJson themselves are healthy, so
	// any observed reset must come from the controller/timing layer, not serialization.
	describe("state roundtrip preserves current values", () => {
		it("keeps spent slots, reduced HP, and temp HP", () => {
			const s = new CharacterSheetState();
			s.setName("Roundtrip Wiz");
			s.setAbilityBase("int", 16);
			s.setAbilityBase("con", 14);
			s.addClass({name: "Wizard", level: 9, casterProgression: "full"});
			s.calculateSpellSlots();

			const l3max = s.getSpellSlotsMax(3);
			s.useSpellSlot(3);
			const l3cur = s.getSpellSlotsCurrent(3);
			expect(l3cur).toBe(l3max - 1);

			const maxHp = s.getMaxHp();
			s.setHp(maxHp - 7, undefined, 5);
			const curHp = s.getCurrentHp();

			const s2 = new CharacterSheetState();
			s2.loadFromJson(s.toJson());

			expect(s2.getSpellSlotsMax(3)).toBe(l3max);
			expect(s2.getSpellSlotsCurrent(3)).toBe(l3cur);
			expect(s2.getCurrentHp()).toBe(curHp);
			expect(s2._data.hp.temp).toBe(5);
		});
	});

	// (2) A value written ONLY through the sync mirror (as the unload handler does) with a
	// newer _savedAt must win reconciliation over a stale canonical record.
	it("loader prefers the newer sync mirror over a stale canonical copy", () => {
		const host = makeHost();

		const canonical = {id: "abc", name: "Stale", hp: {current: 30, max: 30}, _savedAt: 1000};
		const mirror = {id: "abc", name: "Fresh", hp: {current: 12, max: 30}, _savedAt: 2000};
		backend.syncSet(host._getActiveMirrorKey("abc"), mirror);

		const readMirror = host._readActiveCharacterMirror("abc");
		const {chosen, mirrorWon} = host._reconcilePersistedCharacter(canonical, readMirror);
		expect(mirrorWon).toBe(true);
		expect(chosen.hp.current).toBe(12);
	});

	// (3) In-flight async write race: the mutation was mirrored but its IndexedDB write never
	// landed (canonical missing/older). Reconciliation recovers the mirrored state.
	it("recovers an in-flight async write from the mirror", () => {
		const host = makeHost();

		// canonical has NO record yet (async pSet never settled)
		const mirror = {id: "xyz", name: "InFlight", spellSlots: {3: {current: 1, max: 3}}, _savedAt: 5000};
		host._writeActiveCharacterMirror(mirror);

		const readMirror = host._readActiveCharacterMirror("xyz");
		const {chosen, mirrorWon} = host._reconcilePersistedCharacter(null, readMirror);
		expect(mirrorWon).toBe(true);
		expect(chosen.spellSlots[3].current).toBe(1);
	});

	// Canonical wins on a tie or when neither is stamped (mirror only wins when STRICTLY newer).
	it("prefers canonical on equal/missing _savedAt", () => {
		const host = makeHost();

		const canonicalTie = {id: "t", name: "Canon", _savedAt: 100};
		const mirrorTie = {id: "t", name: "Mirror", _savedAt: 100};
		expect(host._reconcilePersistedCharacter(canonicalTie, mirrorTie).chosen.name).toBe("Canon");

		const canonicalNoStamp = {id: "t", name: "Canon"};
		const mirrorNoStamp = {id: "t", name: "Mirror"};
		expect(host._reconcilePersistedCharacter(canonicalNoStamp, mirrorNoStamp).chosen.name).toBe("Canon");
	});

	// (4) Quota-exceeded graceful degradation: a throwing sync mirror must NOT break the app,
	// and the canonical IndexedDB write must still happen and be correct.
	it("degrades gracefully when the sync mirror write throws (quota)", async () => {
		backend._failSyncWrite = true; // every syncSet throws QuotaExceededError

		const s = new CharacterSheetState();
		s.setName("Quota Vic");
		s.addClass({name: "Fighter", level: 3});
		const host = makeHost({state: s});
		host._currentCharacterId = "quota-id";

		// Must not throw despite the mirror failing.
		await expect(host._saveCurrentCharacter()).resolves.toBeUndefined();

		// Canonical store is written and unaffected by the mirror failure.
		const canonical = await backend.pGet("charsheet-characters");
		expect(Array.isArray(canonical)).toBe(true);
		expect(canonical.find(c => c.id === "quota-id")).toBeTruthy();
		// The mirror backing stayed empty (write was swallowed).
		expect(backend._syncStore.has(host._getActiveMirrorKey("quota-id"))).toBe(false);
	});

	// (5) Write-through + stale-mirror cleanup: after a successful canonical save, the mirror
	// is cleared so it can never later win reconciliation incorrectly.
	it("clears the mirror after a successful canonical save", async () => {
		const s = new CharacterSheetState();
		s.setName("Clean Save");
		s.addClass({name: "Cleric", level: 2, casterProgression: "full"});
		const host = makeHost({state: s});
		host._currentCharacterId = "clean-id";

		await host._saveCurrentCharacter();

		// Mirror was written synchronously first, then cleared after the async write succeeded.
		expect(backend._syncStore.has(host._getActiveMirrorKey("clean-id"))).toBe(false);
		const canonical = await backend.pGet("charsheet-characters");
		const saved = canonical.find(c => c.id === "clean-id");
		expect(saved).toBeTruthy();
		expect(typeof saved._savedAt).toBe("number");
	});
});
