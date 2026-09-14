import {jest} from "@jest/globals";
import {HubHttpCharacterRepository} from "../../../js/hub/hub-http-character-repository.js";

class MemoryStorage {
	constructor () {
		this._values = new Map();
	}

	getItem (key) {
		return this._values.get(key) ?? null;
	}

	setItem (key, value) {
		this._values.set(key, value);
	}

	removeItem (key) {
		this._values.delete(key);
	}

	key (index) {
		return [...this._values.keys()][index] ?? null;
	}

	get length () {
		return this._values.size;
	}
}

class FailingStorage extends MemoryStorage {
	constructor ({failOnWrite}) {
		super();
		this._failOnWrite = failOnWrite;
		this._writeCount = 0;
	}

	setItem (key, value) {
		this._writeCount++;
		if (this._writeCount === this._failOnWrite) {
			const error = new Error("sessionStorage quota exceeded");
			error.name = "QuotaExceededError";
			throw error;
		}
		super.setItem(key, value);
	}
}

const makeSpellActivity = (spellName, mode = "cantrip") => ({
	type: "spell.used",
	spellName,
	spellSource: "PHB",
	spellLevel: mode === "cantrip" ? 0 : 1,
	slotLevel: mode === "cantrip" ? 0 : 1,
	mode,
});

describe("HTTP character repository", () => {
	let previousSessionStorage;

	beforeEach(() => {
		previousSessionStorage = globalThis.sessionStorage;
		globalThis.sessionStorage = new MemoryStorage();
	});

	afterEach(() => {
		if (previousSessionStorage === undefined) delete globalThis.sessionStorage;
		else globalThis.sessionStorage = previousSessionStorage;
	});

	it("lists and unwraps campaign character documents", async () => {
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pListCharacters: async () => [
				{id: "server-1", revision: 1, data: {name: "Mira"}},
			],
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await expect(repository.pList()).resolves.toEqual([{id: "server-1", name: "Mira"}]);
	});

	it("lists only detached documents when no campaign scope is selected", async () => {
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pListCharacters: async ({campaignId}) => {
				expect(campaignId).toBeNull();
				return [
					{id: "detached", campaignId: null, revision: 1, data: {name: "Mira"}},
					{id: "attached", campaignId: "campaign-1", revision: 1, data: {name: "Tarin"}},
				];
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: null, api});

		await expect(repository.pList()).resolves.toEqual([{id: "detached", name: "Mira"}]);
	});

	it("rejects a character that moved outside the repository campaign scope", async () => {
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({
				id: "moved",
				campaignId: "campaign-2",
				revision: 2,
				data: {name: "Mira"},
			}),
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});

		await expect(repository.pGet({characterId: "moved"})).rejects.toMatchObject({
			code: "CHARACTER_CAMPAIGN_MISMATCH",
			characterId: "moved",
			campaignId: "campaign-2",
		});
		await expect(repository.pGetCampaignId({characterId: "moved"})).resolves.toBe("campaign-2");
	});

	it("releases the current repository lease and forgets its epoch", async () => {
		let releaseInput;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pAcquireCharacterLease: async () => ({epoch: 7}),
			pReleaseCharacterLease: async input => {
				releaseInput = input;
				return {released: true};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pAcquireLease({characterId: "server-1"});

		await expect(repository.pReleaseLease({characterId: "server-1"})).resolves.toEqual({released: true});
		expect(releaseInput).toEqual({characterId: "server-1"});
		expect(repository._leases.has("server-1")).toBe(false);
	});

	it("clears only retryable lease conflicts without discarding recovery data", () => {
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api: {}});
		const leaseRecovery = {
			local: {name: "Local"},
			server: {name: "Server"},
			conflicts: [{reason: "LEASE_HELD"}],
		};
		repository._conflicts.set("lease-conflict", leaseRecovery);
		repository._failedWrites.set("lease-conflict", leaseRecovery.local);
		repository._conflicts.set("data-conflict", {
			...leaseRecovery,
			conflicts: [{reason: "overlapping paths"}],
		});

		expect(repository.clearRetryableLeaseConflict({characterId: "lease-conflict"})).toBe(true);
		expect(repository.getConflictRecovery("lease-conflict")).toBeNull();
		expect(repository._failedWrites.get("lease-conflict")).toEqual(leaseRecovery.local);
		expect(repository.clearRetryableLeaseConflict({characterId: "data-conflict"})).toBe(false);
		expect(repository.getConflictRecovery("data-conflict")).not.toBeNull();
	});

	it("creates a cloud document and adopts its canonical server id", async () => {
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => {
				const error = new Error("missing");
				error.code = "CHARACTER_NOT_FOUND";
				throw error;
			},
			pCreateCharacter: async ({data}) => ({
				character: {id: "server-id", revision: 1, data},
			}),
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await expect(repository.pUpsert({character: {id: "temporary-id", name: "Mira"}}))
			.resolves.toEqual({id: "server-id", name: "Mira"});
	});

	it("migrates temporary recovery to the canonical id when create committed but its response was lost", async () => {
		const storage = new MemoryStorage();
		const temporaryId = "temporary-id";
		const canonical = {
			id: "server-id",
			ownerAccountId: "owner",
			campaignId: "campaign-1",
			clientImportId: temporaryId,
			revision: 1,
			data: {name: "Mira", hp: {current: 9}},
		};
		let createKey;
		const activity = makeSpellActivity("Shield", "spell_slot");
		const firstApi = {
			pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
			pListCharacters: async () => [],
			pGetCharacter: async () => {
				const error = new Error("missing");
				error.code = "CHARACTER_NOT_FOUND";
				throw error;
			},
			pCreateCharacter: async input => {
				createKey = input.idempotencyKey;
				throw new Error("response lost");
			},
		};
		const first = new HubHttpCharacterRepository({campaignId: "campaign-1", api: firstApi});
		first._recoveryStorage = storage;
		await first.pList();
		await expect(first.pUpsert({character: {id: temporaryId, ...canonical.data}, activity})).rejects.toThrow("response lost");
		const stored = JSON.parse(storage.getItem(`hub-character-recovery:campaign-1:${temporaryId}`));
		const patchKey = stored.commands[0].commandKeys.patch;

		const retryCreates = [];
		const patches = [];
		const freshApi = {
			pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
			pListCharacters: async () => [structuredClone(canonical)],
			pGetCharacter: async ({characterId}) => {
				expect(characterId).toBe(canonical.id);
				return structuredClone(canonical);
			},
			pCreateCharacter: async input => {
				retryCreates.push(input);
				return {character: structuredClone(canonical)};
			},
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				patches.push(structuredClone(input));
				return {character: {...structuredClone(canonical), revision: 2}};
			},
		};
		const fresh = new HubHttpCharacterRepository({campaignId: "campaign-1", api: freshApi});
		fresh._recoveryStorage = storage;

		await expect(fresh.pList()).resolves.toEqual([{id: canonical.id, ...canonical.data}]);
		expect(fresh._canonicalIds.get(temporaryId)).toBe(canonical.id);
		expect(storage.getItem(`hub-character-recovery:campaign-1:${temporaryId}`)).toBeNull();
		const migrated = JSON.parse(storage.getItem(`hub-character-recovery:campaign-1:${canonical.id}`));
		expect(migrated.commands[0].commandKeys).toEqual({create: createKey, patch: patchKey});
		await expect(fresh.pGet({characterId: canonical.id})).resolves.toEqual({id: canonical.id, ...canonical.data});
		await expect(fresh.pUpsert({character: {id: canonical.id, ...canonical.data}, activity}))
			.resolves.toEqual({id: canonical.id, ...canonical.data});
		expect(retryCreates).toEqual([]);
		expect(patches).toHaveLength(1);
		expect(patches[0]).toEqual(expect.objectContaining({idempotencyKey: patchKey, activity}));
		expect(storage.getItem(`hub-character-recovery:campaign-1:${canonical.id}`)).toBeNull();
		expect(createKey).toBeTruthy();
	});

	it("discovers canonical identity before routing a temporary recovery URL", async () => {
		const storage = new MemoryStorage();
		const temporaryId = "temporary-id";
		const canonical = {
			id: "server-id",
			ownerAccountId: "owner",
			campaignId: "campaign-1",
			clientImportId: temporaryId,
			revision: 1,
			data: {name: "Mira"},
		};
		const seed = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pGetCharacter: async () => {
					const error = new Error("missing");
					error.code = "CHARACTER_NOT_FOUND";
					throw error;
				},
				pCreateCharacter: async () => { throw new Error("response lost"); },
			},
		});
		seed._recoveryStorage = storage;
		await expect(seed.pUpsert({character: {id: temporaryId, name: "Mira"}})).rejects.toThrow("response lost");

		const getCharacter = jest.fn(async ({characterId}) => {
			expect(characterId).toBe(canonical.id);
			return structuredClone(canonical);
		});
		const fresh = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pListCharacters: async () => [structuredClone(canonical)],
				pGetCharacter: getCharacter,
			},
		});
		fresh._recoveryStorage = storage;

		await expect(fresh.pGetCampaignId({characterId: temporaryId})).resolves.toBe("campaign-1");
		expect(fresh._canonicalIds.get(temporaryId)).toBe(canonical.id);
		expect(getCharacter).not.toHaveBeenCalled();
		expect(storage.getItem(`hub-character-recovery:campaign-1:${temporaryId}`)).toBeNull();
		expect(storage.getItem(`hub-character-recovery:campaign-1:${canonical.id}`)).not.toBeNull();

		const reloaded = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pListCharacters: async () => [structuredClone(canonical)],
				pGetCharacter: getCharacter,
			},
		});
		reloaded._recoveryStorage = storage;
		await expect(reloaded.pGetCampaignId({characterId: temporaryId})).resolves.toBe("campaign-1");
		expect(reloaded._canonicalIds.get(temporaryId)).toBe(canonical.id);
		expect(getCharacter).not.toHaveBeenCalled();
	});

	it("routes a genuine recovery-only temporary URL without a doomed character lookup", async () => {
		const storage = new MemoryStorage();
		const temporaryId = "temporary-id";
		const seed = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pGetCharacter: async () => {
					const error = new Error("missing");
					error.code = "CHARACTER_NOT_FOUND";
					throw error;
				},
				pCreateCharacter: async () => { throw new Error("offline before commit"); },
			},
		});
		seed._recoveryStorage = storage;
		await expect(seed.pUpsert({character: {id: temporaryId, name: "Mira"}})).rejects.toThrow("offline before commit");

		const getCharacter = jest.fn();
		const fresh = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pListCharacters: async () => [],
				pGetCharacter: getCharacter,
			},
		});
		fresh._recoveryStorage = storage;

		await expect(fresh.pGetCampaignId({characterId: temporaryId})).resolves.toBe("campaign-1");
		expect(getCharacter).not.toHaveBeenCalled();
		await expect(fresh.pGet({characterId: temporaryId})).resolves.toEqual({id: temporaryId, name: "Mira"});
	});

	it("keeps temporary recovery intact when canonical identity migration cannot be stored", async () => {
		const storage = new MemoryStorage();
		const temporaryId = "temporary-id";
		const canonicalId = "server-id";
		const firstApi = {
			pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
			pListCharacters: async () => [],
			pGetCharacter: async () => {
				const error = new Error("missing");
				error.code = "CHARACTER_NOT_FOUND";
				throw error;
			},
			pCreateCharacter: async () => { throw new Error("response lost"); },
		};
		const first = new HubHttpCharacterRepository({campaignId: "campaign-1", api: firstApi});
		first._recoveryStorage = storage;
		await first.pList();
		await expect(first.pUpsert({character: {id: temporaryId, name: "Mira"}})).rejects.toThrow("response lost");
		const temporaryKey = `hub-character-recovery:campaign-1:${temporaryId}`;
		const canonicalKey = `hub-character-recovery:campaign-1:${canonicalId}`;
		const storedBefore = storage.getItem(temporaryKey);
		const setItem = storage.setItem.bind(storage);
		storage.setItem = (key, value) => {
			if (key === canonicalKey) throw new Error("quota");
			setItem(key, value);
		};

		const fresh = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pListCharacters: async () => [{
					id: canonicalId,
					ownerAccountId: "owner",
					campaignId: "campaign-1",
					clientImportId: temporaryId,
					revision: 1,
					data: {name: "Mira"},
				}],
			},
		});
		fresh._recoveryStorage = storage;

		await expect(fresh.pList()).rejects.toMatchObject({code: "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE"});
		expect(fresh._canonicalIds.has(temporaryId)).toBe(false);
		expect(storage.getItem(temporaryKey)).toBe(storedBefore);
		expect(storage.getItem(canonicalKey)).toBeNull();
	});

	it("lists and retries an owner-scoped recovery-only create that never reached the server", async () => {
		const storage = new MemoryStorage();
		const temporaryId = "temporary-id";
		let createKey;
		const firstApi = {
			pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
			pListCharacters: async () => [],
			pGetCharacter: async () => {
				const error = new Error("missing");
				error.code = "CHARACTER_NOT_FOUND";
				throw error;
			},
			pCreateCharacter: async input => {
				createKey = input.idempotencyKey;
				throw new Error("offline before commit");
			},
		};
		const first = new HubHttpCharacterRepository({campaignId: "campaign-1", api: firstApi});
		first._recoveryStorage = storage;
		await first.pList();
		await expect(first.pUpsert({character: {id: temporaryId, name: "Mira", hp: {current: 9}}}))
			.rejects.toThrow("offline before commit");

		const createInputs = [];
		const canonical = {
			id: "server-id",
			ownerAccountId: "owner",
			campaignId: "campaign-1",
			clientImportId: temporaryId,
			revision: 1,
			data: {name: "Mira", hp: {current: 9}},
		};
		const freshApi = {
			pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
			pListCharacters: async () => [],
			pGetCharacter: jest.fn(async () => {
				const error = new Error("missing");
				error.code = "CHARACTER_NOT_FOUND";
				throw error;
			}),
			pCreateCharacter: async input => {
				createInputs.push(structuredClone(input));
				return {character: structuredClone(canonical)};
			},
		};
		const fresh = new HubHttpCharacterRepository({campaignId: "campaign-1", api: freshApi});
		fresh._recoveryStorage = storage;

		await expect(fresh.pList()).resolves.toEqual([{id: temporaryId, name: "Mira", hp: {current: 9}}]);
		await expect(fresh.pGet({characterId: temporaryId})).resolves.toEqual({id: temporaryId, name: "Mira", hp: {current: 9}});
		expect(freshApi.pGetCharacter).not.toHaveBeenCalled();
		await expect(fresh.pUpsert({character: {id: temporaryId, name: "Mira", hp: {current: 9}}}))
			.resolves.toEqual({id: canonical.id, ...canonical.data});
		expect(createInputs).toHaveLength(1);
		expect(createInputs[0].idempotencyKey).toBe(createKey);
		expect(storage.getItem(`hub-character-recovery:campaign-1:${temporaryId}`)).toBeNull();
		expect(storage.getItem(`hub-character-recovery:campaign-1:${canonical.id}`)).toBeNull();
	});

	it("does not list another account's recovery-only create", async () => {
		const storage = new MemoryStorage();
		const seedApi = {
			pGetSession: async () => ({signedIn: true, account: {id: "owner-a"}}),
			pListCharacters: async () => [],
			pGetCharacter: async () => {
				const error = new Error("missing");
				error.code = "CHARACTER_NOT_FOUND";
				throw error;
			},
			pCreateCharacter: async () => { throw new Error("offline"); },
		};
		const seed = new HubHttpCharacterRepository({campaignId: "campaign-1", api: seedApi});
		seed._recoveryStorage = storage;
		await seed.pList();
		await expect(seed.pUpsert({character: {id: "private-temporary-id", name: "Private"}})).rejects.toThrow("offline");

		const other = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner-b"}}),
				pListCharacters: async () => [],
			},
		});
		other._recoveryStorage = storage;

		await expect(other.pList()).resolves.toEqual([]);
	});

	it("does not migrate another account's recovery through a colliding client import id", async () => {
		const storage = new MemoryStorage();
		const temporaryId = "colliding-temporary-id";
		const privateKey = `hub-character-recovery:campaign-1:${temporaryId}`;
		const seed = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner-a"}}),
				pGetCharacter: async () => {
					const error = new Error("missing");
					error.code = "CHARACTER_NOT_FOUND";
					throw error;
				},
				pCreateCharacter: async () => { throw new Error("offline"); },
			},
		});
		seed._recoveryStorage = storage;
		await expect(seed.pUpsert({character: {id: temporaryId, name: "Owner A Private"}})).rejects.toThrow("offline");
		const privateRecovery = storage.getItem(privateKey);

		const ownerBCharacter = {
			id: "owner-b-character",
			ownerAccountId: "owner-b",
			campaignId: "campaign-1",
			clientImportId: temporaryId,
			revision: 1,
			data: {name: "Owner B Public"},
		};
		const other = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner-b"}}),
				pListCharacters: async () => [structuredClone(ownerBCharacter)],
			},
		});
		other._recoveryStorage = storage;

		await expect(other.pList()).resolves.toEqual([{id: ownerBCharacter.id, name: "Owner B Public"}]);
		expect(other._canonicalIds.has(temporaryId)).toBe(false);
		expect(storage.getItem(privateKey)).toBe(privateRecovery);
		expect(storage.getItem(`hub-character-recovery:campaign-1:${ownerBCharacter.id}`)).toBeNull();
	});

	it("does not migrate same-owner patch recovery through a colliding client import id", async () => {
		const storage = new MemoryStorage();
		const patchedCharacterId = "established-a";
		const collidingCharacterId = "established-b";
		const established = {
			id: patchedCharacterId,
			ownerAccountId: "owner",
			campaignId: "campaign-1",
			revision: 1,
			data: {name: "Character A", hp: {current: 10}},
		};
		const seed = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pGetCharacter: async () => structuredClone(established),
				pAcquireCharacterLease: async () => ({epoch: 1}),
				pPatchCharacter: async () => { throw new Error("offline"); },
			},
		});
		seed._recoveryStorage = storage;
		await seed.pGet({characterId: patchedCharacterId});
		await expect(seed.pUpsert({
			character: {id: patchedCharacterId, name: "Character A", hp: {current: 9}},
		})).rejects.toThrow("offline");
		const recoveryKey = `hub-character-recovery:campaign-1:${patchedCharacterId}`;
		const recoveryRaw = storage.getItem(recoveryKey);

		const colliding = {
			id: collidingCharacterId,
			ownerAccountId: "owner",
			campaignId: "campaign-1",
			clientImportId: patchedCharacterId,
			revision: 1,
			data: {name: "Character B", hp: {current: 6}},
		};
		const fresh = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pListCharacters: async () => [structuredClone(colliding)],
			},
		});
		fresh._recoveryStorage = storage;

		await expect(fresh.pList()).resolves.toEqual([{id: collidingCharacterId, name: "Character B", hp: {current: 6}}]);
		expect(fresh._canonicalIds.has(patchedCharacterId)).toBe(false);
		expect(storage.getItem(recoveryKey)).toBe(recoveryRaw);
		expect(storage.getItem(`hub-character-recovery:campaign-1:${collidingCharacterId}`)).toBeNull();
	});

	it("does not expose or recreate a failed patch when its established character disappears", async () => {
		const storage = new MemoryStorage();
		const characterId = "established-id";
		const established = {
			id: characterId,
			ownerAccountId: "owner",
			campaignId: "campaign-1",
			revision: 1,
			data: {name: "Mira", hp: {current: 10}},
		};
		const seed = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pGetCharacter: async () => structuredClone(established),
				pAcquireCharacterLease: async () => ({epoch: 1}),
				pPatchCharacter: async () => { throw new Error("offline"); },
			},
		});
		seed._recoveryStorage = storage;
		await seed.pGet({characterId});
		await expect(seed.pUpsert({character: {id: characterId, name: "Mira", hp: {current: 9}}})).rejects.toThrow("offline");
		const stored = JSON.parse(storage.getItem(`hub-character-recovery:campaign-1:${characterId}`));
		expect(stored.intent).toBe("patch");
		expect(stored.clientImportId).toBeUndefined();

		const create = jest.fn();
		const missing = Object.assign(new Error("missing"), {code: "CHARACTER_NOT_FOUND"});
		const fresh = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pListCharacters: async () => [],
				pGetCharacter: async () => { throw missing; },
				pCreateCharacter: create,
			},
		});
		fresh._recoveryStorage = storage;

		await expect(fresh.pList()).resolves.toEqual([]);
		expect(fresh.getPendingRecovery(characterId)).toEqual({name: "Mira", hp: {current: 9}});
		await expect(fresh.pUpsert({character: {id: characterId, name: "Mira", hp: {current: 9}}})).rejects.toBe(missing);
		expect(create).not.toHaveBeenCalled();
		expect(storage.getItem(`hub-character-recovery:campaign-1:${characterId}`)).not.toBeNull();
	});

	it("does not infer create intent from legacy recovery without a recorded base", async () => {
		const storage = new MemoryStorage();
		const characterId = "legacy-established-id";
		storage.setItem(`hub-character-recovery:campaign-1:${characterId}`, JSON.stringify({
			ownerAccountId: "owner",
			clientImportId: characterId,
			snapshot: {name: "Legacy", hp: {current: 9}},
			commandKeys: {create: "legacy-create", patch: "legacy-patch"},
		}));
		const repository = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pListCharacters: async () => [],
			},
		});
		repository._recoveryStorage = storage;

		await expect(repository.pList()).resolves.toEqual([]);
		expect(repository._recoveryOnlyIds.has(characterId)).toBe(false);
		expect(storage.getItem(`hub-character-recovery:campaign-1:${characterId}`)).not.toBeNull();
	});

	it("resolves Use Local through the canonical id after temporary recovery migration", async () => {
		const temporaryId = "temporary-id";
		const canonicalId = "server-id";
		const leases = [];
		const patches = [];
		const repository = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "owner"}}),
				pAcquireCharacterLease: async input => {
					leases.push(structuredClone(input));
					return {epoch: 2};
				},
				pPatchCharacter: async input => {
					patches.push(structuredClone(input));
					return {
						character: {
							id: canonicalId,
							ownerAccountId: "owner",
							campaignId: "campaign-1",
							revision: 3,
							data: {hp: {current: 9}},
						},
					};
				},
			},
		});
		repository._canonicalIds.set(temporaryId, canonicalId);
		repository._accepted.set(canonicalId, {
			id: canonicalId,
			ownerAccountId: "owner",
			campaignId: "campaign-1",
			revision: 2,
			data: {hp: {current: 7}},
		});
		repository._conflicts.set(canonicalId, {
			base: {hp: {current: 10}},
			local: {hp: {current: 9}},
			server: {hp: {current: 7}},
			serverDocument: {
				id: canonicalId,
				ownerAccountId: "owner",
				campaignId: "campaign-1",
				revision: 2,
				data: {hp: {current: 7}},
			},
			conflicts: [{localPath: "/hp/current", remotePath: "/hp/current"}],
		});
		repository._recoveryCommandQueues.set(canonicalId, [{
			requestedId: canonicalId,
			submittedSnapshot: {hp: {current: 9}},
			submittedActivity: makeSpellActivity("Shield", "spell_slot"),
			commandKeys: {create: "create-key", patch: "patch-key"},
			submittedBase: {hp: {current: 10}},
			submittedBaseCoverage: {revision: 1, acceptedSequence: null},
			submittedSnapshotCoverage: {revision: 1, acceptedSequence: null},
			state: "conflict",
			intent: "patch",
		}]);

		await expect(repository.pResolveConflict({characterId: temporaryId, choice: "local"}))
			.resolves.toEqual({id: canonicalId, hp: {current: 9}});
		expect(leases).toEqual([{characterId: canonicalId, isTakeover: true}, {characterId: canonicalId, isTakeover: false}]);
		expect(patches).toEqual([expect.objectContaining({characterId: canonicalId, idempotencyKey: "patch-key"})]);
		expect(repository.getConflictRecovery(canonicalId)).toBeNull();
	});

	it("uses accepted revision and lease epoch for patch saves", async () => {
		const calls = [];
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({
				id: "server-1",
				campaignId: "campaign-1",
				revision: 3,
				data: {name: "Mira", hp: {current: 20}},
			}),
			pAcquireCharacterLease: async () => ({epoch: 7}),
			pPatchCharacter: async input => {
				calls.push(input);
				return {
					character: {
						id: "server-1",
						revision: 4,
						data: {name: "Mira", hp: {current: 12}},
					},
				};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "server-1"});
		await repository.pAcquireLease({characterId: "server-1"});
		await repository.pUpsert({character: {id: "server-1", name: "Mira", hp: {current: 12}}});

		expect(calls).toEqual([
			expect.objectContaining({
				characterId: "server-1",
				baseRevision: 3,
				leaseEpoch: 7,
				patches: [{op: "replace", path: "/hp/current", value: 12}],
			}),
		]);
	});

	it("persists an explicit spell-use activity even when the character document is unchanged", async () => {
		const calls = [];
		const activity = {
			type: "spell.used",
			spellName: "Fire Bolt",
			spellSource: "PHB",
			spellLevel: 0,
			slotLevel: 0,
			mode: "cantrip",
		};
		const character = {
			id: "server-1",
			campaignId: "campaign-1",
			revision: 3,
			data: {name: "Mira"},
		};
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => structuredClone(character),
			pAcquireCharacterLease: async () => ({epoch: 7}),
			pPatchCharacter: async input => {
				calls.push(input);
				return {character: structuredClone(character)};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "server-1"});

		await repository.pUpsert({character: {id: "server-1", name: "Mira"}, activity});

		expect(calls).toEqual([expect.objectContaining({
			characterId: "server-1",
			baseRevision: 3,
			leaseEpoch: 7,
			patches: [],
			activity,
		})]);
	});

	it("keeps campaign characters read-only while signed out", async () => {
		const repository = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {pGetSession: async () => ({signedIn: false})},
		});

		await expect(repository.pList()).rejects.toThrow("Sign in to edit campaign characters");
	});

	it("serializes realtime delivery behind an in-flight save without changing repository state", async () => {
		let resolvePatch;
		const pPatch = new Promise(resolve => resolvePatch = resolve);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({
				id: "server-1",
				campaignId: "campaign-1",
				revision: 3,
				data: {name: "Mira", hp: {current: 20}},
			}),
			pAcquireCharacterLease: async () => ({epoch: 7}),
			pPatchCharacter: async () => pPatch,
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "server-1"});
		const pSave = repository.pUpsert({character: {id: "server-1", name: "Mira", hp: {current: 17}}});
		const delivered = [];
		const pDelivery = repository.pEnqueueRealtimeDelivery({
			characterId: "server-1",
			fnDeliver: () => delivered.push("operation"),
		});
		await Promise.resolve();
		expect(delivered).toEqual([]);

		resolvePatch({
			character: {
				id: "server-1",
				campaignId: "campaign-1",
				revision: 4,
				data: {name: "Mira", hp: {current: 17}},
			},
		});
		await pSave;
		const acceptedAfterSave = structuredClone(repository._accepted.get("server-1"));
		const leasesAfterSave = structuredClone([...repository._leases]);
		await pDelivery;

		expect(delivered).toEqual(["operation"]);
		expect(repository._accepted.get("server-1")).toEqual(acceptedAfterSave);
		expect([...repository._leases]).toEqual(leasesAfterSave);
		expect(repository._conflicts.size).toBe(0);
		expect(repository._failedWrites.size).toBe(0);
		expect(repository._recoveryVersions.size).toBe(0);
	});

	it("rebases authoritative inventory escrow into the live sheet without losing disjoint edits", async () => {
		let revision = 1;
		const documents = {
			1: {id: "server-1", campaignId: "campaign-1", revision: 1, data: {notes: "before", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 10}]}},
			2: {id: "server-1", campaignId: "campaign-1", revision: 2, data: {notes: "before", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 7}]}},
		};
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => structuredClone(documents[revision]),
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "server-1"});
		revision = 2;
		let adopted;
		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "server-1",
			fnGetLiveData: () => ({notes: "locally edited", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 10}]}),
			fnAdoptLive: data => adopted = data,
		})).resolves.toMatchObject({status: "reconciled", revision: 2});

		expect(adopted).toEqual({notes: "locally edited", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 7}]});
		expect(repository._accepted.get("server-1")).toEqual(documents[2]);
	});

	it("does not treat a recomputed derived carry block as an inventory conflict", async () => {
		let revision = 1;
		const carry = grossWeight => ({schemaVersion: 1, grossWeight});
		const documents = {
			1: {
				id: "server-1",
				campaignId: "campaign-1",
				revision: 1,
				data: {notes: "before", inventory: [], carry: carry(0)},
			},
			2: {
				id: "server-1",
				campaignId: "campaign-1",
				revision: 2,
				data: {notes: "before", inventory: [{id: "sword", item: {name: "Sword"}, quantity: 1}]},
			},
		};
		const repository = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCharacter: async () => structuredClone(documents[revision]),
			},
		});
		await repository.pGet({characterId: "server-1"});
		revision = 2;
		let adopted;

		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "server-1",
			fnGetLiveData: () => ({notes: "locally edited", inventory: [], carry: carry(1)}),
			fnAdoptLive: data => adopted = data,
		})).resolves.toMatchObject({status: "reconciled", revision: 2});

		expect(adopted).toEqual({
			notes: "locally edited",
			inventory: [{id: "sword", item: {name: "Sword"}, quantity: 1}],
		});
		expect(repository._conflicts.size).toBe(0);
	});

	it("rebases live-conflict recovery before it can restore pre-transfer inventory", async () => {
		let revision = 1;
		const documents = {
			1: {id: "server-1", campaignId: "campaign-1", revision: 1, data: {notes: "server", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 10}]}},
			2: {id: "server-1", campaignId: "campaign-1", revision: 2, data: {notes: "server", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 7}]}},
		};
		const repository = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCharacter: async () => structuredClone(documents[revision]),
			},
		});
		await repository.pGet({characterId: "server-1"});
		repository.registerLiveConflict({
			characterId: "server-1",
			recovery: {
				base: {notes: "submitted", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 10}]},
				local: {notes: "live edit", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 10}]},
				server: documents[1].data,
				conflicts: [{localPath: "/notes", remotePath: "/notes"}],
			},
		});
		revision = 2;

		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "server-1",
			fnGetLiveData: () => ({notes: "live edit", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 10}]}),
			fnAdoptLive: jest.fn(),
		})).resolves.toMatchObject({status: "reconciled", revision: 2});

		const recovery = repository.getLiveConflictRecovery("server-1");
		for (const key of ["base", "local", "server"]) expect(recovery[key].inventory[0].quantity).toBe(7);
		expect(recovery.serverDocument).toEqual(documents[2]);
		expect(recovery.coverage).toMatchObject({
			base: {revision: 2},
			local: {revision: 2},
			server: {revision: 2},
		});
	});

	it("fences an authoritative fetch before it can adopt a different character generation", async () => {
		let getCount = 0;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => (++getCount === 1
				? {id: "server-1", campaignId: "campaign-1", revision: 1, data: {inventory: []}}
				: {id: "server-1", campaignId: "campaign-1", revision: 2, data: {inventory: [{id: "new", item: {name: "Map"}, quantity: 1}]}}),
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "server-1"});
		const adopt = jest.fn();

		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "server-1",
			fnGetLiveData: () => ({inventory: []}),
			fnAdoptLive: adopt,
			fnIsCurrent: () => false,
		})).resolves.toEqual({status: "fenced"});
		expect(adopt).not.toHaveBeenCalled();
		expect(getCount).toBe(1);
	});

	it("keeps authoritative escrow in every recovery candidate while preserving the original local export", async () => {
		let revision = 1;
		const documents = {
			1: {id: "server-1", campaignId: "campaign-1", revision: 1, data: {inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 10}]}},
			2: {id: "server-1", campaignId: "campaign-1", revision: 2, data: {inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 7}]}},
			3: {id: "server-1", campaignId: "campaign-1", revision: 3, data: {inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 5}]}},
		};
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => structuredClone(documents[revision]),
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "server-1"});
		revision = 2;
		const local = {inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 9}]};

		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "server-1",
			fnGetLiveData: () => local,
			fnAdoptLive: () => { throw new Error("must not adopt"); },
		})).resolves.toMatchObject({status: "conflict"});
		let recovery = repository.getConflictRecovery("server-1");
		expect(recovery).toMatchObject({
			local: documents[2].data,
			server: documents[2].data,
			serverDocument: documents[2],
			authoritativeDiscarded: {live: local},
		});
		expect(repository._accepted.get("server-1")).toEqual(documents[1]);

		revision = 3;
		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "server-1",
			fnGetLiveData: () => local,
			fnAdoptLive: () => { throw new Error("must not adopt"); },
		})).resolves.toMatchObject({status: "conflict"});
		recovery = repository.getConflictRecovery("server-1");
		for (const key of ["base", "local", "server"]) expect(recovery[key].inventory[0].quantity).toBe(5);
		expect(recovery.authoritativeDiscarded.live.inventory[0].quantity).toBe(9);
		expect(recovery.serverDocument).toEqual(documents[3]);
	});

	it("persists authoritative conflict rebases across every queued command before Use Local replay", async () => {
		let canonical = {
			id: "server-1",
			campaignId: "campaign-1",
			revision: 1,
			data: {notes: "server", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 10}]},
		};
		const requests = [];
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => structuredClone(canonical),
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				requests.push(input);
				expect(input.patches.some(patch => patch.path.startsWith("/inventory"))).toBe(false);
				const notes = input.patches.find(patch => patch.path === "/notes")?.value;
				canonical = {
					...canonical,
					revision: canonical.revision + 1,
					data: {...canonical.data, notes},
				};
				return {character: structuredClone(canonical)};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "server-1"});
		const initialCoverage = repository._cloneTrackCoverage(repository._getAcceptedCoverage("server-1"));
		const firstActivity = makeSpellActivity("Shield", "spell_slot");
		const secondActivity = makeSpellActivity("Magic Missile", "spell_slot");
		const firstSnapshot = {notes: "first", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 9}]};
		const secondSnapshot = {notes: "second", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 9}]};
		repository._persistRecoveryCommandQueue("server-1", {
			queue: [
				{
					requestedId: "server-1",
					submittedBase: structuredClone(canonical.data),
					submittedBaseCoverage: repository._cloneTrackCoverage(initialCoverage),
					submittedSnapshot: firstSnapshot,
					submittedSnapshotCoverage: repository._cloneTrackCoverage(initialCoverage),
					submittedActivity: firstActivity,
					commandKeys: {create: "create-1", patch: "patch-1"},
					state: "failed",
				},
				{
					requestedId: "server-1",
					submittedBase: firstSnapshot,
					submittedBaseCoverage: repository._cloneTrackCoverage(initialCoverage),
					submittedSnapshot: secondSnapshot,
					submittedSnapshotCoverage: repository._cloneTrackCoverage(initialCoverage),
					submittedActivity: secondActivity,
					commandKeys: {create: "create-2", patch: "patch-2"},
					state: "pending",
				},
			],
			isRequired: true,
		});
		canonical = {
			...canonical,
			revision: 2,
			data: {notes: "server", inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 7}]},
		};

		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "server-1",
			fnGetLiveData: () => secondSnapshot,
		})).resolves.toMatchObject({status: "conflict"});
		const queued = repository._recoveryCommandQueues.get("server-1");
		expect(queued.map(command => command.submittedBase.inventory[0].quantity)).toEqual([7, 7]);
		expect(queued.map(command => command.submittedSnapshot.inventory[0].quantity)).toEqual([7, 7]);
		expect(queued.map(command => command.submittedActivity)).toEqual([firstActivity, secondActivity]);

		await expect(repository.pResolveConflict({characterId: "server-1", choice: "local"})).resolves.toEqual({
			id: "server-1",
			notes: "second",
			inventory: [{id: "arrows", item: {name: "Arrow"}, quantity: 7}],
		});
		expect(requests.map(request => request.activity)).toEqual([firstActivity, secondActivity]);
		expect(repository._recoveryCommandQueues.size).toBe(0);
	});

	it("suppresses duplicate authoritative reconciliation once the revision is accepted", async () => {
		const document = {id: "server-1", campaignId: "campaign-1", revision: 2, data: {inventory: []}};
		const repository = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {pGetSession: async () => ({signedIn: true}), pGetCharacter: async () => structuredClone(document)},
		});
		await repository.pGet({characterId: "server-1"});
		const adopt = jest.fn();

		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "server-1",
			fnGetLiveData: () => ({inventory: []}),
			fnAdoptLive: adopt,
		})).resolves.toEqual({status: "unchanged"});
		expect(adopt).not.toHaveBeenCalled();
	});

	it("patches later queued snapshots after the first create returns a canonical id", async () => {
		const calls = [];
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async ({characterId}) => {
				if (characterId === "temp") {
					const error = new Error("missing");
					error.code = "CHARACTER_NOT_FOUND";
					throw error;
				}
				return {id: "server", revision: 1, data: {name: "First"}};
			},
			pCreateCharacter: async ({data}) => ({character: {id: "server", revision: 1, data}}),
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				calls.push(input);
				return {character: {id: "server", revision: 2, data: {name: "Second"}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		const first = repository.pUpsert({character: {id: "temp", name: "First"}});
		const second = repository.pUpsert({character: {id: "temp", name: "Second"}});
		await expect(first).resolves.toEqual({id: "server", name: "First"});
		await expect(second).resolves.toEqual({id: "server", name: "Second"});
		expect(calls).toHaveLength(1);
		expect(calls[0].characterId).toBe("server");
	});

	it("preserves a remote grant across later queued local saves", async () => {
		const calls = [];
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {xp: 0, hp: {current: 20}}}),
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				calls.push(input);
				return calls.length === 1
					? {character: {id: "c", revision: 3, data: {xp: 100, hp: {current: 19}}}}
					: {character: {id: "c", revision: 4, data: {xp: 100, hp: {current: 18}}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		const first = repository.pUpsert({character: {id: "c", xp: 0, hp: {current: 19}}});
		const second = repository.pUpsert({character: {id: "c", xp: 0, hp: {current: 18}}});
		await first;
		await expect(second).resolves.toEqual({id: "c", xp: 100, hp: {current: 18}});
		expect(calls[1].patches).toEqual([{op: "replace", path: "/hp/current", value: 18}]);
	});

	it("rebases disjoint local edits after a remote revision change", async () => {
		let patchCalls = 0;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => patchCalls
				? {id: "c", campaignId: "cmp", revision: 2, data: {name: "Mira", xp: 200, notes: "old"}}
				: {id: "c", campaignId: "cmp", revision: 1, data: {name: "Mira", xp: 100, notes: "old"}},
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				if (!patchCalls++) {
					const error = new Error("conflict");
					error.code = "REVISION_CONFLICT";
					throw error;
				}
				expect(input.baseRevision).toBe(2);
				return {character: {id: "c", revision: 3, data: {name: "Mira", xp: 200, notes: "edited"}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		await expect(repository.pUpsert({character: {id: "c", name: "Mira", xp: 100, notes: "edited"}}))
			.resolves.toEqual({id: "c", name: "Mira", xp: 200, notes: "edited"});
	});

	it("returns an exportable recovery object for overlapping conflicts", async () => {
		let getCount = 0;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ++getCount === 1
				? {id: "c", campaignId: "cmp", revision: 1, data: {name: "Mira", xp: 100}}
				: {id: "c", campaignId: "cmp", revision: 2, data: {name: "Mira", xp: 200}},
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async () => {
				const error = new Error("conflict");
				error.code = "REVISION_CONFLICT";
				throw error;
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		await expect(repository.pUpsert({character: {id: "c", name: "Mira", xp: 150}}))
			.rejects.toEqual(expect.objectContaining({
				code: "CHARACTER_CONFLICT",
				recovery: expect.objectContaining({local: expect.any(Object), server: expect.any(Object)}),
			}));
	});

	it("clears rejected local recovery when the user chooses server", async () => {
		const removed = [];
		const storage = {
			removeItem: key => removed.push(key),
			getItem: () => null,
			setItem () {},
		};
		const repository = new HubHttpCharacterRepository({
			campaignId: "cmp",
			api: {pGetSession: async () => ({signedIn: true})},
		});
		repository._recoveryStorage = storage;
		repository._conflicts.set("c", {local: {xp: 150}, serverDocument: {id: "c", data: {xp: 200}}});
		repository._failedWrites.set("c", {xp: 150});
		await expect(repository.pResolveConflict({characterId: "c", choice: "server"})).resolves.toEqual({id: "c", xp: 200});
		expect(repository.hasPendingWrites()).toBe(false);
		expect(removed).toEqual(["hub-character-recovery:cmp:c"]);
	});

	it("keeps the newest queued local snapshot in conflict recovery", async () => {
		let getCount = 0;
		let doRelease;
		let doNotifyStarted;
		const pStarted = new Promise(resolve => doNotifyStarted = resolve);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ++getCount === 1
				? {id: "c", campaignId: "cmp", revision: 1, data: {name: "Mira", xp: 100}}
				: {id: "c", campaignId: "cmp", revision: 2, data: {name: "Mira", xp: 200}},
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async () => {
				doNotifyStarted();
				await new Promise(resolve => doRelease = resolve);
				const error = new Error("conflict");
				error.code = "REVISION_CONFLICT";
				throw error;
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		const first = repository.pUpsert({character: {id: "c", name: "Mira", xp: 150}});
		await pStarted;
		const second = repository.pUpsert({character: {id: "c", name: "Mira", xp: 175}});
		doRelease();
		await expect(first).rejects.toEqual(expect.objectContaining({code: "CHARACTER_CONFLICT"}));
		await expect(second).rejects.toEqual(expect.objectContaining({code: "CHARACTER_CONFLICT"}));
		expect(repository.getConflictRecovery("c").local.xp).toBe(175);
		expect(repository.hasPendingWrites()).toBe(true);
	});

	it("reuses the exact patch key after a lost response", async () => {
		const keys = [];
		const activities = [];
		let attempts = 0;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}),
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				keys.push(input.idempotencyKey);
				activities.push(input.activity);
				if (++attempts === 1) throw new Error("response lost");
				return {character: {id: "c", revision: 2, data: {hp: 9}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		const activity = {type: "spell.used", spellName: "Shield", spellSource: "PHB", spellLevel: 1, slotLevel: 1, mode: "spell_slot"};
		await expect(repository.pUpsert({character: {id: "c", hp: 9}, activity})).rejects.toThrow("response lost");
		await expect(repository.pUpsert({character: {id: "c", hp: 9}, activity})).resolves.toEqual({id: "c", hp: 9});
		expect(keys[1]).toBe(keys[0]);
		expect(activities).toEqual([activity, activity]);
	});

	it("replays a failed spell command before saving a newer snapshot", async () => {
		const requests = [];
		let attempts = 0;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}),
			pAcquireCharacterLease: async () => ({epoch: attempts + 1}),
			pPatchCharacter: async input => {
				requests.push(input);
				attempts++;
				if (attempts === 1) throw new Error("response lost");
				if (attempts === 2) return {character: {id: "c", revision: 2, data: {hp: 9}}};
				return {character: {id: "c", revision: 3, data: {hp: 8}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		const activity = {type: "spell.used", spellName: "Shield", spellSource: "PHB", spellLevel: 1, slotLevel: 1, mode: "spell_slot"};

		await expect(repository.pUpsert({character: {id: "c", hp: 9, _savedAt: 1}, activity})).rejects.toThrow("response lost");
		await expect(repository.pUpsert({character: {id: "c", hp: 8, _savedAt: 2}})).resolves.toEqual({id: "c", hp: 8});

		expect(requests).toHaveLength(3);
		expect(requests[1].idempotencyKey).toBe(requests[0].idempotencyKey);
		expect(requests[1].activity).toEqual(activity);
		expect(requests[2].idempotencyKey).not.toBe(requests[0].idempotencyKey);
		expect(requests[2].activity).toBeNull();
	});

	it("replays a failed spell command when the later save was queued before rejection", async () => {
		const requests = [];
		let rejectFirstPatch;
		let markFirstPatchStarted;
		const firstPatchStarted = new Promise(resolve => markFirstPatchStarted = resolve);
		const firstPatch = new Promise((resolve, reject) => rejectFirstPatch = reject);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}),
			pAcquireCharacterLease: async () => ({epoch: requests.length + 1}),
			pPatchCharacter: async input => {
				requests.push(structuredClone(input));
				if (requests.length === 1) {
					markFirstPatchStarted();
					return firstPatch;
				}
				if (requests.length === 2) return {character: {id: "c", revision: 2, data: {hp: 10}}};
				return {character: {id: "c", revision: 3, data: {hp: 10}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		const failedActivity = {type: "spell.used", spellName: "Fire Bolt", spellSource: "PHB", spellLevel: 0, slotLevel: 0, mode: "cantrip"};
		const laterActivity = {type: "spell.used", spellName: "Ray of Frost", spellSource: "PHB", spellLevel: 0, slotLevel: 0, mode: "cantrip"};

		const failed = repository.pUpsert({character: {id: "c", hp: 10}, activity: failedActivity});
		await firstPatchStarted;
		const later = repository.pUpsert({character: {id: "c", hp: 10}, activity: laterActivity});
		rejectFirstPatch(new Error("response lost"));

		const results = await Promise.allSettled([failed, later]);

		expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled"]);
		expect(requests).toHaveLength(3);
		expect(requests[1].idempotencyKey).toBe(requests[0].idempotencyKey);
		expect(requests[1].activity).toEqual(failedActivity);
		expect(requests[2].idempotencyKey).not.toBe(requests[0].idempotencyKey);
		expect(requests[2].activity).toEqual(laterActivity);
		expect(results[1].value).toEqual({id: "c", hp: 10});
		expect(repository._recoveryCommandQueues.size).toBe(0);
		expect(repository.hasPendingWrites()).toBe(false);
	});

	it("durably retains every command when the page reloads during a blocked replay", async () => {
		const storage = new MemoryStorage();
		const requests = [];
		let rejectFirstPatch;
		let markFirstPatchStarted;
		let rejectReplay;
		let markReplayStarted;
		const firstPatchStarted = new Promise(resolve => markFirstPatchStarted = resolve);
		const firstPatch = new Promise((resolve, reject) => rejectFirstPatch = reject);
		const replayStarted = new Promise(resolve => markReplayStarted = resolve);
		const replay = new Promise((resolve, reject) => rejectReplay = reject);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}),
			pAcquireCharacterLease: async () => ({epoch: requests.length + 1}),
			pPatchCharacter: async input => {
				requests.push(structuredClone(input));
				if (requests.length === 1) {
					markFirstPatchStarted();
					return firstPatch;
				}
				markReplayStarted();
				return replay;
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		repository._recoveryStorage = storage;
		await repository.pGet({characterId: "c"});
		const shield = makeSpellActivity("Shield", "spell_slot");
		const magicMissile = makeSpellActivity("Magic Missile", "spell_slot");

		const failed = repository.pUpsert({character: {id: "c", hp: 9}, activity: shield});
		await firstPatchStarted;
		const queued = repository.pUpsert({character: {id: "c", hp: 8}, activity: magicMissile});
		const settled = Promise.allSettled([failed, queued]);
		rejectFirstPatch(new Error("response lost"));
		await replayStarted;

		const stored = JSON.parse(storage.getItem("hub-character-recovery:cmp:c"));
		expect(stored.queueVersion).toBe(2);
		expect(stored.commands).toHaveLength(2);
		expect(stored.commands.map(command => command.activity)).toEqual([shield, magicMissile]);
		expect(stored.commands[0].commandKeys.patch).toBe(requests[0].idempotencyKey);
		expect(stored.commands[1].commandKeys.patch).not.toBe(requests[0].idempotencyKey);
		expect(stored).not.toHaveProperty("snapshot");
		expect(stored).not.toHaveProperty("activity");
		expect(stored).not.toHaveProperty("commandKeys");
		expect(stored.commands[0]).not.toHaveProperty("base");
		expect(stored.commands[0]).not.toHaveProperty("snapshot");

		const fresh = new HubHttpCharacterRepository({campaignId: "cmp", api});
		fresh._recoveryStorage = storage;
		expect(fresh.getPendingRecovery("c")).toEqual({hp: 8});
		expect(fresh._recoveryCommandQueues.get("c").map(command => command.submittedActivity)).toEqual([shield, magicMissile]);

		rejectReplay(new Error("still offline"));
		await settled;
	});

	it("loads the previous full-snapshot recovery queue format without dropping commands", () => {
		const storage = new MemoryStorage();
		const coverage = {
			base: {revision: 1, acceptedSequence: 10, appliedOperationLegIds: [], appliedOperationIds: []},
			snapshot: {revision: 1, acceptedSequence: 10, appliedOperationLegIds: [], appliedOperationIds: []},
		};
		storage.setItem("hub-character-recovery:cmp:c", JSON.stringify({
			version: 3,
			queueVersion: 1,
			commands: [
				{
					base: {hp: 10},
					snapshot: {hp: 9},
					activity: makeSpellActivity("Shield", "spell_slot"),
					commandKeys: {create: "create-1", patch: "patch-1"},
					state: "failed",
					coverageVersion: 2,
					coverage,
				},
				{
					base: {hp: 9},
					snapshot: {hp: 8},
					activity: makeSpellActivity("Magic Missile", "spell_slot"),
					commandKeys: {create: "create-2", patch: "patch-2"},
					state: "pending",
					coverageVersion: 2,
					coverage,
				},
			],
		}));
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api: {}});
		repository._recoveryStorage = storage;

		expect(repository.getPendingRecovery("c")).toEqual({hp: 8});
		expect(repository._recoveryCommandQueues.get("c").map(command => command.submittedSnapshot.hp)).toEqual([9, 8]);
	});

	it("replays every unresolved activity after a replay conflict is resolved with local state", async () => {
		const storage = new MemoryStorage();
		const requests = [];
		let getCount = 0;
		let rejectFirstPatch;
		let markFirstPatchStarted;
		const firstPatchStarted = new Promise(resolve => markFirstPatchStarted = resolve);
		const firstPatch = new Promise((resolve, reject) => rejectFirstPatch = reject);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ++getCount === 1
				? {id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}
				: {id: "c", campaignId: "cmp", revision: 2, data: {hp: 7}},
			pAcquireCharacterLease: async () => ({epoch: requests.length + 1}),
			pPatchCharacter: async input => {
				requests.push(structuredClone(input));
				if (requests.length === 1) {
					markFirstPatchStarted();
					return firstPatch;
				}
				if (requests.length === 2) throw Object.assign(new Error("conflict"), {code: "REVISION_CONFLICT"});
				if (requests.length === 3) return {character: {id: "c", revision: 3, data: {hp: 9}}};
				return {character: {id: "c", revision: 4, data: {hp: 8}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		repository._recoveryStorage = storage;
		await repository.pGet({characterId: "c"});
		const shield = makeSpellActivity("Shield", "spell_slot");
		const magicMissile = makeSpellActivity("Magic Missile", "spell_slot");

		const failed = repository.pUpsert({character: {id: "c", hp: 9}, activity: shield});
		await firstPatchStarted;
		const queued = repository.pUpsert({character: {id: "c", hp: 8}, activity: magicMissile});
		const results = Promise.allSettled([failed, queued]);
		rejectFirstPatch(new Error("response lost"));
		const [failedResult, queuedResult] = await results;
		expect(failedResult).toEqual(expect.objectContaining({status: "rejected", reason: expect.objectContaining({message: "response lost"})}));
		expect(queuedResult).toEqual(expect.objectContaining({status: "rejected", reason: expect.objectContaining({code: "CHARACTER_CONFLICT"})}));

		expect(repository.getConflictRecovery("c").local).toEqual({hp: 8});
		await expect(repository.pResolveConflict({characterId: "c", choice: "local"})).resolves.toEqual({id: "c", hp: 8});

		expect(requests).toHaveLength(4);
		expect(requests.map(request => request.activity)).toEqual([shield, shield, shield, magicMissile]);
		expect(requests[2].idempotencyKey).toBe(requests[0].idempotencyKey);
		expect(requests[3].idempotencyKey).not.toBe(requests[0].idempotencyKey);
		expect(repository.hasPendingWrites()).toBe(false);
		expect(storage.getItem("hub-character-recovery:cmp:c")).toBeNull();
	});

	it("explicitly discards every unresolved activity when a replay conflict is resolved with server state", async () => {
		const storage = new MemoryStorage();
		const requests = [];
		let getCount = 0;
		let rejectFirstPatch;
		let markFirstPatchStarted;
		const firstPatchStarted = new Promise(resolve => markFirstPatchStarted = resolve);
		const firstPatch = new Promise((resolve, reject) => rejectFirstPatch = reject);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ++getCount === 1
				? {id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}
				: {id: "c", campaignId: "cmp", revision: 2, data: {hp: 7}},
			pAcquireCharacterLease: async () => ({epoch: requests.length + 1}),
			pPatchCharacter: async input => {
				requests.push(structuredClone(input));
				if (requests.length === 1) {
					markFirstPatchStarted();
					return firstPatch;
				}
				throw Object.assign(new Error("conflict"), {code: "REVISION_CONFLICT"});
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		repository._recoveryStorage = storage;
		await repository.pGet({characterId: "c"});
		const shield = makeSpellActivity("Shield", "spell_slot");
		const magicMissile = makeSpellActivity("Magic Missile", "spell_slot");

		const failed = repository.pUpsert({character: {id: "c", hp: 9}, activity: shield});
		await firstPatchStarted;
		const queued = repository.pUpsert({character: {id: "c", hp: 8}, activity: magicMissile});
		const results = Promise.allSettled([failed, queued]);
		rejectFirstPatch(new Error("response lost"));
		const [failedResult, queuedResult] = await results;
		expect(failedResult).toEqual(expect.objectContaining({status: "rejected", reason: expect.objectContaining({message: "response lost"})}));
		expect(queuedResult).toEqual(expect.objectContaining({status: "rejected", reason: expect.objectContaining({code: "CHARACTER_CONFLICT"})}));

		await expect(repository.pResolveConflict({characterId: "c", choice: "server"})).resolves.toEqual({id: "c", hp: 7});

		expect(requests).toHaveLength(2);
		expect(repository._recoveryCommandQueues.has("c")).toBe(false);
		expect(repository.hasPendingWrites()).toBe(false);
		expect(storage.getItem("hub-character-recovery:cmp:c")).toBeNull();
	});

	it("rejects a semantic command when session recovery storage refuses the complete queue", async () => {
		const storage = new FailingStorage({failOnWrite: 2});
		const requests = [];
		let releaseFirst;
		let markFirstStarted;
		const firstStarted = new Promise(resolve => markFirstStarted = resolve);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}),
			pAcquireCharacterLease: async () => ({epoch: requests.length + 1}),
			pPatchCharacter: async input => {
				requests.push(structuredClone(input));
				if (requests.length === 1) {
					markFirstStarted();
					await new Promise(resolve => releaseFirst = resolve);
					return {character: {id: "c", revision: 2, data: {hp: 9}}};
				}
				return {character: {id: "c", revision: 3, data: {hp: 8}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		repository._recoveryStorage = storage;
		await repository.pGet({characterId: "c"});

		const first = repository.pUpsert({character: {id: "c", hp: 9}, activity: makeSpellActivity("Shield", "spell_slot")});
		await firstStarted;
		const rejected = repository.pUpsert({character: {id: "c", hp: 8}, activity: makeSpellActivity("Magic Missile", "spell_slot")});
		const rejectedAssertion = expect(rejected).rejects.toMatchObject({code: "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE"});
		releaseFirst();

		await expect(first).resolves.toEqual({id: "c", hp: 9});
		await rejectedAssertion;
		expect(requests).toHaveLength(1);
		expect(repository._recoveryCommandQueues.size).toBe(0);
	});

	it("rejects an ordinary cloud save when no reload-durable recovery storage is available", async () => {
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}),
			pPatchCharacter: jest.fn(),
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		repository._recoveryStorage = null;
		await repository.pGet({characterId: "c"});

		await expect(repository.pUpsert({character: {id: "c", hp: 9}}))
			.rejects.toMatchObject({code: "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE"});
		expect(api.pPatchCharacter).not.toHaveBeenCalled();
	});

	it("rejects a queued semantic command before its compact recovery payload exceeds the byte limit", async () => {
		const storage = new MemoryStorage();
		const requests = [];
		let releaseFirst;
		let markFirstStarted;
		const firstStarted = new Promise(resolve => markFirstStarted = resolve);
		const base = "a".repeat(1_450_000);
		const firstValue = "b".repeat(1_450_000);
		const secondValue = "c".repeat(1_450_000);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {notes: base}}),
			pAcquireCharacterLease: async () => ({epoch: requests.length + 1}),
			pPatchCharacter: async input => {
				requests.push(input);
				if (requests.length === 1) {
					markFirstStarted();
					await new Promise(resolve => releaseFirst = resolve);
					return {character: {id: "c", revision: 2, data: {notes: firstValue}}};
				}
				return {character: {id: "c", revision: 3, data: {notes: secondValue}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		repository._recoveryStorage = storage;
		await repository.pGet({characterId: "c"});

		const first = repository.pUpsert({character: {id: "c", notes: firstValue}, activity: makeSpellActivity("Shield", "spell_slot")});
		await firstStarted;
		const rejected = repository.pUpsert({character: {id: "c", notes: secondValue}, activity: makeSpellActivity("Magic Missile", "spell_slot")});
		const rejectedAssertion = expect(rejected).rejects.toMatchObject({code: "CHARACTER_RECOVERY_LIMIT"});
		await rejectedAssertion;
		const stored = storage.getItem("hub-character-recovery:cmp:c");
		expect(new TextEncoder().encode(stored).byteLength).toBeLessThanOrEqual(3_500_000);
		releaseFirst();

		await expect(first).resolves.toEqual({id: "c", notes: firstValue});
		expect(requests).toHaveLength(1);
	});

	it("rejects a semantic command before the recovery queue exceeds its command limit", async () => {
		const storage = new MemoryStorage();
		const requests = [];
		let releaseFirst;
		let markFirstStarted;
		const firstStarted = new Promise(resolve => markFirstStarted = resolve);
		let revision = 1;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {value: -1}}),
			pAcquireCharacterLease: async () => ({epoch: requests.length + 1}),
			pPatchCharacter: async input => {
				requests.push(input);
				const value = input.patches.find(patch => patch.path === "/value")?.value;
				if (requests.length === 1) {
					markFirstStarted();
					await new Promise(resolve => releaseFirst = resolve);
				}
				return {character: {id: "c", revision: ++revision, data: {value}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		repository._recoveryStorage = storage;
		await repository.pGet({characterId: "c"});

		const accepted = [repository.pUpsert({character: {id: "c", value: 0}, activity: makeSpellActivity("Spell 0")})];
		await firstStarted;
		for (let i = 1; i < 32; ++i) {
			accepted.push(repository.pUpsert({character: {id: "c", value: i}, activity: makeSpellActivity(`Spell ${i}`)}));
		}
		const rejected = repository.pUpsert({character: {id: "c", value: 32}, activity: makeSpellActivity("Spell 32")});
		const rejectedAssertion = expect(rejected).rejects.toMatchObject({code: "CHARACTER_RECOVERY_LIMIT"});
		releaseFirst();

		await rejectedAssertion;
		await expect(Promise.all(accepted)).resolves.toHaveLength(32);
		expect(requests).toHaveLength(32);
	});

	it("retains the earlier failed spell command when its queued replay also fails", async () => {
		const requests = [];
		let rejectFirstPatch;
		let markFirstPatchStarted;
		const firstPatchStarted = new Promise(resolve => markFirstPatchStarted = resolve);
		const firstPatch = new Promise((resolve, reject) => rejectFirstPatch = reject);
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}),
			pAcquireCharacterLease: async () => ({epoch: requests.length + 1}),
			pPatchCharacter: async input => {
				requests.push(structuredClone(input));
				if (requests.length === 1) {
					markFirstPatchStarted();
					return firstPatch;
				}
				throw new Error("retry also failed");
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		const failedActivity = {type: "spell.used", spellName: "Fire Bolt", spellSource: "PHB", spellLevel: 0, slotLevel: 0, mode: "cantrip"};
		const laterActivity = {type: "spell.used", spellName: "Ray of Frost", spellSource: "PHB", spellLevel: 0, slotLevel: 0, mode: "cantrip"};

		const failed = repository.pUpsert({character: {id: "c", hp: 10}, activity: failedActivity});
		await firstPatchStarted;
		const later = repository.pUpsert({character: {id: "c", hp: 10}, activity: laterActivity});
		rejectFirstPatch(new Error("response lost"));

		const results = await Promise.allSettled([failed, later]);

		expect(results.map(result => result.status)).toEqual(["rejected", "rejected"]);
		expect(requests).toHaveLength(2);
		expect(requests[1].idempotencyKey).toBe(requests[0].idempotencyKey);
		expect(repository._recoveryCommandQueues.get("c")?.[0]).toEqual(expect.objectContaining({
			submittedActivity: failedActivity,
			commandKeys: expect.objectContaining({patch: requests[0].idempotencyKey}),
		}));
		expect(repository.hasPendingWrites()).toBe(true);
	});
});
