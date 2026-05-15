import {SITE_STYLE__CLASSIC} from "../consts.js";
import {CharacterSheetState} from "./charactersheet-state.js";
import {CharacterSheetBuilder} from "./charactersheet-builder.js";
import {CharacterSheetCombat} from "./charactersheet-combat.js";
import {CharacterSheetSpells} from "./charactersheet-spells.js";
import {CharacterSheetInventory} from "./charactersheet-inventory.js";
import {CharacterSheetFeatures} from "./charactersheet-features.js";
import {CharacterSheetRest} from "./charactersheet-rest.js";
import {CharacterSheetExport} from "./charactersheet-export.js";
import {CharacterSheetLevelUp} from "./charactersheet-levelup.js";
import {CharacterSheetLayout} from "./charactersheet-layout.js";
import {CharacterSheetNotes} from "./charactersheet-notes.js";
import {CharacterSheetRollHistory} from "./charactersheet-rollhistory.js";
import {CharacterSheetCustomAbilities} from "./charactersheet-customabilities.js";
import {CharacterSheetQuickBuild} from "./charactersheet-quickbuild.js";
import {CharacterSheetClassUtils} from "./charactersheet-class-utils.js";
import {CharacterSheetSpellPicker} from "./charactersheet-spell-picker.js";
import {CharacterSheetUpgrades} from "./charactersheet-upgrades.js";
import {CharacterSheetPlayMode} from "./charactersheet-playmode.js";

const {e_, ee, Parser, Renderer, JqueryUtil, UiUtil, InputUiUtil, MiscUtil, UrlUtil, StorageUtil, DataUtil, BrewUtil2, PrereleaseUtil} = /** @type {*} */ (globalThis);

/**
 * Character Sheet - Main Controller
 * Orchestrates all character sheet functionality
 */
class CharacterSheetPage {
	constructor () {
		this._state = new CharacterSheetState();
		this._builder = null;
		this._combat = null;
		this._spells = null;
		this._inventory = null;
		this._features = null;
		this._rest = null;
		this._export = null;
		this._levelUp = null;
		this._layout = null;
		this._notes = null;
		this._customAbilities = null;
		this._quickBuild = null;
		this._upgrades = null;
		this._playMode = null;
		// Forward-compat module slots (referenced by other modules; assigned externally if wired)
		/** @type {*} */
		this._spellsModule = null;
		/** @type {*} */
		this._combatModule = null;
		/** @type {*} */
		this._customAbilitiesPanel = null;

		this._selCharacter = /** @type {*} */ (null);
		this._currentCharacterId = null;
		this._isLevelUpBannerDismissed = false;

		// Data caches
		this._races = [];
		this._classes = [];
		this._subclasses = [];
		this._classFeatures = [];
		this._subclassFeatures = [];
		this._backgrounds = [];
		this._spellsData = [];
		this._itemsData = [];
		this._featsData = [];
		this._optionalFeaturesData = [];
		this._combatMethodsData = [];
		this._itemUpgradesData = [];
		this._skillsData = [];
		this._conditionsData = [];
		this._languagesData = [];
		this._dialectParentMap = {};
	}

	async pInit () {
		await this._pLoadData();
		this._initUi();
		this._initEventListeners();
		await this._pLoadCharacters();

		// Initialize sub-modules with error handling
		/* eslint-disable no-console */
		try {
			this._builder = new CharacterSheetBuilder(this);
		} catch (e) { console.error("Failed to init builder:", e); }

		try {
			this._combat = new CharacterSheetCombat(this);
		} catch (e) { console.error("Failed to init combat:", e); }

		try {
			this._spells = new CharacterSheetSpells(this);
		} catch (e) { console.error("Failed to init spells:", e); }

		try {
			this._inventory = new CharacterSheetInventory(this);
		} catch (e) { console.error("Failed to init inventory:", e); }

		try {
			this._features = new CharacterSheetFeatures(this);
		} catch (e) { console.error("Failed to init features:", e); }

		try {
			this._rest = new CharacterSheetRest(this);
		} catch (e) { console.error("Failed to init rest:", e); }

		try {
			this._export = new CharacterSheetExport(this);
		} catch (e) { console.error("Failed to init export:", e); }

		try {
			this._levelUp = new CharacterSheetLevelUp(this);
		} catch (e) { console.error("Failed to init levelUp:", e); }

		try {
			this._layout = new CharacterSheetLayout(this);
		} catch (e) { console.error("Failed to init layout:", e); }

		try {
			this._notes = new CharacterSheetNotes(this);
		} catch (e) { console.error("Failed to init notes:", e); }

		try {
			this._rollHistory = new CharacterSheetRollHistory(this);
		} catch (e) { console.error("Failed to init rollHistory:", e); }

		try {
			this._customAbilities = new CharacterSheetCustomAbilities(this);
		} catch (e) { console.error("Failed to init customAbilities:", e); }

		try {
			this._quickBuild = new CharacterSheetQuickBuild(this);
		} catch (e) { console.error("Failed to init quickBuild:", e); }

		try {
			this._upgrades = new CharacterSheetUpgrades(this);
		} catch (e) { console.error("Failed to init upgrades:", e); }

		try {
			this._playMode = new CharacterSheetPlayMode(this);
			this._playMode.init();
		} catch (e) { console.error("Failed to init playMode:", e); }

		try {
			this._respec = new CharacterSheetRespec({page: this, state: this._state});
			this._respec.init();
		} catch (e) { console.error("Failed to init respec:", e); }
		/* eslint-enable no-console */

		// Pass loaded data to modules
		if (this._inventory) this._inventory.setItems(this._itemsData);
		if (this._combat) this._combat.setItems(this._itemsData);
		if (this._features) this._features.setFeats(this._featsData);
		if (this._spells) this._spells.setSpells(this._spellsData);
		if (this._upgrades) this._upgrades.setUpgrades(this._itemUpgradesData);

		// Check for character in URL
		const urlParams = new URLSearchParams(window.location.search);
		const charId = urlParams.get("id");
		if (charId) {
			await this._pLoadCharacter(charId);
		}

		// Apply background theme (will use default if no character loaded)
		this._applyBackgroundTheme(this._state.getBackgroundTheme());

		// Remove loading overlay now that init is complete
		const elOverlay = document.querySelector("#charsheet-loading-overlay");
		if (elOverlay) {
			(/** @type {*} */ (elOverlay)).style.opacity = "0";
			setTimeout(() => elOverlay.remove(), 300);
		}

		// Add page unload protection - save current character before leaving
		window.addEventListener("beforeunload", () => {
			if (this._currentCharacterId) {
				// Use synchronous localStorage for reliability on page unload
				try {
					const characters = JSON.parse(localStorage.getItem("charsheet-characters") || "[]");
					const charData = this._state.toJson();
					charData.id = this._currentCharacterId;

					const existingIndex = characters.findIndex(c => c.id === this._currentCharacterId);
					if (existingIndex >= 0) {
						characters[existingIndex] = charData;
					} else {
						characters.push(charData);
					}

					localStorage.setItem("charsheet-characters", JSON.stringify(characters));
				} catch (err) {
					// eslint-disable-next-line no-console
					console.error("Emergency save on unload failed:", err);
				}
			}
		});

		// Also add pagehide as fallback (more reliable on mobile)
		window.addEventListener("pagehide", () => {
			if (this._currentCharacterId) {
				try {
					const characters = JSON.parse(localStorage.getItem("charsheet-characters") || "[]");
					const charData = this._state.toJson();
					charData.id = this._currentCharacterId;

					const existingIndex = characters.findIndex(c => c.id === this._currentCharacterId);
					if (existingIndex >= 0) {
						characters[existingIndex] = charData;
					} else {
						characters.push(charData);
					}

					localStorage.setItem("charsheet-characters", JSON.stringify(characters));
				} catch (err) {
					// eslint-disable-next-line no-console
					console.error("Emergency save on pagehide failed:", err);
				}
			}
		});
	}

	async _pLoadData () {
		// Load all necessary data in parallel
		// Note: Using loadRawJSON for classes to get classFeature and subclassFeature arrays
		// Also pre-cache class/subclass features in DataLoader so hover links work properly
		const [races, classes, backgrounds, spells, items, brewItems, prereleaseItems, feats, optFeatures, skills, conditionsData, languagesData, combatMethods, itemUpgrades, prereleaseData, brewData, variantComponents] = await Promise.all([
			DataUtil.race.loadJSON(),
			DataUtil.class.loadRawJSON(),
			DataUtil.loadJSON("data/backgrounds.json"),
			DataUtil.spell.pLoadAll(),
			// Use DataUtil.item.loadJSON/loadBrew/loadPrerelease so brew items go through the
			// full enhancement pipeline (generic variant generation + property/mastery merging)
			// — same path used by items.html. Otherwise brew weapons lack mastery/property fields.
			DataUtil.item.loadJSON().then(d => d.item || []),
			DataUtil.item.loadBrew().then(d => d.item || []).catch(() => []),
			DataUtil.item.loadPrerelease().then(d => d.item || []).catch(() => []),
			DataUtil.loadJSON("data/feats.json"),
			DataUtil.loadJSON("data/optionalfeatures.json"),
			DataUtil.loadJSON("data/skills.json"),
			DataUtil.loadJSON("data/conditionsdiseases.json"),
			DataUtil.loadJSON("data/languages.json"),
			DataUtil.combatmethod.loadJSON().catch(() => ({combatMethod: []})),
			DataUtil.itemUpgrade.loadJSON().catch(() => ({itemUpgrade: []})),
			// Load homebrew/prerelease data (for non-item entities)
			PrereleaseUtil.pGetBrewProcessed(),
			BrewUtil2.pGetBrewProcessed(),
			// Load variant spell components (Arcadia 8)
			DataUtil.loadJSON("data/items-variant-components-ar8.json").catch(() => ({item: []})),
		]);

		// Base site data
		// Merge subraces into races to get _baseName, _baseSource properties for subrace grouping
		// Also expand _versions for 2024 races that use version system instead of subraces
		this._races = this._processRaceData(races.race || []);
		this._classes = classes.class || [];
		this._subclasses = classes.subclass || [];
		this._classFeatures = classes.classFeature || [];
		this._subclassFeatures = classes.subclassFeature || [];
		this._backgrounds = backgrounds.background || [];
		this._spellsData = spells;
		// Filter out item groups which are not actual items.
		// Merge site + prerelease + brew + variant component items here (all already enhanced by DataUtil.item.*).
		this._itemsData = [...(items || []), ...(prereleaseItems || []), ...(brewItems || []), ...(variantComponents.item || [])]
			.filter(it => !it._isItemGroup);
		this._featsData = feats.feat || [];
		this._optionalFeaturesData = optFeatures.optionalfeature || [];
		this._combatMethodsData = (combatMethods.combatMethod || []).map(m => ({...m, _entityType: "combatMethod"}));
		this._itemUpgradesData = (itemUpgrades.itemUpgrade || []).map(u => ({...u, _entityType: "itemUpgrade"}));
		this._skillsData = skills.skill || [];
		this._conditionsData = conditionsData.condition || [];
		this._languagesData = languagesData.language || [];

		// Pre-cache class/subclass features in DataLoader so hover links work properly
		// This runs in parallel with the data processing below
		this._pPreCacheEntityData();

		// Merge prerelease/homebrew data
		this._mergeBrewData(prereleaseData);
		this._mergeBrewData(brewData);

		// Build dialect→parent language lookup (e.g., "Aquan" → Primordial)
		this._buildDialectParentMap();

		// Attach subclasses to their parent classes for easier access
		this._classes.forEach(cls => {
			cls.subclasses = this._subclasses.filter(sc => {
				// Match by class name
				if (sc.className !== cls.name) return false;

				// Match by class source - be flexible with source matching for homebrew compatibility
				const scClassSource = sc.classSource || Parser.SRC_PHB;

				// Direct source match
				if (scClassSource === cls.source) return true;

				// Allow XPHB subclasses to match with PHB classes and vice versa
				if ((scClassSource === Parser.SRC_PHB && cls.source === Parser.SRC_XPHB)
					|| (scClassSource === Parser.SRC_XPHB && cls.source === Parser.SRC_PHB)) {
					return true;
				}

				// Allow homebrew subclasses targeting XPHB/PHB to match with homebrew classes of the same name
				// This handles cases like TGTT subclasses that target base classes
				const isBaseSource = [Parser.SRC_PHB, Parser.SRC_XPHB].includes(scClassSource);
				const isClassHomebrew = ![Parser.SRC_PHB, Parser.SRC_XPHB].includes(cls.source);
				if (isBaseSource && isClassHomebrew) {
					return true;
				}

				// Also allow homebrew subclasses to match base classes
				// This handles cases where a homebrew subclass should work with the standard class
				const isSubclassHomebrew = ![Parser.SRC_PHB, Parser.SRC_XPHB].includes(sc.source);
				const isClassBase = [Parser.SRC_PHB, Parser.SRC_XPHB].includes(cls.source);
				if (isSubclassHomebrew && isClassBase && scClassSource !== cls.source) {
					// Check if subclass classSource points to one of the base sources
					if (scClassSource === Parser.SRC_PHB || scClassSource === Parser.SRC_XPHB) {
						return true;
					}
				}

				// Allow homebrew subclasses with homebrew classSource to match base classes of the same name
				// This handles cases like TGTT "Circle of the Zodiac" (classSource: "TGTT") targeting base Druid
				if (isSubclassHomebrew && isClassBase && scClassSource === sc.source) {
					return true;
				}

				return false;
			});
		});
	}

	/**
	 * Pre-cache entity data in DataLoader for hover tooltips
	 * Covers class/subclass features and item upgrades
	 * Runs in parallel and doesn't block page initialization
	 */
	async _pPreCacheEntityData () {
		try {
			await Promise.all([
				DataLoader.pCacheAndGetAllSite("classFeature"),
				DataLoader.pCacheAndGetAllSite("subclassFeature"),
				DataLoader.pCacheAndGetAllPrerelease("classFeature"),
				DataLoader.pCacheAndGetAllPrerelease("subclassFeature"),
				DataLoader.pCacheAndGetAllBrew("classFeature"),
				DataLoader.pCacheAndGetAllBrew("subclassFeature"),
				DataLoader.pCacheAndGetAllSite("itemUpgrade"),
				DataLoader.pCacheAndGetAllPrerelease("itemUpgrade"),
				DataLoader.pCacheAndGetAllBrew("itemUpgrade"),
			]);

			// Pre-cache variant component items (Ar8) so hover tooltips work.
			// These items aren't in the standard item loading pipeline, so we inject
			// them into the DataLoader cache manually.
			const vcItems = (this._itemsData || []).filter(it => it.source === "Ar8");
			if (vcItems.length) {
				vcItems.forEach(it => it.__prop = it.__prop || "item");
				DataLoader._pCache_addToCache({allDataMerged: {item: vcItems}, propAllowlist: new Set(["item"])});
			}
		} catch (e) {
			// Non-critical - just means some hover links may not work
			// eslint-disable-next-line no-console
			console.warn("[CharSheet] Failed to pre-cache entity data for hovers:", e);
		}
	}

	/**
	 * Process race data by merging subraces and expanding _versions
	 * For 2024 races (XPHB), races may use _versions instead of subraces
	 * @param {Array} rawRaces - Raw race array from data file
	 * @returns {Array} Processed race array with _baseName/_baseSource set appropriately
	 */
	_processRaceData (rawRaces) {
		const out = [];

		for (const race of rawRaces) {
			// First, check if this race has _versions that need expansion
			const hasVersions = race._versions?.length > 0;
			let expandedVersions = [];

			if (hasVersions) {
				try {
					// Expand versions using DataUtil - this creates full entity copies with modifications
					expandedVersions = DataUtil.generic.getVersions(
						{...race, __prop: "race"},
						{isExternalApplicationIdentityOnly: false},
					);

					// Set _baseName/_baseSource on versions so they group with the base race
					for (const version of expandedVersions) {
						version._baseName = race.name;
						version._baseSource = race.source;
						version.__prop = "race";
					}
				} catch (e) {
					// eslint-disable-next-line no-console
					console.warn("[CharSheet] Failed to expand race versions for:", race.name, e);
				}
			}

			// Merge subraces using the standard method
			// This handles traditional subraces and sets _baseName/_baseSource
			// Only add base race entries if there are subraces OR versions
			const hasSubraces = race.subraces?.length > 0;
			const mergedSubraces = Renderer.race.mergeSubraces([race], {isAddBaseRaces: hasSubraces || expandedVersions.length > 0});
			out.push(...mergedSubraces);

			// Add expanded versions
			if (expandedVersions.length) {
				out.push(...expandedVersions);
			}
		}

		return out;
	}

	/**
	 * Merge homebrew/prerelease data into the main data arrays
	 * @param {Object} brewData - The processed brew data object
	 */
	_mergeBrewData (brewData) {
		if (!brewData) return;

		// Register brew item properties, types, and masteries into Renderer.item lookup maps
		// so that getProperty()/getMastery() can resolve them for filter display
		Renderer.item.addPrereleaseBrewPropertiesAndTypesFrom({data: brewData});

		// Races - process with same logic as site races (mergeSubraces + expand _versions)
		if (brewData.race?.length) {
			const processedBrewRaces = this._processRaceData(MiscUtil.copyFast(brewData.race));
			this._races = [...this._races, ...processedBrewRaces];
		}

		// Subraces - adopt onto their parent races using the standard method
		if (brewData.subrace?.length) {
			// Group subraces by parent to handle adoption failures gracefully
			// Instead of letting one bad subrace fail everything, process them individually
			const successfulAdoptions = [];
			const failedSubraces = [];

			for (const subrace of MiscUtil.copyFast(brewData.subrace)) {
				try {
					// Attempt to adopt this single subrace
					const adopted = Renderer.race.adoptSubraces(this._races, [subrace]);
					if (adopted.length) {
						successfulAdoptions.push(...adopted);
					}
				} catch (e) {
					// Log but don't fail - this subrace just won't work
					// eslint-disable-next-line no-console
					console.warn(`[CharSheet] Skipping orphan subrace "${subrace.name}" (${subrace.source}): parent race not found`);
					failedSubraces.push(`${subrace.name}|${subrace.source}`);
				}
			}

			if (successfulAdoptions.length) {
				// Process adopted races (mergeSubraces, expand _versions) and replace their parents
				const processedAdopted = this._processRaceData(successfulAdoptions);

				// Remove existing parent race entries that were adopted onto, then add processed versions
				const adoptedKeys = new Set(successfulAdoptions.map(r => `${r.name}|${r.source}`));
				this._races = this._races.filter(r => !adoptedKeys.has(`${r.name}|${r.source}`) || r._baseName);
				this._races = [...this._races, ...processedAdopted];
			}
		}

		// Classes
		if (brewData.class?.length) {
			this._classes = [...this._classes, ...MiscUtil.copyFast(brewData.class)];
		}

		// Subclasses
		if (brewData.subclass?.length) {
			this._subclasses = [...this._subclasses, ...MiscUtil.copyFast(brewData.subclass)];
		}

		// Class features
		if (brewData.classFeature?.length) {
			this._classFeatures = [...this._classFeatures, ...MiscUtil.copyFast(brewData.classFeature)];
		}

		// Subclass features
		if (brewData.subclassFeature?.length) {
			this._subclassFeatures = [...this._subclassFeatures, ...MiscUtil.copyFast(brewData.subclassFeature)];
		}

		// Backgrounds
		if (brewData.background?.length) {
			this._backgrounds = [...this._backgrounds, ...MiscUtil.copyFast(brewData.background)];
		}

		// Spells
		if (brewData.spell?.length) {
			this._spellsData = [...this._spellsData, ...MiscUtil.copyFast(brewData.spell)];
		}

		// Items are loaded separately via DataUtil.item.loadBrew() in _pLoadData so they go
		// through the full enhancement pipeline (generic variants, property/mastery merging).
		// Do not merge raw brewData.item here — it lacks the enhanced fields.

		// Feats
		if (brewData.feat?.length) {
			this._featsData = [...this._featsData, ...MiscUtil.copyFast(brewData.feat)];
		}

		// Optional features (invocations, metamagic, etc.)
		if (brewData.optionalfeature?.length) {
			this._optionalFeaturesData = [...this._optionalFeaturesData, ...MiscUtil.copyFast(brewData.optionalfeature)];
		}

		// Combat methods (TGTT combat tradition methods)
		if (brewData.combatMethod?.length) {
			const brewMethods = MiscUtil.copyFast(brewData.combatMethod).map(m => ({...m, _entityType: "combatMethod"}));
			this._combatMethodsData = [...this._combatMethodsData, ...brewMethods];
		}

		// Item upgrades (TGTT gemstones, etc.)
		if (brewData.itemUpgrade?.length) {
			const brewUpgrades = MiscUtil.copyFast(brewData.itemUpgrade).map(u => ({...u, _entityType: "itemUpgrade"}));
			this._itemUpgradesData = [...this._itemUpgradesData, ...brewUpgrades];
		}

		// Skills (rare but possible)
		if (brewData.skill?.length) {
			this._skillsData = [...this._skillsData, ...MiscUtil.copyFast(brewData.skill)];
		}

		// Conditions/diseases
		if (brewData.condition?.length) {
			const brewConditions = MiscUtil.copyFast(brewData.condition);
			this._conditionsData = [...this._conditionsData, ...brewConditions];
			// Register homebrew conditions with their effects
			CharacterSheetState.registerHomebrewConditions(brewConditions);
		}

		// Languages
		if (brewData.language?.length) {
			this._languagesData = [...this._languagesData, ...MiscUtil.copyFast(brewData.language)];
		}
	}

	/**
	 * Build a map from dialect names to their parent language entries.
	 * E.g., "aquan" → {name: "Primordial", source: "XPHB"} (or PHB if XPHB unavailable).
	 */
	_buildDialectParentMap () {
		this._dialectParentMap = {};
		this._dialectFamilyMap = {}; // parent name (lowercase) → [dialect names]
		for (const lang of this._languagesData) {
			if (!lang.dialects?.length) continue;
			const parentKey = lang.name.toLowerCase();
			// Build parent → dialects map (prefer XPHB)
			if (!this._dialectFamilyMap[parentKey] || lang.source === Parser.SRC_XPHB) {
				this._dialectFamilyMap[parentKey] = lang.dialects.map(d => d);
			}
			for (const dialect of lang.dialects) {
				const key = dialect.toLowerCase();
				// Prefer XPHB parent, then keep first found
				if (!this._dialectParentMap[key] || lang.source === Parser.SRC_XPHB) {
					this._dialectParentMap[key] = {name: lang.name, source: lang.source};
				}
			}
		}
	}

	/**
	 * Get languages that conflict with the given language due to dialect relationships.
	 * - If langName is a dialect (e.g. "Ignan"), returns ["Primordial"] (just the parent)
	 * - If langName is a parent (e.g. "Primordial"), returns all dialects ["Auran", "Aquan", "Ignan", "Terran"]
	 * - Otherwise returns []
	 * @param {string} langName
	 * @returns {string[]}
	 */
	getDialectConflicts (langName) {
		const key = langName.toLowerCase();
		// Check if it's a dialect → conflict with parent only
		const parent = this._dialectParentMap[key];
		if (parent) return [parent.name];
		// Check if it's a parent → conflict with all dialects
		const dialects = this._dialectFamilyMap[key];
		if (dialects) return [...dialects];
		return [];
	}

	/**
	 * Count unique homebrew sources for logging
	 */
	_getBrewSourceCount (prereleaseData, brewData) {
		const sources = new Set();
		[prereleaseData, brewData].forEach(data => {
			if (data?._meta?.sources) {
				data._meta.sources.forEach(src => sources.add(src.json));
			}
		});
		return sources.size;
	}

	_initUi () {
		document.body.classList.add("is-charsheet-page");
		this._selCharacter = document.getElementById("charsheet-sel-character");
		this._renderAbilities();
		this._renderSavingThrows();
		this._renderSkills();
		this._initTabs();
		this._initHoverLinkSafetyNet();
		CharacterSheetPage._initModalHoverCleanup();
	}

	/**
	 * Initialize manual tab switching since Bootstrap JS is not loaded
	 */
	_initTabs () {
		const tabs = document.getElementById("charsheet-tabs");
		const tabContent = document.querySelector(".tab-content");

		for (const link of tabs.querySelectorAll("a[data-toggle=\"tab\"]")) {
			link.addEventListener("click", (e) => {
				e.preventDefault();
				const targetId = (/** @type {*} */ (e.currentTarget)).getAttribute("href");

				// Update tab nav
				for (const li of tabs.querySelectorAll("li")) li.classList.remove("ve-active");
				(/** @type {*} */ (e.currentTarget)).parentElement.classList.add("ve-active");

				// Update tab content — set inline display as belt-and-suspenders
				for (const pane of tabContent.querySelectorAll(".tab-pane")) {
					pane.classList.remove("ve-active", "in");
					(/** @type {*} */ (pane)).style.display = "none";
				}
				const target = document.querySelector(targetId);
				target.classList.add("ve-active", "in");
				target.style.display = "";
			});
		}
	}

	/**
	 * Safety-net: ensure any hover link (created via Renderer.hover.getHoverElementAttributes)
	 * opens in a new tab instead of navigating away from the character sheet.
	 * This catches direct usages that don't go through getHoverLink/getSubclassHoverLink.
	 */
	static _isModalHoverCleanupInit = false;

	static _initModalHoverCleanup () {
		if (CharacterSheetPage._isModalHoverCleanupInit) return;
		CharacterSheetPage._isModalHoverCleanupInit = true;

		const scheduleCleanup = typeof requestIdleCallback === "function"
			? (fn) => requestIdleCallback(fn, {timeout: 2000})
			: (fn) => setTimeout(fn, 100);

		new MutationObserver(() => {
			if (document.body.classList.contains("ui-modal__body-active")) return;

			scheduleCleanup(() => {
				if (typeof Renderer?.hover?._eleCache?.entries !== "function") return;

				for (const [key, meta] of Renderer.hover._eleCache.entries()) {
					if (!(key instanceof Element)) continue;
					if (document.body.contains(key)) continue;

					if (meta?.windowMeta?.doClose) {
						try { meta.windowMeta.doClose(); } catch { /* best-effort */ }
					}
					Renderer.hover._eleCache.delete(key);
				}
			});
		}).observe(document.body, {attributes: true, attributeFilter: ["class"]});
	}

	_initHoverLinkSafetyNet () {
		// Click handler: ensure hover links open in new tab
		document.addEventListener("click", (e) => {
			const target = (/** @type {*} */ (e.target)).closest("a[data-vet-page]");
			if (!target) return;
			if (!target.target) {
				target.target = "_blank";
				target.rel = "noopener noreferrer";
			}
		});

		// Event delegation for hover links — handles dynamically added elements
		// that may not have working inline onmouseover handlers (e.g. elements
		// added via template.innerHTML in e_({outer:...}))
		const hoverBound = new WeakSet();
		document.addEventListener("mouseover", (e) => {
			const target = (/** @type {*} */ (e.target)).closest("a[data-vet-page]");
			if (!target || hoverBound.has(target)) return;
			hoverBound.add(target);

			// Bind per-element handlers once so mouseleave/mousemove work
			target.addEventListener("mouseleave", (evt) => {
				if (typeof Renderer?.hover?.handleLinkMouseLeave === "function") {
					Renderer.hover.handleLinkMouseLeave(evt, target);
				}
			});
			target.addEventListener("mousemove", (evt) => {
				if (typeof Renderer?.hover?.handleLinkMouseMove === "function") {
					Renderer.hover.handleLinkMouseMove(evt, target);
				}
			});

			// Trigger the initial mouseover
			if (typeof Renderer?.hover?.pHandleLinkMouseOver === "function") {
				Renderer.hover.pHandleLinkMouseOver(e, target);
			}
		});
	}

	/**
	 * Switch to a specific tab programmatically
	 * @param {string} tabId - The tab ID (e.g., "#charsheet-tab-builder")
	 */
	switchToTab (tabId) {
		const tabs = document.getElementById("charsheet-tabs");
		const tabContent = document.querySelector(".tab-content");
		const link = tabs.querySelector(`a[href="${tabId}"]`);

		if (!link) return;

		// Update tab nav
		for (const li of tabs.querySelectorAll("li")) li.classList.remove("ve-active");
		link.parentElement.classList.add("ve-active");

		// Update tab content
		for (const pane of tabContent.querySelectorAll(".tab-pane")) pane.classList.remove("ve-active", "in");
		document.querySelector(tabId).classList.add("ve-active", "in");
	}

	/**
	 * Hide a tab from the navigation
	 * @param {string} tabId - The tab ID (e.g., "#charsheet-tab-builder")
	 */
	_hideTab (tabId) {
		const tab = document.querySelector(`#charsheet-tabs a[href="${tabId}"]`)?.parentElement;
		if (tab) tab.classList.add("ve-hidden");
	}

	/**
	 * Show a hidden tab in the navigation
	 * @param {string} tabId - The tab ID (e.g., "#charsheet-tab-builder")
	 */
	_showTab (tabId) {
		const tab = document.querySelector(`#charsheet-tabs a[href="${tabId}"]`)?.parentElement;
		if (tab) tab.classList.remove("ve-hidden");
	}

	/**
	 * Update tab visibility based on character state
	 * - Builder tab: Only shown when no character exists (during creation)
	 * - Respec tab: Only shown when a character exists
	 */
	_updateTabVisibility () {
		const totalLevel = this._state?.getTotalLevel?.() || 0;
		const hasCharacter = totalLevel > 0;

		// Builder: only show when no character exists (during building)
		if (hasCharacter) {
			this._hideTab("#charsheet-tab-builder");
		} else {
			this._showTab("#charsheet-tab-builder");
		}

		// Respec: only show when character exists
		if (hasCharacter) {
			this._showTab("#charsheet-tab-respec");
		} else {
			this._hideTab("#charsheet-tab-respec");
		}
	}

	_initEventListeners () {
		// Character selection
		this._selCharacter.addEventListener("change", () => this._onCharacterSelect());

		// Header buttons
		document.getElementById("charsheet-btn-new").addEventListener("click", () => this._onNewCharacter());
		document.getElementById("charsheet-btn-new").addEventListener("contextmenu", (e) => { e.preventDefault(); this._onRandomCharacter(); });
		document.getElementById("charsheet-btn-duplicate").addEventListener("click", () => this._onDuplicateCharacter());
		document.getElementById("charsheet-btn-delete").addEventListener("click", () => this._onDeleteCharacter());
		document.getElementById("charsheet-btn-delete").addEventListener("contextmenu", (e) => { e.preventDefault(); this._onManageCharacters(); });
		document.getElementById("charsheet-btn-modifiers").addEventListener("click", () => this._showCustomModifiersModal());
		document.getElementById("charsheet-btn-settings").addEventListener("click", () => this._showSettingsModal());
		// Import/Export/Print handled by CharacterSheetExport module
		document.getElementById("charsheet-btn-levelup").addEventListener("click", () => this._levelUp?.showLevelUp());
		document.getElementById("charsheet-btn-multiclass").addEventListener("click", () => this._levelUp?.showMulticlass());
		document.getElementById("charsheet-btn-quickbuild").addEventListener("click", () => this._quickBuild?.showQuickBuild());
		document.getElementById("charsheet-btn-xp-add").addEventListener("click", () => this._onXpAdd());
		document.getElementById("charsheet-ipt-xp-add").addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			this._onXpAdd();
		});
		document.getElementById("charsheet-levelup-banner-btn-now").addEventListener("click", () => this._onLevelUpBannerNow());
		document.getElementById("charsheet-levelup-banner-btn-later").addEventListener("click", () => this._onLevelUpBannerLater());

		// Character name
		document.getElementById("charsheet-ipt-name").addEventListener("change", (e) => {
			this._state.setName((/** @type {*} */ (e.target)).value);
			this._saveCurrentCharacter();
			this._updateCharacterDropdown();
		});

		// HP controls
		document.getElementById("charsheet-ipt-hp-current").addEventListener("change", (e) => {
			this._state.setCurrentHp(parseInt((/** @type {*} */ (e.target)).value) || 0);
			this._saveCurrentCharacter();
			this._renderHp(); // Update HP bar
			this._renderConditions(); // Update bloodied condition display
		});

		document.getElementById("charsheet-ipt-hp-temp").addEventListener("change", (e) => {
			this._state.setTempHp(parseInt((/** @type {*} */ (e.target)).value) || 0);
			this._saveCurrentCharacter();
			this._renderHp(); // Update HP bar
		});

		document.getElementById("charsheet-btn-heal").addEventListener("click", () => this._onHeal());
		document.getElementById("charsheet-btn-damage").addEventListener("click", () => this._onDamage());

		// HP breakdown popover — bind on the whole HP section, but stop propagation
		// on interactive children (inputs, heal/damage buttons) so editing/clicking them
		// doesn't open the popover.
		const hpSection = document.querySelector(".charsheet__section--hp");
		if (hpSection) {
			hpSection.classList.add("charsheet__section--hp--clickable");
			hpSection.setAttribute("title", "Hit Points - click for breakdown");
			hpSection.addEventListener("click", (e) => {
				const target = /** @type {HTMLElement} */ (e.target);
				if (target.closest("input, button, select, textarea, a")) return;
				this._showHpBreakdownModal();
			});
		}

		// Combat
		document.getElementById("charsheet-box-ac").addEventListener("click", () => this._showAcBreakdownModal());
		document.getElementById("charsheet-box-speed").addEventListener("click", () => this._showSpeedBreakdownModal());
		document.getElementById("charsheet-box-initiative").addEventListener("click", (e) => this._rollInitiative(e));
		document.getElementById("charsheet-btn-use-hitdie").addEventListener("click", () => this._onUseHitDie());
		document.getElementById("charsheet-btn-deathsave").addEventListener("click", () => this._onDeathSave());

		// Rest - handled by CharacterSheetRest module

		// Inspiration
		document.getElementById("charsheet-box-inspiration").addEventListener("click", () => this._toggleInspiration());

		// Secondary header toggle
		document.getElementById("charsheet-btn-more").addEventListener("click", () => this._toggleSecondaryHeader());

		// Roll history toggle
		document.getElementById("charsheet-btn-rolllog")?.addEventListener("click", () => this._rollHistory?.toggle());

		// Play Mode toggle
		document.getElementById("charsheet-btn-playmode")?.addEventListener("click", () => this._playMode?.toggle());

		// Layout editing
		document.getElementById("charsheet-btn-layout").addEventListener("click", () => this._toggleLayoutEditMode());
		document.getElementById("charsheet-btn-reset-layout").addEventListener("click", () => this._resetLayout());
		document.getElementById("charsheet-btn-default-layout").addEventListener("click", () => this._resetToDefaultLayout());

		// Theme picker
		this._initThemePicker();

		// Text size picker
		this._initTextSizePicker();

		// Font picker
		this._initFontPicker();

		// Dice settings picker
		this._initDicePicker();

		// Secondary header collapse state
		this._initSecondaryHeader();

		// Conditions
		document.getElementById("charsheet-btn-add-condition").addEventListener("click", () => this._onAddCondition());

		// Exhaustion
		document.getElementById("charsheet-btn-exhaustion-add").addEventListener("click", () => this._addExhaustion());
		document.getElementById("charsheet-btn-exhaustion-remove").addEventListener("click", () => this._removeExhaustion());

		// Companions - Buttons rendered dynamically via _renderCompanionButtons()
		// New Round button (resets action economy)
		document.getElementById("charsheet-btn-new-round").addEventListener("click", () => this._resetAllCompanionActions());

		// Currency
		["cp", "sp", "ep", "gp", "pp"].forEach(currency => {
			document.getElementById(`charsheet-ipt-${currency}`).addEventListener("change", (e) => {
				this._state.setCurrency(currency, parseInt((/** @type {*} */ (e.target)).value) || 0);
				this._saveCurrentCharacter();
				this._renderCurrency(); // Update total
			});
		});

		// Currency conversion button
		document.getElementById("charsheet-btn-convert-currency").addEventListener("click", () => this._convertCurrencyToGold());

		// Notes
		["personality", "ideals", "bonds", "flaws", "backstory", "notes"].forEach(field => {
			document.getElementById(`charsheet-txt-${field}`).addEventListener("change", (e) => {
				this._state.setNote(field, (/** @type {*} */ (e.target)).value);
				this._saveCurrentCharacter();
			});
		});

		// Appearance
		["age", "height", "weight", "eyes", "skin", "hair"].forEach(field => {
			document.getElementById(`charsheet-ipt-${field}`).addEventListener("change", (e) => {
				this._state.setAppearance(field, (/** @type {*} */ (e.target)).value);
				this._saveCurrentCharacter();
			});
		});

		// Portrait handlers
		this._initPortraitHandlers();

		// Death saves
		for (const container of document.querySelectorAll("#charsheet-deathsaves-success, #charsheet-deathsaves-failure")) {
			container.addEventListener("change", (e) => {
				if (!(/** @type {*} */ (e.target)).matches("input")) return;
				this._updateDeathSaves();
				this._saveCurrentCharacter();
			});
		}

		// Edit proficiencies
		document.getElementById("charsheet-edit-proficiencies").addEventListener("click", () => this._showEditProficienciesModal());

		// Edit ability scores
		document.getElementById("charsheet-edit-abilities").addEventListener("click", () => this._showEditAbilityScoresModal());

		// Edit weapon masteries
		document.getElementById("charsheet-edit-masteries").addEventListener("click", () => this._showEditWeaponMasteriesModal());
	}

	// #region Character Management
	async _pLoadCharacters () {
		const characters = await StorageUtil.pGet("charsheet-characters") || [];
		this._updateCharacterDropdown(characters);
	}

	_updateCharacterDropdown (characters) {
		if (!characters) {
			characters = this._state.getAllCharacters();
		}

		this._selCharacter.innerHTML = "";
		this._selCharacter.insertAdjacentHTML("beforeend", `<option value="">➕ Create New Character</option>`);

		if (characters.length) {
			this._selCharacter.insertAdjacentHTML("beforeend", `<option disabled>────── Saved Characters ──────</option>`);
		}

		characters.forEach(char => {
			const name = char.name || "Unnamed Character";
			// Show class info with total level
			const totalLevel = char.classes?.reduce((sum, c) => sum + (c.level || 0), 0) || 0;
			const classNames = char.classes?.map(c => c.name).join("/") || "";
			const classInfo = classNames ? `${classNames} ${totalLevel}` : "";
			const label = classInfo ? `${name} — ${classInfo}` : name;
			this._selCharacter.insertAdjacentHTML("beforeend", `<option value="${char.id}">${label}</option>`);
		});

		if (this._currentCharacterId) {
			this._selCharacter.value = this._currentCharacterId;
		}
	}

	async _onCharacterSelect () {
		const charId = this._selCharacter.value;

		// Save current character before switching to prevent data loss
		if (this._currentCharacterId) {
			await this._saveCurrentCharacter();
		}

		if (charId) {
			await this._pLoadCharacter(charId);
		} else {
			this._createNewCharacter();
		}
	}

	async _pLoadCharacter (charId) {
		const characters = await StorageUtil.pGet("charsheet-characters") || [];
		const character = characters.find(c => c.id === charId);

		if (character) {
			this._currentCharacterId = charId;
			this._isLevelUpBannerDismissed = false;
			this._state.loadFromJson(character);

			// Ensure Linguistics skill exists if Thelemar linguistics bonus is enabled
			this._ensureLinguisticsSkillIfNeeded();

			this._renderCharacter();

			// Apply saved section layout
			if (this._layout) {
				this._layout.applySavedLayout();
			}

			// Apply saved background theme and update picker
			const currentTheme = this._state.getBackgroundTheme();
			this._applyBackgroundTheme(currentTheme);
			this._updateThemePickerSelection(currentTheme);

			// Restore Play Mode if it was active
			if (this._playMode && this._state.getViewMode() === "play") {
				this._playMode.activate();
			} else if (this._playMode) {
				this._playMode.deactivate();
			}

			// Update URL
			const url = new URL(/** @type {*} */ (window.location));
			url.searchParams.set("id", charId);
			window.history.replaceState({}, "", url);
		}
	}

	_createNewCharacter () {
		this._currentCharacterId = CryptUtil.uid();
		this._isLevelUpBannerDismissed = false;
		this._state.reset();
		this._state.setId(this._currentCharacterId);
		this._renderCharacter();
	}

	async _onNewCharacter () {
		// Save current character before creating new to prevent data loss
		if (this._currentCharacterId) {
			await this._saveCurrentCharacter();
		}

		this._createNewCharacter();
		this._selCharacter.value = "";

		// Show builder tab (may be hidden after previous character)
		this._showTab("#charsheet-tab-builder");

		// Switch to builder tab
		this.switchToTab("#charsheet-tab-builder");
	}

	// #region Random Character Generation

	async _onRandomCharacter () {
		const classes = this.filterByAllowedSources(this._classes);
		if (!classes.length) {
			JqueryUtil.doToast({type: "warning", content: "No classes available. Data may still be loading."});
			return;
		}

		const classNames = classes.map(c => c.name).sort();
		const chosenName = await InputUiUtil.pGetUserEnum({
			title: "Random Character — Pick a Class",
			htmlDescription: `<div>Select a class. Race, background, ability scores, proficiencies, and spells will be randomised.</div>`,
			values: classNames,
			isResolveItem: true,
		});
		if (!chosenName) return;

		const chosenClass = classes.find(c => c.name === chosenName);
		if (!chosenClass) return;

		// Save current character before creating the random one
		if (this._currentCharacterId) {
			await this._saveCurrentCharacter();
		}

		this._createNewCharacter();
		this._selCharacter.value = "";

		this._buildRandomCharacter(chosenClass);

		await this._saveCurrentCharacter();
		await this._pLoadCharacters();
		this._selCharacter.value = this._currentCharacterId;

		JqueryUtil.doToast({type: "success", content: `Created random ${chosenName}: ${this._state.getName()}`});
	}

	_buildRandomCharacter (cls) {
		const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
		const pickN = (arr, n) => {
			const shuffled = [...arr].sort(() => Math.random() - 0.5);
			return shuffled.slice(0, Math.min(n, arr.length));
		};

		// ── 1. Race ──
		const races = this.filterByAllowedSources(this._races);
		if (races.length) {
			const race = pick(races);
			this._state.setRace({name: race.name, source: race.source}, race._subraceName ? {name: race._subraceName, source: race.source} : null);
			const sizeAbv = Array.isArray(race.size) ? pick(race.size) : race.size;
			this._state.setSize(sizeAbv ? (Parser.sizeAbvToFull?.(sizeAbv) || sizeAbv) : "medium");

			// Speed
			if (race.speed) {
				if (typeof race.speed === "number") {
					this._state.setSpeed("walk", race.speed);
				} else if (race.speed.walk) {
					this._state.setSpeed("walk", race.speed.walk);
				}
			}

			// Ability bonuses
			if (race.ability?.length) {
				const abilityBlock = pick(race.ability);
				for (const [ab, bonus] of Object.entries(abilityBlock)) {
					if (ab === "choose") {
						// Random choice: pick `count` abilities from `from` and give each +`amount`
						const count = abilityBlock.choose.count || 1;
						const amount = abilityBlock.choose.amount || 1;
						const from = abilityBlock.choose.from || Parser.ABIL_ABVS;
						const chosen = pickN(from, count);
						for (const a of chosen) this._state.setAbilityBonus(a, (this._state._data.abilityBonuses[a] || 0) + amount);
					} else if (Parser.ABIL_ABVS.includes(ab)) {
						this._state.setAbilityBonus(ab, (this._state._data.abilityBonuses[ab] || 0) + bonus);
					}
				}
			}

			// Darkvision
			if (race.darkvision) this._state.setSense("darkvision", race.darkvision);

			// Languages
			if (race.languageProficiencies) {
				race.languageProficiencies.forEach(lp => {
					Object.keys(lp).forEach(lang => {
						if (lang === "anyStandard" || lang === "any" || lang === "choose") return;
						this._state.addLanguage((/** @type {*} */ (lang)).toTitleCase());
					});
					// Random extra language choices
					if (lp.anyStandard || lp.any) {
						const count = lp.anyStandard || lp.any;
						const available = this._getAvailableLanguages();
						const chosen = pickN(available, typeof count === "number" ? count : 1);
						for (const lang of chosen) this._state.addLanguage(lang);
					}
				});
			}

			// Skill proficiencies from race
			if (race.skillProficiencies) {
				race.skillProficiencies.forEach(sp => {
					Object.keys(sp).forEach(skill => {
						if (skill === "choose" || skill === "any") return;
						this._state.setSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""), 1);
					});
					if (sp.choose) {
						const from = sp.choose.from || [];
						const count = sp.choose.count || 1;
						const chosen = pickN(from.map(s => s.toLowerCase().replace(/\s+/g, "")), count);
						for (const s of chosen) this._state.setSkillProficiency(s, 1);
					}
				});
			}

			// Resistances
			if (race.resist) {
				race.resist.forEach(r => { if (typeof r === "string") this._state.addResistance(r); });
			}

			// Racial features (traits)
			if (race.entries) this._addRandomFeatureEntries(race.entries, race.source, "Species");
		}

		// ── 2. Background ──
		const backgrounds = this.filterByAllowedSources(this._backgrounds);
		if (backgrounds.length) {
			const bg = pick(backgrounds);
			this._state.setBackground({name: bg.name, source: bg.source});

			if (bg.skillProficiencies) {
				bg.skillProficiencies.forEach(sp => {
					Object.keys(sp).forEach(skill => {
						if (skill === "choose" || skill === "any") return;
						this._state.setSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""), 1);
					});
				});
			}

			if (bg.toolProficiencies) {
				bg.toolProficiencies.forEach(tp => {
					Object.entries(tp).forEach(([key, val]) => {
						if (key === "choose" || key === "any" || key === "anyArtisansTool" || key === "anyMusicalInstrument") return;
						if (val === true) this._state.addToolProficiency((/** @type {*} */ (key)).toTitleCase());
					});
				});
			}

			if (bg.languageProficiencies) {
				bg.languageProficiencies.forEach(lp => {
					Object.entries(lp).forEach(([key, val]) => {
						if (key === "anyStandard" || key === "any") {
							const count = typeof val === "number" ? val : 1;
							const available = this._getAvailableLanguages();
							const chosen = pickN(available, count);
							for (const lang of chosen) this._state.addLanguage(lang);
						} else if (val === true) {
							this._state.addLanguage((/** @type {*} */ (key)).toTitleCase());
						}
					});
				});
			}

			// Background features
			if (bg.entries) this._addRandomFeatureEntries(bg.entries, bg.source, "Background");
		}

		// ── 3. Ability scores (standard array, priority-shuffled) ──
		const standardArray = [15, 14, 13, 12, 10, 8];
		const priority = this._getAbilityPriority(cls);
		// Minor shuffle for variety: swap 0-2 random pairs
		const swaps = Math.floor(Math.random() * 3);
		for (let i = 0; i < swaps; i++) {
			const a = Math.floor(Math.random() * 6);
			const b = Math.floor(Math.random() * 6);
			[priority[a], priority[b]] = [priority[b], priority[a]];
		}
		for (let i = 0; i < 6; i++) {
			this._state.setAbilityBase(priority[i], standardArray[i]);
		}

		// ── 4. Class (triggers spell slot / HP recalc internally) ──
		this._state.addClass({name: cls.name, source: cls.source, level: 1});

		// Save proficiencies
		if (cls.proficiency) {
			cls.proficiency.forEach(prof => {
				if (Parser.ABIL_ABVS.includes(prof)) this._state.addSaveProficiency(prof);
			});
		}

		// Armor / weapon / tool proficiencies
		if (cls.startingProficiencies?.armor) {
			cls.startingProficiencies.armor.forEach(a => {
				this._state.addArmorProficiency(typeof a === "string" ? a : a.full || String(a));
			});
		}
		if (cls.startingProficiencies?.weapons) {
			cls.startingProficiencies.weapons.forEach(w => {
				this._state.addWeaponProficiency(typeof w === "string" ? w : w.full || String(w));
			});
		}
		if (cls.startingProficiencies?.tools) {
			cls.startingProficiencies.tools.forEach(t => {
				if (typeof t === "string" && !/\bany\b.*\bchoice\b|\bchoose\b/i.test(t)) {
					const toolName = (/** @type {*} */ (t.replace(/{@item\s+([^|}]+)[^}]*}/gi, "$1"))).toTitleCase();
					this._state.addToolProficiency(toolName);
				}
			});
		}

		// Class skill proficiencies (random from class list)
		if (cls.startingProficiencies?.skills) {
			const alreadyProficient = new Set(
				Object.keys(this._state._data.skillProficiencies).filter(s => this._state._data.skillProficiencies[s] >= 1),
			);
			cls.startingProficiencies.skills.forEach(skillSet => {
				if (skillSet.choose) {
					const count = skillSet.choose.count || 2;
					const from = (skillSet.choose.from || []).map(s => s.toLowerCase().replace(/\s+/g, ""));
					const available = from.filter(s => !alreadyProficient.has(s));
					const chosen = pickN(available, count);
					for (const s of chosen) {
						this._state.setSkillProficiency(s, 1);
						alreadyProficient.add(s);
					}
				} else if (skillSet.any) {
					const allSkills = [
						"acrobatics", "animalhandling", "arcana", "athletics", "deception",
						"history", "insight", "intimidation", "investigation", "medicine",
						"nature", "perception", "performance", "persuasion", "religion",
						"sleightofhand", "stealth", "survival",
					];
					const available = allSkills.filter(s => !alreadyProficient.has(s));
					const chosen = pickN(available, skillSet.any);
					for (const s of chosen) {
						this._state.setSkillProficiency(s, 1);
						alreadyProficient.add(s);
					}
				}
			});
		}

		// ── 4b. Class features ──
		this._addRandomClassFeatures(cls);

		// ── 5. Spellcasting ──
		if (cls.spellcastingAbility) {
			this._state.setSpellcastingAbility(cls.spellcastingAbility);
			this._applyRandomSpells(cls, pickN);
		}

		// ── 6. Level history ──
		this._state.recordLevelChoice({
			level: 1,
			class: {name: cls.name, source: cls.source},
			choices: {},
			complete: true,
		});

		// ── 7. Name & HP ──
		const raceName = this._state.getRaceName() || "Adventurer";
		this._state.setName(`${raceName} ${cls.name}`);
		const maxHp = this._state.getMaxHp?.() ?? this._state._data.hp.max;
		this._state._data.hp.current = maxHp;

		this._renderCharacter();
		this._updateTabVisibility();
	}

	_addRandomFeatureEntries (entries, source, featureType) {
		entries.forEach(entry => {
			if (typeof entry === "object" && entry.name) {
				this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
					{
						...entry,
						source: entry.source || source,
					},
					{featureType},
				));
			}
		});
	}

	_addRandomClassFeatures (cls) {
		if (!cls.classFeatures?.length) return;

		// classFeatures[0] is level 1 features (array-of-arrays format) or flat array
		let level1Features = cls.classFeatures[0];
		if (level1Features && !Array.isArray(level1Features)) {
			level1Features = cls.classFeatures.filter(f => {
				if (typeof f === "string") {
					const parts = f.split("|");
					return parts[3] === "1" || parts.length < 4;
				} else if (typeof f === "object" && f.classFeature) {
					const parts = f.classFeature.split("|");
					return parts[3] === "1" || parts.length < 4;
				} else if (typeof f === "object" && f.level !== undefined) {
					return f.level === 1;
				}
				return true;
			});
		}

		(level1Features || []).forEach(f => {
			let featureName, featureSource, classSource;

			if (typeof f === "string") {
				const parts = f.split("|");
				featureName = parts[0];
				classSource = parts[2] || cls.source;
				featureSource = parts[4] || classSource;
			} else if (typeof f === "object" && f.classFeature) {
				const parts = f.classFeature.split("|");
				featureName = parts[0];
				classSource = parts[2] || cls.source;
				featureSource = parts[4] || classSource;
			} else if (typeof f === "object" && f.name) {
				featureName = f.name;
				classSource = f.classSource || cls.source;
				featureSource = f.source || classSource;
			} else {
				return;
			}

			const fullFeatureData = this._getRandomClassFeatureData(featureName, cls.name, classSource, 1);
			const description = fullFeatureData?.entries
				? Renderer.get().render({entries: fullFeatureData.entries})
				: "";

			this._state.addFeature({
				name: featureName,
				source: featureSource,
				level: 1,
				className: cls.name,
				classSource: classSource,
				featureType: "Class",
				description,
			});
		});
	}

	_getRandomClassFeatureData (featureName, className, source, level) {
		if (!this._classFeatures?.length) return null;

		return this._classFeatures.find(f => {
			if (f.name !== featureName || f.className !== className || f.level !== level) return false;
			if (source && f.source && f.source !== source) {
				const flexible = [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"];
				return flexible.includes(source) && flexible.includes(f.source);
			}
			return true;
		}) || null;
	}

	_getAbilityPriority (cls) {
		const priorities = {
			"Barbarian": ["str", "con", "dex", "wis", "cha", "int"],
			"Bard": ["cha", "dex", "con", "wis", "int", "str"],
			"Cleric": ["wis", "con", "str", "cha", "dex", "int"],
			"Druid": ["wis", "con", "dex", "int", "cha", "str"],
			"Fighter": ["str", "con", "dex", "wis", "cha", "int"],
			"Monk": ["dex", "wis", "con", "str", "cha", "int"],
			"Paladin": ["str", "cha", "con", "wis", "dex", "int"],
			"Ranger": ["dex", "wis", "con", "str", "int", "cha"],
			"Rogue": ["dex", "con", "cha", "int", "wis", "str"],
			"Sorcerer": ["cha", "con", "dex", "wis", "int", "str"],
			"Warlock": ["cha", "con", "dex", "wis", "int", "str"],
			"Wizard": ["int", "con", "dex", "wis", "cha", "str"],
			"Artificer": ["int", "con", "dex", "wis", "cha", "str"],
		};
		return [...(priorities[cls.name] || Parser.ABIL_ABVS)];
	}

	_getAvailableLanguages () {
		try {
			return this.getLanguageNamesSorted?.() || ["Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc"];
		} catch {
			return ["Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc"];
		}
	}

	_applyRandomSpells (cls, pickN) {
		const allSpells = this._spellsData || [];
		if (!allSpells.length) return;

		// Filter spells available to this class at level 1
		const classSpells = allSpells.filter(sp => {
			if (!sp.classes?.fromClassList?.length) return false;
			return sp.classes.fromClassList.some(c => c.name === cls.name && c.source === cls.source);
		});

		const cantrips = classSpells.filter(sp => sp.level === 0);
		const level1Spells = classSpells.filter(sp => sp.level === 1);

		// Determine cantrip and known spell counts from class data tables
		const cantripCount = CharacterSheetClassUtils.getCantripsAtLevel?.(cls, cls.name, 1) ??
			this._getDefaultCantripCount(cls.name);
		const knownCount = CharacterSheetClassUtils.getKnownSpellsAtLevel?.(cls, cls.name, 1) ??
			this._getDefaultKnownSpellCount(cls.name);

		// Add cantrips
		if (cantripCount > 0 && cantrips.length) {
			const chosen = pickN(cantrips, cantripCount);
			for (const sp of chosen) {
				this._state.addCantrip({
					name: sp.name,
					source: sp.source,
					school: sp.school,
					sourceClass: cls.name,
				});
			}
		}

		// Add known spells (for known casters, not prepared casters)
		const preparedCasters = ["Cleric", "Druid", "Paladin"];
		if (knownCount > 0 && !preparedCasters.includes(cls.name) && level1Spells.length) {
			const chosen = pickN(level1Spells, knownCount);
			for (const sp of chosen) {
				this._state.addSpell({
					name: sp.name,
					source: sp.source,
					level: sp.level,
					school: sp.school,
					ritual: sp.meta?.ritual || false,
					concentration: sp.duration?.some?.(d => d.concentration) || false,
					sourceClass: cls.name,
				}, false);
			}
		}
	}

	_getDefaultCantripCount (className) {
		const defaults = {Bard: 2, Cleric: 3, Druid: 2, Sorcerer: 4, Warlock: 2, Wizard: 3, Artificer: 2};
		return defaults[className] || 0;
	}

	_getDefaultKnownSpellCount (className) {
		const defaults = {Bard: 4, Sorcerer: 2, Warlock: 2, Wizard: 6, Ranger: 0};
		return defaults[className] || 0;
	}

	// #endregion

	async _onDuplicateCharacter () {
		if (!this._currentCharacterId) return;

		// Save current character first to preserve any unsaved changes
		await this._saveCurrentCharacter();

		const newId = CryptUtil.uid();
		const charData = this._state.toJson();
		charData.id = newId;
		charData.name = `${charData.name || "Character"} (Copy)`;

		this._currentCharacterId = newId;
		this._isLevelUpBannerDismissed = false;
		this._state.loadFromJson(charData);
		await this._saveCurrentCharacter();
		await this._pLoadCharacters();
		this._selCharacter.value = newId;
	}

	/**
	 * Add a new character from another state object (for import)
	 * @param {CharacterSheetState} state - The state object to add as a new character
	 */
	async addCharacter (state) {
		const newId = CryptUtil.uid();
		const charData = state.toJson();
		charData.id = newId;

		let characters = await StorageUtil.pGet("charsheet-characters") || [];
		characters.push(charData);
		await StorageUtil.pSet("charsheet-characters", characters);

		// Load the new character
		this._currentCharacterId = newId;
		this._isLevelUpBannerDismissed = false;
		this._state.loadFromJson(charData);
		await this._pLoadCharacters();
		this._selCharacter.value = newId;
	}

	_onXpAdd () {
		const iptXpAdd = /** @type {*} */ (document.getElementById("charsheet-ipt-xp-add"));
		const rawXpToAdd = iptXpAdd.value;
		const xpToAdd = Math.max(0, Math.floor(Number(rawXpToAdd) || 0));
		if (!xpToAdd) return;

		this._state.addXp(xpToAdd);
		iptXpAdd.value = 0;
		this._saveCurrentCharacter();
		this._renderXpTracking();
		this._renderLevelUpBanner();
	}

	_onLevelUpBannerNow () {
		this._isLevelUpBannerDismissed = false;
		this._levelUp?.showLevelUp();
	}

	_onLevelUpBannerLater () {
		this._isLevelUpBannerDismissed = true;
		this._renderLevelUpBanner();
	}

	async _onDeleteCharacter () {
		if (!this._currentCharacterId) return;

		const confirm = await InputUiUtil.pGetUserBoolean({
			title: "Delete Character",
			htmlDescription: "Are you sure you want to delete this character? This cannot be undone.",
			textYes: "Delete",
			textNo: "Cancel",
		});

		if (!confirm) return;

		let characters = await StorageUtil.pGet("charsheet-characters") || [];
		characters = characters.filter(c => c.id !== this._currentCharacterId);
		await StorageUtil.pSet("charsheet-characters", characters);

		this._createNewCharacter();
		await this._pLoadCharacters();
		this._selCharacter.value = "";
	}

	async _onManageCharacters () {
		const characters = await StorageUtil.pGet("charsheet-characters") || [];

		if (characters.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "No saved characters to manage."});
			return;
		}

		// Stage 1: Character selection via checkbox list
		const fnGetLabel = (char) => {
			const name = char.name || "Unnamed Character";
			const totalLevel = char.classes?.reduce((sum, c) => sum + (c.level || 0), 0) || 0;
			const classNames = char.classes?.map(c => c.name).join("/") || "";
			const classInfo = classNames ? `${classNames} ${totalLevel}` : "";
			return classInfo ? `${name} — ${classInfo}` : name;
		};

		const selected = await InputUiUtil.pGetUserMultipleChoice({
			title: "Bulk Delete Characters",
			values: characters,
			fnDisplay: (char) => fnGetLabel(char),
			isResolveItems: true,
			min: 1,
			max: characters.length,
			htmlDescription: `<div class="ve-flex-col"><p><b class="veapp__msg-warning">Select characters to permanently delete.</b></p><p>This action <b>cannot be undone</b>.</p></div>`,
		});

		if (!selected?.length) return;

		// Stage 2: Confirmation listing selected characters
		const selectedNames = selected.map(c => `<li>${fnGetLabel(c).escapeQuotes()}</li>`).join("");
		const countText = selected.length === 1 ? "1 character" : `${selected.length} characters`;

		const isConfirmed = await InputUiUtil.pGetUserBoolean({
			title: "Confirm Bulk Delete",
			htmlDescription: `<div class="ve-flex-col">
				<div class="alert alert-danger mb-3">
					<b>You are about to permanently delete ${countText}:</b>
					<ul class="mt-2 mb-0">${selectedNames}</ul>
				</div>
				<p><b>This action cannot be undone.</b></p>
			</div>`,
			textYes: `Delete ${countText}`,
			textNo: "Cancel",
		});

		if (!isConfirmed) return;

		// Stage 3: Type-to-confirm for 3+ characters
		if (selected.length >= 3) {
			const typed = await InputUiUtil.pGetUserString({
				title: "Final Confirmation",
				htmlDescription: `<div class="ve-flex-col">
					<div class="alert alert-danger mb-2">
						<b>You are about to permanently delete ${countText}.</b>
					</div>
					<p>Type <b>DELETE</b> to confirm.</p>
				</div>`,
				fnIsValid: (val) => val?.trim() === "DELETE",
			});

			if (typed?.trim() !== "DELETE") return;
		}

		// Execute deletion
		const selectedIds = new Set(selected.map(c => c.id));
		const remaining = characters.filter(c => !selectedIds.has(c.id));
		await StorageUtil.pSet("charsheet-characters", remaining);

		// If the currently loaded character was deleted, switch to a new blank character
		if (this._currentCharacterId && selectedIds.has(this._currentCharacterId)) {
			this._createNewCharacter();
		}

		await this._pLoadCharacters();
		if (!this._currentCharacterId || selectedIds.has(this._currentCharacterId)) {
			this._selCharacter.value = "";
		}

		JqueryUtil.doToast({type: "success", content: `Deleted ${countText}.`});
	}

	async _onSummonFamiliar () {
		// Delegate to the spells module's familiar picker
		if (this._spells?._pShowFamiliarPicker) {
			const calculations = this._state.getFeatureCalculations?.() || {};
			await this._spells._pShowFamiliarPicker({
				pactCreatureNames: calculations.pactOfTheChainCreatures || [],
			});
		} else {
			JqueryUtil.doToast({type: "warning", content: "Familiar picker not available."});
		}
	}

	/**
	 * Render dynamic companion summon buttons based on character features
	 */
	_renderCompanionButtons () {
		const container = document.getElementById("charsheet-companion-buttons");
		if (!container) return;

		container.innerHTML = "";

		const calculations = this._state.getFeatureCalculations?.() || {};
		const spells = this._state.getSpells?.() || [];
		const cantrips = this._state.getCantrips?.() || [];

		// Check if character has Find Familiar spell, Pact of the Chain, or Animal Accomplice
		const hasFindFamiliar = spells.some(s => s.name?.toLowerCase() === "find familiar")
			|| cantrips.some(c => c.name?.toLowerCase() === "find familiar");
		const hasPactOfTheChain = calculations.hasPactOfTheChain;
		const hasAnimalAccomplice = calculations.hasAnimalAccomplice || calculations.hasImprovedFamiliar;

		// Show summon familiar if they have the spell, Pact of the Chain, or Animal Accomplice
		if (hasFindFamiliar || hasPactOfTheChain || hasAnimalAccomplice) {
			const btn = e_({outer: `<button class="ve-btn ve-btn-primary" style="white-space: nowrap;">
				<span class="glyphicon glyphicon-plus mr-1"></span>🦉 Summon Familiar
			</button>`});
			btn.addEventListener("click", () => this._onSummonFamiliar());
			container.append(btn);
		}

		// Beast Master Ranger - Beast Companion
		if (calculations.hasBeastCompanion) {
			const btn = e_({outer: `<button class="ve-btn ve-btn-success" style="white-space: nowrap;">
				<span class="glyphicon glyphicon-plus mr-1"></span>🐺 Beast Companion
			</button>`});
			btn.addEventListener("click", () => this._onSummonBeastCompanion());
			container.append(btn);
		}

		// Drakewarden Ranger - Drake Companion
		if (calculations.hasDrakeCompanion) {
			const btn = e_({outer: `<button class="ve-btn ve-btn-danger" style="white-space: nowrap;">
				<span class="glyphicon glyphicon-plus mr-1"></span>🐉 Summon Drake
			</button>`});
			btn.addEventListener("click", () => this._onSummonDrake());
			container.append(btn);
		}

		// Battle Smith Artificer - Steel Defender
		if (calculations.hasSteelDefender) {
			const btn = e_({outer: `<button class="ve-btn ve-btn-info" style="white-space: nowrap;">
				<span class="glyphicon glyphicon-plus mr-1"></span>⚙️ Create Steel Defender
			</button>`});
			btn.addEventListener("click", () => this._onSummonSteelDefender());
			container.append(btn);
		}

		// Druid - Wild Shape
		if (calculations.wildShapeUses > 0) {
			const uses = calculations.wildShapeUses === Infinity ? "∞" : calculations.wildShapeUses;
			const btn = e_({outer: `<button class="ve-btn ve-btn-warning" style="white-space: nowrap;">
				<span class="glyphicon glyphicon-refresh mr-1"></span>🐻 Wild Shape (${uses})
			</button>`});
			btn.addEventListener("click", () => this._onWildShape());
			container.append(btn);
		}

		// Druid - Wild Companion (Fey familiar via Wild Shape use)
		if (calculations.hasWildCompanion) {
			const duration = calculations.wildCompanionDuration || "";
			const btn = e_({outer: `<button class="ve-btn ve-btn-info" style="white-space: nowrap;" title="Summon a Fey familiar for ${duration}">
				<span class="glyphicon glyphicon-plus mr-1"></span>🧚 Wild Companion
			</button>`});
			btn.addEventListener("click", () => this._onWildCompanion());
			container.append(btn);
		}

		// Find Steed / Find Greater Steed (Paladin)
		const hasFindSteed = spells.some(s => s.name?.toLowerCase() === "find steed");
		const hasFindGreaterSteed = spells.some(s => s.name?.toLowerCase() === "find greater steed");
		if (hasFindSteed || hasFindGreaterSteed) {
			const steedType = hasFindGreaterSteed ? "Greater Steed" : "Steed";
			const btn = e_({outer: `<button class="ve-btn ve-btn-default" style="white-space: nowrap;">
				<span class="glyphicon glyphicon-plus mr-1"></span>🐎 Find ${steedType}
			</button>`});
			btn.addEventListener("click", () => this._onFindSteed(hasFindGreaterSteed));
			container.append(btn);
		}

		// Always show "Add Custom" button
		const customBtn = e_({outer: `<button class="ve-btn ve-btn-default" style="white-space: nowrap;" title="Add a custom companion manually">
			<span class="glyphicon glyphicon-plus mr-1"></span>➕ Custom
		</button>`});
		customBtn.addEventListener("click", () => this._onAddCustomCompanion());
		container.append(customBtn);
	}

	/**
	 * Beast Master Ranger - Summon Beast Companion
	 */
	async _onSummonBeastCompanion () {
		const calculations = this._state.getFeatureCalculations?.() || {};

		// Offer choice between Primal Companion templates and legacy beast
		const choice = await InputUiUtil.pGetUserEnum({
			title: "Beast Companion Type",
			htmlDescription: `<div>Choose your Beast Companion type:</div>`,
			values: ["Beast of the Land", "Beast of the Sea", "Beast of the Sky", "Legacy Beast (CR ≤ 1/4)"],
			isResolveItem: true,
		});
		if (!choice) return;

		// Dismiss existing beast companions first
		const existingCompanions = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.BEAST_COMPANION) || [];
		for (const comp of existingCompanions) {
			this._state.removeCompanion?.(comp.id);
		}

		if (choice.startsWith("Legacy")) {
			// Show bestiary picker filtered to CR ≤ 1/4 beasts
			await this._pShowBeastPicker({
				maxCr: 0.25,
				type: CharacterSheetState.COMPANION_TYPES.BEAST_COMPANION,
				origin: "Beast Master",
			});
		} else {
			// Create a Primal Companion
			const primalType = choice.replace("Beast of the ", "").toLowerCase();
			this._createPrimalCompanion(primalType);
		}

		this._saveCurrentCharacter();
		this._renderCompanions();
	}

	/**
	 * Create a Primal Companion (Beast of Land/Sea/Sky)
	 */
	_createPrimalCompanion (type) {
		const calculations = this._state.getFeatureCalculations?.() || {};
		const rangerLevel = this._state.getClassLevel?.("ranger") || 0;
		const pb = this._state.getProficiencyBonus?.() || 2;

		// Base stats for primal companions (XPHB/Tasha's)
		const baseStats = {
			land: {
				name: "Beast of the Land",
				size: "M",
				speed: {walk: 40, climb: 40},
				ac: 13 + pb,
				hp: 5 + (5 * rangerLevel),
				abilities: {str: 14, dex: 14, con: 15, int: 8, wis: 14, cha: 11},
				senses: ["darkvision 60 ft."],
				actions: [{name: "Maul", entries: [`Melee Attack: +${pb + 2} to hit, reach 5 ft. Hit: 1d8 + 2 + PB slashing damage.`]}],
				traits: [{name: "Charge", entries: ["If the beast moves at least 20 feet straight toward a target and then hits it with a Maul attack on the same turn, the target takes an extra 1d6 slashing damage."]}],
			},
			sea: {
				name: "Beast of the Sea",
				size: "M",
				speed: {walk: 5, swim: 60},
				ac: 13 + pb,
				hp: 5 + (5 * rangerLevel),
				abilities: {str: 14, dex: 14, con: 15, int: 8, wis: 14, cha: 11},
				senses: ["darkvision 60 ft."],
				actions: [{name: "Binding Strike", entries: [`Melee Attack: +${pb + 2} to hit, reach 5 ft. Hit: 1d6 + 2 + PB bludgeoning or piercing damage, and target is grappled (escape DC ${8 + pb + 2}).`]}],
				traits: [{name: "Amphibious", entries: ["The beast can breathe air and water."]}],
			},
			sky: {
				name: "Beast of the Sky",
				size: "S",
				speed: {walk: 10, fly: 60},
				ac: 13 + pb,
				hp: 4 + (4 * rangerLevel),
				abilities: {str: 6, dex: 16, con: 13, int: 8, wis: 14, cha: 11},
				senses: ["darkvision 60 ft."],
				actions: [{name: "Shred", entries: [`Melee Attack: +${pb + 3} to hit, reach 5 ft. Hit: 1d4 + 3 + PB slashing damage.`]}],
				traits: [{name: "Flyby", entries: ["The beast doesn't provoke opportunity attacks when it flies out of an enemy's reach."]}],
			},
		};

		const stats = baseStats[type];
		if (!stats) return;

		this._state.addCompanion?.({
			name: stats.name,
			type: CharacterSheetState.COMPANION_TYPES.BEAST_COMPANION,
			origin: "Beast Master (Primal Companion)",
			size: stats.size,
			creatureType: "beast",
			ac: stats.ac,
			hp: {max: stats.hp, current: stats.hp},
			speed: stats.speed,
			abilities: stats.abilities,
			senses: stats.senses,
			passive: 10 + 2 + pb, // WIS mod + prof
			actions: stats.actions,
			traits: stats.traits,
			profBonus: pb,
			skillProficiencies: {perception: 1, stealth: 1, athletics: 1},
			saveProficiencies: ["dex", "con"],
		});

		JqueryUtil.doToast({type: "success", content: `Created ${stats.name}!`});
	}

	/**
	 * Drakewarden Ranger - Summon Drake
	 */
	async _onSummonDrake () {
		const calculations = this._state.getFeatureCalculations?.() || {};
		const rangerLevel = this._state.getClassLevel?.("ranger") || 0;
		const pb = this._state.getProficiencyBonus?.() || 2;

		// Dismiss existing drake first
		const existingDrakes = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.DRAKE) || [];
		for (const drake of existingDrakes) {
			this._state.removeCompanion?.(drake.id);
		}

		// Choose damage type
		const damageType = await InputUiUtil.pGetUserEnum({
			title: "Drake Damage Type",
			htmlDescription: `<div>Choose your Drake's damage type (Draconic Essence):</div>`,
			values: ["Acid", "Cold", "Fire", "Lightning", "Poison"],
			isResolveItem: true,
		});
		if (!damageType) return;

		// Scaling based on ranger level
		const size = rangerLevel >= 15 ? "L" : rangerLevel >= 7 ? "M" : "S";
		const canFly = rangerLevel >= 7;
		const hp = 5 + (5 * rangerLevel);
		const ac = 14 + pb;

		this._state.addCompanion?.({
			name: "Drake Companion",
			type: CharacterSheetState.COMPANION_TYPES.DRAKE,
			origin: "Drakewarden",
			size,
			creatureType: "dragon",
			ac,
			hp: {max: hp, current: hp},
			speed: {walk: 40, fly: canFly ? 40 : 0},
			abilities: {str: 16, dex: 12, con: 15, int: 8, wis: 14, cha: 8},
			senses: ["darkvision 60 ft."],
			passive: 10 + 2 + pb,
			actions: [
				{name: "Bite", entries: [`Melee Attack: +${pb + 3} to hit, reach 5 ft. Hit: 1d6 + ${pb} piercing damage.`]},
			],
			reactions: [
				{name: "Infused Strikes", entries: [`When another creature within 30 feet hits a target, add 1d6 ${damageType.toLowerCase()} damage to the attack.`]},
			],
			traits: [
				{name: "Draconic Essence", entries: [`${damageType} damage. The drake's bite deals +1d6 ${damageType.toLowerCase()} damage.`]},
			],
			immunities: [damageType.toLowerCase()],
			profBonus: pb,
			skillProficiencies: {perception: 1},
			saveProficiencies: ["dex", "wis"],
		});

		this._saveCurrentCharacter();
		this._renderCompanions();
		JqueryUtil.doToast({type: "success", content: `Summoned Drake Companion (${damageType})!`});
	}

	/**
	 * Battle Smith Artificer - Create Steel Defender
	 */
	async _onSummonSteelDefender () {
		const calculations = this._state.getFeatureCalculations?.() || {};
		const artificerLevel = this._state.getClassLevel?.("artificer") || 0;
		const pb = this._state.getProficiencyBonus?.() || 2;
		const intMod = this._state.getAbilityMod?.("int") || 0;

		// Dismiss existing steel defender first
		const existingDefenders = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER) || [];
		for (const defender of existingDefenders) {
			this._state.removeCompanion?.(defender.id);
		}

		// Steel Defender stats
		const hp = 2 + intMod + (5 * artificerLevel);
		const ac = artificerLevel >= 15 ? 17 : 15;
		const spellAttackMod = pb + intMod;

		this._state.addCompanion?.({
			name: "Steel Defender",
			type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
			origin: "Battle Smith",
			size: "M",
			creatureType: "construct",
			ac,
			hp: {max: hp, current: hp},
			speed: {walk: 40},
			abilities: {str: 14, dex: 12, con: 14, int: 4, wis: 10, cha: 6},
			senses: ["darkvision 60 ft."],
			passive: 10 + pb,
			actions: [
				{name: "Force-Empowered Rend", entries: [`Melee Attack: +${spellAttackMod} to hit, reach 5 ft. Hit: 1d8 + ${pb} force damage.`]},
				{name: "Repair (3/Day)", entries: [`The defender restores 2d8 + ${pb} HP to itself or a construct within 5 feet.`]},
			],
			reactions: [
				{name: "Deflect Attack", entries: ["When a creature the defender can see within 5 feet is hit by an attack, impose disadvantage on that attack roll."]},
			],
			traits: [
				{name: "Vigilant", entries: ["The defender can't be surprised."]},
			],
			immunities: ["poison"],
			conditionImmunities: ["charmed", "exhaustion", "poisoned"],
			profBonus: pb,
			skillProficiencies: {athletics: 1, perception: 1},
			saveProficiencies: ["dex", "con"],
		});

		this._saveCurrentCharacter();
		this._renderCompanions();
		JqueryUtil.doToast({type: "success", content: `Created Steel Defender! (HP: ${hp}, AC: ${ac})`});
	}

	/**
	 * Druid - Wild Shape
	 */
	async _onWildShape () {
		const calculations = this._state.getFeatureCalculations?.() || {};
		const druidLevel = this._state.getClassLevel?.("druid") || 0;

		// Check if already in wild shape
		const existingWildShape = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.WILD_SHAPE) || [];
		if (existingWildShape.length > 0) {
			const confirmed = await InputUiUtil.pGetUserBoolean({
				title: "End Wild Shape?",
				htmlDescription: `You are currently in Wild Shape as <strong>${existingWildShape[0].name}</strong>. End this form?`,
				textYes: "End Wild Shape",
				textNo: "Cancel",
			});
			if (confirmed) {
				for (const ws of existingWildShape) {
					this._state.removeCompanion?.(ws.id);
				}
				this._saveCurrentCharacter();
				this._renderCompanions();
				JqueryUtil.doToast({type: "info", content: "Wild Shape ended."});
			}
			return;
		}

		// Show beast picker with CR limit based on druid level
		const maxCr = calculations.wildShapeCr || (druidLevel >= 8 ? 1 : druidLevel >= 4 ? 0.5 : 0.25);
		const canSwim = calculations.wildShapeCanSwim || druidLevel >= 4;
		const canFly = calculations.wildShapeCanFly || druidLevel >= 8;

		await this._pShowBeastPicker({
			maxCr,
			canSwim,
			canFly,
			type: CharacterSheetState.COMPANION_TYPES.WILD_SHAPE,
			origin: "Wild Shape",
		});

		this._saveCurrentCharacter();
		this._renderCompanions();
	}

	/**
	 * Druid - Wild Companion (summon Fey familiar using Wild Shape)
	 */
	async _onWildCompanion () {
		const calculations = this._state.getFeatureCalculations?.() || {};
		const druidLevel = this._state.getClassLevel?.("druid") || 0;

		// Dismiss existing familiars first
		const existingFamiliars = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.FAMILIAR) || [];
		for (const familiar of existingFamiliars) {
			this._state.removeCompanion?.(familiar.id);
		}

		// Use the spells module's familiar picker, but mark the result as Fey
		if (this._spells?._pShowFamiliarPicker) {
			// Pass isFey flag to indicate this is a Wild Companion (Fey creature type)
			await this._spells._pShowFamiliarPicker({isWildCompanion: true});

			// After selection, update the familiar's creature type to Fey
			const newFamiliars = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.FAMILIAR) || [];
			for (const familiar of newFamiliars) {
				if (familiar.creatureType === "beast") {
					familiar.creatureType = "fey";
					familiar.origin = "Wild Companion";
				}
			}

			// Add duration note based on PHB vs XPHB rules
			const duration = calculations.wildCompanionDuration || "";
			JqueryUtil.doToast({
				type: "success",
				content: `Wild Companion summoned as a Fey! Duration: ${duration}`,
			});
		} else {
			JqueryUtil.doToast({type: "warning", content: "Familiar picker not available."});
		}

		this._saveCurrentCharacter();
		this._renderCompanions();
	}

	/**
	 * Find Steed / Find Greater Steed
	 */
	async _onFindSteed (isGreater = false) {
		// Dismiss existing mounts first
		const existingMounts = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.MOUNT) || [];
		for (const mount of existingMounts) {
			this._state.removeCompanion?.(mount.id);
		}

		const maxCr = isGreater ? 2 : 0.5;
		await this._pShowMountPicker(maxCr, isGreater);

		this._saveCurrentCharacter();
		this._renderCompanions();
	}

	/**
	 * Show mount picker for Find Steed/Find Greater Steed
	 */
	async _pShowMountPicker (maxCr, isGreater = false) {
		const spellName = isGreater ? "Find Greater Steed" : "Find Steed";

		// Standard mount options
		const standardMounts = isGreater
			? ["Griffon", "Pegasus", "Peryton", "Dire Wolf", "Rhinoceros", "Saber-Toothed Tiger"]
			: ["Warhorse", "Pony", "Camel", "Elk", "Mastiff"];

		const choice = await InputUiUtil.pGetUserEnum({
			title: spellName,
			htmlDescription: `<div>Choose your steed (appears as celestial, fey, or fiend):</div>`,
			values: [...standardMounts, "From Bestiary..."],
			isResolveItem: true,
		});
		if (!choice) return;

		if (choice === "From Bestiary...") {
			await this._pShowBeastPicker({
				maxCr,
				type: CharacterSheetState.COMPANION_TYPES.MOUNT,
				origin: spellName,
				creatureTypes: ["beast"],
				minSize: "L", // Mounts must be Large or larger
			});
		} else {
			// Use standard mount stats
			const mountStats = this._getStandardMountStats(choice);
			if (mountStats) {
				this._state.addCompanion?.({
					...mountStats,
					type: CharacterSheetState.COMPANION_TYPES.MOUNT,
					origin: spellName,
				});
				JqueryUtil.doToast({type: "success", content: `Summoned ${choice} as your steed!`});
			}
		}
	}

	/**
	 * Get standard mount stats
	 */
	_getStandardMountStats (name) {
		const mounts = {
			"Warhorse": {name: "Warhorse", size: "L", creatureType: "beast", ac: 11, hp: {max: 19, current: 19}, speed: {walk: 60}, abilities: {str: 18, dex: 12, con: 13, int: 2, wis: 12, cha: 7}, senses: [], passive: 11},
			"Pony": {name: "Pony", size: "M", creatureType: "beast", ac: 10, hp: {max: 11, current: 11}, speed: {walk: 40}, abilities: {str: 15, dex: 10, con: 13, int: 2, wis: 11, cha: 7}, senses: [], passive: 10},
			"Camel": {name: "Camel", size: "L", creatureType: "beast", ac: 9, hp: {max: 15, current: 15}, speed: {walk: 50}, abilities: {str: 16, dex: 8, con: 14, int: 2, wis: 8, cha: 5}, senses: [], passive: 9},
			"Elk": {name: "Elk", size: "L", creatureType: "beast", ac: 10, hp: {max: 13, current: 13}, speed: {walk: 50}, abilities: {str: 16, dex: 10, con: 12, int: 2, wis: 10, cha: 6}, senses: [], passive: 10},
			"Mastiff": {name: "Mastiff", size: "M", creatureType: "beast", ac: 12, hp: {max: 5, current: 5}, speed: {walk: 40}, abilities: {str: 13, dex: 14, con: 12, int: 3, wis: 12, cha: 7}, senses: [], passive: 13},
			"Griffon": {name: "Griffon", size: "L", creatureType: "monstrosity", ac: 12, hp: {max: 59, current: 59}, speed: {walk: 30, fly: 80}, abilities: {str: 18, dex: 15, con: 16, int: 2, wis: 13, cha: 8}, senses: ["darkvision 60 ft."], passive: 15},
			"Pegasus": {name: "Pegasus", size: "L", creatureType: "celestial", ac: 12, hp: {max: 59, current: 59}, speed: {walk: 60, fly: 90}, abilities: {str: 18, dex: 15, con: 16, int: 10, wis: 15, cha: 13}, senses: [], passive: 16},
			"Peryton": {name: "Peryton", size: "M", creatureType: "monstrosity", ac: 13, hp: {max: 33, current: 33}, speed: {walk: 20, fly: 60}, abilities: {str: 16, dex: 12, con: 13, int: 9, wis: 12, cha: 10}, senses: [], passive: 11},
			"Dire Wolf": {name: "Dire Wolf", size: "L", creatureType: "beast", ac: 14, hp: {max: 37, current: 37}, speed: {walk: 50}, abilities: {str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7}, senses: [], passive: 13},
			"Rhinoceros": {name: "Rhinoceros", size: "L", creatureType: "beast", ac: 11, hp: {max: 45, current: 45}, speed: {walk: 40}, abilities: {str: 21, dex: 8, con: 15, int: 2, wis: 12, cha: 6}, senses: [], passive: 11},
			"Saber-Toothed Tiger": {name: "Saber-Toothed Tiger", size: "L", creatureType: "beast", ac: 12, hp: {max: 52, current: 52}, speed: {walk: 40}, abilities: {str: 18, dex: 14, con: 15, int: 3, wis: 12, cha: 8}, senses: [], passive: 12},
		};
		return mounts[name] || null;
	}

	/**
	 * Generic beast picker from bestiary
	 */
	async _pShowBeastPicker (options = {}) {
		const {maxCr = 1, canSwim = true, canFly = false, type, origin, creatureTypes = ["beast"], minSize = null} = options;

		// Try to load bestiary data
		let allCreatures = [];
		try {
			const bestiaryUrls = [
				"data/bestiary/bestiary-mm.json",
				"data/bestiary/bestiary-xmm.json",
				"data/bestiary/bestiary-mpmm.json",
			];

			for (const url of bestiaryUrls) {
				try {
					const data = await DataUtil.loadJSON(url);
					if (data?.monster) allCreatures.push(...data.monster);
				} catch (e) { /* ignore missing files */ }
			}
		} catch (e) {
			JqueryUtil.doToast({type: "warning", content: "Could not load bestiary data."});
			return;
		}

		// Filter creatures
		const sizeOrder = ["T", "S", "M", "L", "H", "G"];
		const minSizeIdx = minSize ? sizeOrder.indexOf(minSize) : -1;

		const validCreatures = allCreatures.filter(c => {
			// Check type - handle both string and object formats
			let cType = typeof c.type === "string" ? c.type : c.type?.type;
			// Ensure cType is a string before calling toLowerCase
			if (typeof cType !== "string") return false;
			if (!creatureTypes.includes(cType.toLowerCase())) return false;

			// Check CR
			let cr = c.cr;
			if (typeof cr === "object") cr = cr.cr;
			const crNum = Parser.crToNumber(cr);
			if (crNum > maxCr) return false;

			// Check size
			const size = Array.isArray(c.size) ? c.size[0] : c.size;
			if (minSizeIdx >= 0 && sizeOrder.indexOf(size) < minSizeIdx) return false;

			// Check movement restrictions
			if (!canFly && c.speed?.fly) return false;
			if (!canSwim && c.speed?.swim && !c.speed?.walk) return false; // Aquatic-only

			return true;
		});

		if (validCreatures.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "No valid creatures found for this companion type."});
			return;
		}

		// Sort by CR then name
		validCreatures.sort((a, b) => {
			const crA = Parser.crToNumber(typeof a.cr === "object" ? a.cr.cr : a.cr);
			const crB = Parser.crToNumber(typeof b.cr === "object" ? b.cr.cr : b.cr);
			if (crA !== crB) return crA - crB;
			return a.name.localeCompare(b.name);
		});

		// Show picker
		const choice = await InputUiUtil.pGetUserEnum({
			title: `Select ${origin || "Companion"}`,
			htmlDescription: `<div>CR ≤ ${maxCr}${!canFly ? ", no fly" : ""}${!canSwim ? ", no swim-only" : ""}</div>`,
			values: validCreatures.map(c => `${c.name} (CR ${typeof c.cr === "object" ? c.cr.cr : c.cr})`),
			isResolveItem: true,
		});
		if (!choice) return;

		const selectedName = choice.split(" (CR")[0];
		const selectedCreature = validCreatures.find(c => c.name === selectedName);
		if (!selectedCreature) return;

		// Add companion from bestiary
		this._state.addCompanionFromBestiary?.(selectedCreature, /** @type {*} */ ({
			type,
			origin,
		}));

		JqueryUtil.doToast({type: "success", content: `Added ${selectedCreature.name} as ${origin || "companion"}!`});
	}

	/**
	 * Add custom companion manually
	 */
	async _onAddCustomCompanion () {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "➕ Add Custom Companion",
			isMinHeight0: true,
			isWidth100: true,
		});

		let name = "";
		let hp = 10;
		let ac = 10;
		let speed = 30;
		let creatureType = "beast";

		modalInner.innerHTML = `
			<div style="display: flex; flex-direction: column; gap: 12px;">
				<div>
					<label class="ve-small ve-muted">Name *</label>
					<input type="text" class="ve-form-control" id="custom-comp-name" placeholder="Companion name...">
				</div>
				<div style="display: flex; gap: 12px;">
					<div style="flex: 1;">
						<label class="ve-small ve-muted">HP</label>
						<input type="number" class="ve-form-control" id="custom-comp-hp" value="10" min="1">
					</div>
					<div style="flex: 1;">
						<label class="ve-small ve-muted">AC</label>
						<input type="number" class="ve-form-control" id="custom-comp-ac" value="10" min="1">
					</div>
					<div style="flex: 1;">
						<label class="ve-small ve-muted">Speed (ft)</label>
						<input type="number" class="ve-form-control" id="custom-comp-speed" value="30" min="0">
					</div>
				</div>
				<div>
					<label class="ve-small ve-muted">Creature Type</label>
					<select class="ve-form-control" id="custom-comp-type">
						<option value="beast">Beast</option>
						<option value="celestial">Celestial</option>
						<option value="construct">Construct</option>
						<option value="dragon">Dragon</option>
						<option value="elemental">Elemental</option>
						<option value="fey">Fey</option>
						<option value="fiend">Fiend</option>
						<option value="undead">Undead</option>
					</select>
				</div>
				<div class="ve-flex-h-right" style="gap: 8px; margin-top: 8px;">
					<button class="ve-btn ve-btn-default" id="custom-comp-cancel">Cancel</button>
					<button class="ve-btn ve-btn-primary" id="custom-comp-add">
						<span class="glyphicon glyphicon-plus mr-1"></span>Add Companion
					</button>
				</div>
			</div>
		`;

		modalInner.querySelector("#custom-comp-cancel").addEventListener("click", doClose);
		modalInner.querySelector("#custom-comp-add").addEventListener("click", () => {
			name = modalInner.querySelector("#custom-comp-name").value?.trim();
			hp = parseInt(modalInner.querySelector("#custom-comp-hp").value) || 10;
			ac = parseInt(modalInner.querySelector("#custom-comp-ac").value) || 10;
			speed = parseInt(modalInner.querySelector("#custom-comp-speed").value) || 30;
			creatureType = modalInner.querySelector("#custom-comp-type").value || "beast";

			if (!name) {
				JqueryUtil.doToast({type: "warning", content: "Please enter a name."});
				return;
			}

			this._state.addCompanion?.({
				name,
				type: CharacterSheetState.COMPANION_TYPES.CUSTOM,
				origin: "Custom",
				creatureType,
				ac,
				hp: {max: hp, current: hp},
				speed: {walk: speed},
				abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
			});

			doClose();
			this._saveCurrentCharacter();
			this._renderCompanions();
			JqueryUtil.doToast({type: "success", content: `Added ${name}!`});
		});
	}

	async _saveCurrentCharacter () {
		if (!this._currentCharacterId) return;

		// Show saving indicator
		this._updateSaveIndicator("saving");

		try {
			let characters = await StorageUtil.pGet("charsheet-characters") || [];
			const charData = this._state.toJson();
			charData.id = this._currentCharacterId;

			const existingIndex = characters.findIndex(c => c.id === this._currentCharacterId);
			if (existingIndex >= 0) {
				characters[existingIndex] = charData;
			} else {
				characters.push(charData);
			}

			await StorageUtil.pSet("charsheet-characters", characters);

			// Show saved indicator
			this._updateSaveIndicator("saved");
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error("Save error:", err);
			this._updateSaveIndicator("error");
		}
	}

	/**
	 * Update the save indicator UI
	 * @param {"saving"|"saved"|"error"} status
	 */
	_updateSaveIndicator (status) {
		const indicator = document.getElementById("charsheet-save-indicator");
		if (!indicator) return;

		indicator.classList.remove("charsheet__save-indicator--saving", "charsheet__save-indicator--error");

		switch (status) {
			case "saving":
				indicator.classList.add("charsheet__save-indicator--saving");
				if (indicator.querySelector(".charsheet__save-icon")) indicator.querySelector(".charsheet__save-icon").textContent = "⟳";
				if (indicator.querySelector(".charsheet__save-text")) indicator.querySelector(".charsheet__save-text").textContent = "Saving...";
				break;
			case "saved":
				if (indicator.querySelector(".charsheet__save-icon")) indicator.querySelector(".charsheet__save-icon").textContent = "✓";
				if (indicator.querySelector(".charsheet__save-text")) indicator.querySelector(".charsheet__save-text").textContent = "Saved";
				break;
			case "error":
				indicator.classList.add("charsheet__save-indicator--error");
				if (indicator.querySelector(".charsheet__save-icon")) indicator.querySelector(".charsheet__save-icon").textContent = "✗";
				if (indicator.querySelector(".charsheet__save-text")) indicator.querySelector(".charsheet__save-text").textContent = "Error";
				break;
		}
	}

	async _onImportCharacter () {
		const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({expectedFileTypes: ["character"]});

		if (errors?.length) {
			JqueryUtil.doToast({type: "danger", content: `Error importing file: ${errors.join(", ")}`});
			return;
		}

		const json = jsons?.[0];
		if (!json) return;

		// Validate basic structure
		if (!json.name && !json.classes && !json.race) {
			JqueryUtil.doToast({type: "danger", content: "Invalid character file format."});
			return;
		}

		// Assign new ID
		json.id = CryptUtil.uid();
		this._currentCharacterId = json.id;
		this._state.loadFromJson(json);
		await this._saveCurrentCharacter();
		await this._pLoadCharacters();
		this._selCharacter.value = json.id;
		this._renderCharacter();

		JqueryUtil.doToast({type: "success", content: `Imported character: ${json.name || "Unnamed"}`});
	}

	_onExportCharacter () {
		if (!this._currentCharacterId) {
			JqueryUtil.doToast({type: "warning", content: "No character to export."});
			return;
		}

		const charData = this._state.toJson();
		// Note: DataUtil.userDownload appends ".json" itself — pass bare basename.
		const filename = `${(charData.name || "character").toLowerCase().replace(/\s+/g, "-")}`;
		DataUtil.userDownload(filename, charData, {fileType: "character"});
	}
	// #endregion

	// #region Rendering
	_renderCharacter () {
		this._renderBasicInfo();
		this._renderAbilityScores();
		this._renderSavingThrows();
		this._renderSkills();
		this._renderHp();
		this._renderCombatStats();
		this._renderDefenses();
		this._renderHitDice();
		this._renderDeathSaves();
		this._renderInspiration();
		this._renderProficiencies();
		this._renderCurrency();
		this._renderNotes();
		this._renderAppearance();
		this._renderPortrait();
		this._renderConditions();
		this._renderExhaustion();
		this._renderResources();
		this._renderOverviewMetamagic();
		this._renderOverviewAbilities();
		this._renderActiveStates();
		this._renderFavouritesOverview();
		this._renderOverviewActions();
		this._renderAttacks();
		this._renderQuickSpells();
		this._renderAbilitiesDetailed();
		this._renderModifierIndicators();
		this._renderCompanions();

		// Sub-modules
		if (this._spells) this._spells.render();
		if (this._inventory) this._inventory.render();
		if (this._features) this._features.render();
		if (this._customAbilities) this._customAbilities.render();
		if (this._combat) this._combat.render();
		if (this._respec) this._respec.render();
		if (this._playMode && this._state.getViewMode() === "play") this._playMode.render();

		// Update tab visibility based on character state
		this._updateTabVisibility();
	}

	_renderBasicInfo () {
		(/** @type {*} */ (document.getElementById("charsheet-ipt-name"))).value = this._state.getName();
		this._renderXpTracking();

		// Render race with hover link
		const race = this._state.getRace();
		if (race?.name) {
			try {
				const raceName = this._state.getRaceName();
				const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_RACES]({name: race.name, source: race.source});
				(/** @type {*} */ (document.getElementById("charsheet-disp-race"))).innerHTML = CharacterSheetPage.getHoverLink(UrlUtil.PG_RACES, raceName, race.source, hash);
			} catch (e) {
				(/** @type {*} */ (document.getElementById("charsheet-disp-race"))).textContent = this._state.getRaceName() || "—";
			}
		} else {
			(/** @type {*} */ (document.getElementById("charsheet-disp-race"))).textContent = "—";
		}

		// Render class with hover links
		const classes = this._state.getClasses();
		if (classes.length) {
			const classLinks = classes.map(c => {
				try {
					const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES]({name: c.name, source: c.source});
					return CharacterSheetPage.getHoverLink(UrlUtil.PG_CLASSES, `${c.name} ${c.level}`, c.source, hash);
				} catch (e) {
					return `${c.name} ${c.level}`;
				}
			});
			(/** @type {*} */ (document.getElementById("charsheet-disp-class"))).innerHTML = classLinks.join(" / ");
		} else {
			(/** @type {*} */ (document.getElementById("charsheet-disp-class"))).textContent = "—";
		}

		(/** @type {*} */ (document.getElementById("charsheet-disp-level"))).textContent = this._state.getTotalLevel();

		// Render background with hover link
		const background = this._state.getBackground();
		if (background?.name) {
			// Don't create hover links for custom backgrounds (source="Custom")
			if (background.source === "Custom") {
				(/** @type {*} */ (document.getElementById("charsheet-disp-background"))).textContent = background.name;
			} else {
				try {
					const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BACKGROUNDS]({name: background.name, source: background.source});
					(/** @type {*} */ (document.getElementById("charsheet-disp-background"))).innerHTML = CharacterSheetPage.getHoverLink(UrlUtil.PG_BACKGROUNDS, background.name, background.source, hash);
				} catch (e) {
					(/** @type {*} */ (document.getElementById("charsheet-disp-background"))).textContent = this._state.getBackgroundName() || "—";
				}
			}
		} else {
			(/** @type {*} */ (document.getElementById("charsheet-disp-background"))).textContent = "—";
		}

		// Render size and reach chips
		this._renderSizeChip();
		this._renderReachChip();

		(/** @type {*} */ (document.getElementById("charsheet-disp-proficiency"))).textContent = `+${this._state.getProficiencyBonus()}`;
		this._renderLevelUpBanner();
	}

	_renderXpTracking () {
		const currentXp = this._state.getXp();
		(/** @type {*} */ (document.getElementById("charsheet-disp-xp-current"))).textContent = currentXp.toLocaleString();

		const totalLevel = this._state.getTotalLevel();
		if (totalLevel <= 0) {
			(/** @type {*} */ (document.getElementById("charsheet-disp-xp-progress"))).textContent = "Add a class to track level progression.";
			return;
		}

		if (totalLevel >= 20) {
			(/** @type {*} */ (document.getElementById("charsheet-disp-xp-progress"))).textContent = "Maximum level reached.";
			return;
		}

		const nextLevel = totalLevel + 1;
		const xpToNext = this._state.getXpToNextLevel();
		const xpRequired = this._state.getXpRequiredForNextLevel();
		if (xpToNext <= 0) {
			(/** @type {*} */ (document.getElementById("charsheet-disp-xp-progress"))).textContent = `Ready for level ${nextLevel} (${currentXp.toLocaleString()}/${xpRequired.toLocaleString()} XP).`;
			return;
		}

		(/** @type {*} */ (document.getElementById("charsheet-disp-xp-progress"))).textContent = `${xpToNext.toLocaleString()} XP to level ${nextLevel} (${currentXp.toLocaleString()}/${xpRequired.toLocaleString()} XP).`;
	}

	_renderLevelUpBanner () {
		const banner = document.getElementById("charsheet-levelup-banner");
		const text = document.getElementById("charsheet-levelup-banner-text");
		if (!banner || !text) return;

		const totalLevel = this._state.getTotalLevel();
		if (this._isLevelUpBannerDismissed || totalLevel <= 0 || totalLevel >= 20) {
			banner.classList.add("ve-hidden");
			return;
		}

		if (!this._state.canLevelUpFromXp()) {
			banner.classList.add("ve-hidden");
			return;
		}

		const nextLevel = totalLevel + 1;
		const xpRequired = this._state.getXpRequiredForNextLevel();
		const currentXp = this._state.getXp();
		text.textContent = `You can level up to ${nextLevel} now (${currentXp.toLocaleString()}/${xpRequired.toLocaleString()} XP).`;
		banner.classList.remove("ve-hidden");
	}

	/**
	 * Render the size chip - always visible to show current size
	 */
	_renderSizeChip () {
		const chip = document.getElementById("charsheet-size-chip");
		const value = document.getElementById("charsheet-disp-size");

		const baseSize = this._state.getBaseSize();
		const currentSize = this._state.getSize();

		const sizeChanged = currentSize !== baseSize;

		// Always show the chip
		chip.classList.remove("ve-hidden");

		// Build the display text
		const sizeText = currentSize.charAt(0).toUpperCase() + currentSize.slice(1);
		value.textContent = sizeText;

		// Build tooltip
		const tooltipParts = [`Size: ${sizeText}`];
		if (sizeChanged) {
			const baseSizeText = baseSize.charAt(0).toUpperCase() + baseSize.slice(1);
			tooltipParts.push(`Base Size: ${baseSizeText}`);
		}
		tooltipParts.push(`Carry Capacity: ×${this._state.getSizeCarryMultiplier()}`);

		chip.setAttribute("title", tooltipParts.join("\n"));

		// Add visual indicator if size is modified
		if (sizeChanged) {
			const direction = this._state.getSizeIncreaseFromStates() > this._state.getSizeDecreaseFromStates() ? "increased" : "decreased";
			chip.classList.add(`charsheet__info-chip--size-${direction}`);
			chip.classList.remove(direction === "increased" ? "charsheet__info-chip--size-decreased" : "charsheet__info-chip--size-increased");
		} else {
			chip.classList.remove("charsheet__info-chip--size-increased", "charsheet__info-chip--size-decreased");
		}
	}

	/**
	 * Render the reach chip - always visible to show current melee reach
	 */
	_renderReachChip () {
		const chip = document.getElementById("charsheet-reach-chip");
		const value = document.getElementById("charsheet-disp-reach");

		const baseReach = 5; // Standard reach for Medium/Small creatures
		const reachBonus = this._state.getReachBonus();
		const meleeReach = this._state.getMeleeReach();

		const hasReachModifier = reachBonus !== 0;

		// Build the display text
		value.textContent = `${meleeReach} ft`;

		// Build tooltip
		const tooltipParts = [`Melee Reach: ${meleeReach} ft`];
		if (hasReachModifier) {
			tooltipParts.push(`Base: ${baseReach} ft`);
			const sign = reachBonus > 0 ? "+" : "";
			tooltipParts.push(`Modifier: ${sign}${reachBonus} ft`);
		}

		chip.setAttribute("title", tooltipParts.join("\n"));

		// Add visual indicator if reach is modified
		if (reachBonus > 0) {
			chip.classList.add("charsheet__info-chip--reach-bonus");
			chip.classList.remove("charsheet__info-chip--reach-penalty");
		} else if (reachBonus < 0) {
			chip.classList.add("charsheet__info-chip--reach-penalty");
			chip.classList.remove("charsheet__info-chip--reach-bonus");
		} else {
			chip.classList.remove("charsheet__info-chip--reach-bonus", "charsheet__info-chip--reach-penalty");
		}
	}

	_renderAbilities () {
		const container = document.getElementById("charsheet-abilities");
		container.innerHTML = "";

		Parser.ABIL_ABVS.forEach(abl => {
			const ability = e_({outer: `
				<div class="charsheet__ability" data-ability="${abl}" title="Click to roll ${Parser.attAbvToFull(abl)} (Shift=Adv, Ctrl=Dis)">
					<div class="charsheet__ability-name">${abl.toUpperCase()}</div>
					<div class="charsheet__ability-score" id="charsheet-ability-${abl}-score">10</div>
					<div class="charsheet__ability-mod" id="charsheet-ability-${abl}-mod">+0</div>
				</div>
			`});

			ability.addEventListener("click", (e) => this._rollAbilityCheck(abl, e));
			container.append(ability);
		});
	}

	_renderAbilityScores () {
		Parser.ABIL_ABVS.forEach(abl => {
			const score = this._state.getAbilityScore(abl);
			const mod = this._state.getAbilityMod(abl);
			(/** @type {*} */ (document.getElementById(`charsheet-ability-${abl}-score`))).textContent = score;
			(/** @type {*} */ (document.getElementById(`charsheet-ability-${abl}-mod`))).textContent = mod >= 0 ? `+${mod}` : mod;
		});

		// Update prominent passive scores display
		this._renderPassiveScores();
	}

	_renderPassiveScores () {
		(/** @type {*} */ (document.getElementById("charsheet-passive-perception"))).textContent = this._state.getPassiveScore("perception");
		(/** @type {*} */ (document.getElementById("charsheet-passive-investigation"))).textContent = this._state.getPassiveScore("investigation");
		(/** @type {*} */ (document.getElementById("charsheet-passive-insight"))).textContent = this._state.getPassiveScore("insight");
	}

	_renderSavingThrows () {
		const container = document.getElementById("charsheet-saves");
		container.innerHTML = "";

		Parser.ABIL_ABVS.forEach(abl => {
			const isProficient = this._state.hasSaveProficiency(abl);
			const mod = this._state.getSaveMod(abl);
			const modStr = mod >= 0 ? `+${mod}` : mod;
			const breakdown = this._state.getSaveBreakdown(abl);
			const tooltipLines = breakdown.components.map(comp => `${comp.icon} ${comp.name}: ${comp.value >= 0 ? "+" : ""}${comp.value}`);
			tooltipLines.push(`─────────\n🎯 Total: ${modStr}`);
			const tooltip = tooltipLines.join("\n");

			const row = e_({outer: `
				<div class="charsheet__save-row" data-save="${abl}" title="${tooltip.replace(/"/g, "&quot;")}">
					<span class="charsheet__prof-indicator ${isProficient ? "charsheet__prof-indicator--proficient" : ""}"></span>
					<span class="charsheet__save-name">${Parser.attAbvToFull(abl)}</span>
					<span class="charsheet__save-mod">${modStr}</span>
				</div>
			`});

			// Passive defensive alerts (Evasion, Last Ditch Evasion, etc.) — small chips next to the mod.
			const passiveAlerts = this._state.getPassiveSaveAlerts?.(abl) || [];
			passiveAlerts.forEach(alert => {
				const badgeTitle = alert.source ? `${alert.name} (${alert.source})\n${alert.summary}` : `${alert.name}\n${alert.summary}`;
				const badge = e_({outer: `<span class="charsheet__save-passive-badge" data-passive="${alert.key}" title="${badgeTitle.replace(/"/g, "&quot;")}">⚡ ${alert.name}</span>`});
				badge.addEventListener("click", (e) => e.stopPropagation());
				row.append(badge);
			});

			row.addEventListener("click", (e) => this._rollSavingThrow(abl, e));
			container.append(row);
		});
	}

	_renderSkills () {
		const container = document.getElementById("charsheet-skills");
		container.innerHTML = "";

		// Add header row with column labels
		container.append(e_({outer: `
			<div class="charsheet__skills-header">
				<span class="charsheet__skills-header-prof" title="Proficiency level: Click dots to cycle">Prof</span>
				<span class="charsheet__skills-header-name">Skill</span>
				<span class="charsheet__skills-header-ability">Abl</span>
				<span class="charsheet__skills-header-mod">Mod</span>
				<span class="charsheet__skills-header-passive" title="Passive score = 10 + modifier">Passive</span>
			</div>
		`}));

		// Get skills from loaded data (dynamic, supports homebrew)
		const allSkills = this.getSkillsList();
		const skills = allSkills.filter(s => !s.isLoreSkill);
		const loreSkills = allSkills.filter(s => s.isLoreSkill);

		// Check for Jack of All Trades (half proficiency for non-proficient skills)
		const hasJackOfAllTrades = this._state.hasJackOfAllTrades();

		skills.forEach(skill => {
			const skillKey = skill.name.toLowerCase().replace(/\s+/g, "");
			const profLevel = this._state.getSkillProficiency(skillKey);
			const mod = this._state.getSkillMod(skillKey);
			const modStr = mod >= 0 ? `+${mod}` : mod;

			let profClass = "";
			let profTitle = "Not proficient - Click to toggle proficiency";
			if (profLevel === 2) {
				profClass = "charsheet__prof-indicator--expertise";
				profTitle = "Expertise (2x proficiency bonus) - Click to toggle";
			} else if (profLevel === 1) {
				profClass = "charsheet__prof-indicator--proficient";
				profTitle = "Proficient - Click to toggle";
			} else if (hasJackOfAllTrades) {
				profClass = "charsheet__prof-indicator--half";
				profTitle = "Half proficiency (Jack of All Trades) - Click to toggle";
			}

			// Calculate passive score using centralized method (includes modifiers, advantage, stances)
			const passiveScore = this._state.getPassiveScore(skillKey);

			// Handle skills without ability (custom skills with no ability set)
			const abilityDisplay = skill.ability ? skill.ability.toUpperCase() : "—";
			const defaultAbility = skill.ability || "";

			const customClass = skill.isCustom ? " charsheet__skill-row--custom" : "";
			const breakdown = this._state.getSkillBreakdown(skillKey);
			const tooltipLines = breakdown.components.map(comp => `${comp.icon} ${comp.name}: ${comp.value >= 0 ? "+" : ""}${comp.value}`);
			tooltipLines.push(`─────────\n🎯 Total: ${modStr}`);
			const skillTooltip = tooltipLines.join("\n");

			const row = e_({outer: `
				<div class="charsheet__skill-row${customClass}" data-skill="${skillKey}" data-default-ability="${defaultAbility}" title="${skillTooltip.replace(/"/g, "&quot;")}">
					<span class="charsheet__prof-indicator charsheet__prof-indicator--clickable ${profClass}" title="${profTitle}" data-skill="${skillKey}"></span>
					<span class="charsheet__skill-name">${skill.name}${skill.isCustom ? " ✦" : ""}</span>
					<span class="charsheet__skill-ability">(${abilityDisplay})</span>
					<span class="charsheet__skill-mod">${modStr}</span>
					<span class="charsheet__skill-passive" title="Passive ${skill.name}: ${passiveScore}">${passiveScore}</span>
					${skill.isCustom ? `<span class="charsheet__skill-delete" title="Remove custom skill">×</span>` : ""}
				</div>
			`});

			// Proficiency toggle click handler
			row.querySelector(".charsheet__prof-indicator").addEventListener("click", (e) => {
				e.stopPropagation();
				this._cycleSkillProficiency(skillKey);
			});

			row.addEventListener("click", (e) => {
				// Don't roll if clicking delete button or prof indicator
				if (e.target.classList.contains("charsheet__skill-delete")) return;
				if (e.target.classList.contains("charsheet__prof-indicator")) return;
				this._rollSkillCheck(skillKey, skill.name, e);
			});
			row.addEventListener("contextmenu", (e) => this._showSkillAbilityMenu(e, skillKey, skill.name, skill.ability));

			if (skill.isCustom) {
				row.querySelector(".charsheet__skill-delete").addEventListener("click", (e) => {
					e.stopPropagation();
					this._state.removeCustomSkill(skill.name);
					this._renderSkills();
					this._saveCurrentCharacter();
				});
			}

			container.append(row);
		});

		// Add "Add Custom Skill" button
		const addBtn = e_({outer: `
			<div class="charsheet__skill-add" title="Add a custom skill">
				<span class="charsheet__skill-add-icon">+</span>
				<span class="charsheet__skill-add-text">Add Custom Skill</span>
			</div>
		`});
		addBtn.addEventListener("click", () => this._showAddCustomSkillModal());
		container.append(addBtn);

		// Lore Skills section (TGTT variant rule)
		this._renderLoreSkillsSection(container, loreSkills);
	}

	/**
	 * Render the Lore Skills sub-section beneath the main skills table.
	 * Lore skills use a flat per-skill bonus (no ability or PB scaling).
	 * @param {HTMLElement} container
	 * @param {Array<{name:string, isLoreSkill:boolean}>} loreSkills
	 */
	_renderLoreSkillsSection (container, loreSkills) {
		const section = e_({outer: `
			<div class="charsheet__lore-skills-section">
				<div class="charsheet__lore-skills-header ve-flex-v-center mt-3" title="TGTT variant rule: Lore Skills">
					<span class="mr-1">📚</span>
					<span class="charsheet__lore-skills-title">Lore Skills</span>
					<span class="ve-muted ve-small ml-2">flat bonus &mdash; no ability or proficiency added</span>
				</div>
				<div class="charsheet__lore-skills-list"></div>
			</div>
		`});
		const listEl = section.querySelector(".charsheet__lore-skills-list");

		if (!loreSkills.length) {
			listEl.append(e_({outer: `
				<div class="ve-muted ve-small charsheet__lore-skills-empty">
					No lore skills yet. Most Thelemar characters start with 2&ndash;3 from their background &mdash;
					gain more by reading books, tutoring, or the Lore Mastery feat.
				</div>
			`}));
		} else {
			loreSkills.forEach(skill => {
				const skillKey = skill.name.toLowerCase().replace(/\s+/g, "");
				const mod = this._state.getSkillMod(skillKey);
				const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
				const breakdown = this._state.getSkillBreakdown(skillKey);
				const tooltipLines = breakdown.components.map(comp => `${comp.icon} ${comp.name}: ${comp.value >= 0 ? "+" : ""}${comp.value}`);
				tooltipLines.push(`─────────\n📚 Total: ${modStr}`);
				const tooltip = tooltipLines.join("\n");

				const row = e_({outer: `
					<div class="charsheet__lore-skill-row" data-skill="${skillKey}" title="${tooltip.replace(/"/g, "&quot;")}">
						<span class="charsheet__lore-skill-icon">📚</span>
						<span class="charsheet__lore-skill-name">${skill.name}</span>
						<span class="charsheet__lore-skill-mod">${modStr}</span>
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__lore-skill-bump" data-delta="-2" title="Decrease bonus by 2">▼</button>
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__lore-skill-bump" data-delta="2" title="Increase bonus by 2">▲</button>
						<span class="charsheet__lore-skill-delete" title="Remove lore skill">×</span>
					</div>
				`});

				row.querySelectorAll(".charsheet__lore-skill-bump").forEach(btn => {
					btn.addEventListener("click", (/** @type {*} */ ev) => {
						ev.stopPropagation();
						const delta = Number(btn.getAttribute("data-delta")) || 0;
						const loreEntry = this._state.getLoreSkills().find(s =>
							s.name.toLowerCase().replace(/\s+/g, "") === skillKey,
						);
						if (!loreEntry) return;
						const nextBonus = (loreEntry.bonus || 0) + delta;
						if (nextBonus < 2) {
							JqueryUtil.doToast({type: "info", content: "Lore skill bonus can't go below +2."});
							return;
						}
						this._state.setLoreSkillBonus(skill.name, nextBonus);
						this._renderSkills();
						this._saveCurrentCharacter();
					});
				});

				row.querySelector(".charsheet__lore-skill-delete").addEventListener("click", (/** @type {*} */ ev) => {
					ev.stopPropagation();
					this._state.removeLoreSkill(skill.name);
					this._renderSkills();
					this._saveCurrentCharacter();
				});

				row.addEventListener("click", (/** @type {*} */ ev) => {
					if (ev.target.classList.contains("charsheet__lore-skill-delete")) return;
					if (ev.target.classList.contains("charsheet__lore-skill-bump")) return;
					this._rollSkillCheck(skillKey, skill.name, ev);
				});

				listEl.append(row);
			});
		}

		const addLoreBtn = e_({outer: `
			<div class="charsheet__skill-add" title="Add a lore skill (TGTT variant rule)">
				<span class="charsheet__skill-add-icon">+</span>
				<span class="charsheet__skill-add-text">Add Lore Skill</span>
			</div>
		`});
		addLoreBtn.addEventListener("click", () => this._showAddLoreSkillModal());
		section.append(addLoreBtn);

		container.append(section);
	}

	_renderHp () {
		const currentHp = this._state.getCurrentHp();
		const maxHp = this._state.getMaxHp();
		const tempHp = this._state.getTempHp();

		(/** @type {*} */ (document.getElementById("charsheet-ipt-hp-current"))).value = currentHp;
		(/** @type {*} */ (document.getElementById("charsheet-disp-hp-max"))).textContent = maxHp;
		(/** @type {*} */ (document.getElementById("charsheet-ipt-hp-temp"))).value = tempHp;

		// Update HP bar fill width and color
		const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
		const tempPercent = maxHp > 0 ? Math.max(0, Math.min(100 - hpPercent, (tempHp / maxHp) * 100)) : 0;

		// Color based on HP threshold - use 'background' to override CSS linear-gradient
		let barColor = "#28a745"; // Green (healthy)
		if (hpPercent <= 25) {
			barColor = "#dc3545"; // Red (critical)
		} else if (hpPercent <= 50) {
			barColor = "#ffc107"; // Yellow (bloodied)
		}

		Object.assign((/** @type {*} */ (document.getElementById("charsheet-hp-bar-fill"))).style, {
			"width": `${hpPercent}%`,
			"background": barColor, // Use 'background' to override CSS gradient
		});

		// Temp HP bar (cyan/blue, positioned after regular HP)
		Object.assign((/** @type {*} */ (document.getElementById("charsheet-hp-bar-temp"))).style, {
			"width": `${tempPercent}%`,
			"left": `${hpPercent}%`,
			"background": "#17a2b8",
		});

		// Update HP percentage text
		(/** @type {*} */ (document.getElementById("charsheet-hp-percent"))).textContent = `${Math.round(hpPercent)}%`;
	}

	_renderCombatStats () {
		// AC with breakdown
		const acBreakdown = this._state.getAcBreakdown();
		(/** @type {*} */ (document.getElementById("charsheet-disp-ac"))).textContent = acBreakdown.total;
		this._renderAcBreakdown(acBreakdown);

		(/** @type {*} */ (document.getElementById("charsheet-disp-initiative"))).textContent = this._formatMod(this._state.getInitiative());
		this._renderStatBreakdown("#charsheet-initiative-breakdown", this._state.getInitiativeBreakdown());

		// Calculate speed with exhaustion penalty
		const exhaustion = this._state.getExhaustion();
		const rules = this._state.getExhaustionRules();
		const maxExhaustion = this._state.getMaxExhaustion();
		let speedDisplay = this._state.getSpeed();

		if (exhaustion > 0 && exhaustion < maxExhaustion) {
			if (rules === "2024") {
				// 2024: -5 ft per level of exhaustion
				const speedPenalty = exhaustion * 5;
				const baseWalkSpeed = this._state.getWalkSpeed();
				const reducedSpeed = Math.max(0, baseWalkSpeed - speedPenalty);
				speedDisplay = (/** @type {*} */ (speedDisplay)).replace(/^\d+ ft\./, `${reducedSpeed} ft.`);
				if (speedPenalty > 0) {
					speedDisplay += ` (-${speedPenalty})`;
				}
			} else if (rules === "2014") {
				// 2014: Speed halved at level 2, reduced to 0 at level 5
				if (exhaustion >= 5) {
					speedDisplay = "0 ft.";
				} else if (exhaustion >= 2) {
					const baseWalkSpeed = this._state.getWalkSpeed();
					const halvedSpeed = Math.floor(baseWalkSpeed / 2);
					speedDisplay = (/** @type {*} */ (speedDisplay)).replace(/^\d+ ft\./, `${halvedSpeed} ft.`);
					speedDisplay += " (halved)";
				}
			}
			// Thelemar rules: no speed penalty
		}

		(/** @type {*} */ (document.getElementById("charsheet-disp-speed"))).textContent = speedDisplay;
		this._renderStatBreakdown("#charsheet-speed-breakdown", this._state.getSpeedBreakdown("walk"));

		// Jump distances
		// Standard rules: Long jump = STR score, High jump = 3 + STR mod
		// Thelemar rules: Long jump = 8 + Athletics mod, High jump = 2 + Athletics × 0.5
		// Running jumps require a 10ft running start; standing jumps are half
		const useThelemarJumping = (/** @type {*} */ (this._state.getSettings()))?.thelemar_jumping;

		let longJumpRunning, highJumpRunning;

		if (useThelemarJumping) {
			// Thelemar rules: Athletics-based
			const athleticsMod = this._state.getSkillMod("athletics");
			longJumpRunning = 8 + athleticsMod; // Long jump = 8 + Athletics modifier
			highJumpRunning = Math.floor(2 + athleticsMod * 0.5); // High jump = 2 + Athletics × 0.5
		} else {
			// Standard rules: Strength-based
			const strScore = this._state.getAbilityScore("str");
			const strMod = this._state.getAbilityMod("str");
			longJumpRunning = strScore; // Long jump = Strength score in feet
			highJumpRunning = 3 + strMod; // High jump = 3 + Str mod in feet
		}

		// Apply jump multiplier from active states (e.g. Step of the Wind)
		const jumpMultiplier = this._state.getJumpMultiplierFromStates?.() || 1;
		longJumpRunning = Math.floor(longJumpRunning * jumpMultiplier);
		highJumpRunning = Math.floor(highJumpRunning * jumpMultiplier);

		const longJumpStanding = Math.floor(longJumpRunning / 2); // Standing = half of running
		const highJumpStanding = Math.floor(Math.max(0, highJumpRunning) / 2); // Standing = half of running

		(/** @type {*} */ (document.getElementById("charsheet-disp-jump-long-run"))).textContent = `${longJumpRunning}`;
		(/** @type {*} */ (document.getElementById("charsheet-disp-jump-long-stand"))).textContent = `${longJumpStanding}`;
		(/** @type {*} */ (document.getElementById("charsheet-disp-jump-high-run"))).textContent = `${Math.max(0, highJumpRunning)}`;
		(/** @type {*} */ (document.getElementById("charsheet-disp-jump-high-stand"))).textContent = `${highJumpStanding}`;

		// Update tooltips based on rules being used
		if (useThelemarJumping) {
			const athleticsMod = this._state.getSkillMod("athletics");
			const longTooltip = `Long Jump (Thelemar): 8 + Athletics (${athleticsMod >= 0 ? "+" : ""}${athleticsMod}) = ${longJumpRunning} ft. running, ${longJumpStanding} ft. standing`;
			const highTooltip = `High Jump (Thelemar): 2 + Athletics × 0.5 = ${Math.max(0, highJumpRunning)} ft. running, ${highJumpStanding} ft. standing`;
			document.querySelector(".charsheet__physical-stat-item[title*='Long Jump']").setAttribute("title", longTooltip);
			document.querySelector(".charsheet__physical-stat-item[title*='High Jump']").setAttribute("title", highTooltip);
		} else {
			const strScore = this._state.getAbilityScore("str");
			const strMod = this._state.getAbilityMod("str");
			const longTooltip = `Long Jump: STR score (${strScore}) = ${longJumpRunning} ft. running, ${longJumpStanding} ft. standing`;
			const highTooltip = `High Jump: 3 + STR mod (${strMod >= 0 ? "+" : ""}${strMod}) = ${Math.max(0, highJumpRunning)} ft. running, ${highJumpStanding} ft. standing`;
			document.querySelector(".charsheet__physical-stat-item[title*='Long Jump']").setAttribute("title", longTooltip);
			document.querySelector(".charsheet__physical-stat-item[title*='High Jump']").setAttribute("title", highTooltip);
		}

		// Carrying capacity (uses state method which respects Thelemar homebrew rules)
		const carryCapacity = this._state.getCarryingCapacity();
		const pushDragLift = carryCapacity * 2; // 2x carrying capacity
		const items = this._state.getItems();
		const currentWeight = items.reduce((sum, item) => sum + (item.weight || 0) * item.quantity, 0);

		(/** @type {*} */ (document.getElementById("charsheet-disp-weight"))).textContent = currentWeight.toFixed(1);
		(/** @type {*} */ (document.getElementById("charsheet-disp-carry"))).textContent = carryCapacity;
		(/** @type {*} */ (document.getElementById("charsheet-disp-push"))).textContent = pushDragLift;

		// Update carrying capacity tooltip based on rules
		const useThelemarCarry = (/** @type {*} */ (this._state.getSettings()))?.thelemar_carryWeight;
		if (useThelemarCarry) {
			const mightMod = this._state.getSkillMod("might");
			const carryTooltip = `Carry Capacity (Thelemar): 50 + 25 × Might mod (${mightMod >= 0 ? "+" : ""}${mightMod}) = ${carryCapacity} lb.\nPush/Drag/Lift: ${pushDragLift} lb.`;
			document.querySelector(".charsheet__physical-stat-group--carry").setAttribute("title", carryTooltip);
		} else {
			const strScore = this._state.getAbilityScore("str");
			const carryTooltip = `Carry Capacity: STR (${strScore}) × 15 = ${carryCapacity} lb.\nPush/Drag/Lift: ${pushDragLift} lb.`;
			document.querySelector(".charsheet__physical-stat-group--carry").setAttribute("title", carryTooltip);
		}

		// Update carry bar visualization
		const carryPercent = carryCapacity > 0 ? Math.min(100, (currentWeight / carryCapacity) * 100) : 0;
		const carryFill = document.getElementById("charsheet-carry-bar-fill");
		carryFill.style["width"] = `${carryPercent}%`;

		// Color coding based on encumbrance
		if (carryPercent >= 100) {
			carryFill.style["background"] = "var(--color-danger, #dc3545)"; // Encumbered
		} else if (carryPercent >= 66) {
			carryFill.style["background"] = "var(--color-warning, #ffc107)"; // Heavy load
		} else {
			carryFill.style["background"] = "var(--color-success, #28a745)"; // Light load
		}

		// Render senses
		this._renderSenses();
	}

	_renderSenses () {
		const section = document.getElementById("charsheet-senses-section");
		const container = document.getElementById("charsheet-senses");

		// Get senses from features (like Darkvision)
		const features = this._state.getFeatures();
		const race = this._state.getRace();

		const senses = [];

		// Check for Darkvision in race
		if (race?.darkvision) {
			senses.push({name: "Darkvision", range: `${race.darkvision} ft.`});
		}

		// Check for senses in features
		features.forEach(f => {
			const nameLower = f.name.toLowerCase();
			if (nameLower.includes("darkvision")) {
				// Extract range from description if possible
				const match = f.description?.match(/(\d+)\s*(?:feet|ft)/i);
				if (match && !senses.some(s => s.name === "Darkvision")) {
					senses.push({name: "Darkvision", range: `${match[1]} ft.`});
				}
			} else if (nameLower.includes("blindsight")) {
				const match = f.description?.match(/(\d+)\s*(?:feet|ft)/i);
				senses.push({name: "Blindsight", range: match ? `${match[1]} ft.` : ""});
			} else if (nameLower.includes("tremorsense")) {
				const match = f.description?.match(/(\d+)\s*(?:feet|ft)/i);
				senses.push({name: "Tremorsense", range: match ? `${match[1]} ft.` : ""});
			} else if (nameLower.includes("truesight")) {
				const match = f.description?.match(/(\d+)\s*(?:feet|ft)/i);
				senses.push({name: "Truesight", range: match ? `${match[1]} ft.` : ""});
			}
		});

		if (senses.length === 0) {
			section.style.display = "none";
			return;
		}

		section.style.display = "";
		container.innerHTML = "";

		senses.forEach(sense => {
			container.append(e_({outer: `
				<div class="charsheet__sense-item">
					<span class="charsheet__sense-name">${sense.name}</span>
					<span class="charsheet__sense-range">${sense.range}</span>
				</div>
			`}));
		});
	}

	/**
	 * Update all calculated values and re-render affected UI sections.
	 * Call this after any change that affects character stats (custom abilities, modifiers, etc.)
	 */
	_updateAllCalculations () {
		this._renderAbilities();
		this._renderSavingThrows();
		this._renderSkills();
		this._renderPassiveScores();
		this._renderCombatStats();
		this._renderDefenses();
	}

	/**
	 * Render the defenses section (resistances, immunities, vulnerabilities)
	 * This combines base defenses with those from active states (e.g., Blade Ward, Rage)
	 */
	_renderDefenses () {
		const defenses = this._state.getEffectiveDefenses();

		// Format damage type for display (capitalize, handle "damage:" prefix)
		const formatType = (type) => {
			const clean = type.replace(/^damage:/i, "").trim();
			return clean.charAt(0).toUpperCase() + clean.slice(1);
		};

		// Resistances
		if (defenses.resistances.length > 0) {
			const resistanceText = defenses.resistances.map(formatType).join(", ");
			(/** @type {*} */ (document.getElementById("charsheet-resistances"))).textContent = resistanceText;
		} else {
			(/** @type {*} */ (document.getElementById("charsheet-resistances"))).textContent = "—";
		}

		// Immunities (damage immunities)
		if (defenses.immunities.length > 0) {
			const immunityText = defenses.immunities.map(formatType).join(", ");
			(/** @type {*} */ (document.getElementById("charsheet-immunities"))).textContent = immunityText;
		} else {
			(/** @type {*} */ (document.getElementById("charsheet-immunities"))).textContent = "—";
		}

		// Vulnerabilities
		if (defenses.vulnerabilities.length > 0) {
			const vulnerabilityText = defenses.vulnerabilities.map(formatType).join(", ");
			(/** @type {*} */ (document.getElementById("charsheet-vulnerabilities"))).textContent = vulnerabilityText;
		} else {
			(/** @type {*} */ (document.getElementById("charsheet-vulnerabilities"))).textContent = "—";
		}

		// Condition immunities (if there's a UI element for it)
		const conditionImmunities = document.getElementById("charsheet-condition-immunities");
		if (conditionImmunities) {
			if (defenses.conditionImmunities.length > 0) {
				const conditionText = defenses.conditionImmunities.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(", ");
				conditionImmunities.textContent = conditionText;
			} else {
				conditionImmunities.textContent = "—";
			}
		}
	}

	_renderHitDice () {
		const hitDice = this._state.getHitDiceSummary();
		(/** @type {*} */ (document.getElementById("charsheet-disp-hitdice-current"))).textContent = hitDice.current;
		(/** @type {*} */ (document.getElementById("charsheet-disp-hitdice-max"))).textContent = hitDice.max;
		(/** @type {*} */ (document.getElementById("charsheet-disp-hitdice-type"))).textContent = hitDice.type || "d8";
	}

	_renderDeathSaves () {
		const deathSaves = this._state.getDeathSaves();

		const success = document.querySelectorAll("#charsheet-deathsaves-success input");
		const failure = document.querySelectorAll("#charsheet-deathsaves-failure input");

		[...success].forEach((el, i) => {
			(/** @type {*} */ (el)).checked = i < deathSaves.successes;
		});

		[...failure].forEach((el, i) => {
			(/** @type {*} */ (el)).checked = i < deathSaves.failures;
		});
	}

	_updateDeathSaves () {
		const successes = document.querySelectorAll("#charsheet-deathsaves-success input:checked").length;
		const failures = document.querySelectorAll("#charsheet-deathsaves-failure input:checked").length;
		this._state.setDeathSaves(successes, failures);

		if (successes >= 3) {
			JqueryUtil.doToast({type: "success", content: "Stabilized! Three death save successes."});
		} else if (failures >= 3) {
			JqueryUtil.doToast({type: "danger", content: "Dead. Three death save failures."});
		}
	}

	_renderInspiration () {
		const hasInspiration = this._state.hasInspiration();
		const icon = document.getElementById("charsheet-icon-inspiration");
		const box = document.getElementById("charsheet-box-inspiration");

		// Update emoji-based icon
		icon.textContent = hasInspiration ? "⭐" : "☆";

		// Toggle active class for styling
		box.classList.toggle("active", hasInspiration);

		// Legacy glyphicon support (fallback)
		icon.classList.remove("glyphicon-star", "glyphicon-star-empty");
		if (icon.classList.contains("glyphicon")) {
			icon.classList.add(hasInspiration ? "glyphicon-star" : "glyphicon-star-empty");
		}
	}

	_renderProficiencies () {
		const profs = this._state.getProficiencies();
		const armor = profs.armor.map(a => typeof a === "string" ? a : a.full).join(", ");
		const weapons = profs.weapons.map(w => typeof w === "string" ? w : w.full).join(", ");
		const tools = profs.tools.map(t => typeof t === "string" ? t : t.full).join(", ");

		(/** @type {*} */ (document.getElementById("charsheet-prof-armor"))).innerHTML = `${Renderer.get().render(armor)}` || "—";
		(/** @type {*} */ (document.getElementById("charsheet-prof-weapons"))).innerHTML = `${Renderer.get().render(weapons)}` || "—";
		(/** @type {*} */ (document.getElementById("charsheet-prof-tools"))).innerHTML = `${Renderer.get().render(tools)}` || "—";

		// Languages with hover links - look up correct source from language data
		if (profs.languages?.length) {
			const langHtml = profs.languages.map(lang => {
				try {
					const langLower = lang.toLowerCase();

					// Check if this is a dialect (e.g., Aquan → Primordial)
					const dialectParent = this._dialectParentMap[langLower];
					if (dialectParent) {
						// Link to parent language page, but display the dialect name the user chose
						return CharacterSheetPage.getHoverLink(UrlUtil.PG_LANGUAGES, dialectParent.name, dialectParent.source, null, lang);
					}

					// Look up language in data, preferring XPHB source
					const langData = this._languagesData?.find(l =>
						l.name.toLowerCase() === langLower && l.source === Parser.SRC_XPHB,
					) || this._languagesData?.find(l =>
						l.name.toLowerCase() === langLower,
					);

					// If no data found, render as plain text to avoid broken hover links
					if (!langData) return lang;

					return this.getHoverLink(UrlUtil.PG_LANGUAGES, lang, langData.source);
				} catch (e) {
					return lang;
				}
			}).join(", ");
			(/** @type {*} */ (document.getElementById("charsheet-prof-languages"))).innerHTML = langHtml;
		} else {
			(/** @type {*} */ (document.getElementById("charsheet-prof-languages"))).textContent = "—";
		}

		// Weapon Masteries
		this._renderWeaponMasteries();
	}

	/**
	 * Extract mastery name from item's mastery property
	 * Handles both string format ("Sap|XPHB") and object format ({uid: "Sap|XPHB", note: "..."})
	 */
	_getMasteryName (masteryEntry) {
		if (!masteryEntry) return "";
		if (typeof masteryEntry === "string") {
			return masteryEntry.split("|")[0];
		}
		if (typeof masteryEntry === "object" && masteryEntry.uid) {
			return masteryEntry.uid.split("|")[0];
		}
		return "";
	}

	/**
	 * Render weapon masteries display in combat section
	 */
	_renderWeaponMasteries () {
		const masteries = this._state.getWeaponMasteries();
		const group = document.getElementById("charsheet-masteries-group");
		const container = document.getElementById("charsheet-combat-masteries");

		// Check if character has Weapon Mastery feature
		const maxMasteries = this._getMaxWeaponMasteries();
		const hasWeaponMasteryFeature = maxMasteries > 0;

		if (!hasWeaponMasteryFeature) {
			// Hide if character doesn't have the Weapon Mastery feature
			group.style.display = "none";
			return;
		}

		// Show the section since character has the feature
		group.style.display = "";
		container.innerHTML = "";

		if (masteries?.length) {
			// Render each mastery as a badge with the mastery property
			masteries.forEach(m => {
				const [weaponName, source] = m.split("|");
				// Find the BASE weapon to get its mastery property
				const weapon = this._itemsData?.find(i =>
					i._isBaseItem
					&& i.name.toLowerCase() === weaponName.toLowerCase()
					&& (!source || i.source === source),
				);
				const masteryProp = this._getMasteryName(weapon?.mastery?.[0]);

				const badge = e_({outer: `
					<span class="charsheet__mastery-badge" title="${masteryProp ? `Mastery: ${masteryProp}` : weaponName}">
						<strong>${weaponName}</strong>
						${masteryProp ? `<span class="charsheet__mastery-prop">${masteryProp}</span>` : ""}
					</span>
				`});
				container.append(badge);
			});

			// Show count, highlight if there are unfilled slots
			const hasUnfilled = masteries.length < maxMasteries;
			container.append(e_({outer: `<span class="${hasUnfilled ? "text-warning" : "ve-muted"} ve-small ml-2">(${masteries.length}/${maxMasteries}${hasUnfilled ? " — click ✎ to add more" : ""})</span>`}));
		} else {
			// No masteries selected yet
			container.innerHTML = `<span class="ve-muted">None selected — click ✎ to choose weapons</span>`;
		}
	}

	_renderCurrency () {
		const values = {};
		["cp", "sp", "ep", "gp", "pp"].forEach(currency => {
			values[currency] = this._state.getCurrency(currency) || 0;
			(/** @type {*} */ (document.getElementById(`charsheet-ipt-${currency}`))).value = values[currency];
		});

		// Calculate total value in GP (standard D&D conversion rates)
		// 10 CP = 1 SP, 10 SP = 1 GP, 2 EP = 1 GP, 10 GP = 1 PP
		const totalGp = (values.cp / 100) + (values.sp / 10) + (values.ep / 2) + values.gp + (values.pp * 10);
		const total = document.getElementById("charsheet-currency-total");
		if (totalGp > 0) {
			total.textContent = `≈ ${totalGp.toFixed(1)} GP`;
			total.style.display = "";
		} else {
			total.style.display = "none";
		}
	}

	_convertCurrencyToGold () {
		const cp = this._state.getCurrency("cp") || 0;
		const sp = this._state.getCurrency("sp") || 0;
		const ep = this._state.getCurrency("ep") || 0;
		const gp = this._state.getCurrency("gp") || 0;
		const pp = this._state.getCurrency("pp") || 0;

		// Convert everything to copper first (most precise)
		const totalCopper = cp + (sp * 10) + (ep * 50) + (gp * 100) + (pp * 1000);

		// Convert copper to gold (keeping remainder as copper)
		const newGp = Math.floor(totalCopper / 100);
		const remainingCp = totalCopper % 100;

		// Update values
		this._state.setCurrency("cp", remainingCp);
		this._state.setCurrency("sp", 0);
		this._state.setCurrency("ep", 0);
		this._state.setCurrency("gp", newGp);
		this._state.setCurrency("pp", 0);

		this._saveCurrentCharacter();
		this._renderCurrency();

		JqueryUtil.doToast({type: "success", content: `Converted to ${newGp} GP${remainingCp > 0 ? ` and ${remainingCp} CP` : ""}`});
	}

	_renderNotes () {
		["personality", "ideals", "bonds", "flaws", "backstory", "notes"].forEach(field => {
			(/** @type {*} */ (document.getElementById(`charsheet-txt-${field}`))).value = this._state.getNote(field);
		});
	}

	_renderAppearance () {
		["age", "height", "weight", "eyes", "skin", "hair"].forEach(field => {
			(/** @type {*} */ (document.getElementById(`charsheet-ipt-${field}`))).value = this._state.getAppearance(field);
		});
	}

	/**
	 * Initialize portrait upload handlers for both overview and notes tabs
	 */
	_initPortraitHandlers () {
		const portraitInput = document.getElementById("charsheet-portrait-input");

		// Overview tab portrait - clicking container triggers file input
		document.getElementById("charsheet-portrait-container").addEventListener("click", (e) => {
			if ((/** @type {*} */ (e.target)).closest("#charsheet-portrait-input")) return;
			portraitInput?.click();
		});

		// Prevent input click from bubbling back to the container and recursively retriggering
		portraitInput.addEventListener("click", (e) => e.stopPropagation());

		// File input change handler (overview tab)
		portraitInput.addEventListener("change", (e) => {
			const file = (/** @type {*} */ (e.target)).files?.[0];
			if (file) this._handlePortraitFile(file);
		});

		// Notes tab portrait - clicking triggers same file input
		document.getElementById("charsheet-notes-portrait-container")?.addEventListener("click", () => {
			portraitInput?.click();
		});

		// Remove portrait button
		document.getElementById("charsheet-portrait-remove-btn")?.addEventListener("click", (e) => {
			e.stopPropagation();
			this._removePortrait();
		});
	}

	/**
	 * Handle an uploaded portrait file
	 * @param {File} file - The image file to use as portrait
	 */
	_handlePortraitFile (file) {
		if (!file.type.startsWith("image/")) {
			JqueryUtil.doToast({type: "warning", content: "Please select an image file"});
			return;
		}

		// Limit file size to 2MB to avoid localStorage issues
		if (file.size > 2 * 1024 * 1024) {
			JqueryUtil.doToast({type: "warning", content: "Image is too large (max 2MB)"});
			return;
		}

		const reader = new FileReader();
		reader.onload = (e) => {
			const dataUrl = e.target.result;
			this._state.setAppearance("portraitUrl", dataUrl);
			this._saveCurrentCharacter();
			this._renderPortrait();
			JqueryUtil.doToast({type: "success", content: "Portrait updated!"});
		};
		reader.onerror = () => {
			JqueryUtil.doToast({type: "danger", content: "Failed to read image file"});
		};
		reader.readAsDataURL(file);
	}

	/**
	 * Remove the current portrait
	 */
	_removePortrait () {
		this._state.setAppearance("portraitUrl", "");
		this._saveCurrentCharacter();
		this._renderPortrait();
		JqueryUtil.doToast({type: "info", content: "Portrait removed"});
	}

	/**
	 * Render the character portrait in both overview and notes tabs
	 */
	_renderPortrait () {
		const portraitUrl = this._state.getAppearance("portraitUrl");
		const hasPortrait = !!portraitUrl;

		// Overview tab portrait
		const overviewPlaceholder = document.getElementById("charsheet-portrait-placeholder");
		const overviewImage = document.getElementById("charsheet-portrait-image");

		if (hasPortrait) {
			overviewPlaceholder.classList.add("ve-hidden");
			overviewImage.setAttribute("src", portraitUrl);
			overviewImage.classList.remove("ve-hidden");
		} else {
			overviewPlaceholder.classList.remove("ve-hidden");
			overviewImage.classList.add("ve-hidden");
			overviewImage.setAttribute("src", "");
		}

		// Notes tab portrait
		const notesPlaceholder = document.getElementById("charsheet-notes-portrait-placeholder");
		const notesImage = document.getElementById("charsheet-notes-portrait-image");

		if (hasPortrait) {
			notesPlaceholder.classList.add("ve-hidden");
			notesImage.setAttribute("src", portraitUrl);
			notesImage.classList.remove("ve-hidden");
		} else {
			notesPlaceholder.classList.remove("ve-hidden");
			notesImage.classList.add("ve-hidden");
			notesImage.setAttribute("src", "");
		}

		// Remove button visibility
		document.getElementById("charsheet-portrait-remove-btn")?.classList.toggle("ve-hidden", !hasPortrait);
	}

	/**
	 * Render visual indicators for active modifiers
	 * Updates the button badge and adds visual cues to affected stats
	 */
	_renderModifierIndicators () {
		const modifiers = this._state.getNamedModifiers();
		const activeModifiers = modifiers.filter(m => m.enabled);
		const activeCount = activeModifiers.length;

		// Update button badge
		const btn = document.getElementById("charsheet-btn-modifiers");
		btn?.querySelector(".charsheet__modifier-badge")?.remove();

		if (activeCount > 0) {
			btn.append(e_({outer: `<span class="charsheet__modifier-badge">${activeCount}</span>`}));
			btn.classList.add("charsheet__btn--has-modifiers");
		} else {
			btn.classList.remove("charsheet__btn--has-modifiers");
		}

		// Add/remove indicator classes on affected stat displays
		const acMod = this._state.getCustomModifier("ac");
		const initMod = this._state.getCustomModifier("initiative");
		const speedMod = this._state.getCustomModifier("speed");
		const attackMod = this._state.getCustomModifier("attack");
		const damageMod = this._state.getCustomModifier("damage");

		// AC indicator
		const acBox = document.getElementById("charsheet-box-ac");
		acBox.classList.remove("charsheet__combat-stat--modified-positive", "charsheet__combat-stat--modified-negative");
		if (acMod !== 0) {
			acBox.classList.add(acMod > 0 ? "charsheet__combat-stat--modified-positive" : "charsheet__combat-stat--modified-negative");
		}
		acBox.setAttribute("title", acMod !== 0 ? `AC modified by ${acMod >= 0 ? "+" : ""}${acMod}` : "Armor Class");

		// Initiative indicator
		const initBox = document.getElementById("charsheet-box-initiative");
		initBox.classList.remove("charsheet__combat-stat--modified-positive", "charsheet__combat-stat--modified-negative");
		if (initMod !== 0) {
			initBox.classList.add(initMod > 0 ? "charsheet__combat-stat--modified-positive" : "charsheet__combat-stat--modified-negative");
		}
		initBox.setAttribute("title", initMod !== 0 ? `Initiative modified by ${initMod >= 0 ? "+" : ""}${initMod}` : "Click to roll Initiative (Shift=Adv, Ctrl=Dis)");

		// Speed indicator
		const speedBox = document.getElementById("charsheet-box-speed");
		if (speedBox) {
			speedBox.classList.remove("charsheet__combat-stat--modified-positive", "charsheet__combat-stat--modified-negative");
			if (speedMod !== 0) {
				speedBox.classList.add(speedMod > 0 ? "charsheet__combat-stat--modified-positive" : "charsheet__combat-stat--modified-negative");
			}
			speedBox.setAttribute("title", speedMod !== 0 ? `Speed modified by ${speedMod >= 0 ? "+" : ""}${speedMod} ft.` : "Speed");
		}

		// Also update save rows if they have modifiers
		Parser.ABIL_ABVS.forEach(abl => {
			const saveMod = this._state.getCustomModifier(`save:${abl}`);
			const row = document.querySelector(`.charsheet__save-row[data-save="${abl}"]`);
			row?.classList.remove("charsheet__save-row--modified-positive", "charsheet__save-row--modified-negative");
			if (saveMod !== 0) {
				row?.classList.add(saveMod > 0 ? "charsheet__save-row--modified-positive" : "charsheet__save-row--modified-negative");
			}
		});

		// Update skill rows if they have modifiers
		const skills = this.getSkillsList();
		skills.forEach(skill => {
			const skillKey = skill.name.toLowerCase().replace(/\s+/g, "");
			const skillMod = this._state.getSkillCustomMod(skillKey);
			const row = document.querySelector(`.charsheet__skill-row[data-skill="${skillKey}"]`);
			row?.classList.remove("charsheet__skill-row--modified-positive", "charsheet__skill-row--modified-negative");
			if (skillMod !== 0) {
				row?.classList.add(skillMod > 0 ? "charsheet__skill-row--modified-positive" : "charsheet__skill-row--modified-negative");
			}
		});
	}

	_renderConditions () {
		const container = document.getElementById("charsheet-conditions");
		container.innerHTML = "";

		// Now returns {name, source} objects
		const conditions = this._state.getConditions();
		conditions.forEach(condObj => {
			const conditionName = condObj.name;
			const conditionSource = condObj.source;

			// Get condition effects for tooltip
			const condDef = CharacterSheetState.getConditionEffects(conditionName);
			const icon = condDef?.icon || "❓";
			const description = condDef?.description || "Unknown condition";

			// Build effect list for tooltip
			let effectsHtml = "";
			if (condDef?.effects?.length) {
				const effectList = condDef.effects.map(e => {
					if (e.type === "advantage") return `• Advantage on ${e.target}`;
					if (e.type === "disadvantage") return `• Disadvantage on ${e.target}`;
					if (e.type === "autoFail") return `• Auto-fail ${e.target}`;
					if (e.type === "setSpeed") return `• Speed set to ${e.value}`;
					if (e.type === "resistance") return `• Resistance to ${e.target}`;
					if (e.type === "bonus") return `• ${e.value >= 0 ? "+" : ""}${e.value} to ${e.target}`;
					if (e.type === "note") return `• ${e.value}`;
					return null;
				}).filter(Boolean);
				if (effectList) {
					effectsHtml = `<div class="mt-1 ve-small">${effectList.join("<br>")}</div>`;
				}
			}

			// Use instance method for proper homebrew source lookup
			const conditionLink = this.getConditionLinkWithSource(conditionName, conditionSource);
			const sourceAbbr = Parser.sourceJsonToAbv(conditionSource);

			const badge = e_({outer: `
				<span class="charsheet__condition-badge" title="${description}">
					<span class="charsheet__condition-icon">${icon}</span>
					${conditionLink}
					<span class="charsheet__condition-source-badge">${sourceAbbr}</span>
					<span class="charsheet__condition-remove glyphicon glyphicon-remove"></span>
				</span>
			`});

			// Add tooltip with effects
			if (effectsHtml) {
				badge.setAttribute("data-tippy-content", `<strong>${condDef?.name || conditionName}</strong> (${sourceAbbr}): ${description}${effectsHtml}`);
			}

			badge.querySelector(".charsheet__condition-remove").addEventListener("click", () => {
				// Now passes {name, source} object
				this._state.removeCondition({name: conditionName, source: conditionSource});
				this._saveCurrentCharacter();
				this._renderConditions();
				this._renderActiveStates(); // Also update active states since conditions create states
				this._renderCharacter(); // Re-render to apply effects
				// Sync combat tab
				this._combat?.renderCombatConditions?.();
				this._combat?.renderCombatEffects?.();
				this._combat?.renderCombatDefenses?.();
			});

			container.append(badge);
		});
	}

	_renderExhaustion () {
		const exhaustion = this._state.getExhaustion();
		const rules = this._state.getExhaustionRules();
		const maxExhaustion = this._state.getMaxExhaustion();

		// Update the number display
		const number = document.getElementById("charsheet-exhaustion-number");
		const maxDisplay = document.getElementById("charsheet-exhaustion-max");
		const effect = document.getElementById("charsheet-exhaustion-effect");
		const rulesToggle = document.getElementById("charsheet-exhaustion-rules");
		const pipsContainer = document.getElementById("charsheet-exhaustion-display");

		// Update max display
		maxDisplay.textContent = `/ ${maxExhaustion}`;

		// Dynamically generate pips based on rules
		pipsContainer.innerHTML = "";
		for (let i = 1; i <= maxExhaustion; i++) {
			let tooltip;
			if (rules === "thelemar") {
				tooltip = i === 10 ? "Level 10: DEATH" : `Level ${i}: -${i} to all rolls and DCs`;
			} else if (rules === "2024") {
				const effects = [
					"Level 1: -2 to d20 Tests, -5 ft. speed",
					"Level 2: -4 to d20 Tests, -10 ft. speed",
					"Level 3: -6 to d20 Tests, -15 ft. speed",
					"Level 4: -8 to d20 Tests, -20 ft. speed",
					"Level 5: -10 to d20 Tests, -25 ft. speed",
					"Level 6: DEATH",
				];
				tooltip = effects[i - 1] || `Level ${i}`;
			} else {
				const effects = [
					"Level 1: Disadvantage on ability checks",
					"Level 2: Speed halved",
					"Level 3: Disadvantage on attack rolls and saves",
					"Level 4: HP maximum halved",
					"Level 5: Speed reduced to 0",
					"Level 6: DEATH",
				];
				tooltip = effects[i - 1] || `Level ${i}`;
			}
			const isDeath = i === maxExhaustion;
			const isActive = i <= exhaustion;
			const pip = e_({outer: `<div class="charsheet__exhaustion-pip ${isDeath ? "charsheet__exhaustion-pip--death" : ""} ${isActive ? "active" : ""}" data-level="${i}" title="${tooltip}"></div>`});
			pipsContainer.append(pip);
		}

		// Update number display
		number.textContent = String(exhaustion);

		// Update color class based on level
		number.classList.remove("exhaustion-0", "exhaustion-1", "exhaustion-2", "exhaustion-3", "exhaustion-4", "exhaustion-5", "exhaustion-6", "exhaustion-max");
		if (exhaustion >= maxExhaustion) {
			number.classList.add("exhaustion-max", "exhaustion-6");
		} else if (rules === "thelemar") {
			// For Thelemar, map 0-10 to color classes
			const colorLevel = Math.min(6, Math.floor(exhaustion * 6 / 10));
			number.classList.add(`exhaustion-${colorLevel}`);
		} else {
			number.classList.add(`exhaustion-${exhaustion}`);
		}

		// 2024 rules: -2 per level to d20 Tests, -5 ft speed per level
		const effects2024 = [
			"No exhaustion",
			"-2 to d20 Tests, -5 ft. speed",
			"-4 to d20 Tests, -10 ft. speed",
			"-6 to d20 Tests, -15 ft. speed",
			"-8 to d20 Tests, -20 ft. speed",
			"-10 to d20 Tests, -25 ft. speed",
			"Death",
		];

		// 2014 rules: cumulative effects
		const effects2014 = [
			"No exhaustion",
			"Disadvantage on ability checks",
			"Speed halved",
			"Disadvantage on attack rolls and saves",
			"HP maximum halved",
			"Speed reduced to 0",
			"Death",
		];

		// Thelemar rules: -1 per level to all rolls and DCs, death at 10
		let effectText;
		if (rules === "thelemar") {
			if (exhaustion === 0) {
				effectText = "No exhaustion";
			} else if (exhaustion >= 10) {
				effectText = "Death";
			} else {
				effectText = `-${exhaustion} to all rolls and DCs`;
			}
		} else {
			const effects = rules === "2024" ? effects2024 : effects2014;
			effectText = effects[exhaustion] || effects[effects.length - 1];
		}
		effect.innerHTML = effectText;

		// Show which rules are being used (non-editable - change in Settings)
		if (rulesToggle) {
			const rulesLabel = rules === "thelemar" ? "Thelemar" : rules === "2014" ? "2014" : "2024";
			rulesToggle.innerHTML = `<span class="ve-muted ve-small" title="Change exhaustion rules in Settings">Using ${rulesLabel} rules</span>`;
		}
	}

	_addExhaustion () {
		const current = this._state.getExhaustion();
		const max = this._state.getMaxExhaustion();
		if (current >= max) {
			JqueryUtil.doToast({type: "warning", content: `Maximum exhaustion (${max}) reached!`});
			return;
		}
		this._state.addExhaustion();
		this._saveCurrentCharacter();
		this._renderExhaustion();
		this._renderCombatStats();
		// Re-render spells to update DC (Thelemar rules)
		if (this._spellsModule && this._state.getExhaustionRules() === "thelemar") {
			this._spellsModule.render();
		}
	}

	_removeExhaustion () {
		const current = this._state.getExhaustion();
		if (current <= 0) {
			JqueryUtil.doToast({type: "info", content: "No exhaustion to remove."});
			return;
		}
		this._state.removeExhaustion();
		this._saveCurrentCharacter();
		this._renderExhaustion();
		this._renderCombatStats();
		// Re-render spells to update DC (Thelemar rules)
		if (this._spellsModule && this._state.getExhaustionRules() === "thelemar") {
			this._spellsModule.render();
		}
	}

	_renderCompanions () {
		const list = document.getElementById("charsheet-companions-list");
		if (!list) return;

		// Render dynamic summon buttons based on character features
		this._renderCompanionButtons();

		list.innerHTML = "";

		const companions = this._state.getActiveCompanions?.() || [];

		// Also render the overview indicator
		this._renderCompanionsOverviewIndicator();

		if (companions.length === 0) {
			list.innerHTML = `
				<div class="charsheet__companions-empty" style="text-align: center; padding: 40px 20px;">
					<div style="font-size: 3em; margin-bottom: 12px; opacity: 0.5;">🦉</div>
					<div class="ve-muted" style="font-size: 1.1em; margin-bottom: 8px;">No active companions</div>
					<div class="ve-muted ve-small">Cast <em>Find Familiar</em> or click the button above to summon one.</div>
				</div>
			`;
			return;
		}

		companions.forEach(companion => {
			// Check if this is a grouped companion (conjured creatures)
			if (companion.count > 1 && companion.hpArray) {
				this._renderGroupedCompanion(companion, list);
				return;
			}

			const hp = companion.hp || {current: 1, max: 1};
			const hpPercent = Math.round((hp.current / hp.max) * 100);
			const hpColor = hpPercent > 50 ? "#22c55e" : hpPercent > 25 ? "#f59e0b" : "#ef4444";
			const hpBgColor = hpPercent > 50 ? "rgba(34, 197, 94, 0.15)" : hpPercent > 25 ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)";

			// Format speeds
			const speeds = [];
			if (companion.speed?.walk) speeds.push(`${companion.speed.walk} ft.`);
			if (companion.speed?.fly) speeds.push(`fly ${companion.speed.fly} ft.`);
			if (companion.speed?.swim) speeds.push(`swim ${companion.speed.swim} ft.`);
			if (companion.speed?.climb) speeds.push(`climb ${companion.speed.climb} ft.`);
			const speedStr = speeds.length > 0 ? speeds.join(", ") : "—";

			// Format senses
			const sensesStr = companion.senses?.join(", ") || "—";

			// Get companion type label and icon
			const typeInfo = {
				familiar: {label: "Familiar", icon: "🦉", color: "#8b5cf6"},
				beast_companion: {label: "Beast Companion", icon: "🐺", color: "#22c55e"},
				steel_defender: {label: "Steel Defender", icon: "🤖", color: "#64748b"},
				drake: {label: "Drake", icon: "🐉", color: "#f59e0b"},
				summon: {label: "Summon", icon: "✨", color: "#3b82f6"},
				mount: {label: "Mount", icon: "🐴", color: "#a855f7"},
				wild_shape: {label: "Wild Shape", icon: "🌿", color: "#10b981"},
				custom: {label: "Companion", icon: "🐾", color: "#6b7280"},
			};
			const info = typeInfo[companion.type] || typeInfo.custom;

			// Get companion icon (token image with emoji fallback)
			const companionIconHtml = CharacterSheetClassUtils.getCompanionIconHtml(companion, "lg");

			// Build hoverable name link for the creature
			let nameDisplay;
			if (companion.source) {
				try {
					const hash = UrlUtil.encodeForHash([companion.name, companion.source].join(HASH_LIST_SEP));
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BESTIARY, source: companion.source, hash});
					nameDisplay = `<a href="${UrlUtil.PG_BESTIARY}#${hash}" ${hoverAttrs} style="font-size: 1.25em; font-weight: bold;">${companion.customName || companion.name}</a>`;
				} catch (e) {
					nameDisplay = `<span style="font-size: 1.25em; font-weight: bold;">${companion.customName || companion.name}</span>`;
				}
			} else {
				nameDisplay = `<span style="font-size: 1.25em; font-weight: bold;">${companion.customName || companion.name}</span>`;
			}

			// Get companion conditions
			const conditions = this._state.getCompanionConditions?.(companion.id) || [];
			const conditionsHtml = conditions.map(c => {
				const condName = typeof c === "string" ? c : c.name;
				const condDef = CharacterSheetState.getConditionEffects(condName);
				const icon = condDef?.icon || "⚠️";
				return `<span class="charsheet__companion-condition-badge" data-condition="${condName}" style="
					display: inline-flex; align-items: center; gap: 4px;
					padding: 2px 8px; background: rgba(239, 68, 68, 0.15);
					border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px;
					font-size: 0.8em; cursor: pointer;
				" title="Click to remove">${icon} ${condName}<span style="margin-left: 4px; opacity: 0.7;">×</span></span>`;
			}).join(" ");

			// Get skill modifiers for quick checks
			const perceptionMod = this._state.getCompanionSkillMod?.(companion.id, "perception") || 0;
			const stealthMod = this._state.getCompanionSkillMod?.(companion.id, "stealth") || 0;
			const investigationMod = this._state.getCompanionSkillMod?.(companion.id, "investigation") || 0;
			const perceptionStr = perceptionMod >= 0 ? `+${perceptionMod}` : `${perceptionMod}`;
			const stealthStr = stealthMod >= 0 ? `+${stealthMod}` : `${stealthMod}`;
			const investigationStr = investigationMod >= 0 ? `+${investigationMod}` : `${investigationMod}`;

			// Check action economy state
			const usedAction = companion.usedAction || false;
			const usedReaction = companion.usedReaction || false;

			// Get all attack actions from the companion's stat block
			const attackActions = companion.actions?.filter(a =>
				a.entries?.some(e => typeof e === "string" && /\{@atk/.test(e)),
			) || [];

			// Build attack buttons HTML for all attacks
			const attackButtonsHtml = attackActions.map(action => {
				const entry = action.entries?.find(e => typeof e === "string") || "";
				const hitMatch = entry.match(/\{@hit\s*(-?\d+)\}/);
				const attackBonus = hitMatch ? parseInt(hitMatch[1]) : 0;
				const bonusStr = attackBonus >= 0 ? `+${attackBonus}` : `${attackBonus}`;
				return `<button class="ve-btn ve-btn-xs ve-btn-danger btn-companion-attack-roll" data-action-name="${action.name.replace(/"/g, "&quot;")}" title="Roll ${action.name}" ${usedAction ? "disabled style=\"opacity: 0.5;\"" : ""}>
					⚔️ ${action.name} (${bonusStr})
				</button>`;
			}).join("");

			const card = e_({outer: `
				<div class="charsheet__companion-card" data-companion-id="${companion.id}" style="
					border: 2px solid ${info.color}33;
					border-radius: 12px;
					padding: 16px;
					margin-bottom: 12px;
					background: linear-gradient(135deg, ${info.color}08, transparent);
					position: relative;
					overflow: hidden;
				">
					<!-- Type badge -->
					<div style="
						position: absolute;
						top: 0;
						right: 0;
						background: ${info.color}22;
						color: ${info.color};
						padding: 4px 12px 4px 16px;
						font-size: 0.75em;
						font-weight: 600;
						border-bottom-left-radius: 12px;
					">${info.icon} ${info.label}</div>

					<!-- Header -->
					<div class="ve-flex ve-flex-v-center mb-3" style="gap: 12px;">
						${companionIconHtml}
						<div class="ve-flex-col" style="flex: 1;">
							${nameDisplay}
							<div class="ve-muted ve-small">from ${companion.origin || "Unknown origin"}</div>
						</div>
					</div>

					<!-- Stats Grid -->
					<div style="
						display: grid;
						grid-template-columns: repeat(4, 1fr);
						gap: 12px;
						margin-bottom: 12px;
						padding: 12px;
						background: rgba(var(--rgb-bg-text), 0.03);
						border-radius: 8px;
					">
						<div class="ve-flex-col ve-text-center">
							<div class="ve-muted ve-small" style="margin-bottom: 2px;">HP</div>
							<div class="ve-flex ve-flex-v-center ve-flex-h-center" style="gap: 6px;">
								<span class="bold" style="font-size: 1.1em; color: ${hpColor};">${hp.current}/${hp.max}</span>
							</div>
							<div style="
								width: 100%;
								height: 4px;
								background: rgba(var(--rgb-bg-text), 0.1);
								border-radius: 2px;
								overflow: hidden;
								margin-top: 4px;
							">
								<div style="width: ${hpPercent}%; height: 100%; background: ${hpColor}; transition: width 0.3s;"></div>
							</div>
						</div>
						<div class="ve-flex-col ve-text-center">
							<div class="ve-muted ve-small" style="margin-bottom: 2px;">AC</div>
							<div class="bold" style="font-size: 1.1em;">🛡️ ${companion.ac || "—"}</div>
						</div>
						<div class="ve-flex-col ve-text-center">
							<div class="ve-muted ve-small" style="margin-bottom: 2px;">Speed</div>
							<div style="font-size: 0.9em;">👟 ${speedStr}</div>
						</div>
						<div class="ve-flex-col ve-text-center">
							<div class="ve-muted ve-small" style="margin-bottom: 2px;">Passive</div>
							<div style="font-size: 0.9em;">👁️ ${companion.passive || "—"}</div>
						</div>
					</div>

					<!-- Senses -->
					<div class="ve-muted ve-small mb-2" style="padding: 0 4px;">
						<strong>Senses:</strong> ${sensesStr}
					</div>

					<!-- Conditions -->
					<div class="charsheet__companion-conditions mb-2" style="padding: 0 4px; min-height: 28px;">
						${conditionsHtml}
						<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-add-condition" style="font-size: 0.75em; padding: 2px 8px; opacity: 0.8;">
							➕ Condition
						</button>
					</div>

					<!-- Quick Skill Checks -->
					<div class="ve-flex mb-2" style="gap: 8px;">
						<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-skill" data-skill="perception" style="flex: 1;" title="Roll Perception check">
							👁️ Perception (${perceptionStr})
						</button>
						<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-skill" data-skill="stealth" style="flex: 1;" title="Roll Stealth check">
							🤫 Stealth (${stealthStr})
						</button>
						<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-skill" data-skill="investigation" style="flex: 1;" title="Roll Investigation check">
							🔍 Investigation (${investigationStr})
						</button>
					</div>

					<!-- Familiar Actions -->
					<div class="charsheet__companion-actions mb-3" style="padding: 0 4px;">
						<div class="ve-muted ve-small mb-1" style="display: flex; align-items: center; gap: 8px;">
							<span><strong>Actions:</strong></span>
							<span class="charsheet__companion-action-status" style="font-size: 0.9em; color: ${usedAction ? "#f59e0b" : "#22c55e"}">
								${usedAction ? "⏳ Used" : "✅ Available"}
							</span>
							<span class="ve-muted">|</span>
							<span><strong>Reaction:</strong></span>
							<span class="charsheet__companion-reaction-status" style="font-size: 0.9em; color: ${usedReaction ? "#f59e0b" : "#22c55e"}">
								${usedReaction ? "⏳ Used" : "✅ Available"}
							</span>
						</div>
						<div class="ve-flex" style="gap: 6px; flex-wrap: wrap;">
							<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-action" data-action="help" title="Give an ally advantage on their next attack or ability check" ${usedAction ? "disabled style=\"opacity: 0.5;\"" : ""}>
								🤝 Help
							</button>
							<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-action" data-action="dash" title="Double your speed for this turn" ${usedAction ? "disabled style=\"opacity: 0.5;\"" : ""}>
								💨 Dash
							</button>
							<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-action" data-action="disengage" title="Your movement doesn't provoke opportunity attacks" ${usedAction ? "disabled style=\"opacity: 0.5;\"" : ""}>
								🏃 Disengage
							</button>
							<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-action" data-action="dodge" title="Attacks against you have disadvantage; DEX saves have advantage" ${usedAction ? "disabled style=\"opacity: 0.5;\"" : ""}>
								🛡️ Dodge
							</button>
							<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-action" data-action="hide" title="Make a Stealth check to become hidden" ${usedAction ? "disabled style=\"opacity: 0.5;\"" : ""}>
								🫥 Hide
							</button>
							<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-action" data-action="search" title="Make a Perception or Investigation check to find something" ${usedAction ? "disabled style=\"opacity: 0.5;\"" : ""}>
								🔎 Search
							</button>
						</div>
						${attackButtonsHtml ? `
						<div class="ve-flex mt-2" style="gap: 6px; flex-wrap: wrap;">
							${attackButtonsHtml}
						</div>
						` : ""}
					</div>

					<!-- Action Buttons -->
					<div class="ve-flex" style="gap: 8px; flex-wrap: wrap;">
						<button class="ve-btn ve-btn-xs ve-btn-success btn-companion-heal" style="flex: 1; min-width: 80px;">
							<span class="glyphicon glyphicon-heart"></span> Heal
						</button>
						<button class="ve-btn ve-btn-xs ve-btn-danger btn-companion-damage" style="flex: 1; min-width: 80px;">
							<span class="glyphicon glyphicon-flash"></span> Damage
						</button>
						<button class="ve-btn ve-btn-xs ${this._state.getCompanionNote?.(companion.id) ? "ve-btn-warning" : "ve-btn-default"} btn-companion-note" title="${this._state.getCompanionNote?.(companion.id) ? "Edit Note" : "Add Note"}">
							<span class="glyphicon glyphicon-comment"></span>
						</button>
						<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-edit" title="Edit companion name">
							<span class="glyphicon glyphicon-pencil"></span>
						</button>
						<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-view" title="View full stat block">
							<span class="glyphicon glyphicon-list-alt"></span>
						</button>
						<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-dismiss" title="Dismiss companion" style="color: #ef4444;">
							<span class="glyphicon glyphicon-remove"></span>
						</button>
					</div>
				</div>
			`});

			// Dismiss button
			card.querySelector(".btn-companion-dismiss").addEventListener("click", async () => {
				const confirmed = await InputUiUtil.pGetUserBoolean({
					title: "Dismiss Companion?",
					htmlDescription: `Are you sure you want to dismiss <strong>${companion.customName || companion.name}</strong>?`,
					textYes: "Dismiss",
					textNo: "Cancel",
				});
				if (!confirmed) return;

				this._state.removeCompanion?.(companion.id);
				this._saveCurrentCharacter();
				this._renderCompanions();
				JqueryUtil.doToast({type: "info", content: `${companion.name} has been dismissed.`});
			});

			// View stat block button
			card.querySelector(".btn-companion-view").addEventListener("click", () => {
				this._showCompanionStatBlock(companion);
			});

			// Heal button
			card.querySelector(".btn-companion-heal").addEventListener("click", async () => {
				const healing = await InputUiUtil.pGetUserNumber({
					title: `Heal ${companion.name}`,
					min: 1,
					int: true,
				});
				if (healing == null) return;

				const newHp = Math.min(hp.max, hp.current + healing);
				this._state.setCompanionHp?.(companion.id, newHp);
				this._saveCurrentCharacter();
				this._renderCompanions();
			});

			// Damage button
			card.querySelector(".btn-companion-damage").addEventListener("click", async () => {
				const damage = await InputUiUtil.pGetUserNumber({
					title: `Damage ${companion.name}`,
					min: 1,
					int: true,
				});
				if (damage == null) return;

				const newHp = Math.max(0, hp.current - damage);
				this._state.setCompanionHp?.(companion.id, newHp);
				this._saveCurrentCharacter();
				this._renderCompanions();

				if (newHp === 0) {
					JqueryUtil.doToast({type: "warning", content: `${companion.name} has been reduced to 0 HP!`});
				}
			});

			// Add condition button
			card.querySelector(".btn-companion-add-condition").addEventListener("click", () => {
				this._onAddCompanionCondition(companion);
			});

			// Remove condition badges
			card.querySelectorAll(".charsheet__companion-condition-badge").forEach(el => el.addEventListener("click", (evt) => {
				const condName = evt.currentTarget.dataset.condition;
				this._state.removeCompanionCondition?.(companion.id, condName);
				this._saveCurrentCharacter();
				this._renderCompanions();
				JqueryUtil.doToast({type: "info", content: `Removed ${condName} from ${companion.name}`});
			}));

			// Skill check buttons
			card.querySelectorAll(".btn-companion-skill").forEach(el => el.addEventListener("click", (evt) => {
				const skill = evt.currentTarget.dataset.skill;
				this._rollCompanionSkillCheck(companion, skill);
			}));

			// Edit name button
			card.querySelector(".btn-companion-edit").addEventListener("click", () => {
				this._onEditCompanionName(companion);
			});

			// Note button
			const companionRenderFn = () => this._renderCompanions();
			card.querySelector(".btn-companion-note").addEventListener("click", () => {
				this.getNotes()?.showNoteModal(
					"companion",
					companion.id,
					companion.customName || companion.name,
					companionRenderFn,
				);
			});

			// Action buttons
			card.querySelectorAll(".btn-companion-action").forEach(el => el.addEventListener("click", (evt) => {
				const action = evt.currentTarget.dataset.action;
				this._useCompanionAction(companion, action);
			}));

			// Attack roll buttons
			card.querySelectorAll(".btn-companion-attack-roll").forEach(el => el.addEventListener("click", async (evt) => {
				const actionName = evt.currentTarget.dataset.actionName;
				await this._rollCompanionAttack(companion, actionName);
			}));

			list.append(card);
		});
	}

	_renderCompanionsOverviewIndicator () {
		const container = document.getElementById("charsheet-companions-indicator");
		const section = document.getElementById("charsheet-companions-section");
		if (!container || !section) return;

		const companions = this._state.getActiveCompanions?.() || [];

		if (companions.length === 0) {
			container.style.display = "none";
			section.style.display = "none";
			return;
		}

		container.innerHTML = "";
		container.style.display = "";
		section.style.display = "";

		companions.forEach(companion => {
			const hp = companion.hp || {current: 1, max: 1};
			const hpPercent = Math.round((hp.current / hp.max) * 100);
			const hpColor = hpPercent > 50 ? "#22c55e" : hpPercent > 25 ? "#f59e0b" : "#ef4444";

			// Get companion icon (token image with emoji fallback)
			const companionIconHtml = CharacterSheetClassUtils.getCompanionIconHtml(companion, "sm");

			// Build hoverable name
			let nameHtml;
			if (companion.source) {
				try {
					const hash = UrlUtil.encodeForHash([companion.name, companion.source].join(HASH_LIST_SEP));
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BESTIARY, source: companion.source, hash});
					nameHtml = `<a href="${UrlUtil.PG_BESTIARY}#${hash}" ${hoverAttrs}>${companion.customName || companion.name}</a>`;
				} catch (e) {
					nameHtml = companion.customName || companion.name;
				}
			} else {
				nameHtml = companion.customName || companion.name;
			}

			const badge = e_({outer: `
				<div class="charsheet__companion-badge" style="
					display: inline-flex;
					align-items: center;
					gap: 8px;
					padding: 6px 12px;
					background: rgba(139, 92, 246, 0.1);
					border: 1px solid rgba(139, 92, 246, 0.3);
					border-radius: 20px;
					margin-right: 8px;
					margin-bottom: 4px;
				">
					${companionIconHtml}
					<span class="bold">${nameHtml}</span>
					<span style="
						display: inline-flex;
						align-items: center;
						gap: 4px;
						padding: 2px 8px;
						background: ${hpColor}22;
						border-radius: 10px;
						font-size: 0.85em;
						color: ${hpColor};
						font-weight: 600;
					">❤️ ${hp.current}/${hp.max}</span>
				</div>
			`});

			container.append(badge);
		});
	}

	async _showCompanionStatBlock (companion) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `📋 ${companion.customName || companion.name}`,
			isMinHeight0: true,
			isWidth100: true,
		});

		// Format abilities with clickable saves
		const abilities = companion.abilities || {};
		const abilityRow = Parser.ABIL_ABVS.map(abl => {
			const score = abilities[abl] || 10;
			const mod = Math.floor((score - 10) / 2);
			const modStr = mod >= 0 ? `+${mod}` : mod;
			const hasSaveProf = companion.saveProficiencies?.includes(abl);
			const saveMod = hasSaveProf ? mod + (companion.profBonus || 2) : mod;
			const saveStr = saveMod >= 0 ? `+${saveMod}` : saveMod;
			return `<div class="ve-text-center" style="flex: 1;">
				<div class="ve-muted ve-small">${abl.toUpperCase()}</div>
				<div class="bold">${score}</div>
				<div class="ve-muted">(${modStr})</div>
				<div class="ve-small clickable btn-companion-save" data-ability="${abl}" data-mod="${saveMod}" title="Click to roll ${abl.toUpperCase()} save" style="cursor: pointer; color: var(--rgb-link);">
					${hasSaveProf ? "★" : ""} Save ${saveStr}
				</div>
			</div>`;
		}).join("");

		// Format traits with proper rendering
		const traitsHtml = companion.traits?.length
			? companion.traits.map(t => {
				let text;
				try {
					text = t.entries ? Renderer.get().render({entries: t.entries}) : (t.text || "");
				} catch (e) {
					text = t.entries?.join(" ") || t.text || "";
				}
				return `<div class="mb-2"><strong>${t.name}.</strong> ${text}</div>`;
			}).join("")
			: "<div class='ve-muted'>None</div>";

		// Format actions with proper rendering and roll buttons
		const actionsHtml = companion.actions?.length
			? companion.actions.map(a => {
				let text;
				try {
					text = a.entries ? Renderer.get().render({entries: a.entries}) : (a.text || "");
				} catch (e) {
					text = a.entries?.join(" ") || a.text || "";
				}

				// Check if this is an attack action
				const entry = a.entries?.find(e => typeof e === "string") || "";
				const isAttack = /\{@atk/.test(entry);
				const hitMatch = entry.match(/\{@hit\s*(-?\d+)\}/);
				const attackBonus = hitMatch ? parseInt(hitMatch[1]) : 0;
				const bonusStr = attackBonus >= 0 ? `+${attackBonus}` : `${attackBonus}`;

				// Parse damage for display
				const damageMatches = [...entry.matchAll(/\{@damage\s+([^}]+)\}/g)];
				const hasDamage = damageMatches.length > 0;

				const rollButton = isAttack ? `
					<div class="ve-flex mt-1" style="gap: 6px;">
						<button class="ve-btn ve-btn-xs ve-btn-danger btn-statblock-attack" data-action-name="${a.name.replace(/"/g, "&quot;")}" title="Roll attack">
							⚔️ Attack (${bonusStr})
						</button>
						${hasDamage ? `<button class="ve-btn ve-btn-xs ve-btn-warning btn-statblock-damage" data-action-name="${a.name.replace(/"/g, "&quot;")}" title="Roll damage only">
							💥 Damage
						</button>` : ""}
					</div>
				` : "";

				return `<div class="mb-2"><strong>${a.name}.</strong> ${text}${rollButton}</div>`;
			}).join("")
			: "<div class='ve-muted'>None</div>";

		// Format reactions if any
		const reactionsHtml = companion.reactions?.length
			? companion.reactions.map(r => {
				let text;
				try {
					text = r.entries ? Renderer.get().render({entries: r.entries}) : (r.text || "");
				} catch (e) {
					text = r.entries?.join(" ") || r.text || "";
				}
				return `<div class="mb-2"><strong>${r.name}.</strong> ${text}</div>`;
			}).join("")
			: null;

		// Get conditions
		const conditions = this._state.getCompanionConditions?.(companion.id) || [];
		const conditionsHtml = conditions.length > 0
			? conditions.map(c => {
				const condName = typeof c === "string" ? c : c.name;
				const condDef = CharacterSheetState.getConditionEffects(condName);
				return `<span style="display: inline-block; padding: 2px 8px; background: rgba(239, 68, 68, 0.15); border-radius: 12px; font-size: 0.85em; margin-right: 4px;">${condDef?.icon || "⚠️"} ${condName}</span>`;
			}).join("")
			: "<span class='ve-muted'>None</span>";

		// Size and type info
		const sizeStr = companion.size ? Parser.sizeAbvToFull(companion.size) : "";
		const typeStr = companion.creatureType || "";
		const subtypeStr = [sizeStr, typeStr].filter(Boolean).join(" ");

		modalInner.innerHTML = `
			<div style="font-size: 0.95em;">
				${subtypeStr ? `<div class="ve-muted ve-small mb-2">${subtypeStr}</div>` : ""}

				<div class="ve-flex mb-3" style="gap: 16px; flex-wrap: wrap; padding: 8px; background: rgba(var(--rgb-bg-text), 0.03); border-radius: 6px;">
					<div><strong>AC:</strong> ${companion.ac || "—"}</div>
					<div><strong>HP:</strong> <span style="color: ${companion.hp?.current > 0 ? "#22c55e" : "#ef4444"};">${companion.hp?.current || 0}</span>/${companion.hp?.max || 0}</div>
					<div><strong>Speed:</strong> ${this._formatCompanionSpeeds(companion.speed)}</div>
				</div>

				<div class="ve-flex mb-3" style="border: 1px solid var(--rgb-border-grey-muted); border-radius: 6px; padding: 8px;">
					${abilityRow}
				</div>

				<div class="mb-2" style="padding: 0 4px;">
					<strong>Conditions:</strong> ${conditionsHtml}
				</div>

				<div class="mb-2" style="padding: 0 4px;">
					<strong>Senses:</strong> ${companion.senses?.join(", ") || "—"}
					${companion.passive ? `, passive Perception ${companion.passive}` : ""}
				</div>

				<div class="mb-3" style="padding: 0 4px;"><strong>Languages:</strong> ${companion.languages?.join(", ") || "—"}</div>

				<h5 class="mb-1" style="border-bottom: 1px solid var(--rgb-border-grey-muted); padding-bottom: 4px;">Traits</h5>
				<div class="mb-3">${traitsHtml}</div>

				<h5 class="mb-1" style="border-bottom: 1px solid var(--rgb-border-grey-muted); padding-bottom: 4px;">Actions</h5>
				<div class="mb-3">${actionsHtml}</div>

				${reactionsHtml ? `<h5 class="mb-1" style="border-bottom: 1px solid var(--rgb-border-grey-muted); padding-bottom: 4px;">Reactions</h5><div>${reactionsHtml}</div>` : ""}
			</div>
		`;

		// Bind save roll buttons
		modalInner.querySelectorAll(".btn-companion-save").forEach(el => el.addEventListener("click", (evt) => {
			const ability = evt.currentTarget.dataset.ability;
			const mod = parseInt(evt.currentTarget.dataset.mod);
			const roll = Renderer.dice.parseRandomise2("1d20");
			const total = roll + mod;
			const modStr = mod >= 0 ? `+${mod}` : mod;
			JqueryUtil.doToast({
				type: "info",
				content: `🎲 ${companion.name} ${ability.toUpperCase()} Save: ${roll} ${modStr} = <strong>${total}</strong>`,
			});
		}));

		// Bind attack roll buttons in stat block
		modalInner.querySelectorAll(".btn-statblock-attack").forEach(el => el.addEventListener("click", async (evt) => {
			const actionName = evt.currentTarget.dataset.actionName;
			await this._rollCompanionAttack(companion, actionName);
		}));

		// Bind damage-only roll buttons in stat block
		modalInner.querySelectorAll(".btn-statblock-damage").forEach(el => el.addEventListener("click", (evt) => {
			const actionName = evt.currentTarget.dataset.actionName;
			const action = companion.actions?.find(a => a.name === actionName);
			if (!action) return;

			const entry = action.entries?.find(e => typeof e === "string") || "";
			const damageMatches = [...entry.matchAll(/\{@damage\s+([^}]+)\}/g)];
			const damages = damageMatches.map(m => m[1].trim());

			if (damages.length > 0) {
				this._rollCompanionDamage(companion, actionName, damages, false);
			}
		}));
	}

	_formatCompanionSpeeds (speed) {
		if (!speed) return "—";
		const parts = [];
		if (speed.walk) parts.push(`${speed.walk} ft.`);
		if (speed.fly) parts.push(`fly ${speed.fly} ft.`);
		if (speed.swim) parts.push(`swim ${speed.swim} ft.`);
		if (speed.climb) parts.push(`climb ${speed.climb} ft.`);
		if (speed.burrow) parts.push(`burrow ${speed.burrow} ft.`);
		return parts.length > 0 ? parts.join(", ") : "—";
	}

	/**
	 * Render a grouped companion card (for conjured creatures)
	 * @param {object} companion - The companion data with count and hpArray
	 * @param {*} list - The list container to append to
	 */
	_renderGroupedCompanion (companion, list) {
		const livingCount = this._state.getLivingGroupedCreatureCount?.(companion.id) || 0;
		const totalCount = companion.count || 1;

		// Format speeds
		const speeds = [];
		if (companion.speed?.walk) speeds.push(`${companion.speed.walk} ft.`);
		if (companion.speed?.fly) speeds.push(`fly ${companion.speed.fly} ft.`);
		if (companion.speed?.swim) speeds.push(`swim ${companion.speed.swim} ft.`);
		const speedStr = speeds.length > 0 ? speeds.join(", ") : "—";

		// Type info
		const info = {label: "Conjured", icon: "✨", color: "#3b82f6"};

		// Get companion icon (token image with emoji fallback)
		const companionIconHtml = CharacterSheetClassUtils.getCompanionIconHtml(companion, "lg");

		// Build hoverable name link
		let nameDisplay;
		if (companion.source) {
			try {
				const hash = UrlUtil.encodeForHash([companion.name, companion.source].join(HASH_LIST_SEP));
				const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BESTIARY, source: companion.source, hash});
				nameDisplay = `<a href="${UrlUtil.PG_BESTIARY}#${hash}" ${hoverAttrs} style="font-size: 1.25em; font-weight: bold;">${companion.name}</a>`;
			} catch (e) {
				nameDisplay = `<span style="font-size: 1.25em; font-weight: bold;">${companion.name}</span>`;
			}
		} else {
			nameDisplay = `<span style="font-size: 1.25em; font-weight: bold;">${companion.name}</span>`;
		}

		// Create individual HP bars HTML
		const hpBarsHtml = companion.hpArray.map((creatureHp, index) => {
			const hpPercent = Math.round((creatureHp.current / creatureHp.max) * 100);
			const hpColor = creatureHp.current === 0 ? "#6b7280" : hpPercent > 50 ? "#22c55e" : hpPercent > 25 ? "#f59e0b" : "#ef4444";
			const isDead = creatureHp.current === 0;
			return `
				<div class="charsheet__grouped-creature" data-index="${index}" style="
					display: flex;
					align-items: center;
					gap: 8px;
					padding: 6px 8px;
					background: ${isDead ? "rgba(107, 114, 128, 0.1)" : "rgba(var(--rgb-bg-text), 0.03)"};
					border-radius: 6px;
					${isDead ? "opacity: 0.6;" : ""}
				">
					<span style="font-size: 0.85em; width: 24px; text-align: center; color: var(--rgb-text-muted);">#${index + 1}</span>
					<div style="flex: 1; display: flex; align-items: center; gap: 6px;">
						<div style="flex: 1; height: 8px; background: rgba(var(--rgb-bg-text), 0.1); border-radius: 4px; overflow: hidden;">
							<div style="width: ${hpPercent}%; height: 100%; background: ${hpColor}; transition: width 0.2s;"></div>
						</div>
						<span style="font-size: 0.8em; min-width: 48px; text-align: right; color: ${hpColor};">${creatureHp.current}/${creatureHp.max}</span>
					</div>
					<div class="ve-flex" style="gap: 4px;">
						<button class="ve-btn ve-btn-xxs ve-btn-success btn-heal-creature" data-index="${index}" title="Heal" ${isDead ? "" : ""}>+</button>
						<button class="ve-btn ve-btn-xxs ve-btn-danger btn-damage-creature" data-index="${index}" title="Damage" ${isDead ? "disabled" : ""}>−</button>
					</div>
					${isDead ? "<span style=\"font-size: 0.8em; color: #ef4444;\">☠️</span>" : ""}
				</div>
			`;
		}).join("");

		const card = e_({outer: `
			<div class="charsheet__companion-card charsheet__grouped-companion" data-companion-id="${companion.id}" style="
				border: 2px solid ${info.color}33;
				border-radius: 12px;
				padding: 16px;
				margin-bottom: 12px;
				background: linear-gradient(135deg, ${info.color}08, transparent);
				position: relative;
				overflow: hidden;
			">
				<!-- Type badge -->
				<div style="
					position: absolute;
					top: 0;
					right: 0;
					background: ${info.color}22;
					color: ${info.color};
					padding: 4px 12px 4px 16px;
					font-size: 0.75em;
					font-weight: 600;
					border-bottom-left-radius: 12px;
				">${info.icon} ${info.label}</div>

				<!-- Header -->
				<div class="ve-flex ve-flex-v-center mb-3" style="gap: 12px;">
					${companionIconHtml}
					<div class="ve-flex-col" style="flex: 1;">
						<div class="ve-flex ve-flex-v-center" style="gap: 8px;">
							<span style="font-size: 1.5em; font-weight: bold; color: ${info.color};">${totalCount}×</span>
							${nameDisplay}
						</div>
						<div class="ve-muted ve-small">from ${companion.origin || "Conjure spell"} • ${livingCount}/${totalCount} alive</div>
					</div>
				</div>

				<!-- Summary Stats -->
				<div style="
					display: grid;
					grid-template-columns: repeat(4, 1fr);
					gap: 12px;
					margin-bottom: 12px;
					padding: 12px;
					background: rgba(var(--rgb-bg-text), 0.03);
					border-radius: 8px;
				">
					<div class="ve-flex-col ve-text-center">
						<div class="ve-muted ve-small" style="margin-bottom: 2px;">Each HP</div>
						<div class="bold" style="font-size: 1.1em;">❤️ ${companion.hp?.max || "?"}</div>
					</div>
					<div class="ve-flex-col ve-text-center">
						<div class="ve-muted ve-small" style="margin-bottom: 2px;">AC</div>
						<div class="bold" style="font-size: 1.1em;">🛡️ ${companion.ac || "—"}</div>
					</div>
					<div class="ve-flex-col ve-text-center">
						<div class="ve-muted ve-small" style="margin-bottom: 2px;">Speed</div>
						<div style="font-size: 0.9em;">👟 ${speedStr}</div>
					</div>
					<div class="ve-flex-col ve-text-center">
						<div class="ve-muted ve-small" style="margin-bottom: 2px;">Passive</div>
						<div style="font-size: 0.9em;">👁️ ${companion.passive || "—"}</div>
					</div>
				</div>

				<!-- Individual Creatures (Expandable) -->
				<div class="charsheet__grouped-creatures-container mb-3">
					<div class="ve-flex ve-flex-v-center mb-2" style="gap: 8px;">
						<button class="ve-btn ve-btn-xs ve-btn-default btn-toggle-creatures" style="padding: 2px 8px;">
							<span class="toggle-icon">▶</span> Individual Creatures
						</button>
						<span class="ve-muted ve-small">(${livingCount} alive, ${totalCount - livingCount} dead)</span>
					</div>
					<div class="charsheet__grouped-creatures-list" style="display: none; max-height: 200px; overflow-y: auto; padding: 4px;">
						<div class="ve-flex-col" style="gap: 4px;">
							${hpBarsHtml}
						</div>
					</div>
				</div>

				<!-- Bulk Actions -->
				<div class="ve-flex mb-3" style="gap: 8px;">
					<button class="ve-btn ve-btn-sm ve-btn-success btn-heal-all" style="flex: 1;">
						<span class="glyphicon glyphicon-heart"></span> Heal All
					</button>
					<button class="ve-btn ve-btn-sm ve-btn-danger btn-damage-all" style="flex: 1;">
						<span class="glyphicon glyphicon-flash"></span> Damage All
					</button>
				</div>

				<!-- Attacks (if any) -->
				${this._buildGroupedCompanionAttacksHtml(companion)}

				<!-- Other Actions -->
				<div class="ve-flex" style="gap: 8px; flex-wrap: wrap;">
					<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-view" title="View full stat block">
						<span class="glyphicon glyphicon-list-alt"></span> Stat Block
					</button>
					<button class="ve-btn ve-btn-xs ve-btn-default btn-companion-dismiss" title="Dismiss all conjured creatures" style="color: #ef4444;">
						<span class="glyphicon glyphicon-remove"></span> Dismiss All
					</button>
				</div>
			</div>
		`});

		// Toggle creatures list
		card.querySelector(".btn-toggle-creatures").addEventListener("click", function () {
			const list = card.querySelector(".charsheet__grouped-creatures-list");
			const icon = this.querySelector(".toggle-icon");
			list.style.display = list.style.display === "none" ? "" : "none";
			icon.textContent = list.style.display === "none" ? "▶" : "▼";
		});

		// Heal all creatures
		card.querySelector(".btn-heal-all").addEventListener("click", async () => {
			const amount = await InputUiUtil.pGetUserNumber({
				title: `Heal All ${companion.name}`,
				min: 1,
				int: true,
			});
			if (amount == null) return;

			const healed = this._state.healAllGroupedCreatures?.(companion.id, amount);
			this._saveCurrentCharacter();
			this._renderCompanions();
			JqueryUtil.doToast({type: "success", content: `Healed ${healed} HP across all ${companion.name}!`});
		});

		// Damage all creatures
		card.querySelector(".btn-damage-all").addEventListener("click", async () => {
			const amount = await InputUiUtil.pGetUserNumber({
				title: `Damage All ${companion.name}`,
				min: 1,
				int: true,
			});
			if (amount == null) return;

			const result = this._state.damageAllGroupedCreatures?.(companion.id, amount);
			this._saveCurrentCharacter();
			this._renderCompanions();

			let msg = `Dealt ${result.totalDamage} damage across all ${companion.name}!`;
			if (result.creaturesDropped > 0) {
				msg += ` ${result.creaturesDropped} creature(s) dropped to 0 HP.`;
			}
			JqueryUtil.doToast({type: "warning", content: msg});
		});

		// Heal individual creature
		card.querySelectorAll(".btn-heal-creature").forEach(el => el.addEventListener("click", async (evt) => {
			evt.stopPropagation();
			const index = parseInt(evt.currentTarget.dataset.index);
			const amount = await InputUiUtil.pGetUserNumber({
				title: `Heal ${companion.name} #${index + 1}`,
				min: 1,
				int: true,
			});
			if (amount == null) return;

			this._state.healGroupedCreature?.(companion.id, index, amount);
			this._saveCurrentCharacter();
			this._renderCompanions();
		}));

		// Damage individual creature
		card.querySelectorAll(".btn-damage-creature").forEach(el => el.addEventListener("click", async (evt) => {
			evt.stopPropagation();
			const index = parseInt(evt.currentTarget.dataset.index);
			const amount = await InputUiUtil.pGetUserNumber({
				title: `Damage ${companion.name} #${index + 1}`,
				min: 1,
				int: true,
			});
			if (amount == null) return;

			const result = this._state.damageGroupedCreature?.(companion.id, index, amount);
			this._saveCurrentCharacter();
			this._renderCompanions();

			if (result.droppedToZero) {
				JqueryUtil.doToast({type: "warning", content: `${companion.name} #${index + 1} dropped to 0 HP!`});
			}
		}));

		// View stat block
		card.querySelector(".btn-companion-view").addEventListener("click", () => {
			this._showCompanionStatBlock(companion);
		});

		// Attack roll buttons for grouped companions
		card.querySelectorAll(".btn-grouped-attack-roll").forEach(el => el.addEventListener("click", async (evt) => {
			const actionName = evt.currentTarget.dataset.actionName;
			await this._rollCompanionAttack(companion, actionName);
		}));

		// Dismiss all
		card.querySelector(".btn-companion-dismiss").addEventListener("click", async () => {
			const confirmed = await InputUiUtil.pGetUserBoolean({
				title: "Dismiss Conjured Creatures?",
				htmlDescription: `Are you sure you want to dismiss all <strong>${companion.count}× ${companion.name}</strong>?`,
				textYes: "Dismiss All",
				textNo: "Cancel",
			});
			if (!confirmed) return;

			this._state.removeCompanion?.(companion.id);
			this._saveCurrentCharacter();
			this._renderCompanions();
			JqueryUtil.doToast({type: "info", content: `${companion.count}× ${companion.name} have been dismissed.`});
		});

		list.append(card);
	}

	/**
	 * Build attack buttons HTML for grouped companions
	 */
	_buildGroupedCompanionAttacksHtml (companion) {
		const attackActions = companion.actions?.filter(a =>
			a.entries?.some(e => typeof e === "string" && /\{@atk/.test(e)),
		) || [];

		if (attackActions.length === 0) return "";

		const attackButtonsHtml = attackActions.map(action => {
			const entry = action.entries?.find(e => typeof e === "string") || "";
			const hitMatch = entry.match(/\{@hit\s*(-?\d+)\}/);
			const attackBonus = hitMatch ? parseInt(hitMatch[1]) : 0;
			const bonusStr = attackBonus >= 0 ? `+${attackBonus}` : `${attackBonus}`;
			return `<button class="ve-btn ve-btn-xs ve-btn-danger btn-grouped-attack-roll" data-action-name="${action.name.replace(/"/g, "&quot;")}" title="Roll ${action.name}">
				⚔️ ${action.name} (${bonusStr})
			</button>`;
		}).join("");

		return `
			<div class="charsheet__grouped-attacks mb-3" style="padding: 0 4px;">
				<div class="ve-muted ve-small mb-1"><strong>Attacks:</strong></div>
				<div class="ve-flex" style="gap: 6px; flex-wrap: wrap;">
					${attackButtonsHtml}
				</div>
			</div>
		`;
	}

	async _onAddCompanionCondition (companion) {
		const allConditions = this.getConditionsList();
		const currentConditions = this._state.getCompanionConditions?.(companion.id) || [];

		// Filter out conditions already applied
		const availableConditions = allConditions.filter(cond =>
			!currentConditions.some(curr => {
				const currName = typeof curr === "string" ? curr : curr.name;
				return currName.toLowerCase() === cond.name.toLowerCase();
			}),
		);

		if (!availableConditions) {
			JqueryUtil.doToast({type: "warning", content: "All conditions already applied!"});
			return;
		}

		const chosen = await InputUiUtil.pGetUserEnum({
			title: `Add Condition to ${companion.customName || companion.name}`,
			values: availableConditions.map(c => c.name),
			fnDisplay: v => {
				const condDef = CharacterSheetState.getConditionEffects(v);
				return `${condDef?.icon || "⚠️"} ${v}`;
			},
			isResolveItem: true,
		});

		if (!chosen) return;

		this._state.addCompanionCondition?.(companion.id, chosen);
		this._saveCurrentCharacter();
		this._renderCompanions();
		JqueryUtil.doToast({type: "info", content: `Added ${chosen} to ${companion.customName || companion.name}`});
	}

	_rollCompanionSkillCheck (companion, skill) {
		const mod = this._state.getCompanionSkillMod?.(companion.id, skill) || 0;
		const roll = Renderer.dice.parseRandomise2("1d20");
		const total = roll + mod;
		const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
		const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);

		JqueryUtil.doToast({
			type: "info",
			content: `🎲 ${companion.customName || companion.name} ${skillName}: ${roll} ${modStr} = <strong>${total}</strong>`,
		});
	}

	/**
	 * Roll a companion attack with attack roll and damage
	 * @param {object} companion - The companion data
	 * @param {string} actionName - Name of the action to use
	 */
	async _rollCompanionAttack (companion, actionName) {
		const action = companion.actions?.find(a => a.name === actionName);
		if (!action) {
			JqueryUtil.doToast({type: "warning", content: `Action "${actionName}" not found`});
			return;
		}

		// Parse attack info from entries
		const entry = action.entries?.find(e => typeof e === "string") || "";
		const hitMatch = entry.match(/\{@hit\s*(-?\d+)\}/);
		const attackBonus = hitMatch ? parseInt(hitMatch[1]) : 0;

		// Parse all damage dice from entry
		const damageMatches = [...entry.matchAll(/\{@damage\s+([^}]+)\}/g)];
		const damages = damageMatches.map(m => m[1].trim());

		// Parse DC for save-based effects
		const dcMatch = entry.match(/\{@dc\s*(\d+)\}/);
		const saveDC = dcMatch ? parseInt(dcMatch[1]) : null;

		// Roll attack
		const attackRoll = Renderer.dice.parseRandomise2("1d20");
		const attackTotal = attackRoll + attackBonus;
		const bonusStr = attackBonus >= 0 ? `+${attackBonus}` : `${attackBonus}`;
		const isCrit = attackRoll === 20;
		const isFumble = attackRoll === 1;

		// Mark action as used
		this._state.updateCompanion?.(companion.id, {usedAction: true});
		this._saveCurrentCharacter();
		this._renderCompanions();

		// Build attack result message
		let attackResult = `<strong>Attack Roll:</strong> ${attackRoll} ${bonusStr} = <strong style="font-size: 1.2em;">${attackTotal}</strong>`;
		if (isCrit) attackResult += ` <span style="color: #22c55e;">⭐ CRITICAL!</span>`;
		if (isFumble) attackResult += ` <span style="color: #ef4444;">💀 FUMBLE!</span>`;

		// Show attack roll first
		JqueryUtil.doToast({
			type: isCrit ? "success" : isFumble ? "danger" : "info",
			content: e_({outer: `<div>
				<div class="bold mb-1">⚔️ ${companion.customName || companion.name} — ${actionName}</div>
				<div>${attackResult}</div>
				${damages.length > 0 ? `<div class="mt-2"><button class="ve-btn ve-btn-xs ve-btn-warning btn-roll-damage" style="width: 100%;">💥 Roll Damage${isCrit ? " (Crit!)" : ""}</button></div>` : ""}
				${saveDC ? `<div class="ve-muted ve-small mt-1">Target must make a DC ${saveDC} save</div>` : ""}
			</div>`}),
		});

		// Bind damage roll button
		setTimeout(() => {
			const btn = document.querySelector(".btn-roll-damage");
			if (btn && damages.length > 0) {
				btn.addEventListener("click", () => {
					this._rollCompanionDamage(companion, actionName, damages, isCrit);
				});
			}
		}, 100);
	}

	/**
	 * Roll damage for a companion attack
	 */
	_rollCompanionDamage (companion, actionName, damages, isCrit = false) {
		const damageResults = damages.map(damageStr => {
			// Clean up the damage string
			const cleanDamage = damageStr.replace(/\s+/g, "");

			// For crits, double the dice (not the modifier)
			let finalDamage = cleanDamage;
			if (isCrit) {
				// Parse dice and modifier
				const diceMatch = cleanDamage.match(/(\d+)d(\d+)/);
				if (diceMatch) {
					const numDice = parseInt(diceMatch[1]) * 2; // Double dice for crit
					const dieSize = diceMatch[2];
					finalDamage = cleanDamage.replace(/\d+d\d+/, `${numDice}d${dieSize}`);
				}
			}

			const total = Renderer.dice.parseRandomise2(finalDamage);
			return {dice: damageStr, total, critDice: isCrit ? finalDamage : null};
		});

		// Build damage output
		const damageLines = damageResults.map(r => {
			const critNote = r.critDice ? ` (${r.critDice})` : "";
			return `${r.dice}${critNote} = <strong>${r.total}</strong>`;
		}).join(" + ");

		const totalDamage = damageResults.reduce((sum, r) => sum + r.total, 0);

		JqueryUtil.doToast({
			type: "warning",
			content: e_({outer: `<div>
				<div class="bold mb-1">💥 ${companion.customName || companion.name} — ${actionName} Damage${isCrit ? " (CRIT!)" : ""}</div>
				<div>${damageLines}</div>
				<div class="bold mt-1" style="font-size: 1.2em;">Total: ${totalDamage} damage</div>
			</div>`}),
		});
	}

	async _onEditCompanionName (companion) {
		const newName = await InputUiUtil.pGetUserString({
			title: `Rename ${companion.name}`,
			default: companion.customName || "",
		});

		if (newName === null) return; // Cancelled

		this._state.updateCompanion?.(companion.id, {customName: newName || null});
		this._saveCurrentCharacter();
		this._renderCompanions();

		if (newName) {
			JqueryUtil.doToast({type: "success", content: `Renamed to "${newName}"`});
		} else {
			JqueryUtil.doToast({type: "info", content: `Name reset to ${companion.name}`});
		}
	}

	_useCompanionAction (companion, action) {
		// Mark action as used
		this._state.updateCompanion?.(companion.id, {usedAction: true});
		this._saveCurrentCharacter();

		// Action descriptions for the toast
		const actionDescriptions = {
			help: "gives an ally advantage on their next attack or ability check",
			dash: `doubles their speed (${this._formatCompanionSpeeds(companion.speed)} × 2) this turn`,
			disengage: "can move without provoking opportunity attacks this turn",
			dodge: "has attacks against them at disadvantage and advantage on DEX saves until next turn",
			hide: "attempts to become hidden",
			search: "searches the area",
			attack: "makes an attack",
		};

		const actionName = action.charAt(0).toUpperCase() + action.slice(1);
		const name = companion.customName || companion.name;

		// For Hide and Search, roll the appropriate skill check
		if (action === "hide") {
			this._rollCompanionSkillCheck(companion, "stealth");
			this._renderCompanions();
			return;
		}
		if (action === "search") {
			this._rollCompanionSkillCheck(companion, "perception");
			this._renderCompanions();
			return;
		}

		// For Attack, show available attack actions
		if (action === "attack" && companion.actions?.length) {
			this._showCompanionAttackOptions(companion);
			this._renderCompanions();
			return;
		}

		JqueryUtil.doToast({
			type: "info",
			content: `⚡ ${name} takes the <strong>${actionName}</strong> action — ${actionDescriptions[action]}`,
		});

		this._renderCompanions();
	}

	async _showCompanionAttackOptions (companion) {
		const attacks = (companion.actions || []).filter(a =>
			a.entries?.some(e => typeof e === "string" && e.toLowerCase().includes("attack")),
		);

		if (!attacks) {
			JqueryUtil.doToast({type: "warning", content: "No attack actions available"});
			return;
		}

		const chosen = await InputUiUtil.pGetUserEnum({
			title: `${companion.customName || companion.name} — Choose Attack`,
			values: attacks.map(a => a.name),
			isResolveItem: true,
		});

		if (!chosen) return;

		const attack = attacks.find(a => a.name === chosen);
		if (!attack) return;

		// Parse attack bonus from entries
		let attackBonus = 0;
		for (const entry of attack.entries || []) {
			if (typeof entry !== "string") continue;
			const match = entry.match(/\{@hit (\d+)\}/);
			if (match) {
				attackBonus = parseInt(match[1]);
				break;
			}
		}

		// Roll attack
		const roll = Renderer.dice.parseRandomise2("1d20");
		const total = roll + attackBonus;
		const modStr = attackBonus >= 0 ? `+${attackBonus}` : attackBonus;

		JqueryUtil.doToast({
			type: "info",
			content: `⚔️ ${companion.customName || companion.name} ${chosen}: ${roll} ${modStr} = <strong>${total}</strong>`,
		});
	}

	_resetAllCompanionActions () {
		const companions = this._state.getActiveCompanions?.() || [];
		for (const companion of companions) {
			this._state.updateCompanion?.(companion.id, {usedAction: false, usedReaction: false});
		}
		this._saveCurrentCharacter();
		this._renderCompanions();
		JqueryUtil.doToast({type: "success", content: "🔄 New round — all companion actions reset!"});
	}

	_renderAbilitiesDetailed () {
		const container = document.getElementById("charsheet-abilities-detailed");
		if (!container) return;

		container.innerHTML = "";

		// Get skills list for later use
		const skills = this.getSkillsList();

		// Ability emoji icons
		const abilityIcons = {
			str: "💪",
			dex: "🎯",
			con: "❤️",
			int: "🧠",
			wis: "👁️",
			cha: "✨",
		};

		// Ability colors for styling
		const abilityColors = {
			str: "var(--cs-ability-str, #ef4444)",
			dex: "var(--cs-ability-dex, #22c55e)",
			con: "var(--cs-ability-con, #f59e0b)",
			int: "var(--cs-ability-int, #3b82f6)",
			wis: "var(--cs-ability-wis, #8b5cf6)",
			cha: "var(--cs-ability-cha, #ec4899)",
		};

		// Main container with modern layout
		const mainContent = e_({outer: `<div class="charsheet__abilities-tab"></div>`});

		// Ability Scores Section - Hero cards
		const abilitiesSection = e_({outer: `
			<div class="charsheet__abilities-section">
				<div class="charsheet__abilities-section-header">
					<span class="charsheet__abilities-section-icon">📊</span>
					<h4 class="charsheet__abilities-section-title">Ability Scores</h4>
				</div>
				<div class="charsheet__abilities-hero-grid"></div>
			</div>
		`});

		const heroGrid = abilitiesSection.querySelector(".charsheet__abilities-hero-grid");

		Parser.ABIL_ABVS.forEach(abl => {
			const base = this._state.getAbilityBase(abl);
			const bonus = this._state.getAbilityBonus(abl);
			const total = this._state.getAbilityScore(abl);
			const mod = this._state.getAbilityMod(abl);
			const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
			const isProficient = this._state.hasSaveProficiency(abl);
			const saveMod = this._state.getSaveMod(abl);
			const saveModStr = saveMod >= 0 ? `+${saveMod}` : `${saveMod}`;

			// Get related skills for this ability
			const relatedSkills = skills.filter(s => s.ability === abl);

			const card = e_({outer: `
				<div class="charsheet__ability-hero-card" data-ability="${abl}" style="--ability-color: ${abilityColors[abl]}">
					<div class="charsheet__ability-hero-header">
						<span class="charsheet__ability-hero-icon">${abilityIcons[abl]}</span>
						<div class="charsheet__ability-hero-names">
							<span class="charsheet__ability-hero-full">${Parser.attAbvToFull(abl)}</span>
							<span class="charsheet__ability-hero-abbr">${abl.toUpperCase()}</span>
						</div>
					</div>
					<div class="charsheet__ability-hero-scores">
						<div class="charsheet__ability-hero-total">${total}</div>
						<div class="charsheet__ability-hero-mod">${modStr}</div>
					</div>
					<div class="charsheet__ability-hero-breakdown">
						<span class="charsheet__ability-hero-base">Base ${base}</span>
						${bonus !== 0 ? `<span class="charsheet__ability-hero-bonus">${bonus >= 0 ? "+" : ""}${bonus} bonus</span>` : ""}
					</div>
					<div class="charsheet__ability-hero-save">
						<span class="charsheet__ability-save-prof ${isProficient ? "active" : ""}">${isProficient ? "●" : "○"}</span>
						<span class="charsheet__ability-save-label">Save</span>
						<span class="charsheet__ability-save-value">${saveModStr}</span>
					</div>
					<div class="charsheet__ability-hero-skills">
						${relatedSkills.map(s => {
		const skillKey = s.name.toLowerCase().replace(/\s+/g, "");
		const profLevel = this._state.getSkillProficiency(skillKey);
		const skillMod = this._state.getSkillMod(skillKey);
		const skillModStr = skillMod >= 0 ? `+${skillMod}` : `${skillMod}`;
		let profIcon = "○";
		let profClass = "";
		let profTitle = "Not proficient - Click to toggle";
		if (profLevel === 2) { profIcon = "◉"; profClass = "expertise"; profTitle = "Expertise - Click to toggle"; } else if (profLevel === 1) { profIcon = "●"; profClass = "proficient"; profTitle = "Proficient - Click to toggle"; }
		return `<div class="charsheet__ability-skill-mini ${profClass}" data-skill="${skillKey}" title="Click to roll ${s.name}">
								<span class="charsheet__ability-skill-prof" title="${profTitle}">${profIcon}</span>
								<span class="charsheet__ability-skill-name">${s.name}</span>
								<span class="charsheet__ability-skill-mod">${skillModStr}</span>
							</div>`;
	}).join("")}
					</div>
					<div class="charsheet__ability-hero-actions">
						<button class="charsheet__ability-roll-btn charsheet__ability-roll-check" data-ability="${abl}" title="Roll ${Parser.attAbvToFull(abl)} Check">
							🎲 Check
						</button>
						<button class="charsheet__ability-roll-btn charsheet__ability-roll-save" data-ability="${abl}" title="Roll ${Parser.attAbvToFull(abl)} Save">
							🛡️ Save
						</button>
					</div>
				</div>
			`});

			// Click handlers - pass event for shift/ctrl (advantage/disadvantage)
			card.querySelector(".charsheet__ability-roll-check").addEventListener("click", (e) => {
				e.stopPropagation();
				this._rollAbilityCheck(abl, e);
			});
			card.querySelector(".charsheet__ability-roll-save").addEventListener("click", (e) => {
				e.stopPropagation();
				this._rollSavingThrow(abl, e);
			});
			// Click on proficiency indicator to toggle proficiency
			card.querySelectorAll(".charsheet__ability-skill-prof").forEach(el => el.addEventListener("click", (e) => {
				e.stopPropagation();
				e.preventDefault();
				const skillMini = e.currentTarget.closest(".charsheet__ability-skill-mini");
				const skillKey = skillMini.dataset.skill;
				this._cycleSkillProficiency(skillKey);
				this._renderAbilitiesDetailed(); // Re-render to update the display
			}));
			// Click elsewhere on skill row to roll
			card.querySelectorAll(".charsheet__ability-skill-mini").forEach(el => el.addEventListener("click", (e) => {
				// Don't roll if clicking the proficiency indicator (handled above)
				if ((/** @type {*} */ (e.target)).closest(".charsheet__ability-skill-prof")) return;
				e.stopPropagation();
				const skillKey = e.currentTarget.dataset.skill;
				const skill = skills.find(s => s.name.toLowerCase().replace(/\s+/g, "") === skillKey);
				if (skill) this._rollSkillCheck(skillKey, skill.name, e);
			}));

			heroGrid.append(card);
		});

		mainContent.append(abilitiesSection);

		// Passive Scores Section
		const passivesSection = e_({outer: `
			<div class="charsheet__abilities-section charsheet__abilities-section--passives">
				<div class="charsheet__abilities-section-header">
					<span class="charsheet__abilities-section-icon">👁️</span>
					<h4 class="charsheet__abilities-section-title">Passive Scores</h4>
					<span class="charsheet__abilities-section-hint">10 + skill modifier</span>
				</div>
				<div class="charsheet__passives-hero-grid"></div>
			</div>
		`});

		const passiveSkills = [
			{key: "perception", name: "Perception", icon: "👁️", desc: "Notices hidden creatures, traps, secret doors"},
			{key: "investigation", name: "Investigation", icon: "🔍", desc: "Detects clues, finds hidden objects"},
			{key: "insight", name: "Insight", icon: "💭", desc: "Detects lies, understands true intentions"},
		];

		const passivesGrid = passivesSection.querySelector(".charsheet__passives-hero-grid");
		passiveSkills.forEach(passive => {
			const skillMod = this._state.getSkillMod(passive.key);
			const passiveScore = this._state.getPassiveScore(passive.key);
			const profLevel = this._state.getSkillProficiency(passive.key);
			let profIcon = "○";
			if (profLevel === 2) profIcon = "◉";
			else if (profLevel === 1) profIcon = "●";

			passivesGrid.insertAdjacentHTML("beforeend", `
				<div class="charsheet__passive-hero-card charsheet__passive-hero-card--${passive.key}" title="${passive.desc}">
					<div class="charsheet__passive-hero-icon">${passive.icon}</div>
					<div class="charsheet__passive-hero-value">${passiveScore}</div>
					<div class="charsheet__passive-hero-label">${passive.name}</div>
					<div class="charsheet__passive-hero-prof">${profIcon} ${skillMod >= 0 ? "+" : ""}${skillMod}</div>
				</div>
			`);
		});

		mainContent.append(passivesSection);

		// Full Skills Section
		const skillsSection = e_({outer: `
			<div class="charsheet__abilities-section charsheet__abilities-section--skills">
				<div class="charsheet__abilities-section-header">
					<span class="charsheet__abilities-section-icon">📋</span>
					<h4 class="charsheet__abilities-section-title">All Skills</h4>
					<span class="charsheet__abilities-section-hint">Click to roll</span>
				</div>
				<div class="charsheet__skills-full-grid"></div>
			</div>
		`});

		const skillsGrid = skillsSection.querySelector(".charsheet__skills-full-grid");

		// Group skills by ability
		const skillsByAbility = {};
		Parser.ABIL_ABVS.forEach(abl => skillsByAbility[abl] = []);
		skills.forEach(skill => {
			if (skillsByAbility[skill.ability]) {
				skillsByAbility[skill.ability].push(skill);
			}
		});

		Parser.ABIL_ABVS.forEach(abl => {
			if (skillsByAbility[abl].length === 0) return;

			const group = e_({outer: `
				<div class="charsheet__skills-ability-group" style="--ability-color: ${abilityColors[abl]}">
					<div class="charsheet__skills-ability-header">
						<span class="charsheet__skills-ability-icon">${abilityIcons[abl]}</span>
						<span class="charsheet__skills-ability-name">${abl.toUpperCase()}</span>
					</div>
					<div class="charsheet__skills-ability-columns">
						<span class="charsheet__skills-column-prof"></span>
						<span class="charsheet__skills-column-name">Skill</span>
						<span class="charsheet__skills-column-mod">Mod</span>
						<span class="charsheet__skills-column-passive">Pass</span>
					</div>
					<div class="charsheet__skills-ability-list"></div>
				</div>
			`});

			const list = group.querySelector(".charsheet__skills-ability-list");

			skillsByAbility[abl].forEach(skill => {
				const skillKey = skill.name.toLowerCase().replace(/\s+/g, "");
				const profLevel = this._state.getSkillProficiency(skillKey);
				const mod = this._state.getSkillMod(skillKey);
				const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
				const passiveScore = 10 + mod;

				let profIcon = "○";
				let profClass = "";
				if (profLevel === 2) { profIcon = "◉"; profClass = "expertise"; } else if (profLevel === 1) { profIcon = "●"; profClass = "proficient"; }

				const skillRow = e_({outer: `
					<div class="charsheet__skill-full-row ${profClass}" data-skill="${skillKey}">
						<span class="charsheet__skill-full-prof">${profIcon}</span>
						<span class="charsheet__skill-full-name">${skill.name}</span>
						<span class="charsheet__skill-full-mod">${modStr}</span>
						<span class="charsheet__skill-full-passive">${passiveScore}</span>
					</div>
				`});

				skillRow.addEventListener("click", () => this._rollSkillCheck(skillKey, skill.name));
				list.append(skillRow);
			});

			skillsGrid.append(group);
		});

		mainContent.append(skillsSection);

		container.append(mainContent);
	}

	_renderResources () {
		const container = document.getElementById("charsheet-resources");
		container.innerHTML = "";

		const resources = this._state.getResources();
		const usesCombatSystem = this._state.usesCombatSystem?.() || false;

		// Get limited-use custom abilities (displayed in Resources section)
		const customAbilities = this._state.getCustomAbilities?.() || [];
		const limitedAbilities = customAbilities.filter(a => a.mode === "limited");

		// Count abilities that will be shown (exclude those linking to existing resources)
		const visibleLimitedAbilities = limitedAbilities.filter(a => {
			if (a.resourceSource?.type === "linked" && a.resourceSource?.resourceId !== "stamina") {
				const linkedResource = resources.find(r => r.id === a.resourceSource.resourceId);
				if (linkedResource) return false; // Skip - already shown in resources
			}
			return true;
		});

		// Update resources count badge
		let totalResourceCount = resources.length + visibleLimitedAbilities.length;
		if (usesCombatSystem) {
			const staminaMax = this._state.getStaminaMax() || 0;
			if (staminaMax > 0) totalResourceCount++;
		}
		(/** @type {*} */ (document.getElementById("charsheet-resources-count"))).textContent = totalResourceCount;

		// Show stamina if character uses combat methods system
		if (usesCombatSystem) {
			// Ensure stamina is initialized
			if (typeof this._state.ensureStaminaInitialized === "function") {
				this._state.ensureStaminaInitialized();
			}

			const staminaMax = this._state.getStaminaMax() || 0;
			const staminaCurrent = this._state.getStaminaCurrent() ?? staminaMax;

			if (staminaMax > 0) {
				const row = e_({outer: `
					<div class="charsheet__resource-row" data-resource-id="stamina">
						<span class="charsheet__resource-name">Stamina</span>
						<span class="charsheet__resource-recharge ve-muted ve-small ml-2">(Short)</span>
						<div class="charsheet__resource-uses ml-auto">
							<button class="ve-btn ve-btn-xs ve-btn-danger mr-2 charsheet__stamina-use-btn" ${staminaCurrent <= 0 ? "disabled" : ""}>Use</button>
							<span class="charsheet__resource-current">${staminaCurrent}</span>
							<span class="charsheet__resource-max">/ ${staminaMax}</span>
							<button class="ve-btn ve-btn-xs ve-btn-success ml-2 charsheet__stamina-restore-btn" ${staminaCurrent >= staminaMax ? "disabled" : ""}>+</button>
						</div>
					</div>
				`});

				row.querySelector(".charsheet__stamina-use-btn").addEventListener("click", () => {
					const current = this._state.getStaminaCurrent() || 0;
					if (current > 0) {
						this._state.setStaminaCurrent(current - 1);
						this._saveCurrentCharacter();
						this._renderResources();
						this._renderActiveStates(); // Refresh active states to update Activate button states
						if (this._features) this._features._renderResources();
						if (this._combat) this._combat._updateStaminaDisplay();
					}
				});

				row.querySelector(".charsheet__stamina-restore-btn").addEventListener("click", () => {
					const current = this._state.getStaminaCurrent() || 0;
					if (current < staminaMax) {
						this._state.setStaminaCurrent(current + 1);
						this._saveCurrentCharacter();
						this._renderResources();
						this._renderActiveStates(); // Refresh active states to update Activate button states
						if (this._features) this._features._renderResources();
						if (this._combat) this._combat._updateStaminaDisplay();
					}
				});

				container.append(row);
			}
		}

		if (!resources.length && !usesCombatSystem && !limitedAbilities.length) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No limited-use features</div>`;
			return;
		}

		resources.forEach(resource => {
			const row = e_({outer: `
				<div class="charsheet__resource-row" data-resource-id="${resource.id}">
					<span class="charsheet__resource-name">${resource.name}</span>
					<span class="charsheet__resource-recharge ve-muted ve-small ml-2">(${resource.recharge === "short" ? "Short" : "Long"})</span>
					<div class="charsheet__resource-uses ml-auto">
						<button class="ve-btn ve-btn-xs ve-btn-danger mr-2 charsheet__resource-use-btn" ${resource.current <= 0 ? "disabled" : ""}>Use</button>
						<span class="charsheet__resource-current">${resource.current}</span>
						<span class="charsheet__resource-max">/ ${resource.max}</span>
						<button class="ve-btn ve-btn-xs ve-btn-success ml-2 charsheet__resource-restore-btn" ${resource.current >= resource.max ? "disabled" : ""}>+</button>
					</div>
				</div>
			`});

			row.querySelector(".charsheet__resource-use-btn").addEventListener("click", () => {
				if (resource.current > 0) {
					this._state.setResourceCurrent(resource.id, resource.current - 1);
					this._saveCurrentCharacter();
					this._renderResources();
					this._renderActiveStates(); // Refresh active states to update Activate button states
					if (this._features) this._features._renderResources();
				}
			});

			row.querySelector(".charsheet__resource-restore-btn").addEventListener("click", () => {
				if (resource.current < resource.max) {
					this._state.setResourceCurrent(resource.id, resource.current + 1);
					this._saveCurrentCharacter();
					this._renderResources();
					this._renderActiveStates(); // Refresh active states to update Activate button states
					if (this._features) this._features._renderResources();
				}
			});

			container.append(row);
		});

		// Render limited-use custom abilities
		limitedAbilities.forEach(ability => {
			// Get the uses display (handles both self-contained and linked resources)
			const uses = this._state.getCustomAbilityUsesDisplay?.(ability.id) || ability.uses;
			if (!uses) return;

			// Check if this ability links to an existing resource pool (don't show duplicate)
			if (ability.resourceSource?.type === "linked" && ability.resourceSource?.resourceId !== "stamina") {
				const linkedResource = resources.find(r => r.id === ability.resourceSource.resourceId);
				if (linkedResource) {
					// Skip - the linked resource is already shown in the resources list
					return;
				}
			}

			const canUse = this._state.canUseCustomAbility?.(ability.id) ?? uses.current > 0;
			const canRestore = uses.current < uses.max;

			const row = e_({outer: `
				<div class="charsheet__resource-row charsheet__resource-row--custom" data-ability-id="${ability.id}">
					<span class="charsheet__resource-icon mr-1">${ability.icon || "⚡"}</span>
					<span class="charsheet__resource-name">${ability.name}</span>
					<span class="charsheet__resource-recharge ve-muted ve-small ml-2">(${uses.recharge === "short" ? "Short" : "Long"})</span>
					<div class="charsheet__resource-uses ml-auto">
						<button class="ve-btn ve-btn-xs ve-btn-danger mr-2 charsheet__ability-use-btn" ${!canUse ? "disabled" : ""}>Use</button>
						<span class="charsheet__resource-current">${uses.current}</span>
						<span class="charsheet__resource-max">/ ${uses.max}</span>
						<button class="ve-btn ve-btn-xs ve-btn-success ml-2 charsheet__ability-restore-btn" ${!canRestore ? "disabled" : ""}>+</button>
					</div>
				</div>
			`});

			row.querySelector(".charsheet__ability-use-btn").addEventListener("click", () => {
				if (this._state.useCustomAbility(ability.id)) {
					this._saveCurrentCharacter();
					this._renderResources();
					this._renderOverviewAbilities();
					this._renderActiveStates();
					if (this._features) this._features._renderResources();
					if (this._customAbilities) this._customAbilities.render();
					if (this._combat) this._combat.renderCombatActions();
				}
			});

			row.querySelector(".charsheet__ability-restore-btn").addEventListener("click", () => {
				if (this._state.restoreCustomAbilityUse(ability.id)) {
					this._saveCurrentCharacter();
					this._renderResources();
					this._renderOverviewAbilities();
					this._renderActiveStates();
					if (this._features) this._features._renderResources();
					if (this._customAbilities) this._customAbilities.render();
					if (this._combat) this._combat.renderCombatActions();
				}
			});

			container.append(row);
		});
	}

	_renderOverviewMetamagic () {
		CharacterSheetCombat.renderMetamagicDashboard(this._state, this, "#charsheet-overview-metamagic", "#charsheet-overview-metamagic-section", "#charsheet-overview-metamagic-sp");
	}

	_renderOverviewAbilities () {
		const container = document.getElementById("charsheet-overview-abilities");
		if (!container) return;

		container.innerHTML = "";

		// Get limited-use custom abilities
		const customAbilities = this._state.getCustomAbilities?.() || [];
		const limitedAbilities = customAbilities.filter(a => a.mode === "limited");

		// Get class resources (Channel Divinity, Rage, etc.)
		// Exclude Focus/Ki Points — they already have a dedicated display in the resource bar
		const META_RESOURCE_NAMES = new Set(["Focus Points", "Ki Points"]);
		const resources = this._state.getResources?.() || [];
		const classResources = resources.filter(r => r.max > 0 && !META_RESOURCE_NAMES.has(r.name));

		if (!limitedAbilities.length && !classResources.length) {
			container.innerHTML = `
				<div class="charsheet__empty-state">
					<span class="charsheet__empty-icon">💫</span>
					<span class="charsheet__empty-text">No useable abilities</span>
				</div>
			`;
			return;
		}

		// Render class resources first
		for (const resource of classResources) {
			const rechargeIcon = resource.recharge === "short" ? "☀️" : "🌙";
			const rechargeLabel = resource.recharge === "short" ? "short rest" : "long rest";
			const canUse = resource.current > 0;

			const row = e_({outer: `
				<div class="charsheet__ability-row charsheet__ability-row--resource" data-resource-name="${resource.name.replace(/"/g, "&quot;")}">
					<div class="charsheet__ability-info">
						<span class="charsheet__ability-icon" title="Class Resource">⚡</span>
						<span class="charsheet__ability-name">${resource.name}</span>
					</div>
					<div class="charsheet__ability-controls">
						<span class="charsheet__ability-uses">${resource.current}/${resource.max}</span>
						<span class="charsheet__ability-recharge" title="${rechargeLabel}">${rechargeIcon}</span>
						<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__ability-use-btn"
							${!canUse ? "disabled" : ""}>Use</button>
					</div>
				</div>
			`});

			row.querySelector(".charsheet__ability-use-btn").addEventListener("click", (e) => {
				e.stopPropagation();
				this._useOverviewResource(resource);
			});

			// Star (favourite) toggle
			const star = this._renderFavouriteStar("resource", resource);
			if (star) row.querySelector(".charsheet__ability-controls").append(star);

			container.append(row);
		}

		// Render custom abilities
		for (const ability of limitedAbilities) {
			const uses = this._state.getCustomAbilityUsesDisplay?.(ability.id);
			if (!uses) continue;

			const canUse = this._state.canUseCustomAbility?.(ability.id) ?? uses.current > 0;

			// Determine action type
			const activationAction = ability.activationAction || "free";
			let actionIcon = "✨";
			let actionType = "Free";
			if (activationAction === "action") {
				actionIcon = "⚔️";
				actionType = "Action";
			} else if (activationAction === "bonus") {
				actionIcon = "⚡";
				actionType = "Bonus Action";
			} else if (activationAction === "reaction") {
				actionIcon = "🔄";
				actionType = "Reaction";
			}

			// Recharge icon
			const rechargeIcon = uses.recharge === "short" ? "☀️" : "🌙";

			const row = e_({outer: `
				<div class="charsheet__ability-row" data-ability-id="${ability.id}">
					<div class="charsheet__ability-info">
						<span class="charsheet__ability-icon" title="${actionType}">${ability.icon || actionIcon}</span>
						<span class="charsheet__ability-name">${ability.name}</span>
					</div>
					<div class="charsheet__ability-controls">
						<span class="charsheet__ability-uses">${uses.current}/${uses.max}</span>
						<span class="charsheet__ability-recharge" title="${uses.recharge} rest">${rechargeIcon}</span>
						<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__ability-use-btn" 
							${!canUse ? "disabled" : ""}>Use</button>
					</div>
				</div>
			`});

			// Click on row to show modal
			row.addEventListener("click", (e) => {
				if (e.target.classList.contains("charsheet__ability-use-btn")) return;
				this._showAbilityDetailModal(ability);
			});

			// Use button
			row.querySelector(".charsheet__ability-use-btn").addEventListener("click", (e) => {
				e.stopPropagation();
				this._useOverviewAbility(ability);
			});

			// Star (favourite) toggle
			const star = this._renderFavouriteStar("customAbility", ability);
			if (star) row.querySelector(".charsheet__ability-controls").append(star);

			container.append(row);
		}
	}

	_useOverviewAbility (ability) {
		if (!this._state.canUseCustomAbility?.(ability.id)) {
			JqueryUtil.doToast({type: "warning", content: `No uses remaining for ${ability.name}!`});
			return;
		}

		if (this._state.useCustomAbility(ability.id)) {
			this._saveCurrentCharacter();
			this._renderResources();
			this._renderOverviewAbilities();
			this._renderActiveStates();
			if (this._features) this._features._renderResources();
			if (this._customAbilities) this._customAbilities.render();
			if (this._combat) this._combat.renderCombatActions();

			JqueryUtil.doToast({type: "success", content: `Used ${ability.name}!`});
		}
	}

	_useOverviewResource (resource) {
		if (resource.current <= 0) {
			JqueryUtil.doToast({type: "warning", content: `No uses remaining for ${resource.name}!`});
			return;
		}

		this._state.useResourceCharge?.(resource.name);
		this._saveCurrentCharacter();
		this._renderResources();
		this._renderOverviewAbilities();
		if (this._features) this._features._renderResources();
	}

	_showAbilityDetailModal (ability) {
		const uses = this._state.getCustomAbilityUsesDisplay?.(ability.id);
		const categories = CharacterSheetState?.CUSTOM_ABILITY_CATEGORIES || {};
		const category = categories[ability.category];

		// Build effects summary
		let effectsSummary = "";
		if (ability.effects?.length) {
			const effectsList = ability.effects.map(e => {
				if (e.type === "sizeIncrease") return `Size +${e.value || 1} category`;
				if (e.type === "sizeDecrease") return `Size -${e.value || 1} category`;
				if (e.type === "reach") return `Reach +${e.value || 5} ft.`;
				if (e.type?.startsWith("extraDamage:")) return `+${e.dice || "1d6"} ${e.type.replace("extraDamage:", "")} damage`;
				if (e.type?.startsWith("reroll:")) return `Reroll ${e.type.replace("reroll:", "")}`;
				return `${e.type}: ${e.value > 0 ? "+" : ""}${e.value}`;
			});
			effectsSummary = `<div class="mt-2"><strong>Effects:</strong> ${effectsList.join(", ")}</div>`;
		}

		// Build defensive traits summary
		let defenseSummary = "";
		if (ability.defensiveTraits) {
			const parts = [];
			if (ability.defensiveTraits.resistances?.length) {
				parts.push(`Resist: ${ability.defensiveTraits.resistances.join(", ")}`);
			}
			if (ability.defensiveTraits.immunities?.length) {
				parts.push(`Immune: ${ability.defensiveTraits.immunities.join(", ")}`);
			}
			if (parts) {
				defenseSummary = `<div class="mt-2"><strong>Defenses:</strong> ${parts.join("; ")}</div>`;
			}
		}

		const modalContent = `
			<div class="charsheet__ability-modal-header">
				<span class="charsheet__ability-modal-icon">${ability.icon || "⚡"}</span>
				<h4 class="charsheet__ability-modal-title">${ability.name}</h4>
				${category ? `<span class="badge badge-secondary ml-2">${category.icon} ${category.name}</span>` : ""}
			</div>
			<div class="charsheet__ability-modal-body">
				<div class="charsheet__ability-modal-description">
					${Renderer.get().render(ability.description || "No description.")}
				</div>
				${effectsSummary}
				${defenseSummary}
				${uses ? `<div class="mt-2"><strong>Uses:</strong> ${uses.current}/${uses.max} (${uses.recharge} rest)</div>` : ""}
			</div>
		`;

		// Create and show modal
		const modal = e_({outer: `
			<div class="modal-overlay charsheet__ability-detail-modal">
				<div class="modal-content charsheet__ability-detail-content">
					<div class="modal-header">
						<button class="modal-close" title="Close">&times;</button>
					</div>
					<div class="modal-body">
						${modalContent}
					</div>
					<div class="modal-footer">
						<button class="ve-btn ve-btn-primary charsheet__ability-modal-use" 
							${!this._state.canUseCustomAbility?.(ability.id) ? "disabled" : ""}>Use Ability</button>
						<button class="ve-btn ve-btn-default charsheet__ability-modal-close">Close</button>
					</div>
				</div>
			</div>
		`});

		modal.querySelectorAll(".modal-close, .charsheet__ability-modal-close").forEach(el => el.addEventListener("click", () => {
			modal.remove();
		}));

		modal.querySelector(".charsheet__ability-modal-use").addEventListener("click", () => {
			this._useOverviewAbility(ability);
			modal.remove();
		});

		// Close on background click
		modal.addEventListener("click", (e) => {
			if (e.target.classList.contains("modal-overlay")) {
				modal.remove();
			}
		});

		document.body.append(modal);
	}

	/**
	 * Render the Actions section in the overview tab.
	 * Shows features classified as "combat" or "reaction" by FEATURE_CLASSIFICATION_OVERRIDES,
	 * plus any other features that pass the combat action heuristics filter.
	 * Each row shows name, action type badge, and a "Use" button.
	 * Clicking the row opens the combat action detail modal.
	 */
	_renderOverviewActions () {
		const container = document.getElementById("charsheet-overview-actions");
		const section = document.getElementById("charsheet-overview-actions-section");
		if (!container) return;

		// Get combat-classified features from the combat module if available
		let combatFeatures = [];
		if (this._combat?.getCombatClassifiedFeatures) {
			combatFeatures = this._combat.getCombatClassifiedFeatures();
		} else {
			// Fallback: derive from overrides directly
			const features = this._state.getFeatures();
			const overrides = CharacterSheetState?.FEATURE_CLASSIFICATION_OVERRIDES || {};
			combatFeatures = features.filter(f => {
				const nameLower = f.name?.toLowerCase() || "";
				const cls = overrides[nameLower];
				return cls === "combat" || cls === "reaction";
			});
		}

		if (!combatFeatures) {
			section.style.display = "none";
			return;
		}

		section.style.display = "";
		container.innerHTML = "";

		for (const feature of combatFeatures) {
			const actionType = this._combat?._getFeatureActionType?.(feature) || "action";
			let actionIcon = "⚔️";
			let actionLabel = "Action";
			if (actionType === "bonus") { actionIcon = "⚡"; actionLabel = "Bonus"; } else if (actionType === "reaction") { actionIcon = "🔄"; actionLabel = "Reaction"; } else if (actionType === "free") { actionIcon = "✨"; actionLabel = "Free"; }

			// Resource cost display
			const desc = feature.description?.toLowerCase() || "";
			let costHtml = "";
			const kiMatch = desc.match(/(\d+)\s*ki\s*point/);
			const focusMatch = desc.match(/(\d+)\s*focus\s*point/);
			const staminaMatch = desc.match(/(\d+)\s*stamina/);
			if (kiMatch) costHtml = `<span class="ve-small ve-muted mr-1">${kiMatch[1]} Ki</span>`;
			else if (focusMatch) costHtml = `<span class="ve-small ve-muted mr-1">${focusMatch[1]} Focus</span>`;
			else if (staminaMatch) costHtml = `<span class="ve-small ve-muted mr-1">${staminaMatch[1]} Stamina</span>`;

			// Uses display
			let usesHtml = "";
			if (feature.uses && feature.uses.max > 0) {
				const rechargeIcon = feature.uses.recharge === "short" ? "☀️" : "🌙";
				usesHtml = `<span class="ve-small ve-muted mr-1">${feature.uses.current}/${feature.uses.max} ${rechargeIcon}</span>`;
			}

			const row = e_({outer: `
				<div class="charsheet__action-row ve-flex-v-center py-1 px-2 mb-1 rounded"
					style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b)); cursor: pointer;">
					<span class="mr-2" title="${actionLabel}">${actionIcon}</span>
					<span class="charsheet__action-name flex-grow-1" style="min-width: 0;">${feature.name}</span>
					<div class="ve-flex-v-center ml-auto">
						<span class="badge badge-outline-secondary ve-small mr-1">${actionLabel}</span>
						${costHtml}${usesHtml}
					</div>
				</div>
			`});

			row.addEventListener("click", () => {
				if (this._combat?._showCombatActionModal) {
					this._combat._showCombatActionModal(feature);
				}
			});

			container.append(row);
		}
	}

	// #region Favourites (Overview)

	/**
	 * Build the favourite-data payload for an entity, used by `_renderFavouriteStar`
	 * and `toggleFavorite`. Centralised so every star/unstar/lookup uses an identical
	 * `id` shape (`type:idOrName`) and consistent display fields.
	 */
	_buildFavouriteData (type, entity, {nameOverride = null, iconOverride = null, detailOverride = null} = {}) {
		if (!type || !entity) return null;
		const idSuffix = entity.id || entity.name;
		const ICONS = {
			attack: "⚔️",
			spell: "✨",
			feature: "📜",
			customAbility: "💫",
			resource: "⚡",
			item: "🎒",
			optionalFeature: "🪄",
			combatTradition: "🥋",
			feat: "🌟",
		};
		return {
			id: `${type}:${idSuffix}`,
			type,
			name: nameOverride || entity.name,
			icon: iconOverride || ICONS[type] || "⭐",
			detail: detailOverride || null,
		};
	}

	/**
	 * Render a small ☆/★ star button that toggles favourite state for the given
	 * entity. Returns the button element so callers can append wherever they like.
	 *
	 * @param {string} type - Favourite type key (attack, spell, feature, etc.)
	 * @param {object} entity - The entity to star (must have id or name)
	 * @param {object} [opts] - Optional display overrides + behavioural hooks
	 * @param {string} [opts.nameOverride]
	 * @param {string} [opts.iconOverride]
	 * @param {string} [opts.detailOverride]
	 * @param {Function} [opts.onToggle] - Optional callback invoked after a successful toggle
	 * 	(after state save + Overview re-render). Use this to refresh the host surface
	 * 	so the star badge updates without a tab switch.
	 */
	_renderFavouriteStar (type, entity, opts = {}) {
		const favData = this._buildFavouriteData(type, entity, opts);
		if (!favData) return null;
		const idSuffix = favData.id.slice(favData.id.indexOf(":") + 1);
		const isStarred = this._state.isFavorite(type, idSuffix);

		const btn = e_({
			tag: "button",
			clazz: `ve-btn ve-btn-xs ve-btn-default charsheet__fav-star${isStarred ? " charsheet__fav-star--active" : ""}`,
			attrs: {
				title: isStarred ? `Unstar "${favData.name}" (remove from Favourites)` : `Star "${favData.name}" (add to Favourites)`,
				"aria-pressed": isStarred ? "true" : "false",
				"aria-label": isStarred ? `Unstar ${favData.name}` : `Star ${favData.name}`,
			},
			html: isStarred ? "★" : "☆",
		});
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const result = this._state.toggleFavorite(favData);
			if (!result) {
				JqueryUtil.doToast({type: "warning", content: "Maximum 8 favourites. Remove one first."});
				return;
			}
			this._saveCurrentCharacter();
			this._renderFavouritesOverview();
			// Re-render the host panel so the star reflects new state.
			this._renderResources();
			this._renderOverviewAbilities();
			if (typeof opts.onToggle === "function") {
				// eslint-disable-next-line no-console
				try { opts.onToggle(result); } catch (err) { console.error("[CharSheet] favourite-star onToggle error:", err); }
			}
		});
		return btn;
	}

	// Back-compat shim: legacy callers / external code may still reference the "pin" name.
	_renderFavouritePin (type, entity, opts = {}) { return this._renderFavouriteStar(type, entity, opts); }

	_renderFavouritesOverview () {
		const container = document.getElementById("charsheet-favourites-list");
		const cleanupBtn = document.getElementById("charsheet-favourites-cleanup");
		if (!container) return;

		container.innerHTML = "";

		const favs = this._state.getFavorites();
		const orphans = this._state.getOrphanedFavorites();

		// Cleanup button visibility (orphans only)
		if (cleanupBtn) {
			if (orphans.length) {
				cleanupBtn.classList.remove("ve-hidden");
				cleanupBtn.textContent = `Clean up ${orphans.length} missing pin${orphans.length === 1 ? "" : "s"}`;
				if (!(/** @type {*} */ (cleanupBtn))._charsheetBound) {
					(/** @type {*} */ (cleanupBtn))._charsheetBound = true;
					cleanupBtn.addEventListener("click", () => {
						const removed = this._state.cleanupOrphanedFavorites();
						if (removed > 0) {
							this._saveCurrentCharacter();
							JqueryUtil.doToast({type: "info", content: `Removed ${removed} missing pin${removed === 1 ? "" : "s"}.`});
							this._renderFavouritesOverview();
						}
					});
				}
			} else {
				cleanupBtn.classList.add("ve-hidden");
			}
		}

		// Filter out orphans for display (they're handled by the cleanup button)
		const live = favs.filter(f => this._state.isFavoriteResolved(f));

		if (!live.length) {
			container.innerHTML = `
				<div class="charsheet__empty-state">
					<span class="charsheet__empty-icon">⭐</span>
					<span class="charsheet__empty-text">Click ☆ on any feature, attack, spell, or item to pin it here</span>
				</div>
			`;
			return;
		}

		for (const fav of live) {
			const tile = this._renderFavouriteTile(fav);
			if (tile) container.append(tile);
		}
	}

	_renderFavouriteTile (fav) {
		const resolution = this._state._resolveFavorite(fav);
		if (!resolution?.found) return null;

		const entity = resolution.entity;
		const detail = resolution.detail || "";
		const name = entity.name || fav.name;
		const icon = fav.icon || "⭐";

		// Build a hover-linked name when the entity has a canonical 5etools page
		// (spells, items, feats, optional features, class features, …). Falls back
		// to a plain escaped string for surfaces that have no underlying entry
		// (custom abilities, ad-hoc resources, free-form attacks).
		const nameHtml = this._getFavouriteNameHtml(fav, entity, name);

		const tile = e_({outer: `
			<div class="charsheet__favourite-tile" data-fav-type="${fav.type}" data-fav-id="${(fav.id || "").replace(/"/g, "&quot;")}">
				<div class="charsheet__favourite-tile__main">
					<span class="charsheet__favourite-tile__icon">${icon}</span>
					<div class="charsheet__favourite-tile__info">
						<span class="charsheet__favourite-tile__name">${nameHtml}</span>
						${detail ? `<span class="charsheet__favourite-tile__detail">${String(detail).replace(/</g, "&lt;")}</span>` : ""}
					</div>
				</div>
				<div class="charsheet__favourite-tile__actions"></div>
			</div>
		`});

		const actions = tile.querySelector(".charsheet__favourite-tile__actions");

		// Per-type primary action button
		const action = this._buildFavouriteActionButton(fav, entity);
		if (action) actions.append(action);

		// Always-present remove (✕) button
		const removeBtn = e_({
			tag: "button",
			clazz: "ve-btn ve-btn-xs ve-btn-danger charsheet__favourite-tile__remove",
			attrs: {title: "Remove from Favourites", "aria-label": `Remove ${name} from Favourites`},
			html: "✕",
		});
		removeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			// For item favourites, also clear the inventory `starred` flag so the
			// inventory tab's star icon stays in sync (the centralised favourites
			// list and the per-item starred flag are kept consistent by this
			// bridge — see `_toggleStarred` in charactersheet-inventory.js).
			if (fav.type === "item") {
				const idSuffix = fav.id?.includes(":") ? fav.id.slice(fav.id.indexOf(":") + 1) : "";
				const entry = (this._state._data?.inventory || []).find(i => i.id === idSuffix);
				if (entry?.starred && typeof this._state.toggleItemStarred === "function") {
					this._state.toggleItemStarred(entry.id);
				}
			}
			this._state.removeFavorite(fav.id);
			this._saveCurrentCharacter();
			this._renderFavouritesOverview();
			this._renderResources();
			this._renderOverviewAbilities();
			// Re-render the surface that owns the unstarred entity so its ☆/★
			// glyph flips back to "off". Without this, the star button keeps
			// its stale "active" appearance until the next manual re-render,
			// even though the favourites list is correct.
			this._refreshSurfaceForFavourite(fav);
		});
		actions.append(removeBtn);

		return tile;
	}

	/**
	 * Re-render whichever in-page list owns the entity behind a favourite,
	 * so that the per-row star button (☆/★) reflects the current
	 * `_data.favorites[]` membership. Defensive — silently skips surfaces
	 * that haven't been initialised yet (e.g. during early page boot or when
	 * a sub-module is unavailable in a test harness).
	 *
	 * @param {object} fav - The favourite record (`{id, type, ...}`)
	 */
	_refreshSurfaceForFavourite (fav) {
		try {
			switch (fav?.type) {
				case "attack":
					this._renderAttacks?.();
					break;
				case "spell":
					this._spells?._renderSpellList?.();
					break;
				case "feature":
				case "optionalFeature":
				case "feat":
				case "combatTradition":
					this._features?.render?.();
					break;
				case "item":
					this._inventory?._renderItemList?.();
					break;
				case "customAbility":
					this._customAbilities?.render?.();
					break;
				case "resource":
					this._renderResources?.();
					break;
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[CharSheet Favourites] surface re-render error:", e);
		}
	}

	/**
	 * Build a primary action button for a favourite tile based on its type.
	 * Returns null for types without a meaningful one-click action — those tiles
	 * still get the ✕ remove button.
	 */
	_buildFavouriteActionButton (fav, entity) {
		const make = (label, klass, handler, {title = null} = {}) => {
			const btn = e_({
				tag: "button",
				clazz: `ve-btn ve-btn-xs ${klass} charsheet__favourite-tile__action`,
				attrs: title ? {title} : {},
				html: label,
			});
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				try { handler(); } catch (err) {
					// eslint-disable-next-line no-console
					console.warn("[CharSheet Favourites] action handler error:", err);
				}
			});
			return btn;
		};

		switch (fav.type) {
			case "attack":
				return make("🎲 Roll", "ve-btn-primary", () => this._rollAttack(entity, null), {title: "Roll attack"});
			case "spell":
				return make("✨ Cast", "ve-btn-primary", () => {
					if (this._spells?._castSpell) this._spells._castSpell(entity.id);
					else this.switchToTab("#charsheet-tab-spells");
				}, {title: "Cast spell"});
			case "feature": {
				const hasUses = entity.uses && (entity.uses.max ?? 0) > 0;
				if (!hasUses) return null;
				const canUse = (entity.uses.current ?? 0) > 0;
				const btn = make("Use", "ve-btn-primary", () => {
					if (this._state.useFeature?.(entity.id || entity.name)) {
						this._saveCurrentCharacter();
						this._renderFavouritesOverview();
						this._renderOverviewAbilities();
						if (this._features) this._features.render();
					}
				}, {title: "Use feature charge"});
				if (!canUse) (/** @type {HTMLButtonElement} */ (btn)).disabled = true;
				return btn;
			}
			case "customAbility": {
				const usesDisplay = this._state.getCustomAbilityUsesDisplay?.(entity.id);
				if (!usesDisplay) return null;
				return make("Use", "ve-btn-primary", () => {
					if (this._state.useCustomAbility?.(entity.id)) {
						this._saveCurrentCharacter();
						this._renderFavouritesOverview();
						this._renderOverviewAbilities();
						if (this._customAbilities) this._customAbilities.render();
					}
				}, {title: "Use ability charge"});
			}
			case "resource":
				if ((entity.max ?? 0) <= 0) return null;
				return make("Use", "ve-btn-primary", () => this._useOverviewResource(entity), {title: "Spend one charge"});
			case "item":
			case "optionalFeature":
			case "feat":
			case "combatTradition":
				// Name itself is now a hover-link to the entity's stat page (see
				// `_getFavouriteNameHtml`), so the redundant "View" tab-switch
				// buttons would just duplicate functionality and clutter the tile.
				return null;
			default:
				return null;
		}
	}

	/**
	 * Build the inner HTML for a favourite tile's name. Returns a hover link
	 * pointing at the entity's canonical 5etools page when one is available
	 * (so users get the standard hover preview without leaving the sheet),
	 * otherwise returns an HTML-escaped plain name. All branches are
	 * defensive — a missing source or a thrown hash-builder error must never
	 * prevent the tile from rendering, so failures fall back to plain text.
	 *
	 * @param {object} fav - The favourite record (`{id, type, name, ...}`)
	 * @param {object} entity - The resolved entity from `_resolveFavorite`
	 * @param {string} name - Display name (already resolved with overrides)
	 * @returns {string} HTML string safe for innerHTML
	 */
	_getFavouriteNameHtml (fav, entity, name) {
		const escaped = String(name).replace(/</g, "&lt;");
		try {
			switch (fav.type) {
				case "spell": {
					if (!entity?.source) return escaped;
					return this.getHoverLink(UrlUtil.PG_SPELLS, entity.name, entity.source);
				}
				case "item": {
					// Inventory entries wrap the underlying item under `entity.item`.
					const itm = entity?.item || entity;
					const itemName = itm?.name || entity?.name || name;
					const itemSource = itm?.source || entity?.source;
					if (!itemSource) return escaped;
					return this.getHoverLink(UrlUtil.PG_ITEMS, itemName, itemSource, null, escaped);
				}
				case "feat": {
					if (!entity?.source) return escaped;
					return this.getHoverLink(UrlUtil.PG_FEATS, entity.name, entity.source);
				}
				case "feature":
				case "optionalFeature": {
					// Reuse the existing feature-aware hover-link builder, which
					// handles class features (with the right class hash), species,
					// background, and optional-feature/combat-method routing.
					if (typeof this._getFeatureHoverLink === "function") {
						const html = this._getFeatureHoverLink(entity);
						if (html && html !== entity?.name) return html;
					}
					return escaped;
				}
				case "combatTradition": {
					const source = entity?.source || Parser.SRC_XPHB;
					try {
						return this.getHoverLink(UrlUtil.PG_COMBAT_METHODS, entity.name, source);
					} catch (e) { return escaped; }
				}
				default:
					// attack / customAbility / resource — no canonical entry page.
					return escaped;
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[CharSheet Favourites] name-link error:", e);
			return escaped;
		}
	}
	// #endregion

	_renderActiveStates () {
		const container = document.getElementById("charsheet-active-states");
		container.innerHTML = "";

		const activeStates = this._state.getActiveStates();
		const activatableFeatures = this._state.getActivatableFeatures();
		const concentration = this._state.getConcentration();

		// Filter out condition-derived states (they're shown in the Conditions section)
		const nonConditionStates = activeStates.filter(s => !s.isCondition);

		// Get currently active state type IDs
		const activeStateTypeIds = new Set(nonConditionStates.filter(s => s.active).map(s => s.stateTypeId));

		// === Section 1: Currently Active States ===
		const hasActiveStates = nonConditionStates.some(s => s.active) || concentration;

		if (hasActiveStates) {
			const activeSection = e_({outer: `<div class="charsheet__active-states-section mb-3">
				<div class="charsheet__section-subtitle ve-flex-v-center mb-1">
					<span class="ve-small ve-bold text-success">● Currently Active</span>
				</div>
			</div>`});

			// Render active states
			nonConditionStates.filter(s => s.active).forEach(state => {
				const stateType = CharacterSheetState.ACTIVE_STATE_TYPES[state.stateTypeId];
				const row = this._renderActiveStateRow(state, stateType, true);
				activeSection.append(row);
			});

			// Show concentration if active
			if (concentration) {
				const concRow = e_({outer: `
					<div class="charsheet__state-row charsheet__state--active">
						<span class="charsheet__state-icon">🔮</span>
						<span class="charsheet__state-name">Concentrating: ${concentration.spellName || "Unknown"}</span>
						<div class="charsheet__state-controls ml-auto">
							<button class="ve-btn ve-btn-xs ve-btn-warning charsheet__end-concentration-btn">End</button>
						</div>
					</div>
				`});
				concRow.querySelector(".charsheet__end-concentration-btn").addEventListener("click", () => {
					this._state.breakConcentration();
					this._saveCurrentCharacter();
					this._renderActiveStates();
				});
				activeSection.append(concRow);
			}

			container.append(activeSection);
		}

		// === Section 2: Available Activatable Features ===
		// Show features that can be activated but aren't currently active
		// Filter out limited-use custom abilities - they're shown in Resources section
		const availableFeatures = activatableFeatures.filter(af => {
			if (af.isActive) return false;
			// Exclude limited-use custom abilities (shown in Resources)
			if (af.feature?.isCustomAbility) {
				const customAbility = this._state.getCustomAbility?.(af.feature.id);
				if (customAbility?.mode === "limited") return false;
			}
			return true;
		});

		if (availableFeatures.length > 0 || !hasActiveStates) {
			const availableSection = e_({outer: `<div class="charsheet__activatable-section">
				<div class="charsheet__section-subtitle ve-flex-v-center mb-1">
					<span class="ve-small ve-muted">Available to Activate</span>
				</div>
			</div>`});

			if (availableFeatures.length === 0) {
				availableSection.append(e_({outer: `<div class="ve-muted ve-small ve-text-center py-1">No activatable features</div>`}));
			} else {
				availableFeatures.forEach(({feature, activationInfo, resource, stateTypeId}) => {
					const stateType = activationInfo.stateType || CharacterSheetState.ACTIVE_STATE_TYPES[stateTypeId];
					// For custom abilities, use the ability's icon; otherwise use state type icon
					const isCustomAbility = feature.isCustomAbility;
					const customAbility = isCustomAbility ? this._state.getCustomAbility?.(feature.id) : null;
					const icon = customAbility?.icon || stateType?.icon || "⚡";
					// Use resource cost from description detection, or resource object, or default
					const resourceCost = resource?.cost || activationInfo.staminaCost || stateType?.resourceCost || 1;
					const hasResourceAvailable = !resource || resource.current >= resourceCost;

					// Determine if this is a limited-use ability (uses up charges, doesn't stay active)
					const interactionMode = activationInfo.interactionMode || (activationInfo.isToggle ? "toggle" : "limited");
					const isLimitedUse = customAbility?.mode === "limited"
						|| interactionMode === "limited"
						|| interactionMode === "trigger"
						|| interactionMode === "instant"
						|| activationInfo.isInstant;
					const buttonText = isLimitedUse ? "Use" : "Activate";

					// Get activation action type
					const activationAction = activationInfo.activationAction || stateType?.activationAction;
					const actionLabel = this._getActionLabel(activationAction);

					// Create hoverable feature name link
					const featureNameHtml = this._getFeatureHoverLink(feature);

					// Build resource info string
					let resourceInfo = "";
					let resourceTooltip = "";
					if (resource) {
						resourceInfo = `${resource.current}/${resource.max} ${resource.name}`;
						resourceTooltip = `Uses ${resourceCost} ${resource.name} (${resource.current}/${resource.max} remaining)`;
					} else if (activationInfo.staminaCost) {
						resourceInfo = `${resourceCost} Stamina`;
						resourceTooltip = `Costs ${resourceCost} Stamina`;
					}

					const row = e_({outer: `
						<div class="charsheet__activatable-row ve-flex-v-center py-1 px-2 mb-1 rounded" 
							style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b));">
							<span class="charsheet__state-icon mr-2">${icon}</span>
							<div class="ve-flex-col flex-grow-1" style="min-width: 0;">
								<span class="charsheet__state-name">${featureNameHtml}</span>
							</div>
							<div class="charsheet__state-controls ml-auto ve-flex-v-center">
								${actionLabel ? `<span class="ve-small ve-muted mr-1">${actionLabel}</span>` : ""}
								${resourceInfo ? `<span class="ve-small ve-muted mr-2" title="${resourceTooltip}">${resourceInfo}</span>` : ""}
								<button class="ve-btn ve-btn-xs ve-btn-success charsheet__activate-btn" 
									${!hasResourceAvailable ? `disabled title="Not enough ${resource?.name || "uses"} remaining"` : ""}>
									${buttonText}
								</button>
							</div>
						</div>
					`});

					row.querySelector(".charsheet__activate-btn").addEventListener("click", () => {
						this._activateFeatureState(feature, stateTypeId, stateType, resource, resourceCost, activationInfo);
					});

					availableSection.append(row);
				});
			}

			container.append(availableSection);
		}

		// === Section 3: Inactive/Ended States (can be removed) ===
		const endedStates = nonConditionStates.filter(s => !s.active);
		if (endedStates.length > 0) {
			const endedSection = e_({outer: `<div class="charsheet__ended-states-section mt-2">
				<div class="charsheet__section-subtitle ve-flex-v-center mb-1">
					<span class="ve-small ve-muted">Ended (click to remove)</span>
				</div>
			</div>`});

			endedStates.forEach(state => {
				const stateType = CharacterSheetState.ACTIVE_STATE_TYPES[state.stateTypeId];
				const row = e_({outer: `
					<div class="charsheet__state-row charsheet__state--inactive ve-small py-1">
						<span class="charsheet__state-icon">${state.icon || stateType?.icon || "⚡"}</span>
						<span class="charsheet__state-name ve-muted">${state.name}</span>
						<div class="charsheet__state-controls ml-auto">
							<button class="ve-btn ve-btn-xs ve-btn-default charsheet__reactivate-btn mr-1" title="Reactivate">↻</button>
							<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__remove-btn" title="Remove">×</button>
						</div>
					</div>
				`});

				row.querySelector(".charsheet__reactivate-btn").addEventListener("click", () => {
					this._state.activateState(state.stateTypeId);
					this._saveCurrentCharacter();
					this._renderActiveStates();
					this._renderCharacter();
				});

				row.querySelector(".charsheet__remove-btn").addEventListener("click", () => {
					this._state.removeActiveState(state.id);
					this._saveCurrentCharacter();
					this._renderActiveStates();
				});

				endedSection.append(row);
			});

			container.append(endedSection);
		}

		// === Section 4: Quick Actions (Dodge, etc.) ===
		// Check if character has Reckless Attack (barbarian level 2+)
		const barbarianClass = this._state._data.classes?.find(c => c.name?.toLowerCase() === "barbarian");
		const hasRecklessAttack = barbarianClass && barbarianClass.level >= 2;

		// Get hover attributes for Dodge action
		const dodgeHoverAttrs = this._getActionHoverAttrs("Dodge");

		const quickActions = e_({outer: `<div class="charsheet__quick-actions mt-2 pt-2 border-top">
			<span class="ve-small ve-muted mr-2">Quick:</span>
			<button class="ve-btn ve-btn-xs ${activeStateTypeIds.has("dodge") ? "ve-btn-warning" : "ve-btn-default"} mr-1 charsheet__toggle-dodge-btn" ${dodgeHoverAttrs}>
				💨 ${activeStateTypeIds.has("dodge") ? "End Dodge" : "Dodge"}
			</button>
			${hasRecklessAttack ? `<button class="ve-btn ve-btn-xs ${activeStateTypeIds.has("recklessAttack") ? "ve-btn-warning" : "ve-btn-default"} mr-1 charsheet__toggle-reckless-btn" title="Reckless Attack: You gain advantage on melee weapon attack rolls using Strength, but attack rolls against you have advantage until your next turn.">
				⚡ ${activeStateTypeIds.has("recklessAttack") ? "End Reckless" : "Reckless"}
			</button>` : ""}
			<button class="ve-btn ve-btn-xs ve-btn-default charsheet__apply-buff-btn" title="Apply a buff spell cast on you (e.g. Aid, Bless, Haste). Useful for non-casters tracking party buffs.">
				✨ Apply Buff
			</button>
		</div>`});

		quickActions.querySelector(".charsheet__toggle-dodge-btn").addEventListener("click", () => {
			if (this._state.isStateTypeActive("dodge")) {
				this._state.deactivateState("dodge");
			} else {
				this._state.activateState("dodge");
			}
			this._saveCurrentCharacter();
			this._renderActiveStates();
			this._renderCharacter();
		});

		if (hasRecklessAttack) {
			quickActions.querySelector(".charsheet__toggle-reckless-btn").addEventListener("click", () => {
				if (this._state.isStateTypeActive("recklessAttack")) {
					this._state.deactivateState("recklessAttack");
				} else {
					this._state.activateState("recklessAttack");
				}
				this._saveCurrentCharacter();
				this._renderActiveStates();
				this._renderCharacter();
			});
		}

		quickActions.querySelector(".charsheet__apply-buff-btn").addEventListener("click", () => {
			this._showApplyBuffModal();
		});

		container.append(quickActions);

		// Sync combat tab's active states, defenses, and effects display
		this._combat?.renderCombatStates?.();
		this._combat?.renderCombatDefenses?.();
		this._combat?.renderCombatEffects?.();
	}

	/**
	 * Show the Apply Buff picker modal — a flat list of every spell in
	 * `SPELL_BUFF_REGISTRY` so non-casters can track buffs cast on them by
	 * party members (Aid, Bless, Haste, Heroes' Feast, etc.). Refusing to
	 * stack: if a spell with the same name is already active as a spell
	 * effect, the picker rejects activation with a toast — toggle the existing
	 * one off first to "re-cast" it. Upcast scaling is exposed via a
	 * "Slots above base" input that multiplies any `upcastPerLevel` numeric
	 * effects (currently this covers `hpMaxIncrease` and `tempHp`).
	 *
	 * Mirrors the activateState payload built by the spell-cast flow in
	 * charactersheet-spells.js so downstream consumers (HP calc, attacks,
	 * AC stacking, etc.) treat picker-applied buffs identically to those
	 * the caster applies on themselves.
	 * @private
	 */
	_showApplyBuffModal () {
		const registry = CharacterSheetState.SPELL_BUFF_REGISTRY || {};
		const entries = Object.entries(registry)
			.map(([key, spec]) => ({key, displayName: key.replace(/\b\w/g, c => c.toUpperCase()), spec}))
			.sort((a, b) => a.displayName.localeCompare(b.displayName));

		const {eleModalInner: modalInner, doClose} = UiUtil.getShowModal({
			title: "Apply Buff",
			isMinHeight0: true,
			isHeight100: true,
		});

		modalInner.insertAdjacentHTML("beforeend", `
			<div class="ve-flex-col w-100">
				<div class="mb-2 ve-small ve-muted">Pick a buff cast on you. Effects with mechanical handlers (HP, AC, attack/save bonuses, advantage, etc.) are applied automatically. Notes-only buffs surface as a tracked active state.</div>
				<input type="search" class="ve-form-control mb-2 charsheet__apply-buff-search" placeholder="Search buff name…" />
				<div class="charsheet__apply-buff-list ve-overflow-y-auto" style="max-height: 60vh;"></div>
			</div>
		`);

		const searchInput = modalInner.querySelector(".charsheet__apply-buff-search");
		const listEl = modalInner.querySelector(".charsheet__apply-buff-list");

		const renderList = (filterText = "") => {
			listEl.innerHTML = "";
			const filter = filterText.trim().toLowerCase();
			const filtered = entries.filter(e => !filter || e.displayName.toLowerCase().includes(filter));
			if (filtered.length === 0) {
				listEl.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-text-center py-3">No matching buffs.</div>`);
				return;
			}
			filtered.forEach(({key, displayName, spec}) => {
				const row = this._buildApplyBuffRow({key, displayName, spec, doClose});
				listEl.append(row);
			});
		};

		searchInput.addEventListener("input", () => renderList(searchInput.value));
		renderList();
		setTimeout(() => searchInput.focus(), 0);
	}

	/**
	 * Build a single picker row for a SPELL_BUFF_REGISTRY entry.
	 * @private
	 */
	_buildApplyBuffRow ({key, displayName, spec, doClose}) {
		const selfEffects = Array.isArray(spec.selfEffects) ? spec.selfEffects : [];
		const summary = this._summariseBuffEffects(selfEffects);
		const durationStr = this._formatBuffDuration(spec.duration, spec.concentration);
		const upcastNumericKeys = spec.upcastPerLevel
			? Object.keys(spec.upcastPerLevel).filter(k => typeof spec.upcastPerLevel[k] === "number")
			: [];
		const hasNumericUpcast = upcastNumericKeys.length > 0;

		const row = e_({outer: `
			<div class="charsheet__apply-buff-row p-2 mb-2 border" style="border-radius: 4px;">
				<div class="ve-flex-v-center mb-1">
					<strong class="mr-2">${displayName.escapeQuotes()}</strong>
					${spec.concentration ? `<span class="ve-small ve-muted mr-2" title="Requires concentration">🔮 Conc.</span>` : ""}
					<span class="ve-small ve-muted ml-auto">${(/** @type {*} */ (durationStr)).escapeQuotes()}</span>
				</div>
				<div class="ve-small ve-muted mb-2">${summary}</div>
				<div class="ve-flex-v-center charsheet__apply-buff-row-controls"></div>
			</div>
		`});

		const controls = row.querySelector(".charsheet__apply-buff-row-controls");

		let upcastInput = null;
		if (hasNumericUpcast) {
			const upcastWrap = e_({outer: `
				<label class="ve-flex-v-center mr-2 ve-small ve-muted mb-0">
					Slots above base:
					<input type="number" min="0" max="9" value="0" class="ve-form-control form-control--minimal ve-input-xs ml-1" style="width: 50px;">
				</label>
			`});
			upcastInput = upcastWrap.querySelector("input");
			controls.append(upcastWrap);
		}

		const applyBtn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-primary ml-auto">Apply</button>`});
		applyBtn.addEventListener("click", () => {
			const upcastDelta = upcastInput ? Math.max(0, parseInt(upcastInput.value, 10) || 0) : 0;
			const ok = this._applyBuffFromRegistry({key, displayName, spec, upcastDelta});
			if (ok) doClose();
		});
		controls.append(applyBtn);

		return row;
	}

	/**
	 * Apply a registry buff to the character by activating a custom spell-effect state.
	 * Honours stacking-rejection: if a spell-effect state with the same name is
	 * already active, refuses with a toast so the user must explicitly toggle off
	 * the existing one (matching the rule that buff spells of the same name don't stack).
	 * @returns {boolean} true on apply, false on stacking refusal
	 * @private
	 */
	_applyBuffFromRegistry ({key, displayName, spec, upcastDelta = 0}) {
		const existing = this._state.getActiveStates?.()?.find(s => s.active && s.isSpellEffect && (s.name || "").toLowerCase() === displayName.toLowerCase());
		if (existing) {
			JqueryUtil.doToast({type: "warning", content: `${displayName} is already active — toggle it off first to re-apply.`});
			return false;
		}

		const customEffects = (spec.selfEffects || []).map(eff => {
			const out = {...eff};
			if (upcastDelta > 0 && spec.upcastPerLevel) {
				// Apply per-level scaling for known numeric effect types.
				if (out.type === "hpMaxIncrease" && typeof spec.upcastPerLevel.hpMaxIncrease === "number") {
					out.value = (out.value || 0) + spec.upcastPerLevel.hpMaxIncrease * upcastDelta;
				} else if (out.type === "tempHp" && typeof spec.upcastPerLevel.tempHp === "number") {
					out.value = (out.value || 0) + spec.upcastPerLevel.tempHp * upcastDelta;
				}
				// Other upcast keys (e.g. extraDamageDice) are out of scope for this picker.
			}
			return out;
		});

		this._state.activateState("custom", {
			name: displayName,
			icon: spec.concentration ? "🔮" : "✨",
			description: `Spell effect: ${displayName}`,
			sourceFeatureId: `spell_${key}_${Date.now()}`,
			customEffects,
			isSpellEffect: true,
			concentration: !!spec.concentration,
			duration: spec.duration,
		});

		this._saveCurrentCharacter();
		this._renderActiveStates();
		this._renderCharacter();
		JqueryUtil.doToast({type: "success", content: `Applied ${displayName}.`});
		return true;
	}

	/**
	 * Human-readable summary for a buff's selfEffects array. Falls back to a
	 * generic note when no effect type is recognised by the picker — the state
	 * still tracks duration/concentration even when the effect is opaque.
	 * @private
	 */
	_summariseBuffEffects (effects) {
		if (!effects || !effects.length) return "Tracks duration only.";
		const parts = [];
		for (const eff of effects) {
			switch (eff.type) {
				case "hpMaxIncrease": parts.push(`+${eff.value} max HP`); break;
				case "tempHp": parts.push(`${eff.value} temp HP`); break;
				case "bonus": parts.push(`+${eff.value} ${eff.target}`); break;
				case "rollBonus": parts.push(`+${eff.dice} to ${eff.target} rolls`); break;
				case "rollPenalty": parts.push(`-${eff.dice} to ${eff.target} rolls`); break;
				case "setAc": parts.push(`AC = ${eff.baseAc}${eff.addDex ? " + DEX" : ""}`); break;
				case "minAc": parts.push(`AC minimum ${eff.value}`); break;
				case "advantage": parts.push(`adv. on ${eff.target}`); break;
				case "disadvantage": parts.push(`disadv. on ${eff.target}`); break;
				case "resistance": parts.push(`resistance to ${eff.target?.replace(/^damage:/, "")}`); break;
				case "immunity": parts.push(`immune to ${eff.target}`); break;
				case "speedMultiplier": parts.push(`speed ×${eff.value}`); break;
				case "flySpeed": parts.push(`fly speed ${eff.value} ft.`); break;
				case "extraDamage": parts.push(`+${eff.dice}${eff.damageType ? ` ${eff.damageType}` : ""} damage`); break;
				case "sense": parts.push(`${eff.target} ${eff.value} ft.`); break;
				case "note": parts.push(eff.value || ""); break;
				default: parts.push(eff.type); break;
			}
		}
		return parts.filter(Boolean).join(" · ");
	}

	/**
	 * Format a buff's duration object (or absence thereof) for display.
	 * @private
	 */
	_formatBuffDuration (duration, concentration) {
		if (!duration) return concentration ? "Concentration" : "—";
		if (typeof duration === "object" && duration.amount && duration.unit) {
			const unitLabel = duration.amount === 1 ? duration.unit : `${duration.unit}s`;
			const base = `${duration.amount} ${unitLabel}`;
			return concentration ? `Conc., up to ${base}` : base;
		}
		return concentration ? `Conc., ${duration}` : String(duration);
	}

	/**
	 * Get a short label for an activation action type
	 */
	_getActionLabel (actionType) {
		switch (actionType) {
			case "bonus": return "🎯 Bonus";
			case "action": return "⚔️ Action";
			case "reaction": return "↩️ Reaction";
			case "free": return "✨ Free";
			default: return "";
		}
	}

	/**
	 * Create a hover link for an activatable feature
	 * @param {object} feature - The feature object
	 * @returns {string} HTML string with hover attributes
	 */
	_getFeatureHoverLink (feature) {
		try {
			// Class features - link to class feature page
			if (feature.featureType === "Class" && feature.className) {
				const storedClass = this._state.getClasses().find(c => c.name?.toLowerCase() === feature.className?.toLowerCase());
				const classSource = feature.classSource || feature.source || storedClass?.source || Parser.SRC_XPHB;

				const hashInput = {
					name: feature.name,
					className: feature.className,
					classSource: classSource,
					level: feature.level || 1,
					source: feature.source || Parser.SRC_XPHB,
				};
				if (feature.subclassName || feature.isSubclassFeature) {
					hashInput.subclassShortName = feature.subclassShortName || feature.subclassName;
					hashInput.subclassSource = feature.subclassSource || storedClass?.subclass?.source || feature.source || Parser.SRC_XPHB;
				}
				const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASS_SUBCLASS_FEATURES](hashInput);
				const classHash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES]({name: feature.className, source: classSource});
				const classHref = `${UrlUtil.PG_CLASSES}#${classHash}`;
				return this.getHoverLink(UrlUtil.PG_CLASS_SUBCLASS_FEATURES, feature.name, feature.source || Parser.SRC_XPHB, hash, null, classHref);
			}
			// Optional features (invocations, combat methods, etc.)
			if (feature.featureType === "Optional Feature" || feature.optionalfeatureType) {
				const isCM = CharacterSheetClassUtils.isCombatMethod(feature);
				return this.getHoverLink(isCM ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES, feature.name, feature.source || Parser.SRC_XPHB);
			}
			// Species/Race features
			if (feature.featureType === "Species" || feature.featureType === "Race") {
				const race = this._state.getRace();
				if (race) {
					const hash = UrlUtil.encodeForHash([race.name, race.source || Parser.SRC_XPHB].join(HASH_LIST_SEP));
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_RACES, source: race.source || Parser.SRC_XPHB, hash});
					return `<a href="${UrlUtil.PG_RACES}#${hash}" ${hoverAttrs}>${feature.name}</a>`;
				}
			}
			// Background features - only create hover link for non-custom backgrounds
			if (feature.featureType === "Background") {
				const background = this._state.getBackground();
				if (background && background.source !== "Custom") {
					const hash = UrlUtil.encodeForHash([background.name, background.source || Parser.SRC_XPHB].join(HASH_LIST_SEP));
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BACKGROUNDS, source: background.source || Parser.SRC_XPHB, hash});
					return `<a href="${UrlUtil.PG_BACKGROUNDS}#${hash}" ${hoverAttrs}>${feature.name}</a>`;
				}
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[CharSheet] Error creating feature hover link:", e);
		}
		// Fallback: plain name
		return feature.name;
	}

	/**
	 * Strip HTML tags and 5etools formatting from text for clean display
	 */
	_stripHtmlTags (text) {
		if (!text) return "";
		return text
			// Remove 5etools {@tag content} formatting
			.replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, "$1")
			// Remove HTML tags
			.replace(/<[^>]*>/g, "")
			// Decode HTML entities
			.replace(/&quot;/g, "\"")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&#39;/g, "'")
			// Clean up extra whitespace
			.replace(/\s+/g, " ")
			.trim();
	}

	/**
	 * Render a single active state row
	 */
	_renderActiveStateRow (state, stateType, isActive) {
		const activeClass = isActive ? "charsheet__state--active" : "charsheet__state--inactive";
		const icon = state.icon || stateType?.icon || "⚡";

		// Check if this is a spell effect
		const isSpellEffect = state.isSpellEffect || state.sourceFeatureId?.startsWith("spell_");

		// Try to create hoverable name by finding the source feature or spell
		let nameHtml = state.name;
		if (isSpellEffect) {
			// Create spell hover link with charsheet modifications (metamagic, rarity)
			try {
				const source = state.spellSource || Parser.SRC_XPHB;
				const spellData = this._spellsData?.find(s => s.name === state.name && s.source === source);
				const characterSpell = this._state.getSpells?.().find(s => s.name === state.name && s.source === source);
				nameHtml = this.getSpellHoverLink(state.name, source, spellData || null, characterSpell || null);
			} catch (e) {
				// Fall back to plain name if hover fails
				nameHtml = state.name;
			}
		} else if (state.sourceFeatureId) {
			const feature = this._state.getFeatures().find(f => f.id === state.sourceFeatureId);
			if (feature) {
				nameHtml = this._getFeatureHoverLink(feature);
			}
		}

		// Build tooltip from stateType description/effects
		const tooltipParts = [];
		if (stateType?.description) tooltipParts.push(stateType.description);
		if (state.description) tooltipParts.push(state.description);
		if (stateType?.effects?.length) {
			const effectsStr = stateType.effects.map(e => e.type && e.target ? `${e.type} → ${e.target}` : e.type || "").filter(Boolean).join("; ");
			if (effectsStr) tooltipParts.push(`Effects: ${effectsStr}`);
		}
		if (state.customEffects?.length) {
			const effectsStr = state.customEffects.map(e => {
				if (e.target === "ac") return `+${e.value} AC`;
				if (e.type === "resistance") return `Resist ${(e.target || "").replace("damage:", "")}`;
				if (e.type === "immunity") return `Immune ${(e.target || "").replace("damage:", "")}`;
				if (e.dice) return `+${e.dice} to rolls`;
				return e.type || "";
			}).filter(Boolean).join("; ");
			if (effectsStr) tooltipParts.push(`Effects: ${effectsStr}`);
		}
		const tooltip = tooltipParts.join("\n");
		const tooltipAttr = tooltip.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

		// Check if this state can be ended (some passive states shouldn't be endable)
		const isEndable = this._isStateEndable(state, stateType) || isSpellEffect;

		// Build duration/reminder info for spell effects
		let durationHtml = "";
		if (isSpellEffect && state.duration) {
			if (state.duration.amount && state.duration.unit) {
				durationHtml = `<span class="ve-small ve-muted ml-2">(${state.duration.amount} ${state.duration.unit})</span>`;
			}
		}

		// Show concentration warning for spell effects
		let concentrationHtml = "";
		if (isSpellEffect && state.concentration) {
			concentrationHtml = `<span class="ve-small text-warning ml-1" title="Requires concentration">🔮</span>`;
		}

		// Show conditions granted by spell
		let grantsConditionsHtml = "";
		if (isSpellEffect && state.grantsConditions?.length > 0) {
			grantsConditionsHtml = `<span class="ve-small text-info ml-2" title="This spell grants these conditions">(Grants: ${state.grantsConditions.join(", ")})</span>`;
		}

		// C2: Show inline effect labels for non-spell active states (e.g. Patient Defense)
		let effectLabelsHtml = "";
		if (isActive && !isSpellEffect && stateType?.effects?.length) {
			const labels = stateType.effects.map(e => {
				if (e.type === "disadvantage" && e.target === "attacksAgainst") return "Attackers have disadvantage";
				if (e.type === "advantage" && e.target?.startsWith("save:")) {
					const abil = e.target.split(":")[1]?.toUpperCase() || "";
					return `Advantage on ${abil} saves`;
				}
				if (e.type === "advantage" && e.target === "attack") return "Advantage on attacks";
				if (e.type === "resistance") return `Resist ${(e.target || "").replace("damage:", "")}`;
				if (e.type === "ac") return `+${e.value || ""} AC`;
				return null;
			}).filter(Boolean);
			if (labels.length) {
				effectLabelsHtml = `<span class="ve-small ve-muted ml-2">${labels.join(" · ")}</span>`;
			}
		}

		// Style differently for spell effects
		const bgColor = isActive
			? (isSpellEffect ? "rgba(147, 51, 234, 0.15)" : "rgba(40, 167, 69, 0.1)")
			: "transparent";
		const borderColor = isActive
			? (isSpellEffect ? "var(--bs-purple, #6f42c1)" : "var(--bs-success, #28a745)")
			: "transparent";

		const row = e_({outer: `
			<div class="charsheet__state-row ${activeClass} ve-flex-v-center py-2 px-2 mb-1 rounded" 
				style="background: ${bgColor}; border: 1px solid ${borderColor};">
				<span class="charsheet__state-icon mr-2" style="font-size: 1.2em;" title="${tooltipAttr}">${icon}</span>
				<span class="charsheet__state-name ve-bold" title="${tooltipAttr}">${nameHtml}${concentrationHtml}</span>
				${effectLabelsHtml}${durationHtml}${grantsConditionsHtml}
				<div class="charsheet__state-controls ml-auto ve-flex-v-center">
					${isSpellEffect ? `<span class="ve-small ve-muted mr-2" title="Remember to end this when the spell ends">Spell Effect</span>` : ""}
					${isEndable ? `<button class="ve-btn ve-btn-xs ${isSpellEffect ? "ve-btn-danger" : "ve-btn-warning"} charsheet__end-state-btn">${isSpellEffect ? "End Spell" : "End"}</button>` : `<span class="ve-small ve-muted" title="This is a passive ability">Passive</span>`}
				</div>
			</div>
		`});

		if (isEndable) {
			row.querySelector(".charsheet__end-state-btn").addEventListener("click", () => {
				if (isSpellEffect) {
					// For spell effects that grant conditions, also remove those conditions
					if (state.grantsConditions?.length > 0) {
						for (const conditionName of state.grantsConditions) {
							this._state.removeCondition(conditionName);
						}
					}
					// Remove the spell effect state
					this._state.removeActiveState(state.id);
				} else {
					// Check if this is a custom ability state
					const customAbility = state.sourceFeatureId && this._state.getCustomAbilities?.()?.find(a => a.id === state.sourceFeatureId);
					if (customAbility) {
						// Toggle off the custom ability - this properly cleans up all effects
						this._state.toggleCustomAbility(customAbility.id);
						// Sync custom abilities panel
						this._customAbilitiesPanel?.render?.();
					} else {
						this._state.deactivateState(state.stateTypeId);
						// Bridge combat stance deactivation to the stance-specific system
						if (state.stateTypeId === "combatStance") {
							this._state.deactivateStance();
						}
					}
				}
				this._saveCurrentCharacter();
				this._renderActiveStates();
				this._renderCharacter();
			});
		}

		return row;
	}

	/**
	 * Check if a state can be manually ended
	 * Some passive features (like Tough, Unarmored Defense) shouldn't be endable
	 */
	_isStateEndable (state, stateType) {
		// If stateType explicitly says not endable
		if (stateType?.isPassive || stateType?.notEndable) return false;

		// If it has a resource cost, it's definitely endable (activated abilities)
		if (stateType?.resourceCost || stateType?.resourceName) return true;

		// Check source feature to see if it's a passive ability
		if (state.sourceFeatureId) {
			const feature = this._state.getFeatures().find(f => f.id === state.sourceFeatureId);
			if (feature) {
				const name = feature.name?.toLowerCase() || "";

				// Passive abilities that shouldn't be endable (truly passive, always-on effects)
				const passivePatterns = [
					/^unarmored defense$/i,
					/^tough$/i,
					/^durable$/i,
					/^observant$/i,
					/^alert$/i,
				];

				if (passivePatterns.some(p => p.test(name))) return false;
			}
		}

		return true;
	}

	/**
	 * Activate a feature's state, deducting resource cost if applicable
	 */
	_activateFeatureState (feature, stateTypeId, stateType, resource, resourceCost, activationInfo = null) {
		// Use passed cost, or fall back to state type default
		const cost = resourceCost || stateType?.resourceCost || 1;

		// Deduct resource cost if applicable
		if (resource && resource.current >= cost) {
			// Special handling for Stamina (tracked separately)
			if (resource.isStamina) {
				this._state.setStaminaCurrent(resource.current - cost);
			} else {
				this._state.setResourceCurrent(resource.id, resource.current - cost);
			}
		}

		// Handle custom abilities
		if (feature.isCustomAbility && feature.id) {
			// For limited-use custom abilities, just use (decrement) the ability
			// For toggleable custom abilities, toggle on/off
			const ability = this._state.getCustomAbilities?.()?.find(a => a.id === feature.id);
			if (ability) {
				if (ability.mode === "limited") {
					// Use the ability (decrement uses) - resource already deducted above if it exists
					// But if there's no external resource, use the built-in uses
					if (!resource) {
						this._state.useCustomAbility(feature.id);
					}
				} else if (ability.mode === "toggleable") {
					this._state.toggleCustomAbility(feature.id);
				}
			}
			this._saveCurrentCharacter();
			this._renderResources();
			this._renderActiveStates();
			this._customAbilitiesPanel?.render?.();
			this._combatModule?.renderCombatStates?.();
			this._renderCharacter();
			return;
		}

		const interactionMode = activationInfo?.interactionMode || (activationInfo?.isToggle ? "toggle" : "limited");

		// Passive features should not create active states.
		if (interactionMode === "passive") {
			this._saveCurrentCharacter();
			this._renderResources();
			this._renderActiveStates();
			this._renderCharacter();
			return;
		}

		// Determine if we need to parse effects from description
		// Parse effects for: custom states, generic state types (like combatStance), or state types with empty effects
		const shouldParseEffects = stateTypeId === "custom"
			|| !CharacterSheetState.ACTIVE_STATE_TYPES[stateTypeId]
			|| stateType?.isGeneric
			|| (stateType?.effects && stateType.effects.length === 0);

		const metadataEffects = activationInfo?.effects;
		const parsedEffects = shouldParseEffects
			? (metadataEffects?.length ? metadataEffects : CharacterSheetState.parseEffectsFromDescription(feature.description))
			: null;

		// Limited/trigger/instant abilities consume resources and may apply one-off effects,
		// but should not persist as toggle states.
		if (interactionMode === "limited" || interactionMode === "trigger" || interactionMode === "instant") {
			if (parsedEffects?.length) {
				this._state.addActiveState("custom", {
					name: feature.name,
					icon: "⚡",
					sourceFeatureId: feature.id,
					description: feature.description,
					customEffects: parsedEffects,
					duration: activationInfo?.duration || "Instant",
				});
			}

			this._saveCurrentCharacter();
			this._renderResources();
			this._renderActiveStates();
			this._renderCharacter();
			return;
		}

		// Activate the state
		if (stateTypeId === "custom" || !CharacterSheetState.ACTIVE_STATE_TYPES[stateTypeId]) {
			// Custom activatable - create a generic state
			this._state.addActiveState("custom", {
				name: feature.name,
				icon: "⚡",
				sourceFeatureId: feature.id,
				description: feature.description,
				customEffects: parsedEffects?.length > 0 ? parsedEffects : null,
			});
		} else {
			// For known state types, pass feature info but only use parsed effects for generic types
			const customData = {
				sourceFeatureId: feature.id,
				resourceId: resource?.id,
				name: feature.name,
				description: feature.description,
				// Only use parsed effects for generic state types (like combatStance)
				// Non-generic types (like recklessAttack, rage) use their predefined effects
				customEffects: shouldParseEffects && parsedEffects?.length > 0 ? parsedEffects : null,
			};
			this._state.activateState(stateTypeId, customData);
		}

		// Bridge combat stance activation to the stance-specific system
		if (stateTypeId === "combatStance") {
			this._state.activateStance(feature.name);
		}

		this._saveCurrentCharacter();
		this._renderResources();
		this._renderActiveStates();
		this._renderCharacter();
	}

	_renderAttacks () {
		const container = document.getElementById("charsheet-attacks");
		container.innerHTML = "";

		// Get configured attacks
		let attacks = [...this._state.getAttacks()];

		// Also add attacks from equipped weapons if not already configured
		const items = this._state.getItems();
		const equippedWeapons = items.filter(i => i.weapon && i.equipped);

		equippedWeapons.forEach(weapon => {
			// Check if we already have an attack for this weapon
			const existingAttack = attacks.find(a => a.name === weapon.name);
			if (!existingAttack) {
				// Auto-generate attack from weapon
				// Use property (5etools format) or properties (normalized format)
				const props = weapon.property || weapon.properties || [];
				const isRanged = props.some(p => p === "A" || p === "T" || p.startsWith("A|") || p.startsWith("T|"));
				const hasFinesse = props.some(p => p === "F" || p.startsWith("F|"));
				const isMonkWeapon = this._state.isMonkWeapon?.(weapon);
				const abilityMod = isRanged ? "dex" : ((hasFinesse || isMonkWeapon) ? (this._state.getAbilityMod("dex") >= this._state.getAbilityMod("str") ? "dex" : "str") : "str");

				// Calculate magic bonuses
				const attackBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
				const damageBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);

				// Extract raw damage die — prefer dmg1 (raw), fall back to parsing from formatted damage string
				let baseDamageDie = weapon.dmg1 || (weapon.damage ? weapon.damage.split(" ")[0] : null) || "1d6";
				let baseDamageType = weapon.dmgType
					? Parser.dmgTypeToFull(weapon.dmgType)
					: (weapon.damageType || (weapon.damage ? weapon.damage.split(" ").slice(1).join(" ") : null) || "slashing");

				// Monk weapon damage: use martial arts die if higher than weapon die
				if (isMonkWeapon) {
					const calc = this._state.getFeatureCalculations();
					if (calc.martialArtsDie) {
						const dieMatch = (d) => (d || "").match(/(\d+)d(\d+)/);
						const weaponMatch = dieMatch(baseDamageDie);
						const monkMatch = dieMatch(calc.martialArtsDie);
						if (weaponMatch && monkMatch) {
							const weaponMax = parseInt(weaponMatch[1]) * parseInt(weaponMatch[2]);
							const monkMax = parseInt(monkMatch[1]) * parseInt(monkMatch[2]);
							if (monkMax > weaponMax) baseDamageDie = calc.martialArtsDie;
						}
					}
				}

				const autoAttack = {
					id: `auto_${weapon.id}`,
					name: weapon.name,
					source: weapon.source, // For hoverable link
					isMelee: !isRanged,
					abilityMod,
					attackBonus: attackBonus,
					damage: baseDamageDie,
					damageType: baseDamageType,
					damageBonus: damageBonus,
					range: weapon.range || (isRanged ? "80/320 ft." : "5 ft."),
					properties: props,
					mastery: weapon.mastery || [],
					isMonkWeapon: !!isMonkWeapon,
				};
				attacks.push(autoAttack);
			}
		});

		if (!attacks) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No attacks. Equip weapons from Inventory.</div>`;
			return;
		}

		// Limit to 5 attacks for overview
		const displayAttacks = attacks.slice(0, 5);

		displayAttacks.forEach(attack => {
			const abilityMod = this._state.getAbilityMod(attack.abilityMod || "str");
			const profBonus = this._state.getProficiencyBonus();
			const totalAttackBonus = abilityMod + profBonus + (attack.attackBonus || 0);
			const totalDamageBonus = abilityMod + (attack.damageBonus || 0);
			const damageStr = totalDamageBonus >= 0
				? `${attack.damage}+${totalDamageBonus}`
				: `${attack.damage}${totalDamageBonus}`;

			// Format range
			const rangeStr = attack.range || (attack.isMelee ? "5 ft." : "");

			// Format properties (abbreviated)
			const propAbbrs = [];
			if (attack.properties?.length) {
				attack.properties.forEach(p => {
					const abbr = typeof p === "string" ? p.split("|")[0] : p;
					if (abbr && abbr.length <= 2) propAbbrs.push(abbr);
				});
			}
			const propsStr = propAbbrs.length ? `[${propAbbrs.join(", ")}]` : "";

			// Create hoverable weapon name
			let attackNameHtml = attack.name;
			if (attack.source) {
				try {
					const hash = UrlUtil.encodeForHash([attack.name, attack.source].join(HASH_LIST_SEP));
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_ITEMS, source: attack.source, hash: hash});
					attackNameHtml = `<a href="${UrlUtil.PG_ITEMS}#${hash}" ${hoverAttrs}>${attack.name}</a>`;
				} catch (e) {
					// Fall back to plain name
				}
			}

			const monkBadge = attack.isMonkWeapon ? ` <span class="badge badge-warning" title="Monk Weapon">Monk</span>` : "";

			const row = e_({outer: `
				<div class="charsheet__attack-row">
					<div class="charsheet__attack-info">
						<span class="charsheet__attack-name">${attackNameHtml}${monkBadge}</span>
						<span class="charsheet__attack-range ve-small ve-muted">${rangeStr} ${propsStr}</span>
					</div>
					<div class="charsheet__attack-stats">
						<span class="charsheet__attack-bonus" title="Attack Bonus">${this._formatMod(totalAttackBonus)}</span>
						<span class="charsheet__attack-damage" title="Damage">${damageStr} ${attack.damageType || ""}</span>
					</div>
					<button class="ve-btn ve-btn-primary ve-btn-xs charsheet__attack-btn" title="Roll Attack">
						<span class="glyphicon glyphicon-screenshot"></span> Roll
					</button>
				</div>
			`});

			row.querySelector("button").addEventListener("click", () => this._rollAttack(attack));

			// Star (favourite) toggle — append into the row's action area so users can
			// pin attacks (including weapon-derived auto-attacks) to the Overview.
			const star = this._renderFavouriteStar("attack", attack, {onToggle: () => this._renderAttacks()});
			if (star) row.append(star);

			container.append(row);
		});

		if (attacks.length > 5) {
			container.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small text-center">+${attacks.length - 5} more in Combat tab</div>`);
		}
	}

	_renderQuickSpells () {
		const container = document.getElementById("charsheet-quick-spells");
		if (!container) return;

		container.innerHTML = "";

		const spells = this._state.getSpells();
		if (!spells) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No spells. Add from Spells tab.</div>`;
			return;
		}

		// Get cantrips and prepared/known spells
		const cantrips = spells.filter(s => s.level === 0);
		const preparedSpells = spells.filter(s => s.level > 0 && s.prepared);

		// Show cantrips first (max 3), then prepared spells (max 4)
		const displayCantrips = cantrips.slice(0, 3);
		const displayPrepared = preparedSpells.slice(0, 4);

		// Show spell stats and slots summary — Gambler uses dice formula
		const calcs = this._state.getFeatureCalculations?.();
		const isGambler = calcs?.hasGamblerSpellcasting;
		const spellcastingAbility = this._state.getSpellcastingAbility() || (isGambler ? "cha" : null);
		if (spellcastingAbility) {
			let saveDCText, attackText, abilityText;
			if (isGambler) {
				saveDCText = calcs.gamblerSpellDcFormula;
				attackText = `+${calcs.gamblerSpellAttackFormula}`;
				abilityText = "CHA (Gambler)";
			} else {
				const spellMod = this._state.getAbilityMod(spellcastingAbility);
				const profBonus = this._state.getProficiencyBonus();
				const dcPenalty = this._getExhaustionDcPenalty();
				const saveDC = 8 + spellMod + profBonus - dcPenalty;
				const attackBonus = spellMod + profBonus;
				const dcPenaltyStr = dcPenalty > 0 ? ` <span class="ve-muted ve-small">(−${dcPenalty} exhaustion)</span>` : "";
				saveDCText = `${saveDC}${dcPenaltyStr}`;
				attackText = this._formatMod(attackBonus);
				abilityText = spellcastingAbility.toUpperCase();
			}
			container.insertAdjacentHTML("beforeend", `
				<div class="charsheet__spell-stats ve-flex ve-flex-wrap mb-2">
					<span class="ve-small mr-3"><strong>Save DC:</strong> ${saveDCText}</span>
					<span class="ve-small mr-3"><strong>Attack:</strong> ${attackText}</span>
					<span class="ve-small"><strong>Ability:</strong> ${abilityText}</span>
				</div>
			`);
		}

		// Show spell slots
		const slotsRow = e_({outer: `<div class="charsheet__spell-slots-row mb-2"><span class="charsheet__spell-slots-label">Spell Slots:</span></div>`});
		let hasSlots = false;
		for (let level = 1; level <= 9; level++) {
			const max = this._state.getSpellSlotsMax(level);
			if (max > 0) {
				hasSlots = true;
				const current = this._state.getSpellSlotsCurrent(level);
				slotsRow.insertAdjacentHTML("beforeend", `
					<div class="charsheet__spell-slot-box" title="Level ${level} spell slots">
						<span class="charsheet__spell-slot-level">${level}</span>
						<span class="charsheet__spell-slot-count ${current === 0 ? "ve-muted" : ""}">${current}/${max}</span>
					</div>
				`);
			}
		}
		// Also show pact slots if any
		const pactSlots = this._state.getPactSlots();
		if (pactSlots?.max > 0) {
			hasSlots = true;
			slotsRow.insertAdjacentHTML("beforeend", `
				<div class="charsheet__spell-slot-box charsheet__spell-slot-box--pact" title="Pact Magic slots (level ${pactSlots.level})">
					<span class="charsheet__spell-slot-level">P${pactSlots.level}</span>
					<span class="charsheet__spell-slot-count ${pactSlots.current === 0 ? "ve-muted" : ""}">${pactSlots.current}/${pactSlots.max}</span>
				</div>
			`);
		}
		if (hasSlots) {
			container.append(slotsRow);
		}

		// Helper to create hoverable spell name with charsheet modifications
		const getSpellLink = (spell) => {
			try {
				const source = spell.source || Parser.SRC_XPHB;
				const spellData = this._spellsData?.find(s => s.name === spell.name && s.source === source);
				return this.getSpellHoverLink(spell.name, source, spellData || null, spell);
			} catch (e) {
				return spell.name;
			}
		};

		if (displayCantrips.length) {
			container.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mb-1"><strong>Cantrips</strong></div>`);
			displayCantrips.forEach(spell => {
				const castTime = spell.castingTime || "1 action";
				const spellEl = e_({outer: `
					<div class="charsheet__quick-spell">
						<div class="charsheet__quick-spell-info">
							<span class="charsheet__quick-spell-name">${getSpellLink(spell)}</span>
							<span class="ve-small ve-muted">${castTime}</span>
						</div>
						<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__quick-spell-btn" title="Cast ${spell.name}">
							<span class="glyphicon glyphicon-flash"></span> Cast
						</button>
					</div>
				`});
				spellEl.querySelector("button").addEventListener("click", () => {
					if (this._spells) this._spells._castSpell(spell.id);
				});
				container.append(spellEl);
			});
		}

		if (displayPrepared.length) {
			container.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mb-1 mt-2"><strong>Prepared Spells</strong></div>`);
			displayPrepared.forEach(spell => {
				const levelText = spell.level === 1 ? "1st" : spell.level === 2 ? "2nd" : spell.level === 3 ? "3rd" : `${spell.level}th`;
				const castTime = spell.castingTime || "1 action";
				const spellEl = e_({outer: `
					<div class="charsheet__quick-spell">
						<div class="charsheet__quick-spell-info">
							<span class="charsheet__quick-spell-name">${getSpellLink(spell)}</span>
							<span class="ve-small ve-muted">${levelText} · ${castTime}</span>
						</div>
						<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__quick-spell-btn" title="Cast ${spell.name}">
							<span class="glyphicon glyphicon-flash"></span> Cast
						</button>
					</div>
				`});
				spellEl.querySelector("button").addEventListener("click", () => {
					if (this._spells) this._spells._castSpell(spell.id);
				});
				container.append(spellEl);
			});
		}

		const totalCantrips = cantrips.length;
		const totalPrepared = preparedSpells.length;
		if (totalCantrips > 3 || totalPrepared > 4) {
			container.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small text-center mt-2">More spells in Spells tab</div>`);
		}
	}
	// #endregion

	// #region Actions
	async _onHeal () {
		const amount = await InputUiUtil.pGetUserNumber({
			title: "Heal",
			default: 0,
			min: 0,
		});

		if (amount == null || amount <= 0) return;

		const currentHp = this._state.getCurrentHp();
		const maxHp = this._state.getMaxHp();
		const newHp = Math.min(currentHp + amount, maxHp);

		this._state.setCurrentHp(newHp);
		this._saveCurrentCharacter();
		this._renderHp();
		this._renderConditions(); // Update bloodied condition display

		this._showDiceResult("Healing", amount, `Healed ${amount} HP`);
	}

	async _onDamage () {
		const amount = await InputUiUtil.pGetUserNumber({
			title: "Take Damage",
			default: 0,
			min: 0,
		});

		if (amount == null || amount <= 0) return;

		let remaining = amount;
		let tempHp = this._state.getTempHp();
		let currentHp = this._state.getCurrentHp();

		// Temp HP absorbs damage first
		if (tempHp > 0) {
			const tempAbsorbed = Math.min(tempHp, remaining);
			tempHp -= tempAbsorbed;
			remaining -= tempAbsorbed;
			this._state.setTempHp(tempHp);
		}

		// Apply remaining damage to HP
		if (remaining > 0) {
			currentHp = Math.max(0, currentHp - remaining);
			this._state.setCurrentHp(currentHp);
		}

		this._saveCurrentCharacter();
		this._renderHp();
		this._renderConditions(); // Update bloodied condition display

		this._showDiceResult("Damage", amount, `Took ${amount} damage`);

		// Prompt for concentration check if concentrating
		if (this._state.isConcentrating?.()) {
			await this._promptConcentrationCheck(amount);
		}
	}

	/**
	 * Prompt the user to make a concentration check after taking damage.
	 * Shows DC calculation, allows rolling, skipping, or voluntarily breaking.
	 * @param {number} damageTaken - The amount of damage taken
	 */
	async _promptConcentrationCheck (damageTaken) {
		const concentration = this._state.getConcentration?.();
		if (!concentration) return;

		const spellName = concentration.spellName || "Unknown Spell";
		const checkInfo = this._state.makeConcentrationCheck(damageTaken);
		let {dc, bonus, advantage, sources, rollNeeded} = checkInfo;

		const dcExplanation = `DC = max(10, damage ÷ 2) = max(10, ${damageTaken} ÷ 2) = ${dc}`;
		const bonusBreakdown = [];
		bonusBreakdown.push(`CON save modifier`);
		if (sources.length) bonusBreakdown.push(...sources);

		return new Promise(resolve => {
			const {eleModalInner: modalInner, doClose} = UiUtil.getShowModal({
				title: "Concentration Check",
				isMinHeight0: true,
				cbClose: () => resolve(),
			});

			const rollResult = e_({outer: `<div class="charsheet__concentration-result ve-hidden"></div>`});

			// Editable DC input
			const dcInput = e_({outer: `<input type="number" class="ve-form-control form-control--minimal ve-input-xs" style="width: 50px; text-align: center;" value="${dc}" min="1">`});
			const rollNeededDisplay = e_({outer: `<span>${rollNeeded}</span>`});

			// Update roll needed when DC changes
			dcInput.addEventListener("change", () => {
				dc = parseInt(dcInput.value) || 10;
				const newRollNeeded = Math.max(1, Math.min(20, dc - bonus));
				rollNeededDisplay.textContent = newRollNeeded;
			});

			modalInner.insertAdjacentHTML("beforeend", `
				<div class="ve-flex-col w-100">
					<div class="mb-2">
						You are concentrating on <strong>${spellName.escapeQuotes()}</strong> and took <strong>${damageTaken}</strong> damage.
					</div>
				</div>
			`);

			// DC row with editable input
			const dcRow = ee`<div class="ve-flex ve-flex-v-center mb-2">
				<span class="mr-2"><strong>DC:</strong></span>
				${dcInput}
				<span class="glyphicon glyphicon-info-sign help ml-2" title="${(/** @type {*} */ (dcExplanation)).escapeQuotes()}"></span>
				<span class="ve-muted ml-2 ve-small">(click to edit)</span>
			</div>`;
			modalInner.append(dcRow);

			modalInner.insertAdjacentHTML("beforeend", `
				<div class="ve-flex-col w-100">
					<div class="mb-2">
						<strong>Your bonus:</strong> ${bonus >= 0 ? "+" : ""}${bonus}
						${sources.length ? `<span class="ve-muted">(${sources.join(", ")})</span>` : ""}
					</div>
					${advantage ? `<div class="mb-2 ve-small ve-muted">You have <strong>advantage</strong> on this check</div>` : ""}
				</div>
			`);

			// Roll needed display (updates dynamically)
			const rollNeededRow = ee`<div class="mb-3">
				<span class="ve-muted">You need to roll a </span>${rollNeededDisplay}<span class="ve-muted"> or higher on the die${advantage ? " (with advantage)" : ""} to maintain concentration.</span>
			</div>`;
			modalInner.append(rollNeededRow);

			modalInner.append(rollResult);

			const btnRow = e_({outer: `<div class="ve-flex-h-right mt-3"></div>`});

			const performRoll = async () => {
				// Get current DC value from input
				const currentDc = parseInt(dcInput.value) || 10;

				const roll1 = RollerUtil.randomise(20);
				const roll2 = advantage ? RollerUtil.randomise(20) : null;
				const effectiveRoll = advantage ? Math.max(roll1, roll2) : roll1;
				const total = effectiveRoll + bonus;
				const success = total >= currentDc;

				// Show animated dice if enabled
				if ((/** @type {*} */ (this._state.getSettings()))?.animatedDice) {
					await this._showAnimatedDice(20, effectiveRoll, advantage, false);
				}

				const rollText = advantage
					? `Rolls: ${roll1}, ${roll2} (took ${effectiveRoll}) + ${bonus} = <strong>${total}</strong> vs DC ${currentDc}`
					: `Roll: ${roll1} + ${bonus} = <strong>${total}</strong> vs DC ${currentDc}`;

				const resultClass = success ? "charsheet__concentration-success" : "charsheet__concentration-fail";
				const resultText = success ? "Success! Concentration maintained." : "Failed! Concentration broken.";

				rollResult.innerHTML = `
					<div class="${resultClass} p-2 text-center">
						<div>${rollText}</div>
						<div class="mt-1"><strong>${resultText}</strong></div>
					</div>
				`;
				rollResult.classList.remove("ve-hidden");

				if (!success) {
					this._state.breakConcentration();
					this._combatModule?.renderCombatStates?.();
					this._renderActiveStates?.();
					this._saveCurrentCharacter();
					this._renderCharacter?.();
				}

				// Replace buttons with close button
				btnRow.empty().append(
					e_({outer: `<button class="btn btn-primary">Close</button>`})
						.addEventListener("click", () => { doClose(); resolve(); }),
				);
			};

			// Roll button
			const btnRoll = e_({outer: `<button class="btn btn-primary mr-2">Roll Check</button>`})
				.addEventListener("click", () => performRoll());

			// Skip button (keep concentration without rolling)
			const btnSkip = e_({outer: `<button class="btn btn-default mr-2">Skip (Keep)</button>`})
				.addEventListener("click", () => { doClose(); resolve(); });

			// Break button (voluntarily end concentration)
			const btnBreak = e_({outer: `<button class="btn btn-danger">Break Concentration</button>`})
				.addEventListener("click", () => {
					this._state.breakConcentration();
					this._combatModule?.renderCombatStates?.();
					this._renderActiveStates?.();
					this._saveCurrentCharacter();
					this._renderCharacter?.();
					JqueryUtil.doToast({type: "info", content: `Concentration on ${spellName} ended.`});
					doClose();
					resolve();
				});

			btnRow.append(btnRoll, btnSkip, btnBreak);
			modalInner.append(btnRow);
		});
	}

	async _onUseHitDie () {
		const hitDice = this._state.getHitDiceSummary();
		if (hitDice.current <= 0) {
			JqueryUtil.doToast({type: "warning", content: "No hit dice remaining!"});
			return;
		}

		const dieType = hitDice.type || "d8";
		const conMod = this._state.getAbilityMod("con");
		const dieSize = parseInt(dieType.substring(1));

		const roll = RollerUtil.randomise(dieSize);
		const healing = Math.max(1, roll + conMod);

		// Apply healing
		const currentHp = this._state.getCurrentHp();
		const maxHp = this._state.getMaxHp();
		const newHp = Math.min(currentHp + healing, maxHp);

		this._state.setCurrentHp(newHp);
		this._state.useHitDie();
		this._saveCurrentCharacter();
		this._renderHp();
		this._renderHitDice();
		this._renderConditions(); // Update bloodied condition display

		this._showDiceResult(
			"Hit Die",
			healing,
			`1${dieType} (${roll}) + ${conMod} CON`,
		);
	}

	async _onDeathSave () {
		const roll = RollerUtil.randomise(20);
		let result = "";

		if (roll === 20) {
			// Nat 20 - regain 1 HP
			this._state.setCurrentHp(1);
			this._state.setDeathSaves(0, 0);
			result = "Natural 20! You regain 1 HP and are stable.";
		} else if (roll === 1) {
			// Nat 1 - two failures
			const deathSaves = this._state.getDeathSaves();
			const newFailures = Math.min(3, deathSaves.failures + 2);
			this._state.setDeathSaves(deathSaves.successes, newFailures);
			result = "Natural 1! Two death save failures.";
		} else if (roll >= 10) {
			// Success
			const deathSaves = this._state.getDeathSaves();
			const newSuccesses = Math.min(3, deathSaves.successes + 1);
			this._state.setDeathSaves(newSuccesses, deathSaves.failures);
			result = `Success (${roll})`;
			if (newSuccesses >= 3) result += " - You are stable!";
		} else {
			// Failure
			const deathSaves = this._state.getDeathSaves();
			const newFailures = Math.min(3, deathSaves.failures + 1);
			this._state.setDeathSaves(deathSaves.successes, newFailures);
			result = `Failure (${roll})`;
			if (newFailures >= 3) result += " - You have died.";
		}

		this._saveCurrentCharacter();
		this._renderHp();
		this._renderDeathSaves();
		this._renderConditions(); // Update bloodied condition display

		this._showDiceResult("Death Save", roll, result);
	}

	async _onShortRest () {
		const confirm = await InputUiUtil.pGetUserBoolean({
			title: "Short Rest",
			htmlDescription: `
				<p>During a short rest, you can:</p>
				<ul>
					<li>Spend hit dice to recover HP</li>
					<li>Recover some class features</li>
				</ul>
				<p>Proceed with short rest?</p>
			`,
			textYes: "Rest",
			textNo: "Cancel",
		});

		if (!confirm) return;

		// Recover short rest resources
		this._state.onShortRest();
		this._saveCurrentCharacter();
		this._renderCharacter();

		JqueryUtil.doToast({type: "success", content: "Short rest completed!"});
	}

	async _onLongRest () {
		const exhaustionBefore = this._state.getExhaustion();
		const confirm = await InputUiUtil.pGetUserBoolean({
			title: "Long Rest",
			htmlDescription: `
				<p>During a long rest, you will:</p>
				<ul>
					<li>Recover all HP</li>
					<li>Recover half your hit dice (minimum 1)</li>
					<li>Recover all spell slots</li>
					<li>Recover all class features</li>
					${exhaustionBefore > 0 ? "<li>Reduce exhaustion by 1 level</li>" : ""}
				</ul>
				<p>Proceed with long rest?</p>
			`,
			textYes: "Rest",
			textNo: "Cancel",
		});

		if (!confirm) return;

		this._state.onLongRest();
		this._saveCurrentCharacter();
		this._renderCharacter();

		const exhaustionAfter = this._state.getExhaustion();
		let message = "Long rest completed! All resources recovered.";
		if (exhaustionBefore > exhaustionAfter) {
			message += ` Exhaustion reduced to ${exhaustionAfter}.`;
		}
		JqueryUtil.doToast({type: "success", content: message});
	}

	_toggleInspiration () {
		this._state.toggleInspiration();
		this._saveCurrentCharacter();
		this._renderInspiration();
	}

	_toggleSecondaryHeader (opts = {}) {
		const {force} = /** @type {*} */ (opts);
		const secondaryRow = document.getElementById("charsheet-header-secondary");
		const btn = document.getElementById("charsheet-btn-more");
		if (!secondaryRow || !btn) return;

		const shouldCollapse = force != null ? force : !secondaryRow.classList.contains("charsheet__header-row--collapsed");

		if (shouldCollapse) {
			// Close any open dropdowns before collapsing
			this._closeAllHeaderDropdowns();
			secondaryRow.classList.add("charsheet__header-row--collapsed");
			btn.classList.remove("active");
		} else {
			secondaryRow.classList.remove("charsheet__header-row--collapsed");
			btn.classList.add("active");
		}

		StorageUtil.pSet("charsheet-secondary-header-collapsed", shouldCollapse);
	}

	_initSecondaryHeader () {
		const secondaryRow = document.getElementById("charsheet-header-secondary");
		const btn = document.getElementById("charsheet-btn-more");
		if (!secondaryRow || !btn) return;

		StorageUtil.pGet("charsheet-secondary-header-collapsed").then(isCollapsed => {
			if (isCollapsed) {
				secondaryRow.classList.add("charsheet__header-row--collapsed");
				btn.classList.remove("active");
			} else {
				secondaryRow.classList.remove("charsheet__header-row--collapsed");
				btn.classList.add("active");
			}
		});
	}

	_closeAllHeaderDropdowns () {
		const dropdownSelectors = [
			".charsheet__theme-dropdown",
			".charsheet__textsize-dropdown",
			".charsheet__font-dropdown",
			".charsheet__dice-dropdown",
		];
		const toggleSelectors = [
			".charsheet__theme-toggle",
			".charsheet__textsize-toggle",
			".charsheet__font-toggle",
			".charsheet__dice-toggle",
		];

		for (const sel of dropdownSelectors) {
			const el = /** @type {*} */ (document.querySelector(sel));
			if (el) {
				el.classList.remove("active");
				el.style.display = "";
			}
		}
		for (const sel of toggleSelectors) {
			document.querySelector(sel)?.classList.remove("active");
		}
	}

	/**
	 * Toggle layout edit mode on/off
	 * When enabled, users can drag sections to reorder them
	 */
	_toggleLayoutEditMode () {
		if (!this._layout) return;

		const isNowEditing = this._layout.toggleEditMode();
		const btn = document.getElementById("charsheet-btn-layout");
		const btnText = btn.querySelector(".charsheet__layout-toggle-text");

		if (isNowEditing) {
			// Auto-expand secondary header so layout controls are visible
			this._toggleSecondaryHeader({force: false});
			btn.classList.add("active");
			btnText.textContent = "Done";
			btn.setAttribute("title", "Finish editing layout");
		} else {
			btn.classList.remove("active");
			btnText.textContent = "Layout";
			btn.setAttribute("title", "Customize section layout by dragging");
			// Save character to persist layout
			this._saveCurrentCharacter();
		}
	}

	/**
	 * Initialize theme picker dropdown in header
	 */
	_initThemePicker () {
		const btn = document.getElementById("charsheet-btn-theme");
		const dropdown = document.getElementById("charsheet-theme-dropdown");
		const content = dropdown.querySelector(".charsheet__theme-dropdown-content");

		const themes = [
			{id: "default", name: "Default", color: "#1c1c1c"},
			{id: "indigo", name: "Indigo", color: "#1e1b4b"},
			{id: "crimson", name: "Crimson", color: "#450a0a"},
			{id: "emerald", name: "Emerald", color: "#052e16"},
			{id: "amber", name: "Amber", color: "#451a03"},
			{id: "sapphire", name: "Sapphire", color: "#172554"},
			{id: "amethyst", name: "Amethyst", color: "#2e1065"},
			{id: "rose", name: "Rose", color: "#4c0519"},
			{id: "teal", name: "Teal", color: "#042f2e"},
			{id: "slate", name: "Slate", color: "#1e293b"},
			{id: "copper", name: "Copper", color: "#431407"},
			{id: "forest", name: "Forest", color: "#14532d"},
			{id: "midnight", name: "Midnight", color: "#0c1929"},
		];

		// Build swatches
		const currentTheme = this._state.getBackgroundTheme();
		const swatchesHtml = themes.map(theme => {
			const isSelected = currentTheme === theme.id;
			return `<button class="charsheet__theme-swatch ${isSelected ? "charsheet__theme-swatch--selected" : ""}" 
				data-theme="${theme.id}" 
				title="${theme.name}"
				style="--swatch-color: ${theme.color}">
				<span class="charsheet__theme-swatch-color"></span>
				<span class="charsheet__theme-swatch-name">${theme.name}</span>
			</button>`;
		}).join("");

		content.innerHTML = swatchesHtml;

		// Position dropdown relative to button (using fixed positioning)
		const positionDropdown = () => {
			const btnRect = btn.getBoundingClientRect();
			const dropdownWidth = 280; // min-width from CSS

			// Position below button, aligned to right edge
			let left = btnRect.right - dropdownWidth;
			const top = btnRect.bottom + 8;

			// Ensure it doesn't go off-screen left
			if (left < 8) left = 8;

			Object.assign(dropdown.style, {
				top: `${top}px`,
				left: `${left}px`,
			});
		};

		// Toggle dropdown
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const isOpen = dropdown.classList.contains("active");
			if (!isOpen) {
				positionDropdown();
			}
			dropdown.classList.toggle("active", !isOpen);
			btn.classList.toggle("active", !isOpen);
		});

		// Handle swatch click (delegated)
		content.addEventListener("click", (e) => {
			const swatch = (/** @type {*} */ (e.target)).closest(".charsheet__theme-swatch");
			if (!swatch) return;
			const theme = swatch.dataset.theme;

			// Update selection visuals
			content.querySelectorAll(".charsheet__theme-swatch--selected").forEach(el => el.classList.remove("charsheet__theme-swatch--selected"));
			swatch.classList.add("charsheet__theme-swatch--selected");

			// Save and apply theme
			this._state.setBackgroundTheme(theme);
			this._applyBackgroundTheme(theme);
			this._saveCurrentCharacter();

			// Close dropdown
			dropdown.classList.remove("active");
			btn.classList.remove("active");
		});

		// Close dropdown when clicking outside
		document.addEventListener("click", (e) => {
			if (!(/** @type {*} */ (e.target)).closest(".charsheet__header-theme-controls")) {
				dropdown.classList.remove("active");
				btn.classList.remove("active");
			}
		});
	}

	/**
	 * Initialize text size picker dropdown in header
	 * Text size is stored globally (not per-character) for consistent UX
	 */
	_initTextSizePicker () {
		const btn = document.getElementById("charsheet-btn-textsize");
		const dropdown = document.getElementById("charsheet-textsize-dropdown");
		const sizeInput = /** @type {*} */ (document.getElementById("charsheet-textsize-input"));
		const decreaseBtn = document.getElementById("charsheet-textsize-decrease");
		const increaseBtn = document.getElementById("charsheet-textsize-increase");
		const resetBtn = document.getElementById("charsheet-textsize-reset");
		const presetsContainer = dropdown.querySelector(".charsheet__textsize-presets");

		const STORAGE_KEY = "charsheet-text-size";
		const DEFAULT_SIZE = 100;
		const MIN_SIZE = 50;
		const MAX_SIZE = 250;
		const STEP = 5;

		let currentSize = DEFAULT_SIZE;

		// Load saved text size (global setting)
		const loadTextSize = () => {
			try {
				const saved = localStorage.getItem(STORAGE_KEY);
				return saved ? parseInt(saved, 10) : DEFAULT_SIZE;
			} catch (e) {
				return DEFAULT_SIZE;
			}
		};

		// Save text size (global setting)
		const saveTextSize = (size) => {
			try {
				localStorage.setItem(STORAGE_KEY, String(size));
			} catch (e) {
				// Storage may be unavailable
			}
		};

		// Apply text size to the page
		const applyTextSize = (size) => {
			const page = /** @type {*} */ (document.querySelector(".charsheet-page"));
			page.setAttribute("data-textsize", size);
			page.style.setProperty("--cs-text-scale", size / 100);
			// Set root font-size so ALL rem-based content scales — including modals/popups appended to body
			document.documentElement.style.fontSize = `${size}%`;
			document.documentElement.style.setProperty("--cs-text-scale", String(size / 100));

			// Update UI
			sizeInput.value = size;
			currentSize = size;

			// Update preset buttons
			dropdown.querySelectorAll(".charsheet__textsize-preset--active").forEach(el => el.classList.remove("charsheet__textsize-preset--active"));
			dropdown.querySelector(`.charsheet__textsize-preset[data-size="${size}"]`)?.classList.add("charsheet__textsize-preset--active");
		};

		// Set text size (apply + save)
		const setTextSize = (size) => {
			size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)));
			applyTextSize(size);
			saveTextSize(size);
		};

		// Position dropdown relative to button
		const positionDropdown = () => {
			const btnRect = btn.getBoundingClientRect();
			const dropdownWidth = 240;

			let left = btnRect.right - dropdownWidth;
			const top = btnRect.bottom + 8;

			if (left < 8) left = 8;

			Object.assign(dropdown.style, {
				top: `${top}px`,
				left: `${left}px`,
			});
		};

		// Toggle dropdown
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const isOpen = dropdown.classList.contains("active");
			if (!isOpen) {
				positionDropdown();
			}
			dropdown.classList.toggle("active", !isOpen);
			btn.classList.toggle("active", !isOpen);
		});

		// Number input — apply on change, blur, or Enter
		sizeInput.addEventListener("change", () => {
			setTextSize(parseInt(sizeInput.value, 10) || DEFAULT_SIZE);
		});

		sizeInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				setTextSize(parseInt(sizeInput.value, 10) || DEFAULT_SIZE);
			}
		});

		// Decrease button
		decreaseBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			setTextSize(currentSize - STEP);
		});

		// Increase button
		increaseBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			setTextSize(currentSize + STEP);
		});

		// Preset buttons (event delegation on container)
		presetsContainer.addEventListener("click", (e) => {
			const preset = (/** @type {*} */ (e.target)).closest(".charsheet__textsize-preset");
			if (!preset) return;
			e.stopPropagation();
			const size = parseInt(preset.dataset.size, 10);
			setTextSize(size);
		});

		// Reset button
		resetBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			setTextSize(DEFAULT_SIZE);
		});

		// Close dropdown when clicking outside
		document.addEventListener("click", (e) => {
			if (!(/** @type {*} */ (e.target)).closest(".charsheet__header-textsize-controls")) {
				dropdown.classList.remove("active");
				btn.classList.remove("active");
			}
		});

		// Apply saved text size on init
		const savedSize = loadTextSize();
		applyTextSize(savedSize);
	}

	/**
	 * Initialize font picker dropdown in header
	 * Font is stored globally (not per-character) for consistent UX
	 */
	_initFontPicker () {
		const btn = document.getElementById("charsheet-btn-font");
		const dropdown = document.getElementById("charsheet-font-dropdown");
		const options = document.getElementById("charsheet-font-options");
		const resetBtn = document.getElementById("charsheet-font-reset");

		const STORAGE_KEY = "charsheet-font";
		const DEFAULT_FONT = "system";

		// Available fonts
		const FONTS = [
			{id: "system", name: "System Default", preview: "System"},
			{id: "serif", name: "Serif (Classic)", preview: "Serif"},
			{id: "mono", name: "Monospace", preview: "Mono"},
			{id: "fantasy", name: "Fantasy", preview: "Fantasy"},
			{id: "hubot", name: "Hubot Sans", preview: "Hubot"},
			{id: "readable", name: "High Readability", preview: "Readable"},
		];

		// Load saved font (global setting)
		const loadFont = () => {
			try {
				const saved = localStorage.getItem(STORAGE_KEY);
				return saved || DEFAULT_FONT;
			} catch (e) {
				return DEFAULT_FONT;
			}
		};

		// Save font (global setting)
		const saveFont = (font) => {
			try {
				localStorage.setItem(STORAGE_KEY, font);
			} catch (e) {
				// Storage may be unavailable
			}
		};

		// Apply font to the page
		const applyFont = (font) => {
			const page = document.querySelector(".charsheet-page");
			page.setAttribute("data-font", font);

			// Update UI
			options.querySelectorAll(".charsheet__font-option--active").forEach(el => el.classList.remove("charsheet__font-option--active"));
			options.querySelector(`[data-font="${font}"]`).classList.add("charsheet__font-option--active");
		};

		// Set font (apply + save)
		const setFont = (font) => {
			applyFont(font);
			saveFont(font);
		};

		// Build font options
		FONTS.forEach(font => {
			const fontFamily = font.id === "system" ? "inherit"
				: font.id === "serif" ? "Georgia, serif"
					: font.id === "mono" ? "monospace"
						: font.id === "fantasy" ? "Cinzel, serif"
							: font.id === "hubot" ? "'Hubot Sans', 'Mona Sans', -apple-system, sans-serif"
								: font.id === "readable" ? "Verdana, sans-serif" : "inherit";

			const optionEl = e_({outer: `
				<button class="charsheet__font-option" data-font="${font.id}" style="font-family: ${fontFamily};">
					<span class="charsheet__font-option-preview">${font.name}</span>
					<span class="charsheet__font-option-check">✓</span>
				</button>
			`});

			optionEl.addEventListener("click", (e) => {
				e.stopPropagation();
				setFont(font.id);
			});

			options.append(optionEl);
		});

		// Position dropdown relative to button
		const positionDropdown = () => {
			const btnRect = btn.getBoundingClientRect();
			const dropdownWidth = 200;

			let left = btnRect.right - dropdownWidth;
			const top = btnRect.bottom + 8;

			if (left < 8) left = 8;

			Object.assign(dropdown.style, {
				top: `${top}px`,
				left: `${left}px`,
			});
		};

		// Toggle dropdown
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const isOpen = dropdown.classList.contains("active");
			if (!isOpen) {
				positionDropdown();
			}
			dropdown.classList.toggle("active", !isOpen);
			btn.classList.toggle("active", !isOpen);
		});

		// Reset button
		resetBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			setFont(DEFAULT_FONT);
		});

		// Close dropdown when clicking outside
		document.addEventListener("click", (e) => {
			if (!(/** @type {*} */ (e.target)).closest(".charsheet__header-font-controls")) {
				dropdown.classList.remove("active");
				btn.classList.remove("active");
			}
		});

		// Apply saved font on init
		const savedFont = loadFont();
		applyFont(savedFont);
	}

	/**
	 * Initialize dice settings picker dropdown in header
	 * Uses character settings for animated dice preference
	 */
	_initDicePicker () {
		const btn = document.getElementById("charsheet-btn-dice");
		const dropdown = document.getElementById("charsheet-dice-dropdown");
		const animatedCheckbox = document.getElementById("charsheet-dice-animated");
		const themeButtons = document.querySelector(".charsheet__dice-theme-btn");

		// Update checkbox state from settings
		const updateCheckbox = () => {
			const isAnimated = (/** @type {*} */ (this._state?.getSettings()))?.animatedDice || false;
			(/** @type {*} */ (animatedCheckbox)).checked = isAnimated;
		};

		// Update theme button selection
		const updateThemeSelection = () => {
			const currentTheme = (/** @type {*} */ (this._state?.getSettings()))?.diceTheme || "standard";
			themeButtons.classList.remove("active");
			document.querySelector(`.charsheet__dice-theme-btn[data-theme="${currentTheme}"]`).classList.add("active");
		};

		// Position dropdown relative to button
		const positionDropdown = () => {
			const btnRect = btn.getBoundingClientRect();
			const dropdownWidth = 180;

			let left = btnRect.right - dropdownWidth;
			const top = btnRect.bottom + 8;

			if (left < 8) left = 8;

			Object.assign(dropdown.style, {
				top: `${top}px`,
				left: `${left}px`,
			});
		};

		// Toggle dropdown
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const isOpen = dropdown.classList.contains("active");
			if (!isOpen) {
				updateCheckbox();
				updateThemeSelection();
				positionDropdown();
			}
			dropdown.classList.toggle("active", !isOpen);
			btn.classList.toggle("active", !isOpen);
		});

		// Animated dice checkbox
		animatedCheckbox.addEventListener("change", (e) => {
			e.stopPropagation();
			this._state.setSetting("animatedDice", (/** @type {*} */ (e.target)).checked);
			this._saveCurrentCharacter();
		});

		// Theme buttons
		themeButtons.addEventListener("click", (e) => {
			e.stopPropagation();
			const theme = (/** @type {*} */ (e.currentTarget)).dataset.theme;
			this._state.setSetting("diceTheme", theme);
			this._saveCurrentCharacter();
			updateThemeSelection();
		});

		// Close dropdown when clicking outside
		document.addEventListener("click", (e) => {
			if (!(/** @type {*} */ (e.target)).closest(".charsheet__header-dice-controls")) {
				dropdown.classList.remove("active");
				btn.classList.remove("active");
			}
		});

		// Initial update
		updateCheckbox();
		updateThemeSelection();
	}

	/**
	 * Reset section layout to default for current tab
	 */
	async _resetLayout () {
		if (!this._layout) return;

		const confirm = await InputUiUtil.pGetUserBoolean({
			title: "Reset Tab Layout",
			htmlDescription: "<p>Reset layout to default for this tab? This cannot be undone.</p>",
			textYes: "Reset",
			textNo: "Cancel",
		});
		if (confirm) {
			this._layout.resetLayout(false);
			this._saveCurrentCharacter();
		}
	}

	/**
	 * Reset all tabs to the default sheet layout
	 */
	async _resetToDefaultLayout () {
		if (!this._layout) return;

		const confirm = await InputUiUtil.pGetUserBoolean({
			title: "Reset All Layouts",
			htmlDescription: "<p>Reset ALL tabs to the default sheet layout? This will clear any custom section ordering.</p>",
			textYes: "Reset All",
			textNo: "Cancel",
		});
		if (confirm) {
			this._layout.resetLayout(true);
			this._saveCurrentCharacter();
		}
	}

	async _onAddCondition () {
		// Get conditions from loaded data (dynamic, supports homebrew)
		// Now returns {name, source, sourceAbbr} objects
		const allConditions = this.getConditionsList();

		// Get current conditions as {name, source} objects
		const currentConditions = this._state.getConditions();

		// Filter out conditions that are already applied (exact name + source match)
		const availableConditions = allConditions.filter(cond =>
			!currentConditions.some(curr =>
				curr.name.toLowerCase() === cond.name.toLowerCase() && curr.source === cond.source,
			),
		);

		if (!availableConditions) {
			JqueryUtil.doToast({type: "warning", content: "All conditions already applied!"});
			return;
		}

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "🩹 Add Condition",
			isMinHeight0: true,
			isWidth100: true,
		});

		let selectedCondition = null;

		// Get priority sources for filtering
		const prioritySources = this._state.getPrioritySources() || [];

		// Get unique sources for filtering
		const conditionSources = [...new Set(availableConditions.map(c => c.source))].sort((a, b) => {
			// Priority sources first
			const aIsPriority = prioritySources.includes(a);
			const bIsPriority = prioritySources.includes(b);
			if (aIsPriority && !bIsPriority) return -1;
			if (!aIsPriority && bIsPriority) return 1;
			// Then XPHB, then PHB, then alphabetically
			if (a === Parser.SRC_XPHB) return -1;
			if (b === Parser.SRC_XPHB) return 1;
			if (a === Parser.SRC_PHB) return -1;
			if (b === Parser.SRC_PHB) return 1;
			return a.localeCompare(b);
		});

		// Track selected sources - if priority sources set, default to those only
		const selectedSources = prioritySources.length
			? new Set(conditionSources.filter(s => prioritySources.includes(s)))
			: new Set(conditionSources);
		// If no priority sources matched, fallback to all
		if (selectedSources.size === 0) {
			conditionSources.forEach(s => selectedSources.add(s));
		}

		const search = e_({outer: `<input type="text" class="ve-form-control charsheet__modal-search" placeholder="🔍 Search conditions...">`});
		const list = e_({outer: `<div class="charsheet__conditions-list"></div>`});
		const count = e_({outer: `<span class="charsheet__modal-search-count">${availableConditions.length} conditions</span>`});

		// Build source filter UI
		const sourceFilter = e_({outer: `<div class="charsheet__source-multiselect"></div>`});
		const sourceBtn = e_({outer: `
			<button type="button" class="charsheet__source-multiselect-btn">
				<span class="charsheet__source-multiselect-icon">📚</span>
				<span class="charsheet__source-multiselect-text">All Sources</span>
				<span class="charsheet__source-multiselect-arrow">▼</span>
			</button>
		`});
		const sourceDropdown = e_({outer: `<div class="charsheet__source-multiselect-dropdown"></div>`});

		// Action buttons
		const sourceActions = e_({outer: `
			<div class="charsheet__source-multiselect-actions">
				<button type="button" class="ve-btn ve-btn-xs ve-btn-default charsheet__source-action-btn" data-action="all">Select All</button>
				<button type="button" class="ve-btn ve-btn-xs ve-btn-default charsheet__source-action-btn" data-action="clear">Clear All</button>
				<button type="button" class="ve-btn ve-btn-xs ve-btn-primary charsheet__source-action-btn" data-action="official">Official Only</button>
				${prioritySources.length ? `<button type="button" class="ve-btn ve-btn-xs ve-btn-success charsheet__source-action-btn" data-action="priority">Priority Only</button>` : ""}
			</div>
		`});

		const sourceList = e_({outer: `<div class="charsheet__source-multiselect-list"></div>`});

		// Build source checkboxes
		conditionSources.forEach(src => {
			const srcAbbr = Parser.sourceJsonToAbv(src);
			const srcFull = Parser.sourceJsonToFull(src);
			const isChecked = selectedSources.has(src);

			const itemEl = e_({outer: `
				<label class="charsheet__source-multiselect-item">
					<input type="checkbox" value="${src}" ${isChecked ? "checked" : ""}>
					<span class="charsheet__source-multiselect-check">${isChecked ? "✓" : ""}</span>
					<span class="charsheet__source-multiselect-label">
						<strong>${srcAbbr}</strong>
						<span class="ve-muted ve-small">${srcFull}</span>
					</span>
				</label>
			`});

			itemEl.querySelector("input").addEventListener("change", function () {
				if (this.checked) {
					selectedSources.add(src);
					this.parentElement.querySelector(".charsheet__source-multiselect-check").textContent = "✓";
				} else {
					selectedSources.delete(src);
					this.parentElement.querySelector(".charsheet__source-multiselect-check").textContent = "";
				}
				updateSourceBtnText();
				renderList(search.value);
			});

			sourceList.append(itemEl);
		});

		sourceDropdown.append(sourceActions, sourceList);
		sourceFilter.append(sourceBtn, sourceDropdown);

		// Toggle dropdown
		sourceBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			sourceDropdown.classList.toggle("open");
		});

		// Close dropdown when clicking outside
		const _condSourceFilterHandler = () => {
			sourceDropdown.classList.remove("open");
		};
		document.addEventListener("click", _condSourceFilterHandler);

		sourceDropdown.addEventListener("click", (e) => e.stopPropagation());

		// Action button handlers
		sourceActions.querySelector("[data-action='all']").addEventListener("click", () => {
			conditionSources.forEach(src => selectedSources.add(src));
			sourceList.querySelector("input").checked = true;
			sourceList.querySelector(".charsheet__source-multiselect-check").textContent = "✓";
			updateSourceBtnText();
			renderList(search.value);
		});

		sourceActions.querySelector("[data-action='clear']").addEventListener("click", () => {
			selectedSources.clear();
			sourceList.querySelector("input").checked = false;
			sourceList.querySelector(".charsheet__source-multiselect-check").textContent = "";
			updateSourceBtnText();
			renderList(search.value);
		});

		sourceActions.querySelector("[data-action='official']").addEventListener("click", () => {
			selectedSources.clear();
			const officialSources = [Parser.SRC_XPHB, Parser.SRC_PHB, Parser.SRC_DMG, Parser.SRC_MM, Parser.SRC_XDMG, Parser.SRC_XMM];
			conditionSources.forEach(src => {
				if (officialSources.includes(src) || src.startsWith("UA")) {
					selectedSources.add(src);
				}
			});
			[...sourceList.querySelectorAll("input")].forEach((/** @type {*} */ input) => {
				const isSelected = selectedSources.has(input.value);
				input.checked = isSelected;
				input.parentElement.querySelector(".charsheet__source-multiselect-check").textContent = isSelected ? "✓" : "";
			});
			updateSourceBtnText();
			renderList(search.value);
		});

		// Priority Only button handler (only present if priority sources are set)
		sourceActions.querySelector("[data-action='priority']").addEventListener("click", () => {
			selectedSources.clear();
			conditionSources.forEach(src => {
				if (prioritySources.includes(src)) {
					selectedSources.add(src);
				}
			});
			// If no priority sources matched, fallback to all
			if (selectedSources.size === 0) {
				conditionSources.forEach(s => selectedSources.add(s));
			}
			[...sourceList.querySelectorAll("input")].forEach((/** @type {*} */ input) => {
				const isSelected = selectedSources.has(input.value);
				input.checked = isSelected;
				input.parentElement.querySelector(".charsheet__source-multiselect-check").textContent = isSelected ? "✓" : "";
			});
			updateSourceBtnText();
			renderList(search.value);
		});

		const updateSourceBtnText = () => {
			if (selectedSources.size === conditionSources.length) {
				sourceBtn.querySelector(".charsheet__source-multiselect-text").textContent = "All Sources";
			} else if (selectedSources.size === 0) {
				sourceBtn.querySelector(".charsheet__source-multiselect-text").textContent = "No Sources";
			} else if (prioritySources.length
				&& prioritySources.filter(s => conditionSources.includes(s)).every(s => selectedSources.has(s))
				&& [...selectedSources].every(s => prioritySources.includes(s))) {
				sourceBtn.querySelector(".charsheet__source-multiselect-text").textContent = "Priority Sources";
			} else {
				sourceBtn.querySelector(".charsheet__source-multiselect-text").textContent = `${selectedSources.size} Source${selectedSources.size !== 1 ? "s" : ""}`;
			}
		};

		// Initialize button text
		updateSourceBtnText();

		const renderList = (filter = "") => {
			list.innerHTML = "";

			const filtered = availableConditions.filter(cond => {
				// Check source filter
				if (!selectedSources.has(cond.source)) return false;
				// Check text filter
				if (filter) {
					return cond.name.toLowerCase().includes(filter.toLowerCase())
						|| cond.sourceAbbr.toLowerCase().includes(filter.toLowerCase());
				}
				return true;
			});

			// Sort: priority sources first, then by name
			filtered.sort((a, b) => {
				const aIsPriority = prioritySources.includes(a.source);
				const bIsPriority = prioritySources.includes(b.source);
				if (aIsPriority && !bIsPriority) return -1;
				if (!aIsPriority && bIsPriority) return 1;
				// Then by name
				const nameCompare = a.name.localeCompare(b.name);
				if (nameCompare !== 0) return nameCompare;
				// Then XPHB first for same name
				if (a.source === Parser.SRC_XPHB) return -1;
				if (b.source === Parser.SRC_XPHB) return 1;
				return a.source.localeCompare(b.source);
			});

			count.textContent = `${filtered.length} conditions`;

			if (filtered.length === 0) {
				list.insertAdjacentHTML("beforeend", `<div class="ve-muted p-2 text-center">No matching conditions found</div>`);
				return;
			}

			filtered.forEach(cond => {
				const condDef = CharacterSheetState.getConditionEffects(cond.name);
				const icon = condDef?.icon || "❓";
				const description = condDef?.description || "Apply this condition";

				// Build effect preview
				let effectsPreview = "";
				if (condDef?.effects?.length) {
					const effects = condDef.effects.slice(0, 3).map(e => {
						if (e.type === "advantage") return `⬆️ Adv: ${e.target}`;
						if (e.type === "disadvantage") return `⬇️ Disadv: ${e.target}`;
						if (e.type === "autoFail") return `❌ Auto-fail: ${e.target}`;
						if (e.type === "setSpeed") return `🏃 Speed → ${e.value}`;
						if (e.type === "resistance") return `🛡️ Resist: ${e.target}`;
						if (e.type === "bonus") return `${e.value >= 0 ? "+" : ""}${e.value} ${e.target}`;
						if (e.type === "note") return `📝 ${e.value.substring(0, 30)}...`;
						return null;
					}).filter(Boolean);
					if (effects.length) {
						effectsPreview = `<div class="charsheet__condition-item-effects">${effects.join(" • ")}</div>`;
					}
				}

				// Show source badge to distinguish same-name conditions from different sources
				const sourceBadge = `<span class="charsheet__condition-item-source">${cond.sourceAbbr}</span>`;

				// Check if character is immune to this condition
				const isImmune = this._state.isImmuneToCondition(cond.name);
				const immuneBadge = isImmune ? `<span class="charsheet__condition-item-immune">🛡️ Immune</span>` : "";

				const condLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_CONDITIONS_DISEASES, cond.name, cond.source);

				const itemEl = e_({outer: `
					<div class="charsheet__condition-item ${isImmune ? "charsheet__condition-item--immune" : ""}" data-condition-name="${cond.name}" data-condition-source="${cond.source}">
						<div class="charsheet__condition-item-header">
							<span class="charsheet__condition-item-icon">${icon}</span>
							<strong class="charsheet__condition-item-name">${condLink}</strong>
							${sourceBadge}
							${immuneBadge}
						</div>
						<div class="charsheet__condition-item-desc">${description}</div>
						${effectsPreview}
					</div>
				`});

				if (!isImmune) {
					itemEl.addEventListener("click", () => {
						list.querySelectorAll(".charsheet__condition-item.selected").forEach(el => el.classList.remove("selected"));
						itemEl.classList.add("selected");
						selectedCondition = cond;
						btnConfirm.disabled = false;
						btnConfirm.querySelector(".btn-text").textContent = `Apply ${cond.name}`;
					});

					// Double-click to apply immediately
					itemEl.addEventListener("dblclick", () => {
						selectedCondition = cond;
						applyCondition();
					});
				}

				list.append(itemEl);
			});
		};

		search.addEventListener("input", MiscUtil.debounce((e) => renderList((/** @type {*} */ (e.target)).value), 150));
		renderList();

		const applyCondition = () => {
			if (!selectedCondition) return;
			// Now passes {name, source} object
			this._state.addCondition({name: selectedCondition.name, source: selectedCondition.source});
			this._saveCurrentCharacter();
			this._renderConditions();
			this._renderActiveStates();
			this._renderCharacter();
			this._combat?.renderCombatConditions?.();
			this._combat?.renderCombatEffects?.();
			this._combat?.renderCombatDefenses?.();
			// Clean up event listener
			document.removeEventListener("click", _condSourceFilterHandler);
			doClose(true);
		};

		modalInner.append(ee`<div class="charsheet__conditions-modal-body">
			<div class="charsheet__modal-info-banner charsheet__modal-info-banner--info">
				<div class="charsheet__modal-info-banner-icon">🩹</div>
				<div class="charsheet__modal-info-banner-content">
					<strong>Apply a Condition</strong>
					<div class="ve-small">Select a condition to apply to your character. Conditions will affect your abilities, saves, and attacks.</div>
				</div>
			</div>
			<div class="charsheet__modal-search-wrapper">
				${search}
				${sourceFilter}
				${count}
			</div>
			${list}
		</div>`);

		// Footer buttons
		const btnCancel = e_({outer: `<button class="ve-btn ve-btn-default">Cancel</button>`});
		btnCancel.addEventListener("click", () => {
			document.removeEventListener("click", _condSourceFilterHandler);
			doClose(false);
		});
		const btnConfirm = e_({outer: `<button class="ve-btn ve-btn-primary" disabled><span class="btn-text">Select Condition</span></button>`});
		btnConfirm.addEventListener("click", applyCondition);

		modalInner.append(ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			${btnCancel}
			${btnConfirm}
		</div>`);
	}
	// #endregion

	// #region Dice Rolling
	/**
	 * Get exhaustion penalty for d20 rolls
	 * 2024 rules: -2 per exhaustion level to d20 Tests (ability checks, attack rolls, saving throws)
	 * Thelemar rules: -1 per exhaustion level to all rolls and DCs
	 * 2014 rules: Handled separately (disadvantage, etc.)
	 * @returns {number} Penalty to subtract from d20 tests
	 */
	_getExhaustionPenalty () {
		const exhaustion = this._state.getExhaustion();
		const rules = (/** @type {*} */ (this._state.getSettings())).exhaustionRules || "2024";
		if (rules === "2024") {
			return exhaustion * 2; // -2 per level in 2024 rules
		}
		if (rules === "thelemar") {
			return exhaustion; // -1 per level in Thelemar rules
		}
		// 2014 rules don't have a flat penalty to rolls
		return 0;
	}

	/**
	 * Get exhaustion penalty for DCs (spell save DC, etc.)
	 * Only applies in Thelemar rules (-1 per level)
	 * @returns {number} Penalty to subtract from DCs
	 */
	_getExhaustionDcPenalty () {
		const exhaustion = this._state.getExhaustion();
		const rules = (/** @type {*} */ (this._state.getSettings())).exhaustionRules || "2024";
		if (rules === "thelemar") {
			return exhaustion; // -1 per level in Thelemar rules
		}
		return 0;
	}

	/**
	 * Roll a d20 with advantage/disadvantage support
	 * @param {Object} opts - Roll options
	 * @param {Event} [opts.event] - The triggering event (to detect modifier keys)
	 * @param {"advantage"|"disadvantage"|"normal"} [opts.mode] - Legacy: precomputed mode (event keys still override). Prefer stateAdvantage/stateDisadvantage for cancel-aware resolution.
	 * @param {boolean} [opts.stateAdvantage] - Advantage from passive sources; combined with event keys via cancel-aware resolution.
	 * @param {boolean} [opts.stateDisadvantage] - Disadvantage from passive sources; combined with event keys via cancel-aware resolution.
	 * @param {boolean} [opts.isAttack=false] - Whether this is an attack roll (does not use Thelemar crit rules)
	 * @returns {{roll: number, roll1, roll2, mode, thelemar_critBonus}} Roll result
	 */
	_rollD20 ({event, mode, stateAdvantage, stateDisadvantage, isAttack = false} = {}) {
		// Cancel-aware path: callers pass explicit state booleans so adv + disadv (from any
		// combination of passive state and event keys) properly cancel to a normal roll.
		if (stateAdvantage !== undefined || stateDisadvantage !== undefined) {
			mode = CharacterSheetClassUtils.resolveD20Mode({stateAdvantage, stateDisadvantage, event});
		} else {
			// Legacy path: event modifier keys override the precomputed mode (used by
			// _rollInitiative and the public rollD20 pass-through, which have no state mode).
			if (event) {
				if ((/** @type {*} */ (event)).shiftKey) mode = "advantage";
				else if ((/** @type {*} */ (event)).ctrlKey || (/** @type {*} */ (event)).metaKey) mode = "disadvantage";
			}
			mode = mode || "normal";
		}

		const roll1 = RollerUtil.randomise(20);
		const roll2 = RollerUtil.randomise(20);

		let roll;
		if (mode === "advantage") {
			roll = Math.max(roll1, roll2);
		} else if (mode === "disadvantage") {
			roll = Math.min(roll1, roll2);
		} else {
			roll = roll1;
		}

		// Thelemar critical rolls rule: Nat 1 = -5, Nat 20 = +5 for non-attack rolls
		let thelemar_critBonus = 0;
		if (!isAttack && (/** @type {*} */ (this._state.getSettings()))?.thelemar_criticalRolls) {
			if (roll === 1) thelemar_critBonus = -5;
			else if (roll === 20) thelemar_critBonus = 5;
		}

		return {roll, roll1, roll2, mode, thelemar_critBonus};
	}

	/**
	 * Format a d20 roll breakdown string
	 * @param {Object} rollResult - Result from _rollD20
	 * @param {number} modifier - The modifier to add
	 * @param {string} [extraStr] - Extra text to append (e.g., exhaustion)
	 * @returns {string} Formatted breakdown
	 */
	_formatD20Breakdown (rollResult, modifier, extraStr = "") {
		const modStr = modifier >= 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`;
		const thelemar_critStr = rollResult.thelemar_critBonus
			? (rollResult.thelemar_critBonus > 0 ? ` + ${rollResult.thelemar_critBonus} [Nat 20]` : ` - ${Math.abs(rollResult.thelemar_critBonus)} [Nat 1]`)
			: "";

		if (rollResult.mode === "advantage") {
			return `2d20kh (${rollResult.roll1}, ${rollResult.roll2}) → ${rollResult.roll} ${modStr}${thelemar_critStr}${extraStr}`;
		} else if (rollResult.mode === "disadvantage") {
			return `2d20kl (${rollResult.roll1}, ${rollResult.roll2}) → ${rollResult.roll} ${modStr}${thelemar_critStr}${extraStr}`;
		}
		return `1d20 (${rollResult.roll}) ${modStr}${thelemar_critStr}${extraStr}`;
	}

	/**
	 * Get the mode label for display
	 */
	_getModeLabel (mode) {
		if (mode === "advantage") return " (Advantage)";
		if (mode === "disadvantage") return " (Disadvantage)";
		return "";
	}

	/**
	 * Get label for active state effects on a roll
	 * @param {boolean} hasAdvantage - Whether advantage applies from states
	 * @param {boolean} hasDisadvantage - Whether disadvantage applies from states
	 * @returns {string} Label like " [Rage]" or ""
	 */
	_getActiveStateEffectLabel (hasAdvantage, hasDisadvantage) {
		if (hasAdvantage && hasDisadvantage) {
			return " [States: Adv+Disadv cancel]";
		}
		// We could list specific state names here in the future
		return "";
	}

	async _rollAbilityCheck (ability, event) {
		const baseMod = this._state.getAbilityMod(ability);
		const exhaustionPenalty = this._getExhaustionPenalty();

		// Get aggregated modifiers for this ability check (includes custom abilities, items, etc.)
		const aggregated = this._state.aggregateModifiers(`check:${ability}`);
		const customBonus = aggregated.bonus;
		const totalMod = baseMod + customBonus;

		// Determine advantage/disadvantage from aggregated modifiers and active states
		const hasAdvantageFromStates = this._state.hasAdvantageFromStates(`check:${ability}`);
		const hasDisadvantageFromStates = this._state.hasDisadvantageFromStates(`check:${ability}`);
		const hasAdvantage = aggregated.advantage || hasAdvantageFromStates;
		const hasDisadvantage = aggregated.disadvantage || hasDisadvantageFromStates;

		const rollResult = this._rollD20({event, stateAdvantage: hasAdvantage, stateDisadvantage: hasDisadvantage});

		// Effective adv/dis after combining state with event keys, for the title/label.
		const evtAdv = !!(event && (/** @type {*} */ (event)).shiftKey);
		const evtDis = !!(event && ((/** @type {*} */ (event)).ctrlKey || (/** @type {*} */ (event)).metaKey));
		const effAdvantage = hasAdvantage || evtAdv;
		const effDisadvantage = hasDisadvantage || evtDis;

		// Apply minimum if set (e.g., Reliable Talent, custom abilities)
		let effectiveRoll = rollResult.roll;
		let minimumApplied = false;
		if (aggregated.minimum != null && rollResult.roll < aggregated.minimum) {
			effectiveRoll = aggregated.minimum;
			minimumApplied = true;
		}

		let total = effectiveRoll + totalMod - exhaustionPenalty + (rollResult.thelemar_critBonus || 0);

		// Thelemar crit visual cues
		let resultClass = "";
		let resultNote = "";
		if (rollResult.thelemar_critBonus === 5) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Natural 20! (+5 Thelemar)";
		} else if (rollResult.thelemar_critBonus === -5) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Natural 1! (-5 Thelemar)";
		}
		if (minimumApplied) {
			resultNote = resultNote ? `${resultNote} | Min ${aggregated.minimum} applied` : `Min ${aggregated.minimum} applied (rolled ${rollResult.roll})`;
		}

		// Build breakdown string
		const exhaustionStr = exhaustionPenalty > 0 ? ` - ${exhaustionPenalty} (exhaustion)` : "";
		const customBonusStr = customBonus !== 0 ? ` + ${customBonus} (custom)` : "";
		const stateEffectStr = (effAdvantage || effDisadvantage) ? this._getActiveStateEffectLabel(effAdvantage, effDisadvantage) : "";
		const sourcesStr = aggregated.sources.length > 0 ? ` [${aggregated.sources.join(", ")}]` : "";

		// Show animated dice if enabled
		if ((/** @type {*} */ (this._state.getSettings()))?.animatedDice) {
			await this._showAnimatedDice(20, rollResult.roll, rollResult.mode === "advantage", rollResult.mode === "disadvantage");
		}

		this._showDiceResult(
			`${Parser.attAbvToFull(ability)} Check${this._getModeLabel(rollResult.mode)}${stateEffectStr}`,
			total,
			this._formatD20BreakdownWithCustom(rollResult, baseMod, customBonus, exhaustionStr, minimumApplied ? aggregated.minimum : null) + sourcesStr,
			resultClass,
			resultNote,
		);
	}

	/**
	 * Format d20 breakdown with custom bonus separated out
	 */
	_formatD20BreakdownWithCustom (rollResult, baseMod, customBonus, extraStr = "", minimumApplied = null) {
		const baseModStr = baseMod >= 0 ? `+ ${baseMod}` : `- ${Math.abs(baseMod)}`;
		const customStr = customBonus !== 0 ? (customBonus > 0 ? ` + ${customBonus}` : ` - ${Math.abs(customBonus)}`) : "";
		const thelemar_critStr = rollResult.thelemar_critBonus
			? (rollResult.thelemar_critBonus > 0 ? ` + ${rollResult.thelemar_critBonus} [Nat 20]` : ` - ${Math.abs(rollResult.thelemar_critBonus)} [Nat 1]`)
			: "";
		const minStr = minimumApplied != null ? ` [min ${minimumApplied}]` : "";

		if (rollResult.mode === "advantage") {
			return `2d20kh (${rollResult.roll1}, ${rollResult.roll2}) → ${minimumApplied ?? rollResult.roll}${minStr} ${baseModStr}${customStr}${thelemar_critStr}${extraStr}`;
		} else if (rollResult.mode === "disadvantage") {
			return `2d20kl (${rollResult.roll1}, ${rollResult.roll2}) → ${minimumApplied ?? rollResult.roll}${minStr} ${baseModStr}${customStr}${thelemar_critStr}${extraStr}`;
		}
		return `1d20 (${rollResult.roll})${minStr} ${baseModStr}${customStr}${thelemar_critStr}${extraStr}`;
	}

	/**
	 * Format d20 breakdown with minimum applied
	 */
	_formatD20BreakdownWithMinimum (rollResult, modifier, extraStr = "", minimumApplied = null) {
		const modStr = modifier >= 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`;
		const thelemar_critStr = rollResult.thelemar_critBonus
			? (rollResult.thelemar_critBonus > 0 ? ` + ${rollResult.thelemar_critBonus} [Nat 20]` : ` - ${Math.abs(rollResult.thelemar_critBonus)} [Nat 1]`)
			: "";
		const minStr = minimumApplied != null ? ` [min ${minimumApplied}]` : "";

		if (rollResult.mode === "advantage") {
			return `2d20kh (${rollResult.roll1}, ${rollResult.roll2}) → ${minimumApplied ?? rollResult.roll}${minStr} ${modStr}${thelemar_critStr}${extraStr}`;
		} else if (rollResult.mode === "disadvantage") {
			return `2d20kl (${rollResult.roll1}, ${rollResult.roll2}) → ${minimumApplied ?? rollResult.roll}${minStr} ${modStr}${thelemar_critStr}${extraStr}`;
		}
		return `1d20 (${rollResult.roll})${minStr} ${modStr}${thelemar_critStr}${extraStr}`;
	}

	async _rollSavingThrow (ability, event) {
		// Check for auto-fail from conditions (e.g., Paralyzed/Stunned → auto-fail STR/DEX saves)
		if (this._state.hasAutoFailFromConditions?.(`save:${ability}`)) {
			this._showDiceResult(
				`${Parser.attAbvToFull(ability)} Save [Auto-Fail]`,
				"FAIL",
				"Automatically failed due to condition",
				"charsheet__dice-result-total--fumble",
				"Auto-failed from active condition",
			);
			return;
		}

		const baseMod = this._state.getSaveMod(ability);
		const exhaustionPenalty = this._getExhaustionPenalty();

		// Get aggregated modifiers for this saving throw
		const aggregated = this._state.aggregateModifiers(`save:${ability}`);
		// Note: baseMod already includes custom save modifiers, avoid double-counting
		const mod = baseMod;

		// Check for advantage/disadvantage from active states and aggregated modifiers
		const advState = this._state.getAdvantageState?.(`save:${ability}`);
		const hasAdvantage = advState?.advantage || aggregated.advantage || this._state.hasAdvantageFromStates(`save:${ability}`);
		const hasDisadvantage = advState?.disadvantage || aggregated.disadvantage || this._state.hasDisadvantageFromStates(`save:${ability}`);

		const rollResult = this._rollD20({event, stateAdvantage: hasAdvantage, stateDisadvantage: hasDisadvantage});

		// Effective adv/dis after combining state with event keys, for the title/label.
		const evtAdv = !!(event && (/** @type {*} */ (event)).shiftKey);
		const evtDis = !!(event && ((/** @type {*} */ (event)).ctrlKey || (/** @type {*} */ (event)).metaKey));
		const effAdvantage = hasAdvantage || evtAdv;
		const effDisadvantage = hasDisadvantage || evtDis;

		// Apply minimum if set
		let effectiveRoll = rollResult.roll;
		let minimumApplied = false;
		if (aggregated.minimum != null && rollResult.roll < aggregated.minimum) {
			effectiveRoll = aggregated.minimum;
			minimumApplied = true;
		}

		const total = effectiveRoll + mod - exhaustionPenalty + (rollResult.thelemar_critBonus || 0);

		// Thelemar crit visual cues
		let resultClass = "";
		let resultNote = "";
		if (rollResult.thelemar_critBonus === 5) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Natural 20! (+5 Thelemar)";
		} else if (rollResult.thelemar_critBonus === -5) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Natural 1! (-5 Thelemar)";
		}
		if (minimumApplied) {
			resultNote = resultNote ? `${resultNote} | Min ${aggregated.minimum} applied` : `Min ${aggregated.minimum} applied (rolled ${rollResult.roll})`;
		}

		// Passive defensive reminders (Evasion, Last Ditch Evasion, etc.).
		const passiveAlerts = this._state.getPassiveSaveAlerts?.(ability) || [];
		if (passiveAlerts.length) {
			const reminderLines = passiveAlerts.map(a => `💡 ${a.name}: ${a.summary}`);
			resultNote = resultNote
				? `${resultNote}\n${reminderLines.join("\n")}`
				: reminderLines.join("\n");
		}

		const exhaustionStr = exhaustionPenalty > 0 ? ` - ${exhaustionPenalty} (exhaustion)` : "";
		const stateEffectStr = (effAdvantage || effDisadvantage) ? this._getActiveStateEffectLabel(effAdvantage, effDisadvantage) : "";
		const sourcesStr = aggregated.sources.length > 0 ? ` [${aggregated.sources.join(", ")}]` : "";

		// Show animated dice if enabled
		if ((/** @type {*} */ (this._state.getSettings()))?.animatedDice) {
			await this._showAnimatedDice(20, rollResult.roll, rollResult.mode === "advantage", rollResult.mode === "disadvantage");
		}

		this._showDiceResult(
			`${Parser.attAbvToFull(ability)} Save${this._getModeLabel(rollResult.mode)}${stateEffectStr}`,
			total,
			this._formatD20BreakdownWithMinimum(rollResult, mod, exhaustionStr, minimumApplied ? aggregated.minimum : null) + sourcesStr,
			resultClass,
			resultNote,
		);
	}

	async _rollSkillCheck (skillKey, skillName, event, overrideAbility = null) {
		const mod = overrideAbility
			? this._state.getSkillModWithAbility(skillKey, overrideAbility)
			: this._state.getSkillMod(skillKey);
		const exhaustionPenalty = this._getExhaustionPenalty();

		// Get aggregated modifiers for this skill
		const aggregated = this._state.aggregateModifiers(`skill:${skillKey}`);
		// Also get check: type modifiers for the underlying ability
		const skillAbility = this._state.getSkillAbility?.(skillKey) || this._getDefaultSkillAbility(skillKey);
		const checkAggregated = this._state.aggregateModifiers(`check:${skillAbility}`);

		// Check for advantage/disadvantage from skill and check modifiers
		const advState = this._state.getAdvantageState?.(`skill:${skillKey}`);
		const hasAdvantage = advState?.advantage || aggregated.advantage || checkAggregated.advantage;
		const hasDisadvantage = advState?.disadvantage || aggregated.disadvantage || checkAggregated.disadvantage;

		const rollResult = this._rollD20({event, stateAdvantage: hasAdvantage, stateDisadvantage: hasDisadvantage});

		// Effective adv/dis after combining state with event keys, for the title/label.
		const evtAdv = !!(event && (/** @type {*} */ (event)).shiftKey);
		const evtDis = !!(event && ((/** @type {*} */ (event)).ctrlKey || (/** @type {*} */ (event)).metaKey));
		const effAdvantage = hasAdvantage || evtAdv;
		const effDisadvantage = hasDisadvantage || evtDis;

		// Apply minimum if set (take the highest minimum from skill and check modifiers)
		let effectiveRoll = rollResult.roll;
		let minimumApplied = false;
		let minimumValue = null;
		if (aggregated.minimum != null || checkAggregated.minimum != null) {
			minimumValue = Math.max(aggregated.minimum ?? 0, checkAggregated.minimum ?? 0);
			if (rollResult.roll < minimumValue) {
				effectiveRoll = minimumValue;
				minimumApplied = true;
			}
		}

		const total = effectiveRoll + mod - exhaustionPenalty + (rollResult.thelemar_critBonus || 0);

		// Thelemar crit visual cues
		let resultClass = "";
		let resultNote = "";
		if (rollResult.thelemar_critBonus === 5) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Natural 20! (+5 Thelemar)";
		} else if (rollResult.thelemar_critBonus === -5) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Natural 1! (-5 Thelemar)";
		}
		if (minimumApplied) {
			resultNote = resultNote ? `${resultNote} | Min ${minimumValue} applied` : `Min ${minimumValue} applied (rolled ${rollResult.roll})`;
		}

		const abilityLabel = overrideAbility ? ` (${overrideAbility.toUpperCase()})` : "";
		const exhaustionStr = exhaustionPenalty > 0 ? ` - ${exhaustionPenalty} (exhaustion)` : "";
		const stateEffectStr = (effAdvantage || effDisadvantage) ? this._getActiveStateEffectLabel(effAdvantage, effDisadvantage) : "";
		const allSources = [...aggregated.sources, ...checkAggregated.sources.filter(s => !aggregated.sources.includes(s))];
		const sourcesStr = allSources.length > 0 ? ` [${allSources.join(", ")}]` : "";

		// Show animated dice if enabled
		if ((/** @type {*} */ (this._state.getSettings()))?.animatedDice) {
			await this._showAnimatedDice(20, rollResult.roll, rollResult.mode === "advantage", rollResult.mode === "disadvantage");
		}

		this._showDiceResult(
			`${skillName}${abilityLabel} Check${this._getModeLabel(rollResult.mode)}${stateEffectStr}`,
			total,
			this._formatD20BreakdownWithMinimum(rollResult, mod, exhaustionStr, minimumApplied ? minimumValue : null) + sourcesStr,
			resultClass,
			resultNote,
		);
	}

	/**
	 * Get the default ability for a skill (delegates to state for custom skill support)
	 */
	_getDefaultSkillAbility (skillKey) {
		// Use state method which includes custom skills
		return this._state.getSkillAbility(skillKey) || "int";
	}

	/**
	 * Cycle skill proficiency: none → proficient → expertise → none
	 * @param {string} skillKey - The skill key (e.g., "stealth", "athletics")
	 */
	_cycleSkillProficiency (skillKey) {
		const currentLevel = this._state.getSkillProficiency(skillKey);
		let newLevel;
		let message;

		if (currentLevel === 0) {
			newLevel = 1;
			message = "Proficient";
		} else if (currentLevel === 1) {
			newLevel = 2;
			message = "Expertise";
		} else {
			newLevel = 0;
			message = "Not proficient";
		}

		this._state.setSkillProficiency(skillKey, newLevel);
		this._saveCurrentCharacter();
		this._renderSkills();

		// Show feedback toast
		const skillName = this.getSkillsList().find(s => s.name.toLowerCase().replace(/\s+/g, "") === skillKey)?.name || skillKey;
		JqueryUtil.doToast({type: "info", content: `${skillName}: ${message}`});
	}

	_showSkillAbilityMenu (event, skillKey, skillName, defaultAbility) {
		event.preventDefault();
		event.stopPropagation();

		// Remove any existing menu
		document.querySelector(".charsheet__ability-menu")?.remove();

		const abilities = ["str", "dex", "con", "int", "wis", "cha"];
		const abilityNames = {
			str: "Strength",
			dex: "Dexterity",
			con: "Constitution",
			int: "Intelligence",
			wis: "Wisdom",
			cha: "Charisma",
		};

		const menu = e_({outer: `<div class="charsheet__ability-menu"></div>`});

		abilities.forEach(ability => {
			const isDefault = ability === defaultAbility;
			const mod = this._state.getSkillModWithAbility(skillKey, ability);
			const modStr = mod >= 0 ? `+${mod}` : mod.toString();
			const optionEl = e_({outer: `
				<div class="charsheet__ability-menu-option ${isDefault ? "charsheet__ability-menu-option--default" : ""}" 
					 title="${isDefault ? "Default ability" : ""}">
					<span class="charsheet__ability-menu-name">${abilityNames[ability]}</span>
					<span class="charsheet__ability-menu-mod">${modStr}</span>
				</div>
			`});
			optionEl.addEventListener("click", (e) => {
				menu.remove();
				this._rollSkillCheck(skillKey, skillName, e, ability);
			});
			menu.append(optionEl);
		});

		// Position menu near cursor
		Object.assign(menu.style, {
			position: "fixed",
			left: `${event.clientX}px`,
			top: `${event.clientY}px`,
			zIndex: 10000,
		});

		document.body.append(menu);

		// Close menu when clicking elsewhere
		const closeMenu = (e) => {
			if (!(/** @type {*} */ (e.target)).closest(".charsheet__ability-menu")) {
				menu.remove();
				document.removeEventListener("click", closeMenu);
			}
		};
		setTimeout(() => document.addEventListener("click", closeMenu), 10);
	}

	async _rollInitiative (event) {
		const mod = this._state.getInitiative();
		const exhaustionPenalty = this._getExhaustionPenalty();
		const rollResult = this._rollD20({event});
		const total = rollResult.roll + mod - exhaustionPenalty + (rollResult.thelemar_critBonus || 0);

		// Thelemar crit visual cues
		let resultClass = "";
		let resultNote = "";
		if (rollResult.thelemar_critBonus === 5) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Natural 20! (+5 Thelemar)";
		} else if (rollResult.thelemar_critBonus === -5) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Natural 1! (-5 Thelemar)";
		}

		const exhaustionStr = exhaustionPenalty > 0 ? ` - ${exhaustionPenalty} (exhaustion)` : "";
		this._showDiceResult(
			`Initiative${this._getModeLabel(rollResult.mode)}`,
			total,
			this._formatD20Breakdown(rollResult, mod, exhaustionStr),
			resultClass,
			resultNote,
		);

		// Trigger initiative-based recovery features (Uncanny Metabolism, Perfect Focus/Self)
		if (this._combat) {
			await this._combat._triggerInitiativeRecovery();
			this._renderHp();
			this._renderResources();
			this._renderOverviewAbilities();
			if (this._features) this._features._renderResources();
		}
	}

	_rollAttack (attack, event) {
		const exhaustionPenalty = this._getExhaustionPenalty();

		// Determine attack type for advantage/disadvantage matching
		// Build specific attack type like "attack:melee:str" for proper matching with effects
		const isMelee = attack.isMelee || attack.type === "melee" || attack.range === "melee"
			|| (attack.range && !attack.range.includes("/"));
		const abilityUsed = attack.abilityMod || attack.ability || (isMelee ? "str" : "dex");
		const attackType = `attack:${isMelee ? "melee" : "ranged"}:${abilityUsed}`;

		// Check for advantage/disadvantage from active states using specific attack type
		const hasAdvantage = this._state.hasAdvantageFromStates(attackType);
		const hasDisadvantage = this._state.hasDisadvantageFromStates(attackType);

		const rollResult = this._rollD20({event, stateAdvantage: hasAdvantage, stateDisadvantage: hasDisadvantage, isAttack: true});
		const attackTotal = rollResult.roll + attack.attackBonus - exhaustionPenalty;

		// Check for crit/fumble
		let resultClass = "";
		let resultNote = "";
		if (rollResult.roll === 20) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Critical Hit!";
		} else if (rollResult.roll === 1) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Critical Miss!";
		}

		// Parse and roll damage
		let damageRoll = attack.damage;

		// Check for rage damage bonus on melee STR attacks (using isMelee/abilityUsed computed above)
		const rageDamage = this._state.getRageDamageBonus(isMelee, abilityUsed);

		// Add any bonus damage from active states
		const stateBonusDamage = this._state.getBonusFromStates("damage");
		const totalBonusDamage = rageDamage + stateBonusDamage;

		let damageStr = attack.damage;
		if (totalBonusDamage > 0) {
			damageStr = `${attack.damage} + ${totalBonusDamage}`;
		}

		const damageResult = Renderer.dice.parseRandomise2(attack.damage);
		const totalDamage = damageResult + totalBonusDamage;

		const exhaustionStr = exhaustionPenalty > 0 ? ` - ${exhaustionPenalty} (exhaustion)` : "";
		const stateEffectStr = (hasAdvantage || hasDisadvantage) ? this._getActiveStateEffectLabel(hasAdvantage, hasDisadvantage) : "";
		const rageDamageStr = rageDamage > 0 ? ` + ${rageDamage} (rage)` : "";
		const stateDamageStr = stateBonusDamage > 0 ? ` + ${stateBonusDamage} (states)` : "";

		this._showDiceResult(
			`${attack.name}${this._getModeLabel(rollResult.mode)}${stateEffectStr}`,
			attackTotal,
			`Attack: ${this._formatD20Breakdown(rollResult, attack.attackBonus, exhaustionStr)}
			 Damage: ${attack.damage} = ${damageResult}${rageDamageStr}${stateDamageStr}${totalBonusDamage > 0 ? ` → ${totalDamage}` : ""}`,
			resultClass,
			resultNote,
		);
	}

	// Public methods for sub-modules
	rollDice (num, sides) {
		let total = 0;
		for (let i = 0; i < num; i++) {
			total += RollerUtil.randomise(sides);
		}
		return total;
	}

	/**
	 * Roll a d20 with advantage/disadvantage support (public method for sub-modules)
	 * @param {Object} opts - Roll options
	 * @param {Event} [opts.event] - The triggering event (to detect modifier keys)
	 * @param {"advantage"|"disadvantage"|"normal"} [opts.mode] - Force a specific mode
	 * @returns {{roll: number, roll1: number, roll2: number, mode: string}} Roll result
	 */
	rollD20 (opts) {
		return this._rollD20(opts);
	}

	/**
	 * Format a d20 roll breakdown string (public method for sub-modules)
	 */
	formatD20Breakdown (rollResult, modifier, extraStr = "") {
		return this._formatD20Breakdown(rollResult, modifier, extraStr);
	}

	/**
	 * Get mode label (public method for sub-modules)
	 */
	getModeLabel (mode) {
		return this._getModeLabel(mode);
	}

	showDiceResult (opts) {
		if (typeof opts === "string") {
			// Legacy call: showDiceResult(title, total, breakdown)
			this._showDiceResult(...arguments);
		} else {
			// New object format
			const breakdown = opts.subtitle || `1d20 (${opts.roll}) ${opts.modifier >= 0 ? "+" : ""}${opts.modifier}`;

			// Check if animated dice is enabled and we have dice info
			if ((/** @type {*} */ (this._state.getSettings()))?.animatedDice && opts.roll !== undefined) {
				this._showAnimatedDice(opts.diceType || 20, opts.roll, opts.isAdvantage, opts.isDisadvantage)
					.then(() => {
						this._showDiceResult(opts.title, opts.total, breakdown, opts.resultClass, opts.resultNote);
					});
			} else {
				this._showDiceResult(opts.title, opts.total, breakdown, opts.resultClass, opts.resultNote);
			}
		}
	}

	/**
	 * Show animated dice rolling overlay
	 * @param {number} diceType - The type of die (4, 6, 8, 10, 12, 20, 100)
	 * @param {number} finalValue - The value the die should land on
	 * @param {boolean} isAdvantage - Whether rolling with advantage
	 * @param {boolean} isDisadvantage - Whether rolling with disadvantage
	 * @returns {Promise} Resolves when animation is complete
	 */
	async _showAnimatedDice (diceType, finalValue, isAdvantage = false, isDisadvantage = false) {
		const theme = (/** @type {*} */ (this._state.getSettings()))?.diceTheme || "standard";
		const themeColors = {
			// Classic themes
			standard: {bg: "#dc3545", bgDark: "#a71d2a", pip: "#fff", text: "#fff", shadow: "rgba(220, 53, 69, 0.6)", glow: "rgba(220, 53, 69, 0.3)", accent: "#ff6b7a"},
			blue: {bg: "#0d6efd", bgDark: "#0a58ca", pip: "#fff", text: "#fff", shadow: "rgba(13, 110, 253, 0.6)", glow: "rgba(13, 110, 253, 0.3)", accent: "#5c9aff"},
			gold: {bg: "#ffc107", bgDark: "#d39e00", pip: "#000", text: "#000", shadow: "rgba(255, 193, 7, 0.6)", glow: "rgba(255, 193, 7, 0.3)", accent: "#ffe066"},
			purple: {bg: "#6f42c1", bgDark: "#5a32a3", pip: "#fff", text: "#fff", shadow: "rgba(111, 66, 193, 0.6)", glow: "rgba(111, 66, 193, 0.3)", accent: "#9f7ae5"},
			green: {bg: "#198754", bgDark: "#146c43", pip: "#fff", text: "#fff", shadow: "rgba(25, 135, 84, 0.6)", glow: "rgba(25, 135, 84, 0.3)", accent: "#4ead82"},
			dark: {bg: "#343a40", bgDark: "#1d2124", pip: "#e0e0e0", text: "#fff", shadow: "rgba(33, 37, 41, 0.6)", glow: "rgba(100, 100, 100, 0.3)", accent: "#6c757d"},
			// Creative themes
			cosmic: {bg: "linear-gradient(135deg, #1a0533 0%, #4a1a6e 50%, #0d1b2a 100%)", bgDark: "#0a0118", pip: "#e0d4ff", text: "#e0d4ff", shadow: "rgba(138, 43, 226, 0.7)", glow: "rgba(186, 85, 211, 0.5)", accent: "#da70d6", special: "cosmic"},
			inferno: {bg: "linear-gradient(135deg, #ff4500 0%, #dc143c 50%, #8b0000 100%)", bgDark: "#4a0000", pip: "#fff5e0", text: "#fff5e0", shadow: "rgba(255, 69, 0, 0.7)", glow: "rgba(255, 140, 0, 0.5)", accent: "#ff8c00", special: "inferno"},
			frost: {bg: "linear-gradient(135deg, #e0f7ff 0%, #87ceeb 50%, #4682b4 100%)", bgDark: "#1e4d6b", pip: "#001a33", text: "#001a33", shadow: "rgba(135, 206, 235, 0.7)", glow: "rgba(224, 247, 255, 0.6)", accent: "#b0e0e6", special: "frost"},
			nature: {bg: "linear-gradient(135deg, #228b22 0%, #2e8b57 50%, #006400 100%)", bgDark: "#003000", pip: "#f0fff0", text: "#f0fff0", shadow: "rgba(34, 139, 34, 0.7)", glow: "rgba(144, 238, 144, 0.4)", accent: "#90ee90", special: "nature"},
			arcane: {bg: "linear-gradient(135deg, #9932cc 0%, #4b0082 50%, #191970 100%)", bgDark: "#0d0030", pip: "#e6e6fa", text: "#e6e6fa", shadow: "rgba(153, 50, 204, 0.7)", glow: "rgba(218, 112, 214, 0.5)", accent: "#da70d6", special: "arcane"},
			blood: {bg: "linear-gradient(135deg, #8b0000 0%, #660000 50%, #330000 100%)", bgDark: "#1a0000", pip: "#ffcccc", text: "#ffcccc", shadow: "rgba(139, 0, 0, 0.8)", glow: "rgba(178, 34, 34, 0.4)", accent: "#b22222", special: "blood"},
			ocean: {bg: "linear-gradient(135deg, #006994 0%, #004c6d 50%, #003049 100%)", bgDark: "#001a26", pip: "#e0ffff", text: "#e0ffff", shadow: "rgba(0, 105, 148, 0.7)", glow: "rgba(64, 224, 208, 0.4)", accent: "#40e0d0", special: "ocean"},
			storm: {bg: "linear-gradient(135deg, #1c1c3c 0%, #2f2f5f 50%, #1a1a2e 100%)", bgDark: "#0a0a15", pip: "#ffff99", text: "#ffff99", shadow: "rgba(255, 255, 0, 0.5)", glow: "rgba(135, 206, 250, 0.6)", accent: "#87cefa", special: "storm"},
			void: {bg: "linear-gradient(135deg, #0d0d0d 0%, #1a1a2e 50%, #000000 100%)", bgDark: "#000000", pip: "#9966cc", text: "#9966cc", shadow: "rgba(75, 0, 130, 0.6)", glow: "rgba(138, 43, 226, 0.3)", accent: "#8a2be2", special: "void"},
			radiant: {bg: "linear-gradient(135deg, #fffacd 0%, #ffd700 50%, #daa520 100%)", bgDark: "#b8860b", pip: "#fff8dc", text: "#4a3000", shadow: "rgba(255, 215, 0, 0.8)", glow: "rgba(255, 255, 224, 0.7)", accent: "#ffffe0", special: "radiant"},
		};
		const colors = themeColors[theme] || themeColors.standard;

		// Generate pip pattern for d6
		const generatePips = (value) => {
			const pipPositions = {
				1: ["center"],
				2: ["top-right", "bottom-left"],
				3: ["top-right", "center", "bottom-left"],
				4: ["top-left", "top-right", "bottom-left", "bottom-right"],
				5: ["top-left", "top-right", "center", "bottom-left", "bottom-right"],
				6: ["top-left", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-right"],
			};
			const positions = pipPositions[value] || [];
			return positions.map(pos => `<span class="charsheet__dice-pip charsheet__dice-pip--${pos}"></span>`).join("");
		};

		// Get dice shape class
		const getDiceShape = () => {
			switch (diceType) {
				case 4: return "charsheet__dice--d4";
				case 6: return "charsheet__dice--d6";
				case 8: return "charsheet__dice--d8";
				case 10: return "charsheet__dice--d10";
				case 12: return "charsheet__dice--d12";
				case 20: return "charsheet__dice--d20";
				case 100: return "charsheet__dice--d100";
				default: return "";
			}
		};

		const diceShape = getDiceShape();
		const specialClass = colors.special ? `charsheet__dice--${colors.special}` : "";
		const bgStyle = colors.special ? `background: ${colors.bg}` : `--dice-bg: ${colors.bg}; --dice-bg-dark: ${colors.bgDark}`;

		// Create dice face content - pips for d6, numbers for others
		const createFaceContent = (value) => {
			if (diceType === 6 && value >= 1 && value <= 6) {
				return `<div class="charsheet__dice-face">${generatePips(value)}</div>`;
			}
			return `<span class="charsheet__dice-value">${value}</span>`;
		};

		// Create overlay
		const overlay = e_({outer: `
			<div class="charsheet__dice-overlay">
				<div class="charsheet__dice-container">
					<div class="charsheet__dice ${diceShape} ${specialClass} charsheet__dice--rolling" style="${bgStyle}; --dice-pip: ${colors.pip}; --dice-text: ${colors.text}; --dice-shadow: ${colors.shadow}; --dice-glow: ${colors.glow}; --dice-accent: ${colors.accent}">
						${createFaceContent("?")}
						<span class="charsheet__dice-type">d${diceType}</span>
					</div>
				</div>
			</div>
		`});

		document.body.append(overlay);

		// Animate random values
		const dice = overlay.querySelector(".charsheet__dice");
		const maxValue = diceType === 100 ? 100 : diceType;
		let animationCycles = 0;
		const maxCycles = 12;

		// Helper to update dice face
		const updateFace = (value) => {
			if (diceType === 6) {
				dice.querySelector(".charsheet__dice-face")?.remove();
				dice.querySelector(".charsheet__dice-value")?.remove();
				dice.insertAdjacentHTML("afterbegin", createFaceContent(value));
			} else {
				let value = dice.querySelector(".charsheet__dice-value");
				if (!value) {
					dice.insertAdjacentHTML("afterbegin", `<span class="charsheet__dice-value">${value}</span>`);
				} else {
					value.textContent = value;
				}
			}
		};

		return new Promise(resolve => {
			const animate = () => {
				if (animationCycles < maxCycles) {
					const randomVal = diceType === 100
						? (Math.floor(Math.random() * 10) + 1) * 10
						: Math.floor(Math.random() * maxValue) + 1;
					updateFace(randomVal);
					animationCycles++;

					let delay;
					if (animationCycles < 4) {
						delay = 60;
					} else if (animationCycles < 8) {
						delay = 80;
					} else {
						delay = 120 + (animationCycles - 8) * 40;
					}

					setTimeout(animate, delay);
				} else {
					// Show final value with landing animation
					updateFace(finalValue);
					dice.classList.remove("charsheet__dice--rolling");
					dice.classList.add("charsheet__dice--landed");

					// Check for critical/fumble styling
					if (diceType === 20) {
						if (finalValue === 20) {
							dice.classList.add("charsheet__dice--critical");
						} else if (finalValue === 1) {
							dice.classList.add("charsheet__dice--fumble");
						}
					}

					// Remove after delay
					const displayTime = (finalValue === 20 || finalValue === 1) && diceType === 20 ? 1000 : 700;
					setTimeout(() => {
						overlay.style.transition = "opacity 150ms";
						overlay.style.opacity = "0";
						setTimeout(() => { overlay.remove(); resolve(); }, 150);
					}, displayTime);
				}
			};

			setTimeout(animate, 50);
		});
	}

	_showDiceResult (title, total, breakdown, resultClass = "", resultNote = "", {duration = 5000} = {}) {
		// Log to roll history
		this._rollHistory?.addRoll({title, total, breakdown, resultClass, resultNote});

		// Remove existing result
		document.querySelector(".charsheet__dice-result")?.remove();

		const totalClass = resultClass ? ` ${resultClass}` : "";
		const noteHtml = resultNote ? `<div class="charsheet__dice-result-note">${resultNote}</div>` : "";

		const resultEl = e_({outer: `
			<div class="charsheet__dice-result" role="status" aria-live="assertive">
				<span class="charsheet__dice-result-close glyphicon glyphicon-remove"></span>
				<div class="charsheet__dice-result-header">${title}</div>
				<div class="charsheet__dice-result-total${totalClass}">${total}</div>
				<div class="charsheet__dice-result-breakdown">${breakdown}</div>
				${noteHtml}
			</div>
		`});

		resultEl.querySelector(".charsheet__dice-result-close").addEventListener("click", () => resultEl.remove());
		document.body.append(resultEl);

		setTimeout(() => setTimeout(() => resultEl.remove(), 300), duration);
	}
	// #endregion

	// #region Utilities
	_formatMod (mod) {
		return mod >= 0 ? `+${mod}` : `${mod}`;
	}

	/**
	 * Render AC breakdown popup content
	 * @param {object} breakdown - Object from getAcBreakdown() with total and components
	 */
	_renderAcBreakdown (breakdown) {
		const container = document.getElementById("charsheet-ac-breakdown");
		container.innerHTML = "";

		if (!breakdown.components.length) {
			container.innerHTML = `<div class="charsheet__ac-breakdown-item"><span>Base AC</span><span>10</span></div>`;
			return;
		}

		breakdown.components.forEach(comp => {
			const valueClass = comp.value > 0 && comp.type !== "base" && comp.type !== "armor" ? "charsheet__ac-breakdown-value--positive"
				: comp.value < 0 ? "charsheet__ac-breakdown-value--negative" : "";
			const displayValue = comp.type === "base" || comp.type === "armor" ? comp.value : this._formatMod(comp.value);
			const subtypeHtml = comp.subtype ? `<span class="charsheet__ac-breakdown-subtype">(${comp.subtype})</span>` : "";

			container.insertAdjacentHTML("beforeend", `
				<div class="charsheet__ac-breakdown-item">
					<span class="charsheet__ac-breakdown-name">
						<span class="charsheet__ac-breakdown-icon">${comp.icon || ""}</span>
						${comp.name}${subtypeHtml}
					</span>
					<span class="charsheet__ac-breakdown-value ${valueClass}">${displayValue}</span>
				</div>
			`);
		});

		// Add total line
		container.insertAdjacentHTML("beforeend", `
			<div class="charsheet__ac-breakdown-item charsheet__ac-breakdown-item--total">
				<span class="charsheet__ac-breakdown-name">
					<span class="charsheet__ac-breakdown-icon">🛡️</span>
					Total AC
				</span>
				<span class="charsheet__ac-breakdown-value charsheet__ac-breakdown-value--total">${breakdown.total}</span>
			</div>
		`);
	}

	/**
	 * Show AC breakdown in a modal dialog
	 */
	async _showAcBreakdownModal () {
		const breakdown = this._state.getAcBreakdown();

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "🛡️ Armor Class Breakdown",
			isMinHeight0: true,
		});

		const contentEl = e_({outer: `<div class="charsheet__ac-modal-content"></div>`}); modalInner.append(contentEl);

		// Large AC display
		const acDisplay = e_({outer: `
			<div class="charsheet__ac-modal-total">
				<div class="charsheet__ac-modal-total-value">${breakdown.total}</div>
				<div class="charsheet__ac-modal-total-label">Total AC</div>
			</div>
		`}); contentEl.append(acDisplay);

		// Breakdown list
		const breakdownList = e_({outer: `<div class="charsheet__ac-modal-breakdown"></div>`}); contentEl.append(breakdownList);

		if (!breakdown.components.length) {
			breakdownList.insertAdjacentHTML("beforeend", `
				<div class="charsheet__ac-modal-item">
					<span class="charsheet__ac-modal-item-name">
						<span class="charsheet__ac-modal-item-icon">🧍</span>
						Base AC (Unarmored)
					</span>
					<span class="charsheet__ac-modal-item-value">10</span>
				</div>
			`);
		} else {
			breakdown.components.forEach(comp => {
				const valueClass = comp.value > 0 && comp.type !== "base" && comp.type !== "armor" ? "charsheet__ac-modal-item-value--positive"
					: comp.value < 0 ? "charsheet__ac-modal-item-value--negative" : "";
				const displayValue = comp.type === "base" || comp.type === "armor" ? comp.value : this._formatMod(comp.value);
				const subtypeHtml = comp.subtype ? `<span class="charsheet__ac-modal-item-subtype">(${comp.subtype})</span>` : "";

				breakdownList.insertAdjacentHTML("beforeend", `
					<div class="charsheet__ac-modal-item">
						<span class="charsheet__ac-modal-item-name">
							<span class="charsheet__ac-modal-item-icon">${comp.icon || "📦"}</span>
							${comp.name}${subtypeHtml}
						</span>
						<span class="charsheet__ac-modal-item-value ${valueClass}">${displayValue}</span>
					</div>
				`);
			});
		}

		// Additional info
		const equippedArmor = this._state.getItems().find(i => i.equipped && i._isArmor);
		const equippedShield = this._state.getItems().find(i => i.equipped && i._isShield);

		if (equippedArmor || equippedShield) {
			const equipment = e_({outer: `<div class="charsheet__ac-modal-equipment"></div>`}); contentEl.append(equipment);
			equipment.insertAdjacentHTML("beforeend", `<div class="charsheet__ac-modal-equipment-title">⚔️ Equipped Protection</div>`);

			if (equippedArmor) {
				equipment.insertAdjacentHTML("beforeend", `<div class="charsheet__ac-modal-equipment-item">🛡️ ${equippedArmor.name}</div>`);
			}
			if (equippedShield) {
				equipment.insertAdjacentHTML("beforeend", `<div class="charsheet__ac-modal-equipment-item">🔰 ${equippedShield.name}</div>`);
			}
		}

		// Close button
		const closeFooter = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-primary">Close</button>
		</div>`;
		modalInner.append(closeFooter);
		closeFooter.querySelector("button").addEventListener("click", () => doClose(false));
	}

	/**
	 * Generic stat breakdown renderer — renders components into a hover popup container
	 * Uses same visual pattern as AC breakdown but works for any stat
	 * @param {string} selector - selector for the breakdown container
	 * @param {{total: number, components: Array<{type: string, name: string, value: number, icon: string, subtype?: string}>}} breakdown
	 */
	_renderStatBreakdown (selector, breakdown) {
		const container = document.querySelector(selector);
		container.innerHTML = "";

		if (!breakdown || !breakdown.components.length) return;

		breakdown.components.forEach(comp => {
			const valueClass = comp.value > 0 && comp.type !== "base" ? "charsheet__ac-breakdown-value--positive"
				: comp.value < 0 ? "charsheet__ac-breakdown-value--negative" : "";
			const displayValue = comp.type === "base" ? comp.value : this._formatMod(comp.value);
			const subtypeHtml = comp.subtype ? `<span class="charsheet__ac-breakdown-subtype">(${comp.subtype})</span>` : "";

			container.insertAdjacentHTML("beforeend", `
				<div class="charsheet__ac-breakdown-item">
					<span class="charsheet__ac-breakdown-name">
						<span class="charsheet__ac-breakdown-icon">${comp.icon || ""}</span>
						${comp.name}${subtypeHtml}
					</span>
					<span class="charsheet__ac-breakdown-value ${valueClass}">${displayValue}</span>
				</div>
			`);
		});

		container.insertAdjacentHTML("beforeend", `
			<div class="charsheet__ac-breakdown-item charsheet__ac-breakdown-item--total">
				<span class="charsheet__ac-breakdown-name">
					<span class="charsheet__ac-breakdown-icon">🎯</span>
					Total
				</span>
				<span class="charsheet__ac-breakdown-value charsheet__ac-breakdown-value--total">${this._formatMod(breakdown.total)}</span>
			</div>
		`);
	}

	/**
	 * Show speed breakdown in a modal dialog (click handler for speed box)
	 */
	async _showSpeedBreakdownModal () {
		const walkBreakdown = this._state.getSpeedBreakdown("walk");
		const speedTypes = ["fly", "swim", "climb", "burrow"];
		const otherBreakdowns = speedTypes
			.map(type => ({type, breakdown: this._state.getSpeedBreakdown(type)}))
			.filter(({breakdown}) => breakdown.total > 0 || breakdown.components.length > 0);

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "🏃 Speed Breakdown",
			isMinHeight0: true,
		});

		const contentEl = e_({outer: `<div class="charsheet__ac-modal-content"></div>`}); modalInner.append(contentEl);

		// Walk speed display
		contentEl.insertAdjacentHTML("beforeend", `
			<div class="charsheet__ac-modal-total">
				<div class="charsheet__ac-modal-total-value">${walkBreakdown.total} ft.</div>
				<div class="charsheet__ac-modal-total-label">Walking Speed</div>
			</div>
		`);

		// Walk breakdown
		const walkList = e_({outer: `<div class="charsheet__ac-modal-breakdown"></div>`}); contentEl.append(walkList);
		this._renderModalBreakdownItems(walkList, walkBreakdown, "ft.");

		// Other movement types
		for (const {type, breakdown} of otherBreakdowns) {
			const label = type.charAt(0).toUpperCase() + type.slice(1);
			contentEl.insertAdjacentHTML("beforeend", `
				<div class="charsheet__ac-modal-total mt-3">
					<div class="charsheet__ac-modal-total-value" style="font-size: 1.5rem;">${breakdown.total} ft.</div>
					<div class="charsheet__ac-modal-total-label">${label} Speed</div>
				</div>
			`);
			const listEl = e_({outer: `<div class="charsheet__ac-modal-breakdown"></div>`}); contentEl.append(listEl);
			this._renderModalBreakdownItems(listEl, breakdown, "ft.");
		}

		const closeFooter2 = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-primary">Close</button>
		</div>`;
		modalInner.append(closeFooter2);
		closeFooter2.querySelector("button").addEventListener("click", () => doClose(false));
	}

	/**
	 * Show HP breakdown in a modal dialog (click handler for HP card).
	 * Surfaces per-level HP gain (max/rolled/average), CON contribution per level,
	 * and any flat or per-level HP bonuses (Toughness, racial, magic items).
	 */
	async _showHpBreakdownModal () {
		const bd = this._state.getHpBreakdown();

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "❤️ Hit Points Breakdown",
			isMinHeight0: true,
		});

		const contentEl = e_({outer: `<div class="charsheet__ac-modal-content"></div>`}); modalInner.append(contentEl);

		// Top: total HP + temp HP chip
		const tempChip = bd.tempHp > 0
			? `<span class="charsheet__ac-modal-item-subtype">+${bd.tempHp} temp</span>`
			: "";
		contentEl.insertAdjacentHTML("beforeend", `
			<div class="charsheet__ac-modal-total">
				<div class="charsheet__ac-modal-total-value">${bd.current} / ${bd.total} ${tempChip}</div>
				<div class="charsheet__ac-modal-total-label">Hit Points (CON ${this._formatMod(bd.conMod)})</div>
			</div>
		`);

		// Per-level breakdown
		contentEl.insertAdjacentHTML("beforeend", `
			<div class="charsheet__ac-modal-equipment-title mt-2">📈 Per Level</div>
		`);
		const perLevelList = e_({outer: `<div class="charsheet__ac-modal-breakdown"></div>`}); contentEl.append(perLevelList);

		bd.perLevel.forEach(p => {
			const sourceLabels = {max: "Max", rolled: "Rolled", average: "Average", fallback: "Average"};
			const sourceLabel = sourceLabels[p.source] || p.source;
			const sourceClass = p.source === "rolled" ? "charsheet__ac-modal-item-value--positive"
				: p.source === "max" ? "charsheet__ac-modal-item-value--positive"
					: "";
			const baseDescr = p.source === "rolled" && p.rolled !== p.base
				? `${p.base} (rolled ${p.rolled}, capped at d${p.hitDie})`
				: `${p.base} (d${p.hitDie} ${sourceLabel.toLowerCase()})`;
			const conPart = `${this._formatMod(p.conContribution)} CON`;
			const formula = `${baseDescr} ${conPart}`;
			perLevelList.insertAdjacentHTML("beforeend", `
				<div class="charsheet__ac-modal-item">
					<span class="charsheet__ac-modal-item-name">
						<span class="charsheet__ac-modal-item-icon">${p.isFirstLevel ? "🌟" : "❤️"}</span>
						Level ${p.level} (${p.className || "—"})
						<span class="charsheet__ac-modal-item-subtype ${sourceClass}">${formula}</span>
					</span>
					<span class="charsheet__ac-modal-item-value charsheet__ac-modal-item-value--positive">+${p.levelTotal}</span>
				</div>
			`);
		});

		// Bonus sections
		const hasFlat = bd.flatBonus.value !== 0 || bd.flatBonus.sources.length > 0;
		const hasPerLevel = bd.perLevelBonus.value !== 0 || bd.perLevelBonus.sources.length > 0;

		if (hasFlat || hasPerLevel) {
			contentEl.insertAdjacentHTML("beforeend", `
				<div class="charsheet__ac-modal-equipment-title mt-2">✨ Bonuses</div>
			`);
			const bonusList = e_({outer: `<div class="charsheet__ac-modal-breakdown"></div>`}); contentEl.append(bonusList);

			bd.flatBonus.sources.forEach(s => {
				bonusList.insertAdjacentHTML("beforeend", `
					<div class="charsheet__ac-modal-item">
						<span class="charsheet__ac-modal-item-name">
							<span class="charsheet__ac-modal-item-icon">✨</span>
							${s.name}
							<span class="charsheet__ac-modal-item-subtype">flat</span>
						</span>
						<span class="charsheet__ac-modal-item-value ${s.value >= 0 ? "charsheet__ac-modal-item-value--positive" : "charsheet__ac-modal-item-value--negative"}">${this._formatMod(s.value)}</span>
					</div>
				`);
			});

			bd.perLevelBonus.sources.forEach(s => {
				const aggregated = s.value * bd.totalLevel;
				bonusList.insertAdjacentHTML("beforeend", `
					<div class="charsheet__ac-modal-item">
						<span class="charsheet__ac-modal-item-name">
							<span class="charsheet__ac-modal-item-icon">📈</span>
							${s.name}
							<span class="charsheet__ac-modal-item-subtype">${this._formatMod(s.value)} × ${bd.totalLevel} levels</span>
						</span>
						<span class="charsheet__ac-modal-item-value ${aggregated >= 0 ? "charsheet__ac-modal-item-value--positive" : "charsheet__ac-modal-item-value--negative"}">${this._formatMod(aggregated)}</span>
					</div>
				`);
			});
		}

		// Total row
		const totalList = e_({outer: `<div class="charsheet__ac-modal-breakdown mt-2"></div>`}); contentEl.append(totalList);
		totalList.insertAdjacentHTML("beforeend", `
			<div class="charsheet__ac-modal-item" style="border-top: 2px solid var(--cs-border, #ddd); padding-top: 0.5rem;">
				<span class="charsheet__ac-modal-item-name">
					<span class="charsheet__ac-modal-item-icon">❤️</span>
					Maximum HP
				</span>
				<span class="charsheet__ac-modal-item-value charsheet__ac-modal-item-value--positive" style="font-size: 1.2rem; font-weight: bold;">${bd.total}</span>
			</div>
		`);

		// Legacy fallback note
		if (bd.legacyFallback) {
			contentEl.insertAdjacentHTML("beforeend", `
				<div class="charsheet__ac-modal-equipment mt-2">
					<div class="charsheet__ac-modal-equipment-item" style="font-style: italic;">
						⚠️ Some level entries weren't recorded — values shown use the average formula. Use Respec to lock in specific rolls.
					</div>
				</div>
			`);
		}

		const closeFooter3 = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-primary">Close</button>
		</div>`;
		modalInner.append(closeFooter3);
		closeFooter3.querySelector("button").addEventListener("click", () => doClose(false));
	}

	/**
	 * Render breakdown items into a modal list container
	 * @param {HTMLElement} listEl - The list container
	 * @param {{total: number, components: Array}} breakdown - The breakdown data
	 * @param {string} [unit=""] - Optional unit suffix (e.g., "ft.")
	 */
	_renderModalBreakdownItems (listEl, breakdown, unit = "") {
		if (!breakdown.components.length) {
			listEl.insertAdjacentHTML("beforeend", `<div class="charsheet__ac-modal-item"><span class="charsheet__ac-modal-item-name">No modifiers</span></div>`);
			return;
		}

		breakdown.components.forEach(comp => {
			const valueClass = comp.value > 0 && comp.type !== "base" ? "charsheet__ac-modal-item-value--positive"
				: comp.value < 0 ? "charsheet__ac-modal-item-value--negative" : "";
			const displayValue = comp.type === "base" ? `${comp.value}${unit ? ` ${unit}` : ""}` : `${this._formatMod(comp.value)}${unit ? ` ${unit}` : ""}`;
			const subtypeHtml = comp.subtype ? `<span class="charsheet__ac-modal-item-subtype">(${comp.subtype})</span>` : "";

			listEl.insertAdjacentHTML("beforeend", `
				<div class="charsheet__ac-modal-item">
					<span class="charsheet__ac-modal-item-name">
						<span class="charsheet__ac-modal-item-icon">${comp.icon || "📦"}</span>
						${comp.name}${subtypeHtml}
					</span>
					<span class="charsheet__ac-modal-item-value ${valueClass}">${displayValue}</span>
				</div>
			`);
		});
	}

	/**
	 * Create a 5etools hover link (instance method for sub-modules)
	 * @param {string} page - The page URL (e.g., "conditionsdiseases.html", "items.html")
	 * @param {string} name - Entity name (used for hash/lookup)
	 * @param {string} source - Source book abbreviation
	 * @param {string} [hash] - Optional hash override
	 * @param {string} [displayName] - Optional display name override
	 * @returns {string} HTML string for the link
	 */
	getHoverLink (page, name, source, hash = null, displayName = null, hrefOverride = null) {
		return CharacterSheetPage.getHoverLink(page, name, source, hash, displayName, hrefOverride);
	}

	/**
	 * Create a spell hover link with character-aware content (metamagic mods + Thelemar rarity/legality).
	 * Renders the same 2-column layout as the standard 5etools spell hover, with modifications injected.
	 * Falls back to standard hover link if spellData is missing or there are no charsheet modifications.
	 */
	getSpellHoverLink (name, source, spellData, characterSpell) {
		if (!spellData) return this.getHoverLink(UrlUtil.PG_SPELLS, name, source);

		try {
			const state = this.getState();
			const modStats = state?.getModifiedSpellStats?.(spellData);
			const hasCharsheetMods = modStats?.range?.changed || modStats?.duration?.changed
				|| modStats?.notes?.length
				|| (characterSpell?.subschools || []).some(s => s.startsWith("rarity:") || s.startsWith("legality:"));

			// If no charsheet-specific mods, use the standard hover (prettiest by default)
			if (!hasCharsheetMods) return this.getHoverLink(UrlUtil.PG_SPELLS, name, source);

			// Build custom hover rows and cache them
			const hoverRows = CharacterSheetPage._buildSpellHoverRows(spellData, characterSpell, modStats);
			const hoverEntry = {name: spellData.name, _charsheetSpellRows: hoverRows};
			const id = Renderer.hover._getNextId();
			Renderer.hover._entryCache[id] = hoverEntry;

			const hash = UrlUtil.encodeForHash([name, source].join(HASH_LIST_SEP));
			const href = `${UrlUtil.PG_SPELLS}#${hash}`;

			const hoverAttrs = [
				`onmouseover="CharacterSheetPage._handleSpellHoverMouseOver(event, this, ${id})"`,
				`onmousemove="Renderer.hover.handlePredefinedMouseMove(event, this)"`,
				`onmouseleave="Renderer.hover.handlePredefinedMouseLeave(event, this)"`,
				Renderer.hover.getPreventTouchString(),
			].join(" ");

			return `<a href="${href}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${name}</a>`;
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("[CharSheet] getSpellHoverLink error:", e);
			return this.getHoverLink(UrlUtil.PG_SPELLS, name, source);
		}
	}

	/**
	 * Custom mouseover handler for spell hovers with charsheet modifications.
	 * Renders our pre-built rows in a proper ve-stats table element, bypassing
	 * the generic entry rendering path.
	 */
	static _handleSpellHoverMouseOver (evt, ele, entryId) {
		Renderer.hover._doInit();

		const meta = Renderer.hover._handleGenericMouseOverStart({evt, ele});
		if (meta == null) return;

		Renderer.hover.cleanTempWindows();

		const toRender = Renderer.hover._entryCache[entryId];
		meta.isLoading = false;

		if (!meta.isHovered && !meta.isPermanent) return;

		const tableEl = e_({
			tag: "table",
			clazz: "ve-w-100 ve-stats",
			html: toRender._charsheetSpellRows,
		});

		meta.windowMeta = Renderer.hover.getShowWindow(
			tableEl,
			Renderer.hover.getWindowPositionFromEvent(evt, {isPreventFlicker: !meta.isPermanent}),
			{
				title: toRender.name || "",
				isPermanent: meta.isPermanent,
				cbClose: () => meta.isHovered = meta.isPermanent = meta.isLoading = false,
				sourceData: toRender,
			},
		);

		ele.style.cursor = "";
	}

	/**
	 * Build HTML table rows for a custom spell hover, matching the standard 5etools
	 * spell compact layout (2-column flex grid) with metamagic and rarity injected.
	 * Uses the real Parser formatting methods so text is identical to the site hover.
	 */
	static _buildSpellHoverRows (spellData, characterSpell, modStats) {
		// Use the same static helpers the real spell hover uses
		const htmlPtLevelSchool = Renderer.spell.getHtmlPtLevelSchoolRitual(spellData);
		const htmlPtCastingTime = Renderer.spell.getHtmlPtCastingTime(spellData);
		let htmlPtRange = Renderer.spell.getHtmlPtRange(spellData);
		const htmlPtComponents = Renderer.spell.getHtmlPtComponents(spellData);
		let htmlPtDuration = Renderer.spell.getHtmlPtDuration(spellData);

		// Inject metamagic range modification
		if (modStats?.range?.changed) {
			htmlPtRange += ` <span style="color: #10b981; font-weight: 600;">(${modStats.range.modified})</span>`;
		}

		// Inject metamagic duration modification
		if (modStats?.duration?.changed) {
			htmlPtDuration += ` <span style="color: #10b981; font-weight: 600;">(${modStats.duration.modified})</span>`;
		}

		// Thelemar rarity/legality badges
		let htmlPtRarity = "";
		const rarity = (characterSpell?.subschools || []).find(s => s.startsWith("rarity:"))?.replace("rarity:", "");
		const legality = (characterSpell?.subschools || []).find(s => s.startsWith("legality:"))?.replace("legality:", "");
		if (rarity || legality) {
			const badges = [];
			if (rarity) {
				const color = rarity === "common" ? "#9ca3af" : (rarity === "uncommon" ? "#6366f1" : (rarity === "rare" ? "#8b5cf6" : "#f59e0b"));
				badges.push(`<span style="color: ${color}; font-weight: 600;">[${rarity}]</span>`);
			}
			if (legality) {
				const color = legality === "legal" ? "#10b981" : (legality === "restricted" ? "#f59e0b" : "#ef4444");
				badges.push(`<span style="color: ${color}; font-weight: 600;">[${legality}]</span>`);
			}
			htmlPtRarity = `<div class="ve-pb-1">${badges.join(" ")}</div>`;
		}

		// Render spell body entries using the real Renderer
		const entryStack = [];
		if (spellData.entries) {
			Renderer.get().recursiveRender({type: "entries", entries: spellData.entries}, entryStack, {depth: 1});
		}
		if (spellData.entriesHigherLevel) {
			Renderer.get().recursiveRender({type: "entries", entries: spellData.entriesHigherLevel}, entryStack, {depth: 2});
		}

		// Classes
		let htmlPtClasses = "";
		try {
			const fromClassList = Renderer.spell.getCombinedClasses(spellData, "fromClassList");
			if (fromClassList.length) {
				const [current] = Parser.spClassesToCurrentAndLegacy(fromClassList);
				htmlPtClasses = `<div><span class="ve-bold">Classes: </span>${Parser.spMainClassesToFull(current)}</div>`;
			}
		} catch { /* ignore class resolution errors in charsheet context */ }

		// Metamagic notes
		let htmlPtMetamagic = "";
		if (modStats?.notes?.length) {
			htmlPtMetamagic = `<div style="color: #10b981; font-weight: 600;" class="ve-pt-1">${modStats.notes.join(" \u00B7 ")}</div>`;
		}

		// Name header row — simplified version of Renderer.utils.getNameTr
		const sourceColorClass = spellData.source ? Parser.sourceJsonToSourceClassname(spellData.source) : "";
		const htmlPtName = `<tr>
			<th class="ve-stats__th-name ve-text-left ve-pb-0" colspan="6">
				<div class="ve-split-v-end">
					<div class="ve-flex-v-center">
						<h1 class="ve-stats__h-name ve-m-0">${spellData.name}</h1>
					</div>
					<div class="ve-stats__wrp-h-source ve-flex-v-baseline">
						<i class="ve-help-subtle ve-stats__h-source-abbreviation ${sourceColorClass}" title="${Parser.sourceJsonToFull(spellData.source)}">${Parser.sourceJsonToAbv(spellData.source)}</i>
						${spellData.page ? `<i class="ve-rd__stats-name-page ve-ml-1">p${spellData.page}</i>` : ""}
					</div>
				</div>
			</th>
		</tr>`;

		// Content row — same 2-column flex grid as the standard spell hover
		const htmlPtContent = `<tr><td colspan="6" class="ve-pb-2">
			<div class="ve-pb-2">${htmlPtLevelSchool}</div>
			${htmlPtRarity}
			<div class="ve-flex ve-pb-2 w100">
				<div class="ve-flex-col ve-grow ve-min-w-25 ve-pr-2">
					<div>${htmlPtCastingTime}</div>
					<div>${htmlPtComponents}</div>
				</div>
				<div class="ve-flex-col ve-grow ve-min-w-25">
					<div>${htmlPtRange}</div>
					<div>${htmlPtDuration}</div>
				</div>
			</div>
			${entryStack.join("")}
			${htmlPtClasses}
			${htmlPtMetamagic}
		</td></tr>`;

		return htmlPtName + htmlPtContent;
	}

	/**
	 * Create a 5etools hover link (static method)
	 * @param {string} page - The page URL (e.g., "conditionsdiseases.html", "items.html")
	 * @param {string} name - Entity name (used for hash/lookup)
	 * @param {string} source - Source book abbreviation
	 * @param {string} [hash] - Optional hash override
	 * @param {string} [displayName] - Optional display name override (defaults to entity name)
	 * @returns {string} HTML string for the link
	 */
	static getHoverLink (page, name, source, hash = null, displayName = null, hrefOverride = null) {
		try {
			const finalHash = hash || UrlUtil.encodeForHash([name, source].join(HASH_LIST_SEP));
			const hoverAttrs = Renderer.hover.getHoverElementAttributes({page, source, hash: finalHash});
			const href = hrefOverride || `${page}#${finalHash}`;
			const link = `<a href="${href}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${displayName || name}</a>`;
			return link;
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("[CharSheet] getHoverLink error:", e);
			return displayName || name;
		}
	}

	/**
	 * Create a hoverable link for a subclass.
	 * @param {object} subclass - Subclass object with name, source, className, classSource
	 * @returns {string} HTML string for the hover link
	 */
	static getSubclassHoverLink (subclass) {
		try {
			const hash = `${UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES]({name: subclass.className, source: subclass.classSource})}${HASH_PART_SEP}${UrlUtil.getClassesPageStatePart({subclass})}`;
			const hoverAttrs = Renderer.hover.getHoverElementAttributes({
				page: UrlUtil.PG_CLASSES,
				source: subclass.source,
				hash,
			});
			return `<a href="${UrlUtil.PG_CLASSES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${subclass.name}</a>`;
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("[CharSheet] getSubclassHoverLink error:", e);
			return subclass.name; // Fallback to just the name
		}
	}

	/**
	 * Resolve the best source for an optional feature name.
	 * Prefers explicitly provided sources, then common official fallbacks.
	 * @param {string} name - Optional feature name
	 * @param {string[]} [preferredSources=[]] - Ordered source preferences
	 * @returns {string} Resolved source
	 */
	resolveOptionalFeatureSource (name, preferredSources = []) {
		if (!name) return preferredSources.find(Boolean) || Parser.SRC_XPHB;

		const allOptFeatures = this.getOptionalFeatures?.() || this._optionalFeaturesData || [];
		const matchingByName = allOptFeatures.filter(it => it.name?.toLowerCase() === name.toLowerCase());
		if (!matchingByName.length) return preferredSources.find(Boolean) || Parser.SRC_XPHB;

		for (const preferredSource of preferredSources.filter(Boolean)) {
			const preferredSourceNorm = preferredSource.toUpperCase();
			const exact = matchingByName.find(it => (it.source || "").toUpperCase() === preferredSourceNorm);
			if (exact?.source) return exact.source;
		}

		const xphb = matchingByName.find(it => (it.source || "").toUpperCase() === Parser.SRC_XPHB);
		if (xphb?.source) return xphb.source;

		const phb = matchingByName.find(it => (it.source || "").toUpperCase() === Parser.SRC_PHB);
		if (phb?.source) return phb.source;

		return matchingByName[0].source || preferredSources.find(Boolean) || Parser.SRC_XPHB;
	}

	/**
	 * Get hover attributes for an action (Dodge, Disengage, etc.)
	 * @param {string} actionName - The action name
	 * @param {string} [source] - Source book abbreviation (defaults to XPHB)
	 * @returns {string} Hover attributes string to embed in an element
	 */
	_getActionHoverAttrs (actionName, source = Parser.SRC_XPHB) {
		try {
			const hash = UrlUtil.encodeForHash([actionName, source].join(HASH_LIST_SEP));
			return Renderer.hover.getHoverElementAttributes({
				page: UrlUtil.PG_ACTIONS,
				source,
				hash,
			});
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[CharSheet] Error getting action hover attrs:", e);
			return `title="${actionName}"`;
		}
	}

	/**
	 * Create a condition hover link (instance method)
	 * @param {string} condition - Condition name
	 * @returns {string} HTML string for the link
	 */
	getConditionLink (condition) {
		const conditionClean = condition.trim().toLowerCase();

		// Look up the condition in loaded data to get the correct source
		const conditionData = this._conditionsData?.find(c =>
			c.name.toLowerCase() === conditionClean,
		);

		// Use found source, or fall back to XPHB for standard conditions
		const source = conditionData?.source || Parser.SRC_XPHB;
		const hash = UrlUtil.encodeForHash([condition.trim(), source].join(HASH_LIST_SEP));

		return this.getHoverLink(
			UrlUtil.PG_CONDITIONS_DISEASES,
			condition.trim(),
			source,
			hash,
		);
	}

	/**
	 * Create a condition hover link with explicit source
	 * @param {string} condition - Condition name
	 * @param {string} source - Source book code
	 * @returns {string} HTML string for the link
	 */
	getConditionLinkWithSource (condition, source) {
		const hash = UrlUtil.encodeForHash([condition.trim(), source].join(HASH_LIST_SEP));

		return this.getHoverLink(
			UrlUtil.PG_CONDITIONS_DISEASES,
			condition.trim(),
			source,
			hash,
		);
	}

	/**
	 * Create a condition hover link (static fallback - uses XPHB)
	 * @param {string} condition - Condition name
	 * @returns {string} HTML string for the link
	 * @deprecated Use instance method instead for proper homebrew support
	 */
	static getConditionLink (condition) {
		const conditionClean = condition.trim().toLowerCase();
		const hash = `${conditionClean}_xphb`;
		return CharacterSheetPage.getHoverLink(
			UrlUtil.PG_CONDITIONS_DISEASES,
			condition.trim(),
			Parser.SRC_XPHB,
			hash,
		);
	}
	// #endregion

	// #region Settings Modal
	async _showSettingsModal () {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "⚙️ Sheet Settings",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => {
				this._saveCurrentCharacter();
			},
		});

		// Get all available sources
		const allSources = this._getAvailableSources();
		const currentAllowed = this._state.getAllowedSources();

		// Check if there's any homebrew
		const hasHomebrew = allSources.some(src => BrewUtil2.hasSourceJson(src.json) || PrereleaseUtil.hasSourceJson(src.json));

		// Build source selection UI
		const sourceFilter = e_({outer: `<div class="charsheet__settings-sources"></div>`});

		// Quick select buttons
		const quickButtons = ee`<div class="charsheet__settings-quick-buttons">
			<button class="ve-btn ve-btn-xs ve-btn-default" id="settings-source-all">All</button>
			<button class="ve-btn ve-btn-xs ve-btn-default" id="settings-source-none">None</button>
			<button class="ve-btn ve-btn-xs ve-btn-default" id="settings-source-core">Core Only</button>
			<button class="ve-btn ve-btn-xs ve-btn-default" id="settings-source-2024">2024 Rules</button>
			<button class="ve-btn ve-btn-xs ve-btn-default" id="settings-source-official">Official Only</button>
			${hasHomebrew ? `<button class="ve-btn ve-btn-xs ve-btn-default" id="settings-source-homebrew">Homebrew Only</button>` : ""}
		</div>`;

		// Group sources by category
		const sourceGroups = this._groupSourcesByCategory(allSources);

		// Create checkboxes for each source
		Object.entries(sourceGroups).forEach(([group, sources]) => {
			const groupEl = e_({outer: `<div class="charsheet__settings-source-group">
				<div class="charsheet__settings-source-group-header">${group}</div>
			</div>`});

			sources.forEach(src => {
				const isChecked = !currentAllowed || currentAllowed.includes(src.json);
				const checkboxEl = e_({outer: `
					<label class="charsheet__settings-source-item">
						<input type="checkbox" value="${src.json}" ${isChecked ? "checked" : ""} class="source-checkbox">
						<span title="${src.full}">${src.abbr}</span>
					</label>
				`});
				groupEl.append(checkboxEl);
			});

			sourceFilter.append(groupEl);
		});

		// Exhaustion rules toggle
		const currentExhaustionRules = this._state.getExhaustionRules();
		const exhaustionToggle = ee`<div class="charsheet__settings-option">
			<label class="charsheet__settings-option-label">
				<span class="charsheet__settings-option-icon">😫</span>
				<span class="charsheet__settings-option-name">Exhaustion Rules</span>
			</label>
			<select class="ve-form-control form-control--minimal ve-input-sm charsheet__settings-select" id="settings-exhaustion-rules">
				<option value="2024" ${currentExhaustionRules === "2024" ? "selected" : ""}>2024 Rules (Stacking -2 to d20 tests)</option>
				<option value="2014" ${currentExhaustionRules === "2014" ? "selected" : ""}>2014 Rules (Tiered effects)</option>
				<option value="thelemar" ${currentExhaustionRules === "thelemar" ? "selected" : ""}>Thelemar Rules (-1 to rolls/DCs, max 10)</option>
			</select>
		</div>`;

		// Thelemar homebrew rules
		const currentThelemar_carryWeight = (/** @type {*} */ (this._state.getSettings()))?.thelemar_carryWeight || false;
		const currentThelemar_jumping = (/** @type {*} */ (this._state.getSettings()))?.thelemar_jumping || false;
		const currentThelemar_linguisticsBonus = (/** @type {*} */ (this._state.getSettings()))?.thelemar_linguisticsBonus || false;
		const currentThelemar_criticalRolls = (/** @type {*} */ (this._state.getSettings()))?.thelemar_criticalRolls || false;
		const currentThelemar_asiFeat = (/** @type {*} */ (this._state.getSettings()))?.thelemar_asiFeat || false;
		const currentThelemar_itemUtilization = (/** @type {*} */ (this._state.getSettings()))?.thelemar_itemUtilization || false;
		const currentThelemar_spellRarityCheck = (/** @type {*} */ (this._state.getSettings()))?.thelemar_spellRarity !== false;

		// Master toggle for all Thelemar rules (uses currentExhaustionRules from above)
		const allThelemar = currentThelemar_carryWeight && currentThelemar_jumping && currentThelemar_linguisticsBonus && currentThelemar_criticalRolls && currentThelemar_asiFeat && currentThelemar_itemUtilization && currentThelemar_spellRarityCheck && currentExhaustionRules === "thelemar";
		const thelemar_masterToggle = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox charsheet__settings-option--master">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-thelemar-all" ${allThelemar ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">🌍 Enable All Thelemar Rules</span>
					<span class="charsheet__settings-checkbox-desc">Toggle all Thelemar homebrew rules at once</span>
				</span>
			</label>
		</div>`;

		const thelemar_carryWeight = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox charsheet__settings-option--sub">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-thelemar-carry" ${currentThelemar_carryWeight ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">🎒 Carry Weight</span>
					<span class="charsheet__settings-checkbox-desc">50 + 25 × Might modifier (minimum 50)</span>
				</span>
			</label>
		</div>`;

		const thelemar_linguisticsBonus = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox charsheet__settings-option--sub">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-thelemar-linguistics" ${currentThelemar_linguisticsBonus ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">📖 Linguistics</span>
					<span class="charsheet__settings-checkbox-desc">+1 bonus per known language (except Common)</span>
				</span>
			</label>
		</div>`;

		const thelemar_criticalRolls = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox charsheet__settings-option--sub">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-thelemar-crits" ${currentThelemar_criticalRolls ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">🎲 Critical Rolls</span>
					<span class="charsheet__settings-checkbox-desc">Non-attack rolls: Nat 1 = -5, Nat 20 = +5 to result</span>
				</span>
			</label>
		</div>`;

		const thelemar_asiFeat = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox charsheet__settings-option--sub">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-thelemar-asifeat" ${currentThelemar_asiFeat ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">📈 ASI + Feat at Level 4</span>
					<span class="charsheet__settings-checkbox-desc">At level 4, gain both an ASI and a feat instead of choosing one</span>
				</span>
			</label>
		</div>`;

		// Thelemar jumping rules (Athletics-based)
		const thelemar_jumping = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox charsheet__settings-option--sub">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-thelemar-jumping" ${currentThelemar_jumping ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">🦘 Jumping Rules</span>
					<span class="charsheet__settings-checkbox-desc">Athletics-based: Long jump = 8 + Athletics mod; High jump = 2 + Athletics × 0.5</span>
				</span>
			</label>
		</div>`;

		// Thelemar item utilization (healing potions as action = max healing)
		const thelemar_itemUtilization = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox charsheet__settings-option--sub">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-thelemar-item-util" ${currentThelemar_itemUtilization ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">🧪 Item Utilization</span>
					<span class="charsheet__settings-checkbox-desc">Bonus action items can be used as an action for maximum effect (no roll)</span>
				</span>
			</label>
		</div>`;

		// Thelemar spell rarity/legality
		const currentThelemar_spellRarity = (/** @type {*} */ (this._state.getSettings()))?.thelemar_spellRarity !== false;
		const thelemar_spellRarity = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox charsheet__settings-option--sub">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-thelemar-spell-rarity" ${currentThelemar_spellRarity ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">🏷️ Spell Rarity</span>
					<span class="charsheet__settings-checkbox-desc">Official spells: Legal + Common. Homebrew spells: Legal + Uncommon (unless already tagged)</span>
				</span>
			</label>
		</div>`;

		// Spell list settings
		const currentIncludeCoreSpells = (/** @type {*} */ (this._state.getSettings()))?.includeCoreSpellsForHomebrew !== false;
		const includeCoreSpells = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-include-core-spells" ${currentIncludeCoreSpells ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">📜 Include Core Spells for Homebrew Classes</span>
					<span class="charsheet__settings-checkbox-desc">When using a homebrew class with the same name as an official class, also include spells from the matching PHB/XPHB class spell list</span>
				</span>
			</label>
		</div>`;

		// Language settings
		const currentAllowExoticLanguages = (/** @type {*} */ (this._state.getSettings()))?.allowExoticLanguages !== false;
		const allowExoticLanguages = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-allow-exotic-languages" ${currentAllowExoticLanguages ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">🗣️ Allow Exotic Languages</span>
					<span class="charsheet__settings-checkbox-desc">Allow selection of exotic/rare languages (Abyssal, Infernal, etc.) even when feature grants "standard" languages</span>
				</span>
			</label>
		</div>`;

		// Ability score cap enforcement
		const currentEnforceAbilityScoreCap = (/** @type {*} */ (this._state.getSettings()))?.enforceAbilityScoreCap === true;
		const enforceAbilityScoreCap = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-enforce-ability-cap" ${currentEnforceAbilityScoreCap ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">🛡️ Enforce Ability Score Cap</span>
					<span class="charsheet__settings-checkbox-desc">Cap ability scores at 20 by default. Features like Primal Champion auto-raise the cap for affected abilities. You can also set per-ability maximums.</span>
				</span>
			</label>
		</div>`;

		// Show all optional feature versions (no deduplication)
		const currentShowAllOptFeatureVersions = (/** @type {*} */ (this._state.getSettings()))?.showAllOptFeatureVersions || false;
		const showAllOptFeatureVersions = ee`<div class="charsheet__settings-option charsheet__settings-option--checkbox">
			<label class="charsheet__settings-checkbox-label">
				<input type="checkbox" id="settings-show-all-opt-versions" ${currentShowAllOptFeatureVersions ? "checked" : ""}>
				<span class="charsheet__settings-checkbox-text">
					<span class="charsheet__settings-checkbox-title">📋 Show All Feature Versions</span>
					<span class="charsheet__settings-checkbox-desc">Show all source versions of optional features (Invocations, Metamagic, etc.) instead of deduplicating by priority (TGTT > XPHB > PHB)</span>
				</span>
			</label>
		</div>`;

		// Priority sources section
		const currentPriority = this._state.getPrioritySources() || [];
		const homebrewSources = allSources.filter(src => BrewUtil2.hasSourceJson(src.json) || PrereleaseUtil.hasSourceJson(src.json));

		let prioritySection = null;
		if (homebrewSources.length) {
			const priorityOptionsHtml = homebrewSources.map(src => `<option value="${src.json}" ${currentPriority.includes(src.json) ? "selected" : ""}>${src.full || src.abbr}</option>`).join("");
			const prioritySelect = e_({outer: `<select class="ve-form-control" id="settings-priority-source">
				<option value="">None (show all versions)</option>
				${priorityOptionsHtml}
			</select>`}); ;

			prioritySection = ee`<div class="charsheet__settings-section">
				<div class="charsheet__settings-section-title">⭐ Priority Source</div>
				<p class="charsheet__settings-section-intro">Choose a homebrew source to prioritize. When set, if a spell, item, class, or feature with the same name exists in both this source and another source, only the version from this source will appear. Other unique options from all sources will still be shown.</p>
				<div class="charsheet__settings-option">
					<label class="charsheet__settings-option-label">
						<span class="charsheet__settings-option-icon">🏆</span>
						<span class="charsheet__settings-option-name">Prioritize Homebrew Source</span>
					</label>
					${prioritySelect}
				</div>
				<p class="charsheet__settings-section-note ve-muted mt-2" style="font-size: 0.8rem;">
					<strong>Example:</strong> If your homebrew has a custom "Fireball" spell and you prioritize it, the PHB version of Fireball won't appear in spell lists—but all other PHB spells will still show.
				</p>
			</div>`;
		}

		// Build modal content
		const settingsContent = ee`<div class="charsheet__settings-modal">
			<div class="charsheet__settings-section">
				<div class="charsheet__settings-section-title">📚 Source Filter</div>
				<p class="charsheet__settings-section-intro">Select which sources to use when adding races, classes, spells, items, etc. Uncheck sources to exclude them from selection lists.</p>
				${quickButtons}
				<div class="charsheet__settings-sources-container">
					${sourceFilter}
				</div>
			</div>
			
			${prioritySection || ""}
			
			<div class="charsheet__settings-section">
				<div class="charsheet__settings-section-title">🎮 Game Rules</div>
				${exhaustionToggle}
				${includeCoreSpells}
				${allowExoticLanguages}
				${enforceAbilityScoreCap}
				${showAllOptFeatureVersions}
			</div>
			
			<div class="charsheet__settings-section">
				<div class="charsheet__settings-section-title">🏠 Thelemar Homebrew Rules</div>
				<p class="charsheet__settings-section-intro">Optional Thelemar house rules for customized gameplay.</p>
				${thelemar_masterToggle}
				<div class="charsheet__settings-thelemar-sub">
					${thelemar_carryWeight}
					${thelemar_jumping}
					${thelemar_linguisticsBonus}
					${thelemar_criticalRolls}
					${thelemar_asiFeat}
					${thelemar_itemUtilization}
					${thelemar_spellRarity}
				</div>
			</div>
		</div>`;
		modalInner.append(settingsContent);

		// Priority source handler
		modalInner.querySelector("#settings-priority-source").addEventListener("change", (e) => {
			const value = (/** @type {*} */ (e.target)).value;
			this._state.setPrioritySources(value ? [value] : null);
		});

		// Quick select handlers
		modalInner.querySelector("#settings-source-all").addEventListener("click", () => {
			[...modalInner.querySelectorAll(".source-checkbox")].forEach(el => el.checked = true);
			this._updateAllowedSources(modalInner);
		});

		modalInner.querySelector("#settings-source-none").addEventListener("click", () => {
			[...modalInner.querySelectorAll(".source-checkbox")].forEach(el => el.checked = false);
			this._updateAllowedSources(modalInner);
		});

		modalInner.querySelector("#settings-source-core").addEventListener("click", () => {
			[...modalInner.querySelectorAll(".source-checkbox")].forEach(el => el.checked = false);
			const coreSources = [Parser.SRC_PHB, Parser.SRC_DMG, Parser.SRC_MM, Parser.SRC_XPHB, Parser.SRC_XDMG, Parser.SRC_XMM];
			coreSources.forEach(src => {
				const cb = modalInner.querySelector(`.source-checkbox[value="${src}"]`);
				if (cb) cb.checked = true;
			});
			this._updateAllowedSources(modalInner);
		});

		modalInner.querySelector("#settings-source-2024").addEventListener("click", () => {
			[...modalInner.querySelectorAll(".source-checkbox")].forEach(el => el.checked = false);
			const sources2024 = [Parser.SRC_XPHB, Parser.SRC_XDMG, Parser.SRC_XMM];
			sources2024.forEach(src => {
				const cb = modalInner.querySelector(`.source-checkbox[value="${src}"]`);
				if (cb) cb.checked = true;
			});
			this._updateAllowedSources(modalInner);
		});

		modalInner.querySelector("#settings-source-official").addEventListener("click", () => {
			[...modalInner.querySelectorAll(".source-checkbox")].forEach((el) => {
				const src = el.value;
				const isOfficial = !SourceUtil.isNonstandardSource(src) && !BrewUtil2.hasSourceJson(src) && !PrereleaseUtil.hasSourceJson(src);
				el.checked = isOfficial;
			});
			this._updateAllowedSources(modalInner);
		});

		// Homebrew only button handler
		modalInner.querySelector("#settings-source-homebrew").addEventListener("click", () => {
			[...modalInner.querySelectorAll(".source-checkbox")].forEach((el) => {
				const src = el.value;
				const isHomebrew = BrewUtil2.hasSourceJson(src) || PrereleaseUtil.hasSourceJson(src);
				el.checked = isHomebrew;
			});
			this._updateAllowedSources(modalInner);
		});

		// Source checkbox change handler
		[...modalInner.querySelectorAll(".source-checkbox")].forEach(el => {
			el.addEventListener("change", () => {
				this._updateAllowedSources(modalInner);
			});
		});

		// Thelemar master toggle helper - defined early so exhaustion handler can use it
		const updateMasterToggleState = () => {
			const carryChecked = modalInner.querySelector("#settings-thelemar-carry").checked;
			const jumpingChecked = modalInner.querySelector("#settings-thelemar-jumping").checked;
			const lingChecked = modalInner.querySelector("#settings-thelemar-linguistics").checked;
			const critsChecked = modalInner.querySelector("#settings-thelemar-crits").checked;
			const asiFeatChecked = modalInner.querySelector("#settings-thelemar-asifeat").checked;
			const itemUtilChecked = modalInner.querySelector("#settings-thelemar-item-util").checked;
			const spellRarityChecked = modalInner.querySelector("#settings-thelemar-spell-rarity").checked;
			const exhaustionRules = modalInner.querySelector("#settings-exhaustion-rules").value;
			const exhaustionIsThelemar = exhaustionRules === "thelemar";
			modalInner.querySelector("#settings-thelemar-all").checked = carryChecked && jumpingChecked && lingChecked && critsChecked && asiFeatChecked && itemUtilChecked && spellRarityChecked && exhaustionIsThelemar;
		};

		// Exhaustion rules handler
		modalInner.querySelector("#settings-exhaustion-rules").addEventListener("change", (e) => {
			this._state.setExhaustionRules((/** @type {*} */ (e.target)).value);
			this._renderExhaustion();
			this._renderCombatStats();
			// Re-render spells tab if it exists to update spell save DC
			if (this._spellsModule) {
				this._spellsModule.render();
			}
			// Update master toggle state since exhaustion is part of Thelemar rules
			updateMasterToggleState();
		});

		// Thelemar master toggle handler
		modalInner.querySelector("#settings-thelemar-all").addEventListener("change", (e) => {
			const isChecked = (/** @type {*} */ (e.target)).checked;
			// Set all sub-toggles, then fire change events so per-setting handlers run
			const subToggleIds = [
				"#settings-thelemar-carry",
				"#settings-thelemar-jumping",
				"#settings-thelemar-linguistics",
				"#settings-thelemar-crits",
				"#settings-thelemar-asifeat",
				"#settings-thelemar-item-util",
				"#settings-thelemar-spell-rarity",
			];
			subToggleIds.forEach((sel) => {
				const sub = /** @type {*} */ (modalInner.querySelector(sel));
				if (!sub) return;
				sub.checked = isChecked;
				sub.dispatchEvent(new Event("change"));
			});
			// Also set exhaustion rules
			const exhaustionSel = /** @type {*} */ (modalInner.querySelector("#settings-exhaustion-rules"));
			if (exhaustionSel) {
				exhaustionSel.value = isChecked ? "thelemar" : "2024";
				exhaustionSel.dispatchEvent(new Event("change"));
			}
		});

		// Thelemar carry weight handler
		modalInner.querySelector("#settings-thelemar-carry").addEventListener("change", (e) => {
			this._state.setSetting("thelemar_carryWeight", (/** @type {*} */ (e.target)).checked);
			// Update encumbrance display
			this._inventory?._updateEncumbrance?.();
			// Also update combat stats which shows carry capacity
			this._renderCombatStats();
			updateMasterToggleState();
		});

		// Thelemar jumping rules handler
		modalInner.querySelector("#settings-thelemar-jumping").addEventListener("change", (e) => {
			this._state.setSetting("thelemar_jumping", (/** @type {*} */ (e.target)).checked);
			this._renderCombatStats();
			updateMasterToggleState();
		});

		// Thelemar linguistics bonus handler
		modalInner.querySelector("#settings-thelemar-linguistics").addEventListener("change", (e) => {
			this._state.setSetting("thelemar_linguisticsBonus", (/** @type {*} */ (e.target)).checked);

			// Auto-add/remove Linguistics custom skill when setting is toggled
			const hasLinguisticsSkill = this._state.getCustomSkills().some(
				s => s.name.toLowerCase() === "linguistics",
			);

			if ((/** @type {*} */ (e.target)).checked && !hasLinguisticsSkill) {
				// Add Linguistics skill when setting is enabled
				this._state.addCustomSkill("Linguistics", "int");
			} else if (!(/** @type {*} */ (e.target)).checked && hasLinguisticsSkill) {
				// Remove Linguistics skill when setting is disabled
				this._state.removeCustomSkill("Linguistics");
			}

			this._renderSkills();
			updateMasterToggleState();
		});

		// Thelemar critical rolls handler
		modalInner.querySelector("#settings-thelemar-crits").addEventListener("change", (e) => {
			this._state.setSetting("thelemar_criticalRolls", (/** @type {*} */ (e.target)).checked);
			updateMasterToggleState();
		});

		// Thelemar ASI+Feat at level 4 handler
		modalInner.querySelector("#settings-thelemar-asifeat").addEventListener("change", (e) => {
			this._state.setSetting("thelemar_asiFeat", (/** @type {*} */ (e.target)).checked);
			updateMasterToggleState();
		});

		// Thelemar item utilization handler
		modalInner.querySelector("#settings-thelemar-item-util").addEventListener("change", (e) => {
			this._state.setSetting("thelemar_itemUtilization", (/** @type {*} */ (e.target)).checked);
			updateMasterToggleState();
		});

		// Thelemar spell rarity handler
		modalInner.querySelector("#settings-thelemar-spell-rarity").addEventListener("change", (e) => {
			this._state.setSetting("thelemar_spellRarity", (/** @type {*} */ (e.target)).checked);
			updateMasterToggleState();
		});

		// Include core spells for homebrew classes handler
		modalInner.querySelector("#settings-include-core-spells").addEventListener("change", (e) => {
			this._state.setSetting("includeCoreSpellsForHomebrew", (/** @type {*} */ (e.target)).checked);
		});

		// Allow exotic languages handler
		modalInner.querySelector("#settings-allow-exotic-languages").addEventListener("change", (e) => {
			this._state.setSetting("allowExoticLanguages", (/** @type {*} */ (e.target)).checked);
		});

		// Ability score cap handler
		modalInner.querySelector("#settings-enforce-ability-cap").addEventListener("change", (e) => {
			this._state.setSetting("enforceAbilityScoreCap", (/** @type {*} */ (e.target)).checked);
			// Re-render stats since ability scores may change
			this._renderAbilities();
			this._renderCombatStats();
			if (this._spellsModule) this._spellsModule.render();
		});

		// Show all optional feature versions handler
		modalInner.querySelector("#settings-show-all-opt-versions").addEventListener("change", (e) => {
			this._state.setSetting("showAllOptFeatureVersions", (/** @type {*} */ (e.target)).checked);
		});
	}

	_getAvailableSources () {
		// Collect sources from all loaded data
		const sourceSet = new Set();

		// Add sources from loaded races
		this._races?.forEach(r => sourceSet.add(r.source));
		// Add sources from loaded classes
		this._classes?.forEach(c => sourceSet.add(c.source));
		// Add sources from loaded backgrounds
		this._backgrounds?.forEach(b => sourceSet.add(b.source));
		// Add sources from loaded spells
		this._spellsData?.forEach(s => sourceSet.add(s.source));
		// Add sources from loaded items
		this._itemsData?.forEach(i => sourceSet.add(i.source));
		// Add sources from loaded feats
		this._featsData?.forEach(f => sourceSet.add(f.source));
		// Add sources from optional features
		this._optionalFeaturesData?.forEach(of => sourceSet.add(of.source));
		// Add sources from combat methods
		this._combatMethodsData?.forEach(cm => sourceSet.add(cm.source));
		// Add sources from item upgrades
		this._itemUpgradesData?.forEach(iu => sourceSet.add(iu.source));

		// Also add all standard sources from Parser
		Object.keys(Parser.SOURCE_JSON_TO_FULL).forEach(src => sourceSet.add(src));

		// Convert to array with display info
		return Array.from(sourceSet)
			.filter(src => src) // Remove nulls/undefined
			.map(src => ({
				json: src,
				abbr: Parser.sourceJsonToAbv(src),
				full: Parser.sourceJsonToFull(src),
			}))
			.sort((a, b) => a.full.localeCompare(b.full));
	}

	_groupSourcesByCategory (sources) {
		const groups = {
			"Core Rulebooks": [],
			"Supplements": [],
			"Adventures": [],
			"Other Official": [],
			"Prerelease": [],
			"Homebrew": [],
		};

		sources.forEach(src => {
			if (BrewUtil2.hasSourceJson(src.json)) {
				groups["Homebrew"].push(src);
			} else if (PrereleaseUtil.hasSourceJson(src.json)) {
				groups["Prerelease"].push(src);
			} else if (SourceUtil.isNonstandardSource(src.json)) {
				groups["Other Official"].push(src);
			} else if ([Parser.SRC_PHB, Parser.SRC_DMG, Parser.SRC_MM, Parser.SRC_XPHB, Parser.SRC_XDMG, Parser.SRC_XMM].includes(src.json)) {
				groups["Core Rulebooks"].push(src);
			} else if (src.full?.includes(":") || src.abbr?.length > 5) {
				// Adventure names usually have colons or longer abbreviations
				groups["Adventures"].push(src);
			} else {
				groups["Supplements"].push(src);
			}
		});

		// Remove empty groups
		Object.keys(groups).forEach(key => {
			if (!groups[key].length) delete groups[key];
		});

		return groups;
	}

	_updateAllowedSources (modalInner) {
		const checkedSources = [];
		[...modalInner.querySelectorAll(".source-checkbox:checked")].forEach((el) => {
			checkedSources.push(el.value);
		});

		// If all are checked, set to null (all allowed)
		const allSources = modalInner.querySelectorAll(".source-checkbox").length;
		if (checkedSources.length === allSources || checkedSources.length === 0) {
			this._state.setAllowedSources(null);
		} else {
			this._state.setAllowedSources(checkedSources);
		}
	}

	/**
	 * Ensure the Linguistics custom skill exists if the Thelemar linguistics bonus setting is enabled.
	 * This is called when loading a character to ensure data consistency.
	 */
	_ensureLinguisticsSkillIfNeeded () {
		const settings = (/** @type {*} */ (this._state.getSettings()));
		if (!settings?.thelemar_linguisticsBonus) return;

		const hasLinguisticsSkill = this._state.getCustomSkills().some(
			s => s.name.toLowerCase() === "linguistics",
		);

		if (!hasLinguisticsSkill) {
			this._state.addCustomSkill("Linguistics", "int");
		}
	}

	/**
	 * Apply a background theme to the page
	 * @param {string} theme - The theme ID (default, indigo, crimson, etc.)
	 */
	_applyBackgroundTheme (theme) {
		document.body.setAttribute("data-theme", theme || "default");
	}

	/**
	 * Update theme picker UI to reflect current selection
	 */
	_updateThemePickerSelection (theme) {
		const dropdownEl = document.getElementById("charsheet-theme-dropdown");
		if (!dropdownEl) return;

		const currentSelected = dropdownEl.querySelector(".charsheet__theme-swatch--selected");
		if (currentSelected) currentSelected.classList.remove("charsheet__theme-swatch--selected");
		const targetSwatch = dropdownEl.querySelector(`.charsheet__theme-swatch[data-theme="${theme || "default"}"]`);
		if (targetSwatch) targetSwatch.classList.add("charsheet__theme-swatch--selected");
	}

	/**
	 * Filter an array of entities by allowed sources and priority sources
	 * Priority sources hide duplicates (same name) from non-priority sources
	 * @param {Array} entities - Array of entities with `source` and `name` properties
	 * @returns {Array} Filtered array
	 */
	filterByAllowedSources (entities) {
		// First filter by allowed sources
		const allowed = this._state.getAllowedSources();
		let filtered = allowed ? entities.filter(e => allowed.includes(e.source)) : entities;

		// Then apply priority filtering if set
		const priority = this._state.getPrioritySources();
		if (priority?.length) {
			filtered = this._applyPriorityFilter(filtered, priority);
		}

		return filtered;
	}

	/**
	 * Get spell data with source filtering, priority filtering, and Thelemar rarity/legality tags applied.
	 * Single entry point for all spell picker consumers.
	 * @returns {Array} Fully prepared spell array
	 */
	getFilteredSpellData () {
		const filtered = this.filterByAllowedSources(this._spellsData || []);
		if (this._spells) return this._spells.applyThelemarSpellRarity(filtered);
		return filtered;
	}

	/**
	 * Apply priority source filtering - hide entities from non-priority sources
	 * if a matching entity (same name) exists in a priority source
	 * @param {Array} entities - Array of entities
	 * @param {Array} prioritySources - Array of priority source strings
	 * @returns {Array} Filtered array
	 */
	_applyPriorityFilter (entities, prioritySources) {
		// Build a map of names that exist in priority sources
		const priorityNames = new Set();
		entities.forEach(e => {
			if (prioritySources.includes(e.source)) {
				priorityNames.add(e.name?.toLowerCase());
			}
		});

		// Filter out non-priority entities that have a priority equivalent
		return entities.filter(e => {
			// Always keep entities from priority sources
			if (prioritySources.includes(e.source)) return true;

			// Keep non-priority entities only if no priority version exists
			const lowerName = e.name?.toLowerCase();
			return !priorityNames.has(lowerName);
		});
	}
	// #endregion

	// #region Custom Modifiers Modal
	/**
	 * Show the custom modifiers management modal
	 */
	async _showCustomModifiersModal () {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "🎯 Custom Modifiers",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => {
				this._saveCurrentCharacter();
				this._renderCharacter();
			},
		});

		// Get modifier type options - organized by category with optgroups
		const skills = this.getSkillsList();
		const customSkills = this._state.getCustomSkills();

		// Build grouped options structure
		const modifierGroups = [
			{
				group: "⭐ Global",
				options: [
					{value: "d20:all", label: "All d20 Rolls"},
				],
			},
			{
				group: "🛡️ Combat",
				options: [
					{value: "ac", label: "Armor Class (AC)"},
					{value: "initiative", label: "Initiative"},
					{value: "attack", label: "Attack Rolls (All)"},
					{value: "attack:melee", label: "Melee Attack Rolls"},
					{value: "attack:ranged", label: "Ranged Attack Rolls"},
					{value: "attack:weapon", label: "Weapon Attack Rolls"},
					{value: "attack:spell", label: "Spell Attack Rolls"},
					{value: "damage", label: "Damage Rolls (All)"},
					{value: "damage:melee", label: "Melee Damage"},
					{value: "damage:ranged", label: "Ranged Damage"},
					{value: "damage:weapon", label: "Weapon Damage"},
					{value: "damage:spell", label: "Spell Damage"},
				],
			},
			{
				group: "👟 Movement",
				options: [
					{value: "speed", label: "Speed (All)"},
					{value: "speed:walk", label: "Walking Speed"},
					{value: "speed:fly", label: "Flying Speed"},
					{value: "speed:swim", label: "Swimming Speed"},
					{value: "speed:climb", label: "Climbing Speed"},
					{value: "speed:burrow", label: "Burrowing Speed"},
				],
			},
			{
				group: "✨ Spellcasting",
				options: [
					{value: "spellDc", label: "Spell Save DC"},
					{value: "spellAttack", label: "Spell Attack Bonus"},
					{value: "concentration", label: "Concentration Saves"},
				],
			},
			{
				group: "💪 Saving Throws",
				options: [
					{value: "save:all", label: "All Saving Throws"},
					...Parser.ABIL_ABVS.map(abl => ({value: `save:${abl}`, label: `${Parser.attAbvToFull(abl)} Save`})),
				],
			},
			{
				group: "🎲 Ability Checks",
				options: [
					{value: "check:all", label: "All Ability Checks"},
					...Parser.ABIL_ABVS.map(abl => ({value: `check:${abl}`, label: `${Parser.attAbvToFull(abl)} Checks`})),
				],
			},
			{
				group: "📚 Skills",
				options: [
					{value: "skill:all", label: "All Skill Checks"},
					{value: "skill:custom", label: "✏️ Custom Skill (specify below)"},
					...skills.map(skill => {
						const skillKey = skill.name.toLowerCase().replace(/\s+/g, "");
						return {value: `skill:${skillKey}`, label: `${skill.name} (${skill.ability?.toUpperCase() || "—"})`};
					}),
				],
			},
			{
				group: "👁️ Passive Scores",
				options: [
					{value: "passive:all", label: "All Passive Scores"},
					{value: "passive:custom", label: "✏️ Custom Passive (specify below)"},
					...skills.map(skill => {
						const skillKey = skill.name.toLowerCase().replace(/\s+/g, "");
						return {value: `passive:${skillKey}`, label: `Passive ${skill.name}`};
					}),
				],
			},
			{
				group: "❤️ Hit Points",
				options: [
					{value: "hp:max", label: "HP Maximum"},
					{value: "hp:temp", label: "Temp HP"},
				],
			},
			{
				group: "📊 Ability Scores",
				options: [
					...Parser.ABIL_ABVS.map(abl => ({value: `ability:${abl}`, label: `${Parser.attAbvToFull(abl)} Score`})),
				],
			},
			{
				group: "🌙 Senses",
				options: [
					{value: "sense:darkvision", label: "Darkvision"},
					{value: "sense:blindsight", label: "Blindsight"},
					{value: "sense:tremorsense", label: "Tremorsense"},
					{value: "sense:truesight", label: "Truesight"},
				],
			},
			{
				group: "📈 Miscellaneous",
				options: [
					{value: "proficiencyBonus", label: "Proficiency Bonus"},
					{value: "carryCapacity", label: "Carry Capacity"},
					{value: "deathSave", label: "Death Saving Throws"},
				],
			},
		];

		// Create a flat lookup map for type labels
		const modifierTypeLabels = new Map();
		modifierGroups.forEach(group => {
			group.options.forEach(opt => {
				modifierTypeLabels.set(opt.value, `${group.group.replace(/^[^\s]+\s/, "")} › ${opt.label}`);
			});
		});

		// Render the modifiers list
		const renderModifiersList = () => {
			const modifiers = this._state.getNamedModifiers();
			const listEl = modalInner.querySelector("#charsheet-modifiers-list");
			listEl.innerHTML = "";

			if (!modifiers.length) {
				listEl.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-text-center py-3">No custom modifiers. Add one below!</div>`);
				return;
			}

			modifiers.forEach(mod => {
				// Look up type label from flat map, or use custom skill name if present
				let typeLabel = modifierTypeLabels.get(mod.type);
				if (!typeLabel && mod.customSkillName) {
					typeLabel = mod.type.startsWith("passive:") ? `Passive ${mod.customSkillName}` : `${mod.customSkillName} Skill`;
				}
				if (!typeLabel) {
					// Fallback: try to make the type readable
					typeLabel = mod.type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/:/, " › ");
				}

				// Build effect description
				const effects = [];
				if (mod.value && !mod.advantage && !mod.disadvantage && !mod.setMinimum && !mod.setMaximum) {
					const valueStr = mod.value >= 0 ? `+${mod.value}` : mod.value;
					effects.push(`<span class="${mod.value >= 0 ? "text-success" : "text-danger"}">${valueStr}</span>`);
				}
				if (mod.advantage) effects.push(`<span class="text-success">Advantage</span>`);
				if (mod.disadvantage) effects.push(`<span class="text-danger">Disadvantage</span>`);
				if (mod.setMinimum != null) effects.push(`<span class="ve-muted">Min: ${mod.setMinimum}</span>`);
				if (mod.setMaximum != null) effects.push(`<span class="ve-muted">Max: ${mod.setMaximum}</span>`);
				if (mod.bonusDie) effects.push(`<span class="text-info">+${mod.bonusDie}</span>`);
				if (mod.reroll != null) effects.push(`<span class="ve-muted">Reroll ≤${mod.reroll}</span>`);
				if (mod.proficiencyBonus) effects.push(`<span class="text-info">+Prof</span>`);
				if (mod.halfProficiency) effects.push(`<span class="text-info">+½Prof</span>`);
				if (mod.abilityMod) effects.push(`<span class="text-info">+${mod.abilityMod.toUpperCase()}</span>`);

				const effectsStr = effects.length ? effects.join(" ") : `<span class="ve-muted">+0</span>`;

				const rowEl = ee`<div class="charsheet__modifier-row ${mod.enabled ? "" : "charsheet__modifier-row--disabled"}">
					<div class="charsheet__modifier-toggle">
						<input type="checkbox" ${mod.enabled ? "checked" : ""} title="Enable/disable this modifier">
					</div>
					<div class="charsheet__modifier-info">
						<div class="charsheet__modifier-name">${mod.name}</div>
						<div class="charsheet__modifier-type ve-small ve-muted">${typeLabel}</div>
						${mod.note ? `<div class="charsheet__modifier-note ve-small ve-muted">${mod.note}</div>` : ""}
						${mod.conditional ? `<div class="charsheet__modifier-conditional ve-small ve-muted">⚡ ${mod.conditional}</div>` : ""}
					</div>
					<div class="charsheet__modifier-effects">${effectsStr}</div>
					<div class="charsheet__modifier-actions">
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__modifier-edit" title="Edit"><span class="glyphicon glyphicon-pencil"></span></button>
						<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__modifier-delete" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>
					</div>
				</div>`;

				// Toggle handler
				rowEl.querySelector("input[type='checkbox']").addEventListener("change", () => {
					this._state.toggleNamedModifier(mod.id);
					renderModifiersList();
					renderSummary();
				});

				// Edit handler
				rowEl.querySelector(".charsheet__modifier-edit").addEventListener("click", () => {
					showEditForm(mod);
				});

				// Delete handler
				rowEl.querySelector(".charsheet__modifier-delete").addEventListener("click", async () => {
					const doDelete = await InputUiUtil.pGetUserBoolean({
						title: "Remove Modifier",
						htmlDescription: `<p>Remove "${mod.name}" modifier?</p>`,
						textYes: "Remove",
						textNo: "Cancel",
					});
					if (doDelete) {
						this._state.removeNamedModifier(mod.id);
						renderModifiersList();
						renderSummary();
					}
				});

				listEl.append(rowEl);
			});
		};

		// Show/hide custom skill fields based on type selection
		const updateCustomSkillVisibility = (formEl) => {
			const type = formEl.querySelector("#mod-type").value;
			const customSkillFields = formEl.querySelector(".charsheet__modifier-form-row--custom-skill");
			if (type === "skill:custom" || type === "passive:custom") {
				customSkillFields.style.display = "";
			} else {
				customSkillFields.style.display = "none";
			}
		};

		// Show edit/add form
		const showEditForm = (existingMod = null) => {
			const formEl = modalInner.querySelector("#charsheet-modifier-form");
			formEl.style.display = "";

			const nameInput = formEl.querySelector("#mod-name");
			const typeSelect = formEl.querySelector("#mod-type");
			const valueInput = formEl.querySelector("#mod-value");
			const scalingSelect = formEl.querySelector("#mod-scaling");
			const noteInput = formEl.querySelector("#mod-note");
			const advSelect = formEl.querySelector("#mod-advantage");
			const minInput = formEl.querySelector("#mod-minimum");
			const diceCountInput = formEl.querySelector("#mod-dice-count");
			const diceTypeSelect = formEl.querySelector("#mod-dice-type");
			const conditionalInput = formEl.querySelector("#mod-conditional");
			const customSkillInput = formEl.querySelector("#mod-custom-skill");
			const customSkillAbilitySelect = formEl.querySelector("#mod-custom-skill-ability");

			if (existingMod) {
				nameInput.value = existingMod.name;
				typeSelect.value = existingMod.type;
				valueInput.value = existingMod.value || 0;
				// Determine scaling value
				let scalingVal = "";
				if (existingMod.proficiencyBonus) scalingVal = "proficiencyBonus";
				else if (existingMod.halfProficiency) scalingVal = "halfProficiency";
				else if (existingMod.doubleProficiency) scalingVal = "doubleProficiency";
				else if (existingMod.abilityMod) scalingVal = `abilityMod:${existingMod.abilityMod}`;
				else if (existingMod.perLevel) scalingVal = "perLevel";
				scalingSelect.value = scalingVal;
				noteInput.value = existingMod.note || "";
				advSelect.value = existingMod.advantage ? "advantage" : existingMod.disadvantage ? "disadvantage" : "";
				minInput.value = existingMod.setMinimum != null ? existingMod.setMinimum : "";
				// Parse bonusDie (e.g., "2d6") into count and type
				if (existingMod.bonusDie) {
					const diceMatch = existingMod.bonusDie.match(/(\d+)d(\d+)/);
					if (diceMatch) {
						diceCountInput.value = diceMatch[1];
						diceTypeSelect.value = `d${diceMatch[2]}`;
					}
				} else {
					diceCountInput.value = "";
					diceTypeSelect.value = "";
				}
				conditionalInput.value = existingMod.conditional || "";
				customSkillInput.value = existingMod.customSkillName || "";
				customSkillAbilitySelect.value = existingMod.customSkillAbility || "";
				formEl.dataset.editingId = existingMod.id;
				formEl.querySelector(".charsheet__modifier-form-title-text").textContent = "Edit Modifier";
			} else {
				nameInput.value = "";
				typeSelect.value = "ac";
				valueInput.value = 0;
				scalingSelect.value = "";
				noteInput.value = "";
				advSelect.value = "";
				minInput.value = "";
				diceCountInput.value = "";
				diceTypeSelect.value = "";
				conditionalInput.value = "";
				customSkillInput.value = "";
				customSkillAbilitySelect.value = "";
				delete formEl.dataset.editingId;
				formEl.querySelector(".charsheet__modifier-form-title-text").textContent = "Add Modifier";
			}

			updateCustomSkillVisibility(formEl);
			nameInput.focus();
		};

		// Build type select options using optgroups
		const typeOptionsHtml = modifierGroups.map(group => {
			const options = group.options.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join("");
			return `<optgroup label="${group.group}">${options}</optgroup>`;
		}).join("");

		// Build modal content
		const modifiersContent = ee`<div class="charsheet__modifiers-modal">
			<div class="charsheet__modifiers-intro">
				<p class="mb-0">Add custom modifiers to adjust your rolls. These can represent temporary effects (Bless, Guidance, Cover), magic items, or other situational bonuses. Toggle modifiers on/off as needed.</p>
			</div>
			
			<div class="charsheet__modifiers-section">
				<div class="charsheet__modifiers-section-title">📋 Active Modifiers</div>
				<div class="charsheet__modifiers-list" id="charsheet-modifiers-list">
					<!-- Populated by renderModifiersList -->
				</div>
				
				<button class="ve-btn ve-btn-primary ve-btn-sm charsheet__modifiers-add-btn" id="charsheet-btn-add-modifier">
					<span class="glyphicon glyphicon-plus"></span> Add Modifier
				</button>
			</div>

			<div class="charsheet__modifier-form" id="charsheet-modifier-form" style="display: none;">
				<div class="charsheet__modifier-form-title">✏️ <span class="charsheet__modifier-form-title-text">Add Modifier</span></div>
				<div class="charsheet__modifier-form-row">
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--name">
						<label class="charsheet__modifier-form-label">Name</label>
						<input type="text" class="ve-form-control form-control--minimal" id="mod-name" placeholder="e.g., Bless, Shield of Faith, Cover">
					</div>
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--type">
						<label class="charsheet__modifier-form-label">Type</label>
						<select class="ve-form-control form-control--minimal" id="mod-type">
							${typeOptionsHtml}
						</select>
					</div>
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--value">
						<label class="charsheet__modifier-form-label">Bonus</label>
						<input type="number" class="ve-form-control form-control--minimal" id="mod-value" value="0" placeholder="±0">
					</div>
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--scaling">
						<label class="charsheet__modifier-form-label">Scaling</label>
						<select class="ve-form-control form-control--minimal" id="mod-scaling">
							<option value="">None</option>
							<optgroup label="Proficiency">
								<option value="proficiencyBonus">+ Proficiency</option>
								<option value="halfProficiency">+ Half Prof</option>
								<option value="doubleProficiency">+ Double Prof</option>
							</optgroup>
							<optgroup label="Ability Modifier">
								<option value="abilityMod:str">+ STR mod</option>
								<option value="abilityMod:dex">+ DEX mod</option>
								<option value="abilityMod:con">+ CON mod</option>
								<option value="abilityMod:int">+ INT mod</option>
								<option value="abilityMod:wis">+ WIS mod</option>
								<option value="abilityMod:cha">+ CHA mod</option>
							</optgroup>
							<optgroup label="Level">
								<option value="perLevel">× Character Level</option>
							</optgroup>
						</select>
					</div>
				</div>
				<div class="charsheet__modifier-form-row charsheet__modifier-form-row--custom-skill" style="display: none;">
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--custom-skill-name">
						<label class="charsheet__modifier-form-label">Custom Skill Name</label>
						<input type="text" class="ve-form-control form-control--minimal" id="mod-custom-skill" placeholder="e.g., Sleight of Hand">
					</div>
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--custom-skill-ability">
						<label class="charsheet__modifier-form-label">Ability (optional)</label>
						<select class="ve-form-control form-control--minimal" id="mod-custom-skill-ability">
							<option value="">Any / None</option>
							<option value="str">Strength</option>
							<option value="dex">Dexterity</option>
							<option value="con">Constitution</option>
							<option value="int">Intelligence</option>
							<option value="wis">Wisdom</option>
							<option value="cha">Charisma</option>
						</select>
					</div>
				</div>
				<div class="charsheet__modifier-form-row">
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--advantage">
						<label class="charsheet__modifier-form-label">Advantage/Disadvantage</label>
						<select class="ve-form-control form-control--minimal" id="mod-advantage">
							<option value="">None</option>
							<option value="advantage">Advantage</option>
							<option value="disadvantage">Disadvantage</option>
						</select>
					</div>
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--minimum">
						<label class="charsheet__modifier-form-label">Minimum Roll</label>
						<input type="number" class="ve-form-control form-control--minimal" id="mod-minimum" value="" placeholder="e.g., 10">
					</div>
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--bonus-dice">
						<label class="charsheet__modifier-form-label">Bonus Dice</label>
						<div class="charsheet__modifier-form-dice-group">
							<input type="number" class="ve-form-control form-control--minimal charsheet__modifier-dice-count" id="mod-dice-count" min="1" max="20" placeholder="#" value="">
							<select class="ve-form-control form-control--minimal charsheet__modifier-dice-type" id="mod-dice-type">
								<option value="">—</option>
								<option value="d4">d4</option>
								<option value="d6">d6</option>
								<option value="d8">d8</option>
								<option value="d10">d10</option>
								<option value="d12">d12</option>
								<option value="d20">d20</option>
							</select>
						</div>
					</div>
				</div>
				<div class="charsheet__modifier-form-row">
					<div class="charsheet__modifier-form-field charsheet__modifier-form-field--conditional">
						<label class="charsheet__modifier-form-label">Conditional (optional)</label>
						<input type="text" class="ve-form-control form-control--minimal" id="mod-conditional" placeholder="e.g., against undead, while in dim light">
					</div>
				</div>
				<div class="charsheet__modifier-form-field charsheet__modifier-form-field--note">
					<label class="charsheet__modifier-form-label">Note (optional)</label>
					<input type="text" class="ve-form-control form-control--minimal" id="mod-note" placeholder="e.g., Lasts 1 minute, Concentration">
				</div>
				<div class="charsheet__modifier-form-actions">
					<button class="ve-btn ve-btn-primary ve-btn-sm" id="mod-save">💾 Save</button>
					<button class="ve-btn ve-btn-default ve-btn-sm" id="mod-cancel">Cancel</button>
				</div>
			</div>
			
			<div class="charsheet__modifiers-section">
				<div class="charsheet__modifiers-section-title">📊 Current Totals</div>
				<div class="charsheet__modifiers-summary-list" id="charsheet-modifiers-summary">
					<!-- Populated by renderSummary -->
				</div>
			</div>
		</div>`;
		modalInner.append(modifiersContent);

		// Render summary of active modifiers
		const renderSummary = () => {
			const summaryEl = modalInner.querySelector("#charsheet-modifiers-summary");
			summaryEl.innerHTML = "";

			const summaryItems = [
				{type: "ac", label: "AC", icon: "🛡️"},
				{type: "initiative", label: "Initiative", icon: "⚡"},
				{type: "speed", label: "Speed", icon: "👟"},
				{type: "attack", label: "Attack", icon: "⚔️"},
				{type: "damage", label: "Damage", icon: "💥"},
				{type: "spellDc", label: "Spell DC", icon: "🎯"},
				{type: "spellAttack", label: "Spell Attack", icon: "✨"},
				{type: "hp", label: "Max HP", icon: "❤️"},
			];

			let hasAny = false;
			summaryItems.forEach(item => {
				const value = this._state.getCustomModifier(item.type);
				if (value !== 0) {
					hasAny = true;
					const valueStr = value >= 0 ? `+${value}` : value;
					summaryEl.insertAdjacentHTML("beforeend", `
						<div class="charsheet__modifier-summary-item">
							<span class="charsheet__modifier-summary-icon">${item.icon}</span>
							<span class="charsheet__modifier-summary-label">${item.label}</span>
							<span class="charsheet__modifier-summary-value ${value >= 0 ? "charsheet__modifier-summary-value--positive" : "charsheet__modifier-summary-value--negative"}">${valueStr}</span>
						</div>
					`);
				}
			});

			// Show any save bonuses
			Parser.ABIL_ABVS.forEach(abl => {
				const value = this._state.getCustomModifier(`save:${abl}`);
				if (value !== 0) {
					hasAny = true;
					const valueStr = value >= 0 ? `+${value}` : value;
					summaryEl.insertAdjacentHTML("beforeend", `
						<div class="charsheet__modifier-summary-item">
							<span class="charsheet__modifier-summary-icon">💪</span>
							<span class="charsheet__modifier-summary-label">${Parser.attAbvToFull(abl)} Save</span>
							<span class="charsheet__modifier-summary-value ${value >= 0 ? "charsheet__modifier-summary-value--positive" : "charsheet__modifier-summary-value--negative"}">${valueStr}</span>
						</div>
					`);
				}
			});

			// Show passive skill bonuses (from named modifiers)
			const passiveBonuses = this._state.aggregateModifiersByPrefix("passive:");
			Object.entries(passiveBonuses).forEach(([skill, total]) => {
				if (total !== 0) {
					hasAny = true;
					const valueStr = total >= 0 ? `+${total}` : total;
					const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
					summaryEl.insertAdjacentHTML("beforeend", `
						<div class="charsheet__modifier-summary-item">
							<span class="charsheet__modifier-summary-icon">👁️</span>
							<span class="charsheet__modifier-summary-label">Passive ${skillName}</span>
							<span class="charsheet__modifier-summary-value ${total >= 0 ? "charsheet__modifier-summary-value--positive" : "charsheet__modifier-summary-value--negative"}">${valueStr}</span>
						</div>
					`);
				}
			});

			// Show skill bonuses (from named modifiers)
			const skillBonuses = this._state.aggregateModifiersByPrefix("skill:");
			Object.entries(skillBonuses).forEach(([skill, total]) => {
				if (total !== 0 && typeof total === "number") {
					hasAny = true;
					const valueStr = total >= 0 ? `+${total}` : total;
					const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
					summaryEl.insertAdjacentHTML("beforeend", `
						<div class="charsheet__modifier-summary-item">
							<span class="charsheet__modifier-summary-icon">📚</span>
							<span class="charsheet__modifier-summary-label">${skillName} Checks</span>
							<span class="charsheet__modifier-summary-value ${total >= 0 ? "charsheet__modifier-summary-value--positive" : "charsheet__modifier-summary-value--negative"}">${valueStr}</span>
						</div>
					`);
				} else if (total === "proficiency") {
					// Handle proficiency-based bonuses
					hasAny = true;
					const pb = this._state.getProficiencyBonus();
					const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
					summaryEl.insertAdjacentHTML("beforeend", `
						<div class="charsheet__modifier-summary-item">
							<span class="charsheet__modifier-summary-icon">📚</span>
							<span class="charsheet__modifier-summary-label">${skillName} Checks</span>
							<span class="charsheet__modifier-summary-value charsheet__modifier-summary-value--positive">+PB (+${pb})</span>
						</div>
					`);
				}
			});

			if (!hasAny) {
				summaryEl.insertAdjacentHTML("beforeend", `<div class="charsheet__modifiers-empty">No active modifiers affecting stats</div>`);
			}
		};

		// Add modifier button
		modalInner.querySelector("#charsheet-btn-add-modifier").addEventListener("click", () => showEditForm());

		// Bind type change to show/hide custom skill fields
		modalInner.addEventListener("change", function (e) {
			if (e.target.id !== "mod-type") return;
			updateCustomSkillVisibility(modalInner.querySelector("#charsheet-modifier-form"));
		});

		// Save modifier
		modalInner.querySelector("#mod-save").addEventListener("click", () => {
			const formEl = modalInner.querySelector("#charsheet-modifier-form");
			const name = formEl.querySelector("#mod-name").value.trim();
			let type = formEl.querySelector("#mod-type").value;
			const value = parseInt(formEl.querySelector("#mod-value").value) || 0;
			const scalingVal = formEl.querySelector("#mod-scaling").value;
			const note = formEl.querySelector("#mod-note").value.trim();
			const advantageVal = formEl.querySelector("#mod-advantage").value;
			const minimumVal = formEl.querySelector("#mod-minimum").value;
			const diceCount = parseInt(formEl.querySelector("#mod-dice-count").value) || 0;
			const diceType = formEl.querySelector("#mod-dice-type").value;
			const conditional = formEl.querySelector("#mod-conditional").value.trim();
			const customSkillName = formEl.querySelector("#mod-custom-skill").value.trim();
			const customSkillAbility = formEl.querySelector("#mod-custom-skill-ability").value;

			if (!name) {
				JqueryUtil.doToast({type: "warning", content: "Please enter a name for the modifier."});
				return;
			}

			// Handle custom skill/passive types
			if (type === "skill:custom" || type === "passive:custom") {
				if (!customSkillName) {
					JqueryUtil.doToast({type: "warning", content: "Please enter a custom skill name."});
					return;
				}
				// Convert custom skill to proper type
				const skillKey = customSkillName.toLowerCase().replace(/\s+/g, "");
				type = type === "skill:custom" ? `skill:${skillKey}` : `passive:${skillKey}`;
			}

			// Build modifier object with only non-empty properties
			const modifier = {name, type, value, enabled: true};
			if (note) modifier.note = note;
			// Handle scaling options
			if (scalingVal === "proficiencyBonus") modifier.proficiencyBonus = true;
			else if (scalingVal === "halfProficiency") modifier.halfProficiency = true;
			else if (scalingVal === "doubleProficiency") modifier.doubleProficiency = true;
			else if (scalingVal?.startsWith("abilityMod:")) modifier.abilityMod = scalingVal.replace("abilityMod:", "");
			else if (scalingVal === "perLevel") modifier.perLevel = true;
			if (advantageVal === "advantage") modifier.advantage = true;
			if (advantageVal === "disadvantage") modifier.disadvantage = true;
			if (minimumVal && !isNaN(parseInt(minimumVal))) modifier.setMinimum = parseInt(minimumVal);
			// Combine dice count and type into bonusDie string (e.g., "2d6")
			if (diceCount > 0 && diceType) modifier.bonusDie = `${diceCount}${diceType}`;
			if (conditional) modifier.conditional = conditional;
			// Store custom skill info for editing later
			if (customSkillName) modifier.customSkillName = customSkillName;
			if (customSkillAbility) modifier.customSkillAbility = customSkillAbility;

			const editingId = formEl.dataset.editingId;
			if (editingId) {
				this._state.updateNamedModifier(editingId, modifier);
			} else {
				this._state.addNamedModifier(modifier);
			}

			formEl.style.display = "none";
			renderModifiersList();
			renderSummary();
		});

		// Cancel form
		modalInner.querySelector("#mod-cancel").addEventListener("click", () => {
			modalInner.querySelector("#charsheet-modifier-form").style.display = "none";
		});

		// Initial render
		renderModifiersList();
		renderSummary();
	}
	// #endregion

	// Data getters for sub-modules
	getRaces () { return this._races; }
	getClasses () { return this._classes; }
	getSubclasses () { return this._subclasses; }
	getClassFeatures () { return this._classFeatures; }
	getSubclassFeatures () { return this._subclassFeatures; }
	getBackgrounds () { return this._backgrounds; }
	getSpells () { return this._spellsData; }
	getItems () { return this._itemsData; }
	getFeats () { return this._featsData; }
	getOptionalFeatures () { return this._optionalFeaturesData; }
	getCombatMethodEntities () { return this._combatMethodsData; }
	getItemUpgrades () { return this._itemUpgradesData; }
	getUpgradesModule () { return this._upgrades; }
	getSkillsData () { return this._skillsData; }
	getConditionsData () { return this._conditionsData; }
	getState () { return this._state; }
	getLayout () { return this._layout; }
	getNotes () { return this._notes; }
	getPlayMode () { return this._playMode; }

	/**
	 * Get tools list from items data (artisan tools, gaming sets, musical instruments, other tools)
	 * @returns {Array} Array of {name, source} objects
	 */
	getToolsList () {
		const toolTypes = ["AT", "GS", "INS", "T", "TK"]; // Artisan Tools, Gaming Set, Instrument, Tool, Thieves Kit
		const toolsMap = new Map();

		this._itemsData.forEach(item => {
			// Check if item is a tool type
			if (item.type && toolTypes.includes(item.type)) {
				const existing = toolsMap.get(item.name);
				// Prefer XPHB (2024) version
				if (!existing || item.source === Parser.SRC_XPHB) {
					toolsMap.set(item.name, {
						name: item.name,
						source: item.source,
					});
				}
			}
		});

		// Sort alphabetically
		return Array.from(toolsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Get unique skills list, preferring 2024 (XPHB) versions, including custom skills
	 * @returns {Array} Array of {name, ability, isCustom} objects
	 */
	getSkillsList () {
		// Create map of skills, preferring XPHB sources
		const skillsMap = new Map();
		this._skillsData.forEach(skill => {
			const existing = skillsMap.get(skill.name);
			// Prefer XPHB (2024) version
			if (!existing || skill.source === Parser.SRC_XPHB) {
				skillsMap.set(skill.name, {
					name: skill.name,
					ability: skill.ability,
					source: skill.source,
					isCustom: false,
				});
			}
		});

		// Add custom skills from state
		const customSkills = this._state.getCustomSkills();
		customSkills.forEach(skill => {
			// Only add if not overriding a standard skill
			if (!skillsMap.has(skill.name)) {
				skillsMap.set(skill.name, {
					name: skill.name,
					ability: skill.ability,
					source: "Custom",
					isCustom: true,
					isLoreSkill: !!skill.isLoreSkill,
				});
			}
		});

		// Sort alphabetically
		return Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Get all conditions list with sources (allows same-name conditions from different sources)
	 * @returns {Array} Array of {name, source, sourceAbbr} objects sorted by name then source
	 */
	getConditionsList () {
		// Return all conditions with their sources
		return this._conditionsData
			.map(cond => ({
				name: cond.name,
				source: cond.source,
				sourceAbbr: Parser.sourceJsonToAbv(cond.source),
			}))
			.sort((a, b) => {
				// Sort by name first, then by source (XPHB first)
				const nameCompare = a.name.localeCompare(b.name);
				if (nameCompare !== 0) return nameCompare;
				// Prefer XPHB (2024) version to appear first
				if (a.source === Parser.SRC_XPHB) return -1;
				if (b.source === Parser.SRC_XPHB) return 1;
				return a.source.localeCompare(b.source);
			});
	}

	/**
	 * Get unique condition names (legacy method for backward compatibility)
	 * @returns {Array} Array of condition names
	 */
	getConditionNamesList () {
		const conditionsMap = new Map();
		this._conditionsData.forEach(cond => {
			const existing = conditionsMap.get(cond.name);
			// Prefer XPHB (2024) version
			if (!existing || cond.source === Parser.SRC_XPHB) {
				conditionsMap.set(cond.name, cond.name);
			}
		});
		return Array.from(conditionsMap.values()).sort();
	}

	/**
	 * Get unique conditions with priority source filtering applied
	 * Returns one version per condition name, preferring priority sources
	 * @returns {Array<{name: string, source: string, sourceAbbr: string}>} Array of unique conditions
	 */
	getConditionsListUnique () {
		const prioritySources = this._state.getPrioritySources() || [];
		const conditionMap = new Map();

		// Build map of conditions, preferring priority sources, then XPHB
		this._conditionsData.forEach(cond => {
			const existing = conditionMap.get(cond.name.toLowerCase());
			if (!existing) {
				conditionMap.set(cond.name.toLowerCase(), {
					name: cond.name,
					source: cond.source,
					sourceAbbr: Parser.sourceJsonToAbv(cond.source),
				});
			} else if (prioritySources.length) {
				const existingIsPriority = prioritySources.includes(existing.source);
				const newIsPriority = prioritySources.includes(cond.source);
				if (newIsPriority && !existingIsPriority) {
					conditionMap.set(cond.name.toLowerCase(), {
						name: cond.name,
						source: cond.source,
						sourceAbbr: Parser.sourceJsonToAbv(cond.source),
					});
				}
			} else if (cond.source === Parser.SRC_XPHB && existing.source !== Parser.SRC_XPHB) {
				conditionMap.set(cond.name.toLowerCase(), {
					name: cond.name,
					source: cond.source,
					sourceAbbr: Parser.sourceJsonToAbv(cond.source),
				});
			}
		});

		// Sort: priority sources first, then alphabetically
		return Array.from(conditionMap.values()).sort((a, b) => {
			const aIsPriority = prioritySources.includes(a.source);
			const bIsPriority = prioritySources.includes(b.source);
			if (aIsPriority && !bIsPriority) return -1;
			if (!aIsPriority && bIsPriority) return 1;
			return a.name.localeCompare(b.name);
		});
	}

	/**
	 * Get unique languages list, preferring 2024 (XPHB) versions
	 * @returns {Array} Array of {name, source} objects
	 */
	getLanguagesList () {
		// Create map of languages, preferring XPHB sources
		const langMap = new Map();
		this._languagesData.forEach(lang => {
			const existing = langMap.get(lang.name);
			// Prefer XPHB (2024) version
			if (!existing || lang.source === Parser.SRC_XPHB) {
				langMap.set(lang.name, {
					name: lang.name,
					source: lang.source,
				});
			}
		});
		// Sort alphabetically
		return Array.from(langMap.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Get all available language names sorted by priority sources first
	 * @returns {Array} Array of language names with priority sources first
	 */
	getLanguageNamesSorted () {
		const prioritySources = this._state.getPrioritySources() || [];
		const isTgtt = prioritySources.includes("TGTT");
		const langMap = new Map();

		// Build map of languages, tracking source for each
		this._languagesData.forEach(lang => {
			const existing = langMap.get(lang.name);
			// Prefer priority sources, then XPHB
			if (!existing) {
				langMap.set(lang.name, {name: lang.name, source: lang.source});
			} else if (prioritySources.includes(lang.source) && !prioritySources.includes(existing.source)) {
				langMap.set(lang.name, {name: lang.name, source: lang.source});
			} else if (lang.source === Parser.SRC_XPHB && !prioritySources.includes(existing.source)) {
				langMap.set(lang.name, {name: lang.name, source: lang.source});
			}

			// Also add dialect names so they appear as choosable languages
			if (lang.dialects?.length) {
				for (const dialect of lang.dialects) {
					if (!langMap.has(dialect)) {
						langMap.set(dialect, {name: dialect, source: lang.source});
					}
				}
			}
		});

		// When TGTT is priority, exclude non-Common standard D&D languages
		if (isTgtt) {
			const standardSet = new Set(Parser.LANGUAGES_STANDARD);
			for (const [name] of langMap) {
				if (standardSet.has(name) && name !== "Common") langMap.delete(name);
			}
		}

		// Convert to array and sort: priority sources first, then alphabetically
		const languages = Array.from(langMap.values());
		return languages.sort((a, b) => {
			const aIsPriority = prioritySources.includes(a.source);
			const bIsPriority = prioritySources.includes(b.source);
			if (aIsPriority && !bIsPriority) return -1;
			if (!aIsPriority && bIsPriority) return 1;
			return a.name.localeCompare(b.name);
		}).map(l => l.name);
	}

	/**
	 * Get languages grouped by type for dropdown rendering
	 * Includes homebrew languages in a separate group with priority sources first
	 * @returns {{standard: string[], exotic: string[], secret: string[], homebrew: string[]}}
	 */
	getLanguageOptionsGrouped () {
		const prioritySources = this._state.getPrioritySources() || [];
		const isTgtt = prioritySources.includes("TGTT");

		// Standard D&D language categories
		const standardSet = new Set(Parser.LANGUAGES_STANDARD);
		const exoticSet = new Set(Parser.LANGUAGES_EXOTIC);
		const secretSet = new Set(Parser.LANGUAGES_SECRET);

		// Build a lookup of TGTT language type by name for categorization
		const tgttTypeMap = new Map();
		if (isTgtt) {
			this._languagesData.forEach(lang => {
				if (prioritySources.includes(lang.source) && lang.type) {
					tgttTypeMap.set(lang.name, lang.type);
				}
			});
		}

		// Collect all loaded language names, preferring priority sources
		const langMap = new Map();
		this._languagesData.forEach(lang => {
			const existing = langMap.get(lang.name);
			if (!existing) {
				langMap.set(lang.name, {name: lang.name, source: lang.source});
			} else if (prioritySources.includes(lang.source) && !prioritySources.includes(existing.source)) {
				langMap.set(lang.name, {name: lang.name, source: lang.source});
			} else if (lang.source === Parser.SRC_XPHB && !prioritySources.includes(existing.source)) {
				langMap.set(lang.name, {name: lang.name, source: lang.source});
			}

			// Also add dialect names so they appear as choosable languages
			if (lang.dialects?.length) {
				for (const dialect of lang.dialects) {
					if (!langMap.has(dialect)) {
						langMap.set(dialect, {name: dialect, source: lang.source});
					}
				}
			}
		});

		// Categorize languages
		const standard = [];
		const exotic = [];
		const secret = [];
		const homebrew = [];

		// Sort helper: priority sources first, then alphabetically
		const sortLangs = (arr) => arr.sort((a, b) => {
			const aInfo = langMap.get(a);
			const bInfo = langMap.get(b);
			const aIsPriority = aInfo && prioritySources.includes(aInfo.source);
			const bIsPriority = bInfo && prioritySources.includes(bInfo.source);
			if (aIsPriority && !bIsPriority) return -1;
			if (!aIsPriority && bIsPriority) return 1;
			return a.localeCompare(b);
		});

		// Add languages from loaded data
		for (const [name] of langMap) {
			// When TGTT is priority, use the TGTT type field to categorize homebrew languages
			// and exclude non-Common standard D&D languages
			if (isTgtt) {
				if (standardSet.has(name) && name !== "Common") continue;
				const tgttType = tgttTypeMap.get(name);
				if (tgttType === "standard") { standard.push(name); continue; }
				if (tgttType === "exotic") { exotic.push(name); continue; }
			}

			if (standardSet.has(name)) {
				standard.push(name);
			} else if (exoticSet.has(name)) {
				exotic.push(name);
			} else if (secretSet.has(name)) {
				secret.push(name);
			} else {
				homebrew.push(name);
			}
		}

		// Add any standard/exotic/secret languages not in loaded data (fallback)
		// When TGTT is priority, skip non-Common standard fallbacks
		Parser.LANGUAGES_STANDARD.forEach(l => {
			if (langMap.has(l)) return;
			if (isTgtt && l !== "Common") return;
			standard.push(l);
		});
		Parser.LANGUAGES_EXOTIC.forEach(l => {
			if (!langMap.has(l)) exotic.push(l);
		});
		Parser.LANGUAGES_SECRET.forEach(l => {
			if (!langMap.has(l)) secret.push(l);
		});

		return {
			standard: sortLangs(standard),
			exotic: sortLangs(exotic),
			secret: sortLangs(secret),
			homebrew: sortLangs(homebrew),
		};
	}

	/**
	 * Show a searchable language picker modal
	 * @param {*} [opts] - Options
	 * @returns {Promise<Array|null>} Array of selected language names or null if cancelled
	 */
	async showLanguagePicker (opts = {}) {
		const {exclude = [], title = "Choose a Language", count = 1} = /** @type {*} */ (opts);

		// Get current languages to exclude
		const currentLanguages = this._state.getLanguages() || [];
		const excludeSet = new Set([...exclude, ...currentLanguages].map(l => l.toLowerCase()));

		// Get grouped language options
		const langOptions = this.getLanguageOptionsGrouped();

		// Flatten all languages with their category
		const allLanguages = [
			...langOptions.standard.map(l => ({name: l, category: "Standard"})),
			...langOptions.exotic.map(l => ({name: l, category: "Exotic"})),
			...langOptions.secret.map(l => ({name: l, category: "Secret"})),
			...langOptions.homebrew.map(l => ({name: l, category: "Homebrew"})),
		].filter(l => !excludeSet.has(l.name.toLowerCase()));

		const selectedLanguages = [];

		return new Promise((resolve) => {
			(async () => {
				const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
					title: count > 1 ? `${title} (Choose ${count})` : title,
					isMinHeight0: true,
					isWidth100: true,
					cbClose: () => resolve(selectedLanguages.length === count ? selectedLanguages : null),
				});

				modalInner.insertAdjacentHTML("beforeend", `
					<div class="charsheet__language-picker-header mb-3" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.1)); border-radius: 8px; padding: 12px;">
						<div class="ve-flex ve-flex-v-center" style="gap: 10px;">
							<span style="font-size: 2em;">🗣️</span>
							<div>
								<div class="bold" style="font-size: 1.1em;">${title}</div>
								<div class="ve-muted ve-small">Select ${count === 1 ? "a language" : `${count} languages`} to learn. Search to filter.</div>
							</div>
						</div>
					</div>
				`);

				// Search filter
				const searchContainer = e_({outer: `<div class="ve-flex ve-flex-v-center mb-3" style="gap: 8px;"></div>`}); modalInner.append(searchContainer);
				searchContainer.insertAdjacentHTML("beforeend", `<span style="font-size: 1.2em;">🔍</span>`);
				const searchEl = e_({outer: `<input type="text" class="ve-form-control" placeholder="Search languages..." style="flex: 1;">`}); searchContainer.append(searchEl);

				// Selection status
				const statusEl = e_({outer: `<div class="ve-flex ve-flex-v-center mb-2" style="gap: 8px;">
					<span class="ve-muted">Selected: </span>
					<span class="badge" style="background: rgba(var(--rgb-link-rgb), 0.15); color: var(--rgb-link);">
						<span class="lang-count">0</span>/${count}
					</span>
					<span class="selected-names ve-muted ve-small"></span>
				</div>`}); modalInner.append(statusEl);

				// Languages grid
				const listEl = e_({outer: `<div class="charsheet__language-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; max-height: 400px; overflow-y: auto; padding: 4px;"></div>`}); modalInner.append(listEl);

				// Category icons/colors
				const categoryInfo = {
					Standard: {emoji: "📜", color: "rgba(59, 130, 246, 0.1)"},
					Exotic: {emoji: "✨", color: "rgba(139, 92, 246, 0.1)"},
					Secret: {emoji: "🤫", color: "rgba(239, 68, 68, 0.1)"},
					Homebrew: {emoji: "🍺", color: "rgba(245, 158, 11, 0.1)"},
				};

				const updateStatus = () => {
					statusEl.querySelector(".lang-count").textContent = selectedLanguages.length;
					statusEl.querySelector(".selected-names").textContent = selectedLanguages.length ? `(${selectedLanguages.join(", ")})` : "";
				};

				const renderList = (filter = "") => {
					listEl.innerHTML = "";
					const filtered = allLanguages.filter(l =>
						l.name.toLowerCase().includes(filter.toLowerCase())
						&& !selectedLanguages.includes(l.name),
					);

					if (filtered.length === 0 && selectedLanguages.length === 0) {
						listEl.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-text-center py-3" style="grid-column: 1 / -1;">No languages match your search</div>`);
						return;
					}

					// Group by category
					const byCategory = {};
					filtered.forEach(l => {
						if (!byCategory[l.category]) byCategory[l.category] = [];
						byCategory[l.category].push(l);
					});

					// Render each category
					for (const category of ["Standard", "Exotic", "Secret", "Homebrew"]) {
						const langs = byCategory[category];
						if (!langs?.length) continue;

						const info = categoryInfo[category];

						// Category header
						listEl.insertAdjacentHTML("beforeend", `<div style="grid-column: 1 / -1; margin-top: 8px; font-weight: bold; color: var(--rgb-link); display: flex; align-items: center; gap: 6px;">
							<span>${info.emoji}</span> ${category} Languages
						</div>`);

						langs.forEach(lang => {
							const cardEl = e_({outer: `
								<div class="charsheet__language-card" style="
									border: 2px solid var(--rgb-border-grey-muted);
									border-radius: 8px;
									padding: 10px;
									cursor: pointer;
									transition: all 0.2s ease;
									background: ${info.color};
									display: flex;
									align-items: center;
									gap: 8px;
								">
									<span style="font-size: 1.3em;">${info.emoji}</span>
									<span class="bold">${lang.name}</span>
								</div>
							`});

							cardEl.addEventListener("mouseenter", function () {
								Object.assign(this.style, {
									"border-color": "var(--rgb-link)",
									"transform": "translateY(-2px)",
									"box-shadow": "0 4px 8px rgba(0, 0, 0, 0.1)",
								});
							});
							cardEl.addEventListener("mouseleave", function () {
								Object.assign(this.style, {
									"border-color": "var(--rgb-border-grey-muted)",
									"transform": "translateY(0)",
									"box-shadow": "none",
								});
							});
							cardEl.addEventListener("click", function () {
								if (selectedLanguages.length < count) {
									selectedLanguages.push(lang.name);
									updateStatus();
									if (selectedLanguages.length === count) {
										doClose();
									} else {
										renderList(searchEl.value);
									}
								}
							});

							listEl.append(cardEl);
						});
					}
				};

				// Confirm button
				const footerEl = e_({outer: `<div class="ve-flex ve-flex-h-right mt-3"></div>`}); modalInner.append(footerEl);
				const confirmBtn = e_({outer: `<button class="ve-btn ve-btn-primary" ${count > 1 ? "disabled" : ""}>Confirm Selection</button>`}); footerEl.append(confirmBtn);
				confirmBtn.addEventListener("click", () => {
					if (selectedLanguages.length === count || count === 1) {
						doClose();
					}
				});

				searchEl.addEventListener("input", () => renderList(searchEl.value));
				renderList();

				// Auto-focus search
				setTimeout(() => searchEl.focus(), 100);
			})();
		});
	}

	async saveCharacter () {
		await this._saveCurrentCharacter();
	}

	/**
	 * Deterministically replay history-backed martial choices.
	 * Uses level history as source of truth and reapplies the latest recorded
	 * combat traditions and weapon masteries in level order.
	 *
	 * Legacy-safe behavior: if history contains no entry for a choice type,
	 * preserve the current state value for that type.
	 *
	 * @returns {{combatTraditions: string[], weaponMasteries: string[]}}
	 */
	replayHistoryMartialChoices () {
		const baselineTraditions = this._state.getCombatTraditions();
		const baselineMasteries = this._state.getWeaponMasteries();

		let replayTraditions = [...baselineTraditions];
		let replayMasteries = [...baselineMasteries];

		const history = [...(this._state.getLevelHistory() || [])].sort((a, b) => a.level - b.level);
		for (const entry of history) {
			if (Array.isArray(entry?.choices?.combatTraditions)) {
				replayTraditions = [...entry.choices.combatTraditions];
			}

			if (Array.isArray(entry?.choices?.weaponMasteries)) {
				replayMasteries = [...entry.choices.weaponMasteries];
			}
		}

		this._state.setCombatTraditions(replayTraditions);
		this._state.setWeaponMasteries(replayMasteries);

		return {
			combatTraditions: replayTraditions,
			weaponMasteries: replayMasteries,
		};
	}

	/**
	 * Resolve the best history level to write a martial choice to.
	 * Prefers the latest level that already recorded the choice, otherwise
	 * falls back to the latest level if history is complete.
	 *
	 * @param {"combatTraditions"|"weaponMasteries"} choiceKey
	 * @returns {number|null}
	 */
	_getHistoryLevelForMartialChoice (choiceKey) {
		const history = [...(this._state.getLevelHistory() || [])].sort((a, b) => a.level - b.level);
		if (!history.length) return null;

		for (let i = history.length - 1; i >= 0; i--) {
			const entry = history[i];
			if (Array.isArray(entry?.choices?.[choiceKey])) return entry.level;
		}

		if (this._state.hasCompleteLevelHistory?.()) return history[history.length - 1].level;
		return null;
	}

	/**
	 * Public accessor for max weapon masteries based on class progression.
	 * @returns {number}
	 */
	getMaxWeaponMasteries () {
		return this._getMaxWeaponMasteries();
	}

	renderCharacter () {
		this._renderCharacter();
	}

	/**
	 * Show modal for adding a custom skill
	 */
	async _showAddCustomSkillModal () {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Add Custom Skill",
			isMinHeight0: true,
		});

		const abilityOptions = [
			{value: "", label: "None (flat bonus)"},
			{value: "str", label: "Strength"},
			{value: "dex", label: "Dexterity"},
			{value: "con", label: "Constitution"},
			{value: "int", label: "Intelligence"},
			{value: "wis", label: "Wisdom"},
			{value: "cha", label: "Charisma"},
		];

		const formEl = ee`<div class="ve-flex-col">
			<div class="ve-flex-v-center mb-2">
				<label class="mr-2 w-100p">Skill Name:</label>
				<input type="text" class="ve-form-control" id="custom-skill-name" placeholder="e.g. Brewing, Sailing">
			</div>
			<div class="ve-flex-v-center mb-3">
				<label class="mr-2 w-100p">Ability:</label>
				<select class="ve-form-control" id="custom-skill-ability">
					${abilityOptions.map(a => `<option value="${a.value}">${a.label}</option>`).join("")}
				</select>
			</div>
			<div class="ve-flex-h-right">
				<button class="ve-btn ve-btn-default mr-2" id="custom-skill-cancel">Cancel</button>
				<button class="ve-btn ve-btn-primary" id="custom-skill-add">Add Skill</button>
			</div>
		</div>`;
		modalInner.append(formEl);

		const nameEl = formEl.querySelector("#custom-skill-name");
		const abilityEl = formEl.querySelector("#custom-skill-ability");
		const addBtnEl = formEl.querySelector("#custom-skill-add");
		const cancelBtn = formEl.querySelector("#custom-skill-cancel");

		cancelBtn.addEventListener("click", () => doClose());

		addBtnEl.addEventListener("click", () => {
			const name = nameEl.value.trim();
			const ability = abilityEl.value;

			if (!name) {
				JqueryUtil.doToast({type: "warning", content: "Please enter a skill name."});
				return;
			}

			// Check if skill already exists
			const skillKey = name.toLowerCase().replace(/\s+/g, "");
			const existingSkills = this.getSkillsList();
			if (existingSkills.some(s => s.name.toLowerCase().replace(/\s+/g, "") === skillKey)) {
				JqueryUtil.doToast({type: "warning", content: `A skill named "${name}" already exists.`});
				return;
			}

			// Add the custom skill
			this._state.addCustomSkill(name, ability);
			this._renderSkills();
			this._saveCurrentCharacter();

			JqueryUtil.doToast({type: "success", content: `Added custom skill: ${name}`});
			doClose();
		});

		// Allow Enter key to submit
		nameEl.addEventListener("keypress", (e) => {
			if (e.which === 13) addBtnEl.click();
		});

		// Focus the name input
		nameEl.focus();
	}

	/**
	 * Show modal for adding a lore skill (TGTT variant rule).
	 * Lore skills use a flat per-skill bonus only (no ability or PB).
	 * Default chips are +2/+4/+6 with a numeric override for DM discretion.
	 */
	async _showAddLoreSkillModal () {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Add Lore Skill",
			isMinHeight0: true,
		});

		const formEl = ee`<div class="ve-flex-col">
			<div class="ve-muted ve-small mb-2">
				Lore skills represent narrow areas of expertise (e.g. Heraldry, Architecture, Planar Geography).
				The bonus is added directly to your roll &mdash; no ability or proficiency bonus is applied.
			</div>
			<div class="ve-flex-v-center mb-2">
				<label class="mr-2 w-100p">Skill Name:</label>
				<input type="text" class="ve-form-control" id="lore-skill-name" placeholder="e.g. Heraldry, Planar Geography">
			</div>
			<div class="ve-flex-v-center mb-3">
				<label class="mr-2 w-100p">Bonus:</label>
				<div class="ve-btn-group mr-2" role="group" id="lore-skill-bonus-chips">
					<button type="button" class="ve-btn ve-btn-default ve-btn-sm active" data-bonus="2">+2</button>
					<button type="button" class="ve-btn ve-btn-default ve-btn-sm" data-bonus="4">+4</button>
					<button type="button" class="ve-btn ve-btn-default ve-btn-sm" data-bonus="6">+6</button>
				</div>
				<input type="number" class="ve-form-control" id="lore-skill-bonus-custom" min="1" max="20" step="1" placeholder="custom" style="width: 6em;">
			</div>
			<div class="ve-flex-h-right">
				<button class="ve-btn ve-btn-default mr-2" id="lore-skill-cancel">Cancel</button>
				<button class="ve-btn ve-btn-primary" id="lore-skill-add">Add Lore Skill</button>
			</div>
		</div>`;
		modalInner.append(formEl);

		const nameEl = formEl.querySelector("#lore-skill-name");
		const customEl = formEl.querySelector("#lore-skill-bonus-custom");
		const chipsEl = formEl.querySelector("#lore-skill-bonus-chips");
		const addBtnEl = formEl.querySelector("#lore-skill-add");
		const cancelBtn = formEl.querySelector("#lore-skill-cancel");

		let selectedBonus = 2;
		chipsEl.querySelectorAll("button").forEach(btn => {
			btn.addEventListener("click", () => {
				selectedBonus = Number(btn.getAttribute("data-bonus")) || 2;
				chipsEl.querySelectorAll("button").forEach(b => b.classList.remove("active"));
				btn.classList.add("active");
				customEl.value = "";
			});
		});
		customEl.addEventListener("input", () => {
			const v = Number(customEl.value);
			if (Number.isFinite(v) && v > 0) {
				selectedBonus = v;
				chipsEl.querySelectorAll("button").forEach(b => b.classList.remove("active"));
			}
		});

		cancelBtn.addEventListener("click", () => doClose());

		addBtnEl.addEventListener("click", () => {
			const name = nameEl.value.trim();
			if (!name) {
				JqueryUtil.doToast({type: "warning", content: "Please enter a lore skill name."});
				return;
			}
			const skillKey = name.toLowerCase().replace(/\s+/g, "");
			const existingSkills = this.getSkillsList();
			if (existingSkills.some(s => s.name.toLowerCase().replace(/\s+/g, "") === skillKey)) {
				JqueryUtil.doToast({type: "warning", content: `A skill named "${name}" already exists.`});
				return;
			}
			if (selectedBonus < 1) {
				JqueryUtil.doToast({type: "warning", content: "Bonus must be at least +1."});
				return;
			}

			this._state.addLoreSkill(name, selectedBonus);
			this._renderSkills();
			this._saveCurrentCharacter();

			JqueryUtil.doToast({type: "success", content: `Added lore skill: ${name} (+${selectedBonus})`});
			doClose();
		});

		nameEl.addEventListener("keypress", (e) => {
			if (e.which === 13) addBtnEl.click();
		});

		nameEl.focus();
	}

	/**
	 * Show modal for the TGTT Lore Mastery feat's RAW choice.
	 * Per the variant rule, the player must pick one of:
	 *   - "increase": choose 2 existing lore skills; each gains +2
	 *   - "grant":    gain 2 new lore skills, each at +2
	 * @returns {Promise<{mode:"increase"|"grant", skills:[string,string]}|null>} payload or null on cancel
	 */
	async _showLoreMasteryChoiceModal () {
		let resolveOuter;
		const outerPromise = new Promise(r => { resolveOuter = r; });
		let isResolved = false;
		const resolveOnce = (value) => {
			if (isResolved) return;
			isResolved = true;
			resolveOuter(value);
		};

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Lore Mastery — Choose",
			isMinHeight0: true,
			cbClose: () => resolveOnce(null),
		});
		const finish = (value) => {
			resolveOnce(value);
			doClose(true);
		};

		const existingLoreSkills = this._state.getLoreSkills();
		const canIncrease = existingLoreSkills.length >= 2;

		const formEl = ee`<div class="ve-flex-col">
			<div class="ve-muted ve-small mb-3">
				Choose how Lore Mastery applies. You can either deepen your existing lore expertise
				or branch into new fields of study.
			</div>
			<div class="ve-flex-v-center mb-2">
				<label class="mr-2">
					<input type="radio" name="lore-mastery-mode" value="increase" ${canIncrease ? "checked" : "disabled"}>
					Increase: pick 2 existing lore skills (+2 each)
				</label>
			</div>
			${!canIncrease ? `<div class="ve-muted ve-small ml-4 mb-2">You need at least 2 existing lore skills to use this option.</div>` : ""}
			<div class="ve-flex-v-center mb-3">
				<label class="mr-2">
					<input type="radio" name="lore-mastery-mode" value="grant" ${canIncrease ? "" : "checked"}>
					Grant: gain 2 new lore skills (+2 each)
				</label>
			</div>
			<div class="ve-flex-v-center mb-2">
				<label class="mr-2 w-100p">Skill 1:</label>
				<input type="text" class="ve-form-control" id="lore-mastery-skill1" list="lore-mastery-skill1-list">
				<datalist id="lore-mastery-skill1-list">
					${existingLoreSkills.map(s => `<option value="${s.name}">`).join("")}
				</datalist>
			</div>
			<div class="ve-flex-v-center mb-3">
				<label class="mr-2 w-100p">Skill 2:</label>
				<input type="text" class="ve-form-control" id="lore-mastery-skill2" list="lore-mastery-skill2-list">
				<datalist id="lore-mastery-skill2-list">
					${existingLoreSkills.map(s => `<option value="${s.name}">`).join("")}
				</datalist>
			</div>
			<div class="ve-flex-h-right">
				<button class="ve-btn ve-btn-default mr-2" id="lore-mastery-cancel">Cancel</button>
				<button class="ve-btn ve-btn-primary" id="lore-mastery-confirm">Confirm</button>
			</div>
		</div>`;
		modalInner.append(formEl);

		const skill1El = formEl.querySelector("#lore-mastery-skill1");
		const skill2El = formEl.querySelector("#lore-mastery-skill2");
		const confirmBtn = formEl.querySelector("#lore-mastery-confirm");
		const cancelBtn = formEl.querySelector("#lore-mastery-cancel");

		cancelBtn.addEventListener("click", () => finish(null));

		confirmBtn.addEventListener("click", () => {
			const mode = formEl.querySelector("input[name=\"lore-mastery-mode\"]:checked")?.value;
			const s1 = skill1El.value.trim();
			const s2 = skill2El.value.trim();

			if (!mode) {
				JqueryUtil.doToast({type: "warning", content: "Pick a mode first."});
				return;
			}
			if (!s1 || !s2) {
				JqueryUtil.doToast({type: "warning", content: "Both skill slots are required."});
				return;
			}
			if (s1.toLowerCase() === s2.toLowerCase()) {
				JqueryUtil.doToast({type: "warning", content: "The two picks must be different."});
				return;
			}

			if (mode === "increase") {
				const known = new Set(existingLoreSkills.map(s => s.name.toLowerCase()));
				if (!known.has(s1.toLowerCase()) || !known.has(s2.toLowerCase())) {
					JqueryUtil.doToast({type: "warning", content: "Increase mode requires existing lore skills."});
					return;
				}
			} else if (mode === "grant") {
				const allSkills = this.getSkillsList();
				const collide = (n) => allSkills.some(s => s.name.toLowerCase().replace(/\s+/g, "") === n.toLowerCase().replace(/\s+/g, ""));
				if (collide(s1) || collide(s2)) {
					JqueryUtil.doToast({type: "warning", content: "Grant mode requires new lore skill names."});
					return;
				}
			}

			finish({mode, skills: [s1, s2]});
		});

		skill1El.focus();
		return outerPromise;
	}

	/**
	 * Get available suggestions for each proficiency type
	 */
	_getProficiencySuggestions () {
		// Armor types
		const armorSuggestions = ["Light Armor", "Medium Armor", "Heavy Armor", "Shields"];

		// Weapons - from items data, filter by weapon types
		const weaponTypes = new Set();
		this._itemsData.forEach(item => {
			if (item.weapon || item.type === "M" || item.type === "R") {
				weaponTypes.add(item.name);
			}
		});
		// Add category proficiencies
		const weaponSuggestions = ["Simple Weapons", "Martial Weapons", ...Array.from(weaponTypes).sort()];

		// Tools - from items data, filter by tool types (AT, GS, INS, T)
		const toolTypes = new Set();
		this._itemsData.forEach(item => {
			const type = item.type?.split("|")[0]; // Strip source from type
			if (["AT", "GS", "INS", "T"].includes(type)) {
				toolTypes.add(item.name);
			}
		});
		const toolSuggestions = Array.from(toolTypes).sort();

		// Languages - from languages data, deduplicated by name (prefer XPHB)
		const langMap = new Map();
		this._languagesData.forEach(lang => {
			const existing = langMap.get(lang.name);
			if (!existing || lang.source === Parser.SRC_XPHB) {
				langMap.set(lang.name, lang.name);
			}
		});
		const languageSuggestions = Array.from(langMap.values()).sort();

		return {
			armor: armorSuggestions,
			weapons: weaponSuggestions,
			tools: toolSuggestions,
			languages: languageSuggestions,
		};
	}

	/**
	 * Show modal for editing base ability scores
	 */
	async _showEditAbilityScoresModal () {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Edit Ability Scores",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => {
				this._renderAbilities();
				this._renderAbilityScores();
				this._renderAbilitiesDetailed();
				this._renderSavingThrows();
				this._renderSkills();
				this._saveCurrentCharacter();
			},
		});

		const itemOverrides = this._state.getItemAbilityOverrides?.() || {};

		Parser.ABIL_ABVS.forEach(abl => {
			const base = this._state.getAbilityBase(abl);
			const bonus = this._state.getAbilityBonus(abl);
			const itemBonus = itemOverrides.bonus?.[abl] || 0;
			const itemStatic = itemOverrides.static?.[abl];
			const total = this._state.getAbilityScore(abl);
			const mod = this._state.getAbilityMod(abl);
			const modStr = mod >= 0 ? `+${mod}` : `${mod}`;

			const row = e_({outer: `
				<div class="charsheet__edit-ability-row mb-3" style="display: flex; align-items: center; gap: 12px; padding: 8px; border: 1px solid var(--rgb-border-grey, #ddd); border-radius: 6px;">
					<div style="min-width: 120px;">
						<strong>${Parser.attAbvToFull(abl)}</strong>
						<span class="ve-muted">(${abl.toUpperCase()})</span>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<button class="ve-btn ve-btn-default ve-btn-xs ability-dec" style="width: 28px; height: 28px; font-size: 1rem;">−</button>
						<input type="number" class="ve-form-control ability-input" value="${base}" min="1" max="30" style="width: 60px; text-align: center; font-weight: bold;">
						<button class="ve-btn ve-btn-default ve-btn-xs ability-inc" style="width: 28px; height: 28px; font-size: 1rem;">+</button>
					</div>
					<div class="ve-muted ve-small ability-breakdown" style="min-width: 160px;"></div>
					<div style="min-width: 60px; text-align: center;">
						<span class="ability-total" style="font-size: 1.1rem; font-weight: bold;"></span>
						<span class="ve-muted ability-mod" style="margin-left: 4px;"></span>
					</div>
				</div>
			`});

			const inputEl = row.querySelector(".ability-input");
			const breakdownEl = row.querySelector(".ability-breakdown");
			const totalEl = row.querySelector(".ability-total");
			const modEl = row.querySelector(".ability-mod");
			const decBtn = row.querySelector(".ability-dec");
			const incBtn = row.querySelector(".ability-inc");

			const updateDisplay = () => {
				const curBase = this._state.getAbilityBase(abl);
				const curBonus = this._state.getAbilityBonus(abl);
				const curItemBonus = (this._state.getItemAbilityOverrides?.()?.bonus?.[abl]) || 0;
				const curItemStatic = this._state.getItemAbilityOverrides?.()?.static?.[abl];
				const curTotal = this._state.getAbilityScore(abl);
				const curMod = this._state.getAbilityMod(abl);
				const curModStr = curMod >= 0 ? `+${curMod}` : `${curMod}`;

				inputEl.value = curBase;

				const parts = [`Base ${curBase}`];
				if (curBonus) parts.push(`${curBonus >= 0 ? "+" : ""}${curBonus} bonus`);
				if (curItemBonus) parts.push(`${curItemBonus >= 0 ? "+" : ""}${curItemBonus} item`);
				if (curItemStatic && curItemStatic > (curBase + curBonus + curItemBonus)) {
					parts.push(`→ ${curItemStatic} (item override)`);
				}
				breakdownEl.textContent = parts.join(" | ");

				totalEl.textContent = curTotal;
				modEl.textContent = `(${curModStr})`;
			};

			const setBase = (val) => {
				const clamped = Math.max(1, Math.min(30, val));
				this._state.setAbilityBase(abl, clamped);
				updateDisplay();
			};

			decBtn.addEventListener("click", () => setBase(this._state.getAbilityBase(abl) - 1));
			incBtn.addEventListener("click", () => setBase(this._state.getAbilityBase(abl) + 1));
			inputEl.addEventListener("change", () => setBase(parseInt(inputEl.value) || 10));

			updateDisplay();
			modalInner.append(row);
		});

		const doneFooter = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-primary">Done</button>
		</div>`;
		modalInner.append(doneFooter);
		doneFooter.querySelector("button").addEventListener("click", () => doClose());
	}

	/**
	 * Show modal for editing proficiencies and languages
	 */
	async _showEditProficienciesModal () {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Edit Proficiencies & Languages",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => {
				this._renderProficiencies();
				this._saveCurrentCharacter();
			},
		});

		const suggestions = this._getProficiencySuggestions();

		const profTypes = [
			{key: "armor", label: "Armor Proficiencies", getter: "getArmorProficiencies", adder: "addArmorProficiency", remover: "removeArmorProficiency", suggestions: suggestions.armor},
			{key: "weapons", label: "Weapon Proficiencies", getter: "getWeaponProficiencies", adder: "addWeaponProficiency", remover: "removeWeaponProficiency", suggestions: suggestions.weapons},
			{key: "tools", label: "Tool Proficiencies", getter: "getToolProficiencies", adder: "addToolProficiency", remover: "removeToolProficiency", suggestions: suggestions.tools},
			{key: "languages", label: "Languages", getter: "getLanguages", adder: "addLanguage", remover: "removeLanguage", suggestions: suggestions.languages},
		];

		const renderSection = (profType) => {
			const sectionEl = e_({outer: `
				<div class="charsheet__edit-prof-section mb-3">
					<label class="ve-bold mb-1">${profType.label}</label>
					<div class="charsheet__edit-prof-list mb-2" id="edit-prof-${profType.key}"></div>
					<div class="ve-flex-v-center" style="position: relative;">
						<input type="text" class="ve-form-control form-control--minimal mr-2" id="edit-prof-${profType.key}-input" placeholder="Type to search or enter custom...">
						<button class="ve-btn ve-btn-primary ve-btn-xs" id="edit-prof-${profType.key}-add">Add</button>
					</div>
					<div class="charsheet__autocomplete-dropdown" id="edit-prof-${profType.key}-dropdown" style="display: none;"></div>
				</div>
			`});

			const listEl = sectionEl.querySelector(`#edit-prof-${profType.key}`);
			const inputEl = sectionEl.querySelector(`#edit-prof-${profType.key}-input`);
			const addBtnEl = sectionEl.querySelector(`#edit-prof-${profType.key}-add`);
			const dropdownEl = sectionEl.querySelector(`#edit-prof-${profType.key}-dropdown`);

			const renderList = () => {
				const currentItems = this._state[profType.getter]();
				listEl.innerHTML = "";
				if (!currentItems.length) {
					listEl.insertAdjacentHTML("beforeend", `<span class="ve-muted">None</span>`);
					return;
				}
				currentItems.forEach(item => {
					const displayName = typeof item === "string" ? item : item.full || item.name || item;
					const badgeEl = e_({outer: `
						<span class="charsheet__edit-prof-badge">
							${displayName}
							<span class="charsheet__edit-prof-remove glyphicon glyphicon-remove" title="Remove"></span>
						</span>
					`});
					badgeEl.querySelector(".charsheet__edit-prof-remove").addEventListener("click", () => {
						this._state[profType.remover](item);
						renderList();
					});
					listEl.append(badgeEl);
				});
			};
			renderList();

			const renderDropdown = (filter = "") => {
				const currentItems = this._state[profType.getter]().map(i => (typeof i === "string" ? i : i.name || i).toLowerCase());
				const filtered = profType.suggestions.filter(s => {
					if (currentItems.includes(s.toLowerCase())) return false;
					if (filter && !s.toLowerCase().includes(filter.toLowerCase())) return false;
					return true;
				}).slice(0, 10); // Limit to 10 suggestions

				dropdownEl.innerHTML = "";
				if (!filtered.length) {
					dropdownEl.style.display = "none";
					return;
				}

				filtered.forEach(suggestion => {
					const itemEl = e_({outer: `<div class="charsheet__autocomplete-item">${suggestion}</div>`});
					itemEl.addEventListener("click", () => {
						this._state[profType.adder](suggestion);
						inputEl.value = "";
						dropdownEl.style.display = "none";
						renderList();
					});
					dropdownEl.append(itemEl);
				});
				dropdownEl.style.display = "";
			};

			const addItem = () => {
				const value = inputEl.value.trim();
				if (!value) return;
				this._state[profType.adder](value);
				inputEl.value = "";
				dropdownEl.style.display = "none";
				renderList();
			};

			inputEl.addEventListener("input", () => renderDropdown(inputEl.value));
			inputEl.addEventListener("focus", () => renderDropdown(inputEl.value));
			inputEl.addEventListener("blur", () => setTimeout(() => dropdownEl.style.display = "none", 200)); // Delay to allow click
			inputEl.addEventListener("keypress", (e) => {
				if (e.which === 13) addItem();
			});
			addBtnEl.addEventListener("click", addItem);

			return sectionEl;
		};

		profTypes.forEach(pt => {
			modalInner.append(renderSection(pt));
		});

		const doneFooter = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-primary">Done</button>
		</div>`;
		modalInner.append(doneFooter);
		doneFooter.querySelector("button").addEventListener("click", () => doClose());
	}

	/**
	 * Show modal for editing weapon masteries
	 * Allows changing which weapons the character has mastery with
	 */
	async _showEditWeaponMasteriesModal () {
		const currentMasteries = this._state.getWeaponMasteries();

		// Determine max masteries from class features
		const maxMasteries = this._getMaxWeaponMasteries();

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Edit Weapon Masteries",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => {
				this._renderWeaponMasteries();
				this._saveCurrentCharacter();
			},
		});

		modalInner.insertAdjacentHTML("beforeend", `
			<p class="ve-muted mb-2">Choose up to ${maxMasteries} weapons to master. You can change these after a Long Rest.</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="mastery-count">${currentMasteries.length}</span>/${maxMasteries}</div>
		`);

		// Get only BASE weapons with mastery properties (not magic variants)
		const weaponsWithMastery = (this._itemsData || []).filter(item => {
			// Must be a base item, not a magic variant
			if (!item._isBaseItem) return false;
			// Must be a weapon
			if (!item.weaponCategory && !["M", "R", "S"].includes(item.type)) return false;
			// Must have mastery property
			return item.mastery?.length > 0;
		});

		// Group by type
		const simpleWeapons = weaponsWithMastery.filter(w =>
			w.weaponCategory === "simple" || w.type === "S",
		).sort((a, b) => a.name.localeCompare(b.name));

		const martialWeapons = weaponsWithMastery.filter(w =>
			w.weaponCategory === "martial" || w.type === "M",
		).sort((a, b) => a.name.localeCompare(b.name));

		const selectedMasteries = [...currentMasteries];

		const renderWeaponGroup = (weapons, groupName) => {
			if (!weapons.length) return;

			const groupEl = e_({outer: `<div class="mb-3"><strong>${groupName}:</strong></div>`});
			const checkboxesEl = e_({outer: `<div class="charsheet__mastery-checkboxes" style="display: flex; flex-wrap: wrap; gap: 8px;"></div>`});

			weapons.forEach(weapon => {
				const masteryName = this._getMasteryName(weapon.mastery?.[0]);
				const weaponKey = `${weapon.name}|${weapon.source}`;
				const isSelected = selectedMasteries.includes(weaponKey);

				const labelEl = e_({outer: `
					<label class="charsheet__mastery-checkbox" style="display: flex; align-items: center; cursor: pointer; padding: 4px 8px; border: 1px solid var(--rgb-border-grey); border-radius: 4px; ${isSelected ? "background: var(--rgb-bg-highlight);" : ""}">
						<input type="checkbox" value="${weaponKey}" ${isSelected ? "checked" : ""} style="margin-right: 6px;">
						<span>${weapon.name}</span>
						${masteryName ? `<span class="ve-small text-muted ml-1">(${masteryName})</span>` : ""}
					</label>
				`});

				labelEl.querySelector("input").addEventListener("change", (e) => {
					if ((/** @type {*} */ (e.target)).checked) {
						if (selectedMasteries.length < maxMasteries) {
							selectedMasteries.push(weaponKey);
							labelEl.style.background = "var(--rgb-bg-highlight)";
						} else {
							(/** @type {*} */ (e.target)).checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${maxMasteries} weapon masteries.`});
						}
					} else {
						const idx = selectedMasteries.indexOf(weaponKey);
						if (idx > -1) selectedMasteries.splice(idx, 1);
						labelEl.style.background = "";
					}
					(/** @type {*} */ (document.getElementById("mastery-count"))).textContent = selectedMasteries.length;
				});

				checkboxesEl.append(labelEl);
			});

			groupEl.append(checkboxesEl);
			modalInner.append(groupEl);
		};

		renderWeaponGroup(simpleWeapons, "Simple Weapons");
		renderWeaponGroup(martialWeapons, "Martial Weapons");

		// Save button
		const saveFooter = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-primary">Save</button>
		</div>`;
		modalInner.append(saveFooter);
		saveFooter.querySelector("button").addEventListener("click", () => {
			const targetLevel = this._getHistoryLevelForMartialChoice("weaponMasteries");
			if (targetLevel != null && this._state.updateLevelChoice(targetLevel, {weaponMasteries: [...selectedMasteries]})) {
				this.replayHistoryMartialChoices();
			} else {
				this._state.setWeaponMasteries(selectedMasteries);
			}
			doClose();
		});
	}

	/**
	 * Get the maximum number of weapon masteries for this character
	 * Based on class and level
	 * Returns 0 if the character doesn't have the Weapon Mastery feature
	 */
	_getMaxWeaponMasteries () {
		const classes = this._state.getClasses();
		if (!classes?.length) return 0; // No class = no weapon mastery

		// Check each class for weapon mastery progression
		let maxMasteries = 0;

		for (const cls of classes) {
			const classData = this._classes?.find(c => c.name === cls.name && c.source === cls.source);
			if (!classData) continue;

			// Check classTableGroups for Weapon Mastery column
			if (classData.classTableGroups) {
				for (const tableGroup of classData.classTableGroups) {
					const masteryColIndex = tableGroup.colLabels?.findIndex(
						col => col === "Weapon Mastery" || (typeof col === "string" && col.toLowerCase().includes("mastery")),
					);

					if (masteryColIndex === -1) continue;

					// Get value at current level (rows are 0-indexed)
					const level = cls.level || 1;
					const row = tableGroup.rows?.[level - 1];
					if (!row) continue;

					const value = row[masteryColIndex];
					const count = typeof value === "number" ? value : parseInt(value) || 0;
					if (count > maxMasteries) maxMasteries = count;
				}
			}

			// If no table found, check for Weapon Mastery feature (defaults to 2)
			if (maxMasteries === 0) {
				const hasWeaponMastery = this._classFeatures?.some(f =>
					f.name === "Weapon Mastery"
					&& f.className === cls.name
					&& f.level <= (cls.level || 1),
				);
				if (hasWeaponMastery) maxMasteries = 2;
			}
		}

		return maxMasteries; // 0 if no Weapon Mastery feature found
	}
	// #endregion
}

// Initialize on page load
window.addEventListener("load", async () => {
	try {
		await Promise.all([
			PrereleaseUtil.pInit(),
			BrewUtil2.pInit(),
		]);
		ExcludeUtil.pInitialise().then(null); // don't await, as this is only used for search

		const charSheet = new CharacterSheetPage();
		await charSheet.pInit();

		(/** @type {*} */ (window)).charSheet = charSheet; // For debugging

		window.dispatchEvent(new Event("toolsLoaded"));
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error("Failed to initialize character sheet:", e);
		document.querySelector("#charsheet-loading-overlay")?.remove();
		JqueryUtil.doToast({type: "danger", content: `Failed to initialize: ${e.message}`});
	}
});

// Export for other modules
export {CharacterSheetPage};

// Also expose on globalThis for non-module scripts
globalThis.CharacterSheetPage = CharacterSheetPage;
