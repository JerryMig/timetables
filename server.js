import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 4173);
const tdxBaseUrl = process.env.TDX_BASE_URL || 'https://tdx.transportdata.tw/api/basic/v3';
const tokenUrl =
  process.env.TDX_TOKEN_URL ||
  'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (_req, res) => {
  res.json({
    hasCredentials: hasCredentials(),
    source: 'TDX Transport Data eXchange',
  });
});

app.get('/api/stations', async (_req, res) => {
  try {
    const data = await tdxFetch('/Rail/TRA/Station', {
      $format: 'JSON',
    });

    const stations = tdxArray(data, ['Stations'])
      .map((station) => ({
        id: station.StationID,
        code: station.StationCode,
        name: localizedName(station.StationName),
        englishName: englishName(station.StationName),
        address: localizedName(station.StationAddress),
      }))
      .filter((station) => station.id && station.name)
      .sort((a, b) => a.id.localeCompare(b.id, 'zh-Hant-TW'));

    res.json({ stations });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get('/api/timetable', async (req, res) => {
  try {
    const from = normalizeStationId(req.query.from);
    const to = normalizeStationId(req.query.to);
    const date = String(req.query.date || '');
    const time = String(req.query.time || '00:00');
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 80);

    if (!from || !to) {
      return res.status(400).json({ message: '請選擇起站與訖站。' });
    }

    if (from === to) {
      return res.status(400).json({ message: '起站與訖站不能相同。' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: '請使用 YYYY-MM-DD 日期格式。' });
    }

    if (!/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ message: '請使用 HH:mm 時間格式。' });
    }

    const data = await tdxFetch(`/Rail/TRA/DailyTrainTimetable/OD/Inclusive/${from}/to/${to}/${date}`, {
      $format: 'JSON',
    });

    const trips = tdxArray(data, ['TrainTimetables', 'DailyTrainTimetables'])
      .map((entry) => normalizeTimetableEntry(entry, from, to))
      .filter(Boolean)
      .filter((trip) => compareClockTime(trip.departureTime, time) >= 0)
      .sort((a, b) => {
        const byDepart = compareClockTime(a.departureTime, b.departureTime);
        return byDepart === 0 ? compareClockTime(a.arrivalTime, b.arrivalTime) : byDepart;
      })
      .slice(0, limit);

    res.json({
      query: { from, to, date, time, limit },
      count: trips.length,
      trips,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.listen(port, () => {
  console.log(`TRA timetable site running at http://localhost:${port}`);
});

function hasCredentials() {
  return Boolean(process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET);
}

async function getAccessToken() {
  if (!hasCredentials()) {
    const error = new Error('缺少 TDX_CLIENT_ID 或 TDX_CLIENT_SECRET。');
    error.status = 401;
    throw error;
  }

  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt - 30_000 > now) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.TDX_CLIENT_ID,
    client_secret: process.env.TDX_CLIENT_SECRET,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`TDX token 取得失敗 (${response.status})。${text}`);
    error.status = response.status;
    throw error;
  }

  const token = await response.json();
  tokenCache = {
    accessToken: token.access_token,
    expiresAt: now + Number(token.expires_in || 3600) * 1000,
  };

  return tokenCache.accessToken;
}

async function tdxFetch(resourcePath, params = {}) {
  const token = await getAccessToken();
  const url = new URL(`${tdxBaseUrl}${resourcePath}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`TDX API 查詢失敗 (${response.status})。${text}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function normalizeTimetableEntry(entry, from, to) {
  const stopTimes = asArray(entry.StopTimes);
  const fromStop = stopTimes.find((stop) => stop.StationID === from);
  const toStop = stopTimes.find((stop) => stop.StationID === to);

  if (!fromStop || !toStop) {
    return null;
  }

  const trainInfo = entry.TrainInfo || entry.DailyTrainInfo || {};
  const durationMinutes = minutesBetween(fromStop.DepartureTime, toStop.ArrivalTime);

  return {
    trainDate: entry.TrainDate,
    trainNo: trainInfo.TrainNo,
    trainType: localizedName(trainInfo.TrainTypeName),
    direction: trainInfo.Direction,
    note: localizedName(trainInfo.Note),
    startingStationName: localizedName(trainInfo.StartingStationName),
    endingStationName: localizedName(trainInfo.EndingStationName),
    departureStationName: localizedName(fromStop.StationName),
    arrivalStationName: localizedName(toStop.StationName),
    departureTime: fromStop.DepartureTime,
    arrivalTime: toStop.ArrivalTime,
    durationMinutes,
    stopCount: Number(toStop.StopSequence || 0) - Number(fromStop.StopSequence || 0),
  };
}

function localizedName(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return value.Zh_tw || value.Zh_tw || value.ZhTw || value.En || value.EnName || '';
}

function englishName(value) {
  if (!value || typeof value === 'string') {
    return '';
  }

  return value.En || value.EnName || '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function tdxArray(value, candidateKeys = []) {
  if (Array.isArray(value)) {
    return value;
  }

  for (const key of candidateKeys) {
    if (Array.isArray(value?.[key])) {
      return value[key];
    }
  }

  return [];
}

function normalizeStationId(value) {
  const stationId = String(value || '').trim();
  return /^[A-Za-z0-9_-]+$/.test(stationId) ? stationId : '';
}

function compareClockTime(left, right) {
  return clockToMinutes(left) - clockToMinutes(right);
}

function clockToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesBetween(start, end) {
  const startMinutes = clockToMinutes(start);
  let endMinutes = clockToMinutes(end);
  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }

  return endMinutes - startMinutes;
}

function sendApiError(res, error) {
  const status = Number(error.status || 500);
  const message =
    status === 401
      ? '尚未設定 TDX API 憑證。請在 .env 設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET。'
      : error.message || '查詢失敗。';

  res.status(status >= 400 && status < 600 ? status : 500).json({
    message,
  });
}
