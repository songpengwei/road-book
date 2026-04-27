# 实现说明

## 目标

本项目当前实现的是一个“路书生成器”：

- 在编辑页搜索并选择省 / 地级市 / 县区作为路线范围
- 在地图右侧预览中以虚线高亮所选行政区
- 按时间线维护每天的时间、交通、路线、住宿和地点
- 为地点指定分类，如机场、酒店、国保、博物馆、公园、小吃街、古建、古城
- 在导出页生成海报式路书，并导出 PNG

## 工程结构

### 后端

- [backend/app.py](/home/muniao/code/road-book/backend/app.py)
  - FastAPI 入口
  - 提供路书 CRUD 接口
  - 提供行政区搜索接口 `/api/regions`
  - 提供行政区边界接口 `/api/regions/geometry`
  - 提供全国省级底图接口 `/api/map/background`
  - 提供静态页面 `/`、`/edit`、`/export`

- [backend/models.py](/home/muniao/code/road-book/backend/models.py)
  - `Trip` 仍是主实体
  - 在原有 `points` 之外增加：
    - `regions_json`
    - `itinerary_json`
  - 用 JSON 存储新的路线范围与时间线数据

- [backend/geo.py](/home/muniao/code/road-book/backend/geo.py)
  - 负责行政区搜索
  - 负责拉取并缓存行政区边界 GeoJSON
  - 搜索数据来源：
    - `pcas-code.json`
  - 边界数据来源：
    - 阿里云 DataV 行政区 GeoJSON

- [backend/db.py](/home/muniao/code/road-book/backend/db.py)
  - SQLite 单文件数据库
  - `data/cache/` 用于区划数据缓存

### 前端

- [frontend/index.html](/home/muniao/code/road-book/frontend/index.html)
  - 首页
  - 新建路书
  - 列出已有路书

- [frontend/edit.html](/home/muniao/code/road-book/frontend/edit.html)
  - 编辑页
  - 左侧维护标题、描述、行政区和时间线
  - 右侧显示地图预览

- [frontend/export.html](/home/muniao/code/road-book/frontend/export.html)
  - 导出页
  - 生成海报式排版
  - 下载 PNG

- [frontend/static/roadbook.js](/home/muniao/code/road-book/frontend/static/roadbook.js)
  - 公共前端逻辑
  - 包含 API 调用、分类元数据、地图渲染、导出 PNG
  - `renderMap(...)` 同时服务于编辑页预览与导出页

- [frontend/static/edit.js](/home/muniao/code/road-book/frontend/static/edit.js)
  - 编辑页交互逻辑
  - 行政区搜索与加入
  - 时间线增删改
  - 地图预览刷新

- [frontend/static/export.js](/home/muniao/code/road-book/frontend/static/export.js)
  - 导出页渲染逻辑
  - 将路书数据拼成标题、图例、地图和表格

- [frontend/static/style.css](/home/muniao/code/road-book/frontend/static/style.css)
  - 全局样式
  - 编辑页、导出页、地图控件样式

## 数据结构

### Trip.regions

`regions_json` 反序列化后是数组，每项包含：

```json
{
  "adcode": "150400",
  "name": "赤峰市",
  "full_name": "内蒙古自治区 / 赤峰市",
  "level": "city",
  "parents": ["内蒙古自治区"]
}
```

### Trip.itinerary

`itinerary_json` 反序列化后是数组，每项代表一天：

```json
{
  "id": "day_xxx",
  "title": "DAY1",
  "time": "07:55-10:55",
  "transport": "航班",
  "route_text": "成都-沈阳",
  "accommodation": "沈阳",
  "notes": "可写时长、公里数等补充信息",
  "places": [
    {
      "id": "place_xxx",
      "title": "辽宁博物馆",
      "category": "museum",
      "region_adcode": "210100"
    }
  ]
}
```

## 地图渲染策略

### 底图

- 使用全国省级边界作为基础轮廓
- 以灰色虚线绘制全国底图

### 路线范围

- 用户选择的省 / 市 / 县通过 `/api/regions/geometry` 获取边界
- 在地图上以更明显的虚线和浅色填充高亮

### 缩放与视角

- 编辑页预览和导出页成品图共用 `renderMap(...)`
- 初始投影先按全国底图建立
- 然后对当前选中区划集合做一次 fit transform
- 地图支持：
  - 鼠标滚轮缩放
  - 拖拽平移
  - `+ / - / 重置` 控件

### 标签与路线点

- 地点分类颜色由 `CATEGORY_META` 统一定义
- 区域标签和路线锚点位置使用 `path.centroid(feature)`
- 这样可以避免 `MultiPolygon` 行政区几何中心偏移过大的问题

## 导出策略

- 导出页不是后端绘图，而是前端排版后使用 `html2canvas`
- 下载结果为 PNG
- 导出结构包括：
  - 标题区
  - 图例区
  - 地图区
  - 时间线表格区

## 构建与运行

当前通过 [Makefile](/home/muniao/code/road-book/Makefile) 管理常用命令：

- `make install`
  - 创建 `.venv`
  - 安装后端依赖

- `make compile`
  - 后端 `py_compile`
  - 前端 `node --check`

- `make start`
  - 启动 `uvicorn`

- `make stop`
  - 停止当前项目的 `uvicorn`

- `make restart`
  - 重启当前项目的 `uvicorn`

## 已知约束

- 行政区边界依赖远程 GeoJSON，首次查询会写入 `data/cache/`
- 当前地图标签避让是轻量实现，地点密集时仍可能有遮挡
- 旧的 `Point` 模型仍保留，但当前主流程主要依赖 `regions_json` 和 `itinerary_json`
