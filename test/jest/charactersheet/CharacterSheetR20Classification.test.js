/**
 * R20 Foundation — Feature classification & activation framework (bugs #5, #4, #1, #6, #17).
 *
 * Reference character: Hochling Illrigger (Hellspeaker). Asserts the FOUR-bucket
 * classification (ACTIVE-STATE toggle / RESOURCE pool / ABILITY clickable+hoverable /
 * passive) and the headless activation payloads — via the activatable API and the pure
 * helpers, never trivial level counts:
 *
 *  - Divine Manifestation + Invoke Hell wrappers are PASSIVE (not activatable, no resource).
 *  - Invoke Hell options (`consumes: {name: "Invoke Hell"}`) are ABILITIES that share ONE pool.
 *  - Race-manifestation children (`_raceManifestation`) classify generically as ABILITIES;
 *    Guided Strike's +10 is the only name-keyed effect (buildGuidedStrikeApplication).
 *  - Healing Hands stays a limited-use ABILITY; calculateHealingHandsHealing rolls PB×d4.
 *  - Baleful Interdict + Forked Tongue classify as ABILITIES (not toggles, not null).
 *  - refSubclassFeature expansion preserves the `consumes` marker.
 *  - Regression: real toggles (Rage, Bladesong) stay toggles.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// ---- Fixtures mirroring the IllriggerRevised homebrew shapes ----------------

const INVOKE_HELL_CLASS = {
	name: "Invoke Hell",
	source: "IllriggerRevised",
	className: "Illrigger",
	classSource: "IllriggerRevised",
	level: 3,
	featureType: "Class",
	description: "<p>Your diabolic connection allows you to channel infernal energy. Your chosen diabolic contract grants you two Invoke Hell options. When you use your Invoke Hell, you choose which option to use. You must then finish a short or long rest to use your Invoke Hell again.</p>",
	entries: ["Your diabolic connection allows you to channel infernal energy."],
};

const INVOKE_HELL_SUB = {
	name: "Invoke Hell",
	source: "IllriggerRevised",
	className: "Illrigger",
	classSource: "IllriggerRevised",
	subclassShortName: "Hellspeaker",
	subclassSource: "IllriggerRevised",
	level: 3,
	featureType: "Class",
	description: "<p>You gain the following two Invoke Hell options.</p>",
	entries: ["You gain the following two Invoke Hell options:"],
};

// An Invoke Hell option exactly as expanded from refSubclassFeature: entries + consumes,
// no rendered `description`.
const HONEY_SWEET = {
	name: "Honey-Sweet Blades",
	source: "IllriggerRevised",
	className: "Illrigger",
	classSource: "IllriggerRevised",
	subclassShortName: "Hellspeaker",
	subclassSource: "IllriggerRevised",
	level: 3,
	consumes: {name: "Invoke Hell"},
	entries: ["When you make a weapon attack against an interdicted creature, you can gain advantage on that attack (no action required). If the attack hits, it becomes a critical hit."],
};

const TURNCOAT = {
	name: "Turncoat",
	source: "IllriggerRevised",
	className: "Illrigger",
	classSource: "IllriggerRevised",
	subclassShortName: "Hellspeaker",
	subclassSource: "IllriggerRevised",
	level: 3,
	consumes: {name: "Invoke Hell"},
	entries: ["As an action, you wield your manipulative tongue. You choose a number of enemy creatures up to your proficiency bonus within 60 feet who can hear you. Each must succeed on a Charisma saving throw or use their reaction to make a weapon attack against a target of your choice."],
};

const DIVINE_MANIFESTATION = {
	name: "Divine Manifestation",
	source: "TGTT",
	featureType: "Species",
	level: 1,
	description: "<p>Choose a divine domain that manifests through you. You gain features as you level up based on your choice.</p>",
};

const GUIDED_STRIKE = CharacterSheetClassUtils.getRaceManifestationFeatures().war[0];

const BALEFUL_INTERDICT = {
	name: "Baleful Interdict",
	source: "IllriggerRevised",
	className: "Illrigger",
	classSource: "IllriggerRevised",
	level: 1,
	featureType: "Class",
	description: "<p>You gain the ability to censure creatures with the power of Hell. Once on your turn, you can place a magical seal on a creature within 30 feet of you.</p>",
};

const FORKED_TONGUE = {
	name: "Forked Tongue",
	source: "IllriggerRevised",
	className: "Illrigger",
	classSource: "IllriggerRevised",
	level: 1,
	featureType: "Class",
	description: "<p>Your honeyed words drip with infernal magic. You learn two additional languages, and you can magically swap one of them when you finish a long rest.</p>",
};

function detect (feature) { return CharacterSheetState.detectActivatableFeature(feature); }

// ============================================================================
describe("R20 — wrappers are passive (#4 Divine Manifestation, #17 Invoke Hell)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("Divine Manifestation wrapper is NOT activatable", () => {
		expect(detect(DIVINE_MANIFESTATION)).toBeNull();
	});

	test("Invoke Hell wrappers (class + subclass granter) are NOT activatable", () => {
		expect(detect(INVOKE_HELL_CLASS)).toBeNull();
		expect(detect(INVOKE_HELL_SUB)).toBeNull();
	});

	test("wrappers never mint their own resource (no bare resource row)", () => {
		state.addFeature(DIVINE_MANIFESTATION);
		state.addFeature(INVOKE_HELL_CLASS);
		state.addFeature(INVOKE_HELL_SUB);
		const names = state.getResources().map(r => r.name);
		expect(names).not.toContain("Divine Manifestation");
		expect(names).not.toContain("Invoke Hell");
	});

	test("wrappers do not surface in the generic Available-to-Activate list", () => {
		state.addFeature(DIVINE_MANIFESTATION);
		state.addFeature(INVOKE_HELL_CLASS);
		state.addFeature(INVOKE_HELL_SUB);
		const surfaced = state.getActivatableFeatures().map(a => a.feature?.name);
		expect(surfaced).not.toContain("Divine Manifestation");
		expect(surfaced).not.toContain("Invoke Hell");
	});
});

// ============================================================================
describe("R20 — Invoke Hell options are abilities sharing one pool (#17)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("an option (consumes: Invoke Hell) classifies as a limited-use ABILITY, not a toggle", () => {
		const info = detect(HONEY_SWEET);
		expect(info).not.toBeNull();
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("limited");
		expect(info.resourceName).toBe("Invoke Hell");
		expect(info.resourceCost).toBe(1);
	});

	test("an option classifies even when it carries only entries (no rendered description)", () => {
		expect(HONEY_SWEET.description).toBeUndefined();
		const info = detect(HONEY_SWEET);
		expect(info?.interactionMode).toBe("limited");
	});

	test("both options link to the SAME shared Invoke Hell pool and spending one depletes both", () => {
		state.addResource({name: "Invoke Hell", max: 1, current: 1, recharge: "short"});
		state.addFeature(HONEY_SWEET);
		state.addFeature(TURNCOAT);

		const acts = state.getActivatableFeatures();
		const honey = acts.find(a => a.feature.name === "Honey-Sweet Blades");
		const turn = acts.find(a => a.feature.name === "Turncoat");
		expect(honey?.resource?.name).toBe("Invoke Hell");
		expect(turn?.resource?.name).toBe("Invoke Hell");

		// Spending via the shared pool affects both options (one pool, not two).
		expect(state.useResourceCharge("Invoke Hell", 1)).toBe(true);
		const after = state.getActivatableFeatures();
		expect(after.find(a => a.feature.name === "Honey-Sweet Blades").resource.current).toBe(0);
		expect(after.find(a => a.feature.name === "Turncoat").resource.current).toBe(0);
	});

	test("options never mint their own per-option resource (e.g. Turncoat's 'proficiency bonus' text)", () => {
		state.addFeature(HONEY_SWEET);
		state.addFeature(TURNCOAT);
		const names = state.getResources().map(r => r.name);
		expect(names).not.toContain("Honey-Sweet Blades");
		expect(names).not.toContain("Turncoat");
	});

	test("ensureInvokeHellPool creates one short-rest pool sized to invokeHellUses", () => {
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 3});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasInvokeHell).toBe(true);
		state.ensureInvokeHellPool();
		const pools = state.getResources().filter(r => r.name === "Invoke Hell");
		expect(pools).toHaveLength(1);
		expect(pools[0].max).toBe(calcs.invokeHellUses);
		expect(pools[0].recharge).toBe("short");
	});
});

// ============================================================================
describe("R20 — Invoke Hell option detection holds for entries-only options (S2 contract)", () => {
	test("a consumes-bearing option with only entries detects and links to the shared pool", () => {
		// Mirrors what refSubclassFeature expansion now yields: entries + preserved consumes.
		const option = {
			name: "Honey-Sweet Blades",
			level: 3,
			subclassShortName: "Hellspeaker",
			subclassSource: "IllriggerRevised",
			consumes: {name: "Invoke Hell"},
			entries: ["When you make a weapon attack against an interdicted creature, you can gain advantage."],
		};
		const info = detect(option);
		expect(info?.resourceName).toBe("Invoke Hell");
		expect(info?.interactionMode).toBe("limited");
	});
});

// ============================================================================
describe("R20 — race-manifestation children classify generically (#5/#6, S2 contract)", () => {
	test("Guided Strike (synth _raceManifestation child) is a limited-use ABILITY, not a toggle", () => {
		const info = detect(GUIDED_STRIKE);
		expect(info).not.toBeNull();
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("limited");
		// Has its own 1/short pool.
		expect(info.resourceName).toBe("Guided Strike");
	});

	test("a NEW (future S2) manifestation option classifies as an ABILITY with no extra work", () => {
		const future = {
			name: "Tempest Surge",
			source: "TGTT",
			featureType: "Species",
			level: 1,
			_raceManifestation: "tempest",
			uses: {max: 1, recharge: "short"},
			description: "When you take lightning damage, you can use your Channel Divinity to gain resistance.",
		};
		const info = detect(future);
		expect(info?.interactionMode).toBe("limited");
		expect(info?.isToggle).toBe(false);
		expect(info?.resourceName).toBe("Tempest Surge");
	});

	test("buildGuidedStrikeApplication applies +10 to an attack roll's total", () => {
		const app = CharacterSheetState.buildGuidedStrikeApplication(13);
		expect(app.bonus).toBe(10);
		expect(app.previousTotal).toBe(13);
		expect(app.newTotal).toBe(23);
		expect(app.used).toBe(true);
	});

	test("buildGuidedStrikeApplication tolerates a missing/NaN prior total", () => {
		const app = CharacterSheetState.buildGuidedStrikeApplication(undefined);
		expect(app.previousTotal).toBe(0);
		expect(app.newTotal).toBe(10);
	});
});

// ============================================================================
describe("R20 — Healing Hands heals PB×d4 (#1)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("classification is unchanged: a limited-use ABILITY resource (not a toggle)", () => {
		const feature = {name: "Healing Hands", description: "<p>As an action, touch a creature and roll d4s equal to your proficiency bonus to heal it. Once per long rest.</p>", uses: {current: 1, max: 1, recharge: "long"}};
		const info = detect(feature);
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("limited");
		expect(info.resourceName).toBe("Healing Hands");
	});

	test("calculateHealingHandsHealing rolls PB four-sided dice with a plausible total", () => {
		state.addClass({name: "Cleric", source: "XPHB", level: 3}); // PB = 2
		const pb = state.getProficiencyBonus();
		const heal = state.calculateHealingHandsHealing();
		expect(heal.pb).toBe(pb);
		expect(heal.dice).toBe(`${pb}d4`);
		expect(heal.rolls).toHaveLength(pb);
		expect(heal.total).toBeGreaterThanOrEqual(pb); // min 1 per die
		expect(heal.total).toBeLessThanOrEqual(pb * 4); // max 4 per die
		heal.rolls.forEach(r => { expect(r).toBeGreaterThanOrEqual(1); expect(r).toBeLessThanOrEqual(4); });
	});

	test("applying the rolled healing to self adds HP (capped at max)", () => {
		state.addClass({name: "Cleric", source: "XPHB", level: 3});
		state.setHp(5, 30);
		const heal = state.calculateHealingHandsHealing();
		const hp = state.getHp();
		const newHp = Math.min(hp.max, hp.current + heal.total);
		state.setHp(newHp, hp.max);
		expect(state.getHp().current).toBe(newHp);
		expect(state.getHp().current).toBeGreaterThan(5);
	});
});

// ============================================================================
describe("R20 — Baleful Interdict & Forked Tongue classify as abilities", () => {
	test("Baleful Interdict is a limited-use ABILITY (not a toggle, not null)", () => {
		const info = detect(BALEFUL_INTERDICT);
		expect(info).not.toBeNull();
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("limited");
	});

	test("Baleful Interdict surfaces in the activatable list and links to its seal pool", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		state.addFeature(BALEFUL_INTERDICT);
		const act = state.getActivatableFeatures().find(a => a.feature.name === "Baleful Interdict");
		expect(act).toBeTruthy();
		expect(act.interactionMode).toBe("limited");
		expect(act.resource?.name).toBe("Baleful Interdict");
	});

	test("Forked Tongue is a clickable ABILITY with no use pool of its own", () => {
		const info = detect(FORKED_TONGUE);
		expect(info).not.toBeNull();
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("limited");
		expect(info.resourceName).toBeNull();
	});
});

// ============================================================================
describe("R20 — regression: real sustained toggles stay toggles", () => {
	test("Rage classifies as a toggle", () => {
		const info = detect({name: "Rage", description: "<p>As a bonus action you can enter a rage for 1 minute. While raging you gain benefits.</p>", uses: {max: 3}});
		expect(info?.isToggle).toBe(true);
	});

	test("Bladesong classifies as a toggle", () => {
		const info = detect({name: "Bladesong", description: "<p>As a bonus action you start your Bladesong for 1 minute. While active you gain bonuses.</p>", uses: {max: 2}});
		expect(info?.isToggle).toBe(true);
	});
});
