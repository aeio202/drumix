import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { socket } from './socket';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:drumix.metered.live:80',
      username: '0cbfd568101d08d5bdc38d06',
      credential: 'QBzDW5493GG3h39c',
    },
    {
      urls: 'turn:drumix.metered.live:443',
      username: '0cbfd568101d08d5bdc38d06',
      credential: 'QBzDW5493GG3h39c',
    },
    {
      urls: 'turns:drumix.metered.live:443',
      username: '0cbfd568101d08d5bdc38d06',
      credential: 'QBzDW5493GG3h39c',
    },
  ],
};

const peers = new Map<string, RTCPeerConnection>();
const remoteStreams = new Map<string, MediaStream>();
// ICE candidates that arrive before the peer connection / remote description is ready
const pendingCandidates = new Map<string, any[]>();
let localStream: MediaStream | null = null;

export async function startLocalAudio(): Promise<MediaStream> {
  if (localStream) return localStream;
  const stream = await mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  localStream = stream as MediaStream;
  return localStream;
}

export function stopLocalAudio() {
  if (localStream) {
    localStream.getTracks().forEach((t: any) => t.stop());
    localStream = null;
  }
}

async function flushPendingCandidates(peerId: string, pc: RTCPeerConnection) {
  const queued = pendingCandidates.get(peerId) ?? [];
  pendingCandidates.delete(peerId);
  for (const c of queued) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      console.warn('[webrtc] queued ICE candidate failed:', e);
    }
  }
}

export function createPeerConnection(
  remoteId: string,
  onRemoteStream: (id: string, stream: MediaStream) => void,
): RTCPeerConnection {
  if (peers.has(remoteId)) {
    peers.get(remoteId)!.close();
  }

  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers.set(remoteId, pc);

  // Add local audio tracks
  if (localStream) {
    localStream.getTracks().forEach((track: any) => {
      pc.addTrack(track, localStream!);
    });
  }

  // Handle ICE candidates
  pc.onicecandidate = (event: any) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        to: remoteId,
        candidate: event.candidate,
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[webrtc] ICE state (${remoteId.slice(0, 6)}): ${(pc as any).iceConnectionState}`);
  };

  // Handle remote stream — react-native-webrtc may return empty event.streams;
  // fall back to wrapping event.track in a new MediaStream.
  pc.ontrack = (event: any) => {
    let stream: MediaStream | undefined = event.streams?.[0];
    if (!stream && event.track) {
      stream = new MediaStream([event.track] as any);
    }
    if (stream) {
      remoteStreams.set(remoteId, stream);
      onRemoteStream(remoteId, stream);
    }
  };

  return pc;
}

export async function createOffer(remoteId: string, onRemoteStream: (id: string, stream: MediaStream) => void) {
  const pc = createPeerConnection(remoteId, onRemoteStream);
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false } as any);
  await pc.setLocalDescription(offer);
  socket.emit('webrtc-offer', { to: remoteId, offer });
}

export async function handleOffer(
  fromId: string,
  offer: any,
  onRemoteStream: (id: string, stream: MediaStream) => void,
) {
  const pc = createPeerConnection(fromId, onRemoteStream);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  // Flush ICE candidates that arrived before we processed this offer
  await flushPendingCandidates(fromId, pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { to: fromId, answer });
}

export async function handleAnswer(fromId: string, answer: any) {
  const pc = peers.get(fromId);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    // Flush ICE candidates that arrived before we processed this answer
    await flushPendingCandidates(fromId, pc);
  }
}

export async function handleIceCandidate(fromId: string, candidate: any) {
  const pc = peers.get(fromId);
  // Queue if peer doesn't exist yet or remote description not set yet
  if (!pc || !(pc as any).remoteDescription) {
    if (!pendingCandidates.has(fromId)) pendingCandidates.set(fromId, []);
    pendingCandidates.get(fromId)!.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.warn('[webrtc] addIceCandidate error:', e);
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
  peers.forEach((pc) => pc.close());
  peers.clear();
  remoteStreams.clear();
  pendingCandidates.clear();
  stopLocalAudio();
}
