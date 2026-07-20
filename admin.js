const login = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const loginForm = document.querySelector('#login-form');
const matchForm = document.querySelector('#match-form');
let adminToken = sessionStorage.getItem('bfc_admin_token') || '';
let contestEntries = [];

const api = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Une erreur est survenue');
  return data;
};

function render(data) {
  const vodList = document.querySelector('#vod-list');
  const vodSelect = document.querySelector('#vod');
  const matchCounts = data.matches.reduce((counts, match) => ({ ...counts, [match.vod_id]: (counts[match.vod_id] || 0) + 1 }), {});
  vodList.innerHTML = data.vods.length ? data.vods.map(vod => `<article class="vod"><div><a href="${vod.url}" target="_blank" rel="noopener">${escapeHtml(vod.title)}</a><p>${new Date(vod.published_at).toLocaleString('fr-FR')} · ${vod.duration || ''} · ${matchCounts[vod.id] || 0} match(s)</p>${vod.status === 'pending' ? `<button class="finish-vod" data-vod-id="${vod.id}">Vidéo entièrement traitée</button>` : ''}</div><span class="badge ${vod.status}">${vod.status === 'reviewed' ? 'Vérifiée' : 'À vérifier'}</span></article>`).join('') : '<p>Aucune rediffusion synchronisée.</p>';
  vodSelect.innerHTML = data.vods.filter(vod => vod.status === 'pending').map(vod => `<option value="${vod.id}">${escapeHtml(vod.title)}</option>`).join('');
  document.querySelector('#match-list').innerHTML = data.matches.length ? data.matches.map(match => `<article class="match-row"><span>Barmitzva FC — ${escapeHtml(match.opponent)}</span><b>${match.goals_for} — ${match.goals_against}</b><small>${new Date(match.played_at).toLocaleString('fr-FR')}</small></article>`).join('') : '<p>Aucun match publié.</p>';
}

function renderEntries(data) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  contestEntries = entries;
  document.querySelector('#entry-count').textContent = entries.length;
  document.querySelector('#download-discord').disabled = entries.length === 0;
  document.querySelector('#entry-list').innerHTML = entries.length
    ? entries.map(entry => `<tr><td><span class="platform twitch">Twitch</span>${escapeHtml(entry.twitch_username)}</td><td><span class="platform discord">Discord</span>${escapeHtml(entry.discord_username)}</td><td>${new Date(entry.created_at).toLocaleString('fr-FR')}</td></tr>`).join('')
    : '<tr><td colspan="3">Aucune participation pour le moment.</td></tr>';
  document.querySelector('#entries-error').textContent = '';
}

async function loadEntries() {
  try { renderEntries(await api('/api/contest-entries')); }
  catch (error) { document.querySelector('#entries-error').textContent = error.message; }
}

const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

async function openDashboard() {
  const data = await api('/api/review');
  login.hidden = true;
  dashboard.hidden = false;
  render(data);
  await loadEntries();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminToken = document.querySelector('#token').value;
  try { await openDashboard(); sessionStorage.setItem('bfc_admin_token', adminToken); }
  catch (error) { document.querySelector('#login-error').textContent = 'Code incorrect ou service non configuré.'; }
});

document.querySelector('#vod-list').addEventListener('click', async event => {
  const button = event.target.closest('.finish-vod');
  if (!button) return;
  button.disabled = true;
  try {
    await api('/api/review', { method: 'PATCH', body: JSON.stringify({ vodId: button.dataset.vodId, status: 'reviewed' }) });
    render(await api('/api/review'));
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});

matchForm.addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.querySelector('#message');
  try {
    await api('/api/review', { method: 'POST', body: JSON.stringify({ vodId: document.querySelector('#vod').value, opponent: document.querySelector('#opponent').value, goalsFor: Number(document.querySelector('#goals-for').value), goalsAgainst: Number(document.querySelector('#goals-against').value), playedAt: new Date(document.querySelector('#played-at').value).toISOString() }) });
    message.textContent = 'Match publié sur le site.';
    matchForm.reset();
    render(await api('/api/review'));
  } catch (error) { message.textContent = error.message; }
});

document.querySelector('#sync').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Synchronisation…';
  try { await api('/api/sync'); render(await api('/api/review')); }
  catch (error) { alert(error.message); }
  finally { button.disabled = false; button.textContent = 'Rechercher les nouveaux lives'; }
});

document.querySelector('#refresh-entries').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Actualisation…';
  await loadEntries();
  button.disabled = false;
  button.textContent = 'Actualiser';
});

document.querySelector('#download-discord').addEventListener('click', () => {
  if (!contestEntries.length) return;
  const content = contestEntries.map(entry => entry.discord_username).join('\n');
  const file = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pseudos-discord-concours.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

document.querySelector('#played-at').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16);
if (adminToken) openDashboard().catch(() => sessionStorage.removeItem('bfc_admin_token'));
