// @ts-check
(function attachRenderer(global) {
  const namespace = /** @type {any} */ (global.LegacyLiftOverlay = global.LegacyLiftOverlay || {});

  const ACTIONS = [
    ["confirm_owner", "Confirm owner", "can_confirm"],
    ["reassign_owner", "Reassign", "can_reassign"],
    ["flag", "Flag", "can_flag"],
    ["request_approval", "Request approval", "can_request_approval"],
    ["mark_approved", "Mark approved", "can_mark_approved"],
    ["waive_approval", "Waive", "can_waive"],
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

  function renderBadges(document, items, handlers) {
    removeAll(document, ".ll-overlay-badge");
    items.forEach(({ file, annotation }) => {
      const anchor = namespace.findLineAnchor(file, annotation.line_range);
      const badge = createElement(document, "button", "ll-overlay-badge", `${annotation.owner} - ${annotation.confidence}`);
      badge.setAttribute("type", "button");
      badge.setAttribute("data-annotation-id", annotation.id);
      badge.addEventListener("click", (event) => {
        event.preventDefault();
        handlers.onSelect(annotation);
      });

      if (anchor && typeof anchor.after === "function") {
        anchor.after(badge);
      } else {
        file.root.appendChild(badge);
      }
    });
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
    appendSection(
      document,
      panel,
      "Owner",
      `${annotation.owner} - ${annotation.confidence}. ${annotation.review_status}; ${annotation.approval_status}.`,
    );
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

    const actions = createElement(document, "section", "ll-overlay-section ll-overlay-actions");
    actions.appendChild(createElement(document, "h3", "", "Actions"));

    ACTIONS.forEach(([actionName, label, permission]) => {
      const button = createElement(document, "button", "ll-overlay-action", label);
      button.setAttribute("type", "button");
      button.setAttribute("data-action", actionName);
      if (annotation.actions && annotation.actions[permission] === false) {
        button.setAttribute("disabled", "true");
      }
      button.addEventListener("click", () => handlers.onAction(actionName, annotation));
      actions.appendChild(button);
    });

    const copy = createElement(document, "button", "ll-overlay-action", "Copy message");
    copy.setAttribute("type", "button");
    copy.setAttribute("data-action", "copy_message");
    copy.addEventListener("click", () => handlers.onCopyMessage(guidance.suggested_message || ""));
    actions.appendChild(copy);

    const open = createElement(document, "button", "ll-overlay-action", "Open in LegacyLift");
    open.setAttribute("type", "button");
    open.setAttribute("data-action", "open_legacylift");
    open.addEventListener("click", () => handlers.onOpenLegacyLift(annotation));
    actions.appendChild(open);

    panel.appendChild(actions);
    document.body.appendChild(panel);
    return panel;
  }

  function renderOverlayState(document, state, message) {
    removeAll(document, ".ll-overlay-state");
    const banner = createElement(document, "div", `ll-overlay-state ll-overlay-state-${state}`, message);
    banner.setAttribute("role", state === "ready" ? "status" : "alert");
    document.body.appendChild(banner);
    return banner;
  }

  function clearOverlay(document) {
    removeAll(document, ".ll-overlay-badge");
    removeAll(document, ".ll-overlay-panel");
    removeAll(document, ".ll-overlay-state");
  }

  namespace.renderBadges = renderBadges;
  namespace.renderDetailPanel = renderDetailPanel;
  namespace.renderOverlayState = renderOverlayState;
  namespace.clearOverlay = clearOverlay;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { clearOverlay, renderBadges, renderDetailPanel, renderOverlayState };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
