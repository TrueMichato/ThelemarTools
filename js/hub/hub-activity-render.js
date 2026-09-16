import {normalizeHubEvent} from "./hub-event-presentation.js";
import {getProjectionId, getProjectionRevision} from "./hub-character-view.js";

export function hasHubActivityAuthorizationChanged ({previousCharacters, nextCharacters}) {
	const getRevisions = characters => new Map((characters || []).map(character => [
		getProjectionId(character),
		getProjectionRevision(character).projectionRevision,
	]));
	const previous = getRevisions(previousCharacters);
	const next = getRevisions(nextCharacters);
	if (previous.size !== next.size) return true;
	for (const [characterId, projectionRevision] of next) {
		if (!previous.has(characterId) || previous.get(characterId) !== projectionRevision) return true;
	}
	return false;
}

export function mergeHubActivityEvents ({currentEvents, pageEvents, isAuthorizationChanged = false}) {
	const events = isAuthorizationChanged ? pageEvents : [...pageEvents, ...currentEvents];
	return events
		.filter((event, index, all) => all.findIndex(other => other.id === event.id) === index)
		.sort((a, b) => a.sequence - b.sequence);
}

export function bindHubActivityHistoryPagination ({
	button,
	pListEventPage,
	getState,
	setState,
	render,
	renderError,
	getAuthorizationGeneration,
	isTerminal,
}) {
	const pLoadEarlier = async () => {
		const initialState = getState();
		if (!initialState.history?.hasMore) return;
		const requestAuthorizationGeneration = getAuthorizationGeneration();
		button.disabled = true;
		render({...initialState, isLoading: true});
		try {
			const page = await pListEventPage({
				beforeSequence: initialState.history.scannedBackThroughSequence,
				limit: 50,
			});
			if (requestAuthorizationGeneration !== getAuthorizationGeneration()) return;
			const currentState = getState();
			const events = mergeHubActivityEvents({
				currentEvents: currentState.events,
				pageEvents: page.events,
			});
			setState({events, history: page.history});
			render({
				...currentState,
				events,
				history: page.history,
				statusMessage: page.events.length ? "" : "No additional visible activity in this window. Older retained history may still be available.",
			});
		} catch (error) {
			if (requestAuthorizationGeneration !== getAuthorizationGeneration()) return;
			render({
				...getState(),
				statusMessage: "Earlier activity could not be loaded. Try again.",
			});
			renderError(error);
		} finally {
			if (
				requestAuthorizationGeneration === getAuthorizationGeneration()
				&& !isTerminal()
			) button.disabled = false;
		}
	};
	button?.addEventListener("click", pLoadEarlier);
	return pLoadEarlier;
}

export function renderHubActivityRows ({list, events, characters, members, documentRef, getDateLabel, limit = 8}) {
	let rows = events
		.map(event => ({
			event,
			presentation: normalizeHubEvent({
				event,
				characters,
				members,
				actorDisplayName: event.actorDisplayName,
			}),
		}))
		.filter(({presentation}) => presentation?.title);
	if (Number.isInteger(limit) && limit >= 0) rows = rows.slice(-limit);
	rows.reverse();
	list.replaceChildren(...rows.map(({event, presentation}) => {
		const row = documentRef.createElement("div");
		row.className = "hub-activity-row";
		const content = documentRef.createElement("span");
		content.className = "hub-activity-row__content";
		const rollAttribution = event.type === "roll.logged"
			? presentation.subject && presentation.actorName && presentation.subject !== presentation.actorName
				? `${presentation.subject} (${presentation.actorName})`
				: presentation.subject || presentation.actorName
			: null;
		if (rollAttribution) {
			const subject = documentRef.createElement("span");
			subject.className = "hub-activity-row__subject";
			subject.textContent = rollAttribution;
			content.append(subject);
		}
		const text = documentRef.createElement("strong");
		text.className = "hub-activity-row__title";
		text.textContent = presentation.title;
		content.append(text);
		if (presentation.details?.length) {
			const detail = documentRef.createElement("span");
			detail.className = "hub-activity-row__details";
			detail.textContent = presentation.details.join(" · ");
			content.append(detail);
		}
		const time = documentRef.createElement("time");
		time.className = "hub-data-row__meta";
		time.dateTime = event.createdAt || "";
		time.textContent = getDateLabel(event.createdAt);
		row.append(content, time);
		return row;
	}));
	return rows;
}
