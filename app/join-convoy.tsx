import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { socket } from '@/lib/socket';

export default function JoinConvoyScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const [members, setMembers] = useState(0);

  useEffect(() => {
    const onConvoyStarted = ({ code: c, count }: { code: string; count: number }) => {
      router.replace({ pathname: '/convoy', params: { code: c, isLeader: 'false', count: String(count) } });
    };
    const onMemberJoined = (data: { count: number }) => setMembers(data.count);
    const onMemberLeft = (data: { count: number }) => setMembers(data.count);

    socket.on('convoy-started', onConvoyStarted);
    socket.on('member-joined', onMemberJoined);
    socket.on('member-left', onMemberLeft);

    return () => {
      socket.off('convoy-started', onConvoyStarted);
      socket.off('member-joined', onMemberJoined);
      socket.off('member-left', onMemberLeft);
    };
  }, []);

  const handleJoin = () => {
    if (!code) return;
    setLoading(true);

    const tryJoin = () => {
      socket.emit('join-convoy', code, (res: { ok: boolean; error?: string; count?: number }) => {
        setLoading(false);
        if (res.ok) {
          setJoined(true);
          setMembers(res.count || 2);
        } else {
          Alert.alert('Eroare', res.error || 'Nu s-a putut intra în convoi');
          socket.disconnect();
        }
      });
    };

    if (socket.connected) {
      tryJoin();
    } else {
      socket.connect();
      socket.once('connect', tryJoin);
      socket.once('connect_error', () => {
        setLoading(false);
        Alert.alert('Eroare', 'Nu s-a putut conecta la server');
        socket.disconnect();
      });
    }
  };

  const handleBack = () => {
    if (joined) socket.disconnect();
    router.back();
  };

  if (joined) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backText}>← Înapoi</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Ești în convoi!</Text>
        <View style={styles.codeBox}>
          <Text style={styles.code}>{code}</Text>
        </View>
        <Text style={styles.hint}>{members} membri — așteptăm ca liderul să pornească...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack}>
        <Text style={styles.backText}>← Înapoi</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Intră în convoi</Text>
      <Text style={styles.subtitle}>Introdu codul primit de la liderul convoiului</Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        placeholder="ex: WOLF"
        placeholderTextColor="#555555"
        autoCapitalize="characters"
        maxLength={5}
      />

      <TouchableOpacity
        style={[styles.joinButton, (!code || loading) && styles.joinButtonDisabled]}
        disabled={!code || loading}
        onPress={handleJoin}
      >
        <Text style={styles.joinButtonText}>{loading ? 'Se conectează...' : 'Alătură-te'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  backButton: { position: 'absolute', top: 60, left: 20 },
  backText: { color: '#f4a000', fontSize: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#ffffff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888888', marginBottom: 32, textAlign: 'center' },
  input: {
    backgroundColor: '#1a1a1a',
    borderColor: '#f4a000',
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 32,
    fontSize: 36,
    fontWeight: 'bold',
    color: '#f4a000',
    letterSpacing: 8,
    textAlign: 'center',
    width: '80%',
    marginBottom: 32,
  },
  codeBox: {
    backgroundColor: '#1a1a1a',
    borderColor: '#f4a000',
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginBottom: 16,
  },
  code: { fontSize: 36, fontWeight: 'bold', color: '#f4a000', letterSpacing: 8 },
  hint: { fontSize: 13, color: '#888888', textAlign: 'center' },
  joinButton: {
    backgroundColor: '#f4a000',
    paddingVertical: 16,
    borderRadius: 12,
    width: '80%',
    alignItems: 'center',
  },
  joinButtonDisabled: { opacity: 0.4 },
  joinButtonText: { color: '#000000', fontWeight: 'bold', fontSize: 16 },
});
