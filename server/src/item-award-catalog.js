import {readFile} from "node:fs/promises";
import {HubStoreError} from "./hub-store-error.js";

const SITE_CATALOG_PATH = new URL("../data/item-award-site-catalog.json", import.meta.url);

let _siteItemsPromise = null;

const COPY_PARENT_ONLY_FIELDS = new Set([
	"page",
	"otherSources",
	"referenceSources",
	"srd",
	"srd52",
	"basicRules",
	"basicRules2024",
	"reprintedAs",
	"hasFluff",
	"hasFluffImages",
	"hasToken",
	"tokenCredit",
	"tokenCustom",
	"foundryTokenScale",
	"altArt",
	"_versions",
	"lootTables",
	"tier",
]);

function getItemUid (item) {
	return `${String(item?.name || "").trim()}|${String(item?.source || "").trim()}`.toLowerCase();
}

function getCampaignItemsByUid (content) {
	if (!Array.isArray(content)) return new Map();
	const items = content.flatMap(document => {
		const body = document?.body || document;
		return [
			...(Array.isArray(body?.item) ? body.item : []),
			...(Array.isArray(body?.baseitem) ? body.baseitem : []),
		];
	});
	const byUid = new Map();
	for (const item of items) {
		const uid = getItemUid(item);
		if (!uid || uid === "|") continue;
		byUid.set(uid, byUid.has(uid) ? null : item);
	}
	return byUid;
}

async function pLoadSiteItems () {
	if (!_siteItemsPromise) {
		_siteItemsPromise = (async () => {
			const catalog = JSON.parse(await readFile(SITE_CATALOG_PATH, "utf8"));
			if (catalog?.version !== 1 || !Array.isArray(catalog.items)) {
				throw new HubStoreError("ITEM_AWARD_CATALOG_INVALID", `Item award catalog is invalid.`, {status: 503});
			}
			const byUid = new Map();
			for (const item of catalog.items) {
				const uid = getItemUid(item);
				if (!uid || uid === "|" || byUid.has(uid)) {
					throw new HubStoreError("ITEM_AWARD_CATALOG_INVALID", `Item award catalog contains an invalid identity.`, {status: 503});
				}
				byUid.set(uid, item);
			}
			return byUid;
		})();
	}
	return _siteItemsPromise;
}

function resolveCampaignItemCopy ({campaignItems, item, siteItems, seen = new Set()}) {
	if (!item._copy) return structuredClone(item);
	if (
		!item._copy
		|| typeof item._copy !== "object"
		|| Array.isArray(item._copy)
		|| Object.keys(item._copy).some(key => !["name", "source"].includes(key))
	) {
		throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Item award source uses unsupported inheritance.`, {status: 409});
	}
	const parentUid = getItemUid(item._copy);
	if (!parentUid || parentUid === "|" || seen.has(parentUid)) {
		throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Item award source inheritance is invalid.`, {status: 409});
	}
	if (campaignItems.has(parentUid) && !campaignItems.get(parentUid)) {
		throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Item award source inheritance is ambiguous.`, {status: 409});
	}
	const campaignParent = campaignItems.get(parentUid);
	const siteParent = siteItems.get(parentUid);
	if (campaignParent && siteParent) {
		throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Campaign item inheritance collides with the site catalog.`, {status: 409});
	}
	const parent = campaignParent || siteParent;
	if (!parent) {
		throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Item award source inheritance could not be resolved.`, {status: 409});
	}
	const parentResolved = resolveCampaignItemCopy({
		campaignItems,
		item: parent,
		siteItems,
		seen: new Set([...seen, parentUid]),
	});
	for (const key of COPY_PARENT_ONLY_FIELDS) delete parentResolved[key];
	const direct = structuredClone(item);
	delete direct._copy;
	return {...parentResolved, ...direct, _isCopy: true};
}

export function createItemAwardAuthorityResolver ({fnLoadSiteItems = pLoadSiteItems} = {}) {
	return async ({sourceKind = "recent", item, brewBundle = null}) => {
		const uid = getItemUid(item);
		if (!uid || uid === "|") {
			throw new HubStoreError("ITEM_AWARD_SOURCE_NOT_FOUND", `Item award source was not found.`, {status: 404});
		}

		const campaignItems = getCampaignItemsByUid(brewBundle?.content);
		const campaignItem = campaignItems.get(uid);
		if (campaignItems.has(uid) && !campaignItem && sourceKind !== "catalog") {
			throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Item award source is ambiguous.`, {status: 409});
		}
		const siteItems = await fnLoadSiteItems();
		const siteItem = siteItems.get(uid);

		if (sourceKind === "campaign_item") {
			if (!campaignItem) {
				throw new HubStoreError("ITEM_AWARD_SOURCE_NOT_FOUND", `Item award source was not found.`, {status: 404});
			}
			if (siteItem) {
				throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Campaign item identity collides with the site catalog.`, {status: 409});
			}
			return {
				sourceKind: "campaign_item",
				authoritativeItem: resolveCampaignItemCopy({campaignItems, item: campaignItem, siteItems, seen: new Set([uid])}),
			};
		}

		if (sourceKind === "recent" && campaignItem && siteItem) {
			throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Recent item authority is ambiguous.`, {status: 409});
		}
		if (sourceKind === "recent" && campaignItem) {
			return {
				sourceKind: "campaign_item",
				authoritativeItem: resolveCampaignItemCopy({campaignItems, item: campaignItem, siteItems, seen: new Set([uid])}),
			};
		}
		if ((sourceKind === "catalog" || sourceKind === "recent") && siteItem) {
			return {
				sourceKind: "catalog",
				authoritativeItem: structuredClone(siteItem),
			};
		}

		if (!siteItem) {
			throw new HubStoreError("ITEM_AWARD_SOURCE_NOT_FOUND", `Item award source was not found.`, {status: 404});
		}
		throw new HubStoreError("ITEM_AWARD_SOURCE_INVALID", `Item award source kind is invalid.`, {status: 409});
	};
}

export function createItemAwardResolver (opts = {}) {
	const resolveAuthority = createItemAwardAuthorityResolver(opts);
	return async args => (await resolveAuthority(args)).authoritativeItem;
}

export function normalizeItemAwardResolution (resolved, {sourceKind}) {
	if (
		resolved
		&& typeof resolved === "object"
		&& resolved.authoritativeItem
		&& ["catalog", "campaign_item"].includes(resolved.sourceKind)
	) {
		return resolved;
	}
	return {
		sourceKind,
		authoritativeItem: resolved,
	};
}

export const resolveItemAwardAuthority = createItemAwardAuthorityResolver();
export const resolveItemAward = createItemAwardResolver();
