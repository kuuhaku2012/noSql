(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MBApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  class ApiError extends Error {
    constructor(message, { status = 0, code = "NETWORK_ERROR", details = [], requestId = "" } = {}) {
      super(message || "Không thể kết nối máy chủ.");
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
    }
  }

  const encode = (value) => encodeURIComponent(String(value));

  function createApi(fetchImpl = (...args) => fetch(...args)) {
    async function request(path, { method = "GET", body, query, signal } = {}) {
      const params = new URLSearchParams();
      Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") params.set(key, value);
      });
      const url = path + (params.size ? "?" + params.toString() : "");
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          credentials: "same-origin",
          headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal
        });
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        throw new ApiError("Không kết nối được máy chủ. Vui lòng thử lại.", { code: "NETWORK_ERROR" });
      }

      let payload = null;
      if (response.status !== 204) {
        try { payload = await response.json(); }
        catch { payload = null; }
      }
      if (!response.ok) {
        const problem = payload?.error || {};
        throw new ApiError(problem.message || `Yêu cầu thất bại (${response.status}).`, {
          status: response.status,
          code: problem.code || "REQUEST_FAILED",
          details: problem.details || [],
          requestId: payload?.requestId || ""
        });
      }
      return payload;
    }

    const get = (path, query) => request(path, { query });
    const send = (method, path, body) => request(path, { method, body });
    const idPath = (path, id) => `${path}/${encode(id)}`;

    return {
      ApiError,
      request,
      data: (response) => response?.data ?? response,
      list: (response) => ({ items: Array.isArray(response?.data) ? response.data : [], pagination: response?.pagination || null }),
      health: () => get("/api/health"),
      catalog: () => get("/api/catalog"),
      promotions: { list: (query) => get("/api/promotions", query) },
      flashSales: { list: (query) => get("/api/flash-sales", query) },
      products: (query = {}) => get("/api/products", query),
      product: (id) => get(idPath("/api/products", id)),
      auth: {
        login: (body) => send("POST", "/api/auth/login", body),
        register: (body) => send("POST", "/api/auth/register", body),
        me: () => get("/api/auth/me"),
        logout: () => send("POST", "/api/auth/logout", {})
      },
      cart: {
        get: () => get("/api/cart"),
        update: (body) => send("PUT", "/api/cart", body)
      },
      shipping: {
        rates: () => get("/api/shipping/rates"),
        quote: (body) => send("POST", "/api/shipping/quote", body)
      },
      validateVoucher: (body) => send("POST", "/api/vouchers/validate", body),
      orders: {
        create: (body) => send("POST", "/api/orders", body),
        list: (query) => get("/api/orders", query),
        get: (id) => get(idPath("/api/orders", id)),
        payment: (id, body) => send("POST", idPath("/api/orders", id) + "/payment", body),
        updateStatus: (id, body) => request(idPath("/api/orders", id) + "/status", { method: "PATCH", body })
      },
      appointments: {
        list: (query) => get("/api/appointments", query),
        availability: (query) => get("/api/appointments/availability", query),
        create: (body) => send("POST", "/api/appointments", body),
        update: (id, body) => request(idPath("/api/appointments", id), { method: "PATCH", body })
      },
      customers: {
        me: () => get("/api/customers/me"),
        updateProfile: (body) => request("/api/customers/me", { method: "PATCH", body }),
        loyalty: () => get("/api/customers/me/loyalty"),
        addresses: {
          list: () => get("/api/customers/me/addresses"),
          create: (body) => send("POST", "/api/customers/me/addresses", body),
          update: (id, body) => request(idPath("/api/customers/me/addresses", id), { method: "PATCH", body }),
          remove: (id) => request(idPath("/api/customers/me/addresses", id), { method: "DELETE" })
        }
      },
      returns: {
        list: (query) => get("/api/returns", query),
        create: (body) => send("POST", "/api/returns", body)
      },
      admin: {
        shippingRates: {
          list: () => get("/api/admin/shipping-rates"),
          create: (body) => send("POST", "/api/admin/shipping-rates", body),
          update: (id, body) => request(idPath("/api/admin/shipping-rates", id), { method: "PATCH", body }),
          remove: (id) => request(idPath("/api/admin/shipping-rates", id), { method: "DELETE" })
        },
        products: {
          list: (query) => get("/api/admin/products", query),
          create: (body) => send("POST", "/api/admin/products", body),
          update: (id, body) => request(idPath("/api/admin/products", id), { method: "PATCH", body }),
          remove: (id) => request(idPath("/api/admin/products", id), { method: "DELETE" })
        },
        catalog: {
          list: () => get("/api/admin/catalog"),
          create: (kind, body) => send("POST", idPath("/api/admin/catalog", kind), body),
          update: (kind, id, body) => request(idPath(idPath("/api/admin/catalog", kind), id), { method: "PATCH", body }),
          remove: (kind, id) => request(idPath(idPath("/api/admin/catalog", kind), id), { method: "DELETE" })
        },
        customers: { list: (query) => get("/api/admin/customers", query) },
        inventory: () => get("/api/admin/inventory"),
        receiveStock: (body) => send("POST", "/api/admin/stock-receipts", body),
        adjustStock: (body) => send("POST", "/api/admin/stock-adjustments", body),
        promotions: {
          list: (query) => get("/api/admin/promotions", query),
          create: (body) => send("POST", "/api/admin/promotions", body),
          update: (id, body) => request(idPath("/api/admin/promotions", id), { method: "PATCH", body }),
          remove: (id) => request(idPath("/api/admin/promotions", id), { method: "DELETE" })
        },
        flashSales: {
          list: (query) => get("/api/admin/flash-sales", query),
          create: (body) => send("POST", "/api/admin/flash-sales", body),
          update: (id, body) => request(idPath("/api/admin/flash-sales", id), { method: "PATCH", body }),
          remove: (id) => request(idPath("/api/admin/flash-sales", id), { method: "DELETE" })
        },
        vouchers: {
          list: (query) => get("/api/admin/vouchers", query),
          get: (id) => get(idPath("/api/admin/vouchers", id)),
          create: (body) => send("POST", "/api/admin/vouchers", body),
          update: (id, body) => request(idPath("/api/admin/vouchers", id), { method: "PATCH", body }),
          remove: (id) => request(idPath("/api/admin/vouchers", id), { method: "DELETE" })
        },
        deliveries: {
          list: (query) => get("/api/admin/deliveries", query),
          create: (body) => send("POST", "/api/admin/deliveries", body),
          update: (id, body) => request(idPath("/api/admin/deliveries", id), { method: "PATCH", body })
        },
        returns: {
          list: (query) => get("/api/admin/returns", query),
          create: (body) => send("POST", "/api/admin/returns", body),
          update: (id, body) => request(idPath("/api/admin/returns", id), { method: "PATCH", body })
        },
        reports: (query) => get("/api/admin/reports", query)
      }
    };
  }

  return { ApiError, createApi, ...createApi() };
});
