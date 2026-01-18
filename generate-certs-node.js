#!/usr/bin/env node
/**
 * Generate self-signed SSL certificates for local HTTPS development
 * Works on Windows, macOS, and Linux
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const certsDir = path.join(__dirname, 'certs');
const keyFile = path.join(certsDir, 'server.key');
const crtFile = path.join(certsDir, 'server.crt');

// Create certs directory if it doesn't exist
if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir, { recursive: true });
}

// Check if certificates already exist
if (fs.existsSync(keyFile) && fs.existsSync(crtFile)) {
  console.log('✓ SSL certificates already exist:');
  console.log(`  - Private key: ${keyFile}`);
  console.log(`  - Certificate: ${crtFile}`);
  process.exit(0);
}

console.log('Generating self-signed SSL certificates...\n');

// Command to generate self-signed certificate
const args = [
  'req',
  '-x509',
  '-newkey', 'rsa:2048',
  '-keyout', keyFile,
  '-out', crtFile,
  '-days', '365',
  '-nodes',
  '-subj', '/C=TH/ST=Bangkok/L=Bangkok/O=Wedding/CN=localhost'
];

// Try to run openssl
const openssl = spawn('openssl', args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32'
});

let error = '';
openssl.stderr.on('data', (data) => {
  error += data.toString();
});

openssl.on('close', (code) => {
  if (code !== 0) {
    console.error('✗ Error generating certificates:');
    console.error(error);
    console.error('\nMake sure OpenSSL is installed:');
    console.error('  - Windows: https://slproweb.com/products/Win32OpenSSL.html');
    console.error('  - macOS: brew install openssl');
    console.error('  - Linux: sudo apt-get install openssl');
    process.exit(1);
  }

  console.log('✓ SSL certificates generated successfully:\n');
  console.log(`  Private key: ${keyFile}`);
  console.log(`  Certificate: ${crtFile}`);
  console.log('\n✓ You can now run the HTTPS server with:');
  console.log('  npm start');
  console.log('\n⚠ Note: Browser will show a security warning (self-signed cert)');
  console.log('   Click "Advanced" → "Proceed to localhost" to continue\n');
});

openssl.on('error', (err) => {
  console.error('✗ Error: OpenSSL not found');
  console.error('Install OpenSSL:');
  console.error('  - Windows: https://slproweb.com/products/Win32OpenSSL.html');
  console.error('  - macOS: brew install openssl');
  console.error('  - Linux: sudo apt-get install openssl');
  process.exit(1);
});
