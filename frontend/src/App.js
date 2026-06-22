import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  UserMgmtModule, AuditLogsModule, InventoryLendingModule,
  NotifTemplatesModule, AdvancedAnalyticsModule, AutoAllocateModule,
  AdvancedPayslipModule, IncidentWorkflowModule
} from "./Phase2";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

// ─── DESIGN SYSTEM ── Stripe-inspired, vibrant, high-energy ─────────────────
const C = {
  // Core brand
  primary:    "#5B21B6",      // vivid electric purple
  accent:     "#7C3AED",
  accentHover:"#6D28D9",
  accentGlow: "rgba(124,58,237,0.35)",
  // Vibrant palette
  cyan:   "#06B6D4",
  green:  "#10B981",
  red:    "#EF4444",
  amber:  "#F59E0B",
  blue:   "#3B82F6",
  indigo: "#6366F1",
  pink:   "#EC4899",
  teal:   "#14B8A6",
  orange: "#F97316",
  // Surfaces
  bg:     "#F5F3FF",          // very light purple tint
  card:   "#FFFFFF",
  glass:  "rgba(255,255,255,0.85)",
  border: "#EDE9FE",
  borderStrong: "#C4B5FD",
  // Sidebar — deep navy-purple
  sidebar:  "#1E1B4B",
  sidebarBorder: "rgba(139,92,246,0.2)",
  // Text
  text:    "#1E1B4B",
  textSub: "#4C1D95",
  muted:   "#7C3AED",
  mutedLight: "#A78BFA",
};

// Gradient presets — bold, vibrant
const G = {
  purple: "linear-gradient(135deg, #4C1D95 0%, #7C3AED 50%, #8B5CF6 100%)",
  cyan:   "linear-gradient(135deg, #0C4A6E 0%, #0891B2 50%, #06B6D4 100%)",
  green:  "linear-gradient(135deg, #064E3B 0%, #059669 50%, #10B981 100%)",
  red:    "linear-gradient(135deg, #7F1D1D 0%, #DC2626 50%, #EF4444 100%)",
  amber:  "linear-gradient(135deg, #78350F 0%, #D97706 50%, #F59E0B 100%)",
  blue:   "linear-gradient(135deg, #1E3A8A 0%, #2563EB 50%, #3B82F6 100%)",
  indigo: "linear-gradient(135deg, #1E1B4B 0%, #4338CA 50%, #6366F1 100%)",
  pink:   "linear-gradient(135deg, #831843 0%, #DB2777 50%, #EC4899 100%)",
  teal:   "linear-gradient(135deg, #134E4A 0%, #0D9488 50%, #14B8A6 100%)",
  orange: "linear-gradient(135deg, #7C2D12 0%, #EA580C 50%, #F97316 100%)",
  dark:   "linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%)",
};

// ─── GLOBAL ANIMATIONS ───────────────────────────────────────────────────────
const injectStyles = () => {
  if (document.getElementById('ro-styles')) return;
  const s = document.createElement('style');
  s.id = 'ro-styles';
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #F5F3FF; color: #1E1B4B; -webkit-font-smoothing: antialiased; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #F5F3FF; }
    ::-webkit-scrollbar-thumb { background: #C4B5FD; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #7C3AED; }

    @keyframes fadeInUp {
      from { opacity:0; transform:translateY(16px); }
      to   { opacity:1; transform:translateY(0); }
    }
    @keyframes fadeIn {
      from { opacity:0; } to { opacity:1; }
    }
    @keyframes slideInLeft {
      from { opacity:0; transform:translateX(-20px); }
      to   { opacity:1; transform:translateX(0); }
    }
    @keyframes pulse-glow {
      0%,100% { box-shadow: 0 0 0 0 rgba(124,58,237,0.4); }
      50%      { box-shadow: 0 0 0 8px rgba(124,58,237,0); }
    }
    @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    @keyframes shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes countUp {
      from { opacity:0; transform:scale(0.8); }
      to   { opacity:1; transform:scale(1); }
    }
    @keyframes ripple {
      to { transform:scale(4); opacity:0; }
    }
    @keyframes float {
      0%,100% { transform:translateY(0px); }
      50%      { transform:translateY(-6px); }
    }
    @keyframes gradientShift {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    @keyframes notifBounce {
      0%,100% { transform:scale(1); }
      50%      { transform:scale(1.2); }
    }

    .ro-btn { position:relative; overflow:hidden; transition: transform 0.12s, box-shadow 0.12s !important; }
    .ro-btn:hover:not(:disabled) { transform:translateY(-1px) !important; }
    .ro-btn:active:not(:disabled) { transform:translateY(0) scale(0.98) !important; }
    .ro-btn::after {
      content:''; position:absolute; inset:0;
      background:rgba(255,255,255,0.15); border-radius:inherit;
      opacity:0; transition:opacity 0.15s;
    }
    .ro-btn:hover::after { opacity:1; }

    .ro-card { transition: transform 0.15s, box-shadow 0.15s !important; }
    .ro-card:hover { transform:translateY(-2px); box-shadow:0 12px 40px rgba(124,58,237,0.15) !important; }

    .ro-stat-card { animation: fadeInUp 0.4s ease both; }
    .ro-stat-card:nth-child(1) { animation-delay:0.05s; }
    .ro-stat-card:nth-child(2) { animation-delay:0.10s; }
    .ro-stat-card:nth-child(3) { animation-delay:0.15s; }
    .ro-stat-card:nth-child(4) { animation-delay:0.20s; }
    .ro-stat-card:nth-child(5) { animation-delay:0.25s; }
    .ro-stat-card:nth-child(6) { animation-delay:0.30s; }
    .ro-stat-card:nth-child(7) { animation-delay:0.35s; }
    .ro-stat-card:nth-child(8) { animation-delay:0.40s; }

    .ro-page { animation: fadeInUp 0.35s ease both; }

    .ro-table-row { transition: background 0.1s, transform 0.1s !important; }
    .ro-table-row:hover { background: #F5F3FF !important; transform: translateX(2px); }

    .ro-nav-item { transition: all 0.15s !important; }
    .ro-nav-item:hover { background:rgba(139,92,246,0.12) !important; transform:translateX(3px); }

    .skeleton {
      background: linear-gradient(90deg, #EDE9FE 25%, #DDD6FE 50%, #EDE9FE 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
      border-radius: 8px;
    }

    .glow-badge { animation: pulse-glow 2s infinite; }
    .float-icon { animation: float 3s ease-in-out infinite; }

    .ro-input { transition: all 0.15s !important; }
    .ro-input:focus { border-color: #7C3AED !important; box-shadow: 0 0 0 3px rgba(124,58,237,0.15) !important; outline:none !important; background:#fff !important; }

    .gradient-bg {
      background: linear-gradient(-45deg, #1E1B4B, #4C1D95, #1E3A8A, #064E3B);
      background-size: 400% 400%;
      animation: gradientShift 12s ease infinite;
    }

    .bento-grid {
      display: grid;
      gap: 16px;
    }

    /* Tooltip overrides */
    .recharts-tooltip-wrapper .recharts-default-tooltip {
      border-radius: 12px !important;
      border: 1px solid #EDE9FE !important;
      box-shadow: 0 8px 32px rgba(124,58,237,0.15) !important;
      font-family: 'Inter', sans-serif !important;
    }

    @media (max-width: 768px) {
      .ro-sidebar { width: 60px !important; }
      .ro-sidebar-label { display: none !important; }
    }
  `;
  document.head.appendChild(s);
};

// ─── API HELPER ──────────────────────────────────────────────────────────────
function apiFetch(path, opts = {}, token) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body instanceof FormData) delete headers["Content-Type"];
  return fetch(API + path, { ...opts, headers });
}

// Authenticated PDF download — fetches with Bearer token, converts to blob,
// and triggers a browser download. window.open() can't pass headers, so
// protected endpoints (Depends(current_user)) need this approach.
async function downloadPdf(path, filename) {
  try {
    const token = localStorage.getItem("ro_token") || "";
    const res = await fetch(API + path, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      let msg = `Download failed (HTTP ${res.status})`;
      try { const j = await res.json(); if (j?.message || j?.detail) msg = j.message || j.detail; } catch (_) { /* non-JSON error */ }
      alert("⛔ " + msg);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    alert("⛔ Network error: " + (e?.message || e));
  }
}

// ─── REUSABLE PRIMITIVES ─────────────────────────────────────────────────────
function Badge({ color = "blue", children, glow }) {
  const s = {
    purple: { bg:"#EDE9FE", color:"#5B21B6", border:"#C4B5FD" },
    blue:   { bg:"#DBEAFE", color:"#1D4ED8", border:"#93C5FD" },
    green:  { bg:"#D1FAE5", color:"#065F46", border:"#6EE7B7" },
    red:    { bg:"#FEE2E2", color:"#991B1B", border:"#FCA5A5" },
    amber:  { bg:"#FEF3C7", color:"#92400E", border:"#FDE68A" },
    gray:   { bg:"#F3F4F6", color:"#374151", border:"#D1D5DB" },
    pink:   { bg:"#FCE7F3", color:"#9D174D", border:"#F9A8D4" },
    indigo: { bg:"#E0E7FF", color:"#3730A3", border:"#A5B4FC" },
    cyan:   { bg:"#CFFAFE", color:"#155E75", border:"#67E8F9" },
    teal:   { bg:"#CCFBF1", color:"#134E4A", border:"#5EEAD4" },
    orange: { bg:"#FFEDD5", color:"#7C2D12", border:"#FED7AA" },
  }[color] || { bg:"#F3F4F6", color:"#374151", border:"#D1D5DB" };
  return (
    <span className={glow ? "glow-badge" : ""} style={{
      display:"inline-flex", alignItems:"center", padding:"2px 10px",
      borderRadius:20, fontSize:11, fontWeight:700, letterSpacing:"0.03em",
      background:s.bg, color:s.color, border:`1px solid ${s.border}`,
      whiteSpace:"nowrap"
    }}>
      {children}
    </span>
  );
}

function dutyTagColor(tag) {
  return { "On Duty":"green","Available":"purple","Off Duty":"gray","On Leave":"amber",
    "Standby":"cyan","Suspended":"red","Terminated":"red","On Break":"orange" }[tag] || "gray";
}
function statusColor(s) {
  return { "Active":"green","Completed":"teal","Paid":"green","Approved":"green",
    "Converted":"green","Present":"green","Pending":"amber","Partial":"amber","New":"purple",
    "Received":"cyan","Scheduled":"blue","In Progress":"blue","Cancelled":"red","Closed":"gray",
    "Rejected":"red","Verified":"indigo","Signed":"green","Failed":"red","Pass":"green","Fail":"red",
    "Non-Compliant":"red","Compliant":"green","Action Needed":"amber",
    "Rostered":"blue","Free":"green","On Assignment":"orange" }[s] || "gray";
}

// Vibrant animated stat card
function StatCard({ icon, label, value, sub, gradient = G.purple, onClick, delay=0 }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="ro-stat-card"
      onClick={onClick}
      onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}
      style={{
        background: gradient,
        borderRadius: 18,
        padding: "20px 22px",
        color: "#fff",
        position: "relative",
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.18s",
        transform: hovered && onClick ? "translateY(-4px) scale(1.02)" : "none",
        boxShadow: hovered && onClick
          ? "0 20px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.1)"
          : "0 4px 20px rgba(0,0,0,0.15)",
        animationDelay: `${delay}ms`,
      }}
    >
      {/* Decorative circles */}
      <div style={{ position:"absolute", top:-30, right:-30, width:120, height:120, borderRadius:"50%", background:"rgba(255,255,255,0.07)", pointerEvents:"none" }}/>
      <div style={{ position:"absolute", bottom:-20, left:-10, width:80, height:80, borderRadius:"50%", background:"rgba(255,255,255,0.05)", pointerEvents:"none" }}/>
      <div style={{ fontSize:12, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.12em", opacity:0.85, marginBottom:12 }}>{label}</div>
      <div style={{ fontSize:40, fontWeight:900, lineHeight:1, marginBottom:sub?6:0, animation:"countUp 0.5s ease both", textShadow:"0 2px 8px rgba(0,0,0,0.18)" }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize:12.5, opacity:0.88, marginTop:5, fontWeight:600 }}>{sub}</div>}
      <div style={{ position:"absolute", bottom:14, right:16, fontSize:36, opacity:0.32 }}>{icon}</div>
    </div>
  );
}

// Ripple Button
function Btn({ children, onClick, color, small, outline, danger, disabled, full, icon, style={}, ...rest }) {
  const bg = danger ? C.red : (color || C.accent);
  const rippleRef = useRef(null);

  function handleClick(e) {
    if (disabled) return;
    // Ripple effect
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `
      position:absolute; border-radius:50%; pointer-events:none;
      width:${size}px; height:${size}px;
      left:${e.clientX - rect.left - size/2}px;
      top:${e.clientY - rect.top - size/2}px;
      background:rgba(255,255,255,0.3);
      transform:scale(0); animation:ripple 0.5s ease-out;
    `;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
    onClick && onClick(e);
  }

  const base = {
    position:"relative", overflow:"hidden",
    padding: small ? "7px 16px" : "11px 24px",
    borderRadius: 11, border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: small ? 13 : 14.5, fontWeight: 800,
    display: "inline-flex", alignItems: "center", gap: 7,
    transition: "all 0.15s",
    opacity: disabled ? 0.45 : 1,
    whiteSpace: "nowrap",
    letterSpacing: "0.015em",
    ...(full && { width:"100%", justifyContent:"center" }),
    ...(outline
      ? { background:"transparent", border:`2px solid ${danger?C.red:bg}`, color:danger?C.red:bg }
      : { background:bg, color:"#fff",
          boxShadow: disabled ? "none" : `0 2px 12px ${bg}55, inset 0 1px 0 rgba(255,255,255,0.15)` }),
    ...style,
  };
  return (
    <button className="ro-btn" style={base} onClick={handleClick} disabled={disabled} {...rest}>
      {icon && <span style={{ fontSize:14 }}>{icon}</span>}
      {children}
    </button>
  );
}

// Skeleton loader
function Skeleton({ width="100%", height=20, radius=8, style={} }) {
  return <div className="skeleton" style={{ width, height, borderRadius:radius, ...style }}/>;
}

// Glass modal with animation
function Modal({ open, title, onClose, children, wide, extraWide }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) { setTimeout(() => setVisible(true), 10); }
    else setVisible(false);
  }, [open]);

  if (!open) return null;
  const maxW = extraWide ? 1100 : wide ? 860 : 580;
  return (
    <div style={{
      position:"fixed", inset:0,
      background: visible ? "rgba(30,27,75,0.65)" : "transparent",
      zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center",
      padding:16, backdropFilter: visible ? "blur(6px)" : "none",
      transition:"background 0.2s, backdrop-filter 0.2s"
    }}>
      <div style={{
        background:"#fff", borderRadius:22, width:"100%", maxWidth:maxW,
        maxHeight:"92vh", overflow:"auto",
        boxShadow:"0 30px 90px rgba(30,27,75,0.35), 0 0 0 1px rgba(196,181,253,0.3)",
        border:`1px solid ${C.border}`,
        transform: visible ? "translateY(0) scale(1)" : "translateY(20px) scale(0.97)",
        opacity: visible ? 1 : 0,
        transition:"transform 0.25s cubic-bezier(.34,1.56,.64,1), opacity 0.2s"
      }}>
        <div style={{
          padding:"18px 24px", borderBottom:`1px solid ${C.border}`,
          display:"flex", justifyContent:"space-between", alignItems:"center",
          position:"sticky", top:0, background:"rgba(255,255,255,0.95)",
          backdropFilter:"blur(8px)", zIndex:1, borderRadius:"22px 22px 0 0"
        }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:800, color:C.text, letterSpacing:"-0.01em" }}>{title}</h3>
          <button onClick={onClose} style={{
            background:C.bg, border:`1px solid ${C.border}`, width:32, height:32,
            borderRadius:8, cursor:"pointer", fontSize:16, color:C.muted,
            display:"flex", alignItems:"center", justifyContent:"center",
            transition:"all 0.15s",
          }}
            onMouseEnter={e=>{ e.currentTarget.style.background=C.red; e.currentTarget.style.color="#fff"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background=C.bg; e.currentTarget.style.color=C.muted; }}
          >✕</button>
        </div>
        <div style={{ padding:"20px 24px" }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <label style={{ display:"flex", gap:5, fontSize:12.5, fontWeight:800, color:C.textSub, marginBottom:7, letterSpacing:"0.06em", textTransform:"uppercase" }}>
        {label}
        {required && <span style={{ color:C.red }}>*</span>}
        {hint && <span style={{ color:C.mutedLight, fontWeight:500, textTransform:"none", letterSpacing:0 }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inp = {
  width:"100%", boxSizing:"border-box", padding:"11px 14px",
  border:`1.5px solid ${C.border}`, borderRadius:10, fontSize:14,
  color:C.text, background:"#FDFCFF", outline:"none",
  fontFamily:"inherit", fontWeight:500,
};

function Input({ label, required, hint, ...props }) {
  return (
    <Field label={label} required={required} hint={hint}>
      <input className="ro-input" style={inp} {...props} />
    </Field>
  );
}
function Select({ label, required, hint, options=[], valueKey="value", labelKey="label", ...props }) {
  return (
    <Field label={label} required={required} hint={hint}>
      <select className="ro-input" style={inp} {...props}>
        <option value="">— Select —</option>
        {options.map(o => typeof o==="string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o[valueKey]} value={o[valueKey]}>{o[labelKey]}</option>)}
      </select>
    </Field>
  );
}
function Textarea({ label, required, hint, rows=3, ...props }) {
  return (
    <Field label={label} required={required} hint={hint}>
      <textarea className="ro-input" style={{ ...inp, resize:"vertical" }} rows={rows} {...props} />
    </Field>
  );
}
function Grid({ cols=2, children }) {
  return <div style={{ display:"grid", gridTemplateColumns:`repeat(${cols},1fr)`, gap:14 }}>{children}</div>;
}

function Table({ cols, rows, onRowClick, compact }) {
  const rowH = compact ? "10px 14px" : "14px 18px";
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14 }}>
        <thead>
          <tr style={{ background:"linear-gradient(90deg,#F5F3FF,#EDE9FE)" }}>
            {cols.map(c => (
              <th key={c.key||c.label} style={{
                padding:"13px 18px", textAlign:"left", color:C.textSub,
                fontWeight:900, fontSize:11.5, textTransform:"uppercase",
                letterSpacing:"0.1em", borderBottom:`2px solid ${C.border}`,
                whiteSpace:"nowrap"
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length===0
            ? <tr><td colSpan={cols.length} style={{ padding:48, textAlign:"center", color:C.mutedLight }}>
                <div style={{ fontSize:36, marginBottom:10, animation:"float 3s ease-in-out infinite" }}>📭</div>
                <div style={{ fontWeight:600, color:C.mutedLight }}>No records found</div>
              </td></tr>
            : rows.map((row,i)=>(
              <tr key={row.id||i}
                className="ro-table-row"
                onClick={()=>onRowClick?.(row)}
                style={{
                  borderBottom:`1px solid ${C.border}`,
                  cursor:onRowClick?"pointer":"default",
                  background:"#fff"
                }}>
                {cols.map(c=>(
                  <td key={c.key||c.label} style={{ padding:rowH, color:C.text, verticalAlign:"middle" }}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function SearchBar({ value, onChange, placeholder }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ position:"relative" }}>
      <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, color:focus?C.accent:C.mutedLight, transition:"color 0.15s" }}>🔍</span>
      <input
        className="ro-input"
        style={{ ...inp, paddingLeft:36, minWidth:230, borderColor:focus?C.accent:C.border }}
        value={value}
        onChange={e=>onChange(e.target.value)}
        placeholder={placeholder||"Search…"}
        onFocus={()=>setFocus(true)}
        onBlur={()=>setFocus(false)}
      />
    </div>
  );
}

function FilterBar({ children }) {
  return (
    <div style={{
      background:"rgba(255,255,255,0.8)", backdropFilter:"blur(8px)",
      borderRadius:14, padding:"12px 16px", marginBottom:16,
      border:`1px solid ${C.border}`,
      display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end",
      boxShadow:"0 2px 12px rgba(124,58,237,0.06)"
    }}>
      {children}
    </div>
  );
}

function Card({ children, style={}, className="" }) {
  return (
    <div className={`ro-card ${className}`} style={{
      background:"#fff", borderRadius:16,
      border:`1px solid ${C.border}`,
      boxShadow:"0 2px 12px rgba(124,58,237,0.06)",
      overflow:"hidden", ...style
    }}>
      {children}
    </div>
  );
}

function AlertBanner({ type="info", icon, title, sub, action, onAction }) {
  const styles = {
    warning: { bg:"#FFFBEB", border:"#FDE68A", color:"#92400E", btn:"#FDE68A" },
    danger:  { bg:"#FEF2F2", border:"#FECACA", color:"#991B1B", btn:"#FECACA" },
    info:    { bg:"#F5F3FF", border:"#C4B5FD", color:"#5B21B6", btn:"#DDD6FE" },
    success: { bg:"#F0FDF4", border:"#BBF7D0", color:"#065F46", btn:"#BBF7D0" },
  }[type];
  return (
    <div style={{
      background:styles.bg, border:`1px solid ${styles.border}`, borderRadius:12,
      padding:"10px 16px", marginBottom:12, display:"flex", alignItems:"center", gap:12,
      fontSize:13, animation:"slideInLeft 0.3s ease"
    }}>
      <span style={{ fontSize:18 }}>{icon}</span>
      <div style={{ flex:1 }}>
        <span style={{ fontWeight:700, color:styles.color }}>{title}</span>
        {sub && <span style={{ color:styles.color, marginLeft:4, opacity:0.8 }}>{sub}</span>}
      </div>
      {action && (
        <button onClick={onAction} style={{
          background:styles.btn, border:"none", borderRadius:8, padding:"4px 14px",
          fontSize:12, fontWeight:700, color:styles.color, cursor:"pointer"
        }}>{action}</button>
      )}
    </div>
  );
}

// Progress bar component
function ProgressBar({ value, max=100, color=C.accent, height=6, label }) {
  const pct = Math.min(100, Math.round((value/max)*100));
  const barColor = value/max >= 0.8 ? C.green : value/max >= 0.5 ? C.amber : C.red;
  return (
    <div>
      {label && (
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
          <span style={{ color:C.textSub }}>{label}</span>
          <span style={{ fontWeight:700, color:barColor }}>{pct}%</span>
        </div>
      )}
      <div style={{ height, background:"#EDE9FE", borderRadius:height/2, overflow:"hidden" }}>
        <div style={{
          width:`${pct}%`, height:"100%", borderRadius:height/2,
          background:`linear-gradient(90deg, ${barColor}, ${barColor}cc)`,
          transition:"width 0.8s cubic-bezier(.34,1.56,.64,1)"
        }}/>
      </div>
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  useEffect(() => { injectStyles(); }, []);

  const [token, setToken] = useState(()=>localStorage.getItem("ro_token")||"");
  const [user, setUser] = useState(()=>{
    try{ const t=localStorage.getItem("ro_token"); if(!t) return null;
      return JSON.parse(atob(t.split(".")[1])); }catch{ return null; }
  });
  const [page, setPage] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const prevPage = useRef(page);

  const auth = useCallback((path, opts={})=>apiFetch(path,opts,token),[token]);

  useEffect(()=>{
    if(token) auth("/notifications").then(r=>r.json()).then(d=>Array.isArray(d)&&setNotifs(d)).catch(()=>{});
  },[token,page]);

  function logout(){ setToken(""); setUser(null); localStorage.removeItem("ro_token"); }

  if(!token) return <LoginPage setToken={setToken} setUser={setUser} />;

  const navGroups = [
    { group:"Overview", items:[
      { id:"dashboard", icon:"⊞", label:"Dashboard" },
    ]},
    { group:"Operations", items:[
      { id:"staff",      icon:"👥", label:"Staff" },
      { id:"attendance", icon:"🗓️", label:"Attendance & Roster" },
      { id:"patients",   icon:"🏥", label:"Patients" },
      { id:"leads",      icon:"📋", label:"Leads" },
      { id:"bookings",   icon:"📅", label:"Bookings" },
    ]},
    { group:"Finance", items:[
      { id:"services_catalog", icon:"🧾", label:"Services" },
      { id:"billing",  icon:"💰", label:"Billing" },
      { id:"wallet",   icon:"💼", label:"Wallet" },
      { id:"refunds",  icon:"↩️", label:"Refunds" },
      { id:"payroll",  icon:"💳", label:"Payroll" },
    ]},
    { group:"Clinical", items:[
      { id:"medical_charts", icon:"📊", label:"Medical Charts" },
      { id:"consent",        icon:"✍️", label:"Consents" },
      { id:"feedback",       icon:"⭐", label:"Feedback" },
    ]},
    { group:"Services", items:[
      { id:"ambulance", icon:"🚑", label:"Ambulance" },
      { id:"assets",    icon:"📦", label:"Assets" },
      { id:"vendors",   icon:"🏢", label:"Vendors" },
    ]},
    { group:"HR & Quality", items:[
      { id:"training",  icon:"🎓", label:"Training & MCQ" },
      { id:"incidents", icon:"🚨", label:"Incidents" },
      { id:"alerts",    icon:"🔔", label:"Alerts" },
      { id:"geofencing",icon:"📍", label:"Geofencing" },
    ]},
    { group:"Automation", items:[
      { id:"automation",     icon:"⚡", label:"Automation Engine" },
      { id:"notifications_engine", icon:"📲", label:"Notification Engine" },
    ]},
    { group:"Apps", items:[
      { id:"patient_app",   icon:"📱", label:"Patient App" },
      { id:"staff_app",     icon:"🧑‍💼", label:"Staff App" },
    ]},
    { group:"Insights", items:[
      { id:"analytics", icon:"📈", label:"Analytics" },
      { id:"analytics_plus", icon:"🎯", label:"NPS & Forecast" },
      { id:"reports",   icon:"📄", label:"Reports" },
    ]},
    { group:"Admin", items:[
      { id:"users",         icon:"👤", label:"User Management" },
      { id:"audit_logs",    icon:"🛡️", label:"Audit Logs" },
      { id:"inventory",     icon:"📦", label:"Inventory & Lending" },
      { id:"notif_templates", icon:"📨", label:"Notif Templates" },
      { id:"auto_allocate", icon:"🤖", label:"Auto-Allocate" },
      { id:"adv_payslip",   icon:"💳", label:"Advanced Payslip" },
      { id:"incidents_v2",  icon:"🚨", label:"Incident Workflow" },
    ]},
  ];

  const allItems = navGroups.flatMap(g=>g.items);
  const currentLabel = allItems.find(n=>n.id===page)?.label||"Dashboard";
  const pendingNotifs = notifs.filter(n=>n.status==="Pending").length;

  return (
    <div style={{ display:"flex", height:"100vh", background:"linear-gradient(135deg, #FAF5FF 0%, #F5F3FF 40%, #EEF2FF 100%)", fontFamily:"'Plus Jakarta Sans','Inter',-apple-system,sans-serif", color:C.text, overflow:"hidden" }}>

      {/* ── SIDEBAR ── */}
      <aside className="ro-sidebar" style={{
        width:sidebarCollapsed?78:280,
        background:C.sidebar,
        display:"flex", flexDirection:"column",
        flexShrink:0, transition:"width 0.25s cubic-bezier(.34,1.56,.64,1)",
        overflowY:"auto", overflowX:"hidden",
        borderRight:"1px solid rgba(139,92,246,0.18)",
        boxShadow:"6px 0 32px rgba(30,27,75,0.18)"
      }}>
        {/* Logo */}
        <div style={{ padding:"26px 16px 22px", borderBottom:"1px solid rgba(139,92,246,0.25)", display:"flex", alignItems:"center", gap:14, minHeight:120, background:"linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(99,102,241,0.08) 100%)" }}>
          <div style={{ flexShrink:0, position:"relative" }}>
            <img src="/logo.png" alt="Reach Out" style={{ width:74, height:74, borderRadius:"50%", objectFit:"cover", border:"3px solid rgba(167,139,250,0.65)", boxShadow:"0 8px 28px rgba(139,92,246,0.55)" }}
              onError={e=>{ if(!e.target.dataset.tried){e.target.dataset.tried="1";e.target.src="/logo.svg";} else {e.target.style.display="none"; e.target.nextSibling.style.display="flex";} }}/>
            <div style={{ width:74, height:74, borderRadius:"50%", background:G.purple, display:"none", alignItems:"center", justifyContent:"center", fontSize:34, boxShadow:"0 8px 28px rgba(139,92,246,0.55)" }}>🏥</div>
            <div style={{ position:"absolute", bottom:1, right:1, width:16, height:16, background:"#10B981", borderRadius:"50%", border:"3px solid #1E1B4B", boxShadow:"0 0 0 0 rgba(16,185,129,0.6)", animation:"pulse 2s infinite" }}/>
          </div>
          {!sidebarCollapsed && (
            <div className="ro-sidebar-label" style={{ overflow:"hidden" }}>
              <div style={{ color:"#fff", fontWeight:900, fontSize:20, letterSpacing:"-0.02em", lineHeight:1.1 }}>Reach Out</div>
              <div style={{ color:"#C4B5FD", fontSize:11, fontWeight:700, marginTop:3, textTransform:"uppercase", letterSpacing:"0.12em" }}>Healthcare Ops</div>
              <div style={{ color:"rgba(167,139,250,0.6)", fontSize:9.5, fontWeight:500, marginTop:1, fontStyle:"italic" }}>An SGRH initiative</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:"10px 10px", overflowY:"auto" }}>
          {navGroups.map(g=>(
            <div key={g.group}>
              {!sidebarCollapsed && (
                <div style={{ padding:"16px 12px 6px", fontSize:11, fontWeight:900, color:"#C4B5FD", textTransform:"uppercase", letterSpacing:"0.14em", opacity:0.9 }}>{g.group}</div>
              )}
              {g.items.map(item=>{
                const active = page===item.id;
                return (
                  <div
                    key={item.id}
                    className="ro-nav-item"
                    onClick={()=>setPage(item.id)}
                    title={sidebarCollapsed?item.label:""}
                    style={{
                      display:"flex", alignItems:"center", gap:13,
                      padding:sidebarCollapsed?"13px 0":"11px 14px",
                      justifyContent:sidebarCollapsed?"center":"flex-start",
                      cursor:"pointer", margin:"3px 0", borderRadius:11,
                      background:active ? "linear-gradient(90deg, rgba(167,139,250,0.32) 0%, rgba(139,92,246,0.18) 100%)" : "transparent",
                      borderLeft:active&&!sidebarCollapsed ? "4px solid #A78BFA" : "4px solid transparent",
                      color:active ? "#fff" : "rgba(216,180,254,0.92)",
                      fontSize:15, fontWeight:active?800:600,
                      boxShadow:active?"0 4px 18px rgba(139,92,246,0.25)":"none",
                      transition:"all 0.18s ease",
                    }}>
                    <span style={{ fontSize:20, flexShrink:0, filter:active?"drop-shadow(0 0 4px rgba(196,181,253,0.6))":"none" }}>{item.icon}</span>
                    {!sidebarCollapsed && (
                      <span className="ro-sidebar-label" style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", fontSize:15, letterSpacing:"-0.01em" }}>
                        {item.label}
                      </span>
                    )}
                    {active && !sidebarCollapsed && (
                      <div style={{ marginLeft:"auto", width:8, height:8, borderRadius:"50%", background:"#fff", flexShrink:0, boxShadow:"0 0 8px rgba(255,255,255,0.7)" }}/>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User foot */}
        <div style={{ padding:"14px 12px", borderTop:"1px solid rgba(139,92,246,0.25)" }}>
          {!sidebarCollapsed ? (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, padding:"9px 10px", borderRadius:12, background:"linear-gradient(135deg, rgba(139,92,246,0.20) 0%, rgba(99,102,241,0.10) 100%)", border:"1px solid rgba(167,139,250,0.15)" }}>
                <div style={{ width:38, height:38, borderRadius:"50%", background:G.purple, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:"#fff", fontWeight:900, flexShrink:0, boxShadow:"0 4px 14px rgba(139,92,246,0.45)" }}>{user?.name?.[0]||"A"}</div>
                <div style={{ overflow:"hidden" }}>
                  <div style={{ color:"#fff", fontSize:14, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user?.name||"Admin"}</div>
                  <div style={{ color:"#C4B5FD", fontSize:11, fontWeight:700, letterSpacing:"0.05em" }}>{user?.role?.toUpperCase()}</div>
                </div>
              </div>
              <button onClick={logout} style={{ width:"100%", background:"rgba(239,68,68,0.15)", color:"#FCA5A5", border:"1px solid rgba(239,68,68,0.25)", borderRadius:10, padding:"9px", cursor:"pointer", fontSize:13, fontWeight:800, transition:"all 0.15s", letterSpacing:"0.02em" }}
                onMouseEnter={e=>{ e.currentTarget.style.background="rgba(239,68,68,0.28)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.background="rgba(239,68,68,0.15)"; }}>
                ↪ Sign Out
              </button>
            </div>
          ) : (
            <div style={{ display:"flex", justifyContent:"center" }}>
              <button onClick={logout} title="Sign Out" style={{ background:"rgba(239,68,68,0.12)", color:"#FCA5A5", border:"none", borderRadius:8, width:36, height:36, cursor:"pointer", fontSize:16 }}>↪</button>
            </div>
          )}
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", minWidth:0 }}>
        {/* Topbar */}
        <header style={{
          background:"linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(252,250,255,0.92) 100%)", backdropFilter:"blur(14px)",
          borderBottom:`1px solid ${C.border}`, padding:"0 28px",
          display:"flex", justifyContent:"space-between", alignItems:"center",
          height:78, position:"sticky", top:0, zIndex:100,
          boxShadow:"0 2px 24px rgba(124,58,237,0.08)"
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <button onClick={()=>setSidebarCollapsed(v=>!v)} style={{
              background:C.bg, border:`1px solid ${C.border}`, borderRadius:10,
              width:40, height:40, cursor:"pointer", color:C.muted,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
              transition:"all 0.15s"
            }}
              onMouseEnter={e=>{ e.currentTarget.style.background=C.accent; e.currentTarget.style.color="#fff"; e.currentTarget.style.borderColor=C.accent; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=C.bg; e.currentTarget.style.color=C.muted; e.currentTarget.style.borderColor=C.border; }}>
              ☰
            </button>
            <div>
              <h1 style={{ margin:0, fontSize:24, fontWeight:900, color:C.text, letterSpacing:"-0.025em", lineHeight:1.15, backgroundImage:"linear-gradient(135deg, #7C3AED 0%, #4F46E5 60%, #EC4899 100%)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>{currentLabel}</h1>
              <div style={{ fontSize:13, color:C.mutedLight, fontWeight:600, marginTop:3, letterSpacing:"0.01em" }}>
                {new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
              </div>
            </div>
          </div>

          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {/* Notification bell */}
            <div style={{ position:"relative" }}>
              <button onClick={()=>setShowNotifs(v=>!v)} style={{
                background:C.bg, border:`1px solid ${C.border}`, borderRadius:10,
                width:38, height:38, cursor:"pointer", position:"relative",
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:16,
                transition:"all 0.15s"
              }}>
                🔔
                {pendingNotifs>0 && (
                  <span className="glow-badge" style={{
                    position:"absolute", top:6, right:6, width:9, height:9,
                    background:C.red, borderRadius:"50%", border:"2px solid white"
                  }}/>
                )}
              </button>
              {showNotifs && (
                <div style={{
                  position:"absolute", right:0, top:"110%",
                  background:"rgba(255,255,255,0.98)", backdropFilter:"blur(16px)",
                  border:`1px solid ${C.border}`, borderRadius:16, width:340,
                  boxShadow:"0 16px 48px rgba(30,27,75,0.2)", zIndex:200,
                  maxHeight:380, overflow:"auto", animation:"fadeInUp 0.2s ease"
                }}>
                  <div style={{ padding:"12px 16px", fontWeight:800, fontSize:13, borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", color:C.text }}>
                    Notifications <Badge color="purple">{notifs.length}</Badge>
                  </div>
                  {notifs.length===0 && <div style={{ padding:24, textAlign:"center", color:C.mutedLight, fontSize:13 }}>All caught up! 🎉</div>}
                  {notifs.slice(0,10).map(n=>(
                    <div key={n.id} style={{ padding:"10px 16px", borderBottom:`1px solid ${C.bg}`, fontSize:12 }}>
                      <div style={{ fontWeight:700, color:C.text }}>{n.title}</div>
                      <div style={{ color:C.mutedLight, marginTop:2 }}>{n.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* User pill */}
            <div style={{
              background:G.purple, color:"#fff", borderRadius:10,
              padding:"6px 14px", fontSize:12, fontWeight:700,
              display:"flex", alignItems:"center", gap:8,
              boxShadow:"0 2px 12px rgba(124,58,237,0.35)"
            }}>
              <div style={{ width:22, height:22, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:900 }}>{user?.name?.[0]||"A"}</div>
              {user?.name||"Admin"}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="ro-page" key={page} style={{ padding:24, flex:1 }}>
          {page==="dashboard"     && <Dashboard auth={auth} setPage={setPage} user={user} />}
          {page==="staff"         && <StaffModule auth={auth} user={user} />}
          {page==="attendance"    && <AttendanceRoster auth={auth} />}
          {page==="patients"      && <PatientModule auth={auth} user={user} />}
          {page==="leads"         && <LeadsModule auth={auth} />}
          {page==="bookings"      && <BookingsModule auth={auth} user={user} />}
          {page==="billing"       && <BillingModule auth={auth} />}
          {page==="services_catalog"&& <ServicesCatalogModule auth={auth} user={user} />}
          {page==="wallet"        && <WalletModule auth={auth} user={user} setPage={setPage} />}
          {page==="refunds"       && <RefundsModule auth={auth} />}
          {page==="payroll"       && <PayrollModule auth={auth} />}
          {page==="medical_charts"&& <MedicalChartsModule auth={auth} />}
          {page==="consent"       && <ConsentModule auth={auth} />}
          {page==="feedback"      && <FeedbackModule auth={auth} />}
          {page==="ambulance"     && <AmbulanceModule auth={auth} />}
          {page==="assets"        && <AssetsModule auth={auth} />}
          {page==="vendors"       && <VendorsModule auth={auth} />}
          {page==="training"      && <TrainingMCQModule auth={auth} />}
          {page==="incidents"     && <IncidentsModule auth={auth} />}
          {page==="alerts"        && <AlertsModule auth={auth} />}
          {page==="analytics"     && <AnalyticsModule auth={auth} />}
          {page==="reports"       && <ReportsModule auth={auth} />}
          {page==="geofencing"    && <GeofencingModule auth={auth} />}
          {page==="automation"    && <AutomationModule auth={auth} />}
          {page==="notifications_engine" && <NotificationEngineModule auth={auth} />}
          {page==="patient_app"   && <PatientAppModule auth={auth} />}
          {page==="staff_app"     && <StaffAppModule auth={auth} />}
          {page==="users"          && <UserMgmtModule auth={auth} user={user} />}
          {page==="audit_logs"     && <AuditLogsModule auth={auth} />}
          {page==="inventory"      && <InventoryLendingModule auth={auth} user={user} />}
          {page==="notif_templates"&& <NotifTemplatesModule auth={auth} />}
          {page==="analytics_plus" && <AdvancedAnalyticsModule auth={auth} />}
          {page==="auto_allocate"  && <AutoAllocateModule auth={auth} />}
          {page==="adv_payslip"    && <AdvancedPayslipModule auth={auth} />}
          {page==="incidents_v2"   && <IncidentWorkflowModule auth={auth} user={user} />}
        </div>
      </main>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginPage({ setToken, setUser }) {
  const [u, setU] = useState("admin");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { injectStyles(); setTimeout(()=>setMounted(true),50); }, []);

  async function submit() {
    setLoading(true); setErr("");
    try {
      const r = await apiFetch("/login",{ method:"POST", body:JSON.stringify({ username:u, password:p }) });
      const d = await r.json();
      if (d.success) { localStorage.setItem("ro_token",d.token); setToken(d.token); setUser(d); }
      else setErr(d.message||"Invalid credentials");
    } catch { setErr("Cannot connect to server. Is the backend running on port 5000?"); }
    setLoading(false);
  }

  return (
    <div className="gradient-bg" style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'Inter',-apple-system,sans-serif", padding:16, position:"relative", overflow:"hidden"
    }}>
      {/* Decorative blobs */}
      <div style={{ position:"fixed", top:"10%", right:"10%", width:400, height:400, background:"rgba(124,58,237,0.15)", borderRadius:"50%", filter:"blur(80px)", pointerEvents:"none" }}/>
      <div style={{ position:"fixed", bottom:"10%", left:"5%", width:350, height:350, background:"rgba(6,182,212,0.1)", borderRadius:"50%", filter:"blur(80px)", pointerEvents:"none" }}/>

      <div style={{
        background:"rgba(255,255,255,0.97)", borderRadius:24, padding:"40px 44px",
        width:"100%", maxWidth:420,
        boxShadow:"0 32px 100px rgba(30,27,75,0.3), 0 0 0 1px rgba(196,181,253,0.3)",
        transform:mounted?"translateY(0) scale(1)":"translateY(30px) scale(0.95)",
        opacity:mounted?1:0,
        transition:"transform 0.5s cubic-bezier(.34,1.56,.64,1), opacity 0.4s ease"
      }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ position:"relative", display:"inline-block", marginBottom:16 }}>
            <img src="/logo.png" alt="logo" style={{ width:130, height:130, borderRadius:"50%", objectFit:"cover", border:"4px solid #EDE9FE", boxShadow:"0 12px 36px rgba(124,58,237,0.28)" }}
              onError={e=>{ if(!e.target.dataset.tried){e.target.dataset.tried="1";e.target.src="/logo.svg";} else {e.target.style.display="none"; e.target.nextSibling.style.display="flex";} }}/>
            <div style={{ width:130, height:130, borderRadius:"50%", background:G.purple, display:"none", alignItems:"center", justifyContent:"center", fontSize:54 }}>🏥</div>
            <div className="glow-badge" style={{ position:"absolute", bottom:4, right:4, width:28, height:28, background:C.green, borderRadius:"50%", border:"3px solid white", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"#fff", fontWeight:900 }}>✓</div>
          </div>
          <h1 style={{ margin:"6px 0 4px", fontSize:30, fontWeight:900, color:C.text, letterSpacing:"-0.03em" }}>Reach Out</h1>
          <p style={{ margin:0, color:C.mutedLight, fontSize:14, fontWeight:600 }}>Care At Your Doorstep</p>
          <p style={{ margin:"3px 0 0", color:"#C4B5FD", fontSize:12, fontWeight:500 }}>An initiative of Sir Ganga Ram Hospital</p>
        </div>

        {err && (
          <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:12, padding:"10px 14px", fontSize:13, color:C.red, marginBottom:16, display:"flex", gap:8, animation:"slideInLeft 0.3s ease" }}>
            <span>⚠️</span>{err}
          </div>
        )}

        <Field label="Username">
          <input className="ro-input" style={inp} value={u} onChange={e=>setU(e.target.value)} placeholder="Enter username" autoComplete="username" />
        </Field>
        <Field label="Password">
          <input className="ro-input" style={inp} type="password" value={p} onChange={e=>setP(e.target.value)} placeholder="••••••••" autoComplete="current-password" onKeyDown={e=>e.key==="Enter"&&submit()} />
        </Field>

        <button
          className="ro-btn"
          onClick={submit}
          disabled={loading}
          style={{
            width:"100%", padding:"12px",
            background:loading?"#C4B5FD":G.purple,
            backgroundSize:"200% 200%",
            color:"#fff", border:"none", borderRadius:12,
            fontSize:15, fontWeight:800, cursor:loading?"wait":"pointer",
            marginTop:8, letterSpacing:"-0.01em",
            boxShadow:loading?"none":"0 4px 20px rgba(124,58,237,0.4)",
            transition:"all 0.2s", opacity:loading?0.8:1,
            position:"relative", overflow:"hidden"
          }}>
          {loading ? (
            <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              <span style={{ width:14, height:14, border:"2px solid rgba(255,255,255,0.4)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.7s linear infinite", display:"inline-block" }}/>
              Signing in…
            </span>
          ) : "Sign In →"}
        </button>
        <p style={{ textAlign:"center", fontSize:11, color:"#C4B5FD", marginTop:16, marginBottom:0 }}>
          Default: <strong style={{ color:C.mutedLight }}>admin</strong> / <strong style={{ color:C.mutedLight }}>Admin@1234</strong>
        </p>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ auth, setPage, user }) {
  const [stats, setStats] = useState({});
  const [revenue, setRevenue] = useState([]);
  const [compliance, setCompliance] = useState([]);
  const [docExpiry, setDocExpiry] = useState([]);
  const [pendingLeads, setPendingLeads] = useState([]);
  const [serviceDemand, setServiceDemand] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    Promise.all([
      auth("/dashboard-stats").then(r=>r.json()).then(d=>setStats(d)),
      auth("/analytics/monthly-revenue").then(r=>r.json()).then(d=>Array.isArray(d)&&setRevenue(d.slice(0,7).reverse())),
      auth("/staff-compliance").then(r=>r.json()).then(d=>Array.isArray(d)&&setCompliance(d)),
      auth("/alerts/document-expiry").then(r=>r.json()).then(d=>Array.isArray(d)&&setDocExpiry(d)),
      auth("/leads?status=New").then(r=>r.json()).then(d=>Array.isArray(d)&&setPendingLeads(d)),
      auth("/analytics/service-demand").then(r=>r.json()).then(d=>Array.isArray(d)&&setServiceDemand(d.slice(0,5))),
    ]).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  const lowCompliance = compliance.filter(s=>s.compliance_pct<60);
  const criticalAlerts = compliance.filter(s=>s.alerts?.some(a=>a.type==="CRITICAL"));

  const totalRevenue = revenue.reduce((a,r)=>a+(r.revenue||0),0);
  const totalBilled  = revenue.reduce((a,r)=>a+(r.billed||0),0);
  const collRate     = totalBilled>0 ? ((totalRevenue/totalBilled)*100).toFixed(0) : 0;

  if (loading) return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))", gap:14, marginBottom:20 }}>
        {[...Array(8)].map((_,i)=><Skeleton key={i} height={110} radius={18} />)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:16 }}>
        <Skeleton height={280} radius={16} />
        <Skeleton height={280} radius={16} />
      </div>
    </div>
  );

  return (
    <div>
      {/* Smart Alert Banners */}
      {criticalAlerts.length>0 && (
        <AlertBanner type="danger" icon="🚨"
          title={`${criticalAlerts.length} staff have CRITICAL compliance issues`}
          sub="— police verification or expired documents"
          action="Fix Now" onAction={()=>setPage("staff")} />
      )}
      {docExpiry.length>0 && (
        <AlertBanner type="warning" icon="📄"
          title={`${docExpiry.length} staff document(s) expiring within 30 days`}
          action="View Alerts" onAction={()=>setPage("alerts")} />
      )}
      {pendingLeads.length>0 && (
        <AlertBanner type="info" icon="📋"
          title={`${pendingLeads.length} new lead(s) need follow-up`}
          action="View Leads" onAction={()=>setPage("leads")} />
      )}

      {/* Bento KPI Grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:14, marginBottom:22 }}>
        <StatCard icon="👥" label="Active Staff"      value={stats.totalStaff}      sub={`${stats.staffOnDuty||0} on duty · ${stats.staffAvailable||0} free`} gradient={G.purple} onClick={()=>setPage("staff")} delay={0} />
        <StatCard icon="🏥" label="Active Patients"   value={stats.totalPatients}   sub={`${stats.pendingConsents||0} need consent`} gradient={G.teal} onClick={()=>setPage("patients")} delay={50} />
        <StatCard icon="📅" label="Active Bookings"   value={stats.activeBookings}  sub={`${stats.pendingBookings||0} pending`} gradient={G.indigo} onClick={()=>setPage("bookings")} delay={100} />
        <StatCard icon="💰" label="Revenue"           value={`₹${((stats.totalRevenue||0)/1000).toFixed(0)}k`} sub={`${collRate}% collection rate`} gradient={G.green} onClick={()=>setPage("billing")} delay={150} />
        <StatCard icon="📋" label="Open Leads"        value={stats.totalLeads}      sub={`${stats.newLeads||0} new today`} gradient={G.amber} onClick={()=>setPage("leads")} delay={200} />
        <StatCard icon="↩️" label="Pending Refunds"   value={stats.pendingRefunds}  gradient={G.red} onClick={()=>setPage("refunds")} delay={250} />
        <StatCard icon="💼" label="Wallet Balance"    value={`₹${((stats.totalWalletBalance||0)/1000).toFixed(1)}k`} sub={`${stats.patientsWithWallet||0} patients · ${stats.pendingWalletRefunds||0} refund requests`} gradient={G.teal} onClick={()=>setPage("wallet")} delay={275} />
        <StatCard icon="🚑" label="Ambulance"         value={stats.ambulanceCalls}  gradient={G.orange} onClick={()=>setPage("ambulance")} delay={300} />
        <StatCard icon="🕐" label="Today Attendance"  value={stats.todayAttendance} sub={`Low compliance: ${stats.lowCompliance||0}`} gradient={G.blue} onClick={()=>setPage("attendance")} delay={350} />
      </div>

      {/* Bento Layout Row 1 */}
      <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:16, marginBottom:16 }}>
        {/* Revenue Hero */}
        <Card>
          <div style={{ padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontWeight:800, fontSize:16, color:C.text, letterSpacing:"-0.01em" }}>Revenue Overview</div>
              <div style={{ fontSize:12, color:C.mutedLight, marginTop:2 }}>Billed vs Collected</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:22, fontWeight:900, color:C.text }}>₹{(totalRevenue/1000).toFixed(1)}k</div>
              <Badge color={collRate>=80?"green":"amber"}>{collRate}% collected</Badge>
            </div>
          </div>
          <div style={{ padding:"0 8px 16px" }}>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenue}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#7C3AED" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#7C3AED" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gBil" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#06B6D4" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#06B6D4" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EDE9FE" vertical={false}/>
                <XAxis dataKey="month" tick={{ fontSize:10, fill:"#A78BFA" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fontSize:10, fill:"#A78BFA" }} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
                <Tooltip formatter={v=>[`₹${v.toLocaleString("en-IN")}`,""]} contentStyle={{ borderRadius:12, border:"1px solid #EDE9FE", fontFamily:"Inter" }}/>
                <Area type="monotone" dataKey="billed"  stroke="#06B6D4" strokeWidth={1.5} fill="url(#gBil)" name="Billed" strokeDasharray="5 3"/>
                <Area type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={2.5} fill="url(#gRev)" name="Collected"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Top Services + Quick Actions */}
        <Card>
          <div style={{ padding:"16px 18px 8px", fontWeight:800, fontSize:14, color:C.text }}>⚡ Quick Actions</div>
          <div style={{ padding:"0 14px 14px", display:"flex", flexDirection:"column", gap:7 }}>
            {[
              ["📋","New Lead","leads",G.amber],
              ["👤","Add Patient","patients",G.teal],
              ["📅","New Booking","bookings",G.indigo],
              ["🚑","Log Ambulance","ambulance",G.red],
              ["✍️","Record Consent","consent",G.purple],
              ["⭐","Record Feedback","feedback",G.blue],
            ].map(([icon,label,pg,grad])=>(
              <button key={pg} onClick={()=>setPage(pg)} style={{
                background:"#F5F3FF", border:`1px solid ${C.border}`, borderRadius:10,
                padding:"9px 14px", cursor:"pointer", display:"flex", alignItems:"center",
                gap:10, fontSize:13, textAlign:"left", color:C.text, fontWeight:600,
                transition:"all 0.15s"
              }}
                onMouseEnter={e=>{ e.currentTarget.style.background=G.purple; e.currentTarget.style.color="#fff"; e.currentTarget.style.border="1px solid transparent"; e.currentTarget.style.transform="translateX(4px)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.background="#F5F3FF"; e.currentTarget.style.color=C.text; e.currentTarget.style.border=`1px solid ${C.border}`; e.currentTarget.style.transform="none"; }}>
                <span style={{ fontSize:16 }}>{icon}</span>{label}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Bento Row 2 — Compliance + Service Demand */}
      <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:16 }}>
        {/* Compliance table */}
        <Card>
          <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontWeight:800, fontSize:14, color:C.text }}>🗂️ Staff Compliance</div>
              <div style={{ fontSize:11, color:C.mutedLight }}>
                {compliance.filter(s=>s.compliance_pct>=80).length}/{compliance.length} fully compliant
              </div>
            </div>
            <Btn small outline onClick={()=>setPage("staff")}>View All →</Btn>
          </div>
          {compliance.length===0 ? (
            <div style={{ padding:"24px 18px" }}>
              {[...Array(4)].map((_,i)=><Skeleton key={i} height={44} radius={10} style={{ marginBottom:8 }}/>)}
            </div>
          ) : (
            <div>
              {compliance.slice(0,6).map((s,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 18px", borderBottom:`1px solid ${C.bg}`, transition:"background 0.1s" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#F5F3FF"}
                  onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <div style={{ width:34, height:34, borderRadius:10, background:G.purple, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"#fff", fontWeight:900, flexShrink:0 }}>{s.name[0]}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</div>
                    <div style={{ fontSize:11, color:C.mutedLight }}>{s.role} · {s.vendor||"—"}</div>
                  </div>
                  <div style={{ minWidth:110 }}>
                    <ProgressBar value={s.compliance_pct||0} />
                    {s.alerts?.find(a=>a.type==="CRITICAL") && (
                      <div style={{ fontSize:10, color:C.red, fontWeight:700, marginTop:2 }}>⚠️ Critical</div>
                    )}
                  </div>
                  <Badge color={s.status==="Compliant"?"green":s.status==="Non-Compliant"?"red":"amber"}>
                    {s.compliance_pct||0}%
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Service demand */}
        <Card>
          <div style={{ padding:"14px 18px 8px", fontWeight:800, fontSize:14, color:C.text }}>📊 Top Services</div>
          <div style={{ padding:"0 14px 14px" }}>
            {serviceDemand.length===0
              ? [...Array(5)].map((_,i)=><Skeleton key={i} height={32} radius={8} style={{ marginBottom:8 }}/>)
              : serviceDemand.map((s,i)=>(
                <div key={i} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
                    <span style={{ fontWeight:600, color:C.text }}>{s.service_name}</span>
                    <span style={{ color:C.mutedLight, fontWeight:700 }}>{s.count}</span>
                  </div>
                  <div style={{ height:6, background:"#EDE9FE", borderRadius:3 }}>
                    <div style={{
                      width:`${Math.min(100,(s.count/((serviceDemand[0]?.count)||1))*100)}%`,
                      height:"100%", borderRadius:3,
                      background:`linear-gradient(90deg, #7C3AED, #06B6D4)`,
                      transition:"width 0.8s cubic-bezier(.34,1.56,.64,1)"
                    }}/>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
}


// ─── STAFF MODULE ─────────────────────────────────────────────────────────────
function StaffModule({ auth, user }) {
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterDuty, setFilterDuty] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [vendors, setVendors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);
  const [complianceData, setComplianceData] = useState(null);
  const [form, setForm] = useState({});
  const [docForm, setDocForm] = useState({ documentType:"", expiry_date:"" });
  const [ratingForm, setRatingForm] = useState({ source:"Admin", score:4, comment:"" });
  const [docFile, setDocFile] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [docs, setDocs] = useState([]);
  const [saving, setSaving] = useState(false);

  function load() {
    const q = new URLSearchParams({ ...(search&&{search}), ...(filterRole&&{role:filterRole}), ...(filterDuty&&{duty_tag:filterDuty}), ...(filterVendor&&{vendor:filterVendor}) });
    auth(`/staff?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setStaff(d)).catch(()=>{});
    auth("/vendors").then(r=>r.json()).then(d=>Array.isArray(d)&&setVendors(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[search,filterRole,filterDuty,filterVendor]);

  function openAdd() { setForm({}); setPhotoFile(null); setShowForm(true); setSelected(null); }
  function openEdit(s) { setForm({...s}); setPhotoFile(null); setShowForm(true); setSelected(s); }
  function openDocs(s) {
    setSelected(s); setShowDocs(true);
    auth(`/staff/${s.id}/documents`).then(r=>r.json()).then(d=>Array.isArray(d)&&setDocs(d)).catch(()=>{});
  }
  function openRating(s) {
    setSelected(s); setShowRating(true);
    auth(`/staff/${s.id}/ratings`).then(r=>r.json()).then(d=>Array.isArray(d)&&setRatings(d)).catch(()=>{});
  }
  function openCompliance(s) {
    setSelected(s); setShowCompliance(true); setComplianceData(null);
    auth(`/staff-compliance/${s.id}`).then(r=>r.json()).then(d=>setComplianceData(d)).catch(()=>{});
  }

  async function saveStaff() {
    if (saving) return;
    setSaving(true);
    try {
      const method = selected ? "PUT" : "POST";
      const path = selected ? `/staff/${selected.id}` : "/staff";
      const payload = { ...form };
      delete payload.photo; // photo is uploaded separately
      const res = await auth(path, { method, body: JSON.stringify(payload) });
      let d = {};
      try { d = await res.json(); } catch (_) { d = {}; }
      if (!res.ok) {
        const msg = d.message || d.detail || (Array.isArray(d.detail) ? d.detail.map(x=>x.msg).join(", ") : "Save failed");
        alert(typeof msg === "string" ? msg : "Save failed");
        return;
      }
      // Optional photo upload (separate endpoint)
      const sid = selected ? selected.id : d.id;
      if (photoFile && sid) {
        try {
          const token = localStorage.getItem("ro_token");
          const fd = new FormData();
          fd.append("photo", photoFile);
          await fetch(`${API}/staff/${sid}/photo`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` } });
        } catch (e) { console.warn("Photo upload failed", e); }
      }
      alert(d.message || "Saved");
      setShowForm(false);
      load();
    } catch (e) {
      console.error("saveStaff error", e);
      alert("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadDoc() {
    if(!docFile) return alert("Select a file");
    const fd = new FormData();
    fd.append("document",docFile); fd.append("documentType",docForm.documentType); fd.append("expiry_date",docForm.expiry_date||"");
    const token = localStorage.getItem("ro_token");
    const r = await fetch(`${API}/staff/${selected.id}/documents`,{ method:"POST", body:fd, headers:{ Authorization:`Bearer ${token}` }});
    const d = await r.json();
    alert(d.message);
    auth(`/staff/${selected.id}/documents`).then(r=>r.json()).then(d=>Array.isArray(d)&&setDocs(d));
    if(showCompliance) auth(`/staff-compliance/${selected.id}`).then(r=>r.json()).then(d=>setComplianceData(d));
  }

  async function submitRating() {
    const r = await auth(`/staff/${selected.id}/ratings`,{ method:"POST", body:JSON.stringify(ratingForm) });
    const d = await r.json();
    alert(d.message);
    auth(`/staff/${selected.id}/ratings`).then(r=>r.json()).then(d=>Array.isArray(d)&&setRatings(d));
    load();
  }

  async function updateDutyTag(id,tag) {
    await auth(`/staff/${id}/duty-tag`,{ method:"PATCH", body:JSON.stringify({ duty_tag:tag }) });
    load();
  }

  const roles = ["Nurse","GDA","Physiotherapist","Doctor","Accountant","FOE","Aaya","Helper","Driver","Housekeeping","Patient Care Coordinator","Admin Executive"];
  const dutyTags = ["On Duty","Off Duty","Available","On Break","On Leave","Standby","Suspended","Terminated"];
  const docTypes = ["Aadhaar Card","PAN Card","Nursing Council Reg","Police Verification","Driving License","Medical Fitness","GDA Certificate","Bank Passbook","Resume","Marksheet","Degree","Experience Letter","Other"];

  return (
    <div>
      <FilterBar>
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or code…" />
        <select style={{...inp,minWidth:150}} value={filterRole} onChange={e=>setFilterRole(e.target.value)}>
          <option value="">All Roles</option>
          {roles.map(r=><option key={r}>{r}</option>)}
        </select>
        <select style={{...inp,minWidth:150}} value={filterDuty} onChange={e=>setFilterDuty(e.target.value)}>
          <option value="">All Status</option>
          {dutyTags.map(t=><option key={t}>{t}</option>)}
        </select>
        <select style={{...inp,minWidth:160}} value={filterVendor} onChange={e=>setFilterVendor(e.target.value)}>
          <option value="">All Vendors</option>
          {vendors.map(v=><option key={v.id}>{v.name}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}><Btn onClick={openAdd}>+ Add Staff</Btn></div>
      </FilterBar>

      <Card>
        <Table cols={[
          { label:"Staff", render:s=>(
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {s.photo
                ? <img src={`${API}/${s.photo}`} alt="" style={{ width:36,height:36,borderRadius:10,objectFit:"cover",border:`2px solid ${C.border}` }}/>
                : <div style={{ width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${C.primary},${C.accent})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:14 }}>{s.name[0]}</div>}
              <div><div style={{ fontWeight:600,fontSize:13 }}>{s.name}</div><div style={{ color:C.muted,fontSize:11 }}>{s.code} · {s.vendor||"—"}</div></div>
            </div>
          )},
          { label:"Role", render:s=><Badge color="indigo">{s.role}</Badge> },
          { label:"Duty", render:s=><Badge color={dutyTagColor(s.duty_tag)}>{s.duty_tag||"Available"}</Badge> },
          { label:"Rating", render:s=><span style={{ color:"#f59e0b",fontWeight:700 }}>{"★".repeat(Math.round(s.rating||0))}<span style={{ color:C.muted,fontWeight:400 }}> {(s.rating||0).toFixed(1)}</span></span> },
          { label:"Docs", render:s=><Badge color={s.doc_count>=5?"green":s.doc_count>=3?"amber":"red"}>{s.doc_count||0} uploaded</Badge> },
          { label:"Mobile", render:s=><span style={{ fontSize:12 }}>{s.mobile||"—"}</span> },
          { label:"Status", render:s=>(
            <select style={{...inp,padding:"4px 8px",fontSize:11,minWidth:110}} value={s.duty_tag||"Available"}
              onChange={e=>updateDutyTag(s.id,e.target.value)} onClick={e=>e.stopPropagation()}>
              {dutyTags.map(t=><option key={t}>{t}</option>)}
            </select>
          )},
          { label:"Actions", render:s=>(
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
              <Btn small color={C.primary} onClick={e=>{ e.stopPropagation(); openEdit(s); }}>Edit</Btn>
              <Btn small color={C.accent} onClick={e=>{ e.stopPropagation(); openDocs(s); }}>Docs</Btn>
              <Btn small color={C.purple} onClick={e=>{ e.stopPropagation(); openRating(s); }}>Rate</Btn>
              <Btn small color={s.doc_count>=5?C.green:s.doc_count>=3?C.amber:C.red} onClick={e=>{ e.stopPropagation(); openCompliance(s); }}>🗂️</Btn>
            </div>
          )},
        ]} rows={staff} />
      </Card>

      {/* Add/Edit Modal */}
      <Modal open={showForm} title={selected?"Edit Staff":"Add New Staff"} onClose={()=>setShowForm(false)} wide>
        <Grid cols={3}>
          <Input label="Full Name" required value={form.name||""} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          <Select label="Role" required value={form.role||""} onChange={e=>setForm(f=>({...f,role:e.target.value}))} options={roles} />
          <Select label="Category" value={form.category||""} onChange={e=>setForm(f=>({...f,category:e.target.value}))} options={["Nursing","GDA","Allied Health","Office","Driver","Other"]} />
          <Select label="Vendor" value={form.vendor||""} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} options={vendors.map(v=>v.name)} />
          <Input label="Mobile" value={form.mobile||""} onChange={e=>setForm(f=>({...f,mobile:e.target.value}))} />
          <Input label="Date of Birth" type="date" value={form.dob||""} onChange={e=>setForm(f=>({...f,dob:e.target.value}))} />
          <Select label="Blood Group" value={form.blood_group||""} onChange={e=>setForm(f=>({...f,blood_group:e.target.value}))} options={["A+","A-","B+","B-","O+","O-","AB+","AB-"]} />
          <Select label="Employment Type" value={form.employment_type||""} onChange={e=>setForm(f=>({...f,employment_type:e.target.value}))} options={["Permanent","Contractual","Freelance"]} />
          <Input label="Monthly Salary (₹)" value={form.salary||""} onChange={e=>setForm(f=>({...f,salary:e.target.value}))} />
          <Input label="Joining Date" type="date" value={form.joining_date||""} onChange={e=>setForm(f=>({...f,joining_date:e.target.value}))} />
          <Input label="Qualification" value={form.qualification||""} onChange={e=>setForm(f=>({...f,qualification:e.target.value}))} />
          <Input label="Experience" value={form.experience||""} onChange={e=>setForm(f=>({...f,experience:e.target.value}))} />
        </Grid>
        <Textarea label="Address" value={form.address||""} onChange={e=>setForm(f=>({...f,address:e.target.value}))} rows={2} />
        <Grid cols={3}>
          <Input label="Emergency Contact Name" value={form.emergency_name||""} onChange={e=>setForm(f=>({...f,emergency_name:e.target.value}))} />
          <Input label="Emergency Mobile" value={form.emergency_contact||""} onChange={e=>setForm(f=>({...f,emergency_contact:e.target.value}))} />
          <Input label="Bank Account No." value={form.bank_account||""} onChange={e=>setForm(f=>({...f,bank_account:e.target.value}))} />
          <Input label="IFSC Code" value={form.ifsc||""} onChange={e=>setForm(f=>({...f,ifsc:e.target.value}))} />
          <Select label="Duty Tag" value={form.duty_tag||"Available"} onChange={e=>setForm(f=>({...f,duty_tag:e.target.value}))} options={dutyTags} />
          <Select label="Status" value={form.status||"Active"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} options={["Active","Inactive"]} />
        </Grid>
        <Field label="Profile Photo"><input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files[0])} /></Field>
        {form.photo && <img src={`${API}/${form.photo}`} alt="" style={{ width:60,height:60,borderRadius:"50%",objectFit:"cover",marginBottom:12 }}/>}
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:16 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={saveStaff} disabled={saving}>{saving?"Saving…":"Save Staff"}</Btn>
        </div>
      </Modal>

      {/* Documents Modal */}
      <Modal open={showDocs} title={`Documents — ${selected?.name}`} onClose={()=>setShowDocs(false)}>
        <Grid cols={2}>
          <Select label="Document Type" value={docForm.documentType} onChange={e=>setDocForm(f=>({...f,documentType:e.target.value}))} options={docTypes} />
          <Input label="Expiry Date" type="date" value={docForm.expiry_date} onChange={e=>setDocForm(f=>({...f,expiry_date:e.target.value}))} />
        </Grid>
        <Field label="File"><input type="file" onChange={e=>setDocFile(e.target.files[0])} /></Field>
        <Btn onClick={uploadDoc} style={{ marginBottom:16 }}>Upload Document</Btn>
        <Table cols={[{ label:"Type",key:"document_type"},{ label:"File",key:"document_name"},{ label:"Expiry",key:"expiry_date"},{ label:"Date",key:"upload_date"},{ label:"View",render:d=><a href={`${API}/${d.file_path}`} target="_blank" rel="noreferrer" style={{ color:C.accent,fontWeight:600 }}>↗</a>}]} rows={docs} compact />
      </Modal>

      {/* Compliance Modal */}
      <Modal open={showCompliance} title={`Document Compliance — ${selected?.name}`} onClose={()=>setShowCompliance(false)} wide>
        {!complianceData ? <div style={{ textAlign:"center",padding:32,color:C.muted }}>Loading…</div> : (
          <div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20 }}>
              <StatCard icon="📄" label="Uploaded" value={complianceData.doc_count||0} gradient={G.blue} />
              <StatCard icon="✅" label="Required" value={complianceData.required?.length||0} gradient={G.indigo} />
              <StatCard icon="❌" label="Missing" value={complianceData.missing?.length||0} gradient={complianceData.missing?.length>0?G.red:G.green} />
              <StatCard icon="📊" label="Compliance" value={`${complianceData.compliance_pct||0}%`} gradient={complianceData.compliance_pct>=80?G.green:complianceData.compliance_pct>=50?G.amber:G.red} />
            </div>
            {complianceData.missing?.length>0 && (
              <div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"12px 16px",marginBottom:16 }}>
                <div style={{ fontWeight:700,color:C.red,marginBottom:8,fontSize:13 }}>❌ Missing Required Documents</div>
                <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                  {complianceData.missing.map(d=><Badge key={d} color="red">{d}</Badge>)}
                </div>
              </div>
            )}
            {complianceData.expiring?.length>0 && (
              <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"12px 16px",marginBottom:16 }}>
                <div style={{ fontWeight:700,color:C.amber,marginBottom:8,fontSize:13 }}>⚠️ Expiring Soon</div>
                {complianceData.expiring.map(d=><div key={d.id} style={{ fontSize:12,marginBottom:4 }}>{d.document_type} — expires <strong>{d.expiry_date}</strong></div>)}
              </div>
            )}
            <div style={{ fontWeight:700,marginBottom:10,color:C.text }}>All Documents</div>
            <Table cols={[{label:"Type",key:"document_type"},{label:"File",key:"document_name"},{label:"Uploaded",key:"upload_date"},{label:"Expiry",render:d=>d.expiry_date||"—"},{label:"View",render:d=><a href={`${API}/${d.file_path}`} target="_blank" rel="noreferrer" style={{ color:C.accent,fontWeight:600 }}>View ↗</a>}]} rows={complianceData.docs||[]} compact />
          </div>
        )}
      </Modal>

      {/* Rating Modal */}
      <Modal open={showRating} title={`Rate Staff — ${selected?.name}`} onClose={()=>setShowRating(false)}>
        <Grid cols={2}>
          <Select label="Source" value={ratingForm.source} onChange={e=>setRatingForm(f=>({...f,source:e.target.value}))} options={["Patient","Family","Supervisor","Admin","System"]} />
          <Select label="Score" value={ratingForm.score} onChange={e=>setRatingForm(f=>({...f,score:e.target.value}))} options={["5","4","3","2","1"]} />
        </Grid>
        <Textarea label="Comment" value={ratingForm.comment} onChange={e=>setRatingForm(f=>({...f,comment:e.target.value}))} rows={2} />
        <Btn onClick={submitRating} style={{ marginBottom:20 }}>Submit Rating</Btn>
        <Table cols={[{label:"Source",key:"source"},{label:"Score",render:r=><span style={{ color:C.amber }}>{"★".repeat(r.score)}</span>},{label:"Comment",key:"comment"},{label:"Date",render:r=>r.rated_at?.split("T")[0]}]} rows={ratings} compact />
      </Modal>
    </div>
  );
}

// ─── ATTENDANCE & ROSTER ──────────────────────────────────────────────────────
function AttendanceRoster({ auth }) {
  const [tab, setTab] = useState("roster");
  const [attendance, setAttendance] = useState([]);
  const [roster, setRoster] = useState([]);
  const [rosterSummary, setRosterSummary] = useState([]);
  const [availableStaff, setAvailableStaff] = useState([]);
  const [patients, setPatients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [from, setFrom] = useState(new Date().toISOString().split("T")[0]);
  const [to, setTo] = useState(new Date(Date.now()+6*24*60*60*1000).toISOString().split("T")[0]);
  const [showRosterForm, setShowRosterForm] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const [rForm, setRForm] = useState({ date: new Date().toISOString().split("T")[0], shift:"12-Hour Day" });
  const [availFilter, setAvailFilter] = useState({ date: new Date().toISOString().split("T")[0], role:"", vendor:"" });
  const [filterVendor, setFilterVendor] = useState("");
  const [filterShift, setFilterShift] = useState("");
  const [loadingAvail, setLoadingAvail] = useState(false);

  const shifts = ["Morning (6AM-2PM)","Evening (2PM-10PM)","Night (10PM-6AM)","12-Hour Day","12-Hour Night","24-Hour"];
  const roles = ["Nurse","GDA","Physiotherapist","Doctor","Driver","Aaya","Helper"];

  function load() {
    const q = new URLSearchParams({ from, to, ...(filterVendor&&{vendor:filterVendor}), ...(filterShift&&{shift:filterShift}) });
    auth(`/attendance?from=${from}&to=${to}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setAttendance(d)).catch(()=>{});
    auth(`/roster?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setRoster(d)).catch(()=>{});
    auth(`/roster/summary?from=${from}&to=${to}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setRosterSummary(d)).catch(()=>{});
    auth("/patients").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{});
    auth("/vendors").then(r=>r.json()).then(d=>Array.isArray(d)&&setVendors(d)).catch(()=>{});
  }

  useEffect(()=>{ load(); },[from,to,tab,filterVendor,filterShift]);

  async function loadAvailability() {
    setLoadingAvail(true);
    const q = new URLSearchParams({ date:availFilter.date, ...(availFilter.role&&{role:availFilter.role}), ...(availFilter.vendor&&{vendor:availFilter.vendor}) });
    const d = await auth(`/roster/available-staff?${q}`).then(r=>r.json()).catch(()=>[]);
    setAvailableStaff(Array.isArray(d)?d:[]);
    setLoadingAvail(false);
  }

  useEffect(()=>{ if(showAvailability) loadAvailability(); },[availFilter, showAvailability]);

  async function addRoster() {
    if(!rForm.staff_id||!rForm.date||!rForm.shift) return alert("Staff, date and shift are required");
    const r = await auth("/roster",{ method:"POST", body:JSON.stringify(rForm) });
    const d = await r.json();
    if(!r.ok){ alert("⚠️ "+d.message); return; }
    alert(d.message); setShowRosterForm(false);
    setRForm({ date:new Date().toISOString().split("T")[0], shift:"12-Hour Day" });
    load();
  }

  async function removeRoster(id) {
    if(!window.confirm("Remove this roster entry?")) return;
    const r = await auth(`/roster/${id}`,{ method:"DELETE" });
    const d = await r.json();
    alert(d.message); load();
  }

  function selectStaffForRoster(s) {
    setRForm(f=>({...f, staff_id:s.id, staff_name:s.name, date:availFilter.date }));
    setShowAvailability(false);
    setShowRosterForm(true);
  }

  const totalHours = attendance.reduce((a,x)=>a+(x.hours_worked||0),0).toFixed(1);
  const presentToday = attendance.filter(a=>a.date===new Date().toISOString().split("T")[0]&&a.status==="Present").length;

  // Group roster by date for calendar view
  const rosterByDate = roster.reduce((acc,r)=>{
    if(!acc[r.date]) acc[r.date]=[];
    acc[r.date].push(r);
    return acc;
  },{});

  return (
    <div>
      {/* KPI Row */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="✅" label="Present Today" value={presentToday} gradient={G.green} />
        <StatCard icon="🕐" label="Total Hours" value={`${totalHours}h`} gradient={G.blue} />
        <StatCard icon="📅" label="Roster Entries" value={roster.length} gradient={G.indigo} />
        <StatCard icon="⏳" label="Scheduled" value={roster.filter(r=>r.status==="Scheduled").length} gradient={G.amber} />
        <StatCard icon="✓" label="Completed" value={roster.filter(r=>r.status==="Completed").length} gradient={G.teal} />
      </div>

      {/* Tabs + Filters */}
      <FilterBar>
        <div style={{ display:"flex",gap:4,background:C.bg,padding:4,borderRadius:10 }}>
          {["roster","attendance","calendar"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text,transition:"all 0.15s" }}>{t}</button>
          ))}
        </div>
        <input type="date" style={{...inp,minWidth:140}} value={from} onChange={e=>setFrom(e.target.value)} />
        <span style={{ color:C.muted,fontSize:12 }}>to</span>
        <input type="date" style={{...inp,minWidth:140}} value={to} onChange={e=>setTo(e.target.value)} />
        {tab!=="attendance" && <>
          <select style={{...inp,minWidth:160}} value={filterVendor} onChange={e=>setFilterVendor(e.target.value)}>
            <option value="">All Vendors</option>
            {vendors.map(v=><option key={v.id}>{v.name}</option>)}
          </select>
          <select style={{...inp,minWidth:140}} value={filterShift} onChange={e=>setFilterShift(e.target.value)}>
            <option value="">All Shifts</option>
            {shifts.map(s=><option key={s}>{s}</option>)}
          </select>
        </>}
        <div style={{ marginLeft:"auto",display:"flex",gap:8 }}>
          <Btn outline color={C.purple} onClick={()=>setShowAvailability(true)}>🔍 Find Available Staff</Btn>
          <Btn onClick={()=>{ setShowRosterForm(true); }}>+ Add Roster</Btn>
        </div>
      </FilterBar>

      {/* Roster Table */}
      {tab==="roster" && (
        <Card>
          <Table cols={[
            { label:"Date",render:r=><div style={{ fontWeight:600,fontSize:13 }}>{r.date}</div> },
            { label:"Staff",render:r=>(
              <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                <div style={{ width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${C.primary},${C.accent})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:12 }}>{r.staff_name?.[0]}</div>
                <div><div style={{ fontWeight:600,fontSize:13 }}>{r.staff_name}</div><div style={{ color:C.muted,fontSize:11 }}>{r.role} · {r.vendor}</div></div>
              </div>
            )},
            { label:"Shift",render:r=><Badge color="indigo">{r.shift}</Badge> },
            { label:"Patient",render:r=>r.patient_name?<div><div style={{ fontWeight:500,fontSize:12 }}>{r.patient_name}</div><div style={{ color:C.muted,fontSize:11 }}>{r.reg_number}</div></div>:<span style={{ color:C.muted }}>—</span> },
            { label:"Status",render:r=><Badge color={r.status==="Completed"?"green":r.status==="Cancelled"?"red":r.status==="In Progress"?"blue":"amber"}>{r.status||"Scheduled"}</Badge> },
            { label:"Mobile",render:r=><span style={{ fontSize:12 }}>{r.staff_mobile||"—"}</span> },
            { label:"",render:r=>(
              <div style={{ display:"flex",gap:5 }}>
                <Btn small danger onClick={e=>{ e.stopPropagation(); removeRoster(r.id); }}>Remove</Btn>
              </div>
            )},
          ]} rows={roster} />
        </Card>
      )}

      {/* Attendance Table */}
      {tab==="attendance" && (
        <Card>
          <Table cols={[
            { label:"Staff",render:a=><div><div style={{ fontWeight:600 }}>{a.staff_name}</div><div style={{ color:C.muted,fontSize:11 }}>{a.code} · {a.vendor}</div></div> },
            { label:"Role",key:"role" },
            { label:"Date",key:"date" },
            { label:"Login",render:a=>a.login_time?new Date(a.login_time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—" },
            { label:"Logout",render:a=>a.logout_time?new Date(a.logout_time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—" },
            { label:"Hours",render:a=>a.hours_worked?<Badge color={a.hours_worked>=8?"green":a.hours_worked>=6?"amber":"red"}>{a.hours_worked}h</Badge>:"—" },
            { label:"Status",render:a=><Badge color={statusColor(a.status)}>{a.status}</Badge> },
          ]} rows={attendance} />
        </Card>
      )}

      {/* Calendar View */}
      {tab==="calendar" && (
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12 }}>
          {Object.entries(rosterByDate).sort(([a],[b])=>a.localeCompare(b)).map(([date,entries])=>(
            <Card key={date} style={{ padding:0,overflow:"hidden" }}>
              <div style={{ background:`linear-gradient(135deg,${C.primary},${C.accent})`,padding:"10px 14px",color:"#fff" }}>
                <div style={{ fontWeight:700,fontSize:14 }}>{new Date(date+"T12:00:00").toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})}</div>
                <div style={{ fontSize:11,opacity:0.8 }}>{entries.length} shift{entries.length!==1?"s":""}</div>
              </div>
              <div style={{ padding:10 }}>
                {entries.map((e,i)=>(
                  <div key={i} style={{ display:"flex",gap:8,alignItems:"center",padding:"6px 0",borderBottom:i<entries.length-1?`1px solid ${C.bg}`:"none",fontSize:12 }}>
                    <div style={{ width:26,height:26,borderRadius:6,background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:11,flexShrink:0 }}>{e.staff_name?.[0]}</div>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.staff_name}</div>
                      <div style={{ color:C.muted,fontSize:10 }}>{e.shift?.split(" ")[0]}</div>
                    </div>
                    <Badge color={e.status==="Completed"?"green":e.status==="Cancelled"?"red":"amber"}>{e.status?.split(" ")[0]||"Sched"}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {Object.keys(rosterByDate).length===0 && (
            <div style={{ gridColumn:"1/-1",textAlign:"center",padding:40,color:C.muted }}>
              <div style={{ fontSize:32,marginBottom:8 }}>📅</div>
              No roster entries for this period.
            </div>
          )}
        </div>
      )}

      {/* Add Roster Modal */}
      <Modal open={showRosterForm} title="Add Roster Entry" onClose={()=>setShowRosterForm(false)} wide>
        {rForm.staff_name && (
          <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13 }}>
            ✅ Pre-filled from availability check: <strong>{rForm.staff_name}</strong>
          </div>
        )}
        <Grid cols={2}>
          <Input label="Date" type="date" required value={rForm.date||""} onChange={e=>setRForm(f=>({...f,date:e.target.value}))} />
          <Select label="Shift" required value={rForm.shift||""} onChange={e=>setRForm(f=>({...f,shift:e.target.value}))} options={shifts} />
          <Select label="Assign to Patient" value={rForm.patient_id||""} onChange={e=>setRForm(f=>({...f,patient_id:e.target.value}))} options={patients.map(p=>({value:p.id,label:p.name}))} />
        </Grid>
        <Textarea label="Notes" value={rForm.notes||""} onChange={e=>setRForm(f=>({...f,notes:e.target.value}))} rows={2} />
        <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#92400e" }}>⚠️ Conflict check enabled — duplicate roster entries for same staff/date/shift will be rejected automatically.</div>
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline color={C.purple} onClick={()=>{ setShowRosterForm(false); setShowAvailability(true); }}>🔍 Pick Staff from Availability</Btn>
          <Btn outline onClick={()=>setShowRosterForm(false)}>Cancel</Btn>
          <Btn onClick={addRoster}>Save Roster</Btn>
        </div>
      </Modal>

      {/* Staff Availability Finder */}
      <Modal open={showAvailability} title="🔍 Find Available Staff" onClose={()=>setShowAvailability(false)} wide>
        <div style={{ background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#1e40af" }}>
          Smart availability engine — shows staff not already rostered for the selected date/shift, sorted by rating.
        </div>
        <Grid cols={3}>
          <Input label="Date" type="date" value={availFilter.date} onChange={e=>setAvailFilter(f=>({...f,date:e.target.value}))} />
          <Select label="Filter by Role" value={availFilter.role} onChange={e=>setAvailFilter(f=>({...f,role:e.target.value}))} options={roles} />
          <Select label="Filter by Vendor" value={availFilter.vendor} onChange={e=>setAvailFilter(f=>({...f,vendor:e.target.value}))} options={vendors.map(v=>v.name)} />
        </Grid>
        {loadingAvail ? (
          <div style={{ textAlign:"center",padding:32,color:C.muted }}>Loading available staff…</div>
        ) : (
          <div>
            <div style={{ fontSize:13,color:C.muted,marginBottom:10 }}>{availableStaff.length} staff available for {availFilter.date}</div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,maxHeight:400,overflow:"auto" }}>
              {availableStaff.map(s=>(
                <div key={s.id} style={{ background:C.bg,borderRadius:12,padding:14,border:`1px solid ${C.border}`,cursor:"pointer",transition:"all 0.15s" }}
                  onMouseEnter={e=>{ e.currentTarget.style.background="#e0f2fe"; e.currentTarget.style.borderColor=C.accent; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background=C.bg; e.currentTarget.style.borderColor=C.border; }}
                  onClick={()=>selectStaffForRoster(s)}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8 }}>
                    <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                      <div style={{ width:34,height:34,borderRadius:10,background:`linear-gradient(135deg,${C.primary},${C.accent})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,flexShrink:0 }}>{s.name[0]}</div>
                      <div>
                        <div style={{ fontWeight:700,fontSize:13 }}>{s.name}</div>
                        <div style={{ color:C.muted,fontSize:11 }}>{s.code}</div>
                      </div>
                    </div>
                    <Badge color={s.availability_status==="Free"?"green":s.availability_status==="On Assignment"?"amber":"blue"}>{s.availability_status}</Badge>
                  </div>
                  <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
                    <Badge color="indigo">{s.role}</Badge>
                    <Badge color="gray">{s.vendor||"—"}</Badge>
                    <span style={{ fontSize:11,color:"#f59e0b",fontWeight:600 }}>★ {(s.rating||0).toFixed(1)}</span>
                  </div>
                  {s.active_bookings>0 && <div style={{ fontSize:11,color:C.amber,marginTop:4 }}>⚡ {s.active_bookings} active booking(s)</div>}
                  <div style={{ marginTop:8,fontSize:11,color:C.accent,fontWeight:600,textAlign:"right" }}>+ Add to Roster →</div>
                </div>
              ))}
              {availableStaff.length===0 && <div style={{ gridColumn:"1/-1",textAlign:"center",padding:24,color:C.muted }}>No available staff found for these filters.</div>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── PATIENT MODULE ───────────────────────────────────────────────────────────
function PatientModule({ auth, user }) {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState("");
  const [filterLoc, setFilterLoc] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [docs, setDocs] = useState([]);
  const [docForm, setDocForm] = useState({ documentType:"" });
  const [docFile, setDocFile] = useState(null);
  const [freezeLog, setFreezeLog] = useState([]);
  const [saving, setSaving] = useState(false);

  function load() {
    const q = new URLSearchParams({ ...(search&&{search}), ...(filterLoc&&{service_location:filterLoc}), ...(filterStatus&&{status:filterStatus}) });
    auth(`/patients?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[search,filterLoc,filterStatus]);

  function openAdd() { setForm({ status:"Active",service_location:"Home",category:"External Home" }); setShowForm(true); setSelected(null); }

  function openEdit(p) {
    if(p.frozen && user?.role!=="admin") {
      alert("⛔ This patient is frozen.\n\nOnly an Admin can edit frozen patient records.\nContact your administrator for changes.");
      return;
    }
    setSelected(p); setForm({...p}); setShowForm(true);
  }

  function openProfile(p) {
    setSelected(p); setShowProfile(true);
    auth(`/patients/${p.id}/freeze-log`).then(r=>r.json()).then(d=>Array.isArray(d)&&setFreezeLog(d)).catch(()=>{});
  }

  function openDocs(p) {
    setSelected(p); setShowDocs(true);
    auth(`/patients/${p.id}/documents`).then(r=>r.json()).then(d=>Array.isArray(d)&&setDocs(d)).catch(()=>{});
  }

  async function savePatient() {
    if (saving) return;
    setSaving(true);
    try {
      const method = selected ? "PUT" : "POST";
      const path = selected ? `/patients/${selected.id}` : "/patients";
      const payload = { ...form };
      delete payload.photo;
      const res = await auth(path, { method, body: JSON.stringify(payload) });
      let d = {};
      try { d = await res.json(); } catch (_) { d = {}; }
      if (res.status === 403) { alert("⛔ " + (d.message || d.detail || "Forbidden")); return; }
      if (!res.ok) {
        const msg = d.message || d.detail || (Array.isArray(d.detail) ? d.detail.map(x=>x.msg).join(", ") : "Save failed");
        alert(typeof msg === "string" ? msg : "Save failed");
        return;
      }
      alert(d.message || "Saved");
      setShowForm(false);
      load();
    } catch (e) {
      console.error("savePatient error", e);
      alert("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleFreeze(p) {
    if(user?.role!=="admin"){ alert("⛔ Only Admin can freeze/unfreeze patients."); return; }
    const action = p.frozen?"unfreeze":"freeze";
    const reason = p.frozen
      ? (window.confirm(`Unfreeze "${p.name}"?\nThis will allow editing again.`)?"Admin action":null)
      : window.prompt(`Reason for freezing "${p.name}"?`);
    if(reason===null) return;
    const r = await auth(`/patients/${p.id}/freeze`,{ method:"PATCH", body:JSON.stringify({ frozen:!p.frozen, reason }) });
    const d = await r.json();
    if(r.status===403){ alert("⛔ "+d.message); return; }
    alert(d.message); load();
  }

  async function uploadDoc() {
    if(!docFile) return alert("Select a file");
    const fd = new FormData();
    fd.append("document",docFile); fd.append("documentType",docForm.documentType);
    const token = localStorage.getItem("ro_token");
    const r = await fetch(`${API}/patients/${selected.id}/documents`,{ method:"POST", body:fd, headers:{ Authorization:`Bearer ${token}` }});
    const d = await r.json();
    alert(d.message);
    auth(`/patients/${selected.id}/documents`).then(r=>r.json()).then(d=>Array.isArray(d)&&setDocs(d));
  }

  const docTypes = ["Consent Form","Discharge Summary","Checklist","Prescription","Investigation Reports","Aadhaar Card","Insurance","Doctor Recommendation","Other"];

  return (
    <div>
      <FilterBar>
        <SearchBar value={search} onChange={setSearch} placeholder="Search name, reg no, mobile…" />
        <select style={{...inp,minWidth:160}} value={filterLoc} onChange={e=>setFilterLoc(e.target.value)}>
          <option value="">All Locations</option>
          {["Home","SGRH","Other Hospital"].map(l=><option key={l}>{l}</option>)}
        </select>
        <select style={{...inp,minWidth:120}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          {["Active","Inactive","Closed"].map(s=><option key={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}><Btn onClick={openAdd}>+ Register Patient</Btn></div>
      </FilterBar>

      <Card>
        <Table cols={[
          { label:"Patient",render:p=>(
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <div style={{ width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${C.green},#6ee7b7)`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:14 }}>{p.name[0]}</div>
              <div><div style={{ fontWeight:600,fontSize:13 }}>{p.name}</div><div style={{ color:C.muted,fontSize:11 }}>{p.reg_number} · {p.age}y {p.gender?.[0]}</div></div>
            </div>
          )},
          { label:"Diagnosis",render:p=><div style={{ maxWidth:180,fontSize:12,color:C.textSub }}>{p.diagnosis||"—"}</div> },
          { label:"Mobile",render:p=><span style={{ fontSize:12 }}>{p.mobile||"—"}</span> },
          { label:"Location",render:p=><Badge color="blue">{p.service_location}</Badge> },
          { label:"Status",render:p=><Badge color={statusColor(p.status)}>{p.status}</Badge> },
          { label:"Lock",render:p=>p.frozen?<span style={{ color:C.amber,fontSize:16 }}>🔒</span>:<span style={{ color:C.green,fontSize:16 }}>🔓</span> },
          { label:"Actions",render:p=>(
            <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
              <Btn small color={C.primary} onClick={e=>{ e.stopPropagation(); openProfile(p); }}>View</Btn>
              <Btn small outline onClick={e=>{ e.stopPropagation(); openEdit(p); }}>Edit</Btn>
              <Btn small color={C.green} onClick={e=>{ e.stopPropagation(); openDocs(p); }}>Docs</Btn>
              <Btn small color={C.indigo} onClick={e=>{ e.stopPropagation(); downloadPdf(`/pdf/patient/${p.id}`, `patient-${p.reg_number||p.id}.pdf`); }}>📄 PDF</Btn>
              <Btn small outline color={C.purple} onClick={e=>{ e.stopPropagation(); downloadPdf(`/pdf/invoice/${p.id}`, `invoice-${p.reg_number||p.id}.pdf`); }}>🧾 Invoice</Btn>
              {user?.role==="admin" && <Btn small color={p.frozen?C.amber:C.muted} onClick={e=>{ e.stopPropagation(); toggleFreeze(p); }}>{p.frozen?"🔓":"🔒"}</Btn>}
            </div>
          )},
        ]} rows={patients} />
      </Card>

      {/* Add/Edit Modal */}
      <Modal open={showForm} title={selected?"Edit Patient":"Register New Patient"} onClose={()=>setShowForm(false)} wide>
        {selected?.frozen && user?.role==="admin" && (
          <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e" }}>
            ⚠️ This patient is frozen. You are editing as Admin — all changes will be logged.
          </div>
        )}
        <Grid cols={3}>
          <Input label="Full Name" required value={form.name||""} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          <Input label="Age" value={form.age||""} onChange={e=>setForm(f=>({...f,age:e.target.value}))} />
          <Select label="Gender" value={form.gender||""} onChange={e=>setForm(f=>({...f,gender:e.target.value}))} options={["Male","Female","Other"]} />
          <Input label="Mobile" value={form.mobile||""} onChange={e=>setForm(f=>({...f,mobile:e.target.value}))} />
          <Input label="SGRH Reg No." value={form.sgrh_reg||""} onChange={e=>setForm(f=>({...f,sgrh_reg:e.target.value}))} />
          <Select label="Blood Group" value={form.blood_group||""} onChange={e=>setForm(f=>({...f,blood_group:e.target.value}))} options={["A+","A-","B+","B-","O+","O-","AB+","AB-"]} />
          <Input label="Doctor Name" value={form.doctor_name||""} onChange={e=>setForm(f=>({...f,doctor_name:e.target.value}))} />
          <Input label="Hospital" value={form.hospital||""} onChange={e=>setForm(f=>({...f,hospital:e.target.value}))} />
          <Select label="Service Location" value={form.service_location||"Home"} onChange={e=>setForm(f=>({...f,service_location:e.target.value}))} options={["Home","SGRH","Other Hospital"]} />
          <Select label="Category" value={form.category||""} onChange={e=>setForm(f=>({...f,category:e.target.value}))} options={["Internal Home","External Home","SGRH","Other Hospital"]} />
          <Input label="Admission Date" type="date" value={form.admission_date||""} onChange={e=>setForm(f=>({...f,admission_date:e.target.value}))} />
          <Input label="Discharge Date" type="date" value={form.discharge_date||""} onChange={e=>setForm(f=>({...f,discharge_date:e.target.value}))} />
        </Grid>
        <Textarea label="Address" value={form.address||""} onChange={e=>setForm(f=>({...f,address:e.target.value}))} rows={2} />
        <Grid cols={2}>
          <Input label="Landmark" value={form.landmark||""} onChange={e=>setForm(f=>({...f,landmark:e.target.value}))} />
          <Input label="Allergies" value={form.allergies||""} onChange={e=>setForm(f=>({...f,allergies:e.target.value}))} />
        </Grid>
        <Textarea label="Diagnosis / Condition" value={form.diagnosis||""} onChange={e=>setForm(f=>({...f,diagnosis:e.target.value}))} rows={2} />
        <Textarea label="Current Medications" value={form.current_medications||""} onChange={e=>setForm(f=>({...f,current_medications:e.target.value}))} rows={2} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:16 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={savePatient} disabled={saving}>{saving?"Saving…":"Save Patient"}</Btn>
        </div>
      </Modal>

      {/* Profile Modal */}
      <Modal open={showProfile} title={`Patient — ${selected?.name}`} onClose={()=>setShowProfile(false)} wide>
        {selected && (
          <div>
            <div style={{ display:"grid",gridTemplateColumns:"200px 1fr",gap:20,marginBottom:20 }}>
              <div style={{ background:C.bg,borderRadius:12,padding:20,textAlign:"center" }}>
                <div style={{ width:80,height:80,borderRadius:16,background:`linear-gradient(135deg,${C.green},#6ee7b7)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,margin:"0 auto 12px",color:"#fff",fontWeight:800 }}>{selected.name[0]}</div>
                <div style={{ fontWeight:700,fontSize:17 }}>{selected.name}</div>
                <div style={{ color:C.muted,fontSize:13,marginBottom:10 }}>{selected.age}y · {selected.gender}</div>
                <Badge color={statusColor(selected.status)}>{selected.status}</Badge>
                <div style={{ marginTop:6 }}><Badge color="blue">{selected.service_location}</Badge></div>
                <div style={{ marginTop:6 }}>{selected.frozen?<Badge color="amber">🔒 Frozen</Badge>:<Badge color="green">🔓 Editable</Badge>}</div>
                <div style={{ fontSize:11,color:C.muted,marginTop:8 }}>{selected.reg_number}</div>
              </div>
              <div>
                {[["Mobile",selected.mobile],["SGRH Reg",selected.sgrh_reg],["Doctor",selected.doctor_name],["Hospital",selected.hospital],["Diagnosis",selected.diagnosis],["Blood Group",selected.blood_group],["Allergies",selected.allergies],["Medications",selected.current_medications],["Address",selected.address]].map(([k,v])=>v?(
                  <div key={k} style={{ display:"flex",marginBottom:8,fontSize:13,borderBottom:`1px solid ${C.bg}`,paddingBottom:6 }}>
                    <div style={{ width:130,color:C.muted,flexShrink:0,fontSize:12 }}>{k}</div>
                    <div style={{ fontWeight:500 }}>{v}</div>
                  </div>
                ):null)}
              </div>
            </div>
            {freezeLog.length>0 && (
              <div>
                <div style={{ fontWeight:700,fontSize:13,color:C.primary,marginBottom:8 }}>🔒 Freeze Audit Log</div>
                <div style={{ background:C.bg,borderRadius:10 }}>
                  {freezeLog.map((l,i)=>(
                    <div key={i} style={{ display:"flex",gap:12,padding:"8px 12px",borderBottom:`1px solid ${C.border}`,fontSize:12,alignItems:"center" }}>
                      <Badge color={l.action==="Frozen"?"amber":"green"}>{l.action}</Badge>
                      <span>by <strong>{l.done_by}</strong></span>
                      {l.reason&&<span style={{ color:C.muted }}>— {l.reason}</span>}
                      <span style={{ marginLeft:"auto",color:C.muted }}>{l.created_at?.split("T")[0]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Docs Modal */}
      <Modal open={showDocs} title={`Documents — ${selected?.name}`} onClose={()=>setShowDocs(false)}>
        <Grid cols={2}>
          <Select label="Document Type" value={docForm.documentType} onChange={e=>setDocForm(f=>({...f,documentType:e.target.value}))} options={docTypes} />
          <Field label="File"><input type="file" onChange={e=>setDocFile(e.target.files[0])} /></Field>
        </Grid>
        <Btn onClick={uploadDoc} style={{ marginBottom:16 }}>Upload</Btn>
        <Table cols={[{label:"Type",key:"document_type"},{label:"File",key:"document_name"},{label:"Date",key:"upload_date"},{label:"View",render:d=><a href={`${API}/${d.file_path}`} target="_blank" rel="noreferrer" style={{ color:C.accent,fontWeight:600 }}>↗</a>}]} rows={docs} compact />
      </Modal>
    </div>
  );
}

// ─── LEADS MODULE ─────────────────────────────────────────────────────────────
function LeadsModule({ auth }) {
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({});
  const [selected, setSelected] = useState(null);

  function load() {
    const q = new URLSearchParams({ ...(search&&{search}), ...(filterStatus&&{status:filterStatus}) });
    auth(`/leads?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setLeads(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[search,filterStatus]);

  async function saveLead() {
    const method=selected?"PUT":"POST";
    const path=selected?`/leads/${selected.id}`:"/leads";
    const r=await auth(path,{ method, body:JSON.stringify(form) });
    const d=await r.json();
    alert(d.message); setShowForm(false); load();
  }

  const statuses=["New","Contacted","Assessment Scheduled","Assessment Completed","Quote Sent","Follow-Up","Interested","Thinking","Converted","Not Interested"];
  const sources=["Helpline","Landline","WhatsApp","Website","Hospital Referral","Doctor Referral","Existing Client","Walk-in","Other"];

  const byStatus = statuses.slice(0,6).map(s=>({ name:s, count:leads.filter(l=>l.status===s).length })).filter(s=>s.count>0);

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="📋" label="Total Leads" value={leads.length} gradient={G.blue} />
        <StatCard icon="🆕" label="New" value={leads.filter(l=>l.status==="New").length} gradient={G.amber} />
        <StatCard icon="✅" label="Converted" value={leads.filter(l=>l.status==="Converted").length} gradient={G.green} />
        <StatCard icon="📞" label="Follow-Up" value={leads.filter(l=>l.status==="Follow-Up").length} gradient={G.purple} />
      </div>

      <FilterBar>
        <SearchBar value={search} onChange={setSearch} placeholder="Search patient or mobile…" />
        <select style={{...inp,minWidth:180}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {statuses.map(s=><option key={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setForm({ status:"New" }); setSelected(null); setShowForm(true); }}>+ New Lead</Btn></div>
      </FilterBar>

      <Card>
        <Table cols={[
          { label:"Patient",render:l=><div><div style={{ fontWeight:600 }}>{l.patient_name}</div><div style={{ color:C.muted,fontSize:11 }}>{l.caller_name} ({l.relation})</div></div> },
          { label:"Mobile",key:"caller_mobile" },
          { label:"Service",key:"service_needed" },
          { label:"Source",render:l=><Badge color="indigo">{l.source}</Badge> },
          { label:"Urgency",render:l=><Badge color={l.urgency==="Immediate"?"red":l.urgency==="Planned"?"blue":"gray"}>{l.urgency}</Badge> },
          { label:"Status",render:l=><Badge color={statusColor(l.status)}>{l.status}</Badge> },
          { label:"Follow Up",render:l=>l.follow_up_date?<span style={{ fontSize:12 }}>{l.follow_up_date}</span>:"—" },
          { label:"",render:l=><Btn small onClick={e=>{ e.stopPropagation(); setSelected(l); setForm({...l}); setShowForm(true); }}>Update</Btn> },
        ]} rows={leads} />
      </Card>

      <Modal open={showForm} title={selected?"Update Lead":"New Lead"} onClose={()=>setShowForm(false)} wide>
        <Grid cols={3}>
          <Input label="Caller Name" value={form.caller_name||""} onChange={e=>setForm(f=>({...f,caller_name:e.target.value}))} />
          <Input label="Caller Mobile" value={form.caller_mobile||""} onChange={e=>setForm(f=>({...f,caller_mobile:e.target.value}))} />
          <Input label="Relation" value={form.relation||""} onChange={e=>setForm(f=>({...f,relation:e.target.value}))} />
          <Input label="Patient Name" required value={form.patient_name||""} onChange={e=>setForm(f=>({...f,patient_name:e.target.value}))} />
          <Input label="Patient Age" value={form.patient_age||""} onChange={e=>setForm(f=>({...f,patient_age:e.target.value}))} />
          <Select label="Gender" value={form.patient_gender||""} onChange={e=>setForm(f=>({...f,patient_gender:e.target.value}))} options={["Male","Female","Other"]} />
          <Select label="Source" value={form.source||""} onChange={e=>setForm(f=>({...f,source:e.target.value}))} options={sources} />
          <Select label="Urgency" value={form.urgency||""} onChange={e=>setForm(f=>({...f,urgency:e.target.value}))} options={["Immediate","Planned","Information Seeking"]} />
          <Select label="Status" value={form.status||"New"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} options={statuses} />
          <Input label="Follow-up Date" type="date" value={form.follow_up_date||""} onChange={e=>setForm(f=>({...f,follow_up_date:e.target.value}))} />
          <Input label="Service Needed" value={form.service_needed||""} onChange={e=>setForm(f=>({...f,service_needed:e.target.value}))} />
          <Input label="Diagnosis" value={form.diagnosis||""} onChange={e=>setForm(f=>({...f,diagnosis:e.target.value}))} />
        </Grid>
        <Textarea label="Address" value={form.patient_address||""} onChange={e=>setForm(f=>({...f,patient_address:e.target.value}))} rows={2} />
        <Textarea label="Notes" value={form.notes||""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:16 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={saveLead}>Save Lead</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── BOOKINGS MODULE ──────────────────────────────────────────────────────────
function BookingsModule({ auth, user }) {
  const [bookings, setBookings] = useState([]);
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [services, setServices] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [form, setForm] = useState({});
  const [selected, setSelected] = useState(null);
  const [reassignForm, setReassignForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [showStop, setShowStop] = useState(false);
  const [stopForm, setStopForm] = useState({});
  const [showConvert, setShowConvert] = useState(false);
  const [convertForm, setConvertForm] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  const role = user?.role || "";
  const isAdmin = role === "admin";
  const canEdit = role === "admin" || role === "manager";

  function load() {
    const q = new URLSearchParams({ ...(search&&{search}), ...(filterStatus&&{status:filterStatus}) });
    auth(`/bookings?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setBookings(d)).catch(()=>{});
    auth("/patients").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{});
    auth("/staff?status=Active").then(r=>r.json()).then(d=>Array.isArray(d)&&setStaff(d)).catch(()=>{});
    auth("/services").then(r=>r.json()).then(d=>Array.isArray(d)&&setServices(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[search,filterStatus]);

  // Fetch wallet balance for selected patient (used in booking form)
  useEffect(()=>{
    if (showForm && form.patient_id) {
      auth(`/wallet/${form.patient_id}`).then(r=>r.json())
        .then(d=>setWalletBalance(parseFloat(d?.current_balance||0)))
        .catch(()=>setWalletBalance(0));
    } else { setWalletBalance(0); }
  }, [form.patient_id, showForm]);

  async function stopBooking() {
    if (saving) return; setSaving(true);
    try {
      const r = await auth(`/bookings/${selected.id}/stop`, { method:"POST", body: JSON.stringify(stopForm) });
      const d = await r.json();
      if (!r.ok) { alert(d.message || d.detail || "Failed"); return; }
      alert(d.message || "Service stopped");
      setShowStop(false); load();
    } catch(e){ alert("Network error"); } finally { setSaving(false); }
  }

  async function convertBooking() {
    if (saving) return; setSaving(true);
    try {
      const r = await auth(`/bookings/${selected.id}/convert`, { method:"POST", body: JSON.stringify(convertForm) });
      const d = await r.json();
      if (!r.ok) { alert(d.message || d.detail || "Failed"); return; }
      alert(d.message || "Service converted");
      setShowConvert(false); load();
    } catch(e){ alert("Network error"); } finally { setSaving(false); }
  }

  async function loadHistory(bk) {
    setSelected(bk);
    try {
      const r = await auth(`/bookings/${bk.id}/history`);
      const d = await r.json();
      setHistory(Array.isArray(d) ? d : []);
      setShowHistory(true);
    } catch(e){ alert("Failed to load history"); }
  }

  async function saveBooking() {
    if (saving) return;
    setSaving(true);
    try {
      const method = selected ? "PUT" : "POST";
      const path = selected ? `/bookings/${selected.id}` : "/bookings";
      const r = await auth(path, { method, body: JSON.stringify(form) });
      let d = {};
      try { d = await r.json(); } catch (_) { d = {}; }
      if (!r.ok) {
        const msg = d.message || d.detail || (Array.isArray(d.detail) ? d.detail.map(x=>x.msg).join(", ") : "Save failed");
        alert(typeof msg === "string" ? msg : "Save failed");
        return;
      }
      alert(d.message || "Saved");
      setShowForm(false);
      load();
    } catch (e) {
      console.error("saveBooking error", e);
      alert("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function reassign() {
    const r=await auth(`/bookings/${selected.id}/reassign`,{ method:"POST", body:JSON.stringify(reassignForm) });
    const d=await r.json();
    alert(d.message); setShowReassign(false); load();
  }

  const statuses=["Pending","Active","Completed","Cancelled","On Hold"];
  const selectedServices=services.find(s=>s.category===form.service_category);

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="📅" label="Total" value={bookings.length} gradient={G.blue} />
        <StatCard icon="✅" label="Active" value={bookings.filter(b=>b.status==="Active").length} gradient={G.green} />
        <StatCard icon="⏳" label="Pending" value={bookings.filter(b=>b.status==="Pending").length} gradient={G.amber} />
        <StatCard icon="⚠️" label="Unassigned" value={bookings.filter(b=>!b.staff_id).length} gradient={G.red} />
      </div>

      <FilterBar>
        <SearchBar value={search} onChange={setSearch} placeholder="Search patient or booking ID…" />
        <select style={{...inp,minWidth:140}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          {statuses.map(s=><option key={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setForm({ status:"Pending",payment_status:"Pending" }); setSelected(null); setShowForm(true); }}>+ New Booking</Btn></div>
      </FilterBar>

      <Card>
        <Table cols={[
          { label:"Booking ID",render:b=><span style={{ fontFamily:"monospace",fontSize:11,color:C.accent,fontWeight:600 }}>{b.booking_id}</span> },
          { label:"Patient",render:b=><div><div style={{ fontWeight:600 }}>{b.patient_name}</div><div style={{ color:C.muted,fontSize:11 }}>{b.patient_mobile}</div></div> },
          { label:"Service",render:b=><div><div style={{ fontSize:13 }}>{b.service_name}</div><div style={{ color:C.muted,fontSize:11 }}>{b.service_category}</div></div> },
          { label:"Staff",render:b=>b.staff_name?<div><div style={{ fontWeight:500,fontSize:12 }}>{b.staff_name}</div><div style={{ color:C.muted,fontSize:11 }}>{b.staff_code}</div></div>:<Badge color="amber">Unassigned</Badge> },
          { label:"Dates",render:b=><div style={{ fontSize:11,color:C.textSub }}>{b.start_date}<br/>{b.end_date?"→ "+b.end_date:""}</div> },
          { label:"Amount",render:b=><div><div style={{ fontWeight:700 }}>₹{(b.amount||0).toLocaleString("en-IN")}</div><div style={{ fontSize:11,color:C.green }}>Paid ₹{(b.paid_amount||0).toLocaleString("en-IN")}</div></div> },
          { label:"Status",render:b=><Badge color={statusColor(b.status)}>{b.status}</Badge> },
          { label:"Payment",render:b=><Badge color={statusColor(b.payment_status)}>{b.payment_status}</Badge> },
          { label:"",render:b=>(
            <div style={{ display:"flex",gap:5, flexWrap:"wrap" }}>
              <Btn small onClick={e=>{ e.stopPropagation(); setSelected(b); setForm({...b}); setShowForm(true); }}>Edit</Btn>
              <Btn small color={C.purple} onClick={e=>{ e.stopPropagation(); setSelected(b); setReassignForm({}); setShowReassign(true); }}>↔</Btn>
              {!["Stopped","Cancelled","Completed","Converted"].includes(b.status) && (
                <>
                  <Btn small danger onClick={e=>{ e.stopPropagation(); setSelected(b); setStopForm({ stop_date: new Date().toISOString().slice(0,10) }); setShowStop(true); }}>Stop</Btn>
                  {canEdit && <Btn small color={C.amber} onClick={e=>{ e.stopPropagation(); setSelected(b); setConvertForm({ conversion_date: new Date().toISOString().slice(0,10), use_wallet:true }); setShowConvert(true); }}>Convert</Btn>}
                </>
              )}
              <Btn small outline onClick={e=>{ e.stopPropagation(); loadHistory(b); }}>History</Btn>
            </div>
          )},
        ]} rows={bookings} />
      </Card>

      <Modal open={showForm} title={selected?"Edit Booking":"New Service Booking"} onClose={()=>setShowForm(false)} wide>
        <Grid cols={3}>
          <Select label="Patient" required value={form.patient_id||""} onChange={e=>setForm(f=>({...f,patient_id:e.target.value}))} options={patients.map(p=>({value:p.id,label:p.name}))} />
          <Select label="Service Category" required value={form.service_category||""} onChange={e=>setForm(f=>({...f,service_category:e.target.value,service_name:""}))} options={services.map(s=>s.category)} />
          <Select label="Service Name" required value={form.service_name||""} onChange={e=>setForm(f=>({...f,service_name:e.target.value}))} options={selectedServices?.items||[]} />
          <Input label="Start Date" type="date" required value={form.start_date||""} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))} />
          <Input label="End Date" type="date" value={form.end_date||""} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} />
          <Select label="Shift" value={form.shift||""} onChange={e=>setForm(f=>({...f,shift:e.target.value}))} options={["12-Hour Day","12-Hour Night","24-Hour","Per Visit","Weekly","Monthly"]} />
          <Select label="Assign Staff" value={form.staff_id||""} onChange={e=>setForm(f=>({...f,staff_id:e.target.value}))} options={staff.map(s=>({value:s.id,label:`${s.code} - ${s.name} (${s.duty_tag})`}))} />
          <Input label="Total Amount (₹)" type="number" value={form.amount||""} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} hint={form.rate_per_shift && form.total_shifts ? `Auto: ₹${form.rate_per_shift} × ${form.total_shifts}` : ""} />
          <Input label="Rate per Shift (₹)" type="number" value={form.rate_per_shift||""} onChange={e=>setForm(f=>({...f,rate_per_shift:e.target.value}))} hint="Used to calculate consumed amount" />
          <Input label="Total Shifts" type="number" value={form.total_shifts||""} onChange={e=>setForm(f=>({...f,total_shifts:e.target.value}))} />
          <Input label="Amount Paid (₹)" type="number" value={form.paid_amount||""} onChange={e=>setForm(f=>({...f,paid_amount:e.target.value}))} />
          <Select label="Payment Mode" value={form.payment_mode||""} onChange={e=>setForm(f=>({...f,payment_mode:e.target.value}))} options={["Cash","UPI","Card","NEFT/RTGS","Cheque","ECS"]} />
          <Select label="Payment Status" value={form.payment_status||"Pending"} onChange={e=>setForm(f=>({...f,payment_status:e.target.value}))} options={["Pending","Partial","Paid"]} />
          <Select label="Booking Status" value={form.status||"Pending"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} options={statuses} />
        </Grid>
        <Textarea label="Notes" value={form.notes||""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} />

        {/* Wallet usage panel — shows when patient has wallet balance */}
        {!selected && form.patient_id && walletBalance > 0 && (
          <div style={{ background:"linear-gradient(135deg, #ECFDF5, #D1FAE5)", border:`1px solid ${C.green}`, borderRadius:10, padding:12, marginTop:12, display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontSize:24 }}>💼</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:"#065F46" }}>Wallet Available: ₹{walletBalance.toLocaleString("en-IN")}</div>
              <div style={{ fontSize:11, color:"#047857" }}>{form.use_wallet ? `Will be used to pay for this booking (up to ₹${Math.min(walletBalance, Math.max(0, (parseFloat(form.amount)||0) - (parseFloat(form.paid_amount)||0))).toLocaleString("en-IN")}).` : "Tick to use wallet balance"}</div>
            </div>
            <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, cursor:"pointer" }}>
              <input type="checkbox" checked={!!form.use_wallet} onChange={e=>setForm(f=>({...f, use_wallet:e.target.checked}))} />
              <span>Use Wallet Balance</span>
            </label>
          </div>
        )}

        {/* Back-date warning */}
        {!selected && form.start_date && form.start_date < new Date().toISOString().slice(0,10) && (
          <div style={{ background:"#FEF3C7", border:"1px solid #F59E0B", borderRadius:8, padding:10, marginTop:10, fontSize:12, color:"#92400E" }}>
            ⚠️ Back-dated entry — only Super Admin can create services in the past. Audit log will mark this entry.
          </div>
        )}

        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:16 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={saveBooking} disabled={saving}>{saving?"Saving…":"Save Booking"}</Btn>
        </div>
      </Modal>

      {/* Stop Service modal */}
      <Modal open={showStop} title={`Stop Service — ${selected?.booking_id||""}`} onClose={()=>setShowStop(false)}>
        <div style={{ background:C.bg, borderRadius:10, padding:12, marginBottom:14, fontSize:13 }}>
          <div>Patient: <strong>{selected?.patient_name}</strong></div>
          <div>Service: <strong>{selected?.service_name}</strong></div>
          <div>Paid: <strong>₹{(selected?.paid_amount||0).toLocaleString("en-IN")}</strong> · Rate/Shift: <strong>₹{selected?.rate_per_shift||"—"}</strong></div>
          <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>System will calculate consumed amount and credit the remaining balance to patient's wallet.</div>
        </div>
        <Input label="Stop Date" type="date" required value={stopForm.stop_date||""} onChange={e=>setStopForm(f=>({...f, stop_date:e.target.value}))} />
        <Textarea label="Reason" value={stopForm.reason||""} onChange={e=>setStopForm(f=>({...f, reason:e.target.value}))} rows={2} />
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:12 }}>
          <Btn outline onClick={()=>setShowStop(false)}>Cancel</Btn>
          <Btn danger onClick={stopBooking} disabled={saving}>{saving?"Stopping…":"Stop & Credit Wallet"}</Btn>
        </div>
      </Modal>

      {/* Convert Service modal */}
      <Modal open={showConvert} title={`Convert Service — ${selected?.booking_id||""}`} onClose={()=>setShowConvert(false)} wide>
        <div style={{ background:C.bg, borderRadius:10, padding:12, marginBottom:14, fontSize:13 }}>
          <div>From: <strong>{selected?.service_name} (₹{selected?.rate_per_shift||"—"}/shift)</strong></div>
          <div>Patient: <strong>{selected?.patient_name}</strong> · Paid ₹{(selected?.paid_amount||0).toLocaleString("en-IN")}</div>
        </div>
        <Grid cols={3}>
          <Select label="New Service Category" required value={convertForm.service_category||""} onChange={e=>setConvertForm(f=>({...f,service_category:e.target.value,service_name:""}))} options={services.map(s=>s.category)} />
          <Select label="New Service Name" required value={convertForm.service_name||""} onChange={e=>setConvertForm(f=>({...f,service_name:e.target.value}))} options={services.find(s=>s.category===convertForm.service_category)?.items||[]} />
          <Input label="New Rate per Shift (₹)" type="number" required value={convertForm.rate_per_shift||""} onChange={e=>setConvertForm(f=>({...f,rate_per_shift:e.target.value}))} />
          <Input label="Total Shifts (Remaining)" type="number" value={convertForm.total_shifts||""} onChange={e=>setConvertForm(f=>({...f,total_shifts:e.target.value}))} />
          <Input label="Conversion Date" type="date" required value={convertForm.conversion_date||""} onChange={e=>setConvertForm(f=>({...f,conversion_date:e.target.value}))} />
          <Input label="New End Date" type="date" value={convertForm.end_date||""} onChange={e=>setConvertForm(f=>({...f,end_date:e.target.value}))} />
        </Grid>
        <Textarea label="Conversion Reason" value={convertForm.reason||""} onChange={e=>setConvertForm(f=>({...f,reason:e.target.value}))} rows={2} />
        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, marginTop:8 }}>
          <input type="checkbox" checked={!!convertForm.use_wallet} onChange={e=>setConvertForm(f=>({...f, use_wallet:e.target.checked}))} />
          <span>Use wallet balance to pay for the new (converted) booking</span>
        </label>
        <div style={{ fontSize:11, color:C.muted, marginTop:8 }}>System will: (1) credit remaining of old service to wallet, (2) create new booking, (3) optionally debit wallet for new booking, (4) log audit trail.</div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:12 }}>
          <Btn outline onClick={()=>setShowConvert(false)}>Cancel</Btn>
          <Btn color={C.amber} onClick={convertBooking} disabled={saving}>{saving?"Converting…":"Convert Service"}</Btn>
        </div>
      </Modal>

      {/* Booking History modal */}
      <Modal open={showHistory} title={`Service History — ${selected?.booking_id||""}`} onClose={()=>setShowHistory(false)} wide>
        {history.length === 0 ? (
          <div style={{ padding:20, textAlign:"center", color:C.muted }}>No history yet.</div>
        ) : (
          <Table cols={[
            { label:"Date", render:h=><div style={{ fontSize:11 }}>{(h.created_at||"").slice(0,16).replace("T"," ")}</div> },
            { label:"Action", render:h=><Badge color={h.action==="created"?"green":h.action==="stopped"?"red":h.action==="converted"?"amber":"blue"}>{h.action}</Badge> },
            { label:"Before", render:h=><pre style={{ fontSize:10, margin:0, color:C.textSub }}>{h.before?JSON.stringify(h.before,null,1):"—"}</pre> },
            { label:"After",  render:h=><pre style={{ fontSize:10, margin:0, color:C.textSub }}>{h.after?JSON.stringify(h.after,null,1):"—"}</pre> },
            { label:"By", render:h=><div><div style={{ fontWeight:600, fontSize:12 }}>{h.edited_by||"—"}</div><div style={{ fontSize:10, color:C.muted }}>{h.edited_by_role||""}</div></div> },
            { label:"Reason", render:h=><div style={{ fontSize:12 }}>{h.reason||"—"}</div> },
          ]} rows={history} />
        )}
      </Modal>

      <Modal open={showReassign} title={`Reassign — ${selected?.booking_id}`} onClose={()=>setShowReassign(false)}>
        <div style={{ background:C.bg,borderRadius:10,padding:12,marginBottom:14,fontSize:13 }}>
          <div>Patient: <strong>{selected?.patient_name}</strong></div>
          <div>Current Staff: <strong>{selected?.staff_name||"Unassigned"}</strong></div>
          <div style={{ fontSize:11,color:C.muted,marginTop:4 }}>Booking valid for 30 days from creation.</div>
        </div>
        <Select label="New Staff" value={reassignForm.staff_id||""} onChange={e=>setReassignForm(f=>({...f,staff_id:e.target.value}))} options={staff.map(s=>({value:s.id,label:`${s.code} - ${s.name} (${s.duty_tag})`}))} />
        <Textarea label="Reason for Reassignment" value={reassignForm.reason||""} onChange={e=>setReassignForm(f=>({...f,reason:e.target.value}))} rows={2} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowReassign(false)}>Cancel</Btn>
          <Btn onClick={reassign}>Confirm Reassign</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── SERVICES CATALOG MODULE ──────────────────────────────────────────────────
function ServicesCatalogModule({ auth, user }) {
  const [services, setServices] = useState([]);
  const [filter, setFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category:"Nursing & Care", unit:"visit", is_active:true, package_rate:0, standard_rate:0 });
  const [editingId, setEditingId] = useState(null);

  const canEdit = ["admin","manager","accountant"].includes(user?.role);

  function load() {
    auth("/services?active_only=false").then(r=>r.json()).then(d=>Array.isArray(d)&&setServices(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[]);

  async function save() {
    if(!form.name||!form.category) return alert("Name and Category are required");
    const url = editingId ? `/services/${editingId}` : "/services";
    const r = await auth(url, { method: editingId?"PUT":"POST", body: JSON.stringify(form) });
    const d = await r.json();
    if(!r.ok) return alert("⛔ " + (d.message || d.detail || "Error"));
    alert(d.message || "Saved");
    setShowForm(false); setEditingId(null);
    setForm({ category:"Nursing & Care", unit:"visit", is_active:true, package_rate:0, standard_rate:0 });
    load();
  }

  async function deactivate(s) {
    if(!window.confirm(`Deactivate "${s.name}"? Historical bills will keep the reference.`)) return;
    const r = await auth(`/services/${s.id}`, { method:"DELETE" });
    if(!r.ok){ const d=await r.json(); return alert("⛔ "+(d.message||d.detail)); }
    load();
  }

  function openEdit(s) {
    setEditingId(s.id);
    setForm({ ...s });
    setShowForm(true);
  }

  const categories = [...new Set(services.map(s=>s.category))].sort();
  const filtered = filter ? services.filter(s=>s.category===filter) : services;
  const byCat = {};
  filtered.forEach(s=>{ (byCat[s.category]=byCat[s.category]||[]).push(s); });

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="🧾" label="Total Services" value={services.length} gradient={G.blue} />
        <StatCard icon="✅" label="Active" value={services.filter(s=>s.is_active).length} gradient={G.green} />
        <StatCard icon="🗂️" label="Categories" value={categories.length} gradient={G.indigo} />
        <StatCard icon="💰" label="Avg. Std Rate" value={`₹${Math.round(services.reduce((a,s)=>a+(parseFloat(s.standard_rate)||0),0)/(services.length||1)).toLocaleString("en-IN")}`} gradient={G.amber} />
      </div>
      <FilterBar>
        <select style={{...inp,minWidth:240}} value={filter} onChange={e=>setFilter(e.target.value)} data-testid="filter-category">
          <option value="">All Categories</option>
          {categories.map(c=><option key={c}>{c}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}>
          {canEdit && <Btn data-testid="add-service-btn" onClick={()=>{ setEditingId(null); setForm({ category:categories[0]||"Nursing & Care", unit:"visit", is_active:true, package_rate:0, standard_rate:0 }); setShowForm(true); }}>+ Add Service</Btn>}
        </div>
      </FilterBar>

      {Object.entries(byCat).map(([cat, rows])=>(
        <Card key={cat} style={{marginBottom:14}}>
          <div style={{ padding:"10px 14px", borderBottom:`1px solid ${C.border}`, background:C.bg, display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontWeight:700, fontSize:13, color:C.text }}>{cat}</span>
            <Badge color="indigo">{rows.length} services</Badge>
          </div>
          <Table cols={[
            { label:"Code", render:s=><span style={{fontFamily:"monospace",fontSize:11,color:C.purple,fontWeight:700}}>{s.code}</span> },
            { label:"Service Name", key:"name" },
            { label:"Unit", render:s=><Badge color="blue">per {s.unit}</Badge> },
            { label:"Package Rate", render:s=>s.package_rate>0?<span style={{fontWeight:700,color:C.green}}>₹{Number(s.package_rate).toLocaleString("en-IN")}</span>:<span style={{color:C.muted,fontSize:11}}>As per actuals</span> },
            { label:"Standard Rate", render:s=>s.standard_rate>0?<span style={{fontWeight:700,color:C.red}}>₹{Number(s.standard_rate).toLocaleString("en-IN")}</span>:<span style={{color:C.muted,fontSize:11}}>—</span> },
            { label:"PPE", render:s=>s.ppe_included?<Badge color="green">Incl.</Badge>:<span style={{color:C.muted,fontSize:11}}>—</span> },
            { label:"Status", render:s=>s.is_active?<Badge color="green">Active</Badge>:<Badge color="red">Inactive</Badge> },
            { label:"", render:s=>canEdit ? <div style={{display:"flex",gap:6}}>
                <Btn small outline color={C.accent} onClick={()=>openEdit(s)} data-testid={`edit-svc-${s.id}`}>Edit</Btn>
                {s.is_active && <Btn small outline danger onClick={()=>deactivate(s)} data-testid={`del-svc-${s.id}`}>Deactivate</Btn>}
              </div> : null },
          ]} rows={rows} />
        </Card>
      ))}

      <Modal open={showForm} title={editingId?`Edit Service`:"+ Add Service"} onClose={()=>{ setShowForm(false); setEditingId(null); }} wide>
        <AlertBanner type="info" icon="ℹ️" title="Package rate applies when customer pays upfront for a bundle. Standard rate is used on refund recalculation (per-visit billing)." />
        <Grid cols={2}>
          <Input label="Service Name" required data-testid="svc-name" value={form.name||""} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          <Select label="Category" required value={form.category||""} onChange={e=>setForm(f=>({...f,category:e.target.value}))} options={["Nursing & Care","Procedures","Diagnostics","Therapy","Doctor & Equipment","Ambulance & Transport","Other"]} />
          <Input label="Service Code (auto if blank)" value={form.code||""} onChange={e=>setForm(f=>({...f,code:e.target.value}))} />
          <Select label="Billing Unit" value={form.unit||"visit"} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} options={["visit","shift","day","session","hour","trip","km","each"]} />
          <Input label="Package Rate (₹)" type="number" data-testid="svc-package-rate" value={form.package_rate||0} onChange={e=>setForm(f=>({...f,package_rate:e.target.value}))} />
          <Input label="Standard Rate (₹)" type="number" data-testid="svc-standard-rate" value={form.standard_rate||0} onChange={e=>setForm(f=>({...f,standard_rate:e.target.value}))} />
          <Input label="GST %" type="number" value={form.gst_pct||0} onChange={e=>setForm(f=>({...f,gst_pct:e.target.value}))} />
          <Input label="HSN Code" value={form.hsn_code||"999316"} onChange={e=>setForm(f=>({...f,hsn_code:e.target.value}))} />
        </Grid>
        <div style={{display:"flex",gap:14,marginTop:10}}>
          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13}}><input type="checkbox" checked={!!form.ppe_included} onChange={e=>setForm(f=>({...f,ppe_included:e.target.checked}))} /> PPE included</label>
          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13}}><input type="checkbox" checked={form.is_active!==false} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))} /> Active</label>
        </div>
        <Textarea label="Description" rows={2} value={form.description||""} onChange={e=>setForm(f=>({...f,description:e.target.value}))} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:14 }}>
          <Btn outline onClick={()=>{ setShowForm(false); setEditingId(null); }}>Cancel</Btn>
          <Btn data-testid="svc-save" onClick={save}>💾 {editingId?"Update":"Add"} Service</Btn>
        </div>
      </Modal>
    </div>
  );
}


// ─── BILLING MODULE ───────────────────────────────────────────────────────────
function BillingModule({ auth }) {
  const [bills, setBills] = useState([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [showPay, setShowPay] = useState(false);
  const [selected, setSelected] = useState(null);
  const [payForm, setPayForm] = useState({ amount:"", mode:"Cash" });
  // Create Bill (itemized) state
  const [showCreate, setShowCreate] = useState(false);
  const [services, setServices] = useState([]);
  const [patients, setPatients] = useState([]);
  const [billForm, setBillForm] = useState({ is_package:false, line_items:[{}], paid_amount:0, payment_mode:"Cash" });

  function load() {
    const q = filterStatus?`?payment_status=${filterStatus}`:"";
    auth(`/bills${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setBills(d)).catch(()=>{});
    auth("/services").then(r=>r.json()).then(d=>Array.isArray(d)&&setServices(d)).catch(()=>{});
    auth("/patients").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[filterStatus]);

  async function recordPayment() {
    const r=await auth(`/bills/${selected.id}/pay`,{ method:"POST", body:JSON.stringify(payForm) });
    const d=await r.json();
    alert(d.message); setShowPay(false); load();
  }

  // ── Itemized bill creation ──
  // Auto-calc qty from date range for shift/day-based services
  function daysBetween(from, to) {
    if(!from || !to) return 0;
    const d1 = new Date(from), d2 = new Date(to);
    if(isNaN(d1) || isNaN(d2)) return 0;
    return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);  // inclusive
  }
  function autoQtyFor(li, from, to) {
    const s = services.find(x=>x.id==li.service_id);
    if(!s) return li.qty || 0;
    const days = daysBetween(from, to);
    if(!days) return li.qty || 0;
    if(s.unit === "shift") return days * (parseFloat(li.shifts_per_day) || 1);
    if(s.unit === "day")   return days;
    return li.qty || 0;  // visit/session/trip/each → user enters manually
  }
  function setLine(idx, patch) {
    setBillForm(f=>{
      const li=[...f.line_items];
      const merged = {...li[idx],...patch};
      // Re-auto-compute qty when service or shifts_per_day changes
      if("service_id" in patch || "shifts_per_day" in patch) {
        const auto = autoQtyFor(merged, f.service_from, f.service_to);
        if(auto > 0) merged.qty = auto;
      }
      li[idx]=merged;
      return {...f,line_items:li};
    });
  }
  function setDateRange(field, value) {
    setBillForm(f=>{
      const newF = {...f, [field]:value};
      // Re-auto-compute qty for every shift/day line
      newF.line_items = (f.line_items||[]).map(li=>{
        const s = services.find(x=>x.id==li.service_id);
        if(s && (s.unit==="shift" || s.unit==="day")) {
          const auto = autoQtyFor(li, newF.service_from, newF.service_to);
          if(auto > 0) return {...li, qty:auto};
        }
        return li;
      });
      return newF;
    });
  }
  function addLine() { setBillForm(f=>({...f,line_items:[...f.line_items,{}]})); }
  function removeLine(idx) { setBillForm(f=>({...f,line_items:f.line_items.filter((_,i)=>i!==idx)})); }

  function calcSubtotal() {
    return billForm.line_items.reduce((t,li)=>{
      const s = services.find(x=>x.id==li.service_id);
      if(!s||!li.qty) return t;
      const rate = li.rate_override || (billForm.is_package ? s.package_rate : s.standard_rate);
      return t + (parseFloat(rate)||0) * (parseFloat(li.qty)||0);
    }, 0);
  }
  const subtotal = calcSubtotal();
  const discount = parseFloat(billForm.discount)||0;
  const total = Math.max(0, subtotal - discount);

  async function saveBill() {
    if(!billForm.patient_id) return alert("Select a patient");
    if(!billForm.line_items.length || billForm.line_items.some(li=>!li.service_id||!li.qty))
      return alert("Add at least one service with quantity");
    const payload = {
      patient_id: parseInt(billForm.patient_id),
      is_package: !!billForm.is_package,
      line_items: billForm.line_items.map(li=>({
        service_id: parseInt(li.service_id), qty: parseFloat(li.qty),
        rate_override: li.rate_override ? parseFloat(li.rate_override) : undefined,
      })),
      discount, paid_amount: parseFloat(billForm.paid_amount)||0,
      payment_mode: billForm.payment_mode,
      transaction_ref: billForm.transaction_ref||"",
      payer_name: billForm.payer_name||"",
      service_from: billForm.service_from||"",
      service_to: billForm.service_to||"",
    };
    const r = await auth("/bills", { method:"POST", body: JSON.stringify(payload) });
    const d = await r.json();
    if(!r.ok) return alert("⛔ "+(d.message||d.detail));
    alert(`✅ Bill created. Receipt: ${d.receipt_number} — generating PDF…`);
    setShowCreate(false);
    setBillForm({ is_package:false, line_items:[{}], paid_amount:0, payment_mode:"Cash" });
    load();
    if(d.id) setTimeout(()=>downloadPdf(`/pdf/receipt-v2/${d.id}`, `receipt-${d.receipt_number}.pdf`), 600);
  }

  const totalBilled=bills.reduce((a,b)=>a+(b.amount||0),0);
  const totalCollected=bills.reduce((a,b)=>a+(b.paid_amount||0),0);
  const totalPending=totalBilled-totalCollected;

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="💵" label="Total Billed" value={`₹${(totalBilled/1000).toFixed(0)}k`} gradient={G.blue} />
        <StatCard icon="✅" label="Collected" value={`₹${(totalCollected/1000).toFixed(0)}k`} gradient={G.green} />
        <StatCard icon="⏳" label="Pending" value={`₹${(totalPending/1000).toFixed(0)}k`} gradient={G.amber} />
      </div>
      <FilterBar>
        <select style={{...inp,minWidth:160}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          {["Pending","Partial","Paid"].map(s=><option key={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}>
          <Btn data-testid="create-bill-btn" onClick={()=>{ setBillForm({ is_package:false, line_items:[{}], paid_amount:0, payment_mode:"Cash" }); setShowCreate(true); }}>+ Create Bill</Btn>
        </div>
      </FilterBar>
      <Card>
        <Table cols={[
          { label:"Receipt",render:b=><span style={{ fontFamily:"monospace",fontSize:11,color:C.accent }}>{b.receipt_number}</span> },
          { label:"Patient",key:"patient_name" },
          { label:"Service",key:"service" },
          { label:"Billed",render:b=>`₹${(b.amount||0).toLocaleString("en-IN")}` },
          { label:"Paid",render:b=><span style={{ color:C.green,fontWeight:600 }}>₹{(b.paid_amount||0).toLocaleString("en-IN")}</span> },
          { label:"Balance",render:b=><span style={{ color:(b.balance||0)>0?C.red:C.green,fontWeight:700 }}>₹{(b.balance||0).toLocaleString("en-IN")}</span> },
          { label:"Mode",key:"payment_mode" },
          { label:"Status",render:b=><><Badge color={statusColor(b.payment_status)}>{b.payment_status}</Badge>{b.watermark&&<span style={{ color:C.red,fontSize:10,marginLeft:4,fontWeight:700 }}>REFUND</span>}</> },
          { label:"Date",key:"date" },
          { label:"",render:b=>(
            <div style={{display:"flex",gap:4}}>
              <Btn small outline color={C.indigo} onClick={e=>{ e.stopPropagation(); downloadPdf(`/pdf/receipt-v2/${b.id}`, `receipt-${b.receipt_number||b.id}.pdf`); }}>📄 Receipt</Btn>
              {b.payment_status!=="Paid"&&<Btn small color={C.green} onClick={e=>{ e.stopPropagation(); setSelected(b); setPayForm({ amount:b.balance||"", mode:"Cash" }); setShowPay(true); }}>Pay</Btn>}
            </div>
          )},
        ]} rows={bills} />
      </Card>
      <Modal open={showPay} title={`Record Payment — ${selected?.receipt_number}`} onClose={()=>setShowPay(false)}>
        <div style={{ background:C.bg,borderRadius:10,padding:12,marginBottom:14,fontSize:13 }}>
          <div>Balance Due: <strong style={{ color:C.red }}>₹{(selected?.balance||0).toLocaleString("en-IN")}</strong></div>
          <div>Patient: <strong>{selected?.patient_name}</strong></div>
        </div>
        <Input label="Amount (₹)" type="number" value={payForm.amount} onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))} />
        <Select label="Payment Mode" value={payForm.mode} onChange={e=>setPayForm(f=>({...f,mode:e.target.value}))} options={["Cash","UPI","Card","NEFT/RTGS","Cheque","ECS"]} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
          <Btn outline onClick={()=>setShowPay(false)}>Cancel</Btn>
          <Btn color={C.green} onClick={recordPayment}>Record ₹{payForm.amount||0}</Btn>
        </div>
      </Modal>

      {/* Create Itemized Bill */}
      <Modal open={showCreate} title="🧾 Create Itemized Bill" onClose={()=>setShowCreate(false)} extraWide>
        <AlertBanner type="info" icon="ℹ️" title="Pick services from catalog. Package rate auto-applies if 'Package booking' is ticked. Receipt is auto-generated on save." />
        <Grid cols={3}>
          <Select label="Patient" required data-testid="bill-patient" value={billForm.patient_id||""} onChange={e=>{ const p=patients.find(x=>x.id==e.target.value); setBillForm(f=>({...f,patient_id:e.target.value,payer_name:p?.name||""})); }} options={patients.map(p=>({value:p.id,label:`${p.name} (${p.reg_number})`}))} />
          <Input label="Payer Name" value={billForm.payer_name||""} onChange={e=>setBillForm(f=>({...f,payer_name:e.target.value}))} />
          <div style={{display:"flex",alignItems:"flex-end",gap:8}}>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:600,padding:"8px 12px",background:billForm.is_package?C.green+"22":C.bg,borderRadius:8,border:`1px solid ${billForm.is_package?C.green:C.border}`}}>
              <input type="checkbox" data-testid="bill-is-package" checked={!!billForm.is_package} onChange={e=>setBillForm(f=>({...f,is_package:e.target.checked}))} />
              Package Booking (uses Package Rate)
            </label>
          </div>
          <Input label="Service From" type="date" data-testid="bill-service-from" value={billForm.service_from||""} onChange={e=>setDateRange("service_from", e.target.value)} />
          <Input label="Service To" type="date" data-testid="bill-service-to" value={billForm.service_to||""} onChange={e=>setDateRange("service_to", e.target.value)} />
        </Grid>

        <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"14px 0 6px",letterSpacing:".06em" }}>LINE ITEMS</div>
        {(() => {
          const days = daysBetween(billForm.service_from, billForm.service_to);
          if(days > 0) return (
            <div style={{padding:"8px 12px",marginBottom:8,background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:8,fontSize:12.5,color:"#166534"}}>
              ✓ <b>{days} day{days>1?"s":""}</b> in service window — qty auto-fills for <b>shift</b> & <b>day</b> based services (you can still override). For visit/session/trip services, enter qty manually.
            </div>
          );
          return null;
        })()}
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"3fr 0.7fr 0.9fr 0.9fr 1fr 1fr 40px",gap:8,padding:"8px 10px",background:C.bg,fontSize:11,fontWeight:700,color:C.textSub,letterSpacing:".05em"}}>
            <div>SERVICE</div><div>QTY</div><div>UNIT</div><div>SHIFTS/DAY</div><div>RATE (₹)</div><div>SUBTOTAL</div><div></div>
          </div>
          {billForm.line_items.map((li,idx)=>{
            const s = services.find(x=>x.id==li.service_id);
            const defaultRate = s ? (billForm.is_package ? s.package_rate : s.standard_rate) : 0;
            const rate = li.rate_override || defaultRate;
            const sub = (parseFloat(rate)||0) * (parseFloat(li.qty)||0);
            const isShiftBased = s && (s.unit==="shift" || s.unit==="day");
            const dayCount = daysBetween(billForm.service_from, billForm.service_to);
            return (
              <div key={idx} style={{borderTop:`1px solid ${C.border}`}}>
                <div style={{display:"grid",gridTemplateColumns:"3fr 0.7fr 0.9fr 0.9fr 1fr 1fr 40px",gap:8,padding:"8px 10px",alignItems:"center"}}>
                  <select data-testid={`line-svc-${idx}`} style={{...inp,fontSize:12,padding:"6px 8px"}} value={li.service_id||""} onChange={e=>setLine(idx,{service_id:e.target.value})}>
                    <option value="">— pick service —</option>
                    {services.map(svc=><option key={svc.id} value={svc.id}>{svc.code} — {svc.name}</option>)}
                  </select>
                  <input data-testid={`line-qty-${idx}`} type="number" min="1" style={{...inp,padding:"6px 8px"}} value={li.qty||""} onChange={e=>setLine(idx,{qty:e.target.value})} />
                  <div style={{fontSize:12,color:C.muted}}>{s?.unit||"—"}</div>
                  {isShiftBased ? (
                    <select data-testid={`line-spd-${idx}`} style={{...inp,fontSize:12,padding:"6px 8px"}} value={li.shifts_per_day||1} onChange={e=>setLine(idx,{shifts_per_day:e.target.value})}>
                      <option value="1">1× (once/day)</option>
                      <option value="2">2× (24-hr cover)</option>
                      <option value="3">3× (every 8h)</option>
                    </select>
                  ) : <div style={{fontSize:11,color:C.muted,textAlign:"center"}}>—</div>}
                  <input type="number" placeholder={defaultRate||""} style={{...inp,padding:"6px 8px"}} value={li.rate_override||""} onChange={e=>setLine(idx,{rate_override:e.target.value})} />
                  <div style={{fontWeight:700,color:C.text}}>₹{sub.toLocaleString("en-IN")}</div>
                  <button onClick={()=>removeLine(idx)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:16}}>✕</button>
                </div>
                {s && isShiftBased && dayCount > 0 && (
                  <div style={{padding:"0 10px 8px",fontSize:11,color:C.muted,marginLeft:8}}>
                    💡 Auto-calculated: <b>{dayCount} days × {li.shifts_per_day||1} shift{(li.shifts_per_day||1)>1?"s":""}/day = {dayCount*(parseFloat(li.shifts_per_day)||1)} {s.unit}s</b> · You can override the qty above if needed.
                  </div>
                )}
              </div>
            );
          })}
          <div style={{padding:"8px 10px",borderTop:`1px solid ${C.border}`}}>
            <Btn small outline onClick={addLine}>+ Add Line</Btn>
          </div>
        </div>

        <Grid cols={3} style={{marginTop:14}}>
          <Input label="Discount (₹)" type="number" value={billForm.discount||0} onChange={e=>setBillForm(f=>({...f,discount:e.target.value}))} />
          <Input label="Paid Now (₹)" type="number" data-testid="bill-paid-now" value={billForm.paid_amount||0} onChange={e=>setBillForm(f=>({...f,paid_amount:e.target.value}))} />
          <Select label="Payment Mode" value={billForm.payment_mode||"Cash"} onChange={e=>setBillForm(f=>({...f,payment_mode:e.target.value}))} options={["Cash","UPI","Card","NEFT/RTGS","Cheque","ECS"]} />
          <Input label="Transaction Ref (UPI/UTR)" value={billForm.transaction_ref||""} onChange={e=>setBillForm(f=>({...f,transaction_ref:e.target.value}))} />
        </Grid>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:14,padding:"12px 14px",background:C.bg,borderRadius:8}}>
          <div style={{fontSize:13,color:C.textSub}}>
            <div>Subtotal: <strong>₹{subtotal.toLocaleString("en-IN")}</strong></div>
            <div>Discount: ₹{discount.toLocaleString("en-IN")}</div>
            <div style={{fontSize:16,fontWeight:800,color:C.accent,marginTop:4}}>Total: ₹{total.toLocaleString("en-IN")}</div>
            <div style={{fontSize:11,color:C.muted}}>Balance after paid: ₹{Math.max(0, total - (parseFloat(billForm.paid_amount)||0)).toLocaleString("en-IN")}</div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <Btn outline onClick={()=>setShowCreate(false)}>Cancel</Btn>
            <Btn data-testid="bill-save" onClick={saveBill}>💾 Save & Generate Receipt</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── REFUNDS MODULE ───────────────────────────────────────────────────────────
function RefundsModule({ auth }) {
  const [refunds, setRefunds] = useState([]);
  const [bills, setBills] = useState([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [form, setForm] = useState({});
  const [idProofFile, setIdProofFile] = useState(null);
  const [chequeFile, setChequeFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [approveForm, setApproveForm] = useState({ level:"verify", utr:"" });

  function load() {
    auth(`/refunds${filterStatus?`?status=${filterStatus}`:""}`)
      .then(r=>r.json()).then(d=>Array.isArray(d)&&setRefunds(d)).catch(()=>{});
    auth("/bills").then(r=>r.json()).then(d=>Array.isArray(d)&&setBills(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[filterStatus]);

  async function uploadRefundDoc(rid, file, docType) {
    if (!file) return;
    const token = localStorage.getItem("ro_token") || "";
    const fd = new FormData();
    fd.append("document", file);
    fd.append("doc_type", docType);
    await fetch(`${API}/refunds/${rid}/upload-doc`, {
      method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` }
    });
  }

  async function submitRefund() {
    // Required validations per compliance
    if (!form.receipt_id) return alert("Select a receipt");
    if (!form.amount) return alert("Enter refund amount");
    if (!form.relative_name) return alert("Relative / Payee name is required");
    if (!form.relation) return alert("Relationship is required");
    if (!form.govt_id_number) return alert("Aadhaar / Govt ID number is required");
    if (!form.bank_account && !form.upi_id) return alert("Provide either Bank Account (+IFSC) or UPI ID");
    if (form.bank_account && !form.ifsc) return alert("IFSC required with bank account");
    setSubmitting(true);
    const r = await auth("/refunds", { method:"POST", body: JSON.stringify(form) });
    const d = await r.json();
    if (!r.ok) { setSubmitting(false); return alert("⛔ " + (d.message || "Failed")); }
    // Upload supporting docs if provided
    if (d.id) {
      if (idProofFile) await uploadRefundDoc(d.id, idProofFile, "id_proof");
      if (chequeFile) await uploadRefundDoc(d.id, chequeFile, "cancelled_cheque");
    }
    setSubmitting(false);
    alert(d.message || "Refund initiated");
    setShowForm(false);
    setIdProofFile(null); setChequeFile(null); setForm({});
    load();
  }

  async function processApproval() {
    const r=await auth(`/refunds/${selected.id}/approve`,{ method:"PATCH", body:JSON.stringify(approveForm) });
    const d=await r.json();
    alert(d.message); setShowApprove(false); load();
  }

  return (
    <div>
      <FilterBar>
        <select style={{...inp,minWidth:160}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {["Pending","Verified","Approved","Rejected"].map(s=><option key={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setForm({ mode:"NEFT" }); setShowForm(true); }}>+ Initiate Refund</Btn></div>
      </FilterBar>
      <Card>
        <Table cols={[
          { label:"Patient",key:"patient_name" },
          { label:"Amount",render:r=><strong>₹{(r.amount||0).toLocaleString("en-IN")}</strong> },
          { label:"Reason",key:"reason_category" },
          { label:"Payee",render:r=><div><div style={{fontWeight:600,fontSize:12}}>{r.relative_name||r.payee_name||"—"}</div><div style={{fontSize:10,color:C.muted}}>{r.relation||""}</div></div> },
          { label:"ID",render:r=>r.govt_id_number?<span style={{fontSize:11}}>{r.govt_id_type||"ID"}: ***{String(r.govt_id_number).slice(-4)}</span>:<span style={{color:C.muted}}>—</span> },
          { label:"Bank/UPI",render:r=>r.upi_id?<Badge color="teal">UPI</Badge>:r.bank_account?<span style={{fontSize:11,fontFamily:"monospace"}}>{r.bank_account}</span>:<span style={{color:C.muted}}>—</span> },
          { label:"Mode",render:r=><Badge color="indigo">{r.mode}</Badge> },
          { label:"Initiator",key:"initiator" },
          { label:"Verifier",render:r=>r.verifier||<span style={{ color:C.muted }}>—</span> },
          { label:"Approver",render:r=>r.approver||<span style={{ color:C.muted }}>—</span> },
          { label:"Status",render:r=><Badge color={statusColor(r.status)}>{r.status}</Badge> },
          { label:"Date",render:r=>r.initiated_at?.split("T")[0] },
          { label:"",render:r=><div style={{display:"flex",gap:6}}>
            <Btn small outline color={C.indigo} onClick={e=>{ e.stopPropagation(); downloadPdf(`/pdf/refund-details/${r.id}`, `refund-RO-RFD-${r.id}.pdf`); }} data-testid={`refund-pdf-${r.id}`}>📄 Details</Btn>
            {r.status!=="Approved" && <Btn small color={C.purple} onClick={e=>{ e.stopPropagation(); setSelected(r); setApproveForm({ level:r.status==="Pending"?"verify":"approve", utr:"" }); setShowApprove(true); }}>Process</Btn>}
          </div> },
        ]} rows={refunds} />
      </Card>

      <Modal open={showForm} title="Initiate Refund" onClose={()=>{ setShowForm(false); setIdProofFile(null); setChequeFile(null); }} wide>
        <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:12,marginBottom:14,fontSize:12,color:"#92400e" }}>
          ⚠️ Compliance Required: Relative identity (Aadhaar / Govt ID), bank/UPI details, and signed refund form. ID proof + cancelled cheque must be uploaded for audit trail. Processed via NEFT/UPI only.
        </div>

        <div style={{ fontWeight:700,fontSize:12,color:C.textSub,marginBottom:8,letterSpacing:".06em" }}>RECEIPT & AMOUNT</div>
        <Grid cols={2}>
          <Select label="Receipt" required value={form.receipt_id||""} onChange={e=>{ const bill=bills.find(b=>b.id==e.target.value); setForm(f=>({...f,receipt_id:e.target.value,patient_id:bill?.patient_id,patient_name:bill?.patient_name,amount:bill?.paid_amount,booking_id:bill?.booking_id})); }} options={bills.filter(b=>b.payment_status==="Paid").map(b=>({value:b.id,label:`${b.receipt_number} — ${b.patient_name} (₹${b.paid_amount})`}))} />
          <Input label="Refund Amount (₹)" type="number" required value={form.amount||""} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} />
          <Select label="Reason Category" value={form.reason_category||""} onChange={e=>setForm(f=>({...f,reason_category:e.target.value}))} options={["Service not availed","Overpayment","Duplicate payment","Billing correction","Patient expired","Service discontinued","Other"]} />
          <Select label="Refund Mode" value={form.mode||"NEFT"} onChange={e=>setForm(f=>({...f,mode:e.target.value}))} options={["NEFT","UPI","Cheque"]} />
        </Grid>

        <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"14px 0 8px",letterSpacing:".06em" }}>RECIPIENT IDENTITY (RELATIVE / PAYEE)</div>
        <Grid cols={2}>
          <Input label="Relative / Payee Name" required value={form.relative_name||""} onChange={e=>setForm(f=>({...f,relative_name:e.target.value}))} />
          <Select label="Relationship" required value={form.relation||""} onChange={e=>setForm(f=>({...f,relation:e.target.value}))} options={["Self","Spouse","Son","Daughter","Father","Mother","Brother","Sister","Guardian","Other"]} />
          <Select label="ID Proof Type" value={form.govt_id_type||"Aadhaar"} onChange={e=>setForm(f=>({...f,govt_id_type:e.target.value}))} options={["Aadhaar","PAN","Voter ID","Passport","Driving Licence"]} />
          <Input label="ID Number (e.g., Aadhaar)" required value={form.govt_id_number||""} onChange={e=>setForm(f=>({...f,govt_id_number:e.target.value}))} />
          <Input label="Contact Mobile" value={form.contact||""} onChange={e=>setForm(f=>({...f,contact:e.target.value}))} />
        </Grid>

        <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"14px 0 8px",letterSpacing:".06em" }}>BANK / UPI DETAILS (PROVIDE EITHER)</div>
        <Grid cols={2}>
          <Input label="Account Holder Name" value={form.account_holder||""} onChange={e=>setForm(f=>({...f,account_holder:e.target.value}))} />
          <Input label="Bank Account Number" value={form.bank_account||""} onChange={e=>setForm(f=>({...f,bank_account:e.target.value}))} />
          <Input label="IFSC Code" value={form.ifsc||""} onChange={e=>setForm(f=>({...f,ifsc:e.target.value?.toUpperCase()}))} />
          <Input label="UPI ID (e.g., 9999999999@upi)" value={form.upi_id||""} onChange={e=>setForm(f=>({...f,upi_id:e.target.value}))} />
        </Grid>

        <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"14px 0 8px",letterSpacing:".06em" }}>DOCUMENT UPLOAD (FOR AUDIT)</div>
        <Grid cols={2}>
          <div>
            <label style={{ fontSize:12,fontWeight:600,color:C.textSub,display:"block",marginBottom:4 }}>ID Proof Scan / Photo</label>
            <input type="file" accept="image/*,application/pdf" onChange={e=>setIdProofFile(e.target.files?.[0]||null)} style={{ fontSize:12,padding:"6px 0" }} />
            {idProofFile && <div style={{ fontSize:11,color:C.green,marginTop:4 }}>✓ {idProofFile.name}</div>}
          </div>
          <div>
            <label style={{ fontSize:12,fontWeight:600,color:C.textSub,display:"block",marginBottom:4 }}>Cancelled Cheque (optional)</label>
            <input type="file" accept="image/*,application/pdf" onChange={e=>setChequeFile(e.target.files?.[0]||null)} style={{ fontSize:12,padding:"6px 0" }} />
            {chequeFile && <div style={{ fontSize:11,color:C.green,marginTop:4 }}>✓ {chequeFile.name}</div>}
          </div>
        </Grid>

        <Textarea label="Reason Details / Notes" value={form.reason||""} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} rows={2} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>{ setShowForm(false); setIdProofFile(null); setChequeFile(null); }}>Cancel</Btn>
          <Btn onClick={submitRefund} disabled={submitting}>{submitting?"Submitting…":"Initiate Refund"}</Btn>
        </div>
      </Modal>

      <Modal open={showApprove} title={`Process Refund — ${selected?.patient_name}`} onClose={()=>setShowApprove(false)}>
        <div style={{ background:C.bg,borderRadius:10,padding:12,marginBottom:14,fontSize:13 }}>
          <div>Amount: <strong>₹{(selected?.amount||0).toLocaleString("en-IN")}</strong> · Reason: <strong>{selected?.reason_category}</strong></div>
        </div>
        <Select label="Action" value={approveForm.level} onChange={e=>setApproveForm(f=>({...f,level:e.target.value}))} options={[{value:"verify",label:"Verify (Level 2)"},{value:"approve",label:"Approve & Process (Level 3)"}]} />
        {approveForm.level==="approve"&&<Input label="UTR / Transaction Reference" value={approveForm.utr} onChange={e=>setApproveForm(f=>({...f,utr:e.target.value}))} />}
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowApprove(false)}>Cancel</Btn>
          <Btn color={C.green} onClick={processApproval}>Confirm</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── AMBULANCE MODULE ─────────────────────────────────────────────────────────
function AmbulanceModule({ auth }) {
  const [calls, setCalls] = useState([]);
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [form, setForm] = useState({});
  const [selected, setSelected] = useState(null);
  const [updateForm, setUpdateForm] = useState({});

  function load() {
    const q=new URLSearchParams({ ...(filterType&&{call_type:filterType}), ...(filterStatus&&{status:filterStatus}) });
    auth(`/ambulance?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setCalls(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[filterType,filterStatus]);

  async function logCall() {
    const r=await auth("/ambulance",{ method:"POST", body:JSON.stringify(form) });
    const d=await r.json();
    alert(d.message); setShowForm(false); load();
  }

  async function updateCall() {
    const r=await auth(`/ambulance/${selected.id}`,{ method:"PATCH", body:JSON.stringify(updateForm) });
    const d=await r.json();
    alert(d.message); setShowUpdate(false); load();
  }

  const completed=calls.filter(c=>c.status==="Completed").length;
  const missed=calls.filter(c=>c.status==="Missed").length;
  const successRate=calls.length>0?((completed/calls.length)*100).toFixed(0):0;

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="🚑" label="Total Calls" value={calls.length} gradient={G.blue} />
        <StatCard icon="✅" label="Completed" value={completed} gradient={G.green} />
        <StatCard icon="❌" label="Missed" value={missed} gradient={G.red} />
        <StatCard icon="📊" label="Success Rate" value={`${successRate}%`} gradient={G.purple} />
      </div>
      <FilterBar>
        <select style={{...inp,minWidth:140}} value={filterType} onChange={e=>setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {["ALS","BLS","Patient Transport","Air","Rail","Last Journey"].map(t=><option key={t}>{t}</option>)}
        </select>
        <select style={{...inp,minWidth:140}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          {["Received","Dispatched","In Transit","Completed","Missed","Cancelled"].map(s=><option key={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setForm({ priority:"Normal" }); setShowForm(true); }}>+ Log Call</Btn></div>
      </FilterBar>
      <Card>
        <Table cols={[
          { label:"Call No.",render:c=><span style={{ fontFamily:"monospace",fontSize:11 }}>{c.call_number}</span> },
          { label:"Patient",render:c=><div><div style={{ fontWeight:600 }}>{c.patient_name}</div><div style={{ color:C.muted,fontSize:11 }}>{c.caller_mobile}</div></div> },
          { label:"Type",render:c=><Badge color="purple">{c.ambulance_type}</Badge> },
          { label:"Priority",render:c=><Badge color={c.priority==="Emergency"?"red":"gray"}>{c.priority}</Badge> },
          { label:"Pickup",render:c=><div style={{ maxWidth:160,fontSize:12 }}>{c.pickup_address}</div> },
          { label:"Status",render:c=><Badge color={statusColor(c.status)}>{c.status}</Badge> },
          { label:"Amount",render:c=>c.amount?`₹${c.amount.toLocaleString("en-IN")}`:"—" },
          { label:"",render:c=><Btn small onClick={e=>{ e.stopPropagation(); setSelected(c); setUpdateForm({ status:c.status }); setShowUpdate(true); }}>Update</Btn> },
        ]} rows={calls} />
      </Card>

      <Modal open={showForm} title="Log Ambulance Call" onClose={()=>setShowForm(false)} wide>
        <Grid cols={3}>
          <Input label="Caller Name" value={form.caller_name||""} onChange={e=>setForm(f=>({...f,caller_name:e.target.value}))} />
          <Input label="Caller Mobile" value={form.caller_mobile||""} onChange={e=>setForm(f=>({...f,caller_mobile:e.target.value}))} />
          <Input label="Patient Name" value={form.patient_name||""} onChange={e=>setForm(f=>({...f,patient_name:e.target.value}))} />
          <Select label="Ambulance Type" value={form.ambulance_type||""} onChange={e=>setForm(f=>({...f,ambulance_type:e.target.value}))} options={["ALS","BLS","Patient Transport","Air Ambulance","Rail Ambulance","Hearse Van"]} />
          <Select label="Call Type" value={form.call_type||""} onChange={e=>setForm(f=>({...f,call_type:e.target.value}))} options={["Local","Domestic","International"]} />
          <Select label="Priority" value={form.priority||"Normal"} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} options={["Emergency","Normal","Planned"]} />
          <Input label="Amount (₹)" type="number" value={form.amount||""} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} />
        </Grid>
        <Textarea label="Pickup Address" value={form.pickup_address||""} onChange={e=>setForm(f=>({...f,pickup_address:e.target.value}))} rows={2} />
        <Textarea label="Drop Address" value={form.drop_address||""} onChange={e=>setForm(f=>({...f,drop_address:e.target.value}))} rows={2} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={logCall}>Log Call</Btn>
        </div>
      </Modal>

      <Modal open={showUpdate} title={`Update — ${selected?.call_number}`} onClose={()=>setShowUpdate(false)}>
        <Grid cols={2}>
          <Select label="Status" value={updateForm.status||""} onChange={e=>setUpdateForm(f=>({...f,status:e.target.value}))} options={["Received","Dispatched","In Transit","Completed","Missed","Cancelled"]} />
          <Input label="Assigned Driver" value={updateForm.assigned_driver||""} onChange={e=>setUpdateForm(f=>({...f,assigned_driver:e.target.value}))} />
          <Input label="Vehicle No." value={updateForm.assigned_vehicle||""} onChange={e=>setUpdateForm(f=>({...f,assigned_vehicle:e.target.value}))} />
          <Input label="ETA" value={updateForm.eta||""} onChange={e=>setUpdateForm(f=>({...f,eta:e.target.value}))} />
        </Grid>
        {(updateForm.status==="Missed"||updateForm.status==="Cancelled")&&<Textarea label="Reason" value={updateForm.missed_reason||""} onChange={e=>setUpdateForm(f=>({...f,missed_reason:e.target.value}))} rows={2} />}
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowUpdate(false)}>Cancel</Btn>
          <Btn onClick={updateCall}>Update</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── ASSETS MODULE ────────────────────────────────────────────────────────────
function AssetsModule({ auth }) {
  const [assets, setAssets] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({});

  function load() { auth("/assets").then(r=>r.json()).then(d=>Array.isArray(d)&&setAssets(d)).catch(()=>{}); }
  useEffect(()=>{ load(); },[]);

  async function saveAsset() {
    const r=await auth("/assets",{ method:"POST", body:JSON.stringify(form) });
    const d=await r.json();
    alert(d.message); setShowForm(false); load();
  }

  return (
    <div>
      <FilterBar>
        <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setForm({ status:"Active",quantity:1 }); setShowForm(true); }}>+ Add Asset</Btn></div>
      </FilterBar>
      <Card>
        <Table cols={[
          { label:"Code",render:a=><span style={{ fontFamily:"monospace",fontSize:11,color:C.accent }}>{a.asset_code}</span> },
          { label:"Name",render:a=><div><div style={{ fontWeight:600 }}>{a.name}</div><div style={{ color:C.muted,fontSize:11 }}>{a.category}</div></div> },
          { label:"Vendor",key:"vendor" },
          { label:"Serial No.",key:"serial_number" },
          { label:"Location",key:"location" },
          { label:"Warranty",key:"warranty_expiry" },
          { label:"AMC",render:a=>a.amc_date?<span style={{ color:C.amber }}>{a.amc_date}</span>:"—" },
          { label:"Cost",render:a=>a.cost?`₹${a.cost.toLocaleString("en-IN")}`:"—" },
          { label:"Qty",key:"quantity" },
          { label:"Status",render:a=><Badge color={statusColor(a.status)}>{a.status}</Badge> },
        ]} rows={assets} />
      </Card>
      <Modal open={showForm} title="Add Asset" onClose={()=>setShowForm(false)} wide>
        <Grid cols={3}>
          <Input label="Asset Name" required value={form.name||""} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          <Select label="Category" value={form.category||""} onChange={e=>setForm(f=>({...f,category:e.target.value}))} options={["Medical Equipment","Furniture","Vehicle","IT Equipment","Office Supplies","Other"]} />
          <Input label="Vendor" value={form.vendor||""} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} />
          <Input label="Serial Number" value={form.serial_number||""} onChange={e=>setForm(f=>({...f,serial_number:e.target.value}))} />
          <Input label="Purchase Date" type="date" value={form.purchase_date||""} onChange={e=>setForm(f=>({...f,purchase_date:e.target.value}))} />
          <Input label="Warranty Expiry" type="date" value={form.warranty_expiry||""} onChange={e=>setForm(f=>({...f,warranty_expiry:e.target.value}))} />
          <Input label="AMC Date" type="date" value={form.amc_date||""} onChange={e=>setForm(f=>({...f,amc_date:e.target.value}))} />
          <Input label="CMC Date" type="date" value={form.cmc_date||""} onChange={e=>setForm(f=>({...f,cmc_date:e.target.value}))} />
          <Input label="Location" value={form.location||""} onChange={e=>setForm(f=>({...f,location:e.target.value}))} />
          <Input label="Quantity" type="number" value={form.quantity||1} onChange={e=>setForm(f=>({...f,quantity:e.target.value}))} />
          <Input label="Cost (₹)" type="number" value={form.cost||""} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} />
          <Select label="Status" value={form.status||"Active"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} options={["Active","In Repair","Disposed","Lent Out"]} />
        </Grid>
        <Textarea label="Notes" value={form.notes||""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={saveAsset}>Save Asset</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── VENDORS MODULE ───────────────────────────────────────────────────────────
function VendorsModule({ auth }) {
  const [vendors, setVendors] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});

  function load() { auth("/vendors").then(r=>r.json()).then(d=>Array.isArray(d)&&setVendors(d)).catch(()=>{}); }
  useEffect(()=>{ load(); },[]);

  async function saveVendor() {
    const method=selected?"PUT":"POST";
    const path=selected?`/vendors/${selected.id}`:"/vendors";
    const r=await auth(path,{ method, body:JSON.stringify(form) });
    const d=await r.json();
    alert(d.message); setShowForm(false); load();
  }

  async function deleteVendor() {
    const r=await auth(`/vendors/${selected.id}`,{ method:"DELETE" });
    const d=await r.json();
    alert(d.message); setShowDelete(false); load();
  }

  return (
    <div>
      <FilterBar>
        <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setSelected(null); setForm({}); setShowForm(true); }}>+ Add Vendor</Btn></div>
      </FilterBar>
      <Card>
        <Table cols={[
          { label:"Vendor",render:v=><div style={{ fontWeight:600 }}>{v.name}</div> },
          { label:"Type",render:v=><Badge color="blue">{v.type}</Badge> },
          { label:"Contact",key:"contact" },
          { label:"Email",key:"email" },
          { label:"Address",key:"address" },
          { label:"Status",render:v=><Badge color={statusColor(v.status)}>{v.status}</Badge> },
          { label:"Actions",render:v=>(
            <div style={{ display:"flex",gap:6 }}>
              <Btn small onClick={e=>{ e.stopPropagation(); setSelected(v); setForm({...v}); setShowForm(true); }}>✏️ Edit</Btn>
              <Btn small danger onClick={e=>{ e.stopPropagation(); setSelected(v); setShowDelete(true); }}>🗑️</Btn>
            </div>
          )},
        ]} rows={vendors} />
      </Card>
      <Modal open={showForm} title={selected?`Edit — ${selected.name}`:"Add Vendor"} onClose={()=>setShowForm(false)}>
        <Input label="Vendor Name" required value={form.name||""} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
        <Select label="Type" value={form.type||""} onChange={e=>setForm(f=>({...f,type:e.target.value}))} options={["Staffing","Equipment","Service","Diagnostic","Pharmacy","Other"]} />
        <Grid cols={2}>
          <Input label="Contact" value={form.contact||""} onChange={e=>setForm(f=>({...f,contact:e.target.value}))} />
          <Input label="Email" type="email" value={form.email||""} onChange={e=>setForm(f=>({...f,email:e.target.value}))} />
        </Grid>
        <Textarea label="Address" value={form.address||""} onChange={e=>setForm(f=>({...f,address:e.target.value}))} rows={2} />
        {selected&&<Select label="Status" value={form.status||"Active"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} options={["Active","Inactive"]} />}
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={saveVendor}>{selected?"Update":"Save"} Vendor</Btn>
        </div>
      </Modal>
      <Modal open={showDelete} title="Confirm Delete" onClose={()=>setShowDelete(false)}>
        <div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:16,marginBottom:14 }}>
          <p style={{ margin:0,color:C.red,fontWeight:600 }}>Delete <strong>{selected?.name}</strong>?</p>
          <p style={{ margin:"8px 0 0",fontSize:12,color:C.muted }}>Staff linked to this vendor will not be affected — their vendor field will appear empty.</p>
        </div>
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
          <Btn outline onClick={()=>setShowDelete(false)}>Cancel</Btn>
          <Btn danger onClick={deleteVendor}>Yes, Delete</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── PAYROLL MODULE ─────────────────────────────────────────────────────────
function PayrollModule({ auth }) {
  const [payroll, setPayroll] = useState([]);
  const [records, setRecords] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [tab, setTab] = useState("calculate");
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7));
  const [filterVendor, setFilterVendor] = useState("");
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payForm, setPayForm] = useState({ payment_mode:"Bank Transfer", payment_date: new Date().toISOString().split("T")[0] });

  function load() {
    const q = new URLSearchParams({ month, ...(filterVendor&&{vendor:filterVendor}) });
    auth(`/payroll?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setPayroll(d)).catch(()=>{});
    auth(`/payroll/records?month=${month}${filterVendor?`&vendor=${filterVendor}`:""}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setRecords(d)).catch(()=>{});
    auth("/vendors").then(r=>r.json()).then(d=>Array.isArray(d)&&setVendors(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[month, filterVendor]);

  async function generatePayroll() {
    if(!window.confirm(`Generate payroll for ${month}? This will calculate gross pay for all active staff based on attendance.`)) return;
    setGenerating(true);
    const r = await auth("/payroll/generate",{ method:"POST", body:JSON.stringify({ month }) });
    const d = await r.json();
    setGenerating(false);
    alert(d.message);
    load();
  }

  async function markPaid() {
    const r = await auth(`/payroll/${selected.payroll_id}/pay`,{ method:"PATCH", body:JSON.stringify(payForm) });
    const d = await r.json();
    alert(d.message); setShowPayForm(false); load();
  }

  const totalGross  = payroll.reduce((a,s)=>a+(s.gross_pay||0),0);
  const totalNet    = payroll.reduce((a,s)=>a+(s.net_pay||0),0);
  const totalDed    = payroll.reduce((a,s)=>a+(s.deductions||0),0);
  const paidCount   = records.filter(r=>r.payment_status==="Paid").length;

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="👥" label="Staff" value={payroll.length} gradient={G.blue} />
        <StatCard icon="💰" label="Gross Payable" value={`₹${(totalGross/1000).toFixed(1)}k`} gradient={G.green} />
        <StatCard icon="✂️" label="Deductions" value={`₹${(totalDed/1000).toFixed(1)}k`} gradient={G.amber} />
        <StatCard icon="💳" label="Net Payable" value={`₹${(totalNet/1000).toFixed(1)}k`} gradient={G.indigo} />
      </div>

      <FilterBar>
        <div style={{ display:"flex",gap:4,background:C.bg,padding:4,borderRadius:10 }}>
          {["calculate","records"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text }}>{t}</button>
          ))}
        </div>
        <Field label="Month">
          <input type="month" style={{...inp,minWidth:150}} value={month} onChange={e=>setMonth(e.target.value)} />
        </Field>
        <select style={{...inp,minWidth:180}} value={filterVendor} onChange={e=>setFilterVendor(e.target.value)}>
          <option value="">All Vendors</option>
          {vendors.map(v=><option key={v.id}>{v.name}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}>
          {tab==="calculate" && <Btn color={C.green} onClick={generatePayroll} disabled={generating}>{generating?"Generating…":"⚙️ Generate Payroll"}</Btn>}
        </div>
      </FilterBar>

      {tab==="calculate" && (
        <>
          <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#92400e" }}>
            📊 Formula: (Monthly Salary ÷ 26 working days) × Days Present. Deductions = 2% TDS placeholder. Click "Generate Payroll" to save official records.
          </div>
          <Card>
            <Table cols={[
              { label:"Staff",render:s=><div><div style={{ fontWeight:600 }}>{s.name}</div><div style={{ color:C.muted,fontSize:11 }}>{s.code} · {s.role}</div></div> },
              { label:"Vendor",render:s=><Badge color="gray">{s.vendor||"—"}</Badge> },
              { label:"Type",render:s=><Badge color="indigo">{s.employment_type||"—"}</Badge> },
              { label:"Present",render:s=><span style={{ fontWeight:600 }}>{s.present_days||0}<span style={{ color:C.muted,fontWeight:400 }}>/26</span></span> },
              { label:"Hours",render:s=>`${s.total_hours||0}h` },
              { label:"Bookings",key:"bookings_served" },
              { label:"Base Salary",render:s=>s.salary?<span style={{ color:C.muted,fontSize:12 }}>{s.salary}</span>:"—" },
              { label:"Gross Pay",render:s=><span style={{ fontWeight:700,color:C.green }}>₹{(s.gross_pay||0).toLocaleString("en-IN")}</span> },
              { label:"Deductions",render:s=><span style={{ color:C.red,fontSize:12 }}>-₹{(s.deductions||0).toLocaleString("en-IN")}</span> },
              { label:"Net Pay",render:s=><span style={{ fontWeight:800,color:C.primary,fontSize:14 }}>₹{(s.net_pay||0).toLocaleString("en-IN")}</span> },
              { label:"Payroll",render:s=>s.payroll_status
                ?<Badge color={s.payroll_status==="Paid"?"green":"amber"}>{s.payroll_status}</Badge>
                :<Badge color="gray">Not Generated</Badge>
              },
              { label:"",render:s=>s.payroll_id&&s.payroll_status!=="Paid"&&(
                <Btn small color={C.green} onClick={e=>{ e.stopPropagation(); setSelected(s); setPayForm({ payment_mode:"Bank Transfer", payment_date:new Date().toISOString().split("T")[0] }); setShowPayForm(true); }}>Mark Paid</Btn>
              )},
            ]} rows={payroll} />
          </Card>
        </>
      )}

      {tab==="records" && (
        <>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:12 }}>
            <StatCard icon="✅" label="Paid" value={paidCount} gradient={G.green} />
            <StatCard icon="⏳" label="Pending" value={records.length-paidCount} gradient={G.amber} />
            <StatCard icon="💳" label="Total Disbursed" value={`₹${(records.filter(r=>r.payment_status==="Paid").reduce((a,r)=>a+(r.net_pay||0),0)/1000).toFixed(1)}k`} gradient={G.indigo} />
          </div>
          <Card>
            <Table cols={[
              { label:"Staff",render:r=><div><div style={{ fontWeight:600 }}>{r.name}</div><div style={{ color:C.muted,fontSize:11 }}>{r.code} · {r.role}</div></div> },
              { label:"Vendor",render:r=><Badge color="gray">{r.vendor||"—"}</Badge> },
              { label:"Month",key:"month" },
              { label:"Days",key:"days_payable" },
              { label:"Hours",render:r=>`${r.total_hours||0}h` },
              { label:"Gross",render:r=>`₹${(r.gross_pay||0).toLocaleString("en-IN")}` },
              { label:"Deductions",render:r=><span style={{ color:C.red }}>-₹{(r.deductions||0).toLocaleString("en-IN")}</span> },
              { label:"Net Pay",render:r=><strong>₹{(r.net_pay||0).toLocaleString("en-IN")}</strong> },
              { label:"Bank",render:r=><span style={{ fontSize:11 }}>{r.bank_account||"—"}</span> },
              { label:"Status",render:r=><Badge color={r.payment_status==="Paid"?"green":"amber"}>{r.payment_status}</Badge> },
              { label:"Paid On",render:r=>r.payment_date||"—" },
            ]} rows={records} />
          </Card>
        </>
      )}

      <Modal open={showPayForm} title={`Mark Payment — ${selected?.name}`} onClose={()=>setShowPayForm(false)}>
        <div style={{ background:C.bg,borderRadius:10,padding:12,marginBottom:14,fontSize:13 }}>
          <div>Net Pay: <strong style={{ color:C.green,fontSize:16 }}>₹{(selected?.net_pay||0).toLocaleString("en-IN")}</strong></div>
          <div>Bank: <strong>{selected?.bank_account||"Not provided"}</strong></div>
          <div>IFSC: <strong>{selected?.ifsc||"—"}</strong></div>
        </div>
        <Select label="Payment Mode" value={payForm.payment_mode} onChange={e=>setPayForm(f=>({...f,payment_mode:e.target.value}))} options={["Bank Transfer","Cash","Cheque","UPI"]} />
        <Input label="Payment Date" type="date" value={payForm.payment_date} onChange={e=>setPayForm(f=>({...f,payment_date:e.target.value}))} />
        <Textarea label="Remarks" rows={2} value={payForm.remarks||""} onChange={e=>setPayForm(f=>({...f,remarks:e.target.value}))} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowPayForm(false)}>Cancel</Btn>
          <Btn color={C.green} onClick={markPaid}>Confirm Payment</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── MEDICAL CHARTS MODULE ────────────────────────────────────────────────────
function MedicalChartsModule({ auth }) {
  const [tab, setTab] = useState("vitals");
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [charts, setCharts] = useState([]);
  const [trends, setTrends] = useState({});
  const [latestVitals, setLatestVitals] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [form, setForm] = useState({});
  const [filterPatient, setFilterPatient] = useState("");

  useEffect(()=>{
    auth("/patients").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{});
    auth("/staff").then(r=>r.json()).then(d=>Array.isArray(d)&&setStaff(d)).catch(()=>{});
    auth("/medical-charts/latest-vitals").then(r=>r.json()).then(d=>Array.isArray(d)&&setLatestVitals(d)).catch(()=>{});
  },[]);

  useEffect(()=>{
    const q = new URLSearchParams({ chart_type:tab, ...(filterPatient&&{patient_id:filterPatient}) });
    auth(`/medical-charts?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setCharts(d)).catch(()=>{});
  },[tab,filterPatient]);

  function openTrends(patientId) {
    const p = patients.find(x=>x.id==patientId);
    setSelectedPatient(p);
    setShowTrends(true);
    auth(`/medical-charts/trends/${patientId}`).then(r=>r.json()).then(d=>setTrends(d)).catch(()=>{});
  }

  async function saveChart() {
    const r = await auth("/medical-charts",{ method:"POST", body:JSON.stringify({
      patient_id:form.patient_id, staff_id:form.staff_id,
      chart_type:tab, chart_data:JSON.stringify(form),
      visit_date:form.visit_date||new Date().toISOString().split("T")[0]
    })});
    const d = await r.json();
    alert(d.message); setShowForm(false);
    // Refresh
    const q = new URLSearchParams({ chart_type:tab, ...(filterPatient&&{patient_id:filterPatient}) });
    auth(`/medical-charts?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setCharts(d));
    auth("/medical-charts/latest-vitals").then(r=>r.json()).then(d=>Array.isArray(d)&&setLatestVitals(d));
  }

  const chartTabs=[
    { id:"vitals",label:"Vitals",icon:"❤️" },
    { id:"bp_sugar",label:"BP & Sugar",icon:"🩸" },
    { id:"intake_output",label:"I/O Chart",icon:"💧" },
    { id:"medication",label:"Medications",icon:"💊" },
    { id:"wound",label:"Wound Care",icon:"🩹" },
    { id:"nursing_notes",label:"Nursing Notes",icon:"📝" },
  ];

  // Parse chart data into readable columns per type
  function renderChartRow(c) {
    const d = c.data || {};
    if (tab==="vitals") return (
      <div style={{ display:"flex",gap:12,flexWrap:"wrap",fontSize:12 }}>
        {d.temperature&&<span>🌡️ <strong>{d.temperature}°F</strong></span>}
        {d.pulse&&<span>💓 <strong>{d.pulse} bpm</strong></span>}
        {d.spo2&&<span>🫁 <strong>SpO2: {d.spo2}%</strong></span>}
        {d.resp_rate&&<span>💨 <strong>RR: {d.resp_rate}</strong></span>}
        {d.weight&&<span>⚖️ <strong>{d.weight}kg</strong></span>}
        {d.pain_score!=null&&d.pain_score!==""&&<span style={{ color:d.pain_score>=7?C.red:d.pain_score>=4?C.amber:C.green }}>😣 Pain: <strong>{d.pain_score}/10</strong></span>}
      </div>
    );
    if (tab==="bp_sugar") return (
      <div style={{ display:"flex",gap:12,flexWrap:"wrap",fontSize:12 }}>
        {d.bp_systolic&&<span>🩺 <strong>{d.bp_systolic}/{d.bp_diastolic} mmHg</strong> {d.bp_position&&`(${d.bp_position})`}</span>}
        {d.fasting_sugar&&<span>🍬 Fasting: <strong style={{ color:d.fasting_sugar>126?C.red:d.fasting_sugar>100?C.amber:C.green }}>{d.fasting_sugar} mg/dL</strong></span>}
        {d.pp_sugar&&<span>🍽️ PP: <strong style={{ color:d.pp_sugar>200?C.red:d.pp_sugar>140?C.amber:C.green }}>{d.pp_sugar} mg/dL</strong></span>}
        {d.hba1c&&<span>📊 HbA1c: <strong>{d.hba1c}%</strong></span>}
      </div>
    );
    if (tab==="intake_output") return (
      <div style={{ display:"flex",gap:12,flexWrap:"wrap",fontSize:12 }}>
        {d.oral_intake&&<span>🥤 Oral: <strong>{d.oral_intake}ml</strong></span>}
        {d.iv_intake&&<span>💉 IV: <strong>{d.iv_intake}ml</strong></span>}
        {d.urine_output&&<span>🚽 Urine: <strong>{d.urine_output}ml</strong></span>}
        {d.bowel&&<span>Bowel: <Badge color={d.bowel==="Normal"?"green":"amber"}>{d.bowel}</Badge></span>}
        {(d.oral_intake||d.iv_intake)&&(d.urine_output)&&<span style={{ fontWeight:700,color:C.primary }}>
          Balance: {((parseFloat(d.oral_intake||0)+parseFloat(d.iv_intake||0))-parseFloat(d.urine_output||0)).toFixed(0)}ml
        </span>}
      </div>
    );
    if (tab==="medication") return (
      <div style={{ display:"flex",gap:12,flexWrap:"wrap",fontSize:12 }}>
        {d.medicine_name&&<span>💊 <strong>{d.medicine_name}</strong></span>}
        {d.dose&&<span>Dose: <strong>{d.dose}</strong></span>}
        {d.route&&<span>Route: <Badge color="indigo">{d.route}</Badge></span>}
        {d.given_at&&<span>⏰ {d.given_at}</span>}
        {d.med_status&&<Badge color={d.med_status==="Given"?"green":d.med_status==="Refused"?"red":"amber"}>{d.med_status}</Badge>}
      </div>
    );
    if (tab==="wound") return (
      <div style={{ display:"flex",gap:12,flexWrap:"wrap",fontSize:12 }}>
        {d.wound_location&&<span>📍 <strong>{d.wound_location}</strong></span>}
        {d.wound_stage&&<Badge color="amber">{d.wound_stage}</Badge>}
        {d.healing&&<Badge color={d.healing==="Improving"?"green":d.healing==="Deteriorating"?"red":"amber"}>{d.healing}</Badge>}
        {d.dressing_type&&<span>Dressing: <strong>{d.dressing_type}</strong></span>}
      </div>
    );
    if (tab==="nursing_notes") return <div style={{ fontSize:12,color:C.textSub,maxWidth:400 }}>{d.notes||c.chart_data}</div>;
    return <div style={{ fontSize:11,color:C.muted }}>{JSON.stringify(d).slice(0,80)}</div>;
  }

  // Trend data for recharts
  const vitalsTrend = (trends.vitals||[]).map(v=>({ date:v.date, Temp:v.temperature, Pulse:v.pulse, SpO2:v.spo2 }));
  const bpTrend = (trends.bp_sugar||[]).map(v=>({ date:v.date, Systolic:v.bp_systolic, Diastolic:v.bp_diastolic, Fasting:v.fasting_sugar }));

  return (
    <div>
      {/* Latest Vitals Dashboard Row */}
      {latestVitals.length>0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontWeight:700,fontSize:14,color:C.text,marginBottom:10 }}>📊 Latest Vitals — Active Patients</div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10 }}>
            {latestVitals.slice(0,6).map((v,i)=>{
              const d = v.data||{};
              return (
                <div key={i} style={{ background:C.card,borderRadius:12,padding:14,border:`1px solid ${C.border}`,cursor:"pointer" }}
                  onClick={()=>openTrends(v.patient_id)}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                    <div style={{ fontWeight:700,fontSize:13 }}>{v.patient_name}</div>
                    <span style={{ fontSize:11,color:C.muted }}>{v.visit_date}</span>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6 }}>
                    {d.temperature&&<div style={{ background:C.bg,borderRadius:8,padding:"6px 10px",textAlign:"center" }}><div style={{ fontSize:10,color:C.muted }}>TEMP</div><div style={{ fontWeight:700,fontSize:14,color:d.temperature>99.5?C.red:C.green }}>{d.temperature}°F</div></div>}
                    {d.pulse&&<div style={{ background:C.bg,borderRadius:8,padding:"6px 10px",textAlign:"center" }}><div style={{ fontSize:10,color:C.muted }}>PULSE</div><div style={{ fontWeight:700,fontSize:14,color:d.pulse>100||d.pulse<60?C.red:C.green }}>{d.pulse}</div></div>}
                    {d.spo2&&<div style={{ background:C.bg,borderRadius:8,padding:"6px 10px",textAlign:"center" }}><div style={{ fontSize:10,color:C.muted }}>SpO2</div><div style={{ fontWeight:700,fontSize:14,color:d.spo2<94?C.red:d.spo2<97?C.amber:C.green }}>{d.spo2}%</div></div>}
                    {d.pain_score!=null&&d.pain_score!==""&&<div style={{ background:C.bg,borderRadius:8,padding:"6px 10px",textAlign:"center" }}><div style={{ fontSize:10,color:C.muted }}>PAIN</div><div style={{ fontWeight:700,fontSize:14,color:d.pain_score>=7?C.red:d.pain_score>=4?C.amber:C.green }}>{d.pain_score}/10</div></div>}
                  </div>
                  <div style={{ fontSize:11,color:C.accent,marginTop:8,textAlign:"right" }}>View Trends →</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chart Tabs */}
      <div style={{ display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center" }}>
        {chartTabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"7px 14px",borderRadius:10,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,background:tab===t.id?C.accent:C.card,color:tab===t.id?"#fff":C.text,boxShadow:tab===t.id?"none":`0 0 0 1px ${C.border}` }}>
            {t.icon} {t.label}
          </button>
        ))}
        <div style={{ marginLeft:"auto",display:"flex",gap:8 }}>
          <select style={{...inp,minWidth:180}} value={filterPatient} onChange={e=>setFilterPatient(e.target.value)}>
            <option value="">All Patients</option>
            {patients.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {filterPatient && <Btn outline color={C.purple} onClick={()=>openTrends(filterPatient)}>📈 View Trends</Btn>}
          <Btn onClick={()=>{ setForm({ visit_date:new Date().toISOString().split("T")[0] }); setShowForm(true); }}>+ Add Entry</Btn>
        </div>
      </div>

      <Card>
        <Table cols={[
          { label:"Patient",render:c=><div style={{ fontWeight:600,fontSize:13 }}>{c.patient_name||patients.find(p=>p.id==c.patient_id)?.name||"—"}</div> },
          { label:"Date",render:c=><span style={{ fontWeight:600,fontSize:12 }}>{c.visit_date}</span> },
          { label:"Staff",render:c=><span style={{ fontSize:12,color:C.textSub }}>{c.staff_name||"—"}</span> },
          { label:"Reading",render:c=>renderChartRow(c) },
          { label:"",render:c=><Btn small outline color={C.purple} onClick={e=>{ e.stopPropagation(); openTrends(c.patient_id); }}>📈</Btn> },
        ]} rows={charts} />
      </Card>

      {/* Add Entry Modal */}
      <Modal open={showForm} title={`New ${chartTabs.find(t=>t.id===tab)?.label} Entry`} onClose={()=>setShowForm(false)} wide>
        <Grid cols={3}>
          <Select label="Patient" required value={form.patient_id||""} onChange={e=>setForm(f=>({...f,patient_id:e.target.value}))} options={patients.map(p=>({value:p.id,label:p.name}))} />
          <Select label="Staff" value={form.staff_id||""} onChange={e=>setForm(f=>({...f,staff_id:e.target.value}))} options={staff.map(s=>({value:s.id,label:s.name}))} />
          <Input label="Visit Date" type="date" value={form.visit_date||""} onChange={e=>setForm(f=>({...f,visit_date:e.target.value}))} />
        </Grid>
        {tab==="vitals"&&<Grid cols={3}>
          <Input label="Temperature (°F)" type="number" step="0.1" placeholder="98.6" value={form.temperature||""} onChange={e=>setForm(f=>({...f,temperature:e.target.value}))} />
          <Input label="Pulse (bpm)" type="number" placeholder="72" value={form.pulse||""} onChange={e=>setForm(f=>({...f,pulse:e.target.value}))} />
          <Input label="Resp. Rate (/min)" type="number" placeholder="16" value={form.resp_rate||""} onChange={e=>setForm(f=>({...f,resp_rate:e.target.value}))} />
          <Input label="SpO2 (%)" type="number" placeholder="98" value={form.spo2||""} onChange={e=>setForm(f=>({...f,spo2:e.target.value}))} />
          <Input label="Weight (kg)" type="number" step="0.1" value={form.weight||""} onChange={e=>setForm(f=>({...f,weight:e.target.value}))} />
          <Input label="Pain Score (0–10)" type="number" min="0" max="10" value={form.pain_score||""} onChange={e=>setForm(f=>({...f,pain_score:e.target.value}))} />
        </Grid>}
        {tab==="bp_sugar"&&<Grid cols={3}>
          <Input label="BP Systolic (mmHg)" type="number" placeholder="120" value={form.bp_systolic||""} onChange={e=>setForm(f=>({...f,bp_systolic:e.target.value}))} />
          <Input label="BP Diastolic (mmHg)" type="number" placeholder="80" value={form.bp_diastolic||""} onChange={e=>setForm(f=>({...f,bp_diastolic:e.target.value}))} />
          <Select label="Position" value={form.bp_position||""} onChange={e=>setForm(f=>({...f,bp_position:e.target.value}))} options={["Sitting","Lying","Standing"]} />
          <Input label="Fasting Sugar (mg/dL)" type="number" placeholder="100" value={form.fasting_sugar||""} onChange={e=>setForm(f=>({...f,fasting_sugar:e.target.value}))} />
          <Input label="PP Sugar (mg/dL)" type="number" placeholder="140" value={form.pp_sugar||""} onChange={e=>setForm(f=>({...f,pp_sugar:e.target.value}))} />
          <Input label="HbA1c (%)" type="number" step="0.1" placeholder="6.5" value={form.hba1c||""} onChange={e=>setForm(f=>({...f,hba1c:e.target.value}))} />
        </Grid>}
        {tab==="intake_output"&&<Grid cols={3}>
          <Input label="Oral Intake (ml)" type="number" value={form.oral_intake||""} onChange={e=>setForm(f=>({...f,oral_intake:e.target.value}))} />
          <Input label="IV Intake (ml)" type="number" value={form.iv_intake||""} onChange={e=>setForm(f=>({...f,iv_intake:e.target.value}))} />
          <Input label="Urine Output (ml)" type="number" value={form.urine_output||""} onChange={e=>setForm(f=>({...f,urine_output:e.target.value}))} />
          <Input label="Other Output (ml)" type="number" value={form.other_output||""} onChange={e=>setForm(f=>({...f,other_output:e.target.value}))} />
          <Select label="Bowel" value={form.bowel||""} onChange={e=>setForm(f=>({...f,bowel:e.target.value}))} options={["Normal","Constipated","Loose","Not Observed"]} />
          <Select label="Shift" value={form.shift||""} onChange={e=>setForm(f=>({...f,shift:e.target.value}))} options={["Morning","Afternoon","Evening","Night"]} />
        </Grid>}
        {tab==="medication"&&<Grid cols={2}>
          <Input label="Medicine Name" value={form.medicine_name||""} onChange={e=>setForm(f=>({...f,medicine_name:e.target.value}))} />
          <Input label="Dose" placeholder="e.g. 500mg" value={form.dose||""} onChange={e=>setForm(f=>({...f,dose:e.target.value}))} />
          <Input label="Route" placeholder="Oral / IV / IM / SC" value={form.route||""} onChange={e=>setForm(f=>({...f,route:e.target.value}))} />
          <Input label="Frequency" placeholder="BD / TDS / OD" value={form.frequency||""} onChange={e=>setForm(f=>({...f,frequency:e.target.value}))} />
          <Input label="Given At" type="time" value={form.given_at||""} onChange={e=>setForm(f=>({...f,given_at:e.target.value}))} />
          <Select label="Status" value={form.med_status||""} onChange={e=>setForm(f=>({...f,med_status:e.target.value}))} options={["Given","Held","Refused","Not Available"]} />
        </Grid>}
        {tab==="wound"&&<Grid cols={2}>
          <Input label="Wound Location" value={form.wound_location||""} onChange={e=>setForm(f=>({...f,wound_location:e.target.value}))} />
          <Select label="Wound Stage" value={form.wound_stage||""} onChange={e=>setForm(f=>({...f,wound_stage:e.target.value}))} options={["Stage 1","Stage 2","Stage 3","Stage 4","Unstageable"]} />
          <Select label="Size" value={form.wound_size||""} onChange={e=>setForm(f=>({...f,wound_size:e.target.value}))} options={["Small (<2cm)","Medium (2-5cm)","Large (>5cm)"]} />
          <Select label="Exudate" value={form.exudate||""} onChange={e=>setForm(f=>({...f,exudate:e.target.value}))} options={["None","Minimal","Moderate","Heavy"]} />
          <Select label="Dressing Type" value={form.dressing_type||""} onChange={e=>setForm(f=>({...f,dressing_type:e.target.value}))} options={["Dry","Wet","Hydrocolloid","Foam","Alginate","Silver"]} />
          <Select label="Healing" value={form.healing||""} onChange={e=>setForm(f=>({...f,healing:e.target.value}))} options={["Improving","Stable","Deteriorating"]} />
        </Grid>}
        {tab==="nursing_notes"&&<Textarea label="Nursing Notes" rows={6} placeholder="Document observations, patient condition, interventions, and any concerns…" value={form.notes||""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />}
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:16 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={saveChart}>Save Entry</Btn>
        </div>
      </Modal>

      {/* Trends Modal */}
      <Modal open={showTrends} title={`📈 Trends — ${selectedPatient?.name}`} onClose={()=>setShowTrends(false)} extraWide>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>
          {/* Vitals Trend */}
          {vitalsTrend.length>0 && (
            <div>
              <div style={{ fontWeight:700,marginBottom:12,fontSize:14 }}>❤️ Vitals Over Time</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={vitalsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="date" tick={{ fontSize:10 }} tickFormatter={d=>d.slice(5)} />
                  <YAxis tick={{ fontSize:10 }} />
                  <Tooltip />
                  <Legend iconSize={10} wrapperStyle={{ fontSize:11 }} />
                  <Line type="monotone" dataKey="Temp" stroke={C.red} strokeWidth={2} dot={{ r:3 }} />
                  <Line type="monotone" dataKey="Pulse" stroke={C.accent} strokeWidth={2} dot={{ r:3 }} />
                  <Line type="monotone" dataKey="SpO2" stroke={C.green} strokeWidth={2} dot={{ r:3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* BP Trend */}
          {bpTrend.length>0 && (
            <div>
              <div style={{ fontWeight:700,marginBottom:12,fontSize:14 }}>🩸 BP & Sugar Trend</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={bpTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="date" tick={{ fontSize:10 }} tickFormatter={d=>d.slice(5)} />
                  <YAxis tick={{ fontSize:10 }} />
                  <Tooltip />
                  <Legend iconSize={10} wrapperStyle={{ fontSize:11 }} />
                  <Line type="monotone" dataKey="Systolic" stroke={C.red} strokeWidth={2} dot={{ r:3 }} />
                  <Line type="monotone" dataKey="Diastolic" stroke={C.amber} strokeWidth={2} dot={{ r:3 }} />
                  <Line type="monotone" dataKey="Fasting" stroke={C.purple} strokeWidth={2} dot={{ r:3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {vitalsTrend.length===0 && bpTrend.length===0 && (
            <div style={{ gridColumn:"1/-1",textAlign:"center",padding:40,color:C.muted }}>
              <div style={{ fontSize:32,marginBottom:8 }}>📊</div>
              No trend data yet. Add chart entries to see trends.
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ─── CONSENT MODULE ───────────────────────────────────────────────────────────
// Template definitions per consent type — used to render dynamic form fields
const CONSENT_TEMPLATES = {
  "Ryle's Tube Insertion / Care": {
    sections: [
      { title:"NG Tube Insertion", fields:[
        { key:"indication", label:"Indication for NG Tube", type:"text" },
        { key:"tube_size", label:"Tube Size (Fr)", type:"text" },
        { key:"insertion_length", label:"Insertion Length (cm)", type:"text" },
        { key:"confirmation_method", label:"Confirmation Method", type:"select", options:["Auscultation","X-ray","Aspirate"] },
        { key:"aspirate_appearance", label:"Aspirate Appearance", type:"text" },
      ]},
      { title:"Tube Care", fields:[
        { key:"tube_secured", label:"Tube Secured Properly", type:"check" },
        { key:"feeding_type", label:"Feeding Type", type:"select", options:["Bolus","Continuous"] },
        { key:"flushing_done", label:"Flushing Done", type:"check" },
        { key:"tolerance", label:"Patient Tolerance", type:"text" },
      ]},
    ],
  },
  "Blood Sample Collection": {
    sections: [
      { title:"Sampling Details", fields:[
        { key:"site", label:"Site of Collection", type:"text" },
        { key:"collection_time", label:"Collection Time", type:"text" },
        { key:"num_pricks", label:"Number of Pricks", type:"number" },
        { key:"medium", label:"Used Medium", type:"select", options:["Vacutainer","Syringe"] },
      ]},
      { title:"Post Sampling Observation", fields:[
        { key:"oozing", label:"Oozing", type:"check" },
        { key:"bleeding", label:"Bleeding", type:"check" },
        { key:"hematoma", label:"Hematoma", type:"check" },
        { key:"bruising", label:"Bruising", type:"check" },
        { key:"remarks", label:"Remarks", type:"text" },
      ]},
      { title:"Sample Details", fields:[
        { key:"transportation", label:"Transportation", type:"text" },
        { key:"carrier", label:"Carrier", type:"text" },
        { key:"cold_pack", label:"Cold Pack", type:"check" },
        { key:"arrival_time", label:"Arrival Time", type:"text" },
      ]},
    ],
  },
  "IV Device Care": {
    sections: [
      { title:"Device Type", fields:[
        { key:"peripheral_iv_cannula", label:"Peripheral IV Cannula", type:"check" },
        { key:"picc_line", label:"PICC Line", type:"check" },
        { key:"central_venous_catheter", label:"Central Venous Catheter", type:"check" },
        { key:"implanted_port", label:"Implanted Port", type:"check" },
        { key:"midline_catheter", label:"Midline Catheter", type:"check" },
        { key:"other", label:"Other", type:"check" },
      ]},
      { title:"Details", fields:[
        { key:"device_detail", label:"Device Detail", type:"text" },
        { key:"insertion_date", label:"Insertion Date", type:"date" },
        { key:"insertion_site", label:"Insertion Site", type:"text" },
      ]},
    ],
  },
  "Wound Dressing Assessment": {
    sections: [
      { title:"Wound Info", fields:[
        { key:"wound_type", label:"Wound Type", type:"select", options:["Surgical","Pressure","Diabetic","Traumatic","Burn","Other"] },
        { key:"wound_location", label:"Location", type:"text" },
        { key:"length", label:"Length (cm)", type:"number" },
        { key:"width", label:"Width (cm)", type:"number" },
        { key:"depth", label:"Depth (cm)", type:"number" },
      ]},
      { title:"Assessment", fields:[
        { key:"wound_bed", label:"Wound Bed", type:"select", options:["Granulation","Slough","Necrotic","Epithelial"] },
        { key:"surrounding_skin", label:"Surrounding Skin", type:"select", options:["Normal","Redness","Swelling","Maceration"] },
        { key:"pain_score", label:"Pain Score (0-10)", type:"number" },
      ]},
      { title:"Procedure", fields:[
        { key:"hand_hygiene", label:"Hand Hygiene Done", type:"check" },
        { key:"cleaning_solution", label:"Cleaning Solution", type:"select", options:["NS","Betadine","Chlorhexidine","H2O2"] },
        { key:"medication", label:"Medication Applied", type:"text" },
        { key:"dressing_type", label:"Dressing Type", type:"select", options:["Gauze","Foam","Hydrocolloid","NPWT","Other"] },
        { key:"next_dressing_date", label:"Next Dressing Date", type:"date" },
      ]},
    ],
  },
  "Stoma Care": {
    sections: [
      { title:"Stoma Info", fields:[
        { key:"stoma_type", label:"Type of Stoma", type:"select", options:["Colostomy","Ileostomy","Urostomy","Other"] },
        { key:"surgery_date", label:"Date of Surgery", type:"date" },
        { key:"surgeon_name", label:"Surgeon Name", type:"text" },
      ]},
      { title:"Assessment", fields:[
        { key:"stoma_location", label:"Location", type:"text" },
        { key:"stoma_size", label:"Size", type:"text" },
        { key:"stoma_shape", label:"Shape", type:"select", options:["Round","Oval","Irregular"] },
        { key:"stoma_color", label:"Color", type:"select", options:["Pink","Red","Pale","Dusky","Black"] },
        { key:"output_type", label:"Output Type", type:"select", options:["Solid","Semi-solid","Liquid","Urine"] },
        { key:"peristomal_skin", label:"Peristomal Skin", type:"select", options:["Intact","Red","Irritated","Ulcerated"] },
      ]},
      { title:"Education", fields:[
        { key:"stoma_care_explained", label:"Stoma care explained", type:"check" },
        { key:"diet_advice_given", label:"Diet advice given", type:"check" },
        { key:"appliance_change_taught", label:"Appliance change taught", type:"check" },
        { key:"understanding", label:"Understanding Level", type:"select", options:["Good","Fair","Poor"] },
      ]},
    ],
  },
  "Suture Removal": {
    sections: [
      { title:"Clinical Info", fields:[
        { key:"diagnosis", label:"Diagnosis", type:"text" },
        { key:"wound_location", label:"Wound Location", type:"text" },
        { key:"suturing_date", label:"Date of Suturing", type:"date" },
        { key:"suture_type", label:"Type of Sutures", type:"text" },
        { key:"indication", label:"Indication", type:"text" },
      ]},
      { title:"Pre-Removal Assessment", fields:[
        { key:"wound_healing", label:"Wound Healing", type:"select", options:["Adequate","Delayed"] },
        { key:"infection_signs", label:"Signs of Infection", type:"check" },
        { key:"pain_score", label:"Pain Score (0-10)", type:"number" },
        { key:"allergies", label:"Allergies", type:"text" },
        { key:"medications", label:"Medications", type:"text" },
        { key:"bleeding_disorder", label:"Bleeding Disorder", type:"check" },
      ]},
    ],
  },
  "Supportive Healthcare Services": {
    sections: [
      { title:"Treatment & Discharge", fields:[
        { key:"doctor_name", label:"Treating Doctor", type:"text" },
        { key:"hospital_name", label:"Hospital", type:"text", defaultValue:"Sir Ganga Ram Hospital" },
        { key:"email", label:"Patient/Relative Email", type:"text" },
        { key:"normal_discharge", label:"Normal Discharge", type:"check" },
        { key:"discharge_on_request_dor_lama", label:"DOR / LAMA", type:"check" },
      ]},
      { title:"Services Requested", fields:[
        { key:"critical_care_nursing", label:"Critical Care Nursing", type:"check" },
        { key:"geriatric_care", label:"Geriatric Care", type:"check" },
        { key:"palliative_care_nursing", label:"Palliative Care Nursing", type:"check" },
        { key:"general_duty_assistant_gda", label:"General Duty Assistant (GDA)", type:"check" },
        { key:"nursing_support", label:"Nursing Support", type:"check" },
        { key:"mother_&_baby_care", label:"Mother & Baby Care", type:"check" },
        { key:"doctor_home_visit_pre-booked_routine_visit_only", label:"Doctor Home Visit (Pre-booked)", type:"check" },
      ]},
    ],
  },
  "General Consent": { sections: [] },
};
// BMW + Feedback fields applied across most procedure forms
const BMW_FIELDS = [
  { key:"bmw_segregated", label:"BMW: Waste Segregated", type:"check" },
  { key:"bmw_yellow_bag", label:"BMW: Yellow Bag Carried", type:"check" },
  { key:"bmw_disposed", label:"BMW: Disposed per Protocol", type:"check" },
];

function ConsentModule({ auth }) {
  const [consents, setConsents] = useState([]);
  const [patients, setPatients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ form_data:{} });
  const [filterType, setFilterType] = useState("");

  function load() {
    auth("/consents").then(r=>r.json()).then(d=>Array.isArray(d)&&setConsents(d)).catch(()=>{});
    auth("/patients").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[]);

  async function saveConsent() {
    if(!form.patient_id||!form.consent_type||!form.signed_by) return alert("Patient, Consent Type, and Signed By are required");
    const payload = { ...form, signed_at: new Date().toISOString() };
    const r=await auth("/consents",{ method:"POST", body:JSON.stringify(payload) });
    const d=await r.json();
    if(d.id){
      alert(d.message + " — generating PDF…");
      setShowForm(false);
      load();
      // Auto-download the new PDF
      setTimeout(()=>downloadPdf(`/pdf/consent/${d.id}`, `consent-${d.id}-${form.consent_type.replace(/[^a-z0-9]/gi,'-')}.pdf`), 600);
    } else {
      alert(d.message || "Error");
    }
  }

  const consentTypes = Object.keys(CONSENT_TEMPLATES);
  const tpl = CONSENT_TEMPLATES[form.consent_type] || { sections:[] };
  const showBmw = form.consent_type && !["General Consent","Supportive Healthcare Services"].includes(form.consent_type);
  const filteredConsents = filterType ? consents.filter(c=>c.consent_type===filterType) : consents;

  const updateFd = (key,val) => setForm(f=>({ ...f, form_data:{ ...(f.form_data||{}), [key]:val }}));

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="✍️" label="Total Consents" value={consents.length} gradient={G.blue} />
        <StatCard icon="✅" label="Signed" value={consents.filter(c=>c.status==="Signed").length} gradient={G.green} />
        <StatCard icon="👥" label="Patients Covered" value={new Set(consents.map(c=>c.patient_id)).size} gradient={G.indigo} />
        <StatCard icon="📋" label="Templates" value={consentTypes.length} gradient={G.purple} />
      </div>
      <FilterBar>
        <select data-testid="filter-consent-type" style={{...inp,minWidth:240}} value={filterType} onChange={e=>setFilterType(e.target.value)}>
          <option value="">All Consent Types</option>
          {consentTypes.map(t=><option key={t}>{t}</option>)}
        </select>
        <div style={{ marginLeft:"auto",display:"flex",gap:8 }}>
          <Btn data-testid="generate-consent-btn" onClick={()=>{ setForm({ form_data:{}, signed_at:new Date().toISOString() }); setShowForm(true); }}>📋 Generate Consent</Btn>
        </div>
      </FilterBar>
      <Card>
        <Table cols={[
          { label:"Patient",key:"patient_name" },
          { label:"Consent Type",render:c=><Badge color="blue">{c.consent_type}</Badge> },
          { label:"Signed By",key:"signed_by" },
          { label:"Relation",key:"relation" },
          { label:"Status",render:c=><Badge color="green">{c.status}</Badge> },
          { label:"Date",render:c=>c.created_at?.split("T")[0] },
          { label:"",render:c=><Btn small outline color={C.indigo} data-testid={`consent-pdf-${c.id}`} onClick={()=>downloadPdf(`/pdf/consent/${c.id}`, `consent-${c.id}.pdf`)}>📄 PDF</Btn> },
        ]} rows={filteredConsents} />
      </Card>

      <Modal open={showForm} title="📋 Generate Consent" onClose={()=>setShowForm(false)} extraWide>
        <AlertBanner type="info" icon="ℹ️" title="Patient details auto-fill from records. Fill clinical fields below — blanks render as fillable lines on the PDF." />
        <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"6px 0",letterSpacing:".06em" }}>STEP 1 — PATIENT & CONSENT TYPE</div>
        <Grid cols={2}>
          <Select label="Patient" required data-testid="consent-patient-select" value={form.patient_id||""} onChange={e=>{ const p=patients.find(x=>x.id==e.target.value); setForm(f=>({...f,patient_id:e.target.value,patient_name:p?.name||""})); }} options={patients.map(p=>({value:p.id,label:`${p.name} (${p.reg_number})`}))} />
          <Select label="Consent Type" required data-testid="consent-type-select" value={form.consent_type||""} onChange={e=>{
            const newType = e.target.value;
            // Apply default values from template
            const defaults = {};
            (CONSENT_TEMPLATES[newType]?.sections||[]).forEach(sec=>sec.fields.forEach(fl=>{ if(fl.defaultValue!==undefined) defaults[fl.key]=fl.defaultValue; }));
            setForm(f=>({...f, consent_type:newType, form_data:{ ...(f.form_data||{}), ...defaults }}));
          }} options={consentTypes} />
        </Grid>

        <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"14px 0 6px",letterSpacing:".06em" }}>STEP 2 — SIGNATORY</div>
        <Grid cols={3}>
          <Input label="Signed By (Name)" required data-testid="consent-signed-by" value={form.signed_by||""} onChange={e=>setForm(f=>({...f,signed_by:e.target.value}))} />
          <Select label="Relation" value={form.relation||"Self"} onChange={e=>setForm(f=>({...f,relation:e.target.value}))} options={["Self","Spouse","Son","Daughter","Father","Mother","Brother","Sister","Guardian","Other"]} />
          <Input label="Witness Name" value={form.witness_name||""} onChange={e=>setForm(f=>({...f,witness_name:e.target.value}))} />
          <Input label="Done By (Nurse/Clinician)" value={form.done_by||""} onChange={e=>setForm(f=>({...f,done_by:e.target.value}))} />
          <Input label="Designation" value={form.designation||""} onChange={e=>setForm(f=>({...f,designation:e.target.value}))} />
          <Input label="Supervisor (optional)" value={form.supervisor_name||""} onChange={e=>setForm(f=>({...f,supervisor_name:e.target.value}))} />
        </Grid>

        {/* Dynamic clinical fields per template */}
        {tpl.sections.length>0 && tpl.sections.map((sec,i)=>(
          <div key={i}>
            <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"14px 0 6px",letterSpacing:".06em" }}>STEP {i+3} — {sec.title.toUpperCase()}</div>
            <Grid cols={sec.fields.some(f=>f.type==="check")?3:2}>
              {sec.fields.map(fl=>{
                const val = form.form_data?.[fl.key];
                if(fl.type==="check"){
                  return <label key={fl.key} style={{ display:"flex",alignItems:"center",gap:8,fontSize:13,padding:"6px 0" }}>
                    <input type="checkbox" data-testid={`fd-${fl.key}`} checked={!!val} onChange={e=>updateFd(fl.key,e.target.checked)} />
                    <span>{fl.label}</span>
                  </label>;
                }
                if(fl.type==="select"){
                  return <Select key={fl.key} label={fl.label} value={val||""} onChange={e=>updateFd(fl.key,e.target.value)} options={fl.options||[]} />;
                }
                if(fl.type==="date"){
                  return <Input key={fl.key} label={fl.label} type="date" value={val||""} onChange={e=>updateFd(fl.key,e.target.value)} />;
                }
                if(fl.type==="number"){
                  return <Input key={fl.key} label={fl.label} type="number" value={val||""} onChange={e=>updateFd(fl.key,e.target.value)} />;
                }
                return <Input key={fl.key} label={fl.label} value={val||""} onChange={e=>updateFd(fl.key,e.target.value)} />;
              })}
            </Grid>
          </div>
        ))}

        {showBmw && (
          <>
            <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"14px 0 6px",letterSpacing:".06em" }}>BIOMEDICAL WASTE MANAGEMENT (BMW)</div>
            <Grid cols={3}>
              {BMW_FIELDS.map(fl=>(
                <label key={fl.key} style={{ display:"flex",alignItems:"center",gap:8,fontSize:13,padding:"6px 0" }}>
                  <input type="checkbox" data-testid={`fd-${fl.key}`} checked={!!form.form_data?.[fl.key]} onChange={e=>updateFd(fl.key,e.target.checked)} />
                  <span>{fl.label}</span>
                </label>
              ))}
            </Grid>
          </>
        )}

        {form.consent_type && (
          <>
            <div style={{ fontWeight:700,fontSize:12,color:C.textSub,margin:"14px 0 6px",letterSpacing:".06em" }}>PATIENT / FAMILY FEEDBACK (OPTIONAL)</div>
            <Textarea label="" rows={2} placeholder="Captured at time of service…" value={form.form_data?.feedback||""} onChange={e=>updateFd("feedback",e.target.value)} />
          </>
        )}

        <Textarea label="Internal Notes" rows={2} value={form.notes||""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />

        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}` }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn data-testid="consent-save-and-pdf" onClick={saveConsent}>💾 Save & Generate PDF</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── FEEDBACK MODULE ──────────────────────────────────────────────────────────
function FeedbackModule({ auth }) {
  const [feedback, setFeedback] = useState([]);
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({});

  function load() {
    auth("/feedback").then(r=>r.json()).then(d=>Array.isArray(d)&&setFeedback(d)).catch(()=>{});
    auth("/patients").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{});
    auth("/staff").then(r=>r.json()).then(d=>Array.isArray(d)&&setStaff(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[]);

  async function saveFeedback() {
    const r=await auth("/feedback",{ method:"POST", body:JSON.stringify(form) });
    const d=await r.json();
    alert(d.message); setShowForm(false); load();
  }

  const avgOverall=feedback.length?(feedback.reduce((a,f)=>a+(parseFloat(f.overall_rating)||0),0)/feedback.length).toFixed(1):"—";
  const recommend=feedback.length?Math.round(feedback.filter(f=>f.recommend==="Yes").length/feedback.length*100):0;
  const nps=feedback.filter(f=>f.overall_rating>=4).length-feedback.filter(f=>f.overall_rating<=2).length;

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="⭐" label="Avg Rating" value={avgOverall} gradient={G.amber} />
        <StatCard icon="👍" label="Recommend %" value={`${recommend}%`} gradient={G.green} />
        <StatCard icon="📊" label="NPS Score" value={nps} gradient={G.blue} />
        <StatCard icon="💬" label="Responses" value={feedback.length} gradient={G.indigo} />
      </div>
      <FilterBar>
        <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setForm({}); setShowForm(true); }}>+ Record Feedback</Btn></div>
      </FilterBar>
      <Card>
        <Table cols={[
          { label:"Patient",key:"patient_name" },
          { label:"Staff",render:f=>staff.find(s=>s.id==f.staff_id)?.name||"—" },
          { label:"Overall",render:f=><span style={{ color:"#f59e0b",fontWeight:700 }}>{"★".repeat(Math.round(f.overall_rating||0))} <span style={{ color:C.muted,fontWeight:400 }}>{f.overall_rating}</span></span> },
          { label:"Staff Rating",render:f=>`${f.staff_rating||"—"}/5` },
          { label:"Punctuality",render:f=>`${f.punctuality_rating||"—"}/5` },
          { label:"Recommend",render:f=><Badge color={f.recommend==="Yes"?"green":"red"}>{f.recommend}</Badge> },
          { label:"Comments",render:f=><div style={{ maxWidth:200,fontSize:12,color:C.muted }}>{f.comments}</div> },
          { label:"Date",render:f=>f.created_at?.split("T")[0] },
        ]} rows={feedback} />
      </Card>
      <Modal open={showForm} title="Record Feedback" onClose={()=>setShowForm(false)} wide>
        <Grid cols={2}>
          <Select label="Patient" required value={form.patient_id||""} onChange={e=>{ const p=patients.find(x=>x.id==e.target.value); setForm(f=>({...f,patient_id:e.target.value,patient_name:p?.name||""})); }} options={patients.map(p=>({value:p.id,label:p.name}))} />
          <Select label="Staff Being Rated" value={form.staff_id||""} onChange={e=>setForm(f=>({...f,staff_id:e.target.value}))} options={staff.map(s=>({value:s.id,label:s.name}))} />
          <Select label="Overall Rating" required value={form.overall_rating||""} onChange={e=>setForm(f=>({...f,overall_rating:e.target.value}))} options={[{value:5,label:"5 - Excellent"},{value:4,label:"4 - Good"},{value:3,label:"3 - Average"},{value:2,label:"2 - Poor"},{value:1,label:"1 - Very Poor"}]} />
          <Select label="Staff Behaviour" value={form.staff_rating||""} onChange={e=>setForm(f=>({...f,staff_rating:e.target.value}))} options={["5","4","3","2","1"]} />
          <Select label="Punctuality" value={form.punctuality_rating||""} onChange={e=>setForm(f=>({...f,punctuality_rating:e.target.value}))} options={["5","4","3","2","1"]} />
          <Select label="Service Quality" value={form.service_rating||""} onChange={e=>setForm(f=>({...f,service_rating:e.target.value}))} options={["5","4","3","2","1"]} />
          <Select label="Would Recommend?" required value={form.recommend||""} onChange={e=>setForm(f=>({...f,recommend:e.target.value}))} options={["Yes","No","Maybe"]} />
          <Input label="Submitted By" value={form.submitted_by||""} onChange={e=>setForm(f=>({...f,submitted_by:e.target.value}))} />
        </Grid>
        <Textarea label="Comments" rows={3} value={form.comments||""} onChange={e=>setForm(f=>({...f,comments:e.target.value}))} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn onClick={saveFeedback}>Submit Feedback</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── TRAINING & MCQ MODULE ────────────────────────────────────────────────────
function TrainingMCQModule({ auth }) {
  const [tab, setTab] = useState("training");
  const [training, setTraining] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [results, setResults] = useState([]);
  const [staff, setStaff] = useState([]);
  const [showTrainForm, setShowTrainForm] = useState(false);
  const [showQForm, setShowQForm] = useState(false);
  const [trainForm, setTrainForm] = useState({});
  const [qForm, setQForm] = useState({});
  const [examForm, setExamForm] = useState({ staff_id:"", topic:"" });
  const [examAnswers, setExamAnswers] = useState({});
  const [examResult, setExamResult] = useState(null);
  const [filterTopic, setFilterTopic] = useState("");

  const topics=["Patient Care Basics","Infection Control","CPR & First Aid","Medication Administration","Wound Care","Documentation","Ethics & Conduct","COVID Protocol","Fire Safety","Equipment Usage"];

  function load() {
    auth("/training").then(r=>r.json()).then(d=>Array.isArray(d)&&setTraining(d)).catch(()=>{});
    auth("/staff").then(r=>r.json()).then(d=>Array.isArray(d)&&setStaff(d)).catch(()=>{});
    auth("/mcq/results").then(r=>r.json()).then(d=>Array.isArray(d)&&setResults(d)).catch(()=>{});
    const q=filterTopic?`?topic=${filterTopic}`:"";
    auth(`/mcq/questions${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setQuestions(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[filterTopic]);

  async function saveTraining() {
    const r=await auth("/training",{ method:"POST", body:JSON.stringify(trainForm) });
    const d=await r.json();
    alert(d.message); setShowTrainForm(false); load();
  }

  async function saveQuestion() {
    const r=await auth("/mcq/questions",{ method:"POST", body:JSON.stringify(qForm) });
    const d=await r.json();
    alert(d.message); setShowQForm(false); setQForm({}); load();
  }

  async function deleteQuestion(id) {
    if(!window.confirm("Delete this question?")) return;
    await auth(`/mcq/questions/${id}`,{ method:"DELETE" });
    load();
  }

  async function submitExam() {
    if(!examForm.staff_id||!examForm.topic) return alert("Select staff and topic first");
    const r=await auth("/mcq/submit",{ method:"POST", body:JSON.stringify({ staff_id:examForm.staff_id, topic:examForm.topic, answers:examAnswers }) });
    const d=await r.json();
    setExamResult(d);
  }

  const examQuestions=questions.filter(q=>q.topic===examForm.topic);

  return (
    <div>
      <div style={{ display:"flex",gap:4,background:C.card,padding:4,borderRadius:12,border:`1px solid ${C.border}`,marginBottom:16,width:"fit-content" }}>
        {["training","questions","exam","results"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"7px 18px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text,transition:"all 0.15s" }}>{t}</button>
        ))}
      </div>

      {tab==="training"&&(
        <>
          <FilterBar><div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setTrainForm({}); setShowTrainForm(true); }}>+ Log Training</Btn></div></FilterBar>
          <Card>
            <Table cols={[
              { label:"Staff",key:"staff_name" },
              { label:"Topic",render:t=><Badge color="blue">{t.topic}</Badge> },
              { label:"Trainer",key:"trainer" },
              { label:"Date",key:"date" },
              { label:"Duration",render:t=>`${t.duration_mins||0} mins` },
              { label:"Score",render:t=>t.test_score!=null?<Badge color={t.test_score>=60?"green":"red"}>{t.test_score}%</Badge>:<span style={{ color:C.muted }}>Not taken</span> },
            ]} rows={training} />
          </Card>
        </>
      )}

      {tab==="questions"&&(
        <>
          <FilterBar>
            <select style={{...inp,minWidth:200}} value={filterTopic} onChange={e=>setFilterTopic(e.target.value)}>
              <option value="">All Topics</option>
              {topics.map(t=><option key={t}>{t}</option>)}
            </select>
            <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setQForm({}); setShowQForm(true); }}>+ Add Question</Btn></div>
          </FilterBar>
          <Card>
            <Table cols={[
              { label:"Topic",render:q=><Badge color="blue">{q.topic}</Badge> },
              { label:"Question",render:q=><div style={{ maxWidth:280,fontSize:13 }}>{q.question}</div> },
              { label:"Options",render:q=>(
                <div style={{ fontSize:11,lineHeight:1.9 }}>
                  {["A","B","C","D"].map(opt=>(
                    <div key={opt} style={{ color:q.correct_option===opt?C.green:C.muted,fontWeight:q.correct_option===opt?700:400 }}>
                      {q.correct_option===opt?"✓":"  "} {opt}. {q[`option_${opt.toLowerCase()}`]}
                    </div>
                  ))}
                </div>
              )},
              { label:"Answer",render:q=><Badge color="green">{q.correct_option}</Badge> },
              { label:"",render:q=><Btn small danger onClick={()=>deleteQuestion(q.id)}>Delete</Btn> },
            ]} rows={questions} />
          </Card>
        </>
      )}

      {tab==="exam"&&(
        <div style={{ maxWidth:700 }}>
          {!examResult?(
            <>
              <Card style={{ padding:20,marginBottom:16 }}>
                <Grid cols={2}>
                  <Select label="Staff Member" required value={examForm.staff_id} onChange={e=>{ setExamForm(f=>({...f,staff_id:e.target.value})); setExamAnswers({}); }} options={staff.map(s=>({value:s.id,label:`${s.code} - ${s.name}`}))} />
                  <Select label="Topic" required value={examForm.topic} onChange={e=>{ setExamForm(f=>({...f,topic:e.target.value})); setExamAnswers({}); }} options={topics} />
                </Grid>
              </Card>
              {examQuestions.length>0&&(
                <>
                  {examQuestions.map((q,i)=>(
                    <Card key={q.id} style={{ padding:20,marginBottom:12 }}>
                      <div style={{ fontWeight:700,marginBottom:14,fontSize:14 }}>Q{i+1}. {q.question}</div>
                      {["A","B","C","D"].map(opt=>(
                        <label key={opt} style={{ display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:10,marginBottom:6,cursor:"pointer",background:examAnswers[q.id]===opt?"#eff6ff":C.bg,border:`1.5px solid ${examAnswers[q.id]===opt?C.accent:C.border}`,transition:"all 0.15s" }}>
                          <input type="radio" name={`q${q.id}`} value={opt} checked={examAnswers[q.id]===opt} onChange={()=>setExamAnswers(a=>({...a,[q.id]:opt}))} style={{ accentColor:C.accent }}/>
                          <span style={{ fontSize:13 }}><strong>{opt}.</strong> {q[`option_${opt.toLowerCase()}`]}</span>
                        </label>
                      ))}
                    </Card>
                  ))}
                  <Btn full onClick={submitExam}>Submit Exam ({examQuestions.length} Questions)</Btn>
                </>
              )}
              {examForm.topic&&examQuestions.length===0&&<Card style={{ padding:32,textAlign:"center",color:C.muted }}>No questions for this topic. Add questions in the Questions tab first.</Card>}
            </>
          ):(
            <Card style={{ padding:40,textAlign:"center" }}>
              <div style={{ fontSize:64,marginBottom:12 }}>{examResult.score>=60?"🎉":"📚"}</div>
              <div style={{ fontSize:40,fontWeight:800,color:examResult.score>=60?C.green:C.red,marginBottom:4 }}>{examResult.score}%</div>
              <div style={{ fontSize:16,color:C.text,marginBottom:4 }}>{examResult.correct}/{examResult.total} correct</div>
              <div style={{ marginBottom:24 }}><Badge color={examResult.score>=60?"green":"red"}>{examResult.score>=60?"PASSED":"FAILED"}</Badge></div>
              <Btn onClick={()=>{ setExamResult(null); setExamAnswers({}); }}>Take Another Exam</Btn>
            </Card>
          )}
        </div>
      )}

      {tab==="results"&&(
        <Card>
          <Table cols={[
            { label:"Staff",key:"staff_name" },
            { label:"Topic",key:"topic" },
            { label:"Score",render:r=><span style={{ fontWeight:700,color:r.score>=60?C.green:C.red }}>{r.score}%</span> },
            { label:"Correct",render:r=>`${r.correct}/${r.total}` },
            { label:"Result",render:r=><Badge color={r.score>=60?"green":"red"}>{r.score>=60?"Pass":"Fail"}</Badge> },
            { label:"Date",render:r=>r.submitted_at?.split("T")[0] },
          ]} rows={results} />
        </Card>
      )}

      <Modal open={showTrainForm} title="Log Training Session" onClose={()=>setShowTrainForm(false)}>
        <Grid cols={2}>
          <Select label="Staff" required value={trainForm.staff_id||""} onChange={e=>setTrainForm(f=>({...f,staff_id:e.target.value}))} options={staff.map(s=>({value:s.id,label:`${s.code} - ${s.name}`}))} />
          <Select label="Topic" value={trainForm.topic||""} onChange={e=>setTrainForm(f=>({...f,topic:e.target.value}))} options={topics} />
          <Input label="Trainer" value={trainForm.trainer||""} onChange={e=>setTrainForm(f=>({...f,trainer:e.target.value}))} />
          <Input label="Date" type="date" value={trainForm.date||""} onChange={e=>setTrainForm(f=>({...f,date:e.target.value}))} />
          <Input label="Duration (mins)" type="number" value={trainForm.duration_mins||""} onChange={e=>setTrainForm(f=>({...f,duration_mins:e.target.value}))} />
        </Grid>
        <Textarea label="Notes" value={trainForm.notes||""} onChange={e=>setTrainForm(f=>({...f,notes:e.target.value}))} rows={2} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowTrainForm(false)}>Cancel</Btn>
          <Btn onClick={saveTraining}>Save</Btn>
        </div>
      </Modal>

      <Modal open={showQForm} title="Add MCQ Question" onClose={()=>setShowQForm(false)} wide>
        <Grid cols={2}>
          <Select label="Topic" required value={qForm.topic||""} onChange={e=>setQForm(f=>({...f,topic:e.target.value}))} options={topics} />
          <Input label="Marks" type="number" value={qForm.marks||1} onChange={e=>setQForm(f=>({...f,marks:e.target.value}))} />
        </Grid>
        <Textarea label="Question" required rows={2} value={qForm.question||""} onChange={e=>setQForm(f=>({...f,question:e.target.value}))} />
        <Grid cols={2}>
          <Input label="Option A" value={qForm.option_a||""} onChange={e=>setQForm(f=>({...f,option_a:e.target.value}))} />
          <Input label="Option B" value={qForm.option_b||""} onChange={e=>setQForm(f=>({...f,option_b:e.target.value}))} />
          <Input label="Option C" value={qForm.option_c||""} onChange={e=>setQForm(f=>({...f,option_c:e.target.value}))} />
          <Input label="Option D" value={qForm.option_d||""} onChange={e=>setQForm(f=>({...f,option_d:e.target.value}))} />
        </Grid>
        <Select label="Correct Answer" required value={qForm.correct_option||""} onChange={e=>setQForm(f=>({...f,correct_option:e.target.value}))} options={["A","B","C","D"]} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowQForm(false)}>Cancel</Btn>
          <Btn onClick={saveQuestion}>Add Question</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── INCIDENTS MODULE ─────────────────────────────────────────────────────────
function IncidentsModule({ auth }) {
  const [incidents, setIncidents] = useState([]);
  const [staff, setStaff] = useState([]);
  const [patients, setPatients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [form, setForm] = useState({});
  const [selected, setSelected] = useState(null);
  const [updateForm, setUpdateForm] = useState({});
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");

  function load() {
    auth("/incidents").then(r=>r.json()).then(d=>Array.isArray(d)&&setIncidents(d)).catch(()=>{});
    auth("/staff").then(r=>r.json()).then(d=>Array.isArray(d)&&setStaff(d)).catch(()=>{});
    auth("/patients").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[]);

  const filtered=incidents.filter(i=>(!filterStatus||i.status===filterStatus)&&(!filterSeverity||i.severity===filterSeverity));

  async function saveIncident() {
    const r=await auth("/incidents",{ method:"POST", body:JSON.stringify(form) });
    const d=await r.json();
    alert(d.message); setShowForm(false); setForm({}); load();
  }

  async function updateIncident() {
    const r=await auth(`/incidents/${selected.id}`,{ method:"PUT", body:JSON.stringify(updateForm) });
    const d=await r.json();
    alert(d.message); setShowUpdate(false); load();
  }

  const incidentTypes=["Patient Fall","Medication Error","Equipment Failure","Staff Misconduct","Late Reporting","Patient Complaint","Documentation Error","Infection Control Breach","Emergency","Other"];
  const severities=["Low","Medium","High","Critical"];

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="🚨" label="Total" value={incidents.length} gradient={G.blue} />
        <StatCard icon="🔴" label="Open" value={incidents.filter(i=>i.status==="Open").length} gradient={G.red} />
        <StatCard icon="✅" label="Closed" value={incidents.filter(i=>i.status==="Closed").length} gradient={G.green} />
        <StatCard icon="⚠️" label="High/Critical" value={incidents.filter(i=>i.severity==="High"||i.severity==="Critical").length} gradient={G.amber} />
      </div>
      <FilterBar>
        <select style={{...inp,minWidth:140}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {["Open","In Progress","Resolved","Closed"].map(s=><option key={s}>{s}</option>)}
        </select>
        <select style={{...inp,minWidth:140}} value={filterSeverity} onChange={e=>setFilterSeverity(e.target.value)}>
          <option value="">All Severities</option>
          {severities.map(s=><option key={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft:"auto" }}><Btn danger onClick={()=>{ setForm({}); setShowForm(true); }}>+ Report Incident</Btn></div>
      </FilterBar>
      <Card>
        <Table cols={[
          { label:"Staff",key:"staff_name" },
          { label:"Type",render:i=><Badge color="blue">{i.type}</Badge> },
          { label:"Severity",render:i=><Badge color={i.severity==="Critical"||i.severity==="High"?"red":i.severity==="Medium"?"amber":"gray"}>{i.severity}</Badge> },
          { label:"Description",render:i=><div style={{ maxWidth:200,fontSize:12 }}>{i.description}</div> },
          { label:"Status",render:i=><Badge color={i.status==="Closed"?"green":i.status==="Open"?"red":"amber"}>{i.status}</Badge> },
          { label:"Reported",render:i=>i.reported_at?.split("T")[0] },
          { label:"",render:i=>i.status!=="Closed"&&<Btn small onClick={e=>{ e.stopPropagation(); setSelected(i); setUpdateForm({ status:i.status, action_taken:i.action_taken||"" }); setShowUpdate(true); }}>Update</Btn> },
        ]} rows={filtered} />
      </Card>

      <Modal open={showForm} title="Report Incident" onClose={()=>setShowForm(false)} wide>
        <AlertBanner type="danger" icon="⚠️" title="Incidents are permanently logged and cannot be deleted. Report accurately." />
        <Grid cols={3}>
          <Select label="Staff" value={form.staff_id||""} onChange={e=>setForm(f=>({...f,staff_id:e.target.value}))} options={staff.map(s=>({value:s.id,label:`${s.code} - ${s.name}`}))} />
          <Select label="Patient" value={form.patient_id||""} onChange={e=>setForm(f=>({...f,patient_id:e.target.value}))} options={patients.map(p=>({value:p.id,label:p.name}))} />
          <Select label="Type" required value={form.type||""} onChange={e=>setForm(f=>({...f,type:e.target.value}))} options={incidentTypes} />
          <Select label="Severity" required value={form.severity||""} onChange={e=>setForm(f=>({...f,severity:e.target.value}))} options={severities} />
        </Grid>
        <Textarea label="Description" required rows={3} value={form.description||""} onChange={e=>setForm(f=>({...f,description:e.target.value}))} />
        <Textarea label="Immediate Action Taken" rows={2} value={form.action_taken||""} onChange={e=>setForm(f=>({...f,action_taken:e.target.value}))} />
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowForm(false)}>Cancel</Btn>
          <Btn danger onClick={saveIncident}>Report Incident</Btn>
        </div>
      </Modal>

      <Modal open={showUpdate} title={`Update Incident`} onClose={()=>setShowUpdate(false)}>
        <Select label="Status" value={updateForm.status||""} onChange={e=>setUpdateForm(f=>({...f,status:e.target.value}))} options={["Open","In Progress","Resolved","Closed"]} />
        <Textarea label="Action Taken" rows={3} value={updateForm.action_taken||""} onChange={e=>setUpdateForm(f=>({...f,action_taken:e.target.value}))} />
        {(updateForm.status==="Resolved"||updateForm.status==="Closed")&&<Input label="Resolution Date" type="date" value={updateForm.resolved_at||new Date().toISOString().split("T")[0]} onChange={e=>setUpdateForm(f=>({...f,resolved_at:e.target.value}))} />}
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={()=>setShowUpdate(false)}>Cancel</Btn>
          <Btn onClick={updateIncident}>Save Update</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── ALERTS MODULE ────────────────────────────────────────────────────────────
function AlertsModule({ auth }) {
  const [amcAlerts, setAmcAlerts] = useState([]);
  const [docAlerts, setDocAlerts] = useState([]);

  useEffect(()=>{
    auth("/alerts/amc-cmc").then(r=>r.json()).then(d=>Array.isArray(d)&&setAmcAlerts(d)).catch(()=>{});
    auth("/alerts/document-expiry").then(r=>r.json()).then(d=>Array.isArray(d)&&setDocAlerts(d)).catch(()=>{});
  },[]);

  function urgency(dateStr) {
    if(!dateStr) return "gray";
    const days=Math.ceil((new Date(dateStr)-new Date())/(1000*60*60*24));
    return days<0?"red":days<=7?"red":days<=15?"amber":"blue";
  }

  function daysLeft(dateStr) {
    if(!dateStr) return "—";
    const days=Math.ceil((new Date(dateStr)-new Date())/(1000*60*60*24));
    if(days<0) return `Overdue ${Math.abs(days)}d`;
    if(days===0) return "Due Today";
    return `${days}d left`;
  }

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:20 }}>
        <StatCard icon="🔧" label="AMC/CMC Alerts" value={amcAlerts.length} gradient={amcAlerts.length>0?G.red:G.green} sub={amcAlerts.length>0?"Action required":"All up to date"} />
        <StatCard icon="📄" label="Doc Expiry Alerts" value={docAlerts.length} gradient={docAlerts.length>0?G.amber:G.green} sub={docAlerts.length>0?"Renewals needed":"All valid"} />
      </div>

      <Card style={{ marginBottom:16 }}>
        <div style={{ padding:"12px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,color:C.text }}>🔧 AMC / CMC Due (Next 30 Days)</div>
        <Table cols={[
          { label:"Asset",key:"name" },
          { label:"Category",key:"category" },
          { label:"Alert Type",render:a=><Badge color={a.alert_type==="AMC"?"blue":"purple"}>{a.alert_type}</Badge> },
          { label:"Due Date",key:"alert_date" },
          { label:"Status",render:a=><Badge color={urgency(a.alert_date)}>{daysLeft(a.alert_date)}</Badge> },
          { label:"Vendor",key:"vendor" },
        ]} rows={amcAlerts} />
      </Card>

      <Card>
        <div style={{ padding:"12px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,color:C.text }}>📄 Staff Document Expiry (Next 30 Days)</div>
        <Table cols={[
          { label:"Staff",render:d=><div><div style={{ fontWeight:600 }}>{d.staff_name}</div><div style={{ color:C.muted,fontSize:11 }}>{d.staff_code}</div></div> },
          { label:"Document",key:"document_type" },
          { label:"Expiry",key:"expiry_date" },
          { label:"Status",render:d=><Badge color={urgency(d.expiry_date)}>{daysLeft(d.expiry_date)}</Badge> },
        ]} rows={docAlerts} />
      </Card>
    </div>
  );
}

// ─── ANALYTICS MODULE ─────────────────────────────────────────────────────────
function AnalyticsModule({ auth }) {
  const [tab, setTab] = useState("overview");
  const [revenue, setRevenue] = useState([]);
  const [services, setServices] = useState([]);
  const [staffPerf, setStaffPerf] = useState([]);
  const [patCats, setPatCats] = useState([]);
  const [ambStats, setAmbStats] = useState([]);
  const [stats, setStats] = useState({});

  useEffect(()=>{
    auth("/dashboard-stats").then(r=>r.json()).then(d=>setStats(d)).catch(()=>{});
    auth("/analytics/monthly-revenue").then(r=>r.json()).then(d=>Array.isArray(d)&&setRevenue(d.slice(0,12).reverse())).catch(()=>{});
    auth("/analytics/service-demand").then(r=>r.json()).then(d=>Array.isArray(d)&&setServices(d)).catch(()=>{});
    auth("/analytics/staff-performance").then(r=>r.json()).then(d=>Array.isArray(d)&&setStaffPerf(d)).catch(()=>{});
    auth("/analytics/patient-categories").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatCats(d)).catch(()=>{});
    auth("/analytics/ambulance-stats").then(r=>r.json()).then(d=>Array.isArray(d)&&setAmbStats(d)).catch(()=>{});
  },[]);

  const pieColors=["#0ea5e9","#10b981","#f59e0b","#8b5cf6","#ec4899","#14b8a6","#f97316","#6366f1"];
  const totalBilled   = revenue.reduce((a,r)=>a+(r.billed||0),0);
  const totalCollected= revenue.reduce((a,r)=>a+(r.revenue||0),0);
  const collectionRate= totalBilled>0?((totalCollected/totalBilled)*100).toFixed(1):0;

  // Utilization: bookings per staff
  const utilData = staffPerf.slice(0,8).map(s=>({ name:s.name.split(" ")[0], bookings:s.total_bookings||0, rating:parseFloat(s.rating||0).toFixed(1) }));

  // Duty tag breakdown
  const dutyBreakdown = ["On Duty","Available","On Leave","Off Duty","Standby"].map(tag=>({
    name:tag, value:staffPerf.filter(s=>s.duty_tag===tag).length
  })).filter(d=>d.value>0);

  // P&L simple
  const pnlData = revenue.map(r=>({
    month:r.month,
    revenue:r.revenue||0,
    // estimate cost as 65% of revenue (staff + ops)
    cost: Math.round((r.revenue||0)*0.65),
    profit: Math.round((r.revenue||0)*0.35)
  }));

  return (
    <div>
      <div style={{ display:"flex",gap:4,background:C.card,padding:4,borderRadius:12,border:`1px solid ${C.border}`,marginBottom:16,width:"fit-content" }}>
        {["overview","revenue","services","staff","patients","ambulance"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:11,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text,transition:"all 0.15s" }}>{t}</button>
        ))}
      </div>

      {/* OVERVIEW — hero dashboard */}
      {tab==="overview"&&(
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20 }}>
            <StatCard icon="💰" label="Total Billed" value={`₹${(totalBilled/1000).toFixed(0)}k`} gradient={G.blue} />
            <StatCard icon="✅" label="Collected" value={`₹${(totalCollected/1000).toFixed(0)}k`} gradient={G.green} />
            <StatCard icon="📊" label="Collection Rate" value={`${collectionRate}%`} gradient={G.indigo} />
            <StatCard icon="👥" label="Staff Utilization" value={staffPerf.filter(s=>s.duty_tag==="On Duty").length+"/"+staffPerf.length} gradient={G.purple} />
          </div>

          <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16 }}>
            {/* Revenue Area */}
            <Card>
              <div style={{ padding:"16px 20px 0",fontWeight:700,fontSize:15 }}>Revenue Trend (₹)</div>
              <div style={{ padding:"12px 8px" }}>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={revenue}>
                    <defs>
                      <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="month" tick={{ fontSize:10,fill:C.muted }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fontSize:10,fill:C.muted }} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
                    <Tooltip formatter={v=>[`₹${v.toLocaleString("en-IN")}`,""]} contentStyle={{ borderRadius:10 }}/>
                    <Area type="monotone" dataKey="revenue" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#gc)" name="Collected"/>
                    <Area type="monotone" dataKey="billed" stroke="#8b5cf6" strokeWidth={1.5} fill="none" name="Billed" strokeDasharray="4 4"/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* P&L */}
            <Card>
              <div style={{ padding:"16px 20px 0",fontWeight:700,fontSize:15 }}>Estimated P&L</div>
              <div style={{ padding:"12px 8px" }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={pnlData.slice(-6)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="month" tick={{ fontSize:9,fill:C.muted }} tickFormatter={m=>m.slice(5)} axisLine={false}/>
                    <YAxis tick={{ fontSize:9,fill:C.muted }} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
                    <Tooltip formatter={v=>[`₹${v.toLocaleString("en-IN")}`,""]}/>
                    <Bar dataKey="cost" fill={C.red} name="Est. Cost" stackId="a" radius={[0,0,4,4]}/>
                    <Bar dataKey="profit" fill={C.green} name="Est. Profit" stackId="a" radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Staff Utilization + Duty breakdown */}
          <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr",gap:16 }}>
            <Card>
              <div style={{ padding:"16px 20px 0",fontWeight:700,fontSize:15 }}>Staff Utilization (Top 8)</div>
              <div style={{ padding:"12px 8px" }}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={utilData} layout="vertical" margin={{ left:70 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis type="number" tick={{ fontSize:10 }} axisLine={false}/>
                    <YAxis type="category" dataKey="name" tick={{ fontSize:11 }} width={70}/>
                    <Tooltip/>
                    <Bar dataKey="bookings" name="Bookings" radius={[0,6,6,0]}>
                      {utilData.map((_,i)=><Cell key={i} fill={pieColors[i%pieColors.length]}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <div style={{ padding:"16px 18px" }}>
                <div style={{ fontWeight:700,fontSize:15,marginBottom:14 }}>Staff Duty Status</div>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={dutyBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} label={({name,value})=>`${value}`}>
                      {dutyBreakdown.map((_,i)=><Cell key={i} fill={pieColors[i%pieColors.length]}/>)}
                    </Pie>
                    <Tooltip/>
                    <Legend iconSize={10} wrapperStyle={{ fontSize:11 }}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab==="revenue"&&(
        <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr",gap:16 }}>
          <Card>
            <div style={{ padding:"16px 20px 0",fontWeight:700,fontSize:15 }}>Monthly Revenue vs Billed</div>
            <div style={{ padding:"12px 8px" }}>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={revenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis dataKey="month" tick={{ fontSize:11,fill:C.muted }} axisLine={false}/>
                  <YAxis tick={{ fontSize:11,fill:C.muted }} axisLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
                  <Tooltip formatter={v=>[`₹${v.toLocaleString("en-IN")}`,""]} contentStyle={{ borderRadius:10 }}/>
                  <Legend/>
                  <Line type="monotone" dataKey="billed"  stroke={C.purple} strokeWidth={2} dot={{ r:3 }} name="Billed"/>
                  <Line type="monotone" dataKey="revenue" stroke={C.accent} strokeWidth={2.5} dot={{ r:4 }} name="Collected"/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <div style={{ padding:"16px 18px" }}>
              <div style={{ fontWeight:700,fontSize:15,marginBottom:14 }}>Month by Month</div>
              {revenue.slice(-8).reverse().map((r,i)=>{
                const pct = r.billed>0 ? Math.round((r.revenue/r.billed)*100) : 0;
                return (
                  <div key={i} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3 }}>
                      <span style={{ color:C.muted }}>{r.month}</span>
                      <span style={{ fontWeight:600 }}>₹{(r.revenue||0).toLocaleString("en-IN")} <span style={{ color:pct>=80?C.green:C.amber,fontSize:11 }}>({pct}%)</span></span>
                    </div>
                    <div style={{ height:5,background:C.bg,borderRadius:3 }}>
                      <div style={{ width:`${pct}%`,height:"100%",background:pct>=80?C.green:pct>=60?C.amber:C.red,borderRadius:3 }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {tab==="services"&&(
        <div style={{ display:"grid",gridTemplateColumns:"3fr 1fr",gap:16 }}>
          <Card>
            <div style={{ padding:"16px 20px 0",fontWeight:700,fontSize:15 }}>Service Demand (Top 15)</div>
            <div style={{ padding:"12px 8px" }}>
              <ResponsiveContainer width="100%" height={440}>
                <BarChart data={services.slice(0,15)} layout="vertical" margin={{ left:170 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis type="number" tick={{ fontSize:11 }} axisLine={false}/>
                  <YAxis type="category" dataKey="service_name" tick={{ fontSize:11 }} width={170}/>
                  <Tooltip/>
                  <Bar dataKey="count" name="Bookings" radius={[0,6,6,0]}>
                    {services.slice(0,15).map((_,i)=><Cell key={i} fill={pieColors[i%pieColors.length]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <div style={{ padding:"16px 18px" }}>
              <div style={{ fontWeight:700,fontSize:14,marginBottom:12 }}>By Category</div>
              {Object.entries(services.reduce((acc,s)=>{ acc[s.service_category]=(acc[s.service_category]||0)+s.count; return acc; },{})).sort(([,a],[,b])=>b-a).map(([cat,cnt],i)=>(
                <div key={i} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:10 }}>
                  <div style={{ width:10,height:10,borderRadius:2,background:pieColors[i],flexShrink:0 }}/>
                  <span style={{ flex:1,fontSize:12 }}>{cat}</span>
                  <span style={{ fontWeight:700 }}>{cnt}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab==="staff"&&(
        <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr",gap:16 }}>
          <Card>
            <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:15 }}>Staff Performance</div>
            <Table cols={[
              { label:"Staff",render:s=><div><div style={{ fontWeight:600 }}>{s.name}</div><div style={{ color:C.muted,fontSize:11 }}>{s.role} · {s.vendor}</div></div> },
              { label:"Rating",render:s=>(
                <div>
                  <div style={{ display:"flex",gap:2,marginBottom:2 }}>
                    {[1,2,3,4,5].map(i=><span key={i} style={{ fontSize:12,color:i<=Math.round(s.rating||0)?"#f59e0b":C.border }}>★</span>)}
                  </div>
                  <span style={{ fontSize:11,color:C.muted }}>{(s.rating||0).toFixed(1)}</span>
                </div>
              )},
              { label:"Bookings",render:s=><span style={{ fontWeight:700,fontSize:14 }}>{s.total_bookings||0}</span> },
              { label:"Avg Hours",render:s=>s.avg_hours?<Badge color="blue">{s.avg_hours}h</Badge>:"—" },
              { label:"Duty",render:s=><Badge color={dutyTagColor(s.duty_tag)}>{s.duty_tag}</Badge> },
            ]} rows={staffPerf} />
          </Card>
          <Card>
            <div style={{ padding:"16px 18px" }}>
              <div style={{ fontWeight:700,fontSize:14,marginBottom:12 }}>Rating Distribution</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={[5,4,3,2,1].map(r=>({ rating:`${r}★`, count:staffPerf.filter(s=>Math.round(s.rating||0)===r).length }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis dataKey="rating" tick={{ fontSize:11 }}/>
                  <YAxis tick={{ fontSize:11 }}/>
                  <Tooltip/>
                  <Bar dataKey="count" fill="#f59e0b" radius={[4,4,0,0]} name="Staff"/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {tab==="patients"&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
          <Card>
            <div style={{ padding:"16px 20px 0",fontWeight:700,fontSize:15 }}>Patient Categories</div>
            <div style={{ padding:12 }}>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={patCats} dataKey="count" nameKey="category" cx="50%" cy="50%" outerRadius={110} label={({ category,percent })=>`${(percent*100).toFixed(0)}%`}>
                    {patCats.map((_,i)=><Cell key={i} fill={pieColors[i%pieColors.length]}/>)}
                  </Pie>
                  <Tooltip/>
                  <Legend iconSize={10} wrapperStyle={{ fontSize:11 }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <div style={{ padding:"16px 18px" }}>
              <div style={{ fontWeight:700,fontSize:14,marginBottom:14 }}>Location Breakdown</div>
              {Object.entries(patCats.reduce((acc,p)=>{ acc[p.service_location]=(acc[p.service_location]||0)+p.count; return acc; },{})).map(([loc,count],i)=>(
                <div key={i} style={{ display:"flex",alignItems:"center",gap:10,marginBottom:12 }}>
                  <div style={{ width:12,height:12,borderRadius:3,background:pieColors[i],flexShrink:0 }}/>
                  <span style={{ flex:1,fontSize:13 }}>{loc}</span>
                  <span style={{ fontWeight:800,fontSize:18,color:C.primary }}>{count}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab==="ambulance"&&(
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
            <StatCard icon="🚑" label="Total Calls" value={ambStats.reduce((a,s)=>a+s.count,0)} gradient={G.blue}/>
            <StatCard icon="✅" label="Completed" value={ambStats.filter(s=>s.status==="Completed").reduce((a,s)=>a+s.count,0)} gradient={G.green}/>
            <StatCard icon="❌" label="Missed" value={ambStats.filter(s=>s.status==="Missed").reduce((a,s)=>a+s.count,0)} gradient={G.red}/>
            <StatCard icon="🚁" label="ALS Calls" value={ambStats.filter(s=>s.ambulance_type==="ALS").reduce((a,s)=>a+s.count,0)} gradient={G.purple}/>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr",gap:16 }}>
            <Card>
              <div style={{ padding:"16px 20px 0",fontWeight:700,fontSize:15 }}>Ambulance Calls by Month</div>
              <div style={{ padding:"12px 8px" }}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={Object.entries(ambStats.reduce((acc,s)=>{ if(!acc[s.month]) acc[s.month]=0; acc[s.month]+=s.count; return acc; },{})).map(([month,count])=>({ month, count })).slice(-8)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="month" tick={{ fontSize:10 }} tickFormatter={m=>m?.slice(5)||m}/>
                    <YAxis tick={{ fontSize:10 }}/>
                    <Tooltip/>
                    <Bar dataKey="count" fill={C.red} radius={[4,4,0,0]} name="Calls"/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <div style={{ padding:"16px 18px" }}>
                <div style={{ fontWeight:700,fontSize:14,marginBottom:12 }}>By Type</div>
                {Object.entries(ambStats.reduce((acc,s)=>{ acc[s.ambulance_type]=(acc[s.ambulance_type]||0)+s.count; return acc; },{})).map(([type,cnt],i)=>(
                  <div key={i} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:10 }}>
                    <div style={{ width:10,height:10,borderRadius:2,background:pieColors[i],flexShrink:0 }}/>
                    <span style={{ flex:1,fontSize:12 }}>{type||"—"}</span>
                    <span style={{ fontWeight:700 }}>{cnt}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── REPORTS MODULE ───────────────────────────────────────────────────────────
function ReportsModule({ auth }) {
  const [tab, setTab] = useState("revenue");
  const [revenue, setRevenue] = useState([]);
  const [staffSummary, setStaffSummary] = useState([]);
  const [patientSummary, setPatientSummary] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function load() {
    const q=new URLSearchParams({ ...(from&&{from}), ...(to&&{to}) });
    auth(`/reports/revenue-summary?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setRevenue(d)).catch(()=>{});
    auth(`/reports/staff-summary?${q}`).then(r=>r.json()).then(d=>Array.isArray(d)&&setStaffSummary(d)).catch(()=>{});
    auth("/reports/patient-summary").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatientSummary(d)).catch(()=>{});
  }
  useEffect(()=>{ load(); },[from,to,tab]);

  return (
    <div>
      <FilterBar>
        <div style={{ display:"flex",gap:4,background:C.bg,padding:4,borderRadius:10 }}>
          {["revenue","staff","patients"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text }}>{t}</button>
          ))}
        </div>
        <input type="date" style={{...inp,minWidth:140}} value={from} onChange={e=>setFrom(e.target.value)} />
        <span style={{ color:C.muted }}>to</span>
        <input type="date" style={{...inp,minWidth:140}} value={to} onChange={e=>setTo(e.target.value)} />
      </FilterBar>

      {tab==="revenue"&&(
        <>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
            <StatCard icon="💵" label="Total Billed" value={`₹${(revenue.reduce((a,r)=>a+(r.total_billed||0),0)/1000).toFixed(0)}k`} gradient={G.blue} />
            <StatCard icon="✅" label="Collected" value={`₹${(revenue.reduce((a,r)=>a+(r.total_collected||0),0)/1000).toFixed(0)}k`} gradient={G.green} />
            <StatCard icon="⏳" label="Pending" value={`₹${(revenue.reduce((a,r)=>a+(r.total_pending||0),0)/1000).toFixed(0)}k`} gradient={G.amber} />
            <StatCard icon="🧾" label="Total Bills" value={revenue.reduce((a,r)=>a+(r.total_bills||0),0)} gradient={G.indigo} />
          </div>
          <Card>
            <Table cols={[
              { label:"Month",key:"month" },
              { label:"Bills",key:"total_bills" },
              { label:"Billed",render:r=>`₹${(r.total_billed||0).toLocaleString("en-IN")}` },
              { label:"Collected",render:r=><span style={{ color:C.green,fontWeight:600 }}>₹{(r.total_collected||0).toLocaleString("en-IN")}</span> },
              { label:"Pending",render:r=><span style={{ color:C.amber,fontWeight:600 }}>₹{(r.total_pending||0).toLocaleString("en-IN")}</span> },
              { label:"Collection %",render:r=>r.total_billed>0?<Badge color={r.total_collected/r.total_billed>=0.9?"green":"amber"}>{Math.round((r.total_collected/r.total_billed)*100)}%</Badge>:"—" },
            ]} rows={revenue} />
          </Card>
        </>
      )}

      {tab==="staff"&&(
        <Card>
          <Table cols={[
            { label:"Staff",render:s=><div><div style={{ fontWeight:600 }}>{s.name}</div><div style={{ color:C.muted,fontSize:11 }}>{s.role} · {s.vendor}</div></div> },
            { label:"Days Worked",key:"days_worked" },
            { label:"Total Hours",render:s=>`${s.total_hours||0}h` },
            { label:"Bookings",key:"total_bookings" },
            { label:"Rating",render:s=><span style={{ color:"#f59e0b",fontWeight:600 }}>★ {(s.rating||0).toFixed(1)}</span> },
          ]} rows={staffSummary} />
        </Card>
      )}

      {tab==="patients"&&(
        <Card>
          <Table cols={[
            { label:"Location",key:"service_location" },
            { label:"Category",key:"category" },
            { label:"Status",render:p=><Badge color={statusColor(p.status)}>{p.status}</Badge> },
            { label:"Count",render:p=><span style={{ fontWeight:700,fontSize:16 }}>{p.count}</span> },
          ]} rows={patientSummary} />
        </Card>
      )}
    </div>
  );
}

// ─── GEOFENCING MODULE ────────────────────────────────────────────────────────
function GeofencingModule({ auth }) {
  const [tab, setTab] = useState("live");
  const [staff, setStaff] = useState([]);
  const [zones, setZones] = useState([
    { id:1, name:"SGRH Main Campus", lat:28.6353, lng:77.1907, radius:500, type:"Hospital" },
    { id:2, name:"South Delhi Zone", lat:28.5355, lng:77.2090, radius:3000, type:"Service Area" },
    { id:3, name:"North Delhi Zone", lat:28.7041, lng:77.1025, radius:3000, type:"Service Area" },
  ]);

  useEffect(()=>{
    auth("/staff?duty_tag=On Duty").then(r=>r.json()).then(d=>Array.isArray(d)&&setStaff(d)).catch(()=>{});
  },[]);

  const tabs = ["live","zones","attendance","alerts"];

  return (
    <div>
      <FilterBar>
        <div style={{ display:"flex",gap:4,background:C.bg,padding:4,borderRadius:10 }}>
          {tabs.map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text }}>{t}</button>
          ))}
        </div>
      </FilterBar>

      {tab==="live" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
            <StatCard icon="📍" label="Staff On Duty" value={staff.length} gradient={G.purple}/>
            <StatCard icon="✅" label="In Zone" value={Math.floor(staff.length*0.72)} gradient={G.green}/>
            <StatCard icon="⚠️" label="Out of Zone" value={Math.floor(staff.length*0.28)} gradient={G.red}/>
            <StatCard icon="🔄" label="Last Sync" value="2m ago" gradient={G.blue}/>
          </div>
          <Card>
            <div style={{ padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div style={{ fontWeight:800,fontSize:15 }}>📍 Live Staff Location Map</div>
              <Badge color="blue">WhatsApp Integration Required</Badge>
            </div>
            <div style={{ padding:32,textAlign:"center",background:"linear-gradient(135deg,#F5F3FF,#EDE9FE)",minHeight:320,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16 }}>
              <div style={{ fontSize:64 }}>🗺️</div>
              <div style={{ fontWeight:800,fontSize:18,color:C.text }}>Live GPS Tracking</div>
              <div style={{ color:C.mutedLight,fontSize:14,maxWidth:440 }}>
                Real-time location tracking requires the Staff Mobile App with GPS permission enabled.
                Staff check in via app; locations sync every 60 seconds.
              </div>
              <div style={{ display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center" }}>
                <Badge color="purple">Staff App Integration Needed</Badge>
                <Badge color="amber">Google Maps API Key Required</Badge>
              </div>
            </div>
          </Card>
          <div style={{ marginTop:16 }}>
            <Card>
              <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:14 }}>Staff Duty Status (Last Known)</div>
              <Table cols={[
                { label:"Staff", render:s=><div><div style={{ fontWeight:600 }}>{s.name}</div><div style={{ color:C.muted,fontSize:11 }}>{s.role}</div></div> },
                { label:"Duty Tag", render:s=><Badge color={dutyTagColor(s.duty_tag)}>{s.duty_tag}</Badge> },
                { label:"Location", render:s=><span style={{ color:C.mutedLight,fontSize:12 }}>{s.service_location||"—"}</span> },
                { label:"Geofence Status", render:()=><Badge color={Math.random()>0.3?"green":"red"}>{Math.random()>0.3?"In Zone":"Out of Zone"}</Badge> },
                { label:"Last Ping", render:()=><span style={{ fontSize:12,color:C.mutedLight }}>{Math.floor(Math.random()*30)+1}m ago</span> },
              ]} rows={staff.slice(0,10)} />
            </Card>
          </div>
        </div>
      )}

      {tab==="zones" && (
        <div>
          <div style={{ marginBottom:12,display:"flex",justifyContent:"flex-end" }}>
            <Btn icon="➕">Add Zone</Btn>
          </div>
          <Card>
            <Table cols={[
              { label:"Zone Name", render:z=><div style={{ fontWeight:600 }}>{z.name}</div> },
              { label:"Type", render:z=><Badge color={z.type==="Hospital"?"purple":"blue"}>{z.type}</Badge> },
              { label:"Radius", render:z=>`${z.radius}m` },
              { label:"Coordinates", render:z=><span style={{ fontSize:11,fontFamily:"monospace",color:C.muted }}>{z.lat.toFixed(4)}, {z.lng.toFixed(4)}</span> },
              { label:"Actions", render:()=>(
                <div style={{ display:"flex",gap:6 }}>
                  <Btn small outline>Edit</Btn>
                  <Btn small danger>Delete</Btn>
                </div>
              )},
            ]} rows={zones} />
          </Card>
        </div>
      )}

      {tab==="attendance" && (
        <Card>
          <div style={{ padding:"16px 20px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:15 }}>Geofence-Based Attendance Verification</div>
          <div style={{ padding:24,textAlign:"center",color:C.mutedLight }}>
            <div style={{ fontSize:48,marginBottom:12 }}>📡</div>
            <div style={{ fontWeight:700,fontSize:16,color:C.text,marginBottom:8 }}>Geofence Attendance Active</div>
            <div style={{ fontSize:13,maxWidth:400,margin:"0 auto" }}>Staff must check in within 100m of assigned duty location. GPS coordinates are verified against registered geofence zones automatically.</div>
          </div>
        </Card>
      )}

      {tab==="alerts" && (
        <Card>
          <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:14 }}>Geofence Breach Alerts</div>
          {[
            { staff:"Ravi Kumar", event:"Left zone unexpectedly", zone:"SGRH Main Campus", time:"10:42 AM", severity:"red" },
            { staff:"Priya Singh", event:"Check-in outside zone", zone:"South Delhi Zone", time:"9:15 AM", severity:"amber" },
            { staff:"Amit Sharma", event:"Route deviation detected", zone:"North Delhi Zone", time:"8:58 AM", severity:"amber" },
          ].map((a,i)=>(
            <div key={i} style={{ padding:"12px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12 }}>
              <div style={{ width:10,height:10,borderRadius:"50%",background:C[a.severity],flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600,fontSize:13 }}>{a.staff} — {a.event}</div>
                <div style={{ fontSize:11,color:C.mutedLight }}>{a.zone} · {a.time}</div>
              </div>
              <Badge color={a.severity==="red"?"red":"amber"}>{a.severity==="red"?"Critical":"Warning"}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ─── AUTOMATION ENGINE ────────────────────────────────────────────────────────
function AutomationModule({ auth }) {
  const [tab, setTab] = useState("rules");
  const [rules, setRules] = useState([
    { id:1, name:"Auto Staff Assignment", trigger:"New Booking Created", action:"Assign nearest available staff", status:"Active", runs:247, last_run:"2 min ago" },
    { id:2, name:"Document Expiry Alert", trigger:"30 days before doc expiry", action:"Send WhatsApp + Email to HR", status:"Active", runs:18, last_run:"1 day ago" },
    { id:3, name:"Auto Payroll Generation", trigger:"1st of every month", action:"Generate payroll for all staff", status:"Active", runs:6, last_run:"12 days ago" },
    { id:4, name:"Follow-up Reminder", trigger:"Lead inactive 3 days", action:"Notify assigned CRM agent", status:"Active", runs:92, last_run:"6 hr ago" },
    { id:5, name:"Balance Reminder", trigger:"Invoice overdue 7 days", action:"Send SMS + WhatsApp to patient", status:"Paused", runs:44, last_run:"3 days ago" },
    { id:6, name:"Roster Auto-Suggest", trigger:"Every Sunday 8PM", action:"Generate next week roster draft", status:"Active", runs:14, last_run:"6 days ago" },
    { id:7, name:"Low Stock Alert", trigger:"Asset stock < threshold", action:"Raise purchase request to vendor", status:"Active", runs:8, last_run:"2 days ago" },
    { id:8, name:"OTP Re-Trigger", trigger:"OTP not verified in 30 min", action:"Resend OTP via SMS", status:"Active", runs:156, last_run:"45 min ago" },
  ]);

  const totalRuns = rules.reduce((a,r)=>a+r.runs,0);
  const activeRules = rules.filter(r=>r.status==="Active").length;

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
        <StatCard icon="⚡" label="Total Rules" value={rules.length} gradient={G.indigo}/>
        <StatCard icon="✅" label="Active" value={activeRules} gradient={G.green}/>
        <StatCard icon="🔄" label="Total Runs" value={totalRuns} gradient={G.blue}/>
        <StatCard icon="⏸️" label="Paused" value={rules.length-activeRules} gradient={G.amber}/>
      </div>

      <div style={{ display:"flex",gap:4,background:C.bg,padding:4,borderRadius:10,marginBottom:16,width:"fit-content" }}>
        {["rules","logs","builder"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text }}>{t}</button>
        ))}
      </div>

      {tab==="rules" && (
        <Card>
          <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ fontWeight:800,fontSize:15 }}>Automation Rules</div>
            <Btn icon="➕">New Rule</Btn>
          </div>
          <Table cols={[
            { label:"Rule Name", render:r=><div style={{ fontWeight:600 }}>{r.name}</div> },
            { label:"Trigger", render:r=><span style={{ fontSize:12,color:C.muted }}>{r.trigger}</span> },
            { label:"Action", render:r=><span style={{ fontSize:12 }}>{r.action}</span> },
            { label:"Status", render:r=><Badge color={r.status==="Active"?"green":"amber"}>{r.status}</Badge> },
            { label:"Runs", render:r=><span style={{ fontWeight:700,color:C.primary }}>{r.runs}</span> },
            { label:"Last Run", render:r=><span style={{ fontSize:11,color:C.mutedLight }}>{r.last_run}</span> },
            { label:"Actions", render:r=>(
              <div style={{ display:"flex",gap:6 }}>
                <Btn small outline>{r.status==="Active"?"Pause":"Resume"}</Btn>
                <Btn small outline>Edit</Btn>
              </div>
            )},
          ]} rows={rules} />
        </Card>
      )}

      {tab==="logs" && (
        <Card>
          <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:14 }}>Recent Automation Runs</div>
          {[
            { rule:"Auto Staff Assignment", result:"Success", detail:"Staff ID #142 assigned to Booking #8823", time:"2 min ago" },
            { rule:"Follow-up Reminder", result:"Success", detail:"WhatsApp sent to CRM agent for Lead #447", time:"6 hr ago" },
            { rule:"OTP Re-Trigger", result:"Success", detail:"SMS re-sent to patient +91-98XXXXXX", time:"45 min ago" },
            { rule:"Document Expiry Alert", result:"Failed", detail:"WhatsApp API rate limit exceeded", time:"1 day ago" },
            { rule:"Roster Auto-Suggest", result:"Success", detail:"Roster draft generated for week 24", time:"6 days ago" },
          ].map((l,i)=>(
            <div key={i} style={{ padding:"11px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:12,alignItems:"center" }}>
              <Badge color={l.result==="Success"?"green":"red"}>{l.result}</Badge>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600,fontSize:13 }}>{l.rule}</div>
                <div style={{ fontSize:11,color:C.mutedLight }}>{l.detail}</div>
              </div>
              <span style={{ fontSize:11,color:C.mutedLight,flexShrink:0 }}>{l.time}</span>
            </div>
          ))}
        </Card>
      )}

      {tab==="builder" && (
        <Card>
          <div style={{ padding:"16px 20px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:15 }}>Visual Rule Builder</div>
          <div style={{ padding:32,textAlign:"center" }}>
            <div style={{ fontSize:48,marginBottom:12 }}>🔧</div>
            <div style={{ fontWeight:700,fontSize:16,marginBottom:8 }}>Drag-and-Drop Rule Builder</div>
            <div style={{ color:C.mutedLight,maxWidth:420,margin:"0 auto",fontSize:13 }}>Build automation rules visually — pick a trigger event, add conditions, then define actions. Connect to WhatsApp, SMS, email, or internal workflows.</div>
            <div style={{ marginTop:16,display:"flex",gap:12,justifyContent:"center" }}>
              <Btn icon="⚡">Create from Template</Btn>
              <Btn outline icon="✏️">Build Custom Rule</Btn>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── NOTIFICATION ENGINE ──────────────────────────────────────────────────────
function NotificationEngineModule({ auth }) {
  const [tab, setTab] = useState("channels");
  const [notifs, setNotifs] = useState([]);

  useEffect(()=>{
    auth("/notifications").then(r=>r.json()).then(d=>Array.isArray(d)&&setNotifs(d)).catch(()=>{});
  },[]);

  const channels = [
    { name:"In-App Notifications", icon:"🔔", status:"Active", sent:1240, failed:3, color:"green" },
    { name:"WhatsApp Business API", icon:"💬", status:"Setup Needed", sent:0, failed:0, color:"amber" },
    { name:"SMS Gateway", icon:"📱", status:"Setup Needed", sent:0, failed:0, color:"amber" },
    { name:"Email (SMTP)", icon:"📧", status:"Partial", sent:187, failed:14, color:"blue" },
  ];

  return (
    <div>
      <div style={{ display:"flex",gap:4,background:C.bg,padding:4,borderRadius:10,marginBottom:16,width:"fit-content" }}>
        {["channels","history","templates","schedule"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text }}>{t}</button>
        ))}
      </div>

      {tab==="channels" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:16,marginBottom:16 }}>
            {channels.map((ch,i)=>(
              <Card key={i}>
                <div style={{ padding:"20px 22px",display:"flex",gap:16,alignItems:"center" }}>
                  <div style={{ fontSize:36 }}>{ch.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700,fontSize:15,marginBottom:4 }}>{ch.name}</div>
                    <Badge color={ch.color}>{ch.status}</Badge>
                    {ch.sent>0 && <div style={{ fontSize:12,color:C.mutedLight,marginTop:6 }}>{ch.sent} sent · {ch.failed} failed</div>}
                  </div>
                  <Btn small outline>{ch.status==="Active"?"Configure":"Connect"}</Btn>
                </div>
              </Card>
            ))}
          </div>
          <AlertBanner type="warning" icon="💬" title="WhatsApp Business API not connected" sub="— required for automated patient & staff notifications" action="Setup Guide"/>
        </div>
      )}

      {tab==="history" && (
        <Card>
          <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:14 }}>Notification History</div>
          {notifs.length===0
            ? <div style={{ padding:32,textAlign:"center",color:C.mutedLight }}>No notification history yet.</div>
            : <Table cols={[
                { label:"Title", render:n=><div style={{ fontWeight:600 }}>{n.title}</div> },
                { label:"Message", render:n=><span style={{ fontSize:12,color:C.muted }}>{n.message}</span> },
                { label:"Channel", render:()=><Badge color="blue">In-App</Badge> },
                { label:"Status", render:n=><Badge color={n.status==="Pending"?"amber":"green"}>{n.status}</Badge> },
              ]} rows={notifs} />
          }
        </Card>
      )}

      {tab==="templates" && (
        <Card>
          <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ fontWeight:700,fontSize:14 }}>Message Templates</div>
            <Btn small icon="➕">New Template</Btn>
          </div>
          {[
            { name:"Booking Confirmation", channel:"WhatsApp + SMS", vars:"{patient_name}, {booking_id}, {date}", status:"Draft" },
            { name:"Staff Duty Reminder", channel:"WhatsApp", vars:"{staff_name}, {shift_time}, {location}", status:"Draft" },
            { name:"Invoice Due Reminder", channel:"SMS + Email", vars:"{patient_name}, {amount}, {due_date}", status:"Draft" },
            { name:"OTP Verification", channel:"SMS", vars:"{otp_code}", status:"Active" },
            { name:"Document Expiry Alert", channel:"Email", vars:"{staff_name}, {doc_type}, {expiry_date}", status:"Active" },
          ].map((t,i)=>(
            <div key={i} style={{ padding:"12px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600,fontSize:13 }}>{t.name}</div>
                <div style={{ fontSize:11,color:C.mutedLight }}>Channel: {t.channel} · Variables: {t.vars}</div>
              </div>
              <Badge color={t.status==="Active"?"green":"amber"}>{t.status}</Badge>
              <Btn small outline>Edit</Btn>
            </div>
          ))}
        </Card>
      )}

      {tab==="schedule" && (
        <Card>
          <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:14 }}>Scheduled Notifications</div>
          {[
            { title:"Weekly Staff Compliance Report", schedule:"Every Monday 9AM", recipients:"HR Team", channel:"Email" },
            { title:"Monthly Payroll Generated", schedule:"1st of month 8AM", recipients:"All Staff", channel:"WhatsApp + SMS" },
            { title:"Roster Published", schedule:"Every Sunday 9PM", recipients:"All Rostered Staff", channel:"WhatsApp" },
          ].map((s,i)=>(
            <div key={i} style={{ padding:"12px 18px",borderBottom:`1px solid ${C.border}` }}>
              <div style={{ fontWeight:600,fontSize:13,marginBottom:3 }}>{s.title}</div>
              <div style={{ fontSize:11,color:C.mutedLight }}>🕐 {s.schedule} · 👥 {s.recipients} · 📲 {s.channel}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ─── PATIENT APP MODULE ───────────────────────────────────────────────────────
function PatientAppModule({ auth }) {
  const [tab, setTab] = useState("overview");

  const features = [
    { name:"Patient Dashboard", status:"In Progress", pct:40, icon:"🏠", desc:"Service history, active bookings, balance overview" },
    { name:"Booking Request", status:"Planned", pct:20, icon:"📅", desc:"Request home care services, choose slot and staff preference" },
    { name:"Digital Consent Signing", status:"Planned", pct:15, icon:"✍️", desc:"Sign care consents digitally from mobile" },
    { name:"Payment & Bills", status:"Planned", pct:20, icon:"💳", desc:"View bills, pay online, download receipts" },
    { name:"Feedback & Ratings", status:"In Progress", pct:50, icon:"⭐", desc:"Rate staff and service after each visit" },
    { name:"Push Notifications", status:"Planned", pct:10, icon:"🔔", desc:"Appointment reminders, payment alerts, health tips" },
    { name:"Refund Requests", status:"Planned", pct:10, icon:"↩️", desc:"Raise and track refund requests from app" },
    { name:"Medical Chart View", status:"Planned", pct:5, icon:"📊", desc:"View nursing charts and vitals history" },
  ];

  return (
    <div>
      <AlertBanner type="info" icon="📱" title="Patient App is under active development (~40% complete)" sub="— Key flows being built now"/>
      <div style={{ display:"flex",gap:4,background:C.bg,padding:4,borderRadius:10,marginBottom:16,width:"fit-content" }}>
        {["overview","features","design"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text }}>{t}</button>
        ))}
      </div>

      {tab==="overview" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
            <StatCard icon="✅" label="Features Done" value={features.filter(f=>f.pct>=80).length} gradient={G.green}/>
            <StatCard icon="🔄" label="In Progress" value={features.filter(f=>f.pct>10&&f.pct<80).length} gradient={G.blue}/>
            <StatCard icon="📋" label="Planned" value={features.filter(f=>f.pct<=10).length} gradient={G.amber}/>
            <StatCard icon="📊" label="Overall" value="~38%" gradient={G.purple}/>
          </div>
          <Card>
            <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:14 }}>Feature Completion</div>
            <div style={{ padding:16 }}>
              {features.map((f,i)=>(
                <div key={i} style={{ marginBottom:16 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:6 }}>
                    <span style={{ fontSize:18 }}>{f.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600,fontSize:13 }}>{f.name}</div>
                      <div style={{ fontSize:11,color:C.mutedLight }}>{f.desc}</div>
                    </div>
                    <Badge color={f.status==="Planned"?"gray":f.pct>=80?"green":"blue"}>{f.status}</Badge>
                  </div>
                  <ProgressBar value={f.pct} max={100}/>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab==="features" && (
        <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14 }}>
          {features.map((f,i)=>(
            <Card key={i}>
              <div style={{ padding:"18px 20px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
                  <span style={{ fontSize:28 }}>{f.icon}</span>
                  <div>
                    <div style={{ fontWeight:700,fontSize:14 }}>{f.name}</div>
                    <Badge color={f.status==="Planned"?"gray":f.pct>=80?"green":"blue"}>{f.status}</Badge>
                  </div>
                </div>
                <div style={{ fontSize:12,color:C.mutedLight,marginBottom:10 }}>{f.desc}</div>
                <ProgressBar value={f.pct} max={100} label={`${f.pct}% complete`}/>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab==="design" && (
        <Card>
          <div style={{ padding:"16px 20px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:15 }}>Patient App Wireframes</div>
          <div style={{ padding:32,textAlign:"center" }}>
            <div style={{ fontSize:48,marginBottom:12 }}>📐</div>
            <div style={{ fontWeight:700,fontSize:16,marginBottom:8 }}>App Design Assets</div>
            <div style={{ color:C.mutedLight,fontSize:13 }}>Figma wireframes and screen flows for the patient app are in design review. React Native development begins after web platform reaches 80% completion.</div>
            <div style={{ marginTop:16,display:"flex",gap:12,justifyContent:"center" }}>
              <Btn icon="📐" outline>View Wireframes</Btn>
              <Btn icon="📱" outline>Design Spec</Btn>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── STAFF APP MODULE ─────────────────────────────────────────────────────────
function StaffAppModule({ auth }) {
  const [tab, setTab] = useState("overview");

  const features = [
    { name:"Mobile Attendance Check-In", status:"In Progress", pct:55, icon:"📍", desc:"GPS-verified check-in/out with geofence validation" },
    { name:"Duty Updates & Schedule", status:"In Progress", pct:60, icon:"🗓️", desc:"View roster, upcoming duties, shift details" },
    { name:"OTP Verification Workflow", status:"Planned", pct:25, icon:"🔢", desc:"Generate and submit OTP for patient visit confirmation" },
    { name:"Medical Chart Entry", status:"Planned", pct:15, icon:"📊", desc:"Enter vitals, nursing notes, medication charts at bedside" },
    { name:"Training & MCQ Module", status:"Planned", pct:20, icon:"🎓", desc:"Access training materials and take MCQ tests on mobile" },
    { name:"Incident Reporting", status:"Planned", pct:20, icon:"🚨", desc:"Report incidents immediately from the field" },
    { name:"Leave & Availability", status:"In Progress", pct:45, icon:"🏖️", desc:"Apply for leave, mark availability preferences" },
    { name:"Push Notifications", status:"Planned", pct:15, icon:"🔔", desc:"Duty alerts, schedule changes, compliance reminders" },
  ];

  return (
    <div>
      <AlertBanner type="info" icon="🧑‍💼" title="Staff App is under active development (~45% complete)" sub="— Attendance and duty flows are priority"/>
      <div style={{ display:"flex",gap:4,background:C.bg,padding:4,borderRadius:10,marginBottom:16,width:"fit-content" }}>
        {["overview","features","design"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,textTransform:"capitalize",background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.text }}>{t}</button>
        ))}
      </div>

      {tab==="overview" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 }}>
            <StatCard icon="✅" label="Features Done" value={features.filter(f=>f.pct>=80).length} gradient={G.green}/>
            <StatCard icon="🔄" label="In Progress" value={features.filter(f=>f.pct>10&&f.pct<80).length} gradient={G.blue}/>
            <StatCard icon="📋" label="Planned" value={features.filter(f=>f.pct<=10).length} gradient={G.amber}/>
            <StatCard icon="📊" label="Overall" value="~45%" gradient={G.purple}/>
          </div>
          <Card>
            <div style={{ padding:"14px 18px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:14 }}>Feature Completion</div>
            <div style={{ padding:16 }}>
              {features.map((f,i)=>(
                <div key={i} style={{ marginBottom:16 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:6 }}>
                    <span style={{ fontSize:18 }}>{f.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600,fontSize:13 }}>{f.name}</div>
                      <div style={{ fontSize:11,color:C.mutedLight }}>{f.desc}</div>
                    </div>
                    <Badge color={f.status==="Planned"?"gray":f.pct>=80?"green":"blue"}>{f.status}</Badge>
                  </div>
                  <ProgressBar value={f.pct} max={100}/>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab==="features" && (
        <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14 }}>
          {features.map((f,i)=>(
            <Card key={i}>
              <div style={{ padding:"18px 20px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
                  <span style={{ fontSize:28 }}>{f.icon}</span>
                  <div>
                    <div style={{ fontWeight:700,fontSize:14 }}>{f.name}</div>
                    <Badge color={f.status==="Planned"?"gray":f.pct>=80?"green":"blue"}>{f.status}</Badge>
                  </div>
                </div>
                <div style={{ fontSize:12,color:C.mutedLight,marginBottom:10 }}>{f.desc}</div>
                <ProgressBar value={f.pct} max={100} label={`${f.pct}% complete`}/>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab==="design" && (
        <Card>
          <div style={{ padding:"16px 20px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:15 }}>Staff App Design & Tech Stack</div>
          <div style={{ padding:24 }}>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16 }}>
              {[
                { label:"Framework", value:"React Native", icon:"⚛️" },
                { label:"Maps & GPS", value:"Google Maps SDK", icon:"🗺️" },
                { label:"Auth", value:"JWT + Biometric", icon:"🔐" },
                { label:"Offline Support", value:"SQLite Cache", icon:"💾" },
                { label:"Push Notifications", value:"Firebase FCM", icon:"🔔" },
                { label:"OTP", value:"Twilio SMS", icon:"📱" },
              ].map((s,i)=>(
                <div key={i} style={{ background:C.bg,borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:24,marginBottom:6 }}>{s.icon}</div>
                  <div style={{ fontSize:11,color:C.mutedLight,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em" }}>{s.label}</div>
                  <div style={{ fontWeight:700,fontSize:14,marginTop:2 }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// WALLET MODULE — Overview, Refund Requests, Reports, Patient Drilldown
// ═══════════════════════════════════════════════════════════════════════════
function WalletModule({ auth, user }) {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState({});
  const [wallets, setWallets] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [selectedPid, setSelectedPid] = useState(null);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState("");
  const [refundStatusFilter, setRefundStatusFilter] = useState("");
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundForm, setRefundForm] = useState({});
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ direction:"credit" });
  const [saving, setSaving] = useState(false);
  // Report filters
  const [rFrom, setRFrom] = useState(""); const [rTo, setRTo] = useState("");
  const [rType, setRType] = useState(""); const [rPid, setRPid]   = useState("");
  const [report, setReport] = useState({ rows:[], totals:{credits:0,debits:0,net:0,count:0} });
  const [patients, setPatients] = useState([]);

  const role = user?.role || "";
  const isAdmin = role === "admin";

  function loadStats(){ auth("/wallet/dashboard-stats").then(r=>r.json()).then(setStats).catch(()=>{}); }
  function loadWallets(){
    const q = new URLSearchParams({ min_balance:"0" });
    if (search) q.set("search", search);
    auth(`/wallets?${q}`).then(r=>r.json())
      .then(d=>Array.isArray(d)&&setWallets(d)).catch(()=>setWallets([]));
  }
  function loadRefunds(){
    const q = new URLSearchParams(refundStatusFilter ? { status:refundStatusFilter } : {});
    auth(`/wallet/refund-requests?${q}`).then(r=>r.json())
      .then(d=>Array.isArray(d)&&setRefunds(d)).catch(()=>setRefunds([]));
  }
  function loadPatientWallet(pid){
    auth(`/wallet/${pid}`).then(r=>r.json()).then(setSelectedWallet).catch(()=>{});
    auth(`/wallet/${pid}/transactions`).then(r=>r.json())
      .then(d=>Array.isArray(d)&&setTransactions(d)).catch(()=>setTransactions([]));
  }
  function loadPatients(){ auth("/patients").then(r=>r.json()).then(d=>Array.isArray(d)&&setPatients(d)).catch(()=>{}); }
  function runReport(){
    const q = new URLSearchParams();
    if (rFrom) q.set("from", rFrom); if (rTo) q.set("to", rTo);
    if (rType) q.set("tx_type", rType); if (rPid) q.set("patient_id", rPid);
    auth(`/reports/wallet?${q}`).then(r=>r.json()).then(setReport).catch(()=>{});
  }

  useEffect(()=>{ loadStats(); loadPatients(); }, []);
  useEffect(()=>{ if(tab==="overview") loadWallets(); }, [tab, search]);
  useEffect(()=>{ if(tab==="refunds") loadRefunds(); }, [tab, refundStatusFilter]);
  useEffect(()=>{ if(selectedPid) loadPatientWallet(selectedPid); }, [selectedPid]);

  async function submitRefundRequest() {
    if (saving) return; setSaving(true);
    try {
      const r = await auth(`/wallet/${selectedPid}/refund-request`, { method:"POST", body: JSON.stringify(refundForm) });
      const d = await r.json();
      if (!r.ok) { alert(d.message || d.detail || "Failed"); return; }
      alert(d.message || "Refund request submitted");
      setShowRefundForm(false); setRefundForm({});
      loadPatientWallet(selectedPid); loadStats();
    } catch(e){ alert("Network error"); } finally { setSaving(false); }
  }

  async function adjustWallet() {
    if (saving) return; setSaving(true);
    try {
      const r = await auth(`/wallet/${selectedPid}/adjust`, { method:"POST", body: JSON.stringify(adjustForm) });
      const d = await r.json();
      if (!r.ok) { alert(d.message || d.detail || "Failed"); return; }
      alert(d.message || "Wallet adjusted");
      setShowAdjust(false); setAdjustForm({ direction:"credit" });
      loadPatientWallet(selectedPid); loadStats();
    } catch(e){ alert("Network error"); } finally { setSaving(false); }
  }

  async function actionRefund(rid, status, remarks="") {
    const r = await auth(`/wallet/refund-requests/${rid}/status`, { method:"PATCH", body: JSON.stringify({ status, remarks }) });
    const d = await r.json();
    if (!r.ok) { alert(d.message || d.detail || "Failed"); return; }
    alert(d.message || "Updated"); loadRefunds(); loadStats();
  }

  // ───────── Render ─────────
  const tabs = [
    { id:"overview", label:"Wallet Overview" },
    { id:"refunds",  label:"Refund Requests" },
    { id:"reports",  label:"Reports" },
  ];

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:16 }}>
        <StatCard icon="💼" label="Total Wallet Balance" value={`₹${(stats.totalWalletBalance||0).toLocaleString("en-IN")}`} sub={`${stats.patientsWithBalance||0} patients`} gradient={G.teal} />
        <StatCard icon="↩️" label="Pending Refunds" value={stats.pendingRefundRequests||0} sub={`${stats.approvedRefundRequests||0} approved`} gradient={G.amber} />
        <StatCard icon="📈" label="Credits This Month" value={`₹${(stats.walletCreditsThisMonth||0).toLocaleString("en-IN")}`} gradient={G.green} />
        <StatCard icon="📉" label="Debits This Month" value={`₹${(stats.walletDebitsThisMonth||0).toLocaleString("en-IN")}`} gradient={G.red} />
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:14, borderBottom:`1px solid ${C.border}` }}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:"10px 16px", fontWeight:700, fontSize:13, background:"none", border:"none",
            color: tab===t.id ? C.accent : C.textSub, cursor:"pointer",
            borderBottom: tab===t.id ? `2px solid ${C.accent}` : "2px solid transparent",
            marginBottom:-1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab==="overview" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1.4fr", gap:14 }}>
          {/* Wallet list */}
          <Card>
            <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.border}` }}>
              <SearchBar value={search} onChange={setSearch} placeholder="Search patient name / mobile / reg…" />
            </div>
            <div style={{ maxHeight:520, overflowY:"auto" }}>
              {wallets.length===0 ? (
                <div style={{ padding:30, textAlign:"center", color:C.muted, fontSize:13 }}>No wallets with balance yet.</div>
              ) : wallets.map(w=>(
                <div key={w.id} onClick={()=>setSelectedPid(w.patient_id)} style={{
                  padding:"12px 14px", cursor:"pointer",
                  borderBottom:`1px solid ${C.border}`,
                  background: selectedPid===w.patient_id ? "#F5F3FF" : "#fff",
                }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:14 }}>{w.patient_name||"Patient"}</div>
                      <div style={{ fontSize:11, color:C.muted }}>{w.reg_number} · {w.patient_mobile}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontWeight:800, color:C.green, fontSize:15 }}>₹{(w.current_balance||0).toLocaleString("en-IN")}</div>
                      <div style={{ fontSize:10, color:C.muted }}>balance</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Selected wallet detail */}
          <Card>
            {!selectedPid ? (
              <div style={{ padding:40, textAlign:"center", color:C.muted }}>← Select a patient to view wallet details</div>
            ) : (
              <div>
                <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:"uppercase" }}>Wallet</div>
                    <div style={{ fontWeight:800, fontSize:18 }}>{selectedWallet?.patient_name||"…"}</div>
                    <div style={{ fontSize:11, color:C.muted }}>{selectedWallet?.reg_number} · {selectedWallet?.patient_mobile}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:11, color:C.muted }}>Current Balance</div>
                    <div style={{ fontSize:26, fontWeight:900, color:C.green }}>₹{(selectedWallet?.current_balance||0).toLocaleString("en-IN")}</div>
                  </div>
                </div>
                {/* Mini stats */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, padding:14 }}>
                  <div style={{ background:"#ECFDF5", padding:10, borderRadius:8 }}>
                    <div style={{ fontSize:10, color:"#065F46", fontWeight:700 }}>TOTAL CREDITED</div>
                    <div style={{ fontWeight:800, color:C.green }}>₹{(selectedWallet?.total_credited||0).toLocaleString("en-IN")}</div>
                  </div>
                  <div style={{ background:"#FEE2E2", padding:10, borderRadius:8 }}>
                    <div style={{ fontSize:10, color:"#991B1B", fontWeight:700 }}>TOTAL DEBITED</div>
                    <div style={{ fontWeight:800, color:C.red }}>₹{(selectedWallet?.total_debited||0).toLocaleString("en-IN")}</div>
                  </div>
                  <div style={{ background:"#FEF3C7", padding:10, borderRadius:8 }}>
                    <div style={{ fontSize:10, color:"#92400E", fontWeight:700 }}>TOTAL REFUNDED</div>
                    <div style={{ fontWeight:800, color:C.amber }}>₹{(selectedWallet?.total_refunded||0).toLocaleString("en-IN")}</div>
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display:"flex", gap:8, padding:"0 14px 12px", flexWrap:"wrap" }}>
                  <Btn small color={C.red} disabled={!(selectedWallet?.current_balance>0)} onClick={()=>{ setRefundForm({ amount: selectedWallet?.current_balance, payment_mode:"Bank Transfer" }); setShowRefundForm(true); }}>↩️ Request Refund</Btn>
                  {isAdmin && <Btn small color={C.purple} onClick={()=>{ setAdjustForm({ direction:"credit" }); setShowAdjust(true); }}>⚙️ Manual Adjustment</Btn>}
                </div>
                {/* Transactions */}
                <div style={{ padding:"0 14px 14px" }}>
                  <div style={{ fontWeight:700, fontSize:13, marginBottom:8 }}>Recent Transactions</div>
                  {transactions.length===0 ? (
                    <div style={{ textAlign:"center", color:C.muted, fontSize:12, padding:20 }}>No transactions yet.</div>
                  ) : (
                    <Table cols={[
                      { label:"Date", render:t=><div style={{ fontSize:11 }}>{(t.created_at||"").slice(0,16).replace("T"," ")}</div> },
                      { label:"Type", render:t=><Badge color={ ["CREDIT","ADJUSTMENT"].includes(t.transaction_type) ? "green" : "red"}>{t.transaction_type}</Badge> },
                      { label:"Amount", render:t=><div style={{ fontWeight:700, color: ["CREDIT","ADJUSTMENT"].includes(t.transaction_type) ? C.green : C.red }}>{["CREDIT","ADJUSTMENT"].includes(t.transaction_type) ? "+" : "−"}₹{(t.amount||0).toLocaleString("en-IN")}</div> },
                      { label:"Balance After", render:t=><div style={{ fontSize:12 }}>₹{(t.balance_after||0).toLocaleString("en-IN")}</div> },
                      { label:"Reference", render:t=><div style={{ fontSize:11 }}>{t.reference_type||"—"} {t.reference_id?`#${t.reference_id}`:""}</div> },
                      { label:"Remarks", render:t=><div style={{ fontSize:11, color:C.textSub }}>{t.remarks||"—"}</div> },
                      { label:"By", render:t=><div style={{ fontSize:11 }}>{t.created_by||"—"}</div> },
                    ]} rows={transactions} />
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* REFUND REQUESTS TAB */}
      {tab==="refunds" && (
        <Card>
          <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.border}`, display:"flex", gap:10, alignItems:"center" }}>
            <select style={{...inp, minWidth:160}} value={refundStatusFilter} onChange={e=>setRefundStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option>Pending</option><option>Approved</option><option>Completed</option><option>Rejected</option>
            </select>
            <div style={{ fontSize:13, color:C.muted }}>{refunds.length} request(s)</div>
          </div>
          <Table cols={[
            { label:"Date", render:r=><div style={{ fontSize:11 }}>{(r.created_at||"").slice(0,16).replace("T"," ")}</div> },
            { label:"Patient", render:r=><div><div style={{ fontWeight:600 }}>{r.patient_name}</div><div style={{ fontSize:11, color:C.muted }}>{r.reg_number} · {r.patient_mobile}</div></div> },
            { label:"Amount", render:r=><div style={{ fontWeight:700, color:C.red }}>₹{(r.amount||0).toLocaleString("en-IN")}</div> },
            { label:"Mode", render:r=><div style={{ fontSize:12 }}>{r.payment_mode}<br/><span style={{ fontSize:10, color:C.muted }}>{r.bank_ref||r.upi_id||""}</span></div> },
            { label:"Reason", render:r=><div style={{ fontSize:12, maxWidth:200, whiteSpace:"normal" }}>{r.reason||"—"}</div> },
            { label:"Status", render:r=><Badge color={r.status==="Completed"?"green":r.status==="Approved"?"blue":r.status==="Rejected"?"red":"amber"}>{r.status}</Badge> },
            { label:"Requested By", render:r=><div style={{ fontSize:11 }}>{r.requested_by}</div> },
            { label:"Actions", render:r=>(
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {isAdmin && r.status==="Pending" && (
                  <>
                    <Btn small color={C.green} onClick={()=>actionRefund(r.id, "Approved")}>Approve</Btn>
                    <Btn small danger onClick={()=>{ const reason = prompt("Rejection reason:"); if(reason!==null) actionRefund(r.id, "Rejected", reason); }}>Reject</Btn>
                  </>
                )}
                {isAdmin && r.status==="Approved" && (
                  <Btn small color={C.purple} onClick={()=>actionRefund(r.id, "Completed", "Payment disbursed")}>Mark Completed</Btn>
                )}
              </div>
            )},
          ]} rows={refunds} />
          {refunds.length===0 && <div style={{ padding:30, textAlign:"center", color:C.muted, fontSize:13 }}>No refund requests.</div>}
        </Card>
      )}

      {/* REPORTS TAB */}
      {tab==="reports" && (
        <Card>
          <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`, display:"grid", gridTemplateColumns:"repeat(5, 1fr) auto", gap:10, alignItems:"end" }}>
            <Input label="From" type="date" value={rFrom} onChange={e=>setRFrom(e.target.value)} />
            <Input label="To"   type="date" value={rTo}   onChange={e=>setRTo(e.target.value)} />
            <Select label="Type" value={rType} onChange={e=>setRType(e.target.value)} options={["", "CREDIT","DEBIT","REFUND","ADJUSTMENT"]} />
            <Select label="Patient" value={rPid} onChange={e=>setRPid(e.target.value)} options={[{value:"", label:"All"}, ...patients.map(p=>({ value:p.id, label:p.name }))]} />
            <div></div>
            <div style={{ display:"flex", gap:6 }}>
              <Btn small onClick={runReport}>Run</Btn>
              <Btn small outline onClick={()=>{
                const token = localStorage.getItem("ro_token");
                window.open(`${(process.env.REACT_APP_BACKEND_URL||"")}/api/exports/wallet_transactions.xlsx?_t=${Date.now()}`, "_blank");
              }}>Excel</Btn>
              <Btn small outline onClick={()=>{
                window.open(`${(process.env.REACT_APP_BACKEND_URL||"")}/api/exports/wallet_transactions.csv?_t=${Date.now()}`, "_blank");
              }}>CSV</Btn>
            </div>
          </div>

          {/* Totals */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, padding:14 }}>
            <div style={{ background:"#ECFDF5", padding:12, borderRadius:8 }}>
              <div style={{ fontSize:10, color:"#065F46", fontWeight:700 }}>CREDITS</div>
              <div style={{ fontWeight:800, fontSize:18, color:C.green }}>₹{(report.totals?.credits||0).toLocaleString("en-IN")}</div>
            </div>
            <div style={{ background:"#FEE2E2", padding:12, borderRadius:8 }}>
              <div style={{ fontSize:10, color:"#991B1B", fontWeight:700 }}>DEBITS/REFUNDS</div>
              <div style={{ fontWeight:800, fontSize:18, color:C.red }}>₹{(report.totals?.debits||0).toLocaleString("en-IN")}</div>
            </div>
            <div style={{ background:"#EFF6FF", padding:12, borderRadius:8 }}>
              <div style={{ fontSize:10, color:"#1E40AF", fontWeight:700 }}>NET</div>
              <div style={{ fontWeight:800, fontSize:18, color:C.blue }}>₹{(report.totals?.net||0).toLocaleString("en-IN")}</div>
            </div>
            <div style={{ background:"#F5F3FF", padding:12, borderRadius:8 }}>
              <div style={{ fontSize:10, color:"#5B21B6", fontWeight:700 }}>TRANSACTIONS</div>
              <div style={{ fontWeight:800, fontSize:18, color:C.purple }}>{report.totals?.count||0}</div>
            </div>
          </div>

          <Table cols={[
            { label:"Date", render:t=><div style={{ fontSize:11 }}>{(t.created_at||"").slice(0,16).replace("T"," ")}</div> },
            { label:"Patient", render:t=><div><div style={{ fontWeight:600, fontSize:12 }}>{t.patient_name}</div><div style={{ fontSize:10, color:C.muted }}>{t.reg_number}</div></div> },
            { label:"Type", render:t=><Badge color={ ["CREDIT","ADJUSTMENT"].includes(t.transaction_type) ? "green" : "red"}>{t.transaction_type}</Badge> },
            { label:"Amount", render:t=><div style={{ fontWeight:700, color: ["CREDIT","ADJUSTMENT"].includes(t.transaction_type) ? C.green : C.red }}>{["CREDIT","ADJUSTMENT"].includes(t.transaction_type) ? "+" : "−"}₹{(t.amount||0).toLocaleString("en-IN")}</div> },
            { label:"Balance", render:t=><div style={{ fontSize:12 }}>₹{(t.balance_after||0).toLocaleString("en-IN")}</div> },
            { label:"Reference", render:t=><div style={{ fontSize:11 }}>{t.reference_type}</div> },
            { label:"By", render:t=><div style={{ fontSize:11 }}>{t.created_by}</div> },
          ]} rows={report.rows||[]} />
          {(report.rows||[]).length===0 && <div style={{ padding:30, textAlign:"center", color:C.muted, fontSize:13 }}>Click &ldquo;Run&rdquo; with filters above to load transactions.</div>}
        </Card>
      )}

      {/* Refund Request modal */}
      <Modal open={showRefundForm} title={`Request Refund — ${selectedWallet?.patient_name||""}`} onClose={()=>setShowRefundForm(false)}>
        <div style={{ background:"#FEF3C7", padding:10, borderRadius:8, fontSize:12, marginBottom:12, color:"#92400E" }}>
          Available Wallet Balance: <strong>₹{(selectedWallet?.current_balance||0).toLocaleString("en-IN")}</strong>
        </div>
        <Grid cols={2}>
          <Input label="Refund Amount (₹)" type="number" required value={refundForm.amount||""} onChange={e=>setRefundForm(f=>({...f, amount:e.target.value}))} />
          <Select label="Payment Mode" value={refundForm.payment_mode||"Bank Transfer"} onChange={e=>setRefundForm(f=>({...f, payment_mode:e.target.value}))} options={["Bank Transfer","UPI","Cheque","Cash"]} />
          <Input label="Account Name" value={refundForm.account_name||""} onChange={e=>setRefundForm(f=>({...f, account_name:e.target.value}))} />
          <Input label="Account Number" value={refundForm.account_number||""} onChange={e=>setRefundForm(f=>({...f, account_number:e.target.value}))} />
          <Input label="IFSC" value={refundForm.ifsc||""} onChange={e=>setRefundForm(f=>({...f, ifsc:e.target.value}))} />
          <Input label="UPI ID" value={refundForm.upi_id||""} onChange={e=>setRefundForm(f=>({...f, upi_id:e.target.value}))} />
          <Input label="Bank Reference No." value={refundForm.bank_ref||""} onChange={e=>setRefundForm(f=>({...f, bank_ref:e.target.value}))} />
        </Grid>
        <Textarea label="Refund Reason" required value={refundForm.reason||""} onChange={e=>setRefundForm(f=>({...f, reason:e.target.value}))} rows={2} />
        <Textarea label="Remarks" value={refundForm.remarks||""} onChange={e=>setRefundForm(f=>({...f, remarks:e.target.value}))} rows={2} />
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:12 }}>
          <Btn outline onClick={()=>setShowRefundForm(false)}>Cancel</Btn>
          <Btn color={C.red} onClick={submitRefundRequest} disabled={saving}>{saving?"Submitting…":"Submit Refund Request"}</Btn>
        </div>
      </Modal>

      {/* Manual Adjustment modal (admin only) */}
      <Modal open={showAdjust} title={`Manual Wallet Adjustment — ${selectedWallet?.patient_name||""}`} onClose={()=>setShowAdjust(false)}>
        <Grid cols={2}>
          <Select label="Direction" value={adjustForm.direction||"credit"} onChange={e=>setAdjustForm(f=>({...f, direction:e.target.value}))} options={[{value:"credit",label:"Credit (add to wallet)"}, {value:"debit",label:"Debit (remove from wallet)"}]} />
          <Input label="Amount (₹)" type="number" required value={adjustForm.amount||""} onChange={e=>setAdjustForm(f=>({...f, amount:e.target.value}))} />
        </Grid>
        <Textarea label="Reason / Remarks" required value={adjustForm.remarks||""} onChange={e=>setAdjustForm(f=>({...f, remarks:e.target.value}))} rows={2} />
        <div style={{ fontSize:11, color:C.muted, marginTop:6 }}>⚠️ This is an immutable, audit-logged action. Only Super Admin can perform manual adjustments.</div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:12 }}>
          <Btn outline onClick={()=>setShowAdjust(false)}>Cancel</Btn>
          <Btn color={C.purple} onClick={adjustWallet} disabled={saving}>{saving?"Saving…":"Save Adjustment"}</Btn>
        </div>
      </Modal>
    </div>
  );
}
