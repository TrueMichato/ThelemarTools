/**
 * Pure helpers for the Bestiary "Wide View" toggle (statblock + lore side-by-side).
 *
 * The visual layout lives in `scss/bestiary.scss` (`.bestiary__wrp-content--wide-active`) and the
 * DOM wiring in `js/bestiary.js`; the decisions here are extracted as pure functions so the
 * silent-gating UX (a toggle that is on but can't take visible effect) can be unit-tested without a
 * DOM. Wide View only actually changes anything when BOTH the viewport is at least
 * `WIDE_MODE_MEDIA_QUERY` wide AND the current creature has lore/images to show beside the
 * statblock — otherwise the button is marked muted with an explanatory tooltip so it doesn't read
 * as "broken".
 */
export class BestiaryWideModeUtil {
	/**
	 * Whether Wide View is currently taking visible effect.
	 * @param {boolean} isToggledOn The user's persisted Wide View preference.
	 * @param {boolean} isViewportWide Whether the viewport meets the wide-mode breakpoint.
	 * @returns {boolean}
	 */
	static isWideModeActive ({isToggledOn, isViewportWide}) {
		return !!isToggledOn && !!isViewportWide;
	}

	/**
	 * Compute the Wide-View button's muted state + tooltip so silent gating is self-explanatory.
	 * @param {boolean} isToggledOn The user's persisted Wide View preference.
	 * @param {boolean} isViewportWide Whether the viewport meets the wide-mode breakpoint.
	 * @param {boolean} hasFluff Whether the rendered creature has lore text/images.
	 * @returns {{isActive: boolean, isMuted: boolean, title: string}}
	 */
	static getButtonState ({isToggledOn, isViewportWide, hasFluff}) {
		const isMuted = !!isToggledOn && (!isViewportWide || !hasFluff);

		let title = "Show statblock and lore side-by-side (requires a wide viewport)";
		if (isToggledOn && !isViewportWide) title = "Wide View is on, but needs a window at least 1600px wide to take effect.";
		else if (isToggledOn && !hasFluff) title = "Wide View is on, but this creature has no lore or images to show beside the statblock.";

		return {isActive: !!isToggledOn, isMuted, title};
	}
}
