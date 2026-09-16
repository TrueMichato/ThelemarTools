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
import {jest} from "@jest/globals";
import {LocalCharacterRepository} from "../../../js/hub/hub-character-repository.js";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

let CharacterSheetPage;
let CharacterSheetState;
let characterSheetDataUtil;

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

const makeDeferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
};

const makeSpellActivity = (spellName, mode = "cantrip") => ({
	type: "spell.used",
	spellName,
	spellSource: "PHB",
	spellLevel: mode === "cantrip" ? 0 : 1,
	slotLevel: mode === "cantrip" ? 0 : 1,
	mode,
});

function makeConcealDocument () {
	const main = {
		hidden: false,
		replaceChildren () {},
		before () {},
	};
	return {
		body: {append () {}},
		createElement: () => ({setAttribute () {}}),
		getElementById: () => null,
		querySelector: () => main,
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
		_getNextSavedAt: proto._getNextSavedAt,
		_pResolveHubCharacterConflict: proto._pResolveHubCharacterConflict,
		_pResolveUnprovableHubRecovery: proto._pResolveUnprovableHubRecovery,
		_pFinalizeDiscardedHubRecovery: proto._pFinalizeDiscardedHubRecovery,
		_pClaimUnboundLegacyHubRecovery: proto._pClaimUnboundLegacyHubRecovery,
		_adoptCanonicalCharacterIdentity: proto._adoptCanonicalCharacterIdentity,
		_pRefreshCanonicalCharacterRoster: proto._pRefreshCanonicalCharacterRoster,
		_saveCurrentCharacter: proto._saveCurrentCharacter,
		_characterRepository: null,
		_lastSavedAt: 0,
		_isHubCharacterConflictPromptOpen: false,
	};
	host._characterRepository = new LocalCharacterRepository({storage: globalThis.StorageUtil});
	return host;
}

let restoreBackend = () => {};
let backend;

beforeAll(async () => {
	// charactersheet.js registers window `load`/`beforeunload` handlers at import time.
	globalThis.window = globalThis.window || {addEventListener: () => {}, location: {search: "", href: "http://test/"}};
	globalThis.document = globalThis.document || {getElementById: () => null, querySelector: () => null, addEventListener: () => {}};
	characterSheetDataUtil = globalThis.DataUtil ||= {};
	characterSheetDataUtil.userDownload ||= () => {};
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
		await expect(host._saveCurrentCharacter()).resolves.toBe(true);

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

	it("surfaces a campaign-operation conflict without opening the takeover dialog", async () => {
		const conflict = Object.assign(new Error("Character is being edited on another device."), {
			code: "CHARACTER_CONFLICT",
			recovery: {conflicts: [{reason: "LEASE_HELD"}]},
		});
		const host = makeHost();
		host._currentCharacterId = "cloud-id";
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn(async () => { throw conflict; }),
			pResolveConflict: jest.fn(),
			clearRetryableLeaseConflict: jest.fn(() => true),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean");
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		await expect(host._saveCurrentCharacter({isInteractiveConflict: false})).rejects.toBe(conflict);
		expect(prompt).not.toHaveBeenCalled();
		expect(host._characterRepository.pResolveConflict).not.toHaveBeenCalled();
		expect(host._characterRepository.clearRetryableLeaseConflict).toHaveBeenCalledWith({characterId: "cloud-id"});

		consoleError.mockRestore();
		prompt.mockRestore();
	});

	it("keeps the private model concealed when a save conflict arrives after access loss", async () => {
		const state = new CharacterSheetState();
		state.setName("Private Character");
		const host = makeHost({state});
		host._currentCharacterId = "private-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		host._updateSaveIndicator = jest.fn();
		const loadSpy = jest.spyOn(host._state, "loadFromJson");
		const deferredUpsert = makeDeferred();
		const conflict = Object.assign(new Error("Character is being edited on another device."), {
			code: "CHARACTER_CONFLICT",
			recovery: {server: {name: "Private Character"}},
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn(() => deferredUpsert.promise),
			pResolveConflict: jest.fn(),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean");
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		const previousDocument = globalThis.document;
		globalThis.document = makeConcealDocument();

		try {
			const pendingSave = host._saveCurrentCharacter();
			CharacterSheetPage.prototype._concealHubPrivateCharacter.call(host);
			deferredUpsert.reject(conflict);

			await expect(pendingSave).resolves.toBe(false);
			expect(host._state.toJson().name).toBe("");
			expect(loadSpy).not.toHaveBeenCalled();
			expect(host._renderCharacter).not.toHaveBeenCalled();
			expect(host._updateSaveIndicator).toHaveBeenCalledTimes(1);
			expect(host._updateSaveIndicator).toHaveBeenCalledWith("saving");
			expect(prompt).not.toHaveBeenCalled();
			expect(host._characterRepository.pResolveConflict).not.toHaveBeenCalled();
		} finally {
			globalThis.document = previousDocument;
			consoleError.mockRestore();
			prompt.mockRestore();
		}
	});

	it("does not re-adopt a resolved server document after access loss conceals the character", async () => {
		const state = new CharacterSheetState();
		state.setName("Private Character");
		const host = makeHost({state});
		host._currentCharacterId = "private-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		const loadSpy = jest.spyOn(host._state, "loadFromJson");
		const deferredPrompt = makeDeferred();
		const deferredResolve = makeDeferred();
		const conflict = Object.assign(new Error("Character is being edited on another device."), {
			code: "CHARACTER_CONFLICT",
			recovery: {server: {name: "Private Character"}},
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn(async () => { throw conflict; }),
			pResolveConflict: jest.fn(() => deferredResolve.promise),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockImplementation(() => deferredPrompt.promise);
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		const previousDocument = globalThis.document;
		globalThis.document = makeConcealDocument();

		try {
			const pendingSave = host._saveCurrentCharacter();
			await Promise.resolve();
			expect(prompt).toHaveBeenCalledTimes(1);

			deferredPrompt.resolve(false);
			await Promise.resolve();
			expect(host._characterRepository.pResolveConflict).toHaveBeenCalledWith({
				characterId: "private-id",
				choice: "server",
				fnAdoptLive: expect.any(Function),
			});

			CharacterSheetPage.prototype._concealHubPrivateCharacter.call(host);
			deferredResolve.resolve({name: "Private Character"});

			await expect(pendingSave).resolves.toBe(false);
			expect(host._state.toJson().name).toBe("");
			expect(loadSpy).not.toHaveBeenCalled();
			expect(host._renderCharacter).not.toHaveBeenCalled();
		} finally {
			globalThis.document = previousDocument;
			consoleError.mockRestore();
			prompt.mockRestore();
		}
	});

	it("does not overwrite a newer queued operation after resolving a conflict with server state", async () => {
		let live = {id: "private-id", name: "Mira", hp: {current: 9}};
		const state = {
			toJson: () => structuredClone(live),
			loadFromJson: data => { live = structuredClone(data); },
		};
		const host = makeHost({state});
		host._currentCharacterId = "private-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		host._updateSaveIndicator = jest.fn();
		const conflict = Object.assign(new Error("Character changed remotely."), {
			code: "CHARACTER_CONFLICT",
			recovery: {server: {name: "Mira", hp: {current: 7}}},
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn(async () => { throw conflict; }),
			pResolveConflict: jest.fn(async ({fnAdoptLive}) => {
				fnAdoptLive?.({id: "private-id", name: "Mira", hp: {current: 7}});
				// A genuinely new revision queued behind conflict resolution applies before the
				// awaiting caller resumes.
				live = {id: "private-id", name: "Mira", hp: {current: 5}};
				return {id: "private-id", name: "Mira", hp: {current: 7}};
			}),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(false);
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		try {
			await expect(host._saveCurrentCharacter()).resolves.toBe(true);
			expect(host._characterRepository.pResolveConflict).toHaveBeenCalledWith(expect.objectContaining({
				characterId: "private-id",
				choice: "server",
				fnAdoptLive: expect.any(Function),
			}));
			expect(live.hp.current).toBe(5);
		} finally {
			consoleError.mockRestore();
			prompt.mockRestore();
		}
	});

	it.each([
		["Use Server", false],
		["Use Local", true],
	])("adopts canonical identity and accepts canonical realtime after %s", async (_label, choice) => {
		const previousLocation = globalThis.window.location;
		const previousHistory = globalThis.window.history;
		globalThis.window.location = new URL("http://test/charactersheet.html?id=temporary-id&hubCampaign=campaign-1");
		globalThis.window.history = {replaceState: jest.fn()};
		let live = {id: "temporary-id", name: "Mira", hp: {current: 9}};
		const state = {
			toJson: () => structuredClone(live),
			loadFromJson: data => { live = structuredClone(data); },
			setId: id => { live.id = id; },
		};
		const host = makeHost({state});
		host._currentCharacterId = "temporary-id";
		host._characterLoadGeneration = 4;
		host._hubRealtimeGeneration = 2;
		host._isHubCharacter = true;
		host._hubCampaignId = "campaign-1";
		host._selCharacter = {value: "temporary-id"};
		host._fenceHubGeneration = CharacterSheetPage.prototype._fenceHubGeneration;
		host._detachHubRealtimeClient = jest.fn();
		host._detachHubProjections = jest.fn();
		host._detachHubRealtime = CharacterSheetPage.prototype._detachHubRealtime;
		host._attachHubRealtime = jest.fn(function () {
			this._hubRealtimeGeneration++;
			return true;
		});
		host._pLoadCharacters = jest.fn(async () => {});
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		host._updateSaveIndicator = jest.fn();
		host._getHubLiveCharacterData = () => structuredClone(live);
		host._hubEffects = null;
		const conflict = Object.assign(new Error("Character changed remotely."), {
			code: "CHARACTER_CONFLICT",
			recovery: {server: {id: "server-id", name: "Mira", hp: {current: 7}}},
		});
		const applyRealtimeOperation = jest.fn(() => ({status: "suppressed"}));
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn(async () => { throw conflict; }),
			pResolveConflict: jest.fn(async ({fnAdoptLive}) => {
				const resolved = {id: "server-id", name: "Mira", hp: {current: choice ? 9 : 7}};
				if (fnAdoptLive) {
					fnAdoptLive(resolved);
					return null;
				}
				return resolved;
			}),
			applyRealtimeOperation,
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(choice);
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		try {
			await expect(host._saveCurrentCharacter()).resolves.toBe(true);
			expect(host._currentCharacterId).toBe("server-id");
			expect(live.id).toBe("server-id");
			expect(host._characterLoadGeneration).toBe(5);
			expect(host._hubRealtimeGeneration).toBe(4);
			expect(globalThis.window.history.replaceState).toHaveBeenCalledWith({}, "", expect.objectContaining({
				searchParams: expect.any(URLSearchParams),
			}));
			const adoptedUrl = globalThis.window.history.replaceState.mock.calls.at(-1)[2];
			expect(adoptedUrl.searchParams.get("id")).toBe("server-id");
			expect(adoptedUrl.searchParams.get("hubCampaign")).toBe("campaign-1");
			expect(host._pLoadCharacters).toHaveBeenCalledTimes(1);
			expect(host._selCharacter.value).toBe("server-id");
			expect(host._detachHubRealtimeClient).toHaveBeenCalledTimes(1);
			expect(host._detachHubProjections).toHaveBeenCalledWith({isPreserveRepositoryReconciliation: true});
			expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});

			expect(CharacterSheetPage.prototype._onHubSemanticOperation.call(host, {
				status: "applied",
				characterId: "server-id",
				targetCharacterId: "server-id",
				operationId: "award-operation",
				eventId: "award-event",
				sequence: 2,
				payload: {
					operation: {
						operationId: "award-operation",
						kind: "hp.heal",
						version: 1,
						targetCharacterId: "server-id",
						arguments: {amount: 1},
					},
					resultingCharacterRevision: 2,
				},
			})).toBe(true);
			expect(applyRealtimeOperation).toHaveBeenCalledWith(expect.objectContaining({characterId: "server-id"}));
		} finally {
			consoleError.mockRestore();
			prompt.mockRestore();
			globalThis.window.location = previousLocation;
			globalThis.window.history = previousHistory;
		}
	});

	it("does not retry a live-conflict save after access loss conceals the character", async () => {
		const state = new CharacterSheetState();
		state.setName("Private Character");
		const host = makeHost({state});
		host._currentCharacterId = "private-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		const loadSpy = jest.spyOn(host._state, "loadFromJson");
		const deferredPrompt = makeDeferred();
		const conflict = Object.assign(new Error("Live character edits overlap server changes."), {
			code: "CHARACTER_LIVE_CONFLICT",
			recovery: {server: {name: "Private Character"}},
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn(async () => { throw conflict; }),
			getLiveConflictRecovery: jest.fn(() => conflict.recovery),
			clearLiveConflict: jest.fn(),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockImplementation(() => deferredPrompt.promise);
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		const previousDocument = globalThis.document;
		globalThis.document = makeConcealDocument();

		try {
			const pendingSave = host._saveCurrentCharacter();
			await Promise.resolve();
			expect(prompt).toHaveBeenCalledTimes(1);

			CharacterSheetPage.prototype._concealHubPrivateCharacter.call(host);
			deferredPrompt.resolve(true);

			await expect(pendingSave).resolves.toBe(false);
			expect(host._characterRepository.pUpsert).toHaveBeenCalledTimes(1);
			expect(host._characterRepository.clearLiveConflict).toHaveBeenCalledWith({characterId: "private-id"});
			expect(host._state.toJson().name).toBe("");
			expect(loadSpy).not.toHaveBeenCalled();
			expect(host._renderCharacter).not.toHaveBeenCalled();
		} finally {
			globalThis.document = previousDocument;
			consoleError.mockRestore();
			prompt.mockRestore();
		}
	});

	it("does not duplicate semantic activity when keeping local state after a live conflict", async () => {
		const state = new CharacterSheetState();
		state.setName("Conflict Caster");
		const host = makeHost({state});
		host._currentCharacterId = "character-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		const activity = {
			type: "spell.used",
			spellName: "Shield",
			spellSource: "PHB",
			spellLevel: 1,
			slotLevel: 1,
			mode: "spell_slot",
		};
		const conflict = Object.assign(new Error("Live character edits overlap server changes."), {
			code: "CHARACTER_LIVE_CONFLICT",
			recovery: {server: state.toJson()},
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn()
				.mockRejectedValueOnce(conflict)
				.mockImplementationOnce(async ({character}) => character),
			getLiveConflictRecovery: jest.fn(() => conflict.recovery),
			clearLiveConflict: jest.fn(),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		try {
			await expect(host._saveCurrentCharacter({activity})).resolves.toBe(true);
			expect(host._characterRepository.pUpsert).toHaveBeenCalledTimes(2);
			expect(host._characterRepository.pUpsert.mock.calls[0][0].activity).toEqual(activity);
			expect(host._characterRepository.pUpsert.mock.calls[1][0].activity).toBeNull();
		} finally {
			consoleError.mockRestore();
			prompt.mockRestore();
		}
	});

	it("claims ownerless predecessor recovery only after an explicit account-scoped choice", async () => {
		const host = makeHost();
		host._characterRepository = {
			pListUnboundLegacyRecoveryIds: jest.fn(async () => ["temporary-id"]),
			pClaimUnboundLegacyRecovery: jest.fn(async () => true),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);

		try {
			await expect(host._pClaimUnboundLegacyHubRecovery()).resolves.toBe(true);
			expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
				title: "Older Local Recovery Found",
				textYes: "Claim Local Recovery",
				textNo: "Leave Hidden",
			}));
			expect(host._characterRepository.pClaimUnboundLegacyRecovery)
				.toHaveBeenCalledWith({characterId: "temporary-id"});
		} finally {
			prompt.mockRestore();
		}
	});

	it("exports a dismissed quarantine and reopens the decision on the next save", async () => {
		const state = new CharacterSheetState();
		state.setName("Legacy Caster");
		const host = makeHost({state});
		host._currentCharacterId = "character-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		const activity = makeSpellActivity("Shield", "spell_slot");
		const recovery = {
			intent: "patch",
			character: {...state.toJson(), id: "character-id"},
			commands: [{
				character: {...state.toJson(), id: "character-id"},
				activity,
				commandKeys: {create: "create-old", patch: "patch-old"},
				rulesVersionId: null,
				intent: "patch",
				state: "failed",
			}],
		};
		const error = Object.assign(new Error("Exact request unavailable."), {
			code: "CHARACTER_RECOVERY_EXACT_REQUEST_UNAVAILABLE",
			recovery,
		});
		let isBlocked = false;
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn()
				.mockImplementationOnce(async () => {
					isBlocked = true;
					throw error;
				})
				.mockImplementation(async ({character}) => character),
			isSaveBlocked: jest.fn(() => isBlocked),
			getSaveBlock: jest.fn(() => isBlocked ? {code: error.code, recovery} : null),
			pResolveUnprovableRecovery: jest.fn(async ({fnAdoptLive}) => {
				isBlocked = false;
				fnAdoptLive({id: "character-id", name: "Canonical Caster"});
				return null;
			}),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean")
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(true);
		const download = jest.spyOn(characterSheetDataUtil, "userDownload").mockImplementation(() => {});
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		try {
			await expect(host._saveCurrentCharacter({activity})).resolves.toBe(false);
			expect(download).toHaveBeenNthCalledWith(
				1,
				"character-activity-recovery",
				recovery,
				{fileType: "character-conflict"},
			);

			host._state.setName("Unsaved After Dismissal");
			await expect(host._saveCurrentCharacter()).resolves.toBe(true);
			expect(prompt).toHaveBeenCalledTimes(2);
			expect(download).toHaveBeenNthCalledWith(
				2,
				"character-activity-recovery",
				expect.objectContaining({
					...recovery,
					unsavedCharacter: expect.objectContaining({
						id: "character-id",
						name: "Unsaved After Dismissal",
					}),
				}),
				{fileType: "character-conflict"},
			);
			expect(host._characterRepository.pResolveUnprovableRecovery).toHaveBeenCalledTimes(1);
			expect(host._state.toJson().name).toBe("Canonical Caster");

			host._state.setName("Later Save");
			await expect(host._saveCurrentCharacter()).resolves.toBe(true);
			expect(host._characterRepository.pUpsert).toHaveBeenCalledTimes(2);
		} finally {
			consoleError.mockRestore();
			download.mockRestore();
			prompt.mockRestore();
		}
	});

	it("exports quarantined activity recovery, adopts server truth, and permits a later save", async () => {
		const state = new CharacterSheetState();
		state.setName("Legacy Caster");
		const host = makeHost({state});
		host._currentCharacterId = "character-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		host._pLoadCharacters = jest.fn(async () => {});
		const recovery = {
			character: {...state.toJson(), id: "character-id"},
			activity: {
				type: "spell.used",
				spellName: "Shield",
				spellSource: "PHB",
				spellLevel: 1,
				slotLevel: 1,
				mode: "spell_slot",
			},
		};
		const error = Object.assign(new Error("Exact request unavailable."), {
			code: "CHARACTER_RECOVERY_EXACT_REQUEST_UNAVAILABLE",
			recovery,
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn()
				.mockRejectedValueOnce(error)
				.mockImplementationOnce(async ({character}) => character),
			pResolveUnprovableRecovery: jest.fn(async ({fnAdoptLive}) => {
				fnAdoptLive({id: "character-id", name: "Canonical Caster"});
				return null;
			}),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		const download = jest.spyOn(characterSheetDataUtil, "userDownload").mockImplementation(() => {});
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		try {
			await expect(host._saveCurrentCharacter({activity: recovery.activity})).resolves.toBe(true);
			expect(download).toHaveBeenCalledWith(
				"character-activity-recovery",
				recovery,
				{fileType: "character-conflict"},
			);
			expect(host._characterRepository.pResolveUnprovableRecovery).toHaveBeenCalledWith(expect.objectContaining({
				characterId: "character-id",
				fnAdoptLive: expect.any(Function),
			}));
			expect(host._state.toJson().name).toBe("Canonical Caster");

			host._state.setName("Later Save");
			await expect(host._saveCurrentCharacter()).resolves.toBe(true);
			expect(host._characterRepository.pUpsert).toHaveBeenCalledTimes(2);
		} finally {
			consoleError.mockRestore();
			download.mockRestore();
			prompt.mockRestore();
		}
	});

	it("presents a failed poison-head save as an actionable cloud recovery choice", async () => {
		const state = new CharacterSheetState();
		state.setName("Blocked Caster");
		const host = makeHost({state});
		host._currentCharacterId = "character-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._reconcileClassFeatures = jest.fn();
		host._renderCharacter = jest.fn();
		const recovery = {
			intent: "patch",
			character: {...state.toJson(), id: "character-id"},
			commands: [{
				character: {...state.toJson(), id: "character-id"},
				activity: null,
				failureCode: "POLICY_WRITE_FORBIDDEN",
				intent: "patch",
				state: "failed",
			}],
		};
		const error = Object.assign(new Error("Exact request unavailable."), {
			code: "CHARACTER_RECOVERY_EXACT_REQUEST_UNAVAILABLE",
			recovery,
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn().mockRejectedValue(error),
			pResolveUnprovableRecovery: jest.fn(async ({fnAdoptLive}) => {
				fnAdoptLive({id: "character-id", name: "Canonical Caster"});
				return null;
			}),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		const download = jest.spyOn(characterSheetDataUtil, "userDownload").mockImplementation(() => {});
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		try {
			await expect(host._saveCurrentCharacter()).resolves.toBe(true);
			expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
				title: "Cloud Save Needs Your Choice",
				htmlDescription: expect.stringContaining("cannot be retried safely"),
			}));
			expect(download).toHaveBeenCalledWith(
				"character-cloud-recovery",
				recovery,
				{fileType: "character-conflict"},
			);
			expect(host._state.toJson().name).toBe("Canonical Caster");
		} finally {
			consoleError.mockRestore();
			download.mockRestore();
			prompt.mockRestore();
		}
	});

	it.each([
		["CHARACTER_NOT_FOUND", false],
		["IDEMPOTENCY_RESULT_GONE", true],
	])("exports and removes missing-server patch recovery for %s before allowing a later save", async (failureCode, isRosterRefreshFailure) => {
		const previousLocation = globalThis.window.location;
		const previousHistory = globalThis.window.history;
		globalThis.window.location = new URL("http://test/charactersheet.html?id=character-id&hubCampaign=campaign-1");
		globalThis.window.history = {replaceState: jest.fn()};
		const state = new CharacterSheetState();
		state.setName("Blocked Caster");
		const host = makeHost({state});
		host._currentCharacterId = "character-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._createNewCharacter = jest.fn(function () {
			this._currentCharacterId = "new-character-id";
			this._state.reset();
			this._state.setId("new-character-id");
			this._state.setName("New Character");
		});
		host._pLoadCharacters = isRosterRefreshFailure
			? jest.fn(async () => { throw new Error("Roster unavailable."); })
			: jest.fn(async () => {});
		host._selCharacter = {value: "character-id"};
		const recovery = {
			intent: "patch",
			character: {...state.toJson(), id: "character-id"},
			commands: [{
				character: {...state.toJson(), id: "character-id"},
				activity: null,
				failureCode,
				intent: "patch",
				state: "failed",
			}],
		};
		const error = Object.assign(new Error("Exact request unavailable."), {
			code: "CHARACTER_RECOVERY_EXACT_REQUEST_UNAVAILABLE",
			recovery,
		});
		const pResolveUnprovableRecovery = jest.fn(async ({fnDiscardLive}) => {
			fnDiscardLive({characterId: "character-id"});
			return null;
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn()
				.mockRejectedValueOnce(error)
				.mockImplementation(async ({character}) => character),
			pResolveUnprovableRecovery,
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		const download = jest.spyOn(characterSheetDataUtil, "userDownload").mockImplementation(() => {});
		const toast = jest.spyOn(globalThis.JqueryUtil, "doToast").mockImplementation(() => {});
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		try {
			await expect(host._saveCurrentCharacter()).resolves.toBe(true);
			expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
				title: "Cloud Character Is No Longer Available",
				htmlDescription: expect.stringContaining("remove the inaccessible local copy"),
				textYes: "Export Then Remove Local Copy",
				textNo: "Keep Blocked",
			}));
			expect(download).toHaveBeenCalledWith(
				"character-cloud-recovery",
				recovery,
				{fileType: "character-conflict"},
			);
			expect(download.mock.invocationCallOrder[0]).toBeLessThan(pResolveUnprovableRecovery.mock.invocationCallOrder[0]);
			expect(host._createNewCharacter).toHaveBeenCalledTimes(1);
			expect(host._currentCharacterId).toBe("new-character-id");
			expect(host._selCharacter.value).toBe("");
			const discardedUrl = globalThis.window.history.replaceState.mock.calls.at(-1)[2];
			expect(discardedUrl.searchParams.get("id")).toBeNull();
			expect(discardedUrl.searchParams.get("hubCampaign")).toBe("campaign-1");
			if (isRosterRefreshFailure) {
				expect(toast).toHaveBeenCalledWith({
					type: "warning",
					content: expect.stringContaining("blocked recovery was removed"),
				});
			}

			host._state.setName("Later Save");
			await expect(host._saveCurrentCharacter()).resolves.toBe(true);
			expect(host._characterRepository.pUpsert).toHaveBeenLastCalledWith(expect.objectContaining({
				character: expect.objectContaining({
					id: "new-character-id",
					name: "Later Save",
				}),
			}));
		} finally {
			consoleError.mockRestore();
			toast.mockRestore();
			download.mockRestore();
			prompt.mockRestore();
			globalThis.window.location = previousLocation;
			globalThis.window.history = previousHistory;
		}
	});

	it("exports and discards a quarantined recovery-only create without requiring server state", async () => {
		const state = new CharacterSheetState();
		state.setName("Uncommitted Caster");
		const host = makeHost({state});
		host._currentCharacterId = "temporary-id";
		host._characterLoadGeneration = 1;
		host._isHubCharacter = true;
		host._createNewCharacter = jest.fn(function () {
			this._currentCharacterId = "new-character-id";
		});
		host._pLoadCharacters = jest.fn(async () => {});
		host._selCharacter = {value: "temporary-id"};
		const recovery = {
			intent: "create",
			character: {...state.toJson(), id: "temporary-id"},
			commands: [{
				character: {...state.toJson(), id: "temporary-id"},
				activity: makeSpellActivity("Shield", "spell_slot"),
				intent: "create",
				state: "failed",
			}],
		};
		const error = Object.assign(new Error("Exact request unavailable."), {
			code: "CHARACTER_RECOVERY_EXACT_REQUEST_UNAVAILABLE",
			recovery,
		});
		host._characterRepository = {
			isRescueMirrorEnabled: false,
			pUpsert: jest.fn().mockRejectedValue(error),
			pResolveUnprovableRecovery: jest.fn(async ({fnDiscardLive}) => {
				fnDiscardLive({characterId: "temporary-id"});
				return null;
			}),
		};
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		const download = jest.spyOn(characterSheetDataUtil, "userDownload").mockImplementation(() => {});
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		try {
			await expect(host._saveCurrentCharacter({activity: recovery.commands[0].activity})).resolves.toBe(true);
			expect(download).toHaveBeenCalledWith(
				"character-activity-recovery",
				recovery,
				{fileType: "character-conflict"},
			);
			expect(host._createNewCharacter).toHaveBeenCalledTimes(1);
			expect(host._pLoadCharacters).toHaveBeenCalledTimes(1);
			expect(host._selCharacter.value).toBe("");
			expect(host._characterRepository.pResolveUnprovableRecovery).toHaveBeenCalledWith(expect.objectContaining({
				fnDiscardLive: expect.any(Function),
			}));
		} finally {
			consoleError.mockRestore();
			download.mockRestore();
			prompt.mockRestore();
		}
	});
});
