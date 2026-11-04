// Shared helpers for the Groq-backed API routes (Vercel Functions).
// The key is read on the server only and never sent to the browser.
// Set GROQ_API_KEY in Vercel → Project → Settings → Environment Variables.

export const getGroqKey = () => (process.env.GROQ_API_KEY || '').trim();

export const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const TELUGU_SYSTEM_PROMPT = [
  'You convert short loan follow-up call remarks into Telugu script.',
  'Rules:',
  '- Telugu typed in English letters (e.g. "payment istadu", "repu kadatanu") -> write the same words in Telugu script ("పేమెంట్ ఇస్తాడు", "రేపు కడతాను").',
  '- Plain English sentences (e.g. "he will pay tomorrow") -> translate to simple natural Telugu ("రేపు చెల్లిస్తాడు").',
  '- Text already in Telugu script stays as it is.',
  '- Keep numbers, amounts, dates, loan numbers (like CD505) and phone numbers exactly as written.',
  '- Common English loan words people say in Telugu (payment, phone, loan, interest, call) may be written in Telugu letters (పేమెంట్, ఫోన్, లోన్).',
  '- Reply with only the converted Telugu text. No quotes, no explanation.',
].join('\n');

/** Convert any English / Telugu-English text to Telugu script. Returns the original text if nothing to convert. */
export const convertToTelugu = async (text, key) => {
  const input = String(text || '').trim();
  if (!input || !/[A-Za-z]/.test(input)) return input;

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: TEXT_MODEL,
      temperature: 0,
      max_tokens: 600,
      messages: [
        { role: 'system', content: TELUGU_SYSTEM_PROMPT },
        { role: 'user', content: input.toLowerCase() },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    const err = new Error(`Telugu conversion failed (HTTP ${resp.status})`);
    err.status = resp.status;
    err.detail = detail.slice(0, 300);
    throw err;
  }

  const data = await resp.json();
  const out = (data?.choices?.[0]?.message?.content || '').trim().replace(/^["'“”]+|["'“”]+$/g, '');
  return out || input;
};
