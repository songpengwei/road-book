VENV ?= .venv
PYTHON ?= $(VENV)/bin/python
PIP ?= $(PYTHON) -m pip
UVICORN ?= ../$(VENV)/bin/uvicorn
PORT ?= 8000

.PHONY: venv install compile compile-backend compile-frontend start stop restart dev

venv:
	python3 -m venv $(VENV)

install: venv
	$(PIP) install -r backend/requirements.txt

compile: compile-backend compile-frontend

compile-backend:
	$(PYTHON) -m py_compile \
		backend/app.py \
		backend/geo.py \
		backend/models.py \
		backend/db.py \
		backend/render.py

compile-frontend:
	node --check frontend/static/roadbook.js
	node --check frontend/static/edit.js
	node --check frontend/static/export.js

start:
	cd backend && $(UVICORN) app:app --host 0.0.0.0 --port $(PORT)

stop:
	pids=$$(ps -eo pid=,args= | awk '/[u]vicorn app:app --host 0.0.0.0 --port $(PORT)$$/ {print $$1}'); \
	if [ -n "$$pids" ]; then kill $$pids; fi

restart: stop start

dev: start
