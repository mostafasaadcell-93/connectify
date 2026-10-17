# Report A — Current Connectify catalog

Scope: phones and tablets with quantity above zero on 13 October 2026. Accessories are excluded. Ask-for-availability and zero-quantity variants are excluded.

## How the price the customer sees is chosen

Phone units in `store_state.units` have their own price. That price is what goes into the cart. It was last written on 12 October 2026 at 10:35 UTC. For all 23 in-stock units it is the same number as the in-code price list (`CX_UPRICE`). If the unit price were empty, the product page would show a reference price and tell the customer the final price is confirmed on WhatsApp. That fallback is not what these 23 units use.

The reference table can store a color price. It does so only for iPhone 18 Pro and iPhone 18 Pro Max, and only for Burgundy and Black. The in-stock Black units are priced from the unit record, which happens to match the Black reference. The Burgundy reference is not on a unit anyone can buy.

Catalog phones and tablets (Galaxy A07, Galaxy A17, Galaxy Tab A11, and the iPad) take their price from `CX_PRICE` because the variant price in the product row is empty. The live admin overlay does not replace those prices. The only live catalog override is a deletion flag on the removed Hitachi item.

Warranty text comes from the live store content, updated 12 October 2026 at 16:20 UTC:

- New: 1 year official warranty
- Open box: 1 year warranty
- Like new: 6 months warranty
- Used: 3 months warranty
- Refurbished: 6 months warranty

No in-stock phone is open-box, like-new, or refurbished. The Fold7 note “With warranty” does not change the used warranty field by itself.

Purchase cost is staff-only. The public read returned no cost row. Margin is unknown on every line.

## In-stock phone units

| Unit | Model | Storage | Color | Condition | SIM | Qty | Battery | Price | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| u1 | iPhone 14 Pro | 256GB | Space Black | Used | Dual nano-SIM | 1 | not recorded | $585 | |
| u2 | Galaxy Z Fold7 | 512GB | Jetblack | Used | Nano-SIM + eSIM | 1 | not recorded | $1,163 | |
| u3 | iPhone 15 Pro Max | 256GB | Natural Titanium | Used | Nano-SIM + eSIM | 1 | 85% | $795 | Back glass replaced |
| u4 | Galaxy Z Fold7 | 256GB | Jetblack | Used | Nano-SIM + eSIM | 1 | not recorded | $1,047 | With warranty |
| u5 | iPhone 13 | 128GB | Pink | Used | Nano-SIM + eSIM | 1 | 88% | $321 | |
| u6 | iPhone 14 | 128GB | Purple | Used | Nano-SIM + eSIM | 1 | 80% | $395 | |
| u7 | iPhone 14 Pro Max | 256GB | Space Black | Used | Nano-SIM + eSIM | 1 | not recorded | $676 | |
| u8 | iPhone 13 Pro | 256GB | Sierra Blue | Used | Nano-SIM + eSIM | 1 | not recorded | $461 | |
| u9 | iPhone 12 Pro | 512GB | Pacific Blue | Used | Nano-SIM + eSIM | 1 | not recorded | $329 | Screen and speaker replaced. Color should be confirmed |
| u10 | Galaxy S26 Ultra | 256GB | Black | New | Nano-SIM + eSIM | 1 | 100% | $1,356 | |
| u11 | iPhone 15 Pro Max | 256GB | Black Titanium | Used | Nano-SIM + eSIM | 1 | 86% | $795 | Light screen scratches |
| u12 | iPhone 17 Pro Max | 256GB | Silver | New | Nano-SIM + eSIM | 2 | 100% | $1,462 | Never activated |
| u13 | iPhone 17 Pro Max | 256GB | Deep Blue | New | Nano-SIM + eSIM | 1 | 100% | $1,462 | Never activated |
| u14 | iPhone 15 Pro Max | 512GB | Black Titanium | Used | Nano-SIM + eSIM | 1 | not recorded | $839 | |
| u15 | iPhone 12 Pro Max | 256GB | Graphite | Used | Nano-SIM + eSIM | 1 | not recorded | $371 | |
| u16 | iPhone 13 Pro | 128GB | Alpine Green | Used | Nano-SIM + eSIM | 1 | 74% | $428 | |
| u17 | iPhone 13 Pro Max | 128GB | Graphite | Used | Nano-SIM + eSIM | 1 | 75% | $475 | Screen and camera replaced |
| u18 | iPhone 18 Pro Max | 256GB | Black | New | Nano-SIM + eSIM | 1 | 100% | $1,856 | Never activated |
| u19 | iPhone 17 Pro Max | 512GB | Silver | Used | Nano-SIM + eSIM | 1 | 95% | $1,385 | |
| u20 | Galaxy S25 Ultra | 256GB | Titanium Black | Used | Nano-SIM + eSIM | 1 | not recorded | $796 | Screen is broken |
| u21 | iPhone Air | 256GB | Space Black | Used | eSIM only | 1 | not recorded | $945 | |
| u22 | iPhone 13 Pro Max | 256GB | Graphite | Used | Nano-SIM + eSIM | 1 | 76% | $519 | Screen and camera replaced |
| u23 | iPhone 18 Pro Max | 512GB | Black | New | Nano-SIM + eSIM | 1 | 100% | $2,120 | Never activated |

RAM is not stored on these phone units. Generation defaults (for example 12GB on iPhone 17 Pro Max) are not written on the unit.

## In-stock catalog phones and tablets

| ID | Product | Variant in stock | Qty | Price | Source |
| --- | --- | --- | --- | --- | --- |
| cx57 | Galaxy A07 | 128GB, listed as 12GB RAM. Color and condition not stated | 1 | $222 | CX_PRICE |
| cx58 | Galaxy A17 | 128GB, 4GB, Black | 1 | $212 | CX_PRICE |
| cx58 | Galaxy A17 | 128GB, 6GB, New, Black | 1 | $246 | CX_PRICE |
| cx2 | Galaxy Tab A11 | Gray, 8GB/128GB, New. Wi-Fi or LTE not stated | 1 | $197 | CX_PRICE |
| cx2 | Galaxy Tab A11 | Gray, 4GB/64GB, New. Wi-Fi or LTE not stated | 1 | $137 | CX_PRICE |
| cx54 | iPad | “M4 Pro” only | 1 | $1,097 | CX_PRICE |

Silver Tab A11 variants are quantity 0 and are out of this phase. Galaxy A54 and the other zero-quantity phone rows were not repriced.

## Pricing limitation that does not need a schema change

Phone stock already prices color, storage, condition, and SIM as separate units. Catalog variants already have their own price slots. The gap is data, not structure: several units have no battery, the A07 RAM label does not match any shop configuration found, and the iPad row does not name storage or connectivity. A safe later step, after approval, is to fill those fields in the existing variant labels and unit notes. No new column is required for the phones that are in stock.

Machine-readable copy: `report-a-catalog.csv`.
