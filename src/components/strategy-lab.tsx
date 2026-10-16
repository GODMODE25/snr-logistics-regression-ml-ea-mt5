import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Pause, Play, RotateCcw } from "lucide-react";
import {
  DEFAULT_PARAMS,
  makeGoldPath,
  runStrategy,
  selfCheck,
  type EngineParams,
  type Mode,
  type RunResult,
  type Summary,
} from "@/lib/sr-engine";

const BARS = 1400;
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "baseline", label: "A Baseline", hint: "Every valid retest" },
  { id: "ml-retest", label: "B ML retest", hint: "Retest only if the model agrees" },
  { id: "break", label: "C Break", hint: "Trade the close through the level" },
  { id: "ml-break", label: "D ML break", hint: "Break only if the model agrees" },
];

function money(n: number) {
  const sign = n < 0 ? "−" : "";
  return sign + "$" + Math.abs(n).toFixed(2);
}

function num(n: number, d = 2) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 999) return "inf";
  return n.toFixed(d);
}

function readColor(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function StrategyLab() {
  const check = useMemo(() => selfCheck(), []);
  const [mode, setMode] = useState<Mode>("baseline");
  const [pivot, setPivot] = useState(14);
  const [threshold, setThreshold] = useState(0.55);
  const [seed, setSeed] = useState(7);
  const [cursor, setCursor] = useState(BARS - 1);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const bars = useMemo(() => makeGoldPath(BARS, seed), [seed]);
  const shared = useMemo<EngineParams>(
    () => ({
      ...DEFAULT_PARAMS,
      pivotLength: pivot,
      threshold,
    }),
    [pivot, threshold],
  );
  const runs = useMemo(() => {
    const out = {} as Record<Mode, RunResult>;
    for (const item of MODES) out[item.id] = runStrategy(bars, { ...shared, mode: item.id });
    return out;
  }, [bars, shared]);
  const run = runs[mode];

  useEffect(() => {
    setCursor(BARS - 1);
    setPlaying(false);
  }, [seed, pivot, threshold, mode]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCursor((c) => {
        if (c >= BARS - 1) {
          setPlaying(false);
          return c;
        }
        return Math.min(BARS - 1, c + 2);
      });
    }, 70);
    return () => window.clearInterval(id);
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = readColor("--color-bg", "#101410");
      const fg = readColor("--color-fg", "#e7ece4");
      const muted = readColor("--color-muted", "#97a296");
      const support = readColor("--color-support", "#1f9d78");
      const resistance = readColor("--color-resistance", "#e24b4b");
      const brass = readColor("--color-brass", "#c6a15b");
      const grid = readColor("--color-border", "#2c352e");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const padL = 54;
      const padR = 12;
      const padT = 12;
      const padB = 22;
      const plotW = Math.max(10, width - padL - padR);
      const plotH = Math.max(10, height - padT - padB);
      const view = Math.min(160, cursor + 1);
      const start = cursor - view + 1;
      const visible = bars.slice(start, cursor + 1);
      let lo = Infinity;
      let hi = -Infinity;
      for (const b of visible) {
        if (b.l < lo) lo = b.l;
        if (b.h > hi) hi = b.h;
      }
      if (!Number.isFinite(lo) || lo === hi) {
        lo = 2300;
        hi = 2340;
      }
      const span = Math.max(0.5, hi - lo);
      const bandLo = lo - span * 0.45;
      const bandHi = hi + span * 0.45;
      const pad = span * 0.08;
      lo -= pad;
      hi += pad;
      const xOf = (index: number) => padL + ((index - start) / Math.max(1, view - 1)) * plotW;
      const yOf = (price: number) => padT + ((hi - price) / (hi - lo)) * plotH;
      const inBand = (price: number) => price >= bandLo && price <= bandHi;

      const lastClose = visible.length ? visible[visible.length - 1].c : 0;
      const shownLevels = run.levels
        .filter((level) => {
          if (level.confirm > cursor) return false;
          if (level.end != null && level.end < start) return false;
          return inBand(level.price);
        })
        .sort((a, b) => {
          const aLive = a.end == null || a.end > cursor ? 0 : 1;
          const bLive = b.end == null || b.end > cursor ? 0 : 1;
          if (aLive !== bLive) return aLive - bLive;
          return Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose);
        })
        .slice(0, 8);

      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.font = "11px 'IBM Plex Sans', sans-serif";
      ctx.fillStyle = muted;
      for (let g = 0; g < 5; g++) {
        const price = lo + ((hi - lo) * g) / 4;
        const y = yOf(price);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
        ctx.fillText(price.toFixed(1), 6, y + 3);
      }

      const trainX = xOf(run.trainEnd);
      const valX = xOf(run.valEnd);
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = brass;
      ctx.globalAlpha = 0.55;
      ctx.font = "11px 'IBM Plex Sans', sans-serif";
      for (const split of [
        { x: trainX, label: "Val" },
        { x: valX, label: "OOS" },
      ]) {
        if (split.x < padL || split.x > width - padR) continue;
        ctx.beginPath();
        ctx.moveTo(split.x, padT);
        ctx.lineTo(split.x, padT + plotH);
        ctx.stroke();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = brass;
        ctx.fillText(split.label, split.x + 4, padT + 12);
        ctx.globalAlpha = 0.55;
      }
      ctx.restore();

      const slot = plotW / view;
      const bodyW = Math.max(2.2, slot * 0.62);
      visible.forEach((b, i) => {
        const x = xOf(start + i);
        const up = b.c >= b.o;
        ctx.strokeStyle = up ? support : resistance;
        ctx.fillStyle = up ? support : resistance;
        ctx.beginPath();
        ctx.moveTo(x, yOf(b.h));
        ctx.lineTo(x, yOf(b.l));
        ctx.stroke();
        const y1 = yOf(Math.max(b.o, b.c));
        const y2 = yOf(Math.min(b.o, b.c));
        ctx.globalAlpha = up ? 0.9 : 0.75;
        ctx.fillRect(x - bodyW / 2, y1, bodyW, Math.max(1, y2 - y1));
        ctx.globalAlpha = 1;
      });

      const labeled = shownLevels.filter((level) => level.end == null || level.end > cursor).slice(0, 2);
      for (const level of shownLevels) {
        const x1 = xOf(Math.max(level.confirm, start));
        const x2 = xOf(Math.min(level.end ?? cursor, cursor));
        const y = yOf(level.price);
        const live = level.end == null || level.end > cursor;
        ctx.strokeStyle = level.support ? support : resistance;
        ctx.globalAlpha = live ? 0.9 : 0.28;
        ctx.lineWidth = live ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        const mlMode = mode === "ml-retest" || mode === "ml-break";
        if (live && mlMode && labeled.includes(level)) {
          ctx.globalAlpha = level.probability >= threshold ? 1 : 0.55;
          ctx.fillStyle = level.probability >= threshold ? (level.support ? support : resistance) : muted;
          ctx.font = "11px 'IBM Plex Sans', sans-serif";
          const label = (level.support ? "S " : "R ") + Math.round(level.probability * 100) + "%";
          ctx.fillText(label, Math.min(x2 - 36, width - padR - 44), y + (level.support ? 12 : -4));
        }
        ctx.globalAlpha = 1;
      }

      const shownTrades = run.trades.filter((trade) => trade.exitIndex >= start && trade.entryIndex <= cursor).slice(-2);
      for (const trade of shownTrades) {
        const x1 = xOf(Math.max(trade.entryIndex, start));
        const x2 = xOf(Math.min(trade.exitIndex, cursor));
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        if (inBand(trade.sl)) {
          ctx.strokeStyle = resistance;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(x1, yOf(trade.sl));
          ctx.lineTo(x2, yOf(trade.sl));
          ctx.stroke();
        }
        if (inBand(trade.tp)) {
          ctx.strokeStyle = support;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(x1, yOf(trade.tp));
          ctx.lineTo(x2, yOf(trade.tp));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      let lastMarkX = -100;
      for (const mark of run.marks) {
        if (mark.t < start || mark.t > cursor) continue;
        if (!inBand(mark.price)) continue;
        const x = xOf(mark.t);
        if (x - lastMarkX < 18) continue;
        lastMarkX = x;
        ctx.fillStyle = mark.support ? support : resistance;
        ctx.font = "11px 'IBM Plex Sans', sans-serif";
        ctx.fillText(mark.kind === "retest" ? "R" : "B", x - 3, yOf(mark.price) + (mark.support ? 13 : -5));
      }

      for (const trade of run.trades) {
        if (trade.entryIndex < start || trade.entryIndex > cursor) continue;
        const x = xOf(trade.entryIndex);
        const y = yOf(trade.entry);
        ctx.fillStyle = trade.dir > 0 ? support : resistance;
        ctx.beginPath();
        if (trade.dir > 0) {
          ctx.moveTo(x, y + 10);
          ctx.lineTo(x - 4, y + 3);
          ctx.lineTo(x + 4, y + 3);
        } else {
          ctx.moveTo(x, y - 10);
          ctx.lineTo(x - 4, y - 3);
          ctx.lineTo(x + 4, y - 3);
        }
        ctx.fill();
        if (trade.exitIndex <= cursor) {
          ctx.strokeStyle = fg;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, yOf(trade.entry));
          ctx.lineTo(xOf(trade.exitIndex), yOf(trade.exit));
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      ctx.fillStyle = muted;
      ctx.font = "11px 'IBM Plex Sans', sans-serif";
      ctx.fillText(String(start), padL, height - 6);
      ctx.fillText(String(cursor), width - padR - 28, height - 6);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [bars, cursor, mode, run, threshold]);

  const verdict = verdictFor(runs.baseline.oos, runs["ml-retest"].oos);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest text-brass uppercase">MetaTrader 5 expert advisor</p>
          <h1 className="mt-1 text-3xl text-fg sm:text-4xl">XAUUSD support and resistance</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Closed candles only. Logistic regression is fit on resolved levels, not on the pivot it is scoring.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brass px-4 text-sm font-medium text-bg"
            href="/XAUUSD_SR_LogReg_EA.mq5"
            download
          >
            <Download className="size-4" aria-hidden />
            Download EA
          </a>
          <a
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-fg"
            href="/XAUUSD_SR_LogReg_TESTING_PLAN.txt"
            download
          >
            Testing plan
          </a>
        </div>
      </header>

      <div className="mt-4 flex gap-3 rounded-lg border border-border bg-surface px-3 py-3 text-sm text-muted">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brass" aria-hidden />
        <p>
          This chart is a synthetic path, not XAUUSD history. Nothing on this page is a profitability claim.
          The out-of-sample number that matters is the one MetaTrader prints after commission, spread, and swap.
        </p>
      </div>

      <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium text-fg">{MODES.find((m) => m.id === mode)?.label}</p>
              <p className="text-xs text-muted">
              Candles stay in scale. Green is support, red is resistance. Dashed green and red are the last two trades’ target and stop.
            </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm text-fg"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                {playing ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm text-fg"
                onClick={() => {
                  setCursor(Math.min(80, BARS - 1));
                  setPlaying(true);
                }}
              >
                <RotateCcw className="size-4" />
                Replay
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pt-2 text-xs text-muted">
            <span className="text-support">Support / target</span>
            <span className="text-resistance">Resistance / stop</span>
            <span>R retest</span>
            <span>B break</span>
            <span className="text-brass">Train | validation | out of sample</span>
          </div>
          <div ref={wrapRef} className="h-72 sm:h-96">
            <canvas ref={canvasRef} className="block h-full w-full" />
          </div>
          <div className="border-t border-border px-3 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs tracking-wide text-brass uppercase">Equity per ounce</p>
              <p className="text-xs text-muted tabular-nums">{money(run.equity[cursor] ?? 0)} at this bar</p>
            </div>
            <EquityChart equity={run.equity} cursor={cursor} trainEnd={run.trainEnd} valEnd={run.valEnd} />
          </div>
          <label className="block px-3 pb-3">
            <span className="text-xs text-muted">Bar {cursor + 1} of {BARS}</span>
            <input
              className="mt-2 w-full accent-brass"
              type="range"
              min={40}
              max={BARS - 1}
              value={cursor}
              suppressHydrationWarning
              onChange={(e) => {
                setPlaying(false);
                setCursor(Number(e.target.value));
              }}
            />
          </label>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={
                  "h-16 rounded-lg border px-2 text-left " +
                  (mode === item.id ? "border-brass bg-surface-2 text-fg" : "border-border bg-surface text-muted")
                }
              >
                <span className="block text-sm font-medium text-fg">{item.label}</span>
                <span className="block text-xs">{item.hint}</span>
              </button>
            ))}
          </div>
          <label className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <span className="flex justify-between text-muted">
              Pivot length <span className="tabular-nums text-fg">{pivot}</span>
            </span>
            <input
              className="mt-2 w-full accent-brass"
              type="range"
              min={5}
              max={28}
              value={pivot}
              onChange={(e) => setPivot(Number(e.target.value))}
              suppressHydrationWarning
            />
          </label>
          <label className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <span className="flex justify-between text-muted">
              Probability threshold <span className="tabular-nums text-fg">{threshold.toFixed(2)}</span>
            </span>
            <input
              className="mt-2 w-full accent-brass"
              type="range"
              min={0.35}
              max={0.8}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              suppressHydrationWarning
            />
          </label>
          <label className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">
            Path seed
            <input
              className="mt-2 h-11 w-full rounded-md border border-border bg-bg px-3 text-fg tabular-nums"
              type="number"
              min={1}
              max={9999}
              value={seed}
              onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))}
              suppressHydrationWarning
            />
          </label>
          <StatBlock summary={run.oos} title="Out of sample, this path" />
          <div className="grid grid-cols-3 gap-2">
            <MiniSplit title="Train" summary={run.train} />
            <MiniSplit title="Check" summary={run.validation} />
            <MiniSplit title="OOS" summary={run.oos} />
          </div>
          <WeightRow weights={run.weights} />
        </aside>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl text-fg">Same path, four rules</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{verdict}</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-surface text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-3 py-2 font-medium">OOS trades</th>
                <th className="px-3 py-2 font-medium">OOS expectancy</th>
                <th className="px-3 py-2 font-medium">OOS profit factor</th>
                <th className="px-3 py-2 font-medium">OOS net / oz</th>
                <th className="px-3 py-2 font-medium">All trades</th>
              </tr>
            </thead>
            <tbody>
              {MODES.map((item) => {
                const s = runs[item.id];
                return (
                  <tr key={item.id} className={"border-t border-border " + (item.id === mode ? "bg-surface-2" : "")}>
                    <td className="px-3 py-2 text-fg">{item.label}</td>
                    <td className="px-3 py-2 tabular-nums">{s.oos.trades}</td>
                    <td className="px-3 py-2 tabular-nums">{money(s.oos.expectancy)}</td>
                    <td className="px-3 py-2 tabular-nums">{num(s.oos.profitFactor)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(s.oos.net)}</td>
                    <td className="px-3 py-2 tabular-nums">{s.all.trades}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Toy costs: {shared.spread.toFixed(2)} spread on the entry and {shared.commission.toFixed(2)} commission, per ounce.
          Resolved training samples on this path: {run.samples}, of which {run.positives} reached {shared.targetRespects} retests.
          Label 1 is rare, so a 0.55 threshold often approves very little. That is the model being selective, not a hidden edge.
        </p>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-xl text-fg">What was thrown out of the Pine script</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>Weights were reset inside every prediction. They now persist across bars and update only when a level resolves.</li>
            <li>The new pivot was trained as a failure before it had an outcome. A level is never in its own training set.</li>
            <li>The step used probability plus loss. The EA uses error = prediction − target, then L2 on the weights.</li>
            <li>RSI and candle body were crushed to a yes/no bit. Features stay continuous and are z-scored on a trailing window.</li>
          </ul>
          <p className="mt-3 text-sm text-fg">
            Gradient check: {check.ok ? "passed" : "failed"}. P(success | +1) {check.pPos.toFixed(2)}, P(success | −1) {check.pNeg.toFixed(2)}.
          </p>
        </article>
        <article className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-xl text-fg">How a trade is allowed</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-muted">
            <li>A pivot is confirmed only after {pivot} later candles have closed.</li>
            <li>Support holds if price tags the level and closes back above it. Resistance is the mirror.</li>
            <li>A close through the level breaks it. Touch distance is ATR × 0.25. Retests wait 3 bars.</li>
            <li>Buy the support retest, or sell the resistance retest, at the next market price. One position.</li>
            <li>Stop sits 1.5 ATR beyond the level. Target is 3 ATR, unless you switch the EA to an R multiple.</li>
          </ol>
        </article>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-xl text-fg">Strategy Tester settings</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Run M5 and M15 separately. Debug on 1 minute OHLC, then confirm survivors on every tick based on real ticks.
          Set the EA split dates to the tester From and To. Train is the first 60%, validation the next 20%, and the last 20% is the only score that counts. OnTester returns the validation profit factor, never the out-of-sample one.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <tbody>
              {[
                ["Symbol / timeframes", "XAUUSD, M5 then M15"],
                ["Debug model", "1 minute OHLC, full downloaded history"],
                ["Final model", "Every tick based on real ticks"],
                ["Presets", "A baseline, B ML retest, C break, D ML break"],
                ["Costs", "Real commission, symbol swap, non-zero slippage"],
                ["EA deviation", "50 points, at or above tester slippage"],
                ["Daily loss, for the comparison", "Set to 0 so the brake does not pick the winner"],
                ["Success", "OOS expectancy > 0 after costs, 1,000+ trades, ML beats A on both timeframes"],
              ].map(([k, v]) => (
                <tr key={k} className="border-t border-border">
                  <th className="w-1/3 px-3 py-2 text-left font-medium text-muted">{k}</th>
                  <td className="px-3 py-2 text-fg">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">
          Copy the .mq5 into MQL5/Experts and compile with F7. The journal must print “Logistic self-check passed” before you read a result.
          If ML does not beat the baseline out of sample, keep preset A or stop. Do not add filters to rescue a curve.
        </p>
      </section>
    </main>
  );
}

function MiniSplit({ title, summary }: { title: string; summary: Summary }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-2 py-2">
      <p className="text-xs tracking-wide text-brass uppercase">{title}</p>
      <p className="mt-1 text-sm text-fg tabular-nums">{summary.trades} trades</p>
      <p className="text-xs text-muted tabular-nums">{money(summary.expectancy)} / trade</p>
    </div>
  );
}

const FEATURES = ["RSI", "Body", "Upper", "Lower", "Dist", "Slope"];

function WeightRow({ weights }: { weights: number[] }) {
  const max = Math.max(0.2, ...weights.map((value) => Math.abs(value)));
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-3">
      <p className="text-xs tracking-wide text-brass uppercase">Weights after the train window</p>
      <div className="mt-2 grid grid-cols-6 gap-2">
        {FEATURES.map((name, index) => {
          const value = weights[index] ?? 0;
          const height = Math.max(8, (Math.abs(value) / max) * 100);
          return (
            <div key={name} className="text-center">
              <div className="mx-auto flex h-14 w-2 items-end rounded-sm bg-bg">
                <div
                  className={"w-full " + (value >= 0 ? "bg-support" : "bg-resistance")}
                  style={{ height: height + "%" }}
                />
              </div>
              <p className="mt-1 text-xs text-muted">{name}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Green pushes toward “level holds.” Red pushes toward a break or expiry.</p>
    </div>
  );
}

function EquityChart({
  equity,
  cursor,
  trainEnd,
  valEnd,
}: {
  equity: number[];
  cursor: number;
  trainEnd: number;
  valEnd: number;
}) {
  const width = 640;
  const height = 64;
  const pad = 4;
  const last = Math.min(cursor, equity.length - 1);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i <= last; i++) {
    if (equity[i] < lo) lo = equity[i];
    if (equity[i] > hi) hi = equity[i];
  }
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const xOf = (index: number) => pad + (index / Math.max(1, last)) * (width - pad * 2);
  const yOf = (value: number) => pad + ((hi - value) / (hi - lo)) * (height - pad * 2);
  let path = "";
  for (let i = 0; i <= last; i++) {
    path += (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + " " + yOf(equity[i]).toFixed(1) + " ";
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-16 w-full" role="img" aria-label="Synthetic equity curve">
      <line x1={pad} x2={width - pad} y1={yOf(0)} y2={yOf(0)} stroke="var(--color-border)" />
      {trainEnd <= last && (
        <line x1={xOf(trainEnd)} x2={xOf(trainEnd)} y1={pad} y2={height - pad} stroke="var(--color-brass)" strokeDasharray="3 4" />
      )}
      {valEnd <= last && (
        <line x1={xOf(valEnd)} x2={xOf(valEnd)} y1={pad} y2={height - pad} stroke="var(--color-brass)" strokeDasharray="3 4" />
      )}
      <path d={path} fill="none" stroke="var(--color-brass)" strokeWidth="1.75" />
    </svg>
  );
}

function StatBlock({ summary, title }: { summary: Summary; title: string }) {
  const rows = [
    ["Trades", String(summary.trades)],
    ["Win rate", summary.winRate.toFixed(1) + "%"],
    ["Expectancy", money(summary.expectancy)],
    ["Profit factor", num(summary.profitFactor)],
    ["Net / oz", money(summary.net)],
    ["Max dip", money(summary.maxDd)],
  ];
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-3">
      <p className="text-xs tracking-wide text-brass uppercase">{title}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="text-sm text-fg tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function verdictFor(baseline: Summary, ml: Summary) {
  if (ml.trades < 5) {
    return "Out of sample, the model approved fewer than five retests. That is not a win over the baseline, and it is not a loss either. It abstained. On XAUUSD, abstaining still has to be judged against preset A after real costs.";
  }
  if (ml.net > 0 && ml.expectancy > baseline.expectancy) {
    return "On this synthetic slice the ML retests have a higher expectancy than the baseline. Treat that as a mechanics check only. It is not XAUUSD, and it is not permission to trade.";
  }
  return "On this synthetic slice the ML retests do not beat the pivot-only baseline out of sample. The testing plan says to keep the simpler rule, or drop the strategy, rather than add another parameter.";
}
