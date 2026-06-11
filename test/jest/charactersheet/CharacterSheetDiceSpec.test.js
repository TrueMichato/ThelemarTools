/**
 * Bug #3 — multi-die animation spec helpers (CharacterSheetDice3d static logic).
 *
 * The 3D engine previously animated exactly ONE d20 regardless of the real
 * roll. The fix introduces pure helpers that turn a dice spec
 * (`[{sides, values:[…]}]`) into the library's multi-die notation and a
 * lightweight synthesized roll sound. These tests pin the pure logic (no
 * WebGL / no real AudioContext) so the animation reflects the ACTUAL dice.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-dice3d.js";

const CharacterSheetDice3d = globalThis.CharacterSheetDice3d;

describe("CharacterSheetDice3d.normalizeGroups", () => {
	test("keeps supported dice and clamps to in-range values", () => {
		const out = CharacterSheetDice3d.normalizeGroups([
			{sides: 4, values: [1, 3, 2]},
			{sides: 20, values: [17]},
		]);
		expect(out).toEqual([
			{sides: 4, values: [1, 3, 2]},
			{sides: 20, values: [17]},
		]);
	});

	test("drops unsupported dice (d100 -> legacy)", () => {
		const out = CharacterSheetDice3d.normalizeGroups([
			{sides: 100, values: [73]},
			{sides: 6, values: [4]},
		]);
		expect(out).toEqual([{sides: 6, values: [4]}]);
	});

	test("drops out-of-range / non-finite values and empty groups", () => {
		const out = CharacterSheetDice3d.normalizeGroups([
			{sides: 6, values: [0, 7, 3, NaN, "x"]}, // only 3 is valid (1..6)
			{sides: 8, values: []}, // empty -> dropped
			null,
		]);
		expect(out).toEqual([{sides: 6, values: [3]}]);
	});

	test("accepts legacy {diceType, finalValue} shape", () => {
		const out = CharacterSheetDice3d.normalizeGroups([{diceType: 12, finalValue: 9}]);
		expect(out).toEqual([{sides: 12, values: [9]}]);
	});

	test("returns [] for non-array input", () => {
		expect(CharacterSheetDice3d.normalizeGroups(null)).toEqual([]);
		expect(CharacterSheetDice3d.normalizeGroups(undefined)).toEqual([]);
		expect(CharacterSheetDice3d.normalizeGroups({})).toEqual([]);
	});
});

describe("CharacterSheetDice3d.buildNotation", () => {
	test("single group -> NdX@v,v,…", () => {
		expect(CharacterSheetDice3d.buildNotation([{sides: 4, values: [2, 3, 1]}]))
			.toBe("3d4@2,3,1");
	});

	// Regression (#1): the vendored dice-box `parseNotation` splits the whole
	// string on the FIRST "@", so per-group "@" (e.g. "3d4@2,3,1+1d20@15") loses
	// every dice term after the first and mis-reads the forced values. The
	// canonical, parseable form is all dice terms first, then ONE trailing "@"
	// carrying every value in dice order.
	test("multiple groups -> single trailing '@' with all values in order (#1)", () => {
		expect(CharacterSheetDice3d.buildNotation([
			{sides: 4, values: [2, 3, 1]},
			{sides: 20, values: [15]},
		])).toBe("3d4+1d20@2,3,1,15");
	});

	test("emits exactly one '@' regardless of group count (#1)", () => {
		const notation = CharacterSheetDice3d.buildNotation([
			{sides: 6, values: [5, 2]},
			{sides: 8, values: [7]},
			{sides: 6, values: [1]},
		]);
		expect((notation.match(/@/g) || []).length).toBe(1);
	});

	test("a lone d20 builds the legacy single-die notation (back-compat)", () => {
		expect(CharacterSheetDice3d.buildNotation([{sides: 20, values: [17]}]))
			.toBe("1d20@17");
	});

	test("end-to-end: normalize then build for a 2d6 + 1d8 roll (#1)", () => {
		const groups = CharacterSheetDice3d.normalizeGroups([
			{sides: 6, values: [5, 2]},
			{sides: 8, values: [7]},
		]);
		expect(CharacterSheetDice3d.buildNotation(groups)).toBe("2d6+1d8@5,2,7");
	});

	test("the trailing values are exactly the rolled values, in dice order (#1)", () => {
		// Models a Sneak Attack: weapon 1d8 (=8) + sneak 2d6 (=3,5) → total 16.
		const groups = [
			{sides: 8, values: [8]},
			{sides: 6, values: [3, 5]},
		];
		const notation = CharacterSheetDice3d.buildNotation(groups);
		expect(notation).toBe("1d8+2d6@8,3,5");
		const vals = notation.split("@")[1].split(",").map(Number);
		expect(vals).toEqual([8, 3, 5]);
		expect(vals.reduce((a, b) => a + b, 0)).toBe(16);
	});
});

describe("CharacterSheetDice3d.playRollSound", () => {
	let origAudioCtx;
	let origWebkit;

	beforeEach(() => {
		origAudioCtx = globalThis.AudioContext;
		origWebkit = globalThis.webkitAudioContext;
		CharacterSheetDice3d._audioCtx = null;
	});

	afterEach(() => {
		globalThis.AudioContext = origAudioCtx;
		globalThis.webkitAudioContext = origWebkit;
		CharacterSheetDice3d._audioCtx = null;
	});

	function installFakeAudio () {
		const started = [];
		function FakeCtx () {
			this.state = "running";
			this.currentTime = 0;
			this.sampleRate = 44100;
			this.destination = {};
		}
		FakeCtx.prototype.createBuffer = function (ch, frames, rate) {
			return {getChannelData: () => new Float32Array(frames)};
		};
		FakeCtx.prototype.createBufferSource = function () {
			return {buffer: null, connect () {}, start (t) { started.push(t); }, stop () {}};
		};
		FakeCtx.prototype.createBiquadFilter = function () {
			return {type: "", frequency: {value: 0}, Q: {value: 0}, connect () {}};
		};
		FakeCtx.prototype.createGain = function () {
			return {gain: {value: 0}, connect () {}};
		};
		globalThis.AudioContext = FakeCtx;
		globalThis.webkitAudioContext = undefined;
		return started;
	}

	test("is a no-op (never throws) when no AudioContext is available", () => {
		globalThis.AudioContext = undefined;
		globalThis.webkitAudioContext = undefined;
		expect(() => CharacterSheetDice3d.playRollSound(0.35, 3)).not.toThrow();
	});

	test("schedules one clack per die, capped at 6", () => {
		const started = installFakeAudio();
		CharacterSheetDice3d.playRollSound(0.35, 3);
		expect(started.length).toBe(3);

		started.length = 0;
		CharacterSheetDice3d.playRollSound(0.35, 20); // capped
		expect(started.length).toBe(6);
	});

	test("schedules at least one clack even for a zero/garbage die count", () => {
		const started = installFakeAudio();
		CharacterSheetDice3d.playRollSound(0.35, 0);
		expect(started.length).toBe(1);
	});

	test("reuses a single AudioContext across calls (warm singleton)", () => {
		installFakeAudio();
		CharacterSheetDice3d.playRollSound(0.35, 1);
		const first = CharacterSheetDice3d._audioCtx;
		CharacterSheetDice3d.playRollSound(0.35, 1);
		expect(CharacterSheetDice3d._audioCtx).toBe(first);
	});
});

describe("CharacterSheetDice3d static surface", () => {
	test("SUPPORTED_DICE is the 3D-renderable set (d100 excluded)", () => {
		expect([...CharacterSheetDice3d.SUPPORTED_DICE].sort((a, b) => a - b))
			.toEqual([4, 6, 8, 10, 12, 20]);
		expect(CharacterSheetDice3d.SUPPORTED_DICE.has(100)).toBe(false);
	});
});
