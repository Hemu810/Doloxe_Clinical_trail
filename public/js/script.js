// public/js/script.js

// --- Global State Variables ---
let queryTerms = [];
let monthsBack = 3; // Default value for months filter
let selectedQuery = null; // The currently selected query term in the dropdown
let pageNum = 1; // Current page number for the detailed trials table
let pageSize = 25; // Number of items per page for the detailed trials table
let trialsData = {}; // Stores fetched data: { 'condition': [trial1, trial2, ...], ... }
let searchDone = false; // Flag to indicate if a search has been successfully performed

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

// ***************************************************************
// CRITICAL: Define the base URL for your Flask API deployed on Render.
// This must be the ROOT URL of your Render service, e.g.,
// "https://your-render-app-name.onrender.com"
// Make sure this matches the URL Render gives you for your backend service.
// ***************************************************************
const API_BASE_URL = "https://doloxe-clinical-trail.onrender.com"; // Your actual Render API URL

// --- DOM Elements ---
const queryInput = document.getElementById('queryInput');
const monthsSelect = document.getElementById('monthsSelect');
const searchButton = document.getElementById('searchButton');
const resetButton = document.getElementById('resetButton');
const loadingSpinner = document.getElementById('loadingSpinner');
const initialMessage = document.getElementById('initialMessage');
const resultsContainer = document.getElementById('resultsContainer');
const selectedQueryDisplay = document.getElementById('selectedQueryDisplay'); // The dropdown for selecting a query
const foundTrialsMessage = document.getElementById('foundTrialsMessage'); // Message showing current query results
const summaryTableBody = document.querySelector('#summaryTable tbody');
const trialsTableHeadRow = document.querySelector('#trialsTable thead tr'); // Table header row for detailed trials
const trialsTableBody = document.querySelector('#trialsTable tbody'); // Table body for detailed trials
const pageSizeInput = document.getElementById('pageSizeInput');
const pageNumberSelect = document.getElementById('pageNumberSelect'); // Pagination dropdown
const downloadCsvButton = document.getElementById('downloadCsvButton');
const messageBox = document.getElementById('messageBox'); // Custom message display area


// --- Utility Functions ---

/**
 * Displays a custom message box to the user.
 * @param {string} message - The message text.
 * @param {'success'|'warning'|'error'|'info'} type - Type of message for styling.
 */
function showMessageBox(message, type) {
    messageBox.textContent = message;
    messageBox.classList.remove('success', 'warning', 'error', 'info');
    messageBox.classList.add(type);
    messageBox.style.display = 'block';
    messageBox.style.opacity = '1';

    // Auto-hide the message after a delay
    setTimeout(() => {
        messageBox.style.opacity = '0';
        setTimeout(() => {
            messageBox.style.display = 'none';
        }, 300); // Wait for fade-out transition
    }, 5000); // Message visible for 5 seconds
}

/**
 * Shows the loading spinner and hides other main content areas.
 */
function showLoadingSpinner() {
    loadingSpinner.classList.remove('hidden');
    initialMessage.classList.add('hidden');
    resultsContainer.classList.add('hidden');
}

/**
 * Hides the loading spinner and reveals the appropriate content area.
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
 * Formats a date string (YYYY-MM-DD) for consistent display.
 * Ensures dates are treated as UTC to avoid local timezone shifts.
 * @param {string} dateString - The input date string.
 * @returns {string} Formatted date string or original if invalid.
 */
function formatDate(dateString) {
    try {
        if (!dateString) return 'N/A'; // Handle empty date strings
        // Append 'T00:00:00Z' to interpret the date string as UTC
        const date = new Date(dateString + 'T00:00:00Z');
        if (isNaN(date.getTime())) {
            return dateString; // Return original if date parsing fails
        }
        return date.toISOString().split('T')[0]; // Format to YYYY-MM-DD
    } catch (e) {
        console.warn("Error formatting date:", dateString, e);
        return dateString;
    }
}

/**
 * Populates the 'monthsSelect' dropdown with options.
 */
function populateMonthsSelect() {
    monthsSelect.innerHTML = ''; // Clear existing options
    const options = [
        { value: 1, text: 'Last 1 Month' },
        { value: 3, text: 'Last 3 Months' },
        { value: 6, text: 'Last 6 Months' },
        { value: 12, text: 'Last 12 Months' },
        { value: 24, text: 'Last 24 Months' } // Added option for 24 months
    ];
    options.forEach(option => {
        const optElement = document.createElement('option');
        optElement.value = option.value;
        optElement.textContent = option.text;
        if (option.value === monthsBack) { // Set default selection based on global `monthsBack`
            optElement.selected = true;
        }
        monthsSelect.appendChild(optElement);
    });
    console.log("Months dropdown populated and defaulted to " + monthsBack + " months.");
}


// --- API Fetching Logic (Frontend calls Backend) ---

/**
 * Fetches clinical trials data from the Python backend via the API.
 * @param {Array<string>} terms - List of conditions to search for.
 * @param {number} monthsBackFilter - Number of months back to filter updates.
 * @returns {Promise<Object>} A promise that resolves to an object mapping conditions to their trial data.
 */
async function fetchAllTrialsFromBackend(terms, monthsBackFilter) {
    try {
        console.log(`Frontend: Sending query_terms: [${terms.join(', ')}] and months_back: ${monthsBackFilter} to backend.`);

        // Use the API_BASE_URL variable for the root of your Render app,
        // then append the specific API endpoint.
        const response = await fetch(`${API_BASE_URL}/api/search_trials`, {
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
            // Attempt to parse error details from the response body
            let errorDetails = "Unknown error";
            try {
                const errorData = await response.json();
                errorDetails = errorData.error || JSON.stringify(errorData);
            } catch {
                errorDetails = await response.text();
            }
            throw new Error(`HTTP error! Status: ${response.status}. Details: ${errorDetails}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching data from backend:", error);
        showMessageBox(`Failed to fetch data: ${error.message}. Please try again.`, 'error');
        throw error; // Re-throw to be caught by handleSearch for further handling
    }
}


// --- Rendering Functions ---

/**
 * Renders the summary table (Status, Type, Phase counts) based on the provided trial data.
 * @param {Array<Object>} data - The array of trial objects for the current query.
 */
function renderSummaryTable(data) {
    summaryTableBody.innerHTML = ''; // Clear previous content

    if (data.length === 0) {
        summaryTableBody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500" style="border: 1px solid #50d38a;">No data available for summary.</td></tr>';
        return;
    }

    // Initialize counts for different categories
    const statusCounts = {};
    const typeCounts = {};
    const phaseCounts = {};

    data.forEach(trial => {
        statusCounts[trial["Overall Status"]] = (statusCounts[trial["Overall Status"]] || 0) + 1;
        typeCounts[trial["Study Type"]] = (typeCounts[trial["Study Type"]] || 0) + 1;
        // Handle comma-separated phases
        if (trial["Phases"]) {
            trial["Phases"].split(', ').forEach(phase => {
                const trimmedPhase = phase.trim();
                if (trimmedPhase) {
                    phaseCounts[trimmedPhase] = (phaseCounts[trimmedPhase] || 0) + 1;
                }
            });
        }
    });

    // Sort counts in descending order
    const sortedStatuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const sortedPhases = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1]);

    // Determine the maximum number of rows needed for the summary table
    const maxRows = Math.max(sortedStatuses.length, sortedTypes.length, sortedPhases.length);

    // Populate the summary table row by row
    for (let i = 0; i < maxRows; i++) {
        const row = summaryTableBody.insertRow();
        row.className = 'bg-white';

        // Overall Status cells
        const statusCell = row.insertCell();
        statusCell.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
        statusCell.style.border = '1px solid #50d38a';
        statusCell.textContent = sortedStatuses[i] ? sortedStatuses[i][0] : '';

        const statusCountCell = row.insertCell();
        statusCountCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
        statusCountCell.style.border = '1px solid #50d38a';
        statusCountCell.textContent = sortedStatuses[i] ? sortedStatuses[i][1] : '';

        // Study Type cells
        const typeCell = row.insertCell();
        typeCell.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
        typeCell.style.border = '1px solid #50d38a';
        typeCell.textContent = sortedTypes[i] ? sortedTypes[i][0] : '';

        const typeCountCell = row.insertCell();
        typeCountCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
        typeCountCell.style.border = '1px solid #50d38a';
        typeCountCell.textContent = sortedTypes[i] ? sortedTypes[i][1] : '';

        // Phases cells
        const phaseCell = row.insertCell();
        phaseCell.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
        phaseCell.style.border = '1px solid #50d38a';
        phaseCell.textContent = sortedPhases[i] ? sortedPhases[i][0] : '';

        const phaseCountCell = row.insertCell();
        phaseCountCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
        phaseCountCell.style.border = '1px solid #50d38a';
        phaseCountCell.textContent = sortedPhases[i] ? sortedPhases[i][1] : '';
    }
}

/**
 * Determines if a study should be highlighted (e.g., posted within the last 90 days).
 * @param {Object} trial - The trial object.
 * @returns {string} CSS class for highlighting, or empty string if no highlight.
 */
function highlightRecentStudies(trial) {
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 90); // Calculate 90 days ago

    try {
        // Parse date as UTC to avoid local timezone issues impacting comparison
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
 * Renders the detailed trials table with pagination based on current page and page size.
 * @param {Array<Object>} data - The array of trial objects for the current query.
 * @param {number} currentPage - The current page number (1-indexed).
 * @param {number} itemsPerPage - Number of items to display per page.
 */
function renderTrialsTable(data, currentPage, itemsPerPage) {
    trialsTableBody.innerHTML = ''; // Clear previous table rows

    // Clear and re-render table headers to ensure correct order and S.No.
    trialsTableHeadRow.innerHTML = '';
    // Add S.No. header first
    const sNoTh = document.createElement('th');
    sNoTh.className = 'px-6 py-3 text-left text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wider';
    sNoTh.style.border = '1px solid #50d38a';
    sNoTh.textContent = 'S.No.';
    trialsTableHeadRow.appendChild(sNoTh);

    // Add headers for each desired column
    desiredColumnOrder.forEach(headerText => {
        const th = document.createElement('th');
        th.className = 'px-3 py-2 text-left text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wider';
        th.style.border = '1px solid #50d38a';
        th.textContent = headerText;
        trialsTableHeadRow.appendChild(th);
    });

    if (data.length === 0) {
        // Display a message if no trials are found
        trialsTableBody.innerHTML = `<tr><td colspan="${desiredColumnOrder.length + 1}" class="px-3 py-2 text-center text-gray-500" style="border: 1px solid #50d38a;">No trials found for this condition and timeframe.</td></tr>`;
        return;
    }

    // Calculate start and end indices for current page
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedData = data.slice(startIndex, endIndex); // Get trials for the current page

    // Populate the table body with paginated data
    paginatedData.forEach((trial, index) => {
        const row = trialsTableBody.insertRow();
        row.className = `bg-white ${highlightRecentStudies(trial)}`; // Apply highlighting class

        // Add S.No. cell
        const sNoCell = row.insertCell();
        sNoCell.className = 'px-6 py-2 text-sm text-gray-900';
        sNoCell.style.border = '1px solid #50d38a';
        sNoCell.textContent = startIndex + index + 1; // S.No. based on overall list

        // Create cells for each data point in the desired order
        desiredColumnOrder.forEach(key => {
            const cell = row.insertCell();
            let cellClasses = 'px-3 py-2 text-sm text-gray-900 table-cell-truncate';
            if (key === "Title") {
                cellClasses += ' title-column'; // Specific class for title column for extra styling
            }
            cell.className = cellClasses;
            cell.style.border = '1px solid #50d38a';

            const value = trial[key] !== undefined ? trial[key] : 'N/A'; // Handle missing data

            if (key === "NCT ID") {
                // Make NCT ID a clickable link to ClinicalTrials.gov
                const link = document.createElement('a');
                link.href = `https://clinicaltrials.gov/study/${value}`;
                link.target = "_blank"; // Open in a new tab
                link.textContent = value;
                link.className = "text-blue-600 hover:underline";
                cell.appendChild(link);
            } else if (key.includes("Date")) {
                // Format dates and ensure truncation
                cell.textContent = formatDate(value);
            } else {
                cell.textContent = value;
            }
            // Add `title` attribute for full content on hover (useful for truncated text)
            cell.title = String(value); // Ensure value is a string for title attribute
        });
    });
}

/**
 * Sets up the pagination dropdown based on total items and items per page.
 * @param {number} totalItems - Total number of items available for the current query.
 * @param {number} itemsPerPage - Number of items to display on each page.
 * @param {number} currentPage - The currently active page number.
 */
function setupPagination(totalItems, itemsPerPage, currentPage) {
    pageNumberSelect.innerHTML = ''; // Clear previous options
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // Disable pagination if only one or no pages are needed
    if (totalPages <= 1) {
        pageNumberSelect.disabled = true;
        pageNumberSelect.style.display = 'none'; // Hide if disabled
        return;
    } else {
        pageNumberSelect.disabled = false;
        pageNumberSelect.style.display = 'block'; // Show if enabled
    }

    // Populate page number options
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
 * Handles the search button click event: processes input, fetches data, and displays results.
 */
async function handleSearch() {
    // Extract and clean query terms from input
    queryTerms = queryInput.value.split(',').map(term => term.trim()).filter(term => term !== '');
    monthsBack = parseInt(monthsSelect.value); // Get selected months back as integer

    if (queryTerms.length === 0) {
        showMessageBox("Please enter at least one condition to search.", 'warning');
        return;
    }

    showLoadingSpinner();
    searchDone = true; // Indicate that a search operation is underway
    trialsData = {}; // Clear previous search results

    try {
        const results = await fetchAllTrialsFromBackend(queryTerms, monthsBack);
        trialsData = results; // Store results from the backend

        // Determine the first query term that has actual results to display by default
        const firstQueryWithResults = Object.keys(trialsData).find(term => trialsData[term] && trialsData[term].length > 0);
        selectedQuery = firstQueryWithResults || null; // Set the default selected query

        renderSelectedQueryDropdown(); // Populate the dropdown with all terms searched

        if (selectedQuery) {
            // Display results for the initial selected query
            displaySelectedQueryResults();
        } else {
            // If no results for any query term
            showMessageBox("No trials found for the entered conditions and timeframe. Try different keywords or extend the timeframe.", 'warning');
            resultsContainer.classList.add('hidden'); // Hide results area
            initialMessage.classList.remove('hidden'); // Show initial guidance
        }

    } catch (error) {
        // Error message already displayed by `WorkspaceAllTrialsFromBackend`
        resultsContainer.classList.add('hidden');
        initialMessage.classList.remove('hidden');
    } finally {
        hideLoadingSpinner(); // Always hide spinner
    }
}

/**
 * Renders and updates the dropdown list of query terms for which results were found.
 */
function renderSelectedQueryDropdown() {
    selectedQueryDisplay.innerHTML = ''; // Clear previous options
    const queryOptions = Object.keys(trialsData); // Get all query terms from the fetched data

    if (queryOptions.length === 0) {
        selectedQueryDisplay.disabled = true;
        selectedQueryDisplay.style.display = 'none'; // Hide if no options
        return;
    } else {
        selectedQueryDisplay.disabled = false;
        selectedQueryDisplay.style.display = 'block'; // Show if options exist
    }

    queryOptions.forEach(query => {
        const option = document.createElement('option');
        option.value = query;
        const count = trialsData[query] ? trialsData[query].length : 0;
        option.textContent = `${query} (${count} results)`; // Show term and result count
        if (query === selectedQuery) {
            option.selected = true; // Mark as selected if it's the current query
        }
        selectedQueryDisplay.appendChild(option);
    });
}

/**
 * Displays the trials data for the currently selected query term, updating summary and detailed tables.
 */
function displaySelectedQueryResults() {
    const currentSelectedQuery = selectedQueryDisplay.value;
    selectedQuery = currentSelectedQuery; // Update the global state with the user's selection
    const currentTrials = trialsData[currentSelectedQuery] || []; // Get the trials array for the selected query

    if (currentTrials.length > 0) {
        // Update the message displaying query details and total results
        foundTrialsMessage.innerHTML = `Results for: <span class="font-bold text-blue-600">${currentSelectedQuery}</span> (updated in the last <span class="font-bold text-blue-600">${monthsBack} months</span>) - Found <span class="font-bold text-blue-600">${currentTrials.length}</span> trials`;
        foundTrialsMessage.classList.remove('hidden');
        showMessageBox(`Displaying ${currentTrials.length} trials for '${currentSelectedQuery}'.`, 'success');

        renderSummaryTable(currentTrials); // Render the summary statistics
        pageNum = 1; // Reset to the first page when a new query is selected
        renderTrialsTable(currentTrials, pageNum, pageSize); // Render the detailed table for the first page
        setupPagination(currentTrials.length, pageSize, pageNum); // Set up pagination controls

        downloadCsvButton.disabled = false; // Enable CSV download
    } else {
        // Case where no trials are found for the selected query (though it should be filtered out by `renderSelectedQueryDropdown`)
        foundTrialsMessage.innerHTML = `No trials found for: <span class="font-bold text-blue-600">${currentSelectedQuery}</span> (updated in the last <span class="font-bold text-blue-600">${monthsBack} months</span>)`;
        showMessageBox(`No trials found for '${currentSelectedQuery}' within the last ${monthsBack} months.`, 'warning');

        // Clear tables and disable controls
        summaryTableBody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500" style="border: 1px solid #50d38a;">No data available for summary.</td></tr>';
        trialsTableBody.innerHTML = `<tr><td colspan="${desiredColumnOrder.length + 1}" class="px-3 py-2 text-center text-gray-500" style="border: 1px solid #50d38a;">No trials found for this condition and timeframe.</td></tr>`;
        setupPagination(0, pageSize, 1);
        downloadCsvButton.disabled = true;
    }
}

/**
 * Resets the application state and UI to its initial, pre-search state.
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
    searchDone = false; // Reset search status

    // Reset UI elements
    hideLoadingSpinner(); // Hides spinner and shows initial message
    initialMessage.classList.remove('hidden'); // Ensure initial message is visible
    resultsContainer.classList.add('hidden'); // Hide results area

    foundTrialsMessage.innerHTML = ''; // Clear message
    summaryTableBody.innerHTML = ''; // Clear summary table
    trialsTableBody.innerHTML = ''; // Clear detailed table
    trialsTableHeadRow.innerHTML = ''; // Clear detailed table headers
    selectedQueryDisplay.innerHTML = ''; // Clear query dropdown
    selectedQueryDisplay.disabled = true; // Disable query dropdown
    pageNumberSelect.innerHTML = ''; // Clear pagination dropdown
    pageNumberSelect.disabled = true; // Disable pagination dropdown
    pageSizeInput.value = '25'; // Reset page size input
    downloadCsvButton.disabled = true; // Disable download button
    showMessageBox("Search parameters have been reset.", 'info'); // Inform user
}

/**
 * Handles the download CSV button click event: generates and triggers a CSV file download.
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

    // Add headers as the first row in the CSV
    csvRows.push(headers.map(header => `"${header}"`).join(','));

    // Add data rows with S.No.
    currentTrials.forEach((row, index) => {
        const values = [];
        values.push(`"${index + 1}"`); // Add S.No. as the first value
        desiredColumnOrder.forEach(header => {
            const value = row[header] !== undefined ? row[header] : 'N/A';
            // Escape double quotes by replacing them with two double quotes
            const escaped = ('' + value).replace(/"/g, '""');
            // Enclose value in double quotes if it contains a comma, newline, or a double quote
            // This is crucial for proper CSV parsing of text fields
            values.push(`"${escaped}"`);
        });
        csvRows.push(values.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    // Generate a unique filename for the CSV, sanitizing the query term
    const filename = `clinical_trials_${selectedQuery.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;

    // Create a temporary link element to trigger the download
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link); // Must append to body for Firefox compatibility
    link.click(); // Programmatically click the link to trigger download
    document.body.removeChild(link); // Clean up the temporary link element

    showMessageBox("CSV file downloaded successfully!", 'success');
}


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event fired. Initializing application.");

    // Initial check to confirm connectivity to the Render.com API endpoint.
    // This fetches from the simple '/api' endpoint defined in your Flask app.
    fetch(`${API_BASE_URL}/api`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`API health check failed! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => console.log("Initial API health check successful:", data))
        .catch(error => {
            console.error("Error during initial API health check:", error);
            showMessageBox(`Failed to connect to API: ${error.message}. Please check console.`, 'error');
        });

    // Populate the months filter dropdown
    if (monthsSelect) {
        populateMonthsSelect(); // Use the dedicated function
    } else {
        console.error("Error: 'monthsSelect' element not found. Check HTML ID.");
        showMessageBox("Initialization error: Months filter not found.", 'error');
    }

    // Attach event listeners to UI controls
    searchButton.addEventListener('click', handleSearch);
    resetButton.addEventListener('click', handleReset);
    selectedQueryDisplay.addEventListener('change', displaySelectedQueryResults); // When user selects a different query
    
    // When page size changes, reset to page 1 and re-render
    pageSizeInput.addEventListener('change', () => {
        pageSize = parseInt(pageSizeInput.value);
        pageNum = 1;
        displaySelectedQueryResults(); // Re-render with new page size
    });

    // When page number changes, update and re-render
    pageNumberSelect.addEventListener('change', () => {
        pageNum = parseInt(pageNumberSelect.value);
        displaySelectedQueryResults(); // Re-render with new page number
    });
    
    downloadCsvButton.addEventListener('click', handleDownloadCsv);

    // Set initial UI state
    hideLoadingSpinner(); // Ensure spinner is hidden initially
    resultsContainer.classList.add('hidden'); // Hide results container initially
    downloadCsvButton.disabled = true; // Disable download button initially
    selectedQueryDisplay.disabled = true; // Disable query selection dropdown initially
    pageNumberSelect.disabled = true; // Disable pagination dropdown initially
    
    // Make sure initial message is shown on load
    initialMessage.classList.remove('hidden');
});