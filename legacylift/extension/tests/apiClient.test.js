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
    { apiBaseUrl: "http://localhost:8000", reviewerIdentity: "sam", devToken: "dev-secret" },
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
  assert.equal(calls[0].init.headers["X-LegacyLift-User"], "sam");
  assert.equal(calls[0].init.headers.Authorization, "Bearer dev-secret");
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
    { apiBaseUrl: "http://127.0.0.1:8000", reviewerIdentity: "sam" },
    async () => {
      throw new TypeError("fetch failed");
    },
  );

  await assert.rejects(
    () => client.fetchOverlay({ owner: "acme", repo: "checkout", ref: "main", path: "x.cbl" }),
    (error) => error instanceof OverlayApiError && error.state === "unavailable",
  );
});

test("retries localhost overlay requests against 127.0.0.1 when localhost fetch fails", async () => {
  const calls = [];
  const client = createOverlayApiClient(
    { apiBaseUrl: "http://localhost:8000", reviewerIdentity: "sam", devToken: "dev-secret" },
    async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith("http://localhost:8000/")) {
        throw new TypeError("Failed to fetch");
      }
      return response(200, { annotations: [{ id: "ann_1" }] });
    },
  );

  const payload = await client.fetchOverlay({
    owner: "aws-samples",
    repo: "aws-mainframe-modernization-carddemo",
    pullNumber: 1,
    path: "app/cobol/carddemo.cbl",
    visibleLines: "1-20",
  });

  assert.equal(payload.annotations.length, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^http:\/\/localhost:8000\/github\/overlay/);
  assert.match(calls[1].url, /^http:\/\/127\.0\.0\.1:8000\/github\/overlay/);
  assert.match(calls[1].url, /path=app%2Fcobol%2Fcarddemo.cbl/);
  assert.equal(calls[1].init.headers["X-LegacyLift-User"], "sam");
  assert.equal(calls[1].init.headers.Authorization, "Bearer dev-secret");
});

test("preserves backend overlay states for empty successful responses", async () => {
  const client = createOverlayApiClient(
    { apiBaseUrl: "http://localhost:8000", reviewerIdentity: "sam" },
    async () => response(200, { annotations: [], state: "pr_not_synced" }),
  );

  const payload = await client.fetchOverlay({ owner: "acme", repo: "checkout", ref: "main", path: "x.cbl" });

  assert.equal(payload.state, "pr_not_synced");
});

test("falls back to empty state when backend omits a state", async () => {
  const client = createOverlayApiClient(
    { apiBaseUrl: "http://localhost:8000", reviewerIdentity: "sam" },
    async () => response(200, { annotations: [] }),
  );

  const payload = await client.fetchOverlay({ owner: "acme", repo: "checkout", ref: "main", path: "x.cbl" });

  assert.equal(payload.state, "empty");
});
