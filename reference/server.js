const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || "reachout_secret_2026_dev_only";

app.use(cors());
app.use(express.json());

["uploads", "uploads/staff", "uploads/patients", "uploads/assets"].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use("/uploads", express.static("uploads"));

// ====================================
// MULTER CONFIG
// ====================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.originalUrl.includes("patient") ? "uploads/patients"
      : req.originalUrl.includes("asset") ? "uploads/assets"
      : "uploads/staff";
    cb(null, type);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const type = req.body.documentType || req.body.photoType || "File";
    cb(null, `${type}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

const db = new sqlite3.Database("./reachout.db");

// ====================================
// SCHEMA
// ====================================
// ====================================
// MIGRATION HELPER — safely adds missing columns to existing tables
// ====================================
function addColumnIfMissing(table, column, definition) {
  db.all(`PRAGMA table_info(${table})`, (err, cols) => {
    if (err || !cols) return;
    const exists = cols.some(c => c.name === column);
    if (!exists) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (err) => {
        if (err) console.warn(`Migration warning: could not add ${table}.${column}:`, err.message);
        else console.log(`✅ Migration: added column ${table}.${column}`);
      });
    }
  });
}

db.serialize(() => {

  // Users / Auth
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT,
    name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Staff
  db.run(`CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    role TEXT,
    category TEXT,
    vendor TEXT,
    speciality TEXT,
    duty_tag TEXT DEFAULT 'Available',
    status TEXT DEFAULT 'Active',
    rating REAL DEFAULT 0,
    blood_group TEXT,
    dob TEXT,
    mobile TEXT,
    address TEXT,
    qualification TEXT,
    experience TEXT,
    joining_date TEXT,
    employment_type TEXT,
    salary TEXT,
    emergency_contact TEXT,
    emergency_name TEXT,
    bank_account TEXT,
    ifsc TEXT,
    photo TEXT,
    latitude REAL,
    longitude REAL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Staff documents
  db.run(`CREATE TABLE IF NOT EXISTS staff_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    document_type TEXT,
    document_name TEXT,
    file_path TEXT,
    expiry_date TEXT,
    upload_date TEXT DEFAULT (date('now')),
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Staff attendance
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    date TEXT,
    login_time TEXT,
    logout_time TEXT,
    login_photo TEXT,
    logout_photo TEXT,
    login_lat REAL,
    login_lng REAL,
    logout_lat REAL,
    logout_lng REAL,
    hours_worked REAL,
    status TEXT DEFAULT 'Present',
    notes TEXT,
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Staff ratings
  db.run(`CREATE TABLE IF NOT EXISTS staff_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    patient_id INTEGER,
    source TEXT,
    score REAL,
    comment TEXT,
    rated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Training
  db.run(`CREATE TABLE IF NOT EXISTS training (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    trainer TEXT,
    topic TEXT,
    date TEXT,
    duration_mins INTEGER,
    notes TEXT,
    test_score REAL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Incidents
  db.run(`CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    patient_id INTEGER,
    type TEXT,
    description TEXT,
    severity TEXT,
    action_taken TEXT,
    status TEXT DEFAULT 'Open',
    reported_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Patients
  db.run(`CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reg_number TEXT UNIQUE,
    sgrh_reg TEXT,
    name TEXT NOT NULL,
    age TEXT,
    gender TEXT,
    mobile TEXT,
    address TEXT,
    landmark TEXT,
    diagnosis TEXT,
    doctor_name TEXT,
    hospital TEXT,
    admission_date TEXT,
    discharge_date TEXT,
    blood_group TEXT,
    allergies TEXT,
    current_medications TEXT,
    service_location TEXT,
    category TEXT,
    status TEXT DEFAULT 'Active',
    assigned_staff TEXT,
    photo TEXT,
    notes TEXT,
    frozen INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Patient documents
  db.run(`CREATE TABLE IF NOT EXISTS patient_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    document_type TEXT,
    document_name TEXT,
    file_path TEXT,
    upload_date TEXT DEFAULT (date('now')),
    FOREIGN KEY(patient_id) REFERENCES patients(id)
  )`);

  // Leads
  db.run(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_name TEXT,
    caller_mobile TEXT,
    relation TEXT,
    source TEXT,
    patient_name TEXT,
    patient_age TEXT,
    patient_gender TEXT,
    patient_address TEXT,
    diagnosis TEXT,
    service_needed TEXT,
    urgency TEXT,
    status TEXT DEFAULT 'New',
    notes TEXT,
    follow_up_date TEXT,
    assigned_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Bookings / Service Requests
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT UNIQUE,
    patient_id INTEGER,
    service_category TEXT,
    service_name TEXT,
    start_date TEXT,
    end_date TEXT,
    shift TEXT,
    duration_type TEXT,
    staff_id INTEGER,
    status TEXT DEFAULT 'Pending',
    amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    payment_mode TEXT,
    payment_status TEXT DEFAULT 'Pending',
    notes TEXT,
    otp TEXT,
    otp_verified INTEGER DEFAULT 0,
    in_time TEXT,
    out_time TEXT,
    tat_minutes INTEGER,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY(patient_id) REFERENCES patients(id),
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Bills / Receipts
  db.run(`CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_number TEXT UNIQUE,
    booking_id TEXT,
    patient_id INTEGER,
    patient_name TEXT,
    service TEXT,
    amount REAL,
    paid_amount REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    payment_mode TEXT,
    payment_status TEXT DEFAULT 'Pending',
    date TEXT DEFAULT (date('now')),
    refund_amount REAL DEFAULT 0,
    refund_status TEXT,
    watermark TEXT,
    FOREIGN KEY(patient_id) REFERENCES patients(id)
  )`);

  // Refunds
  db.run(`CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER,
    patient_id INTEGER,
    patient_name TEXT,
    amount REAL,
    reason TEXT,
    reason_category TEXT,
    mode TEXT DEFAULT 'NEFT',
    payee_name TEXT,
    payee_relation TEXT,
    payee_id_type TEXT,
    payee_id_number TEXT,
    bank_account TEXT,
    ifsc TEXT,
    utr TEXT,
    initiator TEXT,
    verifier TEXT,
    approver TEXT,
    status TEXT DEFAULT 'Pending',
    initiated_at TEXT DEFAULT (datetime('now')),
    approved_at TEXT,
    notes TEXT,
    FOREIGN KEY(patient_id) REFERENCES patients(id)
  )`);

  // Ambulance calls
  db.run(`CREATE TABLE IF NOT EXISTS ambulance_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_number TEXT UNIQUE,
    caller_name TEXT,
    caller_mobile TEXT,
    patient_name TEXT,
    pickup_address TEXT,
    drop_address TEXT,
    call_type TEXT,
    ambulance_type TEXT,
    priority TEXT DEFAULT 'Normal',
    assigned_driver TEXT,
    assigned_vehicle TEXT,
    status TEXT DEFAULT 'Received',
    eta TEXT,
    start_time TEXT,
    end_time TEXT,
    amount REAL,
    payment_status TEXT DEFAULT 'Pending',
    missed_reason TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Assets
  db.run(`CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT UNIQUE,
    name TEXT,
    category TEXT,
    vendor TEXT,
    serial_number TEXT,
    purchase_date TEXT,
    warranty_expiry TEXT,
    amc_date TEXT,
    cmc_date TEXT,
    location TEXT,
    status TEXT DEFAULT 'Active',
    quantity INTEGER DEFAULT 1,
    cost REAL,
    notes TEXT
  )`);

  // Stock
  db.run(`CREATE TABLE IF NOT EXISTS stock_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT,
    category TEXT,
    issued_to_type TEXT,
    issued_to_id INTEGER,
    issued_to_name TEXT,
    quantity INTEGER,
    issue_date TEXT DEFAULT (date('now')),
    return_date TEXT,
    returned INTEGER DEFAULT 0,
    notes TEXT
  )`);

  // Notifications
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_type TEXT,
    recipient_id INTEGER,
    title TEXT,
    message TEXT,
    channel TEXT,
    status TEXT DEFAULT 'Pending',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Vendor
  db.run(`CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    type TEXT,
    contact TEXT,
    email TEXT,
    address TEXT,
    status TEXT DEFAULT 'Active',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Roster
  db.run(`CREATE TABLE IF NOT EXISTS roster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    date TEXT,
    shift TEXT,
    patient_id INTEGER,
    status TEXT DEFAULT 'Scheduled',
    notes TEXT,
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Medical charts
  db.run(`CREATE TABLE IF NOT EXISTS medical_charts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT,
    patient_id INTEGER,
    staff_id INTEGER,
    chart_type TEXT,
    chart_data TEXT,
    visit_date TEXT DEFAULT (date('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`);




  // Payroll records table
  db.run(`CREATE TABLE IF NOT EXISTS payroll_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    month TEXT,
    base_salary REAL DEFAULT 0,
    days_payable INTEGER DEFAULT 0,
    total_hours REAL DEFAULT 0,
    gross_pay REAL DEFAULT 0,
    deductions REAL DEFAULT 0,
    net_pay REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'Pending',
    payment_date TEXT,
    payment_mode TEXT,
    remarks TEXT,
    generated_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Staff availability override table
  db.run(`CREATE TABLE IF NOT EXISTS staff_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    date TEXT,
    available_from TEXT,
    available_to TEXT,
    shift_preference TEXT,
    override_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(staff_id) REFERENCES staff(id)
  )`);

  // Patient freeze audit log
  db.run(`CREATE TABLE IF NOT EXISTS patient_freeze_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    action TEXT,
    done_by TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Consent forms
  db.run(`CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    patient_name TEXT,
    consent_type TEXT,
    signed_by TEXT,
    relation TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Signed',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Feedback
  db.run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    patient_name TEXT,
    staff_id INTEGER,
    booking_id TEXT,
    overall_rating REAL,
    staff_rating REAL,
    punctuality_rating REAL,
    service_rating REAL,
    recommend TEXT,
    comments TEXT,
    submitted_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // MCQ Questions
  db.run(`CREATE TABLE IF NOT EXISTS mcq_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT,
    question TEXT,
    option_a TEXT,
    option_b TEXT,
    option_c TEXT,
    option_d TEXT,
    correct_option TEXT,
    marks INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // MCQ Results
  db.run(`CREATE TABLE IF NOT EXISTS mcq_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    topic TEXT,
    training_id INTEGER,
    score REAL,
    correct INTEGER,
    total INTEGER,
    submitted_at TEXT DEFAULT (datetime('now'))
  )`);


  // ── MIGRATIONS: safely add new columns to existing databases ──
  const staffCols = [
    ["category","TEXT"],["vendor","TEXT"],["speciality","TEXT"],
    ["duty_tag","TEXT DEFAULT 'Available'"],["blood_group","TEXT"],
    ["dob","TEXT"],["mobile","TEXT"],["address","TEXT"],
    ["qualification","TEXT"],["experience","TEXT"],["joining_date","TEXT"],
    ["employment_type","TEXT"],["salary","TEXT"],["emergency_contact","TEXT"],
    ["emergency_name","TEXT"],["bank_account","TEXT"],["ifsc","TEXT"],
    ["photo","TEXT"],["latitude","REAL"],["longitude","REAL"],
    ["rating","REAL DEFAULT 0"],["created_at","TEXT DEFAULT (datetime('now'))"],
  ];
  staffCols.forEach(([c,d]) => addColumnIfMissing("staff", c, d));

  const patientCols = [
    ["reg_number","TEXT"],["sgrh_reg","TEXT"],["landmark","TEXT"],
    ["blood_group","TEXT"],["allergies","TEXT"],["current_medications","TEXT"],
    ["service_location","TEXT DEFAULT 'Home'"],["category","TEXT"],
    ["frozen","INTEGER DEFAULT 0"],["photo","TEXT"],["notes","TEXT"],
    ["hospital","TEXT"],["doctor_name","TEXT"],["admission_date","TEXT"],
    ["discharge_date","TEXT"],["mobile","TEXT"],["address","TEXT"],
    ["diagnosis","TEXT"],["assigned_staff","TEXT"],
    ["created_at","TEXT DEFAULT (datetime('now'))"],
  ];
  patientCols.forEach(([c,d]) => addColumnIfMissing("patients", c, d));

  const bookingCols = [
    ["booking_id","TEXT"],["patient_id","INTEGER"],["service_category","TEXT"],
    ["service_name","TEXT"],["start_date","TEXT"],["end_date","TEXT"],
    ["shift","TEXT"],["duration_type","TEXT"],["staff_id","INTEGER"],
    ["amount","REAL DEFAULT 0"],["paid_amount","REAL DEFAULT 0"],
    ["balance","REAL DEFAULT 0"],["payment_mode","TEXT"],
    ["payment_status","TEXT DEFAULT 'Pending'"],["notes","TEXT"],
    ["otp","TEXT"],["otp_verified","INTEGER DEFAULT 0"],
    ["in_time","TEXT"],["out_time","TEXT"],["tat_minutes","INTEGER"],
    ["created_by","TEXT"],["created_at","TEXT DEFAULT (datetime('now'))"],
    ["expires_at","TEXT"],
  ];
  bookingCols.forEach(([c,d]) => addColumnIfMissing("bookings", c, d));

  const billCols = [
    ["receipt_number","TEXT"],["booking_id","TEXT"],["patient_id","INTEGER"],
    ["patient_name","TEXT"],["service","TEXT"],["amount","REAL DEFAULT 0"],
    ["paid_amount","REAL DEFAULT 0"],["balance","REAL DEFAULT 0"],
    ["payment_mode","TEXT"],["payment_status","TEXT DEFAULT 'Pending'"],
    ["date","TEXT DEFAULT (date('now'))"],["refund_amount","REAL DEFAULT 0"],
    ["refund_status","TEXT"],["watermark","TEXT"],
  ];
  billCols.forEach(([c,d]) => addColumnIfMissing("bills", c, d));

  // Seed admin user
  db.get("SELECT id FROM users WHERE username='admin'", (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync("Admin@1234", 10);
      db.run("INSERT INTO users (username, password, role, name) VALUES (?,?,?,?)",
        ["admin", hash, "admin", "Super Admin"]);
    }
  });

  // Seed rich demo staff
  db.get("SELECT id FROM staff WHERE code='RO001'", (err, row) => {
    if (!row) {
      const staffData = [
        ["RO001","Prachi Sharma","Nurse","Nursing","MedCare Staffing","On Duty","Active",4.8,"9876541001","Rohini, Delhi","B.Sc Nursing","6 years","Permanent","25000"],
        ["RO002","Anita Verma","Nurse","Nursing","MedCare Staffing","Available","Active",4.6,"9876541002","Dwarka, Delhi","GNM Nursing","4 years","Permanent","22000"],
        ["RO003","Ramesh Kumar","GDA","GDA","HealthLink","On Duty","Active",4.2,"9876541003","Uttam Nagar, Delhi","GDA Certificate","3 years","Contractual","15000"],
        ["RO004","Sunita Devi","Aaya","GDA","HealthLink","Available","Active",4.0,"9876541004","Nangloi, Delhi","10th Pass","2 years","Contractual","12000"],
        ["RO005","Dr. Kavita Joshi","Physiotherapist","Allied Health","PhysioPlus","Available","Active",4.9,"9876541005","Paschim Vihar, Delhi","BPT, MPT","7 years","Permanent","35000"],
        ["RO006","Mohan Lal","Driver","Driver","MedCare Staffing","On Duty","Active",4.3,"9876541006","Shahdara, Delhi","12th Pass","5 years","Permanent","18000"],
        ["RO007","Poonam Tiwari","Nurse","Nursing","MedCare Staffing","On Leave","Active",4.5,"9876541007","Pitampura, Delhi","B.Sc Nursing","3 years","Permanent","22000"],
        ["RO008","Suresh Yadav","GDA","GDA","HealthLink","Available","Active",3.9,"9876541008","Burari, Delhi","GDA Certificate","1 year","Contractual","14000"],
        ["RO009","Deepa Singh","Nurse","Nursing","PhysioPlus","On Duty","Active",4.7,"9876541009","Janakpuri, Delhi","B.Sc Nursing","5 years","Permanent","24000"],
        ["RO010","Rajesh Pandey","Helper","GDA","HealthLink","Available","Active",4.1,"9876541010","Laxmi Nagar, Delhi","8th Pass","2 years","Contractual","11000"],
      ];
      staffData.forEach(([code,name,role,category,vendor,duty_tag,status,rating,mobile,address,qualification,experience,employment_type,salary]) => {
        db.run(`INSERT INTO staff (code,name,role,category,vendor,duty_tag,status,rating,mobile,address,qualification,experience,employment_type,salary,joining_date)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,date('now','-'||(ABS(RANDOM()) % 730)||' days'))`,
          [code,name,role,category,vendor,duty_tag,status,rating,mobile,address,qualification,experience,employment_type,salary]);
      });
    }
  });

  // Seed rich demo patients
  db.get("SELECT id FROM patients WHERE reg_number='RO-PAT-001'", (err, row) => {
    if (!row) {
      const patientData = [
        ["RO-PAT-001","SGRH-10234","Nitin Gupta","58","Male","9811001001","C-14, Sector 8, Rohini, Delhi","SGRH","Post-operative rehabilitation after CABG","Dr. Suresh Mehta","Home","Internal Home","Active","A+","Aspirin, Atorvastatin","Diabetes, Hypertension"],
        ["RO-PAT-002","SGRH-10235","Brijesh Kumar","72","Male","9811001002","Plot 22, Janakpuri Block B, Delhi","SGRH","Stroke rehabilitation, left-sided hemiplegia","Dr. A.K. Sharma","Home","Internal Home","Active","B+","Clopidogrel, Amlodipine","Hypertension, Atrial Fibrillation"],
        ["RO-PAT-003","SGRH-10236","Kamla Devi","68","Female","9811001003","H-45, Uttam Nagar, Delhi","SGRH","Palliative care, advanced COPD","Dr. Rekha Singh","Home","External Home","Active","O+","Salbutamol inhaler, Prednisolone","COPD, Hypothyroidism"],
        ["RO-PAT-004","SGRH-10237","Rajesh Sharma","55","Male","9811001004","D-112, Paschim Vihar, Delhi","","ICU at Home post-ventilator weaning","Dr. V.K. Gupta","Home","External Home","Active","AB+","Linezolid, Pantoprazole","Pneumonia, Type 2 Diabetes"],
        ["RO-PAT-005","SGRH-10238","Anita Kapoor","45","Female","9811001005","12/3, Subhash Nagar, Delhi","SGRH","Post-caesarean mother and baby care","Dr. Priya Nanda","Home","Internal Home","Active","A-","Iron supplements, Calcium","Gestational Diabetes"],
        ["RO-PAT-006","","Harish Chandra","80","Male","9811001006","2B, Model Town, Delhi","Apollo","Wound care — diabetic foot ulcer","Dr. M. Jain","Home","External Home","Active","B-","Metformin, Insulin","Type 2 Diabetes, CKD"],
        ["RO-PAT-007","SGRH-10239","Sunita Agarwal","62","Female","9811001007","Flat 4C, Dwarka Sector 10, Delhi","SGRH","Hip replacement post-op physiotherapy","Dr. R.K. Verma","Home","Internal Home","Active","O+","Tramadol, Pantoprazole","Osteoporosis, Hypertension"],
      ];
      patientData.forEach(([reg,sgrh,name,age,gender,mobile,address,hospital,diagnosis,doctor,service_location,category,status,blood_group,medications,allergies]) => {
        db.run(`INSERT INTO patients (reg_number,sgrh_reg,name,age,gender,mobile,address,hospital,diagnosis,doctor_name,service_location,category,status,blood_group,current_medications,allergies)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [reg,sgrh,name,age,gender,mobile,address,hospital,diagnosis,doctor,service_location,category,status,blood_group,medications,allergies]);
      });

      // Seed demo bookings
      setTimeout(() => {
        db.get("SELECT id FROM patients WHERE reg_number='RO-PAT-001'", (e,p1) => {
          db.get("SELECT id FROM patients WHERE reg_number='RO-PAT-002'", (e,p2) => {
            db.get("SELECT id FROM staff WHERE code='RO001'", (e,s1) => {
              db.get("SELECT id FROM staff WHERE code='RO003'", (e,s3) => {
                if(p1&&s1) db.run(`INSERT INTO bookings (booking_id,patient_id,service_category,service_name,start_date,end_date,shift,staff_id,status,amount,paid_amount,balance,payment_mode,payment_status,created_by) VALUES ('BK-2026001',?,?,'24-Hour Nursing',date('now','-30 days'),date('now','+30 days'),'24-Hour',?,'Active',45000,30000,15000,'NEFT','Partial','Admin')`, [p1.id,'Nursing',s1.id]);
                if(p2&&s3) db.run(`INSERT INTO bookings (booking_id,patient_id,service_category,service_name,start_date,end_date,shift,staff_id,status,amount,paid_amount,balance,payment_mode,payment_status,created_by) VALUES ('BK-2026002',?,?,'Physiotherapy (Specialized)',date('now','-15 days'),date('now','+45 days'),'12-Hour Day',?,'Active',28000,28000,0,'Cash','Paid','Admin')`, [p2.id,'Allied Health',s3.id]);
                // Bills
                if(p1) {
                  db.run(`INSERT INTO bills (receipt_number,booking_id,patient_id,patient_name,service,amount,paid_amount,balance,payment_mode,payment_status,date) VALUES ('RO-RCP-001','BK-2026001',?,'Nitin Gupta','24-Hour Nursing',45000,30000,15000,'NEFT','Partial',date('now','-30 days'))`, [p1.id]);
                  db.run(`INSERT INTO bills (receipt_number,booking_id,patient_id,patient_name,service,amount,paid_amount,balance,payment_mode,payment_status,date) VALUES ('RO-RCP-002','BK-2026002',?,'Brijesh Kumar','Physiotherapy',28000,28000,0,'Cash','Paid',date('now','-15 days'))`, [p2&&p2.id||1]);
                }
              });
            });
          });
        });
      }, 500);
    }
  });

  // Seed demo leads
  db.get("SELECT id FROM leads WHERE caller_mobile='9811002001'", (err, row) => {
    if (!row) {
      const leads = [
        ["Vikram Singh","9811002001","Son","Helpline","Ashok Kumar","68","Male","Punjabi Bagh, Delhi","Post-stroke care","24-Hour Nursing","Immediate","New","Patient discharged yesterday","2026-06-15"],
        ["Meena Sharma","9811002002","Daughter","Hospital Referral","Shanti Devi","75","Female","Model Town, Delhi","Hip fracture rehab","Physiotherapy","Planned","Contacted","Interested in monthly package","2026-06-14"],
        ["Arun Kapoor","9811002003","Self","WhatsApp","Arun Kapoor","52","Male","Rohini, Delhi","Diabetic wound care","Wound Dressing","Immediate","Assessment Scheduled","Critical wound — needs urgent visit","2026-06-13"],
        ["Priya Nair","9811002004","Spouse","Doctor Referral","Rajan Nair","60","Male","Janakpuri, Delhi","Ventilator weaning support","ICU at Home","Immediate","Quote Sent","ICU setup required","2026-06-16"],
        ["Sunil Kumar","9811002005","Brother","Website","Ramesh Kumar","45","Male","Dwarka, Delhi","Post-surgery nursing","12-Hour Nursing","Planned","Follow-Up","Budget concern raised","2026-06-17"],
      ];
      leads.forEach(([caller_name,caller_mobile,relation,source,patient_name,patient_age,patient_gender,patient_address,diagnosis,service_needed,urgency,status,notes,follow_up_date]) => {
        db.run(`INSERT INTO leads (caller_name,caller_mobile,relation,source,patient_name,patient_age,patient_gender,patient_address,diagnosis,service_needed,urgency,status,notes,follow_up_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [caller_name,caller_mobile,relation,source,patient_name,patient_age,patient_gender,patient_address,diagnosis,service_needed,urgency,status,notes,follow_up_date]);
      });
    }
  });

  // Seed demo ambulance calls
  db.get("SELECT id FROM ambulance_calls WHERE call_number='AMB-001'", (err, row) => {
    if (!row) {
      db.run(`INSERT INTO ambulance_calls (call_number,caller_name,caller_mobile,patient_name,pickup_address,drop_address,call_type,ambulance_type,priority,assigned_driver,assigned_vehicle,status,amount) VALUES ('AMB-001','Rajesh Gupta','9811003001','Nitin Gupta','C-14 Rohini Delhi','SGRH New Delhi','Local','BLS','Normal','Mohan Lal','DL-01-XY-1234','Completed',2500)`);
      db.run(`INSERT INTO ambulance_calls (call_number,caller_name,caller_mobile,patient_name,pickup_address,drop_address,call_type,ambulance_type,priority,status,amount) VALUES ('AMB-002','Priya Nair','9811003002','Rajan Nair','Janakpuri Delhi','Medanta Gurgaon','Domestic','ALS','Emergency','Received',8000)`);
    }
  });

  // Seed vendors
  db.get("SELECT id FROM vendors WHERE name='MedCare Staffing'", (err, row) => {
    if (!row) {
      db.run(`INSERT INTO vendors (name,type,contact,status) VALUES ('MedCare Staffing','Staffing','9900001111','Active')`);
      db.run(`INSERT INTO vendors (name,type,contact,status) VALUES ('HealthLink','Staffing','9900002222','Active')`);
      db.run(`INSERT INTO vendors (name,type,contact,status) VALUES ('Apollo Medical','Equipment','9900003333','Active')`);
    }
  });
});

// ====================================
// AUTH MIDDLEWARE
// ====================================
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

// ====================================
// AUTH ROUTES
// ====================================
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username=?", [username], async (err, user) => {
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ success: false, message: "Invalid password" });
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: "1d" });
    res.json({ success: true, role: user.role, name: user.name, token });
  });
});

// ====================================
// DASHBOARD STATS
// ====================================
app.get("/dashboard-stats", auth, (req, res) => {
  const queries = {
    totalPatients:    "SELECT COUNT(*) as v FROM patients WHERE status='Active'",
    totalStaff:       "SELECT COUNT(*) as v FROM staff WHERE status='Active'",
    staffOnDuty:      "SELECT COUNT(*) as v FROM staff WHERE duty_tag='On Duty'",
    staffAvailable:   "SELECT COUNT(*) as v FROM staff WHERE duty_tag='Available'",
    totalBookings:    "SELECT COUNT(*) as v FROM bookings",
    activeBookings:   "SELECT COUNT(*) as v FROM bookings WHERE status='Active'",
    pendingBookings:  "SELECT COUNT(*) as v FROM bookings WHERE status='Pending'",
    pendingPayments:  "SELECT COUNT(*) as v FROM bills WHERE payment_status='Pending'",
    totalRevenue:     "SELECT IFNULL(SUM(paid_amount),0) as v FROM bills",
    pendingBalance:   "SELECT IFNULL(SUM(balance),0) as v FROM bills WHERE payment_status!='Paid'",
    pendingRefunds:   "SELECT COUNT(*) as v FROM refunds WHERE status='Pending'",
    ambulanceCalls:   "SELECT COUNT(*) as v FROM ambulance_calls",
    todayAttendance:  "SELECT COUNT(*) as v FROM attendance WHERE date=date('now')",
    totalLeads:       "SELECT COUNT(*) as v FROM leads WHERE status NOT IN ('Converted','Not Interested')",
    newLeads:         "SELECT COUNT(*) as v FROM leads WHERE status='New'",
    pendingConsents:  "SELECT COUNT(*) as v FROM patients p WHERE p.status='Active' AND NOT EXISTS (SELECT 1 FROM consents c WHERE c.patient_id=p.id)",
    lowCompliance:    "SELECT COUNT(*) as v FROM (SELECT s.id FROM staff s LEFT JOIN staff_documents sd ON s.id=sd.staff_id WHERE s.status='Active' GROUP BY s.id HAVING COUNT(sd.id) < 3)",
  };
  const stats = {};
  const keys = Object.keys(queries);
  let done = 0;
  keys.forEach(k => {
    db.get(queries[k], [], (err, row) => {
      stats[k] = row ? row.v : 0;
      if (++done === keys.length) res.json(stats);
    });
  });
});

// ====================================
// STAFF ROUTES
// ====================================
app.get("/staff", auth, (req, res) => {
  const { role, vendor, status, duty_tag, category, search } = req.query;
  let sql = `SELECT s.*, 
    (SELECT COUNT(*) FROM staff_documents sd WHERE sd.staff_id=s.id) as doc_count
    FROM staff s WHERE 1=1`;
  const params = [];
  if (role) { sql += " AND s.role=?"; params.push(role); }
  if (vendor) { sql += " AND s.vendor=?"; params.push(vendor); }
  if (status) { sql += " AND s.status=?"; params.push(status); }
  if (duty_tag) { sql += " AND s.duty_tag=?"; params.push(duty_tag); }
  if (category) { sql += " AND s.category=?"; params.push(category); }
  if (search) { sql += " AND (s.name LIKE ? OR s.code LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  sql += " ORDER BY s.id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/staff/:id", auth, (req, res) => {
  db.get("SELECT * FROM staff WHERE id=?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json(err);
    if (!row) return res.status(404).json({ message: "Not found" });
    res.json(row);
  });
});

app.post("/staff", auth, upload.single("photo"), (req, res) => {
  const d = req.body;
  // Auto-generate code
  db.get("SELECT MAX(CAST(SUBSTR(code,3) AS INTEGER)) as maxNum FROM staff WHERE code LIKE 'RO%'", [], (err, row) => {
    const nextNum = (row && row.maxNum ? row.maxNum + 1 : 1);
    const code = `RO${String(nextNum).padStart(3,'0')}`;
    const photo = req.file ? req.file.path : "";
    db.run(`INSERT INTO staff (code,name,role,category,vendor,speciality,duty_tag,status,blood_group,dob,mobile,address,qualification,experience,joining_date,employment_type,salary,emergency_contact,emergency_name,bank_account,ifsc,photo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, d.name, d.role, d.category, d.vendor, d.speciality, d.duty_tag||"Available", d.status||"Active",
       d.blood_group, d.dob, d.mobile, d.address, d.qualification, d.experience, d.joining_date, d.employment_type,
       d.salary, d.emergency_contact, d.emergency_name, d.bank_account, d.ifsc, photo],
      function(err) {
        if (err) return res.status(500).json(err);
        res.json({ id: this.lastID, code, message: "Staff Created" });
      });
  });
});

app.put("/staff/:id", auth, upload.single("photo"), (req, res) => {
  const d = req.body;
  const photo = req.file ? req.file.path : d.photo || "";
  db.run(`UPDATE staff SET name=?,role=?,category=?,vendor=?,speciality=?,duty_tag=?,status=?,blood_group=?,dob=?,mobile=?,address=?,qualification=?,experience=?,joining_date=?,employment_type=?,salary=?,emergency_contact=?,emergency_name=?,bank_account=?,ifsc=?,photo=? WHERE id=?`,
    [d.name,d.role,d.category,d.vendor,d.speciality,d.duty_tag,d.status,d.blood_group,d.dob,d.mobile,d.address,d.qualification,d.experience,d.joining_date,d.employment_type,d.salary,d.emergency_contact,d.emergency_name,d.bank_account,d.ifsc,photo,req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Staff Updated" });
    });
});

app.delete("/staff/:id", auth, (req, res) => {
  db.run("DELETE FROM staff WHERE id=?", [req.params.id], function(err) {
    if (err) return res.status(500).json(err);
    res.json({ message: "Staff Deleted" });
  });
});

app.patch("/staff/:id/duty-tag", auth, (req, res) => {
  db.run("UPDATE staff SET duty_tag=? WHERE id=?", [req.body.duty_tag, req.params.id], function(err) {
    if (err) return res.status(500).json(err);
    res.json({ message: "Duty tag updated" });
  });
});

// ====================================
// STAFF DOCUMENTS
// ====================================
app.post("/staff/:id/documents", auth, upload.single("document"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file" });
  db.run("INSERT INTO staff_documents (staff_id,document_type,document_name,file_path,expiry_date) VALUES (?,?,?,?,?)",
    [req.params.id, req.body.documentType, req.file.originalname, req.file.path, req.body.expiry_date || null],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Document uploaded" });
    });
});

app.get("/staff/:id/documents", auth, (req, res) => {
  db.all("SELECT * FROM staff_documents WHERE staff_id=? ORDER BY id DESC", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ====================================
// ATTENDANCE
// ====================================
app.post("/attendance/login", auth, upload.single("photo"), (req, res) => {
  const { staff_id, lat, lng } = req.body;
  const photo = req.file ? req.file.path : "";
  const today = new Date().toISOString().split("T")[0];
  db.get("SELECT id FROM attendance WHERE staff_id=? AND date=?", [staff_id, today], (err, row) => {
    if (row) return res.status(400).json({ message: "Already logged in today" });
    db.run("INSERT INTO attendance (staff_id,date,login_time,login_photo,login_lat,login_lng,status) VALUES (?,?,datetime('now'),?,?,?,'Present')",
      [staff_id, today, photo, lat, lng],
      function(err) {
        if (err) return res.status(500).json(err);
        db.run("UPDATE staff SET duty_tag='On Duty' WHERE id=?", [staff_id]);
        res.json({ message: "Logged in" });
      });
  });
});

app.post("/attendance/logout", auth, (req, res) => {
  const { staff_id } = req.body;
  const today = new Date().toISOString().split("T")[0];
  db.get("SELECT * FROM attendance WHERE staff_id=? AND date=? AND logout_time IS NULL", [staff_id, today], (err, row) => {
    if (!row) return res.status(400).json({ message: "No active login found" });
    db.run("UPDATE attendance SET logout_time=datetime('now'), hours_worked=ROUND((julianday('now')-julianday(login_time))*24,2) WHERE id=?",
      [row.id], function(err) {
        if (err) return res.status(500).json(err);
        db.run("UPDATE staff SET duty_tag='Available' WHERE id=?", [staff_id]);
        res.json({ message: "Logged out" });
      });
  });
});

app.get("/attendance", auth, (req, res) => {
  const { staff_id, date, from, to, vendor } = req.query;
  let sql = `SELECT a.*, s.name as staff_name, s.role, s.vendor, s.code
    FROM attendance a JOIN staff s ON a.staff_id=s.id WHERE 1=1`;
  const params = [];
  if (staff_id) { sql += " AND a.staff_id=?"; params.push(staff_id); }
  if (date) { sql += " AND a.date=?"; params.push(date); }
  if (from) { sql += " AND a.date>=?"; params.push(from); }
  if (to) { sql += " AND a.date<=?"; params.push(to); }
  if (vendor) { sql += " AND s.vendor=?"; params.push(vendor); }
  sql += " ORDER BY a.date DESC, a.id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ====================================
// STAFF RATINGS
// ====================================
app.post("/staff/:id/ratings", auth, (req, res) => {
  const { patient_id, source, score, comment } = req.body;
  db.run("INSERT INTO staff_ratings (staff_id,patient_id,source,score,comment) VALUES (?,?,?,?,?)",
    [req.params.id, patient_id, source, score, comment],
    function(err) {
      if (err) return res.status(500).json(err);
      // Recalculate avg rating
      db.get("SELECT AVG(score) as avg FROM staff_ratings WHERE staff_id=?", [req.params.id], (err, row) => {
        db.run("UPDATE staff SET rating=? WHERE id=?", [row?.avg || 0, req.params.id]);
      });
      res.json({ message: "Rating submitted" });
    });
});

app.get("/staff/:id/ratings", auth, (req, res) => {
  db.all("SELECT * FROM staff_ratings WHERE staff_id=? ORDER BY rated_at DESC", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ====================================
// TRAINING
// ====================================
app.get("/training", auth, (req, res) => {
  const { staff_id } = req.query;
  let sql = "SELECT t.*, s.name as staff_name FROM training t JOIN staff s ON t.staff_id=s.id WHERE 1=1";
  const params = [];
  if (staff_id) { sql += " AND t.staff_id=?"; params.push(staff_id); }
  sql += " ORDER BY t.date DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/training", auth, (req, res) => {
  const { staff_id, trainer, topic, date, duration_mins, notes, test_score } = req.body;
  db.run("INSERT INTO training (staff_id,trainer,topic,date,duration_mins,notes,test_score) VALUES (?,?,?,?,?,?,?)",
    [staff_id, trainer, topic, date, duration_mins, notes, test_score],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Training logged" });
    });
});

// ====================================
// INCIDENTS
// ====================================
app.get("/incidents", auth, (req, res) => {
  db.all("SELECT i.*,s.name as staff_name FROM incidents i LEFT JOIN staff s ON i.staff_id=s.id ORDER BY i.reported_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/incidents", auth, (req, res) => {
  const { staff_id, patient_id, type, description, severity, action_taken } = req.body;
  db.run("INSERT INTO incidents (staff_id,patient_id,type,description,severity,action_taken) VALUES (?,?,?,?,?,?)",
    [staff_id, patient_id, type, description, severity, action_taken],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Incident reported" });
    });
});

app.put("/incidents/:id", auth, (req, res) => {
  const { status, action_taken, resolved_at } = req.body;
  db.run("UPDATE incidents SET status=?,action_taken=?,resolved_at=? WHERE id=?",
    [status, action_taken, resolved_at || null, req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Incident updated" });
    });
});

// ====================================
// PATIENTS
// ====================================
app.get("/patients", auth, (req, res) => {
  const { status, service_location, category, search } = req.query;
  let sql = "SELECT * FROM patients WHERE 1=1";
  const params = [];
  if (status) { sql += " AND status=?"; params.push(status); }
  if (service_location) { sql += " AND service_location=?"; params.push(service_location); }
  if (category) { sql += " AND category=?"; params.push(category); }
  if (search) { sql += " AND (name LIKE ? OR reg_number LIKE ? OR mobile LIKE ?)"; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  sql += " ORDER BY id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/patients/:id", auth, (req, res) => {
  db.get("SELECT * FROM patients WHERE id=?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json(err);
    if (!row) return res.status(404).json({ message: "Not found" });
    res.json(row);
  });
});

app.post("/patients", auth, upload.single("photo"), (req, res) => {
  const d = req.body;
  // Auto-generate registration number
  db.get("SELECT COUNT(*) as cnt FROM patients", [], (err, row) => {
    const reg = `RO-PAT-${String((row?.cnt || 0) + 1).padStart(4,'0')}`;
    const photo = req.file ? req.file.path : "";
    db.run(`INSERT INTO patients (reg_number,sgrh_reg,name,age,gender,mobile,address,landmark,diagnosis,doctor_name,hospital,admission_date,discharge_date,blood_group,allergies,current_medications,service_location,category,status,assigned_staff,photo,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [reg, d.sgrh_reg, d.name, d.age, d.gender, d.mobile, d.address, d.landmark, d.diagnosis, d.doctor_name, d.hospital, d.admission_date, d.discharge_date, d.blood_group, d.allergies, d.current_medications, d.service_location, d.category, d.status||"Active", d.assigned_staff, photo, d.notes],
      function(err) {
        if (err) return res.status(500).json(err);
        res.json({ id: this.lastID, reg_number: reg, message: "Patient Registered" });
      });
  });
});

app.put("/patients/:id", auth, upload.single("photo"), (req, res) => {
  const d = req.body;
  // Check if frozen
  db.get("SELECT frozen FROM patients WHERE id=?", [req.params.id], (err, row) => {
    if (row?.frozen && req.user?.role !== "admin") {
      return res.status(403).json({ message: "Patient details are frozen. Only admin can edit." });
    }
    const photo = req.file ? req.file.path : d.photo || "";
    db.run(`UPDATE patients SET sgrh_reg=?,name=?,age=?,gender=?,mobile=?,address=?,landmark=?,diagnosis=?,doctor_name=?,hospital=?,admission_date=?,discharge_date=?,blood_group=?,allergies=?,current_medications=?,service_location=?,category=?,status=?,assigned_staff=?,photo=?,notes=? WHERE id=?`,
      [d.sgrh_reg,d.name,d.age,d.gender,d.mobile,d.address,d.landmark,d.diagnosis,d.doctor_name,d.hospital,d.admission_date,d.discharge_date,d.blood_group,d.allergies,d.current_medications,d.service_location,d.category,d.status,d.assigned_staff,photo,d.notes,req.params.id],
      function(err) {
        if (err) return res.status(500).json(err);
        res.json({ message: "Patient Updated" });
      });
  });
});

app.patch("/patients/:id/freeze", auth, (req, res) => {
  // Only admin can freeze/unfreeze
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Only Admin can freeze/unfreeze patient records" });
  const action = req.body.frozen ? "Frozen" : "Unfrozen";
  db.run("UPDATE patients SET frozen=? WHERE id=?", [req.body.frozen ? 1 : 0, req.params.id], function(err) {
    if (err) return res.status(500).json(err);
    // log the action
    db.run("INSERT INTO patient_freeze_log (patient_id,action,done_by,reason) VALUES (?,?,?,?)",
      [req.params.id, action, req.user?.name || "Admin", req.body.reason || ""]);
    res.json({ message: `Patient ${action.toLowerCase()} successfully` });
  });
});

app.post("/patients/:id/documents", auth, upload.single("document"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file" });
  db.run("INSERT INTO patient_documents (patient_id,document_type,document_name,file_path) VALUES (?,?,?,?)",
    [req.params.id, req.body.documentType, req.file.originalname, req.file.path],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Document uploaded" });
    });
});

app.get("/patients/:id/documents", auth, (req, res) => {
  db.all("SELECT * FROM patient_documents WHERE patient_id=? ORDER BY id DESC", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ====================================
// LEADS
// ====================================
app.get("/leads", auth, (req, res) => {
  const { status, search } = req.query;
  let sql = "SELECT * FROM leads WHERE 1=1";
  const params = [];
  if (status) { sql += " AND status=?"; params.push(status); }
  if (search) { sql += " AND (patient_name LIKE ? OR caller_mobile LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  sql += " ORDER BY id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/leads", auth, (req, res) => {
  const d = req.body;
  db.run("INSERT INTO leads (caller_name,caller_mobile,relation,source,patient_name,patient_age,patient_gender,patient_address,diagnosis,service_needed,urgency,status,notes,follow_up_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [d.caller_name,d.caller_mobile,d.relation,d.source,d.patient_name,d.patient_age,d.patient_gender,d.patient_address,d.diagnosis,d.service_needed,d.urgency,d.status||"New",d.notes,d.follow_up_date],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Lead created" });
    });
});

app.put("/leads/:id", auth, (req, res) => {
  const d = req.body;
  db.run("UPDATE leads SET status=?,notes=?,follow_up_date=?,assigned_to=? WHERE id=?",
    [d.status, d.notes, d.follow_up_date, d.assigned_to, req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Lead updated" });
    });
});

// ====================================
// BOOKINGS
// ====================================
app.get("/bookings", auth, (req, res) => {
  const { patient_id, staff_id, status, service_category, from, to, search } = req.query;
  let sql = `SELECT b.*, p.name as patient_name, p.mobile as patient_mobile, s.name as staff_name, s.code as staff_code
    FROM bookings b
    LEFT JOIN patients p ON b.patient_id=p.id
    LEFT JOIN staff s ON b.staff_id=s.id
    WHERE 1=1`;
  const params = [];
  if (patient_id) { sql += " AND b.patient_id=?"; params.push(patient_id); }
  if (staff_id) { sql += " AND b.staff_id=?"; params.push(staff_id); }
  if (status) { sql += " AND b.status=?"; params.push(status); }
  if (service_category) { sql += " AND b.service_category=?"; params.push(service_category); }
  if (from) { sql += " AND b.start_date>=?"; params.push(from); }
  if (to) { sql += " AND b.start_date<=?"; params.push(to); }
  if (search) { sql += " AND (p.name LIKE ? OR b.booking_id LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  sql += " ORDER BY b.id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/bookings", auth, (req, res) => {
  const d = req.body;
  const now = new Date();
  const bookingId = `BK-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*9000)+1000}`;
  const expiresAt = new Date(now.getTime() + 30*24*60*60*1000).toISOString();
  const balance = parseFloat(d.amount || 0) - parseFloat(d.paid_amount || 0);

  db.run(`INSERT INTO bookings (booking_id,patient_id,service_category,service_name,start_date,end_date,shift,duration_type,staff_id,status,amount,paid_amount,balance,payment_mode,payment_status,notes,created_by,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [bookingId, d.patient_id, d.service_category, d.service_name, d.start_date, d.end_date, d.shift, d.duration_type, d.staff_id||null, d.status||"Pending", d.amount||0, d.paid_amount||0, balance, d.payment_mode, d.payment_status||"Pending", d.notes, req.user?.name||"Admin", expiresAt],
    function(err) {
      if (err) return res.status(500).json(err);

      // Auto-generate receipt
      if (d.paid_amount > 0) {
        const receiptNum = `RO-RCP-${Date.now()}`;
        db.get("SELECT name FROM patients WHERE id=?", [d.patient_id], (err, p) => {
          db.run("INSERT INTO bills (receipt_number,booking_id,patient_id,patient_name,service,amount,paid_amount,balance,payment_mode,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [receiptNum, bookingId, d.patient_id, p?.name||"", d.service_name, d.amount||0, d.paid_amount||0, balance, d.payment_mode, d.payment_status||"Pending"]);
        });
      }

      // Notify
      db.run("INSERT INTO notifications (recipient_type,recipient_id,title,message,channel) VALUES (?,?,?,?,?)",
        ["patient", d.patient_id, "Booking Confirmed", `Booking ${bookingId} created for ${d.service_name}`, "in-app"]);

      res.json({ id: this.lastID, booking_id: bookingId, message: "Booking Created" });
    });
});

app.put("/bookings/:id", auth, (req, res) => {
  const d = req.body;
  db.run("UPDATE bookings SET status=?,staff_id=?,notes=?,payment_status=?,paid_amount=?,balance=? WHERE id=?",
    [d.status, d.staff_id, d.notes, d.payment_status, d.paid_amount, d.balance, req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Booking updated" });
    });
});

app.post("/bookings/:id/reassign", auth, (req, res) => {
  const { staff_id, reason } = req.body;
  db.run("UPDATE bookings SET staff_id=?, notes=COALESCE(notes||' | ','')||? WHERE id=?",
    [staff_id, `Reassigned: ${reason}`, req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Booking reassigned" });
    });
});

// ====================================
// BILLS / RECEIPTS
// ====================================
app.get("/bills", auth, (req, res) => {
  const { patient_id, payment_status, from, to } = req.query;
  let sql = "SELECT * FROM bills WHERE 1=1";
  const params = [];
  if (patient_id) { sql += " AND patient_id=?"; params.push(patient_id); }
  if (payment_status) { sql += " AND payment_status=?"; params.push(payment_status); }
  if (from) { sql += " AND date>=?"; params.push(from); }
  if (to) { sql += " AND date<=?"; params.push(to); }
  sql += " ORDER BY id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/bills/:id/pay", auth, (req, res) => {
  const { amount, mode } = req.body;
  db.get("SELECT * FROM bills WHERE id=?", [req.params.id], (err, bill) => {
    if (!bill) return res.status(404).json({ message: "Not found" });
    const paid = parseFloat(bill.paid_amount || 0) + parseFloat(amount || 0);
    const bal = parseFloat(bill.amount) - paid;
    const status = bal <= 0 ? "Paid" : "Partial";
    db.run("UPDATE bills SET paid_amount=?,balance=?,payment_status=?,payment_mode=? WHERE id=?",
      [paid, bal, status, mode, req.params.id],
      function(err) {
        if (err) return res.status(500).json(err);
        res.json({ message: "Payment recorded" });
      });
  });
});

// ====================================
// REFUNDS
// ====================================
app.get("/refunds", auth, (req, res) => {
  const { status } = req.query;
  let sql = "SELECT * FROM refunds WHERE 1=1";
  const params = [];
  if (status) { sql += " AND status=?"; params.push(status); }
  sql += " ORDER BY initiated_at DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/refunds", auth, (req, res) => {
  const d = req.body;
  db.run(`INSERT INTO refunds (receipt_id,patient_id,patient_name,amount,reason,reason_category,mode,payee_name,payee_relation,bank_account,ifsc,initiator,status,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [d.receipt_id, d.patient_id, d.patient_name, d.amount, d.reason, d.reason_category, d.mode||"NEFT", d.payee_name, d.payee_relation, d.bank_account, d.ifsc, req.user?.name||"Admin", "Pending", d.notes],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Refund initiated" });
    });
});

app.patch("/refunds/:id/approve", auth, (req, res) => {
  const { level, utr } = req.body;
  let sql, params;
  if (level === "verify") {
    sql = "UPDATE refunds SET verifier=?,status='Verified' WHERE id=?";
    params = [req.user?.name, req.params.id];
  } else {
    sql = "UPDATE refunds SET approver=?,status='Approved',approved_at=datetime('now'),utr=? WHERE id=?";
    params = [req.user?.name, utr, req.params.id];
    // Watermark the receipt
    db.get("SELECT receipt_id FROM refunds WHERE id=?", [req.params.id], (err, row) => {
      if (row?.receipt_id) db.run("UPDATE bills SET watermark='REFUND',refund_status='Processed' WHERE id=?", [row.receipt_id]);
    });
  }
  db.run(sql, params, function(err) {
    if (err) return res.status(500).json(err);
    res.json({ message: `Refund ${level === "verify" ? "verified" : "approved"}` });
  });
});

// ====================================
// AMBULANCE
// ====================================
app.get("/ambulance", auth, (req, res) => {
  const { status, call_type, from, to } = req.query;
  let sql = "SELECT * FROM ambulance_calls WHERE 1=1";
  const params = [];
  if (status) { sql += " AND status=?"; params.push(status); }
  if (call_type) { sql += " AND call_type=?"; params.push(call_type); }
  if (from) { sql += " AND DATE(created_at)>=?"; params.push(from); }
  if (to) { sql += " AND DATE(created_at)<=?"; params.push(to); }
  sql += " ORDER BY id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/ambulance", auth, (req, res) => {
  const d = req.body;
  const callNum = `AMB-${Date.now()}`;
  db.run(`INSERT INTO ambulance_calls (call_number,caller_name,caller_mobile,patient_name,pickup_address,drop_address,call_type,ambulance_type,priority,status,amount,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [callNum, d.caller_name, d.caller_mobile, d.patient_name, d.pickup_address, d.drop_address, d.call_type, d.ambulance_type, d.priority||"Normal", "Received", d.amount||0, d.notes],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, call_number: callNum, message: "Call logged" });
    });
});

app.patch("/ambulance/:id", auth, (req, res) => {
  const d = req.body;
  db.run("UPDATE ambulance_calls SET status=?,assigned_driver=?,assigned_vehicle=?,eta=?,start_time=?,end_time=?,missed_reason=?,notes=? WHERE id=?",
    [d.status, d.assigned_driver, d.assigned_vehicle, d.eta, d.start_time, d.end_time, d.missed_reason, d.notes, req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Updated" });
    });
});

// ====================================
// ASSETS
// ====================================
app.get("/assets", auth, (req, res) => {
  db.all("SELECT * FROM assets ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/assets", auth, (req, res) => {
  const d = req.body;
  const code = `AST-${Date.now()}`;
  db.run("INSERT INTO assets (asset_code,name,category,vendor,serial_number,purchase_date,warranty_expiry,amc_date,cmc_date,location,status,quantity,cost,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [code, d.name, d.category, d.vendor, d.serial_number, d.purchase_date, d.warranty_expiry, d.amc_date, d.cmc_date, d.location, d.status||"Active", d.quantity||1, d.cost, d.notes],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Asset added" });
    });
});

// ====================================
// VENDORS
// ====================================
app.get("/vendors", auth, (req, res) => {
  db.all("SELECT * FROM vendors ORDER BY name", [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/vendors", auth, (req, res) => {
  const { name, type, contact, email, address } = req.body;
  db.run("INSERT INTO vendors (name,type,contact,email,address) VALUES (?,?,?,?,?)",
    [name, type, contact, email, address],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Vendor added" });
    });
});

app.put("/vendors/:id", auth, (req, res) => {
  const { name, type, contact, email, address, status } = req.body;
  db.run("UPDATE vendors SET name=?,type=?,contact=?,email=?,address=?,status=? WHERE id=?",
    [name, type, contact, email, address, status || "Active", req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Vendor updated" });
    });
});

app.delete("/vendors/:id", auth, (req, res) => {
  db.run("DELETE FROM vendors WHERE id=?", [req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Vendor deleted" });
    });
});

// ====================================
// ROSTER
// ====================================
app.get("/roster", auth, (req, res) => {
  const { date, from, to, staff_id, vendor, shift } = req.query;
  let sql = `SELECT r.*, s.name as staff_name, s.role, s.vendor, s.duty_tag, s.mobile as staff_mobile,
    p.name as patient_name, p.address as patient_address, p.reg_number
    FROM roster r
    LEFT JOIN staff s ON r.staff_id=s.id
    LEFT JOIN patients p ON r.patient_id=p.id
    WHERE 1=1`;
  const params = [];
  if (date)     { sql += " AND r.date=?"; params.push(date); }
  if (from)     { sql += " AND r.date>=?"; params.push(from); }
  if (to)       { sql += " AND r.date<=?"; params.push(to); }
  if (staff_id) { sql += " AND r.staff_id=?"; params.push(staff_id); }
  if (vendor)   { sql += " AND s.vendor=?"; params.push(vendor); }
  if (shift)    { sql += " AND r.shift=?"; params.push(shift); }
  sql += " ORDER BY r.date, r.shift, s.name";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// Smart roster availability engine
app.get("/roster/available-staff", auth, (req, res) => {
  const { date, shift, role, vendor } = req.query;
  if (!date) return res.status(400).json({ message: "date required" });

  // Find staff who are Active + not already rostered on this date/shift
  let sql = `SELECT s.id, s.name, s.code, s.role, s.vendor, s.duty_tag, s.mobile, s.rating,
    s.qualification, s.experience,
    (SELECT COUNT(*) FROM roster r2 WHERE r2.staff_id=s.id AND r2.date=?) as roster_count,
    (SELECT COUNT(*) FROM attendance a WHERE a.staff_id=s.id AND a.date=?) as attended_today
    FROM staff s
    WHERE s.status='Active'
    AND s.duty_tag NOT IN ('Suspended','Terminated','On Leave')
    AND s.id NOT IN (
      SELECT staff_id FROM roster WHERE date=? ${shift ? "AND shift=?" : ""}
    )`;
  const params = [date, date, date];
  if (shift)  params.push(shift);
  if (role)   { sql += " AND s.role=?"; params.push(role); }
  if (vendor) { sql += " AND s.vendor=?"; params.push(vendor); }
  sql += " ORDER BY s.duty_tag='Available' DESC, s.rating DESC, s.name";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/roster", auth, (req, res) => {
  const { staff_id, date, shift, patient_id, notes } = req.body;
  if (!staff_id || !date || !shift) return res.status(400).json({ message: "staff_id, date and shift are required" });

  // Check for conflict
  db.get("SELECT id FROM roster WHERE staff_id=? AND date=? AND shift=?", [staff_id, date, shift], (err, existing) => {
    if (existing) return res.status(400).json({ message: "This staff member is already rostered for this date and shift." });

    db.run("INSERT INTO roster (staff_id,date,shift,patient_id,notes,status) VALUES (?,?,?,?,?,'Scheduled')",
      [staff_id, date, shift, patient_id||null, notes||""],
      function(err) {
        if (err) return res.status(500).json(err);
        // Update staff duty tag
        db.run("UPDATE staff SET duty_tag='On Duty' WHERE id=? AND duty_tag='Available'", [staff_id]);
        res.json({ id: this.lastID, message: "Roster entry added" });
      });
  });
});

app.put("/roster/:id", auth, (req, res) => {
  const { status, notes, staff_id, shift } = req.body;
  db.run("UPDATE roster SET status=?,notes=?,staff_id=COALESCE(?,staff_id),shift=COALESCE(?,shift) WHERE id=?",
    [status, notes, staff_id||null, shift||null, req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Roster updated" });
    });
});

app.delete("/roster/:id", auth, (req, res) => {
  db.run("DELETE FROM roster WHERE id=?", [req.params.id], function(err) {
    if (err) return res.status(500).json(err);
    res.json({ message: "Roster entry removed" });
  });
});

// Roster summary for a date range
app.get("/roster/summary", auth, (req, res) => {
  const { from, to } = req.query;
  db.all(`SELECT 
    r.date,
    COUNT(*) as total_shifts,
    COUNT(DISTINCT r.staff_id) as staff_count,
    COUNT(DISTINCT r.patient_id) as patient_count,
    SUM(CASE WHEN r.status='Completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN r.status='Scheduled' THEN 1 ELSE 0 END) as scheduled
    FROM roster r
    WHERE 1=1
    ${from ? "AND r.date>='"+from+"'" : ""}
    ${to ? "AND r.date<='"+to+"'" : ""}
    GROUP BY r.date ORDER BY r.date DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      res.json(rows);
    });
});

// ====================================
// MEDICAL CHARTS
// ====================================
app.post("/medical-charts", auth, (req, res) => {
  const { booking_id, patient_id, staff_id, chart_type, chart_data, visit_date } = req.body;
  db.run("INSERT INTO medical_charts (booking_id,patient_id,staff_id,chart_type,chart_data,visit_date) VALUES (?,?,?,?,?,?)",
    [booking_id, patient_id, staff_id, chart_type, typeof chart_data === "object" ? JSON.stringify(chart_data) : chart_data, visit_date || new Date().toISOString().split("T")[0]],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Chart saved" });
    });
});

app.get("/medical-charts", auth, (req, res) => {
  const { patient_id, booking_id, chart_type, from, to } = req.query;
  let sql = `SELECT mc.*, s.name as staff_name, p.name as patient_name
    FROM medical_charts mc
    LEFT JOIN staff s ON mc.staff_id=s.id
    LEFT JOIN patients p ON mc.patient_id=p.id
    WHERE 1=1`;
  const params = [];
  if (patient_id) { sql += " AND mc.patient_id=?"; params.push(patient_id); }
  if (booking_id) { sql += " AND mc.booking_id=?"; params.push(booking_id); }
  if (chart_type) { sql += " AND mc.chart_type=?"; params.push(chart_type); }
  if (from)       { sql += " AND mc.visit_date>=?"; params.push(from); }
  if (to)         { sql += " AND mc.visit_date<=?"; params.push(to); }
  sql += " ORDER BY mc.visit_date DESC, mc.id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    // Parse chart_data JSON for easy consumption
    const parsed = rows.map(r => {
      try { return { ...r, data: JSON.parse(r.chart_data) }; }
      catch { return { ...r, data: {} }; }
    });
    res.json(parsed);
  });
});

// Chart trend for a patient (BP, sugar, vitals over time)
app.get("/medical-charts/trends/:patient_id", auth, (req, res) => {
  db.all(`SELECT chart_type, chart_data, visit_date FROM medical_charts
    WHERE patient_id=? ORDER BY visit_date ASC LIMIT 90`,
    [req.params.patient_id],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      const trends = {};
      rows.forEach(r => {
        if (!trends[r.chart_type]) trends[r.chart_type] = [];
        try {
          trends[r.chart_type].push({ date: r.visit_date, ...JSON.parse(r.chart_data) });
        } catch {}
      });
      res.json(trends);
    });
});

// Latest vitals per patient
app.get("/medical-charts/latest-vitals", auth, (req, res) => {
  db.all(`SELECT mc.patient_id, p.name as patient_name, mc.chart_data, mc.visit_date
    FROM medical_charts mc
    JOIN patients p ON mc.patient_id=p.id
    WHERE mc.chart_type='vitals'
    AND mc.id IN (SELECT MAX(id) FROM medical_charts WHERE chart_type='vitals' GROUP BY patient_id)
    ORDER BY mc.visit_date DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      const result = rows.map(r => {
        try { return { ...r, data: JSON.parse(r.chart_data) }; }
        catch { return { ...r, data: {} }; }
      });
      res.json(result);
    });
});

// ====================================
// ANALYTICS
// ====================================
app.get("/analytics/monthly-revenue", auth, (req, res) => {
  db.all(`SELECT strftime('%Y-%m',date) as month, SUM(paid_amount) as revenue, SUM(amount) as billed, COUNT(*) as count
    FROM bills GROUP BY month ORDER BY month DESC LIMIT 12`, [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/analytics/service-demand", auth, (req, res) => {
  db.all("SELECT service_name, service_category, COUNT(*) as count FROM bookings GROUP BY service_name ORDER BY count DESC", [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/analytics/staff-performance", auth, (req, res) => {
  db.all(`SELECT s.id, s.name, s.role, s.vendor, s.rating, s.duty_tag,
    COUNT(DISTINCT b.id) as total_bookings,
    ROUND(AVG(a.hours_worked),2) as avg_hours
    FROM staff s
    LEFT JOIN bookings b ON s.id=b.staff_id
    LEFT JOIN attendance a ON s.id=a.staff_id
    GROUP BY s.id ORDER BY s.rating DESC`, [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/analytics/patient-categories", auth, (req, res) => {
  db.all("SELECT service_location, category, COUNT(*) as count FROM patients WHERE status='Active' GROUP BY service_location, category", [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/analytics/ambulance-stats", auth, (req, res) => {
  db.all(`SELECT ambulance_type, call_type, status, COUNT(*) as count,
    strftime('%Y-%m',created_at) as month
    FROM ambulance_calls GROUP BY ambulance_type, call_type, status, month ORDER BY month DESC`, [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ====================================
// NOTIFICATIONS
// ====================================
app.get("/notifications", auth, (req, res) => {
  db.all("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50", [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ====================================
// SERVICES MASTER
// ====================================
app.get("/services", auth, (req, res) => {
  res.json([
    { category: "Nursing", items: ["24-Hour Nursing", "12-Hour Nursing", "Critical Care Nursing", "Palliative Care Nursing", "ICU at Home", "Mother & Baby Care"] },
    { category: "GDA / Attendant", items: ["24-Hour GDA", "12-Hour GDA", "Geriatric Care", "General Attendant"] },
    { category: "Allied Health", items: ["Physiotherapy (General)", "Physiotherapy (Specialized)", "Physiotherapy (Chest)", "Doctor Home Visit", "Dietitian / Nutrition Counseling", "Pain Management"] },
    { category: "Diagnostic", items: ["Blood Sample Collection", "Portable X-Ray at Home", "ECG at Home", "Sleep Study"] },
    { category: "Clinical Procedures", items: ["Wound Dressing", "Injection (IV/IM/SC)", "Ryle's Tube Insertion", "Foley Catheter", "PICC Line Care", "Stoma Care", "Tracheostomy Care", "Suture Removal", "Nebulization"] },
    { category: "Ambulance", items: ["ALS (Advanced Life Support)", "BLS (Basic Life Support)", "Patient Transport", "Air Ambulance", "Rail Ambulance", "Last Journey"] },
    { category: "Equipment Rental", items: ["Ventilator", "BiPAP/CPAP", "Oxygen Concentrator", "Hospital Bed", "Wheelchair", "Motorized Stair Climber"] },
    { category: "Other", items: ["Adult Vaccination", "Yoga", "Medical Equipment Arrangement", "Guide Service"] },
  ]);
});

// ====================================
// LEGACY COMPAT (old routes)
// ====================================
app.get("/upload/:staffId", auth, (req, res) => res.json([]));
app.get("/documents/:staffId", auth, (req, res) => {
  db.all("SELECT * FROM staff_documents WHERE staff_id=? ORDER BY id DESC", [req.params.staffId], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});



// ====================================
// STAFF COMPLIANCE ENGINE (Full)
// ====================================

function getRequiredDocs(role) {
  const base = ["Aadhaar Card","PAN Card","Police Verification","Medical Fitness","Bank Passbook"];
  const roleMap = {
    "Nurse":           [...base, "Nursing Council Reg", "Degree/Diploma"],
    "GDA":             [...base, "GDA Certificate"],
    "Physiotherapist": [...base, "BPT Degree/Diploma"],
    "Doctor":          [...base, "MBBS/MD Degree", "Medical Council Reg"],
    "Driver":          [...base, "Driving License", "Vehicle RC"],
    "Aaya":            ["Aadhaar Card","PAN Card","Police Verification","Bank Passbook"],
    "Helper":          ["Aadhaar Card","PAN Card","Police Verification","Bank Passbook"],
    "Housekeeping":    ["Aadhaar Card","PAN Card","Police Verification","Bank Passbook"],
    "FOE":             ["Aadhaar Card","PAN Card","Police Verification","Bank Passbook","Resume"],
    "Accountant":      ["Aadhaar Card","PAN Card","Police Verification","Bank Passbook","Degree/Diploma"],
  };
  return roleMap[role] || base;
}

function computeCompliance(s, docs) {
  const required = getRequiredDocs(s.role);
  const uploaded = docs.map(d => d.document_type);
  const missing  = required.filter(r => !uploaded.includes(r));
  const in30     = new Date(Date.now()+30*24*60*60*1000).toISOString().split("T")[0];
  const today    = new Date().toISOString().split("T")[0];
  const expiring = docs.filter(d => d.expiry_date && d.expiry_date > today && d.expiry_date <= in30);
  const expired  = docs.filter(d => d.expiry_date && d.expiry_date < today);
  const compliance_pct = required.length > 0 
    ? Math.round(((required.length - missing.length) / required.length) * 100) 
    : 100;
  const alerts = [];
  if (missing.includes("Police Verification")) alerts.push({ type:"CRITICAL", msg:"Police Verification missing" });
  if (missing.includes("Nursing Council Reg") && s.role==="Nurse") alerts.push({ type:"CRITICAL", msg:"Nursing Council Registration missing" });
  if (expired.length > 0) alerts.push({ type:"CRITICAL", msg:`${expired.length} document(s) expired` });
  if (expiring.length > 0) alerts.push({ type:"WARNING", msg:`${expiring.length} document(s) expiring within 30 days` });
  if (missing.length > 0 && !alerts.find(a=>a.type==="CRITICAL")) alerts.push({ type:"INFO", msg:`${missing.length} document(s) missing` });

  return { required, missing, expiring, expired, compliance_pct, alerts,
    status: expired.length>0||missing.includes("Police Verification") ? "Non-Compliant" :
            compliance_pct >= 80 ? "Compliant" : compliance_pct >= 50 ? "Partial" : "Action Needed" };
}

app.get("/staff-compliance", auth, (req, res) => {
  const { vendor, role, status } = req.query;
  let sql = "SELECT * FROM staff WHERE status='Active'";
  const params = [];
  if (vendor) { sql += " AND vendor=?"; params.push(vendor); }
  if (role)   { sql += " AND role=?"; params.push(role); }
  sql += " ORDER BY name";

  db.all(sql, params, (err, staffList) => {
    if (err) return res.status(500).json(err);
    if (staffList.length === 0) return res.json([]);
    let done = 0;
    const results = [];
    staffList.forEach(s => {
      db.all("SELECT * FROM staff_documents WHERE staff_id=?", [s.id], (err, docs) => {
        const c = computeCompliance(s, docs);
        results.push({ id:s.id, name:s.name, code:s.code, role:s.role, vendor:s.vendor,
          duty_tag:s.duty_tag, mobile:s.mobile, doc_count:docs.length,
          required_count:c.required.length, missing_count:c.missing.length,
          missing_docs:c.missing, expiring_docs:c.expiring.length,
          expired_docs:c.expired.length, compliance_pct:c.compliance_pct,
          status:c.status, alerts:c.alerts });
        if (++done === staffList.length) {
          let sorted = results.sort((a,b) => a.compliance_pct - b.compliance_pct);
          if (status) sorted = sorted.filter(r=>r.status===status);
          res.json(sorted);
        }
      });
    });
  });
});

app.get("/staff-compliance/summary", auth, (req, res) => {
  db.all("SELECT * FROM staff WHERE status='Active'", [], (err, staffList) => {
    if (err) return res.status(500).json(err);
    if (staffList.length === 0) return res.json({ total:0, compliant:0, partial:0, non_compliant:0, action_needed:0 });
    let done = 0;
    const counts = { total:staffList.length, compliant:0, partial:0, non_compliant:0, action_needed:0, critical_alerts:0 };
    staffList.forEach(s => {
      db.all("SELECT * FROM staff_documents WHERE staff_id=?", [s.id], (err, docs) => {
        const c = computeCompliance(s, docs);
        if (c.status==="Compliant") counts.compliant++;
        else if (c.status==="Partial") counts.partial++;
        else if (c.status==="Non-Compliant") counts.non_compliant++;
        else counts.action_needed++;
        counts.critical_alerts += c.alerts.filter(a=>a.type==="CRITICAL").length;
        if (++done === staffList.length) res.json(counts);
      });
    });
  });
});

app.get("/staff-compliance/:id", auth, (req, res) => {
  db.get("SELECT * FROM staff WHERE id=?", [req.params.id], (err, s) => {
    if (!s) return res.status(404).json({ message: "Not found" });
    db.all("SELECT * FROM staff_documents WHERE staff_id=?", [s.id], (err, docs) => {
      const c = computeCompliance(s, docs);
      res.json({ ...s, docs, ...c });
    });
  });
});

// ====================================
// PATIENT FREEZE — AUDIT LOG
// ====================================
app.get("/patients/:id/freeze-log", auth, (req, res) => {
  db.all("SELECT * FROM patient_freeze_log WHERE patient_id=? ORDER BY id DESC", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows || []);
  });
});

// ====================================
// CONSENT FORMS
// ====================================
app.get("/consents", auth, (req, res) => {
  const { patient_id } = req.query;
  let sql = "SELECT * FROM consents WHERE 1=1";
  const params = [];
  if (patient_id) { sql += " AND patient_id=?"; params.push(patient_id); }
  sql += " ORDER BY id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/consents", auth, (req, res) => {
  const { patient_id, patient_name, consent_type, signed_by, relation, notes } = req.body;
  db.run("INSERT INTO consents (patient_id,patient_name,consent_type,signed_by,relation,notes,status) VALUES (?,?,?,?,?,?,'Signed')",
    [patient_id, patient_name, consent_type, signed_by, relation, notes],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Consent recorded" });
    });
});

// ====================================
// FEEDBACK
// ====================================
app.get("/feedback", auth, (req, res) => {
  const { patient_id, staff_id } = req.query;
  let sql = "SELECT * FROM feedback WHERE 1=1";
  const params = [];
  if (patient_id) { sql += " AND patient_id=?"; params.push(patient_id); }
  if (staff_id) { sql += " AND staff_id=?"; params.push(staff_id); }
  sql += " ORDER BY id DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/feedback", auth, (req, res) => {
  const { patient_id, patient_name, staff_id, booking_id, overall_rating, staff_rating, punctuality_rating, service_rating, recommend, comments, submitted_by } = req.body;
  db.run(`INSERT INTO feedback (patient_id,patient_name,staff_id,booking_id,overall_rating,staff_rating,punctuality_rating,service_rating,recommend,comments,submitted_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [patient_id, patient_name, staff_id, booking_id, overall_rating, staff_rating, punctuality_rating, service_rating, recommend, comments, submitted_by],
    function(err) {
      if (err) return res.status(500).json(err);
      // update staff rating
      if (staff_id && staff_rating) {
        db.get("SELECT AVG(score) as avg FROM staff_ratings WHERE staff_id=?", [staff_id], (err, row) => {
          if (row) db.run("UPDATE staff SET rating=? WHERE id=?", [row.avg || staff_rating, staff_id]);
        });
        db.run("INSERT INTO staff_ratings (staff_id,patient_id,source,score,comment) VALUES (?,?,?,?,?)",
          [staff_id, patient_id, "Patient Feedback", staff_rating, comments]);
      }
      res.json({ id: this.lastID, message: "Feedback submitted" });
    });
});

// ====================================
// MCQ / TRAINING EXAMS
// ====================================
app.get("/mcq/questions", auth, (req, res) => {
  const { topic } = req.query;
  let sql = "SELECT * FROM mcq_questions WHERE 1=1";
  const params = [];
  if (topic) { sql += " AND topic=?"; params.push(topic); }
  sql += " ORDER BY topic, id";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.post("/mcq/questions", auth, (req, res) => {
  const { topic, question, option_a, option_b, option_c, option_d, correct_option, marks } = req.body;
  db.run("INSERT INTO mcq_questions (topic,question,option_a,option_b,option_c,option_d,correct_option,marks) VALUES (?,?,?,?,?,?,?,?)",
    [topic, question, option_a, option_b, option_c, option_d, correct_option, marks || 1],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, message: "Question added" });
    });
});

app.delete("/mcq/questions/:id", auth, (req, res) => {
  db.run("DELETE FROM mcq_questions WHERE id=?", [req.params.id], function(err) {
    if (err) return res.status(500).json(err);
    res.json({ message: "Question deleted" });
  });
});

app.post("/mcq/submit", auth, (req, res) => {
  const { staff_id, topic, answers, training_id } = req.body;
  db.all("SELECT * FROM mcq_questions WHERE topic=?", [topic], (err, questions) => {
    if (!questions || questions.length === 0) return res.status(400).json({ message: "No questions found" });
    let correct = 0, total = questions.length;
    questions.forEach(q => {
      if (answers[q.id] && answers[q.id].toUpperCase() === q.correct_option.toUpperCase()) correct++;
    });
    const score = Math.round((correct / total) * 100);
    db.run("INSERT INTO mcq_results (staff_id,topic,training_id,score,correct,total,submitted_at) VALUES (?,?,?,?,?,?,datetime('now'))",
      [staff_id, topic, training_id || null, score, correct, total],
      function(err) {
        if (err) return res.status(500).json(err);
        if (training_id) db.run("UPDATE training SET test_score=? WHERE id=?", [score, training_id]);
        res.json({ id: this.lastID, score, correct, total, message: `Score: ${score}% (${correct}/${total} correct)` });
      });
  });
});

app.get("/mcq/results", auth, (req, res) => {
  const { staff_id } = req.query;
  let sql = `SELECT r.*, s.name as staff_name FROM mcq_results r LEFT JOIN staff s ON r.staff_id=s.id WHERE 1=1`;
  const params = [];
  if (staff_id) { sql += " AND r.staff_id=?"; params.push(staff_id); }
  sql += " ORDER BY r.submitted_at DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ====================================
// PAYROLL / WORKING HOURS
// ====================================
app.get("/payroll", auth, (req, res) => {
  const { month, staff_id, vendor } = req.query;
  const m = month || new Date().toISOString().slice(0,7);
  let sql = `SELECT s.id, s.name, s.code, s.role, s.vendor, s.employment_type, s.salary,
    s.bank_account, s.ifsc,
    COUNT(a.id) as days_attended,
    COUNT(CASE WHEN a.status='Present' THEN 1 END) as present_days,
    COUNT(CASE WHEN a.status='Absent' THEN 1 END) as absent_days,
    ROUND(SUM(COALESCE(a.hours_worked,0)),2) as total_hours,
    ROUND(AVG(COALESCE(a.hours_worked,0)),2) as avg_hours_per_day,
    COUNT(DISTINCT b.id) as bookings_served,
    pr.gross_pay, pr.net_pay, pr.payment_status as payroll_status, pr.id as payroll_id
    FROM staff s
    LEFT JOIN attendance a ON s.id=a.staff_id AND strftime('%Y-%m',a.date)=?
    LEFT JOIN bookings b ON s.id=b.staff_id AND strftime('%Y-%m',b.start_date)=?
    LEFT JOIN payroll_records pr ON s.id=pr.staff_id AND pr.month=?
    WHERE s.status='Active'`;
  const params = [m, m, m];
  if (staff_id) { sql += " AND s.id=?"; params.push(staff_id); }
  if (vendor)   { sql += " AND s.vendor=?"; params.push(vendor); }
  sql += " GROUP BY s.id ORDER BY s.name";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    // Calculate gross/net pay for each
    const result = rows.map(r => {
      const monthlySalary = parseFloat((r.salary||"0").replace(/[^0-9.]/g,"")) || 0;
      const workingDays = 26;
      const grossPay = r.gross_pay || Math.round((monthlySalary / workingDays) * (r.present_days || 0));
      const deductions = Math.round(grossPay * 0.02); // 2% TDS placeholder
      const netPay = grossPay - deductions;
      return { ...r, monthly_salary: monthlySalary, gross_pay: grossPay, deductions, net_pay: netPay };
    });
    res.json(result);
  });
});

app.post("/payroll/generate", auth, (req, res) => {
  const { month, staff_ids } = req.body;
  if (!month) return res.status(400).json({ message: "month required" });
  const m = month;
  const ids = staff_ids || [];

  db.all(`SELECT s.id, s.name, s.salary,
    COUNT(CASE WHEN a.status='Present' THEN 1 END) as present_days,
    ROUND(SUM(COALESCE(a.hours_worked,0)),2) as total_hours
    FROM staff s
    LEFT JOIN attendance a ON s.id=a.staff_id AND strftime('%Y-%m',a.date)=?
    WHERE s.status='Active' ${ids.length>0?"AND s.id IN ("+ids.join(",")+")" : ""}
    GROUP BY s.id`, [m],
    (err, staff) => {
      if (err) return res.status(500).json(err);
      let done = 0;
      if (staff.length === 0) return res.json({ message: "No staff found", generated: 0 });

      staff.forEach(s => {
        const monthlySalary = parseFloat((s.salary||"0").replace(/[^0-9.]/g,"")) || 0;
        const grossPay = Math.round((monthlySalary / 26) * (s.present_days || 0));
        const deductions = Math.round(grossPay * 0.02);
        const netPay = grossPay - deductions;

        db.get("SELECT id FROM payroll_records WHERE staff_id=? AND month=?", [s.id, m], (err, existing) => {
          if (existing) {
            db.run("UPDATE payroll_records SET gross_pay=?,deductions=?,net_pay=?,days_payable=?,total_hours=? WHERE id=?",
              [grossPay, deductions, netPay, s.present_days||0, s.total_hours||0, existing.id]);
          } else {
            db.run("INSERT INTO payroll_records (staff_id,month,base_salary,days_payable,total_hours,gross_pay,deductions,net_pay,generated_by) VALUES (?,?,?,?,?,?,?,?,?)",
              [s.id, m, monthlySalary, s.present_days||0, s.total_hours||0, grossPay, deductions, netPay, req.user?.name||"Admin"]);
          }
          if (++done === staff.length) res.json({ message: `Payroll generated for ${done} staff`, month: m });
        });
      });
    });
});

app.patch("/payroll/:id/pay", auth, (req, res) => {
  const { payment_mode, payment_date, remarks } = req.body;
  db.run("UPDATE payroll_records SET payment_status='Paid',payment_mode=?,payment_date=?,remarks=? WHERE id=?",
    [payment_mode, payment_date||new Date().toISOString().split("T")[0], remarks, req.params.id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Payment recorded" });
    });
});

app.get("/payroll/records", auth, (req, res) => {
  const { month, vendor } = req.query;
  let sql = `SELECT pr.*, s.name, s.code, s.role, s.vendor, s.bank_account, s.ifsc
    FROM payroll_records pr JOIN staff s ON pr.staff_id=s.id WHERE 1=1`;
  const params = [];
  if (month) { sql += " AND pr.month=?"; params.push(month); }
  if (vendor) { sql += " AND s.vendor=?"; params.push(vendor); }
  sql += " ORDER BY s.name";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});


// ====================================
// STAFF AVAILABILITY ENGINE
// ====================================
app.get("/staff/available", auth, (req, res) => {
  const { date, shift, role, vendor } = req.query;
  const checkDate = date || new Date().toISOString().split("T")[0];

  db.all(`SELECT s.id, s.name, s.code, s.role, s.vendor, s.duty_tag, s.mobile, s.rating,
    s.qualification, s.experience,
    (SELECT COUNT(*) FROM bookings b WHERE b.staff_id=s.id AND b.status='Active' AND b.start_date<=? AND (b.end_date>=? OR b.end_date IS NULL)) as active_bookings,
    (SELECT COUNT(*) FROM roster r WHERE r.staff_id=s.id AND r.date=?) as today_roster
    FROM staff s
    WHERE s.status='Active'
    AND s.duty_tag NOT IN ('Suspended','Terminated')
    ${role ? "AND s.role=?" : ""}
    ${vendor ? "AND s.vendor=?" : ""}
    ORDER BY s.duty_tag='Available' DESC, s.rating DESC`,
    [checkDate, checkDate, checkDate, ...(role?[role]:[]), ...(vendor?[vendor]:[])],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      const result = rows.map(r => ({
        ...r,
        availability_status: r.today_roster > 0 ? "Rostered" :
          r.active_bookings > 0 ? "On Assignment" :
          r.duty_tag === "Available" ? "Free" :
          r.duty_tag === "On Duty" ? "On Duty" : r.duty_tag
      }));
      res.json(result);
    });
});

// ====================================
// REPORTS
// ====================================
app.get("/reports/staff-summary", auth, (req, res) => {
  const { from, to, vendor } = req.query;
  let sql = `SELECT s.name, s.code, s.role, s.vendor,
    COUNT(DISTINCT a.date) as days_worked,
    ROUND(SUM(COALESCE(a.hours_worked,0)),2) as total_hours,
    COUNT(DISTINCT b.id) as total_bookings,
    s.rating
    FROM staff s
    LEFT JOIN attendance a ON s.id=a.staff_id
    LEFT JOIN bookings b ON s.id=b.staff_id
    WHERE s.status='Active'`;
  const params = [];
  if (from) { sql += " AND a.date>=?"; params.push(from); }
  if (to) { sql += " AND a.date<=?"; params.push(to); }
  if (vendor) { sql += " AND s.vendor=?"; params.push(vendor); }
  sql += " GROUP BY s.id ORDER BY s.name";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/reports/patient-summary", auth, (req, res) => {
  db.all(`SELECT service_location, category, status, COUNT(*) as count FROM patients GROUP BY service_location, category, status ORDER BY count DESC`, [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/reports/revenue-summary", auth, (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT strftime('%Y-%m', date) as month,
    COUNT(*) as total_bills,
    ROUND(SUM(amount),2) as total_billed,
    ROUND(SUM(paid_amount),2) as total_collected,
    ROUND(SUM(balance),2) as total_pending,
    COUNT(CASE WHEN payment_status='Paid' THEN 1 END) as paid_count,
    COUNT(CASE WHEN payment_status='Pending' THEN 1 END) as pending_count
    FROM bills WHERE 1=1`;
  const params = [];
  if (from) { sql += " AND date>=?"; params.push(from); }
  if (to) { sql += " AND date<=?"; params.push(to); }
  sql += " GROUP BY month ORDER BY month DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ====================================
// AMC/CMC ALERTS
// ====================================
app.get("/alerts/amc-cmc", auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const in30 = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
  db.all(`SELECT *, 'AMC' as alert_type, amc_date as alert_date FROM assets WHERE amc_date IS NOT NULL AND amc_date <= ?
    UNION ALL
    SELECT *, 'CMC' as alert_type, cmc_date as alert_date FROM assets WHERE cmc_date IS NOT NULL AND cmc_date <= ?
    ORDER BY alert_date`,
    [in30, in30],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      res.json(rows);
    });
});

app.get("/alerts/document-expiry", auth, (req, res) => {
  const in30 = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
  db.all(`SELECT sd.*, s.name as staff_name, s.code as staff_code
    FROM staff_documents sd JOIN staff s ON sd.staff_id=s.id
    WHERE sd.expiry_date IS NOT NULL AND sd.expiry_date <= ?
    ORDER BY sd.expiry_date`, [in30], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});


app.listen(PORT, () => console.log(`Reach Out Server running on port ${PORT}`));
