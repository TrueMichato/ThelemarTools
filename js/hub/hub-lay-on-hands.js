export const REVIEWED_LAY_ON_HANDS = Object.freeze({
	sourceEntity: Object.freeze({type: "ability", uid: "lay on hands|xphb", version: "xphb-2024-v1"}),
	effectTemplateId: "ability.lay-on-hands.heal",
	tableRules: "XPHB Lay on Hands: healing only, spending the chosen number of HP points. Touch range and bonus-action eligibility are table-adjudicated, not checked by the server; sharing and consent do not prove eligibility. Poison, disease and condition removal are not supported by this workflow.",
});

export function isReviewedLayOnHandsFeature (feature) {
	const norm = value => String(value || "").trim().toLowerCase();
	const uid = norm(feature?.uid || `${feature?.name}|${feature?.source}`);
	return ["lay on hands|xphb", "lay on hands|paladin|xphb|1"].includes(uid)
		&& norm(feature?.source) === "xphb"
		&& norm(feature?.className) === "paladin"
		&& norm(feature?.classSource) === "xphb"
		&& feature?.level === 1
		&& !feature?.isSubclassFeature
		&& !feature?.brewBundleVersionId && !feature?.brewContentHash;
}

export function hasReviewedLayOnHandsResourceProvenance (resource) {
	const norm = value => typeof value === "string" ? value.trim().toLowerCase() : "";
	return (resource.source == null || norm(resource.source) === "xphb")
		&& (resource.classSource == null || norm(resource.classSource) === "xphb")
		&& (resource.className == null || norm(resource.className) === "paladin")
		&& (resource.uid == null || ["lay on hands|xphb", "lay on hands|paladin|xphb|1"].includes(norm(resource.uid)))
		&& resource.brewBundleVersionId == null && resource.brewContentHash == null;
}

export function resolveReviewedLayOnHands ({feature, amount} = {}) {
	if (!isReviewedLayOnHandsFeature(feature) || !Number.isSafeInteger(amount) || amount < 1 || amount > 100) return null;
	return {...REVIEWED_LAY_ON_HANDS, choice: {amount}};
}
