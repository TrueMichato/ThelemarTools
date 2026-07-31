import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLERIC_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../data/class/class-cleric.json"), "utf8"));

const DESCRIPTIONS = {
	"Warding Flare": "When a creature that you can see within 30 feet makes an attack roll, you can take a reaction to impose disadvantage. You can use this feature a number of times equal to your Wisdom modifier (minimum of once). You regain all expended uses when you finish a long rest.",
	"Radiance of the Dawn": "As a Magic action, expend a use of your Channel Divinity. Creatures make a Constitution save, taking 2d10 plus your Cleric level Radiant damage on a failed save or half on a success.",
	"Corona of Light": "As a Magic action, emit an aura for 1 minute. Enemies in the bright light have disadvantage on saves against Radiance of the Dawn and spells that deal Fire or Radiant damage. Uses equal your Wisdom modifier (minimum once), regained on a long rest.",
};

function getLightState (level, {source = "XPHB", wis = 16, addFeatures = true} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", wis);
	state.addClass({
		name: "Cleric",
		source,
		level,
		subclass: {name: "Light Domain", shortName: "Light", source},
	});
	if (!addFeatures) return state;
	if (level >= (source === "XPHB" ? 3 : 1)) {
		state.addFeature({
			name: "Warding Flare",
			source,
			className: "Cleric",
			classSource: source,
			subclassShortName: "Light",
			description: DESCRIPTIONS["Warding Flare"],
		});
	}
	if (source === "XPHB" && level >= 3) {
		state.addFeature({
			name: "Channel Divinity",
			source,
			className: "Cleric",
			classSource: source,
			uses: {max: 2, current: 2, recharge: "short"},
			description: "You can use Channel Divinity twice. Uses return on a short or long rest.",
		});
		state.addFeature({
			name: "Radiance of the Dawn",
			source,
			className: "Cleric",
			classSource: source,
			subclassShortName: "Light",
			consumes: {name: "Channel Divinity"},
			description: DESCRIPTIONS["Radiance of the Dawn"],
		});
	}
	if (source === "XPHB" && level >= 17) {
		state.addFeature({
			name: "Corona of Light",
			source,
			className: "Cleric",
			classSource: source,
			subclassShortName: "Light",
			description: DESCRIPTIONS["Corona of Light"],
		});
	}
	return state;
}

const findResource = (state, name) => state.getResources().find(it => it.name === name);
const findActivatable = (state, name) => state.getActivatableFeatures().find(it => it.feature.name === name);

describe("Light Domain (XPHB) — edition-correct mechanics", () => {
	it("does not grant 2024 Light features or the removed bonus cantrip before Cleric 3", () => {
		const calc = getLightState(2, {addFeatures: false}).getFeatureCalculations();
		expect(calc.hasWardingFlare).toBeFalsy();
		expect(calc.hasRadianceOfTheDawn).toBeFalsy();
		expect(calc.hasBonusLightCantrip).toBeFalsy();
	});

	it("preserves the PHB Light level-1 and level-2 progression", () => {
		const l1 = getLightState(1, {source: "PHB", addFeatures: false}).getFeatureCalculations();
		const l2 = getLightState(2, {source: "PHB", addFeatures: false}).getFeatureCalculations();
		expect(l1).toMatchObject({hasBonusLightCantrip: true, hasWardingFlare: true});
		expect(l1.hasRadianceOfTheDawn).toBeFalsy();
		expect(l2.hasRadianceOfTheDawn).toBe(true);
	});

	it("computes Radiance damage and save DC from Cleric level, Wisdom, and proficiency", () => {
		const calc = getLightState(9, {wis: 18, addFeatures: false}).getFeatureCalculations();
		expect(calc).toMatchObject({
			hasRadianceOfTheDawn: true,
			radianceOfTheDawnDamage: "2d10+9",
			radianceOfTheDawnSaveDc: 16,
		});
	});

	it("surfaces Radiance as a shared Channel Divinity ability without a parallel resource", () => {
		const state = getLightState(3);
		const ability = findActivatable(state, "Radiance of the Dawn");
		expect(ability.resource.name).toBe("Channel Divinity");
		expect(ability.activationInfo).toMatchObject({
			interactionMode: "limited",
			resourceName: "Channel Divinity",
			channelDivinityCost: 1,
		});
		expect(findResource(state, "Radiance of the Dawn")).toBeFalsy();
	});

	it("tracks Warding Flare as a Wisdom-sized reaction pool with the correct recharge upgrade", () => {
		const l3 = getLightState(3, {wis: 16});
		const l6 = getLightState(6, {wis: 16});
		expect(findResource(l3, "Warding Flare")).toMatchObject({max: 3, recharge: "long"});
		expect(findResource(l6, "Warding Flare")).toMatchObject({max: 3, recharge: "short"});
		expect(CharacterSheetState.detectActivatableFeature(l3.getFeatures().find(it => it.name === "Warding Flare")))
			.toMatchObject({interactionMode: "limited", activationAction: "reaction", stateTypeId: "wardingFlare"});
		expect(l6.getFeatureCalculations()).toMatchObject({
			hasImprovedFlare: true,
			improvedWardingFlareTempHp: "2d6+3",
		});
	});

	it("upgrades Warding Flare recharge when an existing level-3 character reaches Cleric 6", () => {
		const state = getLightState(3, {wis: 16});
		state._data.classes[0].level = 6;
		state.recalculateResourceMaximums();

		expect(state.getFeature("Warding Flare").uses).toMatchObject({max: 3, recharge: "short"});
		expect(findResource(state, "Warding Flare")).toMatchObject({max: 3, recharge: "short"});
	});

	it("uses a minimum-one pool for Warding Flare and Corona with low Wisdom", () => {
		const state = getLightState(17, {wis: 8});
		expect(findResource(state, "Warding Flare").max).toBe(1);
		expect(findResource(state, "Corona of Light")).toMatchObject({max: 1, recharge: "long"});
	});

	it("activates Corona and applies save disadvantage only to eligible save effects", () => {
		const state = getLightState(17);
		const corona = findActivatable(state, "Corona of Light");
		expect(corona).toMatchObject({stateTypeId: "coronaOfLight", interactionMode: "toggle"});
		state.activateState("coronaOfLight");

		expect(state.hasCoronaOfLightRadianceDisadvantage()).toBe(true);
		expect(state.getCoronaOfLightSaveDisadvantage({
			savingThrow: ["dex"],
			damageInflict: ["fire"],
		})).toBe(true);
		expect(state.getCoronaOfLightSaveDisadvantage({
			savingThrow: ["con"],
			damageInflict: ["radiant", "necrotic"],
		})).toBe(true);
		expect(state.getCoronaOfLightSaveDisadvantage({
			savingThrow: ["wis"],
			damageInflict: ["psychic"],
		})).toBe(false);
		expect(state.getCoronaOfLightSaveDisadvantage({
			damageInflict: ["fire"],
		})).toBe(false);

		state.deactivateState("coronaOfLight");
		expect(state.hasCoronaOfLightRadianceDisadvantage()).toBe(false);
	});

	it("expands the real XPHB level-3 wrapper into rich, actionable child features idempotently", () => {
		const state = getLightState(3, {addFeatures: false});
		state.addFeature({
			name: "Light Domain",
			source: "XPHB",
			level: 3,
			className: "Cleric",
			classSource: "XPHB",
			subclassShortName: "Light",
			subclassSource: "XPHB",
			isSubclassFeature: true,
			description: "",
		});
		state.setClassFeatureCatalog(CLERIC_DATA.classFeature || [], CLERIC_DATA.subclassFeature || []);

		expect(state.reconcileSubclassFeatureEntries()).toBeGreaterThan(0);
		for (const name of ["Light Domain Spells", "Radiance of the Dawn", "Warding Flare"]) {
			const feature = state.getFeatures().find(it => it.name === name);
			expect(feature).toBeTruthy();
			expect(feature.entries?.length).toBeGreaterThan(0);
			expect(feature.description).toBeTruthy();
		}
		expect(findActivatable(state, "Radiance of the Dawn")).toBeTruthy();
		expect(CharacterSheetState.detectActivatableFeature(state.getFeatures().find(it => it.name === "Warding Flare")))
			.toMatchObject({activationAction: "reaction"});
		expect(state.reconcileSubclassFeatureEntries()).toBe(0);
		expect(state.getFeatures().filter(it => it.name === "Warding Flare")).toHaveLength(1);
	});
});
