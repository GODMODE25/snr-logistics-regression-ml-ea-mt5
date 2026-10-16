// Synthetic, closed-bar port of the EA's decision rules.
// Indicator values are Wilder-style and will not match MT5 to the tick.
// Money figures are per ounce after a toy spread and commission. Not a backtest.

export type Mode = "baseline" | "ml-retest" | "break" | "ml-break";

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface EngineParams {
  mode: Mode;
  pivotLength: number;
  targetRespects: number;
  cooldown: number;
  maxAge: number;
  touchAtr: number;
  threshold: number;
  learningRate: number;
  l2: number;
  normWindow: number;
  minSamples: number;
  balance: boolean;
  freeze: boolean;
  slAtr: number;
  tpAtr: number;
  spread: number;
  commission: number;
}

export interface LevelView {
  id: number;
  support: boolean;
  price: number;
  confirm: number;
  end: number | null;
  probability: number;
}

export interface Mark {
  kind: "retest" | "break";
  t: number;
  price: number;
  support: boolean;
}

export interface TradeView {
  dir: 1 | -1;
  kind: "retest" | "break";
  entryIndex: number;
  exitIndex: number;
  entry: number;
  exit: number;
  sl: number;
  tp: number;
  net: number;
  reason: "SL" | "TP";
  probability: number;
  ml: boolean;
  split: "train" | "validation" | "oos";
  level: number;
}

export interface Summary {
  trades: number;
  wins: number;
  winRate: number;
  net: number;
  profitFactor: number;
  expectancy: number;
  maxDd: number;
  avgWin: number;
  avgLoss: number;
  longs: number;
  shorts: number;
  mlTrades: number;
  baselineTrades: number;
}

export interface RunResult {
  bars: Bar[];
  levels: LevelView[];
  marks: Mark[];
  trades: TradeView[];
  equity: number[];
  trainEnd: number;
  valEnd: number;
  samples: number;
  positives: number;
  weights: number[];
  bias: number;
  all: Summary;
  train: Summary;
  validation: Summary;
  oos: Summary;
}

export const DEFAULT_PARAMS: EngineParams = {
  mode: "ml-retest",
  pivotLength: 14,
  targetRespects: 3,
  cooldown: 3,
  maxAge: 500,
  touchAtr: 0.25,
  threshold: 0.55,
  learningRate: 0.03,
  l2: 0.001,
  normWindow: 120,
  minSamples: 25,
  balance: true,
  freeze: true,
  slAtr: 1.5,
  tpAtr: 3,
  spread: 0.3,
  commission: 0.1,
};

const FT = 6;
const SCALE_CAP = 5;
const W_CAP = 8;

class Model {
  bias = 0;
  w = [0, 0, 0, 0, 0, 0];
  samples = 0;
  pos = 0;
  lr: number;
  l2: number;
  balance: boolean;

  constructor(lr: number, l2: number, balance: boolean) {
    this.lr = lr;
    this.l2 = l2;
    this.balance = balance;
  }

  predict(x: number[]) {
    let z = this.bias;
    for (let i = 0; i < FT; i++) z += this.w[i] * x[i];
    if (z > 20) z = 20;
    if (z < -20) z = -20;
    return 1 / (1 + Math.exp(-z));
  }

  fit(x: number[], y: 0 | 1) {
    let scale = 1;
    if (this.balance && this.samples >= 10 && this.pos > 0 && this.pos < this.samples) {
      const pos = this.pos;
      const neg = this.samples - this.pos;
      scale = y === 1 ? (0.5 * this.samples) / pos : (0.5 * this.samples) / neg;
      if (scale > SCALE_CAP) scale = SCALE_CAP;
      if (scale < 1 / SCALE_CAP) scale = 1 / SCALE_CAP;
    }
    const p = this.predict(x);
    const err = (p - y) * scale;
    this.bias -= this.lr * err;
    this.bias = Math.max(-W_CAP, Math.min(W_CAP, this.bias));
    for (let i = 0; i < FT; i++) {
      this.w[i] -= this.lr * (err * x[i] + this.l2 * this.w[i]);
      this.w[i] = Math.max(-W_CAP, Math.min(W_CAP, this.w[i]));
    }
    this.samples++;
    if (y === 1) this.pos++;
  }
}

export function selfCheck() {
  const m = new Model(0.25, 0, false);
  const mid = m.predict([0, 0, 0, 0, 0, 0]);
  const xp = [1, 0, 0, 0, 0, 0];
  const xn = [-1, 0, 0, 0, 0, 0];
  for (let i = 0; i < 250; i++) {
    m.fit(xp, 1);
    m.fit(xn, 0);
  }
  const pPos = m.predict(xp);
  const pNeg = m.predict(xn);
  return { ok: Math.abs(mid - 0.5) < 1e-9 && pPos > 0.85 && pNeg < 0.15 && m.w[0] > 0, pPos, pNeg };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number) {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

export function makeGoldPath(count: number, seed: number): Bar[] {
  const rng = mulberry32(seed);
  const bars: Bar[] = [];
  let price = 2320;
  let vol = 1.35;
  let anchor = 2320;
  for (let i = 0; i < count; i++) {
    if (i % 280 === 0) anchor = price + gauss(rng) * 22;
    const shock = Math.abs(gauss(rng));
    vol = Math.min(4.2, Math.max(0.55, vol * 0.96 + shock * 0.22));
    const pull = (anchor - price) * 0.01;
    const open = price;
    const close = Math.max(1200, open + pull + gauss(rng) * vol);
    const wick = Math.abs(gauss(rng)) * vol * 0.65;
    const high = Math.max(open, close) + wick * rng();
    const low = Math.min(open, close) - wick * rng();
    bars.push({ t: i, o: open, h: high, l: low, c: close });
    price = close;
  }
  return bars;
}

function wilderRsi(closes: number[], period: number) {
  const out = new Array<number | null>(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function wilderAtr(bars: Bar[], period: number) {
  const tr = bars.map((b, i) => {
    if (i === 0) return b.h - b.l;
    const pc = bars[i - 1].c;
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  });
  const out = new Array<number | null>(bars.length).fill(null);
  if (bars.length <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let a = sum / period;
  out[period] = a;
  for (let i = period + 1; i < bars.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    out[i] = a;
  }
  return out;
}

function slopeAt(closes: number[], index: number, len: number, atr: number) {
  if (atr <= 0 || index - len + 1 < 0) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let k = 0; k < len; k++) {
    const y = closes[index - len + 1 + k];
    sumX += k;
    sumY += y;
    sumXY += k * y;
    sumXX += k * k;
  }
  const denom = len * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return 0;
  return ((len * sumXY - sumX * sumY) / denom) / atr;
}

function zscore(hist: number[], x: number) {
  if (hist.length < 20) return 0;
  let sum = 0;
  for (const v of hist) sum += v;
  const mean = sum / hist.length;
  let varc = 0;
  for (const v of hist) {
    const d = v - mean;
    varc += d * d;
  }
  varc /= hist.length - 1;
  const sd = Math.sqrt(varc);
  if (sd < 1e-8) return 0;
  return Math.max(-5, Math.min(5, (x - mean) / sd));
}

interface Level {
  id: number;
  support: boolean;
  price: number;
  pivot: number;
  confirm: number;
  respects: number;
  lastRetest: number;
  hasRetest: boolean;
  x: number[];
  probability: number;
  labelLocked: boolean;
  label: 0 | 1;
  trained: boolean;
  dead: boolean;
  end: number | null;
}

function emptySummary(): Summary {
  return {
    trades: 0,
    wins: 0,
    winRate: 0,
    net: 0,
    profitFactor: 0,
    expectancy: 0,
    maxDd: 0,
    avgWin: 0,
    avgLoss: 0,
    longs: 0,
    shorts: 0,
    mlTrades: 0,
    baselineTrades: 0,
  };
}

function summarize(trades: TradeView[], equity: number[], from: number, to: number): Summary {
  const slice = trades.filter((t) => t.entryIndex >= from && t.entryIndex < to);
  const s = emptySummary();
  let grossWin = 0;
  let grossLoss = 0;
  let winSum = 0;
  let lossSum = 0;
  for (const t of slice) {
    s.trades++;
    s.net += t.net;
    if (t.dir > 0) s.longs++;
    else s.shorts++;
    if (t.ml) s.mlTrades++;
    else s.baselineTrades++;
    if (t.net > 0) {
      s.wins++;
      grossWin += t.net;
      winSum += t.net;
    } else if (t.net < 0) {
      grossLoss += -t.net;
      lossSum += t.net;
    }
  }
  s.winRate = s.trades ? (100 * s.wins) / s.trades : 0;
  s.profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  s.expectancy = s.trades ? s.net / s.trades : 0;
  s.avgWin = s.wins ? winSum / s.wins : 0;
  const losses = s.trades - s.wins;
  s.avgLoss = losses ? lossSum / losses : 0;
  let peak = 0;
  let maxDd = 0;
  const startEq = equity[from] ?? 0;
  for (let i = from; i < Math.min(to, equity.length); i++) {
    const rel = equity[i] - startEq;
    if (rel > peak) peak = rel;
    const dd = peak - rel;
    if (dd > maxDd) maxDd = dd;
  }
  s.maxDd = maxDd;
  return s;
}

function flags(mode: Mode) {
  if (mode === "baseline") return { retests: true, ml: false, breaks: false, breakMl: false };
  if (mode === "break") return { retests: false, ml: false, breaks: true, breakMl: false };
  if (mode === "ml-break") return { retests: false, ml: true, breaks: true, breakMl: true };
  return { retests: true, ml: true, breaks: false, breakMl: false };
}

export function runStrategy(bars: Bar[], params: EngineParams): RunResult {
  const n = bars.length;
  const closes = bars.map((b) => b.c);
  const rsi = wilderRsi(closes, params.pivotLength);
  const atr = wilderAtr(bars, params.pivotLength);
  const model = new Model(params.learningRate, params.l2, params.balance);
  const { retests, ml, breaks, breakMl } = flags(params.mode);
  const trainEnd = Math.floor(n * 0.6);
  const valEnd = Math.floor(n * 0.8);
  const levels: Level[] = [];
  const views: LevelView[] = [];
  const marks: Mark[] = [];
  const trades: TradeView[] = [];
  const equity = new Array<number>(n).fill(0);
  let eq = 0;
  let nextId = 1;
  let lastSupport: number | null = null;
  let lastResist: number | null = null;
  const distHist: number[] = [];

  type Position = {
    dir: 1 | -1;
    kind: "retest" | "break";
    entryIndex: number;
    entry: number;
    sl: number;
    tp: number;
    probability: number;
    ml: boolean;
    level: number;
  };
  const book: { pos: Position | null } = { pos: null };

  const splitOf = (index: number): TradeView["split"] => {
    if (index < trainEnd) return "train";
    if (index < valEnd) return "validation";
    return "oos";
  };

  const allowTrain = (index: number) => !params.freeze || index < trainEnd;

  const featuresAt = (pivot: number, support: boolean, levelPrice: number) => {
    const a = atr[pivot];
    const r = rsi[pivot];
    if (a == null || r == null || a <= 0) return null;
    const histR: number[] = [];
    const histB: number[] = [];
    const histU: number[] = [];
    const histL: number[] = [];
    const histS: number[] = [];
    const from = Math.max(params.pivotLength, pivot - params.normWindow);
    for (let i = from; i < pivot; i++) {
      const ai = atr[i];
      const ri = rsi[i];
      if (ai == null || ri == null || ai <= 0) continue;
      if (i - params.pivotLength + 1 < 0) continue;
      const b = bars[i];
      histR.push(ri / 100);
      histB.push(Math.abs(b.c - b.o) / ai);
      histU.push((b.h - Math.max(b.o, b.c)) / ai);
      histL.push((Math.min(b.o, b.c) - b.l) / ai);
      histS.push(slopeAt(closes, i, params.pivotLength, ai));
    }
    if (histR.length < 20) return null;
    const b0 = bars[pivot];
    const prev = support ? lastSupport : lastResist;
    const dist = prev == null ? 0 : (levelPrice - prev) / a;
    const x = [
      zscore(histR, r / 100),
      zscore(histB, Math.abs(b0.c - b0.o) / a),
      zscore(histU, (b0.h - Math.max(b0.o, b0.c)) / a),
      zscore(histL, (Math.min(b0.o, b0.c) - b0.l) / a),
      zscore(distHist, dist),
      zscore(histS, slopeAt(closes, pivot, params.pivotLength, a)),
    ];
    distHist.push(dist);
    if (distHist.length > 600) distHist.shift();
    return x;
  };

  const tryFill = (
    index: number,
    dir: 1 | -1,
    kind: "retest" | "break",
    levelPrice: number,
    probability: number,
    useMl: boolean,
    barAtr: number,
  ) => {
    if (book.pos || index + 1 >= n) return;
    if (useMl && model.samples < params.minSamples) return;
    if (useMl && probability < params.threshold) return;
    const entryBar = bars[index + 1];
    const raw = entryBar.o;
    const entry = dir > 0 ? raw + params.spread : raw;
    const sl = dir > 0 ? levelPrice - params.slAtr * barAtr : levelPrice + params.slAtr * barAtr;
    const tp = dir > 0 ? entry + params.tpAtr * barAtr : entry - params.tpAtr * barAtr;
    if (dir > 0 && !(sl < entry && tp > entry)) return;
    if (dir < 0 && !(sl > entry && tp < entry)) return;
    book.pos = {
      dir,
      kind,
      entryIndex: index + 1,
      entry,
      sl,
      tp,
      probability,
      ml: useMl,
      level: levelPrice,
    };
  };

  for (let i = 0; i < n; i++) {
    const pos = book.pos;
    if (pos && i >= pos.entryIndex) {
      const b = bars[i];
      let exit: number | null = null;
      let reason: "SL" | "TP" = "SL";
      if (pos.dir > 0) {
        const hitSl = b.l <= pos.sl;
        const hitTp = b.h >= pos.tp;
        if (hitSl) {
          exit = pos.sl;
          reason = "SL";
        } else if (hitTp) {
          exit = pos.tp;
          reason = "TP";
        }
      } else {
        const hitSl = b.h >= pos.sl;
        const hitTp = b.l <= pos.tp;
        if (hitSl) {
          exit = pos.sl;
          reason = "SL";
        } else if (hitTp) {
          exit = pos.tp;
          reason = "TP";
        }
      }
      if (exit != null) {
        const gross = pos.dir > 0 ? exit - pos.entry : pos.entry - exit;
        const net = gross - params.commission;
        eq += net;
        trades.push({
          dir: pos.dir,
          kind: pos.kind,
          entryIndex: pos.entryIndex,
          exitIndex: i,
          entry: pos.entry,
          exit,
          sl: pos.sl,
          tp: pos.tp,
          net,
          reason,
          probability: pos.probability,
          ml: pos.ml,
          split: splitOf(pos.entryIndex),
          level: pos.level,
        });
        book.pos = null;
      }
    }

    const queue: { x: number[]; y: 0 | 1 }[] = [];
    const a = atr[i];
    const tol = a != null ? a * params.touchAtr : 0;
    const bar = bars[i];
    let best: {
      score: number;
      dir: 1 | -1;
      kind: "retest" | "break";
      level: number;
      probability: number;
      useMl: boolean;
      atr: number;
    } | null = null;

    if (a != null && a > 0) {
      for (const lv of levels) {
        if (lv.dead || i <= lv.confirm) continue;
        const age = i - lv.pivot;
        let broken = false;
        let retest = false;
        if (lv.support) {
          if (bar.c < lv.price) broken = true;
          else if (
            bar.l <= lv.price + tol &&
            bar.c > lv.price &&
            (!lv.hasRetest || i - lv.lastRetest > params.cooldown)
          )
            retest = true;
        } else if (bar.c > lv.price) broken = true;
        else if (
          bar.h >= lv.price - tol &&
          bar.c < lv.price &&
          (!lv.hasRetest || i - lv.lastRetest > params.cooldown)
        )
          retest = true;

        if (!broken && !retest && age >= params.maxAge) {
          lv.dead = true;
          lv.end = i;
          if (!lv.labelLocked) {
            lv.labelLocked = true;
            lv.label = 0;
            lv.trained = true;
            queue.push({ x: lv.x, y: 0 });
          }
          continue;
        }
        if (retest) {
          lv.respects++;
          lv.hasRetest = true;
          lv.lastRetest = i;
          marks.push({ kind: "retest", t: i, price: lv.price, support: lv.support });
          if (!lv.labelLocked && lv.respects >= params.targetRespects) {
            lv.labelLocked = true;
            lv.label = 1;
            lv.trained = true;
            queue.push({ x: lv.x, y: 1 });
          }
          if (retests) {
            const probability = model.predict(lv.x);
            lv.probability = probability;
            const useMl = ml;
            const score = useMl ? probability : -Math.abs(bar.c - lv.price);
            const reject = (useMl && model.samples < params.minSamples) || (useMl && probability < params.threshold);
            if (!reject && (!best || score > best.score)) {
              best = { score, dir: lv.support ? 1 : -1, kind: "retest", level: lv.price, probability, useMl, atr: a };
            }
          }
        } else if (broken) {
          if (!lv.labelLocked) {
            lv.labelLocked = true;
            lv.label = 0;
            lv.trained = true;
            queue.push({ x: lv.x, y: 0 });
          }
          marks.push({ kind: "break", t: i, price: lv.price, support: lv.support });
          if (breaks) {
            const probability = model.predict(lv.x);
            lv.probability = probability;
            const useMl = breakMl;
            const score = useMl ? probability : -Math.abs(bar.c - lv.price);
            const reject = (useMl && model.samples < params.minSamples) || (useMl && probability < params.threshold);
            if (!reject && (!best || score > best.score)) {
              best = { score, dir: lv.support ? -1 : 1, kind: "break", level: lv.price, probability, useMl, atr: a };
            }
          }
          lv.dead = true;
          lv.end = i;
        }
      }
    }

    if (best) tryFill(i, best.dir, best.kind, best.level, best.probability, best.useMl, best.atr);

    if (allowTrain(i)) {
      for (const sample of queue) model.fit(sample.x, sample.y);
    }

    for (let k = levels.length - 1; k >= 0; k--) {
      if (levels[k].dead) levels.splice(k, 1);
    }

    const pivot = i - params.pivotLength;
    if (pivot >= params.pivotLength && a != null) {
      const add = (support: boolean) => {
        const price = support ? bars[pivot].l : bars[pivot].h;
        let ok = true;
        for (let k = 1; k <= params.pivotLength; k++) {
          if (support) {
            if (bars[pivot - k].l <= price || bars[pivot + k].l <= price) ok = false;
          } else if (bars[pivot - k].h >= price || bars[pivot + k].h >= price) ok = false;
        }
        if (!ok) return;
        const x = featuresAt(pivot, support, price);
        if (!x) return;
        const lv: Level = {
          id: nextId++,
          support,
          price,
          pivot,
          confirm: i,
          respects: 0,
          lastRetest: -100000,
          hasRetest: false,
          x,
          probability: model.predict(x),
          labelLocked: false,
          label: 0,
          trained: false,
          dead: false,
          end: null,
        };
        levels.push(lv);
        views.push({
          id: lv.id,
          support,
          price,
          confirm: i,
          end: null,
          probability: lv.probability,
        });
        if (support) lastSupport = price;
        else lastResist = price;
      };
      add(true);
      add(false);
    }

    for (const view of views) {
      if (view.end != null) continue;
      const live = levels.find((lv) => lv.id === view.id);
      if (!live) {
        view.end = i;
        const dead = views.find((v) => v.id === view.id);
        if (dead) dead.probability = view.probability;
      } else {
        view.probability = live.probability;
      }
    }

    equity[i] = eq;
  }

  for (const view of views) {
    if (view.end == null) view.end = null;
  }

  return {
    bars,
    levels: views,
    marks,
    trades,
    equity,
    trainEnd,
    valEnd,
    samples: model.samples,
    positives: model.pos,
    weights: model.w.slice(),
    bias: model.bias,
    all: summarize(trades, equity, 0, n),
    train: summarize(trades, equity, 0, trainEnd),
    validation: summarize(trades, equity, trainEnd, valEnd),
    oos: summarize(trades, equity, valEnd, n),
  };
}
