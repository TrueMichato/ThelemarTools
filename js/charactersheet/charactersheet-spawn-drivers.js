/**
 * Character Sheet Spawner — wizard drivers and orchestration
 *
 * Turns a spawn spec into a finished character by driving the REAL Builder and
 * Quick Build wizards. Nothing here reimplements build logic: identity fields
 * the spec names outright (race, class, subclass, background, abilities, level)
 * are assigned to the same `_selected*` / `_selections` fields the wizards use,
 * every remaining choice is made by operating the controls the wizard renders,
 * and the wizards' own apply methods do all the work.
 *
 * That constraint is the point of the whole feature: a character spawned today
 * exercises today's build engines, so a fix that landed this morning cannot be
 * "missing" from a spawned repro the way it is missing from a character built
 * last week.
 */

import {CharacterSheetSpawnRng, CharacterSheetSpawnSpec, CharacterSheetSpawnResolve, CharacterSheetSpawnReport, CharacterSheetSpawnPicker} from "./charactersheet-spawn.js";
import {CharacterSheetSpawnPrompts} from "./charactersheet-spawn-prompts.js";
import {CharacterSheetSpawnAutoFill} from "./charactersheet-spawn-autofill.js";
import {CharacterSheetClassUtils} from "./charactersheet-class-utils.js";

const {Parser} = /** @type {*} */ (globalThis);

/**
 * Drives the Builder wizard to a finished level-1 character.
 */
class CharacterSheetSpawnBuilderDriver {
	/** Builder step indices, in the order they must be applied. */
	static _STEPS = [
		{ix: 0, id: "name"},
		{ix: 1, id: "race"},
		{ix: 2, id: "background"},
		{ix: 3, id: "class"},
		{ix: 4, id: "abilities"},
		{ix: 5, id: "equipment"},
		{ix: 6, id: "spells"},
	];

	/** Standard array, highest first — paired with {@link _abilityPriority}. */
	static _STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

	/**
	 * @param {{page: *, spec: *, resolved: *, picker: *, report: *}} opts
	 */
	constructor ({page, spec, resolved, picker, report}) {
		this._page = page;
		this._builder = page._builder;
		this._spec = spec;
		this._resolved = resolved;
		this._picker = picker;
		this._report = report;
	}

	/**
	 * @returns {Promise<?*>} Quick Build launch data when the spec asks for a level
	 *   above 1, exactly as the wizard's own Finish button produces it.
	 */
	async run () {
		const b = this._builder;
		if (!b) throw new Error("Character Builder is unavailable");

		b.resetSelections();

		const primary = this._resolved.classes[0];
		b._selectedRace = this._resolved.race;
		b._selectedSubrace = this._resolved.subrace;
		b._selectedBackground = this._resolved.background;
		b._selectedClass = primary.classData;
		b._selectedSubclass = primary.subclass;
		// Level 1 always comes from the Builder; anything above is Quick Build's job,
		// and this field is what hands the build over.
		b._quickBuildTargetLevel = this._resolved.totalLevel;

		for (const step of CharacterSheetSpawnBuilderDriver._STEPS) {
			await this._runStep(step);
		}

		return b._finishCharacterCore();
	}

	/**
	 * @param {{ix: number, id: string}} step
	 */
	async _runStep ({ix, id}) {
		const b = this._builder;
		b._currentStep = ix;

		if (ix === 4) this._seedAbilityScores();

		b._renderCurrentStep();
		if (ix === 0) this._applyName();

		const content = typeof document !== "undefined" ? document.getElementById("charsheet-builder-content") : null;
		if (content) {
			await new CharacterSheetSpawnAutoFill({root: content, picker: this._picker, report: this._report, level: 1}).run();
		}

		// `_validateCurrentStep` toasts rather than throws, so treat it as advisory:
		// note the gap and keep building. A half-built character that says *why* it
		// is half-built beats a spawn that silently aborts.
		if (typeof b._validateCurrentStep === "function" && !b._validateCurrentStep()) {
			this._report.markUnresolved(`Builder step "${id}" did not validate — some choices are missing`);
		}

		await b._applyCurrentStep();
	}

	_applyName () {
		const input = /** @type {*} */ (document.getElementById("builder-name-step"));
		if (!input) return;
		input.value = this._resolved.name;
		input.dispatchEvent(new Event("input", {bubbles: true}));
	}

	/**
	 * Assign the standard array by class priority, so a spawned Wizard is smart and
	 * a spawned Barbarian is strong without the spec having to say so. An explicit
	 * `abilities` block in the spec wins outright.
	 */
	_seedAbilityScores () {
		const b = this._builder;
		const explicit = this._spec.abilities;
		const scores = {str: null, dex: null, con: null, int: null, wis: null, cha: null};

		if (explicit) {
			for (const abl of Object.keys(scores)) {
				if (explicit[abl] != null) scores[abl] = Number(explicit[abl]);
			}
		}

		const pool = [...CharacterSheetSpawnBuilderDriver._STANDARD_ARRAY];
		for (const abl of this._abilityPriority()) {
			if (scores[abl] != null) continue;
			scores[abl] = pool.shift() ?? 10;
		}

		b._abilityMethod = "standard";
		b._abilityScores = scores;
		b._standardArrayPool = pool;
		for (const [abl, score] of Object.entries(scores)) {
			this._report.record({kind: "ability", key: abl, chosen: score, from: explicit?.[abl] != null ? "spec" : "auto"});
		}
	}

	/**
	 * Abilities in the order this class wants them, best first.
	 * @returns {string[]}
	 */
	_abilityPriority () {
		return CharacterSheetSpawnClassUtil.abilityPriority(this._resolved);
	}
}

/**
 * Drives the Quick Build wizard from level 1 to the spec's target level,
 * including multiclass legs.
 */
class CharacterSheetSpawnQuickBuildDriver {
	/**
	 * @param {{page: *, spec: *, resolved: *, picker: *, report: *}} opts
	 */
	constructor ({page, spec, resolved, picker, report}) {
		this._page = page;
		this._qb = page._quickBuild;
		this._spec = spec;
		this._resolved = resolved;
		this._picker = picker;
		this._report = report;
	}

	/**
	 * @param {*} launchData - as returned by the Builder's finish routine
	 */
	async run (launchData) {
		const qb = this._qb;
		if (!qb) throw new Error("Quick Build is unavailable");

		await qb.showFromBuilder(launchData);
		this._seedMulticlassLegs();
		await this._runWizard();
	}

	/**
	 * `showFromBuilder` sets up a single class leg taking every level. Redistribute
	 * those levels across the spec's legs and pre-seed each leg's subclass, then
	 * re-render so the Target step reflects it.
	 */
	_seedMulticlassLegs () {
		const qb = this._qb;
		const legs = this._resolved.classes;

		qb._classAllocations = legs.map((leg, i) => ({
			className: leg.classData.name,
			classSource: leg.classData.source,
			classData: leg.classData,
			currentLevel: i === 0 ? 1 : 0,
			targetLevel: leg.level,
			subclass: leg.subclass || null,
		}));

		for (const leg of legs) {
			if (!leg.subclass) continue;
			qb._selections.subclasses[`${leg.classData.name}_${leg.classData.source}`] = leg.subclass;
			this._report.record({kind: "subclass", key: leg.classData.name, chosen: leg.subclass.name, from: "spec"});
		}

		qb._renderCurrentStep();
	}

	/**
	 * Walk the wizard: fill whatever the current step renders, press Next, repeat.
	 * The step list is rebuilt as choices are made (picking a subclass can add a
	 * Feature Choices step), so the loop is driven by the wizard's own state rather
	 * than a precomputed step list.
	 */
	async _runWizard () {
		const qb = this._qb;
		const maxIterations = 80;

		for (let i = 0; i < maxIterations; ++i) {
			if (!qb.isActive) return;

			const content = document.getElementById("quickbuild-content");
			const stepId = qb._steps?.[qb._currentStep]?.id || `step ${qb._currentStep}`;
			const before = qb._currentStep;

			if (content) {
				await new CharacterSheetSpawnAutoFill({root: content, picker: this._picker, report: this._report}).run();
			}

			await qb._nextStep();
			if (!qb.isActive) return;

			if (qb._currentStep === before) {
				// Either validation refused, or the step list was rebuilt in place.
				// One more fill pass distinguishes the two: if it finds nothing left to
				// choose, the wizard is genuinely stuck and pressing Next again would
				// loop forever.
				const again = document.getElementById("quickbuild-content");
				const made = again
					? await new CharacterSheetSpawnAutoFill({root: again, picker: this._picker, report: this._report}).run()
					: 0;
				if (!made) {
					this._report.markUnresolved(`Quick Build stalled on step "${stepId}" — an unrecognised choice is blocking it`);
					this._forceClose();
					return;
				}
			}
		}

		this._report.markUnresolved(`Quick Build did not finish within ${maxIterations} steps`);
		this._forceClose();
	}

	_forceClose () {
		try {
			this._qb._closeWizard?.(true);
		} catch (e) {
			this._report.warn(`Quick Build overlay could not be closed: ${(/** @type {*} */ (e)).message}`);
		}
	}
}

/**
 * Public entry point: spec in, finished character out.
 */
class CharacterSheetSpawner {
	/** @param {*} page */
	constructor (page) {
		this._page = page;
		/** @type {?*} */ this._lastReport = null;
	}

	/** @returns {?*} the report from the most recent spawn */
	get lastReport () { return this._lastReport; }

	/**
	 * Build a character from a spec.
	 *
	 * @param {string|Object} specInput
	 * @param {{seed?: ?string, name?: ?string, save?: boolean, strict?: boolean}} [opts]
	 * @returns {Promise<*>} the spawn report
	 */
	async spawn (specInput, {seed = null, name = null, save = true, strict = false} = {}) {
		const spec = CharacterSheetSpawnSpec.parse(specInput);
		if (seed != null) spec.seed = String(seed);
		if (name != null) spec.name = String(name);

		const concreteSeed = CharacterSheetSpawner._resolveSeed(spec);
		spec.seed = concreteSeed;

		const rng = new CharacterSheetSpawnRng(concreteSeed);
		const report = new CharacterSheetSpawnReport(spec);
		const picker = new CharacterSheetSpawnPicker({spec, rng, report});
		this._lastReport = report;

		const resolved = this._resolve(spec, rng, report);
		// Ability option lists (racial +2/+1, ASI, …) follow the class's priority
		// rather than the seed, so a spawned character is always playable.
		picker.setAbilityPriority(CharacterSheetSpawnClassUtil.abilityPriority(resolved));
		picker.setSourcePreference(CharacterSheetSpawnClassUtil.sourcePreference(resolved));

		const prompts = new CharacterSheetSpawnPrompts({page: this._page, picker, report, spec});
		prompts.install();
		try {
			if (this._page._currentCharacterId && await this._page.saveCharacter() === false) {
				throw new Error(`Could not save the current character; spawn was cancelled.`);
			}
			this._page._createNewCharacter();
			if (this._page._selCharacter) this._page._selCharacter.value = "";

			const launchData = await new CharacterSheetSpawnBuilderDriver({page: this._page, spec, resolved, picker, report}).run();
			if (launchData) {
				await new CharacterSheetSpawnQuickBuildDriver({page: this._page, spec, resolved, picker, report}).run(launchData);
			}

			this._stampMeta(spec, report, resolved);
			if (save) await this._persist();
		} finally {
			prompts.uninstall();
			picker.reportUnusedOverrides();
			report.finish();
		}

		if (strict && !report.isClean) {
			throw new Error(`Spawn was not clean:\n${report.toText()}`);
		}
		return report;
	}

	/**
	 * Build a fresh character from the current one's stored spec — never in place,
	 * so a hand-tuned character is not clobbered by a rebuild. This is the answer
	 * to "was this bug fixed?": respawn and compare.
	 *
	 * @param {{seed?: ?string, save?: boolean, strict?: boolean}} [opts]
	 */
	async respawn (opts = {}) {
		const meta = this._page._state?.getSpawnMeta?.();
		if (!meta?.spec) throw new Error("This character was not spawned, so there is no spec to respawn from");
		return this.spawn(meta.spec, {seed: opts.seed ?? meta.seed, ...opts});
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Internals
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * A spec with no seed is deterministic: the seed is derived from the spec
	 * itself, so the same text always yields the same character. `seed: "random"`
	 * opts into variety, and the concrete seed is recorded so a surprising result
	 * can be pinned.
	 *
	 * @param {*} spec
	 * @returns {string}
	 */
	static _resolveSeed (spec) {
		if (!spec.seed) return CharacterSheetSpawnSpec.toSeedKey(spec);
		if (String(spec.seed).toLowerCase() === "random") return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		return String(spec.seed);
	}

	/**
	 * Turn the names in a spec into catalog entities, respecting the sheet's own
	 * source filtering so a spawn can never build something the user has disabled.
	 *
	 * @param {*} spec
	 * @param {*} rng
	 * @param {*} report
	 */
	_resolve (spec, rng, report) {
		const page = this._page;
		const allClasses = page.filterByAllowedSources(page.getClasses());
		const allRaces = page.filterByAllowedSources(page.getRaces());
		const allBackgrounds = page.filterByAllowedSources(page.getBackgrounds());

		if (!spec.classes.length) throw new Error("Spawn spec has no class");

		const classes = spec.classes.map((/** @type {*} */ leg) => {
			const classData = CharacterSheetSpawnResolve.findByName(allClasses, leg.name, {source: leg.source});
			if (!classData) {
				throw new Error(`Unknown class "${leg.name}". Did you mean: ${CharacterSheetSpawnResolve.suggest(allClasses, leg.name).join(", ")}?`);
			}

			const subclassPool = page.filterByAllowedSources(classData.subclasses || []);
			let subclass = null;
			if (leg.subclass) {
				subclass = CharacterSheetSpawnResolve.findByName(subclassPool, leg.subclass, {source: leg.subclassSource, nameKeys: ["name", "shortName"]});
				if (!subclass) {
					throw new Error(`Unknown ${classData.name} subclass "${leg.subclass}". Available: ${CharacterSheetSpawnResolve.suggest(subclassPool, leg.subclass, 10).join(", ")}`);
				}
				report.record({kind: "subclass", key: classData.name, chosen: subclass.name, from: "spec"});
			} else if (subclassPool.length && CharacterSheetSpawnClassUtil.grantsSubclassAtLevel1(classData)) {
				// Classes that choose a subclass at level 1 cannot be built without one.
				subclass = rng.pick(subclassPool);
				report.record({kind: "subclass", key: classData.name, chosen: subclass?.name, from: "auto", options: subclassPool});
			}

			return {classData, subclass, level: leg.level};
		});

		const totalLevel = classes.reduce((sum, /** @type {*} */ c) => sum + c.level, 0);
		if (totalLevel > 20) throw new Error(`Spawn spec totals level ${totalLevel} (max 20)`);

		/** @type {*} */ let race = null;
		if (spec.race) {
			const found = CharacterSheetSpawnResolve.findRace(allRaces, spec.race, spec.subrace, rng);
			race = found.race;
			if (!race) throw new Error(`Unknown species "${spec.race}". Did you mean: ${CharacterSheetSpawnResolve.suggest(allRaces, spec.race).join(", ")}?`);
			report.record({kind: "race", chosen: race.name, from: "spec"});
		} else {
			race = rng.pick(allRaces);
			report.record({kind: "race", chosen: race?.name, from: "auto", options: allRaces});
		}

		/** @type {*} */ let background = null;
		if (spec.background) {
			background = CharacterSheetSpawnResolve.findByName(allBackgrounds, spec.background);
			if (!background) throw new Error(`Unknown background "${spec.background}". Did you mean: ${CharacterSheetSpawnResolve.suggest(allBackgrounds, spec.background).join(", ")}?`);
			report.record({kind: "background", chosen: background.name, from: "spec"});
		} else {
			background = rng.pick(allBackgrounds);
			report.record({kind: "background", chosen: background?.name, from: "auto", options: allBackgrounds});
		}

		const name = spec.name || CharacterSheetSpawner._defaultName(classes, race, totalLevel);

		return {classes, race, subrace: null, background, totalLevel, name};
	}

	/**
	 * A name that says what the character is, so a list of spawned test characters
	 * is readable at a glance.
	 *
	 * @param {*[]} classes
	 * @param {*} race
	 * @param {number} totalLevel
	 */
	static _defaultName (classes, race, totalLevel) {
		const legs = classes.map((/** @type {*} */ c) => c.subclass ? `${c.subclass.shortName || c.subclass.name} ${c.classData.name}` : c.classData.name).join("/");
		return `${race?.name || "Test"} ${legs} ${totalLevel}`;
	}

	/**
	 * Record how this character came to exist. Without this a spawned character is
	 * indistinguishable from a hand-built one, and "respawn with today's code"
	 * becomes impossible.
	 *
	 * @param {*} spec
	 * @param {*} report
	 * @param {*} resolved
	 */
	_stampMeta (spec, report, resolved) {
		const state = this._page._state;
		if (!state?.setSpawnMeta) return;
		state.setSpawnMeta({
			spec: CharacterSheetSpawnSpec.toJson(spec),
			shortSpec: CharacterSheetSpawnSpec.toShortString(spec),
			pinnedSpec: report.toPinnedSpec(),
			seed: report.seed,
			spawnedAt: new Date().toISOString(),
			totalLevel: resolved.totalLevel,
			isClean: report.isClean,
		});
	}

	async _persist () {
		const page = this._page;
		if (await page.saveCharacter() === false) throw new Error(`Could not save the spawned character.`);
		if (page._pLoadCharacters) await page._pLoadCharacters();
		if (page._selCharacter) page._selCharacter.value = page._currentCharacterId;
	}
}

/**
 * Small class-shape helpers the spawner needs but that have no home elsewhere.
 */
class CharacterSheetSpawnClassUtil {
	/**
	 * Books that are always in scope, whatever the character is built from. Deliberately
	 * player-facing only — XDMG in particular would re-admit the modern firearms that make
	 * a spawned martial look absurd.
	 */
	static CORE_SOURCES = ["PHB", "XPHB", "TGTT"];

	/**
	 * The sources a spawned character should draw open-ended options from: its own
	 * class / subclass / race / background sources, plus the core books. Anything else
	 * (Spelljammer laser rifles, one-off adventure gear) is a distraction in a test
	 * character, so the picker de-prioritises it.
	 *
	 * @param {*} resolved
	 * @returns {string[]}
	 */
	static sourcePreference (resolved) {
		const out = new Set(CharacterSheetSpawnClassUtil.CORE_SOURCES);
		const add = (/** @type {*} */ ent) => { if (ent?.source) out.add(String(ent.source).toUpperCase()); };
		(resolved?.classes || []).forEach((/** @type {*} */ leg) => { add(leg.classData); add(leg.subclass); });
		add(resolved?.race);
		add(resolved?.subrace);
		add(resolved?.background);
		// Base weapons/armour carry no book of their own in some data sets.
		out.add("PHB");
		return [...out];
	}

	/**
	 * Abilities in the order the primary class wants them, best first.
	 * @param {*} resolved
	 * @returns {string[]}
	 */
	static abilityPriority (resolved) {
		const cls = resolved.classes[0]?.classData;
		const sub = resolved.classes[0]?.subclass;
		/** @type {string[]} */ const out = [];
		/** @param {*} abl */
		const push = (abl) => {
			const key = String(abl ?? "").toLowerCase().slice(0, 3);
			if (Parser.ABIL_ABVS.includes(key) && !out.includes(key)) out.push(key);
		};

		push(sub?.spellcastingAbility || cls?.spellcastingAbility);
		for (const entry of cls?.primaryAbility || []) {
			if (typeof entry === "string") push(entry);
			else if (entry && typeof entry === "object") Object.entries(entry).forEach(([abl, on]) => { if (on) push(abl); });
		}
		// Constitution and Dexterity before the class's saving throws: a Warlock's
		// Wisdom save proficiency should not outrank its hit points.
		push("con");
		push("dex");
		for (const save of cls?.proficiency || []) push(save);
		for (const abl of Parser.ABIL_ABVS) push(abl);
		return out;
	}

	/**
	 * Whether a class picks its subclass at level 1 (Cleric, Sorcerer, Warlock in
	 * 2014; almost nothing in 2024). Determined from the class's own feature data
	 * rather than a hardcoded list, so homebrew classes work automatically.
	 *
	 * @param {*} classData
	 * @returns {boolean}
	 */
	static grantsSubclassAtLevel1 (classData) {
		if (typeof CharacterSheetClassUtils?.levelGrantsSubclass === "function") {
			return !!CharacterSheetClassUtils.levelGrantsSubclass(classData, 1);
		}
		return (classData?.classFeatures || []).some((/** @type {*} */ f, /** @type {number} */ i) => i === 0 && typeof f === "object" && f.gainSubclassFeature);
	}
}

export {CharacterSheetSpawnBuilderDriver, CharacterSheetSpawnQuickBuildDriver, CharacterSheetSpawner, CharacterSheetSpawnClassUtil};
globalThis.CharacterSheetSpawnBuilderDriver = CharacterSheetSpawnBuilderDriver;
globalThis.CharacterSheetSpawnQuickBuildDriver = CharacterSheetSpawnQuickBuildDriver;
globalThis.CharacterSheetSpawner = CharacterSheetSpawner;
globalThis.CharacterSheetSpawnClassUtil = CharacterSheetSpawnClassUtil;
