import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import { createAuthEmailCodeService } from "./services/auth-email-codes.js";
import { createSmtpMailer } from "./services/smtp-mailer.js";
import { getConfig } from "./config.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { authRouter } from "./routes/auth.js";
import { productsRouter } from "./routes/products.js";
import { adminProductsRouter } from "./routes/admin-products.js";
import { cartRouter } from "./routes/cart.js";
import { vouchersRouter } from "./routes/vouchers.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { ordersRouter } from "./routes/orders.js";
import { adminInventoryRouter } from "./routes/admin-inventory.js";
import { adminPromotionsRouter } from "./routes/admin-promotions.js";
import { adminVouchersRouter } from "./routes/admin-vouchers.js";
import { adminDeliveriesRouter } from "./routes/admin-deliveries.js";
import { adminReturnsRouter } from "./routes/admin-returns.js";
import { adminReportsRouter } from "./routes/admin-reports.js";
import { catalogRouter } from "./routes/catalog.js";
import { adminCatalogRouter } from "./routes/admin-catalog.js";
import { adminUsersRouter } from "./routes/admin-users.js";
import { adminFinanceRouter } from "./routes/admin-finance.js";
import { customersRouter, adminCustomersRouter } from "./routes/customers.js";
import { promotionsRouter } from "./routes/promotions.js";
import { returnsRouter } from "./routes/returns.js";
import { reviewsRouter } from "./routes/reviews.js";
import { engagementRouter } from "./routes/engagement.js";
import { wishlistsRouter } from "./routes/wishlists.js";
import { userVouchersRouter } from "./routes/user-vouchers.js";
import { flashSalesRouter } from "./routes/flash-sales.js";
import { shippingRouter } from "./routes/shipping.js";
import { adminShippingRatesRouter } from "./routes/admin-shipping-rates.js";
import { adminKnowledgeRouter, chatRouter } from "./routes/knowledge.js";

function toPath(value) {
  return value instanceof URL ? fileURLToPath(value) : value;
}

export function createApp({ db = null, config = getConfig(), mailer: injectedMailer } = {}) {
  const app = express();
  const api = express.Router();

  const trustProxy = config.trustProxy === undefined || config.trustProxy === null || config.trustProxy === false
    ? false
    : getConfig({ TRUST_PROXY: config.trustProxy }).trustProxy;
  app.set("trust proxy", trustProxy);

  app.use((req, res, next) => {
    req.requestId = req.header("x-request-id") || crypto.randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  api.get("/health", (_req, res) => {
    res.json({ data: { status: "ok" } });
  });

  if (db) {
    const mailer = injectedMailer || createSmtpMailer(config);
    const authEmailCodes = createAuthEmailCodeService({ db, mailer, secret: config.authCodeSecret });
    api.use("/auth", authRouter({ db, config, authEmailCodes }));
    api.use("/products", productsRouter({ db }));
    api.use("/", reviewsRouter({ db }));
    api.use("/", engagementRouter({ db }));
    api.use("/", wishlistsRouter({ db }));
    api.use("/", userVouchersRouter({ db }));
    api.use("/", flashSalesRouter({ db }));
    api.use("/catalog", catalogRouter({ db }));
    api.use("/promotions", promotionsRouter({ db }));
    api.use("/cart", cartRouter({ db }));
    api.use("/vouchers", vouchersRouter({ db }));
    api.use("/appointments", appointmentsRouter({ db }));
    api.use("/orders", ordersRouter({ db }));
    api.use("/shipping", shippingRouter({ db }));
    api.use("/chat", chatRouter({ db, config }));
    api.use("/customers", customersRouter({ db }));
    api.use("/returns", returnsRouter({ db }));
    api.use("/admin/products", adminProductsRouter({ db }));
    api.use("/admin/shipping-rates", adminShippingRatesRouter({ db }));
    api.use("/admin/catalog", adminCatalogRouter({ db }));
    api.use("/admin/users", adminUsersRouter({ db }));
    api.use("/admin/customers", adminCustomersRouter({ db }));
    api.use("/admin", adminInventoryRouter({ db }));
    api.use("/admin/promotions", adminPromotionsRouter({ db }));
    api.use("/admin/vouchers", adminVouchersRouter({ db }));
    api.use("/admin/deliveries", adminDeliveriesRouter({ db }));
    api.use("/admin/returns", adminReturnsRouter({ db }));
    api.use("/admin/reports", adminReportsRouter({ db }));
    api.use("/admin", adminFinanceRouter({ db }));
    api.use("/admin/knowledge", adminKnowledgeRouter({ db }));
  }

  app.use("/api", api);
  app.use(express.static(toPath(config.frontendRoot)));
  app.use("/api", notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.db = db;
  app.locals.config = config;
  return app;
}
