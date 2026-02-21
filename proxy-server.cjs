// Proxy Server para bypass de X-Frame-Options y CSP
// Permite cargar páginas web en iframes para el modo web con split-view

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const { JSDOM } = require('jsdom');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Endpoint de proxy para páginas web
app.get('/proxy', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    console.log(`🌐 Proxying: ${targetUrl}`);

    // Headers realistas para evitar detección de bots
    const isSementicScholar = targetUrl.includes('semanticscholar.org');
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    };
    
    // Para Semantic Scholar agregar referer
    if (isSementicScholar) {
      headers['Referer'] = 'https://www.semanticscholar.org/';
      headers['Origin'] = 'https://www.semanticscholar.org';
    }

    // Fetch la página
    const response = await fetch(targetUrl, { headers });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    
    // Si no es HTML, devolver el contenido tal cual
    if (!contentType || !contentType.includes('text/html')) {
      const buffer = await response.buffer();
      res.set('Content-Type', contentType);
      return res.send(buffer);
    }

    // Procesar HTML
    let html = await response.text();

    // Inyectar base tag para recursos relativos
    const baseTag = `<base href="${targetUrl}" target="_parent">`;
    
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${baseTag}`);
    } else if (html.includes('<HEAD>')) {
      html = html.replace('<HEAD>', `<HEAD>${baseTag}`);
    } else {
      html = `<head>${baseTag}</head>${html}`;
    }

    // Inyectar script para interceptar clicks en enlaces y enviarlos al parent
    const linkInterceptorScript = `
      <script>
        // Interceptar todos los clicks en enlaces
        document.addEventListener('click', function(e) {
          const link = e.target.closest('a');
          if (link && link.href) {
            // Detectar PDFs, documentos y enlaces externos
            const url = link.href;
            const isPdf = url.toLowerCase().includes('.pdf');
            const isDoc = /\\.(doc|docx|ppt|pptx|xls|xlsx)$/i.test(url);
            const isExternal = link.target === '_blank' || link.getAttribute('target') === '_blank';
            
            if (isPdf || isDoc || isExternal) {
              e.preventDefault();
              e.stopPropagation();
              
              // Enviar mensaje al parent window para navegar en el iframe
              if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                  type: 'NAVIGATE_IFRAME',
                  url: url,
                  title: link.textContent || link.title || 'Documento'
                }, '*');
              }
            }
          }
        }, true);
      </script>
    `;
    
    // Inyectar estilo para mejorar visualización en iframe
    const styleInjection = `
      <style>
        body {
          margin: 0 !important;
          padding: 20px !important;
          overflow-x: hidden !important;
        }
        /* Ocultar popups y overlays molestos */
        [id*="cookie"], [class*="cookie"], 
        [id*="gdpr"], [class*="gdpr"],
        [id*="subscribe"], [class*="subscribe"],
        [id*="newsletter"], [class*="newsletter"] {
          display: none !important;
        }
      </style>
    `;
    
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${styleInjection}${linkInterceptorScript}</head>`);
    } else if (html.includes('</body>')) {
      html = html.replace('</body>', `${styleInjection}${linkInterceptorScript}</body>`);
    }

    // Configurar headers de respuesta
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // CSP restrictivo para mayor seguridad
      'Content-Security-Policy': "default-src 'self' *; script-src 'unsafe-inline' 'unsafe-eval' *; style-src 'unsafe-inline' *; img-src * data: blob:; frame-ancestors 'self' http://localhost:* http://127.0.0.1:*;"
    });

    // NO incluir X-Frame-Options para permitir iframe
    res.removeHeader('X-Frame-Options');

    res.send(html);

  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    
    // Devolver página de error amigable
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Error al cargar</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
          }
          .error-container {
            text-align: center;
            padding: 40px;
            max-width: 500px;
          }
          .error-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            font-size: 24px;
            margin: 0 0 10px 0;
            font-weight: 600;
          }
          p {
            color: rgba(255,255,255,0.7);
            margin: 0 0 20px 0;
            line-height: 1.6;
          }
          .error-details {
            background: rgba(255,255,255,0.05);
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
            color: rgba(255,255,255,0.5);
            font-family: monospace;
          }
          .btn {
            display: inline-block;
            margin-top: 20px;
            padding: 10px 20px;
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 6px;
            color: #fff;
            text-decoration: none;
            transition: all 0.2s;
          }
          .btn:hover {
            background: rgba(255,255,255,0.15);
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <div class="error-icon">⚠️</div>
          <h1>No se pudo cargar la página</h1>
          <p>Esta página no se puede mostrar en el panel de vista previa.</p>
          <div class="error-details">${error.message}</div>
          <a href="${req.query.url}" target="_blank" class="btn">Abrir en nueva pestaña →</a>
        </div>
      </body>
      </html>
    `;
    
    res.status(500).send(errorHtml);
  }
});

// Endpoint de readability mode (extracción de texto limpio)
app.get('/readability', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    console.log(`📖 Readability mode: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = await response.text();
    const dom = new JSDOM(html, { url: targetUrl });
    const { Readability } = require('@mozilla/readability');
    
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      throw new Error('No se pudo extraer el contenido del artículo');
    }

    // Generar HTML limpio
    const cleanHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${article.title || 'Artículo'}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            color: #e5e5e5;
            background: #1a1a2e;
            max-width: 720px;
            margin: 0 auto;
            padding: 40px 20px;
          }
          h1 {
            font-size: 32px;
            margin-bottom: 10px;
            color: #fff;
            font-weight: 700;
          }
          .meta {
            color: rgba(255,255,255,0.5);
            font-size: 14px;
            margin-bottom: 30px;
          }
          .content {
            font-size: 16px;
          }
          .content img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            margin: 20px 0;
          }
          .content p {
            margin: 16px 0;
          }
          .content a {
            color: #60a5fa;
            text-decoration: none;
          }
          .content a:hover {
            text-decoration: underline;
          }
          .source {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
          }
          .source-link {
            color: rgba(255,255,255,0.6);
            text-decoration: none;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <h1>${article.title}</h1>
        <div class="meta">
          ${article.byline ? `Por ${article.byline} • ` : ''}
          ${article.siteName || new URL(targetUrl).hostname}
        </div>
        <div class="content">
          ${article.content}
        </div>
        <div class="source">
          <a href="${targetUrl}" target="_blank" class="source-link">Ver artículo original →</a>
        </div>
      </body>
      </html>
    `;

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });

    res.send(cleanHtml);

  } catch (error) {
    console.error('❌ Readability error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para Semantic Scholar (evitar CORS)
app.get('/api/scholar', async (req, res) => {
  try {
    const query = req.query.q;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    console.log(`🔬 Fetching Semantic Scholar: ${query}`);

    // Construir URL con parámetros para Semantic Scholar
    const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
    url.searchParams.append('query', query);
    url.searchParams.append('limit', '8');
    url.searchParams.append('fields', 'title,abstract,authors,year,citationCount,publicationDate,venue,openAccessPdf,externalIds,url,tldr');

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    const data = await response.json();

    // Configurar headers CORS
    res.set({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    res.json(data);

  } catch (error) {
    console.error('❌ Semantic Scholar proxy error:', error.message);
    res.status(500).json({ 
      error: error.message,
      fallback: true 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ollama-web-proxy' });
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
  console.log(`📡 Proxy endpoint: http://localhost:${PORT}/proxy?url=<URL>`);
  console.log(`📖 Reader mode: http://localhost:${PORT}/readability?url=<URL>`);
  console.log(`🔬 Scholar API: http://localhost:${PORT}/api/scholar?q=<QUERY>`);
});
