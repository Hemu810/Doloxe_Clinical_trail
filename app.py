# app.py
from flask import Flask, request, jsonify, render_template
import requests
from datetime import datetime, timedelta
import os

# Initialize Flask app with specified template and static folders
app = Flask(__name__, static_folder='static')

# --- API Fetching Logic (Python) ---
def fetch_trials_python(condition, months_back_filter):
    """
    Fetches clinical trials data for a single condition from ClinicalTrials.gov API.
    Filters results by last update date.
    """
    base_url = "https://clinicaltrials.gov/api/v2/studies"
    base_params = {
        "query.cond": condition,
        "pageSize": 1000, # Max page size allowed by API
    }
    data_list = []
    date_cutoff = datetime.today() - timedelta(days=30 * months_back_filter)
    nextPageToken = None
    page_count = 0
    max_pages = 50 # Limit the number of pages to fetch to prevent excessive requests

    while True:
        params = base_params.copy()
        if nextPageToken:
            params['pageToken'] = nextPageToken

        try:
            response = requests.get(base_url, params=params)
            response.raise_for_status() # Raise an exception for HTTP errors (4xx or 5xx)
            data = response.json()

            studies = data.get("studies", [])
            if not studies:
                break # No more studies to fetch

            for study in studies:
                status_module = study['protocolSection']['statusModule']
                identification_module = study['protocolSection']['identificationModule']
                conditions_module = study['protocolSection']['conditionsModule']
                arms_interventions_module = study['protocolSection'].get('armsInterventionsModule', {})
                design_module = study['protocolSection']['designModule']

                lastUpdatePostDate = status_module.get('lastUpdatePostDateStruct', {}).get('date', '')
                if not lastUpdatePostDate:
                    continue # Skip if date is missing

                try:
                    last_update_date = datetime.strptime(lastUpdatePostDate, "%Y-%m-%d")
                except ValueError:
                    continue # Skip if date format is incorrect

                # Filter by date
                if last_update_date < date_cutoff:
                    continue

                title = identification_module.get('officialTitle', 'No title provided')
                nctId = identification_module.get('nctId', 'Unknown')
                overallStatus = status_module.get('overallStatus', 'Unknown')
                conditions = ', '.join(conditions_module.get('conditions', ['No conditions listed']))
                acronym = identification_module.get('acronym', 'Unknown')
                interventions_list = arms_interventions_module.get('interventions', [])
                interventions = ', '.join([interv.get('name', 'No intervention name listed') for interv in interventions_list]) if interventions_list else "No interventions listed"
                studyFirstPostDate = status_module.get('studyFirstPostDateStruct', {}).get('date', 'Unknown Date')
                studyType = design_module.get('studyType', 'Unknown')
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

            nextPageToken = data.get('nextPageToken')
            page_count += 1
            if not nextPageToken or page_count >= max_pages:
                break

        except requests.exceptions.RequestException as e:
            print(f"Network or API error for condition '{condition}': {e}")
            break
        except Exception as e:
            print(f"An unexpected error occurred for condition '{condition}': {e}")
            break

    # Sort by Last Update Post Date descending after all data is collected
    data_list.sort(key=lambda x: datetime.strptime(x["Last Update Post Date"], "%Y-%m-%d"), reverse=True)
    return data_list



### Flask Routes

@app.route('/')
def index():
    """Serves the main HTML page from the templates folder."""
    return render_template('index.html')

@app.route('/api')
def api_root():
    """
    Returns a simple JSON response to indicate the API is running.
    """
    return jsonify({"message": "API is running!", "timestamp": datetime.now().isoformat()})

@app.route('/api/search_trials', methods=['POST'])
def search_trials():
    """
    API endpoint to search for clinical trials.
    Expects JSON payload with 'query_terms' (list of strings) and 'months_back' (int).
    Returns JSON with fetched trial data.
    """
    data = request.get_json()
    query_terms = data.get('query_terms', [])
    months_back = data.get('months_back', 3)

    # --- DEBUGGING: Print value received by backend ---
    print(f"Backend: Received months_back: {months_back}")
    # --- END DEBUGGING ---

    if not query_terms:
        return jsonify({"error": "No query terms provided"}), 400

    all_results = {}
    for term in query_terms:
        all_results[term] = fetch_trials_python(term, months_back)

    return jsonify(all_results)

if __name__ == '__main__':
    app.run(debug=True)