# agent.md — Static Cashflow Simulator (100% client-side, GitHub Pages)

## Goal
Build a **static cashflow simulator** that runs **entirely in the browser** and can be hosted on **GitHub Pages** (no backend, no build step required).  
Look & feel / structure should mirror: https://finneratzki1337.github.io/static_lead_time_sla/  
- single-page
- top buttons like “Calculate” + “Share link …”
- clearly grouped inputs, outputs on the side/below
- instant visualization, good tooltips, clean tables

Important: **auto-recompute** whenever a row is created/edited (debounced), plus an optional “Calculate” button (triggers the same recompute).

---

## Core Features (Functional Requirements)

### 1) Global Inputs
1. **Start Date (optional)**
   - Default: **today** (local date)
   - Input: date picker or compact `DD.MM.YYYY`
2. **Timeframe**
   - Default: **1 year** into the future
   - Input: number (e.g. 1–30) + unit (Years), internally endDate = startDate + timeframeYears
3. **Start Value (account balance at start date)**
   - numeric, allow negatives
4. **Currency**
   - dropdown, default: **HKD**
   - at least: HKD, EUR, USD, GBP, JPY
   - currency controls **formatting** (symbol/code) and **decimals** (JPY 0, most others 2)

### 2) Line-Item Editor (the “editable list”)
A table/grid editor. Each row is a cashflow rule.

Columns (per row):
1. **Direction**: Cash In / Cash Out (switch)
2. **Amount**: number (user enters positive; sign comes from Direction)
3. **Date (day+month)**: compact, e.g. `1.5.` or `01.05.`
4. **Year**: separate field next to Date
   - Default: auto-set to the year of the **nearest upcoming** occurrence relative to startDate
   - user can override the year
5. **Frequency** (dropdown, default Monthly):
   - Monthly
   - One time
   - Quarterly
   - Yearly
6. **Effective** (dropdown, default Immediate):
   - Immediate
   - Spread 1 month
   - Spread quarter
   - Spread year
7. Optional nice-to-have:
   - **Label/Note** (for tooltips)
   - Duplicate / Delete icons

#### “Seamless input”
- Always keep **one empty row at the bottom**.
- As soon as the last row becomes “non-empty” (amount or date/year entered), auto-append a new empty row.
- Users can delete rows, but the editor must always retain one empty row at the end.

#### Validation (inline)
- Invalid date (e.g. 31.02.) → highlight row red + small hint, rule is **ignored** in calculations.
- Amount missing/0 → ignore.
- Date present but Year missing → auto-set Year (default logic).

### 3) Outputs
Outputs must be consistent with the selected resolution (Daily/Weekly/Monthly).

**Resolution switch** (segmented control):
- Daily
- Weekly
- Monthly (default)

Outputs:
1. **Chart 1: Cash Balance (End-of-Period Balance)**
   - line chart
   - tooltip per bucket shows:
     - period label (e.g. 2026-05)
     - **End Balance**
     - **Min Balance**, **Max Balance**, **Avg Balance** within the bucket
2. **Chart 2: Net Cashflow per Bucket**
   - bar chart
   - tooltip shows:
     - Net Flow
     - optional: In/Out split (nice-to-have)
3. **Table per Bucket**
   - Period
   - Min Cash
   - Max Cash
   - Avg Cash
   - End Cash (strongly recommended even if not explicitly requested)
4. **Warnings / badges** (nice-to-have)
   - Lowest cash point in the whole timeframe (date + value)
   - highlight negative balances

---

## Calculation Model (must be exact)

### Principle
Compute internally on **daily resolution** to handle “spread” accurately, then aggregate to weekly/monthly for display.

### Date / Timezone Rules
- Operate on “calendar days”, not times.
- Avoid DST issues: use **UTC-based date arithmetic** (Date.UTC + custom helpers).
- Display for users: `DD.MM.YYYY`.

### Spread Semantics (calendar-based!)
Spread defines a **time interval** starting at the occurrence date, ending at “same day in the next month/quarter/year” as an **exclusive end date**.

Example: start 10.03., spread 1 month:
- interval: **[10.03 … 10.04)**
- therefore it is spread through **09.04** inclusive. ✅

Quarter: [date … addMonths(date, 3))  
Year: [date … addYears(date, 1))

If the target month doesn’t have that day (e.g. 31.01 + 1 month):
- `addMonths` must **clamp to last day of month**
  - 31.01 + 1 month => 28.02 / 29.02
- the exclusive end is then that clamped date.

### Frequency Semantics
- One time: exactly one occurrence at (Date+Year).
- Monthly: every 1 month from the initial occurrence.
- Quarterly: every 3 months.
- Yearly: every 12 months.
Important: If the initial occurrence is before simulation start, **fast-forward** to the first occurrence >= startDate (repeated addMonths/addYears with clamping).

### Day-of-month Handling for Recurrence (explicit requirement)
If a day does not exist in a later month: use the **last day of that month**.

---

## Algorithm (performance + correctness)

### Aim: no rounding drift
Compute using **minor units** (integers), not floats:
- HKD/EUR/USD/GBP: 2 decimals => minorFactor = 100
- JPY: 0 decimals => minorFactor = 1

Spreads distribute remainders so totals match exactly.

### Timeline
- startDate (UTC day)
- endDate = startDate + timeframeYears
- N = number of days in [startDate, endDate)
- arrays length N

### Difference Arrays
Create:
- `diffNet[N+1]` (int)
Optional:
- `diffIn[N+1]`, `diffOut[N+1]`

Index `i` represents date `startDate + i days`.

### Applying an Occurrence
Let `A` = signed amount in minor units (Cash In positive, Cash Out negative).

#### Effective = Immediate
Apply only on the occurrence day:
- diffNet[iStart] += A
- diffNet[iStart + 1] -= A

#### Effective = Spread (Month/Quarter/Year)
1. spreadEnd = addMonths/addYears(occDate, k) (exclusive!)
2. clamp:
   - if spreadEnd > endDate: spreadEnd = endDate
3. iStart = dayIndex(occDate), iEnd = dayIndex(spreadEnd)
4. nDays = max(1, iEnd - iStart)
5. Exact distribution (integer math):
   - base = trunc(A / nDays) (JS: Math.trunc)
   - rem  = A - base*nDays
   - Apply base to whole interval:
     - diffNet[iStart] += base
     - diffNet[iEnd]   -= base
   - Distribute remainder (ensures exact total):
     - step  = rem > 0 ? +1 : -1
     - count = abs(rem)
     - for j in 0..count-1:
       - diffNet[iStart + j]     += step
       - diffNet[iStart + j + 1] -= step

### Build Series
1. dailyNet[i] = prefixSum(diffNet)
2. dailyBalance:
   - dailyBalance[0] = startValueMinor + dailyNet[0]
   - dailyBalance[i] = dailyBalance[i-1] + dailyNet[i]

(Optional: dailyIn/dailyOut similarly.)

### Aggregation (Buckets)
Depending on resolution:
- daily: each day
- weekly: ISO week (Mon–Sun), label `YYYY-Www`
- monthly: label `YYYY-MM`

For each bucket compute:
- flowSum     = sum(dailyNet in bucket)
- minBalance  = min(dailyBalance in bucket)
- maxBalance  = max(dailyBalance in bucket)
- avgBalance  = round(sum(dailyBalance)/daysInBucket)
- endBalance  = last dailyBalance in bucket

Charts:
- Chart 1 uses endBalance per bucket
- Chart 2 uses flowSum per bucket

---

## UI / Tech Stack

### No-build, CDN
- Vanilla JS, HTML, CSS
- Chart.js via CDN (pin version)
- Prefer no extra libs; implement date helpers yourself to avoid adapter/DST pitfalls.

### File Layout
- index.html
- styles.css
- app.js
- README.md

### Share Link / Persistence
- Button: “Share link with these Parameters”
- Encode state into URL hash:
  - `#s=<base64url(JSON)>`
- On load:
  - if hash exists: restore state from hash
  - else: restore state from localStorage (if present)
  - else: defaults
- Auto-save to localStorage (debounced)

State includes:
- startDate
- timeframeYears
- startValue
- currency
- resolution
- rows (date input + year + dropdowns)

---

## Edge Cases (must implement)

1) **Invalid dates**
- 31.02., 00.05., 32.01. => invalid, row highlighted, ignored.

2) **Occurrences outside timeframe**
- One time outside => ignore.
- Recurring => fast-forward to first >= startDate; stop when >= endDate.

3) **Spread beyond endDate**
- clamp spreadEnd to endDate; shorter nDays.

4) **Very small amounts in spread**
- integer remainder distribution prevents rounding drift.

5) **Many rows / long timeframes**
- 30 years ~ 11k days: should remain responsive.
- Debounce recompute; update/destroy charts properly to avoid leaks.

6) **Monthly recurrence starting on the 31st**
- next month clamps to last day; thereafter recurrence must remain stable.
  - Recommendation: preserve an “anchor day-of-month” (original desired day) and always clamp from that anchor.

7) **Year field + “nearest upcoming date”**
- When user enters `D.M.` without year:
  - compute next upcoming occurrence relative to startDate
  - auto-set Year field accordingly
- If user edits Year, dateISO must update deterministically.

8) **Negative start values**
- fully supported in charts and table.

---

## Implementation Steps (agent instructions)

1) HTML skeleton
- Header + buttons (Calculate, Share link, Reset)
- Global inputs: StartDate, Timeframe, StartValue, Currency
- Line-item table (grid)
- Output controls: resolution switch
- 2 canvases for charts
- table container

2) CSS
- dark theme, modern, responsive
- desktop: two columns, mobile: stacked
- compact inputs, readable row editor
- inline validation styles

3) JS state + persistence
- create default state
- load from hash / localStorage
- share button encodes hash
- auto-save to localStorage

4) Row editor
- render rows from state
- wire events:
  - onChange => update state
  - if last row becomes non-empty => append empty row
  - delete row
  - parse date input + auto year fill

5) Date helpers (UTC-safe)
Implement pure helpers:
- parseDayMonth(str) -> {day, month} or invalid
- makeUTCDate(y,m,d) -> Date
- daysInMonth(y,m)
- addMonthsClamped(date, n)
- addYearsClamped(date, n)
- dayIndex(date) relative to startDate
- format labels for buckets (daily/weekly/monthly)

6) Simulation engine
- compileRules(rows) -> validated rules
- generateOccurrences(rule, startDate, endDate)
- applyOccurrenceToDiff(diffNet, occDate, effective, amountMinor)
- prefix sums => dailyNet, dailyBalance
- bucketize(dailyNet, dailyBalance, resolution)

7) Render outputs
- build chart datasets
- render/update Chart.js instances
- render table (period/min/max/avg/end)
- render warnings (optional)

8) QA using Acceptance Tests

---

## Acceptance Tests (manual)

1) StartValue 0, One-time Cash In 100 on startDate:
- daily/weekly/monthly endBalance increases accordingly.

2) Spread Month (calendar):
- startDate 10.03.2026, Cash In 900, spread 1 month
- interval [10.03 .. 10.04)
- distributed across correct number of days, total +900.

3) Input `1.5.` on 29.12.2025 with startDate=29.12.2025:
- Year auto = 2026
- first occurrence = 01.05.2026.

4) Monthly on 31.01:
- February occurrence = last day (28/29)
- recurrence continues correctly with clamping rules.

5) Resolution switch:
- bucket counts & labels change correctly
- min/max/avg values are plausible.

6) Share link:
- full state restored (rows + outputs identical).

---

## Deliverables
- Fully working GitHub Pages site (index.html, styles.css, app.js)
- README with:
  - local run instructions (open index.html or `python -m http.server`)
  - GitHub Pages deployment steps
  - share link details
