(function () {
  const $ = (selector, host = document) => host.querySelector(selector);
  const esc = MB.escape;
  const responseData = (response) => MBApi.data(response);
  const listData = (response) => {
    const value = responseData(response);
    return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
  };
  const stateAction = '<button class="outline" type="button" data-retry>Thử lại</button>';
  const showError = (host, error) => MB.showState(host, error.status === 403 ? "forbidden" : error.status === 404 ? "notFound" : "error", MB.errorMessage(error), error.status === 401 ? '<a class="btn" href="account.html">ĐĂNG NHẬP</a>' : stateAction);
  const demoTag = (item) => item?.isDemo ? '<span class="demo-label">DỮ LIỆU MINH HỌA</span>' : "";
  const statusText = (value) => ({ pending: "Chờ xử lý", requested: "Đã gửi yêu cầu", confirmed: "Đã xác nhận", processing: "Đang xử lý", shipped: "Đang giao", delivered: "Đã giao", completed: "Hoàn tất", cancelled: "Đã hủy", returned: "Đã trả", paid: "Đã thanh toán", failed: "Thanh toán thất bại", issued: "Đã phát hành", approved: "Đã duyệt", received: "Đã nhận hàng", rejected: "Từ chối", refunded: "Đã hoàn tiền", exchanged: "Đã đổi hàng" }[String(value || "").toLowerCase()] || value || "—");

  async function catalog() {
    const grid = $("#grid");
    if (!grid) return;
    const params = new URLSearchParams(location.search);
    const wishList = params.has("wish");
    const title = $("#title");
    const filters = $("#filters");
    if (params.get("filters") === "open") filters.classList.add("open");
    let page = 1;
    if (params.get("q")) $("[name=q]").value = params.get("q");
    if (wishList) {
      title.textContent = "Yêu thích";
      $("#crumb").textContent = title.textContent;
      MB.showState(grid, "empty", "Danh sách yêu thích chưa thuộc phạm vi nghiệp vụ và chưa có API hỗ trợ.");
      $("#count").textContent = "";
      return;
    }

    async function populateFilters() {
      try {
        const catalog = responseData(await MBApi.catalog()) || {};
        const categories = catalog.categories || [];
        const categoryGroup = $("#catalog-categories");
        const selectedCategory = params.get("cat") || "";
        const categoryNames = { skincare: "Chăm sóc da", makeup: "Trang điểm", body: "Chăm sóc cơ thể" };
        const hasSelectedCategory = categories.some((item) => (item.slug || item.id || item._id) === selectedCategory);
        const categoryFallback = selectedCategory && !hasSelectedCategory
          ? `<label><input type="radio" name="cat" value="${esc(selectedCategory)}"> ${esc(categoryNames[selectedCategory] || selectedCategory)}</label>`
          : "";
        categoryGroup.innerHTML = `<b>Danh mục</b><label><input type="radio" name="cat" value="" checked> Tất cả</label>${categories.map((item) => {
          const value = item.slug || item.id || item._id;
          return `<label><input type="radio" name="cat" value="${esc(value)}"> ${esc(item.name)}</label>`;
        }).join("")}${categoryFallback}`;
        const category = [...categoryGroup.querySelectorAll("[name=cat]")].find((item) => item.value === selectedCategory);
        if (category) category.checked = true;
        const brandSelect = $("[name=brand]", filters);
        const selectedBrand = params.get("brand") || "";
        const hasSelectedBrand = (catalog.brands || []).some((item) => (item.code || item.slug || item.id || item._id) === selectedBrand);
        const brandFallback = selectedBrand && !hasSelectedBrand ? `<option value="${esc(selectedBrand)}">${esc(selectedBrand)}</option>` : "";
        brandSelect.innerHTML = `<option value="">Tất cả</option>${(catalog.brands || []).map((item) => {
          const value = item.code || item.slug || item.id || item._id;
          return `<option value="${esc(value)}">${esc(item.name)}</option>`;
        }).join("")}${brandFallback}`;
        if ([...brandSelect.options].some((item) => item.value === selectedBrand)) brandSelect.value = selectedBrand;
      } catch {
        let note = filters.querySelector("[data-filter-error]");
        if (!note) {
          note = document.createElement("p");
          note.className = "service";
          note.dataset.filterError = "";
          filters.append(note);
        }
        note.textContent = "Không tải được danh mục bộ lọc; vẫn có thể tìm kiếm sản phẩm.";
      }
    }

    async function load() {
      const query = {
        q: $("[data-search] input[name=q]")?.value.trim() ?? params.get("q") ?? "",
        category: filters.querySelector("[name=cat]:checked")?.value || "",
        brand: filters.querySelector("[name=brand]")?.value || "",
        skinType: filters.querySelector("[name=skinType]")?.value || "",
        minPrice: $("#min-price")?.value || "",
        maxPrice: $("#max-price")?.value || "",
        sort: $("#sort").value,
        sale: params.has("sale") || params.has("promotion") ? "true" : "",
        page,
        limit: 12
      };
      MB.showState(grid, "loading", "Đang lấy danh mục từ hệ thống…");
      try {
        const response = await MBApi.products(query);
        const { items } = MBApi.list(response);
        const normalized = items.map(MB.normalizeProduct);
        if (!normalized.length) {
          const narrowed = Boolean(query.q || query.category || query.brand || query.skinType || query.minPrice || query.maxPrice || query.sale);
          const message = narrowed
            ? "Chưa tìm thấy sản phẩm với các lựa chọn hiện tại. Hãy bỏ bộ lọc để xem toàn bộ cửa hàng."
            : "Cửa hàng đang cập nhật sản phẩm. Bạn có thể xem ưu đãi mới hoặc đặt lịch tư vấn routine.";
          const actions = narrowed
            ? '<button class="outline" type="button" data-clear-filters>BỎ BỘ LỌC</button>'
            : '<a class="outline" href="offers.html">XEM ƯU ĐÃI</a><a class="outline" href="consultation.html">ĐẶT LỊCH TƯ VẤN</a>';
          MB.showState(grid, "empty", message, actions);
        } else grid.innerHTML = normalized.map(MB.card).join("");
        const pagination = response?.pagination || {};
        const total = pagination.total ?? normalized.length;
        $("#shown").textContent = `Hiển thị ${normalized.length} / ${total} sản phẩm`;
        $("#count").textContent = `${total} sản phẩm trong danh mục`;
        const categoryLabel = filters.querySelector("[name=cat]:checked")?.parentElement?.textContent.trim();
        title.textContent = query.sale ? "Khuyến mãi đang diễn ra" : categoryLabel || (query.q ? `Kết quả cho “${query.q}”` : "Bộ sưu tập");
        $("#crumb").textContent = title.textContent;
        $("#page-current").textContent = String(pagination.page || page);
        $("#page-prev").disabled = page <= 1;
        $("#page-next").disabled = pagination.totalPages ? page >= pagination.totalPages : normalized.length < query.limit;
      } catch (error) { showError(grid, error); }
    }

    filters.addEventListener("change", () => { page = 1; load(); });
    $("#sort").addEventListener("change", () => { page = 1; load(); });
    $("#filter-toggle").addEventListener("click", () => filters.classList.toggle("open"));
    $("#page-prev")?.addEventListener("click", () => { page = Math.max(1, page - 1); load(); });
    $("#page-next")?.addEventListener("click", () => { page += 1; load(); });
    $("#apply-filters")?.addEventListener("click", () => { page = 1; load(); });
    document.body.addEventListener("click", (event) => {
      if (event.target.closest("[data-retry]")) load();
      if (event.target.closest("[data-clear-filters]")) {
        params.delete("q"); params.delete("cat"); params.delete("brand"); params.delete("skinType");
        params.delete("sale"); params.delete("promotion");
        const allCategories = filters.querySelector('[name="cat"][value=""]');
        if (allCategories) allCategories.checked = true;
        $("[data-search] input[name=q]").value = "";
        $("[name=brand]", filters).value = "";
        $("[name=skinType]", filters).value = "";
        $("#min-price").value = ""; $("#max-price").value = ""; $("#sort").value = "";
        const cleanUrl = new URL(location.href);
        ["q", "cat", "brand", "skinType", "minPrice", "maxPrice", "sort", "sale", "promotion"].forEach((key) => cleanUrl.searchParams.delete(key));
        window.history.replaceState(null, "", cleanUrl);
        page = 1;
        load();
      }
    });
    await populateFilters();
    await load();
  }

  async function productDetail() {
    const host = $("#root");
    if (!host || document.body.dataset.page !== "product") return;
    const id = new URLSearchParams(location.search).get("id");
    if (!id) { MB.showState(host, "notFound", "Đường dẫn chưa có mã sản phẩm."); return; }
    let selectedProduct = null;
    async function load() {
      MB.showState(host, "loading", "Đang tải thông tin sản phẩm…");
      try {
        const product = MB.normalizeProduct(responseData(await MBApi.product(id)));
        selectedProduct = product;
        if (!product.id || product.name === "Sản phẩm chưa có tên") { MB.showState(host, "notFound", "Sản phẩm này không còn trong danh mục."); return; }
        document.title = `${product.name} — Maison Belle`;
        const variants = product.variants;
        const currentVariant = variants.find((item) => String(item._id || item.id) === product.variantId) || variants[0];
        const image = product.image ? `<img id="main-img" src="${esc(product.image)}" alt="${esc(product.name)}" fetchpriority="high" decoding="async">` : '<div class="image-pending">Ảnh sản phẩm đang cập nhật</div>';
        const variantOptions = variants.map((variant, index) => {
          const variantId = String(variant._id || variant.id || "");
          const label = variant.size || variant.volume || variant.label || variant.name || variant.sku || `Phân loại ${index + 1}`;
          const available = variant.availableQuantity ?? variant.stockQuantity;
          return `<button type="button" data-variant-choice="${esc(variantId)}" class="${variantId === String(currentVariant?._id || currentVariant?.id) ? "on" : ""}">${esc(label)}${available === 0 ? " · Hết hàng" : ""}</button>`;
        }).join("");
        host.innerHTML = `
          <div class="crumb"><a href="index.html">Trang chủ</a> / <a href="products.html">Sản phẩm</a> / ${esc(product.name)}</div>
          <div class="detail">
            <div><div class="stage">${image}</div>${demoTag(product)}</div>
            <div>
              <span class="eyebrow">${esc(product.brand || "Maison Belle")}${product.category ? ` · ${esc(product.category)}` : ""}</span>
              <h1>${esc(product.name)}</h1>
              <div class="rating">${product.rating ? `${MB.stars(product.rating)} <span>${product.rating.toFixed(1)} · ${product.reviews} đánh giá</span>` : "Chưa có đánh giá"}</div>
              <div class="sku">Mã sản phẩm: ${esc(product.sku || "Đang cập nhật")}</div>
              <div class="detailprice" id="detail-price">${MB.money(product.price)} ${product.old > product.price ? `<del>${MB.money(product.old)}</del>` : ""}</div>
              <p>${esc(product.desc || "Thông tin mô tả sẽ được cập nhật bởi cửa hàng.")}</p>
              <div class="choice"><b>Phân loại</b>${variantOptions || '<span>Chưa có phân loại đang bán</span>'}</div>
              <div class="choice"><b>Số lượng</b><span class="qty"><button type="button" id="minus" aria-label="Giảm số lượng">−</button><span id="qty">1</span><button type="button" id="plus" aria-label="Tăng số lượng">+</button></span><span class="stock-note">${Number.isFinite(product.stock) ? (product.stock > 0 ? `Còn ${product.stock}` : "Hết hàng") : "Tình trạng kho xác nhận khi đặt hàng"}</span></div>
              <div class="actions"><button class="btn" id="detail-add" data-add="${esc(product.id)}" data-variant="${esc(currentVariant?._id || currentVariant?.id || "")}" data-size="${esc(currentVariant?.volume || currentVariant?.size || "")}" ${!currentVariant || product.stock === 0 ? "disabled" : ""}>THÊM VÀO GIỎ</button><a class="outline" href="cart.html">XEM GIỎ HÀNG</a></div>
              <a class="textlink" href="consultation.html">Đặt lịch tư vấn & chăm sóc da →</a>
            </div>
          </div>
          <section class="panel product-notes"><h2>Mô tả sản phẩm</h2><p>${esc(product.desc || "Chưa có mô tả chi tiết.")}</p>${product.ingredients ? `<h3>Thành phần</h3><p>${esc(product.ingredients)}</p>` : ""}${product.howToUse ? `<h3>Cách sử dụng</h3><p>${esc(product.howToUse)}</p>` : ""}</section>
          <section class="section"><div class="section-head"><div><span class="eyebrow">Khám phá thêm</span><h2>Cùng danh mục</h2></div></div><div class="products" id="related"></div></section>`;
        let quantity = 1;
        let variantId = String(currentVariant?._id || currentVariant?.id || "");
        let selectedVariant = currentVariant;
        const syncQuantity = () => {
          const stock = selectedVariant?.availableQuantity ?? selectedVariant?.stockQuantity;
          if (Number.isFinite(stock)) quantity = Math.min(quantity, Math.max(1, Number(stock)));
          $("#qty").textContent = quantity;
          $("#detail-add").dataset.quantity = String(quantity);
          $("#minus").disabled = quantity <= 1;
          $("#plus").disabled = Number.isFinite(stock) && quantity >= Number(stock);
        };
        $("#minus").addEventListener("click", () => { quantity = MB.cartQuantity(quantity, -1); syncQuantity(); });
        $("#plus").addEventListener("click", () => { quantity += 1; syncQuantity(); });
        syncQuantity();
        host.addEventListener("click", (event) => {
          const choice = event.target.closest("[data-variant-choice]");
          if (choice) {
            variantId = choice.dataset.variantChoice;
            host.querySelectorAll("[data-variant-choice]").forEach((button) => button.classList.toggle("on", button === choice));
            const variant = variants.find((item) => String(item._id || item.id) === variantId);
            selectedVariant = variant;
            $("#detail-add").dataset.variant = variantId;
            $("#detail-add").dataset.size = variant?.volume || variant?.size || "";
            const price = Number(variant?.promotionPrice ?? variant?.retailPrice ?? variant?.price ?? variant?.salePrice ?? product.price);
            const oldPrice = Number(variant?.originalPrice ?? variant?.compareAtPrice ?? 0);
            $("#detail-price").innerHTML = `${MB.money(price)} ${oldPrice > price ? `<del>${MB.money(oldPrice)}</del>` : ""}`;
            const stock = variant?.availableQuantity ?? variant?.stockQuantity;
            $(".stock-note").textContent = Number.isFinite(stock) ? (stock > 0 ? `Còn ${stock}` : "Hết hàng") : "Tình trạng kho xác nhận khi đặt hàng";
            $("#detail-add").disabled = !variantId || stock === 0;
            syncQuantity();
          }
        });
        if (product.category || product.cat) {
          try {
            const related = MBApi.list(await MBApi.products({ category: product.cat || product.category, page: 1, limit: 4 })).items;
            $("#related").innerHTML = related.map(MB.normalizeProduct).filter((item) => item.id !== product.id).slice(0, 4).map(MB.card).join("");
            if (!$("#related").innerHTML) MB.showState($("#related"), "empty", "Chưa có sản phẩm cùng danh mục.");
          } catch { MB.showState($("#related"), "error", "Không tải được sản phẩm gợi ý."); }
        } else MB.showState($("#related"), "empty", "Sản phẩm chưa gắn danh mục.");
      } catch (error) { showError(host, error); }
    }
    document.body.addEventListener("click", (event) => { if (event.target.closest("[data-retry]")) load(); });
    await load();
  }

  async function home() {
    const loved = $("#loved"), fresh = $("#fresh");
    if (!loved && !fresh) return;
    if (loved) MB.showState(loved, "empty", "Xếp hạng bán chạy chờ backend hỗ trợ sắp xếp theo số lượng đã bán. Maison Belle không gắn nhãn thứ hạng giả cho sản phẩm.", '<a class="outline" href="products.html">XEM TOÀN BỘ SẢN PHẨM</a>');
    if (fresh) MB.showState(fresh, "loading", "Đang tải sản phẩm mới từ cửa hàng…");
    try {
      const response = await MBApi.products({ page: 1, limit: 4 });
      const products = MBApi.list(response).items.map(MB.normalizeProduct);
      if (!fresh) return;
      if (!products.length) MB.showState(fresh, "empty", "Cửa hàng chưa có sản phẩm mới để hiển thị.");
      else fresh.innerHTML = products.map(MB.card).join("");
    } catch (error) { if (fresh) showError(fresh, error); }
  }

  function cartEntry(item) {
    const variant = item.variant || item.productVariant || {};
    const product = item.product || item.productSnapshot || variant.product || {};
    const unitPrice = item.unitPrice ?? variant.promotionPrice ?? variant.retailPrice ?? variant.price ?? product.price;
    const normalized = MB.normalizeProduct({ ...product, variants: product.variants || [variant], price: unitPrice, isDemo: item.isDemo || product.isDemo || variant.isDemo });
    const available = item.available !== false && Boolean(product.id || product._id || product.slug);
    return {
      product: available ? normalized : MB.normalizeProduct({ id: normalized.id, name: "Sản phẩm không còn trong danh mục", isDemo: item.isDemo }),
      variantId: String(item.variantId?._id || item.variantId || variant._id || variant.id || ""),
      quantity: Number(item.quantity ?? item.qty ?? 1),
      size: item.size || variant.size || variant.volume || variant.label || variant.sku || "",
      unitPrice: available ? Number(unitPrice ?? normalized.price) : 0,
      available
    };
  }

  async function hydrateCart(rawItems) {
    const pending = new Set(rawItems.filter((item) => !item.product && !item.productSnapshot && !item.variant?.product).map((item) => String(item.variantId?._id || item.variantId || item.variant?._id || item.variant?.id || "")).filter(Boolean));
    if (!pending.size) return rawItems.map(cartEntry);
    const matches = new Map();
    let page = 1, totalPages = 1;
    while (page <= totalPages && matches.size < pending.size) {
      const response = await MBApi.products({ page, limit: 100 });
      const products = MBApi.list(response).items;
      totalPages = Number(response?.pagination?.totalPages || 1);
      for (const product of products) {
        for (const variant of product.variants || []) {
          const id = String(variant.id || variant._id || "");
          if (pending.has(id)) matches.set(id, { product, variant });
        }
      }
      page += 1;
    }
    return rawItems.map((item) => {
      const variantId = String(item.variantId?._id || item.variantId || item.variant?._id || item.variant?.id || "");
      const match = matches.get(variantId);
      return cartEntry(match ? { ...item, product: match.product, variant: match.variant, unitPrice: match.variant.promotionPrice ?? match.variant.retailPrice, isDemo: match.product.isDemo || match.variant.isDemo } : { ...item, available: false });
    });
  }

  async function cartPage() {
    const host = $("#items");
    if (!host) return;
    let currentItems = [];
    let discount = 0;
    const resumeCheckout = new URLSearchParams(location.search).get("checkout") === "1";
    const checkoutRequestStorageKey = "mb-checkout-request";
    let checkoutRequest = null;
    let activeShippingQuote = null;
    let shippingQuoteSequence = 0;
    let shippingRatesLoaded = false;
    const regionSelect = $("#pay-form [name=regionCode]");
    const shippingQuoteNote = $("#shipping-quote");
    const checkoutSubmit = $("#pay-form [type=submit]");
    checkoutSubmit.disabled = true;
    const clearCheckoutRequest = () => {
      checkoutRequest = null;
      try { globalThis.sessionStorage?.removeItem(checkoutRequestStorageKey); } catch {}
    };
    const checkoutRequestIdFor = (payload) => {
      const signature = JSON.stringify(payload);
      try {
        const stored = JSON.parse(globalThis.sessionStorage?.getItem(checkoutRequestStorageKey) || "null");
        if (stored?.signature === signature && stored.id) return stored.id;
      } catch {}
      if (checkoutRequest?.signature === signature) return checkoutRequest.id;
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      checkoutRequest = { signature, id };
      try { globalThis.sessionStorage?.setItem(checkoutRequestStorageKey, JSON.stringify(checkoutRequest)); } catch {}
      return id;
    };
    const totals = () => {
      const subtotal = currentItems.filter((item) => item.available).reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      $("#sub").textContent = MB.money(subtotal);
      $("#off").textContent = MB.money(discount);
      $("#total").textContent = MB.money(Math.max(0, subtotal - discount));
      $("#checkout").disabled = !currentItems.length || currentItems.some((item) => !item.available || !item.unitPrice);
    };
    async function load() {
      MB.showState(host, "loading", "Đang đồng bộ giỏ hàng với máy chủ…");
      try {
        currentItems = await hydrateCart(await MB.readCart());
        if (!currentItems.length) {
          MB.showState(host, "empty", "Giỏ hàng đang trống. Hãy khám phá bộ sưu tập để chọn sản phẩm.", '<a class="btn" href="products.html">KHÁM PHÁ SẢN PHẨM</a>');
        } else {
          host.innerHTML = currentItems.map((item) => `<article class="cartitem">
            <div class="cart-thumb">${item.product.image ? `<img src="${esc(item.product.image)}" alt="${esc(item.product.name)}" loading="lazy" decoding="async">` : "Ảnh đang cập nhật"}</div>
            <div><span class="brand">${esc(item.product.brand)}</span>${demoTag(item.product)}<h3>${esc(item.product.name)}</h3><small>${esc(item.size || item.product.sku || "")}</small>${item.available ? "" : '<p class="form-message">Không lấy được giá và thông tin sản phẩm. Hãy xóa dòng này rồi thêm lại từ danh mục.</p>'}
              <div class="qty"><button type="button" data-qty="-1" data-variant="${esc(item.variantId)}" aria-label="Giảm số lượng" ${item.available ? "" : "disabled"}>−</button><span>${item.quantity}</span><button type="button" data-qty="1" data-variant="${esc(item.variantId)}" aria-label="Tăng số lượng" ${item.available ? "" : "disabled"}>+</button></div>
              <button class="remove" type="button" data-remove="${esc(item.variantId)}">Xóa khỏi giỏ</button></div><b>${MB.money(item.unitPrice * item.quantity)}</b></article>`).join("");
        }
        totals();
      } catch (error) { showError(host, error); }
    }
    host.addEventListener("click", async (event) => {
      const quantityButton = event.target.closest("[data-qty]");
      const removeButton = event.target.closest("[data-remove]");
      if (!quantityButton && !removeButton) return;
      try {
        const variantId = quantityButton?.dataset.variant || removeButton.dataset.remove;
        const changed = currentItems.map((item) => ({ variantId: item.variantId, quantity: item.variantId === variantId ? (removeButton ? 0 : MB.cartQuantity(item.quantity, Number(quantityButton.dataset.qty))) : item.quantity, size: item.size })).filter((item) => item.quantity > 0);
        discount = 0;
        $("#applied-voucher").textContent = "";
        await MB.updateCart(changed);
        await load();
      } catch (error) { MB.toast(MB.errorMessage(error), "error"); }
    });
    $("#promo")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = new FormData(event.currentTarget).get("code").trim().toUpperCase();
      if (!code) { MB.toast("Nhập mã ưu đãi trước khi áp dụng.", "error"); return; }
      try {
        const subtotal = currentItems.filter((item) => item.available).reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
        const result = responseData(await MBApi.validateVoucher({ code, subtotal })) || {};
        const amount = Number(result.discountAmount ?? result.discountValue ?? result.discount ?? NaN);
        if (!Number.isFinite(amount)) { discount = 0; MB.toast("Máy chủ chưa trả số tiền ưu đãi; vui lòng thử lại sau khi đồng bộ API.", "error"); return; }
        discount = Math.max(0, amount);
        $("#applied-voucher").textContent = `Đã kiểm tra mã ${code}${result.isDemo ? " · DỮ LIỆU MINH HỌA" : ""}`;
        totals();
        MB.toast("Mã ưu đãi đã được máy chủ xác nhận.", "success");
      } catch (error) { $("#applied-voucher").textContent = MB.errorMessage(error); discount = 0; totals(); }
    });
    const loadShippingRates = async () => {
      if (shippingRatesLoaded) return;
      shippingQuoteNote.textContent = "Đang tải khu vực giao hàng…";
      const rates = listData(await MBApi.shipping.rates());
      regionSelect.innerHTML = `<option value="">Chọn tỉnh / thành phố</option>${rates.map((rate) => `<option value="${esc(rate.regionCode)}">${esc(rate.regionName)}${rate.isDemo ? " · DỮ LIỆU MINH HỌA" : ""}</option>`).join("")}`;
      shippingRatesLoaded = true;
      shippingQuoteNote.textContent = rates.length ? "Chọn tỉnh / thành phố để xem phí giao hàng." : "Chưa có khu vực giao hàng khả dụng.";
    };
    const updateShippingQuote = async () => {
      const regionCode = regionSelect.value;
      const sequence = ++shippingQuoteSequence;
      activeShippingQuote = null;
      checkoutSubmit.disabled = true;
      if (!regionCode) {
        shippingQuoteNote.textContent = "Chọn tỉnh / thành phố để xem phí giao hàng.";
        return;
      }
      shippingQuoteNote.textContent = "Đang xác nhận phí giao hàng…";
      try {
        const quote = responseData(await MBApi.shipping.quote({ regionCode })) || {};
        if (sequence !== shippingQuoteSequence || regionCode !== regionSelect.value) return;
        const fee = Number(quote.fee);
        if (quote.regionCode !== regionCode || !Number.isFinite(fee) || fee < 0) throw new Error("Máy chủ trả về báo giá giao hàng không hợp lệ.");
        activeShippingQuote = quote;
        shippingQuoteNote.textContent = `Phí giao hàng: ${MB.money(fee)}${quote.isDemo ? " · DỮ LIỆU MINH HỌA" : ""}`;
        checkoutSubmit.disabled = false;
      } catch (error) {
        if (sequence !== shippingQuoteSequence) return;
        shippingQuoteNote.textContent = MB.errorMessage(error);
      }
    };
    regionSelect?.addEventListener("change", updateShippingQuote);
    const openCheckout = async () => {
      MB.modalReturnFocus = $("#checkout");
      $("#pay").classList.add("open");
      $("#pay").setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => $("#pay-form input:not([type=hidden])")?.focus());
      try {
        await loadShippingRates();
        if (regionSelect.value) await updateShippingQuote();
      }
      catch (error) { shippingQuoteNote.textContent = MB.errorMessage(error); throw error; }
    };
    $("#checkout")?.addEventListener("click", async () => {
      if (!currentItems.length) { MB.toast("Giỏ hàng đang trống."); return; }
      const button = $("#checkout");
      button.disabled = true;
      try {
        await MBApi.auth.me();
        await openCheckout();
      } catch (error) {
        if (error.status === 401) location.assign("account.html?next=checkout");
        else MB.toast(MB.errorMessage(error), "error");
      } finally { button.disabled = false; }
    });
    $("#pay-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const submit = form.querySelector("[type=submit]");
      if (!activeShippingQuote || activeShippingQuote.regionCode !== values.regionCode) {
        MB.toast("Hãy chọn khu vực và chờ máy chủ xác nhận phí giao hàng.", "error");
        return;
      }
      submit.disabled = true;
      try {
        const voucherCode = $("#promo [name=code]")?.value.trim().toUpperCase() || "";
        const payload = {
          items: currentItems.map(({ variantId, quantity }) => ({ variantId, quantity })),
          paymentMethod: values.paymentMethod,
          shippingAddress: { receiverName: values.name.trim(), receiverPhone: values.phone.trim(), fullAddress: values.addr.trim(), regionCode: values.regionCode }
        };
        if (voucherCode) payload.voucherCode = voucherCode;
        payload.checkoutRequestId = checkoutRequestIdFor(payload);
        const result = responseData(await MBApi.orders.create(payload));
        clearCheckoutRequest();
        let cartClearWarning = "";
        try { await MB.updateCart([]); }
        catch { cartClearWarning = " Đơn đã tạo nhưng giỏ hàng chưa được đồng bộ; vui lòng kiểm tra đơn trước khi đặt thêm."; }
        $("#pay").classList.remove("open");
        $("#pay").setAttribute("aria-hidden", "true");
        MB.modalReturnFocus?.focus();
        const orderCode = result?.orderCode || result?.code || result?._id || result?.id || "";
        MB.showState(host, "success", `Đơn đã được ghi nhận${orderCode ? ` · Mã ${orderCode}` : ""}${result?.isDemo ? " · DỮ LIỆU MINH HỌA" : ""}. Trạng thái và thanh toán do máy chủ quản lý.${cartClearWarning}`, '<a class="textlink" href="account.html#orders">XEM ĐƠN HÀNG</a>');
        currentItems = [];
        discount = 0;
        totals();
        MB.refreshCartBadge();
      } catch (error) {
        if (error.status === 401) location.assign("account.html?next=checkout");
        else MB.toast(MB.errorMessage(error), "error");
      }
      finally { submit.disabled = !activeShippingQuote || activeShippingQuote.regionCode !== regionSelect.value; }
    });
    document.body.addEventListener("click", (event) => { if (event.target.closest("[data-retry]")) load(); });
    await load();
    if (resumeCheckout && currentItems.length) {
      try {
        await MBApi.auth.me();
        await openCheckout();
      } catch (error) {
        if (error.status === 401) location.assign("account.html?next=checkout");
        else MB.toast(MB.errorMessage(error), "error");
      }
    }
  }

  async function accountPage() {
    const host = $("#account-content");
    if (!host) return;
    let authFlows = [];
    function closeAuthForms() {
      authFlows.forEach((flow) => flow.close());
      authFlows = [];
    }
    globalThis.addEventListener?.("pagehide", () => authFlows.forEach((flow) => flow.close()));
    function setAuthMode(active) {
      host.querySelectorAll("[data-auth-panel]").forEach((panel) => {
        if (panel.dataset.authPanel !== active && !panel.hidden) {
          authFlows.filter((flow) => flow.panel === panel).forEach((flow) => flow.close());
          panel.querySelectorAll?.('input[type="password"], input[name="verificationCode"], .password-control input').forEach((input) => {
            input.value = "";
            if (input.name !== "verificationCode") input.type = "password";
          });
          panel.querySelectorAll?.("[data-password-toggle]").forEach((button) => {
            button.textContent = "Hiện";
            button.setAttribute("aria-label", "Hiện mật khẩu");
            button.setAttribute("aria-pressed", "false");
          });
        }
        panel.hidden = panel.dataset.authPanel !== active;
      });
      host.querySelectorAll("[data-auth-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.authMode === active)));
      host.querySelector(`[data-auth-panel="${active}"] input`)?.focus();
    }
    function loginForm(message = new URLSearchParams(location.search).get("next") === "checkout"
      ? "Đăng nhập để tiếp tục đặt hàng. Giỏ hàng của bạn đã được lưu."
      : "Đăng nhập để quản lý đơn hàng, hồ sơ và địa chỉ.") {
      closeAuthForms();
      const rememberedEmail = MB.rememberedEmail();
      host.innerHTML = `<section class="account-auth">
        <aside class="account-story"><span class="eyebrow">MAISON BELLE · CHĂM SÓC CÓ CHỦ ĐÍCH</span><h1>Một nghi thức nhỏ.<br><em>Một làn da được lắng nghe.</em></h1><p>Tìm sản phẩm phù hợp, lưu lại hành trình đơn hàng và kết nối với đội ngũ tư vấn của Maison Belle.</p><div class="story-points"><span>01 <b>Tuyển chọn theo nhu cầu</b></span><span>02 <b>Lịch sử mua sắm rõ ràng</b></span><span>03 <b>Tư vấn chăm sóc cá nhân</b></span></div><small>BEAUTY, WITH INTENTION</small></aside>
        <div class="account-glass"><div class="auth-switch" role="group" aria-label="Chọn hình thức tài khoản"><button type="button" data-auth-mode="login" aria-pressed="true">Đăng nhập</button><button type="button" data-auth-mode="register" aria-pressed="false">Tạo tài khoản</button></div>
          <section data-auth-panel="login"><span class="eyebrow">MAISON BELLE · TÀI KHOẢN</span><h2>Chào mừng bạn trở lại.</h2><p>${esc(message)}</p><form id="login-form" class="form-grid"><label class="field">Email<input type="email" name="email" value="${esc(rememberedEmail)}" maxlength="254" required autocomplete="username"></label><div class="field"><label for="login-password">Mật khẩu</label><div class="password-control"><input id="login-password" type="password" name="password" required autocomplete="current-password"><button class="password-toggle" type="button" data-password-toggle aria-label="Hiện mật khẩu" aria-pressed="false">Hiện</button></div></div><div class="auth-options"><label class="auth-remember"><input type="checkbox" name="rememberEmail" ${rememberedEmail ? "checked" : ""}> Ghi nhớ email trên thiết bị này</label><button class="auth-forgot" type="button" data-forgot-password aria-controls="password-reset-panel">Quên mật khẩu?</button></div><button class="btn" type="submit">ĐĂNG NHẬP</button><p class="form-message" role="status" aria-live="polite"></p></form></section>
          <section data-auth-panel="register" hidden><span class="eyebrow">BẮT ĐẦU HÀNH TRÌNH CỦA BẠN</span><h2>Tạo tài khoản Maison Belle.</h2><p>Nhập email và yêu cầu mã xác minh trước khi tạo tài khoản.</p><form id="register-form" class="form-grid"><label class="field">Họ và tên<input name="fullName" required maxlength="160" autocomplete="name"></label><label class="field">Số điện thoại<input type="tel" name="phone" required maxlength="30" autocomplete="tel" inputmode="tel"></label><div class="field"><label for="register-email">Email</label><div class="email-code-control"><input id="register-email" type="email" name="email" required maxlength="254" autocomplete="email" aria-describedby="register-email-feedback"><button class="outline" type="button" data-send-code disabled>GỬI MÃ</button></div><small id="register-email-feedback" data-email-feedback role="status" aria-live="polite"></small></div><label class="field">Mã xác minh<input type="text" name="verificationCode" required inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code"><small>Nhập mã gồm 6 chữ số.</small></label><label class="field">Loại da <span class="optional">(không bắt buộc)</span><select name="skinType"><option value="">Chọn sau</option><option value="oily">Da dầu</option><option value="dry">Da khô</option><option value="sensitive">Da nhạy cảm</option><option value="combination">Da hỗn hợp</option><option value="normal">Da thường</option></select></label><div class="field"><label for="register-password">Mật khẩu</label><div class="password-control"><input id="register-password" type="password" name="password" required minlength="6" maxlength="200" autocomplete="new-password"><button class="password-toggle" type="button" data-password-toggle aria-label="Hiện mật khẩu" aria-pressed="false">Hiện</button></div><small>Tối thiểu 6 ký tự.</small></div><div class="field"><label for="register-confirm-password">Nhập lại mật khẩu</label><div class="password-control"><input id="register-confirm-password" type="password" name="confirmPassword" required minlength="6" maxlength="200" autocomplete="new-password"><button class="password-toggle" type="button" data-password-toggle aria-label="Hiện mật khẩu" aria-pressed="false">Hiện</button></div></div><button class="btn" type="submit">TẠO TÀI KHOẢN</button><p class="form-message" role="status" aria-live="polite"></p></form></section>
          <section data-auth-panel="reset" id="password-reset-panel" hidden><span class="eyebrow">KHÔI PHỤC TÀI KHOẢN</span><h2>Đặt lại mật khẩu.</h2><p>Yêu cầu mã xác minh cho email tài khoản của bạn.</p><form id="password-reset-form" class="form-grid"><div class="field"><label for="reset-email">Email</label><div class="email-code-control"><input id="reset-email" type="email" name="email" required maxlength="254" autocomplete="email" aria-describedby="reset-email-feedback"><button class="outline" type="button" data-send-code disabled>GỬI MÃ</button></div><small id="reset-email-feedback" data-email-feedback role="status" aria-live="polite"></small></div><label class="field">Mã xác minh<input type="text" name="verificationCode" required inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code"><small>Nhập mã gồm 6 chữ số.</small></label><div class="field"><label for="reset-password">Mật khẩu mới</label><div class="password-control"><input id="reset-password" type="password" name="newPassword" required minlength="6" maxlength="200" autocomplete="new-password"><button class="password-toggle" type="button" data-password-toggle aria-label="Hiện mật khẩu" aria-pressed="false">Hiện</button></div><small>Tối thiểu 6 ký tự.</small></div><div class="field"><label for="reset-confirm-password">Nhập lại mật khẩu mới</label><div class="password-control"><input id="reset-confirm-password" type="password" name="confirmPassword" required minlength="6" maxlength="200" autocomplete="new-password"><button class="password-toggle" type="button" data-password-toggle aria-label="Hiện mật khẩu" aria-pressed="false">Hiện</button></div></div><button class="btn" type="submit">ĐẶT LẠI MẬT KHẨU</button><p class="form-message" role="status" aria-live="polite"></p><button class="textlink" type="button" data-auth-mode="login">Quay lại đăng nhập</button></form></section>
        </div>
      </section>`;
      $("#login-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const messageEl = $(".form-message", form);
        const submit = form.querySelector("[type=submit]");
        const email = form.elements.email.value.trim();
        MB.rememberEmail(email, form.elements.rememberEmail.checked);
        submit.disabled = true;
        messageEl.textContent = "Đang xác thực…";
        try {
          const loginResponse = await MBApi.auth.login({ email, password: form.elements.password.value });
          const loggedInUser = responseData(loginResponse) || {};
          const role = loggedInUser.role?.name || loggedInUser.role || loggedInUser.roleName || "customer";
          if (["manager", "sales", "warehouse"].includes(role)) {
            const view = role === "warehouse" ? "inventory" : role === "sales" ? "products" : "dashboard";
            location.assign(`admin.html?view=${view}`);
            return;
          }
          if (new URLSearchParams(location.search).get("next") === "checkout") {
            location.assign("cart.html?checkout=1");
            return;
          }
          if (new URLSearchParams(location.search).get("next") === "consultation") {
            location.assign("consultation.html");
            return;
          }
          await load();
        } catch (error) { messageEl.textContent = MB.errorMessage(error); }
        finally { submit.disabled = false; }
      });
      function bindEmailCodeForm(form, recovery) {
        const panel = form.closest("[data-auth-panel]");
        const email = form.elements.email;
        const sendCode = form.querySelector("[data-send-code]");
        const submit = form.querySelector("[type=submit]");
        const status = form.querySelector(".form-message");
        const feedback = form.querySelector("[data-email-feedback]");
        let sending = false, submitting = false, secondsRemaining = 0, timer = null, generation = 0;
        const validEmail = () => MB.isValidEmail(email.value) && email.checkValidity();
        const active = (requestGeneration) => generation === requestGeneration && host.contains(form) && !panel.hidden;
        function update() {
          const valid = validEmail();
          const invalid = email.value.length > 0 && !valid;
          email.setAttribute("aria-invalid", String(invalid));
          feedback.textContent = invalid ? "Vui lòng nhập email hợp lệ." : "";
          sendCode.disabled = !valid || sending || submitting || secondsRemaining > 0;
          submit.disabled = sending || submitting;
          email.readOnly = sending || submitting;
          form.setAttribute("aria-busy", String(sending || submitting));
          sendCode.textContent = sending ? "ĐANG YÊU CẦU…" : secondsRemaining > 0 ? `GỬI LẠI SAU ${secondsRemaining}s` : "GỬI MÃ";
        }
        function clearTimer() {
          if (timer !== null) clearInterval(timer);
          timer = null;
          secondsRemaining = 0;
        }
        const flow = { panel, close() {
          generation++;
          clearTimer();
          sending = submitting = false;
          form.elements.verificationCode.value = "";
          form.elements[recovery ? "newPassword" : "password"].value = "";
          form.elements.confirmPassword.value = "";
          status.textContent = "";
          update();
        } };
        authFlows.push(flow);
        email.addEventListener("input", () => {
          form.elements.verificationCode.value = "";
          if (!sending && !submitting) status.textContent = "";
          update();
        });
        sendCode.addEventListener("click", async () => {
          if (!active(generation) || !validEmail() || sending || submitting || secondsRemaining > 0) return;
          const requestGeneration = generation;
          sending = true;
          status.textContent = "Đang yêu cầu mã xác minh…";
          update();
          try {
            await (recovery ? MBApi.auth.sendPasswordResetCode : MBApi.auth.sendRegistrationCode)({ email: email.value.trim() });
            if (!active(requestGeneration)) return;
            status.textContent = recovery
              ? "Nếu email đã đăng ký, yêu cầu đã được tiếp nhận. Nếu chưa nhận mã, hãy thử lại sau khi hết thời gian chờ."
              : "Yêu cầu mã xác minh đã được tiếp nhận. Kiểm tra email của bạn; nếu chưa nhận mã, hãy thử lại sau khi hết thời gian chờ.";
            secondsRemaining = 60;
            timer = setInterval(() => {
              if (!active(requestGeneration)) { clearTimer(); return; }
              secondsRemaining--;
              if (secondsRemaining <= 0) clearTimer();
              update();
            }, 1000);
          } catch (error) {
            if (active(requestGeneration)) status.textContent = recovery
              ? error?.code === "EMAIL_NOT_CONFIGURED"
                ? MB.errorMessage(error)
                : "Nếu email đã đăng ký, yêu cầu chưa thể được xử lý lúc này. Vui lòng thử lại sau."
              : MB.errorMessage(error);
          } finally {
            if (active(requestGeneration)) { sending = false; update(); }
          }
        });
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!active(generation) || sending || submitting || !form.reportValidity() || !validEmail()) return;
          if (!/^[0-9]{6}$/.test(form.elements.verificationCode.value)) { status.textContent = "Nhập mã xác minh gồm 6 chữ số."; return; }
          if (form.elements[recovery ? "newPassword" : "password"].value !== form.elements.confirmPassword.value) { status.textContent = "Mật khẩu nhập lại chưa khớp."; return; }
          const requestGeneration = generation;
          submitting = true;
          status.textContent = recovery ? "Đang đặt lại mật khẩu…" : "Đang tạo tài khoản…";
          update();
          try {
            if (recovery) {
              await MBApi.auth.resetPassword({ email: email.value.trim(), verificationCode: form.elements.verificationCode.value, newPassword: form.elements.newPassword.value });
              if (!active(requestGeneration)) return;
              loginForm();
              $(".form-message", $("#login-form")).textContent = "Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.";
              $("#login-form").elements.email.focus();
              return;
            }
            await MBApi.auth.register({
              email: email.value.trim(), fullName: form.elements.fullName.value.trim(), phone: form.elements.phone.value.trim(),
              password: form.elements.password.value, skinType: form.elements.skinType.value, verificationCode: form.elements.verificationCode.value
            });
            if (!active(requestGeneration)) return;
            closeAuthForms();
            if (new URLSearchParams(location.search).get("next") === "checkout") {
              location.assign("cart.html?checkout=1");
              return;
            }
            if (new URLSearchParams(location.search).get("next") === "consultation") {
              location.assign("consultation.html");
              return;
            }
            await load();
          } catch (error) {
            if (active(requestGeneration)) status.textContent = MB.errorMessage(error);
          } finally {
            if (active(requestGeneration)) { submitting = false; update(); }
          }
        });
        update();
      }
      bindEmailCodeForm($("#register-form"), false);
      bindEmailCodeForm($("#password-reset-form"), true);
    }
    async function load() {
      closeAuthForms();
      MB.showState(host, "loading", "Đang kiểm tra phiên đăng nhập…");
      try {
        const user = responseData(await MBApi.auth.me()) || {};
        MB.syncHeaderLogout?.(true);
        const role = user.role?.name || user.role || user.roleName || "customer";
        const ordersPromise = MBApi.orders.list({ page: 1, limit: 20 });
        const [ordersResult, addressesResult, loyaltyResult, returnsResult] = await Promise.allSettled([
          ordersPromise, MBApi.customers.addresses.list(), MBApi.customers.loyalty(), MBApi.returns.list({ page: 1, limit: 20 })
        ]);
        const orders = ordersResult.status === "fulfilled" ? listData(ordersResult.value) : [];
        const addresses = addressesResult.status === "fulfilled" ? listData(addressesResult.value) : [];
        const loyalty = loyaltyResult.status === "fulfilled" ? responseData(loyaltyResult.value) || {} : {};
        const returns = returnsResult.status === "fulfilled" ? listData(returnsResult.value) : [];
        host.innerHTML = `<div class="account-top"><div><span class="eyebrow">HỒ SƠ KHÁCH HÀNG</span><h1>${esc(user.fullName || user.name || user.email || "Tài khoản")}</h1><p>${esc(role)} · ${esc(user.email || "")}</p></div><button class="outline" type="button" data-logout>ĐĂNG XUẤT</button></div>
          <section id="orders" class="account-card"><div class="section-head"><div><span class="eyebrow">LỊCH SỬ GIAO DỊCH</span><h2>Đơn hàng của tôi</h2></div></div><div id="orders-list"></div><div id="order-detail"></div></section>
          <section class="account-card"><div class="section-head"><div><span class="eyebrow">THÔNG TIN CỦA BẠN</span><h2>Hồ sơ & địa chỉ</h2></div></div>
            <form id="profile-form" class="form-grid"><label class="field">Họ tên<input name="fullName" value="${esc(user.fullName || "")}" required></label><label class="field">Số điện thoại<input name="phone" value="${esc(user.phone || "")}" autocomplete="tel"></label><label class="field">Loại da<select name="skinType"><option value="">Chưa cập nhật</option>${[["oily","Da dầu"],["dry","Da khô"],["sensitive","Da nhạy cảm"],["combination","Da hỗn hợp"],["normal","Da thường"]].map(([value,label]) => `<option value="${value}" ${user.skinType === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><button class="btn" type="submit">LƯU HỒ SƠ</button><p class="form-message" role="status"></p></form>
            <div class="section-head"><h3>Địa chỉ nhận hàng</h3></div><div id="address-list">${addressesResult.status === "rejected" ? "" : addresses.length ? addresses.map((address) => `<article class="address-row"><div><b>${esc(address.receiverName)}</b> · ${esc(address.receiverPhone)} ${address.isDefault ? '<span class="pill">MẶC ĐỊNH</span>' : ""}<p>${esc(address.fullAddress)}</p></div><button class="textlink" type="button" data-delete-address="${esc(address.id || address._id)}">Xóa</button></article>`).join("") : '<p class="empty">Chưa lưu địa chỉ nhận hàng.</p>'}</div>
            <form id="address-form" class="form-grid"><label class="field">Người nhận<input name="receiverName" value="${esc(user.fullName || "")}" required></label><label class="field">Điện thoại<input name="receiverPhone" value="${esc(user.phone || "")}" required></label><label class="field">Địa chỉ đầy đủ<textarea name="fullAddress" required></textarea></label><label><input type="checkbox" name="isDefault"> Đặt làm địa chỉ mặc định</label><button class="outline" type="submit">THÊM ĐỊA CHỈ</button><p class="form-message" role="status"></p></form>${addressesResult.status === "rejected" ? `<p class="form-message">${esc(MB.errorMessage(addressesResult.reason))}</p>` : ""}</section>
          <section class="account-card"><span class="eyebrow">MAISON BELLE · THÀNH VIÊN</span><h2>${esc(loyalty.membership?.tier || "bronze")} · ${Number(loyalty.membership?.pointsBalance ?? loyalty.pointsBalance ?? 0)} điểm</h2><p>Tích điểm được cập nhật khi đơn hàng hoàn tất. Lịch sử ghi nhận trực tiếp từ hệ thống.</p><div id="loyalty-history">${loyaltyResult.status === "rejected" ? `<p class="form-message">${esc(MB.errorMessage(loyaltyResult.reason))}</p>` : loyalty.history?.length ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Giao dịch</th><th>Điểm</th></tr></thead><tbody>${loyalty.history.map((entry) => `<tr><td>${esc(entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("vi-VN") : "—")}</td><td>${esc(entry.note || entry.type || "Điểm thành viên")}</td><td>${esc(entry.points > 0 ? `+${entry.points}` : entry.points)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty">Chưa có giao dịch điểm.</p>'}</div></section>
          <section class="account-card"><div class="section-head"><div><span class="eyebrow">HỖ TRỢ SAU MUA</span><h2>Đổi trả của tôi</h2></div></div><div id="returns-list">${returnsResult.status === "rejected" ? `<p class="form-message">${esc(MB.errorMessage(returnsResult.reason))}</p>` : returns.length ? `<div class="table-wrap"><table><thead><tr><th>Mã yêu cầu</th><th>Đơn hàng</th><th>Lý do</th><th>Trạng thái</th><th>Ngày tạo</th></tr></thead><tbody>${returns.map((item) => `<tr><td>${esc(item.returnCode || item.id || item._id)}</td><td>${esc(item.orderCode || item.orderId)}</td><td>${esc(item.reason)}</td><td>${esc(item.status)}</td><td>${esc(item.createdAt ? new Date(item.createdAt).toLocaleDateString("vi-VN") : "—")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty">Chưa có yêu cầu đổi trả.</p>'}</div></section>`;
        const ordersHost = $("#orders-list");
        if (ordersResult.status === "rejected") MB.showState(ordersHost, "error", MB.errorMessage(ordersResult.reason));
        else if (!orders.length) MB.showState(ordersHost, "empty", "Bạn chưa có đơn hàng.");
        else ordersHost.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Mã đơn</th><th>Ngày tạo</th><th>Tổng tiền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${orders.map((order) => {
          const id = String(order._id || order.id || ""), status = String(order.orderStatus || order.status || "");
          const paymentState = String(order.paymentStatus || order.payment?.status || "pending");
          const mockPayment = order.paymentMethod === "mock" && paymentState !== "paid" && !["cancelled", "returned"].includes(status);
          return `<tr><td>${esc(order.orderCode || order.code || id || "—")} ${demoTag(order)}</td><td>${esc(order.createdAt ? new Date(order.createdAt).toLocaleDateString("vi-VN") : "—")}</td><td>${MB.money(order.finalAmount ?? order.totalAmount ?? order.total ?? 0)}</td><td>${esc(statusText(status))}</td><td><button type="button" class="textlink" data-order-detail="${esc(id)}">Chi tiết & hóa đơn</button>${mockPayment ? ` · <button type="button" class="textlink" data-pay-order="${esc(id)}">${paymentState === "failed" ? "Thử thanh toán lại" : "Thanh toán mô phỏng"}</button>` : ""}${status.toLowerCase() === "pending" ? ` · <button type="button" class="textlink" data-cancel-order="${esc(id)}">Hủy đơn</button>` : ""}</td></tr>`;
        }).join("")}</tbody></table></div>`;
      } catch (error) {
        if (error.status === 401) loginForm();
        else showError(host, error);
      }
    }
    host.addEventListener("click", async (event) => {
      const forgotPassword = event.target.closest("[data-forgot-password]");
      if (forgotPassword) {
        setAuthMode("reset");
        return;
      }
      const authMode = event.target.closest("[data-auth-mode]");
      if (authMode) {
        setAuthMode(authMode.dataset.authMode);
        return;
      }
      const detailButton = event.target.closest("[data-order-detail]");
      const cancelButton = event.target.closest("[data-cancel-order]");
      const paymentButton = event.target.closest("[data-pay-order]");
      const deleteAddressButton = event.target.closest("[data-delete-address]");
      if (detailButton) {
        const detailHost = $("#order-detail");
        MB.showState(detailHost, "loading", "Đang tải chi tiết đơn hàng…");
        try {
          const order = responseData(await MBApi.orders.get(detailButton.dataset.orderDetail)) || {};
          const lines = order.items || order.orderItems || [];
          const payment = order.payment || {};
          const invoice = order.invoice || order.invoiceSnapshot || null;
          const returnable = ["delivered", "completed"].includes(String(order.orderStatus || ""));
          const returnForm = returnable && lines.length ? `<form data-return-request data-order-id="${esc(order.id || order._id || detailButton.dataset.orderDetail)}" class="form-grid"><label class="field">Sản phẩm<select name="variantId" required>${lines.map((line, index) => `<option value="${esc(line.variantId)}" data-max="${esc(line.quantity)}" ${index === 0 ? "selected" : ""}>${esc(line.productName || line.name || "Sản phẩm")} · tối đa ${esc(line.quantity)}</option>`).join("")}</select></label><label class="field">Số lượng<input type="number" name="quantity" min="1" max="${Number(lines[0]?.quantity) || 1}" value="1" required></label><label class="field">Lý do<textarea name="reason" required maxlength="1000"></textarea></label><button class="outline" type="submit">GỬI YÊU CẦU ĐỔI TRẢ</button><p class="form-message" role="status"></p></form>` : "";
          detailHost.innerHTML = `<div class="order-detail"><span class="eyebrow">CHI TIẾT ĐƠN ${demoTag(order)}</span><h3>${esc(order.orderCode || order.code || order._id || "Đơn hàng")}</h3>${lines.length ? `<div class="table-wrap"><table><thead><tr><th>Sản phẩm</th><th>SKU</th><th>SL</th><th>Đơn giá</th></tr></thead><tbody>${lines.map((line) => `<tr><td>${esc(line.productName || line.name || line.productSnapshot?.name || "Sản phẩm")}</td><td>${esc(line.sku || line.variantSku || "—")}</td><td>${esc(line.quantity ?? "—")}</td><td>${MB.money(line.unitPrice ?? line.price ?? 0)}</td></tr>`).join("")}</tbody></table></div>` : "<p>Đơn chưa có mặt hàng.</p>"}<p>Thanh toán: ${esc(payment.status || order.paymentStatus || "đang chờ")}${payment.isMock ? " · mô phỏng, không thu tiền thật" : ""}</p><p>Hóa đơn: ${invoice ? `${esc(invoice.invoiceCode || invoice.code || invoice._id || "")} · ${esc(invoice.status || "")}` : "Chưa phát hành"} · ${MB.money(invoice?.amount ?? order.finalAmount ?? 0)}</p>${returnable ? `<h4>Yêu cầu đổi trả</h4>${returnForm}` : ""}</div>`;
        } catch (error) { showError(detailHost, error); }
      }
      if (paymentButton) {
        paymentButton.disabled = true;
        try {
          await MBApi.orders.payment(paymentButton.dataset.payOrder, { outcome: "success" });
          MB.toast("Thanh toán mô phỏng thành công; không có khoản tiền thật được thu.", "success");
          await load();
        } catch (error) { MB.toast(MB.errorMessage(error), "error"); }
        finally { paymentButton.disabled = false; }
      }
      if (deleteAddressButton) {
        if (!root.confirm("Xóa địa chỉ nhận hàng này?")) return;
        deleteAddressButton.disabled = true;
        try { await MBApi.customers.addresses.remove(deleteAddressButton.dataset.deleteAddress); MB.toast("Đã xóa địa chỉ.", "success"); await load(); }
        catch (error) { MB.toast(MB.errorMessage(error), "error"); }
        finally { deleteAddressButton.disabled = false; }
      }
      if (cancelButton) {
        if (!root.confirm("Bạn muốn gửi yêu cầu hủy đơn này chứ?")) return;
        cancelButton.disabled = true;
        try { await MBApi.orders.updateStatus(cancelButton.dataset.cancelOrder, { status: "cancelled" }); MB.toast("Đơn đã được cập nhật.", "success"); await load(); }
        catch (error) { MB.toast(MB.errorMessage(error), "error"); }
        finally { cancelButton.disabled = false; }
      }
    });
    host.addEventListener("change", (event) => {
      const variant = event.target.closest('[data-return-request] select[name="variantId"]');
      if (!variant) return;
      const quantity = variant.form.elements.quantity;
      quantity.max = variant.selectedOptions[0]?.dataset.max || "1";
      quantity.value = "1";
    });
    host.addEventListener("submit", async (event) => {
      const form = event.target;
      if (!["profile-form", "address-form"].includes(form.id) && !form.matches("[data-return-request]")) return;
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      const message = form.querySelector(".form-message");
      button.disabled = true;
      if (message) message.textContent = "Đang lưu…";
      try {
        const values = Object.fromEntries(new FormData(form).entries());
        if (form.id === "profile-form") {
          await MBApi.customers.updateProfile(values);
          MB.toast("Hồ sơ đã được cập nhật.", "success");
          await load();
        } else if (form.id === "address-form") {
          values.isDefault = form.elements.isDefault.checked;
          await MBApi.customers.addresses.create(values);
          MB.toast("Đã lưu địa chỉ nhận hàng.", "success");
          await load();
        } else {
          await MBApi.returns.create({ orderId: form.dataset.orderId, reason: values.reason, items: [{ variantId: values.variantId, quantity: Number(values.quantity) }] });
          MB.toast("Yêu cầu đổi trả đã được gửi.", "success");
          await load();
        }
      } catch (error) {
        if (message) message.textContent = MB.errorMessage(error);
        else MB.toast(MB.errorMessage(error), "error");
      } finally { button.disabled = false; }
    });
    document.body.addEventListener("click", (event) => { if (event.target.closest("[data-retry]")) load(); });
    await load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (document.body.dataset.page === "catalog") catalog();
    if (document.body.dataset.page === "product") productDetail();
    if (document.body.dataset.page === "home") home();
    if (document.body.dataset.page === "cart") cartPage();
    if (document.body.dataset.page === "account") accountPage();
  });
})();
