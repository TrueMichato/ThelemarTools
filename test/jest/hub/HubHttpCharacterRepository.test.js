import {HubHttpCharacterRepository} from "../../../js/hub/hub-http-character-repository.js";

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

	it("keeps campaign characters read-only while signed out", async () => {
		const repository = new HubHttpCharacterRepository({
			campaignId: "campaign-1",
			api: {pGetSession: async () => ({signedIn: false})},
		});

		await expect(repository.pList()).rejects.toThrow("Sign in to edit campaign characters");
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
		let attempts = 0;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ({id: "c", campaignId: "cmp", revision: 1, data: {hp: 10}}),
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				keys.push(input.idempotencyKey);
				if (++attempts === 1) throw new Error("response lost");
				return {character: {id: "c", revision: 2, data: {hp: 9}}};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "cmp", api});
		await repository.pGet({characterId: "c"});
		await expect(repository.pUpsert({character: {id: "c", hp: 9}})).rejects.toThrow("response lost");
		await expect(repository.pUpsert({character: {id: "c", hp: 9}})).resolves.toEqual({id: "c", hp: 9});
		expect(keys[1]).toBe(keys[0]);
	});
});
