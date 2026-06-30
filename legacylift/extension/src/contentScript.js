// @ts-check
(function attachContentScript(global) {
  const namespace = /** @type {any} */ (global.LegacyLiftOverlay = global.LegacyLiftOverlay || {});
  const DIFF_RETRY_DELAYS_MS = [250, 750, 1500, 3000];

  function retryAttemptForUrl(url, explicitAttempt) {
    if (Number.isInteger(explicitAttempt)) return explicitAttempt;
    const state = namespace.diffRetryState || {};
    if (state.url !== url) {
      namespace.diffRetryState = { url, attempt: 0 };
      return 0;
    }
    return state.attempt || 0;
  }

  function rememberNextRetry(url, attempt) {
    namespace.diffRetryState = { url, attempt: attempt + 1 };
  }

  function clearRetry(url) {
    namespace.diffRetryState = { url, attempt: 0 };
  }

  function createNavigationWatcher(windowLike, onNavigate) {
    let timer = 0;
    const schedule = () => {
      if (timer) windowLike.clearTimeout(timer);
      timer = windowLike.setTimeout(onNavigate, 80);
    };

    ["pushState", "replaceState"].forEach((method) => {
      const original = windowLike.history[method];
      windowLike.history[method] = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        schedule();
        return result;
      };
    });

    ["popstate", "turbo:render", "pjax:end"].forEach((eventName) => {
      windowLike.addEventListener(eventName, schedule);
    });

    return schedule;
  }

  function buildLegacyLiftUrl(settings, context, annotation) {
    const url = new URL("/demo", settings.legacyLiftBaseUrl || "http://localhost:3000");
    url.searchParams.set("owner", context.owner);
    url.searchParams.set("repo", context.repo);
    url.searchParams.set("annotation", annotation.id);
    if (context.pullNumber) url.searchParams.set("pull_number", String(context.pullNumber));
    if (context.path) url.searchParams.set("path", context.path);
    return String(url);
  }

  async function copyMessage(message, document) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      await global.navigator.clipboard.writeText(message);
      namespace.renderOverlayState(document, "ready", "Suggested message copied.");
      return;
    }
    namespace.renderOverlayState(document, "error", "Clipboard access is unavailable in this browser context.");
  }

  async function handleAction(actionName, annotation, client, settings, context, document) {
    let owner;
    let reason;
    if (actionName === "reassign_owner") {
      owner = global.prompt ? global.prompt("New owner", annotation.owner) : annotation.owner;
      if (!owner) return;
      reason = global.prompt ? global.prompt("Reason for reassignment", "") || "" : "";
    }
    if (actionName === "waive_approval") {
      reason = global.prompt ? global.prompt("Reason for waiving approval", "") || "" : "";
      if (!reason) return;
    }

    try {
      const payload = await client.mutateAnnotation(annotation.id, {
        action: actionName,
        owner,
        reason,
      });
      const next = payload.annotation || annotation;
      namespace.renderDetailPanel(document, next, panelHandlers(client, settings, context, document));
      Array.from(document.querySelectorAll(`[data-annotation-id="${annotation.id}"]`)).forEach((badge) => {
        badge.textContent = `${next.owner} - ${next.confidence}`;
      });
      namespace.renderOverlayState(document, "ready", "LegacyLift review state updated.");
    } catch (error) {
      const state = error && error.state ? error.state : "error";
      namespace.renderOverlayState(document, state, error.message || "Unable to update LegacyLift review state.");
    }
  }

  function overlayStateMessage(state) {
    const messages = {
      unavailable: "LegacyLift backend is unavailable. GitHub can still be used normally.",
      repo_not_indexed: "This repository has not been indexed by LegacyLift yet.",
      pr_not_synced: "This pull request has not been synced by LegacyLift yet.",
      unauthorized: "Configure LegacyLift overlay authentication for this repository.",
      unsupported_file_type: "LegacyLift does not support this file type yet.",
      empty: "LegacyLift found no ownership annotations for the visible lines.",
      not_indexed: "No LegacyLift annotations found for the visible lines. This repository or ref may not be indexed yet.",
    };
    return messages[state] || "Unable to load LegacyLift overlay annotations.";
  }

  function prioritizedOverlayState(states) {
    const priority = [
      "unauthorized",
      "unavailable",
      "unsupported_file_type",
      "repo_not_indexed",
      "pr_not_synced",
      "empty",
      "not_indexed",
    ];
    return priority.find((state) => states.includes(state)) || states[0] || "empty";
  }

  function panelHandlers(client, settings, context, document) {
    return {
      onAction(actionName, annotation) {
        handleAction(actionName, annotation, client, settings, context, document);
      },
      onCopyMessage(message) {
        copyMessage(message, document);
      },
      onOpenLegacyLift(annotation) {
        const url = buildLegacyLiftUrl(settings, context, annotation);
        if (global.open) {
          global.open(url, "_blank", "noopener");
        } else {
          global.location.href = url;
        }
      },
    };
  }

  async function runOverlay(dependencies) {
    const document = (dependencies && dependencies.document) || global.document;
    const location = (dependencies && dependencies.location) || global.location;
    const windowLike = (dependencies && dependencies.window) || global;
    if (!document || !location) return;

    const href = String(location.href);
    const context = namespace.parseGitHubUrl(href);
    if (!context) return;
    const attempt = retryAttemptForUrl(href, dependencies && dependencies.attempt);

    namespace.clearOverlay(document);

    const settings = await namespace.loadSettings(/** @type {any} */ (global).chrome);
    if (!settings.enabled) {
      namespace.renderOverlayState(document, "disabled", "LegacyLift overlay is disabled.");
      return;
    }

    const files = namespace.extractVisibleFiles(document, context);
    if (files.length === 0) {
      const retryDelay = DIFF_RETRY_DELAYS_MS[attempt];
      if (retryDelay !== undefined && windowLike && typeof windowLike.setTimeout === "function") {
        rememberNextRetry(href, attempt);
        namespace.renderOverlayState(document, "not_indexed", "Waiting for GitHub diff lines to load for LegacyLift overlay.");
        windowLike.setTimeout(() => runOverlay({ document, location, window: windowLike, attempt: attempt + 1 }), retryDelay);
        return;
      }
      namespace.renderOverlayState(document, "not_indexed", "LegacyLift could not map this GitHub diff layout to exact lines.");
      return;
    }
    clearRetry(href);

    const client = namespace.createOverlayApiClient(settings, global.fetch.bind(global));
    const badgeItems = [];
    const emptyStates = [];

    for (const file of files) {
      try {
        const overlay = await client.fetchOverlay({
          owner: context.owner,
          repo: context.repo,
          pullNumber: context.pullNumber,
          ref: context.ref,
          path: file.path,
          visibleLines: namespace.formatVisibleLines(file.visibleLines),
        });
        overlay.annotations.forEach((annotation) => badgeItems.push({ file, annotation }));
        if (overlay.annotations.length === 0) {
          emptyStates.push(overlay.state || "empty");
        }
      } catch (error) {
        const state = error && error.state ? error.state : "error";
        namespace.renderOverlayState(document, state, error.message || "Unable to load LegacyLift overlay annotations.");
        return;
      }
    }

    if (badgeItems.length === 0) {
      const state = prioritizedOverlayState(emptyStates);
      namespace.renderOverlayState(document, state, overlayStateMessage(state));
      return;
    }

    namespace.renderBadges(document, badgeItems, {
      onSelect(annotation) {
        namespace.renderDetailPanel(document, annotation, panelHandlers(client, settings, context, document));
      },
    });
    namespace.renderOverlayState(document, "ready", `${badgeItems.length} LegacyLift annotation${badgeItems.length === 1 ? "" : "s"} loaded.`);
  }

  namespace.createNavigationWatcher = createNavigationWatcher;
  namespace.runOverlay = runOverlay;
  namespace.buildLegacyLiftUrl = buildLegacyLiftUrl;
  namespace.overlayStateMessage = overlayStateMessage;
  namespace.prioritizedOverlayState = prioritizedOverlayState;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createNavigationWatcher, runOverlay, buildLegacyLiftUrl, overlayStateMessage, prioritizedOverlayState };
  }

  if (global.document && global.location && namespace.parseGitHubUrl(String(global.location.href))) {
    const schedule = createNavigationWatcher(global, () => runOverlay());
    schedule();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
