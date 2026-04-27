const tripId = new URLSearchParams(location.search).get("id");
if (!tripId) location.href = "/";

const { $, api, uid, escapeHtml, toast, CATEGORY_META, iconBadge, loadSelectedFeatures, renderMap } = RoadBook;

let trip = null;
let backgroundGeo = null;
let selectedGeo = { type: "FeatureCollection", features: [] };
let searchTimer = null;

function clearRegionSearch() {
  $("#regionKeyword").value = "";
  renderSearchResults([]);
}

function emptyDay(index = 0) {
  return {
    id: uid("day"),
    title: `DAY${index + 1}`,
    time: "",
    transport: "",
    route_text: "",
    accommodation: "",
    notes: "",
    places: [],
  };
}

function emptyPlace() {
  return {
    id: uid("place"),
    title: "",
    category: "heritage",
    region_adcode: "",
  };
}

async function load() {
  const [tripData, bg] = await Promise.all([
    api(`/api/trips/${tripId}`),
    api("/api/map/background"),
  ]);
  trip = tripData;
  backgroundGeo = bg;
  $("#tripName").textContent = trip.name;
  $("#nameInput").value = trip.name;
  $("#descInput").value = trip.description || "";
  $("#exportLink").href = `/export?id=${tripId}`;
  $("#previewBtn").href = `/export?id=${tripId}`;
  await refreshGeometries();
  render();
}

async function refreshGeometries() {
  selectedGeo = await loadSelectedFeatures(trip.regions || []);
}

function renderLegend() {
  $("#legend").innerHTML = Object.entries(CATEGORY_META)
    .map(([key]) => iconBadge(key))
    .join("");
}

function renderRegions() {
  const wrap = $("#regionChips");
  wrap.innerHTML = "";
  (trip.regions || []).forEach((region) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `
      <span>${escapeHtml(region.name)} · ${escapeHtml(region.level || "")}</span>
      <button data-del="${region.adcode}" title="删除">×</button>
    `;
    wrap.appendChild(chip);
  });
  wrap.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      trip.regions = trip.regions.filter((r) => r.adcode !== btn.dataset.del);
      trip.itinerary.forEach((day) => {
        day.places = day.places.map((place) => {
          if (place.region_adcode === btn.dataset.del) place.region_adcode = "";
          return place;
        });
      });
      if (!trip.regions.length) {
        clearRegionSearch();
      }
      await refreshGeometries();
      render();
    };
  });
}

function renderSearchResults(items) {
  const list = $("#regionResults");
  list.innerHTML = "";
  items.forEach((item) => {
    const el = document.createElement("div");
    el.className = "search-item";
    el.innerHTML = `
      <div class="name">${escapeHtml(item.name)}</div>
      <div class="meta">${escapeHtml(item.full_name)} · ${escapeHtml(item.level)}</div>
    `;
    el.onclick = async () => {
      if (trip.regions.some((r) => r.adcode === item.adcode)) {
        toast("这个区划已经在路书里了");
        return;
      }
      trip.regions.push(item);
      clearRegionSearch();
      await refreshGeometries();
      render();
    };
    list.appendChild(el);
  });
}

function placeOptions(selected) {
  return Object.entries(CATEGORY_META).map(([key, meta]) => `
    <option value="${key}" ${selected === key ? "selected" : ""}>${meta.label}</option>
  `).join("");
}

function regionOptions(selected) {
  const options = [`<option value="">选择所在区划</option>`];
  (trip.regions || []).forEach((region) => {
    options.push(`<option value="${region.adcode}" ${selected === region.adcode ? "selected" : ""}>${escapeHtml(region.name)} · ${escapeHtml(region.level)}</option>`);
  });
  return options.join("");
}

function renderDays() {
  const wrap = $("#dayList");
  wrap.innerHTML = "";
  if (!trip.itinerary.length) {
    wrap.innerHTML = `<div class="hint">还没有行程日，点“新增一天”。</div>`;
    return;
  }

  trip.itinerary.forEach((day, dayIndex) => {
    const card = document.createElement("div");
    card.className = "day-card";
    card.innerHTML = `
      <div class="day-head">
        <strong>${escapeHtml(day.title || `DAY${dayIndex + 1}`)}</strong>
        <div class="inline-actions">
          <button data-add-place="${day.id}">新增地点</button>
          <button class="danger" data-del-day="${day.id}">删除这天</button>
        </div>
      </div>
      <div class="field-grid">
        <input data-field="title" data-day="${day.id}" value="${escapeHtml(day.title || "")}" placeholder="DAY1 / 5月1日 / 第一天">
        <input data-field="time" data-day="${day.id}" value="${escapeHtml(day.time || "")}" placeholder="时间，可选精确到小时">
        <input data-field="transport" data-day="${day.id}" value="${escapeHtml(day.transport || "")}" placeholder="交通：高铁 / 包车 / 航班 CA1234">
        <input data-field="accommodation" data-day="${day.id}" value="${escapeHtml(day.accommodation || "")}" placeholder="住宿">
      </div>
      <div class="field-grid single" style="margin-top:10px">
        <input data-field="route_text" data-day="${day.id}" value="${escapeHtml(day.route_text || "")}" placeholder="行程路线：沈阳-辽阳-义县">
        <textarea data-field="notes" data-day="${day.id}" placeholder="备注：距离、时长、特殊说明">${escapeHtml(day.notes || "")}</textarea>
      </div>
      <div class="places">
        ${(day.places || []).map((place) => `
          <div class="place-row">
            <div class="place-grid">
              <input data-place-field="title" data-place="${place.id}" data-day="${day.id}" value="${escapeHtml(place.title || "")}" placeholder="地点：辽宁博物馆 / 东京陵">
              <select data-place-field="category" data-place="${place.id}" data-day="${day.id}">
                ${placeOptions(place.category)}
              </select>
              <select data-place-field="region_adcode" data-place="${place.id}" data-day="${day.id}">
                ${regionOptions(place.region_adcode)}
              </select>
              <button class="danger" data-del-place="${place.id}" data-day="${day.id}">删除</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    wrap.appendChild(card);
  });

  wrap.querySelectorAll("[data-field]").forEach((input) => {
    input.oninput = () => {
      const day = trip.itinerary.find((item) => item.id === input.dataset.day);
      day[input.dataset.field] = input.value;
      renderMapPreview();
    };
  });
  wrap.querySelectorAll("[data-place-field]").forEach((input) => {
    input.oninput = () => {
      const day = trip.itinerary.find((item) => item.id === input.dataset.day);
      const place = day.places.find((item) => item.id === input.dataset.place);
      place[input.dataset.placeField] = input.value;
      renderMapPreview();
    };
  });
  wrap.querySelectorAll("[data-add-place]").forEach((btn) => {
    btn.onclick = () => {
      const day = trip.itinerary.find((item) => item.id === btn.dataset.addPlace);
      day.places.push(emptyPlace());
      renderDays();
      renderMapPreview();
    };
  });
  wrap.querySelectorAll("[data-del-day]").forEach((btn) => {
    btn.onclick = () => {
      trip.itinerary = trip.itinerary.filter((item) => item.id !== btn.dataset.delDay);
      renderDays();
      renderMapPreview();
    };
  });
  wrap.querySelectorAll("[data-del-place]").forEach((btn) => {
    btn.onclick = () => {
      const day = trip.itinerary.find((item) => item.id === btn.dataset.day);
      day.places = day.places.filter((item) => item.id !== btn.dataset.delPlace);
      renderDays();
      renderMapPreview();
    };
  });
}

function renderMapPreview() {
  renderMap($("#mapPreview"), backgroundGeo, selectedGeo, trip, {
    emptyHint: "先搜索区划并加入路线范围",
  });
}

function render() {
  $("#tripName").textContent = trip.name;
  document.title = `${trip.name} · 编辑路书`;
  if (!$("#regionKeyword").value.trim()) {
    renderSearchResults([]);
  }
  renderLegend();
  renderRegions();
  renderDays();
  renderMapPreview();
}

$("#regionKeyword").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const keyword = $("#regionKeyword").value.trim();
  if (!keyword) {
    renderSearchResults([]);
    return;
  }
  searchTimer = setTimeout(async () => {
    const items = await api(`/api/regions?keyword=${encodeURIComponent(keyword)}`);
    renderSearchResults(items);
  }, 180);
});

$("#addDayBtn").onclick = () => {
  trip.itinerary.push(emptyDay(trip.itinerary.length));
  renderDays();
  renderMapPreview();
};

$("#saveBtn").onclick = async () => {
  trip.name = $("#nameInput").value.trim() || "未命名路书";
  trip.description = $("#descInput").value.trim();
  const saved = await api(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: trip.name,
      description: trip.description,
      regions: trip.regions,
      itinerary: trip.itinerary,
    }),
  });
  trip = saved;
  await refreshGeometries();
  render();
  toast("已保存");
};

load().catch((err) => {
  console.error(err);
  alert(`加载失败：${err.message}`);
});
