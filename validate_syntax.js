const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match, i = 0, hasErr = false;
while ((match = scriptRegex.exec(html)) !== null) {
  i++;
  const fullTag = match[0];
  if (fullTag.includes('src=')) continue; // external script
  const js = match[1];
  try {
    new Function(js);
    console.log(`Script tag #${i}: Syntax OK (${js.length} chars)`);
  } catch (err) {
    console.error(`Script tag #${i} Syntax ERROR:`, err.message);
    hasErr = true;
  }
}
if (hasErr) process.exit(1);
console.log('All inline scripts in public/index.html passed syntax check 100%!');
