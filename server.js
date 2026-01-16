const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 80;

// Load configuration and credentials
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, 'credentials.json'), 'utf8'));

// Setup multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
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
    console.log('Token refreshed and saved');
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date() });
});

// Upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

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

    res.json({
      success: true,
      message: 'File uploaded successfully',
      fileId: response.data.id,
      fileLink: response.data.webViewLink
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

