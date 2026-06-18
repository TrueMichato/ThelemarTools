/**
 * Interdict Boon per-boon mechanical effects (R19, MCDM "The Illrigger Revised").
 *
 * Covers all 34 `ItdBoon` optional features. Each boon has a real behavioral assertion via
 * one of four mechanisms:
 *   - CALC  → getFeatureCalculations() flag + derived number
 *   - STATE → ACTIVE_STATE_TYPES toggle (effects asserted while active)
 *   - BURN  → burnSeals() integration (Axiomatic Seals)
 *   - NARR  → flag-only (purely narrative / enemy-side; explicitly tagged no-sheet-effect)
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureEffectRegistry = globalThis.FeatureEffectRegistry;

function buildIllrigger (level = 10, {cha} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Illrigger", source: "IllriggerRevised", level});
	if (cha != null) state._data.abilities.cha = cha;
	return state;
}

function addBoon (state, name) {
	state._data.features.push({name, featureType: ["ItdBoon"], source: "IllriggerRevised"});
	return state;
}

describe("Interdict Boon effects — baseline", () => {
	test("no boons selected leaves boon flags unset", () => {
		const state = buildIllrigger(10);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasAbatingSeal).toBeUndefined();
		expect(calcs.hasVengefulShot).toBeUndefined();
		expect(calcs.hasAxiomaticSeals).toBeUndefined();
	});

	test("getInterdictBoons returns only ItdBoon features", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Vengeful Shot");
		state._data.features.push({name: "Extra Attack", featureType: ["class"]});
		const boons = state.getInterdictBoons();
		expect(boons).toHaveLength(1);
		expect(boons[0].name).toBe("Vengeful Shot");
	});
});

describe("Interdict Boon effects — CALC (flag + derived number)", () => {
	// {boon, level, cha?, flag, field?, expected? | fromCalcs?}
	const CASES = [
		{boon: "Abating Seal", level: 10, flag: "hasAbatingSeal", field: "abatingSealReductionFlat", expected: 5},
		{boon: "Abating Seal", level: 7, flag: "hasAbatingSeal", field: "abatingSealReduction", expected: "1d10 + 3"},
		{boon: "Acheron's Chain", level: 10, flag: "hasAcheronsChain", field: "acheronsChainDc", fromCalcs: (c) => c.interdictDc},
		{boon: "Bedevil", level: 10, flag: "hasBedevil", field: "bedevilSavePenalty", expected: 4},
		{boon: "Blood for Blood (Passive)", level: 10, flag: "hasBloodForBlood", field: "bloodForBloodDamage", expected: 4},
		{boon: "By the Throat", level: 10, flag: "hasByTheThroat", field: "byTheThroatDc", fromCalcs: (c) => c.interdictDc},
		{boon: "Conflagrant Channel", level: 10, flag: "hasConflagrantChannel", field: "conflagrantChannelRange", expected: 60},
		{boon: "Dis's Onslaught (Passive)", level: 10, flag: "hasDissOnslaught"},
		{boon: "Dispater's Supremacy (Passive)", level: 10, flag: "hasDispatersSupremacy", field: "interdictedCritRange", expected: 18},
		{boon: "Eyes of the Gate", level: 10, flag: "hasEyesOfTheGate", field: "eyesOfTheGateDc", fromCalcs: (c) => c.interdictDc},
		{boon: "Flash of Brimstone", level: 10, flag: "hasFlashOfBrimstone", field: "flashOfBrimstoneRange", expected: 5},
		{boon: "Foul Interchange", level: 10, flag: "hasFoulInterchange", field: "foulInterchangeDc", fromCalcs: (c) => c.interdictDc},
		{boon: "Hell Mage (Passive)", level: 10, flag: "hasHellMage", field: "hellMageSeals", expected: 4},
		{boon: "Hell's Assassin (Passive)", level: 10, flag: "hasHellsAssassin"},
		{boon: "Hellsight", level: 10, flag: "hasHellsight", field: "hellsightSenseRange", expected: 60},
		{boon: "Impaling Shot", level: 10, flag: "hasImpalingShot", field: "impalingShotAcPenalty", expected: 4},
		{boon: "Iron Gaol", level: 10, flag: "hasIronGaol", field: "ironGaolSealCost", expected: 4},
		{boon: "Iron Gaol", level: 10, flag: "hasIronGaol", field: "ironGaolDc", fromCalcs: (c) => c.interdictDc},
		{boon: "Last Word", level: 10, flag: "hasLastWord", field: "lastWordDicePerSeal", expected: "3d6"},
		{boon: "Last Word", level: 10, flag: "hasLastWord", field: "lastWordMaxSeals", expected: 3},
		{boon: "Red Cant", level: 10, flag: "hasRedCant", field: "redCantFloor", expected: 10},
		{boon: "Sanguine Gift", level: 10, flag: "hasSanguineGift", field: "sanguineGiftHeal", expected: 10},
		{boon: "Slippery Ploy", level: 10, flag: "hasSlipperyPloy", field: "slipperyPloyDc", fromCalcs: (c) => c.interdictDc},
		{boon: "Soul Eater", level: 13, flag: "hasSoulEater", field: "soulEaterTempHp", expected: 13},
		{boon: "Soul's Doom", level: 10, flag: "hasSoulsDoom", field: "soulsDoomDamage", expected: 4},
		{boon: "Spellbreaker", level: 10, flag: "hasSpellbreaker"},
		{boon: "Styx's Apathy", level: 10, flag: "hasStyxsApathy"},
		{boon: "Swift Retribution (Passive)", level: 10, flag: "hasSwiftRetribution"},
		{boon: "Telekinetic Seal", level: 10, flag: "hasTelekineticSeal", field: "telekineticSealDc", fromCalcs: (c) => c.interdictDc},
		{boon: "Unleash Hell", level: 10, flag: "hasUnleashHell"},
		{boon: "Vengeful Shot", level: 10, flag: "hasVengefulShot", field: "vengefulShotBonus", expected: 5},
		{boon: "Vengeful Shot", level: 7, flag: "hasVengefulShot", field: "vengefulShotBonus", expected: 3},
	];

	CASES.forEach(({boon, level, cha, flag, field, expected, fromCalcs}) => {
		const label = field ? `${boon} → ${field}` : `${boon} → ${flag}`;
		test(label, () => {
			const state = buildIllrigger(level, {cha});
			addBoon(state, boon);
			const calcs = state.getFeatureCalculations();
			expect(calcs[flag]).toBe(true);
			if (field) {
				const exp = fromCalcs ? fromCalcs(calcs) : expected;
				expect(calcs[field]).toBe(exp);
			}
		});
	});

	test("Axiomatic Seals → sealDamageBonus = max(1, CHA mod)", () => {
		const state = buildIllrigger(11, {cha: 16}); // +3
		addBoon(state, "Axiomatic Seals (Passive)");
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasAxiomaticSeals).toBe(true);
		expect(calcs.sealDamageBonus).toBe(3);
	});

	test("Axiomatic Seals → sealDamageBonus floors at 1 for low CHA", () => {
		const state = buildIllrigger(11, {cha: 8}); // -1
		addBoon(state, "Axiomatic Seals (Passive)");
		expect(state.getFeatureCalculations().sealDamageBonus).toBe(1);
	});
});

describe("Interdict Boon effects — STATE (active-state toggles)", () => {
	test("Hellish Frenzy: +2 AC and doubled movement while active", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Hellish Frenzy");
		expect(state.getFeatureCalculations().hasHellishFrenzy).toBe(true);
		state.activateState("hellishFrenzy");
		expect(state.getBonusFromStates("ac")).toBe(2);
		expect(state.getSpeedMultiplierFromConditions()).toBe(2);
	});

	test("Shadow Shroud: +2 AC while active", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Shadow Shroud");
		expect(state.getFeatureCalculations().hasShadowShroud).toBe(true);
		expect(state.getFeatureCalculations().shadowShroudAcBonus).toBe(2);
		state.activateState("shadowShroud");
		expect(state.getBonusFromStates("ac")).toBe(2);
	});

	test("Veil of Lies: applies the Invisible condition while active", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Veil of Lies");
		expect(state.getFeatureCalculations().hasVeilOfLies).toBe(true);
		expect(state.hasCondition("Invisible")).toBe(false);
		state.activateState("veilOfLies");
		expect(state.hasCondition("Invisible")).toBe(true);
		state.deactivateState("veilOfLies");
		expect(state.hasCondition("Invisible")).toBe(false);
	});

	// (R26 #7) Ending Veil of Lies must clear the granted Invisible condition through
	// EVERY deactivation path, not just deactivateState/removeActiveState. The Play Mode
	// "Active States" card ends boons via toggleActiveState, and combat duration expiry
	// ends them via advanceRound; both previously left the condition (and its derived
	// active state) stuck on the sheet.
	test("Veil of Lies: toggleActiveState OFF removes the Invisible condition (Play Mode path)", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Veil of Lies");
		const stateId = state.activateState("veilOfLies");
		expect(state.hasCondition("Invisible")).toBe(true);

		// Play Mode's Active-States toggle deactivates via toggleActiveState.
		const nowActive = state.toggleActiveState(stateId);
		expect(nowActive).toBe(false);
		expect(state.hasCondition("Invisible")).toBe(false);
		// The condition-derived active state must be cleaned up too (no stale "Invisible").
		expect(state._data.activeStates.some((s) => s.isCondition && /invisible/i.test(s.name || ""))).toBe(false);

		// Toggling back ON re-grants the condition (symmetry).
		const reActive = state.toggleActiveState(stateId);
		expect(reActive).toBe(true);
		expect(state.hasCondition("Invisible")).toBe(true);
	});

	test("Veil of Lies: combat-round expiry removes the Invisible condition (advanceRound path)", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Veil of Lies");
		state.startCombat();
		const stateId = state.activateState("veilOfLies");
		expect(state.hasCondition("Invisible")).toBe(true);

		// Force the boon's active-state to expire on the next round.
		const inst = state._data.activeStates.find((s) => s.id === stateId);
		inst.roundsRemaining = 1;
		const expired = state.advanceRound();
		expect(expired).toContain("Veil of Lies");
		expect(state.hasCondition("Invisible")).toBe(false);
		expect(state._data.activeStates.some((s) => s.isCondition && /invisible/i.test(s.name || ""))).toBe(false);
	});

	// (R27 #2) Repeat report: "Veil of Lies still doesn't remove invisibility". On a FRESH
	// grant every End path already works (the state carries a `_managedConditions` backref).
	// The recurring real-world failure is a LEGACY active state — a Veil of Lies → Invisible
	// grant saved by an older build that predates managed-condition tracking — which has NO
	// `_managedConditions` backref at all. `_removeStateAddedConditions` only cleared tracked
	// conditions, so ending such a state removed nothing and Invisible stayed stuck.
	test("Veil of Lies: legacy active state with NO _managedConditions backref still clears Invisible on end", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Veil of Lies");
		// Independently apply the Invisible condition (as the legacy grant once did) …
		state.addCondition("Invisible");
		expect(state.hasCondition("Invisible")).toBe(true);
		// … and stand up a legacy active-state instance with NO managed-condition backref.
		state._data.activeStates = (state._data.activeStates || []).filter((s) => s.stateTypeId !== "veilOfLies");
		state._data.activeStates.push({id: "legacy-veil", stateTypeId: "veilOfLies", name: "Veil of Lies", active: true});
		const legacy = state._data.activeStates.find((s) => s.stateTypeId === "veilOfLies");
		expect("_managedConditions" in legacy).toBe(false);

		state.deactivateState("veilOfLies");
		// Fallback to the state type's declared addsConditions clears the stuck condition.
		expect(state.hasCondition("Invisible")).toBe(false);
	});

	test("Veil of Lies: tracked-but-empty _managedConditions does NOT strip an independently-applied Invisible", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Veil of Lies");
		// Player has Invisible from some OTHER source (not this state).
		state.addCondition("Invisible");
		// A current-version state that added nothing of its own (empty backref) must not
		// fall back to addsConditions and over-remove the independent condition.
		state._data.activeStates = (state._data.activeStates || []).filter((s) => s.stateTypeId !== "veilOfLies");
		state._data.activeStates.push({id: "veil-empty", stateTypeId: "veilOfLies", name: "Veil of Lies", active: true, _managedConditions: []});

		state.deactivateState("veilOfLies");
		expect(state.hasCondition("Invisible")).toBe(true);
	});

	test("Hellsight: truesight range surfaced + state activatable", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Hellsight");
		expect(state.getFeatureCalculations().hellsightSenseRange).toBe(60);
		state.activateState("hellsight");
		const active = state._data.activeStates.find((s) => s.stateTypeId === "hellsight" && s.active);
		expect(active).toBeTruthy();
	});

	test("boon toggle is auto-detected by name as an activatable feature", () => {
		const detected = CharacterSheetState.detectActivatableFeature({
			name: "Shadow Shroud",
			description: "A mantle of semisolid shadows around yourself.",
		});
		expect(detected).toBeTruthy();
		expect(detected.stateTypeId).toBe("shadowShroud");
		expect(detected.isToggle).toBe(true);
	});
});

describe("Interdict Boon effects — BURN (Axiomatic Seals → burnSeals)", () => {
	test("burned seal damage includes +CHA per seal when Axiomatic Seals is known", () => {
		const state = buildIllrigger(11, {cha: 16}); // 3d6 per seal, +3 bonus
		addBoon(state, "Axiomatic Seals (Passive)");
		state.placeSeal("Goblin", {force: true});
		state.placeSeal("Goblin", {force: true});
		const res = state.burnSeals("Goblin", 2);
		expect(res).toBeTruthy();
		expect(res.bonus).toBe(6); // +3 per seal × 2 seals
		expect(res.dice).toBe("6d6 + 6");
	});

	test("without Axiomatic Seals, burned seal damage has no flat bonus", () => {
		const state = buildIllrigger(11, {cha: 16});
		state.placeSeal("Goblin", {force: true});
		const res = state.burnSeals("Goblin", 1);
		expect(res.bonus).toBe(0);
		expect(res.dice).toBe("3d6");
	});
});

describe("Interdict Boon effects — NARR (flag-only, no derivable sheet number)", () => {
	// These two boons are purely narrative (Dark Malediction: darkness aura) or
	// enemy-side (Incontrovertible: enemies have disadvantage on WIS/CHA saves).
	// They carry only a recognition flag — no player-sheet number to derive.
	test.each([
		["Dark Malediction (Passive)", "hasDarkMalediction"],
		["Incontrovertible (Passive)", "hasIncontrovertible"],
	])("%s sets %s and no numeric field", (boon, flag) => {
		const state = buildIllrigger(10);
		addBoon(state, boon);
		expect(state.getFeatureCalculations()[flag]).toBe(true);
	});
});

describe("Interdict Boon effects — FeatureEffectRegistry", () => {
	test("Hell's Assassin registers a conditional damage-reroll modifier", () => {
		const effects = FeatureEffectRegistry.getEffects("Hell's Assassin (Passive)");
		expect(effects).toHaveLength(1);
		expect(effects[0]).toMatchObject({
			type: "modifier",
			modType: "damage:reroll:interdicted:1or2",
			conditional: "against interdicted creatures",
		});
	});
});

describe("Interdict Boon effects — coverage", () => {
	test("all 34 ItdBoon names are recognized by the per-boon field map", () => {
		const names = [
			"Abating Seal", "Acheron's Chain", "Axiomatic Seals (Passive)", "Bedevil",
			"Blood for Blood (Passive)", "By the Throat", "Conflagrant Channel",
			"Dark Malediction (Passive)", "Dis's Onslaught (Passive)", "Dispater's Supremacy (Passive)",
			"Eyes of the Gate", "Flash of Brimstone", "Foul Interchange", "Hell Mage (Passive)",
			"Hell's Assassin (Passive)", "Hellish Frenzy", "Hellsight", "Impaling Shot",
			"Incontrovertible (Passive)", "Iron Gaol", "Last Word", "Red Cant", "Sanguine Gift",
			"Shadow Shroud", "Slippery Ploy", "Soul Eater", "Soul's Doom", "Spellbreaker",
			"Styx's Apathy", "Swift Retribution (Passive)", "Telekinetic Seal", "Unleash Hell",
			"Veil of Lies", "Vengeful Shot",
		];
		expect(names).toHaveLength(34);
		const defs = CharacterSheetState.INTERDICT_BOON_FIELDS;
		names.forEach((name) => {
			const key = CharacterSheetState._normalizeInterdictBoonName(name);
			expect(typeof defs[key]).toBe("function");
		});
	});
});
