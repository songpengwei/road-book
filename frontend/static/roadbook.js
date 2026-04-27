window.RoadBook = (() => {
  const $ = (s, root = document) => root.querySelector(s);
  const api = async (url, opt = {}) => {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...opt,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.status === 204 ? null : response.json();
  };

  const CATEGORY_META = {
    airport: { label: "机场", color: "#df4b3f", symbol: "✈" },
    hotel: { label: "酒店", color: "#e39a2c", symbol: "⌂" },
    heritage: { label: "国保", color: "#2f8fdc", symbol: "碑" },
    museum: { label: "博物馆", color: "#4ea99c", symbol: "馆" },
    park: { label: "公园", color: "#62a44d", symbol: "园" },
    food: { label: "小吃街", color: "#d16c3f", symbol: "食" },
    temple: { label: "古建", color: "#8c6ad9", symbol: "寺" },
    oldtown: { label: "古城", color: "#566573", symbol: "城" },
  };

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
    }[c]));
  }

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1800);
  }

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function iconBadge(category, compact = false) {
    const meta = CATEGORY_META[category] || CATEGORY_META.heritage;
    return `
      <span class="icon-badge${compact ? " compact" : ""}" style="--badge:${meta.color}">
        <span class="symbol">${meta.symbol}</span>
        ${compact ? "" : `<span class="text">${meta.label}</span>`}
      </span>
    `;
  }

  async function loadSelectedFeatures(regions) {
    if (!regions.length) return { type: "FeatureCollection", features: [] };
    const adcodes = regions.map((r) => r.adcode).join(",");
    return api(`/api/regions/geometry?adcodes=${encodeURIComponent(adcodes)}`);
  }

  function collectPlaceStops(trip) {
    const regionMap = new Map((trip.regions || []).map((r) => [r.adcode, r]));
    const stops = [];
    (trip.itinerary || []).forEach((day, dayIndex) => {
      (day.places || []).forEach((place, placeIndex) => {
        const region = regionMap.get(place.region_adcode);
        if (!region) return;
        stops.push({
          dayIndex,
          placeIndex,
          title: place.title || region.name,
          category: place.category || "heritage",
          region,
        });
      });
    });
    return stops;
  }

  function computeProjectedCenters(features, path) {
    const result = new Map();
    features.forEach((feature) => {
      const centroid = path.centroid(feature);
      result.set(String(feature.properties.adcode), centroid);
    });
    return result;
  }

  function renderMap(container, backgroundGeo, selectedGeo, trip, opts = {}) {
    const width = Math.max(container.clientWidth || 900, 320);
    const height = Math.max(container.clientHeight || 520, 240);
    container.innerHTML = "";

    const selectedFeatures = (selectedGeo?.features || []).filter(Boolean);
    const projection = d3.geoMercator();
    projection.preclip((stream) => stream);
    projection.fitExtent([[28, 28], [width - 28, height - 28]], backgroundGeo);
    const path = d3.geoPath(projection);

    const shell = d3.create("div").attr("class", "rb-map-shell");
    const svg = shell.append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("class", "rb-map-svg");
    svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "#f7f4ee");
    const scene = svg.append("g").attr("class", "rb-map-scene");

    scene.append("g")
      .selectAll("path")
      .data(backgroundGeo.features || [])
      .join("path")
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", "#d1d4d4")
      .attr("stroke-width", 1.6)
      .attr("stroke-dasharray", "7 7");

    scene.append("g")
      .selectAll("path")
      .data(selectedFeatures)
      .join("path")
      .attr("d", path)
      .attr("fill", "rgba(94, 191, 187, 0.12)")
      .attr("stroke", "#aab0b4")
      .attr("stroke-width", 2.4)
      .attr("stroke-dasharray", "8 6")
      .attr("stroke-linejoin", "round");

    const centers = computeProjectedCenters(selectedFeatures, path);
    scene.append("g")
      .selectAll("text")
      .data(selectedFeatures)
      .join("text")
      .attr("x", (d) => (centers.get(String(d.properties.adcode)) || [0, 0])[0])
      .attr("y", (d) => (centers.get(String(d.properties.adcode)) || [0, 0])[1])
      .attr("text-anchor", "middle")
      .attr("fill", "#bfc3c5")
      .attr("font-size", 14)
      .attr("font-weight", 600)
      .text((d) => d.properties.name || "");

    const stops = collectPlaceStops(trip);
    const routePoints = stops
      .map((stop) => centers.get(stop.region.adcode))
      .filter(Boolean);

    if (routePoints.length > 1) {
      const line = d3.line().curve(d3.curveCatmullRom.alpha(0.6));
      scene.append("path")
        .attr("d", line(routePoints))
        .attr("fill", "none")
        .attr("stroke", "#d84545")
        .attr("stroke-width", 4)
        .attr("stroke-linecap", "round")
        .attr("stroke-dasharray", "1 11");
    }

    const labels = scene.append("g");
    stops.forEach((stop, index) => {
      const point = centers.get(stop.region.adcode);
      if (!point) return;
      const meta = CATEGORY_META[stop.category] || CATEGORY_META.heritage;
      const [x, y] = point;
      const dx = (index % 3) * 14 - 14;
      const dy = (index % 2 === 0 ? -1 : 1) * (18 + (index % 4) * 6);
      labels.append("circle")
        .attr("cx", x)
        .attr("cy", y)
        .attr("r", 10)
        .attr("fill", meta.color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 3);
      labels.append("text")
        .attr("x", x)
        .attr("y", y + 4)
        .attr("text-anchor", "middle")
        .attr("fill", "#fff")
        .attr("font-size", 11)
        .attr("font-weight", 700)
        .text(meta.symbol);

      const label = labels.append("g").attr("transform", `translate(${x + dx + 14}, ${y + dy})`);
      const title = stop.title || stop.region.name;
      const text = label.append("text")
        .attr("fill", "#fff")
        .attr("font-size", 13)
        .attr("font-weight", 700)
        .attr("x", 12)
        .attr("y", 18)
        .text(title);
      const bbox = text.node().getBBox();
      label.insert("rect", "text")
        .attr("width", bbox.width + 24)
        .attr("height", 28)
        .attr("rx", 14)
        .attr("fill", meta.color)
        .attr("opacity", 0.96);
    });

    if (opts.emptyHint && !selectedFeatures.length) {
      svg.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#9aa0a6")
        .attr("font-size", 20)
        .text(opts.emptyHint);
    }

    const zoom = d3.zoom()
      .scaleExtent([1, 40])
      .on("zoom", (event) => {
        scene.attr("transform", event.transform);
      });
    svg.call(zoom);

    function fitTransform(geojson) {
      const bounds = path.bounds(geojson);
      const [[x0, y0], [x1, y1]] = bounds;
      const dx = Math.max(1, x1 - x0);
      const dy = Math.max(1, y1 - y0);
      const padding = 28;
      const k = Math.min(
        40,
        0.94 / Math.max(dx / Math.max(1, width - padding * 2), dy / Math.max(1, height - padding * 2)),
      );
      const tx = width / 2 - k * (x0 + x1) / 2;
      const ty = height / 2 - k * (y0 + y1) / 2;
      return d3.zoomIdentity.translate(tx, ty).scale(k);
    }

    const initialGeo = selectedFeatures.length
      ? { type: "FeatureCollection", features: selectedFeatures }
      : backgroundGeo;
    const initialTransform = fitTransform(initialGeo);
    svg.call(zoom.transform, initialTransform);

    const controls = shell.append("div").attr("class", "rb-map-controls");
    controls.append("button")
      .attr("type", "button")
      .text("+")
      .on("click", () => svg.transition().duration(180).call(zoom.scaleBy, 1.35));
    controls.append("button")
      .attr("type", "button")
      .text("−")
      .on("click", () => svg.transition().duration(180).call(zoom.scaleBy, 1 / 1.35));
    controls.append("button")
      .attr("type", "button")
      .text("重置")
      .on("click", () => svg.transition().duration(220).call(zoom.transform, initialTransform));

    container.appendChild(shell.node());
  }

  async function downloadElementAsPng(element, filename) {
    const canvas = await html2canvas(element, {
      backgroundColor: "#f7f4ee",
      scale: 2,
      useCORS: true,
    });
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return {
    $,
    api,
    toast,
    uid,
    escapeHtml,
    CATEGORY_META,
    iconBadge,
    loadSelectedFeatures,
    collectPlaceStops,
    renderMap,
    downloadElementAsPng,
  };
})();
