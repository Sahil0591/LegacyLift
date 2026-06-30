// @ts-check
(function attachOptions(global) {
  const namespace = /** @type {any} */ (global.LegacyLiftOverlay || {});

  async function initOptions(document) {
    const form = document.getElementById("settings-form");
    const status = document.getElementById("settings-status");
    if (!form || !status) return;

    const settings = await namespace.loadSettings(/** @type {any} */ (global).chrome);
    Object.entries(settings).forEach(([key, value]) => {
      const input = document.getElementById(key);
      if (!input) return;
      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else {
        input.value = String(value);
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = {
        apiBaseUrl: document.getElementById("apiBaseUrl").value.trim(),
        legacyLiftBaseUrl: document.getElementById("legacyLiftBaseUrl").value.trim(),
        reviewerIdentity: document.getElementById("reviewerIdentity").value.trim(),
        devToken: document.getElementById("devToken").value.trim(),
        enabled: document.getElementById("enabled").checked,
      };

      try {
        await namespace.saveSettings(next, /** @type {any} */ (global).chrome);
        status.textContent = "Settings saved.";
      } catch (error) {
        status.textContent = error.message || "Unable to save settings.";
      }
    });
  }

  if (global.document) {
    global.document.addEventListener("DOMContentLoaded", () => initOptions(global.document));
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initOptions };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
