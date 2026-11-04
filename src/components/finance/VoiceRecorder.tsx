import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, Download, Play, Pause, AlertCircle, Mic, Square } from 'lucide-react';
import { convertTextToTelugu, hasEnglishLetters } from '../../utils/telugu';

interface VoiceRecorderProps {
  onTranscriptionCompleted: (text: string) => void;
  disabled?: boolean;
}

export type RecordingStatus = 'IDLE' | 'RECORDING' | 'UPLOADING' | 'TRANSCRIBING' | 'ERROR' | 'SUCCESS';

// Callback remarks are transcribed into Telugu script.
// The prompt is a short Telugu sample that keeps Whisper writing Telugu letters
// (English words like "payment" come out as "పేమెంట్").
const TRANSCRIPTION_LANGUAGE = 'te';
const TRANSCRIPTION_PROMPT = 'పేమెంట్ ఇస్తాడు. రేపు కడతాను. ఫోన్ ఎత్తలేదు.';

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onTranscriptionCompleted, disabled }) => {
  const [status, setStatus] = useState<RecordingStatus>('IDLE');
  const [statusText, setStatusText] = useState<string>('');
  const [recordingTime, setRecordingTime] = useState<number>(0);

  // Audio Preservation States (Step 10 Fallback)
  const [savedAudioBlob, setSavedAudioBlob] = useState<Blob | null>(null);
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Max duration: 60 seconds
  const MAX_RECORDING_TIME = 60;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (savedAudioUrl) {
        URL.revokeObjectURL(savedAudioUrl);
      }
    };
  }, [savedAudioUrl]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const startRecording = async () => {
    setErrorMessage(null);
    setSavedAudioBlob(null);
    if (savedAudioUrl) {
      URL.revokeObjectURL(savedAudioUrl);
      setSavedAudioUrl(null);
    }

    try {
      // Step 1: Microphone permission & stream acquisition
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let options: MediaRecorderOptions = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options = { mimeType: 'audio/webm' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options = { mimeType: 'audio/mp4' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options = { mimeType: 'audio/wav' };
      }
      options.audioBitsPerSecond = 128000;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Step 1 Audit: Blob creation and size validation
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        // Stop microphone tracks
        stream.getTracks().forEach(track => track.stop());

        const duration = (Date.now() - startTimeRef.current) / 1000;
        console.log(`[AUDIO RECORDING LOG] Duration: ${duration.toFixed(1)}s | Size: ${(audioBlob.size / 1024).toFixed(2)} KB | Type: ${mimeType}`);

        if (audioBlob.size === 0) {
          toast.error('Recording failed: Audio file was empty (0 bytes). Check microphone.');
          setStatus('ERROR');
          setErrorMessage('Empty recording (0 bytes)');
          return;
        }

        if (duration < 1.5) {
          toast.error('Recording too short (minimum 1.5 seconds).');
          setStatus('IDLE');
          return;
        }

        // Preserve audio blob for playback/retry/download
        const audioUrl = URL.createObjectURL(audioBlob);
        setSavedAudioBlob(audioBlob);
        setSavedAudioUrl(audioUrl);

        // Execute transcription pipeline
        await processTranscription(audioBlob, mimeType);
      };

      mediaRecorder.start(1000); // 1-second timeslices
      setStatus('RECORDING');
      setStatusText('Recording...');
      setRecordingTime(0);
      startTimeRef.current = Date.now();

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= MAX_RECORDING_TIME - 1) {
            stopRecording();
            return MAX_RECORDING_TIME;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err: any) {
      console.error('Error accessing microphone:', err);
      setStatus('ERROR');
      let msg = 'Microphone permission denied or audio input unavailable.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Microphone permission denied by browser. Please enable mic access.';
      } else if (err.name === 'NotFoundError') {
        msg = 'No microphone device found on this system.';
      }
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Resilient Multi-Strategy Transcription Execution
  const processTranscription = async (blob: Blob, mimeType: string) => {
    setStatus('UPLOADING');
    setStatusText(`Uploading audio (${(blob.size / 1024).toFixed(1)} KB)...`);

    const filename = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'recording.m4a' : 'recording.webm';
    
    let transcribedText = '';
    let success = false;
    let failureReason = '';

    // Strategy 1: Server route /api/transcribe (the Groq key stays on the server)
    try {
      setStatus('TRANSCRIBING');
      setStatusText('Transcribing audio...');

      const formData = new FormData();
      formData.append('file', blob, filename);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      const isJson = response.headers.get('content-type')?.includes('application/json');

      if (response.ok && isJson) {
        const data = await response.json();
        if (data.text && data.text.trim()) {
          transcribedText = data.text.trim();
          success = true;
        } else {
          failureReason = 'No speech detected in audio recording.';
        }
      } else if (isJson) {
        const errData = await response.json();
        failureReason = errData.error || `Server HTTP ${response.status}`;
      } else {
        failureReason = `Server route unavailable (HTTP ${response.status})`;
      }
    } catch (err: any) {
      console.error('Server transcription route exception:', err);
      failureReason = err.message || 'Server connection failed';
    }

    // Strategy 2 (local development only): direct Groq call with VITE_GROQ_API_KEY from .env.local
    const devKey = ((import.meta.env.VITE_GROQ_API_KEY as string) || '').trim();
    if (!success && devKey.length > 10 && failureReason !== 'No speech detected in audio recording.') {
      try {
        const clientFormData = new FormData();
        clientFormData.append('model', 'whisper-large-v3');
        clientFormData.append('temperature', '0');
        clientFormData.append('response_format', 'verbose_json');
        // Remarks are written in Telugu script (e.g. "పేమెంట్ ఇస్తాడు")
        clientFormData.append('language', TRANSCRIPTION_LANGUAGE);
        clientFormData.append('prompt', TRANSCRIPTION_PROMPT);
        clientFormData.append('file', blob, filename);

        const clientResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${devKey}` },
          body: clientFormData
        });

        if (clientResp.ok) {
          const clientData = await clientResp.json();
          if (clientData.text && clientData.text.trim()) {
            transcribedText = clientData.text.trim();
            success = true;
            // Make sure any English letters left over become Telugu script
            if (hasEnglishLetters(transcribedText)) {
              try { transcribedText = await convertTextToTelugu(transcribedText); } catch { /* keep Whisper text */ }
            }
          } else {
            failureReason = 'No speech detected in audio recording.';
          }
        } else {
          console.error('Transcription API error:', await clientResp.text());
          if (clientResp.status === 401) failureReason = 'Invalid API Key (HTTP 401)';
          else if (clientResp.status === 429) failureReason = 'API quota / rate limit exceeded (HTTP 429)';
          else failureReason = `Transcription Error (HTTP ${clientResp.status})`;
        }
      } catch (clientErr: any) {
        console.warn('Direct Groq transcription failed:', clientErr);
        failureReason = clientErr.message || 'Direct API connection error';
      }
    }

    // Final Outcome Processing
    if (success && transcribedText) {
      setStatus('SUCCESS');
      setStatusText('Completed');
      toast.success('Audio transcribed successfully');
      onTranscriptionCompleted(transcribedText);
      setTimeout(() => setStatus('IDLE'), 2000);
    } else {
      setStatus('ERROR');
      const finalErr = failureReason || 'Unable to process audio recording.';
      setErrorMessage(finalErr);
      toast.error(`Transcription Failed: ${finalErr}`);
    }
  };

  // Playback Control
  const togglePlayAudio = () => {
    if (!savedAudioUrl) return;

    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio(savedAudioUrl);
      audioPlayerRef.current.onended = () => setIsPlayingAudio(false);
    }

    if (isPlayingAudio) {
      audioPlayerRef.current.pause();
      setIsPlayingAudio(false);
    } else {
      audioPlayerRef.current.play();
      setIsPlayingAudio(true);
    }
  };

  // Audio File Download
  const downloadAudio = () => {
    if (!savedAudioUrl) return;
    const a = document.createElement('a');
    a.href = savedAudioUrl;
    a.download = `followup_audio_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        
        {/* IDLE State: Start Recording Button */}
        {status === 'IDLE' && (
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
          >
            <Mic className="w-3.5 h-3.5 text-amber-400" /> Start Recording
          </button>
        )}

        {/* RECORDING State: Pulse indicator + Stop Button */}
        {status === 'RECORDING' && (
          <div className="flex items-center gap-2">
            <div className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 font-mono text-[12px] font-black flex items-center gap-1.5 border border-rose-300 shadow-2xs">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping"></span>
              {formatTime(recordingTime)}
            </div>
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white bg-rose-700 hover:bg-rose-800 rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" /> Stop
            </button>
          </div>
        )}

        {/* UPLOADING & TRANSCRIBING States: Detailed Progress Spinner */}
        {(status === 'UPLOADING' || status === 'TRANSCRIBING') && (
          <div className="inline-flex items-center justify-center gap-2 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-slate-800 bg-slate-100 border border-slate-300 rounded-lg shadow-2xs">
            <svg className="animate-spin h-3.5 w-3.5 text-slate-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>{statusText}</span>
          </div>
        )}

        {/* SUCCESS State */}
        {status === 'SUCCESS' && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg">
            ✓ Transcribed
          </div>
        )}

        {/* ERROR State Controls (Step 10: Fallback preserving audio) */}
        {status === 'ERROR' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {savedAudioBlob && (
              <>
                <button
                  type="button"
                  onClick={() => processTranscription(savedAudioBlob, savedAudioBlob.type)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-black uppercase transition-colors shadow-2xs cursor-pointer"
                  title="Retry Transcription"
                >
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>

                <button
                  type="button"
                  onClick={togglePlayAudio}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer"
                  title="Play Recording"
                >
                  {isPlayingAudio ? <Pause className="w-3 h-3 text-slate-900" /> : <Play className="w-3 h-3 text-slate-900" />}
                </button>

                <button
                  type="button"
                  onClick={downloadAudio}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer"
                  title="Download Recording File"
                >
                  <Download className="w-3 h-3 text-slate-900" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={startRecording}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-black uppercase transition-colors cursor-pointer"
            >
              <Mic className="w-3 h-3 text-amber-400" /> Record New
            </button>
          </div>
        )}

      </div>

      {/* Actionable Error Diagnostics Banner */}
      {status === 'ERROR' && errorMessage && (
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg">
          <AlertCircle className="w-3 h-3 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};

export default VoiceRecorder;
