// script.js

// --- Global State Variables ---
let queryTerms = [];
let monthsBack = 3; // Default value for months filter
let selectedQuery = null;
let pageNum = 1;
let pageSize = 25;
let trialsData = {}; // Stores fetched data: { 'condition': [trial1, trial2, ...], ... }
let searchDone = false;

// Define the desired order of columns for the detailed trials table
const desiredColumnOrder = [
    "NCT ID",
    "Title",
    "Study First Post Date",
    "Last Update Post Date",
    "Acronym",
    "Overall Status",
    "Conditions",
    "Interventions",
    "Study Type",
    "Phases"
];

// --- DOM Elements ---
const queryInput = document.getElementById('queryInput');
const monthsSelect = document.getElementById('monthsSelect');
const searchButton = document.getElementById('searchButton');
const resetButton = document.getElementById('resetButton');
const loadingSpinner = document.getElementById('loadingSpinner');
const initialMessage = document.getElementById('initialMessage');
const resultsContainer = document.getElementById('resultsContainer');
const selectedQueryDisplay = document.getElementById('selectedQueryDisplay');
const foundTrialsMessage = document.getElementById('foundTrialsMessage');
const summaryTableBody = document.querySelector('#summaryTable tbody');
const trialsTableHeadRow = document.querySelector('#trialsTable thead tr'); // Select the header row
const trialsTableBody = document.querySelector('#trialsTable tbody');
const pageSizeInput = document.getElementById('pageSizeInput');
const pageNumberSelect = document.getElementById('pageNumberSelect');
const downloadCsvButton = document.getElementById('downloadCsvButton');
const messageBox = document.getElementById('messageBox');

// Removed: New DOM elements for replica design (hBarsButton, sidebarMenu, menuDropdownParents)


// --- Utility Functions ---

/**
 * Displays a custom message box.
 * @param {string} message - The message to display.
 * @param {'success'|'warning'|'error'|'info'} type - The type of message.
 */
function showMessageBox(message, type) {
    messageBox.textContent = message;
    // Safely apply type class for styling without overwriting other classes
    messageBox.classList.remove('success', 'warning', 'error', 'info'); // Remove previous type classes
    messageBox.classList.add(type); // Add the new type class
    messageBox.style.display = 'block';
    messageBox.style.opacity = '1';

    setTimeout(() => {
        messageBox.style.opacity = '0';
        setTimeout(() => {
            messageBox.style.display = 'none';
        }, 300); // Wait for fade out
    }, 5000); // Message visible for 5 seconds
}

/**
 * Shows the loading spinner and hides content.
 */
function showLoadingSpinner() {
    loadingSpinner.classList.remove('hidden');
    initialMessage.classList.add('hidden');
    resultsContainer.classList.add('hidden');
}

/**
 * Hides the loading spinner and shows content (or initial message).
 */
function hideLoadingSpinner() {
    loadingSpinner.classList.add('hidden');
    if (searchDone) {
        resultsContainer.classList.remove('hidden');
    } else {
        initialMessage.classList.remove('hidden');
    }
}

/**
 * Formats a date string to a more readable format (e.g.,YYYY-MM-DD).
 * @param {string} dateString - The date string (e.g., "2023-01-15").
 * @returns {string} Formatted date string or original if invalid.
 */
function formatDate(dateString) {
    try {
        // Ensure dateString is treated as UTC to avoid timezone issues affecting the date
        const date = new Date(dateString + 'T00:00:00Z'); // Append T00:00:00Z to treat as UTC
        if (isNaN(date.getTime())) {
            return dateString; // Return original if invalid date
        }
        return date.toISOString().split('T')[0]; //YYYY-MM-DD
    } catch (e) {
        return dateString;
    }
}

// --- API Fetching Logic (Frontend calls Backend) ---

/**
 * Fetches clinical trials data from the Python backend.
 * @param {Array<string>} terms - List of conditions to search for.
 * @param {number} monthsBackFilter - Number of months back to filter updates.
 * @returns {Promise<Object>} A promise that resolves to an object mapping conditions to their trial data.
 */
async function fetchAllTrialsFromBackend(terms, monthsBackFilter) {
    try {
        console.log(`Frontend: Sending monthsBackFilter: ${monthsBackFilter} to backend.`);

        // Use the Render deployment URL for your backend API
        const response = await fetch('https://doloxe-clinical-trail.onrender.com/api/search_trials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query_terms: terms,
                months_back: monthsBackFilter
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching data from backend:", error);
        showMessageBox(`Failed to fetch data: ${error.message}. Please try again.`, 'error');
        throw error; // Re-throw to be caught by handleSearch
    }
}

// --- Rendering Functions ---

/**
 * Renders the summary table based on the provided trial data.
 * @param {Array<Object>} data - The array of trial objects.
 */
function renderSummaryTable(data) {
    summaryTableBody.innerHTML = ''; // Clear previous content

    if (data.length === 0) {
        summaryTableBody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500" style="border: 1px solid #50d38a;">No data available for summary.</td></tr>';
        return;
    }

    const statusCounts = {};
    const typeCounts = {};
    const phaseCounts = {};

    data.forEach(trial => {
        statusCounts[trial["Overall Status"]] = (statusCounts[trial["Overall Status"]] || 0) + 1;
        typeCounts[trial["Study Type"]] = (typeCounts[trial["Study Type"]] || 0) + 1;
        // Phases can be comma-separated, so split and count each
        if (trial["Phases"]) { // Check if phases exist
             trial["Phases"].split(', ').forEach(phase => {
                const trimmedPhase = phase.trim();
                if (trimmedPhase) { // Ensure phase is not empty
                    phaseCounts[trimmedPhase] = (phaseCounts[trimmedPhase] || 0) + 1;
                }
            });
        }
    });

    const sortedStatuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const sortedPhases = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1]);

    const maxRows = Math.max(sortedStatuses.length, sortedTypes.length, sortedPhases.length);

    for (let i = 0; i < maxRows; i++) {
        const row = summaryTableBody.insertRow();
        row.className = 'bg-white';

        // Status
        const statusCell = row.insertCell();
        statusCell.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
        statusCell.style.border = '1px solid #50d38a'; // Apply border color
        statusCell.textContent = sortedStatuses[i] ? sortedStatuses[i][0] : '';

        const statusCountCell = row.insertCell();
        statusCountCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
        statusCountCell.style.border = '1px solid #50d38a'; // Apply border color
        statusCountCell.textContent = sortedStatuses[i] ? sortedStatuses[i][1] : '';

        // Type
        const typeCell = row.insertCell();
        typeCell.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
        typeCell.style.border = '1px solid #50d38a'; // Apply border color
        typeCell.textContent = sortedTypes[i] ? sortedTypes[i][0] : '';

        const typeCountCell = row.insertCell();
        typeCountCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
        typeCountCell.style.border = '1px solid #50d38a'; // Apply border color
        typeCountCell.textContent = sortedTypes[i] ? sortedTypes[i][1] : '';

        // Phase
        const phaseCell = row.insertCell();
        phaseCell.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
        phaseCell.style.border = '1px solid #50d38a'; // Apply border color
        phaseCell.textContent = sortedPhases[i] ? sortedPhases[i][0] : '';

        const phaseCountCell = row.insertCell();
        phaseCountCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
        phaseCountCell.style.border = '1px solid #50d38a'; // Apply border color
        phaseCountCell.textContent = sortedPhases[i] ? sortedPhases[i][1] : '';
    }
}

/**
 * Highlights studies posted within the last 90 days.
 * @param {Object} trial - The trial object.
 * @returns {string} CSS class for highlighting or empty string.
 */
function highlightRecentStudies(trial) {
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 90); // 90 days ago

    try {
        // Parse date as UTC to avoid local timezone issues for comparison
        const studyFirstPostDate = new Date(trial["Study First Post Date"] + 'T00:00:00Z');
        if (!isNaN(studyFirstPostDate.getTime()) && studyFirstPostDate >= recentCutoff) {
            return 'bg-yellow-100'; // Tailwind class for light yellow background
        }
    } catch (e) {
        console.warn("Error parsing date for highlighting:", trial["Study First Post Date"], e);
    }
    return '';
}

/**
 * Renders the detailed trials table with pagination.
 * @param {Array<Object>} data - The array of trial objects.
 * @param {number} currentPage - The current page number (1-indexed).
 * @param {number} itemsPerPage - Number of items to display per page.
 */
function renderTrialsTable(data, currentPage, itemsPerPage) {
    trialsTableBody.innerHTML = ''; // Clear previous content

    // Clear and re-render table headers based on desiredColumnOrder
    trialsTableHeadRow.innerHTML = '';
    // Add S.No. header first
    const sNoTh = document.createElement('th');
    sNoTh.className = 'px-6 py-3 text-left text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wider';
    sNoTh.style.border = '1px solid #50d38a'; // Apply border color
    sNoTh.textContent = 'S.No.';
    trialsTableHeadRow.appendChild(sNoTh);

    desiredColumnOrder.forEach(headerText => {
        const th = document.createElement('th');
        // Apply responsive font size to headers
        th.className = 'px-3 py-2 text-left text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wider';
        th.style.border = '1px solid #50d38a'; // Apply border color
        th.textContent = headerText;
        trialsTableHeadRow.appendChild(th);
    });


    if (data.length === 0) {
        // Use desiredColumnOrder.length + 1 for colspan (for S.No.)
        trialsTableBody.innerHTML = `<tr><td colspan="${desiredColumnOrder.length + 1}" class="px-3 py-2 text-center text-gray-500" style="border: 1px solid #50d38a;">No trials found for this condition and timeframe.</td></tr>`;
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach((trial, index) => {
        const row = trialsTableBody.insertRow();
        row.className = `bg-white ${highlightRecentStudies(trial)}`; // Apply highlighting

        // Add S.No. cell
        const sNoCell = row.insertCell();
        sNoCell.className = 'px-6 py-2 text-sm text-gray-900';
        sNoCell.style.border = '1px solid #50d38a'; // Apply border color
        sNoCell.textContent = startIndex + index + 1;

        // Create cells for each piece of data, in the desired order
        desiredColumnOrder.forEach(key => { // Iterate through the desired order
            const cell = row.insertCell();
            // Apply text-sm for medium text, and the custom truncation class, and reduced padding
            let cellClasses = 'px-3 py-2 text-sm text-gray-900 table-cell-truncate';
            if (key === "Title") {
                cellClasses += ' title-column'; // Apply specific class for title column
            }
            cell.className = cellClasses;
            cell.style.border = '1px solid #50d38a'; // Apply border color

            const value = trial[key] !== undefined ? trial[key] : 'N/A'; // Handle missing data gracefully

            if (key === "NCT ID") {
                // Make NCT ID a clickable link to ClinicalTrials.gov
                const link = document.createElement('a');
                link.href = `https://clinicaltrials.gov/study/${value}`;
                link.target = "_blank"; // Open in new tab
                link.textContent = value;
                link.className = "text-blue-600 hover:underline";
                cell.appendChild(link);
            } else if (key.includes("Date")) {
                // Dates will be truncated and show full on hover, and stay on one line
                cell.textContent = formatDate(value);
            } else {
                cell.textContent = value;
            }
            // Set the title attribute for full content on hover
            cell.title = value;
        });
    });
}

/**
 * Sets up the pagination dropdown for the detailed trials table.
 * @param {number} totalItems - Total number of items.
 * @param {number} itemsPerPage - Number of items per page.
 * @param {number} currentPage - The current active page.
 */
function setupPagination(totalItems, itemsPerPage, currentPage) {
    pageNumberSelect.innerHTML = ''; // Clear previous options
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (totalPages <= 1) {
        pageNumberSelect.disabled = true;
        return;
    } else {
        pageNumberSelect.disabled = false;
    }

    for (let i = 1; i <= totalPages; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Page ${i} of ${totalPages}`;
        if (i === currentPage) {
            option.selected = true;
        }
        pageNumberSelect.appendChild(option);
    }
}

// --- Event Handlers ---

/**
 * Handles the search button click event.
 */
async function handleSearch() {
    queryTerms = queryInput.value.split(',').map(term => term.trim()).filter(term => term !== '');
    monthsBack = parseInt(monthsSelect.value);

    if (queryTerms.length === 0) {
        showMessageBox("Please enter at least one condition to search.", 'warning');
        return;
    }

    showLoadingSpinner();
    searchDone = true;
    trialsData = {}; // Clear previous data

    try {
        // Call the Python backend to fetch data
        const results = await fetchAllTrialsFromBackend(queryTerms, monthsBack);
        trialsData = results;

        // Set initial selected query to the first one found
        const firstQuery = Object.keys(trialsData)[0];
        selectedQuery = firstQuery || null;

        renderSelectedQueryDropdown(); // Populate the dropdown with fetched queries
        if (selectedQuery) {
            // Trigger display for the first selected query
            displaySelectedQueryResults();
        } else {
            showMessageBox("No trials found for the entered conditions and timeframe. Try different keywords or extend the timeframe.", 'warning');
            resultsContainer.classList.add('hidden'); // Hide results if no data
            initialMessage.classList.remove('hidden'); // Show initial message
        }

    } catch (error) {
        // Error message already shown by fetchAllTrialsFromBackend
        resultsContainer.classList.add('hidden');
        initialMessage.classList.remove('hidden');
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Renders the dropdown for selecting a query to display results.
 */
function renderSelectedQueryDropdown() {
    selectedQueryDisplay.innerHTML = ''; // Clear previous options
    const queryOptions = Object.keys(trialsData);

    if (queryOptions.length === 0) {
        selectedQueryDisplay.disabled = true;
        return;
    } else {
        selectedQueryDisplay.disabled = false;
    }

    queryOptions.forEach(query => {
        const option = document.createElement('option');
        option.value = query;
        option.textContent = query;
        if (query === selectedQuery) {
            option.selected = true;
        }
        selectedQueryDisplay.appendChild(option);
    });
}

/**
 * Displays results for the currently selected query.
 */
function displaySelectedQueryResults() {
    const currentSelectedQuery = selectedQueryDisplay.value;
    selectedQuery = currentSelectedQuery; // Update global state
    const currentTrials = trialsData[currentSelectedQuery] || [];

    if (currentTrials.length > 0) {
        // Update foundTrialsMessage with actual count
        foundTrialsMessage.innerHTML = `Results for: <span class="font-bold text-blue-600">${currentSelectedQuery}</span> (updated in the last <span class="font-bold text-blue-600">${monthsBack} months</span>) - Found <span class="font-bold text-blue-600">${currentTrials.length}</span> trials`;
        foundTrialsMessage.classList.remove('hidden');
        showMessageBox(`Found ${currentTrials.length} trials for '${currentSelectedQuery}'.`, 'success');
        renderSummaryTable(currentTrials);
        pageNum = 1; // Reset page number when changing query
        renderTrialsTable(currentTrials, pageNum, pageSize);
        setupPagination(currentTrials.length, pageSize, pageNum);
        downloadCsvButton.disabled = false;
    } else {
        foundTrialsMessage.innerHTML = `No trials found for: <span class="font-bold text-blue-600">${currentSelectedQuery}</span> (updated in the last <span class="font-bold text-blue-600">${monthsBack} months</span>)`;
        showMessageBox(`No trials found for '${currentSelectedQuery}' within the last ${monthsBack} months.`, 'warning');
        summaryTableBody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500" style="border: 1px solid #50d38a;">No data available for summary.</td></tr>';
        trialsTableBody.innerHTML = `<tr><td colspan="${desiredColumnOrder.length + 1}" class="px-3 py-2 text-center text-gray-500" style="border: 1px solid #50d38a;">No trials found for this condition and timeframe.</td></tr>`;
        setupPagination(0, pageSize, 1);
        downloadCsvButton.disabled = true;
    }
}

/**
 * Handles the reset button click event.
 */
function handleReset() {
    queryInput.value = '';
    monthsSelect.value = '3'; // Reset to default 3 months
    queryTerms = [];
    monthsBack = 3;
    selectedQuery = null;
    pageNum = 1;
    pageSize = 25;
    trialsData = {};
    searchDone = false;

    // Reset UI
    hideLoadingSpinner();
    initialMessage.classList.remove('hidden');
    resultsContainer.classList.add('hidden');
    foundTrialsMessage.innerHTML = '';
    summaryTableBody.innerHTML = '';
    trialsTableBody.innerHTML = '';
    // Clear table headers too on reset
    trialsTableHeadRow.innerHTML = '';
    selectedQueryDisplay.innerHTML = '';
    selectedQueryDisplay.disabled = true;
    pageNumberSelect.innerHTML = '';
    pageNumberSelect.disabled = true;
    pageSizeInput.value = '25';
    downloadCsvButton.disabled = true;
    showMessageBox("Search parameters have been reset.", 'info');
}

/**
 * Handles the download CSV button click event.
 */
function handleDownloadCsv() {
    if (!selectedQuery || !trialsData[selectedQuery] || trialsData[selectedQuery].length === 0) {
        showMessageBox("No data to download for the selected condition.", 'warning');
        return;
    }

    const currentTrials = trialsData[selectedQuery];
    // Include "S.No." in the headers for CSV export
    const headers = ["S.No.", ...desiredColumnOrder];
    const csvRows = [];

    // Add headers
    csvRows.push(headers.map(header => `"${header}"`).join(','));

    // Add data rows with S.No.
    currentTrials.forEach((row, index) => {
        const values = [];
        values.push(`"${index + 1}"`); // Add S.No. as the first value
        desiredColumnOrder.forEach(header => {
            const value = row[header] !== undefined ? row[header] : 'N/A';
            const escaped = ('' + value).replace(/"/g, '""');
            values.push(`"${escaped}"`);
        });
        csvRows.push(values.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const filename = `clinical_trials_${selectedQuery.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;

    // Create a link element and trigger download
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showMessageBox("CSV file downloaded successfully!", 'success');
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event fired. Attempting to initialize months dropdown.");

    // ADDED: Initial fetch to the Render.com API endpoint
    fetch('https://doloxe-clinical-trail.onrender.com/api')
        .then(response => {
            if (!response.ok) {
                // It's good practice to check response.ok even for simple GET requests
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => console.log("Initial API check successful:", data))
        .catch(error => console.error("Error during initial API check:", error));


    // Populate months dropdown
    try {
        if (monthsSelect) {
            for (let i = 1; i <= 12; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `${i} month${i > 1 ? 's' : ''}`;
                monthsSelect.appendChild(option);
            }
            // Set default selected value
            monthsSelect.value = monthsBack.toString();
            console.log("Months dropdown populated successfully and defaulted to " + monthsBack + " months.");
        } else {
            console.error("Error: monthsSelect element not found in the DOM. Check HTML ID.");
            showMessageBox("Error: Months filter element not found. Please check console for errors.", 'error');
        }
    } catch (e) {
        console.error("Error populating months dropdown:", e);
        showMessageBox("Failed to initialize months filter. Please check console for errors.", 'error');
    }

    // Attach event listeners
    searchButton.addEventListener('click', handleSearch);
    resetButton.addEventListener('click', handleReset);
    selectedQueryDisplay.addEventListener('change', displaySelectedQueryResults);
    pageSizeInput.addEventListener('change', () => {
        pageSize = parseInt(pageSizeInput.value);
        pageNum = 1; // Reset to first page on page size change
        displaySelectedQueryResults();
    });
    pageNumberSelect.addEventListener('change', () => {
        pageNum = parseInt(pageNumberSelect.value);
        displaySelectedQueryResults();
    });
    downloadCsvButton.addEventListener('click', handleDownloadCsv);

    // Initial state
    hideLoadingSpinner(); // Ensure spinner is hidden initially
    resultsContainer.classList.add('hidden'); // Hide results container initially
    downloadCsvButton.disabled = true; // Disable download button initially
    selectedQueryDisplay.disabled = true; // Disable query display initially
    pageNumberSelect.disabled = true; // Disable pagination initially

    // Removed all sidebar-related JavaScript
});