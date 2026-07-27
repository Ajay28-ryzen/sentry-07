from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio
import json

app = FastAPI(title="Sentry Server", version="0")

# CORS — required since the dashboard runs on a different origin/port
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to specific origins before real deployment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- In-memory state (swap for real sensor reads later) ----
robot_state = {
    "battery": 87,
    "heading": 0,
    "speed": 0,
    "sonar": [120, 118, 95, 130],
    "mode": "manual",
    "thermal_enabled": False,
}


@app.get("/health")
def health():
    return {"status": "ok"}


# ---- Request schemas ----
class MoveRequest(BaseModel):
    direction: str  # "forward" | "back" | "left" | "right" | "stop"
    speed: int


class ModeRequest(BaseModel):
    mode: str  # "auto" | "manual"


class ThermalRequest(BaseModel):
    enabled: bool


class AlertRequest(BaseModel):
    label: str
    confidence: float


# ---- Core contract your frontend already expects ----


@app.get("/api/status")
def status():
    return robot_state


@app.post("/api/move")
def move(req: MoveRequest):
    # TODO: call actual motor driver here
    robot_state["speed"] = req.speed
    return {"status": "ok", "direction": req.direction, "speed": req.speed}


@app.post("/api/mode")
def set_mode(req: ModeRequest):
    robot_state["mode"] = req.mode
    return {"status": "ok", "mode": req.mode}


@app.post("/api/thermal")
def set_thermal(req: ThermalRequest):
    robot_state["thermal_enabled"] = req.enabled
    return {"status": "ok", "enabled": req.enabled}


@app.get("/video_feed")
def video_feed():
    # Placeholder MJPEG generator — replace frame source with picamera2/OpenCV capture
    def generate():
        while True:
            yield b""  # TODO: yield real JPEG frame bytes here

    return StreamingResponse(
        generate(), media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.post("/alert")
async def alert(req: AlertRequest):
    # Internal endpoint: YOLO process posts detections here, gets broadcast to dashboard
    payload = {"type": "alert", "label": req.label, "confidence": req.confidence}
    await broadcast(payload)
    return {"status": "ok"}


@app.websocket("/ws/alerts")
async def ws_alerts(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()  # keeps connection alive; ignore incoming
    except WebSocketDisconnect:
        active_connections.remove(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
