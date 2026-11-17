/**
 * Top bar — the difficulty badge. Rates the foes still fighting against the party with the Encounter Builder's own
 * budgets (2014 DMG, or 2024 DMG under PHB 2024 condition rules) and opens a popover with Total / Earned XP.
 * Party levels come from the saved Character Sheet characters the party members are linked to.
 */
import {h} from "../dom.js";
import {getEncounterCharacterLevel, pGetEncounterSavedCharacters} from "../../encounterworkspace-party.js";
import {getCockpitDifficulty, getCockpitDifficultyAriaLabel} from "../topbar-model.js";
import {installCockpitThemePicker} from "./theme.js";

const REASON_NOTES = {
	"no-party": "Add the party (Prep → Add → Party) to rate the difficulty.",
	"no-levels": "Link party members to saved characters to rate the difficulty.",
	"unrated": "No foe still fighting has a rated CR.",
	"no-foes": "Every foe is defeated.",
};

export function installCockpitTopbarFeatures (api) {
	installDifficulty(api);
	installCockpitThemePicker(api);
}

function installDifficulty (api) {
	let levelsByCharacterId = new Map();
	let loadedKey = null;

	const getPartyKey = state => state.instances
		.filter(it => it.kind === "party")
		.map(it => it.party?.characterId || "")
		.sort()
		.join("|");

	const pLoadLevels = async key => {
		loadedKey = key;
		try {
			const saved = await pGetEncounterSavedCharacters();
			levelsByCharacterId = new Map(saved.filter(it => it.characterId).map(it => [it.characterId, getEncounterCharacterLevel(it.character)]));
		} catch {
			// Unreadable saved characters only cost the rating; the badge falls back to plain XP.
			levelsByCharacterId = new Map();
		}
		if (loadedKey === key) api.render();
	};

	api.setDifficultyProvider((state, ctx) => {
		if (!state.instances.length) return null;
		const key = getPartyKey(state);
		if (key && key !== loadedKey) pLoadLevels(key);
		const diff = getCockpitDifficulty(state, {ruleset: api.getSettings().ruleset, levelsByCharacterId, labels: ctx?.labels});
		const xpText = `${diff.remainingXp.toLocaleString()} XP`;
		return {
			text: xpText,
			word: diff.word,
			cls: diff.cls,
			ariaLabel: getCockpitDifficultyAriaLabel(diff),
			title: diff.word ? null : REASON_NOTES[diff.reason] || null,
			renderPopover: close => renderPopover(diff, close),
		};
	});
}

function renderPopover (diff, close) {
	const xp = n => `${n.toLocaleString()} XP`;
	const editionLabel = diff.edition === "one" ? "2024 DMG budgets" : "2014 DMG budgets";
	const word = diff.word
		? h(`b.ewc-diffpop__word.${diff.cls}`, {"data-ewc-diff-word": ""}, diff.word)
		: h("b.ewc-diffpop__word", {"data-ewc-diff-word": ""}, "—");
	const notes = [];
	if (diff.word) notes.push(`Rated on ${editionLabel}${diff.adjustedXp != null && diff.adjustedXp !== diff.remainingXp ? `; adjusted ${xp(diff.adjustedXp)}` : ""}.`);
	else if (REASON_NOTES[diff.reason]) notes.push(REASON_NOTES[diff.reason]);
	if (diff.assumedLevelCount) notes.push(`${diff.assumedLevelCount} unlinked party ${diff.assumedLevelCount === 1 ? "member is" : "members are"} assumed to be at the party's average level.`);
	if (diff.unratedCount) notes.push(`${diff.unratedCount} ${diff.unratedCount === 1 ? "foe has" : "foes have"} no rated CR and add no XP.`);

	const endBtn = h("button.ewc-btn.ewc-btn--sm", {
		type: "button",
		"data-ewc-diff": "end",
		onclick: () => {
			close();
			// The End combat flow owns its dialog; reach it through its bar button, else its ⋯ menu entry.
			const trigger = document.querySelector(".ewc [data-ewc-flow=\"end-open\"]") || document.querySelector(".ewc [data-ewc-menu=\"flow-end\"]");
			trigger?.click();
		},
	}, "End combat…");

	return h("div.ewc-diffpop__in", null,
		h("p.ewc-diffpop__h", null, "Encounter difficulty"),
		h("dl.ewc-diffpop__sum", null,
			h("div", null, h("dt", null, "Difficulty"), h("dd", null, word)),
			h("div", null, h("dt", null, "Total XP"), h("dd", {"data-ewc-diff-total": ""}, xp(diff.totalXp))),
			h("div", null, h("dt", null, "Earned"), h("dd", {"data-ewc-diff-earned": ""}, xp(diff.earnedXp))),
		),
		h("p.ewc-muted.ewc-diffpop__p", null, diff.partyCount
			? `${diff.foeCount} ${diff.foeCount === 1 ? "foe" : "foes"} vs ${diff.partyCount} party ${diff.partyCount === 1 ? "member" : "members"} · ${xp(diff.perMember)} each when all are defeated.`
			: `${diff.foeCount} ${diff.foeCount === 1 ? "foe" : "foes"}; ${xp(diff.remainingXp)} still in the fight.`),
		...notes.map(text => h("p.ewc-muted.ewc-diffpop__p", null, text)),
		h("p.ewc-diffpop__h", null, "Defeated"),
		diff.defeated.length
			? h("ul.ewc-diffpop__list", {"data-ewc-diff-defeated": ""}, diff.defeated.map(it => h("li", null, h("span", null, it.label), h("span", null, xp(it.xp)))))
			: h("p.ewc-muted.ewc-diffpop__p", {"data-ewc-diff-defeated": ""}, "No foes defeated yet."),
		h("div.ewc-diffpop__foot", null, endBtn),
	);
}
