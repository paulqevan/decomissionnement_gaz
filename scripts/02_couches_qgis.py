"""Ajoute au GeoPackage le réseau GRDF (lignes) et les consommations de gaz par commune."""
from collections import defaultdict
from osgeo import ogr, osr

from commun import ANNEES, GPKG, lire_conso, lire_reseau

ogr.UseExceptions()
wgs84 = osr.SpatialReference(); wgs84.ImportFromEPSG(4326)
wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
l93 = osr.SpatialReference(); l93.ImportFromEPSG(2154)
l93.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
vers_l93 = osr.CoordinateTransformation(wgs84, l93)

ds = ogr.Open(GPKG, 1)
for name in ("reseau_grdf", "communes_conso_gaz"):
    if ds.GetLayerByName(name):
        ds.DeleteLayer(name)

# --- Réseau GRDF ---------------------------------------------------------
lyr = ds.CreateLayer("reseau_grdf", l93, ogr.wkbLineString, ["GEOMETRY_NAME=geom", "FID=fid"])
for f, t in [("etat_serv", ogr.OFTString), ("code_insee", ogr.OFTString),
             ("nom_commune", ogr.OFTString), ("departement", ogr.OFTString),
             ("longueur_m", ogr.OFTReal)]:
    lyr.CreateField(ogr.FieldDefn(f, t))
km_par_commune = defaultdict(float)
ds.StartTransaction()
for r in lire_reseau():
    g = ogr.CreateGeometryFromJson(r["geojson"])
    g.Transform(vers_l93)
    L = g.Length()
    km_par_commune[r["code_insee"]] += L / 1000
    f = ogr.Feature(lyr.GetLayerDefn())
    f.SetGeometry(g)
    f["etat_serv"], f["code_insee"] = r["etat"], r["code_insee"]
    f["nom_commune"], f["departement"] = r["nom"], r["departement"]
    f["longueur_m"] = round(L, 1)
    lyr.CreateFeature(f)
ds.CommitTransaction()

# --- Consommations de gaz par commune -------------------------------------
# gaz distribué (hors Natran, réseau de transport) ; le transport a son propre champ
DERNIERE = ANNEES[-1]
SECTEURS = {"RESIDENTIEL": "res", "TERTIAIRE": "ter", "INDUSTRIE": "ind",
            "AGRICULTURE": "agr", "INCONNU": "inc"}
tot = defaultdict(lambda: defaultdict(float))
sect = defaultdict(lambda: defaultdict(float))
sites = defaultdict(int)
transport = defaultdict(float)
ops = defaultdict(set)
grdf_mwh = defaultdict(lambda: defaultdict(float))   # gaz GRDF, rapporté au réseau GRDF
grdf_sites = defaultdict(lambda: defaultdict(int))
for r in lire_conso():
    c, a = r["commune"], r["annee"]
    if r["operateur"] == "Natran":
        if a == DERNIERE:
            transport[c] += r["mwh"]
        continue
    tot[c][a] += r["mwh"]
    if a == DERNIERE:
        sect[c][SECTEURS[r["secteur"]]] += r["mwh"]
        sites[c] += r["sites"]
    ops[c].add(r["operateur"])
    if r["operateur"] == "GRDF":
        grdf_mwh[c][a] += r["mwh"]
        grdf_sites[c][a] += r["sites"]

com = ds.GetLayerByName("communes")
out = ds.CreateLayer("communes_conso_gaz", com.GetSpatialRef(), ogr.wkbMultiPolygon,
                     ["GEOMETRY_NAME=geom", "FID=fid"])
fields = [("code", ogr.OFTString), ("nom", ogr.OFTString), ("departement", ogr.OFTString)]
fields += [(f"gaz_mwh_{a}", ogr.OFTReal) for a in ANNEES]
fields += [(f"gaz_{s}_mwh_{DERNIERE}", ogr.OFTReal) for s in SECTEURS.values()]
fields += [(f"nb_sites_{DERNIERE}", ogr.OFTInteger), (f"transport_mwh_{DERNIERE}", ogr.OFTReal),
           ("operateurs", ogr.OFTString), ("reseau_grdf_km", ogr.OFTReal),
           ("surface_km2", ogr.OFTReal), (f"gaz_mwh_km2_{DERNIERE}", ogr.OFTReal)]
# indicateurs du réseau GRDF : volumes et points de livraison GRDF seulement
fields += [(f"densite_mwh_m_{a}", ogr.OFTReal) for a in ANNEES]
fields += [(f"m_reseau_par_client_{a}", ogr.OFTReal) for a in ANNEES]
for n, t in fields:
    out.CreateField(ogr.FieldDefn(n, t))
ds.StartTransaction()
for cf in com:
    c = cf["code"]
    f = ogr.Feature(out.GetLayerDefn())
    g = cf.GetGeometryRef().Clone()
    f.SetGeometry(g)
    f["code"], f["nom"], f["departement"] = c, cf["nom"], cf["departement"]
    if c in tot:
        for a in ANNEES:
            if a in tot[c]:
                f[f"gaz_mwh_{a}"] = round(tot[c][a], 1)
        for s in SECTEURS.values():
            f[f"gaz_{s}_mwh_{DERNIERE}"] = round(sect[c].get(s, 0), 1)
        f[f"nb_sites_{DERNIERE}"] = sites[c]
        f["operateurs"] = ", ".join(sorted(ops[c]))
    if c in transport:
        f[f"transport_mwh_{DERNIERE}"] = round(transport[c], 1)
    if c in km_par_commune:
        km = km_par_commune[c]
        f["reseau_grdf_km"] = round(km, 2)
        for a in ANNEES:
            if km > 0.5 and grdf_mwh[c].get(a, 0) > 0:
                f[f"densite_mwh_m_{a}"] = round(grdf_mwh[c][a] / (km * 1000), 3)
                if grdf_sites[c][a]:
                    f[f"m_reseau_par_client_{a}"] = round(km * 1000 / grdf_sites[c][a], 1)
    km2 = g.GetArea() / 1e6
    f["surface_km2"] = round(km2, 2)
    if DERNIERE in tot.get(c, {}):
        f[f"gaz_mwh_km2_{DERNIERE}"] = round(tot[c][DERNIERE] / km2, 1)
    out.CreateFeature(f)
ds.CommitTransaction()
print("tronçons :", lyr.GetFeatureCount(), "| communes :", out.GetFeatureCount(),
      "| avec gaz distribué :", len(tot))
ds = None
