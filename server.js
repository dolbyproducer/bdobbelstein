require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');

const app      = express();
const PORT     = process.env.PORT || 4000;
const SA_TOKEN = process.env.SOURCEAUDIO_TOKEN;
const SA_BASE  = 'https://dbminor.sourceaudio.com';

app.use(express.static(path.join(__dirname, 'public')));

const MASTERS_FILE = path.join(__dirname, 'masters-cache.json');

function loadMasters() {
  try {
    const raw = JSON.parse(fs.readFileSync(MASTERS_FILE, 'utf8'));
    if (raw && raw.tracks) return raw.tracks;
  } catch(e) {}
  return null;
}

function saveMasters(tracks) {
  fs.writeFileSync(MASTERS_FILE, JSON.stringify({ builtAt: Date.now(), tracks }, null, 2));
}

function normalizeTrack(t) {
  const rawImage = t['Album Image'] || t['Album Artwork'] || t.artwork || '';
  const artworkUrl = rawImage ? (rawImage.startsWith('http') ? rawImage : SA_BASE + rawImage) : '';
  return {
    id:          t['SourceAudio ID'] || t.id || '',
    title:       t.Title || t.title || 'Untitled',
    album:       t.Album || t.album || '',
    albumCode:   t['Album Code'] || t.album_code || '',
    duration:    parseFloat(t.Duration || t.duration || 0),
    artworkUrl,
    version:     t.Version || t.version || 'Main',
    trackNumber: t['Track Number'] || t.track_number || 0,
    masterId:    t['Master ID'] || t['SourceAudio ID'] || '',
  };
}

async function buildMastersCache() {
  console.log('Building masters cache...');
  const tracks = [];
  const seen = {};
  let pg = 0;
  while (true) {
    const url = SA_BASE + '/api/tracks/search?token=' + SA_TOKEN + '&s=&show=1000&pg=' + pg + '&orderby=release_date&dir=d';
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const raw  = data.tracks || [];
    if (!raw.length) break;
    raw.forEach(function(t) {
      const id = String(t['SourceAudio ID'] || t.id || '');
      if (id && !seen[id]) { seen[id] = true; tracks.push(t); }
    });
    console.log('Page ' + pg + ': ' + raw.length + ' tracks (total: ' + tracks.length + ')');
    if (raw.length < 1000) break;
    pg++;
    await new Promise(function(r) { setTimeout(r, 200); });
  }
  saveMasters(tracks);
  return tracks;
}

app.get('/api/album/:code', function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const masters = loadMasters();
  if (!masters) return res.status(503).json({ error: 'Cache not ready. Hit /api/rebuild first.' });
  const code   = req.params.code.toUpperCase();
  const tracks = masters
    .map(normalizeTrack)
    .filter(function(t) { return t.albumCode === code && t.version === 'Main'; })
    .sort(function(a, b) { return (a.trackNumber || 0) - (b.trackNumber || 0); });
  const artworkUrl = tracks.length ? tracks[0].artworkUrl : '';
  res.json({ code: code, count: tracks.length, artworkUrl: artworkUrl, tracks: tracks });
});

app.get('/api/rebuild', async function(req, res) {
  try {
    const tracks = await buildMastersCache();
    res.json({ rebuilt: true, count: tracks.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/audio/:id', async function(req, res) {
  try {
    const r = await fetch(SA_BASE + '/api/tracks/download?token=' + SA_TOKEN + '&track_id=' + req.params.id);
    if (!r.ok) throw new Error('SourceAudio ' + r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const cl = r.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    r.body.pipe(res);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/artwork', async function(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Artwork ' + r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    r.body.pipe(res);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, function() {
  console.log('bdobbelstein player server running on http://localhost:' + PORT);
  if (!loadMasters()) {
    console.log('No masters cache — building now...');
    buildMastersCache()
      .then(function(t) { console.log('Masters cache ready: ' + t.length + ' tracks'); })
      .catch(function(e) { console.log('Cache build error: ' + e.message); });
  } else {
    console.log('Masters cache loaded: ' + loadMasters().length + ' tracks');
  }
});
