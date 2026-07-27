from pydantic import BaseModel, Field
from typing import List


class MoveRequest(BaseModel):
    direction: str  # "forward" | "back" | "left" | "right" | "stop"
    speed: int


class ModeRequest(BaseModel):
    mode: str  # "auto" | "manual"


class AlertRequest(BaseModel):
    label: str
    confidence: float
