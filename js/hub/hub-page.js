import {HubApiClient, HubApiError} from "./hub-api-client.js";

const api = new HubApiClient();

function setHidden (element, isHidden) {
	element?.classList.toggle("ve-hidden", isHidden);
}

function getErrorMessage (error) {
	if (!(error instanceof HubApiError)) return "The campaign hub could not be reached. Check your connection and try again.";
	switch (error.code) {
		case "AUTH_REQUIRED": return "Your session has expired. Sign in again to continue.";
		case "CAMPAIGN_NOT_FOUND": return "This campaign is unavailable or you no longer have access.";
		case "INVALID_CAMPAIGN_NAME": return "Enter a campaign name before creating it.";
		case "INVITE_INVALID": return "That invite is expired, revoked, or has already been fully used.";
		case "ACCOUNT_OWNS_CAMPAIGN": return "Transfer ownership or archive every active campaign before deleting your account.";
		case "ACCOUNT_DELETION_PENDING": return "Your account is scheduled for deletion. Cancel deletion before using campaign features.";
		case "MEMBERSHIP_OWNER_PROTECTED": return "The campaign owner must transfer ownership or archive the campaign first.";
		case "PROTOCOL_UPDATE_REQUIRED": return "This page is out of date. Reload before making campaign changes.";
		default: return "The campaign hub could not complete that request. Try again.";
	}
}

function renderError (message) {
	const wrp = document.getElementById("hub-error");
	if (!wrp) return;
	wrp.textContent = message;
	setHidden(wrp, !message);
}

function getRoleLabel (role) {
	switch (role) {
		case "dm": return "Dungeon Master";
		case "co_dm": return "Co-DM";
		case "player": return "Player";
		case "spectator": return "Spectator";
		default: return role;
	}
}

function renderCampaignList (campaigns) {
	const list = document.getElementById("hub-campaign-list");
	const empty = document.getElementById("hub-campaign-empty");
	if (!list) return;
	list.replaceChildren();
	setHidden(empty, !!campaigns.length);
	campaigns.forEach(campaign => {
		const link = document.createElement("a");
		link.className = "hub-campaign-row";
		link.href = `campaign.html?id=${encodeURIComponent(campaign.id)}`;
		link.innerHTML = `
			<span class="hub-campaign-row__name"></span>
			<span class="hub-campaign-row__role"></span>
			<span class="hub-campaign-row__open" aria-hidden="true">Open</span>
		`;
		link.querySelector(".hub-campaign-row__name").textContent = campaign.name;
		link.querySelector(".hub-campaign-row__role").textContent = getRoleLabel(campaign.role);
		list.append(link);
	});
}

function getDateLabel (value) {
	if (!value) return "Unknown";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function renderAccountDeletionPending (deletion) {
	setHidden(document.getElementById("hub-account-active"), true);
	setHidden(document.getElementById("hub-account-deletion-pending"), false);
	const deadline = document.getElementById("hub-deletion-deadline");
	if (deadline) deadline.textContent = `Your account is frozen and scheduled for deletion after ${getDateLabel(deletion.purgeAfter)}. Re-authenticate before then to cancel.`;
}

async function pRenderAccountSessions () {
	const list = document.getElementById("hub-session-list");
	if (!list) return;
	const sessions = await api.pListSessions();
	list.replaceChildren(...sessions.map(session => {
		const row = document.createElement("div");
		row.className = "hub-data-row";
		const main = document.createElement("div");
		main.className = "hub-data-row__main";
		const name = document.createElement("span");
		name.textContent = session.isCurrent ? "This device" : (session.userAgent || "Unknown device");
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		meta.textContent = `${session.revokedAt ? "Revoked" : "Active"} · Last seen ${getDateLabel(session.lastSeenAt)}`;
		main.append(name, meta);
		row.append(main);
		if (!session.isCurrent && !session.revokedAt) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hub-button";
			button.textContent = "Sign out";
			button.addEventListener("click", async () => {
				button.disabled = true;
				try {
					await api.pRevokeSession({sessionId: session.id, idempotencyKey: crypto.randomUUID()});
					await pRenderAccountSessions();
				} catch (error) {
					renderError(getErrorMessage(error));
					button.disabled = false;
				}
			});
			row.append(button);
		}
		return row;
	}));
}

async function pInitHubIndex ({session}) {
	const name = document.getElementById("hub-account-name");
	if (name) name.textContent = session.account.displayName;
	document.getElementById("hub-cancel-deletion")?.addEventListener("click", async event => {
		const button = event.currentTarget;
		button.disabled = true;
		try {
			await api.pCancelAccountDeletion({idempotencyKey: crypto.randomUUID()});
			window.location.reload();
		} catch (error) {
			renderError(getErrorMessage(error));
			button.disabled = false;
		}
	});
	if (session.account.status === "deletion_requested") {
		renderAccountDeletionPending({
			purgeAfter: session.account.purgeAfter,
			deletionRequestedAt: session.account.deletionRequestedAt,
		});
		return;
	}
	setHidden(document.getElementById("hub-account-active"), false);
	setHidden(document.getElementById("hub-account-deletion-pending"), true);
	const campaigns = await api.pListCampaigns();
	renderCampaignList(campaigns);
	const inviteToken = sessionStorage.getItem("hub-pending-invite");
	if (inviteToken) {
		try {
			await api.pRedeemInvite({token: inviteToken, idempotencyKey: crypto.randomUUID()});
			renderCampaignList(await api.pListCampaigns());
		} catch (error) {
			renderError(getErrorMessage(error));
		} finally {
			sessionStorage.removeItem("hub-pending-invite");
		}
	}

	const form = document.getElementById("hub-create-form");
	let pendingCreate = null;
	document.getElementById("hub-campaign-name")?.addEventListener("input", event => {
		if (pendingCreate?.name !== event.target.value.trim()) pendingCreate = null;
	});
	form?.addEventListener("submit", async event => {
		event.preventDefault();
		renderError("");
		const input = document.getElementById("hub-campaign-name");
		const button = document.getElementById("hub-create-submit");
		const campaignName = input.value.trim();
		if (!campaignName) {
			input.focus();
			renderError("Enter a campaign name before creating it.");
			return;
		}
		button.disabled = true;
		button.textContent = "Creating...";
		try {
			pendingCreate ||= {name: campaignName, idempotencyKey: crypto.randomUUID()};
			const {campaign} = await api.pCreateCampaign(pendingCreate);
			pendingCreate = null;
			window.location.assign(`campaign.html?id=${encodeURIComponent(campaign.id)}`);
		} catch (error) {
			renderError(getErrorMessage(error));
			button.disabled = false;
			button.textContent = "Create campaign";
		}
	});
	try {
		await pRenderAccountSessions();
	} catch (error) {
		renderError(getErrorMessage(error));
	}
	document.getElementById("hub-revoke-other-sessions")?.addEventListener("click", async event => {
		const button = event.currentTarget;
		button.disabled = true;
		try {
			await api.pRevokeOtherSessions({idempotencyKey: crypto.randomUUID()});
			await pRenderAccountSessions();
		} catch (error) {
			renderError(getErrorMessage(error));
		} finally {
			button.disabled = false;
		}
	});
	document.getElementById("hub-request-deletion")?.addEventListener("click", async event => {
		if (window.prompt(`Type DELETE to schedule account deletion after a 7-day grace period.`) !== "DELETE") return;
		const button = event.currentTarget;
		button.disabled = true;
		try {
			const result = await api.pRequestAccountDeletion({idempotencyKey: crypto.randomUUID()});
			renderAccountDeletionPending(result.deletion);
		} catch (error) {
			renderError(getErrorMessage(error));
			button.disabled = false;
		}
	});
}

async function pInitCampaign ({session}) {
	const campaignId = new URLSearchParams(window.location.search).get("id");
	if (!campaignId) throw new HubApiError({code: "CAMPAIGN_NOT_FOUND", status: 404});
	const campaign = await api.pGetCampaign({campaignId});
	const [members, characters, snapshot] = await Promise.all([
		api.pListMembers({campaignId}),
		api.pListCharacters({campaignId}),
		api.pGetCampaignSnapshot({campaignId}),
	]);
	const context = await api.pGetCampaignContext({campaignId});
	const pRefreshMembers = async () => renderMemberList({
		campaign,
		campaignId,
		members: await api.pListMembers({campaignId}),
		session,
		pRefresh: pRefreshMembers,
	});
	const pRefreshInvites = async () => renderInviteList({
		campaignId,
		invites: await api.pListInvites({campaignId}),
		pRefresh: pRefreshInvites,
	});
	document.getElementById("campaign-name").textContent = campaign.name;
	document.getElementById("campaign-role").textContent = getRoleLabel(campaign.role);
	document.getElementById("campaign-status").textContent = campaign.status === "active" ? "Active" : "Archived";
	document.getElementById("campaign-account").textContent = session.account.displayName;
	renderMemberList({campaign, campaignId, members, session, pRefresh: pRefreshMembers});
	if (["dm", "co_dm"].includes(campaign.role)) await pRefreshInvites();
	renderCharacterList({campaignId, characters});
	renderCampaignContext(context);
	if (campaign.status !== "active") {
		setHidden(document.getElementById("campaign-invite-form"), true);
		setHidden(document.getElementById("campaign-upload-local"), true);
		setHidden(document.getElementById("campaign-dm-controls"), true);
		setHidden(document.getElementById("campaign-open-dm-screen"), true);
		setHidden(document.getElementById("campaign-shared-actions"), true);
		setHidden(document.getElementById("campaign-leave"), true);
		setHidden(document.getElementById("campaign-loading"), true);
		setHidden(document.getElementById("campaign-content"), false);
		document.title = `${campaign.name} - Campaign Hub - ThelemarTools`;
		return;
	}
	await pInitCampaignForms({campaign, campaignId, session, characters, targetCharacters: snapshot.characters, context, pRefreshInvites});
	document.title = `${campaign.name} - Campaign Hub - ThelemarTools`;
	setHidden(document.getElementById("campaign-loading"), true);
	setHidden(document.getElementById("campaign-content"), false);
}

function renderCampaignContext (context) {
	const brew = document.getElementById("campaign-brew-status");
	const rules = document.getElementById("campaign-rules-status");
	if (brew) {
		brew.textContent = context.brewBundle
			? `Version ${context.brewBundle.version} · ${context.brewBundle.manifest.documentCount} document(s) · ${context.brewBundle.contentHash.slice(0, 12)}`
			: "No campaign homebrew published.";
	}
	if (rules) {
		rules.textContent = context.rulesVersion
			? `Version ${context.rulesVersion.version} · ${context.rulesVersion.rules.exhaustionRules} exhaustion`
			: "No campaign rules published.";
	}
}

function renderMemberList ({campaign, campaignId, members, session, pRefresh}) {
	const list = document.getElementById("campaign-member-list");
	if (!list) return;
	list.replaceChildren(...members.map(member => {
		const row = document.createElement("li");
		row.className = "hub-data-row";
		const main = document.createElement("div");
		main.className = "hub-data-row__main";
		const name = document.createElement("span");
		name.textContent = member.displayName;
		const role = document.createElement("span");
		role.className = "hub-data-row__meta";
		role.textContent = getRoleLabel(member.role);
		main.append(name, role);
		row.append(main);
		const isOwner = member.accountId === campaign.ownerAccountId;
		const canChangeRole = campaign.status === "active" && session.account.id === campaign.ownerAccountId && !isOwner;
		const canRemove = campaign.status === "active" && !isOwner && (
			session.account.id === campaign.ownerAccountId
			|| (campaign.role === "co_dm" && ["player", "spectator"].includes(member.role))
		);
		if (canChangeRole || canRemove) {
			const controls = document.createElement("div");
			controls.className = "hub-data-row__controls";
			if (canChangeRole) {
				const select = document.createElement("select");
				select.className = "hub-input";
				for (const value of ["co_dm", "player", "spectator"]) {
					const option = document.createElement("option");
					option.value = value;
					option.textContent = getRoleLabel(value);
					option.selected = member.role === value;
					select.append(option);
				}
				select.addEventListener("change", async () => {
					select.disabled = true;
					try {
						await api.pChangeMemberRole({campaignId, membershipId: member.id, role: select.value, idempotencyKey: crypto.randomUUID()});
						await pRefresh();
					} catch (error) {
						renderError(getErrorMessage(error));
						select.disabled = false;
						select.value = member.role;
					}
				});
				controls.append(select);
			}
			if (canRemove) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "hub-button hub-button--danger";
				button.textContent = "Remove";
				button.addEventListener("click", async () => {
					if (!window.confirm(`Remove ${member.displayName} from this campaign? Their campaign characters will return to personal ownership.`)) return;
					button.disabled = true;
					try {
						await api.pRemoveMember({campaignId, membershipId: member.id, idempotencyKey: crypto.randomUUID()});
						await pRefresh();
					} catch (error) {
						renderError(getErrorMessage(error));
						button.disabled = false;
					}
				});
				controls.append(button);
			}
			row.append(controls);
		}
		return row;
	}));
}

function renderInviteList ({campaignId, invites, pRefresh}) {
	const list = document.getElementById("campaign-invite-list");
	if (!list) return;
	list.replaceChildren(...invites.map(invite => {
		const row = document.createElement("div");
		row.className = "hub-data-row";
		const main = document.createElement("div");
		main.className = "hub-data-row__main";
		const title = document.createElement("span");
		title.textContent = `${getRoleLabel(invite.role)} invite`;
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		meta.textContent = `${invite.useCount}/${invite.maxUses} used · expires ${getDateLabel(invite.expiresAt)}${invite.revokedAt ? " · revoked" : ""}`;
		main.append(title, meta);
		row.append(main);
		if (!invite.revokedAt) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hub-button";
			button.textContent = "Revoke";
			button.addEventListener("click", async () => {
				button.disabled = true;
				try {
					await api.pRevokeInvite({campaignId, inviteId: invite.id, idempotencyKey: crypto.randomUUID()});
					await pRefresh();
				} catch (error) {
					renderError(getErrorMessage(error));
					button.disabled = false;
				}
			});
			row.append(button);
		}
		return row;
	}));
}

function renderCharacterList ({campaignId, characters}) {
	const list = document.getElementById("campaign-character-list");
	if (!list) return;
	list.replaceChildren(...characters.map(character => {
		const link = document.createElement("a");
		link.className = "hub-data-row";
		link.href = `charactersheet.html?id=${encodeURIComponent(character.id)}&hubCampaign=${encodeURIComponent(campaignId)}`;
		const name = document.createElement("span");
		name.textContent = character.data?.name || "Unnamed Character";
		const status = document.createElement("span");
		status.className = "hub-data-row__meta";
		status.textContent = character.ownerAccountId ? "Cloud character" : "Character";
		link.append(name, status);
		return link;
	}));
}

function fillCharacterSelect (select, characters, {includeParty = false, partyInventory = null, ownerAccountId = null} = {}) {
	if (!select) return;
	select.replaceChildren();
	for (const character of characters) {
		if (ownerAccountId && character.ownerAccountId !== ownerAccountId) continue;
		const option = document.createElement("option");
		option.value = `character:${character.id}`;
		option.textContent = character.data?.name || "Unnamed Character";
		select.append(option);
	}
	if (includeParty && partyInventory) {
		const option = document.createElement("option");
		option.value = `party_inventory:${partyInventory.id}`;
		option.textContent = "Party inventory";
		select.append(option);
	}
}

async function renderPendingActions ({campaignId, session}) {
	const list = document.getElementById("campaign-pending-actions");
	if (!list) return;
	const actions = await api.pListPendingActions({campaignId});
	list.replaceChildren(...actions.filter(action => action.status === "proposed").map(action => {
		const row = document.createElement("div");
		row.className = "hub-data-row";
		const text = document.createElement("span");
		text.textContent = `${action.payload.effect.type.replaceAll("_", " ")} → ${action.targetCharacterId}`;
		const controls = document.createElement("span");
		for (const decision of ["accept", "reject"]) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hub-button";
			button.textContent = decision === "accept" ? "Apply" : "Reject";
			button.addEventListener("click", async () => {
				await api.pResolveStructuredAction({campaignId, actionId: action.id, decision, idempotencyKey: crypto.randomUUID()});
				await renderPendingActions({campaignId, session});
			});
			controls.append(button);
		}

		row.append(text, controls);
		return row;
	}));
}

async function renderPendingTransfers ({campaignId}) {
	const list = document.getElementById("campaign-pending-transfers");
	if (!list) return;
	const transfers = await api.pListTransfers({campaignId});
	list.replaceChildren(...transfers.filter(transfer => transfer.status === "reserved").map(transfer => {
		const row = document.createElement("div");
		row.className = "hub-data-row";
		const text = document.createElement("span");
		text.textContent = `${transfer.sourceKind.replace("_", " ")} → ${transfer.targetKind.replace("_", " ")}`;
		const controls = document.createElement("span");
		for (const decision of ["accept", "reject"]) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hub-button";
			button.textContent = decision === "accept" ? "Accept" : "Reject";
			button.addEventListener("click", async () => {
				await api.pResolveTransfer({campaignId, transferId: transfer.id, decision, idempotencyKey: crypto.randomUUID()});
				await renderPendingTransfers({campaignId});
			});
			controls.append(button);
		}
		row.append(text, controls);
		return row;
	}));
}

function getFormFingerprint (form) {
	return JSON.stringify([...form.elements]
		.filter(control => control.id)
		.map(control => [
			control.id,
			control.type === "file"
				? [...(control.files || [])].map(file => `${file.name}:${file.size}:${file.lastModified}`)
				: ["checkbox", "radio"].includes(control.type)
					? control.checked
					: control.value,
		]));
}

async function pRunFormMutation ({form, fnMutate}) {
	if (form._hubIsSubmitting) return null;
	const fingerprint = getFormFingerprint(form);
	if (form._hubMutationFingerprint !== fingerprint) {
		form._hubMutationFingerprint = fingerprint;
		form._hubMutationKey = crypto.randomUUID();
	}
	form._hubIsSubmitting = true;
	const buttons = [...form.querySelectorAll("button[type='submit']")];
	buttons.forEach(button => button.disabled = true);
	try {
		const out = await fnMutate(form._hubMutationKey);
		form._hubMutationKey = null;
		form._hubMutationFingerprint = null;
		return out;
	} finally {
		form._hubIsSubmitting = false;
		buttons.forEach(button => button.disabled = false);
	}
}

async function pInitCampaignForms ({campaign, campaignId, session, characters, targetCharacters, context, pRefreshInvites}) {
	const inviteForm = document.getElementById("campaign-invite-form");
	const inviteOutput = document.getElementById("campaign-invite-output");
	const isDm = ["dm", "co_dm"].includes(campaign.role);
	const activeRules = context.rulesVersion?.rules;
	if (activeRules) {
		document.getElementById("campaign-rule-tgtt").checked = !!activeRules.enableTgtt;
		document.getElementById("campaign-rule-exhaustion").value = activeRules.exhaustionRules;
		document.getElementById("campaign-rule-carry").checked = !!activeRules.thelemar_carryWeight;
		document.getElementById("campaign-rule-jumping").checked = !!activeRules.thelemar_jumping;
		document.getElementById("campaign-rule-linguistics").checked = !!activeRules.thelemar_linguisticsBonus;
		document.getElementById("campaign-rule-critical").checked = !!activeRules.thelemar_criticalRolls;
	}
	setHidden(inviteForm, !isDm);
	inviteForm?.addEventListener("submit", async event => {
		event.preventDefault();
		await pRunFormMutation({form: event.currentTarget,
			fnMutate: async idempotencyKey => {
				const role = document.getElementById("campaign-invite-role").value;
				const result = await api.pCreateInvite({campaignId, role, idempotencyKey});
				const joinUrl = new URL("hub.html", window.location.href);
				joinUrl.hash = `invite=${encodeURIComponent(result.token)}`;
				inviteOutput.value = joinUrl.href;
				inviteOutput.select();
				await pRefreshInvites();
			}});
	});
	const leave = document.getElementById("campaign-leave");
	setHidden(leave, session.account.id === campaign.ownerAccountId);
	leave?.addEventListener("click", async () => {
		if (!window.confirm(`Leave ${campaign.name}? Your campaign characters will return to personal ownership.`)) return;
		leave.disabled = true;
		try {
			await api.pLeaveCampaign({campaignId, idempotencyKey: crypto.randomUUID()});
			window.location.assign("hub.html");
		} catch (error) {
			renderError(getErrorMessage(error));
			leave.disabled = false;
		}
	});

	const upload = document.getElementById("campaign-upload-local");
	upload?.addEventListener("click", async () => {
		const localCharacters = await globalThis.StorageUtil?.pGet("charsheet-characters") || [];
		if (!localCharacters.length) {
			renderError("No local characters are available to upload.");
			return;
		}
		const selected = await globalThis.InputUiUtil?.pGetUserMultipleChoice({
			title: "Upload Local Character Copy",
			values: localCharacters,
			fnDisplay: character => character.name || "Unnamed Character",
			isResolveItems: true,
			min: 1,
			max: 1,
		});
		const character = selected?.[0];
		if (!character) return;
		await api.pCreateCharacter({
			clientImportId: character.id,
			campaignId,
			data: character,
			idempotencyKey: crypto.randomUUID(),
		});
		renderCharacterList({campaignId, characters: await api.pListCharacters({campaignId})});
	});

	const dmControls = document.getElementById("campaign-dm-controls");
	setHidden(dmControls, !isDm);
	const dmScreenLink = document.getElementById("campaign-open-dm-screen");
	if (dmScreenLink) dmScreenLink.href = `dmscreen.html?hubCampaign=${encodeURIComponent(campaignId)}`;
	await renderPendingActions({campaignId, session});
	await renderPendingTransfers({campaignId});
	const partyInventory = await api.pGetPartyInventory({campaignId});
	const partyStatus = document.getElementById("campaign-party-inventory-status");
	if (partyStatus) {
		const currency = Object.entries(partyInventory.currency).filter(([, amount]) => amount).map(([type, amount]) => `${amount} ${type}`).join(", ") || "no currency";
		partyStatus.textContent = `${partyInventory.inventory.length} item stack(s) · ${currency}`;
	}

	fillCharacterSelect(document.getElementById("campaign-action-target"), targetCharacters);
	for (const id of ["campaign-xp-target", "campaign-item-target"]) fillCharacterSelect(document.getElementById(id), characters);
	fillCharacterSelect(document.getElementById("campaign-transfer-source"), characters, {
		includeParty: isDm,
		partyInventory,
		ownerAccountId: isDm ? null : session.account.id,
	});
	fillCharacterSelect(document.getElementById("campaign-transfer-target"), targetCharacters, {includeParty: true, partyInventory});

	document.getElementById("campaign-action-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		await pRunFormMutation({form: event.currentTarget,
			fnMutate: async idempotencyKey => {
				const type = document.getElementById("campaign-action-type").value;
				const rawValue = document.getElementById("campaign-action-value").value.trim();
				const effect = ["damage", "healing"].includes(type)
					? {type, amount: Number(rawValue) || 0}
					: ["condition_add", "condition_remove"].includes(type)
						? {type, condition: rawValue}
						: {type: "informational", note: rawValue};
				await api.pCreateStructuredAction({
					campaignId,
					targetCharacterId: document.getElementById("campaign-action-target").value.split(":")[1],
					effect,
					idempotencyKey,
				});
				await renderPendingActions({campaignId, session});
			}});
	});

	document.getElementById("campaign-xp-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		await pRunFormMutation({form: event.currentTarget,
			fnMutate: idempotencyKey => api.pGrantXp({
				campaignId,
				characterId: document.getElementById("campaign-xp-target").value.split(":")[1],
				amount: Number(document.getElementById("campaign-xp-amount").value),
				reason: document.getElementById("campaign-xp-reason").value || null,
				idempotencyKey,
			})});
	});

	document.getElementById("campaign-item-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		await pRunFormMutation({form: event.currentTarget,
			fnMutate: idempotencyKey => api.pGrantItem({
				campaignId,
				characterId: document.getElementById("campaign-item-target").value.split(":")[1],
				item: {
					name: document.getElementById("campaign-item-name").value,
					source: document.getElementById("campaign-item-source").value || "HB",
				},
				quantity: Number(document.getElementById("campaign-item-quantity").value) || 1,
				idempotencyKey,
			})});
	});

	document.getElementById("campaign-transfer-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		await pRunFormMutation({form: event.currentTarget,
			fnMutate: async idempotencyKey => {
				const [sourceKind, sourceId] = document.getElementById("campaign-transfer-source").value.split(":");
				const [targetKind, targetId] = document.getElementById("campaign-transfer-target").value.split(":");
				const entryId = document.getElementById("campaign-transfer-entry").value.trim();
				const quantity = Number(document.getElementById("campaign-transfer-quantity").value) || 0;
				const gp = Number(document.getElementById("campaign-transfer-gp").value) || 0;
				await api.pProposeTransfer({
					campaignId,
					sourceKind,
					sourceId,
					targetKind,
					targetId,
					payload: {
						items: entryId && quantity ? [{entryId, quantity}] : [],
						currency: {gp},
					},
					idempotencyKey,
				});
				await renderPendingTransfers({campaignId});
			}});
	});
	for (const id of ["campaign-xp-form", "campaign-item-form"]) {
		setHidden(document.getElementById(id), !isDm);
	}

	document.getElementById("campaign-brew-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		renderError("");
		const file = document.getElementById("campaign-brew-file").files?.[0];
		if (!file) {
			renderError("Choose a homebrew JSON file before publishing.");
			return;
		}
		try {
			await pRunFormMutation({form: event.currentTarget,
				fnMutate: async idempotencyKey => {
					const parsed = JSON.parse(await file.text());
					const brewDocs = Array.isArray(parsed)
						? parsed
						: parsed.head && parsed.body
							? [parsed]
							: [{head: {filename: file.name}, body: parsed}];
					const created = await api.pCreateBrewBundleVersion({
						campaignId,
						brewDocs,
						idempotencyKey,
					});
					await api.pActivateBrewBundleVersion({
						campaignId,
						versionId: created.brewBundle.id,
						idempotencyKey: `${idempotencyKey}:activate`,
					});
					renderCampaignContext(await api.pGetCampaignContext({campaignId}));
				}});
		} catch (error) {
			renderError(error instanceof SyntaxError ? "The selected file is not valid JSON." : getErrorMessage(error));
		}
	});

	document.getElementById("campaign-rules-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		renderError("");
		try {
			await pRunFormMutation({form: event.currentTarget,
				fnMutate: async idempotencyKey => {
					const rules = {
						enableTgtt: document.getElementById("campaign-rule-tgtt").checked,
						exhaustionRules: document.getElementById("campaign-rule-exhaustion").value,
						thelemar_carryWeight: document.getElementById("campaign-rule-carry").checked,
						thelemar_jumping: document.getElementById("campaign-rule-jumping").checked,
						thelemar_linguisticsBonus: document.getElementById("campaign-rule-linguistics").checked,
						thelemar_criticalRolls: document.getElementById("campaign-rule-critical").checked,
					};
					const created = await api.pCreateRulesVersion({
						campaignId,
						rules,
						idempotencyKey,
					});
					await api.pActivateRulesVersion({
						campaignId,
						versionId: created.rulesVersion.id,
						idempotencyKey: `${idempotencyKey}:activate`,
					});
					renderCampaignContext(await api.pGetCampaignContext({campaignId}));
				}});
		} catch (error) {
			renderError(getErrorMessage(error));
		}
	});
}

async function pInit () {
	const inviteFragment = new URLSearchParams(window.location.hash.slice(1)).get("invite");
	if (inviteFragment) {
		sessionStorage.setItem("hub-pending-invite", inviteFragment);
		window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
	}
	const signedOut = document.getElementById("hub-signed-out");
	const signedIn = document.getElementById("hub-signed-in");
	const loading = document.getElementById("hub-loading");
	try {
		const session = await api.pGetSession();
		setHidden(loading, true);
		if (!session.signedIn) {
			const signIn = document.getElementById("hub-sign-in");
			if (signIn) {
				const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
				signIn.href = `/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`;
			}
			setHidden(signedOut, false);
			return;
		}
		setHidden(signedIn, false);
		document.getElementById("hub-logout")?.addEventListener("click", async () => {
			try {
				await api.pLogout();
				window.location.assign("hub.html");
			} catch (error) {
				renderError(getErrorMessage(error));
			}
		});
		const view = document.body.dataset.hubView;
		if (session.account.status === "deletion_requested" && view === "campaign") {
			window.location.assign("hub.html");
			return;
		}
		if (view === "campaign") await pInitCampaign({session});
		else await pInitHubIndex({session});
	} catch (error) {
		setHidden(loading, true);
		renderError(getErrorMessage(error));
		if (error instanceof HubApiError && error.code === "AUTH_REQUIRED") setHidden(signedOut, false);
	}
}

void pInit();
