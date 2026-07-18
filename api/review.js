import { requireAdmin, supabase } from './_supabase.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return response.status(401).json({ error: 'Unauthorized' });
  try {
    if (request.method === 'GET') {
      const vods = await supabase('vods?select=*&order=published_at.desc');
      const matches = await supabase('matches?select=*&order=played_at.desc');
      return response.status(200).json({ vods, matches });
    }
    if (request.method === 'POST') {
      const { vodId, opponent, goalsFor, goalsAgainst, playedAt } = request.body || {};
      if (!vodId || !opponent || !Number.isInteger(Number(goalsFor)) || !Number.isInteger(Number(goalsAgainst))) return response.status(400).json({ error: 'Invalid match data' });
      const gf = Number(goalsFor), ga = Number(goalsAgainst);
      const result = gf > ga ? 'V' : gf < ga ? 'D' : 'N';
      const match = await supabase('matches', { method: 'POST', body: JSON.stringify({ vod_id: vodId, opponent, goals_for: gf, goals_against: ga, result, played_at: playedAt || new Date().toISOString(), approved: true }) });
      return response.status(201).json(match[0]);
    }
    if (request.method === 'PATCH') {
      const { vodId, status = 'reviewed' } = request.body || {};
      if (!vodId || !['reviewed', 'ignored'].includes(status)) return response.status(400).json({ error: 'Invalid VOD data' });
      const vod = await supabase(`vods?id=eq.${encodeURIComponent(vodId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reviewed_at: new Date().toISOString() })
      });
      return response.status(200).json(vod[0]);
    }
    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
