"""Crée ou met à jour la couche des communes du Bas-Rhin et du Haut-Rhin (Lambert-93).

Le GeoPackage n'est jamais supprimé : seules les couches générées sont remplacées, si bien que
les projets QGIS qui l'utilisent (et les styles qu'on y a enregistrés) restent valides.
"""
import os
from osgeo import gdal

from commun import DEPARTEMENTS, GPKG, SRC_COMMUNES

gdal.UseExceptions()
os.makedirs(os.path.dirname(GPKG), exist_ok=True)

deps = ",".join(f"'{d}'" for d in DEPARTEMENTS)
gdal.VectorTranslate(
    GPKG, "/vsigzip/" + SRC_COMMUNES, format="GPKG", layerName="communes",
    dstSRS="EPSG:2154", geometryType="MULTIPOLYGON",
    where=f"departement IN ({deps})", selectFields=["code", "nom", "departement", "epci"],
    layerCreationOptions=["GEOMETRY_NAME=geom", "FID=fid"],
    accessMode="overwrite" if os.path.exists(GPKG) else None,
)
ds = gdal.OpenEx(GPKG)
print("communes :", ds.GetLayer("communes").GetFeatureCount())
