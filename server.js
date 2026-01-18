const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const https = require('https');
const { google } = require('googleapis');
const winston = require('winston');
const { GoogleGenAI } = require('@google/genai');
const sharp = require('sharp');
const { log } = require('console');

const app = express();
const PORT = process.env.PORT || 3000;
const USE_HTTPS = process.env.USE_HTTPS !== 'false'; // Enable HTTPS by default

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Configure Winston Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
    })
  ),
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // File output with timestamp in filename
    new winston.transports.File({
      filename: path.join(logsDir, `app-${new Date().toISOString().split('T')[0]}.log`),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, `error-${new Date().toISOString().split('T')[0]}.log`),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Load configuration and credentials
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, 'credentials.json'), 'utf8'));
const imageStylePrompts = JSON.parse(fs.readFileSync(path.join(__dirname, 'image-style-prompts.json'), 'utf8'));

// Setup multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.set('trust proxy', 1); // Trust the first proxy (Nginx on Bitnami)
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files with caching headers
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d', // Cache static files for 1 day
  etag: false,  // Disable etag for better caching
  lastModified: true,
  setHeaders: (res, path) => {
    // Log static file access
    if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|webp)$/i)) {
      logger.debug('Static file served', { file: path });
    }
  }
}));

// Initialize Google Drive API with OAuth 2.0
function getDriveService() {
  const oauth2Client = new google.auth.OAuth2(
    credentials.installed.client_id,
    credentials.installed.client_secret,
    credentials.installed.redirect_uris[0]
  );

  // Check if token.json exists
  const tokenPath = path.join(__dirname, 'token.json');
  if (!fs.existsSync(tokenPath)) {
    throw new Error('token.json not found. Please run generate-token.js first.');
  }

  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  oauth2Client.setCredentials(token);

  // Handle token refresh and auto-save
  oauth2Client.on('tokens', (newTokens) => {
    if (newTokens.refresh_token) {
      token.refresh_token = newTokens.refresh_token;
    }
    token.access_token = newTokens.access_token;
    fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    logger.info('Google Drive token refreshed and saved');
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

// Routes
app.get('/', (req, res) => {
  logger.info('Home page requested', { ip: req.ip });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/shake-detector', (req, res) => {
  logger.info('Shake detector page requested', { ip: req.ip });
  res.sendFile(path.join(__dirname, 'public', 'shake-detector.html'));
});

app.get('/api/health', (req, res) => {
  logger.info('Health check requested');
  res.json({ status: 'Server is running', timestamp: new Date() });
});

// Optimize image endpoint using Google Gemini
app.post('/api/optimize-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      logger.warn('Image optimization attempt without file', { ip: req.ip });
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Validate that the uploaded file is an image
    if (!req.file.mimetype.startsWith('image/')) {
      logger.warn('Invalid file type for optimization', { 
        mimetype: req.file.mimetype, 
        ip: req.ip 
      });
      return res.status(400).json({ error: 'File must be an image' });
    }

    if (typeof req.body.imageStyleIndex === 'undefined' || isNaN(req.body.imageStyleIndex) || req.body.imageStyleIndex < 0 || req.body.imageStyleIndex >= imageStylePrompts.length) {
      logger.warn('Invalid image style index', { 
        imageStyleIndex: req.body.imageStyleIndex,
        ip: req.ip
      });
      return res.status(400).json({ error: 'Invalid image style selected' });
    }

    const imageStyleIndex = parseInt(req.body.imageStyleIndex);

    logger.info('Image optimization started', { 
      filename: req.file.originalname, 
      filesize: req.file.size,
      mimetype: req.file.mimetype,
      ip: req.ip,
      imageStyleIndex: req.body.imageStyleIndex
    });

    // Get the Gemini API key from credentials
    const geminiApiKey = credentials.installed?.gemini_api_key;
    if (!geminiApiKey) {
      logger.error('Gemini API key not found in credentials');
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    // Initialize Gemini API
    const genAI = new GoogleGenAI({apiKey: geminiApiKey});

    // Convert image buffer to base64
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Send image to Gemini for optimization and image generation
    if (imageStylePrompts.length === 0) {
      logger.error('No image style prompts found');
      return res.status(500).json({ error: 'Image style prompts not configured' });
    }

    const prompt = [
    { text: imageStylePrompts[req.body.imageStyleIndex]?.text || imageStylePrompts.find(prompt => prompt.default)?.text || imageStylePrompts[0].text },
    {
      inlineData: {
        mimeType: mimeType,
        data: base64Image,
      },
    },
  ];

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: prompt,
    });
    
    // Extract the generated image from response
    const imagePart = response.candidates[0]?.content?.parts?.find(
      part => part.inlineData?.mimeType?.startsWith('image/')
    );

    if (!imagePart || !imagePart.inlineData?.data) {
      logger.error('No image generated from Gemini');
      return res.status(500).json({ error: 'Failed to generate optimized image' });
    }

    // Get the generated image data
    const optimizedImageBase64 = imagePart.inlineData.data;
    const optimizedImageBuffer = Buffer.from(optimizedImageBase64, 'base64');

    // Optimize the image further using sharp for compression and quality
    const finalImageBuffer = await sharp(optimizedImageBuffer)
      .resize(1024, 1024, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png({ quality: 95, progressive: true })
      .toBuffer();

    logger.info('Image optimization completed successfully', {
      filename: req.file.originalname,
      originalSize: req.file.size,
      optimizedSize: finalImageBuffer.length,
      imageStyleIndex: imageStyleIndex,
      ip: req.ip
    });

    // Set response headers for image
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="optimized_${Date.now()}.png"`);
    res.send(finalImageBuffer);

  } catch (error) {
    logger.error('Image optimization error', { 
      error: error.message,
      stack: error.stack,
      filename: req.file?.originalname,
      ip: req.ip 
    });
    res.status(500).json({ error: error.message || 'Image optimization failed' });
  }
});

// Upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {

    if (config.ENABLE_UPLOAD_IMAGE !== true) {
      logger.warn('Upload attempt when uploads are disabled. Please contact moderator to enable uploads.', { ip: req.ip });
      return res.status(503).json({ error: 'File uploads are currently disabled' });
    }

    if (!req.file) {
      logger.warn('Upload attempt without file', { ip: req.ip });
      return res.status(400).json({ error: 'No file uploaded' });
    }

    logger.info('File upload started', { 
      filename: req.file.originalname, 
      filesize: req.file.size,
      mimetype: req.file.mimetype,
      ip: req.ip
    });

    const drive = getDriveService();
    const folderId = config.GOOGLE_DRIVE_QUEUE_FOLDER_ID;

    // Upload file to Google Drive
    const fileMetadata = {
      name: `${Date.now()}_${req.file.originalname}`,
      parents: [folderId]
    };

    const media = {
      mimeType: req.file.mimetype,
      body: require('stream').Readable.from([req.file.buffer])
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink'
    });

    logger.info('File uploaded successfully to Google Drive', {
      filename: req.file.originalname,
      fileId: response.data.id,
      filesize: req.file.size,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'File uploaded successfully',
      fileId: response.data.id,
      fileLink: response.data.webViewLink
    });
  } catch (error) {
    logger.error('Upload error', { 
      error: error.message,
      stack: error.stack,
      filename: req.file?.originalname,
      ip: req.ip 
    });
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// 404 handler
app.use((req, res) => {
  logger.warn('Route not found', { path: req.path, ip: req.ip });
  res.status(404).json({ error: 'Route not found' });
});

// Start server with HTTPS or HTTP
if (USE_HTTPS) {
  try {
    const certPath = path.join(__dirname, 'certs', 'server.crt');
    const keyPath = path.join(__dirname, 'certs', 'server.key');
    
    // Check if certificates exist
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      logger.warn('SSL certificates not found. Falling back to HTTP.');
      logger.warn('To generate certificates, run: npm run generate-certs');
      startHttpServer();
    } else {
      const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };
      
      https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
        logger.info(`HTTPS Server started successfully`, { 
          port: PORT, 
          protocol: 'HTTPS',
          environment: process.env.NODE_ENV || 'development',
          url: `https://localhost:${PORT}`
        });
      });
    }
  } catch (error) {
    logger.error('Error starting HTTPS server', { error: error.message });
    startHttpServer();
  }
} else {
  startHttpServer();
}

function startHttpServer() {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`HTTP Server started successfully`, { 
      port: PORT, 
      protocol: 'HTTP',
      environment: process.env.NODE_ENV || 'development',
      url: `http://localhost:${PORT}`
    });
  });
}

