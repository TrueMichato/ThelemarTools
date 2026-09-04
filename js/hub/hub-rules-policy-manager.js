import {
	CAMPAIGN_RULES_POLICY_SCHEMA_VERSION,
	CampaignRulesPolicyError,
	createDefaultCampaignRulesPolicy,
	diffCampaignRulesPolicies,
	getCampaignRulesPolicySummary,
	normalizeCampaignRulesPolicy,
} from "./hub-campaign-rules.js";

const CATEGORY_ALL = "all";
const STATUS_ALL = "all";

function setHidden (element, isHidden) {
	element?.classList.toggle("ve-hidden", isHidden);
}

function createElement (tagName, {className = "", text = "", attrs = {}} = {}) {
	const element = document.createElement(tagName);
	if (className) element.className = className;
	if (text) element.textContent = text;
	for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
	return element;
}

function getActiveVersion (management) {
	return management.versions.find(version => version.id === management.activeRulesVersionId) || null;
}

function getSelection (policy, ruleId) {
	return policy.rules.find(rule => rule.id === ruleId);
}

function getPolicyValue (policy, definition) {
	return getSelection(policy, definition.id)?.parameters?.[definition.parameter.key];
}

function getRuleSearchText (definition) {
	return [
		definition.id,
		definition.title,
		definition.summary,
		definition.details,
		definition.category,
		definition.supportLabel,
	].join(" ").toLowerCase();
}

function getPolicyCompatibilityMessage (error) {
	if (!(error instanceof CampaignRulesPolicyError)) return "Review the selected rule values.";
	if (error.code === "RULES_COMBINATION_UNSUPPORTED") {
		if (error.details?.ruleId === "rules.exhaustion.system") {
			return "Thelemar exhaustion requires Thelemar rules to be on.";
		}
		if (error.details?.ruleId === "tgtt.encumbrance-tiers") {
			return "Encumbrance tiers require Thelemar carry capacity to be on.";
		}
	}
	return error.message;
}

export class HubRulesPolicyManager {
	constructor ({
		api,
		campaignId,
		context,
		fnRenderCampaignContext,
		fnRenderError,
		isCapabilityEnabled = false,
	}) {
		this._api = api;
		this._campaignId = campaignId;
		this._context = context;
		this._fnRenderCampaignContext = fnRenderCampaignContext;
		this._fnRenderError = fnRenderError;
		this._isCapabilityEnabled = isCapabilityEnabled;
		this._root = document.getElementById("campaign-rules-policy-manager");
		this._legacyForm = document.getElementById("campaign-rules-form");
		this._catalog = null;
		this._management = null;
		this._draft = null;
		this._search = "";
		this._category = CATEGORY_ALL;
		this._supportStatus = STATUS_ALL;
		this._isBusy = false;
		this._isLoading = false;
		this._isOffline = !navigator.onLine;
		this._isPolicyRefreshRequired = this._isOffline;
		this._policyLoadGeneration = 0;
		this._pendingPolicyLoads = 0;
	}

	async pInit () {
		if (!this._root || !this._isCapabilityEnabled) return;
		setHidden(this._legacyForm, true);
		setHidden(this._root, false);
		this._bindStaticControls();
		await this._pLoad();
	}

	_bindStaticControls () {
		document.getElementById("campaign-rules-search")?.addEventListener("input", event => {
			this._search = event.currentTarget.value.trim().toLowerCase();
			this._renderCatalog();
		});
		document.getElementById("campaign-rules-category")?.addEventListener("change", event => {
			this._category = event.currentTarget.value;
			this._renderCatalog();
		});
		document.getElementById("campaign-rules-support")?.addEventListener("change", event => {
			this._supportStatus = event.currentTarget.value;
			this._renderCatalog();
		});
		document.getElementById("campaign-rules-activate")?.addEventListener("click", () => void this._pPublish());
		document.getElementById("campaign-rules-history")?.addEventListener("change", () => this._renderRollbackReview());
		document.getElementById("campaign-rules-rollback")?.addEventListener("click", () => void this._pRollback());
		window.addEventListener("offline", () => this._handleOffline());
		window.addEventListener("online", () => this._handleOnline());
	}

	_handleOffline () {
		this._policyLoadGeneration++;
		this._isOffline = true;
		this._isPolicyRefreshRequired = true;
		this._renderReview();
		this._renderRollbackReview();
		this._setStatus("Offline. Current policy remains visible, but activation is unavailable.", true);
	}

	_handleOnline () {
		this._policyLoadGeneration++;
		this._isOffline = false;
		this._renderReview();
		this._renderRollbackReview();
		this._setStatus("Back online. Reload policy history before activating changes.", true);
	}

	_isMutationUnavailable () {
		return this._isBusy || this._isOffline || this._isPolicyRefreshRequired;
	}

	async _pLoad ({preservedDraft = null, conflictMessage = ""} = {}) {
		const loadGeneration = ++this._policyLoadGeneration;
		this._pendingPolicyLoads++;
		this._setLoading(true);
		try {
			const response = await this._api.pGetRulesPolicyManagement({campaignId: this._campaignId});
			if (loadGeneration !== this._policyLoadGeneration || this._isOffline) return false;
			this._catalog = response.catalog;
			this._management = response.management;
			const active = getActiveVersion(this._management);
			this._draft = preservedDraft || structuredClone(active?.policy || createDefaultCampaignRulesPolicy());
			this._isPolicyRefreshRequired = false;
			this._renderFilters();
			this._renderCatalog();
			this._renderHistory();
			this._renderReview();
			this._setStatus(
				conflictMessage
					|| (active
						? `Version ${active.version} is active. Advisory means supported tools read the setting, not that every campaign surface enforces it.`
						: "No version is active. Review the defaults, then activate the first immutable policy version."),
				!!conflictMessage,
			);
			return true;
		} catch (error) {
			if (loadGeneration !== this._policyLoadGeneration) return false;
			this._setStatus("The rules library could not be loaded. No campaign settings were changed.", true);
			this._fnRenderError(error);
			return false;
		} finally {
			this._pendingPolicyLoads = Math.max(0, this._pendingPolicyLoads - 1);
			this._setLoading(this._pendingPolicyLoads > 0);
		}
	}

	_setLoading (isLoading) {
		this._isLoading = isLoading;
		setHidden(document.getElementById("campaign-rules-policy-loading"), !isLoading);
		setHidden(document.getElementById("campaign-rules-policy-content"), isLoading);
		this._syncAriaBusy();
	}

	_syncAriaBusy () {
		this._root?.setAttribute("aria-busy", `${this._isLoading || this._isBusy}`);
	}

	_setBusy (isBusy) {
		this._isBusy = isBusy;
		for (const control of this._root?.querySelectorAll("input, select, button") || []) {
			if (isBusy) {
				control.dataset.hubPolicyDisabledBeforeBusy = `${control.disabled}`;
				control.disabled = true;
				continue;
			}
			control.disabled = control.dataset.hubPolicyDisabledBeforeBusy === "true";
			delete control.dataset.hubPolicyDisabledBeforeBusy;
		}
		if (!isBusy && this._management && this._draft) {
			this._renderCatalog();
			this._renderHistory();
			this._renderReview();
		}
		this._syncAriaBusy();
	}

	_setStatus (message, isError = false) {
		const status = document.getElementById("campaign-rules-policy-status");
		if (!status) return;
		status.textContent = message;
		status.classList.toggle("hub-inline-status--error", isError);
	}

	_renderFilters () {
		const category = document.getElementById("campaign-rules-category");
		if (category && category.options.length === 1) {
			for (const item of this._catalog.categories) category.add(new Option(item.label, item.id));
		}
	}

	_getFilteredDefinitions () {
		return this._catalog.rules.filter(definition => {
			if (this._search && !getRuleSearchText(definition).includes(this._search)) return false;
			if (this._category !== CATEGORY_ALL && definition.category !== this._category) return false;
			if (this._supportStatus !== STATUS_ALL && definition.supportLabel.toLowerCase() !== this._supportStatus) return false;
			return true;
		});
	}

	_renderCatalog () {
		const list = document.getElementById("campaign-rules-list");
		const empty = document.getElementById("campaign-rules-empty");
		const resultStatus = document.getElementById("campaign-rules-results-status");
		if (!list || !this._catalog || !this._draft) return;
		const definitions = this._getFilteredDefinitions();
		list.replaceChildren(...definitions.map(definition => this._renderRule(definition)));
		setHidden(empty, !!definitions.length);
		if (resultStatus) {
			resultStatus.textContent = `${definitions.length} ${definitions.length === 1 ? "rule" : "rules"} shown.`;
		}
	}

	_renderRule (definition) {
		const row = createElement("article", {
			className: "hub-rule-row",
			attrs: {"data-rule-id": definition.id},
		});
		const heading = createElement("div", {className: "hub-rule-row__heading"});
		heading.append(
			createElement("h5", {className: "hub-rule-row__title", text: definition.title}),
			createElement("span", {
				className: `hub-rule-status hub-rule-status--${definition.supportLabel.toLowerCase()}`,
				text: definition.supportLabel,
			}),
		);
		const summary = createElement("p", {className: "hub-rule-row__summary", text: definition.summary});
		const details = createElement("details", {className: "hub-rule-row__details"});
		details.append(
			createElement("summary", {text: "Support and effect details"}),
			createElement("p", {text: definition.details}),
			createElement("p", {
				className: "hub-rule-row__meta",
				text: `${definition.applicability.editions.join(" and ")} editions · ${definition.id}`,
			}),
		);
		const control = createElement("div", {className: "hub-rule-row__control"});
		if (!definition.isSelectable) {
			control.append(createElement("span", {
				className: "hub-rule-unavailable",
				text: "Selection unavailable until downstream enforcement evidence is accepted.",
			}));
		} else if (definition.parameter.type === "boolean") {
			const label = createElement("label", {className: "hub-setting"});
			const input = createElement("input", {
				attrs: {
					type: "checkbox",
					"data-campaign-rule-control": definition.id,
				},
			});
			input.checked = !!getPolicyValue(this._draft, definition);
			input.disabled = this._isBusy;
			input.addEventListener("change", () => {
				getSelection(this._draft, definition.id).parameters[definition.parameter.key] = input.checked;
				this._renderReview();
			});
			label.append(input, document.createTextNode(definition.parameter.label));
			control.append(label);
		} else {
			const id = `campaign-rule-policy-${definition.id.replaceAll(".", "-")}`;
			const label = createElement("label", {
				className: "hub-label",
				text: definition.parameter.label,
				attrs: {for: id},
			});
			const select = createElement("select", {
				className: "hub-input",
				attrs: {id, "data-campaign-rule-control": definition.id},
			});
			for (const option of definition.parameter.options) select.add(new Option(option.label, option.value));
			select.value = getPolicyValue(this._draft, definition);
			select.disabled = this._isBusy;
			select.addEventListener("change", () => {
				getSelection(this._draft, definition.id).parameters[definition.parameter.key] = select.value;
				this._renderReview();
			});
			control.append(label, select);
		}
		row.append(heading, summary, control, details);
		return row;
	}

	_renderReview () {
		const list = document.getElementById("campaign-rules-review-list");
		const empty = document.getElementById("campaign-rules-review-empty");
		const validation = document.getElementById("campaign-rules-validation");
		const activate = document.getElementById("campaign-rules-activate");
		if (!list || !this._management || !this._draft) return;
		const active = getActiveVersion(this._management);
		let changes = [];
		let validationMessage = "";
		try {
			this._draft = normalizeCampaignRulesPolicy(this._draft);
			changes = diffCampaignRulesPolicies({
				before: active?.policy || createDefaultCampaignRulesPolicy(),
				after: this._draft,
			});
		} catch (error) {
			validationMessage = getPolicyCompatibilityMessage(error);
		}
		list.replaceChildren(...changes.map(change => {
			const item = createElement("li", {className: "hub-policy-change"});
			item.append(
				createElement("strong", {text: change.title}),
				createElement("span", {text: `${change.before} to ${change.after}`}),
			);
			return item;
		}));
		const isLegacyUpgrade = !!active && active.schemaVersion !== CAMPAIGN_RULES_POLICY_SCHEMA_VERSION;
		setHidden(empty, !!changes.length);
		if (empty) {
			empty.textContent = isLegacyUpgrade
				? "No setting values change. Activation upgrades the policy format without changing behavior."
				: active
					? "No changes to activate."
					: "The first activation will publish these default settings.";
		}
		if (validation) {
			validation.textContent = validationMessage;
			setHidden(validation, !validationMessage);
		}
		if (activate) {
			activate.disabled = this._isMutationUnavailable()
				|| !!validationMessage
				|| (!!active && !isLegacyUpgrade && !changes.length);
		}
	}

	_renderHistory () {
		const select = document.getElementById("campaign-rules-history");
		if (!select) return;
		const active = getActiveVersion(this._management);
		const inactive = this._management.versions.filter(version => version.id !== active?.id);
		select.replaceChildren(new Option(inactive.length ? "Choose a previous version" : "No previous versions", ""));
		for (const version of inactive) {
			select.add(new Option(
				`Version ${version.version} · ${version.schemaVersion === 1 ? "legacy compatible" : `catalog ${version.catalogVersion}`}`,
				version.id,
			));
		}
		select.disabled = this._isBusy || !inactive.length;
		this._renderRollbackReview();
	}

	_renderRollbackReview () {
		const select = document.getElementById("campaign-rules-history");
		const output = document.getElementById("campaign-rules-rollback-review");
		const button = document.getElementById("campaign-rules-rollback");
		if (!select || !output || !button || !this._management) return;
		const target = this._management.versions.find(version => version.id === select.value);
		const active = getActiveVersion(this._management);
		output.replaceChildren();
		if (!target || !active) {
			output.textContent = "Choose a previous version to review its setting changes.";
			button.disabled = true;
			return;
		}
		let changes;
		try {
			changes = diffCampaignRulesPolicies({
				before: active.policy,
				after: target.policy,
				isAfterStoredPolicy: true,
			});
		} catch {
			output.textContent = "This historical policy cannot be previewed safely. No version was activated.";
			button.disabled = true;
			this._setStatus("The selected historical policy is unavailable for preview.", true);
			return;
		}
		output.append(...(changes.length
			? changes.map(change => createElement("span", {
				className: "hub-policy-change",
				text: `${change.title}: ${change.before} to ${change.after}`,
			}))
			: [document.createTextNode("This version has the same projected settings but preserves its earlier immutable record.")]));
		button.disabled = this._isMutationUnavailable();
	}

	async _pPublish () {
		if (this._isMutationUnavailable()) return;
		this._setBusy(true);
		this._renderReview();
		this._setStatus("Activating a new immutable policy version...");
		try {
			const result = await this._api.pPublishRulesPolicy({
				campaignId: this._campaignId,
				policy: this._draft,
				expectedActiveRulesVersionId: this._management.activeRulesVersionId,
				idempotencyKey: crypto.randomUUID(),
			});
			await this._pRefreshContext(result.rulesVersion);
			await this._pLoad();
			this._setStatus(`Version ${result.rulesVersion.version} is active. Players can read the updated advisory policy summary.`);
		} catch (error) {
			if (error?.code === "RULES_VERSION_STALE") {
				const preservedDraft = structuredClone(this._draft);
				await this._pLoad({
					preservedDraft,
					conflictMessage: "Rules changed elsewhere. Your draft is preserved against the refreshed active version; review the new before/after summary.",
				});
			} else {
				this._setStatus("The policy was not activated. No campaign settings changed.", true);
				this._fnRenderError(error);
			}
		} finally {
			this._setBusy(false);
		}
	}

	async _pRollback () {
		const select = document.getElementById("campaign-rules-history");
		if (this._isMutationUnavailable() || !select?.value) return;
		this._setBusy(true);
		this._renderReview();
		this._renderRollbackReview();
		this._setStatus("Activating the selected previous version...");
		try {
			const result = await this._api.pActivateRulesPolicyVersion({
				campaignId: this._campaignId,
				rulesVersionId: select.value,
				expectedActiveRulesVersionId: this._management.activeRulesVersionId,
				idempotencyKey: crypto.randomUUID(),
			});
			await this._pRefreshContext(result.rulesVersion);
			await this._pLoad();
			this._setStatus(`Version ${result.rulesVersion.version} is active again. No historical version was modified.`);
		} catch (error) {
			if (error?.code === "RULES_VERSION_STALE") {
				await this._pLoad({conflictMessage: "Rules changed elsewhere. History was refreshed; choose the rollback version again."});
			} else {
				this._setStatus("The previous version was not activated. No campaign settings changed.", true);
				this._fnRenderError(error);
			}
		} finally {
			this._setBusy(false);
		}
	}

	async _pRefreshContext (rulesVersion) {
		this._context = {
			...this._context,
			rulesVersion: {
				...rulesVersion,
				policySummary: getCampaignRulesPolicySummary(rulesVersion.policy),
			},
		};
		this._fnRenderCampaignContext(this._context);
	}

	replaceContext (context) {
		this._context = context;
	}
}

export async function pInitCampaignRulesPolicy (options) {
	const manager = new HubRulesPolicyManager(options);
	await manager.pInit();
	return manager;
}
