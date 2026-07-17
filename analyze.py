from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import pytesseract
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')

SITE_URL = os.getenv('SITE_URL', 'https://barmitzva-fc.vercel.app').rstrip('/')
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', '')
SAMPLE_SECONDS = int(os.getenv('SAMPLE_SECONDS', '5'))
MIN_CONFIRMATIONS = int(os.getenv('MIN_CONFIRMATIONS', '3'))
AUTO_PUBLISH = os.getenv('AUTO_PUBLISH', 'true').lower() == 'true'
INCLUDE_HISTORY = os.getenv('INCLUDE_HISTORY', 'true').lower() == 'true'
MARK_SCANNED = os.getenv('MARK_SCANNED', 'false').lower() == 'true'
MAX_VODS = int(os.getenv('MAX_VODS', '0'))
local_tesseract = ROOT / 'tools' / 'tesseract' / 'tesseract.exe'
system_tesseract = shutil.which('tesseract')
pytesseract.pytesseract.tesseract_cmd = os.getenv(
    'TESSERACT_CMD',
    str(local_tesseract if local_tesseract.exists() else (system_tesseract or Path(r'C:\Program Files\Tesseract-OCR\tesseract.exe'))),
)

HEADERS = {'Authorization': f'Bearer {ADMIN_TOKEN}', 'Content-Type': 'application/json'}
SCORE = re.compile(r'(?<!\d)(\d{1,2})\s*[-:–—]\s*(\d{1,2})(?!\d)')


def api(path: str, method: str = 'GET', payload: dict | None = None):
    response = requests.request(method, f'{SITE_URL}{path}', headers=HEADERS, json=payload, timeout=60)
    response.raise_for_status()
    return response.json()


def download_vod(url: str, destination: Path) -> None:
    environment = os.environ.copy()
    ffmpeg = next((ROOT / 'tools' / 'ffmpeg').rglob('ffmpeg.exe'), None)
    if ffmpeg:
        environment['PATH'] = f'{ffmpeg.parent};{environment.get("PATH", "")}'
    local_downloader = ROOT / '.venv' / 'Scripts' / 'yt-dlp.exe'
    downloader = [str(local_downloader)] if local_downloader.exists() else [sys.executable, '-m', 'yt_dlp']
    subprocess.run(downloader + [
        '--no-playlist', '-f', 'worst[height>=480]/worst',
        '--downloader', 'm3u8:native', '--concurrent-fragments', '4',
        '--newline', '--progress', '--progress-delta', '2',
        '--progress-template', 'download:Telechargement : %(progress._percent_str)s | vitesse %(progress._speed_str)s | restant %(progress._eta_str)s',
        '-o', str(destination), url
    ], check=True, env=environment)


def normalize(text: str) -> str:
    return re.sub(r'\s+', ' ', text.upper().replace('|', 'I')).strip()


def read_region(crop) -> str:
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
    gray = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    return pytesseract.image_to_string(gray, config='--psm 6', lang='eng').upper().replace('|', 'I')


def screen_signature(crop):
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    cyan = ((hsv[:, :, 0] >= 75) & (hsv[:, :, 0] <= 105) & (hsv[:, :, 1] > 80) & (hsv[:, :, 2] > 100)).mean()
    return {'cyan': float(cyan), 'bright': float((gray > 190).mean()), 'dark': float((gray < 85).mean())}


def parse_stats_screen(text: str, second: float):
    flat = normalize(text)
    if 'BARMITZVA' not in flat and 'BARMIZTVA' not in flat:
        return None
    score = SCORE.search(flat)
    if not score:
        return None
    left, right = map(int, score.groups())
    if left > 20 or right > 20:
        return None
    club_position = min(pos for pos in (flat.find('BARMITZVA'), flat.find('BARMIZTVA')) if pos >= 0)
    goals_for, goals_against = (right, left) if club_position > score.end() else (left, right)
    score_line = next((normalize(line) for line in text.splitlines() if SCORE.search(normalize(line))), flat)
    opponent = extract_opponent(score_line)
    return {'second': round(second), 'goalsFor': goals_for, 'goalsAgainst': goals_against, 'opponent': opponent, 'kind': 'stats', 'ocr': flat[:500]}


def parse_scoreboard(text: str, second: float):
    flat = normalize(text)
    if not re.search(r'\b90\s*[:.]?\s*0?0\b', flat):
        return None
    teams = re.findall(r'\b([A-Z][A-Z0-9-]{1,14})\s+(\d{1,2})\b', flat)
    if len(teams) < 2:
        return None
    club_index = next((i for i, (name, _) in enumerate(teams) if name in {'BFC', 'BARMITZVA', 'BARMIZTVA'}), None)
    if club_index is None:
        return None
    club, club_score = teams[club_index]
    opponent = next(((name, score) for i, (name, score) in enumerate(teams) if i != club_index and name not in {'LIGUE', 'BKT'}), None)
    if not opponent:
        return None
    opponent_name, opponent_score = opponent
    if int(club_score) > 20 or int(opponent_score) > 20:
        return None
    return {'second': round(second), 'goalsFor': int(club_score), 'goalsAgainst': int(opponent_score), 'opponent': opponent_name, 'kind': 'scoreboard', 'ocr': flat[:500]}


def frame_candidate(frame, second: float):
    height, width = frame.shape[:2]
    # Écran de statistiques sombre avec score turquoise au centre (capture de référence 2).
    stats_crop = frame[int(height * .04):int(height * .70), int(width * .05):int(width * .74)]
    stats_signature = screen_signature(stats_crop)
    if stats_signature['dark'] > .30 and stats_signature['cyan'] > .0015:
        candidate = parse_stats_screen(read_region(stats_crop), second)
        if candidate:
            return candidate

    # Tableau blanc en haut à gauche. Lecture espacée car il reste visible pendant le match.
    if int(second) % 20 < SAMPLE_SECONDS:
        scoreboard_crop = frame[int(height * .025):int(height * .23), int(width * .02):int(width * .29)]
        scoreboard_signature = screen_signature(scoreboard_crop)
        if scoreboard_signature['bright'] > .055:
            return parse_scoreboard(read_region(scoreboard_crop), second)
    return None


def extract_opponent(text: str) -> str:
    words = re.sub(r'[^A-Z0-9 À-Ü-]', ' ', text).split()
    blacklist = {'BARMITZVA', 'BARMIZTVA', 'BFC', 'FC', 'MATCH', 'FIN', 'SCORE', 'LIGUE', 'BKT', 'CONTINUER'}
    useful = [word for word in words if len(word) >= 2 and word not in blacklist and not word.isdigit()]
    return ' '.join(useful[:3]).title() or 'Adversaire à confirmer'


def format_time(seconds: float) -> str:
    seconds = max(0, round(seconds))
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    if hours:
        return f'{hours} h {minutes:02d} min'
    if minutes:
        return f'{minutes} min {seconds:02d} s'
    return f'{seconds} s'


def analyze_video(path: Path):
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 30
    frames = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    duration = frames / fps
    total_samples = max(1, math.ceil(duration / SAMPLE_SECONDS))
    started = time.monotonic()
    found = []
    second = 0
    sample_number = 0
    last_percent = -1
    while second < duration:
        capture.set(cv2.CAP_PROP_POS_MSEC, second * 1000)
        ok, frame = capture.read()
        if ok:
            candidate = frame_candidate(frame, second)
            if candidate:
                found.append(candidate)
        sample_number += 1
        percent = min(100, int(sample_number * 100 / total_samples))
        if percent >= last_percent + 2 or percent == 100:
            elapsed = time.monotonic() - started
            speed = sample_number / elapsed if elapsed else 0
            remaining = (total_samples - sample_number) / speed if speed else 0
            print(f'  Analyse : {percent:3d}% | temps restant estimé : {format_time(remaining)}', flush=True)
            last_percent = percent
        second += SAMPLE_SECONDS
    capture.release()
    return consolidate(found)


def consolidate(candidates):
    groups = []
    for item in candidates:
        key = (item['goalsFor'], item['goalsAgainst'])
        if groups and item['second'] - groups[-1][-1]['second'] <= 65 and key == (groups[-1][-1]['goalsFor'], groups[-1][-1]['goalsAgainst']):
            groups[-1].append(item)
        else:
            groups.append([item])
    results = []
    for group in groups:
        required = 2 if any(item.get('kind') in {'stats', 'scoreboard'} for item in group) else MIN_CONFIRMATIONS
        if len(group) < required:
            continue
        opponent = Counter(x['opponent'] for x in group).most_common(1)[0][0]
        results.append({**group[len(group) // 2], 'opponent': opponent, 'confirmations': len(group)})
    return results


def publish(vod: dict, matches: list[dict]):
    published = datetime.fromisoformat(vod['published_at'].replace('Z', '+00:00'))
    for match in matches:
        payload = {
            'vodId': vod['id'], 'opponent': match['opponent'],
            'goalsFor': match['goalsFor'], 'goalsAgainst': match['goalsAgainst'],
            'playedAt': (published + timedelta(seconds=match['second'])).isoformat()
        }
        if AUTO_PUBLISH:
            api('/api/review', 'POST', payload)
    if AUTO_PUBLISH and (matches or MARK_SCANNED):
        status = 'reviewed' if matches else 'ignored'
        api('/api/review', 'PATCH', {'vodId': vod['id'], 'status': status})


def main():
    if not ADMIN_TOKEN or 'COLLER_' in ADMIN_TOKEN:
        raise SystemExit('Ajoute ADMIN_TOKEN dans local-analyzer/.env')
    data = api('/api/review')
    output = ROOT / 'resultats-detectes.json'
    # Au tout premier lancement, reprendre aussi l'historique depuis le 1er juillet.
    previous_report = []
    if output.exists():
        try:
            previous_report = json.loads(output.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, OSError):
            previous_report = []
    processed_urls = {item.get('url') for item in previous_report}
    matched_vod_ids = {match.get('vod_id') for match in data.get('matches', [])}
    pending = [vod for vod in data['vods'] if vod['status'] == 'pending' and vod.get('url') not in processed_urls]
    if not pending and INCLUDE_HISTORY:
        start = datetime.fromisoformat(os.getenv('ANALYZE_FROM', '2026-07-01')).replace(tzinfo=timezone.utc)
        pending = [
            vod for vod in data['vods']
            if 'barmitzva' in vod.get('title', '').lower()
            and datetime.fromisoformat(vod['published_at'].replace('Z', '+00:00')) >= start
            and vod.get('status') == 'reviewed'
            and vod.get('id') not in matched_vod_ids
            and vod.get('url') not in processed_urls
        ]
        if pending:
            print('Premier lancement : reprise de l\'historique depuis le 1er juillet.')
    if MAX_VODS > 0:
        pending = pending[:MAX_VODS]
    print(f'{len(pending)} rediffusion(s) à analyser.')
    report = previous_report
    batch_started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='barmitzva-') as temp:
        for position, vod in enumerate(pending, start=1):
            video = Path(temp) / f"{vod['twitch_video_id']}.mp4"
            print(f"\n[{position}/{len(pending)}] Téléchargement : {vod['title']}")
            download_vod(vod['url'], video)
            matches = analyze_video(video)
            print(f'  {len(matches)} match(s) confirmé(s)')
            publish(vod, matches)
            report.append({'vod': vod['title'], 'url': vod['url'], 'matches': matches})
            output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            average = (time.monotonic() - batch_started) / position
            total_remaining = average * (len(pending) - position)
            print(f'  Temps restant total estimé : {format_time(total_remaining)}')
    print(f'Analyse terminée. Rapport : {output}')


if __name__ == '__main__':
    main()
