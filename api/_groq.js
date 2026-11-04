// Shared helpers for the Groq-backed API routes (Vercel Functions).
// The key is read on the server only and never sent to the browser.
// Set GROQ_API_KEY in Vercel → Project → Settings → Environment Variables.

export const getGroqKey = () => (process.env.GROQ_API_KEY || '').trim();

// Text models tried in order. Groq retires models from time to time; if one is gone
// (model_not_found) the next one is used. GROQ_TEXT_MODEL in Vercel can put another first.
export const TEXT_MODELS = [process.env.GROQ_TEXT_MODEL, 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b']
  .filter((m, i, all) => m && all.indexOf(m) === i);

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

// Remarks are often typed in CAPITALS; lower-case words read better as Telugu-English,
// but words with digits (CD505, 5000) are kept exactly as typed.
const prepareInput = (text) => text.split(/(\s+)/).map(w => (/\d/.test(w) ? w : w.toLowerCase())).join('');

const cleanOutput = (text) => String(text || '')
  .replace(/<think>[\s\S]*?<\/think>/gi, '')
  .trim()
  .replace(/^["'“”]+|["'“”]+$/g, '')
  .trim();

/** Convert any English / Telugu-English text to Telugu script. Returns the original text if nothing to convert. */
export const convertToTelugu = async (text, key) => {
  const input = String(text || '').trim();
  if (!input || !/[A-Za-z]/.test(input)) return input;

  let lastErr = null;
  for (const model of TEXT_MODELS) {
    const body = {
      model,
      temperature: 0,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: TELUGU_SYSTEM_PROMPT },
        { role: 'user', content: prepareInput(input) },
      ],
    };
    if (model.includes('gpt-oss')) body.reasoning_effort = 'low';

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      const data = await resp.json();
      return cleanOutput(data?.choices?.[0]?.message?.content) || input;
    }

    const detail = await resp.text().catch(() => '');
    lastErr = new Error(`Telugu conversion failed (HTTP ${resp.status})`);
    lastErr.status = resp.status;
    lastErr.detail = detail.slice(0, 300);
    // Only move to the next model when this one is retired / not available
    if (!/model_not_found|decommissioned|does not exist/i.test(detail)) break;
  }
  throw lastErr || new Error('Telugu conversion failed');
};
