import worker from './worker.js';
import { IconsPro } from './icons-pro.js';

console.log('🧪 Iniciando Bateria de Testes do IconsPro SDK & API...\n');

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

// 1. Teste de Busca de Ícones
const resSearch = await worker.fetch(new Request('https://api.test/api/icons/search?q=git'));
assert(resSearch.status === 200, 'Busca de marcas retorna 200 OK');
const bodySearch = await resSearch.json();
assert(bodySearch.ok === true, 'JSON de busca com ok: true');
assert(bodySearch.resultados.some(i => i.slug === 'github'), 'Encontra GitHub no catálogo');

// 2. Teste de Metadados
const resInfo = await worker.fetch(new Request('https://api.test/api/icons/info?name=whatsapp'));
assert(resInfo.status === 200, 'Info de ícone retorna 200 OK');
const bodyInfo = await resInfo.json();
assert(bodyInfo.icone.hex === '25D366', 'Hex oficial do WhatsApp correto (25D366)');

// 3. Teste de Renderização SVG
const resSvg = await worker.fetch(new Request('https://api.test/api/icons/whatsapp.svg?color=10b981'));
assert(resSvg.status === 200, 'Rota de SVG retorna 200 OK');
assert(resSvg.headers.get('Content-Type').includes('image/svg+xml'), 'Content-Type é image/svg+xml');
const svgText = await resSvg.text();
assert(svgText.includes('<svg') && svgText.includes('#10b981'), 'SVG gerado com cor customizada aplicada');

// 4. Teste do SDK
const urlSdk = IconsPro.getIconUrl('docker', { color: '2496ED' });
assert(urlSdk.includes('docker.svg?color=2496ED'), 'SDK gera URL de ícone corretamente com cor');

console.log(`\n🎉 Todos os ${pass} testes do IconsPro passaram com sucesso!`);
