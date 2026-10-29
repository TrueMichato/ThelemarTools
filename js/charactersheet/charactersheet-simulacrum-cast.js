import {CharacterSheetSimulacrum} from "./charactersheet-simulacrum.js";

const copy = value => value === undefined ? undefined : MiscUtil.copyFast(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value != null && typeof value === "object" && !Array.isArray(value);

/**
 * Invert only synchronous creation-owned writes, never an owner snapshot.
 * ID-keyed arrays retain concurrent rows; numeric costs are refunded as deltas.
 */
function undoCreationWrite (current, before, after) {
	if (equal(before, after)) return current;
	if (equal(current, after)) return copy(before);
	if (typeof current === "number" && typeof before === "number" && typeof after === "number") return current + before - after;
	if (object(before) && object(after) && object(current)) {
		for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
			if (equal(before[key], after[key])) continue;
			const restored = undoCreationWrite(current[key], before[key], after[key]);
			if (restored === undefined) delete current[key];
			else if (key === "current" && Number.isFinite(restored) && Number.isFinite(current.max)) {
				current[key] = Math.min(Math.max(current.max, before.current, current.current), restored);
			} else current[key] = restored;
		}
		return current;
	}
	if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
		const keyed = [...before, ...after, ...current].every(row => object(row) && row.id);
		if (keyed) {
			for (const row of after) {
				const old = before.find(it => it.id === row.id);
				const index = current.findIndex(it => it.id === row.id);
				if (equal(old, row) || index < 0) continue;
				if (!old) {
					if (!equal(current[index], row)) throw new Error("A newly created record changed before creation could be undone.");
					current.splice(index, 1);
				} else current[index] = undoCreationWrite(current[index], old, row);
			}
			for (const [index, row] of before.entries()) {
				if (after.some(it => it.id === row.id)) continue;
				if (current.some(it => it.id === row.id)) throw new Error("A removed record was independently recreated; its newer state was not overwritten.");
				current.splice(Math.min(index, current.length), 0, copy(row));
			}
			return current;
		}
		// Non-record lists (e.g. conditions) are merged as membership changes.
		if ([...before, ...after, ...current].every(row => !object(row) && !Array.isArray(row))) {
			return [...current.filter(row => !after.some(it => equal(it, row)) || before.some(it => equal(it, row))),
				...before.filter(row => !after.some(it => equal(it, row)) && !current.some(it => equal(it, row)))];
		}
	}
	throw new Error("A creation-owned field changed concurrently; its newer state was not overwritten.");
}

class CharacterSheetSimulacrumCast {
	static _locks = new WeakSet();

	static isSpell (spell) { return /^simulacrum$/i.test(String(spell?.name || "").trim()); }

	static async run (spells, spell, operation) {
		const state = spells._state;
		const page = spells._page;
		if (state._companionActorPolicy) {
			const message = state.getCompanionSpellCastBlock(spell)
				|| "This duplicate is a Construct, not a Beast or Humanoid, so it cannot duplicate itself.";
			JqueryUtil.doToast({type: "warning", content: message});
			return {ok: false, committed: false};
		}
		if (this._locks.has(state)) {
			JqueryUtil.doToast({type: "warning", content: "A Simulacrum cast is already in progress."});
			return {ok: false, committed: false};
		}
		this._locks.add(state);
		const transaction = new this(spells);
		let outcome;
		try {
			transaction.prepared = await CharacterSheetSimulacrum.pPrepareCreation({ownerPage: page, spellSource: spell.source});
			if (transaction.prepared) {
				transaction.assertCurrent();
				if (transaction.prepared.context.state !== state || transaction.prepared.context.data !== transaction.context.data
					|| transaction.prepared.context.generation !== transaction.context.generation
					|| transaction.prepared.context.characterId !== transaction.context.characterId) throw new Error("The character changed while preparing Simulacrum. Cast it again.");
				outcome = await operation(transaction);
			}
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("[CharSheet] Simulacrum creation failed:", error);
			JqueryUtil.doToast({type: "danger",
				content: transaction.committed
					? `Simulacrum was saved, but its post-cast update failed: ${error.message}`
					: error.message});
			outcome = {ok: transaction.committed, committed: transaction.committed, ...(transaction.committed ? {companionId: transaction.companionId, postCastFailed: true} : {})};
		} finally {
			try {
				transaction.endMutation();
				if (!transaction.committed) await transaction.rollback();
			} catch (error) {
				// eslint-disable-next-line no-console
				console.error("[CharSheet] Simulacrum creation compensation failed:", error);
				JqueryUtil.doToast({type: "danger", content: `Simulacrum rollback needs attention: ${error.message} Export a backup before leaving.`});
				outcome = {ok: false, committed: false, rollbackFailed: true};
			} finally {
				this._locks.delete(state);
			}
		}
		return outcome;
	}

	constructor (spells) {
		this.spells = spells;
		this.page = spells._page;
		this.context = {
			state: spells._state,
			data: spells._state._data,
			generation: this.page._characterLoadGeneration,
			characterId: this.page._currentCharacterId,
		};
		this.writes = [];
		this.committed = false;
		this.saveAttempted = false;
	}

	assertCurrent () {
		const {state, data, generation, characterId} = this.context;
		if (this.spells._state !== state || this.page.getState() !== state || state._data !== data
			|| this.page._characterLoadGeneration !== generation || this.page._currentCharacterId !== characterId) {
			throw new Error("The selected character changed. Simulacrum was not completed; reopen the original character before retrying.");
		}
	}

	beginMutation () {
		this.assertCurrent();
		if (this.before) throw new Error("A Simulacrum mutation is already being recorded.");
		this.before = copy(this.context.data);
	}

	endMutation () {
		if (!this.before) return;
		this.writes.push({before: this.before, after: copy(this.context.data)});
		this.before = null;
	}

	mutate (operation) {
		this.beginMutation();
		try { return operation(); } finally { this.endMutation(); }
	}

	addPreparedCompanion () {
		this.assertCurrent();
		const {state} = this.context;
		const {companionData, replacedActorIds} = this.prepared;
		const creatorActorId = companionData.actorSnapshot.creatorActorId;
		const current = state.getCompanions().filter(row => row.actorSnapshot?.kind === "simulacrum"
			&& row.actorSnapshot.creatorActorId === creatorActorId && row.actorSnapshot.lifecycle === "active")
			.map(row => row.actorSnapshot.actorId).sort();
		if (!equal(current, [...replacedActorIds].sort())) throw new Error("Your existing Simulacrums changed during casting. Preview the replacement again.");
		this.companionId = state.addCompanion(companionData);
		const result = state.destroySimulacrumsByCreator(creatorActorId, {exceptCompanionId: this.companionId});
		if (!result.ok) throw new Error(result.message || "The previous Simulacrum could not be replaced.");
	}

	async save () {
		this.assertCurrent();
		if (!this.page._saveCurrentCharacter) throw new Error("Guarded character persistence is unavailable.");
		this.saveAttempted = true;
		const result = await this.page._saveCurrentCharacter({
			isReturnStatus: true,
			expectedCharacterId: this.context.characterId,
			expectedLoadGeneration: this.context.generation,
		});
		if (result !== true && result?.ok !== true) throw new Error("Simulacrum could not be saved. Creation and its costs have been undone.");
		this.assertCurrent();
		this.committed = true;
	}

	undoData (data) {
		const errors = [];
		for (const {before, after} of [...this.writes].reverse()) {
			for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
				if (equal(before[key], after[key])) continue;
				try {
					const restored = undoCreationWrite(data[key], before[key], after[key]);
					if (restored === undefined) delete data[key];
					else data[key] = restored;
				} catch (error) {
					errors.push(`${key}: ${error.message}`);
				}
			}
		}
		if (errors.length) throw new Error(errors.join("; "));
		return data;
	}

	async rollback () {
		if (!this.writes.length) return;
		this.undoData(this.context.data);
		if (this.saveAttempted) await this.page._pRestoreFailedSimulacrumCreation?.(this);
	}
}

export {CharacterSheetSimulacrumCast};
