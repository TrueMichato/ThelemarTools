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
		expect(stored.commands).toHaveLength(2);
		expect(stored.commands.map(command => command.activity)).toEqual([shield, magicMissile]);
		expect(stored.commands[0].commandKeys.patch).toBe(requests[0].idempotencyKey);
		expect(stored.commands[1].commandKeys.patch).not.toBe(requests[0].idempotencyKey);

		const fresh = new HubHttpCharacterRepository({campaignId: "cmp", api});
		fresh._recoveryStorage = storage;
		expect(fresh.getPendingRecovery("c")).toEqual({hp: 8});
		expect(fresh._recoveryCommandQueues.get("c").map(command => command.submittedActivity)).toEqual([shield, magicMissile]);

		rejectReplay(new Error("still offline"));
		await settled;
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
