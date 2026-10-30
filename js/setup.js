function $(id) {
  return document.getElementById(id);
}

let step = 'hello';
let mode = 'open';
let done;

function showSetup() {
  document.body.classList.remove('auth-pending');
  document.body.classList.add('locked');
  $('login-gate')?.setAttribute('hidden', '');
  $('setup-gate')?.removeAttribute('hidden');
}

function hideSetup() {
  $('setup-gate')?.setAttribute('hidden', '');
}

function paint() {
  const title = $('setup-title');
  const lead = $('setup-lead');
  const body = $('setup-body');
  const next = $('setup-next');
  const back = $('setup-back');
  const error = $('setup-error');
  if (error) error.textContent = '';
  if (back) back.hidden = step === 'hello';
  if (next) next.hidden = step === 'choose';
  if (step === 'hello') {
    if (title) title.textContent = 'Hello, welcome to Motto';
    if (lead) lead.textContent = 'Your music stays on this computer.';
    if (body) body.innerHTML = '';
    if (next) next.textContent = 'Continue';
    return;
  }
  if (step === 'choose') {
    if (title) title.textContent = 'How should Motto open?';
    if (lead) lead.textContent = 'This computer is the only place Motto answers.';
    if (body) {
      body.innerHTML = `
        <div class="setup-choices">
          <button type="button" class="login-submit" data-mode="open">No sign-in</button>
          <button type="button" class="login-submit" data-mode="pin">A PIN</button>
          <button type="button" class="login-submit" data-mode="email">Email and PIN</button>
        </div>
      `;
    }
    return;
  }
  if (mode === 'open') {
    if (title) title.textContent = 'No sign-in';
    if (lead) lead.textContent = 'Motto will open straight into your library on this PC.';
    if (body) body.innerHTML = '';
  } else if (mode === 'pin') {
    if (title) title.textContent = 'Choose a PIN';
    if (lead) lead.textContent = 'You will enter this each time Motto opens.';
    if (body) {
      body.innerHTML = `
        <input type="password" class="login-input" id="setup-pin" placeholder="PIN" inputmode="numeric" autocomplete="new-password" />
        <input type="password" class="login-input" id="setup-pin-2" placeholder="Confirm PIN" inputmode="numeric" autocomplete="new-password" />
      `;
    }
  } else {
    if (title) title.textContent = 'Email and PIN';
    if (lead) lead.textContent = 'You will enter these each time Motto opens.';
    if (body) {
      body.innerHTML = `
        <input type="email" class="login-input" id="setup-email" placeholder="Email" autocomplete="username" />
        <input type="password" class="login-input" id="setup-pin" placeholder="PIN" inputmode="numeric" autocomplete="new-password" />
        <input type="password" class="login-input" id="setup-pin-2" placeholder="Confirm PIN" inputmode="numeric" autocomplete="new-password" />
      `;
    }
  }
  if (next) next.textContent = 'Start';
}

function fail(message) {
  const error = $('setup-error');
  if (error) error.textContent = message || 'Setup failed';
}

async function finish() {
  const pin = $('setup-pin')?.value.trim() || '';
  const again = $('setup-pin-2')?.value.trim() || '';
  const email = $('setup-email')?.value.trim() || '';
  if (mode !== 'open') {
    if (pin.length < 4) return fail('Use at least 4 characters');
    if (pin !== again) return fail('Those PINs do not match');
  }
  if (mode === 'email' && !email.includes('@')) return fail('Enter the email you want to use');
  const next = $('setup-next');
  if (next) next.disabled = true;
  try {
    const res = await fetch('/api/setup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, pin, email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error || 'Setup failed');
    hideSetup();
    done(true);
  } catch {
    fail('Setup failed');
  } finally {
    if (next) next.disabled = false;
  }
}

function bind() {
  const form = $('setup-form');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (step === 'hello') {
      step = 'choose';
      paint();
      return;
    }
    if (step === 'ready') finish();
  });
  $('setup-next')?.addEventListener('click', () => {
    if (step === 'hello') {
      step = 'choose';
      paint();
      return;
    }
    if (step === 'ready') finish();
  });
  $('setup-back')?.addEventListener('click', () => {
    step = step === 'ready' ? 'choose' : 'hello';
    paint();
  });
  $('setup-body')?.addEventListener('click', (e) => {
    const picked = e.target.closest('[data-mode]')?.dataset.mode;
    if (!picked) return;
    mode = picked;
    step = 'ready';
    paint();
  });
}

export function ensureSetup() {
  return fetch('/api/setup', { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : { needed: false }))
    .catch(() => ({ needed: false }))
    .then((data) => {
      if (!data?.needed) return true;
      bind();
      step = 'hello';
      showSetup();
      paint();
      return new Promise((resolve) => {
        done = resolve;
      });
    });
}
