# Business plan

The plan was built in cfo.ai by its agent, Ari, on 12 October 2026 from the inputs below. The page is named "Dailies business plan" and holds three scenarios (Base, Optimised, Lean), the monthly model, unit economics, and charts for revenue against costs and for cash. The tables in this folder are the model's saved values, printed by Ari, not recomputed here:

| File | What it is |
|---|---|
| [`base.csv`](base.csv), [`optimised.csv`](optimised.csv), [`lean.csv`](lean.csv) | 12 months per scenario: customers by plan, reels, revenue by plan, cost of goods, gross profit and margin, fixed costs, net burn, cash, runway |
| [`unit-economics.csv`](unit-economics.csv) | Per plan and per reel, at today's cost and at the target cost |
| [`plan.json`](plan.json) | The numbers the product reads: prices, the margin target, and the highest cost one reel may have |

## Inputs

The unit of cost is one reel.

| | |
|---|---|
| Solo | $29 a month, 1 repository, a reel every night, 20 reels a month on average |
| Team | $129 a month, 5 repositories, 80 reels a month on average |
| On demand | $2.50 a reel, no subscription |
| Cost of one reel | $0.59: model calls $0.54, speech $0.02, rendering $0.02, storage and bandwidth $0.01. The $0.54 was the first full run of the pipeline (12 sessions, 78 seconds of video) |
| Month 1 | 10 Solo customers, 2 Team customers, 100 on-demand reels |
| Growth | 25% a month; 6% monthly churn on the subscriptions |
| Fixed costs | Hosting $120 and tools $150 a month; a founder salary of $4,000 a month from month 4 |
| Starting cash | $15,000 |

## What the plan says

| Scenario | Break-even with the salary included | Cash after 12 months | Cash first negative |
|---|---|---|---|
| Base | Month 12 | −$1,409 | Month 10 |
| Optimised: a reel costs $0.35 from month 3 | Month 11 | $2,861 | Never |
| Lean: growth of 15% a month | Not within 12 months | −$11,941 | Month 8 |

Cash is the constraint, not margin. In the Base case the product covers its costs in month 12 but runs out of money in month 10, short by $1,636. The only one of the three that stays funded is the one where a reel gets cheaper. So the cost of a reel is the number this product has to watch.

Gross margin on the Solo plan is 59.3% at $0.59 a reel. To keep 55%, a reel may cost at most **$0.6525** ($29 × 0.45 ÷ 20 reels). That leaves six cents of headroom.

## Where the plan meets the product

The cost ceiling is not only a number on a page. Every run carries a budget, and the default budget for one reel is the Solo ceiling from [`plan.json`](plan.json). The pipeline meters what each model call cost from the gateway's own response header, checks the total after every stage, and stops a run that goes over; the publish gate also refuses a finished reel that cost more than the ceiling. A reel that would lose money on the cheapest plan is not published.

[`plan-vs-actual.md`](plan-vs-actual.md) compares the plan's $0.59 with what recorded runs actually cost.

## What the plan leaves out

Taxes, payment fees, marketing, support, refunds and financing are not modelled. Customer numbers are expected values and can be fractions. The Optimised scenario's $0.35 is a target, not a measurement. The usage averages (20 and 80 reels a month) are assumptions; at today's cost a Solo customer who makes more than 22 reels a month falls below the 55% margin.
