import {EncounterWorkspaceState, MAX_ENCOUNTER_LOG_ENTRIES, cloneEncounterState} from "./encounterworkspace-state.js";

export const ENCOUNTER_ENGINE_UNDO_LIMIT = 100;

/**
 * The single write path for the encounter cockpit.
 *
 * Every change runs as `pCommit(label, recipe)`: the recipe edits a private draft (or returns a new state),
 * the result is validated and saved, and only then is it published and pushed onto the undo stack.
 * A failed recipe, validation or save leaves the visible state, the stacks and the log untouched.
 *
 * The log is append-only: undo and redo restore everything except the log, then add an entry saying what was undone.
 */
export function createEncounterEngine ({state, pSave = async next => next, onChange = null, undoLimit = ENCOUNTER_ENGINE_UNDO_LIMIT, now = () => Date.now()}) {
	let current = EncounterWorkspaceState.validate(state);
	const stacks = {undo: [], redo: []};
	let queue = Promise.resolve();
	let logSeq = 0;
	const listeners = new Set(onChange ? [onChange] : []);

	const makeLogEntry = (draft, kind, text, extra = {}) => ({
		...extra,
		id: `log:${now().toString(36)}:${(logSeq++).toString(36)}`,
		at: now(),
		round: draft.turn?.round ?? 0,
		kind: kind || "note",
		text: String(text),
	});
	const appendLog = (draft, entries) => {
		draft.log = [...draft.log || [], ...entries].slice(-MAX_ENCOUNTER_LOG_ENTRIES);
		return draft;
	};
	const emit = meta => listeners.forEach(fn => fn(current, meta));
	// Serialise writes so a slow save can never be overtaken by a later commit.
	const enqueue = fn => {
		const run = queue.then(fn);
		queue = run.catch(() => {});
		return run;
	};
	const pPersist = async next => {
		const saved = await pSave(next);
		return saved == null ? next : EncounterWorkspaceState.validate(saved);
	};

	const pCommit = (label, recipe, {isUndoable = true} = {}) => enqueue(async () => {
		const draft = cloneEncounterState(current);
		const pending = [];
		const log = (kind, text, extra) => { pending.push([kind, text, extra]); };
		const result = await recipe(draft, {log});
		const base = result === undefined ? draft : result;
		if (!base || typeof base !== "object") throw new Error("An encounter change must edit the draft or return a new encounter.");
		const proposed = appendLog(cloneEncounterState(base), pending.map(([kind, text, extra]) => makeLogEntry(base, kind, text, extra)));
		const next = await pPersist(EncounterWorkspaceState.validate(proposed));
		if (isUndoable) {
			stacks.undo = [...stacks.undo, {label, state: current}].slice(-undoLimit);
			stacks.redo = [];
		}
		current = next;
		emit({type: "commit", label});
		return current;
	});

	const pStep = (fromKey, toKey, verb) => enqueue(async () => {
		const stack = stacks[fromKey];
		if (!stack.length) return null;
		const {label, state: target} = stack.at(-1);
		const restored = appendLog({...cloneEncounterState(target), log: current.log}, [makeLogEntry(target, "undo", `${verb}: ${label}`)]);
		const next = await pPersist(EncounterWorkspaceState.validate(restored));
		stacks[fromKey] = stack.slice(0, -1);
		stacks[toKey] = [...stacks[toKey], {label, state: current}].slice(-undoLimit);
		current = next;
		emit({type: verb.toLowerCase(), label});
		return label;
	});

	return {
		getState: () => current,
		pCommit,
		pLog: (kind, text, extra) => pCommit(null, (draft, {log}) => { log(kind, text, extra); }, {isUndoable: false}),
		pUndo: () => pStep("undo", "redo", "Undid"),
		pRedo: () => pStep("redo", "undo", "Redid"),
		canUndo: () => !!stacks.undo.length,
		canRedo: () => !!stacks.redo.length,
		getUndoLabel: () => stacks.undo.at(-1)?.label ?? null,
		getRedoLabel: () => stacks.redo.at(-1)?.label ?? null,
		subscribe: fn => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		/** Replaces the encounter outright (e.g. a Bestiary handoff); clears history because the old steps no longer apply. */
		pReplace: next => enqueue(async () => {
			current = await pPersist(EncounterWorkspaceState.validate(next));
			stacks.undo = [];
			stacks.redo = [];
			emit({type: "replace", label: null});
			return current;
		}),
	};
}
