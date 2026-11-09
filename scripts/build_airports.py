"""Build a compact airports.json for the sim from OurAirports airports.csv (public domain).

Usage: python3 -I build_airports.py <airports.csv> <out.json>
Keeps large + medium airports and small ones with scheduled service, i.e. anything an
FR24 flight is likely to originate from or go to.
"""
import csv
import json
import sys

src, dst = sys.argv[1], sys.argv[2]
SIZE = {"large_airport": 3, "medium_airport": 2, "small_airport": 1}
rows = []
with open(src, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        size = SIZE.get(r["type"])
        if not size:
            continue
        gps = r["gps_code"]
        icao = r["icao_code"] or (gps if len(gps) == 4 and gps.isalpha() else "")
        iata = r["iata_code"]
        if size == 1 and not (iata and r["scheduled_service"] == "yes"):
            continue
        if not (icao or iata):
            continue
        try:
            lat, lon = round(float(r["latitude_deg"]), 4), round(float(r["longitude_deg"]), 4)
        except ValueError:
            continue
        elev = int(float(r["elevation_ft"])) if r["elevation_ft"] else 0
        rows.append([icao, iata, r["name"][:60], lat, lon, elev, r["municipality"][:40], r["iso_country"], size])

out = {
    "source": "OurAirports (https://ourairports.com/data/), released to the public domain",
    "fields": ["icao", "iata", "name", "lat", "lon", "elev_ft", "city", "country", "size"],
    "rows": rows,
}
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
print(len(rows), "airports")
