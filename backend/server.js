const path = require('path');
const crypto = require('crypto');

const express = require('express');
const cors = require('cors');

const { openDb, queryAll } = require('./db');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

function nowIso() {
  return new Date().toISOString();
}

function jsonSafe(obj) {
  return JSON.stringify(obj ?? {});
}

(async function main() {
  const { db } = await openDb();
  try {
    db.run('ALTER TABLE sessions ADD COLUMN selected_domain TEXT');
  } catch (error) {
    // ignore if column already exists
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Serve the frontend
  const rootDir = path.join(__dirname, '..');
  app.use(express.static(rootDir));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: nowIso() });
  });

  app.get('/api/ollama/health', async (_req, res) => {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      if (!response.ok) {
        return res.status(502).json({ ok: false, error: `ollama status ${response.status}` });
      }
      const data = await response.json();
      const models = Array.isArray(data?.models) ? data.models.map((m) => m?.name).filter(Boolean) : [];
      res.json({ ok: true, base_url: OLLAMA_BASE_URL, default_model: OLLAMA_MODEL, models });
    } catch (error) {
      res.status(502).json({ ok: false, error: error?.message || 'Unable to reach Ollama' });
    }
  });

  app.post('/api/ollama/chat', async (req, res) => {
    const model = String(req.body?.model || OLLAMA_MODEL);
    const prompt = String(req.body?.prompt || '').trim();
    const system = String(req.body?.system || '').trim();
    const options = req.body?.options && typeof req.body.options === 'object' ? req.body.options : undefined;

    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          ...(options ? { options } : {}),
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: prompt }
          ]
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(502).json({
          error: data?.error || `ollama status ${response.status}`,
          model,
          base_url: OLLAMA_BASE_URL
        });
      }

      res.json({
        ok: true,
        model,
        base_url: OLLAMA_BASE_URL,
        content: data?.message?.content || ''
      });
    } catch (error) {
      res.status(502).json({
        error: error?.message || 'Unable to reach Ollama',
        model,
        base_url: OLLAMA_BASE_URL
      });
    }
  });

  app.post('/api/sessions', (req, res) => {
    const id = crypto.randomUUID();
    const created_at = nowIso();
    const selected_domain = String(req.body?.selected_domain ?? '');
    const target_role = String(req.body?.target_role ?? '');
    const question_type = String(req.body?.question_type ?? '');

    db.run(
      'INSERT INTO sessions (id, created_at, selected_domain, target_role, question_type) VALUES (?, ?, ?, ?, ?)',
      [id, created_at, selected_domain, target_role, question_type]
    );

    res.json({ id, created_at });
  });

  app.post('/api/events', (req, res) => {
    const id = crypto.randomUUID();
    const created_at = nowIso();
    const session_id = String(req.body?.session_id ?? '');
    const kind = String(req.body?.kind ?? '');
    const payload = req.body?.payload ?? {};

    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    if (!kind) return res.status(400).json({ error: 'kind required' });

    const sessionExists = queryAll(db, 'SELECT id FROM sessions WHERE id = ? LIMIT 1', [session_id]).length > 0;
    if (!sessionExists) return res.status(404).json({ error: 'session not found' });

    db.run(
      'INSERT INTO events (id, session_id, created_at, kind, payload_json) VALUES (?, ?, ?, ?, ?)',
      [id, session_id, created_at, kind, jsonSafe(payload)]
    );

    res.json({ id, created_at });
  });

  app.get('/api/sessions/:id', (req, res) => {
    const id = String(req.params.id);
    const sessions = queryAll(db, 'SELECT * FROM sessions WHERE id = ? LIMIT 1', [id]);
    if (!sessions.length) return res.status(404).json({ error: 'session not found' });
    const events = queryAll(db, 'SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC', [id]);
    res.json({ session: sessions[0], events });
  });

  app.get('/api/sessions/:id/summary', (req, res) => {
    const id = String(req.params.id);
    const events = queryAll(db, 'SELECT kind, payload_json FROM events WHERE session_id = ? ORDER BY created_at ASC', [id]);
    if (!events.length) return res.status(404).json({ error: 'no events for session' });

    // Aggregate "missed" items when present in payload
    const counts = {};
    for (const ev of events) {
      let payload;
      try {
        payload = JSON.parse(ev.payload_json || '{}');
      } catch {
        payload = {};
      }
      const missed = Array.isArray(payload?.missed) ? payload.missed : [];
      for (const item of missed) {
        const key = String(item);
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue, count]) => ({ issue, count }));

    res.json({ session_id: id, top_gaps: top });
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.join(rootDir, 'indexx.html'));
  });

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`SkillShift server running at http://localhost:${PORT}`);
  });
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
