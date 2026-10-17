# Report D — Trade-in analysis

The calculator was not changed. Live trade values were read on 13 October 2026. They match the formula in the site exactly. The trade record was last saved on 9 October 2026 and has not been edited away from that formula.

## What the customer is quoted

This is an estimate, not a guaranteed purchase price. The note on the form says the final value is confirmed after a check.

For a chosen model and storage:

1. Base = the saved trade table for that model and storage.
2. Condition multiplier: Like new 1.00, light scratches 0.85, cracked screen 0.60.
3. Battery multiplier: 90% or more 1.00, 80–89% 0.93, under 80% 0.84.
4. The screen shows 95% to 103% of base × condition × battery, rounded to $5.
5. If the base is missing, the screen says “Ask us.”

The saved base itself is `round to $5 of (resale reference × 0.68)`. The comment in the code says iPhone resale numbers came from a Beirut shop’s October price list, and that missing storages and all Samsung numbers are estimates. A flag on the model records which Apple IDs were treated as sourced. Samsung is not in that flag. Newer storages that are not in the table are filled by interpolating about 11% per storage step.

Color, SIM type, replaced parts, and iCloud or blacklist status do not change the number. The customer types the condition. There is no photo step before the quote.

## Does the math go negative?

No, as long as the base and the multipliers stay at or above zero. They do today. The hardest stack is cracked screen × battery under 80% × the low end of the display band, which is about 48% of the base and about a third of the resale reference. A cracked, weak-battery iPhone 18 Pro Max 256GB still quotes about $505–$550. A cracked, weak-battery iPhone 13 128GB quotes about $105–$115. Those floors can be unrealistic in either direction: $505 may be too high if the 18 Pro Max is not worth repairing, and $105 may be too low or too high depending on the actual screen invoice. The formula does not look at a repair bill.

## Stocked models: base versus the shop’s own shelf and versus 961 tech

“Like new quote” is the 95–103% band with no damage and battery at 90% or better.

| Model and storage | Resale reference | Trade base | Like-new quote | Connectify shelf | 961 tech used, if verified |
| --- | --- | --- | --- | --- | --- |
| iPhone 14 Pro 256GB | $588 | $400 | $380–$410 | $585 used | $630 |
| iPhone 15 Pro Max 256GB | $799 | $545 | $520–$560 | $795, damaged | $860 like new |
| iPhone 15 Pro Max 512GB | $844 interpolated | $575 | $545–$590 | $839 | $890 like new |
| iPhone 14 Pro Max 256GB | $680 | $460 | $435–$475 | $676 | $680 |
| iPhone 13 128GB | $325 | $220 | $210–$225 | $321 | $380 |
| iPhone 13 Pro 128GB | $433 | $295 | $280–$305 | $428, battery 74% | $480 |
| iPhone 13 Pro 256GB | $466 | $315 | $300–$325 | $461 | $530 |
| iPhone 13 Pro Max 128GB | $480 | $325 | $310–$335 | $475, parts replaced | $575 |
| iPhone 13 Pro Max 256GB | $522 | $355 | $335–$365 | $519, parts replaced | $610 |
| iPhone 12 Pro Max 256GB | $375 | $255 | $240–$265 | $371 | $430 |
| iPhone 12 Pro 512GB | $333 interpolated | $225 | $215–$230 | $329, repaired | no 512GB offer |
| iPhone 14 128GB | $399 | $270 | $255–$280 | $395 | no offer found |
| iPhone 17 Pro Max 256GB | $1,250 | $850 | $810–$875 | $1,462 new | no used offer |
| iPhone 17 Pro Max 512GB | $1,388 interpolated | $945 | $900–$975 | $1,385 used | no used offer |
| iPhone 18 Pro Max 256GB | $1,550 | $1,055 | $1,000–$1,085 | $1,856 new | no used offer |
| iPhone 18 Pro Max 512GB | $1,721 interpolated | $1,170 | $1,110–$1,205 | $2,120 new | no used offer |
| iPhone Air 256GB | $950 | $645 | $615–$665 | $945 used | no used offer |
| Galaxy S26 Ultra 256GB | $1,050 estimated | $715 | $680–$735 | $1,356 new | no used offer |
| Galaxy S25 Ultra 256GB | $800 estimated | $545 | $520–$560 | $796, screen broken | $930 working used |
| Galaxy Z Fold7 256GB | $1,050 estimated | $715 | $680–$735 | $1,047 used | new list $1,700, out of stock |
| Galaxy Z Fold7 512GB | $1,166 interpolated | $795 | $755–$820 | $1,163 used | no used offer |

## Alignment with the used market

Where 961 tech has a current used price, Connectify’s resale reference is lower than that shop on almost every row. The 14 Pro Max 256GB reference ($680) matches the shop. The others are short by roughly $40 to $90. Because the trade base is 68% of that already-low reference, a clean phone is quoted well under what one retailer is asking.

That is undervaluation of the customer’s phone, not overpayment, for clean devices. Example: iPhone 13 128GB like-new quote is $210–$225, while 961 tech asks $380 and Connectify’s own shelf price is $321. Buying at $225 and selling near $321 still leaves about $96 before testing. Buying at $225 against a $380 shop ask leaves a wide gap. There is no verified completed-sale price, only asking prices, so this is not proof the quote is wrong. It is evidence the October resale table is behind at least one current shop.

The S25 Ultra trade quote for a like-new 256GB phone is $520–$560. A working used shop price is $930. The quote is about 60% of that shop price. That can be a sane buy price after test, risk, and profit, or it can be low. It should not be confused with the $796 shelf price of the broken unit, which is a sale price, not a trade-in price.

## Overpay risk

The risk is not the clean-phone quote. The risk is the flat deductions:

- Cracked screen is always 40% off, on a $220 base and on a $1,055 base. A screen does not cost 40% of every phone.
- Battery under 80% is always 16% off. On an iPhone 13 that is about $35. A battery service can cost more than $35. On an 18 Pro Max it is about $170, which may be closer to a real battery job. Neither figure was checked against an invoice.
- Light scratches (15% off) stack with the battery cut. A scratched phone with 85% battery is quoted at about 79% of the base before the 95–103% band.
- Replaced screen, replaced camera, and replaced back glass, which several stock units already have, are not options. A customer with a replaced screen can still pick “like new.”
- There is no “ask us” cutoff when the repair would consume the resale value.

Samsung bases and every interpolated storage are estimates. Treating them as firm buy prices would be the overpay risk on Fold7, S26 Ultra, S25 Ultra, and the 512GB steps that are not in the original table.

## Color

Retailers that published color rows charged one sale price for the colors checked, except a $10 gap on two S26 Ultra 512GB colors at M2 and strikethrough (not sale) differences at 961 tech. That is not enough to add color to trade-in. The used quotes should stay color-blind until a shop shows a real used-color gap.

## Logical bugs, separate from stale prices

1. Missing storages are invented at about 11% per doubling. iPhone 17 Pro Max 512GB, iPhone 15 Pro Max 512GB, iPhone 12 Pro 512GB, Fold7 512GB, and iPhone 18 Pro Max 512GB bases are interpolated.
2. Battery “0” on many stock units means not recorded. The trade form cannot see that, and it should not be read as 0% health.
3. The quote is self-reported. Account lock, blacklist, and non-original parts are in the store’s inspection list, but they are not in the calculator.
4. Galaxy A07, Galaxy A17, and tablets are not in the trade model list. Only Apple and Samsung phone models that have a resale row are.
5. iPhone Duo is excluded on purpose.
6. Admin reset rebuilds the table from the formula. A careful edit can be wiped by that reset.
7. The displayed high end is 103% of the adjusted base, so the quote can sit slightly above the saved base even for a clean phone.

## Recommended direction, not implemented

Do not paste new bases in until the owner accepts them. If the goal is “about two thirds of a realistic resale, then subtract a real repair,” the next edit is:

- Replace the resale reference with current Lebanese used asking prices from at least two shops, and keep a note that these are asks, not cleared sales.
- Keep 0.68 only as the starting buy rate for a clean phone with battery at 90% or better. On the rows above, that would raise clean-phone quotes, not cut them.
- Replace the flat 40% screen cut and 16% battery cut with a dollar deduction per model family, taken from invoices. Until those invoices exist, keep the percentages and show “Ask us” when both screen and battery are bad on a phone whose base is under $300, because the stacked quote becomes a small number that may not match a repair.
- Leave color out.
- Keep the on-screen sentence that the number is an estimate confirmed after inspection.

Suggested clean-phone bases, only as a research target if 961 tech remains the sole used source, would be `round to $5 of (that shop price × 0.68)`. That is one shop, so confidence is low. Examples: iPhone 13 128GB base about $260 instead of $220; iPhone 15 Pro Max 256GB about $585 instead of $545; iPhone 14 Pro Max 256GB stays about $460. Do not apply these until a second used source agrees. Samsung should stay on the estimate flag until a used S26, S25, or Fold quote is verified.

CSV of the stocked comparison: `report-d-tradein.csv`.
