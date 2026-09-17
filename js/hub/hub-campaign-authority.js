export function createCampaignAuthorityChangeHandler ({
	fnIsReloadRequired,
	fnSetReloadRequired,
	fnConcealAuthorization,
	fnStopLiveUpdates,
	fnReload,
}) {
	return () => {
		const isReloadAlreadyRequired = fnIsReloadRequired();
		fnConcealAuthorization();
		fnSetReloadRequired();
		fnStopLiveUpdates();
		if (isReloadAlreadyRequired) return;
		fnReload();
	};
}
