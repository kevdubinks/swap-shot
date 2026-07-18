import { Redis } from '@upstash/redis';

// Classement SWAP SHOT — fonction serverless Vercel + Upstash Redis.
// Tableaux : waves / nomove (meilleur score, ne fait que monter) et
// wins (victoires en duel, incrémental). « general » est agrégé à la lecture :
// meilleurs scores + 1000 points par victoire.
const BOARDS = ['waves', 'nomove', 'wins'];
const PSEUDO_RE = /^[A-Za-z0-9À-ÿ_\-]{2,16}$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let redis;
  try {
    redis = Redis.fromEnv();
  } catch {
    return res.status(503).json({ error: 'storage_not_configured' });
  }

  try {
    if (req.method === 'GET') {
      const board = String(req.query.board || 'general');
      if (board === 'general') {
        const [waves, nomove, wins] = await Promise.all(
          BOARDS.map((b) => redis.zrange(`board:${b}`, 0, 99, { rev: true, withScores: true }))
        );
        const agg = new Map();
        const addAll = (flat, mult) => {
          for (let i = 0; i < flat.length; i += 2) {
            const p = String(flat[i]);
            agg.set(p, (agg.get(p) || 0) + Number(flat[i + 1]) * mult);
          }
        };
        addAll(waves, 1);
        addAll(nomove, 1);
        addAll(wins, 1000);
        const rows = [...agg.entries()]
          .map(([pseudo, score]) => ({ pseudo, score: Math.round(score) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 20);
        return res.status(200).json({ board, rows });
      }
      if (!BOARDS.includes(board)) return res.status(400).json({ error: 'bad_board' });
      const flat = await redis.zrange(`board:${board}`, 0, 19, { rev: true, withScores: true });
      const rows = [];
      for (let i = 0; i < flat.length; i += 2) rows.push({ pseudo: String(flat[i]), score: Number(flat[i + 1]) });
      return res.status(200).json({ board, rows });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const pseudo = body.pseudo;
      const token = body.token;
      if (typeof pseudo !== 'string' || !PSEUDO_RE.test(pseudo)) return res.status(400).json({ error: 'bad_pseudo' });
      if (typeof token !== 'string' || token.length < 8 || token.length > 64) return res.status(400).json({ error: 'bad_token' });

      // « compte » léger : le premier jeton qui revendique un pseudo le possède
      const key = 'user:' + pseudo.toLowerCase();
      const created = await redis.set(key, token, { nx: true, ex: 60 * 60 * 24 * 365 });
      if (created === null) {
        const owner = await redis.get(key);
        if (String(owner) !== token) return res.status(403).json({ error: 'pseudo_taken' });
      }
      if (body.claim) return res.status(200).json({ ok: true, claimed: pseudo });

      const board = body.board;
      if (!BOARDS.includes(board)) return res.status(400).json({ error: 'bad_board' });
      const score = Number(body.score);
      if (!Number.isFinite(score) || score < 0 || score > 10000000) return res.status(400).json({ error: 'bad_score' });

      if (board === 'wins') await redis.zincrby('board:wins', 1, pseudo);
      else await redis.zadd(`board:${board}`, { gt: true }, { score, member: pseudo });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e && e.message) });
  }
}
