// @ts-check
(function attachGitHubDom(global) {
  const namespace = /** @type {any} */ (global.LegacyLiftOverlay = global.LegacyLiftOverlay || {});

  const FILE_SELECTORS = "copilot-diff-entry, .js-file, [data-file-path], [data-tagsearch-path], [data-path], [data-file-name], .file";
  const LINE_SELECTORS = "[data-line-number], [data-line], .blob-num, [id^=\"L\"], [id^=\"LC\"]";

  function toArray(value) {
    return Array.from(value || []);
  }

  function getAttribute(element, name) {
    return element && typeof element.getAttribute === "function" ? element.getAttribute(name) : null;
  }

  function extractFilePath(fileElement) {
    const direct =
      getAttribute(fileElement, "data-file-path") ||
      getAttribute(fileElement, "data-tagsearch-path") ||
      getAttribute(fileElement, "data-path") ||
      getAttribute(fileElement, "data-file-name");
    if (direct) return direct;

    const titled = fileElement.querySelector
      ? fileElement.querySelector(
          "[data-file-path], [data-tagsearch-path], [data-path], [data-file-name], .file-info a[title], [data-testid=\"diff-file-header\"] [title], a[title], [title]",
        )
      : null;
    if (!titled) return null;
    return (
      getAttribute(titled, "data-file-path") ||
      getAttribute(titled, "data-tagsearch-path") ||
      getAttribute(titled, "data-path") ||
      getAttribute(titled, "data-file-name") ||
      getAttribute(titled, "title")
    );
  }

  function lineNumberFromElement(element) {
    const raw =
      getAttribute(element, "data-line-number") ||
      getAttribute(element, "data-line") ||
      getAttribute(element, "aria-label") ||
      getAttribute(element, "id") ||
      "";
    const match = String(raw).match(/(?:^|[^0-9])([0-9]+)(?:$|[^0-9])/);
    if (!match) {
      return null;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function extractVisibleLines(root) {
    const lines = toArray(root.querySelectorAll ? root.querySelectorAll(LINE_SELECTORS) : [])
      .map(lineNumberFromElement)
      .filter((lineNumber) => typeof lineNumber === "number");
    return [...new Set(lines)].sort((a, b) => a - b);
  }

  function extractPageFilePath(root) {
    if (!root.querySelector) return null;
    const candidate = root.querySelector(
      "[data-file-path], [data-tagsearch-path], [data-path], [data-file-name], a[href^=\"#diff-\"][title], a[href^=\"#diff-\"], .file-info a[title], .Truncate-text[title], .file-header [title]",
    );
    if (!candidate) return null;
    const path =
      getAttribute(candidate, "data-file-path") ||
      getAttribute(candidate, "data-tagsearch-path") ||
      getAttribute(candidate, "data-path") ||
      getAttribute(candidate, "data-file-name") ||
      getAttribute(candidate, "title") ||
      (candidate.textContent ? String(candidate.textContent).trim() : null);
    return path && !path.includes("\n") ? path : null;
  }

  function extractVisibleFiles(root, context) {
    const files = toArray(root.querySelectorAll ? root.querySelectorAll(FILE_SELECTORS) : [])
      .map((fileElement) => {
        const path = extractFilePath(fileElement);
        if (!path) return null;
        return {
          path,
          root: fileElement,
          visibleLines: extractVisibleLines(fileElement),
        };
      })
      .filter(Boolean);

    const deduped = [];
    files.forEach((file) => {
      const existingIndex = deduped.findIndex((candidate) => candidate.path === file.path);
      if (existingIndex === -1) {
        deduped.push(file);
        return;
      }
      if (file.visibleLines.length > deduped[existingIndex].visibleLines.length) {
        deduped[existingIndex] = file;
      }
    });

    if (deduped.length === 0 && context && context.kind === "blob" && context.path) {
      return [
        {
          path: context.path,
          root,
          visibleLines: extractVisibleLines(root),
        },
      ];
    }

    if (deduped.length === 0 && context && context.kind === "pull") {
      const visibleLines = extractVisibleLines(root);
      const path = extractPageFilePath(root) || "README";
      return [{ path, root, visibleLines }];
    }

    return deduped;
  }

  function formatVisibleLines(lines) {
    const sorted = [...new Set(lines)].sort((a, b) => a - b);
    const ranges = [];
    let start = null;
    let previous = null;

    sorted.forEach((line) => {
      if (start === null) {
        start = line;
        previous = line;
        return;
      }

      if (previous !== null && line === previous + 1) {
        previous = line;
        return;
      }

      ranges.push(start === previous ? String(start) : `${start}-${previous}`);
      start = line;
      previous = line;
    });

    if (start !== null) {
      ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    }

    return ranges.join(",");
  }

  function findLineAnchor(file, lineRange) {
    const [start, end] = lineRange;
    const lineElements = toArray(file.root.querySelectorAll ? file.root.querySelectorAll(LINE_SELECTORS) : []);
    const match = lineElements.find((element) => {
      const lineNumber = lineNumberFromElement(element);
      return lineNumber !== null && lineNumber >= start && lineNumber <= end;
    });
    if (match) {
      return match;
    }

    if (file.root.querySelector) {
      return file.root.querySelector(".file-header, .js-file-header, [data-testid=\"diff-file-header\"]") || file.root;
    }
    return file.root;
  }

  namespace.extractVisibleFiles = extractVisibleFiles;
  namespace.formatVisibleLines = formatVisibleLines;
  namespace.findLineAnchor = findLineAnchor;
  namespace.lineNumberFromElement = lineNumberFromElement;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      extractVisibleFiles,
      formatVisibleLines,
      findLineAnchor,
      lineNumberFromElement,
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
