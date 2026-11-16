import fs from 'fs';
import path from 'path';

// Currencies
const currencies = [
  { char: 'R$', name: 'Real Brasileiro', cat: 'Moedas', subcat: 'Américas', hex: 'U+0052 U+0024', entity: 'R$', tags: ['real', 'brasil', 'brl', 'dinheiro', 'moeda', 'financeiro'] },
  { char: '$', name: 'Dólar Americano / Cifrão Universal', cat: 'Moedas', subcat: 'Global', hex: 'U+0024', entity: '&dollar;', tags: ['dolar', 'dollar', 'usd', 'cifrao', 'dinheiro', 'eua'] },
  { char: '€', name: 'Euro', cat: 'Moedas', subcat: 'Europa', hex: 'U+20AC', entity: '&euro;', tags: ['euro', 'europa', 'eur', 'uniao europeia'] },
  { char: '£', name: 'Libra Esterlina', cat: 'Moedas', subcat: 'Europa', hex: 'U+00A3', entity: '&pound;', tags: ['libra', 'pound', 'gbp', 'reino unido', 'londres'] },
  { char: '¥', name: 'Iene Japonês / Yuan Chinês', cat: 'Moedas', subcat: 'Ásia', hex: 'U+00A5', entity: '&yen;', tags: ['iene', 'yen', 'jpy', 'yuan', 'cny', 'japao', 'china'] },
  { char: '₿', name: 'Bitcoin', cat: 'Moedas', subcat: 'Criptomoedas', hex: 'U+20BF', entity: '&#8383;', tags: ['bitcoin', 'btc', 'crypto', 'cripto', 'blockchain', 'satoshi'] },
  { char: '¢', name: 'Centavo / Cent', cat: 'Moedas', subcat: 'Subunidades', hex: 'U+00A2', entity: '&cent;', tags: ['cent', 'centavo', 'cents', 'subdivisao'] },
  { char: '₹', name: 'Rupia Indiana', cat: 'Moedas', subcat: 'Ásia', hex: 'U+20B9', entity: '&#8377;', tags: ['rupia', 'rupee', 'inr', 'india'] },
  { char: '₽', name: 'Rublo Russo', cat: 'Moedas', subcat: 'Europa/Ásia', hex: 'U+20BD', entity: '&#8381;', tags: ['rublo', 'ruble', 'rub', 'russia'] },
  { char: '₩', name: 'Won Sul-Coreano', cat: 'Moedas', subcat: 'Ásia', hex: 'U+20A9', entity: '&#8361;', tags: ['won', 'krw', 'coreia', 'korea'] },
  { char: '₺', name: 'Lira Turca', cat: 'Moedas', subcat: 'Oriente Médio', hex: 'U+20BA', entity: '&#8378;', tags: ['lira', 'try', 'turquia', 'turkey'] },
  { char: '₴', name: 'Hryvnia Ucraniana', cat: 'Moedas', subcat: 'Europa', hex: 'U+20B4', entity: '&#8372;', tags: ['hryvnia', 'uah', 'ucrania', 'ukraine'] },
  { char: '₦', name: 'Naira Nigeriana', cat: 'Moedas', subcat: 'África', hex: 'U+20A6', entity: '&#8358;', tags: ['naira', 'ngn', 'nigeria', 'africa'] },
  { char: '₫', name: 'Dong Vietnamita', cat: 'Moedas', subcat: 'Ásia', hex: 'U+20AB', entity: '&#8363;', tags: ['dong', 'vnd', 'vietnam'] },
  { char: '₱', name: 'Peso Filipino', cat: 'Moedas', subcat: 'Ásia', hex: 'U+20B1', entity: '&#8369;', tags: ['peso', 'php', 'filipinas', 'philippines'] },
  { char: '₲', name: 'Guarani Paraguaio', cat: 'Moedas', subcat: 'América do Sul', hex: 'U+20B2', entity: '&#8370;', tags: ['guarani', 'pyg', 'paraguai', 'paraguay'] },
  { char: '₵', name: 'Cedi Ganês', cat: 'Moedas', subcat: 'África', hex: 'U+20B5', entity: '&#8373;', tags: ['cedi', 'ghs', 'gana', 'ghana'] },
  { char: '₸', name: 'Tenge Cazaque', cat: 'Moedas', subcat: 'Ásia Central', hex: 'U+20B8', entity: '&#8376;', tags: ['tenge', 'kzt', 'cazaquistao', 'kazakhstan'] },
  { char: '֏', name: 'Dram Armênio', cat: 'Moedas', subcat: 'Europa/Ásia', hex: 'U+058F', entity: '&#1423;', tags: ['dram', 'amd', 'armenia'] },
  { char: '؋', name: 'Afghani Afegão', cat: 'Moedas', subcat: 'Ásia', hex: 'U+060B', entity: '&#1547;', tags: ['afghani', 'afn', 'afeganistao'] },
  { char: '฿', name: 'Baht Tailandês', cat: 'Moedas', subcat: 'Ásia', hex: 'U+0E3F', entity: '&#3647;', tags: ['baht', 'thb', 'tailandia', 'thailand'] },
  { char: '៛', name: 'Riel Cambojano', cat: 'Moedas', subcat: 'Ásia', hex: 'U+17DB', entity: '&#6107;', tags: ['riel', 'khr', 'camboja', 'cambodia'] },
  { char: '₭', name: 'Kip Laosiano', cat: 'Moedas', subcat: 'Ásia', hex: 'U+20AD', entity: '&#8365;', tags: ['kip', 'lak', 'laos'] },
  { char: '₮', name: 'Tugrik Mongol', cat: 'Moedas', subcat: 'Ásia', hex: 'U+20AE', entity: '&#8366;', tags: ['tugrik', 'mnt', 'mongolia'] },
  { char: '₡', name: 'Colon Costarriquenho / Salvadorenho', cat: 'Moedas', subcat: 'América Central', hex: 'U+20A2', entity: '&#8354;', tags: ['colon', 'crc', 'costa rica', 'el salvador'] },
  { char: '₢', name: 'Cruzeiro Histórico Brasileiro', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20A2', entity: '&#8354;', tags: ['cruzeiro', 'brasil', 'historico'] },
  { char: '₣', name: 'Franco Francês Histórico', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20A3', entity: '&#8355;', tags: ['franco', 'franc', 'frança'] },
  { char: '₤', name: 'Lira Italiana Histórica', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20A4', entity: '&#8356;', tags: ['lira', 'italia'] },
  { char: '₥', name: 'Mill / Milésimo de Dólar', cat: 'Moedas', subcat: 'Subunidades', hex: 'U+20A5', entity: '&#8357;', tags: ['mill', 'mille', 'milesimo'] },
  { char: '₧', name: 'Peseta Espanhola Histórica', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20A7', entity: '&#8359;', tags: ['peseta', 'espanha', 'spain'] },
  { char: '₨', name: 'Rúpia Genérica (Paquistão / Sri Lanka)', cat: 'Moedas', subcat: 'Ásia', hex: 'U+20A8', entity: '&#8360;', tags: ['rupia', 'pkr', 'lkr', 'paquistao', 'sri lanka'] },
  { char: '₪', name: 'Novo Shekel Israelense', cat: 'Moedas', subcat: 'Oriente Médio', hex: 'U+20AA', entity: '&#8362;', tags: ['shekel', 'ils', 'israel', 'sheqel'] },
  { char: '₰', name: 'Penny Germânico Antigo', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20B0', entity: '&#8368;', tags: ['pfennig', 'alemanha'] },
  { char: '₯', name: 'Dracma Grega Histórica', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20AF', entity: '&#8367;', tags: ['dracma', 'grecia'] },
  { char: '₳', name: 'Austral Argentino Histórico', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20B3', entity: '&#8371;', tags: ['austral', 'argentina'] },
  { char: '₶', name: 'Livre Tournois', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20B6', entity: '&#8374;', tags: ['livre', 'franca'] },
  { char: '₷', name: 'Spesmilo (Língua Internacional)', cat: 'Moedas', subcat: 'Histórico', hex: 'U+20B7', entity: '&#8375;', tags: ['spesmilo', 'esperanto'] },
  { char: '₼', name: 'Manat Azerbaijano', cat: 'Moedas', subcat: 'Europa/Ásia', hex: 'U+20BC', entity: '&#8380;', tags: ['manat', 'azn', 'azerbaijao'] },
  { char: '₾', name: 'Lari Georgiano', cat: 'Moedas', subcat: 'Europa/Ásia', hex: 'U+20BE', entity: '&#8382;', tags: ['lari', 'gel', 'georgia'] },
  { char: '¤', name: 'Símbolo de Moeda Genérico', cat: 'Moedas', subcat: 'Universal', hex: 'U+00A4', entity: '&curren;', tags: ['moeda', 'generico', 'cambio', 'currency'] }
];

// Math Operators
const mathNames = {
  0x2200: 'Para Todo (Quantificador Universal)', 0x2201: 'Complemento', 0x2202: 'Derivada Parcial', 0x2203: 'Existe (Quantificador Existencial)',
  0x2204: 'Não Existe', 0x2205: 'Conjunto Vazio', 0x2206: 'Incremento / Delta', 0x2207: 'Nabla / Gradiente',
  0x2208: 'Pertence a', 0x2209: 'Não Pertence a', 0x220A: 'Pequeno Pertence a', 0x220B: 'Contém como Membro',
  0x220C: 'Não Contém como Membro', 0x220F: 'Produtório', 0x2210: 'Coproduto', 0x2211: 'Somatório',
  0x2212: 'Menos Matemático', 0x2213: 'Menos ou Mais', 0x2214: 'Ponto Mais', 0x2215: 'Barra de Divisão',
  0x2216: 'Diferença de Conjunto', 0x2217: 'Operador Asterisco', 0x2218: 'Composição de Funções (Ring)', 0x2219: 'Ponto de Multiplicação',
  0x221A: 'Raiz Quadrada', 0x221B: 'Raiz Cúbica', 0x221C: 'Raiz Quarta', 0x221D: 'Proporcional a',
  0x221E: 'Infinito', 0x221F: 'Ângulo Reto', 0x2220: 'Ângulo', 0x2221: 'Ângulo Medido',
  0x2222: 'Ângulo Esférico', 0x2223: 'Divide', 0x2224: 'Não Divide', 0x2225: 'Paralelo a',
  0x2226: 'Não Paralelo a', 0x2227: 'E Lógico (Conjunção)', 0x2228: 'OU Lógico (Disjunção)', 0x2229: 'Interseção de Conjuntos',
  0x222A: 'União de Conjuntos', 0x222B: 'Integral Simples', 0x222C: 'Integral Dupla', 0x222D: 'Integral Tripla',
  0x222E: 'Integral de Linha (Contorno)', 0x222F: 'Integral de Superfície', 0x2230: 'Integral de Volume', 0x2234: 'Portanto (Conclusão)',
  0x2235: 'Porque / Dado Que', 0x2236: 'Proporção', 0x2237: 'Proporção Dupla', 0x2238: 'Menos com Ponto',
  0x223C: 'Tilde Operador / Similar a', 0x223D: 'Tilde Invertido', 0x2240: 'Produto Wreath', 0x2241: 'Não Similar a',
  0x2242: 'Igual ou Equivalente', 0x2243: 'Assintoticamente Igual', 0x2244: 'Não Assintoticamente Igual', 0x2245: 'Aproximadamente Igual a (Congruente)',
  0x2246: 'Aproximadamente mas Não Igual', 0x2247: 'Nem Aproximadamente Nem Igual', 0x2248: 'Quase Igual a (Aproximado)', 0x2249: 'Não Quase Igual a',
  0x224A: 'Quase Igual ou Igual', 0x224D: 'Equivalente a', 0x2260: 'Diferente de (Não Igual)', 0x2261: 'Identicamente Igual a (Congruência)',
  0x2262: 'Não Identicamente Igual a', 0x2264: 'Menor ou Igual a', 0x2265: 'Maior ou Igual a', 0x2266: 'Menor que sobre Igual',
  0x2267: 'Maior que sobre Igual', 0x226A: 'Muito Menor que', 0x226B: 'Muito Maior que', 0x2270: 'Nem Menor Nem Igual',
  0x2271: 'Nem Maior Nem Igual', 0x2282: 'Subconjunto Próprio de (Contido em)', 0x2283: 'Superconjunto Próprio de (Contém)',
  0x2284: 'Não é Subconjunto de', 0x2285: 'Não é Superconjunto de', 0x2286: 'Subconjunto ou Igual a', 0x2287: 'Superconjunto ou Igual a',
  0x2288: 'Nem Subconjunto Nem Igual', 0x2289: 'Nem Superconjunto Nem Igual', 0x228A: 'Subconjunto Não Igual', 0x228B: 'Superconjunto Não Igual',
  0x228E: 'União Multiconjunto (Soma)', 0x2295: 'Mais Circulado (XOR / Soma Direta)', 0x2296: 'Menos Circulado', 0x2297: 'Vezes Circulado (Produto Tensorial)',
  0x2298: 'Divisão Circulada', 0x2299: 'Ponto Circulado', 0x229A: 'Círculo Aberto Circulado', 0x22A2: 'Tee Direita (Afirmação / Prova)',
  0x22A3: 'Tee Esquerda', 0x22A4: 'Tee Superior (Tautologia / Top)', 0x22A5: 'Tee Inferior (Contradição / Perpendicular)', 0x22A8: 'Entailment / Verdadeiro em',
  0x22C4: 'Diamante Operador', 0x22C5: 'Ponto Operador', 0x22C6: 'Estrela Operador', 0x22C8: 'Gravata / Bowtie',
  0x22EE: 'Reticências Verticais', 0x22EF: 'Reticências Centrais', 0x22F0: 'Reticências Diagonais Ascendentes', 0x22F1: 'Reticências Diagonais Descendentes'
};

const mathSymbols = [];
for (let cp = 0x2200; cp <= 0x22FF; cp++) {
  const char = String.fromCodePoint(cp);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  const entity = `&#${cp};`;
  const name = mathNames[cp] || `Operador Matemático (${hex})`;
  mathSymbols.push({
    char,
    name,
    cat: 'Matemática',
    subcat: 'Operadores & Teoria dos Conjuntos',
    hex,
    entity,
    tags: ['matematica', 'calculo', 'algebra', 'ciencia', 'logica', 'formula']
  });
}

// Arrows
const arrowNames = {
  0x2190: 'Seta para Esquerda', 0x2191: 'Seta para Cima', 0x2192: 'Seta para Direita', 0x2193: 'Seta para Baixo',
  0x2194: 'Seta Esquerda-Direita', 0x2195: 'Seta Cima-Baixo', 0x2196: 'Seta Noroeste', 0x2197: 'Seta Nordeste',
  0x2198: 'Seta Sudeste', 0x2199: 'Seta Sudoeste', 0x219A: 'Seta Esquerda Cortada', 0x219B: 'Seta Direita Cortada',
  0x219C: 'Seta Ondulada para Esquerda', 0x219D: 'Seta Ondulada para Direita', 0x219E: 'Seta Dupla para Esquerda', 0x219F: 'Seta Dupla para Cima',
  0x21A0: 'Seta Dupla para Direita', 0x21A1: 'Seta Dupla para Baixo', 0x21A2: 'Seta Esquerda com Cauda', 0x21A3: 'Seta Direita com Cauda',
  0x21A4: 'Seta Esquerda com Barra', 0x21A5: 'Seta Cima com Barra', 0x21A6: 'Seta Direita com Barra (Mapeia para)', 0x21A7: 'Seta Baixo com Barra',
  0x21A9: 'Seta Curva para Esquerda (Retorno)', 0x21AA: 'Seta Curva para Direita', 0x21AB: 'Seta Esquerda com Laço', 0x21AC: 'Seta Direita com Laço',
  0x21AD: 'Seta Esquerda-Direita Ondulada', 0x21B0: 'Seta Cima Virando Esquerda', 0x21B1: 'Seta Cima Virando Direita', 0x21B2: 'Seta Baixo Virando Esquerda',
  0x21B3: 'Seta Baixo Virando Direita', 0x21B5: 'Seta de Quebra de Linha (Enter)', 0x21B6: 'Seta Curva Anti-horária', 0x21B7: 'Seta Curva Horária',
  0x21BA: 'Seta Aberta Circular Anti-horária (Desfazer)', 0x21BB: 'Seta Aberta Circular Horária (Refazer)', 0x21BC: 'Arpão para Esquerda Superior', 0x21BD: 'Arpão para Esquerda Inferior',
  0x21BE: 'Arpão para Cima Direita', 0x21BF: 'Arpão para Cima Esquerda', 0x21C0: 'Arpão para Direita Superior', 0x21C1: 'Arpão para Direita Inferior',
  0x21C4: 'Setas Paralelas Esquerda sobre Direita', 0x21C5: 'Setas Paralelas Cima e Baixo', 0x21C6: 'Setas Paralelas Direita sobre Esquerda',
  0x21C7: 'Setas Paralelas Esquerda Dupla', 0x21C8: 'Setas Paralelas Cima Dupla', 0x21C9: 'Setas Paralelas Direita Dupla', 0x21CA: 'Setas Paralelas Baixo Dupla',
  0x21CB: 'Arpões Opostos Esquerda sobre Direita', 0x21CC: 'Arpões Opostos Direita sobre Esquerda (Equilíbrio)',
  0x21D0: 'Seta Dupla para Esquerda', 0x21D1: 'Seta Dupla para Cima', 0x21D2: 'Seta Dupla para Direita (Implica)', 0x21D3: 'Seta Dupla para Baixo',
  0x21D4: 'Seta Dupla Esquerda-Direita (Se e Somente Se)', 0x21D5: 'Seta Dupla Cima-Baixo'
};

const arrowSymbols = [];
for (let cp = 0x2190; cp <= 0x21FF; cp++) {
  const char = String.fromCodePoint(cp);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  const entity = `&#${cp};`;
  const name = arrowNames[cp] || `Seta Direcional (${hex})`;
  arrowSymbols.push({
    char,
    name,
    cat: 'Setas',
    subcat: 'Direcionais & Navegação',
    hex,
    entity,
    tags: ['seta', 'arrow', 'direcao', 'navegacao', 'fluxo', 'cursor', 'apontador']
  });
}

// Box Drawing & Block Elements
const boxSymbols = [];
for (let cp = 0x2500; cp <= 0x257F; cp++) {
  const char = String.fromCodePoint(cp);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  boxSymbols.push({
    char,
    name: `Linha de Quadro / Box Drawing (${hex})`,
    cat: 'Box Drawing',
    subcat: 'Quadro & TUI',
    hex,
    entity: `&#${cp};`,
    tags: ['box', 'quadro', 'tui', 'ascii', 'borda', 'terminal', 'wireframe', 'linha']
  });
}
for (let cp = 0x2580; cp <= 0x259F; cp++) {
  const char = String.fromCodePoint(cp);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  boxSymbols.push({
    char,
    name: `Elemento de Bloco Sólido (${hex})`,
    cat: 'Box Drawing',
    subcat: 'Blocos & Textura',
    hex,
    entity: `&#${cp};`,
    tags: ['bloco', 'block', 'sombreado', 'barra', 'progresso', 'terminal', 'pixel']
  });
}

// Geometric Shapes
const geoSymbols = [];
for (let cp = 0x25A0; cp <= 0x25FF; cp++) {
  const char = String.fromCodePoint(cp);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  geoSymbols.push({
    char,
    name: `Forma Geométrica (${hex})`,
    cat: 'Formas',
    subcat: 'Geometria & Badges',
    hex,
    entity: `&#${cp};`,
    tags: ['forma', 'geometria', 'quadrado', 'circulo', 'triangulo', 'losango', 'badge']
  });
}

// Dingbats
const dingbatSymbols = [];
for (let cp = 0x2600; cp <= 0x26FF; cp++) {
  const char = String.fromCodePoint(cp);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  dingbatSymbols.push({
    char,
    name: `Símbolo Diverso / Ícone (${hex})`,
    cat: 'Dingbats',
    subcat: 'Símbolos & Clima',
    hex,
    entity: `&#${cp};`,
    tags: ['icone', 'clima', 'xadrez', 'cartas', 'musica', 'zodiaco', 'astronomia', 'dingbat']
  });
}
for (let cp = 0x2700; cp <= 0x27BF; cp++) {
  const char = String.fromCodePoint(cp);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  dingbatSymbols.push({
    char,
    name: `Dingbat / Padrão Tipográfico (${hex})`,
    cat: 'Dingbats',
    subcat: 'Decorativos & Estrelas',
    hex,
    entity: `&#${cp};`,
    tags: ['estrela', 'tesoura', 'cruz', 'marcador', 'check', 'flor', 'decoracao', 'dingbat']
  });
}

// Keyboard Modifiers
const keyboardSymbols = [
  { char: '⌘', name: 'Command / Cmd (Apple Mac)', cat: 'Teclado', subcat: 'Modificadores Mac', hex: 'U+2318', entity: '&#8984;', tags: ['cmd', 'command', 'apple', 'mac', 'atalho'] },
  { char: '⌥', name: 'Option / Alt (Apple Mac)', cat: 'Teclado', subcat: 'Modificadores Mac', hex: 'U+2325', entity: '&#8997;', tags: ['option', 'alt', 'apple', 'mac', 'atalho'] },
  { char: '⇧', name: 'Shift / Maiúsculas', cat: 'Teclado', subcat: 'Modificadores Universais', hex: 'U+21E7', entity: '&#8679;', tags: ['shift', 'maiuscula', 'teclado', 'atalho'] },
  { char: '⌃', name: 'Control / Ctrl', cat: 'Teclado', subcat: 'Modificadores Universais', hex: 'U+2303', entity: '&#8963;', tags: ['ctrl', 'control', 'teclado', 'atalho'] },
  { char: '⎋', name: 'Escape / Esc', cat: 'Teclado', subcat: 'Teclas de Ação', hex: 'U+238B', entity: '&#9099;', tags: ['esc', 'escape', 'sair', 'cancelar'] },
  { char: '⌫', name: 'Backspace / Apagar', cat: 'Teclado', subcat: 'Teclas de Edição', hex: 'U+232B', entity: '&#9003;', tags: ['backspace', 'apagar', 'delete', 'voltar'] },
  { char: '⌦', name: 'Delete Supr (Deletar à Frente)', cat: 'Teclado', subcat: 'Teclas de Edição', hex: 'U+2326', entity: '&#9002;', tags: ['delete', 'supr', 'excluir'] },
  { char: '⏎', name: 'Return / Enter', cat: 'Teclado', subcat: 'Teclas de Ação', hex: 'U+23CE', entity: '&#9166;', tags: ['enter', 'return', 'confirmar', 'enviar'] },
  { char: '⇥', name: 'Tab / Tabulação para Frente', cat: 'Teclado', subcat: 'Navegação', hex: 'U+21E5', entity: '&#8677;', tags: ['tab', 'tabulacao', 'avancar'] },
  { char: '⇤', name: 'Backtab / Tabulação Reversa', cat: 'Teclado', subcat: 'Navegação', hex: 'U+21E4', entity: '&#8676;', tags: ['backtab', 'shift-tab', 'voltar'] },
  { char: '⇪', name: 'Caps Lock / Trava de Maiúsculas', cat: 'Teclado', subcat: 'Modificadores Universais', hex: 'U+21EA', entity: '&#8682;', tags: ['caps', 'capslock', 'trava'] },
  { char: '␣', name: 'Barra de Espaço (Visual)', cat: 'Teclado', subcat: 'Espaçamento', hex: 'U+2423', entity: '&#9251;', tags: ['space', 'espaco', 'teclado'] },
  { char: '⏏', name: 'Eject / Ejetar Mídia', cat: 'Teclado', subcat: 'Hardware', hex: 'U+23CF', entity: '&#9167;', tags: ['eject', 'ejetar', 'hardware', 'disco'] },
  { char: '⏻', name: 'Power / Ligar-Desligar', cat: 'Teclado', subcat: 'Energia', hex: 'U+23FB', entity: '&#9211;', tags: ['power', 'energia', 'ligar', 'desligar'] },
  { char: '⏼', name: 'Interruptor Liga/Desliga', cat: 'Teclado', subcat: 'Energia', hex: 'U+23FC', entity: '&#9212;', tags: ['toggle', 'switch', 'energia'] },
  { char: '⏽', name: 'Estado Ligado (ON)', cat: 'Teclado', subcat: 'Energia', hex: 'U+23FD', entity: '&#9213;', tags: ['on', 'ligado', 'power'] },
  { char: '⏾', name: 'Sleep / Modo Suspensão', cat: 'Teclado', subcat: 'Energia', hex: 'U+23FE', entity: '&#9214;', tags: ['sleep', 'dormir', 'suspensao'] },
  { char: '⎈', name: 'Helm / Helm Symbol (Emacs)', cat: 'Teclado', subcat: 'Terminal', hex: 'U+2388', entity: '&#9096;', tags: ['helm', 'emacs', 'terminal'] },
  { char: '⎙', name: 'Print Screen / Imprimir', cat: 'Teclado', subcat: 'Hardware', hex: 'U+2399', entity: '&#9113;', tags: ['print', 'imprimir', 'tela'] },
  { char: '⎚', name: 'Clear Screen / Limpar', cat: 'Teclado', subcat: 'Terminal', hex: 'U+239A', entity: '&#9114;', tags: ['clear', 'limpar', 'cls'] }
];

// Editorial
const editorialSymbols = [
  { char: '©', name: 'Copyright / Direitos Autorais', cat: 'Editorial', subcat: 'Marcas & Legal', hex: 'U+00A9', entity: '&copy;', tags: ['copyright', 'direitos', 'propriedade', 'legal'] },
  { char: '®', name: 'Marca Registrada (Registered)', cat: 'Editorial', subcat: 'Marcas & Legal', hex: 'U+00AE', entity: '&reg;', tags: ['registrada', 'registered', 'marca', 'patente'] },
  { char: '™', name: 'Trademark / Marca Comercial', cat: 'Editorial', subcat: 'Marcas & Legal', hex: 'U+2122', entity: '&trade;', tags: ['trademark', 'marca', 'comercial'] },
  { char: '℠', name: 'Service Mark / Marca de Serviço', cat: 'Editorial', subcat: 'Marcas & Legal', hex: 'U+2120', entity: '&#8480;', tags: ['servicemark', 'servico', 'marca'] },
  { char: '§', name: 'Parágrafo Jurídico (Section Sign)', cat: 'Editorial', subcat: 'Jurídico', hex: 'U+00A7', entity: '&sect;', tags: ['paragrafo', 'artigo', 'lei', 'secao', 'juridico'] },
  { char: '¶', name: 'Pilcrow / Fim de Parágrafo', cat: 'Editorial', subcat: 'Tipografia', hex: 'U+00B6', entity: '&para;', tags: ['pilcrow', 'paragrafo', 'texto', 'editor'] },
  { char: '†', name: 'Adaga / Cruz Latina (Dagger)', cat: 'Editorial', subcat: 'Notas de Rodapé', hex: 'U+2020', entity: '&dagger;', tags: ['adaga', 'dagger', 'nota', 'rodape'] },
  { char: '‡', name: 'Adaga Dupla (Double Dagger)', cat: 'Editorial', subcat: 'Notas de Rodapé', hex: 'U+2021', entity: '&Dagger;', tags: ['adaga dupla', 'dagger', 'nota'] },
  { char: '•', name: 'Marcador de Lista (Bullet Point)', cat: 'Editorial', subcat: 'Listas', hex: 'U+2022', entity: '&bull;', tags: ['bullet', 'ponto', 'lista', 'marcador'] },
  { char: '·', name: 'Ponto Médio (Interpunct)', cat: 'Editorial', subcat: 'Tipografia', hex: 'U+00B7', entity: '&middot;', tags: ['ponto medio', 'interpunct', 'separador'] },
  { char: '—', name: 'Em Dash / Travessão Longo', cat: 'Editorial', subcat: 'Travessões', hex: 'U+2014', entity: '&mdash;', tags: ['travessao', 'emdash', 'traco', 'pontuacao'] },
  { char: '–', name: 'En Dash / Meio Travessão', cat: 'Editorial', subcat: 'Travessões', hex: 'U+2013', entity: '&ndash;', tags: ['meio travessao', 'endash', 'intervalo'] },
  { char: '“', name: 'Aspas Duplas Esquerdas (Abertura)', cat: 'Editorial', subcat: 'Aspas', hex: 'U+201C', entity: '&ldquo;', tags: ['aspas', 'citacao', 'abertura'] },
  { char: '”', name: 'Aspas Duplas Direitas (Fechamento)', cat: 'Editorial', subcat: 'Aspas', hex: 'U+201D', entity: '&rdquo;', tags: ['aspas', 'citacao', 'fechamento'] },
  { char: '‘', name: 'Aspa Simples Esquerda', cat: 'Editorial', subcat: 'Aspas', hex: 'U+2018', entity: '&lsquo;', tags: ['aspa simples', 'abertura'] },
  { char: '’', name: 'Aspa Simples Direita', cat: 'Editorial', subcat: 'Aspas', hex: 'U+2019', entity: '&rsquo;', tags: ['aspa simples', 'fechamento'] },
  { char: '«', name: 'Guillemet Esquerdo (Aspas Francesas)', cat: 'Editorial', subcat: 'Aspas Internacionais', hex: 'U+00AB', entity: '&laquo;', tags: ['guillemet', 'aspas francesas'] },
  { char: '»', name: 'Guillemet Direito', cat: 'Editorial', subcat: 'Aspas Internacionais', hex: 'U+00BB', entity: '&raquo;', tags: ['guillemet', 'aspas francesas'] },
  { char: '№', name: 'Número / Símbolo de Ordem', cat: 'Editorial', subcat: 'Numeração', hex: 'U+2116', entity: '&#8470;', tags: ['numero', 'ordem', 'registro'] },
  { char: 'º', name: 'Indicador Ordinal Masculino', cat: 'Editorial', subcat: 'Numeração', hex: 'U+00BA', entity: '&ordm;', tags: ['primeiro', 'ordinal', 'masculino'] },
  { char: 'ª', name: 'Indicador Ordinal Feminino', cat: 'Editorial', subcat: 'Numeração', hex: 'U+00AA', entity: '&ordf;', tags: ['primeira', 'ordinal', 'feminino'] },
  { char: '‰', name: 'Por Mil / Por Milhagem', cat: 'Editorial', subcat: 'Estatística', hex: 'U+2030', entity: '&permil;', tags: ['pormil', 'porcentagem', 'mil'] },
  { char: '‱', name: 'Ponto Base (Basis Point / BPS)', cat: 'Editorial', subcat: 'Financeiro', hex: 'U+2031', entity: '&#8241;', tags: ['bps', 'basis point', 'pontobase', 'juros'] },
  { char: '½', name: 'Fração Um Meio (1/2)', cat: 'Editorial', subcat: 'Frações', hex: 'U+00BD', entity: '&frac12;', tags: ['fracao', 'metade', 'meio'] },
  { char: '⅓', name: 'Fração Um Terço (1/3)', cat: 'Editorial', subcat: 'Frações', hex: 'U+2153', entity: '&#8531;', tags: ['fracao', 'terco'] },
  { char: '⅔', name: 'Fração Dois Terços (2/3)', cat: 'Editorial', subcat: 'Frações', hex: 'U+2154', entity: '&#8532;', tags: ['fracao', 'dois tercos'] },
  { char: '¼', name: 'Fração Um Quarto (1/4)', cat: 'Editorial', subcat: 'Frações', hex: 'U+00BC', entity: '&frac14;', tags: ['fracao', 'quarto'] },
  { char: '¾', name: 'Fração Três Quartos (3/4)', cat: 'Editorial', subcat: 'Frações', hex: 'U+00BE', entity: '&frac34;', tags: ['fracao', 'tres quartos'] },
  { char: '⅕', name: 'Fração Um Quinto (1/5)', cat: 'Editorial', subcat: 'Frações', hex: 'U+2155', entity: '&#8533;', tags: ['fracao', 'quinto'] },
  { char: '⅛', name: 'Fração Um Oitavo (1/8)', cat: 'Editorial', subcat: 'Frações', hex: 'U+215B', entity: '&#8539;', tags: ['fracao', 'oitavo'] }
];

// Greek
const greekSymbols = [];
const greekNames = ['Alfa', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Capa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'];
const greekUpperBase = 0x0391;
const greekLowerBase = 0x03B1;
for (let i = 0; i < greekNames.length; i++) {
  const charU = String.fromCodePoint(greekUpperBase + i);
  const hexU = 'U+' + (greekUpperBase + i).toString(16).toUpperCase();
  greekSymbols.push({
    char: charU,
    name: `Grego Maiúsculo: ${greekNames[i]}`,
    cat: 'Grego & Notação',
    subcat: 'Alfabeto Grego',
    hex: hexU,
    entity: `&#${greekUpperBase + i};`,
    tags: ['grego', 'grego maiusculo', greekNames[i].toLowerCase(), 'fisica', 'matematica']
  });
  const charL = String.fromCodePoint(greekLowerBase + i);
  const hexL = 'U+' + (greekLowerBase + i).toString(16).toUpperCase();
  greekSymbols.push({
    char: charL,
    name: `Grego Minúsculo: ${greekNames[i]}`,
    cat: 'Grego & Notação',
    subcat: 'Alfabeto Grego',
    hex: hexL,
    entity: `&#${greekLowerBase + i};`,
    tags: ['grego', 'grego minusculo', greekNames[i].toLowerCase(), 'fisica', 'matematica']
  });
}

// Braille
const brailleSymbols = [];
for (let cp = 0x2800; cp <= 0x28FF; cp++) {
  const char = String.fromCodePoint(cp);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  brailleSymbols.push({
    char,
    name: `Padrão Braille (${hex})`,
    cat: 'Braille',
    subcat: 'Acessibilidade & Tato',
    hex,
    entity: `&#${cp};`,
    tags: ['braille', 'acessibilidade', 'cegos', 'tato', 'pontos']
  });
}

const ALL_SYMBOLS = [
  ...currencies,
  ...mathSymbols,
  ...arrowSymbols,
  ...boxSymbols,
  ...geoSymbols,
  ...dingbatSymbols,
  ...keyboardSymbols,
  ...editorialSymbols,
  ...greekSymbols,
  ...brailleSymbols
];

const jsContent = `/**
 * Sovereign Universal Symbols & Unicode Master Catalog
 * Catálogo Soberano Universal de Símbolos, Moedas, Matemática, Setas, Box Drawing e Dingbats
 * 100% Zero Dependências Externas · Offline & Servido Nativamente pela Borda Cloudflare
 */

export const SOVEREIGN_SYMBOLS_CATALOG = ${JSON.stringify(ALL_SYMBOLS, null, 2)};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SOVEREIGN_SYMBOLS_CATALOG };
}
if (typeof window !== 'undefined') {
  window.SOVEREIGN_SYMBOLS_CATALOG = SOVEREIGN_SYMBOLS_CATALOG;
}
`;

const targets = [
  'C:\\Users\\Win10\\Documents\\icons-pro\\symbols-catalog.js',
  'C:\\Users\\Win10\\Documents\\my-api-marketplace\\brand\\symbols-catalog.js',
  'C:\\Users\\Win10\\Documents\\my-api-marketplace\\public\\brand\\symbols-catalog.js'
];

targets.forEach(t => {
  fs.writeFileSync(t, jsContent, 'utf8');
  console.log(`Saved pure UTF-8 to ${t}`);
});
