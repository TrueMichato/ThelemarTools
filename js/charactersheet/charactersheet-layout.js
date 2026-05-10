/**
 * Character Sheet Layout Manager
 * Handles drag-and-drop reordering of sections within tabs
 * Persists layout preferences per character per tab
 */
class CharacterSheetLayout {
	constructor (page) {
		this._page = page;
		this._state = page.getState();

		// Edit mode state
		this._isEditMode = false;

		// Drag state
		this._draggedElement = null;
		this._draggedIndex = -1;
		this._placeholder = null;
		this._currentContainer = null;

		// Track which containers we've initialized
		this._initializedContainers = new Set();

		// Default section orders per tab (for reset functionality)
		this._defaultOrders = {};

		this._init();
	}

	_init () {
		this._initEventListeners();
		// Capture default orders after DOM is ready
		this._captureDefaultOrders();
	}

	/**
	 * Capture the initial DOM order of sections in each tab as the default
	 */
	_captureDefaultOrders () {
		const tabs = this._getTabContainers();

		for (const {tabId, containers} of tabs) {
			if (!this._defaultOrders[tabId]) {
				this._defaultOrders[tabId] = {};
			}

			for (const container of containers) {
				const containerId = this._getContainerId(container);
				const sections = this._getSectionsInContainer(container);
				const sectionIds = sections.map(s => this._getSectionId(s));

				this._defaultOrders[tabId][containerId] = sectionIds;
			}
		}
	}

	/**
	 * Get all tab containers with their sections
	 * Returns an array of {tabId, containers[]} where each container holds sections
	 */
	_getTabContainers () {
		const result = [];

		// Overview tab has 3 columns
		const overviewTab = document.getElementById("charsheet-tab-overview");
		if (overviewTab) {
			const columns = overviewTab.querySelectorAll(".charsheet__col-left, .charsheet__col-center, .charsheet__col-right");
			result.push({
				tabId: "overview",
				containers: Array.from(columns),
			});
		}

		// Combat tab has 2 columns
		const combatTab = document.getElementById("charsheet-tab-combat");
		if (combatTab) {
			const columns = combatTab.querySelectorAll(".charsheet__col-half");
			result.push({
				tabId: "combat",
				containers: Array.from(columns),
			});
		}

		// Spells tab - main container
		const spellsTab = document.getElementById("charsheet-tab-spells");
		if (spellsTab) {
			const container = spellsTab.querySelector(".charsheet__spells-container");
			if (container) {
				result.push({
					tabId: "spells",
					containers: [container],
				});
			}
		}

		// Inventory tab has 2 columns
		const inventoryTab = document.getElementById("charsheet-tab-inventory");
		if (inventoryTab) {
			const columns = inventoryTab.querySelectorAll(".ve-flex-col");
			result.push({
				tabId: "inventory",
				containers: Array.from(columns),
			});
		}

		// Features tab - main container
		const featuresTab = document.getElementById("charsheet-tab-features");
		if (featuresTab) {
			const container = featuresTab.querySelector(".charsheet__features-container");
			if (container) {
				result.push({
					tabId: "features",
					containers: [container],
				});
			}
		}

		// Notes tab has 2 columns
		const notesTab = document.getElementById("charsheet-tab-notes");
		if (notesTab) {
			const columns = notesTab.querySelectorAll(".charsheet__col-half");
			result.push({
				tabId: "notes",
				containers: Array.from(columns),
			});
		}

		return result;
	}

	/**
	 * Get a unique identifier for a container (column)
	 */
	_getContainerId (container) {
		// Try to get ID from container or generate based on parent and position
		if (container.id) return container.id;

		const parent = container.closest(".tab-pane");
		const tabId = parent ? parent.id : "unknown";
		const siblings = container.parentElement?.children;
		const index = siblings ? Array.from(siblings).indexOf(container) : 0;

		// Use class-based identification for columns
		if (container.classList.contains("charsheet__col-left")) return `${tabId}-col-left`;
		if (container.classList.contains("charsheet__col-center")) return `${tabId}-col-center`;
		if (container.classList.contains("charsheet__col-right")) return `${tabId}-col-right`;
		if (container.classList.contains("charsheet__col-half")) return `${tabId}-col-half-${index}`;

		return `${tabId}-container-${index}`;
	}

	/**
	 * Get all section elements within a container
	 */
	_getSectionsInContainer (container) {
		// Only get direct child sections, not nested ones
		return Array.from(container.querySelectorAll(":scope > .charsheet__section"));
	}

	/**
	 * Get or generate a unique ID for a section
	 */
	_getSectionId (section) {
		// Check for existing data-section-id
		if (section.dataset.sectionId) return section.dataset.sectionId;

		// Try to identify by section title
		const titleEl = section.querySelector(".charsheet__section-title");
		if (titleEl) {
			// Get text content, clean it up
			const text = titleEl.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
			if (text) {
				section.dataset.sectionId = text;
				return text;
			}
		}

		// Try to identify by ID of a child element
		const idChild = section.querySelector("[id]");
		if (idChild) {
			section.dataset.sectionId = `section-${idChild.id}`;
			return `section-${idChild.id}`;
		}

		// Fallback to a class-based identifier
		const classes = Array.from(section.classList)
			.filter(c => c.startsWith("charsheet__section--"))
			.map(c => c.replace("charsheet__section--", ""));
		if (classes.length) {
			section.dataset.sectionId = `section-${classes.join("-")}`;
			return `section-${classes.join("-")}`;
		}

		// Last resort: position-based
		const siblings = Array.from(section.parentElement?.children || [])
			.filter(el => el.classList.contains("charsheet__section"));
		const index = siblings.indexOf(section);
		section.dataset.sectionId = `section-unnamed-${index}`;
		return `section-unnamed-${index}`;
	}

	_initEventListeners () {
		// Listen for tab changes to apply saved layout
		document.addEventListener("shown.bs.tab", (e) => {
			const target = /** @type {*} */ (e.target);
			if (!target.matches("a[data-toggle='tab']")) return;
			const tabId = target.getAttribute("href").replace("#charsheet-tab-", "");
			this._applySavedLayoutForTab(tabId);
		});
	}

	/**
	 * Toggle edit mode on/off
	 */
	toggleEditMode () {
		this._isEditMode = !this._isEditMode;

		if (this._isEditMode) {
			this._enableEditMode();
		} else {
			this._disableEditMode();
		}

		return this._isEditMode;
	}

	/**
	 * Check if edit mode is currently active
	 */
	isEditMode () {
		return this._isEditMode;
	}

	/**
	 * Enable edit mode - show drag handles, add visual indicators
	 */
	_enableEditMode () {
		document.body.classList.add("charsheet--layout-editing");

		// Initialize drag/drop for all visible containers
		const tabs = this._getTabContainers();
		for (const {containers} of tabs) {
			for (const container of containers) {
				this._initDragDropForContainer(container);
			}
		}

		// Show notification
		JqueryUtil.doToast({type: "info", content: "Layout edit mode enabled. Drag sections to reorder."});
	}

	/**
	 * Disable edit mode - remove drag handles, save layout
	 */
	_disableEditMode () {
		document.body.classList.remove("charsheet--layout-editing");

		// Remove drag attributes from all sections
		const sections = document.querySelectorAll(".charsheet__section");
		sections.forEach(section => {
			section.removeAttribute("draggable");
			section.classList.remove("charsheet__section--draggable");
		});

		// Save current layout
		this._saveCurrentLayout();

		JqueryUtil.doToast({type: "success", content: "Layout saved."});
	}

	/**
	 * Initialize drag/drop for a specific container
	 */
	_initDragDropForContainer (container) {
		const containerId = this._getContainerId(container);

		// Skip if already initialized
		if (this._initializedContainers.has(containerId)) return;

		const sections = this._getSectionsInContainer(container);

		sections.forEach((section, index) => {
			// Make draggable
			section.setAttribute("draggable", "true");
			section.classList.add("charsheet__section--draggable");

			// Add drag handle if not present
			if (!section.querySelector(".charsheet__section-drag-handle")) {
				const handle = document.createElement("div");
				handle.className = "charsheet__section-drag-handle";
				handle.innerHTML = "<span class=\"charsheet__drag-icon\">⋮⋮</span>";
				handle.title = "Drag to reorder";
				section.insertBefore(handle, section.firstChild);
			}

			// Event listeners
			section.addEventListener("dragstart", (e) => this._onDragStart(e, section, container));
			section.addEventListener("dragend", (e) => this._onDragEnd(e));
			section.addEventListener("dragover", (e) => this._onDragOver(e, section, container));
			section.addEventListener("dragleave", (e) => this._onDragLeave(e, section));
			section.addEventListener("drop", (e) => this._onDrop(e, section, container));
		});

		// Make container a drop zone
		container.addEventListener("dragover", (e) => this._onContainerDragOver(e, container));
		container.addEventListener("drop", (e) => this._onContainerDrop(e, container));

		this._initializedContainers.add(containerId);
	}

	_onDragStart (e, section, container) {
		if (!this._isEditMode) {
			e.preventDefault();
			return;
		}

		this._draggedElement = section;
		this._currentContainer = container;
		this._draggedIndex = Array.from(container.children)
			.filter(el => el.classList.contains("charsheet__section"))
			.indexOf(section);

		// Set drag data
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", this._getSectionId(section));

		// Add visual feedback
		requestAnimationFrame(() => {
			section.classList.add("charsheet__section--dragging");
		});

		// Create placeholder
		this._createPlaceholder(section);
	}

	_onDragEnd (e) {
		if (this._draggedElement) {
			this._draggedElement.classList.remove("charsheet__section--dragging");
		}

		// Remove placeholder
		this._removePlaceholder();

		// Remove all drag-over indicators
		document.querySelectorAll(".charsheet__section--drag-over").forEach(el => {
			el.classList.remove("charsheet__section--drag-over");
		});

		this._draggedElement = null;
		this._draggedIndex = -1;
		this._currentContainer = null;
	}

	_onDragOver (e, section, container) {
		if (!this._isEditMode || !this._draggedElement || this._draggedElement === section) {
			return;
		}

		e.preventDefault();
		e.dataTransfer.dropEffect = "move";

		// Get mouse position relative to section
		const rect = section.getBoundingClientRect();
		const midpoint = rect.top + rect.height / 2;
		const isAbove = e.clientY < midpoint;

		// Remove existing indicators
		section.classList.remove("charsheet__section--drag-over-top", "charsheet__section--drag-over-bottom");

		// Add appropriate indicator
		if (isAbove) {
			section.classList.add("charsheet__section--drag-over-top");
		} else {
			section.classList.add("charsheet__section--drag-over-bottom");
		}

		section.classList.add("charsheet__section--drag-over");
	}

	_onDragLeave (e, section) {
		// Only remove if actually leaving the element (not entering a child)
		if (!section.contains(e.relatedTarget)) {
			section.classList.remove(
				"charsheet__section--drag-over",
				"charsheet__section--drag-over-top",
				"charsheet__section--drag-over-bottom",
			);
		}
	}

	_onDrop (e, targetSection, container) {
		if (!this._isEditMode || !this._draggedElement || this._draggedElement === targetSection) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();

		// Determine insert position
		const rect = targetSection.getBoundingClientRect();
		const midpoint = rect.top + rect.height / 2;
		const insertBefore = e.clientY < midpoint;

		// Perform the move
		if (insertBefore) {
			container.insertBefore(this._draggedElement, targetSection);
		} else {
			container.insertBefore(this._draggedElement, targetSection.nextSibling);
		}

		// Clean up indicators
		targetSection.classList.remove(
			"charsheet__section--drag-over",
			"charsheet__section--drag-over-top",
			"charsheet__section--drag-over-bottom",
		);

		// Save layout immediately
		this._saveCurrentLayout();
	}

	_onContainerDragOver (e, container) {
		if (!this._isEditMode || !this._draggedElement) return;

		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
	}

	_onContainerDrop (e, container) {
		if (!this._isEditMode || !this._draggedElement) return;

		// Only handle if dropped on container itself (not on a section)
		if (e.target !== container && e.target.closest(".charsheet__section")) {
			return;
		}

		e.preventDefault();

		// Append to end of container
		container.appendChild(this._draggedElement);

		// Save layout
		this._saveCurrentLayout();
	}

	_createPlaceholder (element) {
		this._placeholder = document.createElement("div");
		this._placeholder.className = "charsheet__section-placeholder";
		this._placeholder.style.height = `${element.offsetHeight}px`;
	}

	_removePlaceholder () {
		if (this._placeholder && this._placeholder.parentNode) {
			this._placeholder.parentNode.removeChild(this._placeholder);
		}
		this._placeholder = null;
	}

	/**
	 * Save the current layout for all tabs
	 */
	_saveCurrentLayout () {
		const layout = {};
		const tabs = this._getTabContainers();

		for (const {tabId, containers} of tabs) {
			layout[tabId] = {};

			for (const container of containers) {
				const containerId = this._getContainerId(container);
				const sections = this._getSectionsInContainer(container);
				const sectionIds = sections.map(s => this._getSectionId(s));

				layout[tabId][containerId] = sectionIds;
			}
		}

		// Save to state
		this._state.setSectionLayout(layout);
	}

	/**
	 * Apply saved layout for a specific tab
	 */
	_applySavedLayoutForTab (tabId) {
		const savedLayout = this._state.getSectionLayout();
		if (!savedLayout || !savedLayout[tabId]) return;

		const tabs = this._getTabContainers();
		const tabData = tabs.find(t => t.tabId === tabId);
		if (!tabData) return;

		for (const container of tabData.containers) {
			const containerId = this._getContainerId(container);
			const savedOrder = savedLayout[tabId][containerId];

			if (!savedOrder || !savedOrder.length) continue;

			this._applySectionOrder(container, savedOrder);
		}
	}

	/**
	 * Apply a specific section order to a container
	 */
	_applySectionOrder (container, order) {
		const sections = this._getSectionsInContainer(container);
		const sectionMap = new Map();

		// Build map of section ID to element
		sections.forEach(section => {
			const id = this._getSectionId(section);
			sectionMap.set(id, section);
		});

		// Reorder based on saved order
		let lastInserted = null;

		for (const sectionId of order) {
			const section = sectionMap.get(sectionId);
			if (!section) continue;

			if (lastInserted) {
				// Insert after last inserted
				lastInserted.after(section);
			} else {
				// Insert at beginning of container
				const firstChild = container.querySelector(".charsheet__section");
				if (firstChild && firstChild !== section) {
					container.insertBefore(section, firstChild);
				}
			}

			lastInserted = section;
		}
	}

	/**
	 * Apply saved layout to all tabs (call on initial load)
	 */
	applySavedLayout () {
		// Do NOT recapture defaults here - they were captured in _init() before any modifications
		// If we recapture here, we might capture already-modified layout as "default"

		const savedLayout = this._state.getSectionLayout();
		if (!savedLayout) return;

		const tabs = this._getTabContainers();

		for (const {tabId, containers} of tabs) {
			if (!savedLayout[tabId]) continue;

			for (const container of containers) {
				const containerId = this._getContainerId(container);
				const savedOrder = savedLayout[tabId]?.[containerId];

				if (savedOrder && savedOrder.length) {
					this._applySectionOrder(container, savedOrder);
				}
			}
		}
	}

	/**
	 * Reset layout to default for the current tab or all tabs
	 */
	resetLayout (allTabs = false) {
		if (allTabs) {
			// Reset all tabs
			for (const tabId of Object.keys(this._defaultOrders)) {
				this._resetTabLayout(tabId);
			}

			// Clear saved layout
			this._state.setSectionLayout({});

			JqueryUtil.doToast({type: "success", content: "All layouts reset to default."});
		} else {
			// Reset current tab only
			const activeTab = document.querySelector(".tab-pane.ve-active, .tab-pane.in");
			if (!activeTab) return;

			const tabId = activeTab.id.replace("charsheet-tab-", "");
			this._resetTabLayout(tabId);

			// Remove this tab from saved layout
			const savedLayout = this._state.getSectionLayout() || {};
			delete savedLayout[tabId];
			this._state.setSectionLayout(savedLayout);

			JqueryUtil.doToast({type: "success", content: "Layout reset to default for this tab."});
		}
	}

	/**
	 * Reset a specific tab's layout to default
	 */
	_resetTabLayout (tabId) {
		const defaultOrder = this._defaultOrders[tabId];
		if (!defaultOrder) return;

		const tabs = this._getTabContainers();
		const tabData = tabs.find(t => t.tabId === tabId);
		if (!tabData) return;

		for (const container of tabData.containers) {
			const containerId = this._getContainerId(container);
			const defaultSectionOrder = defaultOrder[containerId];

			if (defaultSectionOrder && defaultSectionOrder.length) {
				this._applySectionOrder(container, defaultSectionOrder);
			}
		}
	}
}

// Make available globally
globalThis.CharacterSheetLayout = CharacterSheetLayout;

export {CharacterSheetLayout};
