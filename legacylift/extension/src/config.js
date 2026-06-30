// @ts-check
(function attachConfig(global) {
  const namespace = /** @type {any} */ (global.LegacyLiftOverlay = global.LegacyLiftOverlay || {});

  const DEFAULT_SETTINGS = {
    apiBaseUrl: "http://localhost:8000",
    legacyLiftBaseUrl: "http://localhost:3000",
    reviewerIdentity: "github-browser-extension",
    devToken: "",
    enabled: true,
  };

  function storageArea(chromeLike) {
    return chromeLike && chromeLike.storage && chromeLike.storage.sync ? chromeLike.storage.sync : null;
  }

  function loadSettings(chromeLike) {
    const area = storageArea(chromeLike || /** @type {any} */ (global).chrome);
    if (!area) {
      return Promise.resolve({ ...DEFAULT_SETTINGS });
    }

    return new Promise((resolve) => {
      area.get(DEFAULT_SETTINGS, (items) => {
        resolve({ ...DEFAULT_SETTINGS, ...items });
      });
    });
  }

  function saveSettings(settings, chromeLike) {
    const next = { ...DEFAULT_SETTINGS, ...settings };
    const area = storageArea(chromeLike || /** @type {any} */ (global).chrome);
    if (!area) {
      return Promise.resolve(next);
    }

    return new Promise((resolve, reject) => {
      area.set(next, () => {
        const error = chromeLike && chromeLike.runtime ? chromeLike.runtime.lastError : null;
        if (error) {
          reject(new Error(error.message || "Unable to save LegacyLift overlay settings."));
          return;
        }
        resolve(next);
      });
    });
  }

  namespace.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  namespace.loadSettings = loadSettings;
  namespace.saveSettings = saveSettings;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { DEFAULT_SETTINGS, loadSettings, saveSettings };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
