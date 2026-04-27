# Road Book · 路书

一个面向“海报式路书”的轻量工具：

- 搜索省 / 地级市 / 县区并加入地图范围
- 给每天录入时间、交通、住宿、行程地点
- 为地点指定分类图例，如机场、酒店、国保、公园、小吃街
- 自动生成虚线高亮区划、行程点线和下方时间线表格
- 最终一键导出 PNG

## 技术栈

- 后端：FastAPI + SQLite + SQLModel
- 前端：原生 HTML / JS + D3
- 区划检索：GitHub 上的中国行政区划代码数据
- 区划边界：阿里云 DataV GeoJSON
- 导出：html2canvas

## 目录结构

```text
road-book/
├── backend/
│   ├── app.py
│   ├── db.py
│   ├── geo.py
│   ├── models.py
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── edit.html
│   ├── export.html
│   └── static/
│       ├── roadbook.js
│       ├── edit.js
│       ├── export.js
│       └── style.css
└── data/
```

## 运行

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

打开 `http://localhost:8000`

## 当前流程

1. 在首页新建一本路书
2. 编辑页搜索区划，加入路线范围
3. 在时间线里逐天录入交通、住宿和地点
4. 地点可选择图例分类和所属区划
5. 打开“生成路书”页，直接下载 PNG
