import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { Platform, PermissionsAndroid } from 'react-native';
import { socket } from './socket';
import { addLog } from './debugLog';

const METERED_API_KEY = 'Z6iRsIsOM6GimJl2R_zghiVGbaYvjeH3I_FBRT720GYSmmGe';
const FALLBACK_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
let iceServerPromise: Promise<any[]> | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getIceServers(): Promise<any[]> {
  const now = Date.now();
  if (iceServerPromise && now - cacheTime < CACHE_TTL) {
    addLog('ICE', 'Using cached TURN credentials');
    return iceServerPromise;
  }
  cacheTime = now;
  iceServerPromise = fetch(
    `https://drumix.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
  )
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((servers) => {
      addLog('ICE', `Fetched ${servers.length} TURN server(s) from Metered`);
      return servers;
    })
    .catch((e: any) => {
      iceServerPromise = null; // allow retry on next call
      addLog('ERROR', `TURN fetch failed: ${e.message} — using fallback STUN only`);
      return FALLBACK_ICE;
    });
  return iceServerPromise;
}

const peers = new Map<string, RTCPeerConnection>();
const remoteStreams = new Map<string, MediaStream>();
// ICE candidates that arrive before the peer connection / remote description is ready
const pendingCandidates = new Map<string, any[]>();
let localStream: MediaStream | null = null;

export async function startLocalAudio(): Promise<MediaStream> {
  if (localStream) {
    addLog('MIC', 'Reusing existing local stream');
    return localStream;
  }

  // Request runtime mic permission on Android (dangerous permission)
  if (Platform.OS === 'android') {
    addLog('MIC', 'Requesting Android RECORD_AUDIO permission...');
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Permisiune microfon',
        message: 'Drumix are nevoie de microfon pentru voice chat',
        buttonPositive: 'Permite',
        buttonNegative: 'Refuză',
      }
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      addLog('ERROR', `Mic permission denied: ${result}`);
      throw new Error('Permisiune microfon refuzată. Mergi la Setări › Aplicații › Drumix › Permisiuni.');
    }
    addLog('MIC', 'Android mic permission granted');
  }

  addLog('MIC', 'Requesting microphone access...');
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localStream = stream as MediaStream;
    const trackCount = localStream.getAudioTracks().length;
    addLog('MIC', `Mic started OK — ${trackCount} audio track(s)`);
    return localStream;
  } catch (e: any) {
    addLog('ERROR', `Mic failed: ${e?.message ?? e}`);
    throw e;
  }
}

export function stopLocalAudio() {
  if (localStream) {
    addLog('MIC', 'Stopping local audio tracks');
    localStream.getTracks().forEach((t: any) => t.stop());
    localStream = null;
  }
}

async function flushPendingCandidates(peerId: string, pc: RTCPeerConnection) {
  const queued = pendingCandidates.get(peerId) ?? [];
  pendingCandidates.delete(peerId);
  if (queued.length > 0) {
    addLog('ICE', `Flushing ${queued.length} queued candidate(s) for ${peerId.slice(0, 6)}`);
  }
  for (const c of queued) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      addLog('ERROR', `Queued ICE flush failed for ${peerId.slice(0, 6)}: ${e}`);
    }
  }
}

export async function createPeerConnection(
  remoteId: string,
  onRemoteStream: (id: string, stream: MediaStream) => void,
): Promise<RTCPeerConnection> {
  if (peers.has(remoteId)) {
    addLog('WEBRTC', `Closing old PC for ${remoteId.slice(0, 6)}`);
    peers.get(remoteId)!.close();
    pendingCandidates.delete(remoteId);
  }

  const iceServers = await getIceServers();
  addLog('WEBRTC', `Creating PC for ${remoteId.slice(0, 6)}, localStream=${localStream ? 'YES' : 'NO'}`);
  const pc = new RTCPeerConnection({ iceServers });
  peers.set(remoteId, pc);

  // Add local audio tracks
  if (localStream) {
    const tracks = localStream.getTracks();
    addLog('WEBRTC', `Adding ${tracks.length} local track(s) to PC`);
    tracks.forEach((track: any) => {
      pc.addTrack(track, localStream!);
    });
  } else {
    addLog('ERROR', `No localStream when creating PC for ${remoteId.slice(0, 6)} — audio won't be sent!`);
  }

  // ICE candidates
  pc.onicecandidate = (event: any) => {
    if (event.candidate) {
      addLog('ICE', `Sending candidate to ${remoteId.slice(0, 6)} (${event.candidate.type ?? '?'})`);
      socket.emit('webrtc-ice-candidate', {
        to: remoteId,
        candidate: event.candidate,
      });
    } else {
      addLog('ICE', `ICE gathering complete for ${remoteId.slice(0, 6)}`);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = (pc as any).iceConnectionState;
    addLog('ICE', `(${remoteId.slice(0, 6)}) state → ${state}`);
  };

  (pc as any).onicegatheringstatechange = () => {
    const state = (pc as any).iceGatheringState;
    addLog('ICE', `(${remoteId.slice(0, 6)}) gathering → ${state}`);
  };

  (pc as any).onsignalingstatechange = () => {
    const state = (pc as any).signalingState;
    addLog('WEBRTC', `(${remoteId.slice(0, 6)}) signaling → ${state}`);
  };

  // Handle remote stream
  pc.ontrack = (event: any) => {
    const streamCount = event.streams?.length ?? 0;
    addLog('WEBRTC', `ontrack from ${remoteId.slice(0, 6)}: streams=${streamCount}, track.kind=${event.track?.kind}`);
    let stream: MediaStream | undefined = event.streams?.[0];
    if (!stream && event.track) {
      addLog('WEBRTC', `Empty streams — wrapping track in new MediaStream`);
      stream = new MediaStream([event.track] as any);
    }
    if (stream) {
      remoteStreams.set(remoteId, stream);
      addLog('WEBRTC', `Remote stream stored for ${remoteId.slice(0, 6)}`);
      onRemoteStream(remoteId, stream);
    } else {
      addLog('ERROR', `ontrack: no stream and no track from ${remoteId.slice(0, 6)}`);
    }
  };

  return pc;
}

export async function createOffer(remoteId: string, onRemoteStream: (id: string, stream: MediaStream) => void) {
  addLog('WEBRTC', `Creating offer → ${remoteId.slice(0, 6)}`);
  const pc = await createPeerConnection(remoteId, onRemoteStream);
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false } as any);
  await pc.setLocalDescription(offer);
  addLog('WEBRTC', `Offer sent → ${remoteId.slice(0, 6)}`);
  socket.emit('webrtc-offer', { to: remoteId, offer });
}

export async function handleOffer(
  fromId: string,
  offer: any,
  onRemoteStream: (id: string, stream: MediaStream) => void,
) {
  addLog('WEBRTC', `Handling offer from ${fromId.slice(0, 6)}`);
  const pc = await createPeerConnection(fromId, onRemoteStream);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  await flushPendingCandidates(fromId, pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  addLog('WEBRTC', `Answer sent → ${fromId.slice(0, 6)}`);
  socket.emit('webrtc-answer', { to: fromId, answer });
}

export async function handleAnswer(fromId: string, answer: any) {
  addLog('WEBRTC', `Handling answer from ${fromId.slice(0, 6)}`);
  const pc = peers.get(fromId);
  if (!pc) {
    addLog('ERROR', `handleAnswer: no PC for ${fromId.slice(0, 6)}`);
    return;
  }
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  await flushPendingCandidates(fromId, pc);
  addLog('WEBRTC', `Remote description set for ${fromId.slice(0, 6)}`);
}

export async function handleIceCandidate(fromId: string, candidate: any) {
  const pc = peers.get(fromId);
  // Queue if peer doesn't exist yet or remote description not set
  const remoteDesc = pc ? (pc as any).remoteDescription : null;
  const hasRemoteDesc = remoteDesc && remoteDesc.type;
  if (!pc || !hasRemoteDesc) {
    if (!pendingCandidates.has(fromId)) pendingCandidates.set(fromId, []);
    pendingCandidates.get(fromId)!.push(candidate);
    const queueLen = pendingCandidates.get(fromId)!.length;
    addLog('ICE', `Queued ICE from ${fromId.slice(0, 6)} (${!pc ? 'no PC' : 'no remoteDesc'}, queue=${queueLen})`);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
    addLog('ICE', `Applied ICE from ${fromId.slice(0, 6)}`);
  } catch (e: any) {
    addLog('ERROR', `addIceCandidate from ${fromId.slice(0, 6)}: ${e?.message ?? e}`);
  }
}

export function setAllRemoteVolume(volume: number) {
  remoteStreams.forEach((stream) => {
    stream.getAudioTracks().forEach((track: any) => {
      if (typeof track._setVolume === 'function') {
        track._setVolume(volume);
      }
    });
  });
}

export function closeAllPeers() {
  addLog('WEBRTC', `closeAllPeers: closing ${peers.size} peer(s)`);
  peers.forEach((pc) => pc.close());
  peers.clear();
  remoteStreams.clear();
  pendingCandidates.clear();
  stopLocalAudio();
}
