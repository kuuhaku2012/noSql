(function (root, factory) {
  const chatbot = factory();
  if (typeof module === "object" && module.exports) module.exports = chatbot;
  if (root) root.MBChatbot = chatbot;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
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

  function appendMessage(container, text, kind) {
    const paragraph = container.ownerDocument.createElement("p");
    paragraph.className = kind === "user"
      ? "chatbot-message chatbot-message-user"
      : "chatbot-message chatbot-message-bot";
    paragraph.textContent = String(text ?? "");
    container.append(paragraph);
    return paragraph;
  }

  function mount() {
    return false;
  }

  return { replyFor, appendMessage, mount };
});
