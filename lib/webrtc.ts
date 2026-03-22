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
  ],
};

const peers = new Map<string, RTCPeerConnection>();
let localStream: MediaStream | null = null;

export async function startLocalAudio(): Promise<MediaStream> {
  if (localStream) return localStream;
  const stream = await mediaDevices.getUserMedia({
    audio: true,
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

  // Handle remote stream
  pc.ontrack = (event: any) => {
    if (event.streams && event.streams[0]) {
      onRemoteStream(remoteId, event.streams[0]);
    }
  };

  return pc;
}

export async function createOffer(remoteId: string, onRemoteStream: (id: string, stream: MediaStream) => void) {
  const pc = createPeerConnection(remoteId, onRemoteStream);
  const offer = await pc.createOffer({});
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
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { to: fromId, answer });
}

export async function handleAnswer(fromId: string, answer: any) {
  const pc = peers.get(fromId);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

export async function handleIceCandidate(fromId: string, candidate: any) {
  const pc = peers.get(fromId);
  if (pc) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

export function closeAllPeers() {
  peers.forEach((pc) => pc.close());
  peers.clear();
  stopLocalAudio();
}
