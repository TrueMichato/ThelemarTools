import "../../js/parser.js";
import "../../js/utils.js";
import {InitiativeTrackerLairMarkers} from "../../js/dmscreen/panels/initiativetracker/dmscreen-initiativetracker-lairmarkers.js";
import {InitiativeTrackerRowUtil} from "../../js/dmscreen/panels/initiativetracker/dmscreen-initiativetracker-consts.js";

const LEG_GROUP_DRAGON = {
	name: "Ancient Red Dragon",
	source: "MM",
	lairActions: [{type: "list", items: [{type: "item", entry: "Magma erupts."}]}],
};

const LEG_GROUP_KRAKEN = {
	name: "Kraken",
	source: "MM",
	lairActions: [{type: "list", items: [{type: "item", entry: "Storm surges."}]}],
	regionalEffects: [{type: "list", items: [{type: "item", entry: "Weather is stormy."}]}],
};

const LEG_GROUP_NO_LAIR = {
	name: "Mythic Only",
	source: "MM",
	mythicEncounter: [{type: "entries", entries: ["Only mythic."]}],
};

const makeMonRow = (id, hash) => ({
	id,
	entity: {name: "Some Creature", source: "MM", isLairMarker: false, _hashOverride: hash},
});

const makeMarker = ({name, source, refRowIds = [], isManual = false, id = `marker-${name}`}) => ({
	id,
	entity: {
		isLairMarker: true,
		isLairMarkerManual: isManual,
		legendaryGroupName: name,
		legendaryGroupSource: source,
		refRowIds: [...refRowIds],
	},
});

let uidCounter = 0;
const makeUid = () => `uid-${++uidCounter}`;
beforeEach(() => { uidCounter = 0; });

const buildInputs = ({rows, hashMap, cache, autoAddEnabled = true, dismissedHashes = new Set()}) => ({
	rows,
	monsterLegendaryGroupHashByRowId: new Map(Object.entries(hashMap || {})),
	legGroupCache: new Map(Object.entries(cache || {})),
	autoAddEnabled,
	dismissedHashes,
	fnMakeId: makeUid,
});

describe("InitiativeTrackerLairMarkers.computeReconcileDiff", () => {
	it("adds a marker when a lair-eligible creature is present and none exists", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const rows = [makeMonRow("mon-1", hash)];

		const {rowsNxt, changed, added} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
		}));

		expect(changed).toBe(true);
		expect(added).toHaveLength(1);
		expect(rowsNxt).toHaveLength(2);
		const marker = rowsNxt.find(r => r.entity.isLairMarker);
		expect(marker.entity.legendaryGroupName).toBe("Ancient Red Dragon");
		expect(marker.entity.legendaryGroupSource).toBe("MM");
		expect(marker.entity.refRowIds).toEqual(["mon-1"]);
		expect(marker.entity.initiative).toBe(20);
		expect(marker.entity.isLairMarkerManual).toBe(false);
	});

	it("dedupes: two creatures sharing a legendary group produce ONE marker", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const rows = [makeMonRow("mon-1", hash), makeMonRow("mon-2", hash)];

		const {rowsNxt, added} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash, "mon-2": hash},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
		}));

		expect(added).toHaveLength(1);
		expect(rowsNxt.filter(r => r.entity.isLairMarker)).toHaveLength(1);
		expect(rowsNxt.find(r => r.entity.isLairMarker).entity.refRowIds.sort()).toEqual(["mon-1", "mon-2"]);
	});

	it("syncs refRowIds when one of two referencing creatures is removed", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const marker = makeMarker({name: LEG_GROUP_DRAGON.name, source: LEG_GROUP_DRAGON.source, refRowIds: ["mon-1", "mon-2"]});
		const rows = [makeMonRow("mon-1", hash), marker]; // mon-2 removed

		const {changed, refUpdates, rowsNxt} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
		}));

		expect(changed).toBe(true);
		expect(refUpdates).toHaveLength(1);
		expect(refUpdates[0].refRowIds).toEqual(["mon-1"]);
		expect(rowsNxt.find(r => r.entity.isLairMarker).entity.refRowIds).toEqual(["mon-1"]);
	});

	it("removes the auto-marker when the last referencing creature is gone", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const marker = makeMarker({name: LEG_GROUP_DRAGON.name, source: LEG_GROUP_DRAGON.source, refRowIds: ["mon-1"]});
		const rows = [marker]; // all creatures gone

		const {changed, removed, rowsNxt} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
		}));

		expect(changed).toBe(true);
		expect(removed).toHaveLength(1);
		expect(rowsNxt.filter(r => r.entity.isLairMarker)).toHaveLength(0);
	});

	it("does not auto-add when autoAddEnabled is false", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const rows = [makeMonRow("mon-1", hash)];

		const {changed, rowsNxt} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
			autoAddEnabled: false,
		}));

		expect(changed).toBe(false);
		expect(rowsNxt.filter(r => r.entity.isLairMarker)).toHaveLength(0);
	});

	it("preserves a manual marker when its refs empty out (but clears refs)", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const marker = makeMarker({name: LEG_GROUP_DRAGON.name, source: LEG_GROUP_DRAGON.source, refRowIds: ["mon-1"], isManual: true});
		const rows = [marker];

		const {changed, removed, rowsNxt, refUpdates} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
		}));

		expect(removed).toHaveLength(0);
		expect(changed).toBe(true);
		expect(refUpdates).toHaveLength(1);
		expect(rowsNxt.find(r => r.entity.isLairMarker).entity.refRowIds).toEqual([]);
		expect(rowsNxt.find(r => r.entity.isLairMarker).entity.isLairMarkerManual).toBe(true);
	});

	it("dedupes onto a pre-existing manual marker rather than adding a second", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const manualMarker = makeMarker({name: LEG_GROUP_DRAGON.name, source: LEG_GROUP_DRAGON.source, refRowIds: [], isManual: true});
		const rows = [makeMonRow("mon-1", hash), manualMarker];

		const {added, rowsNxt, refUpdates} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
		}));

		expect(added).toHaveLength(0);
		expect(rowsNxt.filter(r => r.entity.isLairMarker)).toHaveLength(1);
		expect(refUpdates[0].refRowIds).toEqual(["mon-1"]);
	});

	it("respects dismissedHashes: no auto-add when the group hash is dismissed", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const rows = [makeMonRow("mon-1", hash)];

		const {changed, rowsNxt} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
			dismissedHashes: new Set([hash]),
		}));

		expect(changed).toBe(false);
		expect(rowsNxt.filter(r => r.entity.isLairMarker)).toHaveLength(0);
	});

	it("skips groups with neither lairActions nor regionalEffects", () => {
		expect(InitiativeTrackerLairMarkers.hasTrackableContent(LEG_GROUP_NO_LAIR)).toBe(false);

		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_NO_LAIR);
		const rows = [makeMonRow("mon-1", hash)];

		const {changed, rowsNxt} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash},
			cache: {[hash]: {legGroup: LEG_GROUP_NO_LAIR, monName: "Mythic Only"}},
		}));

		expect(changed).toBe(false);
		expect(rowsNxt.filter(r => r.entity.isLairMarker)).toHaveLength(0);
	});

	it("supports groups with only regionalEffects (no lairActions)", () => {
		const groupRegionalOnly = {name: "Rasqi", source: "MM", regionalEffects: [{type: "list", items: []}]};
		expect(InitiativeTrackerLairMarkers.hasTrackableContent(groupRegionalOnly)).toBe(true);

		const hash = InitiativeTrackerLairMarkers.getGroupHash(groupRegionalOnly);
		const rows = [makeMonRow("mon-1", hash)];

		const {added} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash},
			cache: {[hash]: {legGroup: groupRegionalOnly, monName: "Rasqi"}},
		}));

		expect(added).toHaveLength(1);
	});

	it("distinct legendary groups produce distinct markers", () => {
		const hashDragon = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const hashKraken = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_KRAKEN);
		const rows = [makeMonRow("mon-1", hashDragon), makeMonRow("mon-2", hashKraken)];

		const {added} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hashDragon, "mon-2": hashKraken},
			cache: {
				[hashDragon]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"},
				[hashKraken]: {legGroup: LEG_GROUP_KRAKEN, monName: "Kraken"},
			},
		}));

		expect(added).toHaveLength(2);
		const names = added.map(m => m.entity.legendaryGroupName).sort();
		expect(names).toEqual(["Ancient Red Dragon", "Kraken"]);
	});

	it("is idempotent on subsequent runs when nothing has changed", () => {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(LEG_GROUP_DRAGON);
		const marker = makeMarker({name: LEG_GROUP_DRAGON.name, source: LEG_GROUP_DRAGON.source, refRowIds: ["mon-1"]});
		const rows = [makeMonRow("mon-1", hash), marker];

		const {changed} = InitiativeTrackerLairMarkers.computeReconcileDiff(buildInputs({
			rows,
			hashMap: {"mon-1": hash},
			cache: {[hash]: {legGroup: LEG_GROUP_DRAGON, monName: "Ancient Red Dragon"}},
		}));

		expect(changed).toBe(false);
	});
});

describe("InitiativeTrackerLairMarkers.getGroupHash", () => {
	it("is case-insensitive", () => {
		const h1 = InitiativeTrackerLairMarkers.getGroupHash({name: "Ancient Red Dragon", source: "MM"});
		const h2 = InitiativeTrackerLairMarkers.getGroupHash({name: "ANCIENT red dragon", source: "mm"});
		expect(h1).toBe(h2);
	});

	it("returns null when missing name or source", () => {
		expect(InitiativeTrackerLairMarkers.getGroupHash({name: "", source: "MM"})).toBeNull();
		expect(InitiativeTrackerLairMarkers.getGroupHash({name: "Foo", source: ""})).toBeNull();
		expect(InitiativeTrackerLairMarkers.getGroupHash({name: null, source: null})).toBeNull();
	});
});

describe("InitiativeTrackerRowUtil row predicates", () => {
	it("isNonCombatantRow returns true for lair markers", () => {
		const marker = {id: "m", entity: {isLairMarker: true}};
		expect(InitiativeTrackerRowUtil.isNonCombatantRow(marker)).toBe(true);
		expect(InitiativeTrackerRowUtil.isCombatantRow(marker)).toBe(false);
	});

	it("isCombatantRow returns true for regular monster rows", () => {
		const mon = {id: "mon", entity: {name: "Goblin", source: "MM"}};
		expect(InitiativeTrackerRowUtil.isCombatantRow(mon)).toBe(true);
		expect(InitiativeTrackerRowUtil.isNonCombatantRow(mon)).toBe(false);
	});

	it("handles null / undefined rows defensively", () => {
		expect(InitiativeTrackerRowUtil.isNonCombatantRow(null)).toBe(false);
		expect(InitiativeTrackerRowUtil.isNonCombatantRow(undefined)).toBe(false);
		expect(InitiativeTrackerRowUtil.isNonCombatantRow({})).toBe(false);
		expect(InitiativeTrackerRowUtil.isCombatantRow(null)).toBe(true);
	});
});
