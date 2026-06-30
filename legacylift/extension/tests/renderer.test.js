const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument, createLine } = require("./fakeDom.js");

const { extractVisibleFiles } = require("../src/githubDom.js");
const {
  renderAnnotationRail,
  renderBadges,
  renderDetailPanel,
  renderOverlayState,
} = require("../src/renderer.js");

const annotation = {
  id: "ann_123",
  chunk_id: "chunk_1",
  line_range: [249, 256],
  criterion: "Orders over $500 require manual review.",
  owner: "Finance / Pricing",
  original_owner: "Finance / Pricing",
  confidence: "High",
  evidence: "Matched monetary threshold and manual-review gate.",
  review_status: "Inferred",
  approval_status: "Approval needed",
  change_guidance: {
    risk_summary: "Changing this threshold may affect review volume.",
    primary_approval_group: "Finance / Pricing",
    secondary_groups: ["Risk", "Ops"],
    approval_checklist: ["Confirm threshold with Finance / Pricing"],
    suggested_tests: ["$499.99 does not trigger review", "$500.01 triggers review"],
    suggested_message: "Can you confirm the intended threshold?",
  },
  actions: {
    can_confirm: true,
    can_reassign: true,
    can_flag: true,
    can_request_approval: true,
    can_mark_approved: true,
    can_waive: true,
  },
};

test("renders inline owner badges beside matching lines", () => {
  const document = createDocument();
  const file = document.createElement("div");
  file.setAttribute("data-file-path", "src/checkout/checkout-risk.cbl");
  const row = document.createElement("tr");
  const lineNumber = createLine(document, 249);
  const codeCell = document.createElement("td");
  codeCell.classList.add("blob-code");
  codeCell.setAttribute("id", "LC249");
  codeCell.textContent = "IF PURCHASE-AMOUNT > 500.00";
  row.append(lineNumber, codeCell);
  file.append(row, createLine(document, 250));
  document.body.appendChild(file);
  const [visibleFile] = extractVisibleFiles(document, { kind: "pull" });

  renderBadges(document, [{ file: visibleFile, annotation }], { onSelect() {} });

  const badge = document.querySelector(".ll-overlay-badge");
  assert.equal(badge.textContent, "LLDecision owner: Finance / Pricing");
  assert.equal(badge.getAttribute("data-annotation-id"), "ann_123");
  assert.equal(badge.parentElement, codeCell);
  assert.match(badge.getAttribute("aria-label"), /High confidence/);
});

test("renders a right-side annotation rail with a clear owner label", () => {
  const document = createDocument();
  const selected = [];

  renderAnnotationRail(document, [{ annotation }], {
    onSelect(next) {
      selected.push(next.id);
    },
  });

  const rail = document.querySelector(".ll-overlay-rail");
  const item = document.querySelector(".ll-overlay-rail-item");
  assert.match(rail.textContent, /LegacyLift annotations/);
  assert.match(item.textContent, /Decision owner: Finance \/ Pricing/);
  assert.match(item.textContent, /Lines 249-256 - High confidence/);

  item.click();
  assert.deepEqual(selected, ["ann_123"]);
});

test("renders detail panel sections and approval actions", () => {
  const document = createDocument();
  const actions = [];

  renderDetailPanel(document, annotation, {
    onAction(actionName) {
      actions.push(actionName);
    },
    onCopyMessage() {},
    onOpenLegacyLift() {},
  });

  assert.match(document.body.textContent, /Orders over \$500 require manual review/);
  assert.match(document.body.textContent, /Finance \/ Pricing/);
  assert.match(document.body.textContent, /High confidence/);
  assert.match(document.body.textContent, /Matched monetary threshold/);
  assert.match(document.body.textContent, /Tests to add/);
  assert.match(document.body.textContent, /Review owner/);
  assert.match(document.body.textContent, /Confirm Finance \/ Pricing/);
  assert.match(document.body.textContent, /Ask for approval/);

  document.querySelector('[data-action="confirm_owner"]').click();
  assert.deepEqual(actions, ["confirm_owner"]);
});

test("copies suggested stakeholder message", () => {
  const document = createDocument();
  const copied = [];

  renderDetailPanel(document, annotation, {
    onAction() {},
    onCopyMessage(message) {
      copied.push(message);
    },
    onOpenLegacyLift() {},
  });

  const copy = document.querySelector('[data-action="copy_message"]');
  assert.equal(copy.textContent, "Copy suggested message");
  copy.click();
  assert.deepEqual(copied, ["Can you confirm the intended threshold?"]);
});

test("renders backend unavailable, repo not indexed, PR not synced, unsupported, empty, and unauthorized states", () => {
  const document = createDocument();
  let activated = 0;

  const ready = renderOverlayState(document, "ready", "1 LegacyLift annotation loaded. Click to view.", {
    onActivate() {
      activated += 1;
    },
  });
  assert.equal(ready.tagName, "BUTTON");
  ready.click();
  assert.equal(activated, 1);

  renderOverlayState(document, "unavailable", "LegacyLift backend is unavailable.");
  assert.match(document.body.textContent, /backend is unavailable/);

  renderOverlayState(document, "not_indexed", "No LegacyLift annotations found.");
  assert.match(document.body.textContent, /No LegacyLift annotations/);

  renderOverlayState(document, "pr_not_synced", "This pull request has not been synced by LegacyLift yet.");
  assert.match(document.body.textContent, /pull request has not been synced/);

  renderOverlayState(document, "unsupported_file_type", "LegacyLift does not support this file type yet.");
  assert.match(document.body.textContent, /file type/);

  renderOverlayState(document, "empty", "LegacyLift found no ownership annotations for this file.");
  assert.match(document.body.textContent, /no ownership annotations/);

  renderOverlayState(document, "unauthorized", "Configure LegacyLift overlay authentication.");
  assert.match(document.body.textContent, /authentication/);
});
