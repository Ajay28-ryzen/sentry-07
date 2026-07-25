from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO

app = Flask(__name__)
CORS(app)

socketio = SocketIO(app, cors_allowed_origins="*")


@app.route("/")
def home():
    return "SENTRY-07 Backend Running"


@app.route("/api/status")
def status():

    return {"battery": 97, "heading": 120, "speed": 0, "sonar": [80, 75, 60, 90]}


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8000)
