const muteButton =
    document.getElementById("muteButton");
const cameraButton =
    document.getElementById("cameraButton");
const messageInput =
    document.getElementById("messageInput");
const sendButton =
    document.getElementById("sendButton");
const chatMessages =
    document.getElementById("chatMessages");
const iceInfo =
    document.getElementById("iceInfo");
const statsInfo =
    document.getElementById("statsInfo");
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

let dataChannel = null;
let ws = null;
let pc = null;
let localStream = null;
let myPeerId = null;
let remotePeerId = null;
let statsTimer = null;
let previousBytesSent = 0;
let previousBytesReceived = 0;
let previousTimestamp = 0;
let isMuted = false;
let isCameraOff = false;
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
                urls: "stun:stun.l.google.com:19302"
            },
            {
                urls: "turn:192.168.1.109:3478?transport=udp",
                username: "webrtc",
                credential: "test123456"
            }
        ]
    });
    pc.ondatachannel = (event) => {
        log(
            "Remote DataChannel received:",
            event.channel.label
        );
        setupDataChannel(
            event.channel
        );
    };

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
            log("Remote peer is not known yet");
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
    pc.onconnectionstatechange = async () => {
        log(
            "Connection state:",
            pc.connectionState
        );
        statusElement.textContent =
            pc.connectionState;
        if (
            pc.connectionState === "connected"
        ) {
            // Сразу показываем ICE route.
            await updateIceInfo();
            // Запускаем realtime stats.
            if (!statsTimer) {
                statsTimer =
                    setInterval(
                        updateWebRTCStats,
                        1000
                    );
            }
        }
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
    const channel =
        pc.createDataChannel(
            "chat"
        );
    setupDataChannel(
        channel
    );
    const offer =
        await pc.createOffer();
    await pc.setLocalDescription(
        offer
    );
    ws.send(JSON.stringify({
        type: "offer",
        target: remotePeerId,
        sdp: pc.localDescription
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
    remotePeerId = data.from;
    await pc.setRemoteDescription( data.sdp );
    await flushPendingIceCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription( answer );
    ws.send(JSON.stringify({
        type: "answer",
        target: remotePeerId,
        sdp: pc.localDescription
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
    log("Remote description installed");
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
        log("Queue remote ICE candidate");
        pendingIceCandidates.push(
            candidate
        );
        return;
    }
    await pc.addIceCandidate(
        candidate
    );
    log("Remote ICE candidate added");
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
    const data = JSON.parse(event.data);
    log(
        "WS message:",
        data.type
    );
    // --------------------------------------------------------
    // JOINED
    // --------------------------------------------------------

    if (data.type === "joined") {
        myPeerId = data.peer_id;
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
        await handleOffer(data);
    }
    // --------------------------------------------------------
    // ANSWER
    // --------------------------------------------------------
    else if (
        data.type === "answer"
    ) {
        await handleAnswer(data);
    }
    // --------------------------------------------------------
    // ICE
    // --------------------------------------------------------
    else if (
        data.type ===
        "ice-candidate"
    ) {
        await handleIceCandidate(data);
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
        remoteVideo.srcObject = null;
        if (pc) {
            pc.close();
            pc = null;
        }
        // Мы остаёмся в комнате.
        //
        // Создаём новый RTCPeerConnection,
        // чтобы другой человек мог
        // подключиться позже.

        if (statsTimer) {
            clearInterval(
                statsTimer
            );
            statsTimer = null;
        }

        previousBytesSent = 0;
        previousBytesReceived = 0;
        previousTimestamp = 0;

        iceInfo.textContent = "Waiting for peer...";
        statsInfo.textContent = "Waiting for peer...";
        createPeerConnection();
        statusElement.textContent = "waiting";
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
        joinButton.disabled = true;
        roomInput.disabled = true;
        debugElement.textContent = "";
        statusElement.textContent = "requesting camera";
        // ----------------------------------------------------
        // CAMERA
        // ----------------------------------------------------
        log("CLIENT VERSION: AUDIO V1");
        log("Requesаting media: video=true, audio=true");

        localStream =
            await navigator.mediaDevices
                .getUserMedia({
                    video: true,
                    audio: true
                });
        localVideo.srcObject =
            localStream;
        muteButton.disabled = false;
        cameraButton.disabled = false;

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
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            log("WebSocket connected");
            statusElement.textContent = "waiting";
            leaveButton.disabled = false;
            ws.send(
                JSON.stringify({
                    type: "join",
                    room: roomInput.value
                })
            );
        };
        ws.onmessage = handleWebSocketMessage;
        ws.onerror = (
            error
        ) => {
            console.error( "WebSocket error:", error );
            log( "WebSocket error" );
        };
        ws.onclose = () => {
            log( "WebSocket closed" );
        };

    } catch (error) {
        console.error(
            error
        );
        log(
            "ERROR:",
            error.message
        );
        statusElement.textContent = "error";
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
    log( "Leaving room" );
    if (statsTimer) {
        clearInterval(
            statsTimer
        );
        statsTimer = null;
    }
    previousBytesSent = 0;
    previousBytesReceived = 0;
    previousTimestamp = 0;

    iceInfo.textContent = "Waiting for connection...";
    statsInfo.textContent = "Waiting for connection...";
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
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
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

        isMuted = false;
        isCameraOff = false;

        muteButton.disabled = true;
        cameraButton.disabled = true;

        muteButton.textContent = "Mute";

        cameraButton.textContent = "Camera Off";
        localStream = null;
    }
    // --------------------------------------------------------
    // RESET
    // --------------------------------------------------------
    localVideo.srcObject = null;
    remoteVideo.srcObject =null;
    myPeerId = null;
    remotePeerId = null;
    pendingIceCandidates = [];
    statusElement.textContent = "disconnected";
    joinButton.disabled = false;
    leaveButton.disabled = true;
    roomInput.disabled = false;
}

async function updateIceInfo() {
    if (!pc) {
        return;
    }
    try {
        const stats =
            await pc.getStats();
        let selectedPair = null;
        // Ищем выбранную candidate pair.
        for (const report of stats.values()) {
            if (
                report.type === "candidate-pair" &&
                report.state === "succeeded" &&
                report.nominated
            ) {
                selectedPair = report;
                break;
            }
        }
        if (!selectedPair) {
            iceInfo.textContent =
                "Selected ICE pair not found yet";
            return;
        }
        const localCandidate =
            stats.get(
                selectedPair.localCandidateId
            );
        const remoteCandidate =
            stats.get(
                selectedPair.remoteCandidateId
            );
        iceInfo.textContent =
`SELECTED ICE PAIR
LOCAL

type:     ${localCandidate?.candidateType ?? "unknown"}
address:  ${localCandidate?.address ?? localCandidate?.ip ?? "hidden"}
port:     ${localCandidate?.port ?? "unknown"}
protocol: ${localCandidate?.protocol ?? "unknown"}


REMOTE

type:     ${remoteCandidate?.candidateType ?? "unknown"}
address:  ${remoteCandidate?.address ?? remoteCandidate?.ip ?? "hidden"}
port:     ${remoteCandidate?.port ?? "unknown"}
protocol: ${remoteCandidate?.protocol ?? "unknown"}


PAIR

state:     ${selectedPair.state}
nominated: ${selectedPair.nominated}
`;

    } catch (error) {
        console.error(
            "ICE stats error:",
            error
        );
        iceInfo.textContent =
            `ICE stats error: ${error.message}`;
    }
}


async function updateWebRTCStats() {
    if (!pc) {
        return;
    }
    try {
        const stats = await pc.getStats();

        let selectedPair = null;
        let bytesSent = 0;
        let bytesReceived = 0;
        let packetsSent = 0;
        let packetsReceived = 0;
        let packetsLost = 0;
        let jitter = 0;

        for (const report of stats.values()) {
            // --------------------------------------------
            // ICE candidate pair
            // --------------------------------------------
            if (
                report.type === "candidate-pair" &&
                report.state === "succeeded" &&
                report.nominated
            ) {
                selectedPair = report;
            }
            // --------------------------------------------
            // VIDEO WE SEND
            // --------------------------------------------
            if (
                report.type === "outbound-rtp" &&
                report.kind === "video"
            ) {
                bytesSent +=
                    report.bytesSent || 0;
                packetsSent +=
                    report.packetsSent || 0;
            }
            // --------------------------------------------
            // VIDEO WE RECEIVE
            // --------------------------------------------
            if (
                report.type === "inbound-rtp" &&
                report.kind === "video"
            ) {
                bytesReceived +=
                    report.bytesReceived || 0;
                packetsReceived +=
                    report.packetsReceived || 0;
                packetsLost +=
                    report.packetsLost || 0;
                jitter =
                    report.jitter || 0;
            }
        }
        // ================================================
        // BITRATE
        // ================================================
        const now =
            performance.now();
        let uploadBitrate = 0;
        let downloadBitrate = 0;

        if (previousTimestamp !== 0) {
            const seconds =
                (
                    now -
                    previousTimestamp
                ) / 1000;
            uploadBitrate =
                (
                    (
                        bytesSent -
                        previousBytesSent
                    ) * 8
                )
                / seconds
                / 1000;
            downloadBitrate =
                (
                    (
                        bytesReceived -
                        previousBytesReceived
                    ) * 8
                )
                / seconds
                / 1000;
        }
        previousBytesSent =
            bytesSent;
        previousBytesReceived =
            bytesReceived;
        previousTimestamp =
            now;
        // ================================================
        // RTT
        // ================================================
        let rtt = null;
        if (
            selectedPair &&
            selectedPair.currentRoundTripTime !== undefined
        ) {
            rtt =
                selectedPair.currentRoundTripTime
                * 1000;
        }
        // ================================================
        // OUTPUT
        // ================================================
        statsInfo.textContent =
`VIDEO

Upload bitrate:
${uploadBitrate.toFixed(0)} kbps

Download bitrate:
${downloadBitrate.toFixed(0)} kbps

TRAFFIC
Sent:
${(bytesSent / 1024 / 1024).toFixed(2)} MB

Received:
${(bytesReceived / 1024 / 1024).toFixed(2)} MB

PACKETS
Sent:
${packetsSent}

Received:
${packetsReceived}

Lost:
${packetsLost}

NETWORK
RTT:
${rtt !== null
    ? rtt.toFixed(1) + " ms"
    : "unknown"}

Jitter:
${(jitter * 1000).toFixed(1)} ms
`;

    } catch (error) {
        console.error(
            "WebRTC stats error:",
            error
        );
        statsInfo.textContent =
            `Stats error: ${error.message}`;
    }
}
function setupDataChannel(channel) {
    dataChannel = channel;
    log(
        "DataChannel created:",
        channel.label
    );
    // --------------------------------------------------------
    // OPEN
    // --------------------------------------------------------
    channel.onopen = () => {
        log( "DataChannel opened" );
        messageInput.disabled = false;
        sendButton.disabled = false;
        chatMessages.textContent =
            "DataChannel connected\n";
    };
    // --------------------------------------------------------
    // MESSAGE
    // --------------------------------------------------------
    channel.onmessage = (event) => {
        log( "DataChannel message received" );
        chatMessages.textContent +=
            `Peer: ${event.data}\n`;
    };
    // --------------------------------------------------------
    // CLOSE
    // --------------------------------------------------------
    channel.onclose = () => {
        log( "DataChannel closed" );
        messageInput.disabled = true;
        sendButton.disabled = true;
        chatMessages.textContent +=
            "DataChannel closed\n";
    };
    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------
    channel.onerror = (error) => {
        console.error( "DataChannel error:", error );
        log( "DataChannel error" );
    };
}
sendButton.onclick = () => {
    sendChatMessage();
};


messageInput.addEventListener(
    "keydown",
    (event) => {
        if (event.key === "Enter") {
            sendChatMessage();
        }
    }
);

function sendChatMessage() {
    const message = messageInput.value.trim();
    if (!message) {
        return;
    }
    if (
        !dataChannel ||
        dataChannel.readyState !== "open"
    ) {
        log( "DataChannel is not open" );
        return;
    }
    // Вот здесь сообщение реально
    // отправляется через WebRTC.
    dataChannel.send(
        message
    );
    chatMessages.textContent +=
        `Me: ${message}\n`;
    messageInput.value =
        "";
}
muteButton.onclick = () => {
    if (!localStream) {
        return;
    }
    const audioTracks =
        localStream.getAudioTracks();
    for (const track of audioTracks) {
        track.enabled =
            !track.enabled;
    }
    isMuted =
        !isMuted;
    muteButton.textContent =
        isMuted
            ? "Unmute"
            : "Mute";
    log(
        "Microphone:",
        isMuted
            ? "OFF"
            : "ON"
    );
};


cameraButton.onclick = () => {
    if (!localStream) {
        return;
    }
    const videoTracks =
        localStream.getVideoTracks();
    for (const track of videoTracks) {
        track.enabled =
            !track.enabled;
    }
    isCameraOff =
        !isCameraOff;
    cameraButton.textContent =
        isCameraOff
            ? "Camera On"
            : "Camera Off";
    log(
        "Camera:",
        isCameraOff
            ? "OFF"
            : "ON"
    );
};