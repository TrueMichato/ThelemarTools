import {
	HubCharacterMemoryAuthority,
	HubCharacterRepository,
	HubRepositoryError,
	LocalCharacterRepository,
} from "../../../js/hub/hub-character-repository.js";
import {applyJsonPatch, diffJson, rebaseJsonChanges} from "../../../js/hub/hub-json-patch.js";

const makeStorage = (initial = {}) => {
	const data = new Map(Object.entries(initial));
	const writes = [];
	return {
		data,
		writes,
		async pGet (key) { return data.get(key); },
		async pSet (key, value) {
			writes.push({key, value: structuredClone(value)});
			data.set(key, structuredClone(value));
		},
	};
};

describe("hub JSON patches", () => {
	it("diffs and reapplies nested character changes", () => {
		const before = {name: "Mira", hp: {current: 20, max: 20}, notes: {backstory: "A"}};
		const after = {name: "Mira", hp: {current: 13, max: 20}, notes: {backstory: "B"}, conditions: ["Prone"]};
		const patches = diffJson(before, after);

		expect(applyJsonPatch(before, patches)).toEqual(after);
		expect(before.hp.current).toBe(20);
	});

	it("rejects prototype-polluting paths", () => {
		expect(() => applyJsonPatch({}, [{op: "add", path: "/__proto__/polluted", value: true}]))
			.toThrow("Unsafe JSON pointer");
		expect({}.polluted).toBeUndefined();
	});

	it("rejects missing and non-JSON patch values", () => {
		expect(() => applyJsonPatch({hp: 1}, [{op: "replace", path: "/hp"}]))
			.toThrow("requires a value");
		expect(() => applyJsonPatch({hp: 1}, [{op: "replace", path: "/hp", value: Number.NaN}]))
			.toThrow("finite numbers");
		expect(() => applyJsonPatch({}, [{op: "add", path: "/nested", value: JSON.parse("{\"__proto__\":{\"polluted\":true}}")}]))
			.toThrow("Unsafe JSON object key");
		const array = [];
		array.extra = 1n;
		expect(() => applyJsonPatch({}, [{op: "add", path: "/array", value: array}]))
			.toThrow("cannot contain custom properties");
	});

	it("rebases disjoint owner edits over a DM grant and detects overlaps", () => {
		const base = {xp: 100, notes: {backstory: "Old"}};
		const local = {xp: 100, notes: {backstory: "Edited"}};
		const remote = {xp: 300, notes: {backstory: "Old"}};

		expect(rebaseJsonChanges({base, local, remote})).toEqual(expect.objectContaining({
			isConflict: false,
			document: {xp: 300, notes: {backstory: "Edited"}},
		}));

		const conflictingLocal = {xp: 150, notes: {backstory: "Old"}};
		expect(rebaseJsonChanges({base, local: conflictingLocal, remote}).isConflict).toBe(true);
	});
});

describe("local character repository", () => {
	it("preserves the existing whole-roster key without intercepting unrelated storage", async () => {
		const storage = makeStorage({
			"charsheet-characters": [{id: "a", name: "A"}],
			"filter-state": {search: "dragon"},
		});

		const repository = new LocalCharacterRepository({storage});

		await repository.pUpsert({character: {id: "b", name: "B"}});
		await repository.pUpsert({character: {id: "a", name: "A2"}});
		await repository.pDelete({characterId: "b"});

		expect(await repository.pList()).toEqual([{id: "a", name: "A2"}]);
		expect(storage.data.get("filter-state")).toEqual({search: "dragon"});
		expect(new Set(storage.writes.map(it => it.key))).toEqual(new Set(["charsheet-characters"]));
	});

	it("serializes overlapping roster mutations", async () => {
		const data = new Map([["charsheet-characters", [{id: "a", name: "A"}]]]);
		const pendingWrites = [];
		const storage = {
			async pGet (key) { return structuredClone(data.get(key)); },
			async pSet (key, value) {
				await new Promise(resolve => pendingWrites.push(resolve));
				data.set(key, structuredClone(value));
			},
		};
		const repository = new LocalCharacterRepository({storage});
		const saveA = repository.pUpsert({character: {id: "a", name: "A2"}});
		await Promise.resolve();
		const saveB = repository.pUpsert({character: {id: "b", name: "B"}});
		await Promise.resolve();

		expect(pendingWrites).toHaveLength(1);
		pendingWrites.shift()();
		await saveA;
		await Promise.resolve();
		expect(pendingWrites).toHaveLength(1);
		pendingWrites.shift()();
		await saveB;

		expect(await repository.pList()).toEqual([{id: "a", name: "A2"}, {id: "b", name: "B"}]);
	});
});

describe("hub character authority", () => {
	let now;
	let authority;

	beforeEach(() => {
		now = 1_000;
		authority = new HubCharacterMemoryAuthority({fnNow: () => now, leaseTtlMs: 100});
		authority.createCharacter({
			characterId: "char-1",
			ownerId: "player-1",
			campaignId: "campaign-1",
			data: {name: "Mira", xp: 100, hp: {current: 20}, notes: {backstory: "Old"}},
			mutationId: "create-1",
		});
	});

	it("stores characters as independent documents", () => {
		authority.createCharacter({
			characterId: "char-2",
			ownerId: "player-1",
			data: {name: "Other"},
			mutationId: "create-2",
		});
		const lease = authority.acquireLease({characterId: "char-1", sessionId: "device-a"});
		authority.writeCharacterPatch({
			characterId: "char-1",
			sessionId: "device-a",
			leaseEpoch: lease.epoch,
			baseRevision: 1,
			patches: [{op: "replace", path: "/hp/current", value: 12}],
			mutationId: "hp-1",
		});

		expect(authority.getCharacter({characterId: "char-1"}).data.hp.current).toBe(12);
		expect(authority.getCharacter({characterId: "char-2"}).data).toEqual({name: "Other"});
	});

	it("fences a stale editor after takeover", () => {
		const first = authority.acquireLease({characterId: "char-1", sessionId: "device-a"});
		const second = authority.acquireLease({characterId: "char-1", sessionId: "device-b", isTakeover: true});
		expect(second.epoch).toBe(first.epoch + 1);

		expect(() => authority.writeCharacterPatch({
			characterId: "char-1",
			sessionId: "device-a",
			leaseEpoch: first.epoch,
			baseRevision: 1,
			patches: [{op: "replace", path: "/hp/current", value: 1}],
			mutationId: "stale-write",
		})).toThrow(expect.objectContaining({code: "LEASE_FENCED"}));
		expect(authority.getCharacter({characterId: "char-1"}).data.hp.current).toBe(20);
	});

	it("expires abandoned leases and increments the fencing epoch", () => {
		const first = authority.acquireLease({characterId: "char-1", sessionId: "device-a"});
		now += 101;
		expect(() => authority.renewLease({
			characterId: "char-1",
			sessionId: "device-a",
			leaseEpoch: first.epoch,
		})).toThrow(expect.objectContaining({code: "LEASE_EXPIRED"}));

		const second = authority.acquireLease({characterId: "char-1", sessionId: "device-b"});
		expect(second.epoch).toBe(first.epoch + 1);
	});

	it("renews or safely reacquires an expired repository lease", async () => {
		const repository = new HubCharacterRepository({authority, sessionId: "device-a"});
		await repository.pGet({characterId: "char-1"});
		await repository.pAcquireLease({characterId: "char-1"});
		now += 101;

		await repository.pSaveSnapshot({
			characterId: "char-1",
			snapshot: {name: "Mira", xp: 100, hp: {current: 17}, notes: {backstory: "Old"}},
			mutationId: "save-after-expiry",
		});

		expect(authority.getCharacter({characterId: "char-1"}).data.hp.current).toBe(17);
	});

	it("scopes a repository roster to its campaign", async () => {
		authority.createCharacter({
			characterId: "char-other-campaign",
			ownerId: "player-1",
			campaignId: "campaign-2",
			data: {name: "Other Campaign"},
			mutationId: "create-other",
		});
		const repository = new HubCharacterRepository({
			authority,
			sessionId: "device-a",
			ownerId: "player-1",
			campaignId: "campaign-1",
		});

		expect((await repository.pList()).map(it => it.id)).toEqual(["char-1"]);
	});

	it("serializes concurrent cloud saves in invocation order", async () => {
		const repository = new HubCharacterRepository({authority, sessionId: "device-a"});
		await repository.pGet({characterId: "char-1"});
		await repository.pAcquireLease({characterId: "char-1"});

		await Promise.all([
			repository.pSaveSnapshot({
				characterId: "char-1",
				snapshot: {name: "Mira", xp: 100, hp: {current: 15}, notes: {backstory: "Old"}},
			}),
			repository.pSaveSnapshot({
				characterId: "char-1",
				snapshot: {name: "Mira", xp: 100, hp: {current: 10}, notes: {backstory: "Old"}},
			}),
		]);

		expect(authority.getCharacter({characterId: "char-1"}).data.hp.current).toBe(10);
	});

	it("does not reuse mutation IDs after a repository is recreated", async () => {
		const first = new HubCharacterRepository({authority, sessionId: "device-a"});
		await first.pGet({characterId: "char-1"});
		await first.pAcquireLease({characterId: "char-1"});
		await first.pUpsert({character: {id: "char-1", name: "First", xp: 100, hp: {current: 20}, notes: {backstory: "Old"}}});

		const second = new HubCharacterRepository({authority, sessionId: "device-a"});
		await second.pGet({characterId: "char-1"});
		await second.pAcquireLease({characterId: "char-1"});
		await second.pUpsert({character: {id: "char-1", name: "Second", xp: 100, hp: {current: 20}, notes: {backstory: "Old"}}});

		expect(authority.getCharacter({characterId: "char-1"}).data.name).toBe("Second");
		expect(authority.getCharacter({characterId: "char-1"}).revision).toBe(3);
	});

	it("deduplicates retries and emits one event/outbox row", () => {
		const lease = authority.acquireLease({characterId: "char-1", sessionId: "device-a"});
		const input = {
			characterId: "char-1",
			sessionId: "device-a",
			leaseEpoch: lease.epoch,
			baseRevision: 1,
			patches: [{op: "replace", path: "/hp/current", value: 15}],
			mutationId: "same-write",
		};
		const first = authority.writeCharacterPatch(input);
		const retry = authority.writeCharacterPatch(input);

		expect(retry).toEqual(first);
		expect(authority.getCharacter({characterId: "char-1"}).revision).toBe(2);
		expect(authority.getEvents().filter(it => it.type === "character.patched")).toHaveLength(1);
		expect(authority.getOutbox().filter(it => it.type === "character.patched")).toHaveLength(1);
	});

	it("does not let an owner snapshot erase a concurrent DM grant", async () => {
		const repository = new HubCharacterRepository({authority, sessionId: "device-a"});
		const accepted = authority.getCharacter({characterId: "char-1"});
		await repository.pGet({characterId: "char-1"});
		await repository.pAcquireLease({characterId: "char-1"});
		const local = structuredClone(accepted.data);
		local.notes.backstory = "Edited locally";

		authority.applyServerPatch({
			characterId: "char-1",
			actorId: "dm-1",
			baseRevision: accepted.revision,
			patches: [{op: "replace", path: "/xp", value: 300}],
			mutationId: "grant-1",
			eventType: "xp.granted",
		});

		await expect(repository.pSaveSnapshot({
			characterId: "char-1",
			snapshot: local,
			mutationId: "owner-save-1",
		})).rejects.toEqual(expect.objectContaining({
			code: "REVISION_CONFLICT",
			details: expect.objectContaining({actual: 2}),
		}));

		const canonical = authority.getCharacter({characterId: "char-1"});
		const rebased = rebaseJsonChanges({base: accepted.data, local, remote: canonical.data});
		expect(rebased.isConflict).toBe(false);
		expect(rebased.document).toEqual(expect.objectContaining({
			xp: 300,
			notes: {backstory: "Edited locally"},
		}));
	});

	it("uses typed errors for callers to distinguish recovery paths", () => {
		try {
			authority.acquireLease({characterId: "missing", sessionId: "device-a"});
			throw new Error("Expected failure");
		} catch (error) {
			expect(error).toBeInstanceOf(HubRepositoryError);
			expect(error.code).toBe("NOT_FOUND");
		}
	});
});
