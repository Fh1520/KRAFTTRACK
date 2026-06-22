import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set } from "firebase/database";

// ─── FIREBASE ─────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyB1e1tmoYE0aR9u9E6J-31dn7LF0HinGd4",
  authDomain: "krafttrack-b2e7d.firebaseapp.com",
  databaseURL: "https://krafttrack-b2e7d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "krafttrack-b2e7d",
  storageBucket: "krafttrack-b2e7d.firebasestorage.app",
  messagingSenderId: "664486585897",
  appId: "1:664486585897:web:7b60fa5631ea83c3e99e38"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const DATA_REF = "krafttrack_data_v1";

async function cloudSave(data) {
  try {
    await set(ref(db, DATA_REF), data);
  } catch (e) {
    console.error("Firebase save error:", e);
  }
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const GRADES = [
  { bf: "18", gsm: "150", shade: "golden", label: "18 BF 150 GSM Golden" },
  { bf: "22", gsm: "180", shade: "golden", label: "22 BF 180 GSM Golden" },
];
const SHADE_OPTIONS = ["golden", "natural"];
const SIZE_OPTIONS = Array.from({ length: 38 }, (_, i) => String(19 + i)); // 19–56

// Liner-specific grade options (broader BF/GSM range)
const LINER_BF_OPTIONS = ["14", "16", "18", "20", "22", "24", "26", "28", "30", "32"];
const LINER_GSM_OPTIONS = ["80", "90", "100", "110", "120", "130", "140", "150", "160", "170", "180", "190", "200", "210", "220"];

const PRIORITY_GRADES = [{ bf: "18", gsm: "150" }, { bf: "22", gsm: "180" }];
const isPriority = (bf, gsm) => PRIORITY_GRADES.some(p => p.bf === bf && p.gsm === gsm);

const INITIAL_STATE = { stock: [], grades: GRADES, customers: [], customerData: {}, linerCustomers: [], transporters: [], gumVariants: [{ id: "gum_a", name: "Variant A", color: "#e8a020" }, { id: "gum_b", name: "Variant B", color: "#6a8a3a" }], gumStock: [], payments: [], cancelledChallans: [] };

// ─── PAYMENT HELPERS ──────────────────────────────────────────────────────────
const CREDIT_PRESETS = [7, 15, 30, 45, 60, 90];
function addDays(dateStr, days) { if (!dateStr || !days) return null; const d = new Date(dateStr); d.setDate(d.getDate() + Number(days)); return d.toISOString().slice(0,10); }
function daysDiff(dateStr) { if (!dateStr) return null; return Math.floor((new Date(dateStr) - new Date(today())) / 86400000); }
function daysDiff2(dateA, dateB) { if (!dateA || !dateB) return null; return Math.floor((new Date(dateA) - new Date(dateB)) / 86400000); }
function makeChallanKey(ch) { return ch.challanNo || `__${ch.date}__${ch.customer}`; }
function buildPaymentEntry(ch, creditDays) { return { id: genId(), challanNo: ch.challanNo||null, challanKey: makeChallanKey(ch), customer: ch.customer||"", challanDate: ch.date, amount: challanGrandTotal(ch), creditDays: creditDays||null, dueDate: creditDays ? addDays(ch.date, creditDays) : null, paid: false, paidDate: null, partialAmount: null, note: "" }; }
function getPaymentStatus(p) {
  if (!p) return "untracked";
  if (p.paid) return "paid";
  if (!p.dueDate) return "untracked";
  const diff = daysDiff(p.dueDate);
  if (diff < 0) return "overdue";
  if (diff <= 7) return "due-soon";
  return "upcoming";
}
function paymentStatusBadge(status, dueDate) {
  if (status === "paid") return { label: "✓ Paid", bg: "#edf7f0", border: "#b5dcc0", color: "#2d6a4f" };
  if (status === "overdue") { const d = Math.abs(daysDiff(dueDate)); return { label: `Overdue ${d}d`, bg: "#fef0ee", border: "#f0c0ba", color: "#b83020" }; }
  if (status === "due-soon") { const d = daysDiff(dueDate); return { label: d === 0 ? "Due today" : `Due in ${d}d`, bg: "#fef5e8", border: "#f0d5a0", color: "#a05800" }; }
  if (status === "upcoming") { const d = daysDiff(dueDate); return { label: `Due in ${d}d`, bg: "#f4f8ff", border: "#c8b89a", color: "#2d2d2d" }; }
  return { label: "Not tracked", bg: "#f5f0e8", border: "#e5dece", color: "#9a9080" };
}


// GUM helpers
const DEFAULT_GUM_SACK_WEIGHT = 25; // kg
function fmtRs(n) { return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }
function fmtRate(n) { if (!n && n !== 0) return ""; const v = Number(n); return "₹" + (Number.isInteger(v) ? v.toString() : v.toFixed(2)); }
// Landed cost = paper cost + transport + warai per kg
function landedRate(r) { return (Number(r.costRate)||0) + (Number(r.transportRate)||0) + (Number(r.waraiRate)||0); }
function landedCostAmt(r) { return landedRate(r) * Number(r.weight||r.sackWeight||0); }
function reelLandedProfit(r) { return ((Number(r.soldRate)||0) - landedRate(r)) * Number(r.weight); }
function gumLandedProfit(g) { return ((Number(g.soldRate)||0) - landedRate(g)) * Number(g.sackWeight||DEFAULT_GUM_SACK_WEIGHT); }
function getCurrentRate(customerData, customer, bf, gsm) {
  const hist = customerData?.[customer]?.rateHistory?.[`${bf}|${gsm}`];
  if (!hist || hist.length === 0) return "";
  return hist[hist.length - 1].rate;
}
function computeWeightedCostRate(slabs, totalKg) {
  if (!slabs || slabs.length === 0) return 0;
  if (slabs.length === 1) return Number(slabs[0].rate) || 0;
  let totalCost = 0, usedKg = 0;
  slabs.forEach(s => { const kg = Number(s.kg) || 0; totalCost += kg * (Number(s.rate) || 0); usedKg += kg; });
  if (usedKg === 0) return Number(slabs[0].rate) || 0;
  const remKg = totalKg - usedKg;
  if (remKg > 0) totalCost += remKg * (Number(slabs[slabs.length - 1].rate) || 0);
  return totalKg > 0 ? totalCost / totalKg : 0;
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function fmt(n) { return Number(n).toLocaleString("en-IN"); }
function fmtDate(d) { if (!d) return "—"; return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
function today() { return new Date().toISOString().slice(0, 10); }
function monthKey(d) { return d ? d.slice(0, 7) : ""; }
function monthLabel(k) { if (!k) return ""; const [y, m] = k.split("-"); return new Date(y, m - 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" }); }

// ─── GST HELPERS ──────────────────────────────────────────────────────────────
// GST rates: reels/liner = 18% (CGST 9% + SGST 9%), gum = 5% (CGST 2.5% + SGST 2.5%)
function gstRate(isGum) { return isGum ? 0.05 : 0.18; }
function cgstRate(isGum) { return isGum ? 0.025 : 0.09; }
function sgstRate(isGum) { return isGum ? 0.025 : 0.09; }
// Challan totals — reels + transport = taxable, then GST on that
function challanItemTotal(ch) {
  const rv = (ch.reels||[]).reduce((s,r) => s + (Number(r.soldRate)||0)*Number(r.weight||0), 0);
  const gv = (ch.gumSacks||[]).reduce((s,g) => s + (Number(g.soldRate)||0)*Number(g.sackWeight||DEFAULT_GUM_SACK_WEIGHT), 0);
  return rv + gv;
}
function challanTransportCharge(ch) { return Number(ch.transportCharge) || 0; }
function challanTaxableAmount(ch) { return challanItemTotal(ch) + challanTransportCharge(ch); }
function challanGST(ch) {
  // Split by reels (18%) and gum (5%) — if mixed, each portion taxed at its rate
  const reelTotal = (ch.reels||[]).reduce((s,r) => s + (Number(r.soldRate)||0)*Number(r.weight), 0);
  const gumTotal = (ch.gumSacks||[]).reduce((s,g) => s + (Number(g.soldRate)||0)*Number(g.sackWeight||DEFAULT_GUM_SACK_WEIGHT), 0);
  const transport = challanTransportCharge(ch);
  // Transport GST follows reel rate (18%) if reels present, gum rate if gum only
  const transportGst = reelTotal > 0 ? transport * 0.18 : transport * 0.05;
  const reelGst = reelTotal * 0.18;
  const gumGst = gumTotal * 0.05;
  const totalGst = reelGst + gumGst + transportGst;
  return { reelGst, gumGst, transportGst, totalGst, cgst: totalGst/2, sgst: totalGst/2 };
}
function challanGrandTotal(ch) { return Math.round(challanTaxableAmount(ch) + challanGST(ch).totalGst); }
// Updated challanValue — now returns ex-GST total (item + transport) for payment tracking
function challanValue(ch) { return challanItemTotal(ch) + challanTransportCharge(ch); }
// With-GST value
function challanValueWithGST(ch) { return challanGrandTotal(ch); }

const TABS = ["Home", "Stock", "Sell", "History", "Reports", "Settings"];
const EMPLOYEE_TABS = ["Home", "Stock"];
const IS_EMPLOYEE_VIEW = new URLSearchParams(window.location.search).get("view") === "stock";

// ─── CHART HELPERS ────────────────────────────────────────────────────────────
const CHART_COLORS = ["#2d2d2d", "#8b6914", "#5a8a5a", "#5a6a8a", "#8a4a4a", "#6a5a8a", "#8a7a3a", "#3a7a8a"];

function PieChart({ data, size = 160 }) {
  if (!data?.length) return null;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  let cumAngle = -Math.PI / 2;
  const cx = size / 2, cy = size / 2, r = size / 2 - 8;
  const slices = data.map((d, i) => {
    const angle = (d.value / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(cumAngle);
    const y1 = cy + r * Math.sin(cumAngle);
    cumAngle += angle;
    const x2 = cx + r * Math.cos(cumAngle);
    const y2 = cy + r * Math.sin(cumAngle);
    const large = angle > Math.PI ? 1 : 0;
    return { path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`, color: CHART_COLORS[i % CHART_COLORS.length], label: d.label, pct: ((d.value / total) * 100).toFixed(1) };
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth={1.5} />)}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: "#1a1a1a", fontWeight: 500 }}>{s.label}</span>
            <span style={{ color: "#9a9080" }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({ data, color = "#2d2d2d", unit = "", height = 120 }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: height + 32, paddingTop: 4 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1, minWidth: 32 }}>
          <div style={{ fontSize: 10, color: "#9a9080", fontWeight: 500 }}>{d.value > 0 ? (unit === "t" ? (d.value / 1000).toFixed(1) + "t" : fmt(d.value)) : ""}</div>
          <div style={{ width: "100%", background: i === data.length - 1 ? color : "#e2dbd0", borderRadius: "3px 3px 0 0", height: Math.max((d.value / max) * height, d.value > 0 ? 4 : 0), transition: "height 0.4s ease", minHeight: d.value > 0 ? 4 : 0 }} />
          <div style={{ fontSize: 10, color: "#9a9080", textAlign: "center", lineHeight: 1.2 }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── CUSTOMER AUTOCOMPLETE ────────────────────────────────────────────────────
function CustomerInput({ value, onChange, customers, placeholder = "Buyer / Corrugater name" }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  const normalizedList = [...new Set((customers || []).map(c => c.trim()))].filter(Boolean).sort();
  const trimmedValue = value.trim().toLowerCase();
  const matches = trimmedValue.length >= 1
    ? normalizedList.filter(c => c.toLowerCase().includes(trimmedValue) && c.toLowerCase() !== trimmedValue)
    : [];

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setShow(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setShow(true); }}
        onFocus={() => setShow(true)}
        placeholder={placeholder}
      />
      {show && matches.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #ddd8ce", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.10)", zIndex: 300, maxHeight: 180, overflowY: "auto", marginTop: 3 }}>
          {matches.map(c => (
            <div key={c} onMouseDown={() => { onChange(c.trim()); setShow(false); }}
              style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #e8eef8" }}
              onMouseEnter={e => e.currentTarget.style.background = "#faf8f4"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TRANSPORTER AUTOCOMPLETE ─────────────────────────────────────────────────
function TransporterInput({ value, onChange, transporters, placeholder = "Transporter / Tempo name" }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  // Normalize stored names (trim) to avoid duplicates from trailing spaces
  const normalizedList = [...new Set((transporters || []).map(c => c.trim()))].filter(Boolean).sort();
  const trimmedValue = value.trim().toLowerCase();
  const matches = trimmedValue.length >= 1
    ? normalizedList.filter(c => c.toLowerCase().includes(trimmedValue) && c.toLowerCase() !== trimmedValue)
    : normalizedList.filter(c => c.toLowerCase() !== trimmedValue);
  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setShow(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input value={value} onChange={e => { onChange(e.target.value); setShow(true); }} onFocus={() => setShow(true)} placeholder={placeholder} />
      {show && matches.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #ddd8ce", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.10)", zIndex: 300, maxHeight: 160, overflowY: "auto", marginTop: 3 }}>
          {matches.map(c => (
            <div key={c} onMouseDown={() => { onChange(c.trim()); setShow(false); }}
              style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #e8eef8" }}
              onMouseEnter={e => e.currentTarget.style.background = "#faf8f4"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              🚚 {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function KraftReelIcon({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
      <rect width="30" height="30" rx="7" fill="#1a1a1a"/>
      <ellipse cx="9" cy="15" rx="3" ry="8" fill="#7a4f1e"/>
      <ellipse cx="21" cy="15" rx="3" ry="8" fill="#7a4f1e"/>
      <rect x="9" y="7" width="12" height="16" fill="#9b6a2e"/>
      <rect x="9" y="8.5" width="12" height="1.5" fill="#5a8be0" opacity="0.7"/>
      <rect x="9" y="11" width="12" height="1.5" fill="#5a8be0" opacity="0.6"/>
      <rect x="9" y="13.5" width="12" height="1.5" fill="#5a8be0" opacity="0.7"/>
      <rect x="9" y="16" width="12" height="1.5" fill="#5a8be0" opacity="0.6"/>
      <rect x="9" y="18.5" width="12" height="1.5" fill="#5a8be0" opacity="0.7"/>
      <ellipse cx="9" cy="15" rx="1.4" ry="3.5" fill="#1a1a1a"/>
      <ellipse cx="21" cy="15" rx="1.4" ry="3.5" fill="#1a1a1a"/>
      <ellipse cx="20" cy="10" rx="1" ry="0.5" fill="#c49a45" opacity="0.5"/>
    </svg>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(INITIAL_STATE);
  const [tab, setTab] = useState("Home");
  const [stockNav, setStockNav] = useState(null);
  const [syncing, setSyncing] = useState(true);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const saveTimer = useRef(null);
  const hasPendingSave = useRef(false);
  const isRemoteUpdate = useRef(false);

  // ── Real-time listener — only apply remote updates when no local save is pending ──
  useEffect(() => {
    const dataRef = ref(db, DATA_REF);
    const unsub = onValue(dataRef, (snapshot) => {
      let data = snapshot.val();
      if (data && !hasPendingSave.current) {
        isRemoteUpdate.current = true;
        // One-time migration: strip quote chars from sizes stored as '36"' → '36'
        if (data.stock) {
          let needsFix = false;
          const fixed = data.stock.map(r => {
            if (r.size && String(r.size).includes('"')) {
              needsFix = true;
              return { ...r, size: String(r.size).replace(/"/g, '').trim() };
            }
            return r;
          });
          if (needsFix) {
            data = { ...data, stock: fixed };
            cloudSave(data);
          }
        }
        setState({ ...INITIAL_STATE, ...data, linerCustomers: data.linerCustomers || [], transporters: data.transporters || [], gumVariants: data.gumVariants || INITIAL_STATE.gumVariants, gumStock: data.gumStock || [], payments: data.payments || [], cancelledChallans: data.cancelledChallans || [] });
      }
      setSyncing(false);
    }, (error) => {
      console.error("Firebase read error:", error);
      setSyncing(false);
      setSaveError(true);
    });
    return () => unsub();
  }, []);

  const update = useCallback(fn => {
    setState(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      hasPendingSave.current = true;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        cloudSave(next)
          .then(() => {
            hasPendingSave.current = false;
            setLastSaved(new Date());
            setSaveError(false);
          })
          .catch(() => {
            hasPendingSave.current = false;
            setSaveError(true);
          });
      }, 300);
      return next;
    });
  }, []);

  const available = state.stock.filter(r => !r.sold && r.productType !== "liner" && !r.converted);
  const totalKg = available.reduce((s, r) => s + Number(r.weight), 0);

  const sizeCountMap = {};
  // Seed from priority-grade reel stock only for low/moderate alerts (exclude converted)
  state.stock.filter(r => r.productType !== "liner" && !r.converted && isPriority(r.bf, r.gsm)).forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}|${r.size}`;
    if (!sizeCountMap[k]) sizeCountMap[k] = { count: 0, bf: r.bf, gsm: r.gsm, shade: r.shade, size: r.size };
  });
  available.filter(r => isPriority(r.bf, r.gsm)).forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}|${r.size}`;
    if (sizeCountMap[k]) sizeCountMap[k].count++;
  });
  const lowItems = Object.values(sizeCountMap).filter(x => x.count <= 2).sort((a, b) => Number(a.size) - Number(b.size));
  const moderateItems = Object.values(sizeCountMap).filter(x => x.count === 3).sort((a, b) => Number(a.size) - Number(b.size));

  return (
    <div style={{ fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: "#f4f4f2", minHeight: "100vh", color: "#111" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@300;400;500;600;700;800&display=swap');
        :root{--accent:#b8860b;--accent-light:#fff8e7;--accent-border:#e8d48a;--bg:#f4f4f2;--surface:#fff;--border:rgba(0,0,0,0.08);--text:#111;--text-secondary:#666;--text-tertiary:#aaa;--success:#22c55e;--success-bg:#e8f5e9;--danger:#ef4444;--danger-bg:#fce4ec;--warn:#f97316;--warn-bg:#fff3e0;--shadow-sm:0 1px 3px rgba(0,0,0,0.06),0 2px 8px rgba(0,0,0,0.04);--shadow-md:0 4px 16px rgba(0,0,0,0.08);--radius:14px;--radius-sm:10px;--radius-xs:7px}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:var(--bg)}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#ebebeb}::-webkit-scrollbar-thumb{background:#ccc;border-radius:2px}
        input,select,textarea{background:#fff!important;border:1.5px solid rgba(0,0,0,0.12)!important;color:#111!important;padding:9px 12px;border-radius:var(--radius-xs);font-family:'Inter',sans-serif;font-size:13px;outline:none;width:100%;transition:border-color 0.15s,box-shadow 0.15s;resize:vertical}
        input:focus,select:focus,textarea:focus{border-color:var(--accent)!important;box-shadow:0 0 0 3px rgba(184,134,11,0.10)}
        select option{background:#fff;color:#111}
        input[type="checkbox"]{width:auto!important;accent-color:var(--accent);cursor:pointer}
        button{cursor:pointer;font-family:'Inter',sans-serif;transition:all 0.15s}
        .btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:var(--radius-xs);font-size:13px;font-weight:600;border:none;transition:all 0.15s;letter-spacing:-0.01em}
        .btn-dark{background:#111;color:#fff}.btn-dark:hover{background:#222;transform:translateY(-1px);box-shadow:var(--shadow-md)}.btn-dark:disabled{background:#bbb;cursor:not-allowed;transform:none;box-shadow:none}
        .btn-outline{background:transparent;color:#111;border:1.5px solid rgba(0,0,0,0.14)!important}.btn-outline:hover{border-color:var(--accent)!important;color:var(--accent)}
        .btn-sm{padding:6px 12px;font-size:12px}
        .card{background:var(--surface);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow-sm)}
        .card-flat{background:var(--surface);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-sm)}
        .tag{display:inline-block;background:#f5f5f5;border-radius:5px;padding:2px 8px;font-size:11px;color:#555;font-weight:500}
        .tag-green{background:#e8f5e9;color:#2e7d32}
        .tag-red{background:#fce4ec;color:#c62828}
        .tag-orange{background:#fff3e0;color:#e65100}
        .tag-blue{background:#f0f4ff;color:#3a5a9a}
        .lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.09em;margin-bottom:5px;display:block;font-weight:600}
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
        .g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px}
        .g5{display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:10px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th{color:#999;font-weight:600;text-align:left;padding:10px 16px;border-bottom:1px solid rgba(0,0,0,0.06);font-size:10px;text-transform:uppercase;letter-spacing:0.08em}
        td{padding:11px 16px;border-bottom:1px solid rgba(0,0,0,0.04)}
        tr:last-child td{border-bottom:none}
        tr:hover td{background:#fafafa}
        .sep{height:1px;background:rgba(0,0,0,0.06);margin:14px 0}
        h1{font-family:'Playfair Display',serif;font-size:30px;font-weight:500;letter-spacing:-0.02em;line-height:1.1;color:#111}
        h2{font-family:'Playfair Display',serif;font-size:22px;font-weight:500;letter-spacing:-0.01em;color:#111}
        h3{font-size:11px;font-weight:700;color:#888;margin-bottom:12px;letter-spacing:0.08em;text-transform:uppercase}
        .serif{font-family:'Playfair Display',serif}
        .serif-italic{font-family:'Playfair Display',serif;font-style:italic}
        .stat-num{font-size:38px;line-height:1;font-weight:800;color:#111;letter-spacing:-0.03em}
        .section-eyebrow{font-family:'Playfair Display',serif;font-size:13px;font-style:italic;font-weight:400;color:#999;margin-bottom:3px}
        .ok-box{background:#e8f5e9;border:1px solid #a5d6a7;border-radius:var(--radius-xs);padding:11px 14px;font-size:12px;color:#2e7d32;font-weight:500}
        .err-box{background:#fce4ec;border:1px solid #f48fb1;border-radius:var(--radius-xs);padding:11px 14px;font-size:12px;color:#c62828;font-weight:500}
        .warn-box{background:#fff3e0;border:1px solid #ffcc80;border-radius:var(--radius-xs);padding:11px 14px;font-size:12px;color:#e65100;font-weight:500}
        .low-alert{background:#fff3e0;border:1px solid #ffcc80;border-radius:var(--radius);padding:16px 18px}
        .moderate-alert{background:#f0f4ff;border:1px solid #c5cae9;border-radius:var(--radius);padding:16px 18px}
        .sync-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;margin-right:5px;animation:pulse 2s infinite}
        .sync-dot-err{width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;margin-right:5px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        .fade-in{animation:fadeIn 0.2s ease}
        @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px)}
        .modal{background:#fff;border-radius:18px;padding:24px;max-width:440px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.18)}
        /* ── GST breakup ── */
        .gst-section{background:#f9f9f9;border-radius:10px;padding:12px 14px;margin-bottom:8px}
        .gst-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px}
        .gst-label{color:#666}
        .gst-value{font-weight:600;color:#111}
        .gst-value.green{color:#22c55e}
        .gst-total-bar{background:#111;border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-top:8px}
        /* ── bottom nav mobile ── */
        .bottom-nav{display:none;background:#fff;border-top:1px solid rgba(0,0,0,0.06);position:fixed;bottom:0;left:0;right:0;z-index:150;padding:6px 0 10px;box-shadow:0 -4px 20px rgba(0,0,0,0.06)}
        .bottom-nav-inner{display:flex;justify-content:space-around;max-width:500px;margin:0 auto}
        .bn-item{display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 2px;cursor:pointer;border:none;background:transparent;flex:1;min-width:0}
        .bn-icon{font-size:22px;line-height:1}
        .bn-lbl{font-size:9px;font-weight:500;color:#aaa;letter-spacing:0.02em;white-space:nowrap}
        .bn-item.active .bn-lbl{color:#111;font-weight:700}
        .bn-dot{width:4px;height:4px;border-radius:50%;background:#111;margin:1px auto 0}
        /* ── transport toggle ── */
        .transport-toggle{display:flex;gap:5px}
        .tt-option{flex:1;border-radius:var(--radius-xs);padding:8px 4px;text-align:center;border:1.5px solid rgba(0,0,0,0.10);background:#fff;cursor:pointer;transition:all 0.15s}
        .tt-option.active{background:#111;border-color:#111}
        .tt-label{font-size:9px;font-weight:700;color:#aaa;margin-top:2px}
        .tt-option.active .tt-label{color:#fff}
        .tt-icon{font-size:15px}
        @media(max-width:640px){
          .g2,.g3,.g4,.g5{grid-template-columns:1fr 1fr}
          .brand-text{display:none!important}
          .brand-divider{display:none!important}
          .brand-mobile{display:flex!important}
          .nav-sync-text{display:none!important}
          .nav-inner{padding:0 8px!important}
          h1{font-size:24px!important}
          h2{font-size:19px!important}
          .card{padding:14px!important}
          .stat-num{font-size:30px!important}
          .bottom-nav{display:block}
          .main-content{padding-bottom:72px!important}
        }
        @media(max-width:400px){.g2,.g3,.g4,.g5{grid-template-columns:1fr}}
        /* ── hide top tabs on mobile, show bottom nav ── */
        @media(max-width:640px){
          .desktop-tabs{display:none!important}
          .bottom-nav{display:block}
          .main-content{padding-bottom:80px!important}
        }
        @media(min-width:641px){
          .bottom-nav{display:none!important}
          .desktop-tabs{display:flex!important}
        }
      `}</style>

      {/* Nav */}
      <nav style={{ background: "#fff", borderBottom: "1px solid #e8e2d8", position: "sticky", top: 0, zIndex: 200 }}>
        <div className="nav-inner" style={{ maxWidth: 980, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center" }}>
          {/* Brand — desktop */}
          <div className="brand-divider" style={{ padding: "11px 0", marginRight: 20, paddingRight: 20, borderRight: "1px solid #e8e2d8", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <KraftReelIcon size={30} />
              <div className="brand-text">
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em", color: "#1a1a1a" }}>SK Traders</span>
                  <span style={{ fontSize: 10, color: "#b0a898", fontWeight: 400, letterSpacing: "0.06em", textTransform: "uppercase" }}>KraftTrack</span>
                </div>
              </div>
            </div>
          </div>
          {/* Brand — mobile: icon + SK Traders text */}
          <div className="brand-mobile" style={{ display: "flex", alignItems: "center", gap: 7, paddingRight: 10, marginRight: 4, flexShrink: 0 }}>
            <KraftReelIcon size={26} />
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 13, fontWeight: 500, color: "#1a1a1a", whiteSpace: "nowrap" }}>SK Traders</span>
          </div>
          <div style={{ display: "flex", overflowX: "auto", flex: 1, scrollbarWidth: "none" }} className="desktop-tabs">
            {(IS_EMPLOYEE_VIEW ? EMPLOYEE_TABS : TABS).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === t ? "#b8860b" : "transparent"}`, padding: "13px 11px", fontSize: 12, fontWeight: tab === t ? 700 : 400, color: tab === t ? "#111" : "#aaa", whiteSpace: "nowrap", transition: "all 0.15s", letterSpacing: "0.01em" }}>{t}</button>
            ))}
            {IS_EMPLOYEE_VIEW && <span style={{ fontSize: 9, color: "#aaa", padding: "0 8px", alignSelf: "center", border: "1px solid #e0e0e0", borderRadius: 4, marginLeft: 4 }}>Stock View</span>}
          </div>
          <div className="nav-sync-text" style={{ fontSize: 10, color: saveError ? "#b83020" : "#b0a898", paddingLeft: 14, whiteSpace: "nowrap", display: "flex", alignItems: "center", flexShrink: 0 }}>
            {syncing
              ? <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#b0a898", display: "inline-block", marginRight: 5 }} />Syncing…</>
              : saveError
                ? <><span className="sync-dot-err" />Offline</>
                : <><span className="sync-dot" />{lastSaved ? "Saved" : "Live"}</>
            }
          </div>
          {/* Mobile sync dot only */}
          <div style={{ flexShrink: 0, paddingLeft: 6 }}>
            {syncing
              ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#b0a898", display: "inline-block" }} />
              : saveError
                ? <span className="sync-dot-err" />
                : <span className="sync-dot" />
            }
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "20px 14px" }} className="fade-in main-content">
        {tab === "Home"     && <HomeTab     state={state} setTab={setTab} setStockNav={setStockNav} lowItems={lowItems} moderateItems={moderateItems} totalKg={totalKg} available={available} isEmployee={IS_EMPLOYEE_VIEW} />}
        {tab === "Stock"    && <StockTab    state={state} update={update} stockNav={stockNav} clearStockNav={() => setStockNav(null)} isEmployee={IS_EMPLOYEE_VIEW} />}
        {!IS_EMPLOYEE_VIEW && tab === "Sell"     && <SellTab     state={state} update={update} />}
        {!IS_EMPLOYEE_VIEW && tab === "History"  && <HistoryTab  state={state} update={update} />}
        {!IS_EMPLOYEE_VIEW && tab === "Reports"  && <ReportsTab  state={state} />}
        {!IS_EMPLOYEE_VIEW && tab === "Settings" && <SettingsTab state={state} update={update} />}
      </div>
      {/* Mobile bottom nav */}
      {!IS_EMPLOYEE_VIEW && (
        <nav className="bottom-nav">
          <div className="bottom-nav-inner">
            {[
              ["Home","🏠"],
              ["Stock","📦"],
              ["Sell","🏷️"],
              ["History","📋"],
              ["Reports","📊"],
              ["Settings","⚙️"]
            ].map(([t, icon]) => (
              <button key={t} className={`bn-item${tab===t?" active":""}`} onClick={() => setTab(t)}>
                <span className="bn-icon">{icon}</span>
                <span className="bn-lbl">{t}</span>
                {tab===t && <span className="bn-dot"/>}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function HomeTab({ state, setTab, setStockNav, lowItems, moderateItems, totalKg, available, isEmployee }) {
  const sold = state.stock.filter(r => r.sold && r.productType !== "liner");
  const bySpec = {};
  // Only show priority grades on home screen, exclude converted-to-liner reels
  state.stock.filter(r => r.productType !== "liner" && !r.converted && isPriority(r.bf, r.gsm)).forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}`;
    if (!bySpec[k]) bySpec[k] = { bf: r.bf, gsm: r.gsm, shade: r.shade, reels: 0, kg: 0, sizes: {} };
    if (bySpec[k].sizes[r.size] === undefined) bySpec[k].sizes[r.size] = 0;
  });
  available.filter(r => isPriority(r.bf, r.gsm)).forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}`;
    if (bySpec[k]) { bySpec[k].reels++; bySpec[k].kg += Number(r.weight); bySpec[k].sizes[r.size]++; }
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="section-eyebrow">Overview</div>
          <h1>Stock Dashboard</h1>
        </div>
        <div style={{ fontSize: 11, color: "#aaa" }}>{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      </div>

      <div className="g2">
        <div className="card" style={{ padding: "20px 22px" }}>
          <div className="lbl">Available Reels</div>
          <div className="stat-num">{available.length}</div>
          <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>reels in stock</div>
        </div>
        <div className="card" style={{ padding: "20px 22px" }}>
          <div className="lbl">Total Weight</div>
          <div className="stat-num">{fmt(Math.round(totalKg))} <span style={{ fontSize: 16, fontWeight: 500, color: "#aaa" }}>kg</span></div>
          <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>{(totalKg / 1000).toFixed(2)} metric tons</div>
        </div>
      </div>

      {lowItems.length > 0 && (
        <div className="low-alert">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 15 }}>⚠️</span>
            <span className="serif" style={{ fontSize: 18 }}>Critical Low Stock</span>
            <span className="tag tag-orange" style={{ marginLeft: 4 }}>{lowItems.length} size{lowItems.length > 1 ? "s" : ""} — 2 or fewer left</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {lowItems.map(item => (
              <div key={`${item.size}${item.bf}${item.gsm}`} style={{ background: "#fff", border: "1px solid #f0d5a0", borderRadius: 10, padding: "10px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div>
                  <div className="serif" style={{ fontSize: 26, lineHeight: 1, color: "#a05800" }}>{item.size}"</div>
                  <div style={{ fontSize: 10, color: "#b0a898", marginTop: 3 }}>{item.bf} BF · {item.gsm} GSM</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div className="serif" style={{ fontSize: 30, lineHeight: 1, color: item.count === 0 ? "#b83020" : "#a05800" }}>{item.count}</div>
                  <div style={{ fontSize: 10, color: "#b0a898" }}>left</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {moderateItems.length > 0 && (
        <div className="moderate-alert">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>📦</span>
            <span className="serif" style={{ fontSize: 16 }}>Moderate Stock Notice</span>
            <span className="tag tag-blue" style={{ marginLeft: 4 }}>{moderateItems.length} size{moderateItems.length > 1 ? "s" : ""} — 3 reels remaining</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {moderateItems.map(item => (
              <div key={`${item.size}${item.bf}${item.gsm}`} style={{ background: "#fff", border: "1px solid #c8b89a", borderRadius: 8, padding: "8px 14px" }}>
                <div className="serif" style={{ fontSize: 20, color: "#2d2d2d" }}>{item.size}"</div>
                <div style={{ fontSize: 10, color: "#8a8070" }}>{item.bf} BF · {item.gsm} GSM</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.values(bySpec).map(spec => (
        <div key={`${spec.bf}${spec.gsm}${spec.shade}`} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="serif" style={{ fontSize: 17, fontWeight: 500 }}>{spec.bf} BF · {spec.gsm} GSM</span>
              <span className="tag" style={{ textTransform: "capitalize" }}>{spec.shade}</span>
            </div>
            <div style={{ fontSize: 12, color: "#9a9080" }}>{spec.reels} reels · {fmt(spec.kg)} kg</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(spec.sizes).sort((a, b) => Number(a[0]) - Number(b[0])).map(([sz, cnt]) => (
              <div key={sz}
                onClick={() => { setTab("Stock"); setStockNav({ size: sz }); }}
                style={{ background: cnt === 0 ? "#fef0ee" : cnt <= 2 ? "#fef9ee" : cnt === 3 ? "#f4f8ff" : "#f4f7fb", border: `1px solid ${cnt === 0 ? "#f0c0ba" : cnt <= 2 ? "#f0d5a0" : cnt === 3 ? "#c8b89a" : "#e8e2d8"}`, borderRadius: 10, padding: "9px 14px", textAlign: "center", minWidth: 68, cursor: "pointer", transition: "transform 0.1s, box-shadow 0.1s" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.10)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}>
                <div className="serif" style={{ fontSize: 20, lineHeight: 1, color: cnt === 0 ? "#b83020" : cnt <= 2 ? "#a05800" : cnt === 3 ? "#2d2d2d" : "#1a1a1a" }}>{sz}"</div>
                <div style={{ fontSize: 10, color: cnt === 0 ? "#c07060" : "#9a9080", marginTop: 4 }}>{cnt === 0 ? "out of stock" : `${cnt} reel${cnt !== 1 ? "s" : ""}`}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {state.stock.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 52 }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>📦</div>
          <div className="serif-italic" style={{ fontSize: 22, color: "#9a9080" }}>No stock yet.</div>
          <div style={{ fontSize: 13, color: "#b0a898", marginTop: 6 }}>Go to Stock → Add Inward to get started.</div>
        </div>
      )}

      {/* ── LINER SUMMARY SECTION ── */}
      {(() => {
        const availLiners = state.stock.filter(r => !r.sold && r.productType === "liner");
        if (availLiners.length === 0) return null;
        const linerBySpec = {};
        availLiners.forEach(r => {
          const k = `${r.bf}|${r.gsm}|${r.size}`;
          if (!linerBySpec[k]) linerBySpec[k] = { bf: r.bf, gsm: r.gsm, size: r.size, count: 0, kg: 0 };
          linerBySpec[k].count++;
          linerBySpec[k].kg += Number(r.weight);
        });
        const totalLinerKg = availLiners.reduce((s, r) => s + Number(r.weight), 0);
        const byGrade = {};
        Object.values(linerBySpec).forEach(x => {
          const gk = `${x.bf}|${x.gsm}`;
          if (!byGrade[gk]) byGrade[gk] = { bf: x.bf, gsm: x.gsm, sizes: [], totalKg: 0, totalCount: 0 };
          byGrade[gk].sizes.push(x);
          byGrade[gk].totalKg += x.kg;
          byGrade[gk].totalCount += x.count;
        });
        return (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
              <div style={{ flex: 1, height: 1, background: "#e8e2d8" }} />
              <span className="serif-italic" style={{ fontSize: 14, color: "#9a9080" }}>Liner Stock</span>
              <div style={{ flex: 1, height: 1, background: "#e8e2d8" }} />
            </div>
            <div className="g3">
              {[
                { label: "Available Liners", val: availLiners.length, unit: "in stock" },
                { label: "Liner Weight", val: (totalLinerKg / 1000).toFixed(2), unit: "metric tons" },
                { label: "Liner Grades", val: Object.keys(byGrade).length, unit: "specs in stock" },
              ].map(s => (
                <div key={s.label} className="card" style={{ padding: "18px 20px" }}>
                  <div className="lbl">{s.label}</div>
                  <div className="stat-num" style={{ fontSize: 32 }}>{s.val}</div>
                  <div className="serif-italic" style={{ fontSize: 12, color: "#b0a898", marginTop: 4 }}>{s.unit}</div>
                </div>
              ))}
            </div>
            {Object.values(byGrade).sort((a, b) => `${a.bf}${a.gsm}`.localeCompare(`${b.bf}${b.gsm}`)).map(grp => (
              <div key={`${grp.bf}${grp.gsm}`} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="serif" style={{ fontSize: 16, fontWeight: 500 }}>{grp.bf} BF · {grp.gsm} GSM</span>
                    <span className="tag" style={{ background: "#edf7f0", borderColor: "#b5dcc0", color: "#2d6a4f" }}>Liner</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#9a9080" }}>{grp.totalCount} liner{grp.totalCount !== 1 ? "s" : ""} · {fmt(Math.round(grp.totalKg))} kg</div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {grp.sizes.sort((a, b) => Number(a.size) - Number(b.size)).map(x => (
                    <div key={x.size} onClick={() => { setTab("Stock"); setStockNav({ linerTab: true }); }}
                      style={{ background: "#f0f8f4", border: "1px solid #b5dcc0", borderRadius: 10, padding: "9px 14px", textAlign: "center", minWidth: 68, cursor: "pointer", transition: "transform 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                      <div className="serif" style={{ fontSize: 20, lineHeight: 1, color: "#2d6a4f" }}>{x.size}"</div>
                      <div style={{ fontSize: 10, color: "#9a9080", marginTop: 4 }}>{x.count} liner{x.count !== 1 ? "s" : ""}</div>
                      <div style={{ fontSize: 9, color: "#6a9080", marginTop: 1 }}>{fmt(Math.round(x.kg))} kg</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        );
      })()}

      {/* ── GUM SUMMARY SECTION ── */}
      {(() => {
        const availGum = (state.gumStock || []).filter(g => !g.sold);
        const soldGum = (state.gumStock || []).filter(g => g.sold);
        if ((state.gumStock || []).length === 0) return null;
        const totalAvailKg = availGum.reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
        const byVariant = {};
        (state.gumVariants || []).forEach(v => { byVariant[v.id] = { ...v, sacks: 0, kg: 0 }; });
        availGum.forEach(g => {
          if (!byVariant[g.variantId]) byVariant[g.variantId] = { id: g.variantId, name: g.variantName || g.variantId, color: "#8a8070", sacks: 0, kg: 0 };
          byVariant[g.variantId].sacks++;
          byVariant[g.variantId].kg += Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT);
        });
        const variantList = Object.values(byVariant).filter(v => v.sacks > 0);
        return (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
              <div style={{ flex: 1, height: 1, background: "#e8e2d8" }} />
              <span className="serif-italic" style={{ fontSize: 14, color: "#9a9080" }}>Pasting Gum</span>
              <div style={{ flex: 1, height: 1, background: "#e8e2d8" }} />
            </div>
            <div className="g3">
              {[
                { label: "Available Sacks", val: availGum.length, unit: "in stock" },
                { label: "Sacks Sold", val: soldGum.length, unit: "dispatched" },
                { label: "Available Weight", val: (totalAvailKg / 1000).toFixed(2), unit: "metric tons" },
              ].map(s => (
                <div key={s.label} className="card" style={{ padding: "18px 20px" }}>
                  <div className="lbl">{s.label}</div>
                  <div className="stat-num" style={{ fontSize: 32 }}>{s.val}</div>
                  <div className="serif-italic" style={{ fontSize: 12, color: "#b0a898", marginTop: 4 }}>{s.unit}</div>
                </div>
              ))}
            </div>
            {variantList.length > 0 && (
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span className="serif" style={{ fontSize: 16, fontWeight: 500 }}>🪣 By Variant</span>
                  <span style={{ fontSize: 12, color: "#9a9080" }}>{availGum.length} sack{availGum.length !== 1 ? "s" : ""} · {fmt(Math.round(totalAvailKg))} kg available</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {variantList.map(v => (
                    <div key={v.id} style={{ background: "#fef9f0", border: "1px solid #f0d5a0", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: v.color || "#8b6914", flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{v.name}</div>
                        <div style={{ fontSize: 11, color: "#9a9080", marginTop: 1 }}>{v.sacks} sack{v.sacks !== 1 ? "s" : ""} · {fmt(Math.round(v.kg))} kg</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ─── EDITABLE CURRENT STOCK FOR A SIZE ───────────────────────────────────────
function EditableStockForSize({ sz, availForSize, update }) {
  const [editingId, setEditingId] = useState(null);
  const [editWeight, setEditWeight] = useState("");
  const [editSize, setEditSize] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const startEdit = (r) => { setEditingId(r.id); setEditWeight(String(r.weight)); setEditSize(r.size); };
  const saveEdit = (r) => {
    if (!editWeight || isNaN(editWeight)) return;
    update(s => { const idx = s.stock.findIndex(x => x.id === r.id); if (idx !== -1) { s.stock[idx].weight = editWeight; s.stock[idx].size = editSize; } });
    setEditingId(null);
  };
  const deleteReel = (id) => {
    update(s => { s.stock = s.stock.filter(x => x.id !== id); });
    setConfirmDelete(null);
  };

  const sorted = [...availForSize].sort((a, b) => new Date(a.inwardDate) - new Date(b.inwardDate));

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ marginBottom: 0 }}>Current Stock — {availForSize.length} reels available</h3>
      </div>
      {availForSize.length === 0 ? (
        <div style={{ fontSize: 13, color: "#b0a898", fontStyle: "italic" }}>No stock currently available for this size.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {sorted.map((r) => (
            <div key={r.id} style={{ background: "#f8f7f4", border: `1.5px solid ${editingId === r.id ? "#8b6914" : "#e8e2d8"}`, borderRadius: 10, padding: "10px 12px", textAlign: "center", minWidth: 90, position: "relative" }}>
              {editingId === r.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                  <input type="number" value={editWeight} onChange={e => setEditWeight(e.target.value)}
                    style={{ width: 80, padding: "4px 8px", fontSize: 13, textAlign: "center" }}
                    onKeyDown={e => { if (e.key === "Enter") saveEdit(r); if (e.key === "Escape") setEditingId(null); }}
                    autoFocus />
                  <select value={editSize} onChange={e => setEditSize(e.target.value)} style={{ width: 80, padding: "4px 6px", fontSize: 11 }}>
                    {SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}"</option>)}
                  </select>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => saveEdit(r)} style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 5, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>✓</button>
                    <button onClick={() => setEditingId(null)} style={{ background: "transparent", color: "#9a9080", border: "1px solid #ddd", borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>✕</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="serif" style={{ fontSize: 20, lineHeight: 1 }}>{fmt(r.weight)}</div>
                  <div style={{ fontSize: 10, color: "#9a9080", marginTop: 2 }}>kg</div>
                  <div style={{ fontSize: 9, color: "#b0a898", marginTop: 2 }}>{fmtDate(r.inwardDate)}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6, justifyContent: "center" }}>
                    <button onClick={() => startEdit(r)} style={{ background: "transparent", color: "#8b6914", border: "1px solid #e5dece", borderRadius: 4, padding: "2px 7px", fontSize: 10, cursor: "pointer" }}>Edit</button>
                    <button onClick={() => setConfirmDelete(r.id)} style={{ background: "transparent", color: "#b83020", border: "1px solid #f0c0ba", borderRadius: 4, padding: "2px 7px", fontSize: 10, cursor: "pointer" }}>Del</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {availForSize.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#9a9080" }}>
          Total: <strong style={{ color: "#1a1a1a" }}>{fmt(availForSize.reduce((s, r) => s + Number(r.weight), 0))} kg</strong>
        </div>
      )}
      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="modal-bg" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 320 }}>
            <div className="serif" style={{ fontSize: 20, marginBottom: 10 }}>Delete this reel?</div>
            <p style={{ fontSize: 13, color: "#8a8070", marginBottom: 20 }}>This reel will be permanently removed from stock. Cannot be undone.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1, justifyContent: "center" }} onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button style={{ flex: 1, background: "#b83020", color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontSize: 13, cursor: "pointer" }} onClick={() => deleteReel(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SIZE INWARD HISTORY (collapsible challans) ───────────────────────────────
function SizeInwardHistory({ sz, inwardGroups }) {
  const [open, setOpen] = useState(null);
  const groups = Object.values(inwardGroups).sort((a, b) => new Date(a.date) - new Date(b.date));
  return (
    <div className="card">
      <h3>Inward History — all trucks that had {sz}"</h3>
      {groups.length === 0 ? (
        <div style={{ fontSize: 13, color: "#b0a898", fontStyle: "italic" }}>No inward history.</div>
      ) : (
        <div style={{ border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
          {groups.map((grp, idx) => {
            const key = grp.invoiceNo || `${grp.date}|${grp.supplier}`;
            const isOpen = open === key;
            const totalWt = grp.reels.reduce((s, r) => s + Number(r.weight), 0);
            const soldCount = grp.reels.filter(r => r.sold).length;
            return (
              <div key={key} style={{ borderBottom: idx < groups.length - 1 ? "1px solid #e8eef8" : "none" }}>
                <div onClick={() => setOpen(p => p === key ? null : key)}
                  style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, background: isOpen ? "#faf8f4" : "transparent", transition: "background 0.12s" }}
                  onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "#faf8f4"; }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ minWidth: 88, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{fmtDate(grp.date)}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{grp.supplier || "Unknown supplier"}</div>
                    {grp.invoiceNo && <div style={{ fontSize: 11, color: "#9a9080", marginTop: 1 }}>{grp.invoiceNo}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    <span className="tag tag-green" style={{ fontSize: 11 }}>{grp.reels.length} reel{grp.reels.length !== 1 ? "s" : ""}</span>
                    {soldCount > 0 && <span className="tag tag-red" style={{ fontSize: 10 }}>{soldCount} sold</span>}
                    <span style={{ fontSize: 12, color: "#6a6050", fontWeight: 500 }}>{fmt(Math.round(totalWt))} kg</span>
                  </div>
                  <div style={{ color: "#c8b89a", fontSize: 16, flexShrink: 0, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</div>
                </div>
                {isOpen && (
                  <div style={{ background: "#faf8f4", borderTop: "1px solid #dde8f5", padding: "12px 16px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {grp.reels.map((r, j) => (
                        <span key={j} style={{ background: r.sold ? "#fef0ee" : r.converted ? "#f8f2ff" : "#edf7f0", border: `1px solid ${r.sold ? "#f0c0ba" : r.converted ? "#c8b0e0" : "#b5dcc0"}`, borderRadius: 5, padding: "4px 10px", fontSize: 12, color: r.sold ? "#9a4030" : r.converted ? "#6a3a8a" : "#2d6a4f", fontWeight: 500 }}>
                          {fmt(r.weight)} kg{r.sold ? " · sold" : r.converted ? " · → liner" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── SIZE OUTWARD HISTORY (collapsible challans) ──────────────────────────────
function SizeOutwardHistory({ sz, challanList }) {
  const [open, setOpen] = useState(null);
  const sorted = [...challanList].sort((a, b) => new Date(a.date) - new Date(b.date));
  return (
    <div className="card">
      <h3>Outward History — sales of {sz}"</h3>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 13, color: "#b0a898", fontStyle: "italic" }}>No sales recorded for this size yet.</div>
      ) : (
        <div style={{ border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
          {sorted.map((ch, idx) => {
            const key = ch.challanNo || `${ch.date}|${ch.customer}`;
            const isOpen = open === key;
            const totalWt = ch.reels.reduce((s, r) => s + Number(r.weight), 0);
            return (
              <div key={key} style={{ borderBottom: idx < sorted.length - 1 ? "1px solid #e8eef8" : "none" }}>
                <div onClick={() => setOpen(p => p === key ? null : key)}
                  style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, background: isOpen ? "#faf8f4" : "transparent", transition: "background 0.12s" }}
                  onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "#faf8f4"; }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ minWidth: 88, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{fmtDate(ch.date)}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{ch.customer}</div>
                    {ch.challanNo && <div style={{ fontSize: 11, color: "#9a9080", marginTop: 1 }}>Challan {ch.challanNo}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    <span className="tag tag-red" style={{ fontSize: 11 }}>{ch.reels.length} reel{ch.reels.length !== 1 ? "s" : ""}</span>
                    <span style={{ fontSize: 12, color: "#6a6050", fontWeight: 500 }}>{fmt(Math.round(totalWt))} kg</span>
                  </div>
                  <div style={{ color: "#c8b89a", fontSize: 16, flexShrink: 0, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</div>
                </div>
                {isOpen && (
                  <div style={{ background: "#faf8f4", borderTop: "1px solid #dde8f5", padding: "12px 16px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {ch.reels.sort((a, b) => Number(a.weight) - Number(b.weight)).map((r, j) => (
                        <span key={r.id || j} style={{ background: "#fef0ee", border: "1px solid #f0c0ba", borderRadius: 5, padding: "4px 10px", fontSize: 12, color: "#9a4030", fontWeight: 500 }}>
                          {fmt(r.weight)} kg
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

// ─── BULK IMPORT ─────────────────────────────────────────────────────────────
// ─── STOCK (INWARD) ───────────────────────────────────────────────────────────
function StockTab({ state, update, stockNav, clearStockNav, isEmployee }) {
  const [productTab, setProductTab] = useState("reels"); // "reels" | "liner" | "gum"
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState({ bf: "", gsm: "", shade: "", size: "", showSold: false });
  const [openShip, setOpenShip] = useState(null);
  const [editShipKey, setEditShipKey] = useState(null); // shipment being rate-edited
  const [shipRates, setShipRates] = useState({});       // "bf|gsm" -> {mode,rate,slabs}
  const [shipTransportRate, setShipTransportRate] = useState(""); // edit panel transport rate
  const [shipWaraiRate, setShipWaraiRate] = useState(""); // edit panel warai rate
  const [editWeightKey, setEditWeightKey] = useState(null); // shipment being weight-edited

  useEffect(() => {
    if (stockNav?.size) {
      setFilter(f => ({ ...f, size: stockNav.size }));
      setView("size");
      clearStockNav();
    }
    if (stockNav?.linerTab) {
      setProductTab("liner");
      clearStockNav();
    }
  }, [stockNav]);
  const [form, setForm] = useState({ supplier: "", invoiceNo: "", date: today(), bf: state.grades[0]?.bf || "18", gsm: state.grades[0]?.gsm || "150", shade: state.grades[0]?.shade || "golden" });
  const [reels, setReels] = useState([]);
  const [newReel, setNewReel] = useState({ size: "", weight: "" });
  const [saved, setSaved] = useState(false);
  const [gradeRates, setGradeRates] = useState({}); // "bf|gsm" -> { mode:"simple"|"slabs", rate:"", slabs:[{kg,rate}] }
  const [inwardTransportRate, setInwardTransportRate] = useState(""); // ₹/kg for this shipment
  const [inwardWaraiRate, setInwardWaraiRate] = useState(""); // ₹/kg for this shipment
  const weightInputRef = useRef(null);
  // Gum additions to inward
  const [inwardGumRows, setInwardGumRows] = useState([]); // [{id, variantId, numSacks, sackWeight, costRate}]
  const addGumRow = () => setInwardGumRows(p => [...p, { id: genId(), variantId: (state.gumVariants||[])[0]?.id || "", numSacks: "", sackWeight: "", costRate: "" }]);
  const removeGumRow = id => setInwardGumRows(p => p.filter(x => x.id !== id));
  const updateGumRow = (id, field, val) => setInwardGumRows(p => p.map(x => x.id === id ? {...x, [field]: val} : x));

  // Detect grades in current reels and ensure gradeRates has an entry for each
  const detectedGrades = [...new Set(reels.map(r => `${form.bf}|${form.gsm}`))];
  // When grade changes or reels added, seed gradeRates entry
  const ensureGradeRate = (bf, gsm) => {
    const k = `${bf}|${gsm}`;
    if (!gradeRates[k]) setGradeRates(p => ({ ...p, [k]: { mode: "simple", rate: "", slabs: [{ kg: "", rate: "" }] } }));
  };

  const addReel = () => {
    if (!newReel.size || !newReel.weight) return;
    ensureGradeRate(form.bf, form.gsm);
    setReels(p => [...p, { ...newReel, id: genId(), bf: form.bf, gsm: form.gsm, shade: form.shade }]);
    setNewReel(r => ({ ...r, weight: "" }));
    setTimeout(() => {
      weightInputRef.current?.focus();
      weightInputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  };

  const submit = () => {
    if (!form.supplier || (reels.length === 0 && inwardGumRows.filter(g => g.numSacks && g.sackWeight).length === 0)) return;
    // Group reels by grade to assign costRate
    const gradeGroups = {};
    reels.forEach(r => {
      const k = `${r.bf}|${r.gsm}`;
      if (!gradeGroups[k]) gradeGroups[k] = [];
      gradeGroups[k].push(r);
    });
    const nr = reels.map(r => {
      const k = `${r.bf}|${r.gsm}`;
      const gr = gradeRates[k];
      const gradeKg = gradeGroups[k].reduce((s, x) => s + Number(x.weight), 0);
      const costRate = gr
        ? (gr.mode === "simple" ? Number(gr.rate) || 0 : computeWeightedCostRate(gr.slabs, gradeKg))
        : 0;
      const tRate = Number(inwardTransportRate) || 0;
      const wRate = Number(inwardWaraiRate) || 0;
      return { ...r, id: genId(), sold: false, supplier: form.supplier, invoiceNo: form.invoiceNo, inwardDate: form.date, costRate, transportRate: tRate, waraiRate: wRate };
    });
    // Save gum sacks
    const validGumRows = inwardGumRows.filter(g => g.variantId && g.numSacks && g.sackWeight);
    const tRate = Number(inwardTransportRate) || 0;
    const wRate = Number(inwardWaraiRate) || 0;
    const newGumSacks = validGumRows.flatMap(row => {
      const variant = (state.gumVariants||[]).find(v => v.id === row.variantId);
      const batchId = genId();
      return Array.from({ length: Number(row.numSacks) }, () => ({
        id: genId(), variantId: row.variantId, variantName: variant?.name || row.variantId,
        sackWeight: Number(row.sackWeight), costRate: Number(row.costRate) || 0,
        transportRate: tRate, waraiRate: wRate,
        supplier: form.supplier, invoiceNo: form.invoiceNo, inwardDate: form.date,
        sold: false, batchId,
      }));
    });
    update(s => {
      s.stock = [...s.stock, ...nr];
      if (!s.gumStock) s.gumStock = [];
      s.gumStock = [...s.gumStock, ...newGumSacks];
    });
    setSaved(true); setReels([]); setGradeRates({}); setInwardGumRows([]); setInwardTransportRate(""); setInwardWaraiRate("");
    setTimeout(() => { setSaved(false); setView("list"); }, 1800);
  };

  const bySizeMap = {};
  reels.forEach(r => { if (!bySizeMap[r.size]) bySizeMap[r.size] = []; bySizeMap[r.size].push(r); });
  const totalWt = reels.reduce((s, r) => s + (Number(r.weight) || 0), 0);

  if (view === "add") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 160 }} className="fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setView("list")}>← Back</button>
        <div><div className="section-eyebrow">Inward</div><h2>Add Stock Entry</h2></div>
      </div>
      {saved && <div className="ok-box">✓ Stock saved successfully!</div>}
      <div className="card">
        <h3>Supplier Details</h3>
        <div className="g4">
          <div><label className="lbl">Supplier Name</label><input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="e.g. Nexois Paper LLP" /></div>
          <div><label className="lbl">Invoice / Note No</label><input value={form.invoiceNo} onChange={e => setForm(f => ({ ...f, invoiceNo: e.target.value }))} placeholder="e.g. NP/0298/2026-27" /></div>
          <div><label className="lbl">Date</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
          <div>
            <label className="lbl">Paper Grade</label>
            <select value={`${form.bf}|${form.gsm}|${form.shade}`} onChange={e => { const [bf, gsm, shade] = e.target.value.split("|"); setForm(f => ({ ...f, bf, gsm, shade })); }}>
              {state.grades.map(g => <option key={g.label} value={`${g.bf}|${g.gsm}|${g.shade}`}>{g.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      {/* Scrollable reel list — grows upward as items are added */}
      <div className="card">
        <h3 style={{ marginBottom: reels.length ? 14 : 0 }}>
          Reels Added {reels.length > 0 && `— ${reels.length} reels, ${fmt(totalWt)} kg`}
        </h3>
        {reels.length === 0 && (
          <div style={{ fontSize: 13, color: "#b0a898", fontStyle: "italic" }}>No reels yet — use the entry bar below to add.</div>
        )}
        {Object.entries(bySizeMap).sort((a, b) => Number(a[0]) - Number(b[0])).map(([sz, sr]) => {
          const sizeTotal = sr.reduce((s, r) => s + (Number(r.weight) || 0), 0);
          return (
            <div key={sz} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div className="lbl" style={{ marginBottom: 0 }}>Size {sz}" — {sr.length} reel{sr.length !== 1 ? "s" : ""}</div>
                {sizeTotal > 0 && <span style={{ fontSize: 11, color: "#6a6050", fontWeight: 600 }}>{fmt(sizeTotal)} kg total</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {sr.map((r, i) => (
                  <div key={r.id} style={{ background: "#f8f7f4", border: "1px solid #e8e2d8", borderRadius: 8, padding: "7px 10px", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: "#b0a898", minWidth: 18 }}>#{i + 1}</span>
                    <input type="number" value={r.weight} onChange={e => setReels(p => p.map(x => x.id === r.id ? { ...x, weight: e.target.value } : x))} style={{ width: 72, padding: "4px 8px", fontSize: 12 }} />
                    <span style={{ fontSize: 10, color: "#b0a898" }}>kg</span>
                    <button style={{ background: "transparent", color: "#c0392b", border: "1px solid #f0c0ba", borderRadius: 4, padding: "2px 6px", fontSize: 10 }} onClick={() => setReels(p => p.filter(x => x.id !== r.id))}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cost Rates per grade */}
      {reels.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Cost Rates — ₹/kg per grade</h3>
          {[...new Set(reels.map(r => `${r.bf}|${r.gsm}`))].map(gk => {
            const [bf, gsm] = gk.split("|");
            const gr = gradeRates[gk] || { mode: "simple", rate: "", slabs: [{ kg: "", rate: "" }] };
            const gradeLabel = `${bf} BF ${gsm} GSM`;
            const gradeKg = reels.filter(r => r.bf === bf && r.gsm === gsm).reduce((s, r) => s + Number(r.weight), 0);
            return (
              <div key={gk} style={{ marginBottom: 14, padding: "12px 14px", background: "#faf8f4", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{gradeLabel}</span>
                  <span style={{ fontSize: 11, color: "#8b6914" }}>{fmt(Math.round(gradeKg))} kg</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: gr.mode === "slabs" ? 8 : 0 }}>
                  {gr.mode === "simple" ? (
                    <input type="number" step="0.01" inputMode="numeric" value={gr.rate} placeholder="₹/kg e.g. 28"
                      onChange={e => setGradeRates(p => ({ ...p, [gk]: { ...gr, rate: e.target.value } }))}
                      style={{ flex: 1 }} />
                  ) : null}
                  <button className="btn btn-outline btn-sm" style={{ flexShrink: 0, fontSize: 11 }}
                    onClick={() => setGradeRates(p => ({ ...p, [gk]: { ...gr, mode: gr.mode === "simple" ? "slabs" : "simple" } }))}>
                    {gr.mode === "simple" ? "+ Split rates" : "Simple rate"}
                  </button>
                </div>
                {gr.mode === "slabs" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {gr.slabs.map((sl, si) => (
                      <div key={si} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="number" inputMode="numeric" value={sl.kg} placeholder="kg"
                          style={{ flex: 1 }}
                          onChange={e => setGradeRates(p => { const slabs = [...p[gk].slabs]; slabs[si] = { ...slabs[si], kg: e.target.value }; return { ...p, [gk]: { ...p[gk], slabs } }; })} />
                        <span style={{ fontSize: 12, color: "#8b6914", flexShrink: 0 }}>kg @</span>
                        <input type="number" step="0.01" inputMode="numeric" value={sl.rate} placeholder="₹/kg"
                          style={{ flex: 1 }}
                          onChange={e => setGradeRates(p => { const slabs = [...p[gk].slabs]; slabs[si] = { ...slabs[si], rate: e.target.value }; return { ...p, [gk]: { ...p[gk], slabs } }; })} />
                        {gr.slabs.length > 1 && <button onClick={() => setGradeRates(p => { const slabs = p[gk].slabs.filter((_, i) => i !== si); return { ...p, [gk]: { ...p[gk], slabs } }; })} style={{ background: "transparent", color: "#b83020", border: "none", fontSize: 14, cursor: "pointer" }}>✕</button>}
                      </div>
                    ))}
                    <button className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start", fontSize: 11 }}
                      onClick={() => setGradeRates(p => ({ ...p, [gk]: { ...p[gk], slabs: [...p[gk].slabs, { kg: "", rate: "" }] } }))}>
                      + Add slab
                    </button>
                    <div style={{ fontSize: 11, color: "#8b6914", fontStyle: "italic" }}>Remaining kg auto-assigned to last slab rate</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── TRANSPORT + WARAI RATES ── */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Landed Cost Additions <span style={{ fontSize: 10, fontWeight: 400, color: "#9a9080" }}>(optional — applies to whole shipment)</span></h3>
        <div className="g3" style={{ marginBottom: 8 }}>
          <div>
            <label className="lbl">Transport Rate (₹/kg)</label>
            <input type="number" step="0.01" inputMode="numeric" value={inwardTransportRate} onChange={e => setInwardTransportRate(e.target.value)} placeholder="e.g. 1.30" />
          </div>
          <div>
            <label className="lbl">Warai / Labour (₹/kg)</label>
            <input type="number" step="0.01" inputMode="numeric" value={inwardWaraiRate} onChange={e => setInwardWaraiRate(e.target.value)} placeholder="e.g. 0.50" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            {(inwardTransportRate || inwardWaraiRate) && reels.length > 0 && (() => {
              const gradeKgs = {};
              reels.forEach(r => { const k=`${r.bf}|${r.gsm}`; gradeKgs[k]=(gradeKgs[k]||0)+Number(r.weight); });
              const sampleGradeKey = Object.keys(gradeKgs)[0];
              const gr = sampleGradeKey ? gradeRates[sampleGradeKey] : null;
              const paperRate = gr ? (gr.mode === "simple" ? Number(gr.rate)||0 : computeWeightedCostRate(gr.slabs, gradeKgs[sampleGradeKey])) : 0;
              const landed = paperRate + (Number(inwardTransportRate)||0) + (Number(inwardWaraiRate)||0);
              return paperRate > 0 ? (
                <div style={{ fontSize: 11, background: "#f0f7ea", border: "1px solid #b5dcc0", borderRadius: 7, padding: "6px 10px", color: "#2d6a4f" }}>
                  <span style={{ fontWeight: 600 }}>{fmtRate(landed)}/kg landed</span>
                  <span style={{ color: "#9a9080", marginLeft: 4 }}>({fmtRate(paperRate)} paper + {fmtRate((Number(inwardTransportRate)||0)+(Number(inwardWaraiRate)||0))} charges)</span>
                </div>
              ) : null;
            })()}
          </div>
        </div>
      </div>

      {/* ── GUM SACKS SECTION IN INWARD ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: inwardGumRows.length ? 14 : 0 }}>
          <h3 style={{ marginBottom: 0 }}>🪣 Pasting Gum — Add to This Inward <span style={{ fontSize: 10, fontWeight: 400, color: "#9a9080" }}>(optional)</span></h3>
          <button className="btn btn-outline btn-sm" onClick={addGumRow}>+ Add Gum</button>
        </div>
        {inwardGumRows.length === 0 && (
          <div style={{ fontSize: 12, color: "#b0a898", fontStyle: "italic", marginTop: 8 }}>No gum in this shipment — tap "+ Add Gum" if gum is coming with this truck.</div>
        )}
        {inwardGumRows.map((row, ri) => {
          const variant = (state.gumVariants||[]).find(v => v.id === row.variantId);
          const rowKg = Number(row.numSacks||0) * Number(row.sackWeight||0);
          return (
            <div key={row.id} style={{ marginTop: 12, padding: "12px 14px", background: "#f5f0e8", borderRadius: 10, border: "1px solid #e5dece" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {variant && <div style={{ width: 10, height: 10, borderRadius: 2, background: variant.color }} />}
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Gum Row {ri+1}</span>
                </div>
                <button onClick={() => removeGumRow(row.id)} style={{ background: "transparent", color: "#b83020", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
              </div>
              <div className="g3" style={{ marginBottom: 8 }}>
                <div>
                  <label className="lbl">Variant</label>
                  <select value={row.variantId} onChange={e => updateGumRow(row.id, "variantId", e.target.value)}>
                    <option value="">Select</option>
                    {(state.gumVariants||[]).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="lbl">No. of Sacks</label>
                  <input type="number" inputMode="numeric" value={row.numSacks} onChange={e => updateGumRow(row.id, "numSacks", e.target.value)} placeholder="e.g. 10" />
                </div>
                <div>
                  <label className="lbl">Weight/Sack (kg)</label>
                  <input type="number" inputMode="numeric" value={row.sackWeight} onChange={e => updateGumRow(row.id, "sackWeight", e.target.value)} placeholder="25 or 30" />
                </div>
              </div>
              <div style={{ maxWidth: 180 }}>
                <label className="lbl">Cost Rate (₹/kg)</label>
                <input type="number" step="0.01" inputMode="numeric" value={row.costRate} onChange={e => updateGumRow(row.id, "costRate", e.target.value)} placeholder="₹/kg" />
              </div>
              {rowKg > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#6a6050", fontWeight: 600 }}>
                  {row.numSacks} sacks × {row.sackWeight} kg = {fmt(rowKg)} kg
                  {row.costRate && <span style={{ color: "#8b6914", marginLeft: 8 }}>· {fmtRs(rowKg * Number(row.costRate))} cost</span>}
                </div>
              )}
            </div>
          );
        })}
        {inwardGumRows.length > 0 && (() => {
          const totalGumKg = inwardGumRows.reduce((s, r) => s + Number(r.numSacks||0) * Number(r.sackWeight||0), 0);
          const totalGumCost = inwardGumRows.reduce((s, r) => s + Number(r.numSacks||0) * Number(r.sackWeight||0) * (Number(r.costRate)||0), 0);
          return totalGumKg > 0 ? (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #e5dece", fontSize: 12, color: "#6a6050" }}>
              Total gum: <strong>{fmt(totalGumKg)} kg</strong> across {inwardGumRows.length} variant{inwardGumRows.length !== 1 ? "s" : ""}
              {totalGumCost > 0 && <span style={{ color: "#8b6914", fontWeight: 700, marginLeft: 8 }}>· {fmtRs(totalGumCost)} cost value</span>}
            </div>
          ) : null;
        })()}
      </div>

      {/* ── STICKY ENTRY BAR — stays at bottom regardless of scroll ── */}
      <div style={{ position: "sticky", bottom: 0, zIndex: 120, background: "#f8f7f4", padding: "10px 0 0 0" }}>
        <div className="card" style={{ borderTop: "2px solid #e8e2d8", borderRadius: "14px 14px 14px 14px", boxShadow: "0 -4px 20px rgba(0,0,0,0.07)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label className="lbl">Size</label>
              <select value={newReel.size} onChange={e => setNewReel(r => ({ ...r, size: e.target.value }))}>
                <option value="">Select</option>{SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}"</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label className="lbl">Weight (kg)</label>
              <input
                ref={weightInputRef}
                type="number"
                inputMode="numeric"
                value={newReel.weight}
                onChange={e => setNewReel(r => ({ ...r, weight: e.target.value }))}
                placeholder="e.g. 274"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addReel(); } }}
              />
            </div>
            <button className="btn btn-outline" onMouseDown={e => e.preventDefault()} onClick={addReel} style={{ flexShrink: 0 }}>+ Add</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: "1px solid #e8eef8" }}>
            <div style={{ fontSize: 13, color: "#8a8070" }}>
              Total: <span className="serif" style={{ fontSize: 20, color: "#1a1a1a" }}>{fmt(totalWt)} kg</span>
              <span style={{ fontSize: 11, color: "#b0a898", marginLeft: 6 }}>({reels.length} reels)</span>
              {(() => {
                const shipVal = Object.entries(gradeRates).reduce((s, [gk, gr]) => {
                  const [bf, gsm] = gk.split("|");
                  const gradeKg = reels.filter(r => r.bf === bf && r.gsm === gsm).reduce((ss, r) => ss + Number(r.weight), 0);
                  const rate = gr.mode === "simple" ? Number(gr.rate)||0 : computeWeightedCostRate(gr.slabs, gradeKg);
                  return s + rate * gradeKg;
                }, 0);
                return shipVal > 0 ? <span style={{ display: "block", fontSize: 12, color: "#8b6914", fontWeight: 700, marginTop: 2 }}>{fmtRs(shipVal)} shipment value</span> : null;
              })()}
            </div>
            <button className="btn btn-dark" onClick={submit} disabled={(reels.length === 0 && inwardGumRows.filter(g => g.numSacks && g.sackWeight).length === 0) || !form.supplier}>✓ Save</button>
          </div>
        </div>
      </div>
    </div>
  );

  if (view === "size") {
    const sz = filter.size;
    // Include ALL reels for this size (sold, available, converted) so grade keys are always found
    // This prevents blank/crash when all reels of a new grade have been converted
    const allForSize = state.stock.filter(r => r.size === sz && r.productType !== "liner");
    // Build separate data per grade so stock/inward/outward are never mixed
    const gradeKeys = [...new Set(allForSize.map(r => `${r.bf}|${r.gsm}|${r.shade||""}`))].sort();
    const gradeData = gradeKeys.map(gk => {
      const [bf, gsm, shade] = gk.split("|");
      const gradeReels = allForSize.filter(r => r.bf === bf && r.gsm === gsm && (r.shade||"") === shade);
      // Available = not sold AND not converted to liner
      const availForGrade = gradeReels.filter(r => !r.sold && !r.converted);
      // Converted = sent to liner conversion
      const convertedForGrade = gradeReels.filter(r => r.converted && !r.sold);
      const soldForGrade = gradeReels.filter(r => r.sold).sort((a, b) => new Date(b.soldDate) - new Date(a.soldDate));
      const inwardGroups = {};
      gradeReels.forEach(r => {
        const key = r.invoiceNo || r.inwardDate || "Unknown";
        if (!inwardGroups[key]) inwardGroups[key] = { invoiceNo: r.invoiceNo, date: r.inwardDate, supplier: r.supplier, reels: [] };
        inwardGroups[key].reels.push(r);
      });
      const challanGroups = {};
      soldForGrade.forEach(r => {
        const key = r.soldChallanNo || `${r.soldDate}|${r.soldTo}`;
        if (!challanGroups[key]) challanGroups[key] = { challanNo: r.soldChallanNo, date: r.soldDate, customer: r.soldTo, reels: [] };
        challanGroups[key].reels.push(r);
      });
      const challanList = Object.values(challanGroups).sort((a, b) => new Date(b.date) - new Date(a.date));
      return { bf, gsm, shade, availForGrade, convertedForGrade, inwardGroups, challanList };
    });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => { setView("list"); setFilter(f => ({ ...f, size: "" })); }}>← Back</button>
          <div><div className="section-eyebrow">Size Detail</div><h2>{sz}" Reels — Full History</h2></div>
        </div>
        {gradeData.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <span className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>No history found for {sz}" reels.</span>
          </div>
        )}
        {gradeData.map((gd, gi) => (
          <div key={`${gd.bf}|${gd.gsm}|${gd.shade}`} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {gradeData.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#f5f0e8", border: "1px solid #e5dece", borderRadius: 10 }}>
                <span className="serif" style={{ fontSize: 18, color: "#1a1a1a" }}>{gd.bf} BF · {gd.gsm} GSM</span>
                <span className="tag" style={{ textTransform: "capitalize" }}>{gd.shade}</span>
                <span style={{ fontSize: 12, color: "#9a9080", marginLeft: 2 }}>
                  {gd.availForGrade.length} available · {gd.availForGrade.reduce((s, r) => s + Number(r.weight), 0) > 0 ? fmt(gd.availForGrade.reduce((s, r) => s + Number(r.weight), 0)) + " kg" : "0 kg"}
                  {gd.convertedForGrade.length > 0 && <span style={{ marginLeft: 8, color: "#6a3a8a" }}>· {gd.convertedForGrade.length} converted to liner</span>}
                </span>
              </div>
            )}
            <EditableStockForSize sz={sz} availForSize={gd.availForGrade} update={update} />
            {/* Converted-to-liner section */}
            {gd.convertedForGrade.length > 0 && (
              <div className="card" style={{ border: "1px solid #c8b0e0" }}>
                <h3 style={{ color: "#6a3a8a", marginBottom: 12 }}>Converted to Liner — {gd.convertedForGrade.length} reel{gd.convertedForGrade.length !== 1 ? "s" : ""}</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {gd.convertedForGrade.map(r => {
                    // Find the liners that came from this reel
                    const liners = state.stock.filter(l => l.productType === "liner" && l.sourceReelId === r.id);
                    return (
                      <div key={r.id} style={{ background: "#f8f2ff", border: "1.5px solid #c8b0e0", borderRadius: 10, padding: "10px 14px", minWidth: 120 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#6a3a8a" }}>{fmt(r.weight)} kg reel</div>
                        <div style={{ fontSize: 10, color: "#9a8090", marginTop: 2 }}>{fmtDate(r.inwardDate)}</div>
                        {liners.length > 0 ? (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 10, color: "#6a3a8a", fontWeight: 600, marginBottom: 4 }}>{liners.length} liner{liners.length !== 1 ? "s" : ""} produced:</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {liners.map(l => (
                                <span key={l.id} style={{ background: l.sold ? "#fef0ee" : "#edf7f0", border: `1px solid ${l.sold ? "#f0c0ba" : "#b5dcc0"}`, borderRadius: 4, padding: "2px 7px", fontSize: 11, color: l.sold ? "#9a4030" : "#2d6a4f", fontWeight: 500 }}>
                                  {fmt(l.weight)} kg{l.sold ? " · sold" : " · avail"}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 10, color: "#b0a898", marginTop: 6, fontStyle: "italic" }}>No liners linked yet</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <SizeInwardHistory sz={sz} inwardGroups={gd.inwardGroups} />
            <SizeOutwardHistory sz={sz} challanList={gd.challanList} />
            {gi < gradeData.length - 1 && <div style={{ height: 1, background: "#e8e2d8", margin: "6px 0" }} />}
          </div>
        ))}
      </div>
    );
  }

  // ── INWARD HISTORY VIEW ──
  if (view === "inward") {
    const shipments = {};
    state.stock.forEach(r => {
      const key = r.invoiceNo ? r.invoiceNo : `__${r.inwardDate}__${r.supplier}`;
      if (!shipments[key]) shipments[key] = { invoiceNo: r.invoiceNo || null, date: r.inwardDate, supplier: r.supplier || "Unknown", reels: [] };
      shipments[key].reels.push(r);
    });
    const shipList = Object.values(shipments).sort((a, b) => new Date(b.date) - new Date(a.date));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setView("list")}>← Back</button>
          <div><div className="section-eyebrow">Inward</div><h2>Inward History</h2></div>
        </div>
        {shipList.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <span className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>No inward entries yet.</span>
          </div>
        ) : (
          <div className="card-flat">
            {shipList.map((sh, idx) => {
              const key = sh.invoiceNo || `__${sh.date}__${sh.supplier}`;
              const isOpen = openShip === key;
              const totalWt = sh.reels.reduce((s, r) => s + Number(r.weight), 0);
              const availCount = sh.reels.filter(r => !r.sold).length;
              const bySizeInShip = {};
              sh.reels.forEach(r => {
                if (!bySizeInShip[r.size]) bySizeInShip[r.size] = [];
                bySizeInShip[r.size].push(r);
              });
              return (
                <div key={key} style={{ borderBottom: idx < shipList.length - 1 ? "1px solid #e8eef8" : "none" }}>
                  <div onClick={() => setOpenShip(p => p === key ? null : key)}
                    style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, transition: "background 0.12s", background: isOpen ? "#faf8f4" : "transparent" }}
                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "#faf8f4"; }}
                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1a" }}>{sh.supplier}</span>
                        <span className="tag tag-green" style={{ fontSize: 10 }}>{sh.reels.length} reels</span>
                        {availCount < sh.reels.length && <span className="tag tag-red" style={{ fontSize: 10 }}>{sh.reels.length - availCount} sold</span>}
                        {sh.reels.some(r => !r.costRate) && <span style={{ fontSize: 10, background: "#fef5e8", border: "1px solid #f0d5a0", borderRadius: 4, padding: "1px 6px", color: "#a05800", fontWeight: 600 }}>⚠ no cost rate</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#9a9080", fontWeight: 500 }}>{fmtDate(sh.date)}</span>
                        {sh.invoiceNo && <><span style={{ fontSize: 10, color: "#d0c8bc" }}>·</span><span style={{ fontSize: 11, color: "#9a9080" }}>{sh.invoiceNo}</span></>}
                        <span style={{ fontSize: 10, color: "#d0c8bc" }}>·</span>
                        <span style={{ fontSize: 11, color: "#6a6050", fontWeight: 500 }}>{fmt(Math.round(totalWt))} kg</span>
                        {Object.keys(bySizeInShip).sort((a, b) => Number(a) - Number(b)).slice(0, 4).map(sz => (
                          <span key={sz} className="tag" style={{ fontSize: 10 }}>{sz}"</span>
                        ))}
                        {Object.keys(bySizeInShip).length > 4 && <span style={{ fontSize: 10, color: "#9a9080" }}>+{Object.keys(bySizeInShip).length - 4}</span>}
                      </div>
                    </div>
                    <div style={{ color: "#c8b89a", fontSize: 16, flexShrink: 0, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</div>
                  </div>
                  {isOpen && (
                    <div style={{ background: "#faf8f4", borderTop: "1px solid #dde8f5", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

                      {/* Action buttons */}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-outline btn-sm"
                          onClick={() => {
                            if (editShipKey === key) { setEditShipKey(null); return; }
                            // Seed rates from existing costRate on reels
                            const grades = {};
                            sh.reels.forEach(r => {
                              const k2 = `${r.bf}|${r.gsm}`;
                              if (!grades[k2]) grades[k2] = { mode: "simple", rate: String(r.costRate || ""), slabs: [{ kg: "", rate: String(r.costRate || "") }] };
                            });
                            setShipRates(grades);
                            // Seed transport/warai from first reel
                            setShipTransportRate(String(sh.reels[0]?.transportRate || ""));
                            setShipWaraiRate(String(sh.reels[0]?.waraiRate || ""));
                            setEditShipKey(key);
                            setEditWeightKey(null);
                          }}>
                          {editShipKey === key ? "✕ Cancel" : "₹ Edit Cost Rates"}
                        </button>
                        <button className="btn btn-outline btn-sm"
                          onClick={() => { setEditWeightKey(editWeightKey === key ? null : key); setEditShipKey(null); }}>
                          {editWeightKey === key ? "✕ Cancel" : "✏ Edit Weights"}
                        </button>
                      </div>

                      {/* Cost rate edit panel */}
                      {editShipKey === key && (
                        <div style={{ background: "#fff", border: "1.5px solid #8b6914", borderRadius: 10, padding: "14px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#8b6914", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Set Cost Rate per Grade</div>
                          {[...new Set(sh.reels.map(r => `${r.bf}|${r.gsm}`))].map(gk => {
                            const [gbf, ggsm] = gk.split("|");
                            const gr = shipRates[gk] || { mode: "simple", rate: "", slabs: [{ kg: "", rate: "" }] };
                            const gradeKg = sh.reels.filter(r => r.bf === gbf && r.gsm === ggsm).reduce((s, r) => s + Number(r.weight), 0);
                            return (
                              <div key={gk} style={{ marginBottom: 12, padding: "10px 12px", background: "#faf8f4", borderRadius: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                  <span style={{ fontWeight: 600, fontSize: 13 }}>{gbf} BF {ggsm} GSM</span>
                                  <span style={{ fontSize: 11, color: "#9a9080" }}>{fmt(Math.round(gradeKg))} kg</span>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: gr.mode === "slabs" ? 8 : 0 }}>
                                  {gr.mode === "simple" && (
                                    <input type="number" step="0.01" inputMode="numeric" value={gr.rate} placeholder="₹/kg e.g. 28"
                                      onChange={e => setShipRates(p => ({ ...p, [gk]: { ...gr, rate: e.target.value } }))}
                                      style={{ flex: 1 }} />
                                  )}
                                  <button className="btn btn-outline btn-sm" style={{ fontSize: 11, flexShrink: 0 }}
                                    onClick={() => setShipRates(p => ({ ...p, [gk]: { ...gr, mode: gr.mode === "simple" ? "slabs" : "simple" } }))}>
                                    {gr.mode === "simple" ? "+ Split" : "Simple"}
                                  </button>
                                </div>
                                {gr.mode === "slabs" && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    {gr.slabs.map((sl, si) => (
                                      <div key={si} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        <input type="number" inputMode="numeric" value={sl.kg} placeholder="kg" style={{ flex: 1 }}
                                          onChange={e => setShipRates(p => { const slabs = [...p[gk].slabs]; slabs[si] = { ...slabs[si], kg: e.target.value }; return { ...p, [gk]: { ...p[gk], slabs } }; })} />
                                        <span style={{ fontSize: 11, color: "#9a9080" }}>kg @</span>
                                        <input type="number" step="0.01" inputMode="numeric" value={sl.rate} placeholder="₹/kg" style={{ flex: 1 }}
                                          onChange={e => setShipRates(p => { const slabs = [...p[gk].slabs]; slabs[si] = { ...slabs[si], rate: e.target.value }; return { ...p, [gk]: { ...p[gk], slabs } }; })} />
                                        {gr.slabs.length > 1 && <button onClick={() => setShipRates(p => { const slabs = p[gk].slabs.filter((_,i) => i !== si); return { ...p, [gk]: { ...p[gk], slabs } }; })} style={{ background: "transparent", color: "#b83020", border: "none", fontSize: 14, cursor: "pointer" }}>✕</button>}
                                      </div>
                                    ))}
                                    <button className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start", fontSize: 11 }}
                                      onClick={() => setShipRates(p => ({ ...p, [gk]: { ...p[gk], slabs: [...p[gk].slabs, { kg: "", rate: "" }] } }))}>+ Add slab</button>
                                    <div style={{ fontSize: 10, color: "#9a9080", fontStyle: "italic" }}>Remaining kg assigned to last slab rate</div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <div style={{ display: "flex", gap: 8, marginBottom: 12, marginTop: 4 }}>
                            <div style={{ flex: 1 }}>
                              <label className="lbl">Transport Rate (₹/kg)</label>
                              <input type="number" step="0.01" inputMode="numeric" value={shipTransportRate} onChange={e => setShipTransportRate(e.target.value)} placeholder="e.g. 1.30" />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label className="lbl">Warai / Labour (₹/kg)</label>
                              <input type="number" step="0.01" inputMode="numeric" value={shipWaraiRate} onChange={e => setShipWaraiRate(e.target.value)} placeholder="e.g. 0.50" />
                            </div>
                          </div>
                          <button className="btn btn-dark btn-sm" style={{ width: "100%", justifyContent: "center" }}
                            onClick={() => {
                              // Assign costRate + transportRate + waraiRate to all reels in this shipment
                              const gradeKgs = {};
                              sh.reels.forEach(r => {
                                const k2 = `${r.bf}|${r.gsm}`;
                                if (!gradeKgs[k2]) gradeKgs[k2] = 0;
                                gradeKgs[k2] += Number(r.weight);
                              });
                              const tR = Number(shipTransportRate) || 0;
                              const wR = Number(shipWaraiRate) || 0;
                              update(s => {
                                s.stock = s.stock.map(r => {
                                  if (!sh.reels.some(x => x.id === r.id)) return r;
                                  const k2 = `${r.bf}|${r.gsm}`;
                                  const gr = shipRates[k2];
                                  if (!gr) return { ...r, transportRate: tR, waraiRate: wR };
                                  const costRate = gr.mode === "simple"
                                    ? Number(gr.rate) || 0
                                    : computeWeightedCostRate(gr.slabs, gradeKgs[k2]);
                                  return { ...r, costRate, transportRate: tR, waraiRate: wR };
                                });
                              });
                              setEditShipKey(null);
                            }}>
                            ✓ Save Rates to All Reels
                          </button>
                        </div>
                      )}

                      {/* Weight edit panel */}
                      {editWeightKey === key && (
                        <div style={{ background: "#fff", border: "1.5px solid #e8e2d8", borderRadius: 10, padding: "14px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#6a6050", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Edit Reel Weights</div>
                          {Object.entries(bySizeInShip).sort((a, b) => Number(a[0]) - Number(b[0])).map(([sz, reels]) => (
                            <div key={sz} style={{ marginBottom: 14 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <span className="serif" style={{ fontSize: 18 }}>{sz}"</span>
                                <span className="tag" style={{ fontSize: 10 }}>{reels[0].bf} BF · {reels[0].gsm} GSM</span>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {reels.map((r, i) => (
                                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 5, background: "#f4f7fb", border: "1px solid #e8e2d8", borderRadius: 7, padding: "5px 8px" }}>
                                    <span style={{ fontSize: 10, color: "#b0a898" }}>#{i+1}</span>
                                    <input type="number" inputMode="numeric" defaultValue={r.weight}
                                      onBlur={e => {
                                        const newWt = e.target.value;
                                        if (newWt && !isNaN(newWt) && newWt !== String(r.weight)) {
                                          update(s => { const idx = s.stock.findIndex(x => x.id === r.id); if (idx !== -1) s.stock[idx].weight = newWt; });
                                        }
                                      }}
                                      style={{ width: 72, padding: "3px 6px", fontSize: 12 }} />
                                    <span style={{ fontSize: 10, color: "#b0a898" }}>kg</span>
                                    {r.sold && <span style={{ fontSize: 9, color: "#c07060" }}>sold</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          <div style={{ fontSize: 11, color: "#9a9080", fontStyle: "italic", marginTop: 4 }}>Changes save automatically when you tap out of a field.</div>
                        </div>
                      )}

                      {/* Size breakdown (read-only when not editing) */}
                      {editShipKey !== key && editWeightKey !== key && (
                        Object.entries(bySizeInShip).sort((a, b) => Number(a[0]) - Number(b[0])).map(([sz, reels]) => {
                          const szTotal = reels.reduce((s, r) => s + Number(r.weight), 0);
                          const costSet = reels.some(r => r.costRate);
                          return (
                            <div key={sz}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span className="serif" style={{ fontSize: 20 }}>{sz}"</span>
                                  <span className="tag" style={{ fontSize: 10 }}>{reels[0].bf} BF · {reels[0].gsm} GSM</span>
                                  <span style={{ fontSize: 11, color: "#9a9080" }}>{reels.length} reel{reels.length !== 1 ? "s" : ""}</span>
                                  {costSet && <span style={{ fontSize: 10, color: "#2d6a4f", fontWeight: 600 }}>
                                    {fmtRate((Number(reels[0].costRate)||0)+(Number(reels[0].transportRate)||0)+(Number(reels[0].waraiRate)||0))}/kg{(reels[0].transportRate||reels[0].waraiRate) ? " landed" : ""}
                                  </span>}
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 600, color: "#6a6050" }}>{fmt(Math.round(szTotal))} kg</span>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                {reels.sort((a, b) => Number(a.weight) - Number(b.weight)).map(r => (
                                  <span key={r.id} style={{ background: r.sold ? "#fef0ee" : "#edf7f0", border: `1px solid ${r.sold ? "#f0c0ba" : "#b5dcc0"}`, borderRadius: 5, padding: "3px 9px", fontSize: 12, color: r.sold ? "#9a4030" : "#2d6a4f", fontWeight: 500 }}>
                                    {fmt(r.weight)} kg{r.sold ? " · sold" : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })
                      )}

                      <div style={{ borderTop: "1px solid #e8e2d8", paddingTop: 10, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "#9a9080" }}>{sh.reels.length} reels · {availCount} available</span>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontWeight: 600, color: "#1a1a1a" }}>{fmt(Math.round(totalWt))} kg total</span>
                          {(() => { 
                            const shipVal = sh.reels.reduce((s, r) => s + (Number(r.costRate)||0)*Number(r.weight), 0); 
                            const shipTransport = sh.reels.reduce((s, r) => s + (Number(r.transportRate)||0)*Number(r.weight), 0);
                            const shipWarai = sh.reels.reduce((s, r) => s + (Number(r.waraiRate)||0)*Number(r.weight), 0);
                            const shipLanded = shipVal + shipTransport + shipWarai;
                            if (shipVal <= 0) return null;
                            return (
                              <div style={{ textAlign: "right" }}>
                                {(shipTransport > 0 || shipWarai > 0) ? (
                                  <>
                                    <span style={{ display: "block", fontSize: 12, color: "#8b6914", fontWeight: 700 }}>{fmtRs(shipLanded)} landed cost</span>
                                    <span style={{ display: "block", fontSize: 10, color: "#9a9080" }}>{fmtRs(shipVal)} paper + {fmtRs(shipTransport+shipWarai)} charges</span>
                                  </>
                                ) : (
                                  <span style={{ display: "block", fontSize: 12, color: "#8b6914", fontWeight: 700 }}>{fmtRs(shipVal)} cost value</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── LIST VIEW ──
  const available = state.stock.filter(r => !r.sold && r.productType !== "liner");
  const availableLiner = state.stock.filter(r => !r.sold && r.productType === "liner");
  const sizeGroupMap = {};
  // Always iterate ALL stock so sizes with 0 available still appear in the list
  // Exclude liner items and converted-to-liner reels (they are no longer physical reels)
  state.stock.filter(r => r.productType !== "liner").forEach(r => {
    if (filter.bf && r.bf !== filter.bf) return;
    if (filter.gsm && r.gsm !== filter.gsm) return;
    if (filter.shade && r.shade !== filter.shade) return;
    if (filter.size && String(r.size).replace(/"/g,"").trim() !== filter.size) return;
    const k = `${r.size}|${r.bf}|${r.gsm}`;
    if (!sizeGroupMap[k]) sizeGroupMap[k] = { size: r.size, bf: r.bf, gsm: r.gsm, shade: r.shade||"", reels: [], soldReels: [], convertedReels: [] };
    if (r.sold) sizeGroupMap[k].soldReels.push(r);
    else if (r.converted) sizeGroupMap[k].convertedReels.push(r);
    else sizeGroupMap[k].reels.push(r);
  });
  const sizeGroups = Object.values(sizeGroupMap).sort((a, b) => Number(a.size) - Number(b.size));
  const totalAvailKg = available.filter(r => (!filter.bf || r.bf === filter.bf) && (!filter.gsm || r.gsm === filter.gsm)).reduce((s, r) => s + Number(r.weight), 0);
  const totalAvailReels = available.filter(r => (!filter.bf || r.bf === filter.bf) && (!filter.gsm || r.gsm === filter.gsm)).length;

  // ── LINER / GUM LIST VIEW ──
  if (productTab === "liner") {
    return <LinerStockTab state={state} update={update} isEmployee={isEmployee} />;
  }
  if (productTab === "gum") {
    return <GumStockTab state={state} update={update} isEmployee={isEmployee} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      {/* Product switcher */}
      <div style={{ display: "flex", gap: 4, background: "#f5f0e8", borderRadius: 10, padding: 4, alignSelf: "flex-start" }}>
        {[["reels","📦 Reels"], ["liner","📄 Liner"], ["gum","🪣 Gum"]].map(([t, label]) => (
          <button key={t} onClick={() => setProductTab(t)}
            style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: productTab === t ? "#fff" : "transparent", color: productTab === t ? "#1a1a1a" : "#8b6914", fontWeight: productTab === t ? 600 : 400, fontSize: 13, cursor: "pointer", boxShadow: productTab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div><div className="section-eyebrow">Inventory</div><h2>Stock Register</h2></div>
        {!isEmployee && <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setView("inward")}>📋 Inward History</button>
          <button className="btn btn-dark" onClick={() => { setView("add"); setSaved(false); setReels([]); }}>+ Add Inward</button>
        </div>}
      </div>
      <div className="card" style={{ padding: "14px 20px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 160 }}>
            <label className="lbl">Grade</label>
            <select value={`${filter.bf}|${filter.gsm}`} onChange={e => { const [bf, gsm] = e.target.value.split("|"); setFilter(f => ({ ...f, bf, gsm })); }}>
              <option value="|">All Grades</option>
              {state.grades.map(g => <option key={g.label} value={`${g.bf}|${g.gsm}`}>{g.bf} BF {g.gsm} GSM</option>)}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="lbl">Shade</label>
            <select value={filter.shade} onChange={e => setFilter(f => ({ ...f, shade: e.target.value }))}>
              <option value="">All</option>{SHADE_OPTIONS.map(o => <option key={o} style={{ textTransform: "capitalize" }}>{o}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 110 }}>
            <label className="lbl">Size</label>
            <select value={filter.size} onChange={e => setFilter(f => ({ ...f, size: e.target.value }))}>
              <option value="">All Sizes</option>{SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}"</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 2 }}>
            <input type="checkbox" checked={filter.showSold} onChange={e => setFilter(f => ({ ...f, showSold: e.target.checked }))} id="showSold" />
            <label htmlFor="showSold" style={{ fontSize: 12, cursor: "pointer" }}>Include sold sizes</label>
          </div>
          <div style={{ fontSize: 11, color: "#9a9080", paddingBottom: 4, marginLeft: "auto" }}>
            {totalAvailReels} reels · {fmt(totalAvailKg)} kg available
          </div>
        </div>
      </div>
      {sizeGroups.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <span className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>No stock matches the filter.</span>
        </div>
      ) : (
        <div className="card-flat">
          {sizeGroups.map((grp, idx) => {
            const totalWtGrp = grp.reels.reduce((s, r) => s + Number(r.weight), 0);
            const lowCount = grp.reels.length;
            const isCritical = lowCount <= 2 && lowCount > 0;
            const isModerate = lowCount === 3;
            return (
              <div key={`${grp.size}${grp.bf}${grp.gsm}`}
                style={{ padding: "12px 16px", borderBottom: idx < sizeGroups.length - 1 ? "1px solid #e8eef8" : "none", cursor: "pointer", transition: "background 0.12s" }}
                onClick={() => { setFilter(f => ({ ...f, size: grp.size })); setView("size"); }}
                onMouseEnter={e => e.currentTarget.style.background = "#faf8f4"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                {/* Line 1: size + grade + count + status + arrow */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: grp.reels.length > 0 ? 6 : 0 }}>
                  <span className="serif" style={{ fontSize: 26, lineHeight: 1, color: isCritical ? "#a05800" : isModerate ? "#2d2d2d" : "#1a1a1a", minWidth: 48, flexShrink: 0 }}>{grp.size}"</span>
                  <span className="tag" style={{ flexShrink: 0, fontSize: 11 }}>{grp.bf} BF · {grp.gsm} GSM</span>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {grp.reels.length === 0
                      ? <span style={{ fontSize: 11, color: "#b0a898", fontStyle: "italic" }}>No stock</span>
                      : <span style={{ fontSize: 12, fontWeight: 600, color: isCritical ? "#a05800" : "#1a1a1a" }}>{grp.reels.length} reel{grp.reels.length !== 1 ? "s" : ""}</span>
                    }
                    {grp.convertedReels?.length > 0 && <span style={{ fontSize: 10, background: "#f0eaf8", border: "1px solid #c8b0e0", borderRadius: 4, padding: "1px 6px", color: "#6a3a8a", fontWeight: 600 }}>{grp.convertedReels.length} → liner</span>}
                    {isCritical && <span className="tag tag-orange" style={{ fontSize: 10 }}>Low</span>}
                    {isModerate && <span className="tag tag-blue" style={{ fontSize: 10 }}>3 left</span>}
                    {filter.showSold && grp.soldReels.length > 0 && <span style={{ fontSize: 10, color: "#9a9080" }}>+{grp.soldReels.length} sold</span>}
                  </div>
                  <div style={{ color: "#c8b89a", fontSize: 16, flexShrink: 0 }}>›</div>
                </div>
                {/* Line 2: weight chips (capped at 6) + total */}
                {grp.reels.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", paddingLeft: 48 }}>
                    {grp.reels.sort((a, b) => Number(a.weight) - Number(b.weight)).slice(0, 6).map((r) => (
                      <span key={r.id} style={{ background: "#f8f7f4", border: "1px solid #e8e2d8", borderRadius: 4, padding: "2px 6px", fontSize: 11, color: "#3a3a3a", fontWeight: 500 }}>
                        {fmt(r.weight)}
                      </span>
                    ))}
                    {grp.reels.length > 6 && <span style={{ fontSize: 11, color: "#9a9080" }}>+{grp.reels.length - 6} more</span>}
                    <span style={{ fontSize: 11, color: "#9a9080", marginLeft: 4 }}>· {fmt(totalWtGrp)} kg</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── SELL ─────────────────────────────────────────────────────────────────────
function SellTab({ state, update }) {
  const [productTab, setProductTab] = useState("reels"); // "reels" | "liner"
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(today());
  const [transportBy, setTransportBy] = useState("");
  const [chargeTransport, setChargeTransport] = useState(true);
  const [transportCharge, setTransportCharge] = useState("");

  const SELF_CASH = ["self", "cash"]; // transporters that never get charged to customer

  const suggestedChallan = (() => {
    const last = state.stock
      .filter(r => r.sold && r.soldChallanNo && r.soldDate)
      .sort((a, b) => new Date(b.soldDate) - new Date(a.soldDate))[0]?.soldChallanNo || "";
    if (!last) return "";
    const m = last.match(/^(.*?)(\d+)$/);
    return m ? m[1] + (parseInt(m[2], 10) + 1) : "";
  })();
  const [challanNo, setChallanNo] = useState(suggestedChallan);
  const [selected, setSelected] = useState([]);
  const [selectedGumIds, setSelectedGumIds] = useState([]);
  const [gumSellRate, setGumSellRate] = useState("");
  const [filter, setFilter] = useState({ bf: "", gsm: "", size: "" });
  const [done, setDone] = useState(null);
  const [sellRates, setSellRates] = useState({}); // "bf|gsm" -> rate string

  const isSelfCash = SELF_CASH.includes(transportBy.trim().toLowerCase());
  const effectiveTransportCharge = (chargeTransport && !isSelfCash) ? (Number(transportCharge) || 0) : 0;

  // Auto-load rates + transport charge from customerData when customer changes
  useEffect(() => {
    if (!customer || !state.customerData?.[customer]) { setSellRates({}); return; }
    const cd = state.customerData[customer];
    const hist = cd?.rateHistory || {};
    const rates = {};
    Object.entries(hist).forEach(([k, arr]) => { if (arr?.length) rates[k] = String(arr[arr.length - 1].rate); });
    setSellRates(rates);
    // Pre-fill transport charge from customer setting
    if (cd?.transportRate) setTransportCharge(String(cd.transportRate));
  }, [customer]);

  const available = state.stock.filter(r => !r.sold);
  const filtered = available.filter(r => {
    if (filter.bf && r.bf !== filter.bf) return false;
    if (filter.gsm && r.gsm !== filter.gsm) return false;
    if (filter.size && String(r.size).replace(/"/g,"").trim() !== filter.size) return false;
    return true;
  }).sort((a, b) => Number(a.size) - Number(b.size) || Number(a.weight) - Number(b.weight));
  const selReels = state.stock.filter(r => selected.includes(r.id));
  const totalWt = selReels.reduce((s, r) => s + Number(r.weight), 0);
  const toggleReel = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  // Compute sale value from sell rates
  const totalValue = selReels.reduce((s, r) => {
    const rate = Number(sellRates[`${r.bf}|${r.gsm}`]) || 0;
    return s + rate * Number(r.weight);
  }, 0);

  // Grades present in selection
  const selGrades = [...new Set(selReels.map(r => `${r.bf}|${r.gsm}`))];

  // GST preview for sell screen
  const gumKgPreview = (state.gumStock||[]).filter(g => selectedGumIds.includes(g.id)).reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
  const gumValPreview = gumSellRate ? gumKgPreview * Number(gumSellRate) : 0;
  const previewCh = { reels: selReels.map(r => ({...r, soldRate: Number(sellRates[`${r.bf}|${r.gsm}`])||0})), gumSacks: (state.gumStock||[]).filter(g => selectedGumIds.includes(g.id)).map(g => ({...g, soldRate: Number(gumSellRate)||0})), transportCharge: effectiveTransportCharge };
  const previewGST = challanGST(previewCh);
  const previewGrand = challanGrandTotal(previewCh);

  const noStockWarning = filter.size && available.filter(r => r.size === filter.size).length === 0
    ? `No ${filter.size}" reels in stock. Please check the size.` : null;

  const sell = () => {
    if (!customer || (selected.length === 0 && selectedGumIds.length === 0)) return;
    const wt = totalWt; const ct = selReels.length; const val = totalValue;
    const gumKg = (state.gumStock||[]).filter(g => selectedGumIds.includes(g.id)).reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
    const gumVal = gumSellRate ? gumKg * Number(gumSellRate) : 0;
    update(s => {
      s.stock = s.stock.map(r => {
        if (!selected.includes(r.id)) return r;
        const soldRate = Number(sellRates[`${r.bf}|${r.gsm}`]) || 0;
        return { ...r, sold: true, soldDate: date, soldTo: customer, soldChallanNo: challanNo, soldRate, transportBy: transportBy.trim() || undefined, transportCharge: effectiveTransportCharge || undefined };
      });
      if (!s.gumStock) s.gumStock = [];
      s.gumStock = s.gumStock.map(g => {
        if (!selectedGumIds.includes(g.id)) return g;
        return { ...g, sold: true, soldDate: date, soldTo: customer, soldChallanNo: challanNo, soldRate: Number(gumSellRate) || 0, transportBy: transportBy.trim() || undefined };
      });
      if (customer.trim() && !(s.customers||[]).some(x=>x.trim().toLowerCase()===customer.trim().toLowerCase())) {
        s.customers = [...(s.customers || []), customer.trim()].sort();
      }
      if (transportBy.trim() && !(s.transporters||[]).some(x=>x.trim().toLowerCase()===transportBy.trim().toLowerCase())) {
        s.transporters = [...(s.transporters || []), transportBy.trim()].sort();
      }
      if (!s.customerData) s.customerData = {};
      if (!s.customerData[customer]) s.customerData[customer] = { rateHistory: {} };
      Object.entries(sellRates).forEach(([k, rate]) => {
        if (!rate) return;
        const hist = s.customerData[customer].rateHistory[k] || [];
        const lastRate = hist.length ? hist[hist.length - 1].rate : null;
        if (String(lastRate) !== String(rate)) {
          s.customerData[customer].rateHistory[k] = [...hist, { rate: Number(rate), from: date }];
        }
      });
      // Auto-create payment entry if customer has creditDays set — amount = grand total WITH GST
      const creditDays = s.customerData[customer]?.creditDays || null;
      if (creditDays && challanNo) {
        if (!s.payments) s.payments = [];
        const alreadyExists = s.payments.some(p => p.challanKey === (challanNo || `__${date}__${customer}`));
        if (!alreadyExists) {
          const reelList = s.stock.filter(r => selected.includes(r.id));
          const gumList = (s.gumStock||[]).filter(g => selectedGumIds.includes(g.id));
          const chObj = { challanNo, date, customer, reels: reelList, gumSacks: gumList, transportCharge: effectiveTransportCharge };
          s.payments = [...s.payments, buildPaymentEntry(chObj, creditDays)];
        }
      }
    });
    setDone({ count: ct, wt, customer, val: val + gumVal, gumCount: selectedGumIds.length, gumKg, gumVal, grandTotal: previewGrand });
  };

  if (done) return (
    <div className="card fade-in" style={{ textAlign: "center", padding: 56 }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>✓</div>
      <div className="serif" style={{ fontSize: 28 }}>Sale Recorded</div>
      <div style={{ fontSize: 13, color: "#888", marginTop: 8 }}>
        {done.count > 0 && <div>{done.count} reels · {fmt(done.wt)} kg</div>}
        {done.gumCount > 0 && <div style={{ marginTop: 4 }}>{done.gumCount} gum sacks · {fmt(done.gumKg)} kg</div>}
        <div style={{ marginTop: 4 }}>{done.grandTotal > 0 ? <><span style={{ color: "#aaa" }}>Ex-GST: {fmtRs(done.val || 0)}</span> · <strong>With GST: {fmtRs(done.grandTotal)}</strong></> : "no rate set"} → {done.customer}</div>
      </div>
      <button className="btn btn-dark" style={{ marginTop: 22 }} onClick={() => { setDone(null); setSelected([]); setSelectedGumIds([]); setGumSellRate(""); setCustomer(""); setChallanNo(suggestedChallan); setSellRates({}); setTransportBy(""); setTransportCharge(""); setChargeTransport(true); }}>Record Another Sale</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      {/* Product switcher */}
      <div style={{ display: "flex", gap: 4, background: "#f5f0e8", borderRadius: 10, padding: 4, alignSelf: "flex-start" }}>
        {[["reels","📦 Reels"], ["liner","📄 Liner"], ["gum","🪣 Gum"]].map(([t, label]) => (
          <button key={t} onClick={() => setProductTab(t)}
            style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: productTab === t ? "#fff" : "transparent", color: productTab === t ? "#1a1a1a" : "#8b6914", fontWeight: productTab === t ? 600 : 400, fontSize: 13, cursor: "pointer", boxShadow: productTab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>
      {productTab === "liner" && <LinerSellTab state={state} update={update} />}
      {productTab === "gum" && <GumSellTab state={state} update={update} />}
      {productTab === "reels" && <>
      <div><div className="section-eyebrow">Dispatch</div><h2>Record a Sale</h2></div>
      <div className="card">
        <h3>Sale Details</h3>
        <div className="g3">
          <div><label className="lbl">Customer Name</label><CustomerInput value={customer} onChange={setCustomer} customers={state.customers || []} /></div>
          <div><label className="lbl">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div>
            <label className="lbl">Challan No{suggestedChallan ? <span style={{ color: "#b8860b", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · auto-suggested</span> : ""}</label>
            <input value={challanNo} onChange={e => setChallanNo(e.target.value)} placeholder="e.g. 313" />
          </div>
        </div>
        {/* Transport section */}
        <div style={{ marginTop: 12 }}>
          <label className="lbl">Transporter <span style={{ fontWeight: 400, color: "#aaa", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
          <TransporterInput value={transportBy} onChange={v => { setTransportBy(v); if (SELF_CASH.includes(v.trim().toLowerCase())) setChargeTransport(false); else setChargeTransport(true); }} transporters={state.transporters || []} />
        </div>
        {/* Transport charge toggle — only show if not self/cash */}
        {transportBy.trim() && !isSelfCash && (
          <div style={{ marginTop: 10, background: "#f9f9f9", borderRadius: 10, padding: "12px 14px", border: "1.5px solid rgba(0,0,0,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: chargeTransport ? 10 : 0 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>Charge transport to customer?</div>
                {!chargeTransport && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>Saboon's trip still counted in his ledger</div>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setChargeTransport(true)} style={{ padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", background: chargeTransport ? "#111" : "#ebebeb", color: chargeTransport ? "#fff" : "#666" }}>Yes</button>
                <button onClick={() => setChargeTransport(false)} style={{ padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", background: !chargeTransport ? "#111" : "#ebebeb", color: !chargeTransport ? "#fff" : "#666" }}>No</button>
              </div>
            </div>
            {chargeTransport && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <label className="lbl">Charge Amount (₹/trip)</label>
                  <input type="number" inputMode="numeric" value={transportCharge} onChange={e => setTransportCharge(e.target.value)} placeholder="e.g. 300" />
                </div>
                {transportCharge && <div style={{ fontSize: 11, color: "#888", paddingTop: 18 }}>+ GST 18% = {fmtRs(Number(transportCharge) * 1.18)}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sell rates per grade */}
      {customer && (
        <div className="card">
          <h3>Selling Rates — ₹/kg {!selGrades.length && <span style={{ fontWeight: 400, color: "#9a9080", fontSize: 11 }}>(select reels to see grades)</span>}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {state.grades.map(g => {
              const k = `${g.bf}|${g.gsm}`;
              const rate = sellRates[k] || "";
              const selKg = selReels.filter(r => r.bf === g.bf && r.gsm === g.gsm).reduce((s, r) => s + Number(r.weight), 0);
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ minWidth: 140, fontSize: 12, fontWeight: 500 }}>{g.bf} BF {g.gsm} GSM</span>
                  <input type="number" step="0.01" inputMode="numeric" value={rate} placeholder="₹/kg"
                    onChange={e => setSellRates(p => ({ ...p, [k]: e.target.value }))}
                    style={{ width: 110 }} />
                  {selKg > 0 && rate && <span style={{ fontSize: 12, color: "#8b6914", fontWeight: 600 }}>{fmtRs(selKg * Number(rate))}</span>}
                  {selKg > 0 && !rate && <span style={{ fontSize: 11, color: "#b0a898", fontStyle: "italic" }}>rate not set</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="card">
        <h3>Select Reels Being Sold</h3>
        <div className="g3" style={{ marginBottom: 12 }}>
          <div>
            <label className="lbl">Grade</label>
            <select value={`${filter.bf}|${filter.gsm}`} onChange={e => { const [bf, gsm] = e.target.value.split("|"); setFilter(f => ({ ...f, bf, gsm })); }}>
              <option value="|">All</option>
              {state.grades.map(g => <option key={g.label} value={`${g.bf}|${g.gsm}`}>{g.bf} BF {g.gsm} GSM</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">Filter by Size</label>
            <select value={filter.size} onChange={e => setFilter(f => ({ ...f, size: e.target.value }))}>
              <option value="">All Sizes</option>{SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}"</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <span style={{ fontSize: 12, color: "#9a9080", paddingBottom: 4 }}>{filtered.length} available · {selected.length} selected</span>
          </div>
        </div>
        {noStockWarning && <div className="err-box" style={{ marginBottom: 12 }}>✗ {noStockWarning}</div>}
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 28, color: "#b0a898" }}><span className="serif-italic">No available stock matching filter.</span></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
            {filtered.map((r, idx) => {
              const sel = selected.includes(r.id);
              return (
                <div key={r.id} onClick={() => toggleReel(r.id)}
                  style={{ cursor: "pointer", background: sel ? "#fdf9f0" : idx % 2 === 0 ? "#fff" : "#faf8f4", borderBottom: idx < filtered.length - 1 ? "1px solid #e8eef8" : "none", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s" }}>
                  <div style={{ width: 20, height: 20, border: `2px solid ${sel ? "#8b6914" : "#ccc8c0"}`, borderRadius: 4, background: sel ? "#8b6914" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.1s" }}>
                    {sel && <span style={{ color: "#fff", fontSize: 11 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span className="serif" style={{ fontSize: 22, lineHeight: 1, color: "#1a1a1a" }}>{r.size}"</span>
                      <span style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1a" }}>{fmt(r.weight)} kg</span>
                      <span className="tag" style={{ fontSize: 10 }}>{r.bf} BF · {r.gsm} GSM</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9a9080" }}>
                      {r.supplier}{r.inwardDate ? ` · ${fmtDate(r.inwardDate)}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* GUM ADD-ON to reel challan */}
      {customer && (
        <GumAddonForChallan state={state} selectedGumIds={selectedGumIds} setSelectedGumIds={setSelectedGumIds} gumSellRate={gumSellRate} setGumSellRate={setGumSellRate} />
      )}

      {(selected.length > 0 || selectedGumIds.length > 0) && (
        <div className="card" style={{ border: "1.5px solid rgba(0,0,0,0.12)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="lbl">Selected for Sale</div>
              {selected.length > 0 && <div style={{ fontSize: 15, fontWeight: 700, color: "#111", lineHeight: 1.2 }}>{selected.length} reels · {fmt(totalWt)} kg{totalValue > 0 ? ` · ${fmtRs(totalValue)}` : ""}</div>}
              {selectedGumIds.length > 0 && (() => {
                const gKg = (state.gumStock||[]).filter(g => selectedGumIds.includes(g.id)).reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
                const gVal = gumSellRate ? gKg * Number(gumSellRate) : 0;
                return <div style={{ fontSize: 13, color: "#4a7a2a", fontWeight: 600, marginTop: 2 }}>{selectedGumIds.length} gum sacks · {fmt(gKg)} kg{gVal > 0 ? ` · ${fmtRs(gVal)}` : ""}</div>;
              })()}
              {/* GST Breakup */}
              {previewGrand > 0 && (
                <div style={{ marginTop: 10, background: "#f9f9f9", borderRadius: 8, padding: "10px 12px" }}>
                  {effectiveTransportCharge > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}><span style={{ color: "#888" }}>Items subtotal</span><span style={{ fontWeight: 600 }}>{fmtRs(challanItemTotal(previewCh))}</span></div>}
                  {effectiveTransportCharge > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}><span style={{ color: "#888" }}>🚚 Transport</span><span style={{ fontWeight: 600 }}>{fmtRs(effectiveTransportCharge)}</span></div>}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}><span style={{ color: "#888" }}>Taxable total</span><span style={{ fontWeight: 600 }}>{fmtRs(challanTaxableAmount(previewCh))}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}><span style={{ color: "#22c55e" }}>CGST {previewCh.gumSacks?.length && !previewCh.reels?.length ? "2.5%" : "9%"}</span><span style={{ fontWeight: 600, color: "#22c55e" }}>+{fmtRs(previewGST.cgst)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}><span style={{ color: "#22c55e" }}>SGST {previewCh.gumSacks?.length && !previewCh.reels?.length ? "2.5%" : "9%"}</span><span style={{ fontWeight: 600, color: "#22c55e" }}>+{fmtRs(previewGST.sgst)}</span></div>
                  <div style={{ borderTop: "1px solid #e8e8e8", paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>Total (with GST)</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#111" }}>{fmtRs(previewGrand)}</span>
                  </div>
                  <div style={{ fontSize: 9, color: "#aaa", textAlign: "right", marginTop: 2 }}>Rounded to nearest ₹1</div>
                </div>
              )}
              {!customer && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 6 }}>Enter customer name to confirm.</div>}
            </div>
            <button className="btn btn-dark" style={{ fontSize: 13, padding: "11px 22px" }} onClick={sell} disabled={!customer || (selected.length === 0 && selectedGumIds.length === 0)}>✓ Confirm Sale</button>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}

// ─── LINER STOCK TAB ─────────────────────────────────────────────────────────
function LinerStockTab({ state, update, isEmployee }) {
  const [view, setView] = useState("list");
  const [conversionForm, setConversionForm] = useState({ labourRate: "", corrugator: "", date: today(), transportBy: "" });
  // Multi-reel conversion: map of reelId -> [{id, weight}]
  const [convReelWeights, setConvReelWeights] = useState({});
  const [selectedReelIds, setSelectedReelIds] = useState([]);
  const [convFilter, setConvFilter] = useState({ bf: "", gsm: "", size: "" });
  const [convSaved, setConvSaved] = useState(false);
  // Liner inward form
  const [linerInwardSaved, setLinerInwardSaved] = useState(false);
  const [linerInwardForm, setLinerInwardForm] = useState({ supplier: "", date: today(), bf: "18", gsm: "150", size: "36", slabMode: false, simpleRate: "", slabs: [{ id: genId(), kg: "", rate: "" }] });
  const [linerInwardWeights, setLinerInwardWeights] = useState([{ id: genId(), weight: "" }]);

  const availableReels = state.stock.filter(r => !r.sold && r.productType !== "liner" && !r.converted);
  const availableLiners = state.stock.filter(r => !r.sold && r.productType === "liner");
  const allLiners = state.stock.filter(r => r.productType === "liner");

  const conversionBatches = {};
  allLiners.forEach(r => {
    const bk = r.conversionBatchId || r.id;
    if (!conversionBatches[bk]) conversionBatches[bk] = { id: bk, date: r.conversionDate, corrugator: r.corrugator, labourRate: r.labourRate, sourceSpec: `${r.bf} BF ${r.gsm} GSM ${r.size}"`, liners: [] };
    conversionBatches[bk].liners.push(r);
  });

  const linerGroups = {};
  availableLiners.forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.size}`;
    if (!linerGroups[k]) linerGroups[k] = { bf: r.bf, gsm: r.gsm, size: r.size, liners: [] };
    linerGroups[k].liners.push(r);
  });

  // Filter reels for convert view
  const filteredReels = availableReels.filter(r => {
    if (convFilter.bf && r.bf !== convFilter.bf) return false;
    if (convFilter.gsm && r.gsm !== convFilter.gsm) return false;
    if (convFilter.size && r.size !== convFilter.size) return false;
    return true;
  });

  // Group filtered reels by size for display
  const reelsBySize = {};
  filteredReels.forEach(r => {
    const k = `${r.size}|${r.bf}|${r.gsm}`;
    if (!reelsBySize[k]) reelsBySize[k] = { size: r.size, bf: r.bf, gsm: r.gsm, reels: [] };
    reelsBySize[k].reels.push(r);
  });

  const toggleReelSelect = (id) => {
    setSelectedReelIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    setConvReelWeights(p => {
      if (p[id]) { const n = { ...p }; delete n[id]; return n; }
      return { ...p, [id]: [{ id: genId(), weight: "" }] };
    });
  };

  const addLinerRow = (reelId) => setConvReelWeights(p => ({ ...p, [reelId]: [...(p[reelId] || []), { id: genId(), weight: "" }] }));
  const removeLinerRow = (reelId, lwId) => setConvReelWeights(p => ({ ...p, [reelId]: p[reelId].filter(x => x.id !== lwId) }));
  const updateLinerWeight = (reelId, lwId, val) => setConvReelWeights(p => ({ ...p, [reelId]: p[reelId].map(x => x.id === lwId ? { ...x, weight: val } : x) }));

  const totalLinersAcrossAll = Object.values(convReelWeights).flat().filter(x => x.weight).length;

  const saveConversion = () => {
    if (selectedReelIds.length === 0 || totalLinersAcrossAll === 0) return;
    const batchId = genId();
    const labourRate = Number(conversionForm.labourRate) || 0;
    const allNewLiners = [];
    const reelIdsToMark = [];
    selectedReelIds.forEach(reelId => {
      const reel = state.stock.find(r => r.id === reelId);
      if (!reel) return;
      const validLiners = (convReelWeights[reelId] || []).filter(x => x.weight && !isNaN(x.weight));
      if (validLiners.length === 0) return;
      reelIdsToMark.push(reelId);
      const effectiveCostRate = (Number(reel.costRate) || 0) + labourRate;
      validLiners.forEach(lw => {
        allNewLiners.push({
          id: genId(), productType: "liner",
          bf: reel.bf, gsm: reel.gsm, size: reel.size, shade: reel.shade || "golden",
          weight: lw.weight, sourceReelId: reelId, conversionBatchId: batchId,
          conversionDate: conversionForm.date, corrugator: conversionForm.corrugator,
          labourRate, costRate: effectiveCostRate,
          inwardDate: reel.inwardDate, supplier: reel.supplier, sold: false,
          conversionTransportBy: conversionForm.transportBy.trim() || undefined,
        });
      });
    });
    update(s => {
      s.stock = s.stock.map(r => reelIdsToMark.includes(r.id) ? { ...r, converted: true, conversionBatchId: batchId, conversionDate: conversionForm.date } : r);
      s.stock = [...s.stock, ...allNewLiners];
      if (conversionForm.transportBy.trim() && !(s.transporters||[]).some(x=>x.trim().toLowerCase()===conversionForm.transportBy.trim().toLowerCase())) {
        s.transporters = [...(s.transporters || []), conversionForm.transportBy.trim()].sort();
      }
    });
    setConvSaved(true);
    setSelectedReelIds([]);
    setConvReelWeights({});
    setConversionForm({ labourRate: "", corrugator: "", date: today(), transportBy: "" });
    setView("list");
    setTimeout(() => setConvSaved(false), 2500);
  };

  // ── LINER INWARD VIEW ──
  if (view === "linerInward") {
    const totalInwardKg = linerInwardWeights.filter(x => x.weight).reduce((s, x) => s + Number(x.weight), 0);
    const saveLinerInward = () => {
      const valid = linerInwardWeights.filter(x => x.weight && !isNaN(x.weight));
      if (valid.length === 0) return;
      const totalKg = valid.reduce((s, x) => s + Number(x.weight), 0);
      const costRate = linerInwardForm.slabMode
        ? computeWeightedCostRate(linerInwardForm.slabs, totalKg)
        : Number(linerInwardForm.simpleRate) || 0;
      const newLiners = valid.map(lw => ({
        id: genId(), productType: "liner", linerSource: "inward",
        bf: linerInwardForm.bf, gsm: linerInwardForm.gsm, size: linerInwardForm.size,
        shade: "golden", weight: lw.weight,
        supplier: linerInwardForm.supplier, inwardDate: linerInwardForm.date,
        costRate, sold: false,
      }));
      update(s => { s.stock = [...s.stock, ...newLiners]; });
      setLinerInwardSaved(true);
      setLinerInwardWeights([{ id: genId(), weight: "" }]);
      setLinerInwardForm(f => ({ ...f, supplier: "", simpleRate: "", slabs: [{ id: genId(), kg: "", rate: "" }] }));
      setView("list");
      setTimeout(() => setLinerInwardSaved(false), 2500);
    };
    const lif = linerInwardForm;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setView("list")}>← Back</button>
          <div><div className="section-eyebrow">Liner</div><h2>Add Liner Inward</h2></div>
        </div>
        <div className="card">
          <h3>Liner Details</h3>
          <div className="g3" style={{ marginBottom: 12 }}>
            <div><label className="lbl">Supplier</label>
              <input value={lif.supplier} onChange={e => setLinerInwardForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier / Corrugator name" />
            </div>
            <div><label className="lbl">Date</label>
              <input type="date" value={lif.date} onChange={e => setLinerInwardForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div><label className="lbl">Size (inches)</label>
              <select value={lif.size} onChange={e => setLinerInwardForm(f => ({ ...f, size: e.target.value }))}>
                {SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}"</option>)}
              </select>
            </div>
            <div><label className="lbl">BF</label>
              <select value={lif.bf} onChange={e => setLinerInwardForm(f => ({ ...f, bf: e.target.value }))}>
                {LINER_BF_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div><label className="lbl">GSM</label>
              <select value={lif.gsm} onChange={e => setLinerInwardForm(f => ({ ...f, gsm: e.target.value }))}>
                {LINER_GSM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="sep" />
          <h3>Buying Cost</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setLinerInwardForm(f => ({ ...f, slabMode: false }))} className={`btn btn-sm ${!lif.slabMode ? "btn-dark" : "btn-outline"}`}>Simple Rate</button>
            <button onClick={() => setLinerInwardForm(f => ({ ...f, slabMode: true }))} className={`btn btn-sm ${lif.slabMode ? "btn-dark" : "btn-outline"}`}>Split Rate</button>
          </div>
          {!lif.slabMode ? (
            <div style={{ maxWidth: 200 }}>
              <label className="lbl">Rate (₹/kg)</label>
              <input type="number" inputMode="numeric" value={lif.simpleRate} onChange={e => setLinerInwardForm(f => ({ ...f, simpleRate: e.target.value }))} placeholder="e.g. 28" />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ fontSize: 12, color: "#9a9080" }}>Enter kg thresholds and rates for split pricing.</p>
              {lif.slabs.map((slab, si) => (
                <div key={slab.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#8b6914", minWidth: 60 }}>Slab {si + 1}</span>
                  {si < lif.slabs.length - 1 && <div style={{ maxWidth: 120 }}><input type="number" inputMode="numeric" value={slab.kg} onChange={e => setLinerInwardForm(f => ({ ...f, slabs: f.slabs.map((x, i) => i === si ? { ...x, kg: e.target.value } : x) }))} placeholder="up to kg" /></div>}
                  {si === lif.slabs.length - 1 && <div style={{ maxWidth: 120 }}><input disabled value="remainder" style={{ color: "#9a9080" }} /></div>}
                  <div style={{ maxWidth: 120 }}><input type="number" inputMode="numeric" value={slab.rate} onChange={e => setLinerInwardForm(f => ({ ...f, slabs: f.slabs.map((x, i) => i === si ? { ...x, rate: e.target.value } : x) }))} placeholder="₹/kg" /></div>
                  {lif.slabs.length > 1 && <button onClick={() => setLinerInwardForm(f => ({ ...f, slabs: f.slabs.filter((_, i) => i !== si) }))} style={{ background: "transparent", color: "#b83020", border: "none", cursor: "pointer", fontSize: 16 }}>✕</button>}
                </div>
              ))}
              <button onClick={() => setLinerInwardForm(f => ({ ...f, slabs: [...f.slabs, { id: genId(), kg: "", rate: "" }] }))} className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }}>+ Add Slab</button>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Individual Liner Weights</h3>
          <p style={{ fontSize: 12, color: "#9a9080", marginBottom: 12 }}>Enter the weight of each liner piece.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {linerInwardWeights.map((lw, li) => (
              <div key={lw.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#b0a898", minWidth: 24 }}>#{li + 1}</span>
                <input type="number" inputMode="numeric" value={lw.weight}
                  onChange={e => setLinerInwardWeights(p => p.map(x => x.id === lw.id ? { ...x, weight: e.target.value } : x))}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setLinerInwardWeights(p => [...p, { id: genId(), weight: "" }]); } }}
                  placeholder="kg" style={{ maxWidth: 120 }} autoFocus={li === linerInwardWeights.length - 1 && li > 0} />
                <span style={{ fontSize: 11, color: "#9a9080" }}>kg</span>
                {linerInwardWeights.length > 1 && <button onClick={() => setLinerInwardWeights(p => p.filter(x => x.id !== lw.id))} style={{ background: "transparent", color: "#b83020", border: "none", cursor: "pointer", fontSize: 14 }}>✕</button>}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setLinerInwardWeights(p => [...p, { id: genId(), weight: "" }])} className="btn btn-outline btn-sm">+ Add Liner</button>
            {totalInwardKg > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{linerInwardWeights.filter(x => x.weight).length} liners · {fmt(Math.round(totalInwardKg))} kg total</span>}
            {totalInwardKg > 0 && (lif.simpleRate || lif.slabMode) && (() => {
              const rate = lif.slabMode ? computeWeightedCostRate(lif.slabs, totalInwardKg) : Number(lif.simpleRate) || 0;
              return rate > 0 ? <span style={{ fontSize: 13, color: "#8b6914", fontWeight: 600 }}>· {fmtRs(rate * totalInwardKg)} cost</span> : null;
            })()}
          </div>
        </div>

        <button className="btn btn-dark" onClick={saveLinerInward} disabled={linerInwardWeights.filter(x => x.weight).length === 0} style={{ alignSelf: "flex-start" }}>
          ✓ Save {linerInwardWeights.filter(x => x.weight).length} Liner{linerInwardWeights.filter(x => x.weight).length !== 1 ? "s" : ""} to Stock
        </button>
      </div>
    );
  }

  // ── CONVERT VIEW ──
  if (view === "convert") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 100 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => { setView("list"); setSelectedReelIds([]); setConvReelWeights({}); }}>← Back</button>
          <div><div className="section-eyebrow">Conversion</div><h2>Convert Reels → Liners</h2></div>
        </div>

        {/* Conversion details (sticky top) */}
        <div className="card">
          <h3>Conversion Details — applies to all selected reels</h3>
          <div className="g3">
            <div><label className="lbl">Corrugator Name</label>
              <input value={conversionForm.corrugator} onChange={e => setConversionForm(f => ({ ...f, corrugator: e.target.value }))} placeholder="e.g. Ravi Corrugators" />
            </div>
            <div><label className="lbl">Labour Rate (₹/kg output)</label>
              <input type="number" inputMode="numeric" value={conversionForm.labourRate} onChange={e => setConversionForm(f => ({ ...f, labourRate: e.target.value }))} placeholder="e.g. 4" />
            </div>
            <div><label className="lbl">Conversion Date</label>
              <input type="date" value={conversionForm.date} onChange={e => setConversionForm(f => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="lbl">Transport By (reels to corrugator) <span style={{ fontWeight: 400, color: "#b0a898", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
            <TransporterInput value={conversionForm.transportBy} onChange={v => setConversionForm(f => ({ ...f, transportBy: v }))} transporters={state.transporters || []} />
          </div>
        </div>

        {/* Filter bar */}
        <div className="card" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ minWidth: 120 }}>
              <label className="lbl">Grade</label>
              <select value={`${convFilter.bf}|${convFilter.gsm}`} onChange={e => { const [bf, gsm] = e.target.value.split("|"); setConvFilter(f => ({ ...f, bf, gsm })); }}>
                <option value="|">All grades</option>
                {state.grades.map(g => <option key={g.label} value={`${g.bf}|${g.gsm}`}>{g.bf} BF {g.gsm} GSM</option>)}
              </select>
            </div>
            <div style={{ minWidth: 100 }}>
              <label className="lbl">Size</label>
              <select value={convFilter.size} onChange={e => setConvFilter(f => ({ ...f, size: e.target.value }))}>
                <option value="">All sizes</option>
                {[...new Set(availableReels.map(r => r.size))].sort((a, b) => Number(a) - Number(b)).map(s => <option key={s} value={s}>{s}"</option>)}
              </select>
            </div>
            <div style={{ fontSize: 12, color: "#9a9080", paddingBottom: 4 }}>
              {filteredReels.length} reels · {selectedReelIds.length} selected
            </div>
          </div>
        </div>

        {/* Reels grouped by size — with weight chips */}
        {Object.values(reelsBySize).sort((a, b) => Number(a.size) - Number(b.size)).map(grp => (
          <div key={`${grp.size}|${grp.bf}|${grp.gsm}`} className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span className="serif" style={{ fontSize: 22 }}>{grp.size}"</span>
              <span className="tag">{grp.bf} BF · {grp.gsm} GSM</span>
              <span style={{ fontSize: 11, color: "#9a9080" }}>{grp.reels.length} reel{grp.reels.length !== 1 ? "s" : ""}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {grp.reels.sort((a, b) => Number(a.weight) - Number(b.weight)).map((r, idx) => {
                const sel = selectedReelIds.includes(r.id);
                const reelLiners = convReelWeights[r.id] || [];
                const reelLinerWt = reelLiners.filter(x => x.weight).reduce((s, x) => s + Number(x.weight), 0);
                const diff = Number(r.weight) - reelLinerWt;
                return (
                  <div key={r.id} style={{ border: `2px solid ${sel ? "#8b6914" : "#e8e2d8"}`, borderRadius: 12, padding: "10px 12px", background: sel ? "#fdf9f0" : "#faf8f4", minWidth: 160, flex: "1 1 160px", maxWidth: 260 }}>
                    {/* Reel header — click to select */}
                    <div onClick={() => toggleReelSelect(r.id)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, marginBottom: sel ? 10 : 0 }}>
                      <div style={{ width: 20, height: 20, border: `2px solid ${sel ? "#8b6914" : "#ccc8c0"}`, borderRadius: 4, background: sel ? "#8b6914" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {sel && <span style={{ color: "#fff", fontSize: 11 }}>✓</span>}
                      </div>
                      <div>
                        <div className="serif" style={{ fontSize: 20, lineHeight: 1 }}>{fmt(r.weight)} kg</div>
                        <div style={{ fontSize: 10, color: "#9a9080", marginTop: 2 }}>{fmtDate(r.inwardDate)} · {r.supplier || "—"}</div>
                      </div>
                    </div>
                    {/* Liner weights entry — only when selected */}
                    {sel && (
                      <div>
                        <div style={{ fontSize: 10, color: "#8b6914", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                          Output liner weights
                          {reelLinerWt > 0 && <span style={{ color: diff >= 0 ? "#2d6a4f" : "#b83020", marginLeft: 8, fontWeight: 600 }}>
                            {fmt(reelLinerWt)} kg{diff >= 0 ? ` (${fmt(diff.toFixed(1))} waste)` : ` ⚠ over by ${fmt(Math.abs(diff).toFixed(1))}`}
                          </span>}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                          {reelLiners.map((lw, li) => (
                            <div key={lw.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <span style={{ fontSize: 10, color: "#b0a898", minWidth: 18 }}>#{li + 1}</span>
                              <input type="number" inputMode="numeric" value={lw.weight}
                                onChange={e => updateLinerWeight(r.id, lw.id, e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLinerRow(r.id); } }}
                                placeholder="kg" style={{ width: 80, padding: "3px 6px", fontSize: 12 }}
                                autoFocus={li === reelLiners.length - 1 && li > 0} />
                              <span style={{ fontSize: 10, color: "#9a9080" }}>kg</span>
                              {reelLiners.length > 1 && <button onClick={() => removeLinerRow(r.id, lw.id)} style={{ background: "transparent", color: "#b83020", border: "none", fontSize: 13, cursor: "pointer", lineHeight: 1 }}>✕</button>}
                            </div>
                          ))}
                        </div>
                        <button onClick={() => addLinerRow(r.id)} style={{ fontSize: 11, background: "transparent", border: "1px solid #e5dece", borderRadius: 5, padding: "3px 8px", cursor: "pointer", color: "#8b6914" }}>+ liner</button>
                        {/* Total liner weight for this reel — always visible when selected */}
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e8e2d8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "#6a6050", fontWeight: 600 }}>
                            Output: <span style={{ color: reelLinerWt > 0 ? "#1a1a1a" : "#b0a898" }}>{reelLinerWt > 0 ? `${fmt(reelLinerWt)} kg` : "—"}</span>
                          </span>
                          {reelLinerWt > 0 && <span style={{ fontSize: 10, color: diff >= 0 ? "#2d6a4f" : "#b83020", fontWeight: 600 }}>
                            {diff >= 0 ? `${fmt(diff.toFixed(1))} waste` : `⚠ over ${fmt(Math.abs(diff).toFixed(1))}`}
                          </span>}
                        </div>
                        {conversionForm.labourRate > 0 && reelLinerWt > 0 && (
                          <div style={{ fontSize: 10, color: "#2d6a4f", marginTop: 4, fontWeight: 600 }}>
                            Labour: {fmtRs(Number(conversionForm.labourRate) * reelLinerWt)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filteredReels.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: 32 }}>
            <span className="serif-italic" style={{ fontSize: 15, color: "#b0a898" }}>No reels match the filter.</span>
          </div>
        )}

        {/* Sticky save bar */}
        <div style={{ position: "sticky", bottom: 0, background: "#f8f7f4", padding: "10px 0 0" }}>
          <div className="card" style={{ borderTop: "2px solid #e8e2d8", boxShadow: "0 -4px 20px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, color: "#6a6050" }}>
                <strong>{selectedReelIds.length}</strong> reels · <strong>{totalLinersAcrossAll}</strong> liners
                {(() => {
                  const totalOutputKg = Object.values(convReelWeights).flat().filter(x => x.weight).reduce((s, x) => s + Number(x.weight), 0);
                  return totalOutputKg > 0 ? <span style={{ fontWeight: 600, color: "#1a1a1a", marginLeft: 6 }}>· {fmt(totalOutputKg)} kg output</span> : null;
                })()}
                {conversionForm.labourRate > 0 && totalLinersAcrossAll > 0 && (() => {
                  const totalOutputKg = Object.values(convReelWeights).flat().filter(x => x.weight).reduce((s, x) => s + Number(x.weight), 0);
                  return <span style={{ color: "#2d6a4f", fontWeight: 600, marginLeft: 6 }}>· Labour: {fmtRs(Number(conversionForm.labourRate) * totalOutputKg)}</span>;
                })()}
              </div>
              <button className="btn btn-dark" onClick={saveConversion} disabled={selectedReelIds.length === 0 || totalLinersAcrossAll === 0}>
                ✓ Save {totalLinersAcrossAll} Liner{totalLinersAcrossAll !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── CONVERSION HISTORY VIEW ──
  if (view === "convertHistory") {
    const batches = Object.values(conversionBatches).sort((a, b) => new Date(b.date) - new Date(a.date));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setView("list")}>← Back</button>
          <div><div className="section-eyebrow">Liner</div><h2>Conversion History</h2></div>
        </div>
        {batches.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <span className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>No conversions recorded yet.</span>
          </div>
        ) : (
          <div className="card-flat">
            {batches.map((batch, idx) => {
              const totalWt = batch.liners.reduce((s, r) => s + Number(r.weight), 0);
              const soldCount = batch.liners.filter(r => r.sold).length;
              const availCount = batch.liners.filter(r => !r.sold).length;
              const labourCost = (batch.labourRate || 0) * totalWt;
              return (
                <div key={batch.id} style={{ padding: "14px 18px", borderBottom: idx < batches.length - 1 ? "1px solid #e8eef8" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <span className="serif" style={{ fontSize: 20 }}>{batch.sourceSpec}</span>
                    <span className="tag tag-green">{batch.liners.length} liners</span>
                    {soldCount > 0 && <span className="tag tag-red">{soldCount} sold</span>}
                    <span style={{ fontSize: 11, color: "#9a9080", marginLeft: "auto" }}>{fmtDate(batch.date)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 12, color: "#6a6050", flexWrap: "wrap" }}>
                    {batch.corrugator && <span>📍 {batch.corrugator}</span>}
                    {batch.labourRate > 0 && <span>Labour: {fmtRate(batch.labourRate)}/kg · {fmtRs(labourCost)} total</span>}
                    <span>{fmt(totalWt)} kg output · {availCount} available</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                    {batch.liners.sort((a, b) => Number(a.weight) - Number(b.weight)).map(r => (
                      <span key={r.id} style={{ background: r.sold ? "#fef0ee" : "#edf7f0", border: `1px solid ${r.sold ? "#f0c0ba" : "#b5dcc0"}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, color: r.sold ? "#9a4030" : "#2d6a4f", fontWeight: 500 }}>
                        {fmt(r.weight)} kg{r.sold ? " · sold" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── MAIN LINER LIST VIEW ──
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      {convSaved && <div className="ok-box">✓ Conversion saved! Liners added to stock.</div>}
      {linerInwardSaved && <div className="ok-box">✓ Liner inward saved! Added to stock.</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div><div className="section-eyebrow">Liner Inventory</div><h2>Liner Stock</h2></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isEmployee && <button className="btn btn-outline" onClick={() => setView("convertHistory")}>🔄 Conversion History</button>}
          {!isEmployee && <button className="btn btn-outline" onClick={() => setView("linerInward")}>+ Add Liner Inward</button>}
          {!isEmployee && availableReels.length > 0 && (
            <button className="btn btn-dark" onClick={() => setView("convert")}>🔄 Convert Reels</button>
          )}
        </div>
      </div>

      {/* Liner stock by spec */}
      {Object.keys(linerGroups).length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
          <div className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>No liner stock yet.</div>
          <div style={{ fontSize: 13, color: "#b0a898", marginTop: 6 }}>
            {availableReels.length > 0 ? <><button className="btn btn-dark btn-sm" onClick={() => setView("convert")} style={{ marginRight: 8 }}>Convert reels</button><button className="btn btn-outline btn-sm" onClick={() => setView("linerInward")}>Add Liner Inward</button></> : <button className="btn btn-outline btn-sm" onClick={() => setView("linerInward")}>Add Liner Inward</button>}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 13, color: "#6a6050", fontWeight: 500 }}>
            {availableLiners.length} liners available · {fmt(availableLiners.reduce((s, r) => s + Number(r.weight), 0))} kg
            {(() => {
              const allLiners = state.stock.filter(r => r.productType === "liner");
              const allKg = allLiners.reduce((s, r) => s + Number(r.weight), 0);
              const soldLiners = allLiners.filter(r => r.sold);
              return soldLiners.length > 0 ? <span style={{ color: "#b0a898", marginLeft: 8 }}>· {allLiners.length} total · {fmt(allKg)} kg combined</span> : null;
            })()}
          </div>
          {Object.values(linerGroups).sort((a, b) => Number(a.size) - Number(b.size)).map(grp => {
            const totalWt = grp.liners.reduce((s, r) => s + Number(r.weight), 0);
            return (
              <div key={`${grp.bf}|${grp.gsm}|${grp.size}`} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="serif" style={{ fontSize: 22 }}>{grp.size}"</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{grp.bf} BF · {grp.gsm} GSM</span>
                    <span className="tag tag-green">{grp.liners.length} liner{grp.liners.length !== 1 ? "s" : ""}</span>
                    {grp.liners.some(r => r.linerSource === "inward") && <span style={{ fontSize: 9, background: "#edf5ff", border: "1px solid #b0ccee", borderRadius: 3, padding: "1px 5px", color: "#2a5a8a" }}>{grp.liners.filter(r => r.linerSource === "inward").length} bought</span>}
                    {grp.liners.some(r => r.linerSource !== "inward") && <span style={{ fontSize: 9, background: "#f5f0e8", border: "1px solid #e5dece", borderRadius: 3, padding: "1px 5px", color: "#6a6050" }}>{grp.liners.filter(r => r.linerSource !== "inward").length} converted</span>}
                  </div>
                  <span style={{ fontSize: 12, color: "#6a6050", fontWeight: 600 }}>{fmt(totalWt)} kg</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {grp.liners.sort((a, b) => Number(a.weight) - Number(b.weight)).map((r, idx) => (
                    <EditableLinerWeight key={r.id} liner={r} idx={idx} update={update} />
                  ))}
                </div>
                {/* Total weight below liner chips */}
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #e8e2d8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#9a9080" }}>{grp.liners.length} liner{grp.liners.length !== 1 ? "s" : ""}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>{fmt(totalWt)} kg total</span>
                </div>
              </div>
            );
          })}
          {/* Collective total of all liner groups */}
          {(() => {
            const allGrpLiners = Object.values(linerGroups).flatMap(g => g.liners);
            const totalAllKg = allGrpLiners.reduce((s, r) => s + Number(r.weight), 0);
            return allGrpLiners.length > 1 ? (
              <div style={{ padding: "12px 18px", background: "#1a1a1a", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#9a9080" }}>{allGrpLiners.length} liners across all grades</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "'Playfair Display', serif" }}>{fmt(totalAllKg)} kg total output</span>
              </div>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}

// ─── EDITABLE LINER WEIGHT CHIP ───────────────────────────────────────────────
function EditableLinerWeight({ liner, idx, update }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(liner.weight));
  const [confirmDel, setConfirmDel] = useState(false);
  const save = () => {
    if (!val || isNaN(val)) { setEditing(false); return; }
    update(s => { const i = s.stock.findIndex(x => x.id === liner.id); if (i !== -1) s.stock[i].weight = val; });
    setEditing(false);
  };
  const deleteLiner = () => {
    update(s => { s.stock = s.stock.filter(x => x.id !== liner.id); });
    setConfirmDel(false);
  };
  return (
    <div style={{ background: "#f9f9f9", border: `1.5px solid ${editing ? "#b8860b" : "rgba(0,0,0,0.08)"}`, borderRadius: 8, padding: "7px 10px", textAlign: "center", minWidth: 80, position: "relative" }}>
      {confirmDel ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          <div style={{ fontSize: 9, color: "#c62828", fontWeight: 700 }}>Delete?</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={deleteLiner} style={{ background: "#c62828", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>Yes</button>
            <button onClick={() => setConfirmDel(false)} style={{ background: "#eee", color: "#666", border: "none", borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}>No</button>
          </div>
        </div>
      ) : editing ? (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="number" inputMode="numeric" value={val} onChange={e => setVal(e.target.value)}
            style={{ width: 70, padding: "3px 6px", fontSize: 12, textAlign: "center" }}
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            onBlur={save}
          />
          <span style={{ fontSize: 10, color: "#aaa" }}>kg</span>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: "#bbb", marginBottom: 2 }}>#{idx + 1}</div>
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{fmt(liner.weight)}</div>
          <div style={{ fontSize: 10, color: "#aaa" }}>kg</div>
          <div style={{ display: "flex", gap: 3, marginTop: 4, justifyContent: "center" }}>
            <button onClick={() => { setEditing(true); setVal(String(liner.weight)); }}
              style={{ background: "transparent", color: "#b8860b", border: "1px solid #e8d48a", borderRadius: 4, padding: "2px 5px", fontSize: 9, cursor: "pointer" }}>
              Edit
            </button>
            <button onClick={() => setConfirmDel(true)}
              style={{ background: "transparent", color: "#c62828", border: "1px solid #f48fb1", borderRadius: 4, padding: "2px 5px", fontSize: 9, cursor: "pointer" }}>
              Del
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── LINER SELL TAB ───────────────────────────────────────────────────────────
function LinerSellTab({ state, update }) {
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(today());
  const [filter, setFilter] = useState({ bf: "", gsm: "", size: "" });
  const [selected, setSelected] = useState([]);
  const [sellRate, setSellRate] = useState("");
  const [done, setDone] = useState(null);
  const [transportBy, setTransportBy] = useState("");

  // Shared challan sequence across reels + liner
  const suggestedChallan = (() => {
    const last = state.stock
      .filter(r => r.sold && r.soldChallanNo && r.soldDate)
      .sort((a, b) => new Date(b.soldDate) - new Date(a.soldDate))[0]?.soldChallanNo || "";
    if (!last) return "";
    const m = last.match(/^(.*?)(\d+)$/);
    return m ? m[1] + (parseInt(m[2], 10) + 1) : "";
  })();
  const [challanNo, setChallanNo] = useState(suggestedChallan);

  const availableLiners = state.stock.filter(r => !r.sold && r.productType === "liner");
  const filtered = availableLiners.filter(r => {
    if (filter.bf && r.bf !== filter.bf) return false;
    if (filter.gsm && r.gsm !== filter.gsm) return false;
    if (filter.size && r.size !== filter.size) return false;
    return true;
  }).sort((a, b) => Number(a.size) - Number(b.size) || Number(a.weight) - Number(b.weight));

  const selLiners = state.stock.filter(r => selected.includes(r.id));
  const totalWt = selLiners.reduce((s, r) => s + Number(r.weight), 0);
  const totalValue = sellRate ? Number(sellRate) * totalWt : 0;
  const toggleLiner = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  // Editable weight for selected liners before confirming challan
  const [pendingWeights, setPendingWeights] = useState({}); // id -> weight override
  const getWeight = (r) => pendingWeights[r.id] !== undefined ? pendingWeights[r.id] : String(r.weight);
  const effectiveWt = selLiners.reduce((s, r) => s + Number(getWeight(r)), 0);
  const effectiveValue = sellRate ? Number(sellRate) * effectiveWt : 0;

  const sell = () => {
    if (!customer || selected.length === 0) return;
    update(s => {
      s.stock = s.stock.map(r => {
        if (!selected.includes(r.id)) return r;
        const wt = pendingWeights[r.id] !== undefined ? pendingWeights[r.id] : r.weight;
        return { ...r, sold: true, soldDate: date, soldTo: customer, soldChallanNo: challanNo, soldRate: Number(sellRate) || 0, weight: wt, transportBy: transportBy.trim() || undefined };
      });
      if (customer.trim() && !(s.linerCustomers || []).includes(customer.trim())) {
        s.linerCustomers = [...(s.linerCustomers || []), customer.trim()].sort();
      }
      if (transportBy.trim() && !(s.transporters||[]).some(x=>x.trim().toLowerCase()===transportBy.trim().toLowerCase())) {
        s.transporters = [...(s.transporters || []), transportBy.trim()].sort();
      }
      // Auto-create payment entry
      const creditDays = s.customerData?.[customer]?.creditDays || null;
      if (creditDays && challanNo) {
        if (!s.payments) s.payments = [];
        const challanKey = challanNo || `__${date}__${customer}`;
        if (!s.payments.some(p => p.challanKey === challanKey)) {
          const linerList = s.stock.filter(r => selected.includes(r.id));
          const chObj = { challanNo, date, customer, reels: linerList, gumSacks: [] };
          s.payments = [...s.payments, buildPaymentEntry(chObj, creditDays)];
        }
      }
    });
    setDone({ count: selected.length, wt: effectiveWt, customer, val: effectiveValue });
  };

  if (done) return (
    <div className="card fade-in" style={{ textAlign: "center", padding: 56 }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>✓</div>
      <div className="serif" style={{ fontSize: 28 }}>Liner Sale Recorded</div>
      <div style={{ fontSize: 13, color: "#8a8070", marginTop: 8 }}>{done.count} liners · {fmt(done.wt)} kg{done.val ? ` · ${fmtRs(done.val)}` : ""} → {done.customer}</div>
      <button className="btn btn-dark" style={{ marginTop: 22 }} onClick={() => { setDone(null); setSelected([]); setCustomer(""); setChallanNo(suggestedChallan); setSellRate(""); setPendingWeights({}); }}>Record Another Sale</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div><div className="section-eyebrow">Liner Dispatch</div><h2>Sell Liners</h2></div>

      <div className="card">
        <h3>Sale Details</h3>
        <div className="g3">
          <div>
            <label className="lbl">Customer Name</label>
            <CustomerInput value={customer} onChange={setCustomer} customers={state.linerCustomers || []} placeholder="Liner buyer name" />
          </div>
          <div><label className="lbl">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div>
            <label className="lbl">Challan No{suggestedChallan ? <span style={{ color: "#8b6914", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · shared seq.</span> : ""}</label>
            <input value={challanNo} onChange={e => setChallanNo(e.target.value)} placeholder="e.g. 314" />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label className="lbl">Transport By <span style={{ fontWeight: 400, color: "#b0a898", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
          <TransporterInput value={transportBy} onChange={setTransportBy} transporters={state.transporters || []} />
        </div>
      </div>

      {customer && (
        <div className="card">
          <h3>Selling Rate — ₹/kg</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="number" step="0.01" inputMode="numeric" value={sellRate} onChange={e => setSellRate(e.target.value)} placeholder="e.g. 41" style={{ width: 120 }} />
            <span style={{ fontSize: 12, color: "#9a9080" }}>per kg (applied to all liners in this challan)</span>
            {effectiveWt > 0 && sellRate && <span style={{ fontSize: 14, fontWeight: 700, color: "#8b6914", marginLeft: "auto" }}>{fmtRs(effectiveValue)}</span>}
          </div>
        </div>
      )}

      <div className="card">
        <h3>Select Liners to Sell</h3>
        <div className="g3" style={{ marginBottom: 12 }}>
          <div>
            <label className="lbl">BF</label>
            <select value={filter.bf} onChange={e => setFilter(f => ({ ...f, bf: e.target.value }))}>
              <option value="">All</option>
              {[...new Set(availableLiners.map(r => r.bf))].sort().map(b => <option key={b} value={b}>{b} BF</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">GSM</label>
            <select value={filter.gsm} onChange={e => setFilter(f => ({ ...f, gsm: e.target.value }))}>
              <option value="">All</option>
              {[...new Set(availableLiners.map(r => r.gsm))].sort((a, b) => Number(a) - Number(b)).map(g => <option key={g} value={g}>{g} GSM</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">Size</label>
            <select value={filter.size} onChange={e => setFilter(f => ({ ...f, size: e.target.value }))}>
              <option value="">All</option>
              {[...new Set(availableLiners.map(r => r.size))].sort((a, b) => Number(a) - Number(b)).map(s => <option key={s} value={s}>{s}"</option>)}
            </select>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24, color: "#b0a898" }}><span className="serif-italic">No liners available.</span></div>
        ) : (
          <div style={{ border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
            {filtered.map((r, idx) => {
              const sel = selected.includes(r.id);
              const pw = pendingWeights[r.id];
              return (
                <div key={r.id}
                  style={{ cursor: "pointer", background: sel ? "#fdf9f0" : idx % 2 === 0 ? "#fff" : "#faf8f4", borderBottom: idx < filtered.length - 1 ? "1px solid #e8eef8" : "none", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s" }}>
                  <div onClick={() => toggleLiner(r.id)} style={{ width: 20, height: 20, border: `2px solid ${sel ? "#8b6914" : "#ccc8c0"}`, borderRadius: 4, background: sel ? "#8b6914" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
                    {sel && <span style={{ color: "#fff", fontSize: 11 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }} onClick={() => toggleLiner(r.id)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="serif" style={{ fontSize: 20 }}>{r.size}"</span>
                      <span className="tag" style={{ fontSize: 10 }}>{r.bf} BF · {r.gsm} GSM</span>
                    </div>
                  </div>
                  {/* Editable weight — always editable even before confirmation */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="number" inputMode="numeric"
                      value={pw !== undefined ? pw : r.weight}
                      onChange={e => setPendingWeights(p => ({ ...p, [r.id]: e.target.value }))}
                      onClick={e => e.stopPropagation()}
                      style={{ width: 80, padding: "4px 8px", fontSize: 13, fontWeight: 600, textAlign: "right", border: pw !== undefined ? "1.5px solid #8b6914" : "1.5px solid #ddd8ce", borderRadius: 6, background: "#fff", color: "#1a1a1a" }}
                    />
                    <span style={{ fontSize: 11, color: "#9a9080" }}>kg</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="card" style={{ border: "1.5px solid #ddd8ce" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="lbl">Selected for Sale</div>
              <div className="serif" style={{ fontSize: 26, lineHeight: 1.1 }}>{selected.length} liners · {fmt(effectiveWt)} kg</div>
              {effectiveValue > 0 && <div style={{ fontSize: 14, color: "#8b6914", fontWeight: 700, marginTop: 4 }}>{fmtRs(effectiveValue)}</div>}
              {!customer && <div style={{ fontSize: 11, color: "#b83020", marginTop: 6 }}>Enter customer name to confirm.</div>}
            </div>
            <button className="btn btn-dark" style={{ fontSize: 14, padding: "12px 28px" }} onClick={sell} disabled={!customer}>✓ Confirm Sale</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GUM ADDON COMPONENT (for reel challan) ──────────────────────────────────
function GumAddonForChallan({ state, selectedGumIds, setSelectedGumIds, gumSellRate, setGumSellRate }) {
  const [expanded, setExpanded] = useState(false);
  const variants = state.gumVariants || [];
  const availGum = (state.gumStock || []).filter(g => !g.sold);
  const selectedSacks = availGum.filter(g => selectedGumIds.includes(g.id));
  const totalGumKg = selectedSacks.reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);

  if (availGum.length === 0) return null;

  return (
    <div className="card" style={{ border: selectedGumIds.length > 0 ? "1.5px solid #6a8a3a" : "1px solid #e8e2d8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>🪣 Add Gum Sacks to This Challan <span style={{ fontWeight: 400, color: "#9a9080" }}>(optional)</span></div>
          {selectedGumIds.length > 0 && <div style={{ fontSize: 12, color: "#6a8a3a", marginTop: 2 }}>{selectedGumIds.length} sacks · {fmt(totalGumKg)} kg selected{gumSellRate ? ` · ${fmtRs(totalGumKg * Number(gumSellRate))}` : ""}</div>}
        </div>
        <div style={{ color: "#c8b89a", fontSize: 16, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</div>
      </div>
      {expanded && (
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 12 }}>
            <label className="lbl">Gum Rate ₹/kg <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(applies to all selected sacks)</span></label>
            <input type="number" step="0.01" inputMode="numeric" value={gumSellRate} onChange={e => setGumSellRate(e.target.value)} placeholder="e.g. 24" style={{ maxWidth: 150 }} />
          </div>
          {variants.map(v => {
            const vSacks = availGum.filter(g => g.variantId === v.id);
            if (vSacks.length === 0) return null;
            return (
              <div key={v.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: v.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</span>
                  <span style={{ fontSize: 11, color: "#9a9080" }}>— {vSacks.length} available</span>
                  <button className="btn btn-outline btn-sm" style={{ marginLeft: "auto", fontSize: 10, padding: "3px 8px" }}
                    onClick={e => { e.stopPropagation(); const allIds = vSacks.map(g => g.id); const allSel = allIds.every(id => selectedGumIds.includes(id)); setSelectedGumIds(p => allSel ? p.filter(id => !allIds.includes(id)) : [...new Set([...p, ...allIds])]); }}>
                    {vSacks.every(g => selectedGumIds.includes(g.id)) ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {vSacks.map(g => {
                    const sel = selectedGumIds.includes(g.id);
                    return (
                      <div key={g.id} onClick={e => { e.stopPropagation(); setSelectedGumIds(p => sel ? p.filter(id => id !== g.id) : [...p, g.id]); }}
                        style={{ cursor: "pointer", background: sel ? "#f0f7ea" : "#f8f7f4", border: `2px solid ${sel ? "#6a8a3a" : "#e8e2d8"}`, borderRadius: 8, padding: "6px 10px", textAlign: "center", minWidth: 72, transition: "all 0.1s" }}>
                        <div style={{ width: 16, height: 16, border: `2px solid ${sel ? "#6a8a3a" : "#ccc"}`, borderRadius: 3, background: sel ? "#6a8a3a" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 3px" }}>
                          {sel && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{fmt(g.sackWeight)}</div>
                        <div style={{ fontSize: 9, color: "#9a9080" }}>kg</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {selectedGumIds.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e8e2d8", fontSize: 12, color: "#6a8a3a", fontWeight: 600 }}>
              {selectedGumIds.length} sacks selected · {fmt(totalGumKg)} kg
              {gumSellRate && <span style={{ marginLeft: 8 }}>· {fmtRs(totalGumKg * Number(gumSellRate))}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
function HistoryTab({ state, update }) {
  const [search, setSearch] = useState("");
  const [openChallan, setOpenChallan] = useState(null);
  const [editingChallan, setEditingChallan] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [confirmDeleteChallan, setConfirmDeleteChallan] = useState(null);
  const [addReelFilter, setAddReelFilter] = useState({ bf: "", gsm: "", size: "" });
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterSize, setFilterSize] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [custView, setCustView] = useState("challans"); // "challans" | "customers" | "customerDetail" | "transporters" | "transporterDetail"
  const [selCustomer, setSelCustomer] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [ledgerTab, setLedgerTab] = useState("overview"); // "overview"|"rates"|"history"
  const [bulkForm, setBulkForm] = useState({ grade: "", rate: "", fromDate: "", toDate: today() });
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkDone, setBulkDone] = useState(false);
  const [selTransporter, setSelTransporter] = useState("");
  const [transporterMonth, setTransporterMonth] = useState("");
  const [overduesDismissed, setOverduesDismissed] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [markPaidDate, setMarkPaidDate] = useState(today());
  const [invoiceListFilter, setInvoiceListFilter] = useState(null); // null | "overdue" | "dueSoon" | "outstanding"
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceCustFilter, setInvoiceCustFilter] = useState("");
  const [overdueTimeFilter, setOverdueTimeFilter] = useState("all");
  const [confirmDeleteCancelled, setConfirmDeleteCancelled] = useState(null);

  const startMarkPaid = (id) => { setMarkingPaidId(id); setMarkPaidDate(today()); };
  const confirmMarkPaid = (id) => {
    update(s => { const i = (s.payments || []).findIndex(p => p.id === id); if (i !== -1) { s.payments[i].paid = true; s.payments[i].paidDate = markPaidDate || today(); } });
    setMarkingPaidId(null);
  };

  const payments = state.payments || [];
  const cancelledChallans = state.cancelledChallans || [];
  const overduePayments = payments.filter(p => !p.paid && p.dueDate && daysDiff(p.dueDate) < 0);
  const dueSoonPayments = payments.filter(p => !p.paid && p.dueDate && daysDiff(p.dueDate) >= 0 && daysDiff(p.dueDate) <= 7);
  const hasOverdues = overduePayments.length > 0;
  const overdueAmount = overduePayments.reduce((s, p) => s + (p.amount||0), 0);
  const outstandingAmount = payments.filter(p => !p.paid && p.dueDate).reduce((s, p) => s + (p.amount||0), 0);

  const sold = state.stock.filter(r => r.sold);
  const challanMap = {};
  sold.forEach(r => {
    const key = r.soldChallanNo ? r.soldChallanNo : `__${r.soldDate}__${r.soldTo}`;
    if (!challanMap[key]) {
      challanMap[key] = { challanNo: r.soldChallanNo || null, date: r.soldDate, customer: r.soldTo || "", reels: [], gumSacks: [] };
    } else if (!challanMap[key].customer && r.soldTo) {
      challanMap[key].customer = r.soldTo;
    }
    challanMap[key].reels.push(r);
  });
  // Merge gum sacks into challan map
  (state.gumStock||[]).filter(g => g.sold).forEach(g => {
    const key = g.soldChallanNo ? g.soldChallanNo : `__${g.soldDate}__${g.soldTo}`;
    if (!challanMap[key]) {
      challanMap[key] = { challanNo: g.soldChallanNo || null, date: g.soldDate, customer: g.soldTo || "", reels: [], gumSacks: [] };
    }
    if (!challanMap[key].gumSacks) challanMap[key].gumSacks = [];
    challanMap[key].gumSacks.push(g);
    if (!challanMap[key].customer && g.soldTo) challanMap[key].customer = g.soldTo;
  });

  const allChallanCustomers = [...new Set(Object.values(challanMap).map(c => c.customer).filter(Boolean))].sort();
  const allChallanMonths = [...new Set(Object.values(challanMap).map(c => monthKey(c.date)).filter(Boolean))].sort().reverse();

  // Per-customer aggregate stats (includes gum challans)
  const gumChallanMap = {};
  (state.gumStock || []).filter(g => g.sold).forEach(g => {
    const key = g.soldChallanNo ? g.soldChallanNo : `__${g.soldDate}__${g.soldTo}`;
    if (!gumChallanMap[key]) gumChallanMap[key] = { challanNo: g.soldChallanNo || null, date: g.soldDate, customer: g.soldTo || "", sacks: [] };
    gumChallanMap[key].sacks.push(g);
  });

  const custStats = {};
  Object.values(challanMap).forEach(ch => {
    const c = ch.customer || "Unknown";
    if (!custStats[c]) custStats[c] = { reels: 0, kg: 0, challans: 0, lastDate: "", sizes: {}, gumSacks: 0, gumKg: 0, gumRevenue: 0 };
    custStats[c].challans++;
    custStats[c].reels += ch.reels.length;
    custStats[c].kg += ch.reels.reduce((s, r) => s + Number(r.weight), 0);
    if (!custStats[c].lastDate || ch.date > custStats[c].lastDate) custStats[c].lastDate = ch.date;
    ch.reels.forEach(r => { custStats[c].sizes[r.size] = (custStats[c].sizes[r.size] || 0) + 1; });
  });
  // Merge gum data into customer stats
  Object.values(gumChallanMap).forEach(ch => {
    const c = ch.customer || "Unknown";
    if (!custStats[c]) custStats[c] = { reels: 0, kg: 0, challans: 0, lastDate: "", sizes: {}, gumSacks: 0, gumKg: 0, gumRevenue: 0 };
    custStats[c].gumSacks += ch.sacks.length;
    custStats[c].gumKg += ch.sacks.reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
    custStats[c].gumRevenue += ch.sacks.reduce((s, g) => s + (Number(g.soldRate)||0) * Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
    if (!custStats[c].lastDate || ch.date > custStats[c].lastDate) custStats[c].lastDate = ch.date;
    // Count as challan if customer only has gum (no reel challan with same key)
    const alreadyCounted = Object.values(challanMap).some(rc => rc.customer === c && (rc.challanNo === ch.challanNo || (rc.date === ch.date && !rc.challanNo && !ch.challanNo)));
    if (!alreadyCounted) custStats[c].challans++;
  });

  let challans = Object.values(challanMap).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (filterCustomer) challans = challans.filter(c => c.customer === filterCustomer);
  if (filterSize) challans = challans.filter(c => c.reels.some(r => r.size === filterSize));
  if (filterGrade) { const [bf, gsm] = filterGrade.split("|"); challans = challans.filter(c => c.reels.some(r => r.bf === bf && r.gsm === gsm)); }
  if (filterMonth) challans = challans.filter(c => monthKey(c.date) === filterMonth);
  if (search) {
    const q = search.toLowerCase();
    challans = challans.filter(c =>
      c.customer?.toLowerCase().includes(q) ||
      c.challanNo?.toLowerCase().includes(q) ||
      fmtDate(c.date).toLowerCase().includes(q) ||
      c.reels.some(r => r.size?.includes(q))
    );
  }

  // Merge in cancelled challans (audit trail only) so the numbering gap they
  // leave behind is explained in the list, rather than looking like missing
  // data entry. They carry no reel/grade detail, so size & grade filters
  // (which are about live stock) exclude them; customer/month/search still apply.
  let visibleCancelled = cancelledChallans;
  if (filterCustomer) visibleCancelled = visibleCancelled.filter(c => c.customer === filterCustomer);
  if (filterMonth) visibleCancelled = visibleCancelled.filter(c => monthKey(c.date) === filterMonth);
  if (filterSize || filterGrade) visibleCancelled = [];
  if (search) {
    const q = search.toLowerCase();
    visibleCancelled = visibleCancelled.filter(c =>
      c.customer?.toLowerCase().includes(q) ||
      c.challanNo?.toLowerCase().includes(q) ||
      fmtDate(c.date).toLowerCase().includes(q)
    );
  }
  challans = [...challans, ...visibleCancelled.map(c => ({
    challanNo: c.challanNo, date: c.date, customer: c.customer, reels: [], gumSacks: [],
    cancelled: true, cancelledMeta: c,
  }))].sort((a, b) => new Date(a.date) - new Date(b.date));

  const hasFilters = filterCustomer || filterSize || filterGrade || filterMonth || search;

  const startEditChallan = (ch, key) => {
    setEditingChallan(key);
    setEditForm({ customer: ch.customer || "", date: ch.date || "", challanNo: ch.challanNo || "", transportBy: ch.reels[0]?.transportBy || "" });
    setOpenChallan(key);
  };

  const saveEditChallan = (ch, key) => {
    const ids = ch.reels.map(r => r.id);
    update(s => {
      s.stock = s.stock.map(r => {
        if (!ids.includes(r.id)) return r;
        return { ...r, soldTo: editForm.customer, soldDate: editForm.date, soldChallanNo: editForm.challanNo, transportBy: editForm.transportBy || undefined };
      });
      // Also update gum sacks on same challan
      if (s.gumStock) {
        s.gumStock = s.gumStock.map(g => {
          if (g.soldChallanNo !== ch.challanNo && !(g.soldDate === ch.date && g.soldTo === ch.customer)) return g;
          return { ...g, transportBy: editForm.transportBy || undefined };
        });
      }
      // Save new customer name if not known
      if (editForm.customer.trim() && !(s.customers||[]).some(x=>x.trim().toLowerCase()===editForm.customer.trim().toLowerCase())) {
        s.customers = [...(s.customers || []), editForm.customer.trim()].sort();
      }
    });
    setEditingChallan(null);
  };

  const deleteReelFromChallan = (reelId) => {
    update(s => {
      s.stock = s.stock.map(r => r.id === reelId
        ? { ...r, sold: false, soldDate: undefined, soldTo: undefined, soldChallanNo: undefined }
        : r
      );
    });
  };

  const addReelToChallan = (reelId, challanDate, challanCustomer, challanNo) => {
    update(s => {
      s.stock = s.stock.map(r => r.id === reelId
        ? { ...r, sold: true, soldDate: challanDate, soldTo: challanCustomer, soldChallanNo: challanNo }
        : r
      );
    });
  };

  const deleteChallan = (ch) => {
    const ids = ch.reels.map(r => r.id);
    const gumIds = (ch.gumSacks || []).map(g => g.id);
    const totalWt = ch.reels.reduce((s, r) => s + Number(r.weight || 0), 0);
    const totalGumWt = (ch.gumSacks || []).reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
    const sizesSummary = [...new Set(ch.reels.map(r => r.size).filter(Boolean))].sort((a, b) => Number(a) - Number(b)).join(", ");
    const chKey = makeChallanKey(ch);
    update(s => {
      s.stock = s.stock.map(r => ids.includes(r.id)
        ? { ...r, sold: false, soldDate: undefined, soldTo: undefined, soldChallanNo: undefined, transportBy: undefined }
        : r
      );
      if (s.gumStock && gumIds.length) {
        s.gumStock = s.gumStock.map(g => gumIds.includes(g.id)
          ? { ...g, sold: false, soldDate: undefined, soldTo: undefined, soldChallanNo: undefined, transportBy: undefined }
          : g
        );
      }
      // Drop the payment entry — the sale behind it no longer stands
      if (s.payments) s.payments = s.payments.filter(p => p.challanKey !== chKey);
      // Keep an audit record so the challan number stays visible as "cancelled"
      // instead of leaving a mystery gap in the sequence, and so it's excluded
      // from sales counts, tempo runs, and reports (which all key off `sold`).
      if (!s.cancelledChallans) s.cancelledChallans = [];
      s.cancelledChallans.push({
        id: genId(), challanNo: ch.challanNo || null, date: ch.date, customer: ch.customer || "",
        reelCount: ch.reels.length, totalWt, gumSackCount: (ch.gumSacks || []).length, totalGumWt,
        sizesSummary, cancelledAt: today(),
      });
    });
    setConfirmDeleteChallan(null);
    setOpenChallan(null);
  };

  const deleteCancelledChallan = (id) => {
    update(s => { s.cancelledChallans = (s.cancelledChallans || []).filter(c => c.id !== id); });
    setConfirmDeleteCancelled(null);
  };

  // ── TRANSPORTER LIST VIEW ──
  if (custView === "transporters") {
    const transporterNames = state.transporters || [];
    // Build raw entries (one per reel for sales, one per batch for conversions)
    const rawSaleEntries = state.stock.filter(r => r.sold && r.transportBy).map(r => ({
      type: "sale", transporter: r.transportBy, date: r.soldDate,
      challanNo: r.soldChallanNo, customer: r.soldTo, weight: Number(r.weight), id: r.id,
    }));
    const rawConvEntries = Object.values(state.stock.filter(r => r.productType === "liner" && r.conversionTransportBy && r.conversionBatchId)
      .reduce((acc, r) => {
        if (!acc[r.conversionBatchId]) acc[r.conversionBatchId] = { type: "conversion", transporter: r.conversionTransportBy, date: r.conversionDate, batchId: r.conversionBatchId, corrugator: r.corrugator, weight: 0 };
        acc[r.conversionBatchId].weight += Number(r.weight);
        return acc;
      }, {}));

    // Deduplicate sales by challan per transporter, then combine with conversions
    const deduplicateTrips = (saleEntries, convEntries) => {
      const challanMap = {};
      saleEntries.forEach(t => {
        const k = `${t.transporter}|${t.challanNo || t.date + "|" + t.customer}`;
        if (!challanMap[k]) challanMap[k] = { ...t, weight: 0 };
        challanMap[k].weight += t.weight;
      });
      return [...Object.values(challanMap), ...convEntries];
    };

    const allTrips = deduplicateTrips(rawSaleEntries, rawConvEntries);

    const tripsByTransporter = {};
    allTrips.forEach(t => {
      if (!tripsByTransporter[t.transporter]) tripsByTransporter[t.transporter] = [];
      tripsByTransporter[t.transporter].push(t);
    });
    const transporterList = [...new Set([...transporterNames, ...allTrips.map(t => t.transporter)])].sort();

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setCustView("challans")}>← Back</button>
          <div><div className="section-eyebrow">Logistics</div><h2>Transporter Ledger</h2></div>
        </div>
        {transporterList.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🚚</div>
            <div className="serif-italic" style={{ fontSize: 16, color: "#b0a898" }}>No transporters yet.</div>
            <div style={{ fontSize: 12, color: "#c0b8ac", marginTop: 6 }}>Add transport details when recording sales or conversions.</div>
          </div>
        ) : transporterList.map(name => {
          const trips = (tripsByTransporter[name] || []).sort((a, b) => new Date(b.date) - new Date(a.date));
          const monthMap = {};
          trips.forEach(t => { const m = monthKey(t.date); monthMap[m] = (monthMap[m] || 0) + 1; });
          const thisMonth = monthKey(today());
          const lastMonth = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; })();
          return (
            <div key={name} className="card" style={{ cursor: "pointer" }}
              onClick={() => { setSelTransporter(name); setCustView("transporterDetail"); setTransporterMonth(""); }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, background: "#1a1a1a", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚚</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{name}</div>
                    <div style={{ fontSize: 11, color: "#9a9080", marginTop: 2 }}>{trips.length} trip{trips.length !== 1 ? "s" : ""} total</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#6a6050" }}>This month: <strong>{monthMap[thisMonth] || 0}</strong></div>
                  <div style={{ fontSize: 11, color: "#9a9080" }}>Last month: <strong>{monthMap[lastMonth] || 0}</strong></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── TRANSPORTER DETAIL VIEW ──
  if (custView === "transporterDetail" && selTransporter) {
    // Build raw entries then deduplicate sales by challan up front
    const rawSales = state.stock.filter(r => r.sold && r.transportBy === selTransporter).map(r => ({
      type: "sale", transporter: r.transportBy, date: r.soldDate,
      challanNo: r.soldChallanNo, customer: r.soldTo, weight: Number(r.weight), id: r.id,
    }));
    const rawConversions = Object.values(state.stock.filter(r => r.productType === "liner" && r.conversionTransportBy === selTransporter && r.conversionBatchId)
      .reduce((acc, r) => {
        if (!acc[r.conversionBatchId]) acc[r.conversionBatchId] = { type: "conversion", transporter: r.conversionTransportBy, date: r.conversionDate, batchId: r.conversionBatchId, corrugator: r.corrugator, weight: 0 };
        acc[r.conversionBatchId].weight += Number(r.weight);
        return acc;
      }, {}));

    // Deduplicate sales by challan — include transportCharge from each reel's challan
    const challanMap = {};
    rawSales.forEach(t => {
      const k = t.challanNo || `${t.date}|${t.customer}`;
      if (!challanMap[k]) {
        // Get transportCharge from the actual reel record
        const reelForCh = state.stock.find(r => r.sold && r.transportBy === selTransporter && (r.soldChallanNo === t.challanNo || (!r.soldChallanNo && `${r.soldDate}|${r.soldTo}` === k)));
        challanMap[k] = { ...t, weight: 0, tripCharge: reelForCh?.transportCharge || 0, billedToCustomer: (reelForCh?.transportCharge || 0) > 0 };
      }
      challanMap[k].weight += t.weight;
    });
    const allTrips = [...Object.values(challanMap), ...rawConversions]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const allMonths = [...new Set(allTrips.map(t => monthKey(t.date)))].sort().reverse();
    const filtered = transporterMonth ? allTrips.filter(t => monthKey(t.date) === transporterMonth) : allTrips;

    // Period counts — all from already-deduplicated allTrips
    const now = new Date();
    const todayStr = today();
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const tripsToday = allTrips.filter(t => t.date === todayStr).length;
    const tripsWeek = allTrips.filter(t => new Date(t.date) >= weekAgo).length;
    const tripsMonth = allTrips.filter(t => monthKey(t.date) === monthStr).length;
    const totalKgMonth = allTrips.filter(t => monthKey(t.date) === monthStr).reduce((s, t) => s + (t.weight || 0), 0);
    // Cost calculations
    const filteredSaleTrips = filtered.filter(t => t.type === "sale");
    const totalPayable = filteredSaleTrips.reduce((s,t) => s + (t.tripCharge||0), 0);
    const totalBilled = filteredSaleTrips.filter(t => t.billedToCustomer).reduce((s,t) => s + (t.tripCharge||0), 0);
    const totalAbsorbed = filteredSaleTrips.filter(t => !t.billedToCustomer && t.tripCharge > 0).reduce((s,t) => s + (t.tripCharge||0), 0);
    const monthPayable = allTrips.filter(t => t.type==="sale" && monthKey(t.date)===monthStr).reduce((s,t) => s + (t.tripCharge||0), 0);

    const uniqueTrips = filtered;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setCustView("transporters")}>← Transporters</button>
          <div><div className="section-eyebrow">Transporter</div><h2>{selTransporter}</h2></div>
        </div>
        {/* Summary stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 10 }}>
          {[
            { label: "Today", val: tripsToday, sub: "trips" },
            { label: "This Week", val: tripsWeek, sub: "trips" },
            { label: "This Month", val: tripsMonth, sub: `trips · ${fmt(Math.round(totalKgMonth))} kg` },
            { label: "All Time", val: allTrips.length, sub: "trips" },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: "12px 14px", textAlign: "center" }}>
              <div className="lbl">{s.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{s.val}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 3 }}>{s.sub}</div>
            </div>
          ))}
        </div>
        {/* Cost summary for selected period */}
        {totalPayable > 0 && (
          <div className="card" style={{ padding: "14px 16px", background: "#111" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              💰 Cost Summary {transporterMonth ? `— ${monthLabel(transporterMonth)}` : "— All time"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#888" }}>Total payable to {selTransporter}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{fmtRs(totalPayable)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: "#666" }}>Recovered from customers</span>
              <span style={{ color: "#22c55e", fontWeight: 600 }}>{fmtRs(totalBilled)}</span>
            </div>
            {totalAbsorbed > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#666" }}>Absorbed (your cost)</span>
                <span style={{ color: "#ef4444", fontWeight: 600 }}>{fmtRs(totalAbsorbed)}</span>
              </div>
            )}
            {!transporterMonth && monthPayable > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #222", display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#aaa" }}>This month payable</span>
                <span style={{ color: "#D4A017", fontWeight: 700 }}>{fmtRs(monthPayable)}</span>
              </div>
            )}
          </div>
        )}
        {/* Month filter */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#aaa" }}>Filter:</span>
          <button onClick={() => setTransporterMonth("")} className={`btn btn-sm ${!transporterMonth ? "btn-dark" : "btn-outline"}`}>All</button>
          {allMonths.map(m => (
            <button key={m} onClick={() => setTransporterMonth(m)} className={`btn btn-sm ${transporterMonth === m ? "btn-dark" : "btn-outline"}`}>{monthLabel(m)}</button>
          ))}
        </div>
        {/* Trip ledger */}
        <div className="card-flat">
          <div style={{ display: "flex", alignItems: "center", background: "#f5f5f5", borderBottom: "1px solid rgba(0,0,0,0.06)", padding: "6px 12px" }}>
            <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.07em" }}>Date · Type</div>
            <div style={{ width: 90, fontSize: 9, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.07em" }}>Details</div>
            <div style={{ width: 70, fontSize: 9, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "right" }}>Charge</div>
          </div>
          {uniqueTrips.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 13 }}>No trips in selected period.</div>
          ) : uniqueTrips.map((t, i) => (
            <div key={t.batchId || t.challanNo || i} style={{ display: "flex", alignItems: "center", padding: "10px 12px", borderBottom: i < uniqueTrips.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>{fmtDate(t.date)}</div>
                <div style={{ fontSize: 10, color: "#aaa", marginTop: 1 }}>
                  {t.type === "sale"
                    ? <span style={{ color: "#b8860b" }}>🏷 Sale{t.challanNo ? ` · CH #${t.challanNo}` : ""}</span>
                    : <span style={{ color: "#2d6a4f" }}>🔄 Conversion{t.corrugator ? ` · ${t.corrugator}` : ""}</span>}
                </div>
              </div>
              <div style={{ width: 90, fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.type === "sale" ? (t.customer || "—") : (t.corrugator || "—")}
              </div>
              <div style={{ width: 70, textAlign: "right" }}>
                {t.type === "sale" && t.tripCharge > 0 ? (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{fmtRs(t.tripCharge)}</div>
                    <div style={{ fontSize: 8, color: t.billedToCustomer ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{t.billedToCustomer ? "billed ✓" : "absorbed"}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "#aaa" }}>{fmt(Math.round(t.weight||0))} kg</div>
                )}
              </div>
            </div>
          ))}
          {uniqueTrips.length > 0 && (
            <div style={{ padding: "10px 12px", background: "#f5f5f5", display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, color: "#666" }}>
              <span>{uniqueTrips.length} trip{uniqueTrips.length !== 1 ? "s" : ""} {transporterMonth ? `in ${monthLabel(transporterMonth)}` : ""}</span>
              {totalPayable > 0 && <span style={{ color: "#111" }}>Payable: {fmtRs(totalPayable)}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── CUSTOMER LIST VIEW ──
  if (custView === "customers") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} className="fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setCustView("challans")}>← Back</button>
        <div><div className="section-eyebrow">Customers</div><h2>Customer History</h2></div>
      </div>
      {/* Outstanding summary */}
      {payments.filter(p => !p.paid && p.dueDate).length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { key: "overdue", label: "Overdue", val: overduePayments.length, amount: overdueAmount, color: "#b83020", bg: "#fef0ee", border: "#f0c0ba" },
            { key: "dueSoon", label: "Due ≤7d", val: dueSoonPayments.length, amount: dueSoonPayments.reduce((s,p)=>s+(p.amount||0),0), color: "#a05800", bg: "#fef5e8", border: "#f0d5a0" },
            { key: "outstanding", label: "Outstanding", val: payments.filter(p=>!p.paid&&p.dueDate).length, amount: outstandingAmount, color: "#2d2d2d", bg: "#f5f0e8", border: "#e5dece" },
          ].map(s => (
            <div key={s.label} onClick={() => { if (s.val > 0) { setInvoiceListFilter(s.key); setInvoiceSearch(""); setInvoiceCustFilter(""); setCustView("invoiceList"); } }}
              style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: "10px 12px", textAlign: "center", cursor: s.val > 0 ? "pointer" : "default" }}>
              <div style={{ fontSize: 10, color: s.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "'Playfair Display',serif" }}>{s.val}</div>
              {s.amount > 0 && <div style={{ fontSize: 10, color: s.color, marginTop: 2 }}>{fmtRs(s.amount)}</div>}
              {s.val > 0 && <div style={{ fontSize: 9, color: s.color, marginTop: 4, opacity: 0.7 }}>tap to view ›</div>}
            </div>
          ))}
        </div>
      )}
      <input
        value={custSearch}
        onChange={e => setCustSearch(e.target.value)}
        placeholder="Search customers…"
        style={{ maxWidth: 360 }}
      />
      {Object.keys(custStats).length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <span className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>No customers yet.</span>
        </div>
      ) : (
        <div className="card-flat">
          {Object.entries(custStats)
            .filter(([name]) => !custSearch || name.toLowerCase().includes(custSearch.toLowerCase()))
            .sort((a, b) => b[1].kg - a[1].kg)
            .map(([name, cs], idx, arr) => {
            const topSz = Object.entries(cs.sizes).sort((a, b) => b[1] - a[1])[0];
            return (
              <div key={name}
                onClick={() => { setSelCustomer(name); setCustView("customerDetail"); setFilterCustomer(name); setSearch(""); setFilterSize(""); setFilterGrade(""); setFilterMonth(""); }}
                style={{ padding: "14px 18px", borderBottom: idx < arr.length - 1 ? "1px solid #e8eef8" : "none", cursor: "pointer", transition: "background 0.12s" }}
                onMouseEnter={e => e.currentTarget.style.background = "#faf8f4"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, background: CHART_COLORS[idx % CHART_COLORS.length], borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                    <div style={{ fontSize: 11, color: "#9a9080", marginTop: 2 }}>
                      {cs.challans} challan{cs.challans !== 1 ? "s" : ""} · {cs.reels} reels · {fmt(Math.round(cs.kg))} kg{cs.gumSacks > 0 ? ` · ${cs.gumSacks} gum sack${cs.gumSacks !== 1 ? "s" : ""}` : ""}{topSz ? ` · Top: ${topSz[0]}"` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {(() => {
                      const custOverdue = payments.filter(p => !p.paid && p.dueDate && p.customer === name && daysDiff(p.dueDate) < 0);
                      const custOutstanding = payments.filter(p => !p.paid && p.dueDate && p.customer === name);
                      if (custOverdue.length > 0) return <div style={{ fontSize: 11, color: "#b83020", fontWeight: 700, marginBottom: 2 }}>🔴 {custOverdue.length} overdue</div>;
                      if (custOutstanding.length > 0) return <div style={{ fontSize: 11, color: "#a05800", fontWeight: 600, marginBottom: 2 }}>🟡 {custOutstanding.length} due</div>;
                      return null;
                    })()}
                    <div style={{ fontSize: 12, color: "#6a6050", fontWeight: 500 }}>{(cs.kg / 1000).toFixed(2)} t</div>
                    <div style={{ fontSize: 10, color: "#b0a898", marginTop: 2 }}>Last: {fmtDate(cs.lastDate)}</div>
                  </div>
                  <div style={{ color: "#c8b89a", fontSize: 16 }}>›</div>
                </div>
              </div>
            );
          })}
          {custSearch && Object.entries(custStats).filter(([name]) => name.toLowerCase().includes(custSearch.toLowerCase())).length === 0 && (
            <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "#b0a898", fontStyle: "italic" }}>No customers match "{custSearch}"</div>
          )}
        </div>
      )}
    </div>
  );

  if (custView === "invoiceList") {
    const baseList = invoiceListFilter === "overdue" ? overduePayments
      : invoiceListFilter === "dueSoon" ? dueSoonPayments
      : payments.filter(p => !p.paid && p.dueDate);
    const titleMap = { overdue: "Overdue Invoices", dueSoon: "Due Within 7 Days", outstanding: "All Outstanding Invoices" };
    const invoiceCustomers = [...new Set(baseList.map(p => p.customer).filter(Boolean))].sort();
    let sorted = [...baseList].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    if (invoiceCustFilter) sorted = sorted.filter(p => p.customer === invoiceCustFilter);
    if (invoiceSearch) {
      const q = invoiceSearch.toLowerCase();
      sorted = sorted.filter(p => p.customer?.toLowerCase().includes(q) || String(p.challanNo||"").toLowerCase().includes(q));
    }
    // Overdue time filters

    if (invoiceListFilter === "overdue" && overdueTimeFilter !== "all") {
      if (overdueTimeFilter === "0-30") sorted = sorted.filter(p => Math.abs(daysDiff(p.dueDate)) <= 30);
      else if (overdueTimeFilter === "30-60") sorted = sorted.filter(p => Math.abs(daysDiff(p.dueDate)) > 30 && Math.abs(daysDiff(p.dueDate)) <= 60);
      else if (overdueTimeFilter === "60+") sorted = sorted.filter(p => Math.abs(daysDiff(p.dueDate)) > 60);
    }
    const total = sorted.reduce((s, p) => s + (p.amount || 0), 0);

    const exportOverduePDF = () => {
      const dateStr = new Date().toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" });
      const byCustomer = {};
      sorted.forEach(p => { if (!byCustomer[p.customer]) byCustomer[p.customer] = []; byCustomer[p.customer].push(p); });
      const isMobile = /Mobi|Android/i.test(navigator.userAgent);
      const rows = Object.entries(byCustomer).map(([cust, invs]) => {
        const custTotal = invs.reduce((s,p) => s + (p.amount||0), 0);
        const invoiceRows = invs.map(p => `
          <tr>
            <td><strong>CH #${p.challanNo||"—"}</strong></td>
            <td>${fmtDate(p.challanDate)}</td>
            <td>${fmtDate(p.dueDate)}</td>
            <td style="color:#c62828">${Math.abs(daysDiff(p.dueDate))}d overdue</td>
            <td style="text-align:right;font-weight:700">${fmtRs(p.amount||0)}</td>
          </tr>`).join("");
        return `
          <div class="customer-block">
            <div class="cust-name">${cust}</div>
            <table>
              <thead><tr>
                <th>Challan</th><th>Invoice Date</th><th>Due Date</th><th>Status</th><th style="text-align:right">Amount</th>
              </tr></thead>
              <tbody>${invoiceRows}</tbody>
              <tfoot><tr class="total-row">
                <td colspan="4">Total Overdue</td>
                <td style="text-align:right">${fmtRs(custTotal)}</td>
              </tr></tfoot>
            </table>
          </div>`;
      }).join("");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Overdues ${dateStr}</title>
        <style>
          @page { margin: 12mm; size: ${isMobile ? "A4 portrait" : "A4 landscape"}; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: ${isMobile ? "11px" : "12px"}; color: #111; margin: 0; padding: 0; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid #111; }
          .company { font-size: ${isMobile ? "18px" : "22px"}; font-weight: 800; }
          .sub { font-size: 11px; color: #666; margin-top: 2px; }
          .date-label { font-size: 11px; color: #666; text-align: right; }
          .date-val { font-size: 13px; font-weight: 700; }
          .summary { display: flex; justify-content: space-between; align-items: center; background: #fce4ec; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; }
          .summary-text { font-size: 12px; font-weight: 700; color: #c62828; }
          .summary-amt { font-size: 15px; font-weight: 800; color: #c62828; }
          .customer-block { page-break-inside: avoid; margin-bottom: 20px; }
          .cust-name { font-size: 13px; font-weight: 800; color: #111; background: #f5f5f5; padding: 6px 10px; border-radius: 4px; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: ${isMobile ? "10px" : "11px"}; }
          th { background: #111; color: #fff; padding: 5px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; }
          td { padding: 5px 8px; border-bottom: 1px solid #eee; }
          .total-row td { font-weight: 800; background: #f9f9f9; font-size: ${isMobile ? "11px" : "12px"}; border-top: 1.5px solid #111; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head><body>
        <div class="header">
          <div><div class="company">SK Traders</div><div class="sub">KraftTrack — Overdue Report</div></div>
          <div><div class="date-label">Generated on</div><div class="date-val">${dateStr}</div></div>
        </div>
        <div class="summary">
          <span class="summary-text">${sorted.length} overdue invoices · ${Object.keys(byCustomer).length} customers</span>
          <span class="summary-amt">${fmtRs(total)}</span>
        </div>
        ${rows}
        <script>window.onload=function(){window.print();}</script>
      </body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setCustView("customers")}>← Back</button>
          <div><div className="section-eyebrow">Customers</div><h2>{titleMap[invoiceListFilter] || "Invoices"}</h2></div>
          {invoiceListFilter === "overdue" && (
            <button className="btn btn-dark btn-sm" style={{ marginLeft: "auto" }} onClick={exportOverduePDF}>⬇ Export PDF</button>
          )}
        </div>
        {/* Overdue time filters */}
        {invoiceListFilter === "overdue" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["all","All time"],["0-30","0–30d"],["30-60","30–60d"],["60+","60d+"]].map(([v,l]) => (
              <button key={v} onClick={() => setOverdueTimeFilter(v)} className={`btn btn-sm ${overdueTimeFilter===v?"btn-dark":"btn-outline"}`}>{l}</button>
            ))}
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{sorted.length} invoice{sorted.length !== 1 ? "s" : ""} · {fmtRs(total)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} placeholder="Search customer / challan no…" style={{ flex: 1, minWidth: 180 }} />
          <select value={invoiceCustFilter} onChange={e => setInvoiceCustFilter(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">All customers</option>
            {invoiceCustomers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {sorted.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <span style={{ fontSize: 17, color: "#aaa", fontStyle: "italic" }}>Nothing here.</span>
          </div>
        ) : (
          <div className="card-flat">
            {sorted.map((p, i) => {
              const status = getPaymentStatus(p);
              const badge = paymentStatusBadge(status, p.dueDate);
              return (
                <div key={p.id}
                  onClick={() => { setSelCustomer(p.customer); setCustView("customerDetail"); setFilterCustomer(p.customer); setSearch(""); setFilterSize(""); setFilterGrade(""); setFilterMonth(""); }}
                  style={{ padding: "0", borderBottom: i < sorted.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none", cursor: "pointer", display: "flex", alignItems: "stretch" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#fafafa"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {/* Challan No block — prominent */}
                  <div style={{ flexShrink:0, background: p.challanNo ? "#111" : "#e0e0e0", width:52, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"8px 4px", gap:1 }}>
                    <div style={{ fontSize:7, color:"#666", textTransform:"uppercase", letterSpacing:"0.06em" }}>CH</div>
                    <div style={{ fontSize:14, fontWeight:800, color: p.challanNo ? "#fff" : "#bbb", lineHeight:1.1, textAlign:"center" }}>{p.challanNo||"—"}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, padding: "10px 12px" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color:"#111" }}>{p.customer || "—"}</div>
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{fmtDate(p.challanDate)} · Due {fmtDate(p.dueDate)}</div>
                  </div>
                  <div style={{ padding:"10px 10px", display:"flex", flexDirection:"column", alignItems:"flex-end", justifyContent:"center", gap:4 }}>
                    <span style={{ fontSize: 10, background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color, borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>{badge.label}</span>
                    <div style={{ fontWeight: 800, fontSize: 13, color:"#111" }}>{p.amount > 0 ? fmtRs(p.amount) : "—"}</div>
                  </div>
                  <div style={{ color: "#ccc", fontSize: 16, display:"flex", alignItems:"center", paddingRight:8 }}>›</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const isCustomerDetail = custView === "customerDetail";

  // Customer ledger data
  const custLedger = selCustomer ? (() => {
    const cs = custStats[selCustomer] || {};
    const cd = state.customerData?.[selCustomer] || {};
    const custChallans = Object.values(challanMap).filter(c => (c.customer || "") === selCustomer);
    const reelRevenue = custChallans.reduce((s, ch) => s + ch.reels.reduce((ss, r) => ss + (Number(r.soldRate) || 0) * Number(r.weight), 0), 0);
    const reelProfit = custChallans.reduce((s, ch) => s + ch.reels.reduce((ss, r) => ss + reelLandedProfit(r), 0), 0);
    const gumRevenue = cs.gumRevenue || 0;
    const custGumSold = (state.gumStock||[]).filter(g => g.sold && g.soldTo === selCustomer);
    const gumProfit = custGumSold.reduce((s, g) => s + gumLandedProfit(g), 0);
    const revenue = reelRevenue + gumRevenue;
    const profit = reelProfit + gumProfit;
    return { cs, cd, revenue, profit, reelRevenue, reelProfit, gumRevenue, gumProfit, custChallans, custGumSold };
  })() : null;

  // Bulk apply: compute preview
  const computeBulkPreview = (form) => {
    if (!form.grade || !form.rate || !form.fromDate || !selCustomer) return null;
    const [bf, gsm] = form.grade.split("|");
    const affected = state.stock.filter(r =>
      r.sold && r.soldTo === selCustomer &&
      r.bf === bf && r.gsm === gsm &&
      r.soldDate >= form.fromDate && r.soldDate <= form.toDate
    );
    const challansAffected = [...new Set(affected.map(r => r.soldChallanNo || r.soldDate))];
    return { reels: affected.length, challans: challansAffected.length, kg: affected.reduce((s, r) => s + Number(r.weight), 0) };
  };

  const doBulkApply = () => {
    if (!bulkForm.grade || !bulkForm.rate || !bulkForm.fromDate) return;
    const [bf, gsm] = bulkForm.grade.split("|");
    update(s => {
      s.stock = s.stock.map(r => {
        if (!r.sold || r.soldTo !== selCustomer) return r;
        if (r.bf !== bf || r.gsm !== gsm) return r;
        if (r.soldDate < bulkForm.fromDate || r.soldDate > bulkForm.toDate) return r;
        return { ...r, soldRate: Number(bulkForm.rate) };
      });
      if (!s.customerData) s.customerData = {};
      if (!s.customerData[selCustomer]) s.customerData[selCustomer] = { rateHistory: {} };
      const hist = s.customerData[selCustomer].rateHistory[bulkForm.grade] || [];
      const entry = { rate: Number(bulkForm.rate), from: bulkForm.fromDate, to: bulkForm.toDate };
      const exists = hist.some(h => h.rate === entry.rate && h.from === entry.from);
      if (!exists) s.customerData[selCustomer].rateHistory[bulkForm.grade] = [...hist, entry].sort((a,b) => a.from.localeCompare(b.from));
    });
    setBulkDone(true); setBulkPreview(null);
    setTimeout(() => setBulkDone(false), 2500);
  };

  // Rate trend SVG chart per grade
  const RateTrendChart = ({ hist, color = "#8b6914" }) => {
    if (!hist || hist.length < 1) return <div style={{ fontSize: 12, color: "#b0a898", fontStyle: "italic" }}>No rate history yet.</div>;
    const w = 280, h = 100, padL = 44, padB = 24, padT = 10, padR = 10;
    const points = hist.map((h, i) => ({ x: h.from, rate: h.rate, label: fmtDate(h.from) }));
    // Add "today" as last point
    const today2 = today();
    if (points[points.length - 1].x !== today2) points.push({ x: today2, rate: points[points.length - 1].rate, label: "Today" });
    const rates = points.map(p => p.rate);
    const minR = Math.min(...rates) * 0.97, maxR = Math.max(...rates) * 1.03;
    const xScale = i => padL + (i / (points.length - 1)) * (w - padL - padR);
    const yScale = r => padT + (1 - (r - minR) / (maxR - minR || 1)) * (h - padT - padB);
    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(p.rate).toFixed(1)}`).join(" ");
    const areaD = pathD + ` L${xScale(points.length-1).toFixed(1)},${h - padB} L${padL},${h - padB} Z`;
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h + 10}`} style={{ overflow: "visible" }}>
        {/* Grid lines */}
        {[0, 0.5, 1].map(t => {
          const y = padT + t * (h - padT - padB);
          const val = maxR - t * (maxR - minR);
          return <g key={t}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#e8e2d8" strokeWidth="1" strokeDasharray="3,3"/>
            <text x={padL - 4} y={y + 4} fontSize="8" textAnchor="end" fill="#9a9080">{fmtRs(Math.round(val))}</text>
          </g>;
        })}
        {/* Area fill */}
        <path d={areaD} fill={color} opacity="0.08"/>
        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
        {/* Points + labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={xScale(i)} cy={yScale(p.rate)} r="3.5" fill={color}/>
            <text x={xScale(i)} y={h - padB + 14} fontSize="7.5" textAnchor="middle" fill="#9a9080"
              transform={points.length > 4 ? `rotate(-30, ${xScale(i)}, ${h - padB + 14})` : ""}>
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} className="fade-in">
      {isCustomerDetail ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn btn-outline btn-sm" onClick={() => { setCustView("customers"); setSelCustomer(""); setFilterCustomer(""); setLedgerTab("overview"); }}>← Customers</button>
            <div><div className="section-eyebrow">Customer Ledger</div><h2>{selCustomer}</h2></div>
          </div>

          {/* Stats row */}
          {custLedger && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "Challans", val: custLedger.cs.challans || 0 },
                { label: "Reels", val: custLedger.cs.reels || 0 },
                { label: "Gum Sacks", val: custLedger.cs.gumSacks || 0 },
                { label: "Revenue", val: custLedger.revenue ? fmtRs(custLedger.revenue) : "—" },
                { label: "Profit", val: custLedger.profit ? fmtRs(custLedger.profit) : "—" },
              ].map(s => (
                <div key={s.label} style={{ background: "#fff", border: "1px solid #e8e2d8", borderRadius: 10, padding: "10px 14px", flex: 1, minWidth: 80, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#8b6914", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: s.label === "Profit" && custLedger.profit < 0 ? "#b83020" : "#1a1a1a" }}>{s.val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Ledger tabs */}
          <div style={{ display: "flex", gap: 4, background: "#f5f0e8", borderRadius: 10, padding: 4 }}>
            {[["overview","📊 Overview"], ["payments","💳 Payments"], ["rates","₹ Bulk Apply"], ["history","📈 Rate History"]].map(([tab, label]) => (
              <button key={tab} onClick={() => setLedgerTab(tab)}
                style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: "none", background: ledgerTab === tab ? "#fff" : "transparent", color: ledgerTab === tab ? "#1a1a1a" : "#8b6914", fontWeight: ledgerTab === tab ? 600 : 400, fontSize: 12, cursor: "pointer", boxShadow: ledgerTab === tab ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>

          {/* PAYMENTS TAB */}
          {ledgerTab === "payments" && custLedger && (() => {
            const custPayments = payments.filter(p => p.customer === selCustomer).sort((a,b) => new Date(b.challanDate) - new Date(a.challanDate));
            const custCreditDays = state.customerData?.[selCustomer]?.creditDays || null;
            const totalBilled = custPayments.reduce((s,p) => s+(p.amount||0), 0);
            const totalPaid = custPayments.filter(p=>p.paid).reduce((s,p) => s+(p.amount||0), 0);
            const outstanding = totalBilled - totalPaid;
            const custOverdue = custPayments.filter(p => !p.paid && p.dueDate && daysDiff(p.dueDate) < 0);
            // Aging buckets for this customer
            const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
            custOverdue.forEach(p => { const d = Math.abs(daysDiff(p.dueDate)); if (d <= 30) aging["0-30"] += p.amount||0; else if (d <= 60) aging["31-60"] += p.amount||0; else if (d <= 90) aging["61-90"] += p.amount||0; else aging["90+"] += p.amount||0; });
            // Payment gap (how late they actually pay)
            const paidOnTime = custPayments.filter(p => p.paid && p.paidDate && p.dueDate);
            const avgGap = paidOnTime.length ? Math.round(paidOnTime.reduce((s,p) => s + daysDiff2(p.paidDate, p.dueDate), 0) / paidOnTime.length) : null;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Credit period setting */}
                <div className="card" style={{ padding: "14px 16px" }}>
                  <h3 style={{ marginBottom: 10 }}>Default Credit Period</h3>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                    {CREDIT_PRESETS.map(d => (
                      <button key={d} onClick={() => {
                        update(s => {
                          if (!s.customerData) s.customerData = {};
                          if (!s.customerData[selCustomer]) s.customerData[selCustomer] = { rateHistory: {} };
                          s.customerData[selCustomer].creditDays = d;
                          // Bulk-add all unpaid challans for this customer that don't have a payment entry
                          if (!s.payments) s.payments = [];
                          const allCustChallans = Object.values((() => {
                            const cm = {}; s.stock.filter(r=>r.sold&&r.soldTo===selCustomer).forEach(r => { const k=r.soldChallanNo||`__${r.soldDate}__${r.soldTo}`; if(!cm[k]) cm[k]={challanNo:r.soldChallanNo||null,date:r.soldDate,customer:selCustomer,reels:[],gumSacks:[]}; cm[k].reels.push(r); }); (s.gumStock||[]).filter(g=>g.sold&&g.soldTo===selCustomer).forEach(g => { const k=g.soldChallanNo||`__${g.soldDate}__${g.soldTo}`; if(!cm[k]) cm[k]={challanNo:g.soldChallanNo||null,date:g.soldDate,customer:selCustomer,reels:[],gumSacks:[]}; cm[k].gumSacks.push(g); }); return cm;
                          })());
                          allCustChallans.forEach(ch => {
                            const ck = makeChallanKey(ch);
                            if (!s.payments.some(p => p.challanKey === ck)) {
                              s.payments.push(buildPaymentEntry(ch, d));
                            } else {
                              // Update creditDays and dueDate for existing untracked entries
                              const pi = s.payments.findIndex(p => p.challanKey === ck && !p.paid);
                              if (pi !== -1 && !s.payments[pi].creditDays) {
                                s.payments[pi].creditDays = d;
                                s.payments[pi].dueDate = addDays(s.payments[pi].challanDate, d);
                              }
                            }
                          });
                        });
                      }}
                        style={{ padding: "5px 14px", borderRadius: 6, border: "1.5px solid", fontSize: 12, cursor: "pointer", fontWeight: custCreditDays === d ? 700 : 400, background: custCreditDays === d ? "#1a1a1a" : "#fff", color: custCreditDays === d ? "#fff" : "#6a6050", borderColor: custCreditDays === d ? "#1a1a1a" : "#ddd8ce" }}>
                        {d}d
                      </button>
                    ))}
                    <input type="number" inputMode="numeric" placeholder="Custom" style={{ width: 90 }}
                      onBlur={e => {
                        const d = parseInt(e.target.value);
                        if (!d || d < 1) return;
                        update(s => {
                          if (!s.customerData) s.customerData = {};
                          if (!s.customerData[selCustomer]) s.customerData[selCustomer] = { rateHistory: {} };
                          s.customerData[selCustomer].creditDays = d;
                          if (!s.payments) s.payments = [];
                          const cm = {}; s.stock.filter(r=>r.sold&&r.soldTo===selCustomer).forEach(r => { const k=r.soldChallanNo||`__${r.soldDate}__${r.soldTo}`; if(!cm[k]) cm[k]={challanNo:r.soldChallanNo||null,date:r.soldDate,customer:selCustomer,reels:[],gumSacks:[]}; cm[k].reels.push(r); }); (s.gumStock||[]).filter(g=>g.sold&&g.soldTo===selCustomer).forEach(g => { const k=g.soldChallanNo||`__${g.soldDate}__${g.soldTo}`; if(!cm[k]) cm[k]={challanNo:g.soldChallanNo||null,date:g.soldDate,customer:selCustomer,reels:[],gumSacks:[]}; cm[k].gumSacks.push(g); });
                          Object.values(cm).forEach(ch => { const ck=makeChallanKey(ch); if(!s.payments.some(p=>p.challanKey===ck)) s.payments.push(buildPaymentEntry(ch,d)); });
                        });
                        e.target.value = "";
                      }} />
                    {custCreditDays && <span style={{ fontSize: 12, color: "#2d6a4f", fontWeight: 600 }}>✓ {custCreditDays}d set</span>}
                  </div>
                  {custCreditDays && <div style={{ fontSize: 11, color: "#888" }}>All existing and future challans use {custCreditDays}-day credit period by default.</div>}
                </div>

                {/* Transport rate setting */}
                <div className="card" style={{ padding: "14px 16px" }}>
                  <h3 style={{ marginBottom: 10 }}>Default Transport Charge / Trip</h3>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="number" inputMode="numeric" placeholder="e.g. 300"
                      defaultValue={state.customerData?.[selCustomer]?.transportRate || ""}
                      style={{ width: 130 }}
                      onBlur={e => {
                        const v = Number(e.target.value);
                        update(s => {
                          if (!s.customerData) s.customerData = {};
                          if (!s.customerData[selCustomer]) s.customerData[selCustomer] = { rateHistory: {} };
                          s.customerData[selCustomer].transportRate = v || null;
                        });
                      }} />
                    <span style={{ fontSize: 12, color: "#888" }}>₹ per trip — auto-fills on new challans</span>
                  </div>
                  {state.customerData?.[selCustomer]?.transportRate && (
                    <div style={{ fontSize: 11, color: "#22c55e", marginTop: 6, fontWeight: 600 }}>✓ ₹{state.customerData[selCustomer].transportRate}/trip pre-set</div>
                  )}
                </div>
                {/* Running balance */}
                {custPayments.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {[
                      { label: "Total Billed", val: fmtRs(totalBilled), color: "#1a1a1a", bg: "#fff" },
                      { label: "Total Collected", val: fmtRs(totalPaid), color: "#2d6a4f", bg: "#edf7f0" },
                      { label: "Outstanding", val: fmtRs(outstanding), color: outstanding > 0 ? "#b83020" : "#2d6a4f", bg: outstanding > 0 ? "#fef0ee" : "#edf7f0" },
                    ].map(s => (
                      <div key={s.label} style={{ background: s.bg, border: "1px solid #e8e2d8", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#8b6914", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{s.label}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: "'Playfair Display',serif" }}>{s.val}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Aging + efficiency */}
                {custOverdue.length > 0 && (
                  <div className="card" style={{ padding: "12px 14px", background: "#fef0ee", border: "1px solid #f0c0ba" }}>
                    <h3 style={{ color: "#b83020", marginBottom: 10 }}>Overdue Aging</h3>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {Object.entries(aging).filter(([,v])=>v>0).map(([bucket, amt]) => (
                        <div key={bucket} style={{ background: "#fff", border: "1px solid #f0c0ba", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                          <div style={{ fontSize: 10, color: "#b83020", fontWeight: 700 }}>{bucket}d</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#b83020" }}>{fmtRs(amt)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {avgGap !== null && (
                  <div style={{ padding: "10px 14px", background: avgGap <= 0 ? "#edf7f0" : "#fef5e8", border: `1px solid ${avgGap <= 0 ? "#b5dcc0" : "#f0d5a0"}`, borderRadius: 10, fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: avgGap <= 0 ? "#2d6a4f" : "#a05800" }}>
                      {avgGap <= 0 ? `✓ Pays ${Math.abs(avgGap)}d early on average` : `Pays ${avgGap}d late on average`}
                    </span>
                    <span style={{ color: "#9a9080", marginLeft: 8 }}>across {paidOnTime.length} settled challan{paidOnTime.length!==1?"s":""}</span>
                  </div>
                )}
                {/* Challan list */}
                {custPayments.length === 0 ? (
                  <div className="card" style={{ textAlign: "center", padding: 32 }}>
                    <span style={{ fontSize: 13, color: "#b0a898" }}>No tracked payments yet. Set a credit period above to start tracking.</span>
                  </div>
                ) : (
                  <div className="card-flat">
                    {custPayments.map((p, pi) => {
                      const status = getPaymentStatus(p);
                      const badge = paymentStatusBadge(status, p.dueDate);
                      return (
                        <div key={p.id} style={{ padding: "12px 14px", borderBottom: pi < custPayments.length-1 ? "1px solid #e8eef8" : "none", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                              {p.challanNo && <span style={{ fontWeight: 700, fontSize: 13 }}>CH {p.challanNo}</span>}
                              <span style={{ fontSize: 11, background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color, borderRadius: 5, padding: "1px 7px", fontWeight: 600 }}>{badge.label}</span>
                              {p.amount > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{fmtRs(p.amount)}</span>}
                            </div>
                            <div style={{ fontSize: 11, color: "#9a9080" }}>
                              {fmtDate(p.challanDate)}
                              {p.dueDate && <span> · Due {fmtDate(p.dueDate)}</span>}
                              {p.paid && p.paidDate && <span style={{ color: "#2d6a4f" }}> · Paid {fmtDate(p.paidDate)}</span>}
                            </div>
                            {/* Per-challan credit days override */}
                            {!p.paid && (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 10, color: "#b0a898" }}>Override credit days:</span>
                                {CREDIT_PRESETS.map(d => (
                                  <button key={d} onClick={() => update(s => { const i=(s.payments||[]).findIndex(x=>x.id===p.id); if(i!==-1){s.payments[i].creditDays=d;s.payments[i].dueDate=addDays(s.payments[i].challanDate,d);} })}
                                    style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, border: "1px solid", cursor: "pointer", background: p.creditDays===d?"#1a1a1a":"transparent", color: p.creditDays===d?"#fff":"#6a6050", borderColor: p.creditDays===d?"#1a1a1a":"#ddd8ce" }}>{d}d</button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            {!p.paid ? (
                              markingPaidId === p.id ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f5f0e8", border: "1px solid #e5dece", borderRadius: 7, padding: "5px 7px" }}>
                                  <div>
                                    <div style={{ fontSize: 9, color: "#9a9080", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 1 }}>Paid on</div>
                                    <input type="date" value={markPaidDate} max={today()} onChange={e => setMarkPaidDate(e.target.value)} style={{ fontSize: 12, padding: "3px 6px", minWidth: 0, width: 132 }} />
                                  </div>
                                  <button onClick={() => confirmMarkPaid(p.id)} style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✓ Confirm</button>
                                  <button onClick={() => setMarkingPaidId(null)} style={{ background: "transparent", color: "#9a9080", border: "none", fontSize: 16, cursor: "pointer", padding: "0 2px" }}>×</button>
                                </div>
                              ) : (
                                <button onClick={() => startMarkPaid(p.id)}
                                  style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✓ Mark Paid</button>
                              )
                            ) : (
                              <button onClick={() => update(s => { const i=(s.payments||[]).findIndex(x=>x.id===p.id); if(i!==-1){s.payments[i].paid=false;s.payments[i].paidDate=null;} })}
                                style={{ background: "transparent", color: "#9a9080", border: "1px solid #ddd8ce", borderRadius: 7, padding: "5px 10px", fontSize: 11, cursor: "pointer" }}>Undo</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* OVERVIEW TAB — current rate card + top sizes */}
          {ledgerTab === "overview" && custLedger && (
            <div className="card" style={{ padding: "14px 16px" }}>
              <h3 style={{ marginBottom: 12 }}>Current Rate Card <span style={{ fontSize: 11, color: "#9a9080", fontWeight: 400 }}>— tap a rate to edit</span></h3>
              <div style={{ border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
                {state.grades.map((g, gi) => {
                  const k = `${g.bf}|${g.gsm}`;
                  const hist = custLedger.cd?.rateHistory?.[k] || [];
                  const currentRate = hist.length ? hist[hist.length - 1].rate : null;
                  const gradeRev = custLedger.custChallans.reduce((s, ch) => s + ch.reels.filter(r => r.bf === g.bf && r.gsm === g.gsm).reduce((ss, r) => ss + (Number(r.soldRate)||0)*Number(r.weight), 0), 0);
                  return (
                    <div key={k} style={{ padding: "11px 14px", borderBottom: gi < state.grades.length - 1 ? "1px solid #f5f0e8" : "none", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 120 }}>{g.bf} BF {g.gsm} GSM</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="number" step="0.01" inputMode="decimal"
                          defaultValue={currentRate || ""}
                          placeholder="₹/kg"
                          onBlur={e => {
                            const newRate = parseFloat(e.target.value);
                            if (!e.target.value || isNaN(newRate)) return;
                            if (newRate === currentRate) return;
                            update(s => {
                              if (!s.customerData) s.customerData = {};
                              if (!s.customerData[selCustomer]) s.customerData[selCustomer] = { rateHistory: {} };
                              const h = s.customerData[selCustomer].rateHistory[k] || [];
                              s.customerData[selCustomer].rateHistory[k] = [...h, { rate: newRate, from: today() }];
                            });
                          }}
                          style={{ width: 90, padding: "5px 8px", fontSize: 13, fontWeight: 600 }} />
                        <span style={{ fontSize: 11, color: "#9a9080" }}>/kg</span>
                        {gradeRev > 0 && <span style={{ fontSize: 11, color: "#8b6914", marginLeft: 4 }}>{fmtRs(gradeRev)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {custLedger.cs.sizes && (
                <div style={{ marginTop: 12, fontSize: 12, color: "#8b6914" }}>
                  Top sizes: {Object.entries(custLedger.cs.sizes).sort((a,b) => b[1]-a[1]).slice(0,5).map(([sz,cnt]) => `${sz}" (${cnt}×)`).join(" · ")}
                </div>
              )}
            </div>
          )}

          {/* BULK APPLY TAB */}
          {ledgerTab === "rates" && (
            <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <h3>Bulk Apply Rate to Past Challans</h3>
              <p style={{ fontSize: 12, color: "#8a8070", lineHeight: 1.6 }}>Select a grade, enter the rate, and pick a date range. All challans for this customer in that range will have their ₹/kg updated at once.</p>
              {bulkDone && <div className="ok-box">✓ Rate applied to all matching challans!</div>}
              <div className="g2">
                <div>
                  <label className="lbl">Grade</label>
                  <select value={bulkForm.grade} onChange={e => { setBulkForm(f => ({...f, grade: e.target.value})); setBulkPreview(null); setBulkDone(false); }}>
                    <option value="">Select grade</option>
                    {state.grades.map(g => <option key={g.label} value={`${g.bf}|${g.gsm}`}>{g.bf} BF {g.gsm} GSM</option>)}
                  </select>
                </div>
                <div>
                  <label className="lbl">Rate (₹/kg)</label>
                  <input type="number" step="0.01" inputMode="numeric" value={bulkForm.rate} placeholder="e.g. 42"
                    onChange={e => { setBulkForm(f => ({...f, rate: e.target.value})); setBulkPreview(null); setBulkDone(false); }} />
                </div>
                <div>
                  <label className="lbl">From Date</label>
                  <input type="date" value={bulkForm.fromDate} onChange={e => { setBulkForm(f => ({...f, fromDate: e.target.value})); setBulkPreview(null); }} />
                </div>
                <div>
                  <label className="lbl">To Date</label>
                  <input type="date" value={bulkForm.toDate} onChange={e => { setBulkForm(f => ({...f, toDate: e.target.value})); setBulkPreview(null); }} />
                </div>
              </div>
              {!bulkPreview ? (
                <button className="btn btn-outline" onClick={() => setBulkPreview(computeBulkPreview(bulkForm))}
                  disabled={!bulkForm.grade || !bulkForm.rate || !bulkForm.fromDate}>
                  Preview Changes
                </button>
              ) : bulkPreview.reels === 0 ? (
                <div className="warn-box">No challans found for this grade in that date range.</div>
              ) : (
                <div style={{ background: "#fef9ee", border: "1px solid #f0d5a0", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Preview</div>
                  <div style={{ fontSize: 13, color: "#6a6050", marginBottom: 12 }}>
                    This will set <strong>{fmtRs(Number(bulkForm.rate))}/kg</strong> on <strong>{bulkPreview.challans} challan{bulkPreview.challans !== 1 ? "s" : ""}</strong> · <strong>{bulkPreview.reels} reels</strong> · <strong>{fmt(Math.round(bulkPreview.kg))} kg</strong>
                    <br/>Total value: <strong>{fmtRs(bulkPreview.kg * Number(bulkForm.rate))}</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-dark" onClick={doBulkApply}>✓ Apply Rate</button>
                    <button className="btn btn-outline" onClick={() => setBulkPreview(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RATE HISTORY TAB */}
          {ledgerTab === "history" && custLedger && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {state.grades.map(g => {
                const k = `${g.bf}|${g.gsm}`;
                const hist = (custLedger.cd?.rateHistory?.[k] || []).slice().sort((a,b) => a.from.localeCompare(b.from));
                // Build date ranges: each entry's "to" = next entry's "from" - 1 day (or today)
                const withRanges = hist.map((h, i) => ({
                  ...h,
                  toDisplay: hist[i+1] ? hist[i+1].from : today()
                }));
                return (
                  <div key={k} className="card" style={{ padding: "14px 16px" }}>
                    <h3 style={{ marginBottom: 12 }}>{g.bf} BF {g.gsm} GSM — Rate History</h3>
                    {/* Trend chart */}
                    {hist.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <RateTrendChart hist={hist} color="#8b6914" />
                      </div>
                    )}
                    {/* Timeline table */}
                    {withRanges.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#b0a898", fontStyle: "italic" }}>No rate history. Use Bulk Apply to add rates.</div>
                    ) : (
                      <div style={{ border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "#f5f0e8", padding: "8px 14px" }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: "#8b6914", textTransform: "uppercase", letterSpacing: "0.07em" }}>From</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: "#8b6914", textTransform: "uppercase", letterSpacing: "0.07em" }}>To</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: "#8b6914", textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "right" }}>Rate</span>
                        </div>
                        {withRanges.reverse().map((h, i) => (
                          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "10px 14px", borderTop: "1px solid #f5f0e8", background: i === 0 ? "#fdf9f0" : "#fff" }}>
                            <span style={{ fontSize: 12 }}>{fmtDate(h.from)}</span>
                            <span style={{ fontSize: 12, color: "#9a9080" }}>{i === 0 ? "Current" : fmtDate(h.toDisplay)}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#8b6914", textAlign: "right" }}>{fmtRate(h.rate)}/kg</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div className="section-eyebrow">Records</div><h2>Sales History</h2></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setCustView("transporters")}>🚚 Transport</button>
            <button className="btn btn-outline btn-sm" onClick={() => setCustView("customers")} style={{ position: "relative" }}>
              👥 Customers
              {hasOverdues && <span style={{ position: "absolute", top: -4, right: -4, width: 9, height: 9, background: "#b83020", borderRadius: "50%", border: "2px solid #fff", display: "block" }} />}
            </button>
          </div>
        </div>
      )}
      {/* Overdue banner */}
      {hasOverdues && !overduesDismissed && (
        <div style={{ background: "#fef0ee", border: "1px solid #f0c0ba", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>🔴</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#b83020" }}>{overduePayments.length} overdue challan{overduePayments.length !== 1 ? "s" : ""}</span>
            {overdueAmount > 0 && <span style={{ fontSize: 12, color: "#b83020" }}>· {fmtRs(overdueAmount)} pending</span>}
            <button onClick={() => setCustView("customers")} style={{ fontSize: 11, color: "#b83020", background: "transparent", border: "1px solid #f0c0ba", borderRadius: 5, padding: "2px 8px", cursor: "pointer", marginLeft: 4 }}>View →</button>
          </div>
          <button onClick={() => setOverduesDismissed(true)} style={{ background: "transparent", border: "none", color: "#c08070", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
      )}
      {/* Filter bar */}
      <div className="card" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 2, minWidth: 160 }}>
            <label className="lbl">Customer</label>
            <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
              <option value="">All Customers</option>
              {allChallanCustomers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label className="lbl">Grade</label>
            <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
              <option value="">All</option>
              {state.grades.map(g => <option key={g.label} value={`${g.bf}|${g.gsm}`}>{g.bf} BF {g.gsm} GSM</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label className="lbl">Size</label>
            <select value={filterSize} onChange={e => setFilterSize(e.target.value)}>
              <option value="">All</option>
              {SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}"</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label className="lbl">Month</label>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
              <option value="">All Time</option>
              {allChallanMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, challan no, size…" style={{ flex: 1 }} />
          {hasFilters && (
            <button className="btn btn-outline btn-sm" onClick={() => { setFilterCustomer(""); setFilterSize(""); setFilterGrade(""); setFilterMonth(""); setSearch(""); }}>
              Clear
            </button>
          )}
          <span style={{ fontSize: 12, color: "#9a9080", whiteSpace: "nowrap" }}>{challans.length} challan{challans.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
      {challans.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <span className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>{sold.length === 0 ? "No sales recorded yet." : "No results match your filters."}</span>
        </div>
      ) : (
        <div className="card-flat">
          {/* Column header row */}
          <div style={{ display: "flex", alignItems: "center", background: "#f5f0e8", borderBottom: "1px solid #e8e2d8" }}>
            <div style={{ width: 52, flexShrink: 0, padding: "6px 4px", textAlign: "center", fontSize: 9, fontWeight: 700, color: "#9a9080", textTransform: "uppercase", letterSpacing: "0.06em" }}>CH#</div>
            <div style={{ flex: 1, padding: "6px 10px", fontSize: 9, fontWeight: 700, color: "#9a9080", textTransform: "uppercase", letterSpacing: "0.06em", borderLeft: "1px solid #e8e2d8" }}>Customer · Date</div>
            <div style={{ flex: "0 0 auto", width: 70, padding: "6px 8px", fontSize: 9, fontWeight: 700, color: "#9a9080", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderLeft: "1px solid #e8e2d8" }}>Wt · Value</div>
            <div style={{ width: 28, flexShrink: 0 }} />
          </div>
          {challans.map((ch, idx) => {
            const key = ch.cancelled ? `__cancelled_${ch.cancelledMeta.id}` : (ch.challanNo || `__${ch.date}__${ch.customer}`);

            if (ch.cancelled) {
              const cm = ch.cancelledMeta;
              return (
                <div key={key} style={{ borderBottom: idx < challans.length - 1 ? "1px solid #e8eef8" : "none", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: "#faf8f4" }}>
                  <div style={{ flexShrink: 0, background: "#e8e2d8", width: 52, height: 40, borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
                    <div style={{ fontSize: 8, color: "#9a9080", textTransform: "uppercase", letterSpacing: "0.06em" }}>CH</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#b0a898", textDecoration: "line-through" }}>{cm.challanNo || "—"}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#9a9080", textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cm.customer || "—"}</div>
                    <div style={{ fontSize: 11, color: "#b0a898" }}>
                      {fmtDate(cm.date)} · {cm.reelCount} reel{cm.reelCount !== 1 ? "s" : ""}{cm.sizesSummary ? ` (${cm.sizesSummary}")` : ""}{cm.gumSackCount ? ` · ${cm.gumSackCount} gum sack${cm.gumSackCount !== 1 ? "s" : ""}` : ""}
                    </div>
                    <div style={{ fontSize: 10, color: "#b83020", marginTop: 2, fontWeight: 600 }}>🚫 CANCELLED — stock returned, excluded from sales &amp; tempo runs</div>
                  </div>
                  <button onClick={() => setConfirmDeleteCancelled(cm.id)} title="Permanently remove this cancelled record"
                    style={{ flexShrink: 0, background: "transparent", color: "#c0a898", border: "1px solid #e5dece", borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>✕</button>
                </div>
              );
            }

            const isOpen = openChallan === key;
            const isEditing = editingChallan === key;
            const reels = ch.reels || [];
            const gumSacks = ch.gumSacks || [];
            const totalWt = reels.reduce((s, r) => s + Number(r.weight||0), 0);
            const totalGumWt = gumSacks.reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
            const bySizeInChallan = {};
            reels.forEach(r => {
              if (!bySizeInChallan[r.size]) bySizeInChallan[r.size] = [];
              bySizeInChallan[r.size].push(r);
            });
            const chForGST = { reels, gumSacks, transportCharge: reels[0]?.transportCharge || 0 };
            const chGST = challanGST(chForGST);
            const chGrand = challanGrandTotal(chForGST);
            const chExGST = challanTaxableAmount(chForGST);
            const pmtEntry = payments.find(px => px && px.challanKey === key);
            const pmtStatus = getPaymentStatus(pmtEntry);
            return (
              <div key={key} style={{ borderBottom: idx < challans.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none" }}>
                {/* Challan header */}
                <div onClick={() => !isEditing && setOpenChallan(prev => prev === key ? null : key)}
                  style={{ padding: "0", cursor: isEditing ? "default" : "pointer", display: "flex", alignItems: "stretch", transition: "background 0.12s", background: isOpen ? "#fafafa" : "transparent" }}
                  onMouseEnter={e => { if (!isOpen && !isEditing) e.currentTarget.style.background = "#fafafa"; }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}>
                  {/* Challan No block */}
                  <div style={{ flexShrink: 0, background: ch.challanNo ? "#111" : "#e0e0e0", width: 52, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "10px 4px", gap: 1 }}>
                    <div style={{ fontSize: 8, color: ch.challanNo ? "#777" : "#aaa", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1 }}>CH</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: ch.challanNo ? "#fff" : "#bbb", lineHeight: 1.1, fontFamily: "'Inter', sans-serif", textAlign: "center", wordBreak: "break-all" }}>{ch.challanNo || "—"}</div>
                    {pmtStatus === "overdue" && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#ef4444", marginTop: 3 }} />}
                    {pmtStatus === "due-soon" && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#f97316", marginTop: 3 }} />}
                    {pmtStatus === "paid" && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", marginTop: 3 }} />}
                  </div>
                  {/* Customer + date — middle flex column */}
                  <div style={{ flex: 1, minWidth: 0, padding: "8px 10px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderLeft: "1px solid rgba(0,0,0,0.06)" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ch.customer || "—"}
                      {reels.some(r => r.productType === "liner") && <span style={{ fontSize: 9, background: "#e8f0ff", border: "1px solid #c0d4f5", borderRadius: 3, padding: "1px 5px", color: "#3a5a9a", marginLeft: 5 }}>Liner</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#aaa" }}>{fmtDate(ch.date)} · {reels.length} {reels.every(r => r.productType === "liner") ? "liner" : "reel"}{reels.length !== 1 ? "s" : ""}{gumSacks.length > 0 ? ` · ${gumSacks.length} gum` : ""}</div>
                    {ch.reels[0]?.transportBy && <div style={{ fontSize: 10, color: "#888" }}>🚚 {ch.reels[0].transportBy}{ch.reels[0]?.transportCharge > 0 ? ` · ${fmtRs(ch.reels[0].transportCharge)}` : ""}</div>}
                  </div>
                  {/* Weight + value — right column (WITH GST in collapsed) */}
                  <div style={{ flexShrink: 0, width: 78, padding: "8px 8px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 3, borderLeft: "1px solid rgba(0,0,0,0.06)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{fmt(Math.round(totalWt + totalGumWt))} <span style={{ fontSize: 9, fontWeight: 400, color: "#aaa" }}>kg</span></div>
                    {chGrand > 0 ? (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#111" }}>{fmtRs(chGrand)}</div>
                        <div style={{ fontSize: 8, color: "#aaa" }}>incl. GST</div>
                      </div>
                    ) : <span style={{ fontSize: 9, background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 3, padding: "1px 4px", color: "#e65100", fontWeight: 600 }}>no rate</span>}
                  </div>
                  {/* Expand arrow */}
                  <div style={{ flexShrink: 0, width: 28, display: "flex", alignItems: "center", justifyContent: "center", color: "#ccc", fontSize: 16, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</div>
                </div>

                {/* Expanded content */}
                {isOpen && (
                  <div style={{ background: "#fafafa", borderTop: "1px solid rgba(0,0,0,0.06)", padding: "14px 16px 16px" }}>

                    {/* Edit form */}
                    {isEditing ? (
                      <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* Header fields */}
                        <div style={{ background: "#fff", border: "1.5px solid #b8860b", borderRadius: 10, padding: "14px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#b8860b", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Edit Challan Details</div>
                          <div className="g3" style={{ marginBottom: 10 }}>
                            <div>
                              <label className="lbl">Customer</label>
                              <CustomerInput value={editForm.customer} onChange={v => setEditForm(f => ({ ...f, customer: v }))} customers={state.customers || []} />
                            </div>
                            <div>
                              <label className="lbl">Date</label>
                              <input type="date" value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} />
                            </div>
                            <div>
                              <label className="lbl">Challan No</label>
                              <input value={editForm.challanNo} onChange={e => setEditForm(f => ({ ...f, challanNo: e.target.value }))} placeholder="e.g. CH-101" />
                            </div>
                          </div>
                          <div style={{ marginBottom: 10 }}>
                            <label className="lbl">🚚 Transport By <span style={{ fontWeight: 400, color: "#b0a898", textTransform: "none", letterSpacing: 0 }}>(add / edit)</span></label>
                            <TransporterInput value={editForm.transportBy || ""} onChange={v => setEditForm(f => ({ ...f, transportBy: v }))} transporters={state.transporters || []} placeholder="Transporter / Tempo name" />
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn btn-dark btn-sm" onClick={() => saveEditChallan(ch, key)}>✓ Save Header</button>
                            <button className="btn btn-outline btn-sm" onClick={() => setEditingChallan(null)}>Done</button>
                          </div>
                        </div>

                        {/* Reels in challan — delete individual */}
                        <div style={{ background: "#fff", border: "1px solid #e8e2d8", borderRadius: 10, padding: "14px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#6a6050", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                            Reels in This Challan — {reels.length} reels
                          </div>
                          {reels.length === 0
                            ? <div style={{ fontSize: 12, color: "#b0a898", fontStyle: "italic" }}>No reels — add some below.</div>
                            : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {reels.sort((a, b) => Number(a.size) - Number(b.size)).map(r => (
                                  <div key={r.id} style={{ background: "#fef0ee", border: "1px solid #f0c0ba", borderRadius: 7, padding: "6px 10px", display: "flex", alignItems: "center", gap: 7 }}>
                                    <span className="serif" style={{ fontSize: 17 }}>{r.size}"</span>
                                    <span style={{ fontSize: 12, color: "#9a4030", fontWeight: 500 }}>{fmt(r.weight)} kg</span>
                                    <span style={{ fontSize: 10, color: "#c0a898" }}>{r.bf} BF</span>
                                    <button
                                      onClick={() => deleteReelFromChallan(r.id)}
                                      title="Remove from challan (returns to stock)"
                                      style={{ background: "transparent", color: "#b83020", border: "1px solid #f0c0ba", borderRadius: 4, padding: "1px 6px", fontSize: 11, cursor: "pointer", lineHeight: 1.5 }}>
                                      ✕
                                    </button>
                                  </div>
                                ))}
                              </div>
                          }
                        </div>

                        {/* Add reel from available stock */}
                        <div style={{ background: "#fff", border: "1px solid #e8e2d8", borderRadius: 10, padding: "14px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#6a6050", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Add Reel from Available Stock</div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                            <div style={{ flex: 1, minWidth: 130 }}>
                              <label className="lbl">Grade</label>
                              <select value={`${addReelFilter.bf}|${addReelFilter.gsm}`}
                                onChange={e => { const [bf, gsm] = e.target.value.split("|"); setAddReelFilter(f => ({ ...f, bf, gsm })); }}
                                style={{ fontSize: 12 }}>
                                <option value="|">All grades</option>
                                {state.grades.map(g => <option key={g.label} value={`${g.bf}|${g.gsm}`}>{g.bf} BF {g.gsm} GSM</option>)}
                              </select>
                            </div>
                            <div style={{ flex: 1, minWidth: 110 }}>
                              <label className="lbl">Size</label>
                              <select value={addReelFilter.size}
                                onChange={e => setAddReelFilter(f => ({ ...f, size: e.target.value }))}
                                style={{ fontSize: 12 }}>
                                <option value="">All sizes</option>
                                {SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}"</option>)}
                              </select>
                            </div>
                          </div>
                          {(() => {
                            const avail = state.stock.filter(r =>
                              !r.sold
                              && (!addReelFilter.bf || r.bf === addReelFilter.bf)
                              && (!addReelFilter.gsm || r.gsm === addReelFilter.gsm)
                              && (!addReelFilter.size || r.size === addReelFilter.size)
                            ).sort((a, b) => Number(a.size) - Number(b.size));
                            return avail.length === 0
                              ? <div style={{ fontSize: 12, color: "#b0a898", fontStyle: "italic" }}>No available stock matches this filter.</div>
                              : <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto" }}>
                                  {avail.map(r => (
                                    <button key={r.id}
                                      onClick={() => {
                                        const customer = editForm.customer || reels.find(x => x.soldTo)?.soldTo || ch.customer || "";
                                        addReelToChallan(r.id, editForm.date || ch.date, customer, editForm.challanNo !== undefined ? editForm.challanNo : (ch.challanNo || ""));
                                      }}
                                      title={`Add ${r.size}" ${fmt(r.weight)} kg to this challan`}
                                      style={{ background: "#edf7f0", border: "1px solid #b5dcc0", borderRadius: 7, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                                      <span className="serif" style={{ fontSize: 17 }}>{r.size}"</span>
                                      <span style={{ color: "#2d6a4f", fontWeight: 500 }}>{fmt(r.weight)} kg</span>
                                      <span style={{ fontSize: 10, color: "#6a9a7a" }}>{r.bf} BF</span>
                                      <span style={{ fontSize: 13, color: "#2d6a4f", marginLeft: 2 }}>＋</span>
                                    </button>
                                  ))}
                                </div>;
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                        <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); startEditChallan(ch, key); }}>✎ Edit / Manage Reels</button>
                        <button onClick={e => { e.stopPropagation(); setConfirmDeleteChallan({ ch, key }); }}
                          style={{ background: "transparent", color: "#b83020", border: "1.5px solid #f0c0ba", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>
                          🚫 Cancel Sale
                        </button>
                      </div>
                    )}

                    {/* Sizes + weights grouped by grade with editable rate */}
                    {(() => {
                      const byGrade = {};
                      reels.forEach(r => {
                        const k = `${r.bf}|${r.gsm}`;
                        if (!byGrade[k]) byGrade[k] = { bf: r.bf, gsm: r.gsm, reels: [], rate: r.soldRate || "" };
                        byGrade[k].reels.push(r);
                        if (r.soldRate && !byGrade[k].rate) byGrade[k].rate = r.soldRate;
                      });
                      const challanVal = Object.values(byGrade).reduce((s, g) => {
                        const kg = g.reels.reduce((ss, r) => ss + Number(r.weight), 0);
                        return s + (Number(g.rate) || 0) * kg;
                      }, 0);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {Object.entries(byGrade).sort((a, b) => a[0].localeCompare(b[0])).map(([gk, gd]) => {
                            const gradeKg = gd.reels.reduce((s, r) => s + Number(r.weight), 0);
                            const gradeVal = (Number(gd.rate) || 0) * gradeKg;
                            return (
                              <div key={gk} style={{ background: "#faf8f4", borderRadius: 10, padding: "10px 12px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                                  <span className="tag">{gd.bf} BF · {gd.gsm} GSM</span>
                                  <span style={{ fontSize: 12, color: "#8b6914" }}>{fmt(Math.round(gradeKg))} kg</span>
                                  <div style={{ flex: 1 }} />
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <input
                                      type="number" inputMode="numeric"
                                      value={gd.rate}
                                      placeholder="₹/kg"
                                      onChange={e => {
                                        const newRate = e.target.value;
                                        update(s => {
                                          s.stock = s.stock.map(r =>
                                            gd.reels.some(x => x.id === r.id) ? { ...r, soldRate: newRate ? Number(newRate) : undefined } : r
                                          );
                                        });
                                      }}
                                      style={{ width: 80, padding: "4px 8px", fontSize: 12 }}
                                    />
                                    <span style={{ fontSize: 11, color: "#8b6914" }}>/kg</span>
                                    {gradeVal > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{fmtRs(gradeVal)}</span>}
                                  </div>
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                  {gd.reels.sort((a, b) => Number(a.size) - Number(b.size) || Number(a.weight) - Number(b.weight)).map(r => (
                                    <span key={r.id} style={{ background: "#fff", border: "1px solid #e5dece", borderRadius: 5, padding: "3px 9px", fontSize: 12, color: "#8b6914", fontWeight: 500 }}>
                                      {r.size}" · {fmt(r.weight)} kg
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                          {/* Gum sacks in this challan */}
                          {gumSacks.length > 0 && (
                            <div style={{ marginTop: 12, padding: "10px 12px", background: "#f0f7ea", borderRadius: 10, border: "1px solid #b5d8a0" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "#2d6a4f" }}>🪣 Pasting Gum — {gumSacks.length} sack{gumSacks.length !== 1 ? "s" : ""} · {fmt(Math.round(totalGumWt))} kg</span>
                                <div style={{ flex: 1 }} />
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <input
                                    type="number" inputMode="numeric"
                                    defaultValue={gumSacks[0]?.soldRate || ""}
                                    placeholder="₹/kg"
                                    onBlur={e => {
                                      const newRate = e.target.value;
                                      if (!newRate) return;
                                      update(s => {
                                        if (!s.gumStock) return;
                                        s.gumStock = s.gumStock.map(g =>
                                          gumSacks.some(x => x.id === g.id) ? { ...g, soldRate: Number(newRate) } : g
                                        );
                                      });
                                    }}
                                    style={{ width: 80, padding: "4px 8px", fontSize: 12 }}
                                  />
                                  <span style={{ fontSize: 11, color: "#5a8a5a" }}>/kg</span>
                                  {gumSacks[0]?.soldRate > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{fmtRs(totalGumWt * (gumSacks[0]?.soldRate||0))}</span>}
                                </div>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                {gumSacks.map((g, gi) => {
                                  const vName = (state.gumVariants||[]).find(v => v.id === g.variantId)?.name || g.variantName || "Gum";
                                  const vColor = (state.gumVariants||[]).find(v => v.id === g.variantId)?.color || "#6a8a3a";
                                  return (
                                    <span key={g.id} style={{ background: "#fff", border: `1px solid ${vColor}66`, borderRadius: 5, padding: "3px 9px", fontSize: 12, color: "#2d6a4f", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
                                      <div style={{ width: 8, height: 8, borderRadius: 2, background: vColor }} />
                                      {vName} · {fmt(g.sackWeight)} kg
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          <div style={{ paddingTop: 10, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                            {/* GST Breakup */}
                            {chExGST > 0 ? (
                              <div style={{ background: "#f9f9f9", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                                {/* Item subtotal per grade */}
                                {[...new Set(reels.map(r => `${r.bf}|${r.gsm}`))].map(k => {
                                  const [bf, gsm] = k.split("|");
                                  const grReels = reels.filter(r => r.bf===bf && r.gsm===gsm && r.productType!=="liner");
                                  const linReels = reels.filter(r => r.bf===bf && r.gsm===gsm && r.productType==="liner");
                                  return (
                                    <React.Fragment key={k}>
                                      {grReels.length > 0 && (() => {
                                        const kg = grReels.reduce((s,r)=>s+Number(r.weight),0);
                                        const rate = grReels[0].soldRate||0;
                                        const val = kg*rate;
                                        return <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, padding:"2px 0" }}><span style={{color:"#888"}}>{bf} BF {gsm} GSM · {fmt(Math.round(kg))} kg @ {fmtRate(rate)}</span><span style={{fontWeight:600}}>{fmtRs(val)}</span></div>;
                                      })()}
                                      {linReels.length > 0 && (() => {
                                        const kg = linReels.reduce((s,r)=>s+Number(r.weight),0);
                                        const rate = linReels[0].soldRate||0;
                                        const val = kg*rate;
                                        return <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, padding:"2px 0" }}><span style={{color:"#888"}}>Liner {bf} BF {gsm} GSM · {fmt(Math.round(kg))} kg @ {fmtRate(rate)}</span><span style={{fontWeight:600}}>{fmtRs(val)}</span></div>;
                                      })()}
                                    </React.Fragment>
                                  );
                                })}
                                {gumSacks.length > 0 && (() => {
                                  const gkg = gumSacks.reduce((s,g)=>s+Number(g.sackWeight||DEFAULT_GUM_SACK_WEIGHT),0);
                                  const gval = gumSacks.reduce((s,g)=>s+(Number(g.soldRate)||0)*Number(g.sackWeight||DEFAULT_GUM_SACK_WEIGHT),0);
                                  return <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, padding:"2px 0" }}><span style={{color:"#888"}}>Gum · {gumSacks.length} sacks · {fmt(Math.round(gkg))} kg</span><span style={{fontWeight:600}}>{fmtRs(gval)}</span></div>;
                                })()}
                                {chForGST.transportCharge > 0 && (
                                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, padding:"2px 0" }}>
                                    <span style={{color:"#888"}}>🚚 Transport ({reels[0]?.transportBy||""})</span>
                                    <span style={{fontWeight:600}}>{fmtRs(chForGST.transportCharge)}</span>
                                  </div>
                                )}
                                <div style={{ borderTop:"1px solid #e8e8e8", marginTop:4, paddingTop:4 }}>
                                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, padding:"2px 0" }}><span style={{fontWeight:600,color:"#111"}}>Taxable Total</span><span style={{fontWeight:700}}>{fmtRs(chExGST)}</span></div>
                                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, padding:"2px 0" }}><span style={{color:"#22c55e"}}>CGST {chForGST.gumSacks?.length&&!chForGST.reels?.length?"2.5%":"9%"}</span><span style={{color:"#22c55e",fontWeight:600}}>+{fmtRs(chGST.cgst)}</span></div>
                                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, padding:"2px 0" }}><span style={{color:"#22c55e"}}>SGST {chForGST.gumSacks?.length&&!chForGST.reels?.length?"2.5%":"9%"}</span><span style={{color:"#22c55e",fontWeight:600}}>+{fmtRs(chGST.sgst)}</span></div>
                                </div>
                                <div style={{ borderTop:"1px solid #e8e8e8", marginTop:4, paddingTop:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                                  <span style={{ fontSize:12, fontWeight:700, color:"#111" }}>Total (with GST)</span>
                                  <span style={{ fontSize:16, fontWeight:800, color:"#111" }}>{fmtRs(chGrand)}</span>
                                </div>
                                <div style={{ fontSize:8, color:"#aaa", textAlign:"right" }}>Rounded to nearest ₹1</div>
                              </div>
                            ) : (
                              <div style={{ fontSize:12, color:"#aaa", fontStyle:"italic", padding:"6px 0" }}>Add ₹/kg rates to see totals</div>
                            )}
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:12, color:"#888" }}>
                              <span>{reels.length > 0 ? `${reels.length} reels · ${fmt(Math.round(totalWt))} kg` : ""}{reels.length > 0 && gumSacks.length > 0 ? " · " : ""}{gumSacks.length > 0 ? `${gumSacks.length} gum sacks · ${fmt(Math.round(totalGumWt))} kg` : ""}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Payment status strip */}
                    {(() => {
                      const pmt = pmtEntry;
                      const status = getPaymentStatus(pmt);
                      const badge = paymentStatusBadge(status, pmt?.dueDate);
                      if (!pmt && !ch.customer) return null;
                      return (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em" }}>💳 Payment</span>
                          {pmt ? (
                            <>
                              <span style={{ fontSize: 11, background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color, borderRadius: 5, padding: "2px 8px", fontWeight: 600 }}>{badge.label}</span>
                              {pmt.dueDate && !pmt.paid && <span style={{ fontSize: 11, color: "#aaa" }}>Due {fmtDate(pmt.dueDate)}</span>}
                              {pmt.paid && pmt.paidDate && <span style={{ fontSize: 11, color: "#aaa" }}>on {fmtDate(pmt.paidDate)}</span>}
                              {pmt.creditDays && <span style={{ fontSize: 10, color: "#bbb" }}>{pmt.creditDays}d credit</span>}
                              {!pmt.paid && (
                                markingPaidId === pmt.id ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 6, padding: "4px 6px" }}>
                                    <input type="date" value={markPaidDate} max={today()} onChange={e => setMarkPaidDate(e.target.value)} style={{ fontSize: 11, padding: "2px 5px", minWidth: 0, width: 122 }} />
                                    <button onClick={() => confirmMarkPaid(pmt.id)} style={{ fontSize: 11, background: "#111", color: "#fff", border: "none", borderRadius: 5, padding: "3px 9px", cursor: "pointer" }}>✓</button>
                                    <button onClick={() => setMarkingPaidId(null)} style={{ background: "transparent", color: "#aaa", border: "none", fontSize: 14, cursor: "pointer" }}>×</button>
                                  </div>
                                ) : (
                                  <button onClick={() => startMarkPaid(pmt.id)}
                                    style={{ fontSize: 11, background: "#111", color: "#fff", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer", marginLeft: "auto" }}>✓ Mark Paid</button>
                                )
                              )}
                              {pmt.paid && (
                                <button onClick={() => update(s => { const i = (s.payments||[]).findIndex(p => p.id === pmt.id); if (i !== -1) { s.payments[i].paid = false; s.payments[i].paidDate = null; } })}
                                  style={{ fontSize: 10, background: "transparent", color: "#aaa", border: "1px solid #e0e0e0", borderRadius: 5, padding: "2px 8px", cursor: "pointer", marginLeft: "auto" }}>Undo</button>
                              )}
                            </>
                          ) : (
                            <button onClick={() => {
                              const cd = state.customerData?.[ch.customer]?.creditDays || null;
                              update(s => {
                                if (!s.payments) s.payments = [];
                                if (!s.payments.some(p => p.challanKey === key)) {
                                  s.payments.push(buildPaymentEntry({ challanNo: ch.challanNo, date: ch.date, customer: ch.customer, reels: reels, gumSacks: gumSacks||[] }, cd));
                                }
                              });
                            }} style={{ fontSize: 11, background: "transparent", color: "#8b6914", border: "1px solid #e5dece", borderRadius: 5, padding: "2px 10px", cursor: "pointer" }}>+ Track Payment</button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm cancel sale modal */}
      {confirmDeleteChallan && (
        <div className="modal-bg" onClick={() => setConfirmDeleteChallan(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="serif" style={{ fontSize: 20, marginBottom: 10 }}>Cancel this sale?</div>
            <p style={{ fontSize: 13, color: "#8a8070", marginBottom: 6, lineHeight: 1.6 }}>
              This will mark all <strong>{confirmDeleteChallan.ch.reels.length} reels</strong> from{" "}
              <strong>{confirmDeleteChallan.ch.customer}</strong> as back in stock.
            </p>
            <p style={{ fontSize: 12, color: "#6a6050", marginBottom: 20, lineHeight: 1.6 }}>
              Challan <strong>{confirmDeleteChallan.ch.challanNo || "—"}</strong> stays in your history with a strikethrough, marked <strong>CANCELLED</strong> — so the number isn't reused and the gap is documented. It won't count toward sales totals, customer ledgers, payments, or tempo/transporter runs.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1, justifyContent: "center" }} onClick={() => setConfirmDeleteChallan(null)}>Back</button>
              <button style={{ flex: 1, background: "#b83020", color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontSize: 13, cursor: "pointer" }} onClick={() => deleteChallan(confirmDeleteChallan.ch)}>Yes, Cancel Sale</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────
function weekKey(d) {
  const dt = new Date(d); dt.setHours(0,0,0,0);
  dt.setDate(dt.getDate() + 3 - (dt.getDay() + 6) % 7);
  const w1 = new Date(dt.getFullYear(), 0, 4);
  return `${dt.getFullYear()}-W${String(1 + Math.round(((dt - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)).padStart(2,"0")}`;
}
function weekLabel(ws) {
  if (!ws || !ws.includes("-W")) return ws;
  const [yr, wk] = ws.split("-W");
  const jan4 = new Date(Number(yr), 0, 4);
  const w1Mon = new Date(jan4); w1Mon.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7);
  const mon = new Date(w1Mon); mon.setDate(w1Mon.getDate() + (Number(wk)-1)*7); mon.setHours(0,0,0,0);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  return `${mon.toLocaleDateString("en-IN",{day:"numeric",month:"short"})} – ${sun.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`;
}
function toISOWeek(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return `${d.getFullYear()}-W${String(1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)).padStart(2,"0")}`;
}
function weekToRange(ws) {
  if (!ws || !ws.includes("-W")) return [new Date(), new Date()];
  const [yr, wk] = ws.split("-W");
  const jan4 = new Date(Number(yr), 0, 4);
  const w1Mon = new Date(jan4); w1Mon.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7);
  const mon = new Date(w1Mon); mon.setDate(w1Mon.getDate() + (Number(wk)-1)*7); mon.setHours(0,0,0,0);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6); sun.setHours(23,59,59,999);
  return [mon, sun];
}
function fmtWeekLabel(ws) {
  if (!ws || !ws.includes("-W")) return ws;
  const [mon, sun] = weekToRange(ws);
  return `${mon.toLocaleDateString("en-IN",{day:"numeric",month:"short"})} – ${sun.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`;
}

// ── shared period-filter helper ──
function usePeriod(sold, extraForMonths = []) {
  const [periodMode, setPeriodMode] = useState("month");
  const [selDate, setSelDate] = useState(today());
  const [selWeek, setSelWeek] = useState(toISOWeek(new Date()));
  const monthSource = extraForMonths.length ? [...sold, ...extraForMonths] : sold;
  const [selMonth, setSelMonth] = useState(() => {
    const months = [...new Set(monthSource.map(r => monthKey(r.soldDate)).filter(Boolean))].sort().reverse();
    return months[0] || today().slice(0, 7);
  });
  const allMonths = [...new Set(monthSource.map(r => monthKey(r.soldDate)))].sort().reverse();
  const filter = r => {
    if (periodMode === "all") return true;
    if (periodMode === "day") return r.soldDate === selDate;
    if (periodMode === "week") { const [mon, sun] = weekToRange(selWeek); const d = new Date(r.soldDate); return d >= mon && d <= sun; }
    if (periodMode === "month") return monthKey(r.soldDate) === selMonth;
    return true;
  };
  const periodSold = sold.filter(filter);
  const periodLabel = periodMode === "all" ? "All Time" : periodMode === "day" ? fmtDate(selDate) : periodMode === "week" ? fmtWeekLabel(selWeek) : monthLabel(selMonth);
  const periodFilter = filter; // exposed so callers can apply the same date filter to other (non-`sold`) arrays, e.g. gum stock in BusinessReport
  const PeriodBar = () => (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label className="lbl">Period</label>
          <div style={{ display: "flex", gap: 4 }}>
            {[["day","Day"],["week","Week"],["month","Month"],["all","All"]].map(([v, l]) => (
              <button key={v} onClick={() => setPeriodMode(v)}
                style={{ padding: "6px 12px", borderRadius: 6, border: "1.5px solid", fontSize: 12, cursor: "pointer", fontWeight: periodMode === v ? 700 : 400, background: periodMode === v ? "#1a1a1a" : "#fff", color: periodMode === v ? "#fff" : "#6a6050", borderColor: periodMode === v ? "#1a1a1a" : "#ddd8ce" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {periodMode === "day" && <div><label className="lbl">Date</label><input type="date" value={selDate} onChange={e => setSelDate(e.target.value)} style={{ minWidth: 140 }} /></div>}
        {periodMode === "week" && <div><label className="lbl">Week</label><input type="week" value={selWeek} onChange={e => setSelWeek(e.target.value)} style={{ minWidth: 160 }} /></div>}
        {periodMode === "month" && (
          <div><label className="lbl">Month</label>
            <select value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ minWidth: 130 }}>
              {allMonths.length > 0 ? allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>) : <option value={selMonth}>{monthLabel(selMonth)}</option>}
            </select>
          </div>
        )}
        <div style={{ fontSize: 12, color: "#8b6914", fontWeight: 600, paddingBottom: 4 }}>{periodLabel}</div>
      </div>
    </div>
  );
  return { periodSold, periodLabel, PeriodBar, periodFilter };
}

function ReportsTab({ state }) {
  const [reportTab, setReportTab] = useState("reels"); // "reels" | "liner" | "gum" | "business"
  const [showGST, setShowGST] = useState(false); // ex-GST default
  const allSold = state.stock.filter(r => r.sold && r.soldDate);
  const reelSold = allSold.filter(r => r.productType !== "liner");
  const linerSold = allSold.filter(r => r.productType === "liner");
  const gumSold = (state.gumStock || []).filter(g => g.sold && g.soldDate);

  if (allSold.length === 0 && gumSold.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div><div className="section-eyebrow">Analytics</div><h2>Reports</h2></div>
      <div className="card" style={{ textAlign: "center", padding: 52 }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>📊</div>
        <div style={{ fontSize: 18, color: "#aaa", fontStyle:"italic" }}>No sales data yet.</div>
        <div style={{ fontSize: 13, color: "#aaa", marginTop: 8 }}>Record your first sale to see reports.</div>
      </div>
    </div>
  );

  // GST multiplier helper for display
  const gstMult = (isGum) => showGST ? (isGum ? 1.05 : 1.18) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:10 }}>
        <div><div className="section-eyebrow">Analytics</div><h2>Reports</h2></div>
        {/* GST toggle */}
        <div style={{ display:"flex", background:"#fff", borderRadius:8, padding:3, boxShadow:"var(--shadow-sm)" }}>
          <button onClick={() => setShowGST(false)} style={{ padding:"6px 14px", borderRadius:6, border:"none", fontSize:11, fontWeight:700, cursor:"pointer", background:!showGST?"#111":"transparent", color:!showGST?"#fff":"#aaa" }}>Ex-GST</button>
          <button onClick={() => setShowGST(true)} style={{ padding:"6px 14px", borderRadius:6, border:"none", fontSize:11, fontWeight:700, cursor:"pointer", background:showGST?"#111":"transparent", color:showGST?"#fff":"#aaa" }}>With GST</button>
        </div>
      </div>
      {/* Section switcher */}
      <div style={{ display: "flex", gap: 4, background: "#f5f0e8", borderRadius: 10, padding: 4, alignSelf: "flex-start", flexWrap: "wrap" }}>
        {[["reels","📦 Reels"],["liner","📄 Liner"],["gum","🪣 Gum"],["business","🏢 Full Business"],["payments","💳 Payments"]].map(([t, label]) => (
          <button key={t} onClick={() => setReportTab(t)}
            style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: reportTab === t ? "#fff" : "transparent", color: reportTab === t ? "#1a1a1a" : "#8b6914", fontWeight: reportTab === t ? 600 : 400, fontSize: 13, cursor: "pointer", boxShadow: reportTab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>
      {reportTab === "reels" && <ReelReport state={state} soldData={reelSold} showGST={showGST} />}
      {reportTab === "liner" && <LinerReport state={state} soldData={linerSold} showGST={showGST} />}
      {reportTab === "gum" && <GumReport state={state} soldData={gumSold} showGST={showGST} />}
      {reportTab === "business" && <BusinessReport state={state} reelSold={reelSold} linerSold={linerSold} gumSold={gumSold} allSold={allSold} showGST={showGST} />}
      {reportTab === "payments" && <PaymentsReport state={state} />}
    </div>
  );
}

// ─── REEL REPORT ─────────────────────────────────────────────────────────────
function ReelReport({ state, soldData, showGST }) {
  const { periodSold, periodLabel, PeriodBar } = usePeriod(soldData);
  const sold = soldData;
  const allMonths = [...new Set(sold.map(r => monthKey(r.soldDate)))].sort().reverse();
  const totalKg = periodSold.reduce((s, r) => s + Number(r.weight), 0);

  const gradeMap = {};
  periodSold.forEach(r => {
    const k = `${r.bf} BF ${r.gsm} GSM`;
    if (!gradeMap[k]) gradeMap[k] = { bf: r.bf, gsm: r.gsm, reels: 0, kg: 0, revenue: 0, cost: 0 };
    gradeMap[k].reels++;
    gradeMap[k].kg += Number(r.weight);
    gradeMap[k].revenue += (Number(r.soldRate) || 0) * Number(r.weight);
    gradeMap[k].cost += landedRate(r) * Number(r.weight);
  });
  const sizeMap = {};
  periodSold.forEach(r => { sizeMap[r.size] = (sizeMap[r.size] || 0) + 1; });
  const topSizes = Object.entries(sizeMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const custMap = {};
  periodSold.forEach(r => {
    const c = r.soldTo || "Unknown";
    if (!custMap[c]) custMap[c] = { reels: 0, kg: 0, revenue: 0, profit: 0, sizes: {} };
    custMap[c].reels++; custMap[c].kg += Number(r.weight);
    custMap[c].revenue += (Number(r.soldRate) || 0) * Number(r.weight);
    custMap[c].profit += reelLandedProfit(r);
    custMap[c].sizes[r.size] = (custMap[c].sizes[r.size] || 0) + 1;
  });
  const top5Cust = Object.entries(custMap).sort((a, b) => b[1].kg - a[1].kg).slice(0, 5);
  const last6 = allMonths.slice(0, 6).reverse();
  const trendData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: sold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0) }));

  // Turnaround
  const turnReels = sold.filter(r => r.inwardDate && r.soldDate);
  const turnByGrade = {}; const turnBySize = {};
  turnReels.forEach(r => {
    const days = Math.round((new Date(r.soldDate) - new Date(r.inwardDate)) / 86400000);
    if (days < 0) return;
    const gk = `${r.bf} BF ${r.gsm} GSM`;
    if (!turnByGrade[gk]) turnByGrade[gk] = []; turnByGrade[gk].push(days);
    if (!turnBySize[r.size]) turnBySize[r.size] = []; turnBySize[r.size].push(days);
  });
  const avg = arr => arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null;
  const med = arr => { if (!arr.length) return null; const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };

  // Size × Grade cross-tab
  const allSoldSizes = [...new Set(periodSold.map(r => r.size))].sort((a, b) => Number(a) - Number(b));
  const crossTab = {};
  periodSold.forEach(r => {
    const gk = `${r.bf}|${r.gsm}`;
    if (!crossTab[r.size]) crossTab[r.size] = {};
    if (!crossTab[r.size][gk]) crossTab[r.size][gk] = { reels: 0, kg: 0 };
    crossTab[r.size][gk].reels++; crossTab[r.size][gk].kg += Number(r.weight);
  });
  const crossGradeLabels = [...new Set(periodSold.map(r => `${r.bf}|${r.gsm}`))].sort();
  const sizeRowTotals = {}; allSoldSizes.forEach(sz => { sizeRowTotals[sz] = { reels: 0, kg: 0 }; crossGradeLabels.forEach(gk => { sizeRowTotals[sz].reels += crossTab[sz]?.[gk]?.reels || 0; sizeRowTotals[sz].kg += crossTab[sz]?.[gk]?.kg || 0; }); });
  const gradeColTotals = {}; crossGradeLabels.forEach(gk => { gradeColTotals[gk] = { reels: 0, kg: 0 }; allSoldSizes.forEach(sz => { gradeColTotals[gk].reels += crossTab[sz]?.[gk]?.reels || 0; gradeColTotals[gk].kg += crossTab[sz]?.[gk]?.kg || 0; }); });

  const totalRevenue = periodSold.reduce((s, r) => s + (Number(r.soldRate) || 0) * Number(r.weight), 0);
  const totalTransport = periodSold.reduce((s, r) => s + (Number(r.transportCharge) || 0), 0);
  const totalCost = periodSold.reduce((s, r) => s + landedRate(r) * Number(r.weight), 0);
  const totalProfit = totalRevenue - totalCost;
  const displayRevenue = showGST ? Math.round((totalRevenue + totalTransport) * 1.18) : totalRevenue;
  const avgRatePerKg = totalKg > 0 ? totalRevenue / totalKg : 0;
  const topGrade = Object.entries(gradeMap).sort((a, b) => b[1].kg - a[1].kg)[0];
  const topSize = topSizes[0];

  if (soldData.length === 0) return <div className="card" style={{ textAlign: "center", padding: 40 }}><span style={{ fontSize: 16, color: "#aaa", fontStyle:"italic" }}>No reel sales yet.</span></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeriodBar />
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {[
          { label: "Reels Sold", val: periodSold.length, unit: "reels" },
          { label: "Total Weight", val: fmt(Math.round(totalKg)) + " kg", unit: (totalKg/1000).toFixed(2) + " tons" },
          { label: showGST ? "Revenue (GST incl.)" : "Revenue (Ex-GST)", val: displayRevenue > 0 ? fmtRs(displayRevenue) : "—", unit: showGST ? "18% GST included" : "before GST" },
          { label: "Profit", val: totalProfit !== 0 ? fmtRs(totalProfit) : "—", unit: totalRevenue > 0 ? ((totalProfit/totalRevenue)*100).toFixed(1) + "% margin" : "", color: totalProfit >= 0 ? "#2e7d32" : "#c62828" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div className="lbl">{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, color: k.color || "#111", letterSpacing:"-0.02em" }}>{k.val}</div>
            {k.unit && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>{k.unit}</div>}
          </div>
        ))}
      </div>
      {/* Key Insights */}
      {periodSold.length > 0 && (
        <div className="card" style={{ background: "#111", border: "none" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>⚡ Key Insights — {periodLabel}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {avgRatePerKg > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#888" }}>Avg selling rate</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e8c84a" }}>{fmtRate(avgRatePerKg)}/kg</span>
            </div>}
            {topGrade && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#b0a898" }}>Top grade by volume</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{topGrade[0]} <span style={{ fontSize: 11, color: "#9a9080" }}>({fmt(Math.round(topGrade[1].kg))} kg)</span></span>
            </div>}
            {topSize && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#b0a898" }}>Most sold size</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{topSize[0]}" <span style={{ fontSize: 11, color: "#9a9080" }}>({topSize[1]} reels)</span></span>
            </div>}
            {top5Cust[0] && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#b0a898" }}>Top customer</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{top5Cust[0][0]} <span style={{ fontSize: 11, color: "#9a9080" }}>({fmt(Math.round(top5Cust[0][1].kg))} kg)</span></span>
            </div>}
            {totalProfit > 0 && totalKg > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(45,106,79,0.25)", borderRadius: 8, border: "1px solid rgba(45,106,79,0.4)" }}>
              <span style={{ fontSize: 12, color: "#7ecfa0" }}>Profit per kg</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#7ecfa0" }}>{fmtRate(totalProfit / totalKg)}/kg</span>
            </div>}
          </div>
        </div>
      )}
      {/* Monthly trend */}
      {trendData.length > 1 && (
        <div className="card">
          <h3>Monthly Volume Trend (kg)</h3>
          <BarChart data={trendData} color="#8b6914" />
        </div>
      )}
      {/* Landed cost breakdown */}
      {periodSold.some(r => r.transportRate || r.waraiRate) && (() => {
        const paperCost = periodSold.reduce((s, r) => s + (Number(r.costRate)||0)*Number(r.weight), 0);
        const transportCost = periodSold.reduce((s, r) => s + (Number(r.transportRate)||0)*Number(r.weight), 0);
        const waraiCost = periodSold.reduce((s, r) => s + (Number(r.waraiRate)||0)*Number(r.weight), 0);
        const total = paperCost + transportCost + waraiCost;
        if (total <= 0) return null;
        return (
          <div className="card">
            <h3>Cost Breakdown (Landed)</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Paper Cost", val: paperCost, pct: total > 0 ? (paperCost/total*100).toFixed(1) : 0, color: "#8b6914" },
                { label: "Transport", val: transportCost, pct: total > 0 ? (transportCost/total*100).toFixed(1) : 0, color: "#2a5a8a" },
                { label: "Warai / Labour", val: waraiCost, pct: total > 0 ? (waraiCost/total*100).toFixed(1) : 0, color: "#6a3a8a" },
              ].filter(x => x.val > 0).map(x => (
                <div key={x.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: x.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#6a6050", flex: 1 }}>{x.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{fmtRs(x.val)}</span>
                  <span style={{ fontSize: 11, color: "#9a9080", minWidth: 40, textAlign: "right" }}>{x.pct}%</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #e8e2d8", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#6a6050" }}>Total Landed Cost</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#8b6914" }}>{fmtRs(total)}</span>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Grade breakdown */}
      {Object.keys(gradeMap).length > 0 && (
        <div className="card">
          <h3>Grade Breakdown</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ fontSize: 12 }}>
              <thead><tr><th>Grade</th><th>Reels</th><th>kg</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr></thead>
              <tbody>
                {Object.entries(gradeMap).sort((a, b) => b[1].revenue - a[1].revenue).map(([k, g]) => {
                  const profit = g.revenue - g.cost;
                  const margin = g.revenue > 0 ? (profit / g.revenue * 100).toFixed(1) : "—";
                  const color = profit >= 0 ? "#2d6a4f" : "#b83020";
                  return (
                    <tr key={k}>
                      <td style={{ fontWeight: 600 }}>{k}</td>
                      <td>{g.reels}</td>
                      <td>{fmt(Math.round(g.kg))}</td>
                      <td>{g.revenue > 0 ? fmtRs(g.revenue) : "—"}</td>
                      <td style={{ color: "#8a8070" }}>{g.cost > 0 ? fmtRs(g.cost) : "—"}</td>
                      <td style={{ color, fontWeight: 700 }}>{g.revenue > 0 ? fmtRs(profit) : "—"}</td>
                      <td style={{ color }}>{margin !== "—" ? margin + "%" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Size × Grade cross-tab */}
      {allSoldSizes.length > 0 && crossGradeLabels.length > 0 && (
        <div className="card">
          <h3>Size × Grade Matrix</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Size</th>
                  {crossGradeLabels.map(gk => { const [bf, gsm] = gk.split("|"); return <th key={gk} style={{ textAlign: "center" }}>{bf}BF/{gsm}</th>; })}
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {allSoldSizes.map(sz => {
                  const rowTotal = sizeRowTotals[sz];
                  return (
                    <tr key={sz}>
                      <td><span className="serif" style={{ fontSize: 18 }}>{sz}"</span></td>
                      {crossGradeLabels.map(gk => { const cell = crossTab[sz]?.[gk]; return <td key={gk} style={{ textAlign: "center" }}>{cell ? <><div style={{ fontWeight: 600 }}>{cell.reels}</div><div style={{ fontSize: 9, color: "#9a9080" }}>{fmt(Math.round(cell.kg))}kg</div></> : <span style={{ color: "#ddd" }}>—</span>}</td>; })}
                      <td style={{ textAlign: "right" }}><div style={{ fontWeight: 700 }}>{rowTotal.reels}</div><div style={{ fontSize: 9, color: "#8b6914", fontWeight: 600 }}>{fmt(Math.round(rowTotal.kg))}kg</div></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f5f0e8" }}>
                  <td style={{ fontWeight: 700, fontSize: 12 }}>Total</td>
                  {crossGradeLabels.map(gk => { const col = gradeColTotals[gk]; return <td key={gk} style={{ textAlign: "center" }}><div style={{ fontWeight: 700 }}>{col.reels}</div><div style={{ fontSize: 9, color: "#8b6914", fontWeight: 600 }}>{fmt(Math.round(col.kg))}kg</div></td>; })}
                  <td style={{ textAlign: "right" }}><div style={{ fontWeight: 700 }}>{periodSold.length}</div><div style={{ fontSize: 9, color: "#8b6914", fontWeight: 700 }}>{fmt(Math.round(totalKg))}kg</div></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {/* Top customers */}
      {top5Cust.length > 0 && (
        <div className="card">
          <h3>Top Customers</h3>
          {top5Cust.map(([name, data], idx) => {
            const barW = top5Cust[0] ? (data.kg / top5Cust[0][1].kg) * 100 : 0;
            return (
              <div key={name} style={{ padding: "14px 0", borderBottom: idx < top5Cust.length - 1 ? "1px solid #e8eef8" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 26, height: 26, background: CHART_COLORS[idx], borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>{idx+1}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                      <div style={{ fontSize: 11, color: "#9a9080", marginTop: 1 }}>{data.reels} reels · {fmt(Math.round(data.kg))} kg</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {data.revenue > 0 && <div style={{ fontSize: 12, fontWeight: 700 }}>{fmtRs(data.revenue)}</div>}
                    {data.profit !== 0 && data.revenue > 0 && <div style={{ fontSize: 11, color: data.profit >= 0 ? "#2d6a4f" : "#b83020" }}>{fmtRs(data.profit)} profit</div>}
                  </div>
                </div>
                <div style={{ background: "#e8eef8", borderRadius: 3, height: 3, overflow: "hidden" }}>
                  <div style={{ width: `${barW}%`, height: "100%", background: CHART_COLORS[idx], borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Turnaround */}
      {turnReels.length > 0 && Object.keys(turnByGrade).length > 0 && (
        <div className="card">
          <h3>Turnaround Time by Grade</h3>
          <p style={{ fontSize: 12, color: "#9a9080", marginBottom: 12 }}>Days from inward to sale. Shorter = faster moving stock.</p>
          <div style={{ border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", background: "#f5f0e8", padding: "8px 14px" }}>
              {["Grade","Reels","Avg","Median","Fastest"].map(h => <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#8b6914", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>)}
            </div>
            {Object.entries(turnByGrade).sort((a, b) => (avg(a[1])||0) - (avg(b[1])||0)).map(([grade, days]) => {
              const avgD = avg(days); const color = avgD <= 14 ? "#2d6a4f" : avgD <= 30 ? "#8b6914" : "#b83020";
              return (
                <div key={grade} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", padding: "10px 14px", borderTop: "1px solid #f5f0e8", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{grade}</span>
                  <span style={{ fontSize: 12 }}>{days.length}</span>
                  <span style={{ fontWeight: 700, fontSize: 14, color }}>{avgD}d</span>
                  <span style={{ fontSize: 12, color: "#6a6050" }}>{med(days)}d</span>
                  <span style={{ fontSize: 12, color: "#2d6a4f", fontWeight: 600 }}>{Math.min(...days)}d</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LINER REPORT ─────────────────────────────────────────────────────────────
function LinerReport({ state, soldData, showGST }) {
  const { periodSold, periodLabel, PeriodBar } = usePeriod(soldData);

  const totalKg = periodSold.reduce((s, r) => s + Number(r.weight), 0);
  const totalRevenue = periodSold.reduce((s, r) => s + (Number(r.soldRate) || 0) * Number(r.weight), 0);
  const totalCost = periodSold.reduce((s, r) => s + landedRate(r) * Number(r.weight), 0);
  const totalProfit = totalRevenue - totalCost;
  const totalLabour = periodSold.reduce((s, r) => s + (Number(r.labourRate) || 0) * Number(r.weight), 0);

  // By spec
  const specMap = {};
  periodSold.forEach(r => {
    const k = `${r.bf} BF ${r.gsm} GSM ${r.size}"`;
    if (!specMap[k]) specMap[k] = { bf: r.bf, gsm: r.gsm, size: r.size, liners: 0, kg: 0, revenue: 0, cost: 0 };
    specMap[k].liners++; specMap[k].kg += Number(r.weight);
    specMap[k].revenue += (Number(r.soldRate) || 0) * Number(r.weight);
    specMap[k].cost += landedRate(r) * Number(r.weight);
  });

  // By customer
  const custMap = {};
  periodSold.forEach(r => {
    const c = r.soldTo || "Unknown";
    if (!custMap[c]) custMap[c] = { liners: 0, kg: 0, revenue: 0, profit: 0 };
    custMap[c].liners++; custMap[c].kg += Number(r.weight);
    custMap[c].revenue += (Number(r.soldRate) || 0) * Number(r.weight);
    custMap[c].profit += reelLandedProfit(r);
  });
  const top5Cust = Object.entries(custMap).sort((a, b) => b[1].kg - a[1].kg).slice(0, 5);

  // Monthly trend
  const allMonths = [...new Set(soldData.map(r => monthKey(r.soldDate)))].sort().reverse();
  const last6 = allMonths.slice(0, 6).reverse();
  const trendData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: soldData.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0) }));

  if (soldData.length === 0) return <div className="card" style={{ textAlign: "center", padding: 40 }}><span className="serif-italic" style={{ fontSize: 16, color: "#b0a898" }}>No liner sales yet.</span></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeriodBar />
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {[
          { label: "Liners Sold", val: periodSold.length, unit: "individual liners" },
          { label: "Total Weight", val: fmt(Math.round(totalKg)) + " kg", unit: (totalKg/1000).toFixed(2) + " tons" },
          { label: showGST ? "Revenue (GST incl.)" : "Revenue (Ex-GST)", val: totalRevenue > 0 ? fmtRs(showGST ? Math.round(totalRevenue*1.18) : totalRevenue) : "—", unit: showGST ? "18% GST included" : "before GST" },
          { label: "Profit", val: totalProfit !== 0 ? fmtRs(totalProfit) : "—", unit: totalRevenue > 0 ? ((totalProfit/totalRevenue)*100).toFixed(1) + "% margin" : "", color: totalProfit >= 0 ? "#2e7d32" : "#c62828" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div className="lbl">{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, color: k.color || "#111", letterSpacing:"-0.02em" }}>{k.val}</div>
            {k.unit && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>{k.unit}</div>}
          </div>
        ))}
      </div>
      {/* Key Insights */}
      {periodSold.length > 0 && (() => {
        const avgRate = totalKg > 0 ? totalRevenue / totalKg : 0;
        const topSpec = Object.entries(specMap).sort((a, b) => b[1].kg - a[1].kg)[0];
        const topCust = top5Cust[0];
        const inwardLiners = periodSold.filter(r => r.linerSource === "inward");
        const convertedLiners = periodSold.filter(r => r.linerSource !== "inward");
        return (
          <div className="card" style={{ background: "linear-gradient(135deg, #0f2a20 0%, #1a3428 100%)", border: "none" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#4a8060", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>⚡ Key Insights — {periodLabel}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {avgRate > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "#7ecfa0" }}>Avg selling rate</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e8c84a" }}>{fmtRate(avgRate)}/kg</span>
              </div>}
              {topSpec && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "#7ecfa0" }}>Top liner spec</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{topSpec[0]} <span style={{ fontSize: 11, color: "#5a9070" }}>({fmt(Math.round(topSpec[1].kg))} kg)</span></span>
              </div>}
              {topCust && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "#7ecfa0" }}>Top customer</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{topCust[0]} <span style={{ fontSize: 11, color: "#5a9070" }}>({fmt(Math.round(topCust[1].kg))} kg)</span></span>
              </div>}
              {(inwardLiners.length > 0 || convertedLiners.length > 0) && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "#7ecfa0" }}>Source mix</span>
                <span style={{ fontSize: 12, color: "#fff" }}>
                  {convertedLiners.length > 0 && <span>{convertedLiners.length} converted</span>}
                  {inwardLiners.length > 0 && convertedLiners.length > 0 && <span style={{ color: "#5a9070" }}> · </span>}
                  {inwardLiners.length > 0 && <span>{inwardLiners.length} bought</span>}
                </span>
              </div>}
              {totalProfit > 0 && totalKg > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(45,106,79,0.25)", borderRadius: 8, border: "1px solid rgba(45,106,79,0.4)" }}>
                <span style={{ fontSize: 12, color: "#7ecfa0" }}>Profit per kg</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#7ecfa0" }}>{fmtRate(totalProfit / totalKg)}/kg</span>
              </div>}
            </div>
          </div>
        );
      })()}
      {/* Labour cost card */}
      {totalLabour > 0 && (
        <div className="card" style={{ background: "#f0f7f4", border: "1.5px solid #b5dcc0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="lbl">Total Labour Cost (this period)</div>
              <div className="serif" style={{ fontSize: 22, color: "#2d6a4f" }}>{fmtRs(totalLabour)}</div>
              <div style={{ fontSize: 11, color: "#5a9070", marginTop: 3 }}>Corrugator conversion charges on {fmt(Math.round(totalKg))} kg output</div>
            </div>
            {totalRevenue > 0 && <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#5a9070" }}>Labour as % of revenue</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#2d6a4f" }}>{((totalLabour/totalRevenue)*100).toFixed(1)}%</div>
            </div>}
          </div>
        </div>
      )}
      {/* Monthly trend */}
      {trendData.length > 1 && (
        <div className="card">
          <h3>Monthly Volume Trend (kg)</h3>
          <BarChart data={trendData} color="#3a7a8a" />
        </div>
      )}
      {/* By spec */}
      {Object.keys(specMap).length > 0 && (
        <div className="card">
          <h3>Liner Spec Breakdown</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ fontSize: 12 }}>
              <thead><tr><th>Spec</th><th>Liners</th><th>kg</th><th>Revenue</th><th>Profit</th><th>Margin</th></tr></thead>
              <tbody>
                {Object.entries(specMap).sort((a, b) => b[1].kg - a[1].kg).map(([k, g]) => {
                  const profit = g.revenue - g.cost;
                  const margin = g.revenue > 0 ? (profit / g.revenue * 100).toFixed(1) : "—";
                  const color = profit >= 0 ? "#2d6a4f" : "#b83020";
                  return (
                    <tr key={k}>
                      <td style={{ fontWeight: 600 }}>{k}</td>
                      <td>{g.liners}</td>
                      <td>{fmt(Math.round(g.kg))}</td>
                      <td>{g.revenue > 0 ? fmtRs(g.revenue) : "—"}</td>
                      <td style={{ color, fontWeight: 700 }}>{g.revenue > 0 ? fmtRs(profit) : "—"}</td>
                      <td style={{ color }}>{margin !== "—" ? margin + "%" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Top customers */}
      {top5Cust.length > 0 && (
        <div className="card">
          <h3>Top Liner Customers</h3>
          {top5Cust.map(([name, data], idx) => {
            const barW = top5Cust[0] ? (data.kg / top5Cust[0][1].kg) * 100 : 0;
            return (
              <div key={name} style={{ padding: "14px 0", borderBottom: idx < top5Cust.length - 1 ? "1px solid #e8eef8" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 26, height: 26, background: CHART_COLORS[idx], borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>{idx+1}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                      <div style={{ fontSize: 11, color: "#9a9080", marginTop: 1 }}>{data.liners} liners · {fmt(Math.round(data.kg))} kg</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {data.revenue > 0 && <div style={{ fontSize: 12, fontWeight: 700 }}>{fmtRs(data.revenue)}</div>}
                    {data.profit !== 0 && data.revenue > 0 && <div style={{ fontSize: 11, color: data.profit >= 0 ? "#2d6a4f" : "#b83020" }}>{fmtRs(data.profit)} profit</div>}
                  </div>
                </div>
                <div style={{ background: "#e8eef8", borderRadius: 3, height: 3, overflow: "hidden" }}>
                  <div style={{ width: `${barW}%`, height: "100%", background: CHART_COLORS[idx], borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── BUSINESS REPORT ─────────────────────────────────────────────────────────
function BusinessReport({ state, reelSold, linerSold, gumSold, allSold, showGST }) {
  const { periodSold: periodAll, periodLabel, PeriodBar, periodFilter } = usePeriod(allSold, gumSold || []);
  const periodReels = periodAll.filter(r => r.productType !== "liner");
  const periodLiners = periodAll.filter(r => r.productType === "liner");

  // Gum period filter — apply the same day/week/month/all selection used for reels & liner
  const gumSoldFiltered = (gumSold || []).filter(periodFilter);

  const calc = arr => ({
    count: arr.length,
    kg: arr.reduce((s, r) => s + Number(r.weight), 0),
    revenue: arr.reduce((s, r) => s + (Number(r.soldRate) || 0) * Number(r.weight), 0),
    cost: arr.reduce((s, r) => s + landedRate(r) * Number(r.weight), 0),
  });
  const calcGum = arr => ({
    count: arr.length,
    kg: arr.reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0),
    revenue: arr.reduce((s, g) => s + (Number(g.soldRate) || 0) * Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0),
    cost: arr.reduce((s, g) => s + landedRate(g) * Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0),
  });
  const R = calc(periodReels);
  const L = calc(periodLiners);
  const G = calcGum(gumSoldFiltered);
  const T = {
    count: R.count + L.count + G.count,
    kg: R.kg + L.kg + G.kg,
    revenue: R.revenue + L.revenue + G.revenue,
    cost: R.cost + L.cost + G.cost,
  };
  const reelProfit = R.revenue - R.cost;
  const linerProfit = L.revenue - L.cost;
  const gumProfit = G.revenue - G.cost;
  const totalProfit = T.revenue - T.cost;

  // Monthly combined trend
  const allMonths = [...new Set([...allSold.map(r => monthKey(r.soldDate)), ...(gumSold||[]).map(g => monthKey(g.soldDate))].filter(Boolean))].sort().reverse();
  const last6 = allMonths.slice(0, 6).reverse();
  const trendData = last6.map(m => ({
    label: monthLabel(m).split(" ")[0],
    reels: reelSold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0),
    liner: linerSold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0),
    gum: (gumSold||[]).filter(g => monthKey(g.soldDate) === m).reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0),
  }));

  // Revenue split pie
  const revSplit = [];
  if (R.revenue > 0) revSplit.push({ label: "Reels", value: R.revenue });
  if (L.revenue > 0) revSplit.push({ label: "Liner", value: L.revenue });
  if (G.revenue > 0) revSplit.push({ label: "Gum", value: G.revenue });

  // Profit split pie
  const profSplit = [];
  if (reelProfit > 0) profSplit.push({ label: "Reels", value: reelProfit });
  if (linerProfit > 0) profSplit.push({ label: "Liner", value: linerProfit });
  if (gumProfit > 0) profSplit.push({ label: "Gum", value: gumProfit });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeriodBar />
      {/* Master KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {[
          { label: showGST ? "Total Revenue (GST)" : "Total Revenue", val: T.revenue > 0 ? fmtRs(showGST ? Math.round(R.revenue*1.18 + L.revenue*1.18 + G.revenue*1.05) : T.revenue) : "—", unit: showGST ? "GST included" : "all products" },
          { label: "Total Profit", val: totalProfit !== 0 ? fmtRs(totalProfit) : "—", unit: T.revenue > 0 ? ((totalProfit/T.revenue)*100).toFixed(1) + "% margin" : "", color: totalProfit >= 0 ? "#2e7d32" : "#c62828" },
          { label: "Total Weight", val: fmt(Math.round(T.kg)) + " kg", unit: (T.kg/1000).toFixed(2) + " tons" },
          { label: "Total Orders", val: [...new Set(periodAll.map(r => r.soldChallanNo).filter(Boolean))].length || periodAll.length, unit: "challans dispatched" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div className="lbl">{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, color: k.color || "#111", letterSpacing: "-0.02em" }}>{k.val}</div>
            {k.unit && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>{k.unit}</div>}
          </div>
        ))}
      </div>

      {/* Side-by-side product comparison */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        {[
          { label: "📦 Reels", data: R, profit: reelProfit, color: "#b8860b", bg: "#fff8e7", gstMult: showGST ? 1.18 : 1 },
          { label: "📄 Liner", data: L, profit: linerProfit, color: "#2a5a8a", bg: "#f0f5ff", gstMult: showGST ? 1.18 : 1 },
          { label: "🪣 Gum", data: G, profit: gumProfit, color: "#4a8a3a", bg: "#f0f7ea", gstMult: showGST ? 1.05 : 1 },
        ].map(({ label, data, profit, color, bg, gstMult }) => (
          <div key={label} className="card" style={{ background: bg }}>
            <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 10 }}>{label}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Items sold</span><strong>{data.count}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Weight</span><strong>{fmt(Math.round(data.kg))} kg</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Revenue</span><strong>{data.revenue > 0 ? fmtRs(Math.round(data.revenue * gstMult)) : "—"}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Profit</span><strong style={{ color: profit >= 0 ? "#2e7d32" : "#c62828" }}>{data.revenue > 0 ? fmtRs(profit) : "—"}</strong></div>
              {data.revenue > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Margin</span><strong style={{ color: profit >= 0 ? "#2e7d32" : "#c62828" }}>{((profit/data.revenue)*100).toFixed(1)}%</strong></div>}
              {T.revenue > 0 && data.revenue > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Rev share</span><strong style={{ color }}>{((data.revenue/T.revenue)*100).toFixed(1)}%</strong></div>}
            </div>
          </div>
        ))}
      </div>

      {/* Revenue & Profit split pies */}
      {revSplit.length > 1 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="card">
            <h3>Revenue Split</h3>
            <PieChart data={revSplit} size={140} />
          </div>
          {profSplit.length > 1 && <div className="card">
            <h3>Profit Split</h3>
            <PieChart data={profSplit} size={140} />
          </div>}
        </div>
      )}

      {/* Combined monthly bar chart */}
      {trendData.length > 1 && (
        <div className="card">
          <h3>Monthly Volume — kg</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trendData.map(d => {
              const maxVal = Math.max(...trendData.map(x => x.reels + x.liner), 1);
              const reelW = (d.reels / maxVal) * 100;
              const linerW = (d.liner / maxVal) * 100;
              return (
                <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "#aaa", minWidth: 36 }}>{d.label}</span>
                  <div style={{ flex: 1, display: "flex", gap: 2, height: 16, borderRadius: 4, overflow: "hidden" }}>
                    {d.reels > 0 && <div style={{ width: `${reelW}%`, background: "#b8860b", borderRadius: d.liner === 0 ? 4 : "4px 0 0 4px" }} />}
                    {d.liner > 0 && <div style={{ width: `${linerW}%`, background: "#3a7a8a", borderRadius: d.reels === 0 ? 4 : "0 4px 4px 0" }} />}
                  </div>
                  <span style={{ fontSize: 11, color: "#888", minWidth: 70, textAlign: "right" }}>{fmt(Math.round(d.reels + d.liner))} kg</span>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#b8860b" }}><div style={{ width: 10, height: 10, background: "#b8860b", borderRadius: 2 }} />Reels</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#3a7a8a" }}><div style={{ width: 10, height: 10, background: "#3a7a8a", borderRadius: 2 }} />Liner</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#4a8a3a" }}><div style={{ width: 10, height: 10, background: "#4a8a3a", borderRadius: 2 }} />Gum</span>
            </div>
          </div>
        </div>
      )}

      {/* Key insights dark card */}
      <div className="card" style={{ background: "#111", color: "#fff", border: "none" }}>
        <h3 style={{ color: "#444", marginBottom: 16 }}>Key Insights — {periodLabel}</h3>
        <div className="g3">
          {[
            { label: "Strongest Product", val: R.revenue >= L.revenue && R.revenue >= G.revenue ? "Reels" : L.revenue >= G.revenue ? "Liner" : "Gum", sub: `${fmtRs(Math.max(R.revenue, L.revenue, G.revenue))} revenue` },
            { label: "Best Margin", val: (() => { const rm = R.revenue > 0 ? reelProfit/R.revenue : -Infinity; const lm = L.revenue > 0 ? linerProfit/L.revenue : -Infinity; const gm = G.revenue > 0 ? gumProfit/G.revenue : -Infinity; return rm >= lm && rm >= gm ? "Reels" : lm >= gm ? "Liner" : "Gum"; })(), sub: `${(Math.max(R.revenue > 0 ? (reelProfit/R.revenue)*100 : -Infinity, L.revenue > 0 ? (linerProfit/L.revenue)*100 : -Infinity, G.revenue > 0 ? (gumProfit/G.revenue)*100 : -Infinity)).toFixed(1)}% margin` },
            { label: "Total Business", val: fmtRs(T.revenue), sub: `${fmtRs(totalProfit)} profit` },
          ].map(x => (
            <div key={x.label}>
              <div className="lbl" style={{ color: "#555" }}>{x.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", lineHeight: 1.2, letterSpacing: "-0.02em" }}>{x.val}</div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{x.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}



// ─── OLD REPORTS TAB SHELL (now empty — replaced above) ──────────────────────
// ─── PAYMENTS REPORT ─────────────────────────────────────────────────────────
function PaymentsReport({ state }) {
  const payments = state.payments || [];
  const allMonths = [...new Set(payments.map(p => monthKey(p.challanDate)).filter(Boolean))].sort().reverse();
  const [selMonth, setSelMonth] = useState("");

  const filtered = selMonth ? payments.filter(p => monthKey(p.challanDate) === selMonth) : payments;
  const tracked = filtered.filter(p => p.dueDate);
  const paid = tracked.filter(p => p.paid);
  const unpaid = tracked.filter(p => !p.paid);
  const overdue = unpaid.filter(p => daysDiff(p.dueDate) < 0);
  const dueSoon = unpaid.filter(p => daysDiff(p.dueDate) >= 0 && daysDiff(p.dueDate) <= 7);
  const upcoming = unpaid.filter(p => daysDiff(p.dueDate) > 7);

  const totalOutstanding = unpaid.reduce((s,p)=>s+(p.amount||0),0);
  const totalOverdue = overdue.reduce((s,p)=>s+(p.amount||0),0);
  const totalPaid = paid.reduce((s,p)=>s+(p.amount||0),0);

  // Aging buckets (all unpaid overdue)
  const aging = {"0-30":0,"31-60":0,"61-90":0,"90+":0};
  const allOverdue = payments.filter(p=>!p.paid&&p.dueDate&&daysDiff(p.dueDate)<0);
  allOverdue.forEach(p => { const d=Math.abs(daysDiff(p.dueDate)); if(d<=30) aging["0-30"]+=p.amount||0; else if(d<=60) aging["31-60"]+=p.amount||0; else if(d<=90) aging["61-90"]+=p.amount||0; else aging["90+"]+=p.amount||0; });

  // Dues forecast by month — grouped by DUE date (not challan date), across all
  // tracked unpaid invoices, regardless of the period filter above. This is
  // for forecasting incoming/overdue cash by month rather than by when it was billed.
  const dueMonthMap = {};
  payments.filter(p => !p.paid && p.dueDate).forEach(p => {
    const mk = monthKey(p.dueDate);
    if (!dueMonthMap[mk]) dueMonthMap[mk] = { amount: 0, count: 0, overdueAmount: 0, overdueCount: 0 };
    dueMonthMap[mk].amount += p.amount || 0;
    dueMonthMap[mk].count++;
    if (daysDiff(p.dueDate) < 0) { dueMonthMap[mk].overdueAmount += p.amount || 0; dueMonthMap[mk].overdueCount++; }
  });
  const dueMonthList = Object.entries(dueMonthMap).sort((a, b) => a[0].localeCompare(b[0]));
  const curMonthKey = monthKey(today());

  const exportDuesCSV = () => {
    const rows = payments.filter(p => !p.paid && p.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Customer", "Challan No", "Challan Date", "Due Date", "Due Month", "Amount", "Status", "Days Overdue / Until Due"];
    const lines = [header.map(esc).join(",")];
    rows.forEach(p => {
      const d = daysDiff(p.dueDate);
      const status = d < 0 ? "Overdue" : d <= 7 ? "Due Soon" : "Upcoming";
      lines.push([p.customer || "", p.challanNo || "", p.challanDate || "", p.dueDate || "", monthLabel(monthKey(p.dueDate)), p.amount || 0, status, d].map(esc).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dues_${today()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Per-customer outstanding
  const custOutMap = {};
  payments.filter(p=>!p.paid&&p.dueDate).forEach(p => {
    if (!custOutMap[p.customer]) custOutMap[p.customer] = { outstanding: 0, overdue: 0, count: 0 };
    custOutMap[p.customer].outstanding += p.amount||0;
    custOutMap[p.customer].count++;
    if (daysDiff(p.dueDate) < 0) custOutMap[p.customer].overdue += p.amount||0;
  });
  const custOutList = Object.entries(custOutMap).sort((a,b)=>b[1].outstanding-a[1].outstanding);

  // Collection efficiency per customer
  const custEffMap = {};
  payments.filter(p=>p.paid&&p.paidDate&&p.dueDate).forEach(p => {
    if (!custEffMap[p.customer]) custEffMap[p.customer] = { onTime: 0, late: 0, totalGap: 0 };
    const gap = daysDiff2(p.paidDate, p.dueDate);
    if (gap <= 0) custEffMap[p.customer].onTime++; else custEffMap[p.customer].late++;
    custEffMap[p.customer].totalGap += gap;
  });

  // Monthly collection trend
  const last6 = allMonths.slice(0,6).reverse();
  const trendData = last6.map(m => ({
    label: monthLabel(m).split(" ")[0],
    billed: payments.filter(p=>monthKey(p.challanDate)===m&&p.dueDate).reduce((s,p)=>s+(p.amount||0),0),
    collected: payments.filter(p=>p.paid&&monthKey(p.challanDate)===m).reduce((s,p)=>s+(p.amount||0),0),
  }));

  if (payments.length === 0) return (
    <div className="card" style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>💳</div>
      <div style={{ fontSize: 16, color: "#aaa", fontStyle: "italic" }}>No payment data yet.</div>
      <div style={{ fontSize: 12, color: "#aaa", marginTop: 6 }}>Set a credit period on a customer in History → Customers → their ledger to start tracking.</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Period filter */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <select value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">All Time</option>
          {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={exportDuesCSV}>⬇ Export CSV</button>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        {[
          { label: "Outstanding", val: fmtRs(totalOutstanding), color: "#c62828", bg: "#fce4ec" },
          { label: "Overdue", val: fmtRs(totalOverdue), color: "#c62828", bg: "#fce4ec" },
          { label: "Collected", val: fmtRs(totalPaid), color: "#2e7d32", bg: "#e8f5e9" },
          { label: "Due ≤7d", val: dueSoon.length + " ch", color: "#e65100", bg: "#fff3e0" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "12px 14px", background: k.bg }}>
            <div className="lbl" style={{ color: k.color }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: k.color, lineHeight: 1.2, marginTop: 4, letterSpacing: "-0.02em" }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Aging buckets */}
      {allOverdue.length > 0 && (
        <div className="card">
          <h3>Overdue Aging</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(aging).map(([bucket, amt]) => (
              <div key={bucket} style={{ flex: 1, minWidth: 70, background: amt > 0 ? "#fce4ec" : "#f5f5f5", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: amt > 0 ? "#c62828" : "#aaa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{bucket}d</div>
                <div style={{ fontSize: amt > 0 && amt >= 100000 ? 11 : 14, fontWeight: 800, color: amt > 0 ? "#c62828" : "#ccc", lineHeight: 1.2, wordBreak: "break-all" }}>{amt > 0 ? fmtRs(amt) : "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outstanding by customer — card rows with CH# */}
      {custOutList.length > 0 && (
        <div className="card-flat">
          <div style={{ padding: "10px 14px", background: "#f5f5f5", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
            <h3 style={{ margin: 0 }}>Outstanding by Customer</h3>
          </div>
          {custOutList.map(([name, d], i) => (
            <div key={name} style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: i < custOutList.length-1 ? "1px solid rgba(0,0,0,0.04)" : "none", gap: 10 }}>
              <div style={{ width: 36, height: 36, background: "#111", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                {name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>{d.count} challan{d.count!==1?"s":""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#111" }}>{fmtRs(d.outstanding)}</div>
                {d.overdue > 0 && <div style={{ fontSize: 10, color: "#c62828", fontWeight: 700, marginTop: 1 }}>🔴 {fmtRs(d.overdue)} overdue</div>}
              </div>
            </div>
          ))}
          <div style={{ padding: "10px 14px", background: "#f5f5f5", display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
            <span>Total Outstanding</span><span>{fmtRs(totalOutstanding)}</span>
          </div>
        </div>
      )}

      {/* Dues forecast */}
      {dueMonthList.length > 0 && (
        <div className="card">
          <h3>Dues Forecast by Month</h3>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: -6, marginBottom: 10 }}>By due date — shows cash-flow by month.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {dueMonthList.map(([mk, d]) => {
              const isPast = mk < curMonthKey;
              const isCurrent = mk === curMonthKey;
              return (
                <div key={mk} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: isPast ? "#fce4ec" : isCurrent ? "#fff3e0" : "#f9f9f9" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{monthLabel(mk)}{isCurrent && <span style={{ fontSize: 9, color: "#e65100", marginLeft: 5 }}>this month</span>}</div>
                    <div style={{ fontSize: 10, color: "#aaa" }}>{d.count} invoices{d.overdueCount > 0 ? ` · ${d.overdueCount} overdue` : ""}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: isPast ? "#c62828" : "#111" }}>{fmtRs(d.amount)}</div>
                    {d.overdueAmount > 0 && <div style={{ fontSize: 10, color: "#c62828", fontWeight: 600 }}>{fmtRs(d.overdueAmount)} overdue</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Collection efficiency */}
      {Object.keys(custEffMap).length > 0 && (
        <div className="card">
          <h3>Collection Efficiency</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(custEffMap).sort((a,b)=>(b[1].onTime/(b[1].onTime+b[1].late||1))-(a[1].onTime/(a[1].onTime+a[1].late||1))).map(([name, d]) => {
              const total = d.onTime + d.late;
              const eff = total > 0 ? Math.round((d.onTime/total)*100) : 0;
              const avgGap = total > 0 ? Math.round(d.totalGap/total) : null;
              return (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#f9f9f9", borderRadius: 8 }}>
                  <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{name}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{d.onTime}✓ {d.late}✗</div>
                  {avgGap !== null && <div style={{ fontSize: 11, color: avgGap <= 0 ? "#2e7d32" : "#c62828", fontWeight: 600 }}>{avgGap <= 0 ? `${Math.abs(avgGap)}d early` : `${avgGap}d late`}</div>}
                  <div style={{ fontSize: 12, fontWeight: 800, color: eff >= 80 ? "#2e7d32" : eff >= 50 ? "#e65100" : "#c62828", minWidth: 38, textAlign: "right" }}>{eff}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly trend */}
      {trendData.length > 1 && trendData.some(d => d.billed > 0 || d.collected > 0) && (
        <div className="card">
          <h3>Monthly: Billed vs Collected</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trendData.map(d => {
              const maxVal = Math.max(...trendData.map(x => Math.max(x.billed, x.collected)), 1);
              return (
                <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "#aaa", minWidth: 36 }}>{d.label}</span>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                    {d.billed > 0 && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ height: 8, width: `${(d.billed/maxVal)*100}%`, background: "#b8860b", borderRadius: 4, minWidth: 4 }} />
                      <span style={{ fontSize: 10, color: "#b8860b" }}>{fmtRs(d.billed)}</span>
                    </div>}
                    {d.collected > 0 && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ height: 8, width: `${(d.collected/maxVal)*100}%`, background: "#2e7d32", borderRadius: 4, minWidth: 4 }} />
                      <span style={{ fontSize: 10, color: "#2e7d32" }}>{fmtRs(d.collected)}</span>
                    </div>}
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#b8860b" }}><div style={{ width: 10, height: 10, background: "#b8860b", borderRadius: 2 }} />Billed</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#2e7d32" }}><div style={{ width: 10, height: 10, background: "#2e7d32", borderRadius: 2 }} />Collected</span>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming dues — card rows with CH# */}
      {upcoming.length > 0 && (
        <div className="card-flat">
          <div style={{ padding: "10px 14px", background: "#f5f5f5", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
            <h3 style={{ margin: 0 }}>Upcoming — Due in 8+ Days</h3>
          </div>
          {upcoming.sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).slice(0,10).map((p,i,arr) => (
            <div key={p.id} style={{ display: "flex", alignItems: "stretch", borderBottom: i<arr.length-1?"1px solid rgba(0,0,0,0.04)":"none" }}>
              <div style={{ flexShrink:0, background:"#111", width:48, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"8px 4px", gap:1 }}>
                <div style={{ fontSize:7, color:"#666", textTransform:"uppercase", letterSpacing:"0.06em" }}>CH</div>
                <div style={{ fontSize:13, fontWeight:800, color: p.challanNo?"#fff":"#666", textAlign:"center" }}>{p.challanNo||"—"}</div>
              </div>
              <div style={{ flex:1, padding:"10px 12px" }}>
                <div style={{ fontWeight:700, fontSize:13, color:"#111" }}>{p.customer}</div>
                <div style={{ fontSize:11, color:"#aaa", marginTop:1 }}>{fmtDate(p.challanDate)} · Due {fmtDate(p.dueDate)} <span style={{ color:"#111", fontWeight:600 }}>({daysDiff(p.dueDate)}d)</span></div>
              </div>
              <div style={{ padding:"10px 12px", display:"flex", alignItems:"center" }}>
                <div style={{ fontWeight:800, fontSize:13, color:"#111" }}>{p.amount > 0 ? fmtRs(p.amount) : "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function _OldReportsTabBody({ state }) {
  const sold = state.stock.filter(r => r.sold && r.soldDate);
  const [periodMode, setPeriodMode] = useState("month");
  const [selDate,  setSelDate]  = useState(today());
  const [selWeek,  setSelWeek]  = useState(toISOWeek(new Date()));
  const [selMonth, setSelMonth] = useState(() => {
    const months = [...new Set(sold.map(r => monthKey(r.soldDate)).filter(Boolean))].sort().reverse();
    return months[0] || today().slice(0, 7);
  });

  const periodSold = (() => {
    if (periodMode === "all") return sold;
    if (periodMode === "day") return sold.filter(r => r.soldDate === selDate);
    if (periodMode === "week") {
      const [mon, sun] = weekToRange(selWeek);
      return sold.filter(r => { const d = new Date(r.soldDate); return d >= mon && d <= sun; });
    }
    if (periodMode === "month") return sold.filter(r => monthKey(r.soldDate) === selMonth);
    return sold;
  })();

  const periodLabelStr = (() => {
    if (periodMode === "all") return "All Time";
    if (periodMode === "day") return fmtDate(selDate);
    if (periodMode === "week") return fmtWeekLabel(selWeek);
    if (periodMode === "month") return monthLabel(selMonth);
  })();

  const allMonths = [...new Set(sold.map(r => monthKey(r.soldDate)))].sort().reverse();
  const totalReels = periodSold.length;
  const totalKg = periodSold.reduce((s, r) => s + Number(r.weight), 0);
  const totalTons = totalKg / 1000;

  // Grade map
  const gradeMap = {};
  periodSold.forEach(r => {
    const k = `${r.bf} BF ${r.gsm} GSM`;
    const bk = `${r.bf}|${r.gsm}`;
    if (!gradeMap[k]) gradeMap[k] = { key: bk, bf: r.bf, gsm: r.gsm, reels: 0, kg: 0, revenue: 0, cost: 0 };
    gradeMap[k].reels++;
    gradeMap[k].kg += Number(r.weight);
    gradeMap[k].revenue += (Number(r.soldRate) || 0) * Number(r.weight);
    gradeMap[k].cost += landedRate(r) * Number(r.weight);
  });

  const sizeMap = {};
  periodSold.forEach(r => { sizeMap[r.size] = (sizeMap[r.size] || 0) + 1; });
  const topSizes = Object.entries(sizeMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const custMap = {};
  periodSold.forEach(r => {
    const c = r.soldTo || "Unknown";
    if (!custMap[c]) custMap[c] = { reels: 0, kg: 0, revenue: 0, profit: 0, sizes: {}, grades: {} };
    custMap[c].reels++; custMap[c].kg += Number(r.weight);
    custMap[c].revenue += (Number(r.soldRate) || 0) * Number(r.weight);
    custMap[c].profit += reelLandedProfit(r);
    custMap[c].sizes[r.size] = (custMap[c].sizes[r.size] || 0) + 1;
    custMap[c].grades[`${r.bf} BF ${r.gsm} GSM`] = (custMap[c].grades[`${r.bf} BF ${r.gsm} GSM`] || 0) + 1;
  });
  const top5Cust = Object.entries(custMap).sort((a, b) => b[1].kg - a[1].kg).slice(0, 5);
  const last6 = allMonths.slice(0, 6).reverse();
  const trendData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: sold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0) }));
  const topSize = topSizes[0]?.[0] || "—";
  const showTrend = periodMode === "all" || periodMode === "month";

  // ── Size × Grade cross-tab ──
  const allGradeKeys = [...new Set(state.stock.map(r => `${r.bf}|${r.gsm}`))].sort();
  const allSoldSizes = [...new Set(periodSold.map(r => r.size))].sort((a, b) => Number(a) - Number(b));
  const crossTab = {}; // crossTab[size][gradeKey] = { reels, kg }
  periodSold.forEach(r => {
    const gk = `${r.bf}|${r.gsm}`;
    if (!crossTab[r.size]) crossTab[r.size] = {};
    if (!crossTab[r.size][gk]) crossTab[r.size][gk] = { reels: 0, kg: 0 };
    crossTab[r.size][gk].reels++;
    crossTab[r.size][gk].kg += Number(r.weight);
  });
  const crossGradeLabels = allGradeKeys.filter(gk => periodSold.some(r => `${r.bf}|${r.gsm}` === gk));
  const sizeRowTotals = {}; // size -> {reels, kg}
  allSoldSizes.forEach(sz => {
    sizeRowTotals[sz] = { reels: 0, kg: 0 };
    crossGradeLabels.forEach(gk => {
      sizeRowTotals[sz].reels += crossTab[sz]?.[gk]?.reels || 0;
      sizeRowTotals[sz].kg += crossTab[sz]?.[gk]?.kg || 0;
    });
  });
  const gradeColTotals = {};
  crossGradeLabels.forEach(gk => {
    gradeColTotals[gk] = { reels: 0, kg: 0 };
    allSoldSizes.forEach(sz => {
      gradeColTotals[gk].reels += crossTab[sz]?.[gk]?.reels || 0;
      gradeColTotals[gk].kg += crossTab[sz]?.[gk]?.kg || 0;
    });
  });
  const grandTotal = { reels: periodSold.length, kg: totalKg };

  // ── Turnaround time ──
  // For each sold reel that has both inwardDate and soldDate, compute days held
  const turnReels = sold.filter(r => r.inwardDate && r.soldDate);
  const turnByGrade = {}; // gradeKey -> days[]
  const turnBySize  = {}; // size -> days[]
  turnReels.forEach(r => {
    const days = Math.round((new Date(r.soldDate) - new Date(r.inwardDate)) / 86400000);
    if (days < 0) return; // skip bad data
    const gk = `${r.bf} BF ${r.gsm} GSM`;
    if (!turnByGrade[gk]) turnByGrade[gk] = [];
    turnByGrade[gk].push(days);
    if (!turnBySize[r.size]) turnBySize[r.size] = [];
    turnBySize[r.size].push(days);
  });
  const avg = arr => arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null;
  const med = arr => { if (!arr.length) return null; const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };

  if (sold.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div><div className="section-eyebrow">Analytics</div><h2>Reports</h2></div>
      <div className="card" style={{ textAlign: "center", padding: 52 }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>📊</div>
        <div className="serif-italic" style={{ fontSize: 20, color: "#9a9080" }}>No sales data yet.</div>
        <div style={{ fontSize: 13, color: "#b0a898", marginTop: 6 }}>Record some sales to see your analytics here.</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }} className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div><div className="section-eyebrow">Analytics</div><h2>Reports</h2></div>
        <div className="card" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, minWidth: 260 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[["day","Day"],["week","Week"],["month","Month"],["all","All Time"]].map(([m, label]) => (
              <button key={m} onClick={() => setPeriodMode(m)}
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: `1.5px solid ${periodMode === m ? "#1a1a1a" : "#ddd8ce"}`, background: periodMode === m ? "#1a1a1a" : "transparent", color: periodMode === m ? "#fff" : "#6a6050", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>
          {periodMode === "day"   && <input type="date"  value={selDate}  onChange={e => setSelDate(e.target.value)}  style={{ width: "100%" }} />}
          {periodMode === "week"  && <input type="week"  value={selWeek}  onChange={e => setSelWeek(e.target.value)}  style={{ width: "100%" }} />}
          {periodMode === "month" && <input type="month" value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ width: "100%" }} />}
          {periodMode === "all"   && <div style={{ fontSize: 12, color: "#9a9080", paddingTop: 2 }}>Showing all recorded sales</div>}
          <div style={{ fontSize: 11, color: "#8b6914", fontWeight: 500 }}>{periodLabelStr}</div>
        </div>
      </div>

      {/* ── DATA COMPLETENESS ── */}
      {(() => {
        const allSold = state.stock.filter(r => r.sold);
        const missingSellRate = allSold.filter(r => !r.soldRate);
        const missingCostRate = state.stock.filter(r => !r.costRate);
        const missingChallans = [...new Set(missingSellRate.map(r => r.soldChallanNo || `${r.soldDate}|${r.soldTo}`))];
        const missingShipments = [...new Set(missingCostRate.map(r => r.invoiceNo || `${r.inwardDate}|${r.supplier}`))];
        const totalEntries = [...new Set(allSold.map(r => r.soldChallanNo || `${r.soldDate}|${r.soldTo}`))].length + [...new Set(state.stock.map(r => r.invoiceNo || `${r.inwardDate}|${r.supplier}`))].length;
        const missingCount = missingChallans.length + missingShipments.length;
        const pct = totalEntries > 0 ? Math.round(((totalEntries - missingCount) / totalEntries) * 100) : 100;
        if (missingCount === 0) return (
          <div className="ok-box" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>✓</span><span>All entries have rates set — reports are fully accurate.</span>
          </div>
        );
        return (
          <div style={{ background: "#f5f0e8", border: "1px solid #e5dece", borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>⚠️</span>
                <span style={{ fontWeight: 600, fontSize: 14, color: "#6b5a2e" }}>Report Incomplete — Missing Rates</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ background: "#e5dece", borderRadius: 20, height: 6, width: 100, overflow: "hidden" }}>
                  <div style={{ background: "#8b6914", height: "100%", width: `${pct}%`, borderRadius: 20, transition: "width 0.4s" }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#6b5a2e" }}>{pct}% complete</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {missingChallans.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #e5dece", borderRadius: 10, padding: "10px 14px", flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#6b5a2e", marginBottom: 4 }}>{missingChallans.length} challan{missingChallans.length !== 1 ? "s" : ""} — no sell rate</div>
                  <div style={{ fontSize: 11, color: "#6b5a2e", lineHeight: 1.6 }}>{missingSellRate.length} reels · {fmt(Math.round(missingSellRate.reduce((s,r) => s+Number(r.weight),0)))} kg unpriced</div>
                  <div style={{ fontSize: 11, color: "#6b5a2e", marginTop: 6, fontStyle: "italic" }}>Go to History → open challan → set ₹/kg</div>
                </div>
              )}
              {missingShipments.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #e5dece", borderRadius: 10, padding: "10px 14px", flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#6b5a2e", marginBottom: 4 }}>{missingShipments.length} shipment{missingShipments.length !== 1 ? "s" : ""} — no cost rate</div>
                  <div style={{ fontSize: 11, color: "#6b5a2e", lineHeight: 1.6 }}>{missingCostRate.length} reels · {fmt(Math.round(missingCostRate.reduce((s,r) => s+Number(r.weight),0)))} kg uncosted</div>
                  <div style={{ fontSize: 11, color: "#6b5a2e", marginTop: 6, fontStyle: "italic" }}>Go to Stock → Inward History → set rates</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── KEY STATS ── */}
      <div className="g4">
        {(() => {
          const revenue = periodSold.reduce((s, r) => s + (Number(r.soldRate) || 0) * Number(r.weight), 0);
          const cost = periodSold.reduce((s, r) => s + landedRate(r) * Number(r.weight), 0);
          const profit = revenue - cost;
          return [
            { label: "Reels Sold", val: totalReels, unit: "reels" },
            { label: "Total Weight", val: totalTons.toFixed(2), unit: "tons" },
            { label: "Revenue", val: revenue ? fmtRs(revenue) : "—", unit: "selling value" },
            { label: "Gross Profit", val: profit && revenue ? fmtRs(profit) : "—", unit: revenue ? `${((profit/revenue)*100).toFixed(1)}% margin` : "set rates to calculate" },
          ];
        })().map(s => (
          <div key={s.label} className="card" style={{ padding: "18px 20px" }}>
            <div className="lbl">{s.label}</div>
            <div className="stat-num" style={{ fontSize: 28 }}>{s.val}</div>
            <div className="serif-italic" style={{ fontSize: 12, color: "#b0a898", marginTop: 3 }}>{s.unit}</div>
          </div>
        ))}
      </div>

      {/* ── TREND CHARTS ── */}
      {showTrend && trendData.length > 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <h3>Monthly Weight Dispatched</h3>
            <BarChart data={trendData} color="#8b6914" unit="t" height={100} />
            <div style={{ fontSize: 11, color: "#b0a898", marginTop: 8, fontStyle: "italic" }}>Last {trendData.length} months. Darker bar = most recent.</div>
          </div>
          {(() => {
            const revData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: sold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + (Number(r.soldRate)||0)*Number(r.weight), 0) }));
            const profData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: sold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + reelLandedProfit(r), 0) }));
            const hasRevData = revData.some(d => d.value > 0);
            const hasProfData = profData.some(d => d.value !== 0);
            return (
              <>
                {hasRevData && <div className="card"><h3>Monthly Revenue (₹)</h3><BarChart data={revData} color="#2d6a4f" height={100} /><div style={{ fontSize: 11, color: "#b0a898", marginTop: 8, fontStyle: "italic" }}>Based on challans with selling rates set.</div></div>}
                {hasProfData && <div className="card"><h3>Monthly Gross Profit (₹)</h3><BarChart data={profData} color="#1a1a1a" height={100} /><div style={{ fontSize: 11, color: "#b0a898", marginTop: 8, fontStyle: "italic" }}>Only accurate for challans with both cost and sell rates set.</div></div>}
              </>
            );
          })()}
        </div>
      )}

      {/* ── GRADE REVENUE BREAKDOWN ── */}
      {(() => {
        const gradeEntries = Object.entries(gradeMap).sort((a, b) => b[1].revenue - a[1].revenue);
        const totalRev = gradeEntries.reduce((s, [, v]) => s + v.revenue, 0);
        const totalCostAll = gradeEntries.reduce((s, [, v]) => s + v.cost, 0);
        const maxRev = gradeEntries[0]?.[1].revenue || 1;
        if (gradeEntries.length === 0) return null;
        return (
          <div className="card">
            <h3>Revenue by Grade — {periodLabelStr}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden", marginBottom: 0 }}>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", background: "#f5f0e8", padding: "8px 14px", gap: 8 }}>
                {["Grade","Reels","Weight","Revenue","Gross Profit"].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 600, color: "#8b6914", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>
                ))}
              </div>
              {gradeEntries.map(([label, v], gi) => {
                const profit = v.revenue - v.cost;
                const margin = v.revenue > 0 ? ((profit / v.revenue) * 100).toFixed(1) : null;
                const barPct = maxRev > 0 ? (v.revenue / maxRev) * 100 : 0;
                return (
                  <div key={label} style={{ borderTop: "1px solid #f5f0e8" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", padding: "12px 14px", alignItems: "center", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
                        <div style={{ background: "#e8e2d8", borderRadius: 2, height: 3, marginTop: 5, overflow: "hidden" }}>
                          <div style={{ width: `${barPct}%`, height: "100%", background: CHART_COLORS[gi % CHART_COLORS.length], borderRadius: 2 }} />
                        </div>
                      </div>
                      <div style={{ fontSize: 13 }}>{v.reels}</div>
                      <div style={{ fontSize: 13 }}>{(v.kg/1000).toFixed(2)} t</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: v.revenue > 0 ? "#1a1a1a" : "#b0a898" }}>
                        {v.revenue > 0 ? fmtRs(v.revenue) : "—"}
                        {totalRev > 0 && v.revenue > 0 && <div style={{ fontSize: 10, color: "#9a9080", fontWeight: 400 }}>{((v.revenue/totalRev)*100).toFixed(1)}% of total</div>}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: profit > 0 ? "#2d6a4f" : profit < 0 ? "#b83020" : "#b0a898" }}>
                        {v.cost > 0 ? fmtRs(profit) : "—"}
                        {margin && <div style={{ fontSize: 10, fontWeight: 400 }}>{margin}% margin</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Totals row */}
              <div style={{ background: "#f5f0e8", borderTop: "1px solid #e8e2d8", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", padding: "10px 14px", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>Total</span>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{periodSold.length}</span>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{(totalKg/1000).toFixed(2)} t</span>
                <span style={{ fontWeight: 700, fontSize: 12, color: totalRev > 0 ? "#1a1a1a" : "#b0a898" }}>{totalRev > 0 ? fmtRs(totalRev) : "—"}</span>
                <span style={{ fontWeight: 700, fontSize: 12, color: (totalRev - totalCostAll) > 0 ? "#2d6a4f" : "#b0a898" }}>{totalCostAll > 0 ? fmtRs(totalRev - totalCostAll) : "—"}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── PIE CHARTS ── */}
      <div className="g2">
        <div className="card">
          <h3>Sales by Grade</h3>
          <PieChart data={Object.entries(gradeMap).map(([k, v]) => ({ label: k, value: v.kg }))} size={140} />
          <div className="sep" />
          <table style={{ fontSize: 12 }}>
            <thead><tr><th>Grade</th><th>Reels</th><th>Weight</th></tr></thead>
            <tbody>
              {Object.entries(gradeMap).sort((a, b) => b[1].kg - a[1].kg).map(([k, v]) => (
                <tr key={k}><td style={{ fontWeight: 500 }}>{k}</td><td>{v.reels}</td><td>{fmt(Math.round(v.kg))} kg</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Most Popular Sizes</h3>
          <PieChart data={topSizes.map(([sz, cnt]) => ({ label: sz + '"', value: cnt }))} size={140} />
          <div className="sep" />
          <table style={{ fontSize: 12 }}>
            <thead><tr><th>Size</th><th>Reels Sold</th><th>Share</th></tr></thead>
            <tbody>
              {topSizes.map(([sz, cnt]) => (
                <tr key={sz}>
                  <td><span className="serif" style={{ fontSize: 17 }}>{sz}"</span></td>
                  <td>{cnt}</td>
                  <td style={{ color: "#9a9080" }}>{((cnt / totalReels) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SIZE × GRADE CROSS-TAB ── */}
      {allSoldSizes.length > 0 && crossGradeLabels.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <h3>Size × Grade Breakdown — Reels Sold &amp; Total Weight</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ fontSize: 12, minWidth: crossGradeLabels.length > 1 ? 480 : "auto" }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 56 }}>Size</th>
                  {crossGradeLabels.map(gk => {
                    const [bf, gsm] = gk.split("|");
                    return <th key={gk} style={{ textAlign: "center", minWidth: 90 }}>{bf} BF {gsm}</th>;
                  })}
                  <th style={{ textAlign: "right", minWidth: 90, color: "#1a1a1a" }}>Row Total</th>
                </tr>
              </thead>
              <tbody>
                {allSoldSizes.map(sz => {
                  const rowTotal = sizeRowTotals[sz];
                  return (
                    <tr key={sz}>
                      <td><span className="serif" style={{ fontSize: 19 }}>{sz}"</span></td>
                      {crossGradeLabels.map(gk => {
                        const cell = crossTab[sz]?.[gk];
                        return (
                          <td key={gk} style={{ textAlign: "center" }}>
                            {cell ? (
                              <>
                                <div style={{ fontWeight: 600, color: "#1a1a1a" }}>{cell.reels} reel{cell.reels !== 1 ? "s" : ""}</div>
                                <div style={{ fontSize: 10, color: "#9a9080" }}>{fmt(Math.round(cell.kg))} kg</div>
                              </>
                            ) : <span style={{ color: "#ddd8ce", fontSize: 11 }}>—</span>}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, color: "#1a1a1a" }}>{rowTotal.reels} reels</div>
                        <div style={{ fontSize: 10, color: "#8b6914", fontWeight: 600 }}>{fmt(Math.round(rowTotal.kg))} kg</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f5f0e8" }}>
                  <td style={{ fontWeight: 700, fontSize: 12 }}>Total</td>
                  {crossGradeLabels.map(gk => {
                    const col = gradeColTotals[gk];
                    return (
                      <td key={gk} style={{ textAlign: "center" }}>
                        <div style={{ fontWeight: 700 }}>{col.reels}</div>
                        <div style={{ fontSize: 10, color: "#8b6914", fontWeight: 600 }}>{fmt(Math.round(col.kg))} kg</div>
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{grandTotal.reels}</div>
                    <div style={{ fontSize: 10, color: "#8b6914", fontWeight: 700 }}>{fmt(Math.round(grandTotal.kg))} kg</div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── TOP 5 CUSTOMERS ── */}
      <div className="card">
        <h3>Top 5 Customers</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {top5Cust.map(([name, data], idx) => {
            const topSz = Object.entries(data.sizes).sort((a, b) => b[1] - a[1])[0];
            const barW = top5Cust[0] ? (data.kg / top5Cust[0][1].kg) * 100 : 0;
            return (
              <div key={name} style={{ padding: "16px 0", borderBottom: idx < top5Cust.length - 1 ? "1px solid #e8eef8" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 28, height: 28, background: CHART_COLORS[idx], borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 600 }}>{idx + 1}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                      <div style={{ fontSize: 11, color: "#9a9080", marginTop: 2 }}>{data.reels} reels · {fmt(Math.round(data.kg))} kg · {(data.kg / 1000).toFixed(2)} tons</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {data.revenue > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{fmtRs(data.revenue)}</div>}
                    {data.profit !== 0 && data.revenue > 0 && <div style={{ fontSize: 11, color: data.profit >= 0 ? "#2d6a4f" : "#b83020" }}>{fmtRs(data.profit)} profit</div>}
                    {topSz && <div style={{ fontSize: 11, color: "#9a9080", marginTop: 2 }}>Top: {topSz[0]}" ({topSz[1]}×)</div>}
                  </div>
                </div>
                <div style={{ background: "#e8eef8", borderRadius: 3, height: 4, overflow: "hidden" }}>
                  <div style={{ width: `${barW}%`, height: "100%", background: CHART_COLORS[idx], borderRadius: 3, transition: "width 0.5s ease" }} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {Object.entries(data.sizes).sort((a, b) => b[1] - a[1]).map(([sz, cnt]) => (
                    <span key={sz} className="tag" style={{ fontSize: 10 }}>{sz}" × {cnt}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── TURNAROUND TIME ── */}
      {turnReels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* By Grade */}
          {Object.keys(turnByGrade).length > 0 && (
            <div className="card">
              <h3>Turnaround Time by Grade</h3>
              <p style={{ fontSize: 12, color: "#9a9080", marginBottom: 14, lineHeight: 1.6 }}>Days from inward to sale. Shorter = stock moving faster.</p>
              <div style={{ border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr", background: "#f5f0e8", padding: "8px 14px", gap: 8 }}>
                  {["Grade","Reels","Avg Days","Median","Fastest"].map(h => (
                    <span key={h} style={{ fontSize: 10, fontWeight: 600, color: "#8b6914", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>
                  ))}
                </div>
                {Object.entries(turnByGrade).sort((a, b) => (avg(a[1]) || 0) - (avg(b[1]) || 0)).map(([grade, days], gi, arr) => {
                  const avgD = avg(days); const medD = med(days); const minD = Math.min(...days);
                  const color = avgD <= 14 ? "#2d6a4f" : avgD <= 30 ? "#8b6914" : "#b83020";
                  return (
                    <div key={grade} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr", padding: "12px 14px", gap: 8, borderTop: "1px solid #f5f0e8", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{grade}</span>
                      <span style={{ fontSize: 13 }}>{days.length}</span>
                      <span style={{ fontWeight: 700, fontSize: 14, color }}>{avgD}d</span>
                      <span style={{ fontSize: 13, color: "#6a6050" }}>{medD}d</span>
                      <span style={{ fontSize: 13, color: "#2d6a4f", fontWeight: 600 }}>{minD}d</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* By Size — top 10 slowest */}
          {Object.keys(turnBySize).length > 0 && (
            <div className="card">
              <h3>Turnaround Time by Size — Slowest Moving</h3>
              <p style={{ fontSize: 12, color: "#9a9080", marginBottom: 14, lineHeight: 1.6 }}>Average days held before sale. Sizes with long turnaround may need attention.</p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Size</th>
                      <th>Reels</th>
                      <th>Avg Days</th>
                      <th>Median</th>
                      <th>Slowest</th>
                      <th>Fastest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(turnBySize)
                      .sort((a, b) => (avg(b[1]) || 0) - (avg(a[1]) || 0))
                      .slice(0, 12)
                      .map(([sz, days]) => {
                        const avgD = avg(days); const medD = med(days);
                        const maxD = Math.max(...days); const minD = Math.min(...days);
                        const color = avgD <= 14 ? "#2d6a4f" : avgD <= 30 ? "#8b6914" : "#b83020";
                        return (
                          <tr key={sz}>
                            <td><span className="serif" style={{ fontSize: 19 }}>{sz}"</span></td>
                            <td>{days.length}</td>
                            <td><span style={{ fontWeight: 700, color }}>{avgD}d</span></td>
                            <td style={{ color: "#6a6050" }}>{medD}d</td>
                            <td style={{ color: "#b83020" }}>{maxD}d</td>
                            <td style={{ color: "#2d6a4f", fontWeight: 600 }}>{minD}d</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: "#b0a898", marginTop: 10, fontStyle: "italic" }}>
                Color guide: <span style={{ color: "#2d6a4f", fontWeight: 600 }}>green</span> ≤14d · <span style={{ color: "#8b6914", fontWeight: 600 }}>amber</span> ≤30d · <span style={{ color: "#b83020", fontWeight: 600 }}>red</span> &gt;30d
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── KEY INSIGHTS ── */}
      <div className="card" style={{ background: "#1a1a1a", color: "#f4f7fb", border: "none" }}>
        <h3 style={{ color: "#a09080", marginBottom: 16 }}>Key Insights — {periodLabelStr}</h3>
        <div className="g3">
          {[
            { label: "Top Size", val: topSize + '"', sub: "most reels sold" },
            { label: "Top Customer", val: top5Cust[0]?.[0] || "—", sub: `${fmt(Math.round(top5Cust[0]?.[1].kg || 0))} kg bought` },
            { label: "Top Grade", val: Object.entries(gradeMap).sort((a, b) => b[1].revenue - a[1].revenue)[0]?.[0]?.replace(" GSM","").replace(" BF","BF /") || "—", sub: "by revenue" },
          ].map(x => (
            <div key={x.label}>
              <div className="lbl" style={{ color: "#6a5a4a" }}>{x.label}</div>
              <div className="serif" style={{ fontSize: 22, color: "#f4f7fb", lineHeight: 1.2 }}>{x.val}</div>
              <div className="serif-italic" style={{ fontSize: 12, color: "#6a5a4a", marginTop: 4 }}>{x.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ─── GUM STOCK TAB ──────────────────────────────────────────────────────────
function GumStockTab({ state, update, isEmployee }) {
  const [view, setView] = useState("list"); // "list" | "inward" | "history"
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ supplier: "", invoiceNo: "", date: "", variantId: "", sackWeight: "", numSacks: "", costRate: "", transportRate: "", waraiRate: "" });
  const [openBatch, setOpenBatch] = useState(null);
  const [gumBatchEditId, setGumBatchEditId] = useState(null);
  const [gumBatchEditRates, setGumBatchEditRates] = useState({ costRate: "", transportRate: "", waraiRate: "" });

  useEffect(() => {
    setForm(f => ({ ...f, date: today(), variantId: (state.gumVariants||[])[0]?.id || "" }));
  }, []);

  const variants = state.gumVariants || [];
  const availGum = (state.gumStock || []).filter(g => !g.sold);
  const allGum = state.gumStock || [];

  const saveInward = () => {
    const n = Number(form.numSacks); const sw = Number(form.sackWeight); const cr = Number(form.costRate) || 0;
    const tR = Number(form.transportRate) || 0; const wR = Number(form.waraiRate) || 0;
    if (!form.supplier || !form.variantId || !n || !sw) return;
    const variant = variants.find(v => v.id === form.variantId);
    const batchId = genId();
    const newSacks = Array.from({ length: n }, () => ({
      id: genId(), variantId: form.variantId, variantName: variant?.name || form.variantId,
      sackWeight: sw, costRate: cr, transportRate: tR, waraiRate: wR,
      supplier: form.supplier, invoiceNo: form.invoiceNo,
      inwardDate: form.date, sold: false, batchId,
    }));
    update(s => { if (!s.gumStock) s.gumStock = []; s.gumStock = [...s.gumStock, ...newSacks]; });
    setSaved(true);
    setForm(f => ({ ...f, supplier: "", invoiceNo: "", numSacks: "", sackWeight: "", costRate: "", transportRate: "", waraiRate: "" }));
    setTimeout(() => { setSaved(false); setView("list"); }, 1800);
  };

  // Inward history grouped by batch
  const batches = {};
  allGum.forEach(g => {
    const bk = g.batchId || g.id;
    if (!batches[bk]) batches[bk] = { id: bk, date: g.inwardDate, supplier: g.supplier, invoiceNo: g.invoiceNo, variantId: g.variantId, variantName: g.variantName, sackWeight: g.sackWeight, costRate: g.costRate, sacks: [] };
    batches[bk].sacks.push(g);
  });
  const batchList = Object.values(batches).sort((a, b) => new Date(b.date) - new Date(a.date));

  if (view === "inward") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setView("list")}>← Back</button>
        <div><div className="section-eyebrow">Gum Inward</div><h2>Add Gum Stock</h2></div>
      </div>
      {saved && <div className="ok-box">✓ Gum stock saved!</div>}
      <div className="card">
        <h3>Supplier & Details</h3>
        <div className="g3" style={{ marginBottom: 12 }}>
          <div><label className="lbl">Supplier Name</label><input value={form.supplier} onChange={e => setForm(f => ({...f, supplier: e.target.value}))} placeholder="Supplier name" /></div>
          <div><label className="lbl">Invoice / Note No</label><input value={form.invoiceNo} onChange={e => setForm(f => ({...f, invoiceNo: e.target.value}))} placeholder="e.g. INV/001" /></div>
          <div><label className="lbl">Date</label><input type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} /></div>
        </div>
        <div className="g3">
          <div>
            <label className="lbl">Gum Variant</label>
            <select value={form.variantId} onChange={e => setForm(f => ({...f, variantId: e.target.value}))}>
              <option value="">Select variant</option>
              {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div><label className="lbl">No. of Sacks</label><input type="number" inputMode="numeric" value={form.numSacks} onChange={e => setForm(f => ({...f, numSacks: e.target.value}))} placeholder="e.g. 10" /></div>
          <div><label className="lbl">Weight per Sack (kg)</label><input type="number" inputMode="numeric" value={form.sackWeight} onChange={e => setForm(f => ({...f, sackWeight: e.target.value}))} placeholder="e.g. 25 or 30" /></div>
        </div>
        <div style={{ marginTop: 12, maxWidth: 220 }}>
          <label className="lbl">Cost Rate (₹/kg)</label>
          <input type="number" step="0.01" inputMode="numeric" value={form.costRate} onChange={e => setForm(f => ({...f, costRate: e.target.value}))} placeholder="e.g. 18" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="lbl">Transport Rate (₹/kg)</label>
            <input type="number" step="0.01" inputMode="numeric" value={form.transportRate} onChange={e => setForm(f => ({...f, transportRate: e.target.value}))} placeholder="e.g. 1.30" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="lbl">Warai / Labour (₹/kg)</label>
            <input type="number" step="0.01" inputMode="numeric" value={form.waraiRate} onChange={e => setForm(f => ({...f, waraiRate: e.target.value}))} placeholder="e.g. 0.50" />
          </div>
        </div>
        {form.numSacks && form.sackWeight && (
          <div style={{ marginTop: 14, padding: "10px 14px", background: "#f5f0e8", borderRadius: 8, fontSize: 13 }}>
            <strong>{form.numSacks} sacks × {form.sackWeight} kg = {fmt(Number(form.numSacks) * Number(form.sackWeight))} kg total</strong>
            {form.costRate && (() => {
              const totalKg = Number(form.numSacks) * Number(form.sackWeight);
              const paperCost = totalKg * Number(form.costRate);
              const charges = totalKg * ((Number(form.transportRate)||0) + (Number(form.waraiRate)||0));
              const landed = paperCost + charges;
              return charges > 0
                ? <><span style={{ color: "#8b6914", marginLeft: 10 }}>· {fmtRs(landed)} landed cost</span><span style={{ color: "#9a9080", marginLeft: 6, fontSize: 12 }}>({fmtRs(paperCost)} paper + {fmtRs(charges)} charges)</span></>
                : <span style={{ color: "#8b6914", marginLeft: 10 }}>· {fmtRs(paperCost)} cost value</span>;
            })()}
          </div>
        )}
        <button className="btn btn-dark" style={{ marginTop: 14 }} onClick={saveInward}
          disabled={!form.supplier || !form.variantId || !form.numSacks || !form.sackWeight}>
          ✓ Save Gum Inward
        </button>
      </div>
    </div>
  );

  if (view === "history") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} className="fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setView("list")}>← Back</button>
        <div><div className="section-eyebrow">Gum</div><h2>Inward History</h2></div>
      </div>
      {batchList.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <span className="serif-italic" style={{ fontSize: 16, color: "#b0a898" }}>No gum inward yet.</span>
        </div>
      ) : (
        <div className="card-flat">
          {batchList.map((b, idx) => {
            const isOpen = openBatch === b.id;
            const availCount = b.sacks.filter(g => !g.sold).length;
            const totalKg = b.sacks.length * Number(b.sackWeight || 0);
            const variant = variants.find(v => v.id === b.variantId);
            return (
              <div key={b.id} style={{ borderBottom: idx < batchList.length - 1 ? "1px solid #e8eef8" : "none" }}>
                <div onClick={() => setOpenBatch(p => p === b.id ? null : b.id)}
                  style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, background: isOpen ? "#faf8f4" : "transparent" }}
                  onMouseEnter={e => { if(!isOpen) e.currentTarget.style.background="#faf8f4"; }}
                  onMouseLeave={e => { if(!isOpen) e.currentTarget.style.background="transparent"; }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: variant?.color || "#8b6914", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{b.variantName}</span>
                      <span className="tag tag-green">{b.sacks.length} sacks</span>
                      {availCount < b.sacks.length && <span className="tag tag-red">{b.sacks.length - availCount} sold</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#9a9080" }}>
                      {fmtDate(b.date)} · {b.supplier}{b.invoiceNo ? ` · ${b.invoiceNo}` : ""} · {fmt(totalKg)} kg · {b.sackWeight} kg/sack
                      {b.costRate > 0 && (() => {
                        const sampleSack = b.sacks[0];
                        const tR = Number(sampleSack?.transportRate)||0;
                        const wR = Number(sampleSack?.waraiRate)||0;
                        const totalRate = Number(b.costRate) + tR + wR;
                        return (tR > 0 || wR > 0)
                          ? <span style={{ color: "#8b6914", marginLeft: 6 }}>· {fmtRate(totalRate)}/kg landed</span>
                          : <span style={{ color: "#8b6914", marginLeft: 6 }}>· {fmtRate(b.costRate)}/kg</span>;
                      })()}
                    </div>
                  </div>
                  <div style={{ color: "#c8b89a", fontSize: 16, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</div>
                </div>
                {isOpen && (
                  <div style={{ background: "#faf8f4", borderTop: "1px solid #dde8f5", padding: "12px 16px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {b.sacks.map((g, i) => (
                        <span key={g.id} style={{ background: g.sold ? "#fef0ee" : "#edf7f0", border: `1px solid ${g.sold ? "#f0c0ba" : "#b5dcc0"}`, borderRadius: 5, padding: "4px 10px", fontSize: 12, color: g.sold ? "#9a4030" : "#2d6a4f", fontWeight: 500 }}>
                          Sack {i+1} — {fmt(g.sackWeight)} kg{g.sold ? " · sold" : ""}
                        </span>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 12, color: "#6a6050" }}>
                      {b.sacks.length} sacks · {availCount} available · {fmt(totalKg)} kg total
                      {b.costRate > 0 && (() => {
                        const sampleSack = b.sacks[0];
                        const tR = Number(sampleSack?.transportRate)||0;
                        const wR = Number(sampleSack?.waraiRate)||0;
                        const landed = (Number(b.costRate)+tR+wR)*totalKg;
                        return (tR > 0 || wR > 0)
                          ? <><span style={{ color: "#8b6914", marginLeft: 6, fontWeight: 600 }}>· {fmtRs(landed)} landed</span><span style={{ color: "#9a9080", marginLeft: 4 }}>({fmtRate(Number(b.costRate)+tR+wR)}/kg)</span></>
                          : <span style={{ color: "#8b6914", marginLeft: 6, fontWeight: 600 }}>· {fmtRs(totalKg * Number(b.costRate))} cost value</span>;
                      })()}
                    </div>
                    {/* Edit transport/warai for this batch */}
                    {!isEmployee && (
                      <div style={{ marginTop: 10 }}>
                        {gumBatchEditId === b.id ? (
                          <div style={{ background: "#fff", border: "1.5px solid #8b6914", borderRadius: 8, padding: "12px 14px" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#8b6914", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Edit Rates</div>
                            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                              <div style={{ flex: 1 }}>
                                <label className="lbl">Cost Rate (₹/kg)</label>
                                <input type="number" step="0.01" inputMode="numeric" value={gumBatchEditRates.costRate} onChange={e => setGumBatchEditRates(r => ({...r, costRate: e.target.value}))} placeholder="₹/kg" />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label className="lbl">Transport (₹/kg)</label>
                                <input type="number" step="0.01" inputMode="numeric" value={gumBatchEditRates.transportRate} onChange={e => setGumBatchEditRates(r => ({...r, transportRate: e.target.value}))} placeholder="₹/kg" />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label className="lbl">Warai (₹/kg)</label>
                                <input type="number" step="0.01" inputMode="numeric" value={gumBatchEditRates.waraiRate} onChange={e => setGumBatchEditRates(r => ({...r, waraiRate: e.target.value}))} placeholder="₹/kg" />
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="btn btn-dark btn-sm" style={{ flex: 1, justifyContent: "center" }}
                                onClick={() => {
                                  const cr = Number(gumBatchEditRates.costRate) || 0;
                                  const tR = Number(gumBatchEditRates.transportRate) || 0;
                                  const wR = Number(gumBatchEditRates.waraiRate) || 0;
                                  update(s => {
                                    s.gumStock = (s.gumStock || []).map(g =>
                                      b.sacks.some(x => x.id === g.id) ? { ...g, costRate: cr, transportRate: tR, waraiRate: wR } : g
                                    );
                                  });
                                  setGumBatchEditId(null);
                                }}>✓ Save</button>
                              <button className="btn btn-outline btn-sm" onClick={() => setGumBatchEditId(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button className="btn btn-outline btn-sm"
                            onClick={() => {
                              const sampleSack = b.sacks[0];
                              setGumBatchEditRates({ costRate: String(b.costRate||""), transportRate: String(sampleSack?.transportRate||""), waraiRate: String(sampleSack?.waraiRate||"") });
                              setGumBatchEditId(b.id);
                            }}>₹ Edit Rates</button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── MAIN LIST VIEW ──
  const byVariant = {};
  variants.forEach(v => { byVariant[v.id] = { ...v, sacks: [], totalKg: 0 }; });
  availGum.forEach(g => {
    if (!byVariant[g.variantId]) byVariant[g.variantId] = { id: g.variantId, name: g.variantName || g.variantId, color: "#8a8070", sacks: [], totalKg: 0 };
    byVariant[g.variantId].sacks.push(g);
    byVariant[g.variantId].totalKg += Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT);
  });
  const totalGumKg = availGum.reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div><div className="section-eyebrow">Gum Inventory</div><h2>Pasting Gum Stock</h2></div>
        {!isEmployee && <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setView("history")}>📋 Inward History</button>
          <button className="btn btn-dark" onClick={() => setView("inward")}>+ Add Inward</button>
        </div>}
      </div>
      {availGum.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🪣</div>
          <div className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>No gum in stock yet.</div>
          <div style={{ fontSize: 13, color: "#b0a898", marginTop: 6 }}>
            {!isEmployee && <button className="btn btn-dark btn-sm" onClick={() => setView("inward")}>Add Gum Inward</button>}
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "#6a6050", fontWeight: 500 }}>
            {availGum.length} sacks available · {fmt(Math.round(totalGumKg))} kg total
          </div>
          {Object.values(byVariant).filter(v => v.sacks.length > 0).map(v => (
            <div key={v.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: v.color }} />
                  <span className="serif" style={{ fontSize: 20, fontWeight: 500 }}>{v.name}</span>
                  <span className="tag" style={{ background: "#fef5e8", borderColor: "#f0d5a0", color: "#a05800" }}>{v.sacks.length} sack{v.sacks.length !== 1 ? "s" : ""}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#6a6050" }}>{fmt(Math.round(v.totalKg))} kg</span>
              </div>
              {/* Group sacks by batch for clean display */}
              {(() => {
                const batchGroups = {};
                v.sacks.forEach(g => {
                  const bk = g.batchId || g.id;
                  if (!batchGroups[bk]) batchGroups[bk] = { date: g.inwardDate, supplier: g.supplier, sackWeight: g.sackWeight, sacks: [] };
                  batchGroups[bk].sacks.push(g);
                });
                return Object.values(batchGroups).sort((a, b) => new Date(a.date) - new Date(b.date)).map((bg, bi) => (
                  <div key={bi} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#9a9080", marginBottom: 6 }}>
                      {fmtDate(bg.date)} · {bg.supplier} · {bg.sackWeight} kg/sack
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {bg.sacks.map((g, si) => (
                        <EditableGumSack key={g.id} sack={g} idx={si} update={update} />
                      ))}
                    </div>
                  </div>
                ));
              })()}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e8e2d8", display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "#9a9080" }}>{v.sacks.length} sack{v.sacks.length !== 1 ? "s" : ""} available</span>
                <span style={{ fontWeight: 700, color: "#1a1a1a" }}>{fmt(Math.round(v.totalKg))} kg</span>
              </div>
            </div>
          ))}
          {/* Grand total bar */}
          {Object.values(byVariant).filter(v => v.sacks.length > 0).length > 1 && (
            <div style={{ padding: "12px 18px", background: "#1a1a1a", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#9a9080" }}>{availGum.length} sacks across all variants</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "'Playfair Display', serif" }}>{fmt(Math.round(totalGumKg))} kg total gum</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── EDITABLE GUM SACK ──────────────────────────────────────────────────────
function EditableGumSack({ sack, idx, update }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(sack.sackWeight));
  const [confirmDel, setConfirmDel] = useState(false);
  const save = () => {
    if (!val || isNaN(val)) { setEditing(false); return; }
    update(s => { const i = (s.gumStock||[]).findIndex(x => x.id === sack.id); if (i !== -1) s.gumStock[i].sackWeight = Number(val); });
    setEditing(false);
  };
  const deleteSack = () => {
    update(s => { s.gumStock = (s.gumStock||[]).filter(x => x.id !== sack.id); });
  };
  return (
    <div style={{ background: "#f9f9f9", border: `1.5px solid ${editing ? "#b8860b" : "rgba(0,0,0,0.08)"}`, borderRadius: 8, padding: "7px 10px", textAlign: "center", minWidth: 80 }}>
      {confirmDel ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          <div style={{ fontSize: 9, color: "#c62828", fontWeight: 700 }}>Delete?</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={deleteSack} style={{ background: "#c62828", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>Yes</button>
            <button onClick={() => setConfirmDel(false)} style={{ background: "#eee", color: "#666", border: "none", borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}>No</button>
          </div>
        </div>
      ) : editing ? (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="number" inputMode="numeric" value={val} onChange={e => setVal(e.target.value)}
            style={{ width: 65, padding: "3px 6px", fontSize: 12, textAlign: "center" }} autoFocus
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} onBlur={save} />
          <span style={{ fontSize: 10, color: "#aaa" }}>kg</span>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: "#bbb", marginBottom: 2 }}>#{idx+1}</div>
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{fmt(sack.sackWeight)}</div>
          <div style={{ fontSize: 10, color: "#aaa" }}>kg</div>
          <div style={{ display: "flex", gap: 3, marginTop: 4, justifyContent: "center" }}>
            <button onClick={() => { setEditing(true); setVal(String(sack.sackWeight)); }}
              style={{ background: "transparent", color: "#b8860b", border: "1px solid #e8d48a", borderRadius: 4, padding: "2px 5px", fontSize: 9, cursor: "pointer" }}>Edit</button>
            <button onClick={() => setConfirmDel(true)}
              style={{ background: "transparent", color: "#c62828", border: "1px solid #f48fb1", borderRadius: 4, padding: "2px 5px", fontSize: 9, cursor: "pointer" }}>Del</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── GUM SELL TAB ────────────────────────────────────────────────────────────
function GumSellTab({ state, update }) {
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(today());
  const [transportBy, setTransportBy] = useState("");
  const [selected, setSelected] = useState([]); // sack ids
  const [sellRate, setSellRate] = useState("");
  const [filterVariant, setFilterVariant] = useState("");
  const [done, setDone] = useState(null);

  const suggestedChallan = (() => {
    const allSoldStock = [...(state.stock||[]).filter(r => r.sold && r.soldChallanNo && r.soldDate), ...(state.gumStock||[]).filter(g => g.sold && g.soldChallanNo && g.soldDate)];
    const last = allSoldStock.sort((a, b) => new Date(b.soldDate||b.soldDate) - new Date(a.soldDate)).find(x => x.soldChallanNo)?.soldChallanNo || "";
    if (!last) return "";
    const m = last.match(/^(.*?)(\d+)$/);
    return m ? m[1] + (parseInt(m[2], 10) + 1) : "";
  })();
  const [challanNo, setChallanNo] = useState(suggestedChallan);

  const variants = state.gumVariants || [];
  const availGum = (state.gumStock || []).filter(g => !g.sold);
  const filtered = filterVariant ? availGum.filter(g => g.variantId === filterVariant) : availGum;
  const selSacks = availGum.filter(g => selected.includes(g.id));
  const totalKg = selSacks.reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
  const totalValue = sellRate ? Number(sellRate) * totalKg : 0;

  const toggleSack = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectAll = () => setSelected(filtered.map(g => g.id));
  const clearAll = () => setSelected([]);

  const sell = () => {
    if (!customer || selected.length === 0) return;
    update(s => {
      if (!s.gumStock) s.gumStock = [];
      s.gumStock = s.gumStock.map(g => {
        if (!selected.includes(g.id)) return g;
        return { ...g, sold: true, soldDate: date, soldTo: customer, soldChallanNo: challanNo, soldRate: Number(sellRate) || 0, transportBy: transportBy.trim() || undefined };
      });
      if (customer.trim() && !(s.customers||[]).some(x=>x.trim().toLowerCase()===customer.trim().toLowerCase())) {
        s.customers = [...(s.customers||[]), customer.trim()].sort();
      }
      if (transportBy.trim() && !(s.transporters||[]).some(x=>x.trim().toLowerCase()===transportBy.trim().toLowerCase())) {
        s.transporters = [...(s.transporters||[]), transportBy.trim()].sort();
      }
      // Auto-create payment entry
      const creditDays = s.customerData?.[customer]?.creditDays || null;
      if (creditDays && challanNo) {
        if (!s.payments) s.payments = [];
        const challanKey = challanNo || `__${date}__${customer}`;
        if (!s.payments.some(p => p.challanKey === challanKey)) {
          const gumList = s.gumStock.filter(g => selected.includes(g.id));
          const chObj = { challanNo, date, customer, reels: [], gumSacks: gumList };
          s.payments = [...s.payments, buildPaymentEntry(chObj, creditDays)];
        }
      }
    });
    setDone({ count: selected.length, kg: totalKg, customer, val: totalValue });
  };

  if (done) return (
    <div className="card fade-in" style={{ textAlign: "center", padding: 56 }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>✓</div>
      <div className="serif" style={{ fontSize: 28 }}>Gum Sale Recorded</div>
      <div style={{ fontSize: 13, color: "#8a8070", marginTop: 8 }}>{done.count} sacks · {fmt(done.kg)} kg{done.val ? ` · ${fmtRs(done.val)}` : ""} → {done.customer}</div>
      <button className="btn btn-dark" style={{ marginTop: 22 }} onClick={() => { setDone(null); setSelected([]); setCustomer(""); setChallanNo(suggestedChallan); setSellRate(""); setTransportBy(""); }}>Record Another Sale</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div><div className="section-eyebrow">Gum Dispatch</div><h2>Sell Pasting Gum</h2></div>
      <div className="card">
        <h3>Sale Details</h3>
        <div className="g3">
          <div><label className="lbl">Customer Name</label><CustomerInput value={customer} onChange={setCustomer} customers={state.customers||[]} placeholder="Customer name" /></div>
          <div><label className="lbl">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><label className="lbl">Challan No{suggestedChallan ? <span style={{ color: "#8b6914", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · shared seq.</span> : ""}</label>
            <input value={challanNo} onChange={e => setChallanNo(e.target.value)} placeholder="e.g. 315" /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label className="lbl">Transport By <span style={{ fontWeight: 400, color: "#b0a898", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
          <TransporterInput value={transportBy} onChange={setTransportBy} transporters={state.transporters||[]} />
        </div>
      </div>
      {customer && (
        <div className="card">
          <h3>Selling Rate — ₹/kg</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="number" step="0.01" inputMode="numeric" value={sellRate} onChange={e => setSellRate(e.target.value)} placeholder="e.g. 24" style={{ width: 120 }} />
            <span style={{ fontSize: 12, color: "#9a9080" }}>per kg (applied to all sacks in this challan)</span>
            {totalKg > 0 && sellRate && <span style={{ fontSize: 14, fontWeight: 700, color: "#8b6914", marginLeft: "auto" }}>{fmtRs(totalValue)}</span>}
          </div>
        </div>
      )}
      <div className="card">
        <h3>Select Gum Sacks to Sell</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 160 }}>
            <label className="lbl">Filter Variant</label>
            <select value={filterVariant} onChange={e => setFilterVariant(e.target.value)}>
              <option value="">All Variants</option>
              {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, paddingBottom: 2 }}>
            <button className="btn btn-outline btn-sm" onClick={selectAll}>Select All ({filtered.length})</button>
            <button className="btn btn-outline btn-sm" onClick={clearAll}>Clear</button>
          </div>
          <span style={{ fontSize: 12, color: "#9a9080", paddingBottom: 4 }}>{filtered.length} available · {selected.length} selected</span>
        </div>
        {availGum.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24, color: "#b0a898" }}><span className="serif-italic">No gum sacks available.</span></div>
        ) : (
          <>
            {/* Group by variant for display */}
            {(filterVariant ? variants.filter(v => v.id === filterVariant) : variants).map(v => {
              const vSacks = filtered.filter(g => g.variantId === v.id);
              if (vSacks.length === 0) return null;
              return (
                <div key={v.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: v.color }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</span>
                    <span style={{ fontSize: 11, color: "#9a9080" }}>— {vSacks.length} sacks available</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {vSacks.map(g => {
                      const sel = selected.includes(g.id);
                      return (
                        <div key={g.id} onClick={() => toggleSack(g.id)}
                          style={{ cursor: "pointer", background: sel ? "#fdf9f0" : "#f8f7f4", border: `2px solid ${sel ? "#8b6914" : "#e8e2d8"}`, borderRadius: 9, padding: "8px 12px", textAlign: "center", minWidth: 80, transition: "all 0.1s" }}>
                          <div style={{ width: 18, height: 18, border: `2px solid ${sel ? "#8b6914" : "#ccc"}`, borderRadius: 4, background: sel ? "#8b6914" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 4px" }}>
                            {sel && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                          </div>
                          <div className="serif" style={{ fontSize: 18, lineHeight: 1 }}>{fmt(g.sackWeight)}</div>
                          <div style={{ fontSize: 10, color: "#9a9080" }}>kg</div>
                          <div style={{ fontSize: 9, color: "#b0a898", marginTop: 2 }}>{fmtDate(g.inwardDate)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
      {selected.length > 0 && (
        <div className="card" style={{ border: "1.5px solid #ddd8ce" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="lbl">Selected for Sale</div>
              <div className="serif" style={{ fontSize: 26, lineHeight: 1.1 }}>{selected.length} sacks · {fmt(totalKg)} kg</div>
              {totalValue > 0 && <div style={{ fontSize: 14, color: "#8b6914", fontWeight: 700, marginTop: 4 }}>{fmtRs(totalValue)}</div>}
              {!customer && <div style={{ fontSize: 11, color: "#b83020", marginTop: 6 }}>Enter customer name to confirm.</div>}
            </div>
            <button className="btn btn-dark" style={{ fontSize: 14, padding: "12px 28px" }} onClick={sell} disabled={!customer}>✓ Confirm Sale</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GUM REPORT ──────────────────────────────────────────────────────────────
function GumReport({ state, soldData, showGST }) {
  const variants = state.gumVariants || [];
  const allGumSold = soldData || [];

  // Simple period filter
  const allMonths = [...new Set(allGumSold.map(g => monthKey(g.soldDate)).filter(Boolean))].sort().reverse();
  const [selMonth, setSelMonth] = useState(allMonths[0] || "");
  const [periodMode, setPeriodMode] = useState("all");

  const periodSold = periodMode === "all" ? allGumSold : allGumSold.filter(g => monthKey(g.soldDate) === selMonth);

  const totalKg = periodSold.reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
  const totalSacks = periodSold.length;
  const totalRevenue = periodSold.reduce((s, g) => s + (Number(g.soldRate)||0) * Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
  const totalCost = periodSold.reduce((s, g) => s + landedRate(g) * Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0);
  const totalProfit = totalRevenue - totalCost;

  // By variant
  const variantMap = {};
  periodSold.forEach(g => {
    const k = g.variantId;
    const vName = variants.find(v => v.id === k)?.name || g.variantName || k;
    if (!variantMap[k]) variantMap[k] = { name: vName, color: variants.find(v => v.id === k)?.color || "#8b6914", sacks: 0, kg: 0, revenue: 0, cost: 0 };
    variantMap[k].sacks++;
    variantMap[k].kg += Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT);
    variantMap[k].revenue += (Number(g.soldRate)||0) * Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT);
    variantMap[k].cost += landedRate(g) * Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT);
  });

  // By customer
  const custMap = {};
  periodSold.forEach(g => {
    const c = g.soldTo || "Unknown";
    if (!custMap[c]) custMap[c] = { sacks: 0, kg: 0, revenue: 0, profit: 0 };
    custMap[c].sacks++; custMap[c].kg += Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT);
    custMap[c].revenue += (Number(g.soldRate)||0) * Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT);
    custMap[c].profit += gumLandedProfit(g);
  });
  const top5Cust = Object.entries(custMap).sort((a, b) => b[1].kg - a[1].kg).slice(0, 5);

  // Monthly trend (last 6)
  const last6 = allMonths.slice(0, 6).reverse();
  const trendData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: allGumSold.filter(g => monthKey(g.soldDate) === m).reduce((s, g) => s + Number(g.sackWeight || DEFAULT_GUM_SACK_WEIGHT), 0) }));

  // Variant split pie
  const variantPie = Object.values(variantMap).filter(v => v.kg > 0).map(v => ({ label: v.name, value: v.kg }));

  if (allGumSold.length === 0) return (
    <div className="card" style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🪣</div>
      <span className="serif-italic" style={{ fontSize: 16, color: "#b0a898" }}>No gum sales yet.</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Period bar */}
      <div className="card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="lbl">Period</label>
            <div style={{ display: "flex", gap: 4 }}>
              {[["all","All Time"],["month","Month"]].map(([v, l]) => (
                <button key={v} onClick={() => setPeriodMode(v)}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1.5px solid", fontSize: 12, cursor: "pointer", fontWeight: periodMode === v ? 700 : 400, background: periodMode === v ? "#1a1a1a" : "#fff", color: periodMode === v ? "#fff" : "#6a6050", borderColor: periodMode === v ? "#1a1a1a" : "#ddd8ce" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {periodMode === "month" && (
            <div>
              <label className="lbl">Month</label>
              <select value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ minWidth: 130 }}>
                {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {[
          { label: "Sacks Sold", val: totalSacks, unit: "sacks" },
          { label: "Total Weight", val: fmt(Math.round(totalKg)) + " kg", unit: (totalKg/1000).toFixed(2) + " tons" },
          { label: showGST ? "Revenue (GST incl.)" : "Revenue (Ex-GST)", val: totalRevenue > 0 ? fmtRs(showGST ? Math.round(totalRevenue*1.05) : totalRevenue) : "—", unit: showGST ? "5% GST included" : "before GST" },
          { label: "Profit", val: totalProfit !== 0 ? fmtRs(totalProfit) : "—", unit: totalRevenue > 0 ? ((totalProfit/totalRevenue)*100).toFixed(1) + "% margin" : "", color: totalProfit >= 0 ? "#2e7d32" : "#c62828" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div className="lbl">{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, color: k.color || "#111", letterSpacing:"-0.02em" }}>{k.val}</div>
            {k.unit && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>{k.unit}</div>}
          </div>
        ))}
      </div>

      {/* Key insights */}
      {periodSold.length > 0 && (
        <div className="card" style={{ background: "linear-gradient(135deg, #1a2a10 0%, #253520 100%)", border: "none" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#4a7a30", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>⚡ Key Insights</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {totalKg > 0 && totalRevenue > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.07)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#90c070" }}>Avg sell rate</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e8c84a" }}>{fmtRate(totalRevenue/totalKg)}/kg</span>
            </div>}
            {Object.values(variantMap).length > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.07)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#90c070" }}>Top variant</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                {Object.values(variantMap).sort((a,b) => b.kg-a.kg)[0]?.name} <span style={{ fontSize: 11, color: "#5a9040" }}>({fmt(Math.round(Object.values(variantMap).sort((a,b) => b.kg-a.kg)[0]?.kg || 0))} kg)</span>
              </span>
            </div>}
            {top5Cust[0] && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.07)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#90c070" }}>Top customer</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{top5Cust[0][0]} <span style={{ fontSize: 11, color: "#5a9040" }}>({top5Cust[0][1].sacks} sacks)</span></span>
            </div>}
            {totalProfit > 0 && totalKg > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(45,106,79,0.25)", borderRadius: 8, border: "1px solid rgba(45,106,79,0.4)" }}>
              <span style={{ fontSize: 12, color: "#7ecfa0" }}>Profit per kg</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#7ecfa0" }}>{fmtRate(totalProfit/totalKg)}/kg</span>
            </div>}
          </div>
        </div>
      )}

      {/* Variant breakdown */}
      {Object.values(variantMap).length > 0 && (
        <div className="card">
          <h3>By Variant</h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
            {variantPie.length > 1 && <PieChart data={variantPie} size={130} />}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ fontSize: 12 }}>
              <thead><tr><th>Variant</th><th>Sacks</th><th>kg</th><th>Revenue</th><th>Profit</th><th>Margin</th></tr></thead>
              <tbody>
                {Object.entries(variantMap).sort((a, b) => b[1].kg - a[1].kg).map(([k, v]) => {
                  const profit = v.revenue - v.cost;
                  const margin = v.revenue > 0 ? (profit/v.revenue*100).toFixed(1) : "—";
                  const color = profit >= 0 ? "#2d6a4f" : "#b83020";
                  return (
                    <tr key={k}>
                      <td><div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: v.color }} />{v.name}</div></td>
                      <td>{v.sacks}</td>
                      <td>{fmt(Math.round(v.kg))}</td>
                      <td>{v.revenue > 0 ? fmtRs(v.revenue) : "—"}</td>
                      <td style={{ color, fontWeight: 700 }}>{v.revenue > 0 ? fmtRs(profit) : "—"}</td>
                      <td style={{ color }}>{margin !== "—" ? margin + "%" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly trend */}
      {trendData.length > 1 && (
        <div className="card">
          <h3>Monthly Volume Trend (kg)</h3>
          <BarChart data={trendData} color="#6a8a3a" />
        </div>
      )}

      {/* Top customers */}
      {top5Cust.length > 0 && (
        <div className="card">
          <h3>Top Customers</h3>
          {top5Cust.map(([name, data], idx) => {
            const barW = top5Cust[0] ? (data.kg / top5Cust[0][1].kg) * 100 : 0;
            return (
              <div key={name} style={{ padding: "12px 0", borderBottom: idx < top5Cust.length-1 ? "1px solid #e8eef8" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 26, height: 26, background: CHART_COLORS[idx], borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>{idx+1}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                      <div style={{ fontSize: 11, color: "#9a9080", marginTop: 1 }}>{data.sacks} sacks · {fmt(Math.round(data.kg))} kg</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {data.revenue > 0 && <div style={{ fontSize: 12, fontWeight: 700 }}>{fmtRs(data.revenue)}</div>}
                    {data.profit !== 0 && data.revenue > 0 && <div style={{ fontSize: 11, color: data.profit >= 0 ? "#2d6a4f" : "#b83020" }}>{fmtRs(data.profit)} profit</div>}
                  </div>
                </div>
                <div style={{ background: "#e8eef8", borderRadius: 3, height: 3, overflow: "hidden" }}>
                  <div style={{ width: `${barW}%`, height: "100%", background: CHART_COLORS[idx], borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inward history summary */}
      {(() => {
        const allBatches = {};
        (state.gumStock||[]).forEach(g => {
          const bk = g.batchId || g.id;
          if (!allBatches[bk]) allBatches[bk] = { date: g.inwardDate, supplier: g.supplier, variantName: g.variantName, sackWeight: g.sackWeight, total: 0, sold: 0 };
          allBatches[bk].total++;
          if (g.sold) allBatches[bk].sold++;
        });
        const batches = Object.values(allBatches).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
        if (batches.length === 0) return null;
        return (
          <div className="card">
            <h3>Recent Inward Batches</h3>
            <div style={{ border: "1px solid #e8e2d8", borderRadius: 10, overflow: "hidden" }}>
              {batches.map((b, i) => (
                <div key={i} style={{ padding: "10px 14px", borderBottom: i < batches.length-1 ? "1px solid #f0ece4" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{b.variantName} <span style={{ fontSize: 11, color: "#9a9080" }}>· {b.supplier}</span></div>
                    <div style={{ fontSize: 11, color: "#9a9080" }}>{fmtDate(b.date)} · {b.sackWeight} kg/sack</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{b.total} sacks</div>
                    <div style={{ fontSize: 11, color: b.sold === b.total ? "#b83020" : "#2d6a4f" }}>{b.total - b.sold} remaining</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function SettingsTab({ state, update }) {
  const [newGrade, setNewGrade] = useState({ bf: "", gsm: "", shade: "golden" });
  const [msg, setMsg] = useState("");
  const addGrade = () => {
    if (!newGrade.bf || !newGrade.gsm) return;
    const label = `${newGrade.bf} BF ${newGrade.gsm} GSM ${newGrade.shade.charAt(0).toUpperCase() + newGrade.shade.slice(1)}`;
    if (state.grades.find(g => g.bf === newGrade.bf && g.gsm === newGrade.gsm && g.shade === newGrade.shade)) { setMsg("Grade already exists."); return; }
    update(s => { s.grades = [...s.grades, { ...newGrade, label }]; });
    setNewGrade({ bf: "", gsm: "", shade: "golden" }); setMsg("✓ Grade added!"); setTimeout(() => setMsg(""), 2500);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div><div className="section-eyebrow">Configuration</div><h2>Settings</h2></div>
      {msg && <div className="ok-box">{msg}</div>}
      <div className="card">
        <h3>Paper Grades</h3>
        {state.grades.map(g => (
          <div key={g.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #e8eef8" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 500 }}>{g.label}</span>
              <span className="tag" style={{ textTransform: "capitalize" }}>{g.shade}</span>
            </div>
            <button onClick={() => update(s => { s.grades = s.grades.filter(x => x.label !== g.label); })} style={{ background: "transparent", color: "#b83020", border: "1.5px solid #f0c0ba", borderRadius: 6, padding: "5px 12px", fontSize: 12 }}>Remove</button>
          </div>
        ))}
        <div className="sep" />
        <h3>Add New Grade</h3>
        <div className="g3" style={{ alignItems: "flex-end" }}>
          <div><label className="lbl">BF</label><input value={newGrade.bf} onChange={e => setNewGrade(g => ({ ...g, bf: e.target.value }))} placeholder="e.g. 20" /></div>
          <div><label className="lbl">GSM</label><input value={newGrade.gsm} onChange={e => setNewGrade(g => ({ ...g, gsm: e.target.value }))} placeholder="e.g. 160" /></div>
          <div><label className="lbl">Shade</label><select value={newGrade.shade} onChange={e => setNewGrade(g => ({ ...g, shade: e.target.value }))}>{SHADE_OPTIONS.map(o => <option key={o}>{o}</option>)}</select></div>
        </div>
        <button className="btn btn-dark" style={{ marginTop: 12 }} onClick={addGrade}>+ Add Grade</button>
      </div>
      <div className="card">
        <h3>Pasting Gum Variants</h3>
        <p style={{ fontSize: 12, color: "#8a8070", marginBottom: 12, lineHeight: 1.6 }}>Name your gum variants once you receive the bill tomorrow. These names appear throughout inward, sales, history and reports.</p>
        {(state.gumVariants || []).map((v, vi) => (
          <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: "1px solid #f0ece4" }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: v.color, flexShrink: 0 }} />
            <input value={v.name} onChange={e => update(s => { s.gumVariants[vi].name = e.target.value; })}
              style={{ flex: 1, maxWidth: 260 }} placeholder="e.g. Tapioca Gum" />
            <input value={v.color} type="color" onChange={e => update(s => { s.gumVariants[vi].color = e.target.value; })}
              style={{ width: 36, height: 32, padding: 2, border: "1.5px solid #ddd8ce", borderRadius: 6, cursor: "pointer" }} />
            {(state.gumVariants||[]).length > 1 && (
              <button onClick={() => update(s => { s.gumVariants = s.gumVariants.filter(x => x.id !== v.id); })}
                style={{ background: "transparent", color: "#b83020", border: "1.5px solid #f0c0ba", borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>Remove</button>
            )}
          </div>
        ))}
        <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }}
          onClick={() => update(s => { s.gumVariants = [...(s.gumVariants||[]), { id: genId(), name: "New Variant", color: "#8a6a3a" }]; })}>
          + Add Variant
        </button>
      </div>
      <div className="card">
        <h3>Data & Sync</h3>
        <p style={{ fontSize: 13, color: "#8a8070", lineHeight: 1.7 }}>All data saves to Firebase in real time. Any change made on one device appears instantly on all others — phones, laptops, tablets.</p>
        <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#9a9080" }}>
          <span>📦 {state.stock.filter(r => r.productType !== "liner").length} reels</span>
          <span>📄 {state.stock.filter(r => r.productType === "liner").length} liners</span>
          <span>🪣 {(state.gumStock||[]).filter(g => !g.sold).length} gum sacks</span>
          <span>✅ {state.stock.filter(r => r.sold).length + (state.gumStock||[]).filter(g => g.sold).length} sold</span>
          <span>📊 {[...new Set(state.stock.filter(r => r.sold).map(r => monthKey(r.soldDate)).filter(Boolean))].length} months of data</span>
        </div>
      </div>
      <div className="card" style={{ border: "1px solid #f0c0ba" }}>
        <h3 style={{ color: "#b83020" }}>Danger Zone</h3>
        <p style={{ fontSize: 13, color: "#8a8070", marginBottom: 14 }}>Permanently deletes all stock and sales data. Cannot be undone.</p>
        <button style={{ background: "transparent", color: "#b83020", border: "1.5px solid #f0c0ba", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }} onClick={() => { if (window.confirm("Delete ALL data? This cannot be undone.")) update(s => Object.assign(s, INITIAL_STATE, { gumStock: [], gumVariants: INITIAL_STATE.gumVariants })); }}>Clear All Data</button>
      </div>
    </div>
  );
}
