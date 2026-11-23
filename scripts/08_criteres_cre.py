"""Produit les données des critères de la CRE (annexe « Analyses locales », rapport 2026 sur l'avenir
des infrastructures gazières) : carte/data/cre.json, natran.json et reseau_autres.json.

cre.json
- communes : code INSEE ->
    d    : niveau de la grille communale de densité INSEE (1 grands centres urbains … 7 rural très dispersé)
    naf  : [MWh par an, points de livraison, secret] du gaz des industries chimie, verre et minéraux,
           métallurgie (NAF 20, 23, 24), moyenne 2023-2025 ; secret = 1 si une partie est masquée
    log  : résidences principales du recensement 2022 (fichier détail, pondéré) :
           rp total, g chauffées au gaz de réseau, gm maisons au gaz, gc appartements au gaz en chauffage
           collectif, gi appartements au gaz avec chaudière individuelle, f fioul, u chauffage urbain,
           e électricité, p propriétaires (%), pg propriétaires parmi les ménages chauffés au gaz (%),
           hg logements HLM parmi ceux chauffés au gaz (%)
    km   : longueur de réseau de distribution par gestionnaire publié (Agence ORE : GRDF, R-GDS, Vialis)
    op   : {gestionnaire: [MWh, points de livraison]} en 2025, pour les gestionnaires dont le réseau est publié
    mp   : km de réseau en moyenne pression, quand le gestionnaire la publie (Vialis seulement)
    z    : indice du zonage biométhane qui contient la commune (centre de la commune)
    reb  : 1 si un site de rebours vers le réseau de transport est dans la commune
- zonages    : zonages de raccordement du biométhane (ODRÉ) : nom, maturité, projets en file d'attente…
- industries : établissements actifs de 20 salariés et plus, NAF 20, 23 ou 24 (base SIRENE)
- rebours    : sites de rebours (NaTran)
- injection  : sites d'injection du registre absents de la source de production annuelle (réseaux R-GDS,
               Gaz de Barr, Caléo, NaTran), placés au centre de leur commune
- projets_epci : projets de biométhane inscrits au registre par EPCI (indicateur prospectif NaTran)

natran.json et reseau_autres.json : couches linéaires au format de exporter_lignes (04_donnees_carte.py).
Ce script lit carte/data/communes.json et conso.json ; il n'a besoin ni de GDAL ni de QGIS.
"""
import csv
import gzip
import importlib
import io
import json
import math
import os
import zipfile
from collections import defaultdict

import openpyxl

from commun import ANNEES, CARTE_DATA, SOURCES, SRC_CONSO, lire_conso

transition = importlib.import_module("06_transition")
lambert93, simplifier, encoder, Communes, Q = (transition.lambert93, transition.simplifier, transition.encoder,
                                               transition.Communes, transition.Q)

SRC_DENSITE = os.path.join(SOURCES, "grille_densite_7_niveaux_2024.xlsx")
SRC_LOGEMENTS = os.path.join(SOURCES, "RP2022_logemtzc.zip")
SRC_RESEAU_ORE = os.path.join(SOURCES, "ore-infrastructures-gaz-alsace.jsonl.gz")
SRC_NATRAN = os.path.join(SOURCES, "natran-trace-reseau-alsace.geojson")
SRC_ZONAGES = os.path.join(SOURCES, "zonages-acces-biomethane-alsace.geojson")
SRC_REBOURS = os.path.join(SOURCES, "sites-rebours-natran.csv")
SRC_INDUSTRIES = os.path.join(SOURCES, "industries-gaz-non-substituable.csv")
SRC_PROSPECTIF = os.path.join(SOURCES, "gaz-renouvelable-prospectif-epci.csv")
SRC_REGISTRE = os.path.join(SOURCES, "sites-injection-biomethane-alsace.csv")

NAF_NON_SUBSTITUABLE = ("20", "23", "24")
ANNEES_NAF = (2023, 2024, 2025)
NOMS_GRD = {"Réseau GDS": "R-GDS"}


def densite(codes):
    ws = openpyxl.load_workbook(SRC_DENSITE, read_only=True)["Grille_Densite"]
    return {r[0]: int(r[2]) for r in ws.iter_rows(min_row=6, values_only=True) if r[0] in codes and r[2]}


def industrie_non_substituable(codes):
    """Gaz des NAF 20, 23 et 24, tous gestionnaires, moyenne des années renseignées de 2023 à 2025."""
    mwh, pdl, secret = defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(int)), set()
    with open(SRC_CONSO, encoding="utf-8") as fh:   # lire_conso ne garde pas le code NAF
        for r in csv.DictReader(fh):
            c, a = r["Code Commune"].zfill(5), int(r["annee"])
            if (r["CODE GRAND SECTEUR"] != "INDUSTRIE" or r["CODE SECTEUR NAF2"] not in NAF_NON_SUBSTITUABLE
                    or c not in codes or a not in ANNEES_NAF or r["OPERATEUR"] == "Natran"):   # distribution seulement
                continue
            v = float(r["Conso totale (MWh)"] or 0)
            if r["OPERATEUR"] == "Caléo" and a in (2023, 2024):  # même correction que commun.lire_conso
                v *= 1000
            mwh[c][a] += v
            pdl[c][a] += int(float(r["Nb sites"] or 0))
            if int(float(r["nombre_de_mailles_secretisees"] or 0)) > 0 or not r["Conso totale (MWh)"]:
                secret.add(c)
    out = {}
    for c in set(mwh) | set(pdl):
        annees = [a for a in ANNEES_NAF if mwh[c].get(a) or pdl[c].get(a)]
        if annees:
            out[c] = [round(sum(mwh[c][a] for a in annees) / len(annees)), round(sum(pdl[c][a] for a in annees) / len(annees)), int(c in secret)]
    return out


def logements(codes):
    """Résidences principales par combustible et type de chauffage, pondérées par IPONDL."""
    t = defaultdict(lambda: defaultdict(float))
    with zipfile.ZipFile(SRC_LOGEMENTS) as z:
        nom = next(n for n in z.namelist() if n.upper().startswith("FD_LOGEMT"))
        with io.TextIOWrapper(z.open(nom), encoding="latin-1") as fh:
            lecteur = csv.reader(fh, delimiter=";")
            entete = next(lecteur)
            i = {k: entete.index(k) for k in ("COMMUNE", "CATL", "CMBL", "CHFL", "TYPL", "STOCD", "HLML", "IPONDL")}
            for r in lecteur:
                c = r[i["COMMUNE"]]
                if c[:2] not in ("67", "68") or r[i["CATL"]] != "1" or c not in codes:
                    continue
                w, cmbl, chfl, typl = float(r[i["IPONDL"]]), r[i["CMBL"]], r[i["CHFL"]], r[i["TYPL"]]
                proprio, hlm = r[i["STOCD"]] == "10", r[i["HLML"]] == "1"
                s = t[c]
                s["rp"] += w
                s["p"] += w * proprio
                if cmbl == "2":
                    s["g"] += w
                    s["pg"] += w * proprio
                    s["hg"] += w * hlm
                    if typl == "1":
                        s["gm"] += w
                    elif chfl == "1":
                        s["gc"] += w
                    else:
                        s["gi"] += w
                s[{"1": "u", "3": "f", "4": "e"}.get(cmbl, "_")] += w
    out = {}
    for c, s in t.items():
        g = s["g"]
        out[c] = {k: round(s[k]) for k in ("rp", "g", "gm", "gc", "gi", "f", "u", "e")}
        out[c]["p"] = round(100 * s["p"] / s["rp"]) if s["rp"] else None
        out[c]["pg"] = round(100 * s["pg"] / g) if g >= 1 else None
        out[c]["hg"] = round(100 * s["hg"] / g) if g >= 1 else None
    return out


def volumes_par_gestionnaire(codes):
    """Gaz et points de livraison de la dernière année, par commune et gestionnaire de distribution."""
    v = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for r in lire_conso():
        if r["annee"] == ANNEES[-1] and r["commune"] in codes and r["operateur"] != "Natran":
            e = v[r["commune"]][NOMS_GRD.get(r["operateur"], r["operateur"])]
            e[0] += r["mwh"]
            e[1] += r["sites"]
    return v


def longueur(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def lignes_geojson(geom):
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return geom["coordinates"]
    return []


def reseau_ore(codes):
    """Longueur par commune et gestionnaire, et tracé simplifié des réseaux autres que GRDF."""
    km, mp, autres = defaultdict(lambda: defaultdict(float)), defaultdict(float), []
    with gzip.open(SRC_RESEAU_ORE, "rt", encoding="utf-8") as fh:
        for ligne in fh:
            r = json.loads(ligne)
            c, grd = (r["code_insee"] or "").zfill(5), NOMS_GRD.get(r["nom_grd"], r["nom_grd"])
            geom = json.loads(r["geometry"]) if isinstance(r["geometry"], str) else r["geometry"]
            for coords in lignes_geojson(geom):
                pts = [lambert93(lon, lat) for lon, lat in coords]
                m = longueur(pts)
                if c in codes:
                    km[c][grd] += m / 1000
                    if r.get("niveau_de_pression") == "Moyenne pression":
                        mp[c] += m / 1000
                if grd != "GRDF":
                    e = encoder(simplifier(pts))
                    if len(e) >= 4:
                        autres.append(e)
    return ({c: {g: round(v, 1) for g, v in d.items()} for c, d in km.items()},
            {c: round(v, 1) for c, v in mp.items()}, autres)


def natran():
    with open(SRC_NATRAN, encoding="utf-8") as fh:
        feats = json.load(fh)["features"]
    out = []
    for f in feats:
        for coords in lignes_geojson(f["geometry"]):
            e = encoder(simplifier([lambert93(lon, lat) for lon, lat in coords], 50))
            if len(e) >= 4:
                out.append(e)
    return out


def centres(communes):
    """Centre approximatif de chaque commune (centre de l'emprise de son plus grand anneau)."""
    out = {}
    for code, x0, x1, y0, y1, pts in sorted(communes.anneaux, key=lambda a: (a[2] - a[1]) * (a[4] - a[3])):
        out[code] = ((x0 + x1) / 2, (y0 + y1) / 2)
    return out


def dans_anneau(x, y, pts):
    return Communes._dedans(x, y, pts)


def zonages(centre):
    with open(SRC_ZONAGES, encoding="utf-8") as fh:
        feats = json.load(fh)["features"]
    sortie, par_commune = [], {}
    nombre = lambda v: None if v in (None, "", "None", "N.C") or str(v).startswith("[") else float(v)
    for i, f in enumerate(feats):
        p, g = f["properties"], f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        anneaux = [[lambert93(lon, lat) for lon, lat in poly[0]] for poly in polys]
        for code, (x, y) in centre.items():
            if any(dans_anneau(x, y, a) for a in anneaux):
                par_commune[code] = i
        sortie.append({
            "nom": p["libelle"] if p["libelle"] not in (None, "None") else None, "maturite": p["maturite"],
            "couleur": p["isurv"], "projets": nombre(p["nbprojet"]), "projets_txt": p["nbprojet"],
            "attente": nombre(p["capaattent"]), "capamax": nombre(p["capamax"]), "potentiel": nombre(p["potzone"]),
            "cout": p["criteres_technico_economiques"],
            "l": [encoder(simplifier(a, 100)) for a in anneaux],
        })
    return sortie, par_commune


def points_csv(chemin, ligne):
    with open(chemin, encoding="utf-8-sig") as fh:
        return [x for x in (ligne(r) for r in csv.DictReader(fh, delimiter=";")) if x]


def industries(centre):
    def ligne(r):
        c = r["commune"]
        if r["latitude"] and r["longitude"]:
            x, y = lambert93(float(r["longitude"]), float(r["latitude"]))
        elif c in centre:
            x, y = centre[c]
        else:
            return None
        return {"nom": r["nom"], "naf": r["naf"], "c": c, "x": round(x), "y": round(y), "eff": r["effectif_unite_legale"]}
    return points_csv(SRC_INDUSTRIES, ligne)


def rebours():
    def ligne(r):
        lat, lon = (float(v) for v in r["centroid"].split(","))
        x, y = lambert93(lon, lat)
        return {"nom": r["donnees_rebours_nom_du_projet"], "c": r["code_commune"].zfill(5), "x": round(x), "y": round(y),
                "cap": r["capacite_du_rebours_gwh_an"], "mes": r["mes_dpi_agora"], "statut": r["validation_cre"]}
    return points_csv(SRC_REBOURS, ligne)


def injection(centre):
    """Sites du registre que transition.json ne connaît pas (sa source ne couvre que le réseau GRDF)."""
    with open(os.path.join(CARTE_DATA, "transition.json"), encoding="utf-8") as fh:
        connues = {s["c"] for s in json.load(fh)["biomethane"]}
    def ligne(r):
        c = r["code_commune"].zfill(5)
        if c in connues or r["date_de_fermeture_du_site"] or c not in centre:
            return None
        x, y = centre[c]
        return {"nom": r["nom_du_projet"], "c": c, "grd": r["grx_demandeur"], "gwh": float(r["capacite_de_production_gwh_an"] or 0),
                "date": r["date_de_mes"][:4], "x": round(x), "y": round(y)}
    return points_csv(SRC_REGISTRE, ligne)


def projets_epci():
    with open(SRC_PROSPECTIF, encoding="utf-8-sig") as fh:
        return {r["epci_code"]: round(float(r["nb_id_projet"] or 0)) for r in csv.DictReader(fh, delimiter=";")}


def ecrire(nom, data):
    with open(os.path.join(CARTE_DATA, nom), "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    with open(os.path.join(CARTE_DATA, "conso.json"), encoding="utf-8") as fh:
        codes = set(json.load(fh)["meta"])
    communes = Communes()
    centre = centres(communes)
    dens = densite(codes)
    naf = industrie_non_substituable(codes)
    print(f"densité : {len(dens)} communes | industrie non substituable : {len(naf)} communes")
    # les deux sources lourdes ne sont pas versionnées : sans elles, on garde les valeurs déjà produites
    ancien = {}
    if os.path.exists(os.path.join(CARTE_DATA, "cre.json")):
        with open(os.path.join(CARTE_DATA, "cre.json"), encoding="utf-8") as fh:
            ancien = json.load(fh)["communes"]
    garder = lambda cle: {c: v[cle] for c, v in ancien.items() if cle in v}
    if os.path.exists(SRC_LOGEMENTS):
        log = logements(codes)
        print(f"logements : {len(log)} communes")
    else:
        log = garder("log")
        print("RP2022_logemtzc.zip absent (python3 scripts/00_telecharger.py logements) : logements repris de cre.json")
    autres = None
    if os.path.exists(SRC_RESEAU_ORE):
        km, mp, autres = reseau_ore(codes)
        print(f"réseau ORE : {len(km)} communes, {len(autres)} tronçons hors GRDF")
    else:
        km, mp = garder("km"), garder("mp")
        print("ore-infrastructures-gaz-alsace.jsonl.gz absent (python3 scripts/00_telecharger.py reseau_ore) : réseau repris de cre.json")
    vol = volumes_par_gestionnaire(codes)
    zones, zone_de = zonages(centre)
    reb = rebours()
    sortie = {c: {} for c in codes}
    for c in codes:
        e = sortie[c]
        if c in dens: e["d"] = dens[c]
        if c in naf: e["naf"] = naf[c]
        if c in log: e["log"] = log[c]
        if c in km:
            e["km"] = km[c]
            e["op"] = {g: [round(vol[c][g][0]), vol[c][g][1]] for g in km[c] if g in vol.get(c, {})}
        if mp.get(c): e["mp"] = mp[c]
        if c in zone_de: e["z"] = zone_de[c]
        if any(r["c"] == c for r in reb): e["reb"] = 1
    ind = industries(centre)
    inj = injection(centre)
    ecrire("cre.json", {"communes": sortie, "q": Q, "zonages": zones, "industries": ind, "rebours": reb, "injection": inj,
                        "projets_epci": projets_epci()})
    ecrire("natran.json", {"q": Q, "l": natran()})
    if autres is not None:
        ecrire("reseau_autres.json", {"q": Q, "l": autres})
    print(f"zonages : {len(zones)} ({len(zone_de)} communes) | industries : {len(ind)} | rebours : {len(reb)} | sites hors GRDF : {len(inj)}")
