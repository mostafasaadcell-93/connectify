# Connectify Lebanon pricing audit

Checked 13 October 2026, 03:52–04:15 UTC. Production catalog at commit `2300c46`. No prices, stock, photos, checkout, or trade-in code were changed.

Customers see the live Supabase `store_state` prices. The phone units were last saved on 12 October 2026 at 10:35 UTC. Those saved prices match the in-code price list. There is no admin price override on phones or tablets. The only catalog override is the already-removed Hitachi listing. Purchase cost could not be read: the staff-only cost record does not come back with the public key. Every recommendation below is therefore a market comparison, not a margin calculation.

## What is actually for sale

29 phone and tablet variants have quantity above zero. Accessories were not priced. Unavailable and zero-quantity variants were not repriced. There is no in-stock Xiaomi, Redmi, Poco, Tecno, or Infinix phone or tablet.

## Urgent items

1. **Galaxy S25 Ultra, 256GB, Titanium Black, $796, note “Screen is broken.”** 961 tech sells a working used black 256GB unit for $930. A broken screen is not that product. Do not leave $796 in the normal used-phone price. Get a repair quote before choosing a new number. Purchase cost is unknown, so this audit does not invent a discount.

2. **Galaxy A07 is labeled 128GB with 12GB RAM at $222.** 961 tech’s A07 page has 4GB/64GB at $145, 4GB/128GB at $170, and 6GB/128GB at $225. It has no 12GB version. Confirm the RAM. If the phone is 6GB/128GB, $222 is already in line with the only shop price found.

3. **The iPad listed only as “M4 Pro” at $1,097.** Storage, color, Wi-Fi or cellular, and condition are missing. 961 tech’s 11-inch iPad Pro M4 is $920 for 256GB (out of stock) and $1,135 for 512GB (in stock). Those are different products. Do not change $1,097 until the unit is identified.

4. **iPhone 17 Pro Max, 256GB, New, Silver and Deep Blue, $1,462 each.** Verified physical-SIM shop prices are $1,545 at 961 tech (in stock, same price for Silver, Blue, and Orange) and $1,610 at both M2 and Mobileleb. Suggested price for both colors: **$1,542**. That is about 0.2% under the lowest matching shop. OutGeeked’s $1,470 is eSIM-only and is not the same phone. Do this only if the Connectify units are the nano-SIM + eSIM version already recorded on the units.

5. **Do not cut the used iPhones.** Where a matching used price exists, Connectify is already at or below it. Several of those units also have replaced glass, a replaced screen, or a battery under 80%.

6. **Galaxy S26 Ultra, 256GB, Black, New, $1,356 stays.** 961 tech is $1,340 and Mobileleb is $1,385. M2 is $1,150 for every 256GB color and in stock, but the page did not state the warranty. One low listing is not a reason to drop a price that already sits between the other two shops.

## Color prices

The phone stock system can already store a different price per color. It does not need a schema change. On the units in stock, colors that share storage and condition already have the same price, and the shops that published color rows charge the same sale price. iSTYLE lists iPhone 18 Pro Max Black and Burgundy at the same $1,829. The unused burgundy reference inside Connectify ($1,946 for 256GB versus $1,856 for Black) is not supported by that authorized listing. Do not add a burgundy premium from that reference.

## Trade-in, in one paragraph

The calculator is an estimate range, not a guaranteed purchase price. The base is 68% of an internal resale table, then condition and battery multipliers, then a band from 95% to 103%. Offers do not go negative. On the iPhones where 961 tech publishes a current used price, that shop price is higher than Connectify’s resale table, so clean phones are likely undervalued rather than overpaid. The cracked-screen cut is a flat 40% and is not tied to a repair invoice, so it can be too small on a cheap phone and too large on a flagship. Color does not change the quote, which matches the retail evidence collected here. No trade-in number was changed.

Full tables: Report A through Report E in this folder, plus the CSV exports.
