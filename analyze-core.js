
// analyze-core.js
// Core model: Dirichlet-Multinomial + Seasonality (day/month w/ shrink) + Markov(1)
// Exports: loadHistory, singleAnalysis, backtest, getHistoryCount

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const HISTORY_PATH = path.join(DATA_DIR, "history.json");

// ---------- Utils ----------
const pad2 = (n) => n.toString().padStart(2, "0");
const softmax = (arr) => {
  const m = Math.max(...arr);
  const ex = arr.map((v) => Math.exp(v - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / (s || 1));
};
function parseFromId(id) {
  if (!id || id.length !== 8) return null;
  const d = parseInt(id.slice(0, 2), 10);
  const m = parseInt(id.slice(2, 4), 10);
  const yBE = parseInt(id.slice(4, 8), 10);
  if (Number.isNaN(d) || Number.isNaN(m) || Number.isNaN(yBE)) return null;
  const yCE = yBE - 543;
  return { day: d, month: m, yearCE: yCE, yearBE: yBE };
}
function bhFDR(pvals, alpha = 0.10) {
  const n = pvals.length;
  const pairs = pvals.map((p, i) => ({ i, p })).sort((a, b) => a.p - b.p);
  let k = -1;
  for (let j = 0; j < n; j++) {
    if (pairs[j].p <= ((j + 1) / n) * alpha) k = j;
  }
  const rejected = new Array(n).fill(false);
  if (k >= 0) for (let j = 0; j <= k; j++) rejected[pairs[j].i] = true;
  return rejected;
}

// ---------- Data ----------
export function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    const msg = "ไม่พบไฟล์ data/history.json — รัน fetch-lotto.js เก็บข้อมูลก่อน";
    throw new Error(msg);
  }
  const arr = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
  arr.sort((a, b) => (b.id || "").localeCompare(a.id || ""));
  const rows = arr
    .map((r) => {
      const meta = parseFromId(r.id);
      if (!meta) return null;
      const last2 = r.last2 == null ? null : parseInt(r.last2, 10);
      return { id: r.id, last2, day: meta.day, month: meta.month, yearCE: meta.yearCE };
    })
    .filter(Boolean)
    .filter((r) => r.last2 != null && r.last2 >= 0 && r.last2 <= 99);
  return rows;
}
export function getHistoryCount() {
  if (!fs.existsSync(HISTORY_PATH)) return 0;
  try {
    const arr = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return Array.isArray(arr) ? arr.length : 0;
  } catch { return 0; }
}

// ---------- Stats helpers ----------
function counts00_99(rows) {
  const cnt = Array.from({ length: 100 }, () => 0);
  for (const r of rows) cnt[r.last2]++;
  return { cnt, N: rows.length };
}
function dirichletPosterior(cnt, N, alpha = 0.5) {
  const den = N + 100 * alpha;
  return cnt.map((c) => (c + alpha) / den);
}
function countsByDay(rows, day) {
  const sub = rows.filter((r) => r.day === day);
  return counts00_99(sub);
}
function countsByMonth(rows, month) {
  const sub = rows.filter((r) => r.month === month);
  return counts00_99(sub);
}
function shrink(pSpec, pBase, nSpec, k = 50) {
  const w = nSpec / (nSpec + k);
  return pSpec.map((v, i) => w * v + (1 - w) * pBase[i]);
}
function markov1(rows, epsilon = 1.0) {
  // rows: ใหม่→เก่า ; prev = rows[i+1], next = rows[i]
  const trans = Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 0));
  for (let i = 0; i < rows.length - 1; i++) {
    const prev = rows[i + 1].last2;
    const next = rows[i].last2;
    trans[prev][next]++;
  }
  const prob = trans.map((row) => {
    const s = row.reduce((a, b) => a + b, 0);
    const den = s + 100 * epsilon;
    return row.map((c) => (c + epsilon) / den);
  });
  const mostRecentPrev = rows.length >= 1 ? rows[0].last2 : null;
  return { prob, mostRecentPrev };
}
function zAndPvals(cnt, N) {
  const p0 = 1 / 100;
  const mu = N * p0;
  const sigma = Math.sqrt(N * p0 * (1 - p0)) || 1;
  const z = cnt.map((x) => (x - mu) / sigma);
  const pvals = z.map((zz) => 2 * (1 - normalCdf(Math.abs(zz))));
  return { z, pvals };
}
function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function erf(x) {
  const sign = Math.sign(x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t*Math.exp(-x*x);
  return sign * y;
}
function combinePosterior({ pBase, pDay, pMonth, pMarkov, weights }) {
  const [w0, w1, w2, w3] = weights;
  const tiny = 1e-12;
  const log = (x) => Math.log(Math.max(x, tiny));
  const logP = Array.from({ length: 100 }, (_, d) =>
    w0 * log(pBase[d]) +
    w1 * log(pDay[d]) +
    w2 * log(pMonth[d]) +
    w3 * log(pMarkov[d])
  );
  return softmax(logP);
}

// ---------- Single analysis ----------
export function singleAnalysis(rows, cfg) {
  const { cnt, N } = counts00_99(rows);
  const pBase = dirichletPosterior(cnt, N, cfg.alpha);

  const { cnt: cntD, N: ND } = countsByDay(rows, cfg.targetDay);
  const pDay = shrink(dirichletPosterior(cntD, ND, cfg.alpha), pBase, ND, cfg.k);

  const last = rows[0];
  const targetMonth = last ? last.month : 1; // ปรับได้ตาม logic ที่ต้องการ
  const { cnt: cntM, N: NM } = countsByMonth(rows, targetMonth);
  const pMonth = shrink(dirichletPosterior(cntM, NM, cfg.alpha), pBase, NM, cfg.k);

  const { prob: markovMat, mostRecentPrev } = markov1(rows, cfg.epsilon);
  const pMarkov = mostRecentPrev == null ? Array(100).fill(1/100) : markovMat[mostRecentPrev];

  const post = combinePosterior({ pBase, pDay, pMonth, pMarkov, weights: cfg.weights });
  const rankedAll = post.map((p, d) => ({ d, p })).sort((a, b) => b.p - a.p);

  const { z, pvals } = zAndPvals(cnt, N);
  const sig = bhFDR(pvals, 0.10);

  return {
    N, mostRecentPrev, targetMonth,
    post, rankedAll, z, pvals, sig, cnt
  };
}

// ---------- Backtest ----------
function buildPosteriorForTarget(trainRows, cfg, targetDay, targetMonth) {
  const { cnt, N } = counts00_99(trainRows);
  const pBase = dirichletPosterior(cnt, N, cfg.alpha);
  const { cnt: cntD, N: ND } = countsByDay(trainRows, targetDay);
  const pDay = shrink(dirichletPosterior(cntD, ND, cfg.alpha), pBase, ND, cfg.k);
  const { cnt: cntM, N: NM } = countsByMonth(trainRows, targetMonth);
  const pMonth = shrink(dirichletPosterior(cntM, NM, cfg.alpha), pBase, NM, cfg.k);
  const { prob: markovMat, mostRecentPrev } = markov1(trainRows, cfg.epsilon);
  const pMarkov = mostRecentPrev == null ? Array(100).fill(1/100) : markovMat[mostRecentPrev];
  return combinePosterior({ pBase, pDay, pMonth, pMarkov, weights: cfg.weights });
}
export function backtest(rowsNewToOld, cfg) {
  const rows = [...rowsNewToOld].reverse(); // oldest → newest
  const T = rows.length;
  const L = Math.min(cfg.btLast, T - 2);
  if (L <= 0) throw new Error("ข้อมูลน้อยเกินไปสำหรับ backtest");
  const start = T - L;

  let top1Hit = 0, topKHit = 0, sumLogLoss = 0, sumTrueProb = 0, sumTop1Prob = 0;
  const perCase = [];

  for (let t = start; t < T; t++) {
    const train = rows.slice(0, t);
    const target = rows[t];
    const post = buildPosteriorForTarget(train, cfg, target.day, target.month);
    const ranked = post.map((p, d) => ({ d, p })).sort((a, b) => b.p - a.p);

    const top1 = ranked[0];
    const topK = ranked.slice(0, cfg.btTop);
    const trueProb = post[target.last2];
    const logLoss = -Math.log(Math.max(trueProb, 1e-12));

    if (top1.d === target.last2) top1Hit++;
    if (topK.some(x => x.d === target.last2)) topKHit++;
    sumLogLoss += logLoss;
    sumTrueProb += trueProb;
    sumTop1Prob += top1.p;

    perCase.push({
      id: rows[t].id,
      true: pad2(target.last2),
      top1: pad2(top1.d),
      top1Prob: top1.p,
      trueProb: trueProb
    });
  }

  const n = L;
  return {
    n,
    acc1: top1Hit / n,
    accK: topKHit / n,
    meanNLL: sumLogLoss / n,
    meanTrueP: sumTrueProb / n,
    meanTop1P: sumTop1Prob / n,
    perCase
  };
}
