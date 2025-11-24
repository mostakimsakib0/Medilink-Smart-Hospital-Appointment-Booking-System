(function(){
  const statsEl = document.getElementById('stats');
  const usersList = document.getElementById('users-list');
  const doctorsList = document.getElementById('doctors-list');
  const bookingsList = document.getElementById('bookings-list');
  const adminUserEl = document.getElementById('admin-user');
  const tabBtns = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  const btnRefresh = document.getElementById('btn-refresh');
  const btnExportUsers = document.getElementById('btn-export-users');
  const userFilterInput = document.getElementById('user-filter');
  const doctorFilterInput = document.getElementById('doctor-filter');

  function token(){ return localStorage.getItem('ml_token'); }
  function currentUser(){ try{ return JSON.parse(localStorage.getItem('ml_user')); }catch{ return null; } }

  if(!token() || !currentUser()){
    adminUserEl.textContent = 'Not signed in — please sign in from the main app and ensure the user has admin rights';
  } else {
    adminUserEl.textContent = `Signed in as ${currentUser().name} (${currentUser().email})`;
  }

  async function api(path, opts={}){
    const headers = opts.headers || {};
    if(token()) headers['Authorization'] = `Bearer ${token()}`;
    try{
      const r = await fetch(path, { ...opts, headers });
      const data = await r.json().catch(()=> ({}));
      if(!r.ok) throw new Error(data.error || `Request failed: ${r.status}`);
      return data;
    }catch(err){
      console.error('API error', err);
      throw err;
    }
  }

  async function loadStats(){
    try{
      const data = await api('/api/admin/stats');
  statsEl.innerHTML = `<ul style="padding-left:18px;margin:8px 0 0;"><li><strong>${data.users}</strong> users</li><li><strong>${data.doctors}</strong> doctors</li><li><strong>${data.bookings}</strong> bookings</li></ul>`;
    }catch(err){ statsEl.textContent = 'Failed to load stats'; }
  }

  async function loadUsers(){
    try{
      const data = await api('/api/admin/users');
      usersList.innerHTML = '';
      const filter = (userFilterInput?.value||'').toLowerCase().trim();
      const toShow = data.users.filter(u => {
        if(!filter) return true;
        return (u.name||'').toLowerCase().includes(filter) || (u.email||'').toLowerCase().includes(filter);
      });
      toShow.forEach(u => {
        const row = document.getElementById('user-row-tpl').content.cloneNode(true);
        row.querySelector('.user-meta').textContent = `${u.name} — ${u.email} — Admin: ${u.is_admin ? 'yes' : 'no'}`;
        const actions = row.querySelector('.user-actions');
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = u.is_admin ? 'Revoke admin' : 'Make admin';
        btn.addEventListener('click', async ()=>{
          try{
            await api(`/api/admin/users/${u.id}/toggle-admin`, { method: 'POST' });
            await loadUsers();
            await loadStats();
          }catch(err){ alert(err.message || 'Failed'); }
        });
        actions.appendChild(btn);
        usersList.appendChild(row);
      });
    }catch(err){ usersList.textContent = 'Failed to load users'; }
  }

  async function loadDoctors(){
    try{
      const data = await api('/api/admin/doctors');
      doctorsList.innerHTML = '';
      // normalize response: allow either array or object { doctors: [...] }
      const list = Array.isArray(data) ? data : (data.doctors || data.data || []);
      const filter = (doctorFilterInput?.value||'').toLowerCase().trim();
      const toShow = list.filter(d => {
        if(!filter) return true;
        return (String(d.name||'')).toLowerCase().includes(filter) || (String(d.specialty||'')).toLowerCase().includes(filter) || (String(d.hospital||'')).toLowerCase().includes(filter);
      });
      toShow.forEach(d => {
        const row = document.getElementById('doctor-row-tpl').content.cloneNode(true);
        row.querySelector('.doctor-meta').textContent = `${d.name || '-'} — ${d.specialty || '-'} — ${d.hospital || '-'}`;
        const actions = row.querySelector('.doctor-actions');
        const del = document.createElement('button');
        del.className = 'btn btn-ghost';
        del.textContent = 'Delete';
        del.addEventListener('click', async ()=>{
          if(!confirm('Delete doctor?')) return;
          try{ await api(`/api/admin/doctors/${d.id}`, { method: 'DELETE' }); await loadDoctors(); await loadStats(); }catch(err){ alert(err.message||'Failed'); }
        });
        actions.appendChild(del);
        doctorsList.appendChild(row);
      });
    }catch(err){ doctorsList.textContent = 'Failed to load doctors'; }
  }

  async function loadBookings(){
    try{
      const data = await api('/api/admin/bookings');
      bookingsList.innerHTML = '';
      const list = Array.isArray(data) ? data : (data.bookings || data.data || []);
      list.forEach(b => {
        const el = document.createElement('div');
        el.className = 'admin-row';
        el.textContent = `#${b.id || '-'} User:${b.user_id || b.user || '-'} Doctor:${b.doctor_id || b.doctor || '-'} ${b.date || b.scheduled_at || '-'} ${b.time || ''} — ${b.reason||''}`;
        bookingsList.appendChild(el);
      });
    }catch(err){ bookingsList.textContent = 'Failed to load bookings'; }
  }

  // Wire add doctor button to a simple prompt flow
  document.getElementById('btn-new-doctor')?.addEventListener('click', async ()=>{
    try{
      const id = prompt('Doctor id (short unique)');
      if(!id) return;
      const name = prompt('Name'); if(!name) return;
      const specialty = prompt('Specialty'); if(!specialty) return;
      const hospital = prompt('Hospital') || '';
      const payload = { id, name, specialty, hospital };
      await api('/api/admin/doctors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      await loadDoctors(); await loadStats();
    }catch(err){ alert(err.message||'Failed to add'); }
  });

  // Tabs handling
  tabBtns.forEach(btn => btn.addEventListener('click', ()=>{
    tabBtns.forEach(b => b.classList.remove('active'));
    panels.forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    const tab = btn.getAttribute('data-tab');
    document.getElementById(`tab-${tab}`)?.classList.remove('hidden');
  }));

  // Filters and actions
  userFilterInput?.addEventListener('input', () => loadUsers());
  doctorFilterInput?.addEventListener('input', () => loadDoctors());
  btnRefresh?.addEventListener('click', () => { loadStats(); loadUsers(); loadDoctors(); loadBookings(); });
  btnExportUsers?.addEventListener('click', async ()=>{
    try{
      const data = await api('/api/admin/users');
      const csv = [ ['id','name','email','is_admin','created_at'].join(',') ].concat(data.users.map(u => [u.id,`"${u.name.replace(/"/g,'""') }"`,u.email,u.is_admin?1:0,`"${u.created_at}"`].join(','))).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }catch(err){ alert(err.message || 'Failed to export'); }
  });

  // Initial load
  loadStats(); loadUsers(); loadDoctors(); loadBookings();
})();
