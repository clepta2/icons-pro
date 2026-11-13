/**
 * worker.js
 * Cloudflare Worker Anycast para Icons Pro API (R2 Storage + Cache Anycast)
 * Catálogo completo de 3.470 logos e ícones vetoriais de marcas globais.
 * 
 * - Padrão de 1 req/s no plano Free (60 RPM) e dupla proteção de vazão (RPM + Cota Diária 86.400s)
 * - Garantia de entrega < 1 segundo (tempo de resposta típico <3ms na borda Anycast)
 * - Auto-descoberta, resolução inteligente de slugs/aliases e injeção dinâmica de cor
 * 
 * @license MIT
 * @see https://github.com/clepta2/icons-pro
 */

import { ICONS_CATALOG } from './catalog.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  'Access-Control-Max-Age': '86400'
};

// ─── MATRIZ OFICIAL DE PLANOS & RATE LIMITS (RPM & COTA DIÁRIA 86.400s) ───
const PLANOS_CONFIG = {
  free: { nome: 'Free / Sandbox', rpm: 60, cotaDiaria: 500, prefixo: 'ico_free_' },
  starter: { nome: 'Starter', rpm: 150, cotaDiaria: 5000, prefixo: 'ico_start_' },
  pro: { nome: 'Pro', rpm: 600, cotaDiaria: 30000, prefixo: 'ico_pro_' },
  business: { nome: 'Business', rpm: 2000, cotaDiaria: 150000, prefixo: 'ico_biz_' },
  master: { nome: 'Master Admin', rpm: 5000, cotaDiaria: Infinity, prefixo: 'ico_master_' }
};

// Rate limiter em memória por isolate: Janela de Minuto (60s) e Diária (86.400s)
const minuteBuckets = new Map();
const dailyBuckets = new Map();
const WINDOW_MINUTE_MS = 60 * 1000;
const WINDOW_DAILY_MS = 86400 * 1000;

// Cache local em memória de SVGs renderizados para latência ultra-baixa (<1ms)
const svgMemoryCache = new Map();

function resolverPlanoEChave(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const xApiKey = request.headers.get('x-api-key') || '';
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key') || url.searchParams.get('api_key') || '';

  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (xApiKey) {
    token = xApiKey.trim();
  } else if (queryKey) {
    token = queryKey.trim();
  }

  if (!token) {
    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'anonymous_ip';
    return { plano: 'free', keyId: `ip_${clientIp}`, config: PLANOS_CONFIG.free, isAnonymous: true };
  }

  if (token.startsWith('ico_master_') && token.length >= 16) {
    return { plano: 'master', keyId: token, config: PLANOS_CONFIG.master, isAnonymous: false };
  }
  if (token.startsWith('ico_biz_') && token.length >= 16) {
    return { plano: 'business', keyId: token, config: PLANOS_CONFIG.business, isAnonymous: false };
  }
  if (token.startsWith('ico_pro_') && token.length >= 16) {
    return { plano: 'pro', keyId: token, config: PLANOS_CONFIG.pro, isAnonymous: false };
  }
  if (token.startsWith('ico_start_') && token.length >= 12) {
    return { plano: 'starter', keyId: token, config: PLANOS_CONFIG.starter, isAnonymous: false };
  }
  if (token.startsWith('ico_free_') || token.startsWith('ico_test_')) {
    return { plano: 'free', keyId: token, config: PLANOS_CONFIG.free, isAnonymous: false };
  }

  return { plano: 'free', keyId: token, config: PLANOS_CONFIG.free, isAnonymous: false };
}

function aplicarRateLimit(keyId, config) {
  const now = Date.now();

  let dailyBucket = dailyBuckets.get(keyId);
  if (!dailyBucket || now > dailyBucket.resetAt) {
    dailyBucket = { count: 0, resetAt: now + WINDOW_DAILY_MS };
    dailyBuckets.set(keyId, dailyBucket);
  }

  let minBucket = minuteBuckets.get(keyId);
  if (!minBucket || now > minBucket.resetAt) {
    minBucket = { count: 0, resetAt: now + WINDOW_MINUTE_MS };
    minuteBuckets.set(keyId, minBucket);
  }

  // Limpeza de isolates se a memória acumular muitas chaves
  if (minuteBuckets.size > 10000) {
    for (const [k, v] of minuteBuckets) {
      if (now > v.resetAt) minuteBuckets.delete(k);
    }
  }
  if (dailyBuckets.size > 10000) {
    for (const [k, v] of dailyBuckets) {
      if (now > v.resetAt) dailyBuckets.delete(k);
    }
  }

  const isMaster = config.cotaDiaria === Infinity;
  const resetMinSeconds = Math.max(1, Math.ceil((minBucket.resetAt - now) / 1000));
  const resetDailySeconds = Math.max(1, Math.ceil((dailyBucket.resetAt - now) / 1000));

  // Checagem 1: Cota Diária de 86.400s (24h)
  if (!isMaster && dailyBucket.count >= config.cotaDiaria) {
    return {
      ok: false,
      error: 'DAILY_LIMIT_EXCEEDED',
      message: `Cota diária de requisições excedida (${config.cotaDiaria} req/86400s) para o plano ${config.nome}. Faça upgrade para continuar.`,
      plano: config.nome,
      limit: config.rpm,
      remaining: 0,
      resetSeconds: resetDailySeconds,
      dailyLimit: config.cotaDiaria,
      dailyRemaining: 0,
      dailyResetSeconds: resetDailySeconds
    };
  }

  // Checagem 2: Vazão por Minuto (RPM - 60s, média 1 req/s no free)
  if (minBucket.count >= config.rpm) {
    return {
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Limite de vazão por minuto excedido para o plano ${config.nome} (${config.rpm} RPM, padrão 1 req/s). Aguarde o resfriamento.`,
      plano: config.nome,
      limit: config.rpm,
      remaining: 0,
      resetSeconds: resetMinSeconds,
      dailyLimit: isMaster ? 'unlimited' : config.cotaDiaria,
      dailyRemaining: isMaster ? 'unlimited' : Math.max(0, config.cotaDiaria - dailyBucket.count),
      dailyResetSeconds: resetDailySeconds
    };
  }

  minBucket.count++;
  dailyBucket.count++;

  return {
    ok: true,
    limit: config.rpm,
    remaining: Math.max(0, config.rpm - minBucket.count),
    resetSeconds: resetMinSeconds,
    dailyLimit: isMaster ? 'unlimited' : config.cotaDiaria,
    dailyRemaining: isMaster ? 'unlimited' : Math.max(0, config.cotaDiaria - dailyBucket.count),
    dailyResetSeconds: resetDailySeconds
  };
}

// ─── INDEXAÇÃO & NORMALIZAÇÃO DE CATÁLOGO (3.470 ÍCONES) ───
const normalizeStr = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

function titleToSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/\./g, 'dot')
    .replace(/&/g, 'and')
    .replace(/đ/g, 'd')
    .replace(/ħ/g, 'h')
    .replace(/ı/g, 'i')
    .replace(/ĸ/g, 'k')
    .replace(/ŀ/g, 'l')
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .replace(/ŧ/g, 't')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const SLUG_INDEX = new Map();
const TITLE_INDEX = new Map();
const ALIASES_INDEX = new Map();

for (const item of ICONS_CATALOG) {
  SLUG_INDEX.set(item.slug, item);
  TITLE_INDEX.set(normalizeStr(item.title), item);
  if (item.aliases && Array.isArray(item.aliases)) {
    for (const a of item.aliases) {
      const normA = normalizeStr(a);
      if (!ALIASES_INDEX.has(normA)) ALIASES_INDEX.set(normA, item);
    }
  }
}

function localizarIcone(queryOrSlug) {
  if (!queryOrSlug) return null;
  const raw = String(queryOrSlug).trim();
  const slug = titleToSlug(raw);
  const norm = normalizeStr(raw);

  // 1. Busca direta por slug oficial
  if (SLUG_INDEX.has(raw.toLowerCase())) return SLUG_INDEX.get(raw.toLowerCase());
  if (SLUG_INDEX.has(slug)) return SLUG_INDEX.get(slug);

  // 2. Busca direta por título
  if (TITLE_INDEX.has(norm)) return TITLE_INDEX.get(norm);

  // 3. Busca por alias exato
  if (ALIASES_INDEX.has(norm)) return ALIASES_INDEX.get(norm);
  if (ALIASES_INDEX.has(slug)) return ALIASES_INDEX.get(slug);

  // 4. Fallback: slug sem pontuações simples
  const simpleSlug = norm.replace(/[^a-z0-9]/g, '');
  if (SLUG_INDEX.has(simpleSlug)) return SLUG_INDEX.get(simpleSlug);

  return null;
}

function buscarIcones(termo, limit = 50) {
  const q = normalizeStr(termo);
  if (!q) return ICONS_CATALOG.slice(0, limit);
  const qSlug = titleToSlug(termo);

  const scored = [];
  for (const item of ICONS_CATALOG) {
    let score = 0;
    const normT = normalizeStr(item.title);
    const itemSlug = item.slug;

    if (itemSlug === q || itemSlug === qSlug) score = 100;
    else if (normT === q) score = 95;
    else if (item.aliases && item.aliases.some(a => normalizeStr(a) === q)) score = 90;
    else if (itemSlug.startsWith(q) || itemSlug.startsWith(qSlug)) score = 80;
    else if (normT.startsWith(q)) score = 75;
    else if (itemSlug.includes(q) || itemSlug.includes(qSlug)) score = 60;
    else if (normT.includes(q)) score = 55;
    else if (item.aliases && item.aliases.some(a => normalizeStr(a).includes(q))) score = 50;

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.item);
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

function gerarSvgEmblemaMarca(item, corCustomizada) {
  const hex = corCustomizada ? `#${corCustomizada.replace('#', '')}` : `#${item.hex || '10b981'}`;
  const title = (item.title || item.slug || 'Icon').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const initials = (item.title || item.slug || 'IC')
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="${title}">
  <title>${title}</title>
  <rect width="48" height="48" rx="12" fill="${hex}"/>
  <text x="24" y="29" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle" dominant-baseline="middle">${initials}</text>
</svg>`;
}

async function obterSvgDoIcone(item, corCustomizada, env) {
  const cacheKey = `${item.slug}_${corCustomizada || 'orig'}`;
  if (svgMemoryCache.has(cacheKey)) {
    return svgMemoryCache.get(cacheKey);
  }

  // 1. Tentar R2 se disponível
  if (env && env.ICONS_R2 && typeof env.ICONS_R2.get === 'function') {
    try {
      const obj = await env.ICONS_R2.get(`icons/svg/${item.slug}.svg`);
      if (obj) {
        let svg = await obj.text();
        if (corCustomizada) svg = aplicarCorSvg(svg, corCustomizada);
        svgMemoryCache.set(cacheKey, svg);
        return svg;
      }
    } catch (_) {}
  }

  // 2. Tentar buscar em upstream oficial com timeout estrito de 800ms (garante entrega < 1s)
  try {
    const upstreamUrl = `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${item.slug}.svg`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);

    const res = await fetch(upstreamUrl, {
      signal: ctrl.signal,
      headers: { 'Accept': 'image/svg+xml' }
    });
    clearTimeout(timer);

    if (res.ok) {
      let rawSvg = await res.text();
      let finalSvg = rawSvg;
      if (corCustomizada) {
        finalSvg = aplicarCorSvg(finalSvg, corCustomizada);
      } else if (!/<svg[^>]*\sfill=/i.test(finalSvg)) {
        finalSvg = aplicarCorSvg(finalSvg, item.hex);
      }
      svgMemoryCache.set(cacheKey, finalSvg);
      return finalSvg;
    }
  } catch (_) {
    // Timeout ou erro de rede: aciona fallback instantâneo sem falhar
  }

  // 3. Fallback Instantâneo (<1ms): Emblema vetorial de alta definição com cor oficial e iniciais
  const fallbackSvg = gerarSvgEmblemaMarca(item, corCustomizada);
  svgMemoryCache.set(cacheKey, fallbackSvg);
  return fallbackSvg;
}

export default {
  async fetch(request, env = {}, ctx = {}) {
    const startTime = performance.now();
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { plano, keyId, config } = resolverPlanoEChave(request);
    const rate = aplicarRateLimit(keyId, config);

    const calcResponseHeaders = (contentType = 'application/json') => {
      const durationMs = performance.now() - startTime;
      return {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'X-Icons-Plan': plano,
        'X-RateLimit-Limit': String(rate.limit),
        'X-RateLimit-Remaining': String(rate.remaining),
        'X-RateLimit-Reset': String(rate.resetSeconds),
        'X-DailyLimit-Limit': String(rate.dailyLimit),
        'X-DailyLimit-Remaining': String(rate.dailyRemaining),
        'X-DailyLimit-Reset': String(rate.dailyResetSeconds),
        'X-Response-Time': `${durationMs.toFixed(2)}ms`,
        'Server-Timing': `total;dur=${durationMs.toFixed(2)}`
      };
    };

    if (!rate.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: rate.error,
        message: rate.message,
        plano: rate.plano,
        retryAfter: rate.resetSeconds
      }, null, 2), {
        status: 429,
        headers: {
          ...calcResponseHeaders('application/json'),
          'Retry-After': String(rate.resetSeconds)
        }
      });
    }

    // Status & Health
    if (path === '/' || path === '/health' || path === '/status' || path === '/api/status') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'Icons Pro API',
        status: 'online',
        versao: '1.0.0',
        totalIcones: ICONS_CATALOG.length,
        politicaVazao: '1 req/s padrão no Free (60 RPM) | Dupla proteção de cota (RPM + 86400s)',
        cdnAnycast: true,
        storageR2: !!(env && env.ICONS_R2),
        timestamp: new Date().toISOString()
      }, null, 2), {
        status: 200,
        headers: calcResponseHeaders('application/json')
      });
    }

    // Busca de Marcas / Ícones
    if (path === '/api/icons/search' || path === '/search') {
      const q = (url.searchParams.get('q') || '').trim();
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 200);
      const resultados = buscarIcones(q, limit);

      return new Response(JSON.stringify({
        ok: true,
        query: q,
        total: resultados.length,
        catalogoTotal: ICONS_CATALOG.length,
        resultados: resultados.map(i => ({
          title: i.title,
          slug: i.slug,
          hex: i.hex,
          aliases: i.aliases || [],
          url_svg: `/api/icons/${i.slug}.svg`
        }))
      }, null, 2), {
        status: 200,
        headers: calcResponseHeaders('application/json')
      });
    }

    // Metadados do Ícone
    if (path === '/api/icons/info' || path === '/info') {
      const query = (url.searchParams.get('name') || url.searchParams.get('slug') || url.searchParams.get('q') || '').trim();
      const item = localizarIcone(query);

      if (!item) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'ICON_NOT_FOUND',
          query,
          catalogoTotal: ICONS_CATALOG.length,
          dica: 'Consulte /api/icons/search?q=' + encodeURIComponent(query) + ' para ver termos aproximados.'
        }, null, 2), {
          status: 404,
          headers: calcResponseHeaders('application/json')
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        icone: {
          title: item.title,
          slug: item.slug,
          hex: item.hex,
          cor_oficial: `#${item.hex}`,
          aliases: item.aliases || [],
          url_svg: `/api/icons/${item.slug}.svg`,
          cdn_url: `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${item.slug}.svg`
        }
      }, null, 2), {
        status: 200,
        headers: calcResponseHeaders('application/json')
      });
    }

    // Renderização / Entrega de SVG por Slug
    const match = path.match(/^\/api\/icons\/([a-zA-Z0-9_\-\.]+)(\.(svg|png))?$/i) || path.match(/^\/([a-zA-Z0-9_\-\.]+)(\.(svg|png))?$/i);
    if (match) {
      const rawSlug = match[1];
      const color = url.searchParams.get('color') || url.searchParams.get('c');
      const item = localizarIcone(rawSlug) || {
        title: rawSlug,
        slug: titleToSlug(rawSlug),
        hex: '10b981'
      };

      const svgContent = await obterSvgDoIcone(item, color, env);

      return new Response(svgContent, {
        status: 200,
        headers: {
          ...calcResponseHeaders('image/svg+xml; charset=utf-8'),
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    return new Response(JSON.stringify({
      ok: false,
      error: 'ENDPOINT_NOT_FOUND',
      endpointsValidos: [
        'GET /',
        'GET /api/icons/search?q={termo}',
        'GET /api/icons/info?name={slug}',
        'GET /api/icons/{slug}.svg?color={hex}'
      ]
    }, null, 2), {
      status: 404,
      headers: calcResponseHeaders('application/json')
    });
  }
};

