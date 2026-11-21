import type { DaySchedule, GroupSchedule, OutagePeriod } from "./types";

function timeToMinutes(t: string): number {
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (h === 24) h = 24;
  return h * 60 + m;
}

export function parsePeriods(text: string): OutagePeriod[] {
  const periods: OutagePeriod[] = [];
  const regex = /з\s*(\d{1,2}:\d{2})\s*до\s*(\d{1,2}:\d{2})/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const from = match[1];
    const to = match[2];
    const fromMinutes = timeToMinutes(from);
    let toMinutes = timeToMinutes(to);
    if (toMinutes === 0 && (to.startsWith("24") || to.startsWith("00:00"))) {
      toMinutes = 24 * 60;
    }
    const durationMinutes = Math.max(0, toMinutes - fromMinutes);

    periods.push({
      from,
      to,
      fromMinutes,
      toMinutes,
      durationMinutes,
    });
  }

  return periods;
}

export function cleanHtml(html: string): string[] {
  if (!html) return [];
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function parseDaySchedule(
  rawHtml: string,
  imageUrl = "",
  mobileImageUrl = ""
): DaySchedule | null {
  if (!rawHtml) return null;

  const lines = cleanHtml(rawHtml);
  let title = "Графік відключень";
  let updatedAt = "";
  let dateStr = "";

  const groups: Record<string, GroupSchedule> = {};

  for (const line of lines) {
    if (line.toLowerCase().includes("графік")) {
      title = line;
      const dateMatch = line.match(/(\d{2}\.\d{2}\.\d{4})/);
      if (dateMatch) dateStr = dateMatch[1];
    } else if (line.toLowerCase().includes("станом на")) {
      updatedAt = line;
    } else {
      const groupMatch = line.match(/Група\s*(\d+\.\d+)[.:\s]*(.*)/i);
      if (groupMatch) {
        const groupNum = groupMatch[1];
        const desc = groupMatch[2]?.trim() || line;
        const periods = parsePeriods(desc);
        const hasOutage = periods.length > 0 || desc.toLowerCase().includes("немає");

        groups[groupNum] = {
          group: groupNum,
          text: desc,
          periods,
          hasOutage,
        };
      }
    }
  }

  // Ensure standard 12 groups exist
  const standardGroups = [
    "1.1", "1.2", "2.1", "2.2", "3.1", "3.2",
    "4.1", "4.2", "5.1", "5.2", "6.1", "6.2",
  ];
  for (const g of standardGroups) {
    if (!groups[g]) {
      groups[g] = {
        group: g,
        text: "Інформація відсутня або відключень немає",
        periods: [],
        hasOutage: false,
      };
    }
  }

  return {
    title,
    updatedAt,
    dateStr,
    imageUrl,
    mobileImageUrl,
    groups,
    rawHtml,
  };
}

export function getCurrentOutageStatus(
  schedule: GroupSchedule | undefined,
  nowMinutes?: number
): {
  isOff: boolean;
  currentPeriod: OutagePeriod | null;
  nextPeriod: OutagePeriod | null;
  minutesUntilNext: number | null;
} {
  if (!schedule || schedule.periods.length === 0) {
    return {
      isOff: false,
      currentPeriod: null,
      nextPeriod: null,
      minutesUntilNext: null,
    };
  }

  if (nowMinutes === undefined) {
    const now = new Date();
    // Use local Ukraine time (UTC+2 or UTC+3)
    const kyivTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })
    );
    nowMinutes = kyivTime.getHours() * 60 + kyivTime.getMinutes();
  }

  let isOff = false;
  let currentPeriod: OutagePeriod | null = null;
  let nextPeriod: OutagePeriod | null = null;
  let minutesUntilNext: number | null = null;

  for (const p of schedule.periods) {
    if (nowMinutes >= p.fromMinutes && nowMinutes < p.toMinutes) {
      isOff = true;
      currentPeriod = p;
      break;
    }
  }

  if (!isOff) {
    // Find next upcoming outage
    const upcoming = schedule.periods
      .filter((p) => p.fromMinutes > nowMinutes!)
      .sort((a, b) => a.fromMinutes - b.fromMinutes);

    if (upcoming.length > 0) {
      nextPeriod = upcoming[0];
      minutesUntilNext = nextPeriod.fromMinutes - nowMinutes;
    }
  }

  return { isOff, currentPeriod, nextPeriod, minutesUntilNext };
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} год ${m} хв`;
  if (h > 0) return `${h} год`;
  return `${m} хв`;
}

export function formatGroupMessage(
  day: DaySchedule,
  groupNum: string
): string {
  const g = day.groups[groupNum];
  if (!g) {
    return `❌ Дані для групи **${groupNum}** не знайдено.`;
  }

  const { isOff, currentPeriod, nextPeriod, minutesUntilNext } =
    getCurrentOutageStatus(g);

  let statusText = "";
  if (isOff && currentPeriod) {
    statusText = `🔴 **Зараз СВІТЛА НЕМАЄ!**\n⏳ Триває до: **${currentPeriod.to}**`;
  } else if (nextPeriod && minutesUntilNext !== null) {
    statusText = `🟢 **Зараз світло Є.**\n⚠️ Наступне вимкнення о **${nextPeriod.from}** (через ${formatDuration(minutesUntilNext)})`;
  } else if (g.periods.length === 0) {
    statusText = `🟢 **Світло є весь день! Відключень немає.**`;
  } else {
    statusText = `🟢 **Зараз світло Є.** На сьогодні вимкнень більше не заплановано.`;
  }

  let periodsList = "";
  if (g.periods.length > 0) {
    periodsList = g.periods
      .map(
        (p) =>
          `• 🔴 **${p.from} — ${p.to}** (${formatDuration(p.durationMinutes)})`
      )
      .join("\n");
  } else {
    periodsList = "• 🟢 Відключення відсутні";
  }

  let totalOutageMins = g.periods.reduce(
    (acc, p) => acc + p.durationMinutes,
    0
  );

  return (
    `⚡ **${day.title}**\n` +
    (day.updatedAt ? `🕒 _${day.updatedAt}_\n\n` : "\n") +
    `👤 **Ваша група:** \`${groupNum}\`\n\n` +
    `📊 **Поточний статус:**\n${statusText}\n\n` +
    `📋 **Графік на день:**\n${periodsList}\n\n` +
    `⏱️ Загальна тривалість без світла: **${formatDuration(totalOutageMins)}**`
  );
}

export function formatAllGroupsMessage(day: DaySchedule): string {
  let lines = [`⚡ **${day.title}**`];
  if (day.updatedAt) lines.push(`🕒 _${day.updatedAt}_`);
  lines.push("");

  const groupsList = Object.keys(day.groups).sort();
  for (const g of groupsList) {
    const item = day.groups[g];
    if (item.periods.length > 0) {
      const times = item.periods.map((p) => `${p.from}–${p.to}`).join(", ");
      lines.push(`• **Група ${g}:** 🔴 ${times}`);
    } else {
      lines.push(`• **Група ${g}:** 🟢 без відключень`);
    }
  }

  return lines.join("\n");
}
