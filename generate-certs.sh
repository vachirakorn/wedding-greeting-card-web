#!/bin/bash
# Generate self-signed SSL certificate for local development

# Create certs directory if it doesn't exist
mkdir -p certs

# Generate private key
openssl genrsa -out certs/server.key 2048

# Generate self-signed certificate
openssl req -new -x509 -key certs/server.key -out certs/server.crt -days 365 \
  -subj "/C=TH/ST=Bangkok/L=Bangkok/O=Wedding/CN=localhost"

echo "✓ SSL certificates generated:"
echo "  - Private key: certs/server.key"
echo "  - Certificate: certs/server.crt"
echo ""
echo "You can now run the HTTPS server with: npm start"
