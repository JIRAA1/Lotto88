// server-web.js
import express from "express";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { loadHistory, singleAnalysis, backtest, getHistoryCount } from "./analyze-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(morgan("dev"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function parseWeights(q) {
  const txt = (q.weights ?? "0.5,1,0.5,1").toString();
  const arr = txt.split(",").map(Number);
  if (arr.length !== 4 || arr.some(x => Number.isNaN(x))) return [0.5, 1, 0.5, 1];
  return arr;
}

// Health / info
app.get("/api/history/count", (_req, res) => {
  res.json({ count: getHistoryCount() });
});

// Summary (analysis for next draw)
app.get("/api/summary", (req, res) => {
  try {
    const rows = loadHistory();
    const cfg = {
      targetDay: parseInt(req.query.targetDay ?? "16", 10),
      weights: parseWeights(req.query),
      alpha: parseFloat(req.query.alpha ?? "0.5"),
      k: parseFloat(req.query.k ?? "50"),
      epsilon: parseFloat(req.query.epsilon ?? "1.0")
    };
    const out = singleAnalysis(rows, cfg);
    const top = parseInt(req.query.top ?? "20", 10);
    res.json({
      ok: true,
      N: out.N,
      mostRecentPrev: out.mostRecentPrev,
      targetMonth: out.targetMonth,
      top: out.rankedAll.slice(0, top), // [{d,p}]
      dist: out.rankedAll,              // ทั้ง 100 ตัว
      note: "EV ของลอตเตอรี่ทั่วไปเป็นลบ ใช้เพื่อการเรียนรู้เท่านั้น"
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Backtest
app.get("/api/backtest", (req, res) => {
  try {
    const rows = loadHistory();
    const cfg = {
      btLast: parseInt(req.query.btLast ?? "60", 10),
      btTop: parseInt(req.query.btTop ?? "10", 10),
      weights: parseWeights(req.query),
      alpha: parseFloat(req.query.alpha ?? "0.5"),
      k: parseFloat(req.query.k ?? "50"),
      epsilon: parseFloat(req.query.epsilon ?? "1.0")
    };
    const bt = backtest(rows, cfg);
    res.json({ ok: true, ...bt });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Admin endpoints for Render Cron ---
import { execFile } from "child_process";

function authOK(req) {
  const hdr = req.get("authorization") || "";
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  const token = bearer || req.query.key; // เผื่อเรียกแบบ ?key=...
  return token && process.env.FETCH_KEY && token === process.env.FETCH_KEY;
}

function runNodeScript(args, cb) {
  execFile(process.execPath, args, { env: process.env }, (err, stdout, stderr) => {
    cb(err, (stdout || "") + (stderr || ""));
  });
}

// ดึงงวดล่าสุด
app.post("/api/admin/fetch", (req, res) => {
  if (!authOK(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  runNodeScript(["fetch-lotto.js", "--latest"], (err, out) => {
    if (err) return res.status(500).json({ ok: false, error: err.message, out });
    res.json({ ok: true, out });
  });
});

// (ออปชัน) backfill ครั้งแรก
app.post("/api/admin/backfill", (req, res) => {
  if (!authOK(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  runNodeScript(["fetch-lotto.js", "--backfill=all"], (err, out) => {
    if (err) return res.status(500).json({ ok: false, error: err.message, out });
    res.json({ ok: true, out });
  });
});


const PORT = process.env.PORT || 5173;
app.listen(PORT, () => {
  console.log(`✅ Web UI ready: http://localhost:${PORT}`);
});
