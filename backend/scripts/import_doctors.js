const { initDb } = require('../db');

async function seed(){
  const db = await initDb();
  const doctors = [
    {
      id: 'doc-001',
      name: 'Dr. Ayesha Rahman',
      specialty: 'Cardiologist',
      hospital: 'Dhaka General Hospital',
      languages: ['Bangla','English'],
      experienceYears: 12,
      rating: 4.8,
      nextAvailable: 'Tomorrow 10:30',
      education: ['MBBS','MD Cardiology'],
      bio: 'Experienced cardiologist focusing on adult cardiac care.',
      location: 'Dhaka',
      conditions: ['chest pain','palpitation','shortness of breath']
    },
    {
      id: 'doc-002',
      name: 'Dr. Imran Hossain',
      specialty: 'Orthopedic',
      hospital: 'Chittagong Medical Centre',
      languages: ['Bangla','English'],
      experienceYears: 8,
      rating: 4.5,
      nextAvailable: 'Friday 14:00',
      education: ['MBBS','MS Orthopedics'],
      bio: 'Orthopedic surgeon with interest in sports injuries.',
      location: 'Chittagong',
      conditions: ['back pain','knee pain','joint pain']
    }
  ];

  for(const d of doctors){
    const sql = `INSERT OR REPLACE INTO doctors (id,name,specialty,hospital,languages,experience_years,rating,next_available,education,bio,location,conditions)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
    await db.run(sql, [
      d.id, d.name, d.specialty, d.hospital, JSON.stringify(d.languages||[]), d.experienceYears||0, d.rating||0, d.nextAvailable||'', JSON.stringify(d.education||[]), d.bio||'', d.location||'', JSON.stringify(d.conditions||[])
    ]);
    console.log('Seeded', d.id);
  }

  // close if available
  if(typeof db.close === 'function') await db.close();
  console.log('Seeding complete.');
}

seed().catch(err => {
  console.error('Seeding failed', err);
  process.exit(1);
});
