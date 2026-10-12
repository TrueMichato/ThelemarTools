import {HUB_COMMAND_REPLAY_WINDOW_MS} from "./hub-api-client.js";

export class HubRollLogAdapter {
	constructor ({api, campaignId, getCharacterId = () => null}) {
		this._api = api;
		this._campaignId = campaignId;
		this._getCharacterId = getCharacterId;
	}

	pLog ({formula, total, context = null, visibility = "all_members", detail = {}}) {
		return this.pLogCommand(this.createCommand({formula, total, context, visibility, detail}));
	}

	createCommand ({formula, total, context = null, visibility = "all_members", detail = {}}) {
		if (typeof total !== "number" || !Number.isFinite(total)) throw new TypeError("This entry has no numeric roll total.");
		if (typeof formula !== "string" || !formula.trim() || formula.length > 200) throw new TypeError("This entry has no supported roll formula (maximum 200 characters).");
		const boundedDetail = Object.fromEntries(["title", "breakdown", "resultClass", "resultNote"].map(key => [key, typeof detail[key] === "string" ? detail[key].slice(0, key === "resultClass" ? 100 : 200) : ""]));
		return Object.freeze({
			retryUntil: Date.now() + HUB_COMMAND_REPLAY_WINDOW_MS,
			idempotencyKey: crypto.randomUUID(),
			campaignId: this._campaignId,
			characterId: this._getCharacterId(),
			formula,
			total,
			context,
			visibility,
			detail: Object.freeze(boundedDetail),
		});
	}

	async pLogCommand (command) {
		if (command.campaignId !== this._campaignId || command.characterId !== this._getCharacterId()) throw new Error("The roll belongs to a different character.");
		if (!Number.isFinite(command.retryUntil) || Date.now() >= command.retryUntil) throw new Error("The safe roll retry window has ended. Check server history instead.");
		const {retryUntil, ...request} = command;
		return this._api.pLogRoll(request);
	}

	pListHistory ({commandId = null, signal = null} = {}) {
		return this._api.pListCharacterRollHistory({
			campaignId: this._campaignId,
			characterId: this._getCharacterId(),
			commandId,
			signal,
		});
	}
}
