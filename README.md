# Icons Pro API & SDK Oficial

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Edge Latency](https://img.shields.io/badge/Latency-%3C3ms-10b981.svg)](https://ponte.ozpro.com.br)
[![Cloudflare R2](https://img.shields.io/badge/Storage-Cloudflare%20R2-F38020.svg)](https://developers.cloudflare.com/r2/)

SDK e API Oficial de **Logos Globais, Marcas e Ícones SVG na Borda Cloudflare Edge Anycast** com armazenamento R2, suporte a coloração dinâmica e auto-descoberta.

---

## 🚀 Instalação & Uso Rápido

```bash
npm install icons-pro
```

### Exemplo em HTML
```html
<!-- Logotipo do WhatsApp com cor customizada verde emerald -->
<img src="https://ponte.ozpro.com.br/api/icons/whatsapp.svg?color=10b981" width="32" height="32" alt="WhatsApp" />
```

### Exemplo em Node.js
```javascript
import { IconsPro } from 'icons-pro';

// 1. Busca por nome da marca
const busca = await IconsPro.buscar('github');
console.log(busca.resultados);

// 2. Gera URL formatada com cor customizada
const url = IconsPro.getIconUrl('docker', { color: '2496ED' });
console.log(url);
```

---

## 🧪 Testes Unitários

```bash
npm test
```

Licença **MIT** &copy; 2026 Clepta Tech.
