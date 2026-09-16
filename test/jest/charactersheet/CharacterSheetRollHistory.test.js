import "./setup.js";
import {jest} from "@jest/globals";

let CharacterSheetRollHistory;
let HUB_ROLL_VISIBILITY_CHOICES;

beforeAll(async () => {
	const module = await import("../../../js/charactersheet/charactersheet-rollhistory.js");
	CharacterSheetRollHistory = module.CharacterSheetRollHistory;
	HUB_ROLL_VISIBILITY_CHOICES = module.HUB_ROLL_VISIBILITY_CHOICES;
});

describe("CharacterSheetRollHistory", () => {
	let history;

	function getStubByClass (root, className) {
		if (!root) return null;
		if (`${root._clazz || ""}`.split(/\s+/).includes(className)) return root;
		for (const child of root._children || []) {
			const found = getStubByClass(child, className);
			if (found) return found;
		}
		return null;
	}

	beforeEach(() => {
		// Provide a minimal page mock — the module only uses page for reference
		history = new CharacterSheetRollHistory({});
	});

	afterEach(() => history?._panelEl?.remove());

	// ===================================================================
	// addRoll
	// ===================================================================
	describe("addRoll", () => {
		test("should add a roll to the history", () => {
			history.addRoll({title: "Attack: Longsword", total: 18, breakdown: "1d20 (13) + 5"});
			expect(history.getRollCount()).toBe(1);

			const rolls = history.getRolls();
			expect(rolls[0].title).toBe("Attack: Longsword");
			expect(rolls[0].total).toBe(18);
			expect(rolls[0].breakdown).toBe("1d20 (13) + 5");
			expect(rolls[0].timestamp).toBeDefined();
			expect(rolls[0].rollType).toBe("ATTACK");
		});

		test("should add newest rolls at the front", () => {
			history.addRoll({title: "Roll 1", total: 10});
			history.addRoll({title: "Roll 2", total: 20});

			const rolls = history.getRolls();
			expect(rolls[0].title).toBe("Roll 2");
			expect(rolls[1].title).toBe("Roll 1");
		});

		test("should default optional fields", () => {
			history.addRoll({title: "Test", total: 5});
			const roll = history.getRolls()[0];
			expect(roll.breakdown).toBe("");
			expect(roll.resultClass).toBe("");
			expect(roll.resultNote).toBe("");
		});

		test("persists campaign rolls through the optional hub adapter", async () => {
			const pLog = jest.fn(async () => ({}));
			history = new CharacterSheetRollHistory({_hubRollLogAdapter: {pLog}});
			history.addRoll({title: "Saving Throw: Dexterity", total: 17, breakdown: "1d20 (14) + 3"});
			await Promise.resolve();
			expect(pLog).toHaveBeenCalledWith(expect.objectContaining({
				formula: "1d20 (14) + 3",
				total: 17,
				context: "save",
				visibility: "all_members",
			}));
		});

		test("passes the saved actor-and-DM audience to the Hub adapter", async () => {
			const pLog = jest.fn(async () => ({}));
			history = new CharacterSheetRollHistory({
				_hubRollLogAdapter: {pLog},
				_state: {getSettings: () => ({hubRollVisibility: "actor_and_dm"})},
			});
			history.addRoll({title: "Initiative", total: 14});
			await Promise.resolve();

			expect(pLog).toHaveBeenCalledWith(expect.objectContaining({visibility: "actor_and_dm"}));
		});
	});

	describe("campaign roll audience", () => {
		test("offers only the honest server-supported player choices", () => {
			expect(HUB_ROLL_VISIBILITY_CHOICES).toEqual([
				{value: "all_members", label: "Everyone in the campaign"},
				{value: "actor_and_dm", label: "Only me and DMs"},
			]);
		});

		test("persists the campaign-only selector and applies it to future rolls", () => {
			const settings = {hubRollVisibility: "actor_and_dm"};
			const setSetting = jest.fn((key, value) => {
				settings[key] = value;
				return true;
			});
			const save = jest.fn();
			history = new CharacterSheetRollHistory({
				_hubRollLogAdapter: {pLog: async () => ({})},
				_state: {getSettings: () => settings, setSetting},
				_saveCurrentCharacter: save,
			});
			const control = history._buildHubVisibilityControl();
			const label = getStubByClass(control, "charsheet__roll-history-visibility-label");
			const select = getStubByClass(control, "charsheet__roll-history-visibility-select");

			expect(select.value).toBe("actor_and_dm");
			expect(label.textContent).toBe("Share new campaign rolls with");
			expect(select._children.map(option => option.textContent)).toEqual(["Everyone in the campaign", "Only me and DMs"]);
			select.value = "all_members";
			select._handlers.change();

			expect(setSetting).toHaveBeenCalledWith("hubRollVisibility", "all_members");
			expect(save).toHaveBeenCalledTimes(1);
			expect(settings.hubRollVisibility).toBe("all_members");
		});

		test("syncs the displayed and submitted audience across active character switches", async () => {
			let activeSettings = {hubRollVisibility: "actor_and_dm"};
			const pLog = jest.fn(async () => ({}));
			history = new CharacterSheetRollHistory({
				_hubRollLogAdapter: {pLog},
				_state: {getSettings: () => activeSettings},
			});
			const control = history._buildHubVisibilityControl();
			const select = getStubByClass(control, "charsheet__roll-history-visibility-select");

			expect(select.value).toBe("actor_and_dm");

			activeSettings = {};
			expect(history.syncFromActiveCharacter()).toBe("all_members");
			expect(select.value).toBe("all_members");
			history.addRoll({title: "Initiative", total: 12});
			await Promise.resolve();
			expect(pLog).toHaveBeenLastCalledWith(expect.objectContaining({visibility: "all_members"}));

			activeSettings = {hubRollVisibility: "actor_and_dm"};
			expect(history.syncFromActiveCharacter()).toBe("actor_and_dm");
			expect(select.value).toBe("actor_and_dm");
			history.addRoll({title: "Perception", total: 18});
			await Promise.resolve();
			expect(pLog).toHaveBeenLastCalledWith(expect.objectContaining({visibility: "actor_and_dm"}));
		});

		test("does not render a misleading audience control outside a campaign", () => {
			expect(history._page._hubRollLogAdapter).toBeUndefined();
			expect(history._panelEl).toBeNull();
		});
	});

	// ===================================================================
	// MAX_ROLLS cap
	// ===================================================================
	describe("MAX_ROLLS cap", () => {
		test("should cap at 200 entries", () => {
			for (let i = 0; i < 210; i++) {
				history.addRoll({title: `Roll ${i}`, total: i});
			}
			expect(history.getRollCount()).toBe(200);
		});

		test("should discard oldest entries when cap exceeded", () => {
			for (let i = 0; i < 205; i++) {
				history.addRoll({title: `Roll ${i}`, total: i});
			}

			const rolls = history.getRolls();
			// Newest should be Roll 204 at index 0
			expect(rolls[0].title).toBe("Roll 204");
			// Oldest kept should be Roll 5 at index 199
			expect(rolls[199].title).toBe("Roll 5");
		});

		test("MAX_ROLLS should be 200", () => {
			expect(CharacterSheetRollHistory.MAX_ROLLS).toBe(200);
		});
	});

	// ===================================================================
	// clear
	// ===================================================================
	describe("clear", () => {
		test("should empty all rolls", () => {
			history.addRoll({title: "Roll 1", total: 10});
			history.addRoll({title: "Roll 2", total: 20});
			expect(history.getRollCount()).toBe(2);

			history.clear();
			expect(history.getRollCount()).toBe(0);
			expect(history.getRolls()).toEqual([]);
		});

		test("should reset the unread count to zero", () => {
			history.addRoll({title: "Roll 1", total: 10});
			history.addRoll({title: "Roll 2", total: 20});
			expect(history._unreadCount).toBe(2);

			history.clear();
			expect(history._unreadCount).toBe(0);
		});
	});

	// ===================================================================
	// Unread badge (B10)
	// ===================================================================
	describe("unread badge", () => {
		test("should start with a zero unread count", () => {
			expect(history._unreadCount).toBe(0);
		});

		test("should increment unread count for rolls added while closed", () => {
			expect(history._isOpen).toBe(false);
			history.addRoll({title: "Roll 1", total: 10});
			history.addRoll({title: "Roll 2", total: 20});
			expect(history._unreadCount).toBe(2);
		});

		test("should reset unread count to zero when the log is opened", () => {
			history.addRoll({title: "Roll 1", total: 10});
			history.addRoll({title: "Roll 2", total: 20});
			expect(history._unreadCount).toBe(2);

			history.toggle(); // open
			expect(history._isOpen).toBe(true);
			expect(history._unreadCount).toBe(0);
		});

		test("should NOT increment unread count for rolls added while open", () => {
			history.toggle(); // open
			expect(history._isOpen).toBe(true);

			history.addRoll({title: "Roll 1", total: 10});
			history.addRoll({title: "Roll 2", total: 20});
			expect(history._unreadCount).toBe(0);
		});

		test("should resume counting unread after the log is closed again", () => {
			history.toggle(); // open
			history.toggle(); // close
			expect(history._isOpen).toBe(false);

			history.addRoll({title: "Roll after close", total: 5});
			expect(history._unreadCount).toBe(1);
		});

		test("unread count should not exceed MAX_ROLLS", () => {
			for (let i = 0; i < CharacterSheetRollHistory.MAX_ROLLS + 25; i++) {
				history.addRoll({title: `Roll ${i}`, total: i});
			}
			expect(history._unreadCount).toBe(CharacterSheetRollHistory.MAX_ROLLS);
		});

		test("badge should reflect unread count and hide at zero", () => {
			const badge = {textContent: "", style: {display: ""}};
			const prevDocument = globalThis.document;
			globalThis.document = {getElementById: (id) => (id === "charsheet-rolllog-badge" ? badge : null)};

			try {
				// addRoll drives the badge itself — no manual _updateBadge() call.
				history.addRoll({title: "Roll 1", total: 10});
				history.addRoll({title: "Roll 2", total: 20});
				expect(badge.textContent).toBe("2");
				expect(badge.style.display).not.toBe("none");

				history.toggle(); // open -> unread resets, badge hidden
				expect(badge.style.display).toBe("none");

				// Badge tracks unread, NOT total history: 3 stored rolls but only 1 unread.
				history.toggle(); // close
				history.addRoll({title: "Roll 3", total: 30});
				expect(history.getRollCount()).toBe(3);
				expect(badge.textContent).toBe("1");
				expect(badge.style.display).not.toBe("none");

				history.clear();
				expect(badge.style.display).toBe("none");
			} finally {
				globalThis.document = prevDocument;
			}
		});
	});

	// ===================================================================
	// Roll type derivation
	// ===================================================================
	describe("roll type derivation", () => {
		const cases = [
			{title: "Attack: Longsword", expected: "ATTACK"},
			{title: "Damage: Longsword", expected: "DAMAGE"},
			{title: "Spell Attack: Fireball", expected: "SPELL_ATTACK"},
			{title: "Spell Damage: Fireball", expected: "SPELL_DAMAGE"},
			{title: "Spell Healing: Cure Wounds", expected: "SPELL_HEALING"},
			{title: "Spell Save DC: Fireball", expected: "SPELL_DC"},
			{title: "Spell DC: Hold Person", expected: "SPELL_DC"},
			{title: "Saving Throw: Dexterity", expected: "SAVE"},
			{title: "Constitution Save", expected: "SAVE"},
			{title: "Death Save", expected: "DEATH_SAVE"},
			{title: "Initiative", expected: "INITIATIVE"},
			{title: "Hit Die: Fighter", expected: "HIT_DIE"},
			{title: "Hit Dice: Wizard", expected: "HIT_DIE"},
			{title: "Healing: Potion", expected: "HIT_DIE"},
			{title: "Ability Check: Strength", expected: "ABILITY"},
			{title: "Perception", expected: "SKILL"},
			{title: "Athletics", expected: "SKILL"},
			{title: "Sleight of Hand", expected: "SKILL"},
			{title: "Stealth", expected: "SKILL"},
			{title: "Something Else", expected: "OTHER"},
		];

		test.each(cases)("should derive $expected from '$title'", ({title, expected}) => {
			history.addRoll({title, total: 10});
			expect(history.getRolls()[0].rollType).toBe(expected);
			history.clear();
		});
	});

	// ===================================================================
	// ROLL_TYPES registry
	// ===================================================================
	describe("ROLL_TYPES", () => {
		test("should have all expected type entries", () => {
			const types = CharacterSheetRollHistory.ROLL_TYPES;
			expect(types.ATTACK).toBeDefined();
			expect(types.SPELL_ATTACK).toBeDefined();
			expect(types.DAMAGE).toBeDefined();
			expect(types.SPELL_DAMAGE).toBeDefined();
			expect(types.SAVE).toBeDefined();
			expect(types.SPELL_DC).toBeDefined();
			expect(types.SKILL).toBeDefined();
			expect(types.ABILITY).toBeDefined();
			expect(types.INITIATIVE).toBeDefined();
			expect(types.DEATH_SAVE).toBeDefined();
			expect(types.HEALING).toBeDefined();
			expect(types.SPELL_HEALING).toBeDefined();
			expect(types.HIT_DIE).toBeDefined();
			expect(types.OTHER).toBeDefined();
		});

		test("each type should have label and color", () => {
			for (const [key, val] of Object.entries(CharacterSheetRollHistory.ROLL_TYPES)) {
				expect(val.label).toBeTruthy();
				expect(val.color).toMatch(/^#[0-9a-f]{6}$/i);
			}
		});
	});

	// ===================================================================
	// Timestamp formatting
	// ===================================================================
	describe("formatRelativeTime", () => {
		test("should return 'just now' for recent timestamps", () => {
			expect(CharacterSheetRollHistory.formatRelativeTime(Date.now() - 3000)).toBe("just now");
		});

		test("should return seconds for < 1 minute", () => {
			const result = CharacterSheetRollHistory.formatRelativeTime(Date.now() - 30_000);
			expect(result).toMatch(/^\d+s ago$/);
		});

		test("should return minutes for < 1 hour", () => {
			const result = CharacterSheetRollHistory.formatRelativeTime(Date.now() - 300_000);
			expect(result).toMatch(/^\d+m ago$/);
		});

		test("should return hours for < 1 day", () => {
			const result = CharacterSheetRollHistory.formatRelativeTime(Date.now() - 7_200_000);
			expect(result).toMatch(/^\d+h ago$/);
		});

		test("should return days for >= 1 day", () => {
			const result = CharacterSheetRollHistory.formatRelativeTime(Date.now() - 172_800_000);
			expect(result).toMatch(/^\d+d ago$/);
		});
	});

	// ===================================================================
	// HTML escaping
	// ===================================================================
	describe("HTML safety", () => {
		test("should escape HTML in title and breakdown for display", () => {
			history.addRoll({title: "<script>alert(\"xss\")</script>", total: 10, breakdown: "<img onerror=alert(1)>"});
			const roll = history.getRolls()[0];
			// The data is stored as-is; escaping happens in _buildRollEntry/_escapeHtml
			expect(history._escapeHtml(roll.title)).not.toContain("<script>");
			expect(history._escapeHtml(roll.breakdown)).not.toContain("<img");
		});
	});

	// ===================================================================
	// getRolls returns a copy
	// ===================================================================
	describe("getRolls isolation", () => {
		test("should return a copy, not the internal array", () => {
			history.addRoll({title: "Test", total: 1});
			const rolls = history.getRolls();
			rolls.push({title: "Injected", total: 999});
			expect(history.getRollCount()).toBe(1);
		});
	});
});
