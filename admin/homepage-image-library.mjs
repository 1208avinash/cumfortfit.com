export const HOMEPAGE_IMAGE_LIBRARY = [
  { path: "assets/hero-emerald.webp", group: "website", description: "Emerald couture hero" },
  { path: "assets/stitching-poster.webp", group: "website", description: "Embroidery process poster" },
  { path: "assets/custom-fit-prime-logo.png", group: "website", description: "Custom Fit Prime logo" },
  { path: "assets/ad-first-frame.jpg", group: "website", description: "Elegance title card" },
  { path: "contact-sheet.jpg", group: "website", description: "Fashion image contact sheet" },
  { path: "catalogue-contact-sheet.jpg", group: "website", description: "Lookbook boards contact sheet" },
  { path: "assets/blouse-back.webp", group: "products", description: "Blue embroidered blouse back" },
  { path: "assets/blue-blouse.webp", group: "products", description: "Blue embroidered blouse" },
  { path: "assets/bridal-details.webp", group: "products", description: "Red bridal detail" },
  { path: "assets/bridal-fitting.webp", group: "products", description: "Red bridal fitting portrait" },
  { path: "assets/bridal-lehenga.webp", group: "products", description: "Red bridal lehenga" },
  { path: "assets/bridal-neckline.webp", group: "products", description: "Embroidered bridal neckline" },
  { path: "assets/chikankari-detail.webp", group: "products", description: "Ivory chikankari detail" },
  { path: "assets/chikankari-kurta.webp", group: "products", description: "Ivory chikankari kurta" },
  { path: "assets/designer-blouse.webp", group: "products", description: "Blue designer blouse" },
  { path: "assets/emerald-anarkali.webp", group: "products", description: "Emerald anarkali" },
  { path: "assets/festive-anarkali.webp", group: "products", description: "Mustard festive outfit" },
  { path: "assets/gharara-embroidered.webp", group: "products", description: "Embroidered gharara" },
  { path: "assets/ivory-chikankari.webp", group: "products", description: "Ivory chikankari outfit" },
  { path: "assets/saree-craft.webp", group: "products", description: "Ivory embroidered saree" },
  { path: "assets/sari-embroidery.webp", group: "products", description: "Red and green embroidered sari" },
  { path: "assets/teal-occasionwear.webp", group: "products", description: "Teal occasionwear" },
  { path: "assets/zardozi-detail.webp", group: "products", description: "Blue zardozi detail" },
  ...Array.from({ length: 22 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      path: `assets/lookbook/blouse-look-${number}.webp`,
      group: "lookbook",
      description: `Blouse design board ${number}`,
    };
  }),
];
