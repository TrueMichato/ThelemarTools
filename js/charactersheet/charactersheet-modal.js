"use strict";

/**
 * The character sheet's modal front door.
 *
 * Every character-sheet dialog goes through here instead of calling
 * `UiUtil.pGetShowModal` directly. The signature and return shape are identical, so a call site
 * migrates by changing the function name and nothing else. What this adds is the part no
 * individual call site should have to remember:
 *
 *   - `role="dialog"`, `aria-modal="true"` and an `aria-labelledby` pointing at the header, so a
 *     screen reader announces a dialog rather than reading the page behind it.
 *   - A close button in the header. `UiUtil` only renders one in `isFullscreenModal` mode, which
 *     also swaps in an overlay blind and fullscreen header/footer variants — far too much to opt
 *     into for a button. The `eleTitleSplit` slot lands in the same header row with no side
 *     effects.
 *   - Escape that works from inside a text input. `UiUtil`'s document-level handler bails on
 *     `EventUtil.isInInput`, and several of our modals autofocus a search field on open, so
 *     Escape was dead exactly when the user was most likely to press it.
 *   - A Tab focus trap, and focus returned to whatever opened the modal once it closes. Without
 *     the restore, focus lands on `<body>` and keyboard users start over from the top of the page.
 *
 * Three things about this file are load-bearing:
 *
 *   1. `UiUtil.pGetShowModal` is looked up at call time, never captured at module load.
 *      `CharacterSheetSpawnPrompts` monkey-patches that method to auto-answer dialogs during
 *      `?spawn=` builds and E2E runs; a captured reference would silently bypass the patch and
 *      hang the harness on a modal nobody will click.
 *   2. `eleModal` may be absent. The spawn harness's fallback stub returns only `eleModalInner`,
 *      `doClose`, `pGetResolved` and `doAutoResize`, so every enhancement here is guarded.
 *   3. A caller's own `cbClose` is composed with, never replaced. Dozens of call sites rely on it
 *      to persist state.
 */
class CharacterSheetModal {
	static _uid = 0;

	/** Elements that can hold focus, in document order. Excludes anything hidden or disabled. */
	static _FOCUSABLE_SELECTOR = [
		"a[href]",
		"button:not([disabled])",
		"input:not([disabled]):not([type=hidden])",
		"select:not([disabled])",
		"textarea:not([disabled])",
		`[tabindex]:not([tabindex="-1"])`,
	].join(", ");

	/**
	 * Drop-in replacement for `UiUtil.pGetShowModal`.
	 *
	 * @param {object} [opts] Passed through untouched, minus the options this owns.
	 * @param {boolean} [opts.isSkipCharacterSheetEnhancements] Escape hatch — behave exactly like
	 *        the underlying `UiUtil` call. For dialogs that manage their own header or focus.
	 * @returns {Promise<object>} The `UiUtil` modal handle.
	 */
	static async pGetShow (opts) {
		opts = opts || {};

		if (opts.isSkipCharacterSheetEnhancements) {
			const {isSkipCharacterSheetEnhancements, ...rest} = opts;
			return CharacterSheetModal._pGetShowModalRaw(rest);
		}

		// `UiUtil.getShowModal` blurs the active element before building the modal, so the trigger
		// has to be read here, not after the await.
		const eleTrigger = CharacterSheetModal._getRestoreTarget();

		const isCloseable = !opts.isPermanent;
		const headerId = `cs-modal-title-${++CharacterSheetModal._uid}`;

		// A close button is only useful if there is a header to put it in, and only honest if the
		// modal can actually be closed.
		const btnClose = (isCloseable && opts.title && !opts.isEmpty)
			? CharacterSheetModal._getBtnClose()
			: null;

		const eleTitleSplit = CharacterSheetModal._getMergedTitleSplit(opts, btnClose);

		const optsOut = {...opts};
		if (eleTitleSplit) {
			// eslint-disable-next-line vet-jquery/jquery -- deleting the jQuery option, not using it
			delete optsOut.$titleSplit;
			optsOut.eleTitleSplit = eleTitleSplit;
		}

		let doRestoreFocus = null;
		const cbCloseOriginal = opts.cbClose;
		optsOut.cbClose = async (...args) => {
			let out;
			if (cbCloseOriginal) out = await cbCloseOriginal(...args);
			// Restore after the caller's callback — it may itself open a follow-up modal, in which
			// case that modal's own trigger capture should win.
			if (doRestoreFocus) doRestoreFocus();
			return out;
		};

		const modal = await CharacterSheetModal._pGetShowModalRaw(optsOut);

		doRestoreFocus = () => CharacterSheetModal._doRestoreFocus(eleTrigger);

		// The spawn harness's fallback stub has no `eleModal`; there is nothing to enhance.
		if (!modal?.eleModal) return modal;

		if (btnClose) btnClose.addEventListener("click", () => modal.doClose(false));

		CharacterSheetModal._decorate({modal, opts, headerId, isCloseable});

		return modal;
	}

	/**
	 * Always resolved at call time — see the class comment, point 1.
	 */
	static _pGetShowModalRaw (opts) {
		return globalThis.UiUtil.pGetShowModal(opts);
	}

	static _getBtnClose () {
		return ee`<button class="ve-btn ve-btn-default ve-btn-xs cs-modal__btn-close" type="button" title="Close (Esc)" aria-label="Close"><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></button>`;
	}

	/**
	 * `UiUtil` renders exactly one title-split element, and rejects being given both the jQuery and
	 * the plain-element form. Wrap whatever the caller passed alongside our close button.
	 */
	static _getMergedTitleSplit (opts, btnClose) {
		/* eslint-disable vet-jquery/jquery */
		const eleCaller = opts.eleTitleSplit || (opts.$titleSplit ? opts.$titleSplit[0] : null);
		/* eslint-enable vet-jquery/jquery */

		if (!btnClose) return eleCaller || null;
		if (!eleCaller) return btnClose;

		return ee`<div class="ve-flex-v-center ve-gap-1"></div>`.appends(eleCaller).appends(btnClose);
	}

	static _decorate ({modal, opts, headerId, isCloseable}) {
		const eleModal = modal.eleModal;

		eleModal.setAttribute("role", "dialog");
		eleModal.setAttribute("aria-modal", "true");
		// Deliberately NOT `.cs-adaptive-panel`: `container-type: inline-size` implies inline-size
		// containment, and most CS modals shrink to fit their content, so containerising the shell
		// would collapse them to zero width. Content roots inside a `isWidth100` modal opt in
		// individually.
		eleModal.classList.add("cs-modal");

		const eleHeader = eleModal.querySelector("h1, h2, h3, h4, h5, h6");
		if (eleHeader) {
			eleHeader.id = headerId;
			eleModal.setAttribute("aria-labelledby", headerId);
		} else if (opts.title) {
			eleModal.setAttribute("aria-label", opts.title);
		}

		eleModal.addEventListener("keydown", evt => {
			if (evt.key === "Escape") {
				if (!isCloseable) return;
				// The document-level handler in `UiUtil` bails inside inputs, so handle it here
				// where we know the event is ours.
				if (!globalThis.EventUtil?.isInInput?.(evt)) return;
				evt.stopPropagation();
				evt.preventDefault();
				modal.doClose(false);
				return;
			}

			if (evt.key === "Tab") CharacterSheetModal._handleTab(evt, eleModal);
		});
	}

	static _handleTab (evt, eleModal) {
		const focusable = [...eleModal.querySelectorAll(CharacterSheetModal._FOCUSABLE_SELECTOR)]
			.filter(ele => ele.offsetParent !== null || ele === document.activeElement);
		if (!focusable.length) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;

		if (evt.shiftKey && (active === first || !eleModal.contains(active))) {
			evt.preventDefault();
			last.focus();
			return;
		}

		if (!evt.shiftKey && active === last) {
			evt.preventDefault();
			first.focus();
		}
	}

	/**
	 * The element focus should come back to. Ignores `<body>`, which is what the browser reports
	 * when a click has moved focus nowhere useful.
	 */
	static _getRestoreTarget () {
		const active = typeof document !== "undefined" ? document.activeElement : null;
		if (!active || active === document.body) return null;
		return active;
	}

	static _doRestoreFocus (eleTrigger) {
		if (!eleTrigger?.isConnected || typeof eleTrigger.focus !== "function") return;
		// Deferred so it lands after the modal has been removed from the DOM; focusing a node while
		// an overlay is still up can be scrolled away by the overlay's own teardown.
		setTimeout(() => {
			try { eleTrigger.focus({preventScroll: true}); } catch (e) { void e; }
		}, 0);
	}
}

export {CharacterSheetModal};
globalThis.CharacterSheetModal = CharacterSheetModal;
