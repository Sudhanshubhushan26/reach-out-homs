// Phase 2 UI modules — User Mgmt, Audit Logs, Inventory & Lending,
// Notification Templates, Advanced Analytics (NPS + Forecast),
// Auto-Allocate, Advanced Payroll details, Incident Workflow
import { useEffect, useState, useMemo } from "react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const C = {
  bg:"#F7F5FF", card:"#FFFFFF", text:"#1F1147", muted:"#6B5B95", border:"#E9E2FF",
  purple:"#7C3AED", indigo:"#4F46E5", red:"#DC2626", green:"#16A34A",
  amber:"#D97706", blue:"#1E40AF", teal:"#0F766E", orange:"#EA580C",
};

const fetchJson = async (auth, path, opts={}) => {
  const r = await fetch(API+path, {
    ...opts,
    headers: { "Content-Type":"application/json", "Authorization": "Bearer "+auth, ...(opts.headers||{}) },
  });
  if (!r.ok) {
    let msg = "Request failed";
    try { const e = await r.json(); msg = e.detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
};

const Card = ({title, action, children, gradient}) => (
  <div style={{ background:C.card, borderRadius:14, boxShadow:"0 1px 3px rgba(31,17,71,0.06)", border:`1px solid ${C.border}`, marginBottom:16, overflow:"hidden" }}>
    {title && (
      <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", background: gradient || "transparent" }}>
        <h3 style={{ margin:0, fontSize:15, fontWeight:800, color: gradient ? "#fff" : C.text }}>{title}</h3>
        {action}
      </div>
    )}
    <div style={{ padding:18 }}>{children}</div>
  </div>
);

const Btn = ({onClick, kind="primary", small, outline, children, disabled, "data-testid": tid}) => {
  const colors = { primary:C.purple, danger:C.red, success:C.green, secondary:C.indigo, warning:C.amber };
  const bg = outline ? "transparent" : colors[kind];
  const color = outline ? colors[kind] : "#fff";
  const border = outline ? `1px solid ${colors[kind]}` : "none";
  return (
    <button onClick={onClick} disabled={disabled} data-testid={tid}
      style={{ padding: small?"6px 12px":"9px 18px", fontSize: small?12:13, fontWeight:700,
        background:bg, color, border, borderRadius:8, cursor:disabled?"not-allowed":"pointer",
        opacity:disabled?0.5:1, transition:"all 0.15s" }}>
      {children}
    </button>
  );
};

const Input = (props) => (
  <input {...props} style={{ width:"100%", padding:"9px 12px", border:`1px solid ${C.border}`,
    borderRadius:8, fontSize:13, color:C.text, background:"#FAFAFA", outline:"none",
    boxSizing:"border-box", ...(props.style||{}) }} />
);

const Select = ({value, onChange, options, placeholder, "data-testid":tid}) => (
  <select value={value||""} onChange={e=>onChange(e.target.value)} data-testid={tid}
    style={{ width:"100%", padding:"9px 12px", border:`1px solid ${C.border}`, borderRadius:8,
      fontSize:13, background:"#FAFAFA", color:C.text, outline:"none", boxSizing:"border-box" }}>
    <option value="">{placeholder||"-- Select --"}</option>
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const Badge = ({label, color}) => (
  <span style={{ padding:"3px 10px", borderRadius:11, fontSize:11, fontWeight:700,
    background: color+"22", color, border:`1px solid ${color}44` }}>{label}</span>
);

const Stat = ({label, value, sub, color}) => (
  <div style={{ flex:1, minWidth:160, padding:16, borderRadius:12, background:"#fff",
    border:`1px solid ${C.border}`, borderLeft:`4px solid ${color||C.purple}` }}>
    <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>
    <div style={{ fontSize:26, fontWeight:900, color:C.text, margin:"4px 0" }}>{value}</div>
    {sub && <div style={{ fontSize:11, color:C.muted }}>{sub}</div>}
  </div>
);

const Table = ({cols, rows, empty="No data"}) => (
  <div style={{ overflowX:"auto" }}>
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
      <thead>
        <tr style={{ background:"#F5F3FF" }}>
          {cols.map(c => (
            <th key={c.k} style={{ padding:"10px 12px", textAlign: c.align||"left", color:C.muted, fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", borderBottom:`1px solid ${C.border}` }}>{c.h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length===0 ? (
          <tr><td colSpan={cols.length} style={{ padding:"24px", textAlign:"center", color:C.muted }}>{empty}</td></tr>
        ) : rows.map((r,i) => (
          <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
            {cols.map(c => (
              <td key={c.k} style={{ padding:"10px 12px", textAlign:c.align||"left", color:C.text }}>{c.r ? c.r(r) : (r[c.k] ?? "")}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ═════════════════════════ USER MANAGEMENT (admin) ═════════════════════════
export function UserMgmtModule({ auth, user }) {
  const [users, setUsers] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ username:"", name:"", role:"manager", password:"", phone:"", email:"" });
  const [err, setErr] = useState("");
  const isAdmin = user?.role === "admin";

  const load = async () => {
    try { setUsers(await fetchJson(auth, "/users")); }
    catch(e){ setErr(e.message); }
  };
  useEffect(()=>{ load(); }, []);

  if (!isAdmin) return <Card title="User Management"><div style={{color:C.red, padding:24, textAlign:"center"}}>🔒 Admin role required</div></Card>;

  const save = async () => {
    setErr("");
    try {
      await fetchJson(auth, "/users", { method:"POST", body:JSON.stringify(form) });
      setShow(false); setForm({ username:"", name:"", role:"manager", password:"", phone:"", email:"" });
      load();
    } catch(e){ setErr(e.message); }
  };

  const toggleStatus = async (u) => {
    try { await fetchJson(auth, "/users/"+u.id, { method:"PUT", body:JSON.stringify({status: u.status==="Active" ? "Disabled" : "Active"}) }); load(); }
    catch(e){ setErr(e.message); }
  };

  return (
    <div>
      <h2 style={{margin:"0 0 16px", color:C.text}}>👥 User Management</h2>
      <Card title={`All Users (${users.length})`} action={<Btn small onClick={()=>setShow(true)} data-testid="create-user-btn">+ New User</Btn>}>
        <Table cols={[
          {k:"username", h:"Username"},
          {k:"name", h:"Name"},
          {k:"role", h:"Role", r:r=><Badge label={r.role} color={r.role==="admin"?C.red:r.role==="manager"?C.purple:C.blue}/>},
          {k:"phone", h:"Phone"},
          {k:"email", h:"Email"},
          {k:"status", h:"Status", r:r=><Badge label={r.status||"Active"} color={r.status==="Disabled"?C.red:C.green}/>},
          {k:"actions", h:"", align:"right", r:r=>(
            <Btn small outline kind="danger" onClick={()=>toggleStatus(r)}>{r.status==="Disabled"?"Enable":"Disable"}</Btn>
          )},
        ]} rows={users} />
      </Card>

      {show && (
        <div style={{position:"fixed", inset:0, background:"rgba(31,17,71,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:20}} onClick={()=>setShow(false)}>
          <div style={{background:"#fff", borderRadius:14, padding:24, width:480, maxWidth:"100%"}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:"0 0 16px"}}>Create User</h3>
            {err && <div style={{padding:10, background:"#FEE2E2", color:C.red, borderRadius:8, marginBottom:12, fontSize:12}}>{err}</div>}
            <div style={{display:"grid", gap:10}}>
              <Input placeholder="Username" value={form.username} onChange={e=>setForm({...form, username:e.target.value})}/>
              <Input placeholder="Full Name" value={form.name} onChange={e=>setForm({...form, name:e.target.value})}/>
              <Select value={form.role} onChange={v=>setForm({...form, role:v})} options={[
                {value:"admin",label:"Admin"},{value:"manager",label:"Manager"},
                {value:"supervisor",label:"Supervisor"},{value:"accountant",label:"Accountant"},
                {value:"foe",label:"Front Office (FOE)"},{value:"staff",label:"Staff"},
              ]}/>
              <Input type="password" placeholder="Password" value={form.password} onChange={e=>setForm({...form, password:e.target.value})}/>
              <Input placeholder="Phone (optional)" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})}/>
              <Input placeholder="Email (optional)" value={form.email} onChange={e=>setForm({...form, email:e.target.value})}/>
            </div>
            <div style={{display:"flex", justifyContent:"flex-end", gap:8, marginTop:16}}>
              <Btn outline onClick={()=>setShow(false)}>Cancel</Btn>
              <Btn onClick={save} data-testid="save-user-btn">Create User</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════ AUDIT LOGS ═════════════════════════
export function AuditLogsModule({ auth }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState({ action:"", target_type:"" });
  useEffect(()=>{
    const q = new URLSearchParams(Object.entries(filter).filter(([_,v])=>v)).toString();
    fetchJson(auth, "/audit-logs?limit=500"+(q?"&"+q:"")).then(setLogs).catch(()=>setLogs([]));
  }, [filter]);

  return (
    <div>
      <h2 style={{margin:"0 0 16px"}}>🛡️ Audit Logs</h2>
      <Card title={`Activity Trail (${logs.length})`}>
        <div style={{display:"flex", gap:10, marginBottom:14, flexWrap:"wrap"}}>
          <div style={{minWidth:200}}>
            <Select value={filter.action} onChange={v=>setFilter({...filter, action:v})} placeholder="All actions" options={[
              {value:"create",label:"Create"},{value:"update",label:"Update"},
              {value:"delete",label:"Delete"},{value:"verify",label:"Verify"},
              {value:"approve",label:"Approve"},{value:"export",label:"Export"},
              {value:"dispatch",label:"Dispatch"},{value:"close",label:"Close"},
            ]}/>
          </div>
          <div style={{minWidth:200}}>
            <Select value={filter.target_type} onChange={v=>setFilter({...filter, target_type:v})} placeholder="All targets" options={[
              {value:"user",label:"User"},{value:"refund",label:"Refund"},
              {value:"booking",label:"Booking"},{value:"staff_rating",label:"Rating"},
              {value:"inventory_item",label:"Inventory"},{value:"lending",label:"Lending"},
              {value:"incident",label:"Incident"},{value:"notif_template",label:"Notif Template"},
            ]}/>
          </div>
        </div>
        <Table cols={[
          {k:"created_at", h:"When", r:r=>r.created_at?.slice(0,19).replace("T"," ")},
          {k:"user", h:"User", r:r=><span>{r.user_name} <Badge label={r.user_role||"?"} color={C.indigo}/></span>},
          {k:"action", h:"Action", r:r=><Badge label={r.action} color={
            r.action==="delete"||r.action==="disable"?C.red :
            r.action==="approve"||r.action==="close"?C.green : C.amber}/>},
          {k:"target", h:"Target", r:r=><span><b>{r.target_type}</b>{r.target_id?" #"+r.target_id:""}</span>},
          {k:"notes", h:"Notes", r:r=>r.notes||""},
        ]} rows={logs} empty="No audit logs match the filters"/>
      </Card>
    </div>
  );
}

// ═════════════════════════ INVENTORY + LENDING ═════════════════════════
export function InventoryLendingModule({ auth, user }) {
  const [tab, setTab] = useState("items");
  const [items, setItems] = useState([]);
  const [lendings, setLendings] = useState([]);
  const [patients, setPatients] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showLend, setShowLend] = useState(false);
  const [itemForm, setItemForm] = useState({ name:"", category:"Equipment", total_qty:1, location:"Main Office", deposit_required:0 });
  const [lendForm, setLendForm] = useState({ item_id:"", patient_id:"", qty:1, deposit:0, expected_return:"" });
  const [err, setErr] = useState("");

  const load = async () => {
    setItems(await fetchJson(auth, "/inventory"));
    setLendings(await fetchJson(auth, "/lendings"));
    setPatients(await fetchJson(auth, "/patients"));
  };
  useEffect(()=>{ load().catch(e=>setErr(e.message)); }, []);

  const addItem = async () => {
    setErr("");
    try { await fetchJson(auth, "/inventory", {method:"POST", body:JSON.stringify(itemForm)}); setShowAdd(false); setItemForm({ name:"", category:"Equipment", total_qty:1, location:"Main Office", deposit_required:0 }); load(); }
    catch(e){ setErr(e.message); }
  };
  const lend = async () => {
    setErr("");
    try { await fetchJson(auth, "/lendings", {method:"POST", body:JSON.stringify(lendForm)}); setShowLend(false); setLendForm({ item_id:"", patient_id:"", qty:1, deposit:0, expected_return:"" }); load(); }
    catch(e){ setErr(e.message); }
  };
  const doReturn = async (l) => {
    const damage = prompt("Damage charge (₹)? 0 for no damage:", "0");
    if (damage===null) return;
    try { await fetchJson(auth, "/lendings/"+l.id+"/return", {method:"PATCH", body:JSON.stringify({damage_charge:Number(damage)||0, condition_at_return: damage>0?"Damaged":"Good"})}); load(); }
    catch(e){ alert(e.message); }
  };

  return (
    <div>
      <h2 style={{margin:"0 0 16px"}}>📦 Inventory & Equipment Lending</h2>
      <div style={{display:"flex", gap:6, marginBottom:14}}>
        <Btn small outline={tab!=="items"} onClick={()=>setTab("items")}>📦 Items ({items.length})</Btn>
        <Btn small outline={tab!=="lendings"} onClick={()=>setTab("lendings")}>🔁 Lendings ({lendings.length})</Btn>
      </div>

      {tab==="items" && (
        <Card title="Inventory Items" action={<Btn small onClick={()=>setShowAdd(true)} data-testid="add-inventory-btn">+ Add Item</Btn>}>
          <Table cols={[
            {k:"item_code", h:"Code"},
            {k:"name", h:"Name"},
            {k:"category", h:"Category"},
            {k:"total_qty", h:"Total", align:"center"},
            {k:"available_qty", h:"Available", align:"center", r:r=><b style={{color: r.available_qty>0?C.green:C.red}}>{r.available_qty}</b>},
            {k:"lent_qty", h:"Lent Out", align:"center"},
            {k:"location", h:"Location"},
            {k:"actions", h:"", r:r=>(
              <Btn small onClick={()=>{setLendForm({...lendForm, item_id:r.id}); setShowLend(true);}} disabled={r.available_qty<=0}>Lend</Btn>
            )},
          ]} rows={items} />
        </Card>
      )}

      {tab==="lendings" && (
        <Card title="Active & Past Lendings">
          <Table cols={[
            {k:"id", h:"#"},
            {k:"item_name", h:"Item"},
            {k:"patient_name", h:"Patient"},
            {k:"qty", h:"Qty", align:"center"},
            {k:"issued_date", h:"Issued"},
            {k:"expected_return", h:"Expected Return"},
            {k:"deposit", h:"Deposit (₹)", align:"right", r:r=>"₹"+(r.deposit||0).toLocaleString("en-IN")},
            {k:"status", h:"Status", r:r=><Badge label={r.status} color={r.status==="Issued"?C.amber:C.green}/>},
            {k:"actions", h:"", r:r=>r.status==="Issued" && <Btn small kind="success" onClick={()=>doReturn(r)}>Return</Btn>},
          ]} rows={lendings}/>
        </Card>
      )}

      {showAdd && (
        <Modal title="Add Inventory Item" onClose={()=>setShowAdd(false)} onSave={addItem} err={err}>
          <Input placeholder="Item Name (e.g., Oxygen Concentrator 5L)" value={itemForm.name} onChange={e=>setItemForm({...itemForm, name:e.target.value})}/>
          <Select value={itemForm.category} onChange={v=>setItemForm({...itemForm, category:v})} options={[
            {value:"Equipment",label:"Equipment"},{value:"Consumable",label:"Consumable"},
            {value:"Furniture",label:"Furniture"},{value:"Other",label:"Other"}]}/>
          <Input type="number" placeholder="Total Quantity" value={itemForm.total_qty} onChange={e=>setItemForm({...itemForm, total_qty:Number(e.target.value)||1})}/>
          <Input placeholder="Location" value={itemForm.location} onChange={e=>setItemForm({...itemForm, location:e.target.value})}/>
          <Input type="number" placeholder="Default Deposit Required (₹)" value={itemForm.deposit_required} onChange={e=>setItemForm({...itemForm, deposit_required:Number(e.target.value)||0})}/>
        </Modal>
      )}

      {showLend && (
        <Modal title="Lend Equipment" onClose={()=>setShowLend(false)} onSave={lend} err={err} saveLabel="Issue">
          <Select value={lendForm.item_id} onChange={v=>setLendForm({...lendForm, item_id:Number(v)})} placeholder="Select item"
            options={items.filter(i=>i.available_qty>0).map(i=>({value:i.id, label:`${i.name} (${i.available_qty} avail)`}))}/>
          <Select value={lendForm.patient_id} onChange={v=>setLendForm({...lendForm, patient_id:Number(v)})} placeholder="Select patient"
            options={patients.map(p=>({value:p.id, label:`${p.name} (${p.reg_number})`}))}/>
          <Input type="number" placeholder="Quantity" value={lendForm.qty} onChange={e=>setLendForm({...lendForm, qty:Number(e.target.value)||1})}/>
          <Input type="number" placeholder="Deposit (₹)" value={lendForm.deposit} onChange={e=>setLendForm({...lendForm, deposit:Number(e.target.value)||0})}/>
          <Input type="date" placeholder="Expected Return" value={lendForm.expected_return} onChange={e=>setLendForm({...lendForm, expected_return:e.target.value})}/>
        </Modal>
      )}
    </div>
  );
}

// ═════════════════════════ NOTIFICATION TEMPLATES ═════════════════════════
export function NotifTemplatesModule({ auth }) {
  const [templates, setTemplates] = useState([]);
  const [queue, setQueue] = useState({items:[], counts:{}});
  const [tab, setTab] = useState("templates");
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState("");
  const [dispatchMsg, setDispatchMsg] = useState("");

  const load = async () => {
    setTemplates(await fetchJson(auth, "/notif-templates"));
    setQueue(await fetchJson(auth, "/notifications/queue"));
  };
  useEffect(()=>{ load().catch(e=>setErr(e.message)); }, []);

  const save = async () => {
    setErr("");
    try {
      if (edit.id) await fetchJson(auth, "/notif-templates/"+edit.id, { method:"PUT", body:JSON.stringify(edit) });
      else await fetchJson(auth, "/notif-templates", { method:"POST", body:JSON.stringify(edit) });
      setEdit(null); load();
    } catch(e){ setErr(e.message); }
  };

  const dispatch = async () => {
    try { const r = await fetchJson(auth, "/notifications/dispatch", { method:"POST" });
      setDispatchMsg(`✅ Dispatched ${r.dispatched} (WA:${r.channel_breakdown.whatsapp} SMS:${r.channel_breakdown.sms} Email:${r.channel_breakdown.email} App:${r.channel_breakdown["in-app"]})`);
      setTimeout(()=>setDispatchMsg(""), 5000); load();
    } catch(e){ setDispatchMsg("❌ "+e.message); }
  };

  return (
    <div>
      <h2 style={{margin:"0 0 16px"}}>📲 Notification Engine</h2>
      <div style={{display:"flex", gap:6, marginBottom:14}}>
        <Btn small outline={tab!=="templates"} onClick={()=>setTab("templates")}>📝 Templates ({templates.length})</Btn>
        <Btn small outline={tab!=="queue"} onClick={()=>setTab("queue")}>📬 Queue ({queue.items?.length||0})</Btn>
      </div>

      {tab==="templates" && (
        <Card title="Message Templates" action={<Btn small onClick={()=>setEdit({code:"", name:"", channel:"whatsapp", body:""})}>+ New Template</Btn>}>
          <div style={{padding:"8px 0 14px", color:C.muted, fontSize:12}}>
            Use <code style={{background:"#F5F3FF", padding:"2px 6px", borderRadius:4}}>{"{{variable_name}}"}</code> in the body — replaced when sending.
          </div>
          <Table cols={[
            {k:"code", h:"Code", r:r=><code style={{fontSize:12, color:C.purple}}>{r.code}</code>},
            {k:"name", h:"Name"},
            {k:"channel", h:"Channel", r:r=><Badge label={r.channel} color={
              r.channel==="whatsapp"?C.green:r.channel==="sms"?C.blue:r.channel==="email"?C.amber:C.indigo}/>},
            {k:"body", h:"Body Preview", r:r=><span style={{fontSize:11, color:C.muted}}>{(r.body||"").slice(0,80)}…</span>},
            {k:"actions", h:"", r:r=><Btn small outline onClick={()=>setEdit({...r})}>Edit</Btn>},
          ]} rows={templates}/>
        </Card>
      )}

      {tab==="queue" && (
        <>
          <div style={{display:"flex", gap:12, marginBottom:14, flexWrap:"wrap"}}>
            <Stat label="Pending" value={queue.counts?.Pending||0} color={C.amber}/>
            <Stat label="Sent" value={queue.counts?.Sent||0} color={C.green}/>
            <Stat label="Failed" value={queue.counts?.Failed||0} color={C.red}/>
            <div style={{flex:1, minWidth:200, display:"flex", alignItems:"center", justifyContent:"flex-end", gap:10}}>
              {dispatchMsg && <span style={{fontSize:12, color:C.green}}>{dispatchMsg}</span>}
              <Btn onClick={dispatch} disabled={!(queue.counts?.Pending)}>⚡ Dispatch Pending</Btn>
            </div>
          </div>
          <Card title="Recent Notifications">
            <Table cols={[
              {k:"created_at", h:"When", r:r=>r.created_at?.slice(0,19).replace("T"," ")},
              {k:"channel", h:"Channel", r:r=><Badge label={r.channel} color={r.channel==="whatsapp"?C.green:r.channel==="sms"?C.blue:C.indigo}/>},
              {k:"recipient_phone", h:"To"},
              {k:"message", h:"Message", r:r=><span style={{fontSize:11}}>{(r.message||"").slice(0,80)}…</span>},
              {k:"status", h:"Status", r:r=><Badge label={r.status} color={r.status==="Sent"?C.green:r.status==="Pending"?C.amber:C.red}/>},
              {k:"provider_ref", h:"Ref", r:r=><code style={{fontSize:10, color:C.muted}}>{r.provider_ref||""}</code>},
            ]} rows={queue.items||[]}/>
          </Card>
        </>
      )}

      {edit && (
        <Modal title={edit.id?"Edit Template":"New Template"} onClose={()=>setEdit(null)} onSave={save} err={err}>
          <Input placeholder="Code (e.g., booking_confirm)" value={edit.code} onChange={e=>setEdit({...edit, code:e.target.value})}/>
          <Input placeholder="Name" value={edit.name} onChange={e=>setEdit({...edit, name:e.target.value})}/>
          <Select value={edit.channel} onChange={v=>setEdit({...edit, channel:v})} options={[
            {value:"whatsapp",label:"WhatsApp"},{value:"sms",label:"SMS"},
            {value:"email",label:"Email"},{value:"in-app",label:"In-app"},
          ]}/>
          <textarea placeholder="Body — use {{variable}} for tokens" value={edit.body} onChange={e=>setEdit({...edit, body:e.target.value})}
            style={{ width:"100%", padding:"9px 12px", border:`1px solid ${C.border}`, borderRadius:8, fontSize:13,
              fontFamily:"monospace", background:"#FAFAFA", outline:"none", minHeight:120, boxSizing:"border-box" }}/>
        </Modal>
      )}
    </div>
  );
}

// ═════════════════════════ ADVANCED ANALYTICS (NPS + FORECAST) ═════════════════════════
export function AdvancedAnalyticsModule({ auth }) {
  const [nps, setNps] = useState(null);
  const [fc, setFc] = useState(null);
  const [demand, setDemand] = useState([]);

  useEffect(()=>{
    fetchJson(auth, "/analytics/nps").then(setNps).catch(()=>{});
    fetchJson(auth, "/analytics/revenue-forecast?months=3").then(setFc).catch(()=>{});
    fetchJson(auth, "/analytics/staff-demand-forecast").then(setDemand).catch(()=>{});
  }, []);

  const npsColor = nps?.nps >= 50 ? C.green : nps?.nps >= 0 ? C.amber : C.red;
  const allMonths = useMemo(() => {
    if (!fc) return [];
    return [...(fc.history||[]).map(h=>({...h, type:"actual"})),
            ...(fc.forecast||[]).map(f=>({month:f.month, revenue:f.predicted_revenue, type:"forecast"}))];
  }, [fc]);
  const maxRev = Math.max(1, ...allMonths.map(m=>m.revenue||0));

  return (
    <div>
      <h2 style={{margin:"0 0 16px"}}>📈 Advanced Analytics</h2>

      <Card title="Net Promoter Score (NPS)" gradient={`linear-gradient(135deg, ${npsColor}, ${npsColor}cc)`}>
        {nps?.total === 0 || nps?.nps === null ? (
          <div style={{padding:24, textAlign:"center", color:C.muted}}>No feedback collected yet</div>
        ) : (
          <div style={{display:"flex", alignItems:"center", gap:24, flexWrap:"wrap"}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:64, fontWeight:900, color:npsColor, lineHeight:1}}>{nps?.nps}</div>
              <div style={{fontSize:12, color:C.muted, marginTop:4}}>NPS Score</div>
              <div style={{fontSize:11, color:C.muted}}>{nps?.total} responses</div>
            </div>
            <div style={{flex:1, minWidth:240}}>
              <div style={{display:"flex", height:32, borderRadius:8, overflow:"hidden", border:`1px solid ${C.border}`}}>
                <div style={{flex:nps?.promoters||1, background:C.green, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:800}}>{nps?.promoters} Promoters</div>
                <div style={{flex:nps?.passives||1, background:C.amber, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:800}}>{nps?.passives} Passives</div>
                <div style={{flex:nps?.detractors||1, background:C.red, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:800}}>{nps?.detractors} Detractors</div>
              </div>
              <div style={{display:"flex", justifyContent:"space-between", fontSize:11, color:C.muted, marginTop:6}}>
                <span>{nps?.promoter_pct}% promoters</span>
                <span>{nps?.detractor_pct}% detractors</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title={`Revenue Forecast — ${fc?.trend?.toUpperCase() || ""} trend`}>
        {!fc || allMonths.length===0 ? (
          <div style={{padding:24, textAlign:"center", color:C.muted}}>Need at least 2 months of data</div>
        ) : (
          <>
            <div style={{display:"flex", alignItems:"flex-end", gap:8, height:200, padding:"20px 0"}}>
              {allMonths.map((m,i)=>(
                <div key={i} style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4}}>
                  <div style={{fontSize:10, fontWeight:700, color: m.type==="forecast"?C.amber:C.text}}>₹{((m.revenue||0)/1000).toFixed(0)}k</div>
                  <div style={{width:"100%", height: Math.max(4, (m.revenue/maxRev)*150), background: m.type==="forecast" ? `repeating-linear-gradient(45deg, ${C.amber}, ${C.amber} 6px, ${C.amber}aa 6px, ${C.amber}aa 12px)` : `linear-gradient(180deg, ${C.purple}, ${C.indigo})`, borderRadius:"6px 6px 0 0", transition:"all 0.3s"}}/>
                  <div style={{fontSize:10, color:C.muted}}>{m.month?.slice(5)}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:12, color:C.muted, padding:"10px 0 0", borderTop:`1px solid ${C.border}`}}>
              <span style={{display:"inline-block", width:12, height:12, background:C.purple, borderRadius:2, marginRight:6, verticalAlign:"middle"}}/> Actual revenue &nbsp;&nbsp;
              <span style={{display:"inline-block", width:12, height:12, background:C.amber, borderRadius:2, marginRight:6, verticalAlign:"middle"}}/> Forecast (slope ₹{fc.slope_per_month?.toLocaleString("en-IN")}/mo)
            </div>
          </>
        )}
      </Card>

      <Card title="Staff Demand Forecast (by Service)">
        <Table cols={[
          {k:"service_category", h:"Service"},
          {k:"active_bookings", h:"Active Bookings", align:"center"},
          {k:"est_staff_needed", h:"Est. Staff Needed", align:"center", r:r=><b style={{color:C.purple}}>{r.est_staff_needed}</b>},
          {k:"pct_of_pipeline", h:"% of Pipeline", align:"right", r:r=>r.pct_of_pipeline+"%"},
          {k:"revenue", h:"Revenue (₹)", align:"right", r:r=>"₹"+(r.revenue||0).toLocaleString("en-IN")},
        ]} rows={demand}/>
      </Card>
    </div>
  );
}

// ═════════════════════════ AUTO ALLOCATE ROSTER ═════════════════════════
export function AutoAllocateModule({ auth }) {
  const [patients, setPatients] = useState([]);
  const [form, setForm] = useState({ patient_id:"", start_date: new Date().toISOString().slice(0,10), end_date: new Date(Date.now()+86400000*7).toISOString().slice(0,10), shift:"Morning", role:"Nurse", vendor:"", top:5 });
  const [results, setResults] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(()=>{ fetchJson(auth, "/patients").then(setPatients).catch(()=>{}); }, []);

  const run = async (commit=false) => {
    setMsg(""); if (commit) setCommitting(true);
    try {
      const r = await fetchJson(auth, "/roster/auto-allocate", { method:"POST",
        body:JSON.stringify({...form, patient_id:Number(form.patient_id), top:Number(form.top), commit}) });
      setResults(r);
      if (commit) setMsg(`✅ Allocated to ${r.suggestions[0]?.name} for ${r.committed.length} day(s)`);
    } catch(e){ setMsg("❌ "+e.message); }
    setCommitting(false);
  };

  return (
    <div>
      <h2 style={{margin:"0 0 16px"}}>🤖 Auto-Allocate Roster Engine</h2>

      <Card title="Allocation Parameters">
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:12}}>
          <div>
            <label style={{fontSize:11, color:C.muted, fontWeight:700}}>Patient *</label>
            <Select value={form.patient_id} onChange={v=>setForm({...form, patient_id:v})} placeholder="Select patient"
              options={patients.map(p=>({value:p.id, label:`${p.name} (${p.reg_number})`}))}/>
          </div>
          <div>
            <label style={{fontSize:11, color:C.muted, fontWeight:700}}>Start Date</label>
            <Input type="date" value={form.start_date} onChange={e=>setForm({...form, start_date:e.target.value})}/>
          </div>
          <div>
            <label style={{fontSize:11, color:C.muted, fontWeight:700}}>End Date</label>
            <Input type="date" value={form.end_date} onChange={e=>setForm({...form, end_date:e.target.value})}/>
          </div>
          <div>
            <label style={{fontSize:11, color:C.muted, fontWeight:700}}>Shift</label>
            <Select value={form.shift} onChange={v=>setForm({...form, shift:v})} options={[
              {value:"Morning",label:"Morning"},{value:"Evening",label:"Evening"},
              {value:"Night",label:"Night"},{value:"24-Hour",label:"24-Hour"}]}/>
          </div>
          <div>
            <label style={{fontSize:11, color:C.muted, fontWeight:700}}>Role</label>
            <Select value={form.role} onChange={v=>setForm({...form, role:v})} options={[
              {value:"Nurse",label:"Nurse"},{value:"GDA",label:"GDA"},
              {value:"Physiotherapist",label:"Physiotherapist"},{value:"Doctor",label:"Doctor"},
              {value:"Aaya",label:"Aaya"},{value:"Driver",label:"Driver"}]}/>
          </div>
          <div>
            <label style={{fontSize:11, color:C.muted, fontWeight:700}}>Vendor Preference</label>
            <Input placeholder="(optional)" value={form.vendor} onChange={e=>setForm({...form, vendor:e.target.value})}/>
          </div>
        </div>
        <div style={{display:"flex", gap:10, marginTop:14}}>
          <Btn onClick={()=>run(false)} disabled={!form.patient_id}>🔍 Find Best Match</Btn>
          {results?.suggestions?.length>0 && <Btn kind="success" onClick={()=>run(true)} disabled={committing}>✓ Commit Top Pick</Btn>}
          {msg && <span style={{padding:"8px 12px", fontSize:13, color: msg.startsWith("✅")?C.green:C.red, fontWeight:600}}>{msg}</span>}
        </div>
      </Card>

      {results && (
        <Card title={`Ranked Suggestions (${results.suggestions.length})`}>
          {results.suggestions.length===0 ? (
            <div style={{padding:24, textAlign:"center", color:C.muted}}>No staff available with these criteria. Try widening role/vendor.</div>
          ) : (
            <Table cols={[
              {k:"rank", h:"#", r:(r,i)=><b style={{color:C.purple}}>{results.suggestions.indexOf(r)+1}</b>},
              {k:"code", h:"Code"},
              {k:"name", h:"Name"},
              {k:"role", h:"Role"},
              {k:"vendor", h:"Vendor"},
              {k:"rating", h:"Rating", r:r=>"⭐ "+(r.rating||0)},
              {k:"duty_tag", h:"Status", r:r=><Badge label={r.duty_tag} color={r.duty_tag==="Available"?C.green:C.amber}/>},
              {k:"score", h:"Score", align:"right", r:r=><b style={{fontSize:15, color:C.purple}}>{r.score}</b>},
              {k:"breakdown", h:"Why", r:r=><span style={{fontSize:10, color:C.muted}}>
                R{r.breakdown.rating} · A{r.breakdown.availability} · V{r.breakdown.vendor_match} · Ro{r.breakdown.role_match} · L{r.breakdown.location}
              </span>},
            ]} rows={results.suggestions}/>
          )}
        </Card>
      )}
    </div>
  );
}

// ═════════════════════════ ADVANCED PAYSLIP VIEWER ═════════════════════════
export function AdvancedPayslipModule({ auth }) {
  const [staff, setStaff] = useState([]);
  const [staffId, setStaffId] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tk] = useState(auth);

  useEffect(()=>{ fetchJson(auth, "/staff").then(setStaff).catch(()=>{}); }, []);

  const load = async () => {
    if (!staffId) return;
    setErr("");
    try { setData(await fetchJson(auth, `/payroll/${staffId}/details?month=${month}`)); }
    catch(e){ setErr(e.message); setData(null); }
  };

  const downloadPdf = () => {
    const url = `${API}/pdf/payslip/${staffId}?month=${month}`;
    fetch(url, { headers: { Authorization: "Bearer "+tk } })
      .then(r => r.blob()).then(b => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(b);
        a.download = `payslip-${staffId}-${month}.pdf`; a.click();
      });
  };

  return (
    <div>
      <h2 style={{margin:"0 0 16px"}}>💳 Advanced Payslip</h2>
      <Card title="Select Employee & Month">
        <div style={{display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap"}}>
          <div style={{flex:2, minWidth:260}}>
            <label style={{fontSize:11, color:C.muted, fontWeight:700}}>Staff</label>
            <Select value={staffId} onChange={setStaffId} placeholder="Select staff"
              options={staff.map(s=>({value:s.id, label:`${s.name} (${s.code})`}))}/>
          </div>
          <div style={{flex:1, minWidth:160}}>
            <label style={{fontSize:11, color:C.muted, fontWeight:700}}>Month</label>
            <Input type="month" value={month} onChange={e=>setMonth(e.target.value)}/>
          </div>
          <Btn onClick={load} disabled={!staffId}>View Breakdown</Btn>
          {data && <Btn outline onClick={downloadPdf}>📄 Download PDF</Btn>}
        </div>
        {err && <div style={{padding:10, background:"#FEE2E2", color:C.red, borderRadius:8, marginTop:12}}>{err}</div>}
      </Card>

      {data && (
        <Card title={`Payslip — ${data.staff.name} (${data.staff.code}) — ${data.month}`} gradient={`linear-gradient(135deg, ${C.purple}, ${C.indigo})`}>
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(120px,1fr))", gap:12, marginBottom:16}}>
            <Stat label="Days Present" value={data.attendance.days_present} color={C.green}/>
            <Stat label="Days Absent" value={data.attendance.days_absent} color={C.red}/>
            <Stat label="Total Hours" value={data.attendance.total_hours} color={C.indigo}/>
            <Stat label="Overtime Hrs" value={data.attendance.overtime_hrs} color={C.amber}/>
          </div>

          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16}}>
            <div style={{background:"#ECFDF5", padding:14, borderRadius:10, border:`1px solid ${C.green}33`}}>
              <h4 style={{margin:"0 0 10px", color:C.green}}>💰 Earnings</h4>
              {[["Basic", data.earnings.basic], ["HRA (10%)", data.earnings.hra],
                ["Conveyance (5%)", data.earnings.conveyance], ["Overtime (1.5x)", data.earnings.overtime_pay]].map(([l,v])=>(
                <div key={l} style={{display:"flex", justifyContent:"space-between", padding:"4px 0", fontSize:13}}>
                  <span>{l}</span><b>₹{(v||0).toLocaleString("en-IN")}</b>
                </div>
              ))}
              <div style={{display:"flex", justifyContent:"space-between", paddingTop:8, borderTop:`1px solid ${C.green}33`, fontSize:14, fontWeight:800, color:C.green}}>
                <span>Gross Pay</span><span>₹{(data.earnings.gross||0).toLocaleString("en-IN")}</span>
              </div>
            </div>

            <div style={{background:"#FEF2F2", padding:14, borderRadius:10, border:`1px solid ${C.red}33`}}>
              <h4 style={{margin:"0 0 10px", color:C.red}}>📉 Deductions</h4>
              {[["PF (12%)", data.deductions.pf], ["ESI (0.75%)", data.deductions.esi],
                ["Professional Tax", data.deductions.professional_tax], ["TDS", data.deductions.tds],
                ["Leave Deduction", data.deductions.leave_deduction]].map(([l,v])=>(
                <div key={l} style={{display:"flex", justifyContent:"space-between", padding:"4px 0", fontSize:13}}>
                  <span>{l}</span><b>₹{(v||0).toLocaleString("en-IN")}</b>
                </div>
              ))}
              <div style={{display:"flex", justifyContent:"space-between", paddingTop:8, borderTop:`1px solid ${C.red}33`, fontSize:14, fontWeight:800, color:C.red}}>
                <span>Total Deductions</span><span>₹{(data.deductions.total||0).toLocaleString("en-IN")}</span>
              </div>
            </div>
          </div>

          <div style={{marginTop:20, padding:18, background:`linear-gradient(135deg, ${C.purple}, ${C.indigo})`, borderRadius:12, color:"#fff", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <div>
              <div style={{fontSize:12, opacity:0.85, fontWeight:700, textTransform:"uppercase"}}>Net Pay</div>
              <div style={{fontSize:32, fontWeight:900}}>₹{(data.net_pay||0).toLocaleString("en-IN")}</div>
            </div>
            <Btn outline kind="secondary" onClick={downloadPdf}><span style={{color:"#fff"}}>📄 Download PDF Payslip</span></Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ═════════════════════════ INCIDENT WORKFLOW ═════════════════════════
export function IncidentWorkflowModule({ auth, user }) {
  const [incidents, setIncidents] = useState([]);
  const [staff, setStaff] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState(null);
  const [findings, setFindings] = useState({ findings:"", root_cause:"", corrective_action:"" });
  const [investigator, setInvestigator] = useState("");
  const [newInc, setNewInc] = useState({ staff_id:"", patient_id:"", incident_type:"", severity:"Medium", description:"" });
  const [err, setErr] = useState("");
  const isMgr = ["admin","manager"].includes(user?.role);

  const load = async () => {
    setIncidents(await fetchJson(auth, "/incidents"));
    setStaff(await fetchJson(auth, "/staff"));
  };
  useEffect(()=>{ load().catch(e=>setErr(e.message)); }, []);

  const create = async () => {
    setErr("");
    try { await fetchJson(auth, "/incidents", {method:"POST", body:JSON.stringify(newInc)}); setShowNew(false); setNewInc({ staff_id:"", patient_id:"", incident_type:"", severity:"Medium", description:"" }); load(); }
    catch(e){ setErr(e.message); }
  };
  const assignInv = async () => {
    const s = staff.find(x=>x.id===Number(investigator));
    if (!s) return;
    try { await fetchJson(auth, `/incidents/${selected.id}/assign-investigator`, {method:"POST", body:JSON.stringify({investigator_id:s.id, investigator_name:s.name})}); load(); setSelected({...selected, investigator_name:s.name, status:"Under Investigation"}); }
    catch(e){ alert(e.message); }
  };
  const saveFindings = async () => {
    try { await fetchJson(auth, `/incidents/${selected.id}/findings`, {method:"POST", body:JSON.stringify(findings)}); load(); alert("Findings saved"); }
    catch(e){ alert(e.message); }
  };
  const closeInc = async () => {
    const reso = prompt("Resolution summary:", "Closed with corrective action");
    if (!reso) return;
    try { await fetchJson(auth, `/incidents/${selected.id}/close`, {method:"POST", body:JSON.stringify({resolution:reso})}); load(); setSelected(null); }
    catch(e){ alert(e.message); }
  };

  return (
    <div>
      <h2 style={{margin:"0 0 16px"}}>🚨 Incident Management</h2>
      <Card title={`Incidents (${incidents.length})`} action={<Btn small onClick={()=>setShowNew(true)}>+ Report Incident</Btn>}>
        <Table cols={[
          {k:"id", h:"#"},
          {k:"reported_at", h:"When", r:r=>r.reported_at?.slice(0,10)},
          {k:"incident_type", h:"Type"},
          {k:"staff_name", h:"Staff"},
          {k:"severity", h:"Severity", r:r=><Badge label={r.severity} color={r.severity==="High"||r.severity==="Critical"?C.red:r.severity==="Medium"?C.amber:C.blue}/>},
          {k:"investigator_name", h:"Investigator", r:r=>r.investigator_name||<span style={{color:C.muted, fontSize:11}}>—</span>},
          {k:"status", h:"Status", r:r=><Badge label={r.status||"Open"} color={r.status==="Closed"?C.green:r.status==="Under Investigation"?C.amber:C.red}/>},
          {k:"actions", h:"", align:"right", r:r=><Btn small outline onClick={()=>{setSelected(r); setInvestigator(""); setFindings({findings:r.findings||"", root_cause:r.root_cause||"", corrective_action:r.corrective_action||""});}}>Open</Btn>},
        ]} rows={incidents}/>
      </Card>

      {showNew && (
        <Modal title="Report Incident" onClose={()=>setShowNew(false)} onSave={create} err={err}>
          <Select value={newInc.staff_id} onChange={v=>setNewInc({...newInc, staff_id:Number(v)})} placeholder="Select staff"
            options={staff.map(s=>({value:s.id, label:`${s.name} (${s.code})`}))}/>
          <Input placeholder="Incident type (e.g., Patient Fall, Medication Error)" value={newInc.incident_type} onChange={e=>setNewInc({...newInc, incident_type:e.target.value})}/>
          <Select value={newInc.severity} onChange={v=>setNewInc({...newInc, severity:v})} options={[
            {value:"Low",label:"Low"},{value:"Medium",label:"Medium"},
            {value:"High",label:"High"},{value:"Critical",label:"Critical"}]}/>
          <textarea placeholder="Description" value={newInc.description} onChange={e=>setNewInc({...newInc, description:e.target.value})}
            style={{ width:"100%", padding:"9px 12px", border:`1px solid ${C.border}`, borderRadius:8, fontSize:13, minHeight:80, boxSizing:"border-box" }}/>
        </Modal>
      )}

      {selected && (
        <div style={{position:"fixed", inset:0, background:"rgba(31,17,71,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:20}} onClick={()=>setSelected(null)}>
          <div style={{background:"#fff", borderRadius:14, padding:24, width:620, maxWidth:"100%", maxHeight:"90vh", overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16}}>
              <div>
                <h3 style={{margin:0}}>{selected.incident_type} #{selected.id}</h3>
                <Badge label={selected.status||"Open"} color={selected.status==="Closed"?C.green:C.amber}/>
              </div>
              <button onClick={()=>setSelected(null)} style={{background:"none", border:"none", fontSize:22, cursor:"pointer", color:C.muted}}>×</button>
            </div>
            <div style={{padding:12, background:"#F5F3FF", borderRadius:8, marginBottom:14, fontSize:13}}>{selected.description}</div>

            <h4 style={{margin:"14px 0 8px", color:C.purple}}>Step 1 — Assign Investigator</h4>
            {selected.investigator_name ? (
              <div style={{padding:10, background:"#ECFDF5", borderRadius:8, fontSize:13}}>✓ Investigator: <b>{selected.investigator_name}</b></div>
            ) : isMgr && (
              <div style={{display:"flex", gap:8}}>
                <Select value={investigator} onChange={setInvestigator} placeholder="Select investigator"
                  options={staff.filter(s=>["Manager","Supervisor","Nurse"].includes(s.role)||s.id!==selected.staff_id).map(s=>({value:s.id, label:`${s.name} (${s.role})`}))}/>
                <Btn small onClick={assignInv} disabled={!investigator}>Assign</Btn>
              </div>
            )}

            <h4 style={{margin:"18px 0 8px", color:C.purple}}>Step 2 — Findings</h4>
            <textarea placeholder="Findings" value={findings.findings} onChange={e=>setFindings({...findings, findings:e.target.value})}
              style={{width:"100%", padding:9, border:`1px solid ${C.border}`, borderRadius:6, minHeight:50, fontSize:12, marginBottom:6, boxSizing:"border-box"}}/>
            <textarea placeholder="Root cause" value={findings.root_cause} onChange={e=>setFindings({...findings, root_cause:e.target.value})}
              style={{width:"100%", padding:9, border:`1px solid ${C.border}`, borderRadius:6, minHeight:40, fontSize:12, marginBottom:6, boxSizing:"border-box"}}/>
            <textarea placeholder="Corrective action" value={findings.corrective_action} onChange={e=>setFindings({...findings, corrective_action:e.target.value})}
              style={{width:"100%", padding:9, border:`1px solid ${C.border}`, borderRadius:6, minHeight:40, fontSize:12, boxSizing:"border-box"}}/>
            <Btn small onClick={saveFindings} style={{marginTop:8}}>Save Findings</Btn>

            {isMgr && selected.status !== "Closed" && (
              <>
                <h4 style={{margin:"18px 0 8px", color:C.green}}>Step 3 — Close</h4>
                <Btn kind="success" onClick={closeInc}>✓ Close Incident</Btn>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════ MODAL HELPER ═════════════════════════
function Modal({ title, onClose, onSave, err, saveLabel="Save", children }) {
  return (
    <div style={{position:"fixed", inset:0, background:"rgba(31,17,71,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:20}} onClick={onClose}>
      <div style={{background:"#fff", borderRadius:14, padding:24, width:520, maxWidth:"100%", maxHeight:"90vh", overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14}}>
          <h3 style={{margin:0}}>{title}</h3>
          <button onClick={onClose} style={{background:"none", border:"none", fontSize:22, cursor:"pointer", color:C.muted}}>×</button>
        </div>
        {err && <div style={{padding:10, background:"#FEE2E2", color:C.red, borderRadius:8, marginBottom:12, fontSize:12}}>{err}</div>}
        <div style={{display:"grid", gap:10}}>{children}</div>
        <div style={{display:"flex", justifyContent:"flex-end", gap:8, marginTop:16}}>
          <Btn outline onClick={onClose}>Cancel</Btn>
          <Btn onClick={onSave}>{saveLabel}</Btn>
        </div>
      </div>
    </div>
  );
}
