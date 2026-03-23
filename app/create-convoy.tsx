import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { socket } from '@/lib/socket';

export default function CreateConvoyScreen() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [members, setMembers] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    const onConnect = () => {
      socket.emit('create-convoy', (res: { ok: boolean; code: string }) => {
        if (res.ok) setCode(res.code);
        else setError('Nu s-a putut crea convoiul');
      });
    };

    const onMemberJoined = (data: { count: number }) => setMembers(data.count);
    const onMemberLeft = (data: { count: number }) => setMembers(data.count);
    const onError = () => setError('Nu s-a putut conecta la server');
    const onConvoyStarted = ({ code: c, count }: { code: string; count: number }) => {
      router.replace({ pathname: '/convoy', params: { code: c, isLeader: 'true', count: String(count) } });
    };

    socket.on('connect', onConnect);
    socket.on('member-joined', onMemberJoined);
    socket.on('member-left', onMemberLeft);
    socket.on('connect_error', onError);
    socket.on('convoy-started', onConvoyStarted);
    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('member-joined', onMemberJoined);
      socket.off('member-left', onMemberLeft);
      socket.off('connect_error', onError);
      socket.off('convoy-started', onConvoyStarted);
      // NOT disconnecting socket — it stays alive for convoy screen
    };
  }, []);

  const handleStart = () => {
    if (code) socket.emit('start-convoy', code);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => { socket.disconnect(); router.back(); }}>
        <Text style={styles.backText}>← Înapoi</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Convoiul tău</Text>
      <Text style={styles.subtitle}>Împărtășește codul cu ceilalți șoferi</Text>

      <View style={styles.codeBox}>
        {code ? (
          <Text style={styles.code}>{code}</Text>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <ActivityIndicator color="#f4a000" size="large" />
        )}
      </View>

      <Text style={styles.hint}>
        {members === 1 ? 'Așteptând alți membri...' : `${members} membri în convoi`}
      </Text>

      <TouchableOpacity
        style={[styles.startButton, !code && styles.startButtonDisabled]}
        disabled={!code}
        onPress={handleStart}
      >
        <Text style={styles.startButtonText}>Pornește convoiul</Text>
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
  subtitle: { fontSize: 14, color: '#888888', marginBottom: 32 },
  codeBox: {
    backgroundColor: '#1a1a1a',
    borderColor: '#f4a000',
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 48,
    marginBottom: 16,
    minHeight: 90,
    justifyContent: 'center',
    alignItems: 'center',
  },
  code: { fontSize: 48, fontWeight: 'bold', color: '#f4a000', letterSpacing: 12 },
  errorText: { color: '#ff4444', fontSize: 14, textAlign: 'center' },
  hint: { fontSize: 13, color: '#666666', marginBottom: 40 },
  startButton: {
    backgroundColor: '#f4a000',
    paddingVertical: 16,
    borderRadius: 12,
    width: '80%',
    alignItems: 'center',
  },
  startButtonDisabled: { opacity: 0.4 },
  startButtonText: { color: '#000000', fontWeight: 'bold', fontSize: 16 },
});
