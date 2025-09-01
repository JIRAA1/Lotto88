const $ = (q) => document.querySelector(q);
let chartTop;

// Load count
async function loadHistoryInfo() {
  try {
    const res = await fetch("/api/history/count");
    const { count } = await res.json();
    $("#historyInfo").textContent = `history: ${count} งวด`;
    $("#historyInfo").className = "badge border-emerald-300 text-emerald-700 bg-emerald-50";
  } catch {
    $("#historyInfo").textContent = "history: n/a";
    $("#historyInfo").className = "badge border-rose-300 text-rose-700 bg-rose-50";
  }
}

function getWeights() {
  const w0 = parseFloat($("#w0").value || "0.5");
  const w1 = parseFloat($("#w1").value || "1");
  const w2 = parseFloat($("#w2").value || "0.5");
  const w3 = parseFloat($("#w3").value || "1");
  return `${w0},${w1},${w2},${w3}`;
}

async function runAnalyze() {
  const q = new URLSearchParams({
    targetDay: $("#targetDay").value,
    weights: getWeights(),
    alpha: $("#alpha").value || "0.5",
    k: $("#k").value || "50",
    epsilon: $("#epsilon").value || "1",
    top: $("#topK").value || "20"
  });
  const res = await fetch(`/api/summary?${q}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "summary error");

  // Summary info
  $("#sumN").textContent = data.N;
  $("#sumPrev").textContent = data.mostRecentPrev != null ? data.mostRecentPrev.toString().padStart(2,'0') : "-";
  $("#sumMonth").textContent = data.targetMonth ?? "-";

  // Table
  const tbody = $("#topTable");
  tbody.innerHTML = "";
  (data.top || []).forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-1">${i+1}</td>
      <td class="font-medium">${r.d.toString().padStart(2,'0')}</td>
      <td class="text-right">${(r.p*100).toFixed(2)}%</td>
    `;
    tbody.appendChild(tr);
  });

  // Chart (Top 20)
  const top20 = (data.dist || []).slice(0,20);
  const labels = top20.map(x => x.d.toString().padStart(2,'0'));
  const vals = top20.map(x => (x.p*100));
  if (chartTop) chartTop.destroy();
  chartTop = new Chart($("#chartTop"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Posterior (%)", data: vals }]
    },
    options: {
      responsive: true,
      animation: false,
      scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: true } }
    }
  });
}

async function runBacktest() {
  $("#btMetrics").innerHTML = "กำลังรัน…";
  const q = new URLSearchParams({
    btLast: $("#btLast").value || "60",
    btTop: $("#btTop").value || "10",
    weights: getWeights(),
    alpha: $("#alpha").value || "0.5",
    k: $("#k").value || "50",
    epsilon: $("#epsilon").value || "1"
  });
  const res = await fetch(`/api/backtest?${q}`);
  const data = await res.json();
  if (!data.ok) {
    $("#btMetrics").innerHTML = `<span class="text-rose-600">Error:</span> ${data.error}`;
    return;
  }

  const html = `
    <div>ทดสอบทั้งหมด: <b>${data.n}</b> งวด</div>
    <div>Top-1 Acc: <b>${(data.acc1*100).toFixed(2)}%</b> &nbsp;|&nbsp; Top-${$("#btTop").value} Acc: <b>${(data.accK*100).toFixed(2)}%</b></div>
    <div>Mean True P: <b>${(data.meanTrueP*100).toFixed(2)}%</b> &nbsp;|&nbsp; Mean Top1 P: <b>${(data.meanTop1P*100).toFixed(2)}%</b></div>
    <div>Mean NLL: <b>${data.meanNLL.toFixed(4)}</b></div>
  `;
  $("#btMetrics").innerHTML = html;

  // Compare with baseline (Top-K random ≈ K%)
  const k = parseInt($("#btTop").value || "10", 10);
  const baseline = k; // %
  $("#btCompare").innerHTML = `
    <div class="space-y-1">
      <div>Baseline (สุ่ม) Top-${k}: ~<b>${baseline}%</b></div>
      <div>โมเดลคุณ: <b>${(data.accK*100).toFixed(2)}%</b> 
        ${ (data.accK*100) > baseline ? "<span class='badge border-emerald-300 text-emerald-700 bg-emerald-50 ml-2'>ดีกว่า</span>" : "<span class='badge border-gray-300 text-gray-700 bg-gray-50 ml-2'>พอๆ/แย่กว่า</span>" }
      </div>
      <p class="text-xs muted">หมายเหตุ: ถ้า gap ยังเล็ก ให้เพิ่มจำนวนงวดข้อมูล และลองปรับ weights</p>
    </div>
  `;
}

$("#btnAnalyze").addEventListener("click", () => runAnalyze().catch(err => alert(err.message)));
$("#btnBacktest").addEventListener("click", () => runBacktest().catch(err => alert(err.message)));

loadHistoryInfo();
runAnalyze(); // auto-run on load
