export const HUB_CAPABILITY_ACTIVE_CAMPAIGN_CONTEXT = "campaign.active_context.v1";

export function hasHubCapability (session, capability) {
	return !!session?.signedIn && Array.isArray(session.capabilities) && session.capabilities.includes(capability);
}
