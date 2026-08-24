import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("campaign rules overlay", () => {
	it("changes effective settings without persisting campaign overrides", () => {
		const state = new CharacterSheetState();
		state.setSetting("exhaustionRules", "thelemar");
		state.setSetting("thelemar_jumping", true);
		state.setCampaignSettingsOverlay({
			exhaustionRules: "2024",
			thelemar_jumping: false,
		});

		expect(state.getSettings()).toEqual(expect.objectContaining({
			exhaustionRules: "2024",
			thelemar_jumping: false,
		}));
		expect(state.toJson().settings).toEqual(expect.objectContaining({
			exhaustionRules: "thelemar",
			thelemar_jumping: true,
		}));
	});

	it("restores the character settings when campaign context is cleared", () => {
		const state = new CharacterSheetState();
		state.setSetting("enableTgtt", true);
		state.setCampaignSettingsOverlay({enableTgtt: false});
		expect(state.setSetting("enableTgtt", true)).toBe(false);
		expect(state.getSettings().enableTgtt).toBe(false);

		state.clearCampaignSettingsOverlay();
		expect(state.getSettings().enableTgtt).toBe(true);
	});

	it("applies a fresh overlay after loading another character", () => {
		const state = new CharacterSheetState();
		state.setCampaignSettingsOverlay({exhaustionRules: "2024"});
		state.clearCampaignSettingsOverlay();
		state.loadFromJson({name: "Other", settings: {exhaustionRules: "2014"}});
		state.setCampaignSettingsOverlay({exhaustionRules: "thelemar"});

		expect(state.getSettings().exhaustionRules).toBe("thelemar");
		expect(state.toJson().settings.exhaustionRules).toBe("2014");
	});

	it("preserves and rebases the overlay when loadFromJson is called directly", () => {
		const state = new CharacterSheetState();
		state.setSetting("exhaustionRules", "2014");
		state.setCampaignSettingsOverlay({exhaustionRules: "2024"});
		state.loadFromJson({name: "Imported", settings: {exhaustionRules: "thelemar"}});
		expect(state.getSettings().exhaustionRules).toBe("2024");
		expect(state.toJson().settings.exhaustionRules).toBe("thelemar");
		expect(state.setExhaustionRules("2014")).toBe(false);
		expect(state.getSettings().exhaustionRules).toBe("2024");
	});
});
