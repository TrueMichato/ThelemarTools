import fs from "fs";
import os from "os";
import path from "path";
import {execFileSync} from "child_process";

/**
 * `data/crafting.json` is generated from the six crafting source books plus Thelemar's variant
 * components. Both `crafting.html` and the character sheet read it, so a stale regeneration is the
 * one way the two surfaces can quietly disagree about what a component is or what a material costs.
 *
 * Regenerating is deterministic and byte-stable (the generator writes through
 * `CleanUtil.getCleanJson`), so a plain diff is a reliable freshness check.
 */
describe("data/crafting.json freshness", () => {
	const OUT_PATH = path.resolve("data/crafting.json");

	it("matches a fresh run of the generator", () => {
		expect(fs.existsSync(OUT_PATH)).toBe(true);

		const committed = fs.readFileSync(OUT_PATH, "utf-8");
		const backup = path.join(os.tmpdir(), `crafting-committed-${process.pid}.json`);
		fs.writeFileSync(backup, committed, "utf-8");

		let regenerated;
		try {
			// The generator only ever writes to OUT_PATH, so run it and read the result back
			execFileSync("node", ["node/generate-crafting-data.js", "--offline"], {stdio: "pipe"});
			regenerated = fs.readFileSync(OUT_PATH, "utf-8");
		} finally {
			// Always restore, so a failing assertion never leaves the working tree dirty
			fs.writeFileSync(OUT_PATH, committed, "utf-8");
			fs.rmSync(backup, {force: true});
		}

		if (regenerated !== committed) {
			const committedJson = JSON.parse(committed);
			const freshJson = JSON.parse(regenerated);
			const counts = (json) => `craftingMaterial ${json.craftingMaterial.length}, craftingRecipe ${json.craftingRecipe.length}, craftingRule ${json.craftingRule.length}, itemMaterial ${json.itemMaterial?.length ?? 0}`;

			throw new Error(
				`data/crafting.json is stale — run \`npm run gen:crafting\` and commit the result.\n`
				+ `  committed: ${counts(committedJson)}\n`
				+ `  fresh:     ${counts(freshJson)}\n`
				+ `Editing data/items-variant-components-ar8.json or Thelemar's variant components without\n`
				+ `regenerating leaves crafting.html disagreeing with the character sheet.`,
			);
		}

		expect(regenerated).toBe(committed);
	}, 120_000);
});
