.PHONY: setup up down restart logs health test eval migrate clean

setup:
	pip install -e .

up:
	docker compose up -d --build

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f

health:
	curl -s http://localhost:8000/health | json_pp || curl -s http://localhost:8000/health

test:
	PYTHONPATH=. pytest tests/ -v

eval:
	PYTHONPATH=. python3 -m app.evaluation.runner

clean:
	rm -rf __pycache__ .pytest_cache *.db
