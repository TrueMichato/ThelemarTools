function getItemRefs (data) {
	return [
		...(Array.isArray(data?.item) ? data.item : []),
		...(Array.isArray(data?.baseitem) ? data.baseitem : []),
	];
}

function getCampaignItems (content) {
	if (!Array.isArray(content)) return [];
	return content.flatMap(document => getItemRefs(document?.body || document));
}

const ITEM_STRING_FIELDS = Object.freeze(["rarity", "typeCode"]);
const ITEM_NUMBER_FIELDS = Object.freeze(["page", "weight", "value"]);

export function getHubItemSummary (item, {sourceKind = "catalog"} = {}) {
	const name = typeof item?.name === "string" ? item.name.trim() : "";
	const source = typeof item?.source === "string" ? item.source.trim() : "";
	if (!name || !source) return null;
	const out = {name, source, sourceKind};
	for (const key of ITEM_STRING_FIELDS) {
		const value = key === "typeCode" ? item?.typeCode ?? item?.type : item?.[key];
		if (typeof value === "string" && value.trim()) out[key] = value.trim();
	}
	for (const key of ITEM_NUMBER_FIELDS) {
		const value = Number(item?.[key]);
		if (Number.isFinite(value) && value >= 0) out[key] = value;
	}
	if (["classic", "one"].includes(item?.edition)) out.edition = item.edition;
	return out;
}

export function buildHubItemCatalog ({items = {}, baseItems = {}, campaignBrewContent = null} = {}) {
	const byUid = new Map();
	for (const [sourceKind, entries] of [
		["catalog", [...getItemRefs(items), ...getItemRefs(baseItems)]],
		["campaign_item", getCampaignItems(campaignBrewContent)],
	]) {
		for (const item of entries) {
			const summary = getHubItemSummary(item, {sourceKind});
			if (!summary) continue;
			const uid = `${summary.name}|${summary.source}`.toLowerCase();
			if (!byUid.has(uid)) byUid.set(uid, summary);
		}
	}
	return [...byUid.values()]
		.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

async function pFetchJson ({url, fnFetch}) {
	const response = await fnFetch(url, {credentials: "same-origin"});
	if (!response.ok) throw new Error(`Could not load ${url}.`);
	return response.json();
}

export async function pLoadHubItemCatalog ({campaignBrewContent = null, fnFetch = fetch} = {}) {
	const [items, baseItems] = await Promise.all([
		pFetchJson({url: "data/items.json", fnFetch}),
		pFetchJson({url: "data/items-base.json", fnFetch}),
	]);
	return buildHubItemCatalog({items, baseItems, campaignBrewContent});
}
