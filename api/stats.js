import { supabase } from './_supabase.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const matches = await supabase('matches?approved=eq.true&select=played_at,goals_for,goals_against,result,updated_at&order=played_at.asc');
    const played = matches.length;
    const wins = matches.filter(match => match.result === 'V').length;
    const draws = matches.filter(match => match.result === 'N').length;
    const losses = matches.filter(match => match.result === 'D').length;
    const goalsFor = matches.reduce((sum, match) => sum + match.goals_for, 0);
    const goalsAgainst = matches.reduce((sum, match) => sum + match.goals_against, 0);
    const cleanSheets = matches.filter(match => match.goals_against === 0).length;
    const recentForm = matches.slice(-5).reverse().map(match => match.result);
    const points = recentForm.reduce((sum, result) => sum + (result === 'V' ? 3 : result === 'N' ? 1 : 0), 0);
    const updatedAt = matches.length ? matches.reduce((latest, match) => match.updated_at > latest ? match.updated_at : latest, matches[0].updated_at) : null;
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({ played, wins, draws, losses, goalsFor, goalsAgainst, cleanSheets, recentForm, points, updatedAt });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
