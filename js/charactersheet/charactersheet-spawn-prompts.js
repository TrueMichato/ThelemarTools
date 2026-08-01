/**
 * Character Sheet Spawner — prompt auto-answer layer
 *
 * Building a character through the real Builder / Quick Build engines means the
 * engines will, at points, stop and ASK: "choose a cantrip", "choose a skill",
 * "pick a damage type". Those prompts are what make hand-building slow, and in a
 * headless spawn they would simply hang forever.
 *
 * This module installs a temporary, per-spawn auto-responder over the small,
 * enumerable set of prompt entry points, routing every question through the
 * spawner's {@link CharacterSheetSpawnPicker} so answers honour spec overrides
 * first and a seeded pick second — exactly like every other choice.
 *
 * Anything that opens a modal we do NOT know about is recorded as an
 * "unhandled prompt" and force-closed, so a spawn fails loudly and traceably
 * instead of hanging or silently half-building.
 *
 * IMPORTANT — patching technique: the sheet's modules destructure
 * `const {InputUiUtil, UiUtil} = globalThis` at load time, so reassigning
 * `globalThis.InputUiUtil` has no effect. We patch METHODS on the existing
 * objects, which every module already holds a reference to.
 */

class CharacterSheetSpawnPrompts {
	/**
	 * @param {{page: *, picker: *, report: *, spec: *}} opts
	 */
	constructor ({page, picker, report, spec}) {
		this._page = page;
		this._picker = picker;
		this._report = report;
		this._spec = spec;
		/** @type {{obj: *, key: string, original: *}[]} */ this._patches = [];
		this._isInstalled = false;
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Install / uninstall
	// ═══════════════════════════════════════════════════════════════════════

	install () {
		if (this._isInstalled) return;
		this._isInstalled = true;

		const InputUiUtil = (/** @type {*} */ (globalThis)).InputUiUtil;
		const UiUtil = (/** @type {*} */ (globalThis)).UiUtil;

		// ── Character-sheet level prompts ──
		this._patch(this._page, "_pPickFeatureChoice", (/** @type {*} */ choice) => this._answerFeatureChoice(choice));

		if (this._page._spells) {
			this._patch(this._page._spells, "showFilteredSpellPicker", (/** @type {*} */ choice, /** @type {*} */ onSelect) => this._answerFilteredSpellPicker(choice, onSelect));
			this._patch(this._page._spells, "_pShowScribingSpellPicker", (/** @type {*} */ opts) => this._answerScribingSpellPicker(opts));
		}

		// ── Generic input prompts ──
		if (InputUiUtil) {
			this._patch(InputUiUtil, "pGetUserEnum", (/** @type {*} */ opts) => this._answerEnum(opts));
			this._patch(InputUiUtil, "pGetUserMultipleChoice", (/** @type {*} */ opts) => this._answerMultipleChoice(opts));
			this._patch(InputUiUtil, "pGetUserBoolean", (/** @type {*} */ opts) => this._answerBoolean(opts));
			this._patch(InputUiUtil, "pGetUserString", (/** @type {*} */ opts) => this._answerString(opts));
			this._patch(InputUiUtil, "pGetUserNumber", (/** @type {*} */ opts) => this._answerNumber(opts));
		}

		// ── Watchdog: any other modal ──
		// Bespoke pickers build their own modal via `CharacterSheetModal.pGetShow`, which
		// resolves `UiUtil.pGetShowModal` at call time precisely so this patch still catches
		// them. We can't answer those generically, but we can refuse to hang: record the title
		// and close immediately (every such picker resolves `null` on close, i.e. the same path
		// as a player pressing Escape).
		if (UiUtil?.pGetShowModal) {
			this._patch(UiUtil, "pGetShowModal", async (/** @type {*} */ opts) => this._answerUnknownModal(UiUtil, opts));
		}
		if (InputUiUtil?._pGetShowModal) {
			this._patch(InputUiUtil, "_pGetShowModal", async (/** @type {*} */ opts) => this._answerUnknownModal(InputUiUtil, opts, "_pGetShowModal"));
		}
	}

	uninstall () {
		if (!this._isInstalled) return;
		// Restore in reverse order so nested patches unwind cleanly.
		for (const {obj, key, hadOwn, original} of [...this._patches].reverse()) {
			if (hadOwn) obj[key] = original;
			else delete obj[key];
		}
		this._patches = [];
		this._isInstalled = false;
	}

	/**
	 * Shadow `obj[key]` with `impl`, remembering enough to restore exactly what was
	 * there before — including "nothing of its own", for prototype methods, which
	 * must be `delete`d rather than reassigned so the prototype shows through again.
	 *
	 * @param {*} obj
	 * @param {string} key
	 * @param {*} impl
	 */
	_patch (obj, key, impl) {
		if (!obj) return;
		const hadOwn = Object.prototype.hasOwnProperty.call(obj, key);
		this._patches.push({obj, key, hadOwn, original: obj[key]});
		obj[key] = impl;
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Answerers
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Pending feature choices queued by `addFeature` — racial skill picks, bonus
	 * cantrips, Divine Order-style sub-feature options.
	 *
	 * @param {*} choice `{id, featureName, kind: "skill"|"cantrip"|"subfeature", options}`
	 * @returns {Promise<*>} selection in the shape the caller expects, or null
	 */
	async _answerFeatureChoice (choice) {
		if (!choice || !Array.isArray(choice.options) || !choice.options.length) return null;

		const bucketByKind = {skill: "skills", tool: "tools", cantrip: "cantrips", subfeature: "featureOptions"};
		const bucket = bucketByKind[choice.kind] || "featureOptions";
		const isStringChoice = choice.kind === "skill" || choice.kind === "tool";

		const picked = this._picker.pickOne({
			bucket,
			kind: `featureChoice:${choice.kind}`,
			key: choice.featureName || null,
			options: choice.options,
			nameOf: (/** @type {*} */ o) => (isStringChoice ? String(o) : o?.name),
			label: `${choice.featureName || "Feature"} → ${choice.kind}`,
		});
		if (picked == null) return null;

		// The caller expects a skill KEY string for "skill", `{name, source}` otherwise.
		return isStringChoice ? picked : {name: picked.name, source: picked.source};
	}

	/**
	 * Feature-granted spell picks (Fey Touched, Magic Initiate, …). The real
	 * picker computes its candidate pool from the choice's filter; we reuse the
	 * exact same helpers so the auto-pick can only choose legal spells.
	 *
	 * @param {*} choice
	 * @param {*} onSelect
	 */
	async _answerFilteredSpellPicker (choice, onSelect) {
		const spells = this._page._spells;
		let candidates = [];
		try {
			const criteria = spells._parseSpellFilter(choice.filter);
			candidates = spells._filterSpellsByCriteria(this._page.getFilteredSpellData(), criteria) || [];
		} catch (e) {
			this._report.warn(`Could not evaluate spell filter for "${choice?.featureName}": ${(/** @type {*} */ (e)).message}`);
			candidates = [];
		}

		const stateObj = spells._state || this._page.getState?.();
		const known = new Set([
			...(stateObj?.getSpells?.() || []),
			...(stateObj?.getInnateSpells?.() || []),
		].map((/** @type {*} */ s) => `${s.name}|${s.source}`));
		const fresh = candidates.filter((/** @type {*} */ s) => !known.has(`${s.name}|${s.source}`));

		const picked = this._picker.pickOne({
			bucket: "spells",
			kind: "featureSpell",
			key: choice?.featureName || null,
			options: (fresh.length ? fresh : candidates).sort((/** @type {*} */ a, /** @type {*} */ b) => a.name.localeCompare(b.name)),
			label: `${choice?.featureName || "Feature"} → spell`,
		});
		if (!picked) return;
		await onSelect(picked);
	}

	/**
	 * Spell Scribing Adept spellbook picks. Candidates come from the same
	 * `getScribableSpells` helper the real picker uses, so the auto-pick can only
	 * ever land on a legally scribable spell.
	 *
	 * @param {*} opts `{title, className, maxLevel, allSpells, existingIds}`
	 */
	async _answerScribingSpellPicker (opts) {
		const {className, maxLevel, allSpells, existingIds} = opts || {};
		const spells = this._page._spells;
		const CharacterSheetSpells = (/** @type {*} */ (globalThis)).CharacterSheetSpells;
		const CharacterSheetClassUtils = (/** @type {*} */ (globalThis)).CharacterSheetClassUtils;

		let candidates = [];
		try {
			const stateObj = spells._state || this._page.getState?.();
			const classEntry = (stateObj?.getClasses?.() || []).find((/** @type {*} */ c) => c.name === className);
			const classDataForSubclass = classEntry
				? this._page?.getClasses?.()?.find((/** @type {*} */ c) => c.name === classEntry.name && c.source === classEntry.source)
				: null;
			const subclass = classEntry?.subclass
				? CharacterSheetClassUtils.resolveFullSubclass(classEntry.subclass, classDataForSubclass)
				: null;

			candidates = CharacterSheetSpells.getScribableSpells({
				allSpells,
				className,
				classSource: classEntry?.source,
				subclass,
				subclassChoice: classEntry?.subclassChoice,
				maxLevel,
				existingIds,
			}) || [];
		} catch (e) {
			this._report.warn(`Could not compute scribable spells for ${className}: ${(/** @type {*} */ (e)).message}`);
		}

		return this._picker.pickOne({
			bucket: "spellbook",
			kind: "scribingSpell",
			key: className || null,
			options: candidates,
			label: `${className || "Scribing"} spellbook spell`,
		});
	}

	/**
	 * @param {*} opts see `InputUiUtil.pGetUserEnum`
	 */
	async _answerEnum (opts) {
		const values = opts?.values || [];
		const display = (/** @type {*} */ v, /** @type {number} */ i) => (opts?.fnDisplay ? opts.fnDisplay(v, i) : v);
		const wrapped = values.map((/** @type {*} */ v, /** @type {number} */ i) => ({value: v, ix: i, label: String(display(v, i))}));

		const picked = this._picker.pickOne({
			bucket: "prompts",
			kind: "prompt:enum",
			key: opts?.title || null,
			options: wrapped,
			nameOf: (/** @type {*} */ o) => o.label,
			label: opts?.title || "Enum prompt",
		});
		if (!picked) return null;

		if (opts?.fnGetExtraState) {
			const out = {extraState: opts.fnGetExtraState()};
			if (opts.isResolveItem) out.item = picked.value; else out.ix = picked.ix;
			return out;
		}
		return opts?.isResolveItem ? picked.value : picked.ix;
	}

	/**
	 * @param {*} opts see `InputUiUtil.pGetUserMultipleChoice`
	 */
	async _answerMultipleChoice (opts) {
		// `values` and `valueGroups` are mutually exclusive; flatten either into a
		// single indexed list, mirroring how the real modal indexes its checkboxes.
		/** @type {*[]} */ let values = [];
		if (Array.isArray(opts?.values)) values = opts.values;
		else if (Array.isArray(opts?.valueGroups)) values = opts.valueGroups.flatMap((/** @type {*} */ g) => g.values || []);

		const display = (/** @type {*} */ v, /** @type {number} */ i) => (opts?.fnDisplay ? opts.fnDisplay(v, i) : v);
		const wrapped = values.map((/** @type {*} */ v, /** @type {number} */ i) => ({value: v, ix: i, label: String(display(v, i))}));

		const required = new Set(opts?.required || []);
		const count = opts?.count ?? opts?.min ?? opts?.max ?? 1;
		const selectable = wrapped.filter((/** @type {*} */ w) => !required.has(w.ix));
		const need = Math.max(0, count - required.size);

		const picked = this._picker.pickMany({
			bucket: "prompts",
			kind: "prompt:multi",
			key: opts?.title || null,
			count: need,
			options: selectable,
			nameOf: (/** @type {*} */ o) => o.label,
			label: opts?.title || "Multiple-choice prompt",
		});

		const chosenIdxs = [...required, ...picked.map((/** @type {*} */ p) => p.ix)].sort((a, b) => a - b);
		return opts?.isResolveItems ? chosenIdxs.map(ix => values[ix]) : chosenIdxs;
	}

	/**
	 * `pGetUserBoolean` has no `default` option, so absent an explicit spec answer
	 * we take the affirmative branch — during a build that is the "yes, apply it"
	 * path, which is what a tester spawning a character wants.
	 *
	 * @param {*} opts see `InputUiUtil.pGetUserBoolean`
	 */
	async _answerBoolean (opts) {
		const title = opts?.title || null;
		let answer = true;
		let from = "auto";

		const override = this._picker.peekOverride("prompts", title);
		if (override != null) {
			answer = !/^(no|false|0|off)$/i.test(String(override).trim());
			from = "spec";
		} else if (opts?.isAlert) answer = true;

		this._report.record({kind: "prompt:boolean", key: title, chosen: String(answer), from});
		return answer;
	}

	/**
	 * @param {*} opts see `InputUiUtil.pGetUserString`
	 */
	async _answerString (opts) {
		const title = opts?.title || null;
		const override = this._picker.peekOverride("prompts", title);
		const answer = override != null
			? String(override)
			: (opts?.default != null ? String(opts.default) : (this._spec?.name || "Spawned Character"));
		this._report.record({kind: "prompt:string", key: title, chosen: answer, from: override != null ? "spec" : "auto"});
		return answer;
	}

	/**
	 * @param {*} opts see `InputUiUtil.pGetUserNumber`
	 */
	async _answerNumber (opts) {
		const title = opts?.title || null;
		const override = this._picker.peekOverride("prompts", title);
		const answer = override != null && !isNaN(Number(override))
			? Number(override)
			: (opts?.default != null ? Number(opts.default) : (opts?.min != null ? Number(opts.min) : 0));
		this._report.record({kind: "prompt:number", key: title, chosen: String(answer), from: override != null ? "spec" : "auto"});
		return answer;
	}

	/**
	 * Fallback for bespoke modals we have no answerer for.
	 *
	 * Returns a stub whose `doClose` has already been called, so the caller's
	 * `cbClose`/`pGetResolved` path resolves as "cancelled" instead of waiting on
	 * a modal nobody will ever click. The title is recorded so the gap is visible
	 * in the report (and fails the CLI / e2e spec).
	 *
	 * @param {*} owner
	 * @param {*} opts
	 * @param {string} [key]
	 */
	async _answerUnknownModal (owner, opts, key = "pGetShowModal") {
		const title = opts?.title || "(untitled modal)";
		this._report.markUnhandledPrompt(title);

		// Build the real modal so the caller's DOM operations don't explode, then
		// close it on the next tick.
		const patch = this._patches.find(p => p.obj === owner && p.key === key);
		const original = patch?.original;		if (typeof original !== "function") {
			// No original to fall back on — hand back an inert stub.
			return {
				eleModalInner: typeof document !== "undefined" ? document.createElement("div") : null,
				doClose: () => {},
				pGetResolved: async () => [false],
				doAutoResize: () => {},
			};
		}

		const handle = await original.call(owner, {...opts, isPermanent: false});
		setTimeout(() => {
			try { handle.doClose(false); } catch (e) { void e; }
		}, 0);
		return handle;
	}
}

export {CharacterSheetSpawnPrompts};
globalThis.CharacterSheetSpawnPrompts = CharacterSheetSpawnPrompts;
