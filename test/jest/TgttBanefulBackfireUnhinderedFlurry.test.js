import fs from "node:fs";

import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-config.js";
import "../../js/render.js";

const brew = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));

const getTgttEntity = (type, name) => {
	const matches = brew[type].filter(it => it.name === name && it.source === "TGTT");
	expect(matches).toHaveLength(1);
	return matches[0];
};

describe("TGTT spell and Monk feature descriptions", () => {
	it("renders Andrui's Baneful Backfire as lasting until triggered by Dispel Magic", () => {
		const spell = getTgttEntity("spell", "Andrui's Baneful Backfire");

		expect(spell.duration).toEqual([{type: "permanent", ends: ["trigger"]}]);
		expect(Renderer.spell.getHtmlPtDuration(spell, {styleHint: "one"})).toBe("<b>Duration:</b> Until triggered");

		const description = spell.entries.join(" ");
		expect(description).toMatch(/remains dormant until a creature attempts to cast \{@spell dispel magic\} on the object/i);
		expect(description).toMatch(/dispel to fail automatically.*loses one spell slot of a level equal to the spell slot level it used/i);
		expect(description).toMatch(/backfire fails if the \{@spell dispel magic\} was cast with a higher level spell slot/i);
	});

	it("states the free Unhindered Flurry rule with a valid 2024 Monk feature link", () => {
		const feature = getTgttEntity("classFeature", "Unhindered Flurry");
		expect(feature.className).toBe("Monk");
		expect(feature.classSource).toBe("TGTT");
		expect(feature.level).toBe(8);
		expect(feature.entries).toHaveLength(1);

		const [description] = feature.entries;
		const match = /^At 8th level, you can use \{@classFeature ([^}]+)\} without expending any Focus Points\.$/.exec(description);
		expect(match).not.toBeNull();
		const uid = match[1];
		expect(DataUtil.class.unpackUidClassFeature(uid)).toMatchObject({
			name: "Flurry of Blows",
			className: "Monk",
			classSource: "XPHB",
			level: 2,
			source: "XPHB",
		});
		const html = Renderer.get().render(description);
		expect(html).toContain("data-vet-source=\"XPHB\"");
		expect(html).toContain("data-vet-hash=\"flurry%20of%20blows_monk_xphb_2_xphb\"");
	});
});
