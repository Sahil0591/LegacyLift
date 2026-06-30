const test = require("node:test");
const assert = require("node:assert/strict");

const { OverlayApiError, createOverlayApiClient } = require("../src/apiClient.js");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("fetches overlay annotations with PR parameters and visible lines", async () => {
  const calls = [];
  const client = createOverlayApiClient(
    { apiBaseUrl: "http://localhost:8000", reviewerIdentity: "sam" },
    async (url, init) => {
      calls.push({ url: String(url), init });
      return response(200, { annotations: [{ id: "ann_1" }] });
    },
  );

  const payload = await client.fetchOverlay({
    owner: "acme",
    repo: "checkout",
    pullNumber: 12,
    path: "src/checkout/risk.cbl",
    visibleLines: "249-256",
  });

  assert.equal(payload.annotations.length, 1);
  assert.match(calls[0].url, /pull_number=12/);
  assert.match(calls[0].url, /visible_lines=249-256/);
  assert.match(calls[0].url, /path=src%2Fcheckout%2Frisk.cbl/);
});

test("sends overlay mutation auth headers", async () => {
  const calls = [];
  const client = createOverlayApiClient(
    {
      apiBaseUrl: "http://localhost:8000",
      reviewerIdentity: "sam@example.com",
      devToken: "dev-secret",
    },
    async (url, init) => {
      calls.push({ url: String(url), init });
      return response(200, { annotation: { id: "ann_1", owner: "Risk" } });
    },
  );

  const payload = await client.mutateAnnotation("ann_1", {
    action: "reassign_owner",
    owner: "Risk",
    reason: "Risk owns fraud exposure",
  });

  assert.equal(payload.annotation.owner, "Risk");
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.headers["X-LegacyLift-User"], "sam@example.com");
  assert.equal(calls[0].init.headers.Authorization, "Bearer dev-secret");
});

test("maps unauthorized responses", async () => {
  const client = createOverlayApiClient(
    { apiBaseUrl: "http://localhost:8000", reviewerIdentity: "sam" },
    async () => response(401, { detail: "Invalid LegacyLift overlay token" }),
  );

  await assert.rejects(
    () => client.fetchOverlay({ owner: "acme", repo: "checkout", ref: "main", path: "x.cbl" }),
    (error) => error instanceof OverlayApiError && error.state === "unauthorized",
  );
});

test("maps backend unavailable responses", async () => {
  const client = createOverlayApiClient(
    { apiBaseUrl: "http://localhost:8000", reviewerIdentity: "sam" },
    async () => {
      throw new TypeError("fetch failed");
    },
  );

  await assert.rejects(
    () => client.fetchOverlay({ owner: "acme", repo: "checkout", ref: "main", path: "x.cbl" }),
    (error) => error instanceof OverlayApiError && error.state === "unavailable",
  );
});

test("marks empty overlay payloads as repo not indexed", async () => {
  const client = createOverlayApiClient(
    { apiBaseUrl: "http://localhost:8000", reviewerIdentity: "sam" },
    async () => response(200, { annotations: [] }),
  );

  const payload = await client.fetchOverlay({ owner: "acme", repo: "checkout", ref: "main", path: "x.cbl" });

  assert.equal(payload.state, "not_indexed");
});
