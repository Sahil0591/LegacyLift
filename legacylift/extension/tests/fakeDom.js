class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.values.add(token));
    this.element.className = [...this.values].join(" ");
  }

  remove(...tokens) {
    tokens.forEach((token) => this.values.delete(token));
    this.element.className = [...this.values].join(" ");
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this._className = "";
    this._textContent = "";
    this.listeners = new Map();
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value || "");
    this.classList.values = new Set(this._className.split(/\s+/).filter(Boolean));
    this.attributes.set("class", this._className);
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join("")}`;
  }

  set textContent(value) {
    this._textContent = String(value || "");
    this.children = [];
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  prepend(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.unshift(child);
    return child;
  }

  after(child) {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    child.parentElement = this.parentElement;
    child.ownerDocument = this.ownerDocument;
    this.parentElement.children.splice(index + 1, 0, child);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "class") {
      this.className = stringValue;
    }
    if (name === "id") {
      this.id = stringValue;
    }
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const listeners = this.listeners.get(event.type) || [];
    listeners.forEach((listener) => listener.call(this, event));
  }

  click() {
    this.dispatchEvent({ type: "click", preventDefault() {} });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
    const matches = [];
    const visit = (element) => {
      if (selectors.some((part) => element.matches(part))) {
        matches.push(element);
      }
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  matches(selector) {
    const trimmed = selector.trim();
    if (!trimmed) return false;
    if (trimmed.includes(" ")) {
      const parts = trimmed.split(/\s+/);
      return this.matches(parts[parts.length - 1]);
    }

    const attrMatches = [...trimmed.matchAll(/\[([^\]=~^$*]+)(?:([\^$*]?=)"?([^\]"]+)"?)?\]/g)];
    const withoutAttrs = trimmed.replace(/\[[^\]]+\]/g, "");
    const idMatch = withoutAttrs.match(/#([A-Za-z0-9_-]+)/);
    const classMatches = [...withoutAttrs.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
    const tag = withoutAttrs.replace(/#[A-Za-z0-9_-]+/g, "").replace(/\.[A-Za-z0-9_-]+/g, "");

    if (tag && tag !== "*" && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    if (idMatch && this.getAttribute("id") !== idMatch[1]) return false;
    if (classMatches.some((className) => !this.classList.contains(className))) return false;

    return attrMatches.every((match) => {
      const attrName = match[1];
      const operator = match[2];
      const expected = match[3];
      const actual = this.getAttribute(attrName);
      if (actual === null) return false;
      if (!operator) return true;
      if (operator === "=") return actual === expected;
      if (operator === "^=") return actual.startsWith(expected);
      if (operator === "$=") return actual.endsWith(expected);
      if (operator === "*=") return actual.includes(expected);
      return false;
    });
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("#document");
    this.ownerDocument = this;
    this.body = this.createElement("body");
    this.documentElement = this.createElement("html");
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }
}

function createDocument() {
  return new FakeDocument();
}

function createLine(document, lineNumber) {
  const line = document.createElement("td");
  line.classList.add("blob-num");
  line.setAttribute("data-line-number", String(lineNumber));
  line.setAttribute("id", `L${lineNumber}`);
  return line;
}

module.exports = {
  FakeElement,
  createDocument,
  createLine,
};
