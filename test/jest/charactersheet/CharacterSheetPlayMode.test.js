/**
 * Character Sheet Play Mode - Unit Tests
 * Tests for play mode state fields (viewMode, favorites) and state management helpers.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeElement (className = "") {
	return {
		className,
		children: [],
		_handlers: {},
		classList: {add: jest.fn()},
		appendChild (child) {
			this.children.push(child);
			child.parentNode = this;
			return child;
		},
		replaceChildren (...children) {
			this.children = children;
		},
		addEventListener (type, handler) {
			this._handlers[type] = handler;
		},
		remove: jest.fn(),
	};
}

function makePlayModeDomHarness () {
	const elements = [];
	const playMode = Object.create(CharacterSheetPlayMode.prototype);
	playMode._ce = (tag, className, parent) => {
		const element = makeElement(className);
		element.tagName = tag.toUpperCase();
		if (parent) parent.appendChild(element);
		elements.push(element);
		return element;
	};
	playMode._setIcon = jest.fn();
	playMode._setIconLabel = jest.fn();
	playMode._makeChip = jest.fn();
	playMode._makeClickable = jest.fn();
	playMode._isFavorite = jest.fn(() => false);
	playMode._state = {getSpellNote: jest.fn(() => null)};
	return {elements, playMode};
}

describe("CharacterSheetPlayMode", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("reapplies the current character access mode after every late render", () => {
		const playMode = Object.create(CharacterSheetPlayMode.prototype);
		playMode._page = {_applyCharacterAccessMode: jest.fn()};
		playMode._elRoot = {};
		playMode._renderStatusBar = jest.fn();
		playMode._renderCharacterPanel = jest.fn();
		playMode._renderActionsHub = jest.fn();

		playMode.render();

		expect(playMode._page._applyCharacterAccessMode).toHaveBeenCalledTimes(1);
	});

	it("persists play-mode cantrips with the same closed spell activity descriptor", () => {
		const saveCharacter = jest.fn();
		const playMode = Object.create(CharacterSheetPlayMode.prototype);
		playMode._page = {saveCharacter};
		playMode._state = {
			isConcentrating: () => false,
		};
		playMode._logActivity = jest.fn();
		playMode._renderStatusBar = jest.fn();

		playMode._castSpell({id: "fire-bolt", name: "Fire Bolt", source: "XPHB", level: 0, concentration: false});

		expect(saveCharacter).toHaveBeenCalledWith({
			activity: {
				type: "spell.used",
				spellName: "Fire Bolt",
				spellSource: "XPHB",
				spellLevel: 0,
				slotLevel: 0,
				mode: "cantrip",
			},
		});
	});

	it("routes the quick-row ritual control through the committed ritual helper", () => {
		const {elements, playMode} = makePlayModeDomHarness();
		const spell = {id: "detect-magic", name: "Detect Magic", level: 1, ritual: true};
		playMode._castSpellAsRitual = jest.fn();

		playMode._renderSpellRow(makeElement(), spell);
		const ritualButton = elements.find(element => element.className.includes("pm-spell__cast--ritual"));

		expect(ritualButton).toBeDefined();
		ritualButton._handlers.click({stopPropagation: jest.fn()});
		expect(playMode._castSpellAsRitual).toHaveBeenCalledTimes(1);
		expect(playMode._castSpellAsRitual).toHaveBeenCalledWith(spell);
	});

	it("routes the spell context-menu ritual control through the committed ritual helper", () => {
		const {elements, playMode} = makePlayModeDomHarness();
		const spell = {id: "detect-magic", name: "Detect Magic", level: 1, ritual: true};
		playMode._castSpellAsRitual = jest.fn();
		playMode._showContextMenu = jest.fn();

		playMode._renderSpellRow(makeElement(), spell);
		const row = elements.find(element => element.className === "pm-spell");
		row._handlers.contextmenu({preventDefault: jest.fn()});
		const ritualItem = playMode._showContextMenu.mock.calls[0][1].find(item => item.label === "Cast as Ritual");

		expect(ritualItem).toBeDefined();
		ritualItem.onClick();
		expect(playMode._castSpellAsRitual).toHaveBeenCalledTimes(1);
		expect(playMode._castSpellAsRitual).toHaveBeenCalledWith(spell);
	});

	it("routes the spell-details ritual control through the committed ritual helper", () => {
		const originalDocument = globalThis.document;
		const {elements, playMode} = makePlayModeDomHarness();
		const spell = {id: "detect-magic", name: "Detect Magic", level: 1, ritual: true};
		const body = makeElement();
		globalThis.document = {
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
			body,
		};
		playMode._castSpellAsRitual = jest.fn();

		try {
			playMode._showSpellInfoModal(spell);
			const ritualButton = elements.find(element => element.className.includes("pm-modal__btn--ritual"));
			const overlay = elements.find(element => element.className === "pm-modal-overlay");

			expect(ritualButton).toBeDefined();
			ritualButton._handlers.click();
			expect(overlay.remove).toHaveBeenCalledTimes(1);
			expect(playMode._castSpellAsRitual).toHaveBeenCalledTimes(1);
			expect(playMode._castSpellAsRitual).toHaveBeenCalledWith(spell);
		} finally {
			globalThis.document = originalDocument;
		}
	});

	it("commits and persists a concentrating ritual exactly once after confirmation", () => {
		const originalDocument = globalThis.document;
		const {elements, playMode} = makePlayModeDomHarness();
		const spell = {name: "Detect Magic", level: 1, concentration: true, ritual: true};
		globalThis.document = {body: makeElement()};
		playMode._state = {
			isConcentrating: jest.fn(() => true),
			getActiveStates: jest.fn(() => [{stateTypeId: "concentration", active: true, name: "Bless"}]),
			breakConcentration: jest.fn(),
			setConcentration: jest.fn(),
		};
		playMode._logActivity = jest.fn();
		playMode._renderStatusBar = jest.fn();
		playMode._persistSpellUse = jest.fn(() => Promise.resolve());

		try {
			playMode._castSpellAsRitual(spell);

			expect(playMode._state.breakConcentration).not.toHaveBeenCalled();
			expect(playMode._state.setConcentration).not.toHaveBeenCalled();
			expect(playMode._logActivity).not.toHaveBeenCalled();
			expect(playMode._renderStatusBar).not.toHaveBeenCalled();
			expect(playMode._persistSpellUse).not.toHaveBeenCalled();

			const confirmButton = elements.find(element => element.className.includes("pm-modal__btn--confirm"));
			confirmButton._handlers.click();

			expect(playMode._state.breakConcentration).toHaveBeenCalledTimes(1);
			expect(playMode._state.setConcentration).toHaveBeenCalledTimes(1);
			expect(playMode._state.setConcentration).toHaveBeenCalledWith({name: "Detect Magic", level: 1});
			expect(playMode._logActivity.mock.calls).toEqual([
				["concentration", "Broke concentration on Bless"],
				["ritual", "Cast Detect Magic as ritual (no slot)"],
			]);
			expect(playMode._renderStatusBar).toHaveBeenCalledTimes(1);
			expect(playMode._persistSpellUse).toHaveBeenCalledTimes(1);
			expect(playMode._persistSpellUse).toHaveBeenCalledWith(spell, {slotLevel: 1, mode: "ritual"});
		} finally {
			globalThis.document = originalDocument;
		}
	});

	it("does not commit or persist a concentrating ritual when confirmation is cancelled", () => {
		const originalDocument = globalThis.document;
		const {elements, playMode} = makePlayModeDomHarness();
		const spell = {name: "Detect Magic", level: 1, concentration: true, ritual: true};
		globalThis.document = {body: makeElement()};
		playMode._state = {
			isConcentrating: jest.fn(() => true),
			getActiveStates: jest.fn(() => [{stateTypeId: "concentration", active: true, name: "Bless"}]),
			breakConcentration: jest.fn(),
			setConcentration: jest.fn(),
		};
		playMode._logActivity = jest.fn();
		playMode._renderStatusBar = jest.fn();
		playMode._persistSpellUse = jest.fn(() => Promise.resolve());

		try {
			playMode._castSpellAsRitual(spell);
			const cancelButton = elements.find(element => element.className.includes("pm-modal__btn--cancel"));
			cancelButton._handlers.click();

			expect(playMode._state.breakConcentration).not.toHaveBeenCalled();
			expect(playMode._state.setConcentration).not.toHaveBeenCalled();
			expect(playMode._logActivity).not.toHaveBeenCalled();
			expect(playMode._renderStatusBar).not.toHaveBeenCalled();
			expect(playMode._persistSpellUse).not.toHaveBeenCalled();
		} finally {
			globalThis.document = originalDocument;
		}
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
