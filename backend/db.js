const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');

function promisifyDb(db){
  return {
    run(sql, params = []){
      return new Promise((resolve, reject)=>{
        db.run(sql, params, function(err){
          if(err) reject(err); else resolve(this);
        });
      });
    },
    get(sql, params = []){
      return new Promise((resolve, reject)=>{
        db.get(sql, params, function(err,row){
          if(err) reject(err); else resolve(row);
        });
      });
    },
    all(sql, params = []){
      return new Promise((resolve, reject)=>{
        db.all(sql, params, function(err,rows){
          if(err) reject(err); else resolve(rows);
        });
      });
    },
    exec(sql){
      return new Promise((resolve, reject)=>{
        db.exec(sql, function(err){
          if(err) reject(err); else resolve();
        });
      });
    },
    raw: db
  };
}

async function initDb(){
  const dataDir = path.join(__dirname, 'data');
  if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'app.db');
  const db = new sqlite3.Database(dbFile);
  const pdb = promisifyDb(db);
  console.log(`SQLite DB: ${dbFile}`);

  await pdb.exec(`PRAGMA journal_mode=WAL;`);

  await pdb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      hospital TEXT NOT NULL,
      languages TEXT NOT NULL,
      experience_years INTEGER NOT NULL,
      rating REAL NOT NULL,
      next_available TEXT,
      education TEXT NOT NULL,
      bio TEXT,
      location TEXT,
      conditions TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      doctor_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(doctor_id) REFERENCES doctors(id)
    );
  `);

  const countRow = await pdb.get('SELECT COUNT(*) as c FROM doctors');
  if(!countRow || countRow.c === 0){
    const externalPath = path.join(__dirname, 'data', 'drlistify.json');
    let doctors = [];
    if(fs.existsSync(externalPath)){
      try{
        const raw = fs.readFileSync(externalPath, 'utf-8');
        const arr = JSON.parse(raw);
        doctors = normalizeDrListify(arr);
        console.log(`Seeding doctors from data/drlistify.json (${doctors.length})`);
      }catch(err){
        console.warn('Failed to read data/drlistify.json, falling back to bundled list.', err);
      }
    }
    if(!doctors.length){
      const bundledPath = path.join(__dirname, '..', 'frontend', 'public', 'data', 'doctors.json');
      const raw = fs.readFileSync(bundledPath, 'utf-8');
      doctors = JSON.parse(raw);
      console.log(`Seeding doctors from frontend/public/data/doctors.json (${doctors.length})`);
    }
    await seedDoctors(pdb, doctors);
  }

  return pdb;
}

async function seedDoctors(pdb, doctors){
  if(!Array.isArray(doctors) || !doctors.length){
    console.warn('Doctor seed skipped: no doctors available');
    return;
  }
  const sql = `INSERT INTO doctors (id,name,specialty,hospital,languages,experience_years,rating,next_available,education,bio,location,conditions)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
  for(const d of doctors){
    await pdb.run(sql, [
      d.id,
      d.name,
      d.specialty,
      d.hospital,
      JSON.stringify(d.languages || []),
      d.experienceYears || 0,
      typeof d.rating === 'number' ? d.rating : Number(d.rating) || 0,
      d.nextAvailable || '',
      JSON.stringify(d.education || []),
      d.bio || '',
      d.location || '',
      JSON.stringify(d.conditions || [])
    ]);
  }
  console.log(`Seeded ${doctors.length} doctors into SQLite`);
}

function normalizeDrListify(arr){
  return (arr||[]).map((r, idx) => {
    const id = r.id || r.slug || `dr_${Date.now()}_${idx}`;
    const toArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',').map(s=>s.trim()).filter(Boolean) : []);
    const num = (v, def=0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };
    return {
      id: String(id),
      name: r.name || 'Unknown Doctor',
      specialty: r.specialty || r.specialisation || r.department || 'General Physician',
      hospital: r.hospital || r.hospitalName || r.organization || 'Partner Hospital',
      languages: toArray(r.languages || r.language || ''),
      experienceYears: num(r.experienceYears || r.experience || 0),
      rating: num(r.rating || 0),
      nextAvailable: r.nextAvailable || r.availability || '',
      education: toArray(r.education || r.qualifications || ''),
      bio: r.bio || r.about || '',
      location: r.location || r.city || r.address || '',
      conditions: toArray(r.conditions || r.expertise || r.keywords || '')
    };
  });
}

module.exports = { initDb };
