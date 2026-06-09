const elements = {
  form: document.querySelector('#search-form'),
  fromStation: document.querySelector('#from-station'),
  toStation: document.querySelector('#to-station'),
  stationOptions: document.querySelector('#station-options'),
  travelDate: document.querySelector('#travel-date'),
  travelTime: document.querySelector('#travel-time'),
  resultLimit: document.querySelector('#result-limit'),
  statusMessage: document.querySelector('#status-message'),
  resultCount: document.querySelector('#result-count'),
  emptyState: document.querySelector('#empty-state'),
  resultsList: document.querySelector('#results-list'),
  recentSearches: document.querySelector('#recent-searches'),
  recentSearchList: document.querySelector('#recent-search-list'),
  commonRouteList: document.querySelector('#common-route-list'),
  swapButton: document.querySelector('#swap-button'),
  submitButton: document.querySelector('.primary-button'),
  tripTemplate: document.querySelector('#trip-template'),
};

const recentSearchStorageKey = 'tra-timetable-recent-searches';
const commonRoutes = [
  { fromId: '1000', fromName: '台北', toId: '1080', toName: '桃園' },
  { fromId: '1080', fromName: '桃園', toId: '1000', toName: '台北' },
  { fromId: '1080', fromName: '桃園', toId: '0990', toName: '松山' },
  { fromId: '0990', fromName: '松山', toId: '1080', toName: '桃園' },
];

let stations = [];
let stationByOptionValue = new Map();
let stationById = new Map();

init();

async function init() {
  const now = new Date();
  elements.travelDate.value = formatDate(now);
  elements.travelTime.value = formatTime(now);

  elements.swapButton.addEventListener('click', swapStations);
  elements.form.addEventListener('submit', handleSearch);
  elements.recentSearchList.addEventListener('click', handleRecentSearchClick);
  elements.commonRouteList.addEventListener('click', handleRouteShortcutClick);
  renderCommonRoutes();
  renderRecentSearches();

  await loadStatus();
  await loadStations();
}

async function loadStatus() {
  try {
    const status = await getJson('/api/status');
    if (!status.hasCredentials) {
      setStatus('尚未設定 TDX 憑證；請先依 README 建立 .env。', 'warning');
    }
  } catch {
    setStatus('無法讀取服務狀態。', 'error');
  }
}

async function loadStations() {
  try {
    setLoading(true, '載入車站清單中...');
    const data = await getJson('/api/stations');
    stations = data.stations || [];
    stationByOptionValue = new Map();
    stationById = new Map();
    elements.stationOptions.textContent = '';

    for (const station of stations) {
      const option = document.createElement('option');
      option.value = stationOptionValue(station);
      option.label = station.id;
      elements.stationOptions.append(option);
      stationByOptionValue.set(option.value, station);
      stationByOptionValue.set(station.name, station);
      stationById.set(station.id, station);
    }

    renderCommonRoutes();
    renderRecentSearches();
    setStatus(`已載入 ${stations.length} 個台鐵車站。`);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function handleSearch(event) {
  event.preventDefault();

  const from = resolveStation(elements.fromStation.value);
  const to = resolveStation(elements.toStation.value);

  if (!from || !to) {
    setStatus('請從建議清單選擇正確的起站與訖站。', 'error');
    return;
  }

  if (from.id === to.id) {
    setStatus('起站與訖站不能相同。', 'error');
    return;
  }

  const params = new URLSearchParams({
    from: from.id,
    to: to.id,
    date: elements.travelDate.value,
    time: elements.travelTime.value,
    limit: elements.resultLimit.value,
  });

  try {
    setLoading(true, '查詢班次中...');
    renderTrips([]);
    rememberSearch(from, to);

    const data = await getJson(`/api/timetable?${params}`);
    renderTrips(data.trips || []);

    const label = `${from.name} 到 ${to.name}`;
    setStatus(data.count > 0 ? `已找到 ${data.count} 筆 ${label} 班次。` : `${label} 在指定時間後沒有直達班次。`);
  } catch (error) {
    setStatus(error.message, 'error');
    renderTrips([]);
  } finally {
    setLoading(false);
  }
}

function handleRouteShortcutClick(event) {
  const button = event.target.closest('.route-shortcut-button');
  if (!button) {
    return;
  }

  applyRouteAndSearch(button.dataset.fromId, button.dataset.toId);
}

function handleRecentSearchClick(event) {
  const button = event.target.closest('.recent-search-button');
  if (!button) {
    return;
  }

  applyRouteAndSearch(button.dataset.fromId, button.dataset.toId);
}

function applyRouteAndSearch(fromId, toId) {
  const from = stationById.get(fromId);
  const to = stationById.get(toId);

  if (!from || !to) {
    setStatus('這筆路線的車站資料尚未載入，請稍後再試。', 'error');
    return;
  }

  elements.fromStation.value = stationOptionValue(from);
  elements.toStation.value = stationOptionValue(to);
  elements.form.requestSubmit();
}

function renderCommonRoutes() {
  elements.commonRouteList.textContent = '';

  for (const route of commonRoutes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-shortcut-button';
    button.dataset.fromId = route.fromId;
    button.dataset.toId = route.toId;
    button.textContent = `${route.fromName} → ${route.toName}`;
    elements.commonRouteList.append(button);
  }
}

function rememberSearch(from, to) {
  const nextSearch = {
    fromId: from.id,
    fromName: from.name,
    toId: to.id,
    toName: to.name,
  };

  const searches = loadRecentSearches()
    .filter((search) => search.fromId !== from.id || search.toId !== to.id)
    .filter((search) => search.fromId && search.toId);

  searches.unshift(nextSearch);
  localStorage.setItem(recentSearchStorageKey, JSON.stringify(searches.slice(0, 3)));
  renderRecentSearches();
}

function renderRecentSearches() {
  const searches = loadRecentSearches();
  elements.recentSearchList.textContent = '';
  elements.recentSearches.classList.toggle('hidden', searches.length === 0);

  for (const search of searches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-search-button';
    button.dataset.fromId = search.fromId;
    button.dataset.toId = search.toId;
    button.textContent = `${search.fromName} → ${search.toName}`;
    elements.recentSearchList.append(button);
  }
}

function loadRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentSearchStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch {
    return [];
  }
}

function renderTrips(trips) {
  elements.resultsList.textContent = '';
  elements.resultCount.textContent = `${trips.length} 筆`;
  elements.emptyState.classList.toggle('hidden', trips.length > 0);

  if (trips.length === 0) {
    elements.emptyState.querySelector('h3').textContent = '沒有可顯示的班次';
    elements.emptyState.querySelector('p').textContent = '請調整日期、時間或起訖站再查詢。';
    return;
  }

  for (const trip of trips) {
    const card = elements.tripTemplate.content.cloneNode(true);
    card.querySelector('.train-type').textContent = trip.trainType || '台鐵列車';
    card.querySelector('.train-route').textContent = `${trip.startingStationName || '起點'} → ${trip.endingStationName || '終點'}`;
    card.querySelector('.train-no').textContent = trip.trainNo ? `車次 ${trip.trainNo}` : '車次未提供';
    card.querySelector('.departure-time').textContent = trip.departureTime || '--:--';
    card.querySelector('.arrival-time').textContent = trip.arrivalTime || '--:--';
    card.querySelector('.departure-station').textContent = trip.departureStationName || '';
    card.querySelector('.arrival-station').textContent = trip.arrivalStationName || '';
    card.querySelector('.duration').textContent = formatDuration(trip.durationMinutes, trip.stopCount);

    const note = card.querySelector('.trip-note');
    note.textContent = trip.note || '';
    note.classList.toggle('hidden', !trip.note);

    elements.resultsList.append(card);
  }
}

function resolveStation(value) {
  const input = value.trim();
  if (!input) {
    return null;
  }

  if (stationByOptionValue.has(input)) {
    return stationByOptionValue.get(input);
  }

  const exact = stations.find((station) => station.name === input || station.id === input);
  if (exact) {
    return exact;
  }

  const normalized = input.toLocaleLowerCase('zh-Hant-TW');
  return (
    stations.find((station) => station.name.toLocaleLowerCase('zh-Hant-TW') === normalized) ||
    stations.find((station) => station.englishName?.toLocaleLowerCase('en') === normalized) ||
    null
  );
}

function swapStations() {
  const fromValue = elements.fromStation.value;
  elements.fromStation.value = elements.toStation.value;
  elements.toStation.value = fromValue;
}

function stationOptionValue(station) {
  return station.englishName ? `${station.name} (${station.englishName})` : station.name;
}

function setLoading(isLoading, message = '') {
  elements.submitButton.disabled = isLoading;
  elements.submitButton.textContent = isLoading ? '處理中...' : '查詢班次';
  if (message) {
    setStatus(message);
  }
}

function setStatus(message, type = '') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${type}`.trim();
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `請求失敗 (${response.status})。`);
  }

  return data;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatDuration(minutes, stopCount) {
  if (!Number.isFinite(minutes)) {
    return stopCount > 0 ? `${stopCount} 站` : '時間未提供';
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const duration = hours > 0 ? `${hours} 小時 ${remainingMinutes} 分` : `${remainingMinutes} 分`;
  return stopCount > 0 ? `${duration}・${stopCount} 站` : duration;
}
