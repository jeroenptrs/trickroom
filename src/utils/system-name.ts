// A system name is free text. The server turns it into the storage folder
// name (`systemNameToSafeKey`): spaces become hyphens and unsafe characters
// are dropped. The name only has to leave something behind.
export const systemNameHasStorageKey = (systemName: string): boolean =>
	/[a-z0-9_]/i.test(systemName);

export const systemNameStorageKeyError = "Use at least one letter or number.";
