import {expect, test} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

/**
 * ADR 0011 evidence against the real stack: an owner narrows what the table sees from
 * the Character Sheet, peers observe exactly the narrowed result, and a stale write from
 * a second device is refused without losing the owner's choices.
 */
test("character sharing policy narrows peer projections and survives a stale write", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const ownerContext = await browser.newContext(contextOptions);
	const peerContext = await browser.newContext(contextOptions);
	const secondDeviceContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const owner = new HubCampaignPage(await ownerContext.newPage());
		const peer = new HubCampaignPage(await peerContext.newPage());
		const secondDevice = new HubCampaignPage(await secondDeviceContext.newPage());

		await dm.signInSynthetic({providerSubject: "sharing-dm", displayName: "Sharing DM", secret});
		await owner.signInSynthetic({providerSubject: "sharing-owner", displayName: "Sharing Owner", secret});
		await peer.signInSynthetic({providerSubject: "sharing-peer", displayName: "Sharing Peer", secret});
		await secondDevice.signInSynthetic({providerSubject: "sharing-owner", displayName: "Sharing Owner", secret});

		const campaignId = await dm.createCampaign("Sharing Policy E2E");
		for (const member of [owner, peer]) {
			await member.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		}
		const character = await owner.createCharacter({campaignId, name: "Mira"});

		// The default `table` preset shares identity and HP with peers.
		const initial = await peer.getCharacterProjection(character.id);
		expect(initial.kind).toBe("peer_profile");
		expect(initial.data.identity.name).toBe("Mira");
		expect(initial.data.hp).toBeDefined();
		expect(JSON.stringify(initial)).not.toContain("ownerAccountId");

		// The DM sees truth beside the exact preview a peer receives.
		const dmView = await dm.getCharacterProjection(character.id);
		expect(dmView.kind).toBe("dm_truth");
		expect(dmView.peerPreview).toEqual(initial);

		const base = await owner.getProjectionPolicy(character.id);
		expect(base.preview).toEqual(initial);

		await owner.setProjectionPolicy({
			characterId: character.id,
			expectedProjectionRevision: base.projectionRevision,
			policy: {version: 1, preset: "minimal", overrides: {hp: {mode: "replace", value: {state: "steady"}}}},
		});

		// The peer's next scoped fetch replaces the previous broader projection.
		const narrowed = await peer.getCharacterProjection(character.id);
		expect(narrowed.data.hp).toEqual({state: "steady"});
		expect(narrowed.data.abilities).toBeUndefined();
		expect(narrowed.data.conditions).toBeUndefined();
		expect(narrowed.projectionRevision).toBe(base.projectionRevision + 1);

		// A second device still holding the old revision is refused, and is told the
		// current safe state rather than silently overwriting the newer policy.
		const stale = await secondDevice.setProjectionPolicyRaw({
			characterId: character.id,
			expectedProjectionRevision: base.projectionRevision,
			policy: {version: 1, preset: "open", overrides: {}},
		});
		expect(stale.status).toBe(409);
		expect(stale.body.error).toBe("PROJECTION_POLICY_CONFLICT");
		expect(stale.body.details.policy.preset).toBe("minimal");

		const afterStale = await owner.getProjectionPolicy(character.id);
		expect(afterStale.policy.preset).toBe("minimal");
		expect(afterStale.projectionRevision).toBe(base.projectionRevision + 1);

		// The owner's sharing controls render on the Character Sheet against the server
		// preview, with no raw policy JSON on screen.
		await owner.openCharacterSheet({campaignId, characterId: character.id, name: "Mira"});
		await owner.expectSharingControls({previewText: "steady"});

		// Drive the real controls and the real Save button. A direct API helper attaches
		// its own mutation headers, so it cannot catch a client that omits CSRF or an
		// idempotency key — only a genuine click does.
		// `minimal` hid the ability scores; saving `table` from the UI must bring them back.
		await owner.changeSharingPresetAndSave({preset: "table", expectPreviewText: "Ability scores"});
		const afterUiSave = await peer.getCharacterProjection(character.id);
		expect(afterUiSave.data.abilities).toBeDefined();
		expect(afterUiSave.data.skills).toBeDefined();
		// The per-field override set earlier survives a preset change.
		expect(afterUiSave.data.hp).toEqual({state: "steady"});

		// "Show instead" submits the generated typed controls, including the checkbox and
		// select defaults an owner never touches.
		await owner.replaceSharedFieldAndSave({field: "saves", expectPreviewText: "Saving throws"});
		const afterReplace = await peer.getCharacterProjection(character.id);
		expect(Object.keys(afterReplace.data.saves)).toEqual(["str", "dex", "con", "int", "wis", "cha"]);
		for (const save of Object.values<any>(afterReplace.data.saves)) {
			expect(typeof save.proficient).toBe("boolean");
			expect(Number.isInteger(save.modifier)).toBe(true);
		}
	} finally {
		await Promise.all([dmContext.close(), ownerContext.close(), peerContext.close(), secondDeviceContext.close()]);
	}
});
