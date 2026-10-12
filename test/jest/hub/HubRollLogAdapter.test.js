import {jest} from "@jest/globals";
import {HubRollLogAdapter} from "../../../js/hub/hub-roll-log-adapter.js";

describe("Hub roll command identity", () => {
	it("retains the exact key and body across an uncertain transport retry", async () => {
		const api = {pLogRoll: jest.fn().mockRejectedValueOnce(new Error("Lost response")).mockResolvedValueOnce({event: {id: "event"}})};
		const adapter = new HubRollLogAdapter({api, campaignId: "campaign", getCharacterId: () => "character"});
		const command = adapter.createCommand({formula: "1d20+3", total: 17, detail: {title: "Perception"}});
		await expect(adapter.pLogCommand(command)).rejects.toThrow("Lost response");
		await adapter.pLogCommand(command);
		expect(api.pLogRoll.mock.calls[0][0]).toEqual(api.pLogRoll.mock.calls[1][0]);
		expect(api.pLogRoll.mock.calls[0][0].idempotencyKey).toBe(command.idempotencyKey);
	});

	it("does not resend after the safe receipt window or under a replacement character", async () => {
		const api = {pLogRoll: jest.fn()};
		let characterId = "character";
		const adapter = new HubRollLogAdapter({api, campaignId: "campaign", getCharacterId: () => characterId});
		const command = adapter.createCommand({formula: "1d20", total: 17});
		characterId = "other";
		await expect(adapter.pLogCommand(command)).rejects.toThrow();
		characterId = "character";
		await expect(adapter.pLogCommand({...command, retryUntil: Date.now() - 1})).rejects.toThrow();
		expect(api.pLogRoll).not.toHaveBeenCalled();
	});

	it("rejects invalid totals instead of turning an unsupported roll into a zero", () => {
		const adapter = new HubRollLogAdapter({api: {}, campaignId: "campaign", getCharacterId: () => "character"});
		for (const total of [NaN, Infinity, "not a roll"]) expect(() => adapter.createCommand({formula: "1d20", total})).toThrow();
	});
});
