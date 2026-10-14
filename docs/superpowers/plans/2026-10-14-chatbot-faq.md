# Maison Belle FAQ Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible Vietnamese FAQ chatbot to customer-facing pages that answers only from known store content and routes customers to the correct page when needed.

**Architecture:** Keep a pure, deterministic intent/FAQ module in `js/chatbot.js`; mount its widget on customer pages using safe DOM text APIs and static allowlisted links. Style the widget in the existing storefront stylesheet. The chatbot uses no backend/API, AI provider, Mongo collection, transcript persistence or customer order data.

**Tech Stack:** Vanilla JavaScript (UMD/CommonJS pattern), HTML, CSS, Node.js test runner, browser manual smoke test.

**Spec:** `docs/superpowers/specs/2026-10-14-email-verification-password-reset-chatbot-design.md` (section 4 Chatbot FAQ)

> **Execution status (2026-10-14):** Tasks 1–2 are implemented, committed (`1d194ef`, `9ed7185`) and automated tests pass. Independent reviewer dispatch was unavailable because the agent quota is exhausted. Task 3's desktop/mobile browser checks remain open: the computer-use runtime failed to initialize (`failed to write kernel assets: The system cannot find the path specified`), so no live-browser behavior is claimed as verified.

## Global Constraints

- Chatbot là FAQ xác định theo nội dung đã duyệt, không dùng AI, không lưu lịch sử hội thoại và không truy cập dữ liệu cá nhân/đơn hàng.
- Thêm widget dùng chung cho các trang phía khách hàng; không hiển thị trên trang quản trị.
- Bot chỉ nêu dữ kiện có trong luồng/trang hiện tại. Không tự đưa ra phí giao hàng, tồn kho, hạn đổi trả hoặc tình trạng đơn nếu không có dữ liệu xác nhận.
- Không gọi API AI, không đọc dữ liệu đơn hàng riêng tư, không yêu cầu thông tin thanh toán và không lưu hội thoại.
- Nội dung người dùng được hiển thị dưới dạng text, không render HTML tùy ý. Widget dùng được bằng bàn phím, có nhãn truy cập và bố cục phù hợp màn hình nhỏ.
- Câu hỏi không khớp trả lời trung thực và dẫn tới trang đặt lịch/liên hệ hỗ trợ.

---

## File Map

- `js/chatbot.js`: standalone FAQ definitions, deterministic intent matching, reply builder and widget mounting; expose CommonJS for tests and `MBChatbot` in browser.
- `js/chatbot.test.js`: test every intent, safe fallback and static destination.
- `index.html`, `products.html`, `product.html`, `cart.html`, `account.html`, `warranty.html`, `offers.html`, `brands.html`, `about.html`, `consultation.html`: load the widget script after common `js/app.js`; exclude `admin.html`.
- `css/flows.css`: chat launcher, panel, message list and responsive/mobile rules.
- `js/storefront-layout.test.js`: assert all customer pages load the widget and the admin page does not.

## Task 1: Define and test deterministic FAQ intent matching

**Files:**
- Create: `js/chatbot.js`
- Create: `js/chatbot.test.js`

**Interfaces:**
- `MBChatbot.replyFor(text)` returns `{ intent, text, link: { href, label } | null }`.
- Supported intent names: `products`, `shipping`, `orders`, `returns`, `consultation`, and `unknown`.
- `MBChatbot.appendMessage(container, text, kind)` inserts user/bot text with DOM `textContent`; the widget creates links only from the static object returned by `replyFor`, never from user input.

- [x] **Step 1: Write failing tests for all FAQ categories and fallback**

Create `js/chatbot.test.js` using the existing CommonJS `node:test` pattern:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const chatbot = require("./chatbot.js");

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
```

Also test accent-insensitive matching and safe text insertion with a small fake container:

```js
const inserted = [];
const container = {
  ownerDocument: { createElement: (tagName) => ({ tagName, textContent: "", className: "" }) },
  append: (node) => inserted.push(node)
};
chatbot.appendMessage(container, "<img src=x onerror=alert(1)>", "user");
assert.equal(inserted.length, 1);
assert.equal(inserted[0].tagName, "p");
assert.equal(inserted[0].textContent, "<img src=x onerror=alert(1)>");
assert.equal(chatbot.replyFor("phi giao hang").intent, "shipping");
```

- [x] **Step 2: Run the tests and confirm they fail because the module does not exist**

Run from repository root: `node --test js/chatbot.test.js`.
Expected: FAIL with missing `chatbot.js`.

- [x] **Step 3: Implement pure intent matching and approved answers**

Trim and lowercase the question, remove Vietnamese diacritics (including mapping `đ` to `d`), then match explicit keyword groups. Return static answers only:

```js
const intents = [
  { intent: "products", words: ["san pham", "da kho", "da dau", "cham soc da"], text: "Bạn có thể xem danh sách sản phẩm và dùng bộ lọc để tìm theo nhu cầu chăm sóc da.", link: { href: "products.html", label: "Khám phá sản phẩm" } },
  { intent: "shipping", words: ["phi ship", "phi giao", "giao hang"], text: "Bạn có thể kiểm tra phí giao hàng do máy chủ xác nhận theo tỉnh/thành tại bước checkout.", link: { href: "cart.html", label: "Xem giỏ hàng" } },
  { intent: "orders", words: ["tra don", "don hang", "theo doi don"], text: "Bạn cần đăng nhập đúng tài khoản đã đặt hàng để xem trạng thái đơn.", link: { href: "warranty.html", label: "Tra cứu đơn hàng" } },
  { intent: "returns", words: ["doi tra", "bao hanh", "hoan tien"], text: "Thông tin hỗ trợ đổi trả và bảo hành được hướng dẫn tại trang Bảo hành & hỗ trợ.", link: { href: "warranty.html", label: "Bảo hành & hỗ trợ" } },
  { intent: "consultation", words: ["tu van", "dat lich", "chuyen vien"], text: "Đội ngũ Maison Belle có thể hỗ trợ tư vấn và đặt lịch chăm sóc.", link: { href: "consultation.html", label: "Đặt lịch tư vấn" } }
];
```

Normalize both questions and keywords with the same function. Unknown questions link to `consultation.html`; do not claim exact fee, stock, delivery time, order status or return deadline. Export only `replyFor`, `appendMessage`, and `mount` through the CommonJS/browser wrapper.

- [x] **Step 4: Add safe DOM message rendering**

Append messages with element creation and `.textContent`; create anchors only from the returned static FAQ object:

```js
const paragraph = container.ownerDocument.createElement("p");
paragraph.className = kind === "user" ? "chatbot-message chatbot-message-user" : "chatbot-message chatbot-message-bot";
paragraph.textContent = message;
container.append(paragraph);
```

For a reply link, construct an anchor only from the static FAQ record and accept only the known relative destinations:

```js
const allowedHrefs = new Set(["products.html", "cart.html", "warranty.html", "consultation.html"]);
if (reply.link && allowedHrefs.has(reply.link.href)) {
  const link = log.ownerDocument.createElement("a");
  link.href = reply.link.href;
  link.textContent = reply.link.label;
  log.append(link);
}
```

Never concatenate user question into `innerHTML`; do not write history to browser storage.

- [x] **Step 5: Run FAQ unit tests and verify escaped user content remains text**

Run: `node --test js/chatbot.test.js`.
Expected: each intent routes to its approved destination; a string such as `<img src=x onerror=alert(1)>` stays literal text and creates no element.

- [x] **Step 6: Commit the FAQ decision layer**

```powershell
git add js/chatbot.js js/chatbot.test.js
git commit -m "feat: add deterministic storefront FAQ replies"
```

## Task 2: Mount the accessible customer chat widget

**Files:**
- Modify: `js/chatbot.js`
- Modify: `css/flows.css`
- Modify: `index.html`
- Modify: `products.html`
- Modify: `product.html`
- Modify: `cart.html`
- Modify: `account.html`
- Modify: `warranty.html`
- Modify: `offers.html`
- Modify: `brands.html`
- Modify: `about.html`
- Modify: `consultation.html`
- Modify: `js/storefront-layout.test.js`

**Interfaces:**
- `MBChatbot.mount(document)` adds exactly one launcher/panel if `body.dataset.page !== "admin"` and no widget is already mounted.
- The launcher toggles a labelled panel; Escape closes it and returns focus to the launcher.
- Suggested question buttons pass fixed FAQ prompts to `replyFor`.

- [x] **Step 1: Add failing shared-page and accessibility assertions**

Extend `customerPages` checks in `js/storefront-layout.test.js`:

```js
for (const page of [...customerPages, "consultation.html"]) {
  const html = await readFile(join(root, page), "utf8");
  assert.equal((html.match(/js\/chatbot\.js/g) || []).length, 1, `${page} must load exactly one customer FAQ widget`);
}
const admin = await readFile(join(root, "admin.html"), "utf8");
assert.doesNotMatch(admin, /js\/chatbot\.js/, "admin must not mount customer support chat");
```

Add assertions for an `aria-controls` launcher, labelled panel, live transcript and no duplicate script tag.

- [x] **Step 2: Run the layout test and verify it fails before page integration**

Run: `node --test js/storefront-layout.test.js`.
Expected: FAIL because customer pages do not yet load `js/chatbot.js`.

- [x] **Step 3: Add a launcher, panel, quick prompts and submit handler**

Mount after DOM readiness on customer pages only; if the document is already interactive/complete, mount immediately, otherwise register a one-time `DOMContentLoaded` callback. `mount(document)` must return without changes when `body.dataset.page === "admin"` or `#mb-chatbot-panel` already exists. Build the DOM with `createElement`, `setAttribute`, `textContent`, and static FAQ records. The form must accept free-text questions and quick-reply buttons; appending the user question and bot response must never use unsanitized HTML.

```html
<button type="button" class="chatbot-launcher" aria-controls="mb-chatbot-panel" aria-expanded="false">Chat với Maison Belle</button>
<section id="mb-chatbot-panel" class="chatbot-panel" role="dialog" aria-label="Trợ lý Maison Belle" hidden>
  <button type="button" class="chatbot-close" aria-label="Đóng trò chuyện">×</button>
  <div class="chatbot-log" role="log" aria-live="polite" aria-relevant="additions"></div>
  <form class="chatbot-form"><label for="mb-chatbot-question">Câu hỏi</label><input id="mb-chatbot-question" name="question" maxlength="500" required><button type="submit">Gửi</button></form>
</section>
```

On opening, move focus to the input; on close by button or Escape, hide the panel and restore focus to the launcher. Give quick-prompt buttons explicit labels, use `aria-expanded`, and ensure Enter submits without trapping Tab navigation.

- [x] **Step 4: Add the script to the ten customer pages and not the admin page**

Load `js/chatbot.js` after `js/app.js` in all ten customer pages listed in the file map, including `consultation.html`. Keep each page to one script tag. Do not alter page navigation or admin markup.

- [x] **Step 5: Style the fixed panel and mobile behavior**

Add scoped `.chatbot-*` styles to `css/flows.css`: fixed bottom-corner launcher, bounded panel height with scrollable log, visible focus rings, high-contrast controls, and a narrow-screen rule that keeps the panel inside the viewport. For example, constrain `.chatbot-panel` with `width: min(24rem, calc(100vw - 2rem))` and `max-height: min(34rem, calc(100dvh - 6rem))`; set the log to `overflow-y: auto`. Respect `prefers-reduced-motion`; keep all existing global layouts unchanged.

- [x] **Step 6: Run layout and chatbot unit tests**

Run: `node --test js/chatbot.test.js js/storefront-layout.test.js`.
Expected: every customer page includes one widget; admin does not; existing navigation and storefront layout assertions continue to pass.

- [x] **Step 7: Commit the widget integration**

```powershell
git add js/chatbot.js css/flows.css index.html products.html product.html cart.html account.html warranty.html offers.html brands.html about.html consultation.html js/storefront-layout.test.js
git commit -m "feat: mount accessible FAQ chat on storefront"
```

## Task 3: Browser and full frontend regression

**Files:**
- Test: `js/chatbot.test.js`
- Test: `js/storefront-layout.test.js`
- Test: all `js/*.test.js`
- Modify: `docs/superpowers/plans/2026-10-14-chatbot-faq.md`

- [x] **Step 1: Run the complete frontend suite**

Run from repository root: `node --test js/*.test.js`.
Expected: all existing storefront/admin tests plus chatbot tests PASS.

- [ ] **Step 2: Verify desktop keyboard behavior in the running local storefront**

Open `http://localhost:3001/index.html`; use Tab/Enter to open the chat, select a suggested prompt, send an unknown question, and press Escape. Confirm focus returns to the launcher, answers are readable, links navigate to the correct pages, and no console error occurs.

- [ ] **Step 3: Verify mobile viewport and privacy boundaries**

At a narrow viewport, open/close the panel and send an HTML-looking question. Confirm the panel remains within the viewport and the text is displayed literally. Inspect browser storage/network: no transcript is stored and no chatbot-specific network request is sent.

- [x] **Step 4: Check the final diff and commit any test-only corrections**

Run: `git diff --check` and `git status --short --branch`.
Expected: no whitespace errors; changed files are limited to the chatbot module, tests, customer-page script tags, and scoped CSS. After confirming Tasks 1–2 passed review, mark all three task checkboxes complete in this plan. If a correction is needed, add only the relevant files and commit with `test: verify FAQ chatbot interactions`.

```powershell
git add js/chatbot.test.js js/storefront-layout.test.js docs/superpowers/plans/2026-10-14-chatbot-faq.md
git commit -m "docs: record completed FAQ chatbot plan"
```

Do not push until the user explicitly asks for this feature branch to be pushed.
