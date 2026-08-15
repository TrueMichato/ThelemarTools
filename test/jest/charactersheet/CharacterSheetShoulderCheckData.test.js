import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brewPath = path.resolve(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json");

describe("TGTT Shoulder Check data", () => {
	test("is valid JSON and makes the target save against your method DC", () => {
		const brew = JSON.parse(fs.readFileSync(brewPath, "utf8"));
		const methods = brew.combatMethod || brew.combatmethod || [];
		const shoulderCheck = methods.find(method => method.name === "Shoulder Check");

		expect(shoulderCheck).toBeDefined();
		const text = shoulderCheck.entries.join(" ");
		expect(text).toMatch(/creature to make a Strength saving throw against your method DC/i);
		expect(text).toMatch(/On a failure, you shove the creature/i);
		expect(text).not.toMatch(/you can use your reaction to make an Athletics check/i);
		expect(text).not.toMatch(/against the creature's method DC/i);
	});
});
