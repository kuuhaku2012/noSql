(function (root, factory) {
  const MB = factory(root);
  if (typeof module === "object" && module.exports) module.exports = MB;
  if (root && root.document) {
    root.MB = MB;
    root.document.addEventListener("DOMContentLoaded", () => MB.bind());
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const unwrap = (response) => response?.data ?? response;
  const guestCartKey = "mb-guest-cart";
  const normalizeCartItems = (items = []) => items.map((item) => {
    const variant = item.variant || item.productVariant || {};
    const variantId = item.variantId?._id || item.variantId?.id || item.variantId || variant._id || variant.id || "";
    const quantity = Number(item.quantity ?? item.qty ?? 0);
    return {
      variantId: String(variantId),
      quantity,
      size: String(item.size || variant.size || variant.volume || variant.label || "")
    };
    }).filter((item) => item.variantId && Number.isSafeInteger(item.quantity) && item.quantity > 0);
  const mergeCartItems = (accountItems, guestItems) => {
    const merged = normalizeCartItems(accountItems);
    for (const guestItem of normalizeCartItems(guestItems)) {
      const match = merged.find((item) => item.variantId === guestItem.variantId && item.size === guestItem.size);
      if (match) match.quantity += guestItem.quantity;
      else merged.push(guestItem);
    }
    return merged;
  };
  const firstImage = (product) => {
    const image = product?.image || product?.imageUrl || product?.thumbnailUrl || product?.images?.[0] || product?.variants?.[0]?.imageUrl;
    return typeof image === "string" ? image : image?.url || "";
  };

  function normalizeProduct(product = {}) {
    const variants = (product.variants || product.productVariants || []).filter((variant) => variant && variant.isActive !== false);
    const variant = variants.find((item) => String(item._id || item.id) === String(product.defaultVariantId)) || variants[0] || {};
    const isPromotion = Number(variant.promotionPrice) > 0 && Number(variant.promotionPrice) < Number(variant.retailPrice);
    const brand = product.brandName || product.brand?.name || (typeof product.brand === "string" ? product.brand : "") || product.brandId?.name || "";
    const category = product.categoryName || product.category?.name || (typeof product.category === "string" ? product.category : "") || product.categoryId?.name || "";
    return {
      id: String(product._id || product.id || product.slug || ""),
      slug: product.slug || "",
      name: product.name || product.productName || "Sản phẩm chưa có tên",
      brand: brand || "Thương hiệu đang cập nhật",
      category,
      cat: product.category?.slug || product.categorySlug || product.categoryId || "",
      price: Number(isPromotion ? variant.promotionPrice : product.price ?? product.minPrice ?? variant.retailPrice ?? variant.price ?? variant.salePrice ?? 0),
      old: Number(isPromotion ? variant.retailPrice : product.originalPrice ?? variant.originalPrice ?? variant.compareAtPrice ?? 0),
      promotionName: variant.promotionName || "",
      promotionEndsAt: variant.promotionEndsAt || null,
      rating: Number(product.ratingAverage ?? product.rating ?? 0),
      reviews: Number(product.reviewCount ?? product.reviewsCount ?? 0),
      sold: Number(product.soldCount ?? 0),
      image: firstImage(product),
      desc: product.description || product.shortDescription || "",
      sku: variant.sku || product.sku || "",
      variantId: String(variant._id || variant.id || ""),
      defaultVariantId: String(variant._id || variant.id || ""),
      variants,
      sizes: variants.map((item) => item.size || item.volume || item.label || item.name || item.sku).filter(Boolean),
      stock: variant.availableQuantity ?? variant.stockQuantity ?? product.stockQuantity ?? null,
      skin: product.skinTypes || product.skinType || [],
      isDemo: product.isDemo === true || variant.isDemo === true,
      status: product.status || (product.isActive === false ? "inactive" : "active")
    };
  }

  function errorMessage(error) {
    const localizedErrors = {
      AUTH_REQUIRED: "Vui lòng đăng nhập để tiếp tục.",
      AUTH_INVALID: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      CODE_INVALID: "Mã xác minh không hợp lệ hoặc đã hết hạn.",
      INVALID_PROMOTION_PRICE: "Giá khuyến mãi phải thấp hơn giá bán hiện tại của tất cả sản phẩm đã chọn.",
      ORDER_NOT_CANCELLABLE: "Đơn hàng chỉ có thể hủy trước khi chuyển sang trạng thái đang giao.",
      DUPLICATE_USER: "Email hoặc số điện thoại này đã được đăng ký.",
      NOT_FOUND: "Không tìm thấy dữ liệu yêu cầu.",
      FORBIDDEN: "Tài khoản của bạn chưa được cấp quyền cho thao tác này.",
      VALIDATION_ERROR: "Thông tin nhập chưa hợp lệ. Vui lòng kiểm tra lại.",
      INVALID_JSON: "Dữ liệu JSON không hợp lệ.",
      DUPLICATE_RESOURCE: "Dữ liệu này đã tồn tại.",
      REQUEST_FAILED: "Yêu cầu không thực hiện được. Vui lòng thử lại.",
      INVALID_STATUS_TRANSITION: "Không thể chuyển sang trạng thái này.",
      DUPLICATE_PRODUCT: "Sản phẩm hoặc mã SKU đã tồn tại.",
      DUPLICATE_SKU: "Mã SKU đã tồn tại.",
      PRODUCT_NOT_FOUND: "Không tìm thấy sản phẩm.",
      VARIANT_NOT_FOUND: "Không tìm thấy phân loại sản phẩm.",
      PRODUCT_VARIANT_NOT_FOUND: "Sản phẩm hoặc phân loại sản phẩm không hợp lệ.",
      DUPLICATE_PROMOTION_ITEM: "Một sản phẩm hoặc phân loại chỉ được chọn một lần.",
      DUPLICATE_PROMOTION: "Chương trình khuyến mãi đã tồn tại.",
      DUPLICATE_FLASH_SALE_ITEM: "Một sản phẩm hoặc phân loại chỉ được chọn một lần trong chương trình giảm giá nhanh.",
      INVALID_FLASH_SALE_PRICE: "Giá giảm nhanh phải thấp hơn giá bán hiện tại.",
      DUPLICATE_VOUCHER: "Mã giảm giá đã tồn tại.",
      VOUCHER_NOT_FOUND: "Không tìm thấy mã giảm giá.",
      VOUCHER_INACTIVE: "Mã giảm giá hiện không còn hiệu lực.",
      VOUCHER_EXPIRED: "Mã giảm giá đã hết hạn.",
      VOUCHER_MIN_ORDER: "Đơn hàng chưa đạt giá trị tối thiểu để dùng mã giảm giá.",
      VOUCHER_USAGE_LIMIT: "Mã giảm giá đã hết lượt sử dụng.",
      VOUCHER_ALREADY_CLAIMED: "Bạn đã nhận mã giảm giá này.",
      VOUCHER_ALREADY_ASSIGNED: "Mã giảm giá đã được gán cho tài khoản này.",
      SHIPPING_UNAVAILABLE: "Chưa có phí giao hàng cho khu vực đã chọn.",
      STOCK_UNAVAILABLE: "Sản phẩm không đủ tồn kho.",
      STORE_UNAVAILABLE: "Cửa hàng hiện không khả dụng.",
      ORDER_NOT_PAYABLE: "Đơn hàng này không thể thanh toán.",
      PAYMENT_NOT_SUPPORTED: "Phương thức thanh toán này chưa được hỗ trợ.",
      PAYMENT_ALREADY_PAID: "Đơn hàng đã được thanh toán.",
      PAYMENT_EXISTS: "Đơn hàng này đã có thông tin thanh toán.",
      INVOICE_EXISTS: "Đơn hàng này đã có hóa đơn.",
      ORDER_NOT_RETURNABLE: "Chỉ có thể đổi trả đơn đã giao hoặc hoàn tất.",
      RETURN_ITEM_INVALID: "Sản phẩm hoặc số lượng đổi trả không hợp lệ.",
      RETURN_STOCK_UNAVAILABLE: "Tồn kho không đủ để xử lý yêu cầu đổi trả.",
      APPOINTMENT_SLOT_UNAVAILABLE: "Khung giờ vừa chọn không còn trống.",
      CONSULTATION_NOT_COMPLETED: "Lịch tư vấn chưa hoàn tất.",
      CONSULTATION_REVIEW_EXISTS: "Bạn đã đánh giá buổi tư vấn này.",
      RECOMMENDATION_EXISTS: "Gợi ý sản phẩm này đã tồn tại.",
      REVIEW_EXISTS: "Bạn đã gửi đánh giá cho sản phẩm này.",
      REVIEW_LOCKED: "Đánh giá này không còn được chỉnh sửa.",
      EMAIL_CODE_INVALID: "Mã xác minh không hợp lệ, đã hết hạn hoặc đã được sử dụng.",
      EMAIL_CODE_RATE_LIMITED: "Bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau 60 giây.",
      EMAIL_CODE_SUPERSEDED: "Mã xác minh trước đó đã được thay thế.",
      EMAIL_NOT_CONFIGURED: "Hệ thống email chưa được cấu hình.",
      EMAIL_DELIVERY_FAILED: "Không thể gửi email. Vui lòng thử lại sau.",
      AI_NOT_CONFIGURED: "Tư vấn thông minh chưa được cấu hình.",
      GEMINI_TIMEOUT: "Tư vấn đang phản hồi chậm. Vui lòng thử lại.",
      GEMINI_UNAVAILABLE: "Dịch vụ tư vấn hiện không khả dụng.",
      GEMINI_EMPTY_RESPONSE: "Chưa nhận được nội dung trả lời. Vui lòng thử lại.",
      GEMINI_API_ERROR: "Dịch vụ tư vấn gặp lỗi. Vui lòng thử lại.",
      RATE_LIMITED: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
      INTERNAL_ERROR: "Hệ thống gặp lỗi. Vui lòng thử lại sau.",
      NETWORK_ERROR: "Không thể kết nối máy chủ.",
      CONCURRENT_UPDATE: "Dữ liệu vừa được cập nhật bởi thao tác khác. Vui lòng tải lại.",
      DUPLICATE_CATALOG_VALUE: "Giá trị danh mục hoặc thương hiệu đã tồn tại.",
      DUPLICATE_SHIPPING_RATE: "Khu vực giao hàng này đã tồn tại.",
      SELF_DEACTIVATION: "Bạn không thể tự vô hiệu hóa tài khoản của mình.",
      ORDER_NOT_READY_FOR_DELIVERY: "Chỉ có thể tạo phiếu giao cho đơn đã chuyển sang trạng thái đang giao.",
      DELIVERY_ALREADY_EXISTS: "Đơn hàng này đã có phiếu giao.",
      STOCK_NEGATIVE: "Tồn kho không thể nhỏ hơn 0.",
      RESERVATION_RELEASE_FAILED: "Không thể giải phóng số lượng đã giữ.",
      CHECKOUT_IN_PROGRESS: "Đơn hàng đang được xử lý. Vui lòng chờ.",
      STOCK_COMMIT_FAILED: "Không thể cập nhật tồn kho.",
      ORDER_ARTIFACTS_INCOMPLETE: "Chưa thể hoàn tất đơn vì dữ liệu thanh toán hoặc hóa đơn chưa đủ.",
      ORDER_ARTIFACTS_MISSING: "Không tìm thấy dữ liệu thanh toán hoặc hóa đơn của đơn hàng.",
      DUPLICATE_WISHLIST_ITEM: "Sản phẩm đã có trong danh sách yêu thích.",
      DUPLICATE_KNOWLEDGE_SLUG: "Tài liệu tri thức đã tồn tại."
    };
    const localized = localizedErrors[error?.code];
    if (localized) return localized;
    if (error?.status === 401) return "Vui lòng đăng nhập để tiếp tục.";
    if (error?.code === "INVALID_PROMOTION_PRICE") return "Giá khuyến mãi phải thấp hơn giá bán hiện tại của tất cả sản phẩm đã chọn.";
    if (error?.code === "ORDER_NOT_CANCELLABLE") return "Đơn hàng chỉ có thể hủy trước khi chuyển sang trạng thái đang giao.";
    if (error?.status === 403) return "Tài khoản của bạn chưa được cấp quyền cho thao tác này.";
    if (error?.status === 404) return "Không tìm thấy dữ liệu yêu cầu.";
    if (error?.code === "DUPLICATE_USER") return "Email hoặc số điện thoại này đã được đăng ký.";
    return error?.message || "Đã xảy ra lỗi. Vui lòng thử lại.";
  }

  function togglePasswordControl(input, button) {
    if (!input || !button) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Ẩn" : "Hiện";
    button.setAttribute("aria-label", visible ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    button.setAttribute("aria-pressed", String(visible));
  }

  const MB = {
    escape,
    isValidEmail(value) {
      const email = String(value ?? "").trim();
      return email.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email);
    },
    normalizeProduct,
    togglePasswordControl,
    _guestCartMode: false,
    _guestCartItems: [],
    readGuestCart() {
      try {
        const saved = root.localStorage?.getItem(guestCartKey);
        if (saved !== null && saved !== undefined) this._guestCartItems = normalizeCartItems(JSON.parse(saved));
      } catch {}
      return normalizeCartItems(this._guestCartItems);
    },
    writeGuestCart(items) {
      this._guestCartItems = normalizeCartItems(items);
      try { root.localStorage?.setItem(guestCartKey, JSON.stringify(this._guestCartItems)); } catch {}
      this.paintCartBadge(this._guestCartItems);
      return this._guestCartItems;
    },
    clearGuestCart() {
      this._guestCartItems = [];
      try { root.localStorage?.removeItem(guestCartKey); } catch {}
    },
    money(value) { return new Intl.NumberFormat("vi-VN").format(Number(value) || 0) + "₫"; },
    cartQuantity(quantity, delta) { return Math.max(1, Number(quantity || 1) + Number(delta || 0)); },
    toast(message, kind = "info") {
      const el = root.document?.querySelector(".toast");
      if (!el) return;
      el.textContent = message;
      el.dataset.kind = kind;
      el.classList.add("show");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
    },
    showState(host, kind, message, action = "") {
      if (!host) return;
      const labels = { loading: "Đang tải…", empty: "Chưa có dữ liệu", error: "Không thể tải dữ liệu", notFound: "Không tìm thấy", forbidden: "Không đủ quyền", success: "Hoàn tất" };
      host.innerHTML = `<div class="state state-${escape(kind)}" role="${kind === "error" ? "alert" : "status"}"><span class="state-mark" aria-hidden="true">${kind === "loading" ? "◌" : kind === "error" ? "!" : kind === "success" ? "✓" : "✦"}</span><b>${escape(labels[kind] || "Thông báo")}</b><p>${escape(message)}</p>${action}</div>`;
    },
    card(input) {
      const product = normalizeProduct(input);
      const variant = product.variants.find((item) => String(item._id || item.id) === product.variantId) || product.variants[0] || {};
      const size = variant.size || variant.volume || variant.label || "";
      const badge = "";
      const isPromotion = Number(variant.promotionPrice) > 0 && Number(variant.promotionPrice) < Number(variant.retailPrice);
      const discount = isPromotion ? Math.round((1 - Number(variant.promotionPrice) / Number(variant.retailPrice)) * 100) : 0;
      const sale = isPromotion ? `<span class="pill sale-pill">-${discount}%</span>` : "";
      const expiryDate = isPromotion && product.promotionEndsAt ? new Date(product.promotionEndsAt) : null;
      const expiry = expiryDate && Number.isFinite(expiryDate.getTime())
        ? `<small class="sale-expires">Ưu đãi đến ${escape(expiryDate.toLocaleDateString("vi-VN"))}</small>` : "";
      const image = product.image ? `<img src="${escape(product.image)}" alt="${escape(product.name)}" loading="lazy" decoding="async">` : '<span class="image-pending">Ảnh sản phẩm</span>';
      return `<article class="card">
        <a class="photo" href="product.html?id=${encodeURIComponent(product.id)}">${badge}${sale}${image}</a>
        <div class="brand">${escape(product.brand)}</div>
        <a class="name" href="product.html?id=${encodeURIComponent(product.id)}">${escape(product.name)}</a>
        <div class="rating">${product.rating ? `${product.rating.toFixed(1)} ★` : "Chưa có đánh giá"}<span>${product.reviews ? `(${product.reviews})` : ""}</span></div>
        <div class="price">${MB.money(product.price)} ${product.old > product.price ? `<del>${MB.money(product.old)}</del>` : ""}</div>
        ${expiry}
        <button class="add" data-add="${escape(product.id)}" data-variant="${escape(product.variantId)}" data-size="${escape(size)}" ${product.variantId ? "" : "disabled"}>THÊM VÀO GIỎ</button>
      </article>`;
    },
    async readCart() {
      if (this._guestCartMode) return this.readGuestCart();
      if (this._cartReadPromise) return this._cartReadPromise;
      const request = (async () => {
        try {
          const response = await root.MBApi.cart.get();
          const cart = unwrap(response) || {};
          const accountItems = Array.isArray(cart) ? cart : Array.isArray(cart.items) ? cart.items : [];
          const guestItems = this.readGuestCart();
          if (!guestItems.length) return accountItems;
          const merged = mergeCartItems(accountItems, guestItems);
          await this.updateCart(merged);
          if (this._guestCartMode) return this.readGuestCart();
          this.clearGuestCart();
          this.paintCartBadge(merged);
          return merged;
        } catch (error) {
          if (error?.status !== 401) throw error;
          this._guestCartMode = true;
          return this.readGuestCart();
        }
      })();
      this._cartReadPromise = request;
      try { return await request; }
      finally { if (this._cartReadPromise === request) this._cartReadPromise = null; }
    },
    async updateCart(items) {
      const normalized = normalizeCartItems(items);
      if (this._guestCartMode) return this.writeGuestCart(normalized);
      try {
        const response = await root.MBApi.cart.update({ items: normalized.map(({ variantId, quantity, size }) => ({ variantId, quantity, ...(size ? { size } : {}) })) });
        this.paintCartBadge(unwrap(response)?.items);
        return response;
      } catch (error) {
        if (error?.status !== 401) throw error;
        this._guestCartMode = true;
        return this.writeGuestCart(normalized);
      }
    },
    paintCartBadge(items) {
      if (!Array.isArray(items)) return;
      const count = items.reduce((sum, item) => sum + Number(item.quantity ?? item.qty ?? 0), 0);
      root.document?.querySelectorAll("[data-cart-count]").forEach((el) => { el.textContent = count; el.hidden = count < 1; });
    },
    rememberedEmail() {
      try { return root.localStorage?.getItem("mb-remembered-email") || ""; } catch { return ""; }
    },
    rememberEmail(email, remember) {
      try {
        if (remember && String(email || "").trim().length <= 254) root.localStorage?.setItem("mb-remembered-email", String(email || "").trim());
        else root.localStorage?.removeItem("mb-remembered-email");
      } catch {}
    },
    async refreshCartBadge() {
      try { this.paintCartBadge(await this.readCart()); } catch {}
    },
    async add(productId, variantId, quantity = 1, size = "") {
      if (!variantId) { this.toast("Sản phẩm chưa có phân loại đang bán.", "error"); return; }
      const items = await this.readCart();
      const current = items.map((item) => ({
        variantId: String(item.variantId?._id || item.variant?._id || item.variantId || item.variant?.id || ""),
        quantity: Number(item.quantity ?? item.qty ?? 0),
        size: item.size || ""
      })).filter((item) => item.variantId && item.quantity > 0);
      const match = current.find((item) => item.variantId === String(variantId) && item.size === size);
      if (match) match.quantity += Number(quantity);
      else current.push({ variantId: String(variantId), quantity: Number(quantity), size });
      await this.updateCart(current);
      this.toast("Đã cập nhật giỏ hàng.", "success");
    },
    stars(value) { const full = Math.max(0, Math.min(5, Math.round(Number(value) || 0))); return "★".repeat(full) + "☆".repeat(5 - full); },
    mountTheme() {
      try { if (localStorage.getItem("mb-theme") === "dark") root.document.documentElement.dataset.theme = "dark"; } catch {}
      if (!root.document) return;
      const adminHost = root.document.querySelector("#admin-theme-control");
      const host = adminHost || root.document.querySelector(".headlinks, .admin-head");
      if (!host || host.querySelector(".theme-btn")) return;
      const button = root.document.createElement("button");
      button.className = "theme-btn";
      button.type = "button";
      const sync = () => {
        const dark = root.document.documentElement.dataset.theme === "dark";
        const label = dark ? "Bật giao diện sáng" : "Bật giao diện tối";
        button.innerHTML = adminHost
          ? dark
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5 8.5 8.5 0 1 0 20.5 14.4Z"/></svg>'
          : dark ? "☀" : "☾";
        button.title = label;
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-pressed", String(dark));
      };
      button.addEventListener("click", () => {
        const dark = root.document.documentElement.dataset.theme === "dark";
        if (dark) delete root.document.documentElement.dataset.theme;
        else root.document.documentElement.dataset.theme = "dark";
        try { localStorage.setItem("mb-theme", dark ? "light" : "dark"); } catch {}
        sync();
      });
      if (adminHost) host.append(button);
      else host.prepend(button);
      sync();
    },
    syncHeaderLogout(visible) {
      root.document?.querySelectorAll(".headlinks").forEach((host) => {
        const existing = host.querySelector("[data-header-logout]");
        if (!visible) { existing?.remove(); return; }
        if (existing) return;
        const button = root.document.createElement("button");
        button.className = "header-shortcut header-logout";
        button.type = "button";
        button.dataset.logout = "";
        button.dataset.headerLogout = "";
        button.setAttribute("aria-label", "Đăng xuất");
        button.title = "Đăng xuất";
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M21 4v16"/></svg><span>Đăng xuất</span>';
        const accountLink = host.querySelector('a[aria-label="Tài khoản"]');
        if (accountLink) accountLink.after(button);
        else host.append(button);
      });
    },
    async mountCustomerSession() {
      if (!root.MBApi?.auth?.me) return;
      const hasHeader = root.document.querySelector(".headlinks");
      const hasNav = root.document.querySelector(".nav");
      if (!hasHeader && !hasNav) return;
      try {
        const user = unwrap(await root.MBApi.auth.me()) || {};
        this.syncHeaderLogout(true);
        await this.mountAdminNav(user);
      } catch {
        this.syncHeaderLogout(false);
      }
    },
    mountNav() {
      const nav = root.document.querySelector(".nav");
      if (!nav) return;
      const categoryMenu = nav.querySelector(":scope > .nav-categories");
      if (categoryMenu) {
        categoryMenu.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "mouse") categoryMenu.open = true;
        });
        categoryMenu.addEventListener("pointerleave", (event) => {
          if (event.pointerType === "mouse") categoryMenu.open = false;
        });
        nav.addEventListener("click", (event) => {
          if (!categoryMenu.contains(event.target)) categoryMenu.open = false;
        });
      }
      if (root.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const pill = root.document.createElement("span");
      pill.className = "nav-pill";
      nav.prepend(pill);
      const move = (link, animate = true) => {
        if (!link) return;
        const navRect = nav.getBoundingClientRect(), rect = link.getBoundingClientRect();
        if (!animate) pill.style.transition = "none";
        pill.style.width = rect.width + "px";
        pill.style.transform = `translateX(${rect.left - navRect.left}px)`;
        pill.style.opacity = "1";
        if (!animate) {
          pill.getBoundingClientRect();
          pill.style.removeProperty("transition");
        }
      };
      const triggers = nav.querySelectorAll(":scope > a, :scope > details > summary");
      const active = () => nav.querySelector(":scope > a.active") || nav.querySelector(":scope > a");
      const syncActivePill = () => move(active(), false);
      this.syncActivePill = syncActivePill;
      triggers.forEach((link) => link.addEventListener("mouseenter", () => move(link)));
      nav.addEventListener("mouseleave", () => move(active()));
      root.addEventListener("resize", syncActivePill);
      root.document.fonts?.ready?.then(syncActivePill);
      syncActivePill();
    },
    async mountAdminNav(user) {
      const nav = root.document?.querySelector(".nav");
      if (!nav || nav.querySelector(":scope > [data-admin-nav]") || !root.MBApi?.auth?.me) return;
      try {
        const currentUser = user || unwrap(await root.MBApi.auth.me()) || {};
        const role = String(currentUser.role?.name || currentUser.roleName || currentUser.role || "").toLowerCase();
        if (!["admin", "manager"].includes(role)) return;
        const link = root.document.createElement("a");
        link.href = "admin.html";
        link.textContent = "QUẢN LÝ";
        link.className = "admin-nav-link";
        link.setAttribute("data-admin-nav", "");
        nav.append(link);
        this.syncActivePill?.();
      } catch {}
    },
    watch(scope = root.document) {
      if (!("IntersectionObserver" in root)) return;
      if (!this.io) this.io = new root.IntersectionObserver((entries) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        this.io.unobserve(entry.target);
      }), { threshold: 0.14 });
      const selector = ".card, .category, .trust > div, .campaign, .stat, .state, .account-card, .cartitem, .summary, .product-notes, .admin .panel, .admin .login-panel";
      const observe = (el) => {
        if (el.dataset.watched) return;
        el.dataset.watched = "1";
        this.io.observe(el);
      };
      if (scope.matches?.(selector)) observe(scope);
      scope.querySelectorAll?.(selector).forEach(observe);
    },
    bind() {
      if (!root.MBApi) return;
      this.mountTheme();
      this.mountNav();
      this.mountCustomerSession();
      this.watch();
      new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) this.watch(node);
      }))).observe(root.document.body, { childList: true, subtree: true });
      root.document.body.addEventListener("click", async (event) => {
        const add = event.target.closest("[data-add]");
        const open = event.target.closest("[data-open]");
        const close = event.target.closest("[data-close]");
        const passwordToggle = event.target.closest("[data-password-toggle]");
        if (passwordToggle) {
          const input = passwordToggle.closest(".password-control")?.querySelector("input");
          this.togglePasswordControl(input, passwordToggle);
        }
        if (add) {
          event.preventDefault();
          add.disabled = true;
          try { await this.add(add.dataset.add, add.dataset.variant, Number(add.dataset.quantity || 1), add.dataset.size || ""); }
          catch (error) { this.toast(errorMessage(error), "error"); }
          finally { add.disabled = false; }
        }
        if (open) {
          const target = root.document.querySelector(open.dataset.open);
          target?.classList.add("open");
          if (target?.matches(".modal")) {
            this.modalReturnFocus = open;
            target.setAttribute("aria-hidden", "false");
            requestAnimationFrame(() => target.querySelector("input:not([type=hidden]), select, textarea, button")?.focus());
          }
        }
        if (close) {
          const layer = close.closest(".modal, .drawer");
          layer?.classList.remove("open");
          if (layer?.matches(".modal")) {
            layer.setAttribute("aria-hidden", "true");
            this.modalReturnFocus?.focus();
          }
        }
        if (event.target.closest("[data-logout]")) {
          try { await root.MBApi.auth.logout(); this.syncHeaderLogout(false); root.location.href = "index.html"; }
          catch (error) { this.toast(errorMessage(error), "error"); }
        }
      });
      const search = root.document.querySelector("[data-search]");
      search?.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = new FormData(search).get("q") || "";
        root.location.href = "products.html?q=" + encodeURIComponent(value);
      });
      let last = 0;
      root.addEventListener("scroll", () => {
        const y = root.scrollY;
        if (Math.abs(y - last) < 8) return;
        last = y;
        root.document.querySelector(".header")?.classList.toggle("scrolled", y > 8);
      }, { passive: true });
      root.document.addEventListener("keydown", (event) => {
        const dialog = root.document.querySelector(".modal.open[role=dialog]");
        if (!dialog) return;
        if (event.key === "Escape") {
          dialog.classList.remove("open");
          dialog.setAttribute("aria-hidden", "true");
          this.modalReturnFocus?.focus();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = [...dialog.querySelectorAll("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && root.document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && root.document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      this.refreshCartBadge();
    }
  };
  MB.errorMessage = errorMessage;
  return MB;
});
