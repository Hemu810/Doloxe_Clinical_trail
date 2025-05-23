from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
import json
from datetime import datetime, timedelta # Needed for date calculations for v2 API filters

app = Flask(__name__, static_folder="public", static_url_path="/public") # Corrected static_url_path
CORS(app) # Enable CORS for all routes

# Define the root directory of your project
# This helps Flask find index.html which is at the same level as app.py
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

# --- Utility Functions ---
def fetch_trials_from_clinicaltrials_gov(condition, months_back_filter):
    """
    Fetches clinical trials data for a single condition from ClinicalTrials.gov API (v2).
    Filters results by last update date based on months_back_filter.
    """
    # *** CORRECTED TO V2 API URL ***
    base_url = "https://clinicaltrials.gov/api/v2/studies"
    
    # Calculate the date cutoff for filtering by 'Last Update Post Date'
    # The API v2 uses ISO format for dates, so 'YYYY-MM-DD' is suitable.
    date_cutoff = (datetime.today() - timedelta(days=30 * months_back_filter)).strftime("%Y-%m-%d")

    # Parameters for the v2 API.
    # 'query.cond' for condition search.
    # 'pageSize' for number of results per page.
    # 'filter.lastUpdatePostDate.gte' for filtering by last update date (greater than or equal to).
    base_params = {
        "query.cond": condition,
        "pageSize": 100, # Max page size allowed by API for a single request
        "filter.lastUpdatePostDate.gte": date_cutoff # Filter by last update date
    }
    
    data_list = []
    nextPageToken = None
    page_count = 0
    max_pages = 5 # Limit the number of pages to fetch to prevent excessive requests

    while True:
        params = base_params.copy()
        if nextPageToken:
            params['pageToken'] = nextPageToken # Add pageToken for subsequent requests

        try:
            # Make the API request with a timeout
            response = requests.get(base_url, params=params, timeout=30)
            response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)
            data = response.json()

            studies = data.get("studies", []) # *** V2 RESPONSE: 'studies' key ***
            if not studies:
                break # No more studies to fetch or no results for the current page

            for study in studies:
                # *** EXTRACT DATA FROM V2 API RESPONSE STRUCTURE ***
                # The structure is nested under 'protocolSection' for most details
                protocol_section = study.get('protocolSection', {})
                identification_module = protocol_section.get('identificationModule', {})
                status_module = protocol_section.get('statusModule', {})
                conditions_module = protocol_section.get('conditionsModule', {})
                arms_interventions_module = protocol_section.get('armsInterventionsModule', {})
                design_module = protocol_section.get('designModule', {})

                # Extract individual fields, providing default 'N/A' if not found
                nctId = identification_module.get('nctId', 'N/A') # v2 uses camelCase
                title = identification_module.get('officialTitle', identification_module.get('briefTitle', 'No title provided'))
                acronym = identification_module.get('acronym', 'N/A')
                overallStatus = status_module.get('overallStatus', 'N/A') # Check v2 status path
                studyType = design_module.get('studyType', 'N/A')

                # Dates in v2 are often nested under a 'Struct' and have a 'date' key
                studyFirstPostDate = status_module.get('studyFirstPostDateStruct', {}).get('date', 'N/A')
                lastUpdatePostDate = status_module.get('lastUpdatePostDateStruct', {}).get('date', 'N/A')

                # Conditions are a list of strings
                conditions = ', '.join(conditions_module.get('conditions', ['No conditions listed']))

                # Interventions are a list of objects, extract 'name'
                interventions_list = arms_interventions_module.get('interventions', [])
                interventions = ', '.join([interv.get('name', 'No intervention name listed') for interv in interventions_list]) if interventions_list else "No interventions listed"
                
                # Phases are a list of strings
                phases = ', '.join(design_module.get('phases', ['Not Available']))

                data_list.append({
                    "NCT ID": nctId,
                    "Title": title,
                    "Study First Post Date": studyFirstPostDate,
                    "Last Update Post Date": lastUpdatePostDate,
                    "Acronym": acronym,
                    "Overall Status": overallStatus,
                    "Conditions": conditions,
                    "Interventions": interventions,
                    "Study Type": studyType,
                    "Phases": phases
                })

            nextPageToken = data.get('nextPageToken') # Get token for next page if available
            page_count += 1
            # Break if no more pages or if max_pages limit is reached
            if not nextPageToken or page_count >= max_pages:
                break

        except requests.exceptions.HTTPError as e:
            print(f"HTTP error for condition '{condition}': {e.response.status_code} - {e.response.text}")
            break # Exit loop on HTTP error
        except requests.exceptions.ConnectionError as e:
            print(f"Connection error for condition '{condition}': {e}")
            break # Exit loop on connection error
        except requests.exceptions.Timeout as e:
            print(f"Timeout error for condition '{condition}': {e}")
            break # Exit loop on timeout
        except requests.exceptions.RequestException as e:
            print(f"An unexpected request error occurred for condition '{condition}': {e}")
            break # Exit loop on general request error
        except json.JSONDecodeError as e:
            print(f"JSON decode error for condition '{condition}': {e}. Raw response: {response.text}")
            break # Exit loop on JSON parsing error
        except Exception as e:
            print(f"An unexpected error occurred processing data for condition '{condition}': {e}")
            break # Catch any other unexpected errors

    # Sort the collected data by 'Last Update Post Date' in descending order
    # Ensure all dates are valid before sorting to prevent errors.
    def get_sort_key(item):
        try:
            return datetime.strptime(item["Last Update Post Date"], "%Y-%m-%d")
        except ValueError:
            return datetime.min # Return a very old date for invalid dates to push them to the end

    data_list.sort(key=get_sort_key, reverse=True)
    return data_list


# --- Flask Routes ---

@app.route('/')
def index():
    """
    Serves the main HTML page (index.html) from the project root.
    PROJECT_ROOT is where app.py and index.html reside.
    """
    return send_from_directory(PROJECT_ROOT, 'index.html')

@app.route('/api')
def api_health_check():
    """Simple health check endpoint for the API."""
    return jsonify({"message": "API is running!", "status": "success"})


@app.route('/api/search_trials', methods=['POST'])
def search_trials():
    """
    Handles the search request for clinical trials.
    Expects a JSON payload with 'query_terms' (list of strings) and 'months_back' (int).
    """
    data = request.get_json()
    query_terms_raw = data.get('query_terms', '')
    months_back = data.get('months_back', 3) # Default to 3 months

    if not query_terms_raw:
        return jsonify({"error": "No query terms provided.", "status": "error"}), 400

    # Split terms by comma and clean up whitespace, remove empty strings
    query_terms = [term.strip() for term in query_terms_raw.split(',') if term.strip()]

    if not query_terms:
        return jsonify({"error": "Please enter valid condition(s) to search.", "status": "error"}), 400

    results = {}
    for term in query_terms:
        # Pass the condition and months_back to the fetching function
        results[term] = fetch_trials_from_clinicaltrials_gov(term, months_back)

    return jsonify(results)

if __name__ == '__main__':
    # When running locally, Flask will listen on 0.0.0.0 and port 5000 (default)
    # Render will provide the PORT environment variable.
    app.run(debug=True, host='0.0.0.0', port=os.environ.get('PORT', 5000))