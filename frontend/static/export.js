const tripId = new URLSearchParams(location.search).get("id");
if (!tripId) location.href = "/";

const {
  $,
  api,
  toast,
  escapeHtml,
  CATEGORY_META,
  iconBadge,
  loadSelectedFeatures,
  renderMap,
  downloadElementAsPng,
} = RoadBook;

let trip = null;
let backgroundGeo = null;
let selectedGeo = null;

function renderLegend() {
  $("#posterLegend").innerHTML = Object.keys(CATEGORY_META)
    .map((key) => iconBadge(key))
    .join("");
}

function routeText(day) {
  if (day.route_text) return day.route_text;
  const regions = (day.places || [])
    .map((place) => trip.regions.find((region) => region.adcode === place.region_adcode))
    .filter(Boolean)
    .map((region) => region.name);
  return regions.join(" - ");
}

function renderRows() {
  const rows = $("#posterRows");
  rows.innerHTML = "";
  (trip.itinerary || []).forEach((day, index) => {
    const row = document.createElement("div");
    row.className = "poster-row";
    row.innerHTML = `
      <div>
        <div class="day-title">${escapeHtml(day.title || `DAY${index + 1}`)}</div>
        <div class="day-time">${escapeHtml(day.time || "")}</div>
      </div>
      <div>
        <div class="route-main">${escapeHtml(routeText(day) || "待补充路线")}</div>
        <div class="route-sub">${escapeHtml(day.transport || day.notes || "")}</div>
      </div>
      <div class="visit-list">
        ${(day.places || []).map((place) => `
          <span class="visit-item">
            ${iconBadge(place.category, true)}
            <span class="label">${escapeHtml(place.title || "未命名地点")}</span>
          </span>
        `).join("")}
      </div>
      <div class="stay">${escapeHtml(day.accommodation || "—")}</div>
    `;
    rows.appendChild(row);
  });
}

function renderPoster() {
  $("#posterTitle").textContent = trip.name;
  $("#posterSubtitle").textContent = trip.description || "跨过时间，穿越空间，把每天的行程编成一张地图。";
  document.title = `${trip.name} · 路书`;
  renderLegend();
  renderRows();
  renderMap($("#posterMap"), backgroundGeo, selectedGeo, trip, {
    emptyHint: "还没有区划与行程数据",
  });
}

async function load() {
  const [tripData, bg] = await Promise.all([
    api(`/api/trips/${tripId}`),
    api("/api/map/background"),
  ]);
  trip = tripData;
  backgroundGeo = bg;
  selectedGeo = await loadSelectedFeatures(trip.regions || []);
  $("#editLink").href = `/edit?id=${tripId}`;
  renderPoster();
}

$("#downloadBtn").onclick = async () => {
  try {
    await downloadElementAsPng($("#poster"), `${trip.name || "road-book"}.png`);
    toast("已生成 PNG");
  } catch (err) {
    console.error(err);
    alert(`导出失败：${err.message}`);
  }
};

load().catch((err) => {
  console.error(err);
  alert(`加载失败：${err.message}`);
});
