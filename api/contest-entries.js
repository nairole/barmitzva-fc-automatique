import { requireAdmin, supabase } from './_supabase.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return response.status(401).json({ error: 'Accès refusé.' });
  if (request.method !== 'GET') return response.status(405).json({ error: 'Méthode non autorisée.' });

  try {
    const entries = await supabase(
      'contest_entries?select=id,twitch_username,discord_username,created_at&order=created_at.desc'
    );
    return response.status(200).json({ entries });
  } catch (error) {
    return response.status(500).json({ error: 'Impossible de charger les participations.' });
  }
}
