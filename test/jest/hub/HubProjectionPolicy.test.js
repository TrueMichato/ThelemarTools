import {
	buildReplacementValue,
	CharacterSheetSharing,
	describePreviewValue,
	FIELD_DESCRIPTORS,
	FIELD_KEYS,
	MODE_CHOICES,
	PRESET_CHOICES,
} from "../../../js/charactersheet/charactersheet-sharing.js";

const CATALOG_KEYS = [
	"identity", "species", "classes", "abilities", "saves", "skills", "ac", "hp",
	"speed", "senses", "conditions", "diseases", "exhaustion", "inventorySummary", "carrySummary",
];

function getApi ({policy = {version: 1, preset: "table", overrides: {}}, preview = {kind: "peer_profile", data: {}}, projectionRevision = 3, error = null, fnSet = null} = {}) {
	return {
		pGetProjectionPolicy: async () => ({policy, preview, projectionRevision, ...(error ? {error} : {})}),
		pSetProjectionPolicy: fnSet || (async () => ({policy, preview, projectionRevision: projectionRevision + 1})),
	};
}

function getSharing (overrides = {}) {
	return new CharacterSheetSharing({
		api: getApi(),
		fnGetCharacterId: () => "character-1",
		fnRandomId: () => "idem-1",
		...overrides,
	});
}

describe("character sheet sharing controls", () => {
	it("offers every catalog field and every documented mode without exposing JSON", () => {
		expect(FIELD_KEYS).toEqual(CATALOG_KEYS);
		expect(PRESET_CHOICES.map(it => it.value)).toEqual(["table", "minimal", "open", "private"]);
		expect(MODE_CHOICES.map(it => it.value)).toEqual(["share", "hide", "replace"]);
		// Every field must be configurable through labelled controls, so an owner never
		// has to hand-write a policy object.
		for (const field of FIELD_KEYS) {
			const descriptor = FIELD_DESCRIPTORS[field];
			expect(descriptor.label).toEqual(expect.any(String));
			const hasControls = descriptor.shape === "list" || !!descriptor.parts?.length;
			expect({field, hasControls}).toEqual({field, hasControls: true});
		}
	});

	it("implements no projection logic in the browser", () => {
		const source = FIELD_DESCRIPTORS.identity;
		// The descriptors carry presentation metadata only: labels and input kinds, never
		// preset membership or derivation rules.
		expect(Object.keys(source)).toEqual(["label", "shape", "parts"]);
		expect(JSON.stringify(FIELD_DESCRIPTORS)).not.toContain("preset");
	});

	it("builds typed replacement values from labelled input", () => {
		expect(buildReplacementValue({field: "hp", draft: {state: "healthy"}})).toEqual({state: "healthy"});
		expect(buildReplacementValue({field: "identity", draft: {name: " The Masked One "}})).toEqual({name: "The Masked One"});
		expect(buildReplacementValue({field: "ac", draft: {value: "15"}})).toEqual({value: 15});
		expect(buildReplacementValue({field: "conditions", draft: {items: ["Poisoned", "  ", ""]}})).toEqual(["Poisoned"]);
		expect(buildReplacementValue({field: "classes", draft: {rows: [{name: "Ranger", level: "5"}, {}]}})).toEqual([{name: "Ranger", level: 5}]);
		expect(buildReplacementValue({field: "saves", draft: {str: {modifier: "3", proficient: true}}})).toEqual({str: {modifier: 3, proficient: true}});
		// Exhaustion accepts either a level or a word, never both.
		expect(buildReplacementValue({field: "exhaustion", draft: {value: "2"}})).toBe(2);
		expect(buildReplacementValue({field: "exhaustion", draft: {value: "2", label: "Weary"}})).toBe("Weary");
	});

	it("loads the server policy and preview", async () => {
		const sharing = getSharing({
			api: getApi({policy: {version: 1, preset: "minimal", overrides: {}}, preview: {kind: "peer_profile", data: {identity: {name: "Mira"}}}}),
		});
		await sharing.pLoad();

		expect(sharing.getState().state).toBe("ready");
		expect(sharing.getState().policy.preset).toBe("minimal");
		expect(sharing.getState().preview.data.identity.name).toBe("Mira");
	});

	it("fails closed and offers recovery when the persisted policy is unreadable", async () => {
		const sharing = getSharing({
			api: getApi({policy: null, error: "PROJECTION_POLICY_INVALID", preview: {kind: "peer_profile", data: {}}}),
		});
		await sharing.pLoad();

		expect(sharing.getState().state).toBe("invalid");
		expect(sharing.getState().policyError).toBe("PROJECTION_POLICY_INVALID");
		// Nothing is shared while the policy is unreadable.
		expect(sharing.getState().preview.data).toEqual({});
		sharing.resetToDefault();
		expect(sharing.getSubmittablePolicy()).toEqual({version: 1, preset: "table", overrides: {}});
	});

	it("submits an explicit revision and a fresh idempotency key", async () => {
		const calls = [];
		const sharing = getSharing({
			api: getApi({
				projectionRevision: 7,
				fnSet: async args => {
					calls.push(args);
					return {policy: {version: 1, preset: "open", overrides: {}}, preview: {kind: "peer_profile", data: {}}, projectionRevision: 8};
				},
			}),
		});
		await sharing.pLoad();
		sharing.setPreset("open");
		await sharing.pSave();

		expect(calls).toEqual([{
			characterId: "character-1",
			policy: {version: 1, preset: "open", overrides: {}},
			expectedProjectionRevision: 7,
			idempotencyKey: "idem-1",
		}]);
		expect(sharing.getState().projectionRevision).toBe(8);
		expect(sharing.getState().feedback.type).toBe("success");
	});

	it("keeps unsaved choices and rebases after a stale write", async () => {
		const error = Object.assign(new Error("conflict"), {
			code: "PROJECTION_POLICY_CONFLICT",
			details: {
				projectionRevision: 9,
				policy: {version: 1, preset: "private", overrides: {}},
				preview: {kind: "peer_profile", data: {}},
			},
		});
		const sharing = getSharing({
			api: getApi({projectionRevision: 7, fnSet: async () => { throw error; }}),
		});
		await sharing.pLoad();
		sharing.setPreset("open");
		sharing.setFieldMode({field: "hp", mode: "hide"});
		await sharing.pSave();

		// The owner's edits survive; only the base revision moves forward.
		expect(sharing.getState().projectionRevision).toBe(9);
		expect(sharing.getState().feedback.type).toBe("warning");
		expect(sharing.getSubmittablePolicy()).toEqual({
			version: 1,
			preset: "open",
			overrides: {hp: {mode: "hide"}},
		});
	});

	it("reports an actionable message when the server rejects the policy", async () => {
		const sharing = getSharing({
			api: getApi({fnSet: async () => { throw Object.assign(new Error("bad"), {code: "PROJECTION_POLICY_INVALID"}); }}),
		});
		await sharing.pLoad();
		await sharing.pSave();

		expect(sharing.getState().feedback).toEqual({
			type: "error",
			text: "Those sharing settings could not be saved. Check the values you entered and try again.",
		});
	});

	it("carries a replacement value into the submitted policy", async () => {
		const sharing = getSharing();
		await sharing.pLoad();
		sharing.setFieldMode({field: "hp", mode: "replace"});
		sharing._replacementDrafts.hp = {state: "wounded"};

		expect(sharing.getSubmittablePolicy().overrides.hp).toEqual({mode: "replace", value: {state: "wounded"}});
	});

	it("clears an override when the field returns to the sharing level", async () => {
		const sharing = getSharing();
		await sharing.pLoad();
		sharing.setFieldMode({field: "skills", mode: "hide"});
		expect(sharing.getFieldMode("skills")).toBe("hide");
		sharing.setFieldMode({field: "skills", mode: "default"});

		expect(sharing.getFieldMode("skills")).toBe("default");
		expect(sharing.getSubmittablePolicy().overrides).toEqual({});
	});

	it("submits a server-valid replacement for every catalog field without extra input", async () => {
		const {validateProjectionPolicy} = await import("../../../server/src/character-projection.js");
		const sharing = getSharing();
		await sharing.pLoad();

		// The defaults an owner sees the moment they pick "Show instead" — including
		// checkbox and select values they never touch — must already be submittable.
		for (const field of FIELD_KEYS) {
			const value = buildReplacementValue({field, draft: sharing._getInitialReplacementDraft(field)});
			let error = null;
			try {
				validateProjectionPolicy({version: 1, preset: "table", overrides: {[field]: {mode: "replace", value}}});
			} catch (caught) {
				error = caught.message;
			}
			expect({field, error}).toEqual({field, error: null});
		}
	});

	it("seeds a replacement from what is currently shared", async () => {
		const sharing = getSharing({
			api: getApi({preview: {kind: "peer_profile", data: {identity: {name: "Mira"}, hp: {current: 4, max: 9}}}}),
		});
		await sharing.pLoad();

		expect(sharing._getInitialReplacementDraft("identity")).toEqual(expect.objectContaining({name: "Mira"}));
		expect(sharing._getInitialReplacementDraft("hp")).toEqual(expect.objectContaining({current: 4, max: 9}));
		// A field the policy hides has no preview, so it falls back to a neutral label
		// rather than an empty object the server would reject.
		expect(sharing._getInitialReplacementDraft("carrySummary")).toEqual(expect.objectContaining({state: "Hidden"}));
	});

	it("describes the private preset without promising the character disappears", () => {
		const preset = PRESET_CHOICES.find(choice => choice.value === "private");
		// ADR 0011 deliberately keeps existence and the opaque id visible as roster
		// metadata, so the copy must not claim otherwise.
		expect(preset.description).toContain("can still see that this character is in the campaign");
		expect(preset.description).not.toMatch(/only if you also share/);
	});

	it("is unavailable rather than broken without a character", async () => {
		const sharing = getSharing({fnGetCharacterId: () => null});
		await sharing.pLoad();
		expect(sharing.getState().state).toBe("unavailable");
	});

	it("describes preview values as reading text", () => {
		expect(describePreviewValue({state: "healthy"})).toBe("state: healthy");
		expect(describePreviewValue([])).toBe("None");
		expect(describePreviewValue([{name: "Ranger", level: 5}])).toBe("Ranger 5");
		expect(describePreviewValue(null)).toBe("—");
	});
});

describe("hub character view reader", () => {
	it("reads ownership from raw documents and envelopes alike", async () => {
		const {getProjectionOwnerAccountId, getProjectionId, getProjectionName} = await import("../../../js/hub/hub-character-view.js");
		const raw = {id: "c1", ownerAccountId: "a1", data: {name: "Mira"}};
		const owner = {kind: "owner_truth", character: raw};
		const dm = {kind: "dm_truth", character: raw, peerPreview: {kind: "peer_profile", id: "c1", data: {}}};
		const peer = {kind: "peer_profile", id: "c1", data: {identity: {name: "Mira"}}};

		// `/api/characters` still returns raw owner-scoped documents while campaign reads
		// return envelopes; both flow through the same selectors.
		expect(getProjectionOwnerAccountId(raw)).toBe("a1");
		expect(getProjectionOwnerAccountId(owner)).toBe("a1");
		expect(getProjectionOwnerAccountId(dm)).toBe("a1");
		// A peer never learns who owns a character from the projection itself.
		expect(getProjectionOwnerAccountId(peer)).toBeNull();

		for (const value of [raw, owner, dm, peer]) {
			expect(getProjectionId(value)).toBe("c1");
			expect(getProjectionName(value)).toBe("Mira");
		}
	});

	it("refuses canonical data from a peer profile", async () => {
		const {getCanonicalCharacter, isCanonicalProjection} = await import("../../../js/hub/hub-character-view.js");
		const peer = {kind: "peer_profile", id: "c1", data: {identity: {name: "Mira"}}};

		expect(isCanonicalProjection(peer)).toBe(false);
		expect(() => getCanonicalCharacter(peer)).toThrow(/Canonical character data is not available/);
		expect(getCanonicalCharacter({kind: "owner_truth", character: {id: "c1"}})).toEqual({id: "c1"});
	});
});
