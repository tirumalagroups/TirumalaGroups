/**
 * Convert typed remarks (English or Telugu written in English letters) to Telugu script.
 *
 * Uses the server route /api/telugu, which keeps the Groq key on the server.
 * For local development only (no /api server), a VITE_GROQ_API_KEY in .env.local is used directly.
 */

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

/** True when the text still has English letters that should become Telugu. */
export const hasEnglishLetters = (text: string): boolean => /[A-Za-z]/.test(text || '');

export const convertTextToTelugu = async (text: string): Promise<string> => {
  const input = (text || '').trim();
  if (!input || !hasEnglishLetters(input)) return input;

  let serverError = '';
  try {
    const resp = await fetch('/api/telugu', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: input }),
    });
    const isJson = resp.headers.get('content-type')?.includes('application/json');
    if (isJson) {
      const data = await resp.json();
      if (resp.ok && typeof data.text === 'string') return data.text.trim() || input;
      serverError = data.error || `Server HTTP ${resp.status}`;
    } else {
      serverError = `Server route unavailable (HTTP ${resp.status})`;
    }
  } catch (e: any) {
    serverError = e?.message || 'Server connection failed';
  }

  // Local development fallback
  const devKey = ((import.meta.env.VITE_GROQ_API_KEY as string) || '').trim();
  if (devKey.length > 10) {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${devKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        max_tokens: 600,
        messages: [
          { role: 'system', content: TELUGU_SYSTEM_PROMPT },
          { role: 'user', content: input.toLowerCase() },
        ],
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const out = (data?.choices?.[0]?.message?.content || '').trim().replace(/^["'“”]+|["'“”]+$/g, '');
      return out || input;
    }
    serverError = `Telugu conversion failed (HTTP ${resp.status})`;
  }

  throw new Error(serverError || 'Telugu conversion is not available');
};
