/* Reads the phone catalog already published in index.html. It does not change prices. */

export function catalogFromHtml(html) {
  const models = new Map();
  for (const match of String(html).matchAll(/M\("([^"]+)","([^"]+)"/g)) models.set(match[1], {name: match[2], brand: "apple"});
  for (const match of String(html).matchAll(/GX\("([^"]+)","([^"]+)"/g)) models.set(match[1], {name: match[2], brand: "samsung"});
  const unitsMatch = String(html).match(/window\.CX_UNITS=(\[[\s\S]*?\]);/);
  const priceMatch = String(html).match(/window\.CX_UPRICE=(\{[\s\S]*?\});/);
  if (!unitsMatch) return [];
  const units = JSON.parse(unitsMatch[1]);
  const prices = priceMatch ? JSON.parse(priceMatch[1]) : {};
  return units.map((unit, index) => {
    const model = models.get(unit.m) || {name: unit.m, brand: null};
    const price = Number(prices[unit.m + "|" + unit.c + "|" + unit.st + "|" + unit.cond]);
    return {
      sku: "unit:u" + (index + 1),
      kind: "phone",
      ref: {unit: "u" + (index + 1)},
      title: model.name,
      detail: [unit.st + "GB", unit.c, unit.cond, unit.sim].filter(Boolean).join(", "),
      price: price > 0 ? price : null,
      cost: null,
      specs: {
        brand: model.brand,
        model: unit.m,
        storage: unit.st,
        ram: null,
        condition: unit.cond,
        sim: unit.sim,
        color: String(unit.c || "").toLowerCase(),
        warrantyYears: null,
        region: null
      }
    };
  }).filter(row => row.specs.model);
}
