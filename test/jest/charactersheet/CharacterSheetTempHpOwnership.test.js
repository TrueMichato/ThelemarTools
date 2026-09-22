import "./setup.js";

let CharacterSheetState;

const OWNER_A = {
	id: "feature:alpha",
	kind: "classFeature",
	name: "Alpha Field",
	source: "TST",
	uid: "Alpha Field|Tester|TST|3",
};

const OWNER_B = {
	id: "feature:beta",
	kind: "classFeature",
	name: "Beta Field",
	source: "TST",
	uid: "Beta Field|Tester|TST|5",
};

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Source-owned temporary HP", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setHp(30, 30);
	});

	it("grants temp HP with a canonical persisted owner receipt", () => {
		expect(state.grantOwnedTempHp(10, {...OWNER_A, key: OWNER_A.id, id: undefined})).toBe(true);
		expect(state.getTempHp()).toBe(10);
		expect(state.getTempHpOwner()).toEqual(OWNER_A);
		expect(state.toJson().hp).toMatchObject({temp: 10, tempOwner: OWNER_A});
	});

	it("does not let lower or equal competing grants replace the pool or steal ownership", () => {
		state.grantOwnedTempHp(10, OWNER_A);

		expect(state.grantOwnedTempHp(9, OWNER_B)).toBe(false);
		expect(state.grantOwnedTempHp(10, OWNER_B)).toBe(false);
		expect(state.grantTempHp(8)).toBe(false);
		expect(state.grantTempHp(10)).toBe(false);
		expect(state.getTempHp()).toBe(10);
		expect(state.getTempHpOwner()).toEqual(OWNER_A);
	});

	it("atomically replaces value and owner for a higher grant from another source", () => {
		state.grantOwnedTempHp(10, OWNER_A);

		expect(state.grantOwnedTempHp(14, OWNER_B)).toBe(true);
		expect(state.getTempHp()).toBe(14);
		expect(state.getTempHpOwner()).toEqual(OWNER_B);
	});

	it("clears ownership when a higher unowned grant replaces the pool", () => {
		state.grantOwnedTempHp(10, OWNER_A);

		expect(state.grantTempHp(15)).toBe(true);
		expect(state.getTempHp()).toBe(15);
		expect(state.getTempHpOwner()).toBeNull();
	});

	it("preserves the owner when takeDamage only partially absorbs the pool", () => {
		state.grantOwnedTempHp(10, OWNER_A);

		state.takeDamage(4);

		expect(state.getTempHp()).toBe(6);
		expect(state.getCurrentHp()).toBe(30);
		expect(state.getTempHpOwner()).toEqual(OWNER_A);
	});

	it("clears the owner when takeDamage fully absorbs the pool", () => {
		state.grantOwnedTempHp(10, OWNER_A);

		state.takeDamage(10);

		expect(state.getTempHp()).toBe(0);
		expect(state.getTempHpOwner()).toBeNull();
	});

	it("clears the pool only for an exact owner receipt", () => {
		state.grantOwnedTempHp(10, OWNER_A);

		expect(state.clearOwnedTempHp(OWNER_A)).toBe(true);
		expect(state.getTempHp()).toBe(0);
		expect(state.getTempHpOwner()).toBeNull();
	});

	it("does not clear another source's larger or newer pool", () => {
		state.grantOwnedTempHp(10, OWNER_A);
		state.grantOwnedTempHp(14, OWNER_B);

		expect(state.clearOwnedTempHp(OWNER_A)).toBe(false);
		expect(state.clearOwnedTempHp({...OWNER_B, source: "OTHER"})).toBe(false);
		expect(state.getTempHp()).toBe(14);
		expect(state.getTempHpOwner()).toEqual(OWNER_B);
	});

	it("manual replacements and reset clear stale ownership", () => {
		state.grantOwnedTempHp(10, OWNER_A);
		state.setTempHp(10);
		expect(state.getTempHp()).toBe(10);
		expect(state.getTempHpOwner()).toBeNull();

		state.grantOwnedTempHp(12, OWNER_A);
		state.setTempHp(6);
		expect(state.getTempHp()).toBe(6);
		expect(state.getTempHpOwner()).toBeNull();

		state.grantOwnedTempHp(10, OWNER_A);
		state.setHp(20, 30, 4);
		expect(state.getTempHp()).toBe(4);
		expect(state.getTempHpOwner()).toBeNull();

		state.grantOwnedTempHp(10, OWNER_A);
		state.reset();
		expect(state.getTempHp()).toBe(0);
		expect(state.getTempHpOwner()).toBeNull();
	});

	it("long rest preserves an existing pool unless explicitly configured to clear it", () => {
		state.grantOwnedTempHp(10, OWNER_A);

		state.onLongRest();
		expect(state.getTempHp()).toBe(10);
		expect(state.getTempHpOwner()).toEqual(OWNER_A);

		state.onLongRest({clearTempHp: true});
		expect(state.getTempHp()).toBe(0);
		expect(state.getTempHpOwner()).toBeNull();
	});

	it("round-trips a valid owner receipt through save/load", () => {
		state.grantOwnedTempHp(10, OWNER_A);
		const saved = state.toJson();
		const restored = new CharacterSheetState();

		restored.loadFromJson(saved);
		expect(restored.getTempHp()).toBe(10);
		expect(restored.getTempHpOwner()).toEqual(OWNER_A);
	});

	it("loads legacy saves unowned and drops zero-pool or malformed receipts", () => {
		const legacy = new CharacterSheetState();
		legacy.loadFromJson({hp: {current: 10, max: 10, temp: 5}});
		expect(legacy.getTempHp()).toBe(5);
		expect(legacy.getTempHpOwner()).toBeNull();

		const stale = new CharacterSheetState();
		stale.loadFromJson({hp: {current: 10, max: 10, temp: 0, tempOwner: OWNER_A}});
		expect(stale.getTempHpOwner()).toBeNull();

		const malformed = new CharacterSheetState();
		malformed.loadFromJson({
			hp: {
				current: 10,
				max: 10,
				temp: 5,
				tempOwner: {id: OWNER_A.id, name: OWNER_A.name, source: OWNER_A.source},
			},
		});
		expect(malformed.getTempHp()).toBe(5);
		expect(malformed.getTempHpOwner()).toBeNull();
		expect(malformed.toJson().hp.tempOwner).toBeNull();
	});
});
