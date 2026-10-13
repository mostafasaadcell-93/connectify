# Report E — Implementation plan after approval

Nothing in this plan has been done. Accessories, quantities, photos, checkout, Supabase schema, and the trade-in calculator stay as they are until the owner approves a specific line.

## Selling prices

The price a customer pays for a phone unit is `store_state.units` price. Changing only the seed list would not change the live site, because the saved unit price is already filled in. Changing only Supabase would also drift from the seed the next time a unit is recreated without a price.

After approval, for each accepted line:

1. Set the unit price in the admin stock screen for that exact unit (model, color, storage, condition, SIM). That writes `store_state.units`. Do not change quantity.
2. Set the same number in the in-code price list key `model|color|storage|condition`, so a later empty unit does not fall back to the old number.
3. Leave every other unit alone. Silver and Deep Blue iPhone 17 Pro Max 256GB are two units. If both are approved at $1,542, change both. Do not add a color gap.
4. Do not create a burgundy price. The authorized listing does not support the $90 reference gap.

Catalog rows, if approved later, are `CX_PRICE` plus a check that `store_state.ph` still has no price override. Today it does not, except the Hitachi deletion.

Do not lower any approved price until the staff cost record for that unit is known. The public key cannot read it.

### Ready for a yes or no

| Decision | Proposed change |
| --- | --- |
| iPhone 17 Pro Max 256GB Silver, unit u12, qty 2 | $1,462 to $1,542 |
| iPhone 17 Pro Max 256GB Deep Blue, unit u13, qty 1 | $1,462 to $1,542 |
| Galaxy S25 Ultra unit u20 | Do not publish $796 as a normal used price. Choose a number only after a screen-repair quote and a look at cost. |
| Galaxy A07 cx57 | Correct the RAM label after the unit is checked. Leave $222 if it is 6GB/128GB. |
| iPad cx54 | Add storage, Wi-Fi or cellular, color, and condition to the existing variant label. Reprice only after that. |
| All other in-stock phones and tablets | No change. |

## Trade-in

Do not edit `TRADE_RATE`, the resale table, or the condition buttons in this step. When the owner wants that pass:

- Update resale references only where two shops agree, then let the existing 0.68 formula rebuild bases that were never hand-edited. Live values currently match the formula, so a rebuild would not wipe a custom edit today. The admin reset button does wipe custom edits. Avoid that button.
- Add dollar deductions only with invoices in hand.
- Keep the estimate wording. Do not present the range as a guaranteed buy price.
- Optional logic fix, separate from prices: if cracked screen and battery under 80% are both selected, show “Ask us” instead of a stacked percentage. That removes the unrealistic floor without pretending the percentage is a repair quote.

## What not to touch

Accessory prices, stock quantities, hidden or deleted products, photos, checkout, delivery copy, and the Supabase schema. The color-price feature already exists on phone units. No migration is required to charge Silver and Deep Blue the same new price, or to charge them differently later if the market starts to.
