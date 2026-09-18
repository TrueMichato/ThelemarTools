import "./setup.js";
import {jest} from "@jest/globals";
import {HubCharacterMemoryAuthority, HubCharacterRepository} from "../../../js/hub/hub-character-repository.js";
import {CHARACTER_ACCESS_MODES} from "../../../js/hub/hub-character-view.js";
import {CHARACTER_REALTIME_ACCESS_END_CAUSES} from "../../../js/charactersheet/charactersheet-realtime.js";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
let CharacterSheetPage;
let CharacterSheetModal;

const makeRepository = (characters = []) => {
	const data = new Map(characters.map(character => [character.id, structuredClone(character)]));
	return {
		isRescueMirrorEnabled: false,
		pList: jest.fn(async () => [...data.values()].map(character => structuredClone(character))),
		pGet: jest.fn(async ({characterId}) => structuredClone(data.get(characterId) || null)),
		pUpsert: jest.fn(async ({character}) => {
			data.set(character.id, structuredClone(character));
			return structuredClone(character);
		}),
		pDelete: jest.fn(async ({characterId}) => data.delete(characterId)),
		pDeleteMany: jest.fn(async ({characterIds}) => {
			let count = 0;
			characterIds.forEach(id => { if (data.delete(id)) count++; });
			return count;
		}),
	};
};

const makeDeferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((resolve_, reject_) => {
		resolve = resolve_;
		reject = reject_;
	});
	return {promise, resolve, reject};
};

const makeSelectOption = () => ({
	value: "",
	textContent: "",
	disabled: false,
	dataset: {},
	_parentSelect: null,
	remove () {
		if (!this._parentSelect) return;
		const index = this._parentSelect.options.indexOf(this);
		if (~index) this._parentSelect.options.splice(index, 1);
		if (this._parentSelect.value === this.value) this._parentSelect.value = "";
		this._parentSelect = null;
	},
});

const makeCharacterSelect = characters => {
	const attributes = new Map();
	const select = {
		options: [],
		value: "",
		append (option) {
			option._parentSelect = this;
			this.options.push(option);
		},
		insertAdjacentHTML (_position, html) {
			const option = makeSelectOption();
			option.value = html.match(/value="([^"]*)"/)?.[1] || "";
			option.textContent = html.replace(/<[^>]+>/g, "");
			this.append(option);
		},
		setAttribute (name, value) {
			attributes.set(name, `${value}`);
		},
		getAttribute (name) {
			return attributes.get(name) ?? null;
		},
	};
	Object.defineProperty(select, "innerHTML", {
		set: () => {
			select.options.splice(0, select.options.length);
			select.value = "";
		},
	});
	const create = makeSelectOption();
	create.value = "";
	create.textContent = "Create New Character";
	select.append(create);
	const divider = makeSelectOption();
	divider.disabled = true;
	divider.textContent = "Saved Characters";
	select.append(divider);
	for (const character of characters) {
		const option = makeSelectOption();
		option.value = character.id;
		option.textContent = character.label || character.name;
		select.append(option);
	}
	return select;
};

describe("Character Sheet repository seam", () => {
	beforeAll(async () => {
		globalThis.window = globalThis.window || {addEventListener: () => {}, location: {search: "", href: "http://test/"}};
		globalThis.document = globalThis.document || {getElementById: () => null, querySelector: () => null, addEventListener: () => {}};
		globalThis.document.createElement ||= () => makeSelectOption();
		CharacterSheetPage = (await import(`${REPO_ROOT}js/charactersheet/charactersheet.js`)).CharacterSheetPage;
		CharacterSheetModal = globalThis.CharacterSheetModal;
	});

	it("saves through the injected repository without writing a local rescue mirror", async () => {
		const repository = makeRepository();
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "cloud-character",
			_state: {toJson: () => ({name: "Cloud Character", hp: {current: 12}})},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
		};

		await CharacterSheetPage.prototype._saveCurrentCharacter.call(host);

		expect(repository.pUpsert).toHaveBeenCalledWith({
			activity: null,
			character: expect.objectContaining({
				id: "cloud-character",
				name: "Cloud Character",
				_savedAt: expect.any(Number),
			}),
			isCreate: false,
		});
		expect(host._writeActiveCharacterMirror).not.toHaveBeenCalled();
		expect(host._clearActiveCharacterMirror).not.toHaveBeenCalled();
	});

	it("loads the dropdown from the injected repository", async () => {
		const characters = [{id: "cloud-a", name: "A"}, {id: "cloud-b", name: "B"}];
		const repository = makeRepository(characters);
		const host = {
			_characterRepository: repository,
			_updateCharacterDropdown: jest.fn(),
		};

		await CharacterSheetPage.prototype._pLoadCharacters.call(host);

		expect(repository.pList).toHaveBeenCalledTimes(1);
		expect(host._updateCharacterDropdown).toHaveBeenCalledWith(characters);
	});

	it("does not claim recovery or clear the retained Hub selector after a fenced roster cancellation", async () => {
		const repository = makeRepository();
		repository.pList.mockResolvedValueOnce(null);
		const host = {
			_characterRepository: repository,
			_pClaimUnboundLegacyHubRecovery: jest.fn(),
			_updateCharacterDropdown: jest.fn(),
		};

		await CharacterSheetPage.prototype._pLoadCharacters.call(host);

		expect(host._pClaimUnboundLegacyHubRecovery).not.toHaveBeenCalled();
		expect(host._updateCharacterDropdown).toHaveBeenCalledWith(null);
	});

	it("ends unsafe old character interactions before awaiting a replacement character", async () => {
		const load = makeDeferred();
		const host = {
			_characterLoadGeneration: 4,
			_currentCharacterId: "character-a",
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(() => load.promise),
			},
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
			_reconcilePersistedCharacter: CharacterSheetPage.prototype._reconcilePersistedCharacter,
		};

		const pending = CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b");

		expect(host._closeCharacterScopedTransientUi).toHaveBeenCalledWith({isRetainCurrentCharacterUi: true});
		expect(host._characterRepository.pGet).toHaveBeenCalledWith({characterId: "character-b"});
		load.resolve(null);
		await pending;
	});

	it("does not erase cloud dropdown options when the current character name changes", () => {
		const select = {
			value: "cloud-a",
			options: [
				{value: "", textContent: "Create New Character"},
				{value: "cloud-a", textContent: "Before — Fighter 1"},
				{value: "cloud-b", textContent: "Other — Wizard 2"},
			],
		};
		const host = {
			_isHubCharacter: true,
			_currentCharacterId: "cloud-a",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_selCharacter: select,
			_state: {
				getName: () => "After",
				getClasses: () => [{name: "Fighter", level: 1}],
			},
			_characterRepository: {getCharacterAccess: () => CHARACTER_ACCESS_MODES.OWNER},
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
		};

		CharacterSheetPage.prototype._updateCharacterDropdown.call(host);

		expect(select.options.map(option => [option.value, option.textContent])).toEqual([
			["", "Create New Character"],
			["cloud-a", "After — Fighter 1"],
			["cloud-b", "Other — Wizard 2"],
		]);
		expect(select.value).toBe("cloud-a");
	});

	it("seeds realtime attachment with the authoritative campaign membership role", () => {
		const attach = jest.fn(() => true);
		const host = {
			_hubRealtimeGeneration: 4,
			_hubReadOnlyRefreshRequest: null,
			_isHubReadOnlyRefreshRequired: false,
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_characterLoadGeneration: 7,
			_hubContext: {membership: {role: "player"}},
			_hubEffects: {activate: jest.fn()},
			_peerTargeting: {activate: jest.fn()},
			_partyInventory: {pAttach: jest.fn()},
			_hubRealtime: {attach},
		};

		expect(CharacterSheetPage.prototype._attachHubRealtime.call(host, {characterId: "character-a"})).toBe(true);

		expect(attach).toHaveBeenCalledWith({
			characterId: "character-a",
			membershipRole: "player",
		});
	});

	it("reattaches retained owner Party Inventory on each role-roster generation fence", () => {
		const partyInventory = {
			isAttachedTo: jest.fn(() => true),
			pAttach: jest.fn(async () => true),
		};
		const host = {
			_hubCampaignId: "campaign-1",
			_isHubCharacter: true,
			_hubCampaignContext: null,
			_hubRoleRosterGeneration: 0,
			_currentCharacterId: "owned",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_characterLoadGeneration: 2,
			_characterRepository: {invalidateRoleScopedCharacterAccess: jest.fn()},
			_partyInventory: partyInventory,
			_peerTargeting: {deactivate: jest.fn()},
			isCurrentCharacterReadOnly: CharacterSheetPage.prototype.isCurrentCharacterReadOnly,
			_reattachRetainedHubCharacterIntegrations: CharacterSheetPage.prototype._reattachRetainedHubCharacterIntegrations,
			_setHubRoleRosterStatus: CharacterSheetPage.prototype._setHubRoleRosterStatus,
			_beginHubRoleScopedRosterRefresh: CharacterSheetPage.prototype._beginHubRoleScopedRosterRefresh,
		};

		CharacterSheetPage.prototype._onHubMembershipChanged.call(host, {campaignId: "campaign-1"});
		CharacterSheetPage.prototype._onHubMembershipChanged.call(host, {campaignId: "campaign-1"});

		expect(host._characterLoadGeneration).toBe(4);
		expect(partyInventory.pAttach).toHaveBeenNthCalledWith(1, {
			characterId: "owned",
			generation: 3,
		});
		expect(partyInventory.pAttach).toHaveBeenNthCalledWith(2, {
			characterId: "owned",
			generation: 4,
		});
	});

	it.each([
		["a DM read-only character", "private", CHARACTER_ACCESS_MODES.DM_READ_ONLY],
		["a concealed character", null, CHARACTER_ACCESS_MODES.OWNER],
	])("does not reattach retained Party Inventory for %s during a role-roster fence", (_label, characterId, accessMode) => {
		const partyInventory = {
			isAttachedTo: jest.fn(() => true),
			pAttach: jest.fn(),
		};
		const host = {
			_hubCampaignId: "campaign-1",
			_isHubCharacter: true,
			_hubCampaignContext: null,
			_hubRoleRosterGeneration: 0,
			_currentCharacterId: characterId,
			_currentCharacterAccess: accessMode,
			_characterLoadGeneration: 2,
			_characterRepository: {invalidateRoleScopedCharacterAccess: jest.fn()},
			_partyInventory: partyInventory,
			_peerTargeting: {deactivate: jest.fn()},
			isCurrentCharacterReadOnly: CharacterSheetPage.prototype.isCurrentCharacterReadOnly,
			_reattachRetainedHubCharacterIntegrations: CharacterSheetPage.prototype._reattachRetainedHubCharacterIntegrations,
			_setHubRoleRosterStatus: CharacterSheetPage.prototype._setHubRoleRosterStatus,
			_beginHubRoleScopedRosterRefresh: CharacterSheetPage.prototype._beginHubRoleScopedRosterRefresh,
		};

		CharacterSheetPage.prototype._onHubMembershipChanged.call(host, {campaignId: "campaign-1"});

		expect(host._characterLoadGeneration).toBe(3);
		expect(partyInventory.pAttach).not.toHaveBeenCalled();
	});

	it("conceals role-scoped selector metadata before an authoritative demotion roster resolves", async () => {
		const contextRefresh = makeDeferred();
		const rosterRefresh = makeDeferred();
		const access = new Map([
			["owned", CHARACTER_ACCESS_MODES.OWNER],
			["private", CHARACTER_ACCESS_MODES.DM_READ_ONLY],
		]);
		const select = makeCharacterSelect([
			{id: "owned", label: "Owned — Fighter 3"},
			{id: "private", label: "Hidden Player — Wizard 5 (read-only)"},
		]);
		select.value = "owned";
		const repository = {
			getCharacterAccess: jest.fn(({characterId}) => access.get(characterId) || null),
			invalidateRoleScopedCharacterAccess: jest.fn(() => {
				access.delete("private");
				return ["private"];
			}),
			pList: jest.fn(() => rosterRefresh.promise),
		};
		const host = {
			_hubCampaignId: "campaign-1",
			_isHubCharacter: true,
			_hubCampaignContext: {pRefresh: jest.fn(() => contextRefresh.promise)},
			_hubContext: {membership: {role: "dm"}, rulesVersion: null, brewBundle: null},
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_isHubContextUnavailable: false,
			_isHubContextRevalidationRequired: false,
			_hubRoleRosterGeneration: 0,
			_isHubRoleRosterUnavailable: false,
			_isHubRoleRosterRevalidationRequired: false,
			_currentCharacterId: "owned",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_characterLoadGeneration: 2,
			_characterRepository: repository,
			_selCharacter: select,
			_state: {
				getName: () => "Owned",
				getClasses: () => [{name: "Fighter", level: 3}],
			},
			_campaign: {render: jest.fn()},
			_clearHubRules: jest.fn(),
			_applyHubContext: jest.fn(function (context) {
				this._hubContext = context;
			}),
			_renderCharacter: jest.fn(),
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_updateCharacterDropdown: CharacterSheetPage.prototype._updateCharacterDropdown,
			_setHubRoleRosterStatus: CharacterSheetPage.prototype._setHubRoleRosterStatus,
			_beginHubRoleScopedRosterRefresh: CharacterSheetPage.prototype._beginHubRoleScopedRosterRefresh,
			_pRefreshHubRoleScopedCharacterRoster: CharacterSheetPage.prototype._pRefreshHubRoleScopedCharacterRoster,
			_onHubCampaignContextChanged: CharacterSheetPage.prototype._onHubCampaignContextChanged,
		};

		expect(CharacterSheetPage.prototype._onHubMembershipChanged.call(host, {
			campaignId: "campaign-1",
			role: "player",
		})).toBe(true);

		expect(repository.invalidateRoleScopedCharacterAccess).toHaveBeenCalledTimes(1);
		expect([...select.options].map(option => option.textContent).join(" ")).not.toContain("Hidden Player");
		expect(select.getAttribute("aria-busy")).toBe("true");
		expect(host._characterLoadGeneration).toBe(3);

		contextRefresh.resolve({membership: {role: "player"}, rulesVersion: null, brewBundle: null});
		await Promise.resolve();
		await Promise.resolve();
		expect(repository.pList).toHaveBeenCalledWith({fnIsCurrent: expect.any(Function)});

		rosterRefresh.resolve([{id: "owned", name: "Owned", classes: [{name: "Fighter", level: 3}]}]);
		await new Promise(resolve => setTimeout(resolve, 0));
		expect([...select.options].map(option => option.textContent).join(" ")).not.toContain("Hidden Player");
		expect(select.value).toBe("owned");
		expect(select.getAttribute("aria-busy")).toBe("false");
	});

	it("keeps the role-scoped selector fail-closed when the post-demotion roster refresh fails", async () => {
		const rosterFailure = Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"});
		const access = new Map([
			["owned", CHARACTER_ACCESS_MODES.OWNER],
			["private", CHARACTER_ACCESS_MODES.DM_READ_ONLY],
		]);
		const select = makeCharacterSelect([
			{id: "owned", label: "Owned — Fighter 3"},
			{id: "private", label: "Hidden Player — Wizard 5 (read-only)"},
		]);
		select.value = "owned";
		const host = {
			_hubCampaignId: "campaign-1",
			_isHubCharacter: true,
			_hubCampaignContext: {
				pRefresh: jest.fn(async () => ({membership: {role: "player"}, rulesVersion: null, brewBundle: null})),
			},
			_hubContext: {membership: {role: "dm"}, rulesVersion: null, brewBundle: null},
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_isHubContextUnavailable: false,
			_isHubContextRevalidationRequired: false,
			_hubRoleRosterGeneration: 0,
			_isHubRoleRosterUnavailable: false,
			_isHubRoleRosterRevalidationRequired: false,
			_currentCharacterId: "owned",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_characterLoadGeneration: 2,
			_characterRepository: {
				getCharacterAccess: jest.fn(({characterId}) => access.get(characterId) || null),
				invalidateRoleScopedCharacterAccess: jest.fn(() => {
					access.delete("private");
					return ["private"];
				}),
				pList: jest.fn(async () => { throw rosterFailure; }),
			},
			_selCharacter: select,
			_state: {
				getName: () => "Owned",
				getClasses: () => [{name: "Fighter", level: 3}],
			},
			_campaign: {render: jest.fn()},
			_clearHubRules: jest.fn(),
			_applyHubContext: jest.fn(function (context) {
				this._hubContext = context;
			}),
			_renderCharacter: jest.fn(),
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_updateCharacterDropdown: CharacterSheetPage.prototype._updateCharacterDropdown,
			_setHubRoleRosterStatus: CharacterSheetPage.prototype._setHubRoleRosterStatus,
			_beginHubRoleScopedRosterRefresh: CharacterSheetPage.prototype._beginHubRoleScopedRosterRefresh,
			_pRefreshHubRoleScopedCharacterRoster: CharacterSheetPage.prototype._pRefreshHubRoleScopedCharacterRoster,
			_onHubCampaignContextChanged: CharacterSheetPage.prototype._onHubCampaignContextChanged,
			_handleTerminalCharacterCampaignAccessError: jest.fn(() => false),
		};

		CharacterSheetPage.prototype._onHubMembershipChanged.call(host, {
			campaignId: "campaign-1",
			role: "player",
		});
		await new Promise(resolve => setTimeout(resolve, 0));

		const labels = [...select.options].map(option => option.textContent);
		expect(labels.join(" ")).not.toContain("Hidden Player");
		expect(labels).toContain("Authorized character list unavailable");
		expect(host._isHubRoleRosterUnavailable).toBe(true);
		expect(host._isHubRoleRosterRevalidationRequired).toBe(true);
		expect(select.value).toBe("owned");
	});

	it("repopulates newly authorized DM selector entries after promotion", async () => {
		const access = new Map([["owned", CHARACTER_ACCESS_MODES.OWNER]]);
		const select = makeCharacterSelect([{id: "owned", label: "Owned — Fighter 3"}]);
		select.value = "owned";
		const promotedCharacters = [
			{id: "owned", name: "Owned", classes: [{name: "Fighter", level: 3}]},
			{id: "private", name: "Hidden Player", classes: [{name: "Wizard", level: 5}]},
		];
		const host = {
			_hubCampaignId: "campaign-1",
			_isHubCharacter: true,
			_hubCampaignContext: {
				pRefresh: jest.fn(async () => ({membership: {role: "dm"}, rulesVersion: null, brewBundle: null})),
			},
			_hubContext: {membership: {role: "player"}, rulesVersion: null, brewBundle: null},
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_isHubContextUnavailable: false,
			_isHubContextRevalidationRequired: false,
			_hubRoleRosterGeneration: 0,
			_isHubRoleRosterUnavailable: false,
			_isHubRoleRosterRevalidationRequired: false,
			_currentCharacterId: "owned",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_characterLoadGeneration: 2,
			_characterRepository: {
				getCharacterAccess: jest.fn(({characterId}) => access.get(characterId) || null),
				invalidateRoleScopedCharacterAccess: jest.fn(() => []),
				pList: jest.fn(async () => {
					access.set("private", CHARACTER_ACCESS_MODES.DM_READ_ONLY);
					return promotedCharacters;
				}),
			},
			_selCharacter: select,
			_state: {
				getName: () => "Owned",
				getClasses: () => [{name: "Fighter", level: 3}],
			},
			_campaign: {render: jest.fn()},
			_clearHubRules: jest.fn(),
			_applyHubContext: jest.fn(function (context) {
				this._hubContext = context;
			}),
			_renderCharacter: jest.fn(),
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_updateCharacterDropdown: CharacterSheetPage.prototype._updateCharacterDropdown,
			_setHubRoleRosterStatus: CharacterSheetPage.prototype._setHubRoleRosterStatus,
			_beginHubRoleScopedRosterRefresh: CharacterSheetPage.prototype._beginHubRoleScopedRosterRefresh,
			_pRefreshHubRoleScopedCharacterRoster: CharacterSheetPage.prototype._pRefreshHubRoleScopedCharacterRoster,
			_onHubCampaignContextChanged: CharacterSheetPage.prototype._onHubCampaignContextChanged,
		};

		CharacterSheetPage.prototype._onHubMembershipChanged.call(host, {
			campaignId: "campaign-1",
			role: "dm",
		});
		await new Promise(resolve => setTimeout(resolve, 0));

		expect([...select.options].map(option => option.textContent)).toContain("Hidden Player — Wizard 5 (read-only)");
		expect(select.value).toBe("owned");
	});

	it("does not let a stale role roster completion overwrite a newer character scope", async () => {
		const rosterRefresh = makeDeferred();
		const access = new Map([["owned", CHARACTER_ACCESS_MODES.OWNER]]);
		const select = makeCharacterSelect([{id: "owned", label: "Owned — Fighter 3"}]);
		select.value = "owned";
		const host = {
			_hubCampaignId: "campaign-1",
			_isHubCharacter: true,
			_hubCampaignContext: {
				pRefresh: jest.fn(async () => ({membership: {role: "dm"}, rulesVersion: null, brewBundle: null})),
			},
			_hubContext: {membership: {role: "player"}, rulesVersion: null, brewBundle: null},
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_isHubContextUnavailable: false,
			_isHubContextRevalidationRequired: false,
			_hubRoleRosterGeneration: 0,
			_isHubRoleRosterUnavailable: false,
			_isHubRoleRosterRevalidationRequired: false,
			_currentCharacterId: "owned",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_characterLoadGeneration: 2,
			_characterRepository: {
				getCharacterAccess: jest.fn(({characterId}) => access.get(characterId) || null),
				invalidateRoleScopedCharacterAccess: jest.fn(() => []),
				pList: jest.fn(() => rosterRefresh.promise),
			},
			_selCharacter: select,
			_state: {
				getName: () => "Owned",
				getClasses: () => [{name: "Fighter", level: 3}],
			},
			_campaign: {render: jest.fn()},
			_clearHubRules: jest.fn(),
			_applyHubContext: jest.fn(function (context) {
				this._hubContext = context;
			}),
			_renderCharacter: jest.fn(),
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_updateCharacterDropdown: CharacterSheetPage.prototype._updateCharacterDropdown,
			_setHubRoleRosterStatus: CharacterSheetPage.prototype._setHubRoleRosterStatus,
			_beginHubRoleScopedRosterRefresh: CharacterSheetPage.prototype._beginHubRoleScopedRosterRefresh,
			_pRefreshHubRoleScopedCharacterRoster: CharacterSheetPage.prototype._pRefreshHubRoleScopedCharacterRoster,
			_onHubCampaignContextChanged: CharacterSheetPage.prototype._onHubCampaignContextChanged,
		};

		CharacterSheetPage.prototype._onHubMembershipChanged.call(host, {
			campaignId: "campaign-1",
			role: "dm",
		});
		await Promise.resolve();
		await Promise.resolve();
		host._currentCharacterId = "replacement";
		host._characterLoadGeneration++;
		rosterRefresh.resolve([
			{id: "owned", name: "Owned"},
			{id: "private", name: "Hidden Player"},
		]);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect([...select.options].map(option => option.textContent).join(" ")).not.toContain("Hidden Player");
	});

	it("syncs state-bound Roll History controls on every full character render", () => {
		const syncFromActiveCharacter = jest.fn();
		const host = {
			_state: {
				syncDerivedResourceMaxes: jest.fn(),
				getViewMode: () => "normal",
			},
			_rollHistory: {syncFromActiveCharacter},
			_updateTabVisibility: jest.fn(),
			_applyCharacterAccessMode: jest.fn(),
		};
		for (const method of [
			"_renderBasicInfo",
			"_renderAbilityScores",
			"_renderSavingThrows",
			"_renderSkills",
			"_renderHp",
			"_renderCombatStats",
			"_renderDefenses",
			"_renderHitDice",
			"_renderDeathSaves",
			"_renderInspiration",
			"_renderProficiencies",
			"_renderCurrency",
			"_renderNotes",
			"_renderAppearance",
			"_renderPortrait",
			"_renderConditions",
			"_renderExhaustion",
			"_renderResources",
			"_renderOverviewMetamagic",
			"_renderOverviewRanger",
			"_renderOverviewPrinciples",
			"_renderActiveStates",
			"_renderFavouritesOverview",
			"_renderOverviewActions",
			"_renderOverviewSpecialtiesFeats",
			"_renderAttacks",
			"_renderQuickSpells",
			"_renderAbilitiesDetailed",
			"_renderModifierIndicators",
			"_renderCompanions",
		]) host[method] = jest.fn();

		CharacterSheetPage.prototype._renderCharacter.call(host);
		expect(syncFromActiveCharacter).toHaveBeenCalledTimes(1);
		expect(syncFromActiveCharacter).toHaveBeenCalledTimes(1);
	});

	it("reports remote save failure so character switching can abort", async () => {
		const repository = makeRepository();
		repository.pUpsert.mockRejectedValueOnce(new Error("revision conflict"));
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "cloud-character",
			_state: {toJson: () => ({name: "Unsaved"})},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(false);
		expect(host._updateSaveIndicator).toHaveBeenLastCalledWith("error");
	});

	it("saves through the actual hub repository contract", async () => {
		const authority = new HubCharacterMemoryAuthority();
		authority.createCharacter({
			characterId: "cloud-character",
			ownerId: "player-1",
			campaignId: "campaign-1",
			data: {id: "cloud-character", name: "Before", hp: {current: 20}},
			mutationId: "create",
		});

		const repository = new HubCharacterRepository({
			authority,
			sessionId: "device-a",
			ownerId: "player-1",
			campaignId: "campaign-1",
		});
		await repository.pGet({characterId: "cloud-character"});
		await repository.pAcquireLease({characterId: "cloud-character"});
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "cloud-character",
			_state: {toJson: () => ({id: "cloud-character", name: "After", hp: {current: 13}})},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(authority.getCharacter({characterId: "cloud-character"})).toEqual(expect.objectContaining({
			revision: 2,
			data: expect.objectContaining({name: "After", hp: {current: 13}}),
		}));
	});

	it("adopts a canonical id returned by the cloud repository", async () => {
		const calls = [];
		const repository = makeRepository();
		repository.pUpsert.mockImplementationOnce(async options => {
			calls.push("upsert");
			expect(options.isCreate).toBe(true);
			return {id: "server-id", name: "Cloud Character"};
		});
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "temporary-id",
			_characterLoadGeneration: 1,
			_isHubCharacter: true,
			_hubCampaignId: "campaign-1",
			_isCurrentCharacterNew: true,
			_state: {
				toJson: () => ({name: "Cloud Character"}),
				setId: jest.fn(),
			},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_adoptCanonicalCharacterIdentity: CharacterSheetPage.prototype._adoptCanonicalCharacterIdentity,
			_pRefreshCanonicalCharacterRoster: CharacterSheetPage.prototype._pRefreshCanonicalCharacterRoster,
			_lastSavedAt: 0,
			_detachHubRealtime: jest.fn(),
			_pLoadCharacters: jest.fn(async () => calls.push("refresh")),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: ""},
			_attachHubRealtime: jest.fn(() => calls.push("attach")),
			_campaign: {pRefreshCurrentCharacter: jest.fn(async () => calls.push("campaign"))},
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(host._currentCharacterId).toBe("server-id");
		expect(host._isCurrentCharacterNew).toBe(false);
		expect(host._selCharacter.value).toBe("server-id");
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});
		expect(calls).toEqual(["upsert", "attach", "refresh", "campaign"]);
	});

	it("keeps a canonical create successful when post-create UI refreshes fail", async () => {
		const calls = [];
		const repository = makeRepository();
		repository.getCharacterAccess = jest.fn(() => CHARACTER_ACCESS_MODES.OWNER);
		repository.pUpsert.mockImplementationOnce(async () => {
			calls.push("upsert");
			return {id: "server-id", name: "Cloud Character"};
		});
		const toastPrevious = globalThis.JqueryUtil.doToast;
		const doToast = jest.fn();
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.JqueryUtil.doToast = doToast;
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "temporary-id",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: true,
			_characterLoadGeneration: 0,
			_isHubCharacter: true,
			_hubCampaignId: "campaign-1",
			_state: {
				toJson: () => ({name: "Cloud Character"}),
				setId: jest.fn(),
			},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_adoptCanonicalCharacterIdentity: CharacterSheetPage.prototype._adoptCanonicalCharacterIdentity,
			_lastSavedAt: 0,
			_detachHubRealtime: jest.fn(),
			_pLoadCharacters: jest.fn(async () => {
				calls.push("refresh");
				throw new Error("roster unavailable");
			}),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: "", options: []},
			_attachHubRealtime: jest.fn(() => calls.push("attach")),
			_campaign: {
				pRefreshCurrentCharacter: jest.fn(async () => {
					calls.push("campaign");
					host._selCharacter.value = "";
					throw new Error("campaign controls unavailable");
				}),
			},
		};

		try {
			await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(doToast).toHaveBeenCalledWith(expect.objectContaining({
				type: "warning",
				content: expect.stringContaining("Character saved"),
			}));
		} finally {
			warn.mockRestore();
			globalThis.JqueryUtil.doToast = toastPrevious;
		}

		expect(host._currentCharacterId).toBe("server-id");
		expect(host._isCurrentCharacterNew).toBe(false);
		expect(host._state.setId).toHaveBeenCalledWith("server-id");
		expect(host._selCharacter.value).toBe("server-id");
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});
		expect(host._updateSaveIndicator).toHaveBeenLastCalledWith("saved");
		expect(calls).toEqual(["upsert", "attach", "refresh", "campaign"]);
	});

	it("does not send owner-only writes for a DM read-only character", async () => {
		const repository = makeRepository();
		repository.getCharacterAccess = () => "dm_readonly";
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: "dm_readonly",
			_state: {toJson: () => ({name: "Locally edited"})},
			_updateSaveIndicator: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(repository.pUpsert).not.toHaveBeenCalled();
		expect(host._updateSaveIndicator).toHaveBeenLastCalledWith("readonly");
	});

	it("conceals an active Hub character when a terminal delete race cannot restore realtime", async () => {
		const terminalError = Object.assign(new Error("already archived"), {code: "CHARACTER_NOT_FOUND", status: 404});
		const host = {
			_characterRepository: {pDelete: jest.fn(async () => { throw terminalError; })},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(CharacterSheetPage.prototype._onDeleteCharacter.call(host)).rejects.toBe(terminalError);
		} finally {
			confirm.mockRestore();
		}

		expect(host._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "character",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it.each([
		["terminal teardown", null],
		["a replacement selection", "character-b"],
	])("keeps the delete target captured before %s wins during confirmation", async (_label, replacementCharacterId) => {
		const confirmation = makeDeferred();
		const terminalError = Object.assign(new Error("already archived"), {code: "CHARACTER_NOT_FOUND", status: 404});
		const host = {
			_characterRepository: {pDelete: jest.fn(async () => { throw terminalError; })},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(),
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockImplementation(() => confirmation.promise);
		try {
			const pending = CharacterSheetPage.prototype._onDeleteCharacter.call(host);
			host._currentCharacterId = replacementCharacterId;
			confirmation.resolve(true);
			await expect(pending).rejects.toBe(terminalError);
		} finally {
			confirm.mockRestore();
		}

		expect(host._characterRepository.pDelete).toHaveBeenCalledWith({characterId: "character-a"});
		expect(host._detachHubRealtime).not.toHaveBeenCalled();
		expect(host._endCurrentHubCharacterAccess).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
		expect(host._currentCharacterId).toBe(replacementCharacterId);
	});

	it("does not conceal or reattach the source when a delete failure settles after a character switch", async () => {
		const deletion = makeDeferred();
		const terminalError = Object.assign(new Error("already archived"), {code: "CHARACTER_NOT_FOUND", status: 404});
		const host = {
			_characterRepository: {pDelete: jest.fn(() => deletion.promise)},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(),
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			const pending = CharacterSheetPage.prototype._onDeleteCharacter.call(host);
			await Promise.resolve();
			host._currentCharacterId = "character-b";
			deletion.reject(terminalError);
			await expect(pending).rejects.toBe(terminalError);
		} finally {
			confirm.mockRestore();
		}

		expect(host._endCurrentHubCharacterAccess).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
		expect(host._currentCharacterId).toBe("character-b");
	});

	it("does not blank a newly selected character when an earlier delete succeeds late", async () => {
		const deletion = makeDeferred();
		const host = {
			_characterRepository: {pDelete: jest.fn(() => deletion.promise)},
			_currentCharacterId: "character-a",
			_detachHubRealtime: jest.fn(),
			_createNewCharacter: jest.fn(),
			_pLoadCharacters: jest.fn(async () => {}),
			_selCharacter: {value: "character-b"},
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			const pending = CharacterSheetPage.prototype._onDeleteCharacter.call(host);
			await Promise.resolve();
			host._currentCharacterId = "character-b";
			deletion.resolve(true);
			await pending;
		} finally {
			confirm.mockRestore();
		}

		expect(host._createNewCharacter).not.toHaveBeenCalled();
		expect(host._pLoadCharacters).toHaveBeenCalledTimes(1);
		expect(host._selCharacter.value).toBe("character-b");
	});

	it("conceals a successfully deleted active character before a roster refresh can fail", async () => {
		const refreshError = new Error("roster refresh failed");
		const host = {
			_characterRepository: {pDelete: jest.fn(async () => true)},
			_currentCharacterId: "character-a",
			_detachHubRealtime: jest.fn(),
			_createNewCharacter: jest.fn(() => host._currentCharacterId = "new-character"),
			_pLoadCharacters: jest.fn(async () => { throw refreshError; }),
			_selCharacter: {value: "character-a"},
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(CharacterSheetPage.prototype._onDeleteCharacter.call(host)).rejects.toBe(refreshError);
		} finally {
			confirm.mockRestore();
		}

		expect(host._createNewCharacter).toHaveBeenCalledTimes(1);
		expect(host._selCharacter.value).toBe("");
		expect(host._currentCharacterId).toBe("new-character");
	});

	it("conceals an active Hub character when a terminal bulk-delete race cannot restore realtime", async () => {
		const terminalError = Object.assign(new Error("already archived"), {code: "CHARACTER_NOT_FOUND", status: 404});
		const characters = [{id: "character-a", name: "Mira"}];
		const host = {
			_characterRepository: {
				pList: jest.fn(async () => characters),
				pDeleteMany: jest.fn(async () => { throw terminalError; }),
			},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};
		const previousMultipleChoice = globalThis.InputUiUtil.pGetUserMultipleChoice;
		const previousGetUserString = globalThis.InputUiUtil.pGetUserString;
		const previousEscapeQuotes = String.prototype.escapeQuotes;
		globalThis.InputUiUtil.pGetUserMultipleChoice = jest.fn(async () => characters);
		globalThis.InputUiUtil.pGetUserString = jest.fn(async () => "DELETE");
		String.prototype.escapeQuotes = function () { return `${this}`; };
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(CharacterSheetPage.prototype._onManageCharacters.call(host)).rejects.toBe(terminalError);
		} finally {
			confirm.mockRestore();
			if (previousMultipleChoice) globalThis.InputUiUtil.pGetUserMultipleChoice = previousMultipleChoice;
			else delete globalThis.InputUiUtil.pGetUserMultipleChoice;
			if (previousGetUserString) globalThis.InputUiUtil.pGetUserString = previousGetUserString;
			else delete globalThis.InputUiUtil.pGetUserString;
			if (previousEscapeQuotes) String.prototype.escapeQuotes = previousEscapeQuotes;
			else delete String.prototype.escapeQuotes;
		}

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "character",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("conceals an active character already committed by a partially failed bulk delete", async () => {
		const partialError = Object.assign(new Error("second archive failed"), {
			code: "NETWORK_UNAVAILABLE",
			deletedCharacterIds: ["character-a"],
		});
		const characters = [{id: "character-a", name: "Mira"}, {id: "character-b", name: "Rin"}];
		const host = {
			_characterRepository: {
				pList: jest.fn(async () => characters),
				pDeleteMany: jest.fn(async () => { throw partialError; }),
			},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};
		const previousMultipleChoice = globalThis.InputUiUtil.pGetUserMultipleChoice;
		const previousEscapeQuotes = String.prototype.escapeQuotes;
		globalThis.InputUiUtil.pGetUserMultipleChoice = jest.fn(async () => characters);
		String.prototype.escapeQuotes = function () { return `${this}`; };
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(CharacterSheetPage.prototype._onManageCharacters.call(host)).rejects.toBe(partialError);
		} finally {
			confirm.mockRestore();
			if (previousMultipleChoice) globalThis.InputUiUtil.pGetUserMultipleChoice = previousMultipleChoice;
			else delete globalThis.InputUiUtil.pGetUserMultipleChoice;
			if (previousEscapeQuotes) String.prototype.escapeQuotes = previousEscapeQuotes;
			else delete String.prototype.escapeQuotes;
		}

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "character",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("conceals a later-selected character in the committed prefix of a partial bulk delete", async () => {
		const deletion = makeDeferred();
		const partialError = Object.assign(new Error("third archive failed"), {
			code: "NETWORK_UNAVAILABLE",
			deletedCharacterIds: ["character-a", "character-b"],
		});
		const characters = [
			{id: "character-a", name: "Mira"},
			{id: "character-b", name: "Rin"},
			{id: "character-c", name: "Sol"},
		];
		const host = {
			_characterRepository: {
				pList: jest.fn(async () => characters),
				pDeleteMany: jest.fn(() => deletion.promise),
			},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};
		const previousMultipleChoice = globalThis.InputUiUtil.pGetUserMultipleChoice;
		const previousGetUserString = globalThis.InputUiUtil.pGetUserString;
		const previousEscapeQuotes = String.prototype.escapeQuotes;
		globalThis.InputUiUtil.pGetUserMultipleChoice = jest.fn(async () => characters);
		globalThis.InputUiUtil.pGetUserString = jest.fn(async () => "DELETE");
		String.prototype.escapeQuotes = function () { return `${this}`; };
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			const pending = CharacterSheetPage.prototype._onManageCharacters.call(host);
			await new Promise(resolve => setImmediate(resolve));
			expect(host._characterRepository.pDeleteMany).toHaveBeenCalledTimes(1);
			host._currentCharacterId = "character-b";
			deletion.reject(partialError);
			await expect(pending).rejects.toBe(partialError);
		} finally {
			confirm.mockRestore();
			if (previousMultipleChoice) globalThis.InputUiUtil.pGetUserMultipleChoice = previousMultipleChoice;
			else delete globalThis.InputUiUtil.pGetUserMultipleChoice;
			if (previousGetUserString) globalThis.InputUiUtil.pGetUserString = previousGetUserString;
			else delete globalThis.InputUiUtil.pGetUserString;
			if (previousEscapeQuotes) String.prototype.escapeQuotes = previousEscapeQuotes;
			else delete String.prototype.escapeQuotes;
		}

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-b",
			accessEndCause: "character",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("disables mutation controls before a DM can edit a read-only sheet", () => {
		const makeControl = ({id = "", disabled = false, role = null, tabindex = null, draggable = null} = {}) => {
			const attributes = new Map();
			if (role != null) attributes.set("role", role);
			if (tabindex != null) attributes.set("tabindex", tabindex);
			if (draggable != null) attributes.set("draggable", draggable);
			return {
				id,
				disabled,
				dataset: {},
				matches: selector => selector === "[role=\"button\"]" && role === "button",
				setAttribute: jest.fn((name, value) => attributes.set(name, `${value}`)),
				removeAttribute: jest.fn(name => attributes.delete(name)),
				getAttribute: jest.fn(name => attributes.get(name) ?? null),
			};
		};
		const edit = makeControl();
		const customButton = makeControl({role: "button", tabindex: "0"});
		const draggable = makeControl({draggable: "true"});
		const characterSelect = makeControl({id: "charsheet-sel-character"});
		const exportButton = makeControl({id: "charsheet-btn-export"});
		const moreButton = makeControl({id: "charsheet-btn-more"});
		const stalePortal = {remove: jest.fn()};
		const closeCastOptionsMenu = jest.fn();
		const cancelLongPress = jest.fn();
		const hideMobileContextMenu = jest.fn();
		const closeAllMenus = jest.fn();
		const root = {
			classList: {toggle: jest.fn()},
			getAttribute: jest.fn(() => null),
			setAttribute: jest.fn(),
			querySelectorAll: jest.fn(() => [edit, customButton, draggable, characterSelect, exportButton, moreButton]),
		};
		const documentPrevious = globalThis.document;
		const mobilePrevious = globalThis._charsheetMobile;
		const contextUtilPrevious = globalThis.ContextUtil;
		globalThis.document = {
			querySelector: () => root,
			querySelectorAll: () => [stalePortal],
		};
		globalThis._charsheetMobile = {
			_cancelLongPress: cancelLongPress,
			_hideContextMenu: hideMobileContextMenu,
		};
		globalThis.ContextUtil = {...contextUtilPrevious, closeAllMenus};
		const host = {
			_currentCharacterAccess: "dm_readonly",
			_spells: {_closeCastOptionsMenu: closeCastOptionsMenu},
			_closeCharacterScopedTransientUi: jest.fn(),
			_updateSaveIndicator: jest.fn(),
		};
		try {
			CharacterSheetPage.prototype._applyCharacterAccessMode.call(host);
		} finally {
			globalThis.document = documentPrevious;
			if (mobilePrevious) globalThis._charsheetMobile = mobilePrevious;
			else delete globalThis._charsheetMobile;
			globalThis.ContextUtil = contextUtilPrevious;
		}

		expect(edit.disabled).toBe(true);
		expect(edit.setAttribute).toHaveBeenCalledWith("aria-disabled", "true");
		expect(customButton.setAttribute).toHaveBeenCalledWith("tabindex", "-1");
		expect(customButton.setAttribute).toHaveBeenCalledWith("aria-disabled", "true");
		expect(draggable.setAttribute).toHaveBeenCalledWith("draggable", "false");
		expect(characterSelect.disabled).toBe(false);
		expect(exportButton.disabled).toBe(false);
		expect(moreButton.disabled).toBe(false);
		expect(stalePortal.remove).toHaveBeenCalledTimes(2);
		expect(closeCastOptionsMenu).toHaveBeenCalledTimes(1);
		expect(cancelLongPress).toHaveBeenCalledTimes(1);
		expect(hideMobileContextMenu).toHaveBeenCalledTimes(1);
		expect(closeAllMenus).toHaveBeenCalledTimes(1);
		expect(host._closeCharacterScopedTransientUi).toHaveBeenCalledTimes(1);
		expect(host._updateSaveIndicator).toHaveBeenCalledWith("readonly");

		host._currentCharacterAccess = "owner";
		globalThis.document = {querySelector: () => root, querySelectorAll: () => []};
		try {
			CharacterSheetPage.prototype._applyCharacterAccessMode.call(host);
		} finally {
			globalThis.document = documentPrevious;
		}
		expect(customButton.setAttribute).toHaveBeenCalledWith("tabindex", "0");
		expect(customButton.removeAttribute).toHaveBeenCalledWith("aria-disabled");
		expect(draggable.setAttribute).toHaveBeenCalledWith("draggable", "true");
	});

	it("keeps read-only DM views live without activating owner-only integrations", () => {
		const host = {
			_currentCharacterAccess: "dm_readonly",
			_hubRealtimeGeneration: 0,
			_hubEffects: {activate: jest.fn(), deactivate: jest.fn()},
			_peerTargeting: {activate: jest.fn(), deactivate: jest.fn()},
			_partyInventory: {pAttach: jest.fn(), detach: jest.fn()},
			_hubRealtime: {attach: jest.fn(() => true)},
		};

		expect(CharacterSheetPage.prototype._attachHubRealtime.call(host, {characterId: "player-character"})).toBe(true);
		expect(host._hubRealtime.attach).toHaveBeenCalledWith({characterId: "player-character"});
		expect(host._hubEffects.activate).not.toHaveBeenCalled();
		expect(host._peerTargeting.activate).not.toHaveBeenCalled();
		expect(host._partyInventory.pAttach).not.toHaveBeenCalled();
		expect(host._hubEffects.deactivate).toHaveBeenCalled();
		expect(host._peerTargeting.deactivate).toHaveBeenCalled();
		expect(host._partyInventory.detach).toHaveBeenCalled();
	});

	it("replaces a DM read-only projection after an ordinary character invalidation without saving", async () => {
		let loaded = null;
		const repository = {
			pGet: jest.fn(async () => ({id: "player-character", name: "Updated by owner", hp: {current: 7, max: 12}})),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			pAcquireLease: jest.fn(),
			pUpsert: jest.fn(),
		};
		const host = Object.assign(Object.create(CharacterSheetPage.prototype), {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubCampaignId: "campaign-1",
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_hubReadOnlyRefreshRequest: null,
			_hubReadOnlyRefreshPromise: null,
			_hubContext: {rulesVersion: {rules: {thelemar_carryWeight: false}}},
			_state: {
				loadFromJson: data => loaded = structuredClone(data),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
			_updateCharacterDropdown: jest.fn(),
		});

		await expect(CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, {
			characterId: "player-character",
		})).resolves.toBe(true);

		expect(repository.pGet).toHaveBeenCalledWith({characterId: "player-character"});
		expect(loaded).toEqual(expect.objectContaining({name: "Updated by owner", hp: {current: 7, max: 12}}));
		expect(host._state.setCampaignSettingsOverlay).toHaveBeenCalledWith(expect.objectContaining({thelemar_carryWeight: false}));
		expect(host._reconcileClassFeatures).toHaveBeenCalledTimes(1);
		expect(host._renderCharacter).toHaveBeenCalledTimes(1);
		expect(repository.pAcquireLease).not.toHaveBeenCalled();
		expect(repository.pUpsert).not.toHaveBeenCalled();
	});

	it("single-flights burst DM invalidations and coalesces one trailing read per pending burst", async () => {
		const first = makeDeferred();
		const trailing = makeDeferred();
		const final = makeDeferred();
		const responses = [first, trailing, final];
		const loaded = [];
		const listeners = new Map();
		let activeReads = 0;
		let maxActiveReads = 0;
		const repository = {
			pGet: jest.fn(() => {
				const deferred = responses[repository.pGet.mock.calls.length - 1];
				activeReads++;
				maxActiveReads = Math.max(maxActiveReads, activeReads);
				return deferred.promise.finally(() => activeReads--);
			}),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			getPendingRecovery: jest.fn(() => null),
		};
		const host = Object.assign(Object.create(CharacterSheetPage.prototype), {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubCampaignId: "campaign-1",
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_hubReadOnlyRefreshRequest: null,
			_hubReadOnlyRefreshPromise: null,
			_isHubReadOnlyRefreshRequired: false,
			_isHubRealtimeListenersBound: false,
			_hubRealtime: {on: jest.fn((type, listener) => listeners.set(type, listener))},
			_hubContext: null,
			_hubEffects: {onConnectionState: jest.fn()},
			_peerTargeting: {deactivate: jest.fn()},
			_state: {
				loadFromJson: data => loaded.push(structuredClone(data)),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
			_canRestoreHubRealtimeAfterError: () => true,
			isCurrentCharacterReadOnly: () => true,
		});
		host._initHubRealtimeListeners();

		const pending = host._pRefreshHubReadOnlyCharacter({characterId: "player-character"});
		for (let ix = 0; ix < 50; ix++) {
			listeners.get("projectionInvalidated")({characterId: "player-character"});
			if (ix % 10 === 0) host._onHubRealtimeConnectionState({state: "live"});
		}

		expect(repository.pGet).toHaveBeenCalledTimes(1);
		expect(maxActiveReads).toBe(1);

		first.resolve({id: "player-character", name: "Intermediate owner update"});
		await new Promise(resolve => setImmediate(resolve));
		expect(repository.pGet).toHaveBeenCalledTimes(2);
		expect(loaded).toEqual([expect.objectContaining({name: "Intermediate owner update"})]);

		for (let ix = 0; ix < 50; ix++) {
			listeners.get("projectionInvalidated")({characterId: "player-character"});
			if (ix % 10 === 0) host._onHubRealtimeConnectionState({state: "live"});
		}
		expect(repository.pGet).toHaveBeenCalledTimes(2);

		trailing.resolve({id: "player-character", name: "Later owner update"});
		await new Promise(resolve => setImmediate(resolve));
		expect(repository.pGet).toHaveBeenCalledTimes(3);
		expect(loaded).toEqual([
			expect.objectContaining({name: "Intermediate owner update"}),
			expect.objectContaining({name: "Later owner update"}),
		]);

		final.resolve({id: "player-character", name: "Newest owner update"});
		await pending;
		await new Promise(resolve => setImmediate(resolve));

		expect(repository.pGet).toHaveBeenCalledTimes(3);
		expect(maxActiveReads).toBe(1);
		expect(loaded).toEqual([
			expect.objectContaining({name: "Intermediate owner update"}),
			expect.objectContaining({name: "Later owner update"}),
			expect.objectContaining({name: "Newest owner update"}),
		]);
		expect(host._renderCharacter).toHaveBeenCalledTimes(3);
		expect(host._isHubReadOnlyRefreshRequired).toBe(false);
	});

	it.each([
		["a character switch", host => {
			host._currentCharacterId = "other-character";
			host._characterLoadGeneration++;
		}],
		["a campaign switch", host => {
			host._hubCampaignId = "campaign-2";
		}],
		["an authority transition to owner", host => {
			host._currentCharacterAccess = CHARACTER_ACCESS_MODES.OWNER;
		}],
	])("fences queued DM read-only refreshes after %s", async (_label, applyTransition) => {
		const refresh = makeDeferred();
		const repository = {
			pGet: jest.fn(() => refresh.promise),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
		};
		const host = Object.assign(Object.create(CharacterSheetPage.prototype), {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubCampaignId: "campaign-1",
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_hubReadOnlyRefreshRequest: null,
			_hubReadOnlyRefreshPromise: null,
			_isHubReadOnlyRefreshRequired: false,
			_state: {
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
			_canRestoreHubRealtimeAfterError: () => true,
		});

		const pending = host._pRefreshHubReadOnlyCharacter({characterId: "player-character"});
		void host._pRefreshHubReadOnlyCharacter({characterId: "player-character"});
		expect(repository.pGet).toHaveBeenCalledTimes(1);

		applyTransition(host);
		refresh.resolve({id: "player-character", name: "Stale owner update"});
		await pending;
		await new Promise(resolve => setImmediate(resolve));

		expect(repository.pGet).toHaveBeenCalledTimes(1);
		expect(host._state.loadFromJson).not.toHaveBeenCalled();
		expect(host._renderCharacter).not.toHaveBeenCalled();
	});

	it("discards a late DM read-only projection after the character changes", async () => {
		const refresh = makeDeferred();
		const repository = {
			pGet: jest.fn(() => refresh.promise),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
		};
		const host = Object.assign(Object.create(CharacterSheetPage.prototype), {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubCampaignId: "campaign-1",
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_hubReadOnlyRefreshRequest: null,
			_hubReadOnlyRefreshPromise: null,
			_state: {
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
		});

		const pending = CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, {
			characterId: "player-character",
		});
		host._currentCharacterId = "other-character";
		host._characterLoadGeneration++;
		refresh.resolve({id: "player-character", name: "Stale owner update"});

		await expect(pending).resolves.toBe(false);
		expect(host._state.loadFromJson).not.toHaveBeenCalled();
		expect(host._renderCharacter).not.toHaveBeenCalled();
	});

	it("discards a late DM read-only projection after the realtime binding changes", async () => {
		const refresh = makeDeferred();
		const repository = {
			pGet: jest.fn(() => refresh.promise),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
		};
		const host = Object.assign(Object.create(CharacterSheetPage.prototype), {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubCampaignId: "campaign-1",
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_hubReadOnlyRefreshRequest: null,
			_hubReadOnlyRefreshPromise: null,
			_state: {
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
		});

		const pending = CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, {
			characterId: "player-character",
		});
		host._hubRealtimeGeneration++;
		refresh.resolve({id: "player-character", name: "Stale owner update"});

		await expect(pending).resolves.toBe(false);
		expect(host._state.loadFromJson).not.toHaveBeenCalled();
		expect(host._renderCharacter).not.toHaveBeenCalled();
	});

	it("conceals a DM read-only projection when its scoped access is revoked", async () => {
		const accessError = Object.assign(new Error("Character is no longer visible."), {
			code: "CHARACTER_PROJECTION_SCOPED",
		});
		const host = Object.assign(Object.create(CharacterSheetPage.prototype), {
			_characterRepository: {
				pGet: jest.fn(async () => { throw accessError; }),
				getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			},
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubCampaignId: "campaign-1",
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_hubReadOnlyRefreshRequest: null,
			_hubReadOnlyRefreshPromise: null,
			_onHubRealtimeConnectionState: jest.fn(),
		});

		await expect(CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, {
			characterId: "player-character",
		})).resolves.toBe(false);
		expect(host._onHubRealtimeConnectionState).toHaveBeenCalledWith(expect.objectContaining({
			state: "closed",
			isCharacterAccessEnded: true,
		}));
	});

	it("retries a failed DM projection refresh when the realtime connection returns live", async () => {
		let loaded = null;
		const repository = {
			pGet: jest.fn()
				.mockRejectedValueOnce(new Error("temporary network failure"))
				.mockResolvedValueOnce({id: "player-character", name: "Recovered owner update"}),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			clearRealtimeReconciliation: jest.fn(),
		};
		const host = Object.assign(Object.create(CharacterSheetPage.prototype), {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubCampaignId: "campaign-1",
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_hubReadOnlyRefreshRequest: null,
			_hubReadOnlyRefreshPromise: null,
			_isHubReadOnlyRefreshRequired: false,
			_hubContext: null,
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_isHubContextRevalidationRequired: false,
			_hubRulesRefreshBlocked: false,
			_state: {
				loadFromJson: data => loaded = structuredClone(data),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
			_canRestoreHubRealtimeAfterError: () => true,
			_hubEffects: {onConnectionState: jest.fn()},
			_peerTargeting: {deactivate: jest.fn()},
			isCurrentCharacterReadOnly: () => true,
			_clearHubRules: jest.fn(),
			_campaign: {render: jest.fn()},
		});

		await expect(host._pRefreshHubReadOnlyCharacter({characterId: "player-character"})).resolves.toBe(false);
		expect(host._isHubReadOnlyRefreshRequired).toBe(true);
		CharacterSheetPage.prototype._onHubRealtimeConnectionState.call(host, {state: "closed"});
		CharacterSheetPage.prototype._onHubRealtimeConnectionState.call(host, {state: "live"});
		await new Promise(resolve => setImmediate(resolve));

		expect(repository.pGet).toHaveBeenCalledTimes(2);
		expect(loaded).toEqual(expect.objectContaining({name: "Recovered owner update"}));
		expect(host._renderCharacter).toHaveBeenCalledTimes(1);
		expect(host._isHubReadOnlyRefreshRequired).toBe(false);
	});

	it("does not reactivate owner-only peer targeting on live read-only connection states", () => {
		const host = {
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			isCurrentCharacterReadOnly: () => true,
			_hubEffects: {onConnectionState: jest.fn()},
			_peerTargeting: {onConnectionState: jest.fn(), deactivate: jest.fn()},
			_isHubContextRevalidationRequired: false,
			_hubRulesRefreshBlocked: false,
		};

		CharacterSheetPage.prototype._onHubRealtimeConnectionState.call(host, {state: "live"});
		CharacterSheetPage.prototype._onHubRealtimeConnectionState.call(host, {state: "live", isReconnect: true});

		expect(host._peerTargeting.onConnectionState).not.toHaveBeenCalled();
		expect(host._peerTargeting.deactivate).toHaveBeenCalledTimes(2);
	});

	it("subscribes DM read-only views to character projection invalidations only", () => {
		const listeners = new Map();
		const host = {
			_hubRealtime: {
				on: jest.fn((type, listener) => listeners.set(type, listener)),
			},
			_isHubRealtimeListenersBound: false,
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_pRefreshHubReadOnlyCharacter: jest.fn(),
			_onHubProjectionInvalidated: jest.fn(),
			_onHubRealtimeCursor: jest.fn(),
			_onHubSemanticOperation: jest.fn(),
			_onHubRealtimeConnectionState: jest.fn(),
			_onHubCampaignContextChanged: jest.fn(),
			_onHubRealtimeDeliveryError: jest.fn(),
			_pRefreshHubRules: jest.fn(),
		};

		expect(CharacterSheetPage.prototype._initHubRealtimeListeners.call(host)).toBe(true);
		listeners.get("projectionInvalidated")({characterId: "player-character"});
		expect(host._pRefreshHubReadOnlyCharacter).toHaveBeenCalledWith({characterId: "player-character"});

		host._currentCharacterAccess = CHARACTER_ACCESS_MODES.OWNER;
		listeners.get("projectionInvalidated")({characterId: "owner-character"});
		expect(host._pRefreshHubReadOnlyCharacter).toHaveBeenCalledTimes(1);
		expect(host._onHubProjectionInvalidated).toHaveBeenCalledWith({characterId: "owner-character"});
	});

	it("blocks non-control mutation gestures in a DM read-only sheet", () => {
		const listeners = {};
		const root = {
			dataset: {},
			addEventListener: jest.fn((type, listener) => listeners[type] = listener),
		};
		const documentPrevious = globalThis.document;
		globalThis.document = {querySelector: () => root};
		const host = {_currentCharacterAccess: "dm_readonly"};
		try {
			CharacterSheetPage.prototype._initReadOnlyInteractionGuard.call(host);
			const blocked = {
				target: {closest: () => null},
				preventDefault: jest.fn(),
				stopImmediatePropagation: jest.fn(),
			};
			listeners.click(blocked);
			expect(blocked.preventDefault).toHaveBeenCalled();
			expect(blocked.stopImmediatePropagation).toHaveBeenCalled();

			for (const key of ["Enter", " "]) {
				const keyboardActivation = {
					type: "keydown",
					key,
					target: {closest: () => null},
					preventDefault: jest.fn(),
					stopImmediatePropagation: jest.fn(),
				};
				listeners.keydown(keyboardActivation);
				expect(keyboardActivation.preventDefault).toHaveBeenCalled();
				expect(keyboardActivation.stopImmediatePropagation).toHaveBeenCalled();
			}

			for (const type of ["contextmenu", "dragstart", "dragover", "drop"]) {
				const drag = {
					type,
					target: {closest: () => null},
					preventDefault: jest.fn(),
					stopImmediatePropagation: jest.fn(),
				};
				listeners[type](drag);
				expect(drag.preventDefault).toHaveBeenCalled();
				expect(drag.stopImmediatePropagation).toHaveBeenCalled();
			}

			const keyboardNavigation = {
				type: "keydown",
				key: "Tab",
				target: {closest: () => null},
				preventDefault: jest.fn(),
				stopImmediatePropagation: jest.fn(),
			};
			listeners.keydown(keyboardNavigation);
			expect(keyboardNavigation.preventDefault).not.toHaveBeenCalled();

			const navigation = {
				target: {closest: () => ({id: "charsheet-sel-character"})},
				preventDefault: jest.fn(),
				stopImmediatePropagation: jest.fn(),
			};
			listeners.change(navigation);
			expect(navigation.preventDefault).not.toHaveBeenCalled();
		} finally {
			globalThis.document = documentPrevious;
		}
	});

	it("adopts a canonical id when loading through a temporary recovery URL", async () => {
		const previousLocation = globalThis.window.location;
		const previousHistory = globalThis.window.history;
		globalThis.window.location = new URL("http://test/charactersheet.html?campaign=campaign-1&id=temporary-id");
		globalThis.window.history = {replaceState: jest.fn()};
		const state = {
			clearCampaignSettingsOverlay: jest.fn(),
			loadFromJson: jest.fn(),
			setCampaignSettingsOverlay: jest.fn(),
			getBackgroundTheme: jest.fn(() => null),
			getViewMode: jest.fn(() => "sheet"),
		};
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: null,
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(async ({characterId}) => {
					expect(characterId).toBe("temporary-id");
					return {id: "server-id", name: "Recovered"};
				}),
			},
			_state: state,
			_hubContext: null,
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_reconcilePersistedCharacter: CharacterSheetPage.prototype._reconcilePersistedCharacter,
			_reconcileClassFeatures: jest.fn(() => null),
			_ensureLinguisticsSkillIfNeeded: jest.fn(),
			_renderCharacter: jest.fn(),
			_applyBackgroundTheme: jest.fn(),
			_updateThemePickerSelection: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_layout: null,
			_playMode: null,
		};

		try {
			await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "temporary-id")).resolves.toBe(true);
			expect(host._currentCharacterId).toBe("server-id");
			expect(host._closeCharacterScopedTransientUi.mock.calls).toEqual([
				[{isRetainCurrentCharacterUi: true}],
				[],
			]);
			expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});
			expect(globalThis.window.history.replaceState).toHaveBeenCalledWith(
				{},
				"",
				expect.objectContaining({searchParams: expect.any(URLSearchParams)}),
			);
		} finally {
			globalThis.window.location = previousLocation;
			globalThis.window.history = previousHistory;
		}
	});

	it("does not redirect a stale campaign-mismatch load over a newer selection", async () => {
		const load = makeDeferred();
		const previousLocation = globalThis.window.location;
		globalThis.window.location = {replace: jest.fn()};
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_characterRepository: {pGet: jest.fn(() => load.promise)},
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
		};
		try {
			const pending = CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-old");
			await Promise.resolve();
			host._characterLoadGeneration++;
			host._currentCharacterId = "character-new";
			load.reject(Object.assign(new Error("moved"), {
				code: "CHARACTER_CAMPAIGN_MISMATCH",
				campaignId: "campaign-new",
				characterId: "character-old",
			}));
			await expect(pending).resolves.toBe(false);
			expect(globalThis.window.location.replace).not.toHaveBeenCalled();
		} finally {
			globalThis.window.location = previousLocation;
		}
	});

	it("stops a repaired load after its save becomes stale", async () => {
		const repairSave = makeDeferred();
		const previousLocation = globalThis.window.location;
		const previousHistory = globalThis.window.history;
		globalThis.window.location = new URL("http://test/charactersheet.html?id=character-a");
		globalThis.window.history = {replaceState: jest.fn()};
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_currentCharacterAccess: "owner",
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(async () => ({id: "character-old", name: "Old"})),
				getCharacterAccess: jest.fn(() => "owner"),
			},
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(),
			},
			_reconcilePersistedCharacter: CharacterSheetPage.prototype._reconcilePersistedCharacter,
			_reconcileClassFeatures: jest.fn(() => ({added: 1, backfilled: 0})),
			_ensureLinguisticsSkillIfNeeded: jest.fn(),
			_renderCharacter: jest.fn(),
			_saveCurrentCharacter: jest.fn(() => repairSave.promise),
			_state: {
				clearCampaignSettingsOverlay: jest.fn(),
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
				getBackgroundTheme: jest.fn(() => null),
				getViewMode: jest.fn(() => "sheet"),
			},
			_hubContext: null,
			_layout: {applySavedLayout: jest.fn()},
			_applyBackgroundTheme: jest.fn(),
			_updateThemePickerSelection: jest.fn(),
			_playMode: {activate: jest.fn(), deactivate: jest.fn()},
			_selCharacter: {value: ""},
		};
		try {
			const pending = CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-old");
			await Promise.resolve();
			await Promise.resolve();
			expect(host._saveCurrentCharacter).toHaveBeenCalledTimes(1);
			host._characterLoadGeneration++;
			host._currentCharacterId = "character-new";
			repairSave.resolve(true);
			await expect(pending).resolves.toBe(false);
		} finally {
			globalThis.window.location = previousLocation;
			globalThis.window.history = previousHistory;
		}

		expect(host._layout.applySavedLayout).not.toHaveBeenCalled();
		expect(host._applyBackgroundTheme).not.toHaveBeenCalled();
		expect(host._playMode.deactivate).not.toHaveBeenCalled();
		expect(host._campaign.pRefreshCurrentCharacter).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("applies remote fields while preserving edits made during the save", async () => {
		let callCount = 0;
		let loaded = null;
		const state = {
			toJson: () => ++callCount === 1
				? {name: "Mira", xp: 100, hp: {current: 10}}
				: {name: "Mira", xp: 100, hp: {current: 9}},
			loadFromJson: data => loaded = structuredClone(data),
		};
		const host = {
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pUpsert: async () => ({id: "c", name: "Mira", xp: 200, hp: {current: 10}}),
			},
			_currentCharacterId: "c",
			_state: state,
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(loaded).toEqual(expect.objectContaining({xp: 200, hp: {current: 9}}));
	});

	it("does not create a new character after the current cloud save fails", async () => {
		const host = {
			_currentCharacterId: "cloud-character",
			_selCharacter: {value: "cloud-character"},
			_saveCurrentCharacter: jest.fn(async () => false),
			_createNewCharacter: jest.fn(),
			_showTab: jest.fn(),
			switchToTab: jest.fn(),
		};

		await CharacterSheetPage.prototype._onNewCharacter.call(host);

		expect(host._createNewCharacter).not.toHaveBeenCalled();
		expect(host._showTab).not.toHaveBeenCalled();
	});

	it("does not continue a superseded character selection after its save settles", async () => {
		const save = makeDeferred();
		const host = {
			_characterLoadGeneration: 1,
			_currentCharacterId: "character-a",
			_selCharacter: {value: "character-b"},
			_saveCurrentCharacter: jest.fn(() => save.promise),
			_clearLastHpChange: jest.fn(),
			_pLoadCharacter: jest.fn(),
			_createNewCharacter: jest.fn(),
		};

		const pending = CharacterSheetPage.prototype._onCharacterSelect.call(host);
		host._selCharacter.value = "character-c";
		save.resolve(true);
		await pending;

		expect(host._clearLastHpChange).not.toHaveBeenCalled();
		expect(host._pLoadCharacter).not.toHaveBeenCalled();
		expect(host._createNewCharacter).not.toHaveBeenCalled();
		expect(host._selCharacter.value).toBe("character-c");
	});

	it("does not continue a superseded new-character action after its save settles", async () => {
		const save = makeDeferred();
		const host = {
			_characterLoadGeneration: 1,
			_currentCharacterId: "character-a",
			_selCharacter: {value: "character-a"},
			_saveCurrentCharacter: jest.fn(() => save.promise),
			_createNewCharacter: jest.fn(),
			_showTab: jest.fn(),
			switchToTab: jest.fn(),
		};

		const pending = CharacterSheetPage.prototype._onNewCharacter.call(host);
		host._currentCharacterId = "character-c";
		host._characterLoadGeneration++;
		save.resolve(true);
		await pending;

		expect(host._createNewCharacter).not.toHaveBeenCalled();
		expect(host._showTab).not.toHaveBeenCalled();
		expect(host.switchToTab).not.toHaveBeenCalled();
	});

	it("does not continue a superseded duplicate action after its save settles", async () => {
		const save = makeDeferred();
		const host = {
			_characterLoadGeneration: 1,
			_currentCharacterId: "character-a",
			_saveCurrentCharacter: jest.fn()
				.mockImplementationOnce(() => save.promise)
				.mockResolvedValueOnce(true),
			_state: {
				toJson: jest.fn(() => ({id: "character-a", name: "A"})),
				loadFromJson: jest.fn(),
			},
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pLoadCharacters: jest.fn(),
			_pRefreshPersistedCharacterUi: jest.fn(),
			_selCharacter: {value: "character-a"},
		};

		const pending = CharacterSheetPage.prototype._onDuplicateCharacter.call(host);
		host._currentCharacterId = "character-c";
		host._characterLoadGeneration++;
		save.resolve(true);
		await pending;

		expect(host._state.toJson).not.toHaveBeenCalled();
		expect(host._closeCharacterScopedTransientUi).not.toHaveBeenCalled();
		expect(host._detachHubRealtime).not.toHaveBeenCalled();
	});

	it("refreshes the roster without restoring a duplicate that committed after supersession", async () => {
		const duplicateSave = makeDeferred();
		const host = {
			_characterLoadGeneration: 1,
			_currentCharacterId: "character-a",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_saveCurrentCharacter: jest.fn()
				.mockResolvedValueOnce(true)
				.mockImplementationOnce(() => duplicateSave.promise),
			_state: {
				toJson: jest.fn(() => ({id: "character-a", name: "A"})),
				loadFromJson: jest.fn(),
			},
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pRefreshCharacterRosterAfterCommittedStaleCreate: jest.fn(async () => {}),
			_pLoadCharacters: jest.fn(),
			_selCharacter: {value: "character-a"},
		};

		const pending = CharacterSheetPage.prototype._onDuplicateCharacter.call(host);
		await Promise.resolve();
		host._currentCharacterId = "character-c";
		host._characterLoadGeneration++;
		duplicateSave.resolve(true);
		await pending;

		expect(host._currentCharacterId).toBe("character-c");
		expect(host._pRefreshCharacterRosterAfterCommittedStaleCreate).toHaveBeenCalledTimes(1);
		expect(host._pLoadCharacters).not.toHaveBeenCalled();
		expect(host._selCharacter.value).toBe("character-a");
	});

	it("does not continue a superseded file import after its save settles", async () => {
		const save = makeDeferred();
		const inputPrevious = globalThis.InputUiUtil.pGetUserUploadJson;
		globalThis.InputUiUtil.pGetUserUploadJson = jest.fn(async () => ({
			jsons: [{name: "Imported"}],
			errors: [],
		}));
		const host = {
			_characterLoadGeneration: 1,
			_currentCharacterId: "character-a",
			_saveCurrentCharacter: jest.fn()
				.mockImplementationOnce(() => save.promise)
				.mockResolvedValueOnce(true),
			_state: {
				toJson: jest.fn(() => ({id: "character-a", name: "A"})),
				loadFromJson: jest.fn(),
			},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pLoadCharacters: jest.fn(),
			_selCharacter: {value: "character-a"},
			_renderCharacter: jest.fn(),
		};

		try {
			const pending = CharacterSheetPage.prototype._onImportCharacter.call(host);
			await Promise.resolve();
			host._currentCharacterId = "character-c";
			host._characterLoadGeneration++;
			save.resolve(true);
			await pending;
		} finally {
			globalThis.InputUiUtil.pGetUserUploadJson = inputPrevious;
		}

		expect(host._clearLastHpChange).not.toHaveBeenCalled();
		expect(host._state.loadFromJson).not.toHaveBeenCalled();
		expect(host._renderCharacter).not.toHaveBeenCalled();
	});

	it("refreshes the roster without restoring an import that committed after supersession", async () => {
		const importSave = makeDeferred();
		const inputPrevious = globalThis.InputUiUtil.pGetUserUploadJson;
		globalThis.InputUiUtil.pGetUserUploadJson = jest.fn(async () => ({
			jsons: [{name: "Imported"}],
			errors: [],
		}));
		const host = {
			_characterLoadGeneration: 1,
			_currentCharacterId: "character-a",
			_saveCurrentCharacter: jest.fn()
				.mockResolvedValueOnce(true)
				.mockImplementationOnce(() => importSave.promise),
			_state: {
				toJson: jest.fn(() => ({id: "character-a", name: "A"})),
				loadFromJson: jest.fn(),
			},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pRefreshCharacterRosterAfterCommittedStaleCreate: jest.fn(async () => {}),
			_pLoadCharacters: jest.fn(),
			_selCharacter: {value: "character-a"},
			_renderCharacter: jest.fn(),
		};

		try {
			const pending = CharacterSheetPage.prototype._onImportCharacter.call(host);
			await Promise.resolve();
			await Promise.resolve();
			host._currentCharacterId = "character-c";
			host._characterLoadGeneration++;
			importSave.resolve(true);
			await pending;
		} finally {
			globalThis.InputUiUtil.pGetUserUploadJson = inputPrevious;
		}

		expect(host._currentCharacterId).toBe("character-c");
		expect(host._pRefreshCharacterRosterAfterCommittedStaleCreate).toHaveBeenCalledTimes(1);
		expect(host._pLoadCharacters).not.toHaveBeenCalled();
		expect(host._renderCharacter).not.toHaveBeenCalled();
	});

	it("does not adopt an added character after another character loads while create persists", async () => {
		const create = makeDeferred();
		const host = {
			_characterLoadGeneration: 1,
			_currentCharacterId: "character-a",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: false,
			_saveCurrentCharacter: jest.fn(async () => true),
			_characterRepository: {
				pUpsert: jest.fn(() => create.promise),
			},
			_state: {loadFromJson: jest.fn()},
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pRefreshCharacterRosterAfterCommittedStaleCreate: jest.fn(async () => {}),
			_pLoadCharacters: jest.fn(),
			_selCharacter: {value: "character-a"},
			_attachHubRealtime: jest.fn(),
		};

		const pending = CharacterSheetPage.prototype.addCharacter.call(host, {
			toJson: () => ({name: "Imported"}),
		});
		await Promise.resolve();
		host._currentCharacterId = "character-c";
		host._characterLoadGeneration++;
		create.resolve({id: "imported-character", name: "Imported"});
		await expect(pending).resolves.toBe(true);

		expect(host._currentCharacterId).toBe("character-c");
		expect(host._state.loadFromJson).not.toHaveBeenCalled();
		expect(host._closeCharacterScopedTransientUi).not.toHaveBeenCalled();
		expect(host._detachHubRealtime).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
		expect(host._pRefreshCharacterRosterAfterCommittedStaleCreate).toHaveBeenCalledTimes(1);
		expect(host._pLoadCharacters).not.toHaveBeenCalled();
	});

	it("stops persisted UI refresh when its character scope becomes stale", async () => {
		const loadCharacters = makeDeferred();
		const host = {
			_currentCharacterId: "character-a",
			_pLoadCharacters: jest.fn(() => loadCharacters.promise),
			_syncCurrentCharacterDropdownOption: jest.fn(),
			_selCharacter: {value: "character-a"},
			_campaign: {pRefreshCurrentCharacter: jest.fn()},
			_endCurrentHubCharacterAccess: jest.fn(),
		};

		const pending = CharacterSheetPage.prototype._pRefreshPersistedCharacterUi.call(host, {
			characterId: "character-a",
			character: {id: "character-a", name: "A"},
		});
		host._currentCharacterId = "character-b";
		loadCharacters.resolve();
		await pending;

		expect(host._selCharacter.value).toBe("character-a");
		expect(host._campaign.pRefreshCurrentCharacter).not.toHaveBeenCalled();
		expect(host._endCurrentHubCharacterAccess).not.toHaveBeenCalled();
	});

	it("does not import a character after the current cloud save fails", async () => {
		const repository = makeRepository();
		const host = {
			_currentCharacterId: "cloud-character",
			_saveCurrentCharacter: jest.fn(async () => false),
			_characterRepository: repository,
		};

		await expect(CharacterSheetPage.prototype.addCharacter.call(host, {
			toJson: () => ({name: "Imported"}),
		})).resolves.toBe(false);

		expect(repository.pUpsert).not.toHaveBeenCalled();
	});

	it("tears down realtime before creating an unsaved campaign character", () => {
		const host = {
			_characterLoadGeneration: 0,
			_detachHubRealtime: jest.fn(),
			_clearLastHpChange: jest.fn(),
			_currentCharacterId: "canonical-id",
			_isLevelUpBannerDismissed: true,
			_hubContext: null,
			_state: {
				clearCampaignSettingsOverlay: jest.fn(),
				reset: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
				setClassFeatureCatalog: jest.fn(),
				setId: jest.fn(),
			},
			_classFeatures: [],
			_subclassFeatures: [],
			_optionalFeaturesData: [],
			_renderCharacter: jest.fn(),
		};

		CharacterSheetPage.prototype._createNewCharacter.call(host);

		expect(host._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(host._characterLoadGeneration).toBe(1);
		expect(host._isCurrentCharacterNew).toBe(true);
		expect(host._state.setId).toHaveBeenCalledWith(host._currentCharacterId);
	});

	it("keeps the previous subscription attached when a character switch cannot load", async () => {
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-1",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isHubCharacter: true,
			_characterRepository: {
				pGet: jest.fn(async () => { throw new Error("offline"); }),
			},
			_partyInventory: {isAttachedTo: jest.fn(() => true), pAttach: jest.fn()},
			isCurrentCharacterReadOnly: CharacterSheetPage.prototype.isCurrentCharacterReadOnly,
			_reattachRetainedHubCharacterIntegrations: CharacterSheetPage.prototype._reattachRetainedHubCharacterIntegrations,
			_attachHubRealtime: jest.fn(),
			_detachHubRealtime: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-2"))
			.rejects.toThrow("offline");

		expect(host._detachHubRealtime).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
		expect(host._partyInventory.pAttach).toHaveBeenCalledWith({
			characterId: "character-1",
			generation: 1,
		});
	});

	it("conceals stale DM truth when a disconnected role-demoted viewer selects another character", async () => {
		const loadError = Object.assign(new Error("Target is now peer-profile scoped."), {
			code: "CHARACTER_PROJECTION_SCOPED",
		});
		const main = {
			hidden: false,
			replaceChildren: jest.fn(),
			before: jest.fn(),
		};
		const accessEndedMessage = {setAttribute: jest.fn()};
		const previousDocument = globalThis.document;
		globalThis.document = {
			body: {append: jest.fn()},
			createElement: jest.fn(() => accessEndedMessage),
			getElementById: jest.fn(() => null),
			querySelector: jest.fn(() => main),
		};
		const host = Object.assign(Object.create(CharacterSheetPage.prototype), {
			_characterRepository: {
				pGet: jest.fn(async () => { throw loadError; }),
				clearRealtimeReconciliation: jest.fn(),
			},
			_characterLoadGeneration: 4,
			_currentCharacterId: "private-character-a",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_isHubCharacter: true,
			_isCurrentCharacterNew: false,
			_selCharacter: {value: "target-character-b"},
			_state: {
				reset: jest.fn(),
				clearCampaignSettingsOverlay: jest.fn(),
				setCarryAuthorityContext: jest.fn(),
			},
			_closeCharacterScopedTransientUi: jest.fn(),
			_hubRealtimeGeneration: 2,
			_hubRealtime: {detach: jest.fn()},
			_isHubReadOnlyRefreshRequired: false,
			_hubEffects: {onConnectionState: jest.fn(), deactivate: jest.fn()},
			_peerTargeting: {deactivate: jest.fn(), onConnectionState: jest.fn()},
			_partyInventory: {
				isAttachedTo: jest.fn(() => true),
				detach: jest.fn(),
				pAttach: jest.fn(),
			},
			_campaign: {resetCharacterScope: jest.fn(), render: jest.fn()},
			_hubActiveCampaign: {pHandleSurfaceRoleLoss: jest.fn(async () => {})},
			_reattachRetainedHubCharacterIntegrations: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_hubContextGeneration: 0,
			_hubRulesRefreshGeneration: 0,
			_hubReadOnlyRefreshGeneration: 0,
		});

		try {
			await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "target-character-b"))
				.rejects.toBe(loadError);
			await Promise.resolve();
		} finally {
			globalThis.document = previousDocument;
		}

		expect(host._currentCharacterId).toBeNull();
		expect(host._currentCharacterAccess).toBe(CHARACTER_ACCESS_MODES.OWNER);
		expect(host._state.reset).toHaveBeenCalledTimes(1);
		expect(main.replaceChildren).toHaveBeenCalledTimes(1);
		expect(main.hidden).toBe(true);
		expect(accessEndedMessage).toMatchObject({
			id: "charsheet-campaign-access-ended",
			textContent: "Campaign access ended. Reload or return to the Campaign Hub.",
		});
		expect(host._selCharacter.value).toBe("target-character-b");
		expect(host._hubRealtime.detach).toHaveBeenCalledTimes(1);
		expect(host._partyInventory.detach).toHaveBeenCalledTimes(1);
		expect(host._partyInventory.pAttach).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
		expect(host._reattachRetainedHubCharacterIntegrations).not.toHaveBeenCalled();
		expect(host._hubActiveCampaign.pHandleSurfaceRoleLoss).toHaveBeenCalledTimes(1);
	});

	it.each([
		{
			label: "an owner receives a scoped-projection error",
			accessMode: CHARACTER_ACCESS_MODES.OWNER,
			error: Object.assign(new Error("Unexpected scoped owner response."), {code: "CHARACTER_PROJECTION_SCOPED"}),
		},
		{
			label: "a DM read-only replacement load fails transiently",
			accessMode: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			error: Object.assign(new Error("Temporary network failure."), {code: "NETWORK_UNAVAILABLE"}),
		},
	])("keeps replacement-load recovery when $label", async ({accessMode, error}) => {
		const host = {
			_characterRepository: {pGet: jest.fn(async () => { throw error; })},
			_characterLoadGeneration: 8,
			_currentCharacterId: "character-a",
			_currentCharacterAccess: accessMode,
			_isHubCharacter: true,
			_selCharacter: {value: "character-b"},
			_closeCharacterScopedTransientUi: jest.fn(),
			_partyInventory: {isAttachedTo: jest.fn(() => false)},
			_reattachRetainedHubCharacterIntegrations: jest.fn(),
			_onHubRealtimeConnectionState: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b")).rejects.toBe(error);

		expect(host._selCharacter.value).toBe("character-a");
		expect(host._reattachRetainedHubCharacterIntegrations).toHaveBeenCalledWith({
			characterId: "character-a",
			generation: 9,
			isPartyInventoryAttached: false,
		});
		expect(host._onHubRealtimeConnectionState).not.toHaveBeenCalledWith(expect.objectContaining({
			state: "closed",
			isCharacterAccessEnded: true,
			accessEndCause: CHARACTER_REALTIME_ACCESS_END_CAUSES.SURFACE_ROLE,
		}));
	});

	it("does not create a party-inventory attachment after a failed initial character load", async () => {
		const loadError = new Error("offline");
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "placeholder-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isHubCharacter: true,
			_characterRepository: {
				pGet: jest.fn(async () => { throw loadError; }),
			},
			_partyInventory: {
				isAttachedTo: jest.fn(() => false),
				pAttach: jest.fn(),
			},
			isCurrentCharacterReadOnly: CharacterSheetPage.prototype.isCurrentCharacterReadOnly,
			_reattachRetainedHubCharacterIntegrations: CharacterSheetPage.prototype._reattachRetainedHubCharacterIntegrations,
		};

		await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b"))
			.rejects.toBe(loadError);

		expect(host._partyInventory.isAttachedTo).toHaveBeenCalledWith({characterId: "placeholder-character"});
		expect(host._partyInventory.pAttach).not.toHaveBeenCalled();
	});

	it.each(["CHARACTER_NOT_FOUND", "FORBIDDEN"])("keeps the previous character fully attached when the selected target fails with %s", async code => {
		const terminalError = Object.assign(new Error("unavailable target"), {code, status: 404});
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_selCharacter: {value: "character-b"},
			_characterRepository: {
				pGet: jest.fn(async () => { throw terminalError; }),
			},
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_partyInventory: {isAttachedTo: jest.fn(() => true), pAttach: jest.fn()},
			isCurrentCharacterReadOnly: CharacterSheetPage.prototype.isCurrentCharacterReadOnly,
			_reattachRetainedHubCharacterIntegrations: CharacterSheetPage.prototype._reattachRetainedHubCharacterIntegrations,
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(),
			},
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b"))
			.rejects.toBe(terminalError);

		expect(host._currentCharacterId).toBe("character-a");
		expect(host._selCharacter.value).toBe("character-a");
		expect(host._detachHubRealtime).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
		expect(host._partyInventory.pAttach).toHaveBeenCalledWith({
			characterId: "character-a",
			generation: 1,
		});
		expect(host._campaign.resetCharacterScope).not.toHaveBeenCalled();
		expect(host._endCurrentHubCharacterAccess).not.toHaveBeenCalled();
	});

	it("preserves retained roll history and mobile status when a replacement character fails to load", async () => {
		const loadError = new Error("offline");
		const rollHistory = {
			_rolls: [{title: "Attack", total: 17}],
			resetCharacterScopeUi: jest.fn(() => { rollHistory._rolls = []; }),
		};
		const mobile = {
			_isCharacterScopeUiSuspended: false,
			_statusModels: {hp: {current: 12, max: 18}},
			resetCharacterScopeUi: jest.fn(() => {
				mobile._isCharacterScopeUiSuspended = true;
				mobile._statusModels = {};
			}),
		};
		const previousMobile = globalThis._charsheetMobile;
		globalThis._charsheetMobile = mobile;
		const closeModalsSpy = jest.spyOn(CharacterSheetModal, "closeCharacterScopeModals").mockResolvedValue();
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_selCharacter: {value: "character-b"},
			_characterRepository: {
				pGet: jest.fn(async () => { throw loadError; }),
			},
			_closeCharacterScopedTransientUi: CharacterSheetPage.prototype._closeCharacterScopedTransientUi,
			_notes: {cancelActiveDrag: jest.fn()},
			_playMode: {resetCharacterScopeUi: jest.fn()},
			_spells: {_closeCastOptionsMenu: jest.fn()},
			_rollHistory: rollHistory,
			_dice3d: {resetCharacterScopeUi: jest.fn()},
			_builder: {resetCharacterScopeUi: jest.fn()},
		};
		try {
			await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b"))
				.rejects.toBe(loadError);
			expect(closeModalsSpy).toHaveBeenCalledTimes(1);
			expect(host._notes.cancelActiveDrag).toHaveBeenCalledTimes(1);
			expect(host._playMode.resetCharacterScopeUi).toHaveBeenCalledTimes(1);
			expect(host._spells._closeCastOptionsMenu).toHaveBeenCalledTimes(1);
			expect(host._dice3d.resetCharacterScopeUi).toHaveBeenCalledTimes(1);
			expect(host._builder.resetCharacterScopeUi).toHaveBeenCalledTimes(1);
			expect(rollHistory.resetCharacterScopeUi).not.toHaveBeenCalled();
			expect(rollHistory._rolls).toEqual([{title: "Attack", total: 17}]);
			expect(mobile.resetCharacterScopeUi).not.toHaveBeenCalled();
			expect(mobile._isCharacterScopeUiSuspended).toBe(false);
			expect(mobile._statusModels).toEqual({hp: {current: 12, max: 18}});
			expect(host._currentCharacterId).toBe("character-a");
			expect(host._selCharacter.value).toBe("character-a");
		} finally {
			closeModalsSpy.mockRestore();
			if (previousMobile) globalThis._charsheetMobile = previousMobile;
			else delete globalThis._charsheetMobile;
		}
	});

	it("conceals the previous Hub character when target loading proves the session lost authority", async () => {
		const authError = Object.assign(new Error("signed out"), {code: "AUTH_REQUIRED", status: 401});
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_selCharacter: {value: "character-b"},
			_characterRepository: {
				pGet: jest.fn(async () => { throw authError; }),
			},
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_partyInventory: {isAttachedTo: jest.fn(() => true), pAttach: jest.fn()},
			isCurrentCharacterReadOnly: CharacterSheetPage.prototype.isCurrentCharacterReadOnly,
			_reattachRetainedHubCharacterIntegrations: CharacterSheetPage.prototype._reattachRetainedHubCharacterIntegrations,
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};

		await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b"))
			.rejects.toBe(authError);

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "campaign",
		});
		expect(host._partyInventory.pAttach).not.toHaveBeenCalled();
	});

	it.each([
		["character replacement", host => {
			host._currentCharacterId = "character-b";
			host._characterLoadGeneration++;
		}],
		["owner authority loss", host => {
			host._currentCharacterAccess = CHARACTER_ACCESS_MODES.DM_READ_ONLY;
		}],
	])("does not apply a deferred portrait after %s", async (_label, applyTransition) => {
		let reader;
		const FileReaderPrevious = globalThis.FileReader;
		const toastPrevious = globalThis.JqueryUtil.doToast;
		globalThis.FileReader = class {
			readAsDataURL () { reader = this; }
		};
		globalThis.JqueryUtil.doToast = jest.fn();
		const host = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_getCharacterScopeSnapshot: CharacterSheetPage.prototype._getCharacterScopeSnapshot,
			_isCharacterScopeSnapshotCurrent: CharacterSheetPage.prototype._isCharacterScopeSnapshotCurrent,
			isCurrentCharacterReadOnly: CharacterSheetPage.prototype.isCurrentCharacterReadOnly,
			_state: {setAppearance: jest.fn()},
			_saveCurrentCharacter: jest.fn(async () => true),
			_renderPortrait: jest.fn(),
		};

		try {
			CharacterSheetPage.prototype._handlePortraitFile.call(host, {type: "image/png", size: 128});
			applyTransition(host);
			await reader.onload({target: {result: "data:image/png;base64,portrait"}});

			expect(host._state.setAppearance).not.toHaveBeenCalled();
			expect(host._saveCurrentCharacter).not.toHaveBeenCalled();
			expect(host._renderPortrait).not.toHaveBeenCalled();
			expect(globalThis.JqueryUtil.doToast).not.toHaveBeenCalled();
		} finally {
			globalThis.FileReader = FileReaderPrevious;
			globalThis.JqueryUtil.doToast = toastPrevious;
		}
	});

	it.each([
		["character replacement", host => {
			host._currentCharacterId = "character-b";
			host._characterLoadGeneration++;
		}],
		["owner authority loss", host => {
			host._currentCharacterAccess = CHARACTER_ACCESS_MODES.DM_READ_ONLY;
		}],
	])("does not surface a deferred portrait read error after %s", async (_label, applyTransition) => {
		let reader;
		const FileReaderPrevious = globalThis.FileReader;
		const toastPrevious = globalThis.JqueryUtil.doToast;
		globalThis.FileReader = class {
			readAsDataURL () { reader = this; }
		};
		globalThis.JqueryUtil.doToast = jest.fn();
		const host = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_getCharacterScopeSnapshot: CharacterSheetPage.prototype._getCharacterScopeSnapshot,
			_isCharacterScopeSnapshotCurrent: CharacterSheetPage.prototype._isCharacterScopeSnapshotCurrent,
			isCurrentCharacterReadOnly: CharacterSheetPage.prototype.isCurrentCharacterReadOnly,
			_state: {setAppearance: jest.fn()},
			_saveCurrentCharacter: jest.fn(async () => true),
			_renderPortrait: jest.fn(),
		};

		try {
			CharacterSheetPage.prototype._handlePortraitFile.call(host, {type: "image/png", size: 128});
			applyTransition(host);
			reader.onerror();

			expect(host._state.setAppearance).not.toHaveBeenCalled();
			expect(host._saveCurrentCharacter).not.toHaveBeenCalled();
			expect(host._renderPortrait).not.toHaveBeenCalled();
			expect(globalThis.JqueryUtil.doToast).not.toHaveBeenCalled();
		} finally {
			globalThis.FileReader = FileReaderPrevious;
			globalThis.JqueryUtil.doToast = toastPrevious;
		}
	});

	it.each([
		["character replacement", host => {
			host._currentCharacterId = "character-b";
			host._characterLoadGeneration++;
		}],
		["owner authority loss", host => {
			host._currentCharacterAccess = "dm_readonly";
		}],
	])("cancels a completed 3D animation after %s", async (_label, applyTransition) => {
		let resolveRoll;
		const pRoll = new Promise(resolve => { resolveRoll = resolve; });
		const host = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: "owner",
			_state: {getSettings: jest.fn(() => ({animatedDice: true, diceSound: false}))},
			_getCharacterScopeSnapshot: CharacterSheetPage.prototype._getCharacterScopeSnapshot,
			_isCharacterScopeSnapshotCurrent: CharacterSheetPage.prototype._isCharacterScopeSnapshotCurrent,
			_buildDiceAppearance: jest.fn(() => null),
			_getDice3d: jest.fn(() => ({
				canRender: jest.fn(() => true),
				pRollMany: jest.fn(() => pRoll),
			})),
		};
		const originalDice3d = globalThis.CharacterSheetDice3d;
		globalThis.CharacterSheetDice3d = {isReducedMotion: () => false};

		try {
			const pending = CharacterSheetPage.prototype.pAnimateDiceSpec.call(host, {
				groups: [{sides: 20, values: [12]}],
			});
			await Promise.resolve();
			applyTransition(host);
			resolveRoll();

			await expect(pending).resolves.toBe(false);
		} finally {
			globalThis.CharacterSheetDice3d = originalDice3d;
		}
	});

	it("settles a feature-choice modal torn down before the caller installs its resolver", async () => {
		const host = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: "owner",
			_formatSkillKeyLabel: CharacterSheetPage.prototype._formatSkillKeyLabel,
		};
		const originalUiUtil = globalThis.UiUtil;
		globalThis.UiUtil = {
			pGetShowModal: async ({cbClose}) => {
				host._currentCharacterId = "character-b";
				host._characterLoadGeneration++;
				return {
					eleModalInner: {},
					doClose: value => cbClose?.(value),
				};
			},
		};
		CharacterSheetModal.bindCharacterSheet(host);

		try {
			await expect(Promise.race([
				CharacterSheetPage.prototype._pPickFeatureChoice.call(host, {
					id: "tool-choice",
					featureName: "Tool Training",
					kind: "tool",
					options: ["Smith's tools"],
				}),
				new Promise(resolve => setTimeout(() => resolve("still-pending"), 50)),
			])).resolves.toBeNull();
		} finally {
			CharacterSheetModal.bindCharacterSheet(null);
			globalThis.UiUtil = originalUiUtil;
		}
	});

	it("selects a directly loaded character in the dropdown", async () => {
		const windowPrevious = globalThis.window;
		globalThis.window = {
			location: new URL("https://tools.example/charactersheet.html?id=character-2"),
			history: {replaceState: jest.fn()},
		};
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: null,
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: true,
			_isLevelUpBannerDismissed: true,
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(async () => ({id: "character-2", name: "Mira"})),
				getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			},
			_selCharacter: {value: ""},
			_hubContext: null,
			_state: {
				clearCampaignSettingsOverlay: jest.fn(),
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
				getBackgroundTheme: jest.fn(() => "default"),
			},
			_reconcilePersistedCharacter: jest.fn(canonical => ({chosen: canonical, mirrorWon: false})),
			_reconcileClassFeatures: jest.fn(() => ({added: 0, backfilled: 0})),
			_ensureLinguisticsSkillIfNeeded: jest.fn(),
			_renderCharacter: jest.fn(),
			_applyBackgroundTheme: jest.fn(),
			_updateThemePickerSelection: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => {}),
			},
			_layout: null,
			_playMode: null,
		};

		try {
			await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-2")).resolves.toBe(true);
			expect(host._selCharacter.value).toBe("character-2");
			expect(host._currentCharacterAccess).toBe(CHARACTER_ACCESS_MODES.DM_READ_ONLY);
			expect(host._campaign.resetCharacterScope).toHaveBeenCalled();
			expect(host._campaign.pRefreshCurrentCharacter).toHaveBeenCalled();
		} finally {
			globalThis.window = windowPrevious;
		}
	});

	it("conceals a loaded Hub character when campaign refresh proves authority loss", async () => {
		const windowPrevious = globalThis.window;
		globalThis.window = {
			location: new URL("https://tools.example/charactersheet.html?id=character-a&hubCampaign=campaign-1"),
			history: {replaceState: jest.fn()},
		};
		const authError = Object.assign(new Error("signed out"), {code: "AUTH_REQUIRED", status: 401});
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(async () => ({id: "character-b", name: "B"})),
				getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.OWNER),
			},
			_selCharacter: {value: "character-b"},
			_hubContext: null,
			_state: {
				clearCampaignSettingsOverlay: jest.fn(),
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
				getBackgroundTheme: jest.fn(() => "default"),
				getViewMode: jest.fn(() => "sheet"),
			},
			_closeCharacterScopedTransientUi: jest.fn(),
			_reconcilePersistedCharacter: jest.fn(canonical => ({chosen: canonical, mirrorWon: false})),
			_reconcileClassFeatures: jest.fn(() => ({added: 0, backfilled: 0})),
			_ensureLinguisticsSkillIfNeeded: jest.fn(),
			_renderCharacter: jest.fn(),
			_applyBackgroundTheme: jest.fn(),
			_updateThemePickerSelection: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => { throw authError; }),
			},
			_layout: null,
			_playMode: null,
			_endCurrentHubCharacterAccess: jest.fn(),
		};

		try {
			await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b"))
				.rejects.toBe(authError);
		} finally {
			globalThis.window = windowPrevious;
		}

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-b",
			accessEndCause: "campaign",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("ends character access when a rules refresh proves terminal campaign authority loss", async () => {
		const authError = Object.assign(new Error("signed out"), {code: "AUTH_REQUIRED", status: 401});
		const pRevalidate = jest.fn(() => new Promise(() => {}));
		const host = {
			_hubRulesPendingVersionId: null,
			_hubRulesRefreshGeneration: 0,
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_currentCharacterId: "character-a",
			_hubCampaignId: "campaign-a",
			_isHubCharacter: true,
			_hubCampaignContext: {pRefresh: jest.fn(async () => { throw authError; })},
			_hubActiveCampaign: {pRevalidate},
			_clearHubRules: jest.fn(),
			_campaign: {render: jest.fn()},
			_endCurrentHubCharacterAccess: jest.fn(() => true),
			_handleTerminalCharacterCampaignAccessError: CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError,
		};

		await expect(CharacterSheetPage.prototype._pRefreshHubRules.call(host)).resolves.toBe(false);
		await Promise.resolve();

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "campaign",
		});
		expect(pRevalidate).toHaveBeenCalledWith({trigger: "access_loss"});
		expect(host._hubRulesRefreshBlocked).toBe(true);
	});

	it("keeps campaign rules disabled but retains the character after a transient refresh failure", async () => {
		const transientError = Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"});
		const host = {
			_hubRulesPendingVersionId: null,
			_hubRulesRefreshGeneration: 0,
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_currentCharacterId: "character-a",
			_hubCampaignId: "campaign-a",
			_isHubCharacter: true,
			_hubCampaignContext: {pRefresh: jest.fn(async () => { throw transientError; })},
			_hubActiveCampaign: {pRevalidate: jest.fn()},
			_clearHubRules: jest.fn(),
			_campaign: {render: jest.fn()},
			_endCurrentHubCharacterAccess: jest.fn(() => true),
			_handleTerminalCharacterCampaignAccessError: CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError,
		};

		await expect(CharacterSheetPage.prototype._pRefreshHubRules.call(host)).resolves.toBe(false);

		expect(host._endCurrentHubCharacterAccess).not.toHaveBeenCalled();
		expect(host._hubActiveCampaign.pRevalidate).not.toHaveBeenCalled();
		expect(host._isHubContextRevalidationRequired).toBe(true);
		expect(host._hubRulesRefreshBlocked).toBe(true);
	});

	it("ends character access when an event-driven context refresh proves terminal authority loss", async () => {
		const authError = Object.assign(new Error("campaign unavailable"), {code: "CAMPAIGN_NOT_FOUND", status: 404});
		const host = {
			_hubContext: {rulesVersion: null, brewBundle: null},
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_hubCampaignContext: {pRefresh: jest.fn(async () => { throw authError; })},
			_hubActiveCampaign: {pRevalidate: jest.fn(() => new Promise(() => {}))},
			_clearHubRules: jest.fn(),
			_campaign: {render: jest.fn()},
			_endCurrentHubCharacterAccess: jest.fn(() => true),
			_handleTerminalCharacterCampaignAccessError: CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError,
		};

		CharacterSheetPage.prototype._onHubCampaignContextChanged.call(host, {type: "membership.changed"});
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "campaign",
		});
		expect(host._hubActiveCampaign.pRevalidate).toHaveBeenCalledWith({trigger: "access_loss"});
	});

	it("does not conceal a replacement character outside the campaign that lost access", async () => {
		const authError = Object.assign(new Error("campaign unavailable"), {code: "CAMPAIGN_NOT_FOUND", status: 404});
		const refresh = makeDeferred();
		const host = {
			_hubContext: {rulesVersion: null, brewBundle: null},
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_currentCharacterId: "character-a",
			_hubCampaignId: "campaign-a",
			_isHubCharacter: true,
			_hubCampaignContext: {pRefresh: jest.fn(() => refresh.promise)},
			_hubActiveCampaign: {pRevalidate: jest.fn(() => new Promise(() => {}))},
			_clearHubRules: jest.fn(),
			_campaign: {render: jest.fn()},
			_endCurrentHubCharacterAccess: jest.fn(() => true),
			_handleTerminalCharacterCampaignAccessError: CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError,
		};

		CharacterSheetPage.prototype._onHubCampaignContextChanged.call(host, {type: "membership.changed"});
		host._currentCharacterId = "character-b";
		host._hubCampaignId = "campaign-b";
		refresh.reject(authError);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(host._endCurrentHubCharacterAccess).not.toHaveBeenCalled();
		expect(host._hubActiveCampaign.pRevalidate).not.toHaveBeenCalled();
	});

	it("conceals the replacement campaign character when a pending context refresh proves campaign access loss", async () => {
		const authError = Object.assign(new Error("campaign unavailable"), {code: "CAMPAIGN_NOT_FOUND", status: 404});
		const refresh = makeDeferred();
		const host = {
			_hubContext: {rulesVersion: null, brewBundle: null},
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_currentCharacterId: "character-a",
			_hubCampaignId: "campaign-a",
			_isHubCharacter: true,
			_hubCampaignContext: {pRefresh: jest.fn(() => refresh.promise)},
			_hubActiveCampaign: {pRevalidate: jest.fn(() => new Promise(() => {}))},
			_clearHubRules: jest.fn(),
			_campaign: {
				render: jest.fn(),
				resetCharacterScope: jest.fn(),
			},
			_fenceHubGeneration: jest.fn(),
			_detachHubRealtimeClient: jest.fn(),
			_detachHubProjections: jest.fn(),
			_concealHubPrivateCharacter: jest.fn(),
			_teardownHubRules: jest.fn(),
			_endCurrentHubCharacterAccess: CharacterSheetPage.prototype._endCurrentHubCharacterAccess,
			_handleTerminalCharacterCampaignAccessError: CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError,
		};

		CharacterSheetPage.prototype._onHubCampaignContextChanged.call(host, {type: "membership.changed"});
		host._currentCharacterId = "character-b";
		refresh.reject(authError);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(host._concealHubPrivateCharacter).toHaveBeenCalledTimes(1);
		expect(host._detachHubRealtimeClient).toHaveBeenCalledTimes(1);
		expect(host._campaign.resetCharacterScope).toHaveBeenCalledTimes(1);
		expect(host._hubActiveCampaign.pRevalidate).toHaveBeenCalledWith({trigger: "access_loss"});
	});

	it("ends character access when authoritative reconciliation proves terminal authority loss", async () => {
		const authError = Object.assign(new Error("forbidden"), {code: "FORBIDDEN", status: 403});
		const host = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 4,
			_hubRealtimeGeneration: 7,
			_isHubCharacter: true,
			_characterRepository: {
				pReconcileAuthoritativeCharacter: jest.fn(async () => { throw authError; }),
			},
			_hubActiveCampaign: {pRevalidate: jest.fn(() => new Promise(() => {}))},
			_getHubLiveCharacterData: jest.fn(),
			_adoptHubLiveCharacterData: jest.fn(),
			_updateSaveIndicator: jest.fn(),
			_endCurrentHubCharacterAccess: jest.fn(() => true),
			_handleTerminalCharacterCampaignAccessError: CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError,
		};

		await expect(CharacterSheetPage.prototype._pRunHubAuthoritativeReconcile.call(host, {
			characterId: "character-a",
			generation: 4,
			realtimeGeneration: 7,
		})).resolves.toBe(false);
		await Promise.resolve();

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "campaign",
		});
		expect(host._updateSaveIndicator).not.toHaveBeenCalled();
	});

	it("ends character access when realtime resync proves terminal authority loss", async () => {
		const authError = Object.assign(new Error("campaign unavailable"), {code: "CAMPAIGN_NOT_FOUND", status: 404});
		const host = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 4,
			_isHubCharacter: true,
			_characterRepository: {
				pRunPendingResync: jest.fn(async () => { throw authError; }),
			},
			_hubActiveCampaign: {pRevalidate: jest.fn(() => new Promise(() => {}))},
			_getHubLiveCharacterData: jest.fn(),
			_adoptHubLiveCharacterData: jest.fn(),
			_updateSaveIndicator: jest.fn(),
			_endCurrentHubCharacterAccess: jest.fn(() => true),
			_handleTerminalCharacterCampaignAccessError: CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError,
		};

		await expect(CharacterSheetPage.prototype._pRunHubRealtimeResync.call(host, {
			characterId: "character-a",
		})).resolves.toBe(false);
		await Promise.resolve();

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "campaign",
		});
		expect(host._updateSaveIndicator).not.toHaveBeenCalled();
	});

	it("conceals a terminal save failure before campaign revalidation settles or fails", async () => {
		const authError = Object.assign(new Error("signed out"), {code: "AUTH_REQUIRED", status: 401});
		const revalidation = makeDeferred();
		const order = [];
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		const host = {
			_currentCharacterId: "character-a",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_characterLoadGeneration: 2,
			_isCurrentCharacterNew: false,
			_isHubCharacter: true,
			_characterRepository: {
				isRescueMirrorEnabled: false,
				isSaveBlocked: jest.fn(() => false),
				pUpsert: jest.fn(async () => { throw authError; }),
			},
			_hubActiveCampaign: {
				pRevalidate: jest.fn(() => {
					order.push("revalidate");
					return revalidation.promise;
				}),
			},
			_state: {toJson: jest.fn(() => ({id: "character-a", name: "Secret"}))},
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
			_updateSaveIndicator: jest.fn(),
			_endCurrentHubCharacterAccess: jest.fn(() => {
				order.push("conceal");
				return true;
			}),
			_handleTerminalCharacterCampaignAccessError: CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError,
		};

		try {
			await expect(Promise.race([
				CharacterSheetPage.prototype._saveCurrentCharacter.call(host),
				new Promise(resolve => setTimeout(() => resolve("still-pending"), 50)),
			])).resolves.toBe(false);
			expect(order).toEqual(["conceal", "revalidate"]);
			revalidation.reject(new Error("coordinator unavailable"));
			await new Promise(resolve => setTimeout(resolve, 0));
			expect(consoleError).toHaveBeenCalledWith(
				"Failed to revalidate inaccessible campaign context:",
				expect.any(Error),
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it("keeps a server-adopted import ID selected after the create continuation becomes stale", async () => {
		const uploadPrevious = globalThis.InputUiUtil.pGetUserUploadJson;
		const imported = {id: "exported-id", name: "Imported"};
		let loaded = null;
		const host = {
			_currentCharacterId: null,
			_characterLoadGeneration: 0,
			_selCharacter: {value: ""},
			_state: {
				loadFromJson: jest.fn(data => { loaded = structuredClone(data); }),
				setId: jest.fn(id => { loaded.id = id; }),
			},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pRefreshCharacterRosterAfterCommittedStaleCreate: jest.fn(async () => {}),
			_renderCharacter: jest.fn(),
		};
		host._saveCurrentCharacter = jest.fn(async () => {
			host._currentCharacterId = "server-import";
			host._characterLoadGeneration++;
			host._state.setId("server-import");
			return true;
		});
		globalThis.InputUiUtil.pGetUserUploadJson = jest.fn(async () => ({
			jsons: [structuredClone(imported)],
			errors: [],
		}));

		try {
			await CharacterSheetPage.prototype._onImportCharacter.call(host);
		} finally {
			globalThis.InputUiUtil.pGetUserUploadJson = uploadPrevious;
		}

		expect(host._pRefreshCharacterRosterAfterCommittedStaleCreate).toHaveBeenCalledTimes(1);
		expect(host._currentCharacterId).toBe("server-import");
		expect(loaded.id).toBe("server-import");
		expect(host._selCharacter.value).toBe("server-import");
		expect(host._renderCharacter).not.toHaveBeenCalled();
	});

	it("adopts an imported character's canonical id in the URL and campaign controls", async () => {
		const windowPrevious = globalThis.window;
		const windowMock = {
			location: new URL("https://tools.example/charactersheet.html?id=previous&hubCampaign=campaign-1"),
			history: {replaceState: jest.fn()},
		};
		globalThis.window = windowMock;
		const repository = makeRepository();
		repository.pUpsert.mockResolvedValueOnce({id: "server-import", name: "Imported"});
		const host = {
			_currentCharacterId: "previous",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: false,
			_characterLoadGeneration: 0,
			_saveCurrentCharacter: jest.fn(async () => true),
			_characterRepository: repository,
			_state: {
				loadFromJson: jest.fn(),
			},
			_detachHubRealtime: jest.fn(),
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pLoadCharacters: jest.fn(async () => {}),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: ""},
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => {}),
			},
		};

		try {
			await expect(CharacterSheetPage.prototype.addCharacter.call(host, {
				toJson: () => ({name: "Imported"}),
			})).resolves.toBe(true);
		} finally {
			globalThis.window = windowPrevious;
		}

		expect(host._currentCharacterId).toBe("server-import");
		expect(windowMock.history.replaceState).toHaveBeenCalledWith(
			{},
			"",
			expect.objectContaining({search: "?id=server-import&hubCampaign=campaign-1"}),
		);
		expect(host._campaign.resetCharacterScope).toHaveBeenCalled();
		expect(host._campaign.pRefreshCurrentCharacter).toHaveBeenCalled();
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-import"});
	});

	it("keeps an imported character successful when post-create UI refreshes fail", async () => {
		const windowPrevious = globalThis.window;
		const windowMock = {
			location: new URL("https://tools.example/charactersheet.html?id=previous&hubCampaign=campaign-1"),
			history: {replaceState: jest.fn()},
		};
		globalThis.window = windowMock;
		const repository = makeRepository();
		repository.pUpsert.mockResolvedValueOnce({id: "server-import", name: "Imported"});
		const toastPrevious = globalThis.JqueryUtil.doToast;
		const doToast = jest.fn();
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.JqueryUtil.doToast = doToast;
		const host = {
			_currentCharacterId: "previous",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: false,
			_characterLoadGeneration: 0,
			_saveCurrentCharacter: jest.fn(async () => true),
			_characterRepository: repository,
			_state: {
				loadFromJson: jest.fn(),
				toJson: () => ({id: "server-import", name: "Imported"}),
			},
			_detachHubRealtime: jest.fn(),
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pLoadCharacters: jest.fn(async () => { throw new Error("roster unavailable"); }),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: "", options: []},
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => { throw new Error("campaign controls unavailable"); }),
			},
		};

		try {
			await expect(CharacterSheetPage.prototype.addCharacter.call(host, {
				toJson: () => ({name: "Imported"}),
			})).resolves.toBe(true);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(doToast).toHaveBeenCalledWith(expect.objectContaining({
				type: "warning",
				content: expect.stringContaining("Character saved"),
			}));
		} finally {
			warn.mockRestore();
			globalThis.window = windowPrevious;
			globalThis.JqueryUtil.doToast = toastPrevious;
		}

		expect(host._currentCharacterId).toBe("server-import");
		expect(host._isCurrentCharacterNew).toBe(false);
		expect(host._selCharacter.value).toBe("server-import");
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-import"});
	});

	it("restores campaign controls after a duplicate save genuinely fails", async () => {
		const sourceData = {id: "source-id", name: "Source"};
		const host = {
			_currentCharacterId: "source-id",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: false,
			_characterLoadGeneration: 0,
			_saveCurrentCharacter: jest.fn()
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(false),
			_characterRepository: {
				getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.OWNER),
			},
			_state: {
				toJson: jest.fn(() => structuredClone(sourceData)),
				loadFromJson: jest.fn(),
			},
			_detachHubRealtime: jest.fn(),
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
			_pLoadCharacters: jest.fn(async () => {}),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: "source-id"},
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => {}),
			},
		};

		await CharacterSheetPage.prototype._onDuplicateCharacter.call(host);

		expect(host._currentCharacterId).toBe("source-id");
		expect(host._state.loadFromJson).toHaveBeenLastCalledWith(sourceData);
		expect(host._campaign.pRefreshCurrentCharacter).toHaveBeenCalledTimes(1);
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "source-id"});
	});

	it("tears down on terminal pagehide and resumes the same subscription after BFCache restoration", async () => {
		const listeners = {};
		const windowPrev = globalThis.window;
		globalThis.window = {
			addEventListener: jest.fn((type, listener) => listeners[type] = listener),
		};
		const host = {
			_detachHubRealtime: jest.fn(),
			_hubRealtime: {
				resume: jest.fn(),
				suspend: jest.fn(),
			},
		};
		try {
			CharacterSheetPage.prototype._initHubRealtimeTeardown.call(host);
			listeners.pagehide({persisted: true});
			listeners.pageshow({persisted: true});

			// The session may have been signed out or switched while the page was frozen, so the
			// private stream must not reopen until the account has been revalidated (ADR 0013).
			expect(host._hubRealtime.resume).not.toHaveBeenCalled();
			await Promise.resolve();
			await Promise.resolve();

			listeners.pagehide({persisted: false});
		} finally {
			globalThis.window = windowPrev;
		}

		expect(host._hubRealtime.suspend).toHaveBeenCalledTimes(1);
		expect(host._hubRealtime.resume).toHaveBeenCalledTimes(1);
		expect(host._detachHubRealtime).toHaveBeenCalledTimes(1);
	});
});
