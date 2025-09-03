import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      return res.status(200).send('ok'); // 헬스체크용
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // PowerShell에서 body가 문자열로 오는 경우 대비
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = body.message ?? null;

    // 나중에 OpenAI 연동시 여기에 추가하면 됨
    // const apiKey = process.env.OPENAI_API_KEY;

    return res.status(200).json({ ok: true, echo: message });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}