from fastapi import FastAPI

move = FastAPI(prefix="/move", title="Move Control", version="0")


@move.post("/right")
def move_right():
    return {"status": "ok"}


@move.post("/left")
def move_left():
    return {"status": "ok"}


@move.post("/forward")
def move_forward():
    return {"status": "ok"}


@move.post("/backward")
def move_backward():
    return {"status": "ok"}
