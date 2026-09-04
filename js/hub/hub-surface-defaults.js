const _DM_ROLES = new Set(["dm", "co_dm"]);

export function getCampaignSurfaceDefaultUrl ({href, surface, campaign}) {
	if (!campaign?.id || campaign.status !== "active" || !campaign.role) return null;
	if (surface === "dmscreen" && !_DM_ROLES.has(campaign.role)) return null;

	let url;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	const params = url.searchParams;
	if (url.hash || [...params.keys()].length) return null;
	if (surface === "charactersheet" && url.pathname.split("/").pop() !== "charactersheet.html") return null;
	if (surface === "dmscreen" && url.pathname.split("/").pop() !== "dmscreen.html") return null;

	params.set("hubCampaign", campaign.id);
	return `${url.pathname.split("/").pop()}${url.search}`;
}
