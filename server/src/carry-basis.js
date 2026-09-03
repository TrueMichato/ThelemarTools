import {
	computeCarrySettingsDigest,
	createCampaignCarryBasis,
	createDetachedCarryBasis,
} from "../../js/hub/hub-carry-authority.js";
import {normalizeCampaignRules} from "./campaign-content.js";

/**
 * The basis a character's carry summary must match in order to be trusted right now.
 *
 * Campaign rules activation and brew-bundle rotation change carry inputs — the Thelemar
 * capacity rule via the settings overlay, material-projected item weights via the brew's
 * material catalog — **without touching the character document at all**. Document-level
 * invalidation therefore structurally cannot see them, so freshness is established by
 * comparing the context the summary was authored in against the context that is live.
 *
 * Only scalars are compared. The server never recomputes carry arithmetic: doing so would
 * recreate the divergent second implementation this contract exists to remove.
 *
 * The settings digest must be computed over the *effective* settings, exactly as the sheet
 * sees them. `CharacterSheetState.setCampaignSettingsOverlay()` writes campaign rule values
 * over the character's own settings and `getSettings()` returns the result, while
 * `toJson()` restores the character's originals — so the stored document holds the
 * character's settings and the overlay must be re-applied here to reach the same digest.
 *
 * @param {{character: object, campaign: ?object, rulesVersion: ?object, brewBundle: ?object}} params
 * @returns {object} A basis suitable for `resolveCarryAuthority`.
 */
export function getExpectedCarryBasis ({character, campaign = null, rulesVersion = null, brewBundle = null} = {}) {
	const settings = character?.data?.settings;
	const ownSettings = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};

	// A character with no campaign has no overlay and no brew bundle, so its own settings are
	// already the effective ones. This is an explicit variant rather than a campaign basis
	// full of nulls, so "belongs to no campaign" can never be mistaken for "campaign whose
	// context we failed to resolve".
	if (!character?.campaignId) {
		return createDetachedCarryBasis({settingsDigest: computeCarrySettingsDigest(ownSettings)});
	}

	const campaignRules = rulesVersion?.rules ? normalizeCampaignRules(rulesVersion.rules) : null;
	const effectiveSettings = campaignRules ? {...ownSettings, ...campaignRules} : ownSettings;

	return createCampaignCarryBasis({
		// A campaign with no active rules version or no brew bundle yields null here, which
		// is a real observed state rather than a placeholder: if a DM activates one later,
		// the recorded null stops matching and every summary authored before it correctly
		// falls out of trust until its owner's sheet saves again.
		rulesVersionId: rulesVersion?.id ?? campaign?.activeRulesVersionId ?? null,
		brewBundleHash: brewBundle?.contentHash ?? null,
		settingsDigest: computeCarrySettingsDigest(effectiveSettings),
	});
}
