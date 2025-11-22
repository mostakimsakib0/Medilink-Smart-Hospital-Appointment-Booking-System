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

const BANGLA_RANGE = /[\u0980-\u09FF]/;
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

app.use(express.static(frontendPublicDir));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/medivirtuoso', async (req, res) => {
  try{
    const { message } = req.body || {};
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

let pdbPromise = null;
function getDb(){
  if(!pdbPromise) pdbPromise = initDb();
  return pdbPromise;
}

function mapDoctorRow(row){
  if(!row) return null;
  const safeParse = (val) => {
    if(!val) return [];
    try{
      return JSON.parse(val);
    }catch{
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

async function buildLocalChatReply(message){
  const text = String(message||'').toLowerCase();
  const tokens = text.split(/[^a-z0-9\u0980-\u09FF]+/).filter(Boolean);
  const normalizedText = text.replace(/\s+/g, '');
  const prefersBangla = BANGLA_RANGE.test(text);
  const translatedTokens = tokens.reduce((acc, token)=>{
    if(BANGLA_RANGE.test(token)){
      Object.entries(BN_SYMPTOM_MAP).forEach(([bn, mapped])=>{
        if(token.includes(bn)) acc.push(...mapped);
      });
    }
    acc.push(token);
    return acc;
  }, []);
  const specialtyIntentHits = [];
  Object.entries(SPECIALTY_KEYWORDS).forEach(([phrase, targets]) => {
    const normalizedPhrase = phrase.replace(/\s+/g, '');
    if(text.includes(phrase) || normalizedText.includes(normalizedPhrase)){
      specialtyIntentHits.push({ phrase, targets });
      phrase.split(/\s+/).forEach(part => {
        if(part) translatedTokens.push(part);
      });
    }
  });
  const db = await getDb();
  const rows = await db.all('SELECT * FROM doctors');
  let ranked = rows
    .map(mapDoctorRow)
    .map(doc => {
      const loweredSpecialty = doc.specialty.toLowerCase();
      const loweredLocation = (doc.location||'').toLowerCase();
      const loweredHospital = (doc.hospital||'').toLowerCase();

      const condHits = doc.conditions.reduce((acc, cond)=>{
        const c = String(cond||'').toLowerCase();
        if(!c) return acc;
        const hit = translatedTokens.some(t => c.includes(t) || t.includes(c));
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

      return { doc, score: condHits + specialtyHit + locationHit + cityBoost + banglaLanguageBoost + ratingBoost + specialtyIntentBoost };
    })
    .filter(item => item.score > 0)
    .sort((a,b) => b.score - a.score || b.doc.rating - a.doc.rating);

  // If the heuristic detected a clear specialty intent, prefer only doctors
  // that match the detected specialist types (exact or close match). This
  // narrows suggestions to the intended specialist rather than mixing
  // multiple specialties in the response. If filtering yields no results,
  // we fall back to the original ranked list.
  if(specialtyIntentHits.length){
    const desiredTargets = new Set(specialtyIntentHits.flatMap(h => h.targets).map(t => String(t||'').toLowerCase()));
    const filtered = ranked.filter(item => {
      const spec = String(item.doc.specialty||'').toLowerCase();
      // Accept exact equality, or a containment match in either direction to
      // tolerate small naming differences (e.g. 'cardiologist' vs 'cardiology').
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
    return {
      reply: 'Share a brief description of your symptoms or booking need (for example, chest tightness, recurring migraine, prenatal follow-up) and I’ll shortlist the most relevant doctors for you. For emergencies, contact local services immediately.'
    };
  }

  const lead = suggestions[0];
  const summaryLine = `Your description points to ${lead.specialty.toLowerCase()} care. ${lead.name} at ${lead.hospital} is available ${lead.nextAvailable || 'soon'} and is a strong fit.`;
  const lineup = suggestions.map((s)=> `• ${s.name} — ${s.specialty} (${s.hospital}), next slot ${s.nextAvailable || 'soon'}, rating ${s.rating.toFixed(1)}/5`).join('\n');
  const closing = 'Let me know which doctor works best or add more context if you’d like a different specialty. For urgent or emergency issues, call your local hotline immediately.';
  const reply = `${summaryLine}\nHere are a few tailored options:\n${lineup}\n${closing}`;
  return { reply, suggestions };
}

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
