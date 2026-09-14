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
	const parent = campaignItems.get(parentUid) || siteItems.get(parentUid);
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

export function createItemAwardResolver ({fnLoadSiteItems = pLoadSiteItems} = {}) {
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
		if (sourceKind === "campaign_item" && campaignItem) {
			const siteItems = campaignItem._copy ? await fnLoadSiteItems() : new Map();
			return resolveCampaignItemCopy({campaignItems, item: campaignItem, siteItems, seen: new Set([uid])});
		}
		if (sourceKind === "recent" && campaignItem) {
			const siteItems = campaignItem._copy ? await fnLoadSiteItems() : new Map();
			return resolveCampaignItemCopy({campaignItems, item: campaignItem, siteItems, seen: new Set([uid])});
		}
		const siteItems = sourceKind === "campaign_item" ? null : await fnLoadSiteItems();
		const resolved = sourceKind === "catalog" || sourceKind === "recent"
			? siteItems.get(uid)
			: null;
		if (!resolved) {
			throw new HubStoreError("ITEM_AWARD_SOURCE_NOT_FOUND", `Item award source was not found.`, {status: 404});
		}
		return structuredClone(resolved);
	};
}

export const resolveItemAward = createItemAwardResolver();
