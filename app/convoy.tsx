import { View, Text, TouchableOpacity, StyleSheet, Alert, AppState } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import MapView, { Marker, Polyline, LatLng } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { socket } from '@/lib/socket';
import {
  startLocalAudio,
  createOffer,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  closeAllPeers,
} from '@/lib/webrtc';

function decodePolyline(encoded: string): LatLng[] {
  if (!encoded || typeof encoded !== 'string') return [];
  const points: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

type MemberLocation = {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
};

const GOOGLE_API_KEY = (Constants.expoConfig?.extra?.googleDirectionsApiKey as string) ?? '';

export default function ConvoyScreen() {
  const router = useRouter();
  const { code, isLeader, count: initialCount } = useLocalSearchParams<{ code: string; isLeader: string; count: string }>();
  const [members, setMembers] = useState(() => {
    const n = parseInt(initialCount ?? '', 10);
    return isNaN(n) ? 1 : n;
  });
  const [voiceActive, setVoiceActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [remoteVoiceCount, setRemoteVoiceCount] = useState(0);
  const voiceActiveRef = useRef(false);
  const remoteVoiceIdsRef = useRef<Set<string>>(new Set());

  const [myLocation, setMyLocation] = useState<MemberLocation | null>(null);
  const [otherLocations, setOtherLocations] = useState<Map<string, MemberLocation>>(new Map());
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const myLocationRef = useRef<MemberLocation | null>(null);
  const localStreamRef = useRef<any>(null);
  const mapRef = useRef<MapView>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  // GPS tracking
  useEffect(() => {
    if (!code) return;
    let mounted = true;

    const startTracking = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Eroare', 'Trebuie să permiți accesul la locație');
        return;
      }

      const sub = await Location.watchPositionAsync(
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
          const isFirst = myLocationRef.current === null;
          setMyLocation(myLoc);
          myLocationRef.current = myLoc;
          if (isFirst && mounted && mapRef.current) {
            mapRef.current.animateToRegion({
              latitude: myLoc.lat,
              longitude: myLoc.lng,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }, 300);
          }
          socket.emit('gps-update', { code, ...myLoc });
          // Trim route behind user
          setRouteCoords((prev) => {
            if (prev.length < 2) return prev;
            let closest = 0;
            let minDist = Infinity;
            for (let i = 0; i < prev.length; i++) {
              const d = Math.pow(prev[i].latitude - myLoc.lat, 2) + Math.pow(prev[i].longitude - myLoc.lng, 2);
              if (d < minDist) { minDist = d; closest = i; }
            }
            return prev.slice(closest);
          });
        },
      );

      if (!mounted) {
        // Component unmounted while watchPositionAsync was pending — remove immediately
        sub.remove();
        return;
      }
      locationSubRef.current = sub;
    };

    startTracking();

    const onGpsUpdate = (data: { memberId: string; lat: number; lng: number; speed: number; heading: number }) => {
      setOtherLocations((prev) => {
        const next = new Map(prev);
        next.set(data.memberId, { lat: data.lat, lng: data.lng, speed: data.speed, heading: data.heading });
        return next;
      });
    };

    const onReconnect = () => {
      socket.emit('rejoin-convoy', code);
    };

    socket.on('gps-update', onGpsUpdate);
    socket.on('connect', onReconnect);

    return () => {
      mounted = false;
      locationSubRef.current?.remove();
      locationSubRef.current = null;
      socket.off('gps-update', onGpsUpdate);
      socket.off('connect', onReconnect);
    };
  }, [code]);

  // Auto-reconnect when app comes back to foreground
  useEffect(() => {
    if (!code) return;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        if (!socket.connected) {
          socket.connect();
          socket.once('connect', () => {
            socket.emit('rejoin-convoy', code);
          });
        }
        if (!locationSubRef.current) {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            locationSubRef.current = await Location.watchPositionAsync(
              { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 },
              (loc) => {
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
          } else {
            Alert.alert('Eroare', 'Locația a fost dezactivată. Activează-o pentru a continua în convoi.');
          }
        }
      } else if (state === 'background') {
        locationSubRef.current?.remove();
        locationSubRef.current = null;
      }
    });

    return () => sub.remove();
  }, [code]);

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
      remoteVoiceIdsRef.current.delete(data.memberId);
      setRemoteVoiceCount(remoteVoiceIdsRef.current.size);
    };

    const ensureMic = async (): Promise<boolean> => {
      if (localStreamRef.current) return true;
      try {
        const stream = await startLocalAudio();
        localStreamRef.current = stream;
        return true;
      } catch (e: any) {
        console.error('[voice] Failed to start local audio:', e);
        Alert.alert('Eroare', 'Nu s-a putut accesa microfonul');
        return false;
      }
    };

    const onVoiceReady = ({ from }: { from: string }) => {
      remoteVoiceIdsRef.current.add(from);
      setRemoteVoiceCount(remoteVoiceIdsRef.current.size);
      // Nu auto-conectăm — userul apasă manual butonul de voice ca să se alăture
    };

    const onWebrtcOffer = async ({ from, offer }: { from: string; offer: any }) => {
      const ok = await ensureMic();
      if (!ok) return;
      try {
        await handleOffer(from, offer, (_id, _stream) => {
          setVoiceActive(true);
        });
      } catch (e: any) {
        console.error('[webrtc] handleOffer error:', e);
      }
    };

    const onWebrtcAnswer = async ({ from, answer }: { from: string; answer: any }) => {
      try {
        await handleAnswer(from, answer);
      } catch (e: any) {
        console.error('[webrtc] handleAnswer error:', e);
      }
    };

    const onIceCandidate = async ({ from, candidate }: { from: string; candidate: any }) => {
      try {
        await handleIceCandidate(from, candidate);
      } catch (e: any) {
        console.error('[webrtc] ICE candidate error:', e);
      }
    };

    const onDestination = (data: { lat: number; lng: number }) => {
      const dest = { latitude: data.lat, longitude: data.lng };
      setDestination(dest);
      if (myLocationRef.current) {
        fetchRouteFromRef(dest);
      }
    };

    socket.on('member-joined', onMemberJoined);
    socket.on('member-left', onMemberLeft);
    socket.on('voice-ready', onVoiceReady);
    socket.on('webrtc-offer', onWebrtcOffer);
    socket.on('webrtc-answer', onWebrtcAnswer);
    socket.on('webrtc-ice-candidate', onIceCandidate);
    socket.on('destination-set', onDestination);

    return () => {
      socket.off('member-joined', onMemberJoined);
      socket.off('member-left', onMemberLeft);
      socket.off('voice-ready', onVoiceReady);
      socket.off('webrtc-offer', onWebrtcOffer);
      socket.off('webrtc-answer', onWebrtcAnswer);
      socket.off('webrtc-ice-candidate', onIceCandidate);
      socket.off('destination-set', onDestination);
      closeAllPeers();
    };
  }, []);

  const toggleVoice = async () => {
    if (voiceActive) {
      closeAllPeers();
      localStreamRef.current = null;
      voiceActiveRef.current = false;
      setVoiceActive(false);
      setMuted(false);
    } else {
      try {
        const stream = await startLocalAudio();
        localStreamRef.current = stream;
        voiceActiveRef.current = true;
        setVoiceActive(true);
        socket.emit('voice-ready', code);
        // Conectează-te la cei deja în voice
        for (const targetId of remoteVoiceIdsRef.current) {
          try {
            await createOffer(targetId, () => {});
          } catch (e: any) {
            console.error('[webrtc] offer error:', e);
          }
        }
      } catch (e: any) {
        console.error('[voice] toggleVoice error:', e);
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

  const fetchRoute = async (origin: LatLng, dest: LatLng) => {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${dest.latitude},${dest.longitude}&mode=driving&key=${GOOGLE_API_KEY}`
      );
      if (!res.ok) {
        Alert.alert('Eroare', `Eroare server: ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.routes?.length > 0) {
        const polylineStr = data.routes[0]?.overview_polyline?.points;
        const points = decodePolyline(polylineStr ?? '');
        setRouteCoords(points);
      } else {
        Alert.alert('Rută', `Status: ${data.status}\n${data.error_message || 'No routes found'}`);
      }
    } catch (e: any) {
      Alert.alert('Eroare', e.message || 'Nu s-a putut calcula ruta');
    }
  };

  const fetchRouteFromRef = (dest: LatLng) => {
    if (myLocationRef.current) {
      fetchRoute({ latitude: myLocationRef.current.lat, longitude: myLocationRef.current.lng }, dest);
    }
  };

  const handleLongPress = (e: any) => {
    if (isLeader !== 'true') return;
    const coord = e.nativeEvent.coordinate;
    const dest = { latitude: coord.latitude, longitude: coord.longitude };
    setDestination(dest);
    if (myLocation) {
      fetchRoute({ latitude: myLocation.lat, longitude: myLocation.lng }, dest);
    }
    socket.emit('set-destination', { code, lat: dest.latitude, lng: dest.longitude });
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

  const fitAll = () => {
    if (!mapRef.current) return;
    const allLocs: { lat: number; lng: number }[] = [];
    if (myLocation) allLocs.push(myLocation);
    otherLocations.forEach((loc) => allLocs.push(loc));
    if (allLocs.length === 0) return;
    if (allLocs.length === 1) {
      centerOnMe();
      return;
    }
    const lats = allLocs.map((l) => l.lat);
    const lngs = allLocs.map((l) => l.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const padding = 0.005;
    mapRef.current.animateToRegion({
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(maxLat - minLat + padding * 2, 0.005),
      longitudeDelta: Math.max(maxLng - minLng + padding * 2, 0.005),
    }, 500);
  };

  if (!code) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: '#ff4444', fontSize: 16 }}>Eroare: cod convoi lipsă</Text>
      </View>
    );
  }

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
        toolbarEnabled={false}
        onLongPress={handleLongPress}
      >
        {/* My marker */}
        {myLocation && (
          <Marker
            coordinate={{ latitude: myLocation.lat, longitude: myLocation.lng }}
            title="Tu"
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={myLocation.heading}
          >
            <CarIcon color="#f4a000" />
          </Marker>
        )}

        {/* Other members */}
        {[...otherLocations.entries()].map(([id, loc]) => (
          <Marker
            key={id}
            coordinate={{ latitude: loc.lat, longitude: loc.lng }}
            title={`Membru ${id.slice(0, 4)}`}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={loc.heading}
          >
            <CarIcon color="#4CAF50" />
          </Marker>
        ))}
        {/* Route polyline */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#f4a000"
            strokeWidth={4}
          />
        )}

        {/* Destination marker */}
        {destination && (
          <Marker
            coordinate={destination}
            title="Destinație"
            pinColor="#ff4444"
          />
        )}
      </MapView>

      {/* Top overlay — code + members */}
      <View style={styles.topOverlay}>
        <View style={styles.codeChip}>
          <Text style={styles.codeText}>{code}</Text>
        </View>
        <Text style={styles.membersText}>{members} {members === 1 ? 'membru' : 'membri'}</Text>
      </View>

      {/* Map buttons */}
      <TouchableOpacity style={styles.centerButton} onPress={centerOnMe}>
        <Text style={styles.centerIcon}>📍</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.fitAllButton} onPress={fitAll}>
        <Text style={styles.centerIcon}>👥</Text>
      </TouchableOpacity>

      {/* Bottom controls */}
      <View style={styles.bottomOverlay}>
        <View style={styles.buttonsRow}>
          {/* Voice toggle */}
          <TouchableOpacity
            style={[
              styles.controlButton,
              voiceActive && styles.controlButtonActive,
              !voiceActive && remoteVoiceCount > 0 && styles.controlButtonPending,
            ]}
            onPress={toggleVoice}
          >
            <Text style={styles.controlIcon}>{voiceActive ? '🎙️' : '🔇'}</Text>
            <Text style={styles.controlLabel}>
              {voiceActive ? 'Voice' : remoteVoiceCount > 0 ? `Join (${remoteVoiceCount})` : 'OFF'}
            </Text>
          </TouchableOpacity>

          {/* Mute — Discord style */}
          {voiceActive && (
            <TouchableOpacity
              style={[styles.controlButton, muted ? styles.controlButtonMuted : styles.controlButtonActive]}
              onPress={toggleMute}
            >
              <View style={styles.micContainer}>
                <Text style={styles.controlIcon}>🎤</Text>
                {muted && <View style={styles.micSlash} />}
              </View>
              <Text style={[styles.controlLabel, muted && { color: '#ff4444' }]}>
                {muted ? 'Muted' : 'Mic'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Leave */}
          <TouchableOpacity style={styles.leaveBtn} onPress={leaveConvoy}>
            <Text style={styles.controlIcon}>🚪</Text>
            <Text style={styles.leaveLabel}>Ieși</Text>
          </TouchableOpacity>
        </View>
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
  fitAllButton: {
    position: 'absolute',
    right: 16,
    bottom: 200,
    backgroundColor: 'rgba(15, 15, 15, 0.85)',
    borderRadius: 25,
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#333',
    borderWidth: 1,
  },
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
  controlButtonPending: { borderColor: '#f4a000' },
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
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  micContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micSlash: {
    position: 'absolute',
    width: 3,
    height: 30,
    backgroundColor: '#ff4444',
    borderRadius: 2,
    transform: [{ rotate: '135deg' }],
  },
});

function CarIcon({ color }: { color: string }) {
  return (
    <View style={carStyles.wrapper}>
      {/* Car body */}
      <View style={[carStyles.body, { backgroundColor: color }]}>
        {/* Windshield */}
        <View style={carStyles.windshield} />
        {/* Rear window */}
        <View style={carStyles.rearWindow} />
      </View>
      {/* Left wheels */}
      <View style={[carStyles.wheel, carStyles.wheelTopLeft]} />
      <View style={[carStyles.wheel, carStyles.wheelBottomLeft]} />
      {/* Right wheels */}
      <View style={[carStyles.wheel, carStyles.wheelTopRight]} />
      <View style={[carStyles.wheel, carStyles.wheelBottomRight]} />
    </View>
  );
}

const carStyles = StyleSheet.create({
  wrapper: {
    width: 24,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    width: 18,
    height: 36,
    borderRadius: 6,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    alignItems: 'center',
    overflow: 'hidden',
  },
  windshield: {
    width: 12,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 2,
    marginTop: 5,
  },
  rearWindow: {
    width: 12,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    marginTop: 8,
  },
  wheel: {
    position: 'absolute',
    width: 5,
    height: 8,
    backgroundColor: '#222',
    borderRadius: 2,
  },
  wheelTopLeft: { left: 0, top: 4 },
  wheelBottomLeft: { left: 0, bottom: 4 },
  wheelTopRight: { right: 0, top: 4 },
  wheelBottomRight: { right: 0, bottom: 4 },
});
