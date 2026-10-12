(() => {
  const PROFILE_STORAGE_KEY = 'apiProfilesV1';
  const ACTIVE_PROFILE_KEY = 'activeApiProfileId';
  const SESSION_KEYS_KEY = 'apiKeysByProfile';
  const DEFAULT_PROFILE_ID = 'default';

  function normalizeStorageMode(value) {
    return ['session', 'local', 'encrypted'].includes(value) ? value : 'session';
  }

  function normalizeProfile(raw = {}, id = DEFAULT_PROFILE_ID, name = 'Default') {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      id: String(source.id || id),
      name: String(source.name || name || 'Default'),
      endpoint: String(source.endpoint || ''),
      model: String(source.model || ''),
      provider: String(source.provider || ''),
      reasoningEffort: String(source.reasoningEffort || ''),
      keyStorageMode: normalizeStorageMode(source.keyStorageMode),
      minConfidence: Number.isFinite(Number(source.minConfidence)) ? Number(source.minConfidence) : 0.88,
      disableThinking: source.disableThinking ?? true,
      paragraphFastPath: source.paragraphFastPath ?? true,
      localApiKey: String(source.localApiKey || ''),
      encryptedApiKey: source.encryptedApiKey || null
    };
  }

  function makeProfile(id, name) {
    return normalizeProfile({}, id, name);
  }

  function normalizeProfiles(rawProfiles) {
    const result = {};
    if (rawProfiles && typeof rawProfiles === 'object' && !Array.isArray(rawProfiles)) {
      for (const [id, raw] of Object.entries(rawProfiles)) {
        const cleanId = String(id || raw?.id || '').trim();
        if (!cleanId) continue;
        result[cleanId] = normalizeProfile(raw, cleanId, raw?.name || cleanId);
      }
    }
    return result;
  }

  function migrateApiProfileState(localState = {}, sessionState = {}) {
    let profiles = normalizeProfiles(localState[PROFILE_STORAGE_KEY]);
    let activeId = String(localState[ACTIVE_PROFILE_KEY] || '');
    const sessionKeys = {
      ...((sessionState[SESSION_KEYS_KEY] && typeof sessionState[SESSION_KEYS_KEY] === 'object') ? sessionState[SESSION_KEYS_KEY] : {})
    };
    let migratedLegacy = false;

    if (!Object.keys(profiles).length) {
      const legacyConfig = localState.apiConfig && typeof localState.apiConfig === 'object' ? localState.apiConfig : {};
      const hasLegacy = Boolean(
        legacyConfig.endpoint || legacyConfig.model || localState.persistentApiKey ||
        localState.localApiKey || localState.encryptedApiKey || sessionState.apiKey
      );
      const id = DEFAULT_PROFILE_ID;
      const profile = normalizeProfile({ ...legacyConfig }, id, 'Default');
      const legacyPersistentKey = String(localState.persistentApiKey || '');
      const legacyLocalKey = String(localState.localApiKey || '');
      const legacyEncryptedKey = localState.encryptedApiKey || null;

      if (legacyPersistentKey) {
        profile.keyStorageMode = 'local';
        profile.localApiKey = legacyPersistentKey;
      } else if (legacyLocalKey) {
        profile.keyStorageMode = 'local';
        profile.localApiKey = legacyLocalKey;
      } else if (legacyEncryptedKey) {
        profile.keyStorageMode = 'encrypted';
        profile.encryptedApiKey = legacyEncryptedKey;
      }
      if (sessionState.apiKey) sessionKeys[id] = String(sessionState.apiKey);
      profiles[id] = profile;
      activeId = id;
      migratedLegacy = hasLegacy;
    }

    if (!profiles[activeId]) activeId = Object.keys(profiles)[0];
    if (!activeId) {
      activeId = DEFAULT_PROFILE_ID;
      profiles[activeId] = makeProfile(activeId, 'Default');
    }

    return { profiles, activeId, sessionKeys, migratedLegacy };
  }

  function nextProfileName(profiles = {}) {
    const names = new Set(Object.values(profiles).map(profile => String(profile?.name || '')));
    let index = 1;
    while (names.has(`Profile ${index}`)) index += 1;
    return `Profile ${index}`;
  }

  globalThis.KRA_API_PROFILES = {
    PROFILE_STORAGE_KEY,
    ACTIVE_PROFILE_KEY,
    SESSION_KEYS_KEY,
    DEFAULT_PROFILE_ID,
    normalizeStorageMode,
    normalizeProfile,
    normalizeProfiles,
    makeProfile,
    migrateApiProfileState,
    nextProfileName
  };
})();
