import fs from "node:fs";
import {validateCampaignBrewBundle} from "../../../server/src/campaign-content.js";

const charactersheet = fs.readFileSync(new URL("../../../js/charactersheet/charactersheet.js", import.meta.url), "utf8");
const partyTracker = fs.readFileSync(new URL("../../../js/dmscreen/partytracker/dmscreen-partytracker-character.js", import.meta.url), "utf8");

describe("cloud-data XSS boundaries", () => {
	it("does not interpolate character names into dropdown option HTML", () => {
		expect(charactersheet).not.toMatch(/insertAdjacentHTML\([^)]*char\.(?:name|id)/);
		expect(charactersheet).toContain("option.textContent = label");
	});

	it("renders Party Tracker identity and custom status text through text APIs", () => {
		expect(partyTracker).toContain(".txt(this._data.name");
		expect(partyTracker).toContain(".txt(cond.name)");
		expect(partyTracker).toMatch(/\.txt\(`\$\{cond\.name\} `\)/);
		expect(partyTracker).toMatch(/\.txt\(`\$\{disease\.name\} `\)/);
		expect(partyTracker).not.toContain("value=\"${cls.name");
		expect(partyTracker).not.toContain("value=\"${counter.name");
		expect(partyTracker).not.toContain("value=\"${this._data[prop]");
	});

	it.each([
		"<a href=\"javascript:alert(1)\">click</a>",
		"<img src=x>",
		"<div>raw</div>",
	])("rejects all raw HTML in campaign brew: %s", raw => {
		const docs = [{
			head: {filename: "x.json"},
			body: {
				_meta: {sources: [{json: "X"}]},
				spell: [{name: "X", source: "X", entries: [raw]}],
			},
		}];
		expect(() => validateCampaignBrewBundle(docs)).toThrow(expect.objectContaining({code: "BREW_RAW_HTML_FORBIDDEN"}));
	});
});
