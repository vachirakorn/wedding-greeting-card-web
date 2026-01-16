const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
const { client_id, client_secret, redirect_uris } = credentials.installed;

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive']
});

console.log('Authorize this app by visiting this url:\n', authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\nEnter the authorization code here: ', (code) => {
  oauth2Client.getToken(code, (err, token) => {
    if (err) {
      console.error('Error retrieving access token:', err);
      rl.close();
      return;
    }
    
    fs.writeFileSync('token.json', JSON.stringify(token, null, 2));
    console.log('✓ Token saved to token.json');
    rl.close();
  });
});
