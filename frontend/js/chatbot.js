(function (root, factory) {
  const chatbot = factory(root);
  if (typeof module === "object" && module.exports) module.exports = chatbot;
  if (root) root.MBChatbot = chatbot;
  if (root && root.document) {
    const mount = () => chatbot.mount(root.document);
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
      mount();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const allowedLinks = new Set(["products.html", "cart.html", "warranty.html", "consultation.html"]);
  const intents = [
    {
      intent: "products",
      words: ["san pham", "da kho", "da dau", "cham soc da"],
      text: "Bạn có thể xem danh sách sản phẩm và dùng bộ lọc để tìm theo nhu cầu chăm sóc da.",
      link: { href: "products.html", label: "Khám phá sản phẩm" }
    },
    {
      intent: "shipping",
      words: ["phi ship", "phi giao", "giao hang"],
      text: "Bạn có thể kiểm tra phí giao hàng do máy chủ xác nhận theo tỉnh/thành tại bước checkout.",
      link: { href: "cart.html", label: "Xem giỏ hàng" }
    },
    {
      intent: "orders",
      words: ["tra don", "don hang", "theo doi don"],
      text: "Bạn cần đăng nhập đúng tài khoản đã đặt hàng để xem trạng thái đơn.",
      link: { href: "warranty.html", label: "Tra cứu đơn hàng" }
    },
    {
      intent: "returns",
      words: ["doi tra", "bao hanh", "hoan tien"],
      text: "Thông tin hỗ trợ đổi trả và bảo hành được hướng dẫn tại trang Bảo hành & hỗ trợ.",
      link: { href: "warranty.html", label: "Bảo hành & hỗ trợ" }
    },
    {
      intent: "consultation",
      words: ["tu van", "dat lich", "chuyen vien"],
      text: "Đội ngũ Maison Belle có thể hỗ trợ tư vấn và đặt lịch chăm sóc.",
      link: { href: "consultation.html", label: "Đặt lịch tư vấn" }
    }
  ];
  const fallback = {
    intent: "unknown",
    text: "Mình chưa có thông tin chắc chắn cho câu hỏi này. Đội ngũ Maison Belle có thể hỗ trợ bạn trực tiếp.",
    link: { href: "consultation.html", label: "Liên hệ tư vấn" }
  };

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase("vi")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/\s+/g, " ");
  }

  function cloneReply(entry) {
    return {
      intent: entry.intent,
      text: entry.text,
      link: entry.link ? { href: entry.link.href, label: entry.link.label } : null
    };
  }

  function replyFor(question) {
    const normalized = normalize(question);
    const match = intents.find((entry) => entry.words.some((word) => normalized.includes(word)));
    return cloneReply(match || fallback);
  }

  // Gemini returns Markdown by default. Keep the widget intentionally plain text
  // so formatting markers cannot leak into the conversation or split a sentence.
  function cleanAssistantText(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/```(?:[\w-]+)?\n?/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*]\s+/gm, "• ")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .trim();
  }

  function appendMessage(container, text, kind) {
    const paragraph = container.ownerDocument.createElement("p");
    paragraph.className = kind === "user"
      ? "chatbot-message chatbot-message-user"
      : "chatbot-message chatbot-message-bot";
    paragraph.textContent = kind === "user" ? String(text ?? "") : cleanAssistantText(text);
    container.append(paragraph);
    return paragraph;
  }

  function safeImageUrl(value) {
    const url = String(value || "").trim();
    if (/^(https?:\/\/|\/|[a-z0-9_-]+\/)/i.test(url)) return url;
    return "img/skincare.jpg";
  }

  function formatPrice(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? `${amount.toLocaleString("vi-VN")}đ` : "Liên hệ";
  }

  function appendProductCards(container, products = [], document) {
    if (!Array.isArray(products) || !products.length) return;
    const list = makeProductElement(document, "div", "chatbot-product-list");
    for (const product of products.slice(0, 8)) {
      const card = makeProductElement(document, "article", "chatbot-product-card");
      const image = makeProductElement(document, "img", "chatbot-product-image");
      image.src = safeImageUrl(product.imageUrl);
      image.alt = String(product.name || "Sản phẩm Maison Belle");
      image.loading = "lazy";
      image.width = 72;
      image.height = 72;
      const details = makeProductElement(document, "div", "chatbot-product-details");
      const name = makeProductElement(document, "strong", "chatbot-product-name", product.name || "Sản phẩm Maison Belle");
      const meta = makeProductElement(document, "span", "chatbot-product-meta", [product.brandName, product.categoryName].filter(Boolean).join(" · "));
      const variant = Array.isArray(product.variants) ? product.variants[0] : null;
      const price = makeProductElement(document, "span", "chatbot-product-price", formatPrice(variant?.retailPrice));
      const stock = makeProductElement(document, "span", `chatbot-product-stock${variant && Number(variant.availableQuantity) > 0 ? " is-available" : ""}`, variant && Number(variant.availableQuantity) > 0 ? `Còn ${variant.availableQuantity}` : "Tạm hết hàng");
      const link = document.createElement("a");
      link.className = "chatbot-product-link";
      link.href = `product.html?id=${encodeURIComponent(product.slug || product.id || "")}`;
      link.textContent = "Xem sản phẩm";
      details.append(name, meta, price, stock, link);
      card.append(image, details);
      list.append(card);
    }
    container.append(list);
  }

  function makeProductElement(document, tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    if (text !== undefined && text !== "") element.textContent = text;
    return element;
  }

  function mount(document) {
    if (!document || !document.body || document.body.dataset?.page === "admin") return false;
    if (document.querySelector("#mb-chatbot-panel")) return false;

    const makeElement = (tagName, className, text) => {
      const element = document.createElement(tagName);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const setAttributes = (element, attributes) => {
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      return element;
    };

    const launcher = setAttributes(makeElement("button", "chatbot-launcher"), {
      type: "button",
      "aria-controls": "mb-chatbot-panel",
      "aria-expanded": "false",
      "aria-label": "Mở trò chuyện với Maison Belle"
    });
    const launcherAvatar = setAttributes(makeElement("img", "chatbot-avatar"), {
      src: "img/maison-belle-chatbot.svg",
      alt: "",
      "aria-hidden": "true",
      width: "48",
      height: "48",
      decoding: "async"
    });
    const launcherCopy = makeElement("span", "chatbot-launcher-copy");
    launcherCopy.append(makeElement("span", "chatbot-launcher-eyebrow", "MAISON BELLE"));
    launcherCopy.append(makeElement("span", "chatbot-launcher-label", "Hỏi tư vấn"));
    const launcherStatus = makeElement("span", "chatbot-launcher-status");
    launcherStatus.setAttribute("aria-hidden", "true");
    launcher.append(launcherAvatar);
    launcher.append(launcherCopy);
    launcher.append(launcherStatus);
    const panel = setAttributes(makeElement("section", "chatbot-panel"), {
      id: "mb-chatbot-panel",
      role: "dialog",
      "aria-label": "Trợ lý Maison Belle"
    });
    panel.hidden = true;

    const panelHeader = makeElement("div", "chatbot-header");
    const panelIdentity = makeElement("div", "chatbot-identity");
    const panelAvatar = setAttributes(makeElement("img", "chatbot-avatar chatbot-avatar-header"), {
      src: "img/maison-belle-chatbot.svg",
      alt: "",
      "aria-hidden": "true",
      width: "40",
      height: "40",
      decoding: "async"
    });
    const titleGroup = makeElement("div", "chatbot-title-group");
    const title = makeElement("p", "chatbot-title", "Maison Belle · Hỗ trợ");
    const online = makeElement("span", "chatbot-online", "Đang online");
    titleGroup.append(title);
    titleGroup.append(online);
    panelIdentity.append(panelAvatar);
    panelIdentity.append(titleGroup);
    const close = setAttributes(makeElement("button", "chatbot-close", "×"), {
      type: "button",
      "aria-label": "Đóng trò chuyện"
    });
    panelHeader.append(panelIdentity);
    panelHeader.append(close);

    const log = setAttributes(makeElement("div", "chatbot-log"), {
      role: "log",
      "aria-live": "polite",
      "aria-relevant": "additions"
    });
    const initialMessage = appendMessage(log, "Xin chào! Mình có thể giúp bạn tìm thông tin về sản phẩm, đơn hàng và chính sách cửa hàng.", "bot");
    if (root.MBApi?.chatSettings) {
      root.MBApi.chatSettings().then((response) => {
        const settings = root.MBApi.data ? root.MBApi.data(response) : response?.data;
        if (settings?.greeting) initialMessage.textContent = cleanAssistantText(settings.greeting);
        if (settings?.enabled === false) {
          initialMessage.textContent = "Trợ lý Maison Belle đang tạm tắt. Bạn vẫn có thể xem sản phẩm trực tiếp trên cửa hàng.";
          launcher.disabled = true;
          launcher.setAttribute("aria-label", "Trợ lý Maison Belle đang tạm tắt");
        }
      }).catch(() => {});
    }

    const suggestions = makeElement("div", "chatbot-suggestions");
    const prompts = [
      { text: "Sản phẩm cho da khô", className: "chatbot-suggestion-products" },
      { text: "Phí giao hàng", className: "chatbot-suggestion-shipping" },
      { text: "Theo dõi đơn hàng", className: "chatbot-suggestion-orders" },
      { text: "Đổi trả", className: "chatbot-suggestion-returns" },
      { text: "Đặt lịch tư vấn", className: "chatbot-suggestion-consultation" }
    ];

    const conversation = [];
    const appendAnswer = (answer, products = []) => {
      appendMessage(log, answer.text, "bot");
      if (answer.link && allowedLinks.has(answer.link.href)) {
        const link = setAttributes(makeElement("a", "chatbot-answer-link", answer.link.label), {
          href: answer.link.href
        });
        log.append(link);
      }
      appendProductCards(log, products, document);
      log.scrollTop = log.scrollHeight;
    };
    const answerQuestion = (question) => {
      const localAnswer = replyFor(question);
      if (!root.MBApi?.chat) {
        appendAnswer(localAnswer);
        return;
      }
      const answerMessage = appendMessage(log, "Đang tìm câu trả lời…", "bot");
      const history = conversation.slice(-8);
      conversation.push({ role: "user", text: question });
      root.MBApi.chat({ message: question, history }).then((response) => {
        const payload = root.MBApi.data ? root.MBApi.data(response) : response?.data;
        const answer = payload?.message ? { ...localAnswer, text: payload.message, link: null } : localAnswer;
        const cleanAnswer = cleanAssistantText(answer.text);
        answerMessage.textContent = cleanAnswer;
        conversation.push({ role: "model", text: cleanAnswer });
        if (answer.link && allowedLinks.has(answer.link.href)) {
          const link = setAttributes(makeElement("a", "chatbot-answer-link", answer.link.label), { href: answer.link.href });
          log.append(link);
        }
        appendProductCards(log, payload?.products, document);
        log.scrollTop = log.scrollHeight;
      }).catch(() => {
        const cleanAnswer = cleanAssistantText(localAnswer.text);
        answerMessage.textContent = cleanAnswer;
        conversation.push({ role: "model", text: cleanAnswer });
        if (localAnswer.link && allowedLinks.has(localAnswer.link.href)) {
          const link = setAttributes(makeElement("a", "chatbot-answer-link", localAnswer.link.label), { href: localAnswer.link.href });
          log.append(link);
        }
        log.scrollTop = log.scrollHeight;
      });
    };

    for (const prompt of prompts) {
      const button = setAttributes(makeElement("button", `chatbot-suggestion ${prompt.className}`, prompt.text), {
        type: "button",
        "aria-label": `Câu hỏi gợi ý: ${prompt.text}`
      });
      button.addEventListener("click", () => {
        appendMessage(log, prompt.text, "user");
        answerQuestion(prompt.text);
      });
      suggestions.append(button);
    }

    const form = makeElement("form", "chatbot-form");
    const label = setAttributes(makeElement("label", "chatbot-label", "Câu hỏi"), {
      for: "mb-chatbot-question"
    });
    const input = setAttributes(makeElement("input", "chatbot-question"), {
      id: "mb-chatbot-question",
      name: "question",
      type: "text",
      maxlength: "500",
      autocomplete: "off",
      required: ""
    });
    input.placeholder = "Nhập câu hỏi của bạn";
    const submit = setAttributes(makeElement("button", "chatbot-send", "Gửi"), {
      type: "submit"
    });
    form.append(label);
    form.append(input);
    form.append(submit);

    const closePanel = () => {
      panel.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
    };
    const openPanel = () => {
      panel.hidden = false;
      launcher.setAttribute("aria-expanded", "true");
      input.focus();
    };

    launcher.addEventListener("click", () => {
      if (panel.hidden) openPanel();
      else closePanel();
    });
    close.addEventListener("click", closePanel);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) closePanel();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = String(input.value ?? "").trim();
      if (!question) return;
      appendMessage(log, question, "user");
      input.value = "";
      answerQuestion(question);
    });

    panel.append(panelHeader);
    panel.append(log);
    panel.append(suggestions);
    panel.append(form);
    document.body.append(launcher);
    document.body.append(panel);
    return true;
  }

  return { replyFor, appendMessage, mount };
});
