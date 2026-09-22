import type {EffectCheck, FeatureCheck} from "./comprehensiveBuildHelpers";
import type {StateTransactionStep} from "../pages/CharacterSheetPage";

export const EFA_ARTIFICER_BASE_FEATURE_UIDS = Object.freeze({
	spellcasting: "Spellcasting|Artificer|EFA|1|EFA",
	tinkersMagic: "Tinker's Magic|Artificer|EFA|1|EFA",
	replicateMagicItem: "Replicate Magic Item|Artificer|EFA|2|EFA",
	magicItemTinker: "Magic Item Tinker|Artificer|EFA|6|EFA",
	flashOfGenius: "Flash of Genius|Artificer|EFA|7|EFA",
	magicItemAdept: "Magic Item Adept|Artificer|EFA|10|EFA",
	spellStoringItem: "Spell-Storing Item|Artificer|EFA|11|EFA",
	advancedArtifice: "Advanced Artifice|Artificer|EFA|14|EFA",
	magicItemMaster: "Magic Item Master|Artificer|EFA|18|EFA",
	epicBoon: "Epic Boon|Artificer|EFA|19|EFA",
	soulOfArtifice: "Soul of Artifice|Artificer|EFA|20|EFA",
});

const EFA_REPLICATE_OWNER = Object.freeze({
	featureUid: "Replicate Magic Item|Artificer|EFA|2",
	classUid: "Artificer|EFA",
	subclassUid: null,
	featureSource: "EFA",
});

const ref = (path: string): {$ref: string} => ({$ref: path});
const transaction = (steps: StateTransactionStep[]): EffectCheck => ({
	kind: "stateTransaction",
	steps,
});
const addTinkersToolsStep = (id: string): StateTransactionStep => ({
	method: "addItem",
	args: [{
		id,
		name: "Tinker's Tools",
		source: "TST",
		type: "AT",
	}, 1, true, false],
});

function spellcastingEffects ({
	slotLevel,
	slotMin,
	prepared,
	cantripMin,
	includeFocus = false,
}: {
	slotLevel: number;
	slotMin: number;
	prepared: number;
	cantripMin?: number;
	includeFocus?: boolean;
}): EffectCheck[] {
	return [
		{kind: "spellSlots", level: slotLevel, min: slotMin},
		{kind: "stateCall", method: "getMaxPreparedSpells", args: ["Artificer"], exact: prepared},
		...(cantripMin == null ? [] : [{kind: "cantripCount", min: cantripMin} as EffectCheck]),
		...(includeFocus
			? [{
				kind: "stateTransaction",
				steps: [
					addTinkersToolsStep("e2e-spellcasting-tools"),
					{
						method: "getSpellCastFocusRequirement",
						args: [{sourceClass: {name: "Artificer", source: "EFA"}}],
						saveAs: "focusRequirement",
						expect: [
							{path: "classUid", exact: "Artificer|EFA"},
							{path: "sourceFeatureUid", exact: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting},
						],
					},
					{
						method: "getEligibleSpellCastFocusInventoryRows",
						args: [ref("focusRequirement")],
						expect: [
							{path: "length", min: 1},
							{contains: "e2e-spellcasting-tools"},
						],
					},
				],
			} as EffectCheck]
			: []),
	];
}

function generatedReplicaDescriptor ({
	name,
	rarity,
	type = "W",
	charges = null,
}: {
	name: string;
	rarity: string;
	type?: string;
	charges?: number | null;
}) {
	const itemUid = `${name}|TST`;
	return {
		item: {
			name,
			source: "TST",
			type,
			rarity,
			wondrous: type === "W",
			...(charges == null ? {} : {charges, chargesCurrent: 0}),
		},
		owner: EFA_REPLICATE_OWNER,
		metadata: {
			sourceFeatureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.replicateMagicItem,
			temporary: true,
		},
		catalog: {
			plan: {
				slotId: `e2e-${name.toLowerCase().replace(/\W+/g, "-")}`,
				selection: {name, source: "TST", planUid: itemUid, itemUid},
			},
			resolvedItem: {name, source: "TST", itemUid},
		},
		creation: {
			order: 100,
			receiptId: `e2e-receipt-${name.toLowerCase().replace(/\W+/g, "-")}`,
			event: "e2e-probe",
			batchId: "e2e-base-artificer",
		},
		lifecycle: {
			version: 1,
			state: "active",
			deathExpiryDaysRemaining: null,
			deathExpiryAssignedReceiptId: null,
			expiryRecords: [],
			callbacks: {
				onLongRest: "retain",
				onDeath: "expire-after-1d4-days",
				onLifecycleDay: "decrement-expiry",
			},
			metadata: {},
		},
	};
}

function replicateProductionEffect (): EffectCheck {
	return transaction([
		addTinkersToolsStep("e2e-replicate-tools"),
		{
			method: "getEfaReplicateMagicItemProductionOptions",
			saveAs: "replicateOptions",
			expect: [
				{path: "available", exact: true},
				{path: "plans.length", min: 1},
			],
		},
		{
			method: "commitEfaReplicateMagicItemsAtLongRest",
			args: [{
				selections: [{
					slotId: ref("replicateOptions.plans.0.plan.slotId"),
					resolvedItemUid: ref("replicateOptions.plans.0.options.0.itemUid"),
				}],
			}],
			expect: [
				{path: "ok", exact: true},
				{path: "code", exact: "replicate-production-committed"},
				{path: "created.length", exact: 1},
			],
		},
		{
			method: "getGeneratedFeatureItemRows",
			args: [EFA_REPLICATE_OWNER],
			expect: [{path: "length", min: 1}],
		},
	]);
}

function tinkersMagicEffect (): EffectCheck {
	return transaction([
		addTinkersToolsStep("e2e-tinkers-magic-tools"),
		{
			method: "commitEfaArtificerTinkerTransaction",
			args: [{operation: "tinkersMagic", itemUid: "Basket|XPHB"}],
			expect: [
				{path: "ok", exact: true},
				{path: "code", exact: "efa-tinker-committed"},
				{path: "created.itemId", truthy: true},
			],
		},
		{method: "getGeneratedFeatureItemRows", args: [{
			featureUid: "Tinker's Magic|Artificer|EFA|1",
			classUid: "Artificer|EFA",
			subclassUid: null,
			featureSource: "EFA",
		}], expect: [{path: "length", min: 1}]},
		{method: "onLongRest"},
		{method: "getGeneratedFeatureItemRows", args: [{
			featureUid: "Tinker's Magic|Artificer|EFA|1",
			classUid: "Artificer|EFA",
			subclassUid: null,
			featureSource: "EFA",
		}], expect: [{path: "length", exact: 0}]},
	]);
}

function chargeMagicItemEffect (): EffectCheck {
	return transaction([
		addTinkersToolsStep("e2e-charge-tools"),
		{
			method: "createGeneratedFeatureItem",
			args: [generatedReplicaDescriptor({name: "E2E Charge Vessel", rarity: "common", charges: 3})],
			saveAs: "chargeItem",
			expect: [{path: "ok", exact: true}],
		},
		{method: "setSpellSlotCurrent", args: [1, 1]},
		{
			method: "commitEfaArtificerTinkerTransaction",
			args: [{
				operation: "charge",
				itemId: ref("chargeItem.itemId"),
				slotLevel: 1,
				slotPool: "ordinary",
			}],
			expect: [
				{path: "ok", exact: true},
				{path: "code", exact: "efa-tinker-committed"},
				{path: "charge.next", exact: 1},
			],
		},
		{
			method: "getItemRaw",
			args: [ref("chargeItem.itemId")],
			expect: [{path: "chargesCurrent", exact: 1}],
		},
	]);
}

function drainMagicItemEffect (): EffectCheck {
	return transaction([
		addTinkersToolsStep("e2e-drain-tools"),
		{
			method: "createGeneratedFeatureItem",
			args: [generatedReplicaDescriptor({name: "E2E Drain Vessel", rarity: "uncommon"})],
			saveAs: "drainItem",
			expect: [{path: "ok", exact: true}],
		},
		{method: "getSpellSlotsMax", args: [2], saveAs: "drainSlotsBefore"},
		{
			method: "commitEfaArtificerTinkerTransaction",
			args: [{operation: "drain", itemId: ref("drainItem.itemId")}],
			expect: [
				{path: "ok", exact: true},
				{path: "code", exact: "efa-tinker-committed"},
				{path: "drain.slotLevel", exact: 2},
			],
		},
		{
			method: "getSpellSlotsMax",
			args: [2],
			expect: [{equalsRef: "drainSlotsBefore", delta: 1}],
		},
		{
			method: "getItemRaw",
			args: [ref("drainItem.itemId")],
			expect: [{isNull: true}],
		},
	]);
}

function transmuteMagicItemEffect (): EffectCheck {
	return transaction([
		addTinkersToolsStep("e2e-transmute-tools"),
		{
			method: "getEfaReplicateMagicItemProductionOptions",
			saveAs: "transmuteOptions",
			expect: [
				{path: "available", exact: true},
				{path: "plans.length", min: 1},
			],
		},
		{
			method: "createGeneratedFeatureItem",
			args: [generatedReplicaDescriptor({name: "E2E Transmute Vessel", rarity: "common"})],
			saveAs: "transmuteItem",
			expect: [{path: "ok", exact: true}],
		},
		{
			method: "commitEfaArtificerTinkerTransaction",
			args: [{
				operation: "transmute",
				itemId: ref("transmuteItem.itemId"),
				targetPlanSlotId: ref("transmuteOptions.plans.0.plan.slotId"),
				resolvedItemUid: ref("transmuteOptions.plans.0.options.0.itemUid"),
			}],
			saveAs: "transmuted",
			expect: [
				{path: "ok", exact: true},
				{path: "code", exact: "efa-tinker-committed"},
				{path: "transmute.itemId", truthy: true},
			],
		},
		{
			method: "getItemRaw",
			args: [ref("transmuted.transmute.itemId")],
			expect: [{path: "name", equalsRef: "transmuteOptions.plans.0.options.0.name"}],
		},
	]);
}

function flashOfGeniusEffect (): EffectCheck {
	return transaction([
		{
			method: "_ensureEfaFlashOfGeniusResource",
			saveAs: "flashBefore",
			expect: [{path: "current", min: 1}],
		},
		{method: "getAbilityMod", args: ["int"], saveAs: "intMod"},
		{
			method: "pUseFlashOfGenius",
			args: [{rollType: "abilityCheck", isFailed: true, rollTotal: 8, targetType: "self"}],
			expect: [
				{path: "ok", exact: true},
				{path: "committed", exact: true},
				{path: "remainingUses", equalsRef: "flashBefore.current", delta: -1},
				{path: "result.bonus", equalsRef: "intMod"},
			],
		},
		{method: "onLongRest"},
		{
			method: "_ensureEfaFlashOfGeniusResource",
			saveAs: "flashAfterRest",
			expect: [{path: "current", equalsRef: "flashAfterRest.max"}],
		},
	]);
}

function refreshedGeniusEffect (): EffectCheck {
	return transaction([
		{method: "_ensureEfaFlashOfGeniusResource", saveAs: "flash"},
		{method: "setResourceCurrent", args: [ref("flash.id"), 0]},
		{method: "onShortRest"},
		{
			method: "_ensureEfaFlashOfGeniusResource",
			expect: [{path: "current", exact: 1}],
		},
	]);
}

function spellStoringItemEffect (): EffectCheck {
	return transaction([
		{
			method: "addItem",
			args: [{
				id: "e2e-spell-storage-host",
				name: "E2E Spell-Storing Longsword",
				source: "TST",
				type: "M",
				weapon: true,
				weaponCategory: "martial",
			}, 1, true, false],
		},
		{
			method: "getEfaSpellStoringItemOptions",
			saveAs: "storageOptions",
			expect: [
				{path: "available", exact: true},
				{path: "classUid", exact: "Artificer|EFA"},
				{path: "hosts.length", min: 1},
				{path: "spells.length", min: 1},
			],
		},
		{
			method: "commitEfaSpellStoringItemAtLongRest",
			args: [{
				hostItemId: "e2e-spell-storage-host",
				spellUid: ref("storageOptions.spells.0.spellUid"),
			}],
			saveAs: "stored",
			expect: [
				{path: "ok", exact: true},
				{path: "committed", exact: true},
				{path: "storage.featureUid", exact: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellStoringItem},
				{path: "storage.ownerClassUid", exact: "Artificer|EFA"},
				{path: "storage.usesCurrent", min: 2},
			],
		},
		{method: "getEfaSpellStoringItemSelfHolder", saveAs: "holder"},
		{
			method: "reserveEfaSpellStoringItemUse",
			args: [{itemId: ref("stored.itemId"), holder: ref("holder")}],
			saveAs: "reservation",
			expect: [
				{path: "ok", exact: true},
				{path: "reservation.id", truthy: true},
			],
		},
		{
			method: "commitEfaSpellStoringItemUse",
			args: [{
				itemId: ref("stored.itemId"),
				holder: ref("holder"),
				reservationId: ref("reservation.reservation.id"),
			}],
			expect: [
				{path: "ok", exact: true},
				{path: "committed", exact: true},
			],
		},
		{
			method: "getEfaSpellStoringItem",
			expect: [{path: "storage.usesCurrent", equalsRef: "stored.storage.usesCurrent", delta: -1}],
		},
	]);
}

function magicalGuidanceEffect (): EffectCheck {
	return transaction([
		{
			method: "addItem",
			args: [{
				id: "e2e-guidance-ring",
				name: "E2E Guidance Ring",
				source: "TST",
				type: "RG",
				rarity: "uncommon",
				requiresAttunement: true,
			}, 1, false, false],
		},
		{method: "setItemAttuned", args: ["e2e-guidance-ring", true]},
		{method: "_ensureEfaFlashOfGeniusResource", saveAs: "guidanceFlash"},
		{method: "setResourceCurrent", args: [ref("guidanceFlash.id"), 0]},
		{method: "onShortRest"},
		{
			method: "_ensureEfaFlashOfGeniusResource",
			saveAs: "guidanceAfter",
			expect: [{path: "current", equalsRef: "guidanceAfter.max"}],
		},
	]);
}

function cheatDeathEffect (): EffectCheck {
	return transaction([
		{
			method: "createGeneratedFeatureItem",
			args: [generatedReplicaDescriptor({name: "E2E Cheat Death Vessel", rarity: "uncommon"})],
			saveAs: "cheatDeathItem",
			expect: [{path: "ok", exact: true}],
		},
		{method: "setMaxHp", args: [100]},
		{method: "setCurrentHp", args: [10]},
		{method: "takeDamage", args: [10], expect: [{exact: true}]},
		{
			method: "applyZeroHpIntervention",
			args: ["efaArtificerCheatDeath", {selectedItemIds: [ref("cheatDeathItem.itemId")]}],
			expect: [
				{path: "applied", exact: true},
				{path: "success", exact: true},
				{path: "selectedCount", exact: 1},
				{path: "hp", exact: 20},
			],
		},
		{method: "getCurrentHp", expect: [{exact: 20}]},
		{
			method: "getItemRaw",
			args: [ref("cheatDeathItem.itemId")],
			expect: [{isNull: true}],
		},
	]);
}

/**
 * Source-safe base EFA Artificer feature matrix.
 *
 * This deliberately omits every subclass feature. A future accepted EFA
 * subclass spec should spread these rows into its own matrix and add all
 * subclass rows separately.
 */
export function buildEfaArtificerBaseChecks (): FeatureCheck[] {
	return [
		{
			level: 1,
			untilLevel: 1,
			name: /^Spellcasting$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting,
			kind: "passive",
			effects: spellcastingEffects({slotLevel: 1, slotMin: 2, prepared: 2, cantripMin: 3, includeFocus: true}),
		},
		{
			level: 1,
			name: /^Tinker's Magic$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.tinkersMagic,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Mending"},
				{kind: "featureCalculationDerivedFrom", property: "tinkersMagicUses", equals: "abilityMod", ability: "int"},
				tinkersMagicEffect(),
			],
		},
		{
			level: 2,
			untilLevel: 5,
			name: /^Replicate Magic Item$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.replicateMagicItem,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "artificerPlansKnown", exact: 4},
				{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 2},
				replicateProductionEffect(),
			],
		},
		{
			level: 5,
			untilLevel: 5,
			name: /^Spellcasting$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting,
			kind: "passive",
			effects: spellcastingEffects({slotLevel: 2, slotMin: 2, prepared: 6}),
		},
		{
			level: 6,
			untilLevel: 9,
			name: /^Replicate Magic Item$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.replicateMagicItem,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "artificerPlansKnown", exact: 5},
				{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 3},
			],
		},
		{
			level: 6,
			name: /^Magic Item Tinker$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.magicItemTinker,
			kind: "passive",
			effects: [
				chargeMagicItemEffect(),
				drainMagicItemEffect(),
				transmuteMagicItemEffect(),
			],
		},
		{
			level: 7,
			name: /^Flash of Genius$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.flashOfGenius,
			kind: "resource",
			resourceName: "Flash of Genius",
			restoreOn: "long",
			effects: [
				{kind: "featureUsesEqualAbilityMod", feature: "Flash of Genius", ability: "int", minimum: 1, recharge: "long"},
				flashOfGeniusEffect(),
			],
		},
		{
			level: 9,
			untilLevel: 9,
			name: /^Spellcasting$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting,
			kind: "passive",
			effects: spellcastingEffects({slotLevel: 3, slotMin: 2, prepared: 9}),
		},
		{
			level: 10,
			untilLevel: 13,
			name: /^Replicate Magic Item$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.replicateMagicItem,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "artificerPlansKnown", exact: 6},
				{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 4},
			],
		},
		{
			level: 10,
			untilLevel: 13,
			name: /^Spellcasting$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting,
			kind: "passive",
			effects: [{kind: "cantripCount", min: 4}],
		},
		{
			level: 10,
			untilLevel: 13,
			name: /^Magic Item Adept$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.magicItemAdept,
			kind: "passive",
			effects: [
				{kind: "attunementCap", exact: 4},
				{
					kind: "stateCall",
					method: "getCraftingTimeCalculation",
					args: [{
						baseWorkweeks: 4,
						recipe: {name: "E2E Common Item", recipeCategory: "item", itemType: "G", rarity: "common"},
					}],
					path: "effectiveWorkweeks",
					exact: 1,
				},
			],
		},
		{
			level: 11,
			name: /^Spell-Storing Item$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellStoringItem,
			kind: "passive",
			effects: [
				{kind: "featureCalculationDerivedFrom", property: "spellStoringItemUses", equals: "abilityMod", ability: "int", multiplier: 2},
				spellStoringItemEffect(),
			],
		},
		{
			level: 13,
			untilLevel: 13,
			name: /^Spellcasting$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting,
			kind: "passive",
			effects: spellcastingEffects({slotLevel: 4, slotMin: 1, prepared: 11}),
		},
		{
			level: 14,
			untilLevel: 17,
			name: /^Replicate Magic Item$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.replicateMagicItem,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "artificerPlansKnown", exact: 7},
				{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 5},
			],
		},
		{
			level: 14,
			name: /^Spellcasting$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting,
			kind: "passive",
			effects: [{kind: "cantripCount", min: 5}],
		},
		{
			level: 14,
			untilLevel: 17,
			name: /^Advanced Artifice$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.advancedArtifice,
			kind: "passive",
			effects: [
				{kind: "attunementCap", exact: 5},
				refreshedGeniusEffect(),
			],
		},
		{
			level: 17,
			untilLevel: 17,
			name: /^Spellcasting$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting,
			kind: "passive",
			effects: spellcastingEffects({slotLevel: 5, slotMin: 1, prepared: 14}),
		},
		{
			level: 18,
			name: /^Replicate Magic Item$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.replicateMagicItem,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "artificerPlansKnown", exact: 8},
				{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 6},
			],
		},
		{
			level: 18,
			name: /^Magic Item Master$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.magicItemMaster,
			kind: "passive",
			effects: [{kind: "attunementCap", exact: 6}],
		},
		{
			level: 19,
			name: /^Epic Boon$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.epicBoon,
			kind: "passive",
			// no measurable derived effect: the base feature only opens a feat choice;
			// the future subclass spec must probe the exact Epic Boon it accepts.
			effectReason: "The base feature only opens a feat choice; the consuming subclass spec owns the chosen Epic Boon's mechanics.",
		},
		{
			level: 20,
			name: /^Spellcasting$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.spellcasting,
			kind: "passive",
			effects: spellcastingEffects({slotLevel: 5, slotMin: 2, prepared: 15}),
		},
		{
			level: 20,
			name: /^Soul of Artifice$/i,
			featureUid: EFA_ARTIFICER_BASE_FEATURE_UIDS.soulOfArtifice,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasEfaSoulOfArtifice", exact: true},
				{kind: "featureCalculation", property: "hasMagicalGuidance", exact: true},
				magicalGuidanceEffect(),
				cheatDeathEffect(),
			],
		},
	];
}
