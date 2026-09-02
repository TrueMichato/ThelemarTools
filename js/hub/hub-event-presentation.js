const MAX_SNAPSHOT_LENGTH = 80;
const MAX_TITLE_LENGTH = 120;
const MAX_DETAIL_LENGTH = 160;
const MAX_BREAKDOWN_ITEMS = 12;
const MAX_DETAIL_ITEMS = 12;
const MAX_DETAILS_LENGTH = 960;
const MAX_DETAIL_DEPTH = 3;

export const HUB_EVENT_SNAPSHOT_VERSION = 1;

function cleanText (value, maxLength) {
	if (typeof value !== "string") return "";
	return value
		.replace(/<[^>]*>/g, "")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

export function sanitizeCharacterDisplayName (value) {
	return cleanText(value, MAX_SNAPSHOT_LENGTH);
}

function getSnapshotName (snapshot) {
	if (!snapshot || snapshot.version !== HUB_EVENT_SNAPSHOT_VERSION) return "";
	return sanitizeCharacterDisplayName(snapshot.displayName || snapshot.name);
}

function getCharacterName (character) {
	// Envelope-aware: a peer profile exposes its name under the projected `identity`
	// field, and a withheld name must stay withheld in activity copy.
	const name = character?.kind === "peer_profile"
		? character.data?.identity?.name
		: character?.character?.data?.name ?? character?.data?.name;
	return sanitizeCharacterDisplayName(name) || "A character";
}

function getCurrentCharacterName (characters, id) {
	return getCharacterName(characters.find(character => (character?.kind === "peer_profile" ? character.id : character?.character?.id ?? character?.id) === id));
}

function getMemberName (members, accountId, fallback = "A campaign member") {
	return cleanText(members.find(member => member.accountId === accountId)?.displayName, MAX_SNAPSHOT_LENGTH) || fallback;
}

function getSubjectName ({event, characters, members = [], snapshotKey = "characterNameSnapshot", characterId = event.aggregateId}) {
	const snapshotName = getSnapshotName(event.payload?.[snapshotKey]);
	if (snapshotName) return snapshotName;
	const currentName = getCurrentCharacterName(characters, characterId);
	if (currentName !== "A character") return currentName;
	// Deliberately no owner-account fallback: substituting the owner's display name for a
	// character whose identity the policy withholds would reveal the very association the
	// owner closed. Shared activity copy stays generic instead.
	return "A character";
}

function getDetailText (value, depth = 0) {
	if (depth > MAX_DETAIL_DEPTH) return "";
	if (Array.isArray(value)) {
		const parts = value
			.slice(0, MAX_BREAKDOWN_ITEMS)
			.map(item => getDetailText(item, depth + 1))
			.filter(Boolean);
		return parts.length ? parts.join(", ").slice(0, MAX_DETAIL_LENGTH) : "";
	}
	if (value && typeof value === "object") return "";
	return cleanText(value, MAX_DETAIL_LENGTH);
}

function getClassTokens (value) {
	return getDetailText(value)
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

function getFiniteNumber (value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value !== "string" || !value.trim()) return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function getRollOutcome (detail) {
	const classes = new Set(getClassTokens(detail.resultClass));
	const resultNote = getDetailText(detail.resultNote).toLowerCase();
	const hasFumbleNote = /^(?:critical miss|critical failure|natural 1\b|fumble\b)/.test(resultNote);
	const hasCriticalNote = /^(?:critical hit|critical success|natural 20\b)/.test(resultNote);
	const isFumble = detail.fumble === true
		|| detail.isFumble === true
		|| hasFumbleNote
		|| ["fumble", "critical_failure", "critical-failure"].some(it => classes.has(it))
		|| (classes.has("charsheet__dice-result-total--fumble") && hasFumbleNote);
	const isCritical = !isFumble && (
		detail.critical === true
		|| detail.isCritical === true
		|| hasCriticalNote
		|| ["critical", "critical_hit", "critical-hit", "charsheet__dice-result-total--crit"].some(it => classes.has(it))
	);
	return {isCritical, isFumble};
}

function getBoundedDetails (details) {
	const out = [];
	let remaining = MAX_DETAILS_LENGTH;
	for (const detail of details) {
		if (out.length >= MAX_DETAIL_ITEMS || remaining <= 0) break;
		const clean = getDetailText(detail).slice(0, remaining);
		if (!clean) continue;
		out.push(clean);
		remaining -= clean.length;
	}
	return out;
}

export function getRollPresentation ({event, characters, members = []}) {
	const payload = event.payload || {};
	const detail = payload.detail && typeof payload.detail === "object" ? payload.detail : {};
	const title = cleanText(detail.title, MAX_TITLE_LENGTH)
		|| cleanText(payload.context, MAX_TITLE_LENGTH)
		|| cleanText(payload.formula, MAX_TITLE_LENGTH)
		|| "Dice roll";
	const details = [];
	const breakdown = getDetailText(detail.breakdown);
	if (breakdown) details.push(`Breakdown: ${breakdown}`);
	if (detail.advantage === true) details.push("Advantage");
	if (detail.disadvantage === true) details.push("Disadvantage");
	const {isCritical, isFumble} = getRollOutcome(detail);
	if (isFumble) details.push("Fumble");
	else if (isCritical) details.push("Critical");
	const total = getFiniteNumber(payload.total);
	const result = total == null ? "" : `Result: ${total}`;
	if (result) details.push(result);
	for (const [key, label] of [["spell", "Spell"], ["ability", "Ability"], ["target", "Target"]]) {
		const value = getDetailText(detail[key] ?? payload[key]);
		if (value) details.push(`${label}: ${value}`);
	}
	const subject = event.aggregateType === "character"
		? getSubjectName({event, characters, members})
		: null;
	return {title, details: getBoundedDetails(details), subject};
}

function getRoleLabel (role) {
	switch (role) {
		case "dm": return "Dungeon Master";
		case "co_dm": return "Co-DM";
		case "player": return "Player";
		case "spectator": return "Spectator";
		default: return getDetailText(role);
	}
}

function getEffectDescription (effect = {}) {
	const context = getDetailText(effect.context);
	const prefix = context ? `${context}: ` : "";
	const amount = getFiniteNumber(effect.amount);
	const safeAmount = amount ?? 0;
	switch (effect.type) {
		case "damage": return `${prefix}${safeAmount} damage`;
		case "healing": return `${prefix}${safeAmount} healing`;
		case "condition_add": return `${prefix}add ${getDetailText(effect.condition) || "a condition"}`;
		case "condition_remove": return `${prefix}remove ${getDetailText(effect.condition) || "a condition"}`;
		case "spell_slot_spend": {
			const count = amount != null && amount > 0 ? amount : 1;
			const level = getFiniteNumber(effect.level);
			return `${prefix}spend ${count} level ${level != null && level > 0 ? level : 1} spell ${count === 1 ? "slot" : "slots"}`;
		}
		case "informational": return `${prefix}${getDetailText(effect.note) || "informational request"}`;
		default: return `${prefix}${getDetailText(effect.type)?.replaceAll("_", " ") || "effect"}`;
	}
}

function getActivityDetails ({event, members}) {
	const payload = event.payload || {};
	switch (event.type) {
		case "campaign.ownership_transferred":
			return [`New owner: ${getMemberName(members, payload.targetAccountId)}`];
		case "membership.joined":
		case "membership.role_changed":
		case "invite.created":
			return [`Role: ${getRoleLabel(payload.role) || "Campaign member"}`];
		case "action.proposed":
		case "action.applied":
		case "action.rejected":
			return [`Effect: ${getEffectDescription(payload.effect)}`];
		case "xp.granted": {
			const amount = getFiniteNumber(payload.amount);
			const xp = getFiniteNumber(payload.xp);
			return [
				`Amount: ${amount ?? 0} XP`,
				...(xp == null ? [] : [`Total: ${xp} XP`]),
			];
		}
		case "item.granted": {
			const quantity = getFiniteNumber(payload.entry?.quantity);
			return [
				`Item: ${getDetailText(payload.entry?.item?.name || payload.entry?.name) || "Item"}`,
				...(quantity == null ? [] : [`Quantity: ${quantity}`]),
			];
		}
		case "brew.activated":
		case "rules.activated": {
			const numericVersion = getFiniteNumber(payload.version);
			const version = numericVersion ?? getDetailText(payload.version);
			return version === "" ? [] : [`Version: ${version}`];
		}
		default:
			return [];
	}
}

export function normalizeHubEvent ({event, characters = [], members = [], actorDisplayName = null}) {
	if (!event || typeof event !== "object") return null;
	const actorName = cleanText(actorDisplayName ?? event.actorDisplayName, MAX_SNAPSHOT_LENGTH)
		|| getMemberName(members, event.actorAccountId);
	if (event.type === "roll.logged") {
		const roll = getRollPresentation({event, characters, members});
		return {
			type: event.type,
			title: roll.title,
			subject: roll.subject,
			details: roll.details,
			actorName,
		};
	}
	const targetId = event.payload?.targetCharacterId;
	const target = targetId
		? getSubjectName({
			event,
			characters,
			snapshotKey: "targetCharacterNameSnapshot",
			characterId: targetId,
			members,
		})
		: "A character";
	const transferSource = event.payload?.sourceKind === "character"
		? getSubjectName({
			event,
			characters,
			snapshotKey: "sourceCharacterNameSnapshot",
			characterId: event.payload.sourceId,
			members,
		})
		: event.payload?.sourceKind === "party_inventory" ? "Party inventory" : null;
	const transferTarget = event.payload?.targetKind === "character"
		? getSubjectName({
			event,
			characters,
			snapshotKey: "targetCharacterNameSnapshot",
			characterId: event.payload.targetId,
			members,
		})
		: event.payload?.targetKind === "party_inventory" ? "Party inventory" : null;
	const subject = event.aggregateType === "character"
		? getSubjectName({event, characters, members})
		: event.type.startsWith("transfer.") && event.payload?.sourceKind === "character"
			? transferSource
			: null;
	const descriptions = {
		"campaign.created": `${actorName} created the campaign.`,
		"campaign.archived": `${actorName} archived the campaign.`,
		"campaign.ownership_transferred": `${actorName} transferred campaign ownership.`,
		"membership.joined": `${getMemberName(members, event.payload?.accountId)} joined the campaign.`,
		"membership.role_changed": `${getMemberName(members, event.payload?.accountId)} changed roles.`,
		"membership.left": `${getMemberName(members, event.payload?.accountId)} left the campaign.`,
		"membership.removed": `${actorName} removed ${getMemberName(members, event.payload?.accountId)} from the campaign.`,
		"invite.created": `${actorName} created an invite.`,
		"invite.revoked": `${actorName} revoked an invite.`,
		"character.imported": `${subject} was imported into the campaign.`,
		"character.created": `${subject} joined the campaign.`,
		"character.cloned": `${subject} was cloned into the campaign.`,
		"character.reactivated": `${subject} returned to the campaign.`,
		"character.moved": `${subject} moved into this campaign.`,
		"character.moved_out": `${subject} left this campaign.`,
		"character.archived": `${subject} was archived.`,
		"character.deleted": `${subject} was deleted.`,
		"character.save_forced": `${actorName} forced a save for ${subject}.`,
		"character.projection.invalidated": `${subject} updated.`,
		"action.proposed": `${target} was offered an effect by ${actorName}.`,
		"action.applied": `An effect was applied to ${target}.`,
		"action.rejected": `An effect for ${target} was rejected.`,
		"action.cancelled": `An effect for ${target} was cancelled.`,
		"xp.granted": `${subject || target || "A character"} received XP.`,
		"item.granted": `${subject} received an item.`,
		"transfer.reserved": `${transferSource || "A character"} offered a transfer${transferTarget ? ` to ${transferTarget}` : ""}.`,
		"transfer.committed": `${actorName} accepted a transfer${transferSource && transferTarget ? ` from ${transferSource} to ${transferTarget}` : ""}.`,
		"transfer.rejected": `${actorName} rejected a transfer${transferSource && transferTarget ? ` from ${transferSource} to ${transferTarget}` : ""}.`,
		"transfer.cancelled": transferSource || transferTarget
			? `${transferTarget || transferSource}'s transfer was cancelled.`
			: "A transfer was cancelled.",
		"brew.activated": `${actorName} published campaign homebrew.`,
		"rules.activated": `${actorName} published campaign rules.`,
	};
	const description = descriptions[event.type];
	if (!description) return null;
	return {
		type: event.type,
		title: description,
		subject,
		details: getBoundedDetails(getActivityDetails({event, members})),
		actorName,
	};
}
