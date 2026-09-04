export const HUB_CAPABILITY_ACTIVE_CAMPAIGN_CONTEXT = "campaign.active_context.v1";
export const HUB_CAPABILITY_CAMPAIGN_RULES_POLICY = "campaign.rules_policy.v1";

export function hasHubCapability (session, capability) {
	return !!session?.signedIn && Array.isArray(session.capabilities) && session.capabilities.includes(capability);
}

export async function pLoadHubCapabilityModule ({capability, pGetMeta, pImport}) {
	let meta;
	try {
		meta = await pGetMeta();
	} catch (error) {
		return {status: "unavailable", module: null, error};
	}
	if (!meta?.capabilities?.includes(capability)) return {status: "disabled", module: null, error: null};
	try {
		return {status: "ready", module: await pImport(), error: null};
	} catch (error) {
		return {status: "unavailable", module: null, error};
	}
}
