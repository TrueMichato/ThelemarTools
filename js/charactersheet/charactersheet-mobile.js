/**
 * Character Sheet — Mobile Interaction Module
 * Provides touch-optimized interactions for mobile devices:
 * - Mobile detection
 * - Swipe navigation between tabs (with scrollable-container exclusion)
 * - Long-press context menus (replaces right-click)
 * - Roll modifier toolbar (replaces Shift+click / Ctrl+click)
 * - Floating Action Button (FAB) with backdrop
 * - Collapsible sections with smooth animation
 * - Haptic feedback
 * - iOS safe-area and viewport fixes
 * - Scroll-position-preserving modal scroll lock
 */
class CharacterSheetMobile {
	constructor (page) {
		// Resolved lazily by the `_page` getter below, never captured here. This
		// module is constructed on `DOMContentLoaded`, but the page controller is
		// only published to `window` once its async `pInit()` resolves — seconds
		// later — so anything captured at construction time is always `undefined`.
		// Only an explicitly-injected page (tests) is stored.
		this._pageOverride = page || null;

		// State
		this._isMobile = false;
		this._swipeStartX = 0;
		this._swipeStartY = 0;
		this._swipeThreshold = 60;
		this._longPressTimer = null;
		this._longPressDuration = 500;
		this._longPressTarget = null;
		this._longPressFired = false;
		this._fabOpen = false;
		this._contextMenuVisible = false;
		this._tabSheetOpen = false;
		this._scrollYBeforeLock = 0;

		// Guard against duplicate initialization on resize
		this._mobileInitialized = false;

		// Elements (created lazily)
		this._elContextMenu = null;
		this._elContextMenuBackdrop = null;
		this._elFab = null;
		this._elFabBackdrop = null;
		this._elTabMoreItem = null;
		this._elTabSheet = null;
		this._tabObserver = null;
		this._elStatusStrip = null;
		this._elStatusTray = null;
		this._statusObserver = null;
		this._statusModels = null;
		this._statusSyncQueued = false;
		this._boundSyncStatus = null;

		// Bound handlers for cleanup
		this._boundOnResize = this._onResize.bind(this);
		this._boundLongPressStart = this._onLongPressStart.bind(this);
		this._boundLongPressMove = this._onLongPressMove.bind(this);
		this._boundLongPressEnd = this._onLongPressEnd.bind(this);

		this._init();
	}

	/**
	 * The character-sheet page controller, resolved at use time rather than at
	 * construction time.
	 *
	 * The mobile module is constructed on `DOMContentLoaded`, but `window.charSheet`
	 * is only assigned after the page's async `pInit()` resolves. Binding eagerly
	 * therefore pins `undefined` forever, which silently disabled every feature
	 * routed through the page controller (most visibly, spell upcasting). Reading
	 * through a getter makes the reference immune to initialization order.
	 *
	 * @returns {*} The page controller, or `null` before the page has initialized.
	 */
	get _page () {
		return this._pageOverride || (/** @type {*} */ (globalThis)).charSheet || null;
	}

	// =========================================================================
	// Detection
	// =========================================================================

	static isMobile () {
		return (
			// A phone in landscape is 844x390 — wider than 768, but shorter than
			// any layout the desktop sheet was built for. Gating on width alone
			// switched the whole mobile layer off on rotation. Keep the touch
			// requirement so a short desktop window is never mistaken for one.
			window.matchMedia("(max-width: 768px), (max-height: 480px) and (orientation: landscape)").matches
			&& ("ontouchstart" in window || navigator.maxTouchPoints > 0)
		);
	}

	static isTouchDevice () {
		return "ontouchstart" in window || navigator.maxTouchPoints > 0;
	}

	// =========================================================================
	// Initialization
	// =========================================================================

	_init () {
		this._isMobile = CharacterSheetMobile.isMobile();

		if (!this._isMobile && !CharacterSheetMobile.isTouchDevice()) return;

		// Add touch class to body for CSS hooks
		document.body.classList.add("is-touch-device");

		// Set CSS custom property for iOS dynamic viewport height
		this._updateViewportHeight();

		if (this._isMobile) {
			document.body.classList.add("is-charsheet-mobile");
			this._initMobileLayout();
		}

		// Re-evaluate on resize/orientation change
		window.addEventListener("resize", this._boundOnResize);
		window.addEventListener("orientationchange", () => {
			setTimeout(() => {
				this._updateViewportHeight();
				this._boundOnResize();
			}, 150);
		});
	}

	_initMobileLayout () {
		if (this._mobileInitialized) return;
		this._mobileInitialized = true;

		this._initCollapsibleSections();
		this._initSwipeNavigation();
		this._initLongPress();
		this._initFab();
		this._initTabOverflow();
		this._initStatusStrip();
		this._initHeaderToggle();
		this._initTouchFeedback();
		this._initModalScrollLock();
		this._initDropdownMobilePositioning();

		// Scroll active tab into view on load
		requestAnimationFrame(() => {
			const activeTab = document.querySelector("#charsheet-tabs > li.ve-active");
			activeTab?.scrollIntoView({behavior: "smooth", inline: "center", block: "nearest"});
		});
	}

	_onResize () {
		const wasMobile = this._isMobile;
		this._isMobile = CharacterSheetMobile.isMobile();
		this._updateViewportHeight();

		if (this._isMobile && !wasMobile) {
			document.body.classList.add("is-charsheet-mobile");
			this._initMobileLayout();
		} else if (!this._isMobile && wasMobile) {
			document.body.classList.remove("is-charsheet-mobile");
			this._teardownMobile();
		}
	}

	_teardownMobile () {
		// Remove mobile-specific elements
		this._teardownTabOverflow();
		this._teardownStatusStrip();
		this._elContextMenu?.remove();
		this._elContextMenuBackdrop?.remove();
		this._elFab?.remove();
		this._elFabBackdrop?.remove();
		this._elContextMenu = null;
		this._elContextMenuBackdrop = null;
		this._elFab = null;
		this._elFabBackdrop = null;

		// Disconnect header observer
		this._headerObserver?.disconnect();
		this._headerObserver = null;

		// Remove global touch listeners added by _initLongPress and _initTouchFeedback
		document.removeEventListener("touchstart", this._boundLongPressStart);
		document.removeEventListener("touchmove", this._boundLongPressMove);
		document.removeEventListener("touchend", this._boundLongPressEnd);
		if (this._boundTouchFeedbackStart) {
			document.removeEventListener("touchstart", this._boundTouchFeedbackStart);
		}
		if (this._boundTouchFeedbackEnd) {
			document.removeEventListener("touchend", this._boundTouchFeedbackEnd);
		}

		// Unwrap section-content wrappers so desktop DOM is clean
		document.querySelectorAll(".charsheet-mobile__section-content").forEach(wrapper => {
			const parent = wrapper.parentNode;
			while (wrapper.firstChild) {
				parent.insertBefore(wrapper.firstChild, wrapper);
			}
			wrapper.remove();
		});

		// Clear collapsible data attributes so they can be re-initialized
		document.querySelectorAll("[data-mobile-collapsible]").forEach(el => {
			delete (/** @type {*} */ (el)).dataset.mobileCollapsible;
		});

		// Uncollapse all sections
		document.querySelectorAll(".charsheet-mobile--collapsed").forEach(el => {
			el.classList.remove("charsheet-mobile--collapsed");
		});

		// Clear header toggle data
		const secondaryRow = document.getElementById("charsheet-header-secondary");
		if (secondaryRow) {
			delete secondaryRow.dataset.mobileToggle;
			secondaryRow.classList.remove("charsheet-mobile--expanded");
		}
		document.getElementById("charsheet-header")?.classList.remove("charsheet-mobile__header--expanded");

		this._mobileInitialized = false;
	}

	/** Set --vh custom property for iOS Safari dynamic toolbar */
	_updateViewportHeight () {
		const vh = window.innerHeight * 0.01;
		document.documentElement.style.setProperty("--vh", `${vh}px`);
	}

	// =========================================================================
	// Collapsible Sections
	// =========================================================================

	/**
	 * Fallback delay for releasing a pinned `max-height`, in ms. Must exceed the
	 * `.charsheet-mobile__section-content` transition (0.3s, `charactersheet-mobile.css`).
	 */
	static _MAX_HEIGHT_RELEASE_MS = 400;

	/**
	 * Sections that never collapse: the ones Overview exists to show.
	 */
	static _SECTIONS_NO_COLLAPSE = new Set([
		"charsheet__section--hp",
		"charsheet__section--identity",
		"charsheet__section--combat-stats",
		"charsheet__section--header",
	]);

	/**
	 * Sections that start collapsed on mobile.
	 *
	 * The rule, not the list, is the thing to preserve: **a section starts collapsed
	 * when it is reference material or when another tab owns it.** What stays expanded
	 * is the play loop — attacks, resources, conditions, active states, favourites —
	 * plus identity. Everything collapsed is one tap from open, so this is arrangement,
	 * never feature loss.
	 *
	 * Note the ceiling on this lever: collapsing requires a `.charsheet__section-title`
	 * to hang the toggle on, and Overview's four largest blocks (hp, combat-stats,
	 * survival, core-stats — ~1,170px combined) have no title element, so they cannot
	 * participate. See `docs/charactersheet/10-known-limitations.md`.
	 */
	static _SECTIONS_DEFAULT_COLLAPSED = new Set([
		// Reference material — read between sessions, not mid-encounter.
		"charsheet__section--saves",
		"charsheet__section--skills",
		"charsheet__section--passives",
		"charsheet__section--senses",
		"charsheet__section--currency",
		"charsheet__section--exhaustion",
		"charsheet__section--proficiencies",
		// Owned by another tab, duplicated here for recall.
		"charsheet__section--features",
		"charsheet__section--specialties-feats",
		"charsheet__section--principles",
	]);

	_initCollapsibleSections () {
		const sections = document.querySelectorAll(".charsheet__section");
		const noCollapse = CharacterSheetMobile._SECTIONS_NO_COLLAPSE;
		const defaultCollapsed = CharacterSheetMobile._SECTIONS_DEFAULT_COLLAPSED;

		sections.forEach(section => {
			// Skip non-collapsible sections
			const isNoCollapse = [...noCollapse].some(cls => section.classList.contains(cls));
			if (isNoCollapse) return;

			const title = /** @type {*} */ (section.querySelector(".charsheet__section-title"));
			if (!title) return;

			// Skip if already initialized
			if (title.dataset.mobileCollapsible) return;
			title.dataset.mobileCollapsible = "true";

			// Wrap content for animated collapse (skip the title itself)
			const contentWrapper = document.createElement("div");
			contentWrapper.className = "charsheet-mobile__section-content";
			const children = [...section.children].filter(c => c !== title);
			children.forEach(c => contentWrapper.appendChild(c));
			section.appendChild(contentWrapper);

			// Collapse by default for specified sections
			const shouldCollapse = [...defaultCollapsed].some(cls => section.classList.contains(cls));
			if (shouldCollapse) {
				section.classList.add("charsheet-mobile--collapsed");
				contentWrapper.style.maxHeight = "0";
			} else {
				// Resting state is unbounded. Pinning a pixel height here would freeze the
				// section at whatever it measured during init -- before async content lands,
				// and while inactive tabs are still `display: none` (so `scrollHeight` is 0) --
				// silently clipping everything that renders later. See `_releaseMaxHeight`.
				contentWrapper.style.maxHeight = "none";
			}

			// Add tap-to-toggle behavior
			title.addEventListener("click", (/** @type {*} */ e) => {
				// Don't toggle if clicking edit buttons within the title
				if (e.target.closest(".charsheet__section-edit, .ve-btn, button")) return;

				const isCollapsed = section.classList.toggle("charsheet-mobile--collapsed");

				if (isCollapsed) {
					contentWrapper.style.maxHeight = `${contentWrapper.scrollHeight}px`;
					// Force reflow then collapse
					contentWrapper.offsetHeight; // eslint-disable-line no-unused-expressions
					contentWrapper.style.maxHeight = "0";
				} else {
					// Pin the measured height so the transition has somewhere to travel to,
					// then hand off to `_releaseMaxHeight` to return it to unbounded at rest.
					contentWrapper.style.maxHeight = `${contentWrapper.scrollHeight}px`;
					this._releaseMaxHeight(section, contentWrapper);
				}

				this._haptic("light");
			});
		});
	}

	/**
	 * Return an expanded section to an unbounded resting `max-height`.
	 *
	 * `max-height` is a transition device, never a resting state: any pinned pixel value
	 * clips content that renders after it was measured, with no scrollbar and no
	 * affordance to reveal it. The timeout is the load-bearing half -- `transitionend`
	 * never fires when the transition is suppressed (`prefers-reduced-motion`, a
	 * zero-duration override, or a section whose pane is hidden mid-animation), which
	 * would otherwise leave the height pinned forever.
	 *
	 * @param {*} section
	 * @param {*} contentWrapper
	 */
	_releaseMaxHeight (section, contentWrapper) {
		let timeoutId = null;

		const release = () => {
			if (timeoutId != null) clearTimeout(timeoutId);
			contentWrapper.removeEventListener("transitionend", onTransitionEnd);
			// Re-collapsed mid-transition: the collapse handler owns the height now.
			if (section.classList.contains("charsheet-mobile--collapsed")) return;
			contentWrapper.style.maxHeight = "none";
		};

		const onTransitionEnd = (/** @type {*} */ evt) => {
			// Ignore transitions bubbling up from descendants
			if (evt.target !== contentWrapper || evt.propertyName !== "max-height") return;
			release();
		};

		contentWrapper.addEventListener("transitionend", onTransitionEnd);
		timeoutId = setTimeout(release, CharacterSheetMobile._MAX_HEIGHT_RELEASE_MS);
	}

	// =========================================================================
	// Swipe Navigation
	// =========================================================================

	_initSwipeNavigation () {
		const tabContent = document.querySelector(".charsheet-page .tab-content");
		if (!tabContent) return;

		// Selectors for containers that scroll horizontally — swipe should NOT trigger tab nav on these
		this._horizontalScrollSelectors = [
			".charsheet__spell-slots",
			".charsheet__builder-steps",
			"#charsheet-tabs",
			".charsheet__header-row--primary",
		].join(", ");

		tabContent.addEventListener("touchstart", (/** @type {*} */ e) => {
			if (e.touches.length !== 1) return;

			// Don't intercept swipes on horizontally-scrollable containers
			if (e.target.closest(this._horizontalScrollSelectors)) {
				this._swipeStartX = null;
				return;
			}

			this._swipeStartX = e.touches[0].clientX;
			this._swipeStartY = e.touches[0].clientY;
		}, {passive: true});

		tabContent.addEventListener("touchend", (/** @type {*} */ e) => {
			if (this._swipeStartX == null) return;
			if (e.changedTouches.length !== 1) return;
			const deltaX = e.changedTouches[0].clientX - this._swipeStartX;
			const deltaY = e.changedTouches[0].clientY - this._swipeStartY;

			// Only trigger if horizontal swipe is dominant
			if (Math.abs(deltaX) < this._swipeThreshold) return;
			if (Math.abs(deltaY) > Math.abs(deltaX) * 0.5) return;

			if (deltaX > 0) {
				this._navigateTab(-1); // swipe right = previous tab
			} else {
				this._navigateTab(1); // swipe left = next tab
			}
		}, {passive: true});
	}

	_navigateTab (direction) {
		const tabs = document.querySelectorAll("#charsheet-tabs > li");
		if (!tabs.length) return;

		let activeIdx = -1;
		tabs.forEach((tab, i) => {
			if (tab.classList.contains("ve-active")) activeIdx = i;
		});

		const newIdx = activeIdx + direction;
		if (newIdx < 0 || newIdx >= tabs.length) return;

		const targetLink = tabs[newIdx].querySelector("a");
		if (targetLink) {
			targetLink.click();
			this._haptic("light");

			// Scroll the tab into view in the bottom bar
			tabs[newIdx].scrollIntoView({behavior: "smooth", inline: "center", block: "nearest"});

			// Scroll content to top on tab switch
			window.scrollTo({top: 0, behavior: "smooth"});
		}
	}

	// =========================================================================
	// Long Press (replaces right-click)
	// =========================================================================

	/**
	 * Every element type that opens a long-press menu.
	 *
	 * Single source of truth, shared by the touch trigger and the menu builder —
	 * they previously carried separate copies that drifted apart, leaving three
	 * branches pointed at DOM that never existed.
	 *
	 * Every selector here is asserted to exist in non-mobile source by
	 * `test/jest/charactersheet/MobileSelectorIntegrity.test.js`.
	 */
	static LONG_PRESS_SELECTOR = [
		".charsheet__skill-row",
		".charsheet__save-row",
		".charsheet__attack-item",
		".charsheet__ability",
		".charsheet__combat-stat--clickable",
		".charsheet__item",
		".charsheet__resource-row",
		".charsheet__spell-item",
	].join(", ");

	_initLongPress () {
		document.addEventListener("touchstart", this._boundLongPressStart, {passive: true});
		document.addEventListener("touchmove", this._boundLongPressMove, {passive: true});
		document.addEventListener("touchend", this._boundLongPressEnd, {passive: true});
	}

	_onLongPressStart (e) {
		const target = e.target.closest(CharacterSheetMobile.LONG_PRESS_SELECTOR);
		if (!target) return;

		this._longPressFired = false;
		this._longPressTarget = target;
		const touch = e.touches[0];
		// Capture touch coords now (event object won't be available later)
		const touchData = {clientX: touch.clientX, clientY: touch.clientY};

		// Announce that holding is doing something. A 500ms gesture with no
		// feedback is indistinguishable from a dead control, and long-press is now
		// the only route to advantage rolls and spell upcasting.
		target.classList.add("charsheet-mobile--pressing");

		this._longPressTimer = setTimeout(() => {
			this._longPressFired = true;
			this._clearPressFeedback();
			this._haptic("medium");
			this._showContextMenu(target, touchData);
		}, this._longPressDuration);
	}

	_onLongPressMove () {
		this._cancelLongPress();
	}

	_onLongPressEnd (e) {
		this._cancelLongPress();

		// If long press fired, suppress the synthetic click that follows touchend.
		// preventDefault() on touchend doesn't prevent click — use a capture-phase
		// click blocker with a brief timing window instead.
		//
		// The blocker must be *targeted*, not global. A blanket `once: true`
		// listener swallows whichever click arrives first, and on a phone that is
		// very often the user's immediate tap on the menu the press just opened —
		// so the first choice they make silently does nothing. Only the synthetic
		// click on the pressed row is suppressed; the menu is always live.
		if (this._longPressFired) {
			this._longPressFired = false;
			const pressedRow = this._longPressTarget;
			const blocker = (evt) => {
				if (evt.target?.closest?.(".charsheet-mobile__context-menu")) return;
				if (pressedRow && !pressedRow.contains(evt.target)) return;
				evt.stopPropagation();
				evt.preventDefault();
				document.removeEventListener("click", blocker, {capture: true});
			};
			document.addEventListener("click", blocker, {capture: true});
			// Safety: remove blocker if the click never comes (e.g., scrolled away)
			setTimeout(() => {
				document.removeEventListener("click", blocker, {capture: true});
			}, 500);
		}
	}

	_cancelLongPress () {
		if (this._longPressTimer) {
			clearTimeout(this._longPressTimer);
			this._longPressTimer = null;
		}
		this._clearPressFeedback();
	}

	_clearPressFeedback () {
		this._longPressTarget?.classList.remove("charsheet-mobile--pressing");
	}

	// =========================================================================
	// Context Menu
	// =========================================================================

	_showContextMenu (target, touch) {
		this._hideContextMenu();

		if (!this._elContextMenu) {
			this._elContextMenu = this._createContextMenu();
			document.body.appendChild(this._elContextMenu);
		}
		if (!this._elContextMenuBackdrop) {
			this._elContextMenuBackdrop = document.createElement("div");
			this._elContextMenuBackdrop.className = "charsheet-mobile__context-menu-backdrop";
			// Pointer events cover mouse, touch and pen with one listener, so the
			// menu cannot be left stranded by an input type we forgot to bind.
			this._elContextMenuBackdrop.addEventListener("pointerdown", evt => {
				evt.preventDefault();
				this._hideContextMenu();
			});
			document.body.appendChild(this._elContextMenuBackdrop);
		}

		// Build menu items based on target type
		const items = this._getContextMenuItems(target);
		if (!items.length) return;

		const contentEl = this._elContextMenu.querySelector(".charsheet-mobile__context-menu-items");
		contentEl.innerHTML = "";

		// Add a header showing what element this is for
		const label = this._getTargetLabel(target);
		if (label) {
			const header = document.createElement("div");
			header.className = "charsheet-mobile__context-menu-header";
			header.textContent = label;
			contentEl.appendChild(header);
		}

		items.forEach(item => {
			if (item.separator) {
				const sep = document.createElement("div");
				sep.className = "charsheet-mobile__context-menu-separator";
				contentEl.appendChild(sep);
				return;
			}

			const el = document.createElement("div");
			el.className = "charsheet-mobile__context-menu-item";

			// Labels are built from character data (spell names, item names), so they
			// are never assumed to be markup-safe — every one is set as text.
			const iconEl = document.createElement("span");
			iconEl.className = "charsheet-mobile__context-menu-item-icon";
			// Discovered actions reuse the control's own glyph element; authored
			// entries pass an emoji string.
			if (item.icon instanceof Node) iconEl.appendChild(item.icon);
			else iconEl.textContent = item.icon;

			const textEl = document.createElement("span");
			textEl.className = "charsheet-mobile__context-menu-item-text";

			const labelEl = document.createElement("span");
			labelEl.className = "charsheet-mobile__context-menu-item-label";
			labelEl.textContent = item.label;
			textEl.appendChild(labelEl);

			// The sublabel carries the information that makes a choice decidable —
			// "3 slots remaining", "2 SP". Dropping it made upcasting unreadable.
			if (item.sublabel) {
				const subEl = document.createElement("span");
				subEl.className = "charsheet-mobile__context-menu-item-sublabel";
				subEl.textContent = item.sublabel;
				textEl.appendChild(subEl);
			}

			el.appendChild(iconEl);
			el.appendChild(textEl);

			if (item.disabled) {
				el.classList.add("charsheet-mobile__context-menu-item--disabled");
				el.setAttribute("aria-disabled", "true");
			} else {
				el.addEventListener("click", () => {
					this._hideContextMenu();
					item.action();
				});
			}
			contentEl.appendChild(el);
		});

		// Measure rather than estimate. The previous estimate assumed a fixed 48px
		// per row and a 60px tab bar, both of which predate the status strip and
		// neither of which survives a multi-line sublabel.
		this._elContextMenu.style.left = "0px";
		this._elContextMenu.style.top = "0px";
		this._elContextMenu.style.visibility = "hidden";
		this._elContextMenu.classList.add("charsheet-mobile--visible");

		const bottomChromeHeight = this._getBottomChromeHeight();
		const menuRect = this._elContextMenu.getBoundingClientRect();
		const maxX = window.innerWidth - menuRect.width - 8;
		const maxY = window.innerHeight - bottomChromeHeight - menuRect.height - 8;
		const x = Math.max(8, Math.min(touch.clientX, maxX));
		const y = Math.max(8, Math.min(touch.clientY - 20, maxY));

		this._elContextMenu.style.left = `${x}px`;
		this._elContextMenu.style.top = `${y}px`;
		this._elContextMenu.style.visibility = "";
		this._elContextMenuBackdrop.classList.add("charsheet-mobile--visible");
		this._contextMenuVisible = true;
	}

	/**
	 * Height of the persistent bottom chrome (tab bar + status strip), measured.
	 * @returns {number} Height in CSS pixels.
	 */
	_getBottomChromeHeight () {
		const tabBar = document.getElementById("charsheet-tabs");
		const viewportH = window.innerHeight;
		const measure = (el) => {
			if (!el) return 0;
			const rect = el.getBoundingClientRect();
			// Only count chrome actually pinned to the bottom of the viewport.
			return rect.height && rect.bottom >= viewportH - 2 ? rect.height : 0;
		};
		return measure(tabBar) + measure(this._elStatusStrip);
	}

	_hideContextMenu () {
		if (this._elContextMenu) {
			this._elContextMenu.classList.remove("charsheet-mobile--visible");
			this._elContextMenu.style.visibility = "";
		}
		this._elContextMenuBackdrop?.classList.remove("charsheet-mobile--visible");
		this._contextMenuVisible = false;
	}

	_createContextMenu () {
		const el = document.createElement("div");
		el.className = "charsheet-mobile__context-menu";
		el.innerHTML = `<div class="charsheet-mobile__context-menu-items"></div>`;
		return el;
	}

	/** Extract a human-readable label for the target element */
	_getTargetLabel (target) {
		// Skill row
		const skillName = target.querySelector(".charsheet__skill-name");
		if (skillName) return skillName.textContent.trim();

		// Save row
		const saveName = target.querySelector(".charsheet__save-name");
		if (saveName) return `${saveName.textContent.trim()} Save`;

		// Attack
		const attackName = target.querySelector(".charsheet__attack-name");
		if (attackName) return attackName.textContent.trim();

		// Ability
		const abilityLabel = target.querySelector(".charsheet__ability-name");
		if (abilityLabel) return abilityLabel.textContent.trim();

		// Inventory item / class resource
		const itemName = target.querySelector(".charsheet__item-name, .charsheet__resource-name");
		if (itemName) return itemName.textContent.trim();

		// Combat stat
		const statLabel = target.querySelector(".charsheet__combat-stat-label");
		if (statLabel) return statLabel.textContent.trim();

		// Spell item
		const spellName = target.querySelector(".charsheet__spell-item-name");
		if (spellName) return `Cast ${spellName.textContent.trim()}`;

		return null;
	}

	_getContextMenuItems (target) {
		const items = [];
		// Skill/Save row
		if (target.matches(".charsheet__skill-row, .charsheet__save-row")) {
			items.push(
				{icon: "🎲", label: "Roll Normal", action: () => this._simulateModifiedClick(target, {})},
				{icon: "⬆️", label: "Roll with Advantage", action: () => this._simulateModifiedClick(target, {shiftKey: true})},
				{icon: "⬇️", label: "Roll with Disadvantage", action: () => this._simulateModifiedClick(target, {ctrlKey: true})},
			);
		}

		// Attack item
		if (target.matches(".charsheet__attack-item")) {
			const rollBtn = target.querySelector(".charsheet__attack-roll");
			const dmgBtn = target.querySelector(".charsheet__attack-damage");
			items.push(
				{icon: "⚔️", label: "Roll Attack", action: () => rollBtn?.click()},
				{icon: "💥", label: "Roll Damage", action: () => dmgBtn?.click()},
				{icon: "⬆️", label: "Attack (Advantage)", action: () => this._simulateModifiedClick(rollBtn, {shiftKey: true})},
				{icon: "⬇️", label: "Attack (Disadvantage)", action: () => this._simulateModifiedClick(rollBtn, {ctrlKey: true})},
				{separator: true},
				{icon: "✏️", label: "Edit Attack", action: () => target.querySelector(".charsheet__attack-edit")?.click()},
			);
		}

		// Ability score
		if (target.matches(".charsheet__ability")) {
			items.push(
				{icon: "🎲", label: "Roll Check", action: () => this._simulateModifiedClick(target, {})},
				{icon: "⬆️", label: "Roll (Advantage)", action: () => this._simulateModifiedClick(target, {shiftKey: true})},
				{icon: "⬇️", label: "Roll (Disadvantage)", action: () => this._simulateModifiedClick(target, {ctrlKey: true})},
			);
		}

		// Inventory item and class resource. Both are rendered by controllers that
		// name their buttons differently (`__item-remove` vs `__resource-use-btn`),
		// and both have changed shape before. Rather than guess at class names —
		// which is how three branches ended up pointing at DOM that never existed —
		// read the actions off the row itself. Icon-only buttons carry their meaning
		// in a `title` that touch users can never see, so surfacing them here is a
		// genuine capability gain, not just a repair.
		if (target.matches(".charsheet__item, .charsheet__resource-row")) {
			items.push(...this._buildRowActionItems(target));
		}

		// Combat stat (initiative, AC)
		if (target.matches(".charsheet__combat-stat--clickable")) {
			items.push(
				{icon: "🎲", label: "Roll", action: () => this._simulateModifiedClick(target, {})},
				{icon: "⬆️", label: "Roll (Advantage)", action: () => this._simulateModifiedClick(target, {shiftKey: true})},
				{icon: "⬇️", label: "Roll (Disadvantage)", action: () => this._simulateModifiedClick(target, {ctrlKey: true})},
			);
		}

		// Spell item — reuse the shared cast-options builder so desktop right-click
		// and mobile long-press offer the exact same choices.
		if (target.matches(".charsheet__spell-item")) {
			const spellId = target.dataset.spellId;
			const spellsCtrl = this._page?._spells;
			if (spellId && spellsCtrl?._buildCastOptionItems) {
				const spell = spellsCtrl._state.getSpells().find(s => s.id === spellId);
				const spellData = spell
					? spellsCtrl._allSpells.find(s => s.name === spell.name && s.source === spell.source)
					: null;
				if (spell) {
					const castItems = spellsCtrl._buildCastOptionItems(spell, spellData);
					castItems.forEach(ci => {
						const spaceIdx = ci.label.indexOf(" ");
						const icon = spaceIdx > 0 ? ci.label.slice(0, spaceIdx) : "✨";
						const label = spaceIdx > 0 ? ci.label.slice(spaceIdx + 1) : ci.label;
						// `sublabel` and `disabled` are what make an upcast choice
						// decidable ("3 slots remaining") and honest (a slot you
						// cannot afford). Both were previously dropped.
						items.push({
							icon,
							label,
							sublabel: ci.sublabel,
							disabled: ci.disabled,
							action: () => ci.onSelect?.(),
						});
					});
				}
			}

			// Everything the row offers that isn't casting: Info, Note, Star,
			// Remove, and whatever a controller adds next.
			//
			// Without this, a spell with no cast options — an innate "1/day" racial
			// grant, an at-will, a feature spell — produced an *empty* menu, and
			// `_showContextMenu` early-returns on an empty list. Long-press on those
			// rows silently did nothing, which is worse now that the row carries a ⋯
			// hint promising otherwise. Casting is excluded because
			// `_buildCastOptionItems` models it far better than a button scan can:
			// it knows slot levels, ritual casting, metamagic and affordability.
			items.push(...this._buildRowActionItems(target, {skipSelector: "[class*='charsheet__spell-cast']"}));
		}

		return items;
	}

	/**
	 * Build menu entries by reading the actionable controls a row actually renders,
	 * rather than guessing at class names.
	 *
	 * Two rows needed a context menu — inventory items and class resources — and
	 * both were previously described by hardcoded selectors that named DOM which
	 * never existed (`__inventory-equip`, `__resource-reset`, `__resource-edit`, …).
	 * They also name their controls inconsistently: the inventory renders
	 * `__item-remove`, resources render `__resource-use-btn`, and several other
	 * controllers render resource rows of their own. Discovery covers all of them,
	 * survives renames, and surfaces the row's full capability instead of a
	 * three-item guess.
	 *
	 * @param {HTMLElement} row - The long-pressed row.
	 * @param {object} [opts]
	 * @param {string} [opts.skipSelector] - Controls another builder already owns.
	 * @returns {Array<object>} Context-menu items.
	 */
	_buildRowActionItems (row, opts) {
		const {skipSelector} = opts || {};
		const items = [];
		const seenLabels = new Set();

		row.querySelectorAll("button").forEach(btn => {
			// Rows can nest expanded detail panels belonging to another row.
			if (btn.closest(CharacterSheetMobile.LONG_PRESS_SELECTOR) !== row) return;
			// Anything not currently rendered is not an available action.
			if (!btn.getClientRects().length) return;
			if (skipSelector && btn.matches(skipSelector)) return;

			const label = CharacterSheetMobile.deriveActionLabel(btn);
			if (!label || seenLabels.has(label)) return;
			seenLabels.add(label);

			items.push({
				icon: this._deriveActionIcon(btn),
				label,
				disabled: !!btn.disabled,
				action: () => btn.click(),
			});
		});

		return items;
	}

	/**
	 * The most human label a control offers, in descending order of intent.
	 *
	 * Icon-only buttons put their meaning in `title`, which a touch user can never
	 * hover to read — surfacing it is the single biggest win of the long-press menu.
	 * Where a control is a bare glyph ("+"), fall back to its own class name so the
	 * entry is still readable, and so newly-added controls need no registration.
	 *
	 * Pure static: no DOM construction, so it is directly unit-testable.
	 *
	 * @param {HTMLElement} btn
	 * @returns {string|null}
	 */
	static deriveActionLabel (btn) {
		const title = (btn.getAttribute("title") || "").trim();
		if (title) return title;

		const aria = (btn.getAttribute("aria-label") || "").trim();
		if (aria) return aria;

		const text = (btn.textContent || "").replace(/\s+/g, " ").trim();
		// "Use" is a label; "+" and "×" are not.
		if (text && text.length > 2 && /[a-z]/i.test(text)) return text;

		const fromClass = CharacterSheetMobile.deriveLabelFromClassName(btn.className);
		if (fromClass) return fromClass;

		return text || null;
	}

	/**
	 * Turn a BEM control class into readable words, e.g.
	 * `charsheet__resource-restore-btn` → "Restore".
	 *
	 * @param {string} className
	 * @returns {string|null}
	 */
	static deriveLabelFromClassName (className) {
		const cls = String(className || "")
			.split(/\s+/)
			.find(c => c.startsWith("charsheet__"));
		if (!cls) return null;

		const words = cls
			.replace(/^charsheet__/, "")
			// Drop the block prefix ("item-", "resource-", "spell-") and the
			// meaningless "-btn" suffix, leaving the verb.
			.replace(/^(item|resource|spell|attack|gem)-/, "")
			.replace(/-btn$/, "")
			.replace(/-/g, " ")
			.trim();
		if (!words) return null;

		return words.replace(/\b\w/g, c => c.toUpperCase());
	}

	/**
	 * An icon for a discovered action. Reuses the control's own glyph wherever it
	 * has one, so the menu stays visually keyed to the row without a mapping table
	 * that would need updating every time a control is added.
	 *
	 * @param {HTMLElement} btn
	 * @returns {Node|string}
	 */
	_deriveActionIcon (btn) {
		const glyph = btn.querySelector(".glyphicon");
		if (glyph) return glyph.cloneNode(true);

		// Some controls lead with an emoji ("✦ 2/3", "⚔ Roll") — reuse it.
		const text = (btn.textContent || "").trim();
		const leadingSymbol = text.match(/^([\p{Extended_Pictographic}\p{So}])/u);
		if (leadingSymbol) return leadingSymbol[1];

		return "•";
	}

	// =========================================================================
	// Floating Action Button (FAB) with Backdrop
	// =========================================================================

	_initFab () {
		this._elFabBackdrop = document.createElement("div");
		this._elFabBackdrop.className = "charsheet-mobile__fab-backdrop";
		this._elFabBackdrop.addEventListener("click", () => this._closeFab());
		document.body.appendChild(this._elFabBackdrop);

		this._elFab = this._createFab();
		document.body.appendChild(this._elFab);
	}

	_closeFab () {
		if (!this._fabOpen) return;
		this._fabOpen = false;
		const mainBtn = this._elFab?.querySelector(".charsheet-mobile__fab-main");
		mainBtn?.classList.remove("charsheet-mobile__fab--open");
		this._elFabBackdrop?.classList.remove("charsheet-mobile--visible");
	}

	_createFab () {
		const el = document.createElement("div");
		el.className = "charsheet-mobile__fab";
		el.innerHTML = `
			<button class="charsheet-mobile__fab-main" id="charsheet-mobile-fab-toggle" title="Quick Actions">
				⚡
			</button>
			<div class="charsheet-mobile__fab-actions">
				<div class="charsheet-mobile__fab-action" data-action="short-rest">
					<span class="charsheet-mobile__fab-action-label">Short Rest</span>
					<span class="charsheet-mobile__fab-action-btn">🏕️</span>
				</div>
				<div class="charsheet-mobile__fab-action" data-action="long-rest">
					<span class="charsheet-mobile__fab-action-label">Long Rest</span>
					<span class="charsheet-mobile__fab-action-btn">🛏️</span>
				</div>
				<div class="charsheet-mobile__fab-action" data-action="initiative">
					<span class="charsheet-mobile__fab-action-label">Roll Initiative</span>
					<span class="charsheet-mobile__fab-action-btn">⚡</span>
				</div>
				<div class="charsheet-mobile__fab-action" data-action="death-save">
					<span class="charsheet-mobile__fab-action-label">Death Save</span>
					<span class="charsheet-mobile__fab-action-btn">💀</span>
				</div>
			</div>
		`;

		// Toggle FAB
		const mainBtn = el.querySelector(".charsheet-mobile__fab-main");
		mainBtn.addEventListener("click", () => {
			this._fabOpen = !this._fabOpen;
			mainBtn.classList.toggle("charsheet-mobile__fab--open", this._fabOpen);
			this._elFabBackdrop?.classList.toggle("charsheet-mobile--visible", this._fabOpen);
			this._haptic("light");
		});

		// FAB actions
		el.addEventListener("click", (/** @type {*} */ e) => {
			const action = e.target.closest("[data-action]");
			if (!action) return;

			const actionType = action.dataset.action;
			this._executeFabAction(actionType);
			this._closeFab();
		});

		return el;
	}

	_executeFabAction (actionType) {
		switch (actionType) {
			case "short-rest":
				document.getElementById("charsheet-btn-short-rest")?.click();
				break;
			case "long-rest":
				document.getElementById("charsheet-btn-long-rest")?.click();
				break;
			case "initiative": {
				const initBtn = document.getElementById("charsheet-roll-initiative");
				if (initBtn) initBtn.click();
				else document.getElementById("charsheet-box-initiative")?.click();
				break;
			}
			case "death-save":
				document.getElementById("charsheet-btn-deathsave")?.click();
				break;
		}
		this._haptic("medium");
	}

	// =========================================================================
	// Tab Overflow — five play tabs in the bar, prep tabs behind "More"
	// =========================================================================

	/**
	 * The tab strip carries ten tabs. At 390px that is a 459px scrollWidth in a
	 * 390px container with no scroll affordance, so "Companions", "Builder" and
	 * "Respec" were effectively undiscoverable and "Companion" clipped mid-word.
	 *
	 * The list splits cleanly along a job seam that already exists: five tabs
	 * serve play, the rest serve preparation. Keep the play five in the bar and
	 * move the rest behind a "More" item. Nothing is removed — every tab stays
	 * one tap away, and the original anchors keep owning activation so the
	 * site's tab machinery is untouched.
	 */
	static _PLAY_TAB_HREFS = [
		"#charsheet-tab-overview",
		"#charsheet-tab-combat",
		"#charsheet-tab-spells",
		"#charsheet-tab-inventory",
		"#charsheet-tab-features",
	];

	/**
	 * Split a tab strip's hrefs into the ones that stay in the bar and the ones
	 * that move behind "More".
	 *
	 * This is deliberately a pure function rather than a filter buried in the
	 * DOM wiring: the seam it draws is a product decision, not a layout detail,
	 * and the invariant that matters — that `play` and `overflow` together
	 * account for every tab, so nothing on the sheet becomes unreachable on a
	 * phone — is only checkable if the policy can be called without a DOM.
	 *
	 * @param {string[]} hrefs Tab hrefs in document order.
	 * @return {{play: string[], overflow: string[]}}
	 */
	static partitionTabs (hrefs) {
		const play = [];
		const overflow = [];
		for (const href of hrefs || []) {
			if (!href) continue;
			(CharacterSheetMobile._PLAY_TAB_HREFS.includes(href) ? play : overflow).push(href);
		}
		return {play, overflow};
	}

	_initTabOverflow () {
		const tabList = document.getElementById("charsheet-tabs");
		if (!tabList || tabList.dataset.mobileOverflow) return;
		tabList.dataset.mobileOverflow = "true";

		const {overflow} = CharacterSheetMobile.partitionTabs(
			[...tabList.children].map(li => li.querySelector("a[href]")?.getAttribute("href")),
		);
		const overflowItems = [...tabList.children].filter(li => {
			const href = li.querySelector("a[href]")?.getAttribute("href");
			return href && overflow.includes(href);
		});
		if (!overflowItems.length) return;

		overflowItems.forEach(li => li.classList.add("charsheet-mobile__tab--overflow"));

		this._elTabMoreItem = this._createTabMoreItem();
		tabList.appendChild(this._elTabMoreItem);

		this._elTabSheet = this._createTabSheet(overflowItems);
		document.body.appendChild(this._elTabSheet);

		// The site toggles `ve-active` on the <li>; mirror it onto "More" so the
		// bar never claims nothing is selected while an overflow tab is open.
		this._boundSyncTabMore = () => this._syncTabMoreActive(overflowItems);
		this._tabObserver = new MutationObserver(this._boundSyncTabMore);
		[...tabList.children].forEach(li => this._tabObserver.observe(li, {attributes: true, attributeFilter: ["class"]}));
		this._boundSyncTabMore();
	}

	_createTabMoreItem () {
		const li = document.createElement("li");
		li.className = "charsheet-mobile__tab-more";
		li.innerHTML = `
			<a href="#" role="button" aria-haspopup="true" aria-expanded="false" aria-controls="charsheet-mobile-tab-sheet">
				<span class="charsheet__tab-icon" aria-hidden="true">⋯</span><span class="charsheet__tab-text">More</span>
			</a>
		`;
		li.querySelector("a").addEventListener("click", e => {
			e.preventDefault();
			this._toggleTabSheet();
		});
		return li;
	}

	_createTabSheet (overflowItems) {
		const el = document.createElement("div");
		el.className = "charsheet-mobile__tab-sheet";
		el.id = "charsheet-mobile-tab-sheet";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-label", "More sections");
		el.hidden = true;

		const rows = overflowItems.map(li => {
			const anchor = li.querySelector("a[href]");
			const icon = anchor.querySelector(".charsheet__tab-icon")?.textContent?.trim() || "";
			const text = anchor.querySelector(".charsheet__tab-text")?.textContent?.trim() || anchor.textContent.trim();
			return `<button type="button" class="charsheet-mobile__tab-sheet-item" data-href="${anchor.getAttribute("href")}">
				<span class="charsheet-mobile__tab-sheet-icon" aria-hidden="true">${icon}</span>
				<span class="charsheet-mobile__tab-sheet-label">${text}</span>
			</button>`;
		}).join("");

		el.innerHTML = `
			<div class="charsheet-mobile__tab-sheet-backdrop"></div>
			<div class="charsheet-mobile__tab-sheet-panel">
				<div class="charsheet-mobile__tab-sheet-grip" aria-hidden="true"></div>
				<div class="charsheet-mobile__tab-sheet-title">More sections</div>
				<div class="charsheet-mobile__tab-sheet-list">${rows}</div>
			</div>
		`;

		el.querySelector(".charsheet-mobile__tab-sheet-backdrop").addEventListener("click", () => this._closeTabSheet());
		el.addEventListener("click", e => {
			const btn = e.target.closest(".charsheet-mobile__tab-sheet-item");
			if (!btn) return;
			// Delegate to the real tab anchor so the site's own tab machinery,
			// and any listener bound to it, runs exactly as it does on desktop.
			document.querySelector(`#charsheet-tabs > li > a[href="${btn.dataset.href}"]`)?.click();
			this._closeTabSheet();
			this._haptic("light");
		});
		return el;
	}

	_toggleTabSheet () {
		if (this._tabSheetOpen) this._closeTabSheet();
		else this._openTabSheet();
	}

	_openTabSheet () {
		if (!this._elTabSheet) return;
		this._tabSheetOpen = true;
		this._elTabSheet.hidden = false;
		// Next frame so the transition has a from-state to animate out of.
		requestAnimationFrame(() => this._elTabSheet?.classList.add("charsheet-mobile--visible"));
		this._elTabMoreItem?.querySelector("a")?.setAttribute("aria-expanded", "true");
		this._elTabSheet.querySelector(".charsheet-mobile__tab-sheet-item")?.focus();
		this._haptic("light");
	}

	_closeTabSheet () {
		if (!this._elTabSheet || !this._tabSheetOpen) return;
		this._tabSheetOpen = false;
		this._elTabSheet.classList.remove("charsheet-mobile--visible");
		this._elTabMoreItem?.querySelector("a")?.setAttribute("aria-expanded", "false");
		this._elTabMoreItem?.querySelector("a")?.focus();
		const el = this._elTabSheet;
		setTimeout(() => { if (!this._tabSheetOpen && el) el.hidden = true; }, 250);
	}

	_syncTabMoreActive (overflowItems) {
		const isOverflowActive = overflowItems.some(li => li.classList.contains("ve-active"));
		this._elTabMoreItem?.classList.toggle("ve-active", isOverflowActive);
	}

	_teardownTabOverflow () {
		this._tabObserver?.disconnect();
		this._tabObserver = null;
		this._elTabMoreItem?.remove();
		this._elTabSheet?.remove();
		this._elTabMoreItem = null;
		this._elTabSheet = null;
		this._tabSheetOpen = false;
		document.querySelectorAll(".charsheet-mobile__tab--overflow")
			.forEach(li => li.classList.remove("charsheet-mobile__tab--overflow"));
		const tabList = document.getElementById("charsheet-tabs");
		if (tabList) delete tabList.dataset.mobileOverflow;
	}

	// =========================================================================
	// Status Strip — the play loop, promoted into persistent chrome
	// =========================================================================

	/**
	 * The sheet's north star on a phone is a two-second glance mid-encounter:
	 * read HP, spend a resource, look back up. Before this, every one of those
	 * jobs cost a tab switch and a scroll, because HP, AC, slots and class
	 * resources each live on a different tab.
	 *
	 * The strip promotes them into persistent chrome above the tab bar. It is
	 * deliberately a *mirror*, not an owner: each segment reads the real
	 * controls and, when tapped, clicks them. No resource arithmetic happens
	 * here, so `CharacterSheetState` stays the single source of truth and the
	 * existing tests keep covering the real path.
	 *
	 * Each segment is a descriptor with a `read()` that returns a render model
	 * (or `null` to hide itself) and an `activate()` that delegates. Adding a
	 * segment means adding a descriptor — not touching the render loop — and a
	 * class with no slots or no resources simply yields fewer segments rather
	 * than needing a per-class branch.
	 */
	/**
	 * Pure: how a current/max pair reads at a glance.
	 *
	 * Downed is a *situation*, not just a small number, so it is its own state
	 * rather than the bottom of a gradient — a player glancing at the strip needs
	 * "you are down" to be unmissable, not merely redder.
	 *
	 * @return {{ratio: number, state: (string|null)}|null}
	 */
	static readVitalState (current, max) {
		if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
		const ratio = Math.max(0, Math.min(1, current / max));
		return {ratio, state: current <= 0 ? "critical" : ratio <= 0.5 ? "warn" : null};
	}

	/**
	 * Pure: which spell-slot level the strip should offer.
	 *
	 * The lowest level that still has a slot — the same rule a player uses at
	 * the table, and the one that keeps high slots in reserve. Pact slots fall
	 * out of the same scan in document order, so Warlocks need no special case.
	 *
	 * @param {Array<{level: string, open: number, total: number}>} levels
	 */
	static pickSlotLevel (levels) {
		return (levels || []).find(l => l && l.open > 0) || null;
	}

	static _STATUS_SEGMENTS = [
		{
			key: "hp",
			read: () => {
				const cur = document.getElementById("charsheet-ipt-hp-current");
				const max = document.getElementById("charsheet-disp-hp-max");
				if (!cur || !max) return null;
				const curVal = Number(cur.value);
				const maxVal = Number(max.textContent);
				const vital = CharacterSheetMobile.readVitalState(curVal, maxVal);
				if (!vital) return null;
				const temp = Number(document.getElementById("charsheet-ipt-hp-temp")?.value) || 0;
				return {
					label: "HP",
					value: temp > 0 ? `${curVal}+${temp}` : `${curVal}`,
					sub: `/${maxVal}`,
					ratio: vital.ratio,
					state: vital.state,
					expands: true,
				};
			},
		},
		{
			key: "ac",
			read: () => {
				const ac = document.getElementById("charsheet-disp-ac");
				if (!ac || !ac.textContent.trim()) return null;
				return {label: "AC", value: ac.textContent.trim()};
			},
			activate: () => document.getElementById("charsheet-box-ac")?.click(),
		},
		{
			key: "slots",
			read: () => {
				// "The slot you are most likely to spend" is the lowest level that
				// still has one. Pact slots fall out of the same scan in document
				// order — no Warlock special case.
				const levels = [...document.querySelectorAll("#charsheet-spell-slots [data-spell-level]")]
					.map(lvl => {
						const pips = [...lvl.querySelectorAll(".charsheet__spell-slot-pip")];
						const open = pips.filter(p => !p.classList.contains("charsheet__spell-slot-pip--used"));
						return {level: lvl.dataset.spellLevel, open: open.length, total: pips.length, target: open[0]};
					});
				const pick = CharacterSheetMobile.pickSlotLevel(levels);
				if (!pick) return null;
				return {
					label: pick.level === "pact" ? "Pact" : `Slot ${pick.level}`,
					value: `${pick.open}`,
					sub: `/${pick.total}`,
					target: pick.target,
				};
			},
			activate: model => model?.target?.click(),
		},
		{
			key: "resource",
			read: () => {
				const row = [...document.querySelectorAll(".charsheet__resource-row")]
					.find(r => {
						const btn = r.querySelector(".charsheet__resource-use-btn");
						return btn && !btn.disabled;
					});
				if (!row) return null;
				const name = row.querySelector(".charsheet__resource-name")?.textContent?.trim();
				const cur = row.querySelector(".charsheet__resource-current")?.textContent?.trim();
				// The source renders "/ 5" with a space; the strip is too narrow to
				// spend a character on it.
				const max = row.querySelector(".charsheet__resource-max")?.textContent?.replace(/\s+/g, "");
				if (!name || cur == null) return null;
				return {
					label: name,
					value: cur,
					sub: max || "",
					target: row.querySelector(".charsheet__resource-use-btn"),
				};
			},
			activate: model => model?.target?.click(),
		},
	];

	_initStatusStrip () {
		if (this._elStatusStrip) return;
		if (!document.querySelector(".charsheet-page")) return;

		this._elStatusStrip = this._createStatusStrip();
		document.body.appendChild(this._elStatusStrip);

		// One debounced observer over the sheet rather than one per source: the
		// numbers this mirrors are re-rendered wholesale by their owning modules,
		// so watching individual nodes would miss the replacements. The strip
		// lives outside `.charsheet-page`, so it cannot observe itself.
		this._boundSyncStatus = () => {
			if (this._statusSyncQueued) return;
			this._statusSyncQueued = true;
			requestAnimationFrame(() => {
				this._statusSyncQueued = false;
				this._syncStatusStrip();
			});
		};
		this._statusObserver = new MutationObserver(this._boundSyncStatus);
		this._statusObserver.observe(document.querySelector(".charsheet-page"), {
			childList: true, subtree: true, characterData: true,
		});
		// `.value` writes mutate a property, not an attribute, so the observer
		// never sees typed HP. Listen for the input directly.
		document.addEventListener("input", this._boundSyncStatus);
		document.addEventListener("change", this._boundSyncStatus);

		this._syncStatusStrip();
	}

	_createStatusStrip () {
		const strip = document.createElement("div");
		strip.id = "charsheet-mobile-status";
		strip.className = "charsheet-mobile__status";
		strip.setAttribute("role", "group");
		strip.setAttribute("aria-label", "Character status");

		const row = document.createElement("div");
		row.className = "charsheet-mobile__status-row";
		strip.appendChild(row);

		// The HP tray holds the two controls that need an amount, so the strip
		// itself stays a glance surface and never grows a numeric keypad.
		const tray = document.createElement("div");
		tray.className = "charsheet-mobile__status-tray";
		tray.hidden = true;
		[
			{id: "charsheet-btn-heal", txt: "💚 Heal", cls: "charsheet-mobile__status-tray-btn--heal"},
			{id: "charsheet-btn-damage", txt: "💔 Damage", cls: "charsheet-mobile__status-tray-btn--damage"},
		].forEach(spec => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `charsheet-mobile__status-tray-btn ${spec.cls}`;
			btn.textContent = spec.txt;
			btn.addEventListener("click", () => {
				this._closeStatusTray();
				document.getElementById(spec.id)?.click();
			});
			tray.appendChild(btn);
		});
		strip.appendChild(tray);
		this._elStatusTray = tray;

		return strip;
	}

	_syncStatusStrip () {
		const strip = this._elStatusStrip;
		if (!strip) return;
		const row = strip.querySelector(".charsheet-mobile__status-row");
		if (!row) return;

		this._statusModels = {};
		let rendered = 0;

		for (const seg of CharacterSheetMobile._STATUS_SEGMENTS) {
			let model = null;
			try {
				model = seg.read();
			} catch (e) {
				// A segment that cannot read its source hides itself. The strip is
				// an accelerator; it must never be the thing that breaks the sheet.
				model = null;
			}
			this._statusModels[seg.key] = model;

			let el = row.querySelector(`[data-seg="${seg.key}"]`);
			if (!model) {
				el?.remove();
				continue;
			}
			if (!el) el = this._createStatusSegment(seg);
			// Segments appear as their sources finish loading, and they do not
			// finish in declaration order. Re-seat every pass so the strip always
			// reads HP · AC · Slots · Resource rather than load order.
			if (row.children[rendered] !== el) row.insertBefore(el, row.children[rendered] || null);
			this._paintStatusSegment(el, model);
			rendered++;
		}

		// Nothing to say yet (no character, or still loading) — take the space back
		// rather than showing an empty bar.
		strip.classList.toggle("charsheet-mobile__status--empty", rendered === 0);
		document.body.classList.toggle("charsheet-mobile__has-status", rendered > 0);
		if (!rendered) this._closeStatusTray();
	}

	_createStatusSegment (seg) {
		const el = document.createElement("button");
		el.type = "button";
		el.dataset.seg = seg.key;
		el.className = `charsheet-mobile__status-seg charsheet-mobile__status-seg--${seg.key}`;
		el.innerHTML = `<span class="charsheet-mobile__status-label"></span>`
			+ `<span class="charsheet-mobile__status-readout">`
			+ `<span class="charsheet-mobile__status-value"></span>`
			+ `<span class="charsheet-mobile__status-sub"></span>`
			+ `</span>`
			+ `<span class="charsheet-mobile__status-bar"><i></i></span>`;
		el.addEventListener("click", () => {
			// Re-read at tap time rather than trusting the last paint: the owning
			// modules re-render these panels wholesale, so a cached element ref
			// can be detached by the time a thumb lands on it.
			let model = null;
			try {
				model = seg.read();
			} catch (e) { /* fall through to the no-op below */ }
			if (!model) return;
			if (model.expands) return this._toggleStatusTray();
			this._closeStatusTray();
			this._haptic("light");
			seg.activate?.(model);
		});
		return el;
	}

	_paintStatusSegment (el, model) {
		el.querySelector(".charsheet-mobile__status-label").textContent = model.label;
		el.querySelector(".charsheet-mobile__status-value").textContent = model.value;
		el.querySelector(".charsheet-mobile__status-sub").textContent = model.sub || "";
		const bar = el.querySelector(".charsheet-mobile__status-bar");
		if (model.ratio == null) {
			bar.hidden = true;
		} else {
			bar.hidden = false;
			el.querySelector(".charsheet-mobile__status-bar > i").style.transform = `scaleX(${model.ratio})`;
		}
		el.classList.toggle("charsheet-mobile__status-seg--warn", model.state === "warn");
		el.classList.toggle("charsheet-mobile__status-seg--critical", model.state === "critical");
		el.setAttribute("aria-label", `${model.label} ${model.value}${model.sub || ""}`);
	}

	_toggleStatusTray () {
		if (!this._elStatusTray) return;
		this._elStatusTray.hidden ? this._openStatusTray() : this._closeStatusTray();
	}

	_openStatusTray () {
		if (!this._elStatusTray) return;
		this._elStatusTray.hidden = false;
		this._elStatusStrip?.classList.add("charsheet-mobile__status--tray-open");
		this._haptic("light");
	}

	_closeStatusTray () {
		if (!this._elStatusTray) return;
		this._elStatusTray.hidden = true;
		this._elStatusStrip?.classList.remove("charsheet-mobile__status--tray-open");
	}

	_teardownStatusStrip () {
		this._statusObserver?.disconnect();
		this._statusObserver = null;
		if (this._boundSyncStatus) {
			document.removeEventListener("input", this._boundSyncStatus);
			document.removeEventListener("change", this._boundSyncStatus);
			this._boundSyncStatus = null;
		}
		this._elStatusStrip?.remove();
		this._elStatusStrip = null;
		this._elStatusTray = null;
		this._statusModels = null;
		this._statusSyncQueued = false;
		document.body.classList.remove("charsheet-mobile__has-status");
	}

	// =========================================================================
	// Header Toggle
	// =========================================================================

	_initHeaderToggle () {
		const secondaryRow = document.getElementById("charsheet-header-secondary");
		if (!secondaryRow) return;

		// Skip if already initialized
		if (secondaryRow.dataset.mobileToggle) return;
		secondaryRow.dataset.mobileToggle = "true";

		// Hook into the existing More button — the desktop handler toggles
		// charsheet__header-row--collapsed. We listen for that class change and
		// sync our mobile-specific expanded class.
		// Use a state guard to prevent infinite loop (our toggle triggers another mutation).
		let lastKnownCollapsed = secondaryRow.classList.contains("charsheet__header-row--collapsed");
		this._headerObserver = new MutationObserver(() => {
			const isDesktopCollapsed = secondaryRow.classList.contains("charsheet__header-row--collapsed");
			if (isDesktopCollapsed === lastKnownCollapsed) return;
			lastKnownCollapsed = isDesktopCollapsed;
			secondaryRow.classList.toggle("charsheet-mobile--expanded", !isDesktopCollapsed);
			// The same toggle also unfolds the management controls that mobile
			// hides from the primary row (XP, Level Up, Multiclass, Quick Build,
			// Roll Log, Alt View, Note). Reusing it keeps one control in charge
			// of "show me the management chrome" instead of adding a second.
			document.getElementById("charsheet-header")
				?.classList.toggle("charsheet-mobile__header--expanded", !isDesktopCollapsed);
		});
		this._headerObserver.observe(secondaryRow, {attributes: true, attributeFilter: ["class"]});
	}

	// =========================================================================
	// Touch Feedback
	// =========================================================================

	_initTouchFeedback () {
		const interactiveSelectors = [
			".charsheet__icon-btn",
			".charsheet__action-btn",
			".charsheet__tool-btn",
			".charsheet__quick-action",
			".charsheet__skill-row",
			".charsheet__save-row",
			".charsheet__attack-roll",
			".charsheet__attack-damage",
			".ve-btn",
		].join(", ");

		this._boundTouchFeedbackStart = (e) => {
			const target = e.target.closest(interactiveSelectors);
			if (target) {
				target.classList.add("charsheet-mobile--touch-active");
			}
		};

		this._boundTouchFeedbackEnd = () => {
			document.querySelectorAll(".charsheet-mobile--touch-active").forEach(el => {
				setTimeout(() => el.classList.remove("charsheet-mobile--touch-active"), 300);
			});
		};

		document.addEventListener("touchstart", this._boundTouchFeedbackStart, {passive: true});
		document.addEventListener("touchend", this._boundTouchFeedbackEnd, {passive: true});
	}

	// =========================================================================
	// Modal Scroll Lock (preserves scroll position)
	// =========================================================================

	_initModalScrollLock () {
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node.nodeType === 1 && (/** @type {*} */ (node)).classList?.contains("ve-ui-modal__overlay")) {
						this._lockScroll();
					}
				}
				for (const node of mutation.removedNodes) {
					if (node.nodeType === 1 && (/** @type {*} */ (node)).classList?.contains("ve-ui-modal__overlay")) {
						const remaining = document.querySelectorAll(".ve-ui-modal__overlay");
						if (!remaining.length) {
							this._unlockScroll();
						}
					}
				}
			}
		});

		observer.observe(document.body, {childList: true});
	}

	_lockScroll () {
		this._scrollYBeforeLock = window.scrollY;
		document.body.classList.add("charsheet-mobile--no-scroll");
		document.body.style.top = `-${this._scrollYBeforeLock}px`;
	}

	_unlockScroll () {
		document.body.classList.remove("charsheet-mobile--no-scroll");
		document.body.style.top = "";
		window.scrollTo(0, this._scrollYBeforeLock);
	}

	// =========================================================================
	// Dropdown Mobile Positioning
	// =========================================================================

	_initDropdownMobilePositioning () {
		// Watch for dropdown activation and re-position for mobile
		const dropdownSelectors = [
			".charsheet__theme-dropdown",
			".charsheet__font-dropdown",
			".charsheet__dice-dropdown",
			".charsheet__textsize-dropdown",
		];

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type !== "attributes" || mutation.attributeName !== "class") continue;
				const el = /** @type {*} */ (mutation.target);
				if (!dropdownSelectors.some(sel => el.matches(sel))) continue;

				if (el.classList.contains("active")) {
					this._repositionDropdown(el);
				}
			}
		});

		// Observe the header area where dropdowns live
		const header = document.querySelector(".charsheet__main-header");
		if (header) {
			observer.observe(header, {attributes: true, attributeFilter: ["class"], subtree: true});
		}
	}

	_repositionDropdown (dropdown) {
		if (!this._isMobile) return;

		// Clear previous inline positioning to avoid stale conflicts
		dropdown.style.left = "";
		dropdown.style.right = "";
		dropdown.style.maxHeight = "";
		dropdown.style.overflowY = "";

		// Re-read rect after clearing styles
		const rect = dropdown.getBoundingClientRect();
		const vpWidth = window.innerWidth;

		if (rect.right > vpWidth - 8) {
			dropdown.style.left = "auto";
			dropdown.style.right = "8px";
		}
		if (rect.left < 8) {
			dropdown.style.left = "8px";
			dropdown.style.right = "auto";
		}

		// Ensure dropdown doesn't extend beyond bottom tab bar
		const tabBarHeight = 60;
		const maxBottom = window.innerHeight - tabBarHeight;
		if (rect.bottom > maxBottom) {
			dropdown.style.maxHeight = `${maxBottom - rect.top - 8}px`;
			dropdown.style.overflowY = "auto";
		}
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	_simulateModifiedClick (target, modifiers = {}) {
		if (!target) return;
		const event = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			shiftKey: modifiers.shiftKey || false,
			ctrlKey: modifiers.ctrlKey || false,
			metaKey: modifiers.metaKey || false,
			altKey: modifiers.altKey || false,
		});
		target.dispatchEvent(event);
	}

	_haptic (intensity = "light") {
		if (!navigator.vibrate) return;
		switch (intensity) {
			case "light": navigator.vibrate(10); break;
			case "medium": navigator.vibrate(25); break;
			case "heavy": navigator.vibrate([25, 50, 25]); break;
		}
	}
}

// Loaded as a classic script, so no `export` — but publish the class the way
// every other character-sheet module does, so its pure policy statics are
// reachable from tests and from the console.
globalThis.CharacterSheetMobile = CharacterSheetMobile;

// Auto-initialize when DOM is ready. No page controller is passed: it does not
// exist yet at this point, and `_page` resolves it lazily instead.
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => {
		if (document.querySelector(".charsheet-page")) {
			(/** @type {*} */ (window))._charsheetMobile = new CharacterSheetMobile();
		}
	});
} else {
	if (document.querySelector(".charsheet-page")) {
		(/** @type {*} */ (window))._charsheetMobile = new CharacterSheetMobile();
	}
}
