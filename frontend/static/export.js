// 导出页逻辑
const tripId = new URLSearchParams(location.search).get("id");
if (!tripId) { location.href = "/"; }

const $ = (s) => document.querySelector(s);
const toast = (msg) => {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
};
const api = async (url, opt = {}) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opt });
  if (!r.ok) throw new Error(await r.text());
  return r.status === 204 ? null : r.json();
};

let trip = null;
let baseFile = null;          // 上传的 File
let baseImgNaturalW = 0;      // 底图自然像素宽
let baseImgNaturalH = 0;
let controlPoints = [];       // [{x,y,lng,lat}]  x,y 为底图原始像素坐标
let pendingCtrl = null;       // {x,y} 等待关联经纬度

let geoMap;

async function load() {
  trip = await api(`/api/trips/${tripId}`);
  $("#tripName").textContent = `${trip.name} · 导出`;
  $("#editLink").href = `/edit?id=${tripId}`;
  document.title = `导出 ${trip.name} · 路书`;
  initGeoMap();
}

function initGeoMap() {
  const first = trip.points[0];
  const center = first ? [first.lat, first.lng] : [35.8617, 104.1954];
  const zoom = first ? 10 : 4;
  geoMap = L.map("geoMap").setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  }).addTo(geoMap);

  // 把路书的点展示出来（帮助用户在真实地图上定位）
  trip.points.forEach((p, i) => {
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: "rb-marker",
        html: `${i + 1}`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).bindTooltip(p.title || "（未命名）", { direction: "top" }).addTo(geoMap);
  });
  if (trip.points.length >= 2) {
    geoMap.fitBounds(L.latLngBounds(trip.points.map(p => [p.lat, p.lng])), { padding: [30, 30] });
  }

  geoMap.on("click", (e) => {
    if (!pendingCtrl) {
      toast("先在上方底图上点一个位置");
      return;
    }
    const { lng, lat } = e.latlng;
    controlPoints.push({ ...pendingCtrl, lng, lat });
    pendingCtrl = null;
    $("#pendingHint").style.display = "none";
    renderCtrlList();
    updateExportButton();
    toast(`已添加控制点 #${controlPoints.length}`);
  });
}

// ---- Upload base image ----
$("#fileInput").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  baseFile = f;
  const url = URL.createObjectURL(f);
  const img = $("#baseImage");
  img.onload = () => {
    baseImgNaturalW = img.naturalWidth;
    baseImgNaturalH = img.naturalHeight;
    $("#emptyBase").style.display = "none";
    img.style.display = "block";
    $("#baseClickCatcher").style.display = "block";
    positionCatcher();
    // 清空已有控制点
    controlPoints = [];
    pendingCtrl = null;
    renderCtrlList();
    updateExportButton();
  };
  img.src = url;
};

function positionCatcher() {
  const img = $("#baseImage");
  const catcher = $("#baseClickCatcher");
  catcher.style.width = img.clientWidth + "px";
  catcher.style.height = img.clientHeight + "px";
  catcher.style.left = img.offsetLeft + "px";
  catcher.style.top = img.offsetTop + "px";
  // 重新绘制已有控制点（因为 DOM 尺寸可能变了）
  renderCtrlList();
}
window.addEventListener("resize", positionCatcher);

$("#baseClickCatcher").onclick = (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width;
  const relY = (e.clientY - rect.top) / rect.height;
  const x = relX * baseImgNaturalW;
  const y = relY * baseImgNaturalH;
  pendingCtrl = { x, y };
  $("#pendingHint").style.display = "block";
  renderCtrlList();
};

// ---- Render control points ----
function renderCtrlList() {
  // 列表
  const list = $("#ctrlList");
  list.innerHTML = "";
  controlPoints.forEach((c, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="cidx">${i + 1}</span>
      <span class="coord">${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</span>
      <button data-del="${i}" class="danger">✕</button>
    `;
    list.appendChild(li);
  });
  list.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = () => {
      controlPoints.splice(+b.dataset.del, 1);
      renderCtrlList();
      updateExportButton();
    };
  });

  // 底图上的圆点
  // 清掉旧的
  $("#baseImageWrap").querySelectorAll(".ctrl-dot").forEach(n => n.remove());
  const img = $("#baseImage");
  if (img.style.display === "none" || !baseImgNaturalW) return;
  const sx = img.clientWidth / baseImgNaturalW;
  const sy = img.clientHeight / baseImgNaturalH;

  const drawDot = (c, i, pending = false) => {
    const el = document.createElement("div");
    el.className = "ctrl-dot" + (pending ? " pending" : "");
    el.textContent = pending ? "?" : (i + 1);
    el.style.left = (img.offsetLeft + c.x * sx) + "px";
    el.style.top = (img.offsetTop + c.y * sy) + "px";
    $("#baseImageWrap").appendChild(el);
  };
  controlPoints.forEach((c, i) => drawDot(c, i, false));
  if (pendingCtrl) drawDot(pendingCtrl, -1, true);
}

function updateExportButton() {
  const n = controlPoints.length;
  const btn = $("#exportBtn");
  const hint = $("#exportHint");
  if (!baseFile) {
    btn.disabled = true;
    hint.textContent = "先上传底图。";
  } else if (n < 2) {
    btn.disabled = true;
    hint.textContent = `还需要 ${2 - n} 个控制点（建议 ≥3）。`;
  } else if (n < 3) {
    btn.disabled = false;
    hint.textContent = "2 个点会做等比缩放叠加，有旋转/透视会不准。再加一个更好。";
  } else {
    btn.disabled = false;
    hint.textContent = `${n} 个控制点，就绪。`;
  }
}

// ---- Export ----
$("#exportBtn").onclick = async () => {
  const btn = $("#exportBtn");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "渲染中…";

  try {
    const fd = new FormData();
    fd.append("image", baseFile);
    fd.append("control_points", JSON.stringify(controlPoints));
    fd.append("show_track", $("#showTrack").checked ? "true" : "false");
    const r = await fetch(`/api/trips/${tripId}/export`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${trip.name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("导出完成");
  } catch (e) {
    console.error(e);
    alert("导出失败：" + e.message);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
};

load();
