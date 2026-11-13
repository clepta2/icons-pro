/**
 * build-all-svgs.js
 * Gera todos os 3.470 arquivos SVG otimizados para upload no Cloudflare R2 Edge Bucket
 * Execução: node scripts/build-all-svgs.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'svg');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 1. Tentar ler do arquivo temporário com os paths
const tempFile = 'C:/Users/Win10/AppData/Local/Temp/1794599716402-copilot-tool-output-27536-190f620e-5f5d-4eab-8b80-c9f6a2090c18.txt';

if (!fs.existsSync(tempFile)) {
  console.error('Arquivo temporário de paths não encontrado. Execute o download via unpkg.');
  process.exit(1);
}

const content = fs.readFileSync(tempFile, 'utf8');
const regex = /title:\"(.*?)\",slug:\"(.*?)\",.*?path:\"(.*?)\"/g;
let match;
let count = 0;

console.log('🚀 Gerando 3.470 arquivos SVG otimizados na pasta svg/ ...');

while ((match = regex.exec(content)) !== null) {
  const title = match[1];
  const slug = match[2];
  const svgPath = match[3];

  const svgContent = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${title}</title><path d="${svgPath}"/></svg>`;
  fs.writeFileSync(path.join(outDir, `${slug}.svg`), svgContent, 'utf8');
  count++;
}

console.log(`✅ Sucesso! ${count} arquivos SVG foram gerados em: ${outDir}`);
console.log('📦 Para sincronizar com o Cloudflare R2:');
console.log('   npx wrangler r2 object put ozpro-icons/icons/svg/<slug>.svg --file=svg/<slug>.svg');
