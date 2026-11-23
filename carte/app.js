const SECT = { R: "Résidentiel", T: "Tertiaire", I: "Industrie", A: "Autres" };
const SKEYS = ["R", "T", "I", "A"];
const P1 = [0, 1, 2], P2 = [4, 5, 6];   // périodes comparées : 2019-21 et 2023-25
const fmt0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const gwh = mwh => mwh >= 100000 ? fmt0.format(mwh / 1000) + " GWh" : mwh >= 1000 ? fmt1.format(mwh / 1000) + " GWh" : fmt0.format(mwh) + " MWh";
const stable = (v, f) => f.format(Math.abs(v)) === "0";
const pct = (v, f = fmt0) => (stable(v, f) ? "" : v > 0 ? "+" : "−") + f.format(Math.abs(v)) + " %";
// évolution affichée : flèche + signe + couleur (rouge = baisse, vert = hausse), partout le même codage
function evo(v, f = fmt0) {
  if (v == null) return "—";
  if (stable(v, f)) return `<span class="evo">= ${pct(v, f)}</span>`;
  return `<span class="evo ${v < 0 ? "down" : "up"}">${v < 0 ? "▼" : "▲"} ${pct(v, f)}</span>`;
}
const pluriel = (n, mot) => `${fmt0.format(n)} ${mot}${n > 1 ? "s" : ""}`;

/* Repères de lecture : ce ne sont pas des critères réglementaires */
const SEUIL_CLASSEMENT = 5000;    // MWh par an : écarte les petits volumes, où les pourcentages n'ont pas de sens
const NB_CLASSEMENT = 12;
const CHALEUR_SURTOUT_GAZ = 50;   // % de gaz dans la production : au-delà, le réseau de chaleur dépend du gaz
const CHALEUR_MIN_CLIENTS = 3;    // en dessous, réseau dédié à un site, pas une solution pour un quartier
const REVENU_MODESTE = 23000;     // € par an : environ les 10 % de communes alsaciennes les plus modestes
const DENSITE_FAIBLE = 0.5;       // MWh par mètre de réseau
const RECUL_FORT = -15;           // % d'évolution du gaz
const REPORT_MIN_GAZ = 1000;      // MWh par an de gaz résidentiel : en dessous, un report n'est pas lisible
const REPORT_RECUL_GAZ = -5;      // % : le gaz doit reculer nettement…
const REPORT_HAUSSE_ELEC = 1;     // % : …et l'électricité progresser au-delà du bruit
const MAISONS_MAJORITE = 60;      // % des logements chauffés au gaz qui sont des maisons : électrification plus simple
const INDUSTRIE_MIN = 1000;       // MWh par an en NAF 20, 23, 24 : en dessous, un atelier plutôt qu'un procédé industriel
const PEU_DE_CLIENTS = 200;       // points de livraison : une intervention concentrée sur peu de clients

/* Grille de densité communale de l'INSEE, segmentation utilisée par la CRE */
const DENSITES = [null, "Grands centres urbains", "Centres urbains intermédiaires", "Petites villes", "Ceintures urbaines", "Bourgs ruraux", "Rural à habitat dispersé", "Rural à habitat très dispersé"];

/* ---------- couches de la carte ----------
   Ajouter une couche linéaire : produire data/<id>.json avec exporter_lignes() dans
   scripts/04_donnees_carte.py, puis la déclarer ici avec `fichier`, `couleur` (jeton CSS) et
   `epaisseur`. Sans `fichier`, la couche est interactive et dessinée par buildTransition().
   `cles` : la légende de la couche, affichée dans le menu Couches. */
const COUCHES = [
  { id: "reseau", label: "Réseau GRDF", fichier: "data/reseau.json", couleur: "--net", epaisseur: 1, actif: false,
    cles: [["height:2px;background:var(--net)", "Canalisations"]] },
  { id: "biomethane", label: "Sites de biométhane", actif: false,
    cles: [["background:var(--biomethane)", "Injecte plus que la commune ne consomme", "losange"], ["background:var(--surface)", "Consommé sur place", "losange"]] },
  { id: "chaleur", label: "Réseaux de chaleur", actif: false,
    cles: [["border-top:2.5px solid var(--chaleur)", "Réseau utilisable"], ["border-top:2px dotted var(--chaleur)", "Surtout au gaz ou réseau dédié"], ["border-top:2px dashed var(--chaleur)", "Projet"], ["height:10px;background:color-mix(in srgb, var(--chaleur) 22%, transparent)", "Zone de développement prioritaire"]] },
  { id: "autres", label: "Réseaux R-GDS et Vialis", fichier: "data/reseau_autres.json", couleur: "--net2", epaisseur: 1, actif: false,
    cles: [["height:2px;background:var(--net2)", "Canalisations (Agence ORE)"]] },
  { id: "natran", label: "Réseau de transport NaTran", fichier: "data/natran.json", couleur: "--natran", epaisseur: 2.6, actif: false,
    cles: [["height:3px;background:var(--natran)", "Gazoducs (tracé à 250 m près)"]] },
  { id: "industrie", label: "Industries au gaz non substituable", actif: false,
    cles: [["background:var(--industrie)", "Chimie, verre, métallurgie (20 salariés et plus)", "triangle"], ["background:var(--biomethane)", "Site de rebours vers le transport", "triangle"]] },
  { id: "zonages", label: "Zonages biométhane", actif: false,
    cles: [["border-top:2px dashed var(--biomethane)", "Zonage de raccordement, avec ses projets en attente"]] },
];
const couche = id => COUCHES.find(l => l.id === id).actif;

/* ---------- thèmes : ils regroupent les indicateurs et règlent les couches utiles ---------- */
const THEMES = [
  { id: "synthese", label: "Synthèse", modes: ["profil"], couches: ["biomethane"] },
  { id: "ciblage", label: "Ciblage", modes: ["ciblage"], couches: [] },
  { id: "usages", label: "Usages durables", modes: ["usages", "densinsee"], couches: ["biomethane", "industrie"] },
  { id: "constat", label: "Constat", modes: ["evol", "conso"], couches: [] },
  { id: "reseau", label: "Réseau", modes: ["densiteTous", "lineaireTous", "densite", "lineaire"], couches: ["reseau", "autres"] },
  { id: "alternatives", label: "Alternatives", modes: ["electricite", "chaleur", "chauffGaz", "difficile"], couches: ["chaleur"] },
  { id: "menages", label: "Ménages", modes: ["revenus", "proprietaires"], couches: [] },
];

/* ---------- grille de ciblage : critères de la CRE, combinables ----------
   Une commune avec un usage durable du gaz est écartée si `ecarter` est coché ; sinon elle reçoit un point par
   critère favorable coché. Ce sont des repères pour hiérarchiser l'analyse, pas une décision. */
const CRITERES = [
  { id: "peuUtilise", label: "Réseau peu utilisé", aide: `moins de ${String(DENSITE_FAIBLE).replace(".", ",")} MWh par mètre, tous gestionnaires publiés`, actif: true, test: c => { const v = densiteTous(c); return v != null && v < DENSITE_FAIBLE; } },
  { id: "recul", label: "Gaz en net recul", aide: `au moins ${-RECUL_FORT} % entre 2019-21 et 2023-25`, actif: true, test: c => (CONSO[c]?.e?.tot ?? 0) <= RECUL_FORT },
  { id: "chaleur", label: "Réseau de chaleur possible", aide: "réseau utilisable, zone prioritaire ou projet", actif: true, test: c => substitutionPossible(c) },
  { id: "maisons", label: "Électrification simple", aide: `au moins ${MAISONS_MAJORITE} % des logements au gaz sont des maisons`, actif: true, test: c => { const l = CRE[c]?.log; return l?.g >= 10 && 100 * l.gm / l.g >= MAISONS_MAJORITE; } },
  { id: "peuClients", label: "Peu de clients", aide: `moins de ${PEU_DE_CLIENTS} points de livraison`, actif: true, test: c => (CONSO[c]?.n?.[6] || 0) < PEU_DE_CLIENTS },
  { id: "revenus", label: "Ménages en capacité d'investir", aide: `revenu médian d'au moins ${fmt0.format(REVENU_MODESTE)} €`, actif: false, test: c => TR.revenus[c]?.[0] >= REVENU_MODESTE },
  { id: "rural", label: "Commune rurale ou périurbaine", aide: "niveaux 4 à 7 de la grille INSEE : plus de bouts d'antenne", actif: false, test: c => CRE[c]?.d >= 4 },
];
const ciblage = { ecarter: true };

const state = { terr: "alsace", echelle: "commune", theme: "synthese", mode: "profil", sect: "tot", year: 2025, sel: null, filtre: false, cat: null, fiche: undefined };
let D, META, CONSO, YEARS, TEA, TR, EL, EPCI, CRE, CREG, paths, gMap, zoom, proj, transform = d3.zoomIdentity;
const EPCI_DE = {};        // commune -> EPCI
const GE = {};             // commune -> gaz et électricité des logements sur les deux périodes
const PROFIL = {};         // commune -> { id, motif }
let cacheEPCI = new Map();

function decode(arr, q) {
  const pts = []; let x = 0, y = 0;
  for (let i = 0; i < arr.length; i += 2) { x += arr[i]; y += arr[i + 1]; pts.push([x * q, y * q]); }
  return pts;
}
const mean = (a, idx) => { const v = idx.map(i => a[i]).filter(x => x != null); return v.length ? d3.sum(v) / v.length : null; };
const mean2 = (a, idx) => idx.filter(i => a[i] != null).length >= 2 ? mean(a, idx) : null;   // au moins 2 années sur 3
const total = (c, i) => { const s = CONSO[c]?.s; if (!s) return null; const v = SKEYS.map(k => s[k][i]); return v.every(x => x == null) ? null : d3.sum(v); };
const sectVal = (c, k, i) => k === "tot" ? total(c, i) : CONSO[c]?.s?.[k]?.[i] ?? null;
const evolution = arr => 100 * (mean(arr, P2) / mean(arr, P1) - 1);
const totaux = A => YEARS.map((y, i) => d3.sum(SKEYS, k => A[k][i]));
// gaz et points de livraison GRDF de l'année i, rapportés au réseau GRDF (seul réseau connu)
function reseauGRDF(c, i) {
  const r = CONSO[c]?.r, km = META[c][3];
  if (!r || km <= 0.5 || r.v[i] == null) return null;
  return { mwh: r.v[i], n: r.n[i], m: km * 1000, partiel: r.p.includes(i) };
}
const iAnnee = () => YEARS.indexOf(state.year);
const densite = c => { const g = reseauGRDF(c, iAnnee()); return g ? g.mwh / g.m : null; };
const lineaire = c => { const g = reseauGRDF(c, iAnnee()); return g?.n ? g.m / g.n : null; };
const notePartiel = c => reseauGRDF(c, iAnnee())?.partiel ? "Données partielles (secret statistique)" : null;

/* ---------- territoires ---------- */
const TERR_FIXES = {
  alsace: { nom: "Toute l'Alsace", dans: "les communes alsaciennes", serie: () => D.alsace, sites: () => D.alsace_sites },
  tea: { nom: "Communes de TEA", dans: "les communes de TEA", serie: () => TEA.serie, sites: () => TEA.sites },
};
function terr() {
  if (TERR_FIXES[state.terr]) return TERR_FIXES[state.terr];
  const e = EPCI[state.terr];
  return { nom: e.nom, dans: `les communes de la ${e.nom}`, serie: () => e.serie, sites: () => e.sites };
}
const dansTerritoire = c => state.terr === "alsace" || (state.terr === "tea" ? TEA.codes.has(c) : EPCI_DE[c] === state.terr);
const communesTerritoire = () => Object.keys(META).filter(dansTerritoire);
const habitants = codes => d3.sum(codes, c => EL[c]?.hab || 0);

/* ---------- lecture du décommissionnement : ancrage, substitution, accompagnement ---------- */
const gazDistribue = c => (CONSO[c]?.n?.[6] || 0) > 0;
const surtoutGaz = r => r.gaz != null && r.gaz >= CHALEUR_SURTOUT_GAZ;
const clientUnique = r => r.pdl != null && r.pdl < CHALEUR_MIN_CLIENTS;
const chaleurUtile = r => !surtoutGaz(r) && !clientUnique(r);
const chaleurDe = c => TR.parCommune[c] || { reseaux: [], zone: false, projets: [] };
const substitutionPossible = c => { const h = chaleurDe(c); return h.reseaux.some(chaleurUtile) || h.zone || h.projets.length > 0; };
const gazBatiments = c => d3.sum(["R", "T"], k => CONSO[c]?.s?.[k]?.[iAnnee()] || 0);
// un site qui injecte plus que sa commune ne consomme a besoin du réseau pour évacuer son gaz
function ancrageSite(s) {
  const conso = total(s.c, YEARS.indexOf(s.annee));
  if (!conso) return { fort: true, texte: "Aucune consommation publiée dans la commune : gaz probablement évacué ailleurs" };
  const ratio = s.mwh / conso;
  return ratio > 1
    ? { fort: true, texte: `Injecte ${fmt1.format(ratio)} fois ce que la commune consomme` }
    : { fort: false, texte: `Injecte ${fmt0.format(ratio * 100)} % de ce que la commune consomme` };
}
/* ---------- critères de la CRE ---------- */
// réseau des gestionnaires publiés par l'Agence ORE (GRDF, R-GDS, Vialis), dernière année
function reseauTous(c) {
  const k = CRE[c]?.km, op = CRE[c]?.op;
  if (!k || !op) return null;
  const g = Object.keys(op), m = 1000 * d3.sum(g, x => k[x]);
  return m > 500 ? { mwh: d3.sum(g, x => op[x][0]), n: d3.sum(g, x => op[x][1]), m, grd: g } : null;
}
const densiteTous = c => { const r = reseauTous(c); return r ? r.mwh / r.m : null; };
const lineaireTous = c => { const r = reseauTous(c); return r?.n ? r.m / r.n : null; };
// usages qui, selon la CRE, nécessitent durablement le réseau : biométhane, industrie non substituable, chaleur au gaz
function usagesCRE(c) {
  const sites = TR.biomethane.filter(s => s.c === c), reb = CREG.rebours.filter(r => r.c === c), n = CRE[c]?.naf;
  const naf = n && (n[0] >= INDUSTRIE_MIN || (n[2] && !n[0])) ? n : null;   // volume masqué par le secret : compté
  const rcu = chaleurDe(c).reseaux.filter(r => r.gaz > 0);
  const u = [];
  const inj = CREG.injection.filter(s => s.c === c);
  if (sites.length || reb.length || inj.length) u.push({ id: "biomethane", texte: [...sites.map(s => `site d'injection ${s.nom}`), ...inj.map(s => `site d'injection ${s.nom} (${s.grd})`), ...reb.map(r => `rebours ${r.nom}`)].join(", ") });
  if (naf) u.push({ id: "industrie", texte: `industrie chimique, verrière ou métallurgique : ${naf[0] ? gwh(naf[0]) + " par an" : "volume couvert par le secret"}, ${pluriel(naf[1], "point")} de livraison` });
  if (rcu.length) u.push({ id: "chaleur", texte: rcu.map(r => `réseau de chaleur ${r.nom} (${fmt0.format(r.gaz)} % de gaz)`).join(", ") });
  return u;
}
const nbUsages = c => gazDistribue(c) || TR.biomethane.some(s => s.c === c) || CREG.injection.some(s => s.c === c) ? usagesCRE(c).length : null;
// score de la grille de ciblage : -1 si écartée, sinon nombre de critères favorables cochés et remplis
function scoreCiblage(c) {
  if (!gazDistribue(c)) return null;
  if (ciblage.ecarter && (usagesCRE(c).length || CONSO[c]?.t?.[6] > 0)) return -1;
  return CRITERES.filter(k => k.actif && k.test(c)).length;
}
const criteresRemplis = c => CRITERES.filter(k => k.actif && k.test(c));
const pctLog = (c, k) => { const l = CRE[c]?.log; return l?.rp >= 20 ? 100 * l[k] / l.rp : null; };
const evolElec = c => { const r = EL[c]?.r; if (!r) return null; const a = mean2(r, P1), b = mean2(r, P2); return a && b != null ? 100 * (b / a - 1) : null; };
// même commune, mêmes logements : le gaz perdu se retrouve-t-il en électricité ?
function gazElec(c) {
  const d = CONSO[c], r = EL[c]?.r;
  if (!d?.s || d.e?.R == null || !r) return null;
  const g1 = mean2(d.s.R, P1), g2 = mean2(d.s.R, P2), e1 = mean2(r, P1), e2 = mean2(r, P2);
  if (g1 == null || g2 == null || !e1 || e2 == null) return null;
  return { g1, g2, e1, e2, gaz: d.e.R, elec: 100 * (e2 / e1 - 1), report: g1 > g2 ? (e2 - e1) / (g1 - g2) : null };
}
const reportVisible = g => g && g.g1 >= REPORT_MIN_GAZ && g.gaz <= REPORT_RECUL_GAZ && g.elec >= REPORT_HAUSSE_ELEC;
// évolution d'un secteur sur un groupe de communes, sans celles dont la répartition par secteur est incertaine
function evolSecteur(codes, k) {
  const l = codes.filter(c => CONSO[c]?.e?.[k] != null), s = c => CONSO[c].s[k];
  const a = d3.sum(l, c => mean2(s(c), P1) || 0), b = d3.sum(l, c => mean2(s(c), P2) || 0);
  return a ? 100 * (b / a - 1) : null;
}
function comparaison(codes) {
  const l = codes.map(c => GE[c]).filter(Boolean);
  if (!l.length) return null;
  const [g1, g2, e1, e2] = ["g1", "g2", "e1", "e2"].map(k => d3.sum(l, x => x[k]));
  return { g1, g2, e1, e2, n: l.length, gaz: 100 * (g2 / g1 - 1), elec: 100 * (e2 / e1 - 1), reports: l.filter(reportVisible).length };
}
const PROFILS = [
  { id: "ancre", label: "Réseau ancré", couleur: "--p-ancre", aide: "Un usage durable du gaz (biométhane, industrie non substituable, chaleur au gaz, transport) rend le réseau difficile à retirer." },
  { id: "menages", label: "Ménages à accompagner", couleur: "--p-menages", aide: "Revenus modestes : toute évolution du réseau suppose un accompagnement préalable." },
  { id: "substitution", label: "Substitution possible", couleur: "--p-substitution", aide: "Un réseau de chaleur, une zone prioritaire ou un projet offre une alternative." },
  { id: "faible", label: "Réseau peu sollicité", couleur: "--p-faible", aide: "Le réseau achemine peu de gaz pour sa longueur et la consommation recule." },
  { id: "suivre", label: "À suivre", couleur: "--p-suivre", aide: "Aucun signal marqué à ce stade." },
];
const profilDe = id => PROFILS.find(p => p.id === id);
function calculerProfil(c) {
  const d = CONSO[c] || {}, sites = TR.biomethane.filter(s => s.c === c);
  if (!gazDistribue(c) && !sites.length && !CREG.injection.some(s => s.c === c)) return null;
  const rev = TR.revenus[c]?.[0], dens = densiteTous(c) ?? (reseauGRDF(c, 6) ? reseauGRDF(c, 6).mwh / reseauGRDF(c, 6).m : null);
  // usages durables au sens de la CRE : tout site de biométhane ou de rebours, industrie non substituable
  if (sites.length) return { id: "ancre", motif: `Site de biométhane : ${sites[0].nom}` };
  const inj = CREG.injection.find(s => s.c === c);
  if (inj) return { id: "ancre", motif: `Site de biométhane : ${inj.nom}` };
  if (CREG.rebours.some(r => r.c === c)) return { id: "ancre", motif: "Site de rebours vers le transport" };
  if (usagesCRE(c).some(u => u.id === "industrie")) return { id: "ancre", motif: "Industrie au gaz non substituable" };
  if (d.t?.[6] > 0) return { id: "ancre", motif: "Site raccordé au transport" };
  if (chaleurDe(c).reseaux.some(surtoutGaz)) return { id: "ancre", motif: "Réseau de chaleur au gaz" };
  if (rev < REVENU_MODESTE) return { id: "menages", motif: `Revenu médian : ${fmt0.format(rev)} €` };
  if (substitutionPossible(c)) return { id: "substitution", motif: "Réseau de chaleur, zone ou projet" };
  if (dens != null && dens < DENSITE_FAIBLE && (d.e?.tot ?? 0) <= RECUL_FORT) return { id: "faible", motif: `${fmt2.format(dens)} MWh par mètre, gaz ${pct(d.e.tot)}` };
  return { id: "suivre", motif: "" };
}

/* ---------- indicateurs de la carte ----------
   Ajouter un indicateur : une entrée ici et son identifiant dans un thème de THEMES.
   - valeur(c) : nombre ou null pour la commune de code INSEE c
   - agreg(e) : même valeur pour un EPCI ; sans agreg, l'échelle EPCI n'est pas proposée
   - seuils, couleurs (une classe de plus que de seuils), graduations, bornes : légende ;
     seuilsEPCI, graduationsEPCI si les valeurs d'un EPCI sont d'un autre ordre de grandeur
   - categories : remplace les seuils pour un indicateur à classes nommées
   - secteurs / annee : affichent les filtres correspondants
   - lecture() : phrase d'explication au-dessus de la carte
   - note(c) : avertissement dans l'infobulle
   - filtre : { label, garder(v, c) } ajoute une case qui estompe les communes où garder est faux
   - classement : { titre(), note(), ordre (1 = petites valeurs d'abord), garder(c, v), detail(c), court(v),
                    tri(c) et montre(c) facultatifs pour trier ou afficher autre chose que la valeur } */
const nomSecteur = () => state.sect === "tot" ? "" : { R: " dans le résidentiel", T: " dans le tertiaire", I: " dans l'industrie" }[state.sect];
const moyennePeriode = (c, idx) => mean(YEARS.map((y, i) => sectVal(c, state.sect, i)), idx);
const somme = e => { const v = e.communes.map(c => ind().valeur(c)).filter(x => x != null); return v.length ? d3.sum(v) : null; };
const reseauEPCI = e => e.communes.map(c => reseauGRDF(c, iAnnee())).filter(Boolean);
const INDICATEURS = {
  profil: {
    label: "Profils", unite: "", vide: "Pas de gaz distribué connu", categories: PROFILS,
    titre: () => "Profil des communes au regard du réseau de gaz",
    lecture: () => `<b>Chaque couleur résume la situation d'une commune.</b> Cliquez sur un profil dans la légende pour l'isoler. C'est une aide à la lecture, pas une décision.`,
    valeur: c => PROFIL[c]?.id ?? null, texte: v => profilDe(v).label, motif: c => PROFIL[c]?.motif,
    classement: {
      titre: () => state.cat ? profilDe(state.cat).label : "Les communes au gaz, de la plus grosse consommation à la plus petite",
      note: () => state.cat ? profilDe(state.cat).aide : "Choisissez un profil dans la légende de la carte pour filtrer cette liste.",
      ordre: -1, garder: (c, v) => !state.cat || v === state.cat, tri: c => total(c, 6) || 0,
      detail: c => [profilDe(PROFIL[c].id).label, PROFIL[c].motif].filter(Boolean).join(" · "), court: gwh, montre: c => gwh(total(c, 6) || 0),
    },
  },
  evol: {
    label: "Évolution", secteurs: true, unite: "%", vide: "Pas de donnée fiable",
    titre: () => `Évolution ${state.sect === "tot" ? "de la consommation" : "— " + SECT[state.sect].toLowerCase()}, 2019-21 → 2023-25`,
    seuils: [-30, -15, -5, 5, 15, 30], couleurs: ["--d-3", "--d-2", "--d-1", "--d0", "--d1", "--d2", "--d3"],
    graduations: ["−30", "−15", "−5", "+5", "+15", "+30"], bornes: ["▼ Baisse", "Hausse ▲"],
    lecture: () => `<b>Rouge : la consommation a baissé. Vert : elle a augmenté.</b> Plus la couleur est foncée, plus l'écart entre 2019-2021 et 2023-2025 est important.`,
    valeur: c => CONSO[c]?.s ? CONSO[c].e?.[state.sect] ?? null : null, texte: pct,
    agreg: e => state.sect === "tot" ? evolution(totaux(e.serie)) : evolSecteur(e.communes, state.sect),
    note: c => CONSO[c]?.f && state.sect !== "tot" ? "Répartition par secteur incertaine" : null,
    classement: {
      titre: () => state.sect === "R" ? "Où le chauffage au gaz recule le plus" : `Où le gaz recule le plus${nomSecteur()}`,
      note: () => `Évolution de la consommation${nomSecteur()}, moyenne 2023-2025 comparée à 2019-2021. Communes consommant au moins ${fmt0.format(SEUIL_CLASSEMENT / 1000)} GWh par an${nomSecteur()}.`,
      ordre: 1, garder: (c, v) => v < 0 && moyennePeriode(c, P1) >= SEUIL_CLASSEMENT,
      detail: c => `${gwh(moyennePeriode(c, P1))} → ${gwh(moyennePeriode(c, P2))} par an`, court: evo,
    },
  },
  conso: {
    label: "Consommation", secteurs: true, annee: true, unite: "GWh", vide: "Pas de gaz distribué connu",
    titre: () => `Consommation ${state.sect === "tot" ? "totale" : SECT[state.sect].toLowerCase()} en ${state.year}`,
    seuils: [1000, 5000, 20000, 100000], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["1", "5", "20", "100"],
    seuilsEPCI: [50000, 100000, 250000, 500000], graduationsEPCI: ["50", "100", "250", "500"],
    bornes: ["Faible", "Forte"],
    lecture: () => `<b>Plus le bleu est foncé, plus le territoire consomme de gaz</b>${nomSecteur()} en ${state.year}.`,
    valeur: c => sectVal(c, state.sect, iAnnee()), texte: gwh, agreg: somme,
    classement: {
      titre: () => `Qui consomme le plus de gaz${nomSecteur()} en ${state.year}`,
      note: () => `Volumes de gaz distribué${nomSecteur()} en ${state.year}, hors réseau de transport.`,
      ordre: -1, garder: (c, v) => v > 0, detail: c => META[c][2], court: gwh,
    },
  },
  densite: {
    label: "Densité énergétique", annee: true, unite: "MWh/m", vide: "Hors réseau GRDF",
    titre: () => `Gaz GRDF acheminé par mètre de réseau en ${state.year}`,
    seuils: [0.3, 0.45, 0.6, 1], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["0,3", "0,45", "0,6", "1"],
    bornes: ["Peu utilisé", "Très utilisé"],
    lecture: () => `<b>Plus le bleu est clair, moins le réseau est utilisé :</b> il achemine peu de gaz pour sa longueur (${state.year}).`,
    valeur: densite, texte: v => fmt2.format(v) + " MWh par mètre de réseau", note: notePartiel,
    agreg: e => { const g = reseauEPCI(e); return g.length ? d3.sum(g, x => x.mwh) / d3.sum(g, x => x.m) : null; },
    filtre: { label: "Seulement ≤ 0,5 MWh/m", garder: v => v <= DENSITE_FAIBLE },
    classement: {
      titre: () => `Où le réseau GRDF est le moins utilisé en ${state.year}`,
      note: () => `Gaz GRDF acheminé par mètre de réseau en ${state.year}. Communes avec plus de 500 m de réseau et données complètes.`,
      ordre: 1, garder: c => !notePartiel(c),
      detail: c => `${fmt1.format(META[c][3])} km de réseau`, court: v => fmt2.format(v) + " MWh/m",
    },
  },
  lineaire: {
    label: "Réseau par client", annee: true, unite: "m", vide: "Hors réseau GRDF",
    titre: () => `Mètres de réseau GRDF par point de livraison en ${state.year}`,
    seuils: [25, 35, 45, 60], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["25", "35", "45", "60"],
    bornes: ["Court", "Long"],
    lecture: () => `<b>Plus le bleu est foncé, plus il faut de réseau pour desservir un client</b> (${state.year}).`,
    valeur: lineaire, texte: v => fmt0.format(v) + " m de réseau par client", note: notePartiel,
    agreg: e => { const g = reseauEPCI(e); return g.length ? d3.sum(g, x => x.m) / d3.sum(g, x => x.n) : null; },
    classement: {
      titre: () => `Où il faut le plus de réseau par client en ${state.year}`,
      note: () => `Mètres de réseau GRDF par point de livraison en ${state.year}. Communes avec plus de 500 m de réseau et données complètes.`,
      ordre: -1, garder: c => !notePartiel(c),
      detail: c => `${pluriel(reseauGRDF(c, iAnnee()).n, "client")} · ${fmt1.format(META[c][3])} km`, court: v => fmt0.format(v) + " m",
    },
  },
  electricite: {
    label: "Report vers l'électricité", unite: "%", vide: "Série non comparable",
    titre: () => "Évolution de l'électricité des logements, 2019-21 → 2023-25",
    seuils: [-10, -5, -2, 2, 5, 10], couleurs: ["--d-3", "--d-2", "--d-1", "--d0", "--d1", "--d2", "--d3"],
    graduations: ["−10", "−5", "−2", "+2", "+5", "+10"], bornes: ["▼ Baisse", "Hausse ▲"],
    lecture: () => `<b>Vert : l'électricité des logements progresse. Rouge : elle recule.</b> Là où le vert côtoie un gaz en baisse, un report vers l'électricité est possible.`,
    valeur: evolElec, texte: v => pct(v) + " d'électricité dans les logements",
    agreg: e => comparaison(e.communes)?.elec ?? null,
    classement: {
      titre: () => "Où l'électricité prend peut-être le relais du gaz",
      note: () => `Communes où le gaz des logements recule d'au moins ${-REPORT_RECUL_GAZ} % pendant que leur électricité progresse d'au moins ${REPORT_HAUSSE_ELEC} %, à partir de ${fmt0.format(REPORT_MIN_GAZ / 1000)} GWh de gaz par an. C'est un indice, pas une preuve. Triées selon l'électricité gagnée.`,
      ordre: -1, garder: c => reportVisible(GE[c]), tri: c => GE[c].e2 - GE[c].e1,
      detail: c => `Gaz ${gwh(GE[c].g1 - GE[c].g2)} en moins · électricité ${gwh(GE[c].e2 - GE[c].e1)} en plus par an`, court: evo,
    },
  },
  chaleur: {
    label: "Réseau de chaleur", annee: true, unite: "GWh", vide: "Pas de réseau de chaleur utilisable ou pas de gaz",
    titre: () => `Gaz des logements et du tertiaire en ${state.year}, là où un réseau de chaleur existe ou est prévu`,
    seuils: [1000, 5000, 20000, 100000], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["1", "5", "20", "100"],
    seuilsEPCI: [5000, 20000, 100000, 300000], graduationsEPCI: ["5", "20", "100", "300"],
    bornes: ["Faible", "Fort"],
    lecture: () => `<b>Les communes en bleu ont un réseau de chaleur, une zone prioritaire ou un projet.</b> Plus le bleu est foncé, plus il y a de gaz à remplacer dans les logements et le tertiaire. C'est un maximum, pas un objectif.`,
    valeur: c => { if (!substitutionPossible(c)) return null; const v = gazBatiments(c); return v > 0 ? v : null; }, texte: v => gwh(v) + " de gaz dans les bâtiments", agreg: somme,
    classement: {
      titre: () => "Où un réseau de chaleur peut remplacer le plus de gaz",
      note: () => `Gaz des logements et du tertiaire en ${state.year}. Sont exclus les réseaux surtout alimentés au gaz et ceux qui desservent moins de ${CHALEUR_MIN_CLIENTS} clients.`,
      ordre: -1, garder: () => true,
      detail: c => {
        const h = chaleurDe(c), n = h.reseaux.filter(chaleurUtile).length;
        return [n ? `${n} réseau${n > 1 ? "x" : ""}` : "", h.zone ? "zone prioritaire" : "", h.projets.length ? "projet en cours" : ""].filter(Boolean).join(" · ");
      },
      court: gwh,
    },
  },
  ciblage: {
    label: "Grille de ciblage", unite: "", vide: "Pas de gaz distribué connu", categories: () => categoriesCiblage(),
    titre: () => "Communes candidates à une première expérimentation",
    lecture: () => `<b>Plus le bleu est foncé, plus la commune réunit de critères favorables à un repli du gaz</b>, parmi ceux cochés dans « Critères ». ${ciblage.ecarter ? "Les communes grises ont un usage durable du gaz et sont écartées." : ""} C'est une aide pour hiérarchiser l'analyse, pas une décision.`,
    valeur: scoreCiblage, texte: v => catDe(v).label,
    motif: c => scoreCiblage(c) < 0 ? [...usagesCRE(c).map(u => u.texte), ...(CONSO[c]?.t?.[6] > 0 ? ["site industriel raccordé au transport"] : [])].join(" · ") : criteresRemplis(c).map(k => k.label).join(" · "),
    classement: {
      titre: () => state.cat != null ? catDe(state.cat).label : "Les communes qui réunissent le plus de critères favorables",
      note: () => `Critères cochés : ${CRITERES.filter(k => k.actif).map(k => k.label.toLowerCase()).join(", ") || "aucun"}. À score égal, la plus grosse consommation d'abord. Le bouton « Exporter » donne la liste complète avec tous les critères.`,
      ordre: -1, garder: (c, v) => state.cat != null ? v === state.cat : v > 0, tri: c => scoreCiblage(c) * 1e9 + (total(c, 6) || 0),
      detail: c => criteresRemplis(c).map(k => k.label).join(" · ") || "Aucun critère rempli", court: v => v < 0 ? "écartée" : `${v} / ${CRITERES.filter(k => k.actif).length}`,
    },
  },
  usages: {
    label: "Usages durables", unite: "", vide: "Pas de gaz distribué connu", categories: () => CAT_USAGES,
    titre: () => "Usages qui nécessitent durablement le réseau, selon les critères de la CRE",
    lecture: () => `<b>Plus le bleu est foncé, plus la commune cumule d'usages qui ont besoin du réseau sur le long terme</b> : production de biométhane (site ou rebours), industrie chimique, verrière ou métallurgique, réseau de chaleur qui consomme du gaz. Une commune sans usage n'est pas pour autant candidate.`,
    valeur: nbUsages, texte: v => catDe(v).label, motif: c => usagesCRE(c).map(u => u.texte).join(" · "),
    classement: {
      titre: () => state.cat != null ? catDe(state.cat).label : "Les communes où le réseau a un usage durable",
      note: () => "Critères de l'annexe « Analyses locales » de la CRE (2026). L'industrie est repérée par le gaz consommé en NAF 20, 23 et 24 (Agence ORE, 2023-2025).",
      ordre: -1, garder: (c, v) => state.cat != null ? v === state.cat : v > 0, tri: c => nbUsages(c) * 1e9 + (total(c, 6) || 0),
      detail: c => usagesCRE(c).map(u => u.texte).join(" · "), court: v => pluriel(v, "usage"),
    },
  },
  densinsee: {
    label: "Densité INSEE", unite: "", vide: "Non classée", categories: () => CAT_DENSITE,
    titre: () => "Grille communale de densité de l'INSEE (2024)",
    lecture: () => `<b>Bleu : communes urbaines. Ambre : communes rurales.</b> C'est la segmentation de toutes les analyses de la CRE : les communes rurales ont plus de bouts d'antenne et moins de logements collectifs, mais un réseau souvent plus récent et moins amorti.`,
    valeur: c => CRE[c]?.d ?? null, texte: v => catDe(v).label,
    classement: {
      titre: () => state.cat != null ? catDe(state.cat).label : "Les communes au gaz, par niveau de densité",
      note: () => "Grille communale de densité à 7 niveaux de l'INSEE, géographie 2024. Communes au gaz, de la plus grosse consommation à la plus petite.",
      ordre: -1, garder: (c, v) => gazDistribue(c) && (state.cat == null || v === state.cat), tri: c => total(c, 6) || 0,
      detail: c => DENSITES[CRE[c].d], court: gwh, montre: c => gwh(total(c, 6) || 0),
    },
  },
  densiteTous: {
    label: "Densité, tous gestionnaires", unite: "MWh/m", vide: "Réseau non publié (Gaz de Barr, Caléo, Trois Frontières) ou trop court",
    titre: () => `Gaz acheminé par mètre de réseau en ${YEARS.at(-1)}, GRDF, R-GDS et Vialis`,
    seuils: [0.3, 0.45, 0.6, 1], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["0,3", "0,45", "0,6", "1"],
    bornes: ["Peu utilisé", "Très utilisé"],
    lecture: () => `<b>Plus le bleu est clair, moins le réseau est utilisé</b>, pour les trois gestionnaires dont le tracé est publié (Agence ORE). C'est le meilleur indice public de l'équilibre recettes-charges de la concession, en attendant les données du concessionnaire.`,
    valeur: densiteTous, texte: v => fmt2.format(v) + " MWh par mètre de réseau",
    agreg: e => { const g = e.communes.map(reseauTous).filter(Boolean); return g.length ? d3.sum(g, x => x.mwh) / d3.sum(g, x => x.m) : null; },
    filtre: { label: "Seulement ≤ 0,5 MWh/m", garder: v => v <= DENSITE_FAIBLE },
    classement: {
      titre: () => "Où le réseau de distribution est le moins utilisé",
      note: () => `Gaz acheminé en ${YEARS.at(-1)} par mètre de réseau, pour GRDF, R-GDS et Vialis. Communes avec plus de 500 m de réseau publié.`,
      ordre: 1, garder: () => true,
      detail: c => { const r = reseauTous(c); return `${fmt1.format(r.m / 1000)} km · ${r.grd.join(", ")}`; }, court: v => fmt2.format(v) + " MWh/m",
    },
  },
  lineaireTous: {
    label: "Réseau par client, tous gestionnaires", unite: "m", vide: "Réseau non publié ou trop court",
    titre: () => `Mètres de réseau par point de livraison en ${YEARS.at(-1)}, GRDF, R-GDS et Vialis`,
    seuils: [25, 35, 45, 60], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["25", "35", "45", "60"],
    bornes: ["Court", "Long"],
    lecture: () => `<b>Plus le bleu est foncé, plus il faut de réseau pour desservir un client</b> : c'est là que l'abandon d'une antenne libère le plus de linéaire pour peu de clients.`,
    valeur: lineaireTous, texte: v => fmt0.format(v) + " m de réseau par client",
    agreg: e => { const g = e.communes.map(reseauTous).filter(Boolean); return g.length ? d3.sum(g, x => x.m) / d3.sum(g, x => x.n) : null; },
    classement: {
      titre: () => "Où il faut le plus de réseau par client",
      note: () => `Mètres de réseau par point de livraison en ${YEARS.at(-1)}, pour GRDF, R-GDS et Vialis.`,
      ordre: -1, garder: () => true,
      detail: c => { const r = reseauTous(c); return `${pluriel(r.n, "client")} · ${fmt1.format(r.m / 1000)} km`; }, court: v => fmt0.format(v) + " m",
    },
  },
  chauffGaz: {
    label: "Logements au gaz", unite: "%", vide: "Trop peu de logements",
    titre: () => "Part des résidences principales chauffées au gaz de réseau (2022)",
    seuils: [10, 25, 40, 55], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["10", "25", "40", "55"],
    bornes: ["Peu", "Beaucoup"],
    lecture: () => `<b>Plus le bleu est foncé, plus les ménages dépendent du gaz pour se chauffer</b> : c'est le nombre de foyers à accompagner en cas de repli.`,
    valeur: c => pctLog(c, "g"), texte: v => fmt0.format(v) + " % des logements chauffés au gaz",
    agreg: e => { const l = e.communes.map(c => CRE[c]?.log).filter(Boolean), rp = d3.sum(l, x => x.rp); return rp ? 100 * d3.sum(l, x => x.g) / rp : null; },
    classement: {
      titre: () => "Où le plus de logements sont chauffés au gaz",
      note: () => "Combustible principal des résidences principales, recensement 2022 (fichier détail INSEE, estimation pondérée). Communes d'au moins 200 logements.",
      ordre: -1, garder: c => CRE[c].log.rp >= 200,
      detail: c => `${fmt0.format(CRE[c].log.g)} logements au gaz sur ${fmt0.format(CRE[c].log.rp)}`, court: v => fmt0.format(v) + " %",
    },
  },
  difficile: {
    label: "Conversion difficile", unite: "%", vide: "Pas de logement au gaz",
    titre: () => "Part des logements au gaz en appartement avec chaudière individuelle (2022)",
    seuils: [10, 20, 35, 50], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["10", "20", "35", "50"],
    bornes: ["Simple", "Difficile"],
    lecture: () => `<b>Plus le bleu est foncé, plus la conversion est difficile</b> : pour la CRE, la chaudière individuelle en immeuble est le cas le plus complexe, car une pompe à chaleur individuelle y est rarement possible. Les maisons et le chauffage collectif se convertissent plus facilement.`,
    valeur: c => { const l = CRE[c]?.log; return l?.g >= 10 ? 100 * l.gi / l.g : null; }, texte: v => fmt0.format(v) + " % des logements au gaz en chaudière individuelle d'immeuble",
    agreg: e => { const l = e.communes.map(c => CRE[c]?.log).filter(Boolean), g = d3.sum(l, x => x.g); return g ? 100 * d3.sum(l, x => x.gi) / g : null; },
    classement: {
      titre: () => "Où les logements au gaz sont le plus difficiles à convertir",
      note: () => "Appartements au gaz avec chaudière individuelle, rapportés à tous les logements chauffés au gaz (recensement 2022). Communes d'au moins 100 logements au gaz.",
      ordre: -1, garder: c => CRE[c].log.g >= 100,
      detail: c => { const l = CRE[c].log; return `${fmt0.format(l.gm)} maisons · ${fmt0.format(l.gc)} chauffage collectif · ${fmt0.format(l.gi)} chaudières d'immeuble`; }, court: v => fmt0.format(v) + " %",
    },
  },
  proprietaires: {
    label: "Propriétaires", unite: "%", vide: "Trop peu de logements au gaz",
    titre: () => "Part des ménages chauffés au gaz qui sont propriétaires (2022)",
    seuils: [30, 45, 60, 75], couleurs: ["--q5", "--q4", "--q3", "--q2", "--q1"], graduations: ["30", "45", "60", "75"],
    bornes: ["Locataires", "Propriétaires"],
    lecture: () => `<b>Plus le bleu est foncé, plus les ménages au gaz sont locataires</b> : ils ne décident pas seuls de changer de chauffage, et c'est le bailleur qu'il faut convaincre et aider.`,
    valeur: c => { const l = CRE[c]?.log; return l?.g >= 30 ? l.pg : null; }, texte: v => fmt0.format(v) + " % de propriétaires parmi les ménages au gaz",
    agreg: e => { const l = e.communes.map(c => CRE[c]?.log).filter(x => x?.pg != null), g = d3.sum(l, x => x.g); return g ? d3.sum(l, x => x.pg * x.g) / g : null; },
    classement: {
      titre: () => "Où les ménages au gaz sont le plus souvent locataires",
      note: () => "Statut d'occupation des ménages chauffés au gaz de réseau, recensement 2022. Communes d'au moins 100 logements au gaz.",
      ordre: 1, garder: c => CRE[c].log.g >= 100,
      detail: c => `${CRE[c].log.hg} % de logements HLM parmi les logements au gaz`, court: v => fmt0.format(v) + " %",
    },
  },
  revenus: {
    label: "Revenus", unite: "milliers d'€ par an", vide: "Non publié (secret statistique)",
    titre: () => "Revenu médian disponible en 2021",
    seuils: [23000, 25000, 27000, 30000], couleurs: ["--q5", "--q4", "--q3", "--q2", "--q1"], graduations: ["23", "25", "27", "30"],
    bornes: ["Modestes", "Aisés"],
    lecture: () => `<b>Plus le bleu est foncé, plus les revenus sont modestes :</b> ces territoires auront davantage besoin d'aides si le gaz doit être remplacé.`,
    valeur: c => TR.revenus[c]?.[0] ?? null, texte: v => fmt0.format(v) + " € par an (revenu médian)",
    agreg: e => { const l = e.communes.map(c => TR.revenus[c]).filter(Boolean); const n = d3.sum(l, r => r[2]); return n ? d3.sum(l, r => r[0] * r[2]) / n : null; },
    filtre: { label: "Seulement les communes au gaz", garder: (v, c) => gazDistribue(c) },
    classement: {
      titre: () => "Où les revenus sont les plus modestes parmi les communes au gaz",
      note: () => "Revenu médian disponible par unité de consommation en 2021, pour les communes ayant des points de livraison de gaz.",
      ordre: 1, garder: c => gazDistribue(c),
      detail: c => `${pluriel(CONSO[c].n[6], "point")} de livraison de gaz`, court: v => fmt0.format(v) + " €",
    },
  },
};
const CAT_USAGES = [
  { id: 3, label: "3 usages durables", couleur: "--q5", aide: "Biométhane, industrie non substituable et chaleur au gaz : la commune est très peu propice à un repli total." },
  { id: 2, label: "2 usages durables", couleur: "--q4", aide: "Deux usages nécessitent durablement le réseau." },
  { id: 1, label: "1 usage durable", couleur: "--q3", aide: "Un usage nécessite durablement le réseau : un repli total est difficile, un repli partiel reste possible ailleurs dans la commune." },
  { id: 0, label: "Aucun usage durable", couleur: "--q1", aide: "Aucun usage durable repéré : d'autres critères restent à examiner avant de conclure." },
];
const CAT_DENSITE = DENSITES.slice(1).map((l, i) => ({ id: i + 1, label: `${i + 1}. ${l}`, couleur: `--dens${i + 1}`, aide: `Niveau ${i + 1} de la grille de densité de l'INSEE : ${l.toLowerCase()}.` }));
function categoriesCiblage() {
  const n = CRITERES.filter(k => k.actif).length, tons = ["--q1", "--q2", "--q3", "--q4", "--q5"];
  return [...d3.range(n, -1, -1).map(i => ({ id: i, label: `${i} critère${i > 1 ? "s" : ""} sur ${n}`, couleur: tons[n ? Math.round(4 * i / n) : 0],
    aide: `Communes qui remplissent ${i} des ${n} critères favorables cochés.` })),
    ...(ciblage.ecarter ? [{ id: -1, label: "Écartée : usage durable", couleur: "--ecarte", aide: "Un usage durable du gaz (biométhane, industrie non substituable, chaleur au gaz, site raccordé au transport) rend un repli total peu propice." }] : [])];
}
const cats = () => { const k = ind().categories; return typeof k === "function" ? k() : k; };
const catDe = v => cats().find(p => p.id === v) ?? { label: "", couleur: "--nodata", aide: "" };
const ind = () => INDICATEURS[state.mode];
const parEPCI = () => state.echelle === "epci" && !!ind().agreg && !EPCI[state.terr];
function value(c) {
  if (!parEPCI()) return ind().valeur(c);
  const e = EPCI_DE[c];
  if (!cacheEPCI.has(e)) cacheEPCI.set(e, EPCI[e] ? ind().agreg(EPCI[e]) : null);
  return cacheEPCI.get(e);
}
const seuils = () => parEPCI() && ind().seuilsEPCI || ind().seuils;
function colorOf(v) {
  if (v == null) return css("--nodata");
  const s = ind();
  if (s.categories) return css(catDe(v).couleur);
  let i = seuils().findIndex(b => v < b); if (i < 0) i = seuils().length;
  return css(s.couleurs[i]);
}
// commune estompée par le filtre de l'indicateur (valeur connue mais hors critère)
const filtree = c => {
  if (parEPCI()) return false;
  const f = ind().filtre, v = value(c);
  if (ind().categories) return state.cat != null && v !== state.cat;
  return !!(f && state.filtre && v != null && !f.garder(v, c));
};
function valueText(c) { const v = value(c); return v == null ? ind().vide : ind().texte(v); }

/* ---------- carte ---------- */
function drawLegend() {
  const s = ind(), box = document.getElementById("legend");
  if (s.categories) {
    const liste = cats(), n = d3.rollup(communesTerritoire().map(value).filter(v => v != null), v => v.length, v => v);
    box.innerHTML = `<div class="cats">${liste.map((p, i) => `<button data-i="${i}" title="${p.aide}" aria-pressed="${state.cat === p.id}"><i style="background:var(${p.couleur})"></i>${p.label} <b>${n.get(p.id) || 0}</b></button>`).join("")}</div>
      <div class="extra"><span><i style="background:var(--nodata)"></i>${s.vide}</span></div>`;
    box.querySelectorAll(".cats button").forEach(b => b.onclick = () => { const id = liste[+b.dataset.i].id; state.cat = state.cat === id ? null : id; recolor(); });
    return;
  }
  let filtre = "";
  if (s.filtre && state.filtre && !parEPCI()) {
    const n = communesTerritoire().filter(c => { const v = value(c); return v != null && s.filtre.garder(v, c); }).length;
    filtre = `<span><b>${n}</b>&nbsp;communes retenues</span>`;
  }
  const grad = parEPCI() && s.graduationsEPCI || s.graduations, large = s.couleurs.length * 36 - 2;
  box.innerHTML = `<h4>${s.titre()} (${s.unite})${parEPCI() ? " · par EPCI" : ""}</h4>
    <div><div class="bornes" style="width:${large}px"><span>${s.bornes[0]}</span><span>${s.bornes[1]}</span></div>
    <div class="row">${s.couleurs.map(c => `<i class="sw" style="background:var(${c})"></i>`).join("")}</div>
    <div class="ticks">${grad.map(t => `<span>${t}</span>`).join("")}</div></div>
    <div class="extra"><span><i style="background:var(--nodata)"></i>${s.vide}</span>${filtre}</div>`;
}
function majControles() {
  const s = ind(), theme = THEMES.find(t => t.id === state.theme);
  document.getElementById("ctlYear").hidden = !s.annee;
  document.getElementById("ctlSect").hidden = !s.secteurs;
  document.getElementById("ctlEchelle").hidden = !s.agreg || !!EPCI[state.terr];
  const mode = document.getElementById("segMode");
  mode.hidden = theme.modes.length < 2;
  const cf = document.getElementById("ctlFiltre");
  cf.hidden = !(s.filtre || state.mode === "ciblage") || parEPCI();
  if (state.mode === "ciblage") panneauCriteres(cf);
  else if (!cf.hidden) {
    cf.innerHTML = `<label class="switch"><input type="checkbox" id="filtre" ${state.filtre ? "checked" : ""}> ${s.filtre.label}</label>`;
    cf.querySelector("input").onchange = e => { state.filtre = e.target.checked; recolor(); };
  }
  document.getElementById("options").hidden = mode.hidden && !s.annee && !s.secteurs && cf.hidden;
}
// cases de la grille de ciblage : critère d'exclusion puis critères favorables
let criteresOuverts = false;
function panneauCriteres(box) {
  box.innerHTML = `<details class="criteres" ${criteresOuverts ? "open" : ""}><summary>Critères de la grille</summary>
    <label class="switch exclu"><input type="checkbox" data-k="ecarter" ${ciblage.ecarter ? "checked" : ""}> Écarter les communes avec un usage durable du gaz <small>biométhane, industrie non substituable, chaleur au gaz (critères CRE), site raccordé au transport</small></label>
    <div class="liste">${CRITERES.map(k => `<label class="switch"><input type="checkbox" data-k="${k.id}" ${k.actif ? "checked" : ""}> ${k.label} <small>${k.aide}</small></label>`).join("")}</div>
  </details>`;
  box.querySelector("details").ontoggle = e => { criteresOuverts = e.target.open; };
  box.querySelectorAll("input").forEach(i => i.onchange = () => {
    if (i.dataset.k === "ecarter") ciblage.ecarter = i.checked; else CRITERES.find(k => k.id === i.dataset.k).actif = i.checked;
    state.cat = null; recolor();
  });
}
function recolor() {
  cacheEPCI = new Map();
  const epci = parEPCI();
  paths.classed("hors", d => !dansTerritoire(d.code))
    .attr("fill", d => !dansTerritoire(d.code) ? css("--hors") : filtree(d.code) ? css("--nodata") : colorOf(value(d.code)))
    .attr("fill-opacity", d => dansTerritoire(d.code) && filtree(d.code) ? .35 : null)
    // à l'échelle EPCI, les limites communales s'effacent au profit de celles des EPCI
    .style("stroke", d => epci && dansTerritoire(d.code) ? colorOf(value(d.code)) : null);
  d3.select("#limitesEPCI").attr("visibility", epci ? "visible" : "hidden");
  drawLegend(); renderRank(); renderSites(); majSurcouches(); majControles(); drawCouches();
  document.getElementById("lecture").innerHTML = ind().lecture();
}
function drawCouches() {
  const cv = document.getElementById("netCanvas"), box = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = box.width * dpr; cv.height = box.height * dpr;
  const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height);
  // même matrice que le groupe SVG (viewBox + zoom), ramenée au repère du canevas
  const m = gMap.node().getScreenCTM();
  ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * (m.e - box.left), dpr * (m.f - box.top));
  ctx.lineJoin = ctx.lineCap = "round";
  if (buildMap.clip) ctx.clip(buildMap.clip);
  for (const l of COUCHES) {
    if (!l.actif || !l.path) continue;
    ctx.strokeStyle = css(l.couleur); ctx.lineWidth = l.epaisseur * Math.min(1.8, .75 + transform.k * .1) / m.a;
    ctx.stroke(l.path);
  }
}

function buildMap(geo) {
  // repère interne fixe : le SVG s'adapte au cadre via viewBox, le canevas suit via getScreenCTM
  const W = 800, H = 1000;
  const feats = Object.entries(geo.c).map(([code, rings]) => ({ type: "Feature", code,
    geometry: { type: "Polygon", coordinates: rings.map(r => decode(r, geo.q)) } }));
  proj = d3.geoIdentity().reflectY(true).fitExtent([[20, 20], [W - 20, H - 20]], { type: "FeatureCollection", features: feats });
  const gp = d3.geoPath(proj);
  const svg = d3.select("#map").attr("viewBox", `0 0 ${W} ${H}`);
  gMap = svg.append("g");
  // polygones multi-parties : regroupés par code
  const byCode = d3.group(feats, f => f.code);
  const data = [...byCode].map(([code, fs]) => ({ code, d: fs.map(f => gp(f)).join("") }));
  paths = gMap.selectAll("path.commune").data(data).join("path").attr("class", "commune").attr("d", d => d.d)
    .on("mousemove", (ev, d) => showTip(ev, d.code)).on("mouseleave", hideTip)
    .on("click", (ev, d) => parEPCI() ? choisirTerritoire(EPCI_DE[d.code]) : select(d.code));
  gMap.append("path").attr("class", "deps").attr("d", frontiere(feats, gp, f => META[f.code]?.[1]));
  gMap.append("path").attr("class", "limites-epci").attr("id", "limitesEPCI").attr("d", frontiere(feats, gp, f => EPCI_DE[f.code])).attr("visibility", "hidden");
  gMap.append("path").attr("class", "contour").attr("id", "contour");
  gMap.append("path").attr("class", "selpath").attr("id", "selpath");
  zoom = d3.zoom().scaleExtent([1, 24]).translateExtent([[0, 0], [W, H]]).on("zoom", ev => { transform = ev.transform; gMap.attr("transform", transform); majEchelle(); drawCouches(); });
  svg.call(zoom).on("dblclick.zoom", null);
  d3.select("#zin").on("click", () => svg.transition().call(zoom.scaleBy, 1.8));
  d3.select("#zout").on("click", () => svg.transition().call(zoom.scaleBy, 1 / 1.8));
  d3.select("#zreset").on("click", vueTerritoire);
  Object.assign(buildMap, { gp, byCode, svg, W, H, feats, data, alsace: contour(feats, gp) });
}
const cleSegment = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a + "|" + b : b + "|" + a;
// contour d'un ensemble de communes : arêtes qui n'appartiennent qu'à une seule d'entre elles
function contour(feats, gp) {
  const seen = new Map();
  for (const f of feats) for (const r of f.geometry.coordinates) for (let i = 1; i < r.length; i++) {
    const k = cleSegment(r[i - 1], r[i]), s = seen.get(k);
    if (s) s.n++; else seen.set(k, { n: 1, seg: [r[i - 1], r[i]] });
  }
  return gp({ type: "MultiLineString", coordinates: [...seen.values()].filter(s => s.n === 1).map(s => s.seg) });
}
// limite entre groupes de communes : arêtes partagées par deux groupes différents
function frontiere(feats, gp, groupe) {
  const seen = new Map();
  for (const f of feats) {
    const g = groupe(f);
    for (const r of f.geometry.coordinates) for (let i = 1; i < r.length; i++) {
      const k = cleSegment(r[i - 1], r[i]), s = seen.get(k);
      if (!s) seen.set(k, { g, seg: [r[i - 1], r[i]] }); else if (s.g !== g) s.both = true;
    }
  }
  return gp({ type: "MultiLineString", coordinates: [...seen.values()].filter(s => s.both).map(s => s.seg) });
}
const duree = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 750;
// recadre la carte sur le territoire choisi
function vueTerritoire() {
  let t = d3.zoomIdentity;
  if (state.terr !== "alsace") {
    const { W, H } = buildMap, b = buildMap.gp.bounds({ type: "FeatureCollection", features: buildMap.feats.filter(f => dansTerritoire(f.code)) });
    const k = Math.min(10, .94 / Math.max((b[1][0] - b[0][0]) / W, (b[1][1] - b[0][1]) / H));
    t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2);
  }
  buildMap.svg.transition().duration(duree()).call(zoom.transform, t);
}
function majContour() {
  const tout = state.terr === "alsace";
  d3.select("#contour").attr("d", tout ? null : contour(buildMap.feats.filter(f => dansTerritoire(f.code)), buildMap.gp));
  buildMap.clip = null;
  if (!tout) {
    buildMap.clip = new Path2D();
    buildMap.data.filter(d => dansTerritoire(d.code)).forEach(d => buildMap.clip.addPath(new Path2D(d.d)));
  }
}

/* ---------- biométhane et réseaux de chaleur ---------- */
const textesReseau = r => [
  r.km ? fmt1.format(r.km) + " km" : "", r.pdl != null ? pluriel(r.pdl, "client") : "",
  r.enr != null ? `${fmt0.format(r.enr)} % d'énergies renouvelables` : "", r.gaz != null ? `${fmt0.format(r.gaz)} % de gaz` : "",
].filter(Boolean).join(" · ") || "Caractéristiques non renseignées";
const avisReseau = r => surtoutGaz(r) ? "Dépend du gaz : ne le remplace pas en l'état" : clientUnique(r) ? "Réseau dédié à un site" : "Solution de remplacement possible";
const tipReseau = r => `<b>${r.nom}</b>${avisReseau(r)}<br><span class="m">${textesReseau(r)}</span>`;
const tipSite = s => `<b>${s.nom}</b>${META[s.c][0]} · ${gwh(s.mwh)} injectés en ${s.annee}<br><span class="m">${ancrageSite(s).texte}<br>${fmt0.format(s.cap)} Nm³/h · en service depuis ${s.date}</span>`;
const NAF_LIBELLES = { "20": "chimie", "23": "verre et minéraux non métalliques", "24": "métallurgie" };
const premiereCommune = codes => codes.find(dansTerritoire) ?? codes[0];
function buildTransition() {
  const { q, reseaux, zones, projets } = TR.chaleur, gp = buildMap.gp;
  const anneaux = (l, qq) => gp({ type: "Polygon", coordinates: l.map(x => decode(x, qq)) });
  const lignes = l => gp({ type: "MultiLineString", coordinates: l.map(x => decode(x, q)) });
  const surface = l => gp({ type: "Polygon", coordinates: l.map(x => decode(x, q)) });
  // zones sous le réseau GRDF ; traits et marques au-dessus, dans un second SVG aligné sur le premier
  const dessous = gMap.insert("g", "#contour").attr("class", "zones");
  buildMap.zonages = gMap.insert("g", "#contour").attr("class", "zonages").selectAll("path").data(CREG.zonages).join("path")
    .attr("class", "zonage").attr("d", d => anneaux(d.l, CREG.q));
  buildMap.zones = dessous.selectAll("path").data([...zones, ...projets.filter(p => p.zone)]).join("path")
    .attr("class", d => d.zone ? "zone projet" : "zone").attr("d", d => surface(d.l));

  const top = d3.select("#mapTop").attr("viewBox", `0 0 ${buildMap.W} ${buildMap.H}`);
  buildMap.gTop = top.append("g");
  const traces = [...reseaux.filter(r => r.l), ...projets.filter(p => !p.zone).map(p => ({ ...p, projet: true }))];
  buildMap.traits = buildMap.gTop.selectAll("g.trace").data(traces).join("g")
    .attr("class", d => "trace" + (d.projet ? " projet" : chaleurUtile(d) ? "" : " limite"));
  buildMap.traits.each(function (d) {
    const g = d3.select(this), chemin = lignes(d.l);
    g.append("path").attr("class", "ch-case").attr("d", chemin);
    g.append("path").attr("class", "ch-trait").attr("d", chemin);
    g.append("path").attr("class", "ch-hit").attr("d", chemin);
  });
  const texteTrace = d => d.projet ? `<b>Projet de réseau de chaleur</b>${d.gest || "Gestionnaire non renseigné"}<br><span class="m">Mise en service prévue : ${d.date || "non renseignée"}</span>` : tipReseau(d);
  buildMap.traits.selectAll(".ch-hit")
    .on("mousemove", function (ev) { placerTip(ev, texteTrace(d3.select(this.parentNode).datum())); }).on("mouseleave", hideTip)
    .on("click", function () { select(premiereCommune(d3.select(this.parentNode).datum().c), true); });

  const position = (d, x, y) => { [d.px, d.py] = proj([x, y]); return d; };
  buildMap.points = buildMap.gTop.selectAll("g.pt-chaleur").data(reseaux.filter(r => r.pt).map(r => position(r, ...r.pt))).join("g")
    .attr("class", d => "marque pt-chaleur" + (chaleurUtile(d) ? "" : " limite"));
  buildMap.points.append("rect").attr("x", -4).attr("y", -4).attr("width", 8).attr("height", 8).attr("rx", 1.5);
  const taille = s => 6 + 8 * Math.sqrt(s.mwh / d3.max(TR.biomethane, x => x.mwh));
  buildMap.sites = buildMap.gTop.selectAll("g.site").data(TR.biomethane.map(s => position(s, s.x, s.y))).join("g")
    .attr("class", "marque site");
  buildMap.sites.append("path").attr("d", d => { const r = taille(d); return `M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z`; });
  // sites du registre hors GRDF : pas de volume injecté publié, placés au centre de leur commune
  buildMap.injection = buildMap.gTop.selectAll("g.injection").data(CREG.injection.map(s => position(s, s.x, s.y))).join("g").attr("class", "marque site injection");
  buildMap.injection.append("path").attr("d", d => { const r = 6 + 8 * Math.sqrt(d.gwh * 1000 / d3.max(TR.biomethane, x => x.mwh)); return `M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z`; });
  const triangle = r => `M0 ${-r}L${r * .9} ${r * .6}L${-r * .9} ${r * .6}Z`;
  buildMap.industries = buildMap.gTop.selectAll("g.industrie").data(CREG.industries.map(s => position(s, s.x, s.y))).join("g").attr("class", "marque industrie");
  buildMap.industries.append("path").attr("d", triangle(6));
  buildMap.rebours = buildMap.gTop.selectAll("g.rebours").data(CREG.rebours.map(s => position(s, s.x, s.y))).join("g").attr("class", "marque rebours");
  buildMap.rebours.append("path").attr("d", triangle(9));
  const tipIndustrie = s => `<b>${s.nom}</b>${META[s.c]?.[0] ?? ""} · NAF ${s.naf} ${NAF_LIBELLES[s.naf.slice(0, 2)]}<br><span class="m">Établissement actif (SIRENE). Sa consommation de gaz n'est pas publiée à l'établissement.</span>`;
  const tipInjection = s => `<b>${s.nom}</b>${META[s.c]?.[0] ?? ""} · raccordé à ${s.grd} · capacité ${fmt1.format(s.gwh)} GWh par an<br><span class="m">Registre des sites d'injection, en service depuis ${s.date}. Volume injecté non publié ; position : centre de la commune.</span>`;
  const tipRebours = s => `<b>Rebours : ${s.nom}</b>${META[s.c]?.[0] ?? ""} · ${s.cap} GWh par an<br><span class="m">Renvoie vers le transport le biométhane que la distribution ne peut absorber. ${s.statut}, mise en service prévue ${s.mes}.</span>`;
  for (const [sel, texte, commune] of [[buildMap.points, tipReseau, d => premiereCommune(d.c)], [buildMap.sites, tipSite, d => d.c], [buildMap.industries, tipIndustrie, d => d.c], [buildMap.rebours, tipRebours, d => d.c], [buildMap.injection, tipInjection, d => d.c]])
    sel.on("mousemove", (ev, d) => placerTip(ev, texte(d))).on("mouseleave", hideTip).on("click", (ev, d) => select(commune(d), true));
  majEchelle();
}
function majEchelle() {
  buildMap.gTop?.attr("transform", transform);
  // les marques gardent la même taille à l'écran quel que soit le zoom
  for (const m of [buildMap.points, buildMap.sites, buildMap.industries, buildMap.rebours, buildMap.injection]) m?.attr("transform", d => `translate(${d.px},${d.py}) scale(${1 / transform.k})`);
}
function majSurcouches() {
  const visible = d => couche("chaleur") && d.c.some(dansTerritoire) ? null : "none";
  buildMap.sites.attr("display", d => couche("biomethane") && dansTerritoire(d.c) ? null : "none")
    .classed("local", d => !ancrageSite(d).fort);
  buildMap.traits.attr("display", visible);
  buildMap.points.attr("display", visible);
  buildMap.zones.attr("display", visible);
  buildMap.injection.attr("display", d => couche("biomethane") && dansTerritoire(d.c) ? null : "none");
  buildMap.industries.attr("display", d => couche("industrie") && dansTerritoire(d.c) ? null : "none");
  buildMap.rebours.attr("display", d => couche("industrie") || couche("biomethane") ? null : "none");
  buildMap.zonages.attr("display", couche("zonages") ? null : "none");
}
function lignesEnChemin(data) {
  const path = new Path2D();
  for (const l of data.l) { const p = decode(l, data.q).map(pt => proj(pt)); path.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) path.lineTo(p[i][0], p[i][1]); }
  return path;
}

const tip = document.getElementById("tip");
function showTip(ev, c) {
  const epci = parEPCI();
  paths.classed("hover", d => epci ? EPCI_DE[d.code] === EPCI_DE[c] : d.code === c);
  if (epci) { placerTip(ev, `<b>${EPCI[EPCI_DE[c]]?.nom ?? ""}</b>${valueText(c)}<br><span class="m">Cliquer pour voir cet EPCI</span>`); return; }
  const m = META[c], note = ind().note?.(c), motif = ind().motif?.(c) || "";
  placerTip(ev, `<b>${m[0]}</b>${valueText(c)}${filtree(c) ? " · hors filtre" : ""}${note ? `<br><span class="m">${note}</span>` : ""}${motif ? `<br><span class="m">${motif}</span>` : ""}`);
}
function placerTip(ev, html) {
  const box = document.getElementById("mapbox").getBoundingClientRect();
  tip.innerHTML = html;
  tip.hidden = false;
  let x = ev.clientX - box.left + 14, y = ev.clientY - box.top + 14;
  if (x + 260 > box.width) x -= 280; if (y + 90 > box.height) y -= 100;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function hideTip() { tip.hidden = true; paths.classed("hover", false); }

function select(c, zoomTo) {
  state.sel = c;
  const sp = d3.select("#selpath");
  if (!c) { sp.attr("d", null); renderTerritoire(); return; }
  const d = paths.data().find(p => p.code === c); sp.attr("d", d ? d.d : null);
  if (zoomTo && d) {
    const fs = buildMap.byCode.get(c); const b = buildMap.gp.bounds({ type: "FeatureCollection", features: fs });
    const k = Math.min(8, .22 / Math.max((b[1][0] - b[0][0]) / buildMap.W, (b[1][1] - b[0][1]) / buildMap.H));
    const t = d3.zoomIdentity.translate(buildMap.W / 2, buildMap.H / 2).scale(k).translate(-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2);
    buildMap.svg.transition().duration(duree()).call(zoom.transform, t);
  }
  renderCommune(c);
}

/* ---------- graphiques ---------- */
function stackChart(series, opts = {}) {
  // series : {R:[..7], T, I, A} en MWh ; barres empilées si opts.bars, aires sinon
  const W = 400, H = 200, m = { t: 10, r: 8, b: 22, l: 44 };
  const rows = YEARS.map((y, i) => ({ y, i, ...Object.fromEntries(SKEYS.map(k => [k, series[k][i] || 0])) }));
  const st = d3.stack().keys(SKEYS)(rows);
  const max = d3.max(rows, r => d3.sum(SKEYS, k => r[k])) || 1;
  const div = max >= 100000 ? 1000 : 1, unit = div === 1000 ? "GWh" : "MWh";
  const x = opts.bars ? d3.scaleBand(YEARS, [m.l, W - m.r]).padding(.28) : d3.scalePoint(YEARS, [m.l + 10, W - m.r - 10]);
  const y = d3.scaleLinear([0, max / div], [H - m.b, m.t]).nice();
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", opts.label || "");
  const g = svg.append("g");
  y.ticks(4).forEach(t => {
    g.append("line").attr("class", t === 0 ? "base" : "grid").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(t)).attr("y2", y(t));
    g.append("text").attr("x", m.l - 6).attr("y", y(t) + 4).attr("text-anchor", "end").text(fmt0.format(t));
  });
  g.append("text").attr("x", 0).attr("y", m.t).attr("dy", -2).text(unit);
  YEARS.forEach(yr => g.append("text").attr("x", (x(yr) + (opts.bars ? x.bandwidth() / 2 : 0))).attr("y", H - 6).attr("text-anchor", "middle").text(yr));
  const inc = new Set(opts.incomplete || []);
  if (opts.bars) {
    const bw = x.bandwidth();
    st.forEach(layer => layer.forEach((p, i) => {
      const h = y(p[0] / div) - y(p[1] / div); if (h <= 0) return;
      g.append("rect").attr("x", x(YEARS[i])).attr("y", y(p[1] / div)).attr("width", bw).attr("height", Math.max(0, h - (p[1] > p[0] ? 1 : 0)))
        .attr("fill", css("--s-" + layer.key)).attr("opacity", inc.has(i) ? .35 : 1).attr("rx", 1.5);
    }));
    inc.forEach(i => g.append("text").attr("x", x(YEARS[i]) + bw / 2).attr("y", m.t + 8).attr("text-anchor", "middle").text("incompl."));
  } else {
    const area = d3.area().x((d, i) => x(YEARS[i])).y0(d => y(d[0] / div)).y1(d => y(d[1] / div)).curve(d3.curveMonotoneX);
    st.forEach(layer => g.append("path").attr("d", area(layer)).attr("fill", css("--s-" + layer.key)).attr("stroke", css("--surface")).attr("stroke-width", 2));
  }
  const centres = YEARS.map(yr => x(yr) + (opts.bars ? x.bandwidth() / 2 : 0));
  survol(svg, g, centres, W, H, m, i => {
    const r = rows[i], tot = d3.sum(SKEYS, k => r[k]);
    return `<b>${YEARS[i]}${inc.has(i) ? " · données incomplètes" : ""}</b>` + SKEYS.filter(k => r[k] > 0).map(k => ligneTip(`<i class="dot" style="background:var(--s-${k})"></i> ${SECT[k]}`, gwh(r[k]))).join("") + ligneTip("Total", gwh(tot));
  });
  return svg.node();
}
const ligneTip = (a, b) => `<span style="display:flex;gap:8px;justify-content:space-between"><span>${a}</span><span class="num">${b}</span></span>`;
// réticule et bulle de survol, communs aux graphiques
function survol(svg, g, centres, W, H, m, texte) {
  const hl = g.append("line").attr("class", "base").attr("y1", m.t).attr("y2", H - m.b).attr("opacity", 0);
  const node = svg.node();
  svg.append("rect").attr("x", m.l).attr("y", 0).attr("width", W - m.l - m.r).attr("height", H).attr("fill", "transparent")
    .on("mousemove", ev => {
      const [px] = d3.pointer(ev), i = d3.leastIndex(centres, c => Math.abs(c - px)), host = node.closest(".tip-host");
      if (tip2.parentNode !== host) host.append(tip2);
      hl.attr("x1", centres[i]).attr("x2", centres[i]).attr("opacity", 1);
      tip2.innerHTML = texte(i); tip2.hidden = false;
      const b = node.getBoundingClientRect(), pb = host.getBoundingClientRect();
      let left = b.left - pb.left + host.scrollLeft + centres[i] / W * b.width + 12; if (left + 200 > pb.width) left -= 224;
      tip2.style.left = left + "px"; tip2.style.top = (b.top - pb.top + host.scrollTop + 8) + "px";
    }).on("mouseleave", () => { hl.attr("opacity", 0); tip2.hidden = true; });
}
const tip2 = Object.assign(document.createElement("div"), { className: "tip", hidden: true }); tip2.style.minWidth = "190px";
const keyRow = () => `<div class="keyrow">${SKEYS.map(k => `<span><i class="dot" style="background:var(--s-${k})"></i>${SECT[k]}</span>`).join("")}</div>`;
// gaz et électricité des logements en indice, base 100 en 2019-21 : une seule échelle pour deux énergies
function courbesEnergies(gaz, elec, label) {
  const W = 400, H = 170, m = { t: 12, r: 74, b: 22, l: 34 };
  const base = a => mean(a, P1), ig = gaz.map(v => v == null ? null : 100 * v / base(gaz)), ie = elec.map(v => v == null ? null : 100 * v / base(elec));
  const vals = [...ig, ...ie].filter(v => v != null);
  const x = d3.scalePoint(YEARS, [m.l + 6, W - m.r]);
  const y = d3.scaleLinear([Math.min(70, d3.min(vals)), Math.max(110, d3.max(vals))], [H - m.b, m.t]).nice();
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", label);
  const g = svg.append("g");
  y.ticks(4).forEach(t => {
    g.append("line").attr("class", t === 100 ? "base" : "grid").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(t)).attr("y2", y(t));
    g.append("text").attr("x", m.l - 6).attr("y", y(t) + 4).attr("text-anchor", "end").text(fmt0.format(t));
  });
  YEARS.forEach(yr => g.append("text").attr("x", x(yr)).attr("y", H - 6).attr("text-anchor", "middle").text(yr));
  const ligne = d3.line().defined(v => v != null).x((v, i) => x(YEARS[i])).y(v => y(v));
  const etiquettes = [];
  for (const [serie, couleur, nom] of [[ig, "--gaz", "Gaz"], [ie, "--elec", "Électricité"]]) {
    g.append("path").attr("d", ligne(serie)).attr("fill", "none").attr("stroke", css(couleur)).attr("stroke-width", 2.2);
    serie.forEach((v, i) => { if (v != null) g.append("circle").attr("cx", x(YEARS[i])).attr("cy", y(v)).attr("r", 2.6).attr("fill", css(couleur)); });
    const i = serie.findLastIndex(v => v != null);
    if (i >= 0) etiquettes.push({ nom, py: y(serie[i]), px: x(YEARS[i]) });
  }
  if (etiquettes.length === 2 && Math.abs(etiquettes[0].py - etiquettes[1].py) < 13) { const milieu = (etiquettes[0].py + etiquettes[1].py) / 2, s = etiquettes[0].py < etiquettes[1].py ? -1 : 1; etiquettes[0].py = milieu + 7 * s; etiquettes[1].py = milieu - 7 * s; }
  etiquettes.forEach(e => g.append("text").attr("x", e.px + 7).attr("y", e.py + 4).text(e.nom));
  survol(svg, g, YEARS.map(yr => x(yr)), W, H, m, i => `<b>${YEARS[i]}</b>` + ligneTip("Gaz", ig[i] == null ? "–" : fmt0.format(ig[i])) + ligneTip("Électricité", ie[i] == null ? "non comparable" : fmt0.format(ie[i])));
  return svg.node();
}
// séries des communes comparables toutes les années, pour un territoire
function seriesTerritoire(codes) {
  const l = codes.filter(c => CONSO[c]?.s && CONSO[c].e?.R != null && CONSO[c].s.R.every(v => v != null) && EL[c]?.r.every(v => v != null));
  return { n: l.length, gaz: YEARS.map((y, i) => d3.sum(l, c => CONSO[c].s.R[i])), elec: YEARS.map((y, i) => d3.sum(l, c => EL[c].r[i])) };
}

/* ---------- pour décider : les trois questions, pour une commune ou un territoire ---------- */
function decisionCommune(c) {
  const sites = TR.biomethane.filter(s => s.c === c), h = chaleurDe(c), rev = TR.revenus[c], g = GE[c];
  const transport = CONSO[c]?.t?.[6], naf = usagesCRE(c).some(u => u.id === "industrie") ? CRE[c].naf : null, l = CRE[c]?.log;
  const ancrage = [
    ...sites.map(s => `Biométhane : <b>${s.nom}</b>, ${gwh(s.mwh)} injectés en ${s.annee}. ${ancrageSite(s).texte}.`),
    ...CREG.injection.filter(s => s.c === c).map(s => `Biométhane : <b>${s.nom}</b>, raccordé à ${s.grd}, capacité ${fmt1.format(s.gwh)} GWh par an (volume injecté non publié).`),
    ...CREG.rebours.filter(r => r.c === c).map(r => `Rebours vers le transport : <b>${r.nom}</b>, ${r.cap} GWh par an, mise en service prévue ${r.mes}.`),
    ...(naf ? [`Industrie au gaz non substituable (chimie, verre, métallurgie) : <b>${naf[0] ? gwh(naf[0]) : "volume secret"}</b> par an, ${pluriel(naf[1], "point")} de livraison.`] : []),
    ...h.reseaux.filter(r => r.gaz > 0).map(r => `Réseau de chaleur qui consomme du gaz : <b>${r.nom}</b> (${fmt0.format(r.gaz)} % de sa production)${surtoutGaz(r) ? "" : ", en appoint"}.`),
    ...(transport > 0 ? [`Site raccordé au réseau de transport : ${gwh(transport)} en 2025.`] : []),
  ];
  const substitution = [
    ...h.reseaux.filter(chaleurUtile).map(r => `Chaleur : <b>${r.nom}</b>, ${textesReseau(r)}.`),
    ...(h.zone ? ["Zone de développement prioritaire d'un réseau de chaleur."] : []),
    ...h.projets.map(p => `Projet de réseau de chaleur${p.gest ? " (" + p.gest + ")" : ""}, mise en service prévue : ${p.date || "non renseignée"}.`),
    ...(g ? [`Dans les logements, gaz ${evo(g.gaz)} et électricité ${evo(g.elec)} : ${reportVisible(g) ? "<b>report possible vers l'électricité</b>" : "pas de report visible vers l'électricité"}.`] : []),
    ...(l?.g >= 10 ? [`Logements au gaz : ${fmt0.format(l.gm)} maisons, ${fmt0.format(l.gc)} appartements en chauffage collectif, <b>${fmt0.format(l.gi)} appartements avec chaudière individuelle</b>, le cas le plus difficile à convertir.`] : []),
  ];
  let accompagnement = ["Revenu non publié (secret statistique)."];
  if (rev) {
    const repere = d3.median(communesTerritoire(), x => TR.revenus[x]?.[0]), ecart = 100 * (rev[0] / repere - 1);
    accompagnement = [`Revenu médian de <b>${fmt0.format(rev[0])} € par an</b>, ${stable(ecart, fmt0) ? "au niveau de" : `${fmt0.format(Math.abs(ecart))} % ${ecart < 0 ? "sous" : "au-dessus de"}`} la commune médiane du territoire.`
      + (rev[1] ? ` Les 10 % les plus modestes vivent avec moins de ${fmt0.format(rev[1])} €.` : "") + (rev[0] < REVENU_MODESTE ? " <b>Aides à prévoir en priorité.</b>" : "")];
  }
  if (l?.pg != null && l.g >= 30) accompagnement.push(`${l.pg} % des ménages chauffés au gaz sont propriétaires, ${l.hg} % sont en HLM.`);
  return { ancrage, substitution, accompagnement };
}
function decisionTerritoire() {
  const A = terr().serie(), codes = communesTerritoire(), cmp = comparaison(codes);
  const autresSites = CREG.injection.filter(s => dansTerritoire(s.c));
  const sites = TR.biomethane.filter(s => dansTerritoire(s.c)), injecte = d3.sum(sites, s => s.mwh), distribue = d3.sum(SKEYS, k => A[k][6]);
  const reseaux = TR.chaleur.reseaux.filter(r => r.c.some(dansTerritoire)), projets = TR.chaleur.projets.filter(p => p.c.some(dansTerritoire)).length;
  const modestes = codes.filter(c => gazDistribue(c) && TR.revenus[c]?.[0] < REVENU_MODESTE);
  return {
    ancrage: [
      sites.length ? `${pluriel(sites.length, "site")} de biométhane sur le réseau GRDF, ${gwh(injecte)} injectés en 2025, soit ${fmt1.format(100 * injecte / distribue)} % du gaz distribué.` : "Aucun site de biométhane sur le réseau GRDF.",
      ...(autresSites.length ? [`${pluriel(autresSites.length, "autre site")} raccordé${autresSites.length > 1 ? "s" : ""} à R-GDS, Gaz de Barr, Caléo ou au transport, ${fmt0.format(d3.sum(autresSites, s => s.gwh))} GWh par an de capacité.`] : []),
      `${pluriel(codes.filter(c => gazDistribue(c) && usagesCRE(c).length).length, "commune")} au gaz avec au moins un usage durable selon les critères de la CRE.`,
    ],
    substitution: [
      `${reseaux.filter(chaleurUtile).length} réseaux de chaleur utilisables sur ${reseaux.length}, et ${pluriel(projets, "projet")}.`,
      ...(cmp ? [`Dans les logements, gaz ${evo(cmp.gaz)} et électricité ${evo(cmp.elec)} sur ${pluriel(cmp.n, "commune")} comparables : ${cmp.elec < 0 ? "pas de report d'ensemble visible" : "report possible"}, ${cmp.reports} ${cmp.reports > 1 ? "communes montrent" : "commune montre"} un report.`] : []),
    ],
    accompagnement: [`${pluriel(modestes.length, "commune")} au gaz sous ${fmt0.format(REVENU_MODESTE)} € de revenu médian, avec ${pluriel(d3.sum(modestes, c => CONSO[c].n[6]), "point")} de livraison.`],
  };
}
const VIDES = { ancrage: "Aucun site de biométhane ni chaleur au gaz recensé ici.", substitution: "Aucune solution recensée ici dans ces données.", accompagnement: "" };
const TITRES = { ancrage: "Ancrage", substitution: "Substitution", accompagnement: "Accompagnement" };
function blocDecision(d, court) {
  return `<div class="decide">${Object.keys(TITRES).map(k => {
    const l = court ? d[k].slice(0, 1) : d[k];
    return `<div class="item"><b>${TITRES[k]}</b>${l.length ? l.map(x => `<p>${x}</p>`).join("") : `<p class="rien">${VIDES[k]}</p>`}</div>`;
  }).join("")}</div>`;
}
const badgeProfil = c => { const p = PROFIL[c]; if (!p) return ""; const d = profilDe(p.id); return `<div class="badge"><i style="background:var(${d.couleur})"></i>${d.label}</div>`; };

/* ---------- grille de la CRE : les six critères de l'annexe « Analyses locales », pour une commune ---------- */
const majuscule = t => t ? t[0].toUpperCase() + t.slice(1) + (t.endsWith(".") ? "" : ".") : t;
const etat = (v, oui, non) => v == null ? `<span class="etat inconnu">non publié</span>` : v ? `<span class="etat oui">${oui}</span>` : `<span class="etat non">${non}</span>`;
function grilleCRE(c) {
  const e = CRE[c] || {}, u = usagesCRE(c), a = id => u.find(x => x.id === id), z = CREG.zonages[e.z], r = reseauTous(c), l = e.log;
  const sirene = CREG.industries.filter(s => s.c === c);
  const zonage = z ? ` Zonage biométhane ${z.nom ? "de " + z.nom : "sans nom"} : ${z.projets_txt && z.projets_txt !== "None" ? z.projets_txt + " projets en file d'attente" : "projets non publiés"}${z.attente ? `, ${fmt0.format(z.attente)} Nm³/h demandés` : ""}.` : "";
  const km = e.km ? Object.entries(e.km).map(([g, v]) => `${g} ${fmt1.format(v)} km`).join(", ") : "";
  return [
    ["Usages durables", "Production de biométhane", etat(!!a("biomethane"), "oui", "non"), majuscule(a("biomethane")?.texte ?? "Aucun site en service ni rebours dans la commune.") + zonage],
    ["", "Industrie non substituable", etat(!!a("industrie"), "oui", "non"), majuscule(a("industrie")?.texte ?? (CRE[c]?.naf ? `Chimie, verre ou métallurgie : ${gwh(CRE[c].naf[0])} par an seulement, sous le repère de ${fmt0.format(INDUSTRIE_MIN / 1000)} GWh.` : "Aucun gaz consommé en chimie, verre ou métallurgie (2023-2025).")) + (sirene.length ? ` Établissements repérés : ${sirene.map(s => s.nom).join(", ")}.` : "")],
    ["", "Réseau de chaleur au gaz", etat(!!a("chaleur"), "oui", "non"), majuscule(a("chaleur")?.texte ?? "Aucun réseau de chaleur consommant du gaz.")],
    ["Configuration", "Position sur le réseau", etat(null), `${km ? "Réseau publié : " + km + (e.mp ? `, dont ${fmt1.format(e.mp)} km en moyenne pression` : "") + "." : "Tracé non publié par le gestionnaire (" + (CONSO[c]?.o?.join(", ") || "aucun") + ")."}${r ? ` ${fmt2.format(r.mwh / r.m)} MWh par mètre, ${fmt0.format(r.m / Math.max(1, r.n))} m par client.` : ""} Réseau de structure ou de desserte, bouts d'antenne : à demander au gestionnaire.`],
    ["Substitution", "Énergie de remplacement", etat(substitutionPossible(c) || (l?.g >= 10 && 100 * l.gm / l.g >= MAISONS_MAJORITE), "favorable", "à étudier"), `${substitutionPossible(c) ? "Réseau de chaleur utilisable, zone ou projet. " : ""}${l?.g ? `${fmt0.format(l.g)} logements chauffés au gaz sur ${fmt0.format(l.rp)} : ${fmt0.format(100 * l.gm / l.g)} % de maisons, ${fmt0.format(100 * l.gc / l.g)} % en chauffage collectif, ${fmt0.format(100 * l.gi / l.g)} % en chaudière individuelle d'immeuble.` : "Pas de logement chauffé au gaz recensé."} Capacité du réseau électrique : non publiée.`],
    ["Économie locale", "Recettes, charges, actifs", etat(null), "Taux de couverture des charges par les recettes d'acheminement et valeur nette des actifs : à demander au concessionnaire (compte rendu annuel d'activité de concession, inventaire)."],
  ];
}
function tableGrille(lignes) {
  return `<div class="tablewrap"><table class="grille"><thead><tr><th>Axe</th><th>Critère</th><th>Constat</th><th>Détail</th></tr></thead><tbody>${lignes.map(l => `<tr>${l.map(x => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
// synthèse de la grille sur un territoire : usages durables et densité, comme les tableaux de la CRE
function grilleTerritoire(codes) {
  const gaz = codes.filter(gazDistribue), n = d3.rollup(gaz, v => v.length, nbUsages), dens = d3.rollup(gaz, v => v.length, c => CRE[c]?.d);
  const epci = [...new Set(codes.map(c => EPCI_DE[c]))], projets = d3.sum(epci, e => CREG.projets_epci[e] || 0);
  return [
    ["Usages durables", "Communes au gaz par nombre d'usages", "", [0, 1, 2, 3].map(i => `${i} : <b>${n.get(i) || 0}</b>`).join(" · ")],
    ["", "Projets de biométhane inscrits au registre", "", `${pluriel(projets, "projet")} dans les EPCI du territoire (indicateur prospectif NaTran, à l'EPCI).`],
    ["Densité INSEE", "Communes au gaz par niveau", "", d3.range(1, 8).filter(i => dens.get(i)).map(i => `${DENSITES[i].toLowerCase()} : <b>${dens.get(i)}</b>`).join(" · ")],
    ["Économie locale", "Recettes, charges, actifs", etat(null), "À demander au concessionnaire, commune par commune."],
  ];
}

/* ---------- panneau : l'essentiel, le détail est dans la fiche ---------- */
function renderTerritoire() {
  const p = document.getElementById("panel"), A = terr().serie(), nom = terr().nom, cmp = comparaison(communesTerritoire());
  p.innerHTML = `<div><div class="eyebrow">Territoire</div><h2>${nom}</h2><p class="sub">Cliquez sur une commune pour sa fiche.</p></div>
  <div class="facts">
    <div class="fact"><span>Gaz distribué, 2023-25 vs 2019-21</span><b>${evo(evolution(totaux(A)))}</b></div>
    <div class="fact"><span>Électricité des logements</span><b>${evo(cmp?.elec)}</b></div>
  </div>
  <div class="chart"><h3>Gaz distribué par secteur</h3><div id="ch"></div>${keyRow()}</div>
  ${blocDecision(decisionTerritoire(), true)}
  <button class="btn" id="voirFiche" type="button">Ouvrir la fiche du territoire</button>`;
  p.querySelector("#ch").append(stackChart(A, { label: `Consommation de gaz par secteur, 2019-2025 : ${nom}` }));
  p.querySelector("#voirFiche").onclick = () => ouvrirFiche(null);
}
function renderCommune(c) {
  const p = document.getElementById("panel"), m = META[c], d = CONSO[c] || {}, rev = TR.revenus[c]?.[0];
  p.innerHTML = `<button class="back" id="back">← ${terr().nom}</button>
    <div><div class="eyebrow">${m[1] === "67" ? "Bas-Rhin" : "Haut-Rhin"} · ${EPCI[EPCI_DE[c]]?.nom ?? ""}</div><h2>${m[0]}</h2>${badgeProfil(c)}</div>
    <div class="facts">
      <div class="fact"><span>Gaz en 2025</span><b>${d.s && total(c, 6) != null ? gwh(total(c, 6)) : "—"}</b></div>
      <div class="fact"><span>Évolution du gaz</span><b>${evo(d.e?.tot)}</b></div>
      <div class="fact"><span>Électricité des logements</span><b>${evo(evolElec(c))}</b></div>
      <div class="fact"><span>Revenu médian</span><b>${rev ? fmt0.format(rev) + " €" : "—"}</b></div>
    </div>
    ${blocDecision(decisionCommune(c), true)}
    <button class="btn" id="voirFiche" type="button">Ouvrir la fiche complète</button>`;
  document.getElementById("back").onclick = () => select(null);
  p.querySelector("#voirFiche").onclick = () => ouvrirFiche(c);
}

/* ---------- fiche complète, imprimable ---------- */
function ouvrirFiche(c) { state.fiche = c; rendreFiche(); const f = document.getElementById("fiche"); if (!f.open) f.showModal(); f.scrollTop = 0; }
const faitFiche = (t, v, s) => `<div class="fact"><span>${t}</span><b>${v}</b>${s ? `<span>${s}</span>` : ""}</div>`;
function tableauFiche(lignes, colonnes) {
  return `<div class="tablewrap"><table><thead><tr><th>Année</th>${colonnes.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${YEARS.map((y, i) => `<tr><td>${y}</td>${lignes(i).map(v => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
const nb = v => v == null ? "–" : fmt0.format(v);
const reperage = d => `<svg class="reperage" viewBox="0 0 800 1000" aria-hidden="true"><path class="fond" d="${buildMap.alsace}"/><path class="ici" d="${d}"/></svg>`;
function ficheCommune(c) {
  const m = META[c], d = CONSO[c] || {}, e = d.e || {}, el = EL[c] || {}, g = reseauGRDF(c, 6), rev = TR.revenus[c], p = PROFIL[c], gaz = !!d.s;
  const s0 = d.n?.[0] || d.n?.find(Boolean), s1 = d.n?.[6], chips = [];
  if (d.f) chips.push("Répartition par secteur incertaine");
  if (d.x?.length) chips.push("Années de gaz incomplètes : " + d.x.map(i => YEARS[i]).join(", "));
  const trace = paths.data().find(x => x.code === c)?.d ?? "";
  return {
    eyebrow: `${m[1] === "67" ? "Bas-Rhin" : "Haut-Rhin"} · ${EPCI[EPCI_DE[c]]?.nom ?? ""}${el.hab ? " · " + pluriel(el.hab, "habitant") : ""}${CRE[c]?.d ? " · " + DENSITES[CRE[c].d].toLowerCase() : ""}`, nom: m[0], trace, badge: badgeProfil(c),
    grille: grilleCRE(c),
    phrase: p ? `${profilDe(p.id).aide}${p.motif ? " " + p.motif + "." : ""}` : "Aucune consommation de gaz distribué n'est publiée pour cette commune.",
    kpis: [
      faitFiche("Gaz en 2025", gaz && total(c, 6) != null ? gwh(total(c, 6)) : "—"),
      faitFiche("Évolution du gaz", evo(e.tot), "2023-25 vs 2019-21"),
      faitFiche("Gaz des logements", evo(e.R)),
      faitFiche("Électricité des logements", evo(evolElec(c))),
      faitFiche("Points de livraison 2025", s1 ? fmt0.format(s1) : "—", s0 && s1 ? `${evo(100 * (s1 / s0 - 1))} depuis ${YEARS[d.n.indexOf(s0)]}` : ""),
      faitFiche("Réseau GRDF", m[3] ? fmt1.format(m[3]) + " km" : "—", g ? `${fmt2.format(g.mwh / g.m)} MWh/m${g.n ? ` · ${fmt0.format(g.m / g.n)} m par client` : ""}` : d.o?.filter(o => o !== "GRDF").join(", ")),
      faitFiche("Revenu médian", rev ? fmt0.format(rev[0]) + " €" : "—", "par an, 2021"),
    ],
    decision: decisionCommune(c),
    logement: el.hab ? [faitFiche("Logements collectifs", el.coll + " %"), faitFiche("Chauffage électrique", el.chauf + " %"), faitFiche("Construits avant 1971", el.avant71 != null ? el.avant71 + " %" : "—"), faitFiche("Gestionnaire(s) du gaz", d.o?.join(", ") || "—")] : [],
    serie: gaz ? d.s : null, sites: d.n, incomplet: d.x, gazLog: gaz ? d.s.R : null, elecLog: el.r,
    colonnes: ["Gaz (MWh)", "dont logements", "Électricité logements", "Points de livraison"],
    lignes: i => [nb(total(c, i)), nb(d.s?.R[i]), nb(el.r?.[i]), nb(d.n?.[i])],
    chips, noteEnergies: "",
  };
}
function ficheTerritoire() {
  const t = terr(), A = t.serie(), s = t.sites(), codes = communesTerritoire(), cmp = comparaison(codes), comp = seriesTerritoire(codes);
  const km = d3.sum(codes, c => META[c][3]), n = d3.rollup(codes.filter(c => PROFIL[c]), v => v.length, c => PROFIL[c].id);
  return {
    eyebrow: `${pluriel(codes.length, "commune")} · ${pluriel(habitants(codes), "habitant")}`, nom: t.nom,
    trace: buildMap.data.filter(d => dansTerritoire(d.code)).map(d => d.d).join(""), badge: "",
    phrase: `Répartition des communes au gaz : ${PROFILS.map(p => `${p.label.toLowerCase()} (${n.get(p.id) || 0})`).join(", ")}.`,
    kpis: [
      faitFiche("Gaz en 2025", gwh(d3.sum(SKEYS, k => A[k][6]))),
      faitFiche("Évolution du gaz", evo(evolution(totaux(A))), "2023-25 vs 2019-21"),
      faitFiche("Gaz des logements", evo(evolSecteur(codes, "R"))),
      faitFiche("Électricité des logements", evo(cmp?.elec)),
      faitFiche("Points de livraison 2025", fmt0.format(s[6]), `${evo(100 * (s[6] / s[0] - 1), fmt1)} depuis 2019`),
      faitFiche("Réseau GRDF", fmt0.format(km) + " km", `${pluriel(codes.filter(c => META[c][3] > 0).length, "commune")}`),
    ],
    decision: decisionTerritoire(), logement: [], serie: A, grille: grilleTerritoire(codes), sites: s, incomplet: [], gazLog: comp.n ? comp.gaz : null, elecLog: comp.n ? comp.elec : null,
    colonnes: ["Gaz (MWh)", "dont logements", "Points de livraison"], lignes: i => [nb(d3.sum(SKEYS, k => A[k][i])), nb(A.R[i]), nb(s[i])], chips: [],
    noteEnergies: comp.n ? `Sur ${pluriel(comp.n, "commune")} comparables toutes les années.` : "",
  };
}
function rendreFiche() {
  const c = state.fiche, f = c ? ficheCommune(c) : ficheTerritoire(), dlg = document.getElementById("fiche");
  const energies = f.gazLog && f.elecLog?.some(v => v != null);
  dlg.innerHTML = `<div class="fiche-outils"><button class="btn discret" id="ficheFermer" type="button">Fermer</button><button class="btn" id="ficheImprimer" type="button">Imprimer ou enregistrer en PDF</button></div>
  <article class="fiche">
    <div class="fiche-tete"><div><div class="eyebrow">${f.eyebrow}</div><h2>${f.nom}</h2>${f.badge}<p>${f.phrase}</p></div>${reperage(f.trace)}</div>
    <div class="fiche-kpis">${f.kpis.join("")}</div>
    <div class="fiche-cols">
      <div>
        <div><h3>Pour décider</h3>${blocDecision(f.decision)}</div>
        ${f.logement.length ? `<div><h3>Logements</h3><div class="logement">${f.logement.join("")}</div></div>` : ""}
        ${f.chips.length ? `<div class="chips">${f.chips.map(t => `<span class="chip">${t}</span>`).join("")}</div>` : ""}
      </div>
      <div>
        ${f.serie ? `<div class="chart"><h3>Gaz par secteur</h3><div id="ficheGaz"></div>${keyRow()}</div>` : ""}
        ${energies ? `<div class="chart"><h3>Gaz et électricité des logements (base 100 en 2019-21)</h3><div id="ficheEnergies"></div>${f.noteEnergies ? `<p class="note">${f.noteEnergies}</p>` : ""}</div>` : ""}
      </div>
    </div>
    <div class="fiche-grille"><h3>Grille de la CRE</h3>${tableGrille(f.grille)}</div>
    ${f.serie ? tableauFiche(f.lignes, f.colonnes) : ""}
    <p class="note">Atlas du gaz en Alsace · sources : Agence ORE, GRDF, NaTran, INSEE (recensement 2022, grille de densité), SIRENE, France Chaleur Urbaine, revenus 2021 ; critères de la CRE, rapport 2026. Évolutions : moyenne 2023-25 comparée à 2019-21, sans correction climatique. Ces éléments sont une aide à la lecture : aucune fermeture de réseau n'est décidée.</p>
  </article>`;
  if (f.serie) dlg.querySelector("#ficheGaz").append(stackChart(f.serie, { bars: true, incomplete: f.incomplet, label: `Consommation de gaz par secteur : ${f.nom}` }));
  if (energies) dlg.querySelector("#ficheEnergies").append(courbesEnergies(f.gazLog, f.elecLog, `Gaz et électricité des logements : ${f.nom}`));
  dlg.querySelector("#ficheFermer").onclick = () => dlg.close();
  dlg.querySelector("#ficheImprimer").onclick = imprimerFiche;
}
// la fiche s'imprime toujours en mode jour
function imprimerFiche() {
  const racine = document.documentElement, theme = racine.dataset.theme;
  racine.dataset.theme = "light"; rendreFiche();
  window.print();
  racine.dataset.theme = theme; rendreFiche();
}

/* ---------- bandeau, classements ---------- */
function renderHeader() {
  const t = terr(), A = t.serie(), s = t.sites(), codes = communesTerritoire(), cmp = comparaison(codes);
  const eTot = evolution(totaux(A)), eR = evolSecteur(codes, "R"), eS = 100 * (s[6] / s[0] - 1), km = d3.sum(codes, c => META[c][3]);
  const sens = v => `a ${v < 0 ? "baissé" : "augmenté"} de <b>${fmt0.format(Math.abs(v))} %</b>`;
  const clients = eS < 0 ? `n'a reculé que de ${fmt1.format(-eS)} %` : `a progressé de ${fmt1.format(eS)} %`;
  const elec = cmp ? (cmp.elec < 0 ? ` L'électricité des logements recule aussi (${pct(cmp.elec)}) : pas de report d'ensemble visible à ce stade.` : ` L'électricité des logements progresse (${pct(cmp.elec)}).`) : "";
  document.getElementById("eyebrow").textContent = state.terr === "alsace" ? `Alsace · ${pluriel(habitants(codes), "habitant")}` : `${t.nom} · ${pluriel(codes.length, "commune")} · ${pluriel(habitants(codes), "habitant")}`;
  document.getElementById("lede").innerHTML = `Entre 2019-2021 et 2023-2025, le gaz distribué dans ${t.dans} ${sens(eTot)}, mais le nombre de points de livraison ${clients} : le même réseau achemine moins de gaz par client.${elec}`;
  document.getElementById("kpis").innerHTML = [
    [evo(eTot), "de gaz distribué"],
    [evo(eR), "de gaz dans les logements"],
    [evo(cmp?.elec), "d'électricité dans les logements"],
    [fmt0.format(km) + " km", `de réseau GRDF, ${pluriel(codes.filter(c => META[c][3] > 0).length, "commune")}`],
  ].map(([b, l]) => `<div class="kpi"><b class="num">${b}</b><span>${l}</span></div>`).join("");
}
// le classement suit tous les filtres : territoire, échelle, indicateur, secteur, année, case de l'indicateur
function renderRank() {
  const k = ind().classement, epci = parEPCI(), rank = document.getElementById("rank");
  let rows;
  if (epci) {
    const codes = [...new Set(communesTerritoire().map(c => EPCI_DE[c]))].filter(e => EPCI[e]);
    rows = codes.map(e => { const v = ind().agreg(EPCI[e]); return { id: e, v, tri: v, nom: EPCI[e].nom, detail: pluriel(EPCI[e].communes.length, "commune"), txt: v == null ? "" : k.court(v) }; });
    rows = rows.filter(r => r.v != null);
  } else {
    rows = communesTerritoire().map(c => [c, value(c)]).filter(([c, v]) => v != null && !(ind().filtre && filtree(c)) && k.garder(c, v))
      .map(([c, v]) => ({ id: c, v, tri: k.tri ? k.tri(c) : v, nom: META[c][0], detail: k.detail(c), txt: k.montre ? k.montre(c) : k.court(v) }));
  }
  const tous = rows.sort((a, b) => k.ordre * (a.tri - b.tri)), visibles = tous.slice(0, NB_CLASSEMENT), mx = d3.max(visibles, r => Math.abs(r.tri));
  renderRank.lignes = tous; renderRank.epci = epci;
  document.getElementById("rankTitre").textContent = k.titre() + (epci ? ", par EPCI" : "");
  document.getElementById("rankNote").textContent = `${terr().nom} · ${k.note()} ${tous.length > visibles.length ? `Les ${visibles.length} premiers sur ${tous.length}. ` : ""}${epci ? "Cliquer sur un EPCI pour l'afficher." : "Cliquer sur une commune pour la situer."}`;
  const vide = document.getElementById("rankVide");
  vide.hidden = visibles.length > 0;
  vide.textContent = "Aucune commune ne correspond à ces filtres sur ce territoire.";
  rank.innerHTML = visibles.map((r, i) => `<li><button data-c="${r.id}"><span class="i">${i + 1}</span><span>${r.nom}<small>${r.detail}</small></span><span class="bar" style="width:${Math.max(4, Math.abs(r.tri) / mx * 100)}%;background:${colorOf(r.v)}"></span><span class="v">${r.txt}</span></button></li>`).join("");
  rank.querySelectorAll("button").forEach(b => b.onclick = () => {
    if (epci) choisirTerritoire(b.dataset.c); else select(b.dataset.c, true);
    document.getElementById("mapbox").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
// liste complète du classement, avec tous les critères de la grille, pour un tableur
const arrondi = (v, n = 0) => v == null || Number.isNaN(v) ? "" : String(+v.toFixed(n)).replace(".", ",");
function exporterCSV() {
  const lignes = renderRank.lignes || [], titre = ind().label;
  let entete, data;
  if (renderRank.epci) {
    entete = ["Code EPCI", "EPCI", titre, "Communes"];
    data = lignes.map(r => [r.id, r.nom, r.txt, EPCI[r.id].communes.length]);
  } else {
    entete = ["Code INSEE", "Commune", "EPCI", titre, "Détail", "Densité INSEE", "Usages durables (CRE)", "Détail des usages", "Score de ciblage", "Critères remplis",
      "Gaz 2025 (MWh)", "Points de livraison 2025", "Évolution du gaz (%)", "Gestionnaires", "Réseau publié (km)", "Densité tous gestionnaires (MWh/m)", "Réseau par client (m)",
      "Résidences principales", "Logements au gaz", "dont maisons", "dont chauffage collectif", "dont chaudière individuelle d'immeuble", "Propriétaires parmi les ménages au gaz (%)",
      "Revenu médian (€)", "Réseau de chaleur possible", "Profil"];
    data = lignes.map(r => {
      const c = r.id, l = CRE[c]?.log || {}, t = reseauTous(c), sc = scoreCiblage(c);
      return [c, r.nom, EPCI[EPCI_DE[c]]?.nom ?? "", r.txt, r.detail, CRE[c]?.d ? DENSITES[CRE[c].d] : "", nbUsages(c) ?? "", usagesCRE(c).map(u => u.texte).join(" ; "),
        sc == null ? "" : sc < 0 ? "écartée" : sc, criteresRemplis(c).map(k => k.label).join(" ; "),
        arrondi(total(c, 6)), CONSO[c]?.n?.[6] ?? "", arrondi(CONSO[c]?.e?.tot), CONSO[c]?.o?.join(" ; ") ?? "", t ? arrondi(t.m / 1000, 1) : "", t ? arrondi(t.mwh / t.m, 2) : "", t?.n ? arrondi(t.m / t.n) : "",
        l.rp ?? "", l.g ?? "", l.gm ?? "", l.gc ?? "", l.gi ?? "", l.pg ?? "", TR.revenus[c]?.[0] ?? "", substitutionPossible(c) ? "oui" : "non", PROFIL[c] ? profilDe(PROFIL[c].id).label : ""];
    });
  }
  const cellule = v => { const t = String(v ?? "").replace(/<[^>]+>/g, ""); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = "﻿" + [entete, ...data].map(l => l.map(cellule).join(";")).join("\r\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
    download: `${state.mode}_${terr().nom.replace(/[^\p{L}\d]+/gu, "_")}.csv` });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}
// sites d'injection du territoire : ceux qui ont besoin du réseau au-delà de leur commune d'abord
function renderSites() {
  const sites = TR.biomethane.filter(s => dansTerritoire(s.c)).sort((a, b) => ancrageSite(b).fort - ancrageSite(a).fort || b.mwh - a.mwh);
  const forts = sites.filter(s => ancrageSite(s).fort).length, mx = d3.max(sites, s => s.mwh), liste = document.getElementById("sitesListe");
  document.getElementById("sitesNote").textContent = sites.length
    ? `${terr().nom} · ${forts} sites sur ${sites.length} injectent plus que leur commune ne consomme, ou se trouvent dans une commune sans consommation publiée. Le réseau doit alors évacuer ce gaz ailleurs, ce qui rend son retrait plus difficile. Cliquer sur un site pour le situer sur la carte.`
    : `${terr().nom} · Aucun site d'injection de biométhane sur ce territoire.`;
  liste.innerHTML = sites.map((s, i) => `<li><button data-c="${s.c}"><span class="i">${i + 1}</span><span>${s.nom}<small>${META[s.c][0]} · depuis ${s.date} · ${ancrageSite(s).texte}</small></span><span class="bar" style="width:${Math.max(4, s.mwh / mx * 100)}%;background:var(--biomethane)"></span><span class="v">${gwh(s.mwh)}</span></button></li>`).join("");
  liste.querySelectorAll("button").forEach(b => b.onclick = () => { select(b.dataset.c, true); document.getElementById("mapbox").scrollIntoView({ behavior: "smooth", block: "center" }); });
}

/* ---------- contrôles ---------- */
function construireControles() {
  const select = document.getElementById("territoire");
  select.innerHTML = `<option value="alsace">Toute l'Alsace</option><option value="tea">Communes de TEA</option>
    <optgroup label="EPCI">${Object.entries(EPCI).sort((a, b) => a[1].nom.localeCompare(b[1].nom, "fr")).map(([c, e]) => `<option value="${c}">${e.nom}</option>`).join("")}</optgroup>`;
  select.onchange = () => choisirTerritoire(select.value);
  document.getElementById("segTheme").innerHTML = THEMES.map(t => `<button data-v="${t.id}" aria-pressed="${t.id === state.theme}">${t.label}</button>`).join("");
  document.querySelectorAll("#segTheme button").forEach(b => b.onclick = () => choisirTheme(b.dataset.v));
  const box = document.getElementById("listeCalques");
  for (const l of COUCHES) {
    const bloc = document.createElement("div");
    bloc.innerHTML = `<label class="switch"><input type="checkbox" id="couche-${l.id}"> ${l.label}</label>
      <div class="cles">${l.cles.map(([style, texte, classe]) => `<span><i class="${classe || ""}" style="${style}"></i>${texte}</span>`).join("")}</div>`;
    bloc.querySelector("input").onchange = e => { l.actif = e.target.checked; hideTip(); majSurcouches(); drawCouches(); };
    box.append(bloc);
  }
}
function choisirTheme(id) {
  const t = THEMES.find(x => x.id === id);
  state.theme = id; state.mode = t.modes[0]; state.cat = null; state.filtre = false;
  document.querySelectorAll("#segTheme button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === id));
  for (const l of COUCHES) { l.actif = t.couches.includes(l.id); document.getElementById("couche-" + l.id).checked = l.actif; }
  const seg = document.getElementById("segMode");
  seg.innerHTML = t.modes.map(m => `<button data-v="${m}" aria-pressed="${m === state.mode}">${INDICATEURS[m].label}</button>`).join("");
  brancherSeg("segMode", "mode", () => { state.filtre = false; });
  recolor();
}
function brancherSeg(id, key, after) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => {
    document.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute("aria-pressed", x === b));
    state[key] = b.dataset.v; after?.(); recolor();
  });
}
// liste de recherche limitée au territoire choisi
let communeParNom = {};
function remplirRecherche() {
  const dl = document.getElementById("communesList");
  dl.replaceChildren(); communeParNom = {};
  communesTerritoire().sort((a, b) => META[a][0].localeCompare(META[b][0], "fr")).forEach(c => {
    communeParNom[META[c][0].toLowerCase()] = c; dl.append(new Option(META[c][0]));
  });
}
function choisirTerritoire(v) {
  state.terr = v;
  document.getElementById("territoire").value = v;
  document.getElementById("search").value = "";
  remplirRecherche(); majContour(); renderHeader();
  if (state.sel && !dansTerritoire(state.sel)) select(null);
  else if (state.sel) renderCommune(state.sel);
  else renderTerritoire();
  hideTip(); recolor(); vueTerritoire();
}

/* ---------- mode jour / nuit ---------- */
function majBoutonTheme() {
  const nuit = document.documentElement.dataset.theme === "dark", b = document.getElementById("themeBtn");
  const libelle = nuit ? "Passer en mode jour" : "Passer en mode nuit";
  b.innerHTML = nuit
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;
  b.title = libelle; b.setAttribute("aria-label", libelle);
}
document.getElementById("themeBtn").onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;   // le MutationObserver redessine carte et graphiques
  try { localStorage.setItem("theme", t); } catch (e) {}
  majBoutonTheme();
};
majBoutonTheme();

function preparer(conso, tea, transition, electricite, epci, cre) {
  D = conso; META = conso.meta; CONSO = conso.conso; YEARS = conso.annees;
  TEA = { ...tea, codes: new Set(tea.communes) }; TR = transition; EL = electricite.communes; EPCI = epci; CRE = cre.communes; CREG = cre;
  for (const [code, e] of Object.entries(EPCI)) e.communes.forEach(c => EPCI_DE[c] = code);
  TR.parCommune = {};
  const fiche = c => TR.parCommune[c] ??= { reseaux: [], zone: false, projets: [] };
  TR.chaleur.reseaux.forEach(r => r.c.forEach(c => fiche(c).reseaux.push(r)));
  TR.chaleur.zones.forEach(z => z.c.forEach(c => fiche(c).zone = true));
  TR.chaleur.projets.forEach(p => p.c.forEach(c => fiche(c).projets.push(p)));
  for (const c of Object.keys(META)) {
    const g = gazElec(c), p = calculerProfil(c);
    if (g) GE[c] = g;
    if (p) PROFIL[c] = p;
  }
}
const charger = f => fetch(f).then(r => { if (!r.ok) throw new Error(f + " : " + r.status); return r.json(); });
const reseaux = COUCHES.filter(l => l.fichier);
Promise.all(["communes", "conso", "tea", "transition", "electricite", "epci", "cre"].map(n => charger(`data/${n}.json`)).concat(reseaux.map(l => charger(l.fichier)))).then(([geo, conso, tea, transition, electricite, epci, cre, ...lignes]) => {
  preparer(conso, tea, transition, electricite, epci, cre);
  renderHeader(); buildMap(geo);
  reseaux.forEach((l, i) => l.path = lignesEnChemin(lignes[i]));
  buildTransition(); construireControles();
  brancherSeg("segEchelle", "echelle"); brancherSeg("segSect", "sect");
  document.querySelectorAll("#segBas button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#segBas button").forEach(x => x.setAttribute("aria-pressed", x === b));
    ["rank", "sites", "methode"].forEach(v => document.getElementById("volet-" + v).hidden = v !== b.dataset.v);
  });
  document.getElementById("exporter").onclick = exporterCSV;
  choisirTheme(state.theme); renderTerritoire(); remplirRecherche();
  setTimeout(() => document.body.classList.add("pret"), 100);
  const yr = document.getElementById("year");
  yr.oninput = () => { state.year = +yr.value; document.getElementById("yearOut").textContent = yr.value; recolor(); };
  document.getElementById("search").onchange = e => { const c = communeParNom[e.target.value.trim().toLowerCase()]; if (c) select(c, true); };
  const redessiner = () => { recolor(); state.sel ? renderCommune(state.sel) : renderTerritoire(); if (document.getElementById("fiche").open) rendreFiche(); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redessiner);
  new MutationObserver(redessiner).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new ResizeObserver(drawCouches).observe(document.getElementById("mapbox"));
}).catch(err => { document.getElementById("lede").textContent = "Les données n'ont pas pu être chargées : " + err.message; });
