(function(){
  // Always use proxy adapter for MediVirtuoso
  const CONFIG = {
    proxyUrl: '/api/medivirtuoso' // expected POST { message } -> { reply }
  };

  // Lightweight topic guard to keep conversations medical/booking-only
  const MEDICAL_KEYWORDS = [
    'pain','ache','fever','cough','cold','flu','injury','fracture','rash','eczema','itch','allergy','diarrhea','diarrhoea','vomit','vomiting','nausea','stomach','abdominal','gastric','chest','palpitations','breath','shortness of breath','asthma','lung','diabetes','sugar','thyroid','bp','blood pressure','pregnancy','period','menstrual','pcos','urinary','kidney','liver','anxiety','depression','sleep','insomnia','eye','ear','nose','throat','sore throat','tooth','dental','skin','derma','orthopedic','cardio','neuro','gastro','endocrine','psychiatry','migraine','headache','doctor','medicine','prescription','appointment','hospital','clinic','book'
  ];

  // Bangla keywords (secondary guard). Backend still has richer Bangla handling.
  MEDICAL_KEYWORDS.push(
    'জ্বর','সর্দি','কাশি','গলা','ব্যথা','মাথা','বমি','ঝিমঝিম','হৃদপিণ্ড','বুকব্যথা','ডায়াবেটিস','চুলকানি','চর্ম','গর্ভ','মাসিক','মানসিক','চোখ','কান','পেট','হাঁপানি',
    'ডাক্তার','চিকিৎসা','অ্যাপয়েন্টমেন্ট','বুকিং','ঔষধ','প্রেসক্রিপশন','হাসপাতাল','ক্লিনিক','রোগ','শ্বাস','শ্বাসকষ্ট'
  );

  // Allow Bangla input to bypass the English-only keyword guard and be
  // forwarded to the backend, which contains Bangla handling heuristics.
  const BANGLA_RANGE = /[\u0980-\u09FF]/;

  // No demo specialty inference; backend handles responses

  // DOM elements
  const chatWindow = document.getElementById('chat-window');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatSection = document.getElementById('chat');
  const btnLogin = document.getElementById('btn-login');
  const btnAdmin = document.getElementById('btn-admin');
  const heroBookBtn = document.getElementById('hero-book');
  const heroChatBtn = document.getElementById('hero-chat');
  const userBadge = document.getElementById('user-badge');
  const doctorListEl = document.getElementById('doctor-list');
  const doctorsSection = document.getElementById('doctors');
  const searchDoctorEl = document.getElementById('search-doctor');
  const filterSpecialtyEl = document.getElementById('filter-specialty');
  const suggestionsSection = document.getElementById('suggestions');
  const suggestedDoctorsEl = document.getElementById('suggested-doctors');
  const profileSection = document.getElementById('profile');
  const profileName = document.getElementById('profile-name');
  const profileBody = document.getElementById('profile-body');
  const profileBook = document.getElementById('profile-book');
  const profileBack = document.getElementById('profile-back');
  const bookingModal = document.getElementById('booking-modal');
  const bookingDoctor = document.getElementById('booking-doctor');
  const bookingSubmit = document.getElementById('booking-submit');
  const bookingDate = document.getElementById('booking-date');
  const bookingTime = document.getElementById('booking-time');
  const bookingsSection = document.getElementById('bookings');
  const bookingListEl = document.getElementById('booking-list');
  const bookingEmptyEl = document.getElementById('booking-empty');
  const bookingReason = document.getElementById('booking-reason');
  const bookingCancelAppointmentBtn = document.getElementById('booking-cancel-appointment');

  let DOCTORS = [];
  let BOOKINGS = [];
  let selectedDoctor = null;
  let selectedProfile = null;
  let editingBookingId = null;
  let CHAT_MESSAGES = []; // {role:'user'|'bot', text: '...'} persisted to localStorage

  const WEEKDAY_MAP = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };

  function safeNumber(v, fallback = 0){
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // Fallback doctor shown when no specialist matches a condition
  function getGeneralPhysician(){
    return {
      id: 'gp-1',
      name: 'General Physician',
      specialty: 'General Physician',
      hospital: 'Any Hospital',
      location: 'Nearby',
      languages: ['Bangla','English'],
      rating: 4.1,
      experienceYears: 5,
      nextAvailable: 'Soon',
      education: ['MBBS'],
      bio: 'Primary care physician for common ailments and initial assessment.',
      conditions: []
    };
  }

  // --- Utilities ---
  function scrollChatToBottom(){
    if(!chatWindow) return;
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function addMessage(role, text){
    if(!chatWindow) return;
    const wrap = document.createElement('div');
    wrap.className = `message ${role==='user'?'msg-user':'msg-bot'}`;
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    chatWindow.appendChild(wrap);
    scrollChatToBottom();
    try{
      CHAT_MESSAGES.push({ role, text });
      localStorage.setItem('ml_chat', JSON.stringify(CHAT_MESSAGES));
    }catch(e){ /* ignore storage errors */ }
  }

  function renderStoredChat(messages){
    if(!Array.isArray(messages) || !chatWindow) return;
    chatWindow.innerHTML = '';
    messages.forEach(m => {
      const wrap = document.createElement('div');
      wrap.className = `message ${m.role==='user'?'msg-user':'msg-bot'}`;
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.textContent = m.text;
      wrap.appendChild(bubble);
      chatWindow.appendChild(wrap);
    });
    scrollChatToBottom();
  }

  function outOfScope(userText){
  const t = userText.toLowerCase();
  // If the user typed Bangla characters, defer scope checking to the
  // backend (it has a richer Bangla symptom map). This prevents the
  // frontend from showing the English-only fallback for Bangla input.
  if(BANGLA_RANGE.test(t)) return false;
  return !MEDICAL_KEYWORDS.some(k => t.includes(k));
  }

  function isMedicalText(text){
    if(!text) return false;
    try{ return !outOfScope(String(text)); }catch(e){ return false; }
  }

  // No triage heuristics in frontend; defer to backend if desired

  function filterDoctors(query, specialty){
    const q = (query||'').toLowerCase();
    return DOCTORS.filter(d => {
      const matchesQ = !q || [d.name,d.specialty,d.hospital,d.location].join(' ').toLowerCase().includes(q);
      const matchesS = !specialty || d.specialty === specialty;
      return matchesQ && matchesS;
    });
  }

  function renderDoctors(list, target){
    if(!target) return;
    // If there are no matching doctors for a search/condition:
    // - show a General Physician fallback only when the user's query
    //   appears medical (e.g., contains symptom/condition keywords);
    // - otherwise show a no-results message so arbitrary text doesn't
    //   map to a GP suggestion.
    if(!Array.isArray(list) || list.length === 0){
      const q = (searchDoctorEl?.value || '').trim();
      if(isMedicalText(q)){
        list = [ getGeneralPhysician() ];
      } else {
        target.innerHTML = '<div class="empty">No doctors found.</div>';
        return;
      }
    }
    target.innerHTML = '';
    list.forEach(d => {
      const card = document.createElement('div');
      card.className = 'doctor-card';
      const avatar = document.createElement('div');
      avatar.className = 'doc-avatar';
      avatar.textContent = initials(d.name);
      const main = document.createElement('div');
      main.className = 'doc-main';
      const name = document.createElement('h4');
      name.className = 'doc-name';
      name.textContent = d.name;
      const meta = document.createElement('div');
      meta.className = 'doc-meta';
      meta.textContent = `${d.specialty} • ${d.hospital}`;
      const tags = document.createElement('div');
      tags.innerHTML = `
        <span class="tag">⭐ ${safeNumber(d.rating).toFixed(1)}</span>
        <span class="tag">${safeNumber(d.experienceYears)} yrs</span>
        <span class="tag">Next: ${d.nextAvailable || 'Soon'}</span>
      `;
      const actions = document.createElement('div');
      actions.className = 'actions';
      const btnProfile = document.createElement('button');
      btnProfile.className = 'btn';
      btnProfile.textContent = 'View Profile';
      btnProfile.addEventListener('click', () => showProfile(d));
      const btnBook = document.createElement('button');
      btnBook.className = 'btn btn-primary';
      btnBook.textContent = 'Book Now';
      btnBook.addEventListener('click', () => ensureAuthThenBook(d));
      actions.append(btnProfile, btnBook);

      main.append(name, meta, tags, actions);
      card.append(avatar, main);
      target.appendChild(card);
    });
  }

  function renderSuggestedDoctors(list){
    if(!suggestionsSection || !suggestedDoctorsEl) return;
    // If suggestions are empty, only surface a General Physician when
    // the user's last assistant message or draft looks medical.
    if(!Array.isArray(list) || list.length === 0){
      const lastAttempt = localStorage.getItem('ml_chat_draft') || chatInput?.value || (CHAT_MESSAGES.length ? CHAT_MESSAGES[CHAT_MESSAGES.length-1]?.text : '');
      if(isMedicalText(lastAttempt)){
        list = [ getGeneralPhysician() ];
      } else {
        suggestionsSection.classList.add('hidden');
        return;
      }
    }
    suggestionsSection.classList.toggle('hidden', !list.length);
    suggestedDoctorsEl.innerHTML = '';
    list.forEach(doc => {
      const card = document.createElement('div');
      card.className = 'doctor-card compact';
      card.innerHTML = `
        <div class="doc-main">
          <h4 class="doc-name">${doc.name}</h4>
          <div class="doc-meta">${doc.specialty} • ${doc.hospital}</div>
          <div class="doc-tags">
            <span class="tag">⭐ ${safeNumber(doc.rating).toFixed(1)}</span>
            <span class="tag">Next: ${doc.nextAvailable || 'Ask'}</span>
          </div>
        </div>`;
      card.addEventListener('click', ()=> showProfile(doc));
      const bookBtn = document.createElement('button');
      bookBtn.textContent = 'Book';
      bookBtn.className = 'btn btn-primary';
      bookBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        ensureAuthThenBook(doc);
      });
      card.appendChild(bookBtn);
      suggestedDoctorsEl.appendChild(card);
    });
  }

  function initials(name){
    const parts = name.split(' ');
    return (parts[0]?.[0]||'') + (parts[1]?.[0]||'');
  }

  function populateSpecialtyFilter(){
    if(!filterSpecialtyEl) return;
    const set = new Set(DOCTORS.map(d=>d.specialty));
    [...set].sort().forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      filterSpecialtyEl.appendChild(opt);
    });
  }

  function showProfile(doc){
    if(!doc) return;
    selectedProfile = doc;
    if(!profileSection || !profileName || !profileBody){
      const hash = doc.id ? `#doctor-${doc.id}` : '';
      window.location.href = `doctors.html${hash}`;
      return;
    }
    profileName.textContent = doc.name;
    profileBody.innerHTML = `
      <div class="profile-section"><strong>Specialty:</strong> ${doc.specialty}</div>
      <div class="profile-section"><strong>Hospital:</strong> ${doc.hospital}</div>
      <div class="profile-section"><strong>Location:</strong> ${doc.location}</div>
      <div class="profile-section"><strong>Languages:</strong> ${doc.languages.join(', ')}</div>
      <div class="profile-section"><strong>Experience:</strong> ${doc.experienceYears} years</div>
      <div class="profile-section"><strong>Rating:</strong> ${doc.rating.toFixed(1)} / 5</div>
      <div class="profile-section"><strong>Education:</strong><br> ${doc.education.map(e=>`• ${e}`).join('<br>')}</div>
      <div class="profile-section"><strong>Bio:</strong> ${doc.bio}</div>
      <div class="profile-section"><strong>Common Conditions:</strong> ${doc.conditions.join(', ')}</div>
    `;
    doctorsSection?.classList.add('hidden');
    profileSection.classList.remove('hidden');
  }

  if(profileBack && profileSection && doctorsSection){
    profileBack.addEventListener('click', ()=>{
      profileSection.classList.add('hidden');
      doctorsSection.classList.remove('hidden');
    });
  }

  if(profileBook){
    profileBook.addEventListener('click', ()=>{
      if(selectedProfile) ensureAuthThenBook(selectedProfile);
    });
  }

  function ensureAuthThenBook(doc){
    selectedDoctor = doc;
    if(!currentUser()){
  // Persist pending booking intent in localStorage as a robust fallback
  // (some browsers or flows may strip query/hash). Store both id and
  // the full doctor object so we can restore immediately without
  // waiting for the doctors list to load.
  try{ localStorage.setItem('ml_pending_book', String(doc.id)); }catch(e){ /* ignore */ }
  try{ localStorage.setItem('ml_pending_book_doc', JSON.stringify(doc)); }catch(e){ /* ignore */ }
  // redirect to login and include a next query when possible
  const next = `/doctors.html?book=${encodeURIComponent(doc.id)}`;
  redirectToLogin(next);
      return;
    }
    openBookingModal(doc);
  }

  function openBookingModal(doc){
    if(!bookingModal || !bookingDoctor) return;
    bookingDoctor.textContent = `${doc.name} — ${doc.specialty} (${doc.hospital})`;
    prefillBookingSlot(doc);
    if(typeof bookingModal.showModal === 'function'){
      bookingModal.showModal();
    } else {
      // dialog unsupported: toggle fallback open class
      bookingModal.classList.add('open');
    }
  }

  function openBookingModalForEdit(booking){
    // booking: full booking row from server
    const doc = DOCTORS.find(d => d.id === (booking.doctor_id || booking.doctorId));
    selectedDoctor = doc || null;
    editingBookingId = booking.id;
  if(bookingDoctor) bookingDoctor.textContent = `${doc ? doc.name : 'Doctor'} — ${doc ? doc.specialty : ''}`;
    if(bookingDate) bookingDate.value = booking.date || '';
    if(bookingTime) bookingTime.value = booking.time || '';
    if(bookingReason) bookingReason.value = booking.reason || '';
  if(bookingCancelAppointmentBtn) bookingCancelAppointmentBtn.classList.remove('hidden');
    if(typeof bookingModal.showModal === 'function') bookingModal.showModal();
  else bookingModal.classList.add('open');
  }

  function prefillBookingSlot(doc){
    if(!bookingDate || !bookingTime) return;
    const slot = parseNextAvailable(doc.nextAvailable);
    if(slot){
      bookingDate.value = slot.date;
      bookingTime.value = slot.time;
    }
  }

  function parseNextAvailable(text){
    if(!text) return null;
    const lower = text.toLowerCase();
    const now = new Date();
    let targetDate = new Date(now);
    if(lower.includes('tomorrow')){
      targetDate.setDate(targetDate.getDate()+1);
    } else if(lower.includes('today')){
      // keep same day
    } else {
      const weekday = Object.keys(WEEKDAY_MAP).find(key => lower.startsWith(key) || lower.includes(key));
      if(weekday){
        const desired = WEEKDAY_MAP[weekday];
        const diff = (desired + 7 - targetDate.getDay()) % 7 || 7;
        targetDate.setDate(targetDate.getDate()+diff);
      }
    }
    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    if(!timeMatch) return null;
    const [ , hh, mm ] = timeMatch;
    const isoDate = targetDate.toISOString().split('T')[0];
    const time = `${hh.padStart(2,'0')}:${mm}`;
    return { date: isoDate, time };
  }

  function describeBookingSlot(dateStr, timeStr){
    if(!dateStr) return timeStr || 'Scheduled soon';
    const iso = `${dateStr}T${timeStr || '00:00'}`;
    const d = new Date(iso);
    if(Number.isNaN(d.getTime())){
      return `${dateStr}${timeStr ? ` • ${timeStr}` : ''}`;
    }
    const datePart = d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
    return timeStr ? `${datePart} • ${timeStr}` : datePart;
  }

  async function loadBookings(){
    if(!bookingsSection) return;
    const token = localStorage.getItem('ml_token');
    if(!token){
      BOOKINGS = [];
      renderBookings();
      return;
    }
    try{
      const resp = await fetch('/api/bookings', { headers: { 'Authorization': `Bearer ${token}` } });
      if(resp.status === 401){
        clearAuth();
        BOOKINGS = [];
        return;
      }
      const data = await resp.json();
      if(!resp.ok) throw new Error(data.error || 'Failed to fetch bookings');
      BOOKINGS = (data.bookings || []).map(b => ({
        ...b,
        doctorId: b.doctor_id || b.doctorId,
        createdAt: b.created_at || b.createdAt
      }));
      renderBookings();
    }catch(err){
      console.error('Failed to load bookings', err);
    }
  }

  function renderBookings(){
    if(!bookingsSection || !bookingListEl || !bookingEmptyEl) return;
    bookingsSection.classList.remove('hidden');
    const loggedIn = Boolean(currentUser());
    if(!loggedIn){
      bookingEmptyEl.textContent = 'Sign in to see your appointments.';
      bookingEmptyEl.classList.remove('hidden');
      bookingListEl.innerHTML = '';
      return;
    }
    if(!BOOKINGS.length){
      bookingEmptyEl.textContent = 'No appointments yet. Book your first visit from the doctor list.';
      bookingEmptyEl.classList.remove('hidden');
      bookingListEl.innerHTML = '';
      return;
    }

    bookingEmptyEl.classList.add('hidden');
    bookingListEl.innerHTML = '';
    BOOKINGS.forEach(b => {
      const doctorId = b.doctorId || b.doctor_id;
      const doc = DOCTORS.find(d => d.id === doctorId);
      const doctorName = doc?.name || 'Assigned Doctor';
      const specialty = doc?.specialty || 'General Specialist';
      const hospital = doc?.hospital || '';
      const slot = describeBookingSlot(b.date, b.time);

      const card = document.createElement('div');
      card.className = 'booking-card';
      const title = document.createElement('strong');
      title.textContent = doctorName;
      card.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'booking-meta';
      const slotEl = document.createElement('span');
      slotEl.className = 'booking-pill';
      slotEl.textContent = slot;
      meta.appendChild(slotEl);
      const specEl = document.createElement('span');
      specEl.textContent = specialty;
      meta.appendChild(specEl);
      if(hospital){
        const hospEl = document.createElement('span');
        hospEl.textContent = hospital;
        meta.appendChild(hospEl);
      }
      card.appendChild(meta);

      if(b.reason){
        const reasonEl = document.createElement('div');
        reasonEl.className = 'booking-reason';
        reasonEl.textContent = `Reason: ${b.reason}`;
        card.appendChild(reasonEl);
      }

      const actions = document.createElement('div');
      actions.className = 'booking-actions';
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn';
      viewBtn.textContent = 'View profile';
      viewBtn.addEventListener('click', ()=>{
        if(doc) showProfile(doc);
        else alert('Doctor profile unavailable.');
      });
      const rebookBtn = document.createElement('button');
      rebookBtn.type = 'button';
      rebookBtn.className = 'btn btn-primary';
      rebookBtn.textContent = 'Book again';
      rebookBtn.addEventListener('click', ()=>{
        const targetDoc = doc || DOCTORS.find(d => d.id === doctorId);
        if(targetDoc) ensureAuthThenBook(targetDoc);
      });
      const rescheduleBtn = document.createElement('button');
      rescheduleBtn.type = 'button';
      rescheduleBtn.className = 'btn';
      rescheduleBtn.textContent = 'Reschedule';
      rescheduleBtn.addEventListener('click', ()=>{
        // open modal in edit mode for this booking
        openBookingModalForEdit(b);
      });
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-ghost';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', async ()=>{
        if(!confirm('Cancel this appointment?')) return;
        const token = localStorage.getItem('ml_token');
        try{
          const r = await fetch(`/api/bookings/${b.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
          const data = await r.json();
          if(!r.ok) throw new Error(data.error || 'Cancel failed');
          await loadBookings();
        }catch(err){ alert(err.message || String(err)); }
      });
      actions.append(viewBtn, rebookBtn, rescheduleBtn, cancelBtn);
      card.appendChild(actions);

      bookingListEl.appendChild(card);
    });
  }

  if(bookingSubmit && bookingDate && bookingTime){
    bookingSubmit.addEventListener('click', async (e)=>{
      const date = bookingDate.value;
      const time = bookingTime.value;
      const reason = bookingReason ? bookingReason.value : '';
      if(!date || !time){
        e.preventDefault();
        alert('Please select date and time');
        return;
      }
      const token = localStorage.getItem('ml_token');
      if(!token){ alert('Please login to book.'); return; }
      try{
        if(editingBookingId){
          // Update existing booking
          const r = await fetch(`/api/bookings/${editingBookingId}`, { method: 'PUT', headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ date, time, reason }) });
          const data = await r.json();
          if(!r.ok) throw new Error(data.error || 'Update failed');
          alert(`Appointment updated for ${date} at ${time}.`);
          editingBookingId = null;
          if(bookingCancelAppointmentBtn) bookingCancelAppointmentBtn.classList.add('hidden');
        } else {
          if(!selectedDoctor){ alert('Select a doctor first.'); return; }
          const r = await fetch('/api/bookings', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ doctorId: selectedDoctor.id, date, time, reason }) });
          const data = await r.json();
          if(!r.ok) throw new Error(data.error||'Booking failed');
          alert(`Appointment confirmed with ${selectedDoctor.name} on ${date} at ${time}.`);
        }
        await loadBookings();
        if(typeof bookingModal?.close === 'function') bookingModal.close();
      }catch(err){ alert(err.message||String(err)); }
    });
  }

  // Modal cancel button for deleting the appointment when editing
  if(bookingCancelAppointmentBtn){
    bookingCancelAppointmentBtn.addEventListener('click', async ()=>{
      if(!editingBookingId) return;
      if(!confirm('Are you sure you want to cancel this appointment?')) return;
      const token = localStorage.getItem('ml_token');
      try{
        const r = await fetch(`/api/bookings/${editingBookingId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await r.json();
        if(!r.ok) throw new Error(data.error || 'Cancel failed');
        editingBookingId = null;
        if(bookingCancelAppointmentBtn) bookingCancelAppointmentBtn.classList.add('hidden');
        if(typeof bookingModal?.close === 'function') bookingModal.close();
        await loadBookings();
      }catch(err){ alert(err.message||String(err)); }
    });
  }

  // Reset editing state when modal is closed via dialog close
  if(bookingModal){
    bookingModal.addEventListener('close', ()=>{
      editingBookingId = null;
      if(bookingCancelAppointmentBtn) bookingCancelAppointmentBtn.classList.add('hidden');
      // reset selectedDoctor to avoid accidental POST without doctor
      // keep selectedDoctor if user opened modal from doctor profile
    });
  }

  // --- Auth (demo: localStorage) ---
  function currentUser(){
    const raw = localStorage.getItem('ml_user');
    return raw ? JSON.parse(raw) : null;
  }
  function clearAuth(){
    localStorage.removeItem('ml_user');
    localStorage.removeItem('ml_token');
    BOOKINGS = [];
    updateUserBadge();
    renderBookings();
  }
  function updateUserBadge(){
    if(!userBadge || !btnLogin) return;
    const u = currentUser();
    if(u){
      userBadge.textContent = `${u.name} · ${u.email}`;
      userBadge.classList.remove('hidden');
      btnLogin.textContent = 'Logout';
      // Show admin button only for admin users
      if(btnAdmin){
        if(u.is_admin || u.isAdmin || u.isAdministrator){
          btnAdmin.classList.remove('hidden');
        } else {
          btnAdmin.classList.add('hidden');
        }
      }
    } else {
      userBadge.classList.add('hidden');
      btnLogin.textContent = 'Login / Register';
      if(btnAdmin) btnAdmin.classList.add('hidden');
    }
  }

  if(btnLogin){
    btnLogin.addEventListener('click', ()=>{
      const u = currentUser();
      if(u){
        if(confirm('Logout now?')) clearAuth();
      } else {
        redirectToLogin();
      }
    });
  }

  heroBookBtn?.addEventListener('click', ()=>{
    if(currentUser()){
      doctorsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      redirectToLogin();
    }
  });

  heroChatBtn?.addEventListener('click', ()=>{
    if(chatSection){
      chatSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      chatInput?.focus();
    }
  });

  document.querySelectorAll('[data-prompt]').forEach(btn => {
    btn.addEventListener('click', ()=>{
      const preset = btn.getAttribute('data-prompt');
      if(!preset) return;
      chatInput.value = preset;
      chatSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      chatInput.focus();
    });
  });

  // redirectToLogin optionally accepts a full absolute-path next target
  // (for example: '/doctors.html?book=123'). If not provided it falls back to
  // the current location like before.
  function redirectToLogin(nextTarget){
    const fallback = '/index.html';
    let target = fallback;
    if(nextTarget && String(nextTarget).startsWith('/')) target = nextTarget;
    else {
      const rawPath = window.location.pathname + window.location.search + window.location.hash;
      target = rawPath.startsWith('/') ? rawPath : fallback;
    }
    const encoded = encodeURIComponent(target === '/' ? fallback : target);
    window.location.href = `login.html?next=${encoded}`;
  }

  // --- Chat ---
  if(chatForm && chatWindow && chatInput){
    chatForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const text = chatInput.value.trim();
      if(!text) return;
      addMessage('user', text);
      chatInput.value = '';

      if(outOfScope(text)){
        addMessage('bot', 'Please ask about medical conditions, symptoms, medicines, or hospital appointment booking.');
        return;
      }

      addMessage('bot', 'Thinking...');
      const placeholder = chatWindow.lastElementChild?.querySelector('.msg-bubble');

      try{
        const token = localStorage.getItem('ml_token');
        const headers = { 'Content-Type':'application/json' };
        if(token) headers['Authorization'] = `Bearer ${token}`;
        const r = await fetch(CONFIG.proxyUrl, {
          method:'POST', headers, body: JSON.stringify({ message: text })
        });
        if(!r.ok){
          // If the server returns 401, the assistant requires authentication.
          if(r.status === 401){
            // show a helpful bot message and redirect to login so the user can sign in
            if(placeholder) placeholder.textContent = 'Please sign in to use the assistant. Redirecting to login...';
            // persist the attempted user message so it isn't lost after login
            try{ localStorage.setItem('ml_chat_draft', text); }catch(e){}
            setTimeout(()=> redirectToLogin(window.location.pathname + window.location.search), 900);
            return;
          }
          const errTxt = await r.text().catch(()=> '');
          throw new Error(`Proxy error: ${r.status} ${errTxt}`);
        }
        const data = await r.json();
        const reply = data.reply || 'I could not generate a response.';
        if(placeholder) placeholder.textContent = reply;
        if(Array.isArray(data.suggestions) && data.suggestions.length){
          injectSuggestionActions(data.suggestions);
        }
      }catch(err){
        if(placeholder) placeholder.textContent = 'Sorry, I had trouble responding. Please try again.';
        console.error(err);
      }
    });
  }


  // --- Boot ---
  function injectSuggestionActions(suggestions){
    if(!chatWindow) return;
    const wrap = document.createElement('div');
    wrap.className = 'message msg-bot suggestions-inline';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble suggestions';
    bubble.innerHTML = '<strong>Suggested doctors:</strong>';
    suggestions.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-light suggestion-btn';
      btn.textContent = `${s.name} · ${s.specialty}`;
      btn.addEventListener('click', ()=> {
        const match = DOCTORS.find(d => d.id === s.id) || s;
        showProfile(match);
      });
      const book = document.createElement('button');
      book.className = 'btn btn-primary suggestion-btn';
      book.textContent = `Book ${s.name.split(' ')[0]}`;
      book.addEventListener('click', ()=> {
        const match = DOCTORS.find(d => d.id === s.id) || s;
        ensureAuthThenBook(match);
      });
      bubble.appendChild(document.createElement('br'));
      bubble.append(btn, book);
    });
    wrap.appendChild(bubble);
    chatWindow.appendChild(wrap);
    scrollChatToBottom();
  }

  async function boot(){
    try{
      const resp = await fetch('/api/doctors');
      DOCTORS = await resp.json();
      populateSpecialtyFilter();
      renderDoctors(DOCTORS, doctorListEl);
      const topRated = [...DOCTORS].sort((a,b)=> b.rating - a.rating).slice(0,4);
      renderSuggestedDoctors(topRated);
      updateUserBadge();
      renderBookings();
      loadBookings();
      // restore chat history (if any)
      try{
        const raw = localStorage.getItem('ml_chat');
        if(raw){
          CHAT_MESSAGES = JSON.parse(raw) || [];
          renderStoredChat(CHAT_MESSAGES);
        }
      }catch(e){ /* ignore parse errors */ }

      // restore an unsent chat draft after returning from login (if present)
      try{
        const draft = localStorage.getItem('ml_chat_draft');
        if(draft && chatInput){ chatInput.value = draft; localStorage.removeItem('ml_chat_draft'); }
      }catch(e){}

      // On return from login we may have a `book` query (e.g. /doctors.html?book=ID)
      // or a hash like #doctor-<id> — also consult `ml_pending_book` stored
      // before redirect as a robust fallback in case the next param was lost.
      try{
        // Highest priority: full doctor object stored before redirect
        const rawDoc = localStorage.getItem('ml_pending_book_doc');
        // Debug banner to aid testing
        let debugBanner = null;
        try{
          debugBanner = document.createElement('div');
          debugBanner.id = 'ml-debug-banner';
          debugBanner.style.cssText = 'position:fixed;bottom:8px;left:8px;padding:6px 8px;background:rgba(0,0,0,0.7);color:#fff;border-radius:6px;font-size:12px;z-index:9999;display:none;';
          document.body.appendChild(debugBanner);
        }catch(e){}
        if(rawDoc){
          try{
            const parsed = JSON.parse(rawDoc);
            if(parsed && parsed.id){
              // open booking modal using stored object
              openBookingModal(parsed);
              localStorage.removeItem('ml_pending_book_doc');
              localStorage.removeItem('ml_pending_book');
              if(debugBanner){ debugBanner.textContent = `Restored booking for ${parsed.name} (from ml_pending_book_doc)`; debugBanner.style.display = 'block'; }
              return;
            }
          }catch(e){ /* ignore parse error */ }
        }

        const params = new URLSearchParams(window.location.search);
        let bookId = params.get('book');
        if(!bookId){
          bookId = localStorage.getItem('ml_pending_book');
        }
    if(bookId){
          const doc = DOCTORS.find(d => String(d.id) === String(bookId));
          if(doc) {
            openBookingModal(doc);
            try{ localStorage.removeItem('ml_pending_book'); }catch(e){}
      if(debugBanner){ debugBanner.textContent = `Restored booking for ${doc.name} (from bookId)`; debugBanner.style.display = 'block'; }
          }
        } else if(window.location.hash){
          const m = window.location.hash.match(/^#doctor-(\d+)$/);
          if(m){
            const doc = DOCTORS.find(d => String(d.id) === m[1]);
            if(doc) showProfile(doc);
          }
        }
      }catch(e){ /* ignore URL issues */ }

      // Dialog fallback: if the browser doesn't support showModal, ensure
      // the booking modal can still be shown by toggling a visible class.
      if(bookingModal && typeof bookingModal.showModal !== 'function'){
        bookingModal.classList.add('dialog-fallback');
        // ensure close buttons inside dialog will hide the element
        bookingModal.addEventListener('click', (ev) => {
          if(ev.target && (ev.target.matches('[value="cancel"]') || ev.target.closest('.icon-btn'))){
            bookingModal.classList.remove('open');
          }
        });
      }
    }catch(err){
      console.error('Failed to load doctors', err);
    }
  }

  if(searchDoctorEl){
    searchDoctorEl.addEventListener('input', ()=>{
      const list = filterDoctors(searchDoctorEl.value, filterSpecialtyEl?.value);
      renderDoctors(list, doctorListEl);
    });
  }
  if(filterSpecialtyEl){
    filterSpecialtyEl.addEventListener('change', ()=>{
      const list = filterDoctors(searchDoctorEl?.value, filterSpecialtyEl.value);
      renderDoctors(list, doctorListEl);
    });
  }

  boot();
})();
