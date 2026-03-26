import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>🚗 Drumix</Text>
      <Text style={styles.subtitle}>Convoi, voce și GPS în timp real</Text>

      <TouchableOpacity style={styles.buttonPrimary} onPress={() => router.push('/create-convoy')}>
        <Text style={styles.buttonText}>Creează convoi</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.buttonSecondary} onPress={() => router.push('/join-convoy')}>
        <Text style={styles.buttonTextSecondary}>Alătură-te unui convoi</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.buttonVoiceTest} onPress={() => router.push('/voice-test')}>
        <Text style={styles.buttonTextVoiceTest}>🎙️ Test voce</Text>
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
    gap: 16,
  },
  logo: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 20,
  },
  buttonPrimary: {
    backgroundColor: '#f4a000',
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 12,
    width: '80%',
    alignItems: 'center',
  },
  buttonSecondary: {
    borderColor: '#f4a000',
    borderWidth: 1.5,
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 12,
    width: '80%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 16,
  },
  buttonTextSecondary: {
    color: '#f4a000',
    fontWeight: 'bold',
    fontSize: 16,
  },
  buttonVoiceTest: {
    borderColor: '#555',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 60,
    borderRadius: 12,
    width: '80%',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonTextVoiceTest: {
    color: '#888',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
