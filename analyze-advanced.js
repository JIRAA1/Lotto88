// analyze-advanced.js (CLI) — now uses analyze-core.js
import path from "path";
import { fileURLToPath } from "url";
import { loadHistory, singleAnalysis, backtest } from "./analyze-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pad2 = (n) => n.toString().padStart(2, "0");

function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = {
    modeBacktest: false,
    btLast: 40,
    btTop: 10,
    top: 10,
    targetDay: 16,
    weights: [0.5, 1.0, 0.5, 1.0],
    alpha: 0.5,
    k: 50,
    epsilon: 1.0
  };
  for (const a of args) {
    if (a === "--backtest") cfg.modeBacktest = true;
    else if (a.startsWith("--bt-last=")) cfg.btLast = Math.max(1, parseInt(a.split("=")[1], 10));
    else if (a.startsWith("--bt-top=")) cfg.btTop = Math.max(1, parseInt(a.split("=")[1], 10));
    else if (a.startsWith("--top=")) cfg.top = Math.max(1, parseInt(a.split("=")[1], 10));
    else if (a.startsWith("--target-day=")) cfg.targetDay = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--weights=")) cfg.weights = a.split("=")[1].split(",").map(Number);
    else if (a.startsWith("--alpha=")) cfg.alpha = parseFloat(a.split("=")[1]);
    else if (a.startsWith("--k=")) cfg.k = parseFloat(a.split("=")[1]);
    else if (a.startsWith("--epsilon=")) cfg.epsilon = parseFloat(a.split("=")[1]);
  }
  return cfg;
}

(async () => {
  const cfg = parseArgs();
  const rows = loadHistory();

  if (!cfg.modeBacktest) {
    const { N, mostRecentPrev, targetMonth, rankedAll, cnt, z, pvals, sig } =
      singleAnalysis(rows, cfg);

    console.log("=== SUMMARY ===");
    console.log(`งวดทั้งหมดที่ใช้วิเคราะห์: ${N}`);
    console.log(`ล่าสุด (prev) = ${mostRecentPrev != null ? pad2(mostRecentPrev) : "NA"}`);
    console.log(`target-day=${cfg.targetDay}, target-month≈${targetMonth}`);
    console.log(`weights=[base,day,month,markov]=${cfg.weights.join(",")}, alpha=${cfg.alpha}, k=${cfg.k}, epsilon=${cfg.epsilon}`);

    console.log("\n=== TOP PICKS ===");
    rankedAll.slice(0, cfg.top).forEach((r, i) => {
      console.log(`${i+1}. ${r.d.toString().padStart(2,'0')}  | Posterior≈ ${(r.p*100).toFixed(2)}%`);
    });

    console.log("\n=== DIGITS WITH SIGNIFICANT DEVIATION vs UNIFORM (FDR 10%) ===");
    const sigList = [];
    for (let d = 0; d < 100; d++) if (sig[d]) sigList.push({ d, z: z[d], n: cnt[d] });
    if (sigList.length === 0) {
      console.log("ไม่มีตัวเลขที่แตกต่างจากสม่ำเสมออย่างมีนัยสำคัญ (ที่ระดับ FDR 10%)");
    } else {
      sigList.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
      for (const s of sigList) {
        console.log(`${s.d.toString().padStart(2,'0')} : count=${s.n}, z=${s.z.toFixed(2)}`);
      }
    }

    const pBest = rankedAll[0]?.p ?? (1/100);
    const ev = 2000 * pBest - 80;
    console.log("\n=== NOTE ON EXPECTED VALUE (EV) ===");
    console.log(`เลขอันดับ 1: P≈${(pBest*100).toFixed(2)}% → EV≈ ${ev.toFixed(2)} บาท/ใบ (ถ้าซื้อใบละ 80)`);
    console.log("ลอตเตอรี่มีค่า EV ติดลบเกือบแน่ ๆ — ใช้เพื่อการเรียนรู้เท่านั้น 🙏");

  } else {
    console.log("=== BACKTEST SETTINGS ===");
    console.log(`bt-last=${cfg.btLast}, bt-top=${cfg.btTop}`);
    console.log(`weights=[base,day,month,markov]=${cfg.weights.join(",")}, alpha=${cfg.alpha}, k=${cfg.k}, epsilon=${cfg.epsilon}`);

    const bt = backtest(rows, cfg);

    console.log("\n=== BACKTEST RESULTS (rolling, expanding window) ===");
    console.log(`ทดสอบทั้งหมด: ${bt.n} งวดล่าสุด`);
    console.log(`Top-1 Accuracy : ${(bt.acc1*100).toFixed(2)}% (baseline ~1.00%)`);
    console.log(`Top-${cfg.btTop} Accuracy : ${(bt.accK*100).toFixed(2)}% (baseline ~${(cfg.btTop)}%)`);
    console.log(`Mean True Probability : ${(bt.meanTrueP*100).toFixed(2)}%`);
    console.log(`Mean Top1 Probability : ${(bt.meanTop1P*100).toFixed(2)}%`);
    console.log(`Mean NLL (lower better) : ${bt.meanNLL.toFixed(4)}`);

    const tail = bt.perCase.slice(-10);
    console.log("\nตัวอย่าง 10 งวดท้ายสุดของ backtest (id, true, top1, p(top1), p(true)):");
    for (const r of tail) {
      console.log(`${r.id} | true=${r.true} | top1=${r.top1} | p(top1)=${(r.top1Prob*100).toFixed(2)}% | p(true)=${(r.trueProb*100).toFixed(2)}%`);
    }

    const OUT = path.join(__dirname, "data", "backtest_summary.json");
    await import("fs").then(fs =>
      fs.writeFileSync(OUT, JSON.stringify({
        settings: {
          btLast: cfg.btLast, btTop: cfg.btTop,
          weights: cfg.weights, alpha: cfg.alpha, k: cfg.k, epsilon: cfg.epsilon
        },
        results: bt
      }, null, 2), "utf8")
    );
    console.log(`\n📄 เขียนสรุปผลไว้ที่: ${OUT}`);
  }
})();
    