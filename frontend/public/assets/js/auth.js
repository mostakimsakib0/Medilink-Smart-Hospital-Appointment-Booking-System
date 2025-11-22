(function(){
  const params = new URLSearchParams(window.location.search);
  const nextParam = params.get('next');

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const loginError = document.getElementById('login-error');
  const registerError = document.getElementById('register-error');

  const nextTarget = resolveNext();

  document.querySelectorAll('[data-next-link]').forEach(link => {
    const base = link.dataset.base || link.getAttribute('href');
    if(nextParam && base){
      link.setAttribute('href', `${base}?next=${encodeURIComponent(nextTarget)}`);
    } else if(base){
      link.setAttribute('href', base);
    }
  });

  const sessionUser = getCurrentUser();
  if(sessionUser){
    injectSessionBanner(sessionUser);
  }

  if(loginForm){
    loginForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(!loginForm.reportValidity()) return;
      setError(loginError, '');
      setFormLoading(loginForm, true);
      try{
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await resp.json();
        if(!resp.ok) throw new Error(data.error || 'Login failed');
        persistSession(data.user, data.token);
        window.location.href = nextTarget;
      }catch(err){
        setError(loginError, err.message || 'Login failed');
      }finally{
        setFormLoading(loginForm, false);
      }
    });
  }

  if(registerForm){
    registerForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(!registerForm.reportValidity()) return;
      setError(registerError, '');
      const password = document.getElementById('reg-password').value;
      const confirm = document.getElementById('reg-confirm').value;
      if(password !== confirm){
        setError(registerError, 'Passwords do not match.');
        return;
      }
      setFormLoading(registerForm, true);
      try{
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const resp = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });
        const data = await resp.json();
        if(!resp.ok) throw new Error(data.error || 'Registration failed');
        persistSession(data.user, data.token);
        window.location.href = nextTarget;
      }catch(err){
        setError(registerError, err.message || 'Registration failed');
      }finally{
        setFormLoading(registerForm, false);
      }
    });
  }

  function resolveNext(){
    if(nextParam && nextParam.startsWith('/')) return nextParam;
    return '/index.html';
  }

  function persistSession(user, token){
    localStorage.setItem('ml_user', JSON.stringify(user));
    if(token) localStorage.setItem('ml_token', token);
  }

  function getCurrentUser(){
    try{
      const raw = localStorage.getItem('ml_user');
      return raw ? JSON.parse(raw) : null;
    }catch{
      return null;
    }
  }

  function setError(el, message){
    if(!el) return;
    el.textContent = message;
    el.classList.toggle('show', Boolean(message));
  }

  function setFormLoading(form, state){
    const submit = form?.querySelector('button[type="submit"]');
    if(!submit) return;
    if(state){
      submit.dataset.originalText = submit.textContent;
      submit.textContent = 'Please wait...';
      submit.disabled = true;
    } else {
      submit.textContent = submit.dataset.originalText || submit.textContent;
      submit.disabled = false;
    }
  }

  function injectSessionBanner(user){
    const banner = document.createElement('div');
    banner.className = 'auth-session';
    banner.innerHTML = `<strong>Signed in as ${user.name}</strong><span>${user.email}</span>`;
    const actions = document.createElement('div');
    actions.className = 'auth-session-actions';
    const toHome = document.createElement('a');
    toHome.href = nextTarget;
    toHome.className = 'btn btn-primary';
    toHome.textContent = 'Continue';
    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'btn';
    logout.textContent = 'Switch account';
    logout.addEventListener('click', ()=>{
      localStorage.removeItem('ml_user');
      localStorage.removeItem('ml_token');
      banner.remove();
    });
    actions.append(toHome, logout);
    banner.appendChild(actions);
    const card = document.querySelector('.auth-card');
    if(card) card.insertBefore(banner, card.children[3] || null);
  }
})();
