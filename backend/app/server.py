from fastapi import FastAPI
# from .move_control import move

app = FastAPI(title="Sentry Server", version="0")
# app.mount("/move", move)

"""# Add CORS middleware AFTER app creation
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
"""


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("move")
def move():
    return {"status": "ok"}


@app.post("/alert")
def alert():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
