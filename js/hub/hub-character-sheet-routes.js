import {isActiveCampaignUuid} from "./hub-active-campaign-record.js";

export const CHARACTER_SHEET_RETURN_CAMPAIGN_PARAM = "returnHubCampaign";
export const CHARACTER_SHEET_RETURN_CHARACTER_PARAM = "returnHubCharacter";

function getRelativeCharacterSheetUrl (url) {
	return `${url.pathname.split("/").pop()}${url.search}${url.hash}`;
}

function getUrl (href) {
	try {
		return new URL(href, "https://tools.invalid/");
	} catch {
		return null;
	}
}

export function getCampaignCharacterSheetUrl ({campaignId, characterId = null}) {
	if (typeof campaignId !== "string" || !campaignId) throw new TypeError(`campaignId must be a non-empty string.`);
	const parts = [];
	if (characterId != null) {
		if (typeof characterId !== "string" || !characterId) throw new TypeError(`characterId must be a non-empty string or null.`);
		parts.push(`id=${encodeURIComponent(characterId)}`);
	}
	parts.push(`hubCampaign=${encodeURIComponent(campaignId)}`);
	return `charactersheet.html?${parts.join("&")}`;
}

export function getDetachedCloudCharacterSheetUrl ({characterId}) {
	if (typeof characterId !== "string" || !characterId) throw new TypeError(`characterId must be a non-empty string.`);
	return `charactersheet.html?id=${encodeURIComponent(characterId)}&hubCharacter=1`;
}

export function getLocalCharacterSheetUrl ({
	returnCampaignId = null,
	returnCharacterId = null,
} = {}) {
	const hasCampaign = returnCampaignId != null;
	const hasCharacter = returnCharacterId != null;
	if (hasCampaign !== hasCharacter) throw new TypeError(`Campaign return routes require both campaign and character ids.`);
	const params = new URLSearchParams({local: "1"});
	if (hasCampaign) {
		if (!isActiveCampaignUuid(returnCampaignId) || !isActiveCampaignUuid(returnCharacterId)) {
			throw new TypeError(`Campaign return ids must be UUIDs.`);
		}
		params.set(CHARACTER_SHEET_RETURN_CAMPAIGN_PARAM, returnCampaignId);
		params.set(CHARACTER_SHEET_RETURN_CHARACTER_PARAM, returnCharacterId);
	}
	return `charactersheet.html?${params}`;
}

export function getCharacterSheetCampaignReturnTarget ({href}) {
	const url = getUrl(href);
	if (!url || url.pathname.split("/").pop()?.toLowerCase() !== "charactersheet.html") return null;
	if (url.searchParams.get("local") !== "1") return null;
	const campaignId = url.searchParams.get(CHARACTER_SHEET_RETURN_CAMPAIGN_PARAM);
	const characterId = url.searchParams.get(CHARACTER_SHEET_RETURN_CHARACTER_PARAM);
	if (!isActiveCampaignUuid(campaignId) || !isActiveCampaignUuid(characterId)) return null;
	return {campaignId, characterId};
}

export function normalizeCharacterSheetAuthorityNavigationUrl ({
	href,
	currentCampaignId = null,
	currentCharacterId = null,
}) {
	const url = getUrl(href);
	if (!url || url.pathname.split("/").pop()?.toLowerCase() !== "charactersheet.html") return href;
	const returnTarget = getCharacterSheetCampaignReturnTarget({href: url.href});
	if (
		returnTarget
		&& returnTarget.campaignId === currentCampaignId
		&& isActiveCampaignUuid(currentCharacterId)
	) {
		url.searchParams.set(CHARACTER_SHEET_RETURN_CHARACTER_PARAM, currentCharacterId);
	}
	return getRelativeCharacterSheetUrl(url);
}
