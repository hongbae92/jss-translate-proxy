import type { VercelRequest, VercelResponse } from '@vercel/node';

const ORIGINS = (process.env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

function cors(res: VercelResponse, origin?: string) {
  if (origin && ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res, req.headers.origin);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const clientToken = req.headers['x-client-token'];
  if (process.env.CLIENT_TOKEN && clientToken !== process.env.CLIENT_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { texts, target = 'uz-latin', mode = 'strict' } = req.body || {};
  if (!Array.isArray(texts) || !texts.length) return res.status(400).json({ error: 'texts[] required' });

  const lang = target === 'uz-cyrillic' ? 'Uzbek (Cyrillic)' : target === 'en' ? 'English' : 'Uzbek (Latin)';
  const system =
    mode === 'strict'
      ? `You are a professional translator. Translate Korean UI/UX specification text into ${lang}. Preserve bullets, numbering, punctuation, and line breaks exactly. Keep meaning; avoid paraphrasing. Return ONLY a JSON array of strings, same length and order as input.`
      : `Translate Korean into ${lang}. Return a JSON array of strings, same length and order.`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(texts) }
      ],
      temperature: 0.2
    })
  });

  if (!r.ok) return res.status(r.status).json({ error: 'OpenAI error', detail: await r.text() });

  const data = await r.json();
  let content = data?.choices?.[0]?.message?.content ?? '';
  let out: string[];
  try {
    const parsed = JSON.parse(content);
    out = Array.isArray(parsed) ? parsed : parsed.result;
  } catch {
    const s = content.indexOf('['), e = content.lastIndexOf(']');
    out = JSON.parse(content.slice(s, e + 1));
  }
  if (!Array.isArray(out) || out.length !== texts.length) return res.status(500).json({ error: 'Invalid length' });

  return res.status(200).json({ texts: out });
}
