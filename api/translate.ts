import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

/** CORS */
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** 특수 아포스트로피 통일 */
function unifyApostrophe(s: string) {
  return s?.replace(/[\u2018\u2019\u02BC\u02BB]/g, "'");
}

/** Uzbek Cyrillic -> Latin (Lotin alifbosi) transliteration */
function cyrToLatin(input: string) {
  if (!input) return input;
  let s = input;

  // 2글자(합자) 먼저
  s = s
    .replace(/Ч/g, 'Ch').replace(/ч/g, 'ch')
    .replace(/Ш/g, 'Sh').replace(/ш/g, 'sh')
    .replace(/Ю/g, 'Yu').replace(/ю/g, 'yu')
    .replace(/Я/g, 'Ya').replace(/я/g, 'ya')
    .replace(/Ё/g, 'Yo').replace(/ё/g, 'yo');

  // 1글자 매핑
  const map: Record<string, string> = {
    'Қ': 'Q',  'қ': 'q',
    'Ғ': "G'", 'ғ': "g'",
    'Ў': "O'", 'ў': "o'",
    'Ҳ': 'H',  'ҳ': 'h',
    'Й': 'Y',  'й': 'y',
    'Ц': 'Ts', 'ц': 'ts',
    'Щ': 'Sh', 'щ': 'sh',
    'Э': 'E',  'э': 'e',
    'Ъ': "'",  'ъ': "'",
    'Ь': '',   'ь': '',
    'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v',
    'Г': 'G', 'г': 'g', 'Д': 'D', 'д': 'd', 'Е': 'E', 'е': 'e',
    'Ж': 'J', 'ж': 'j', 'З': 'Z', 'з': 'z', 'И': 'I', 'и': 'i',
    'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'М': 'M', 'м': 'm',
    'Н': 'N', 'н': 'n', 'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p',
    'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't',
    'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'X', 'х': 'x'
  };

  s = s.split('').map(ch => map[ch] ?? ch).join('');

  // 조합형 o‘/g‘ 변형(혹시 남아있을 수 있는 다양한 기호들을 ')
  s = s.replace(/o[\u02BB\u02BC]/gi, "o'")
       .replace(/g[\u02BB\u02BC]/gi, "g'");
  return unifyApostrophe(s);
}

/** 라틴을 ASCII 근사치로(최소 손실) */
function toAsciiUzbek(s: string) {
  if (!s) return s;
  let t = unifyApostrophe(s)
    .replace(/ç/g, "ch").replace(/Ç/g, "Ch")
    .replace(/ş/g, "sh").replace(/Ş/g, "Sh")
    .replace(/ğ/g, "g").replace(/Ğ/g, "G")
    .replace(/ı/g, "i").replace(/İ/g, "I")
    .replace(/á/g, "a").replace(/Á/g, "A")
    .replace(/é/g, "e").replace(/É/g, "E")
    .replace(/í/g, "i").replace(/Í/g, "I")
    .replace(/ó/g, "o").replace(/Ó/g, "O")
    .replace(/ú/g, "u").replace(/Ú/g, "U")
    .replace(/o[\u02BB\u02BC]/gi, "o'")
    .replace(/g[\u02BB\u02BC]/gi, "g'");
  // 남은 비ASCII는 ?로 대체(콘솔/메모장 호환 목적)
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
  if (req.method === 'GET')     return res.status(200).send('ok');
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // 1) 토큰 검사(있을 때만)
    const expectedToken = process.env.CLIENT_TOKEN;
    if (expectedToken) {
      const auth = String(req.headers['authorization'] || '');
      const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (incoming !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    // 2) 키 확인
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    // 3) 바디 파싱
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    // ================= (A) 번역 모드 =================
    if (typeof body.text === 'string' && typeof body.targetLang === 'string') {
      const text: string = body.text;
      const targetLang: string = body.targetLang || 'Uzbek (Latin)';

      const systemPrompt = `
You are a professional translator into ${targetLang}.
- Output MUST be in Uzbek Latin alphabet (Lotin alifbosi), NOT Cyrillic.
- Preserve meaning, tone, punctuation, and line breaks.
- Keep code/JSON/placeholders ({name}, {{var}}, %s) exactly as-is.
- Return ONLY the translated text (no explanations).
`.trim();

      const payload = {
        model: body.model || DEFAULT_MODEL,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: text },
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
      const translatedRaw: string =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.message ??
        '';

      // 키릴로 내려와도 라틴으로 강제 변환
      const result_latin = cyrToLatin(String(translatedRaw ?? ''));
      const result_ascii = toAsciiUzbek(result_latin);
      const result_b64   = toBase64Utf8(result_latin);

      return res.status(200).json({
        ok: true,
        mode: 'translate',
        targetLang,
        result: result_latin,   // 라틴 원문
        result_ascii,           // ASCII 호환
        result_b64              // 라틴 원문(Base64)
      });
    }

    // ================= (B) 프록시 모드 =================
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
