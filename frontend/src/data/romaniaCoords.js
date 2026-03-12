/**
 * Romanian City Coordinates Database
 * Based on postal codes and major cities/towns
 */

// Major Romanian cities and towns with coordinates
export const RO_CITIES = {
    // Bucharest and sectors
    'Bucuresti': [44.4268, 26.1025],
    'București': [44.4268, 26.1025],
    'Bucharest': [44.4268, 26.1025],
    'Sector 1': [44.4710, 26.0758],
    'Sector 2': [44.4495, 26.1353],
    'Sector 3': [44.4142, 26.1427],
    'Sector 4': [44.3958, 26.1065],
    'Sector 5': [44.4044, 26.0660],
    'Sector 6': [44.4370, 26.0210],

    // Major cities
    'Cluj-Napoca': [46.7712, 23.6236],
    'Cluj Napoca': [46.7712, 23.6236],
    'Cluj': [46.7712, 23.6236],
    'Timisoara': [45.7489, 21.2087],
    'Timișoara': [45.7489, 21.2087],
    'Iasi': [47.1585, 27.6014],
    'Iași': [47.1585, 27.6014],
    'Constanta': [44.1598, 28.6348],
    'Constanța': [44.1598, 28.6348],
    'Craiova': [44.3302, 23.7949],
    'Brasov': [45.6580, 25.6012],
    'Brașov': [45.6580, 25.6012],
    'Galati': [45.4353, 28.0080],
    'Galați': [45.4353, 28.0080],
    'Ploiesti': [44.9366, 26.0234],
    'Ploiești': [44.9366, 26.0234],
    'Oradea': [47.0465, 21.9189],
    'Braila': [45.2692, 27.9574],
    'Brăila': [45.2692, 27.9574],
    'Arad': [46.1866, 21.3123],
    'Pitesti': [44.8565, 24.8692],
    'Pitești': [44.8565, 24.8692],
    'Sibiu': [45.7983, 24.1256],
    'Bacau': [46.5670, 26.9146],
    'Bacău': [46.5670, 26.9146],
    'Targu Mures': [46.5386, 24.5579],
    'Târgu Mureș': [46.5386, 24.5579],
    'Baia Mare': [47.6567, 23.5850],
    'Buzau': [45.1500, 26.8333],
    'Buzău': [45.1500, 26.8333],
    'Botosani': [47.7487, 26.6693],
    'Botoșani': [47.7487, 26.6693],
    'Satu Mare': [47.7928, 22.8854],
    'Ramnicu Valcea': [45.0997, 24.3693],
    'Râmnicu Vâlcea': [45.0997, 24.3693],
    'Suceava': [47.6514, 26.2556],
    'Piatra Neamt': [46.9275, 26.3708],
    'Piatra Neamț': [46.9275, 26.3708],
    'Drobeta-Turnu Severin': [44.6264, 22.6596],
    'Drobeta Turnu Severin': [44.6264, 22.6596],
    'Targu Jiu': [45.0378, 23.2745],
    'Târgu Jiu': [45.0378, 23.2745],
    'Targoviste': [44.9244, 25.4572],
    'Târgoviște': [44.9244, 25.4572],
    'Focsani': [45.6969, 27.1858],
    'Focșani': [45.6969, 27.1858],
    'Tulcea': [45.1797, 28.7978],
    'Resita': [45.3008, 21.8883],
    'Reșița': [45.3008, 21.8883],
    'Slatina': [44.4310, 24.3616],
    'Calarasi': [44.2000, 27.3333],
    'Călărași': [44.2000, 27.3333],
    'Alba Iulia': [46.0677, 23.5803],
    'Giurgiu': [43.9037, 25.9699],
    'Deva': [45.8833, 22.9000],
    'Hunedoara': [45.7500, 22.9000],
    'Zalau': [47.1917, 23.0583],
    'Zalău': [47.1917, 23.0583],
    'Sfantu Gheorghe': [45.8667, 25.7833],
    'Sfântu Gheorghe': [45.8667, 25.7833],
    'Bistrita': [47.1333, 24.5000],
    'Bistrița': [47.1333, 24.5000],
    'Vaslui': [46.6333, 27.7333],
    'Alexandria': [43.9833, 25.3333],
    'Miercurea Ciuc': [46.3500, 25.8000],
    'Slobozia': [44.5667, 27.3667],

    // Other cities/towns
    'Medias': [46.1667, 24.3500],
    'Mediaș': [46.1667, 24.3500],
    'Lugoj': [45.6833, 21.9000],
    'Turda': [46.5667, 23.7833],
    'Dej': [47.1333, 23.8833],
    'Onesti': [46.2500, 26.7500],
    'Onești': [46.2500, 26.7500],
    'Roman': [46.9167, 26.9333],
    'Mioveni': [44.9500, 24.9333],
    'Curtea de Arges': [45.1333, 24.6833],
    'Curtea de Argeș': [45.1333, 24.6833],
    'Pascani': [47.2500, 26.7167],
    'Pașcani': [47.2500, 26.7167],
    'Tecuci': [45.8500, 27.4333],
    'Campina': [45.1167, 25.7333],
    'Câmpina': [45.1167, 25.7333],
    'Mangalia': [43.8000, 28.5833],
    'Navodari': [44.3167, 28.6167],
    'Năvodari': [44.3167, 28.6167],
    'Voluntari': [44.4833, 26.1833],
    'Bragadiru': [44.3667, 25.9667],
    'Pantelimon': [44.4500, 26.2000],
    'Popesti-Leordeni': [44.3833, 26.1667],
    'Popești-Leordeni': [44.3833, 26.1667],
    'Otopeni': [44.5500, 26.0833],
    'Buftea': [44.5667, 25.9500],
    'Chitila': [44.5000, 25.9833],
    'Berceni': [44.3333, 26.1333],
    'Chiajna': [44.4500, 25.9667],
    'Magurele': [44.3500, 26.0333],
    'Măgurele': [44.3500, 26.0333],
    'Jilava': [44.3333, 26.0667],
    'Cornetu': [44.3333, 26.0000],
    'Clinceni': [44.3500, 25.9500],
    'Domnesti': [44.3667, 25.9167],
    'Domnești': [44.3667, 25.9167],
    'Stefanestii de Jos': [44.5333, 26.2000],
    'Afumati': [44.5000, 26.2500],
    'Afumați': [44.5000, 26.2500],
    'Tunari': [44.5333, 26.1333],
    'Snagov': [44.6833, 26.1500],
    'Ciorogarla': [44.4167, 25.8833],
    'Ciorogârla': [44.4167, 25.8833],
    '1 Decembrie': [44.3667, 26.0833],
    'Videle': [44.2833, 25.5333],
    'Rosiori de Vede': [44.1167, 24.9833],
    'Roșiori de Vede': [44.1167, 24.9833],
    'Dragasani': [44.6500, 24.2667],
    'Drăgășani': [44.6500, 24.2667],
    'Caracal': [44.1167, 24.3500],
    'Corabia': [43.7667, 24.5000],
    'Bailesti': [44.0333, 23.3500],
    'Băilești': [44.0333, 23.3500],
    'Calafat': [43.9833, 22.9333],
    'Motru': [44.8000, 22.9667],
    'Petrosani': [45.4167, 23.3667],
    'Petroșani': [45.4167, 23.3667],
    'Vulcan': [45.3833, 23.2667],
    'Lupeni': [45.3667, 23.2333],
    'Petrila': [45.4333, 23.4167],
    'Brad': [46.1333, 22.7833],
    'Orastie': [45.8500, 23.2000],
    'Orăștie': [45.8500, 23.2000],
    'Caransebes': [45.4167, 22.2167],
    'Caransebeș': [45.4167, 22.2167],
    'Petila': [45.4333, 23.4167],
    'Campulung': [45.2667, 25.0500],
    'Câmpulung': [45.2667, 25.0500],
    'Oltenita': [44.0833, 26.6333],
    'Oltenița': [44.0833, 26.6333],
    'Fetesti': [44.3833, 27.8333],
    'Fetești': [44.3833, 27.8333],
    'Cernavoda': [44.3333, 28.0333],
    'Cernavodă': [44.3333, 28.0333],
    'Medgidia': [44.2500, 28.2667],
    'Harsova': [44.6833, 27.9500],
    'Hârșova': [44.6833, 27.9500],
    'Babadag': [44.9000, 28.7167],
    'Macin': [45.2500, 28.1333],
    'Măcin': [45.2500, 28.1333],
    'Isaccea': [45.2667, 28.4667],
    'Cisnadie': [45.7167, 24.1500],
    'Cisnădie': [45.7167, 24.1500],
    'Avrig': [45.7000, 24.3833],
    'Fagaras': [45.8500, 24.9667],
    'Făgăraș': [45.8500, 24.9667],
    'Codlea': [45.7000, 25.4500],
    'Sacele': [45.6167, 25.6833],
    'Săcele': [45.6167, 25.6833],
    'Zarnesti': [45.5667, 25.3333],
    'Zărnești': [45.5667, 25.3333],
    'Rasnov': [45.5833, 25.4667],
    'Râșnov': [45.5833, 25.4667],
    'Predeal': [45.5000, 25.5833],
    'Azuga': [45.4500, 25.5833],
    'Busteni': [45.4167, 25.5333],
    'Bușteni': [45.4167, 25.5333],
    'Sinaia': [45.3500, 25.5500],
    'Comarnic': [45.2500, 25.6333],
    'Breaza': [45.1833, 25.6667],
    'Sinaia': [45.3500, 25.5500],
    'Valenii de Munte': [45.1833, 26.0333],
    'Vălenii de Munte': [45.1833, 26.0333],
    'Urlati': [44.9833, 26.2333],
    'Mizil': [44.9833, 26.4667],
    'Urziceni': [44.7167, 26.6333],
    'Slobozia': [44.5667, 27.3667],
    'Tandarei': [44.6333, 27.6500],
    'Țăndărei': [44.6333, 27.6500],
    'Ramnicu Sarat': [45.3833, 27.0500],
    'Râmnicu Sărat': [45.3833, 27.0500],
    'Adjud': [46.1000, 27.1833],
    'Panciu': [45.9000, 27.1000],
    'Husi': [46.6667, 28.0500],
    'Huși': [46.6667, 28.0500],
    'Barlad': [46.2333, 27.6667],
    'Bârlad': [46.2333, 27.6667],
    'Moinesti': [46.4667, 26.4833],
    'Moinești': [46.4667, 26.4833],
    'Comanesti': [46.4167, 26.4333],
    'Comănești': [46.4167, 26.4333],
    'Darmanesti': [46.3667, 26.5000],
    'Dărmănești': [46.3667, 26.5000],
    'Targu Ocna': [46.2833, 26.6167],
    'Târgu Ocna': [46.2833, 26.6167],
    'Slanic Moldova': [46.2000, 26.4333],
    'Sebes': [45.9500, 23.5667],
    'Sebeș': [45.9500, 23.5667],
    'Aiud': [46.3000, 23.7167],
    'Blaj': [46.1833, 23.9167],
    'Cugir': [45.8333, 23.3667],
    'Ocna Mures': [46.3833, 23.8500],
    'Ocna Mureș': [46.3833, 23.8500],
    'Reghin': [46.7833, 24.7167],
    'Sighisoara': [46.2167, 24.7833],
    'Sighișoara': [46.2167, 24.7833],
    'Ludus': [46.4833, 24.1000],
    'Luduș': [46.4833, 24.1000],
    'Odorheiu Secuiesc': [46.3000, 25.3000],
    'Toplita': [46.9167, 25.3500],
    'Toplița': [46.9167, 25.3500],
    'Gheorgheni': [46.7167, 25.5833],
    'Targu Secuiesc': [46.0000, 26.1333],
    'Târgu Secuiesc': [46.0000, 26.1333],
    'Covasna': [45.8500, 26.1833],
    'Baraolt': [46.0667, 25.6000],
    'Carei': [47.6833, 22.4667],
    'Sighetu Marmatiei': [47.9333, 23.8833],
    'Sighetu Marmației': [47.9333, 23.8833],
    'Viseu de Sus': [47.7167, 24.4333],
    'Vișeu de Sus': [47.7167, 24.4333],
    'Borsa': [47.6500, 24.6667],
    'Borșa': [47.6500, 24.6667],
    'Negresti Oas': [47.8667, 23.4167],
    'Negrești-Oaș': [47.8667, 23.4167],
    'Tasnad': [47.4667, 22.5833],
    'Tășnad': [47.4667, 22.5833],
    'Marghita': [47.3500, 22.3333],
    'Salonta': [46.8000, 21.6500],
    'Beius': [46.6667, 22.3500],
    'Beiuș': [46.6667, 22.3500],
    'Alesd': [47.0667, 22.4000],
    'Aleșd': [47.0667, 22.4000],
    'Stei': [46.5333, 22.4500],
    'Ștei': [46.5333, 22.4500],
    'Lipova': [46.0833, 21.6833],
    'Ineu': [46.4333, 21.8333],
    'Sebes': [46.0667, 21.4167],
    'Sebiș': [46.3667, 22.1167],
    'Pecica': [46.1667, 21.0667],
    'Sannicolau Mare': [46.0667, 20.6333],
    'Sânnicolau Mare': [46.0667, 20.6333],
    'Jimbolia': [45.7833, 20.7167],
    'Deta': [45.4000, 21.2167],
    'Faget': [45.8500, 22.1833],
    'Făget': [45.8500, 22.1833],
    'Buzias': [45.6500, 21.6000],
    'Buziaș': [45.6500, 21.6000],
    'Recas': [45.7833, 21.5000],
    'Recaș': [45.7833, 21.5000],
    'Ciacova': [45.5000, 21.1333],
    'Vinga': [46.0167, 21.2000],
    'Lipova': [46.0833, 21.6833],
    'Nadlac': [46.1667, 20.7500],
    'Nădlac': [46.1667, 20.7500],
    'Radauti': [47.8500, 25.9167],
    'Rădăuți': [47.8500, 25.9167],
    'Campulung Moldovenesc': [47.5333, 25.5500],
    'Câmpulung Moldovenesc': [47.5333, 25.5500],
    'Falticeni': [47.4667, 26.3000],
    'Fălticeni': [47.4667, 26.3000],
    'Vatra Dornei': [47.3500, 25.3667],
    'Gura Humorului': [47.5500, 25.8833],
    'Dorohoi': [47.9500, 26.4000],
    'Saveni': [47.9500, 26.8667],
    'Săveni': [47.9500, 26.8667],
    'Darabani': [48.2000, 26.6000],
    'Tirgu Frumos': [47.2000, 26.9000],
    'Târgu Frumos': [47.2000, 26.9000],
    'Harlau': [47.4333, 26.9000],
    'Hârlău': [47.4333, 26.9000],
    'Bicaz': [46.9167, 26.0833],
    'Targu Neamt': [47.2000, 26.3667],
    'Târgu Neamț': [47.2000, 26.3667],
    'Zimnicea': [43.6500, 25.3667],
    'Turnu Magurele': [43.7500, 24.8833],
    'Turnu Măgurele': [43.7500, 24.8833],
}

// Romanian postal code to county coordinates mapping
// Based on official Romanian postal code system (6 digits)
// First 2 digits indicate the county
export const RO_POSTAL_COORDS = {
    // Bucharest sectors (01-06)
    '01': [44.4710, 26.0758],   // Sector 1
    '02': [44.4495, 26.1353],   // Sector 2
    '03': [44.4142, 26.1427],   // Sector 3
    '04': [44.3958, 26.1065],   // Sector 4
    '05': [44.4044, 26.0660],   // Sector 5
    '06': [44.4370, 26.0210],   // Sector 6
    // Counties (alphabetical order by postal code)
    '07': [44.4268, 26.1025],   // Ilfov
    '10': [46.0677, 23.5803],   // Alba
    '11': [46.1866, 21.3123],   // Arad
    '12': [44.8565, 24.8692],   // Arges
    '13': [46.5670, 26.9146],   // Bacau
    '14': [47.0465, 21.9189],   // Bihor
    '15': [47.1333, 24.5000],   // Bistrita-Nasaud
    '16': [47.7487, 26.6693],   // Botosani
    '17': [45.2692, 27.9574],   // Braila
    '20': [45.6580, 25.6012],   // Brasov
    '21': [45.1500, 26.8333],   // Buzau
    '22': [44.2000, 27.3333],   // Calarasi
    '23': [45.3008, 21.8883],   // Caras-Severin
    '24': [46.7712, 23.6236],   // Cluj
    '25': [44.1598, 28.6348],   // Constanta
    '26': [45.8667, 25.7833],   // Covasna
    '27': [44.9244, 25.4572],   // Dambovita
    '28': [44.3302, 23.7949],   // Dolj
    '29': [45.4353, 28.0080],   // Galati
    '30': [43.9037, 25.9699],   // Giurgiu
    '31': [45.0378, 23.2745],   // Gorj
    '32': [46.3500, 25.8000],   // Harghita
    '33': [45.8833, 22.9000],   // Hunedoara
    '34': [44.5667, 27.3667],   // Ialomita
    '35': [47.1585, 27.6014],   // Iasi
    '36': [47.6567, 23.5850],   // Maramures
    '37': [44.6264, 22.6596],   // Mehedinti
    '38': [46.5386, 24.5579],   // Mures
    '39': [46.9275, 26.3708],   // Neamt
    '40': [44.4310, 24.3616],   // Olt
    '41': [44.9366, 26.0234],   // Prahova
    '42': [47.1333, 24.5000],   // Bistrita-Nasaud (427xxx)
    '43': [45.0997, 24.3693],   // Valcea
    '44': [47.7928, 22.8854],   // Satu Mare
    '45': [47.1917, 23.0583],   // Salaj
    '46': [45.7983, 24.1256],   // Sibiu
    '47': [47.6514, 26.2556],   // Suceava
    '48': [43.9833, 25.3333],   // Teleorman
    '49': [45.7489, 21.2087],   // Timis
    '50': [45.1797, 28.7978],   // Tulcea
    '51': [46.6333, 27.7333],   // Vaslui
    '52': [45.6969, 27.1858],   // Vrancea
}

// County name to coordinates (for province matching)
export const RO_COUNTIES = {
    'Alba': [46.0677, 23.5803],
    'Arad': [46.1866, 21.3123],
    'Arges': [44.8565, 24.8692],
    'Argeș': [44.8565, 24.8692],
    'Bacau': [46.5670, 26.9146],
    'Bacău': [46.5670, 26.9146],
    'Bihor': [47.0465, 21.9189],
    'Bistrita-Nasaud': [47.1333, 24.5000],
    'Bistrița-Năsăud': [47.1333, 24.5000],
    'Botosani': [47.7487, 26.6693],
    'Botoșani': [47.7487, 26.6693],
    'Braila': [45.2692, 27.9574],
    'Brăila': [45.2692, 27.9574],
    'Brasov': [45.6580, 25.6012],
    'Brașov': [45.6580, 25.6012],
    'Bucuresti': [44.4268, 26.1025],
    'București': [44.4268, 26.1025],
    'Buzau': [45.1500, 26.8333],
    'Buzău': [45.1500, 26.8333],
    'Calarasi': [44.2000, 27.3333],
    'Călărași': [44.2000, 27.3333],
    'Caras-Severin': [45.3008, 21.8883],
    'Caraș-Severin': [45.3008, 21.8883],
    'Cluj': [46.7712, 23.6236],
    'Constanta': [44.1598, 28.6348],
    'Constanța': [44.1598, 28.6348],
    'Covasna': [45.8667, 25.7833],
    'Dambovita': [44.9244, 25.4572],
    'Dâmbovița': [44.9244, 25.4572],
    'Dolj': [44.3302, 23.7949],
    'Galati': [45.4353, 28.0080],
    'Galați': [45.4353, 28.0080],
    'Giurgiu': [43.9037, 25.9699],
    'Gorj': [45.0378, 23.2745],
    'Harghita': [46.3500, 25.8000],
    'Hunedoara': [45.8833, 22.9000],
    'Ialomita': [44.5667, 27.3667],
    'Ialomița': [44.5667, 27.3667],
    'Iasi': [47.1585, 27.6014],
    'Iași': [47.1585, 27.6014],
    'Ilfov': [44.4268, 26.1025],
    'Maramures': [47.6567, 23.5850],
    'Maramureș': [47.6567, 23.5850],
    'Mehedinti': [44.6264, 22.6596],
    'Mehedinți': [44.6264, 22.6596],
    'Mures': [46.5386, 24.5579],
    'Mureș': [46.5386, 24.5579],
    'Neamt': [46.9275, 26.3708],
    'Neamț': [46.9275, 26.3708],
    'Olt': [44.4310, 24.3616],
    'Prahova': [44.9366, 26.0234],
    'Salaj': [47.1917, 23.0583],
    'Sălaj': [47.1917, 23.0583],
    'Satu Mare': [47.7928, 22.8854],
    'Sibiu': [45.7983, 24.1256],
    'Suceava': [47.6514, 26.2556],
    'Teleorman': [43.9833, 25.3333],
    'Timis': [45.7489, 21.2087],
    'Timiș': [45.7489, 21.2087],
    'Tulcea': [45.1797, 28.7978],
    'Vaslui': [46.6333, 27.7333],
    'Valcea': [45.0997, 24.3693],
    'Vâlcea': [45.0997, 24.3693],
    'Vrancea': [45.6969, 27.1858],
}

// Get coordinates from city name, province, or postal code
export function getCoordinates(cityName, postalCode, countryCode, province) {
    // Try city name first
    if (cityName && RO_CITIES[cityName]) {
        return RO_CITIES[cityName]
    }

    // Try with normalized city name (remove diacritics)
    if (cityName) {
        const normalized = cityName
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
        if (RO_CITIES[normalized]) {
            return RO_CITIES[normalized]
        }
    }

    // Try province/county name
    if (province && countryCode === 'RO') {
        if (RO_COUNTIES[province]) {
            const coords = RO_COUNTIES[province]
            // Add small deterministic offset based on city name
            const hash = (cityName || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
            const offset = [
                ((hash % 100) / 100 - 0.5) * 0.15,
                (((hash * 7) % 100) / 100 - 0.5) * 0.15
            ]
            return [coords[0] + offset[0], coords[1] + offset[1]]
        }
    }

    // Try postal code for Romania
    if (postalCode && countryCode === 'RO') {
        const prefix = postalCode.toString().substring(0, 2)
        if (RO_POSTAL_COORDS[prefix]) {
            const coords = RO_POSTAL_COORDS[prefix]
            // Add small deterministic offset based on city name
            const hash = (cityName || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
            const offset = [
                ((hash % 100) / 100 - 0.5) * 0.15,
                (((hash * 7) % 100) / 100 - 0.5) * 0.15
            ]
            return [coords[0] + offset[0], coords[1] + offset[1]]
        }
    }

    return null
}
