"""Produit carte/data/tea.json : le territoire de TEA pour le filtre de la carte web.

- communes   : codes INSEE des communes de Communes_TEA_INSEE.xlsx
- population : population municipale totale
- serie      : gaz distribué par secteur et par an (MWh), à périmètre constant
- sites      : points de livraison par an, à périmètre constant

Le périmètre constant est celui des chiffres de l'Alsace dans 04_donnees_carte.py : un
gestionnaire d'une commune n'est compté que s'il est présent toutes les années.
Ce script n'a besoin ni de GDAL ni de QGIS, seulement d'openpyxl.
"""
import json
import os
from collections import defaultdict

from openpyxl import load_workbook

from commun import ANNEES, CARTE_DATA, SRC_TEA, lire_conso

SECTEURS = {"RESIDENTIEL": "R", "TERTIAIRE": "T", "INDUSTRIE": "I", "AGRICULTURE": "A", "INCONNU": "A"}


def lire_communes_tea():
    """Fichier des communes de TEA -> {code INSEE: population municipale}."""
    lignes = load_workbook(SRC_TEA, read_only=True, data_only=True).active.iter_rows(values_only=True)
    entetes = next(lignes)
    code = entetes.index("Code INSEE commune")
    population = entetes.index("Population municipale")
    return {str(r[code]).zfill(5): r[population] or 0 for r in lignes if r[code]}


def perimetre_constant(codes=None):
    """Gaz par secteur et points de livraison par an, pour les communes demandées (toutes si None)."""
    volumes = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    sites = defaultdict(lambda: defaultdict(int))
    present = defaultdict(set)
    for r in lire_conso():
        if r["operateur"] == "Natran" or (codes is not None and r["commune"] not in codes):
            continue  # Natran : réseau de transport, hors distribution
        cle, annee = (r["commune"], r["operateur"]), r["annee"]
        volumes[cle][SECTEURS[r["secteur"]]][annee] += r["mwh"]
        sites[cle][annee] += r["sites"]
        if r["mwh"] > 0:  # lignes à 0 = donnée absente (secret statistique)
            present[cle].add(annee)

    serie = {s: [0.0] * len(ANNEES) for s in "RTIA"}
    points = [0] * len(ANNEES)
    for cle, annees in present.items():
        if len(annees) == len(ANNEES):
            for i, annee in enumerate(ANNEES):
                for s in "RTIA":
                    serie[s][i] += volumes[cle][s].get(annee, 0)
                points[i] += sites[cle].get(annee, 0)
    return {s: [round(x) for x in serie[s]] for s in "RTIA"}, points


if __name__ == "__main__":
    communes = lire_communes_tea()
    serie, points = perimetre_constant(set(communes))
    os.makedirs(CARTE_DATA, exist_ok=True)
    with open(os.path.join(CARTE_DATA, "tea.json"), "w", encoding="utf-8") as fh:
        json.dump({"communes": sorted(communes), "population": sum(communes.values()),
                   "serie": serie, "sites": points}, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"communes TEA : {len(communes)} | population : {sum(communes.values())}")
