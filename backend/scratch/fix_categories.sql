UPDATE system_settings 
SET value_json = '[
  {"key": "packaging", "label": "📦 Packaging", "stores": [], "tom_enabled": true},
  {"key": "pajamas", "label": "🌙 Pajamas", "stores": ["nocturna.ro", "nocturnalux.ro", "nocturna.bg"], "tom_enabled": true},
  {"key": "home_garden", "label": "🏠 Home & Garden", "stores": ["grandia.ro", "casaofertelor.ro"], "tom_enabled": true},
  {"key": "beauty", "label": "💅 Beauty", "stores": ["rossinails.ro", "belasil.ro"], "tom_enabled": true},
  {"key": "fashion", "label": "👔 Fashion", "stores": ["georgetalent.ro", "apreciat.ro", "gento.ro"], "tom_enabled": true},
  {"key": "home_textiles", "label": "🧶 Home Textiles", "stores": ["carpetto.ro", "covoria.ro", "bonhaus.pl", "bonhaus.cz", "bonhaus.bg"], "tom_enabled": true},
  {"key": "deals", "label": "🏷️ Deals", "stores": ["reduceribune.ro", "ofertelezilei.ro", "cepatai.ro", "magdeal.ro"], "tom_enabled": true},
  {"key": "oils", "label": "🫒 Oils / Internal", "stores": [], "tom_enabled": false}
]'::jsonb
WHERE key = 'po.categories';
