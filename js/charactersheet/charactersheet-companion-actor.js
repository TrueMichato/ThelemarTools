import {CharacterSheetModal} from "./charactersheet-modal.js";

class CharacterSheetCompanionActor {
	static _locks = new WeakMap();

	static hydrate ({ownerPage, companionId, exporter} = {}) {
		const result = ownerPage.getState().hydrateCompanionActor(companionId);
		if (!result.ok) return result;
		return {ok: true, runtime: new this({ownerPage, companionId, exporter, ...result})};
	}

	constructor ({ownerPage, companionId, actor, actorId, revision, exporter} = {}) {
		if (!actor || !actorId) throw new Error("A hydrated companion actor is required.");
		this._ownerPage = ownerPage;
		this._owner = ownerPage.getState();
		this._companionId = companionId;
		this._actor = actor;
		this._actorId = actorId;
		this._revision = revision;
		this._exporter = exporter;
		this._disposed = false;
		this._inOperation = false;
		this._supplies = null;
		this._rolls = [];
		this._assertCurrent();
		this._state = new Proxy(actor, {
			get: (target, key) => {
				const value = Reflect.get(target, key);
				if (typeof value !== "function" || key === "constructor") return value;
				return (...args) => {
					this._assertCurrent();
					return Reflect.apply(value, this._state, args);
				};
			},
		});
		this._page = this._createPage();
		this._spells = new globalThis.CharacterSheetSpells(this._page, {isHeadless: true});
		this._page._spells = this._spells;
		this._spells.setSpells(ownerPage.getSpells?.() || actor.getSpells());
		// Deferred affordances must open a new guarded transaction, not mutate an
		// already-committed detached actor and leave the roster snapshot stale.
		this._entrypoints = new Set([
			"_castSpell", "_castInnateSpell", "_castSpellAsRitual", "_castSpellWithBlessing",
			"pCastItemSpell", "pCommitPendingSpellCast", "pCastFeatureSpellGrant",
			"pUseEfaSpellStoringItem", "_applySpellEffectsToSelf", "_pResumeGamblerDelayedCast",
		]);
		for (const name of this._entrypoints) {
			const method = this._spells[name].bind(this._spells);
			this._spells[name] = (...args) => this._inOperation && name !== "_pResumeGamblerDelayedCast"
				? method(...args)
				: this.run(() => method(...args), {isCast: name !== "_applySpellEffectsToSelf" && name !== "_pResumeGamblerDelayedCast"});
		}
		this._spellControls = new Proxy(this._spells, {
			get: (target, key) => {
				const value = Reflect.get(target, key);
				if (typeof value !== "function") return value;
				if (!this._entrypoints.has(key)) return value.bind(target);
				return (...args) => {
					if (this._inOperation) return Promise.reject(new Error("A companion action is already in progress."));
					return value(...args);
				};
			},
		});
	}

	_assertCurrent () {
		const record = this._owner.getCompanion(this._companionId);
		if (this._disposed
			|| this._ownerPage.getState() !== this._owner
			|| record?.actorSnapshot?.actorId !== this._actorId
			|| record.actorSnapshot.revision !== this._revision
			|| record.actorSnapshot.lifecycle !== "active") {
			throw new Error("This companion actor is no longer available. Reopen its controls.");
		}
	}

	getState () { this._assertCurrent(); return this._state; }
	getSpells () { this._assertCurrent(); return this._spellControls; }
	getActorId () { return this._actorId; }
	getManualResolutionNotice () {
		return "Casting uses the character sheet's supported automation. Unautomated spell effects, hostile-target damage, creature-type eligibility, and supplied-component bookkeeping require manual resolution.";
	}
	dispose () { this._disposed = true; }

	_createPage () {
		const page = {
			_state: this._state,
			getState: () => this.getState(),
			getSpells: () => this._ownerPage.getSpells?.() || [],
			getFilteredSpellData: () => this._ownerPage.getFilteredSpellData?.() || this._ownerPage.getSpells?.() || [],
			getClasses: () => this._ownerPage.getClasses?.() || [],
			saveCharacter: () => this._inOperation ? true : this.commit(),
			_saveCurrentCharacter: () => this._inOperation ? true : this.commit(),
			pConfirmSpellSupplies: input => this._confirmSupplies(input),
			getActorCastContext: () => ({
				actorId: this._actorId,
				effectOwner: {id: this._actorId, holderUid: this._actorId},
				suppliedComponents: this._supplies,
			}),
			getActorSpellTarget: targetInfo => this._getEffectTarget(targetInfo),
			pRunActorEffect: operation => this.run(operation),
			_rollHistory: {addRoll: roll => {
				this._assertCurrent();
				this._rolls.push({...roll, actorId: this._actorId});
			}},
		};
		// Only these methods are safe to reuse. In particular there is no fallback
		// binding of arbitrary mutable owner methods or owner Combat/Features.
		const actorMethods = [
			"rollD20", "_rollD20", "formatD20Breakdown", "_formatD20Breakdown",
			"getModeLabel", "_getModeLabel", "_rollStateDiceBonuses",
			"_rollModifierDiceBonuses", "_pRollTriggeredFeatDie",
			"_pPickConditionalModifiers", "_formatConditionalModifierDisplay", "rollDice",
			"_promptConcentrationCheck", "_pPickStrainTrack",
			"_onFindSteed", "_pShowMountPicker", "_getStandardMountStats",
			"_pShowBeastPicker", "_pGetWildShapeBeastCandidates",
		];
		page.constructor = this._ownerPage.constructor;
		for (const name of actorMethods) {
			const method = this._ownerPage[name];
			if (typeof method === "function") {
				page[name] = (...args) => {
					this._assertCurrent();
					return Reflect.apply(method, page, args);
				};
			}
		}
		for (const name of [
			"pAnimateD20", "pAnimateDiceSpec", "pAnimateDamageDice", "showDiceResult",
			"getHoverLink", "getSpellHoverLink", "resolveOptionalFeatureSource",
		]) {
			if (typeof this._ownerPage[name] === "function") {
				page[name] = (...args) => {
					this._assertCurrent();
					return this._ownerPage[name](...args);
				};
			}
		}
		for (const name of [
			"_renderQuickSpells", "_renderResources", "_renderOverviewMetamagic",
			"_renderHp", "_renderCompanions", "_renderInventory", "_renderActiveStates",
			"_updateAllCalculations", "_renderCurrency",
			"_renderCharacter",
		]) page[name] = () => {};
		const Combat = globalThis.CharacterSheetCombat;
		if (Combat) {
			const combat = new Combat(page, {isHeadless: true});
			page._combat = new Proxy(combat, {
				get: (target, key) => {
					if (typeof key === "string" && /^_?render/.test(key)) return () => {};
					const value = Reflect.get(target, key);
					return typeof value === "function" ? (...args) => {
						this._assertCurrent();
						return Reflect.apply(value, page._combat, args);
					} : value;
				},
			});
			page._combatModule = page._combat;
		}
		return page;
	}

	async _confirmSupplies ({spell, spellData, componentWaivers = []}) {
		this._assertCurrent();
		const components = spellData?.components || spell.components || {};
		const waived = new Set(componentWaivers);
		const materialWaived = waived.has("m") || this._actor.isSpellCastMaterialComponentWaived?.(spell);
		const focus = this._actor.getSpellCastFocusRequirement?.(spell);
		const info = this._actor.getSpellMaterialComponentInfo?.(spellData || spell);
		const requirements = [];
		if (!materialWaived && components.m) {
			const text = typeof components.m === "string" ? components.m : components.m.text;
			requirements.push(text || "the spell's material components");
			if (info?.cost) requirements.push(`worth at least ${info.cost / 100} gp`);
			requirements.push(info?.consume === "optional" ? "optionally consumed by this cast"
				: info?.consume ? "consumed by this cast" : "not consumed by this cast");
			if (info?.requiresFocus) requirements.push("or an appropriate spellcasting focus/component pouch");
		}
		if (focus && !materialWaived) requirements.push(focus.ui?.description || focus.ui?.title || "the required class spellcasting focus");
		if (!requirements.length) return true;
		const description = requirements.join("; ");
		const confirmed = await CharacterSheetModal.pGetUserBoolean({
			title: `Supply Components: ${spell.name}`,
			htmlDescription: `${globalThis.CharacterSheetClassUtils.escapeHtml(description)}. Confirm these have been supplied to the duplicate for this cast. No inventory or item bonuses are borrowed from the original.`,
			textYes: "Supplied for this cast",
			textNo: "Cancel",
		});
		this._assertCurrent();
		if (!confirmed) return false;
		this._supplies = {spellUid: `${spell.name}|${spell.source}`, description, confirmed: true};
		return true;
	}

	async run (operation, {isCast = false} = {}) {
		this._assertCurrent();
		let locks = CharacterSheetCompanionActor._locks.get(this._owner);
		if (!locks) CharacterSheetCompanionActor._locks.set(this._owner, locks = new Set());
		if (locks.has(this._actorId)) throw new Error("A companion action is already in progress.");
		locks.add(this._actorId);
		const before = MiscUtil.copyFast(this._actor._data);
		const policyBefore = MiscUtil.copyFast(this._actor._companionActorPolicy);
		this._inOperation = true;
		this._supplies = null;
		this._target = null;
		this._summonsBefore = MiscUtil.copyFast((this._owner.getCompanions() || [])
			.filter(companion => companion.creatorActorId === this._actorId));
		this._actor._data.companions = MiscUtil.copyFast(this._summonsBefore);
		try {
			const result = await operation(this._state, this._spells);
			this._assertCurrent();
			if (isCast && (result === undefined || result === false || result?.cancelled === true || result?.ok === false)) {
				this._actor._data = before;
				this._actor._companionActorPolicy = policyBefore;
				this._rolls = [];
				return result;
			}
			await this._commit();
			return result;
		} catch (error) {
			this._actor._data = before;
			this._actor._companionActorPolicy = policyBefore;
			this._rolls = [];
			JqueryUtil.doToast({type: "danger", content: error.message});
			throw error;
		} finally {
			this._inOperation = false;
			this._targetActorId = null;
			locks.delete(this._actorId);
		}
	}

	castSpell (spellId, options) {
		return this.run(() => {
			this._targetActorId = options?.targetActorId || null;
			return this._spells._castSpell(spellId, options);
		}, {isCast: true});
	}

	castInnateSpell (spellId, options) {
		return this.run(() => {
			this._targetActorId = options?.targetActorId || null;
			return this._spells._castInnateSpell(spellId, options);
		}, {isCast: true});
	}

	castRitual (spellId) {
		return this.run(() => this._spells._castSpellAsRitual(spellId), {isCast: true});
	}

	takeDamage (amount, options) {
		return this.run(async state => {
			const before = state.getHp();
			const result = state.takeDamage(amount, options);
			const after = state.getHp();
			const taken = before.current + before.temp - after.current - after.temp;
			if (taken > 0 && after.current > 0 && state.isConcentrating()) {
				if (!this._page._promptConcentrationCheck) throw new Error("Concentration checks are unavailable.");
				await this._page._promptConcentrationCheck(taken);
			}
			return result;
		});
	}

	_getEffectTarget (targetInfo) {
		if (!this._targetActorId || this._targetActorId === this._actorId) return null;
		if (targetInfo.selfOnly) throw new Error("This spell can only target the duplicate itself.");
		if (!targetInfo.canTargetAlly && targetInfo.selfTargetMode !== "offer") throw new Error("This spell does not support a managed ally target.");
		if (this._target) return this._target.actor;
		if (this._targetActorId === this._owner._data.id) {
			const actor = this._owner._createDetachedActorState(this._owner._data);
			this._target = {actor, before: MiscUtil.copyFast(this._owner._data), isOwner: true};
		} else {
			const record = this._owner.getCompanions().find(companion => companion.actorSnapshot?.actorId === this._targetActorId);
			if (!record) throw new Error("That managed target is unavailable.");
			const hydrated = this._owner.hydrateCompanionActor(record.id);
			if (!hydrated.ok) throw new Error(hydrated.message || hydrated.reason);
			this._target = {...hydrated, companionId: record.id};
		}
		return this._target.actor;
	}

	commit () { return this.run(() => true); }

	async _commit () {
		this._assertCurrent();
		const previous = MiscUtil.copyFast(this._owner.getCompanion(this._companionId));
		const summons = this._actor._data.companions;
		this._actor._data.companions = [];
		const summonsBefore = this._summonsBefore || [];
		const liveSummons = this._owner.getCompanions().filter(companion => companion.creatorActorId === this._actorId);
		if (JSON.stringify(liveSummons) !== JSON.stringify(summonsBefore)) throw new Error("Companion summons changed during this action. Reopen its controls.");
		const ownerBefore = MiscUtil.copyFast(this._owner._data);
		const result = this._owner.commitCompanionActor(this._companionId, {
			actor: this._actor, revision: this._revision, exporter: this._exporter,
		});
		if (!result.ok) throw new Error(result.message || result.reason);
		this._revision = result.revision;
		const targetUndo = Object.entries(this._owner._data)
			.filter(([key, after]) => key !== "companions" && JSON.stringify(after) !== JSON.stringify(ownerBefore[key]))
			.map(([key, after]) => ({key, before: ownerBefore[key], after: MiscUtil.copyFast(after)}));
		for (const record of this._owner.getCompanions()) {
			if (record.id === this._companionId || !record.actorSnapshot) continue;
			const before = ownerBefore.companions.find(row => row.id === record.id);
			if (before && JSON.stringify(before) !== JSON.stringify(record)) targetUndo.push({record, before, revision: record.actorSnapshot.revision});
		}
		let summonsAfter = null;
		try {
			if (this._target?.isOwner) {
				for (const key of Object.keys(this._target.actor._data)) {
					const before = this._target.before[key];
					let after = this._target.actor._data[key];
					if (JSON.stringify(before) === JSON.stringify(after)) continue;
					const current = this._owner._data[key];
					const cleanup = targetUndo.find(patch => patch.key === key);
					if (JSON.stringify(current) !== JSON.stringify(before) && JSON.stringify(current) !== JSON.stringify(cleanup?.after)) throw new Error("The spell target changed during this action.");
					if (key === "activeStates" && cleanup) {
						after = after.filter(row => current.some(live => live.id === row.id)
							|| JSON.stringify(before.find(old => old.id === row.id)) !== JSON.stringify(row));
					}
					targetUndo.push({key, before: MiscUtil.copyFast(current), after: MiscUtil.copyFast(after)});
				}
				for (const patch of targetUndo) {
					if (patch.key) this._owner._data[patch.key] = MiscUtil.copyFast(patch.after);
				}
			} else if (this._target) {
				const record = this._owner.getCompanion(this._target.companionId);
				const cleanup = targetUndo.find(patch => patch.record === record);
				if (cleanup) {
					const beforeStates = cleanup.before.actorSnapshot.state.activeStates;
					this._target.actor._data.activeStates = this._target.actor._data.activeStates.filter(row =>
						record.actorSnapshot.state.activeStates.some(live => live.id === row.id)
						|| JSON.stringify(beforeStates.find(old => old.id === row.id)) !== JSON.stringify(row));
					this._target.revision = record.actorSnapshot.revision;
				}
				const before = MiscUtil.copyFast(record);
				const committed = this._owner.commitCompanionActor(this._target.companionId, {
					actor: this._target.actor, revision: this._target.revision, exporter: this._exporter,
				});
				if (!committed.ok) throw new Error(committed.message || committed.reason);
				targetUndo.push({record, before, revision: committed.revision});
			}
			this._owner._data.companions = this._owner._data.companions
				.filter(companion => companion.creatorActorId !== this._actorId);
			if (this._owner.getCompanion(this._companionId).actorSnapshot.lifecycle === "active") {
				this._owner._data.companions.push(...summons.map(companion => ({...companion, creatorActorId: this._actorId})));
			}
			summonsAfter = MiscUtil.copyFast(this._owner.getCompanions().filter(companion => companion.creatorActorId === this._actorId));
			const saved = await this._ownerPage.saveCharacter();
			if (saved === false || saved?.ok === false) throw new Error("Companion changes could not be saved.");
			const live = this._owner.getCompanion(this._companionId)?.actorSnapshot;
			if (this._ownerPage.getState() !== this._owner || this._disposed || live?.actorId !== this._actorId || live.revision !== this._revision) {
				throw new Error("This companion actor is no longer available. Reopen its controls.");
			}
		} catch (error) {
			for (const patch of [...targetUndo].reverse()) {
				if (patch.record) {
					if (patch.record.actorSnapshot.revision === patch.revision) Object.assign(patch.record, patch.before);
				} else if (JSON.stringify(this._owner._data[patch.key]) === JSON.stringify(patch.after)) {
					this._owner._data[patch.key] = patch.before;
				}
			}
			const live = this._owner.getCompanion(this._companionId);
			if (live?.actorSnapshot?.actorId === this._actorId && live.actorSnapshot.revision === this._revision) {
				const currentSummons = this._owner.getCompanions().filter(companion => companion.creatorActorId === this._actorId);
				if (summonsAfter && JSON.stringify(currentSummons) === JSON.stringify(summonsAfter)) {
					this._owner._data.companions = this._owner._data.companions.filter(companion => companion.creatorActorId !== this._actorId);
					this._owner._data.companions.push(...summonsBefore);
				}
				Object.keys(live).forEach(key => delete live[key]);
				Object.assign(live, previous);
				this._revision = previous.actorSnapshot.revision;
			}
			this._summonsBefore = MiscUtil.copyFast(this._owner.getCompanions().filter(companion => companion.creatorActorId === this._actorId));
			this._target = null;
			throw error;
		}
		for (const roll of this._rolls.splice(0)) this._ownerPage._rollHistory?.addRoll?.(roll);
		return result;
	}
}

globalThis.CharacterSheetCompanionActor = CharacterSheetCompanionActor;
