import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

/** CORS */
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** 특수 아포스트로피 통일 + 우즈벡 ASCII 근사치로 변환 */
function toAsciiUzbek(s: string) {
  if (!s) return s;
  let t = s
    // 다양한 아포스트로피 → '
    .replace(/[\u2018\u2019\u02BC\u02BB]/g, "'")
    // 흔한 라틴 확장(있을 경우 대응)
    .replace(/ç/g, "ch").replace(/Ç/g, "Ch")
    .replace(/ş/g, "sh").replace(/Ş/g, "Sh")
    .replace(/ğ/g, "g").replace(/Ğ/g, "G")
    .replace(/ı/g, "i").replace(/İ/g, "I")
    .replace(/á/g, "a").replace(/Á/g, "A")
    .replace(/é/g, "e").replace(/É/g, "E")
    .replace(/í/g, "i").replace(/Í/g, "I")
    .replace(/ó/g, "o").replace(/Ó/g, "O")
    .replace(/ú/g, "u").replace(/Ú/g, "U")
    // 우즈벡 라틴에서 자주 쓰는 oʻ, gʻ(조합형) → o', g'
    .replace(/o[\u02BB\u02BC']/gi, (m) => "o'")
    .replace(/g[\u02BB\u02BC']/gi, (m) => "g'");
  // 완전 비ASCII는 ?로 제거하지 않고 대체(최소 손실)
  t = t.replace(/[^\x20-\x7E]/g, "?");
  return t;
}

function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).send('ok');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const expectedToken = process.env.CLIENT_TOKEN;
    if (expectedToken) {
      const auth = String(req.headers['authorization'] || '');
      const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (incoming !== expectedToken) return res.status(401).json({ error: 'Unauthorized' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // ===== 번역 모드 =====
    if (typeof body.text === 'string' && typeof body.targetLang === 'string') {
      const text: string = body.text;
      const targetLang: string = body.targetLang || 'Uzbek (Latin)';

      const systemPrompt = `
You are a professional translator into ${targetLang}.
- Preserve meaning, tone, punctuation, line breaks.
- Keep code/JSON/placeholders ({name}, {{var}}, %s) as-is.
- Return ONLY the translated text.
- If input already matches ${targetLang}, just return it.
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
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: 'OpenAI error', detail: errText });
      }

      const data = await resp.json();
      const translated: string =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.message ??
        '';

      const result_raw = translated ?? '';
      const result_ascii = toAsciiUzbek(result_raw);
      const result_b64 = toBase64Utf8(result_raw);

      return res.status(200).json({
        ok: true,
        mode: 'translate',
        targetLang,
        result: result_raw,      // UTF-8 원문
        result_ascii,            // ASCII 호환 버전
        result_b64               // Base64(원문)
      });
    }

    // ===== 프록시 모드 =====
    if (Array.isArray(body.messages)) {
      const payload = {
        model: body.model || DEFAULT_MODEL,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
        messages: body.messages,
      };

      const resp = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: 'OpenAI error', detail: errText });
      }

      const data = await resp.json();
      return res.status(200).json({ ok: true, mode: 'proxy', data });
    }

    return res.status(400).json({
      error: 'Bad Request',
      hint: 'Use either { text, targetLang } for translate or { messages } for proxy.',
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
