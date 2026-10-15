// Default regions shown by the checkout when a shop has not imported custom rates yet.
// Fees are editable from Admin > Cửa hàng & phí giao; these records only make every
// province/city selectable out of the box.
export const DEFAULT_SHIPPING_FEE = 30000;

export const SHIPPING_REGIONS = [
  ["an-giang", "An Giang"],
  ["ba-ria-vung-tau", "Bà Rịa - Vũng Tàu"],
  ["bac-giang", "Bắc Giang"],
  ["bac-kan", "Bắc Kạn"],
  ["bac-lieu", "Bạc Liêu"],
  ["bac-ninh", "Bắc Ninh"],
  ["ben-tre", "Bến Tre"],
  ["binh-dinh", "Bình Định"],
  ["binh-duong", "Bình Dương"],
  ["binh-phuoc", "Bình Phước"],
  ["binh-thuan", "Bình Thuận"],
  ["ca-mau", "Cà Mau"],
  ["cao-bang", "Cao Bằng"],
  ["can-tho", "Cần Thơ"],
  ["da-nang", "Đà Nẵng"],
  ["dak-lak", "Đắk Lắk"],
  ["dak-nong", "Đắk Nông"],
  ["dien-bien", "Điện Biên"],
  ["dong-nai", "Đồng Nai"],
  ["dong-thap", "Đồng Tháp"],
  ["gia-lai", "Gia Lai"],
  ["ha-giang", "Hà Giang"],
  ["ha-nam", "Hà Nam"],
  ["ha-noi", "Hà Nội"],
  ["ha-tinh", "Hà Tĩnh"],
  ["hai-duong", "Hải Dương"],
  ["hai-phong", "Hải Phòng"],
  ["hau-giang", "Hậu Giang"],
  ["hoa-binh", "Hòa Bình"],
  ["hung-yen", "Hưng Yên"],
  ["khanh-hoa", "Khánh Hòa"],
  ["kien-giang", "Kiên Giang"],
  ["kon-tum", "Kon Tum"],
  ["lai-chau", "Lai Châu"],
  ["lam-dong", "Lâm Đồng"],
  ["lang-son", "Lạng Sơn"],
  ["lao-cai", "Lào Cai"],
  ["long-an", "Long An"],
  ["nam-dinh", "Nam Định"],
  ["nghe-an", "Nghệ An"],
  ["ninh-binh", "Ninh Bình"],
  ["ninh-thuan", "Ninh Thuận"],
  ["phu-tho", "Phú Thọ"],
  ["phu-yen", "Phú Yên"],
  ["quang-binh", "Quảng Bình"],
  ["quang-nam", "Quảng Nam"],
  ["quang-ngai", "Quảng Ngãi"],
  ["quang-ninh", "Quảng Ninh"],
  ["quang-tri", "Quảng Trị"],
  ["soc-trang", "Sóc Trăng"],
  ["son-la", "Sơn La"],
  ["tay-ninh", "Tây Ninh"],
  ["thai-binh", "Thái Bình"],
  ["thai-nguyen", "Thái Nguyên"],
  ["thanh-hoa", "Thanh Hóa"],
  ["thua-thien-hue", "Thừa Thiên Huế"],
  ["tien-giang", "Tiền Giang"],
  ["ho-chi-minh", "Thành phố Hồ Chí Minh"],
  ["tra-vinh", "Trà Vinh"],
  ["tuyen-quang", "Tuyên Quang"],
  ["vinh-long", "Vĩnh Long"],
  ["vinh-phuc", "Vĩnh Phúc"],
  ["yen-bai", "Yên Bái"]
].map(([code, regionName]) => ({ code, regionName }));

export async function ensureDefaultShippingRates(db) {
  const shippingRates = db.collection("shipping_rates");
  const operations = SHIPPING_REGIONS.map(({ code, regionName }) => ({
    updateOne: {
      filter: { code },
      update: {
        $setOnInsert: {
          code,
          regionName,
          fee: DEFAULT_SHIPPING_FEE,
          currency: "VND",
          isActive: true,
          isDemo: false,
          source: "system-default",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      },
      upsert: true
    }
  }));
  if (operations.length) await shippingRates.bulkWrite(operations, { ordered: false });
  return SHIPPING_REGIONS.length;
}
