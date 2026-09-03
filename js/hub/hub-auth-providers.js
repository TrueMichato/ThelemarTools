const MAX_PROVIDER_COUNT = 10;

function getProviders (metadata) {
	if (!Array.isArray(metadata?.authProviders) || metadata.authProviders.length > MAX_PROVIDER_COUNT) {
		throw new Error("Authentication providers are unavailable.");
	}
	return metadata.authProviders.map(provider => {
		if (
			!provider
			|| typeof provider.slug !== "string"
			|| !/^[a-z][a-z0-9-]{0,31}$/.test(provider.slug)
			|| typeof provider.label !== "string"
			|| !provider.label.trim()
			|| Array.from(provider.label.trim()).length > 50
			|| provider.startPath !== `/auth/${provider.slug}/start`
			|| !["available", "disabled", "configuration_error"].includes(provider.status)
		) throw new Error("Authentication providers are unavailable.");
		return {
			slug: provider.slug,
			label: provider.label.trim(),
			startPath: provider.startPath,
			status: provider.status,
		};
	});
}

function getNote ({documentRef, text}) {
	const note = documentRef.createElement("p");
	note.className = "hub-inline-status";
	note.setAttribute("role", "status");
	note.textContent = text;
	return note;
}

export async function pRenderHubAuthProviders ({
	signIn,
	returnTo,
	fnFetch = fetch,
	documentRef = document,
}) {
	if (!signIn) throw new Error("Authentication providers are unavailable.");
	signIn.removeAttribute("href");
	signIn.hidden = true;

	const response = await fnFetch("/api/meta", {
		headers: {accept: "application/json"},
		credentials: "same-origin",
	});
	if (!response?.ok) throw new Error("Authentication providers are unavailable.");
	const providers = getProviders(await response.json());
	const available = providers.filter(provider => provider.status === "available");
	if (!available.length) throw new Error("Authentication providers are unavailable.");

	const group = documentRef.createElement("div");
	group.className = "hub-button-row hub-button-row--centered";
	group.setAttribute("role", "group");
	group.setAttribute("aria-label", "Sign-in providers");
	for (const provider of available) {
		const link = documentRef.createElement("a");
		link.className = "hub-button hub-button--primary";
		link.href = `${provider.startPath}?${new URLSearchParams({returnTo})}`;
		link.textContent = `Sign in with ${provider.label}`;
		group.append(link);
	}
	signIn.replaceWith(group);

	if (available.length > 1) {
		group.after(getNote({
			documentRef,
			text: "Already have a Hub account? Sign in with a provider already linked to it. Using an unlinked provider creates a separate account; provider linking will be available from Account & devices before these options are enabled for existing users.",
		}));
	}
	if (providers.some(provider => provider.status === "configuration_error")) {
		group.after(getNote({
			documentRef,
			text: "One sign-in provider is temporarily unavailable. Other sign-in options remain available.",
		}));
	}
}
