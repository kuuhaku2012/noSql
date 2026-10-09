(function (root, factory) {
  const pages = factory(root);
  if (typeof module === "object" && module.exports) module.exports = pages;
  if (root) root.MBCatalogPages = pages;
  if (root?.document) root.document.addEventListener("DOMContentLoaded", () => pages.bind());
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const unwrap = (response) => response?.data ?? response;
  const list = (response) => {
    const value = unwrap(response);
    return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
  };
  const esc = (value) => root.MB?.escape ? root.MB.escape(value) : String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const brandKey = (brand) => brand?.code || brand?.slug || brand?.id || brand?._id || "";
  function normalizeBrands(response) {
    const brands = unwrap(response)?.brands || [];
    return brands.filter((brand) => brand?.isActive !== false && brand?.name && brandKey(brand));
  }
  function brandHref(brand) { return `products.html?brand=${encodeURIComponent(brandKey(brand))}`; }
  function normalizeOffers({ promotions, flashSales } = {}) {
    return [
      ...list(promotions).map((item) => ({ ...item, kind: "promotion" })),
      ...list(flashSales).map((item) => ({ ...item, kind: "flashSale" }))
    ];
  }
  function dateRange(item) {
    const start = item?.startDate ? new Date(item.startDate).toLocaleDateString("vi-VN") : "—";
    const end = item?.endDate ? new Date(item.endDate).toLocaleDateString("vi-VN") : "—";
    return `${start} → ${end}`;
  }
  function showState(host, kind, message, action = "") {
    if (root.MB?.showState) root.MB.showState(host, kind, message, action);
    else if (host) host.textContent = message;
  }
  async function brandsPage() {
    const grid = root.document.querySelector("#brands-grid");
    if (!grid) return;
    showState(grid, "loading", "Đang tải thương hiệu từ hệ thống…");
    try {
      const brands = normalizeBrands(await root.MBApi.catalog());
      if (!brands.length) { showState(grid, "empty", "Chưa có thương hiệu đang kinh doanh."); return; }
      grid.innerHTML = brands.map((brand) => `<a class="brand-card" href="${esc(brandHref(brand))}"><span class="brand-mark">${esc(String(brand.name).slice(0, 1).toUpperCase())}</span><span><b>${esc(brand.name)}</b><small>${esc(brand.origin || brand.code || "Maison Belle selection")}</small></span><strong>Khám phá →</strong></a>`).join("");
    } catch (error) {
      showState(grid, error.status === 404 ? "notFound" : "error", root.MB?.errorMessage(error) || "Không tải được thương hiệu.", '<button class="outline" type="button" data-catalog-retry>Thử lại</button>');
    }
  }
  async function offersPage() {
    const programs = root.document.querySelector("#offers-programs");
    const products = root.document.querySelector("#offers-products");
    if (!programs || !products) return;
    showState(programs, "loading", "Đang tải chương trình ưu đãi…");
    showState(products, "loading", "Đang tải sản phẩm giảm giá…");
    try {
      const [promotionResponse, flashSaleResponse, productResponse] = await Promise.all([
        root.MBApi.promotions.list(), root.MBApi.flashSales.list(), root.MBApi.products({ sale: "1", page: 1, limit: 12 })
      ]);
      const offers = normalizeOffers({ promotions: promotionResponse, flashSales: flashSaleResponse });
      programs.innerHTML = offers.length ? offers.map((item) => `<article class="offer-card ${item.kind === "flashSale" ? "offer-card-flash" : ""}"><span class="eyebrow">${item.kind === "flashSale" ? "FLASH SALE" : "CHƯƠNG TRÌNH ƯU ĐÃI"}</span><h2>${esc(item.name || "Ưu đãi Maison Belle")}</h2><p>${esc(item.description || (item.kind === "flashSale" ? "Số lượng có hạn theo từng phân loại sản phẩm." : "Giá ưu đãi được áp dụng trực tiếp khi đặt hàng."))}</p><div class="offer-meta"><span>${esc(dateRange(item))}</span><b>${esc(item.items?.length || 0)} sản phẩm</b></div></article>`).join("") : `<div class="state state-empty" role="status"><span class="state-mark">✦</span><b>Chưa có chương trình</b><p>Maison Belle sẽ cập nhật ưu đãi mới tại đây.</p></div>`;
      const saleProducts = list(productResponse);
      if (!saleProducts.length) showState(products, "empty", "Chưa có sản phẩm đang giảm giá.");
      else if (root.MB?.card) products.innerHTML = saleProducts.map((item) => root.MB.card(item)).join("");
      else products.textContent = "Không thể hiển thị sản phẩm.";
    } catch (error) {
      const message = root.MB?.errorMessage(error) || "Không tải được ưu đãi.";
      showState(programs, error.status === 403 ? "forbidden" : "error", message, '<button class="outline" type="button" data-offers-retry>Thử lại</button>');
      showState(products, error.status === 403 ? "forbidden" : "error", message, '<button class="outline" type="button" data-offers-retry>Thử lại</button>');
    }
  }
  function bind() {
    if (!root.document || !root.MBApi) return;
    const page = root.document.body?.dataset.page;
    if (page === "brands") brandsPage();
    if (page === "offers") offersPage();
    root.document.body?.addEventListener("click", (event) => {
      if (event.target.closest("[data-catalog-retry]")) brandsPage();
      if (event.target.closest("[data-offers-retry]")) offersPage();
    });
  }
  return { brandHref, normalizeBrands, normalizeOffers, brandsPage, offersPage, bind };
});
