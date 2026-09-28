import {
	getCampaignCharacterSheetUrl,
	getCharacterSheetCampaignReturnTarget,
	getLocalCharacterSheetUrl,
	normalizeCharacterSheetAuthorityNavigationUrl,
} from "../../../js/hub/hub-character-sheet-routes.js";

const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const OTHER_CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const CHARACTER = "55555555-5555-4555-8555-555555555555";
const CANONICAL_CHARACTER = "66666666-6666-4666-8666-666666666666";

describe("Character Sheet authority routes", () => {
	it("round-trips an exact campaign character through explicit local mode", () => {
		const localUrl = getLocalCharacterSheetUrl({
			returnCampaignId: CAMPAIGN,
			returnCharacterId: CHARACTER,
		});

		expect(localUrl).toBe(
			`charactersheet.html?local=1&returnHubCampaign=${CAMPAIGN}&returnHubCharacter=${CHARACTER}`,
		);
		expect(getCharacterSheetCampaignReturnTarget({
			href: `https://tools.example/${localUrl}`,
		})).toEqual({
			campaignId: CAMPAIGN,
			characterId: CHARACTER,
		});
		expect(getCampaignCharacterSheetUrl({
			campaignId: CAMPAIGN,
			characterId: CHARACTER,
		})).toBe(`charactersheet.html?id=${CHARACTER}&hubCampaign=${CAMPAIGN}`);
	});

	it("does not accept a partial or malformed campaign return descriptor", () => {
		expect(getCharacterSheetCampaignReturnTarget({
			href: `https://tools.example/charactersheet.html?local=1&returnHubCampaign=${CAMPAIGN}`,
		})).toBeNull();
		expect(getCharacterSheetCampaignReturnTarget({
			href: "https://tools.example/charactersheet.html?local=1&returnHubCampaign=not-a-uuid&returnHubCharacter=also-bad",
		})).toBeNull();
	});

	it("updates a temporary return id after the campaign save adopts its canonical id", () => {
		expect(normalizeCharacterSheetAuthorityNavigationUrl({
			href: getLocalCharacterSheetUrl({
				returnCampaignId: CAMPAIGN,
				returnCharacterId: CHARACTER,
			}),
			currentCampaignId: CAMPAIGN,
			currentCharacterId: CANONICAL_CHARACTER,
		})).toBe(
			`charactersheet.html?local=1&returnHubCampaign=${CAMPAIGN}&returnHubCharacter=${CANONICAL_CHARACTER}`,
		);
	});

	it("never carries a character id into a different campaign roster", () => {
		expect(normalizeCharacterSheetAuthorityNavigationUrl({
			href: getCampaignCharacterSheetUrl({campaignId: OTHER_CAMPAIGN}),
			currentCampaignId: CAMPAIGN,
			currentCharacterId: CHARACTER,
		})).toBe(`charactersheet.html?hubCampaign=${OTHER_CAMPAIGN}`);
	});
});
