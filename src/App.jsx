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
const INITIAL_STATE = { stock: [], grades: GRADES, customers: [] };

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
              style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f3ede4" }}
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

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(INITIAL_STATE);
  const [tab, setTab] = useState("Home");
  const [stockNav, setStockNav] = useState(null);
  const [syncing, setSyncing] = useState(true);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const saveTimer = useRef(null);
  const isRemoteUpdate = useRef(false);

  // ── Real-time listener — fires whenever Firebase data changes ──
  useEffect(() => {
    const dataRef = ref(db, DATA_REF);
    const unsub = onValue(dataRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        isRemoteUpdate.current = true;
        setState({ ...INITIAL_STATE, ...data });
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
      // Debounce writes — 600ms after last keystroke
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        cloudSave(next)
          .then(() => { setLastSaved(new Date()); setSaveError(false); })
          .catch(() => setSaveError(true));
      }, 600);
      return next;
    });
  }, []);

  const available = state.stock.filter(r => !r.sold);
  const totalKg = available.reduce((s, r) => s + Number(r.weight), 0);

  const sizeCountMap = {};
  available.forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}|${r.size}`;
    if (!sizeCountMap[k]) sizeCountMap[k] = { count: 0, bf: r.bf, gsm: r.gsm, shade: r.shade, size: r.size };
    sizeCountMap[k].count++;
  });
  const lowItems = Object.values(sizeCountMap).filter(x => x.count <= 2).sort((a, b) => Number(a.size) - Number(b.size));
  const moderateItems = Object.values(sizeCountMap).filter(x => x.count === 3).sort((a, b) => Number(a.size) - Number(b.size));

  return (
    <div style={{ fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", background: "#f8f7f4", minHeight: "100vh", color: "#1a1a1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300;1,9..40,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#f8f7f4}
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
        .tag{display:inline-block;background:#f5f0e8;border:1px solid #e5dece;border-radius:4px;padding:2px 8px;font-size:11px;color:#6b5a2e;font-weight:500}
        .tag-green{background:#edf7f0;border-color:#b5dcc0;color:#2d6a4f}
        .tag-red{background:#fef0ee;border-color:#f0c0ba;color:#b83020}
        .tag-orange{background:#fef5e8;border-color:#f0d5a0;color:#a05800}
        .tag-blue{background:#edf2fa;border-color:#b5c8e8;color:#2a4a7a}
        .lbl{font-size:10px;color:#8a8070;text-transform:uppercase;letter-spacing:0.09em;margin-bottom:5px;display:block;font-weight:600}
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
        .g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px}
        .g5{display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:12px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th{color:#9a9080;font-weight:600;text-align:left;padding:10px 16px;border-bottom:1px solid #e8e2d8;font-size:10px;text-transform:uppercase;letter-spacing:0.08em}
        td{padding:12px 16px;border-bottom:1px solid #f3ede4}
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
        .moderate-alert{background:#f4f8ff;border:1px solid #b5c8e8;border-radius:14px;padding:18px 22px}
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
          .nav-sync-text{display:none!important}
          .nav-inner{padding:0 8px!important}
          h1{font-size:26px!important}
          h2{font-size:20px!important}
          .card{padding:14px!important}
          .card-flat .card{padding:14px!important}
          .stat-num{font-size:32px!important}
        }
      `}</style>

      {/* Nav */}
      <nav style={{ background: "#fff", borderBottom: "1px solid #e8e2d8", position: "sticky", top: 0, zIndex: 200 }}>
        <div className="nav-inner" style={{ maxWidth: 980, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center" }}>
          {/* Brand */}
          <div className="brand-divider" style={{ padding: "11px 0", marginRight: 20, paddingRight: 20, borderRight: "1px solid #e8e2d8", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 30, height: 30, background: "#1a1a1a", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📦</div>
              <div className="brand-text">
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em", color: "#1a1a1a" }}>SK Traders</span>
                  <span style={{ fontSize: 10, color: "#b0a898", fontWeight: 400, letterSpacing: "0.06em", textTransform: "uppercase" }}>KraftTrack</span>
                </div>
              </div>
            </div>
          </div>
          {/* On mobile: just the icon, no divider */}
          <div style={{ display: "none" }} className="brand-mobile">
            <div style={{ width: 28, height: 28, background: "#1a1a1a", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, marginRight: 8, flexShrink: 0 }}>📦</div>
          </div>
          <div style={{ display: "flex", overflowX: "auto", flex: 1, scrollbarWidth: "none" }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === t ? "#1a1a1a" : "transparent"}`, padding: "13px 11px", fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? "#1a1a1a" : "#9a9080", whiteSpace: "nowrap", transition: "all 0.15s", letterSpacing: "0.01em" }}>{t}</button>
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
  const sold = state.stock.filter(r => r.sold);
  const bySpec = {};
  available.forEach(r => {
    const k = `${r.bf}|${r.gsm}|${r.shade}`;
    if (!bySpec[k]) bySpec[k] = { bf: r.bf, gsm: r.gsm, shade: r.shade, reels: 0, kg: 0, sizes: {} };
    bySpec[k].reels++; bySpec[k].kg += Number(r.weight);
    bySpec[k].sizes[r.size] = (bySpec[k].sizes[r.size] || 0) + 1;
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
              <div key={`${item.size}${item.bf}${item.gsm}`} style={{ background: "#fff", border: "1px solid #b5c8e8", borderRadius: 8, padding: "8px 14px" }}>
                <div className="serif" style={{ fontSize: 20, color: "#2a4a7a" }}>{item.size}"</div>
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
                style={{ background: cnt <= 2 ? "#fef9ee" : cnt === 3 ? "#f4f8ff" : "#f8f7f4", border: `1px solid ${cnt <= 2 ? "#f0d5a0" : cnt === 3 ? "#b5c8e8" : "#e8e2d8"}`, borderRadius: 10, padding: "9px 14px", textAlign: "center", minWidth: 68, cursor: "pointer", transition: "transform 0.1s, box-shadow 0.1s" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.10)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}>
                <div className="serif" style={{ fontSize: 20, lineHeight: 1, color: cnt <= 2 ? "#a05800" : cnt === 3 ? "#2a4a7a" : "#1a1a1a" }}>{sz}"</div>
                <div style={{ fontSize: 10, color: "#9a9080", marginTop: 4 }}>{cnt} reel{cnt !== 1 ? "s" : ""}</div>
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
              <div key={key} style={{ borderBottom: idx < groups.length - 1 ? "1px solid #f3ede4" : "none" }}>
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
                  <div style={{ background: "#faf8f4", borderTop: "1px solid #f0ebe0", padding: "12px 16px" }}>
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
              <div key={key} style={{ borderBottom: idx < sorted.length - 1 ? "1px solid #f3ede4" : "none" }}>
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
                  <div style={{ background: "#faf8f4", borderTop: "1px solid #f0ebe0", padding: "12px 16px" }}>
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

// ─── STOCK (INWARD) ───────────────────────────────────────────────────────────
function StockTab({ state, update, stockNav, clearStockNav }) {
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState({ bf: "", gsm: "", shade: "", size: "", showSold: false });

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
  const weightInputRef = useRef(null);

  const addReel = () => {
    if (!newReel.size || !newReel.weight) return;
    setReels(p => [...p, { ...newReel, id: genId() }]);
    setNewReel(r => ({ ...r, weight: "" }));
    // Re-focus weight input so mobile keyboard stays open for rapid entry
    setTimeout(() => weightInputRef.current?.focus(), 50);
  };

  const submit = () => {
    if (!form.supplier || reels.length === 0) return;
    const nr = reels.map(r => ({ ...r, id: genId(), sold: false, bf: form.bf, gsm: form.gsm, shade: form.shade, supplier: form.supplier, invoiceNo: form.invoiceNo, inwardDate: form.date }));
    update(s => { s.stock = [...s.stock, ...nr]; });
    setSaved(true); setReels([]);
    setTimeout(() => { setSaved(false); setView("list"); }, 1800);
  };

  const bySizeMap = {};
  reels.forEach(r => { if (!bySizeMap[r.size]) bySizeMap[r.size] = []; bySizeMap[r.size].push(r); });
  const totalWt = reels.reduce((s, r) => s + (Number(r.weight) || 0), 0);

  if (view === "add") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
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
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ marginBottom: 0 }}>Reels {reels.length > 0 && `— ${reels.length} reels, ${fmt(totalWt)} kg`}</h3>
        </div>
        {Object.entries(bySizeMap).sort((a, b) => Number(a[0]) - Number(b[0])).map(([sz, sr]) => (
          <div key={sz} style={{ marginBottom: 16 }}>
            <div className="lbl" style={{ marginBottom: 8 }}>Size {sz}" — {sr.length} reels</div>
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
        ))}
        <div className="sep" />
        <div className="lbl" style={{ marginBottom: 8 }}>Add Reel</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label className="lbl">Size (inch)</label>
            <select value={newReel.size} onChange={e => setNewReel(r => ({ ...r, size: e.target.value }))}>
              <option value="">Select size</option>{SIZE_OPTIONS.map(o => <option key={o}>{o}"</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label className="lbl">Weight (kg)</label>
            <input
              ref={weightInputRef}
              type="number"
              inputMode="numeric"
              value={newReel.weight}
              onChange={e => setNewReel(r => ({ ...r, weight: e.target.value }))}
              placeholder="e.g. 274"
              onKeyDown={e => e.key === "Enter" && addReel()}
            />
          </div>
          <button
            className="btn btn-outline"
            onMouseDown={e => e.preventDefault()}
            onClick={addReel}
          >+ Add</button>
        </div>
        <div className="sep" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "#8a8070" }}>
            Total: <span className="serif" style={{ fontSize: 22, color: "#1a1a1a" }}>{fmt(totalWt)} kg</span>
            <span style={{ fontSize: 11, color: "#b0a898", marginLeft: 6 }}>({reels.length} reels · {(totalWt / 1000).toFixed(2)} tons)</span>
          </div>
          <button className="btn btn-dark" onClick={submit} disabled={reels.length === 0 || !form.supplier}>✓ Save to Stock</button>
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

  // ── LIST VIEW ──
  const available = state.stock.filter(r => !r.sold);
  const sizeGroupMap = {};
  // Always iterate ALL stock so sizes with 0 available still appear in the list
  state.stock.forEach(r => {
    if (filter.bf && r.bf !== filter.bf) return;
    if (filter.gsm && r.gsm !== filter.gsm) return;
    if (filter.shade && r.shade !== filter.shade) return;
    if (filter.size && r.size !== filter.size) return;
    const k = `${r.size}|${r.bf}|${r.gsm}`;
    if (!sizeGroupMap[k]) sizeGroupMap[k] = { size: r.size, bf: r.bf, gsm: r.gsm, shade: r.shade, reels: [], soldReels: [] };
    if (r.sold) sizeGroupMap[k].soldReels.push(r);
    else sizeGroupMap[k].reels.push(r);
  });
  const sizeGroups = Object.values(sizeGroupMap).sort((a, b) => Number(a.size) - Number(b.size));
  const totalAvailKg = available.filter(r => (!filter.bf || r.bf === filter.bf) && (!filter.gsm || r.gsm === filter.gsm)).reduce((s, r) => s + Number(r.weight), 0);
  const totalAvailReels = available.filter(r => (!filter.bf || r.bf === filter.bf) && (!filter.gsm || r.gsm === filter.gsm)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div><div className="section-eyebrow">Inventory</div><h2>Stock Register</h2></div>
        <button className="btn btn-dark" onClick={() => { setView("add"); setSaved(false); setReels([]); }}>+ Add Inward</button>
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
              <option value="">All Sizes</option>{SIZE_OPTIONS.map(o => <option key={o}>{o}"</option>)}
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
                style={{ padding: "12px 16px", borderBottom: idx < sizeGroups.length - 1 ? "1px solid #f3ede4" : "none", cursor: "pointer", transition: "background 0.12s" }}
                onClick={() => { setFilter(f => ({ ...f, size: grp.size })); setView("size"); }}
                onMouseEnter={e => e.currentTarget.style.background = "#faf8f4"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                {/* Line 1: size + grade + count + status + arrow */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: grp.reels.length > 0 ? 6 : 0 }}>
                  <span className="serif" style={{ fontSize: 26, lineHeight: 1, color: isCritical ? "#a05800" : isModerate ? "#2a4a7a" : "#1a1a1a", minWidth: 48, flexShrink: 0 }}>{grp.size}"</span>
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
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(today());

  // Smart challan suggestion: find last used challan, parse numeric suffix, +1
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

  const available = state.stock.filter(r => !r.sold);
  const filtered = available.filter(r => {
    if (filter.bf && r.bf !== filter.bf) return false;
    if (filter.gsm && r.gsm !== filter.gsm) return false;
    if (filter.size && r.size !== filter.size) return false;
    return true;
  }).sort((a, b) => Number(a.size) - Number(b.size) || Number(a.weight) - Number(b.weight));
  const selReels = state.stock.filter(r => selected.includes(r.id));
  const totalWt = selReels.reduce((s, r) => s + Number(r.weight), 0);
  const toggleReel = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const noStockWarning = filter.size && available.filter(r => r.size === filter.size).length === 0
    ? `No ${filter.size}" reels in stock. Please check the size.` : null;

  const sell = () => {
    if (!customer || selected.length === 0) return;
    const wt = totalWt; const ct = selReels.length;
    update(s => {
      s.stock = s.stock.map(r => selected.includes(r.id) ? { ...r, sold: true, soldDate: date, soldTo: customer, soldChallanNo: challanNo } : r);
      if (customer.trim() && !s.customers.includes(customer.trim())) {
        s.customers = [...(s.customers || []), customer.trim()].sort();
      }
    });
    setDone({ count: ct, wt, customer });
  };

  if (done) return (
    <div className="card fade-in" style={{ textAlign: "center", padding: 56 }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>✓</div>
      <div className="serif" style={{ fontSize: 28 }}>Sale Recorded</div>
      <div style={{ fontSize: 13, color: "#8a8070", marginTop: 8 }}>{done.count} reels · {fmt(done.wt)} kg sold to {done.customer}</div>
      <button className="btn btn-dark" style={{ marginTop: 22 }} onClick={() => { setDone(null); setSelected([]); setCustomer(""); setChallanNo(suggestedChallan); }}>Record Another Sale</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div><div className="section-eyebrow">Dispatch</div><h2>Record a Sale</h2></div>
      <div className="card">
        <h3>Sale Details</h3>
        <div className="g3">
          <div><label className="lbl">Customer Name</label><CustomerInput value={customer} onChange={setCustomer} customers={state.customers || []} /></div>
          <div><label className="lbl">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div>
            <label className="lbl">Challan No (physical){suggestedChallan ? <span style={{ color: "#8b6914", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · auto-suggested</span> : ""}</label>
            <input value={challanNo} onChange={e => setChallanNo(e.target.value)} placeholder="e.g. CH-101" />
          </div>
        </div>
      </div>
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
              <option value="">All Sizes</option>{SIZE_OPTIONS.map(o => <option key={o}>{o}"</option>)}
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
                  style={{ cursor: "pointer", background: sel ? "#fdf9f0" : idx % 2 === 0 ? "#fff" : "#faf8f4", borderBottom: idx < filtered.length - 1 ? "1px solid #f3ede4" : "none", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s" }}>
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
              <div className="serif" style={{ fontSize: 28, lineHeight: 1.1 }}>{selected.length} reels · {fmt(totalWt)} kg</div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setCustView("challans")}>← Back</button>
        <div><div className="section-eyebrow">Customers</div><h2>Customer History</h2></div>
      </div>
      {Object.keys(custStats).length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <span className="serif-italic" style={{ fontSize: 17, color: "#b0a898" }}>No customers yet.</span>
        </div>
      ) : (
        <div className="card-flat">
          {Object.entries(custStats).sort((a, b) => b[1].kg - a[1].kg).map(([name, cs], idx, arr) => {
            const topSz = Object.entries(cs.sizes).sort((a, b) => b[1] - a[1])[0];
            return (
              <div key={name}
                onClick={() => { setSelCustomer(name); setCustView("customerDetail"); setFilterCustomer(name); setSearch(""); setFilterSize(""); setFilterGrade(""); setFilterMonth(""); }}
                style={{ padding: "14px 18px", borderBottom: idx < arr.length - 1 ? "1px solid #f3ede4" : "none", cursor: "pointer", transition: "background 0.12s" }}
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
        </div>
      )}
    </div>
  );

  const isCustomerDetail = custView === "customerDetail";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} className="fade-in">
      {isCustomerDetail ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn btn-outline btn-sm" onClick={() => { setCustView("customers"); setSelCustomer(""); setFilterCustomer(""); }}>← Customers</button>
            <div><div className="section-eyebrow">Customer Detail</div><h2>{selCustomer}</h2></div>
          </div>
          {custStats[selCustomer] && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#6a6050", paddingLeft: 2 }}>
              <span>📦 {custStats[selCustomer].challans} challans</span>
              <span>🧻 {custStats[selCustomer].reels} reels</span>
              <span>⚖️ {fmt(Math.round(custStats[selCustomer].kg))} kg ({(custStats[selCustomer].kg/1000).toFixed(2)} t)</span>
              <span>🗓 Last: {fmtDate(custStats[selCustomer].lastDate)}</span>
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
              {SIZE_OPTIONS.map(o => <option key={o}>{o}"</option>)}
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
              <div key={key} style={{ borderBottom: idx < challans.length - 1 ? "1px solid #f3ede4" : "none" }}>
                {/* Challan header */}
                <div onClick={() => !isEditing && setOpenChallan(prev => prev === key ? null : key)}
                  style={{ padding: "12px 16px", cursor: isEditing ? "default" : "pointer", display: "flex", alignItems: "center", gap: 10, transition: "background 0.12s", background: isOpen ? "#faf8f4" : "transparent" }}
                  onMouseEnter={e => { if (!isOpen && !isEditing) e.currentTarget.style.background = "#faf8f4"; }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Line 1: customer name + reels badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1a", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ch.customer || "—"}
                      </span>
                      <span className="tag tag-red" style={{ fontSize: 11, flexShrink: 0 }}>{ch.reels.length} reel{ch.reels.length !== 1 ? "s" : ""}</span>
                    </div>
                    {/* Line 2: date · challan no · kg · size tags */}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "#9a9080", fontWeight: 500 }}>{fmtDate(ch.date)}</span>
                      {ch.challanNo && <><span style={{ fontSize: 10, color: "#d0c8bc" }}>·</span><span style={{ fontSize: 11, color: "#9a9080" }}>Ch {ch.challanNo}</span></>}
                      <span style={{ fontSize: 10, color: "#d0c8bc" }}>·</span>
                      <span style={{ fontSize: 11, color: "#6a6050", fontWeight: 500 }}>{fmt(Math.round(totalWt))} kg</span>
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
                  <div style={{ background: "#faf8f4", borderTop: "1px solid #f0ebe0", padding: "14px 18px 18px 18px" }}>

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
                                {SIZE_OPTIONS.map(o => <option key={o}>{o}"</option>)}
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

                    {/* Sizes + weights */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {Object.entries(bySizeInChallan).sort((a, b) => Number(a[0]) - Number(b[0])).map(([sz, reels]) => (
                        <div key={sz} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ minWidth: 52, flexShrink: 0 }}>
                            <span className="serif" style={{ fontSize: 22, lineHeight: 1, color: "#1a1a1a" }}>{sz}"</span>
                          </div>
                          <span className="tag" style={{ flexShrink: 0 }}>{reels[0].bf} BF · {reels[0].gsm} GSM</span>
                          <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {reels.sort((a, b) => Number(a.weight) - Number(b.weight)).map((r) => (
                              <span key={r.id} style={{ background: "#fef0ee", border: "1px solid #f0c0ba", borderRadius: 5, padding: "3px 9px", fontSize: 12, color: "#9a4030", fontWeight: 500 }}>
                                {fmt(r.weight)} kg
                              </span>
                            ))}
                          </div>
                          <div style={{ fontSize: 12, color: "#9a9080", flexShrink: 0 }}>
                            {fmt(reels.reduce((s, r) => s + Number(r.weight), 0))} kg
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #e8e2d8", display: "flex", justifyContent: "flex-end", gap: 20, fontSize: 13 }}>
                      <span style={{ color: "#9a9080" }}>{ch.reels.length} reels</span>
                      <span style={{ fontWeight: 600, color: "#1a1a1a" }}>{fmt(Math.round(totalWt))} kg total</span>
                    </div>
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
function getWeekBounds(offset = 0) {
  const now = new Date();
  const dow = now.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now); mon.setDate(now.getDate() + diff + offset * 7); mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 999);
  return [mon, sun];
}
function filterByPeriod(sold, period) {
  if (!period) return sold;
  if (period === "today") {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    return sold.filter(r => { const d = new Date(r.soldDate); return d >= s && d <= e; });
  }
  if (period === "week") { const [s, e] = getWeekBounds(0); return sold.filter(r => { const d = new Date(r.soldDate); return d >= s && d <= e; }); }
  if (period === "lastweek") { const [s, e] = getWeekBounds(-1); return sold.filter(r => { const d = new Date(r.soldDate); return d >= s && d <= e; }); }
  return sold.filter(r => monthKey(r.soldDate) === period);
}
function periodLabel(period) {
  if (!period) return "All Time";
  if (period === "today") return "Today";
  if (period === "week") return "This Week";
  if (period === "lastweek") return "Last Week";
  return monthLabel(period);
}

function ReportsTab({ state }) {
  const sold = state.stock.filter(r => r.sold && r.soldDate);
  const allMonths = [...new Set(sold.map(r => monthKey(r.soldDate)))].sort().reverse();
  const [selPeriod, setSelPeriod] = useState(allMonths[0] || "");
  const periodSold = filterByPeriod(sold, selPeriod);
  const totalReels = periodSold.length;
  const totalKg = periodSold.reduce((s, r) => s + Number(r.weight), 0);
  const totalTons = totalKg / 1000;
  const gradeMap = {};
  periodSold.forEach(r => { const k = `${r.bf} BF ${r.gsm} GSM`; if (!gradeMap[k]) gradeMap[k] = { reels: 0, kg: 0 }; gradeMap[k].reels++; gradeMap[k].kg += Number(r.weight); });
  const sizeMap = {};
  periodSold.forEach(r => { sizeMap[r.size] = (sizeMap[r.size] || 0) + 1; });
  const topSizes = Object.entries(sizeMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const custMap = {};
  periodSold.forEach(r => {
    const c = r.soldTo || "Unknown";
    if (!custMap[c]) custMap[c] = { reels: 0, kg: 0, sizes: {}, grades: {} };
    custMap[c].reels++; custMap[c].kg += Number(r.weight);
    custMap[c].sizes[r.size] = (custMap[c].sizes[r.size] || 0) + 1;
    custMap[c].grades[`${r.bf} BF ${r.gsm} GSM`] = (custMap[c].grades[`${r.bf} BF ${r.gsm} GSM`] || 0) + 1;
  });
  const top5Cust = Object.entries(custMap).sort((a, b) => b[1].kg - a[1].kg).slice(0, 5);
  const last6 = allMonths.slice(0, 6).reverse();
  const trendData = last6.map(m => ({ label: monthLabel(m).split(" ")[0], value: sold.filter(r => monthKey(r.soldDate) === m).reduce((s, r) => s + Number(r.weight), 0) }));
  const avgWeight = totalReels > 0 ? (totalKg / totalReels).toFixed(0) : 0;
  const topSize = topSizes[0]?.[0] || "—";
  const isShortPeriod = ["today", "week", "lastweek"].includes(selPeriod);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div><div className="section-eyebrow">Analytics</div><h2>Reports</h2></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label className="lbl" style={{ marginBottom: 0 }}>Period</label>
          <select value={selPeriod} onChange={e => setSelPeriod(e.target.value)} style={{ width: "auto", padding: "7px 12px" }}>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="lastweek">Last Week</option>
            <option value="">All Time</option>
            {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
      </div>
      <div className="g4">
        {[
          { label: "Reels Sold", val: totalReels, unit: "reels" },
          { label: "Total Weight", val: totalTons.toFixed(2), unit: "tons" },
          { label: "Total Weight (kg)", val: fmt(Math.round(totalKg)), unit: "kilograms" },
          { label: "Avg Reel Weight", val: avgWeight, unit: "kg per reel" },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: "18px 20px" }}>
            <div className="lbl">{s.label}</div>
            <div className="stat-num" style={{ fontSize: 32 }}>{s.val}</div>
            <div className="serif-italic" style={{ fontSize: 12, color: "#b0a898", marginTop: 3 }}>{s.unit}</div>
          </div>
        ))}
      </div>
      {!isShortPeriod && trendData.length > 1 && (
        <div className="card">
          <h3>Monthly Sales Trend — Weight Dispatched</h3>
          <BarChart data={trendData} color="#8b6914" unit="t" height={110} />
          <div style={{ fontSize: 11, color: "#b0a898", marginTop: 8, fontStyle: "italic" }}>Last {trendData.length} months. Darker bar = most recent.</div>
        </div>
      )}
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
      <div className="card">
        <h3>Top 5 Customers</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {top5Cust.map(([name, data], idx) => {
            const topSz = Object.entries(data.sizes).sort((a, b) => b[1] - a[1])[0];
            const topGr = Object.entries(data.grades).sort((a, b) => b[1] - a[1])[0];
            const barW = top5Cust[0] ? (data.kg / top5Cust[0][1].kg) * 100 : 0;
            return (
              <div key={name} style={{ padding: "16px 0", borderBottom: idx < top5Cust.length - 1 ? "1px solid #f3ede4" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 28, height: 28, background: CHART_COLORS[idx], borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 600 }}>{idx + 1}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                      <div style={{ fontSize: 11, color: "#9a9080", marginTop: 2 }}>{data.reels} reels · {fmt(Math.round(data.kg))} kg · {(data.kg / 1000).toFixed(2)} tons</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {topSz && <div style={{ fontSize: 11 }}>Top size: <span className="serif" style={{ fontSize: 16 }}>{topSz[0]}"</span> <span style={{ color: "#9a9080" }}>({topSz[1]}×)</span></div>}
                    {topGr && <div style={{ fontSize: 11, color: "#9a9080", marginTop: 2 }}>{topGr[0]}</div>}
                  </div>
                </div>
                <div style={{ background: "#f3ede4", borderRadius: 3, height: 4, overflow: "hidden" }}>
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
      <div className="card" style={{ background: "#1a1a1a", color: "#f8f7f4", border: "none" }}>
        <h3 style={{ color: "#a09080", marginBottom: 16 }}>Key Insights — {periodLabel(selPeriod)}</h3>
        <div className="g3">
          {[
            { label: "Top Size", val: topSize + '"', sub: "most reels sold" },
            { label: "Top Customer", val: top5Cust[0]?.[0] || "—", sub: `${fmt(Math.round(top5Cust[0]?.[1].kg || 0))} kg bought` },
            { label: "Top Grade", val: Object.entries(gradeMap).sort((a, b) => b[1].kg - a[1].kg)[0]?.[0]?.replace(" GSM", "").replace(" BF", "BF /") || "—", sub: "by weight" },
          ].map(x => (
            <div key={x.label}>
              <div className="lbl" style={{ color: "#6a5a4a" }}>{x.label}</div>
              <div className="serif" style={{ fontSize: 22, color: "#f8f7f4", lineHeight: 1.2 }}>{x.val}</div>
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
          <div key={g.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #f3ede4" }}>
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
          <span>📦 {state.stock.length} total reels</span>
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
