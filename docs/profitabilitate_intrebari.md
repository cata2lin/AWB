# Întrebări - Calculul Profitabilității

## Cum funcționează acum sistemul

### Câmpuri disponibile per comandă:
| Câmp | Ce reprezintă | De unde vine |
|------|---------------|--------------|
| **Subtotal** | Valoarea produselor (DUPĂ discount) | Frisbo API |
| **Discount** | Valoarea reducerii aplicate | Frisbo API |
| **Transport** | Cost livrare = Total - Subtotal | Calculat |
| **Total** | Prețul final plătit de client | Frisbo API |
| **Cost SKU** | Costul produselor (introdus manual) | Baza de date |
| **Profit** | Total - Cost SKU - Transport | Calculat |

---

## Cum se tratează discountul

**Situația actuală:**
- Frisbo trimite `subtotal_price` care este DEJA redus cu discountul
- Exemplu: 3 produse × 45 RON = 135 RON, discount 45 RON → subtotal = 90 RON
- Discountul afectează **prețul de vânzare**, dar **costul produselor rămâne același**

**Întrebare:**
> **Î1: Discountul este tratat corect?**
> 
> Când dai un discount de 45 RON, profitul scade cu 45 RON (vinzi mai ieftin dar costul e același).
> 
> ☐ DA, este corect așa  
> ☐ NU, vreau altfel (explică cum)

---

## Întrebări despre Retururi

**Situația actuală:** Când comanda e returnată, calculăm PIERDERE = Cost SKU + Cost Transport

**Întrebări simple:**

> **Î2: Când un produs e returnat, îl poți vinde din nou?**
> 
> ☐ DA → atunci pierderea e doar costul transportului  
> ☐ NU → atunci pierderea include și costul produsului

> **Î3: Cine plătește transportul la retur?**
> 
> ☐ Clientul  
> ☐ Tu (afacerea)  
> ☐ Depinde de situație

> **Î4: Există taxe suplimentare pentru procesarea returului?**
> 
> ☐ NU  
> ☐ DA → Cât? _______ RON per retur

---

## Întrebări despre Comision Agenție

**Situația actuală:** NU este calculat nicăieri. Profitul nu include comisionul.

**Întrebări simple:**

> **Î5: Ai un comision de agenție de plătit?**
> 
> ☐ NU → treci la secțiunea următoare  
> ☐ DA → răspunde la întrebările de mai jos

> **Î6: Ce tip de comision este?**
> 
> ☐ Sumă fixă per comandă → Cât? _______ RON  
> ☐ Procent din vânzare → Cât? _______ %  
> ☐ Procent din profit → Cât? _______ %

> **Î7: Comisionul se plătește pentru TOATE comenzile sau doar pentru cele livrate?**
> 
> ☐ Toate comenzile  
> ☐ Doar cele livrate cu succes

> **Î8: Comisionul diferă în funcție de magazin?**
> 
> ☐ NU, e același pentru toate  
> ☐ DA → specifică per magazin: _______

---

## Întrebări despre TVA

**Situația actuală:** Toate calculele folosesc prețurile BRUTE (cum vin de la Frisbo).

**Întrebări simple:**

> **Î9: Prețurile din Frisbo INCLUD TVA?**
> 
> ☐ DA, prețurile includ TVA 19%  
> ☐ NU, prețurile sunt fără TVA

> **Î10: Cum vrei să vezi profitul în rapoarte?**
> 
> ☐ Profit BRUT (fără să scad TVA-ul)  
> ☐ Profit NET (după ce scad TVA-ul)  
> ☐ Ambele pentru comparație

> **Î11: Costurile SKU includ TVA?**
> 
> ☐ DA  
> ☐ NU

---

## Întrebări despre Comenzi în Tranzit

**Situația actuală:** Comenzile "în tranzit" sunt calculate CA ȘI CUM ar fi livrate.

> **Î12: Cum vrei să tratăm comenzile care nu sunt încă livrate?**
> 
> ☐ Le includem în profit (optimist)  
> ☐ Le excludem până sunt livrate (conservator)  
> ☐ Le afișăm separat ca "profit așteptat"

---

## Alte costuri

> **Î13: Mai ai și alte costuri per comandă?**
> 
> ☐ Cost ambalare → Cât? _______ RON  
> ☐ Cost procesare plată (Stripe, etc.) → Cât? _______ %  
> ☐ Cost Frisbo/fulfillment → Cât? _______ RON  
> ☐ Nu am alte costuri

---

## Rezumat răspunsuri

| Nr. | Întrebare | Răspuns |
|-----|-----------|---------|
| Î1 | Discount corect? | |
| Î2 | Produsul returnat se revinde? | |
| Î3 | Cine plătește retur? | |
| Î4 | Taxe retur? | |
| Î5 | Ai comision agenție? | |
| Î6 | Tip comision? | |
| Î7 | Comision pe toate comenzile? | |
| Î8 | Comision diferit per magazin? | |
| Î9 | Prețuri cu TVA? | |
| Î10 | Profit brut sau net? | |
| Î11 | Costuri SKU cu TVA? | |
| Î12 | Tratament comenzi în tranzit? | |
| Î13 | Alte costuri? | |

---

**Data:** 06.02.2026
