const test = require("node:test");
const assert = require("node:assert/strict");

const { createNavigationWatcher, overlayStateMessage, prioritizedOverlayState } = require("../src/contentScript.js");

test("re-renders on GitHub SPA navigation events", async () => {
  const listeners = new Map();
  const historyCalls = [];
  const windowLike = {
    location: { href: "https://github.com/acme/checkout/pull/12/files" },
    history: {
      pushState(...args) {
        historyCalls.push(["pushState", args]);
      },
      replaceState(...args) {
        historyCalls.push(["replaceState", args]);
      },
    },
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    dispatch(type) {
      (listeners.get(type) || []).forEach((listener) => listener({ type }));
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
  };
  let renders = 0;

  createNavigationWatcher(windowLike, () => {
    renders += 1;
  });

  windowLike.history.pushState({}, "", "/acme/checkout/pull/13/files");
  windowLike.dispatch("turbo:render");
  windowLike.dispatch("popstate");

  assert.equal(historyCalls.length, 1);
  assert.equal(renders, 3);
});

test("prioritizes and names release-hardening overlay failure states", () => {
  assert.equal(prioritizedOverlayState(["empty", "pr_not_synced"]), "pr_not_synced");
  assert.equal(prioritizedOverlayState(["repo_not_indexed", "unsupported_file_type"]), "unsupported_file_type");
  assert.match(overlayStateMessage("unavailable"), /backend is unavailable/);
  assert.match(overlayStateMessage("repo_not_indexed"), /repository has not been indexed/);
  assert.match(overlayStateMessage("pr_not_synced"), /pull request has not been synced/);
  assert.match(overlayStateMessage("unsupported_file_type"), /file type/);
  assert.match(overlayStateMessage("empty"), /no ownership annotations/);
});
