# app.py
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
import json
from datetime import datetime, timedelta

# Initialize Flask app
# static_folder='public' tells Flask to look for static files in the 'public' directory.
# static_url_path='/static' maps requests starting with /static/ to the 'public' folder.
app = Flask(__name__, static_folder='public', static_url_path='/static')

# Enable CORS for all routes. This is crucial for your frontend (e.g., Netlify)
# to make requests to this backend API without cross-origin errors.
# For production, consider restricting origins to your specific frontend domain:
# CORS(app, resources={r"/*": {"origins": "https://your-netlify-domain.netlify.app"}})
CORS(app)

# Define the root directory of your project.
# This is used to serve index.html directly from the project root.
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

# --- API Fetching Logic (Python) ---
def fetch_trials_from_clinicaltrials_gov(condition, months_back_filter):
    """
    Fetches clinical trials data for a single condition from ClinicalTrials.gov API (v2).
    Filters results by last update date AFTER fetching, based on months_back_filter.
    """
    base_url = "https://clinicaltrials.gov/api/v2/studies"
    
    # Calculate the date cutoff for filtering *after* fetching
    date_cutoff = datetime.today() - timedelta(days=30 * months_back_filter)

    # Parameters for the v2 API.
    # ONLY send parameters that the API accepts directly in the query string.
    # We are NOT sending a 'filter' parameter for date to the API request.
    base_params = {
        "query.cond": condition,
        "pageSize": 100, # Max page size allowed by API for a single request
    }
    
    data_list = []
    nextPageToken = None
    page_count = 0
    max_pages = 5 # Limit the number of pages to fetch to prevent excessive requests
                  # This prevents your backend from making too many requests if there are
                  # thousands of results for a broad search.

    while True:
        params = base_params.copy()
        if nextPageToken:
            params['pageToken'] = nextPageToken # Add pageToken for subsequent requests

        try:
            # Make the API request with a timeout
            response = requests.get(base_url, params=params, timeout=30)
            response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)
            data = response.json()

            studies = data.get("studies", []) # V2 API returns data under the 'studies' key
            if not studies:
                break # No more studies to fetch or no results for the current page

            for study in studies:
                protocol_section = study.get('protocolSection', {})
                status_module = protocol_section.get('statusModule', {})
                
                # *** Perform date filtering in Python after fetching (just like your Streamlit app) ***
                lastUpdatePostDate_str = status_module.get('lastUpdatePostDateStruct', {}).get('date', '')
                
                if not lastUpdatePostDate_str:
                    continue # Skip studies without a valid last update date

                try:
                    last_update_date_obj = datetime.strptime(lastUpdatePostDate_str, "%Y-%m-%d")
                except ValueError:
                    continue # Skip if date format is incorrect (e.g., "N/A" or unexpected format)

                if last_update_date_obj < date_cutoff:
                    continue # Skip if the study's last update date is older than the filter timeframe


                # --- Data Extraction from V2 API response (remains consistent) ---
                identification_module = protocol_section.get('identificationModule', {})
                conditions_module = protocol_section.get('conditionsModule', {})
                arms_interventions_module = protocol_section.get('armsInterventionsModule', {})
                design_module = protocol_section.get('designModule', {})

                nctId = identification_module.get('nctId', 'N/A') # v2 uses camelCase like nctId
                title = identification_module.get('officialTitle', identification_module.get('briefTitle', 'No title provided'))
                acronym = identification_module.get('acronym', 'N/A')
                overallStatus = status_module.get('overallStatus', 'N/A')
                studyType = design_module.get('studyType', 'N/A')

                # Dates in v2 are often nested under a 'Struct' and have a 'date' key
                studyFirstPostDate = status_module.get('studyFirstPostDateStruct', {}).get('date', 'N/A')
                # lastUpdatePostDate is already extracted above as lastUpdatePostDate_str for filtering
                
                conditions = ', '.join(conditions_module.get('conditions', ['No conditions listed']))

                interventions_list = arms_interventions_module.get('interventions', [])
                interventions = ', '.join([interv.get('name', 'No intervention name listed') for interv in interventions_list]) if interventions_list else "No interventions listed"
                
                phases = ', '.join(design_module.get('phases', ['Not Available']))

                data_list.append({
                    "NCT ID": nctId,
                    "Title": title,
                    "Study First Post Date": studyFirstPostDate,
                    "Last Update Post Date": lastUpdatePostDate_str, # Use the string date for the output
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
            # Log the full response text for HTTP errors to help debug API issues
            print(f"HTTP error for condition '{condition}': {e.response.status_code} - {e.response.text}")
            break # Exit loop on HTTP error
        except requests.exceptions.ConnectionError as e:
            print(f"Connection error for condition '{condition}': {e}")
            break # Exit loop on connection error
        except requests.exceptions.Timeout as e:
            print(f"Timeout error for condition '{condition}': {e}")
            break # Exit loop on timeout
        except requests.exceptions.RequestException as e:
            print(f"An general requests error occurred fetching data for '{condition}': {e}")
            break # Exit loop on general request error
        except json.JSONDecodeError as e:
            print(f"JSON decode error for '{condition}': {e}. Response might not be valid JSON. Raw response: {response.text}")
            break # Exit loop on JSON parsing error
        except Exception as e:
            # Catch any other unexpected errors during processing
            print(f"An unexpected error occurred processing data for '{condition}': {e}")
            break

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
    This is useful for local development or if Render serves this directly.
    For a separate Netlify frontend, this route would typically not be hit.
    """
    return send_from_directory(PROJECT_ROOT, 'index.html')

@app.route('/api')
def api_health_check():
    """
    Simple health check endpoint for the API.
    Returns a JSON response to indicate the API is running.
    """
    return jsonify({"message": "API is running!", "status": "success", "timestamp": datetime.now().isoformat()})

@app.route('/api/search_trials', methods=['POST'])
def search_trials():
    """
    API endpoint to search for clinical trials.
    Expects JSON payload with 'query_terms' (a list of strings) and 'months_back' (int).
    Returns JSON with fetched trial data, grouped by query term.
    """
    data = request.get_json()
    query_terms_raw = data.get('query_terms', []) # Default to empty list if not found

    months_back = data.get('months_back', 3) # Default to 3 months

    # Validate that query_terms_raw is indeed a list
    if not isinstance(query_terms_raw, list):
        return jsonify({"error": "Invalid format for 'query_terms'. Expected a list of strings.", "status": "error"}), 400

    # Frontend already splits and trims, so just ensure elements are stripped
    # and filter out any empty strings that might have resulted from trimming
    query_terms = [term.strip() for term in query_terms_raw if isinstance(term, str) and term.strip()]

    if not query_terms:
        return jsonify({"error": "Please enter valid condition(s) to search.", "status": "error"}), 400

    all_results = {}
    for term in query_terms:
        # Call the data fetching function for each query term
        all_results[term] = fetch_trials_from_clinicaltrials_gov(term, months_back)

    return jsonify(all_results)

# This block is for running the Flask app locally using the development server.
# It will not be executed when deployed with a WSGI server like Gunicorn on Render.
if __name__ == '__main__':
    # Use 0.0.0.0 to listen on all public IPs, useful for Docker/Render.
    # Use os.environ.get('PORT', 5000) to allow Render to set the port.
    app.run(debug=True, host='0.0.0.0', port=os.environ.get('PORT', 5000))