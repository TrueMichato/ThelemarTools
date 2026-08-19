/**
 * Condensate affinities reach the Actions hub.
 *
 * An elemental condensate's affinity is the whole statement of what the substance does, and
 * until now it lived only in the item-info modal. Two things are pinned here.
 *
 * **The dormant case is the point.** An affinity is scoped to one role, so a Smokestone mace
 * has no smoke cloud. The sheet used to express that by showing nothing at all — which is
 * indistinguishable from the material being broken, and is exactly how a player concludes the
 * homebrew "doesn't work". The card is now emitted either way and says which it is, in words.
 *
 * **Five affinities named an action cost in prose that was never encoded.** Smokestone already
 * paired its affinity with a structured `grantsAction`; Sunprism, Ashglass, Tideglass and
 * Stormprism did not, so their Reactions and Magic action were unreachable. They are now
 * authored the same way, which means they flow through the existing granted-action machinery
 * with no new code path. Mineralite and Deathglass are authored deliberately WITHOUT an
 * `actionType`, because their cost is a minute of contact and a stored charge rather than an
 * action — so they render as honestly reference-only instead of as buttons that pretend.
 *
 * Voidglass is the one that changed from prose to arithmetic: it promised Advantage on Stealth
 * and delivered nothing, because the authoring vocabulary had no way to scope a check advantage
 * to a single skill. It does now.
 */

import {describe, expect, it, beforeEach} from "@jest/globals";
import {readFileSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;
const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BREW = JSON.parse(readFileSync(join(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const CATALOG = BREW.itemMaterial;

const getMaterial = name => CATALOG.find(it => it.name === name);

const makeState = () => {
	const st = new CharacterSheetState();
	st.addClass({name: "Wizard", source: "PHB", level: 5});
	st.setItemMaterialCatalog(CATALOG);
	return st;
};

const addMaterialItem = (st, {name, materialName, type = "M", equipped = true, ...rest}) => {
	st.addItem({quantity: 1, name, source: "TGTT", type, weapon: type === "M" || type === "R", ...rest});
	const id = st.getItems().slice(-1)[0].id;
	if (materialName) st.setItemMaterial(id, getMaterial(materialName));
	const raw = st._data.inventory.find(it => it.id === id);
	if (raw) raw.equipped = equipped;
	st._recalculateEquipmentModifiers();
	return id;
};

const affinityCard = st => st.getItemPowers().find(p => p.materialAffinity);
const materialPowers = st => st.getItemPowers().filter(p => p.materialPower);

describe("Every condensate publishes its affinity", () => {
	const condensates = CATALOG.filter(m => (m.effects || []).some(e => e.type === "condensateAffinity"));

	it("finds all 18 condensates in the brew", () => {
		expect(condensates.length).toBe(18);
	});

	it.each(condensates.map(m => [m.name]))("surfaces an affinity card for %s", materialName => {
		const st = makeState();
		addMaterialItem(st, {name: `${materialName} Focus`, materialName, type: "SCF"});
		const card = affinityCard(st);
		expect(card).toBeTruthy();
		expect(card.name).toBe(`${materialName} Affinity`);
		expect(card.description.length).toBeGreaterThan(0);
	});

	it.each(condensates.map(m => [m.name]))("marks %s's affinity reference-only, never a fake button", materialName => {
		const st = makeState();
		addMaterialItem(st, {name: `${materialName} Focus`, materialName, type: "SCF"});
		expect(affinityCard(st).isReferenceOnly).toBe(true);
		expect(affinityCard(st).isAvailable).toBe(false);
	});
});

describe("A dormant affinity says so, rather than vanishing", () => {
	it("is active on a focus, whose role Smokestone's affinity wants", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF"});
		const card = affinityCard(st);
		expect(card.isDormant).toBe(false);
		expect(card.unavailableReason).toBe("Rules reference only; resolve this effect manually.");
	});

	it("is dormant on a weapon, and still appears", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Smokestone Mace", materialName: "Smokestone"});
		const card = affinityCard(st);
		expect(card).toBeTruthy();
		expect(card.isDormant).toBe(true);
	});

	it("explains dormancy in words a player can act on", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Smokestone Mace", materialName: "Smokestone"});
		const reason = affinityCard(st).unavailableReason;
		expect(reason).toMatch(/^Dormant:/);
		expect(reason).toContain("focus");
		expect(reason).toContain("striking surface");
	});

	it("never leaks a camelCase role key into the sentence", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Smokestone Mace", materialName: "Smokestone"});
		expect(affinityCard(st).unavailableReason).not.toMatch(/strikingSurface|protectiveLayer/);
	});

	it("prefers the dormancy explanation over the generic equip prompt", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Smokestone Mace", materialName: "Smokestone", equipped: false});
		expect(affinityCard(st).unavailableReason).toMatch(/^Dormant:/);
	});

	it("does still ask an active-affinity item to be equipped", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", equipped: false});
		expect(affinityCard(st).unavailableReason).toBe("Equip this item to use its powers.");
	});

	it("omits affinity cards from the activeOnly view when unequipped", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Smokestone Orb", materialName: "Smokestone", type: "SCF", equipped: false});
		expect(st.getItemPowers({activeOnly: true}).filter(p => p.materialAffinity)).toEqual([]);
	});
});

describe("_formatMaterialRole", () => {
	it("renders each known role in words", () => {
		expect(CharacterSheetState._formatMaterialRole("strikingSurface")).toBe("striking surface");
		expect(CharacterSheetState._formatMaterialRole("protectiveLayer")).toBe("protective layer");
		expect(CharacterSheetState._formatMaterialRole("focus")).toBe("focus");
	});

	it("picks the right article", () => {
		expect(CharacterSheetState._formatMaterialRole("strikingSurface", {article: true})).toBe("a striking surface");
		expect(CharacterSheetState._formatMaterialRole("focus", {article: true})).toBe("a focus");
	});

	it("degrades gracefully on an unknown role", () => {
		expect(CharacterSheetState._formatMaterialRole("someNewRole")).toBe("some new role");
	});

	it("handles a missing role without producing 'undefined'", () => {
		expect(CharacterSheetState._formatMaterialRole(null)).toBe("another");
		expect(CharacterSheetState._formatMaterialRole(null, {article: true})).toBe("something else");
	});
});

describe("Affinities whose prose named an action cost now have one", () => {
	const cases = [
		["Sunprism", "Sunprism Outline", "action"],
		["Ashglass", "Ashglass Ward", "reaction"],
		["Tideglass", "Tideglass Slip", "reaction"],
		["Stormprism", "Stormprism Surge", "reaction"],
	];

	it.each(cases)("%s grants %s as a %s", (materialName, powerName, actionType) => {
		const st = makeState();
		// Tideglass's affinity is a protective layer, so it needs armour to be live.
		const isArmor = materialName === "Tideglass";
		addMaterialItem(st, {
			name: `${materialName} Kit`,
			materialName,
			type: isArmor ? "MA" : "SCF",
			...(isArmor ? {ac: 14} : {}),
		});
		const power = materialPowers(st).find(p => p.name === powerName);
		expect(power).toBeTruthy();
		expect(power.actionType).toBe(actionType);
		expect(power.isReferenceOnly).toBe(false);
		expect(power.isAvailable).toBe(true);
	});

	it("keeps them dormant in the wrong role, exactly like the affinity", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Sunprism Sword", materialName: "Sunprism"});
		expect(materialPowers(st).map(p => p.name)).not.toContain("Sunprism Outline");
	});
});

describe("Affinities with a cost that is not an action stay reference-only", () => {
	it.each([
		["Mineralite", "Mineralite Mending"],
		["Deathglass", "Deathglass Charge"],
	])("%s surfaces %s without pretending it is an action", (materialName, powerName) => {
		const st = makeState();
		const type = materialName === "Deathglass" ? "M" : "SCF";
		addMaterialItem(st, {name: `${materialName} Piece`, materialName, type});
		const power = materialPowers(st).find(p => p.name === powerName);
		expect(power).toBeTruthy();
		expect(power.isReferenceOnly).toBe(true);
		expect(power.unavailableReason).toBe("Rules reference only; resolve this effect manually.");
	});

	it("still carries Deathglass's full charge rule, dice included", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Deathglass Blade", materialName: "Deathglass"});
		const power = materialPowers(st).find(p => p.name === "Deathglass Charge");
		expect(power.description).toMatch(/2d6/);
		expect(power.description).toMatch(/necrotic/i);
	});
});

describe("Voidglass grants the Advantage it promised", () => {
	it("registers a Stealth-scoped advantage, not a blanket one", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Voidglass Charm", materialName: "Voidglass", type: "SCF"});
		const mods = st._data.namedModifiers.filter(m => m.sourceType === "itemMaterial");
		const stealth = mods.find(m => m.type === "skill:stealth");
		expect(stealth).toBeTruthy();
		expect(stealth.advantage).toBe(true);
		expect(mods.some(m => m.type === "check")).toBe(false);
	});

	it("gates it on the situation the rule names", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Voidglass Charm", materialName: "Voidglass", type: "SCF"});
		const stealth = st._data.namedModifiers.find(m => m.type === "skill:stealth");
		expect(stealth.conditional).toMatch(/moving quietly/i);
	});

	it("names the material and the item it came from", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Voidglass Charm", materialName: "Voidglass", type: "SCF"});
		const stealth = st._data.namedModifiers.find(m => m.type === "skill:stealth");
		expect(stealth.name).toContain("Voidglass");
		expect(stealth.sourceLabel).toBe("Voidglass Charm");
	});

	it("stays dormant in the wrong role", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Voidglass Sword", materialName: "Voidglass"});
		expect(st._data.namedModifiers.filter(m => m.sourceType === "itemMaterial" && m.type === "skill:stealth")).toEqual([]);
	});

	it("keeps an unscoped check advantage blanket, as Rootstone still needs", () => {
		const st = makeState();
		addMaterialItem(st, {name: "Rootstone Plate", materialName: "Rootstone", type: "HA", ac: 18});
		const mods = st._data.namedModifiers.filter(m => m.sourceType === "itemMaterial");
		expect(mods.some(m => m.type === "check" || m.type === "save")).toBe(true);
	});
});

describe("The normaliser carries the skill scope", () => {
	it("passes `skill` through from the authored effect", () => {
		const voidglass = getMaterial("Voidglass");
		const fx = CharacterSheetMaterials.getMaterialEffects({name: "Charm", type: "SCF"}, voidglass);
		const mod = fx.conditionalModifiers.find(m => m.skill);
		expect(mod?.skill).toBe("stealth");
	});

	it("leaves `skill` null when the author did not scope it", () => {
		const rootstone = getMaterial("Rootstone");
		const fx = CharacterSheetMaterials.getMaterialEffects({name: "Plate", type: "HA"}, rootstone);
		for (const mod of fx.conditionalModifiers) expect(mod.skill).toBeNull();
	});
});

/**
 * The Item Powers section grouped by `actionType` against a fixed list and dropped anything
 * else. Affinity cards are `special`, so they were computed, returned by `getItemPowers`, and
 * then silently discarded by the only surface that lists them — the same
 * computed-then-ignored failure this whole effort exists to remove.
 *
 * The renderer is DOM-bound and Jest runs without jsdom here, so this is pinned the same way
 * the picker legend is: against the source.
 */
describe("Item Powers renders every power it is given", () => {
	const combatSrc = readFileSync(join(__dirname, "../../../js/charactersheet/charactersheet-combat.js"), "utf8");
	const section = combatSrc.slice(combatSrc.indexOf("charsheet-combat-item-powers-section"));

	it("groups with an exhaustive fallback rather than filtering by actionType", () => {
		const body = section.slice(0, 2000);
		expect(body).toMatch(/grouped\.has\(power\.actionType\)\s*\?\s*power\.actionType\s*:\s*"other"/);
		// The old shape dropped anything unlisted.
		expect(body).not.toMatch(/powers\.filter\(power => power\.actionType === type\)/);
	});

	it("emits an actionType the section can place, for every affinity", () => {
		for (const mat of CATALOG.filter(m => (m.effects || []).some(fx => fx.type === "condensateAffinity"))) {
			const fx = CharacterSheetMaterials.getMaterialEffects({name: "Probe", type: "SCF"}, mat);
			if (!fx.condensate?.affinity) continue;
			expect(typeof fx.condensate.affinity).toBe("string");
		}
	});
});
