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

const INITIAL_STATE = { stock: [], grades: GRADES, customers: [], customerData: {}, linerCustomers: [] };

function fmtRs(n) { return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }
function fmtRate(n) { if (!n && n !== 0) return ""; const v = Number(n); return "₹" + (Number.isInteger(v) ? v.toString() : v.toFixed(2)); }
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

const TABS = ["Home", "Stock", "Sell", "History", "Reports", "Settings"];

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
  const matches = value.length >= 1
    ? customers.filter(c => c.toLowerCase().includes(value.toLowerCase()) && c.toLowerCase() !== value.toLowerCase())
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
            <div key={c} onMouseDown={() => { onChange(c); setShow(false); }}
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

// ─── PRIMESTOCK LOGO ──────────────────────────────────────────────────────────
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
        setState({ ...INITIAL_STATE, ...data, linerCustomers: data.linerCustomers || [] });
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

  const available = state.stock.filter(r => !r.sold && r.productType !== "liner");
  const totalKg = available.reduce((s, r) => s + Number(r.weight), 0);

  const sizeCountMap = {};
  // Seed from ALL reel stock first so fully sold-out sizes appear with count=0
  state.stock.filter(r => r.productType !== "liner").forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}|${r.size}`;
    if (!sizeCountMap[k]) sizeCountMap[k] = { count: 0, bf: r.bf, gsm: r.gsm, shade: r.shade, size: r.size };
  });
  available.forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}|${r.size}`;
    sizeCountMap[k].count++;
  });
  const lowItems = Object.values(sizeCountMap).filter(x => x.count <= 2).sort((a, b) => Number(a.size) - Number(b.size));
  const moderateItems = Object.values(sizeCountMap).filter(x => x.count === 3).sort((a, b) => Number(a.size) - Number(b.size));

  return (
    <div style={{ fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", background: "#f8f7f4", minHeight: "100vh", color: "#1a1a1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300;1,9..40,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#f4f7fb}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#edeae4}::-webkit-scrollbar-thumb{background:#c8b89a;border-radius:2px}
        input,select,textarea{background:#fff!important;border:1.5px solid #ddd8ce!important;color:#1a1a1a!important;padding:9px 12px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;outline:none;width:100%;transition:all 0.15s;resize:vertical}
        input:focus,select:focus,textarea:focus{border-color:#8b6914!important;box-shadow:0 0 0 3px rgba(139,105,20,0.07)}
        select option{background:#fff;color:#1a1a1a}
        input[type="checkbox"]{width:auto!important;accent-color:#8b6914;cursor:pointer}
        button{cursor:pointer;font-family:'DM Sans',sans-serif}
        .btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:500;border:none;transition:all 0.15s}
        .btn-dark{background:#1a1a1a;color:#fff}.btn-dark:hover{background:#2d2d2d}.btn-dark:disabled{background:#b0a898;cursor:not-allowed}
        .btn-outline{background:transparent;color:#1a1a1a;border:1.5px solid #ddd8ce!important}.btn-outline:hover{border-color:#8b6914!important;color:#8b6914}
        .btn-sm{padding:6px 12px;font-size:12px}
        .card{background:#fff;border:1px solid #e8e2d8;border-radius:14px;padding:22px}
        .card-flat{background:#fff;border:1px solid #e8e2d8;border-radius:14px;overflow:hidden}
        .tag{display:inline-block;background:#f5f0e8;border:1px solid #e5dece;border-radius:4px;padding:2px 8px;font-size:11px;color:#2d2d2d;font-weight:500}
        .tag-green{background:#edf7f0;border-color:#b5dcc0;color:#2d6a4f}
        .tag-red{background:#fef0ee;border-color:#f0c0ba;color:#b83020}
        .tag-orange{background:#fef5e8;border-color:#f0d5a0;color:#a05800}
        .tag-blue{background:#f5f0e8;border-color:#c8b89a;color:#2d2d2d}
        .lbl{font-size:10px;color:#8a8070;text-transform:uppercase;letter-spacing:0.09em;margin-bottom:5px;display:block;font-weight:600}
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
        .g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px}
        .g5{display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:12px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th{color:#9a9080;font-weight:600;text-align:left;padding:10px 16px;border-bottom:1px solid #e8e2d8;font-size:10px;text-transform:uppercase;letter-spacing:0.08em}
        td{padding:12px 16px;border-bottom:1px solid #e8eef8}
        tr:last-child td{border-bottom:none}
        tr:hover td{background:#faf8f4}
        .sep{height:1px;background:#e8e2d8;margin:16px 0}
        h1{font-family:'Playfair Display',serif;font-size:32px;font-weight:500;letter-spacing:-0.02em;line-height:1.1;color:#1a1a1a}
        h2{font-family:'Playfair Display',serif;font-size:24px;font-weight:500;letter-spacing:-0.01em;color:#1a1a1a}
        h3{font-size:11px;font-weight:600;color:#6a6050;margin-bottom:14px;letter-spacing:0.08em;text-transform:uppercase}
        .serif{font-family:'Playfair Display',serif}
        .serif-italic{font-family:'Playfair Display',serif;font-style:italic}
        .stat-num{font-family:'Playfair Display',serif;font-size:42px;line-height:1;font-weight:500;color:#1a1a1a}
        .section-eyebrow{font-family:'Playfair Display',serif;font-size:14px;font-style:italic;font-weight:400;color:#8a7868;margin-bottom:4px}
        .ok-box{background:#edf7f0;border:1px solid #b5dcc0;border-radius:8px;padding:11px 14px;font-size:12px;color:#2d6a4f}
        .err-box{background:#fef0ee;border:1px solid #f0c0ba;border-radius:8px;padding:11px 14px;font-size:12px;color:#b83020}
        .warn-box{background:#fef5e8;border:1px solid #f0d5a0;border-radius:8px;padding:11px 14px;font-size:12px;color:#a05800}
        .low-alert{background:#fef9ee;border:1px solid #f0d5a0;border-radius:14px;padding:18px 22px}
        .moderate-alert{background:#f4f8ff;border:1px solid #c8b89a;border-radius:14px;padding:18px 22px}
        .sync-dot{width:6px;height:6px;border-radius:50%;background:#52c478;display:inline-block;margin-right:5px;animation:pulse 2s infinite}
        .sync-dot-err{width:6px;height:6px;border-radius:50%;background:#e05030;display:inline-block;margin-right:5px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        .fade-in{animation:fadeIn 0.25s ease}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px}
        .modal{background:#fff;border-radius:16px;padding:28px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.15)}
        @media(max-width:640px){.g2,.g3,.g4,.g5{grid-template-columns:1fr 1fr}}
        @media(max-width:400px){.g2,.g3,.g4,.g5{grid-template-columns:1fr}}
        @media(max-width:640px){
          .brand-text{display:none!important}
          .brand-divider{display:none!important}
          .brand-mobile{display:flex!important}
          .nav-sync-text{display:none!important}
          .nav-inner{padding:0 8px!important}
          h1{font-size:26px!important}
          h2{font-size:20px!important}
          .card{padding:14px!important}
          .card-flat .card{padding:14px!important}
          .stat-num{font-size:32px!important}
        }
        @media(min-width:641px){
          .brand-mobile{display:none!important}
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
          <div style={{ display: "flex", overflowX: "auto", flex: 1, scrollbarWidth: "none" }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === t ? "#8b6914" : "transparent"}`, padding: "13px 11px", fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? "#1a1a1a" : "#9a9080", whiteSpace: "nowrap", transition: "all 0.15s", letterSpacing: "0.01em" }}>{t}</button>
            ))}
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

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "20px 14px" }} className="fade-in">
        {tab === "Home"     && <HomeTab     state={state} setTab={setTab} setStockNav={setStockNav} lowItems={lowItems} moderateItems={moderateItems} totalKg={totalKg} available={available} />}
        {tab === "Stock"    && <StockTab    state={state} update={update} stockNav={stockNav} clearStockNav={() => setStockNav(null)} />}
        {tab === "Sell"     && <SellTab     state={state} update={update} />}
        {tab === "History"  && <HistoryTab  state={state} update={update} />}
        {tab === "Reports"  && <ReportsTab  state={state} />}
        {tab === "Settings" && <SettingsTab state={state} update={update} />}
      </div>
    </div>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function HomeTab({ state, setTab, setStockNav, lowItems, moderateItems, totalKg, available }) {
  const sold = state.stock.filter(r => r.sold && r.productType !== "liner");
  const bySpec = {};
  // Seed all known grade+size combos so sold-out sizes show as 0 (reels only)
  state.stock.filter(r => r.productType !== "liner").forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}`;
    if (!bySpec[k]) bySpec[k] = { bf: r.bf, gsm: r.gsm, shade: r.shade, reels: 0, kg: 0, sizes: {} };
    if (bySpec[k].sizes[r.size] === undefined) bySpec[k].sizes[r.size] = 0;
  });
  available.forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}`;
    bySpec[k].reels++; bySpec[k].kg += Number(r.weight);
    bySpec[k].sizes[r.size]++;
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="section-eyebrow">Overview</div>
          <h1>Stock Dashboard</h1>
        </div>
        <div style={{ fontSize: 11, color: "#b0a898" }}>{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      </div>

      <div className="g3">
        {[
          { label: "Available Reels", val: available.length, unit: "in stock" },
          { label: "Total Weight", val: (totalKg / 1000).toFixed(2), unit: "metric tons" },
          { label: "Total Sold", val: sold.length, unit: "reels dispatched" },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: "22px 24px" }}>
            <div className="lbl">{s.label}</div>
            <div className="stat-num">{s.val}</div>
            <div className="serif-italic" style={{ fontSize: 13, color: "#b0a898", marginTop: 4 }}>{s.unit}</div>
          </div>
        ))}
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
                        <span key={j} style={{ background: r.sold ? "#fef0ee" : "#edf7f0", border: `1px solid ${r.sold ? "#f0c0ba" : "#b5dcc0"}`, borderRadius: 5, padding: "4px 10px", fontSize: 12, color: r.sold ? "#9a4030" : "#2d6a4f", fontWeight: 500 }}>
                          {fmt(r.weight)} kg{r.sold ? " · sold" : ""}
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
function StockTab({ state, update, stockNav, clearStockNav }) {
  const [productTab, setProductTab] = useState("reels"); // "reels" | "liner"
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState({ bf: "", gsm: "", shade: "", size: "", showSold: false });
  const [openShip, setOpenShip] = useState(null);
  const [editShipKey, setEditShipKey] = useState(null); // shipment being rate-edited
  const [shipRates, setShipRates] = useState({});       // "bf|gsm" -> {mode,rate,slabs}
  const [editWeightKey, setEditWeightKey] = useState(null); // shipment being weight-edited

  useEffect(() => {
    if (stockNav?.size) {
      setFilter(f => ({ ...f, size: stockNav.size }));
      setView("size");
      clearStockNav();
    }
  }, [stockNav]);
  const [form, setForm] = useState({ supplier: "", invoiceNo: "", date: today(), bf: state.grades[0]?.bf || "18", gsm: state.grades[0]?.gsm || "150", shade: state.grades[0]?.shade || "golden" });
  const [reels, setReels] = useState([]);
  const [newReel, setNewReel] = useState({ size: "", weight: "" });
  const [saved, setSaved] = useState(false);
  const [gradeRates, setGradeRates] = useState({}); // "bf|gsm" -> { mode:"simple"|"slabs", rate:"", slabs:[{kg,rate}] }
  const weightInputRef = useRef(null);

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
    if (!form.supplier || reels.length === 0) return;
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
      return { ...r, id: genId(), sold: false, supplier: form.supplier, invoiceNo: form.invoiceNo, inwardDate: form.date, costRate };
    });
    update(s => { s.stock = [...s.stock, ...nr]; });
    setSaved(true); setReels([]); setGradeRates({});
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
            <button className="btn btn-dark" onClick={submit} disabled={reels.length === 0 || !form.supplier}>✓ Save</button>
          </div>
        </div>
      </div>
    </div>
  );

  if (view === "size") {
    const sz = filter.size;
    const allForSize = state.stock.filter(r => r.size === sz);
    // Build separate data per grade so stock/inward/outward are never mixed
    const gradeKeys = [...new Set(allForSize.map(r => `${r.bf}|${r.gsm}|${r.shade}`))].sort();
    const gradeData = gradeKeys.map(gk => {
      const [bf, gsm, shade] = gk.split("|");
      const gradeReels = allForSize.filter(r => r.bf === bf && r.gsm === gsm && r.shade === shade);
      const availForGrade = gradeReels.filter(r => !r.sold);
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
      return { bf, gsm, shade, availForGrade, inwardGroups, challanList };
    });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => { setView("list"); setFilter(f => ({ ...f, size: "" })); }}>← Back</button>
          <div><div className="section-eyebrow">Size Detail</div><h2>{sz}" Reels — Full History</h2></div>
        </div>
        {gradeData.map((gd, gi) => (
          <div key={`${gd.bf}|${gd.gsm}|${gd.shade}`} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {gradeData.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#f5f0e8", border: "1px solid #e5dece", borderRadius: 10 }}>
                <span className="serif" style={{ fontSize: 18, color: "#1a1a1a" }}>{gd.bf} BF · {gd.gsm} GSM</span>
                <span className="tag" style={{ textTransform: "capitalize" }}>{gd.shade}</span>
                <span style={{ fontSize: 12, color: "#9a9080", marginLeft: 2 }}>
                  {gd.availForGrade.length} available · {gd.availForGrade.reduce((s, r) => s + Number(r.weight), 0) > 0 ? fmt(gd.availForGrade.reduce((s, r) => s + Number(r.weight), 0)) + " kg" : "0 kg"}
                </span>
              </div>
            )}
            <EditableStockForSize sz={sz} availForSize={gd.availForGrade} update={update} />
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
                          <button className="btn btn-dark btn-sm" style={{ width: "100%", justifyContent: "center" }}
                            onClick={() => {
                              // Assign costRate to all reels in this shipment
                              const gradeKgs = {};
                              sh.reels.forEach(r => {
                                const k2 = `${r.bf}|${r.gsm}`;
                                if (!gradeKgs[k2]) gradeKgs[k2] = 0;
                                gradeKgs[k2] += Number(r.weight);
                              });
                              update(s => {
                                s.stock = s.stock.map(r => {
                                  if (!sh.reels.some(x => x.id === r.id)) return r;
                                  const k2 = `${r.bf}|${r.gsm}`;
                                  const gr = shipRates[k2];
                                  if (!gr) return r;
                                  const costRate = gr.mode === "simple"
                                    ? Number(gr.rate) || 0
                                    : computeWeightedCostRate(gr.slabs, gradeKgs[k2]);
                                  return { ...r, costRate };
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
                                  {costSet && <span style={{ fontSize: 10, color: "#2d6a4f", fontWeight: 600 }}>{fmtRate(reels[0].costRate)}/kg</span>}
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
                          {(() => { const shipVal = sh.reels.reduce((s, r) => s + (Number(r.costRate)||0)*Number(r.weight), 0); return shipVal > 0 ? <span style={{ display: "block", fontSize: 12, color: "#8b6914", fontWeight: 700 }}>{fmtRs(shipVal)} cost value</span> : null; })()}
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
  state.stock.filter(r => r.productType !== "liner").forEach(r => {
    if (filter.bf && r.bf !== filter.bf) return;
    if (filter.gsm && r.gsm !== filter.gsm) return;
    if (filter.shade && r.shade !== filter.shade) return;
    if (filter.size && String(r.size).replace(/"/g,"").trim() !== filter.size) return;
    const k = `${r.size}|${r.bf}|${r.gsm}`;
    if (!sizeGroupMap[k]) sizeGroupMap[k] = { size: r.size, bf: r.bf, gsm: r.gsm, shade: r.shade, reels: [], soldReels: [] };
    if (r.sold) sizeGroupMap[k].soldReels.push(r);
    else sizeGroupMap[k].reels.push(r);
  });
  const sizeGroups = Object.values(sizeGroupMap).sort((a, b) => Number(a.size) - Number(b.size));
  const totalAvailKg = available.filter(r => (!filter.bf || r.bf === filter.bf) && (!filter.gsm || r.gsm === filter.gsm)).reduce((s, r) => s + Number(r.weight), 0);
  const totalAvailReels = available.filter(r => (!filter.bf || r.bf === filter.bf) && (!filter.gsm || r.gsm === filter.gsm)).length;

  // ── LINER LIST VIEW ──
  if (productTab === "liner") {
    return <LinerStockTab state={state} update={update} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      {/* Product switcher */}
      <div style={{ display: "flex", gap: 4, background: "#f5f0e8", borderRadius: 10, padding: 4, alignSelf: "flex-start" }}>
        {[["reels","📦 Reels"], ["liner","📄 Liner"]].map(([t, label]) => (
          <button key={t} onClick={() => setProductTab(t)}
            style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: productTab === t ? "#fff" : "transparent", color: productTab === t ? "#1a1a1a" : "#8b6914", fontWeight: productTab === t ? 600 : 400, fontSize: 13, cursor: "pointer", boxShadow: productTab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div><div className="section-eyebrow">Inventory</div><h2>Stock Register</h2></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setView("inward")}>📋 Inward History</button>
          <button className="btn btn-dark" onClick={() => { setView("add"); setSaved(false); setReels([]); }}>+ Add Inward</button>
        </div>
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
  const [filter, setFilter] = useState({ bf: "", gsm: "", size: "" });
  const [done, setDone] = useState(null);
  const [sellRates, setSellRates] = useState({}); // "bf|gsm" -> rate string

  // Auto-load rates from customerData when customer changes
  useEffect(() => {
    if (!customer || !state.customerData?.[customer]) { setSellRates({}); return; }
    const hist = state.customerData[customer]?.rateHistory || {};
    const rates = {};
    Object.entries(hist).forEach(([k, arr]) => { if (arr?.length) rates[k] = String(arr[arr.length - 1].rate); });
    setSellRates(rates);
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

  const noStockWarning = filter.size && available.filter(r => r.size === filter.size).length === 0
    ? `No ${filter.size}" reels in stock. Please check the size.` : null;

  const sell = () => {
    if (!customer || selected.length === 0) return;
    const wt = totalWt; const ct = selReels.length; const val = totalValue;
    update(s => {
      s.stock = s.stock.map(r => {
        if (!selected.includes(r.id)) return r;
        const soldRate = Number(sellRates[`${r.bf}|${r.gsm}`]) || 0;
        return { ...r, sold: true, soldDate: date, soldTo: customer, soldChallanNo: challanNo, soldRate };
      });
      if (customer.trim() && !s.customers.includes(customer.trim())) {
        s.customers = [...(s.customers || []), customer.trim()].sort();
      }
      // Save rate to customerData history if set
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
    });
    setDone({ count: ct, wt, customer, val });
  };

  if (done) return (
    <div className="card fade-in" style={{ textAlign: "center", padding: 56 }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>✓</div>
      <div className="serif" style={{ fontSize: 28 }}>Sale Recorded</div>
      <div style={{ fontSize: 13, color: "#8a8070", marginTop: 8 }}>{done.count} reels · {fmt(done.wt)} kg · {done.val ? fmtRs(done.val) : "no rate set"} → {done.customer}</div>
      <button className="btn btn-dark" style={{ marginTop: 22 }} onClick={() => { setDone(null); setSelected([]); setCustomer(""); setChallanNo(suggestedChallan); setSellRates({}); }}>Record Another Sale</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      {/* Product switcher */}
      <div style={{ display: "flex", gap: 4, background: "#f5f0e8", borderRadius: 10, padding: 4, alignSelf: "flex-start" }}>
        {[["reels","📦 Reels"], ["liner","📄 Liner"]].map(([t, label]) => (
          <button key={t} onClick={() => setProductTab(t)}
            style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: productTab === t ? "#fff" : "transparent", color: productTab === t ? "#1a1a1a" : "#8b6914", fontWeight: productTab === t ? 600 : 400, fontSize: 13, cursor: "pointer", boxShadow: productTab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>
      {productTab === "liner" && <LinerSellTab state={state} update={update} />}
      {productTab === "reels" && <>
      <div><div className="section-eyebrow">Dispatch</div><h2>Record a Sale</h2></div>
      <div className="card">
        <h3>Sale Details</h3>
        <div className="g3">
          <div><label className="lbl">Customer Name</label><CustomerInput value={customer} onChange={setCustomer} customers={state.customers || []} /></div>
          <div><label className="lbl">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div>
            <label className="lbl">Challan No{suggestedChallan ? <span style={{ color: "#8b6914", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · auto-suggested</span> : ""}</label>
            <input value={challanNo} onChange={e => setChallanNo(e.target.value)} placeholder="e.g. 313" />
          </div>
        </div>
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
      {selected.length > 0 && (
        <div className="card" style={{ border: "1.5px solid #ddd8ce" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="lbl">Selected for Sale</div>
              <div className="serif" style={{ fontSize: 26, lineHeight: 1.1 }}>{selected.length} reels · {fmt(totalWt)} kg</div>
              {totalValue > 0 && <div style={{ fontSize: 14, color: "#8b6914", fontWeight: 700, marginTop: 4 }}>{fmtRs(totalValue)}</div>}
              {!customer && <div style={{ fontSize: 11, color: "#b83020", marginTop: 6 }}>Enter customer name to confirm.</div>}
            </div>
            <button className="btn btn-dark" style={{ fontSize: 14, padding: "12px 28px" }} onClick={sell} disabled={!customer}>✓ Confirm Sale</button>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}

// ─── LINER STOCK TAB ─────────────────────────────────────────────────────────
function LinerStockTab({ state, update }) {
  const [view, setView] = useState("list");
  const [conversionForm, setConversionForm] = useState({ labourRate: "", corrugator: "", date: today() });
  // Multi-reel conversion: map of reelId -> [{id, weight}]
  const [convReelWeights, setConvReelWeights] = useState({});
  const [selectedReelIds, setSelectedReelIds] = useState([]);
  const [convFilter, setConvFilter] = useState({ bf: "", gsm: "", size: "" });
  const [convSaved, setConvSaved] = useState(false);

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
        });
      });
    });
    update(s => {
      s.stock = s.stock.map(r => reelIdsToMark.includes(r.id) ? { ...r, converted: true, conversionBatchId: batchId, conversionDate: conversionForm.date } : r);
      s.stock = [...s.stock, ...allNewLiners];
    });
    setConvSaved(true);
    setSelectedReelIds([]);
    setConvReelWeights({});
    setConversionForm({ labourRate: "", corrugator: "", date: today() });
    setView("list");
    setTimeout(() => setConvSaved(false), 2500);
  };

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
                        {conversionForm.labourRate > 0 && reelLinerWt > 0 && (
                          <div style={{ fontSize: 10, color: "#2d6a4f", marginTop: 6, fontWeight: 600 }}>
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
                <strong>{selectedReelIds.length}</strong> reels selected · <strong>{totalLinersAcrossAll}</strong> liner entries
                {conversionForm.labourRate > 0 && totalLinersAcrossAll > 0 && (() => {
                  const totalOutputKg = Object.values(convReelWeights).flat().filter(x => x.weight).reduce((s, x) => s + Number(x.weight), 0);
                  return <span style={{ color: "#2d6a4f", fontWeight: 600, marginLeft: 8 }}>Labour: {fmtRs(Number(conversionForm.labourRate) * totalOutputKg)}</span>;
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div><div className="section-eyebrow">Liner Inventory</div><h2>Liner Stock</h2></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setView("convertHistory")}>🔄 Conversion History</button>
          {availableReels.length > 0 && (
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
            {availableReels.length > 0 ? <button className="btn btn-dark btn-sm" onClick={() => setView("convert")}>Convert reels to get started</button> : "Add reels first, then convert them."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 13, color: "#6a6050", fontWeight: 500 }}>
            {availableLiners.length} liners available · {fmt(availableLiners.reduce((s, r) => s + Number(r.weight), 0))} kg
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
                  </div>
                  <span style={{ fontSize: 12, color: "#6a6050", fontWeight: 600 }}>{fmt(totalWt)} kg</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {grp.liners.sort((a, b) => Number(a.weight) - Number(b.weight)).map((r, idx) => (
                    <EditableLinerWeight key={r.id} liner={r} idx={idx} update={update} />
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

// ─── EDITABLE LINER WEIGHT CHIP ───────────────────────────────────────────────
function EditableLinerWeight({ liner, idx, update }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(liner.weight));
  const save = () => {
    if (!val || isNaN(val)) { setEditing(false); return; }
    update(s => { const i = s.stock.findIndex(x => x.id === liner.id); if (i !== -1) s.stock[i].weight = val; });
    setEditing(false);
  };
  return (
    <div style={{ background: "#f8f7f4", border: `1.5px solid ${editing ? "#8b6914" : "#e8e2d8"}`, borderRadius: 8, padding: "7px 10px", textAlign: "center", minWidth: 80, position: "relative" }}>
      {editing ? (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="number" inputMode="numeric" value={val} onChange={e => setVal(e.target.value)}
            style={{ width: 70, padding: "3px 6px", fontSize: 12, textAlign: "center" }}
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            onBlur={save}
          />
          <span style={{ fontSize: 10, color: "#9a9080" }}>kg</span>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: "#b0a898", marginBottom: 2 }}>#{idx + 1}</div>
          <div className="serif" style={{ fontSize: 18, lineHeight: 1 }}>{fmt(liner.weight)}</div>
          <div style={{ fontSize: 10, color: "#9a9080" }}>kg</div>
          <button onClick={() => { setEditing(true); setVal(String(liner.weight)); }}
            style={{ background: "transparent", color: "#8b6914", border: "1px solid #e5dece", borderRadius: 4, padding: "2px 6px", fontSize: 9, cursor: "pointer", marginTop: 4, display: "block", width: "100%" }}>
            Edit
          </button>
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
        return { ...r, sold: true, soldDate: date, soldTo: customer, soldChallanNo: challanNo, soldRate: Number(sellRate) || 0, weight: wt };
      });
      if (customer.trim() && !(s.linerCustomers || []).includes(customer.trim())) {
        s.linerCustomers = [...(s.linerCustomers || []), customer.trim()].sort();
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
  const [custView, setCustView] = useState("challans"); // "challans" | "customers" | "customerDetail"
  const [selCustomer, setSelCustomer] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [ledgerTab, setLedgerTab] = useState("overview"); // "overview"|"rates"|"history"
  const [bulkForm, setBulkForm] = useState({ grade: "", rate: "", fromDate: "", toDate: today() });
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkDone, setBulkDone] = useState(false);

  const sold = state.stock.filter(r => r.sold);
  const challanMap = {};
  sold.forEach(r => {
    const key = r.soldChallanNo ? r.soldChallanNo : `__${r.soldDate}__${r.soldTo}`;
    if (!challanMap[key]) {
      challanMap[key] = { challanNo: r.soldChallanNo || null, date: r.soldDate, customer: r.soldTo || "", reels: [] };
    } else if (!challanMap[key].customer && r.soldTo) {
      challanMap[key].customer = r.soldTo;
    }
    challanMap[key].reels.push(r);
  });

  const allChallanCustomers = [...new Set(Object.values(challanMap).map(c => c.customer).filter(Boolean))].sort();
  const allChallanMonths = [...new Set(Object.values(challanMap).map(c => monthKey(c.date)).filter(Boolean))].sort().reverse();

  // Per-customer aggregate stats
  const custStats = {};
  Object.values(challanMap).forEach(ch => {
    const c = ch.customer || "Unknown";
    if (!custStats[c]) custStats[c] = { reels: 0, kg: 0, challans: 0, lastDate: "", sizes: {} };
    custStats[c].challans++;
    custStats[c].reels += ch.reels.length;
    custStats[c].kg += ch.reels.reduce((s, r) => s + Number(r.weight), 0);
    if (!custStats[c].lastDate || ch.date > custStats[c].lastDate) custStats[c].lastDate = ch.date;
    ch.reels.forEach(r => { custStats[c].sizes[r.size] = (custStats[c].sizes[r.size] || 0) + 1; });
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
  const hasFilters = filterCustomer || filterSize || filterGrade || filterMonth || search;

  const startEditChallan = (ch, key) => {
    setEditingChallan(key);
    setEditForm({ customer: ch.customer || "", date: ch.date || "", challanNo: ch.challanNo || "" });
    setOpenChallan(key);
  };

  const saveEditChallan = (ch, key) => {
    const ids = ch.reels.map(r => r.id);
    update(s => {
      s.stock = s.stock.map(r => {
        if (!ids.includes(r.id)) return r;
        return { ...r, soldTo: editForm.customer, soldDate: editForm.date, soldChallanNo: editForm.challanNo };
      });
      // Save new customer name if not known
      if (editForm.customer.trim() && !(s.customers || []).includes(editForm.customer.trim())) {
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
    update(s => {
      s.stock = s.stock.map(r => ids.includes(r.id)
        ? { ...r, sold: false, soldDate: undefined, soldTo: undefined, soldChallanNo: undefined }
        : r
      );
    });
    setConfirmDeleteChallan(null);
    setOpenChallan(null);
  };

  // ── CUSTOMER LIST VIEW ──
  if (custView === "customers") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} className="fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setCustView("challans")}>← Back</button>
        <div><div className="section-eyebrow">Customers</div><h2>Customer History</h2></div>
      </div>
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
                      {cs.challans} challan{cs.challans !== 1 ? "s" : ""} · {cs.reels} reels · {fmt(Math.round(cs.kg))} kg{topSz ? ` · Top: ${topSz[0]}"` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
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

  const isCustomerDetail = custView === "customerDetail";

  // Customer ledger data
  const custLedger = selCustomer ? (() => {
    const cs = custStats[selCustomer] || {};
    const cd = state.customerData?.[selCustomer] || {};
    const custChallans = Object.values(challanMap).filter(c => (c.customer || "") === selCustomer);
    const revenue = custChallans.reduce((s, ch) => s + ch.reels.reduce((ss, r) => ss + (Number(r.soldRate) || 0) * Number(r.weight), 0), 0);
    const profit = custChallans.reduce((s, ch) => s + ch.reels.reduce((ss, r) => ss + ((Number(r.soldRate) || 0) - (Number(r.costRate) || 0)) * Number(r.weight), 0), 0);
    return { cs, cd, revenue, profit, custChallans };
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
                { label: "Total kg", val: fmt(Math.round(custLedger.cs.kg || 0)) },
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
            {[["overview","📊 Overview"], ["rates","₹ Bulk Apply"], ["history","📈 Rate History"]].map(([tab, label]) => (
              <button key={tab} onClick={() => setLedgerTab(tab)}
                style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: "none", background: ledgerTab === tab ? "#fff" : "transparent", color: ledgerTab === tab ? "#1a1a1a" : "#8b6914", fontWeight: ledgerTab === tab ? 600 : 400, fontSize: 12, cursor: "pointer", boxShadow: ledgerTab === tab ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>

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
          <button className="btn btn-outline btn-sm" onClick={() => setCustView("customers")}>👥 Customers</button>
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
          {challans.map((ch, idx) => {
            const key = ch.challanNo || `__${ch.date}__${ch.customer}`;
            const isOpen = openChallan === key;
            const isEditing = editingChallan === key;
            const totalWt = ch.reels.reduce((s, r) => s + Number(r.weight), 0);
            const bySizeInChallan = {};
            ch.reels.forEach(r => {
              if (!bySizeInChallan[r.size]) bySizeInChallan[r.size] = [];
              bySizeInChallan[r.size].push(r);
            });
            return (
              <div key={key} style={{ borderBottom: idx < challans.length - 1 ? "1px solid #e8eef8" : "none" }}>
                {/* Challan header */}
                <div onClick={() => !isEditing && setOpenChallan(prev => prev === key ? null : key)}
                  style={{ padding: "12px 16px", cursor: isEditing ? "default" : "pointer", display: "flex", alignItems: "center", gap: 10, transition: "background 0.12s", background: isOpen ? "#faf8f4" : "transparent" }}
                  onMouseEnter={e => { if (!isOpen && !isEditing) e.currentTarget.style.background = "#faf8f4"; }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Line 1: customer name + reels/liner badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1a", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ch.customer || "—"}
                      </span>
                      {ch.reels.some(r => r.productType === "liner") && <span className="tag" style={{ fontSize: 10, background: "#edf5ff", border: "1px solid #b0ccee", color: "#2a5a8a", flexShrink: 0 }}>📄 Liner</span>}
                      <span className="tag tag-red" style={{ fontSize: 11, flexShrink: 0 }}>{ch.reels.length} {ch.reels.every(r => r.productType === "liner") ? "liner" : "reel"}{ch.reels.length !== 1 ? "s" : ""}</span>
                    </div>
                    {/* Line 2: date · challan no · kg · value · size tags */}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "#9a9080", fontWeight: 500 }}>{fmtDate(ch.date)}</span>
                      {ch.challanNo && <><span style={{ fontSize: 10, color: "#d0c8bc" }}>·</span><span style={{ fontSize: 11, color: "#9a9080" }}>Ch {ch.challanNo}</span></>}
                      <span style={{ fontSize: 10, color: "#d0c8bc" }}>·</span>
                      <span style={{ fontSize: 11, color: "#6a6050", fontWeight: 500 }}>{fmt(Math.round(totalWt))} kg</span>
                      {(() => { const v = ch.reels.reduce((s,r) => s+(Number(r.soldRate)||0)*Number(r.weight),0); return v > 0 ? <><span style={{ fontSize: 10, color: "#d0c8bc" }}>·</span><span style={{ fontSize: 11, color: "#8b6914", fontWeight: 700 }}>{fmtRs(v)}</span></> : <span style={{ fontSize: 10, background: "#fef5e8", border: "1px solid #f0d5a0", borderRadius: 4, padding: "1px 6px", color: "#a05800", fontWeight: 600 }}>⚠ no rate</span>; })()}
                      {Object.keys(bySizeInChallan).sort((a, b) => Number(a) - Number(b)).slice(0, 4).map(sz => (
                        <span key={sz} className="tag" style={{ fontSize: 10 }}>{sz}"</span>
                      ))}
                      {Object.keys(bySizeInChallan).length > 4 && <span style={{ fontSize: 10, color: "#9a9080" }}>+{Object.keys(bySizeInChallan).length - 4}</span>}
                    </div>
                  </div>
                  <div style={{ color: "#c8b89a", fontSize: 16, flexShrink: 0, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</div>
                </div>

                {/* Expanded content */}
                {isOpen && (
                  <div style={{ background: "#faf8f4", borderTop: "1px solid #dde8f5", padding: "14px 18px 18px 18px" }}>

                    {/* Edit form */}
                    {isEditing ? (
                      <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* Header fields */}
                        <div style={{ background: "#fff", border: "1.5px solid #8b6914", borderRadius: 10, padding: "14px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#8b6914", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Edit Challan Details</div>
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
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn btn-dark btn-sm" onClick={() => saveEditChallan(ch, key)}>✓ Save Header</button>
                            <button className="btn btn-outline btn-sm" onClick={() => setEditingChallan(null)}>Done</button>
                          </div>
                        </div>

                        {/* Reels in challan — delete individual */}
                        <div style={{ background: "#fff", border: "1px solid #e8e2d8", borderRadius: 10, padding: "14px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#6a6050", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                            Reels in This Challan — {ch.reels.length} reels
                          </div>
                          {ch.reels.length === 0
                            ? <div style={{ fontSize: 12, color: "#b0a898", fontStyle: "italic" }}>No reels — add some below.</div>
                            : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {ch.reels.sort((a, b) => Number(a.size) - Number(b.size)).map(r => (
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
                                        const customer = editForm.customer || ch.reels.find(x => x.soldTo)?.soldTo || ch.customer || "";
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
                          🗑 Undo Sale
                        </button>
                      </div>
                    )}

                    {/* Sizes + weights grouped by grade with editable rate */}
                    {(() => {
                      const byGrade = {};
                      ch.reels.forEach(r => {
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
                          <div style={{ paddingTop: 10, borderTop: "1px solid #e8e2d8", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                            <span style={{ color: "#9a9080" }}>{ch.reels.length} reels · {fmt(Math.round(totalWt))} kg</span>
                            <span style={{ fontWeight: 700, color: "#1a1a1a", fontSize: 15 }}>
                              {challanVal > 0 ? fmtRs(challanVal) : <span style={{ color: "#b0a898", fontStyle: "italic", fontSize: 12 }}>Add ₹/kg to see total</span>}
                            </span>
                          </div>
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

      {/* Confirm undo sale modal */}
      {confirmDeleteChallan && (
        <div className="modal-bg" onClick={() => setConfirmDeleteChallan(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="serif" style={{ fontSize: 20, marginBottom: 10 }}>Undo this sale?</div>
            <p style={{ fontSize: 13, color: "#8a8070", marginBottom: 6, lineHeight: 1.6 }}>
              This will mark all <strong>{confirmDeleteChallan.ch.reels.length} reels</strong> from{" "}
              <strong>{confirmDeleteChallan.ch.customer}</strong> as back in stock.
            </p>
            <p style={{ fontSize: 12, color: "#b83020", marginBottom: 20 }}>The challan entry will be removed from history.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1, justifyContent: "center" }} onClick={() => setConfirmDeleteChallan(null)}>Cancel</button>
              <button style={{ flex: 1, background: "#b83020", color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontSize: 13, cursor: "pointer" }} onClick={() => deleteChallan(confirmDeleteChallan.ch)}>Yes, Undo Sale</button>
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
function usePeriod(sold) {
  const [periodMode, setPeriodMode] = useState("month");
  const [selDate, setSelDate] = useState(today());
  const [selWeek, setSelWeek] = useState(toISOWeek(new Date()));
  const [selMonth, setSelMonth] = useState(() => {
    const months = [...new Set(sold.map(r => monthKey(r.soldDate)).filter(Boolean))].sort().reverse();
    return months[0] || today().slice(0, 7);
  });
  const allMonths = [...new Set(sold.map(r => monthKey(r.soldDate)))].sort().reverse();
  const filter = r => {
    if (periodMode === "all") return true;
    if (periodMode === "day") return r.soldDate === selDate;
    if (periodMode === "week") { const [mon, sun] = weekToRange(selWeek); const d = new Date(r.soldDate); return d >= mon && d <= sun; }
    if (periodMode === "month") return monthKey(r.soldDate) === selMonth;
    return true;
  };
  const periodSold = sold.filter(filter);
  const periodLabel = periodMode === "all" ? "All Time" : periodMode === "day" ? fmtDate(selDate) : periodMode === "week" ? fmtWeekLabel(selWeek) : monthLabel(selMonth);
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
  return { periodSold, periodLabel, PeriodBar };
}

function ReportsTab({ state }) {
  const [reportTab, setReportTab] = useState("reels"); // "reels" | "liner" | "business"
  const allSold = state.stock.filter(r => r.sold && r.soldDate);
  const reelSold = allSold.filter(r => r.productType !== "liner");
  const linerSold = allSold.filter(r => r.productType === "liner");

  if (allSold.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div><div className="section-eyebrow">Analytics</div><h2>Reports</h2></div>
      <div className="card" style={{ textAlign: "center", padding: 52 }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>📊</div>
        <div className="serif-italic" style={{ fontSize: 18, color: "#b0a898" }}>No sales data yet.</div>
        <div style={{ fontSize: 13, color: "#b0a898", marginTop: 8 }}>Record your first sale to see reports.</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div><div className="section-eyebrow">Analytics</div><h2>Reports</h2></div>
      {/* Section switcher */}
      <div style={{ display: "flex", gap: 4, background: "#f5f0e8", borderRadius: 10, padding: 4, alignSelf: "flex-start", flexWrap: "wrap" }}>
        {[["reels","📦 Reels"],["liner","📄 Liner"],["business","🏢 Full Business"]].map(([t, label]) => (
          <button key={t} onClick={() => setReportTab(t)}
            style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: reportTab === t ? "#fff" : "transparent", color: reportTab === t ? "#1a1a1a" : "#8b6914", fontWeight: reportTab === t ? 600 : 400, fontSize: 13, cursor: "pointer", boxShadow: reportTab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>
      {reportTab === "reels" && <ReelReport state={state} soldData={reelSold} />}
      {reportTab === "liner" && <LinerReport state={state} soldData={linerSold} />}
      {reportTab === "business" && <BusinessReport state={state} reelSold={reelSold} linerSold={linerSold} allSold={allSold} />}
    </div>
  );
}

// ─── REEL REPORT ─────────────────────────────────────────────────────────────
function ReelReport({ state, soldData }) {
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
    gradeMap[k].cost += (Number(r.costRate) || 0) * Number(r.weight);
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
    custMap[c].profit += ((Number(r.soldRate) || 0) - (Number(r.costRate) || 0)) * Number(r.weight);
    custMap[c].sizes[r.size] = (custMap[c].sizes[r.size] || 0) + 1;
  });
  const top5Cust = Object.entries(custMap).sort((a, b) => b[1].kg - a[1].kg).slice(0, 5);
  const last6 = allMonths.slice(0, 6).reverse();
  const trendData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: sold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0) }));
  const totalRevenue = periodSold.reduce((s, r) => s + (Number(r.soldRate) || 0) * Number(r.weight), 0);
  const totalCost = periodSold.reduce((s, r) => s + (Number(r.costRate) || 0) * Number(r.weight), 0);
  const totalProfit = totalRevenue - totalCost;

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

  if (soldData.length === 0) return <div className="card" style={{ textAlign: "center", padding: 40 }}><span className="serif-italic" style={{ fontSize: 16, color: "#b0a898" }}>No reel sales yet.</span></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeriodBar />
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
        {[
          { label: "Reels Sold", val: periodSold.length, unit: "reels" },
          { label: "Total Weight", val: fmt(Math.round(totalKg)) + " kg", unit: (totalKg/1000).toFixed(2) + " tons" },
          { label: "Revenue", val: totalRevenue > 0 ? fmtRs(totalRevenue) : "—", unit: "gross" },
          { label: "Profit", val: totalProfit !== 0 ? fmtRs(totalProfit) : "—", unit: totalRevenue > 0 ? ((totalProfit/totalRevenue)*100).toFixed(1) + "% margin" : "", color: totalProfit >= 0 ? "#2d6a4f" : "#b83020" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div className="lbl">{k.label}</div>
            <div className="serif" style={{ fontSize: 22, lineHeight: 1.2, color: k.color || "#1a1a1a" }}>{k.val}</div>
            {k.unit && <div style={{ fontSize: 11, color: "#9a9080", marginTop: 3 }}>{k.unit}</div>}
          </div>
        ))}
      </div>
      {/* Monthly trend */}
      {trendData.length > 1 && (
        <div className="card">
          <h3>Monthly Volume Trend (kg)</h3>
          <BarChart data={trendData} color="#8b6914" />
        </div>
      )}
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
function LinerReport({ state, soldData }) {
  const { periodSold, periodLabel, PeriodBar } = usePeriod(soldData);

  const totalKg = periodSold.reduce((s, r) => s + Number(r.weight), 0);
  const totalRevenue = periodSold.reduce((s, r) => s + (Number(r.soldRate) || 0) * Number(r.weight), 0);
  const totalCost = periodSold.reduce((s, r) => s + (Number(r.costRate) || 0) * Number(r.weight), 0);
  const totalProfit = totalRevenue - totalCost;
  const totalLabour = periodSold.reduce((s, r) => s + (Number(r.labourRate) || 0) * Number(r.weight), 0);

  // By spec
  const specMap = {};
  periodSold.forEach(r => {
    const k = `${r.bf} BF ${r.gsm} GSM ${r.size}"`;
    if (!specMap[k]) specMap[k] = { bf: r.bf, gsm: r.gsm, size: r.size, liners: 0, kg: 0, revenue: 0, cost: 0 };
    specMap[k].liners++; specMap[k].kg += Number(r.weight);
    specMap[k].revenue += (Number(r.soldRate) || 0) * Number(r.weight);
    specMap[k].cost += (Number(r.costRate) || 0) * Number(r.weight);
  });

  // By customer
  const custMap = {};
  periodSold.forEach(r => {
    const c = r.soldTo || "Unknown";
    if (!custMap[c]) custMap[c] = { liners: 0, kg: 0, revenue: 0, profit: 0 };
    custMap[c].liners++; custMap[c].kg += Number(r.weight);
    custMap[c].revenue += (Number(r.soldRate) || 0) * Number(r.weight);
    custMap[c].profit += ((Number(r.soldRate) || 0) - (Number(r.costRate) || 0)) * Number(r.weight);
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
        {[
          { label: "Liners Sold", val: periodSold.length, unit: "individual liners" },
          { label: "Total Weight", val: fmt(Math.round(totalKg)) + " kg", unit: (totalKg/1000).toFixed(2) + " tons" },
          { label: "Revenue", val: totalRevenue > 0 ? fmtRs(totalRevenue) : "—", unit: "gross" },
          { label: "Profit", val: totalProfit !== 0 ? fmtRs(totalProfit) : "—", unit: totalRevenue > 0 ? ((totalProfit/totalRevenue)*100).toFixed(1) + "% margin" : "", color: totalProfit >= 0 ? "#2d6a4f" : "#b83020" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div className="lbl">{k.label}</div>
            <div className="serif" style={{ fontSize: 22, lineHeight: 1.2, color: k.color || "#1a1a1a" }}>{k.val}</div>
            {k.unit && <div style={{ fontSize: 11, color: "#9a9080", marginTop: 3 }}>{k.unit}</div>}
          </div>
        ))}
      </div>
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
function BusinessReport({ state, reelSold, linerSold, allSold }) {
  const { periodSold: periodAll, periodLabel, PeriodBar } = usePeriod(allSold);
  const periodReels = periodAll.filter(r => r.productType !== "liner");
  const periodLiners = periodAll.filter(r => r.productType === "liner");

  const calc = arr => ({
    count: arr.length,
    kg: arr.reduce((s, r) => s + Number(r.weight), 0),
    revenue: arr.reduce((s, r) => s + (Number(r.soldRate) || 0) * Number(r.weight), 0),
    cost: arr.reduce((s, r) => s + (Number(r.costRate) || 0) * Number(r.weight), 0),
  });
  const R = calc(periodReels);
  const L = calc(periodLiners);
  const T = calc(periodAll);
  const reelProfit = R.revenue - R.cost;
  const linerProfit = L.revenue - L.cost;
  const totalProfit = T.revenue - T.cost;

  // Monthly combined trend
  const allMonths = [...new Set(allSold.map(r => monthKey(r.soldDate)))].sort().reverse();
  const last6 = allMonths.slice(0, 6).reverse();
  const trendData = last6.map(m => ({
    label: monthLabel(m).split(" ")[0],
    reels: reelSold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0),
    liner: linerSold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0),
  }));

  // Revenue split pie
  const revSplit = [];
  if (R.revenue > 0) revSplit.push({ label: "Reels", value: R.revenue });
  if (L.revenue > 0) revSplit.push({ label: "Liner", value: L.revenue });

  // Profit split pie
  const profSplit = [];
  if (reelProfit > 0) profSplit.push({ label: "Reels", value: reelProfit });
  if (linerProfit > 0) profSplit.push({ label: "Liner", value: linerProfit });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeriodBar />
      {/* Master KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
        {[
          { label: "Total Revenue", val: T.revenue > 0 ? fmtRs(T.revenue) : "—", unit: "all products" },
          { label: "Total Profit", val: totalProfit !== 0 ? fmtRs(totalProfit) : "—", unit: T.revenue > 0 ? ((totalProfit/T.revenue)*100).toFixed(1) + "% margin" : "", color: totalProfit >= 0 ? "#2d6a4f" : "#b83020" },
          { label: "Total Weight", val: fmt(Math.round(T.kg)) + " kg", unit: (T.kg/1000).toFixed(2) + " tons" },
          { label: "Total Orders", val: [...new Set(periodAll.map(r => r.soldChallanNo).filter(Boolean))].length || periodAll.length, unit: "challans dispatched" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div className="lbl">{k.label}</div>
            <div className="serif" style={{ fontSize: 22, lineHeight: 1.2, color: k.color || "#1a1a1a" }}>{k.val}</div>
            {k.unit && <div style={{ fontSize: 11, color: "#9a9080", marginTop: 3 }}>{k.unit}</div>}
          </div>
        ))}
      </div>

      {/* Side-by-side product comparison */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { label: "📦 Reels", data: R, profit: reelProfit, color: "#8b6914", bg: "#fdf9f0" },
          { label: "📄 Liner", data: L, profit: linerProfit, color: "#2a5a8a", bg: "#f0f5ff" },
        ].map(({ label, data, profit, color, bg }) => (
          <div key={label} className="card" style={{ background: bg, border: `1.5px solid ${color}22` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 10 }}>{label}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8070" }}>Items sold</span><strong>{data.count}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8070" }}>Weight</span><strong>{fmt(Math.round(data.kg))} kg</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8070" }}>Revenue</span><strong>{data.revenue > 0 ? fmtRs(data.revenue) : "—"}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8070" }}>Profit</span><strong style={{ color: profit >= 0 ? "#2d6a4f" : "#b83020" }}>{data.revenue > 0 ? fmtRs(profit) : "—"}</strong></div>
              {data.revenue > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8070" }}>Margin</span><strong style={{ color: profit >= 0 ? "#2d6a4f" : "#b83020" }}>{((profit/data.revenue)*100).toFixed(1)}%</strong></div>}
              {T.revenue > 0 && data.revenue > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8070" }}>Rev share</span><strong style={{ color }}>{((data.revenue/T.revenue)*100).toFixed(1)}%</strong></div>}
            </div>
          </div>
        ))}
      </div>

      {/* Revenue & Profit split pies */}
      {revSplit.length > 1 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
          <h3>Monthly Volume — Reels vs Liner (kg)</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trendData.map(d => {
              const maxVal = Math.max(...trendData.map(x => x.reels + x.liner), 1);
              const reelW = (d.reels / maxVal) * 100;
              const linerW = (d.liner / maxVal) * 100;
              return (
                <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "#9a9080", minWidth: 36 }}>{d.label}</span>
                  <div style={{ flex: 1, display: "flex", gap: 2, height: 18, borderRadius: 4, overflow: "hidden" }}>
                    {d.reels > 0 && <div style={{ width: `${reelW}%`, background: "#8b6914", borderRadius: d.liner === 0 ? 4 : "4px 0 0 4px", transition: "width 0.4s" }} />}
                    {d.liner > 0 && <div style={{ width: `${linerW}%`, background: "#3a7a8a", borderRadius: d.reels === 0 ? 4 : "0 4px 4px 0", transition: "width 0.4s" }} />}
                  </div>
                  <span style={{ fontSize: 11, color: "#6a6050", minWidth: 70, textAlign: "right" }}>
                    {fmt(Math.round(d.reels + d.liner))} kg
                  </span>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8b6914" }}><div style={{ width: 10, height: 10, background: "#8b6914", borderRadius: 2 }} />Reels</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#3a7a8a" }}><div style={{ width: 10, height: 10, background: "#3a7a8a", borderRadius: 2 }} />Liner</span>
            </div>
          </div>
        </div>
      )}

      {/* Key insights dark card */}
      <div className="card" style={{ background: "#1a1a1a", color: "#f4f7fb", border: "none" }}>
        <h3 style={{ color: "#a09080", marginBottom: 16 }}>Key Insights — {periodLabel}</h3>
        <div className="g3">
          {[
            { label: "Strongest Product", val: R.revenue >= L.revenue ? "Reels" : "Liner", sub: `${R.revenue >= L.revenue ? fmtRs(R.revenue) : fmtRs(L.revenue)} revenue` },
            { label: "Best Margin", val: (reelProfit/Math.max(R.revenue,1)) >= (linerProfit/Math.max(L.revenue,1)) ? "Reels" : "Liner", sub: `${Math.max(R.revenue > 0 ? (reelProfit/R.revenue)*100 : 0, L.revenue > 0 ? (linerProfit/L.revenue)*100 : 0).toFixed(1)}% margin` },
            { label: "Total Business", val: fmtRs(T.revenue), sub: `${fmtRs(totalProfit)} profit` },
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

// ─── BAR CHART HELPER ─────────────────────────────────────────────────────────
function BarChart({ data, color = "#8b6914" }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.map(d => (
        <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#9a9080", minWidth: 34 }}>{d.label}</span>
          <div style={{ flex: 1, background: "#f0ece4", borderRadius: 4, height: 20, overflow: "hidden" }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s ease" }} />
          </div>
          <span style={{ fontSize: 11, color: "#6a6050", minWidth: 70, textAlign: "right" }}>{fmt(Math.round(d.value))} kg</span>
        </div>
      ))}
    </div>
  );
}

// ─── OLD REPORTS TAB SHELL (now empty — replaced above) ──────────────────────
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
    gradeMap[k].cost += (Number(r.costRate) || 0) * Number(r.weight);
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
    custMap[c].profit += ((Number(r.soldRate) || 0) - (Number(r.costRate) || 0)) * Number(r.weight);
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
          const cost = periodSold.reduce((s, r) => s + (Number(r.costRate) || 0) * Number(r.weight), 0);
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
            const profData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: sold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + ((Number(r.soldRate)||0)-(Number(r.costRate)||0))*Number(r.weight), 0) }));
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
        <h3>Data & Sync</h3>
        <p style={{ fontSize: 13, color: "#8a8070", lineHeight: 1.7 }}>All data saves to Firebase in real time. Any change made on one device appears instantly on all others — phones, laptops, tablets.</p>
        <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#9a9080" }}>
          <span>📦 {state.stock.filter(r => r.productType !== "liner").length} reels</span>
          <span>📄 {state.stock.filter(r => r.productType === "liner").length} liners</span>
          <span>✅ {state.stock.filter(r => r.sold).length} sold</span>
          <span>📊 {[...new Set(state.stock.filter(r => r.sold).map(r => monthKey(r.soldDate)).filter(Boolean))].length} months of data</span>
        </div>
      </div>
      <div className="card" style={{ border: "1px solid #f0c0ba" }}>
        <h3 style={{ color: "#b83020" }}>Danger Zone</h3>
        <p style={{ fontSize: 13, color: "#8a8070", marginBottom: 14 }}>Permanently deletes all stock and sales data. Cannot be undone.</p>
        <button style={{ background: "transparent", color: "#b83020", border: "1.5px solid #f0c0ba", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }} onClick={() => { if (window.confirm("Delete ALL data? This cannot be undone.")) update(s => Object.assign(s, INITIAL_STATE)); }}>Clear All Data</button>
      </div>
    </div>
  );
}
