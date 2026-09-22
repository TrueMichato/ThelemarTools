/**
 * Character Sheet Play Mode - Unit Tests
 * Tests for play mode state fields (viewMode, favorites) and state management helpers.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheetPlayMode", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("Active-state lifecycle", () => {
		it("ends known states canonically, drains their queued end save, and persists", async () => {
			state.activateState("dancing");
			let pendingAtDrain = [];
			const page = {
				getState: () => state,
				_pDrainPendingStateEndSaves: jest.fn(async () => {
					pendingAtDrain = state.getPendingStateEndSaves();
					for (const pending of pendingAtDrain) state.resolvePendingStateEndSave(pending.id, 10);
				}),
				_saveCurrentCharacter: jest.fn(async () => {}),
				_renderActiveStates: jest.fn(),
			};
			const pm = new CharacterSheetPlayMode(page);

			await expect(pm._pToggleActiveState(state.getActiveStates().find(it => it.stateTypeId === "dancing")))
				.resolves.toBe(true);

			expect(state.isStateTypeActive("dancing")).toBe(false);
			expect(pendingAtDrain).toHaveLength(1);
			expect(state.getPendingStateEndSaves()).toHaveLength(0);
			expect(page._pDrainPendingStateEndSaves).toHaveBeenCalledTimes(1);
			expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
			expect(page._renderActiveStates).toHaveBeenCalledTimes(1);
		});

		it("routes feature-backed activation through the page transaction", async () => {
			const activeState = {id: "dance-state", stateTypeId: "dancing", active: false};
			const feature = {id: "dance-feature", name: "Dance of the Country"};
			const stateType = {id: "dancing", resourceCost: 1};
			const activationInfo = {stateType, resourceCost: 1};
			const resource = {id: "dance-resource", cost: 1, current: 2};
			const fakeState = {
				constructor: {ACTIVE_STATE_TYPES: {dancing: stateType}},
				getActivatableFeatures: () => [{feature, stateTypeId: "dancing", activationInfo, resource}],
				toggleActiveState: jest.fn(),
			};
			const page = {
				getState: () => fakeState,
				_activateFeatureState: jest.fn(async () => { activeState.active = true; }),
				_saveCurrentCharacter: jest.fn(async () => {}),
				_renderActiveStates: jest.fn(),
			};
			const pm = new CharacterSheetPlayMode(page);

			await expect(pm._pToggleActiveState(activeState)).resolves.toBe(true);

			expect(page._activateFeatureState).toHaveBeenCalledWith(
				feature,
				"dancing",
				stateType,
				resource,
				1,
				activationInfo,
			);
			expect(fakeState.toggleActiveState).not.toHaveBeenCalled();
			expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
			expect(page._renderActiveStates).toHaveBeenCalledTimes(1);
		});
	});

	describe("HP changes", () => {
		it("delegates damage to the page's canonical damage/intervention pipeline", async () => {
			state.setHp(10, 20);
			const page = {
				getState: () => state,
				_pApplyDamage: jest.fn(async (amount, opts) => state.takeDamage(amount, opts)),
			};
			const pm = new CharacterSheetPlayMode(page);
			pm._logActivity = jest.fn();
			pm._renderStatusBar = jest.fn();

			await pm._applyHpChange("damage", 10, "fire");

			expect(page._pApplyDamage).toHaveBeenCalledTimes(1);
			expect(page._pApplyDamage).toHaveBeenCalledWith(10, {damageType: "fire"});
			expect(state.getCurrentHp()).toBe(0);
			expect(pm._renderStatusBar).toHaveBeenCalledTimes(1);
		});
	});

	describe("Damage concentration protection", () => {
		it("preserves spell source when casting a concentration spell", () => {
			const fakeState = {
				setSpellSlotCurrent: jest.fn(),
				setConcentration: jest.fn(),
			};
			const pm = new CharacterSheetPlayMode({getState: () => fakeState});
			pm._logActivity = jest.fn();
			pm._renderSpellsQuick = jest.fn();
			pm._renderStatusBar = jest.fn();

			pm._doExecuteCast(
				{name: "Faerie Fire", source: "XPHB", level: 1, concentration: true},
				{level: 1, current: 1, max: 2},
			);

			expect(fakeState.setConcentration).toHaveBeenCalledWith({
				name: "Faerie Fire",
				source: "XPHB",
				level: 1,
			});
		});

		it("uses the state provider instead of rolling a damage concentration check in the fallback pipeline", async () => {
			const fakeState = {
				applyDamageDefenses: () => ({damage: 8, applied: null, reduction: 0}),
				getTempHp: () => 0,
				getCurrentHp: () => 20,
				takeDamage: jest.fn(),
				isConcentrating: () => true,
				getDamageConcentrationProtection: () => ({name: "Guided Precision"}),
				getConcentrationLabel: () => "Faerie Fire",
			};
			const pm = new CharacterSheetPlayMode({getState: () => fakeState});
			pm._logActivity = jest.fn();
			pm._renderStatusBar = jest.fn();
			pm._doConcentrationCheck = jest.fn();

			await pm._applyHpChange("damage", 8, "fire");

			expect(fakeState.takeDamage).toHaveBeenCalledWith(8, {damageType: "fire"});
			expect(pm._doConcentrationCheck).not.toHaveBeenCalled();
			expect(pm._logActivity).toHaveBeenCalledWith(
				"shield",
				"Guided Precision: damage can't end concentration on Faerie Fire",
			);
		});
	});

	describe("Item attunement", () => {
		const addItem = (item) => {
			state.addItem(item);
			return state.getItems().at(-1);
		};

		const makePlayMode = (onOpenIoun = () => {}) => new CharacterSheetPlayMode({
			getState: () => state,
			_ioun: {openModal: onOpenIoun},
		});

		it("redirects effective Ioun bonds to the manager", () => {
			let opens = 0;
			const pm = makePlayMode(() => { opens++; });
			const official = addItem({
				name: "Ioun Stone, Protection",
				source: "DMG",
				requiresAttunement: true,
				entries: ["This stone orbits your head."],
			});

			expect(pm._toggleItemAttunement(official)).toBe(false);
			expect(state.getItems().at(-1).attuned).toBe(false);
			expect(opens).toBe(1);
		});

		it("enforces the RAW attunement cap for official stones while TGTT is disabled", () => {
			state.setSetting("enableTgtt", false);
			for (let i = 0; i < 3; ++i) {
				const ring = addItem({name: `Ring ${i}`, source: "DMG", requiresAttunement: true});
				state.setItemAttuned(ring.id, true);
			}
			const official = addItem({
				name: "Ioun Stone, Protection",
				source: "DMG",
				requiresAttunement: true,
				entries: ["This stone orbits your head."],
			});

			expect(makePlayMode()._toggleItemAttunement(official)).toBe(false);
			expect(state.getItems().at(-1).attuned).toBe(false);
		});
	});

	// ==========================================================================
	// View Mode
	// ==========================================================================
	describe("View Mode", () => {
		it("should default to 'full' view mode", () => {
			expect(state.getViewMode()).toBe("full");
		});

		it("should set and get view mode", () => {
			state.setViewMode("play");
			expect(state.getViewMode()).toBe("play");
		});

		it("should reset to full when set to null/undefined", () => {
			state.setViewMode("play");
			state.setViewMode(null);
			expect(state.getViewMode()).toBe("full");
		});

		it("should persist view mode through serialization", () => {
			state.setViewMode("play");
			const json = state.toJson();
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);
			expect(restored.getViewMode()).toBe("play");
		});

		it("should default to full when loading old save without viewMode", () => {
			const json = state.toJson();
			delete json.viewMode;
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);
			expect(restored.getViewMode()).toBe("full");
		});
	});

	describe("linked tool skills", () => {
		it("keeps linked tool skills in the collapsed proficient list", () => {
			state.addToolProficiency("Thieves' Tools");
			state.addCustomSkill("Thieves' Tools + Sleight of Hand", "dex", {
				toolCheck: {tool: "Thieves' Tools", skill: "sleightofhand"},
			});
			const linkedSkill = {
				name: "Thieves' Tools + Sleight of Hand",
				ability: "dex",
				isCustom: true,
				toolCheck: {tool: "Thieves' Tools", skill: "sleightofhand"},
			};
			const page = {
				getState: () => state,
				getSkillsList: () => [linkedSkill],
			};
			const pm = new CharacterSheetPlayMode(page);
			pm._elCharPanel = {};
			pm._makeCard = jest.fn(() => ({children: []}));
			pm._ce = jest.fn((tag, className, parent) => {
				const element = {tag, className, children: [], addEventListener: jest.fn()};
				parent?.children?.push(element);
				return element;
			});
			pm._setIconLabel = jest.fn();
			pm._renderSkillRow = jest.fn();

			pm._renderSkills();

			expect(pm._renderSkillRow).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					name: linkedSkill.name,
					profLevel: 1,
				}),
			);
		});

		it("renders derived tool proficiency as fixed in Play Mode", () => {
			state.addToolProficiency("Thieves' Tools");
			state.setSkillProficiency("sleightofhand", 1);
			state.addCustomSkill("Thieves' Tools + Sleight of Hand", "dex", {
				toolCheck: {tool: "Thieves' Tools", skill: "sleightofhand"},
			});
			const page = {
				getState: () => state,
				_rollSkillCheck: jest.fn(),
			};
			const pm = new CharacterSheetPlayMode(page);
			const created = [];
			pm._ce = jest.fn((tag, className, parent) => {
				const element = {
					tag,
					className,
					children: [],
					classList: {add: jest.fn()},
					addEventListener: jest.fn(),
					setAttribute: jest.fn(),
				};
				parent?.children?.push(element);
				created.push(element);
				return element;
			});
			pm._pip = jest.fn(() => ({classList: {add: jest.fn()}}));
			pm._makeClickable = jest.fn();

			pm._renderSkillRow({children: []}, {
				name: "Thieves' Tools + Sleight of Hand",
				key: "thieves'tools+sleightofhand",
				ability: "dex",
				profLevel: state.getEffectiveSkillProficiency("thieves'tools+sleightofhand"),
			});

			const toggle = created.find(element => element.className === "pm-skill__prof-toggle");
			expect(toggle.disabled).toBe(true);
			expect(toggle.title).toMatch(/Derived from Thieves' Tools proficiency/);
			expect(toggle.addEventListener).not.toHaveBeenCalled();
		});
	});

	describe("Action economy rendering", () => {
		it("refreshes the existing Your Turn card instead of appending a duplicate", () => {
			const actionsHub = {
				children: [],
				querySelector (selector) {
					return selector === "[data-pm-section='action-economy']"
						? this.children.find(it => it.dataset?.pmSection === "action-economy") || null
						: null;
				},
				insertBefore (node, before) {
					const index = this.children.indexOf(before);
					this.children.splice(index < 0 ? this.children.length : index, 0, node);
					node.parentNode = this;
				},
			};
			const economy = {action: false, bonus: false, reaction: false};
			let movementUsed = 0;
			const pm = new CharacterSheetPlayMode({
				getState: () => ({
					getActionEconomyState: () => ({...economy}),
					isActionTypeAvailable: type => economy[type],
					restoreActionType: type => { economy[type] = true; return true; },
					getMovementEconomyState: () => ({
						speed: 30,
						allowance: 30,
						used: movementUsed,
						remaining: 30 - movementUsed,
						receipts: [],
					}),
					spendMovement: amount => { movementUsed += amount; return {ok: true}; },
					resetMovementEconomy: () => { movementUsed = 0; },
					resetTurnEconomy: () => {
						economy.action = true;
						economy.bonus = true;
						economy.reaction = true;
						movementUsed = 0;
					},
				}),
			});

			const clickable = [];
			pm._elActionsHub = actionsHub;
			pm._makeCard = (parent) => {
				const header = {
					classList: {contains: cls => cls === "pm-card__header"},
					parentNode: null,
				};
				const card = {
					dataset: {},
					parentNode: parent,
					children: [header],
					querySelector (selector) { return selector === ".pm-card__header" ? header : null; },
					replaceChildren (...children) { this.children = children; },
				};
				header.parentNode = card;
				parent.children.push(card);
				return card;
			};
			pm._ce = (tag, className, parent) => {
				const el = {
					tag,
					className,
					parentNode: parent,
					children: [],
					remove () { parent.children.splice(parent.children.indexOf(this), 1); },
					replaceChildren (...children) { this.children = children; },
				};
				parent.children.push(el);
				return el;
			};
			pm._makeClickable = (el, label, handler) => {
				el._label = label;
				el._handler = handler;
				clickable.push(el);
			};
			pm._icon = () => ({});
			pm._setIconLabel = () => {};

			const previousDocument = globalThis.document;
			globalThis.document = {createTextNode: text => text};
			try {
				pm._renderActionEconomy();
				expect(actionsHub.children.filter(it => it.dataset?.pmSection === "action-economy")).toHaveLength(1);
				expect(clickable[1]._label).toBe("Restore Bonus");
				clickable[1]._handler();

				expect(actionsHub.children.filter(it => it.dataset?.pmSection === "action-economy")).toHaveLength(1);
				expect(clickable.slice(-5).map(it => it._label)).toEqual([
					"Restore Action",
					"Use Bonus",
					"Restore Reaction",
					"Use Movement",
					"Reset turn (restore all actions)",
				]);
				const movement = clickable.slice(-5)[3];
				expect(movement.children[1]).toBe(" 30/30 ft.");
				movement._handler();

				const usedMovement = clickable.slice(-5)[3];
				expect(usedMovement._label).toBe("Restore Movement");
				expect(usedMovement.children[1]).toBe(" 0/30 ft.");
				usedMovement._handler();

				const restoredMovement = clickable.slice(-5)[3];
				expect(restoredMovement._label).toBe("Use Movement");
				expect(restoredMovement.children[1]).toBe(" 30/30 ft.");
			} finally {
				if (previousDocument === undefined) delete globalThis.document;
				else globalThis.document = previousDocument;
			}
		});
	});

	describe("Combat Methods", () => {
		test("delegates use to the shared Combat transaction and does not mutate on a blocked result", async () => {
			const method = {
				name: "Spell Shattering Strike",
				source: "TGTT",
				staminaCost: 2,
				staminaCostDisplay: "2",
				randomOutcomes: {
					die: "1d4",
					options: [1, 2, 3, 4].map(roll => ({label: `Roll ${roll}`, effectText: `Effect ${roll}`})),
				},
			};
			const setStaminaCurrent = jest.fn();
			const useMethod = jest.fn(async () => ({ok: false, reason: "insufficient-stamina", cost: 2}));
			const page = {
				getState: () => ({
					getSettings: () => ({enableTgtt: true}),
					getCombatMethods: () => [method],
					getStaminaCurrent: () => 2,
					getStaminaMax: () => 4,
					setStaminaCurrent,
				}),
				_combat: {_pUseCombatMethod: useMethod},
			};
			const pm = new CharacterSheetPlayMode(page);
			pm._elActionsHub = {children: []};
			pm._makeCard = jest.fn(() => ({children: []}));
			pm._makeClickable = jest.fn();
			pm._logActivity = jest.fn();
			pm._ce = jest.fn((tag, className, parent) => {
				const handlers = {};
				const element = {
					tag,
					className,
					children: [],
					style: {},
					classList: {add: jest.fn()},
					addEventListener: jest.fn((event, handler) => { handlers[event] = handler; }),
					_handlers: handlers,
				};
				parent?.children?.push(element);
				return element;
			});

			pm._renderCombatMethods();
			const useButton = pm._ce.mock.results
				.map(it => it.value)
				.find(it => it.className === "pm-feature__use-btn");
			const outcomeDetails = pm._ce.mock.results
				.map(it => it.value)
				.filter(it => it.className === "pm-feature__detail");
			const costBadge = pm._ce.mock.results
				.map(it => it.value)
				.find(it => it.className === "pm-card__badge");

			expect(costBadge.textContent).toBe("2 SP");
			expect(outcomeDetails.map(it => it.textContent)).toEqual([
				"Roll 1: Effect 1",
				"Roll 2: Effect 2",
				"Roll 3: Effect 3",
				"Roll 4: Effect 4",
			]);
			await useButton._handlers.click({stopPropagation: jest.fn()});

			expect(useMethod).toHaveBeenCalledWith(method, {surface: "playMode"});
			expect(setStaminaCurrent).not.toHaveBeenCalled();
			expect(pm._logActivity).not.toHaveBeenCalled();
		});

		test("logs and rerenders the shared successful outcome reminder", async () => {
			const method = {name: "Spell Shattering Strike", source: "TGTT", staminaCost: 2, staminaCostDisplay: "2"};
			const message = "Spell Shattering Strike: if the attack hits and the target fails the DC 14 Wisdom save, roll 4 — stunned.";
			const page = {
				getState: () => ({
					getSettings: () => ({enableTgtt: true}),
					getCombatMethods: () => [method],
					getStaminaCurrent: () => 2,
					getStaminaMax: () => 4,
				}),
				_combat: {_pUseCombatMethod: jest.fn(async () => ({ok: true, message, cost: 2, outcome: {roll: 4}}))},
			};
			const pm = new CharacterSheetPlayMode(page);
			pm._elActionsHub = {children: []};
			pm._makeCard = jest.fn(() => ({children: []}));
			pm._makeClickable = jest.fn();
			pm._logActivity = jest.fn();
			pm._ce = jest.fn((tag, className, parent) => {
				const handlers = {};
				const element = {
					tag,
					className,
					children: [],
					style: {},
					classList: {add: jest.fn()},
					addEventListener: jest.fn((event, handler) => { handlers[event] = handler; }),
					_handlers: handlers,
				};
				parent?.children?.push(element);
				return element;
			});

			pm._renderCombatMethods();
			const useButton = pm._ce.mock.results
				.map(it => it.value)
				.find(it => it.className === "pm-feature__use-btn");
			pm._renderCombatMethods = jest.fn();
			await useButton._handlers.click({stopPropagation: jest.fn()});

			expect(pm._logActivity).toHaveBeenCalledWith("attack", message);
			expect(pm._renderCombatMethods).toHaveBeenCalledTimes(1);
		});
	});

	// ==========================================================================
	// Favorites
	// ==========================================================================
	describe("Favorites", () => {
		const makeFav = (type, name) => ({
			id: `${type}:${name}`,
			type,
			name,
			icon: "⚡",
		});

		it("should default to empty favorites", () => {
			expect(state.getFavorites()).toEqual([]);
		});

		it("should return a copy from getFavorites, not a reference", () => {
			state.addFavorite(makeFav("attack", "longbow"));
			const favs1 = state.getFavorites();
			const favs2 = state.getFavorites();
			expect(favs1).toEqual(favs2);
			expect(favs1).not.toBe(favs2);
		});

		describe("addFavorite", () => {
			it("should add a favorite", () => {
				const result = state.addFavorite(makeFav("attack", "longbow"));
				expect(result).toBe(true);
				expect(state.getFavorites()).toHaveLength(1);
				expect(state.getFavorites()[0].name).toBe("longbow");
			});

			it("should not add duplicate favorites", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				const result = state.addFavorite(makeFav("attack", "longbow"));
				expect(result).toBe(false);
				expect(state.getFavorites()).toHaveLength(1);
			});

			it("should respect max favorites limit", () => {
				for (let i = 0; i < 8; i++) {
					state.addFavorite(makeFav("attack", `weapon${i}`));
				}
				const result = state.addFavorite(makeFav("attack", "weapon8"));
				expect(result).toBe(false);
				expect(state.getFavorites()).toHaveLength(8);
			});

			it("should allow custom max limit", () => {
				for (let i = 0; i < 4; i++) {
					state.addFavorite(makeFav("attack", `weapon${i}`), {max: 4});
				}
				const result = state.addFavorite(makeFav("attack", "weapon4"), {max: 4});
				expect(result).toBe(false);
				expect(state.getFavorites()).toHaveLength(4);
			});
		});

		describe("removeFavorite", () => {
			it("should remove an existing favorite", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				const result = state.removeFavorite("attack:longbow");
				expect(result).toBe(true);
				expect(state.getFavorites()).toHaveLength(0);
			});

			it("should return false when removing non-existent favorite", () => {
				const result = state.removeFavorite("attack:nonexistent");
				expect(result).toBe(false);
			});
		});

		describe("isFavorite", () => {
			it("should return true for existing favorites", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				expect(state.isFavorite("attack", "longbow")).toBe(true);
			});

			it("should return false for non-favorites", () => {
				expect(state.isFavorite("attack", "longbow")).toBe(false);
			});

			it("should distinguish by type", () => {
				state.addFavorite(makeFav("attack", "fireball"));
				expect(state.isFavorite("attack", "fireball")).toBe(true);
				expect(state.isFavorite("spell", "fireball")).toBe(false);
			});
		});

		describe("toggleFavorite", () => {
			it("should add when not present", () => {
				const result = state.toggleFavorite(makeFav("attack", "longbow"));
				expect(result).toBe("added");
				expect(state.getFavorites()).toHaveLength(1);
			});

			it("should remove when already present", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				const result = state.toggleFavorite(makeFav("attack", "longbow"));
				expect(result).toBe("removed");
				expect(state.getFavorites()).toHaveLength(0);
			});

			it("should return null when at max and trying to add", () => {
				for (let i = 0; i < 8; i++) {
					state.addFavorite(makeFav("attack", `weapon${i}`));
				}
				const result = state.toggleFavorite(makeFav("attack", "weapon8"));
				expect(result).toBeNull();
			});
		});

		describe("setFavorites", () => {
			it("should replace all favorites", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				state.setFavorites([makeFav("spell", "fireball")]);
				expect(state.getFavorites()).toHaveLength(1);
				expect(state.getFavorites()[0].name).toBe("fireball");
			});

			it("should clear favorites when set to empty", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				state.setFavorites([]);
				expect(state.getFavorites()).toHaveLength(0);
			});
		});

		it("should persist favorites through serialization", () => {
			state.addFavorite(makeFav("attack", "longbow"));
			state.addFavorite(makeFav("spell", "fireball"));

			const json = state.toJson();
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);

			expect(restored.getFavorites()).toHaveLength(2);
			expect(restored.isFavorite("attack", "longbow")).toBe(true);
			expect(restored.isFavorite("spell", "fireball")).toBe(true);
		});

		it("should default to empty when loading old save without favorites", () => {
			const json = state.toJson();
			delete json.favorites;
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);
			expect(restored.getFavorites()).toEqual([]);
		});
	});
	describe("Senses card", () => {
		// `getSenses()` returns VARIABLE keys since CS-BUG-136. This renderer used to test
		// the four canonical names by hand and silently dropped everything else. Captures
		// the rendered cells without a real DOM (the suite runs in the node environment),
		// matching the `_renderVitals` approach in CharacterSheetPlayModeSpeedDisplay.
		const renderSensesCapture = (st) => {
			const pm = new CharacterSheetPlayMode({getState: () => st});
			const cells = [];
			pm._makeCard = () => ({});
			pm._ce = (tag, cls) => {
				const el = {style: {}};
				if (cls === "pm-passive") cells.push(el);
				return el;
			};
			pm._renderSenses();
			return cells.map(c => c.textContent).filter(Boolean);
		};

		it("renders a canonical sense", () => {
			state.setSense("darkvision", 60);
			expect(renderSensesCapture(state)).toEqual(["Darkvision 60ft"]);
		});

		it("renders a non-canonical sense granted by a named modifier", () => {
			state.addNamedModifier({name: "Echo", type: "sense:echolocation", value: 30, sourceType: "classFeature"});
			expect(renderSensesCapture(state)).toEqual(["Echolocation 30ft"]);
		});

		it("orders canonical senses before non-canonical ones", () => {
			state.setSense("darkvision", 60);
			state.addNamedModifier({name: "Echo", type: "sense:echolocation", value: 30, sourceType: "classFeature"});
			expect(renderSensesCapture(state)).toEqual(["Darkvision 60ft", "Echolocation 30ft"]);
		});

		it("omits zero-range senses rather than rendering them as 0ft", () => {
			// `getSenses()` reports the canonical four even at zero; the card must not.
			state.setSense("darkvision", 60);
			expect(renderSensesCapture(state)).toEqual(["Darkvision 60ft"]);
		});

		it("renders nothing when the character has no senses", () => {
			expect(renderSensesCapture(state)).toEqual([]);
		});
	});
});
