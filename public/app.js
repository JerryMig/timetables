const elements = {
  form: document.querySelector('#search-form'),
  fromStation: document.querySelector('#from-station'),
  toStation: document.querySelector('#to-station'),
  commonFromStation: document.querySelector('#common-from-station'),
  commonToStation: document.querySelector('#common-to-station'),
  stationOptions: document.querySelector('#station-options'),
  travelDate: document.querySelector('#travel-date'),
  travelTime: document.querySelector('#travel-time'),
  statusMessage: document.querySelector('#status-message'),
  resultCount: document.querySelector('#result-count'),
  emptyState: document.querySelector('#empty-state'),
  resultsList: document.querySelector('#results-list'),
  commonRouteList: document.querySelector('#common-route-list'),
  commonRouteEditor: document.querySelector('#common-route-editor'),
  commonRouteView: document.querySelector('#common-route-view'),
  customRouteView: document.querySelector('#custom-route-view'),
  commonModeButton: document.querySelector('#common-mode-button'),
  customModeButton: document.querySelector('#custom-mode-button'),
  addCommonRoute: document.querySelector('#add-common-route'),
  saveCommonRoute: document.querySelector('#save-common-route'),
  cancelCommonRoute: document.querySelector('#cancel-common-route'),
  swapButton: document.querySelector('#swap-button'),
  submitButton: document.querySelector('.primary-button'),
  tripTemplate: document.querySelector('#trip-template'),
};

const commonRouteStorageKey = 'tra-timetable-common-routes-v2';
const defaultCommonRoutes = [
  { fromId: '1000', fromName: '台北', toId: '1080', toName: '桃園' },
  { fromId: '1080', fromName: '桃園', toId: '1000', toName: '台北' },
  { fromId: '1080', fromName: '桃園', toId: '0990', toName: '松山' },
  { fromId: '0990', fromName: '松山', toId: '1080', toName: '桃園' },
];

let stations = [];
let stationByOptionValue = new Map();
let stationById = new Map();
let currentView = 'common';
let selectedCommonRoute = null;

init();

async function init() {
  const now = new Date();
  elements.travelDate.value = formatDate(now);
  elements.travelTime.value = formatTime(now);

  elements.swapButton.addEventListener('click', swapStations);
  elements.form.addEventListener('submit', handleSearch);
  elements.commonRouteList.addEventListener('click', handleRouteShortcutClick);
  elements.commonModeButton.addEventListener('click', () => setView('common'));
  elements.customModeButton.addEventListener('click', () => setView('custom'));
  elements.addCommonRoute.addEventListener('click', showCommonRouteEditor);
  elements.saveCommonRoute.addEventListener('click', addCommonRouteFromEditor);
  elements.cancelCommonRoute.addEventListener('click', hideCommonRouteEditor);
  renderCommonRoutes();

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
    setStatus(`已載入 ${stations.length} 個台鐵車站。`);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function handleSearch(event) {
  event.preventDefault();

  const route = currentView === 'common' ? resolveSelectedCommonRoute() : resolveCustomRoute();

  if (!route) {
    return;
  }

  const { from, to } = route;

  if (from.id === to.id) {
    setStatus('起站與訖站不能相同。', 'error');
    return;
  }

  const params = new URLSearchParams({
    from: from.id,
    to: to.id,
    date: elements.travelDate.value,
    time: elements.travelTime.value,
    limit: '20',
  });

  try {
    setLoading(true, '查詢班次中...');
    renderTrips([]);

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
  const deleteButton = event.target.closest('.route-delete-button');
  if (deleteButton) {
    deleteCommonRoute(deleteButton.dataset.fromId, deleteButton.dataset.toId);
    return;
  }

  const button = event.target.closest('.route-shortcut-button');
  if (!button) {
    return;
  }

  selectCommonRoute(button.dataset.fromId, button.dataset.toId);
}

function setView(view) {
  currentView = view;
  const isCommon = view === 'common';

  elements.commonRouteView.classList.toggle('hidden', !isCommon);
  elements.customRouteView.classList.toggle('hidden', isCommon);
  elements.commonModeButton.classList.toggle('active', isCommon);
  elements.customModeButton.classList.toggle('active', !isCommon);
  elements.commonModeButton.setAttribute('aria-selected', String(isCommon));
  elements.customModeButton.setAttribute('aria-selected', String(!isCommon));
}

function resolveSelectedCommonRoute() {
  if (!selectedCommonRoute) {
    setStatus('請先選擇一筆常用路線。', 'error');
    return null;
  }

  const from = stationById.get(selectedCommonRoute.fromId);
  const to = stationById.get(selectedCommonRoute.toId);

  if (!from || !to) {
    setStatus('這筆常用路線的車站資料尚未載入，請稍後再試。', 'error');
    return null;
  }

  return { from, to };
}

function resolveCustomRoute() {
  const from = resolveStation(elements.fromStation.value);
  const to = resolveStation(elements.toStation.value);

  if (!from || !to) {
    setStatus('請從建議清單選擇正確的起站與訖站。', 'error');
    return null;
  }

  return { from, to };
}

function selectCommonRoute(fromId, toId) {
  selectedCommonRoute = { fromId, toId };
  renderCommonRoutes();
}

function renderCommonRoutes() {
  const commonRoutes = loadCommonRoutes();
  elements.commonRouteList.textContent = '';

  if (commonRoutes.length === 0) {
    selectedCommonRoute = null;
    const empty = document.createElement('p');
    empty.className = 'route-shortcut-empty';
    empty.textContent = '尚未加入常用路線。';
    elements.commonRouteList.append(empty);
    return;
  }

  if (
    !selectedCommonRoute ||
    !commonRoutes.some((route) => route.fromId === selectedCommonRoute.fromId && route.toId === selectedCommonRoute.toId)
  ) {
    selectedCommonRoute = { fromId: commonRoutes[0].fromId, toId: commonRoutes[0].toId };
  }

  for (const route of commonRoutes) {
    const item = document.createElement('span');
    item.className = 'route-shortcut-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-shortcut-button';
    button.dataset.fromId = route.fromId;
    button.dataset.toId = route.toId;
    button.textContent = `${route.fromName} → ${route.toName}`;
    button.classList.toggle(
      'selected',
      selectedCommonRoute?.fromId === route.fromId && selectedCommonRoute?.toId === route.toId,
    );
    button.setAttribute('aria-pressed', String(button.classList.contains('selected')));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'route-delete-button';
    deleteButton.dataset.fromId = route.fromId;
    deleteButton.dataset.toId = route.toId;
    deleteButton.setAttribute('aria-label', `刪除 ${route.fromName} 到 ${route.toName}`);
    deleteButton.title = '刪除';
    deleteButton.textContent = '×';

    item.append(button, deleteButton);
    elements.commonRouteList.append(item);
  }
}

function showCommonRouteEditor() {
  elements.commonRouteEditor.classList.remove('hidden');
  elements.commonFromStation.value = '';
  elements.commonToStation.value = '';
  elements.commonFromStation.focus();
}

function hideCommonRouteEditor() {
  elements.commonRouteEditor.classList.add('hidden');
  elements.commonFromStation.value = '';
  elements.commonToStation.value = '';
}

function addCommonRouteFromEditor() {
  const from = resolveStation(elements.commonFromStation.value);
  const to = resolveStation(elements.commonToStation.value);

  if (!from || !to) {
    setStatus('請先選擇正確的常用路線起站與訖站。', 'error');
    return;
  }

  if (from.id === to.id) {
    setStatus('起站與訖站不能相同。', 'error');
    return;
  }

  const routes = loadCommonRoutes();
  const exists = routes.some((route) => route.fromId === from.id && route.toId === to.id);
  if (exists) {
    setStatus(`${from.name} 到 ${to.name} 已在常用路線中。`, 'warning');
    return;
  }

  routes.push({
    fromId: from.id,
    fromName: displayStationName(from),
    toId: to.id,
    toName: displayStationName(to),
  });
  saveCommonRoutes(routes);
  selectedCommonRoute = { fromId: from.id, toId: to.id };
  renderCommonRoutes();
  hideCommonRouteEditor();
  setStatus(`已加入 ${from.name} 到 ${to.name} 常用路線。`);
}

function deleteCommonRoute(fromId, toId) {
  const routes = loadCommonRoutes();
  const nextRoutes = routes.filter((route) => route.fromId !== fromId || route.toId !== toId);

  saveCommonRoutes(nextRoutes);
  if (selectedCommonRoute?.fromId === fromId && selectedCommonRoute?.toId === toId) {
    selectedCommonRoute = null;
  }
  renderCommonRoutes();
  setStatus('已刪除常用路線。');
}

function loadCommonRoutes() {
  try {
    const saved = localStorage.getItem(commonRouteStorageKey);
    if (!saved) {
      return cloneDefaultCommonRoutes();
    }

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return cloneDefaultCommonRoutes();
    }

    return parsed
      .filter((route) => route.fromId && route.toId && route.fromName && route.toName)
      .map((route) => ({
        fromId: String(route.fromId),
        fromName: String(route.fromName),
        toId: String(route.toId),
        toName: String(route.toName),
      }));
  } catch {
    return cloneDefaultCommonRoutes();
  }
}

function saveCommonRoutes(routes) {
  localStorage.setItem(commonRouteStorageKey, JSON.stringify(routes));
}

function cloneDefaultCommonRoutes() {
  return defaultCommonRoutes.map((route) => ({ ...route }));
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

function displayStationName(station) {
  return station.name === '臺北' ? '台北' : station.name;
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
