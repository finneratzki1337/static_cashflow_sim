const CURRENCY_CONFIG = {
  HKD: { decimals: 2 },
  EUR: { decimals: 2 },
  USD: { decimals: 2 },
  GBP: { decimals: 2 },
  JPY: { decimals: 0 },
};

const FREQUENCIES = ["Monthly", "One time", "Quarterly", "Yearly"];
const EFFECTIVES = ["Immediate", "Spread 1 month", "Spread quarter", "Spread year"];
const RESOLUTIONS = ["Daily", "Weekly", "Monthly"];
const STORAGE_KEY = "static_cashflow_state_v1";

const state = {
  startDate: "",
  timeframeYears: 1,
  startValue: 0,
  currency: "HKD",
  resolution: "Monthly",
  rows: [],
};

let balanceChart = null;
let flowChart = null;
let computeTimer = null;
let saveTimer = null;

const elements = {
  startDate: document.getElementById("startDate"),
  timeframeYears: document.getElementById("timeframeYears"),
  startValue: document.getElementById("startValue"),
  currency: document.getElementById("currency"),
  ruleRows: document.getElementById("ruleRows"),
  outputRows: document.getElementById("outputRows"),
  resolutionSwitch: document.getElementById("resolutionSwitch"),
  warnings: document.getElementById("warnings"),
  calculateBtn: document.getElementById("calculateBtn"),
  shareBtn: document.getElementById("shareBtn"),
  resetBtn: document.getElementById("resetBtn"),
};

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultRow() {
  return {
    direction: "in",
    amount: "",
    dateStr: "",
    year: "",
    frequency: "Monthly",
    effective: "Immediate",
    note: "",
  };
}

function initializeState() {
  state.startDate = todayISO();
  state.timeframeYears = 1;
  state.startValue = 0;
  state.currency = "HKD";
  state.resolution = "Monthly";
  state.rows = [defaultRow()];
}

function parseDayMonth(input) {
  if (!input) {
    return null;
  }
  const cleaned = input.trim();
  const match = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month)) {
    return null;
  }
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  return { day, month };
}

function makeUTCDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonthsClamped(date, months, anchorDay) {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const targetIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonthIndex = ((targetIndex % 12) + 12) % 12;
  const targetMonth = targetMonthIndex + 1;
  const desiredDay = anchorDay ?? date.getUTCDate();
  const maxDay = daysInMonth(targetYear, targetMonth);
  const clampedDay = Math.min(desiredDay, maxDay);
  return makeUTCDate(targetYear, targetMonth, clampedDay);
}

function addYearsClamped(date, years, anchorDay, anchorMonth) {
  const year = date.getUTCFullYear() + years;
  const month = anchorMonth ?? date.getUTCMonth() + 1;
  const desiredDay = anchorDay ?? date.getUTCDate();
  const maxDay = daysInMonth(year, month);
  const clampedDay = Math.min(desiredDay, maxDay);
  return makeUTCDate(year, month, clampedDay);
}

function formatDDMMYYYY(date) {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}.${m}.${y}`;
}

function formatISODate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayIndex(startDate, targetDate) {
  const ms = targetDate.getTime() - startDate.getTime();
  return Math.round(ms / 86400000);
}

function inferYear(startDate, day, month) {
  const year = startDate.getUTCFullYear();
  const candidate = makeUTCDate(year, month, Math.min(day, daysInMonth(year, month)));
  if (candidate.getTime() >= startDate.getTime()) {
    return year;
  }
  return year + 1;
}

function isRowEmpty(row) {
  return !row.amount && !row.dateStr && !row.year && !row.note;
}

function ensureEmptyRow() {
  const last = state.rows[state.rows.length - 1];
  if (!last || !isRowEmpty(last)) {
    state.rows.push(defaultRow());
  }
}

function updateGlobalInputs() {
  elements.startDate.value = state.startDate;
  elements.timeframeYears.value = state.timeframeYears;
  elements.startValue.value = state.startValue;
  elements.currency.value = state.currency;
}

function renderCurrencyOptions() {
  elements.currency.innerHTML = "";
  Object.keys(CURRENCY_CONFIG).forEach((currency) => {
    const option = document.createElement("option");
    option.value = currency;
    option.textContent = currency;
    elements.currency.appendChild(option);
  });
}

function renderResolutionSwitch() {
  elements.resolutionSwitch.innerHTML = "";
  RESOLUTIONS.forEach((resolution) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = resolution;
    if (resolution === state.resolution) {
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => {
      state.resolution = resolution;
      renderResolutionSwitch();
      scheduleCompute();
      scheduleSave();
    });
    elements.resolutionSwitch.appendChild(btn);
  });
}

function renderRows() {
  elements.ruleRows.innerHTML = "";
  state.rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (row.invalid) {
      tr.classList.add("invalid");
    }
    tr.innerHTML = `
      <td>
        <select data-field="direction">
          <option value="in">Cash In</option>
          <option value="out">Cash Out</option>
        </select>
      </td>
      <td><input type="number" step="0.01" data-field="amount" value="${row.amount}" /></td>
      <td><input type="text" placeholder="1.5." data-field="dateStr" value="${row.dateStr}" /></td>
      <td><input type="number" data-field="year" value="${row.year}" /></td>
      <td>
        <select data-field="frequency"></select>
      </td>
      <td>
        <select data-field="effective"></select>
      </td>
      <td><input class="note-input" type="text" data-field="note" value="${row.note}" /></td>
      <td>${index < state.rows.length - 1 ? '<button class="delete-btn" data-action="delete">✕</button>' : ""}</td>
    `;

    const frequencySelect = tr.querySelector('select[data-field="frequency"]');
    FREQUENCIES.forEach((freq) => {
      const option = document.createElement("option");
      option.value = freq;
      option.textContent = freq;
      frequencySelect.appendChild(option);
    });
    frequencySelect.value = row.frequency;

    const effectiveSelect = tr.querySelector('select[data-field="effective"]');
    EFFECTIVES.forEach((eff) => {
      const option = document.createElement("option");
      option.value = eff;
      option.textContent = eff;
      effectiveSelect.appendChild(option);
    });
    effectiveSelect.value = row.effective;

    const directionSelect = tr.querySelector('select[data-field="direction"]');
    directionSelect.value = row.direction;

    tr.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        if (!field) {
          return;
        }
        row[field] = input.value;
        if (field === "dateStr") {
          const parsed = parseDayMonth(row.dateStr);
          if (parsed) {
            if (!row.year) {
              const startDate = parseStartDate();
              if (startDate) {
                row.year = String(inferYear(startDate, parsed.day, parsed.month));
              }
            }
          }
        }
        ensureEmptyRow();
        scheduleCompute();
        scheduleSave();
        renderRows();
      });
    });

    const deleteBtn = tr.querySelector('[data-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        state.rows.splice(index, 1);
        ensureEmptyRow();
        scheduleCompute();
        scheduleSave();
        renderRows();
      });
    }

    elements.ruleRows.appendChild(tr);
  });
}

function parseStartDate() {
  if (!state.startDate) {
    return null;
  }
  const [year, month, day] = state.startDate.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return makeUTCDate(year, month, day);
}

function toMinor(amount, currency) {
  const decimals = CURRENCY_CONFIG[currency].decimals;
  const factor = 10 ** decimals;
  return Math.round(Number(amount || 0) * factor);
}

function formatMoney(minor, currency) {
  const decimals = CURRENCY_CONFIG[currency].decimals;
  const factor = 10 ** decimals;
  const value = minor / factor;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function compileRules(startDate, endDate) {
  const rules = [];
  state.rows.forEach((row) => {
    if (isRowEmpty(row)) {
      row.invalid = false;
      return;
    }
    const parsed = parseDayMonth(row.dateStr);
    if (!parsed) {
      row.invalid = true;
      return;
    }
    const yearValue = Number(row.year || "");
    if (!yearValue) {
      row.invalid = true;
      return;
    }
    const maxDay = daysInMonth(yearValue, parsed.month);
    if (parsed.day > maxDay) {
      row.invalid = true;
      return;
    }
    const amountNum = Number(row.amount || 0);
    if (!amountNum) {
      row.invalid = false;
      return;
    }
    row.invalid = false;
    const sign = row.direction === "out" ? -1 : 1;
    const amountMinor = toMinor(amountNum, state.currency) * sign;
    const occurrence = makeUTCDate(yearValue, parsed.month, parsed.day);
    if (occurrence.getTime() >= endDate.getTime()) {
      return;
    }
    rules.push({
      amountMinor,
      occurrence,
      day: parsed.day,
      month: parsed.month,
      frequency: row.frequency,
      effective: row.effective,
      note: row.note,
    });
  });
  return rules;
}

function getTimeframeEnd(startDate) {
  return addYearsClamped(startDate, state.timeframeYears, startDate.getUTCDate(), startDate.getUTCMonth() + 1);
}

function generateOccurrences(rule, startDate, endDate) {
  const occurrences = [];
  const freq = rule.frequency;
  const anchorDay = rule.day;
  const anchorMonth = rule.month;
  let current = rule.occurrence;
  if (freq !== "One time") {
    while (current.getTime() < startDate.getTime()) {
      if (freq === "Monthly") {
        current = addMonthsClamped(current, 1, anchorDay);
      } else if (freq === "Quarterly") {
        current = addMonthsClamped(current, 3, anchorDay);
      } else if (freq === "Yearly") {
        current = addYearsClamped(current, 1, anchorDay, anchorMonth);
      }
    }
  }

  while (current.getTime() < endDate.getTime()) {
    if (current.getTime() >= startDate.getTime()) {
      occurrences.push(current);
    }
    if (freq === "One time") {
      break;
    }
    if (freq === "Monthly") {
      current = addMonthsClamped(current, 1, anchorDay);
    } else if (freq === "Quarterly") {
      current = addMonthsClamped(current, 3, anchorDay);
    } else {
      current = addYearsClamped(current, 1, anchorDay, anchorMonth);
    }
  }
  return occurrences;
}

function applyOccurrence(diffNet, occDate, effective, amountMinor, startDate, endDate) {
  const iStart = dayIndex(startDate, occDate);
  if (effective === "Immediate") {
    diffNet[iStart] += amountMinor;
    diffNet[iStart + 1] -= amountMinor;
    return;
  }
  let spreadEnd = occDate;
  if (effective === "Spread 1 month") {
    spreadEnd = addMonthsClamped(occDate, 1);
  } else if (effective === "Spread quarter") {
    spreadEnd = addMonthsClamped(occDate, 3);
  } else if (effective === "Spread year") {
    spreadEnd = addYearsClamped(occDate, 1);
  }
  if (spreadEnd.getTime() > endDate.getTime()) {
    spreadEnd = endDate;
  }
  const iEnd = dayIndex(startDate, spreadEnd);
  const nDays = Math.max(1, iEnd - iStart);
  const base = Math.trunc(amountMinor / nDays);
  const remainder = amountMinor - base * nDays;
  diffNet[iStart] += base;
  diffNet[iEnd] -= base;
  if (remainder !== 0) {
    const step = remainder > 0 ? 1 : -1;
    const count = Math.abs(remainder);
    for (let i = 0; i < count; i += 1) {
      diffNet[iStart + i] += step;
      diffNet[iStart + i + 1] -= step;
    }
  }
}

function simulate() {
  const startDate = parseStartDate();
  if (!startDate) {
    return null;
  }
  const endDate = getTimeframeEnd(startDate);
  const totalDays = dayIndex(startDate, endDate);
  if (totalDays <= 0) {
    return null;
  }

  const diffNet = new Array(totalDays + 1).fill(0);
  const rules = compileRules(startDate, endDate);
  rules.forEach((rule) => {
    const occurrences = generateOccurrences(rule, startDate, endDate);
    occurrences.forEach((occ) => {
      applyOccurrence(diffNet, occ, rule.effective, rule.amountMinor, startDate, endDate);
    });
  });

  const dailyNet = new Array(totalDays).fill(0);
  const dailyBalance = new Array(totalDays).fill(0);
  let runningNet = 0;
  let runningBalance = toMinor(state.startValue, state.currency);
  for (let i = 0; i < totalDays; i += 1) {
    runningNet += diffNet[i];
    dailyNet[i] = runningNet;
    runningBalance += runningNet;
    dailyBalance[i] = runningBalance;
  }
  return { startDate, endDate, dailyNet, dailyBalance };
}

function bucketize(simulation) {
  const { startDate, dailyNet, dailyBalance } = simulation;
  const buckets = new Map();

  for (let i = 0; i < dailyNet.length; i += 1) {
    const date = addDays(startDate, i);
    let key = "";
    let label = "";
    if (state.resolution === "Daily") {
      key = formatISODate(date);
      label = key;
    } else if (state.resolution === "Weekly") {
      const iso = getISOWeek(date);
      key = `${iso.year}-W${String(iso.week).padStart(2, "0")}`;
      label = key;
    } else {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      key = `${year}-${month}`;
      label = key;
    }
    if (!buckets.has(key)) {
      buckets.set(key, {
        label,
        flowSum: 0,
        minBalance: dailyBalance[i],
        maxBalance: dailyBalance[i],
        totalBalance: 0,
        days: 0,
        endBalance: dailyBalance[i],
      });
    }
    const bucket = buckets.get(key);
    bucket.flowSum += dailyNet[i];
    bucket.minBalance = Math.min(bucket.minBalance, dailyBalance[i]);
    bucket.maxBalance = Math.max(bucket.maxBalance, dailyBalance[i]);
    bucket.totalBalance += dailyBalance[i];
    bucket.days += 1;
    bucket.endBalance = dailyBalance[i];
  }

  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    avgBalance: Math.round(bucket.totalBalance / bucket.days),
  }));
}

function getISOWeek(date) {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return { year: tmp.getUTCFullYear(), week };
}

function renderOutputs(simulation) {
  if (!simulation) {
    elements.outputRows.innerHTML = "";
    elements.warnings.innerHTML = "";
    if (balanceChart) {
      balanceChart.destroy();
      balanceChart = null;
    }
    if (flowChart) {
      flowChart.destroy();
      flowChart = null;
    }
    return;
  }
  const buckets = bucketize(simulation);
  const labels = buckets.map((b) => b.label);
  const balanceData = buckets.map((b) => b.endBalance);
  const flowData = buckets.map((b) => b.flowSum);

  renderTable(buckets);
  renderWarnings(simulation);
  renderCharts(labels, balanceData, flowData, buckets);
}

function renderTable(buckets) {
  elements.outputRows.innerHTML = "";
  buckets.forEach((bucket) => {
    const tr = document.createElement("tr");
    const minClass = bucket.minBalance < 0 ? "negative" : "";
    const maxClass = bucket.maxBalance < 0 ? "negative" : "";
    const avgClass = bucket.avgBalance < 0 ? "negative" : "";
    const endClass = bucket.endBalance < 0 ? "negative" : "";
    tr.innerHTML = `
      <td>${bucket.label}</td>
      <td class="${minClass}">${formatMoney(bucket.minBalance, state.currency)}</td>
      <td class="${maxClass}">${formatMoney(bucket.maxBalance, state.currency)}</td>
      <td class="${avgClass}">${formatMoney(bucket.avgBalance, state.currency)}</td>
      <td class="${endClass}">${formatMoney(bucket.endBalance, state.currency)}</td>
    `;
    elements.outputRows.appendChild(tr);
  });
}

function renderWarnings(simulation) {
  const { dailyBalance, startDate } = simulation;
  let minBalance = dailyBalance[0];
  let minIndex = 0;
  dailyBalance.forEach((balance, index) => {
    if (balance < minBalance) {
      minBalance = balance;
      minIndex = index;
    }
  });
  const minDate = formatDDMMYYYY(addDays(startDate, minIndex));
  elements.warnings.innerHTML = "";
  const pill = document.createElement("div");
  pill.className = "warning-pill" + (minBalance < 0 ? " negative" : "");
  pill.textContent = `Lowest cash point: ${minDate} (${formatMoney(minBalance, state.currency)})`;
  elements.warnings.appendChild(pill);
}

function renderCharts(labels, balanceData, flowData, buckets) {
  const balanceCtx = document.getElementById("balanceChart");
  const flowCtx = document.getElementById("flowChart");
  const currency = state.currency;

  const commonTooltip = {
    callbacks: {
      label: (context) => {
        const index = context.dataIndex;
        const bucket = buckets[index];
        if (!bucket) {
          return "";
        }
        if (context.chart.canvas.id === "balanceChart") {
          return [
            `End: ${formatMoney(bucket.endBalance, currency)}`,
            `Min: ${formatMoney(bucket.minBalance, currency)}`,
            `Max: ${formatMoney(bucket.maxBalance, currency)}`,
            `Avg: ${formatMoney(bucket.avgBalance, currency)}`,
          ];
        }
        return `Net: ${formatMoney(bucket.flowSum, currency)}`;
      },
    },
  };

  if (balanceChart) {
    balanceChart.data.labels = labels;
    balanceChart.data.datasets[0].data = balanceData.map((value) => value / 10 ** CURRENCY_CONFIG[currency].decimals);
    balanceChart.update();
  } else {
    balanceChart = new Chart(balanceCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "End Balance",
            data: balanceData.map((value) => value / 10 ** CURRENCY_CONFIG[currency].decimals),
            borderColor: "#4c8dff",
            backgroundColor: "rgba(76, 141, 255, 0.2)",
            tension: 0.3,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: commonTooltip,
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatMoney(Math.round(value * 10 ** CURRENCY_CONFIG[currency].decimals), currency),
            },
          },
        },
      },
    });
  }

  if (flowChart) {
    flowChart.data.labels = labels;
    flowChart.data.datasets[0].data = flowData.map((value) => value / 10 ** CURRENCY_CONFIG[currency].decimals);
    flowChart.update();
  } else {
    flowChart = new Chart(flowCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Net Flow",
            data: flowData.map((value) => value / 10 ** CURRENCY_CONFIG[currency].decimals),
            backgroundColor: "rgba(89, 209, 133, 0.5)",
            borderColor: "#59d185",
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: commonTooltip,
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatMoney(Math.round(value * 10 ** CURRENCY_CONFIG[currency].decimals), currency),
            },
          },
        },
      },
    });
  }
}

function scheduleCompute() {
  if (computeTimer) {
    clearTimeout(computeTimer);
  }
  computeTimer = setTimeout(() => {
    const simulation = simulate();
    renderOutputs(simulation);
  }, 300);
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, 300);
}

function encodeState() {
  const payload = JSON.stringify(state);
  return btoa(unescape(encodeURIComponent(payload)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeState(encoded) {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(base64)));
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

function loadState() {
  const hash = window.location.hash;
  if (hash.startsWith("#s=")) {
    const decoded = decodeState(hash.slice(3));
    if (decoded) {
      Object.assign(state, decoded);
      ensureEmptyRow();
      return;
    }
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      Object.assign(state, parsed);
      ensureEmptyRow();
      return;
    } catch (error) {
      // ignore
    }
  }
  initializeState();
}

function bindGlobalInputs() {
  elements.startDate.addEventListener("change", () => {
    state.startDate = elements.startDate.value;
    state.rows.forEach((row) => {
      if (row.dateStr && !row.year) {
        const parsed = parseDayMonth(row.dateStr);
        if (parsed) {
          const startDate = parseStartDate();
          if (startDate) {
            row.year = String(inferYear(startDate, parsed.day, parsed.month));
          }
        }
      }
    });
    renderRows();
    scheduleCompute();
    scheduleSave();
  });
  elements.timeframeYears.addEventListener("input", () => {
    state.timeframeYears = Number(elements.timeframeYears.value || 1);
    scheduleCompute();
    scheduleSave();
  });
  elements.startValue.addEventListener("input", () => {
    state.startValue = Number(elements.startValue.value || 0);
    scheduleCompute();
    scheduleSave();
  });
  elements.currency.addEventListener("change", () => {
    state.currency = elements.currency.value;
    scheduleCompute();
    scheduleSave();
  });
  elements.calculateBtn.addEventListener("click", () => {
    const simulation = simulate();
    renderOutputs(simulation);
  });
  elements.shareBtn.addEventListener("click", async () => {
    const encoded = encodeState();
    window.location.hash = `s=${encoded}`;
    try {
      await navigator.clipboard.writeText(window.location.href);
      elements.shareBtn.textContent = "Link copied!";
      setTimeout(() => {
        elements.shareBtn.textContent = "Share link with these Parameters";
      }, 1500);
    } catch (error) {
      // ignore clipboard failures
    }
  });
  elements.resetBtn.addEventListener("click", () => {
    initializeState();
    window.location.hash = "";
    localStorage.removeItem(STORAGE_KEY);
    renderAll();
  });
}

function renderAll() {
  renderCurrencyOptions();
  updateGlobalInputs();
  renderResolutionSwitch();
  ensureEmptyRow();
  renderRows();
  scheduleCompute();
}

loadState();
renderAll();
bindGlobalInputs();
