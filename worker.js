/**
 * worker.js
 * Cloudflare Worker Anycast para Icons Pro API (R2 Storage + Cache Anycast)
 * Catálogo completo de 3.470 logos e ícones vetoriais de marcas globais.
 * 
 * - Padrão de 1 req/s no plano Free (60 RPM) e dupla proteção de vazão (RPM + Cota Diária 86.400s)
 * - Garantia de entrega < 1 segundo (tempo de resposta típico <3ms na borda Anycast)
 * - Máxima eficiência na borda: Cache API Anycast, vetores nativos em memória, R2 bucket e stashing automático
 * 
 * @license MIT
 * @see https://github.com/clepta2/icons-pro
 */

import { ICONS_CATALOG } from './catalog.js';
import { TOP_VECTOR_PATHS } from './top-paths.js';
import { SOVEREIGN_FONTS_CATALOG } from './fonts-catalog.js';
import { SOVEREIGN_SYMBOLS_CATALOG } from './symbols-catalog.js';
import { EMOJIS_CATALOG } from './emojis-catalog.js';
import { HTML_STUDIO } from './site-assets.js';

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

export function isColorDark(hex) {
  if (!hex) return false;
  const clean = String(hex).replace('#', '').trim().toLowerCase();
  if (clean === '000' || clean === '000000' || clean === '181717' || clean === '111111') return true;
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 45;
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 45;
  }
  return false;
}

export function isColorLight(hex) {
  if (!hex) return false;
  const clean = String(hex).replace('#', '').trim().toLowerCase();
  if (clean === 'fff' || clean === 'ffffff') return true;
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 215;
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 215;
  }
  return false;
}

export function aplicarCorSvg(svgText, hexColor) {
  if (!hexColor) return svgText;
  if (hexColor === 'currentColor') {
    if (/<svg[^>]*\sfill="[^"]*"/i.test(svgText)) {
      return svgText.replace(/(<svg[^>]*\sfill=")[^"]*(")/i, '$1currentColor$2');
    }
    return svgText.replace(/<svg\s/i, '<svg fill="currentColor" ');
  }
  let clean = String(hexColor).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{3,8}$/.test(clean)) return svgText;
  const hex = `#${clean}`;
  if (/<svg[^>]*\sfill="[^"]*"/i.test(svgText)) {
    return svgText.replace(/(<svg[^>]*\sfill=")[^"]*(")/i, `$1${hex}$2`);
  }
  return svgText.replace(/<svg\s/i, `<svg fill="${hex}" `);
}

export function aplicarMolduraSvg(svgText, bgOption, theme) {
  if (!bgOption) return svgText;
  let bgFill = theme === 'light' ? '#f1f5f9' : '#1e293b';
  let rx = '8';
  if (bgOption === 'circle' || bgOption === 'round') {
    rx = '16';
  } else if (bgOption === 'rounded') {
    rx = '8';
  } else if (/^[0-9a-fA-F]{3,8}$/.test(String(bgOption).replace('#', ''))) {
    bgFill = `#${String(bgOption).replace('#', '')}`;
  }
  const innerContent = svgText.replace(/<svg[^>]*>/i, '').replace(/<\/svg>/i, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img"><rect width="32" height="32" rx="${rx}" fill="${bgFill}"/><g transform="translate(4, 4)">${innerContent}</g></svg>`;
}

export function injetarAutoTemaSvg(svgText, brandHex) {
  const darkInverted = isColorDark(brandHex) ? '#ffffff' : `#${brandHex}`;
  const lightInverted = isColorLight(brandHex) ? '#090d16' : `#${brandHex}`;
  const styleTag = `<style>:root{fill:${lightInverted};}@media(prefers-color-scheme:dark){:root,svg,path{fill:${darkInverted}!important;}}@media(prefers-color-scheme:light){:root,svg,path{fill:${lightInverted}!important;}}</style>`;
  return svgText.replace(/<svg([^>]*)>/i, `<svg$1>${styleTag}`);
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

async function obterSvgDoIcone(item, corCustomizada, theme = '', bg = '', env = {}, ctx = {}) {
  // Ajuste inteligente de contraste por tema
  let effectiveColor = corCustomizada;
  if (!effectiveColor) {
    if ((theme === 'dark' || theme === 'black') && isColorDark(item.hex)) {
      effectiveColor = '#ffffff'; // Inverte marcas pretas em fundos escuros
    } else if ((theme === 'light' || theme === 'white') && isColorLight(item.hex)) {
      effectiveColor = '#090d16'; // Inverte marcas brancas em fundos claros
    }
  }

  const cacheKey = `${item.slug}_${effectiveColor || 'orig'}_${theme || 'none'}_${bg || 'none'}`;

  // 1. Camada 1: Cache em Memória do Isolate (<0.1ms)
  if (svgMemoryCache.has(cacheKey)) {
    return { svg: svgMemoryCache.get(cacheKey), source: 'EDGE-MEMORY-HIT' };
  }

  let finalSvg = null;
  let source = 'EDGE-FALLBACK';

  // 2. Camada 2: Vetores SVG Oficiais Embutidos na Borda (<0.1ms - Top 135 marcas globais)
  if (TOP_VECTOR_PATHS && TOP_VECTOR_PATHS[item.slug]) {
    const pathD = TOP_VECTOR_PATHS[item.slug];
    const fill = effectiveColor ? (effectiveColor.startsWith('#') || effectiveColor === 'currentColor' ? effectiveColor : `#${effectiveColor.replace('#', '')}`) : `#${item.hex || '000000'}`;
    const safeTitle = (item.title || item.slug).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    finalSvg = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="${fill}"><title>${safeTitle}</title><path d="${pathD}"/></svg>`;
    source = 'EDGE-EMBEDDED-HIT';
  }

  // 3. Camada 3: Cloudflare R2 Anycast Edge Storage (<5ms)
  if (!finalSvg && env && env.ICONS_R2 && typeof env.ICONS_R2.get === 'function') {
    try {
      const obj = await env.ICONS_R2.get(`icons/svg/${item.slug}.svg`);
      if (obj) {
        let r2Svg = await obj.text();
        if (effectiveColor) {
          r2Svg = aplicarCorSvg(r2Svg, effectiveColor);
        } else if (!/<svg[^>]*\sfill=/i.test(r2Svg)) {
          r2Svg = aplicarCorSvg(r2Svg, item.hex);
        }
        finalSvg = r2Svg;
        source = 'R2-EDGE-HIT';
      }
    } catch (_) {}
  }

  // 4. Camada 4: Armazenamento Local / Static Assets (<1ms em ambiente local/Node)
  if (!finalSvg) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const curDir = path.dirname(fileURLToPath(import.meta.url));
      const localFile = path.join(curDir, 'svg', `${item.slug}.svg`);
      if (fs.existsSync(localFile)) {
        let localSvg = fs.readFileSync(localFile, 'utf8');
        if (effectiveColor) {
          localSvg = aplicarCorSvg(localSvg, effectiveColor);
        } else if (!/<svg[^>]*\sfill=/i.test(localSvg)) {
          localSvg = aplicarCorSvg(localSvg, item.hex);
        }
        finalSvg = localSvg;
        source = 'LOCAL-EDGE-DISK';
      }
    } catch (_) {}
  }

  // 5. Camada 5: Stashing Automático na Borda com Timeout Seguro de 800ms
  if (!finalSvg) {
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
        if (effectiveColor) {
          rawSvg = aplicarCorSvg(rawSvg, effectiveColor);
        } else if (!/<svg[^>]*\sfill=/i.test(rawSvg)) {
          rawSvg = aplicarCorSvg(rawSvg, item.hex);
        }
        finalSvg = rawSvg;
        source = 'UPSTREAM-EDGE-STASHED';

        if (ctx && typeof ctx.waitUntil === 'function' && env && env.ICONS_R2 && typeof env.ICONS_R2.put === 'function') {
          ctx.waitUntil(env.ICONS_R2.put(`icons/svg/${item.slug}.svg`, finalSvg, {
            httpMetadata: { contentType: 'image/svg+xml' }
          }));
        }
      }
    } catch (_) {}
  }

  // 6. Camada 6: Fallback com Emblema
  if (!finalSvg) {
    finalSvg = gerarSvgEmblemaMarca(item, effectiveColor);
    source = 'EDGE-VECTOR-FALLBACK';
  }

  // Aplicação de tema adaptativo se theme=auto
  if (theme === 'auto' && !corCustomizada) {
    finalSvg = injetarAutoTemaSvg(finalSvg, item.hex || '000000');
  }

  // Aplicação de moldura (bg=circle | rounded | hex)
  if (bg) {
    finalSvg = aplicarMolduraSvg(finalSvg, bg, theme);
  }

  svgMemoryCache.set(cacheKey, finalSvg);
  return { svg: finalSvg, source };
}


// HTML_STUDIO importado de ./site-assets.js

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

    // 0.1 Verifica??o de Cache Anycast Nativo Cloudflare (Sub-1ms)
    const hasEdgeCache = typeof caches !== 'undefined' && caches.default && request.method === 'GET';
    const cacheKey = hasEdgeCache ? new Request(url.toString(), { method: 'GET' }) : null;
    if (hasEdgeCache && !path.includes('/health') && !path.includes('/status') && path !== '/') {
      try {
        const cached = await caches.default.match(cacheKey);
        if (cached) {
          const res = new Response(cached.body, cached);
          res.headers.set('CF-Cache-Status', 'HIT');
          res.headers.set('X-Edge-Cache', 'HIT (<1ms Anycast RAM)');
          return res;
        }
      } catch (_) {}
    }

    // Status & Health
    const acceptsHtml = (request.headers.get('Accept') || '').includes('text/html');
    const wantsJson = url.searchParams.get('format') === 'json' || (request.headers.get('Accept') || '').includes('application/json');

    // Se for navegador acessando a raiz, entrega o Est?dio Visual Completo
    if (path === '/' && acceptsHtml && !wantsJson) {
      return new Response(HTML_STUDIO, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS }
      });
    }

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

    
    // ── ROTA SOBERANA DE FONTES WOFF2 ANYCAST (/api/fonts/:name ou /fonts/:name) ──
    if (path === '/api/fonts' || path === '/fonts' || path === '/api/fonts/list') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'Icons & Fontes Pro — Catálogo de Fontes de Borda',
        totalFontes: SOVEREIGN_FONTS_CATALOG.length,
        descricao: 'Catálogo oficial de tipografias WOFF2 das maiores plataformas de design e vídeo (Canva, CapCut, Adobe, TikTok)',
        fontes: SOVEREIGN_FONTS_CATALOG
      }, null, 2), {
        status: 200,
        headers: calcResponseHeaders('application/json')
      });
    }

    // Download Direto de Arquivo de Fonte WOFF2
    if (path.startsWith('/api/fonts/download/') || path.startsWith('/fonts/download/')) {
      let fontName = path.split('/').pop().toLowerCase();
      if (!fontName.endsWith('.woff2')) fontName += '.woff2';
      try {
        const fs = await import('fs');
        const pathModule = await import('path');
        const { fileURLToPath } = await import('url');
        const curDir = pathModule.dirname(fileURLToPath(import.meta.url));
        const localFont = pathModule.join(curDir, 'fonts', fontName);
        if (fs.existsSync(localFont)) {
          const fontBuf = fs.readFileSync(localFont);
          return new Response(fontBuf, {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'font/woff2',
              'Content-Disposition': `attachment; filename="${fontName}"`,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'X-Ponte-Asset': 'Download Fonte Soberana'
            }
          });
        }
      } catch (_) {}
    }

    if (path.startsWith('/api/fonts/') || path.startsWith('/fonts/')) {
      const fontFile = path.split('/').pop().toLowerCase();
      try {
        const fs = await import('fs');
        const pathModule = await import('path');
        const { fileURLToPath } = await import('url');
        const curDir = pathModule.dirname(fileURLToPath(import.meta.url));
        const localFont = pathModule.join(curDir, 'fonts', fontFile);
        if (fs.existsSync(localFont)) {
          const fontBuf = fs.readFileSync(localFont);
          return new Response(fontBuf, {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'font/woff2',
              'Cache-Control': 'public, max-age=31536000, immutable',
              'X-Ponte-Asset': 'Fontes Soberanas Anycast'
            }
          });
        }
      } catch (_) {}

      if (env && env.ICONS_R2) {
        try {
          const obj = await env.ICONS_R2.get(`fonts/${fontFile}`);
          if (obj) {
            return new Response(obj.body, {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                'Content-Type': 'font/woff2',
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Ponte-Asset': 'R2 Fontes Anycast'
              }
            });
          }
        } catch (_) {}
      }
    }

    
    // Geração Dinâmica de CSS @font-face Soberano (/api/fonts/css/:id)
    if (path.startsWith('/api/fonts/css/') || path.startsWith('/fonts/css/')) {
      const fontId = path.split('/').pop().toLowerCase().replace('.css', '');
      const font = SOVEREIGN_FONTS_CATALOG.find(f => f.id === fontId);
      const fontName = font ? font.name : fontId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const css = `@font-face {\n  font-family: '${fontName}';\n  src: url('/api/fonts/${fontId}.woff2') format('woff2');\n  font-weight: 100 900;\n  font-style: normal;\n  font-display: swap;\n}\n`;
      return new Response(css, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Ponte-Asset': 'CSS Soberano de Fonte'
        }
      });
    }

    // ── ROTA SOBERANA DE SÍMBOLOS, MOEDAS E ENTIDADES HTML (/api/simbolos) ──
    if (path === '/api/simbolos' || path === '/api/simbolos/todos' || path === '/simbolos') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const cat = (url.searchParams.get('categoria') || url.searchParams.get('cat') || '').trim().toLowerCase();
      
      let list = SOVEREIGN_SYMBOLS_CATALOG;
      if (cat && cat !== 'todas') {
        list = list.filter(s => s.cat.toLowerCase().includes(cat));
      }
      if (q) {
        list = list.filter(s => 
          s.name.toLowerCase().includes(q) ||
          s.char.includes(q) ||
          s.entity.toLowerCase().includes(q) ||
          (s.tags && s.tags.some(t => t.toLowerCase().includes(q)))
        );
      }

      const categorias = ['Todas', ...new Set(SOVEREIGN_SYMBOLS_CATALOG.map(s => s.cat))];

      return new Response(JSON.stringify({
        ok: true,
        service: 'Símbolos, Moedas & Entidades HTML Pro',
        total: list.length,
        totalCatalogo: SOVEREIGN_SYMBOLS_CATALOG.length,
        categorias,
        simbolos: list
      }, null, 2), {
        status: 200,
        headers: calcResponseHeaders('application/json')
      });
    }

    if (path.startsWith('/api/simbolos/busca')) {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const list = SOVEREIGN_SYMBOLS_CATALOG.filter(s => 
        s.name.toLowerCase().includes(q) ||
        s.char.includes(q) ||
        s.entity.toLowerCase().includes(q) ||
        (s.tags && s.tags.some(t => t.toLowerCase().includes(q)))
      );
      return new Response(JSON.stringify({ ok: true, query: q, total: list.length, resultados: list }, null, 2), {
        status: 200,
        headers: calcResponseHeaders('application/json')
      });
    }

    // ── ROTA SOBERANA DE EMOJIS UNICODE 15.1 (/api/emojis) ──
    if (path === '/api/emojis' || path === '/api/emojis/todos' || path === '/emojis') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const grupo = (url.searchParams.get('grupo') || url.searchParams.get('group') || '').trim().toLowerCase();
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const perPage = Math.min(500, Math.max(1, parseInt(url.searchParams.get('perPage') || '100', 10)));

      let list = EMOJIS_CATALOG;
      if (grupo && grupo !== 'todos') {
        list = list.filter(e => e.g.toLowerCase().includes(grupo));
      }
      if (q) {
        list = list.filter(e => e.n.toLowerCase().includes(q) || e.c.includes(q) || e.s.toLowerCase().includes(q));
      }

      const total = list.length;
      const startIndex = (page - 1) * perPage;
      const paginated = list.slice(startIndex, startIndex + perPage);
      const grupos = ['Todos', ...new Set(EMOJIS_CATALOG.map(e => e.g))];

      return new Response(JSON.stringify({
        ok: true,
        service: 'Unicode 15.1 Emojis Pro (5.042 Emojis Soberanos)',
        page,
        perPage,
        total,
        totalCatalogo: EMOJIS_CATALOG.length,
        grupos,
        emojis: paginated
      }, null, 2), {
        status: 200,
        headers: calcResponseHeaders('application/json')
      });
    }

    if (path.startsWith('/api/emojis/busca')) {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
      const list = EMOJIS_CATALOG.filter(e => e.n.toLowerCase().includes(q) || e.c.includes(q) || e.s.toLowerCase().includes(q)).slice(0, limit);
      return new Response(JSON.stringify({ ok: true, query: q, total: list.length, resultados: list }, null, 2), {
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

    // Renderização / Entrega de SVG por Slug na Borda Anycast
    const cleanPath = path.replace(/\.(svg|png)$/i, '');
    const match = cleanPath.match(/^\/api\/icons\/([a-zA-Z0-9_\-\.]+)$/i) || cleanPath.match(/^\/([a-zA-Z0-9_\-\.]+)$/i);
    if (match && cleanPath !== '/' && cleanPath !== '/health' && cleanPath !== '/status' && cleanPath !== '/api/status' && cleanPath !== '/api/icons/search' && cleanPath !== '/api/icons/info' && cleanPath !== '/search' && cleanPath !== '/info') {
      const rawSlug = match[1];
      const color = url.searchParams.get('color') || url.searchParams.get('c');
      const theme = (url.searchParams.get('theme') || url.searchParams.get('t') || '').toLowerCase();
      const bg = url.searchParams.get('bg');
      const item = localizarIcone(rawSlug) || {
        title: rawSlug,
        slug: titleToSlug(rawSlug),
        hex: '10b981'
      };

      const { svg: svgContent, source } = await obterSvgDoIcone(item, color, theme, bg, env, ctx);

      return new Response(svgContent, {
        status: 200,
        headers: {
          ...calcResponseHeaders('image/svg+xml; charset=utf-8'),
          'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400, immutable',
          'CDN-Cache-Control': 'public, max-age=31536000, immutable',
          'Cloudflare-CDN-Cache-Control': 'public, max-age=31536000, immutable',
          'X-Edge-Delivery': source,
          'X-Edge-Anycast': 'Cloudflare Global Edge Network (330+ POPs)'
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

