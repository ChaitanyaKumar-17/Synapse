import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestPermissionsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  return finalStatus === 'granted';
}

export async function scheduleReminder(title: string, body: string, date: Date, itemId: string, itemType: 'note' | 'todo_list') {
  const hasPermission = await requestPermissionsAsync();
  if (!hasPermission) return null;

  // First, cancel any existing reminder for this item
  await cancelReminder(itemId);

  return await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { itemId, itemType },
    },
    trigger: Platform.OS === 'android' ? { type: 'calendar', date, channelId: 'default' } as any : date,
  });
}

export async function cancelReminder(itemId: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of scheduled) {
    if (notif.content.data?.itemId === itemId) {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }
}
