/**
 * Character Sheet Upgrades Module
 * Handles item upgrade application, gemstone empowerment, socketing, and mechanical effects
 */

import {CharacterSheetModal} from "./charactersheet-modal.js";
import {
	getAggregatedArmorUpgradeEffects,
	getAggregatedUpgradeEffects,
	getEligibleUpgrades,
	getGemstoneDescriptor,
	getGemstoneRegistryNames,
	isArmor,
	isShield,
	isSocketable,
	isWeapon,
	resetItemUpgradeCatalog,
	setItemUpgradeCatalog,
} from "../itembuilder/itembuilder-upgrade-rules.js";

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_, ee, InputUiUtil, Renderer} = /** @type {*} */ (globalThis);

class CharacterSheetUpgrades {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._allUpgrades = [];
	}

	setUpgrades (upgrades) {
		this._allUpgrades = upgrades;
		setItemUpgradeCatalog(upgrades);
	}

	static setUpgradeCatalog (upgrades) {
		setItemUpgradeCatalog(upgrades);
	}

	static resetUpgradeCatalog () {
		resetItemUpgradeCatalog();
	}

	// ==========================================
	// Upgrade Type Helpers
	// ==========================================

	/**
	 * Check if an item is eligible for weapon upgrades
	 * @param {object} item - Inventory item data
	 * @returns {boolean}
	 */
	static isWeapon (item) {
		return isWeapon(item);
	}

	/**
	 * Check if an item is eligible for armor upgrades
	 * @param {object} item - Inventory item data
	 * @returns {boolean}
	 */
	static isArmor (item) {
		return isArmor(item);
	}

	/**
	 * Check if an item is a shield
	 * @param {object} item - Inventory item data
	 * @returns {boolean}
	 */
	static isShield (item) {
		return isShield(item);
	}

	/**
	 * Check if an item is eligible for gemstone socketing (weapon, armor, or shield)
	 * @param {object} item - Inventory item data
	 * @returns {boolean}
	 */
	static isSocketable (item) {
		return isSocketable(item);
	}

	/**
	 * Get all upgrades applicable to an item, filtering by type and prerequisites
	 * @param {object} item - The inventory item
	 * @returns {Array} Filtered upgrade entities
	 */
	getEligibleUpgrades (item) {
		const upgrades = this._page.getItemUpgrades?.() || this._allUpgrades;
		return getEligibleUpgrades({item, upgrades});
	}

	/**
	 * Get all gemstone upgrade entities (not empowered — these are the power definitions)
	 * @returns {Array}
	 */
	getGemstoneUpgrades () {
		const upgrades = this._page.getItemUpgrades?.() || this._allUpgrades;
		return upgrades.filter(u => (u.upgradeType?.[0] || "").startsWith("GS:"));
	}

	/**
	 * Parse gold cost from either a free-form string ("100 gp (base)", "1,000 gp")
	 * or a structured cost object ({gp, isBase?, note?}).
	 * @param {string|object} cost - The cost value from the upgrade entity
	 * @returns {number} Gold cost in gp
	 */
	static parseGoldCost (cost) {
		if (cost == null) return 0;
		if (typeof cost === "object") {
			return typeof cost.gp === "number" && cost.gp >= 0 ? cost.gp : 0;
		}
		if (typeof cost !== "string") return 0;
		const match = cost.replace(/,/g, "").match(/([\d.]+)\s*gp/i);
		return match ? parseFloat(match[1]) : 0;
	}

	/**
	 * Format a cost value for display, normalising both string and structured forms.
	 * @param {string|object} cost
	 * @returns {string}
	 */
	static formatCostDisplay (cost) {
		if (cost == null) return "Free";
		if (typeof cost === "string") return cost;
		if (typeof cost === "object" && typeof cost.gp === "number") {
			const gpStr = `${cost.gp.toLocaleString()} gp`;
			if (cost.note) return `${gpStr} (${cost.note})`;
			if (cost.isBase) return `${gpStr} (base)`;
			return gpStr;
		}
		return "Free";
	}

	/**
	 * Whether this cost is flagged as a per-upgrade base cost (DM may scale per item).
	 * @param {string|object} cost
	 * @returns {boolean}
	 */
	static isBaseCost (cost) {
		if (cost == null) return false;
		if (typeof cost === "object") return !!cost.isBase;
		if (typeof cost === "string") return /\(base\)/i.test(cost);
		return false;
	}

	/**
	 * Get the governing variant rule (variantrule entity) for an item being upgraded.
	 * Used to render a hover-link to the source rules in the modal header.
	 * Armor/Shield → links to the real "Upgrading Armor" variantrule in the TCAH brew.
	 * Weapons → inline predefined hover (no variantrule entity exists upstream in TCAH).
	 * @param {object} item - The inventory item
	 * @returns {{name: string, source: string, label: string, isVariantrule?: boolean, inlineEntry?: object}|null}
	 */
	static getRulesReference (item) {
		if (CharacterSheetUpgrades.isArmor(item) || CharacterSheetUpgrades.isShield(item)) {
			return {name: "Upgrading Armor", source: "TCAH", label: "Armor & Shield Upgrade Rules", isVariantrule: true};
		}
		if (CharacterSheetUpgrades.isWeapon(item)) {
			return {
				name: "Upgrading Weapons",
				source: "TCAH",
				label: "Weapon Upgrade Rules",
				inlineEntry: CharacterSheetUpgrades._WEAPON_UPGRADE_RULES_ENTRY,
			};
		}
		return null;
	}

	/**
	 * Inline entry content for the weapon upgrade rules hover.
	 * Sourced from TCAH p.11 — kept here instead of modifying the upstream TCAH brew file.
	 */
	static _WEAPON_UPGRADE_RULES_ENTRY = {
		type: "entries",
		name: "Upgrading Weapons",
		source: "TCAH",
		page: 11,
		entries: [
			"Upgrading weapons follows a branching path system, with available options split into multiple tiers. At first, a weapon can only be upgraded with a limited selection of 1st tier tags depending on its type, each of which \"unlocks\" one or more options from the next tier. The following additional rules apply when upgrading a weapon with a new tag:",
			{
				type: "list",
				items: [
					"All prerequisite conditions must be satisfied to apply a new tag, as shown in the Weapon Upgrades table.",
					"2nd tier upgrades can only be applied by a trained craftsman, with 3rd tier upgrades requiring the skills of a master artisan.",
					"Typically, it takes an artisan a full day of work (minimum 8 hours) to upgrade a weapon with a new tag.",
					"Once added, a tag can't be removed from a weapon.",
				],
			},
			{
				type: "entries",
				name: "Weapon Upgrade Cost Structure",
				entries: [
					"Upgrading a weapon has a base cost associated with each tier, with subsequent upgrades of that tier costing twice the previous amount for that tier. For example, adding the {@b {@i balanced}} tag costs the tier 1 base cost of 100 gp. A second 1st tier upgrade costs 200 gp, the next 400 gp, and so on.",
					"Upgrades are grouped by tier for the purposes of this cost scaling.",
				],
			},
			{
				type: "table",
				caption: "Weapon Upgrade Comparison",
				colLabels: ["Tier", "Rarity", "Guide Price (DMG)", "Equivalent Upgrade Cost"],
				colStyles: ["col-1 text-center", "col-3", "col-4 text-right", "col-4 text-right"],
				rows: [
					["+1", "Uncommon", "101\u2013500 gp", "300\u20131,700 gp*"],
					["+2", "Rare", "501\u20135,000 gp", "4,000\u20135,000 gp"],
					["+3", "Very rare", "5,001\u201350,000 gp", "16,000\u201328,000 gp"],
				],
				footnotes: [
					"* Cost varies depending on the requirement for the ability to overcome resistance and immunity to nonmagical attacks and damage.",
				],
			},
		],
		data: {
			hoverTitle: "Upgrading Weapons \u2014 TCAH p. 11",
		},
	};

	/**
	 * Get the tier label for an upgrade type code
	 * @param {string} upgradeType - e.g. "WU:1", "AU", "GS:C"
	 * @returns {string}
	 */
	static getUpgradeTierLabel (upgradeType) {
		const labels = {
			"WU:1": "1st Tier Weapon",
			"WU:2": "2nd Tier Weapon",
			"WU:3": "3rd Tier Weapon",
			"AU": "Armor",
			"GS:C": "Common Gemstone",
			"GS:U": "Uncommon Gemstone",
			"GS:R": "Rare Gemstone",
			"GS:VR": "Very Rare Gemstone",
			"GS:L": "Legendary Gemstone",
		};
		return labels[upgradeType] || upgradeType;
	}

	/**
	 * Get the tier color class for an upgrade type
	 * @param {string} upgradeType
	 * @returns {string}
	 */
	static getUpgradeTierColor (upgradeType) {
		if (upgradeType?.startsWith("WU:1")) return "badge-info";
		if (upgradeType?.startsWith("WU:2")) return "badge-primary";
		if (upgradeType?.startsWith("WU:3")) return "badge-warning";
		if (upgradeType === "AU") return "badge-secondary";
		if (upgradeType?.startsWith("GS:")) return "badge-success";
		return "badge-default";
	}

	// ==========================================
	// Upgrade Picker Modal
	// ==========================================

	/**
	 * Show the upgrade picker modal for an item
	 * @param {string} itemId - The item ID
	 */
	async showUpgradePickerModal (itemId) {
		const items = this._state.getItems();
		const item = items.find(i => i.id === itemId);
		if (!item) return;

		const eligibleUpgrades = this.getEligibleUpgrades(item);
		const currentUpgrades = this._state.getItemUpgrades(itemId);
		const totalGold = this._state.getTotalGold();
		const rulesRef = CharacterSheetUpgrades.getRulesReference(item);

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Upgrade: ${item.name}`,
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__upgrade-modal"></div>`});

		// Rules reference header — gives players one-click hover access to the governing TCAH rules
		if (rulesRef) {
			let rulesLink;
			if (rulesRef.isVariantrule) {
				// Real variantrule entity in the loaded TCAH brew — standard hover link
				rulesLink = CharacterSheetPage.getHoverLink(
					UrlUtil.PG_VARIANTRULES,
					rulesRef.name,
					rulesRef.source,
					null,
					rulesRef.label,
				);
			} else if (rulesRef.inlineEntry) {
				// No upstream variantrule — render a predefined hover from inline entry content
				const hoverMeta = Renderer.hover.getMakePredefinedHover(rulesRef.inlineEntry, {isBookContent: true});
				rulesLink = `<a href="#" ${hoverMeta.html} onclick="event.preventDefault()">${rulesRef.label}</a>`;
			}
			if (rulesLink) {
				content.append(e_({outer: `
					<div class="charsheet__upgrade-rules-ref ve-flex-v-center mb-2 p-2 stripe-even ve-small">
						<span class="glyphicon glyphicon-book mr-1" aria-hidden="true"></span>
						<span><strong>Rules:</strong> ${rulesLink} <span class="ve-muted">(hover for full text)</span></span>
					</div>
				`}));
			}
		}

		// Current upgrades section
		if (currentUpgrades.length) {
			const currentSection = e_({outer: `<div class="charsheet__upgrade-current mb-3"></div>`});
			currentSection.append(e_({outer: `<h5>Applied Upgrades</h5>`}));
			for (const upgrade of currentUpgrades) {
				const tierLabel = CharacterSheetUpgrades.getUpgradeTierLabel(upgrade.upgradeType);
				const tierColor = CharacterSheetUpgrades.getUpgradeTierColor(upgrade.upgradeType);
				const upgradeLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, upgrade.name, upgrade.source);
				currentSection.append(e_({outer: `
					<div class="charsheet__upgrade-applied ve-flex-v-center mb-1 p-1 stripe-even">
						<div class="ve-flex-1">
							<span class="badge ${tierColor} ve-small mr-1">${tierLabel}</span>
							<span class="charsheet__upgrade-name">${upgradeLink}</span>
							${upgrade.costPaid ? `<span class="ve-muted ve-small ml-1">(${upgrade.costPaid} gp)</span>` : ""}
						</div>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-danger charsheet__upgrade-remove" data-upgrade-name="${upgrade.name}" data-upgrade-source="${upgrade.source}" title="Remove upgrade">
							<span class="glyphicon glyphicon-trash"></span>
						</button>
					</div>
				`}));
			}
			content.append(currentSection);
		}

		// Socketed gemstones section
		const gemstones = this._state.getSocketedGemstones(itemId);
		if (gemstones.length) {
			const gemSection = e_({outer: `<div class="charsheet__upgrade-gems mb-3"></div>`});
			gemSection.append(e_({outer: `<h5>Socketed Gemstones</h5>`}));
			for (const gem of gemstones) {
				const tierLabel = CharacterSheetUpgrades.getUpgradeTierLabel(gem.upgradeType);
				const chargeStr = gem.chargesMax != null ? ` (${gem.chargesCurrent}/${gem.chargesMax} charges)` : "";
				const gemLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, gem.name, gem.source);
				gemSection.append(e_({outer: `
					<div class="charsheet__upgrade-gem ve-flex-v-center mb-1 p-1 stripe-even">
						<div class="ve-flex-1">
							<span class="badge badge-success ve-small mr-1">${gem.gemName || tierLabel}</span>
							<span class="charsheet__upgrade-name">${gemLink}</span>
							<span class="ve-muted ve-small">${chargeStr}</span>
						</div>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-warning charsheet__gem-unsocket" data-gem-name="${gem.name}" title="Unsocket gemstone">
							<span class="glyphicon glyphicon-eject"></span>
						</button>
					</div>
				`}));
			}
			content.append(gemSection);
		}

		// Available upgrades section
		if (eligibleUpgrades.length) {
			const availSection = e_({outer: `<div class="charsheet__upgrade-available mb-3"></div>`});
			availSection.append(e_({outer: `<h5>Available Upgrades</h5>`}));
			availSection.append(e_({outer: `<p class="ve-small ve-muted">Gold available: <strong>${totalGold.toFixed(1)} gp</strong></p>`}));
			// Override / escape hatch (#14): apply upgrades the character already owns (migrating /
			// pre-owned gear) without paying gold or meeting prerequisites.
			availSection.append(e_({outer: `
				<label class="charsheet__upgrade-override-label ve-flex-v-center ve-small mb-2" title="Apply upgrades without paying gold or meeting prerequisites — for migrating or already-upgraded gear.">
					<input type="checkbox" class="charsheet__upgrade-override mr-1">
					<span>Bypass cost &amp; prerequisites <span class="ve-muted">(already-owned / migrating)</span></span>
				</label>
			`}));

			// Group by tier
			const grouped = {};
			for (const upgrade of eligibleUpgrades) {
				const tier = upgrade.upgradeType?.[0] || "Other";
				if (!grouped[tier]) grouped[tier] = [];
				grouped[tier].push(upgrade);
			}

			for (const [tier, upgrades] of Object.entries(grouped)) {
				const tierLabel = CharacterSheetUpgrades.getUpgradeTierLabel(tier);
				const tierColor = CharacterSheetUpgrades.getUpgradeTierColor(tier);
				availSection.append(e_({outer: `<div class="ve-small ve-bold mt-2 mb-1"><span class="badge ${tierColor}">${tierLabel}</span></div>`}));

				for (const upgrade of upgrades) {
					const gpCost = CharacterSheetUpgrades.parseGoldCost(upgrade.cost);
					const isBase = CharacterSheetUpgrades.isBaseCost(upgrade.cost);
					const costLabel = CharacterSheetUpgrades.formatCostDisplay(upgrade.cost);
					const canAfford = totalGold >= gpCost;
					const prereqItems = upgrade.prerequisite?.[0]?.item;
					const prereqText = prereqItems?.length ? `Requires: ${prereqItems.join("; ")}` : "";
					const renderedEntries = upgrade.entries?.length
						? Renderer.get().render({type: "entries", entries: upgrade.entries})
						: "";
					const btnAttr = !canAfford ? "disabled data-cost-locked=\"1\" title=\"Insufficient gold — tick the bypass box above to apply anyway\"" : `title="Apply for ${gpCost} gp"`;
					const upgradeLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, upgrade.name, upgrade.source);
					const baseHint = isBase
						? `<span class="badge badge-default ve-small ml-1" title="Per-upgrade base cost. The DM may scale this for the specific item per the source's pricing tables.">base</span>`
						: "";

					const row = e_({outer: `
						<div class="charsheet__upgrade-option mb-1 p-2 stripe-even">
							<div class="ve-flex-v-center mb-1">
								<div class="ve-flex-1">
									<span class="charsheet__upgrade-name">${upgradeLink}</span>
									<span class="ve-muted ve-small ml-1">${costLabel}</span>${baseHint}
									${prereqText ? `<div class="ve-small ve-muted">${prereqText}</div>` : ""}
								</div>
								<button type="button"
									class="ve-btn ve-btn-xs ${canAfford ? "ve-btn-primary" : "ve-btn-default"} charsheet__upgrade-apply"
									data-upgrade-name="${upgrade.name}"
									data-upgrade-source="${upgrade.source}"
									data-upgrade-cost="${gpCost}"
									${btnAttr}>
									<span class="glyphicon glyphicon-plus"></span> Apply
								</button>
							</div>
							${renderedEntries ? `<details class="ve-small charsheet__upgrade-details"><summary class="ve-muted">Details</summary><div class="mt-1">${renderedEntries}</div></details>` : ""}
						</div>
					`});
					availSection.append(row);
				}
			}
			content.append(availSection);
		} else if (!currentUpgrades.length) {
			content.append(e_({outer: `<p class="ve-muted">No upgrades available for this item type.</p>`}));
		}

		// Socket gemstone button (if item is socketable and has room)
		if (CharacterSheetUpgrades.isSocketable(item) && gemstones.length < 1) {
			const socketSection = e_({outer: `<div class="charsheet__upgrade-socket mt-3"></div>`});
			socketSection.append(e_({outer: `
				<button type="button" class="ve-btn ve-btn-sm ve-btn-success charsheet__gem-socket-btn">
					<span class="glyphicon glyphicon-plus-sign"></span> Socket Gemstone
				</button>
			`}));
			content.append(socketSection);
		}

		modalInner.append(content);

		// Override toggle (#14): when ticked, enable cost-locked apply buttons so already-owned
		// upgrades can be applied without paying gold or meeting prerequisites.
		const overrideCb = content.querySelector(".charsheet__upgrade-override");
		if (overrideCb) {
			overrideCb.addEventListener("change", () => {
				const isOverride = overrideCb.checked;
				content.querySelectorAll(".charsheet__upgrade-apply[data-cost-locked]").forEach((/** @type {*} */ btn) => {
					btn.disabled = !isOverride;
					btn.classList.toggle("ve-btn-primary", isOverride);
					btn.classList.toggle("ve-btn-default", !isOverride);
					btn.title = isOverride ? "Apply for free (cost bypassed)" : "Insufficient gold — tick the bypass box above to apply anyway";
				});
			});
		}

		// Footer
		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(footer);
		footer.querySelector("button").addEventListener("click", () => doClose(false));

		// Event delegation for the modal
		content.addEventListener("click", async (e) => {
			// Apply upgrade
			const applyBtn = e.target.closest(".charsheet__upgrade-apply");
			if (applyBtn) {
				const name = applyBtn.dataset.upgradeName;
				const source = applyBtn.dataset.upgradeSource;
				const rawCost = parseFloat(applyBtn.dataset.upgradeCost);
				// When the override box is ticked, bypass gold cost & prerequisites entirely.
				const isOverride = !!overrideCb?.checked;
				const cost = isOverride ? 0 : rawCost;
				const upgrade = (this._page.getItemUpgrades?.() || this._allUpgrades).find(
					u => u.name === name && u.source === source,
				);
				if (!upgrade) return;

				// Deduct gold
				if (cost > 0) {
					const result = this._state.deductGold(cost);
					if (!result.success) {
						JqueryUtil.doToast({content: result.error, type: "danger"});
						return;
					}
				}

				// Apply upgrade
				const result = this._state.applyItemUpgrade(itemId, upgrade, cost);
				if (!result.success) {
					JqueryUtil.doToast({content: result.error, type: "danger"});
					return;
				}

				const costMsg = isOverride && rawCost > 0 ? "(cost bypassed)" : `for ${cost} gp`;
				JqueryUtil.doToast({content: `Applied "${upgrade.name}" to ${item.name} ${costMsg}`, type: "success"});
				this._page.saveCharacter();
				doClose(true);
				this._page._inventory?.render();
				return;
			}

			// Remove upgrade (with optional refund)
			const removeBtn = e.target.closest(".charsheet__upgrade-remove");
			if (removeBtn) {
				const name = removeBtn.dataset.upgradeName;
				const source = removeBtn.dataset.upgradeSource;
				const applied = this._state.getItemUpgrades(itemId).find(
					u => u.name === name && u.source === source,
				);
				const paid = applied?.costPaid || 0;

				let refund = 0;
				if (paid > 0) {
					const choice = await InputUiUtil.pGetUserEnum({
						title: `Remove "${name}"`,
						placeholder: "How should the cost be handled?",
						values: ["No refund", `Full refund (${paid} gp)`, `Half refund (${paid / 2} gp)`],
						isResolveItem: false,
					});
					if (choice == null) return; // cancelled
					if (choice === 1) refund = paid;
					else if (choice === 2) refund = paid / 2;
				} else {
					const ok = await InputUiUtil.pGetUserBoolean({
						title: `Remove "${name}"?`,
						htmlDescription: `This upgrade will be removed from <strong>${item.name}</strong>.`,
						textYes: "Remove",
						textNo: "Cancel",
					});
					if (!ok) return;
				}

				const removed = this._state.removeItemUpgrade(itemId, name, source);
				if (!removed) {
					JqueryUtil.doToast({content: `Could not remove "${name}"`, type: "danger"});
					return;
				}
				if (refund > 0) this._state.addGold(refund);

				const refundStr = refund > 0 ? ` (refunded ${refund} gp)` : "";
				JqueryUtil.doToast({content: `Removed "${name}" from ${item.name}${refundStr}`, type: "info"});
				this._page.saveCharacter();
				doClose(true);
				this._page._inventory?.render();
				return;
			}

			// Unsocket gemstone
			const unsocketBtn = e.target.closest(".charsheet__gem-unsocket");
			if (unsocketBtn) {
				const gemName = unsocketBtn.dataset.gemName;
				const removed = this._state.unsocketGemstone(itemId, gemName);
				if (removed) {
					JqueryUtil.doToast({content: `Unsocketed "${gemName}" from ${item.name}`, type: "info"});
					this._page.saveCharacter();
					doClose(true);
					this._page._inventory?.render();
				}
				return;
			}

			// Socket gemstone button
			if (e.target.closest(".charsheet__gem-socket-btn")) {
				doClose(false);
				await this.showGemstoneSocketModal(itemId);
			}
		});
	}

	// ==========================================
	// Gemstone Empowerment Modal
	// ==========================================

	/**
	 * Show the gemstone empowerment modal
	 */
	async showEmpowermentModal (opts = {}) {
		const gemstones = this.getGemstoneUpgrades();
		if (!gemstones.length) {
			JqueryUtil.doToast({content: "No gemstone data loaded. Check if Thelemar homebrew is enabled.", type: "warning"});
			return;
		}

		// Check if character has the Gem Empowerment skill
		const hasGemEmpowerment = this._state.isProficientInSkill("gemempowerment");
		const gemEmpowermentMod = this._state.getSkillMod("gemempowerment");

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: opts.fromInventoryGem ? `Empower: ${opts.fromInventoryGem.name}` : "Gemstone Empowerment",
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__empower-modal"></div>`});

		const skillBadge = hasGemEmpowerment
			? `<span class="badge badge-success ve-small">+${gemEmpowermentMod}</span>`
			: `<span class="badge badge-danger ve-small">Not proficient</span>`;

		content.append(e_({outer: `
			<div class="charsheet__empower-header">
				<span class="ve-small"><strong>Gem Empowerment</strong> ${skillBadge}</span>
				<span class="ve-small ve-muted">⚠ Failure destroys the gem</span>
				${!hasGemEmpowerment ? `<div class="charsheet__empower-warning ve-small">No <strong>Gem Empowerment</strong> skill — add it as a custom skill to roll, or use <strong>✓ Already empowered</strong> to record a pre-empowered gem (requirements bypassed).</div>` : ""}
			</div>
		`}));

		// Filter gems to matching gemName when empowering from inventory
		const filteredGemstones = opts.fromInventoryGem
			? gemstones.filter(g => g.gemName && g.gemName.toLowerCase() === opts.fromInventoryGem.name.toLowerCase())
			: gemstones;

		if (opts.fromInventoryGem && !filteredGemstones.length) {
			content.append(e_({outer: `<div class="charsheet__empower-warning ve-small">No empowerment options found for "${opts.fromInventoryGem.name}".</div>`}));
			modalInner.append(content);
			const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-1"><button class="ve-btn ve-btn-default ve-btn-xs">Close</button></div>`;
			modalInner.append(footer);
			footer.querySelector("button").addEventListener("click", () => doClose(false));
			return;
		}

		// Group gemstones by rarity
		const grouped = {};
		for (const gem of filteredGemstones) {
			const rarity = gem.rarity || "Unknown";
			if (!grouped[rarity]) grouped[rarity] = [];
			grouped[rarity].push(gem);
		}

		const rarityOrder = ["common", "uncommon", "rare", "very rare", "legendary"];
		const rarityDCs = {"common": 10, "uncommon": 15, "rare": 20, "very rare": 25, "legendary": 30};

		for (const rarity of rarityOrder) {
			const gems = grouped[rarity];
			if (!gems?.length) continue;

			const dc = rarityDCs[rarity] || "?";
			const minNeeded = hasGemEmpowerment ? Math.max(1, dc - gemEmpowermentMod) : "—";

			const section = e_({outer: `<div class="charsheet__empower-rarity"></div>`});
			section.append(e_({outer: `
				<div class="charsheet__empower-rarity-header ve-flex-v-center ve-small">
					<span class="badge charsheet__rarity-badge--${rarity.replace(/\s+/g, "-")}">${(/** @type {*} */ (rarity)).toTitleCase()}</span>
					<span class="ml-1">DC ${dc}</span>
					${hasGemEmpowerment ? `<span class="ve-muted ml-1">(need ${minNeeded}+)</span>` : ""}
				</div>
			`}));

			for (const gem of gems) {
				const renderedEntries = gem.entries?.length
					? Renderer.get().render({type: "entries", entries: gem.entries})
					: "";
				const gemLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, gem.name, gem.source);

				section.append(e_({outer: `
					<div class="charsheet__empower-option">
						<div class="ve-flex-v-center">
							<span class="charsheet__upgrade-name ve-flex-1">${gemLink}${gem.gemName ? ` <span class="ve-muted ve-small">(${gem.gemName})</span>` : ""}${gem.charges ? ` <span class="badge badge-info ve-small">${gem.charges}ch</span>` : ""}</span>
							<button type="button"
								class="ve-btn ve-btn-xs ve-btn-default charsheet__empower-force mr-1"
								data-gem-name="${gem.name}"
								data-gem-source="${gem.source}"
								title="Mark as already empowered — bypass the skill check (no roll, no destruction risk)">
								✓ Already empowered
							</button>
							<button type="button"
								class="ve-btn ve-btn-xs ${hasGemEmpowerment ? "ve-btn-success" : "ve-btn-default"} charsheet__empower-select"
								data-gem-name="${gem.name}"
								data-gem-source="${gem.source}"
								data-gem-dc="${gem.craftingDC || dc}"
								${!hasGemEmpowerment ? `disabled title="Requires Gem Empowerment skill"` : `title="DC ${gem.craftingDC || dc}"`}>
								⚡ Empower
							</button>
						</div>
						${renderedEntries ? `<details class="ve-small charsheet__empower-details"><summary class="ve-muted">Details</summary>${renderedEntries}</details>` : ""}
					</div>
				`}));
			}
			content.append(section);
		}

		modalInner.append(content);

		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-1">
			<button class="ve-btn ve-btn-default ve-btn-xs">Close</button>
		</div>`;
		modalInner.append(footer);
		footer.querySelector("button").addEventListener("click", () => doClose(false));

		// Event delegation
		content.addEventListener("click", async (e) => {
			// Override (#14): mark as already empowered, bypassing the skill check
			const forceBtn = e.target.closest(".charsheet__empower-force");
			if (forceBtn) {
				doClose(false);
				await this.forceEmpowerGemstone(forceBtn.dataset.gemName, forceBtn.dataset.gemSource, opts);
				return;
			}

			const empowerBtn = e.target.closest(".charsheet__empower-select");
			if (!empowerBtn) return;

			const gemName = empowerBtn.dataset.gemName;
			const gemSource = empowerBtn.dataset.gemSource;
			const dc = parseInt(empowerBtn.dataset.gemDc);

			doClose(false);
			await this._showCraftingRollModal(gemName, gemSource, dc, opts);
		});
	}

	/**
	 * Show the crafting roll modal for empowerment
	 * @param {string} gemName - Gemstone power name
	 * @param {string} gemSource - Gemstone source
	 * @param {number} dc - Crafting DC
	 * @param {object} [opts] - Options (fromInventoryGem, etc.)
	 */
	async _showCraftingRollModal (gemName, gemSource, dc, opts = {}) {
		const gemEmpowermentMod = this._state.getSkillMod("gemempowerment");
		const minRoll = Math.max(1, dc - gemEmpowermentMod);

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Empower: ${gemName}`,
			isMinHeight0: true,
		});

		const content = e_({outer: `<div class="charsheet__empower-roll"></div>`});

		content.append(e_({outer: `
			<div style="text-align: center;">
				<div class="charsheet__empower-roll-info">
					<span class="ve-small ve-muted">Gem Empowerment</span>
					<div class="charsheet__empower-roll-dc">+${gemEmpowermentMod} vs DC ${dc}</div>
					<span class="ve-small ve-muted">Need ${minRoll}+ on d20</span>
				</div>
				<div class="charsheet__empower-roll-warning ve-small">⚠ Failure destroys the gem</div>
				<button type="button" class="ve-btn ve-btn-sm ve-btn-success charsheet__empower-roll-btn">🎲 Roll Empowerment</button>
			</div>
			<div class="charsheet__empower-result" style="display: none;"></div>
		`}));

		modalInner.append(content);

		const rollBtn = content.querySelector(".charsheet__empower-roll-btn");
		const resultDiv = content.querySelector(".charsheet__empower-result");

		rollBtn.addEventListener("click", () => {
			const roll = Math.floor(Math.random() * 20) + 1;
			const total = roll + gemEmpowermentMod;
			const success = total >= dc;
			const nat20 = roll === 20;
			const nat1 = roll === 1;

			rollBtn.style.display = "none";

			if (nat20 || (success && !nat1)) {
				const gemEntity = this.getGemstoneUpgrades().find(
					g => g.name === gemName && g.source === gemSource,
				);

				this._applyEmpowermentToInventory(gemEntity, opts);

				resultDiv.style.display = "";
				resultDiv.innerHTML = `
					<div class="charsheet__empower-result--success" style="text-align: center;">
						<div class="charsheet__empower-result-title">${nat20 ? "🎯 Natural 20! " : "✨ "}Success!</div>
						<div class="ve-small ve-muted">Rolled ${roll} + ${gemEmpowermentMod} = <strong>${total}</strong> vs DC ${dc}</div>
						<div class="ve-small">${opts.fromInventoryGem ? "Gemstone empowered!" : "Added to inventory."} Socket it into equipment.</div>
					</div>
				`;

				const toastGemLabel = gemEntity?.gemName || opts.fromInventoryGem?.name || gemName;
				JqueryUtil.doToast({content: `Empowered ${toastGemLabel} with ${gemName}!${opts.fromInventoryGem ? "" : " Added to inventory."}`, type: "success"});
				this._page.saveCharacter();
				this._page._inventory?.render();
			} else {
				if (opts.fromInventoryGem) {
					this._state.removeItem(opts.fromInventoryGem.id);
					this._page.saveCharacter();
					this._page._inventory?.render();
				}

				resultDiv.style.display = "";
				resultDiv.innerHTML = `
					<div class="charsheet__empower-result--failure" style="text-align: center;">
						<div class="charsheet__empower-result-title">${nat1 ? "💥 Natural 1! " : "💔 "}Failed</div>
						<div class="ve-small ve-muted">Rolled ${roll} + ${gemEmpowermentMod} = <strong>${total}</strong> vs DC ${dc}</div>
						<div class="ve-small">The gemstone shatters and is destroyed.</div>
					</div>
				`;

				JqueryUtil.doToast({content: `Empowerment failed — ${opts.fromInventoryGem?.name || gemName} was destroyed.`, type: "danger"});
			}

			const closeBtn = e_({outer: `<div class="ve-flex-v-center ve-flex-h-center mt-1"><button class="ve-btn ve-btn-default ve-btn-xs">Close</button></div>`});
			resultDiv.append(closeBtn);
			closeBtn.querySelector("button").addEventListener("click", () => doClose(false));
		});
	}

	// ==========================================
	// Empowerment / Upgrade Application (shared core + override escape hatch)
	// ==========================================

	/**
	 * Build the persisted gemstone data object from a gemstone power entity.
	 * Shared by the crafting-roll success path, the "already empowered" override,
	 * and the custom-item creation flow.
	 * @param {object} gemEntity - The gemstone power entity (from getGemstoneUpgrades)
	 * @returns {object} Gemstone data suitable for socketGemstone / _gemstoneData
	 */
	static buildGemstoneData (gemEntity) {
		const descriptor = this.getGemstoneDescriptor(gemEntity);
		return {
			name: gemEntity.name,
			source: gemEntity.source,
			gemName: gemEntity.gemName,
			rarity: gemEntity.rarity,
			upgradeType: Array.isArray(gemEntity.upgradeType) ? gemEntity.upgradeType[0] : gemEntity.upgradeType,
			entries: gemEntity.entries,
			charges: descriptor?.resource?.max ?? gemEntity.charges ?? null,
			recharge: descriptor?.resource?.recharge ?? gemEntity.recharge ?? null,
			gemInstanceId: gemEntity.gemInstanceId || null,
			runtime: gemEntity.runtime ? MiscUtil.copyFast(gemEntity.runtime) : {},
		};
	}

	/**
	 * Apply a successful empowerment to inventory — either marking an existing base gem as
	 * empowered (opts.fromInventoryGem) or adding a fresh empowered gemstone item.
	 * Extracted so the normal crafting-roll success path AND the "already empowered" override
	 * share one implementation.
	 * @param {object} gemEntity - The gemstone power entity
	 * @param {object} [opts] - {fromInventoryGem?: {id, name, source}}
	 * @returns {{empoweredName: string, gemstoneData: object}|null}
	 */
	_applyEmpowermentToInventory (gemEntity, opts = {}) {
		if (!gemEntity) return null;

		const baseGemName = gemEntity.gemName || opts.fromInventoryGem?.name || "Gemstone";
		const empoweredName = `Empowered ${baseGemName} (${gemEntity.name})`;
		const gemstoneData = CharacterSheetUpgrades.buildGemstoneData(gemEntity);

		if (opts.fromInventoryGem) {
			this._state.markGemstoneEmpowered(opts.fromInventoryGem.id, gemstoneData, {
				name: empoweredName,
				rarity: gemEntity.rarity || "common",
				entries: gemEntity.entries || [],
			});
		} else {
			this._state.addItem({
				name: empoweredName,
				source: gemEntity.source,
				type: "$G",
				rarity: gemEntity.rarity || "common",
				entries: gemEntity.entries || [],
				weight: 0,
				_isEmpoweredGemstone: true,
				_gemstoneData: gemstoneData,
			});
		}

		return {empoweredName, gemstoneData};
	}

	/**
	 * Override / escape hatch (#14): mark a gemstone as already empowered WITHOUT the Gem
	 * Empowerment skill, crafting roll, or destruction risk. Supports migrating a character or
	 * recording gear empowered by someone else. The normal skill-check flow is left intact.
	 * @param {string} gemName - The gemstone power name
	 * @param {string} gemSource - The gemstone power source
	 * @param {object} [opts] - {fromInventoryGem?: {id, name, source}}
	 * @returns {Promise<boolean>} True if applied
	 */
	async forceEmpowerGemstone (gemName, gemSource, opts = {}) {
		const gemEntity = this.getGemstoneUpgrades().find(
			g => g.name === gemName && g.source === gemSource,
		);
		if (!gemEntity) {
			JqueryUtil.doToast({content: "Gemstone power not found.", type: "danger"});
			return false;
		}

		const ok = await InputUiUtil.pGetUserBoolean({
			title: "Mark as Already Empowered?",
			htmlDescription: `This bypasses the <strong>Gem Empowerment</strong> skill check and crafting roll — no roll is made and the gem is <strong>not</strong> at risk of being destroyed.<br><br>Use this when migrating a character, or recording gear that was empowered by someone else.`,
			textYes: "Mark Empowered",
			textNo: "Cancel",
		});
		if (!ok) return false;

		const applied = this._applyEmpowermentToInventory(gemEntity, opts);
		if (!applied) {
			JqueryUtil.doToast({content: "Could not empower gemstone.", type: "danger"});
			return false;
		}

		const toastGemLabel = gemEntity.gemName || opts.fromInventoryGem?.name || gemName;
		JqueryUtil.doToast({content: `Marked ${toastGemLabel} as empowered (${gemName}) — requirements bypassed.`, type: "success"});
		this._page.saveCharacter();
		this._page._inventory?.render();
		return true;
	}

	/**
	 * Force-apply a set of upgrades and/or socket a gemstone onto an existing item, bypassing
	 * cost and prerequisites. Used by the custom-item creation flow (#15) and as the shared core
	 * for any "already owned" application. Upgrades are recorded with costPaid 0.
	 * @param {string} itemId - Target inventory item id
	 * @param {object} opts
	 * @param {Array} [opts.upgrades] - Upgrade entities to apply
	 * @param {object} [opts.gemstone] - A gemstone power entity to socket (treated as empowered)
	 * @returns {{appliedUpgrades: number, socketed: boolean}}
	 */
	applyUpgradesToItem (itemId, {upgrades = [], gemstone = null} = {}) {
		let appliedUpgrades = 0;
		let socketed = false;

		for (const upgrade of upgrades) {
			if (!upgrade) continue;
			const res = this._state.applyItemUpgrade(itemId, upgrade, 0);
			if (res?.success) appliedUpgrades++;
		}

		if (gemstone) {
			const gemstoneData = CharacterSheetUpgrades.buildGemstoneData(gemstone);
			const res = this._state.socketGemstone(itemId, gemstoneData);
			socketed = !!res?.success;
		}

		return {appliedUpgrades, socketed};
	}

	// ==========================================
	// Gemstone Socket Modal
	// ==========================================
	/**
	 * Show the gemstone socket picker for an item
	 * @param {string} itemId - The target item ID
	 */
	async showGemstoneSocketModal (itemId) {
		const items = this._state.getItems();
		const item = items.find(i => i.id === itemId);
		if (!item) return;

		// Find empowered gemstones in inventory
		const empoweredGems = items.filter(i =>
			i._isEmpoweredGemstone && i._gemstoneData,
		);

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Socket Gemstone: ${item.name}`,
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__socket-modal"></div>`});

		if (!empoweredGems.length) {
			content.append(e_({outer: `
				<p class="ve-muted">You don't have any empowered gemstones in your inventory. Use the "Empower Gemstone" action to create one first.</p>
			`}));
		} else {
			content.append(e_({outer: `<h5 class="mb-2">Available Empowered Gemstones</h5>`}));

			for (const gem of empoweredGems) {
				const gemData = gem._gemstoneData;
				const chargeStr = gemData.charges ? `${gemData.charges} charges` : "";
				const renderedEntries = gemData.entries?.length
					? Renderer.get().render({type: "entries", entries: gemData.entries})
					: "";
				const gemLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, gemData.name, gemData.source);

				content.append(e_({outer: `
					<div class="charsheet__socket-option mb-2 p-2">
						<div class="ve-flex-v-center mb-1">
							<div class="ve-flex-1">
								<span class="charsheet__upgrade-name" style="font-weight: 600;">${gemLink}</span>
								${chargeStr ? `<span class="badge badge-info ve-small ml-2">${chargeStr}</span>` : ""}
							</div>
							<button type="button" class="ve-btn ve-btn-sm ve-btn-success charsheet__socket-apply"
								data-gem-id="${gem.id}" title="Socket into ${item.name}">
								<span class="glyphicon glyphicon-log-in"></span> Socket
							</button>
						</div>
						${renderedEntries ? `<div class="ve-small mt-1 ve-muted">${renderedEntries}</div>` : ""}
					</div>
				`}));
			}
		}

		modalInner.append(content);

		// Footer
		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(footer);
		footer.querySelector("button").addEventListener("click", () => doClose(false));

		// Event delegation
		content.addEventListener("click", (e) => {
			const socketBtn = e.target.closest(".charsheet__socket-apply");
			if (!socketBtn) return;

			const gemId = socketBtn.dataset.gemId;
			const gem = items.find(i => i.id === gemId);
			if (!gem?._gemstoneData) return;

			const result = this._state.socketGemstone(itemId, gem._gemstoneData);
			if (!result.success) {
				JqueryUtil.doToast({content: result.error, type: "danger"});
				return;
			}

			// Remove the empowered gemstone from inventory
			this._state.removeItem(gemId);

			JqueryUtil.doToast({content: `Socketed "${gem.name}" into ${item.name}`, type: "success"});
			this._page.saveCharacter();
			doClose(true);
			this._page._inventory?.render();
		});
	}

	async showGemstoneChaliceModal (itemId, gemInstanceId) {
		const item = this._state.getItems().find(it => it.id === itemId);
		if (!item) return;
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Chalice Spell Storage",
			isMinHeight0: true,
			isWidth100: true,
		});

		const render = () => {
			const storage = this._state.getGemstoneSpellStorage(gemInstanceId);
			if (!storage) {
				modalInner.replaceChildren(e_({outer: `<p class="text-danger">Chalice storage is unavailable.</p>`}));
				return;
			}
			const slots = Array.from({length: storage.capacity}, (_, ix) => `<span class="charsheet__chalice-capacity-slot ${ix < storage.used ? "is-filled" : ""}" aria-hidden="true"></span>`).join("");
			const rows = storage.storedSpells.length
				? storage.storedSpells.map(spell => `
					<div class="charsheet__chalice-spell" data-spell-id="${spell.id}">
						<div class="ve-flex-1">
							<strong>${spell.name}</strong>
							<div class="ve-small ve-muted">Level ${spell.level} · ${spell.casterName || "Unknown caster"}${spell.saveDc != null ? ` · DC ${spell.saveDc}` : ""}${spell.spellAttackBonus != null ? ` · ${spell.spellAttackBonus >= 0 ? "+" : ""}${spell.spellAttackBonus} attack` : ""}</div>
						</div>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-primary charsheet__chalice-cast" ${storage.active ? "" : "disabled"}>Cast</button>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-default charsheet__chalice-remove" title="Remove stored spell">Remove</button>
					</div>
				`).join("")
				: `<p class="ve-muted mb-0">No spells are stored.</p>`;

			const content = e_({outer: `
				<div class="charsheet__chalice">
					<div class="charsheet__chalice-status">
						<div><strong>Chalice · Alexandrite</strong><div class="ve-small ve-muted">Socketed in ${item.name}</div></div>
						<div class="charsheet__chalice-capacity" role="img" aria-label="${storage.used} of ${storage.capacity} spell levels used">${slots}<span>${storage.used}/${storage.capacity}</span></div>
					</div>
					${storage.active ? "" : `<p class="ve-small text-warning">Equip and attune the host item to cast stored spells. Spells can still be stored by another caster.</p>`}
					<div class="charsheet__chalice-layout">
						<section aria-label="Stored spells">
							<h5>Stored Spells</h5>
							<div class="charsheet__chalice-spells">${rows}</div>
						</section>
						<section aria-label="Store a spell">
							<h5>Store a Spell</h5>
							<form class="charsheet__chalice-form">
								<label>Spell name<input class="form-control input-sm" name="name" required></label>
								<label>Spell level<select class="form-control input-sm" name="level"><option value="1">1st</option><option value="2">2nd</option></select></label>
								<label>Caster name<input class="form-control input-sm" name="casterName" value="${this._state.getName?.() || ""}"></label>
								<label>Save DC<input class="form-control input-sm" name="saveDc" type="number" min="1"></label>
								<label>Spell attack<input class="form-control input-sm" name="spellAttackBonus" type="number"></label>
								<label>Casting ability<select class="form-control input-sm" name="castingAbility"><option value="">—</option>${["int", "wis", "cha"].map(ability => `<option value="${ability}">${ability.toUpperCase()}</option>`).join("")}</select></label>
								<p class="charsheet__chalice-error text-danger ve-small" role="alert"></p>
								<button type="submit" class="ve-btn ve-btn-primary" ${storage.remaining <= 0 ? "disabled" : ""}>Store Spell</button>
							</form>
						</section>
					</div>
					<div class="ve-flex-v-center ve-flex-h-right mt-3"><button type="button" class="ve-btn ve-btn-default charsheet__chalice-close">Close</button></div>
				</div>
			`});
			modalInner.replaceChildren(content);

			content.querySelector(".charsheet__chalice-close").addEventListener("click", () => doClose(false));
			content.querySelector(".charsheet__chalice-form").addEventListener("submit", evt => {
				evt.preventDefault();
				const formData = new FormData(evt.currentTarget);
				const result = this._state.storeGemstoneSpell(gemInstanceId, {
					name: formData.get("name"),
					level: Number(formData.get("level")),
					casterName: formData.get("casterName"),
					saveDc: formData.get("saveDc") || null,
					spellAttackBonus: formData.get("spellAttackBonus") || null,
					castingAbility: formData.get("castingAbility") || null,
				});
				if (!result.success) {
					content.querySelector(".charsheet__chalice-error").textContent = result.error;
					return;
				}
				this._page.saveCharacter();
				render();
			});
			content.addEventListener("click", evt => {
				const row = evt.target.closest(".charsheet__chalice-spell");
				if (!row) return;
				if (evt.target.closest(".charsheet__chalice-cast")) {
					const result = this._state.castGemstoneStoredSpell(gemInstanceId, row.dataset.spellId);
					if (!result.success) {
						JqueryUtil.doToast({content: result.error, type: "danger"});
						return;
					}
					JqueryUtil.doToast({content: `Cast ${result.spell.name} using ${result.spell.casterName}'s stored statistics.`, type: "success"});
					this._page.saveCharacter();
					render();
				}
				if (evt.target.closest(".charsheet__chalice-remove")) {
					if (!confirm(`Remove ${row.querySelector("strong")?.textContent || "this spell"} from the Chalice?`)) return;
					this._state.removeGemstoneStoredSpell(gemInstanceId, row.dataset.spellId);
					this._page.saveCharacter();
					render();
				}
			});
		};

		render();
	}

	// ==========================================
	// Mechanical Effect Application
	// ==========================================

	/**
	 * Get armor-specific upgrade effects (flags for passive/reference effects)
	 * @param {object} item - Armor item data (with appliedUpgrades array)
	 * @returns {object} Flags for each armor upgrade type
	 */
	static getArmorUpgradeEffects (item) {
		return getAggregatedArmorUpgradeEffects(item);
	}

	/**
	 * Get human-readable notes for armor upgrade effects
	 * @param {object} item - Inventory item with appliedUpgrades
	 * @returns {Array<{label: string, description: string, type: string}>} Display-ready notes
	 */
	static getArmorUpgradeNotes (item) {
		const flags = this.getArmorUpgradeEffects(item);
		const notes = [];

		if (flags.muffled) notes.push({label: "Muffled", description: "No disadvantage on Stealth checks", type: "passive"});
		if (flags.reinforced) notes.push({label: "Reinforced", description: "Reduce critical damage from nonmagical attacks by 3", type: "passive"});
		if (flags.armorProofingTier >= 1) {
			const thresholds = {1: "6", 2: "7", 3: "8"};
			const types = {1: "slashing", 2: "slashing and piercing", 3: "slashing, piercing, and bludgeoning"};
			notes.push({
				label: `Armor Proofing (Tier ${flags.armorProofingTier})`,
				description: `Ignore ${thresholds[flags.armorProofingTier]} or less nonmagical ${types[flags.armorProofingTier]} damage`,
				type: "passive",
			});
		}
		if (flags.spiked) notes.push({label: "Spiked", description: "Attackers take 1d4 piercing (unarmed/natural weapons)", type: "reactive"});
		if (flags.breathable) notes.push({label: "Breathable", description: "Advantage on exhaustion saves vs extreme heat", type: "passive"});
		if (flags.insulated) notes.push({label: "Insulated", description: "Counts as cold weather gear", type: "passive"});
		if (flags.climbingHarness) notes.push({label: "Climbing Harness", description: "Advantage on Athletics to climb with rope", type: "passive"});
		if (flags.lockingJoints) notes.push({label: "Locking Joints", description: "Advantage on Athletics vs shove attempts", type: "passive"});
		if (flags.quickRelease) notes.push({label: "Quick-release Clasps", description: "Doff armor as an action", type: "passive"});
		if (flags.decorated) notes.push({label: "Decorated", description: "Usable as spellcasting focus (Cleric/Paladin)", type: "passive"});
		if (flags.runic) notes.push({label: "Runic", description: "Can be imbued with rune magic", type: "passive"});
		if (flags.burnished) notes.push({label: "Burnished", description: "Advantage on Charisma checks vs certain humanoids (24h or until combat)", type: "passive"});
		if (flags.camouflaged) notes.push({label: "Camouflaged", description: "Advantage on Stealth checks if the camouflage fits the terrain", type: "passive"});
		if (flags.formFitted) notes.push({label: "Form Fitted", description: "+3 bonus to Acrobatics checks", type: "passive"});

		return notes;
	}

	/**
	 * Get the total bonus adjustments from applied upgrades on an item
	 * @param {object} item - Inventory item data (with appliedUpgrades array)
	 * @returns {object} Bonus adjustments including numeric bonuses, tags, notes, and extra damage
	 */
	static getUpgradeEffects (item) {
		return getAggregatedUpgradeEffects(item);
	}

	/**
	 * Get all socketed gemstone effects on an item
	 * @param {object} item - Inventory item with socketedGemstones
	 * @returns {Array} Array of effect description objects
	 */
	static getGemstoneEffects (item) {
		if (!item?.socketedGemstones?.length) return [];
		return item.socketedGemstones.map(gem => {
			const descriptor = this.getGemstoneDescriptor(gem);
			return {
				...MiscUtil.copyFast(descriptor || {}),
				name: gem.name,
				gemName: gem.gemName,
				source: gem.source,
				gemInstanceId: gem.gemInstanceId,
				entries: gem.entries || [],
				runtime: gem.runtime || {},
			};
		});
	}

	static getGemstoneDescriptor (gem) {
		return getGemstoneDescriptor(gem);
	}

	static getGemstoneRegistryNames () {
		return getGemstoneRegistryNames();
	}

	/**
	 * Get a concise summary string for a gemstone's mechanical effect
	 * @param {object} gem - Socketed gemstone data
	 * @returns {string} One-line summary of the gemstone's effect
	 */
	static getGemstoneSummary (gem) {
		if (!gem?.name) return "";
		return this.getGemstoneDescriptor(gem)?.summary
			|| (gem.entries?.length ? Renderer.stripTags(gem.entries[0]?.toString?.() || "") : "");
	}

	/**
	 * Detect gemstones that have passive mechanical effects on calculations
	 * @param {object} gem - Socketed gemstone data
	 * @returns {object} Passive effects: {speedBonus, notes[]}
	 */
	static getGemstonePassiveEffects (gem) {
		const effects = {speedBonus: 0, flightSpeed: 0, notes: []};
		if (!gem?.name) return effects;
		const descriptor = this.getGemstoneDescriptor(gem);
		if (!descriptor) return effects;
		for (const effect of descriptor.effects || []) {
			if (effect.type === "speedBonus" && effect.speed === "walk") effects.speedBonus += Number(effect.value) || 0;
			if (effect.type === "flightSpeedMultiplier") effects.flightSpeed = -1;
		}
		effects.notes.push(`${gem.name}: ${descriptor.summary}`);

		return effects;
	}

	/**
	 * Increase a damage die by one step (e.g., "1d6" -> "1d8")
	 * @param {string} damageDie - e.g. "1d6", "2d6", "1d10"
	 * @param {number} steps - Number of steps to increase
	 * @returns {string} The increased die string
	 */
	static increaseDamageDie (damageDie, steps = 1) {
		if (!damageDie) return damageDie;
		const dieOrder = [4, 6, 8, 10, 12];
		const match = damageDie.match(/(\d+)d(\d+)/);
		if (!match) return damageDie;

		const numDice = parseInt(match[1]);
		let dieSize = parseInt(match[2]);
		const idx = dieOrder.indexOf(dieSize);
		if (idx === -1) return damageDie;

		const newIdx = Math.min(idx + steps, dieOrder.length - 1);
		return `${numDice}d${dieOrder[newIdx]}`;
	}
}

globalThis.CharacterSheetUpgrades = CharacterSheetUpgrades;
export {CharacterSheetUpgrades};
