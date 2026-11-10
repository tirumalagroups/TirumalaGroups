// POST /api/telugu  { "text": "payment repu istadu" }  ->  { "text": "పేమెంట్ రేపు ఇస్తాడు" }
// Converts typed English or Telugu-English remarks into Telugu script.
import { getGroqKey, json, convertToTelugu } from './_groq.js';
import { requireSession } from './_auth.js';

export async function POST(request) {
  // Only for people logged in to the app (the Groq key is paid for)
  const auth = await requireSession(request);
  if (auth.response) return auth.response;
  const key = getGroqKey();
  if (!key) return json({ error: 'Telugu typing is not set up: GROQ_API_KEY is missing on the server.' }, 500);

  let text = '';
  try {
    const body = await request.json();
    text = String(body?.text || '');
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  if (text.length > 2000) return json({ error: 'Text is too long' }, 400);

  try {
    return json({ text: await convertToTelugu(text, key) });
  } catch (e) {
    console.error('[api/telugu]', e?.status, e?.detail || e?.message);
    const msg = e?.status === 401 ? 'Invalid Groq API key (HTTP 401)'
      : e?.status === 429 ? 'Groq quota / rate limit exceeded (HTTP 429)'
      : 'Could not convert to Telugu';
    return json({ error: msg }, 502);
  }
}

export function GET() {
  return json({ error: 'Use POST' }, 405);
}
