import { useEffect, useRef } from 'react';

// Sound options
const SOUNDS = {
  default: '/sounds/notification-default.mp3',
  gentle: '/sounds/notification-gentle.mp3',
  chime: '/sounds/notification-chime.mp3',
};

export function useNotification() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Request notification permission on mount
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Load audio
    const soundType = localStorage.getItem('notification-sound') || 'default';
    const soundPath = SOUNDS[soundType as keyof typeof SOUNDS] || SOUNDS.default;
    audioRef.current = new Audio(soundPath);
    audioRef.current.volume = parseFloat(localStorage.getItem('notification-volume') || '0.5');

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const sendNotification = (title: string, body?: string) => {
    // Check if page is not in foreground
    if (!document.hidden) {
      return;
    }

    // Check if notifications are enabled
    const notificationsEnabled = localStorage.getItem('notifications-enabled') !== 'false';
    if (!notificationsEnabled) {
      return;
    }

    // Send browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: body || '',
        icon: '/favicon.ico',
      });
    }

    // Play sound
    const soundEnabled = localStorage.getItem('sound-enabled') !== 'false';
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Ignore autoplay errors
      });
    }
  };

  return { sendNotification };
}

export function getAvailableSounds() {
  return Object.keys(SOUNDS);
}

export function getSoundPath(soundType: string): string {
  return SOUNDS[soundType as keyof typeof SOUNDS] || SOUNDS.default;
}
