export function canViewEvent ({event, accountId, role}) {
	switch (event.visibility) {
		case "all_members": return true;
		case "dm_only": return ["dm", "co_dm"].includes(role);
		case "actor_and_dm": return event.actorAccountId === accountId || ["dm", "co_dm"].includes(role);
		case "explicit_accounts": return ["dm", "co_dm"].includes(role) || event.visibleAccountIds?.includes(accountId) || false;
		default: return false;
	}
}
