import {normalizeHubEvent} from "./hub-event-presentation.js";

export function renderHubActivityRows ({list, events, characters, members, documentRef, getDateLabel}) {
	const rows = events
		.map(event => ({
			event,
			presentation: normalizeHubEvent({
				event,
				characters,
				members,
				actorDisplayName: event.actorDisplayName,
			}),
		}))
		.filter(({presentation}) => presentation?.title)
		.slice(-8)
		.reverse();
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
