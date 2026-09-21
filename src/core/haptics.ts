import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Haptics through Capacitor so they work in the iOS WKWebView, where
 * `navigator.vibrate` does not exist. On the web Capacitor falls back to the
 * Vibration API by itself, and everything here is best-effort: a platform with
 * no haptic hardware simply gets nothing.
 */
function impact(style: ImpactStyle): void {
  void Haptics.impact({ style }).catch(() => {});
}

export const haptics = {
  tap: () => impact(ImpactStyle.Light),
  hit: () => impact(ImpactStyle.Light),
  cascade: (chain: number) =>
    impact(chain >= 3 ? ImpactStyle.Heavy : chain >= 2 ? ImpactStyle.Medium : ImpactStyle.Light),
  bomb: () => impact(ImpactStyle.Heavy),
  reward: () => void Haptics.notification({ type: NotificationType.Success }).catch(() => {}),
  gameOver: () => void Haptics.notification({ type: NotificationType.Error }).catch(() => {}),
};
