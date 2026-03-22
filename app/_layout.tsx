import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

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
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
