const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { google } = require('googleapis');
const winston = require('winston');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Setup multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.set('trust proxy', 1); // Trust the first proxy (Nginx on Bitnami)
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/api/health', (req, res) => {
  logger.info('Health check requested');
  res.json({ status: 'Server is running', timestamp: new Date() });
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server started successfully`, { port: PORT, environment: process.env.NODE_ENV || 'development' });
});

