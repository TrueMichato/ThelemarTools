/**
 * ROUND 32 — INTEGRATED repro (orchestrator cross-cut).
 *
 * The three R32 fixes were authored in isolated sessions:
 *   #2  Combat Methods Management modal crashed with `ReferenceError: isLocked`
 *       (a stray duplicate line in `_renderTraditionSelection`/makeChip).
 *   #3  Indomitable showed a 2/2 counter at Fighter L9 (should be 1) — a baked
 *       `feature.uses:{max:2}` on the Indomitable feature, surfaced as a duplicate
 *       counter beside the correct synthetic pool.
 *   #1  The quiver mis-recognised armor as ammo, missed gear-typed arrows, miscounted
 *       bundles, sat in the Overview tab, and never offered ammo on a ranged attack.
 *
 * This suite proves the three independent fixes COEXIST under a SINGLE real
 * `loadFromJson` of the user's actual save, and survive a serialize→load round-trip
 * (idempotency). It is the orchestrator's guarantee that the cherry-pick integration
 * did not regress any one fix while landing the others.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

import "../../../js/charactersheet/charactersheet-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CharacterSheetState = globalThis.CharacterSheetState;

const FIXTURE = resolve(__dirname, "fixtures", "D_kaios_Petri_2_v2.json");
const COMBAT_SRC = resolve(__dirname, "..", "..", "..", "js", "charactersheet", "charactersheet-combat.js");

// Stable ids from the real save.
const ID = {
	armor: "ad9cca9b-e827-4ca4-b13c-4884ac095698",
	longbow: "fdc36263-1226-4643-a92e-5b054371edd2",
	quiver: "9fbd39b4-3188-4412-9a6f-a2f9b80e2e21",
	sleepDart: "e547e8e3-5e04-4756-a750-b8fcdae6191e",
	healingArrow: "1269ba4a-9b0f-4ffd-abec-6bb9d51f4e85",
};

const rawSave = () => JSON.parse(readFileSync(FIXTURE, "utf8"));

function loadRealChar (json = rawSave()) {
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	return state;
}

const featByName = (state, name) =>
	(state._data.features || []).find(f => (f.name || "").toLowerCase() === name.toLowerCase());

describe("R32 integrated — preconditions prove the save is genuinely dirty (anti-false-green)", () => {
	const raw = rawSave();
	const rawFeat = name => (raw.features || []).find(f => (f.name || "").toLowerCase() === name.toLowerCase());

	test("#3 save bakes Indomitable feature.uses {max:2}", () => {
		expect(rawFeat("Indomitable")?.uses?.max).toBe(2);
	});

	test("#1 save bakes the equipped armor id into the quiver's containedItems", () => {
		const quiver = (raw.inventory || raw.items || []).find(i => i.id === ID.quiver);
		expect(quiver).toBeTruthy();
		// containedItems is baked onto the nested item object in the save.
		expect(quiver.item?.containedItems || []).toContain(ID.armor);
	});
});

describe("R32 integrated — all three fixes coexist under ONE loadFromJson", () => {
	const state = loadRealChar();

	// ---- #3 Indomitable double counter ------------------------------------
	test("#3 Indomitable: baked feature.uses stripped, max stays 1, Second Wind intact", () => {
		expect(featByName(state, "Indomitable")?.uses).toBeUndefined();
		expect(state.getIndomitableMax()).toBe(1);
		// Second Wind's synthetic pool READS feature.uses → must NOT be stripped.
		expect(featByName(state, "Second Wind")?.uses).toBeTruthy();
		expect(state.getSecondWindUsesRemaining()).toBeGreaterThanOrEqual(0);
	});

	// ---- #1 Quiver overhaul ------------------------------------------------
	test("#1 Quiver: armor purged, gear arrow recognised, bundle counted, ranged picker offers ammo (tracking OFF)", () => {
		const ammoIds = state.getQuiverAmmunition(ID.quiver).map(a => a.id);
		expect(ammoIds).toContain(ID.healingArrow);
		expect(ammoIds).toContain(ID.sleepDart);
		expect(ammoIds).not.toContain(ID.armor); // purged

		const sleepDart = state.getItems().find(i => i.id === ID.sleepDart);
		expect(state.getEffectiveAmmoCount(sleepDart)).toBe(5); // "(5)" bundle

		expect(state.isAmmunitionTrackingEnabled()).toBe(false);
		const offered = state.getQuiverAmmunitionForWeapon(ID.longbow).map(a => a.id);
		expect(offered).toContain(ID.healingArrow); // picker fires even with tracking off
	});

	// ---- #2 Combat Methods modal crash ------------------------------------
	test("#2 Combat Methods: the isLocked ReferenceError marker is gone from combat.js", () => {
		// The crash was a stray `isLocked` reference in _renderTraditionSelection's makeChip.
		// Integration must preserve its removal; any reintroduction re-breaks the modal.
		const src = readFileSync(COMBAT_SRC, "utf8");
		expect(src.includes("isLocked")).toBe(false);
	});
});

describe("R32 integrated — idempotency (load → toJson → load keeps all three fixed)", () => {
	test("round-trip preserves Indomitable strip + quiver purge", () => {
		const first = loadRealChar();
		const reloaded = loadRealChar(first.toJson());

		expect(featByName(reloaded, "Indomitable")?.uses).toBeUndefined();
		expect(reloaded.getIndomitableMax()).toBe(1);

		const ammoIds = reloaded.getQuiverAmmunition(ID.quiver).map(a => a.id);
		expect(ammoIds).not.toContain(ID.armor);
		expect(ammoIds).toContain(ID.healingArrow);
		expect(ammoIds).toContain(ID.sleepDart);
	});
});
