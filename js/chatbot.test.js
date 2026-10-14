const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const chatbot = require("./chatbot.js");

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.hidden = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
  }

  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  append(child) { child.parentNode = this; this.children.push(child); }
  focus() { this.ownerDocument.activeElement = this; }

  dispatch(type, values = {}) {
    const event = { type, target: this, currentTarget: this, prevented: false, preventDefault() { this.prevented = true; }, ...values };
    for (const listener of this.listeners[type] || []) listener(event);
    return event;
  }
}

function fakeDocument(page = "index") {
  const document = {
    listeners: {}, activeElement: null,
    createElement(tagName) { return new FakeElement(document, tagName); },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      const id = selector.slice(1), pending = [...this.body.children];
      while (pending.length) {
        const element = pending.shift();
        if (element.id === id) return element;
        pending.push(...element.children);
      }
      return null;
    },
    dispatch(type, values = {}) {
      const event = { type, prevented: false, preventDefault() { this.prevented = true; }, ...values };
      for (const listener of this.listeners[type] || []) listener(event);
      return event;
    }
  };
  document.body = new FakeElement(document, "body");
  document.body.dataset = { page };
  return document;
}

function findByClass(element, className) {
  if (element.className.split(/\s+/).includes(className)) return element;
  for (const child of element.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

test("CommonJS FAQ module exposes only the public widget interface", () => {
  assert.deepEqual(Object.keys(chatbot).sort(), ["appendMessage", "mount", "replyFor"]);
});

test("shipping FAQ never invents a fee and points to checkout", () => {
  const answer = chatbot.replyFor("phí giao hàng bao nhiêu");
  assert.equal(answer.intent, "shipping");
  assert.match(answer.text, /kiểm tra.*checkout/i);
  assert.equal(answer.link.href, "cart.html");
});

test("FAQ maps each approved topic to a static answer and destination", () => {
  const cases = [
    ["tìm sản phẩm cho da khô", "products", "products.html"],
    ["theo dõi đơn hàng", "orders", "warranty.html"],
    ["đổi trả và bảo hành", "returns", "warranty.html"],
    ["đặt lịch tư vấn", "consultation", "consultation.html"]
  ];

  for (const [question, intent, href] of cases) {
    const answer = chatbot.replyFor(question);
    assert.equal(answer.intent, intent);
    assert.equal(answer.link.href, href);
    assert.ok(answer.text.length > 0);
  }
});

test("unknown questions return a helpful human-support fallback", () => {
  const answer = chatbot.replyFor("câu hỏi không nhận diện");
  assert.equal(answer.intent, "unknown");
  assert.equal(answer.link.href, "consultation.html");
});

test("FAQ matching ignores Vietnamese accents", () => {
  assert.equal(chatbot.replyFor("phi giao hang").intent, "shipping");
});

test("message insertion keeps HTML-looking user text literal", () => {
  const inserted = [];
  const container = {
    ownerDocument: {
      createElement(tagName) {
        return { tagName, textContent: "", className: "" };
      }
    },
    append(node) { inserted.push(node); }
  };

  chatbot.appendMessage(container, "<img src=x onerror=alert(1)>", "user");

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].tagName, "p");
  assert.equal(inserted[0].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(inserted[0].className, "chatbot-message chatbot-message-user");
});

test("widget does not mount on admin pages", () => {
  const document = fakeDocument("admin");
  assert.equal(chatbot.mount(document), false);
  assert.equal(document.body.children.length, 0);
});

test("browser boot waits for DOM readiness and never mounts on admin", () => {
  const source = readFileSync(join(__dirname, "chatbot.js"), "utf8");
  const customerDocument = fakeDocument();
  customerDocument.readyState = "loading";
  vm.runInNewContext(source, { document: customerDocument });
  assert.equal(customerDocument.body.children.length, 0);
  customerDocument.dispatch("DOMContentLoaded");
  assert.equal(customerDocument.body.children.length, 2);

  const adminDocument = fakeDocument("admin");
  adminDocument.readyState = "complete";
  vm.runInNewContext(source, { document: adminDocument });
  assert.equal(adminDocument.body.children.length, 0);
});

test("widget exposes accessible controls and mounts only once", () => {
  const document = fakeDocument();
  assert.equal(chatbot.mount(document), true);
  assert.equal(chatbot.mount(document), false);
  assert.equal(document.body.children.length, 2);

  const launcher = findByClass(document.body, "chatbot-launcher");
  const panel = document.querySelector("#mb-chatbot-panel");
  const log = findByClass(panel, "chatbot-log");
  assert.equal(launcher.getAttribute("aria-controls"), "mb-chatbot-panel");
  assert.equal(launcher.getAttribute("aria-expanded"), "false");
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.equal(panel.getAttribute("aria-label"), "Trợ lý Maison Belle");
  assert.equal(log.getAttribute("role"), "log");
  assert.equal(log.getAttribute("aria-live"), "polite");
});

test("launcher, close button, and Escape manage visibility and restore focus", () => {
  const document = fakeDocument();
  assert.equal(chatbot.mount(document), true);
  const launcher = findByClass(document.body, "chatbot-launcher");
  const panel = document.querySelector("#mb-chatbot-panel");
  const input = findByClass(panel, "chatbot-question");
  const close = findByClass(panel, "chatbot-close");

  launcher.dispatch("click");
  assert.equal(panel.hidden, false);
  assert.equal(launcher.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, input);
  close.dispatch("click");
  assert.equal(panel.hidden, true);
  assert.equal(launcher.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, launcher);

  launcher.dispatch("click");
  document.dispatch("keydown", { key: "Escape" });
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, launcher);
});

test("suggested and free-text questions use static replies and literal text nodes", () => {
  const document = fakeDocument();
  assert.equal(chatbot.mount(document), true);
  const launcher = findByClass(document.body, "chatbot-launcher");
  const panel = document.querySelector("#mb-chatbot-panel");
  const log = findByClass(panel, "chatbot-log");
  const form = findByClass(panel, "chatbot-form");
  const input = findByClass(form, "chatbot-question");
  const shippingPrompt = findByClass(panel, "chatbot-suggestion-shipping");

  launcher.dispatch("click");
  assert.equal(shippingPrompt.getAttribute("aria-label"), "Câu hỏi gợi ý: Phí giao hàng");
  shippingPrompt.dispatch("click");
  assert.ok(log.children.some((node) => node.textContent === "Bạn có thể kiểm tra phí giao hàng do máy chủ xác nhận theo tỉnh/thành tại bước checkout."));
  assert.ok(log.children.some((node) => node.tagName === "a" && node.getAttribute("href") === "cart.html"));

  input.value = "<img src=x onerror=alert(1)>";
  const event = form.dispatch("submit");
  assert.equal(event.prevented, true);
  assert.ok(log.children.some((node) => node.textContent === "<img src=x onerror=alert(1)>"));
  assert.ok(log.children.every((node) => node.tagName !== "img"));
  assert.ok(log.children.some((node) => node.tagName === "a" && node.getAttribute("href") === "consultation.html"));
});
