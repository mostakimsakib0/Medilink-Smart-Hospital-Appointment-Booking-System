// server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPSTREAM = process.env.MEDIVIRTUOSO_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const frontendPublicDir = path.resolve(__dirname, '../frontend/public');

// ---------- Helpers & config ----------
const BANGLA_RANGE = /[\u0980-\u09FF]/u; // Unicode-aware

const BN_SYMPTOM_MAP = {
  'জ্বর': ['fever'],
  'সর্দি': ['cold'],
  'কাশি': ['cough'],
  'গলা': ['throat'],
  'ব্যথা': ['pain'],
  'মাথা': ['headache'],
  'বমি': ['vomit','nausea'],
  'ঝিমঝিম': ['dizzy'],
  'হৃদপিণ্ড': ['heart','cardio'],
  'বুকব্যথা': ['chest pain'],
  'বুকে ব্যথা': ['chest pain'],
  'বুকের ব্যথা': ['chest pain'],
  'ডায়াবেটিস': ['diabetes'],
  'চুলকানি': ['itch','rash'],
  'চর্ম': ['skin'],
  'গর্ভ': ['pregnancy'],
  'মাসিক': ['menstrual'],
  'মানসিক': ['anxiety','depression'],
  'চোখ': ['eye'],
  'কান': ['ear'],
  'পেট': ['stomach','abdomen'],
  'হাঁপানি': ['asthma']
};

// Normalized / lowercased BN map (NFC + lowercase) for stable comparisons
const BN_SYMPTOM_MAP_N = Object.fromEntries(
  Object.entries(BN_SYMPTOM_MAP).map(([k, v]) => [String(k).normalize('NFC').toLowerCase(), v])
);

const BN_TEMPLATES = {
  fallback: 'সংক্ষেপে আপনার লক্ষণ বা বুকিং প্রয়োজন লিখুন (উদাহরণ: বুকে চাপ, বারংবার মাথাব্যথা, গর্ভাবস্থা ফলোআপ)। জরুরি হলে স্থানীয় সেবা দিন বা হটলাইন কল করুন।',
  summary: (specialty, name, hospital, when) => `আপনার বর্ণনা ${specialty} বিভাগের চিকিৎসা প্রয়োজনীয়তার দিকে ইঙ্গিত করে। ${name} (${hospital}) ${when} এ উপলব্ধ এবং উপযুক্ত মনে হচ্ছে।`,
  optionsHeader: 'কিছু প্রস্তাবিত বিকল্প:',
  lineupItem: (name, specialty, hospital, when, rating) => `• ${name} — ${specialty} (${hospital}), পরের স্লট ${when}, রেটিং ${rating}/5`,
  closing: 'কোন ডাক্তারটি আপনার পছন্দ তা জানান অথবা বিস্তারিত বলুন যাতে আমি আলাদা সুপারিশ দিতে পারি। জরুরি ক্ষেত্রে স্থানীয় হটলাইন কল করুন।'
};

const CITY_KEYWORDS = ['dhaka','chittagong','sylhet','khulna','rajshahi'];
const SPECIALTY_KEYWORDS = {
  'back pain': ['orthopedic', 'orthopedic surgeon', 'spine', 'physio'],
  'lower back pain': ['orthopedic', 'spine'],
  'joint pain': ['orthopedic', 'rheumatology'],
  'knee pain': ['orthopedic'],
  'shoulder pain': ['orthopedic'],
  'neck pain': ['orthopedic', 'neurology'],
  'sciatica': ['orthopedic', 'spine'],
  'slipped disc': ['orthopedic', 'spine'],
  'migraine': ['neurologist'],
  'seizure': ['neurologist'],
  'numbness': ['neurologist'],
  'chest pain': ['cardiologist', 'pulmonologist'],
  'palpitation': ['cardiologist'],
  'shortness of breath': ['pulmonologist', 'cardiologist'],
  'breathing problem': ['pulmonologist'],
  'pregnancy': ['gynecologist'],
  'period pain': ['gynecologist'],
  'menstrual': ['gynecologist'],
  'fertility': ['gynecologist'],
  'diabetes': ['endocrinologist'],
  'thyroid': ['endocrinologist'],
  'skin rash': ['dermatologist'],
  'eczema': ['dermatologist'],
  'acne': ['dermatologist'],
  'anxiety': ['psychiatrist'],
  'depression': ['psychiatrist'],
  'insomnia': ['psychiatrist'],
  'kidney pain': ['nephrologist'],
  'urine problem': ['nephrologist'],
  'stomach pain': ['gastroenterologist'],
  'gastric': ['gastroenterologist'],
  'ibs': ['gastroenterologist']
};

// Small normalization helper
function normalizeText(s){
  try { return String(s || '').normalize('NFC').toLowerCase(); }
  catch { return String(s || '').toLowerCase(); }
}

// ---------- DB helper (lazy init) ----------
let pdbPromise = null;
function getDb(){
  if(!pdbPromise) pdbPromise = initDb();
  return pdbPromise;
}

// ---------- Map DB row to safe object ----------
function mapDoctorRow(row){
  if(!row) return null;
  const safeParse = (val) => {
    if(!val) return [];
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  };
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    hospital: row.hospital,
    languages: safeParse(row.languages),
    experienceYears: row.experience_years,
    rating: row.rating,
    nextAvailable: row.next_available,
    education: safeParse(row.education),
    bio: row.bio,
    location: row.location,
    conditions: safeParse(row.conditions)
  };
}

// ---------- Local chat reply builder (robust Unicode + Bangla mapping) ----------
async function buildLocalChatReply(message){
  // Normalize incoming text once (NFC + lowercase)
  const text = normalizeText(message);
  const tokens = text.split(/[^a-z0-9\u0980-\u09FF]+/u).filter(Boolean);
  const normalizedText = text.replace(/\s+/g, '');
  const prefersBangla = BANGLA_RANGE.test(text);

  // Build translatedTokens
  let translatedTokens = [];

  // Full-text scan for Bangla symptom keys (handles multi-word and joined forms)
  if(BANGLA_RANGE.test(normalizedText)){
    Object.entries(BN_SYMPTOM_MAP_N).forEach(([bnKey, mapped]) => {
      if(!bnKey) return;
      const bnNoSpace = bnKey.replace(/\s+/g, '');
      if(normalizedText.includes(bnKey) || normalizedText.includes(bnNoSpace)){
        mapped.forEach(m => translatedTokens.push(String(m)));
      }
    });
  }

  // Per-token processing
  tokens.forEach(token => {
    const tnorm = String(token).normalize('NFC'); // already lowercased via normalizeText
    if(BANGLA_RANGE.test(tnorm)){
      Object.entries(BN_SYMPTOM_MAP_N).forEach(([bnKey, mapped]) => {
        if(!bnKey) return;
        if(tnorm.includes(bnKey) || bnKey.includes(tnorm)) {
          mapped.forEach(m => translatedTokens.push(String(m)));
        }
      });
    }
    translatedTokens.push(tnorm);
  });

  // Synonym/paraphrase enrichment
  try{
    if(/chest\s*(pressure|tightness|heaviness|discomfort)/i.test(text) || normalizedText.includes('chestpressure')){
      translatedTokens.push('chest pain', 'chest tightness');
    }
    if(/difficulty breathing|breathless|breathlessness|cannot breathe|can't breathe|cant breathe/i.test(text) || normalizedText.includes('shortnessofbreath')){
      translatedTokens.push('shortness of breath', 'breathing problem');
    }
    if(translatedTokens.some(t => /pressure/.test(t))){ translatedTokens.push('pain'); }
  }catch(e){ /* ignore */ }

  // Dedupe & canonicalize
  translatedTokens = Array.from(new Set(translatedTokens.map(t => String(t).toLowerCase()).filter(Boolean)));

  // Specialty intent hits and phrase pushes
  const specialtyIntentHits = [];
  Object.entries(SPECIALTY_KEYWORDS).forEach(([phrase, targets]) => {
    const phraseLower = String(phrase).toLowerCase();
    const normalizedPhrase = phraseLower.replace(/\s+/g, '');
    if(text.includes(phraseLower) || normalizedText.includes(normalizedPhrase)){
      specialtyIntentHits.push({ phrase: phraseLower, targets });
      translatedTokens.push(phraseLower, normalizedPhrase);
      phraseLower.split(/\s+/).forEach(part => { if(part) translatedTokens.push(part); });
    }
  });

  const db = await getDb();
  const rows = await db.all('SELECT * FROM doctors');

  let ranked = rows
    .map(mapDoctorRow)
    .map(doc => {
      const loweredSpecialty = String(doc.specialty || '').toLowerCase();
      const loweredLocation = String(doc.location || '').toLowerCase();
      const loweredHospital = String(doc.hospital || '').toLowerCase();

      // Strict equality on condition tokens (doctor.conditions expected canonical tokens)
      const condHits = doc.conditions.reduce((acc, cond) => {
        const c = String(cond || '').toLowerCase().trim();
        if(!c) return acc;
        const hit = translatedTokens.some(t => t === c);
        return acc + (hit ? 2 : 0);
      }, 0);

      const specialtyHit = translatedTokens.some(t => loweredSpecialty.includes(t)) ? 1.5 : 0;
      const locationHit = translatedTokens.some(t => loweredLocation.includes(t) || loweredHospital.includes(t)) ? 0.5 : 0;
      const cityBoost = CITY_KEYWORDS.some(city => translatedTokens.includes(city) && loweredLocation.includes(city)) ? 0.5 : 0;
      const banglaLanguageBoost = prefersBangla && doc.languages.some(lang => /bangla|bengali/i.test(lang)) ? 1.2 : 0;
      const ratingBoost = doc.rating >= 4.6 ? 0.3 : 0;
      const specialtyIntentBoost = specialtyIntentHits.reduce((acc, intent) => {
        const match = intent.targets.some(target => loweredSpecialty.includes(target));
        return acc + (match ? 3 : 0);
      }, 0);

      return { doc, condHits, score: condHits + specialtyHit + locationHit + cityBoost + banglaLanguageBoost + ratingBoost + specialtyIntentBoost };
    })
    // require at least one condition hit for stricter matching
    .filter(item => item.score > 0 && item.condHits > 0)
    .sort((a,b) => b.score - a.score || b.doc.rating - a.doc.rating);

  // Narrow by specialty intent if detected
  if(specialtyIntentHits.length){
    const desiredTargets = new Set(specialtyIntentHits.flatMap(h => h.targets).map(t => String(t||'').toLowerCase()));
    const filtered = ranked.filter(item => {
      const spec = String(item.doc.specialty||'').toLowerCase();
      return [...desiredTargets].some(d => spec === d || spec.includes(d) || d.includes(spec));
    });
    if(filtered.length) ranked = filtered;
  }

  const suggestions = ranked.slice(0, 4).map(({ doc }) => ({
    id: doc.id,
    name: doc.name,
    specialty: doc.specialty,
    hospital: doc.hospital,
    nextAvailable: doc.nextAvailable,
    rating: doc.rating
  }));

  if(!suggestions.length){
    const nonMedicalReply = prefersBangla
      ? 'এটি চিকিৎসা বিষয়ক প্রশ্ন নয়; আমি ডাক্তার সাজেশন বা বুকিং-শেল্প প্রদান করি না।'
      : 'Not a medical query; this assistant only suggests doctors for medical conditions.';
    return { reply: nonMedicalReply, suggestions: [] };
  }

  const lead = suggestions[0];
  if(prefersBangla){
    const when = lead.nextAvailable || 'শীঘ্রই';
    const summaryLine = BN_TEMPLATES.summary(lead.specialty, lead.name, lead.hospital, when);
    const lineup = [
      BN_TEMPLATES.optionsHeader,
      ...suggestions.map(s => BN_TEMPLATES.lineupItem(s.name, s.specialty, s.hospital, s.nextAvailable || 'শীঘ্রই', (s.rating||0).toFixed(1)))
    ].join('\n');
    const reply = `${summaryLine}\n${lineup}\n${BN_TEMPLATES.closing}`;
    return { reply, suggestions };
  }

  // English reply
  const summaryLine = `Your description points to ${lead.specialty.toLowerCase()} care. ${lead.name} at ${lead.hospital} is available ${lead.nextAvailable || 'soon'} and is a strong fit.`;
  const lineup = suggestions.map((s)=> `• ${s.name} — ${s.specialty} (${s.hospital}), next slot ${s.nextAvailable || 'soon'}, rating ${s.rating.toFixed(1)}/5`).join('\n');
  const closing = 'Let me know which doctor works best or add more context if you’d like a different specialty. For urgent or emergency issues, call your local hotline immediately.';
  const reply = `${summaryLine}\nHere are a few tailored options:\n${lineup}\n${closing}`;
  return { reply, suggestions };
}

// ---------- Express setup ----------
app.use(cors());
app.use(express.json());

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

// Protect certain static assets before serving static files.
// - Admin routes require is_admin == true
// - Assistant route requires a valid authenticated user (any non-empty user row)
// Protect only admin static assets server-side. Assistant routes are
// intentionally left to the client-side guard so localStorage-based
// sessions or edge cases don't cause double-redirects.
app.use(async (req, res, next) => {
  const p = req.path || '';
  const shouldProtectAdmin = p === '/admin.html' || p === '/admin' || p.startsWith('/assets/js/admin') || p.startsWith('/admin/');
  if(!shouldProtectAdmin) return next();

  // Extract token from Authorization header or cookie
  const header = req.headers['authorization'] || '';
  let token = null;
  const m = header.match(/^Bearer (.+)$/i);
  if(m) token = m[1];
  if(!token){
    const cookie = req.headers.cookie || '';
    const ck = cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('ml_token='));
    if(ck) token = ck.split('=')[1];
  }

  const nextPath = req.originalUrl || req.path || '/';
  const redirectToLogin = () => res.redirect(`/login.html?next=${encodeURIComponent(nextPath)}`);

  if(!token) return redirectToLogin();

  try{
    const payload = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    // For admin-protected routes require is_admin
    const row = await db.get('SELECT is_admin FROM users WHERE id = ?', [payload.uid]);
    if(!row || !row.is_admin) return res.status(403).send('Forbidden');
    return next();
  }catch(err){
    return redirectToLogin();
  }
});

app.use(express.static(frontendPublicDir));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/medivirtuoso', async (req, res) => {
  try{
    const { message } = req.body || {};
    // require authenticated user for assistant usage
    const header = req.headers['authorization'] || '';
    let token = null;
    const m = header.match(/^Bearer (.+)$/i);
    if(m) token = m[1];
    if(!token){
      // also accept cookie
      const cookie = req.headers.cookie || '';
      const ck = cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('ml_token='));
      if(ck) token = ck.split('=')[1];
    }
    if(!token) return res.status(401).json({ error: 'Authentication required' });
    let payload;
    try{
      payload = jwt.verify(token, JWT_SECRET);
    }catch(err){
      return res.status(401).json({ error: 'Invalid token' });
    }
    const db = await getDb();
    const user = await db.get('SELECT id FROM users WHERE id = ?', [payload.uid]);
    if(!user) return res.status(401).json({ error: 'User not found' });
    if(!message || typeof message !== 'string'){
      return res.status(400).json({ error: 'Missing message' });
    }
    if(!UPSTREAM){
      const payload = await buildLocalChatReply(message);
      return res.json({ ...payload, source: 'local-fallback' });
    }
    const r = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if(!r.ok){
      const txt = await r.text().catch(()=> '');
      return res.status(502).json({ error: 'Upstream error', details: txt });
    }
    const data = await r.json().catch(()=> ({}));
    const reply = data.reply || data.text || data.response || 'I could not generate a response.';
    res.json({ reply, raw: data, source: 'medivirtuoso' });
  }catch(err){
    res.status(500).json({ error: 'Proxy failure', details: String(err) });
  }
});

// ---------- Auth helpers ----------
function signToken(user){
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next){
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer (.+)$/i);
  if(!m) return res.status(401).json({ error: 'Missing token' });
  try{
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = payload;
    next();
  }catch(err){
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Admin middleware that fetches fresh user info
function adminMiddleware(req, res, next){
  if(!req.user) return res.status(401).json({ error: 'Missing token' });
  getDb().then(async (db) => {
    try{
      const row = await db.get('SELECT id,name,email,is_admin FROM users WHERE id = ?', [req.user.uid]);
      if(!row) return res.status(401).json({ error: 'User not found' });
      if(!row.is_admin) return res.status(403).json({ error: 'Admin required' });
      req.user = { id: row.id, name: row.name, email: row.email, is_admin: !!row.is_admin };
      next();
    }catch(err){
      res.status(500).json({ error: 'Failed to validate admin', details: String(err) });
    }
  }).catch(err => res.status(500).json({ error: 'DB unavailable', details: String(err) }));
}

// ---------- Auth routes ----------
app.post('/api/auth/register', async (req, res)=>{
  try{
    const { name, email, password } = req.body || {};
    if(!name || !email || !password || password.length < 6){
      return res.status(400).json({ error: 'Invalid fields' });
    }
    const db = await getDb();
    const exists = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if(exists) return res.status(409).json({ error: 'Email already registered' });
    const hash = bcrypt.hashSync(password, 10);
    const r = await db.run('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)', [name, email, hash]);
    const user = await db.get('SELECT id,name,email FROM users WHERE id = ?', [r.lastID]);
    const token = signToken(user);
    res.json({ user, token });
  }catch(err){ res.status(500).json({ error: 'Register failed', details: String(err) }); }
});

app.post('/api/auth/login', async (req, res)=>{
  try{
    const { email, password } = req.body || {};
    if(!email || !password) return res.status(400).json({ error: 'Invalid fields' });
    const db = await getDb();
    const row = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if(!row) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, row.password_hash);
    if(!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const user = { id: row.id, name: row.name, email: row.email };
    const token = signToken(user);
    res.json({ user, token });
  }catch(err){ res.status(500).json({ error: 'Login failed', details: String(err) }); }
});

app.get('/api/me', authMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    const row = await db.get('SELECT id,name,email FROM users WHERE id = ?', [req.user.uid]);
    res.json({ user: row });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

// ---------- Public doctor endpoints ----------
app.get('/api/doctors', async (req, res)=>{
  try{
    const db = await getDb();
    const rows = await db.all('SELECT * FROM doctors');
    res.json(rows.map(mapDoctorRow));
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

app.get('/api/doctors/:id', async (req, res)=>{
  try{
    const db = await getDb();
    const r = await db.get('SELECT * FROM doctors WHERE id = ?', [req.params.id]);
    if(!r) return res.status(404).json({ error: 'Not found' });
    res.json(mapDoctorRow(r));
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

// ---------- Admin endpoints ----------
app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    const users = await db.get('SELECT COUNT(*) as c FROM users');
    const doctors = await db.get('SELECT COUNT(*) as c FROM doctors');
    const bookings = await db.get('SELECT COUNT(*) as c FROM bookings');
    res.json({ users: users.c || 0, doctors: doctors.c || 0, bookings: bookings.c || 0 });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    const rows = await db.all('SELECT id,name,email,is_admin,created_at FROM users ORDER BY created_at DESC');
    res.json({ users: rows });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

app.post('/api/admin/users/:id/toggle-admin', authMiddleware, adminMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    const id = req.params.id;
    const row = await db.get('SELECT is_admin FROM users WHERE id = ?', [id]);
    if(!row) return res.status(404).json({ error: 'User not found' });
    const next = row.is_admin ? 0 : 1;
    await db.run('UPDATE users SET is_admin = ? WHERE id = ?', [next, id]);
    res.json({ ok: true, is_admin: !!next });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

app.get('/api/admin/doctors', authMiddleware, adminMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    const rows = await db.all('SELECT * FROM doctors');
    res.json(rows.map(mapDoctorRow));
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

app.post('/api/admin/doctors', authMiddleware, adminMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    const d = req.body || {};
    if(!d.id || !d.name || !d.specialty) return res.status(400).json({ error: 'Missing fields' });
    const sql = `INSERT INTO doctors (id,name,specialty,hospital,languages,experience_years,rating,next_available,education,bio,location,conditions)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
    await db.run(sql, [
      d.id, d.name, d.specialty, d.hospital||'', JSON.stringify(d.languages||[]), d.experienceYears||0, d.rating||0, d.nextAvailable||'', JSON.stringify(d.education||[]), d.bio||'', d.location||'', JSON.stringify(d.conditions||[])
    ]);
    res.json({ ok: true });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

app.delete('/api/admin/doctors/:id', authMiddleware, adminMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    await db.run('DELETE FROM doctors WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

app.get('/api/admin/bookings', authMiddleware, adminMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    const rows = await db.all('SELECT * FROM bookings ORDER BY created_at DESC');
    res.json({ bookings: rows });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

// ---------- Bookings ----------
app.post('/api/bookings', authMiddleware, async (req, res)=>{
  try{
    const { doctorId, date, time, reason } = req.body || {};
    if(!doctorId || !date || !time) return res.status(400).json({ error: 'Missing fields' });
    const db = await getDb();
    const doc = await db.get('SELECT id FROM doctors WHERE id = ?', [doctorId]);
    if(!doc) return res.status(400).json({ error: 'Invalid doctor' });
    const r = await db.run('INSERT INTO bookings (user_id,doctor_id,date,time,reason) VALUES (?,?,?,?,?)', [req.user.uid, doctorId, date, time, reason||'']);
    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [r.lastID]);
    res.json({ booking });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

app.get('/api/bookings', authMiddleware, async (req, res)=>{
  try{
    const db = await getDb();
    const rows = await db.all('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC', [req.user.uid]);
    res.json({ bookings: rows });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

// Update (reschedule)
app.put('/api/bookings/:id', authMiddleware, async (req, res) => {
  try{
    const id = req.params.id;
    const { date, time, reason } = req.body || {};
    if(!date || !time) return res.status(400).json({ error: 'Missing fields' });
    const db = await getDb();
    const row = await db.get('SELECT * FROM bookings WHERE id = ?', [id]);
    if(!row) return res.status(404).json({ error: 'Booking not found' });
    if(row.user_id !== req.user.uid) return res.status(403).json({ error: 'Forbidden' });
    await db.run('UPDATE bookings SET date = ?, time = ?, reason = ? WHERE id = ?', [date, time, reason||'', id]);
    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [id]);
    res.json({ booking });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

// Cancel (delete)
app.delete('/api/bookings/:id', authMiddleware, async (req, res) => {
  try{
    const id = req.params.id;
    const db = await getDb();
    const row = await db.get('SELECT * FROM bookings WHERE id = ?', [id]);
    if(!row) return res.status(404).json({ error: 'Booking not found' });
    if(row.user_id !== req.user.uid) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM bookings WHERE id = ?', [id]);
    res.json({ ok: true });
  }catch(err){ res.status(500).json({ error: 'Failed', details: String(err) }); }
});

// ---------- Start server when run directly ----------
if(require.main === module){
  app.listen(PORT, async () => {
    await getDb();
    console.log(`MediLink server running on http://localhost:${PORT}`);
    if(!UPSTREAM){
      console.log('Info: MEDIVIRTUOSO_URL not set; using heuristic local chat responder.');
    } else {
      console.log(`Proxying chat to: ${UPSTREAM}`);
    }
    console.log('Serving static assets from', frontendPublicDir);
    console.log('SQLite ready.');
  });
}

// Export helper for tests or scripts
module.exports = module.exports || {};
module.exports.buildLocalChatReply = buildLocalChatReply;
