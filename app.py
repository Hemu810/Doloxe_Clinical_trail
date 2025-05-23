# app.py
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
import json
from datetime import datetime, timedelta

app = Flask(__name__, static_folder="public", static_url_path="/static")
CORS(app) # Enable CORS for all routes

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

# --- Utility Functions (keep this as the v2 API version) ---
def fetch_trials_from_clinicaltrials_gov(condition, months_back_filter):
    # ... (This function remains exactly as I provided in the previous full app.py code) ...
    base_url = "https://clinicaltrials.gov/api/v2/studies"
    date_cutoff = (datetime.today() - timedelta(days=30 * months_back_filter)).strftime("%Y-%m-%d")
    base_params = {
        "query.cond": condition,
        "pageSize": 100,
        "filter.lastUpdatePostDate.gte": date_cutoff
    }
    
    data_list = []
    nextPageToken = None
    page_count = 0
    max_pages = 5 

    while True:
        params = base_params.copy()
        if nextPageToken:
            params['pageToken'] = nextPageToken

        try:
            response = requests.get(base_url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()

            studies = data.get("studies", [])
            if not studies:
                break

            for study in studies:
                protocol_section = study.get('protocolSection', {})
                identification_module = protocol_section.get('identificationModule', {})
                status_module = protocol_section.get('statusModule', {})
                conditions_module = protocol_section.get('conditionsModule', {})
                arms_interventions_module = protocol_section.get('armsInterventionsModule', {})
                design_module = protocol_section.get('designModule', {})

                nctId = identification_module.get('nctId', 'N/A')
                title = identification_module.get('officialTitle', identification_module.get('briefTitle', 'No title provided'))
                acronym = identification_module.get('acronym', 'N/A')
                overallStatus = status_module.get('overallStatus', 'N/A')
                studyType = design_module.get('studyType', 'N/A')
                studyFirstPostDate = status_module.get('studyFirstPostDateStruct', {}).get('date', 'N/A')
                lastUpdatePostDate = status_module.get('lastUpdatePostDateStruct', {}).get('date', 'N/A')
                conditions = ', '.join(conditions_module.get('conditions', ['No conditions listed']))

                interventions_list = arms_interventions_module.get('interventions', [])
                interventions = ', '.join([interv.get('name', 'No intervention name listed') for interv in interventions_list]) if interventions_list else "No interventions listed"
                
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

        except requests.exceptions.HTTPError as e:
            print(f"HTTP error for condition '{condition}': {e.response.status_code} - {e.response.text}")
            break
        except requests.exceptions.ConnectionError as e:
            print(f"Connection error for condition '{condition}': {e}")
            break
        except requests.exceptions.Timeout as e:
            print(f"Timeout error for condition '{condition}': {e}")
            break
        except requests.exceptions.RequestException as e:
            print(f"An unexpected request error occurred for condition '{condition}': {e}")
            break
        except json.JSONDecodeError as e:
            print(f"JSON decode error for condition '{condition}': {e}. Raw response: {response.text}")
            break
        except Exception as e:
            print(f"An unexpected error occurred processing data for condition '{condition}': {e}")
            break

    def get_sort_key(item):
        try:
            return datetime.strptime(item["Last Update Post Date"], "%Y-%m-%d")
        except ValueError:
            return datetime.min

    data_list.sort(key=get_sort_key, reverse=True)
    return data_list


# --- Routes ---

@app.route('/')
def index():
    return send_from_directory(PROJECT_ROOT, 'index.html')

@app.route('/api')
def api_health_check():
    return jsonify({"message": "API is running!", "status": "success"})


@app.route('/api/search_trials', methods=['POST'])
def search_trials():
    data = request.get_json()
    query_terms_raw = data.get('query_terms', []) # Default to empty list if not found
    months_back = data.get('months_back', 3) # Default to 3 months

    # Validate that query_terms_raw is indeed a list
    if not isinstance(query_terms_raw, list):
        return jsonify({"error": "Invalid format for 'query_terms'. Expected a list.", "status": "error"}), 400

    # Frontend already splits and trims, so just ensure elements are stripped
    # and filter out any empty strings that might have resulted from trimming
    query_terms = [term.strip() for term in query_terms_raw if isinstance(term, str) and term.strip()]

    if not query_terms:
        return jsonify({"error": "Please enter valid condition(s) to search.", "status": "error"}), 400

    results = {}
    for term in query_terms:
        results[term] = fetch_trials_from_clinicaltrials_gov(term, months_back)

    return jsonify(results)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=os.environ.get('PORT', 5000))