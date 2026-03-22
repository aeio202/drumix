import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { socket } from '@/lib/socket';
import {
  startLocalAudio,
  createOffer,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  closeAllPeers,
} from '@/lib/webrtc';

type MemberLocation = {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
};

export default function ConvoyScreen() {
  const router = useRouter();
  const { code, isLeader } = useLocalSearchParams<{ code: string; isLeader: string }>();
  const [members, setMembers] = useState(isLeader === 'true' ? 1 : 2);
  const [voiceActive, setVoiceActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [myLocation, setMyLocation] = useState<MemberLocation | null>(null);
  const [otherLocations, setOtherLocations] = useState<Map<string, MemberLocation>>(new Map());
  const localStreamRef = useRef<any>(null);
  const mapRef = useRef<MapView>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  // GPS tracking
  useEffect(() => {
    let mounted = true;

    const startTracking = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Eroare', 'Trebuie să permiți accesul la locație');
        return;
      }

      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          if (!mounted) return;
          const myLoc = {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            speed: loc.coords.speed || 0,
            heading: loc.coords.heading || 0,
          };
          setMyLocation(myLoc);
          socket.emit('gps-update', { code, ...myLoc });
        },
      );
    };

    startTracking();

    const onGpsUpdate = (data: { memberId: string; lat: number; lng: number; speed: number; heading: number }) => {
      setOtherLocations((prev) => {
        const next = new Map(prev);
        next.set(data.memberId, { lat: data.lat, lng: data.lng, speed: data.speed, heading: data.heading });
        return next;
      });
    };

    socket.on('gps-update', onGpsUpdate);

    return () => {
      mounted = false;
      locationSubRef.current?.remove();
      socket.off('gps-update', onGpsUpdate);
    };
  }, []);

  // Voice chat + members
  useEffect(() => {
    const onMemberJoined = (data: { count: number }) => setMembers(data.count);
    const onMemberLeft = (data: { memberId: string; count: number }) => {
      setMembers(data.count);
      setOtherLocations((prev) => {
        const next = new Map(prev);
        next.delete(data.memberId);
        return next;
      });
    };

    const onVoiceReady = async ({ from }: { from: string }) => {
      if (localStreamRef.current) {
        try { await createOffer(from, () => {}); } catch {}
      }
    };

    const onWebrtcOffer = async ({ from, offer }: { from: string; offer: any }) => {
      try { await handleOffer(from, offer, () => {}); } catch {}
    };

    const onWebrtcAnswer = async ({ from, answer }: { from: string; answer: any }) => {
      try { await handleAnswer(from, answer); } catch {}
    };

    const onIceCandidate = async ({ from, candidate }: { from: string; candidate: any }) => {
      try { await handleIceCandidate(from, candidate); } catch {}
    };

    socket.on('member-joined', onMemberJoined);
    socket.on('member-left', onMemberLeft);
    socket.on('voice-ready', onVoiceReady);
    socket.on('webrtc-offer', onWebrtcOffer);
    socket.on('webrtc-answer', onWebrtcAnswer);
    socket.on('webrtc-ice-candidate', onIceCandidate);

    return () => {
      socket.off('member-joined', onMemberJoined);
      socket.off('member-left', onMemberLeft);
      socket.off('voice-ready', onVoiceReady);
      socket.off('webrtc-offer', onWebrtcOffer);
      socket.off('webrtc-answer', onWebrtcAnswer);
      socket.off('webrtc-ice-candidate', onIceCandidate);
      closeAllPeers();
    };
  }, []);

  const toggleVoice = async () => {
    if (voiceActive) {
      closeAllPeers();
      localStreamRef.current = null;
      setVoiceActive(false);
      setMuted(false);
    } else {
      try {
        const stream = await startLocalAudio();
        localStreamRef.current = stream;
        setVoiceActive(true);
        socket.emit('voice-ready', code);
      } catch {
        Alert.alert('Eroare', 'Nu s-a putut accesa microfonul');
      }
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMuted(!audioTrack.enabled);
      }
    }
  };

  const leaveConvoy = () => {
    closeAllPeers();
    locationSubRef.current?.remove();
    socket.disconnect();
    router.replace('/');
  };

  const centerOnMe = () => {
    if (myLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: myLocation.lat,
        longitude: myLocation.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    }
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={darkMapStyle}
        initialRegion={{
          latitude: myLocation?.lat || 44.4268,
          longitude: myLocation?.lng || 26.1025,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={false}
      >
        {/* My marker */}
        {myLocation && (
          <Marker
            coordinate={{ latitude: myLocation.lat, longitude: myLocation.lng }}
            title="Tu"
            pinColor="#f4a000"
          />
        )}

        {/* Other members */}
        {[...otherLocations.entries()].map(([id, loc]) => (
          <Marker
            key={id}
            coordinate={{ latitude: loc.lat, longitude: loc.lng }}
            title={`Membru ${id.slice(0, 4)}`}
            pinColor="#4CAF50"
          />
        ))}
      </MapView>

      {/* Top overlay — code + members */}
      <View style={styles.topOverlay}>
        <View style={styles.codeChip}>
          <Text style={styles.codeText}>{code}</Text>
        </View>
        <Text style={styles.membersText}>{members} {members === 1 ? 'membru' : 'membri'}</Text>
      </View>

      {/* Center on me button */}
      <TouchableOpacity style={styles.centerButton} onPress={centerOnMe}>
        <Text style={styles.centerIcon}>📍</Text>
      </TouchableOpacity>

      {/* Bottom controls */}
      <View style={styles.bottomOverlay}>
        <TouchableOpacity
          style={[styles.controlButton, voiceActive && styles.controlButtonActive]}
          onPress={toggleVoice}
        >
          <Text style={styles.controlIcon}>{voiceActive ? '🎙️' : '🔇'}</Text>
          <Text style={styles.controlLabel}>{voiceActive ? 'ON' : 'OFF'}</Text>
        </TouchableOpacity>

        {voiceActive && (
          <TouchableOpacity
            style={[styles.controlButton, muted && styles.controlButtonMuted]}
            onPress={toggleMute}
          >
            <Text style={styles.controlIcon}>{muted ? '🔇' : '🔊'}</Text>
            <Text style={styles.controlLabel}>{muted ? 'Mute' : 'Unmute'}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.leaveBtn} onPress={leaveConvoy}>
          <Text style={styles.controlIcon}>🚪</Text>
          <Text style={styles.leaveLabel}>Ieși</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a3e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3a4e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e0e1a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  map: { flex: 1 },
  topOverlay: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    alignItems: 'center',
  },
  codeChip: {
    backgroundColor: 'rgba(15, 15, 15, 0.85)',
    borderColor: '#f4a000',
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  codeText: { color: '#f4a000', fontWeight: 'bold', fontSize: 18, letterSpacing: 4 },
  membersText: { color: '#aaa', fontSize: 12 },
  centerButton: {
    position: 'absolute',
    right: 16,
    bottom: 140,
    backgroundColor: 'rgba(15, 15, 15, 0.85)',
    borderRadius: 25,
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#333',
    borderWidth: 1,
  },
  centerIcon: { fontSize: 22 },
  bottomOverlay: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  controlButton: {
    backgroundColor: 'rgba(15, 15, 15, 0.9)',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    minWidth: 70,
  },
  controlButtonActive: { borderColor: '#4CAF50' },
  controlButtonMuted: { borderColor: '#ff4444' },
  controlIcon: { fontSize: 24, marginBottom: 4 },
  controlLabel: { color: '#fff', fontSize: 11 },
  leaveBtn: {
    backgroundColor: 'rgba(40, 10, 10, 0.9)',
    borderColor: '#ff4444',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    minWidth: 70,
  },
  leaveLabel: { color: '#ff4444', fontSize: 11 },
});
