import {
	ACTIVE_CAMPAIGN_MAX_BYTES,
	ACTIVE_CAMPAIGN_SCHEMA_VERSION,
	compareActiveCampaignRecords,
	isActiveCampaignUuid,
	isStrictlyGreaterActiveCampaignRecord,
	makeClearedRecord,
	makeSelectedRecord,
	parseActiveCampaignRecord,
	pickGreaterActiveCampaignRecord,
	serializeActiveCampaignRecord,
} from "../../../js/hub/hub-active-campaign-record.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_A = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN_B = "44444444-4444-4444-8444-444444444444";
const WRITER_A = "55555555-5555-4555-8555-555555555555";
const WRITER_B = "66666666-6666-4666-8666-666666666666";

const selected = over => makeSelectedRecord({
	accountId: ACCOUNT_A,
	campaignId: CAMPAIGN_A,
	revision: 1,
	updatedAt: 1000,
	writerId: WRITER_A,
	...over,
});

const cleared = over => makeClearedRecord({
	accountId: ACCOUNT_A,
	revision: 1,
	updatedAt: 1000,
	writerId: WRITER_A,
	...over,
});

describe("active campaign record algebra", () => {
	it("accepts only well-formed identifiers", () => {
		expect(isActiveCampaignUuid(ACCOUNT_A)).toBe(true);
		for (const bad of ["", "not-a-uuid", null, undefined, 7, `${ACCOUNT_A}x`]) expect(isActiveCampaignUuid(bad)).toBe(false);
	});

	it("round-trips a selection and a tombstone", () => {
		for (const record of [selected(), cleared()]) {
			expect(parseActiveCampaignRecord(serializeActiveCampaignRecord(record))).toEqual(record);
		}
	});

	it("rejects malformed, unknown-schema, and structurally impossible records", () => {
		const base = JSON.parse(serializeActiveCampaignRecord(selected()));
		const mutations = [
			["malformed JSON", "{not json"],
			["empty", ""],
			["array", JSON.stringify([])],
			["unknown schema", JSON.stringify({...base, schemaVersion: ACTIVE_CAMPAIGN_SCHEMA_VERSION + 1})],
			["non-uuid account", JSON.stringify({...base, accountId: "nope"})],
			["non-uuid writer", JSON.stringify({...base, writerId: "nope"})],
			["non-uuid campaign", JSON.stringify({...base, campaignId: "nope"})],
			["negative revision", JSON.stringify({...base, revision: -1})],
			["fractional revision", JSON.stringify({...base, revision: 1.5})],
			["negative timestamp", JSON.stringify({...base, updatedAt: -1})],
			["unknown state", JSON.stringify({...base, state: "paused"})],
			["selected without campaign", JSON.stringify({...base, campaignId: null})],
		];
		for (const [label, raw] of mutations) {
			expect([label, parseActiveCampaignRecord(raw)]).toEqual([label, null]);
		}
	});

	it("refuses a tombstone that smuggles a campaign id", () => {
		const raw = JSON.stringify({...JSON.parse(serializeActiveCampaignRecord(cleared())), campaignId: CAMPAIGN_A});
		expect(parseActiveCampaignRecord(raw)).toBeNull();
	});

	it("rejects records larger than the 1 KiB budget", () => {
		const oversized = `${"x".repeat(ACTIVE_CAMPAIGN_MAX_BYTES + 1)}`;
		expect(parseActiveCampaignRecord(oversized)).toBeNull();
	});

	it("measures the cap in bytes, so multibyte padding cannot slip past it", () => {
		// Under a UTF-16 code-unit check this payload looks like ~700 units and would be accepted.
		const padded = JSON.stringify({
			...JSON.parse(serializeActiveCampaignRecord(selected())),
			note: "\u00e9".repeat(700),
		});
		expect(padded.length).toBeLessThanOrEqual(ACTIVE_CAMPAIGN_MAX_BYTES);
		expect(new TextEncoder().encode(padded).byteLength).toBeGreaterThan(ACTIVE_CAMPAIGN_MAX_BYTES);
		expect(parseActiveCampaignRecord(padded)).toBeNull();
	});

	it("orders by revision, then state precedence, then updatedAt, then writerId", () => {
		expect(compareActiveCampaignRecords(selected({revision: 2}), selected({revision: 1}))).toBe(1);
		// A clear tombstone outranks a selection at the same revision.
		expect(compareActiveCampaignRecords(cleared(), selected())).toBe(1);
		expect(compareActiveCampaignRecords(selected({updatedAt: 2000}), selected())).toBe(1);
		expect(compareActiveCampaignRecords(selected({writerId: WRITER_B}), selected())).toBe(1);
		expect(compareActiveCampaignRecords(selected(), selected())).toBe(0);
	});

	it("treats records from different accounts as incomparable", () => {
		const other = makeSelectedRecord({accountId: ACCOUNT_B, campaignId: CAMPAIGN_B, revision: 9, updatedAt: 9999, writerId: WRITER_B});
		expect(() => compareActiveCampaignRecords(selected(), other)).toThrow(/comparable only/);
		// A far greater cross-account record must never displace the current account's winner.
		expect(pickGreaterActiveCampaignRecord(selected(), other)).toEqual(selected());
		expect(isStrictlyGreaterActiveCampaignRecord(other, selected())).toBe(false);
	});

	it("reports strict improvement only for a genuinely greater same-account record", () => {
		expect(isStrictlyGreaterActiveCampaignRecord(selected({revision: 2}), selected())).toBe(true);
		expect(isStrictlyGreaterActiveCampaignRecord(selected(), selected())).toBe(false);
		expect(isStrictlyGreaterActiveCampaignRecord(selected(), null)).toBe(true);
		expect(isStrictlyGreaterActiveCampaignRecord(null, selected())).toBe(false);
	});
});
