import worker from './worker.js';
import { IconsPro } from './icons-pro.js';

console.log('🧪 Iniciando Bateria Completa de Testes do IconsPro (Padrão 1 req/s, Latência <1s, Ícones Desconhecidos e Proteção de Cota)...\n');

let pass = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ FALHA: ${msg}`);
    throw new Error(msg);
  }
}

// ─── 1. TESTES BASE (COMPATIBILIDADE) ───
console.log('📦 1. Testes de Compatibilidade Base');
const resSearch = await worker.fetch(new Request('https://api.test/api/icons/search?q=git'));
assert(resSearch.status === 200, 'Busca de marcas retorna 200 OK');
const bodySearch = await resSearch.json();
assert(bodySearch.ok === true, 'JSON de busca com ok: true');
assert(bodySearch.catalogoTotal >= 3470, `Catálogo completo carregado em memória (${bodySearch.catalogoTotal} ícones)`);
assert(bodySearch.resultados.some(i => i.slug === 'github'), 'Encontra GitHub no catálogo');

const resInfo = await worker.fetch(new Request('https://api.test/api/icons/info?name=whatsapp'));
assert(resInfo.status === 200, 'Info de ícone retorna 200 OK');
const bodyInfo = await resInfo.json();
assert(bodyInfo.icone.hex === '25D366', 'Hex oficial do WhatsApp correto (25D366)');

const resSvg = await worker.fetch(new Request('https://api.test/api/icons/whatsapp.svg?color=10b981'));
assert(resSvg.status === 200, 'Rota de SVG retorna 200 OK');
assert(resSvg.headers.get('Content-Type').includes('image/svg+xml'), 'Content-Type é image/svg+xml');
const svgText = await resSvg.text();
assert(svgText.includes('<svg') && svgText.includes('#10b981'), 'SVG gerado com cor customizada aplicada');

const urlSdk = IconsPro.getIconUrl('docker', { color: '2496ED' });
assert(urlSdk.includes('docker.svg?color=2496ED'), 'SDK gera URL de ícone corretamente com cor');

// ─── 2. TESTE DE LOCALIZAÇÃO DE ÍCONES PEQUENOS E DESCONHECIDOS ───
console.log('\n🔍 2. Teste de Ícones Pequenos, Niche, Desconhecidos e Pontuações Especiais');
const obscureIcons = [
  { termo: '1001tracklists', expectedSlug: '1001tracklists', title: '1001Tracklists' },
  { termo: 'activitypub', expectedSlug: 'activitypub', title: 'ActivityPub' },
  { termo: 'zig', expectedSlug: 'zig', title: 'Zig' },
  { termo: 'neovim', expectedSlug: 'neovim', title: 'Neovim' },
  { termo: 'sqlite', expectedSlug: 'sqlite', title: 'SQLite' },
  { termo: 'alacritty', expectedSlug: 'alacritty', title: 'Alacritty' },
  { termo: 'dunzo', expectedSlug: 'dunzo', title: 'Dunzo' },
  { termo: 'freebsd', expectedSlug: 'freebsd', title: 'FreeBSD' },
  { termo: 'zsh', expectedSlug: 'zsh', title: 'Zsh' },
  { termo: 'auth0', expectedSlug: 'auth0', title: 'Auth0' },
  { termo: '500px', expectedSlug: '500px', title: '500px' },
  { termo: '.net', expectedSlug: 'dotnet', title: '.NET' },
  { termo: 'c++', expectedSlug: 'cplusplus', title: 'C++' },
  { termo: '1&1', expectedSlug: '1and1', title: '1&1' },
  { termo: '1.1.1.1', expectedSlug: '1dot1dot1dot1', title: '1.1.1.1' },
  { termo: 'node.js', expectedSlug: 'nodedotjs', title: 'Node.js' }
];

for (const icon of obscureIcons) {
  // A. Testa busca
  const sRes = await worker.fetch(new Request(`https://api.test/api/icons/search?q=${encodeURIComponent(icon.termo)}`));
  assert(sRes.status === 200, `Busca de '${icon.termo}' responde 200 OK`);
  const sData = await sRes.json();
  const achouBusca = sData.resultados.some(r => r.slug === icon.expectedSlug || r.title.toLowerCase() === icon.title.toLowerCase());
  assert(achouBusca, `Busca localizou ícone '${icon.title}' (slug: ${icon.expectedSlug})`);

  // B. Testa info direta
  const iRes = await worker.fetch(new Request(`https://api.test/api/icons/info?name=${encodeURIComponent(icon.termo)}`));
  assert(iRes.status === 200, `Info de '${icon.termo}' responde 200 OK`);
  const iData = await iRes.json();
  assert(iData.ok === true && iData.icone.slug === icon.expectedSlug, `Info retornou metadados exatos para '${icon.title}' (hex: #${iData.icone.hex})`);

  // C. Testa entrega de SVG
  const svgRes = await worker.fetch(new Request(`https://api.test/api/icons/${icon.expectedSlug}.svg`));
  assert(svgRes.status === 200, `SVG de '${icon.expectedSlug}' responde 200 OK`);
  assert(svgRes.headers.get('Content-Type').includes('image/svg+xml'), `SVG de '${icon.expectedSlug}' com Content-Type correto`);
  const svgContent = await svgRes.text();
  assert(svgContent.includes('<svg') && svgContent.includes('</svg>'), `SVG de '${icon.expectedSlug}' é um vetor XML válido`);
}

// ─── 3. TESTE DE GARANTIA DE ENTREGA EM < 1 SEGUNDO (SLA RÁPIDO) ───
console.log('\n⏱️ 3. Teste de Garantia de Entrega em < 1 Segundo (Sem Estourar SLA/Timeout)');
const perfTests = [
  'https://api.test/api/icons/search?q=database',
  'https://api.test/api/icons/info?name=neovim',
  'https://api.test/api/icons/sqlite.svg',
  'https://api.test/api/icons/cplusplus.svg?color=ff0000',
  'https://api.test/api/icons/search?q=cloud&limit=100'
];

for (const pUrl of perfTests) {
  const t0 = performance.now();
  const res = await worker.fetch(new Request(pUrl, {
    headers: { 'Authorization': 'Bearer ico_master_perf_check' }
  }));
  const elapsed = performance.now() - t0;
  assert(res.status === 200, `Requisição para ${pUrl} respondeu 200 OK`);
  assert(elapsed < 1000, `Entregue em ${elapsed.toFixed(2)}ms (garantia < 1.000ms cumprida)`);
}

// ─── 4. TESTE DE PADRÃO 1 REQ/S E PROTEÇÃO CONTRA ESTOURO DE COTA ───
console.log('\n🛡️ 4. Teste de Padrão 1 req/s, Headers RFC e Proteção contra Estouro de Cota');

// A. Teste de conformidade no ritmo padrão 1 req/s (5 requisições simuladas)
const clientIp = 'client_1req_sec_test';
for (let i = 1; i <= 5; i++) {
  const res = await worker.fetch(new Request('https://api.test/api/icons/info?name=docker', {
    headers: { 'cf-connecting-ip': clientIp }
  }));
  assert(res.status === 200, `Requisição #${i} a 1 req/s foi aprovada com 200 OK`);
  const remaining = parseInt(res.headers.get('X-RateLimit-Remaining'), 10);
  assert(remaining === 60 - i, `Header X-RateLimit-Remaining decrementa corretamente (${remaining})`);
  assert(res.headers.get('X-DailyLimit-Limit') === '500', 'Header X-DailyLimit-Limit informa cota diária de 500');
}

// B. Teste de rajada (burst) para verificar bloqueio 429 e proteção da cota
console.log('\n💥 5. Teste de Bloqueio por Rajada (Burst > 60 RPM)');
const burstIp = 'client_burst_attacker';
let blocked429 = false;
let retryAfter = 0;

for (let i = 1; i <= 65; i++) {
  const res = await worker.fetch(new Request('https://api.test/api/icons/info?name=docker', {
    headers: { 'cf-connecting-ip': burstIp }
  }));
  if (res.status === 429) {
    blocked429 = true;
    retryAfter = parseInt(res.headers.get('Retry-After'), 10);
    const body = await res.json();
    assert(body.error === 'RATE_LIMIT_EXCEEDED', `Retorna erro estruturado 'RATE_LIMIT_EXCEEDED' na requisição #${i}`);
    break;
  }
}
assert(blocked429, 'Bloqueia rajada abusiva com 429 Too Many Requests para proteger a cota');
assert(retryAfter >= 1, `Header Retry-After presente informando tempo de espera (${retryAfter}s)`);

// C. Teste de chave Pro e Master (suporta volume elevado sem 429)
console.log('\n⭐ 6. Teste de Chaves com Cotas Maiores (Pro e Master)');
const proKey = 'ico_pro_token_valido_12345';
const resPro = await worker.fetch(new Request('https://api.test/api/icons/info?name=python', {
  headers: { 'Authorization': `Bearer ${proKey}` }
}));
assert(resPro.status === 200, 'Chave Pro autorizada com 200 OK');
assert(resPro.headers.get('X-RateLimit-Limit') === '600', 'Plano Pro tem limite de 600 RPM');
assert(resPro.headers.get('X-DailyLimit-Limit') === '30000', 'Plano Pro tem cota diária de 30.000 requisições');

const masterKey = 'ico_master_root_admin';
const resMaster = await worker.fetch(new Request('https://api.test/api/icons/info?name=react', {
  headers: { 'Authorization': `Bearer ${masterKey}` }
}));
assert(resMaster.status === 200, 'Chave Master autorizada com 200 OK');
assert(resMaster.headers.get('X-RateLimit-Limit') === '5000', 'Plano Master tem limite de 5.000 RPM');
assert(resMaster.headers.get('X-DailyLimit-Limit') === 'unlimited', 'Plano Master tem cota diária ilimitada');

console.log(`\n🎉 Todos os ${pass} testes do IconsPro passaram com 100% de sucesso!`);

