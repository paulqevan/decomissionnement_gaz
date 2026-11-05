# Environnement de construction : QGIS (PyQGIS, qgis_process, GRASS) et GDAL pour Python.
# Sert uniquement à ./construire.sh ; la carte web n'en a pas besoin (voir compose.yaml).
FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://download.qgis.org/downloads/qgis-archive-keyring.gpg -o /etc/apt/keyrings/qgis-archive-keyring.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/qgis-archive-keyring.gpg] https://qgis.org/debian resolute main" > /etc/apt/sources.list.d/qgis.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends qgis qgis-plugin-grass python3-qgis python3-gdal \
 && rm -rf /var/lib/apt/lists/*

# qgis_process et PyQGIS écrivent un profil utilisateur : on le garde hors du projet
ENV HOME=/tmp QT_QPA_PLATFORM=offscreen LANG=C.UTF-8
WORKDIR /projet
CMD ["./construire.sh"]
