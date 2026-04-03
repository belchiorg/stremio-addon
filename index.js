const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const JACKETT_URL = process.env.JACKETT_URL || 'http://localhost:9117';
const JACKETT_API_KEY = process.env.JACKETT_API_KEY || '';
const OMDB_API_KEY = process.env.OMDB_API_KEY || '';
const PORT = parseInt(process.env.PORT || '7000');

const builder = new addonBuilder({
  id: 'pt.belchiorg.stremio-addon',
  version: '1.0.0',
  name: 'PT-PT Torrents',
  description: 'Searches PT-PT torrents via Jackett',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt'],
});

async function getTitle(imdbId, type) {
  if (!OMDB_API_KEY) return null;
  const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.Response === 'True' ? data.Title : null;
}

async function searchJackett(query) {
  const url =
    `${JACKETT_URL}/api/v2.0/indexers/all/results` +
    `?apikey=${encodeURIComponent(JACKETT_API_KEY)}` +
    `&Query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { timeout: 10000 });
  const data = await res.json();
  return (data.Results || [])
    .filter(r => r.InfoHash || r.MagnetUri)
    .map(r => ({
      title: r.Title,
      infoHash: r.InfoHash ? r.InfoHash.toLowerCase() : extractInfoHash(r.MagnetUri),
      seeders: r.Seeders || 0,
      size: r.Size,
    }))
    .filter(r => r.infoHash);
}

function extractInfoHash(magnet) {
  if (!magnet) return null;
  const match = magnet.match(/btih:([a-fA-F0-9]{40})/i);
  return match ? match[1].toLowerCase() : null;
}

function formatSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? ` ${gb.toFixed(1)} GB` : ` ${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

builder.defineStreamHandler(async ({ type, id }) => {
  const imdbId = id.split(':')[0]; // strip season/episode for series
  const title = await getTitle(imdbId, type);
  if (!title) {
    console.error(`Could not resolve title for ${imdbId}`);
    return { streams: [] };
  }

  const queries = [
    `${title} legendado português`,
    `${title} PT-PT`,
    `${title} portuguese`,
  ];

  const seen = new Set();
  const results = [];

  for (const query of queries) {
    try {
      const hits = await searchJackett(query);
      for (const h of hits) {
        if (!seen.has(h.infoHash)) {
          seen.add(h.infoHash);
          results.push(h);
        }
      }
    } catch (err) {
      console.error(`Jackett query failed for "${query}":`, err.message);
    }
  }

  const streams = results
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, 8)
    .map(r => ({
      name: 'PT-PT',
      title: `${r.title}\n🌱 ${r.seeders}${formatSize(r.size)}`,
      infoHash: r.infoHash,
    }));

  return { streams };
});

serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Addon running at http://localhost:${PORT}/manifest.json`);
