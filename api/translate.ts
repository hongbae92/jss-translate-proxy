import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

/** 공통: CORS 헤더 */
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Healthcheck
  if (req.method === 'GET') {
    return res.status(200).send('ok');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // ---- CLIENT_TOKEN 검증(있을 때만) ----
    const expectedToken = process.env.CLIENT_TOKEN;
    if (expectedToken) {
      const auth = String(req.headers['authorization'] || '');
      const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (incoming !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    // ---- 환경변수 확인 ----
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    // ---- 바디 파싱(PowerShell 호환) ----
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    // ===== (A) 번역 모드 =====
    // 요청 예: { "text": "안녕하세요", "targetLang": "Uzbek (Latin)" }
    if (typeof body.text === 'string' && typeof body.targetLang === 'string') {
      const text: string = body.text;
      const targetLang: string = body.targetLang; // 예: "Uzbek (Latin)" 또는 "Uzbek"

      // 우즈벡(라틴) 기본값 처리
      const target = targetLang || 'Uzbek (Latin)';

      const systemPrompt = `
You are a professional translator into ${target}.
Rules:
- Preserve original meaning, tone, formatting, punctuation, and line breaks.
- Keep code blocks, JSON, placeholders (e.g., {name}, {{var}}, %s) exactly as-is.
- Do NOT add explanations. Return ONLY the translated text.
- If the source is already in ${target}, just return it as-is.
      `.trim();

      const payload = {
        model: body.model || DEFAULT_MODEL,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
      };

      const resp = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: 'OpenAI error', detail: errText });
      }

      const data = await resp.json();
      const translated =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.message ??
        null;

      return res.status(200).json({
        ok: true,
        mode: 'translate',
        targetLang: target,
        result: translated,
      });
    }

    // ===== (B) 프록시 모드 =====
    // 요청 예: { "messages":[{role:"user",content:"Hi"}], "model":"gpt-4o-mini" }
    if (Array.isArray(body.messages)) {
      const payload = {
        model: body.model || DEFAULT_MODEL,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
        messages: body.messages,
      };

      const resp = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: 'OpenAI error', detail: errText });
      }

      const data = await resp.json();
      return res.status(200).json({ ok: true, mode: 'proxy', data });
    }

    // 형식 불일치
    return res.status(400).json({
      error: 'Bad Request',
      hint: 'Use either { text, targetLang } for translate or { messages } for proxy.',
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
