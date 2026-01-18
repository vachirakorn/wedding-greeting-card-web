# Generate self-signed SSL certificate for local development

# Create certs directory if it doesn't exist
if (!(Test-Path "certs")) {
    New-Item -ItemType Directory -Path "certs" | Out-Null
}

# Generate self-signed certificate (valid for 365 days)
$cert = New-SelfSignedCertificate -CertStoreLocation cert:\CurrentUser\My `
    -DnsName localhost `
    -FriendlyName "Wedding Card Dev Server" `
    -NotAfter (Get-Date).AddDays(365)

# Export private key
$password = ConvertTo-SecureString -String "password" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath certs\server.pfx -Password $password | Out-Null

# Export certificate only (PEM format)
$cert | Export-Certificate -FilePath certs\server.crt -Type CERT | Out-Null

Write-Host "✓ SSL certificates generated:" -ForegroundColor Green
Write-Host "  - Certificate: certs\server.pfx (with private key)"
Write-Host "  - Public cert: certs\server.crt"
Write-Host ""
Write-Host "You can now run the HTTPS server with: npm start" -ForegroundColor Yellow
