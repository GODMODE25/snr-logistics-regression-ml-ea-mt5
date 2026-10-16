import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as Download, i as Pause, n as RotateCcw, r as Play, t as TriangleAlert } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-B8Ey4lsr.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var DEFAULT_PARAMS = {
	mode: "ml-retest",
	pivotLength: 14,
	targetRespects: 3,
	cooldown: 3,
	maxAge: 500,
	touchAtr: .25,
	threshold: .55,
	learningRate: .03,
	l2: .001,
	normWindow: 120,
	minSamples: 25,
	balance: true,
	freeze: true,
	slAtr: 1.5,
	tpAtr: 3,
	spread: .3,
	commission: .1
};
var FT = 6;
var SCALE_CAP = 5;
var W_CAP = 8;
var Model = class {
	bias = 0;
	w = [
		0,
		0,
		0,
		0,
		0,
		0
	];
	samples = 0;
	pos = 0;
	lr;
	l2;
	balance;
	constructor(lr, l2, balance) {
		this.lr = lr;
		this.l2 = l2;
		this.balance = balance;
	}
	predict(x) {
		let z = this.bias;
		for (let i = 0; i < FT; i++) z += this.w[i] * x[i];
		if (z > 20) z = 20;
		if (z < -20) z = -20;
		return 1 / (1 + Math.exp(-z));
	}
	fit(x, y) {
		let scale = 1;
		if (this.balance && this.samples >= 10 && this.pos > 0 && this.pos < this.samples) {
			const pos = this.pos;
			const neg = this.samples - this.pos;
			scale = y === 1 ? .5 * this.samples / pos : .5 * this.samples / neg;
			if (scale > SCALE_CAP) scale = SCALE_CAP;
			if (scale < 1 / SCALE_CAP) scale = 1 / SCALE_CAP;
		}
		const err = (this.predict(x) - y) * scale;
		this.bias -= this.lr * err;
		this.bias = Math.max(-8, Math.min(W_CAP, this.bias));
		for (let i = 0; i < FT; i++) {
			this.w[i] -= this.lr * (err * x[i] + this.l2 * this.w[i]);
			this.w[i] = Math.max(-8, Math.min(W_CAP, this.w[i]));
		}
		this.samples++;
		if (y === 1) this.pos++;
	}
};
function selfCheck() {
	const m = new Model(.25, 0, false);
	const mid = m.predict([
		0,
		0,
		0,
		0,
		0,
		0
	]);
	const xp = [
		1,
		0,
		0,
		0,
		0,
		0
	];
	const xn = [
		-1,
		0,
		0,
		0,
		0,
		0
	];
	for (let i = 0; i < 250; i++) {
		m.fit(xp, 1);
		m.fit(xn, 0);
	}
	const pPos = m.predict(xp);
	const pNeg = m.predict(xn);
	return {
		ok: Math.abs(mid - .5) < 1e-9 && pPos > .85 && pNeg < .15 && m.w[0] > 0,
		pPos,
		pNeg
	};
}
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function gauss(rng) {
	const u = Math.max(1e-9, rng());
	const v = Math.max(1e-9, rng());
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}
function makeGoldPath(count, seed) {
	const rng = mulberry32(seed);
	const bars = [];
	let price = 2320;
	let vol = 1.35;
	let anchor = 2320;
	for (let i = 0; i < count; i++) {
		if (i % 280 === 0) anchor = price + gauss(rng) * 22;
		const shock = Math.abs(gauss(rng));
		vol = Math.min(4.2, Math.max(.55, vol * .96 + shock * .22));
		const pull = (anchor - price) * .01;
		const open = price;
		const close = Math.max(1200, open + pull + gauss(rng) * vol);
		const wick = Math.abs(gauss(rng)) * vol * .65;
		const high = Math.max(open, close) + wick * rng();
		const low = Math.min(open, close) - wick * rng();
		bars.push({
			t: i,
			o: open,
			h: high,
			l: low,
			c: close
		});
		price = close;
	}
	return bars;
}
function wilderRsi(closes, period) {
	const out = new Array(closes.length).fill(null);
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
function wilderAtr(bars, period) {
	const tr = bars.map((b, i) => {
		if (i === 0) return b.h - b.l;
		const pc = bars[i - 1].c;
		return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
	});
	const out = new Array(bars.length).fill(null);
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
function slopeAt(closes, index, len, atr) {
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
	return (len * sumXY - sumX * sumY) / denom / atr;
}
function zscore(hist, x) {
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
function emptySummary() {
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
		baselineTrades: 0
	};
}
function summarize(trades, equity, from, to) {
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
	s.winRate = s.trades ? 100 * s.wins / s.trades : 0;
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
function flags(mode) {
	if (mode === "baseline") return {
		retests: true,
		ml: false,
		breaks: false,
		breakMl: false
	};
	if (mode === "break") return {
		retests: false,
		ml: false,
		breaks: true,
		breakMl: false
	};
	if (mode === "ml-break") return {
		retests: false,
		ml: true,
		breaks: true,
		breakMl: true
	};
	return {
		retests: true,
		ml: true,
		breaks: false,
		breakMl: false
	};
}
function runStrategy(bars, params) {
	const n = bars.length;
	const closes = bars.map((b) => b.c);
	const rsi = wilderRsi(closes, params.pivotLength);
	const atr = wilderAtr(bars, params.pivotLength);
	const model = new Model(params.learningRate, params.l2, params.balance);
	const { retests, ml, breaks, breakMl } = flags(params.mode);
	const trainEnd = Math.floor(n * .6);
	const valEnd = Math.floor(n * .8);
	const levels = [];
	const views = [];
	const marks = [];
	const trades = [];
	const equity = new Array(n).fill(0);
	let eq = 0;
	let nextId = 1;
	let lastSupport = null;
	let lastResist = null;
	const distHist = [];
	const book = { pos: null };
	const splitOf = (index) => {
		if (index < trainEnd) return "train";
		if (index < valEnd) return "validation";
		return "oos";
	};
	const allowTrain = (index) => !params.freeze || index < trainEnd;
	const featuresAt = (pivot, support, levelPrice) => {
		const a = atr[pivot];
		const r = rsi[pivot];
		if (a == null || r == null || a <= 0) return null;
		const histR = [];
		const histB = [];
		const histU = [];
		const histL = [];
		const histS = [];
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
			zscore(histS, slopeAt(closes, pivot, params.pivotLength, a))
		];
		distHist.push(dist);
		if (distHist.length > 600) distHist.shift();
		return x;
	};
	const tryFill = (index, dir, kind, levelPrice, probability, useMl, barAtr) => {
		if (book.pos || index + 1 >= n) return;
		if (useMl && model.samples < params.minSamples) return;
		if (useMl && probability < params.threshold) return;
		const raw = bars[index + 1].o;
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
			level: levelPrice
		};
	};
	for (let i = 0; i < n; i++) {
		const pos = book.pos;
		if (pos && i >= pos.entryIndex) {
			const b = bars[i];
			let exit = null;
			let reason = "SL";
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
				const net = (pos.dir > 0 ? exit - pos.entry : pos.entry - exit) - params.commission;
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
					level: pos.level
				});
				book.pos = null;
			}
		}
		const queue = [];
		const a = atr[i];
		const tol = a != null ? a * params.touchAtr : 0;
		const bar = bars[i];
		let best = null;
		if (a != null && a > 0) for (const lv of levels) {
			if (lv.dead || i <= lv.confirm) continue;
			const age = i - lv.pivot;
			let broken = false;
			let retest = false;
			if (lv.support) {
				if (bar.c < lv.price) broken = true;
				else if (bar.l <= lv.price + tol && bar.c > lv.price && (!lv.hasRetest || i - lv.lastRetest > params.cooldown)) retest = true;
			} else if (bar.c > lv.price) broken = true;
			else if (bar.h >= lv.price - tol && bar.c < lv.price && (!lv.hasRetest || i - lv.lastRetest > params.cooldown)) retest = true;
			if (!broken && !retest && age >= params.maxAge) {
				lv.dead = true;
				lv.end = i;
				if (!lv.labelLocked) {
					lv.labelLocked = true;
					lv.label = 0;
					lv.trained = true;
					queue.push({
						x: lv.x,
						y: 0
					});
				}
				continue;
			}
			if (retest) {
				lv.respects++;
				lv.hasRetest = true;
				lv.lastRetest = i;
				marks.push({
					kind: "retest",
					t: i,
					price: lv.price,
					support: lv.support
				});
				if (!lv.labelLocked && lv.respects >= params.targetRespects) {
					lv.labelLocked = true;
					lv.label = 1;
					lv.trained = true;
					queue.push({
						x: lv.x,
						y: 1
					});
				}
				if (retests) {
					const probability = model.predict(lv.x);
					lv.probability = probability;
					const useMl = ml;
					const score = useMl ? probability : -Math.abs(bar.c - lv.price);
					if (!(useMl && model.samples < params.minSamples || useMl && probability < params.threshold) && (!best || score > best.score)) best = {
						score,
						dir: lv.support ? 1 : -1,
						kind: "retest",
						level: lv.price,
						probability,
						useMl,
						atr: a
					};
				}
			} else if (broken) {
				if (!lv.labelLocked) {
					lv.labelLocked = true;
					lv.label = 0;
					lv.trained = true;
					queue.push({
						x: lv.x,
						y: 0
					});
				}
				marks.push({
					kind: "break",
					t: i,
					price: lv.price,
					support: lv.support
				});
				if (breaks) {
					const probability = model.predict(lv.x);
					lv.probability = probability;
					const useMl = breakMl;
					const score = useMl ? probability : -Math.abs(bar.c - lv.price);
					if (!(useMl && model.samples < params.minSamples || useMl && probability < params.threshold) && (!best || score > best.score)) best = {
						score,
						dir: lv.support ? -1 : 1,
						kind: "break",
						level: lv.price,
						probability,
						useMl,
						atr: a
					};
				}
				lv.dead = true;
				lv.end = i;
			}
		}
		if (best) tryFill(i, best.dir, best.kind, best.level, best.probability, best.useMl, best.atr);
		if (allowTrain(i)) for (const sample of queue) model.fit(sample.x, sample.y);
		for (let k = levels.length - 1; k >= 0; k--) if (levels[k].dead) levels.splice(k, 1);
		const pivot = i - params.pivotLength;
		if (pivot >= params.pivotLength && a != null) {
			const add = (support) => {
				const price = support ? bars[pivot].l : bars[pivot].h;
				let ok = true;
				for (let k = 1; k <= params.pivotLength; k++) if (support) {
					if (bars[pivot - k].l <= price || bars[pivot + k].l <= price) ok = false;
				} else if (bars[pivot - k].h >= price || bars[pivot + k].h >= price) ok = false;
				if (!ok) return;
				const x = featuresAt(pivot, support, price);
				if (!x) return;
				const lv = {
					id: nextId++,
					support,
					price,
					pivot,
					confirm: i,
					respects: 0,
					lastRetest: -1e5,
					hasRetest: false,
					x,
					probability: model.predict(x),
					labelLocked: false,
					label: 0,
					trained: false,
					dead: false,
					end: null
				};
				levels.push(lv);
				views.push({
					id: lv.id,
					support,
					price,
					confirm: i,
					end: null,
					probability: lv.probability
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
			} else view.probability = live.probability;
		}
		equity[i] = eq;
	}
	for (const view of views) if (view.end == null) view.end = null;
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
		oos: summarize(trades, equity, valEnd, n)
	};
}
var BARS = 1400;
var MODES = [
	{
		id: "baseline",
		label: "A Baseline",
		hint: "Every valid retest"
	},
	{
		id: "ml-retest",
		label: "B ML retest",
		hint: "Retest only if the model agrees"
	},
	{
		id: "break",
		label: "C Break",
		hint: "Trade the close through the level"
	},
	{
		id: "ml-break",
		label: "D ML break",
		hint: "Break only if the model agrees"
	}
];
function money(n) {
	return (n < 0 ? "−" : "") + "$" + Math.abs(n).toFixed(2);
}
function num(n, d = 2) {
	if (!Number.isFinite(n)) return "—";
	if (n >= 999) return "inf";
	return n.toFixed(d);
}
function readColor(name, fallback) {
	if (typeof document === "undefined") return fallback;
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function StrategyLab() {
	const check = (0, import_react.useMemo)(() => selfCheck(), []);
	const [mode, setMode] = (0, import_react.useState)("baseline");
	const [pivot, setPivot] = (0, import_react.useState)(14);
	const [threshold, setThreshold] = (0, import_react.useState)(.55);
	const [seed, setSeed] = (0, import_react.useState)(7);
	const [cursor, setCursor] = (0, import_react.useState)(1399);
	const [playing, setPlaying] = (0, import_react.useState)(false);
	const canvasRef = (0, import_react.useRef)(null);
	const wrapRef = (0, import_react.useRef)(null);
	const bars = (0, import_react.useMemo)(() => makeGoldPath(BARS, seed), [seed]);
	const shared = (0, import_react.useMemo)(() => ({
		...DEFAULT_PARAMS,
		pivotLength: pivot,
		threshold
	}), [pivot, threshold]);
	const runs = (0, import_react.useMemo)(() => {
		const out = {};
		for (const item of MODES) out[item.id] = runStrategy(bars, {
			...shared,
			mode: item.id
		});
		return out;
	}, [bars, shared]);
	const run = runs[mode];
	(0, import_react.useEffect)(() => {
		setCursor(1399);
		setPlaying(false);
	}, [
		seed,
		pivot,
		threshold,
		mode
	]);
	(0, import_react.useEffect)(() => {
		if (!playing) return;
		const id = window.setInterval(() => {
			setCursor((c) => {
				if (c >= 1399) {
					setPlaying(false);
					return c;
				}
				return Math.min(1399, c + 2);
			});
		}, 70);
		return () => window.clearInterval(id);
	}, [playing]);
	(0, import_react.useEffect)(() => {
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
			const span = Math.max(.5, hi - lo);
			const bandLo = lo - span * .45;
			const bandHi = hi + span * .45;
			const pad = span * .08;
			lo -= pad;
			hi += pad;
			const xOf = (index) => padL + (index - start) / Math.max(1, view - 1) * plotW;
			const yOf = (price) => padT + (hi - price) / (hi - lo) * plotH;
			const inBand = (price) => price >= bandLo && price <= bandHi;
			const lastClose = visible.length ? visible[visible.length - 1].c : 0;
			const shownLevels = run.levels.filter((level) => {
				if (level.confirm > cursor) return false;
				if (level.end != null && level.end < start) return false;
				return inBand(level.price);
			}).sort((a, b) => {
				const aLive = a.end == null || a.end > cursor ? 0 : 1;
				const bLive = b.end == null || b.end > cursor ? 0 : 1;
				if (aLive !== bLive) return aLive - bLive;
				return Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose);
			}).slice(0, 8);
			ctx.strokeStyle = grid;
			ctx.lineWidth = 1;
			ctx.font = "11px 'IBM Plex Sans', sans-serif";
			ctx.fillStyle = muted;
			for (let g = 0; g < 5; g++) {
				const price = lo + (hi - lo) * g / 4;
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
			ctx.globalAlpha = .55;
			ctx.font = "11px 'IBM Plex Sans', sans-serif";
			for (const split of [{
				x: trainX,
				label: "Val"
			}, {
				x: valX,
				label: "OOS"
			}]) {
				if (split.x < padL || split.x > width - padR) continue;
				ctx.beginPath();
				ctx.moveTo(split.x, padT);
				ctx.lineTo(split.x, padT + plotH);
				ctx.stroke();
				ctx.globalAlpha = .9;
				ctx.fillStyle = brass;
				ctx.fillText(split.label, split.x + 4, 24);
				ctx.globalAlpha = .55;
			}
			ctx.restore();
			const slot = plotW / view;
			const bodyW = Math.max(2.2, slot * .62);
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
				ctx.globalAlpha = up ? .9 : .75;
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
				ctx.globalAlpha = live ? .9 : .28;
				ctx.lineWidth = live ? 1.5 : 1;
				ctx.beginPath();
				ctx.moveTo(x1, y);
				ctx.lineTo(x2, y);
				ctx.stroke();
				if (live && (mode === "ml-retest" || mode === "ml-break") && labeled.includes(level)) {
					ctx.globalAlpha = level.probability >= threshold ? 1 : .55;
					ctx.fillStyle = level.probability >= threshold ? level.support ? support : resistance : muted;
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
					ctx.globalAlpha = .55;
					ctx.beginPath();
					ctx.moveTo(x1, yOf(trade.sl));
					ctx.lineTo(x2, yOf(trade.sl));
					ctx.stroke();
				}
				if (inBand(trade.tp)) {
					ctx.strokeStyle = support;
					ctx.globalAlpha = .55;
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
					ctx.globalAlpha = .35;
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
	}, [
		bars,
		cursor,
		mode,
		run,
		threshold
	]);
	const verdict = verdictFor(runs.baseline.oos, runs["ml-retest"].oos);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs font-medium tracking-widest text-brass uppercase",
						children: "MetaTrader 5 expert advisor"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "mt-1 text-3xl text-fg sm:text-4xl",
						children: "XAUUSD support and resistance"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 max-w-xl text-sm leading-relaxed text-muted",
						children: "Closed candles only. Logistic regression is fit on resolved levels, not on the pivot it is scoring."
					})
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-2 sm:flex-row",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
						className: "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brass px-4 text-sm font-medium text-bg",
						href: "/XAUUSD_SR_LogReg_EA.mq5",
						download: true,
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, {
							className: "size-4",
							"aria-hidden": true
						}), "Download EA"]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						className: "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-fg",
						href: "/XAUUSD_SR_LogReg_TESTING_PLAN.txt",
						download: true,
						children: "Testing plan"
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-4 flex gap-3 rounded-lg border border-border bg-surface px-3 py-3 text-sm text-muted",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, {
					className: "mt-0.5 size-4 shrink-0 text-brass",
					"aria-hidden": true
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "This chart is a synthetic path, not XAUUSD history. Nothing on this page is a profitability claim. The out-of-sample number that matters is the one MetaTrader prints after commission, spread, and swap." })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-xl border border-border bg-surface",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm font-medium text-fg",
								children: MODES.find((m) => m.id === mode)?.label
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-xs text-muted",
								children: "Candles stay in scale. Green is support, red is resistance. Dashed green and red are the last two trades’ target and stop."
							})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm text-fg",
									onClick: () => setPlaying((p) => !p),
									children: [playing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, { className: "size-4" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, { className: "size-4" }), playing ? "Pause" : "Play"]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm text-fg",
									onClick: () => {
										setCursor(Math.min(80, 1399));
										setPlaying(true);
									},
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RotateCcw, { className: "size-4" }), "Replay"]
								})]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap gap-x-4 gap-y-1 px-3 pt-2 text-xs text-muted",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-support",
									children: "Support / target"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-resistance",
									children: "Resistance / stop"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "R retest" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "B break" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-brass",
									children: "Train | validation | out of sample"
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							ref: wrapRef,
							className: "h-72 sm:h-96",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
								ref: canvasRef,
								className: "block h-full w-full"
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "border-t border-border px-3 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-baseline justify-between gap-3",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-xs tracking-wide text-brass uppercase",
									children: "Equity per ounce"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "text-xs text-muted tabular-nums",
									children: [money(run.equity[cursor] ?? 0), " at this bar"]
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EquityChart, {
								equity: run.equity,
								cursor,
								trainEnd: run.trainEnd,
								valEnd: run.valEnd
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block px-3 pb-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "text-xs text-muted",
								children: [
									"Bar ",
									cursor + 1,
									" of ",
									BARS
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: "mt-2 w-full accent-brass",
								type: "range",
								min: 40,
								max: 1399,
								value: cursor,
								suppressHydrationWarning: true,
								onChange: (e) => {
									setPlaying(false);
									setCursor(Number(e.target.value));
								}
							})]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "flex flex-col gap-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "grid grid-cols-2 gap-2",
							children: MODES.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => setMode(item.id),
								className: "h-16 rounded-lg border px-2 text-left " + (mode === item.id ? "border-brass bg-surface-2 text-fg" : "border-border bg-surface text-muted"),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "block text-sm font-medium text-fg",
									children: item.label
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "block text-xs",
									children: item.hint
								})]
							}, item.id))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "rounded-lg border border-border bg-surface px-3 py-2 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "flex justify-between text-muted",
								children: ["Pivot length ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "tabular-nums text-fg",
									children: pivot
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: "mt-2 w-full accent-brass",
								type: "range",
								min: 5,
								max: 28,
								value: pivot,
								onChange: (e) => setPivot(Number(e.target.value)),
								suppressHydrationWarning: true
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "rounded-lg border border-border bg-surface px-3 py-2 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "flex justify-between text-muted",
								children: ["Probability threshold ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "tabular-nums text-fg",
									children: threshold.toFixed(2)
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: "mt-2 w-full accent-brass",
								type: "range",
								min: .35,
								max: .8,
								step: .01,
								value: threshold,
								onChange: (e) => setThreshold(Number(e.target.value)),
								suppressHydrationWarning: true
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted",
							children: ["Path seed", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: "mt-2 h-11 w-full rounded-md border border-border bg-bg px-3 text-fg tabular-nums",
								type: "number",
								min: 1,
								max: 9999,
								value: seed,
								onChange: (e) => setSeed(Math.max(1, Number(e.target.value) || 1)),
								suppressHydrationWarning: true
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatBlock, {
							summary: run.oos,
							title: "Out of sample, this path"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "grid grid-cols-3 gap-2",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MiniSplit, {
									title: "Train",
									summary: run.train
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MiniSplit, {
									title: "Check",
									summary: run.validation
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MiniSplit, {
									title: "OOS",
									summary: run.oos
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(WeightRow, { weights: run.weights })
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "text-2xl text-fg",
						children: "Same path, four rules"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 max-w-3xl text-sm text-muted",
						children: verdict
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3 overflow-x-auto rounded-xl border border-border",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
							className: "w-full min-w-[40rem] text-left text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
								className: "bg-surface text-xs tracking-wide text-muted uppercase",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "px-3 py-2 font-medium",
										children: "Rule"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "px-3 py-2 font-medium",
										children: "OOS trades"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "px-3 py-2 font-medium",
										children: "OOS expectancy"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "px-3 py-2 font-medium",
										children: "OOS profit factor"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "px-3 py-2 font-medium",
										children: "OOS net / oz"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "px-3 py-2 font-medium",
										children: "All trades"
									})
								] })
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: MODES.map((item) => {
								const s = runs[item.id];
								return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
									className: "border-t border-border " + (item.id === mode ? "bg-surface-2" : ""),
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
											className: "px-3 py-2 text-fg",
											children: item.label
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
											className: "px-3 py-2 tabular-nums",
											children: s.oos.trades
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
											className: "px-3 py-2 tabular-nums",
											children: money(s.oos.expectancy)
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
											className: "px-3 py-2 tabular-nums",
											children: num(s.oos.profitFactor)
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
											className: "px-3 py-2 tabular-nums",
											children: money(s.oos.net)
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
											className: "px-3 py-2 tabular-nums",
											children: s.all.trades
										})
									]
								}, item.id);
							}) })]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2 text-xs text-muted",
						children: [
							"Toy costs: ",
							shared.spread.toFixed(2),
							" spread on the entry and ",
							shared.commission.toFixed(2),
							" commission, per ounce. Resolved training samples on this path: ",
							run.samples,
							", of which ",
							run.positives,
							" reached ",
							shared.targetRespects,
							" retests. Label 1 is rare, so a 0.55 threshold often approves very little. That is the model being selective, not a hidden edge."
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8 grid gap-4 md:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "text-xl text-fg",
							children: "What was thrown out of the Pine script"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
							className: "mt-3 space-y-2 text-sm text-muted",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Weights were reset inside every prediction. They now persist across bars and update only when a level resolves." }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "The new pivot was trained as a failure before it had an outcome. A level is never in its own training set." }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "The step used probability plus loss. The EA uses error = prediction − target, then L2 on the weights." }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "RSI and candle body were crushed to a yes/no bit. Features stay continuous and are z-scored on a trailing window." })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-3 text-sm text-fg",
							children: [
								"Gradient check: ",
								check.ok ? "passed" : "failed",
								". P(success | +1) ",
								check.pPos.toFixed(2),
								", P(success | −1) ",
								check.pNeg.toFixed(2),
								"."
							]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "text-xl text-fg",
						children: "How a trade is allowed"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", {
						className: "mt-3 list-decimal space-y-2 pl-4 text-sm text-muted",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
								"A pivot is confirmed only after ",
								pivot,
								" later candles have closed."
							] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Support holds if price tags the level and closes back above it. Resistance is the mirror." }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "A close through the level breaks it. Touch distance is ATR × 0.25. Retests wait 3 bars." }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Buy the support retest, or sell the resistance retest, at the next market price. One position." }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Stop sits 1.5 ATR beyond the level. Target is 3 ATR, unless you switch the EA to an R multiple." })
						]
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8 rounded-xl border border-border bg-surface p-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "text-xl text-fg",
						children: "Strategy Tester settings"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 max-w-3xl text-sm text-muted",
						children: "Run M5 and M15 separately. Debug on 1 minute OHLC, then confirm survivors on every tick based on real ticks. Set the EA split dates to the tester From and To. Train is the first 60%, validation the next 20%, and the last 20% is the only score that counts. OnTester returns the validation profit factor, never the out-of-sample one."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3 overflow-x-auto",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("table", {
							className: "w-full min-w-[36rem] text-left text-sm",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: [
								["Symbol / timeframes", "XAUUSD, M5 then M15"],
								["Debug model", "1 minute OHLC, full downloaded history"],
								["Final model", "Every tick based on real ticks"],
								["Presets", "A baseline, B ML retest, C break, D ML break"],
								["Costs", "Real commission, symbol swap, non-zero slippage"],
								["EA deviation", "50 points, at or above tester slippage"],
								["Daily loss, for the comparison", "Set to 0 so the brake does not pick the winner"],
								["Success", "OOS expectancy > 0 after costs, 1,000+ trades, ML beats A on both timeframes"]
							].map(([k, v]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
								className: "border-t border-border",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "w-1/3 px-3 py-2 text-left font-medium text-muted",
									children: k
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "px-3 py-2 text-fg",
									children: v
								})]
							}, k)) })
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-muted",
						children: "Copy the .mq5 into MQL5/Experts and compile with F7. The journal must print “Logistic self-check passed” before you read a result. If ML does not beat the baseline out of sample, keep preset A or stop. Do not add filters to rescue a curve."
					})
				]
			})
		]
	});
}
function MiniSplit({ title, summary }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-lg border border-border bg-surface px-2 py-2",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs tracking-wide text-brass uppercase",
				children: title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-1 text-sm text-fg tabular-nums",
				children: [summary.trades, " trades"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "text-xs text-muted tabular-nums",
				children: [money(summary.expectancy), " / trade"]
			})
		]
	});
}
var FEATURES = [
	"RSI",
	"Body",
	"Upper",
	"Lower",
	"Dist",
	"Slope"
];
function WeightRow({ weights }) {
	const max = Math.max(.2, ...weights.map((value) => Math.abs(value)));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-lg border border-border bg-surface px-3 py-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs tracking-wide text-brass uppercase",
				children: "Weights after the train window"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-2 grid grid-cols-6 gap-2",
				children: FEATURES.map((name, index) => {
					const value = weights[index] ?? 0;
					const height = Math.max(8, Math.abs(value) / max * 100);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-center",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mx-auto flex h-14 w-2 items-end rounded-sm bg-bg",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "w-full " + (value >= 0 ? "bg-support" : "bg-resistance"),
								style: { height: height + "%" }
							})
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-xs text-muted",
							children: name
						})]
					}, name);
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-xs text-muted",
				children: "Green pushes toward “level holds.” Red pushes toward a break or expiry."
			})
		]
	});
}
function EquityChart({ equity, cursor, trainEnd, valEnd }) {
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
	const xOf = (index) => pad + index / Math.max(1, last) * 632;
	const yOf = (value) => pad + (hi - value) / (hi - lo) * 56;
	let path = "";
	for (let i = 0; i <= last; i++) path += (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + " " + yOf(equity[i]).toFixed(1) + " ";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		viewBox: `0 0 ${width} ${height}`,
		className: "mt-2 h-16 w-full",
		role: "img",
		"aria-label": "Synthetic equity curve",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
				x1: pad,
				x2: 636,
				y1: yOf(0),
				y2: yOf(0),
				stroke: "var(--color-border)"
			}),
			trainEnd <= last && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
				x1: xOf(trainEnd),
				x2: xOf(trainEnd),
				y1: pad,
				y2: 60,
				stroke: "var(--color-brass)",
				strokeDasharray: "3 4"
			}),
			valEnd <= last && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
				x1: xOf(valEnd),
				x2: xOf(valEnd),
				y1: pad,
				y2: 60,
				stroke: "var(--color-brass)",
				strokeDasharray: "3 4"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				d: path,
				fill: "none",
				stroke: "var(--color-brass)",
				strokeWidth: "1.75"
			})
		]
	});
}
function StatBlock({ summary, title }) {
	const rows = [
		["Trades", String(summary.trades)],
		["Win rate", summary.winRate.toFixed(1) + "%"],
		["Expectancy", money(summary.expectancy)],
		["Profit factor", num(summary.profitFactor)],
		["Net / oz", money(summary.net)],
		["Max dip", money(summary.maxDd)]
	];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-lg border border-border bg-surface px-3 py-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-xs tracking-wide text-brass uppercase",
			children: title
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
			className: "mt-2 grid grid-cols-2 gap-x-3 gap-y-2",
			children: rows.map(([k, v]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
				className: "text-xs text-muted",
				children: k
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
				className: "text-sm text-fg tabular-nums",
				children: v
			})] }, k))
		})]
	});
}
function verdictFor(baseline, ml) {
	if (ml.trades < 5) return "Out of sample, the model approved fewer than five retests. That is not a win over the baseline, and it is not a loss either. It abstained. On XAUUSD, abstaining still has to be judged against preset A after real costs.";
	if (ml.net > 0 && ml.expectancy > baseline.expectancy) return "On this synthetic slice the ML retests have a higher expectancy than the baseline. Treat that as a mechanics check only. It is not XAUUSD, and it is not permission to trade.";
	return "On this synthetic slice the ML retests do not beat the pivot-only baseline out of sample. The testing plan says to keep the simpler rule, or drop the strategy, rather than add another parameter.";
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StrategyLab, {});
}
//#endregion
export { Home as component };
