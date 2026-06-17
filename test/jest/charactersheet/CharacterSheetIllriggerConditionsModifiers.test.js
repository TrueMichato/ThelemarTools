/**
 * Regression tests for the S-B round-23 Illrigger/Thelemar fixes:
 *   #2  Advantage/disadvantage-encoded named modifiers must NOT leak a flat +1 onto
 *       the affected ability's checks/saves (phantom +1 to WIS/CHA rolls).
 *   #16 A Thelemar (TGTT) character must apply the `_tgtt` condition variants (extra
 *       verbal/somatic-spell constraints, concentration-save disadvantage) even when a
 *       feature adds the condition with the granting feature's name as `source`.
 *   #11 Intransigent's charmed immunity is gated on consciousness ("while conscious")
 *       and source-aware, plus an ally-count chooser that drives the summary label.
 *
 * Assertions target REAL mechanics (modifier totals, applied condition effects,
 * immunity booleans, rendered summary strings) — never level counts.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** Minimal non-Thelemar character. */
function makeBaseCharacter () {
	const state = new CharacterSheetState();
	state.setName("Test Character");
	state.setAbilityBase("str", 10);
	state.setAbilityBase("dex", 10);
	state.setAbilityBase("con", 10);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 10);
	state.setAbilityBase("cha", 10);
	state.addClass({name: "Fighter", source: "XPHB", level: 5});
	state.setHp(40, 40, 0); // conscious by default (HP > 0)
	return state;
}

/** Character that plays under Thelemar (TGTT) rules via a TGTT-sourced class. */
function makeThelemarCharacter () {
	const state = makeBaseCharacter();
	state.addClass({name: "Illrigger", source: "TGTT-IllR", level: 11});
	return state;
}

// =============================================================================
// #2 — Advantage-encoded modifiers do not leak a flat numeric bonus
// =============================================================================
describe("#2 advantage-encoded named modifiers do not add a flat bonus", () => {
	it("check:<abil>:advantage (sentinel value 1) adds 0 to the ability-check custom mod", () => {
		const state = makeBaseCharacter();
		// Mirrors Moloch's Blessing / Forked Tongue Improvement on the real character.
		state.addNamedModifier({name: "Moloch's Blessing", type: "check:cha:advantage", value: 1});
		state.addNamedModifier({name: "Forked Tongue", type: "check:wis:advantage", value: 1});

		expect(state.getAbilityCheckCustomMod("cha")).toBe(0);
		expect(state.getAbilityCheckCustomMod("wis")).toBe(0);
	});

	it("save:advantage:<subtype> (sentinel value 1) adds 0 to the saving-throw custom mod", () => {
		const state = makeBaseCharacter();
		state.addNamedModifier({name: "Devil's Due", type: "save:advantage:poisoned", value: 1});

		// getSaveMod = base (prof? no save prof) + custom; CON base mod 0, no save prof → 0.
		expect(state.getSaveMod("con")).toBe(0);
		expect(state._data.customModifiers.savingThrows.con || 0).toBe(0);
	});

	it("a genuine numeric check modifier is still applied", () => {
		const state = makeBaseCharacter();
		state.addNamedModifier({name: "Guidance-like", type: "check:cha", value: 2});
		expect(state.getAbilityCheckCustomMod("cha")).toBe(2);
	});

	it("advantage + a separate numeric modifier: only the numeric value counts", () => {
		const state = makeBaseCharacter();
		state.addNamedModifier({name: "Adv", type: "check:cha:advantage", value: 1});
		state.addNamedModifier({name: "Real bonus", type: "check:cha", value: 3});
		expect(state.getAbilityCheckCustomMod("cha")).toBe(3);
	});

	it("disadvantage-encoded modifiers also contribute 0 (no phantom penalty)", () => {
		const state = makeBaseCharacter();
		state.addNamedModifier({name: "Hex", type: "check:str:disadvantage", value: 1});
		expect(state.getAbilityCheckCustomMod("str")).toBe(0);
	});
});

// =============================================================================
// #16 — Thelemar characters apply the _tgtt condition variants
// =============================================================================
describe("#16 Thelemar characters resolve _tgtt condition variants", () => {
	it("detects Thelemar play from TGTT-sourced class content (not the universal defaults)", () => {
		// A pure-PHB build is NOT treated as Thelemar even though the fork defaults
		// exhaustionRules to "thelemar" and prioritySources to ["TGTT"].
		expect(makeBaseCharacter()._usesThelemarConditions()).toBe(false);

		const byClassSource = makeBaseCharacter();
		byClassSource.addClass({name: "Illrigger", source: "TGTT-IllR", level: 1});
		expect(byClassSource._usesThelemarConditions()).toBe(true);
	});

	it("applies the _tgtt Frightened (verbal-spell constraint) when a feature adds it by feature name", () => {
		const state = makeThelemarCharacter();
		// Source is the granting feature's NAME (how combat self-conditions are added),
		// NOT "TGTT" — the pre-fix bug resolved the generic variant here.
		state.addCondition({name: "Frightened", source: "Charm Enemy"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "frightened");
		expect(active).toBeTruthy();
		const types = active.customEffects.map(e => e.type);
		expect(types).toContain("verbalConstraint"); // TGTT-only effect
	});

	it("applies the _tgtt Poisoned (concentration-save disadvantage) for a Thelemar character", () => {
		const state = makeThelemarCharacter();
		state.addCondition({name: "Poisoned", source: "Hellish Rebuke"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "poisoned");
		expect(active).toBeTruthy();
		const hasConcSaveDisadv = active.customEffects.some(e => e.type === "disadvantage" && /concentration/.test(e.target || ""));
		expect(hasConcSaveDisadv).toBe(true);
	});

	it("non-Thelemar characters keep the generic variant (no leak / regression)", () => {
		const state = makeBaseCharacter();
		state.addCondition({name: "Frightened", source: "Some Feature"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "frightened");
		expect(active).toBeTruthy();
		const types = active.customEffects.map(e => e.type);
		expect(types).not.toContain("verbalConstraint");
	});

	it("charmed has no _tgtt variant — it deliberately falls back to the generic definition", () => {
		const state = makeThelemarCharacter();
		state.addCondition({name: "Charmed", source: "Some Fey"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "charmed");
		expect(active).toBeTruthy();
		// Generic charmed effects (no extra TGTT constraints) — matches the static def.
		const generic = CharacterSheetState.getConditionEffects("charmed");
		expect(active.customEffects.map(e => e.type)).toEqual(generic.effects.map(e => e.type));
	});

	it("an incapacitating _tgtt condition still breaks concentration for a Thelemar character", () => {
		const state = makeThelemarCharacter();
		state._data.concentrating = true;
		state.addCondition({name: "Stunned", source: "Feature"});
		expect(state._data.concentrating).toBeFalsy();
	});

	// -------------------------------------------------------------------------
	// #13 — Missing _tgtt variants for conditions Illrigger abilities reference.
	// Veil of Lies (self-Invisible) and Telekinetic Seal (target Prone) must
	// resolve to the TGTT Invisible / Prone, not the generic 2014/2024 ones.
	// -------------------------------------------------------------------------
	it("Veil of Lies' Invisible resolves to the TGTT variant (Hidden-to-sight), differing from generic", () => {
		const tgtt = CharacterSheetState.getConditionEffects("invisible", "TGTT");
		const generic = CharacterSheetState.getConditionEffects("invisible");

		expect(tgtt).toBeTruthy();
		expect(tgtt.source).toBe("TGTT");
		expect(tgtt.name).toBe("Invisible");
		// VALUES differ from generic: the TGTT variant adds the "Hidden to sight" note.
		expect(tgtt.effects.length).toBeGreaterThan(generic.effects.length);
		const tgttNote = tgtt.effects.find(e => e.type === "note" && /hidden/i.test(e.value || ""));
		expect(tgttNote).toBeTruthy();
		// Combat benefit preserved (advantage to attack, disadvantage to attacks against).
		expect(tgtt.effects.some(e => e.type === "advantage" && e.target === "attack")).toBe(true);
		expect(tgtt.effects.some(e => e.type === "disadvantage" && e.target === "attacksAgainst")).toBe(true);
	});

	it("a Thelemar character self-applying Invisible (Veil of Lies) gets the TGTT effects, not generic", () => {
		const state = makeThelemarCharacter();
		// Veil of Lies adds Invisible to SELF with the feature name as source.
		state.addCondition({name: "Invisible", source: "Veil of Lies"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "invisible");
		expect(active).toBeTruthy();
		// TGTT-only marker: the "Hidden to sight" note (generic Invisible has no notes).
		const hasHiddenNote = active.customEffects.some(e => e.type === "note" && /hidden/i.test(e.value || ""));
		expect(hasHiddenNote).toBe(true);

		const generic = CharacterSheetState.getConditionEffects("invisible");
		expect(active.customEffects.length).toBeGreaterThan(generic.effects.length);
	});

	it("non-Thelemar characters self-applying Invisible keep the generic variant (no note)", () => {
		const state = makeBaseCharacter();
		state.addCondition({name: "Invisible", source: "Some Spell"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "invisible");
		expect(active).toBeTruthy();
		expect(active.customEffects.some(e => e.type === "note")).toBe(false);
	});

	it("Telekinetic Seal's Prone resolves to the TGTT variant (concentration disruption note)", () => {
		const tgtt = CharacterSheetState.getConditionEffects("prone", "TGTT");
		const generic = CharacterSheetState.getConditionEffects("prone");

		expect(tgtt).toBeTruthy();
		expect(tgtt.source).toBe("TGTT");
		expect(tgtt.name).toBe("Prone");
		// Same attack profile as generic Prone …
		expect(tgtt.effects.some(e => e.type === "disadvantage" && e.target === "attack")).toBe(true);
		expect(tgtt.effects.some(e => e.type === "advantage" && e.target === "meleeAttacksAgainst")).toBe(true);
		expect(tgtt.effects.some(e => e.type === "disadvantage" && e.target === "rangedAttacksAgainst")).toBe(true);
		// … plus the TGTT-only Concentration Disruption note → strictly more effects.
		expect(tgtt.effects.length).toBeGreaterThan(generic.effects.length);
		expect(tgtt.effects.some(e => e.type === "note" && /concentration/i.test(e.value || ""))).toBe(true);
	});

	it("Exhaustion is deliberately left to the level-penalty system (no _tgtt effects to double-count)", () => {
		// No exhaustion_tgtt: the dedicated exhaustion-level penalty (subtracted at roll
		// time) owns the d20 / spell-save-DC math; encoding it here would double-count.
		expect(CharacterSheetState.CONDITION_EFFECTS.exhaustion_tgtt).toBeUndefined();
		expect(CharacterSheetState.getConditionEffects("exhaustion", "TGTT").effects).toEqual([]);
	});
});

// =============================================================================
// #11 — Intransigent: conscious-gated, source-aware charmed immunity + chooser
// =============================================================================
describe("#11 Intransigent charmed immunity is conscious-gated and source-aware", () => {
	it("a 'while conscious' condition immunity applies when conscious and drops at 0 HP", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while conscious");

		expect(state.isImmuneToCondition("charmed")).toBe(true);

		state._data.hp.current = 0; // unconscious
		expect(state.isUnconscious()).toBe(true);
		expect(state.isImmuneToCondition("charmed")).toBe(false);

		state._data.hp.current = state._data.hp.max; // conscious again
		expect(state.isImmuneToCondition("charmed")).toBe(true);
	});

	it("an unconditional source keeps the immunity active even while unconscious (multi-source safety)", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while conscious"); // Intransigent
		state._addClassFeatureConditionImmunity("charmed", null); // e.g. an ungated source

		state._data.hp.current = 0;
		expect(state.isImmuneToCondition("charmed")).toBe(true);
	});

	it("drops a 'while conscious' immunity under the Unconscious condition even at positive HP", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while conscious");

		expect(state.isImmuneToCondition("charmed")).toBe(true); // conscious, full HP

		state.addCondition("unconscious"); // e.g. magical sleep — HP still > 0
		expect(state.isUnconscious()).toBe(false); // HP-based check is false...
		expect(state.hasCondition("unconscious")).toBe(true); // ...but the condition is present
		expect(state.isImmuneToCondition("charmed")).toBe(false);
	});

	it("non-conscious conditionals (e.g. 'while raging') keep applying unconditionally", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while raging");

		state._data.hp.current = 0;
		expect(state.isImmuneToCondition("charmed")).toBe(true);
	});

	it("an unrelated unconditioned immunity is unaffected by the conscious gate", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("poisoned");
		state._data.hp.current = 0;
		expect(state.isImmuneToCondition("poisoned")).toBe(true);
	});

	it("condition-immunity metadata is reset when class features are torn down", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while conscious");
		expect((state._data._conditionImmunityMeta || []).length).toBe(1);

		state._clearClassFeatureEffects();
		expect((state._data._conditionImmunityMeta || []).length).toBe(0);
		expect(state.isImmuneToCondition("charmed")).toBe(false);
	});
});

describe("#11 Intransigent ally-count chooser drives the feature summary", () => {
	it("stores a non-negative ally count only when the character has Intransigent", () => {
		const state = makeBaseCharacter();
		// No Intransigent → setter is a no-op (stale choices never linger).
		expect(state.setIntransigentAllyCount(4)).toBe(0);
		expect(state.getIntransigentAllyCount()).toBe(0);

		// Stub the calc gate to emulate a level-11 Hellspeaker.
		state.getFeatureCalculations = () => ({hasIntransigent: true});
		expect(state.setIntransigentAllyCount(3)).toBe(3);
		expect(state.getIntransigentAllyCount()).toBe(3);
		expect(state.setIntransigentAllyCount(-2)).toBe(0); // clamps negatives
		expect(state.setIntransigentAllyCount(2.7)).toBe(2); // floors fractions
	});

	it("renders a dynamic, conscious-gated summary that reflects the ally count", () => {
		const calcs = {hasIntransigent: true, intransigentRange: 10};
		const summaryFn = CharacterSheetState.ILLRIGGER_FEATURE_SUMMARIES.intransigent;

		const self0 = {getIntransigentAllyCount: () => 0};
		expect(summaryFn(calcs, self0)).toBe("You are immune to charmed (while conscious); may extend to creatures of your choice within 10 ft");

		const self1 = {getIntransigentAllyCount: () => 1};
		expect(summaryFn(calcs, self1)).toBe("You + 1 chosen creature within 10 ft are immune to charmed (while conscious)");

		const self3 = {getIntransigentAllyCount: () => 3};
		expect(summaryFn(calcs, self3)).toBe("You + 3 chosen creatures within 10 ft are immune to charmed (while conscious)");
	});
});

// =============================================================================
// #7 — Thelemar condition resolver: abilities APPLY the Thelemar variant
//      (identity, not just effects), and feature TEXT links/hovers the Thelemar
//      condition rather than the 2014/2024 one.
// =============================================================================
describe("#7 Thelemar condition identity resolver (mechanical application)", () => {
	it("getThelemarConditionVariant returns the _tgtt def only when it exists", () => {
		expect(CharacterSheetState.getThelemarConditionVariant("invisible")?.source).toBe("TGTT");
		expect(CharacterSheetState.getThelemarConditionVariant("Invisible")?.name).toBe("Invisible");
		expect(CharacterSheetState.getThelemarConditionVariant("prone")?.source).toBe("TGTT");
		// No variant for these — must NOT be invented.
		expect(CharacterSheetState.getThelemarConditionVariant("charmed")).toBeNull();
		expect(CharacterSheetState.getThelemarConditionVariant("exhaustion")).toBeNull();
		expect(CharacterSheetState.getThelemarConditionVariant("")).toBeNull();
	});

	it("a Thelemar character self-applying Invisible BY NAME stores the Thelemar identity (name+source)", () => {
		const state = makeThelemarCharacter();
		// How abilities self-apply (string name / no explicit source: addsConditions,
		// spell & play-mode buttons).
		state.addCondition("Invisible");

		const stored = state.getConditions().find(c => c.name.toLowerCase() === "invisible");
		expect(stored).toBeTruthy();
		expect(stored.source).toBe("TGTT"); // identity, not just effects

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "invisible");
		expect(active.conditionSource).toBe("TGTT");
		// Effects are the Thelemar variant (Hidden-to-sight note present).
		expect(active.customEffects.some(e => e.type === "note" && /hidden/i.test(e.value || ""))).toBe(true);
	});

	it("the resolved Thelemar condition removes cleanly when removed BY NAME (source agreement)", () => {
		const state = makeThelemarCharacter();
		state.addCondition("Frightened");
		expect(state.hasCondition("frightened")).toBe(true);
		// Removal paths (rest, play mode) pass a bare name — must still match the
		// stored Thelemar-sourced condition.
		state.removeCondition("Frightened");
		expect(state.hasCondition("frightened")).toBe(false);
		expect(state._data.activeStates.some(s => s.isCondition && s.conditionName.toLowerCase() === "frightened")).toBe(false);
	});

	it("a combat action self-applying a condition resolves the Thelemar identity via the option", () => {
		const state = makeThelemarCharacter();
		// Combat self-conditions carry the granting feature's NAME as source.
		const added = state.addCondition({name: "Invisible", source: "Veil of Lies"}, {resolveThelemarVariant: true});
		expect(added).toBe(true);
		const stored = state.getConditions().find(c => c.name.toLowerCase() === "invisible");
		expect(stored.source).toBe("TGTT");
	});

	it("conditions without a Thelemar variant keep their given identity (charmed stays generic)", () => {
		const state = makeThelemarCharacter();
		state.addCondition("Charmed");
		const stored = state.getConditions().find(c => c.name.toLowerCase() === "charmed");
		expect(stored.source).not.toBe("TGTT"); // no charmed_tgtt → not remapped
	});

	it("explicit-source callers (Add Condition modal) are respected, not overridden", () => {
		const state = makeThelemarCharacter();
		// Modal passes a deliberately chosen source object.
		state.addCondition({name: "Invisible", source: "XPHB"});
		const stored = state.getConditions().find(c => c.name.toLowerCase() === "invisible");
		expect(stored.source).toBe("XPHB");
	});

	it("non-Thelemar characters are never remapped (no leak)", () => {
		const state = makeBaseCharacter();
		state.addCondition("Invisible");
		const stored = state.getConditions().find(c => c.name.toLowerCase() === "invisible");
		expect(stored.source).not.toBe("TGTT");
	});
});

describe("#7 Thelemar feature-text rewrite (display / hover)", () => {
	it("thelemarizeConditionTags promotes bare {@condition X} only for conditions with a Thelemar variant", () => {
		const out = CharacterSheetState.thelemarizeConditionTags([
			"You become {@condition invisible} and your foe is {@condition poisoned}.",
			{type: "entries", entries: ["The target is {@condition charmed} and {@condition prone}."]},
		]);
		const flat = JSON.stringify(out);
		expect(flat).toContain("{@condition invisible|TGTT}");
		expect(flat).toContain("{@condition poisoned|TGTT}");
		expect(flat).toContain("{@condition prone|TGTT}");
		// charmed has no Thelemar variant → untouched.
		expect(flat).toContain("{@condition charmed}");
		expect(flat).not.toContain("{@condition charmed|TGTT}");
	});

	it("already-sourced condition tags are left untouched (idempotent)", () => {
		const input = "Already {@condition incapacitated|tgtt} and {@condition invisible|xphb}.";
		expect(CharacterSheetState.thelemarizeConditionTagString(input)).toBe(input);
	});

	it("thelemarizeConditionLinkHtml repoints a rendered condition link to the Thelemar variant", () => {
		// Mirrors a real cached description (Baleful Interdict) rendered to PHB.
		const html = `<p>become <a href="conditionsdiseases.html#invisible_phb" data-vet-page="conditionsdiseases.html" data-vet-source="PHB" data-vet-hash="invisible_phb">invisible</a></p>`;
		const out = CharacterSheetState.thelemarizeConditionLinkHtml(html);
		expect(out).toContain("conditionsdiseases.html#invisible_tgtt");
		expect(out).toContain(`data-vet-source="TGTT"`);
		expect(out).toContain(`data-vet-hash="invisible_tgtt"`);
		expect(out).not.toContain("invisible_phb");
	});

	it("thelemarizeConditionLinkHtml leaves variant-less condition links (charmed) alone", () => {
		const html = `<a href="conditionsdiseases.html#charmed_phb" data-vet-page="conditionsdiseases.html" data-vet-source="PHB" data-vet-hash="charmed_phb">charmed</a>`;
		expect(CharacterSheetState.thelemarizeConditionLinkHtml(html)).toBe(html);
	});

	it("the load migration rewrites both entries and the cached description for a Thelemar character", () => {
		const state = makeThelemarCharacter();
		// Feature with bare entries AND a stale PHB-rendered description (the real bug).
		state._data.features = [
			{
				name: "Veil of Lies",
				className: "Illrigger",
				entries: ["become {@condition invisible} for 10 minutes."],
				description: `<p>become <a href="conditionsdiseases.html#invisible_phb" data-vet-page="conditionsdiseases.html" data-vet-source="PHB" data-vet-hash="invisible_phb">invisible</a></p>`,
			},
			// Description-only feature (no entries) — must still be HTML-rewritten.
			{
				name: "Baleful Interdict",
				className: "Illrigger",
				description: `<a href="conditionsdiseases.html#incapacitated_phb" data-vet-page="conditionsdiseases.html" data-vet-source="PHB" data-vet-hash="incapacitated_phb">incapacitated</a>`,
			},
			// Variant-less reference — must be untouched.
			{name: "Charm Enemy", className: "Illrigger", entries: ["the target is {@condition charmed}."]},
		];

		state._migrateThelemarConditionTags();

		expect(JSON.stringify(state._data.features[0].entries)).toContain("{@condition invisible|TGTT}");
		// The cached description is refreshed: re-rendered from the rewritten entries
		// when a Renderer is available, else HTML-rewritten in place. Either way it no
		// longer points at the stale PHB condition.
		expect(state._data.features[0].description).not.toContain("invisible_phb");
		expect(/invisible(_tgtt|\|TGTT)/i.test(state._data.features[0].description)).toBe(true);
		// Description-only feature has no entries to re-render → HTML rewriter repoints it.
		expect(state._data.features[1].description).toContain("incapacitated_tgtt");
		expect(JSON.stringify(state._data.features[2].entries)).toContain("{@condition charmed}");
		expect(JSON.stringify(state._data.features[2].entries)).not.toContain("TGTT");
	});

	it("the migration is a no-op for non-Thelemar characters", () => {
		const state = makeBaseCharacter();
		state._data.features = [{name: "F", entries: ["become {@condition invisible}."]}];
		state._migrateThelemarConditionTags();
		expect(JSON.stringify(state._data.features[0].entries)).toContain("{@condition invisible}");
		expect(JSON.stringify(state._data.features[0].entries)).not.toContain("TGTT");
	});

	it("re-applies after reconciliation re-syncs bare entries from source (Baleful Interdict clobber)", () => {
		const state = makeThelemarCharacter();
		state._data.features = [
			{name: "Veil of Lies", className: "Illrigger", entries: ["become {@condition invisible}."]},
		];
		// Load migration thelemarizes the entries.
		state._migrateThelemarConditionTags();
		expect(JSON.stringify(state._data.features[0].entries)).toContain("{@condition invisible|TGTT}");

		// Reconciliation re-syncs the feature from brew/source data, reintroducing the
		// generic tag. The post-reconcile re-apply must restore the TGTT variant.
		state._data.features[0].entries = ["become {@condition invisible}."];
		state._applyThelemarConditionTags();
		expect(JSON.stringify(state._data.features[0].entries)).toContain("{@condition invisible|TGTT}");
		expect(JSON.stringify(state._data.features[0].entries)).not.toMatch(/\{@condition invisible\}/);
	});

	it("_applyThelemarConditionTags is idempotent (stable across repeated calls)", () => {
		const state = makeThelemarCharacter();
		state._data.features = [
			{name: "Veil of Lies", className: "Illrigger", entries: ["become {@condition invisible}."]},
		];
		state._applyThelemarConditionTags();
		const once = JSON.stringify(state._data.features[0].entries);
		state._applyThelemarConditionTags();
		expect(JSON.stringify(state._data.features[0].entries)).toBe(once);
	});
});
