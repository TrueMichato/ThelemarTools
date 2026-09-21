import crypto from "node:crypto";

import {HubStoreError} from "../../../server/src/hub-store-error.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";

export const SOURCE_ENTITY = Object.freeze({
	type: "ability",
	uid: "wave a2 source cost adapter|phb",
	version: "wave-a2-test-v1",
});

export const RESOURCE_IDS = Object.freeze({
	chargeEntry: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
	quantityEntry: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
	featureResource: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
	feature: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
	innateSpell: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
	caseItem: "CaseItem",
	caseItemSibling: "caseitem",
	caseResource: "CaseResource",
	caseResourceSibling: "caseresource",
});

export const ECMASCRIPT_TRIM_VECTORS = Object.freeze([
	["TAB", "\u0009"],
	["VT", "\u000b"],
	["FF", "\u000c"],
	["SPACE", "\u0020"],
	["NBSP", "\u00a0"],
	["BOM", "\ufeff"],
	["CR", "\u000d"],
	["LF", "\u000a"],
	["U+1680", "\u1680"],
	...Array.from({length: 0x200a - 0x2000 + 1}, (_, ix) => {
		const codePoint = 0x2000 + ix;
		return [`U+${codePoint.toString(16).toUpperCase()}`, String.fromCodePoint(codePoint)];
	}),
	["U+2028", "\u2028"],
	["U+2029", "\u2029"],
	["U+202F", "\u202f"],
	["U+205F", "\u205f"],
	["U+3000", "\u3000"],
]);

export const ZERO_QUANTITY_BLOCKER_CASES = Object.freeze([
	{
		label: "inside containedItems",
		mutate: data => data.inventory[0].item.containedItems = [RESOURCE_IDS.quantityEntry],
	},
	{
		label: "seated in iounSet",
		mutate: data => data.inventory[0].item.iounSet = [RESOURCE_IDS.quantityEntry],
	},
	{
		label: "another inventory wrapper containerId",
		mutate: data => data.inventory[0].containerId = ` ${RESOURCE_IDS.quantityEntry.toUpperCase()} `,
	},
	{
		label: "unknown raw UUID object key",
		mutate: data => data.customLinks = {
			[`\u00A0${RESOURCE_IDS.quantityEntry.toUpperCase()}\uFEFF`]: true,
		},
	},
	{
		label: "unknown item-prefixed UUID object key",
		mutate: data => data.customLinks = {
			[`item:\u00A0${RESOURCE_IDS.quantityEntry.toUpperCase()}\uFEFF`]: true,
		},
	},
	{
		label: "selectedAmmo key",
		mutate: data => data.selectedAmmo = {[RESOURCE_IDS.quantityEntry]: "attack"},
	},
	{
		label: "selectedAmmo value",
		mutate: data => data.selectedAmmo = {attack: RESOURCE_IDS.quantityEntry},
	},
	{
		label: "ammunitionConsumed key",
		mutate: data => data.ammunitionConsumed = {[RESOURCE_IDS.quantityEntry]: 1},
	},
	{
		label: "namedModifiers canonical item sourceFeatureId",
		mutate: data => data.namedModifiers = [{
			sourceFeatureId: `item:${RESOURCE_IDS.quantityEntry}`,
			type: "test",
		}],
	},
	{
		label: "acFormulas uppercase item sourceFeatureId",
		mutate: data => data.acFormulas = [{
			sourceFeatureId: `item:${RESOURCE_IDS.quantityEntry.toUpperCase()}`,
			formula: "10",
		}],
	},
	{
		label: "grantedDefensiveTraits padded uppercase item source id",
		mutate: data => data.grantedDefensiveTraits = {
			resistance: {
				fire: [`item:  ${RESOURCE_IDS.quantityEntry.toUpperCase()}  `],
			},
		},
	},
	{
		label: "activeStates itemId",
		mutate: data => data.activeStates = [{customEffects: [{itemId: RESOURCE_IDS.quantityEntry}]}],
	},
	{
		label: "itemGrantedSpells link",
		mutate: data => data.itemGrantedSpells = [{
			name: "Linked Test Spell",
			source: "PHB",
			itemId: RESOURCE_IDS.quantityEntry,
		}],
	},
	{
		label: "spellcasting component link",
		mutate: data => data.spellcasting.spells = [{
			name: "Linked Test Spell",
			source: "PHB",
			componentItemId: RESOURCE_IDS.quantityEntry,
		}],
	},
	{
		label: "iounBonds key",
		mutate: data => data.iounBonds = {[RESOURCE_IDS.quantityEntry]: {bonded: true}},
	},
]);

export const UNKNOWN_WRAPPER_FIELD_CASES = Object.freeze([
	{label: "null", field: "unknownNull", benign: null, unsafe: 1},
	{label: "false", field: "unknownBoolean", benign: false, unsafe: true},
	{label: "empty string", field: "unknownString", benign: "", unsafe: "metadata"},
	{label: "empty array", field: "unknownArray", benign: [], unsafe: ["metadata"]},
	{label: "empty object", field: "unknownObject", benign: {}, unsafe: {metadata: true}},
]);

const STANDARD_SLOT = Object.freeze({
	kind: "spell_slot",
	pool: "standard",
	level: 2,
	amount: 1,
});
const PACT_SLOT = Object.freeze({
	kind: "spell_slot",
	pool: "pact",
	level: 3,
	amount: 1,
});
const ITEM_CHARGE = Object.freeze({
	kind: "item_charge",
	inventoryEntryId: RESOURCE_IDS.chargeEntry,
	itemRef: Object.freeze({uid: "wand of authority|phb"}),
	amount: 2,
});
const INVENTORY_QUANTITY = Object.freeze({
	kind: "inventory_quantity",
	inventoryEntryId: RESOURCE_IDS.quantityEntry,
	itemRef: Object.freeze({uid: "authority ration|phb"}),
	amount: 2,
});
const FEATURE_USE = Object.freeze({
	kind: "feature_use",
	resourceId: RESOURCE_IDS.featureResource,
	featureRef: Object.freeze({uid: "authority blessing|phb"}),
	amount: 1,
});
const CASE_ITEM_CHARGE = Object.freeze({
	kind: "item_charge",
	inventoryEntryId: RESOURCE_IDS.caseItem,
	itemRef: Object.freeze({uid: "case authority focus|phb"}),
	amount: 1,
});
const CASE_ITEM_QUANTITY = Object.freeze({
	kind: "inventory_quantity",
	inventoryEntryId: RESOURCE_IDS.caseItem,
	itemRef: Object.freeze({uid: "case authority focus|phb"}),
	amount: 1,
});
const CASE_FEATURE_USE = Object.freeze({
	kind: "feature_use",
	resourceId: RESOURCE_IDS.caseResource,
	featureRef: Object.freeze({uid: "case authority blessing|phb"}),
	amount: 1,
});

export const COST_CASES = Object.freeze([
	{
		label: "standard spell slot",
		templateId: "test.wave-a2.standard-slot",
		sourceCost: {version: 1, components: [STANDARD_SLOT]},
	},
	{
		label: "pact spell slot",
		templateId: "test.wave-a2.pact-slot",
		sourceCost: {version: 1, components: [PACT_SLOT]},
	},
	{
		label: "item charge",
		templateId: "test.wave-a2.item-charge",
		sourceCost: {version: 1, components: [ITEM_CHARGE]},
	},
	{
		label: "inventory quantity",
		templateId: "test.wave-a2.inventory-quantity",
		sourceCost: {version: 1, components: [INVENTORY_QUANTITY]},
	},
	{
		label: "feature use",
		templateId: "test.wave-a2.feature-use",
		sourceCost: {version: 1, components: [FEATURE_USE]},
	},
	{
		label: "case-distinct non-UUID item charge",
		templateId: "test.wave-a2.case-item-charge",
		sourceCost: {version: 1, components: [CASE_ITEM_CHARGE]},
	},
	{
		label: "case-distinct non-UUID inventory quantity",
		templateId: "test.wave-a2.case-item-quantity",
		sourceCost: {version: 1, components: [CASE_ITEM_QUANTITY]},
	},
	{
		label: "case-distinct non-UUID feature use",
		templateId: "test.wave-a2.case-feature-use",
		sourceCost: {version: 1, components: [CASE_FEATURE_USE]},
	},
	{
		label: "multi-component source cost",
		templateId: "test.wave-a2.multi-component",
		sourceCost: {
			version: 1,
			components: [
				FEATURE_USE,
				INVENTORY_QUANTITY,
				ITEM_CHARGE,
				PACT_SLOT,
				STANDARD_SLOT,
			],
		},
	},
]);

function normalizeEmptyChoice (choice) {
	if (
		!choice
		|| typeof choice !== "object"
		|| Array.isArray(choice)
		|| Object.keys(choice).length
	) throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
	return {};
}

export function createSourceCostAdapterRegistry () {
	return createSemanticOperationRegistry({
		templates: COST_CASES.map(({templateId, sourceCost}) => ({
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: templateId,
			sourceCostVersion: 1,
			display: {label: `Wave A2 ${templateId}`},
			normalizeChoice: normalizeEmptyChoice,
			buildSourceCost: () => structuredClone(sourceCost),
			deriveOperation: () => ({kind: "hp.heal", arguments: {amount: 1}}),
			targetFootprint: () => ["hp"],
		})),
	});
}

export function getSourceCharacterData ({
	standardSlots = 3,
	pactSlots = 2,
	hpCurrent = 12,
} = {}) {
	return {
		name: "Aster",
		abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10},
		abilityBonuses: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0},
		classes: [],
		hp: {current: hpCurrent, max: 20, temp: 0},
		conditions: [],
		features: [{
			name: "Wave A2 Source Cost Adapter",
			source: "PHB",
			metadata: {authority: "server-owned"},
		}, {
			id: RESOURCE_IDS.feature,
			name: "Authority Blessing",
			source: "PHB",
			resourceId: RESOURCE_IDS.featureResource,
			uses: {current: 3, max: 3},
			metadata: {preserve: "feature"},
		}, {
			id: "CaseFeature",
			name: "Case Authority Blessing",
			source: "PHB",
			resourceId: RESOURCE_IDS.caseResource,
			uses: {current: 2, max: 2},
			metadata: {preserve: "case feature"},
		}, {
			id: "casefeature",
			name: "Case Authority Blessing",
			source: "PHB",
			resourceId: RESOURCE_IDS.caseResourceSibling,
			uses: {current: 2, max: 2},
			metadata: {preserve: "case sibling feature"},
		}],
		resources: [{
			id: RESOURCE_IDS.featureResource,
			featureId: RESOURCE_IDS.feature,
			linkedInnateSpellId: RESOURCE_IDS.innateSpell,
			featureRef: {uid: "authority blessing|phb"},
			current: 3,
			max: 3,
			reset: "long",
			metadata: {preserve: "resource"},
		}, {
			id: RESOURCE_IDS.caseResource,
			featureId: "CaseFeature",
			linkedInnateSpellId: "CaseInnate",
			featureRef: {uid: "case authority blessing|phb"},
			current: 2,
			max: 2,
			metadata: {preserve: "case resource"},
		}, {
			id: RESOURCE_IDS.caseResourceSibling,
			featureId: "casefeature",
			linkedInnateSpellId: "caseinnate",
			featureRef: {uid: "case authority blessing|phb"},
			current: 2,
			max: 2,
			metadata: {preserve: "case sibling resource"},
		}],
		inventory: [{
			id: RESOURCE_IDS.chargeEntry,
			item: {
				name: "Wand of Authority",
				source: "PHB",
				charges: 5,
				chargesCurrent: 4,
				containedItems: [],
				iounSet: [],
				customMetadata: {preserve: "charged item"},
			},
			quantity: 1,
			equipped: false,
			attuned: false,
			note: "Keep charge-row metadata",
		}, {
			id: RESOURCE_IDS.quantityEntry,
			item: {
				name: "Authority Ration",
				source: "PHB",
				containedItems: [],
				iounSet: [],
				customMetadata: {preserve: "quantity item"},
			},
			quantity: 4,
			equipped: false,
			attuned: false,
			note: "Keep quantity-row metadata",
		}, {
			id: RESOURCE_IDS.caseItem,
			item: {
				name: "Case Authority Focus",
				source: "PHB",
				charges: 2,
				chargesCurrent: 2,
				containedItems: [],
				iounSet: [],
			},
			quantity: 1,
			equipped: false,
			attuned: false,
		}, {
			id: RESOURCE_IDS.caseItemSibling,
			item: {
				name: "Case Authority Focus",
				source: "PHB",
				charges: 2,
				chargesCurrent: 2,
				containedItems: [],
				iounSet: [],
			},
			quantity: 1,
			equipped: false,
			attuned: false,
		}],
		spellcasting: {
			spellsKnown: [],
			cantripsKnown: [],
			spellSlots: {
				2: {current: standardSlots, max: 3, metadata: {preserve: "standard slot"}},
			},
			pactSlots: {
				current: pactSlots,
				max: 2,
				level: 3,
				metadata: {preserve: "pact slot"},
			},
			innateSpells: [{
				id: RESOURCE_IDS.innateSpell,
				name: "Authority Blessing",
				source: "PHB",
				resourceId: RESOURCE_IDS.featureResource,
				uses: {current: 3, max: 3},
				metadata: {preserve: "innate mirror"},
			}, {
				id: "CaseInnate",
				name: "Case Authority Blessing",
				source: "PHB",
				resourceId: RESOURCE_IDS.caseResource,
				uses: {current: 2, max: 2},
			}, {
				id: "caseinnate",
				name: "Case Authority Blessing",
				source: "PHB",
				resourceId: RESOURCE_IDS.caseResourceSibling,
				uses: {current: 2, max: 2},
			}],
		},
	};
}

export function getTargetCharacterData ({name = "Bryn", hpCurrent = 5} = {}) {
	return {
		name,
		abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
		abilityBonuses: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0},
		classes: [],
		features: [],
		hp: {current: hpCurrent, max: 20, temp: 0},
		conditions: [],
		inventory: [],
		spellcasting: {
			spellsKnown: [],
			cantripsKnown: [],
			innateSpells: [],
			spellSlots: {},
			pactSlots: {current: 0, max: 0, level: 0},
		},
	};
}

export function getExpectedSourceDataAfterCost ({templateId, data}) {
	const expected = structuredClone(data);
	switch (templateId) {
		case "test.wave-a2.standard-slot":
			expected.spellcasting.spellSlots[2].current--;
			break;
		case "test.wave-a2.pact-slot":
			expected.spellcasting.pactSlots.current--;
			break;
		case "test.wave-a2.item-charge":
			expected.inventory[0].item.chargesCurrent -= 2;
			break;
		case "test.wave-a2.inventory-quantity":
			expected.inventory[1].quantity -= 2;
			break;
		case "test.wave-a2.feature-use":
			expected.resources[0].current--;
			expected.features[1].uses.current--;
			expected.spellcasting.innateSpells[0].uses.current--;
			break;
		case "test.wave-a2.case-item-charge":
			expected.inventory[2].item.chargesCurrent--;
			break;
		case "test.wave-a2.case-item-quantity":
			expected.inventory.splice(2, 1);
			break;
		case "test.wave-a2.case-feature-use":
			expected.resources[1].current--;
			expected.features[2].uses.current--;
			expected.spellcasting.innateSpells[1].uses.current--;
			break;
		case "test.wave-a2.multi-component":
			expected.spellcasting.spellSlots[2].current--;
			expected.spellcasting.pactSlots.current--;
			expected.inventory[0].item.chargesCurrent -= 2;
			expected.inventory[1].quantity -= 2;
			expected.resources[0].current--;
			expected.features[1].uses.current--;
			expected.spellcasting.innateSpells[0].uses.current--;
			break;
		default: throw new Error(`Unhandled test template ${templateId}`);
	}
	return expected;
}

function getIdempotency (commandId, request) {
	return {
		key: commandId,
		requestHash: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
	};
}

export async function pCreateSourceCostAdapterScenario ({
	store,
	sameCharacter = false,
	sourceData = getSourceCharacterData(),
	targetData = getTargetCharacterData(),
} = {}) {
	const pCreateActor = async label => {
		const account = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `${label}-${crypto.randomUUID()}`,
			displayName: label,
		});
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
		});
		return {account, session};
	};
	const dm = await pCreateActor("Wave A2 DM");
	const sourceOwner = await pCreateActor("Wave A2 source");
	const targetOwner = sameCharacter ? sourceOwner : await pCreateActor("Wave A2 target");
	const campaign = (await store.pCreateCampaign({
		accountId: dm.account.id,
		name: `Wave A2 source costs ${crypto.randomUUID()}`,
		idempotencyKey: crypto.randomUUID(),
	})).campaign;
	const pJoin = async actor => {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: dm.account.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		return (await store.pRedeemInvite({
			accountId: actor.account.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		})).membership;
	};
	await pJoin(sourceOwner);
	if (!sameCharacter) await pJoin(targetOwner);
	const rulesVersion = (await store.pCreateRulesVersion({
		accountId: dm.account.id,
		campaignId: campaign.id,
		schemaVersion: 1,
		rules: {},
		idempotencyKey: crypto.randomUUID(),
	})).rulesVersion;
	await store.pActivateRulesVersion({
		accountId: dm.account.id,
		campaignId: campaign.id,
		rulesVersionId: rulesVersion.id,
		idempotencyKey: crypto.randomUUID(),
	});
	const source = (await store.pCreateCharacter({
		accountId: sourceOwner.account.id,
		campaignId: campaign.id,
		data: structuredClone(sourceData),
		schemaVersion: 1,
		clientImportId: crypto.randomUUID(),
		idempotencyKey: crypto.randomUUID(),
	})).character;
	const target = sameCharacter
		? source
		: (await store.pCreateCharacter({
			accountId: targetOwner.account.id,
			campaignId: campaign.id,
			data: structuredClone(targetData),
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;

	const pGetSource = async () => (await store.pGetCharacter({
		accountId: sourceOwner.account.id,
		characterId: source.id,
	})).character;
	const pGetTarget = async () => (await store.pGetCharacter({
		accountId: targetOwner.account.id,
		characterId: target.id,
	})).character;
	const pPropose = async ({
		templateId,
		choice = {},
		commandId = crypto.randomUUID(),
	} = {}) => {
		const request = {
			contractVersion: 1,
			commandId,
			sourceCharacterId: source.id,
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: templateId,
			choice,
			targetRef: target.targetRef,
			rulesVersionId: rulesVersion.id,
		};
		return store.pCreateStructuredAction({
			accountId: sourceOwner.account.id,
			sessionId: sourceOwner.session.id,
			campaignId: campaign.id,
			...request,
			protocolVersion: "4",
			idempotencyKey: getIdempotency(commandId, request),
		});
	};
	const pResolve = async ({
		operationId,
		commandId = crypto.randomUUID(),
		decision = "accept",
		requestExtra = {},
	} = {}) => {
		const request = {
			contractVersion: 1,
			commandId,
			operationId,
			decision,
			...requestExtra,
		};
		return store.pResolveStructuredAction({
			accountId: targetOwner.account.id,
			sessionId: targetOwner.session.id,
			campaignId: campaign.id,
			actionId: operationId,
			contractVersion: 1,
			commandId,
			decision,
			protocolVersion: "4",
			idempotencyKey: getIdempotency(commandId, request),
		});
	};
	let sourceLease = null;
	const pPatchSource = async ({patches}) => {
		sourceLease ||= await store.pAcquireCharacterLease({
			accountId: sourceOwner.account.id,
			sessionId: sourceOwner.session.id,
			characterId: source.id,
		});
		const current = await pGetSource();
		return store.pPatchCharacter({
			accountId: sourceOwner.account.id,
			sessionId: sourceOwner.session.id,
			characterId: source.id,
			baseRevision: current.revision,
			leaseEpoch: sourceLease.epoch,
			patches,
			rulesVersionId: rulesVersion.id,
			protocolVersion: "4",
			idempotencyKey: crypto.randomUUID(),
		});
	};

	return {
		store,
		campaign,
		dm,
		sourceOwner,
		targetOwner,
		rulesVersion,
		source,
		target,
		pGetSource,
		pGetTarget,
		pPropose,
		pResolve,
		pPatchSource,
	};
}
