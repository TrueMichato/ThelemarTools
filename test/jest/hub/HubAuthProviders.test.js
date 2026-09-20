import {jest} from "@jest/globals";
import {pRenderHubAuthProviders} from "../../../js/hub/hub-auth-providers.js";

function getElement () {
	return {
		children: [],
		hidden: false,
		removeAttribute: jest.fn(),
		setAttribute: jest.fn(),
		append (child) { this.children.push(child); },
		after: jest.fn(),
		replaceWith (replacement) { this.replacement = replacement; },
		addEventListener (_type, listener) { this.listener = listener; },
		querySelectorAll (selector) {
			return selector === "button" ? this.children.filter(child => child.type === "button") : [];
		},
	};
}

describe("Hub authentication provider controls", () => {
	it("clears terminal retry state instead of leaving the page stuck in retry mode", async () => {
		const signIn = getElement();
		const onInviteRetryInvalid = jest.fn();
		await pRenderHubAuthProviders({
			signIn,
			returnTo: "/hub.html",
			inviteRetry: {provider: "github", retryToken: "r".repeat(32)},
			pRetryInviteAdmission: async () => {
				const error = new Error("expired");
				error.code = "INVITE_ADMISSION_INVALID";
				throw error;
			},
			onInviteRetryInvalid,
			onError: jest.fn(),
			fnFetch: async () => ({
				ok: true,
				json: async () => ({
					authProviders: [{
						slug: "github",
						label: "GitHub",
						startPath: "/auth/github/start",
						status: "available",
					}],
				}),
			}),
			documentRef: {createElement: () => getElement()},
		});

		await signIn.replacement.children[0].listener();
		expect(onInviteRetryInvalid).toHaveBeenCalledTimes(1);
	});
});
