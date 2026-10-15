import "./setup.js";
import {jest} from "@jest/globals";
import {getCarryProfile} from "../../../js/hub/hub-carry-contract.js";
import {
	CharacterSheetPartyInventory,
	getPartyInventoryRecipients,
	getPartyInventoryStashAction,
	getPartyInventoryTransferTargetId,
} from "../../../js/charactersheet/charactersheet-party-inventory.js";

describe("Character Sheet party inventory", () => {
	it.each([
		["dm", "take"],
		["co_dm", "take"],
		["player", "request"],
		["spectator", null],
		[null, null],
	])("maps the %s role to the supported stash action", (role, expected) => {
		expect(getPartyInventoryStashAction(role)).toBe(expected);
	});

	// A small event-capable DOM double, matching the existing node-only Jest environment.
	// The tests below run the actual composer, refresh, and mutation handlers against it.
	function makePartyInventoryDocument () {
		const doc = {activeElement: null};
		const makeElement = tag => {
			const attributes = new Map();
			const listeners = new Map();
			let text = "";
			const element = {
				tagName: tag.toUpperCase(),
				className: "",
				dataset: {},
				children: [],
				parentElement: null,
				value: "",
				disabled: false,
				hidden: false,
				selectionStart: null,
				selectionEnd: null,
				get textContent () { return text + this.children.map(child => child.textContent).join(""); },
				set textContent (value) { text = `${value}`; this.replaceChildren(); },
				setAttribute (key, value) {
					attributes.set(key, `${value}`);
					if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (match, letter) => letter.toUpperCase())] = `${value}`;
					if (["value", "type", "id"].includes(key)) this[key] = `${value}`;
					if (key === "disabled") this.disabled = true;
					if (key === "hidden") this.hidden = true;
				},
				getAttribute (key) { return attributes.get(key) ?? null; },
				append (...children) {
					for (const child of children) {
						child.parentElement = this;
						this.children.push(child);
					}
				},
				replaceChildren (...children) {
					this.children.forEach(child => child.parentElement = null);
					this.children = [];
					this.append(...children);
				},
				remove () {
					if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
					this.parentElement = null;
				},
				contains (child) { return child === this || this.children.some(candidate => candidate.contains(child)); },
				addEventListener (type, listener) {
					if (!listeners.has(type)) listeners.set(type, []);
					listeners.get(type).push(listener);
				},
				fire (type) { for (const listener of listeners.get(type) || []) listener({preventDefault () {}}); },
				focus: jest.fn(() => { doc.activeElement = element; }),
				scrollIntoView: jest.fn(),
				querySelectorAll (selector) {
					const matches = candidate => selector.split(",").some(part => {
						const trimmed = part.trim();
						if (trimmed.startsWith(".")) return candidate.className.split(" ").includes(trimmed.slice(1));
						const attribute = trimmed.match(/^(?:([a-z]+))?\[([^=\]]+)(?:=["']([^"']*)["'])?\]$/);
						if (attribute) {
							return (!attribute[1] || candidate.tagName === attribute[1].toUpperCase())
							&& (attribute[3] === undefined
								? candidate.getAttribute(attribute[2]) != null
								: candidate.getAttribute(attribute[2]) === attribute[3]);
						}
						return candidate.tagName === trimmed.toUpperCase();
					});
					const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
					return selector === "*" ? descendants : descendants.filter(matches);
				},
				querySelector (selector) { return this.querySelectorAll(selector)[0] || null; },
			};
			element.classList = {
				toggle (name, isOn) {
					const names = new Set(element.className.split(" ").filter(Boolean));
					if (isOn) names.add(name);
					else names.delete(name);
					element.className = [...names].join(" ");
				},
			};
			return element;
		};
		doc.createElement = makeElement;
		doc.body = makeElement("body");
		doc.querySelector = selector => doc.body.querySelector(selector);
		doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
		doc.removeEventListener = jest.fn();
		return doc;
	}

	describe("Character Sheet party inventory unified composer", () => {
		let previousDocument;
		let previousCss;
		let controller;
		let character;
		let party;
		let snapshot;
		let transfers;
		let api;
		let repository;
		const denominations = ["cp", "sp", "ep", "gp", "pp"];
		const field = key => controller._root.querySelector(`[data-party-inventory-focus="${key}"]`);
		const summary = () => controller._root.querySelector(".charsheet__party-inventory-confirmation").textContent;
		const change = (key, value, type = "input") => {
			const control = field(key);
			control.value = `${value}`;
			control.fire(type);
		};
		const chooseItem = (kind, entryId) => change("item", controller._getItemToken({kind, entryId}), "change");

		beforeEach(() => {
			previousDocument = globalThis.document;
			previousCss = globalThis.CSS;
			globalThis.document = makePartyInventoryDocument();
			globalThis.CSS = {escape: value => value};
			character = {
				name: "Rowan",
				inventory: [{id: "character-stack", item: {name: "Rations", source: "PHB", weight: 2}, quantity: 8}],
				currency: Object.fromEntries(denominations.map(type => [type, 100])),
			};
			party = {
				id: "party-1",
				inventory: [{id: "stash-stack", item: {name: "Torch", source: "PHB", weight: 1}, quantity: 6}],
				currency: Object.fromEntries(denominations.map(type => [type, 50])),
			};
			snapshot = {
				membership: {role: "player"},
				characters: [
					{kind: "owner_truth", character: {id: "character-1", data: character}},
					{kind: "peer_profile", id: "peer-1", data: {identity: {name: "Mira"}, classes: []}},
				],
				roster: [{characterId: "character-1"}, {characterId: "peer-1"}],
			};
			transfers = [];
			api = {
				pGetPartyInventory: jest.fn(async () => structuredClone(party)),
				pGetCampaignSnapshot: jest.fn(async () => structuredClone(snapshot)),
				pListTransfers: jest.fn(async () => structuredClone(transfers)),
				pProposeTransfer: jest.fn(async request => {
					const transfer = {
						id: "transfer-1",
						sourceKind: request.sourceKind,
						sourceId: request.sourceId,
						targetKind: request.targetKind,
						targetId: request.targetId,
						status: request.sourceKind === "party_inventory" ? "proposed" : "reserved",
						actorCommandId: request.idempotencyKey,
						payload: request.sourceKind === "party_inventory" ? {request: request.payload} : {escrow: request.payload},
					};
					transfers = [transfer];
					return {transfer: structuredClone(transfer)};
				}),
				pResolveTransfer: jest.fn(async ({transferId}) => {
					const transfer = transfers.find(candidate => candidate.id === transferId);
					transfer.status = "rejected";
					return {transfer: structuredClone(transfer)};
				}),
			};
			repository = {pReconcileAuthoritativeCharacter: jest.fn(async () => ({status: "unchanged"}))};
			controller = new CharacterSheetPartyInventory({
				campaignId: "campaign-1",
				api,
				repository,
				fnGetCharacterData: () => character,
				fnSaveCharacter: jest.fn(async () => true),
				fnIsCurrentCharacter: () => true,
				fnGetCarryProfile: () => getCarryProfile({
					capacityOverride: 150,
					grossWeight: 30,
					fillableWeight: 16,
					coinCounts: character.currency,
					isCoinWeightCounted: true,
				}),
				fnToast: jest.fn(),
			});
			controller._active = {characterId: "character-1", generation: 1, isOwner: true};
			controller._role = "player";
			controller._connectionState = "live";
			controller._partyInventory = structuredClone(party);
			controller._root = document.createElement("section");
			document.body.append(controller._root);
			controller._recipients = getPartyInventoryRecipients({
				projections: snapshot.characters,
				roster: snapshot.roster,
				currentCharacterId: "character-1",
			});
			controller._rebuildRecipientTokens();
			controller._render();
		});

		afterEach(() => {
			controller.destroy();
			globalThis.document = previousDocument;
			globalThis.CSS = previousCss;
		});

		it("opens the same composer for equipment sharing and currency-only requests even with an empty stash", () => {
			field("share").fire("click");
			expect(field("intent").value).toBe("deposit");
			expect(field("item").value).toBe("");
			expect(field("quantity").disabled).toBe(true);
			expect(field("submit").disabled).toBe(true);
			expect(summary()).toContain("at least one coin");
			expect(document.activeElement).toBe(field("item"));
			field("cancel").fire("click");
			expect(document.activeElement).toBe(field("share"));

			controller._partyInventory.inventory = [];
			controller._render();
			field("stash-currency").fire("click");
			expect(field("intent").value).toBe("request");
			expect(document.activeElement).toBe(field("currency-cp"));
			expect(field("currency-cp").scrollIntoView).toHaveBeenCalledWith({block: "center"});
			change("currency-pp", "2");
			expect(summary()).toContain("2 PP");
			expect(summary()).toContain("DM must approve");
			expect(summary()).toContain("leaves the stash unchanged");
			expect(field("submit").textContent).toBe("Send request");
		});

		it("resets contents explicitly on intent changes rather than repurposing a draft", () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("quantity", "3");
			change("currency-ep", "7");
			const originalCommand = controller._draft.commandId;
			field("intent").focus();
			change("intent", "request", "change");
			expect(controller._draft).toEqual(expect.objectContaining({
				kind: "party_inventory", destinationKind: "character", entryId: null, currency: {}, quantity: 1,
			}));
			expect(controller._draft.commandId).not.toBe(originalCommand);
			expect(field("item").value).toBe("");
			expect(field("currency-ep").value).toBe("0");
			expect(field("submit").disabled).toBe(true);
			expect(document.activeElement).toBe(field("intent"));
			expect(controller._announcement).toContain("Choose the contents again");

			change("intent", "pass", "change");
			expect(controller._draft.recipientId).toBeNull();
			expect(field("destination").value).toBe("unavailable");
			expect(field("submit").disabled).toBe(true);
			expect(field("destination").textContent).toContain("Choose a recipient");
		});

		it("sends partial items and all five denominations in one approval-required stash request", async () => {
			field("stash-currency").fire("click");
			chooseItem("party_inventory", "stash-stack");
			change("quantity", "2");
			denominations.forEach((type, index) => change(`currency-${type}`, `${index + 1}`));
			expect(field("submit").disabled).toBe(false);
			const before = structuredClone(character);

			await expect(controller._pSubmitDraft()).resolves.toBe(true);

			expect(api.pProposeTransfer).toHaveBeenCalledWith(expect.objectContaining({
				sourceKind: "party_inventory",
				sourceId: "party-1",
				targetKind: "character",
				targetId: "character-1",
				payload: {items: [{entryId: "stash-stack", quantity: 2}], currency: {cp: 1, sp: 2, ep: 3, gp: 4, pp: 5}},
				isAutoResolved: false,
			}));
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
			expect(character).toEqual(before);
			expect(repository.pReconcileAuthoritativeCharacter).toHaveBeenCalled();
			expect(controller._root.textContent).toContain("Waiting for approval");
			expect(controller._root.textContent).toContain("Cancel request");
			expect(controller._announcement).toContain("Request sent");
		});

		it("keeps deposit and peer pass on the existing serialized escrow path", async () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("quantity", "3");
			change("currency-gp", "4");
			const recipientToken = [...controller._recipientByToken.keys()][0];
			change("destination", recipientToken, "change");
			expect(field("intent").value).toBe("pass");
			expect(field("submit").textContent).toBe("Pass");
			expect(summary()).toContain("Mira");
			expect(summary()).toContain("recipient must accept");
			expect(summary()).toContain("restores them to this character");
			const before = structuredClone(character);

			await expect(controller._pSubmitDraft()).resolves.toBe(true);
			expect(controller._fnSaveCharacter).toHaveBeenCalledTimes(1);
			expect(api.pProposeTransfer).toHaveBeenCalledWith(expect.objectContaining({
				sourceKind: "character",
				sourceId: "character-1",
				targetKind: "character",
				targetId: "peer-1",
				payload: {items: [{entryId: "character-stack", quantity: 3}], currency: {gp: 4}},
			}));
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
			expect(character).toEqual(before);
		});

		it.each(["cp", "sp", "ep", "gp", "pp"])("rejects insufficient, fractional, negative and unsafe %s without converting another denomination", async type => {
			controller._beginDraft({kind: "character"});
			for (const value of ["101", "0.5", "-1", "9007199254740992"]) {
				change(`currency-${type}`, value);
				expect(field("submit").disabled).toBe(true);
				expect(summary()).toContain("Denominations are not exchanged");
				await expect(controller._pSubmitDraft()).resolves.toBe(false);
			}
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
			expect(controller._fnSaveCharacter).not.toHaveBeenCalled();
		});

		it("preserves focused raw draft values through authoritative refresh and never clamps changed availability", async () => {
			controller._beginDraft({kind: "party_inventory", entryId: "stash-stack"});
			change("quantity", "04");
			change("currency-ep", "07");
			field("currency-ep").focus();
			const command = controller._draft.commandId;
			party.inventory[0].quantity = 2;
			party.currency.ep = 3;
			await expect(controller._pRefreshParty()).resolves.toBe(true);
			expect(controller._draft.commandId).toBe(command);
			expect(field("quantity").value).toBe("04");
			expect(field("quantity").getAttribute("max")).toBe("2");
			expect(field("currency-ep").value).toBe("07");
			expect(field("currency-ep").getAttribute("max")).toBe("3");
			expect(document.activeElement).toBe(field("currency-ep"));
			expect(field("submit").disabled).toBe(true);
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
		});

		it("retains a focused blank quantity rather than restoring a previous valid amount", async () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("quantity", "");
			field("quantity").focus();
			await controller._pReconcileCharacter();
			expect(field("quantity").value).toBe("");
			expect(document.activeElement).toBe(field("quantity"));
			expect(field("submit").disabled).toBe(true);
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
		});

		it("preserves an unavailable destination instead of silently substituting the stash", async () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("destination", [...controller._recipientByToken.keys()][0], "change");
			field("destination").focus();
			snapshot.characters = snapshot.characters.slice(0, 1);
			snapshot.roster = snapshot.roster.slice(0, 1);
			await controller._pRefreshParty();
			expect(controller._draft.destinationKind).toBe("character");
			expect(controller._draft.recipientId).toBe("peer-1");
			expect(field("destination").value).toBe("unavailable");
			expect(document.activeElement).toBe(field("destination"));
			expect(field("submit").disabled).toBe(true);
			expect(controller._root.textContent).not.toContain("Mira");
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
		});

		it("requires explicit reselection when an item identity is reused with changed metadata", async () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			character.inventory[0].item = {name: "Different item", source: "PHB", weight: 20};
			await controller._pReconcileCharacter();
			expect(field("submit").disabled).toBe(true);
			expect(summary()).toContain("selected stack changed");
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
			chooseItem("character", "character-stack");
			expect(field("submit").disabled).toBe(false);
			expect(summary()).toContain("Different item");
		});

		it.each([
			["equipped", {equipped: true}, {}],
			["attuned", {attuned: true}, {}],
			["inside a container", {}, {inventory: [{id: "bag", quantity: 1, item: {name: "Bag", containedItems: ["character-stack"]}}]}],
			["contains items", {item: {name: "Bag", containedItems: ["child"]}}, {}],
			["selected ammunition", {}, {selectedAmmo: {bow: "character-stack"}}],
			["tracked ammunition", {}, {ammunitionConsumed: {"character-stack": 1}}],
			["active state", {}, {activeStates: {buff: {itemId: "character-stack"}}}],
			["item effects", {}, {namedModifiers: [{sourceFeatureId: "item:character-stack"}]}],
			["spell link", {}, {itemGrantedSpells: [{itemId: "character-stack"}]}],
		])("keeps %s singletons out of the composer and blocks forged submissions", async (reason, entryChanges, containerChanges) => {
			const original = {...character.inventory[0], ...entryChanges, quantity: 1};
			const extraEntries = containerChanges.inventory || [];
			Object.assign(character, containerChanges, {inventory: [original, ...extraEntries]});
			controller._beginDraft({kind: "character"});
			expect(field("item").textContent).not.toContain("Rations");
			expect(controller._beginDraft({kind: "character", entryId: "character-stack"})).toBe(false);
			controller._draft.entryId = "character-stack";
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
		});

		it("preserves safe partial movement while leaving the linked source copy behind", async () => {
			character.inventory[0].equipped = true;
			character.inventory[0].quantity = 2;
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			expect(field("quantity").getAttribute("max")).toBe("1");
			change("quantity", "2");
			expect(field("submit").disabled).toBe(true);
			change("quantity", "1");
			await expect(controller._pSubmitDraft()).resolves.toBe(true);
			expect(api.pProposeTransfer.mock.calls[0][0].payload.items).toEqual([{entryId: "character-stack", quantity: 1}]);
		});

		it("previews an equipped partial from its actual body load rather than subtracting bag contents", () => {
			Object.assign(character.inventory[0], {equipped: true, quantity: 2});
			character.inventory[0].item.weight = 10;
			controller._fnGetCarryProfile = () => getCarryProfile({
				capacityOverride: 150, externalCapacity: 100, grossWeight: 50, fillableWeight: 30,
			});
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			expect(controller._root.querySelector(".charsheet__party-inventory-carry-delta").textContent)
				.toContain("You: 20 → 10 lb of 150");
			expect(field("quantity").getAttribute("max")).toBe("1");
		});

		it.each([false, true])("shows current carry and coin impact only under the sheet's counted-coin policy (%s)", isCounted => {
			controller._fnGetCarryProfile = () => getCarryProfile({
				capacityOverride: 150, grossWeight: 30, coinCounts: {gp: 100}, isCoinWeightCounted: isCounted,
			});
			controller._beginDraft({kind: "character"});
			change("currency-gp", "50");
			const carry = controller._root.querySelector(".charsheet__party-inventory-carry-delta").textContent;
			expect(carry).toContain(isCounted ? "32 → 31 lb of 150" : "30 → 30 lb of 150");
			expect(carry).toContain(isCounted ? "1 lb counted" : "1 lb not counted");
		});

		it("uses only currently shared destination carry and never invents a post-pass total", () => {
			controller._recipients[0].carry = {carried: 10, capacity: 100, isIndeterminate: true};
			controller._rebuildRecipientTokens();
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("destination", [...controller._recipientByToken.keys()][0], "change");
			let carry = controller._root.querySelector(".charsheet__party-inventory-carry-delta").textContent;
			expect(carry).toContain("Mira: currently ≥10 lb of 100");
			expect(carry).toContain("impact not shown");
			expect(carry).not.toContain("10 → 12");
			controller._recipients[0].carry = null;
			controller._render();
			carry = controller._root.querySelector(".charsheet__party-inventory-carry-delta").textContent;
			expect(carry).toContain("Mira: carry not shared");
			expect(carry).not.toContain("100");
		});

		it("retains immutable currency-only intent after an uncertain proposal", async () => {
			controller._beginDraft({kind: "character"});
			change("currency-pp", "7");
			api.pProposeTransfer.mockRejectedValueOnce(Object.assign(new Error("lost response"), {code: "NETWORK_UNAVAILABLE"}));
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			const attempted = structuredClone(api.pProposeTransfer.mock.calls[0][0]);
			expect(controller._error).toContain("not yet confirmed");
			expect(controller._error).not.toContain("inventories are unchanged");
			expect(field("intent").disabled).toBe(true);
			expect(field("currency-pp").disabled).toBe(true);
			change("currency-pp", "1");
			change("intent", "request", "change");
			await controller._pRefreshParty();
			await expect(controller._pSubmitDraft()).resolves.toBe(true);
			expect(api.pProposeTransfer.mock.calls[1][0]).toEqual(attempted);
			expect(controller._fnSaveCharacter).toHaveBeenCalledTimes(1);
		});

		it("cancels pending requests through the same recovery controller and retains confirmed cancellation after refresh failure", async () => {
			field("stash-currency").fire("click");
			change("currency-gp", "5");
			await controller._pSubmitDraft();
			const cancel = jest.spyOn(controller, "_pCancelDraft");
			api.pGetPartyInventory.mockRejectedValueOnce(Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}));
			field("cancel-outgoing-transfer-1").fire("click");
			await expect(cancel.mock.results[0].value).resolves.toBe(false);
			expect(api.pResolveTransfer).toHaveBeenCalledWith(expect.objectContaining({transferId: "transfer-1", decision: "reject"}));
			expect(controller._error).toContain("Request cancelled");
			expect(controller._error).toContain("latest character and party stash balances");
			expect(controller._error).not.toContain("outcome is not confirmed");
			expect(field("submit").disabled).toBe(false);
			await expect(controller._pSubmitDraft()).resolves.toBe(true);
			expect(api.pResolveTransfer).toHaveBeenCalledTimes(1);
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(controller._announcement).toContain("stash was unchanged");
		});

		it("keeps terminal recovery reachable after the entire source stack disappears", async () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			api.pProposeTransfer.mockImplementationOnce(async request => {
				character.inventory = [];
				const transfer = {
					id: "transfer-1",
					status: "committed",
					sourceKind: "character",
					targetKind: "party_inventory",
					sourceId: "character-1",
					actorCommandId: request.idempotencyKey,
				};
				transfers = [transfer];
				return {transfer};
			});
			api.pGetPartyInventory.mockRejectedValueOnce(new Error("refresh failed"));
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			expect(controller._error).toContain("Transfer complete.");
			expect(controller._error).not.toContain("up to date");
			expect(field("submit").disabled).toBe(false);
			expect(field("quantity").disabled).toBe(true);
			await expect(controller._pSubmitDraft()).resolves.toBe(true);
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(controller._announcement).toContain("Both inventories are up to date");
		});

		it.each(["_pSubmitDraft", "_pCancelDraft"])("B2 review: recovers a confirmed terminal transfer after proposal expiry with bounded reads (%s)", async handler => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("quantity", "02");
			change("currency-gp", "05");
			api.pProposeTransfer.mockImplementationOnce(async request => {
				character.inventory = [];
				const transfer = {
					id: "transfer-1",
					status: "committed",
					sourceKind: "character",
					targetKind: "party_inventory",
					sourceId: "character-1",
					actorCommandId: request.idempotencyKey,
				};
				transfers = [transfer];
				return {transfer};
			});
			api.pGetPartyInventory.mockRejectedValueOnce(new Error("first balance refresh failed"));
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			const draft = controller._draft;
			const request = draft.proposalRequest;
			const frozenRequest = JSON.stringify(request);
			draft.proposalReplayUntil = Date.now() - 1;
			const expiredDeadline = draft.proposalReplayUntil;
			api.pListTransfers.mockClear();
			api.pGetPartyInventory.mockClear();
			repository.pReconcileAuthoritativeCharacter.mockClear();
			api.pGetPartyInventory.mockRejectedValueOnce(new Error("second balance refresh failed"));

			await expect(controller[handler]()).resolves.toBe(false);
			expect(controller._draft).toBe(draft);
			expect(draft.proposalRequest).toBe(request);
			expect(JSON.stringify(request)).toBe(frozenRequest);
			expect(draft.proposalReplayUntil).toBe(expiredDeadline);
			expect(controller._error).toContain("Transfer complete.");
			expect(controller._error).not.toContain("Both inventories are up to date");
			expect(api.pListTransfers).toHaveBeenCalledTimes(2);
			expect(api.pGetPartyInventory).toHaveBeenCalledTimes(1);
			expect(repository.pReconcileAuthoritativeCharacter).toHaveBeenCalledTimes(1);
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(api.pResolveTransfer).not.toHaveBeenCalled();

			await expect(controller[handler]()).resolves.toBe(true);
			expect(controller._draft).toBeNull();
			expect(controller._announcement).toBe("Transfer complete. Both inventories are up to date.");
			expect(api.pListTransfers).toHaveBeenCalledTimes(4);
			expect(api.pGetPartyInventory).toHaveBeenCalledTimes(2);
			expect(repository.pReconcileAuthoritativeCharacter).toHaveBeenCalledTimes(2);
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
			expect(controller._fnSaveCharacter).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(request)).toBe(frozenRequest);
		});

		it.each(["unavailable", "reconnecting"])("B2 review: keeps the raw draft unsent when transport becomes %s during the source save", async connectionState => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("quantity", "02");
			change("currency-ep", "07");
			const draft = controller._draft;
			const commandId = draft.commandId;
			let finishSave;
			controller._fnSaveCharacter.mockImplementationOnce(() => new Promise(resolve => finishSave = resolve));
			const submitting = controller._pSubmitDraft();
			expect(controller._fnSaveCharacter).toHaveBeenCalledTimes(1);
			expect(api.pProposeTransfer).not.toHaveBeenCalled();

			controller._onConnectionState({state: connectionState});
			finishSave(true);
			await expect(submitting).resolves.toBe(false);
			expect(controller._draft).toBe(draft);
			expect(draft.quantity).toBe("02");
			expect(draft.currency.ep).toBe("07");
			expect(draft.commandId).toBe(commandId);
			expect(draft.proposalRequest).toBeUndefined();
			expect(draft.proposalReplayUntil).toBeUndefined();
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
			expect(controller._error).toContain("This draft has not been sent");
			expect(field("submit").disabled).toBe(true);

			controller._onConnectionState({state: "live"});
			await controller._pDrainRefresh();
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
			expect(controller._draft).toBe(draft);
			expect(field("quantity").value).toBe("02");
			expect(field("currency-ep").value).toBe("07");
			await expect(controller._pSubmitDraft()).resolves.toBe(true);
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(api.pProposeTransfer).toHaveBeenCalledWith(expect.objectContaining({
				idempotencyKey: commandId,
				payload: {items: [{entryId: "character-stack", quantity: 2}], currency: {ep: 7}},
			}));
			expect(controller._fnSaveCharacter).toHaveBeenCalledTimes(2);
		});

		it("reports an already-committed cancellation race without claiming restoration", async () => {
			field("stash-currency").fire("click");
			change("currency-gp", "5");
			await controller._pSubmitDraft();
			api.pResolveTransfer.mockImplementationOnce(async () => {
				transfers[0].status = "committed";
				return {transfer: structuredClone(transfers[0])};
			});
			const cancel = jest.spyOn(controller, "_pCancelDraft");
			field("cancel-outgoing-transfer-1").fire("click");
			await cancel.mock.results[0].value;
			expect(controller._announcement).toContain("Transfer complete");
			expect(controller._announcement).not.toContain("cancelled");
			expect(controller._announcement).not.toContain("restored");
		});

		async function beginAcknowledgedRequestDuringAuthorityRefresh () {
			let releaseAcknowledgement;
			let markCommitted;
			const committed = new Promise(resolve => markCommitted = resolve);
			const propose = api.pProposeTransfer.getMockImplementation();
			api.pProposeTransfer.mockImplementationOnce(async request => {
				const result = await propose(request);
				markCommitted();
				return new Promise(resolve => releaseAcknowledgement = () => resolve(result));
			});
			let releaseSnapshot;
			let markSnapshotHeld;
			const snapshotHeld = new Promise(resolve => markSnapshotHeld = resolve);
			api.pGetCampaignSnapshot.mockImplementationOnce(() => new Promise(resolve => {
				releaseSnapshot = () => resolve(structuredClone(snapshot));
				markSnapshotHeld();
			}));
			controller._beginDraft({kind: "party_inventory", entryId: "stash-stack"});
			change("quantity", "02");
			change("currency-ep", "07");
			const submitting = controller._pSubmitDraft();
			await committed;
			const draft = controller._draft;
			const request = draft.proposalRequest;
			controller._onVisibilityChanged();
			await snapshotHeld;
			expect(controller._isAuthorityPending).toBe(true);
			expect(controller._hasTransferAuthority()).toBe(false);
			expect(controller._role).toBe("player");
			releaseAcknowledgement();
			return {submitting, draft, request, releaseSnapshot};
		}

		it("B2 authority: settles one acknowledged request after projection revalidation without resending or accepting", async () => {
			const {submitting, draft, request, releaseSnapshot} = await beginAcknowledgedRequestDuringAuthorityRefresh();
			const frozenRequest = JSON.stringify(request);
			releaseSnapshot();
			await controller._pDrainRefresh();
			await expect(submitting).resolves.toBe(true);
			expect(controller._isAuthorityPending).toBe(false);
			expect(controller._role).toBe("player");
			expect(controller._draft).toBeNull();
			expect(controller._error).toBeNull();
			expect(controller._announcement).toContain("Request sent");
			expect(repository.pReconcileAuthoritativeCharacter).toHaveBeenCalled();
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
			expect(draft.proposalRequest).toBe(request);
			expect(JSON.stringify(request)).toBe(frozenRequest);
			expect(transfers[0].status).toBe("proposed");
		});

		it("B2 authority: later authorized catch-up settles the acknowledged request after a failed revalidation read", async () => {
			api.pGetPartyInventory.mockRejectedValue(new Error("party read unavailable"));
			const {submitting, draft, request, releaseSnapshot} = await beginAcknowledgedRequestDuringAuthorityRefresh();
			const frozenRequest = JSON.stringify(request);
			releaseSnapshot();
			await controller._pDrainRefresh();
			await expect(submitting).resolves.toBe(false);
			expect(controller._draft).toBe(draft);
			expect(controller._error).not.toContain("role is read-only");
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);

			api.pGetPartyInventory.mockResolvedValue(structuredClone(party));
			controller._scheduleRefresh({party: true});
			await controller._pDrainRefresh();
			expect(controller._draft).toBeNull();
			expect(controller._announcement).toContain("Request sent");
			expect(controller._error).toBeNull();
			expect(repository.pReconcileAuthoritativeCharacter).toHaveBeenCalled();
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
			expect(draft.proposalRequest).toBe(request);
			expect(JSON.stringify(request)).toBe(frozenRequest);
		});

		it("B2 authority: actual role loss never automatically settles or accepts an acknowledged request", async () => {
			const {submitting, draft, request, releaseSnapshot} = await beginAcknowledgedRequestDuringAuthorityRefresh();
			snapshot.membership.role = "spectator";
			releaseSnapshot();
			await controller._pDrainRefresh();
			await expect(submitting).resolves.toBe(false);
			expect(controller._role).toBe("spectator");
			expect(controller._hasTransferAuthority()).toBe(false);
			expect(controller._draft).toBe(draft);
			expect(draft.proposalRequest).toBe(request);
			expect(controller._error).toContain("read-only");
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
		});

		it("B2 authority: requires the exact acknowledged transfer in the fresh authorized collection", async () => {
			api.pListTransfers.mockResolvedValue([]);
			const {submitting, draft, request, releaseSnapshot} = await beginAcknowledgedRequestDuringAuthorityRefresh();
			releaseSnapshot();
			await controller._pDrainRefresh();
			await expect(submitting).resolves.toBe(false);
			expect(controller._draft).toBe(draft);
			expect(draft.needsStatusCheck).toBe(true);
			expect(controller._error).toContain("latest status could not be verified");
			api.pListTransfers.mockImplementation(async () => structuredClone(transfers));
			controller._scheduleRefresh({party: true});
			await controller._pDrainRefresh();
			expect(controller._draft).toBeNull();
			expect(controller._announcement).toContain("Request sent");
			expect(draft.proposalRequest).toBe(request);
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
		});

		it("B2 authority: detaching during revalidation fences the acknowledged draft and late reads", async () => {
			const {submitting, releaseSnapshot} = await beginAcknowledgedRequestDuringAuthorityRefresh();
			controller.detach();
			releaseSnapshot();
			await expect(submitting).resolves.toBe(false);
			expect(controller._draft).toBeNull();
			expect(controller._active).toBeNull();
			expect(controller._root).toBeNull();
			expect(controller._announcement).toBe("");
			expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
			expect(api.pResolveTransfer).not.toHaveBeenCalled();
		});

		it("requests serialized owner catch-up when a pending offer becomes terminal on an authoritative refetch", async () => {
			transfers = [{
				id: "outgoing-1",
				status: "committed",
				actorCommandId: "own-command",
				sourceKind: "character",
				sourceId: "character-1",
				targetKind: "party_inventory",
			}];
			controller._outgoingStatuses.set("outgoing-1", "reserved");
			controller._scheduleRefresh = jest.fn();
			await controller._pRefreshParty();
			expect(controller._scheduleRefresh).toHaveBeenCalledWith({character: true});
			expect(controller._outgoingTransfers).toEqual([]);
			expect(controller._announcement).toContain("Transfer complete");
			expect(controller._announcement).not.toContain("Both inventories are up to date");
		});

		it("rechecks changed source authority after the ordinary pre-transfer save", async () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("currency-gp", "5");
			controller._fnSaveCharacter.mockImplementationOnce(async () => {
				character.currency.gp = 0;
				return true;
			});
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
			expect(controller._draft.currency.gp).toBe("5");
			expect(controller._error).toContain("source balances");
		});

		it("conceals revoked details immediately, discards editable authority-scoped drafts, and fences old controls", async () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			const oldInput = field("currency-gp");
			change("destination", [...controller._recipientByToken.keys()][0], "change");
			controller._scheduleRefresh = jest.fn();
			controller._onVisibilityChanged({isAuthorityChanged: true});
			expect(controller._draft).toBeNull();
			expect(controller._root.textContent).not.toContain("Mira");
			expect(controller._root.textContent).not.toContain("Torch");
			expect(controller._recipients).toEqual([]);
			oldInput.value = "99";
			oldInput.fire("input");
			expect(controller._draft).toBeNull();
			snapshot.membership.role = "spectator";
			await controller._pRefreshParty();
			expect(controller._beginDraft({kind: "character"})).toBe(false);
			expect(field("share")).toBeNull();
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
		});

		it("retains same-scope values but conceals recipient identity during projection revalidation", async () => {
			controller._beginDraft({kind: "character", entryId: "character-stack"});
			change("destination", [...controller._recipientByToken.keys()][0], "change");
			change("currency-ep", "07");
			field("currency-ep").focus();
			controller._scheduleRefresh = jest.fn();
			controller._onVisibilityChanged();
			expect(controller._draft.currency.ep).toBe("07");
			expect(controller._root.textContent).not.toContain("Mira");
			expect(field("submit").disabled).toBe(true);
			expect(document.activeElement).toBe(field("currency-ep"));
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			await controller._pRefreshParty();
			expect(field("currency-ep").value).toBe("07");
			expect(document.activeElement).toBe(field("currency-ep"));
			expect(field("destination").value).not.toBe("party_inventory");
			expect(controller._root.textContent).toContain("Mira");
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
		});

		it("never sends fresh offline drafts or lets detached controls mutate a replacement character", async () => {
			const oldShare = field("share");
			controller._beginDraft({kind: "character"});
			change("currency-sp", "5");
			const oldInput = field("currency-sp");
			controller._onConnectionState({state: "unavailable"});
			expect(field("submit").disabled).toBe(true);
			await expect(controller._pSubmitDraft()).resolves.toBe(false);
			expect(api.pProposeTransfer).not.toHaveBeenCalled();
			controller.detach();
			controller._active = {characterId: "replacement", generation: 2, isOwner: true};
			controller._role = "player";
			oldShare.fire("click");
			expect(controller._draft).toBeNull();
			controller._beginDraft({kind: "character"});
			const replacement = controller._draft;
			oldInput.value = "98";
			oldInput.fire("input");
			expect(replacement.currency).toEqual({});
		});
	});

	it("does nothing for local characters", async () => {
		const api = {
			pGetCharacterProjection: jest.fn(),
			pGetPartyInventory: jest.fn(),
		};
		const realtime = {on: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api,
			realtime,
			campaignId: null,
			repository: null,
		});

		await expect(partyInventory.pAttach({characterId: "local-character", generation: 1})).resolves.toBe(false);
		expect(api.pGetCharacterProjection).not.toHaveBeenCalled();
		expect(api.pGetPartyInventory).not.toHaveBeenCalled();
		expect(realtime.on).not.toHaveBeenCalled();
	});

	it("distinguishes a retained attachment from one fenced by a newer character generation", () => {
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: null,
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 7};

		expect(partyInventory.isAttachedTo({characterId: "character-1"})).toBe(true);
		expect(partyInventory.isAttachedTo({characterId: "character-1", generation: 7})).toBe(true);
		expect(partyInventory.isAttachedTo({characterId: "character-1", generation: 8})).toBe(false);
	});

	it("preserves the active transfer draft until it is reconciled", () => {
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [
					{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}},
					{id: "stack-2", quantity: 1, item: {name: "Torch", source: "PHB"}},
				],
			}),
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";

		expect(partyInventory._beginDraft({kind: "character", entryId: "stack-1"})).toBe(true);
		const originalDraft = partyInventory._draft;
		originalDraft.proposalRequest = {idempotencyKey: originalDraft.commandId};

		expect(partyInventory._beginDraft({kind: "character", entryId: "stack-2"})).toBe(false);
		expect(partyInventory._draft).toBe(originalDraft);
		expect(partyInventory._draft.proposalRequest.idempotencyKey).toBe(originalDraft.commandId);
	});

	it("keeps spectator inventory read-only while preserving frozen recovery", async () => {
		const character = {inventory: [{id: "stack-1", item: {name: "Rope", source: "PHB"}, quantity: 1}], currency: {}};
		const committed = {id: "transfer-1", status: "committed"};
		const propose = jest.fn(async () => ({transfer: committed}));
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pProposeTransfer: propose,
				pListTransfers: jest.fn(async () => [committed]),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "spectator";
		partyInventory._render = jest.fn();
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		expect(partyInventory._beginDraft({kind: "character", entryId: "stack-1"})).toBe(false);
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			entryName: "Rope",
			quantity: 1,
			maxQuantity: 1,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			commandId: "proposal-1",
			resolutionCommandId: "resolution-1",
			cancellationCommandId: "cancellation-1",
			proposalRequest: {
				campaignId: "campaign-1",
				sourceKind: "character",
				sourceId: "character-1",
				targetKind: "party_inventory",
				targetId: "party-1",
				payload: {items: [{entryId: "stack-1", quantity: 1}], currency: {}},
				idempotencyKey: "proposal-1",
				isAutoResolved: false,
			},
			proposalReplayUntil: Date.now() + 60_000,
			transfer: null,
			needsStatusCheck: false,
			pendingResolution: null,
		};
		const frozenRequest = partyInventory._draft.proposalRequest;

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);
		expect(propose).toHaveBeenCalledWith(frozenRequest);
		expect(partyInventory._draft).toBeNull();
	});

	it("closes an editable draft when an authoritative refresh changes the role to spectator", async () => {
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pListTransfers: jest.fn(async () => []),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "spectator"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			transfer: null,
			proposalRequest: null,
		};
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		await expect(partyInventory._pRefreshParty()).resolves.toBe(true);

		expect(partyInventory._role).toBe("spectator");
		expect(partyInventory._draft).toBeNull();
		expect(partyInventory._announcement).toContain("read-only");
		expect(partyInventory._decorateCharacterInventory).toHaveBeenCalled();
	});

	it("fences an owner lookup after the current character generation changes", async () => {
		let resolveProjection;
		const api = {
			pGetCharacterProjection: jest.fn(() => new Promise(resolve => {
				resolveProjection = resolve;
			})),
			pGetPartyInventory: jest.fn(),
		};
		let generation = 1;
		const partyInventory = new CharacterSheetPartyInventory({
			api,
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: input => input.generation === generation,
		});

		const attaching = partyInventory.pAttach({characterId: "character-1", generation: 1});
		generation = 2;
		resolveProjection({kind: "owner_truth"});

		await expect(attaching).resolves.toBe(false);
		expect(api.pGetPartyInventory).not.toHaveBeenCalled();
		expect(partyInventory._root).toBeNull();
	});

	it("does not let an older party fetch overwrite a newer response", async () => {
		let resolveOldParty;
		let resolveOldSnapshot;
		const api = {
			pGetPartyInventory: jest.fn()
				.mockImplementationOnce(() => new Promise(resolve => {
					resolveOldParty = resolve;
				}))
				.mockResolvedValueOnce({id: "party-1", revision: 2, inventory: [], currency: {}}),
			pListTransfers: jest.fn(async () => []),
			pGetCampaignSnapshot: jest.fn()
				.mockImplementationOnce(() => new Promise(resolve => {
					resolveOldSnapshot = resolve;
				}))
				.mockResolvedValueOnce({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				}),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			api,
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._role = "player";
		partyInventory._decorateCharacterInventory = jest.fn();

		const older = partyInventory._pRefreshParty();
		await expect(partyInventory._pRefreshParty()).resolves.toBe(true);
		resolveOldParty({id: "party-1", revision: 1, inventory: [{id: "old"}], currency: {}});
		resolveOldSnapshot({
			membership: {role: "player"},
			characters: [{kind: "owner_truth", character: {id: "character-1"}}],
			roster: [],
		});
		await expect(older).resolves.toBe(false);

		expect(partyInventory._partyInventory.revision).toBe(2);
		expect(partyInventory._partyInventory.inventory).toEqual([]);
	});

	it("shows an active refresh while retaining the last synced stash", async () => {
		let resolveParty;
		let resolveSnapshot;
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(() => new Promise(resolve => resolveParty = resolve)),
				pListTransfers: jest.fn(async () => []),
				pGetCampaignSnapshot: jest.fn(() => new Promise(resolve => resolveSnapshot = resolve)),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		const refreshing = partyInventory._pRefreshParty();

		expect(partyInventory._isLoading).toBe(true);
		expect(partyInventory._render).toHaveBeenCalled();

		resolveParty({id: "party-1", inventory: [], currency: {}});
		resolveSnapshot({
			membership: {role: "player"},
			characters: [{kind: "owner_truth", character: {id: "character-1"}}],
			roster: [],
		});
		await expect(refreshing).resolves.toBe(true);
		expect(partyInventory._isLoading).toBe(false);
	});

	it("shows only authorized reserved transfers addressed to the open owner character", async () => {
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
				pListTransfers: jest.fn(async () => [
					{id: "current", status: "reserved", targetKind: "character", targetId: "character-1"},
					{id: "other", status: "reserved", targetKind: "character", targetId: "character-2"},
					{id: "stash", status: "proposed", targetKind: "character", targetId: "character-1"},
				]),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		await expect(partyInventory._pRefreshParty()).resolves.toBe(true);
		expect(partyInventory._incomingTransfers.map(transfer => transfer.id)).toEqual(["current"]);
		expect(partyInventory._incomingError).toBeNull();
	});

	it("retires the losing player's stale stash request when the winning approval consumes its item", async () => {
		const toast = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
				pListTransfers: jest.fn(async () => [{
					id: "loser",
					status: "cancelled",
					targetKind: "character",
					targetId: "character-1",
					payload: {cancellationReason: "source_insufficient"},
				}]),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
			fnToast: toast,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._draft = {kind: "party_inventory", transfer: {id: "loser", status: "proposed"}};
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		await expect(partyInventory._pRefreshParty()).resolves.toBe(true);
		expect(partyInventory._draft).toBeNull();
		expect(partyInventory._refreshNotice).toContain("no longer available");
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({
			type: "warning",
			content: expect.stringContaining("no longer available"),
		}));
	});

	it("fences incoming actions when authoritative transfer status cannot be refreshed", async () => {
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
				pListTransfers: jest.fn(async () => { throw new Error("offline"); }),
				pResolveTransfer: jest.fn(),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._incomingTransfers = [{id: "stale", status: "reserved", targetKind: "character", targetId: "character-1"}];
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		await expect(partyInventory._pRefreshParty()).resolves.toBe(false);
		expect(partyInventory._incomingTransfers).toEqual([]);
		expect(partyInventory._incomingError).toContain("could not be verified");
		await expect(partyInventory._pResolveIncomingTransfer({transferId: "stale", decision: "accept"})).resolves.toBe(false);
		expect(partyInventory._api.pResolveTransfer).not.toHaveBeenCalled();
		partyInventory._api.pListTransfers.mockResolvedValueOnce({transfers: []});
		await expect(partyInventory._pRefreshParty()).resolves.toBe(false);
		expect(partyInventory._partyError).toContain("response is invalid");
		expect(partyInventory._incomingTransfers).toEqual([]);
	});

	it("conceals prior incoming transfer details before rechecking projection authority", () => {
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
		});
		partyInventory._active = {characterId: "character-1", isOwner: true};
		partyInventory._incomingTransfers = [{id: "incoming-1", sourceDisplaySnapshot: {displayName: "Formerly Shared"}}];
		partyInventory._partyFetchToken = Symbol("old-view");
		partyInventory._render = jest.fn();
		partyInventory._scheduleRefresh = jest.fn();

		partyInventory._onVisibilityChanged();
		expect(partyInventory._incomingTransfers).toEqual([]);
		expect(partyInventory._incomingError).toContain("Rechecking");
		expect(partyInventory._partyFetchToken).toBeNull();
		expect(partyInventory._render).toHaveBeenCalled();
		expect(partyInventory._scheduleRefresh).toHaveBeenCalledWith({party: true});
	});

	it("keeps an uncertain incoming acceptance bound to its original decision and idempotency key", async () => {
		const resolve = jest.fn()
			.mockRejectedValueOnce(Object.assign(new Error("gateway lost response"), {code: "SERVICE_UNAVAILABLE", status: 502}))
			.mockResolvedValueOnce({transfer: {status: "committed"}});
		const toast = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetCampaignContext: jest.fn(async () => ({rulesVersion: {id: "rules-1"}})),
				pResolveTransfer: resolve,
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
			fnToast: toast,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._incomingTransfers = [{id: "incoming-1", status: "reserved", targetKind: "character", targetId: "character-1"}];
		partyInventory._incomingStatuses.set("incoming-1", "reserved");
		partyInventory._render = jest.fn();
		partyInventory._pDrainRefresh = jest.fn(async () => {
			if (resolve.mock.calls.length > 1) {
				partyInventory._incomingTransfers = [];
				partyInventory._incomingStatuses.set("incoming-1", "committed");
			}
			return true;
		});

		await expect(partyInventory._pResolveIncomingTransfer({transferId: "incoming-1", decision: "accept"})).resolves.toBe(false);
		expect(partyInventory._incomingError).toContain("could not be loaded");
		await expect(partyInventory._pResolveIncomingTransfer({transferId: "incoming-1", decision: "reject"})).resolves.toBe(false);
		expect(resolve).toHaveBeenCalledTimes(1);
		partyInventory._incomingError = null;
		await expect(partyInventory._pResolveIncomingTransfer({transferId: "incoming-1", decision: "accept"})).resolves.toBe(true);
		expect(resolve.mock.calls.map(([request]) => request)).toEqual([
			expect.objectContaining({decision: "accept", rulesVersionId: "rules-1"}),
			expect.objectContaining({decision: "accept", rulesVersionId: "rules-1"}),
		]);
		expect(resolve.mock.calls[0][0].idempotencyKey).toBe(resolve.mock.calls[1][0].idempotencyKey);
		expect(toast).toHaveBeenCalledWith({type: "success", content: "Transfer accepted."});
	});

	it("confirms a lost incoming response only after a fresh authoritative status and character refresh", async () => {
		const toast = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
			fnToast: toast,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._incomingUnconfirmed = {transferId: "incoming-1", decision: "accept"};
		partyInventory._incomingOutcomeWarning = "Transfer outcome is not confirmed.";
		partyInventory._incomingError = "Refresh before responding.";
		partyInventory._render = jest.fn();
		partyInventory._pDrainRefresh = jest.fn(async () => {
			partyInventory._incomingStatuses.set("incoming-1", "committed");
			partyInventory._incomingError = null;
			return true;
		});

		await expect(partyInventory._pManualRefresh({errorSource: "party"})).resolves.toBe(true);
		expect(partyInventory._incomingUnconfirmed).toBeNull();
		expect(partyInventory._incomingOutcomeWarning).toBeNull();
		expect(toast).toHaveBeenCalledWith({
			type: "success",
			content: "Transfer accepted; latest balances confirmed after refresh.",
		});
	});

	it("does not resolve an incoming transfer after the character is detached during rules lookup", async () => {
		let resolveContext;
		const resolve = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetCampaignContext: jest.fn(() => new Promise(resolve => resolveContext = resolve)),
				pResolveTransfer: resolve,
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._incomingTransfers = [{id: "incoming-1", status: "reserved", targetKind: "character", targetId: "character-1"}];
		partyInventory._render = jest.fn();

		const pending = partyInventory._pResolveIncomingTransfer({transferId: "incoming-1", decision: "accept"});
		partyInventory.detach();
		resolveContext({rulesVersion: {id: "rules-1"}});
		await expect(pending).resolves.toBe(false);
		expect(resolve).not.toHaveBeenCalled();
	});

	it("preserves a reconciliation conflict when the party fetch settles last", async () => {
		let resolveParty;
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(() => new Promise(resolve => resolveParty = resolve)),
				pListTransfers: jest.fn(async () => []),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn(async () => ({status: "conflict"}))},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		const refreshingParty = partyInventory._pRefreshParty();
		await partyInventory._pReconcileCharacter();
		resolveParty({id: "party-1", inventory: [], currency: {}});
		await refreshingParty;

		expect(partyInventory._getVisibleError()).toEqual({
			source: "reconcile",
			message: expect.stringContaining("Saving is paused"),
		});
		expect(partyInventory._partyError).toBeNull();
	});

	it("preserves a failed authoritative adoption when reconciliation settles after the party fetch", async () => {
		let resolveReconcile;
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pListTransfers: jest.fn(async () => []),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
			},
			campaignId: "campaign-1",
			repository: {
				pReconcileAuthoritativeCharacter: jest.fn(() => new Promise(resolve => resolveReconcile = resolve)),
			},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		const reconciling = partyInventory._pReconcileCharacter();
		await partyInventory._pRefreshParty();
		resolveReconcile({status: "failed"});
		await reconciling;

		expect(partyInventory._getVisibleError()).toEqual({
			source: "reconcile",
			message: expect.stringContaining("could not be applied"),
		});
	});

	it("clears only the error channel whose refresh recovered", async () => {
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pListTransfers: jest.fn(async () => []),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn(async () => ({status: "unchanged"}))},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._error = "A transfer action failed.";
		partyInventory._partyError = "The stash fetch failed.";
		partyInventory._reconcileError = "Saving is paused.";
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		await partyInventory._pReconcileCharacter();
		expect(partyInventory._reconcileError).toBeNull();
		expect(partyInventory._partyError).toBe("The stash fetch failed.");
		expect(partyInventory._error).toBe("A transfer action failed.");

		await partyInventory._pRefreshParty();
		expect(partyInventory._partyError).toBeNull();
		expect(partyInventory._error).toBe("A transfer action failed.");
		expect(partyInventory._getVisibleError()).toEqual({
			source: "action",
			message: "A transfer action failed.",
		});
	});

	it("detaches cached party inventory after an authoritative HTTP access failure", async () => {
		const error = Object.assign(new Error("forbidden"), {code: "FORBIDDEN"});
		const root = {remove: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => { throw error; }),
				pGetCampaignSnapshot: jest.fn(async () => ({membership: {role: "player"}, characters: [], roster: []})),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [{id: "cached"}], currency: {}};
		partyInventory._root = root;
		partyInventory._render = jest.fn();

		await expect(partyInventory._pRefreshParty()).resolves.toBe(false);

		expect(root.remove).toHaveBeenCalled();
		expect(partyInventory._active).toBeNull();
		expect(partyInventory._partyInventory).toBeNull();
	});

	it("conceals the incoming notice when transfer-list authority is lost", async () => {
		const error = Object.assign(new Error("forbidden"), {code: "FORBIDDEN"});
		const notice = {remove: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
				pListTransfers: jest.fn(async () => { throw error; }),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._incomingTransfers = [{id: "previously-visible"}];
		partyInventory._incomingRoot = notice;
		partyInventory._render = jest.fn();

		await expect(partyInventory._pRefreshParty()).resolves.toBe(false);
		expect(notice.remove).toHaveBeenCalled();
		expect(partyInventory._active).toBeNull();
		expect(partyInventory._incomingTransfers).toEqual([]);
	});

	it("retries transient ownership verification when realtime becomes live and performs a full catch-up", async () => {
		const listeners = new Map();
		let rejectProjection;
		const api = {
			pGetCharacterProjection: jest.fn()
				.mockImplementationOnce(() => new Promise((_resolve, reject) => rejectProjection = reject))
				.mockResolvedValueOnce({kind: "owner_truth"}),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			api,
			realtime: {
				on: jest.fn((type, listener) => {
					listeners.set(type, listener);
					return jest.fn();
				}),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._mount = jest.fn();
		partyInventory._bindInventoryUi = jest.fn();
		partyInventory._render = jest.fn();
		const refreshed = [];
		partyInventory._pDrainRefresh = jest.fn(async () => refreshed.push({...partyInventory._refreshFlags}) && true);

		const attaching = partyInventory.pAttach({characterId: "character-1", generation: 1});
		listeners.get("inventoryTransfer")({campaignId: "campaign-1", eventId: "event-1"});
		listeners.get("connectionState")({state: "live"});
		rejectProjection(new Error("offline"));
		await expect(attaching).resolves.toBe(false);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(api.pGetCharacterProjection).toHaveBeenCalledTimes(2);
		expect(partyInventory._active).toMatchObject({isOwner: true, isActivationPending: false});
		expect(refreshed).toContainEqual({character: true, party: true});
	});

	it("does not let an old character refresh own or clear a new character refresh", async () => {
		let resolveOld;
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		const oldActive = {characterId: "old", generation: 1, token: Symbol("old"), isOwner: true};
		partyInventory._active = oldActive;
		partyInventory._refreshFlags = {character: true, party: false};
		partyInventory._pReconcileCharacter = jest.fn(active => active === oldActive
			? new Promise(resolve => resolveOld = resolve)
			: Promise.resolve({status: "reconciled"}));
		partyInventory._pRefreshParty = jest.fn(async () => true);
		const oldRefresh = partyInventory._pDrainRefresh();

		partyInventory.detach();
		const newActive = {characterId: "new", generation: 2, token: Symbol("new"), isOwner: true};
		partyInventory._active = newActive;
		partyInventory._refreshFlags = {character: false, party: true};
		await expect(partyInventory._pDrainRefresh()).resolves.toBe(true);
		resolveOld({status: "error"});
		await expect(oldRefresh).resolves.toBe(false);

		expect(partyInventory._pRefreshParty).toHaveBeenCalledWith(newActive);
		expect(partyInventory._active).toBe(newActive);
	});

	it("queues one manual retry while the initial failed refresh is still settling", async () => {
		let resolveInitialReconcile;
		let markInitialPartyFailed;
		const initialPartyFailed = new Promise(resolve => markInitialPartyFailed = resolve);
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		const active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._active = active;
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();
		partyInventory._pReconcileCharacter = jest.fn()
			.mockImplementationOnce(() => new Promise(resolve => resolveInitialReconcile = resolve))
			.mockResolvedValue({status: "unchanged"});
		partyInventory._pRefreshParty = jest.fn()
			.mockImplementationOnce(async () => {
				partyInventory._partyError = "The latest party inventory could not be loaded.";
				partyInventory._isLoading = false;
				partyInventory._render();
				markInitialPartyFailed();
				return false;
			})
			.mockResolvedValueOnce(true);
		partyInventory._refreshFlags = {character: true, party: true};

		const initialRefresh = partyInventory._pDrainRefresh();
		await initialPartyFailed;
		const manualRefresh = partyInventory._pManualRefresh({errorSource: "party"});

		expect(partyInventory._manualRefreshPromise).toBe(manualRefresh);
		expect(partyInventory._refreshNotice).toBe("");
		expect(partyInventory._partyError).toBe("The latest party inventory could not be loaded.");
		expect(partyInventory._refreshFlags).toEqual({character: false, party: false});

		resolveInitialReconcile({status: "unchanged"});
		await expect(initialRefresh).resolves.toBe(false);
		await expect(manualRefresh).resolves.toBe(true);

		expect(partyInventory._pRefreshParty).toHaveBeenCalledTimes(2);
		expect(partyInventory._pReconcileCharacter).toHaveBeenCalledTimes(2);
		expect(partyInventory._refreshNotice).toBe("Party stash refreshed.");
		expect(partyInventory._partyError).toBeNull();
	});

	it("does not start a fresh manual attempt after the pending refresh loses its character scope", async () => {
		let resolveInitialReconcile;
		let isCurrent = true;
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => isCurrent,
		});
		const active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._active = active;
		partyInventory._render = jest.fn();
		partyInventory._pReconcileCharacter = jest.fn(() => new Promise(resolve => resolveInitialReconcile = resolve));
		partyInventory._pRefreshParty = jest.fn(async () => true);
		partyInventory._partyError = "The latest party inventory could not be loaded.";
		partyInventory._refreshFlags = {character: true, party: false};

		const initialRefresh = partyInventory._pDrainRefresh();
		const manualRefresh = partyInventory._pManualRefresh({errorSource: "party"});
		isCurrent = false;
		resolveInitialReconcile({status: "unchanged"});

		await expect(initialRefresh).resolves.toBe(true);
		await expect(manualRefresh).resolves.toBe(false);
		expect(partyInventory._pReconcileCharacter).toHaveBeenCalledTimes(1);
		expect(partyInventory._pRefreshParty).not.toHaveBeenCalled();
		expect(partyInventory._partyError).toBe("The latest party inventory could not be loaded.");
		expect(partyInventory._refreshNotice).toBe("");
	});

	it("does not consume a semantic-effect revision from a generic projection invalidation", () => {
		const listeners = new Map();
		const realtime = {
			on: jest.fn((type, listener) => {
				listeners.set(type, listener);
				return jest.fn();
			}),
		};
		const repository = {pReconcileAuthoritativeCharacter: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			realtime,
			campaignId: "campaign-1",
			repository,
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._scheduleRefresh = jest.fn();

		listeners.get("projectionInvalidated")({characterId: "character-1"});

		expect(partyInventory._scheduleRefresh).toHaveBeenCalledWith({party: true});
		expect(repository.pReconcileAuthoritativeCharacter).not.toHaveBeenCalled();
	});

	it("refetches the stash projection after membership authority changes", () => {
		const listeners = new Map();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			realtime: {
				on: jest.fn((type, listener) => {
					listeners.set(type, listener);
					return jest.fn();
				}),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._scheduleRefresh = jest.fn();

		listeners.get("membershipChanged")({campaignId: "campaign-1", source: "event"});

		expect(partyInventory._scheduleRefresh).toHaveBeenCalledWith({party: true});
	});

	it("leaves cursor-covered character reconciliation to the owning Character Sheet page", () => {
		const listeners = new Map();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			realtime: {
				on: jest.fn((type, listener) => {
					listeners.set(type, listener);
					return jest.fn();
				}),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._scheduleRefresh = jest.fn();

		listeners.get("projectionInvalidated")({
			characterId: "character-1",
			source: "cursor",
			isCharacterDocumentChanged: true,
		});

		expect(partyInventory._scheduleRefresh).toHaveBeenCalledWith({party: true});
	});

	it("reconciles an item award into the open owner sheet exactly once without refreshing the stash", () => {
		const listeners = new Map();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			realtime: {
				on: jest.fn((type, listener) => {
					listeners.set(type, listener);
					return jest.fn();
				}),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._scheduleRefresh = jest.fn();
		const event = {
			eventId: "award-event-1",
			campaignId: "campaign-1",
			type: "item.granted",
			sequence: 17,
			isCurrentCharacterAffected: true,
			isPartyInventoryAffected: false,
		};

		listeners.get("inventoryTransfer")(event);
		listeners.get("inventoryTransfer")(event);

		expect(partyInventory._scheduleRefresh).toHaveBeenCalledTimes(1);
		expect(partyInventory._scheduleRefresh).toHaveBeenCalledWith({character: true, party: false});
	});

	it("removes campaign inventory immediately when realtime access is lost", () => {
		const root = {remove: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._root = root;
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};

		partyInventory._onConnectionState({state: "access_lost"});

		expect(partyInventory._active).toBeNull();
		expect(partyInventory._partyInventory).toBeNull();
		expect(root.remove).toHaveBeenCalledTimes(1);
	});

	it("keeps party inventory mounted across a suspended realtime connection", () => {
		const root = {remove: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._root = root;

		partyInventory._onConnectionState({state: "closed"});

		expect(partyInventory._active?.isOwner).toBe(true);
		expect(root.remove).not.toHaveBeenCalled();
	});

	it("decorates unchanged transfer blockers without replacing their DOM nodes", () => {
		const previousDocument = globalThis.document;
		let note = null;
		let button = null;
		const actions = {
			querySelector: () => button,
			append: value => { button = value; },
		};
		const details = {append: value => { note = value; }};
		const row = {
			dataset: {itemId: "stack-1"},
			querySelector: selector => ({
				".charsheet__item-actions": actions,
				".charsheet__item-party-move": button,
				".charsheet__item-party-note": note,
				".charsheet__item-details": details,
			})[selector] || null,
		};
		globalThis.document = {
			querySelectorAll: () => [row],
			createElement: tag => ({
				tag,
				dataset: {},
				disabled: false,
				textContent: "",
				setAttribute: jest.fn(),
			}),
		};
		const character = {
			inventory: [{id: "stack-1", quantity: 1, equipped: true, item: {name: "Shield"}}],
		};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._role = "player";

		try {
			partyInventory._decorateCharacterInventory();
			const firstNote = note;
			partyInventory._decorateCharacterInventory();
			expect(note).toBe(firstNote);
		} finally {
			globalThis.document = previousDocument;
		}
	});

	it("derives privacy-safe projected recipient labels and opaque picker tokens", () => {
		const recipients = getPartyInventoryRecipients({
			projections: [
				{
					kind: "peer_profile",
					id: "recipient-character",
					data: {identity: {name: "Mira"}, classes: [{name: "Fighter", level: 3}]},
				},
				{
					kind: "owner_truth",
					character: {id: "current-character", data: {name: "Rowan", classes: [{name: "Ranger", level: 3}]}},
				},
				{kind: "peer_profile", id: "hidden-character", data: {classes: []}},
			],
			roster: [
				{characterId: "recipient-character"},
				{characterId: "current-character"},
			],
			currentCharacterId: "current-character",
		});

		expect(recipients).toEqual([
			// `carry: null` is the privacy-safe default: this peer shared no carry summary, and
			// a withheld load must be absent rather than defaulted to a number.
			{id: "recipient-character", label: "Mira", summary: "Fighter 3", isOwned: false, carry: null},
		]);
		expect(JSON.stringify(recipients)).not.toContain("hidden-character");
	});

	it("always targets the open character when a DM withdraws from the stash", () => {
		expect(getPartyInventoryTransferTargetId({
			sourceKind: "party_inventory",
			destinationKind: "character",
			activeCharacterId: "open-character",
			recipientId: "another-character",
			partyInventoryId: "party-inventory",
		})).toBe("open-character");
	});

	it("rejects an already-reserved transfer instead of abandoning its escrow", async () => {
		const api = {
			pResolveTransfer: jest.fn(async () => ({transfer: {status: "rejected"}})),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._draft = {
			transfer: {id: "transfer-1"},
			cancellationCommandId: "cancel-command-1",
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pCancelDraft()).resolves.toBe(true);

		expect(api.pResolveTransfer).toHaveBeenCalledWith(expect.objectContaining({
			campaignId: "campaign-1",
			transferId: "transfer-1",
			decision: "reject",
			idempotencyKey: "cancel-command-1",
		}));
		expect(partyInventory._pDrainRefresh).toHaveBeenCalledTimes(1);
		expect(partyInventory._isSubmitting).toBe(false);
		expect(partyInventory._draft).toBeNull();
	});

	it("replays a lost cancellation with one immutable reject request", async () => {
		const resolve = jest.fn()
			.mockRejectedValueOnce(Object.assign(new Error("gateway lost response"), {code: "SERVICE_UNAVAILABLE", status: 502}))
			.mockResolvedValueOnce({transfer: {status: "rejected"}});
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {pResolveTransfer: resolve},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._draft = {
			transfer: {id: "transfer-1", status: "reserved"},
			cancellationCommandId: "cancel-command-1",
			needsStatusCheck: false,
			pendingResolution: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pCancelDraft()).resolves.toBe(false);
		expect(partyInventory._draft.pendingResolution).toEqual(expect.objectContaining({
			campaignId: "campaign-1",
			transferId: "transfer-1",
			decision: "reject",
			idempotencyKey: "cancel-command-1",
		}));
		expect(partyInventory._draft.pendingResolution.replayUntil).toBeGreaterThan(Date.now());
		expect(partyInventory._draft.needsStatusCheck).toBe(true);
		await expect(partyInventory._pCancelDraft()).resolves.toBe(true);
		expect(resolve.mock.calls.map(([request]) => request)).toEqual([
			expect.objectContaining({decision: "reject", idempotencyKey: "cancel-command-1"}),
			expect.objectContaining({decision: "reject", idempotencyKey: "cancel-command-1"}),
		]);
	});

	it("checks status without accepting after an uncertain cancellation", async () => {
		const resolve = jest.fn(async () => {
			throw Object.assign(new Error("gateway lost response"), {code: "SERVICE_UNAVAILABLE", status: 502});
		});
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pResolveTransfer: resolve,
				pListTransfers: jest.fn(async () => [{id: "transfer-1", status: "reserved"}]),
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			destinationKind: "character",
			recipientId: "character-2",
			transfer: {id: "transfer-1", status: "reserved"},
			cancellationCommandId: "cancel-command-1",
			needsStatusCheck: false,
			pendingResolution: null,
		};

		await expect(partyInventory._pCancelDraft()).resolves.toBe(false);
		partyInventory._draft.pendingResolution.replayUntil = 0;
		await expect(partyInventory._pCancelDraft()).resolves.toBe(false);
		expect(partyInventory._error).toContain("too old to replay safely");
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		const rotatedCancellationKey = partyInventory._draft.pendingResolution.idempotencyKey;
		expect(partyInventory._error).toContain("acceptance remains unavailable");
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(rotatedCancellationKey).not.toBe("cancel-command-1");
		expect(partyInventory._draft.pendingResolution).toEqual(expect.objectContaining({
			decision: "reject",
			idempotencyKey: rotatedCancellationKey,
		}));
		expect(partyInventory._draft.needsStatusCheck).toBe(false);
		expect(partyInventory._error).toContain("not yet confirmed");
	});

	it("re-enables controls after a successful reservation", async () => {
		const character = {
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
		};
		const api = {
			pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "reserved"}})),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnToast: jest.fn(),
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			commandId: "propose-command-1",
			resolutionCommandId: "resolve-command-1",
			cancellationCommandId: "cancel-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
		expect(partyInventory._isSubmitting).toBe(false);
		expect(partyInventory._draft).toBeNull();
		expect(partyInventory._announcement).toContain("Transfer reserved");
	});

	it("finishes a reserved transfer after a projection fence supersedes its first refresh", async () => {
		const character = {inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}]};
		const api = {pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "reserved"}}))};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			commandId: "propose-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn()
			.mockImplementationOnce(async () => {
				partyInventory._projectionVisibilityEpoch++;
				return false;
			})
			.mockResolvedValueOnce(true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);
		expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
		expect(partyInventory._pDrainRefresh).toHaveBeenCalledTimes(2);
		expect(partyInventory._announcement).toContain("Transfer reserved");
	});

	it("submits a player stash withdrawal as a DM-approved request without self-resolving", async () => {
		const api = {
			pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "proposed"}})),
			pResolveTransfer: jest.fn(),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({inventory: [], currency: {}}),
			fnIsCurrentCharacter: () => true,
			fnToast: jest.fn(),
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {
			id: "party-1",
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			currency: {},
		};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "party_inventory",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: null,
			commandId: "propose-command-1",
			resolutionCommandId: "resolve-command-1",
			cancellationCommandId: "cancel-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(api.pProposeTransfer).toHaveBeenCalledWith(expect.objectContaining({
			sourceKind: "party_inventory",
			sourceId: "party-1",
			targetKind: "character",
			targetId: "character-1",
		}));
		expect(api.pResolveTransfer).not.toHaveBeenCalled();
		expect(partyInventory._announcement).toContain("Request sent");
		expect(partyInventory._announcement).toContain("DM");
	});

	it("auto-resolves a player's transfer between their own characters", async () => {
		const character = {
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
		};
		const api = {
			pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "committed"}})),
			pResolveTransfer: jest.fn(),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnToast: jest.fn(),
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [{id: "character-2", label: "Second", isOwned: true}];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "propose-command-1",
			resolutionCommandId: "resolve-command-1",
			cancellationCommandId: "cancel-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(api.pProposeTransfer).toHaveBeenCalledWith(expect.objectContaining({
			rulesVersionId: null,
		}));
		expect(api.pResolveTransfer).not.toHaveBeenCalled();
		expect(partyInventory._announcement).toContain("Transfer complete");
	});

	it("accepts a reserved same-owner response from an older Hub server", async () => {
		const character = {
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
		};
		const api = {
			pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "reserved"}})),
			pResolveTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "committed"}})),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnGetRulesVersionId: () => "rules-1",
			fnToast: jest.fn(),
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [{id: "character-2", label: "Second", isOwned: true}];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "propose-command-1",
			resolutionCommandId: "resolve-command-1",
			cancellationCommandId: "cancel-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(api.pResolveTransfer).toHaveBeenCalledWith(expect.objectContaining({
			transferId: "transfer-1",
			decision: "accept",
			idempotencyKey: "resolve-command-1",
			rulesVersionId: "rules-1",
		}));
		expect(partyInventory._announcement).toContain("Transfer complete");
	});

	it("reconciles a stale same-owner acceptance before using a fresh policy pin and key", async () => {
		const character = {
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
		};
		const resolve = jest.fn()
			.mockRejectedValueOnce(Object.assign(new Error("stale rules"), {code: "RULES_VERSION_STALE", status: 409}))
			.mockResolvedValueOnce({transfer: {id: "transfer-1", status: "committed"}});
		const api = {
			pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "reserved"}})),
			pResolveTransfer: resolve,
			pListTransfers: jest.fn(async () => [{id: "transfer-1", status: "reserved"}]),
			pGetCampaignContext: jest.fn(async () => ({rulesVersion: {id: "rules-2"}})),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnGetRulesVersionId: () => "rules-1",
			fnToast: jest.fn(),
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [{id: "character-2", label: "Second", isOwned: true}];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "propose-command-1",
			resolutionCommandId: "resolve-command-1",
			cancellationCommandId: "cancel-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
		expect(api.pListTransfers).toHaveBeenCalledTimes(1);
		expect(api.pGetCampaignContext).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledTimes(2);
		expect(resolve.mock.calls[0][0]).toEqual(expect.objectContaining({
			rulesVersionId: "rules-1",
			idempotencyKey: "resolve-command-1",
		}));
		expect(resolve.mock.calls[1][0]).toEqual(expect.objectContaining({
			rulesVersionId: "rules-2",
		}));
		expect(resolve.mock.calls[1][0].idempotencyKey).not.toBe("resolve-command-1");
		expect(partyInventory._announcement).toContain("Transfer complete");
	});

	it("replays a lost direct proposal with the same key before attempting another source save", async () => {
		const character = {
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
		};
		const save = jest.fn(async () => true);
		const propose = jest.fn()
			.mockImplementationOnce(async () => {
				character.inventory = [];
				throw Object.assign(new Error("gateway lost response"), {code: "SERVICE_UNAVAILABLE", status: 502});
			})
			.mockResolvedValueOnce({transfer: {id: "transfer-1", status: "committed"}});
		let rulesReadCount = 0;
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: propose,
				pResolveTransfer: jest.fn(),
				pListTransfers: jest.fn(async () => [{id: "transfer-1", status: "committed"}]),
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: save,
			fnIsCurrentCharacter: () => true,
			fnGetRulesVersionId: () => `rules-${++rulesReadCount}`,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [{id: "character-2", label: "Second", isOwned: true}];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "stable-proposal-key",
			resolutionCommandId: "stable-resolution-key",
			cancellationCommandId: "stable-cancellation-key",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		expect(partyInventory._isDraftEditable()).toBe(false);
		await expect(partyInventory._pCancelDraft()).resolves.toBe(false);
		expect(partyInventory._draft).not.toBeNull();
		expect(partyInventory._error).toContain("not yet confirmed");
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(save).toHaveBeenCalledTimes(1);
		expect(propose).toHaveBeenCalledTimes(2);
		expect(propose.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
			"stable-proposal-key",
			"stable-proposal-key",
		]);
		expect(propose.mock.calls.map(([input]) => input.rulesVersionId)).toEqual(["rules-1", "rules-1"]);
		expect(propose.mock.calls.map(([input]) => input.payload.items[0].quantity)).toEqual([1, 1]);
		expect(partyInventory._announcement).toContain("Transfer complete");
	});

	it("keeps frozen proposal, acceptance, and refresh controls aligned with immutable intent", () => {
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			entryName: "Rations",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "proposal-1",
			resolutionCommandId: "accept-1",
			cancellationCommandId: "reject-1",
			proposalRequest: {isAutoResolved: true},
			transfer: null,
		};
		const quantity = {dataset: {partyInventoryFocus: "quantity"}, disabled: false};
		const destination = {dataset: {partyInventoryFocus: "destination"}, disabled: false};
		const cancel = {dataset: {partyInventoryFocus: "cancel"}, disabled: false};
		const submit = {dataset: {partyInventoryFocus: "submit"}, disabled: false};
		const summary = {textContent: ""};
		const composer = {
			querySelector: selector => {
				if (selector === ".charsheet__party-inventory-confirmation") return summary;
				if (selector === "button[type='submit']") return submit;
				return null;
			},
			querySelectorAll: () => [quantity, destination, cancel, submit],
		};

		partyInventory._syncComposerSummary(composer);

		expect(summary.textContent).toContain("the original recipient");
		expect(summary.textContent).not.toContain("Second");
		expect(quantity.disabled).toBe(true);
		expect(destination.disabled).toBe(true);
		expect(cancel.disabled).toBe(true);
		expect(submit.disabled).toBe(false);

		partyInventory._draft.transfer = null;
		partyInventory._draft.proposalRequest = null;
		partyInventory._needsAuthoritativeRefresh = true;
		partyInventory._syncComposerSummary(composer);

		expect(quantity.disabled).toBe(true);
		expect(destination.disabled).toBe(true);
		expect(cancel.disabled).toBe(false);
		expect(submit.disabled).toBe(true);

		partyInventory._needsAuthoritativeRefresh = false;
		partyInventory._draft.transfer = {id: "transfer-1", status: "reserved"};
		partyInventory._transferResolutionDrafts.stage({
			campaignId: "campaign-1",
			transferId: "transfer-1",
			decision: "accept",
			idempotencyKey: "accept-1",
		});
		partyInventory._syncComposerSummary(composer);

		expect(cancel.disabled).toBe(true);
		expect(submit.disabled).toBe(false);
	});

	it("fences cancellation while an acceptance outcome is unresolved", async () => {
		const resolve = jest.fn(async () => {
			throw Object.assign(new Error("gateway lost response"), {code: "SERVICE_UNAVAILABLE", status: 502});
		});
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "reserved"}})),
				pResolveTransfer: resolve,
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnGetRulesVersionId: () => "rules-1",
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [{id: "character-2", label: "Second", isOwned: true}];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "proposal-1",
			resolutionCommandId: "accept-1",
			cancellationCommandId: "reject-1",
			transfer: null,
		};

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		await expect(partyInventory._pCancelDraft()).resolves.toBe(false);

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
			decision: "accept",
			idempotencyKey: "accept-1",
		}));
		expect(partyInventory._getPendingAcceptance()).toEqual(expect.objectContaining({
			decision: "accept",
			idempotencyKey: "accept-1",
		}));
		expect(partyInventory._draft.needsStatusCheck).toBe(true);
		expect(partyInventory._error).toContain("acceptance outcome is not yet confirmed");
	});

	it("rotates the complete proposal after a definitive stale policy rejection", async () => {
		const propose = jest.fn()
			.mockRejectedValueOnce(Object.assign(new Error("stale rules"), {code: "RULES_VERSION_STALE", status: 409}))
			.mockResolvedValueOnce({transfer: {id: "transfer-1", status: "committed"}});
		const getCampaignContext = jest.fn(async () => ({rulesVersion: {id: "rules-2"}}));
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: propose,
				pGetCampaignContext: getCampaignContext,
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnGetRulesVersionId: () => "rules-1",
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [{id: "character-2", label: "Second", isOwned: true}];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "proposal-1",
			resolutionCommandId: "accept-1",
			cancellationCommandId: "reject-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(propose.mock.calls.map(([request]) => request.rulesVersionId)).toEqual(["rules-1", "rules-2"]);
		expect(getCampaignContext).toHaveBeenCalledTimes(1);
		expect(propose.mock.calls[0][0].idempotencyKey).toBe("proposal-1");
		expect(propose.mock.calls[1][0].idempotencyKey).not.toBe("proposal-1");
	});

	it("preserves stale-policy recovery across cancel until the next proposal refreshes context", async () => {
		const propose = jest.fn()
			.mockRejectedValueOnce(Object.assign(new Error("stale rules"), {code: "RULES_VERSION_STALE", status: 409}))
			.mockResolvedValueOnce({transfer: {id: "transfer-1", status: "committed"}});
		const getCampaignContext = jest.fn(async () => ({rulesVersion: {id: "rules-2"}}));
		let rulesVersionId = "rules-1";
		let contextRefreshCount = 0;
		const refreshCampaignContext = jest.fn(async () => {
			if (++contextRefreshCount === 1) return false;
			rulesVersionId = "rules-2";
			return true;
		});
		let saveCount = 0;
		const saveCharacter = jest.fn(async () => ++saveCount === 1 || rulesVersionId === "rules-2");
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: propose,
				pGetCampaignContext: getCampaignContext,
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnSaveCharacter: saveCharacter,
			fnRefreshCampaignContext: refreshCampaignContext,
			fnIsCurrentCharacter: () => true,
			fnGetRulesVersionId: () => rulesVersionId,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [{id: "character-2", label: "Second", isOwned: true}];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "proposal-1",
			resolutionCommandId: "accept-1",
			cancellationCommandId: "reject-1",
			transfer: null,
		};
		let refreshCount = 0;
		partyInventory._pDrainRefresh = jest.fn(async () => ++refreshCount > 1);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		expect(partyInventory._needsAuthoritativeRefresh).toBe(true);

		await expect(partyInventory._pCancelDraft()).resolves.toBe(true);
		expect(partyInventory._draft).toBeNull();
		expect(partyInventory._needsAuthoritativeRefresh).toBe(true);

		await expect(partyInventory._pManualRefresh({errorSource: "action"})).resolves.toBe(false);
		expect(partyInventory._needsAuthoritativeRefresh).toBe(true);
		expect(partyInventory._needsFreshProposalRules).toBe(true);
		expect(saveCharacter).toHaveBeenCalledTimes(1);

		await expect(partyInventory._pManualRefresh({errorSource: "action"})).resolves.toBe(true);
		expect(partyInventory._needsAuthoritativeRefresh).toBe(false);
		expect(partyInventory._beginDraft({kind: "character", entryId: "stack-1"})).toBe(true);
		partyInventory._draft.destinationKind = "character";
		partyInventory._draft.recipientId = "character-2";

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(propose.mock.calls.map(([request]) => request.rulesVersionId)).toEqual(["rules-1", "rules-2"]);
		expect(refreshCampaignContext).toHaveBeenCalledTimes(2);
		expect(getCampaignContext).not.toHaveBeenCalled();
		expect(saveCharacter).toHaveBeenCalledTimes(2);
		expect(refreshCampaignContext.mock.invocationCallOrder[1]).toBeLessThan(saveCharacter.mock.invocationCallOrder[1]);
	});

	it("uses the live rules pin when context advances after stale-policy recovery", async () => {
		let rulesVersionId = "rules-1";
		const savedRulesVersionIds = [];
		const saveCharacter = jest.fn(async () => {
			savedRulesVersionIds.push(rulesVersionId);
			return true;
		});
		const refreshCampaignContext = jest.fn(async () => {
			rulesVersionId = "rules-2";
			return true;
		});
		const propose = jest.fn(async request => {
			if (request.rulesVersionId === "rules-1") {
				throw Object.assign(new Error("stale rules"), {code: "RULES_VERSION_STALE", status: 409});
			}
			if (request.rulesVersionId !== "rules-3") {
				throw Object.assign(new Error("stale rules again"), {code: "RULES_VERSION_STALE", status: 409});
			}
			return {transfer: {id: "transfer-1", status: "committed"}};
		});
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {pProposeTransfer: propose},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnSaveCharacter: saveCharacter,
			fnRefreshCampaignContext: refreshCampaignContext,
			fnIsCurrentCharacter: () => true,
			fnGetRulesVersionId: () => rulesVersionId,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._recipients = [{id: "character-2", label: "Second", isOwned: true}];
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "character",
			recipientId: "character-2",
			commandId: "proposal-1",
			resolutionCommandId: "accept-1",
			cancellationCommandId: "reject-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		expect(rulesVersionId).toBe("rules-2");

		rulesVersionId = "rules-3";
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(refreshCampaignContext).toHaveBeenCalledTimes(1);
		expect(savedRulesVersionIds).toEqual(["rules-1", "rules-3"]);
		expect(propose.mock.calls.map(([request]) => request.rulesVersionId)).toEqual(["rules-1", "rules-3"]);
		expect(propose).toHaveBeenCalledTimes(2);
	});

	it("requires an authoritative refresh after a definitive proposal rejection before retrying", async () => {
		const propose = jest.fn()
			.mockRejectedValueOnce(Object.assign(new Error("quantity changed"), {code: "TRANSFER_INSUFFICIENT", status: 409}))
			.mockResolvedValueOnce({transfer: {id: "transfer-1", status: "reserved"}});
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {pProposeTransfer: propose},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnToast: jest.fn(),
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			commandId: "proposal-1",
			resolutionCommandId: "accept-1",
			cancellationCommandId: "reject-1",
			transfer: null,
		};
		const refreshes = [];
		partyInventory._pDrainRefresh = jest.fn(async () => {
			refreshes.push({...partyInventory._refreshFlags});
			return refreshes.length > 1;
		});

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);

		expect(refreshes[0]).toEqual({character: true, party: true});
		expect(partyInventory._draft.proposalRequest).toBeNull();
		expect(partyInventory._needsAuthoritativeRefresh).toBe(true);
		expect(partyInventory._isDraftEditable()).toBe(false);
		expect(partyInventory._error).toContain("latest character and party stash balances");

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		expect(propose).toHaveBeenCalledTimes(1);

		await expect(partyInventory._pCancelDraft()).resolves.toBe(true);
		expect(partyInventory._draft).toBeNull();
		expect(partyInventory._needsAuthoritativeRefresh).toBe(true);
		expect(partyInventory._error).toContain("latest character and party stash balances");
		expect(partyInventory._beginDraft({kind: "character", entryId: "stack-1"})).toBe(false);
		expect(propose).toHaveBeenCalledTimes(1);

		await expect(partyInventory._pManualRefresh({errorSource: "action"})).resolves.toBe(true);
		expect(partyInventory._needsAuthoritativeRefresh).toBe(false);
		expect(partyInventory._beginDraft({kind: "character", entryId: "stack-1"})).toBe(true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);
		expect(propose).toHaveBeenCalledTimes(2);
	});

	it("requires authoritative status after a definitive cancellation miss", async () => {
		const resolve = jest.fn(async () => {
			throw Object.assign(new Error("already terminal"), {code: "TRANSFER_NOT_FOUND", status: 404});
		});
		const listTransfers = jest.fn(async () => [{id: "transfer-1", status: "committed"}]);
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pResolveTransfer: resolve,
				pListTransfers: listTransfers,
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
			fnToast: jest.fn(),
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._draft = {
			kind: "character",
			destinationKind: "character",
			transfer: {id: "transfer-1", status: "reserved"},
			cancellationCommandId: "reject-1",
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pCancelDraft()).resolves.toBe(false);
		await expect(partyInventory._pCancelDraft()).resolves.toBe(false);
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(listTransfers).toHaveBeenCalledTimes(1);
		expect(partyInventory._draft).toBeNull();
	});

	it("reconciles an expired proposal by its actor command before unlocking the composer", async () => {
		const propose = jest.fn();
		const listTransfers = jest.fn(async () => [{
			id: "transfer-1",
			status: "proposed",
			actorCommandId: "expired-key",
		}]);
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: propose,
				pListTransfers: listTransfers,
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
			fnToast: jest.fn(),
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._draft = {
			kind: "character",
			destinationKind: "character",
			proposalRequest: {idempotencyKey: "expired-key"},
			proposalReplayUntil: 0,
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		expect(propose).not.toHaveBeenCalled();
		expect(listTransfers).toHaveBeenCalledTimes(1);
		expect(partyInventory._pDrainRefresh).toHaveBeenCalledTimes(1);
		expect(partyInventory._draft).toEqual(expect.objectContaining({
			transfer: expect.objectContaining({id: "transfer-1", status: "proposed"}),
		}));
		expect(partyInventory._error).toContain("still pending");
	});

	it("closes an expired proposal only after confirming no matching actor command exists", async () => {
		const listTransfers = jest.fn(async () => [{
			id: "other-transfer",
			status: "proposed",
			actorCommandId: "other-key",
		}]);
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: jest.fn(),
				pListTransfers: listTransfers,
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
			fnToast: jest.fn(),
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._draft = {
			kind: "party_inventory",
			destinationKind: "character",
			proposalRequest: {idempotencyKey: "expired-key"},
			proposalReplayUntil: 0,
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(listTransfers).toHaveBeenCalledTimes(1);
		expect(partyInventory._draft).toBeNull();
		expect(partyInventory._announcement).toContain("No matching transfer was found");
	});

	it("keeps an expired legacy proposal locked when matching pending transfers are ambiguous", async () => {
		const pending = {
			status: "proposed",
			sourceKind: "party_inventory",
			targetKind: "character",
			targetId: "character-1",
			payload: {request: {items: [{entryId: "stack-1", quantity: 1}], currency: {}}},
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pListTransfers: jest.fn(async () => [
					{id: "transfer-1", ...pending},
					{id: "transfer-2", ...pending},
				]),
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._draft = {
			kind: "party_inventory",
			destinationKind: "character",
			proposalRequest: {
				sourceKind: "party_inventory",
				sourceId: "party-1",
				targetKind: "character",
				targetId: "character-1",
				payload: {items: [{entryId: "stack-1", quantity: 1}], currency: {}},
				idempotencyKey: "expired-key",
			},
			proposalReplayUntil: 0,
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);

		expect(partyInventory._draft.proposalRequest.idempotencyKey).toBe("expired-key");
		expect(partyInventory._draft.transfer).toBeNull();
		expect(partyInventory._error).toContain("Multiple matching pending transfers");
	});

	it("reconciles a replayed proposal receipt before announcing its outcome", async () => {
		const propose = jest.fn()
			.mockRejectedValueOnce(Object.assign(new Error("lost response"), {code: "NETWORK_UNAVAILABLE", status: 0}))
			.mockResolvedValueOnce({transfer: {id: "transfer-1", status: "reserved"}});
		const listTransfers = jest.fn(async () => [{id: "transfer-1", status: "rejected"}]);
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: propose,
				pListTransfers: listTransfers,
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnGetRulesVersionId: () => "rules-1",
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			commandId: "proposal-1",
			resolutionCommandId: "accept-1",
			cancellationCommandId: "reject-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(listTransfers).toHaveBeenCalledTimes(1);
		expect(partyInventory._announcement).toBe("Transfer was rejected. The reserved items were restored.");
	});

	it("keeps a reserved draft recoverable when authoritative refresh fails", async () => {
		const character = {
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "reserved"}})),
				pListTransfers: jest.fn(async () => [{id: "transfer-1", status: "reserved"}]),
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			commandId: "propose-command-1",
			resolutionCommandId: "resolve-command-1",
			cancellationCommandId: "cancel-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);

		expect(partyInventory._draft?.transfer).toEqual({id: "transfer-1", status: "reserved"});
		expect(partyInventory._error).toContain("could not be reached");
		expect(partyInventory._announcement).toBe("");
		expect(partyInventory._isSubmitting).toBe(false);

		character.inventory = [];
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);
		expect(partyInventory._api.pProposeTransfer).toHaveBeenCalledTimes(1);
		expect(partyInventory._draft).toBeNull();
	});

	it("preserves confirmed transfer success when only the balance refresh fails", async () => {
		const committed = {id: "transfer-1", status: "committed", sourceKind: "character", targetKind: "party_inventory"};
		const propose = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {pListTransfers: jest.fn(async () => [committed]), pProposeTransfer: propose},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({inventory: []}),
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			destinationKind: "party_inventory",
			transfer: committed,
			needsStatusCheck: true,
		};
		partyInventory._pDrainRefresh = jest.fn()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);
		expect(partyInventory._error).toContain("Transfer complete.");
		expect(partyInventory._error).toContain("latest");
		expect(partyInventory._error).not.toContain("up to date");
		expect(partyInventory._error).not.toContain("inventories are unchanged");
		expect(partyInventory._draft.transfer).toBe(committed);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);
		expect(partyInventory._announcement).toBe("Transfer complete. Both inventories are up to date.");
		expect(propose).not.toHaveBeenCalled();
		expect(partyInventory._draft).toBeNull();
	});

	it("reports a terminal transfer retry instead of announcing a new reservation", async () => {
		const toast = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pListTransfers: jest.fn(async () => [{id: "transfer-1", status: "rejected"}]),
				pProposeTransfer: jest.fn(),
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({inventory: []}),
			fnIsCurrentCharacter: () => true,
			fnToast: toast,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			transfer: {id: "transfer-1", status: "reserved"},
			needsStatusCheck: true,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(partyInventory._api.pProposeTransfer).not.toHaveBeenCalled();
		expect(partyInventory._announcement).toContain("rejected");
		expect(partyInventory._announcement).not.toContain("recipient can accept");
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({type: "info"}));
	});

	it("blocks stash transfers cleanly when a partial refresh has no authoritative stash id", async () => {
		const save = jest.fn();
		const propose = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {pProposeTransfer: propose},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnSaveCharacter: save,
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			transfer: null,
		};

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);

		expect(partyInventory._error).toContain("stash is unavailable");
		expect(save).not.toHaveBeenCalled();
		expect(propose).not.toHaveBeenCalled();
	});

	it("keeps focus inside the composer while replacing a submitted control", () => {
		const previousDocument = globalThis.document;
		const previousCss = globalThis.CSS;
		const disabledSubmit = {disabled: true};
		const composer = {focus: jest.fn()};
		const root = {
			querySelector: selector => selector.includes("\"submit\"") ? disabledSubmit : composer,
		};
		globalThis.document = {activeElement: null};
		globalThis.CSS = {escape: value => value};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
		});
		partyInventory._root = root;

		try {
			partyInventory._restoreFocus({key: "submit"});
			expect(composer.focus).toHaveBeenCalledWith({preventScroll: true});
		} finally {
			globalThis.document = previousDocument;
			globalThis.CSS = previousCss;
		}
	});

	it("falls back to the focusable stash section when a refresh or retry control disappears", () => {
		const previousCss = globalThis.CSS;
		globalThis.CSS = {escape: value => value};
		const root = {
			focus: jest.fn(),
			querySelector: jest.fn(() => null),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
		});
		partyInventory._root = root;

		try {
			partyInventory._restoreFocus({key: "retry"});
			expect(root.focus).toHaveBeenCalledWith({preventScroll: true});
		} finally {
			globalThis.CSS = previousCss;
		}
	});
});
