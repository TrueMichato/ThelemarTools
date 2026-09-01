import {
	applyProjectionPolicy,
	buildCharacterViewModel,
	computePeerProfile,
	getDefaultProjectionPolicy,
	getPolicyManagementResponse,
	isPeerVisibleIdentity,
	projectCharacterForRequester,
	PROJECTION_FIELD_KEYS,
	PROJECTION_PRESETS,
	validateProjectionPolicy,
} from "../../../server/src/character-projection.js";

const CANARY = "CANARY-DO-NOT-SHARE";

function getCharacterData (overrides = {}) {
	return {
		name: "Mira Vale",
		pronouns: "she/her",
		race: {name: "Elf"},
		subrace: {name: "Wood"},
		classes: [{name: "Ranger", level: 5, source: "PHB"}],
		abilities: {str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 12},
		abilityBonuses: {dex: 2},
		saveProficiencies: ["str", "dex"],
		skillProficiencies: {stealth: 2, perception: 1},
		ac: {base: 12, itemBonus: 2, bonuses: [{value: 1}]},
		hp: {current: 30, max: 44, temp: 5},
		speed: {walk: 35, fly: 0},
		senses: {darkvision: 60, blindsight: 0},
		conditions: ["Poisoned", {name: "Prone"}],
		diseases: ["Sewer Plague"],
		exhaustion: 2,
		inventory: [
			{id: "i1", name: CANARY, quantity: 1, weight: 3},
			{id: "i2", name: "Rope", quantity: 2, weight: 5, isShared: true},
		],
		currency: {gp: 40},
		notes: {backstory: CANARY},
		xp: 6500,
		...overrides,
	};
}

function getCharacter (overrides = {}) {
	return {
		id: "character-1",
		ownerAccountId: "owner-account",
		campaignId: "campaign-1",
		status: "active",
		revision: 7,
		projectionRevision: 3,
		projectionPolicy: getDefaultProjectionPolicy(),
		data: getCharacterData(),
		...overrides,
	};
}

describe("authorization-scoped character projections", () => {
	describe("field catalog", () => {
		it("derives typed values from truth instead of copying source objects", () => {
			const viewModel = buildCharacterViewModel(getCharacterData());

			// Ability totals, not the stored base scores: `dex` is 16 base + 2 racial.
			expect(viewModel.abilities).toEqual({str: 10, dex: 18, con: 14, int: 8, wis: 15, cha: 12});
			// Saves and skills are derived modifiers, not raw proficiency flags.
			expect(viewModel.saves.dex).toEqual({modifier: 7, proficient: true});
			expect(viewModel.saves.con).toEqual({modifier: 2, proficient: false});
			expect(viewModel.skills.stealth).toEqual({modifier: 10, rank: "expertise"});
			expect(viewModel.skills.perception).toEqual({modifier: 5, rank: "proficient"});
			expect(viewModel.skills.arcana).toEqual({modifier: -1, rank: "none"});
			expect(viewModel.ac).toEqual({value: 15});
			expect(viewModel.species).toEqual({name: "Elf (Wood)"});
			expect(viewModel.senses).toEqual([{name: "darkvision", range: 60}]);
			expect(viewModel.conditions).toEqual(["Poisoned", "Prone"]);
			expect(viewModel.identity).toEqual({name: "Mira Vale", pronouns: "she/her"});
		});

		it("includes persisted unconditional modifiers the sheet applies", () => {
			// A peer profile and Party Tracker row must agree with the sheet: a custom save
			// modifier and a magic-item bonus are persisted and unconditional, so leaving
			// them out would understate the character everywhere the projection is shown.
			const viewModel = buildCharacterViewModel(getCharacterData({
				abilities: {str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10},
				abilityBonuses: {},
				classes: [{name: "Rogue", level: 5}],
				saveProficiencies: ["dex"],
				skillProficiencies: {stealth: 1},
				customModifiers: {savingThrows: {dex: 2}, skills: {stealth: 1, _all: 1}},
				itemBonuses: {savingThrow: 1, savingThrowDex: 1},
			}));

			// dex 14 (+2) + proficiency 3 + custom 2 + blanket item 1 + per-ability item 1
			expect(viewModel.saves.dex).toEqual({modifier: 9, proficient: true});
			// con 12 (+1), unproficient, but the blanket item bonus applies to every save
			expect(viewModel.saves.con).toEqual({modifier: 2, proficient: false});
			// dex 14 (+2) + proficiency 3 + per-skill 1 + all-skills 1
			expect(viewModel.skills.stealth).toEqual({modifier: 7, rank: "proficient"});
			// int 10 (+0), unproficient, all-skills 1 still applies
			expect(viewModel.skills.arcana).toEqual({modifier: 1, rank: "none"});
		});

		it("ignores transient state bonuses that are not part of the character", () => {
			const base = buildCharacterViewModel(getCharacterData());
			const withStates = buildCharacterViewModel(getCharacterData({
				activeStates: {rage: true},
				stateBonuses: {savingThrows: {str: 5}},
			}));

			// A projection describes the character, not whatever is toggled on right now.
			expect(withStates.saves).toEqual(base.saves);
		});

		it("keeps unshared item truth out of the inventory summary", () => {
			const viewModel = buildCharacterViewModel(getCharacterData());

			// A coarse count is shareable; only explicitly shared entries are named, and no
			// item id, weight, note or currency ever appears.
			expect(viewModel.inventorySummary).toEqual({entryCount: 2, publicItems: [{name: "Rope", quantity: 2}]});
			expect(JSON.stringify(viewModel)).not.toContain(CANARY);
			expect(JSON.stringify(viewModel)).not.toContain("i1");
		});

		it("strips markup and control characters from display labels", () => {
			const viewModel = buildCharacterViewModel(getCharacterData({
				name: "<b>Mira</b>\u0000 Vale",
				conditions: ["<script>alert(1)</script>Poisoned"],
			}));

			expect(viewModel.identity.name).toBe("Mira Vale");
			expect(viewModel.conditions).toEqual(["alert(1) Poisoned"]);
		});

		it("rejects an unsafe avatar reference", () => {
			expect(buildCharacterViewModel(getCharacterData({avatar: "javascript:alert(1)"})).identity.avatar).toBeUndefined();
			expect(buildCharacterViewModel(getCharacterData({avatar: "https://cdn.example/p.png"})).identity.avatar).toEqual({url: "https://cdn.example/p.png"});
		});

		it("never emits a catalog key outside the fixed list", () => {
			const viewModel = buildCharacterViewModel(getCharacterData({secretPlan: CANARY}));
			expect(Object.keys(viewModel).sort()).toEqual([...PROJECTION_FIELD_KEYS].sort());
		});
	});

	describe("presets and overrides", () => {
		it("shares exactly the documented fields per preset", () => {
			const viewModel = buildCharacterViewModel(getCharacterData());
			for (const [preset, expected] of Object.entries(PROJECTION_PRESETS)) {
				const data = applyProjectionPolicy({viewModel, policy: {version: 1, preset, overrides: {}}});
				expect({preset, keys: Object.keys(data).sort()}).toEqual({preset, keys: [...expected].sort()});
			}
		});

		it("applies share, hide, and typed replace overrides", () => {
			const character = getCharacter({
				projectionPolicy: {
					version: 1,
					preset: "table",
					overrides: {
						hp: {mode: "replace", value: {state: "healthy"}},
						identity: {mode: "replace", value: {name: "The Masked One"}},
						conditions: {mode: "hide"},
						carrySummary: {mode: "share"},
					},
				},
			});
			const {data} = computePeerProfile({character});

			expect(data.hp).toEqual({state: "healthy"});
			expect(data.identity).toEqual({name: "The Masked One"});
			expect(data.conditions).toBeUndefined();
			expect(data.carrySummary).toEqual({carried: 13, capacity: 150});
			// A replacement is emitted verbatim: no truth-derived calculation survives.
			expect(JSON.stringify(data)).not.toContain("Mira");
			expect(JSON.stringify(data)).not.toContain("30");
		});

		it("rejects invalid presets, fields, modes, and replacement values", () => {
			const invalid = [
				{version: 2, preset: "table", overrides: {}},
				{version: 1, preset: "everything", overrides: {}},
				{version: 1, preset: "table", overrides: {notAField: {mode: "hide"}}},
				{version: 1, preset: "table", overrides: {hp: {mode: "reveal"}}},
				{version: 1, preset: "table", overrides: {hp: {mode: "replace"}}},
				{version: 1, preset: "table", overrides: {hp: {mode: "hide", value: {state: "x"}}}},
				{version: 1, preset: "table", overrides: {hp: {mode: "replace", value: {state: "x", extra: 1}}}},
				{version: 1, preset: "table", overrides: {hp: {mode: "replace", value: {current: "lots"}}}},
				{version: 1, preset: "table", overrides: {ac: {mode: "replace", value: {value: -1}}}},
				{version: 1, preset: "table", overrides: {identity: {mode: "replace", value: {name: "<b>x</b>"}}}},
				{version: 1, preset: "table", overrides: {identity: {mode: "replace", value: {name: "x", avatar: {url: "javascript:1"}}}}},
				{version: 1, preset: "table", overrides: {skills: {mode: "replace", value: {stealth: {modifier: 1, rank: "godlike"}}}}},
				{version: 1, preset: "table", overrides: {abilities: {mode: "replace", value: {str: 10}}}},
				{version: 1, preset: "table", extra: true, overrides: {}},
			];
			for (const policy of invalid) {
				let code = null;
				try {
					validateProjectionPolicy(policy);
				} catch (error) {
					code = error.code;
				}
				expect({policy: JSON.stringify(policy), code}).toEqual({policy: JSON.stringify(policy), code: "PROJECTION_POLICY_INVALID"});
			}
		});

		it("accepts a full typed replacement for every catalog field", () => {
			const viewModel = buildCharacterViewModel(getCharacterData());
			for (const field of PROJECTION_FIELD_KEYS) {
				const policy = {version: 1, preset: "open", overrides: {[field]: {mode: "replace", value: viewModel[field]}}};
				expect({field, valid: !!validateProjectionPolicy(policy)}).toEqual({field, valid: true});
			}
		});
	});

	describe("fail-closed behaviour", () => {
		it("emits no data fields when the persisted policy cannot be validated", () => {
			for (const projectionPolicy of [null, undefined, "table", {version: 99}, {version: 1, preset: "open", overrides: {hp: {mode: "nope"}}}]) {
				const profile = computePeerProfile({character: getCharacter({projectionPolicy})});
				expect(profile.data).toEqual({});
				// Indistinguishable from `private`, so a corrupt policy is not enumerable.
				expect(profile.kind).toBe("peer_profile");
				expect(profile.error).toBeUndefined();
			}
		});

		it("never falls back to a more permissive preset", () => {
			const profile = computePeerProfile({character: getCharacter({projectionPolicy: {version: 1, preset: "open", overrides: {hp: {mode: "bogus"}}}})});
			expect(profile.data).toEqual({});
		});

		it("reports the failure code to owner management without recording truth", () => {
			const response = getPolicyManagementResponse(getCharacter({projectionPolicy: {version: 1}}));
			expect(response.error).toBe("PROJECTION_POLICY_INVALID");
			expect(response.policy).toBeNull();
			expect(response.preview.data).toEqual({});
			expect(JSON.stringify(response)).not.toContain(CANARY);
		});
	});

	describe("authorization outcomes", () => {
		it("returns owner truth with the persisted policy", () => {
			const result = projectCharacterForRequester({character: getCharacter(), authorizationClass: "owner"});

			expect(result.kind).toBe("owner_truth");
			expect(result.character.data.notes.backstory).toBe(CANARY);
			expect(result.policy).toEqual(getDefaultProjectionPolicy());
			// The policy is returned once, in its own field, not embedded in the document.
			expect(result.character.projectionPolicy).toBeUndefined();
		});

		it("returns DM truth beside the exact peer preview, without the raw policy", () => {
			const character = getCharacter();
			const dm = projectCharacterForRequester({character, authorizationClass: "dm"});
			const peer = projectCharacterForRequester({character, authorizationClass: "peer"});

			expect(dm.kind).toBe("dm_truth");
			expect(dm.character.data.notes.backstory).toBe(CANARY);
			expect(dm.peerPreview).toEqual(peer);
			expect(dm.policy).toBeUndefined();
			expect(dm.character.projectionPolicy).toBeUndefined();
		});

		it("gives two different peers byte-identical profiles", () => {
			const character = getCharacter();
			const first = projectCharacterForRequester({character, authorizationClass: "peer"});
			const second = projectCharacterForRequester({character, authorizationClass: "peer"});

			expect(JSON.stringify(first)).toBe(JSON.stringify(second));
			expect(first.ownerAccountId).toBeUndefined();
			expect(JSON.stringify(first)).not.toContain("owner-account");
		});

		it("keeps the peer envelope to its documented keys", () => {
			const peer = computePeerProfile({character: getCharacter()});
			expect(Object.keys(peer).sort()).toEqual(["campaignId", "data", "id", "kind", "projectionRevision", "revision"]);
		});
	});

	describe("identity gating", () => {
		it("treats a hidden identity as non-peer-visible", () => {
			expect(isPeerVisibleIdentity(getCharacter())).toBe(true);
			expect(isPeerVisibleIdentity(getCharacter({projectionPolicy: {version: 1, preset: "private", overrides: {}}}))).toBe(false);
			expect(isPeerVisibleIdentity(getCharacter({projectionPolicy: {version: 1, preset: "table", overrides: {identity: {mode: "hide"}}}}))).toBe(false);
			// A replaced identity is still peer-visible: an alias is something to target.
			expect(isPeerVisibleIdentity(getCharacter({projectionPolicy: {version: 1, preset: "private", overrides: {identity: {mode: "replace", value: {name: "Alias"}}}}}))).toBe(true);
			// A corrupt policy fails closed here too.
			expect(isPeerVisibleIdentity(getCharacter({projectionPolicy: null}))).toBe(false);
		});
	});
});
