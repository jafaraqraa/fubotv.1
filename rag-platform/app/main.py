import time
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.session import init_db
from app.api.v1 import query, documents, indexes, config

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = (time.time() - start_time) * 1000
    response.headers["X-Process-Time-MS"] = f"{process_time:.2f}"
    return response

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "environment": settings.APP_ENV,
        "timestamp": time.time()
    }

@app.get("/ready", status_code=status.HTTP_200_OK)
async def readiness_check():
    return {
        "status": "ready",
        "database": "sqlite_wal",
        "qdrant": "configured",
        "timestamp": time.time()
    }

app.include_router(query.router)
app.include_router(documents.router)
app.include_router(indexes.router)
app.include_router(config.router)
