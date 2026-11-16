import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');
const content = `// site-assets.js
export const HTML_STUDIO = ${JSON.stringify(html)};
`;

fs.writeFileSync('site-assets.js', content, 'utf8');
console.log('icons-pro site-assets.js generated successfully!');
