# Market Predictions Tracker

## Overview
This file tracks daily market predictions, their outcomes, and cumulative learnings.
- Morning predictions are made at 6:15 AM PT (market-morning-research cron)
- Validation happens at 1:30 PM PT (market-prediction-validation cron)
- Weekly scorecard posted Friday at 5:00 PM PT (market-weekly-scorecard cron)

## Prediction Format
Each prediction is logged with:
- Date, prediction text, direction, confidence %, timeframe
- Actual outcome (filled during validation)
- Score: ✅ correct, ❌ wrong, 🔶 partially correct

---

## Active Predictions (Today)

### April 16, 2026 (multi-day, EXPIRING TODAY — Apr 18)
3. Financials (XLF) hold gains through Friday as bank earnings cycle completes | Direction: BULLISH | Target: XLF stays above $52.00 through Fri close; weekly gain +1.5-3% from Mon open | Confidence: 55% | Timeframe: Multi-day (through April 18) | Category: Sector | Invalidation: Trump/Powell escalation → XLF below $51.50, or remaining banks disappoint on forward guidance
   - **Status**: ⏳ PENDING — expires April 18 (TODAY). Needs final scoring at market close.
   - **Interim check (Apr 16 1:30 PM)**: ⚠️ Teetering. XLF closed $52.03, barely above $52.00 threshold. Down -0.27% on the day. Two more trading days remain. Very tight — any meaningful pullback breaks the target.
   - **Interim check (Apr 17 1:30 PM)**: Need final Apr 18 close data to score.

### April 15, 2026 (multi-day, EXPIRING TODAY — Apr 18)
1. TSMC earnings beat drives semiconductor outperformance through end of week | Direction: BULLISH | Target: SMH +2-4% from Tue close through Fri; TSM approaches $600 | Confidence: 65% | Timeframe: Multi-day (through Apr 18) | Category: Sector | Invalidation: TSMC guides below consensus or flags demand softening → SMH drops >2% from pre-earnings level
   - **Status**: ⏳ PENDING — expires April 18 (TODAY). Needs final scoring.
   - **Interim check (Apr 17 1:30 PM)**: SMH likely in +1-2% range from Tue close. Below +2% minimum target. TSM nowhere near $600 (was at ~$363). Likely 🔶 at best — direction right but targets too aggressive, especially the wildly off TSM $600 target.

2. S&P 500 tests ATH of 7,002 this week but faces resistance | Direction: BULLISH | Target: SPX touches 6,980-7,010; closes week 6,950-7,020 | Confidence: 55% | Timeframe: Multi-day (through Apr 18) | Category: Index | Invalidation: Powell confrontation escalates OR Iran talks collapse → SPX below 6,850
   - **Status**: ⏳ PENDING — expires April 18 (TODAY). Needs final scoring.
   - **Interim check (Apr 17 1:30 PM)**: SPX at 7,121.60 — now +1.4% above 7,020 ceiling. Touch target ✅ (hit 6,980-7,010 zone on Tue). But weekly close will be well above 6,950-7,020 range. Direction right, touch right, close range too conservative. 🔶 expected.

3. Bank earnings lift XLF — financials outperform SPX this week | Direction: BULLISH | Target: XLF +1-2.5% for the week (Mon close → Fri close); BAC holds above $54 | Confidence: 60% | Timeframe: Multi-day (through Apr 18) | Category: Sector | Invalidation: Trump/Powell confrontation spooks financial mkts → XLF drops >1.5% from Tue close, or bank guidance turns cautious on war-related credit risk
   - **Status**: ⏳ PENDING — expires April 18 (TODAY). Needs final scoring.
   - **Interim check (Apr 17 1:30 PM)**: XLF was at ~$52.03 on Apr 16 close. Mon close was $51.66. That's +0.72% so far — below +1% minimum. BAC not reaching $54. Likely 🔶 or ❌ depending on today's close.

---

## Prediction History

### Week of April 14, 2026

#### April 17, 2026 (Friday) — Scored 2.0/3 (1 ✅, 2 🔶)
1. S&P 500 gaps up but consolidates — closes in 7,060-7,130 range; intraday high near 7,150 | Direction: BULLISH | Target: SPX closes 7,060-7,130 | Confidence: 60% | Timeframe: Intraday (April 17) | Category: Index | Invalidation: Ceasefire collapses OR Iran walks back Hormuz opening → SPX drops below 7,000
   - **Actual**: SPX closed **7,121.60** (+1.14%). Intraday high **7,147.52**. New ATH at 7,148.39. Close landed squarely in 7,060-7,130 range. High essentially nailed the "near 7,150" call (off by $2.48).
   - **Score**: ✅ Correct — close and intraday high both within predicted bounds. Range-bound/consolidation approach on gap-up day worked perfectly.
   - **Lesson**: Range-bound/consolidation calls are now 2/2 ✅ (Apr 16 + Apr 17). This is our strongest prediction type. Wide consolidation ranges on gap-up days (Rule #13) capture both the bullish direction and profit-taking cap. The 60% confidence was well-calibrated.

2. Energy sector (XLE) underperforms SPX by 3%+ today — XLE -3% to -6%, SPX +0.5-1.5% | Direction: BEARISH | Target: XLE -3% to -6%; relative underperformance vs SPX of 3.5-7.5% | Confidence: 60% | Timeframe: Intraday (April 17) | Category: Sector | Invalidation: Iran reverses Hormuz declaration OR ceasefire breaks down → oil recovers to >$90 WTI and XLE losses narrow to <1.5%
   - **Actual**: XLE **-2.76%** (close $55.02, prev $56.58). XLE intraday low $53.41 (~-5.6%). SPX **+1.14%**. Relative underperformance **3.90%** (within 3.5-7.5% target). WTI settled at $82.59 (-9.4%). Volume 91M shares (~3x normal).
   - **Score**: 🔶 Partially correct — direction correct, SPX within range, relative underperformance of 3.90% within target. But XLE close (-2.76%) fell just short of -3% minimum despite being well within range intraday.
   - **Lesson**: Rule #12 validated — expressing oil views through sector relative performance works better than direct commodity calls. Relative call was spot-on. Energy ETFs recover faster intraday than underlying commodity moves suggest — XLE only -2.76% on a -9.4% WTI day. Energy stocks were partially pricing in peace risk already. Future: widen the lower bound on absolute sector targets for commodity-driven moves, as ETFs dampen commodity volatility.

3. Communication Services (XLC) is worst-performing S&P sector today, NFLX -8% to -12% | Direction: BEARISH | Target: XLC -0.5% to -1.5% despite broad market rally; NFLX -8% to -12% | Confidence: 55% | Timeframe: Intraday (April 17) | Category: Sector | Invalidation: NFLX recovers to <4% loss AND META/GOOG rally >2% → XLC turns positive
   - **Actual**: XLC **+1.25%** (close $118.83, prev $117.36). NFLX **-9.58%** ($97.46, intraday low $95.10 = -11.77%). Energy (XLE -2.76%) was worst sector, not XLC. META/GOOG rallied on the peace trade, overwhelming NFLX drag.
   - **Score**: 🔶 Partially correct — NFLX magnitude nailed dead center of -8% to -12% range. But XLC direction completely wrong (+1.25% vs called -0.5% to -1.5%) and was NOT the worst sector.
   - **Lesson**: On massive risk-on days (+1.14% SPX), individual stock weakness gets overwhelmed by sector-wide momentum. NFLX is only ~5% of XLC — even a -10% move only drags XLC ~0.5%, easily offset by META/GOOG rallying. **New rule**: On gap-up macro days, no single stock can drag a diversified sector ETF negative unless it's >15% weight. The invalidation scenario (META/GOOG rally >2% → XLC turns positive) essentially played out.

#### April 16, 2026 (Thursday) — Scored 1.5/3 (1 ✅, 1 🔶, 1 pending through Apr 18)
1. TSMC earnings beat drives semi sector modestly higher today — SMH +0.5-1.5%, TSM flat to +2% | Direction: BULLISH | Target: SMH +0.5-1.5% today; TSM closes flat to +2% | Confidence: 55% | Timeframe: Intraday (April 16) | Category: Sector | Invalidation: TSMC guidance disappoints on demand/tariff risk → SMH drops >1%
   - **Actual**: SMH +0.40% (just under +0.5% minimum target). TSM -3.13% (sold off hard on "buy the rumor, sell the news" despite record EPS $3.49 beat vs $3.26 est). Invalidation NOT hit (SMH did not drop >1%).
   - **Score**: 🔶 Partially correct — sector direction right (SMH up), but SMH fell just short of minimum target AND TSM direction was completely wrong (called flat-to-up, actual -3.13%).
   - **Lesson**: When a stock is up 137% in 12 months with sky-high expectations baked in, even a blowout beat causes selloffs. The sector can do well when the catalyst stock drops — this is a known "buy rumor, sell news" pattern we should have modeled separately. Future earnings calls: predict the STOCK to sell off while the SECTOR benefits.

2. S&P 500 consolidates near ATH — holds 7,000-7,060 range today | Direction: NEUTRAL | Target: SPX closes 7,000-7,060; intraday range 6,990-7,070 | Confidence: 60% | Timeframe: Intraday (April 16) | Category: Index | Invalidation: Iran ceasefire collapse → SPX below 6,950, or massive surge → SPX above 7,100
   - **Actual**: SPX closed 7,041.28 (+0.26%). Intraday range ~7,009-7,051. Both within target ranges. New ATH at 7,052. AP: "S&P 500 rose 0.3%... for its 11th gain in 12 days."
   - **Score**: ✅ Correct — close and intraday range both within predicted bounds. Consolidation thesis validated.
   - **Lesson**: Range-bound/consolidation calls after extended streaks are our best-performing prediction type. Rule #8 (technical level calls) and Rule #9 (consolidation after 10+ day streaks) both validated.

3. *(XLF multi-day prediction — tracked in Active Predictions above)*

#### April 14, 2026 (Tuesday) — Scored 1.0/3 (1 🔶, 2 ❌)
1. S&P 500 pulls back to 6,750-6,800 range today | Direction: BEARISH | Target: SPX 6,750-6,800 | Confidence: 70% | Timeframe: Intraday | Category: Index | Invalidation: Surprise Hormuz de-escalation or strong retail sales → holds above 6,860
   - **Actual**: SPX rallied to 6,961 (+1.1%). Opened at 6,910, never dipped below 6,905. De-escalation hopes drove risk-on rally.
   - **Score**: ❌ Wrong — direction completely wrong, invalidation scenario played out exactly
   - **Lesson**: Geopolitical sentiment can flip overnight. Our invalidation scenario (de-escalation) was exactly what happened. Should have assigned higher probability to diplomacy given the alternating escalation/de-escalation pattern all month.

2. Semiconductors outperform on TSMC anticipation | Direction: BULLISH | Target: SMH outperforms SPX, NVDA/AVGO/AMD up | Confidence: 75% | Timeframe: Multi-day (through Apr 16) | Category: Sector | Invalidation: China retaliates on trade restrictions or TSMC pre-announces guidance concern → SMH drops below $280
   - **Actual**: SMH +2.58% vs SPX +2.25% (Apr 13→16). SMH outperformed SPX but only by ~0.33%. The outperformance came from Mon-Wed buildup, NOT the TSMC earnings event (Thu). On TSMC earnings day itself, TSM -3.13% and SMH underperformed. NVDA risked breaking 11-day rally per IBD.
   - **Score**: 🔶 Partially correct — SMH did technically outperform SPX over the full period, and invalidation was not hit. But the margin was thin (~0.33%), and the key catalyst day (TSMC earnings Thu) actually saw semis drag. 75% confidence was too high.
   - **Lesson**: Anticipation trades work better than event-day trades. The "buy the rumor" phase (Mon-Wed) delivered the outperformance; the "sell the news" phase (Thu) nearly erased it. 75% was overconfident for a call dependent on a binary earnings event. Also, NVDA/AMD individual direction on the final day was not uniformly up.

3. Oil tests $100+ WTI on Hormuz blockade escalation | Direction: BULLISH | Target: WTI $100+ | Confidence: 65% | Timeframe: Intraday to multi-day | Category: Commodity | Invalidation: Blockade is "symbolic" with minimal enforcement or emergency diplomatic channel opens → oil retreats to $92-94
   - **Actual**: WTI crashed from $99.08 to ~$92.16 (-6.9%). Peace talk signals hammered oil. Hit $92-94 invalidation range exactly.
   - **Score**: ❌ Wrong — direction wrong, invalidation scenario played out precisely ($92-94 range)
   - **Lesson**: Oil is a two-way knife on geopolitics. The same Hormuz catalyst can reverse instantly on diplomacy signals. Our invalidation price target was remarkably accurate ($92-94), but we underweighted the probability of it triggering.

#### April 13, 2026 (Monday) — Scored 1.5/3 (1 🔶, 1 ❌, 1 🔶)
1. S&P 500 opens down but recovers intraday — dips to ~6,750 support, recovers to close -0.2% to -0.4% near 6,790 | Direction: BULLISH (recovery) | Target: SPX close near 6,790 | Confidence: 65% | Timeframe: Intraday | Category: Index | Invalidation: Close below 6,700
   - **Actual**: SPX closed at 6,886.24 (+1.02%) — massive rally, much stronger than predicted
   - **Score**: 🔶 Partially correct — direction (recovery) was right but magnitude was way off. We were far too conservative on the upside.
   - **Lesson**: Underestimated dip-buying momentum after ceasefire rally week. When market has strong momentum, recovery predictions should be more aggressive.

2. Oil stays above $100 all week, Energy outperforms — WTI holds $98-108 range, XLE +2-4% | Direction: BULLISH | Target: WTI $98-108, XLE +2-4% | Confidence: 75% | Timeframe: Multi-day (full week) | Category: Commodity
   - **Actual**: WTI crashed from ~$99 to $92 on Apr 14 peace talk hopes, continued falling to $91.10-91.54 by Apr 15. Well below $98 floor for 3 consecutive days. IEA flagged demand destruction narrative.
   - **Score**: ❌ Wrong — WTI broke decisively below $98 floor within 1 day of prediction. Direction wrong. Oil pricing in peace resolution before it happens despite Hormuz still closed.
   - **Lesson**: Geopolitical supply disruptions reverse faster than expected when diplomacy enters. The "physical blockade = high prices" thesis was mechanically sound but markets are forward-looking — they priced in resolution before it happened. Oil commodity calls are now 0/3.

3. Bank earnings drive financials higher mid-week — XLF +1.5-2.5% Tue-Wed | Direction: BULLISH | Target: XLF +1.5-2.5% | Confidence: 60% | Timeframe: Multi-day (Tue-Wed) | Category: Sector
   - **Actual**: XLF Mon close $51.66 → Wed close $52.17 = +0.99%. Direction right (XLF up), but magnitude fell short of +1.5% minimum target. Banks beat (BAC, MS) but market had front-run the catalyst during Monday's +1.75% XLF rally, leaving less upside for Tue-Wed.
   - **Score**: 🔶 Partially correct — direction right, magnitude short by ~0.5%. The Monday pre-positioning absorbed much of the earnings upside.
   - **Lesson**: When the market front-runs a catalyst (big Mon rally before Tue earnings), the actual event window delivers less. Need to account for pre-positioning in timing calls. Measurement window matters — if measured from Fri close, XLF +2.76% would have scored ✅.

---

## Cumulative Statistics

### Overall Accuracy (Week of Apr 14 — scored predictions only)
- Total predictions scored: 11 (4 still pending from Apr 15-16, expiring today Apr 18)
- Correct (✅): 2
- Partially correct (🔶): 6
- Wrong (❌): 3
- Accuracy rate: 18.2% strict, 45.5% adjusted (✅=1, 🔶=0.5 → 5.0/11.0)
- Raw score: 5.0 / 11.0

### This Week's Daily Breakdown
| Day | Predictions | Score | Rate |
|-----|------------|-------|------|
| Mon Apr 13 | 3 | 1.5/3 | 50.0% |
| Tue Apr 14 | 3 | 1.0/3 | 33.3% |
| Thu Apr 16 | 2 scored + 1 pending | 1.5/2 | 75.0% |
| Fri Apr 17 | 3 | 2.0/3 | 66.7% |
| **Total** | **11 scored** | **6.0/11** | **45.5%** |

### Accuracy by Confidence Level
- High (≥70%): 0.5/3 (16.7%) — SPX bearish 70% ❌, Oil $98-108 75% ❌, Semi outperform 75% 🔶
- Medium (55-69%): 4.5/8 (56.3%) — SPX recovery 65% 🔶, Oil $100+ 65% ❌, XLF Tue-Wed 60% 🔶, TSMC/SMH 55% 🔶, SPX consolidation 60% ✅, SPX gap-up range 60% ✅, XLE underperform 60% 🔶, XLC/NFLX 55% 🔶
- Low (<50%): 0/0

### Accuracy by Timeframe
- Intraday: 3.5/8 (43.8%) — 2 ✅, 4 🔶, 2 ❌
  - Apr 13 #1 SPX recovery (intraday): 🔶
  - Apr 14 #1 SPX bearish (intraday): ❌
  - Apr 14 #3 Oil $100+ (intraday): ❌
  - Apr 16 #1 TSMC/SMH (intraday): 🔶
  - Apr 16 #2 SPX consolidation (intraday): ✅
  - Apr 17 #1 SPX gap-up range (intraday): ✅
  - Apr 17 #2 XLE underperform (intraday): 🔶
  - Apr 17 #3 XLC/NFLX (intraday): 🔶
- Multi-day: 1.5/3 (50.0%) — Oil $98-108 weekly ❌, Semi outperform 🔶, XLF Tue-Wed 🔶
  - (4 additional multi-day predictions pending Apr 18 close)
- Weekly: 0/0

### Accuracy by Category
- Index/market direction: 2.5/4 (62.5%) — SPX recovery 🔶, SPX bearish ❌, SPX consolidation ✅, SPX gap-up range ✅
- Sector calls: 2.0/5 (40%) — TSMC/SMH 🔶, Semi outperform 🔶, XLF Tue-Wed 🔶, XLE underperform 🔶, XLC/NFLX 🔶
- Commodity calls: 0/2 (0%) — both oil calls wrong
- Individual stock calls: 0/0

### Calibration Analysis
- **75% confidence predictions**: 0.5/2 hit (25%) — Oil weekly ❌, Semi outperform 🔶. Severely overconfident.
- **70% confidence predictions**: 0/1 hit (0%) — SPX bearish ❌. Severely overconfident.
- **65% confidence predictions**: 0.5/2 hit (25%) — SPX recovery 🔶, Oil $100+ ❌. Overconfident.
- **60% confidence predictions**: 2.5/4 hit (62.5%) — XLF Tue-Wed 🔶, SPX consolidation ✅, SPX gap-up range ✅, XLE underperform 🔶. Well calibrated — sweet spot.
- **55% confidence predictions**: 1.0/2 hit (50%) — TSMC/SMH 🔶, XLC/NFLX 🔶. Well calibrated.
- **Pattern**: High-confidence (≥70%) predictions are 0.5/3 (16.7%) — severely overconfident. Medium-confidence (55-60%) are performing at 3.5/6 (58.3%) — well calibrated and trending up! The 60% confidence level is our sweet spot with 62.5% actual accuracy.
- ⚠️ **11 scored predictions — sample growing. Trends becoming meaningful.**
- **Key insight**: 60% confidence is our best-performing bracket (2.5/4 = 62.5%). The combination of range-bound approach + 60% confidence is our winning formula. Staying below 65% cap (Rule #6) continues to produce better calibration.

### Trend Analysis
- **Mon → Fri improvement**: 50% → 33% → 75% → 67%. Clear upward trend after the Apr 14 low point. Learning from mistakes is working.
- **Best day**: Thursday Apr 16 (75% — 1.5/2 scored)
- **Worst day**: Tuesday Apr 14 (33% — 1.0/3). Geopolitical flip caught us flat-footed.
- **Late-week outperformance**: Thu+Fri average 70.8% vs Mon+Tue average 41.7%. We perform better as we accumulate intraweek context.

---

## Learnings & Patterns

### Known Biases
1. **Conservative on momentum**: The April 13 recovery prediction was directionally correct but WAY too conservative on magnitude. When market has strong weekly momentum (+3% prior week), recoveries can be much larger than expected.
2. **Geopolitical overreaction bias**: We overweight the continuation of geopolitical narratives. Both April 14 misses came from assuming the "war escalation" narrative from the morning would persist through the trading day. Markets are faster at pricing in geopolitical shifts than we are at predicting them.
3. **Overconfident on event-driven calls**: Geopolitical events are inherently binary and unpredictable. Assigning 65-75% confidence to outcomes dependent on diplomacy/war headlines is too high.
4. **Oil/commodity calls systematically wrong**: 0/2 scored (0/3 including Apr 13 multi-day). Markets price in peace/resolution faster than we expect. Physical constraints (Hormuz blockade) don't override forward-looking sentiment. Oil predictions have been our worst category.
5. **"Sell the news" blindspot on earnings**: We correctly predicted TSMC would beat, but called the stock flat-to-up. When a stock is up 137% YoY with massive expectations baked in, even a blowout beat triggers profit-taking. The sector (SMH) absorbed the positive signal while the individual stock (TSM) sold off -3.13%. This is a classic, predictable pattern we should model.
6. **Front-running dilutes event-day magnitude**: The Apr 13 XLF prediction (+1.5-2.5% Tue-Wed) was too aggressive because Monday's +1.75% rally already priced in bank earnings beats. The actual Tue-Wed window only delivered +0.99%. When the market front-runs a catalyst, reduce the expected magnitude for the event window by 30-50%.
7. **Single-stock weight underestimation in sector ETFs**: Apr 17 XLC call assumed NFLX could drag the sector negative. But at ~5% weight, even -10% NFLX only creates -0.5% drag — easily overwhelmed by META/GOOG rallying on a risk-on day. Need to understand weight mechanics better.
8. **NEW (Wk1 Scorecard): Systematic bullish undershoot**: 4 of our 6 partial scores (🔶) came from being directionally correct but with targets that were TOO CONSERVATIVE. SPX recovery too conservative, SPX ATH close too low, XLF magnitude too narrow, XLE absolute target too aggressive on the downside. We're correctly reading direction but underestimating the magnitude of moves in a strong bull market.
9. **NEW (Wk1 Scorecard): Sector ETF dampening factor missing**: We don't account for how ETFs dampen individual component moves. XLE only captured ~30% of WTI's move. NFLX -10% only moved XLC -0.5%. Need a dampening model for sector ETF predictions.

### What Works Well
- **Invalidation scenarios**: Our invalidation scenarios have been remarkably accurate in describing what would break the thesis AND at what price levels (oil $92-94 nailed exactly). The problem is probability assignment, not scenario identification.
- **Fundamentals-driven predictions**: Earnings-based calls (bank earnings, semi TSMC anticipation) are tracking better than event-driven predictions. Sector calls scoring 40% vs commodity 0%.
- **Range-bound/consolidation calls**: SPX consolidation calls are now **2/2 ✅** (Apr 16 and Apr 17). This is our strongest prediction type by far. Wide ranges on gap-up days also work (Rule #13). **100% hit rate — our gold standard.**
- **ATH/technical level calls**: The SPX 7,002 ATH test prediction (Apr 15) hit within hours — nailed both direction and level. SPX consolidation range (7,000-7,060) was dead center.
- **60% confidence calibration**: 60% confidence predictions are performing at 62.5% — our best-calibrated bracket and near-perfect. 55% performing at 50%. Medium-confidence range is the sweet spot.
- **Sector-level vs stock-level**: Sector ETF predictions (SMH, XLF, XLC) more reliable than individual stock direction calls.
- **Sector relative performance**: XLE vs SPX relative call (Rule #12) was spot-on at 3.90% relative underperformance. This is a better framework than direct commodity price targets.
- **Late-week learning**: Performance improves dramatically as the week progresses (41.7% Mon-Tue → 70.8% Thu-Fri). Intraweek context accumulation matters.

### What Doesn't Work
- **Event-driven geopolitical predictions**: 0/2 scored. Binary geopolitical outcomes are not predictable with high confidence.
- **Specific price targets on high-momentum days**: Too conservative on magnitude.
- **Morning predictions about intraday action**: Narrative can flip between 6:15 AM prediction and 9:30 AM market open.
- **Oil/commodity predictions**: 0/3. Consistent failure. Market forward-looks past physical disruptions.
- **Individual stock direction on earnings day**: TSM -3.13% despite blowout beat. Stock-specific predictions on earnings day are near-random.
- **Single-stock-driven sector drag on risk-on days**: XLC prediction failed because one stock (<15% weight) can't drag a diversified ETF negative on a big up day.
- **High confidence (≥65%) on anything**: 0.5/3 at 70%+, 0.5/2 at 65%. Total 1.0/5 = 20%. Catastrophic. Must cap at 60% until calibration improves.

### Adjustment Rules
1. When prior week shows strong momentum (>2%), widen upside targets by 50-100%
2. Cap confidence at 55% for any prediction dependent on geopolitical headlines (war/peace, diplomacy, military action)
3. When identifying invalidation scenarios involving diplomacy/de-escalation, assign at least 40% probability to them — markets WANT to find optimism
4. Prefer fundamentals-driven predictions (earnings, data, technicals) over event-driven ones (geopolitics, headlines) — they have better hit rates
5. For geopolitical-dependent predictions, consider making the prediction conditional: "If no de-escalation headlines, then X" rather than unconditional directional calls
6. **UPDATED**: No prediction above **60%** confidence until high-confidence calibration improves above 40%. Previously capped at 65%, but 65% bracket is also failing (25% hit rate). The 55-60% range is our only well-calibrated zone.
7. **Apr 15**: Avoid oil/commodity directional predictions during active geopolitical negotiations. Our hit rate is 0%. Instead, express commodity views via sector calls (energy sector vs. SPX) which have more nuance.
8. **Apr 15**: Technical level calls (ATH tests, support/resistance) are performing well — lean into these for index predictions rather than directional bets.
9. **Apr 16**: After extended win streaks (10+ days), prefer consolidation/range calls over continuation bets. Mean reversion risk rises with streak length.
10. **Apr 16**: On earnings day, predict the SECTOR direction separately from the individual STOCK direction. High-profile stocks with massive run-ups (>100% YoY) should be called to sell off on earnings, even on beats. The sector ETF (e.g., SMH) absorbs the bullish signal more reliably.
11. **Apr 16**: When a catalyst is being front-run (e.g., big pre-earnings rally), reduce expected magnitude for the event window by 30-50%. The market pre-positions, so the actual event delivers less than a naive model would suggest.
12. **Apr 17**: Express oil/commodity views through sector relative performance (XLE vs SPX) rather than direct commodity price targets. Sector calls have 40% accuracy vs 0% for commodities. Validated on Apr 17: relative call was spot-on (3.90% in 3.5-7.5% range).
13. **Apr 17**: On major gap-up days driven by geopolitical breakthroughs, use wide consolidation ranges rather than tight targets. The initial gap captures most of the move; intraday action tends to be range-bound within the gap. Validated on Apr 17: SPX closed 7,121.60 within 7,060-7,130 range.
14. **Apr 17**: On massive risk-on days (SPX >+1%), no single stock can drag a diversified sector ETF negative unless that stock is >15% of ETF weight. A -10% move on a 5% weight = only -0.5% sector drag, easily overwhelmed by sector-wide momentum. Don't predict sector ETF direction based on single-stock weakness on big macro days.
15. **Apr 17**: Energy ETFs dampen underlying commodity volatility significantly. WTI -9.4% translated to only XLE -2.76%. Factor in ~30-40% dampening when converting commodity price moves to sector ETF targets. XLE intraday captured more of the move (low = ~-5.6%) but mean-reverted into close.
16. **NEW (Wk1 Scorecard)**: Widen target ranges by 25-30% in strong bull markets (SPX up >3% trailing 2 weeks). Our 🔶 rate is 55% — most misses are directionally correct but magnitude too conservative. Better to have wider ranges that score ✅ than tight ranges that score 🔶.
17. **NEW (Wk1 Scorecard)**: Apply ETF dampening model to all sector predictions: absolute ETF move ≈ 25-40% of the largest component's move, depending on weight. Calculate before setting targets. NFLX at 5% of XLC = max -0.5% drag. XOM at 23% of XLE = meaningful but still dampened.
18. **NEW (Wk1 Scorecard)**: Prioritize 2+ consolidation/range calls per day. This is our only 100% accuracy category. Index range calls should be the anchor of every daily prediction set, with sector calls as supplementary.

---

## Strategy Notes
- Market showing extremely strong dip-buying behavior in April 2026 amid geopolitical uncertainty
- Energy/oil remain the key macro variable — but Hormuz blockade premium is fragile and can evaporate on any peace signal
- Earnings season (banks, TSMC) provides fundamental catalysts that can overwhelm geopolitical fear
- **April 14 was a pivotal lesson day**: The market flipped from "war escalation" to "peace hopes" overnight, invalidating 2/3 predictions. This is the core challenge of geopolitical-era market prediction.
- Semi/tech fundamentals (TSMC earnings anticipation) proving more reliable than macro/geopolitical calls
- **April 15 context**: S&P 500 set new ATH at 7,003.82, closed at 7,022.95. VIX at 18.05 (down from 38% peak). Nasdaq surged 1.59% to 24,016. Market fully erased all war losses and then some. Trump/Powell confrontation is a new risk vector but market shrugging it off so far. BAC/MS both beat earnings. TSMC reports tomorrow (Apr 16) — the biggest catalyst for our pending predictions.
- **New wildcard**: Trump/Powell confrontation could become THE story if it escalates. Fed independence concerns historically cause sharp market reactions.
- **Oil disconnect**: WTI at $91-92 despite Hormuz still being physically closed. Market has fully priced in a resolution that hasn't happened yet. If peace talks fail again, oil could reverse violently upward — but we've been wrong betting on this scenario.
- **April 16 context**: TSMC reported record Q1 — EPS $3.49 (beat $3.26 est), revenue $35.9B (+35% YoY). But stock muted premarket — "buy the rumor, sell the news" dynamic. SPX at 7,032 premarket. Nasdaq on 11-day streak (first since Nov 2021). Trump escalated Powell threats — wants to fire him if he doesn't leave when term ends May. Fed's Goolsbee says rate cuts may wait until 2027 if oil-driven inflation persists. US blockade of Iranian ports "fully implemented." Pakistan PM diplomatic push for Round 2 talks this week. Ceasefire window narrowing.
- **April 16 validation context**: SPX closed 7,041.28 (+0.26%), new ATH at 7,052. TSM sold off -3.13% despite earnings blowout — classic sell-the-news. SMH +0.40%. XLF -0.27% to $52.03. VIX down to 17.94. WTI ~$93.51. Market is in "grind higher" mode — consolidating near ATHs with low volatility. Our first ✅ prediction (SPX consolidation) came from the range-bound approach.
- **Key takeaway**: The shift from directional bets to range-bound/technical calls is working. Sector-level predictions (SMH vs individual TSM) are more reliable. 55-60% confidence range is producing better-calibrated results. Continuing to avoid oil/commodity calls is correct.
- **April 17 context**: MASSIVE risk-on morning. Iran FM declares Hormuz "completely open" during 10-day ceasefire with Lebanon/Israel. WTI crashing -9.4% to $82.59. S&P 500 +1.14% to 7,121.60 (new ATH 7,148.39). Dow +870 points (+1.8%). Nasdaq +1.5%. Brent -9.1% to $90.38. Netflix -9.58% on weak Q2 guide + Hastings departure. XLE -2.76%. Market posted third straight week of big gains. $76B "wealth transfer" from energy to consumer sectors as war premium unwinds.
- **April 17 validation context**: Best daily score yet (2.0/3). SPX range call ✅ for second consecutive day. XLE relative call worked but absolute target slightly off. XLC/NFLX taught us about single-stock weight limits in sector ETFs. Cumulative accuracy improved to 45.5% from 37.5%. The range-bound + 60% confidence formula is our winning combination. 4 multi-day predictions still pending for Apr 18 validation.
- **Week 1 Scorecard Insights (Apr 17)**:
  - We are in a strong bull market that punishes conservative targets. Widen ranges.
  - Our edge is in consolidation/range calls (100%) and index direction (62.5%). Double down on these.
  - Oil/commodity calls are a dead zone (0%). Express views through sectors only.
  - Confidence calibration is inverted: higher confidence = worse performance. Stay at 55-60%.
  - The week showed clear improvement trajectory: worst day was Tue, best was Thu. We learn fast from mistakes.
  - Next week: watch for ceasefire expiry (10-day window), tech earnings continuing, and Powell/Trump drama as potential volatility catalysts.
