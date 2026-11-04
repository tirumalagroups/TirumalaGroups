// POST /api/transcribe  (multipart form: file = audio recording)
// Turns a voice note into Telugu text with Groq Whisper, then makes sure
// any English letters left over are converted to Telugu script.
import { getGroqKey, json, convertToTelugu } from './_groq.js';

const TRANSCRIPTION_PROMPT = 'పేమెంట్ ఇస్తాడు. రేపు కడతాను. ఫోన్ ఎత్తలేదు.';

export async function POST(request) {
  const key = getGroqKey();
  if (!key) return json({ error: 'Voice notes are not set up: GROQ_API_KEY is missing on the server.' }, 500);

  let file;
  try {
    const form = await request.formData();
    file = form.get('file');
  } catch {
    return json({ error: 'Invalid upload' }, 400);
  }
  if (!file || typeof file === 'string') return json({ error: 'No audio file received' }, 400);

  const groqForm = new FormData();
  groqForm.append('model', 'whisper-large-v3');
  groqForm.append('temperature', '0');
  groqForm.append('response_format', 'verbose_json');
  groqForm.append('language', 'te');
  groqForm.append('prompt', TRANSCRIPTION_PROMPT);
  groqForm.append('file', file, file.name || 'recording.webm');

  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: groqForm,
  });

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 300);
    console.error('[api/transcribe] Groq error', resp.status, detail);
    const msg = resp.status === 401 ? 'Invalid Groq API key (HTTP 401)'
      : resp.status === 429 ? 'Groq quota / rate limit exceeded (HTTP 429)'
      : `Transcription error (HTTP ${resp.status})`;
    return json({ error: msg }, 502);
  }

  const data = await resp.json();
  let text = (data?.text || '').trim();
  if (!text) return json({ text: '' });

  try {
    text = await convertToTelugu(text, key);
  } catch (e) {
    // Keep Whisper's text if the clean-up step fails
    console.warn('[api/transcribe] Telugu clean-up skipped:', e?.message);
  }
  return json({ text });
}

export function GET() {
  return json({ error: 'Use POST' }, 405);
}
