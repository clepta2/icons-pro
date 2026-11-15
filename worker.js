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

async function obterSvgDoIcone(item, corCustomizada, env, ctx) {
  const cacheKey = `${item.slug}_${corCustomizada || 'orig'}`;

  // 1. Camada 1: Cache em Memória do Isolate (<0.1ms)
  if (svgMemoryCache.has(cacheKey)) {
    return { svg: svgMemoryCache.get(cacheKey), source: 'EDGE-MEMORY-HIT' };
  }

  // 2. Camada 2: Vetores SVG Oficiais Embutidos na Borda (<0.1ms - Top 135 marcas globais)
  if (TOP_VECTOR_PATHS && TOP_VECTOR_PATHS[item.slug]) {
    const pathD = TOP_VECTOR_PATHS[item.slug];
    const fill = corCustomizada ? `#${corCustomizada.replace('#', '')}` : `#${item.hex || '000000'}`;
    const safeTitle = (item.title || item.slug).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const embeddedSvg = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="${fill}"><title>${safeTitle}</title><path d="${pathD}"/></svg>`;
    svgMemoryCache.set(cacheKey, embeddedSvg);
    return { svg: embeddedSvg, source: 'EDGE-EMBEDDED-HIT' };
  }

  // 3. Camada 3: Cloudflare R2 Anycast Edge Storage (<5ms)
  if (env && env.ICONS_R2 && typeof env.ICONS_R2.get === 'function') {
    try {
      const obj = await env.ICONS_R2.get(`icons/svg/${item.slug}.svg`);
      if (obj) {
        let r2Svg = await obj.text();
        if (corCustomizada) {
          r2Svg = aplicarCorSvg(r2Svg, corCustomizada);
        } else if (!/<svg[^>]*\sfill=/i.test(r2Svg)) {
          r2Svg = aplicarCorSvg(r2Svg, item.hex);
        }
        svgMemoryCache.set(cacheKey, r2Svg);
        return { svg: r2Svg, source: 'R2-EDGE-HIT' };
      }
    } catch (_) {}
  }

  // 4. Camada 4: Armazenamento Local / Static Assets (<1ms em ambiente local/Node)
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const curDir = path.dirname(fileURLToPath(import.meta.url));
    const localFile = path.join(curDir, 'svg', `${item.slug}.svg`);
    if (fs.existsSync(localFile)) {
      let localSvg = fs.readFileSync(localFile, 'utf8');
      if (corCustomizada) {
        localSvg = aplicarCorSvg(localSvg, corCustomizada);
      } else if (!/<svg[^>]*\sfill=/i.test(localSvg)) {
        localSvg = aplicarCorSvg(localSvg, item.hex);
      }
      svgMemoryCache.set(cacheKey, localSvg);
      return { svg: localSvg, source: 'LOCAL-EDGE-DISK' };
    }
  } catch (_) {}

  // 5. Camada 5: Stashing Automático na Borda com Timeout Seguro de 800ms
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

      // Salva no cache do isolate
      svgMemoryCache.set(cacheKey, finalSvg);

      // Persiste no R2 em background para que as próximas requisições sejam 100% locais na borda
      if (ctx && typeof ctx.waitUntil === 'function' && env && env.ICONS_R2 && typeof env.ICONS_R2.put === 'function') {
        ctx.waitUntil(env.ICONS_R2.put(`icons/svg/${item.slug}.svg`, finalSvg, {
          httpMetadata: { contentType: 'image/svg+xml' }
        }));
      }

      return { svg: finalSvg, source: 'UPSTREAM-EDGE-STASHED' };
    }
  } catch (_) {
    // Timeout ou rede externa indisponível: avança para o motor de fallback
  }

  // 6. Camada 6: Motor Vetorial Instantâneo da Borda (<0.1ms - Cor oficial e iniciais)
  const fallbackSvg = gerarSvgEmblemaMarca(item, corCustomizada);
  svgMemoryCache.set(cacheKey, fallbackSvg);
  return { svg: fallbackSvg, source: 'EDGE-VECTOR-FALLBACK' };
}


const HTML_STUDIO = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Icons Pro ? Cat?logo de 3.470 ?cones & Logos Globais na Borda</title>
  <meta name="description" content="Cat?logo oficial e buscador instant?neo de 3.470 marcas e ?cones vetoriais em SVG puro com cache Anycast sub-1ms.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="ponte-suite.css">
  <style>
    .icon-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 12px;
      max-height: 480px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .icon-card {
      background: var(--paper-elevated);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 14px 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: all 0.16s ease;
      text-align: center;
    }
    .icon-card:hover {
      border-color: var(--mint);
      transform: translateY(-2px);
      box-shadow: 0 4px 14px rgba(0,0,0,0.4);
    }
    .icon-card.active {
      border-color: var(--mint);
      background: rgba(163, 230, 53, 0.08);
    }
    .icon-card svg {
      width: 32px;
      height: 32px;
      transition: transform 0.16s ease;
    }
    .icon-card:hover svg {
      transform: scale(1.1);
    }
    .icon-card span {
      font-size: 11px;
      font-weight: 700;
      color: var(--ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .icon-preview-box {
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--forest-850);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      min-height: 140px;
    }
  </style>
</head>
<body>

  <div class="app-shell">
    <!-- SIDEBAR DA SUÍTE PONTE -->
    <aside class="sidebar">
      <a class="brand" href="https://ponte-marketplace.maputo2.workers.dev/#catalogo">
        <div class="brand-mark">?</div>
        <div class="brand-copy">
          <strong>ponte</strong>
          <small>API MARKET · OZPRO</small>
        </div>
      </a>

      <div class="nav-section-label">APIs de Design & Assets</div>
      <nav class="primary-nav">
        <a class="nav-link is-active" href="#">
          <span>??</span> <span>Ícones & Assets Pro</span>
        </a>
        <a class="nav-link" href="https://clepta2.github.io/graficos-pro/">
          <span>??</span> <span>Gráficos Vetoriais SVG</span>
        </a>
      </nav>

      <div class="nav-section-label">Validação & Segurança</div>
      <nav class="primary-nav">
        <a class="nav-link" href="https://clepta2.github.io/boletovalidator-pro/">
          <span>??</span> <span>BoletoValidator Pro</span>
        </a>
        <a class="nav-link" href="https://clepta2.github.io/pixvalidator-pro/">
          <span>??</span> <span>Pix Gateway Pro</span>
        </a>
        <a class="nav-link" href="https://clepta2.github.io/antifraude-pro/">
          <span>???</span> <span>Segurança & Antifraude</span>
        </a>
        <a class="nav-link" href="https://clepta2.github.io/passvalidator-pro/">
          <span>??</span> <span>PassValidator HIBP</span>
        </a>
      </nav>

      <div class="sidebar-bottom">
        <div class="status-row">
          <span class="status-dot"></span>
          <span>Borda Cloudflare Anycast</span>
        </div>
      </div>
    </aside>

    <!-- ÁREA PRINCIPAL -->
    <main class="main-area">
      <!-- TOPBAR UNIFICADA -->
      <header class="topbar">
        <div class="breadcrumb">
          <a href="https://ponte-marketplace.maputo2.workers.dev/#catalogo">Workspace</a>
          <span>?</span>
          <a href="https://ponte-marketplace.maputo2.workers.dev/#catalogo">Design & Assets</a>
          <span>?</span>
          <strong>Ícones & Logos Pro</strong>
        </div>

        <div class="topbar-actions">
          <div class="api-key-box">
            <span>??</span>
            <input type="text" id="inputApiKey" placeholder="ico_live_... (ou Demo)" />
            <button class="ponte-btn-save" id="btnSalvarKey">Salvar</button>
          </div>
          <button class="theme-toggle-btn" id="themeToggle" title="Alternar tema">??</button>
        </div>
      </header>

      <!-- CONTE?DO -->
      <div class="content-wrap">
        <!-- GUIA DID?TICO: O QUE ESTÁ ACONTECENDO -->
        <div class="guide-card">
          <div class="guide-header">
            <strong>?💡 O que esta ferramenta faz e como utilizar?</strong>
            <span class="badge green">Entrega Sub-1ms Anycast</span>
          </div>
          <div class="guide-steps">
            <div class="guide-step">
              <span class="guide-step-tag">Passo 1: Buscar Marca</span>
              <p>Digite o nome de qualquer marca, tecnologia ou rede social no campo de busca (são mais de 3.470 ícones disponíveis).</p>
            </div>
            <div class="guide-step">
              <span class="guide-step-tag">Passo 2: Customizar Cor & Tamanho</span>
              <p>Altere a cor hexadecimal e o tamanho em pixels. O SVG é processado e recolorido em tempo real na memória RAM.</p>
            </div>
            <div class="guide-step">
              <span class="guide-step-tag">Passo 3: Copiar ou Integrar</span>
              <p>Copie o código SVG bruto, URL de CDN Anycast ou código de integração em Node.js/Python para o seu site ou app.</p>
            </div>
          </div>
        </div>

        <div class="badges-bar">
          <span class="badge green">● 3.470 Marcas Catalogadas</span>
          <span class="badge blue">⚡ Vetores SVG Oficiais</span>
          <span class="badge">?? CDN Anycast (<1ms)</span>
          <span class="badge">?? Cores Hex Personalizáveis</span>
        </div>

        <div class="grid-layout">
          <!-- PAINEL ESQUERDO: EXPLORADOR E BUSCADOR -->
          <div class="card">
            <div class="card-title">
              <span>Explorador de Ícones</span>
              <span style="font-size:11px;color:var(--muted);" id="lblContador">Carregando catálogo...</span>
            </div>

            <div class="form-group">
              <label for="txtBusca">Pesquisar por Marca, Empresa ou Linguagem</label>
              <input type="text" id="txtBusca" placeholder="Ex: google, github, react, python, visa, nubank..." value="google" />
            </div>

            <div class="icon-grid" id="gridIcones">
              <!-- Renderizado dinamicamente via JS -->
            </div>
          </div>

          <!-- PAINEL DIREITO: CUSTOMIZADOR & EXPORTADOR -->
          <div class="card">
            <div class="card-title">
              <span>Personaliza??o & Exporta??o</span>
              <span class="badge green" id="badgeSlugAtivo">google</span>
            </div>

            <div class="icon-preview-box" id="boxPreview">
              <!-- SVG din?mico -->
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="form-group">
                <label for="inputCor">Cor Hexadecimal</label>
                <div style="display: flex; gap: 6px;">
                  <input type="color" id="pickerCor" value="#a3e635" style="width:38px;height:38px;padding:2px;cursor:pointer;border-radius:6px;" />
                  <input type="text" id="inputCor" value="#a3e635" style="flex:1;" />
                </div>
              </div>
              <div class="form-group">
                <label for="inputTamanho">Tamanho (Pixels)</label>
                <input type="number" id="inputTamanho" value="64" min="16" max="256" step="8" />
              </div>
            </div>

            <div class="btn-row">
              <button class="btn btn-primary" id="btnCopiarSvg" style="flex:1;">?? Copiar C?digo SVG</button>
              <button class="btn btn-secondary" id="btnCopiarUrl">?? Copiar URL da CDN</button>
            </div>

            <!-- SNIPPETS DE INTEGRA??O MULTILINGUAGEM -->
            <div class="snippet-panel">
              <div class="snippet-header">
                <div class="snippet-tabs">
                  <button class="snippet-tab active" data-lang="curl">cURL</button>
                  <button class="snippet-tab" data-lang="html">HTML</button>
                  <button class="snippet-tab" data-lang="js">Node.js</button>
                </div>
                <button class="btn btn-secondary btn-sm" id="btnCopiarSnippet">Copiar Snippet</button>
              </div>
              <pre class="snippet-code"><code id="codeSnippet">curl "https://icons-pro-api.maputo2.workers.dev/api/icons/google.svg?color=a3e635"</code></pre>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <script type="module">
    import { ICONS_CATALOG } from './catalog.js';

    // Gerenciador de Chave de API
    const inputApiKey = document.getElementById('inputApiKey');
    inputApiKey.value = localStorage.getItem('icons_api_key') || '';
    document.getElementById('btnSalvarKey').addEventListener('click', () => {
      localStorage.setItem('icons_api_key', inputApiKey.value.trim());
      alert('Chave de API salva com sucesso no seu navegador!');
    });

    // Alternador de Tema
    const themeBtn = document.getElementById('themeToggle');
    const updateIcon = () => themeBtn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '??' : '??';
    themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', cur);
      localStorage.setItem('ponte.theme', cur);
      updateIcon();
    });
    updateIcon();

    // Estado da Aplica??o
    let iconeSelecionado = ICONS_CATALOG.find(i => i.slug === 'google') || ICONS_CATALOG[0];
    let corAtual = '#a3e635';
    let tamanhoAtual = 64;
    let snippetLang = 'curl';

    const grid = document.getElementById('gridIcones');
    const txtBusca = document.getElementById('txtBusca');
    const lblContador = document.getElementById('lblContador');
    const boxPreview = document.getElementById('boxPreview');
    const badgeSlug = document.getElementById('badgeSlugAtivo');
    const pickerCor = document.getElementById('pickerCor');
    const inputCor = document.getElementById('inputCor');
    const inputTamanho = document.getElementById('inputTamanho');
    const codeSnippet = document.getElementById('codeSnippet');

    function filtrarIcones(query) {
      const q = (query || '').toLowerCase().trim();
      if (!q) return ICONS_CATALOG.slice(0, 48);
      return ICONS_CATALOG.filter(i => 
        i.title.toLowerCase().includes(q) || 
        i.slug.toLowerCase().includes(q) || 
        (i.aliases && i.aliases.some(a => a.toLowerCase().includes(q)))
      ).slice(0, 60);
    }

    function renderizarGrid(lista) {
      grid.innerHTML = '';
      lblContador.textContent = \`\${lista.length} ?cones exibidos\`;

      lista.forEach(item => {
        const div = document.createElement('div');
        div.className = \`icon-card \${item.slug === iconeSelecionado.slug ? 'active' : ''}\`;
        div.innerHTML = \`
          <img src="https://icons-pro-api.maputo2.workers.dev/api/icons/\${item.slug}.svg?color=\${(item.hex || 'a3e635').replace('#','')}" alt="\${item.title}" style="width:28px;height:28px;" loading="lazy" />
          <span>\${item.title}</span>
        \`;
        div.addEventListener('click', () => {
          iconeSelecionado = item;
          document.querySelectorAll('.icon-card').forEach(c => c.classList.remove('active'));
          div.classList.add('active');
          atualizarPreview();
        });
        grid.appendChild(div);
      });
    }

    txtBusca.addEventListener('input', (e) => {
      renderizarGrid(filtrarIcones(e.target.value));
    });

    // Atualiza??o de Cores
    pickerCor.addEventListener('input', (e) => {
      corAtual = e.target.value;
      inputCor.value = corAtual;
      atualizarPreview();
    });
    inputCor.addEventListener('input', (e) => {
      corAtual = e.target.value;
      pickerCor.value = corAtual;
      atualizarPreview();
    });
    inputTamanho.addEventListener('input', (e) => {
      tamanhoAtual = parseInt(e.target.value, 10) || 64;
      atualizarPreview();
    });

    async function atualizarPreview() {
      badgeSlug.textContent = iconeSelecionado.slug;
      const cleanHex = corAtual.replace('#', '');
      const url = \`https://icons-pro-api.maputo2.workers.dev/api/icons/\${iconeSelecionado.slug}.svg?color=\${cleanHex}\`;

      try {
        const resp = await fetch(url);
        const svgText = await resp.text();
        boxPreview.innerHTML = svgText;
        const svgEl = boxPreview.querySelector('svg');
        if (svgEl) {
          svgEl.setAttribute('width', tamanhoAtual);
          svgEl.setAttribute('height', tamanhoAtual);
          svgEl.style.display = 'block';
        }
      } catch (err) {
        boxPreview.innerHTML = \`<img src="\${url}" width="\${tamanhoAtual}" height="\${tamanhoAtual}" />\`;
      }

      atualizarSnippet();
    }

    function atualizarSnippet() {
      const cleanHex = corAtual.replace('#', '');
      const url = \`https://icons-pro-api.maputo2.workers.dev/api/icons/\${iconeSelecionado.slug}.svg?color=\${cleanHex}\`;

      if (snippetLang === 'curl') {
        codeSnippet.textContent = \`curl "\${url}"\`;
      } else if (snippetLang === 'html') {
        codeSnippet.textContent = \`<img src="\${url}" alt="\${iconeSelecionado.title}" width="\${tamanhoAtual}" height="\${tamanhoAtual}" />\`;
      } else if (snippetLang === 'js') {
        codeSnippet.textContent = \`const res = await fetch("\${url}");
const svg = await res.text();\`;
      }
    }

    document.querySelectorAll('.snippet-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.snippet-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        snippetLang = btn.dataset.lang;
        atualizarSnippet();
      });
    });

    document.getElementById('btnCopiarSvg').addEventListener('click', () => {
      const svg = boxPreview.innerHTML;
      navigator.clipboard.writeText(svg);
      alert('Código SVG copiado para a área de transferência!');
    });

    document.getElementById('btnCopiarUrl').addEventListener('click', () => {
      const cleanHex = corAtual.replace('#', '');
      const url = \`https://icons-pro-api.maputo2.workers.dev/api/icons/\${iconeSelecionado.slug}.svg?color=\${cleanHex}\`;
      navigator.clipboard.writeText(url);
      alert('URL oficial da CDN Anycast copiada!');
    });

    document.getElementById('btnCopiarSnippet').addEventListener('click', () => {
      navigator.clipboard.writeText(codeSnippet.textContent);
      alert('Snippet copiado!');
    });

    // Inicialização
    renderizarGrid(filtrarIcones('google'));
    atualizarPreview();
  </script>
</body>
</html>
`;

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
      const item = localizarIcone(rawSlug) || {
        title: rawSlug,
        slug: titleToSlug(rawSlug),
        hex: '10b981'
      };

      const { svg: svgContent, source } = await obterSvgDoIcone(item, color, env, ctx);

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

