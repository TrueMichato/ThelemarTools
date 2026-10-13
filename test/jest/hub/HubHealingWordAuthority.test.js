import crypto from "node:crypto";
import fs from "node:fs";
import {jest} from "@jest/globals";
import pg from "pg";
import "../charactersheet/setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {createHubApp} from "../../../server/src/app.js";

const idempotency = request => ({key: request.commandId, requestHash: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex")});
const cases = ["PHB", "XPHB"].flatMap(source => [
	{name: "Healing Word", source, level: 1, template: "spell.healing-word.heal", multi: false},
	{name: "Mass Healing Word", source, level: 3, template: "spell.mass-healing-word.heal", multi: true},
]);
const layOnHands = {name: "Lay on Hands", source: "XPHB", level: 1, template: "ability.lay-on-hands.heal", multi: false, ability: true};

function acquiredLayOnHandsData (level = 1, priorResources = []) {
	const state = new globalThis.CharacterSheetState();
	const book = JSON.parse(fs.readFileSync("data/class/class-paladin.json", "utf8"));
	const cls = book.class.find(entry => entry.name === "Paladin" && entry.source === "XPHB");
	for (const resource of priorResources) state.addResource(resource);
	state.addClass({name: "Paladin", source: "XPHB", level});
	globalThis.CharacterSheetClassUtils.updateClassResources(state, state.getClasses()[0], level, cls);
	globalThis.CharacterSheetClassUtils.reconcileClassFeatures(state, {getClassData: () => cls, classFeatures: book.classFeature});
	return state.toJson();
}

async function pFixture (store, definition, {targetCount = 2, full = false, sourceFull = false, prepared = true, wisdom = 16, castLevel = definition.level, sourceData = null} = {}) {
	const pActor = async label => {
		const identity = {provider: "github", providerSubject: `a5-${label}-${crypto.randomUUID()}`, displayName: label};
		const account = await store.pUpsertOAuthAccount(identity);
		const session = await store.pCreateSession({accountId: account.id, tokenHash: crypto.randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 86_400_000)});
		return {account, session, identity};
	};
	const [dm, sourceOwner, ownerA, ownerB, unrelated] = await Promise.all(["DM", "Source", "Owner A", "Owner B", "Unrelated"].map(pActor));
	const pCampaign = async () => {
		const campaign = (await store.pCreateCampaign({accountId: dm.account.id, name: `A5 ${crypto.randomUUID()}`, idempotencyKey: crypto.randomUUID()})).campaign;
		const rules = (await store.pCreateRulesVersion({accountId: dm.account.id, campaignId: campaign.id, schemaVersion: 1, rules: {}, idempotencyKey: crypto.randomUUID()})).rulesVersion;
		await store.pActivateRulesVersion({accountId: dm.account.id, campaignId: campaign.id, rulesVersionId: rules.id, idempotencyKey: crypto.randomUUID()});
		return {campaign, rules};
	};
	const {campaign, rules} = await pCampaign();
	const pJoin = async (actor, destination = campaign) => {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({accountId: dm.account.id, campaignId: destination.id, role: "player", tokenHash, expiresAt: new Date(Date.now() + 60_000), maxUses: 1, idempotencyKey: crypto.randomUUID()});
		return (await store.pRedeemInvite({accountId: actor.account.id, tokenHash, idempotencyKey: crypto.randomUUID()})).membership;
	};
	const memberships = await Promise.all([sourceOwner, ownerA, ownerB, unrelated].map(actor => pJoin(actor)));
	const pCharacter = async (actor, name, hp, isSource = false) => (await store.pCreateCharacter({
		accountId: actor.account.id,
		campaignId: campaign.id,
		schemaVersion: 1,
		clientImportId: crypto.randomUUID(),
		idempotencyKey: crypto.randomUUID(),
		data: {
			name,
			abilities: {str: 10, dex: 10, con: 10, int: 10, wis: wisdom, cha: 10},
			abilityBonuses: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0},
			classes: isSource ? [{name: "Cleric", source: definition.source, level: 7, spellcastingAbility: "wis"}] : [],
			features: [],
			inventory: [],
			conditions: [],
			hp: {current: hp, max: 100, effectiveMax: 100, temp: 0},
			spellcasting: {
				spellsKnown: isSource ? [{name: definition.name, source: definition.source, level: definition.level, sourceClass: "Cleric", prepared}] : [],
				cantripsKnown: [],
				innateSpells: [],
				spellSlots: {[castLevel]: {current: 1, max: 1}},
				pactSlots: {current: 0, max: 0, level: 0},
			},
			...(isSource && sourceData ? {classes: sourceData.classes, features: sourceData.features, resources: sourceData.resources, spellcasting: sourceData.spellcasting} : {}),
		},
	})).character;
	const source = await pCharacter(sourceOwner, "Source", sourceFull ? 100 : 10, true);
	const targets = await Promise.all(Array.from({length: targetCount}, (_, index) => pCharacter(index % 2 ? ownerB : ownerA, "Twin", full ? 100 : 5)));
	const entity = {type: definition.ability ? "ability" : "spell", uid: `${definition.name}|${definition.source}`.toLowerCase(), version: definition.source === "PHB" ? "phb-2014-v1" : "xphb-2024-v1"};
	const pPropose = async ({commandId = crypto.randomUUID(), refs = targets.map(target => target.targetRef), target = targets[0], entityOverride = entity, amount = 4} = {}) => {
		const request = {
			commandId,
			contractVersion: 1,
			sourceCharacterId: source.id,
			sourceEntity: entityOverride,
			effectTemplateId: definition.template,
			choice: definition.ability ? {amount} : {castLevel},
			rulesVersionId: rules.id,
			...(definition.multi ? {targetRefs: refs} : {targetRef: target.targetRef}),
		};
		return store[definition.multi ? "pCreateMultiTargetOperation" : "pCreateStructuredAction"]({
			accountId: sourceOwner.account.id,
			sessionId: sourceOwner.session.id,
			campaignId: campaign.id,
			protocolVersion: definition.multi ? "6" : "4",
			...request,
			idempotencyKey: idempotency(request),
		});
	};
	const pRespond = async ({operationId, invitationId, actor = ownerA, decision = "accept", commandId = crypto.randomUUID()}) => {
		const request = {commandId, contractVersion: 1, operationId, decision: definition.multi ? decision === "accept" ? "approve" : "reject" : decision, ...(definition.multi ? {invitationId} : {})};
		return store[definition.multi ? "pRespondMultiTargetInvitation" : "pResolveStructuredAction"]({
			accountId: actor.account.id,
			sessionId: actor.session.id,
			campaignId: campaign.id,
			protocolVersion: definition.multi ? "6" : "4",
			...request,
			...(!definition.multi ? {actionId: operationId} : {}),
			idempotencyKey: idempotency(request),
		});
	};
	const pFinalize = async ({operationId, selectedInvitationIds, commandId = crypto.randomUUID()}) => {
		const request = {commandId, contractVersion: 1, operationId, selectedInvitationIds};
		return store.pFinalizeMultiTargetOperation({
			accountId: sourceOwner.account.id, sessionId: sourceOwner.session.id, campaignId: campaign.id, protocolVersion: "6", ...request, idempotencyKey: idempotency(request),
		});
	};
	const pRead = async (actor, character = source) => (await store.pGetCharacter({accountId: actor.account.id, characterId: character.id})).character;
	const pPatchSource = async patches => {
		const current = await pRead(sourceOwner);
		const lease = await store.pAcquireCharacterLease({accountId: sourceOwner.account.id, sessionId: sourceOwner.session.id, characterId: source.id});
		await store.pPatchCharacter({
			accountId: sourceOwner.account.id,
			sessionId: sourceOwner.session.id,
			characterId: source.id,
			baseRevision: current.revision,
			leaseEpoch: lease.epoch,
			protocolVersion: "4",
			patches,
			idempotencyKey: crypto.randomUUID(),
		});
	};
	const pApprove = async proposed => {
		for (let index = 0; index < (definition.multi ? targets.length : 1); ++index) {
			await pRespond({operationId: proposed.operation.operationId, invitationId: proposed.operation.targets?.[index].invitationId, actor: index % 2 ? ownerB : ownerA});
		}
	};
	return {campaign, rules, dm, sourceOwner, ownerA, ownerB, unrelated, memberships, source, targets, pPropose, pRespond, pFinalize, pApprove, pRead, pPatchSource, pCampaign, pJoin};
}

for (const backend of ["memory", "postgres"]) {
	const describeBackend = backend === "postgres" && !process.env.HUB_TEST_POSTGRES_URL ? describe.skip : describe;
	describeBackend(`A5 production healing authority (${backend})`, () => {
		let pool;
		let store;
		beforeAll(async () => {
			if (backend === "postgres") {
				pool = new pg.Pool({connectionString: process.env.HUB_TEST_POSTGRES_URL, ssl: false, max: 12});
				store = new PostgresHubStore({pool, multiTargetOperationsEnabled: true, peerSourceCostsEnabled: true});
				await store.pCheckHealth();
			} else store = new MemoryHubStore({multiTargetOperationsEnabled: true, peerSourceCostsEnabled: true});
		});
		afterAll(async () => { await pool?.end(); });

		if (backend === "postgres") {
			it("executes as the least-privilege runtime role, not a migration owner", async () => {
				const {rows} = await pool.query("SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user");
				expect(rows).toEqual([{name: "hub_runtime", rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false}]);
			});
		}

		it.each(cases)("$name $source spends one slot and applies the selected-dice floor for negative modifiers at base and upcast", async definition => {
			for (const castLevel of [definition.level, definition.level + 1]) {
				const ctx = await pFixture(store, definition, {wisdom: 1, castLevel});
				const random = jest.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.from(`${"0".repeat(60)}0319`, "hex"));
				let proposed;
				try { proposed = await ctx.pPropose(); } finally { random.mockRestore(); }
				if (definition.multi) {
					await ctx.pApprove(proposed);
					await ctx.pFinalize({operationId: proposed.operation.operationId, selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId)});
				} else await ctx.pRespond({operationId: proposed.operation.operationId});
				const count = definition.multi ? castLevel - (definition.source === "PHB" ? 2 : 1) : castLevel * (definition.source === "PHB" ? 1 : 2);
				expect((await ctx.pRead(ctx.ownerA, ctx.targets[0])).data.hp.current).toBe(5 + count);
				if (definition.multi) expect((await ctx.pRead(ctx.ownerB, ctx.targets[1])).data.hp.current).toBe(5 + count);
				expect((await ctx.pRead(ctx.sourceOwner)).data.spellcasting.spellSlots[castLevel].current).toBe(0);
			}
		});

		it.each(cases.flatMap(definition => ["uid", "brewBundleVersionId", "brewContentHash"].flatMap(field =>
			[false, true].map(pending => ({...definition, field, pending})),
		)))("$name $source rejects contradictory $field with pending=$pending at proposal/current concurrent finalization", async definition => {
			const {pending, field} = definition;
			const contradiction = {[field]: field === "uid" ? `fireball|${definition.source.toLowerCase()}` : field === "brewBundleVersionId" ? crypto.randomUUID() : "a".repeat(64)};
			const ctx = await pFixture(store, definition);
			const proposed = pending ? await ctx.pPropose() : null;
			if (proposed && definition.multi) await ctx.pApprove(proposed);
			const spell = {...ctx.source.data.spellcasting.spellsKnown[0], ...contradiction};
			await ctx.pPatchSource([{op: "replace", path: "/spellcasting/spellsKnown/0", value: spell}]);
			const before = await ctx.pRead(ctx.sourceOwner);
			const targetsBefore = await Promise.all(ctx.targets.map((target, index) => ctx.pRead(index % 2 ? ctx.ownerB : ctx.ownerA, target)));
			const eventsBefore = await store.pListVisibleEvents({accountId: ctx.sourceOwner.account.id, campaignId: ctx.campaign.id});
			if (!proposed) {
				const commandId = crypto.randomUUID();
				const outcomes = await Promise.allSettled([ctx.pPropose({commandId}), ctx.pPropose({commandId})]);
				expect(outcomes.map(outcome => outcome.status)).toEqual(["rejected", "rejected"]);
				for (const outcome of outcomes) expect(outcome.reason).toMatchObject({code: "SOURCE_OR_TARGET_UNAVAILABLE"});
				expect(await store.pListVisibleEvents({accountId: ctx.sourceOwner.account.id, campaignId: ctx.campaign.id})).toEqual(eventsBefore);
			} else {
				const request = {operationId: proposed.operation.operationId, commandId: crypto.randomUUID(), ...(definition.multi ? {selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId)} : {})};
				const resolve = () => definition.multi ? ctx.pFinalize(request) : ctx.pRespond(request);
				const [first, concurrent] = await Promise.all([resolve(), resolve()]);
				expect(first.operation.status).toBe("failed");
				expect(concurrent.eventIds).toEqual(first.eventIds);
				const eventsAfter = await store.pListVisibleEvents({accountId: ctx.sourceOwner.account.id, campaignId: ctx.campaign.id});
				expect((await resolve()).eventIds).toEqual(first.eventIds);
				expect(await store.pListVisibleEvents({accountId: ctx.sourceOwner.account.id, campaignId: ctx.campaign.id})).toEqual(eventsAfter);
				expect(first.operation).not.toHaveProperty("sourceCost");
				expect(first.operation).not.toHaveProperty("arguments");
				expect(JSON.stringify(first)).not.toContain(spell.uid || spell.brewBundleVersionId || spell.brewContentHash);
			}
			expect(await ctx.pRead(ctx.sourceOwner)).toEqual(before);
			for (let index = 0; index < ctx.targets.length; index++) expect(await ctx.pRead(index % 2 ? ctx.ownerB : ctx.ownerA, ctx.targets[index])).toEqual(targetsBefore[index]);
		}, 30_000);

		it.each(["source", "classSource", "className", "uid"])("Lay on Hands rejects already persisted contradictory resource %s before proposal", async field => {
			const sourceData = acquiredLayOnHandsData();
			const resource = sourceData.resources.find(entry => entry.featureRef?.uid === "lay on hands|xphb");
			resource[field] = field === "className" ? "Cleric" : field === "uid" ? "lay on hands|phb" : "PHB";
			const ctx = await pFixture(store, layOnHands, {sourceData});
			const before = await ctx.pRead(ctx.sourceOwner);
			const targetBefore = await ctx.pRead(ctx.ownerA, ctx.targets[0]);
			await expect(ctx.pPropose()).rejects.toMatchObject({code: "SOURCE_OR_TARGET_UNAVAILABLE"});
			expect(await ctx.pRead(ctx.sourceOwner)).toEqual(before);
			expect(await ctx.pRead(ctx.ownerA, ctx.targets[0])).toEqual(targetBefore);
		});

		it("ordinary XPHB acquisition preserves a separate explicit PHB pool through persist/load and production cost", async () => {
			const phbPool = {id: crypto.randomUUID(), name: "Lay on Hands", source: "PHB", description: "Unrelated manually tracked PHB pool", current: 17, max: 20, recharge: "long"};
			const acquired = acquiredLayOnHandsData(1, [phbPool]);
			expect(acquired.resources.find(resource => resource.id === phbPool.id)).toEqual(phbPool);
			const restored = new globalThis.CharacterSheetState();
			restored.loadFromJson(acquired);
			const ctx = await pFixture(store, layOnHands, {sourceData: restored.toJson()});
			const before = await ctx.pRead(ctx.sourceOwner);
			const bound = before.data.resources.find(resource => resource.featureRef?.uid === "lay on hands|xphb");
			expect(bound.id).not.toBe(phbPool.id);
			const proposed = await ctx.pPropose();
			await ctx.pRespond({operationId: proposed.operation.operationId});
			const after = await ctx.pRead(ctx.sourceOwner);
			expect(after.data.resources.find(resource => resource.id === phbPool.id)).toEqual(phbPool);
			expect(after.data.resources.find(resource => resource.id === bound.id)).toMatchObject({current: 1, max: 5});
			expect((await ctx.pRead(ctx.ownerA, ctx.targets[0])).data.hp.current).toBe(9);
		});

		it.each([10, 11, 15, 100, 101, 16])("authenticated protocol4 HTTP enforces amount %i on real serialized acquisition", async amount => {
			const level = amount >= 100 ? 20 : 3;
			const ctx = await pFixture(store, layOnHands, {sourceData: acquiredLayOnHandsData(level)});
			const app = await createHubApp({
				store,
				oauthProvider: {getAuthorizationUrl: ({state}) => `https://example.invalid/?state=${state}`, pExchangeCode: async () => ctx.sourceOwner.identity},
				config: {appOrigin: "https://tools.example", cookieSecret: "x".repeat(32), csrfSecret: "y".repeat(32)},
			});
			try {
				const start = await app.inject({method: "GET", url: "/auth/github/start"});
				const oauthState = new URL(start.headers.location).searchParams.get("state");
				const callback = await app.inject({
					method: "GET",
					url: `/auth/github/callback?code=x&state=${oauthState}`,
					headers: {cookie: `__Host-hub_oauth=${start.cookies.find(cookie => cookie.name === "__Host-hub_oauth").value}`},
				});
				const cookie = `__Host-hub_session=${callback.cookies.find(cookie => cookie.name === "__Host-hub_session").value}`;
				const session = (await app.inject({method: "GET", url: "/api/session", headers: {cookie}})).json();
				const commandId = crypto.randomUUID();
				const before = await ctx.pRead(ctx.sourceOwner);
				const targetBefore = await ctx.pRead(ctx.ownerA, ctx.targets[0]);
				const response = await app.inject({
					method: "POST",
					url: `/api/campaigns/${ctx.campaign.id}/actions`,
					headers: {cookie, origin: "https://tools.example", "x-csrf-token": session.csrfToken, "x-hub-protocol-version": "4", "idempotency-key": commandId},
					payload: {contractVersion: 1, commandId, sourceCharacterId: ctx.source.id, sourceEntity: {type: "ability", uid: "lay on hands|xphb", version: "xphb-2024-v1"}, effectTemplateId: layOnHands.template, choice: {amount}, targetRef: ctx.targets[0].targetRef, rulesVersionId: ctx.rules.id},
				});
				expect(response.statusCode).toBe(amount === 101 ? 400 : amount === 16 ? 409 : 201);
				if (amount === 101) expect(response.json()).toMatchObject({error: "INVALID_REQUEST"});
				else if (amount === 16) expect(response.json()).toMatchObject({error: "SOURCE_COST_UNAVAILABLE"});
				else {
					const result = await ctx.pRespond({operationId: response.json().operation.operationId});
					expect(result.operation.status).toBe("applied");
					const after = await ctx.pRead(ctx.sourceOwner);
					const pool = after.data.resources.find(resource => resource.featureRef?.uid === "lay on hands|xphb");
					expect(pool.current).toBe(5 * level - amount);
					expect(after.data.features.find(feature => feature.id === pool.featureId).uses.current).toBe(pool.current);
					expect((await ctx.pRead(ctx.ownerA, ctx.targets[0])).data.hp.current).toBe(Math.min(100, 5 + amount));
				}
				if ([101, 16].includes(amount)) {
					expect(await ctx.pRead(ctx.sourceOwner)).toEqual(before);
					expect(await ctx.pRead(ctx.ownerA, ctx.targets[0])).toEqual(targetBefore);
				}
			} finally {
				await app.close();
			}
		});

		it("Lay on Hands derives from ordinary acquisition, commits one exact amount/mirror cost and collapses concurrent retries", async () => {
			const data = acquiredLayOnHandsData();
			const pool = data.resources.find(resource => resource.featureRef?.uid === "lay on hands|xphb");
			expect(pool).toMatchObject({current: 5, max: 5});
			const ctx = await pFixture(store, layOnHands, {sourceData: data});
			const commandId = crypto.randomUUID();
			const proposed = await ctx.pPropose({commandId});
			expect(proposed.operation.presentation.tableRules).toContain("Touch range and bonus-action eligibility");
			expect((await ctx.pRead(ctx.sourceOwner)).data.resources.find(resource => resource.id === pool.id).current).toBe(5);
			const request = {operationId: proposed.operation.operationId, commandId: crypto.randomUUID()};
			const [first, second] = await Promise.all([ctx.pRespond(request), ctx.pRespond(request)]);
			expect(first.operation.status).toBe("applied");
			expect(first.eventIds).toEqual(second.eventIds);
			expect(JSON.stringify(first)).not.toContain(pool.id);
			expect((await ctx.pRead(ctx.ownerA, ctx.targets[0])).data.hp.current).toBe(9);
			const source = await ctx.pRead(ctx.sourceOwner);
			expect(source.data.resources.find(resource => resource.id === pool.id)).toMatchObject({current: 1, max: 5});
			expect(source.data.features.find(feature => feature.id === pool.featureId).uses).toMatchObject({current: 1, max: 5});
			expect((await ctx.pPropose({commandId})).operation.status).toBe("proposed");
			expect((await ctx.pRead(ctx.sourceOwner)).revision).toBe(source.revision);
		});

		it("Lay on Hands fails atomically when its ordinary linked pool becomes unavailable before consent finalizes", async () => {
			const ctx = await pFixture(store, layOnHands, {sourceData: acquiredLayOnHandsData()});
			const proposed = await ctx.pPropose();
			const source = await ctx.pRead(ctx.sourceOwner);
			const resourceIndex = source.data.resources.findIndex(resource => resource.featureRef?.uid === "lay on hands|xphb");
			const featureIndex = source.data.features.findIndex(feature => feature.id === source.data.resources[resourceIndex].featureId);
			const lease = await store.pAcquireCharacterLease({accountId: ctx.sourceOwner.account.id, sessionId: ctx.sourceOwner.session.id, characterId: source.id});
			await store.pPatchCharacter({
				accountId: ctx.sourceOwner.account.id,
				sessionId: ctx.sourceOwner.session.id,
				characterId: source.id,
				baseRevision: source.revision,
				leaseEpoch: lease.epoch,
				protocolVersion: "4",
				patches: [{op: "replace", path: `/resources/${resourceIndex}/current`, value: 0}, {op: "replace", path: `/features/${featureIndex}/uses/current`, value: 0}],
				idempotencyKey: crypto.randomUUID(),
			});
			expect((await ctx.pRespond({operationId: proposed.operation.operationId})).operation.status).toBe("failed");
			expect((await ctx.pRead(ctx.ownerA, ctx.targets[0])).revision).toBe(ctx.targets[0].revision);
			expect((await ctx.pRead(ctx.sourceOwner)).data.resources[resourceIndex].current).toBe(0);
		});

		it.each(["duplicate resource", "duplicate feature", "stale mirror", "wrong link", "short recovery", "PHB resource source", "PHB resource classSource", "other resource class", "contradictory resource UID"])("Lay on Hands rejects %s at actual consent finalization without spending or changing the target", async corruption => {
			const ctx = await pFixture(store, layOnHands, {sourceData: acquiredLayOnHandsData()});
			const proposed = await ctx.pPropose();
			const source = await ctx.pRead(ctx.sourceOwner);
			const resources = JSON.parse(JSON.stringify(source.data.resources));
			const features = JSON.parse(JSON.stringify(source.data.features));
			const resource = resources.find(entry => entry.featureRef?.uid === "lay on hands|xphb");
			const feature = features.find(entry => entry.id === resource.featureId);
			if (corruption === "duplicate resource") resources.push(JSON.parse(JSON.stringify(resource)));
			if (corruption === "duplicate feature") features.push(JSON.parse(JSON.stringify(feature)));
			if (corruption === "stale mirror") feature.uses.current = 4;
			if (corruption === "wrong link") resource.featureId = crypto.randomUUID();
			if (corruption === "short recovery") resource.shortRestRecovery = true;
			if (corruption === "PHB resource source") resource.source = "PHB";
			if (corruption === "PHB resource classSource") resource.classSource = "PHB";
			if (corruption === "other resource class") resource.className = "Cleric";
			if (corruption === "contradictory resource UID") resource.uid = "lay on hands|phb";
			const lease = await store.pAcquireCharacterLease({accountId: ctx.sourceOwner.account.id, sessionId: ctx.sourceOwner.session.id, characterId: source.id});
			await store.pPatchCharacter({
				accountId: ctx.sourceOwner.account.id,
				sessionId: ctx.sourceOwner.session.id,
				characterId: source.id,
				baseRevision: source.revision,
				leaseEpoch: lease.epoch,
				protocolVersion: "4",
				patches: [{op: "replace", path: "/resources", value: resources}, {op: "replace", path: "/features", value: features}],
				idempotencyKey: crypto.randomUUID(),
			});
			const before = await ctx.pRead(ctx.sourceOwner);
			const targetBefore = await ctx.pRead(ctx.ownerA, ctx.targets[0]);
			const request = {operationId: proposed.operation.operationId, commandId: crypto.randomUUID()};
			const result = await ctx.pRespond(request);
			expect(result.operation.status).toBe("failed");
			expect((await ctx.pRespond(request)).eventIds).toEqual(result.eventIds);
			expect(await ctx.pRead(ctx.sourceOwner)).toEqual(before);
			expect(await ctx.pRead(ctx.ownerA, ctx.targets[0])).toEqual(targetBefore);
		});

		it.each([...cases.filter(definition => !definition.multi), layOnHands].flatMap(definition =>
			["peer", "self"].map(targetMode => ({...definition, targetMode})),
		))("$source $name $targetMode preserves private singular no-effect failure without spending or changing either character", async definition => {
			const isSelf = definition.targetMode === "self";
			const ctx = await pFixture(store, definition, {sourceData: definition.ability ? acquiredLayOnHandsData() : undefined, full: true, sourceFull: isSelf});
			const sourceBefore = await ctx.pRead(ctx.sourceOwner);
			const selectedTarget = isSelf ? ctx.source : ctx.targets[0];
			const targetOwner = isSelf ? ctx.sourceOwner : ctx.ownerA;
			const proposed = await ctx.pPropose({target: selectedTarget});
			const request = {operationId: proposed.operation.operationId, actor: targetOwner, commandId: crypto.randomUUID()};
			const [result, concurrent] = await Promise.all([ctx.pRespond(request), ctx.pRespond(request)]);
			expect(result.operation.status).toBe("failed");
			expect(concurrent.eventIds).toEqual(result.eventIds);
			expect((await ctx.pRespond(request)).eventIds).toEqual(result.eventIds);
			const target = await ctx.pRead(targetOwner, selectedTarget);
			expect(target.revision).toBe(selectedTarget.revision);
			expect(target.data).toEqual(selectedTarget.data);
			const sourceAfter = await ctx.pRead(ctx.sourceOwner);
			expect(sourceAfter.revision).toBe(sourceBefore.revision);
			expect(sourceAfter.data).toEqual(sourceBefore.data);
			const outgoing = await store.pListCharacterOutgoingActions({accountId: ctx.sourceOwner.account.id, campaignId: ctx.campaign.id, characterId: ctx.source.id});
			const visible = outgoing.find(action => action.actionId === proposed.operation.operationId);
			expect(visible).toMatchObject({status: "failed", sourceCostState: "not_consumed", failureCode: "unavailable"});
			expect(JSON.stringify(visible)).not.toContain("\"hp\"");
			expect(JSON.stringify(visible)).not.toContain("\"targetResult\"");
			expect(JSON.stringify(visible)).not.toContain("TARGET_EFFECT_UNAVAILABLE");
			expect(JSON.stringify(visible)).not.toContain("\"changed\"");
			expect(JSON.stringify(visible)).not.toContain("\"resultingCharacterRevision\"");
		});

		it("Lay on Hands self-target retains explicit owner consent and one combined cost/effect", async () => {
			const data = acquiredLayOnHandsData();
			const ctx = await pFixture(store, layOnHands, {sourceData: data});
			const proposed = await ctx.pPropose({target: ctx.source});
			expect(proposed.operation.status).toBe("proposed");
			expect((await ctx.pRead(ctx.sourceOwner)).data.hp.current).toBe(10);
			const applied = await ctx.pRespond({operationId: proposed.operation.operationId, actor: ctx.sourceOwner});
			expect(applied.operation.status).toBe("applied");
			const source = await ctx.pRead(ctx.sourceOwner);
			expect(source.data.hp.current).toBe(14);
			expect(source.data.resources.find(resource => resource.featureRef?.uid === "lay on hands|xphb").current).toBe(1);
		});

		it.each(cases)("$name $source applies one pinned roll, one slot, exact retries and concurrent resolution", async definition => {
			const ctx = await pFixture(store, definition);
			const commandId = crypto.randomUUID();
			const proposed = await ctx.pPropose({commandId});
			expect((await ctx.pRead(ctx.sourceOwner)).data.spellcasting.spellSlots[definition.level].current).toBe(1);
			if (definition.multi) {
				expect(proposed.operation.presentation.tableRules).toMatch(/not checked by the server/);
				expect(proposed.operation.targets[0].presentation.tableRules).toMatch(/consent do not prove eligibility/);
				await expect(ctx.pRespond({operationId: proposed.operation.operationId, invitationId: proposed.operation.targets[1].invitationId})).rejects.toMatchObject({code: "ACTION_NOT_FOUND"});
				await ctx.pRespond({operationId: proposed.operation.operationId, invitationId: proposed.operation.targets[0].invitationId});
				const current = await store.pGetMultiTargetOperation({accountId: ctx.sourceOwner.account.id, campaignId: ctx.campaign.id, operationId: proposed.operation.operationId});
				expect(current.operation.targets[1].status).toBe("pending");
				await ctx.pRespond({operationId: proposed.operation.operationId, invitationId: proposed.operation.targets[1].invitationId, actor: ctx.ownerB});
				const finalizeCommand = crypto.randomUUID();
				const request = {operationId: proposed.operation.operationId, selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId), commandId: finalizeCommand};
				const [first, second] = await Promise.all([ctx.pFinalize(request), ctx.pFinalize(request)]);
				expect(first.eventIds).toEqual(second.eventIds);
				expect(first.operation.status).toBe("applied");
				expect(first.operation.targets.every(target => !target.result)).toBe(true);
				const hpA = (await ctx.pRead(ctx.ownerA, ctx.targets[0])).data.hp.current;
				expect(hpA).toBeGreaterThan(5);
				expect((await ctx.pRead(ctx.ownerB, ctx.targets[1])).data.hp.current).toBe(hpA);
				expect((await ctx.pPropose({commandId})).operation.status).toBe("collecting_responses");
				expect((await store.pGetMultiTargetOperation({accountId: ctx.sourceOwner.account.id, campaignId: ctx.campaign.id, operationId: proposed.operation.operationId})).operation.status).toBe("applied");
			} else {
				const request = {operationId: proposed.operation.operationId, commandId: crypto.randomUUID()};
				const [first, second] = await Promise.all([ctx.pRespond(request), ctx.pRespond(request)]);
				expect(first.eventIds).toEqual(second.eventIds);
				expect(first.operation.status).toBe("applied");
				expect((await ctx.pRead(ctx.ownerA, ctx.targets[0])).data.hp.current).toBeGreaterThan(5);
			}
			expect((await ctx.pRead(ctx.sourceOwner)).data.spellcasting.spellSlots[definition.level].current).toBe(0);
			const events = await store.pListVisibleEvents({accountId: ctx.unrelated.account.id, campaignId: ctx.campaign.id});
			expect(events.filter(event => event.type.includes("operation") || event.type.includes("action"))).toEqual([]);
		});

		it.each(cases)("$name $source rejects or cancels terminally without cost/effect", async definition => {
			const ctx = await pFixture(store, definition);
			const proposed = await ctx.pPropose();
			if (definition.multi) await ctx.pApprove(proposed);
			const result = definition.multi
				? await ctx.pFinalize({operationId: proposed.operation.operationId, selectedInvitationIds: []})
				: await ctx.pRespond({operationId: proposed.operation.operationId, decision: "reject"});
			expect(result.operation.status).toBe(definition.multi ? "cancelled" : "rejected");
			expect((await ctx.pRead(ctx.sourceOwner)).revision).toBe(ctx.source.revision);
			for (let index = 0; index < ctx.targets.length; ++index) expect((await ctx.pRead(index % 2 ? ctx.ownerB : ctx.ownerA, ctx.targets[index])).revision).toBe(ctx.targets[index].revision);
		});

		it.each(cases)("$name $source cannot acquire an unprepared or wrong-edition source", async definition => {
			const unprepared = await pFixture(store, definition, {prepared: false});
			await expect(unprepared.pPropose()).rejects.toMatchObject({code: "SOURCE_OR_TARGET_UNAVAILABLE"});
			const ctx = await pFixture(store, definition);
			await expect(ctx.pPropose({entityOverride: {type: "spell", uid: `${definition.name}|${definition.source === "PHB" ? "XPHB" : "PHB"}`.toLowerCase(), version: definition.source === "PHB" ? "xphb-2024-v1" : "phb-2014-v1"}})).rejects.toMatchObject({code: "SOURCE_OR_TARGET_UNAVAILABLE"});
			expect((await ctx.pRead(ctx.sourceOwner)).revision).toBe(ctx.source.revision);
		});

		it.each(cases)("$name $source rechecks source cost after consent, with no target effect on failure", async definition => {
			const ctx = await pFixture(store, definition);
			const proposed = await ctx.pPropose();
			if (definition.multi) await ctx.pApprove(proposed);
			const commandId = crypto.randomUUID();
			await store.pCreateStructuredAction({
				accountId: ctx.dm.account.id,
				sessionId: ctx.dm.session.id,
				campaignId: ctx.campaign.id,
				targetCharacterId: ctx.source.id,
				commandId,
				protocolVersion: "4",
				operation: {version: 1, kind: "spell_slot.spend", arguments: {level: definition.level, amount: 1}},
				idempotencyKey: idempotency({commandId}),
			});
			const result = definition.multi
				? await ctx.pFinalize({operationId: proposed.operation.operationId, selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId)})
				: await ctx.pRespond({operationId: proposed.operation.operationId});
			expect(result.operation.status).toBe("failed");
			for (let index = 0; index < ctx.targets.length; ++index) expect((await ctx.pRead(index % 2 ? ctx.ownerB : ctx.ownerA, ctx.targets[index])).revision).toBe(ctx.targets[index].revision);
		});

		it.each(cases.filter(definition => definition.multi))("$name $source enforces six and independent subset without charging deselected source-owned leg", async definition => {
			const ctx = await pFixture(store, definition, {targetCount: 7});
			await expect(ctx.pPropose()).rejects.toMatchObject({code: "SOURCE_OR_TARGET_UNAVAILABLE"});
			const proposed = await ctx.pPropose({refs: [ctx.source.targetRef, ...ctx.targets.slice(0, 5).map(target => target.targetRef)]});
			expect(proposed.operation.targets).toHaveLength(6);
			expect(proposed.operation.targets[0].status).toBe("approved_by_source");
			await ctx.pRespond({operationId: proposed.operation.operationId, invitationId: proposed.operation.targets[1].invitationId});
			await ctx.pRespond({operationId: proposed.operation.operationId, invitationId: proposed.operation.targets[2].invitationId, actor: ctx.ownerB, decision: "reject"});
			for (let index = 3; index < proposed.operation.targets.length; ++index) {
				await ctx.pRespond({operationId: proposed.operation.operationId, invitationId: proposed.operation.targets[index].invitationId, actor: (index - 1) % 2 ? ctx.ownerB : ctx.ownerA});
			}
			const applied = await ctx.pFinalize({operationId: proposed.operation.operationId, selectedInvitationIds: [proposed.operation.targets[1].invitationId]});
			expect(applied.operation.status).toBe("applied");
			expect((await ctx.pRead(ctx.sourceOwner)).data.hp.current).toBe(10);
			expect((await ctx.pRead(ctx.sourceOwner)).data.spellcasting.spellSlots[definition.level].current).toBe(0);
			expect((await ctx.pRead(ctx.ownerA, ctx.targets[0])).data.hp.current).toBeGreaterThan(5);
			for (let index = 1; index < ctx.targets.length; ++index) expect((await ctx.pRead(index % 2 ? ctx.ownerB : ctx.ownerA, ctx.targets[index])).data.hp.current).toBe(5);
		});

		it.each(cases.filter(definition => definition.multi))("$name $source no-op is revisionless and private, but consumes exactly one slot", async definition => {
			const ctx = await pFixture(store, definition, {targetCount: 1, full: true});
			const proposed = await ctx.pPropose();
			await ctx.pApprove(proposed);
			const applied = await ctx.pFinalize({operationId: proposed.operation.operationId, selectedInvitationIds: [proposed.operation.targets[0].invitationId]});
			expect(applied.operation.status).toBe("applied");
			expect(applied.operation.targets[0]).not.toHaveProperty("result");
			const target = await ctx.pRead(ctx.ownerA, ctx.targets[0]);
			expect(target.data).toEqual(ctx.targets[0].data);
			expect(target.revision).toBe(ctx.targets[0].revision);
			const detail = await store.pGetMultiTargetOperation({accountId: ctx.ownerA.account.id, campaignId: ctx.campaign.id, operationId: proposed.operation.operationId});
			expect(detail.operation.targets[0].result).toMatchObject({changed: false, resultingCharacterRevision: null});
			expect(detail.operation.targets[0].result).not.toHaveProperty("operationWatermark");
			expect((await ctx.pRead(ctx.sourceOwner)).data.spellcasting.spellSlots[definition.level].current).toBe(0);
			const events = await store.pListVisibleEvents({accountId: ctx.sourceOwner.account.id, campaignId: ctx.campaign.id});
			const targetEvent = events.find(event => event.type === "character.multi_operation.target_applied");
			expect(targetEvent.payload).not.toHaveProperty("changed");
			expect(targetEvent.payload).not.toHaveProperty("resultingCharacterRevision");
		});

		it.each(["private", "move", "member"])(`MHW rejects a selected leg after current target authority becomes %s`, async change => {
			const ctx = await pFixture(store, cases[1]);
			const proposed = await ctx.pPropose();
			await ctx.pApprove(proposed);
			if (change === "private") {
				await store.pSetProjectionPolicy({accountId: ctx.ownerA.account.id, characterId: ctx.targets[0].id, expectedProjectionRevision: ctx.targets[0].projectionRevision, policy: {version: 1, preset: "private", overrides: {}}, idempotencyKey: crypto.randomUUID()});
			} else if (change === "member") {
				await store.pRemoveMember({accountId: ctx.dm.account.id, campaignId: ctx.campaign.id, membershipId: ctx.memberships[1].id, idempotencyKey: crypto.randomUUID()});
			} else {
				const destination = await ctx.pCampaign();
				await ctx.pJoin(ctx.ownerA, destination.campaign);
				await store.pMoveCharacter({accountId: ctx.ownerA.account.id, characterId: ctx.targets[0].id, campaignId: destination.campaign.id, rulesVersionId: destination.rules.id, idempotencyKey: crypto.randomUUID()});
			}
			await expect(ctx.pFinalize({operationId: proposed.operation.operationId, selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId)})).rejects.toMatchObject({code: "FINALIZATION_SELECTION_INVALID"});
			expect((await ctx.pRead(ctx.sourceOwner)).data.spellcasting.spellSlots[3].current).toBe(1);
			expect((await ctx.pRead(ctx.ownerB, ctx.targets[1])).data.hp.current).toBe(5);
		});

		it.each(cases.filter(definition => !definition.multi))("$name $source self still requires explicit singular owner consent", async definition => {
			const ctx = await pFixture(store, definition);
			const proposed = await ctx.pPropose({target: ctx.source});
			expect(proposed.operation.status).toBe("proposed");
			expect((await ctx.pRead(ctx.sourceOwner)).data.hp.current).toBe(10);
			expect((await ctx.pRead(ctx.sourceOwner)).data.spellcasting.spellSlots[1].current).toBe(1);
			const result = await ctx.pRespond({operationId: proposed.operation.operationId, actor: ctx.sourceOwner});
			expect(result.operation.status).toBe("applied");
			expect((await ctx.pRead(ctx.sourceOwner)).data.hp.current).toBeGreaterThan(10);
			expect((await ctx.pRead(ctx.sourceOwner)).data.spellcasting.spellSlots[1].current).toBe(0);
		});
	});
}
