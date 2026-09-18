// =========================================================
// DOM
// =========================================================
const statsInfo =
    document.getElementById("statsInfo");

let statsTimer = null;

let previousBytesSent = 0;
let previousBytesReceived = 0;
let previousTimestamp = 0;

const iceInfo =
    document.getElementById("iceInfo");

const connectButton =
    document.getElementById("connect");

const disconnectButton =
    document.getElementById("disconnect");

const status =
    document.getElementById("status");

const localVideo =
    document.getElementById("localVideo");

const remoteVideo =
    document.getElementById("remoteVideo");

const effectSelect =
    document.getElementById("effect");


// =========================================================
// STATE
// =========================================================

let pc = null;
let localStream = null;
let peerId = null;
let dataChannel = null;


// =========================================================
// CONNECT
// =========================================================

connectButton.onclick = async () => {

    console.log("Connecting...");

    connectButton.disabled = true;
    disconnectButton.disabled = true;
    effectSelect.disabled = true;

    status.textContent = "connecting";


    try {

        // -------------------------------------------------
        // 1. CAMERA
        // -------------------------------------------------

        localStream =
            await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });


        console.log(
            "Camera received"
        );


        localVideo.srcObject =
            localStream;


        // -------------------------------------------------
        // 2. PEER CONNECTION
        // -------------------------------------------------

        pc = new RTCPeerConnection({
            iceServers: [
                {
                    urls: "turn:192.168.1.109:3478?transport=udp",
                    username: "webrtc",
                    credential: "test123456"
                }
            ],

            iceTransportPolicy: "relay"
        });


        console.log(
            "RTCPeerConnection created"
        );


        // -------------------------------------------------
        // 3. ICE CANDIDATES
        // -------------------------------------------------

        pc.onicecandidate = (event) => {

            if (event.candidate) {

                console.log(
                    "ICE candidate:",
                    event.candidate.candidate
                );

            } else {

                console.log(
                    "ICE gathering finished"
                );
            }
        };


        // -------------------------------------------------
        // 4. ICE CONNECTION STATE
        // -------------------------------------------------

        pc.oniceconnectionstatechange = () => {

            console.log(
                "ICE state:",
                pc.iceConnectionState
            );
        };


        // -------------------------------------------------
        // 5. DATA CHANNEL
        // -------------------------------------------------

        dataChannel =
            pc.createDataChannel(
                "control"
            );


        console.log(
            "DataChannel created"
        );


        dataChannel.onopen = () => {

            console.log(
                "DataChannel opened"
            );


            effectSelect.disabled =
                false;
        };


        dataChannel.onclose = () => {

            console.log(
                "DataChannel closed"
            );


            effectSelect.disabled =
                true;
        };


        dataChannel.onerror = (error) => {

            console.error(
                "DataChannel error:",
                error
            );
        };


        dataChannel.onmessage = (event) => {

            console.log(
                "Message from Python:",
                event.data
            );


            try {

                const message =
                    JSON.parse(
                        event.data
                    );


                console.log(
                    "Parsed message:",
                    message
                );

            } catch {

                console.log(
                    "Text message:",
                    event.data
                );
            }
        };


        // -------------------------------------------------
        // 6. CONNECTION STATE
        // -------------------------------------------------

        pc.onconnectionstatechange =
            async () => {

                console.log(
                    "Connection:",
                    pc.connectionState
                );


                status.textContent =
                    pc.connectionState;


                if (
                    pc.connectionState ===
                    "connected"
                ) {

                    disconnectButton.disabled =
                        false;


                    // ICE уже выбрал рабочий маршрут.
                    // Посмотрим его через getStats().
                    await printSelectedCandidatePair();

                    if (!statsTimer) {
                        statsTimer =
                            setInterval(
                                updateWebRTCStats,
                                1000
                            );
                    }
                }


                if (
                    pc.connectionState ===
                    "failed"
                ) {

                    await disconnect();
                }
            };


        // -------------------------------------------------
        // 7. REMOTE VIDEO
        // -------------------------------------------------

        pc.ontrack = (event) => {

            console.log(
                "Remote track:",
                event.track.kind
            );


            if (
                event.streams.length > 0
            ) {

                remoteVideo.srcObject =
                    event.streams[0];

            } else {

                remoteVideo.srcObject =
                    new MediaStream([
                        event.track
                    ]);
            }
        };


        // -------------------------------------------------
        // 8. LOCAL VIDEO TRACK
        // -------------------------------------------------

        for (
            const track
            of localStream.getTracks()
        ) {

            console.log(
                "Adding local track:",
                track.kind
            );


            pc.addTrack(
                track,
                localStream
            );
        }


        // -------------------------------------------------
        // 9. SDP OFFER
        // -------------------------------------------------

        const offer =
            await pc.createOffer();


        await pc.setLocalDescription(
            offer
        );


        console.log(
            "========== LOCAL SDP =========="
        );


        console.log(
            pc.localDescription.sdp
        );


        // -------------------------------------------------
        // 10. SIGNALING
        // -------------------------------------------------

        const response =
            await fetch(
                "/offer",
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        sdp:
                            pc.localDescription.sdp,

                        type:
                            pc.localDescription.type
                    })
                }
            );


        if (!response.ok) {

            throw new Error(
                `Offer failed: HTTP ${
                    response.status
                }`
            );
        }


        // -------------------------------------------------
        // 11. SDP ANSWER
        // -------------------------------------------------

        const answer =
            await response.json();


        peerId =
            answer.peer_id;


        console.log(
            "Peer ID:",
            peerId
        );


        console.log(
            "========== REMOTE SDP =========="
        );


        console.log(
            answer.sdp
        );


        // -------------------------------------------------
        // 12. SET REMOTE DESCRIPTION
        // -------------------------------------------------

        await pc.setRemoteDescription({

            sdp:
                answer.sdp,

            type:
                answer.type
        });


        console.log(
            "Remote description set"
        );


    } catch (error) {

        console.error(
            "Connection error:",
            error
        );


        status.textContent =
            "error";


        await disconnect();
    }
};


// =========================================================
// SELECTED ICE CANDIDATE PAIR
// =========================================================

async function printSelectedCandidatePair() {

    if (!pc) {
        return;
    }

    try {
        const stats = await pc.getStats();

        let text = "";

        // ==========================================
        // ALL LOCAL CANDIDATES
        // ==========================================

        text += "ALL LOCAL CANDIDATES\n\n";

        for (const report of stats.values()) {

            if (report.type === "local-candidate") {

                text +=
`type:     ${report.candidateType}
address:  ${report.address ?? report.ip ?? "hidden"}
port:     ${report.port}
protocol: ${report.protocol}

`;
            }
        }


        // ==========================================
        // ALL REMOTE CANDIDATES
        // ==========================================

        text += "\nALL REMOTE CANDIDATES\n\n";

        for (const report of stats.values()) {

            if (report.type === "remote-candidate") {

                text +=
`type:     ${report.candidateType}
address:  ${report.address ?? report.ip ?? "hidden"}
port:     ${report.port}
protocol: ${report.protocol}

`;
            }
        }


        // ==========================================
        // SELECTED PAIR
        // ==========================================

        text += "\nSELECTED ICE PAIR\n\n";


        for (const report of stats.values()) {

            if (
                report.type === "candidate-pair"
                &&
                report.state === "succeeded"
                &&
                report.nominated
            ) {

                const localCandidate =
                    stats.get(
                        report.localCandidateId
                    );

                const remoteCandidate =
                    stats.get(
                        report.remoteCandidateId
                    );


                text +=
`LOCAL
type:     ${localCandidate?.candidateType}
address:  ${localCandidate?.address ?? localCandidate?.ip ?? "hidden"}
port:     ${localCandidate?.port}
protocol: ${localCandidate?.protocol}

REMOTE
type:     ${remoteCandidate?.candidateType}
address:  ${remoteCandidate?.address ?? remoteCandidate?.ip ?? "hidden"}
port:     ${remoteCandidate?.port}
protocol: ${remoteCandidate?.protocol}

PAIR
state:     ${report.state}
nominated: ${report.nominated}
`;
            }
        }


        iceInfo.textContent = text;


    } catch (error) {

        console.error(
            "getStats error:",
            error
        );

        iceInfo.textContent =
            `Stats error: ${error}`;
    }
}


// =========================================================
// EFFECT CHANGE
// =========================================================

effectSelect.onchange = () => {

    const effect =
        effectSelect.value;


    if (!dataChannel) {

        console.warn(
            "DataChannel does not exist"
        );

        return;
    }


    if (
        dataChannel.readyState !==
        "open"
    ) {

        console.warn(
            "DataChannel is not open"
        );

        return;
    }


    const message = {

        type:
            "effect",

        value:
            effect
    };


    console.log(
        "Sending DataChannel message:",
        message
    );


    dataChannel.send(
        JSON.stringify(
            message
        )
    );
};


// =========================================================
// DISCONNECT BUTTON
// =========================================================

disconnectButton.onclick =
    async () => {

        await disconnect();
    };


// =========================================================
// DISCONNECT
// =========================================================

async function disconnect() {

    console.log(
        "Disconnecting..."
    );

    iceInfo.textContent =
    "Waiting for connection...";


    // Сохраняем ID перед очисткой состояния.
    const id =
        peerId;


    peerId =
        null;


    // -----------------------------------------------------
    // 1. DATA CHANNEL
    // -----------------------------------------------------

    if (dataChannel) {

        console.log(
            "Closing DataChannel"
        );


        dataChannel.close();


        dataChannel =
            null;
    }


    // -----------------------------------------------------
    // 2. CAMERA
    // -----------------------------------------------------

    if (localStream) {

        for (
            const track
            of localStream.getTracks()
        ) {

            console.log(
                "Stopping track:",
                track.kind
            );


            track.stop();
        }


        localStream =
            null;
    }


    // -----------------------------------------------------
    // 3. PEER CONNECTION
    // -----------------------------------------------------

    if (pc) {

        console.log(
            "Closing RTCPeerConnection"
        );


        pc.ontrack =
            null;

        pc.onconnectionstatechange =
            null;

        pc.onicecandidate =
            null;

        pc.oniceconnectionstatechange =
            null;


        pc.close();


        pc =
            null;
    }


    // -----------------------------------------------------
    // 4. VIDEO
    // -----------------------------------------------------

    localVideo.srcObject =
        null;


    remoteVideo.srcObject =
        null;


    // -----------------------------------------------------
    // 5. UI
    // -----------------------------------------------------

    status.textContent =
        "disconnected";


    connectButton.disabled =
        false;


    disconnectButton.disabled =
        true;


    effectSelect.disabled =
        true;


    effectSelect.value =
        "original";


    // -----------------------------------------------------
    // 6. NOTIFY PYTHON
    // -----------------------------------------------------

    if (id) {

        try {

            const response =
                await fetch(
                    `/peers/${id}/close`,
                    {
                        method:
                            "POST"
                    }
                );


            console.log(
                "Server close status:",
                response.status
            );


        } catch (error) {

            console.error(
                "Failed to notify server:",
                error
            );
        }
    }

    if (statsTimer) {

        clearInterval(
            statsTimer
        );

        statsTimer =
            null;
    }


    previousBytesSent = 0;
    previousBytesReceived = 0;
    previousTimestamp = 0;


    statsInfo.textContent =
        "Waiting for connection...";


    console.log(
        "Disconnected"
    );
}


async function updateWebRTCStats() {

    if (!pc) {
        return;
    }

    const stats =
        await pc.getStats();

    let selectedPair = null;

    let bytesSent = 0;
    let bytesReceived = 0;

    let packetsSent = 0;
    let packetsReceived = 0;

    let packetsLost = 0;
    let jitter = 0;


    for (const report of stats.values()) {

        // -----------------------------------------
        // SELECTED ICE PAIR
        // -----------------------------------------

        if (
            report.type === "candidate-pair"
            &&
            report.state === "succeeded"
            &&
            report.nominated
        ) {
            selectedPair = report;
        }


        // -----------------------------------------
        // OUTBOUND VIDEO
        // -----------------------------------------

        if (
            report.type === "outbound-rtp"
            &&
            report.kind === "video"
        ) {

            bytesSent +=
                report.bytesSent || 0;

            packetsSent +=
                report.packetsSent || 0;
        }


        // -----------------------------------------
        // INBOUND VIDEO
        // -----------------------------------------

        if (
            report.type === "inbound-rtp"
            &&
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


    // ---------------------------------------------
    // BITRATE
    // ---------------------------------------------

    const now =
        performance.now();


    let uploadBitrate = 0;
    let downloadBitrate = 0;


    if (previousTimestamp !== 0) {

        const seconds =
            (now - previousTimestamp)
            / 1000;


        uploadBitrate =
            (
                (bytesSent - previousBytesSent)
                * 8
                / seconds
                / 1000
            );


        downloadBitrate =
            (
                (bytesReceived - previousBytesReceived)
                * 8
                / seconds
                / 1000
            );
    }


    previousBytesSent =
        bytesSent;

    previousBytesReceived =
        bytesReceived;

    previousTimestamp =
        now;


    // ---------------------------------------------
    // RTT
    // ---------------------------------------------

    let rtt = null;


    if (
        selectedPair
        &&
        selectedPair.currentRoundTripTime
            !== undefined
    ) {

        rtt =
            selectedPair.currentRoundTripTime
            * 1000;
    }


    // ---------------------------------------------
    // UI
    // ---------------------------------------------

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
}