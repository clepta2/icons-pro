/**
 * worker.js
 * Cloudflare Worker Anycast para Icons Pro API (R2 Storage + Cache Anycast)
 * 
 * @license MIT
 * @see https://github.com/clepta2/icons-pro
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  'Access-Control-Max-Age': '86400'
};

const PLANOS_CONFIG = {
  free: { nome: 'Free / Sandbox', rpm: 60, prefixo: 'ico_free_' },
  pro: { nome: 'Pro', rpm: 600, prefixo: 'ico_pro_' },
  master: { nome: 'Master Admin', rpm: 3000, prefixo: 'ico_master_' }
};

const rateLimitBuckets = new Map();

function resolverPlano(request) {
  const auth = request.headers.get('Authorization') || request.headers.get('x-api-key') || '';
  if (auth.includes('ico_master_')) return { plano: 'master', limit: 3000 };
  if (auth.includes('ico_pro_')) return { plano: 'pro', limit: 600 };
  return { plano: 'free', limit: 60 };
}

function aplicarRateLimit(key, limit) {
  const now = Date.now();
  let b = rateLimitBuckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 1, resetAt: now + 60000 };
    rateLimitBuckets.set(key, b);
    return { ok: true, remaining: limit - 1 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, remaining: 0, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, remaining: limit - b.count };
}

function aplicarCorSvg(svgText, hexColor) {
  if (!hexColor) return svgText;
  let clean = String(hexColor).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{3,8}$/.test(clean)) return svgText;
  const hex = `#${clean}`;
  if (/<svg[^>]*\sfill="[^"]*"/i.test(svgText)) {
    return svgText.replace(/(<svg[^>]*\sfill=")[^"]*(")/i, `$1${hex}$2`);
  }
  return svgText.replace(/<svg\s/i, `<svg fill="${hex}" `);
}

// Catálogo embutido para teste e busca rápida
const DEFAULT_ICONS = [
  { title: 'WhatsApp', slug: 'whatsapp', hex: '25D366' },
  { title: 'GitHub', slug: 'github', hex: '181717' },
  { title: 'Google', slug: 'google', hex: '4285F4' },
  { title: 'Cloudflare', slug: 'cloudflare', hex: 'F38020' },
  { title: 'JavaScript', slug: 'javascript', hex: 'F7DF1E' },
  { title: 'Node.js', slug: 'nodedotjs', hex: '5FA04E' },
  { title: 'Python', slug: 'python', hex: '3776AB' },
  { title: 'Docker', slug: 'docker', hex: '2496ED' },
  { title: 'React', slug: 'react', hex: '61DAFB' },
  { title: 'TypeScript', slug: 'typescript', hex: '3178C6' }
];

export default {
  async fetch(request, env = {}, ctx = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { plano, limit } = resolverPlano(request);
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const rate = aplicarRateLimit(ip, limit);

    const TELEMETRY = {
      ...CORS_HEADERS,
      'x-icons-plan': plano,
      'x-icons-ratelimit-remaining': String(rate.remaining)
    };

    if (!rate.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'RATE_LIMIT_EXCEEDED', retryAfter: rate.retryAfter }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rate.retryAfter), ...TELEMETRY }
      });
    }

    // Busca de Marcas
    if (path === '/api/icons/search' || path === '/search') {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const resultados = DEFAULT_ICONS.filter(i => i.title.toLowerCase().includes(q) || i.slug.includes(q));
      return new Response(JSON.stringify({ ok: true, total: resultados.length, resultados }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...TELEMETRY }
      });
    }

    // Metadados
    if (path === '/api/icons/info' || path === '/info') {
      const name = (url.searchParams.get('name') || url.searchParams.get('slug') || '').toLowerCase().trim();
      const item = DEFAULT_ICONS.find(i => i.slug === name || i.title.toLowerCase() === name);
      if (!item) return new Response(JSON.stringify({ ok: false, error: 'ICON_NOT_FOUND' }), { status: 404, headers: { 'Content-Type': 'application/json', ...TELEMETRY } });
      return new Response(JSON.stringify({ ok: true, icone: item }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...TELEMETRY }
      });
    }

    // Ícone SVG por Slug
    const match = path.match(/^\/api\/icons\/([a-zA-Z0-9_\-]+)(\.(svg|png))?$/i) || path.match(/^\/([a-zA-Z0-9_\-]+)(\.(svg|png))?$/i);
    if (match) {
      const slug = match[1].toLowerCase();
      const color = url.searchParams.get('color') || url.searchParams.get('c');

      // Se tiver binding do R2 configurado
      if (env && env.ICONS_R2) {
        const obj = await env.ICONS_R2.get(`icons/svg/${slug}.svg`);
        if (obj) {
          let svgText = await obj.text();
          if (color) svgText = aplicarCorSvg(svgText, color);
          return new Response(svgText, {
            status: 200,
            headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable', ...TELEMETRY }
          });
        }
      }

      // SVG Genérico de Fallback
      const item = DEFAULT_ICONS.find(i => i.slug === slug);
      const fillHex = color ? `#${color.replace('#','')}` : (item ? `#${item.hex}` : '#10b981');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="${fillHex}"><circle cx="12" cy="12" r="10"/></svg>`;
      return new Response(svg, {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400', ...TELEMETRY }
      });
    }

    return new Response(JSON.stringify({ ok: true, service: 'Icons Pro API', status: 'online' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...TELEMETRY }
    });
  }
};
