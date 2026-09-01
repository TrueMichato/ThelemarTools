import {
	getRollPresentation,
	normalizeHubEvent,
	sanitizeCharacterDisplayName,
} from "../../../js/hub/hub-event-presentation.js";
import {
	createCharacterDisplayNameSnapshot,
	enrichEventPayload,
} from "../../../server/src/hub-event-snapshots.js";
import {renderHubActivityRows} from "../../../js/hub/hub-activity-render.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {jest} from "@jest/globals";
import fs from "node:fs";

describe("campaign activity event presentation", () => {
	it("keeps lifecycle snapshots durable across archive, move, detach, and public deletion", async () => {
		const store = new MemoryHubStore();
		const owner = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "activity-owner", displayName: "Owner"});
		const player = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "activity-player", displayName: "Player"});
		const deleter = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "activity-deleter", displayName: "Deleter"});
		const campaign = (await store.pCreateCampaign({
			accountId: owner.id,
			name: "Activity",
			idempotencyKey: "activity-campaign",
		})).campaign;
		const destination = (await store.pCreateCampaign({
			accountId: owner.id,
			name: "Destination",
			idempotencyKey: "activity-destination",
		})).campaign;
		const join = async (account, campaignId, key) => {
			const tokenHash = `${key}-token`;
			await store.pCreateInvite({
				accountId: owner.id,
				campaignId,
				role: "player",
				tokenHash,
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
				idempotencyKey: `${key}-invite`,
			});
			await store.pRedeemInvite({accountId: account.id, tokenHash, idempotencyKey: `${key}-redeem`});
		};
		await join(player, campaign.id, "player-campaign");
		await join(player, destination.id, "player-destination");
		await join(deleter, campaign.id, "deleter-campaign");
		const source = (await store.pCreateCharacter({
			accountId: owner.id,
			campaignId: campaign.id,
			data: {name: "Source", inventory: [], currency: {gp: 100}},
			schemaVersion: 1,
			clientImportId: "activity-source",
			idempotencyKey: "activity-source",
		})).character;
		const createTarget = async (account, name, key) => (await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {name},
			schemaVersion: 1,
			clientImportId: key,
			idempotencyKey: key,
		})).character;
		const archiveTarget = await createTarget(player, "Before Rename", "activity-archive-target");
		const archiveLease = await store.pAcquireCharacterLease({accountId: player.id, sessionId: "activity-session", characterId: archiveTarget.id});
		await store.pPatchCharacter({
			accountId: player.id,
			sessionId: "activity-session",
			characterId: archiveTarget.id,
			baseRevision: archiveTarget.revision,
			leaseEpoch: archiveLease.epoch,
			patches: [{op: "replace", path: "/name", value: "After Rename"}],
			idempotencyKey: "activity-rename",
		});
		const moveTarget = await createTarget(player, "Move Target", "activity-move-target");
		const detachTarget = await createTarget(player, "Detach Target", "activity-detach-target");
		const deleteTarget = await createTarget(deleter, "Delete Target", "activity-delete-target");
		const propose = (target, key) => store.pProposeTransfer({
			accountId: owner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: target.id,
			payload: {currency: {gp: 1}},
			idempotencyKey: key,
		});
		await propose(archiveTarget, "activity-transfer-archive");
		await propose(moveTarget, "activity-transfer-move");
		await propose(detachTarget, "activity-transfer-detach");
		await propose(deleteTarget, "activity-transfer-delete");
		await store.pArchiveCharacter({accountId: player.id, characterId: archiveTarget.id, idempotencyKey: "activity-archive"});
		await store.pMoveCharacter({accountId: player.id, characterId: moveTarget.id, campaignId: destination.id, idempotencyKey: "activity-move"});
		const playerMembership = await store.pGetMembership({accountId: player.id, campaignId: campaign.id});
		await store.pRemoveMember({accountId: owner.id, campaignId: campaign.id, membershipId: playerMembership.id, idempotencyKey: "activity-detach"});
		await store.pRequestAccountDeletion({accountId: deleter.id, idempotencyKey: "activity-delete-request", graceMs: 0});
		await new Promise(resolve => setTimeout(resolve, 5));
		await store.pPurgeDueAccounts();
		const events = await store.pListVisibleEvents({accountId: owner.id, campaignId: campaign.id});
		const cancellations = events.filter(event => event.type === "transfer.cancelled");
		expect(cancellations).toHaveLength(4);
		for (const event of cancellations) {
			// The correlating ids remain durable so lifecycle cleanup stays auditable...
			expect(event.payload).toEqual(expect.objectContaining({
				sourceKind: "character",
				sourceId: source.id,
				targetKind: "character",
				targetId: expect.any(String),
			}));
			// ...but a shared row carries no canonical name, because a durable event cannot
			// be retracted when its owner later narrows their sharing policy.
			expect(event.payload.sourceCharacterNameSnapshot).toBeUndefined();
			expect(event.payload.targetCharacterNameSnapshot).toBeUndefined();
		}

		const archived = events.find(event => event.type === "character.archived");
		const movedOut = events.filter(event => event.type === "character.moved_out");
		expect(archived.payload.characterNameSnapshot).toBeUndefined();
		expect(movedOut.every(event => event.payload.characterNameSnapshot === undefined)).toBe(true);
		// Names that only ever existed in the canonical document never reach a shared row.
		const sharedText = JSON.stringify(events.filter(event => event.visibility === "all_members"));
		for (const name of ["After Rename", "Before Rename", "Move Target", "Delete Target", "Source"]) {
			expect({name, leaked: sharedText.includes(name)}).toEqual({name, leaked: false});
		}
		// The lifecycle records themselves remain durable and correlatable.
		expect(movedOut.map(event => event.aggregateId)).toEqual(expect.arrayContaining([moveTarget.id, deleteTarget.id]));
		expect(store.getDomainEvents().some(event => event.aggregateId === deleteTarget.id && event.type === "character.moved_out")).toBe(true);
	});

	it("creates bounded, versioned, inert character snapshots", () => {
		const snapshot = createCharacterDisplayNameSnapshot(`<img src=x onerror=alert(1)> ${"x".repeat(200)}`);
		expect(snapshot.version).toBe(1);
		expect(snapshot.displayName).not.toContain("<");
		expect(snapshot.displayName.length).toBeLessThanOrEqual(80);
		expect(sanitizeCharacterDisplayName("  Captain\n  O\u0000'Neil ")).toBe("Captain O 'Neil");
	});

	it("prefers semantic roll titles and only exposes useful detail", () => {
		const presentation = getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "character",
				aggregateId: "character-id",
				payload: {
					formula: "1d20+5",
					total: 24,
					detail: {
						title: " Longsword attack ",
						breakdown: ["1d20: 19", "bonus: 5"],
						advantage: true,
						resultClass: "charsheet__dice-result-total--crit",
						resultNote: "Critical Hit!",
						spell: "Booming Blade",
						target: "Goblin",
						raw: "{\"secret\":\"no\"}",
					},
				},
			},
			characters: [{id: "character-id", data: {name: "Arannis"}}],
		});
		expect(presentation.title).toBe("Longsword attack");
		expect(presentation.details).toEqual([
			"Breakdown: 1d20: 19, bonus: 5",
			"Advantage",
			"Critical",
			"Result: 24",
			"Spell: Booming Blade",
			"Target: Goblin",
		]);
		expect(presentation.details.join(" ")).not.toContain("secret");
	});

	it("does not infer critical or fumble states from ordinary failure text", () => {
		const ordinary = getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "campaign",
				payload: {detail: {resultNote: "Failure", resultClass: "text-danger"}},
			},
			characters: [],
		});
		expect(ordinary.details).not.toContain("Critical");
		expect(ordinary.details).not.toContain("Fumble");
		expect(getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "character",
				payload: {detail: {resultClass: "charsheet__dice-result-total--crit"}},
			},
			characters: [],
		}).details).toContain("Critical");
		expect(getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "character",
				payload: {detail: {
					resultClass: "charsheet__dice-result-total--fumble",
					resultNote: "Critical Miss!",
				}},
			},
			characters: [],
		}).details).toContain("Fumble");
		expect(getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "character",
				payload: {detail: {
					resultClass: "charsheet__dice-result-total--fumble",
					resultNote: "Failure — attack the nearest creature.",
				}},
			},
			characters: [],
		}).details).not.toContain("Fumble");
		expect(getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "character",
				payload: {detail: {resultNote: "Natural 1! (-5 Thelemar)"}},
			},
			characters: [],
		}).details).toContain("Fumble");
		const conflicting = getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "campaign",
				payload: {
					detail: {
						resultClass: "charsheet__dice-result-total--crit charsheet__dice-result-total--fumble",
						resultNote: "Natural 1! (-5 Thelemar)",
					},
				},
			},
			characters: [],
		});
		expect(conflicting.details).toContain("Fumble");
		expect(conflicting.details).not.toContain("Critical");
	});

	it("renders only finite numeric roll totals", () => {
		const totals = [null, true, false, "", "   ", [], {}, Infinity, "not-a-number"];
		for (const total of totals) {
			expect(getRollPresentation({
				event: {type: "roll.logged", aggregateType: "campaign", payload: {total, detail: {title: "Check"}}},
				characters: [],
			}).details).not.toContain(expect.stringMatching(/^Result:/));
		}
		for (const total of [0, 12, "12", "-2.5"]) {
			expect(getRollPresentation({
				event: {type: "roll.logged", aggregateType: "campaign", payload: {total, detail: {title: "Check"}}},
				characters: [],
			}).details).toContain(`Result: ${Number(total)}`);
		}
	});

	it("bounds malformed breakdown arrays and all detail text", () => {
		const presentation = getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "campaign",
				payload: {detail: {breakdown: Array.from({length: 1_000}, (_, i) => `${i}-${"x".repeat(200)}`)}},
			},
			characters: [],
		});
		const breakdown = presentation.details.find(detail => detail.startsWith("Breakdown: "));
		expect(breakdown.length).toBeLessThanOrEqual(11 + 160);
		expect(breakdown).not.toContain("999-");
		expect(getRollPresentation({
			event: {type: "roll.logged", aggregateType: "campaign", payload: {detail: {breakdown: [null, {}, 42]}}},
			characters: [],
		}).details).toEqual([]);
		expect(getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "campaign",
				payload: {detail: {target: {id: "private-character-id", name: "Goblin"}}},
			},
			characters: [],
		}).details).toEqual([]);
		let deeplyNested = "private-character-id";
		for (let i = 0; i < 20_000; ++i) deeplyNested = [deeplyNested];
		expect(getRollPresentation({
			event: {
				type: "roll.logged",
				aggregateType: "campaign",
				payload: {detail: {breakdown: deeplyNested}},
			},
			characters: [],
		}).details).toEqual([]);
	});

	it("uses snapshots before authorized current roster data and safe fallbacks", () => {
		const event = {
			type: "character.archived",
			aggregateType: "character",
			aggregateId: "gone",
			actorAccountId: "account",
			payload: {characterNameSnapshot: {version: 1, displayName: "Old Hero"}},
		};
		expect(normalizeHubEvent({event, characters: [], actorDisplayName: "Account"}).title).toBe("Old Hero was archived.");
		expect(normalizeHubEvent({
			event: {...event, payload: {}},
			characters: [],
			actorDisplayName: "Account",
		}).title).toBe("A character was archived.");
	});

	it("never treats a DM actor as the missing character subject", () => {
		const normalized = normalizeHubEvent({
			event: {type: "xp.granted", aggregateType: "character", aggregateId: "missing", actorAccountId: "dm", payload: {}},
			characters: [],
			members: [{accountId: "dm", displayName: "Dungeon Master"}],
			actorDisplayName: "Dungeon Master",
		});
		expect(normalized.title).toBe("A character received XP.");
		expect(normalized.title).not.toContain("Dungeon Master");
	});

	it("keeps role and membership authorization boundaries intact for event reads", async () => {
		const store = new MemoryHubStore();
		store._campaigns.set("campaign", {id: "campaign", status: "active"});
		for (const [accountId, role, status = "active"] of [
			["dm", "dm"],
			["player", "player"],
			["spectator", "spectator"],
			["revoked", "player", "removed"],
		]) {
			store._memberships.set(`campaign::${accountId}`, {campaignId: "campaign", accountId, role, status});
		}
		store._appendEvent({
			campaignId: "campaign",
			actorAccountId: "dm",
			type: "invite.created",
			aggregateType: "invite",
			aggregateId: "invite-id",
			visibility: "dm_only",
		});
		store._appendEvent({
			campaignId: "campaign",
			actorAccountId: "dm",
			type: "character.archived",
			aggregateType: "character",
			aggregateId: "character-id",
			visibility: "explicit_accounts",
			visibleAccountIds: ["player"],
			payload: {characterNameSnapshot: {version: 1, displayName: "Private Hero"}},
		});
		expect((await store.pListVisibleEvents({accountId: "dm", campaignId: "campaign"})).length).toBe(2);
		expect((await store.pListVisibleEvents({accountId: "player", campaignId: "campaign"})).map(event => event.type)).toEqual(["character.archived"]);
		expect((await store.pListVisibleEvents({accountId: "spectator", campaignId: "campaign"})).length).toBe(0);
		await expect(store.pListVisibleEvents({accountId: "revoked", campaignId: "campaign"})).rejects.toMatchObject({code: "CAMPAIGN_NOT_FOUND"});
	});

	it("renders character subjects for rolls and both transfer endpoints without IDs", () => {
		const roll = normalizeHubEvent({
			event: {
				type: "roll.logged",
				aggregateType: "character",
				aggregateId: "character-id",
				payload: {detail: {title: "Stealth"}, characterNameSnapshot: {version: 1, displayName: "Nyx"}},
			},
			characters: [],
		});
		const transfer = normalizeHubEvent({
			event: {
				type: "transfer.reserved",
				aggregateType: "transfer",
				aggregateId: "transfer-id",
				payload: {
					sourceKind: "character",
					sourceId: "source-id",
					sourceCharacterNameSnapshot: {version: 1, displayName: "Nyx"},
					targetKind: "character",
					targetId: "target-id",
					targetCharacterNameSnapshot: {version: 1, displayName: "Rook"},
				},
			},
			characters: [],
		});
		expect(roll.subject).toBe("Nyx");
		expect(transfer.title).toBe("Nyx offered a transfer to Rook.");
		expect(transfer.title).not.toMatch(/source-id|target-id|transfer-id/);
	});

	it("keeps character effects subject-first and neutral cancellations grammatical", () => {
		const proposed = normalizeHubEvent({
			event: {
				type: "action.proposed",
				aggregateType: "pending_action",
				aggregateId: "action-id",
				actorAccountId: "account-id",
				payload: {
					targetCharacterId: "target-id",
					targetCharacterNameSnapshot: {version: 1, displayName: "Rook"},
				},
			},
			characters: [],
			members: [{accountId: "account-id", displayName: "Wizard"}],
		});
		expect(proposed.title).toBe("Rook was offered an effect by Wizard.");
		expect(normalizeHubEvent({
			event: {type: "transfer.cancelled", aggregateType: "transfer", aggregateId: "transfer-id", payload: {}},
			characters: [],
		}).title).toBe("A transfer was cancelled.");
	});

	it("preserves bounded non-roll facts and legacy transfer actors", () => {
		const members = [
			{accountId: "dm", displayName: "Morgan"},
			{accountId: "player", displayName: "Rook"},
		];
		const normalize = (type, payload, aggregateType = "campaign") => normalizeHubEvent({
			event: {type, aggregateType, aggregateId: "character", actorAccountId: "dm", payload},
			characters: [{id: "character", data: {name: "Nyx"}}],
			members,
		});
		expect(normalize("campaign.ownership_transferred", {targetAccountId: "player"}).details).toContain("New owner: Rook");
		expect(normalize("membership.joined", {accountId: "player", role: "co_dm"}).details).toContain("Role: Co-DM");
		expect(normalize("invite.created", {role: "spectator"}).details).toContain("Role: Spectator");
		expect(normalize("action.applied", {
			targetCharacterId: "character",
			effect: {type: "healing", amount: 8, context: "Cure Wounds"},
		}).details).toContain("Effect: Cure Wounds: 8 healing");
		expect(normalize("xp.granted", {amount: 250, xp: 900}, "character").details).toEqual(["Amount: 250 XP", "Total: 900 XP"]);
		expect(normalize("item.granted", {entry: {item: {name: "<b>Moon Blade</b>"}, quantity: 2}}, "character").details).toEqual(["Item: Moon Blade", "Quantity: 2"]);
		expect(normalize("brew.activated", {version: 4}).details).toContain("Version: 4");
		expect(normalize("rules.activated", {version: 7}).details).toContain("Version: 7");
		expect(normalize("transfer.committed", {
			sourceKind: "character",
			sourceId: "character",
			targetKind: "party_inventory",
			targetId: "stash",
		}).title).toBe("Morgan accepted a transfer from Nyx to Party inventory.");
	});

	it("renders campaign-scoped roll attribution from the actor", () => {
		const createElement = tagName => ({
			tagName,
			children: [],
			className: "",
			textContent: "",
			append (...children) { this.children.push(...children); },
		});
		const list = {
			children: [],
			replaceChildren (...children) { this.children = children; },
		};
		renderHubActivityRows({
			list,
			events: [{
				type: "roll.logged",
				aggregateType: "campaign",
				aggregateId: "campaign",
				actorAccountId: "dm",
				actorDisplayName: "Morgan",
				payload: {total: 15, detail: {title: "Initiative"}},
				createdAt: "2026-09-01T00:00:00.000Z",
			}],
			characters: [],
			members: [],
			documentRef: {createElement},
			getDateLabel: () => "Now",
		});
		expect(list.children[0].children[0].children[0].textContent).toBe("Morgan");

		renderHubActivityRows({
			list,
			events: [{
				type: "roll.logged",
				aggregateType: "character",
				aggregateId: "character",
				actorAccountId: "dm",
				actorDisplayName: "Morgan",
				payload: {
					total: 15,
					detail: {title: "Initiative"},
					characterNameSnapshot: {version: 1, displayName: "Nyx"},
				},
				createdAt: "2026-09-01T00:00:00.000Z",
			}],
			characters: [],
			members: [],
			documentRef: {createElement},
			getDateLabel: () => "Now",
		});
		expect(list.children[0].children[0].children[0].textContent).toBe("Nyx (Morgan)");
	});

	it("does not enrich events with cross-campaign character snapshots", () => {
		const store = new MemoryHubStore();
		store._campaigns.set("campaign-a", {id: "campaign-a", status: "active"});
		store._characters.set("foreign-character", {
			id: "foreign-character",
			campaignId: "campaign-b",
			data: {name: "Secret Hero"},
		});
		const event = store._appendEvent({
			campaignId: "campaign-a",
			actorAccountId: "actor",
			type: "action.proposed",
			aggregateType: "character",
			aggregateId: "foreign-character",
			payload: {
				targetCharacterId: "foreign-character",
				sourceCharacterId: "foreign-character",
				clonedFromCharacterId: "foreign-character",
				sourceKind: "character",
				sourceId: "foreign-character",
			},
		});
		expect(event.payload).not.toHaveProperty("characterNameSnapshot");
		expect(event.payload).not.toHaveProperty("targetCharacterNameSnapshot");
		expect(event.payload).not.toHaveProperty("sourceCharacterNameSnapshot");
	});

	it("scopes PostgreSQL snapshot lookup to the event campaign", async () => {
		let insertedPayload;
		const client = {
			query: jest.fn(async (sql, params = []) => {
				if (sql.includes("UPDATE hub.campaigns")) return {rowCount: 1, rows: [{sequence: 1}]};
				if (sql.includes("FROM hub.characters")) {
					expect(sql).toContain("campaign_id = $2");
					expect(params[1]).toBe("campaign-a");
					return {rowCount: 0, rows: []};
				}
				if (sql.includes("INSERT INTO hub.domain_events")) insertedPayload = JSON.parse(params[10]);
				return {rowCount: 1, rows: []};
			}),
		};
		const store = new PostgresHubStore({
			pool: {query: jest.fn(), connect: jest.fn(), on: jest.fn()},
		});
		await store._pAppendEvent({
			client,
			campaignId: "campaign-a",
			actorAccountId: "actor",
			type: "action.proposed",
			aggregateType: "campaign",
			aggregateId: "campaign-a",
			payload: {targetCharacterId: "foreign-character"},
		});
		expect(insertedPayload).toEqual({targetCharacterId: "foreign-character"});
	});

	it("keeps PostgreSQL public lifecycle commands on the same cancellation contract", () => {
		const source = fs.readFileSync(new URL("../../../server/src/postgres-hub-store.js", import.meta.url), "utf8");
		expect(source).toMatch(/async pMoveCharacter[\s\S]*?_pCancelIncomingForCharacter/);
		expect(source).toMatch(/async pArchiveCharacter[\s\S]*?_pCancelIncomingForCharacter/);
		expect(source).toMatch(/async pRemoveMember[\s\S]*?_pRemoveMembershipLifecycle/);
		expect(source).toMatch(/async pLeaveCampaign[\s\S]*?_pRemoveMembershipLifecycle/);
		expect(source).toMatch(/async pPurgeDueAccounts[\s\S]*?_pRemoveMembershipLifecycle/);
		const cancellation = source.slice(source.indexOf("async _pCancelIncomingForCharacter"), source.indexOf("async _pCancelTransferForLifecycle"));
		expect(cancellation).toContain("sourceKind: transfer.sourceKind");
		expect(cancellation).toContain("sourceId: transfer.sourceId");
		expect(cancellation).toContain("targetKind: transfer.targetKind");
		expect(cancellation).toContain("targetId: transfer.targetId");
	});

	it("keeps XSS and raw identifiers out of normalized browser text", () => {
		const normalized = normalizeHubEvent({
			event: {
				type: "roll.logged",
				aggregateType: "character",
				aggregateId: "character-id",
				payload: {
					detail: {title: "<img src=x onerror=alert(1)>", target: "<script>alert(1)</script>"},
					characterNameSnapshot: {version: 1, displayName: "<b>Nyx</b>"},
				},
			},
			characters: [],
		});
		expect(normalized.title).toBe("Dice roll");
		expect(normalized.subject).toBe("Nyx");
		expect(normalized.details.join(" ")).not.toContain("<");
		expect(JSON.stringify(normalized)).not.toMatch(/character-id/);
	});

	it("adds snapshots to targeted events at the authoritative write point without exposing IDs", () => {
		const payload = enrichEventPayload({
			payload: {targetCharacterId: "target", sourceKind: "character", sourceId: "source"},
			aggregateType: "character",
			aggregateId: "aggregate",
			visibility: "explicit_accounts",
			getCharacterById: id => ({data: {name: `<b>${id === "aggregate" ? "The Hero" : id} name</b>`}}),
		});
		expect(payload.characterNameSnapshot.displayName).toBe("The Hero name");
		expect(payload.targetCharacterNameSnapshot.displayName).toBe("target name");
		expect(payload.sourceCharacterNameSnapshot.displayName).toBe("source name");
		expect(normalizeHubEvent({
			event: {type: "character.created", aggregateType: "character", aggregateId: "aggregate", payload},
		}).title).not.toContain("aggregate");
	});

	it("keeps canonical names and owner association out of shared event payloads", () => {
		const payload = enrichEventPayload({
			payload: {
				targetCharacterId: "target",
				sourceKind: "character",
				sourceId: "source",
				ownerAccountId: "account-1",
				characterNameSnapshot: {version: 1, displayName: "The Hero"},
			},
			aggregateType: "character",
			aggregateId: "aggregate",
			visibility: "all_members",
			getCharacterById: id => ({data: {name: `${id} name`}}),
		});

		// A durable event is never rewritten, so a name captured here would survive an
		// owner later narrowing their sharing policy. Shared rows carry ids only.
		expect(payload).toEqual({targetCharacterId: "target", sourceKind: "character", sourceId: "source"});
		expect(JSON.stringify(payload)).not.toContain("account-1");
		expect(JSON.stringify(payload)).not.toContain("The Hero");
	});
});
