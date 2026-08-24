import {HubHttpDmWorkspaceRepository} from "../../../js/hub/hub-http-dm-workspace-repository.js";

describe("HTTP DM workspace repository", () => {
	it("loads, leases, and saves the existing Board blob", async () => {
		const calls = [];
		const api = {
			pGetSession: async () => ({signedIn: true, account: {id: "dm"}}),
			pGetDmWorkspace: async () => ({
				id: "workspace-1",
				revision: 3,
				state: {mv: 1, sls: {"1": {ps: [], ex: []}}},
			}),
			pAcquireDmWorkspaceLease: async () => ({epoch: 4}),
			pWriteDmWorkspace: async input => {
				calls.push(input);
				return {workspace: {id: "workspace-1", revision: 4, state: input.state}};
			},
		};
		const repository = new HubHttpDmWorkspaceRepository({campaignId: "campaign-1", api});
		await expect(repository.pGet()).resolves.toEqual({mv: 1, sls: {"1": {ps: [], ex: []}}});
		await repository.pSet({mv: 1, sls: {"1": {ps: [{id: 1}], ex: []}}});
		expect(calls).toEqual([
			expect.objectContaining({
				campaignId: "campaign-1",
				workspaceId: "workspace-1",
				baseRevision: 3,
				leaseEpoch: 4,
			}),
		]);
	});

	it("keeps a cached workspace read-only while signed out", async () => {
		const repository = new HubHttpDmWorkspaceRepository({
			campaignId: "campaign-1",
			api: {pGetSession: async () => ({signedIn: false})},
		});
		await expect(repository.pGet()).rejects.toThrow("Sign in to open a campaign DM workspace");
	});

	it("captures local and server state on revision conflict and requires explicit resolution", async () => {
		let getCount = 0;
		const api = {
			pGetSession: async () => ({signedIn: true, account: {id: "dm"}}),
			pGetDmWorkspace: async () => ++getCount === 1
				? {id: "w", revision: 1, state: {name: "base"}}
				: {id: "w", revision: 2, state: {name: "server"}},
			pAcquireDmWorkspaceLease: async () => ({epoch: 1}),
			pWriteDmWorkspace: async () => {
				const error = new Error("conflict");
				error.code = "REVISION_CONFLICT";
				throw error;
			},
		};
		const repository = new HubHttpDmWorkspaceRepository({campaignId: "cmp", api});
		await repository.pGet();
		await expect(repository.pSet({name: "local"})).rejects.toEqual(expect.objectContaining({code: "WORKSPACE_CONFLICT"}));
		expect(repository.getConflictRecovery()).toEqual({
			local: {name: "local"},
			server: {name: "server"},
			serverRevision: 2,
		});
		await expect(repository.pResolveConflict({choice: "server"})).resolves.toEqual({name: "server"});
		expect(repository.hasPendingWrites()).toBe(false);
	});

	it("folds a newer queued workspace draft into conflict recovery", async () => {
		let doRelease;
		let doNotifyStarted;
		const pStarted = new Promise(resolve => doNotifyStarted = resolve);
		let gets = 0;
		const api = {
			pGetSession: async () => ({signedIn: true, account: {id: "dm"}}),
			pGetDmWorkspace: async () => ++gets === 1 ? {id: "w", revision: 1, state: {v: 1}} : {id: "w", revision: 2, state: {v: 2}},
			pAcquireDmWorkspaceLease: async () => ({epoch: 1}),
			pWriteDmWorkspace: async () => {
				doNotifyStarted();
				await new Promise(resolve => doRelease = resolve);
				const error = new Error("conflict");
				error.code = "REVISION_CONFLICT";
				throw error;
			},
		};
		const repository = new HubHttpDmWorkspaceRepository({campaignId: "cmp", api});
		await repository.pGet();
		const first = repository.pSet({v: "local-1"});
		await pStarted;
		const second = repository.pSet({v: "local-2"});
		doRelease();
		await expect(first).rejects.toEqual(expect.objectContaining({code: "WORKSPACE_CONFLICT"}));
		await expect(second).rejects.toEqual(expect.objectContaining({code: "WORKSPACE_CONFLICT"}));
		expect(repository.getConflictRecovery().local).toEqual({v: "local-2"});
	});

	it("forces recovery when a stored draft was based on an older server revision", async () => {
		const storage = {
			getItem: () => JSON.stringify({baseRevision: 1, baseState: {v: 1}, state: {v: "local"}}),
			setItem () {},
			removeItem () {},
		};
		const repository = new HubHttpDmWorkspaceRepository({
			campaignId: "cmp",
			api: {
				pGetSession: async () => ({signedIn: true, account: {id: "dm"}}),
				pGetDmWorkspace: async () => ({id: "w", revision: 2, state: {v: "server"}}),
			},
		});
		repository._recoveryStorage = storage;
		await expect(repository.pGet()).resolves.toEqual({v: "local"});
		expect(repository.getConflictRecovery()).toEqual({
			local: {v: "local"},
			server: {v: "server"},
			serverRevision: 2,
		});
	});

	it("reuses the exact command key after a lost response", async () => {
		const keys = [];
		let attempts = 0;
		const api = {
			pGetSession: async () => ({signedIn: true, account: {id: "dm"}}),
			pGetDmWorkspace: async () => ({id: "w", revision: 1, state: {v: 1}}),
			pAcquireDmWorkspaceLease: async () => ({epoch: 1}),
			pWriteDmWorkspace: async input => {
				keys.push(input.idempotencyKey);
				if (++attempts === 1) throw new Error("response lost");
				return {workspace: {id: "w", revision: 2, state: input.state}};
			},
		};
		const repository = new HubHttpDmWorkspaceRepository({campaignId: "cmp", api});
		await repository.pGet();
		await expect(repository.pSet({v: 2})).rejects.toThrow("response lost");
		await expect(repository.pSet({v: 2})).resolves.toEqual({v: 2});
		expect(keys[1]).toBe(keys[0]);
	});
});
