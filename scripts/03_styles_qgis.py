"""Styles par défaut (stockés dans le GeoPackage) + fichier .qlr à glisser dans QGIS."""
from qgis.core import *

from commun import GPKG, QLR

app = QgsApplication([], False); app.initQgis()

# Consommations : classes en MWh 2025, communes sans donnée en gris clair
conso = QgsVectorLayer(f"{GPKG}|layername=communes_conso_gaz", "Consommation de gaz 2025 (MWh)", "ogr")
bornes = [(-1, 0, "Pas de donnée"), (0, 1000, "< 1 000"), (1000, 5000, "1 000 – 5 000"),
          (5000, 20000, "5 000 – 20 000"), (20000, 100000, "20 000 – 100 000"),
          (100000, 500000, "100 000 – 500 000"), (500000, 1e8, "> 500 000")]
couleurs = ["#e8e8e8", "#fff5eb", "#fdd0a2", "#fdae6b", "#f16913", "#d94801", "#7f2704"]
ranges = []
for (lo, hi, lab), col in zip(bornes, couleurs):
    s = QgsFillSymbol.createSimple({"color": col, "outline_color": "#ffffff", "outline_width": "0.15"})
    ranges.append(QgsRendererRange(lo, hi, s, lab))
r = QgsGraduatedSymbolRenderer('coalesce("gaz_mwh_2025", -0.5)', ranges)
conso.setRenderer(r)
conso.setOpacity(0.85)
conso.setMapTipTemplate('<b>[% "nom" %]</b><br>Gaz 2025 : [% format_number("gaz_mwh_2025",0) %] MWh'
                        '<br>Réseau GRDF : [% format_number("reseau_grdf_km",1) %] km')
conso.saveStyleToDatabaseV2("defaut", "Consommation de gaz 2025", True, "")

# Réseau : trait bleu foncé fin
res = QgsVectorLayer(f"{GPKG}|layername=reseau_grdf", "Réseau GRDF en service", "ogr")
res.setRenderer(QgsSingleSymbolRenderer(QgsLineSymbol.createSimple(
    {"line_color": "#08306b", "line_width": "0.3", "capstyle": "round"})))
res.saveStyleToDatabaseV2("defaut", "Réseau GRDF", True, "")

# Fichier .qlr : groupe avec réseau au-dessus des consommations
prj = QgsProject.instance()
prj.addMapLayers([res, conso], False)
grp = prj.layerTreeRoot().addGroup("Gaz – réseau et consommations")
grp.addLayer(res); grp.addLayer(conso)
ok, err = QgsLayerDefinition.exportLayerDefinition(QLR, [grp])
print("fichier de couches QGIS :", QLR if ok else err)
app.exitQgis()
