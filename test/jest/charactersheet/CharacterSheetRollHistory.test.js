import "./setup.js";

let CharacterSheetRollHistory;

beforeAll(async () => {
	CharacterSheetRollHistory = (await import("../../../js/charactersheet/charactersheet-rollhistory.js")).CharacterSheetRollHistory;
});

describe("CharacterSheetRollHistory", () => {
	let history;

	beforeEach(() => {
		// Provide a minimal page mock — the module only uses page for reference
		history = new CharacterSheetRollHistory({});
	});

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
			history.addRoll({title: '<script>alert("xss")</script>', total: 10, breakdown: '<img onerror=alert(1)>'});
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
