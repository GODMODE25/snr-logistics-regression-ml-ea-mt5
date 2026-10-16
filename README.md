# XAUUSD S&R Logistic Regression

Research desk and MetaTrader 5 expert advisor for XAUUSD support and resistance with a **corrected, causal logistic regression** layer.

This is **not** a profitability claim. The web chart uses a synthetic gold path. Judge live results only from MetaTrader after commission, spread, and swap.

## What is in this project

| Piece | Role |
| --- | --- |
| Research desk (web) | Replay a synthetic path, compare four rules, inspect equity and model weights |
| `XAUUSD_SR_LogReg_EA.mq5` | Non-repainting MT5 EA for closed-candle signals on XAUUSD |
| `XAUUSD_SR_LogReg_TESTING_PLAN.txt` | Strategy Tester presets, walk-forward split, success criteria |

## Core rules

- Signals use **closed candles only**. The forming bar is never used for decisions.
- Pivots confirm only after `PivotLength` bars have closed on each side (default 14).
- Support holds if price tags the level and closes back above it; resistance is the mirror.
- A close through the level breaks it. Touch zone is ATR × touch multiplier (default 0.25).
- Logistic regression is fit only on **resolved** levels (target retests reached = 1, break/expiry = 0).
- A level is **never** in its own training set. Weights are not reset on every prediction.
- Features are continuous and z-scored on a trailing window ending at the pivot bar.

## Four strategy presets

| Preset | Rule |
| --- | --- |
| A Baseline | Trade every valid retest |
| B ML retest | Retest only if model probability ≥ threshold |
| C Break | Trade the close through the level |
| D ML break | Break only if the model agrees |

## Research desk (web)

1. Open the app preview.
2. Use **Play / Replay** and the bar scrubber to walk the path.
3. Switch modes A–D; the out-of-sample table updates on the same path.
4. Adjust pivot length, probability threshold, and path seed.
5. Download the EA and testing plan from the header.

**Probability labels on the chart:** shown only in ML modes, and only on up to two active levels nearest price (not on every line).

**Synthetic path disclaimer:** numbers are per ounce after a toy spread and commission. They are a mechanics check, not an XAUUSD backtest.

## MetaTrader 5 EA

### Install

1. Copy `XAUUSD_SR_LogReg_EA.mq5` into `MQL5/Experts`.
2. Compile with **F7**.
3. Confirm the journal prints: `Logistic self-check passed`.

### Suggested tester setup

- Symbol: **XAUUSD**
- Timeframes: **M5** and **M15** separately (or chart TF in the tester)
- Debug model: 1 minute OHLC on full history
- Final model: every tick based on real ticks
- Costs: real commission, symbol swap, non-zero slippage
- Walk-forward: first 60% train, next 20% validation, last 20% out-of-sample
- `OnTester` returns **validation** profit factor only — not out-of-sample

Full checklist: `XAUUSD_SR_LogReg_TESTING_PLAN.txt`.

### What “success” means

- Positive **out-of-sample** expectancy after real costs
- Enough trades to mean something (plan target: 1,000+)
- ML beats baseline **A** on both M5 and M15, or keep A / stop
- Do not add filters to rescue an overfitting curve

## What was fixed vs the original Pine script

- Weights no longer reset inside every prediction
- Pending pivots are not trained as failures before they resolve
- Gradient uses prediction − target with L2 on weights
- Features stay continuous (not crushed to a single bit)
- Labels are 0/1 on resolved outcomes only

## Disclaimer

This software is for research and education. Past or synthetic performance does not guarantee future results. You are responsible for risk, broker costs, and any live trading decisions.
