const test = require("node:test");
const assert = require("node:assert/strict");
const MB = require("./app.js");

test("email validation accepts trimmed addresses and rejects malformed or empty input", () => {
  for (const email of [" belle@example.com ", "belle+shop@example.co.vn"]) assert.equal(MB.isValidEmail(email), true, email);
  for (const email of ["", "   ", "belle@", "@example.com", "belle@example", "belle @example.com", "belle@example..com", "a".repeat(255) + "@example.com", null, undefined]) {
    assert.equal(MB.isValidEmail(email), false, String(email));
  }
});

test("product normalization preserves the API variant identity and demo label", () => {
  const product = MB.normalizeProduct({
    _id: "product-1",
    name: "Serum dịu da",
    brand: { name: "Maison Belle" },
    category: { name: "Chăm sóc da" },
    images: ["/media/serum.jpg"],
    variants: [{ _id: "variant-1", sku: "MB-01", size: "30ml", price: 250000, stockQuantity: 7, isActive: true }],
    isDemo: true
  });

  assert.equal(product.id, "product-1");
  assert.equal(product.variantId, "variant-1");
  assert.equal(product.price, 250000);
  assert.equal(product.stock, 7);
  assert.equal(product.isDemo, true);
  assert.equal(product.image, "/media/serum.jpg");
});

test("product text is escaped before it is inserted into an HTML view", () => {
  assert.equal(MB.escape('<img src=x onerror="run()">'), "&lt;img src=x onerror=&quot;run()&quot;&gt;");
});

test("duplicate account errors are shown in Vietnamese", () => {
  assert.equal(MB.errorMessage({ status: 409, code: "DUPLICATE_USER", message: "Email or phone already exists" }), "Email hoặc số điện thoại này đã được đăng ký.");
});

test("remembering an account stores only its email and can be cleared", () => {
  const previousStorage = global.localStorage;
  const data = new Map();
  global.localStorage = {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };

  try {
    assert.equal(typeof MB.rememberEmail, "function", "the opt-in account reminder needs a storage handler");
    MB.rememberEmail("  belle@example.test  ", true);
    assert.equal(MB.rememberedEmail(), "belle@example.test");
    assert.deepEqual([...data.values()], ["belle@example.test"]);
    MB.rememberEmail("belle@example.test", false);
    assert.equal(MB.rememberedEmail(), "");
    assert.equal(data.size, 0);
  } finally {
    if (previousStorage === undefined) delete global.localStorage; else global.localStorage = previousStorage;
  }
});

test("password visibility control toggles the input and its accessible action label", () => {
  const input = { type: "password" };
  const attributes = {};
  const button = {
    textContent: "Hiện",
    setAttribute(name, value) { attributes[name] = value; }
  };

  assert.equal(typeof MB.togglePasswordControl, "function");
  MB.togglePasswordControl(input, button);
  assert.equal(input.type, "text");
  assert.equal(button.textContent, "Ẩn");
  assert.deepEqual(attributes, { "aria-label": "Ẩn mật khẩu", "aria-pressed": "true" });

  MB.togglePasswordControl(input, button);
  assert.equal(input.type, "password");
  assert.equal(button.textContent, "Hiện");
  assert.deepEqual(attributes, { "aria-label": "Hiện mật khẩu", "aria-pressed": "false" });
});

test("theme control displays only its icon and keeps an accessible action label", () => {
  const previousDocument = global.document;
  const previousStorage = global.localStorage;
  const attrs = {};
  const listeners = {};
  const button = {
    addEventListener(type, listener) { listeners[type] = listener; },
    setAttribute(name, value) { attrs[name] = value; },
    set innerHTML(value) { this.textContent = value; }
  };
  const host = { querySelector() { return null; }, prepend() {} };
  const document = {
    documentElement: { dataset: {} },
    querySelector(selector) { return selector === "#admin-theme-control" ? null : host; },
    createElement() { return button; }
  };
  global.document = document;
  global.localStorage = { getItem() { return null; }, setItem() {} };

  try {
    MB.mountTheme();
    assert.equal(button.textContent, "☾");
    assert.equal(attrs["aria-label"], "Bật giao diện tối");
    assert.equal(button.title, "Bật giao diện tối");
    listeners.click();
    assert.equal(button.textContent, "☀");
    assert.equal(attrs["aria-label"], "Bật giao diện sáng");
  } finally {
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
    if (previousStorage === undefined) delete global.localStorage; else global.localStorage = previousStorage;
  }
});

test("nav indicator also follows the product category menu", () => {
  const previousDocument = global.document;
  const previousMatchMedia = global.matchMedia;
  const previousAddEventListener = global.addEventListener;
  const linkListeners = {};
  const directLink = {
    addEventListener(type, listener) { linkListeners.link = listener; },
    getBoundingClientRect() { return { left: 10, width: 50 }; }
  };
  const summary = {
    addEventListener(type, listener) { linkListeners.summary = listener; },
    getBoundingClientRect() { return { left: 80, width: 90 }; }
  };
  const pill = {
    style: { removeProperty(name) { delete this[name]; } },
    getBoundingClientRect() { return { left: 0, width: 0 }; }
  };
  const nav = {
    prepend() {},
    getBoundingClientRect() { return { left: 0 }; },
    querySelector() { return directLink; },
    querySelectorAll(selector) { return selector.includes("summary") ? [directLink, summary] : [directLink]; },
    addEventListener() {}
  };
  global.document = { querySelector() { return nav; }, createElement() { return pill; } };
  global.matchMedia = () => ({ matches: false });
  global.addEventListener = () => {};

  try {
    MB.mountNav();
    assert.equal(typeof linkListeners.summary, "function");
    linkListeners.summary();
    assert.equal(pill.style.width, "90px");
    assert.equal(pill.style.transform, "translateX(80px)");
  } finally {
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
    if (previousMatchMedia === undefined) delete global.matchMedia; else global.matchMedia = previousMatchMedia;
    if (previousAddEventListener === undefined) delete global.addEventListener; else global.addEventListener = previousAddEventListener;
  }
});

test("product category menu closes when the pointer leaves or another nav item is clicked", () => {
  const previousDocument = global.document;
  const previousMatchMedia = global.matchMedia;
  const previousAddEventListener = global.addEventListener;
  const categoryListeners = {};
  const navListeners = {};
  const categoryMenu = {
    open: false,
    addEventListener(type, listener) { categoryListeners[type] = listener; },
    contains(target) { return target === categoryMenu; }
  };
  const directLink = {
    addEventListener() {},
    getBoundingClientRect() { return { left: 0, width: 50 }; }
  };
  const nav = {
    prepend() {},
    getBoundingClientRect() { return { left: 0 }; },
    querySelector(selector) { return selector.includes("nav-categories") ? categoryMenu : directLink; },
    querySelectorAll() { return [directLink]; },
    addEventListener(type, listener) { navListeners[type] = listener; }
  };
  global.document = { querySelector() { return nav; }, createElement() { return {
    style: { removeProperty(name) { delete this[name]; } },
    getBoundingClientRect() { return { left: 0, width: 0 }; }
  }; } };
  global.matchMedia = () => ({ matches: false });
  global.addEventListener = () => {};

  try {
    MB.mountNav();
    categoryListeners.pointerenter({ pointerType: "mouse" });
    assert.equal(categoryMenu.open, true, "hovering the product menu opens its native details element");
    categoryListeners.pointerleave({ pointerType: "mouse" });
    assert.equal(categoryMenu.open, false, "leaving the product menu closes it");
    categoryListeners.pointerenter({ pointerType: "mouse" });
    navListeners.click({ target: directLink });
    assert.equal(categoryMenu.open, false, "choosing another navigation item closes it");
  } finally {
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
    if (previousMatchMedia === undefined) delete global.matchMedia; else global.matchMedia = previousMatchMedia;
    if (previousAddEventListener === undefined) delete global.addEventListener; else global.addEventListener = previousAddEventListener;
  }
});

test("admin navigation is only added for manager or admin roles", async () => {
  const previousDocument = global.document;
  const previousApi = global.MBApi;
  const children = [];
  const nav = {
    querySelector() { return children.find((item) => item.dataset.adminNav !== undefined) || null; },
    append(item) { children.push(item); }
  };
  const link = {
    dataset: {},
    setAttribute(name, value) { this.dataset[name.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; }
  };
  global.document = { querySelector() { return nav; }, createElement() { return link; } };
  global.MBApi = { auth: { me: async () => ({ data: { role: "customer" } }) } };

  try {
    await MB.mountAdminNav();
    assert.equal(children.length, 0, "customers should not see the admin entry");
    global.MBApi.auth.me = async () => ({ data: { role: "manager" } });
    await MB.mountAdminNav();
    assert.equal(children.length, 1);
    assert.equal(link.href, "admin.html");
    assert.equal(link.textContent, "QUẢN LÝ");
    assert.equal(link.dataset.adminNav, "");
  } finally {
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
    if (previousApi === undefined) delete global.MBApi; else global.MBApi = previousApi;
  }
});

test("catalog cards retain normalized product images", () => {
  const html = MB.card({ id: "p1", name: "Serum", image: "/media/serum.jpg", price: 120000, variants: [{ id: "v1" }], variantId: "v1" });
  assert.match(html, /src="\/media\/serum\.jpg"/);
});

test("catalog cards do not expose a favorite action without a supported favorites API", () => {
  const html = MB.card({ id: "p1", name: "Serum", price: 120000, variants: [{ id: "v1" }], variantId: "v1" });
  assert.doesNotMatch(html, /data-wish|đang chờ API/i);
});

test("decreasing a cart line never removes it; removal remains an explicit action", () => {
  assert.equal(MB.cartQuantity(1, -1), 1);
  assert.equal(MB.cartQuantity(2, -1), 1);
  assert.equal(MB.cartQuantity(2, 1), 3);
});

test("anonymous cart changes persist locally when the server requires login", async () => {
  const previousApi = global.MBApi;
  const previousStorage = global.localStorage;
  const previousGuestMode = MB._guestCartMode;
  const previousGuestItems = MB._guestCartItems;
  const previousCartReadPromise = MB._cartReadPromise;
  const storage = new Map();
  global.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  global.MBApi = { cart: { get: async () => { throw { status: 401 }; }, update: async () => { throw { status: 401 }; } } };
  MB._guestCartMode = false;

  try {
    await MB.add("product-1", "variant-1", 1, "30ml");
    await MB.add("product-1", "variant-1", 2, "30ml");
    assert.deepEqual(await MB.readCart(), [{ variantId: "variant-1", quantity: 3, size: "30ml" }]);
    assert.deepEqual(JSON.parse(storage.get("mb-guest-cart")), [{ variantId: "variant-1", quantity: 3, size: "30ml" }]);
  } finally {
    MB._guestCartMode = previousGuestMode;
    MB._guestCartItems = previousGuestItems;
    MB._cartReadPromise = previousCartReadPromise;
    if (previousApi === undefined) delete global.MBApi; else global.MBApi = previousApi;
    if (previousStorage === undefined) delete global.localStorage; else global.localStorage = previousStorage;
  }
});

test("signing in merges the guest cart into the account cart before clearing it", async () => {
  const previousApi = global.MBApi;
  const previousStorage = global.localStorage;
  const previousGuestMode = MB._guestCartMode;
  const previousGuestItems = MB._guestCartItems;
  const previousCartReadPromise = MB._cartReadPromise;
  const storage = new Map([["mb-guest-cart", JSON.stringify([
    { variantId: "variant-1", quantity: 2, size: "30ml" },
    { variantId: "variant-2", quantity: 1, size: "50ml" }
  ])]]);
  let savedItems = [];
  global.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  global.MBApi = { cart: {
    get: async () => ({ data: { items: [{ variantId: "variant-1", quantity: 1, size: "30ml" }] } }),
    update: async ({ items }) => { savedItems = items; return { data: { items } }; }
  } };
  MB._guestCartMode = false;

  try {
    assert.deepEqual(await MB.readCart(), [
      { variantId: "variant-1", quantity: 3, size: "30ml" },
      { variantId: "variant-2", quantity: 1, size: "50ml" }
    ]);
    assert.deepEqual(savedItems, [
      { variantId: "variant-1", quantity: 3, size: "30ml" },
      { variantId: "variant-2", quantity: 1, size: "50ml" }
    ]);
    assert.equal(storage.has("mb-guest-cart"), false);
  } finally {
    MB._guestCartMode = previousGuestMode;
    MB._guestCartItems = previousGuestItems;
    MB._cartReadPromise = previousCartReadPromise;
    if (previousApi === undefined) delete global.MBApi; else global.MBApi = previousApi;
    if (previousStorage === undefined) delete global.localStorage; else global.localStorage = previousStorage;
  }
});

test("guest items stay saved when syncing them to the signed-in cart fails", async () => {
  const previousApi = global.MBApi;
  const previousStorage = global.localStorage;
  const previousGuestMode = MB._guestCartMode;
  const previousGuestItems = MB._guestCartItems;
  const previousCartReadPromise = MB._cartReadPromise;
  const guestItems = [{ variantId: "variant-1", quantity: 2, size: "30ml" }];
  const storage = new Map([["mb-guest-cart", JSON.stringify(guestItems)]]);
  global.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  global.MBApi = { cart: {
    get: async () => ({ data: { items: [] } }),
    update: async () => { throw { status: 503 }; }
  } };
  MB._guestCartMode = false;

  try {
    await assert.rejects(MB.readCart(), (error) => error.status === 503);
    assert.deepEqual(JSON.parse(storage.get("mb-guest-cart")), guestItems);
  } finally {
    MB._guestCartMode = previousGuestMode;
    MB._guestCartItems = previousGuestItems;
    MB._cartReadPromise = previousCartReadPromise;
    if (previousApi === undefined) delete global.MBApi; else global.MBApi = previousApi;
    if (previousStorage === undefined) delete global.localStorage; else global.localStorage = previousStorage;
  }
});

test("normalization reads the API's retailPrice, volume, variant image, and category reference", () => {
  const product = MB.normalizeProduct({
    id: "p2", name: "Gel rửa mặt", categoryId: "category-id",
    variants: [{ id: "v2", sku: "SKU-2", volume: "150ml", retailPrice: 225000, originalPrice: 295000, imageUrl: "img/skincare.jpg" }]
  });

  assert.equal(product.price, 225000);
  assert.equal(product.old, 295000);
  assert.equal(product.sizes[0], "150ml");
  assert.equal(product.image, "img/skincare.jpg");
  assert.equal(product.cat, "category-id");
});

test("product normalization uses an active promotion price while retaining its retail price", () => {
  const product = MB.normalizeProduct({
    id: "p3", name: "Serum ưu đãi",
    variants: [{ id: "v3", sku: "SKU-3", retailPrice: 300000, originalPrice: 350000, promotionPrice: 250000, promotionName: "Beauty Week" }]
  });
  assert.equal(product.price, 250000);
  assert.equal(product.old, 350000);
  assert.equal(product.promotionName, "Beauty Week");
});

test("motion observer reveals storefront and staff content as it enters the viewport", () => {
  const previousDocument = global.document;
  const previousObserver = global.IntersectionObserver;
  const previousIO = MB.io;
  const targets = [
    { dataset: {}, classes: new Set(), classList: { add(value) { this.owner.classes.add(value); } } },
    { dataset: {}, classes: new Set(), classList: { add(value) { this.owner.classes.add(value); } } }
  ];
  targets.forEach((target) => { target.classList.owner = target; });
  let selector = "";
  let observer;

  global.document = { querySelectorAll(value) { selector = value; return targets; } };
  global.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.observed = []; this.unobserved = []; observer = this; }
    observe(target) { this.observed.push(target); }
    unobserve(target) { this.unobserved.push(target); }
  };
  MB.io = null;

  try {
    MB.watch();
    assert.match(selector, /\.admin \.panel/);
    assert.match(selector, /\.account-card/);
    assert.match(selector, /\.cartitem/);
    assert.equal(observer.observed.length, targets.length);
    observer.callback([
      { target: targets[0], isIntersecting: false },
      { target: targets[1], isIntersecting: true }
    ]);
    assert.equal(targets[0].classes.has("in"), false);
    assert.equal(targets[1].classes.has("in"), true);
    assert.deepEqual(observer.unobserved, [targets[1]]);
  } finally {
    MB.io = previousIO;
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
    if (previousObserver === undefined) delete global.IntersectionObserver; else global.IntersectionObserver = previousObserver;
  }
});
