import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import "../../../js/charactersheet/charactersheet-companion-actor.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

globalThis.window = {addEventListener: jest.fn()};
String.prototype.escapeQuotes ||= function () { return this.replace(/"/g, "&quot;"); };
const createdElements = [];
const createElement = globalThis.e_;
globalThis.e_ = options => {
	const element = createElement(options);
	if (options.click) element._handlers.click = options.click;
	createdElements.push(element);
	return element;
};
globalThis.UiUtil.getShowModal = () => { throw new Error("Provide a modal fixture."); };
await import("../../../js/charactersheet/charactersheet.js");

const State = globalThis.CharacterSheetState;
const Page = globalThis.CharacterSheetPage;
const Runtime = globalThis.CharacterSheetCompanionActor;
const catalog = JSON.parse(fs.readFileSync("data/spells/spells-phb.json", "utf8")).spell;
const spell = name => MiscUtil.copyFast(catalog.find(it => it.name === name));

function fixture (source = "PHB", {extraSpells = [], className = "Wizard", classSource = "PHB", level = 7, beforeSnapshot = () => {}} = {}) {
	const owner = new State();
	owner._data.id = "original";
	owner.setName("Original");
	owner.addClass({name: className, source: classSource, level});
	owner.setAbilityBase("int", 18);
	owner.setHp(30, 60);
	owner.calculateSpellSlots();
	for (const name of ["Shield", "Mage Armor", "Bless", "Fire Bolt", ...extraSpells]) {
		const data = spell(name);
		owner.addSpell({...data, ritual: !!data.meta?.ritual, sourceClass: className, sourceClassSource: classSource, prepared: true}, true);
	}
	beforeSnapshot(owner);
	const prepared = owner.prepareSimulacrumSnapshot({spellSource: source});
	expect(prepared.ok).toBe(true);
	const id = owner.addCompanion(prepared.companionData);
	const page = Object.create(Page.prototype);
	page._state = owner;
	page.getState = () => page._state;
	page.getSpells = () => catalog;
	page.saveCharacter = jest.fn(async () => true);
	page.pAnimateDiceSpec = jest.fn(async () => {});
	page.pAnimateD20 = jest.fn(async () => {});
	page.pAnimateDamageDice = jest.fn(async () => {});
	page._rollHistory = {addRoll: jest.fn()};
	const hydration = Runtime.hydrate({ownerPage: page, companionId: id});
	expect(hydration.ok).toBe(true);
	return {owner, page, id, runtime: hydration.runtime};
}

const idOf = (runtime, name) => runtime.getState().getSpells().find(it => it.name === name).id;
const castOptions = {withMetamagic: false, decision: {autoSlot: true, castAsRitual: false}};

describe("isolated companion casting runtime", () => {
	afterEach(() => jest.restoreAllMocks());

	it("casts real Shield with actor-only AC/slot changes and round-trips the spent snapshot", async () => {
		const {owner, page, id, runtime} = fixture();
		const before = owner.getAc();
		const actorAc = runtime.getState().getAc();
		const slots = runtime.getState().getSpellSlotsCurrent(1);
		const receipt = await runtime.castSpell(idOf(runtime, "Shield"), castOptions);
		expect(runtime.getState().getAc()).toBe(actorAc + 5);
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(slots - 1);
		expect(owner.getAc()).toBe(before);
		expect(owner.getSpellSlotsCurrent(1)).toBe(slots);
		expect(receipt.actorId).toBe(runtime.getActorId());
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		const restored = new State();
		restored.loadFromJson(owner.toJson());
		const actor = restored.hydrateCompanionActor(id).actor;
		expect(actor.getSpellSlotsCurrent(1)).toBe(slots - 1);
		expect(actor.getAc()).toBe(actorAc + 5);
	});

	it("casts a real innate Shield through the same actor effect/receipt path without using ordinary slots", async () => {
		const {owner, runtime} = fixture("PHB", {
			beforeSnapshot: owner => owner.addInnateSpell({...spell("Shield"), uses: 2, recharge: "long"}),
		});
		const innate = runtime.getState().getInnateSpells()[0];
		const ac = runtime.getState().getAc();
		const receipt = await runtime.castInnateSpell(innate.id);
		expect(receipt).toMatchObject({actorId: runtime.getActorId(), castType: "innate"});
		expect(runtime.getState().getInnateSpells()[0].uses.current).toBe(1);
		expect(owner.getInnateSpells()[0].uses.current).toBe(2);
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(4);
		expect(runtime.getState().getAc()).toBe(ac + 5);
	});

	it("casts an actual ritual with actor-owned concentration and no slot spend", async () => {
		const {owner, runtime} = fixture("PHB", {extraSpells: ["Detect Magic"]});
		const receipt = await runtime.castRitual(idOf(runtime, "Detect Magic"));
		expect(receipt).toMatchObject({actorId: runtime.getActorId(), cast: {isRitual: true}});
		expect(runtime.getState().getConcentration()).toMatchObject({spellName: "Detect Magic", actorId: runtime.getActorId()});
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(4);
		expect(owner.isConcentrating()).toBe(false);
	});

	it("accepts explicitly supplied class tools without inventing inventory focus bonuses", async () => {
		const {runtime} = fixture("PHB", {className: "Artificer", classSource: "EFA"});
		const confirm = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(true);
		const receipt = await runtime.castSpell(idOf(runtime, "Shield"), castOptions);
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0][0].htmlDescription).toMatch(/tool|focus/i);
		expect(receipt).toMatchObject({actorId: runtime.getActorId(), focus: null, cast: {suppliedComponents: {confirmed: true}}});
		expect(runtime.getState().getItems()).toEqual([]);
	});

	it("keeps verbal/somatic restrictions while allowing legal actor-local Subtle Spell", async () => {
		const {owner, runtime} = fixture("PHB", {
			className: "Sorcerer",
			beforeSnapshot: owner => owner.addFeature({name: "Subtle Spell", source: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["MM"]}),
		});
		await runtime.run(actor => actor.addCondition("Silenced"));
		const slots = runtime.getState().getSpellSlotsCurrent(1);
		const points = runtime.getState().getSorceryPoints().current;
		await runtime.castSpell(idOf(runtime, "Shield"), castOptions);
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(slots);
		await runtime.castSpell(idOf(runtime, "Shield"), {
			...castOptions, decision: {...castOptions.decision, metamagic: {key: "subtle", name: "Subtle Spell"}},
		});
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(slots - 1);
		expect(runtime.getState().getSorceryPoints().current).toBe(points - 1);
		expect(owner.getSorceryPoints().current).toBe(points);
	});

	it("routes damage through the actual actor-bound Page concentration dialog", async () => {
		const {owner, runtime} = fixture("PHB", {extraSpells: ["Detect Magic"]});
		await runtime.castRitual(idOf(runtime, "Detect Magic"));
		owner.setConcentration({name: "Original concentration", source: "PHB", level: 1});
		createdElements.length = 0;
		jest.spyOn(UiUtil, "getShowModal").mockImplementation(options => ({
			eleModalInner: createElement({}), doClose: () => options.cbClose?.(),
		}));
		const hp = runtime.getState().getCurrentHp();
		const pending = runtime.takeDamage(2);
		void pending.catch(() => {});
		await Promise.resolve();
		const breakButton = createdElements.find(element => element._handlers.click && element.innerHTML.includes(">Break Concentration</button>"));
		expect(breakButton).toBeDefined();
		breakButton.click();
		await pending;
		expect(runtime.getState().getCurrentHp()).toBe(hp - 2);
		expect(runtime.getState().isConcentrating()).toBe(false);
		expect(owner.getConcentration().spellName).toBe("Original concentration");
	});

	it("routes actor-created companions to the owner roster with exact creator identity, not a nested tree", async () => {
		const {owner, runtime, id} = fixture();
		const originalFamiliar = owner.addCompanion({name: "Original Owl", type: "familiar", hp: {current: 1, max: 1}});
		await runtime.run(actor => {
			expect(actor.getCompanionsByType(State.COMPANION_TYPES.FAMILIAR)).toEqual([]);
			actor.addCompanion({name: "Actor Owl", type: "familiar", hp: {current: 1, max: 1}});
		});
		expect(owner.getCompanions().find(row => row.name === "Actor Owl")).toMatchObject({creatorActorId: runtime.getActorId()});
		expect(owner.getCompanion(id).actorSnapshot.state.companions).toEqual([]);
		owner.destroySimulacrum(id);
		expect(owner.getCompanions().some(row => row.name === "Actor Owl")).toBe(false);
		expect(owner.getCompanion(originalFamiliar)).not.toBeNull();
	});

	it("executes real Find Steed through the actor-bound Page picker without replacing the original's mount", async () => {
		const {owner, runtime} = fixture("PHB", {extraSpells: ["Find Steed"]});
		const originalMount = owner.addCompanion({name: "Original Mount", type: "mount", hp: {current: 10, max: 10}});
		jest.spyOn(InputUiUtil, "pGetUserEnum").mockResolvedValue("Warhorse");
		await runtime.castSpell(idOf(runtime, "Find Steed"), castOptions);
		expect(owner.getCompanions().find(row => row.name === "Warhorse")).toMatchObject({creatorActorId: runtime.getActorId()});
		expect(owner.getCompanion(originalMount)).not.toBeNull();
		expect(runtime.getState().getSpellSlotsCurrent(2)).toBe(2);
	});

	it("does not resurrect actor summons after destruction while persistence is pending", async () => {
		const {owner, runtime, page, id} = fixture();
		await runtime.run(actor => actor.addCompanion({name: "Actor summon", type: "summon", hp: {current: 1, max: 1}}));
		let rejectSave;
		page.saveCharacter.mockImplementation(() => new Promise(resolve => rejectSave = resolve));
		const pending = runtime.castSpell(idOf(runtime, "Shield"), castOptions);
		for (let turn = 0; turn < 40; turn++) {
			if (rejectSave) break;
			await Promise.resolve();
		}
		expect(rejectSave).toBeDefined();
		owner.destroySimulacrum(id);
		rejectSave(false);
		await expect(pending).rejects.toThrow(/could not be saved/);
		expect(owner.getCompanion(id).actorSnapshot.lifecycle).toBe("destroyed");
		expect(owner.getCompanions().some(row => row.name === "Actor summon")).toBe(false);
	});

	it("locks the same actor across independently hydrated controls and exposed spell-service entrypoints", async () => {
		const {page, id, runtime} = fixture();
		const second = Runtime.hydrate({ownerPage: page, companionId: id}).runtime;
		let resolve;
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockImplementation(() => new Promise(done => resolve = done));
		const service = runtime.getSpells();
		const pending = runtime.castSpell(idOf(runtime, "Mage Armor"), castOptions);
		await Promise.resolve();
		await expect(second.castSpell(idOf(second, "Shield"), castOptions)).rejects.toThrow(/in progress/);
		await expect(service._castSpell(idOf(runtime, "Shield"), castOptions)).rejects.toThrow(/in progress/);
		resolve(true);
		await pending;
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(3);
	});

	it("rolls back concentration-owned target cleanup when persistence fails", async () => {
		const {owner, page, runtime} = fixture("PHB", {extraSpells: ["Detect Magic"]});
		await runtime.castRitual(idOf(runtime, "Detect Magic"));
		owner.addActiveState("custom", {
			name: "Actor concentration effect",
			sourceFeatureId: "actor-effect",
			spellName: "Detect Magic",
			effectOwnerId: runtime.getActorId(),
			concentration: true,
			customEffects: [{type: "bonus", target: "ac", value: 2}],
		});
		const ac = owner.getAc();
		page.saveCharacter.mockResolvedValue(false);
		await expect(runtime.run(actor => actor.breakConcentration())).rejects.toThrow(/could not be saved/);
		expect(runtime.getState().isConcentrating()).toBe(true);
		expect(owner.getAc()).toBe(ac);
	});

	it("keeps same-level Pact and ordinary pools separate through actual snapshot casts and cancellation", async () => {
		const {runtime} = fixture("PHB", {
			beforeSnapshot: owner => {
				owner.addClass({name: "Warlock", source: "PHB", level: 1});
				owner.calculateSpellSlots();
			},
		});
		const options = {...castOptions, decision: {slotLevel: 1, isPact: true}};
		await runtime.castSpell(idOf(runtime, "Shield"), options);
		expect(runtime.getState().getPactSlots().current).toBe(0);
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(4);
		await runtime.castSpell(idOf(runtime, "Shield"), {...options, decision: {slotLevel: 1, isPact: false}});
		expect(runtime.getState().getPactSlots().current).toBe(0);
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(3);
		jest.spyOn(runtime._spells, "_showCastResult").mockResolvedValueOnce({cancelled: true});
		await runtime.castSpell(idOf(runtime, "Shield"), {...options, decision: {slotLevel: 1}});
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(3);
	});

	it("states the actual costly consumed material without substituting a focus or spending original gold", async () => {
		const {owner, runtime} = fixture("PHB", {extraSpells: ["Stoneskin"]});
		owner.setCurrency("gp", 500);
		const confirm = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(false);
		await runtime.castSpell(idOf(runtime, "Stoneskin"), castOptions);
		expect(confirm.mock.calls[0][0].htmlDescription).toMatch(/diamond dust/);
		expect(confirm.mock.calls[0][0].htmlDescription).toMatch(/100 gp/);
		expect(confirm.mock.calls[0][0].htmlDescription).toMatch(/consumed by this cast/);
		expect(confirm.mock.calls[0][0].htmlDescription).not.toMatch(/or an appropriate/);
		expect(owner.getCurrency("gp")).toBe(500);
		expect(runtime.getState().getSpellSlotsCurrent(4)).toBe(1);
	});

	it("applies an actual buff to a different managed actor and cleans it up on dismissal", async () => {
		const {owner, runtime, id} = fixture();
		const prepared = owner.prepareSimulacrumSnapshot({spellSource: "XPHB", creatorActorId: "different-creator"});
		const otherId = owner.addCompanion(prepared.companionData);
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(true);
		await runtime.castSpell(idOf(runtime, "Mage Armor"), {...castOptions, targetActorId: owner.getCompanion(otherId).actorSnapshot.actorId});
		expect(owner.hydrateCompanionActor(otherId).actor.getAc()).toBe(13);
		expect(runtime.getState().getAc()).toBe(10);
		owner.removeCompanion(id);
		expect(owner.hydrateCompanionActor(otherId).actor.getAc()).toBe(10);
		expect(owner.getCompanion(otherId).actorSnapshot.lifecycle).toBe("active");
	});

	it("cleans up replaced concentration without erasing a newly targeted concentration buff", async () => {
		const {owner, runtime} = fixture("PHB", {extraSpells: ["Shield of Faith"]});
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(true);
		await runtime.castSpell(idOf(runtime, "Shield of Faith"), {...castOptions, targetActorId: "original"});
		expect(owner.getAc()).toBe(12);
		const prepared = owner.prepareSimulacrumSnapshot({spellSource: "PHB"});
		const otherId = owner.addCompanion(prepared.companionData);
		await runtime.castSpell(idOf(runtime, "Shield of Faith"), {...castOptions, targetActorId: owner.getCompanion(otherId).actorSnapshot.actorId});
		expect(owner.getAc()).toBe(10);
		expect(owner.hydrateCompanionActor(otherId).actor.getAc()).toBe(12);
		expect(runtime.getState().getConcentration().spellName).toBe("Shield of Faith");
	});

	it("guards actual late self-apply operations and rejects callbacks after disposal", async () => {
		const {owner, runtime} = fixture();
		const service = runtime.getSpells();
		const data = spell("Mage Armor");
		const effects = State.parseSpellEffects(data);
		await service._applySpellEffectsToSelf(data, data, effects, 1);
		expect(runtime.getState().getAc()).toBe(13);
		expect(owner.getAc()).toBe(10);
		runtime.dispose();
		await expect(service._applySpellEffectsToSelf(data, data, effects, 1)).rejects.toThrow(/no longer available/);
	});

	it("melts at maximum zero, rejects generic healing paths and rejects build acquisition", async () => {
		const {owner, runtime, id} = fixture();
		await runtime.run(actor => {
			actor.setCurrentHp(3);
			State.applySpellEffect(spell("Cure Wounds"), owner, actor, {healingRoll: 8});
			actor.recalculateHp({syncCurrent: true});
			expect(actor.getCurrentHp()).toBe(3);
		});
		await expect(runtime.run(actor => actor.addFeature({name: "New learned feature", source: "PHB"}))).rejects.toThrow(/acquire|build/i);
		await runtime.run(actor => actor.setMaxHpReduction(10000));
		expect(owner.getCompanion(id).actorSnapshot.lifecycle).toBe("destroyed");
		expect(owner.getCompanion(id).hp.current).toBe(0);
	});

	describe("authoritative Simulacrum policies", () => {
		afterEach(() => jest.restoreAllMocks());

		it("allows PHB non-slot rest recovery without restoring HP, ordinary slots or Pact slots", async () => {
			const {owner, runtime, id} = fixture("PHB");
			await runtime.run(actor => {
				actor.setCurrentHp(10);
				actor.setSpellSlotCurrent(1, 0);
				actor.setPactSlots({current: 0, max: 2, level: 1});
				const resourceId = actor.addResource({name: "Test Rest Pool", current: 0, max: 2, recharge: "short"}).id;
				actor.setResourceCurrent(resourceId, 0);
				actor.onShortRest();
				expect(actor.getResources().find(it => it.id === resourceId).current).toBe(2);
				expect(actor.getSpellSlotsCurrent(1)).toBe(0);
				expect(actor.getPactSlots().current).toBe(0);
				actor.onLongRest();
				expect(actor.getCurrentHp()).toBe(10);
				expect(actor.getSpellSlotsCurrent(1)).toBe(0);
				expect(actor.getPactSlots().current).toBe(0);
			});
			owner.onLongRest();
			expect(owner.getCompanion(id).hp.current).toBe(10);
			expect(owner.hydrateCompanionActor(id).actor.getSpellSlotsCurrent(1)).toBe(0);
		});

		it("blocks PHB slot-creating conversions before spending their non-slot cost", async () => {
			const {runtime} = fixture("PHB", {className: "Sorcerer"});
			await runtime.run(actor => {
				actor.setSpellSlotCurrent(1, 0);
				const points = actor.getSorceryPoints().current;
				expect(actor.convertSorceryPointsToSlot(1)).toBe(false);
				expect(actor.getSorceryPoints().current).toBe(points);
				expect(actor.getSpellSlotsCurrent(1)).toBe(0);
			});
		});

		it("rejects XPHB rests but permits non-rest spell-slot conversion", async () => {
			const {runtime} = fixture("XPHB", {className: "Sorcerer"});
			await runtime.run(actor => {
				const minute = actor.getGameTimeMinutes();
				expect(actor.onShortRest()).toMatchObject({ok: false, reason: "actor-rest-forbidden"});
				expect(actor.onLongRest()).toMatchObject({ok: false, reason: "actor-rest-forbidden"});
				expect(actor.getGameTimeMinutes()).toBe(minute);
				actor.setSpellSlotCurrent(1, 0);
				const points = actor.getSorceryPoints().current;
				expect(actor.convertSorceryPointsToSlot(1)).toBe(true);
				expect(actor.getSpellSlotsCurrent(1)).toBe(1);
				expect(actor.getSorceryPoints().current).toBeLessThan(points);
			});
		});

		it("does not categorically forbid PHB Simulacrum, but blocks XPHB duplicate casting across sources", async () => {
			const toast = jest.spyOn(JqueryUtil, "doToast");
			const classic = fixture("PHB", {extraSpells: ["Simulacrum"], level: 13});
			expect(classic.runtime.getState().getCompanionSpellCastBlock(spell("Simulacrum"))).toBeNull();
			const modern = fixture("XPHB", {extraSpells: ["Simulacrum"], level: 13});
			await modern.runtime.castSpell(idOf(modern.runtime, "Simulacrum"), castOptions);
			expect(modern.runtime.getState().getSpellSlotsCurrent(7)).toBe(1);
			expect(modern.runtime.getState().getCompanionSpellCastBlock({...spell("Simulacrum"), source: "XPHB"})).toMatch(/cannot cast Simulacrum/i);
			expect(toast).toHaveBeenCalledWith(expect.objectContaining({content: expect.stringMatching(/cannot cast Simulacrum/i)}));
		});

		it("rejects healing and direct companion HP increases, and melts irreversibly at zero", () => {
			const {owner, id} = fixture();
			owner.setCompanionHp(id, 5);
			owner.setCompanionHp(id, 20);
			expect(owner.getCompanion(id).hp.current).toBe(5);
			expect(owner.healCompanion(id, 10)).toBe(0);
			const {actor, revision} = owner.hydrateCompanionActor(id);
			actor.heal(10);
			actor.setHp(20);
			expect(actor.getCurrentHp()).toBe(5);
			actor.takeDamage(1000);
			expect(owner.commitCompanionActor(id, {actor, revision}).ok).toBe(true);
			expect(owner.getCompanion(id).actorSnapshot.lifecycle).toBe("destroyed");
			owner.setCompanionHp(id, 10);
			expect(owner.getCompanion(id).hp.current).toBe(0);
			expect(owner.getSimulacrumRepairQuote(id, {amount: 2, laboratoryConfirmed: true}).ok).toBe(false);
		});

		it("quotes and charges only actual paid repair HP and preserves exact currency on projection failure", () => {
			const {owner, id} = fixture();
			owner.setCurrency("gp", 501);
			owner.setCurrency("sp", 7);
			owner.setCurrency("cp", 9);
			owner.damageCompanion(id, 3);
			expect(owner.getSimulacrumRepairQuote(id, {amount: 10, laboratoryConfirmed: true})).toMatchObject({ok: true, actualHp: 3, costGp: 300});
			expect(owner.repairSimulacrum(id, {amount: 10}).ok).toBe(false);
			const before = MiscUtil.copyFast(owner._data.currency);
			const result = owner.repairSimulacrum(id, {
				amount: 10,
				laboratoryConfirmed: true,
				exporter: {convertStateToMonster: () => { throw new Error("projection failure"); }},
			});
			expect(result.ok).toBe(false);
			expect(owner._data.currency).toEqual(before);
			expect(owner.repairSimulacrum(id, {amount: 10, laboratoryConfirmed: true})).toMatchObject({ok: true, actualHp: 3, costGp: 300});
			expect(owner.getCurrency("gp")).toBe(201);
		});

		it("requires owner Long Rest and proximity for XPHB paid repairs", () => {
			const {owner, id} = fixture("XPHB");
			owner.setCurrency("gp", 500);
			owner.damageCompanion(id, 2);
			expect(owner.repairSimulacrum(id, {amount: 2, laboratoryConfirmed: true}).ok).toBe(false);
			expect(owner.repairSimulacrum(id, {amount: 2, ownerLongRest: true}).ok).toBe(false);
			expect(owner.repairSimulacrum(id, {amount: 2, ownerLongRest: true, withinFiveFeet: true})).toMatchObject({ok: true, actualHp: 2, costGp: 200});
		});

		it("tears down only exact actor-owned effects and preserves the owner's unrelated concentration", async () => {
			const {owner, runtime, id} = fixture();
			jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(true);
			owner.setConcentration({name: "Unrelated spell", source: "PHB", level: 1});
			await runtime.castSpell(idOf(runtime, "Mage Armor"), {...castOptions, targetActorId: "original"});
			const ac = owner.getAc();
			owner.destroySimulacrum(id);
			expect(owner.getAc()).toBeLessThan(ac);
			expect(owner.getConcentration().spellName).toBe("Unrelated spell");
			expect(owner.getCompanion(id).actorSnapshot.lifecycle).toBe("destroyed");
		});
	});

	describe("shared headless pool selection contract", () => {
		it("spends an explicitly selected Pact pool independently from same-level ordinary slots", async () => {
			const actor = new State();
			actor.addClass({name: "Wizard", source: "PHB", level: 1});
			actor.calculateSpellSlots();
			actor.setPactSlots({current: 2, max: 2, level: 1});
			actor.addSpell({...spell("Shield"), sourceClass: "Wizard", prepared: true}, true);
			const page = {
				getState: () => actor,
				saveCharacter: jest.fn(),
				_renderQuickSpells: jest.fn(),
			};
			const service = new globalThis.CharacterSheetSpells(page, {isHeadless: true});
			service.setSpells(catalog);
			const id = actor.getSpells().find(it => it.name === "Shield").id;
			await service._castSpell(id, {withMetamagic: false, decision: {slotLevel: 1, isPact: true}});
			expect(actor.getPactSlots().current).toBe(1);
			expect(actor.getSpellSlotsCurrent(1)).toBe(2);
			await service._castSpell(id, {withMetamagic: false, decision: {slotLevel: 1, isPact: false}});
			expect(actor.getPactSlots().current).toBe(1);
			expect(actor.getSpellSlotsCurrent(1)).toBe(1);
		});
	});

	it("confirms actual supplied materials every cast without borrowing original inventory", async () => {
		const {owner, runtime} = fixture();
		owner.addItem({name: "Arcane Focus", source: "PHB", type: "SCF", scfType: "arcane"});
		const confirm = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(false);
		const before = runtime.getState().getSpellSlotsCurrent(1);
		await runtime.castSpell(idOf(runtime, "Mage Armor"), castOptions);
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(before);
		expect(confirm.mock.calls[0][0].htmlDescription).toMatch(/cured leather|material/i);
		confirm.mockResolvedValue(true);
		await runtime.castSpell(idOf(runtime, "Mage Armor"), castOptions);
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(before - 1);
		expect(runtime.getState().getItems()).toHaveLength(0);
		expect(owner.getItems()).toHaveLength(1);
		expect(confirm).toHaveBeenCalledTimes(2);
	});

	it("blocks a second cast while the first is awaiting supplies", async () => {
		const {runtime} = fixture();
		let resolve;
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockImplementation(() => new Promise(done => resolve = done));
		const pending = runtime.castSpell(idOf(runtime, "Mage Armor"), castOptions);
		await Promise.resolve();
		await expect(runtime.castSpell(idOf(runtime, "Shield"), castOptions)).rejects.toThrow(/in progress/);
		resolve(true);
		await pending;
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(3);
	});

	it.each(["destroy", "switch", "replace"])("rejects a stale %s callback after a supply prompt", async operation => {
		const {owner, page, id, runtime} = fixture();
		let resolve;
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockImplementation(() => new Promise(done => resolve = done));
		const pending = runtime.castSpell(idOf(runtime, "Mage Armor"), castOptions);
		await Promise.resolve();
		if (operation === "destroy") owner.destroySimulacrum(id);
		if (operation === "switch") page._state = new State();
		if (operation === "replace") owner.getCompanion(id).actorSnapshot.actorId = "replacement";
		resolve(true);
		await expect(pending).rejects.toThrow(/no longer available/);
		expect(owner.getSpellSlotsCurrent(1)).toBe(4);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it("rolls through the actor-bound Page method, not the owner's mutable callback", async () => {
		const {owner, runtime, page} = fixture();
		const actorRoll = jest.spyOn(runtime._actor, "rollD20").mockReturnValue(13);
		const ownerRoll = jest.spyOn(owner, "rollD20").mockReturnValue(1);
		await runtime.castSpell(idOf(runtime, "Fire Bolt"), castOptions);
		expect(actorRoll).toHaveBeenCalled();
		expect(ownerRoll).not.toHaveBeenCalled();
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({
			title: "Spell Attack: Fire Bolt", actorId: runtime.getActorId(), total: 20,
		}));
	});

	it("applies an explicitly targeted buff to the original without moving caster concentration", async () => {
		const {owner, runtime} = fixture();
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(true);
		const ownerAc = owner.getAc();
		await runtime.castSpell(idOf(runtime, "Mage Armor"), {...castOptions, targetActorId: "original"});
		expect(owner.getAc()).toBe(13);
		expect(owner.getAc()).not.toBe(ownerAc);
		expect(runtime.getState().getAc()).toBe(ownerAc);
		expect(owner.getActiveStates().find(it => it.name === "Mage Armor").effectOwnerId).toBe(runtime.getActorId());
		await expect(runtime.castSpell(idOf(runtime, "Shield"), {...castOptions, targetActorId: "original"})).rejects.toThrow(/only target/);
	});

	it("does not overwrite unrelated owner changes when persistence rejects an actor cast", async () => {
		const {owner, runtime, page} = fixture();
		page.saveCharacter.mockImplementation(async () => {
			owner.setCurrentHp(17);
			return false;
		});
		const before = runtime.getState().getSpellSlotsCurrent(1);
		await expect(runtime.castSpell(idOf(runtime, "Shield"), castOptions)).rejects.toThrow(/could not be saved/);
		expect(owner.getCurrentHp()).toBe(17);
		expect(runtime.getState().getSpellSlotsCurrent(1)).toBe(before);
		expect(owner.hydrateCompanionActor(runtime._companionId).actor.getSpellSlotsCurrent(1)).toBe(before);
	});
});
