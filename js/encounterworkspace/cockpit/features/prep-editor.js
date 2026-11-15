/**
 * P3b — the statblock editors prep mode reuses: the Bestiary Quick Actions modal (full statblock editor, items, lair,
 * habitat traits) and the guided creature transformation editor, wired to the cockpit engine's undoable commits.
 */

import {
	EncounterWorkspaceState,
	MAX_ENCOUNTER_STATBLOCK_OPERATIONS,
	validateEncounterStatblockOperations,
} from "../../encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../encounterworkspace-quick-actions.js";
import {withEncounterCreatureTypeTemplate} from "../../encounterworkspace-templates.js";
import {BestiaryQuickActionsUi} from "../../../bestiary/bestiary-quick-actions-ui.js";
import {pRenderCreatureTransformationEditor} from "../../../bestiary/bestiary-transformation-editor.js";

/** Sections of the Quick Actions modal prep mode jumps to. */
export const PREP_EDITOR_SECTIONS = Object.freeze({edit: "edit", item: "item", lair: "lair", area: "area", transformation: "transformation", minion: "minion"});

const getPreviewId = used => {
	let id = "preview-transformation";
	while (used.has(id)) id += "-next";
	used.add(id);
	return id;
};

/** Same guards as the legacy workspace: the operation history limit and statblock validation, previewed on the state. */
export function getPrepTransformationCallbacks (getState, id = null) {
	return {
		validateChange: ({target, operations}) => {
			if (operations.length > MAX_ENCOUNTER_STATBLOCK_OPERATIONS) throw new Error(`This monster exceeds the ${MAX_ENCOUNTER_STATBLOCK_OPERATIONS}-operation statblock history limit.`);
			validateEncounterStatblockOperations(target.baseCreature, operations);
		},
		validateOperation: ({target, operation}) => {
			if (target.operations.length >= MAX_ENCOUNTER_STATBLOCK_OPERATIONS) {
				throw new Error(`This monster has reached the ${MAX_ENCOUNTER_STATBLOCK_OPERATIONS}-operation statblock history limit.`);
			}
			const used = new Set(target.operations.map(it => it.id));
			validateEncounterStatblockOperations(target.baseCreature, [...target.operations, {...operation, id: getPreviewId(used)}]);
		},
		getConsequences: changes => {
			const state = getState();
			const result = EncounterWorkspaceState.withStatblockChanges(state, changes.map(change => {
				const targetId = id || change.id;
				const prior = state.instances.find(it => it.id === targetId)?.statblockOperations || [];
				const used = new Set(prior.map(it => it.id));
				return {...change, id: targetId, addOperations: change.addOperations.map(operation => ({...operation, id: getPreviewId(used)}))};
			}));
			return id ? {...result, resetHpIds: result.resetHpIds.map(() => "current"), splitIds: result.splitIds.map(() => "current")} : result;
		},
	};
}

let _isCtrlEnterInstalled = false;

/** Ctrl/⌘+Enter saves the open Quick Actions form (its primary button). Installed once, only acts while the modal is open. */
function installCtrlEnterSave () {
	if (_isCtrlEnterInstalled) return;
	_isCtrlEnterInstalled = true;
	document.addEventListener("keydown", evt => {
		if (evt.key !== "Enter" || !(evt.ctrlKey || evt.metaKey) || evt.altKey) return;
		if (!document.body.classList.contains("bqa__modal-active")) return;
		const modals = [...document.querySelectorAll(".bqa__modal")];
		const btn = modals.at(-1)?.querySelector(".bqa__content .ve-btn-primary:not(:disabled)");
		if (!btn) return;
		evt.preventDefault();
		evt.stopPropagation();
		btn.click();
	}, true);
}

/**
 * Open the Quick Actions modal on one creature, optionally at a section ("edit", "item", "lair", "area", …).
 * Every save is one undoable cockpit commit.
 */
export async function pOpenPrepStatblockEditor (api, id, {section = null, label = "Edit statblock"} = {}) {
	const instance = api.getState().instances.find(it => it.id === id);
	if (!instance) return api.toast("View a creature first.");
	if (instance.kind === "party") return api.toast("Party members don't have a statblock to edit — use Quick edit.");
	installCtrlEnterSave();
	const adapter = new EncounterWorkspaceQuickActionsAdapter({
		id,
		getState: api.getState,
		pCommit: async result => {
			if (!await api.pCommit(label, () => result.state)) throw new Error("The statblock edit was not saved.");
		},
	});
	const pOpen = BestiaryQuickActionsUi.pOpen({
		monster: instance.monster,
		registry: adapter,
		automationVersion: 2,
		transformationCallbacks: getPrepTransformationCallbacks(api.getState, id),
	});
	if (section) {
		// The modal builds synchronously up to its nav; jump to the requested section once it exists.
		await new Promise(resolve => requestAnimationFrame(resolve));
		const btn = [...document.querySelectorAll(`.bqa__modal .bqa__nav-btn[id$="-${section}"]`)].at(-1);
		if (btn && btn.getAttribute("aria-selected") !== "true") btn.click();
	}
	try {
		await pOpen;
	} catch (e) {
		api.toast(`Could not open the statblock editor: ${e.message || e}.`, {kind: "error"});
	}
}

/**
 * The guided creature-type transformation editor for several creatures at once (half-dragon, zombie, …), mounted
 * in a persistent element. Applying records it as a creature-type template so it can be found and removed later.
 */
export function pRenderPrepCreatureTypeEditor (api, {mount, getTargetIds, isCurrent}) {
	return pRenderCreatureTransformationEditor({
		mount,
		isCurrent,
		isBulk: true,
		automationVersion: 2,
		getTargets: () => {
			const ctx = api.getCtx();
			const ids = new Set(getTargetIds());
			return ctx.state.instances.filter(it => ids.has(it.id) && it.kind !== "party").map(it => ({
				id: it.id,
				label: ctx.labels.get(it.id) || it.monster.name,
				baseCreature: it.monster,
				operations: it.statblockOperations,
			}));
		},
		getStamp: () => JSON.stringify(api.getState()),
		...getPrepTransformationCallbacks(api.getState),
		pApply: async changes => {
			const resolved = changes[0]?.addOperations?.[0]?.data?.resolved;
			const catalogId = resolved?.id;
			const name = resolved?.identity?.name || resolved?.name || "Creature type";
			const next = await api.pCommit(`Template: ${name}`, draft => {
				if (catalogId) return withEncounterCreatureTypeTemplate(draft, {catalogId, name, changes}).state;
				return EncounterWorkspaceState.withStatblockChanges(draft, changes.map(change => ({
					...change,
					addOperations: change.addOperations.map(operation => ({...operation, id: CryptUtil.uid()})),
				}))).state;
			});
			if (!next) throw new Error("The transformation was not saved.");
			api.toast(`Template: ${name} → ${changes.length} creature${changes.length === 1 ? "" : "s"}.`, {isUndo: true});
		},
	});
}
