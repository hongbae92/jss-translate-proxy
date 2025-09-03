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
    'Ж': 'J',  'ж': 'j',
    'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v',
    'Г': 'G', 'г': 'g', 'Д': 'D', 'д': 'd', 'Е': 'E', 'е': 'e',
    'З': 'Z', 'з': 'z', 'И': 'I', 'и': 'i',
    'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'М': 'M', 'м': 'm',
    'Н': 'N', 'н': 'n', 'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p',
    'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't',
    'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'X', 'х': 'x'
  };

  s = s.split('').map(ch => map[ch] ?? ch).join('');

  // 조합형 o‘/g‘ 변형 → o' / g'
  s = s.replace(/o[\u02BB\u02BC]/gi, "o'")
       .replace(/g[\u02BB\u02BC]/gi, "g'");
  return unifyApostrophe(s);
}

/** 라틴을 ASCII 근사치(콘솔/메모장 호환) */
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
  // 남은 비ASCII는 ?로 대체(가시성 목적)
  t = t.replace(/[^\x20-\x7E]/g, "?");
  return t;
}

function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}

/** CHANGED: 타겟 언어 정규화(사람친화 → 코드) */
function normalizeTargetLang(input?: string) {
  const raw = (input || '').trim().toLowerCase();
  // 우즈벡 라틴 다양한 표기 허용
  const uzLatnAliases = [
    'uz-latn','uz_latn','uz latn',
    'uzbek (latin)','uzbek latin','uzbek-latin','uzbek_latin','uzbek latin alphabet',
    'o\'zbek lotin','ozbek lotin','oʻzbek lotin'
  ];
  if (uzLatnAliases.includes(raw)) return { code: 'uz-Latn', label: 'Uzbek (Latin)' };

  // (필요 시 여기서 다른 언어도 추가 가능)
  return { code: 'uz-Latn', label: 'Uzbek (Latin)' }; // 기본값
}

/** CHANGED: 우즈벡 라틴/ASCII 화이트리스트 검사 */
function looksLikeUzbekLatin(s: string) {
  if (!s) return false;
  // 허용: A-Z a-z 숫자 공백, 기본 구두점, 아포스트로피('), 우즈벡 라틴에서 쓰는 ʼ(02BC)/ʻ(02BB)
  const re = /^[A-Za-z0-9\s\.\,\;\:\'\"\!\?\-\(\)\/\u02BB\u02BC]+$/;
  return re.test(s);
}

/** CHANGED: 사과/설명/불필요 문장 패턴(우즈벡/영어) */
function looksLikeApologyOrMeta(s: string) {
  const t = s.trim().toLowerCase();
  return /^(kechirasiz|uzr|sorry|i (cannot|can't)|as an ai|men (tushunmadim|bila olmayman))/.test(t);
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
      const sourceText: string = body.text;
      const { code: targetCode, label: targetLabel } = normalizeTargetLang(body.targetLang); // CHANGED

      // CHANGED: 더 엄격한 시스템 프롬프트 + 문자셋 제약
      const systemPrompt = `
You are a professional translator.
Translate the USER text into Uzbek (Latin, ${targetCode}). Use only the Uzbek Latin alphabet and ASCII punctuation.
Rules:
- Translate literally but naturally.
- Output ONLY the translated text. No explanations or apologies.
- Do not add any extra sentences.
- Keep placeholders/code as-is and preserve punctuation/line breaks.
- Do not use Cyrillic, Arabic, or Korean characters.
`.trim();

      const payload = {
        model: body.model || DEFAULT_MODEL,
        temperature: 0, // CHANGED: 번역은 0으로 고정
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: sourceText },
        ],
        // response_format: { type: 'text' } // (필요 시 사용)
      };

      // 1차 요청
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
      let translatedRaw: string =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.message ??
        '';

      // 키릴로 내려오면 라틴으로 강제 변환 + 아포스트로피 통일
      let result_latin = unifyApostrophe(cyrToLatin(String(translatedRaw ?? ''))).trim();

      // CHANGED: 품질검사(설명문/비라틴 포함 시 재시도)
      const needsRetry =
        looksLikeApologyOrMeta(result_latin) ||
        !looksLikeUzbekLatin(result_latin);

      if (needsRetry) {
        const retry = await fetch(OPENAI_API_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: body.model || DEFAULT_MODEL,
            temperature: 0,
            messages: [
              { role: 'system', content: `
Translate to Uzbek (Latin, ${targetCode}). Output only the translation.
Use ONLY Uzbek Latin letters and ASCII punctuation.
No explanations, no apologies, no extra sentences.`.trim() },
              { role: 'user',   content: sourceText }
            ],
          }),
        });

        if (retry.ok) {
          const rj = await retry.json().catch(() => ({} as any));
          const retr = String(rj?.choices?.[0]?.message?.content ?? '');
          const fixed = unifyApostrophe(cyrToLatin(retr)).trim();
          if (fixed) result_latin = fixed;
        }
      }

      const result_ascii = toAsciiUzbek(result_latin);
      const result_b64   = toBase64Utf8(result_latin);

      return res.status(200).json({
        ok: true,
        mode: 'translate',
        targetLang: targetLabel,                 // CHANGED: 사람친화 라벨
        targetLangCode: targetCode,              // CHANGED: 코드도 함께 노출
        result: result_latin,                    // 라틴 원문 (메인)
        result_ascii,                            // ASCII 호환(보조 출력)
        result_b64                               // 라틴(Base64)
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
