export function getCharacterSaveFence (sheet) {
	return {
		characterId: sheet._currentCharacterId,
		loadGeneration: sheet._characterLoadGeneration,
	};
}

export function isCharacterSaveFenceCurrent ({sheet, saveFence}) {
	return sheet._currentCharacterId === saveFence.characterId
		&& sheet._characterLoadGeneration === saveFence.loadGeneration;
}
