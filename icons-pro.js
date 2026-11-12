/**
 * icons-pro.js
 * SDK Oficial para Icons Pro — Logos e Ícones Globais na Borda
 * 
 * @license MIT
 * @see https://github.com/clepta2/icons-pro
 */

export class IconsPro {
  static baseUrl = 'https://ponte.ozpro.com.br';
  static apiKey = '';

  static configure(config = {}) {
    if (config.baseUrl) this.baseUrl = config.baseUrl.replace(/\/$/, '');
    if (config.apiKey) this.apiKey = config.apiKey;
  }

  static getIconUrl(slug, options = {}) {
    if (!slug) return '';
    const cleanSlug = String(slug).toLowerCase().trim().replace(/\.(svg|png)$/, '');
    const ext = options.format === 'png' ? 'png' : 'svg';
    const params = new URLSearchParams();
    if (options.color) params.set('color', options.color);
    const query = params.toString() ? `?${params.toString()}` : '';
    return `${this.baseUrl}/api/icons/${cleanSlug}.${ext}${query}`;
  }

  static async buscar(query, options = {}) {
    const params = new URLSearchParams({ q: String(query || '') });
    if (options.limit) params.set('limit', String(options.limit));

    const resp = await fetch(`${this.baseUrl}/api/icons/search?${params.toString()}`, {
      headers: {
        'Accept': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {})
      }
    });

    if (!resp.ok) {
      return { ok: false, status: resp.status, resultados: [] };
    }
    return await resp.json();
  }

  static async getInfo(slug) {
    const params = new URLSearchParams({ name: String(slug || '') });
    const resp = await fetch(`${this.baseUrl}/api/icons/info?${params.toString()}`, {
      headers: {
        'Accept': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {})
      }
    });

    if (!resp.ok) {
      return { ok: false, status: resp.status };
    }
    return await resp.json();
  }
}

export default IconsPro;
