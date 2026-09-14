function getConditionUid ({name, source}) {
	return `${name.trim().toLowerCase()}|${source.trim().toLowerCase()}`;
}

function getConditionsFromBrewDocument (document) {
	if (!document || typeof document !== "object") return [];
	if (Array.isArray(document.condition)) return document.condition;
	if (Array.isArray(document.body?.condition)) return document.body.condition;
	return [];
}

export function getCampaignConditionCatalog ({
	siteData,
	campaignBrewContent = [],
	additionalConditions = [],
}) {
	const out = new Map();
	const conditions = [
		...(Array.isArray(siteData?.condition) ? siteData.condition : []),
		...(Array.isArray(campaignBrewContent)
			? campaignBrewContent.flatMap(getConditionsFromBrewDocument)
			: []),
		...(Array.isArray(additionalConditions)
			? additionalConditions.map(condition => (
				typeof condition === "string"
					? {name: condition, source: "XPHB"}
					: condition
			))
			: []),
	];
	for (const condition of conditions) {
		if (typeof condition?.name !== "string" || !condition.name.trim()) continue;
		if (typeof condition?.source !== "string" || !condition.source.trim()) continue;
		const normalized = {
			name: condition.name.trim(),
			source: condition.source.trim(),
		};
		out.set(getConditionUid(normalized), normalized);
	}
	return [...out.values()].sort((a, b) => (
		a.name.localeCompare(b.name)
		|| a.source.localeCompare(b.source)
	));
}

export async function pLoadCampaignConditionCatalog ({
	campaignBrewContent = [],
	fnFetch = globalThis.fetch,
} = {}) {
	if (typeof fnFetch !== "function") throw new TypeError(`A fetch implementation is required.`);
	const response = await fnFetch("data/conditionsdiseases.json");
	if (!response?.ok) throw new Error(`Condition catalog could not be loaded (${response?.status || "unknown"}).`);
	return getCampaignConditionCatalog({
		siteData: await response.json(),
		campaignBrewContent,
	});
}

export function getCampaignConditionUid (condition) {
	return getConditionUid(condition);
}
