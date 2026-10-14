const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

const root = join(__dirname, "..");
const customerPages = ["index.html", "products.html", "product.html", "cart.html", "account.html", "warranty.html", "offers.html", "brands.html", "about.html"];

test("customer pages share accessible search, account, and cart header actions", async () => {
  for (const page of customerPages) {
    const html = await readFile(join(root, page), "utf8");
    const header = html.match(/<header class="header">([\s\S]*?)<\/header>/)?.[1] || "";
    const search = header.match(/<form class="search" data-search>([\s\S]*?)<\/form>/)?.[1] || "";
    assert.match(header, /<form class="search" data-search>/, `${page} needs product search`);
    assert.match(search, /^\s*<button class="search-submit" type="submit" aria-label="Tìm kiếm"[\s\S]*?<svg[\s\S]*?<\/svg><\/button>/, `${page} needs a left-aligned search icon`);
    assert.match(search, /name="q"[^>]*aria-label="Tìm kiếm"[\s\S]*?<a href="products\.html\?filters=open" class="search-filter" aria-label="Lọc sản phẩm" title="Lọc sản phẩm"><svg[\s\S]*?<\/svg><\/a>\s*$/, `${page} needs a filter action after the search field`);
    assert.match(header, /name="q"[^>]*aria-label="Tìm kiếm"/, `${page} needs an accessible search input`);
    assert.match(header, /href="account\.html" aria-label="Tài khoản"/, `${page} needs an account action`);
    assert.match(header, /href="cart\.html" aria-label="Giỏ hàng"/, `${page} needs a cart action`);
    assert.match(header, /data-cart-count/, `${page} needs the live cart count hook`);
  }
});

test("header filter link opens the catalog filter panel", async () => {
  const storefront = await readFile(join(root, "js/storefront.js"), "utf8");
  assert.match(storefront, /params\.get\("filters"\)\s*===\s*"open"[\s\S]*?filters\.classList\.add\("open"\)/);
});

test("staff administration is not part of customer navigation", async () => {
  for (const page of customerPages) {
    const html = await readFile(join(root, page), "utf8");
    const navAndDrawer = `${html.match(/<nav class="nav">([\s\S]*?)<\/nav>/)?.[1] || ""}\n${html.match(/<div class="drawer"[\s\S]*?<\/div>/)?.[0] || ""}`;
    assert.doesNotMatch(navAndDrawer, /href="admin\.html"/, `${page} must keep staff tools out of customer navigation`);
  }
});

test("customer pages put service shortcuts in the header and group product types under categories", async () => {
  for (const page of customerPages) {
    const html = await readFile(join(root, page), "utf8");
    const header = html.match(/<header class="header">([\s\S]*?)<\/header>/)?.[1] || "";
    const nav = html.match(/<nav class="nav">([\s\S]*?)<\/nav>/)?.[1] || "";
    const drawer = html.match(/<div class="drawer"[\s\S]*?<\/div>/)?.[0] || "";
    assert.match(header, /class="header-shortcut" href="consultation\.html" aria-label="Tư vấn & chăm sóc"/);
    assert.match(header, /class="header-shortcut" href="warranty\.html" aria-label="Bảo hành & hỗ trợ"/);
    assert.match(header, /<details class="language-menu">[\s\S]*?aria-label="Chọn ngôn ngữ"/);
    assert.match(header, /Tiếng Việt/);
    assert.match(header, /<button type="button" disabled><span>English/);
    const categoryMenu = nav.match(/<details class="nav-categories">([\s\S]*?)<\/details>/)?.[1] || "";
    assert.match(nav, /<summary>SẢN PHẨM<\/summary>/);
    assert.match(nav, /<a[^>]*href="index\.html"[^>]*>TRANG CHỦ<\/a>\s*<details class="nav-categories">/, `${page} should put Products beside Home`);
    assert.doesNotMatch(categoryMenu, /Tất cả sản phẩm/i, `${page} should not duplicate the all-products entry in the category menu`);
    assert.doesNotMatch(drawer, /Danh mục · tất cả sản phẩm/i, `${page} should not duplicate the all-products entry in the mobile menu`);
    assert.match(header, /<span class="language-code">VI<\/span>/, `${page} should keep the language choice visible`);
    for (const category of ["skincare", "makeup", "body"]) {
      assert.match(categoryMenu, new RegExp(`data-nav-group="${category}"`));
      assert.match(categoryMenu, new RegExp(`href="products\\.html\\?cat=${category}"`));
    }
    assert.equal((categoryMenu.match(/class="nav-menu-group"/g) || []).length, 3, `${page} should expose three product groups`);
    assert.doesNotMatch(nav.replace(/<details class="nav-categories">[\s\S]*?<\/details>/, ""), /cat=(skincare|makeup|body)/);
    assert.doesNotMatch(nav, /ĐẶT LỊCH TƯ VẤN/);
    assert.doesNotMatch(nav, /nav-services|index\.html#bao-hanh/);
    for (const section of ["ban-chay", "hang-moi"]) assert.match(nav, new RegExp(`href="(?:index\\.html)?#${section}"`), `${page} should offer ${section} navigation`);
    assert.match(nav, /<a[^>]*href="about\.html"[^>]*>GIỚI THIỆU<\/a>\s*$/, `${page} should place About last in the main navigation`);
    assert.doesNotMatch(nav, /href="index\.html#gioi-thieu"/);
    assert.match(drawer, /href="consultation\.html"/);
    assert.match(drawer, /href="warranty\.html"/);
    assert.equal((drawer.match(/href="about\.html"/g) || []).length, 1, `${page} should show the introduction link once in the mobile menu`);
    for (const section of ["ban-chay", "hang-moi"]) assert.match(drawer, new RegExp(`href="index\\.html#${section}"`), `${page} should offer ${section} in the mobile menu`);
  }
});

test("the product mega menu closes when leaving it or selecting another navigation item", async () => {
  const app = await readFile(join(root, "js/app.js"), "utf8");
  const home = await readFile(join(root, "index.html"), "utf8");
  assert.match(app, /\.nav-categories[\s\S]*?pointerenter/);
  assert.match(app, /\.nav-categories[\s\S]*?pointerleave/);
  assert.match(app, /categoryMenu\.contains\(event\.target\)/);
  assert.match(app, /categoryMenu\.open\s*=\s*false/);
  assert.match(home, /<details class="nav-categories"><summary>SẢN PHẨM<\/summary>/);
  assert.match(app, /pointerType\s*===\s*["']mouse["']/);
  assert.match(app, /\.open\s*=\s*true/);
});

test("home layout aligns categories and trust copy in a readable hierarchy", async () => {
  const home = await readFile(join(root, "index.html"), "utf8");
  const css = await readFile(join(root, "css/style.css"), "utf8");
  const flowCss = await readFile(join(root, "css/flows.css"), "utf8");
  const navCss = css.match(/\.nav\s*\{([^}]*)\}/)?.[1] || "";
  const categoryNavCss = flowCss.match(/\.nav-categories\s*\{([^}]*)\}/)?.[1] || "";
  const menuCss = flowCss.match(/\.nav-menu-panel\s*\{([^}]*)\}/)?.[1] || "";
  const trust = home.match(/<section class="trust">([\s\S]*?)<\/section>/)?.[1] || "";

  assert.match(navCss, /justify-content:\s*center/, "main navigation links should stay centered");
  assert.match(navCss, /padding-left:\s*max\(20px,\s*calc\(\(100% - 1180px\) \/ 2\)\)/, "navigation should align to the main content grid");
  assert.match(categoryNavCss, /position:\s*static/, "Products should flow directly after Home");
  assert.doesNotMatch(flowCss, /\.nav-categories summary::after\s*\{[^}]*content:/, "the Products control should not have a caret");
  assert.match(menuCss, /grid-template-columns:\s*repeat\(3/, "the product dropdown should use three category columns");
  assert.match(flowCss, /body\[data-page="account"\] \.nav,\s*body\[data-page="cart"\] \.nav,\s*body\[data-page="warranty"\] \.nav\s*\{[^}]*display:\s*none/s, "task-focused pages should not show the secondary navigation");
  assert.match(flowCss, /\.language-symbol[^\{]*\{[^}]*display:\s*none/, "the language icon and arrow should be visually removed");
  assert.equal((trust.match(/class="trust-copy"/g) || []).length, 4, "each trust item should group its title and description");
  assert.match(css, /\.trust-copy\s*\{[^}]*flex-direction:\s*column/s, "trust descriptions should sit below their headings");
  assert.doesNotMatch(home, /class="hero-tag"/, "the decorative hero badge should be removed");
});

test("product card names use one explicit typeface at every viewport", async () => {
  const css = await readFile(join(root, "css/style.css"), "utf8");
  assert.match(css, /\.card \.name\s*\{[^}]*font-family:\s*var\(--serif\)[^}]*font-weight:\s*400/s);
});

test("quantity controls use theme colors instead of a fixed white background", async () => {
  const css = await readFile(join(root, "css/style.css"), "utf8");
  const controls = css.match(/\.choice button,\s*\.qty button\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(controls, /background:\s*var\(--surface\)/);
  assert.match(controls, /color:\s*var\(--ink\)/);
});

test("voucher input keeps room beside its check button in the cart summary", async () => {
  const css = await readFile(join(root, "css/atelier.css"), "utf8");
  assert.doesNotMatch(css, /\.summary \.btn,\s*#checkout/);
  assert.match(css, /\.summary\s*>\s*#checkout\s*\{[^}]*width:\s*100%/s);
});

test("cart omits the stepper, item count, and placeholder shipping display", async () => {
  const cart = await readFile(join(root, "cart.html"), "utf8");
  const storefront = await readFile(join(root, "js/storefront.js"), "utf8");
  const heading = cart.match(/<h1 id="heading">([^<]*)<\/h1>/)?.[1];

  assert.doesNotMatch(cart, /class="steps"/, "the redundant checkout steps should be removed");
  assert.equal(heading, "Giỏ hàng của bạn", "the cart heading should not include a count");
  assert.doesNotMatch(cart, /class="shipbar"|ship-note|Giao hàng mô phỏng/, "the mock shipping banner should be removed");
  assert.doesNotMatch(cart, /<span>Phí giao hàng<\/span>/, "the summary should not show an unquoted delivery fee");
  assert.doesNotMatch(storefront, /\$\("#heading"\)\.textContent\s*=/, "cart rendering should not re-add the item count");
  assert.doesNotMatch(storefront, /\$\("#ship"\)/, "cart rendering should not require a placeholder fee element");
});

test("home menu destinations and product shelves are honest about API-backed ranking", async () => {
  const home = await readFile(join(root, "index.html"), "utf8");
  const storefront = await readFile(join(root, "js/storefront.js"), "utf8");
  assert.match(home, /id="gioi-thieu"/);
  assert.match(home, /id="ban-chay"[\s\S]*?id="loved"/);
  assert.match(home, /id="hang-moi"[\s\S]*?id="fresh"/);
  assert.match(home, /<h2>Sản phẩm bán chạy<\/h2>/);
  assert.match(home, /<h2>Hàng mới về<\/h2>/);
  assert.match(storefront, /Xếp hạng bán chạy chờ backend/);
  assert.match(storefront, /XEM TOÀN BỘ SẢN PHẨM/);
  assert.doesNotMatch(storefront, /products\.slice\(0,\s*4\)|products\.slice\(4,\s*8\)/, "a recent-product response must not be presented as sales ranking");
});

test("about page presents the brand story and a support CTA", async () => {
  const about = await readFile(join(root, "about.html"), "utf8");
  assert.match(about, /<body data-page="about">/);
  assert.match(about, /<main[^>]*class="[^"]*about-page/);
  assert.match(about, /id="about-values"/);
  assert.match(about, /id="about-appointment"/);
  assert.match(about, /href="consultation\.html"/);
});

test("homepage campaign uses a solid copy panel and blends the image into its frame", async () => {
  const css = await readFile(join(root, "css/atelier.css"), "utf8");
  const baseCss = await readFile(join(root, "css/style.css"), "utf8");
  const copy = css.match(/\.campaign-copy\s*\{([^}]*)\}/s)?.[1] || "";
  const imageBlend = css.match(/\.campaign-visual::after\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(copy, /background:\s*var\(--campaign/, "campaign copy should use the same opaque color as its frame");
  assert.doesNotMatch(copy, /backdrop-filter/, "campaign copy should not use a glass blur");
  assert.match(imageBlend, /linear-gradient\(/, "the image edge should dissolve into the campaign frame");
  assert.match(imageBlend, /var\(--campaign/, "the image fade should use the current theme's campaign color");
  assert.match(css, /\.hero-copy\s*\{[^}]*animation:\s*hero-copy-enter/s, "hero copy should animate on page entry");
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, "animation rules must respect reduced motion");
  assert.match(baseCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none\s*!important/, "reduced motion should disable animation and transitions");
});

test("hero image softens at the copy seam and campaign copy gets a reduced-motion-safe glint", async () => {
  const css = await readFile(join(root, "css/atelier.css"), "utf8");
  const heroSeam = css.match(/\.hero-visual::before\s*\{([^}]*)\}/s)?.[1] || "";
  const heroOverlay = css.match(/\.hero-visual::after\s*\{([^}]*)\}/s)?.[1] || "";
  const campaignSeam = css.match(/\.campaign-visual::after\s*\{([^}]*)\}/s)?.[1] || "";
  const campaignGlint = css.match(/\.campaign-copy::after\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(heroSeam, /backdrop-filter:\s*blur\(/, "only the hero image seam should be softened");
  assert.match(heroSeam, /mask-image:\s*linear-gradient/, "the blur should fade out before covering the product");
  assert.match(heroSeam, /inset:\s*0 auto 0 54%/, "the hero blur should sit over the image/copy transition");
  assert.match(heroSeam, /width:\s*clamp\(/, "the blur should stay confined to a narrow seam");
  assert.match(heroOverlay, /background:\s*linear-gradient\(/, "the readable copy overlay should remain separate from the blur");
  assert.match(campaignSeam, /backdrop-filter:\s*blur\(/, "the campaign seam should soften the extended image background");
  assert.match(campaignSeam, /left:\s*-\d+px/, "the campaign blur should extend into the copy frame");
  assert.match(campaignGlint, /linear-gradient\(/, "the campaign panel should contain a soft light streak");
  assert.match(css, /\.campaign\.in\s+\.campaign-copy::after[^{}]*\{[^}]*animation:/s, "the glint should appear as the campaign enters view");
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?campaign-copy::after[\s\S]*?animation:\s*none/s, "reduced-motion users should not receive the glint animation");
});

test("seam blending stays behind readable hero and campaign copy", async () => {
  const css = await readFile(join(root, "css/atelier.css"), "utf8");
  const heroCopy = css.match(/\.hero-copy\s*\{([^}]*)\}/s)?.[1] || "";
  const campaignCopy = css.match(/\.campaign-copy\s*\{([^}]*)\}/s)?.[1] || "";
  const campaignContent = css.match(/\.campaign-copy\s*>\s*\*\s*\{([^}]*)\}/s)?.[1] || "";

  assert.match(heroCopy, /z-index:\s*2/, "hero text should sit above the overlapping image fade");
  assert.doesNotMatch(campaignCopy, /isolation:\s*isolate/, "campaign text must be able to layer above the neighboring image fade");
  assert.match(campaignContent, /z-index:\s*2/, "campaign text should sit above the overlapping image fade");
});

test("warranty content lives on its own page and is linked from the storefront", async () => {
  const home = await readFile(join(root, "index.html"), "utf8");
  const warranty = await readFile(join(root, "warranty.html"), "utf8");
  assert.doesNotMatch(home, /id="bao-hanh"/);
  assert.match(warranty, /<main[^>]*class="[^"]*warranty-page/);
  assert.match(warranty, /Bảo hành & hỗ trợ/);
  assert.match(warranty, /href="account\.html#orders"/);
});

test("offers and brands pages expose live catalog hooks", async () => {
  const offers = await readFile(join(root, "offers.html"), "utf8");
  const brands = await readFile(join(root, "brands.html"), "utf8");
  const flowCss = await readFile(join(root, "css/flows.css"), "utf8");
  assert.match(offers, /body data-page="offers"/);
  assert.match(offers, /id="offers-programs"/);
  assert.match(offers, /id="offers-products"/);
  assert.match(offers, /js\/catalog-pages\.js/);
  assert.match(brands, /body data-page="brands"/);
  assert.match(brands, /id="brands-grid"/);
  assert.match(brands, /js\/catalog-pages\.js/);
  assert.doesNotMatch(offers, /Giá được đồng bộ từ API/);
  assert.doesNotMatch(brands, /Đồng bộ từ \/api\/catalog/);
  assert.match(flowCss, /html\[data-theme="dark"\] \.offers-hero/);
  assert.match(flowCss, /html\[data-theme="dark"\] \.brands-hero/);
});

test("warranty page provides order lookup, return guidance, and appointment CTA", async () => {
  const warranty = await readFile(join(root, "warranty.html"), "utf8");
  assert.match(warranty, /id="order-lookup-form"/);
  assert.match(warranty, /name="orderCode"/);
  assert.match(warranty, /id="order-lookup-result"/);
  assert.match(warranty, /id="return-guide"/);
  assert.match(warranty, /href="consultation\.html"/);
  assert.match(warranty, /js\/warranty-page\.js/);
});

test("checkout asks guests to sign in and resumes checkout after login", async () => {
  const storefront = await readFile(join(root, "js/storefront.js"), "utf8");
  assert.match(storefront, /await MBApi\.auth\.me\(\)[\s\S]*?account\.html\?next=checkout/);
  assert.match(storefront, /new URLSearchParams\(location\.search\)\.get\("next"\) === "checkout"[\s\S]*?cart\.html\?checkout=1/);
  assert.match(storefront, /new URLSearchParams\(location\.search\)\.get\("checkout"\) === "1"/);
});

test("mobile navigation can scroll through the full service menu", async () => {
  const css = await readFile(join(root, "css/style.css"), "utf8");
  const drawerNav = css.match(/\.drawer nav\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(drawerNav, /overflow-y:\s*auto/);
});

test("customer login does not expose shared demo credentials or autofill", async () => {
  const storefront = await readFile(join(root, "js/storefront.js"), "utf8");
  assert.match(storefront, /id="login-form"/);
  assert.match(storefront, /<input\b(?=[^>]*type="checkbox")(?=[^>]*name="rememberEmail")[^>]*>/);
  assert.match(storefront, /data-forgot-password/);
  assert.match(storefront, /đặt lại mật khẩu qua email chưa được tích hợp/i);
  assert.equal((storefront.match(/data-password-toggle(?=\s)/g) || []).length, 3, "login, registration, and confirmation passwords need visibility controls");
  assert.doesNotMatch(storefront, /data-fill-customer-demo|customer@maisonbelle\.local|Demo@123/);
});

test("staff login redirects to the dedicated admin page", async () => {
  const storefront = await readFile(join(root, "js/storefront.js"), "utf8");
  assert.match(storefront, /const loginResponse = await MBApi\.auth\.login/);
  assert.match(storefront, /\["manager", "sales", "warehouse"\]\.includes\(role\)/);
  assert.match(storefront, /admin\.html\?view=/);
});

test("account login and registration fields use one full-width row each", async () => {
  const css = await readFile(join(root, "css/flows.css"), "utf8");
  const accountForm = css.match(/\.account-glass\s+\.form-grid\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(accountForm, /grid-template-columns:\s*1fr/, "account forms should stack every field on its own row");
  assert.match(css, /\.auth-options\s*\{[^}]*padding:\s*\d+px[^}]*border:/s, "remember and recovery actions should sit in a styled, aligned surface");
  assert.match(css, /\.password-control\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.password-toggle\s*\{/);
});

test("all storefront and admin pages load the shared theme layer", async () => {
  for (const page of [...customerPages, "admin.html"]) {
    const html = await readFile(join(root, page), "utf8");
    assert.match(html, /href="css\/theme\.css"/, `${page} needs the shared theme stylesheet`);
  }
});

test("admin shell exposes compact sidebar and report chart hooks", async () => {
  const admin = await readFile(join(root, "admin.html"), "utf8");
  const adminJs = await readFile(join(root, "js/admin.js"), "utf8");
  const operations = await readFile(join(root, "css/operations.css"), "utf8");
  const theme = await readFile(join(root, "css/theme.css"), "utf8");
  assert.match(admin, /id="sidebar-logo"/, "admin logo should control sidebar collapse");
  assert.match(admin, /side-link-icon/, "admin links need compact icon hooks");
  assert.match(adminJs, /mb-admin-sidebar/, "sidebar state should persist per browser");
  assert.match(adminJs, /sidebar-collapsed/, "admin JS should synchronize the collapsed state");
  assert.match(adminJs, /#sidebar-logo/, "admin JS should bind the logo as the sidebar toggle");
  assert.doesNotMatch(adminJs, /#collapse-side/, "admin JS should not depend on a separate collapse button");
  assert.match(theme, /--admin-sans/, "admin should define a readable operations font");
  assert.match(theme, /\.admin-layout\.sidebar-collapsed/, "theme should style the compact sidebar state");
  assert.match(operations, /report-bar-fill/, "admin report charts should remain styled");
});

test("admin product editor uses image upload instead of an operator-entered slug", async () => {
  const admin = await readFile(join(root, "js/admin.js"), "utf8");
  const theme = await readFile(join(root, "css/theme.css"), "utf8");
  assert.match(admin, /type="file"[^>]+name="image"/);
  assert.match(admin, /accept="image\/\*"/);
  assert.match(admin, /imageUrl/);
  assert.match(theme, /\.admin form\[data-admin-action="create-product"\] \.image-upload[^{]*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(theme, /\.admin form\[data-admin-action="create-product"\] \.field:has\(> textarea\[name="description"\]\)[^{]*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(theme, /\.admin form\[data-admin-action="create-product"\] textarea\[name="description"\][^{]*\{[^}]*min-height:\s*140px/s);
  assert.doesNotMatch(admin, /formField\("Đường dẫn định danh", "slug"/);
});

test("admin order actions use theme tokens for light and dark surfaces", async () => {
  const theme = await readFile(join(root, "css/theme.css"), "utf8");
  assert.match(theme, /\.admin \.textlink[^{]*\{[^}]*color:\s*var\(--rose\)/s);
  assert.match(theme, /\.admin \.tag[^{]*\{[^}]*background:\s*var\(--surface-alt\)/s);
  assert.match(theme, /\.admin \.tag[^{]*\{[^}]*color:\s*var\(--ink\)/s);
});

test("inventory row actions use theme surfaces for the adjustment form", async () => {
  const theme = await readFile(join(root, "css/theme.css"), "utf8");
  assert.match(theme, /\.admin \.inventory-actions[^{]*\{/);
  assert.match(theme, /\.admin \.inventory-action-form[^{]*\{[^}]*background:\s*var\(--surface-alt\)/s);
  assert.match(theme, /\.admin \.inventory-action-form[^{]*\{[^}]*border:\s*1px\s+solid\s+var\(--line\)/s);
});

test("admin CRUD action cells keep their buttons evenly spaced", async () => {
  const operations = await readFile(join(root, "css/operations.css"), "utf8");
  assert.match(operations, /\.admin \.table-wrap td:has\(> form\[data-admin-action=\"promotion-status\"\]\)/);
  assert.match(operations, /gap:\s*10px/);
});

test("admin collapse control lives in the sidebar and shares the page background token", async () => {
  const admin = await readFile(join(root, "admin.html"), "utf8");
  const theme = await readFile(join(root, "css/theme.css"), "utf8");
  const sidebar = admin.match(/<aside class="sidebar" id="side">([\s\S]*?)<\/aside>/)?.[1] || "";
  const head = admin.match(/<div class="admin-head">([\s\S]*?)<\/div>\s*<div id="admin-content">/)?.[1] || "";
  assert.match(sidebar, /id="sidebar-logo"/, "sidebar logo should be the collapse control");
  assert.doesNotMatch(admin, /id="collapse-side"|class="admin-collapse/, "separate collapse button should be removed");
  assert.doesNotMatch(head, /id="sidebar-logo"/, "sidebar logo should not move into the page header");
  assert.match(theme, /\.sidebar\s*\{[^}]*background:\s*var\(--admin-bg\)/s, "sidebar should use the same background token as admin content");
  assert.match(theme, /\.sidebar \.logo b\s*\{[^}]*color:\s*var\(--ink\)/s, "sidebar logo should remain readable in light mode");
});
