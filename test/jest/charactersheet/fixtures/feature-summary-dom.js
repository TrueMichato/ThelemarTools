import {installFeatureDisclosureDom} from "./feature-disclosure-dom.js";

// Extend the existing string DOM only for the class-group body and modal footer.
export function installFeatureSummaryDom () {
	const originalE = globalThis.e_;
	const originalEe = globalThis.ee;
	const restoreDisclosure = installFeatureDisclosureDom();
	const disclosureE = globalThis.e_;
	const createElement = (opts = {}) => {
		const tag = opts.tag || "div";
		const outer = opts.outer ?? `<${tag} class="${opts.clazz || ""}">${opts.txt || ""}</${tag}>`;
		const el = disclosureE({...opts, outer});
		Object.defineProperty(el, "innerHTML", {
			get: () => el._html,
			set: value => {
				el._html = value;
				el._children = [];
			},
		});
		const querySelector = el.querySelector.bind(el);
		const descendants = new Map();
		el.querySelector = selector => {
			if (descendants.has(selector)) return descendants.get(selector);
			if (selector === ".charsheet__feature-group-body" && outer.includes("charsheet__feature-group-body")) {
				const body = originalE();
				const append = body.append.bind(body);
				body.append = (...children) => {
					append(...children);
					el.outerHTML = outer.replace(
						"<div class=\"charsheet__feature-group-body\"></div>",
						`<div class="charsheet__feature-group-body">${body.innerHTML}</div>`,
					);
				};
				descendants.set(selector, body);
				return body;
			}
			if (selector === "button" && outer.includes("<button")) {
				const button = originalE({outer: outer.match(/<button\b[^>]*>[\s\S]*?<\/button>/)[0]});
				descendants.set(selector, button);
				return button;
			}
			return querySelector(selector);
		};
		return el;
	};
	globalThis.e_ = createElement;
	globalThis.ee = (strings, ...values) => createElement({
		outer: strings.reduce((html, part, i) => html + part + (values[i] ?? ""), ""),
	});
	return {
		createElement,
		restore: () => {
			restoreDisclosure();
			globalThis.e_ = originalE;
			globalThis.ee = originalEe;
		},
	};
}
