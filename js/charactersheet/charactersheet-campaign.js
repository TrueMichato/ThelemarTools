import {HubApiClient, HubApiError} from "../hub/hub-api-client.js";
import {CharacterSheetSharing} from "./charactersheet-sharing.js";

const _CAMPAIGN_ROLES = new Set(["dm", "co_dm", "player"]);
const _RULE_LABELS = {
	enableTgtt: "Thelemar rules",
	exhaustionRules: "Exhaustion rules",
	thelemar_carryWeight: "Thelemar carry weight",
	thelemar_jumping: "Thelemar jumping",
	thelemar_linguisticsBonus: "Thelemar linguistics bonus",
	thelemar_criticalRolls: "Thelemar critical rolls",
};

export function getEligibleCharacterCampaigns (campaigns, {excludeCampaignId = null} = {}) {
	return (campaigns || [])
		.filter(campaign => campaign?.status === "active"
			&& _CAMPAIGN_ROLES.has(campaign.role)
			&& campaign.id !== excludeCampaignId)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCampaignCharacterUrl ({campaignId, characterId}) {
	return `charactersheet.html?id=${encodeURIComponent(characterId)}&hubCampaign=${encodeURIComponent(campaignId)}`;
}

export function getDetachedCloudCharacterUrl ({characterId}) {
	return `charactersheet.html?id=${encodeURIComponent(characterId)}&hubCharacter=1`;
}

export function getCloudCharacterUrl ({campaignId = null, characterId}) {
	return campaignId
		? getCampaignCharacterUrl({campaignId, characterId})
		: getDetachedCloudCharacterUrl({characterId});
}

export function getCloudCharacterData (character) {
	const out = structuredClone(character);
	delete out.id;
	delete out._savedAt;
	return out;
}

export function getCampaignControlErrorMessage (error) {
	const code = error instanceof HubApiError || typeof error?.code === "string"
		? error.code
		: null;
	if (!code) return "Campaigns could not be reached. Your character data is safe; check your connection and try again.";
	const conflictReason = error?.recovery?.conflicts?.find(conflict => conflict?.reason)?.reason;
	switch (code) {
		case "AUTH_REQUIRED": return "Your sign-in has expired. Sign in again to use campaigns.";
		case "CAMPAIGN_NOT_FOUND": return "This campaign is unavailable or you no longer have access.";
		case "CHARACTER_TOO_LARGE": return "This character is too large to copy online. Export it first, then remove unused notes or history and try again.";
		case "CLOUD_DATA_TOO_DEEP":
		case "CHARACTER_DATA_INVALID": return "This character contains data the Campaign Hub cannot safely store. Export a backup and review custom content before trying again.";
		case "FORBIDDEN": return "Your campaign role cannot add or copy this character.";
		case "LEASE_HELD": return "Another device is editing this character. Close it there or wait for its editor to expire before moving.";
		case "CHARACTER_BUSY": return "This character has an outgoing transfer in progress. Resolve or cancel it before moving.";
		case "CHARACTER_CONFLICT": return ["LEASE_HELD", "LEASE_FENCED", "LEASE_EXPIRED"].includes(conflictReason)
			? "Another device is editing this character. Close it there or wait for its editor to expire before moving."
			: "This character changed elsewhere. Resolve the sync conflict before changing campaigns.";
		case "REVISION_CONFLICT": return "This character changed elsewhere. Resolve the sync conflict before changing campaigns.";
		default: return "The Campaign Hub could not complete that request. Your current character was not changed; try again.";
	}
}

function getRuleLabel (key) {
	return _RULE_LABELS[key] || key
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replaceAll("_", " ")
		.replace(/^./, it => it.toUpperCase());
}

export function getCampaignCompatibilityReport ({source, target}) {
	const sourceRules = source?.rulesVersion?.rules || {};
	const targetRules = target?.rulesVersion?.rules || {};
	const ruleChanges = [...new Set([...Object.keys(sourceRules), ...Object.keys(targetRules)])]
		.filter(key => JSON.stringify(sourceRules[key] ?? null) !== JSON.stringify(targetRules[key] ?? null))
		.map(key => getRuleLabel(key))
		.sort((a, b) => a.localeCompare(b));
	const sourceBrew = source?.brewBundle || null;
	const targetBrew = target?.brewBundle || null;
	const isBrewSame = (sourceBrew?.contentHash || null) === (targetBrew?.contentHash || null);
	return {
		ruleChanges,
		isRulesSame: !ruleChanges.length,
		isBrewSame,
		sourceBrew: sourceBrew
			? `Version ${sourceBrew.version} (${sourceBrew.documentCount} documents)`
			: "No campaign homebrew",
		targetBrew: targetBrew
			? `Version ${targetBrew.version} (${targetBrew.documentCount} documents)`
			: "No campaign homebrew",
	};
}

function createElement (tagName, {className = "", text = "", attrs = {}} = {}) {
	const element = document.createElement(tagName);
	if (className) element.className = className;
	if (text) element.textContent = text;
	Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
	return element;
}

export class CharacterSheetCampaign {
	constructor ({page, api = new HubApiClient(), root = null, fnNavigate = null}) {
		this._page = page;
		this._api = api;
		this._root = root || document.getElementById("charsheet-campaign");
		this._fnNavigate = fnNavigate || (href => window.location.assign(href));
		this._session = null;
		this._campaigns = [];
		this._currentCharacter = null;
		this._currentCampaign = null;
		this._isLoading = true;
		this._isExpanded = false;
		this._isBusy = false;
		this._isMovePreviewLoading = false;
		this._selectedCampaignId = null;
		this._movePreview = null;
		this._feedback = null;
		this._pendingCommand = null;
		this._sharing = null;
	}

	async pInit () {
		if (!this._root) return;
		window.addEventListener?.("online", () => this.render());
		window.addEventListener?.("offline", () => this.render());
		this.render();
		await this._pRefresh();
	}

	async _pRefresh () {
		this._isLoading = true;
		this._feedback = null;
		this.render();
		try {
			this._session = await this._api.pGetSession();
			this._campaigns = this._session.signedIn
				? await this._api.pListCampaigns()
				: [];
			this._currentCharacter = this._session.signedIn && this._page._isHubCharacter && this._page._currentCharacterId
				? await this._api.pGetCharacter({characterId: this._page._currentCharacterId})
				: null;
			const currentCampaignId = this._currentCharacter?.campaignId || null;
			this._currentCampaign = this._session.signedIn && currentCampaignId
				? this._campaigns.find(campaign => campaign.id === currentCampaignId)
					|| await this._api.pGetCampaign({campaignId: currentCampaignId})
				: null;
		} catch (error) {
			this._session = null;
			this._campaigns = [];
			this._currentCharacter = null;
			this._currentCampaign = null;
			this._feedback = {type: "error", text: getCampaignControlErrorMessage(error)};
		} finally {
			this._isLoading = false;
			this.render();
		}
		await this.pRefreshSharing();
	}

	render () {
		if (!this._root) return;
		this._root.replaceChildren();
		this._root.classList.toggle("charsheet__campaign--expanded", this._isExpanded);
		this._root.classList.toggle("charsheet__campaign--busy", this._isBusy);

		const isCloud = !!this._page._isHubCharacter;
		const status = createElement("div", {className: "charsheet__campaign-status"});
		const icon = createElement("span", {
			className: "charsheet__campaign-icon",
			text: isCloud ? "☁" : "⌂",
			attrs: {"aria-hidden": "true"},
		});
		const copy = createElement("div", {className: "charsheet__campaign-copy"});
		const title = createElement("span", {
			className: "charsheet__campaign-title",
			text: this._getTitle({isCloud}),
		});
		const detail = createElement("span", {
			className: "charsheet__campaign-detail",
			text: this._getDetail({isCloud}),
		});
		copy.append(title, detail);
		status.append(icon, copy);

		const actions = createElement("div", {className: "charsheet__campaign-actions"});
		this._renderActions({actions, isCloud});
		this._root.append(status, actions);

		if (this._feedback) {
			this._root.append(createElement("div", {
				className: `charsheet__campaign-feedback charsheet__campaign-feedback--${this._feedback.type}`,
				text: this._feedback.text,
				attrs: {role: this._feedback.type === "error" ? "alert" : "status"},
			}));
		}

		if (this._isExpanded) this._root.append(this._getExpandedPanel({isCloud}));
		// Sharing is only meaningful for a cloud character attached to a campaign: there
		// are no other players to share with otherwise.
		if (isCloud && this._currentCharacter?.campaignId && this._sharing) {
			this._root.append(this._sharing.render({fnRerender: () => this.render()}));
		}
	}

	/** Load the owner's sharing policy once the character's campaign context is known. */
	async pRefreshSharing () {
		if (!this._page._isHubCharacter || !this._currentCharacter?.campaignId) {
			this._sharing = null;
			return;
		}
		this._sharing ||= new CharacterSheetSharing({
			api: this._api,
			fnGetCharacterId: () => this._page._currentCharacterId,
			fnGetErrorMessage: getCampaignControlErrorMessage,
		});
		await this._sharing.pLoad();
		this.render();
	}

	_getTitle ({isCloud}) {
		if (this._isLoading) return "Campaign connection";
		if (isCloud) return this._currentCampaign?.name || "Cloud character";
		return "Local character";
	}

	_getDetail ({isCloud}) {
		if (this._isLoading) return "Checking availability…";
		if (isCloud) {
			if (typeof navigator !== "undefined" && !navigator.onLine) return "Offline view · changes will retry when the connection returns";
			if (this._page._characterRepository?.hasPendingWrites?.()) return "Sync needs attention · export before leaving if retry keeps failing";
			if (!this._currentCharacter?.campaignId) return "Online · not attached to a campaign";
			if (!this._currentCampaign) return "Campaign access needs attention";
			return this._page._currentCharacterId
				? "Online · changes sync to this campaign"
				: "Choose a campaign character to begin";
		}
		if (!this._session?.signedIn) return "Saved only on this device";
		if (!this._page._currentCharacterId) return "Create or choose a character before adding it online";
		return "Saved on this device · your original stays local";
	}

	_renderActions ({actions, isCloud}) {
		if (this._isLoading) {
			const loading = createElement("span", {className: "charsheet__campaign-loading", text: "Checking…"});
			loading.setAttribute("aria-live", "polite");
			actions.append(loading);
			return;
		}

		if (this._feedback?.type === "error" && !this._session) {
			const retry = createElement("button", {
				className: "charsheet__campaign-button",
				text: "Retry",
				attrs: {type: "button"},
			});
			retry.addEventListener("click", () => this._pRefresh());
			actions.append(retry);
			return;
		}

		if (!this._session?.signedIn) {
			const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
			actions.append(createElement("a", {
				className: "charsheet__campaign-button charsheet__campaign-button--primary",
				text: "Sign in for campaigns",
				attrs: {href: `/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`},
			}));
			return;
		}

		if (isCloud) {
			if (this._currentCampaign) {
				actions.append(createElement("a", {
					className: "charsheet__campaign-button",
					text: "Return to campaign",
					attrs: {href: `campaign.html?id=${encodeURIComponent(this._currentCampaign.id)}`},
				}));
			}
			const sourceCampaignId = this._currentCharacter?.campaignId || null;
			const destinations = getEligibleCharacterCampaigns(this._campaigns, {excludeCampaignId: sourceCampaignId});
			if (this._page._currentCharacterId && destinations.length) {
				actions.append(this._getToggleButton(sourceCampaignId ? "Campaign options" : "Add to campaign"));
			} else if (!sourceCampaignId) {
				actions.append(createElement("a", {
					className: "charsheet__campaign-button",
					text: "Open Campaign Hub",
					attrs: {href: "hub.html"},
				}));
			}
			return;
		}

		const destinations = getEligibleCharacterCampaigns(this._campaigns);
		if (!destinations.length) {
			actions.append(createElement("a", {
				className: "charsheet__campaign-button",
				text: "Open Campaign Hub",
				attrs: {href: "hub.html"},
			}));
			return;
		}

		const toggle = this._getToggleButton("Add to campaign");
		toggle.disabled = !this._page._currentCharacterId || this._isBusy;
		actions.append(toggle);
	}

	_getToggleButton (label) {
		const button = createElement("button", {
			className: "charsheet__campaign-button charsheet__campaign-button--primary",
			text: this._isExpanded ? "Close" : label,
			attrs: {
				type: "button",
				"aria-expanded": `${this._isExpanded}`,
				"aria-controls": "charsheet-campaign-panel",
			},
		});
		button.addEventListener("click", () => {
			this._isExpanded = !this._isExpanded;
			this._feedback = null;
			this._movePreview = null;
			this.render();
			if (this._isExpanded) this._root.querySelector("select")?.focus();
			else this._root.querySelector("[aria-controls=\"charsheet-campaign-panel\"]")?.focus();
		});
		return button;
	}

	_getExpandedPanel ({isCloud}) {
		const sourceCampaignId = this._currentCharacter?.campaignId || null;
		const isAttached = isCloud && !!sourceCampaignId;
		const panel = createElement("div", {
			className: "charsheet__campaign-panel",
			attrs: {id: "charsheet-campaign-panel"},
		});
		const heading = createElement("h2", {
			className: "charsheet__campaign-panel-heading",
			text: isAttached
				? "Copy or move this character"
				: isCloud ? "Add this cloud character" : "Add a cloud copy",
		});
		const explanation = createElement("p", {
			className: "charsheet__campaign-explanation",
			text: isAttached
				? "A separate character will be created in the destination campaign. This character remains here and the two copies will not share later changes."
				: isCloud
					? "The same online character will join the selected campaign. No local or cloud copy will be deleted."
					: "A separate character will be created for the campaign. Your local original stays on this device and will not be changed or removed.",
		});
		const field = createElement("label", {className: "charsheet__campaign-field"});
		field.append(createElement("span", {text: "Destination campaign"}));
		const select = createElement("select", {
			className: "charsheet__campaign-select",
			attrs: {name: "campaign"},
		});
		const destinations = getEligibleCharacterCampaigns(this._campaigns, {
			excludeCampaignId: sourceCampaignId,
		});
		destinations.forEach(campaign => {
			const option = createElement("option", {text: campaign.name});
			option.value = campaign.id;
			select.append(option);
		});
		if (destinations.some(campaign => campaign.id === this._selectedCampaignId)) select.value = this._selectedCampaignId;
		else this._selectedCampaignId = select.value || null;
		select.addEventListener("change", () => {
			this._selectedCampaignId = select.value;
			this._movePreview = null;
			this._feedback = null;
			this.render();
			this._root.querySelector("select")?.focus();
		});
		field.append(select);

		const submit = createElement("button", {
			className: "charsheet__campaign-submit",
			text: this._isBusy
				? (isCloud && !isAttached ? "Adding character…" : "Creating copy…")
				: (isCloud && !isAttached ? "Add character" : "Create cloud copy"),
			attrs: {type: "button"},
		});
		submit.disabled = this._isBusy || !destinations.length;
		submit.addEventListener("click", () => {
			if (!isCloud) return this._pCopyLocalCharacter({campaignId: select.value});
			if (!isAttached) return this._pMoveCloudCharacter({campaignId: select.value, isDetached: true});
			return this._pCloneCloudCharacter({campaignId: select.value});
		});
		panel.append(heading, explanation, field, submit);
		if (isAttached) this._renderMoveControls({panel, sourceCampaignId, campaignId: select.value});
		return panel;
	}

	_renderMoveControls ({panel, sourceCampaignId, campaignId}) {
		const divider = createElement("div", {className: "charsheet__campaign-divider", text: "or"});
		panel.append(divider);
		if (this._isMovePreviewLoading) {
			panel.append(createElement("div", {className: "charsheet__campaign-loading", text: "Comparing campaign rules and homebrew…"}));
			return;
		}
		if (!this._movePreview || this._movePreview.campaignId !== campaignId) {
			const review = createElement("button", {
				className: "charsheet__campaign-button",
				text: "Review move instead",
				attrs: {type: "button"},
			});
			review.disabled = this._isBusy;
			review.addEventListener("click", () => this._pPrepareMove({sourceCampaignId, campaignId}));
			panel.append(review);
			return;
		}

		const report = this._movePreview.report;
		const sourceName = this._currentCampaign?.name || "the current campaign";
		const targetName = this._campaigns.find(campaign => campaign.id === campaignId)?.name || "the destination campaign";
		const summary = createElement("div", {className: "charsheet__campaign-move"});
		summary.append(createElement("div", {
			className: "charsheet__campaign-panel-heading",
			text: "Move compatibility",
		}));
		const list = createElement("ul", {className: "charsheet__campaign-compatibility"});
		const rules = createElement("li", {
			text: report.isRulesSame
				? "Campaign rules match."
				: `Different rule settings: ${report.ruleChanges.join(", ")}.`,
		});
		const brew = createElement("li", {
			text: report.isBrewSame
				? "Campaign homebrew matches."
				: `Homebrew changes from ${report.sourceBrew} to ${report.targetBrew}.`,
		});
		list.append(rules, brew);
		const warning = createElement("p", {
			className: "charsheet__campaign-warning",
			text: `Moving removes this character from ${sourceName} and attaches it to ${targetName}. Pending incoming actions are cancelled, and later changes belong only to ${targetName}.`,
		});
		const confirm = createElement("label", {className: "charsheet__campaign-confirm"});
		const checkbox = createElement("input", {attrs: {type: "checkbox", name: "confirmCampaignMove"}});
		confirm.append(checkbox, createElement("span", {text: "I understand that this moves the character instead of creating a copy."}));
		const move = createElement("button", {
			className: "charsheet__campaign-submit charsheet__campaign-submit--danger",
			text: this._isBusy ? "Moving character…" : "Move character",
			attrs: {type: "button"},
		});
		move.disabled = true;
		checkbox.addEventListener("change", () => move.disabled = !checkbox.checked || this._isBusy);
		move.addEventListener("click", () => this._pMoveCloudCharacter({campaignId, isDetached: false}));
		summary.append(list, warning, confirm, move);
		panel.append(summary);
	}

	async _pPrepareMove ({sourceCampaignId, campaignId}) {
		if (!sourceCampaignId || !campaignId || this._isMovePreviewLoading || this._isBusy) return;
		this._isMovePreviewLoading = true;
		this._feedback = null;
		this.render();
		try {
			const [source, target] = await Promise.all([
				this._api.pGetCampaignCompatibility({campaignId: sourceCampaignId}),
				this._api.pGetCampaignCompatibility({campaignId}),
			]);
			this._movePreview = {
				campaignId,
				report: getCampaignCompatibilityReport({source, target}),
			};
		} catch (error) {
			this._feedback = {type: "error", text: getCampaignControlErrorMessage(error)};
		} finally {
			this._isMovePreviewLoading = false;
			this.render();
		}
	}

	async _pCopyLocalCharacter ({campaignId}) {
		const characterId = this._page._currentCharacterId;
		if (!characterId || !campaignId || this._isBusy) return;
		this._isBusy = true;
		this._feedback = null;
		this.render();
		try {
			if (!await this._page._saveCurrentCharacter()) throw new Error("LOCAL_SAVE_FAILED");
			const command = this._getPendingCommand({kind: "copy-local", characterId, campaignId});
			const result = await this._api.pCreateCharacter({
				clientImportId: characterId,
				campaignId,
				data: getCloudCharacterData(this._page._state.toJson()),
				idempotencyKey: command.idempotencyKey,
			});
			this._feedback = {type: "success", text: "Cloud copy created. Your local original is unchanged."};
			this.render();
			this._fnNavigate(getCampaignCharacterUrl({campaignId, characterId: result.character.id}));
		} catch (error) {
			this._feedback = {
				type: "error",
				text: error?.message === "LOCAL_SAVE_FAILED"
					? "The local character could not be saved, so no cloud copy was created. Try saving again first."
					: getCampaignControlErrorMessage(error),
			};
		} finally {
			this._isBusy = false;
			this.render();
		}
	}

	async _pCloneCloudCharacter ({campaignId}) {
		const characterId = this._page._currentCharacterId;
		if (!characterId || !campaignId || this._isBusy) return;
		this._isBusy = true;
		this._feedback = null;
		this.render();
		try {
			if (!await this._page._saveCurrentCharacter({isInteractiveConflict: false})) throw new Error("CLOUD_SAVE_FAILED");
			const command = this._getPendingCommand({kind: "clone-cloud", characterId, campaignId});
			const result = await this._api.pCloneCharacter({
				characterId,
				campaignId,
				idempotencyKey: command.idempotencyKey,
			});
			this._feedback = {type: "success", text: "Cloud copy created. This campaign character is unchanged."};
			this.render();
			this._fnNavigate(getCampaignCharacterUrl({campaignId, characterId: result.character.id}));
		} catch (error) {
			this._feedback = {
				type: "error",
				text: error?.message === "CLOUD_SAVE_FAILED"
					? "This character could not finish syncing, so no copy was created. Resolve the save error and try again."
					: getCampaignControlErrorMessage(error),
			};
		} finally {
			this._isBusy = false;
			this.render();
		}
	}

	async _pMoveCloudCharacter ({campaignId, isDetached}) {
		const characterId = this._page._currentCharacterId;
		const sourceCampaignId = this._currentCharacter?.campaignId || null;
		if (!characterId || !campaignId || this._isBusy) return;
		if (!isDetached && (!sourceCampaignId || this._movePreview?.campaignId !== campaignId)) return;
		this._isBusy = true;
		this._feedback = null;
		this.render();
		try {
			if (!await this._page._saveCurrentCharacter({isInteractiveConflict: false})) throw new Error("CLOUD_SAVE_FAILED");
			await this._page._characterRepository.pReleaseLease?.({characterId});
			const command = this._getPendingCommand({kind: isDetached ? "attach-cloud" : "move-cloud", characterId, campaignId});
			const result = await this._api.pMoveCharacter({
				characterId,
				campaignId,
				idempotencyKey: command.idempotencyKey,
			});
			this._feedback = {
				type: "success",
				text: isDetached
					? "Character added to the campaign. No copy was deleted."
					: "Character moved. No duplicate was created.",
			};
			this.render();
			this._fnNavigate(getCampaignCharacterUrl({campaignId, characterId: result.character.id}));
		} catch (error) {
			this._feedback = {
				type: "error",
				text: error?.message === "CLOUD_SAVE_FAILED"
					? "This character could not finish syncing, so its campaign was not changed. Resolve the save error and try again."
					: getCampaignControlErrorMessage(error),
			};
		} finally {
			this._isBusy = false;
			this.render();
		}
	}

	_getPendingCommand ({kind, characterId, campaignId}) {
		const isSame = this._pendingCommand?.kind === kind
			&& this._pendingCommand.characterId === characterId
			&& this._pendingCommand.campaignId === campaignId;
		if (!isSame) {
			this._pendingCommand = {
				kind,
				characterId,
				campaignId,
				idempotencyKey: crypto.randomUUID(),
			};
		}
		return this._pendingCommand;
	}
}

globalThis.CharacterSheetCampaign = CharacterSheetCampaign;
