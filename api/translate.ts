import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch'; // Vercel 환경에서 fetch를 명시적으로 import (node-fetch 사용)

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const TRANSLATION_TEMPERATURE = 0; // 번역은 결정론적이어야 하므로 0으로 고정

/**
 * CORS 헤더 설정
 * 환경 변수 ALLOWED_ORIGINS가 있으면 해당 오리진만 허용, 없으면 '*'
 */
function setCors(res: VercelResponse) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  if (allowedOrigins) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * 특수 아포스트로피(U+2018, U+2019), 모디파이어 레터 아포스트로피(U+02BC, U+02BB)를 일반 아포스트로피(')로 통일
 * 이는 ASCII 호환성을 위한 것이며, 우즈벡어 표준 라틴 알파벳 'oʻ'/'gʻ'를 사용하려면 이 함수를 조정해야 합니다.
 * 여기서는 OpenAI 출력의 일관성을 위해 일단 일반 아포스트로피로 통일하되,
 * `cyrToLatin`에서 'Oʻ'와 'Gʻ'로 변환한 후에는 이들이 유지되도록 `unifyApostrophe`를 좀 더 정밀하게 적용합니다.
 */
function unifyApostrophe(s: string) {
  if (!s) return s;
  // 표준 우즈벡 라틴 알파벳의 ʻ (U+02BB), ʼ (U+02BC)를 유지하거나 복원
  // 그러나 LLM이 일반 아포스트로피를 사용할 가능성이 높아 일단 통일합니다.
  // 이 함수는 주로 LLM이 출력한 다양한 아포스트로피를 정규화하는 데 사용됩니다.
  return s.replace(/[\u2018\u2019]/g, "'") // 굽은 따옴표
          .replace(/[\u02BB\u02BC]/g, "ʼ"); // Modifier letter apostrophe (U+02BC)로 통일 (표준에 더 가깝게)
}

/** Uzbek Cyrillic -> Latin (Lotin alifbosi) transliteration */
function cyrToLatin(input: string) {
  if (!input) return input;
  let s = input;

  // 2글자(합자) 먼저 - 표준 우즈벡 라틴 알파벳 표기
  s = s
    .replace(/Ч/g, 'Ch').replace(/ч/g, 'ch')
    .replace(/Ш/g, 'Sh').replace(/ш/g, 'sh')
    .replace(/Ю/g, 'Yu').replace(/ю/g, 'yu')
    .replace(/Я/g, 'Ya').replace(/я/g, 'ya')
    .replace(/Ё/g, 'Yo').replace(/ё/g, 'yo')
    .replace(/Ц/g, 'Ts').replace(/ц/g, 'ts') // 러시아어 차용어에서 주로 사용, 우즈벡어에서는 's' 또는 'ch'로 대체되기도 함
    .replace(/Щ/g, 'Sh').replace(/щ/g, 'sh'); // 러시아어 차용어에서 주로 사용

  // 1글자 매핑 - 표준 우즈벡 라틴 알파벳 표기
  const map: Record<string, string> = {
    'Қ': 'Q',  'қ': 'q',
    'Ғ': "Gʻ", 'ғ': "gʻ", // U+02BB modifier letter right half ring
    'Ў': "Oʻ", 'ў': "oʻ", // U+02BB modifier letter right half ring
    'Ҳ': 'H',  'ҳ': 'h',
    'Й': 'Y',  'й': 'y',
    'Э': 'E',  'э': 'e',
    'Ъ': 'ʼ',  'ъ': 'ʼ', // U+02BC modifier letter apostrophe
    'Ь': '',   'ь': '',   // 연음 부호, 라틴어에서는 사용 안 함
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

  // 조합형 o‘/g‘ 변형 → oʻ / gʻ (U+02BB로 통일)
  s = s.replace(/o[\u02BB\u02BC]/gi, "oʻ")
       .replace(/g[\u02BB\u02BC]/gi, "gʻ");
  
  return unifyApostrophe(s); // 최종적으로 아포스트로피 한번 더 통일 (U+02BC)
}

/** 라틴을 ASCII 근사치(콘솔/메모장 호환) */
function toAsciiUzbek(s: string) {
  if (!s) return s;
  let t = s
    .replace(/ʻ/g, "'") // U+02BB를 일반 아포스트로피로
    .replace(/ʼ/g, "'") // U+02BC를 일반 아포스트로피로
    .replace(/ç/g, "ch").replace(/Ç/g, "Ch")
    .replace(/ş/g, "sh").replace(/Ş/g, "Sh")
    .replace(/ğ/g, "g").replace(/Ğ/g, "G")
    .replace(/ı/g, "i").replace(/İ/g, "I")
    // 발음 기호가 있는 라틴 문자 (우즈벡어에서는 거의 사용 안 함, 안전을 위해 추가)
    .replace(/á/g, "a").replace(/Á/g, "A")
    .replace(/é/g, "e").replace(/É/g, "E")
    .replace(/í/g, "i").replace(/Í/g, "I")
    .replace(/ó/g, "o").replace(/Ó/g, "O")
    .replace(/ú/g, "u").replace(/Ú/g, "U");

  // 남은 비ASCII는 ?로 대체(가시성 목적)
  // [^\x20-\x7E]는 ASCII 공백(0x20)부터 ~ (0x7E)까지의 문자를 제외한 모든 문자를 의미
  t = t.replace(/[^\x20-\x7E]/g, "?");
  return t;
}

function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}

/** 타겟 언어 정규화(사람친화 → 코드) */
function normalizeTargetLang(input?: string) {
  const raw = (input || '').trim().toLowerCase();
  const uzLatnAliases = [
    'uz-latn','uz_latn','uz latn',
    'uzbek (latin)','uzbek latin','uzbek-latin','uzbek_latin','uzbek latin alphabet',
    'o\'zbek lotin','ozbek lotin','oʻzbek lotin'
  ];
  if (uzLatnAliases.includes(raw)) return { code: 'uz-Latn', label: 'Uzbek (Latin)' };

  return { code: 'uz-Latn', label: 'Uzbek (Latin)' }; // 기본값
}

/** 우즈벡 라틴/ASCII 화이트리스트 검사: 표준 우즈벡 라틴 문자와 ASCII 구두점만 허용 */
function looksLikeUzbekLatin(s: string) {
  if (!s) return false;
  // A-Z a-z 숫자 공백, 기본 구두점, 우즈벡 라틴어의 'ʻ' (U+02BB)와 'ʼ' (U+02BC)
  const re = /^[A-Za-z0-9\s\.\,\;\:\'\"\!\?\-\(\)\/\`\u02BB\u02BC]+$/;
  return re.test(s);
}

/** LLM의 사과/설명/불필요 문장 패턴(우즈벡/영어/한국어) 검사 */
function looksLikeApologyOrMeta(s: string) {
  const t = s.trim().toLowerCase();
  // 우즈벡어 사과/메타 문장, 영어 사과/메타 문장, 한국어 사과/메타 문장 추가
  return /^(kechirasiz|uzr|sorry|i (cannot|can't)|as an ai|men (tushunmadim|bila olmayman)|죄송합니다|번역할 수 없습니다|저는 ai 모델이므로)/.test(t);
}

/**
 * OpenAI API 호출 헬퍼
 */
async function callOpenAI(apiKey: string, payload: any): Promise<any> {
  const resp = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error('OpenAI API Error:', resp.status, errText); // 서버 로그에 상세 에러 기록
    throw new Error(`OpenAI API request failed with status ${resp.status}`);
  }

  return resp.json();
}

/**
 * 번역 모드 처리 함수
 */
async function handleTranslation(req: VercelRequest, res: VercelResponse, apiKey: string) {
  const body =
    typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

  const sourceText: string = body.text;
  if (!sourceText || typeof sourceText !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "text" for translation.' });
  }

  const { code: targetCode, label: targetLabel } = normalizeTargetLang(body.targetLang);

  // 한국어 -> 우즈벡어(라틴) 번역에 특화된 시스템 프롬프트
  const systemPrompt = `
You are a highly skilled professional translator specializing in Korean to Uzbek (Latin).
Your task is to translate the USER's Korean text into natural and accurate Uzbek, strictly using the Uzbek Latin alphabet.

**Rules:**
1.  **Output ONLY the translated text.** Do not include any explanations, apologies, introductions, or extra sentences.
2.  **Use ONLY the standard Uzbek Latin alphabet (e.g., Oʻ, Gʻ, Ch, Sh).** Do not use Cyrillic, Arabic, Korean, or any other script.
3.  **Preserve all placeholders, code snippets, punctuation, and line breaks** as they appear in the original text.
4.  **Translate literally but naturally**, ensuring the meaning and nuance are accurately conveyed in Uzbek.
5.  If the input is already in Uzbek Latin, simply return it as is, ensuring it conforms to standard Uzbek Latin script.
`.trim();

  const payload = {
    model: body.model || DEFAULT_MODEL,
    temperature: TRANSLATION_TEMPERATURE,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: sourceText },
    ],
    // response_format: { type: 'text' } // OpenAI가 가끔 따르지 않는 경우가 있어 주석 처리
  };

  let translatedRaw: string;

  try {
    const data = await callOpenAI(apiKey, payload);
    translatedRaw = data?.choices?.[0]?.message?.content ?? '';
  } catch (error: any) {
    console.error('Initial OpenAI translation failed:', error);
    return res.status(500).json({ error: 'Failed to get translation from AI service.' });
  }

  // 1차 변환 및 정규화 (키릴릭 -> 라틴, 아포스트로피 통일)
  let result_latin = cyrToLatin(translatedRaw).trim();

  // 품질검사: LLM이 불필요한 메타 메시지를 포함하거나, 여전히 비라틴 문자가 포함된 경우 재시도
  const needsRetry =
    looksLikeApologyOrMeta(result_latin) ||
    !looksLikeUzbekLatin(result_latin);

  if (needsRetry) {
    console.warn('Translation retry needed. Original output:', translatedRaw);
    const retrySystemPrompt = `
You previously provided a translation that included non-Uzbek Latin characters or extra text.
**Translate the Korean text below into Uzbek (Latin) ONLY.**
Strictly use the standard Uzbek Latin alphabet.
Output ONLY the translated text. No explanations, no apologies, no extra sentences.
Ensure the translation is natural and accurate.
`.trim();

    const retryPayload = {
      model: body.model || DEFAULT_MODEL,
      temperature: TRANSLATION_TEMPERATURE,
      messages: [
        { role: 'system', content: retrySystemPrompt },
        { role: 'user',   content: sourceText }
      ],
    };

    try {
      const retryData = await callOpenAI(apiKey, retryPayload);
      const retryTranslated = retryData?.choices?.[0]?.message?.content ?? '';
      const fixedResult = cyrToLatin(retryTranslated).trim();
      if (fixedResult && !looksLikeApologyOrMeta(fixedResult)) { // 재시도 결과가 유효하면 사용
        result_latin = fixedResult;
      } else {
        console.warn('Retry translation was also problematic or empty.');
      }
    } catch (retryError: any) {
      console.error('OpenAI retry translation failed:', retryError);
      // 재시도가 실패해도 초기 번역 결과(최대한 정제된)를 반환
    }
  }

  const result_ascii = toAsciiUzbek(result_latin);
  const result_b64   = toBase64Utf8(result_latin);

  return res.status(200).json({
    ok: true,
    mode: 'translate',
    targetLang: targetLabel,
    targetLangCode: targetCode,
    result: result_latin,      // 표준 우즈벡 라틴 알파벳 (메인)
    result_ascii,              // ASCII 호환 (보조 출력)
    result_b64                 // 라틴 (Base64)
  });
}

/**
 * 프록시 모드 처리 함수
 */
async function handleProxy(req: VercelRequest, res: VercelResponse, apiKey: string) {
  const body =
    typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid "messages" for proxy mode.' });
  }

  const payload = {
    model: body.model || DEFAULT_MODEL,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    messages: body.messages,
  };

  try {
    const data = await callOpenAI(apiKey, payload);
    return res.status(200).json({ ok: true, mode: 'proxy', data });
  } catch (error: any) {
    console.error('OpenAI proxy request failed:', error);
    return res.status(500).json({ error: 'Failed to get response from AI service.' });
  }
}

// ======================================
// 메인 핸들러
// ======================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET')     return res.status(200).send('ok');
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // 1) 클라이언트 토큰 검사 (환경 변수가 설정되어 있을 경우에만)
    const expectedToken = process.env.CLIENT_TOKEN;
    if (expectedToken) {
      const auth = String(req.headers['authorization'] || '');
      const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (incoming !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized: Invalid client token.' });
      }
    }

    // 2) OpenAI API 키 확인
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY is not set in environment variables.');
      return res.status(500).json({ error: 'Server configuration error: OpenAI API Key is missing.' });
    }

    // 3) 바디 파싱 (Vercel은 보통 자동으로 파싱하지만, 안전을 위해 직접 처리)
    let body: any;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }

    // ================= (A) 번역 모드 =================
    if (typeof body.text === 'string' && typeof body.targetLang === 'string') {
      await handleTranslation(req, res, apiKey);
    }
    // ================= (B) 프록시 모드 =================
    else if (Array.isArray(body.messages)) {
      await handleProxy(req, res, apiKey);
    }
    // ================= (C) 잘못된 요청 =================
    else {
      return res.status(400).json({
        error: 'Bad Request',
        hint: 'Please provide either { text: string, targetLang: string } for translation, or { messages: Array<any> } for proxy.',
      });
    }

  } catch (err: any) {
    console.error('Unhandled server error:', err); // 모든 잡히지 않은 에러 로깅
    return res.status(500).json({ ok: false, error: 'An unexpected server error occurred.' });
  }
}