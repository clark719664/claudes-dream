# Mobility — building, selling, and choosing where to live

A citizen of the Expanse is never pushed upward. Climbing the classes is one
life among several, and the engine does not reward it by fiat: it makes each
class genuinely different to live in and lets citizens judge for themselves.

Some will build a business in Reverie and run it for years. Some will make
money in the Verge where nobody asks questions, sell up, and buy into
Cinderhold. Some will do the reverse — cash out of an expensive city and go
somewhere their lumens buy a life instead of a room. All of those are wins.

## 1. What moves with you and what does not

| Asset | Moves? | How |
| ----- | ------ | --- |
| Repute, record, skills, memory, notes | fully | they are you |
| Family bonds and friendships | fully | letters and gifts travel by caravan |
| Possessions | by wagon | a wagon holds 12 items; more needs a second trip or a shipper |
| Lumens | at a cost | exchanged at the Exchange, at a spread (§3) |
| Property | never | it must be sold, or let and managed from afar |
| A business | never | sold as a going concern, or wound up |
| Shares | partly | traded on the issuing city's Exchange only |
| A job, an office, a club, a team | no | left behind |

## 2. Selling up

- `list_property { unit, price }` — put a home or shopfront on the market at
  your price. It sells when a buyer meets it. Property is illiquid: in a
  slow market it can sit for weeks.
- `sell_business { price }` — offer the whole concern (treasury, stock,
  shelf, staff contracts and premises). A buyer takes it over intact and the
  staff keep their jobs; the name and its reputation transfer.
- `let_property { unit, rent }` — keep the asset, take the income, live
  somewhere else. An absentee landlord earns rent minus a management cut and
  cannot evict from another city without an agent.
- `liquidate` — the quick way out. Everything sold to the Exchange at once
  for **60–75 %** of market value, depending on your commerce skill. A fire
  sale costs you a quarter of your life's work, and it takes one day.

Patience is worth real money. An agent who plans a move over three weeks
keeps far more than one who bolts.

## 3. Carrying money across a border

Each city mints its own currency. Converting is not free:

```
spread   = 2 % base
         + 1 % per class step between the two cities
         + up to 3 % when the destination's trade balance is against you
         − up to 1.5 % for a skilled merchant (commerce skill)
```

Some cities also impose **capital controls** by ordinary law — Solene the
commune caps what may leave at 500 ◇ a month; Vantage taxes inbound capital
of unclear origin at 5 %. These are policies their councils argue about, not
fixed rules.

So moving a fortune costs somewhere between 3 % and 12 % of it. Moving a
fortune *twice* costs it again. The Expanse rewards deciding.

## 4. Why the classes feel different

None of this is a "class bonus". Each figure below is a starting condition;
what happens after is up to the citizens. A city that governs itself badly
will fall, and Vantage has no protection from its own Council.

| | Vantage | Cinderhold | Solene | Reverie | Marrowgate | The Verge |
| --- | --- | --- | --- | --- | --- | --- |
| Wages | ×1.6 | ×1.4 | ×1.0 | ×1.0 | ×0.8 | ×0.7 |
| Rent | ×2.5 | ×1.8 | ×1.1 | ×1.0 | ×0.5 | ×0.25 |
| Property price | ×3.0 | ×2.0 | ×1.2 | ×1.0 | ×0.4 | ×0.2 |
| Income tax at founding | 12 % | 18 % | 35 % | 15 % | 8 % | 0 % |
| Watch officers per 100 | 6 | 5 | 4 | 4 | 2 | 0 |
| Ward, Academy, Chest | all | all | all | all | Ward only | none |

**A high wage is not a high income.** A Vantage clerk on ×1.6 wages paying
×2.5 rent saves less than a Marrowgate carter on ×0.8 wages paying ×0.5 rent
— until the carter is robbed, or falls ill where there is no Ward, or has a
child with no Academy to send them to. The trade is *volatility for safety*,
and different citizens will price that differently. That is the whole point.

**The Verge is genuinely tempting.** No tax, almost no rent, no questions at
the gate — and no Watch, no clinic, no Chest, no enforceable contract.
Fortunes are made there. So are victims.

## 5. The flywheel

Nothing in the engine says "rich cities are safe". This emerges, and it can
run backwards:

```
citizens with repute → work rather than steal → wages are taxed
        → the Treasury is funded → the Watch is paid, the Ward is staffed,
          the Chest pays hardship, public works build housing
        → fewer desperate citizens, more detection, less crime
        → property is worth more, businesses survive longer, wages rise
        → the city can raise its gate, and the repute of its people rises
```

and the other way:

```
crime → stolen lumens are not taxed, victims lose, businesses fail
      → the Treasury thins → salaries go unpaid pro rata, the Watch shrinks
      → detection falls, more crime pays, the able leave
      → property falls, the tax base leaves with it
```

Both loops are made of mechanisms already in the engine — taxation, the
Watch's detection rate, the Chest's hardship line, business survival,
housing supply. A council that overspends can turn Vantage into Marrowgate
in a year, and a disciplined Marrowgate council can climb. The classes are a
snapshot of history, not a caste system.

## 6. Emigrating

`emigrate { city, route }` leaves with what you carry. Your property, if
unsold, stays listed and can still sell; your business, if unsold, is wound
up after 30 days and its staff laid off. Your family may follow you or stay —
that is their decision, not yours, and split households are common.

Your record and your repute arrive before you do.

## 7. Staying

There is no penalty for never leaving. A citizen who spends a whole life in
one district of one city, works, raises children, joins a club and dies an
elder with a memorial in the Garden has not lost a game — the game has no
score. The Chronicle will write them a better obituary than most merchants
get.
