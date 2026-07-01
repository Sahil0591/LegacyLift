// @ts-check
(function attachRenderer(global) {
  const namespace = /** @type {any} */ (global.LegacyLiftOverlay = global.LegacyLiftOverlay || {});

  const ACTION_GROUPS = [
    {
      title: "Review owner",
      actions: [
        ["confirm_owner", (annotation) => `Confirm ${annotation.owner}`, "can_confirm", "primary"],
        ["reassign_owner", () => "Choose another owner", "can_reassign", ""],
        ["flag", () => "Flag as wrong", "can_flag", "danger"],
      ],
    },
    {
      title: "Approval",
      actions: [
        ["request_approval", () => "Ask for approval", "can_request_approval", "primary"],
        ["mark_approved", () => "Record approval", "can_mark_approved", ""],
        ["waive_approval", () => "Waive approval", "can_waive", ""],
      ],
    },
  ];

  function removeAll(root, selector) {
    Array.from(root.querySelectorAll ? root.querySelectorAll(selector) : []).forEach((element) => element.remove());
  }

  function createElement(document, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function appendList(document, parent, items) {
    const list = createElement(document, "ul", "ll-overlay-list");
    items.forEach((item) => {
      const row = createElement(document, "li", "", item);
      list.appendChild(row);
    });
    parent.appendChild(list);
  }

  function appendSection(document, panel, title, body) {
    const section = createElement(document, "section", "ll-overlay-section");
    section.appendChild(createElement(document, "h3", "", title));
    if (Array.isArray(body)) {
      appendList(document, section, body);
    } else {
      section.appendChild(createElement(document, "p", "", body || "Not provided."));
    }
    panel.appendChild(section);
  }

  function confidenceLabel(confidence) {
    return confidence ? `${confidence} confidence` : "Confidence unknown";
  }

  function appendKeyValueSection(document, panel, title, rows) {
    const section = createElement(document, "section", "ll-overlay-section");
    section.appendChild(createElement(document, "h3", "", title));
    const list = createElement(document, "dl", "ll-overlay-key-values");
    rows.forEach(([label, value]) => {
      list.appendChild(createElement(document, "dt", "", label));
      list.appendChild(createElement(document, "dd", "", value || "Not provided."));
    });
    section.appendChild(list);
    panel.appendChild(section);
  }

  function appendActionButton(document, row, annotation, actionName, labelFactory, permission, tone, handlers) {
    const label = labelFactory(annotation);
    const button = createElement(document, "button", `ll-overlay-action${tone ? ` ll-overlay-action-${tone}` : ""}`, label);
    button.setAttribute("type", "button");
    button.setAttribute("data-action", actionName);
    if (annotation.actions && annotation.actions[permission] === false) {
      button.setAttribute("disabled", "true");
    }
    button.addEventListener("click", () => handlers.onAction(actionName, annotation));
    row.appendChild(button);
  }

  function annotationLineLabel(annotation) {
    const range = annotation.line_range || [];
    if (!range.length) return "Line unknown";
    return range[0] === range[1] ? `Line ${range[0]}` : `Lines ${range[0]}-${range[1]}`;
  }

  function placeBadge(file, anchor, badge) {
    if (anchor && typeof anchor.prepend === "function" && anchor !== file.root) {
      anchor.prepend(badge);
      return;
    }

    if (anchor && typeof anchor.after === "function") {
      anchor.after(badge);
      return;
    }

    file.root.appendChild(badge);
  }

  function renderBadges(document, items, handlers) {
    removeAll(document, ".ll-overlay-badge");
    items.forEach(({ file, annotation }) => {
      const anchor = namespace.findLineAnchor(file, annotation.line_range);
      const badge = createElement(document, "button", "ll-overlay-badge");
      badge.setAttribute("type", "button");
      badge.setAttribute("data-annotation-id", annotation.id);
      badge.setAttribute(
        "aria-label",
        `LegacyLift decision owner: ${annotation.owner}. ${confidenceLabel(annotation.confidence)}.`,
      );
      badge.setAttribute("title", `LegacyLift decision owner: ${annotation.owner}. ${confidenceLabel(annotation.confidence)}.`);
      badge.appendChild(createElement(document, "span", "ll-overlay-badge-prefix", "LL"));
      badge.appendChild(createElement(document, "span", "ll-overlay-sr-only", `Decision owner: ${annotation.owner}`));
      badge.addEventListener("click", (event) => {
        event.preventDefault();
        handlers.onSelect(annotation);
      });

      placeBadge(file, anchor, badge);
    });
  }

  function renderAnnotationRail(document, items, handlers) {
    removeAll(document, ".ll-overlay-rail");
    const rail = createElement(document, "aside", "ll-overlay-rail");
    rail.setAttribute("aria-label", "LegacyLift annotations");
    rail.appendChild(createElement(document, "h2", "", "LegacyLift annotations"));

    items.forEach(({ annotation }) => {
      const button = createElement(document, "button", "ll-overlay-rail-item");
      button.setAttribute("type", "button");
      button.setAttribute("data-annotation-id", annotation.id);

      const owner = createElement(document, "span", "ll-overlay-rail-owner", `Decision owner: ${annotation.owner}`);
      const meta = createElement(
        document,
        "span",
        "ll-overlay-rail-meta",
        `${annotationLineLabel(annotation)} - ${confidenceLabel(annotation.confidence)}`,
      );
      button.append(owner, meta);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        handlers.onSelect(annotation);
      });
      rail.appendChild(button);
    });

    document.body.appendChild(rail);
    return rail;
  }

  function renderDetailPanel(document, annotation, handlers) {
    removeAll(document, ".ll-overlay-panel");

    const guidance = annotation.change_guidance || {};
    const panel = createElement(document, "aside", "ll-overlay-panel");
    panel.setAttribute("aria-label", "LegacyLift decision ownership details");

    const header = createElement(document, "header", "ll-overlay-panel-header");
    header.appendChild(createElement(document, "h2", "", "LegacyLift decision"));
    const close = createElement(document, "button", "ll-overlay-icon-button", "x");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Close LegacyLift panel");
    close.addEventListener("click", () => panel.remove());
    header.appendChild(close);
    panel.appendChild(header);

    appendSection(document, panel, "Criterion", annotation.criterion);
    appendKeyValueSection(document, panel, "Ownership", [
      ["Decision owner", annotation.owner],
      ["Confidence", confidenceLabel(annotation.confidence)],
      ["Original inference", annotation.original_owner || annotation.owner],
      ["Review state", annotation.review_state || annotation.review_status],
      ["Approval state", annotation.approval_state || annotation.approval_status],
    ]);
    appendSection(document, panel, "Evidence", annotation.evidence);
    appendSection(document, panel, "Changing this?", guidance.risk_summary);

    const approvalPath = [
      `Primary: ${guidance.primary_approval_group || annotation.owner}`,
      ...(guidance.secondary_groups || []).map((group) => `Secondary: ${group}`),
      ...(guidance.approval_checklist || []),
    ];
    appendSection(document, panel, "Recommended approval path", approvalPath);
    appendSection(document, panel, "Tests to add", guidance.suggested_tests || []);
    appendSection(document, panel, "Suggested message", guidance.suggested_message);

    const auditTrail = (annotation.audit_trail || []).slice(-4).map((entry) => {
      const actor = entry.reviewer_identity || "Unknown reviewer";
      const surface = entry.source_surface || "Unknown surface";
      const reason = entry.reason ? ` - ${entry.reason}` : "";
      return `${entry.review_state}; ${entry.approval_state} by ${actor} via ${surface}${reason}`;
    });
    appendSection(document, panel, "Audit trail", auditTrail);

    const actions = createElement(document, "section", "ll-overlay-section ll-overlay-actions");
    actions.appendChild(createElement(document, "h3", "", "Actions"));

    ACTION_GROUPS.forEach((group) => {
      const groupElement = createElement(document, "div", "ll-overlay-action-group");
      groupElement.appendChild(createElement(document, "h4", "", group.title));
      const row = createElement(document, "div", "ll-overlay-action-row");
      group.actions.forEach(([actionName, labelFactory, permission, tone]) => {
        appendActionButton(document, row, annotation, actionName, labelFactory, permission, tone, handlers);
      });
      groupElement.appendChild(row);
      actions.appendChild(groupElement);
    });

    const shareGroup = createElement(document, "div", "ll-overlay-action-group");
    shareGroup.appendChild(createElement(document, "h4", "", "Share"));
    const shareRow = createElement(document, "div", "ll-overlay-action-row");

    const copy = createElement(document, "button", "ll-overlay-action", "Copy suggested message");
    copy.setAttribute("type", "button");
    copy.setAttribute("data-action", "copy_message");
    copy.addEventListener("click", () => handlers.onCopyMessage(guidance.suggested_message || ""));
    shareRow.appendChild(copy);

    const open = createElement(document, "button", "ll-overlay-action", "Open workbench");
    open.setAttribute("type", "button");
    open.setAttribute("data-action", "open_legacylift");
    open.addEventListener("click", () => handlers.onOpenLegacyLift(annotation));
    shareRow.appendChild(open);
    shareGroup.appendChild(shareRow);
    actions.appendChild(shareGroup);

    panel.appendChild(actions);
    document.body.appendChild(panel);
    return panel;
  }

  function renderOverlayState(document, state, message, handlers) {
    removeAll(document, ".ll-overlay-state");
    const clickable = handlers && typeof handlers.onActivate === "function";
    const banner = createElement(document, clickable ? "button" : "div", `ll-overlay-state ll-overlay-state-${state}`, message);
    if (clickable) {
      banner.setAttribute("type", "button");
      banner.addEventListener("click", handlers.onActivate);
    }
    banner.setAttribute("role", state === "ready" ? "status" : "alert");
    document.body.appendChild(banner);
    return banner;
  }

  function clearOverlay(document) {
    removeAll(document, ".ll-overlay-badge");
    removeAll(document, ".ll-overlay-panel");
    removeAll(document, ".ll-overlay-rail");
    removeAll(document, ".ll-overlay-state");
  }

  namespace.renderBadges = renderBadges;
  namespace.renderAnnotationRail = renderAnnotationRail;
  namespace.renderDetailPanel = renderDetailPanel;
  namespace.renderOverlayState = renderOverlayState;
  namespace.clearOverlay = clearOverlay;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { clearOverlay, renderAnnotationRail, renderBadges, renderDetailPanel, renderOverlayState };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
