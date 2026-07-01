// @ts-check
(function attachApiClient(global) {
  const namespace = /** @type {any} */ (global.LegacyLiftOverlay = global.LegacyLiftOverlay || {});

  class OverlayApiError extends Error {
    constructor(state, message, status) {
      super(message);
      this.name = "OverlayApiError";
      this.state = state;
      this.status = status || 0;
    }
  }

  function normalizeBaseUrl(value) {
    return String(value || "http://127.0.0.1:8000").replace(/\/+$/, "");
  }

  function localLoopbackFallbackUrl(url) {
    let fallbackUrl;
    try {
      fallbackUrl = new URL(String(url));
    } catch (_error) {
      return null;
    }

    if (fallbackUrl.protocol !== "http:" || fallbackUrl.hostname !== "localhost") {
      return null;
    }

    fallbackUrl.hostname = "127.0.0.1";
    return fallbackUrl;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch (_error) {
      return {};
    }
  }

  function errorState(status) {
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 404) return "not_indexed";
    return "error";
  }

  function createOverlayApiClient(settings, fetchImpl) {
    const fetcher = fetchImpl || global.fetch.bind(global);
    const baseUrl = normalizeBaseUrl(settings.apiBaseUrl);
    const reviewerIdentity = String(settings.reviewerIdentity || "github-browser-extension");
    const devToken = String(settings.devToken || "");

    async function requestJson(url, init) {
      let response;
      try {
        response = await fetcher(url, init);
      } catch (error) {
        const fallbackUrl = localLoopbackFallbackUrl(url);
        if (fallbackUrl) {
          try {
            response = await fetcher(fallbackUrl, init);
          } catch (fallbackError) {
            const message =
              fallbackError && fallbackError.message
                ? fallbackError.message
                : error && error.message
                  ? error.message
                  : "LegacyLift backend is unavailable.";
            throw new OverlayApiError("unavailable", message);
          }
        } else {
          throw new OverlayApiError(
            "unavailable",
            error && error.message ? error.message : "LegacyLift backend is unavailable.",
          );
        }
      }

      const payload = await readJson(response);
      if (!response.ok) {
        const state = errorState(response.status);
        const detail = payload && payload.detail ? String(payload.detail) : "LegacyLift overlay request failed.";
        throw new OverlayApiError(state, detail, response.status);
      }
      return payload;
    }

    async function fetchOverlay(request) {
      const url = new URL(`${baseUrl}/github/overlay`);
      url.searchParams.set("owner", request.owner);
      url.searchParams.set("repo", request.repo);
      url.searchParams.set("path", request.path);
      if (request.pullNumber !== undefined && request.pullNumber !== null) {
        url.searchParams.set("pull_number", String(request.pullNumber));
      } else if (request.ref) {
        url.searchParams.set("ref", request.ref);
      }
      if (request.visibleLines) {
        url.searchParams.set("visible_lines", request.visibleLines);
      }

      const headers = {
        "X-LegacyLift-User": reviewerIdentity,
      };
      if (devToken) {
        headers.Authorization = `Bearer ${devToken}`;
      }

      const payload = await requestJson(url, { method: "GET", headers });
      const annotations = Array.isArray(payload.annotations) ? payload.annotations : [];
      return {
        ...payload,
        annotations,
        state: annotations.length > 0 ? "ready" : payload.state || "empty",
      };
    }

    async function mutateAnnotation(annotationId, body) {
      const headers = {
        "Content-Type": "application/json",
        "X-LegacyLift-User": reviewerIdentity,
      };
      if (devToken) {
        headers.Authorization = `Bearer ${devToken}`;
      }

      return requestJson(`${baseUrl}/github/overlay/annotation/${encodeURIComponent(annotationId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });
    }

    return {
      fetchOverlay,
      mutateAnnotation,
    };
  }

  namespace.OverlayApiError = OverlayApiError;
  namespace.createOverlayApiClient = createOverlayApiClient;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { OverlayApiError, createOverlayApiClient };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
