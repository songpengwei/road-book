"""行政区搜索与边界缓存。"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List
from urllib.request import urlopen

from db import DATA_DIR

CACHE_DIR = DATA_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)

ADMIN_INDEX_URL = (
    "https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/"
    "master/dist/pcas-code.json"
)
PROVINCE_BOUNDARY_URL = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"
BOUNDARY_URL_TEMPLATE = "https://geo.datav.aliyun.com/areas_v3/bound/{adcode}.json"

GENERIC_CITY_NAMES = {
    "市辖区",
    "县",
    "自治区直辖县级行政区划",
    "省直辖县级行政区划",
    "自治区直辖县级行政单位",
}


def _fetch_json(url: str, cache_path: Path):
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    with urlopen(url, timeout=30) as resp:
        payload = resp.read().decode("utf-8")
    cache_path.write_text(payload, encoding="utf-8")
    return json.loads(payload)


def _normalize_code(raw_code: str, level: str) -> str:
    code = str(raw_code)
    if level == "province":
        return code[:2] + "0000"
    if level == "city":
        return code[:4] + "00"
    return code[:6]


def _flat_entry(name: str, code: str, level: str, parents: List[str]) -> Dict:
    full_parts = [p for p in parents if p]
    if not (level == "city" and name in GENERIC_CITY_NAMES):
        full_parts.append(name)
    full_name = " / ".join(full_parts) if full_parts else name
    return {
        "adcode": _normalize_code(code, level),
        "name": name,
        "level": level,
        "parents": parents,
        "full_name": full_name or name,
        "search_text": f"{name} {' '.join(full_parts)}".lower(),
    }


@lru_cache(maxsize=1)
def load_admin_index() -> List[Dict]:
    raw = _fetch_json(ADMIN_INDEX_URL, CACHE_DIR / "pcas-code.json")
    items: List[Dict] = []
    for province in raw:
        p_name = province["name"]
        items.append(_flat_entry(p_name, province["code"], "province", []))
        for city in province.get("children", []):
            c_name = city["name"]
            city_parents = [p_name]
            items.append(_flat_entry(c_name, city["code"], "city", city_parents))
            for district in city.get("children", []):
                d_name = district["name"]
                district_parents = [p_name]
                if c_name not in GENERIC_CITY_NAMES:
                    district_parents.append(c_name)
                items.append(_flat_entry(d_name, district["code"], "district", district_parents))
    deduped: Dict[str, Dict] = {}
    for item in items:
        deduped[f"{item['adcode']}:{item['level']}"] = item
    return list(deduped.values())


def search_regions(keyword: str, limit: int = 20) -> List[Dict]:
    q = keyword.strip().lower()
    if not q:
        return []
    results = []
    for item in load_admin_index():
        name = item["name"].lower()
        full_name = item["full_name"].lower()
        if q not in name and q not in full_name:
            continue
        score = 0
        if name == q:
            score += 120
        elif name.startswith(q):
            score += 80
        elif q in name:
            score += 50
        elif full_name.startswith(q):
            score += 25
        elif q in full_name:
            score += 10
        score += {"district": 3, "city": 2, "province": 1}.get(item["level"], 0)
        results.append((score, item))
    results.sort(key=lambda x: (-x[0], len(x[1]["full_name"]), x[1]["adcode"]))
    return [item for _, item in results[:limit]]


@lru_cache(maxsize=1)
def load_province_boundaries() -> Dict:
    return _fetch_json(PROVINCE_BOUNDARY_URL, CACHE_DIR / "bound_100000_full.json")


def load_boundary(adcode: str) -> Dict:
    code = str(adcode)
    cache_path = CACHE_DIR / f"bound_{code}.json"
    data = _fetch_json(BOUNDARY_URL_TEMPLATE.format(adcode=code), cache_path)
    if data.get("type") == "FeatureCollection":
        if not data.get("features"):
            raise ValueError(f"adcode={code} 没有边界数据")
        feature = data["features"][0]
    else:
        feature = data
    props = dict(feature.get("properties") or {})
    props["adcode"] = str(props.get("adcode") or code)
    feature["properties"] = props
    return feature
