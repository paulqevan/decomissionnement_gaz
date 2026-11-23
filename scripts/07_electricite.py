"""Produit carte/data/electricite.json : électricité et logements par commune, et carte/data/epci.json.

electricite.json
- communes : code INSEE -> r (résidentiel, MWh par an), t (tous secteurs, MWh par an),
             hab, coll (% de logements collectifs), chauf (% de chauffage électrique),
             avant71 (% de logements construits avant 1971)
- dju      : degrés-jours par an, moyenne des communes renseignées toutes les années
epci.json  : code EPCI -> nom court, communes, gaz par secteur et points de livraison (périmètre constant)

L'électricité est comptée hors réseau de transport (RTE). Une année est écartée (null) quand le
nombre de sites résidentiels d'un gestionnaire saute d'une année à l'autre : c'est une rupture de
série, pas une évolution réelle. Ce script n'a besoin ni de GDAL ni de QGIS.
"""
import csv
import importlib
import json
import os
import statistics
from collections import defaultdict

from commun import ANNEES, CARTE_DATA, SRC_ELEC, lire_conso

ANNEE_PIVOT = 2022                    # année stable chez tous les gestionnaires
SAUT_MAX, SAUT_MIN_SITES = 0.05, 10   # au-delà de ces deux écarts d'une année à l'autre : rupture


def nombre(texte):
    return float(texte) if texte else 0.0


def nom_court(nom):
    return nom.replace("Communauté de communes", "CC").replace("Communauté d'agglomération", "CA")


def lire_electricite():
    with open(SRC_ELEC, encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            r["commune"] = r["Code Commune"].zfill(5)
            r["annee"] = int(r["annee"])
            if r["OPERATEUR"] != "RTE" and r["annee"] in ANNEES and r["Nom Commune"]:
                yield r


def ruptures(sites):
    """{(commune, gestionnaire): {année: sites}} -> {commune: années à écarter}."""
    ecartees = defaultdict(set)
    avant = [a for a in reversed(ANNEES) if a < ANNEE_PIVOT]
    apres = [a for a in ANNEES if a > ANNEE_PIVOT]
    for (commune, _), par_annee in sites.items():
        for sens in (avant, apres):  # on s'éloigne de l'année pivot, année après année
            voisin = par_annee.get(ANNEE_PIVOT)
            for a in sens:
                valeur = par_annee.get(a, 0)
                if voisin and abs(valeur - voisin) > max(SAUT_MAX * voisin, SAUT_MIN_SITES):
                    ecartees[commune].add(a)
                elif valeur:
                    voisin = valeur
    return ecartees


def electricite(codes):
    residentiel, tous = defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(float))
    sites = defaultdict(lambda: defaultdict(float))
    logement, dju, epci = {}, defaultdict(dict), {}
    for r in lire_electricite():
        c, a = r["commune"], r["annee"]
        if c not in codes:
            continue
        epci[c] = (r["Code EPCI"], nom_court(r["Nom EPCI"]))
        tous[c][a] += nombre(r["Conso totale (MWh)"])
        if r["CODE GRAND SECTEUR"] != "RESIDENTIEL":
            continue
        residentiel[c][a] += nombre(r["Conso totale (MWh)"])
        sites[(c, r["OPERATEUR"])][a] += nombre(r["Nb sites"])
        if r["DJU à TR"]:
            dju[c][a] = nombre(r["DJU à TR"])
        if a == ANNEES[-1] and r["Taux de logements collectifs"]:
            anciens = sum(nombre(r[f"Résidences principales {p}"]) for p in ("avant 1919", "de 1919 à 1945", "de 1946 à 1970"))
            recents = sum(nombre(r[f"Résidences principales {p}"]) for p in ("de 1971 à 1990", "de 1991 à 2005", "de 2006 à 2018", "après 2019"))
            logement[c] = {
                "hab": round(nombre(r["nombre_d_habitants"])), "coll": round(100 * nombre(r["Taux de logements collectifs"])),
                "chauf": round(100 * nombre(r["Taux de chauffage électrique"])),
                "avant71": round(100 * anciens / (anciens + recents)) if anciens + recents else None,
            }
    ecartees = ruptures(sites)
    communes = {}
    for c in tous:
        communes[c] = {
            "r": [round(residentiel[c][a]) if residentiel[c].get(a) and a not in ecartees[c] else None for a in ANNEES],
            "t": [round(tous[c][a]) if tous[c].get(a) else None for a in ANNEES],
            **logement.get(c, {}),
        }
    completes = [v for v in dju.values() if all(a in v for a in ANNEES)]
    degres = [round(statistics.mean(v[a] for v in completes)) if completes else None for a in ANNEES]
    print(f"années écartées : {sum(len(v) for v in ecartees.values())} sur {len(communes)} communes")
    return communes, degres, epci


def territoires_epci(epci):
    perimetre = importlib.import_module("05_territoire_tea").perimetre_constant
    lignes = list(lire_conso())
    groupes = defaultdict(list)
    for c, (code, nom) in epci.items():
        groupes[(code, nom)].append(c)
    return {code: dict(zip(("serie", "sites"), perimetre(set(cs), lignes)), nom=nom, communes=sorted(cs))
            for (code, nom), cs in groupes.items() if code}


if __name__ == "__main__":
    with open(os.path.join(CARTE_DATA, "conso.json"), encoding="utf-8") as fh:
        meta = json.load(fh)["meta"]
    communes, degres, epci = electricite(set(meta))
    sortie = {"communes": communes, "dju": degres}
    with open(os.path.join(CARTE_DATA, "electricite.json"), "w", encoding="utf-8") as fh:
        json.dump(sortie, fh, separators=(",", ":"), ensure_ascii=False)
    groupes = territoires_epci(epci)
    with open(os.path.join(CARTE_DATA, "epci.json"), "w", encoding="utf-8") as fh:
        json.dump(groupes, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"communes : {len(communes)} | EPCI : {len(groupes)} | degrés-jours : {degres}")
