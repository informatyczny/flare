import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text

sys.path.append(str(Path(__file__).parent))
sys.path.append(str(Path(__file__).parent.parent))

from admin import router as admin_router
from lib.loggers import api_logger
from volunteers.database import engine, get_db
from volunteers.models import Base, Volunteer
from volunteers.router import router as volunteers_router


def _run_migrations() -> None:
    """Add columns introduced after initial schema creation."""
    inspector = inspect(engine)
    if "volunteers" in inspector.get_table_names():
        existing = {c["name"] for c in inspector.get_columns("volunteers")}
        if "display_name" not in existing:
            with engine.connect() as conn:
                conn.execute(
                    text("ALTER TABLE volunteers ADD COLUMN display_name TEXT")
                )
                conn.commit()
            api_logger.info("Migration: added display_name column to volunteers")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    Base.metadata.create_all(engine)
    _run_migrations()
    yield


app = FastAPI(title="FLARE Trust Registry", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        body = await request.body()

    api_logger.warning(
        "422 Unprocessable Entity | %s %s | body=%r | errors=%s",
        request.method,
        request.url.path,
        body,
        exc.errors(),
    )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/api/health")
def health() -> dict[str, object]:
    db = next(get_db())
    try:
        count = db.query(Volunteer).count()
    finally:
        db.close()
    return {"status": "ok", "volunteer_count": count}


app.include_router(volunteers_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
