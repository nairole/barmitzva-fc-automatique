import { supabase } from './_supabase.js';

const clean = value => String(value || '').trim();
const opensAt = new Date('2026-07-20T23:30:00+02:00').getTime();
const closesAt = new Date('2026-07-21T00:30:00+02:00').getTime();

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Méthode non autorisée.' });

  const now = Date.now();
  if (now < opensAt) return response.status(403).json({ error: 'Les inscriptions ouvrent à 23 h 30.' });
  if (now >= closesAt) return response.status(410).json({ error: 'Les inscriptions au concours sont closes.' });

  const twitchUsername = clean(request.body?.twitchUsername);
  const discordUsername = clean(request.body?.discordUsername);

  if (!/^[A-Za-z0-9_]{3,25}$/.test(twitchUsername)) {
    return response.status(400).json({ error: 'Le pseudo Twitch doit contenir 3 à 25 lettres, chiffres ou underscores.' });
  }
  if (discordUsername.length < 2 || discordUsername.length > 32 || /[<>\r\n]/.test(discordUsername)) {
    return response.status(400).json({ error: 'Le pseudo Discord doit contenir entre 2 et 32 caractères.' });
  }

  try {
    const entries = await supabase('contest_entries', {
      method: 'POST',
      body: JSON.stringify({ twitch_username: twitchUsername, discord_username: discordUsername })
    });
    return response.status(201).json({ ok: true, id: entries?.[0]?.id });
  } catch (error) {
    if (String(error.message).includes('409')) {
      return response.status(409).json({ error: 'Ce pseudo Twitch ou Discord est déjà inscrit.' });
    }
    return response.status(500).json({ error: 'Inscription momentanément indisponible.' });
  }
}
