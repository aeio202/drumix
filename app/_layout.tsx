import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import 'react-native-reanimated';

// Suppress keep-awake error from Expo dev client
LogBox.ignoreLogs(['Unable to activate keep awake']);

// Prevent unhandled promise rejection crash
const originalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  if (error?.message?.includes('keep awake')) return;
  originalHandler(error, isFatal);
});

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0f0f0f',
    card: '#0f0f0f',
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0f0f0f' }, animation: 'slide_from_right', animationDuration: 200 }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="create-convoy" />
        <Stack.Screen name="join-convoy" />
        <Stack.Screen name="convoy" />
        <Stack.Screen name="voice-test" />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
