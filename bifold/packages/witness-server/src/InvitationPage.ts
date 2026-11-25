/**
 * InvitationPage - HTML page generation with QR code for witness server
 *
 * Generates a simple static HTML page that displays:
 * - QR code for mobile wallet scanning
 * - Clickable deep link URL
 * - Server status information
 */

import * as QRCode from 'qrcode'
import { createServer, IncomingMessage, ServerResponse } from 'http'

export interface InvitationPageConfig {
  /** Port to serve the invitation page */
  webPort: number
  /** Witness server name */
  name: string
  /** The DIDComm invitation URL */
  invitationUrl: string
}

/**
 * Generate QR code as base64 data URL
 */
async function generateQRCodeDataUrl(url: string): Promise<string> {
  try {
    return await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
  } catch (error) {
    console.error('Failed to generate QR code:', error)
    throw error
  }
}

/**
 * Generate HTML page with QR code and invitation link
 */
async function generateInvitationPage(config: InvitationPageConfig): Promise<string> {
  const qrCodeDataUrl = await generateQRCodeDataUrl(config.invitationUrl)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.name} - Witness Server</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }

    .container {
      background: white;
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 500px;
      width: 100%;
      text-align: center;
    }

    h1 {
      color: #333;
      font-size: 24px;
      margin-bottom: 8px;
    }

    .subtitle {
      color: #666;
      font-size: 14px;
      margin-bottom: 24px;
    }

    .qr-container {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }

    .qr-code {
      max-width: 100%;
      height: auto;
    }

    .instructions {
      color: #555;
      font-size: 14px;
      margin-bottom: 20px;
      line-height: 1.6;
    }

    .divider {
      display: flex;
      align-items: center;
      margin: 20px 0;
      color: #999;
      font-size: 12px;
    }

    .divider::before,
    .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #ddd;
    }

    .divider::before {
      margin-right: 12px;
    }

    .divider::after {
      margin-left: 12px;
    }

    .url-container {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }

    .url-link {
      color: #667eea;
      text-decoration: none;
      word-break: break-all;
      font-size: 12px;
      font-family: monospace;
    }

    .url-link:hover {
      text-decoration: underline;
    }

    .copy-button {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
      width: 100%;
    }

    .copy-button:hover {
      background: #5568d6;
    }

    .copy-button.copied {
      background: #28a745;
    }

    .status {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }

    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #28a745;
      margin-right: 8px;
      display: inline-block;
    }

    .footer {
      margin-top: 20px;
      font-size: 11px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 ${config.name}</h1>
    <p class="subtitle">Witness Server for VRC Exchanges</p>

    <div class="qr-container">
      <img src="${qrCodeDataUrl}" alt="Connection QR Code" class="qr-code" />
    </div>

    <p class="instructions">
      Scan this QR code with your mobile wallet to connect to the Witness server
      and participate in witnessed VRC exchanges.
    </p>

    <div class="divider">or use the link below</div>

    <div class="url-container">
      <a href="${config.invitationUrl}" class="url-link" id="invitation-url">
        ${config.invitationUrl}
      </a>
    </div>

    <button class="copy-button" onclick="copyUrl()">
      📋 Copy Invitation URL
    </button>

    <div class="status">
      <div class="status-item">
        <span><span class="status-dot"></span>Server Status</span>
        <span>Online</span>
      </div>
      <div class="status-item">
        <span>DIDComm Endpoint</span>
        <span>Ready</span>
      </div>
    </div>

    <p class="footer">
      Powered by Credo-ts • DTG Witnessed Exchange Protocol
    </p>
  </div>

  <script>
    function copyUrl() {
      const url = document.getElementById('invitation-url').innerText;
      navigator.clipboard.writeText(url).then(() => {
        const button = document.querySelector('.copy-button');
        button.textContent = '✓ Copied!';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = '📋 Copy Invitation URL';
          button.classList.remove('copied');
        }, 2000);
      });
    }
  </script>
</body>
</html>`
}

/**
 * Start the invitation page HTTP server
 */
export function startInvitationServer(config: InvitationPageConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    let cachedPage: string | null = null

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Only respond to GET / requests
      if (req.method !== 'GET' || (req.url !== '/' && req.url !== '/index.html')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
        return
      }

      try {
        // Cache the generated page
        if (!cachedPage) {
          cachedPage = await generateInvitationPage(config)
        }

        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache',
        })
        res.end(cachedPage)
      } catch (error) {
        console.error('Error serving invitation page:', error)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      }
    })

    server.on('error', (error: Error) => {
      console.error(`Failed to start invitation server: ${error.message}`)
      reject(error)
    })

    server.listen(config.webPort, () => {
      console.log(`[${config.name}] Invitation page available at http://localhost:${config.webPort}`)
      resolve()
    })
  })
}
