# Road Book · 路书

一个朴素的路书工具：在地图上标点、连线、写字，导出时可把标注叠到任意底图上。

## 设计参考

视觉上借 Stamen Toner / Mapbox Light 的克制感——不用渐变，不用阴影，等宽字做标签，单色勾线。功能上像一本田野笔记的电子版。

## 技术栈

- 后端：FastAPI + SQLite + SQLModel
- 前端：原生 HTML/JS + Leaflet.js
- 瓦片：OpenStreetMap（默认）· 高德（可选，需 key）
- 导出：Pillow（后端渲染，保证样式一致）

## 目录结构

```
road-book/
├── backend/
│   ├── app.py            # FastAPI 入口
│   ├── models.py         # 数据模型
│   ├── db.py             # 数据库初始化
│   ├── render.py         # 导出图片渲染
│   └── requirements.txt
├── frontend/
│   ├── index.html        # 路书列表
│   ├── edit.html         # 编辑页
│   ├── export.html       # 导出页
│   ├── static/
│   │   ├── style.css
│   │   ├── edit.js
│   │   └── export.js
├── data/                 # SQLite 文件 + 上传的底图
└── README.md
```

## 运行

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

打开 http://localhost:8000

## 功能

### 1. 地图上标点、连线
- 点击地图添加地点，拖动调整
- 每个地点可输入标题、备注
- 按顺序连成轨迹

### 2. 导出到任意底图
因为"任意图片"没有地理参考，需要你先指定 2 个以上的**控制点**——
在底图上点一下，再告诉我这点在真实世界里的经纬度（或直接从地图上吸取）。
有了控制点，就能算出仿射变换，把所有地点/轨迹叠到底图上。

导出格式：PNG。

## License

MIT
