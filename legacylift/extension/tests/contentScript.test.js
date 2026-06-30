const test = require("node:test");
const assert = require("node:assert/strict");

const { createNavigationWatcher } = require("../src/contentScript.js");

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
