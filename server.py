import asyncio
import json
import ssl
import uuid

import numpy as np

from aiohttp import web
from av import VideoFrame
from aiortc import (
    RTCPeerConnection,
    RTCSessionDescription,
    VideoStreamTrack,
)

peers = {}


async def index(request):
    return web.FileResponse(
        "static/index.html"
    )


# =========================================================
# VIDEO TRANSFORM
# =========================================================

class VideoTransformTrack(
    VideoStreamTrack
):

    def __init__(self, track):

        super().__init__()

        self.track = track

        self.effect = "original"

        self.frame_number = 0

    def set_effect(
            self,
            effect
    ):

        self.effect = effect

    async def recv(self):

        frame = await self.track.recv()

        self.frame_number += 1

        image = frame.to_ndarray(
            format="bgr24"
        )

        # -------------------------------------------------
        # ORIGINAL
        # -------------------------------------------------

        if self.effect == "original":
            processed = image


        # -------------------------------------------------
        # GRAYSCALE
        # -------------------------------------------------

        elif self.effect == "grayscale":

            gray = (

                    0.114
                    * image[:, :, 0]

                    + 0.587
                    * image[:, :, 1]

                    + 0.299
                    * image[:, :, 2]
            )

            gray = np.clip(
                gray,
                0,
                255
            ).astype(
                np.uint8
            )

            processed = np.stack(
                [
                    gray,
                    gray,
                    gray
                ],
                axis=2
            )


        # -------------------------------------------------
        # INVERT
        # -------------------------------------------------

        elif self.effect == "invert":

            processed = 255 - image


        # -------------------------------------------------
        # MIRROR
        # -------------------------------------------------

        elif self.effect == "mirror":

            processed = np.ascontiguousarray(
                image[:, ::-1]
            )


        # -------------------------------------------------
        # FALLBACK
        # -------------------------------------------------

        else:

            processed = image

        new_frame = VideoFrame.from_ndarray(
            processed,
            format="bgr24"
        )

        new_frame.pts = frame.pts

        new_frame.time_base = frame.time_base

        if (
                self.frame_number % 60
                == 0
        ):
            print(
                f"Frame "
                f"{self.frame_number}, "
                f"effect="
                f"{self.effect}"
            )

        return new_frame


# =========================================================
# OFFER
# =========================================================

async def offer(request):
    data = await request.json()

    peer_id = str(
        uuid.uuid4()
    )

    print()
    print(
        f"[{peer_id}] "
        f"Новый peer"
    )

    pc = RTCPeerConnection()

    peers[peer_id] = {

        "pc":
            pc,

        "video_track":
            None,

        "data_channel":
            None
    }

    # -----------------------------------------------------
    # CONNECTION STATE
    # -----------------------------------------------------

    @pc.on(
        "connectionstatechange"
    )
    async def on_connectionstatechange():

        print(
            f"[{peer_id}] "
            f"Connection: "
            f"{pc.connectionState}"
        )

        if (
                pc.connectionState
                == "failed"
        ):
            await close_peer(
                peer_id
            )

    # -----------------------------------------------------
    # VIDEO TRACK
    # -----------------------------------------------------

    @pc.on("track")
    def on_track(track):

        print(
            f"[{peer_id}] "
            f"Track: "
            f"{track.kind}"
        )

        if (
                track.kind
                == "video"
        ):
            transformed_track = (
                VideoTransformTrack(
                    track
                )
            )

            peers[
                peer_id
            ][
                "video_track"
            ] = (
                transformed_track
            )

            pc.addTrack(
                transformed_track
            )

    # -----------------------------------------------------
    # DATA CHANNEL
    # -----------------------------------------------------

    @pc.on("datachannel")
    def on_datachannel(channel):

        print(
            f"[{peer_id}] "
            f"DataChannel: "
            f"{channel.label}"
        )

        peers[
            peer_id
        ][
            "data_channel"
        ] = channel

        # ---------------------------------------------
        # CHANNEL OPEN
        # ---------------------------------------------

        @channel.on("open")
        def on_open():

            print(
                f"[{peer_id}] "
                f"DataChannel opened"
            )

        # ---------------------------------------------
        # MESSAGE
        # ---------------------------------------------

        @channel.on("message")
        def on_message(message):

            print(
                f"[{peer_id}] "
                f"Message: "
                f"{message}"
            )

            try:

                data = json.loads(
                    message
                )


            except (
                    json.JSONDecodeError,
                    TypeError
            ):

                print(
                    f"[{peer_id}] "
                    f"Invalid JSON"
                )

                return

            message_type = data.get(
                "type"
            )

            # -----------------------------------------
            # EFFECT COMMAND
            # -----------------------------------------

            if (
                    message_type
                    == "effect"
            ):

                effect = data.get(
                    "value"
                )

                allowed_effects = {
                    "original",
                    "grayscale",
                    "invert",
                    "mirror"
                }

                if (
                        effect
                        not in
                        allowed_effects
                ):
                    channel.send(
                        json.dumps({
                            "type":
                                "error",

                            "message":
                                "unknown effect"
                        })
                    )

                    return

                video_track = (
                    peers[
                        peer_id
                    ][
                        "video_track"
                    ]
                )

                if (
                        video_track
                        is None
                ):
                    channel.send(
                        json.dumps({
                            "type":
                                "error",

                            "message":
                                "video track not found"
                        })
                    )

                    return

                # Меняем состояние
                video_track.set_effect(
                    effect
                )

                print(
                    f"[{peer_id}] "
                    f"Effect changed: "
                    f"{effect}"
                )

                # Отправляем подтверждение
                # обратно браузеру
                channel.send(
                    json.dumps({

                        "type":
                            "effect_changed",

                        "value":
                            effect
                    })
                )

    # -----------------------------------------------------
    # SDP OFFER
    # -----------------------------------------------------

    remote_description = (
        RTCSessionDescription(

            sdp=
            data["sdp"],

            type=
            data["type"]
        )
    )

    await pc.setRemoteDescription(
        remote_description
    )

    # -----------------------------------------------------
    # SDP ANSWER
    # -----------------------------------------------------

    answer = await pc.createAnswer()

    await pc.setLocalDescription(
        answer
    )

    print(
        f"[{peer_id}] "
        f"SDP answer created"
    )

    return web.json_response({

        "peer_id":
            peer_id,

        "sdp":
            pc.localDescription.sdp,

        "type":
            pc.localDescription.type
    })


# =========================================================
# CLOSE PEER
# =========================================================

async def close_peer(
        peer_id
):
    peer = peers.pop(
        peer_id,
        None
    )

    if peer is None:
        return False

    print(
        f"[{peer_id}] "
        f"Closing peer"
    )

    pc = peer["pc"]

    await pc.close()

    print(
        f"[{peer_id}] "
        f"Peer closed"
    )

    return True


# =========================================================
# DISCONNECT
# =========================================================

async def disconnect(
        request
):
    peer_id = request.match_info[
        "peer_id"
    ]

    closed = await close_peer(
        peer_id
    )

    if not closed:
        return web.json_response(
            {
                "error":
                    "peer not found"
            },
            status=404
        )

    return web.json_response({
        "status":
            "closed"
    })


# =========================================================
# SHUTDOWN
# =========================================================

async def on_shutdown(app):
    print(
        "\nClosing connections..."
    )

    peer_ids = list(
        peers.keys()
    )

    await asyncio.gather(
        *[
            close_peer(
                peer_id
            )
            for peer_id
            in peer_ids
        ],
        return_exceptions=True
    )


# =========================================================
# APP
# =========================================================

app = web.Application()

app.router.add_get(
    "/",
    index
)

app.router.add_post(
    "/offer",
    offer
)

app.router.add_post(
    "/peers/{peer_id}/close",
    disconnect
)

app.router.add_static(
    "/static/",
    path="static"
)

app.on_shutdown.append(
    on_shutdown
)

# =========================================================
# START
# =========================================================

if __name__ == "__main__":

    # ssl_context = ssl.SSLContext(
    #     ssl.PROTOCOL_TLS_SERVER
    # )
    #
    # ssl_context.load_cert_chain(
    #     "certs/cert.pem",
    #     "certs/key.pem"
    # )

    web.run_app(
        app,
        host="127.0.0.1",
        port=8080,
        # ssl_context=ssl_context
    )
