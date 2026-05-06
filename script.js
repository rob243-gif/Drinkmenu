const SHEET_ID = "1hUgsjaFsKI5seZVYfSoHZ4o74QQC6c8cezx_dMZFMko"; // Your Google Sheet ID from the shared URL
const SHEET_NAME = ""; // Optional sheet name; leave blank to use the first tab

const searchInput = document.getElementById("searchInput");
const filterControls = document.getElementById("filterControls");
const clearButton = document.getElementById("clearButton");
const itemsGrid = document.getElementById("itemsGrid");
const message = document.getElementById("message");
const themeToggle = document.getElementById("themeToggle");
const detailsToggle = document.getElementById("detailsToggle");
const THEME_STORAGE_KEY = "drinkMenuTheme";

let rawData = [];
let visibleRows = [];
let filterState = {};
let filterColumns = [];
let detailsHidden = true;

const sheetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json${SHEET_NAME ? `&sheet=${encodeURIComponent(SHEET_NAME)}` : ""}`;
const proxySheetUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(sheetUrl)}`;

async function fetchSheetData() {
  showMessage("Loading data...");
  try {
    const text = await fetchSheetText(sheetUrl);
    parseSheetText(text);
  } catch (directError) {
    const localFile = window.location.protocol === "file:";
    if (localFile || directError.message === "Failed to fetch") {
      showMessage("Direct sheet fetch failed; retrying through a proxy. If that still fails, serve this page from a local web server and ensure the sheet is shared publicly.");
      try {
        const text = await fetchSheetText(proxySheetUrl);
        parseSheetText(text);
        return;
      } catch (proxyError) {
        reportFetchError(proxyError, localFile);
        return;
      }
    }
    reportFetchError(directError, localFile);
  }
}

async function fetchSheetText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Network error: ${response.status}`);
  }
  return await response.text();
}

function reportFetchError(error, localFile) {
  const guidance = localFile
    ? "This page is being opened locally from disk. Use a local server like 'python -m http.server' or 'npx http-server .' to avoid browser blocking."
    : "Check that the Google Sheet is shared publicly and that the sheet ID is correct.";
  showMessage(`Unable to load sheet: ${error.message}. ${guidance}`);
  console.error(error);
}

function parseSheetText(text) {
  const json = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
  const table = json.table;
  const columns = table.cols.map((col) => (col.label || col.id || "Column"));

  rawData = table.rows.map((row) => {
    const record = {};
    row.c.forEach((cell, index) => {
      const key = String(columns[index] || "").trim();
      record[key] = cell ? cell.v : "";
    });
    return record;
  });

  if (!rawData.length) {
    showMessage("The sheet is empty or the selected tab has no rows.");
    itemsGrid.innerHTML = "";
    return;
  }

  filterColumns = discoverFilterColumns(columns, rawData);
  filterState = {};
  renderFilters();
  applyFilters();
}

function discoverFilterColumns(columns, data) {
  const candidateColumns = [];
  const preferredNames = ["Category", "Type", "Style", "Tag", "Tags", "Group", "Region", "Flavor", "Brand"];

  for (const column of columns) {
    const values = data.map((row) => String(row[column] || "").trim()).filter(Boolean);
    const unique = [...new Set(values)];
    const numericCount = values.filter((value) => /^[-+]?\d+(\.\d+)?$/.test(value)).length;
    const isMostlyText = numericCount / Math.max(values.length, 1) < 0.6;

    if (unique.length > 1 && unique.length <= 30 && isMostlyText) {
      candidateColumns.push({ column, unique });
    }
  }

  candidateColumns.sort((a, b) => {
    const aRank = preferredNames.indexOf(a.column) === -1 ? preferredNames.length : preferredNames.indexOf(a.column);
    const bRank = preferredNames.indexOf(b.column) === -1 ? preferredNames.length : preferredNames.indexOf(b.column);
    return aRank - bRank;
  });

  return candidateColumns.slice(0, 3).map((candidate) => candidate.column);
}

function renderFilters() {
  filterControls.innerHTML = "";

  filterColumns.forEach((column) => {
    const selectWrap = document.createElement("div");
    selectWrap.className = "filter-group";

    const label = document.createElement("label");
    label.setAttribute("for", `filter-${column}`);
    label.textContent = column;
    selectWrap.appendChild(label);

    const select = document.createElement("select");
    select.id = `filter-${column}`;
    select.dataset.column = column;

    const values = getUniqueValues(column, rawData);
    select.innerHTML = `<option value="">All ${column}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    select.addEventListener("change", onFilterChange);

    selectWrap.appendChild(select);
    filterControls.appendChild(selectWrap);
  });
}

function getUniqueValues(column, data) {
  const values = data.map((row) => String(row[column] || "").trim()).filter(Boolean);
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function onFilterChange(event) {
  const column = event.target.dataset.column;
  const value = event.target.value;
  if (value) {
    filterState[column] = value;
  } else {
    delete filterState[column];
  }
  applyFilters();
}

function applyFilters() {
  const searchTerm = searchInput.value.trim().toLowerCase();

  visibleRows = rawData.filter((row) => {
    const matchesSearch = searchTerm
      ? Object.values(row).some((value) => String(value).toLowerCase().includes(searchTerm))
      : true;

    const matchesFilters = Object.entries(filterState).every(([column, value]) => {
      return String(row[column] || "").trim() === value;
    });

    return matchesSearch && matchesFilters;
  });

  const count = visibleRows.length;
  showMessage(count ? `Now serving ${count} brew${count === 1 ? "" : "s"}:` : "No items match the current filters.");
  renderCards(visibleRows);
}

function renderCards(data) {
  if (!data.length) {
    itemsGrid.innerHTML = "";
    return;
  }

  itemsGrid.innerHTML = data
    .map((item) => {
      const title = escapeHtml(item["Brew Name"] || item["Brew name"] || "Untitled");
      const subtitle = escapeHtml(item["Subtitle"] || "");
      const description = escapeHtml(item["Description and Tasting Notes"] || item["Description and tasting notes"] || item["Description"] || "");
      const abv = escapeHtml(formatAbv(item["ABV"] || item["Abv"] || ""));
      const brewDate = escapeHtml(item["Date Started"] || item["Brew Date"] || "");
      const dateBottled = escapeHtml(item["Date Bottled"] || item["Bottling Date"] || "");
      const ingredients = escapeHtml(
        item["Ingredients"] ||
        item["Starting Ingredients"] ||
        item["Ingredient"] ||
        item["Ingredient List"] ||
        item["Ingredients Used"] ||
        item["Ingredients and Adjuncts"] ||
        item["Ingredients / Adjuncts"] ||
        ""
      );
      const yeast = escapeHtml(
        item["Yeast"] ||
        item["Yeast used"] ||
        item["Yeast Used"] ||
        item["Yeast Type"] ||
        item["Yeasts"] ||
        ""
      );
      const showDetails = !detailsHidden;

      return `
        <article class="card">
          <div>
            <h2 class="card-title">${title}</h2>
            ${subtitle ? `<p class="card-subtitle">${subtitle}</p>` : ""}
          </div>
          ${description ? `<p class="card-description">${description}</p>` : ""}
          ${showDetails && (ingredients || yeast) ? `<div class="card-meta">
            ${ingredients ? `<p class="card-ingredients"><strong>Ingredients:</strong> ${ingredients}</p>` : ""}
            ${yeast ? `<p class="card-yeast"><strong>Yeast:</strong> ${yeast}</p>` : ""}
          </div>` : ""}
          ${abv || (showDetails && (brewDate || dateBottled)) ? `<div class="card-details">
            ${abv ? `<span><strong>ABV:</strong> ${abv}</span>` : ""}
            ${showDetails && brewDate ? `<span><strong>Brew Date:</strong> ${brewDate}</span>` : ""}
            ${showDetails && dateBottled ? `<span><strong>Bottling Date:</strong> ${dateBottled}</span>` : ""}
          </div>` : ""}
        </article>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAbv(value) {
  const text = String(value).trim();
  if (!text) return "";
  if (text.endsWith("%")) return text;
  const numeric = parseFloat(text);
  if (!Number.isNaN(numeric)) {
    const percentage = Math.round(numeric * 100 * 100) / 100;
    return `${percentage}%`;
  }
  return text;
}

function showMessage(text) {
  message.textContent = text;
}

function clearFilters() {
  searchInput.value = "";
  filterState = {};
  document.querySelectorAll("#filterControls select").forEach((select) => {
    select.value = "";
  });
  applyFilters();
}

searchInput.addEventListener("input", () => applyFilters());
clearButton.addEventListener("click", clearFilters);
themeToggle?.addEventListener("click", toggleTheme);
detailsToggle?.addEventListener("click", toggleDetails);

loadTheme();
updateDetailsToggle();
fetchSheetData();

function applyTheme(theme) {
  document.body.classList.toggle("theme-light", theme === "light");
  document.body.classList.toggle("theme-dark", theme === "dark");
  themeToggle.textContent = theme === "light" ? "🌙" : "☀️";
}

function loadTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const initialTheme = storedTheme === "light" ? "light" : "dark";
  applyTheme(initialTheme);
}

function toggleTheme() {
  const isLight = document.body.classList.contains("theme-light");
  const newTheme = isLight ? "dark" : "light";
  applyTheme(newTheme);
  localStorage.setItem(THEME_STORAGE_KEY, newTheme);
}

function updateDetailsToggle() {
  if (!detailsToggle) return;
  detailsToggle.setAttribute("aria-pressed", String(!detailsHidden));
  detailsToggle.title = detailsHidden ? "Show brew details" : "Hide brew details";
  detailsToggle.classList.toggle("active", !detailsHidden);
}

function toggleDetails() {
  detailsHidden = !detailsHidden;
  updateDetailsToggle();
  renderCards(visibleRows);
}
