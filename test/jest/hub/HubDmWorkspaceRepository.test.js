import {
	HubDmWorkspaceMemoryAuthority,
	HubDmWorkspaceRepository,
	LocalDmWorkspaceRepository,
} from "../../../js/hub/hub-dm-workspace-repository.js";

const getBoardState = name => ({
	mv: 3,
	w: 4,
	h: 3,
	sla: "1",
	sls: {"1": {n: name, ps: [], ex: []}},
});

describe("local DM workspace repository", () => {
	it("uses only the existing DM screen storage key", async () => {
		const data = new Map([["other-setting", {keep: true}]]);
		const calls = [];
		const storage = {
			async pGet (key) { calls.push(["get", key]); return data.get(key); },
			async pSet (key, value) { calls.push(["set", key]); data.set(key, structuredClone(value)); },
			async pRemove (key) { calls.push(["remove", key]); data.delete(key); },
		};
		const repository = new LocalDmWorkspaceRepository({storage, storageKey: "DMSCREEN_STORAGE"});
		const state = getBoardState("Local");

		await repository.pSet(state);
		expect(await repository.pGet()).toEqual(state);
		await repository.pRemove();

		expect(data.get("other-setting")).toEqual({keep: true});
		expect(new Set(calls.map(([, key]) => key))).toEqual(new Set(["DMSCREEN_STORAGE"]));
	});
});

describe("private cloud DM workspaces", () => {
	let authority;
	let now;

	beforeEach(() => {
		now = 1_000;
		authority = new HubDmWorkspaceMemoryAuthority({fnNow: () => now, leaseTtlMs: 100});
		authority.createWorkspace({
			workspaceId: "workspace-a",
			campaignId: "campaign-1",
			ownerMembershipId: "dm-membership-a",
			state: getBoardState("DM A"),
			mutationId: "create-a",
		});
		authority.createWorkspace({
			workspaceId: "workspace-b",
			campaignId: "campaign-1",
			ownerMembershipId: "dm-membership-b",
			state: getBoardState("DM B"),
			mutationId: "create-b",
		});
	});

	it("does not expose one DM's board to another membership", () => {
		expect(() => authority.getWorkspace({
			workspaceId: "workspace-a",
			membershipId: "dm-membership-b",
		})).toThrow(expect.objectContaining({code: "FORBIDDEN"}));
	});

	it("round-trips the existing Board blob without reshaping it", async () => {
		const repository = new HubDmWorkspaceRepository({
			authority,
			workspaceId: "workspace-a",
			membershipId: "dm-membership-a",
			sessionId: "device-a",
		});
		expect(await repository.pGet()).toEqual(getBoardState("DM A"));
		const nxt = getBoardState("Edited");
		expect(await repository.pSet(nxt)).toEqual(nxt);
	});

	it("makes workspace creation retries idempotent", () => {
		const input = {
			workspaceId: "workspace-c",
			campaignId: "campaign-1",
			ownerMembershipId: "dm-membership-a",
			state: getBoardState("DM C"),
			mutationId: "create-c",
		};
		const first = authority.createWorkspace(input);
		expect(authority.createWorkspace(input)).toEqual(first);
	});

	it("fences an old board editor after takeover", async () => {
		const oldRepository = new HubDmWorkspaceRepository({
			authority,
			workspaceId: "workspace-a",
			membershipId: "dm-membership-a",
			sessionId: "device-a",
		});
		const newRepository = new HubDmWorkspaceRepository({
			authority,
			workspaceId: "workspace-a",
			membershipId: "dm-membership-a",
			sessionId: "device-b",
		});
		await oldRepository.pGet();
		await oldRepository.pAcquireLease();
		await newRepository.pGet();
		await newRepository.pAcquireLease({isTakeover: true});

		await expect(oldRepository.pSet(getBoardState("Stale"), {mutationId: "stale-save"}))
			.rejects.toEqual(expect.objectContaining({code: "LEASE_FENCED"}));
	});

	it("renews or safely reacquires an expired workspace lease", async () => {
		const repository = new HubDmWorkspaceRepository({
			authority,
			workspaceId: "workspace-a",
			membershipId: "dm-membership-a",
			sessionId: "device-a",
		});
		await repository.pGet();
		await repository.pAcquireLease();
		now += 101;

		await expect(repository.pSet(getBoardState("After expiry"))).resolves.toEqual(getBoardState("After expiry"));
	});

	it("serializes concurrent workspace saves in invocation order", async () => {
		const repository = new HubDmWorkspaceRepository({
			authority,
			workspaceId: "workspace-a",
			membershipId: "dm-membership-a",
			sessionId: "device-a",
		});
		await repository.pGet();

		await Promise.all([
			repository.pSet(getBoardState("First")),
			repository.pSet(getBoardState("Second")),
		]);

		expect(await repository.pGet()).toEqual(getBoardState("Second"));
	});

	it("does not reuse mutation IDs after a repository is recreated", async () => {
		const first = new HubDmWorkspaceRepository({
			authority,
			workspaceId: "workspace-a",
			membershipId: "dm-membership-a",
			sessionId: "device-a",
		});
		await first.pGet();
		await first.pSet(getBoardState("First"));

		const second = new HubDmWorkspaceRepository({
			authority,
			workspaceId: "workspace-a",
			membershipId: "dm-membership-a",
			sessionId: "device-a",
		});
		await second.pGet();
		await second.pSet(getBoardState("Second"));

		expect(await second.pGet()).toEqual(getBoardState("Second"));
	});
});
