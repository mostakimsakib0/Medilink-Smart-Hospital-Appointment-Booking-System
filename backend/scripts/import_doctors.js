#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { initDb } = require('../db');

(async () => {
  try{
    const db = await initDb();
    const input = process.argv[2] || path.join(__dirname, '..', 'data', 'drlistify.json');
    if(!fs.existsSync(input)){
      console.error(`Input not found: ${input}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(input, 'utf-8');
    const arr = JSON.parse(raw);

    // Use the same normalizer as db.js by requiring it indirectly is hard; duplicate minimal logic
    const toArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',').map(s=>s.trim()).filter(Boolean) : []);
    const num = (v, def=0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
    const normalized = (arr||[]).map((r, idx) => ({
      id: String(r.id || r.slug || `dr_${Date.now()}_${idx}`),
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
    }));

    // Clear existing doctors? Only if flag provided
    const replace = process.env.REPLACE === '1' || process.argv.includes('--replace');
    if(replace){
      await db.run('DELETE FROM doctors');
      console.log('Cleared existing doctors');
    }

    const stmt = db.raw.prepare(`INSERT OR REPLACE INTO doctors (id,name,specialty,hospital,languages,experience_years,rating,next_available,education,bio,location,conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    db.raw.serialize(()=>{
      for(const d of normalized){
        stmt.run([
          d.id,
          d.name,
          d.specialty,
          d.hospital,
          JSON.stringify(d.languages||[]),
          d.experienceYears||0,
          d.rating||0,
          d.nextAvailable||'',
          JSON.stringify(d.education||[]),
          d.bio||'',
          d.location||'',
          JSON.stringify(d.conditions||[])
        ]);
      }
      stmt.finalize(async (err)=>{
        if(err) { console.error(err); process.exit(1); }
        const count = await db.get('SELECT COUNT(*) as c FROM doctors');
        console.log(`Imported doctors. Total now: ${count.c}`);
        process.exit(0);
      });
    });
  }catch(err){
    console.error('Import failed:', err);
    process.exit(1);
  }
})();
