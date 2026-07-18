import { requireAdmin, supabase } from './_supabase.js';

const CHANNEL = 'wadelytb';
const SINCE = new Date('2026-07-01T00:00:00+02:00');
const isBarmitzva = title => /bar+mi(?:tz|zt)va/i.test(title.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

async function twitchToken() {
  const params = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, client_secret: process.env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' });
  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  if (!response.ok) throw new Error('Unable to authenticate with Twitch');
  return (await response.json()).access_token;
}

async function twitchGet(path, token) {
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID } });
  if (!response.ok) throw new Error(`Twitch ${response.status}`);
  return response.json();
}

export default async function handler(request, response) {
  const auth = request.headers.authorization;
  const validCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!validCron && !requireAdmin(request)) return response.status(401).json({ error: 'Unauthorized' });
  try {
    const token = await twitchToken();
    const users = await twitchGet(`users?login=${CHANNEL}`, token);
    if (!users.data[0]) throw new Error('Twitch channel not found');
    const videos = await twitchGet(`videos?user_id=${users.data[0].id}&type=archive&sort=time&first=100`, token);
    const selected = videos.data.filter(video => new Date(video.created_at) >= SINCE && isBarmitzva(video.title));
    if (selected.length) {
      await supabase('vods?on_conflict=twitch_video_id', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=representation',
        body: JSON.stringify(selected.map(video => ({
          twitch_video_id: video.id,
          title: video.title,
          url: video.url,
          published_at: video.published_at,
          duration: video.duration,
          status: 'pending'
        })))
      });
    }
    return response.status(200).json({ channel: CHANNEL, found: selected.length, syncedAt: new Date().toISOString() });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
