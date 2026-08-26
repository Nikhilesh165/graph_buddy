from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Pure liveness check -- no dependencies. Always ok if the process is up."""
    return {"status": "ok"}


@router.get("/health/graph")
async def health_graph(request: Request) -> dict[str, str]:
    """Live Neo4j/Graphiti connectivity check.

    Returns a 200 with status "error" (never a 5xx) when the database is
    unreachable -- that's an expected, reportable state, not a server bug.
    """
    graphiti_state = request.app.state.graphiti_state
    connected, error = await graphiti_state.check_connectivity()
    if connected:
        return {"status": "ok"}
    return {"status": "error", "detail": error or "unknown error"}
