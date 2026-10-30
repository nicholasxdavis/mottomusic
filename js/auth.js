import { ensureSetup } from './setup.js';

function $(id) {

  return document.getElementById(id);

}



function showApp() {

  document.body.classList.remove('locked', 'auth-pending');

  $('login-gate')?.setAttribute('hidden', '');
  $('setup-gate')?.setAttribute('hidden', '');

}



function showLogin() {

  document.body.classList.remove('auth-pending');

  document.body.classList.add('locked');

  $('login-gate')?.removeAttribute('hidden');

}



function applyGate(gate) {
  const email = $('login-email');
  const pin = $('login-pin');
  const title = document.querySelector('.login-title');
  const mode = gate?.mode || 'email';
  const pinOnly = mode === 'pin' || mode === 'pins';
  if (email) {
    email.hidden = pinOnly;
    email.required = !pinOnly;
    if (pinOnly) email.value = '';
  }
  if (pin) pin.placeholder = 'PIN';
  if (title) title.textContent = pinOnly ? 'Enter your PIN' : 'Sign in to Motto';
  document.body.classList.toggle('auth-off', gate?.enabled === false);
}

async function fetchGate() {
  try {
    const res = await fetch('/api/auth/gate', { credentials: 'same-origin' });
    if (!res.ok) return { enabled: true, mode: 'email' };
    return await res.json();
  } catch {
    return { enabled: true, mode: 'email' };
  }
}

async function checkSession() {

  try {

    const res = await fetch('/api/auth/session', { credentials: 'same-origin' });

    if (!res.ok) return false;

    const data = await res.json();

    return !!data?.ok;

  } catch {

    return false;

  }

}



async function login(email, pin, remember) {

  const res = await fetch('/api/auth/login', {

    method: 'POST',

    credentials: 'same-origin',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify({ email, pin, remember }),

  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(data.error || 'Sign in failed');

  return data;

}



function stripLoginQuery() {

  const { pathname, search } = window.location;

  if (!search || (!search.includes('email=') && !search.includes('pin='))) return;

  window.history.replaceState(null, '', pathname);

}



async function handleLogin() {

  const err = $('login-error');

  const btn = $('login-submit');

  if (err) err.textContent = '';

  const email = $('login-email')?.hidden ? '' : ($('login-email')?.value?.trim() || '');

  const pin = $('login-pin')?.value?.trim() || '';

  const remember = !!$('login-remember')?.checked;

  if (btn) btn.disabled = true;



  try {

    await login(email, pin, remember);

    stripLoginQuery();

    showApp();

    window.dispatchEvent(new CustomEvent('motto:authed'));

  } catch (ex) {

    if (err) err.textContent = ex.message || 'Sign in failed';

  } finally {

    if (btn) btn.disabled = false;

  }

}



function bindLoginForm() {

  const form = $('login-form');

  if (!form || form.dataset.bound === '1') return;

  form.dataset.bound = '1';



  form.addEventListener('submit', (e) => {

    e.preventDefault();

    handleLogin();

  });



  $('login-submit')?.addEventListener('click', () => handleLogin());

}



export async function signOut() {

  try {

    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });

  } catch {}

  const pinEl = $('login-pin');

  if (pinEl) pinEl.value = '';

  const errEl = $('login-error');

  if (errEl) errEl.textContent = '';

  showLogin();

}



export async function requireAuth() {

  stripLoginQuery();

  bindLoginForm();

  const ready = await ensureSetup();
  if (!ready) return false;

  const gate = await fetchGate();
  applyGate(gate);
  if (gate.enabled === false) {
    showApp();
    return true;
  }



  if (await checkSession()) {

    showApp();

    return true;

  }



  showLogin();

  return new Promise((resolve) => {

    window.addEventListener('motto:authed', () => resolve(true), { once: true });

  });

}


