export interface IconInfo {
  title: string;
  slug: string;
  hex: string;
  source?: string;
  url: string;
}

export class IconsPro {
  static baseUrl: string;
  static apiKey: string;
  static configure(config: { baseUrl?: string; apiKey?: string }): void;
  static getIconUrl(slug: string, options?: { color?: string; format?: 'svg' | 'png' }): string;
  static buscar(query: string, options?: { limit?: number }): Promise<{ ok: boolean; total: number; resultados: IconInfo[] }>;
  static getInfo(slug: string): Promise<{ ok: boolean; icone: IconInfo }>;
}
