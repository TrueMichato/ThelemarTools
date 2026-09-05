import crypto from "node:crypto";

import {
	canonicalizeCampaignSourceId,
	evaluateCampaignContentEntity,
	filterCampaignContentEntities,
	getCharacterCampaignContentCompliance,
	getCharacterCampaignContentMutationCompliance,
} from "../../../js/hub/hub-content-policy.js";
import {createDefaultCampaignRulesPolicy} from "../../../js/hub/hub-campaign-rules.js";
import {
	pBuildCampaignContentSiteCatalog,
	pGetCampaignContentCatalog,
} from "../../../server/src/campaign-content-policy.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const AVAILABLE_SOURCES = ["PHB", "XPHB", "DMG", "CMP"];
const AVAILABLE_SPECIES = ["Human|PHB", "Elf (High)|PHB", "Elf (High)|XPHB", "Elf|XPHB", "Firbolg|CMP"];

function getContentPolicy ({
	sources = ["PHB"],
	species = [],
	editions = ["2014"],
} = {}) {
	return {version: 1, sources, species, editions};
}

function setContentPolicy (policy, {
	sources = ["PHB"],
	species = [],
	editions = ["2014"],
} = {}) {
	policy.rules.find(rule => rule.id === "content.sources.allowed").parameters.sources = sources;
	policy.rules.find(rule => rule.id === "content.species.allowed").parameters.species = species;
	policy.rules.find(rule => rule.id === "content.editions.allowed").parameters.editions = editions;
	return policy;
}

describe("Campaign content policy evaluator", () => {
	it("canonicalizes stable source aliases and resolves edition conflicts deterministically", () => {
		expect(canonicalizeCampaignSourceId(" phb-2014 ")).toBe("PHB");
		expect(canonicalizeCampaignSourceId("phb2024")).toBe("XPHB");
		expect(evaluateCampaignContentEntity({
			contentPolicy: getContentPolicy(),
			entity: {name: "Human", source: "PHB", edition: "classic"},
			kind: "species",
			availableSources: AVAILABLE_SOURCES,
			availableSpecies: AVAILABLE_SPECIES,
		})).toEqual(expect.objectContaining({isAllowed: true}));
		expect(evaluateCampaignContentEntity({
			contentPolicy: getContentPolicy({sources: [], editions: ["2014"]}),
			entity: {name: "Human", source: "XPHB", edition: "classic"},
			kind: "species",
			availableSources: AVAILABLE_SOURCES,
			availableSpecies: AVAILABLE_SPECIES,
			sourceEditions: {PHB: "2014", XPHB: "2024"},
		})).toEqual(expect.objectContaining({
			isAllowed: false,
			violations: expect.arrayContaining([
				expect.objectContaining({code: "CONTENT_EDITION_UNKNOWN"}),
			]),
		}));
		expect(evaluateCampaignContentEntity({
			contentPolicy: getContentPolicy({sources: [], editions: ["2024"]}),
			entity: {name: "Spoofed feat", source: "phb", edition: "one"},
			kind: "feat",
			availableSources: AVAILABLE_SOURCES,
			sourceEditions: {PHB: "2014", XPHB: "2024"},
		})).toEqual(expect.objectContaining({
			isAllowed: false,
			violations: expect.arrayContaining([
				expect.objectContaining({code: "CONTENT_EDITION_UNKNOWN"}),
			]),
		}));
	});

	it("treats each species variant as a distinct name|source identity", () => {
		const policy = getContentPolicy({
			sources: ["PHB"],
			species: ["Elf (High)|PHB"],
			editions: ["2014"],
		});
		expect(filterCampaignContentEntities({
			contentPolicy: policy,
			kind: "species",
			availableSources: AVAILABLE_SOURCES,
			availableSpecies: AVAILABLE_SPECIES,
			entities: [
				{name: "Elf (High)", source: "PHB"},
				{name: "Human", source: "PHB"},
				{name: "Elf", source: "XPHB", edition: "one"},
			],
		})).toEqual([{name: "Elf (High)", source: "PHB"}]);
	});

	it("grandfathers existing identities, permits removals, and blocks only newly disallowed choices", () => {
		const legacy = {
			name: "Private hero name",
			race: {name: "Elf", source: "XPHB", edition: "one"},
			inventory: [{id: "legacy-item", item: {name: "Legacy blade", source: "XPHB", edition: "one"}, quantity: 1}],
		};
		const policy = getContentPolicy();
		const unrelated = getCharacterCampaignContentMutationCompliance({
			contentPolicy: policy,
			before: legacy,
			after: {...structuredClone(legacy), xp: 100},
			availableSources: AVAILABLE_SOURCES,
			availableSpecies: AVAILABLE_SPECIES,
		});
		expect(unrelated.total).toBe(0);

		const removed = structuredClone(legacy);
		delete removed.race;
		removed.inventory = [];
		expect(getCharacterCampaignContentMutationCompliance({
			contentPolicy: policy,
			before: legacy,
			after: removed,
			availableSources: AVAILABLE_SOURCES,
			availableSpecies: AVAILABLE_SPECIES,
		}).total).toBe(0);

		const added = structuredClone(legacy);
		added.feats = [{name: "New feat", source: "XPHB", edition: "one"}];
		const report = getCharacterCampaignContentMutationCompliance({
			contentPolicy: policy,
			before: legacy,
			after: added,
			availableSources: AVAILABLE_SOURCES,
			availableSpecies: AVAILABLE_SPECIES,
			rulesVersionId: "rules-2",
		});
		expect(report).toEqual(expect.objectContaining({
			rulesVersionId: "rules-2",
			total: 2,
			findings: expect.arrayContaining([
				expect.objectContaining({code: "CONTENT_SOURCE_NOT_ALLOWED", disposition: "blocking"}),
				expect.objectContaining({code: "CONTENT_EDITION_NOT_ALLOWED", disposition: "blocking"}),
			]),
		}));
		expect(JSON.stringify(report)).not.toContain(legacy.name);
	});

	it("treats species-base and edition changes as new choices rather than grandfathered content", () => {
		const speciesBefore = {
			race: {name: "High", source: "PHB", _baseName: "Elf", _baseSource: "PHB"},
		};
		const speciesAfter = structuredClone(speciesBefore);
		speciesAfter.race._baseSource = "XPHB";
		expect(getCharacterCampaignContentMutationCompliance({
			contentPolicy: getContentPolicy(),
			before: speciesBefore,
			after: speciesAfter,
			availableSources: AVAILABLE_SOURCES,
			availableSpecies: AVAILABLE_SPECIES,
			sourceEditions: {PHB: "2014", XPHB: "2024"},
		}).findings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "CONTENT_SOURCE_NOT_ALLOWED", disposition: "blocking"}),
			expect.objectContaining({code: "CONTENT_EDITION_NOT_ALLOWED", disposition: "blocking"}),
		]));

		const editionBefore = {feats: [{name: "Campaign Feat", source: "CMP", edition: "classic"}]};
		const editionAfter = {feats: [{name: "Campaign Feat", source: "CMP", edition: "one"}]};
		expect(getCharacterCampaignContentMutationCompliance({
			contentPolicy: getContentPolicy({sources: ["CMP"]}),
			before: editionBefore,
			after: editionAfter,
			availableSources: AVAILABLE_SOURCES,
			sourceEditions: {CMP: "2014"},
		}).findings).toEqual([
			expect.objectContaining({code: "CONTENT_EDITION_UNKNOWN", disposition: "blocking"}),
		]);
	});

	it("rejects client-asserted intrinsic grants and bounds legacy reports", () => {
		const policy = getContentPolicy();
		const intrinsic = {
			spellcasting: {
				innateSpells: [{name: "Granted spell", source: "XPHB", edition: "one"}],
			},
		};
		expect(getCharacterCampaignContentMutationCompliance({
			contentPolicy: policy,
			before: {},
			after: intrinsic,
			availableSources: AVAILABLE_SOURCES,
		}).total).toBe(2);

		const character = {
			spellcasting: {
				spellsKnown: Array.from({length: 8}, (_, ix) => ({name: `Spell ${ix}`, source: "XPHB", edition: "one"})),
			},
		};
		const report = getCharacterCampaignContentCompliance({
			contentPolicy: policy,
			character,
			availableSources: AVAILABLE_SOURCES,
			limit: 3,
		});
		expect(report.total).toBe(16);
		expect(report.findings).toHaveLength(3);
		expect(report.isTruncated).toBe(true);
		expect(report.findings.map(it => it.entity.uid)).toEqual([...report.findings.map(it => it.entity.uid)].sort());
	});

	it("enforces every newly added source-bearing feature", () => {
		const report = getCharacterCampaignContentMutationCompliance({
			contentPolicy: getContentPolicy({sources: ["XPHB"], editions: ["2024"]}),
			before: {features: []},
			after: {
				features: [{name: "Action Surge", source: "PHB", edition: "classic", featureType: "Class"}],
			},
			availableSources: AVAILABLE_SOURCES,
			sourceEditions: {PHB: "2014", XPHB: "2024"},
		});
		expect(report.findings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "CONTENT_SOURCE_NOT_ALLOWED", disposition: "blocking"}),
			expect.objectContaining({code: "CONTENT_EDITION_NOT_ALLOWED", disposition: "blocking"}),
		]));
	});

	it("permits deterministic feature repair for an unchanged legacy root but not level-up grants", () => {
		const contentPolicy = getContentPolicy({sources: ["PHB"], editions: ["2014"]});
		const before = {classes: [{name: "Fighter", source: "XPHB", level: 1}], features: []};
		const repaired = {
			classes: [{name: "Fighter", source: "XPHB", level: 1}],
			features: [{name: "Fighting Style", source: "XPHB", edition: "one", featureType: "Class"}],
		};
		expect(getCharacterCampaignContentMutationCompliance({
			contentPolicy,
			before,
			after: repaired,
			availableSources: AVAILABLE_SOURCES,
			sourceEditions: {PHB: "2014", XPHB: "2024"},
		}).total).toBe(0);

		const levelled = structuredClone(repaired);
		levelled.classes[0].level = 2;
		expect(getCharacterCampaignContentMutationCompliance({
			contentPolicy,
			before,
			after: levelled,
			availableSources: AVAILABLE_SOURCES,
			sourceEditions: {PHB: "2014", XPHB: "2024"},
		}).findings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "CONTENT_SOURCE_NOT_ALLOWED", disposition: "blocking"}),
			expect.objectContaining({code: "CONTENT_EDITION_NOT_ALLOWED", disposition: "blocking"}),
		]));
	});

	it("fails closed when an entity omits its source identity", () => {
		const report = getCharacterCampaignContentMutationCompliance({
			contentPolicy: getContentPolicy(),
			before: {},
			after: {race: {name: "Unidentified species"}},
			availableSources: AVAILABLE_SOURCES,
			availableSpecies: AVAILABLE_SPECIES,
		});
		expect(report.findings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "CONTENT_ID_INVALID", disposition: "blocking"}),
			expect.objectContaining({code: "CONTENT_EDITION_UNKNOWN", disposition: "blocking"}),
		]));
	});

	it("includes active campaign brew sources and merged species variants in the publication catalog", async () => {
		const generated = await pGetCampaignContentCatalog();
		expect(generated).toEqual(await pBuildCampaignContentSiteCatalog());

		const catalog = await pGetCampaignContentCatalog({
			brewBundle: {
				content: [{
					head: {filename: "campaign.json"},
					body: {
						_meta: {sources: [{json: "CMP", abbreviation: "CMP", full: "Campaign"}]},
						race: [{
							name: "Firbolg",
							source: "CMP",
							subraces: [{name: "Dreamer"}],
						}],
					},
				}],
			},
		});
		expect(catalog.sources).toEqual(expect.arrayContaining(["PHB", "XPHB", "CMP"]));
		expect(catalog.species).toEqual(expect.arrayContaining(["Elf (High)|PHB", "Firbolg (Dreamer)|CMP"]));
		expect(catalog.species).toEqual(expect.arrayContaining([
			"Elf (Eladrin)|PHB",
			"Human (Base)|PHB",
			"Dragonborn (Black)|XPHB",
		]));
		expect(catalog.sourceEditions).toEqual(expect.objectContaining({
			Ar8: "2014",
			FRHoF: "2024",
			XPHB: "2024",
		}));
		await expect(pGetCampaignContentCatalog({
			brewBundle: {
				content: [{
					head: {filename: "spoofed-phb.json"},
					body: {
						_meta: {
							edition: "one",
							sources: [{json: "PHB", abbreviation: "PHB", full: "Spoofed PHB"}],
						},
						feat: [{name: "Spoofed feat", source: "PHB"}],
					},
				}],
			},
		})).rejects.toEqual(expect.objectContaining({code: "BREW_INVALID"}));
		await expect(pGetCampaignContentCatalog({
			brewBundle: {
				content: [
					{body: {_meta: {edition: "classic", sources: [{json: "CMP", edition: "classic"}]}}},
					{body: {_meta: {edition: "one", sources: [{json: "cmp", edition: "one"}]}}},
				],
			},
		})).rejects.toEqual(expect.objectContaining({code: "BREW_INVALID"}));
	});
});

describe("Memory campaign content enforcement", () => {
	let store;
	let account;
	let campaign;

	beforeEach(async () => {
		store = new MemoryHubStore();
		account = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: crypto.randomUUID(),
			displayName: "DM",
		});
		campaign = (await store.pCreateCampaign({
			accountId: account.id,
			name: "Content policy",
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
	});

	it("enforces imports, direct writes, version fences, and grandfathered unrelated edits without leaking events", async () => {
		const legacy = (await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {
				name: "Legacy private name",
				race: {name: "Elf", source: "XPHB", edition: "one"},
				inventory: [],
			},
			schemaVersion: 1,
			clientImportId: "legacy",
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const policy = setContentPolicy(createDefaultCampaignRulesPolicy(), {
			sources: ["PHB"],
			species: ["Human (Base)|PHB"],
			editions: ["2014"],
		});
		const published = await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: campaign.id,
			policy,
			expectedActiveRulesVersionId: null,
			idempotencyKey: crypto.randomUUID(),
		});
		const rulesVersionId = published.rulesVersion.id;

		const allowed = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {name: "Allowed", race: {name: "Human (Base)", source: "PHB", edition: "classic"}},
			schemaVersion: 1,
			clientImportId: "allowed",
			rulesVersionId,
			idempotencyKey: crypto.randomUUID(),
		});
		expect(allowed.character.data.race.source).toBe("PHB");

		await expect(store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {name: "Denied", race: {name: "Elf", source: "XPHB", edition: "one"}},
			schemaVersion: 1,
			clientImportId: "denied",
			rulesVersionId,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({
			code: "CONTENT_POLICY_VIOLATION",
			details: expect.objectContaining({
				report: expect.objectContaining({rulesVersionId}),
			}),
		}));

		await expect(store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {name: "Personal brew", feats: [{name: "Personal feat", source: "PERSONAL"}]},
			schemaVersion: 1,
			clientImportId: "personal",
			rulesVersionId,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({code: "CONTENT_POLICY_VIOLATION"}));

		await expect(store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {name: "Stale", race: {name: "Human", source: "PHB"}},
			schemaVersion: 1,
			clientImportId: "stale",
			rulesVersionId: null,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({code: "RULES_VERSION_STALE"}));

		const detached = await store.pCreateCharacter({
			accountId: account.id,
			data: {name: "Local-compatible", feats: [{name: "Personal feat", source: "PERSONAL"}]},
			schemaVersion: 1,
			clientImportId: "detached",
			idempotencyKey: crypto.randomUUID(),
		});
		expect(detached.character.campaignId).toBeNull();
		await expect(store.pMoveCharacter({
			accountId: account.id,
			characterId: detached.character.id,
			campaignId: campaign.id,
			rulesVersionId,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({code: "CONTENT_POLICY_VIOLATION"}));
		expect((await store.pGetCharacter({accountId: account.id, characterId: detached.character.id})).character.campaignId).toBeNull();

		await expect(store.pCloneCharacter({
			accountId: account.id,
			characterId: legacy.id,
			campaignId: campaign.id,
			rulesVersionId,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({code: "CONTENT_POLICY_VIOLATION"}));

		const lease = await store.pAcquireCharacterLease({
			accountId: account.id,
			sessionId: "session-1",
			characterId: legacy.id,
		});
		const renamed = await store.pPatchCharacter({
			accountId: account.id,
			sessionId: "session-1",
			characterId: legacy.id,
			baseRevision: legacy.revision,
			leaseEpoch: lease.epoch,
			patches: [{op: "replace", path: "/name", value: "Legacy renamed"}],
			rulesVersionId,
			idempotencyKey: crypto.randomUUID(),
		});
		expect(renamed.character.data.race.source).toBe("XPHB");

		const eventsBeforeDeniedWrite = store._events.length;
		await expect(store.pPatchCharacter({
			accountId: account.id,
			sessionId: "session-1",
			characterId: legacy.id,
			baseRevision: renamed.character.revision,
			leaseEpoch: lease.epoch,
			patches: [{op: "add", path: "/feats", value: [{name: "New feat", source: "XPHB", edition: "one"}]}],
			rulesVersionId,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({
			code: "CONTENT_POLICY_VIOLATION",
			details: expect.not.objectContaining({characterName: expect.anything()}),
		}));
		expect(store._events).toHaveLength(eventsBeforeDeniedWrite);

		await expect(store.pGrantItem({
			accountId: account.id,
			campaignId: campaign.id,
			characterId: legacy.id,
			item: {name: "Denied item", source: "XPHB", edition: "one"},
			rulesVersionId,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({code: "CONTENT_POLICY_VIOLATION"}));
	});

	it("rechecks membership after asynchronous content enforcement before committing", async () => {
		const player = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: crypto.randomUUID(),
			displayName: "Player",
		});
		const tokenHash = crypto.createHash("sha256").update("content-race-invite").digest("hex");
		await store.pCreateInvite({
			accountId: account.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		const {membership} = await store.pRedeemInvite({
			accountId: player.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		});
		const pGetEnforcement = store._pGetCampaignContentEnforcement.bind(store);
		let releaseEnforcement;
		let markEnforcementStarted;
		const enforcementStarted = new Promise(resolve => markEnforcementStarted = resolve);
		const enforcementGate = new Promise(resolve => releaseEnforcement = resolve);
		store._pGetCampaignContentEnforcement = async campaignId => {
			markEnforcementStarted();
			await enforcementGate;
			return pGetEnforcement(campaignId);
		};

		const pending = store.pCreateCharacter({
			accountId: player.id,
			campaignId: campaign.id,
			data: {name: "Removed player character", race: {name: "Human", source: "PHB"}},
			schemaVersion: 1,
			clientImportId: "membership-race",
			idempotencyKey: crypto.randomUUID(),
		});
		await enforcementStarted;
		await store.pRemoveMember({
			accountId: account.id,
			campaignId: campaign.id,
			membershipId: membership.id,
			idempotencyKey: crypto.randomUUID(),
		});
		releaseEnforcement();

		await expect(pending).rejects.toEqual(expect.objectContaining({code: "CAMPAIGN_NOT_FOUND"}));
		expect([...store._characters.values()].filter(character => character.ownerAccountId === player.id)).toHaveLength(0);
	});

	it("rechecks co-DM authorization after catalog loading before publishing policy", async () => {
		const coDm = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: crypto.randomUUID(),
			displayName: "Co-DM",
		});
		const tokenHash = crypto.createHash("sha256").update("content-policy-race-invite").digest("hex");
		await store.pCreateInvite({
			accountId: account.id,
			campaignId: campaign.id,
			role: "co_dm",
			tokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		const {membership} = await store.pRedeemInvite({
			accountId: coDm.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		});
		const pGetCatalog = store._pGetCampaignContentCatalog.bind(store);
		let releaseCatalog;
		let markCatalogStarted;
		const catalogStarted = new Promise(resolve => markCatalogStarted = resolve);
		const catalogGate = new Promise(resolve => releaseCatalog = resolve);
		store._pGetCampaignContentCatalog = async args => {
			markCatalogStarted();
			await catalogGate;
			return pGetCatalog(args);
		};

		const pending = store.pCreateAndActivateRulesPolicy({
			accountId: coDm.id,
			campaignId: campaign.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: crypto.randomUUID(),
		});
		await catalogStarted;
		await store.pRemoveMember({
			accountId: account.id,
			campaignId: campaign.id,
			membershipId: membership.id,
			idempotencyKey: crypto.randomUUID(),
		});
		releaseCatalog();

		await expect(pending).rejects.toEqual(expect.objectContaining({code: "CAMPAIGN_NOT_FOUND"}));
		expect(store._rulesVersions.size).toBe(0);
	});
});
