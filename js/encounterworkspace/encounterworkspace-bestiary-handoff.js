export const BESTIARY_ENCOUNTER_HANDOFF_PARAM = "bestiaryEncounter";
const STORAGE_KEY = "bestiaryEncounterHandoff";
const VERSION = 1;

const isValidRoster = items => Array.isArray(items) && items.length > 0 && items.every(item =>
	typeof item?.h === "string" && !!item.h
	&& (item.c == null || (Number.isSafeInteger(Number(item.c)) && Number(item.c) >= 1))
	&& (item.customHashId == null || typeof item.customHashId === "string"));

export function stageBestiaryEncounterHandoff ({exportedSublist, storage = window.sessionStorage, token = crypto.randomUUID()}) {
	if (!Array.isArray(exportedSublist?.items) || !exportedSublist.items.length) {
		throw new Error("Add creatures to the Bestiary encounter before opening it in the workspace.");
	}
	if (!isValidRoster(exportedSublist.items)) {
		throw new Error("The current encounter contains an unsupported creature. Save or correct it in Bestiary, then try again.");
	}

	const name = exportedSublist.name?.trim() || "Current Bestiary Encounter";
	const handoff = {
		version: VERSION,
		token,
		exportedSublist: {
			name,
			saveId: exportedSublist.name ? exportedSublist.saveId || "" : "",
			items: exportedSublist.items.map(({h, c, customHashId}) => ({h, c, customHashId})),
		},
	};
	storage.setItem(STORAGE_KEY, JSON.stringify(handoff));
	return token;
}

export function takeBestiaryEncounterHandoff ({token, storage = window.sessionStorage}) {
	const raw = storage.getItem(STORAGE_KEY);
	if (!raw) throw new Error("The Bestiary encounter handoff is missing or has already been opened.");

	let handoff;
	try {
		handoff = JSON.parse(raw);
	} catch (e) {
		storage.removeItem(STORAGE_KEY);
		throw new Error("The Bestiary encounter handoff is damaged.", {cause: e});
	}
	if (handoff?.token !== token) throw new Error("This Bestiary encounter link is no longer current.");
	storage.removeItem(STORAGE_KEY);
	if (handoff.version !== VERSION || !isValidRoster(handoff.exportedSublist?.items)
		|| typeof handoff.exportedSublist.name !== "string" || !handoff.exportedSublist.name.trim()) {
		throw new Error("The Bestiary encounter handoff is incomplete or unsupported.");
	}
	return handoff.exportedSublist;
}
