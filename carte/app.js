const SECT = { R: "Résidentiel", T: "Tertiaire", I: "Industrie", A: "Autres" };
const SKEYS = ["R", "T", "I", "A"];
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
const SEUIL_CLASSEMENT = 5000;   // MWh par an : écarte les petits volumes, où les pourcentages n'ont pas de sens
const NB_CLASSEMENT = 12;

/* ---------- couches linéaires superposées ----------
   Ajouter une couche : produire data/<id>.json avec exporter_lignes() dans
   scripts/04_donnees_carte.py, puis déclarer la couche ici. La case à cocher
   et la légende sont créées automatiquement. `couleur` est un jeton CSS de style.css. */
const COUCHES = [
  { id: "reseau", label: "Réseau GRDF", fichier: "data/reseau.json", couleur: "--net", epaisseur: 1, actif: true },
];

const state = { terr: "alsace", mode: "evol", sect: "tot", year: 2025, sel: null, filtre: false };
let D, META, CONSO, YEARS, TEA, paths, gMap, zoom, proj, transform = d3.zoomIdentity;

/* ---------- territoires ---------- */
const TERRITOIRES = {
  alsace: { nom: "Toute l'Alsace", dans: "les communes alsaciennes", communes: "Communes d'Alsace",
            serie: () => D.alsace, sites: () => D.alsace_sites },
  tea: { nom: "Communes de TEA", dans: "les communes de TEA", communes: "Communes de TEA",
         serie: () => TEA.serie, sites: () => TEA.sites },
};
const terr = () => TERRITOIRES[state.terr];
const dansTerritoire = c => state.terr === "alsace" || TEA.codes.has(c);
const communesTerritoire = () => Object.keys(META).filter(dansTerritoire);

function decode(arr, q) {
  const pts = []; let x = 0, y = 0;
  for (let i = 0; i < arr.length; i += 2) { x += arr[i]; y += arr[i + 1]; pts.push([x * q, y * q]); }
  return pts;
}
const mean = (a, idx) => { const v = idx.map(i => a[i]).filter(x => x != null); return v.length ? d3.sum(v) / v.length : null; };
const total = (c, i) => { const s = CONSO[c]?.s; if (!s) return null; const v = SKEYS.map(k => s[k][i]); return v.every(x => x == null) ? null : d3.sum(v); };
const sectVal = (c, k, i) => k === "tot" ? total(c, i) : CONSO[c]?.s?.[k]?.[i] ?? null;
// gaz et points de livraison GRDF de l'année i, rapportés au réseau GRDF (seul réseau connu)
function reseauGRDF(c, i) {
  const r = CONSO[c]?.r, km = META[c][3];
  if (!r || km <= 0.5 || r.v[i] == null) return null;
  return { mwh: r.v[i], n: r.n[i], m: km * 1000, partiel: r.p.includes(i) };
}
const densite = c => { const g = reseauGRDF(c, YEARS.indexOf(state.year)); return g ? g.mwh / g.m : null; };
const lineaire = c => { const g = reseauGRDF(c, YEARS.indexOf(state.year)); return g?.n ? g.m / g.n : null; };
const notePartiel = c => reseauGRDF(c, YEARS.indexOf(state.year))?.partiel ? "Données partielles (secret statistique)" : null;

/* ---------- indicateurs de la carte ----------
   Ajouter un indicateur : une entrée ici, le bouton « Afficher » est créé automatiquement.
   - valeur(c) : nombre ou null pour la commune de code INSEE c (données de data/conso.json)
   - seuils : bornes des classes ; couleurs : une classe de plus que de seuils (jetons CSS)
   - secteurs / annee : affichent les filtres correspondants
   - note(c) : avertissement facultatif affiché dans l'infobulle
   - filtre : { label, garder(v) } ajoute une case qui estompe les communes où garder(v) est faux
   - bornes : mots aux deux extrémités de la légende ; lecture() : phrase d'explication au-dessus de la carte
   - classement : { titre(), note(), ordre (1 = plus petites valeurs d'abord), garder(c, v), detail(c), court(v) } */
const nomSecteur = () => state.sect === "tot" ? "" : { R: " dans le résidentiel", T: " dans le tertiaire", I: " dans l'industrie" }[state.sect];
const moyennePeriode = (c, idx) => mean(YEARS.map((y, i) => sectVal(c, state.sect, i)), idx);
const noteClic = "Cliquer sur une commune pour la situer sur la carte.";
const reseauComplet = c => !notePartiel(c);   // le secret statistique fausse les indicateurs de réseau
const INDICATEURS = {
  evol: {
    label: "Évolution", secteurs: true, unite: "%", vide: "Pas de donnée fiable",
    titre: () => `Évolution ${state.sect === "tot" ? "de la consommation" : "— " + SECT[state.sect].toLowerCase()}, 2019-21 → 2023-25`,
    seuils: [-30, -15, -5, 5, 15, 30], couleurs: ["--d-3", "--d-2", "--d-1", "--d0", "--d1", "--d2", "--d3"],
    graduations: ["−30", "−15", "−5", "+5", "+15", "+30"], bornes: ["▼ Baisse", "Hausse ▲"],
    lecture: () => `<b>Rouge : la consommation a baissé. Vert : elle a augmenté.</b> Plus la couleur est foncée, plus l'écart entre 2019-2021 et 2023-2025 est important.`,
    classement: {
      titre: () => state.sect === "R" ? "Où le chauffage au gaz recule le plus" : `Où le gaz recule le plus${nomSecteur()}`,
      note: () => `Évolution de la consommation${nomSecteur()}, moyenne 2023-2025 comparée à 2019-2021. Communes consommant au moins ${fmt0.format(SEUIL_CLASSEMENT / 1000)} GWh par an${nomSecteur()}.`,
      ordre: 1, garder: (c, v) => v < 0 && moyennePeriode(c, [0, 1, 2]) >= SEUIL_CLASSEMENT,
      detail: c => `${gwh(moyennePeriode(c, [0, 1, 2]))} → ${gwh(moyennePeriode(c, [4, 5, 6]))} par an`, court: evo,
    },
    valeur: c => CONSO[c]?.s ? CONSO[c].e?.[state.sect] ?? null : null, texte: pct,
    note: c => CONSO[c]?.f && state.sect !== "tot" ? "Répartition par secteur incertaine" : null,
  },
  conso: {
    label: "Consommation", secteurs: true, annee: true, unite: "GWh", vide: "Pas de gaz distribué connu",
    titre: () => `Consommation ${state.sect === "tot" ? "totale" : SECT[state.sect].toLowerCase()} en ${state.year}`,
    seuils: [1000, 5000, 20000, 100000], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["1", "5", "20", "100"],
    bornes: ["Faible", "Forte"],
    lecture: () => `<b>Plus le bleu est foncé, plus la commune consomme de gaz</b>${nomSecteur()} en ${state.year}.`,
    classement: {
      titre: () => `Les communes qui consomment le plus de gaz${nomSecteur()} en ${state.year}`,
      note: () => `Volumes de gaz distribué${nomSecteur()} en ${state.year}, hors réseau de transport.`,
      ordre: -1, garder: (c, v) => v > 0, detail: c => META[c][2], court: gwh,
    },
    valeur: c => sectVal(c, state.sect, YEARS.indexOf(state.year)), texte: gwh,
  },
  densite: {
    label: "Densité énergétique", annee: true, unite: "MWh/m", vide: "Hors réseau GRDF",
    titre: () => `Gaz GRDF acheminé par mètre de réseau en ${state.year}`,
    seuils: [0.3, 0.45, 0.6, 1], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["0,3", "0,45", "0,6", "1"],
    bornes: ["Peu utilisé", "Très utilisé"],
    lecture: () => `<b>Plus le bleu est clair, moins le réseau est utilisé :</b> il achemine peu de gaz pour sa longueur (${state.year}).`,
    classement: {
      titre: () => `Où le réseau GRDF est le moins utilisé en ${state.year}`,
      note: () => `Gaz GRDF acheminé par mètre de réseau en ${state.year}. Communes avec plus de 500 m de réseau et données complètes.`,
      ordre: 1, garder: reseauComplet,
      detail: c => `${fmt1.format(META[c][3])} km de réseau`, court: v => fmt2.format(v) + " MWh/m",
    },
    valeur: densite, texte: v => fmt2.format(v) + " MWh par mètre de réseau", note: notePartiel,
    filtre: { label: "Seulement ≤ 0,5 MWh/m", garder: v => v <= 0.5 },
  },
  lineaire: {
    label: "Réseau par client", annee: true, unite: "m", vide: "Hors réseau GRDF",
    titre: () => `Mètres de réseau GRDF par point de livraison en ${state.year}`,
    seuils: [25, 35, 45, 60], couleurs: ["--q1", "--q2", "--q3", "--q4", "--q5"], graduations: ["25", "35", "45", "60"],
    bornes: ["Court", "Long"],
    lecture: () => `<b>Plus le bleu est foncé, plus il faut de réseau pour desservir un client</b> (${state.year}).`,
    classement: {
      titre: () => `Où il faut le plus de réseau par client en ${state.year}`,
      note: () => `Mètres de réseau GRDF par point de livraison en ${state.year}. Communes avec plus de 500 m de réseau et données complètes.`,
      ordre: -1, garder: reseauComplet,
      detail: c => { const n = reseauGRDF(c, YEARS.indexOf(state.year)).n; return `${fmt0.format(n)} client${n > 1 ? "s" : ""} · ${fmt1.format(META[c][3])} km`; }, court: v => fmt0.format(v) + " m",
    },
    valeur: lineaire, texte: v => fmt0.format(v) + " m de réseau par client", note: notePartiel,
  },
};
const ind = () => INDICATEURS[state.mode];
const value = c => ind().valeur(c);
function colorOf(v) {
  if (v == null) return css("--nodata");
  const s = ind(); let i = s.seuils.findIndex(b => v < b); if (i < 0) i = s.seuils.length;
  return css(s.couleurs[i]);
}
// commune estompée par le filtre de l'indicateur (valeur connue mais hors critère)
const filtree = c => { const f = ind().filtre, v = value(c); return !!(f && state.filtre && v != null && !f.garder(v)); };
function valueText(c) { const v = value(c); return v == null ? ind().vide : ind().texte(v); }

/* ---------- carte ---------- */
function drawLegend() {
  const s = ind();
  const couches = COUCHES.filter(l => l.actif).map(l => `<span><i style="height:2px;background:var(${l.couleur})"></i>${l.label}</span>`).join("");
  let filtre = "";
  if (s.filtre && state.filtre) {
    const n = communesTerritoire().filter(c => { const v = value(c); return v != null && s.filtre.garder(v); }).length;
    filtre = `<span><i class="case" style="background:var(--nodata);opacity:.35"></i>Hors filtre</span><span><b>${n}</b>&nbsp;communes retenues</span>`;
  }
  const hors = state.terr === "tea" ? `<span><i style="height:0;border-top:2px solid var(--accent)"></i>Limite de TEA</span>` : "";
  const extra = `<div class="extra"><span><i class="case" style="background:var(--nodata)"></i>${s.vide}</span>${filtre}${hors}${couches}<span><i style="height:0;border-top:1.5px dashed var(--ink-2)"></i>Limite départementale</span></div>`;
  const large = s.couleurs.length * 36 - 2;
  document.getElementById("legend").innerHTML = `<h4>${s.titre()} (${s.unite})</h4>
    <div class="bornes" style="width:${large}px"><span>${s.bornes[0]}</span><span>${s.bornes[1]}</span></div>
    <div class="row">${s.couleurs.map(c => `<i class="sw" style="background:var(${c})"></i>`).join("")}</div>
    <div class="ticks" style="padding-left:18px">${s.graduations.map(t => `<span>${t}</span>`).join("")}</div>${extra}`;
}
function recolor() {
  paths.classed("hors", d => !dansTerritoire(d.code))
    .attr("fill", d => !dansTerritoire(d.code) ? css("--hors") : filtree(d.code) ? css("--nodata") : colorOf(value(d.code)))
    .attr("fill-opacity", d => dansTerritoire(d.code) && filtree(d.code) ? .35 : null);
  drawLegend(); renderRank();
  document.getElementById("lecture").innerHTML = ind().lecture();
  document.getElementById("ctlYear").hidden = !ind().annee;
  document.getElementById("ctlSect").hidden = !ind().secteurs;
  const cf = document.getElementById("ctlFiltre");
  cf.hidden = !ind().filtre;
  if (ind().filtre) {
    cf.innerHTML = `<label class="switch"><input type="checkbox" id="filtre" ${state.filtre ? "checked" : ""}> ${ind().filtre.label}</label>`;
    cf.querySelector("input").onchange = e => { state.filtre = e.target.checked; recolor(); };
  }
}
function drawCouches() {
  const cv = document.getElementById("netCanvas"), box = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = box.width * dpr; cv.height = box.height * dpr;
  const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height);
  // même matrice que le groupe SVG (viewBox + zoom), ramenée au repère du canevas
  const m = gMap.node().getScreenCTM();
  ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * (m.e - box.left), dpr * (m.f - box.top));
  ctx.lineJoin = ctx.lineCap = "round";
  if (state.terr === "tea") ctx.clip(buildMap.clipTEA);
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
    .on("click", (ev, d) => select(d.code));
  // limite départementale : arêtes partagées entre communes du 67 et du 68
  const depLine = d3.geoPath(proj);
  gMap.append("path").attr("class", "deps").attr("d", depBoundary(feats, depLine));
  // contour de TEA : arêtes qui n'appartiennent qu'à une seule commune de TEA
  const feTEA = feats.filter(f => TEA.codes.has(f.code));
  gMap.append("path").attr("class", "contour").attr("id", "contourTEA").attr("d", contour(feTEA, depLine)).attr("visibility", "hidden");
  buildMap.clipTEA = new Path2D();
  data.filter(d => TEA.codes.has(d.code)).forEach(d => buildMap.clipTEA.addPath(new Path2D(d.d)));
  buildMap.feTEA = feTEA;
  gMap.append("path").attr("class", "selpath").attr("id", "selpath");
  zoom = d3.zoom().scaleExtent([1, 24]).translateExtent([[0, 0], [W, H]]).on("zoom", ev => { transform = ev.transform; gMap.attr("transform", transform); drawCouches(); });
  svg.call(zoom).on("dblclick.zoom", null);
  d3.select("#zin").on("click", () => svg.transition().call(zoom.scaleBy, 1.8));
  d3.select("#zout").on("click", () => svg.transition().call(zoom.scaleBy, 1 / 1.8));
  d3.select("#zreset").on("click", vueTerritoire);
  buildMap.gp = gp; buildMap.byCode = byCode; buildMap.svg = svg; buildMap.W = W; buildMap.H = H;
}
function lignesEnChemin(data) {
  const path = new Path2D();
  for (const l of data.l) { const p = decode(l, data.q).map(pt => proj(pt)); path.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) path.lineTo(p[i][0], p[i][1]); }
  return path;
}
function contour(feats, gp) {
  const key = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a + "|" + b : b + "|" + a;
  const seen = new Map();
  for (const f of feats) for (const r of f.geometry.coordinates) for (let i = 1; i < r.length; i++) {
    const k = key(r[i - 1], r[i]), s = seen.get(k);
    if (s) s.n++; else seen.set(k, { n: 1, seg: [r[i - 1], r[i]] });
  }
  return gp({ type: "MultiLineString", coordinates: [...seen.values()].filter(s => s.n === 1).map(s => s.seg) });
}
const duree = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 750;
// recadre la carte sur le territoire choisi
function vueTerritoire() {
  let t = d3.zoomIdentity;
  if (state.terr === "tea") {
    const { W, H } = buildMap, b = buildMap.gp.bounds({ type: "FeatureCollection", features: buildMap.feTEA });
    const k = .94 / Math.max((b[1][0] - b[0][0]) / W, (b[1][1] - b[0][1]) / H);
    t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2);
  }
  buildMap.svg.transition().duration(duree()).call(zoom.transform, t);
}
function depBoundary(feats, gp) {
  // segments présents dans une commune du 67 et une du 68
  const key = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a + "|" + b : b + "|" + a;
  const seen = new Map();
  for (const f of feats) {
    const dep = META[f.code]?.[1];
    for (const r of f.geometry.coordinates) for (let i = 1; i < r.length; i++) {
      const k = key(r[i - 1], r[i]); const s = seen.get(k);
      if (!s) seen.set(k, { dep, seg: [r[i - 1], r[i]] }); else if (s.dep !== dep) s.both = true;
    }
  }
  const segs = [...seen.values()].filter(s => s.both).map(s => s.seg);
  return gp({ type: "MultiLineString", coordinates: segs });
}

const tip = document.getElementById("tip");
function showTip(ev, c) {
  paths.classed("hover", d => d.code === c);
  const box = document.getElementById("mapbox").getBoundingClientRect();
  const m = META[c];
  const note = ind().note?.(c), extra = note ? `<span class="m">${note}</span>` : "";
  tip.innerHTML = `<b>${m[0]}</b>${valueText(c)}${filtree(c) ? " · hors filtre" : ""}${extra ? "<br>" + extra : ""}<br><span class="m">${m[3] ? fmt1.format(m[3]) + " km de réseau GRDF" : "Pas de réseau GRDF"}</span>`;
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

/* ---------- graphiques du panneau ---------- */
function stackChart(series, opts = {}) {
  // series : {R:[..7], T, I, A} en MWh ; barres empilées si opts.bars, aires sinon
  const W = 400, H = 210, m = { t: 10, r: 8, b: 22, l: 44 };
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
  g.append("text").attr("x", 0).attr("y", m.t - 0).attr("dy", -2).text(unit);
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
  // survol : réticule + bulle
  const hl = g.append("line").attr("class", "base").attr("y1", m.t).attr("y2", H - m.b).attr("opacity", 0);
  const ov = svg.append("rect").attr("x", m.l).attr("y", 0).attr("width", W - m.l - m.r).attr("height", H).attr("fill", "transparent");
  const node = svg.node();
  ov.on("mousemove", ev => {
    const [px] = d3.pointer(ev);
    const centers = YEARS.map(yr => x(yr) + (opts.bars ? x.bandwidth() / 2 : 0));
    const i = d3.leastIndex(centers, c => Math.abs(c - px));
    hl.attr("x1", centers[i]).attr("x2", centers[i]).attr("opacity", 1);
    const r = rows[i], tot = d3.sum(SKEYS, k => r[k]);
    tip2.innerHTML = `<b>${YEARS[i]}${inc.has(i) ? " · données incomplètes" : ""}</b>` + SKEYS.filter(k => r[k] > 0).map(k => `<span style="display:flex;gap:8px;justify-content:space-between"><span><i class="dot" style="background:var(--s-${k})"></i> ${SECT[k]}</span><span class="num">${gwh(r[k])}</span></span>`).join("") + `<span style="display:flex;justify-content:space-between;border-top:1px solid currentColor;margin-top:3px;padding-top:3px"><span>Total</span><span class="num">${gwh(tot)}</span></span>`;
    tip2.hidden = false;
    const b = node.getBoundingClientRect(), pb = node.closest(".panel").getBoundingClientRect();
    let left = b.left - pb.left + centers[i] / W * b.width + 12; if (left + 200 > pb.width) left -= 224;
    tip2.style.left = left + "px"; tip2.style.top = (b.top - pb.top + 8) + "px";
  }).on("mouseleave", () => { hl.attr("opacity", 0); tip2.hidden = true; });
  return node;
}
const tip2 = Object.assign(document.createElement("div"), { className: "tip", hidden: true }); tip2.style.minWidth = "190px";
const keyRow = () => `<div class="keyrow">${SKEYS.map(k => `<span><i class="dot" style="background:var(--s-${k})"></i>${SECT[k]}</span>`).join("")}</div>`;
function table(series, sites) {
  return `<details class="tbl"><summary>Voir les chiffres</summary><div class="tablewrap"><table><thead><tr><th>Année</th>${SKEYS.map(k => `<th>${SECT[k]}</th>`).join("")}<th>Total</th>${sites ? "<th>Points de livraison</th>" : ""}</tr></thead><tbody>${YEARS.map((y, i) => `<tr><td>${y}</td>${SKEYS.map(k => `<td>${series[k][i] == null ? "–" : fmt0.format(series[k][i])}</td>`).join("")}<td>${fmt0.format(d3.sum(SKEYS, k => series[k][i] || 0))}</td>${sites ? `<td>${fmt0.format(sites[i])}</td>` : ""}</tr>`).join("")}</tbody></table><p class="note">En MWh.</p></div></details>`;
}

function tableReseau(c) {
  const rows = YEARS.map((y, i) => [y, reseauGRDF(c, i)]).filter(([, g]) => g);
  if (!rows.length) return "";
  return `<details class="tbl"><summary>Indicateurs du réseau GRDF par an</summary><div class="tablewrap"><table><thead><tr><th>Année</th><th>Gaz GRDF (MWh)</th><th>Points de livraison GRDF</th><th>MWh par mètre</th><th>Mètres par client</th></tr></thead><tbody>${rows.map(([y, g]) => `<tr><td>${y}${g.partiel ? " *" : ""}</td><td>${fmt0.format(g.mwh)}</td><td>${fmt0.format(g.n)}</td><td>${fmt2.format(g.mwh / g.m)}</td><td>${g.n ? fmt0.format(g.m / g.n) : "–"}</td></tr>`).join("")}</tbody></table><p class="note">Pour ${fmt1.format(META[c][3])} km de réseau GRDF (tracé actuel, appliqué à toutes les années).${rows.some(([, g]) => g.partiel) ? " * Une partie des données est masquée par le secret statistique." : ""}</p></div></details>`;
}

// évolution entre 2019-21 et 2023-25 d'une série annuelle
const evolution = arr => 100 * (mean(arr, [4, 5, 6]) / mean(arr, [0, 1, 2]) - 1);
const totaux = A => YEARS.map((y, i) => d3.sum(SKEYS, k => A[k][i]));

function renderTerritoire() {
  const p = document.getElementById("panel"), A = terr().serie(), nom = terr().nom;
  p.innerHTML = `<div><div class="eyebrow">${nom}</div><h2>Gaz distribué par secteur</h2><p class="sub">Périmètre constant, hors réseau de transport. Cliquer une commune sur la carte pour son détail.</p></div>
  <div class="facts">
    <div class="fact"><span>Tous secteurs, 2023-25 vs 2019-21</span><b>${evo(evolution(totaux(A)))}</b></div>
    <div class="fact"><span>Résidentiel</span><b>${evo(evolution(A.R))}</b></div>
    <div class="fact"><span>Tertiaire</span><b>${evo(evolution(A.T))}</b></div>
    <div class="fact"><span>Industrie (distribution)</span><b>${evo(evolution(A.I))}</b></div>
  </div>
  <div class="chart"><h3>Consommation annuelle</h3><div id="ch"></div>${keyRow()}</div>
  <p class="note">En 2019, une partie des volumes n'était pas rattachée à un secteur (classée « Autres ») : la hausse apparente du tertiaire en 2020 vient en partie de ce reclassement.</p>
  ${table(A, terr().sites())}`;
  p.querySelector("#ch").append(stackChart(A, { label: `Consommation de gaz par secteur, 2019-2025 : ${nom}` }));
  p.append(tip2); p.style.position = "relative";
}

function renderCommune(c) {
  const p = document.getElementById("panel"), m = META[c], d = CONSO[c] || {};
  const head = `<button class="back" id="back">← ${terr().nom}</button><div><div class="eyebrow">${m[1] === "67" ? "Bas-Rhin" : "Haut-Rhin"}${m[2] ? " · " + m[2] : ""}</div><h2>${m[0]}</h2></div>`;
  if (!d.s) {
    p.innerHTML = head + `<p>Aucune consommation de gaz distribué n'est publiée pour cette commune.</p>${d.t ? `<div class="chips"><span class="chip sig">Site(s) raccordé(s) au transport : ${gwh(d.t[6])} en 2025</span></div>` : ""}<div class="facts"><div class="fact"><span>Réseau GRDF</span><b>${m[3] ? fmt1.format(m[3]) + " km" : "—"}</b></div></div>`;
  } else {
    const i25 = 6, t25 = total(c, i25), e = d.e || {};
    const r25 = reseauGRDF(c, i25), dens = r25 ? r25.mwh / r25.m : null, lin = r25?.n ? r25.m / r25.n : null;
    const chips = [];
    if (e.R != null && e.R <= -25) chips.push(["sig", "Recul marqué du chauffage au gaz"]);
    if (dens != null && dens < 0.25) chips.push(["sig", "Réseau GRDF peu sollicité"]);
    if (lin != null && lin > 60) chips.push(["sig", "Réseau long pour peu de clients"]);
    if (t25 && (d.s.I[i25] || 0) / t25 > .5) chips.push(["sig", "Volumes portés par l'industrie"]);
    if (d.t && d.t[6] > 0) chips.push(["sig", `Site raccordé au transport : ${gwh(d.t[6])}`]);
    if (d.f) chips.push(["warn", "Répartition par secteur incertaine"]);
    if (d.x?.length) chips.push(["warn", "Années incomplètes : " + d.x.map(i => YEARS[i]).join(", ")]);
    const s0 = d.n[0] || d.n.find(Boolean), s1 = d.n[6];
    p.innerHTML = head + `<div class="facts">
      <div class="fact"><span>Consommation 2025</span><b>${t25 != null ? gwh(t25) : "—"}</b></div>
      <div class="fact"><span>Évolution 2019-21 → 2023-25</span><b>${evo(e.tot)}</b><span>${terr().nom} : ${pct(evolution(totaux(terr().serie())))}</span></div>
    </div>
    <div class="facts three">
      <div class="fact"><span>Résidentiel</span><b>${evo(e.R)}</b></div>
      <div class="fact"><span>Tertiaire</span><b>${evo(e.T)}</b></div>
      <div class="fact"><span>Industrie</span><b>${evo(e.I)}</b></div>
    </div>
    <div class="facts">
      <div class="fact"><span>Points de livraison 2025</span><b>${fmt0.format(s1)}</b>${s0 && s1 ? `<span>${evo(100 * (s1 / s0 - 1))} depuis ${YEARS[d.n.indexOf(s0)]}</span>` : ""}</div>
      <div class="fact"><span>Réseau GRDF</span><b>${m[3] ? fmt1.format(m[3]) + " km" : "—"}</b>${dens != null ? `<span>${fmt2.format(dens)} MWh/m${lin ? ` · ${fmt0.format(lin)} m par client` : ""} en 2025</span>` : `<span>${d.o.filter(o => o !== "GRDF").join(", ") || ""}</span>`}</div>
    </div>
    ${chips.length ? `<div class="chips">${chips.map(([k, t]) => `<span class="chip ${k}">${t}</span>`).join("")}</div>` : ""}
    <div class="chart"><h3>Consommation par secteur</h3><div id="ch"></div>${keyRow()}</div>
    <p class="note">Gestionnaire(s) : ${d.o.join(", ")}.</p>
    ${table(d.s, d.n)}${tableReseau(c)}`;
    p.querySelector("#ch").append(stackChart(d.s, { bars: true, incomplete: d.x, label: `Consommation de gaz à ${m[0]} par secteur` }));
  }
  p.append(tip2);
  document.getElementById("back").onclick = () => select(null);
}

/* ---------- bandeau, classement ---------- */
function renderHeader() {
  const t = terr(), A = t.serie(), s = t.sites(), codes = communesTerritoire();
  const eTot = evolution(totaux(A)), eR = evolution(A.R), eS = 100 * (s[6] / s[0] - 1);
  const km = d3.sum(codes, c => META[c][3]);
  const sens = v => `a ${v < 0 ? "baissé" : "augmenté"} de <b>${fmt0.format(Math.abs(v))} %</b>`;
  const clients = eS < 0 ? `n'a reculé que de ${fmt1.format(-eS)} %` : `a progressé de ${fmt1.format(eS)} %`;
  document.getElementById("eyebrow").textContent = state.terr === "tea"
    ? `Territoire d'Énergie Alsace · ${fmt0.format(codes.length)} communes · ${fmt0.format(TEA.population)} habitants`
    : "Alsace · gaz distribué 2019-2025";
  document.getElementById("lede").innerHTML = `Entre 2019-2021 et 2023-2025, le gaz distribué dans ${t.dans} ${sens(eTot)}, et dans les logements il ${sens(eR)}. Le nombre de points de livraison, lui, ${clients}. Le même réseau achemine donc moins de gaz par client : c'est le cœur du débat sur son avenir.`;
  document.getElementById("kpis").innerHTML = [
    [evo(eTot), "de gaz distribué (moyenne 2023-25 vs 2019-21)"],
    [evo(eR), "dans le résidentiel"],
    [evo(eS, fmt1), "de points de livraison, 2019 → 2025"],
    [fmt0.format(km) + " km", `de réseau GRDF dans ${codes.filter(c => META[c][3] > 0).length} communes`],
  ].map(([b, l]) => `<div class="kpi"><b class="num">${b}</b><span>${l}</span></div>`).join("");
}
// le classement suit tous les filtres : territoire, indicateur, secteur, année, case de l'indicateur
function renderRank() {
  const k = ind().classement;
  const retenues = communesTerritoire().map(c => [c, value(c)])
    .filter(([c, v]) => v != null && !filtree(c) && k.garder(c, v))
    .sort((a, b) => k.ordre * (a[1] - b[1]));
  const rows = retenues.slice(0, NB_CLASSEMENT), mx = d3.max(rows, r => Math.abs(r[1]));
  document.getElementById("rankTitre").textContent = k.titre();
  document.getElementById("rankNote").textContent = `${terr().communes} · ${k.note()} ${retenues.length > rows.length ? `Les ${rows.length} premières sur ${retenues.length} communes. ` : ""}${noteClic}`;
  const vide = document.getElementById("rankVide");
  vide.hidden = rows.length > 0;
  vide.textContent = "Aucune commune ne correspond à ces filtres. Essayez un autre secteur ou un autre territoire.";
  const rank = document.getElementById("rank");
  rank.innerHTML = rows.map(([c, v], i) => `<li><button data-c="${c}"><span class="i">${i + 1}</span><span>${META[c][0]}<small>${k.detail(c)}</small></span><span class="bar" style="width:${Math.max(4, Math.abs(v) / mx * 100)}%;background:${colorOf(v)}"></span><span class="v">${k.court(v)}</span></button></li>`).join("");
  rank.querySelectorAll("button").forEach(b => b.onclick = () => { select(b.dataset.c, true); document.getElementById("mapbox").scrollIntoView({ behavior: "smooth", block: "center" }); });
}

/* ---------- contrôles ---------- */
function buildControls() {
  document.getElementById("segMode").innerHTML = Object.entries(INDICATEURS)
    .map(([k, s]) => `<button data-v="${k}" aria-pressed="${k === state.mode}">${s.label}</button>`).join("");
  const box = document.getElementById("couches");
  for (const l of COUCHES) {
    const lab = document.createElement("label"); lab.className = "switch";
    lab.innerHTML = `<input type="checkbox" id="couche-${l.id}" ${l.actif ? "checked" : ""}> ${l.label}`;
    lab.querySelector("input").onchange = e => { l.actif = e.target.checked; drawCouches(); drawLegend(); };
    box.append(lab);
  }
}
function seg(id, key, after) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => {
    document.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute("aria-pressed", x === b));
    state[key] = b.dataset.v; after && after(); recolor();
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
function changerTerritoire() {
  d3.select("#contourTEA").attr("visibility", state.terr === "tea" ? "visible" : "hidden");
  document.getElementById("search").value = "";
  remplirRecherche(); renderHeader();
  if (state.sel && !dansTerritoire(state.sel)) select(null);
  else if (state.sel) renderCommune(state.sel);
  else renderTerritoire();
  hideTip(); vueTerritoire();
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

const charger = f => fetch(f).then(r => { if (!r.ok) throw new Error(f + " : " + r.status); return r.json(); });
Promise.all([charger("data/communes.json"), charger("data/conso.json"), charger("data/tea.json"), ...COUCHES.map(l => charger(l.fichier))]).then(([geo, conso, tea, ...lignes]) => {
  D = conso; META = conso.meta; CONSO = conso.conso; YEARS = conso.annees;
  TEA = { ...tea, codes: new Set(tea.communes) };
  renderHeader(); buildMap(geo);
  COUCHES.forEach((l, i) => l.path = lignesEnChemin(lignes[i]));
  buildControls(); recolor(); drawCouches(); renderTerritoire();
  seg("segTerr", "terr", changerTerritoire); seg("segMode", "mode"); seg("segSect", "sect");
  const yr = document.getElementById("year");
  yr.oninput = () => { state.year = +yr.value; document.getElementById("yearOut").textContent = yr.value; recolor(); };
  remplirRecherche();
  document.getElementById("search").onchange = e => { const c = communeParNom[e.target.value.trim().toLowerCase()]; if (c) select(c, true); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { recolor(); drawCouches(); state.sel ? renderCommune(state.sel) : renderTerritoire(); });
  new MutationObserver(() => { recolor(); drawCouches(); state.sel ? renderCommune(state.sel) : renderTerritoire(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new ResizeObserver(drawCouches).observe(document.getElementById("mapbox"));
}).catch(err => { document.getElementById("lede").textContent = "Les données n'ont pas pu être chargées : " + err.message; });
