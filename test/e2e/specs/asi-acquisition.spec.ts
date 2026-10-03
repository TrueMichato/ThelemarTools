import {expect, test} from "@playwright/test";
import {AsiAcquisitionPage} from "../pages/AsiAcquisitionPage";

for (const source of ["PHB", "XPHB", "TGTT"]) {
	for (const className of ["Monk", "Sorcerer"]) {
		test(`${className}|${source} exposes actual LevelUp and QuickBuild improvement controls`, async ({page}) => {
			test.setTimeout(90_000);
			const asi = new AsiAcquisitionPage(page);
			await asi.load();
			await asi.spawn(className, source, 3);
			await asi.openLevelUp();
			await asi.expectOrdinaryLevelUpControls();
			await asi.levelUp.cancel();
			await asi.openQuickBuild(4);
			await asi.expectQuickBuildImprovement(className, 4);
		});
	}
}

test("installed TGTT Sorcerer retains ordinary ASI and Thelemar feat controls", async ({page}) => {
	test.setTimeout(90_000);
	const asi = new AsiAcquisitionPage(page);
	await asi.load(true);
	await asi.spawn("Sorcerer", "TGTT", 3, true);
	await asi.openLevelUp();
	await asi.expectOrdinaryLevelUpControls(true);
});

test("TGTT Sorcerer QuickBuild independently exposes the authored improvement", async ({page}) => {
	const asi = new AsiAcquisitionPage(page);
	await asi.load();
	await asi.spawn("Sorcerer", "TGTT", 3);
	await asi.openQuickBuild(4);
	await asi.expectQuickBuildImprovement("Sorcerer", 4);
});

test("a second ASI feat can be acquired through QuickBuild and repeated manually after LevelUp", async ({page}) => {
	test.setTimeout(90_000);
	const asi = new AsiAcquisitionPage(page);
	await asi.load();
	await asi.spawn("Fighter", "XPHB", 3);
	const before = await asi.evidence();
	await asi.openLevelUp();
	await asi.takeLevelUpAsiFeat(["str"]);
	await asi.openQuickBuild(6);
	await asi.takeQuickBuildAsiFeat("Fighter", 6, ["dex", "wis"]);
	await asi.finishQuickBuild();
	const acquired = await asi.evidence();
	expect(acquired.feats).toHaveLength(2);
	expect(new Set(acquired.feats.map(feat => feat.id)).size).toBe(2);
	expect(new Set(acquired.feats.map(feat => feat.sourceDecisionKey)).size).toBe(2);
	expect(acquired.bases).toMatchObject({
		str: before.bases.str + 2,
		dex: before.bases.dex + 1,
		wis: before.bases.wis + 1,
	});
	expect(acquired.feats.map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{str: 2}, {dex: 1, wis: 1}]);
	await asi.addManualAsi(["con"]);
	const repeated = await asi.evidence();
	expect(repeated.feats).toHaveLength(3);
	expect(new Set(repeated.feats.map(feat => feat.sourceDecisionKey)).size).toBe(3);
	expect(repeated.bases.con).toBe(before.bases.con + 2);
	await asi.reload();
	const reloaded = await asi.evidence();
	expect(reloaded.bases).toEqual(repeated.bases);
	expect(reloaded.feats).toEqual(repeated.feats);
});

for (const secondWizard of ["LevelUp", "QuickBuild"]) {
	test(`restored TGTT Sorcerer repeats a shallow saved ASI through the main ${secondWizard} picker with Thelemar policy`, async ({page}) => {
		test.setTimeout(120_000);
		const asi = new AsiAcquisitionPage(page);
		await asi.load();
		await asi.spawn("Sorcerer", "TGTT", 3, true);
		const before = await asi.evidence();
		await asi.openLevelUp();
		await asi.allocateOrdinaryLevelUpAsi("con");
		await asi.takeLevelUpAsiFeat(["str"]);
		await asi.makeSavedFeatMetadataShallow();
		const first = await asi.evidence();
		const ordinary = first.history.flatMap(entry => entry.decisions || []).find(decision => decision.type === "asi" && decision.classLevel === 4);
		expect(ordinary).toMatchObject({className: "Sorcerer", classSource: "TGTT", classLevel: 4});
		expect(ordinary?.receipt).toMatchObject({version: 1, sourceDecisionKey: ordinary?.semanticKey});
		expect(ordinary?.receipt?.effects.filter(effect => effect.type === "abilityDelta")).toEqual([{
			type: "abilityDelta", ability: "con", before: before.bases.con, after: Math.min(20, before.bases.con + 2),
			amount: Math.min(20, before.bases.con + 2) - before.bases.con, sourceDecisionKey: ordinary?.semanticKey,
		}]);
		expect(first.feats[0].sourceDecisionKey).not.toBe(ordinary?.semanticKey);
		if (secondWizard === "LevelUp") {
			for (let level = 5; level <= 7; level++) await asi.advanceWithoutImprovement();
			await asi.openLevelUp();
			await asi.takeLevelUpAsiFeat(["dex", "wis"]);
		} else {
			await asi.openQuickBuild(8);
			await asi.takeQuickBuildAsiFeat("Sorcerer", 8, ["dex", "wis"]);
			await asi.finishQuickBuild();
		}
		const repeated = await asi.evidence();
		expect(repeated.feats).toHaveLength(2);
		expect(new Set(repeated.feats.map(feat => feat.id)).size).toBe(2);
		expect(new Set(repeated.feats.map(feat => feat.sourceDecisionKey)).size).toBe(2);
		expect(repeated.feats.map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{str: 2}, {dex: 1, wis: 1}]);
		expect(repeated.bases).toMatchObject({str: first.bases.str, dex: first.bases.dex + 1, wis: first.bases.wis + 1});
		await asi.reload();
		const reloaded = await asi.evidence();
		expect(reloaded.feats).toEqual(repeated.feats);
		expect(reloaded.history.flatMap(entry => entry.decisions || []).find(decision => decision.semanticKey === ordinary?.semanticKey)?.receipt)
			.toEqual(ordinary?.receipt);
	});
}
