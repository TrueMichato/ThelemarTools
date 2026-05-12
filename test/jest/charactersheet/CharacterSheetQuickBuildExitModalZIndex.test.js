import fs from "fs";
import path from "path";

const quickBuildSrc = fs.readFileSync(
	path.resolve(process.cwd(), "js/charactersheet/charactersheet-quickbuild.js"),
	"utf8",
);
const utilsUiSrc = fs.readFileSync(
	path.resolve(process.cwd(), "js/utils-ui.js"),
	"utf8",
);

describe("QuickBuild exit confirmation modal — z-index plumbing", () => {
	test("_closeWizard's pGetUserBoolean call passes zIndex above the QuickBuild overlay (9999)", () => {
		// Locate the "Close Quick Build?" pGetUserBoolean opts block and ensure it contains zIndex: 10000+.
		const reBlock = /pGetUserBoolean\([^)]*?title:\s*"Close Quick Build\?"[\s\S]*?\}\)/;
		const match = quickBuildSrc.match(reBlock);
		expect(match).not.toBeNull();
		const block = match[0];
		const zMatch = block.match(/zIndex:\s*(\d+)/);
		expect(zMatch).not.toBeNull();
		expect(Number(zMatch[1])).toBeGreaterThan(9999);
	});

	test("Divine Soul subclass picker pGetUserEnum already passes zIndex above 9999", () => {
		const reBlock = /pGetUserEnum\([^)]*?title:\s*"Divine Soul Affinity"[\s\S]*?\}\)/;
		const match = quickBuildSrc.match(reBlock);
		expect(match).not.toBeNull();
		const block = match[0];
		const zMatch = block.match(/zIndex:\s*(\d+)/);
		expect(zMatch).not.toBeNull();
		expect(Number(zMatch[1])).toBeGreaterThan(9999);
	});
});

describe("InputUiUtil — zIndex plumbing through generic-button modal", () => {
	test("pGetUserBoolean accepts a zIndex option", () => {
		// Locate the pGetUserBoolean destructured-opts block and ensure `zIndex` is destructured.
		const reFn = /static async pGetUserBoolean \(\s*\{([\s\S]*?)\}\s*,?\s*\)\s*\{/;
		const match = utilsUiSrc.match(reFn);
		expect(match).not.toBeNull();
		expect(match[1]).toMatch(/\bzIndex\b/);
	});

	test("pGetUserBoolean forwards zIndex to pGetUserGenericButton", () => {
		// Find the `return this.pGetUserGenericButton({...})` call near the end of pGetUserBoolean and check it includes zIndex.
		const reCall = /return this\.pGetUserGenericButton\(\{([\s\S]*?)\}\);/;
		const match = utilsUiSrc.match(reCall);
		expect(match).not.toBeNull();
		expect(match[1]).toMatch(/\bzIndex\b/);
	});

	test("pGetUserGenericButton accepts a zIndex option", () => {
		const reFn = /static async pGetUserGenericButton \(\s*\{([\s\S]*?)\}\s*,?\s*\)\s*\{/;
		const match = utilsUiSrc.match(reFn);
		expect(match).not.toBeNull();
		expect(match[1]).toMatch(/\bzIndex\b/);
	});

	test("pGetUserGenericButton forwards zIndex into _pGetShowModal opts via conditional spread", () => {
		// Match the conditional-spread pattern inside pGetUserGenericButton's body
		// (same pattern used by pGetUserEnum). The inner `{zIndex} : {}` braces
		// confuse a naive non-greedy match, so just look anywhere within the function.
		const reFn = /static async pGetUserGenericButton[\s\S]*?\n\t\}\n/;
		const match = utilsUiSrc.match(reFn);
		expect(match).not.toBeNull();
		expect(match[0]).toMatch(/\.\.\.\(zIndex\s*!=\s*null\s*\?\s*\{zIndex\}\s*:\s*\{\}\)/);
		// And confirm the spread is being passed to _pGetShowModal.
		expect(match[0]).toMatch(/_pGetShowModal\(\{[\s\S]*?\.\.\.\(zIndex\s*!=\s*null/);
	});
});
