const test = require("node:test");
const assert = require("node:assert/strict");
const chatbot = require("./chatbot.js");

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
