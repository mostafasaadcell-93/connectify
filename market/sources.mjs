/* Public catalog endpoints already used by each store's own shop.
   Phonefinity's robots file disallows /?rest_route=, so this list uses /wp-json/ only. */

export const SOURCES = [
  {id: "class", name: "Class Cellulars", kind: "woo", origin: "https://classcellulars.com", endpoint: "https://classcellulars.com/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "najem", name: "Najem Starcall", kind: "woo", origin: "https://najemstarcall.com", endpoint: "https://najemstarcall.com/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "phonefinity", name: "Phonefinity", kind: "woo", origin: "https://phonefinity.net", endpoint: "https://phonefinity.net/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "abedtahan", name: "Abed Tahan", kind: "shopify", origin: "https://abedtahan.com", endpoint: "https://abedtahan.com/products.json", currency: "USD"},
  {id: "gadgetlb", name: "Gadgetlb", kind: "shopify", origin: "https://gadgetlb.com", endpoint: "https://gadgetlb.com/products.json", currency: "USD"},
  {id: "bms", name: "BMS", kind: "shopify", origin: "https://lb.bmsmena.com", endpoint: "https://lb.bmsmena.com/products.json", currency: "USD", brandAllow: ["samsung"]}
];
