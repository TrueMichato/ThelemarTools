/**
 * Shared roll-follow-up prompt contract.
 *
 * A post-roll decision must carry the exact roll that triggered it into the dialog rather than
 * relying on the toast behind the modal. The contract is deliberately stateless: an unrelated
 * prompt opened afterward must never inherit the previous result.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-modal.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

const CharacterSheetModal = globalThis.CharacterSheetModal;

describe("CharacterSheetModal roll follow-ups", () => {
	let inputCalls;

	beforeEach(() => {
		inputCalls = [];
		globalThis.InputUiUtil = {
			pGetUserBoolean: async opts => {
				inputCalls.push({type: "boolean", opts});
				return true;
			},
			pGetUserEnum: async opts => {
				inputCalls.push({type: "enum", opts});
				return 0;
			},
			pGetUserNumber: async opts => {
				inputCalls.push({type: "number", opts});
				return 1;
			},
		};
	});

	it("builds one canonical summary with the exact triggering total, natural die, breakdown, and outcome", () => {
		const followup = CharacterSheetModal.buildRollFollowup({
			label: "Longsword Attack",
			total: 27,
			naturalRoll: 20,
			breakdown: "1d20 (20) + 7",
			outcome: "Critical Hit!",
		});

		expect(followup).toEqual({
			label: "Longsword Attack",
			total: "27",
			naturalRoll: "20",
			breakdown: "1d20 (20) + 7",
			outcome: "Critical Hit!",
		});
		expect(Object.isFrozen(followup)).toBe(true);

		const html = CharacterSheetModal.getRollFollowupHtml(followup);
		expect(html).toContain("Longsword Attack");
		expect(html).toContain(">27<");
		expect(html).toContain("Natural d20");
		expect(html).toContain(">20<");
		expect(html).toContain("1d20 (20) + 7");
		expect(html).toContain("Critical Hit!");
		expect(html).toContain("aria-label=\"Triggering roll result\"");
	});

	it("escapes roll text before rendering it into a prompt", () => {
		const html = CharacterSheetModal.getRollFollowupHtml(CharacterSheetModal.buildRollFollowup({
			label: `<img src=x onerror="boom">`,
			total: 14,
			breakdown: "<script>boom()</script>",
			outcome: "Hit & marked",
		}));

		expect(html).not.toContain("<img");
		expect(html).not.toContain("<script");
		expect(html).toContain("&lt;img");
		expect(html).toContain("&lt;script");
		expect(html).toContain("Hit &amp; marked");
	});

	it("rejects unformatted breakdown objects rather than displaying object coercion in every follow-up", () => {
		expect(() => CharacterSheetModal.buildRollFollowup({
			label: "Attack",
			total: 27,
			breakdown: {total: 8, proficiency: 6},
		})).toThrow("breakdown must be formatted text");
	});

	it("prepends the same exact summary to InputUiUtil prompts without leaking it into the next prompt", async () => {
		const rollFollowup = CharacterSheetModal.buildRollFollowup({
			label: "Wisdom Save",
			total: 13,
			naturalRoll: 6,
			breakdown: "1d20 (6) + 7",
			outcome: "Failed vs DC 15",
		});

		await CharacterSheetModal.pGetUserBoolean({
			title: "Blood Price",
			htmlDescription: "<p>Spend a Hit Die?</p>",
			rollFollowup,
		});
		await CharacterSheetModal.pGetUserBoolean({
			title: "Delete Character",
			htmlDescription: "<p>This is not roll-related.</p>",
		});

		expect(inputCalls[0].opts.htmlDescription).toContain("Wisdom Save");
		expect(inputCalls[0].opts.htmlDescription).toContain(">13<");
		expect(inputCalls[0].opts.htmlDescription).toContain(">6<");
		expect(inputCalls[0].opts.htmlDescription).toContain("1d20 (6) + 7");
		expect(inputCalls[0].opts.htmlDescription).toContain("Failed vs DC 15");
		expect(inputCalls[0].opts.htmlDescription).toContain("Spend a Hit Die?");
		expect(inputCalls[0].opts.rollFollowup).toBeUndefined();
		expect(inputCalls[0].opts.fnGetShowModal).toEqual(expect.any(Function));
		const pGetShowOriginal = CharacterSheetModal.pGetShow;
		const modalCalls = [];
		CharacterSheetModal.pGetShow = async opts => {
			modalCalls.push(opts);
			return {sentinel: true};
		};
		try {
			await expect(inputCalls[0].opts.fnGetShowModal({title: "Routed"})).resolves.toEqual({sentinel: true});
			expect(modalCalls).toEqual([{title: "Routed"}]);
		} finally {
			CharacterSheetModal.pGetShow = pGetShowOriginal;
		}

		expect(inputCalls[1].opts.htmlDescription).toBe("<p>This is not roll-related.</p>");
		expect(inputCalls[1].opts.htmlDescription).not.toContain("Wisdom Save");
		expect(inputCalls[1].opts.fnGetShowModal).toBeUndefined();
	});

	it("mounts enum and number summaries before their controls without changing ordinary prompts", async () => {
		const rollFollowup = CharacterSheetModal.buildRollFollowup({
			label: "Fireball Damage",
			total: 31,
			breakdown: "8d6 (6, 5, 5, 4, 4, 3, 2, 2)",
			outcome: "fire damage",
		});

		await CharacterSheetModal.pGetUserEnum({
			title: "Transmuted Spell",
			htmlDescription: "<p>Choose a damage type.</p>",
			values: ["Cold"],
			rollFollowup,
		});
		await CharacterSheetModal.pGetUserNumber({
			title: "Penetrating Blow",
			rollFollowup,
		});
		await CharacterSheetModal.pGetUserEnum({
			title: "Ordinary Choice",
			values: ["One"],
		});

		expect(inputCalls[0]).toMatchObject({type: "enum"});
		expect(inputCalls[0].opts.elePre.outerHTML).toContain("Fireball Damage");
		expect(inputCalls[0].opts.elePre.outerHTML).toContain(">31<");
		expect(inputCalls[0].opts.elePre.outerHTML).toContain("Choose a damage type.");
		expect(inputCalls[0].opts.htmlDescription).toBeUndefined();
		expect(inputCalls[0].opts.fnGetShowModal).toEqual(expect.any(Function));

		expect(inputCalls[1]).toMatchObject({type: "number"});
		expect(inputCalls[1].opts.elePre.outerHTML).toContain("Fireball Damage");
		expect(inputCalls[1].opts.elePre.outerHTML).toContain(">31<");
		expect(inputCalls[1].opts.fnGetShowModal).toEqual(expect.any(Function));

		expect(inputCalls[2]).toMatchObject({type: "enum"});
		expect(inputCalls[2].opts.elePre).toBeUndefined();
		expect(inputCalls[2].opts.fnGetShowModal).toBeUndefined();
	});

	it("gives custom follow-up modals a separate content host so caller rendering cannot erase the roll", async () => {
		const root = globalThis.e_({tag: "div"});
		globalThis.UiUtil = {
			pGetShowModal: async () => ({
				eleModalInner: root,
				doClose: () => {},
			}),
		};
		const rollFollowup = CharacterSheetModal.buildRollFollowup({
			label: "Shortbow Attack",
			total: 24,
			naturalRoll: 19,
			breakdown: "1d20 (19) + 5",
		});

		const modal = await CharacterSheetModal.pGetRollFollowup({
			title: "Arcane Shot",
			rollFollowup,
		});
		modal.eleModalInner.innerHTML = "<p>Choose a shot.</p>";

		expect(root.children).toHaveLength(2);
		expect(root.children[0].outerHTML).toContain("Shortbow Attack");
		expect(root.children[0].outerHTML).toContain(">24<");
		expect(root.children[1]).toBe(modal.eleModalInner);
		expect(root.children[1].innerHTML).toBe("<p>Choose a shot.</p>");
	});
});

describe("roll-triggered feature prompts use the shared contract", () => {
	const SRC_PAGE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
	const SRC_COMBAT = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");
	const SRC_SPELLS = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-spells.js"), "utf8");

	const getMethodBody = (src, name, nextName) => {
		const start = src.indexOf(name);
		expect(start).toBeGreaterThan(-1);
		const end = nextName ? src.indexOf(nextName, start + name.length) : -1;
		return src.slice(start, end > start ? end : start + 8000);
	};

	it("routes independent save/check follow-ups through CharacterSheetModal", () => {
		const savingThrow = getMethodBody(SRC_PAGE, "async _rollSavingThrow (", "async _pMaybeApplyBloodPrice (");
		const bloodPrice = getMethodBody(SRC_PAGE, "async _pMaybeApplyBloodPrice (", "async _pMaybeApplyTacticalMind (");
		const tacticalMind = getMethodBody(SRC_PAGE, "async _pMaybeApplyTacticalMind (", "async _pMaybeApplyIndomitable (");
		const indomitable = getMethodBody(SRC_PAGE, "async _pMaybeApplyIndomitable (", "async _rollToolCheck (");

		for (const body of [bloodPrice, tacticalMind, indomitable]) {
			expect(body).toContain("CharacterSheetModal.pGetUserBoolean");
			expect(body).toContain("rollFollowup");
		}
		expect(savingThrow).toContain("const bloodPriceResult = await this._pMaybeApplyBloodPrice");
		expect(savingThrow).toContain("...(bloodPriceResult || saveFollowupContext)");
		expect(bloodPrice).toContain("const updatedBreakdown");
		expect(bloodPrice).toContain("total: newTotal");
	});

	it("routes independent attack and critical follow-ups through CharacterSheetModal", () => {
		const triggeredFeat = getMethodBody(SRC_PAGE, "async _pRollTriggeredFeatDie (", "async _pGetActivationTargets (");
		const arcaneShot = getMethodBody(SRC_COMBAT, "async _pPickArcaneShot (", "_applyArcaneShot (");
		const criticalRider = getMethodBody(SRC_COMBAT, "async _pOfferCritWeaponRiders (", "_getAmmoEffectText (");
		const spectralChains = getMethodBody(SRC_COMBAT, "async _pOfferFeatureOnHitOptions (", "_pOfferChainedTargetEffect (");

		for (const body of [arcaneShot, criticalRider, spectralChains]) {
			expect(body).toContain("CharacterSheetModal.pGetRollFollowup");
			expect(body).toContain("rollFollowup");
		}
		expect(triggeredFeat).toContain("CharacterSheetModal.pGetUserBoolean");
		expect(triggeredFeat).toContain("CharacterSheetModal.pGetUserEnum");
		expect(triggeredFeat).toContain("rollFollowup");
		expect(SRC_COMBAT).toMatch(/_pRollTriggeredFeatDie\?\.\(\{[\s\S]*?criticalHit[\s\S]*?rollFollowup: ctx\.rollFollowup/);
	});

	it("routes spell attack and damage follow-ups through CharacterSheetModal", () => {
		const seeking = getMethodBody(SRC_SPELLS, "async _pMaybeApplySeekingSpell (", "_getNormalizedCastMeta (");
		const transmuted = getMethodBody(SRC_SPELLS, "async _pMaybeApplyTransmutedDamage (", "async _pMaybeApplyEmpoweredReroll (");
		const empowered = getMethodBody(SRC_SPELLS, "async _pMaybeApplyEmpoweredReroll (", "_getTunedPassiveNotes (");

		for (const body of [seeking, transmuted, empowered]) {
			expect(body).toMatch(/CharacterSheetModal\.pGetUser(?:Boolean|Enum)/);
			expect(body).toContain("rollFollowup");
		}
	});
});
