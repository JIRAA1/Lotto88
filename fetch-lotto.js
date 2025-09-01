// fetch-lotto.js
// ดึง "เลขท้าย 2 ตัว" จาก rayriffy API แล้วบันทึกลงไฟล์ JSON โดยไม่มีฐานข้อมูล
// โหมดใช้งาน:
//   - ดึงงวดล่าสุด:  node fetch-lotto.js --latest
//   - ย้อนหลัง (ดึง list หน้าละ ~20 งวด): node fetch-lotto.js --backfill=3
//     (จะวนหน้า 1..3 แล้วเก็บเข้าคลัง data/history.json แบบไม่ซ้ำ)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = "https://lotto.api.rayriffy.com";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const HISTORY_PATH = path.join(DATA_DIR, "history.json");

async function httpGetJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "lotto-scraper/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_PATH)) fs.writeFileSync(HISTORY_PATH, "[]", "utf8");
}

function loadHistory() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  // จัดเรียงตามวันที่ไทย (string) เอา id ใหม่ขึ้นก่อนก็พอ
  const sorted = [...entries].sort((a, b) => (b.id || "").localeCompare(a.id || ""));
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(sorted, null, 2), "utf8");
}

function extractLastTwoFromResponse(resp) {
  // โครง JSON: response.runningNumbers[].id == "runningNumberBackTwo"
  const node = (resp?.response?.runningNumbers || []).find(
    (r) => r.id === "runningNumberBackTwo"
  );
  if (!node || !Array.isArray(node.number) || node.number.length === 0) return null;
  // ปกติเป็น string เช่น "31"
  return String(node.number[0]).padStart(2, "0");
}

async function fetchLatest() {
  const url = `${API_BASE}/latest`;
  const data = await httpGetJson(url);
  const last2 = extractLastTwoFromResponse(data);
  const dateTh = data?.response?.date || "";
  const endpoint = data?.response?.endpoint || "";
  // rayriffy ไม่มี id โดยตรงจาก latest ให้ “หา id” จาก /list/1 ที่เป็นงวดล่าสุด
  const id = await findLatestIdFromList();
  return { id, dateTh, last2, endpoint, source: url };
}

async function findLatestIdFromList() {
  const list = await httpGetJson(`${API_BASE}/list/1`);
  // response เป็น array ของงวดล่าสุดก่อน
  const first = (list?.response || [])[0];
  return first?.id || "";
}

async function fetchById(id) {
  const url = `${API_BASE}/lotto/${id}`;
  const data = await httpGetJson(url);
  const last2 = extractLastTwoFromResponse(data);
  const dateTh = data?.response?.date || "";
  const endpoint = data?.response?.endpoint || "";
  return { id, dateTh, last2, endpoint, source: url };
}

async function fetchListPage(page = 1) {
  const url = `${API_BASE}/list/${page}`;
  const data = await httpGetJson(url);
  return (data?.response || []).map((x) => x.id).filter(Boolean);
}

function upsert(history, entry) {
  if (!entry?.id) return { history, changed: false };
  const idx = history.findIndex((e) => e.id === entry.id);
  const now = new Date().toISOString();
  const normalized = {
    id: entry.id,
    dateTh: entry.dateTh || "",
    last2: entry.last2,               // อาจเป็น null ถ้านงวดนั้นยังไม่ออกครบ
    endpoint: entry.endpoint || "",
    fetchedAt: now,
    source: entry.source || ""
  };
  if (idx >= 0) {
    // อัปเดตเฉพาะ field ที่สำคัญ (เช่น last2 ที่เดิมอาจเป็น null)
    history[idx] = { ...history[idx], ...normalized };
  } else {
    history.push(normalized);
  }
  return { history, changed: true };
}

async function runLatest() {
  const history = loadHistory();
  const latest = await fetchLatest();
  const { history: updated, changed } = upsert(history, latest);
  if (changed) {
    saveHistory(updated);
    console.log(`✅ Saved latest draw: id=${latest.id}, date="${latest.dateTh}", last2=${latest.last2}`);
  } else {
    console.log("ℹ️ No change (latest already recorded).");
  }
}

async function runBackfill(pages = 1) {
  const history = loadHistory();
  let totalChanged = 0;

  for (let p = 1; p <= pages; p++) {
    console.log(`↻ Fetching list page ${p} ...`);
    const ids = await fetchListPage(p);
    for (const id of ids) {
      try {
        const row = await fetchById(id);
        const { history: updated, changed } = upsert(history, row);
        if (changed) totalChanged++;
        history.splice(0, history.length, ...updated); // keep reference
        // บันทึกเป็นระยะ กันข้อมูลหายกลางคัน
        if (changed) saveHistory(history);
        console.log(`  • id=${id} date="${row.dateTh}" last2=${row.last2 ?? "null"}`);
      } catch (err) {
        console.error(`  ! error id=${id}: ${err.message}`);
      }
    }
  }

  console.log(`✅ Backfill done. New/updated entries: ${totalChanged}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = { latest: false, backfill: 0 };
  for (const a of args) {
    if (a === "--latest") cfg.latest = true;
    else if (a.startsWith("--backfill=")) cfg.backfill = Math.max(0, parseInt(a.split("=")[1] || "0", 10));
  }
  return cfg;
}

(async () => {
  try {
    const { latest, backfill } = parseArgs();
    if (backfill > 0) {
      await runBackfill(backfill);
    } else if (latest) {
      await runLatest();
    } else {
      console.log("Usage:");
      console.log("  node fetch-lotto.js --latest        # บันทึกงวดล่าสุด (เลขท้าย 2 ตัว)");
      console.log("  node fetch-lotto.js --backfill=3    # เก็บย้อนหลังจาก list 3 หน้า");
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
})();
