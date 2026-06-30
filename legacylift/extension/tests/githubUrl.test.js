const test = require("node:test");
const assert = require("node:assert/strict");

const { parseGitHubUrl } = require("../src/githubUrl.js");

test("parses GitHub PR files URLs", () => {
  const parsed = parseGitHubUrl("https://github.com/acme/checkout/pull/12/files?diff=split");

  assert.deepEqual(parsed, {
    kind: "pull",
    owner: "acme",
    repo: "checkout",
    pullNumber: 12,
  });
});

test("extracts owner and repo from GitHub blob URLs", () => {
  const parsed = parseGitHubUrl("https://github.com/acme/checkout/blob/main/src/checkout/risk.cbl");

  assert.equal(parsed.owner, "acme");
  assert.equal(parsed.repo, "checkout");
  assert.equal(parsed.kind, "blob");
});

test("extracts blob ref and file path", () => {
  const parsed = parseGitHubUrl("https://github.com/acme/checkout/blob/feature-risk/src/checkout/risk.cbl#L249");

  assert.equal(parsed.ref, "feature-risk");
  assert.equal(parsed.path, "src/checkout/risk.cbl");
});

test("rejects unsupported GitHub URLs", () => {
  assert.equal(parseGitHubUrl("https://github.com/acme/checkout/issues/12"), null);
  assert.equal(parseGitHubUrl("https://example.com/acme/checkout/pull/12/files"), null);
});
