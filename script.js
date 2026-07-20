const header = document.querySelector('.nav-wrap');
const menu = document.querySelector('.menu');
menu.addEventListener('click', () => {
  const open = header.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', () => header.classList.remove('open')));
window.addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 40), { passive: true });

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { threshold: .13 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

const countObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting || entry.target.dataset.done) return;
    entry.target.dataset.done = 'true';
    const target = Number(entry.target.dataset.count);
    const start = performance.now();
    const run = now => {
      const progress = Math.min((now - start) / 1100, 1);
      entry.target.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  });
}, { threshold: .6 });
document.querySelectorAll('[data-count]').forEach(el => countObserver.observe(el));

async function loadOfficialStats() {
  const status = document.querySelector('#stats-status');
  if (location.protocol === 'file:') {
    status.textContent = 'Le site est prêt à se synchroniser une fois mis en ligne.';
    return;
  }
  try {
    const response = await fetch('/api/stats');
    if (!response.ok) throw new Error('stats unavailable');
    const stats = await response.json();
    stats.goalDifference = (stats.goalsFor || 0) - (stats.goalsAgainst || 0);
    document.querySelectorAll('[data-stat]').forEach(el => {
      const value = stats[el.dataset.stat] ?? 0;
      if (el.hasAttribute('data-count')) {
        el.dataset.count = String(value);
        el.textContent = String(value);
      } else el.textContent = String(value);
    });
    const played = stats.played || 0;
    const winRate = played ? Math.round(stats.wins / played * 100) : 0;
    document.querySelector('[data-stat-rate]').textContent = `${winRate}%`;
    document.querySelector('#win-rate').style.setProperty('--rate', `${winRate * 3.6}deg`);
    document.querySelector('[data-stat-label="goals-average"]').textContent = played ? `${(stats.goalsFor / played).toFixed(1).replace('.', ',')} PAR MATCH` : 'AUCUN MATCH VALIDÉ';
    const total = Math.max(played, 1);
    document.querySelector('.track-wins').style.width = `${(stats.wins || 0) / total * 100}%`;
    document.querySelector('.track-draws').style.width = `${(stats.draws || 0) / total * 100}%`;
    document.querySelector('.track-losses').style.width = `${(stats.losses || 0) / total * 100}%`;
    status.textContent = stats.updatedAt ? `Dernière validation : ${new Date(stats.updatedAt).toLocaleString('fr-FR')}` : 'Aucun résultat validé pour le moment.';
  } catch {
    status.textContent = 'Synchronisation momentanément indisponible.';
  }
}
loadOfficialStats();

const giveawayModal = document.querySelector('#giveaway-modal');
const giveawayForm = document.querySelector('#giveaway-form');
const giveawayMessage = document.querySelector('#giveaway-message');
const giveawayOpen = document.querySelector('.giveaway-open');

if (giveawayModal && giveawayForm && giveawayOpen) {
  const countdown = document.querySelector('#giveaway-countdown');
  const opensAt = new Date('2026-07-20T23:30:00+02:00').getTime();
  const closesAt = new Date('2026-07-21T00:30:00+02:00').getTime();
  const updateCountdown = () => {
    const now = Date.now();
    if (now >= closesAt) {
      giveawayOpen.disabled = true;
      countdown.classList.remove('open');
      countdown.classList.add('closed');
      countdown.querySelector('span').textContent = 'INSCRIPTIONS CLOSES';
      countdown.querySelector('strong').textContent = 'CONCOURS TERMINÉ';
      if (!giveawayModal.hidden) {
        giveawayModal.hidden = true;
        document.body.classList.remove('modal-open');
      }
      return true;
    }

    const remaining = Math.max(0, opensAt - now);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    countdown.querySelector('[data-countdown-hours]').textContent = String(hours).padStart(2, '0');
    countdown.querySelector('[data-countdown-minutes]').textContent = String(minutes).padStart(2, '0');
    countdown.querySelector('[data-countdown-seconds]').textContent = String(seconds).padStart(2, '0');
    if (remaining === 0) {
      giveawayOpen.disabled = false;
      countdown.classList.add('open');
      countdown.querySelector('span').textContent = 'CONCOURS OUVERT';
      countdown.querySelector('strong').textContent = 'PARTICIPE MAINTENANT';
      return false;
    }
    return false;
  };
  updateCountdown();
  const countdownTimer = setInterval(() => {
    if (updateCountdown()) clearInterval(countdownTimer);
  }, 1000);

  const closeGiveaway = () => {
    giveawayModal.hidden = true;
    document.body.classList.remove('modal-open');
    giveawayOpen.focus();
  };

  giveawayOpen.addEventListener('click', () => {
    giveawayModal.hidden = false;
    document.body.classList.add('modal-open');
    giveawayMessage.textContent = '';
    giveawayMessage.className = 'giveaway-message';
    document.querySelector('#twitch-username').focus();
  });

  giveawayModal.querySelectorAll('[data-giveaway-close]').forEach(button => button.addEventListener('click', closeGiveaway));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !giveawayModal.hidden) closeGiveaway();
  });

  giveawayForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = giveawayForm.querySelector('button[type="submit"]');
    const data = new FormData(giveawayForm);
    submit.disabled = true;
    giveawayMessage.textContent = 'Inscription en cours…';
    giveawayMessage.className = 'giveaway-message';
    try {
      const response = await fetch('/api/contest-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twitchUsername: data.get('twitchUsername'), discordUsername: data.get('discordUsername') })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Inscription impossible.');
      giveawayMessage.textContent = 'Participation validée ! Bonne chance 💜';
      giveawayMessage.className = 'giveaway-message success';
      giveawayForm.reset();
    } catch (error) {
      giveawayMessage.textContent = error.message;
      giveawayMessage.className = 'giveaway-message error';
    } finally {
      submit.disabled = false;
    }
  });
}
