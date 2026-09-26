import json
import ssl
import uuid

from aiohttp import web


# ============================================================
# ROOMS
# ============================================================

# Структура:
#
# rooms = {
#     "room-name": {
#         "peer-id-1": websocket,
#         "peer-id-2": websocket
#     }
# }

rooms = {}


# ============================================================
# INDEX
# ============================================================

async def index(request):
    return web.FileResponse(
        "static/index.html"
    )


# ============================================================
# SEND MESSAGE TO PEER
# ============================================================

async def send_to_peer(
    room_id,
    peer_id,
    message
):
    """
    Отправляет signaling message
    конкретному peer внутри комнаты.
    """

    room = rooms.get(room_id)

    if room is None:
        return


    ws = room.get(peer_id)

    if ws is None:
        return


    await ws.send_json(message)


# ============================================================
# WEBSOCKET
# ============================================================

async def websocket_handler(request):

    ws = web.WebSocketResponse()

    await ws.prepare(request)


    # Каждое WebSocket-соединение получает
    # собственный peer_id.

    peer_id = str(uuid.uuid4())

    room_id = None


    print(
        f"\n[{peer_id}] WebSocket connected"
    )


    try:

        # ----------------------------------------------------
        # RECEIVE MESSAGES
        # ----------------------------------------------------

        async for msg in ws:

            if msg.type != web.WSMsgType.TEXT:
                continue


            try:

                data = json.loads(
                    msg.data
                )

            except json.JSONDecodeError:

                print(
                    f"[{peer_id}] Invalid JSON"
                )

                continue


            message_type = data.get(
                "type"
            )


            # =================================================
            # JOIN ROOM
            # =================================================

            if message_type == "join":

                room_id = data.get(
                    "room"
                )


                if not room_id:

                    await ws.send_json({
                        "type": "error",
                        "message": "room is required"
                    })

                    continue


                # Создаём комнату,
                # если её ещё нет.

                room = rooms.setdefault(
                    room_id,
                    {}
                )


                # Пока разрешаем максимум
                # двух участников.

                if len(room) >= 2:

                    await ws.send_json({
                        "type": "error",
                        "message": "room is full"
                    })

                    room_id = None

                    continue


                # Какие peers уже были
                # в комнате ДО нас?

                existing_peers = list(
                    room.keys()
                )


                # Добавляем себя.

                room[peer_id] = ws


                print(
                    f"[{peer_id}] joined room "
                    f"{room_id}"
                )


                # Сообщаем новому участнику,
                # кто уже находится в комнате.

                await ws.send_json({

                    "type":
                        "joined",

                    "peer_id":
                        peer_id,

                    "peers":
                        existing_peers
                })


                # Сообщаем старым участникам,
                # что появился новый peer.

                for existing_peer_id in existing_peers:

                    await send_to_peer(
                        room_id,
                        existing_peer_id,
                        {
                            "type":
                                "peer-joined",

                            "peer_id":
                                peer_id
                        }
                    )


            # =================================================
            # OFFER
            # =================================================

            elif message_type == "offer":

                target = data.get(
                    "target"
                )


                print(
                    f"[{peer_id}] "
                    f"offer -> {target}"
                )


                await send_to_peer(
                    room_id,
                    target,
                    {
                        "type":
                            "offer",

                        "from":
                            peer_id,

                        "sdp":
                            data.get("sdp")
                    }
                )


            # =================================================
            # ANSWER
            # =================================================

            elif message_type == "answer":

                target = data.get(
                    "target"
                )


                print(
                    f"[{peer_id}] "
                    f"answer -> {target}"
                )


                await send_to_peer(
                    room_id,
                    target,
                    {
                        "type":
                            "answer",

                        "from":
                            peer_id,

                        "sdp":
                            data.get("sdp")
                    }
                )


            # =================================================
            # ICE CANDIDATE
            # =================================================

            elif message_type == "ice-candidate":

                target = data.get(
                    "target"
                )


                await send_to_peer(
                    room_id,
                    target,
                    {
                        "type":
                            "ice-candidate",

                        "from":
                            peer_id,

                        "candidate":
                            data.get(
                                "candidate"
                            )
                    }
                )


    finally:

        # =====================================================
        # DISCONNECT
        # =====================================================

        print(
            f"[{peer_id}] WebSocket disconnected"
        )


        if room_id:

            room = rooms.get(
                room_id
            )


            if room:

                # Удаляем peer.

                room.pop(
                    peer_id,
                    None
                )


                # Сообщаем оставшемуся peer,
                # что участник ушёл.

                for other_peer_id in list(
                    room.keys()
                ):

                    await send_to_peer(
                        room_id,
                        other_peer_id,
                        {
                            "type":
                                "peer-left",

                            "peer_id":
                                peer_id
                        }
                    )


                # Если комната пустая —
                # удаляем её полностью.

                if not room:

                    rooms.pop(
                        room_id,
                        None
                    )


                    print(
                        f"Room {room_id} deleted"
                    )


    return ws


# ============================================================
# APP
# ============================================================

app = web.Application()


app.router.add_get(
    "/",
    index
)


app.router.add_get(
    "/ws",
    websocket_handler
)


app.router.add_static(
    "/static/",
    path="static"
)


# ============================================================
# START
# ============================================================

if __name__ == "__main__":

    ssl_context = ssl.SSLContext(
        ssl.PROTOCOL_TLS_SERVER
    )

    ssl_context.load_cert_chain(
        "certs_2/tarasenko.webrtc.lab.pem",
        "certs_2/tarasenko.webrtc.lab-key.pem"
    )

    web.run_app(
        app,
        host="10.8.0.7",
        port=8080,
        ssl_context=ssl_context
    )