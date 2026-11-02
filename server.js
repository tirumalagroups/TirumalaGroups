import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import FormData from 'form-data';
import fetch from 'node-fetch';
import fs from 'fs';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://*.supabase.co"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// API routes (if any)
app.get('/api/status', (req, res) => {
  res.json({
    message: 'Thirumala Business Management System API',
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

const upload = multer({ dest: 'uploads/' });

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  const traceId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const startTime = Date.now();

  try {
    console.log(`\n=== AUDIO TRANSCRIPTION PIPELINE [TraceID: ${traceId}] ===`);

    if (!req.file) {
      console.error(`[TraceID: ${traceId}] ERROR: No file uploaded`);
      return res.status(400).json({ 
        error: 'No audio file provided in request payload', 
        traceId 
      });
    }

    if (!req.file.size || req.file.size === 0) {
      console.error(`[TraceID: ${traceId}] ERROR: Empty audio recording (0 bytes)`);
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        error: 'Audio recording was empty (0 bytes). Check microphone input.', 
        traceId 
      });
    }

    if (!process.env.GROQ_API_KEY) {
      console.error(`[TraceID: ${traceId}] ERROR: GROQ_API_KEY environment variable is not configured`);
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ 
        error: 'GROQ_API_KEY not configured on server', 
        details: 'Configure GROQ_API_KEY in server environment / .env file',
        traceId 
      });
    }

    // Determine filename & extension for Whisper provider
    let filename = req.file.originalname || 'recording.webm';
    if (!filename.includes('.')) {
      if (req.file.mimetype?.includes('wav')) filename += '.wav';
      else if (req.file.mimetype?.includes('mp4') || req.file.mimetype?.includes('m4a')) filename += '.m4a';
      else if (req.file.mimetype?.includes('mp3') || req.file.mimetype?.includes('mpeg')) filename += '.mp3';
      else if (req.file.mimetype?.includes('ogg')) filename += '.ogg';
      else filename += '.webm';
    }

    console.log(`[TraceID: ${traceId}] 1. Uploaded Filename: ${filename}`);
    console.log(`[TraceID: ${traceId}] 2. MIME Type: ${req.file.mimetype}`);
    console.log(`[TraceID: ${traceId}] 3. Audio File Size: ${(req.file.size / 1024).toFixed(2)} KB`);

    const formData = new FormData();
    formData.append('model', 'whisper-large-v3');
    formData.append('temperature', '0');
    formData.append('response_format', 'verbose_json');
    // Remarks are written in Telugu script (e.g. "పేమెంట్ ఇస్తాడు")
    formData.append('language', 'te');
    formData.append('prompt', 'పేమెంట్ ఇస్తాడు. రేపు కడతాను. ఫోన్ ఎత్తలేదు.');
    formData.append('file', fs.createReadStream(req.file.path), {
      filename,
      contentType: req.file.mimetype || 'audio/webm',
    });

    console.log(`[TraceID: ${traceId}] 4. Sending request to Groq Whisper API...`);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData,
    });

    // Clean up temporary local file immediately
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    const elapsedMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[TraceID: ${traceId}] Groq API Error (HTTP ${response.status}):`, errText);

      let userMsg = `Transcription service returned HTTP ${response.status}`;
      if (response.status === 401) {
        userMsg = 'Invalid API key (HTTP 401 Unauthorized)';
      } else if (response.status === 413) {
        userMsg = 'Audio recording exceeds 25MB size limit (HTTP 413)';
      } else if (response.status === 429) {
        userMsg = 'API rate limit or daily quota exceeded (HTTP 429)';
      } else if (response.status >= 500) {
        userMsg = 'Speech transcription service temporarily unavailable';
      }

      return res.status(response.status).json({ 
        error: userMsg, 
        details: errText,
        traceId 
      });
    }

    const data = await response.json();
    console.log(`[TraceID: ${traceId}] 5. Groq response received in ${elapsedMs}ms. Text length: ${(data.text || '').length} chars`);

    res.json({ 
      text: data.text || '', 
      duration: data.duration || 0,
      traceId,
      elapsedMs 
    });

  } catch (error) {
    console.error(`[TraceID: ${traceId}] Internal Route Exception:`, error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ 
      error: 'Internal server error during transcription processing', 
      details: error.message,
      traceId 
    });
  }
});

// Serve static files from the React app build directory
app.use(express.static(join(__dirname, 'dist'), {
  maxAge: '1y',
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (path.match(/\.(png|jpg|jpeg|gif|ico|svg|webp)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Thirumala Business Management System`);
  console.log(`📍 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 API status: http://localhost:${PORT}/api/status`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default app; 