"""Produit les fichiers de la carte web (carte/data/*.json).

- communes.json : contours simplifiés des communes
- reseau.json   : tracé simplifié du réseau GRDF (couche linéaire, voir exporter_lignes)
- conso.json    : consommations de gaz par commune, secteur et année + indicateurs
                  (r : volumes et points de livraison GRDF par an, rapportés au réseau GRDF)

Les géométries simplifiées viennent de build/ (étape GRASS de construire.sh).
Pour ajouter une couche linéaire à la carte : simplifier la couche dans construire.sh,
appeler exporter_lignes() en bas de ce fichier, puis la déclarer dans COUCHES (carte/app.js).
"""
import json
import os
from collections import defaultdict
from osgeo import ogr

from commun import ANNEES, BUILD, CARTE_DATA, GPKG, lire_conso

ogr.UseExceptions()
Q = 10  # quantification des coordonnées : 10 m en Lambert-93
SECTEURS = {"RESIDENTIEL": "R", "TERTIAIRE": "T", "INDUSTRIE": "I", "AGRICULTURE": "A", "INCONNU": "A"}
P1, P2 = (2019, 2020, 2021), (2023, 2024, 2025)  # périodes comparées pour l'évolution


def entites(gpkg, couche=None):
    """Entités d'une couche, la première par défaut (garde la source ouverte pendant le parcours)."""
    ds = ogr.Open(gpkg)
    yield from (ds.GetLayerByName(couche) if couche else ds.GetLayer(0))


def encoder(pts):
    """Anneau ou ligne -> liste plate d'entiers delta-encodés (x0,y0,dx,dy,...)."""
    out, px, py = [], 0, 0
    for x, y in pts:
        x, y = round(x / Q), round(y / Q)
        if out and x == px and y == py:
            continue
        out += [x - px, y - py]
        px, py = x, y
    return out


def ecrire(nom, data):
    os.makedirs(CARTE_DATA, exist_ok=True)
    with open(os.path.join(CARTE_DATA, nom), "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)


def exporter_communes(gpkg):
    """Contours (Lambert-93) -> communes.json ; renvoie {code: (nom, departement, epci)}."""
    geo, noms = defaultdict(list), {}
    for f in entites(gpkg):
        g = f.GetGeometryRef()
        noms[f["code"]] = (f["nom"], f["departement"], f["epci"])
        for i in range(g.GetGeometryCount()):
            geo[f["code"]].append(encoder(g.GetGeometryRef(i).GetPoints()))
    ecrire("communes.json", {"q": Q, "c": geo})
    return noms


def exporter_lignes(gpkg, sortie):
    """Couche linéaire (Lambert-93) -> fichier lisible par une entrée de COUCHES dans app.js."""
    lignes = []
    for f in entites(gpkg):
        e = encoder(f.GetGeometryRef().GetPoints())
        if len(e) >= 4:
            lignes.append(e)
    ecrire(sortie, {"q": Q, "l": lignes})
    return len(lignes)


def km_par_commune(gpkg, couche="reseau_grdf", champ_code="code_insee", champ_longueur="longueur_m"):
    """Longueur de réseau par commune, mesurée sur le tracé non simplifié."""
    km = defaultdict(float)
    for f in entites(gpkg, couche):
        km[f[champ_code].zfill(5)] += f[champ_longueur] / 1000
    return km


def moyenne(d, annees):
    """Moyenne sur une période, si au moins 2 années sur 3 sont renseignées."""
    ys = [y for y in annees if y in d]
    return sum(d[y] for y in ys) / len(ys) if len(ys) >= 2 else None


def consommations():
    """Agrège le fichier ORE par commune ; renvoie (communes, alsace, sites_alsace, noms_epci)."""
    n = len(ANNEES)
    # v[(commune, gestionnaire)][secteur][année] ; sites idem
    v = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    sites = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    inconnu = defaultdict(lambda: defaultdict(float))
    present = defaultdict(set)  # (commune, gestionnaire) -> années renseignées
    secret = defaultdict(set)   # (commune, gestionnaire) -> années avec un secteur masqué
    transport = defaultdict(lambda: defaultdict(float))
    noms_epci = {}
    for r in lire_conso():
        c, a, op, x = r["commune"], r["annee"], r["operateur"], r["mwh"]
        noms_epci[r["epci"]] = r["nom_epci"]
        if op == "Natran":  # réseau de transport : hors distribution
            transport[c][a] += x
            continue
        s = SECTEURS[r["secteur"]]
        v[(c, op)][s][a] += x
        sites[(c, op)][s][a] += r["sites"]
        if r["secteur"] == "INCONNU":
            inconnu[c][a] += x
        if x > 0:  # lignes à 0 = donnée absente (secret statistique)
            present[(c, op)].add(a)
        if r["secret"]:
            secret[(c, op)].add(a)

    communes = {}
    alsace = {s: [0.0] * n for s in "RTIA"}  # périmètre constant
    sites_alsace = [0] * n
    ops_par_commune = defaultdict(list)
    for (c, op) in v:
        ops_par_commune[c].append(op)

    for c, ops in ops_par_commune.items():
        serie = {s: [None] * n for s in "RTIA"}
        nsites = [0] * n
        incomplet = [False] * n
        num, den = defaultdict(float), defaultdict(float)
        for op in ops:
            yrs = present[(c, op)]
            for i, a in enumerate(ANNEES):
                if a in yrs:
                    for s in "RTIA":
                        if a in v[(c, op)][s]:
                            serie[s][i] = (serie[s][i] or 0) + v[(c, op)][s][a]
                        nsites[i] += sites[(c, op)][s].get(a, 0)
                elif yrs and (min(yrs) < a < max(yrs) or len(yrs) >= 3):
                    incomplet[i] = True
            # Alsace : gestionnaires présents toutes les années
            if len(yrs) == n:
                for i, a in enumerate(ANNEES):
                    for s in "RTIA":
                        alsace[s][i] += v[(c, op)][s].get(a, 0)
                    sites_alsace[i] += sum(sites[(c, op)][s].get(a, 0) for s in "RTIA")
            # évolution P1 -> P2, gestionnaire par gestionnaire
            tot = {a: sum(v[(c, op)][s].get(a, 0) for s in "RTIA") for a in yrs}
            m1, m2 = moyenne(tot, P1), moyenne(tot, P2)
            if m1 and m2 is not None:
                num["tot"] += m2; den["tot"] += m1
                for s in "RTI":
                    d = dict(v[(c, op)][s])
                    s1, s2 = moyenne(d, P1), moyenne(d, P2)
                    if s1 and s2 is not None:
                        num[s] += s2; den[s] += s1
        total = {a: sum(serie[s][i] or 0 for s in "RTIA") for i, a in enumerate(ANNEES)}
        # répartition sectorielle incertaine : plus de 10 % des volumes sans secteur une année
        flou = any(inconnu[c].get(a, 0) > 0.1 * total[a] for a in ANNEES if total[a])
        evol = {k: round(100 * (num[k] / den[k] - 1), 1)
                for k in den if den[k] > 0 and (k == "tot" or not flou)}
        communes[c] = {
            "s": {s: [None if x is None else round(x) for x in serie[s]] for s in "RTIA"},
            "n": nsites, "x": [i for i, b in enumerate(incomplet) if b],
            "e": evol, "f": 1 if flou else 0, "o": sorted(ops),
        }
        if "GRDF" in ops:  # base des indicateurs rapportés au réseau GRDF (seul réseau connu)
            yrs, k = present[(c, "GRDF")], (c, "GRDF")
            communes[c]["r"] = {
                "v": [round(sum(v[k][s].get(a, 0) for s in "RTIA")) if a in yrs else None for a in ANNEES],
                "n": [sum(sites[k][s].get(a, 0) for s in "RTIA") if a in yrs else None for a in ANNEES],
                "p": [i for i, a in enumerate(ANNEES) if a in yrs and a in secret[k]],
            }
    for c, d in transport.items():
        communes.setdefault(c, {})["t"] = [round(d.get(a, 0)) for a in ANNEES]
    alsace = {s: [round(x) for x in alsace[s]] for s in "RTIA"}
    return communes, alsace, sites_alsace, noms_epci


if __name__ == "__main__":
    noms = exporter_communes(os.path.join(BUILD, "communes_simpl.gpkg"))
    nb = exporter_lignes(os.path.join(BUILD, "reseau_simpl.gpkg"), "reseau.json")
    km = km_par_commune(GPKG)
    communes, alsace, sites_alsace, noms_epci = consommations()
    # meta : [nom, département, nom de l'EPCI, km de réseau GRDF]
    meta = {c: [nom, dep, noms_epci.get(epci, ""), round(km.get(c, 0), 2)]
            for c, (nom, dep, epci) in noms.items()}
    ecrire("conso.json", {"annees": ANNEES, "meta": meta, "conso": communes,
                          "alsace": alsace, "alsace_sites": sites_alsace})
    print(f"communes : {len(noms)} | avec gaz : {len(communes)} | tronçons de réseau : {nb}")
