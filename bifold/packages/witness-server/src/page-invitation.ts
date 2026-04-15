/**
 * page-invitation.ts — QR code invitation page (served at /)
 *
 * Generates the full HTML string for the home page that displays the
 * DIDComm invitation as a scannable QR code.
 */

import * as QRCode from 'qrcode'
import type { WebServerConfig } from './WebServer'

async function generateQRCodeDataUrl(url: string): Promise<string> {
  try {
    return await QRCode.toDataURL(url, {
      width: 512,
      margin: 2,
      color: {
        dark: '#010B13',
        light: '#ffffff',
      },
    })
  } catch (error) {
    console.error('Failed to generate QR code:', error)
    throw error
  }
}

export async function generateInvitationPage(config: WebServerConfig): Promise<string> {
  const qrCodeDataUrl = await generateQRCodeDataUrl(config.invitationUrl)
  const eventName = config.witnessService.config?.eventName || 'Keyring'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${eventName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100%;
      overflow: hidden;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #09465B;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 24px;
    }

    .card {
      background: #FFFFFF;
      border-radius: 24px;
      padding: 4vh 5vw;
      width: 92vw;
      max-width: 680px;
      max-height: calc(100vh - 48px);
      text-align: center;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .logo {
      width: 70%;
      max-width: 420px;
      height: auto;
      margin-bottom: 3vh;
      flex-shrink: 0;
    }

    .qr-code {
      width: 100%;
      max-width: min(50vh, 480px);
      height: auto;
      margin-bottom: 3vh;
      flex-shrink: 1;
    }

    .subtitle {
      color: #4A4A4A;
      font-size: clamp(14px, 2.4vw, 20px);
      line-height: 1.5;
      padding: 0 4%;
      flex-shrink: 0;
    }

    .accent-bar {
      width: 56px;
      height: 3px;
      background: #6E121D;
      border-radius: 2px;
      margin-top: 2vh;
      flex-shrink: 0;
    }

    .button-row {
      display: flex;
      gap: 12px;
      margin-top: 2vh;
      flex-shrink: 0;
      flex-wrap: wrap;
      justify-content: center;
    }

    .nav-button {
      display: inline-block;
      padding: 10px 20px;
      border-radius: 8px;
      text-decoration: none;
      font-size: clamp(13px, 1.8vw, 15px);
      font-weight: 500;
      color: #fff;
      background: #4a4a4a;
      border: 1px solid #666;
      transition: background 0.2s;
      white-space: nowrap;
    }

    .nav-button:hover {
      background: #5a5a5a;
    }

    .nav-button.primary {
      background: #1a1a2e;
      border-color: #667eea;
    }

    .nav-button.primary:hover {
      background: #252540;
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="/logo.png" alt="Applied Social Media Lab" class="logo" />
    <img src="${qrCodeDataUrl}" alt="Scan to connect" class="qr-code" />
    <p class="subtitle">Scan with the Keyring to connect to the witness</p>
    <div class="accent-bar"></div>
    <div class="button-row">
      <a href="/log" class="nav-button">📊 Activity Log</a>
      <a href="/network" class="nav-button primary">🌐 Live Network</a>
    </div>
  </div>
</body>
</html>`
}
