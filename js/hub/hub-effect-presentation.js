const _MAX_LABEL_LENGTH = 120;

const _getLabel = (value, fallback) => {
	if (typeof value !== "string") return fallback;
	const clean = value.trim().replace(/\s+/g, " ");
	return clean ? clean.slice(0, _MAX_LABEL_LENGTH) : fallback;
};

export function getPendingEffectPresentation ({
	operationId,
	status,
	sourceDisplaySnapshot,
	effectDisplaySnapshot,
	expiresAt,
}) {
	const normalizedExpiresAt = expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;
	if (
		typeof operationId !== "string"
		|| !operationId
		|| status !== "proposed"
		|| typeof normalizedExpiresAt !== "string"
		|| !normalizedExpiresAt
	) return null;

	return {
		actionId: operationId,
		status,
		expiresAt: normalizedExpiresAt,
		presentation: {
			sourceName: _getLabel(sourceDisplaySnapshot?.identity?.name, "A party member"),
			effectLabel: _getLabel(effectDisplaySnapshot?.label, "Campaign effect"),
		},
	};
}

export function getAppliedEffectNotice ({operation, beforeData = null, afterData = null}) {
	if (!operation?.operationId || operation.version !== 1) return null;
	const args = operation.arguments || {};

	switch (operation.kind) {
		case "hp.damage": {
			const amount = beforeData && afterData
				? Math.max(0,
					(Number(beforeData.hp?.current) || 0) + (Number(beforeData.hp?.temp) || 0)
					- (Number(afterData.hp?.current) || 0) - (Number(afterData.hp?.temp) || 0))
				: Math.max(0, Number(args.amount) || 0);
			return {id: operation.operationId, message: `${amount} damage applied by the campaign.`};
		}
		case "hp.heal": {
			const amount = beforeData && afterData
				? Math.max(0, (Number(afterData.hp?.current) || 0) - (Number(beforeData.hp?.current) || 0))
				: Math.max(0, Number(args.amount) || 0);
			return {
				id: operation.operationId,
				message: amount
					? `${amount} hit point${amount === 1 ? "" : "s"} restored by the campaign.`
					: "Campaign healing applied; hit points were already at the applicable maximum.",
			};
		}
		case "condition.add":
			return {
				id: operation.operationId,
				message: `${_getLabel(args.condition?.name, "A condition")} added by the campaign.`,
			};
		case "condition.remove":
			return {
				id: operation.operationId,
				message: `${_getLabel(args.condition?.name, "A condition")} removed by the campaign.`,
			};
		case "spell_slot.spend": {
			const amount = Math.max(0, Number(args.amount) || 0);
			const level = Math.max(1, Number(args.level) || 1);
			return {
				id: operation.operationId,
				message: `${amount} level ${level} spell slot${amount === 1 ? "" : "s"} spent by the campaign.`,
			};
		}
		case "spell_slot.restore": {
			const level = Math.max(1, Number(args.level) || 1);
			const amount = beforeData && afterData
				? Math.max(0,
					(Number(afterData.spellcasting?.spellSlots?.[level]?.current) || 0)
					- (Number(beforeData.spellcasting?.spellSlots?.[level]?.current) || 0))
				: Math.max(0, Number(args.amount) || 0);
			return {
				id: operation.operationId,
				message: `${amount} level ${level} spell slot${amount === 1 ? "" : "s"} restored by the campaign.`,
			};
		}
		default:
			return null;
	}
}
