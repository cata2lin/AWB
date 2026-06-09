# Întrebări de Clarificare — Întreg Proiectul AWB Print Manager

Acest document strânge, pe subsisteme, toate ambiguitățile de produs pe care un developer le-ar pune product-owner-ului înainte să decidă "ce e corect" în cod. Nu acoperă doar profitabilitatea (aceea are deja `docs/profitabilitate_intrebari.md` — întrebările de acolo NU se repetă aici, doar se referențiază). Fiecare întrebare e ancorată într-un detaliu real din cod (fișier / comportament citat). Scopul: confirmarea intenției la cazurile-limită, nu re-descrierea funcționalității.

**Cum se folosește:** răspunde inline sub fiecare întrebare (☐ DA / ☐ NU / text liber). Răspunsurile rămân în acest fișier ca sursă de adevăr pentru deciziile ulterioare.

Referințe folosite la redactare: `README.md`, `CLAUDE.md`, `backend/app/services/{sync_service,scheduler,product_grouping}.py`, `backend/app/services/rules/matching.py`, `backend/app/api/{print_batch, analytics/deliverability, analytics/profitability, sales_velocity, products}.py`, `backend/app/core/{status_classification, vat, order_filters}.py`, `backend/app/models/order.py`.

---

## 1. Motorul de Sincronizare (Sync Engine)

Context cod: `sync_service.py` are 5 tiere (`incremental` 10min / `recent_7d` 20min / `window_30d` 2h / `deep_90d` 24h / `recheck_30d` 3h). Tier 5 a fost adăugat (changelog 2026-06-03) ca leac pentru comenzile "stale" — re-citește după `created_at`, nu `updated_at`.

> **S1.** Ce înseamnă concret "comandă stale" pentru afacere? Câte ore/zile de status neactualizat sunt inacceptabile pentru o comandă recentă (≤7 zile) vs. una de 30–90 zile? (azi cadențele sunt 20min / 2h / 24h — sunt asumate de tine sau de noi?)

> **S2.** Tier 5 (`recheck_30d`, created_at, la 3h) re-citește TOATE comenzile create în ultimele 30 zile la fiecare rulare. La volumul de ~97.000+ comenzi menționat în README, e acceptabilă încărcarea API Frisbo la 3h, sau preferi o fereastră mai scurtă (ex. 14 zile) la 3h și 30 zile o dată/zi?

> **S3.** După 30 de zile, singura plasă de siguranță pentru schimbări de status NE-însoțite de `updated_at` dispare (Tier 5 nu mai prinde comanda, iar tierele `updated_at` o ratează prin definiție). Există comenzi care livrează/returnează la >30 zile și al căror status final contează financiar? Dacă da, extindem `RECHECK_BY_CREATED_DAYS` sau adăugăm un recheck lunar mai lung?

> **S4.** Cât de departe în istorie contează datele? `deep_90d` e plafonul actual. Pentru rapoarte (P&L, livrabilitate) ai nevoie vreodată de exactitate pe comenzi mai vechi de 90 zile, sau acelea sunt "înghețate" și nu se mai re-citesc niciodată?

> **S5.** Multi-org: sync-ul iterează prin toate token-urile din `FRISBO_ORG_TOKENS` și, la print, ghicește org-ul corect încercând fiecare token până nu primește "Order not found". E corect modelul mental "un magazin aparține exact unui singur org"? Pot exista magazine prezente în mai multe org-uri (și deci ambiguitate la rezolvarea token-ului)?

> **S6.** Filtrul Frisbo `store_uids[]` e ocolit intenționat (comentariu în cod: returnează ~0 comenzi cu multe UID-uri; filtrăm Python-side). Confirmi că un sync "custom" pe multe magazine trebuie să rămână corect-dar-lent (descarcă tot org-ul, filtrează local) și nu vrei să riscăm filtrarea pe sârmă?

> **S7.** La incremental fără sync anterior, fallback-ul e 2 zile (`INCREMENTAL_FALLBACK_DAYS`). După o oprire lungă a serverului (zile), primul incremental acoperă doar 2 zile — restul golului e umplut abia de `recent_7d`/`window_30d`. E acceptabil, sau vrei ca primul incremental după downtime să fie mai larg?

> **S8.** Upsert-ul folosește coalesce peste tot (`parsed.get(x) or existing.x`): un câmp care devine gol/`None` în Frisbo NU se șterge local. E intenționat pentru toate câmpurile (ex. `awb_pdf_url`, `tracking_number`, `courier_name`)? Există vreun câmp pe care o ștergere în Frisbo TREBUIE reflectată local (ex. AWB anulat)?

> **S9.** `waiting_for_courier_since` se auto-curăță când `aggregated_status` iese din `waiting_for_courier`. Există un prag de alertă (ex. "stă la curier de >X ore") pe care UI ar trebui să-l afișeze, sau e doar un timestamp informativ?

> **S10.** O comandă fără `uid` e ignorată (skip) silențios la sync. E acceptabil să fie invizibilă, sau vrei o alertă/log vizibil în UI când Frisbo trimite înregistrări fără UID?

---

## 2. Motorul de Reguli / Grupare (Rules & Grouping)

Context cod: `rules/matching.py` (condiții AND, first-match pe `priority`), `product_grouping.py` (grupare pe barcode→SKU, primary listing), `RulePreset` (snapshot).

> **R1.** Regulile cu `conditions = {}` (goale) "match tot" (cod: `if not conditions: return True`). Confirmi că o regulă goală pusă din greșeală pe prioritate mică (mare în ordine) trebuie să înghită toate comenzile rămase — sau vrei o protecție în UI care interzice salvarea unei reguli fără nicio condiție?

> **R2.** Toate condițiile unei reguli sunt AND (toate trebuie să treacă). Ai vreodată nevoie de OR în interiorul unei reguli (ex. "curier DPD SAU Sameday")? Azi soluția e două reguli separate — e suficient?

> **R3.** `sku_contains` / `sku_excludes` fac match pe substring case-insensitive în orice SKU al comenzii. Pentru o comandă cu mai multe produse, `sku_excludes` respinge comanda dacă ORICARE SKU conține pattern-ul. E comportamentul dorit (un singur produs "interzis" scoate toată comanda din grup)?

> **R4.** La comenzi neîncadrate de nicio regulă, grupurile default se sparg pe `item_count` (1 / 2 / 3+ articole). Pragul "3+" e fix în cod — vrei să fie configurabil, sau rămâne hardcodat?

> **R5.** Sortarea în grup optimizează picking-ul (frecvență SKU descrescător, apoi nume, apoi dată). La egalitate pe `topSku`, departajarea e "comanda cea mai veche întâi". E corect prioritar-vechime, sau vrei alt criteriu (ex. magazin, curier) pentru consistența cozii de printare?

> **R6.** Primary listing pentru DISPLAY (`pick_best_primary`): ordinea e `user-set > RO+imagine > RO > orice+imagine > fallback`. Confirmi că alegerea manuală (`primary_listing_uid`) bate ÎNTOTDEAUNA regula automată, chiar dacă listarea aleasă manual NU are imagine sau NU e RO?

> **R7.** Pentru STOC (autoritativ), codul preferă mereu produsul care DEȚINE barcode-ul, chiar dacă primary-ul de display e altul (`stock_product`). Confirmi separarea "display ≠ stoc": un primary fără barcode ales pentru imagine nu trebuie să dicteze niciodată stocul?

> **R8.** Gruparea barcode→SKU: un produs fără barcode dar cu SKU se lipește de grupul de barcode care are același SKU. Dacă același SKU apare în două grupuri de barcode diferite (date murdare), unde aterizează? Vrei o regulă deterministă (primul barcode? alertă de conflict?)?

> **R9.** Nubra (`NUBRA_UID` hardcodat) e izolat explicit pentru că împarte SKU-uri cu esteban/GT dar vinde produse diferite. Mai există alte magazine cu SKU-uri suprapuse care ar trebui izolate, sau Nubra e singurul caz special permanent?

> **R10.** Preset-urile sunt snapshot-uri ale tuturor regulilor la momentul salvării. La încărcarea unui preset, regulile curente sunt înlocuite total? Confirmi că nu vrei "merge" și că un preset vechi încărcat poate referenția magazine/SKU-uri care nu mai există (și e ok)?

---

## 3. Workflow AWB / Printare

Context cod: `print_batch.py`. Preview filtrează strict pe tripleta `fulfillment=ready_for_picking & shipment=generated_awb & aggregated=ready_for_picking`. Generate descarcă AWB-uri (cu fallback Frisbo), marchează `is_printed`, notifică Frisbo `mark_waiting_for_courier`. Există detecție de duplicate (`print_hold`).

> **P1.** Preview-ul arată DOAR comenzile cu tripleta de status de mai sus. O comandă cu AWB generat dar status ușor diferit nu apare în preview și deci nu se poate printa în lot. E intenționat strict, sau pierdem comenzi printabile din cauza unor statusuri Frisbo neașteptate?

> **P2.** La generate, comenzile fără `awb_pdf_url` declanșează un fetch live din Frisbo (3 fallback-uri: `print_shipment` → `get_shipments` → `get_order`), pe toate token-urile. Cele care tot nu au AWB sunt SĂRITE (raportate în `skipped_orders`), nu blochează lotul. Confirmi "skip & continuă"? Sau pentru anumite magazine vrei "totul-sau-nimic"?

> **P3.** Detecția de duplicate ține pe `print_hold` orice comandă cu același client (telefon→email→nume) ȘI aceeași amprentă SKU (`sku x qty`), păstrând-o pe cea mai veche. Două comenzi LEGITIME identice de la același client (ex. recomandă) ar fi blocate fals. E acceptabil să blocăm conservator și să cerem release manual, sau e prea agresiv?

> **P4.** `_customer_key` cade pe telefon → email → nume. Dacă lipsesc toate (cheie goală), comanda e exclusă din detecția de duplicate. Confirmi că o comandă fără date de identificare NU trebuie tratată ca duplicat (nu o ținem niciodată în hold din acest motiv)?

> **P5.** Reprint: `reprint/{batch_id}` și `reprint-order/{uid}` re-descarcă PDF-ul fără a re-marca `is_printed` și fără a notifica Frisbo. `regenerate/{uid}` creează o ETICHETĂ NOUĂ la curier (tracking nou). Confirmi distincția: reprint = aceeași etichetă fizică (label deteriorat), regenerate = AWB complet nou? Cine are voie să regenereze (orice operator)?

> **P6.** Multi-AWB: o comandă poate avea AWB-uri `outbound` + `return` (`OrderAwb.awb_type`). La printarea în lot se printează doar outbound-ul, sau toate etichetele comenzii? Eticheta de retur se printează vreodată automat sau doar la cerere?

> **P7.** `awb_count` (1–10) cu `awb_count_manual` previne auto-override. Când se setează automat numărul de etichete (din `package_count`?) și când rămâne 1? Vrei ca un `awb_count` manual să persiste chiar dacă Frisbo raportează alt număr de colete?

> **P8.** Override manual de date de transport: `PUT /orders/{uid}/shipping` setează `shipping_data_manual=true`, ceea ce blochează suprascrierea la importul CSV (per `CLAUDE.md`). Confirmi că o valoare manuală NU trebuie suprascrisă NICIODATĂ de import, chiar dacă CSV-ul ulterior pare mai corect? Există un buton de "resetează la sursă automată"?

> **P9.** La generate, după marcarea locală, notificarea Frisbo `mark_waiting_for_courier` e best-effort (non-critical). Dacă eșuează, comanda e printată local dar Frisbo nu știe. E acceptabil decuplajul, sau vrei o coadă de re-încercare pentru notificările eșuate?

> **P10.** Lotul se generează cu un singur PDF A6 (separatoare colorate + AWB-uri). Există o limită de mărime/număr de comenzi per lot dincolo de `request.limit`? La un lot foarte mare, vrei împărțire automată pe mai multe fișiere?

---

## 4. Metodologia de Livrabilitate

Context cod: `status_classification.py` (sursa unică) + `analytics/deliverability.py`. Formula: `delivered / shipped × 100`, unde `shipped = delivered + in_transit + out_for_delivery + returned + refused`. `cancelled` NU e în numitor. `refused`/`unsuccessful_delivery` se pliază pe `returned`. `fulfilled` e clasificat ca pre-expediție ("other"), nu in-transit.

> **L1.** `fulfilled` e tratat ca NE-expediat ("other") pe baza datelor de prod (toate au `shipment_status='not_created'`, fără AWB — comentariu în `status_classification.py`). Confirmi semantica: "fulfilled" = pregătit în depozit dar coletul nu a plecat niciodată = "Netrimisă"? Dacă vreodată apare un `fulfilled` cu AWB real, cum îl tratăm?

> **L2.** `cancelled` NU intră în niciun numitor de rată (nici `shipped`, nici `delivered`) — apare doar ca `cancelled_rate = cancelled/total`. Confirmi că o comandă anulată nu trebuie să penalizeze NICIODATĂ rata de livrabilitate (nu a apucat să plece)?

> **L3.** Comenzile încă nerezolvate (in-transit / out-for-delivery) sunt în numitorul `shipped` dar NU în `delivered`, deci TRAG RATA ÎN JOS până se rezolvă. Pentru perioade recente (multe comenzi încă pe drum) asta subestimează livrabilitatea reală. Vrei: (a) să le excludem din numitor pentru perioadele recente, (b) o rată "matură" pe comenzi rezolvate vs. una "brută", sau (c) lăsăm cum e și acceptăm că rata recentă urcă în timp?

> **L4.** Pentru perioade VECHI, in-transit ar trebui să fie ~0; dacă rămân comenzi "in_transit" eterne (curier care nu a închis statusul), ele rămân în numitor permanent și deformează rata istorică. Vrei un cutoff (ex. "in_transit de >60 zile → tratează ca pierdut/returned") sau le lăsăm in-transit pe veci?

> **L5.** `refused` și `unsuccessful_delivery` sunt pliate pe `returned` (colete care fizic s-au întors = pierdere de transport). Confirmi că un refuz la livrare e contabil identic cu un retur (aceeași pierdere), nu o categorie separată în UI?

> **L6.** "Probleme livrare": cum vrei să grupezi în UI statusurile-problemă (`incorrect_address`, `lost`, `lost_in_transit`, `lost_in_warehouse`, `errors_incorrect_shipping_address`)? Azi `lost*` și `incorrect_address` cad în `returned`, dar `errors_incorrect_shipping_address` cade în "other" (pre-expediție). E corectă această despărțire (adresa greșită prinsă ÎNAINTE de expediere = other, prinsă DUPĂ = returned)?

> **L7.** Numitorul `total` (pentru `cancelled_rate` și `expedition_rate`) include comenzile pre-expediție (new, processing, fulfilled, ready_for_pickup). Confirmi că `expedition_rate = shipped/total` trebuie să includă în numitor și comenzile abia create (care nu au avut încă timp să plece)?

> **L8.** Există 53 de valori în enum-ul Frisbo, dar codul mapează explicit ~40. Orice status nemapat cade în "other" (deci în afara oricărei rate). Vrei o alertă când apare un `aggregated_status` necunoscut în date, ca să-l clasificăm, sau e ok să cadă tăcut în "other"?

---

## 5. Profitabilitate / P&L (doar ce NU e în `profitabilitate_intrebari.md`)

> ⚠️ Discount, retururi, comision agenție, TVA inclus/exclus, comenzi în tranzit, alte costuri per comandă — toate sunt în `docs/profitabilitate_intrebari.md` (Î1–Î13). NU le repet aici. Mai jos doar zonele apărute ulterior în cod (`core/vat.py`, fallback FX, COGS lipsă, taguri de excludere).

> **PF1.** TVA per-țară (`core/vat.py`): RO 21% (19% înainte de 2025-08-01), CZ 21%, PL 23%, BG 20%, HU 27%. Țara se derivă din TLD-ul domeniului magazinului (`.ro`/`.bg`/...), cu fallback pe monedă, apoi RO. Confirmi cotele și data pragului RO? Există magazine al căror TLD NU indică corect țara de TVA (ex. domeniu `.com` care vinde în BG)?

> **PF2.** Pragul RO 19%→21% se aplică pe `frisbo_created_at` al comenzii. Confirmi că data RELEVANTĂ pentru cota TVA e data creării comenzii, nu data livrării/facturării?

> **PF3.** Fallback FX (`analytics/profitability.py`): dacă nu există curs BNR în fereastra de 30 zile (`CLAUDE.md`), moneda intră în `unconvertible_currencies` ȘI comanda e calculată cu valorile în moneda originală (necovertite, ca și cum ar fi RON). Asta umflă/deformează agregatul. Confirmi comportamentul dorit: (a) folosim valoarea brută necovertită + flag în UI, (b) excludem complet comanda din P&L, sau (c) folosim ultimul curs disponibil oricât de vechi?

> **PF4.** COGS lipsă: SKU-urile fără cost configurat se string în `missing_sku_costs`. Cum vrei prezentate în UI? Comanda apare cu profit umflat (cost 0) + un avertisment, sau e marcată "incompletă"/exclusă din profitul agregat până se completează costul?

> **PF5.** Produsele cu `exclude_from_stock=True` sunt scoase din COGS (`sku_costs_map.pop`). Confirmi că un produs "nu se ia în calcul la stoc" implică automat "cost 0 în P&L"? Există produse care trebuie excluse din stoc DAR contează la cost (sau invers)?

> **PF6.** Excludere comenzi de test (`core/order_filters.py`): se exclud din TOATE rapoartele comenzile cu tag-ul `test` (paritate Scripturi). Lista e azi doar `("test",)`. Mai există tag-uri/note de exclus (ex. `sample`, `duplicata`, `internal`)? Comenzile cu `tags=NULL` (neumplute încă) sunt PĂSTRATE — ok până la backfill?

> **PF7.** Excluderea pe tag e momentan no-op pe prod (coloana `tags` nemigrată, toate `NULL` — vezi changelog 2026-06-03). Confirmi că prioritatea e: rulează migrarea + un sync `full` ca tag-urile să se populeze, ABIA apoi excluderea devine reală și numerele se aliniază cu Scripturi?

---

## 6. Intenția UI / UX

Context cod: Analytics e un mega-component cu tab-uri (`pages/analytics/<Name>Tab.jsx`), persistență tab în URL (`?tab=`), dark-mode strict, fetch explicit pe "Analizează" pentru date mari (`CLAUDE.md`).

> **U1.** Sales Velocity returnează atât `gross_velocity` (Brut) cât și viteza net/first-sale-aware (changelog: "Gross-headline display (X) is a frontend switch; backend already returns gross_velocity"). Care e numărul HEADLINE pe care îl vede operatorul implicit — Brut (aliniat cu Shopify "items sold") sau Net? Și e doar un toggle, sau două coloane vizibile simultan?

> **U2.** Velocity împarte acum la zilele de la PRIMA vânzare în fereastră, nu la toată fereastra (first-sale-aware, Finding I). Pentru un produs nou vândut o singură zi, viteza pare uriașă. Confirmi că "days-of-stock" trebuie să reflecte realitatea recentă, sau vrei un minim de zile (ex. nu calcula viteză sub 3 zile de istoric)?

> **U3.** Per fiecare tab (Livrabilitate, Profitabilitate, SKU Risk, Velocity), care 2–3 cifre sunt "headline" (mari, sus) și care sunt drill-down (în tabel la expand)? Vrei să confirmăm o ierarhie explicită per tab, sau lăsăm la latitudinea dezvoltatorului?

> **U4.** Persistență: doar `?tab=` e în URL azi. Vrei ca și filtrele grele (interval de date, magazine selectate) să fie în query-string pentru linkuri partajabile, sau rămân în Zustand (se pierd la refresh/share)?

> **U5.** Dark-mode e o regulă dură (fiecare text are variantă `dark:`, fără negru-pe-negru — `MEMORY.md`). Confirmi că dark-mode rămâne preferința implicită și că orice ecran nou trebuie verificat în dark ÎNAINTE de "done"?

> **U6.** Tabelele mari cer click explicit pe "Analizează" (fără auto-fetch la schimbarea filtrului). Confirmi că acest pattern se aplică TUTUROR rapoartelor costisitoare, chiar dacă unele par instant? Care raport (dacă vreunul) are voie să facă auto-fetch?

> **U7.** Etichetele UI rămân în română intenționat (`Livrabilitate`, `Profitabilitate`, `Comenzi` — `CLAUDE.md`). Confirmi că NU vrei nicio versiune EN nici măcar opțională (i18n), și că tot ce e nou rămâne RO?

---

## 7. Date / DB / Migrări

Context cod: DB stochează UTC naive; UI e Bucharest-local (`core/timezone.py`); CSV stochează RO-local. `Base.metadata.create_all()` NU adaugă coloane → migrări obligatorii. Coloanele `tags`/`note` există în model dar nu pe prod (changelog 2026-06-03).

> **D1.** Migrarea `migrate_order_tags_note.py` (coloanele `orders.tags` + `orders.note`) NU a rulat încă pe prod. Confirmi ordinea de deploy: (1) cod cu coalesce-safe (deja merge cu coloana lipsă?), (2) rulează migrarea, (3) sync `full`/Tier-5 pentru backfill. Care e fereastra acceptabilă de downtime pentru pasul de migrare?

> **D2.** Timezone: DB e UTC naiv, UI e Bucharest, CSV e RO-local; toată conversia trece prin `core/timezone.py` și boundary-urile lunare se shiftează cu 2–3h (`CLAUDE.md`). Confirmi că NICIUN raport nou nu are voie să hardcodeze `+2`/`+3` și că orice interval de lună trebuie construit prin helper-ele de timezone?

> **D3.** Velocity folosește timezone PER MAGAZIN (`STORE_TIMEZONE_MAP`: cz→Prague, pl→Warsaw, bg→Bucharest implicit). Restul rapoartelor (livrabilitate, P&L) folosesc Bucharest pentru toate. E intenționat decuplajul (velocity respectă midnight-ul local al magazinului, dar P&L nu), sau vrei consistență (toate per-magazin, sau toate Bucharest)?

> **D4.** Acoperire magazine: unele magazine sunt urmărite de AWB Print dar NU de aplicația soră Scripturi, și invers (`MEMORY.md` — "same 20 stores", dar cu diferențe). Vrei o listă canonică a magazinelor "în scope AWB" și o regulă pentru ce facem cu un magazin nou descoperit de sync (auto-creat azi cu culoare din hash) — îl includem automat în rapoarte sau îl ținem ascuns până e aprobat?

> **D5.** Magazine auto-create: sync-ul creează `Store` on-the-fly cu `name = store_uid` (placeholder) până vine numele din API. Un magazin rămas cu name=UID strică derivarea țării de TVA (TLD-ul lipsește → fallback RO). Vrei o alertă "magazin fără nume real" care blochează includerea lui în P&L până e completat?

> **D6.** Schema reală depășește README-ul (14+ modele documentate, dar pe disc sunt și `product`, `generated_barcode`, `purchase_order(_item)`, `custom_product`, `inventory_sync`, `user`, `user_activity`, `system_setting`, `analytics_filter_preset`). Confirmi că aceste subsisteme (PO, barcoduri, useri/audit, stoc) sunt în scope și trebuie documentate la fel de riguros, sau unele sunt experimentale/în afara scope-ului de produs?

> **D7.** Stocul vine din `InventorySync` DB externă, sincronizat la 15min în `products.stock_available` (scheduler). Care e sursa de adevăr la conflict — InventorySync sau Frisbo? Și ce facem dacă InventorySync e indisponibilă (stoc înghețat la ultima valoare vs. marcat "necunoscut")?

> **D8.** Per-country VAT (changelog: "No DB migration needed — country derived from store domain at runtime"). Confirmi că NU vrei o coloană persistentă `country` pe `stores` (riscul: derivare la runtime greșită pentru un domeniu atipic), sau preferi o coloană explicită editabilă manual pentru cazurile-limită?

---

## Rezumat (status răspunsuri)

| Secțiune | Întrebări | Răspunse |
|----------|-----------|----------|
| 1. Sync Engine | S1–S10 | |
| 2. Reguli / Grupare | R1–R10 | |
| 3. Workflow AWB / Printare | P1–P10 | |
| 4. Livrabilitate | L1–L8 | |
| 5. Profitabilitate (delta) | PF1–PF7 | |
| 6. UI / UX | U1–U7 | |
| 7. Date / DB / Migrări | D1–D8 | |

**Total: 60 de întrebări.**

**Data:** 2026-06-04
