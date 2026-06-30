const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument, createLine } = require("./fakeDom.js");

const {
  extractVisibleFiles,
  formatVisibleLines,
  findLineAnchor,
} = require("../src/githubDom.js");

test("extracts file paths from mocked GitHub PR markup", () => {
  const document = createDocument();
  const file = document.createElement("div");
  file.classList.add("js-file");
  file.setAttribute("data-file-path", "src/checkout/checkout-risk.cbl");
  file.append(createLine(document, 249), createLine(document, 250));
  document.body.appendChild(file);

  const files = extractVisibleFiles(document, { kind: "pull" });

  assert.equal(files.length, 1);
  assert.equal(files[0].path, "src/checkout/checkout-risk.cbl");
});

test("extracts visible line ranges from mocked GitHub markup", () => {
  const document = createDocument();
  const file = document.createElement("div");
  file.setAttribute("data-path", "src/checkout/checkout-risk.cbl");
  [249, 250, 251, 253].forEach((lineNumber) => file.appendChild(createLine(document, lineNumber)));
  document.body.appendChild(file);

  const [visibleFile] = extractVisibleFiles(document, { kind: "pull" });

  assert.deepEqual(visibleFile.visibleLines, [249, 250, 251, 253]);
  assert.equal(formatVisibleLines(visibleFile.visibleLines), "249-251,253");
});

test("uses blob URL path when file containers are absent", () => {
  const document = createDocument();
  document.body.append(createLine(document, 10), createLine(document, 11));

  const [visibleFile] = extractVisibleFiles(document, {
    kind: "blob",
    path: "src/checkout/blob-view.cbl",
  });

  assert.equal(visibleFile.path, "src/checkout/blob-view.cbl");
  assert.deepEqual(visibleFile.visibleLines, [10, 11]);
});

test("finds a matching line anchor for an annotation range", () => {
  const document = createDocument();
  const file = document.createElement("div");
  file.setAttribute("data-file-path", "src/checkout/checkout-risk.cbl");
  const first = createLine(document, 249);
  const second = createLine(document, 250);
  file.append(first, second);
  document.body.appendChild(file);

  const [visibleFile] = extractVisibleFiles(document, { kind: "pull" });

  assert.equal(findLineAnchor(visibleFile, [249, 256]), first);
});
