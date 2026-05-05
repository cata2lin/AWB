const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/Analytics.jsx', 'utf8');
let lines = content.split('\n');
lines[2687] = '                                                                                            <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">🌍 Per Țară</h5>\r';
fs.writeFileSync('frontend/src/pages/Analytics.jsx', lines.join('\n'), 'utf8');
