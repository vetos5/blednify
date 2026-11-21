export interface OutagePeriod {
  from: string; // "18:00"
  to: string;   // "21:30"
  fromMinutes: number;
  toMinutes: number;
  durationMinutes: number;
}

export interface GroupSchedule {
  group: string; // e.g. "1.1", "3.2"
  text: string;  // e.g. "Електроенергії немає з 18:00 до 21:30"
  periods: OutagePeriod[];
  hasOutage: boolean;
}

export interface DaySchedule {
  title: string;       // "Графік погодинних відключень на 21.11.2026"
  updatedAt: string;   // "Інформація станом на 14:01 21.11.2026"
  dateStr: string;     // "21.11.2026"
  imageUrl: string;
  mobileImageUrl: string;
  groups: Record<string, GroupSchedule>;
  rawHtml: string;
}

export interface SchedulePayload {
  rawHtml?: string;
  imageUrl?: string;
  mobileImageUrl?: string;
  tomorrowRawHtml?: string;
  tomorrowImageUrl?: string;
  tomorrowMobileImageUrl?: string;
}

export interface UserRecord {
  chat_id: number;
  group_name: string | null;
  notifications_enabled: number;
  created_at: string;
  updated_at: string;
}
