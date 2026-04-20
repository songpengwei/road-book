// 编辑页逻辑
const tripId = new URLSearchParams(location.search).get("id");
if (!tripId) { location.href = "/"; }

const $ = (s) => document.querySelector(s);
const api = async (url, opt = {}) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opt });
  if (!r.ok) throw new Error(await r.text());
  return r.status === 204 ? null : r.json();
};
const toast = (msg) => {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1600);
};

let trip = null;
let map, trackLine;
const markers = new Map(); // point_id -> L.Marker
let editing = null;        // 当前编辑的 point

function numIcon(n, active = false) {
  return L.divIcon({
    className: "rb-marker",
    html: `${n}`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// -------- Load --------
async function load() {
  trip = await api(`/api/trips/${tripId}`);
  $("#tripName").textContent = trip.name;
  $("#nameInput").value = trip.name;
  $("#descInput").value = trip.description || "";
  $("#exportLink").href = `/export?id=${tripId}`;
  document.title = `${trip.name} · 路书`;
  renderMap();
  renderList();
}

function renderMap() {
  if (map) return;
  const first = trip.points[0];
  const center = first ? [first.lat, first.lng] : [35.8617, 104.1954]; // 兰州附近，全中国居中
  const zoom = first ? 12 : 4;
  map = L.map("map", { zoomControl: true }).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  }).addTo(map);

  map.on("click", async (e) => {
    const { lng, lat } = e.latlng;
    const p = await api(`/api/trips/${tripId}/points`, {
      method: "POST",
      body: JSON.stringify({ lng, lat, title: "", note: "" }),
    });
    trip.points.push(p);
    addMarker(p);
    renderList();
    redrawTrack();
    openEditPanel(p);
  });

  for (const p of trip.points) addMarker(p);
  redrawTrack();
  if (trip.points.length >= 2) {
    const bounds = L.latLngBounds(trip.points.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }
}

function addMarker(p) {
  const idx = trip.points.findIndex(x => x.id === p.id);
  const m = L.marker([p.lat, p.lng], {
    draggable: true,
    icon: numIcon(idx + 1),
  }).addTo(map);
  m.on("click", () => openEditPanel(p));
  m.on("dragend", async (e) => {
    const { lng, lat } = e.target.getLatLng();
    p.lng = lng; p.lat = lat;
    await api(`/api/points/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ lng, lat, title: p.title, note: p.note }),
    });
    redrawTrack();
    renderList();
  });
  markers.set(p.id, m);
}

function redrawTrack() {
  if (trackLine) map.removeLayer(trackLine);
  if (trip.points.length < 2) return;
  const latlngs = trip.points.map(p => [p.lat, p.lng]);
  trackLine = L.polyline(latlngs, {
    color: "#1a1a1a",
    weight: 3,
    opacity: 0.85,
    dashArray: null,
  }).addTo(map);
}

function renumberMarkers() {
  trip.points.forEach((p, i) => {
    const m = markers.get(p.id);
    if (m) m.setIcon(numIcon(i + 1));
  });
}

// -------- Sidebar list --------
function renderList() {
  const list = $("#pointList");
  list.innerHTML = "";
  if (!trip.points.length) {
    list.innerHTML = `<div class="hint" style="text-align:center;padding:20px 0">点一下地图开始。</div>`;
    return;
  }
  trip.points.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "point-item";
    li.innerHTML = `
      <span class="idx">${i + 1}</span>
      <span class="title">${escapeHtml(p.title || "（未命名）")}</span>
      <div class="coord">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
      <div class="item-actions">
        <button data-up="${p.id}">↑</button>
        <button data-down="${p.id}">↓</button>
        <button data-del="${p.id}" class="danger">✕</button>
      </div>
    `;
    li.onclick = (e) => {
      if (e.target.closest(".item-actions")) return;
      const m = markers.get(p.id);
      if (m) map.panTo(m.getLatLng());
      openEditPanel(p);
    };
    list.appendChild(li);
  });

  list.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("删除这个地点？")) return;
      const id = +b.dataset.del;
      await api(`/api/points/${id}`, { method: "DELETE" });
      const m = markers.get(id);
      if (m) { map.removeLayer(m); markers.delete(id); }
      trip.points = trip.points.filter(p => p.id !== id);
      renumberMarkers();
      redrawTrack();
      renderList();
      closeEditPanel();
    };
  });
  list.querySelectorAll("[data-up]").forEach(b => { b.onclick = (e) => { e.stopPropagation(); move(+b.dataset.up, -1); }; });
  list.querySelectorAll("[data-down]").forEach(b => { b.onclick = (e) => { e.stopPropagation(); move(+b.dataset.down, +1); }; });
}

async function move(pid, delta) {
  const i = trip.points.findIndex(p => p.id === pid);
  const j = i + delta;
  if (j < 0 || j >= trip.points.length) return;
  [trip.points[i], trip.points[j]] = [trip.points[j], trip.points[i]];
  await api(`/api/trips/${tripId}/reorder`, {
    method: "POST",
    body: JSON.stringify({ point_ids: trip.points.map(p => p.id) }),
  });
  renumberMarkers();
  redrawTrack();
  renderList();
}

// -------- Edit panel --------
function openEditPanel(p) {
  editing = p;
  $("#epTitle").value = p.title || "";
  $("#epNote").value = p.note || "";
  $("#epCoord").value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
  $("#editPanel").style.display = "block";
  setTimeout(() => $("#epTitle").focus(), 50);
}
function closeEditPanel() {
  editing = null;
  $("#editPanel").style.display = "none";
}
$("#epCancel").onclick = closeEditPanel;
$("#epSave").onclick = async () => {
  if (!editing) return;
  const title = $("#epTitle").value.trim();
  const note = $("#epNote").value.trim();
  const updated = await api(`/api/points/${editing.id}`, {
    method: "PATCH",
    body: JSON.stringify({ lng: editing.lng, lat: editing.lat, title, note }),
  });
  Object.assign(editing, updated);
  renderList();
  closeEditPanel();
  toast("已保存");
};
// 回车保存
$("#epTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#epSave").click(); });

// -------- Meta save --------
$("#saveMetaBtn").onclick = async () => {
  const name = $("#nameInput").value.trim() || "未命名路书";
  const description = $("#descInput").value;
  await api(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ name, description }),
  });
  trip.name = name; trip.description = description;
  $("#tripName").textContent = name;
  document.title = `${name} · 路书`;
  toast("已保存");
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

load();
