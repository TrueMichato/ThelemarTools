// The shared e_ stub stores HTML as a string; these tests need the two
// disclosure descendants to support the DOM mutations made during rendering.
export function installFeatureDisclosureDom () {
	const originalE = globalThis.e_;
	globalThis.e_ = (opts = {}) => {
		const featureEl = originalE(opts);
		if (!opts.outer?.includes("<div class=\"charsheet__feature\"")) {
			if (opts.outer?.includes("charsheet__feature-body")) throw new Error("Feature disclosure root was not recognized by the test DOM fixture.");
			return featureEl;
		}

		const originalQuerySelector = featureEl.querySelector.bind(featureEl);
		featureEl.querySelector = selector => {
			if (selector !== ".charsheet__feature-body" && selector !== ".charsheet__feature-toggle") {
				return originalQuerySelector(selector);
			}

			const tag = selector === ".charsheet__feature-body" ? "div" : "button";
			const className = selector.slice(1);
			const openingTag = new RegExp(`<${tag}\\b[^>]*\\bclass="[^"]*\\b${className}(?=\\s|")[^"]*"[^>]*>`);
			if (!openingTag.test(featureEl.outerHTML)) throw new Error(`Feature disclosure ${selector} is missing from rendered HTML.`);

			const setAttribute = (name, value) => {
				featureEl.outerHTML = featureEl.outerHTML.replace(openingTag, markup => {
					const attribute = new RegExp(`\\s${name}="[^"]*"`);
					const replacement = ` ${name}="${value}"`;
					return attribute.test(markup)
						? markup.replace(attribute, replacement)
						: markup.replace(/>$/, `${replacement}>`);
				});
			};
			return {
				set id (value) { setAttribute("id", value); },
				setAttribute,
			};
		};
		return featureEl;
	};
	return () => { globalThis.e_ = originalE; };
}
