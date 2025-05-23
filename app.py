from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
import json

app = Flask(__name__, static_folder="public", static_url_path="/public")
CORS(app) # Enable CORS for all routes

# Define the root directory of your project
# This helps Flask find index.html which is at the same level as app.py
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

# --- Utility Functions ---
def fetch_trials_from_clinicaltrials_gov(query_term, months_back):
    """
    Fetches clinical trial data from ClinicalTrials.gov API.
    """
    print(f"Fetching trials for '{query_term}' updated in last {months_back} months from ClinicalTrials.gov...")
    search_expression = f"AREA[Conditions]{query_term} AND MODIFIED_SINCE({months_back})"
    # Limiting max_rnk for demonstration; remove or increase for full data
    api_url = f"https://clinicaltrials.gov/api/query/full_studies?expr={search_expression}&fmt=json&max_rnk=200"

    try:
        response = requests.get(api_url, timeout=30) # Add a timeout to prevent hanging
        response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)
        data = response.json()

        studies_data = []
        if data and 'FullStudiesResponse' in data and 'FullStudies' in data['FullStudiesResponse']:
            for study_wrapper in data['FullStudiesResponse']['FullStudies']:
                study = study_wrapper['Study']
                protocol = study.get('Protocol', {})
                identification_module = protocol.get('IdentificationModule', {})
                design_module = protocol.get('DesignModule', {})
                status_module = protocol.get('StatusModule', {})
                # description_module = protocol.get('DescriptionModule', {}) # Not directly used in current fields
                eligibility_module = protocol.get('EligibilityModule', {})
                arms_interventions_module = protocol.get('ArmsInterventionsModule', {})

                # Extract conditions
                conditions = []
                if 'ConditionsModule' in protocol and 'ConditionList' in protocol['ConditionsModule']:
                    conditions = [c['Condition'] for c in protocol['ConditionsModule']['ConditionList']['Condition']]

                # Extract interventions
                interventions = []
                if 'InterventionList' in arms_interventions_module:
                    interventions = [i['InterventionName'] for i in arms_interventions_module['InterventionList']['Intervention']]


                trial_info = {
                    "NCT ID": identification_module.get('NCTId', 'N/A'),
                    "Title": identification_module.get('OfficialTitle', identification_module.get('BriefTitle', 'N/A')),
                    "Acronym": identification_module.get('Acronym', 'N/A'),
                    "Overall Status": status_module.get('OverallStatus', 'N/A'),
                    "Study Type": design_module.get('StudyType', 'N/A'),
                    "Phases": design_module.get('PhaseList', {}).get('Phase', ['N/A'])[0] if 'PhaseList' in design_module else 'N/A',
                    "Study First Post Date": status_module.get('StudyFirstPostDate', 'N/A'),
                    "Last Update Post Date": status_module.get('LastUpdatePostDate', 'N/A'),
                    "Conditions": ", ".join(conditions) if conditions else "N/A",
                    "Interventions": ", ".join(interventions) if interventions else "N/A",
                    # Add more fields as needed based on the API response structure
                }
                studies_data.append(trial_info)
        return studies_data
    except requests.exceptions.HTTPError as e:
        print(f"HTTP error fetching data for '{query_term}': {e}")
        print(f"Response content: {e.response.text}")
        return []
    except requests.exceptions.ConnectionError as e:
        print(f"Connection error fetching data for '{query_term}': {e}")
        return []
    except requests.exceptions.Timeout as e:
        print(f"Timeout error fetching data for '{query_term}': {e}")
        return []
    except requests.exceptions.RequestException as e:
        print(f"An general requests error occurred fetching data for '{query_term}': {e}")
        return []
    except json.JSONDecodeError as e:
        print(f"JSON decode error for '{query_term}': {e}. Response might not be valid JSON.")
        return []
    except Exception as e:
        print(f"An unexpected error occurred processing data for '{query_term}': {e}")
        return []


# --- Routes ---

@app.route('/')
def index():
    # Serve index.html directly from the project root
    # PROJECT_ROOT is where app.py and index.html reside
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
        return jsonify({"error": "No query terms provided."}), 400

    # Split terms by comma and clean up whitespace, remove empty strings
    query_terms = [term.strip() for term in query_terms_raw.split(',') if term.strip()]

    if not query_terms:
        return jsonify({"error": "Please enter valid condition(s) to search."}), 400

    results = {}
    for term in query_terms:
        results[term] = fetch_trials_from_clinicaltrials_gov(term, months_back)

    return jsonify(results)

if __name__ == '__main__':
    app.run(debug=True) # debug=True is good for development. Set to False for production.