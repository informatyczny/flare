import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

sys.path.append(str(Path(__file__).parent))
sys.path.append(str(Path(__file__).parent.parent))

from admin import router as admin_router
from config import settings
from events import router as events_router
from lib.loggers import api_logger
from volunteers import init_db
from volunteers import router as volunteers_router

routers: dict[str, APIRouter] = {
    "admin": admin_router,
    "events": events_router,
    "volunteers": volunteers_router,
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="FLARE", lifespan=lifespan)

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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "relays": settings.NOSTR_RELAYS}


for name, router in routers.items():
    app.include_router(router, prefix=f"/{name}")
