import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { socket } from '@/lib/socket';
import {
  startLocalAudio,
  createOffer,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  closeAllPeers,
} from '@/lib/webrtc';
import { addLog, getLogs, clearLogs, subscribeToLogs, LogEntry } from '@/lib/debugLog';

function categoryColor(cat: string): string {
  switch (cat) {
    case 'ICE': return '#00bcd4';
    case 'VOICE': return '#4caf50';
    case 'SOCKET': return '#ff9800';
    case 'WEBRTC': return '#2196f3';
    case 'ERROR': return '#f44336';
    case 'MIC': return '#ce93d8';
    default: return '#888';
  }
}

type Screen = 'lobby' | 'room';

export default function VoiceTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [screen, setScreen] = useState<Screen>('lobby');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [members, setMembers] = useState(1);
  const [voiceActive, setVoiceActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [remoteVoiceCount, setRemoteVoiceCount] = useState(0);

  const localStreamRef = useRef<any>(null);
  const remoteVoiceIdsRef = useRef<Set<string>>(new Set());
  const logScrollRef = useRef<ScrollView>(null);
  const [logs, setLogs] = useState<LogEntry[]>(() => getLogs());

  useEffect(() => {
    const unsub = subscribeToLogs(() => {
      setLogs(getLogs());
      setTimeout(() => logScrollRef.current?.scrollToEnd({ animated: false }), 30);
    });
    clearLogs();
    return unsub;
  }, []);

  // Socket events — active only while in a room
  useEffect(() => {
    if (screen !== 'room') return;

    const onConnect = () => addLog('SOCKET', `Connected, id=${socket.id}`);
    const onDisconnect = (reason: string) => addLog('SOCKET', `Disconnected: ${reason}`);
    const onMemberJoined = (data: { count: number }) => {
      setMembers(data.count);
      addLog('SOCKET', `Membru a intrat, total=${data.count}`);
    };
    const onMemberLeft = (data: { memberId: string; count: number }) => {
      setMembers(data.count);
      remoteVoiceIdsRef.current.delete(data.memberId);
      setRemoteVoiceCount(remoteVoiceIdsRef.current.size);
      addLog('SOCKET', `Membru a plecat (${data.memberId.slice(0, 6)}), total=${data.count}`);
    };
    const onVoiceReady = ({ from }: { from: string }) => {
      addLog('VOICE', `voice-ready de la ${from.slice(0, 6)}`);
      remoteVoiceIdsRef.current.add(from);
      setRemoteVoiceCount(remoteVoiceIdsRef.current.size);
    };
    const onWebrtcOffer = async ({ from, offer }: { from: string; offer: any }) => {
      addLog('VOICE', `Offer de la ${from.slice(0, 6)}`);
      if (!localStreamRef.current) {
        try {
          localStreamRef.current = await startLocalAudio();
        } catch (e: any) {
          addLog('ERROR', `Mic failed la offer: ${e?.message ?? e}`);
          return;
        }
      }
      try {
        await handleOffer(from, offer, (_id) => {
          addLog('VOICE', `Stream remote primit de la ${from.slice(0, 6)} — VOCEA MERGE!`);
          setVoiceActive(true);
        });
      } catch (e: any) {
        addLog('ERROR', `handleOffer: ${e?.message ?? e}`);
      }
    };
    const onWebrtcAnswer = async ({ from, answer }: { from: string; answer: any }) => {
      addLog('VOICE', `Answer de la ${from.slice(0, 6)}`);
      try {
        await handleAnswer(from, answer);
      } catch (e: any) {
        addLog('ERROR', `handleAnswer: ${e?.message ?? e}`);
      }
    };
    const onIceCandidate = async ({ from, candidate }: { from: string; candidate: any }) => {
      try {
        await handleIceCandidate(from, candidate);
      } catch (e: any) {
        addLog('ERROR', `ICE: ${e?.message ?? e}`);
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('member-joined', onMemberJoined);
    socket.on('member-left', onMemberLeft);
    socket.on('voice-ready', onVoiceReady);
    socket.on('webrtc-offer', onWebrtcOffer);
    socket.on('webrtc-answer', onWebrtcAnswer);
    socket.on('webrtc-ice-candidate', onIceCandidate);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('member-joined', onMemberJoined);
      socket.off('member-left', onMemberLeft);
      socket.off('voice-ready', onVoiceReady);
      socket.off('webrtc-offer', onWebrtcOffer);
      socket.off('webrtc-answer', onWebrtcAnswer);
      socket.off('webrtc-ice-candidate', onIceCandidate);
    };
  }, [screen]);

  const ensureConnected = (): Promise<void> => {
    return new Promise((resolve) => {
      if (socket.connected) { resolve(); return; }
      socket.once('connect', resolve);
      socket.connect();
    });
  };

  const createRoom = async () => {
    try {
      await ensureConnected();
      addLog('SOCKET', 'Creez cameră voice test...');
      socket.emit('create-convoy', (res: { ok: boolean; code?: string; error?: string }) => {
        if (!res.ok || !res.code) {
          addLog('ERROR', `create-convoy failed: ${res.error ?? 'unknown'}`);
          Alert.alert('Eroare', res.error ?? 'Nu s-a putut crea camera');
          return;
        }
        addLog('SOCKET', `Cameră creată: ${res.code}`);
        setRoomCode(res.code);
        setMembers(1);
        setScreen('room');
      });
    } catch (e: any) {
      Alert.alert('Eroare conexiune', e?.message ?? 'Nu s-a putut conecta la server');
    }
  };

  const joinRoom = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) { Alert.alert('Eroare', 'Introdu codul camerei'); return; }
    try {
      await ensureConnected();
      addLog('SOCKET', `Încerc să intru în camera: ${code}`);
      socket.emit('join-convoy', code, (res: { ok: boolean; count?: number; error?: string }) => {
        if (!res.ok) {
          addLog('ERROR', `join-convoy failed: ${res.error ?? 'unknown'}`);
          Alert.alert('Eroare', res.error ?? 'Nu s-a putut intra în cameră');
          return;
        }
        addLog('SOCKET', `Intrat în camera ${code}, total=${res.count}`);
        setRoomCode(code);
        setMembers(res.count ?? 1);
        setScreen('room');
      });
    } catch (e: any) {
      Alert.alert('Eroare conexiune', e?.message ?? 'Nu s-a putut conecta la server');
    }
  };

  const toggleVoice = async () => {
    if (voiceActive) {
      closeAllPeers();
      localStreamRef.current = null;
      setVoiceActive(false);
      setMuted(false);
      addLog('VOICE', 'Voice oprit');
    } else {
      addLog('VOICE', `Pornesc voice, remoteUsers=${remoteVoiceIdsRef.current.size}`);
      try {
        const stream = await startLocalAudio();
        localStreamRef.current = stream;
        setVoiceActive(true);
        socket.emit('voice-ready', roomCode);
        addLog('VOICE', `voice-ready emis pentru ${roomCode}`);
        for (const targetId of remoteVoiceIdsRef.current) {
          addLog('VOICE', `Trimit offer la ${targetId.slice(0, 6)}`);
          try {
            await createOffer(targetId, (_id) => {
              addLog('VOICE', `Stream remote de la ${targetId.slice(0, 6)} — MERGE!`);
            });
          } catch (e: any) {
            addLog('ERROR', `createOffer la ${targetId.slice(0, 6)}: ${e?.message ?? e}`);
          }
        }
      } catch (e: any) {
        addLog('ERROR', `toggleVoice: ${e?.message ?? e}`);
        Alert.alert('Eroare', e?.message ?? 'Nu s-a putut accesa microfonul');
      }
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        const nowMuted = !track.enabled;
        setMuted(nowMuted);
        addLog('MIC', `Microfon ${nowMuted ? 'mut' : 'activ'}`);
      }
    }
  };

  const leaveRoom = () => {
    closeAllPeers();
    localStreamRef.current = null;
    remoteVoiceIdsRef.current.clear();
    setVoiceActive(false);
    setMuted(false);
    setRemoteVoiceCount(0);
    socket.disconnect();
    setScreen('lobby');
    addLog('SOCKET', 'Ai ieșit din cameră');
  };

  const goBack = () => {
    if (screen === 'room') leaveRoom();
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Text style={styles.backBtn}>← Înapoi</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Test Voce</Text>
        {screen === 'room' ? (
          <Text style={styles.membersText}>{members} {members === 1 ? 'user' : 'useri'}</Text>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {screen === 'lobby' ? (
        // Lobby screen
        <View style={styles.lobby}>
          <Text style={styles.lobbyTitle}>Testează vocea WebRTC</Text>
          <Text style={styles.lobbySubtitle}>
            Creează o cameră sau intră cu un cod. Ambele telefoane trebuie să folosească același cod.
          </Text>

          <TouchableOpacity style={styles.createBtn} onPress={createRoom}>
            <Text style={styles.createBtnText}>Creează cameră</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>sau intră cu cod</Text>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            style={styles.codeInput}
            value={joinCode}
            onChangeText={setJoinCode}
            placeholder="Cod cameră (ex: WOLF)"
            placeholderTextColor="#444"
            autoCapitalize="characters"
            maxLength={10}
          />
          <TouchableOpacity
            style={[styles.joinBtn, !joinCode.trim() && styles.joinBtnDisabled]}
            onPress={joinRoom}
            disabled={!joinCode.trim()}
          >
            <Text style={styles.joinBtnText}>Intră în cameră</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // Room screen
        <>
          {/* Voice controls */}
          <View style={styles.voiceSection}>
            <View style={styles.codeChip}>
              <Text style={styles.codeText}>{roomCode}</Text>
            </View>
            <Text style={styles.shareHint}>Dă codul de mai sus celuilalt telefon</Text>

            <View style={styles.voiceButtons}>
              <TouchableOpacity
                style={[
                  styles.voiceBtn,
                  voiceActive && styles.voiceBtnActive,
                  !voiceActive && remoteVoiceCount > 0 && styles.voiceBtnPending,
                ]}
                onPress={toggleVoice}
              >
                <Text style={styles.voiceBtnIcon}>{voiceActive ? '🎙️' : '🔇'}</Text>
                <Text style={styles.voiceBtnLabel}>
                  {voiceActive ? 'Voice ON' : remoteVoiceCount > 0 ? `Join (${remoteVoiceCount})` : 'Start Voice'}
                </Text>
              </TouchableOpacity>

              {voiceActive && (
                <TouchableOpacity
                  style={[styles.voiceBtn, muted ? styles.voiceBtnMuted : styles.voiceBtnActive]}
                  onPress={toggleMute}
                >
                  <Text style={styles.voiceBtnIcon}>🎤</Text>
                  <Text style={styles.voiceBtnLabel}>{muted ? 'Muted' : 'Mic ON'}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.leaveBtn} onPress={leaveRoom}>
                <Text style={styles.voiceBtnIcon}>🚪</Text>
                <Text style={[styles.voiceBtnLabel, { color: '#ff4444' }]}>Ieși</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Debug logs */}
          <View style={styles.debugContainer}>
            <View style={styles.debugHeader}>
              <Text style={styles.debugTitle}>Logs ({logs.length})</Text>
              <TouchableOpacity onPress={() => { clearLogs(); setLogs([]); }}>
                <Text style={styles.clearBtnText}>Șterge</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              ref={logScrollRef}
              style={styles.logScroll}
              contentContainerStyle={styles.logContent}
              onContentSizeChange={() => logScrollRef.current?.scrollToEnd({ animated: false })}
            >
              {logs.length === 0 && (
                <Text style={styles.emptyLog}>Niciun log. Apasă Start Voice pentru a testa.</Text>
              )}
              {logs.map((entry) => (
                <View key={entry.id} style={styles.logRow}>
                  <Text style={styles.logTime}>{entry.time}</Text>
                  <Text style={[styles.logCat, { color: categoryColor(entry.category) }]}>
                    {entry.category.padEnd(6)}
                  </Text>
                  <Text style={styles.logMsg} numberOfLines={4}>{entry.message}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: '#222',
    borderBottomWidth: 1,
  },
  backBtn: { color: '#f4a000', fontSize: 15, width: 80 },
  title: { color: '#fff', fontWeight: 'bold', fontSize: 17 },
  membersText: { color: '#888', fontSize: 12, width: 60, textAlign: 'right' },

  // Lobby
  lobby: {
    flex: 1,
    padding: 24,
    gap: 16,
    justifyContent: 'center',
  },
  lobbyTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  lobbySubtitle: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  createBtn: {
    backgroundColor: '#f4a000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  createBtnText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#222' },
  dividerText: { color: '#555', fontSize: 12 },
  codeInput: {
    backgroundColor: '#1a1a1a',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 4,
    textAlign: 'center',
  },
  joinBtn: {
    borderColor: '#f4a000',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  joinBtnDisabled: { borderColor: '#333', opacity: 0.4 },
  joinBtnText: { color: '#f4a000', fontWeight: 'bold', fontSize: 16 },

  // Room
  voiceSection: {
    padding: 20,
    alignItems: 'center',
    gap: 12,
    borderBottomColor: '#222',
    borderBottomWidth: 1,
  },
  codeChip: {
    backgroundColor: 'rgba(244, 160, 0, 0.12)',
    borderColor: '#f4a000',
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  codeText: { color: '#f4a000', fontWeight: 'bold', fontSize: 22, letterSpacing: 5 },
  shareHint: { color: '#555', fontSize: 12 },
  voiceButtons: { flexDirection: 'row', gap: 12, marginTop: 4 },
  voiceBtn: {
    backgroundColor: '#1a1a1a',
    borderColor: '#333',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    minWidth: 90,
    gap: 6,
  },
  voiceBtnActive: { borderColor: '#4caf50' },
  voiceBtnPending: { borderColor: '#f4a000' },
  voiceBtnMuted: { borderColor: '#ff4444' },
  leaveBtn: {
    backgroundColor: 'rgba(40, 10, 10, 0.9)',
    borderColor: '#ff4444',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    minWidth: 90,
    gap: 6,
  },
  voiceBtnIcon: { fontSize: 26 },
  voiceBtnLabel: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  // Debug
  debugContainer: { flex: 1 },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomColor: '#1a1a1a',
    borderBottomWidth: 1,
  },
  debugTitle: { color: '#f4a000', fontWeight: 'bold', fontSize: 13 },
  clearBtnText: { color: '#666', fontSize: 13 },
  logScroll: { flex: 1 },
  logContent: { paddingHorizontal: 8, paddingBottom: 8 },
  emptyLog: { color: '#333', textAlign: 'center', marginTop: 24, fontSize: 13 },
  logRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomColor: '#111',
    borderBottomWidth: 1,
  },
  logTime: { color: '#555', fontSize: 10, marginRight: 6, width: 80 },
  logCat: { fontSize: 10, fontWeight: 'bold', marginRight: 6, width: 52 },
  logMsg: { color: '#ccc', fontSize: 10, flexShrink: 1 },
});
