const PLAYER_VISIBLE_KEYS = new Set([
	"name",
	"race",
	"classes",
	"abilities",
	"saveProficiencies",
	"skillProficiencies",
	"ac",
	"hp",
	"speed",
	"senses",
	"conditions",
	"diseases",
	"exhaustion",
]);

export function projectCharacterForPlayer (character) {
	const data = Object.fromEntries(
		Object.entries(character.data || {})
			.filter(([key]) => PLAYER_VISIBLE_KEYS.has(key))
			.map(([key, value]) => [key, structuredClone(value)]),
	);
	return {
		id: character.id,
		ownerAccountId: character.ownerAccountId,
		campaignId: character.campaignId,
		revision: character.revision,
		data,
	};
}

export function canViewEvent ({event, accountId, role}) {
	switch (event.visibility) {
		case "all_members": return true;
		case "dm_only": return ["dm", "co_dm"].includes(role);
		case "actor_and_dm": return event.actorAccountId === accountId || ["dm", "co_dm"].includes(role);
		case "explicit_accounts": return ["dm", "co_dm"].includes(role) || event.visibleAccountIds?.includes(accountId) || false;
		default: return false;
	}
}
