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

export function buildHubItemCatalog ({items = {}, baseItems = {}, campaignBrewContent = null} = {}) {
	const byUid = new Map();
	for (const item of [
		...getItemRefs(items),
		...getItemRefs(baseItems),
		...getCampaignItems(campaignBrewContent),
	]) {
		const name = typeof item?.name === "string" ? item.name.trim() : "";
		const source = typeof item?.source === "string" ? item.source.trim() : "";
		if (!name || !source) continue;
		const uid = `${name}|${source}`.toLowerCase();
		if (!byUid.has(uid)) byUid.set(uid, {name, source});
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
