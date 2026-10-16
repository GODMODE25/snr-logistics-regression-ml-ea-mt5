//+------------------------------------------------------------------+
//|                                      XAUUSD_SR_LogReg_EA.mq5     |
//|  XAUUSD support/resistance EA with corrected logistic regression |
//+------------------------------------------------------------------+
// The attached Pine script is a useful idea and a bad trainer. This EA
// does not copy that trainer.
//
// Pine defects that are fixed here:
//   * weights were reset to 1 inside every predict() call
//   * the new pivot was pushed into the training array before scoring,
//     with timesRespected == 0, so it labeled itself a failure
//   * labels were -1/1 while the loss was written for a probability
//   * the step was (p + loss) * x, not the logistic gradient (p - y) * x
//   * RSI and body were crushed to a single bit
//
// Causal rules:
//   * signals use a closed candle only; the forming bar is never read
//   * a pivot is confirmed PivotLength closed bars after the pivot
//   * retests and breaks are counted only on bars after confirmation
//   * the decision uses weights fit on older resolved levels
//   * the level's own label is applied only after that decision
//   * label 1 = TargetRespects valid retests before break/expiry
//   * label 0 = break or expiry before that count
//   * market orders fill on a later tick, never at a fantasy close
//
// No DLL. No web request. No profitability claim.
// Judge the printed OUT-OF-SAMPLE block after commission, swap, and spread.
//+------------------------------------------------------------------+
#property copyright "XAUUSD SR Logistic Regression"
#property version   "1.00"
#property description "Non-repainting XAUUSD S&R EA. Corrected logistic regression."
#property description "Closed candles only. Use presets A-D from the testing plan."

#include <Trade/Trade.mqh>

#define FT_N            6
#define PREFIX          "XAU_SR_LOGREG_"
#define MAX_CLASS_SCALE 5.0
#define WEIGHT_CAP      8.0

enum ENUM_PRESET
  {
   PRESET_A_BASELINE = 0, // A — Pivot-only retest baseline
   PRESET_B_ML_RETEST = 1, // B — ML-approved retests
   PRESET_C_BREAK     = 2, // C — Break strategy
   PRESET_D_ML_BREAK  = 3, // D — ML-approved breaks
   PRESET_CUSTOM      = 4  // Custom — use the toggles below
  };

enum ENUM_TF_CHOICE
  {
   TF_USE_CHART = 0, // Chart / Strategy Tester timeframe
   TF_M5        = 1, // Force M5
   TF_M15       = 2  // Force M15
  };

enum ENUM_TRAIN_POLICY
  {
   TRAIN_FREEZE = 0, // Fit on the earliest 60% only, then freeze
   TRAIN_ONLINE = 1  // Keep fitting every resolved level
  };

enum ENUM_EXIT_REASON
  {
   EXIT_NONE = 0,
   EXIT_SL,
   EXIT_TP,
   EXIT_TRAIL,
   EXIT_TIME,
   EXIT_REVERSE,
   EXIT_OTHER
  };

enum ENUM_SPLIT
  {
   SPLIT_NA = 0,
   SPLIT_TRAIN,
   SPLIT_VAL,
   SPLIT_OOS
  };

input group "1. Signal"
input ENUM_PRESET       InpPreset            = PRESET_B_ML_RETEST; // Strategy preset
input ENUM_TF_CHOICE    InpTFChoice          = TF_USE_CHART;       // Signal timeframe
input int               InpPivotLength       = 14;                 // Pivot length (bars each side)
input int               InpTargetRespects    = 3;                  // Valid retests required for label 1
input int               InpRetestCooldown    = 3;                  // Min closed-bar gap between retests
input int               InpMaxLevelAgeBars   = 500;                // Expire an unbroken level after N bars
input double            InpTouchATRMult      = 0.25;               // Touch zone = ATR(PivotLength) * this
input double            InpMergeATR          = 0.30;               // Drop a pivot this close to an active same-type level (0 = off)

input group "2. Logistic regression"
input double            InpProbThreshold     = 0.55;               // Minimum P(success) to take an ML trade
input double            InpLearningRate      = 0.03;               // SGD step size
input double            InpL2Lambda          = 0.001;              // L2 penalty on weights only (bias is free)
input int               InpEpochs            = 1;                  // SGD passes on each newly resolved level
input int               InpNormWindow        = 200;                // Bars in the z-score window
input int               InpMinTrainSamples   = 30;                 // ML stays flat until this many resolved levels
input bool              InpBalanceClasses    = true;               // Up-weight the rarer label, capped at 5x
input ENUM_TRAIN_POLICY InpTrainPolicy       = TRAIN_FREEZE;       // Freeze weights after the train window
input bool              InpFallbackBaseline  = false;              // During warmup, take geometric trades instead of waiting

input group "3. Custom toggles (preset = Custom)"
input bool              InpTradeRetests      = true;               // Enter on valid retests
input bool              InpUseML             = true;               // Retests must pass the model
input bool              InpTradeBreaks       = false;              // Enter on confirmed breaks
input bool              InpBreaksUseML       = false;              // Breaks must pass the model
input bool              InpAllowReverse      = false;              // Opposite signal closes, then flips

input group "4. Risk and exits"
input double            InpFixedLots         = 0.01;               // Lot size when risk % is off
input bool              InpUseRiskPercent    = false;              // Size the stop to a percent of balance
input double            InpRiskPercent       = 1.0;                // Percent of balance risked per trade
input double            InpMaxDailyLossPct   = 3.0;                // Block new trades after this daily equity loss (0 = off)
input double            InpSL_ATR_Mult       = 1.5;                // Stop distance beyond the level, in ATR
input bool              InpUseRiskReward     = false;              // TP = stop distance * R, instead of ATR
input double            InpTP_ATR_Mult       = 3.0;                // Take-profit distance in ATR
input double            InpRiskReward        = 2.0;                // R multiple used when R mode is on
input bool              InpUseTrailing       = false;              // Trail on closed bars after the trade is in profit
input double            InpTrailStartATR     = 1.0;                // Favorable close required before trailing
input double            InpTrailATRMult      = 1.0;                // Trail distance in ATR
input int               InpMaxTradeBars      = 0;                  // Market-exit after N closed bars (0 = off)
input int               InpMaxSpreadPoints   = 0;                  // Skip entries when spread is wider (0 = off)

input group "5. Execution"
input int               InpSlippagePoints    = 50;                 // Maximum deviation, in points
input ulong             InpMagic             = 26041301;           // Magic number
input string            InpOrderComment      = "XAU_SR";           // Order comment prefix (31 chars max)

input group "6. Chronological split"
input datetime          InpSplitStart        = 0;                  // Tester From date. 0 = do not tag splits
input datetime          InpSplitEnd          = 0;                  // Tester To date. 0 = do not tag splits

input group "7. Chart drawings"
input bool              InpShowChartDrawings = true;               // Draw levels. Off in non-visual tests
input int               InpLineWidth         = 2;                  // Level line width
input ENUM_LINE_STYLE   InpLineStyle         = STYLE_SOLID;        // Level line style
input int               InpFontSize          = 9;                  // Label size
input string            InpFontName          = "Arial";            // Label font
input color             InpSupportColor      = C'8,153,129';       // Support color
input color             InpResistanceColor   = C'242,54,69';       // Resistance color
input color             InpTextColor         = clrWhite;           // R and B label color
input int               InpMaxDrawings       = 300;                // Oldest markers are deleted past this cap

input group "8. Reports"
input bool              InpExportCSV         = true;               // Write trades to MQL5/Files
input string            InpCSVFile           = "XAUUSD_SR_LogReg_trades.csv"; // CSV name, not a path
input int               InpWarmupBars        = 100000;             // Live only: replay N closed bars. Tester ignores this
input bool              InpVerbose           = false;              // Log ML rejects

//+------------------------------------------------------------------+
struct SLevel
  {
   bool     isSupport;
   double   price;
   datetime pivotTime;
   datetime confirmTime;
   int      pivotSeq;
   int      confirmSeq;
   int      respects;
   int      lastRetestSeq;
   bool     hasRetest;
   double   f0, f1, f2, f3, f4, f5;
   double   probability;
   int      state;
   bool     labelLocked;
   int      label;
   bool     trained;
   bool     dead;
  };

struct SSample
  {
   double f0, f1, f2, f3, f4, f5;
   int    y;
  };

struct SSignal
  {
   bool     valid;
   int      dir;
   int      kind;
   double   score;
   double   probability;
   bool     mlGate;
   double   level;
   datetime pivotTime;
   bool     isSupport;
   double   f0, f1, f2, f3, f4, f5;
   double   atr;
  };

struct SOpen
  {
   bool     active;
   bool     awaitLink;
   ulong    ticket;
   ulong    posId;
   datetime entryTime;
   int      entrySeq;
   int      dir;
   double   entryPrice;
   double   sl;
   double   tp;
   double   lots;
   double   level;
   datetime pivotTime;
   int      isSupport;
   int      kind;
   double   probability;
   int      mlGate;
   double   f0, f1, f2, f3, f4, f5;
   double   bias, w0, w1, w2, w3, w4, w5;
   int      samplesAtEntry;
   int      split;
   int      pendingExit;
   bool     trailMoved;
  };

struct STrade
  {
   datetime entryTime;
   datetime exitTime;
   int      dir;
   double   entryPrice;
   double   exitPrice;
   double   sl;
   double   tp;
   double   profit;
   double   commission;
   double   swap;
   int      exitReason;
   int      barsHeld;
   double   level;
   datetime pivotTime;
   int      isSupport;
   int      kind;
   double   probability;
   int      mlGate;
   double   f0, f1, f2, f3, f4, f5;
   double   bias, w0, w1, w2, w3, w4, w5;
   int      samplesAtEntry;
   int      split;
  };

struct SDD
  {
   bool   init;
   double peak;
   double maxDD;
   double maxDDPct;
  };

//+------------------------------------------------------------------+
class CLogReg
  {
public:
   double m_bias;
   double m_w[FT_N];
   double m_lr;
   double m_lambda;
   int    m_epochs;
   bool   m_balance;
   int    m_samples;
   int    m_pos;

   void Reset(const double lr, const double lambda, const int epochs, const bool balance)
     {
      m_bias = 0.0;
      for(int i = 0; i < FT_N; i++) m_w[i] = 0.0;
      m_lr = lr;
      m_lambda = lambda;
      m_epochs = (epochs < 1 ? 1 : epochs);
      m_balance = balance;
      m_samples = 0;
      m_pos = 0;
     }

   double PredictBuf(const double &x[]) const
     {
      double z = m_bias;
      for(int i = 0; i < FT_N; i++) z += m_w[i] * x[i];
      if(z > 20.0) z = 20.0;
      if(z < -20.0) z = -20.0;
      return 1.0 / (1.0 + MathExp(-z));
     }

   double Predict6(const double a0, const double a1, const double a2,
                   const double a3, const double a4, const double a5) const
     {
      double x[FT_N];
      x[0] = a0; x[1] = a1; x[2] = a2; x[3] = a3; x[4] = a4; x[5] = a5;
      return PredictBuf(x);
     }

   void Fit6(const double a0, const double a1, const double a2,
             const double a3, const double a4, const double a5, const int y)
     {
      double x[FT_N];
      x[0] = a0; x[1] = a1; x[2] = a2; x[3] = a3; x[4] = a4; x[5] = a5;
      double scale = 1.0;
      if(m_balance && m_samples >= 10 && m_pos > 0 && m_pos < m_samples)
        {
         double pos = (double)m_pos;
         double neg = (double)(m_samples - m_pos);
         scale = (y == 1) ? (0.5 * (double)m_samples / pos)
                          : (0.5 * (double)m_samples / neg);
         if(scale > MAX_CLASS_SCALE) scale = MAX_CLASS_SCALE;
         if(scale < 1.0 / MAX_CLASS_SCALE) scale = 1.0 / MAX_CLASS_SCALE;
        }
      for(int e = 0; e < m_epochs; e++)
        {
         double p = PredictBuf(x);
         double err = (p - (double)y) * scale;
         m_bias -= m_lr * err;
         if(m_bias > WEIGHT_CAP) m_bias = WEIGHT_CAP;
         if(m_bias < -WEIGHT_CAP) m_bias = -WEIGHT_CAP;
         for(int i = 0; i < FT_N; i++)
           {
            m_w[i] -= m_lr * (err * x[i] + m_lambda * m_w[i]);
            if(m_w[i] > WEIGHT_CAP) m_w[i] = WEIGHT_CAP;
            if(m_w[i] < -WEIGHT_CAP) m_w[i] = -WEIGHT_CAP;
           }
        }
      m_samples++;
      if(y == 1) m_pos++;
     }
  };

//+------------------------------------------------------------------+
CLogReg             g_model;
CTrade              g_trade;
ENUM_TIMEFRAMES     g_tf = PERIOD_CURRENT;
ENUM_ORDER_TYPE_FILLING g_fill = ORDER_FILLING_RETURN;

bool     g_tradeRetests = true;
bool     g_useML = true;
bool     g_tradeBreaks = false;
bool     g_breaksUseML = false;
int      g_rsi = INVALID_HANDLE;
int      g_atrH = INVALID_HANDLE;
datetime g_lastBar0 = 0;
int      g_barSeq = 0;
bool     g_warmup = false;
bool     g_splits = false;
datetime g_trainEnd = 0;
datetime g_valEnd = 0;
datetime g_firstBar = 0;
datetime g_lastClosed = 0;

SLevel   g_levels[];
SSample  g_queue[];
int      g_qcount = 0;
SSignal  g_pending;
SOpen    g_open;
STrade   g_trades[];

double   g_f5[];
int      g_f5n = 0;
double   g_lastSupport = 0.0;
double   g_lastResist = 0.0;
bool     g_hasSupport = false;
bool     g_hasResist = false;

int      g_dayKey = -1;
double   g_dayEquity = 0.0;
bool     g_dayLocked = false;
bool     g_dayNoted = false;

int      g_objSeq = 1;
int      g_pivots = 0;
int      g_retests = 0;
int      g_breaks = 0;
int      g_expired = 0;
int      g_merged = 0;
int      g_skipML = 0;
int      g_skipWarm = 0;
int      g_skipPos = 0;
int      g_skipDay = 0;
int      g_skipStops = 0;
int      g_skipSpread = 0;
int      g_skipLots = 0;
int      g_skipMargin = 0;
int      g_orderFail = 0;
int      g_signals = 0;
int      g_trainDropped = 0;

SDD      g_ddAll, g_ddTrain, g_ddVal, g_ddOos;
string   g_csvName = "XAUUSD_SR_LogReg_trades.csv";
string   g_sumName = "XAUUSD_SR_LogReg_summary.txt";

//+------------------------------------------------------------------+
double Clip5(const double z)
  {
   if(z > 5.0) return 5.0;
   if(z < -5.0) return -5.0;
   return z;
  }

double ZScore(const double &hist[], const int n, const double x)
  {
   if(n < 20) return 0.0;
   double sum = 0.0;
   for(int i = 0; i < n; i++) sum += hist[i];
   double mean = sum / (double)n;
   double var = 0.0;
   for(int i = 0; i < n; i++)
     {
      double d = hist[i] - mean;
      var += d * d;
     }
   var /= (double)(n - 1);
   double sd = MathSqrt(var);
   if(sd < 1e-8) return 0.0;
   return Clip5((x - mean) / sd);
  }

double LinSlopeCloses(const double &closes[], const int newest, const int len, const double atr)
  {
   if(atr <= 0.0 || len < 2) return 0.0;
   double sumX = 0.0, sumY = 0.0, sumXY = 0.0, sumXX = 0.0;
   for(int k = 0; k < len; k++)
     {
      double y = closes[newest + (len - 1 - k)];
      sumX += k;
      sumY += y;
      sumXY += k * y;
      sumXX += (double)k * (double)k;
     }
   double denom = (double)len * sumXX - sumX * sumX;
   if(MathAbs(denom) < 1e-12) return 0.0;
   return ((len * sumXY - sumX * sumY) / denom) / atr;
  }

int SplitOf(const datetime t)
  {
   if(!g_splits) return SPLIT_NA;
   if(t < g_trainEnd) return SPLIT_TRAIN;
   if(t < g_valEnd) return SPLIT_VAL;
   if(t <= InpSplitEnd) return SPLIT_OOS;
   return SPLIT_NA;
  }

bool AllowTrain(const datetime t)
  {
   if(InpTrainPolicy == TRAIN_ONLINE) return true;
   if(!g_splits) return true;
   return (t < g_trainEnd);
  }

string SplitName(const int s)
  {
   if(s == SPLIT_TRAIN) return "TRAIN";
   if(s == SPLIT_VAL) return "VALIDATION";
   if(s == SPLIT_OOS) return "OUT_OF_SAMPLE";
   return "UNSPLIT";
  }

string ExitName(const int r)
  {
   if(r == EXIT_SL) return "SL";
   if(r == EXIT_TP) return "TP";
   if(r == EXIT_TRAIL) return "TRAIL";
   if(r == EXIT_TIME) return "TIME";
   if(r == EXIT_REVERSE) return "REVERSE";
   return "OTHER";
  }

string PresetName()
  {
   if(InpPreset == PRESET_A_BASELINE) return "A baseline retest";
   if(InpPreset == PRESET_B_ML_RETEST) return "B ML retest";
   if(InpPreset == PRESET_C_BREAK) return "C break";
   if(InpPreset == PRESET_D_ML_BREAK) return "D ML break";
   return "Custom";
  }

bool IsVisual()
  {
   if(!InpShowChartDrawings) return false;
   if(g_warmup) return false;
   if(MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE)) return false;
   return true;
  }

double NormalizePx(const double price)
  {
   double tick = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double p = price;
   if(tick > 0.0) p = MathRound(price / tick) * tick;
   return NormalizeDouble(p, digits);
  }

double NormalizeVolume(const double lotsIn)
  {
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(minLot <= 0.0) minLot = 0.01;
   if(maxLot < minLot) maxLot = minLot;
   if(step <= 0.0) step = minLot;
   double lots = MathFloor(lotsIn / step + 1e-8) * step;
   if(lots + 1e-12 < minLot) return 0.0;
   if(lots > maxLot) lots = MathFloor(maxLot / step + 1e-8) * step;
   int volDigits = 0;
   double s = step;
   while(volDigits < 8 && MathAbs(s - MathRound(s)) > 1e-6)
     {
      s *= 10.0;
      volDigits++;
     }
   return NormalizeDouble(lots, volDigits);
  }

bool DataReady(const int shift)
  {
   int need = shift + InpPivotLength + InpNormWindow + 5;
   if(Bars(_Symbol, g_tf) < need) return false;
   if(BarsCalculated(g_rsi) < need) return false;
   if(BarsCalculated(g_atrH) < need) return false;
   return true;
  }

double AtrAt(const int shift)
  {
   double buf[];
   ArraySetAsSeries(buf, true);
   if(CopyBuffer(g_atrH, 0, shift, 1, buf) != 1) return 0.0;
   return buf[0];
  }

void ApplyPreset()
  {
   g_tradeRetests = InpTradeRetests;
   g_useML = InpUseML;
   g_tradeBreaks = InpTradeBreaks;
   g_breaksUseML = InpBreaksUseML;
   if(InpPreset == PRESET_A_BASELINE)
     { g_tradeRetests = true; g_useML = false; g_tradeBreaks = false; g_breaksUseML = false; }
   else if(InpPreset == PRESET_B_ML_RETEST)
     { g_tradeRetests = true; g_useML = true; g_tradeBreaks = false; g_breaksUseML = false; }
   else if(InpPreset == PRESET_C_BREAK)
     { g_tradeRetests = false; g_useML = false; g_tradeBreaks = true; g_breaksUseML = false; }
   else if(InpPreset == PRESET_D_ML_BREAK)
     { g_tradeRetests = false; g_useML = true; g_tradeBreaks = true; g_breaksUseML = true; }
  }

ENUM_TIMEFRAMES ResolveTF()
  {
   if(InpTFChoice == TF_M5) return PERIOD_M5;
   if(InpTFChoice == TF_M15) return PERIOD_M15;
   return (ENUM_TIMEFRAMES)Period();
  }

void ConfigureTrade()
  {
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpSlippagePoints);
   g_trade.SetAsyncMode(false);
   long flags = SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
   g_fill = ORDER_FILLING_RETURN;
   if((flags & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK) g_fill = ORDER_FILLING_FOK;
   else if((flags & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC) g_fill = ORDER_FILLING_IOC;
   g_trade.SetTypeFilling(g_fill);
  }

bool SelfCheck()
  {
   CLogReg tmp;
   tmp.Reset(0.25, 0.0, 1, false);
   double mid = tmp.Predict6(0, 0, 0, 0, 0, 0);
   if(MathAbs(mid - 0.5) > 1e-6)
     {
      Print("Self-check failed: sigmoid(0)=", DoubleToString(mid, 6));
      return false;
     }
   for(int i = 0; i < 250; i++)
     {
      tmp.Fit6(1, 0, 0, 0, 0, 0, 1);
      tmp.Fit6(-1, 0, 0, 0, 0, 0, 0);
     }
   double pPos = tmp.Predict6(1, 0, 0, 0, 0, 0);
   double pNeg = tmp.Predict6(-1, 0, 0, 0, 0, 0);
   if(!(pPos > 0.85 && pNeg < 0.15 && tmp.m_w[0] > 0.0))
     {
      Print("Self-check failed p+=", DoubleToString(pPos, 4),
            " p-=", DoubleToString(pNeg, 4),
            " w0=", DoubleToString(tmp.m_w[0], 4));
      return false;
     }
   Print("Logistic self-check passed. p(y=1|x=+1)=", DoubleToString(pPos, 3),
         " p(y=1|x=-1)=", DoubleToString(pNeg, 3));
   return true;
  }

//+------------------------------------------------------------------+
bool BuildFeatures(const int pivotShift, const bool isSupport, const double level, SLevel &lv)
  {
   int window = InpNormWindow;
   if(window < 30) window = 30;
   MqlRates rates[];
   double rsi[];
   double atr[];
   ArraySetAsSeries(rates, true);
   ArraySetAsSeries(rsi, true);
   ArraySetAsSeries(atr, true);
   int copied = CopyRates(_Symbol, g_tf, pivotShift, window + 1, rates);
   int cRsi = CopyBuffer(g_rsi, 0, pivotShift, window + 1, rsi);
   int cAtr = CopyBuffer(g_atrH, 0, pivotShift, window + 1, atr);
   int n = copied;
   if(cRsi < n) n = cRsi;
   if(cAtr < n) n = cAtr;
   if(n < InpPivotLength + 21) return false;
   if(!(atr[0] > 0.0) || !MathIsValidNumber(rsi[0]) || !MathIsValidNumber(atr[0])) return false;

   double closes[];
   ArrayResize(closes, n);
   for(int i = 0; i < n; i++) closes[i] = rates[i].close;

   double rawRsi[], rawBody[], rawUp[], rawDn[], rawSlope[];
   int cap = n;
   ArrayResize(rawRsi, cap);
   ArrayResize(rawBody, cap);
   ArrayResize(rawUp, cap);
   ArrayResize(rawDn, cap);
   ArrayResize(rawSlope, cap);
   int usable = 0;
   for(int i = 1; i < n; i++)
     {
      if(!(atr[i] > 0.0)) continue;
      if(i + InpPivotLength - 1 >= n) continue;
      rawRsi[usable] = rsi[i] / 100.0;
      rawBody[usable] = MathAbs(rates[i].close - rates[i].open) / atr[i];
      rawUp[usable] = (rates[i].high - MathMax(rates[i].open, rates[i].close)) / atr[i];
      rawDn[usable] = (MathMin(rates[i].open, rates[i].close) - rates[i].low) / atr[i];
      rawSlope[usable] = LinSlopeCloses(closes, i, InpPivotLength, atr[i]);
      usable++;
     }
   if(usable < 20) return false;

   double dist = 0.0;
   if(isSupport && g_hasSupport) dist = (level - g_lastSupport) / atr[0];
   if(!isSupport && g_hasResist) dist = (level - g_lastResist) / atr[0];

   lv.f0 = ZScore(rawRsi, usable, rsi[0] / 100.0);
   lv.f1 = ZScore(rawBody, usable, MathAbs(rates[0].close - rates[0].open) / atr[0]);
   lv.f2 = ZScore(rawUp, usable, (rates[0].high - MathMax(rates[0].open, rates[0].close)) / atr[0]);
   lv.f3 = ZScore(rawDn, usable, (MathMin(rates[0].open, rates[0].close) - rates[0].low) / atr[0]);
   lv.f4 = (g_f5n >= 20 ? ZScore(g_f5, g_f5n, dist) : 0.0);
   lv.f5 = ZScore(rawSlope, usable, LinSlopeCloses(closes, 0, InpPivotLength, atr[0]));

   int histCap = 600;
   if(g_f5n < histCap)
     {
      ArrayResize(g_f5, g_f5n + 1);
      g_f5[g_f5n] = dist;
      g_f5n++;
     }
   else
     {
      for(int i = 1; i < histCap; i++) g_f5[i - 1] = g_f5[i];
      g_f5[histCap - 1] = dist;
     }
   return true;
  }

bool IsPivotHigh(const int shift)
  {
   double h = iHigh(_Symbol, g_tf, shift);
   if(!(h > 0.0)) return false;
   for(int i = 1; i <= InpPivotLength; i++)
     {
      if(iHigh(_Symbol, g_tf, shift - i) >= h) return false;
      if(iHigh(_Symbol, g_tf, shift + i) >= h) return false;
     }
   return true;
  }

bool IsPivotLow(const int shift)
  {
   double v = iLow(_Symbol, g_tf, shift);
   if(!(v > 0.0)) return false;
   for(int i = 1; i <= InpPivotLength; i++)
     {
      if(iLow(_Symbol, g_tf, shift - i) <= v) return false;
      if(iLow(_Symbol, g_tf, shift + i) <= v) return false;
     }
   return true;
  }

bool TooClose(const bool isSupport, const double price, const double atr)
  {
   if(InpMergeATR <= 0.0 || !(atr > 0.0)) return false;
   double gate = atr * InpMergeATR;
   int n = ArraySize(g_levels);
   for(int i = 0; i < n; i++)
     {
      if(g_levels[i].dead || g_levels[i].state != 0) continue;
      if(g_levels[i].isSupport != isSupport) continue;
      if(MathAbs(g_levels[i].price - price) <= gate) return true;
     }
   return false;
  }

void AddPivot(const int closedShift, const bool isSupport)
  {
   int pivotShift = closedShift + InpPivotLength;
   double price = isSupport ? iLow(_Symbol, g_tf, pivotShift) : iHigh(_Symbol, g_tf, pivotShift);
   double atr = AtrAt(pivotShift);
   if(!(price > 0.0) || !(atr > 0.0)) return;
   if(TooClose(isSupport, price, atr))
     {
      g_merged++;
      return;
     }
   SLevel lv;
   ZeroMemory(lv);
   if(!BuildFeatures(pivotShift, isSupport, price, lv)) return;
   lv.isSupport = isSupport;
   lv.price = price;
   lv.pivotTime = iTime(_Symbol, g_tf, pivotShift);
   lv.confirmTime = iTime(_Symbol, g_tf, closedShift);
   lv.pivotSeq = g_barSeq - InpPivotLength;
   lv.confirmSeq = g_barSeq;
   lv.lastRetestSeq = -100000;
   lv.state = 0;
   lv.probability = g_model.Predict6(lv.f0, lv.f1, lv.f2, lv.f3, lv.f4, lv.f5);
   int n = ArraySize(g_levels);
   ArrayResize(g_levels, n + 1);
   g_levels[n] = lv;
   if(isSupport) { g_lastSupport = price; g_hasSupport = true; }
   else          { g_lastResist = price; g_hasResist = true; }
   g_pivots++;
  }

void QueueSample(SLevel &lv)
  {
   if(lv.trained || !lv.labelLocked) return;
   int n = ArraySize(g_queue);
   if(g_qcount >= n) ArrayResize(g_queue, g_qcount + 8);
   g_queue[g_qcount].f0 = lv.f0;
   g_queue[g_qcount].f1 = lv.f1;
   g_queue[g_qcount].f2 = lv.f2;
   g_queue[g_qcount].f3 = lv.f3;
   g_queue[g_qcount].f4 = lv.f4;
   g_queue[g_qcount].f5 = lv.f5;
   g_queue[g_qcount].y = lv.label;
   g_qcount++;
   lv.trained = true;
  }

void FlushTraining(const datetime t)
  {
   if(!AllowTrain(t))
     {
      g_trainDropped += g_qcount;
      g_qcount = 0;
      return;
     }
   for(int i = 0; i < g_qcount; i++)
      g_model.Fit6(g_queue[i].f0, g_queue[i].f1, g_queue[i].f2,
                   g_queue[i].f3, g_queue[i].f4, g_queue[i].f5, g_queue[i].y);
   g_qcount = 0;
  }

//+------------------------------------------------------------------+
string LevelLineName(const SLevel &lv)
  {
   return StringFormat("%sL_%I64d_%s", PREFIX, (long)lv.pivotTime, (lv.isSupport ? "S" : "R"));
  }

string LevelProbName(const SLevel &lv)
  {
   return StringFormat("%sP_%I64d_%s", PREFIX, (long)lv.pivotTime, (lv.isSupport ? "S" : "R"));
  }

void StyleLine(const string name, const color clr)
  {
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, InpLineWidth);
   ObjectSetInteger(0, name, OBJPROP_STYLE, InpLineStyle);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, name, OBJPROP_RAY_LEFT, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_ZORDER, g_objSeq++);
  }

void EnsureLevelLine(const SLevel &lv, const datetime t2)
  {
   if(!IsVisual()) return;
   string name = LevelLineName(lv);
   color clr = lv.isSupport ? InpSupportColor : InpResistanceColor;
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_TREND, 0, lv.confirmTime, lv.price, t2, lv.price);
      StyleLine(name, clr);
     }
   else
      ObjectMove(0, name, 1, t2, lv.price);
  }

void EnsureProbLabel(const SLevel &lv, const datetime t2)
  {
   if(!IsVisual()) return;
   string name = LevelProbName(lv);
   bool mlOn = (g_useML || g_breaksUseML);
   bool show = mlOn && lv.probability + 1e-12 >= InpProbThreshold;
   if(!show)
     {
      if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
      return;
     }
   string text = StringFormat("%s %.0f%%", (lv.isSupport ? "SR" : "RS"), lv.probability * 100.0);
   color clr = lv.isSupport ? InpSupportColor : InpResistanceColor;
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_TEXT, 0, t2, lv.price);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetString(0, name, OBJPROP_FONT, InpFontName);
      ObjectSetInteger(0, name, OBJPROP_ZORDER, g_objSeq++);
     }
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, lv.isSupport ? ANCHOR_LEFT_UPPER : ANCHOR_LEFT_LOWER);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectMove(0, name, 0, t2, lv.price);
  }

void PutText(const string kind, const datetime t, const double price, const string text, const bool below)
  {
   if(!IsVisual()) return;
   string name = StringFormat("%s%s_%d", PREFIX, kind, g_objSeq++);
   ObjectCreate(0, name, OBJ_TEXT, 0, t, price);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetString(0, name, OBJPROP_FONT, InpFontName);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, InpFontSize);
   ObjectSetInteger(0, name, OBJPROP_COLOR, InpTextColor);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, below ? ANCHOR_LEFT_UPPER : ANCHOR_LEFT_LOWER);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_ZORDER, g_objSeq);
  }

void MarkRetest(const SLevel &lv, const datetime t)
  {
   PutText("R", t, lv.price, "R", lv.isSupport);
  }

void MarkBreak(const SLevel &lv, const datetime t)
  {
   PutText("B", t, lv.price, "B", !lv.isSupport);
  }

void DeleteLevelObjects(const SLevel &lv)
  {
   if(!InpShowChartDrawings) return;
   ObjectDelete(0, LevelLineName(lv));
   ObjectDelete(0, LevelProbName(lv));
  }

void RefreshLevelDrawings()
  {
   if(!IsVisual()) return;
   datetime t2 = iTime(_Symbol, g_tf, 0);
   if(t2 <= 0) t2 = TimeCurrent();
   int n = ArraySize(g_levels);
   for(int i = 0; i < n; i++)
     {
      if(g_levels[i].dead || g_levels[i].state != 0) continue;
      EnsureLevelLine(g_levels[i], t2);
      EnsureProbLabel(g_levels[i], t2);
     }
  }

void DrawEntry(const int dir, const datetime t, const double price)
  {
   if(!IsVisual()) return;
   string name = StringFormat("%sE_%d", PREFIX, g_objSeq++);
   ObjectCreate(0, name, OBJ_ARROW, 0, t, price);
   ObjectSetInteger(0, name, OBJPROP_ARROWCODE, dir > 0 ? 233 : 234);
   ObjectSetInteger(0, name, OBJPROP_COLOR, dir > 0 ? InpSupportColor : InpResistanceColor);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, InpLineWidth);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, dir > 0 ? ANCHOR_TOP : ANCHOR_BOTTOM);
   ObjectSetInteger(0, name, OBJPROP_ZORDER, g_objSeq);
  }

string SlName() { return PREFIX + "SL_OPEN"; }
string TpName() { return PREFIX + "TP_OPEN"; }

void UpdateTradeDrawings()
  {
   if(!IsVisual()) return;
   if(!g_open.active)
     {
      ObjectDelete(0, SlName());
      ObjectDelete(0, TpName());
      return;
     }
   datetime t2 = iTime(_Symbol, g_tf, 0);
   if(t2 <= 0) t2 = TimeCurrent();
   if(ObjectFind(0, SlName()) < 0)
     {
      ObjectCreate(0, SlName(), OBJ_TREND, 0, g_open.entryTime, g_open.sl, t2, g_open.sl);
      StyleLine(SlName(), InpResistanceColor);
      ObjectSetInteger(0, SlName(), OBJPROP_STYLE, STYLE_DASH);
     }
   else
     {
      ObjectMove(0, SlName(), 0, g_open.entryTime, g_open.sl);
      ObjectMove(0, SlName(), 1, t2, g_open.sl);
     }
   if(ObjectFind(0, TpName()) < 0)
     {
      ObjectCreate(0, TpName(), OBJ_TREND, 0, g_open.entryTime, g_open.tp, t2, g_open.tp);
      StyleLine(TpName(), InpSupportColor);
      ObjectSetInteger(0, TpName(), OBJPROP_STYLE, STYLE_DASH);
     }
   else
     {
      ObjectMove(0, TpName(), 0, g_open.entryTime, g_open.tp);
      ObjectMove(0, TpName(), 1, t2, g_open.tp);
     }
  }

void TrimDrawings()
  {
   if(!IsVisual()) return;
   if(InpMaxDrawings < 10) return;
   int guard = 0;
   while(guard < 400)
     {
      guard++;
      int total = ObjectsTotal(0, -1, -1);
      int prefixed = 0;
      string oldest = "";
      long oldestZ = 0;
      bool found = false;
      for(int i = 0; i < total; i++)
        {
         string name = ObjectName(0, i);
         if(StringFind(name, PREFIX) != 0) continue;
         prefixed++;
         if(StringFind(name, PREFIX + "L_") == 0) continue;
         if(StringFind(name, PREFIX + "P_") == 0) continue;
         if(name == SlName() || name == TpName()) continue;
         long z = (long)ObjectGetInteger(0, name, OBJPROP_ZORDER);
         if(!found || z < oldestZ)
           {
            found = true;
            oldest = name;
            oldestZ = z;
           }
        }
      if(prefixed <= InpMaxDrawings || !found) break;
      ObjectDelete(0, oldest);
     }
  }

void DeleteAllObjects()
  {
   ObjectsDeleteAll(0, PREFIX);
  }

//+------------------------------------------------------------------+
bool OurPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      return true;
     }
   return false;
  }

void RememberWeights()
  {
   g_open.bias = g_model.m_bias;
   g_open.w0 = g_model.m_w[0];
   g_open.w1 = g_model.m_w[1];
   g_open.w2 = g_model.m_w[2];
   g_open.w3 = g_model.m_w[3];
   g_open.w4 = g_model.m_w[4];
   g_open.w5 = g_model.m_w[5];
   g_open.samplesAtEntry = g_model.m_samples;
  }

bool TryLink()
  {
   if(!OurPosition()) return false;
   g_open.ticket = (ulong)PositionGetInteger(POSITION_TICKET);
   g_open.posId = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
   g_open.entryPrice = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl = PositionGetDouble(POSITION_SL);
   double tp = PositionGetDouble(POSITION_TP);
   if(sl > 0.0) g_open.sl = sl;
   if(tp > 0.0) g_open.tp = tp;
   g_open.lots = PositionGetDouble(POSITION_VOLUME);
   g_open.awaitLink = false;
   g_open.active = true;
   return true;
  }

bool StopsValid(const bool isBuy, const double price, const double sl, const double tp)
  {
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int stops = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   int freeze = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   int gate = stops;
   if(freeze > gate) gate = freeze;
   double minDist = gate * point;
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(!(MathAbs(price - sl) > point) || !(MathAbs(price - tp) > point)) return false;
   if(isBuy)
     {
      if(!(sl < price && tp > price)) return false;
      if(!(sl < bid - minDist)) return false;
      if(!(tp > ask + minDist)) return false;
     }
   else
     {
      if(!(sl > price && tp < price)) return false;
      if(!(sl > ask + minDist)) return false;
      if(!(tp < bid - minDist)) return false;
     }
   return true;
  }

double LotFor(const bool isBuy, const double entry, const double sl)
  {
   if(!InpUseRiskPercent) return NormalizeVolume(InpFixedLots);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = balance * InpRiskPercent / 100.0;
   if(!(riskMoney > 0.0)) return 0.0;
   double profit = 0.0;
   ENUM_ORDER_TYPE type = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(!OrderCalcProfit(type, _Symbol, 1.0, entry, sl, profit)) return 0.0;
   double loss = MathAbs(profit);
   if(!(loss > 0.0)) return 0.0;
   return NormalizeVolume(riskMoney / loss);
  }

void UpdateDayLock()
  {
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int key = dt.year * 1000 + dt.day_of_year;
   if(key != g_dayKey)
     {
      g_dayKey = key;
      g_dayEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      g_dayLocked = false;
      g_dayNoted = false;
     }
   if(InpMaxDailyLossPct <= 0.0 || !(g_dayEquity > 0.0)) return;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double lossPct = (g_dayEquity - eq) / g_dayEquity * 100.0;
   if(lossPct >= InpMaxDailyLossPct)
     {
      g_dayLocked = true;
      if(!g_dayNoted)
        {
         g_dayNoted = true;
         Print("Daily loss limit hit (", DoubleToString(lossPct, 2), "%). No new trades until tomorrow.");
        }
     }
  }

void SampleOne(SDD &d, const double eq)
  {
   if(!d.init)
     {
      d.init = true;
      d.peak = eq;
      d.maxDD = 0.0;
      d.maxDDPct = 0.0;
      return;
     }
   if(eq > d.peak) d.peak = eq;
   double dd = d.peak - eq;
   if(dd > d.maxDD) d.maxDD = dd;
   if(d.peak > 0.0)
     {
      double pct = dd / d.peak * 100.0;
      if(pct > d.maxDDPct) d.maxDDPct = pct;
     }
  }

void SampleDD()
  {
   if(g_warmup) return;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   SampleOne(g_ddAll, eq);
   int sp = SplitOf(TimeCurrent());
   if(sp == SPLIT_TRAIN) SampleOne(g_ddTrain, eq);
   else if(sp == SPLIT_VAL) SampleOne(g_ddVal, eq);
   else if(sp == SPLIT_OOS) SampleOne(g_ddOos, eq);
  }

bool PassFilter(SSignal &s)
  {
   g_signals++;
   if(s.mlGate && g_model.m_samples < InpMinTrainSamples)
     {
      if(!InpFallbackBaseline)
        {
         g_skipWarm++;
         return false;
        }
      s.mlGate = false;
     }
   if(s.mlGate && s.probability + 1e-12 < InpProbThreshold)
     {
      g_skipML++;
      return false;
     }
   return true;
  }

void Consider(SSignal &best, SSignal &s)
  {
   if(!PassFilter(s)) return;
   if(!best.valid || s.score > best.score) best = s;
  }

void EvalLevel(SLevel &lv, const int shift, const double atr, const double tol, SSignal &best)
  {
   if(lv.dead || lv.state != 0) return;
   if(lv.confirmSeq >= g_barSeq) return;

   double high = iHigh(_Symbol, g_tf, shift);
   double low = iLow(_Symbol, g_tf, shift);
   double close = iClose(_Symbol, g_tf, shift);
   datetime t = iTime(_Symbol, g_tf, shift);
   int age = g_barSeq - lv.pivotSeq;

   bool broken = false;
   bool retest = false;
   if(lv.isSupport)
     {
      if(close < lv.price) broken = true;
      else if(low <= lv.price + tol && close > lv.price &&
              (!lv.hasRetest || (g_barSeq - lv.lastRetestSeq) > InpRetestCooldown))
         retest = true;
     }
   else
     {
      if(close > lv.price) broken = true;
      else if(high >= lv.price - tol && close < lv.price &&
              (!lv.hasRetest || (g_barSeq - lv.lastRetestSeq) > InpRetestCooldown))
         retest = true;
     }

   if(!broken && !retest && age >= InpMaxLevelAgeBars)
     {
      lv.state = 2;
      lv.dead = true;
      g_expired++;
      if(!lv.labelLocked)
        {
         lv.labelLocked = true;
         lv.label = 0;
         QueueSample(lv);
        }
      return;
     }

   if(retest)
     {
      lv.respects++;
      lv.hasRetest = true;
      lv.lastRetestSeq = g_barSeq;
      g_retests++;
      MarkRetest(lv, t);
      if(!lv.labelLocked && lv.respects >= InpTargetRespects)
        {
         lv.labelLocked = true;
         lv.label = 1;
         QueueSample(lv);
        }
      if(!g_warmup && g_tradeRetests && atr > 0.0)
        {
         SSignal s;
         ZeroMemory(s);
         s.valid = true;
         s.dir = lv.isSupport ? 1 : -1;
         s.kind = 1;
         s.level = lv.price;
         s.pivotTime = lv.pivotTime;
         s.isSupport = lv.isSupport;
         s.f0 = lv.f0; s.f1 = lv.f1; s.f2 = lv.f2;
         s.f3 = lv.f3; s.f4 = lv.f4; s.f5 = lv.f5;
         s.atr = atr;
         s.probability = g_model.Predict6(lv.f0, lv.f1, lv.f2, lv.f3, lv.f4, lv.f5);
         lv.probability = s.probability;
         s.mlGate = g_useML;
         s.score = s.mlGate ? s.probability : -MathAbs(close - lv.price);
         Consider(best, s);
        }
      else
         lv.probability = g_model.Predict6(lv.f0, lv.f1, lv.f2, lv.f3, lv.f4, lv.f5);
     }
   else if(broken)
     {
      if(!lv.labelLocked)
        {
         lv.labelLocked = true;
         lv.label = 0;
         QueueSample(lv);
        }
      g_breaks++;
      MarkBreak(lv, t);
      if(!g_warmup && g_tradeBreaks && atr > 0.0)
        {
         SSignal s;
         ZeroMemory(s);
         s.valid = true;
         s.dir = lv.isSupport ? -1 : 1;
         s.kind = 2;
         s.level = lv.price;
         s.pivotTime = lv.pivotTime;
         s.isSupport = lv.isSupport;
         s.f0 = lv.f0; s.f1 = lv.f1; s.f2 = lv.f2;
         s.f3 = lv.f3; s.f4 = lv.f4; s.f5 = lv.f5;
         s.atr = atr;
         s.probability = g_model.Predict6(lv.f0, lv.f1, lv.f2, lv.f3, lv.f4, lv.f5);
         lv.probability = s.probability;
         s.mlGate = g_breaksUseML;
         s.score = s.mlGate ? s.probability : -MathAbs(close - lv.price);
         Consider(best, s);
        }
      lv.state = 1;
      lv.dead = true;
     }
  }

//+------------------------------------------------------------------+
void OpenSignal(const SSignal &s)
  {
   if(!s.valid || g_warmup) return;
   if(g_open.active || OurPosition())
     {
      g_skipPos++;
      return;
     }
   if(g_dayLocked)
     {
      g_skipDay++;
      return;
     }
   if(InpMaxSpreadPoints > 0)
     {
      long spr = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      if(spr > InpMaxSpreadPoints)
        {
         g_skipSpread++;
         return;
        }
     }
   bool isBuy = (s.dir > 0);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double entry = isBuy ? ask : bid;
   if(!(entry > 0.0) || !(s.atr > 0.0)) return;

   double sl = isBuy ? (s.level - InpSL_ATR_Mult * s.atr)
                     : (s.level + InpSL_ATR_Mult * s.atr);
   double slDist = MathAbs(entry - sl);
   double tp = 0.0;
   if(InpUseRiskReward)
      tp = isBuy ? entry + slDist * InpRiskReward : entry - slDist * InpRiskReward;
   else
      tp = isBuy ? entry + InpTP_ATR_Mult * s.atr : entry - InpTP_ATR_Mult * s.atr;
   sl = NormalizePx(sl);
   tp = NormalizePx(tp);
   if(!StopsValid(isBuy, entry, sl, tp))
     {
      g_skipStops++;
      if(InpVerbose)
         Print("Stop/freeze rejected ", (isBuy ? "BUY " : "SELL "),
               " entry ", DoubleToString(entry, _Digits),
               " sl ", DoubleToString(sl, _Digits),
               " tp ", DoubleToString(tp, _Digits));
      return;
     }
   double lots = LotFor(isBuy, entry, sl);
   if(!(lots > 0.0))
     {
      g_skipLots++;
      return;
     }
   double margin = 0.0;
   ENUM_ORDER_TYPE otype = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(!OrderCalcMargin(otype, _Symbol, lots, entry, margin) ||
      margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE))
     {
      g_skipMargin++;
      return;
     }

   string cmt = StringFormat("%s %s%s %s%.0f",
                             InpOrderComment,
                             (s.isSupport ? "S" : "R"),
                             (s.kind == 1 ? "RT" : "BR"),
                             (s.mlGate ? "M" : "B"),
                             s.probability * 100.0);
   if(StringLen(cmt) > 31) cmt = StringSubstr(cmt, 0, 31);

   bool ok = isBuy ? g_trade.Buy(lots, _Symbol, 0.0, sl, tp, cmt)
                   : g_trade.Sell(lots, _Symbol, 0.0, sl, tp, cmt);
   if(!ok)
     {
      g_orderFail++;
      Print("Order failed ", g_trade.ResultRetcode(), " ", g_trade.ResultRetcodeDescription());
      return;
     }

   ZeroMemory(g_open);
   g_open.active = true;
   g_open.awaitLink = true;
   g_open.entryTime = TimeCurrent();
   g_open.entrySeq = g_barSeq;
   g_open.dir = s.dir;
   g_open.entryPrice = entry;
   g_open.sl = sl;
   g_open.tp = tp;
   g_open.lots = lots;
   g_open.level = s.level;
   g_open.pivotTime = s.pivotTime;
   g_open.isSupport = s.isSupport ? 1 : 0;
   g_open.kind = s.kind;
   g_open.probability = s.probability;
   g_open.mlGate = s.mlGate ? 1 : 0;
   g_open.f0 = s.f0; g_open.f1 = s.f1; g_open.f2 = s.f2;
   g_open.f3 = s.f3; g_open.f4 = s.f4; g_open.f5 = s.f5;
   g_open.split = SplitOf(g_open.entryTime);
   g_open.pendingExit = EXIT_NONE;
   RememberWeights();
   TryLink();
   DrawEntry(s.dir, iTime(_Symbol, g_tf, 0), isBuy ? ask : bid);
   UpdateTradeDrawings();
   Print("Open ", (isBuy ? "BUY" : "SELL"),
         " ", (s.kind == 1 ? "retest" : "break"),
         " lots=", DoubleToString(lots, 2),
         " lvl=", DoubleToString(s.level, _Digits),
         " p=", DoubleToString(s.probability, 3),
         " ", (s.mlGate ? "ML" : "baseline"));
  }

void CloseOur(const int reason)
  {
   if(!OurPosition()) return;
   g_open.pendingExit = reason;
   ulong ticket = (ulong)PositionGetInteger(POSITION_TICKET);
   if(!g_trade.PositionClose(ticket))
     {
      g_orderFail++;
      Print("Close failed ", g_trade.ResultRetcodeDescription());
     }
  }

void Execute(const SSignal &s)
  {
   if(!s.valid || g_warmup) return;
   if(OurPosition() || g_open.active)
     {
      int dir = 0;
      if(OurPosition())
         dir = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
      else
         dir = g_open.dir;
      if(InpAllowReverse && dir != 0 && dir != s.dir)
        {
         g_pending = s;
         g_pending.valid = true;
         CloseOur(EXIT_REVERSE);
         return;
        }
      g_skipPos++;
      return;
     }
   OpenSignal(s);
  }

bool ModifyAllowed(const bool isBuy, const double newSl)
  {
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int freeze = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   int stops = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   int gate = freeze;
   if(stops > gate) gate = stops;
   double minDist = gate * point;
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(isBuy) return (newSl < bid - minDist);
   return (newSl > ask + minDist);
  }

void ManagePosition(const int shift)
  {
   if(!g_open.active && !OurPosition()) return;
   if(g_open.awaitLink) TryLink();
   if(!OurPosition()) return;
   if(!g_open.active) return;
   if(g_barSeq <= g_open.entrySeq) return;

   int held = g_barSeq - g_open.entrySeq;
   if(InpMaxTradeBars > 0 && held >= InpMaxTradeBars)
     {
      CloseOur(EXIT_TIME);
      return;
     }
   if(!InpUseTrailing) return;
   double atr = AtrAt(shift);
   double close = iClose(_Symbol, g_tf, shift);
   if(!(atr > 0.0) || !(close > 0.0)) return;
   bool isBuy = (g_open.dir > 0);
   double move = isBuy ? (close - g_open.entryPrice) : (g_open.entryPrice - close);
   if(move < InpTrailStartATR * atr) return;
   double raw = isBuy ? (close - InpTrailATRMult * atr) : (close + InpTrailATRMult * atr);
   double nsl = NormalizePx(raw);
   double cur = PositionGetDouble(POSITION_SL);
   double tick = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick <= 0.0) tick = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   bool better = isBuy ? (nsl > cur + tick) : (cur <= 0.0 || nsl < cur - tick);
   if(!better) return;
   if(!ModifyAllowed(isBuy, nsl)) return;
   double tp = PositionGetDouble(POSITION_TP);
   ulong ticket = (ulong)PositionGetInteger(POSITION_TICKET);
   if(g_trade.PositionModify(ticket, nsl, tp))
     {
      g_open.sl = nsl;
      g_open.trailMoved = true;
      UpdateTradeDrawings();
     }
  }

bool FinalizeFromHistory()
  {
   if(!g_open.active) return false;
   datetime from = g_open.entryTime - 120;
   if(from < 0) from = 0;
   if(!HistorySelect(from, TimeCurrent() + 5)) return false;

   ulong posId = g_open.posId;
   if(posId == 0)
     {
      int deals = HistoryDealsTotal();
      for(int i = deals - 1; i >= 0; i--)
        {
         ulong deal = HistoryDealGetTicket(i);
         if(deal == 0) continue;
         if(HistoryDealGetString(deal, DEAL_SYMBOL) != _Symbol) continue;
         if((ulong)HistoryDealGetInteger(deal, DEAL_MAGIC) != InpMagic) continue;
         if(HistoryDealGetInteger(deal, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
         posId = (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);
         break;
        }
     }
   if(posId == 0) return false;

   double profit = 0.0, comm = 0.0, swap = 0.0;
   double exitPrice = 0.0, entryPrice = g_open.entryPrice;
   datetime exitTime = 0;
   long dealReason = -1;
   bool sawOut = false;
   int deals2 = HistoryDealsTotal();
   for(int i = 0; i < deals2; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if((ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID) != posId) continue;
      profit += HistoryDealGetDouble(deal, DEAL_PROFIT);
      comm += HistoryDealGetDouble(deal, DEAL_COMMISSION);
      swap += HistoryDealGetDouble(deal, DEAL_SWAP);
      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN)
         entryPrice = HistoryDealGetDouble(deal, DEAL_PRICE);
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY)
        {
         sawOut = true;
         exitPrice = HistoryDealGetDouble(deal, DEAL_PRICE);
         exitTime = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
         dealReason = HistoryDealGetInteger(deal, DEAL_REASON);
        }
     }
   if(!sawOut) return false;

   int reason = EXIT_OTHER;
   if(g_open.pendingExit == EXIT_TIME || g_open.pendingExit == EXIT_REVERSE)
      reason = g_open.pendingExit;
   else if(dealReason == DEAL_REASON_TP) reason = EXIT_TP;
   else if(dealReason == DEAL_REASON_SL) reason = (g_open.trailMoved ? EXIT_TRAIL : EXIT_SL);

   int held = 0;
   int sh = iBarShift(_Symbol, g_tf, g_open.entryTime, false);
   if(sh >= 0) held = sh;

   STrade tr;
   ZeroMemory(tr);
   tr.entryTime = g_open.entryTime;
   tr.exitTime = exitTime;
   tr.dir = g_open.dir;
   tr.entryPrice = entryPrice;
   tr.exitPrice = exitPrice;
   tr.sl = g_open.sl;
   tr.tp = g_open.tp;
   tr.profit = profit;
   tr.commission = comm;
   tr.swap = swap;
   tr.exitReason = reason;
   tr.barsHeld = held;
   tr.level = g_open.level;
   tr.pivotTime = g_open.pivotTime;
   tr.isSupport = g_open.isSupport;
   tr.kind = g_open.kind;
   tr.probability = g_open.probability;
   tr.mlGate = g_open.mlGate;
   tr.f0 = g_open.f0; tr.f1 = g_open.f1; tr.f2 = g_open.f2;
   tr.f3 = g_open.f3; tr.f4 = g_open.f4; tr.f5 = g_open.f5;
   tr.bias = g_open.bias;
   tr.w0 = g_open.w0; tr.w1 = g_open.w1; tr.w2 = g_open.w2;
   tr.w3 = g_open.w3; tr.w4 = g_open.w4; tr.w5 = g_open.w5;
   tr.samplesAtEntry = g_open.samplesAtEntry;
   tr.split = g_open.split;

   int n = ArraySize(g_trades);
   ArrayResize(g_trades, n + 1);
   g_trades[n] = tr;

   double net = profit + comm + swap;
   Print("Close ", (tr.dir > 0 ? "BUY" : "SELL"),
         " ", ExitName(reason),
         " net=", DoubleToString(net, 2),
         " p=", DoubleToString(tr.probability, 3),
         " ", (tr.mlGate == 1 ? "ML" : "baseline"),
         " ", SplitName(tr.split));

   int pendingReason = g_open.pendingExit;
   ZeroMemory(g_open);
   ObjectDelete(0, SlName());
   ObjectDelete(0, TpName());
   if(pendingReason != EXIT_REVERSE) g_pending.valid = false;
   return true;
  }

void MaybeOpenPending()
  {
   if(!g_pending.valid || g_open.active || OurPosition()) return;
   SSignal s = g_pending;
   g_pending.valid = false;
   OpenSignal(s);
  }

void PollExit()
  {
   if(!g_open.active) return;
   if(OurPosition())
     {
      if(g_open.awaitLink) TryLink();
      return;
     }
   if(FinalizeFromHistory()) return;
   if(g_open.awaitLink && (TimeCurrent() - g_open.entryTime) > 15)
     {
      Print("Entry did not remain open. Clearing the slot.");
      ZeroMemory(g_open);
      g_pending.valid = false;
     }
  }

//+------------------------------------------------------------------+
void ProcessClosedBar(const int shift)
  {
   if(!DataReady(shift)) return;
   datetime t = iTime(_Symbol, g_tf, shift);
   if(t <= 0) return;
   g_barSeq++;
   if(g_firstBar == 0) g_firstBar = t;
   g_lastClosed = t;

   SSignal best;
   ZeroMemory(best);
   g_qcount = 0;
   double atr = AtrAt(shift);
   double tol = (atr > 0.0 ? atr * InpTouchATRMult : 0.0);

   int n = ArraySize(g_levels);
   for(int i = 0; i < n; i++)
      EvalLevel(g_levels[i], shift, atr, tol, best);

   if(!g_warmup && best.valid)
      Execute(best);

   FlushTraining(t);

   for(int i = ArraySize(g_levels) - 1; i >= 0; i--)
     {
      if(!g_levels[i].dead) continue;
      DeleteLevelObjects(g_levels[i]);
      ArrayRemove(g_levels, i, 1);
     }

   int pivotShift = shift + InpPivotLength;
   if(IsPivotLow(pivotShift)) AddPivot(shift, true);
   if(IsPivotHigh(pivotShift)) AddPivot(shift, false);

   if(!g_warmup)
     {
      ManagePosition(shift);
      RefreshLevelDrawings();
      UpdateTradeDrawings();
      TrimDrawings();
      if(IsVisual()) ChartRedraw(0);
     }
  }

void WarmupHistory()
  {
   if(MQLInfoInteger(MQL_TESTER)) return;
   if(InpWarmupBars <= 0) return;
   int bars = Bars(_Symbol, g_tf);
   int maxShift = bars - InpPivotLength - InpNormWindow - 6;
   if(maxShift > InpWarmupBars) maxShift = InpWarmupBars;
   if(maxShift < 2) return;
   g_warmup = true;
   for(int shift = maxShift; shift >= 1; shift--)
      ProcessClosedBar(shift);
   g_warmup = false;
   g_lastBar0 = iTime(_Symbol, g_tf, 0);
   Print("Warmup done. Closed bars=", g_barSeq,
         " active levels=", ArraySize(g_levels),
         " samples=", g_model.m_samples,
         " positives=", g_model.m_pos);
   RefreshLevelDrawings();
   if(IsVisual()) ChartRedraw(0);
  }

//+------------------------------------------------------------------+
string CsvEscape(const string v)
  {
   string s = v;
   StringReplace(s, "\"", "'");
   return s;
  }

void WriteCSV()
  {
   if(!InpExportCSV) return;
   int h = FileOpen(g_csvName, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ);
   if(h == INVALID_HANDLE)
     {
      Print("CSV open failed ", GetLastError(), " name=", g_csvName);
      return;
     }
   FileWriteString(h,
      "entry_time,exit_time,direction,entry_price,exit_price,sl,tp,profit,commission,swap,net,exit_reason,bars_held,seconds_held,pivot_time,pivot_level,level_type,signal_type,probability,ml_approved,split,");
   FileWriteString(h, "f_rsi,f_body,f_upper,f_lower,f_dist,f_slope,bias,w1,w2,w3,w4,w5,w6,train_samples\r\n");
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   int n = ArraySize(g_trades);
   for(int i = 0; i < n; i++)
     {
      STrade tr = g_trades[i];
      double net = tr.profit + tr.commission + tr.swap;
      long secs = (long)tr.exitTime - (long)tr.entryTime;
      string line = TimeToString(tr.entryTime, TIME_DATE | TIME_SECONDS) + ","
         + TimeToString(tr.exitTime, TIME_DATE | TIME_SECONDS) + ","
         + (tr.dir > 0 ? "BUY" : "SELL") + ","
         + DoubleToString(tr.entryPrice, digits) + ","
         + DoubleToString(tr.exitPrice, digits) + ","
         + DoubleToString(tr.sl, digits) + ","
         + DoubleToString(tr.tp, digits) + ","
         + DoubleToString(tr.profit, 2) + ","
         + DoubleToString(tr.commission, 2) + ","
         + DoubleToString(tr.swap, 2) + ","
         + DoubleToString(net, 2) + ","
         + ExitName(tr.exitReason) + ","
         + IntegerToString(tr.barsHeld) + ","
         + IntegerToString((int)secs) + ","
         + TimeToString(tr.pivotTime, TIME_DATE | TIME_SECONDS) + ","
         + DoubleToString(tr.level, digits) + ","
         + (tr.isSupport == 1 ? "support" : "resistance") + ","
         + (tr.kind == 1 ? "retest" : "break") + ","
         + DoubleToString(tr.probability, 6) + ","
         + (tr.mlGate == 1 ? "ML" : "baseline") + ","
         + SplitName(tr.split) + ","
         + DoubleToString(tr.f0, 6) + ","
         + DoubleToString(tr.f1, 6) + ","
         + DoubleToString(tr.f2, 6) + ","
         + DoubleToString(tr.f3, 6) + ","
         + DoubleToString(tr.f4, 6) + ","
         + DoubleToString(tr.f5, 6) + ","
         + DoubleToString(tr.bias, 6) + ","
         + DoubleToString(tr.w0, 6) + ","
         + DoubleToString(tr.w1, 6) + ","
         + DoubleToString(tr.w2, 6) + ","
         + DoubleToString(tr.w3, 6) + ","
         + DoubleToString(tr.w4, 6) + ","
         + DoubleToString(tr.w5, 6) + ","
         + IntegerToString(tr.samplesAtEntry);
      FileWriteString(h, line + "\r\n");
     }
   FileClose(h);
   Print("CSV written: ", TerminalInfoString(TERMINAL_DATA_PATH), "\\MQL5\\Files\\", g_csvName,
         " trades=", n);
  }

void BlockStats(const string title, const int splitFilter, const SDD &dd, string &fileBody, double &outPF, int &outTrades)
  {
   int trades = 0, wins = 0, losses = 0, longs = 0, shorts = 0, longWins = 0, shortWins = 0;
   int mlN = 0, baseN = 0;
   double net = 0.0, grossWin = 0.0, grossLoss = 0.0, secs = 0.0;
   int n = ArraySize(g_trades);
   for(int i = 0; i < n; i++)
     {
      if(splitFilter != -1 && g_trades[i].split != splitFilter) continue;
      double pnl = g_trades[i].profit + g_trades[i].commission + g_trades[i].swap;
      trades++;
      net += pnl;
      secs += (double)((long)g_trades[i].exitTime - (long)g_trades[i].entryTime);
      if(g_trades[i].dir > 0) { longs++; if(pnl > 0.0) longWins++; }
      else { shorts++; if(pnl > 0.0) shortWins++; }
      if(g_trades[i].mlGate == 1) mlN++;
      else baseN++;
      if(pnl > 0.0) { wins++; grossWin += pnl; }
      else if(pnl < 0.0) { losses++; grossLoss += -pnl; }
     }
   double winRate = (trades > 0 ? 100.0 * wins / trades : 0.0);
   double pf = (grossLoss > 0.0 ? grossWin / grossLoss : (grossWin > 0.0 ? 999.0 : 0.0));
   double exp = (trades > 0 ? net / trades : 0.0);
   double avgWin = (wins > 0 ? grossWin / wins : 0.0);
   double avgLoss = (losses > 0 ? -(grossLoss / losses) : 0.0);
   double avgSec = (trades > 0 ? secs / trades : 0.0);
   double longWR = (longs > 0 ? 100.0 * longWins / longs : 0.0);
   double shortWR = (shorts > 0 ? 100.0 * shortWins / shorts : 0.0);
   string pfText = (grossLoss > 0.0 ? DoubleToString(pf, 3) : (grossWin > 0.0 ? "inf" : "0"));
   string block = StringFormat(
      "--- %s ---\nTrades %d  Wins %d  Losses %d  WinRate %s%%\nNet %s  ProfitFactor %s  Expectancy %s\nMaxDD %s (%s%%)  AvgWin %s  AvgLoss %s\nAvgDuration %s sec\nLong %d (win %s%%)  Short %d (win %s%%)\nML-approved trades %d  Baseline trades %d\n",
      title, trades, wins, losses, DoubleToString(winRate, 2),
      DoubleToString(net, 2), pfText, DoubleToString(exp, 2),
      DoubleToString(dd.maxDD, 2), DoubleToString(dd.maxDDPct, 2),
      DoubleToString(avgWin, 2), DoubleToString(avgLoss, 2),
      DoubleToString(avgSec, 0),
      longs, DoubleToString(longWR, 1), shorts, DoubleToString(shortWR, 1),
      mlN, baseN);
   Print(block);
   fileBody += block + "\n";
   outPF = pf;
   outTrades = trades;
  }

void WriteSummary()
  {
   string body = "";
   body += "XAUUSD_SR_LogReg_EA summary\n";
   body += "Symbol " + _Symbol + "\n";
   body += "Timeframe " + EnumToString(g_tf) + "\n";
   body += "Preset " + PresetName() + "\n";
   body += "Processed " + TimeToString(g_firstBar, TIME_DATE | TIME_MINUTES);
   body += " -> " + TimeToString(g_lastClosed, TIME_DATE | TIME_MINUTES) + "\n";
   body += StringFormat("Closed bars %d  Pivots %d  Retests %d  Breaks %d  Expired %d  Merged %d\n",
                        g_barSeq, g_pivots, g_retests, g_breaks, g_expired, g_merged);
   body += StringFormat("Samples %d  Positives %d  Dropped outside train window %d\n",
                        g_model.m_samples, g_model.m_pos, g_trainDropped);
   body += StringFormat("Weights bias %s  w [%s %s %s %s %s %s]\n",
                        DoubleToString(g_model.m_bias, 4),
                        DoubleToString(g_model.m_w[0], 4), DoubleToString(g_model.m_w[1], 4),
                        DoubleToString(g_model.m_w[2], 4), DoubleToString(g_model.m_w[3], 4),
                        DoubleToString(g_model.m_w[4], 4), DoubleToString(g_model.m_w[5], 4));
   body += StringFormat("Geometric signals %d  ML rejects %d  Warmup skips %d\n",
                        g_signals, g_skipML, g_skipWarm);
   body += StringFormat("Skips position %d  daily %d  stops %d  spread %d  lots %d  margin %d  order fails %d\n",
                        g_skipPos, g_skipDay, g_skipStops, g_skipSpread, g_skipLots, g_skipMargin, g_orderFail);
   body += "Net = deal profit + commission + swap. Spread is inside the fill.\n";
   body += "No profitability is claimed by this report. Read OUT_OF_SAMPLE if splits are set.\n\n";
   Print("======== XAUUSD_SR_LogReg_EA ========");
   Print(body);

   double pf = 0.0;
   int tr = 0;
   double valPF = 0.0;
   int valTrades = 0;
   BlockStats("ALL", -1, g_ddAll, body, pf, tr);
   if(g_splits)
     {
      BlockStats("TRAIN 60%", SPLIT_TRAIN, g_ddTrain, body, pf, tr);
      BlockStats("VALIDATION 20%", SPLIT_VAL, g_ddVal, body, valPF, valTrades);
      BlockStats("OUT_OF_SAMPLE 20%", SPLIT_OOS, g_ddOos, body, pf, tr);
      if(tr < 30)
         body += "NOTE: out-of-sample trade count is below 30. Do not treat it as evidence.\n";
      body += "OnTester returns validation profit factor only (not out-of-sample): "
              + DoubleToString(valPF, 3) + " over " + IntegerToString(valTrades) + " validation trades.\n";
     }
   else
      body += "Splits were not set (start/end are 0). Train/validation/OOS were not separated.\n";
   if(ArraySize(g_trades) < 1000)
      body += "NOTE: fewer than 1,000 closed trades in this run.\n";
   body += "======================================\n";

   int h = FileOpen(g_sumName, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ);
   if(h != INVALID_HANDLE)
     {
      FileWriteString(h, body);
      FileClose(h);
      Print("Summary file: MQL5/Files/", g_sumName);
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpPivotLength < 2 || InpPivotLength > 100) return INIT_PARAMETERS_INCORRECT;
   if(InpTargetRespects < 1) return INIT_PARAMETERS_INCORRECT;
   if(InpRetestCooldown < 0) return INIT_PARAMETERS_INCORRECT;
   if(InpMaxLevelAgeBars < InpPivotLength * 2) return INIT_PARAMETERS_INCORRECT;
   if(InpProbThreshold <= 0.0 || InpProbThreshold > 1.0) return INIT_PARAMETERS_INCORRECT;
   if(!(InpLearningRate > 0.0) || InpL2Lambda < 0.0) return INIT_PARAMETERS_INCORRECT;
   if(InpEpochs < 1 || InpNormWindow < 30 || InpMinTrainSamples < 1) return INIT_PARAMETERS_INCORRECT;
   if(!(InpSL_ATR_Mult > 0.0)) return INIT_PARAMETERS_INCORRECT;
   if(!InpUseRiskReward && !(InpTP_ATR_Mult > 0.0)) return INIT_PARAMETERS_INCORRECT;
   if(InpUseRiskReward && !(InpRiskReward > 0.0)) return INIT_PARAMETERS_INCORRECT;
   if(InpFixedLots < 0.0 || InpRiskPercent < 0.0) return INIT_PARAMETERS_INCORRECT;
   if(InpTouchATRMult < 0.0) return INIT_PARAMETERS_INCORRECT;

   ApplyPreset();
   g_tf = ResolveTF();
   if(g_tf != PERIOD_M5 && g_tf != PERIOD_M15)
      Print("Warning: testing plan uses M5 or M15. Current signal timeframe is ", EnumToString(g_tf));

   string sym = _Symbol;
   StringToUpper(sym);
   if(StringFind(sym, "XAU") < 0 && StringFind(sym, "GOLD") < 0)
      Print("Warning: EA is built for XAUUSD. Attached to ", _Symbol);

   long tradeMode = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE);
   if(tradeMode == SYMBOL_TRADE_MODE_DISABLED)
     {
      Print("Symbol trading is disabled.");
      return INIT_FAILED;
     }

   g_rsi = iRSI(_Symbol, g_tf, InpPivotLength, PRICE_CLOSE);
   g_atrH = iATR(_Symbol, g_tf, InpPivotLength);
   if(g_rsi == INVALID_HANDLE || g_atrH == INVALID_HANDLE)
     {
      Print("Indicator handle failed ", GetLastError());
      return INIT_FAILED;
     }

   g_model.Reset(InpLearningRate, InpL2Lambda, InpEpochs, InpBalanceClasses);
   if(!SelfCheck())
     {
      IndicatorRelease(g_rsi);
      IndicatorRelease(g_atrH);
      g_rsi = INVALID_HANDLE;
      g_atrH = INVALID_HANDLE;
      return INIT_FAILED;
     }

   ZeroMemory(g_open);
   ZeroMemory(g_pending);
   ZeroMemory(g_ddAll);
   ZeroMemory(g_ddTrain);
   ZeroMemory(g_ddVal);
   ZeroMemory(g_ddOos);

   g_splits = (InpSplitEnd > InpSplitStart && InpSplitStart > 0);
   if(g_splits)
     {
      long span = (long)InpSplitEnd - (long)InpSplitStart;
      g_trainEnd = (datetime)((long)InpSplitStart + (long)MathRound(span * 0.60));
      g_valEnd = (datetime)((long)InpSplitStart + (long)MathRound(span * 0.80));
     }
   else if(InpTrainPolicy == TRAIN_FREEZE)
      Print("Split start/end are unset. Freeze mode falls back to online training and trades are tagged UNSPLIT.");

   g_csvName = InpCSVFile;
   if(StringLen(g_csvName) < 1) g_csvName = "XAUUSD_SR_LogReg_trades.csv";
   if(MQLInfoInteger(MQL_OPTIMIZATION))
      g_csvName = StringFormat("XAU_SR_%I64u.csv", (ulong)GetMicrosecondCount());
   g_sumName = g_csvName;
   if(StringFind(g_sumName, ".csv") >= 0) StringReplace(g_sumName, ".csv", "_summary.txt");
   else g_sumName += "_summary.txt";

   ConfigureTrade();
   Print("Init ", PresetName(), " TF=", EnumToString(g_tf),
         " retest=", (g_tradeRetests ? "on" : "off"),
         " ml=", (g_useML ? "on" : "off"),
         " break=", (g_tradeBreaks ? "on" : "off"),
         " breakML=", (g_breaksUseML ? "on" : "off"));
   Print("Fill mode set. Spread now=", (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD),
         " points. Slippage cap=", InpSlippagePoints,
         " Swap long=", DoubleToString(SymbolInfoDouble(_Symbol, SYMBOL_SWAP_LONG), 4),
         " Swap short=", DoubleToString(SymbolInfoDouble(_Symbol, SYMBOL_SWAP_SHORT), 4));
   if(g_splits)
      Print("Split train ends ", TimeToString(g_trainEnd, TIME_DATE),
            " validation ends ", TimeToString(g_valEnd, TIME_DATE),
            " window ends ", TimeToString(InpSplitEnd, TIME_DATE));
   Print("Drawings do not change signals. Non-visual tests skip objects.");

   WarmupHistory();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   if(g_open.active) PollExit();
   WriteCSV();
   WriteSummary();
   DeleteAllObjects();
   if(g_rsi != INVALID_HANDLE) IndicatorRelease(g_rsi);
   if(g_atrH != INVALID_HANDLE) IndicatorRelease(g_atrH);
   g_rsi = INVALID_HANDLE;
   g_atrH = INVALID_HANDLE;
  }

void OnTick()
  {
   UpdateDayLock();
   SampleDD();
   if(g_open.awaitLink) TryLink();
   PollExit();
   MaybeOpenPending();

   datetime t0 = iTime(_Symbol, g_tf, 0);
   if(t0 <= 0 || t0 == g_lastBar0) return;
   if(!DataReady(1)) return;
   g_lastBar0 = t0;
   ProcessClosedBar(1);
   PollExit();
   MaybeOpenPending();
  }

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(g_open.awaitLink) TryLink();
   PollExit();
  }

double OnTester()
  {
   // Called before OnDeinit. Never returns the out-of-sample score.
   if(!g_splits) return 0.0;
   double grossWin = 0.0, grossLoss = 0.0;
   int trades = 0;
   int n = ArraySize(g_trades);
   for(int i = 0; i < n; i++)
     {
      if(g_trades[i].split != SPLIT_VAL) continue;
      double pnl = g_trades[i].profit + g_trades[i].commission + g_trades[i].swap;
      trades++;
      if(pnl > 0.0) grossWin += pnl;
      else if(pnl < 0.0) grossLoss += -pnl;
     }
   if(trades < 30) return 0.0;
   if(grossLoss <= 0.0) return (grossWin > 0.0 ? 999.0 : 0.0);
   return grossWin / grossLoss;
  }
//+------------------------------------------------------------------+
