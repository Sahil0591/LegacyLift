// @ts-check
(function attachGitHubUrl(global) {
  const namespace = /** @type {any} */ (global.LegacyLiftOverlay = global.LegacyLiftOverlay || {});

  function decodePart(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  }

  function parseGitHubUrl(input) {
    let url;
    try {
      url = new URL(input);
    } catch (_error) {
      return null;
    }

    if (url.hostname !== "github.com") {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean).map(decodePart);
    if (parts.length < 4) {
      return null;
    }

    const [owner, repo, surface] = parts;
    if (!owner || !repo) {
      return null;
    }

    if (surface === "pull" && /^\d+$/.test(parts[3] || "")) {
      return {
        kind: "pull",
        owner,
        repo,
        pullNumber: Number(parts[3]),
      };
    }

    if (surface === "blob" && parts.length >= 5) {
      return {
        kind: "blob",
        owner,
        repo,
        ref: parts[3],
        path: parts.slice(4).join("/"),
      };
    }

    return null;
  }

  namespace.parseGitHubUrl = parseGitHubUrl;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseGitHubUrl };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
