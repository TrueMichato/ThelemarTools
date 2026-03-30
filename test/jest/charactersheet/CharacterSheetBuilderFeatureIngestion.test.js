import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

describe("CharacterSheetBuilder feature entry ingestion", () => {
	test("_addFeatureEntries preserves metadata-first fields", () => {
		const captured = [];
		const builder = Object.create(CharacterSheetBuilder.prototype);
		builder._state = {
			addFeature: (feature) => captured.push(feature),
		};

		const entry = {
			name: "Ancestral Burst",
			entries: [{type: "entries", entries: ["You can unleash a burst of force."]}],
			activatable: {
				interactionMode: "trigger",
				activationAction: "reaction",
				effects: [{type: "bonus", target: "ac", value: 1}],
			},
			effects: [{type: "resistance", target: "force"}],
			uses: {current: 1, max: 1, recharge: "long"},
		};

		builder._addFeatureEntries([entry], "HB", "Species");

		expect(captured).toHaveLength(1);
		expect(captured[0].name).toBe("Ancestral Burst");
		expect(captured[0].source).toBe("HB");
		expect(captured[0].featureType).toBe("Species");
		expect(captured[0].activatable).toEqual(entry.activatable);
		expect(captured[0].effects).toEqual(entry.effects);
		expect(captured[0].uses).toEqual(entry.uses);
		expect(captured[0].description).toBeTruthy();
	});

	test("_addFeatureEntries keeps explicit entry source over fallback source", () => {
		const captured = [];
		const builder = Object.create(CharacterSheetBuilder.prototype);
		builder._state = {
			addFeature: (feature) => captured.push(feature),
		};

		builder._addFeatureEntries([
			{
				name: "Shadow Gift",
				source: "BookOfEbonTides",
				entries: [{type: "entries", entries: ["You gain shadow affinity."]}],
			},
		], "HB", "Background");

		expect(captured).toHaveLength(1);
		expect(captured[0].source).toBe("BookOfEbonTides");
		expect(captured[0].featureType).toBe("Background");
	});
});
describe("CharacterSheetBuilder race optional feature choices (Nyuidj pattern)", () => {
        let CharacterSheetBuilder;

        beforeAll(() => {
                CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
        });

        function makeBuilder (optionalFeatures = []) {
                const builder = Object.create(CharacterSheetBuilder.prototype);
                builder._selectedRaceOptionalFeatures = {};
                builder._page = {
                        getOptionalFeatures: () => optionalFeatures,
                        resolveOptionalFeatureSource: (name, sources) => sources[0] || "TGTT",
                };
                return builder;
        }

        const DREAMWALK = {name: "Dreamwalk", source: "TGTT", featureType: ["DW:C"], prerequisite: []};
        const DREAMBEND = {name: "Dreambend", source: "TGTT", featureType: ["DW:C"], prerequisite: []};
        const DREAMWATCH = {name: "Dreamwatch", source: "TGTT", featureType: ["DW:C"], prerequisite: []};
        const DREAMJUMP = {
                name: "Dreamjump", source: "TGTT", featureType: ["DW:S"],
                prerequisite: [{otherSummary: {entry: "{@optfeature Dreamwalk|TGTT} ability", entrySummary: "Dreamwalk"}}],
        };
        const DREAMSNATCH = {
                name: "Dreamsnatch", source: "TGTT", featureType: ["DW:S"],
                prerequisite: [{otherSummary: {entry: "{@optfeature Dreamwatch|TGTT} ability", entrySummary: "Dreamwatch"}}],
        };

        const NYUIDJ_RACE = {
                name: "Nyuidj",
                source: "TGTT",
                featureGrants: [{name: "Dreamwalk", source: "TGTT"}],
                optionalfeatureProgression: [{
                        name: "Dreamwalker Ability",
                        featureType: ["DW:C", "DW:S"],
                        progression: {"1": 1},
                }],
        };

        test("returns null for a race without optionalfeatureProgression", () => {
                const builder = makeBuilder([DREAMWALK, DREAMBEND]);
                const result = builder._renderRaceOptionalFeatureChoices({name: "Human", source: "PHB"});
                expect(result).toBeNull();
        });

        test("returns a container element for Nyuidj (has optionalfeatureProgression)", () => {
                const builder = makeBuilder([DREAMWALK, DREAMBEND, DREAMWATCH, DREAMJUMP, DREAMSNATCH]);
                const result = builder._renderRaceOptionalFeatureChoices(NYUIDJ_RACE);
                expect(result).toBeTruthy();
        });

        test("_getRaceOptFeatAvailableOptions excludes auto-granted features", () => {
                const builder = makeBuilder([DREAMWALK, DREAMBEND, DREAMWATCH]);
                const opts = builder._getRaceOptFeatAvailableOptions(NYUIDJ_RACE, ["DW:C", "DW:S"], {});
                expect(opts.every(o => o.name !== "Dreamwalk")).toBe(true);
        });

        test("_getRaceOptFeatAvailableOptions shows Dreamjump when Dreamwalk is granted", () => {
                const builder = makeBuilder([DREAMWALK, DREAMJUMP]);
                const opts = builder._getRaceOptFeatAvailableOptions(NYUIDJ_RACE, ["DW:C", "DW:S"], {});
                expect(opts.some(o => o.name === "Dreamjump")).toBe(true);
        });

        test("_getRaceOptFeatAvailableOptions hides Dreamsnatch when Dreamwatch not granted", () => {
                const builder = makeBuilder([DREAMWALK, DREAMSNATCH]);
                // Only Dreamwalk is in featureGrants, Dreamwatch is not
                const opts = builder._getRaceOptFeatAvailableOptions(NYUIDJ_RACE, ["DW:C", "DW:S"], {});
                expect(opts.every(o => o.name !== "Dreamsnatch")).toBe(true);
        });

        test("_applyRaceFeatureGrants adds auto-granted features to state", () => {
                const captured = [];
                const builder = Object.create(CharacterSheetBuilder.prototype);
                builder._selectedRace = NYUIDJ_RACE;
                builder._state = {addFeature: (f) => captured.push(f)};
                builder._page = {getOptionalFeatures: () => [DREAMWALK]};

                builder._applyRaceFeatureGrants();

                expect(captured).toHaveLength(1);
                expect(captured[0].name).toBe("Dreamwalk");
        });
});