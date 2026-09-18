const joinButton =
    document.getElementById("joinButton");

const leaveButton =
    document.getElementById("leaveButton");

const roomInput =
    document.getElementById("roomInput");

const statusElement =
    document.getElementById("status");

const localVideo =
    document.getElementById("localVideo");

const remoteVideo =
    document.getElementById("remoteVideo");

const debugElement =
    document.getElementById("debug");


let ws = null;

let pc = null;

let localStream = null;

let myPeerId = null;

let remotePeerId = null;


// ICE candidates могут прийти раньше,
// чем мы установим remoteDescription.
//
// Поэтому временно складываем их сюда.

let pendingIceCandidates = [];


// ============================================================
// DEBUG
// ============================================================

function log(...args) {

    console.log(...args);

    debugElement.textContent +=
        args.join(" ") + "\n";
}


// ============================================================
// CREATE PEER CONNECTION
// ============================================================

function createPeerConnection() {

    log("Creating RTCPeerConnection");


    pc = new RTCPeerConnection({

        iceServers: [

            {
                urls:
                    "stun:stun.l.google.com:19302"
            }

        ]

    });


    // --------------------------------------------------------
    // LOCAL ICE CANDIDATE
    // --------------------------------------------------------

    pc.onicecandidate = (event) => {

        if (!event.candidate) {

            log("ICE gathering finished");

            return;
        }


        log(
            "Local ICE candidate:",
            event.candidate.type
        );


        if (!remotePeerId) {

            log(
                "Remote peer is not known yet"
            );

            return;
        }


        ws.send(JSON.stringify({

            type:
                "ice-candidate",

            target:
                remotePeerId,

            candidate:
                event.candidate

        }));

    };


    // --------------------------------------------------------
    // REMOTE VIDEO
    // --------------------------------------------------------

    pc.ontrack = (event) => {

        log(
            "Remote track:",
            event.track.kind
        );


        if (event.streams.length > 0) {

            remoteVideo.srcObject =
                event.streams[0];

        } else {

            remoteVideo.srcObject =
                new MediaStream([
                    event.track
                ]);

        }

    };


    // --------------------------------------------------------
    // CONNECTION STATE
    // --------------------------------------------------------

    pc.onconnectionstatechange = () => {

        log(
            "Connection state:",
            pc.connectionState
        );


        statusElement.textContent =
            pc.connectionState;

    };


    // --------------------------------------------------------
    // ICE STATE
    // --------------------------------------------------------

    pc.oniceconnectionstatechange = () => {

        log(
            "ICE state:",
            pc.iceConnectionState
        );

    };


    // --------------------------------------------------------
    // ADD LOCAL TRACKS
    // --------------------------------------------------------

    for (
        const track
        of localStream.getTracks()
    ) {

        pc.addTrack(
            track,
            localStream
        );

    }

}


// ============================================================
// CREATE OFFER
// ============================================================

async function createOffer(
    targetPeerId
) {

    log(
        "Creating offer for:",
        targetPeerId
    );


    remotePeerId =
        targetPeerId;


    const offer =
        await pc.createOffer();


    await pc.setLocalDescription(
        offer
    );


    ws.send(JSON.stringify({

        type:
            "offer",

        target:
            remotePeerId,

        sdp:
            pc.localDescription

    }));


    log("Offer sent");

}


// ============================================================
// HANDLE OFFER
// ============================================================

async function handleOffer(data) {

    log(
        "Offer received from:",
        data.from
    );


    remotePeerId =
        data.from;


    await pc.setRemoteDescription(
        data.sdp
    );


    await flushPendingIceCandidates();


    const answer =
        await pc.createAnswer();


    await pc.setLocalDescription(
        answer
    );


    ws.send(JSON.stringify({

        type:
            "answer",

        target:
            remotePeerId,

        sdp:
            pc.localDescription

    }));


    log("Answer sent");

}


// ============================================================
// HANDLE ANSWER
// ============================================================

async function handleAnswer(data) {

    log(
        "Answer received from:",
        data.from
    );


    await pc.setRemoteDescription(
        data.sdp
    );


    await flushPendingIceCandidates();


    log(
        "Remote description installed"
    );

}


// ============================================================
// HANDLE ICE
// ============================================================

async function handleIceCandidate(
    data
) {

    if (!data.candidate) {
        return;
    }


    const candidate =
        new RTCIceCandidate(
            data.candidate
        );


    // Если SDP второго peer ещё
    // не установлен — candidate пока
    // нельзя безопасно добавить.

    if (
        !pc.remoteDescription
    ) {

        log(
            "Queue remote ICE candidate"
        );


        pendingIceCandidates.push(
            candidate
        );


        return;
    }


    await pc.addIceCandidate(
        candidate
    );


    log(
        "Remote ICE candidate added"
    );

}


// ============================================================
// FLUSH ICE QUEUE
// ============================================================

async function flushPendingIceCandidates() {

    log(
        "Flushing ICE candidates:",
        pendingIceCandidates.length
    );


    for (
        const candidate
        of pendingIceCandidates
    ) {

        await pc.addIceCandidate(
            candidate
        );

    }


    pendingIceCandidates = [];

}


// ============================================================
// WEBSOCKET MESSAGE
// ============================================================

async function handleWebSocketMessage(
    event
) {

    const data =
        JSON.parse(event.data);


    log(
        "WS message:",
        data.type
    );


    // --------------------------------------------------------
    // JOINED
    // --------------------------------------------------------

    if (data.type === "joined") {

        myPeerId =
            data.peer_id;


        log(
            "My peer ID:",
            myPeerId
        );


        log(
            "Peers already in room:",
            data.peers.length
        );


        // Если кто-то уже находится
        // в комнате — МЫ создаём offer.

        if (data.peers.length > 0) {

            await createOffer(
                data.peers[0]
            );

        }

    }


    // --------------------------------------------------------
    // PEER JOINED
    // --------------------------------------------------------

    else if (
        data.type === "peer-joined"
    ) {

        log(
            "New peer joined:",
            data.peer_id
        );


        // Ничего не делаем.
        //
        // Новый peer сам создаст offer.
    }


    // --------------------------------------------------------
    // OFFER
    // --------------------------------------------------------

    else if (
        data.type === "offer"
    ) {

        await handleOffer(
            data
        );

    }


    // --------------------------------------------------------
    // ANSWER
    // --------------------------------------------------------

    else if (
        data.type === "answer"
    ) {

        await handleAnswer(
            data
        );

    }


    // --------------------------------------------------------
    // ICE
    // --------------------------------------------------------

    else if (
        data.type ===
        "ice-candidate"
    ) {

        await handleIceCandidate(
            data
        );

    }


    // --------------------------------------------------------
    // PEER LEFT
    // --------------------------------------------------------

    else if (
        data.type === "peer-left"
    ) {

        log(
            "Peer left:",
            data.peer_id
        );


        remotePeerId = null;


        remoteVideo.srcObject =
            null;


        if (pc) {

            pc.close();

            pc = null;

        }


        // Мы остаёмся в комнате.
        //
        // Создаём новый RTCPeerConnection,
        // чтобы другой человек мог
        // подключиться позже.

        createPeerConnection();


        statusElement.textContent =
            "waiting";

    }


    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    else if (
        data.type === "error"
    ) {

        log(
            "Server error:",
            data.message
        );

    }

}


// ============================================================
// JOIN ROOM
// ============================================================

joinButton.onclick =
async () => {

    try {

        joinButton.disabled =
            true;


        roomInput.disabled =
            true;


        debugElement.textContent =
            "";


        statusElement.textContent =
            "requesting camera";


        // ----------------------------------------------------
        // CAMERA
        // ----------------------------------------------------

        localStream =
            await navigator.mediaDevices
                .getUserMedia({

                    video:
                        true,

                    audio:
                        false

                });


        localVideo.srcObject =
            localStream;


        log("Camera started");


        // ----------------------------------------------------
        // RTCPeerConnection
        // ----------------------------------------------------

        createPeerConnection();


        // ----------------------------------------------------
        // WEBSOCKET
        // ----------------------------------------------------

        const protocol =

            location.protocol === "https:"

                ? "wss:"

                : "ws:";


        const wsUrl =
            `${protocol}//${location.host}/ws`;


        log(
            "Connecting WebSocket:",
            wsUrl
        );


        ws =
            new WebSocket(
                wsUrl
            );


        ws.onopen = () => {

            log(
                "WebSocket connected"
            );


            statusElement.textContent =
                "waiting";


            leaveButton.disabled =
                false;


            ws.send(
                JSON.stringify({

                    type:
                        "join",

                    room:
                        roomInput.value

                })
            );

        };


        ws.onmessage =
            handleWebSocketMessage;


        ws.onerror = (
            error
        ) => {

            console.error(
                "WebSocket error:",
                error
            );


            log(
                "WebSocket error"
            );

        };


        ws.onclose = () => {

            log(
                "WebSocket closed"
            );

        };


    } catch (error) {

        console.error(
            error
        );


        log(
            "ERROR:",
            error.message
        );


        statusElement.textContent =
            "error";


        await leaveRoom();

    }

};


// ============================================================
// LEAVE ROOM
// ============================================================

leaveButton.onclick =
async () => {

    await leaveRoom();

};


async function leaveRoom() {

    log(
        "Leaving room"
    );


    // --------------------------------------------------------
    // WEBSOCKET
    // --------------------------------------------------------

    if (ws) {

        ws.close();

        ws = null;

    }


    // --------------------------------------------------------
    // WEBRTC
    // --------------------------------------------------------

    if (pc) {

        pc.close();

        pc = null;

    }


    // --------------------------------------------------------
    // CAMERA
    // --------------------------------------------------------

    if (localStream) {

        for (
            const track
            of localStream.getTracks()
        ) {

            track.stop();

        }


        localStream = null;

    }


    // --------------------------------------------------------
    // RESET
    // --------------------------------------------------------

    localVideo.srcObject =
        null;


    remoteVideo.srcObject =
        null;


    myPeerId =
        null;


    remotePeerId =
        null;


    pendingIceCandidates =
        [];


    statusElement.textContent =
        "disconnected";


    joinButton.disabled =
        false;


    leaveButton.disabled =
        true;


    roomInput.disabled =
        false;

}