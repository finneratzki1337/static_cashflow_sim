const CURRENCY_CONFIG = {
  HKD: { decimals: 2 },
  EUR: { decimals: 2 },
  USD: { decimals: 2 },
  GBP: { decimals: 2 },
  JPY: { decimals: 0 },
};

const FREQUENCIES = ["Monthly", "One time", "Quarterly", "Yearly"];
const EFFECTIVES = ["Immediate", "Spread 1 month", "Spread quarter", "Spread year"];
const RESOLUTIONS = ["Daily", "Weekly", "Monthly", "Yearly"];
const STORAGE_KEY = "static_cashflow_state_v1";

const state = {
  startDate: "",
  timeframeYears: 1,
  startValue: 0,
  currency: "HKD",
  resolution: "Monthly",
  investEnabled: false,
  investMinCash: 0,
  investAnnualRatePct: 0,
  rows: [],
};

let balanceChart = null;
let rateChart = null;
let flowChart = null;
let investmentChart = null;
let computeTimer = null;
let saveTimer = null;

let ruleSortKey = null;
let ruleSortAsc = true;

const elements = {
  startDate: document.getElementById("startDate"),
  timeframeYears: document.getElementById("timeframeYears"),
  startValue: document.getElementById("startValue"),
  currency: document.getElementById("currency"),
  investEnabled: document.getElementById("investEnabled"),
  investMinCash: document.getElementById("investMinCash"),
  investAnnualRatePct: document.getElementById("investAnnualRatePct"),
  investmentChartCard: document.getElementById("investmentChartCard"),
  ruleRows: document.getElementById("ruleRows"),
  outputRows: document.getElementById("outputRows"),
  resolutionSwitch: document.getElementById("resolutionSwitch"),
  warnings: document.getElementById("warnings"),
  calculateBtn: document.getElementById("calculateBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  shareBtn: document.getElementById("shareBtn"),
  jumpToChartBtn: document.getElementById("jumpToChartBtn"),
  resetBtn: document.getElementById("resetBtn"),
  labelSuggestions: document.getElementById("labelSuggestions"),
  metricsStrip: document.getElementById("metricsStrip"),
  metricEndValue: document.getElementById("metricEndValue"),
  metricEndDate: document.getElementById("metricEndDate"),
  metricMaxValue: document.getElementById("metricMaxValue"),
  metricMaxDate: document.getElementById("metricMaxDate"),
  metricMinValue: document.getElementById("metricMinValue"),
  metricMinDate: document.getElementById("metricMinDate"),
  metricInvestMaxValue: document.getElementById("metricInvestMaxValue"),
  metricInvestMaxDate: document.getElementById("metricInvestMaxDate"),
  transactionRows: document.getElementById("transactionRows"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
};

let lastTransactions = [];

function setMetric(valueEl, dateEl, valueText, dateText) {
  if (valueEl) {
    valueEl.textContent = valueText;
  }
  if (dateEl) {
    dateEl.textContent = dateText;
  }
}

function updateMetricsStrip(simulation) {
  if (!elements.metricsStrip) {
    return;
  }
  if (!simulation || !Array.isArray(simulation.dailyBalance) || !simulation.startDate) {
    setMetric(elements.metricEndValue, elements.metricEndDate, "—", "—");
    setMetric(elements.metricMaxValue, elements.metricMaxDate, "—", "—");
    setMetric(elements.metricMinValue, elements.metricMinDate, "—", "—");
    setMetric(elements.metricInvestMaxValue, elements.metricInvestMaxDate, "—", "—");
    return;
  }

  const { dailyBalance, startDate } = simulation;
  if (dailyBalance.length === 0) {
    setMetric(elements.metricEndValue, elements.metricEndDate, "—", "—");
    setMetric(elements.metricMaxValue, elements.metricMaxDate, "—", "—");
    setMetric(elements.metricMinValue, elements.metricMinDate, "—", "—");
    setMetric(elements.metricInvestMaxValue, elements.metricInvestMaxDate, "—", "—");
    return;
  }

  let minBalance = dailyBalance[0];
  let minIndex = 0;
  let maxBalance = dailyBalance[0];
  let maxIndex = 0;

  dailyBalance.forEach((balance, index) => {
    if (balance < minBalance) {
      minBalance = balance;
      minIndex = index;
    }
    if (balance > maxBalance) {
      maxBalance = balance;
      maxIndex = index;
    }
  });

  const endIndex = dailyBalance.length - 1;
  const endBalance = dailyBalance[endIndex];

  const endDate = formatDDMMYYYY(addDays(startDate, endIndex));
  const minDate = formatDDMMYYYY(addDays(startDate, minIndex));
  const maxDate = formatDDMMYYYY(addDays(startDate, maxIndex));

  setMetric(elements.metricEndValue, elements.metricEndDate, formatMoney(endBalance, state.currency), endDate);
  setMetric(elements.metricMaxValue, elements.metricMaxDate, formatMoney(maxBalance, state.currency), maxDate);
  setMetric(elements.metricMinValue, elements.metricMinDate, formatMoney(minBalance, state.currency), minDate);

  const investSeries = simulation.investment?.dailyInvestBalance;
  if (!Array.isArray(investSeries) || investSeries.length === 0) {
    setMetric(elements.metricInvestMaxValue, elements.metricInvestMaxDate, "—", "—");
    return;
  }
  let maxInvest = investSeries[0] || 0;
  let maxInvestIndex = 0;
  investSeries.forEach((value, index) => {
    const v = value || 0;
    if (v > maxInvest) {
      maxInvest = v;
      maxInvestIndex = index;
    }
  });
  const maxInvestDate = formatDDMMYYYY(addDays(startDate, maxInvestIndex));
  setMetric(elements.metricInvestMaxValue, elements.metricInvestMaxDate, formatMoney(maxInvest, state.currency), maxInvestDate);
}

function collectAllLabels() {
  const seen = new Map();
  (state.rows || []).forEach((row) => {
    const labels = Array.isArray(row.labels) ? row.labels : [];
    labels.forEach((label) => {
      const cleaned = normalizeLabel(label);
      if (!cleaned) {
        return;
      }
      const key = cleaned.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, cleaned);
      }
    });
  });
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

function renderLabelSuggestions() {
  if (!elements.labelSuggestions) {
    return;
  }
  const labels = collectAllLabels();
  elements.labelSuggestions.innerHTML = "";
  labels.forEach((label) => {
    const option = document.createElement("option");
    option.value = label;
    elements.labelSuggestions.appendChild(option);
  });
}

function updateRuleRowInvalidStyles() {
  elements.ruleRows.querySelectorAll('tr[data-row-kind="main"][data-row-index]').forEach((tr) => {
    const index = Number(tr.dataset.rowIndex);
    const row = state.rows[index];
    if (row && row.invalid) {
      tr.classList.add("invalid");
    } else {
      tr.classList.remove("invalid");
    }
  });
}

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
    endDate: "",
    escalationPct: "",
    escalationEvery: "1",
    escalationUnit: "month",
    labels: [],
    expanded: false,
  };
}

function normalizeRowInPlace(row) {
  if (!row || typeof row !== "object") {
    return;
  }
  if (!Array.isArray(row.labels)) {
    if (typeof row.note === "string" && row.note.trim()) {
      row.labels = [row.note.trim()];
    } else {
      row.labels = [];
    }
  }
  if (typeof row.endDate !== "string") {
    row.endDate = "";
  }
  if (typeof row.expanded !== "boolean") {
    row.expanded = false;
  }

  if (typeof row.escalationPct === "number") {
    row.escalationPct = String(row.escalationPct);
  }
  if (typeof row.escalationPct !== "string") {
    row.escalationPct = "";
  }

  if (typeof row.escalationEvery === "number") {
    row.escalationEvery = String(row.escalationEvery);
  }
  if (typeof row.escalationEvery !== "string" || !row.escalationEvery.trim()) {
    row.escalationEvery = "1";
  }

  if (row.escalationUnit !== "month" && row.escalationUnit !== "year") {
    row.escalationUnit = "month";
  }
}

function normalizeLoadedStateInPlace() {
  if (!Array.isArray(state.rows)) {
    state.rows = [];
  }
  (state.rows || []).forEach((row) => normalizeRowInPlace(row));

  if (typeof state.investEnabled !== "boolean") {
    state.investEnabled = false;
  }
  if (!Number.isFinite(state.investMinCash)) {
    state.investMinCash = 0;
  }
  if (!Number.isFinite(state.investAnnualRatePct)) {
    state.investAnnualRatePct = 0;
  }
}

function initializeState() {
  state.startDate = todayISO();
  state.timeframeYears = 1;
  state.startValue = 0;
  state.currency = "HKD";
  state.resolution = "Monthly";
  state.investEnabled = false;
  state.investMinCash = 0;
  state.investAnnualRatePct = 0;
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
  const labels = Array.isArray(row.labels) ? row.labels : [];
  return !row.amount && !row.dateStr && !row.year && labels.length === 0;
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

  if (elements.investEnabled) {
    elements.investEnabled.checked = Boolean(state.investEnabled);
  }
  if (elements.investMinCash) {
    elements.investMinCash.value = String(Number(state.investMinCash || 0));
  }
  if (elements.investAnnualRatePct) {
    elements.investAnnualRatePct.value = String(Number(state.investAnnualRatePct || 0));
  }
}

function buildSuffixMin(values) {
  const n = Array.isArray(values) ? values.length : 0;
  const out = new Array(n);
  let current = Number.POSITIVE_INFINITY;
  for (let i = n - 1; i >= 0; i -= 1) {
    const v = values[i];
    current = Math.min(current, typeof v === "number" ? v : Number.POSITIVE_INFINITY);
    out[i] = current;
  }
  return out;
}

function computeMonthEndFlags(startDate, totalDays) {
  const flags = new Array(totalDays).fill(false);
  for (let i = 0; i < totalDays; i += 1) {
    const date = addDays(startDate, i);
    if (i + 1 >= totalDays) {
      flags[i] = true;
      continue;
    }
    const next = addDays(startDate, i + 1);
    const yChanged = next.getUTCFullYear() !== date.getUTCFullYear();
    const mChanged = next.getUTCMonth() !== date.getUTCMonth();
    if (yChanged || mChanged) {
      flags[i] = true;
    }
  }
  return flags;
}

function bucketizeInvestment(simulation) {
  const { startDate, dailyNet } = simulation;
  const investment = simulation.investment;
  const buckets = new Map();
  const totalDays = Array.isArray(dailyNet) ? dailyNet.length : 0;
  const dailyInvestOutflow = investment?.dailyInvestOutflow || [];
  const dailyInvestBalance = investment?.dailyInvestBalance || [];

  for (let i = 0; i < totalDays; i += 1) {
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
    } else if (state.resolution === "Monthly") {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      key = `${year}-${month}`;
      label = key;
    } else {
      const year = date.getUTCFullYear();
      key = String(year);
      label = key;
    }

    if (!buckets.has(key)) {
      buckets.set(key, { label, investedAmount: 0, investmentValueEnd: 0 });
    }
    const bucket = buckets.get(key);
    const outflow = dailyInvestOutflow[i] || 0;
    bucket.investedAmount += Math.max(0, -outflow);
    bucket.investmentValueEnd = dailyInvestBalance[i] || 0;
  }

  const list = Array.from(buckets.values());
  return {
    labels: list.map((b) => b.label),
    investedAmount: list.map((b) => b.investedAmount),
    investmentValueEnd: list.map((b) => b.investmentValueEnd),
  };
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

function buildRuleRow(row, index) {
  const tr = document.createElement("tr");
  tr.dataset.rowIndex = String(index);
  tr.dataset.rowKind = "main";
  if (row.invalid) {
    tr.classList.add("invalid");
  }
  tr.innerHTML = `
    <td>
      <button type="button" class="dir-toggle" data-action="toggle-direction"></button>
    </td>
    <td><input type="number" inputmode="decimal" step="0.01" data-field="amount" /></td>
    <td><input type="text" placeholder="1.5." data-field="dateStr" /></td>
    <td><input type="number" inputmode="numeric" data-field="year" /></td>
    <td>
      <select data-field="frequency"></select>
    </td>
    <td>
      <select data-field="effective"></select>
    </td>
    <td>
      <div class="label-editor" data-role="label-editor">
        <input type="text" list="labelSuggestions" data-role="label-input" placeholder="Add label…" />
      </div>
    </td>
    <td>
      <button class="details-btn" type="button" data-action="toggle-details" aria-label="Toggle details">▾</button>
      <button class="delete-btn" type="button" data-action="delete" aria-label="Delete rule">✕</button>
    </td>
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

  const directionBtn = tr.querySelector('button[data-action="toggle-direction"]');
  directionBtn.textContent = row.direction === "out" ? "Out" : "In";
  directionBtn.classList.toggle("in", row.direction !== "out");
  directionBtn.classList.toggle("out", row.direction === "out");

  const amountInput = tr.querySelector('input[data-field="amount"]');
  amountInput.value = row.amount ?? "";
  const dateInput = tr.querySelector('input[data-field="dateStr"]');
  dateInput.value = row.dateStr ?? "";
  const yearInput = tr.querySelector('input[data-field="year"]');
  yearInput.value = row.year ?? "";
  const editor = tr.querySelector('[data-role="label-editor"]');
  renderLabelEditor(editor, row);

  return tr;
}

function buildRuleDetailsRow(row, index) {
  const tr = document.createElement("tr");
  tr.dataset.rowIndex = String(index);
  tr.dataset.rowKind = "details";
  tr.className = "rule-details" + (row.expanded ? " open" : "");
  tr.innerHTML = `
    <td colspan="8">
      <div class="details-grid">
        <label>
          End Date (optional)
          <input type="date" data-field="endDate" />
        </label>
        <label>
          Escalation (%)
          <input type="number" inputmode="decimal" step="0.01" data-field="escalationPct" placeholder="0" />
        </label>
        <label>
          Escalation interval
          <div class="details-inline">
            <input type="number" inputmode="numeric" min="1" step="1" data-field="escalationEvery" />
            <select data-field="escalationUnit">
              <option value="month">month</option>
              <option value="year">year</option>
            </select>
          </div>
        </label>
      </div>
    </td>
  `;
  const endDateInput = tr.querySelector('input[data-field="endDate"]');
  endDateInput.value = row.endDate ?? "";
  const escalationPctInput = tr.querySelector('input[data-field="escalationPct"]');
  if (escalationPctInput) {
    escalationPctInput.value = row.escalationPct ?? "";
  }
  const escalationEveryInput = tr.querySelector('input[data-field="escalationEvery"]');
  if (escalationEveryInput) {
    escalationEveryInput.value = row.escalationEvery ?? "1";
  }
  const escalationUnitSelect = tr.querySelector('select[data-field="escalationUnit"]');
  if (escalationUnitSelect) {
    escalationUnitSelect.value = row.escalationUnit === "year" ? "year" : "month";
  }
  return tr;
}

function normalizeLabel(label) {
  return String(label || "").trim();
}

function renderLabelEditor(editor, row) {
  if (!editor) {
    return;
  }
  const input = editor.querySelector('[data-role="label-input"]');
  editor.querySelectorAll('.label-chip').forEach((chip) => chip.remove());
  const labels = Array.isArray(row.labels) ? row.labels : [];
  labels.forEach((label) => {
    const chip = document.createElement('span');
    chip.className = 'label-chip';
    chip.dataset.label = label;
    chip.innerHTML = `<span>${label}</span><button type="button" aria-label="Remove label" data-action="remove-label">✕</button>`;
    editor.insertBefore(chip, input);
  });
}

function addLabelToRow(row, label) {
  const normalized = normalizeLabel(label);
  if (!normalized) {
    return false;
  }
  const labels = Array.isArray(row.labels) ? row.labels : [];
  const lower = normalized.toLowerCase();
  if (labels.some((l) => String(l).toLowerCase() === lower)) {
    row.labels = labels;
    return false;
  }
  row.labels = [...labels, normalized];
  renderLabelSuggestions();
  return true;
}

function removeLabelFromRow(row, label) {
  const labels = Array.isArray(row.labels) ? row.labels : [];
  const lower = String(label).toLowerCase();
  row.labels = labels.filter((l) => String(l).toLowerCase() !== lower);
  renderLabelSuggestions();
}

function renderRows() {
  elements.ruleRows.innerHTML = "";
  state.rows.forEach((row, index) => {
    elements.ruleRows.appendChild(buildRuleRow(row, index));
    elements.ruleRows.appendChild(buildRuleDetailsRow(row, index));
  });
}

function addEmptyRuleRowIfNeeded() {
  const before = state.rows.length;
  ensureEmptyRow();
  if (state.rows.length === before) {
    return;
  }
  const index = state.rows.length - 1;
  elements.ruleRows.appendChild(buildRuleRow(state.rows[index], index));
  elements.ruleRows.appendChild(buildRuleDetailsRow(state.rows[index], index));

  // A new row appeared because the previous one became non-empty.
  // Recompute now so the charts stay in sync with “adding a row”.
  scheduleCompute();
  scheduleSave();
}

function focusAmountRow(index) {
  const target = elements.ruleRows.querySelector(`tr[data-row-index="${index}"] input[data-field="amount"]`);
  if (target) {
    target.focus();
    target.select?.();
  }
}

function bindRuleTableEvents() {
  elements.ruleRows.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }
    const field = target.dataset.field;
    if (!field) {
      return;
    }
    const tr = target.closest("tr[data-row-index]");
    if (!tr) {
      return;
    }
    const index = Number(tr.dataset.rowIndex);
    const row = state.rows[index];
    if (!row) {
      return;
    }

    row[field] = target.value;
    addEmptyRuleRowIfNeeded();
  });

  elements.ruleRows.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    const field = target.dataset.field;
    if (!field) {
      return;
    }
    const tr = target.closest("tr[data-row-index]");
    if (!tr) {
      return;
    }
    const index = Number(tr.dataset.rowIndex);
    const row = state.rows[index];
    if (!row) {
      return;
    }
    row[field] = target.value;
    addEmptyRuleRowIfNeeded();
    scheduleCompute();
    scheduleSave();
  });

  elements.ruleRows.addEventListener("click", (event) => {
    const root = event.target instanceof Element ? event.target : null;
    if (!root) {
      return;
    }

    const deleteBtn = root.closest('[data-action="delete"]');
    if (deleteBtn) {
      const tr = deleteBtn.closest("tr[data-row-index]");
      if (!tr) {
        return;
      }
      const index = Number(tr.dataset.rowIndex);
      state.rows.splice(index, 1);
      ensureEmptyRow();
      scheduleCompute();
      scheduleSave();
      renderRows();
      updateRuleRowInvalidStyles();
      focusAmountRow(Math.min(index, state.rows.length - 1));
      return;
    }

    const detailsBtn = root.closest('[data-action="toggle-details"]');
    if (detailsBtn) {
      const tr = detailsBtn.closest("tr[data-row-index]");
      if (!tr) {
        return;
      }
      const index = Number(tr.dataset.rowIndex);
      const row = state.rows[index];
      if (!row) {
        return;
      }
      row.expanded = !row.expanded;
      const detailsTr = elements.ruleRows.querySelector(`tr[data-row-index="${index}"][data-row-kind="details"]`);
      if (detailsTr) {
        detailsTr.classList.toggle("open", row.expanded);
      }
      return;
    }

    const removeLabelBtn = root.closest('[data-action="remove-label"]');
    if (removeLabelBtn) {
      const hostTr = removeLabelBtn.closest('tr[data-row-index]');
      if (!hostTr) {
        return;
      }
      const index = Number(hostTr.dataset.rowIndex);
      const row = state.rows[index];
      if (!row) {
        return;
      }
      const chip = removeLabelBtn.closest('.label-chip');
      const label = chip?.dataset.label;
      if (!label) {
        return;
      }
      removeLabelFromRow(row, label);
      // Re-render the editor where the click happened, and the main row editor.
      const editor = hostTr.querySelector('[data-role="label-editor"]');
      renderLabelEditor(editor, row);
      const mainEditor = elements.ruleRows.querySelector(`tr[data-row-index="${index}"][data-row-kind="main"] [data-role="label-editor"]`);
      renderLabelEditor(mainEditor, row);
      addEmptyRuleRowIfNeeded();
      scheduleCompute();
      scheduleSave();
      return;
    }

    const dirBtn = root.closest('[data-action="toggle-direction"]');
    if (dirBtn) {
      const tr = dirBtn.closest("tr[data-row-index]");
      if (!tr) {
        return;
      }
      const index = Number(tr.dataset.rowIndex);
      const row = state.rows[index];
      if (!row) {
        return;
      }
      row.direction = row.direction === "out" ? "in" : "out";
      dirBtn.textContent = row.direction === "out" ? "Out" : "In";
      dirBtn.classList.toggle("in", row.direction !== "out");
      dirBtn.classList.toggle("out", row.direction === "out");
      addEmptyRuleRowIfNeeded();
      scheduleCompute();
      scheduleSave();
    }
  });

  elements.ruleRows.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    // Labels input: Enter or comma adds a chip.
    if (target.matches('[data-role="label-input"]')) {
      if (event.key !== "Enter" && event.key !== ",") {
        return;
      }
      event.preventDefault();
      const hostTr = target.closest('tr[data-row-index]');
      if (!hostTr) {
        return;
      }
      const index = Number(hostTr.dataset.rowIndex);
      const row = state.rows[index];
      if (!row) {
        return;
      }
      const changed = addLabelToRow(row, target.value);
      target.value = "";
      if (changed) {
        const editor = hostTr.querySelector('[data-role="label-editor"]');
        renderLabelEditor(editor, row);
        const mainEditor = elements.ruleRows.querySelector(`tr[data-row-index="${index}"][data-row-kind="main"] [data-role="label-editor"]`);
        renderLabelEditor(mainEditor, row);
        addEmptyRuleRowIfNeeded();
        scheduleCompute();
        scheduleSave();
      }
      return;
    }

    // Amount input: Enter jumps to next row amount.
    if (event.key !== "Enter") {
      return;
    }
    if (target.dataset.field !== "amount") {
      return;
    }
    const tr = target.closest("tr[data-row-index]");
    if (!tr) {
      return;
    }
    event.preventDefault();
    const index = Number(tr.dataset.rowIndex);
    focusAmountRow(index + 1);
  });

  // Compute/save only when the user finalizes a field (i.e. leaves it).
  elements.ruleRows.addEventListener("focusout", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }
    const tr = target.closest("tr[data-row-index]");
    if (!tr) {
      return;
    }
    const index = Number(tr.dataset.rowIndex);
    const row = state.rows[index];
    if (!row) {
      return;
    }

    if (target instanceof HTMLInputElement && target.matches('[data-role="label-input"]')) {
      const changed = addLabelToRow(row, target.value);
      target.value = "";
      if (changed) {
        const editor = tr.querySelector('[data-role="label-editor"]');
        renderLabelEditor(editor, row);
        const mainEditor = elements.ruleRows.querySelector(`tr[data-row-index="${index}"][data-row-kind="main"] [data-role="label-editor"]`);
        renderLabelEditor(mainEditor, row);
      }
      addEmptyRuleRowIfNeeded();
      scheduleCompute();
      scheduleSave();
      return;
    }

    const field = target.dataset.field;
    if (field) {
      row[field] = target.value;
    }

    if (target.dataset.field === "dateStr") {
      const parsed = parseDayMonth(row.dateStr);
      if (parsed && !row.year) {
        const startDate = parseStartDate();
        if (startDate) {
          row.year = String(inferYear(startDate, parsed.day, parsed.month));
          const yearInput = tr.querySelector('input[data-field="year"]');
          if (yearInput) {
            yearInput.value = row.year;
          }
        }
      }
    }

    addEmptyRuleRowIfNeeded();
    scheduleCompute();
    scheduleSave();
  });
}

function parseISODateUTC(input) {
  if (!input) {
    return null;
  }
  const parts = String(input).split("-").map(Number);
  if (parts.length !== 3) {
    return null;
  }
  const [year, month, day] = parts;
  if (!year || !month || !day) {
    return null;
  }
  return makeUTCDate(year, month, day);
}

function normalizeLabels(labels) {
  const arr = Array.isArray(labels) ? labels : [];
  const out = [];
  const seen = new Set();
  arr.forEach((label) => {
    const cleaned = normalizeLabel(label);
    if (!cleaned) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(cleaned);
  });
  return out;
}

function splitAmountMinor(amountMinor, parts) {
  const n = Math.max(1, Number(parts) || 1);
  if (n === 1) {
    return [amountMinor];
  }
  const base = Math.trunc(amountMinor / n);
  let remainder = amountMinor - base * n;
  const out = new Array(n).fill(base);
  const step = remainder > 0 ? 1 : -1;
  remainder = Math.abs(remainder);
  for (let i = 0; i < remainder; i += 1) {
    out[i] += step;
  }
  return out;
}

function hashHue(input) {
  const str = String(input);
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function colorForCategory(category) {
  const hue = hashHue(category);
  return {
    border: `hsl(${hue} 70% 55%)`,
    background: `hsl(${hue} 70% 55% / 0.45)`,
  };
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

function minorToDecimalString(minor, currency) {
  const decimals = CURRENCY_CONFIG[currency].decimals;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minor));
  const factor = 10 ** decimals;
  const whole = Math.trunc(abs / factor);
  const frac = abs % factor;
  if (decimals === 0) {
    return `${sign}${whole}`;
  }
  return `${sign}${whole}.${String(frac).padStart(decimals, "0")}`;
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

    let ruleEndExclusive = endDate;
    if (row.endDate) {
      const parsedEnd = parseISODateUTC(row.endDate);
      if (!parsedEnd) {
        row.invalid = true;
        return;
      }
      // End date is inclusive from the UI; convert to exclusive by adding 1 day.
      ruleEndExclusive = addDays(parsedEnd, 1);
      if (ruleEndExclusive.getTime() > endDate.getTime()) {
        ruleEndExclusive = endDate;
      }
    }

    const labels = normalizeLabels(row.labels);
    const categories = labels.length ? labels : ["Uncategorized"];

    const escalationPct = Number(row.escalationPct || 0);
    const escalationEvery = Math.max(1, Math.trunc(Number(row.escalationEvery || 1)));
    const escalationUnit = row.escalationUnit === "year" ? "year" : "month";
    const escalationEnabled =
      Number.isFinite(escalationPct) &&
      escalationPct !== 0 &&
      escalationPct > -100 &&
      Number.isFinite(escalationEvery) &&
      escalationEvery >= 1;

    rules.push({
      amountMinor,
      occurrence,
      day: parsed.day,
      month: parsed.month,
      frequency: row.frequency,
      effective: row.effective,
      categories,
      ruleEndExclusive,
      escalation: escalationEnabled
        ? {
            pct: escalationPct,
            every: escalationEvery,
            unit: escalationUnit,
          }
        : null,
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
  const finalEnd = rule.ruleEndExclusive && rule.ruleEndExclusive.getTime() < endDate.getTime() ? rule.ruleEndExclusive : endDate;
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

  while (current.getTime() < finalEnd.getTime()) {
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

function countEscalationSteps(rule, occDate) {
  const escalation = rule.escalation;
  if (!escalation) {
    return 0;
  }
  if (occDate.getTime() <= rule.occurrence.getTime()) {
    return 0;
  }
  const every = Math.max(1, Math.trunc(Number(escalation.every || 1)));
  const unit = escalation.unit === "year" ? "year" : "month";
  let steps = 0;
  let next =
    unit === "year"
      ? addYearsClamped(rule.occurrence, every, rule.day, rule.month)
      : addMonthsClamped(rule.occurrence, every, rule.day);
  while (next.getTime() <= occDate.getTime()) {
    steps += 1;
    next = unit === "year" ? addYearsClamped(next, every, rule.day, rule.month) : addMonthsClamped(next, every, rule.day);
    if (steps > 10000) {
      break;
    }
  }
  return steps;
}

function escalatedAmountMinor(rule, occDate) {
  const escalation = rule.escalation;
  if (!escalation) {
    return rule.amountMinor;
  }
  const steps = countEscalationSteps(rule, occDate);
  if (!steps) {
    return rule.amountMinor;
  }
  const factor = 1 + Number(escalation.pct || 0) / 100;
  if (!Number.isFinite(factor) || factor <= 0) {
    return rule.amountMinor;
  }
  return Math.round(rule.amountMinor * factor ** steps);
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
  const diffNetByCategory = new Map();

  function getCategoryDiff(category) {
    if (!diffNetByCategory.has(category)) {
      diffNetByCategory.set(category, new Array(totalDays + 1).fill(0));
    }
    return diffNetByCategory.get(category);
  }

  const rules = compileRules(startDate, endDate);
  rules.forEach((rule) => {
    const occurrences = generateOccurrences(rule, startDate, endDate);
    occurrences.forEach((occ) => {
      const amountMinor = escalatedAmountMinor(rule, occ);
      applyOccurrence(diffNet, occ, rule.effective, amountMinor, startDate, endDate);
      const parts = splitAmountMinor(amountMinor, rule.categories.length);
      rule.categories.forEach((category, i) => {
        const categoryDiff = getCategoryDiff(category);
        applyOccurrence(categoryDiff, occ, rule.effective, parts[i], startDate, endDate);
      });
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

  const dailyNetByCategory = new Map();
  diffNetByCategory.forEach((diff, category) => {
    const daily = new Array(totalDays).fill(0);
    let run = 0;
    for (let i = 0; i < totalDays; i += 1) {
      run += diff[i];
      daily[i] = run;
    }
    dailyNetByCategory.set(category, daily);
  });

  let investment = null;
  const investMinCashMinor = toMinor(state.investMinCash, state.currency);
  const investEnabled = Boolean(state.investEnabled) && investMinCashMinor > 0;
  if (investEnabled) {
    const monthEndFlags = computeMonthEndFlags(startDate, totalDays);
    const suffixMinBalance = buildSuffixMin(dailyBalance);

    const investAtIndex = new Array(totalDays).fill(0);
    const dailyInvestOutflow = new Array(totalDays).fill(0);
    let investedSoFar = 0;
    for (let i = 0; i < totalDays; i += 1) {
      if (!monthEndFlags[i]) {
        continue;
      }
      const minFutureAdjusted = (suffixMinBalance[i] || 0) - investedSoFar;
      const adjustedBalanceAtI = (dailyBalance[i] || 0) - investedSoFar;
      const maxInvestHere = Math.max(0, adjustedBalanceAtI - investMinCashMinor);
      const desired = Math.max(0, minFutureAdjusted - investMinCashMinor);
      const investAmount = Math.min(desired, maxInvestHere);
      if (!investAmount) {
        continue;
      }
      investAtIndex[i] = investAmount;
      dailyInvestOutflow[i] = -investAmount;
      investedSoFar += investAmount;
    }

    for (let i = 0; i < totalDays; i += 1) {
      dailyNet[i] += dailyInvestOutflow[i];
    }
    runningBalance = toMinor(state.startValue, state.currency);
    for (let i = 0; i < totalDays; i += 1) {
      runningBalance += dailyNet[i] || 0;
      dailyBalance[i] = runningBalance;
    }

    dailyNetByCategory.set("Investment", dailyInvestOutflow);

    let annualRate = Number(state.investAnnualRatePct || 0) / 100;
    if (!Number.isFinite(annualRate) || annualRate <= -1) {
      annualRate = 0;
    }
    const monthlyFactor = annualRate === 0 ? 1 : (1 + annualRate) ** (1 / 12);
    let investmentBalance = 0;
    const dailyInvestBalance = new Array(totalDays).fill(0);
    for (let i = 0; i < totalDays; i += 1) {
      if (monthEndFlags[i]) {
        if (monthlyFactor !== 1) {
          investmentBalance = Math.round(investmentBalance * monthlyFactor);
        }
        investmentBalance += investAtIndex[i] || 0;
      }
      dailyInvestBalance[i] = investmentBalance;
    }

    investment = {
      enabled: true,
      minCashMinor: investMinCashMinor,
      annualRatePct: Number(state.investAnnualRatePct || 0),
      dailyInvestOutflow,
      dailyInvestBalance,
    };
  }

  return { startDate, endDate, dailyNet, dailyBalance, dailyNetByCategory, investment };
}

function buildTransactionsFromSimulation(simulation) {
  if (!simulation) {
    return [];
  }
  const { startDate, dailyNet, dailyBalance } = simulation;
  const out = [];
  const totalDays = Array.isArray(dailyNet) ? dailyNet.length : 0;
  for (let i = 0; i < totalDays; i += 1) {
    const net = dailyNet[i] || 0;
    if (!net) {
      continue;
    }
    const date = formatISODate(addDays(startDate, i));
    out.push({
      date,
      inOut: net >= 0 ? "in" : "out",
      amountMinor: Math.abs(net),
      balanceMinor: dailyBalance[i] || 0,
    });
  }
  return out;
}

function renderTransactions(simulation) {
  if (!elements.transactionRows) {
    return;
  }
  lastTransactions = buildTransactionsFromSimulation(simulation);
  elements.transactionRows.innerHTML = "";
  lastTransactions.forEach((tx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${tx.date}</td>
      <td>${tx.inOut === "out" ? "Out" : "In"}</td>
      <td>${formatMoney(tx.amountMinor, state.currency)}</td>
      <td>${formatMoney(tx.balanceMinor, state.currency)}</td>
    `;
    elements.transactionRows.appendChild(tr);
  });
}

function exportTransactionsCsv() {
  const header = ["date", "in/out", "amount", "resulting_balance"].join(",");
  const lines = [header];
  lastTransactions.forEach((tx) => {
    const amount = minorToDecimalString(tx.amountMinor, state.currency);
    const balance = minorToDecimalString(tx.balanceMinor, state.currency);
    lines.push([tx.date, tx.inOut, amount, balance].join(","));
  });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  downloadTextFile(`cashflow-transactions-${ts}.csv`, lines.join("\n"), "text/csv");
}

function bucketizeFlowByCategory(simulation) {
  const { startDate, dailyNetByCategory, dailyNet } = simulation;
  const buckets = new Map();
  const derived = Array.from(dailyNetByCategory.keys()).sort((a, b) => a.localeCompare(b));
  const categories = derived.length ? derived : ["Net Flow"];

  function ensureBucket(key, label, dayIndexForInit) {
    if (!buckets.has(key)) {
      const flowByCategory = {};
      categories.forEach((category) => {
        flowByCategory[category] = 0;
      });
      buckets.set(key, { label, flowByCategory, dayIndexForInit });
    }
    return buckets.get(key);
  }

  const totalDays = Array.isArray(dailyNet) ? dailyNet.length : 0;
  for (let i = 0; i < totalDays; i += 1) {
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
    } else if (state.resolution === "Monthly") {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      key = `${year}-${month}`;
      label = key;
    } else {
      const year = date.getUTCFullYear();
      key = String(year);
      label = key;
    }
    const bucket = ensureBucket(key, label, i);
    categories.forEach((category) => {
      const series = dailyNetByCategory.get(category) || dailyNet;
      bucket.flowByCategory[category] += series[i] || 0;
    });
  }

  const bucketList = Array.from(buckets.values());
  const labels = bucketList.map((b) => b.label);
  const dataByCategory = {};
  categories.forEach((category) => {
    dataByCategory[category] = bucketList.map((b) => b.flowByCategory[category]);
  });
  return { labels, categories, dataByCategory };
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
    } else if (state.resolution === "Monthly") {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      key = `${year}-${month}`;
      label = key;
    } else {
      const year = date.getUTCFullYear();
      key = String(year);
      label = key;
    }
    if (!buckets.has(key)) {
      buckets.set(key, {
        label,
        flowSum: 0,
        cashIn: 0,
        cashOut: 0,
        minBalance: dailyBalance[i],
        maxBalance: dailyBalance[i],
        totalBalance: 0,
        days: 0,
        endBalance: dailyBalance[i],
      });
    }
    const bucket = buckets.get(key);
    const net = dailyNet[i] || 0;
    bucket.flowSum += net;
    if (net > 0) {
      bucket.cashIn += net;
    } else if (net < 0) {
      bucket.cashOut += -net;
    }
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
    updateMetricsStrip(null);
    if (elements.transactionRows) {
      elements.transactionRows.innerHTML = "";
    }
    lastTransactions = [];
    if (balanceChart) {
      balanceChart.destroy();
      balanceChart = null;
    }
    if (rateChart) {
      rateChart.destroy();
      rateChart = null;
    }
    if (flowChart) {
      flowChart.destroy();
      flowChart = null;
    }
    if (investmentChart) {
      investmentChart.destroy();
      investmentChart = null;
    }
    if (elements.investmentChartCard) {
      elements.investmentChartCard.hidden = true;
    }
    return;
  }
  updateMetricsStrip(simulation);
  const buckets = bucketize(simulation);
  const labels = buckets.map((b) => b.label);
  const balanceData = buckets.map((b) => b.endBalance);
  const flowBreakdown = bucketizeFlowByCategory(simulation);
  const netFlowPerBucketMinor = buckets.map((b) => b.flowSum);

  renderTable(buckets);
  renderWarnings(simulation);
  renderCharts(labels, balanceData, netFlowPerBucketMinor, flowBreakdown, buckets);
  renderTransactions(simulation);

  const investmentEnabled = Boolean(simulation.investment && simulation.investment.enabled);
  if (elements.investmentChartCard) {
    elements.investmentChartCard.hidden = !investmentEnabled;
  }
  if (!investmentEnabled) {
    if (investmentChart) {
      investmentChart.destroy();
      investmentChart = null;
    }
  } else {
    renderInvestmentChart(simulation);
  }

  updateRuleRowInvalidStyles();
}

function renderInvestmentChart(simulation) {
  const investmentCtx = document.getElementById("investmentChart");
  if (!investmentCtx) {
    return;
  }
  const currency = state.currency;
  const decimals = CURRENCY_CONFIG[currency].decimals;
  const breakdown = bucketizeInvestment(simulation);

  const valueDataMajor = breakdown.investmentValueEnd.map((v) => v / 10 ** decimals);
  const investedDataMajor = breakdown.investedAmount.map((v) => v / 10 ** decimals);

  const tooltip = {
    callbacks: {
      label: (context) => {
        const valueMajor =
          typeof context.parsed === "number"
            ? context.parsed
            : typeof context.parsed?.y === "number"
              ? context.parsed.y
              : typeof context.raw === "number"
                ? context.raw
                : 0;
        const minor = Math.round(valueMajor * 10 ** decimals);
        return `${context.dataset.label}: ${formatMoney(minor, currency)}`;
      },
    },
  };

  if (investmentChart) {
    investmentChart.data.labels = breakdown.labels;
    investmentChart.data.datasets[0].data = valueDataMajor;
    investmentChart.data.datasets[1].data = investedDataMajor;
    investmentChart.update();
    return;
  }

  investmentChart = new Chart(investmentCtx, {
    type: "bar",
    data: {
      labels: breakdown.labels,
      datasets: [
        {
          type: "line",
          label: "Cumulated invest (incl. interest)",
          data: valueDataMajor,
          borderColor: "#4c8dff",
          backgroundColor: "rgba(76, 141, 255, 0.2)",
          tension: 0.3,
          fill: false,
          yAxisID: "y",
        },
        {
          type: "bar",
          label: "Invested amount",
          data: investedDataMajor,
          backgroundColor: "rgba(76, 141, 255, 0.35)",
          borderColor: "#4c8dff",
          borderWidth: 1,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top" },
        tooltip,
      },
      scales: {
        y: {
          position: "left",
          ticks: {
            callback: (value) => formatMoney(Math.round(value * 10 ** decimals), currency),
          },
        },
        y1: {
          position: "right",
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            callback: (value) => formatMoney(Math.round(value * 10 ** decimals), currency),
          },
        },
      },
    },
  });
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

function renderCharts(labels, balanceData, netFlowPerBucketMinor, flowBreakdown, buckets) {
  const balanceCtx = document.getElementById("balanceChart");
  const rateCtx = document.getElementById("rateChart");
  const flowCtx = document.getElementById("flowChart");
  const currency = state.currency;
  const decimals = CURRENCY_CONFIG[currency].decimals;

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
            `Total value: ${formatMoney(bucket.endBalance, currency)}`,
            `Total cash in: ${formatMoney(bucket.cashIn || 0, currency)}`,
            `Total cash out: ${formatMoney(bucket.cashOut || 0, currency)}`,
          ];
        }

        if (context.chart.canvas.id === "rateChart") {
          return `Net cashflow: ${formatMoney(bucket.flowSum || 0, currency)}`;
        }

        const valueMajor =
          typeof context.parsed === "number"
            ? context.parsed
            : typeof context.parsed?.y === "number"
              ? context.parsed.y
              : typeof context.raw === "number"
                ? context.raw
                : 0;
        const minor = Math.round(valueMajor * 10 ** decimals);
        return `${context.dataset.label}: ${formatMoney(minor, currency)}`;
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
        maintainAspectRatio: false,
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

  if (rateChart) {
    rateChart.data.labels = labels;
    rateChart.data.datasets[0].data = netFlowPerBucketMinor.map((value) => value / 10 ** decimals);
    rateChart.update();
  } else {
    rateChart = new Chart(rateCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Net",
            data: netFlowPerBucketMinor.map((value) => value / 10 ** decimals),
            backgroundColor: "rgba(76, 141, 255, 0.35)",
            borderColor: "#4c8dff",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: commonTooltip,
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatMoney(Math.round(value * 10 ** decimals), currency),
            },
          },
        },
      },
    });
  }

  if (flowChart) {
    const desiredCategories = flowBreakdown.categories;
    const existingCategories = flowChart.data.datasets.map((d) => d.label);
    const same =
      existingCategories.length === desiredCategories.length &&
      existingCategories.every((c, i) => c === desiredCategories[i]);

    if (!same) {
      flowChart.destroy();
      flowChart = null;
    }
  }

  if (flowChart) {
    flowChart.data.labels = flowBreakdown.labels;
    flowChart.data.datasets.forEach((dataset) => {
      const category = dataset.label;
      dataset.data = (flowBreakdown.dataByCategory[category] || []).map(
        (value) => value / 10 ** CURRENCY_CONFIG[currency].decimals
      );
    });
    flowChart.update();
  } else {
    const datasets = flowBreakdown.categories.map((category) => {
      const colors = colorForCategory(category);
      return {
        label: category,
        data: (flowBreakdown.dataByCategory[category] || []).map(
          (value) => value / 10 ** CURRENCY_CONFIG[currency].decimals
        ),
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderWidth: 1,
        stack: "flow",
      };
    });
    flowChart = new Chart(flowCtx, {
      type: "bar",
      data: {
        labels: flowBreakdown.labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "top" },
          tooltip: commonTooltip,
        },
        scales: {
          x: {
            stacked: true,
          },
          y: {
            stacked: true,
            ticks: {
              callback: (value) => formatMoney(Math.round(value * 10 ** CURRENCY_CONFIG[currency].decimals), currency),
            },
          },
        },
      },
    });
  }
}

function valueForSort(row, key) {
  if (key === "amount") {
    const v = Number(row.amount || 0);
    return Number.isFinite(v) ? v : 0;
  }
  if (key === "year") {
    const v = Number(row.year || 0);
    return Number.isFinite(v) ? v : 0;
  }
  if (key === "direction") {
    return row.direction === "out" ? 1 : 0;
  }
  if (key === "frequency") {
    return String(row.frequency || "");
  }
  if (key === "effective") {
    return String(row.effective || "");
  }
  if (key === "labels") {
    const labels = Array.isArray(row.labels) ? row.labels : [];
    return labels.join(", ").toLowerCase();
  }
  if (key === "date") {
    const parsed = parseDayMonth(row.dateStr);
    const yearValue = Number(row.year || "");
    if (!parsed || !yearValue) {
      return Number.POSITIVE_INFINITY;
    }
    const date = makeUTCDate(yearValue, parsed.month, parsed.day);
    return date.getTime();
  }
  return "";
}

function sortRulesBy(key) {
  if (ruleSortKey === key) {
    ruleSortAsc = !ruleSortAsc;
  } else {
    ruleSortKey = key;
    ruleSortAsc = true;
  }

  const entries = (state.rows || []).filter((row) => !isRowEmpty(row));
  entries.sort((a, b) => {
    const av = valueForSort(a, key);
    const bv = valueForSort(b, key);
    if (typeof av === "number" && typeof bv === "number") {
      return ruleSortAsc ? av - bv : bv - av;
    }
    const as = String(av);
    const bs = String(bv);
    return ruleSortAsc ? as.localeCompare(bs) : bs.localeCompare(as);
  });

  state.rows = entries;
  ensureEmptyRow();
  renderRows();
  updateRuleRowInvalidStyles();
  renderLabelSuggestions();
  scheduleSave();
}

function bindRuleTableSorting() {
  const thead = elements.ruleRows?.closest("table")?.querySelector("thead");
  if (!thead) {
    return;
  }
  thead.addEventListener("click", (event) => {
    const th = event.target instanceof Element ? event.target.closest("th[data-sort]") : null;
    if (!th) {
      return;
    }
    const key = th.dataset.sort;
    if (!key) {
      return;
    }
    sortRulesBy(key);
  });
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
      normalizeLoadedStateInPlace();
      ensureEmptyRow();
      renderLabelSuggestions();
      return;
    }
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      Object.assign(state, parsed);
      normalizeLoadedStateInPlace();
      ensureEmptyRow();
      renderLabelSuggestions();
      return;
    } catch (error) {
      // ignore
    }
  }
  initializeState();
  renderLabelSuggestions();
}

async function importSnapshotFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const importedState = parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object" ? parsed.state : parsed;
  initializeState();
  Object.assign(state, importedState);
  normalizeLoadedStateInPlace();
  ensureEmptyRow();
  renderLabelSuggestions();
  window.location.hash = "";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}

function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportSnapshot() {
  const simulation = simulate();
  const buckets = simulation ? bucketize(simulation) : [];
  const flow = simulation ? bucketizeFlowByCategory(simulation) : { labels: [], categories: [], dataByCategory: {} };
  const payload = {
    exportedAt: new Date().toISOString(),
    state,
    outputs: {
      resolution: state.resolution,
      buckets,
      flow,
    },
  };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  downloadTextFile(`cashflow-export-${ts}.json`, JSON.stringify(payload, null, 2), "application/json");
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
  elements.timeframeYears.addEventListener("change", () => {
    state.timeframeYears = Number(elements.timeframeYears.value || 1);
    scheduleCompute();
    scheduleSave();
  });
  elements.startValue.addEventListener("change", () => {
    state.startValue = Number(elements.startValue.value || 0);
    scheduleCompute();
    scheduleSave();
  });
  elements.currency.addEventListener("change", () => {
    state.currency = elements.currency.value;
    scheduleCompute();
    scheduleSave();
  });

  if (elements.investEnabled) {
    elements.investEnabled.addEventListener("change", () => {
      state.investEnabled = Boolean(elements.investEnabled.checked);
      if (!state.investEnabled) {
        state.investMinCash = 0;
        if (elements.investMinCash) {
          elements.investMinCash.value = "0";
        }
      }
      scheduleCompute();
      scheduleSave();
    });
  }

  const updateInvestMinCash = () => {
    const value = Number(elements.investMinCash?.value || 0);
    state.investMinCash = value;
    if (value > 0) {
      state.investEnabled = true;
      if (elements.investEnabled) {
        elements.investEnabled.checked = true;
      }
    } else {
      state.investEnabled = false;
      if (elements.investEnabled) {
        elements.investEnabled.checked = false;
      }
    }
    scheduleCompute();
    scheduleSave();
  };

  if (elements.investMinCash) {
    elements.investMinCash.addEventListener("change", updateInvestMinCash);
    elements.investMinCash.addEventListener("input", updateInvestMinCash);
  }

  const updateInvestAnnualRate = () => {
    state.investAnnualRatePct = Number(elements.investAnnualRatePct?.value || 0);
    scheduleCompute();
    scheduleSave();
  };

  if (elements.investAnnualRatePct) {
    elements.investAnnualRatePct.addEventListener("change", updateInvestAnnualRate);
    elements.investAnnualRatePct.addEventListener("input", updateInvestAnnualRate);
  }
  if (elements.calculateBtn) {
    elements.calculateBtn.addEventListener("click", () => {
      const simulation = simulate();
      renderOutputs(simulation);
    });
  }
  elements.exportBtn.addEventListener("click", () => {
    exportSnapshot();
  });

  if (elements.importBtn && elements.importFile) {
    elements.importBtn.addEventListener("click", () => {
      elements.importFile.click();
    });
    elements.importFile.addEventListener("change", async () => {
      const file = elements.importFile.files && elements.importFile.files[0];
      elements.importFile.value = "";
      if (!file) {
        return;
      }
      try {
        await importSnapshotFromFile(file);
      } catch (error) {
        window.alert("Import failed: invalid JSON or unsupported file.");
      }
    });
  }

  if (elements.downloadCsvBtn) {
    elements.downloadCsvBtn.addEventListener("click", () => {
      exportTransactionsCsv();
    });
  }
  elements.shareBtn.addEventListener("click", async () => {
    const encoded = encodeState();
    window.location.hash = `s=${encoded}`;
    try {
      await navigator.clipboard.writeText(window.location.href);
      elements.shareBtn.textContent = "Link copied!";
      setTimeout(() => {
        elements.shareBtn.textContent = "Create link with parameters";
      }, 1500);
    } catch (error) {
      // ignore clipboard failures
    }
  });

  if (elements.jumpToChartBtn) {
    elements.jumpToChartBtn.addEventListener("click", () => {
      const target = document.getElementById("outputs") || document.getElementById("balanceChart");
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
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
  updateRuleRowInvalidStyles();
  renderLabelSuggestions();
  scheduleCompute();
}

loadState();
renderAll();
bindGlobalInputs();
bindRuleTableEvents();
bindRuleTableSorting();
